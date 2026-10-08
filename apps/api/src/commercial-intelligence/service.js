import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db.js";
import { config } from "../config.js";
import {
  runStructuredTextResearch,
  runStructuredWebResearch,
} from "../structuredWebResearch.js";
import { searchTavily } from "../tavily.js";
import { ensureManufacturerRegistrationsSchema } from "../manufacturer-registrations/schema.js";
import { ensureProspectResearchSchema } from "../prospect-research/schema.js";
import { ensureCommercialIntelligenceSchema } from "./schema.js";
import {
  captureSnapshotQueryFailure,
  captureSnapshotQueryRows,
} from "./snapshot-query-metrics.js";
import {
  buildCustomerConversationContext,
  validateCustomerConversationContext,
} from "./conversation-context.js";
import { createTurnExecutionTrace } from "./turn-execution-trace.js";
import {
  getCustomerActivityHistoryRange,
  getCustomerActivityHistoryRangeFromFilters,
  isCustomerContactHistoryQuestion,
} from "./activity-history.js";
import { ensureCommercialCalendarActivitiesSchema } from "./calendar-activities-schema.js";
import { ensureLandingSchema } from "../landing/schema.js";
import { loadCoachBusinessRules } from "../coach/business-rules.js";
import { recordCoachTurnQualityTrace } from "../coach/observability.js";
import {
  appendCustomerAccountChatHistory,
  buildCustomerEvidenceFailureResponse,
  createCustomerAccountAdapter,
} from "./customer-chat-adapter.js";
import {
  CUSTOMER_INTELLIGENCE_CATEGORIES,
  normalizeCustomerIntelligenceFinding,
  normalizeCustomerIntelligenceOrchestration,
  normalizeCustomerIntelligenceSnapshot,
} from "./contract.js";

const FINDING_CATEGORIES = new Set(CUSTOMER_INTELLIGENCE_CATEGORIES);
const CUSTOMER_SNAPSHOT_QUERY_METRICS = new WeakMap();
const PROVIDER_CATALOG_RESULT_LIMIT = 1000;

function sanitizeCustomerResponseEntities(response, snapshot, usedTools = []) {
  const accountId = Number(snapshot?.account?.id || 0) || null;
  const source = response?.entities || {};
  const queriedTools = new Set(Array.isArray(usedTools) ? usedTools : []);
  const opportunityWasQueried = [
    "searchOpportunities",
    "getOpportunity",
    "getOpportunityActivities",
    "getOpportunityReadiness",
    "getOpportunityQuotation",
  ].some((toolName) => queriedTools.has(toolName));
  const opportunities = [
    ...(snapshot?.opportunities || []),
    ...(snapshot?.inactiveOpportunities || []),
    ...(snapshot?.selectedOpportunity ? [snapshot.selectedOpportunity] : []),
  ];
  const opportunity = opportunityWasQueried
    ? opportunities.find(
        (item) => Number(item.id) === Number(source.opportunityId || 0),
      )
    : null;
  const contact = queriedTools.has("searchContacts")
    ? [
        ...(snapshot?.contacts || []),
        ...(snapshot?.selectedContact ? [snapshot.selectedContact] : []),
      ].find((item) => Number(item.id) === Number(source.contactId || 0))
    : null;
  const lead = queriedTools.has("searchLeads")
    ? (snapshot?.interactions || []).find(
        (item) =>
          Number(item.id) === Number(source.leadId || 0) &&
          (item.leadSubstatusCode ||
            item.leadReasonCode ||
            item.leadRequiredActionCode),
      )
    : null;
  return {
    accountId,
    opportunityId: opportunity ? Number(opportunity.id) : null,
    contactId: contact ? Number(contact.id) : null,
    leadId: lead ? Number(lead.id) : null,
    names: [
      snapshot?.account?.name,
      opportunity?.name,
      contact?.name,
      lead?.title,
    ].filter(Boolean),
  };
}

export function getCustomerSnapshotQueryMetrics(snapshot) {
  return CUSTOMER_SNAPSHOT_QUERY_METRICS.get(snapshot) || [];
}

export const PUBLIC_CONTACT_ROLE_TERMS = [
  "tecnología",
  "seguridad",
  "infraestructura",
  "operaciones",
  "arquitectura",
  "producto",
  "innovación",
  "transformación digital",
  "usuario responsable",
  "influenciador técnico",
  "responsable regional",
  "líder de proyecto",
  "compras",
];

const DEFAULT_GOVERNANCE_SETTINGS = {
  externalSourcesEnabled: false,
  includeWonOpportunities: true,
  includeLostOpportunities: true,
  includeCancelledOpportunities: false,
  dailyResearchLimitPerUser: 25,
  findingRetentionDays: 365,
  requireEvidenceForExternalFindings: true,
  allowProspectConversion: true,
  qualifiedOpportunityStageCodes: [
    "desarrollo",
    "cotizacion",
    "demostracion",
    "negociacion",
    "waiting",
  ],
  committedOpportunityStageCodes: ["negociacion", "waiting"],
  notes: "Configuracion inicial de gobierno de Mi Coach",
};
const OPPORTUNITY_STAGE_CODES = new Set([
  "contacto_inicial",
  "identificacion_oportunidad",
  "desarrollo",
  "cotizacion",
  "demostracion",
  "negociacion",
  "waiting",
]);

function normalizeStageCodeList(value, fallback) {
  const candidates = Array.isArray(value) ? value : fallback;
  const normalized = [
    ...new Set(candidates.map((code) => String(code || "").trim())),
  ].filter((code) => OPPORTUNITY_STAGE_CODES.has(code));
  return normalized.length ? normalized : [...fallback];
}

function clip(value, max = 1200) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function diagnosticCheck({ field, state, expected, actual, message }) {
  return { field, state, expected, actual, message };
}

function normalizeFindingKeyPart(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function deduplicateCustomerIntelligenceFindings(findings = []) {
  const unique = new Map();
  for (const finding of findings) {
    const normalized = normalizeCustomerIntelligenceFinding(finding);
    const sourceKey = normalizeFindingKeyPart(
      normalized.sourceUrl || normalized.source,
    );
    const targetKey = [
      normalized.targetEntity,
      normalized.targetField,
      normalized.suggestedValue,
    ]
      .map(normalizeFindingKeyPart)
      .join("|");
    const key = [
      normalized.sourceDomain,
      normalized.category,
      normalizeFindingKeyPart(normalized.title),
      sourceKey,
      targetKey,
    ].join("|");
    const previous = unique.get(key);
    if (!previous) {
      unique.set(key, normalized);
      continue;
    }
    unique.set(key, {
      ...previous,
      evidence: [previous.evidence, normalized.evidence]
        .filter(Boolean)
        .join(" | ")
        .slice(0, 4000),
      confidence:
        previous.confidence === "high" || normalized.confidence === "high"
          ? "high"
          : previous.confidence === "medium" ||
              normalized.confidence === "medium"
            ? "medium"
            : "low",
      metadata: {
        ...(previous.metadata || {}),
        duplicateCount: Number(previous.metadata?.duplicateCount || 1) + 1,
      },
    });
  }
  return [...unique.values()];
}

function cleanPublicContactValue(value) {
  const text = String(value || "").trim();
  if (!text || /[*xX]{2,}/.test(text)) return "";
  return text;
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeGovernanceSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const qualifiedOpportunityStageCodes = normalizeStageCodeList(
    source.qualifiedOpportunityStageCodes,
    DEFAULT_GOVERNANCE_SETTINGS.qualifiedOpportunityStageCodes,
  );
  const requestedCommittedStages = normalizeStageCodeList(
    source.committedOpportunityStageCodes,
    DEFAULT_GOVERNANCE_SETTINGS.committedOpportunityStageCodes,
  ).filter((code) => qualifiedOpportunityStageCodes.includes(code));
  const committedOpportunityStageCodes = requestedCommittedStages.length
    ? requestedCommittedStages
    : [
        qualifiedOpportunityStageCodes[
          qualifiedOpportunityStageCodes.length - 1
        ],
      ];
  return {
    externalSourcesEnabled: Boolean(source.externalSourcesEnabled),
    includeWonOpportunities: source.includeWonOpportunities !== false,
    includeLostOpportunities: source.includeLostOpportunities !== false,
    includeCancelledOpportunities: Boolean(
      source.includeCancelledOpportunities,
    ),
    dailyResearchLimitPerUser: Math.max(
      1,
      Math.min(
        500,
        Number(
          source.dailyResearchLimitPerUser ||
            DEFAULT_GOVERNANCE_SETTINGS.dailyResearchLimitPerUser,
        ),
      ),
    ),
    findingRetentionDays: Math.max(
      30,
      Math.min(
        3650,
        Number(
          source.findingRetentionDays ||
            DEFAULT_GOVERNANCE_SETTINGS.findingRetentionDays,
        ),
      ),
    ),
    requireEvidenceForExternalFindings:
      source.requireEvidenceForExternalFindings !== false,
    allowProspectConversion: source.allowProspectConversion !== false,
    qualifiedOpportunityStageCodes,
    committedOpportunityStageCodes,
    notes: clip(source.notes || DEFAULT_GOVERNANCE_SETTINGS.notes, 1000),
  };
}

export async function getMiCoachGovernanceSettings() {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT settings_json FROM mi_coach_governance_settings
     WHERE singleton_key = 'default' LIMIT 1`,
  );
  return normalizeGovernanceSettings(
    parseJson(rows[0]?.settings_json, DEFAULT_GOVERNANCE_SETTINGS),
  );
}

export async function assertExternalResearchGovernance(user) {
  const settings = await getMiCoachGovernanceSettings();
  if (!settings.externalSourcesEnabled) {
    throw createHttpError(
      403,
      "Las fuentes externas estan deshabilitadas por gobierno de Mi Coach",
      {
        requiredPermission: "mi_coach.admin",
      },
    );
  }
  await ensureProspectResearchSchema();
  const rows = await query(
    `SELECT
       (SELECT COUNT(*) FROM customer_intelligence_jobs
        WHERE requested_by_user_id = ? AND job_type = 'external_research'
          AND created_at >= DATE_SUB(NOW(3), INTERVAL 1 DAY))
       +
       (SELECT COUNT(*) FROM prospect_research_sessions
        WHERE requested_by_user_id = ?
          AND external_researched_at >= DATE_SUB(NOW(3), INTERVAL 1 DAY))
       AS total`,
    [Number(user.id), Number(user.id)],
  );
  if (Number(rows[0]?.total || 0) >= settings.dailyResearchLimitPerUser) {
    throw createHttpError(
      429,
      "Se alcanzo el limite diario de investigacion externa para este usuario",
    );
  }
  return settings;
}

function hasPermission(user, permission) {
  return Boolean(user?.permissionSet?.has(permission));
}

function hasReadPermission(user, moduleName) {
  return Boolean(
    hasPermission(user, `${moduleName}.read`) ||
    hasPermission(user, `${moduleName}.read_all`),
  );
}

function hasReadAllPermission(user, moduleName) {
  return hasPermission(user, `${moduleName}.read_all`);
}

function createHttpError(status, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, details);
  return error;
}

function mapJobRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    publicId: row.public_id,
    accountId: row.account_id === null ? null : Number(row.account_id),
    opportunityId:
      row.opportunity_id === null ? null : Number(row.opportunity_id),
    contactId: row.contact_id === null ? null : Number(row.contact_id),
    requestedByUserId: Number(row.requested_by_user_id),
    jobType: row.job_type,
    status: row.status,
    request: parseJson(row.request_json, null),
    result: parseJson(row.result_json, null),
    errorMessage: row.error_message || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at || null,
  };
}

function mapFindingRow(row) {
  if (!row) return null;
  const finding = {
    id: Number(row.id),
    publicId: row.public_id,
    jobId: row.job_id === null ? null : Number(row.job_id),
    accountId: row.account_id === null ? null : Number(row.account_id),
    opportunityId:
      row.opportunity_id === null ? null : Number(row.opportunity_id),
    contactId: row.contact_id === null ? null : Number(row.contact_id),
    category: row.category,
    title: row.title,
    summary: row.summary || "",
    evidenceText: row.evidence_text || "",
    sourceType: row.source_type,
    sourceReference: row.source_reference || "",
    confidence: row.confidence,
    certainty: row.certainty,
    status: row.status,
    metadata: parseJson(row.metadata_json, {}),
    createdByUserId:
      row.created_by_user_id === null ? null : Number(row.created_by_user_id),
    validatedByUserId:
      row.validated_by_user_id === null
        ? null
        : Number(row.validated_by_user_id),
    validatedAt: row.validated_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  const normalized = normalizeCustomerIntelligenceFinding({
    ...finding,
    evidence: finding.evidenceText,
    source: finding.sourceType,
    sourceUrl: finding.sourceReference,
  });
  return { ...finding, ...normalized };
}

async function getAccessibleAccount({ user, accountId }) {
  if (!hasReadPermission(user, "cuentas")) {
    throw createHttpError(403, "No autorizado", {
      requiredPermission: "cuentas.read",
    });
  }

  const params = [Number(accountId)];
  const scope = hasReadAllPermission(user, "cuentas")
    ? ""
    : "AND EXISTS (SELECT 1 FROM account_owners ao WHERE ao.account_id = a.id AND ao.user_id = ?)";
  if (!hasReadAllPermission(user, "cuentas")) params.push(Number(user.id));

  const rows = await query(
    `SELECT a.id, a.name, a.registration_code, a.phone, a.website,
            a.city, a.state_region, a.description, aas.code AS status_code
     FROM accounts a
     INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
     WHERE a.id = ? AND aas.code = 'activada' ${scope}
     LIMIT 1`,
    params,
  );
  if (!rows.length) {
    throw createHttpError(404, "La cuenta no esta disponible");
  }
  return rows[0];
}

async function getAccessibleOpportunity({ user, opportunityId }) {
  if (!hasReadPermission(user, "oportunidades")) {
    throw createHttpError(403, "No autorizado", {
      requiredPermission: "oportunidades.read",
    });
  }

  const params = [Number(opportunityId)];
  const scope = hasReadAllPermission(user, "oportunidades")
    ? ""
    : `AND (
        EXISTS (SELECT 1 FROM account_owners ao WHERE ao.account_id = o.account_id AND ao.user_id = ?)
        OR o.created_by = ?
        OR o.seller_user_id = ?
      )`;
  if (!hasReadAllPermission(user, "oportunidades")) {
    params.push(Number(user.id), Number(user.id), Number(user.id));
  }

  const rows = await query(
    `SELECT o.id, o.name, o.account_id, o.contact_id, o.amount_usd, o.close_date,
          o.sales_stage_id,
            o.updated_at, oss.code AS stage_code, oss.name AS stage_name,
            ocs.code AS commercial_status_code,
            a.name AS account_name
     FROM opportunities o
     INNER JOIN accounts a ON a.id = o.account_id
     INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
     INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
     WHERE o.id = ? AND oas.code = 'activada' ${scope}
     LIMIT 1`,
    params,
  );
  if (!rows.length) {
    throw createHttpError(404, "La oportunidad no esta disponible");
  }
  return rows[0];
}

async function getAccessibleContact({ user, contactId }) {
  if (!hasReadPermission(user, "contactos")) {
    throw createHttpError(403, "No autorizado", {
      requiredPermission: "contactos.read",
    });
  }

  const params = [Number(contactId)];
  const scope = hasReadAllPermission(user, "contactos")
    ? ""
    : "AND EXISTS (SELECT 1 FROM account_owners ao WHERE ao.account_id = c.account_id AND ao.user_id = ?)";
  if (!hasReadAllPermission(user, "contactos")) params.push(Number(user.id));

  const rows = await query(
    `SELECT c.id, c.account_id, c.first_name, c.last_name, c.email, c.phone,
            c.mobile, c.position_title, c.department,
            a.name AS account_name
     FROM contacts c
     INNER JOIN accounts a ON a.id = c.account_id
     INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
     WHERE c.id = ? AND cas.code = 'activado' ${scope}
     LIMIT 1`,
    params,
  );
  if (!rows.length) {
    throw createHttpError(404, "El contacto no esta disponible");
  }
  return rows[0];
}

function resolveAccountId({ account, opportunity, contact }) {
  return (
    Number(
      account?.id || opportunity?.account_id || contact?.account_id || 0,
    ) || null
  );
}

function daysSince(value, now = Date.now()) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((now - timestamp) / 86400000));
}

function daysUntil(value, now = Date.now()) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.floor((timestamp - now) / 86400000);
}

function isOpenCustomerOpportunity(opportunity) {
  const activationStatusCode = String(
    opportunity?.activationStatusCode ||
      opportunity?.activation_status_code ||
      "activada",
  ).toLowerCase();
  const commercialStatusCode = String(
    opportunity?.commercialStatusCode ||
      opportunity?.commercial_status_code ||
      "",
  ).toLowerCase();
  return (
    activationStatusCode === "activada" && commercialStatusCode === "en_proceso"
  );
}

export function filterCustomerOpportunityHistory(opportunities, settings) {
  return opportunities.filter((item) => {
    if (
      item.activation_status_code &&
      item.activation_status_code !== "activada"
    ) {
      return false;
    }
    if (item.commercial_status_code === "ganada") {
      return settings.includeWonOpportunities;
    }
    if (item.commercial_status_code === "perdida") {
      return settings.includeLostOpportunities;
    }
    if (item.commercial_status_code === "anulada") {
      return settings.includeCancelledOpportunities;
    }
    return true;
  });
}

export function filterCustomerOpportunityArtifacts(
  records,
  visibleOpportunityIds,
) {
  const visibleIds = new Set(
    [...visibleOpportunityIds].map((id) => Number(id)),
  );
  return records.filter((record) =>
    visibleIds.has(Number(record.opportunity_id ?? record.opportunityId)),
  );
}

export function buildAccountHealth({
  account,
  contacts = [],
  opportunities = [],
  interactions = [],
  renewals = [],
  products = [],
  now = new Date(),
}) {
  const signals = [];
  const nowTimestamp = new Date(now).getTime();
  const openOpportunities = opportunities.filter(isOpenCustomerOpportunity);
  const latestInteraction =
    interactions
      .map((item) => item.updatedAt || item.createdAt)
      .filter(Boolean)
      .sort(
        (left, right) => new Date(right).getTime() - new Date(left).getTime(),
      )[0] || null;
  const daysSinceLastInteraction = daysSince(latestInteraction, nowTimestamp);
  const riskyOpportunities = openOpportunities.filter((opportunity) => {
    const closeDays = daysUntil(opportunity.closeDate, nowTimestamp);
    const staleDays = daysSince(opportunity.updatedAt, nowTimestamp);
    return (
      (closeDays !== null && closeDays <= 30) ||
      (staleDays !== null && staleDays >= 30)
    );
  });

  if (!account?.description) {
    signals.push({
      code: "missing_account_description",
      severity: "medium",
      title: "Falta contexto de cuenta",
      summary: "La cuenta no tiene una descripción comercial suficiente.",
      evidence: "Campo description vacío o no disponible.",
      source: "crm:accounts.description",
      entityType: "account",
      entityId: account?.id || null,
    });
  }
  if (!contacts.length) {
    signals.push({
      code: "no_active_contacts",
      severity: "medium",
      title: "Sin contactos activos",
      summary:
        "No hay contactos activos disponibles para mapear la relación comercial.",
      evidence: "Consulta de contactos activos sin resultados.",
      source: "crm:contacts",
      entityType: "account",
      entityId: account?.id || null,
    });
  }
  if (!openOpportunities.length) {
    signals.push({
      code: "no_open_opportunities",
      severity: "low",
      title: "Sin oportunidades abiertas",
      summary: "No hay oportunidades abiertas visibles para esta cuenta.",
      evidence: "Consulta de oportunidades activas sin resultados.",
      source: "crm:opportunities",
      entityType: "account",
      entityId: account?.id || null,
    });
  }
  if (daysSinceLastInteraction === null || daysSinceLastInteraction >= 30) {
    signals.push({
      code: "stale_account_activity",
      severity: "high",
      title: "Actividad comercial atrasada",
      summary: "La cuenta no tiene una interacción reciente accesible.",
      evidence:
        daysSinceLastInteraction === null
          ? "No hay interacciones recientes."
          : `Última interacción hace ${daysSinceLastInteraction} días.`,
      source: "crm:interactions",
      entityType: "account",
      entityId: account?.id || null,
    });
  }
  for (const opportunity of riskyOpportunities.slice(0, 5)) {
    const closeDays = daysUntil(opportunity.closeDate, nowTimestamp);
    const staleDays = daysSince(opportunity.updatedAt, nowTimestamp);
    const reason =
      closeDays !== null && closeDays <= 30
        ? `Cierre previsto en ${closeDays} días.`
        : `Sin actualización comercial hace ${staleDays} días.`;
    signals.push({
      code: "opportunity_needs_attention",
      severity: "high",
      title: `Revisar oportunidad: ${opportunity.name}`,
      summary: "La oportunidad tiene una señal determinística de riesgo.",
      evidence: reason,
      source: "crm:opportunities",
      entityType: "opportunity",
      entityId: opportunity.id,
    });
  }
  for (const renewal of renewals
    .filter(
      (item) =>
        daysSince(item.expiresAt, nowTimestamp) !== null &&
        daysSince(item.expiresAt, nowTimestamp) <= 90,
    )
    .slice(0, 5)) {
    const expiryDays = daysSince(renewal.expiresAt, nowTimestamp);
    signals.push({
      code: "renewal_due_soon",
      severity: "medium",
      title: `Renovación próxima: ${renewal.providerName}`,
      summary:
        "Existe un registro de fabricante cercano a su fecha de vencimiento.",
      evidence: `Vencimiento previsto en ${expiryDays} días.`,
      source: "crm:manufacturer_registrations",
      entityType: "opportunity",
      entityId: renewal.opportunityId,
    });
  }

  const highCount = signals.filter(
    (signal) => signal.severity === "high",
  ).length;
  const mediumCount = signals.filter(
    (signal) => signal.severity === "medium",
  ).length;
  const score = Math.max(
    0,
    100 -
      highCount * 25 -
      mediumCount * 10 -
      signals.filter((signal) => signal.severity === "low").length * 5,
  );
  return {
    status: !account
      ? "insufficient_data"
      : highCount
        ? "at_risk"
        : mediumCount
          ? "attention"
          : "healthy",
    score,
    signals,
    metrics: {
      contactCount: contacts.length,
      opportunityCount: openOpportunities.length,
      riskyOpportunityCount: riskyOpportunities.length,
      interactionCount: interactions.length,
      daysSinceLastInteraction,
      renewalCount: renewals.length,
      productCount: products.length,
    },
  };
}

export function buildExpansionHypotheses({
  products = [],
  renewals = [],
  catalogItems = [],
  opportunities = [],
}) {
  const hypotheses = [];
  const opportunityId =
    opportunities.find(isOpenCustomerOpportunity)?.id || null;
  for (const renewal of renewals.filter((item) => item.expiresAt)) {
    hypotheses.push({
      type: "renewal",
      title: `Preparar renovación de ${renewal.providerName}`,
      summary:
        "El registro tiene una fecha de vencimiento y requiere validar continuidad.",
      evidence: `Vencimiento: ${renewal.expiresAt}.`,
      confidence: "high",
      sourceProductCode: null,
      suggestedProductCode: null,
      suggestedProductDescription: null,
      opportunityId: renewal.opportunityId || opportunityId,
      requiresConfirmation: true,
    });
  }
  const existingCodes = new Set(
    products.map((product) => product.productCode).filter(Boolean),
  );
  const sameProvider = catalogItems.filter(
    (item) =>
      products.some(
        (product) => Number(product.providerId) === Number(item.providerId),
      ) && !existingCodes.has(item.code),
  );
  const otherProvider = catalogItems.filter(
    (item) =>
      !products.some(
        (product) => Number(product.providerId) === Number(item.providerId),
      ) && !existingCodes.has(item.code),
  );
  const sourceProduct = products[0] || null;
  if (sourceProduct && sameProvider[0])
    hypotheses.push({
      type: "upsell",
      title: `Explorar ampliación de ${sourceProduct.description}`,
      summary:
        "Existe otra oferta activa del mismo proveedor que podría complementar o ampliar la solución actual.",
      evidence: `Producto actual: ${sourceProduct.description}; alternativa: ${sameProvider[0].description}.`,
      confidence: "low",
      sourceProductCode: sourceProduct.productCode || null,
      suggestedProductCode: sameProvider[0].code,
      suggestedProductDescription: sameProvider[0].description,
      opportunityId,
      requiresConfirmation: true,
    });
  if (sourceProduct && otherProvider[0])
    hypotheses.push({
      type: "cross_sell",
      title: `Explorar solución complementaria: ${otherProvider[0].description}`,
      summary:
        "Existe una oferta de otro proveedor que puede evaluarse como complemento, no como hecho confirmado.",
      evidence: `Producto actual: ${sourceProduct.description}; catálogo complementario: ${otherProvider[0].description}.`,
      confidence: "low",
      sourceProductCode: sourceProduct.productCode || null,
      suggestedProductCode: otherProvider[0].code,
      suggestedProductDescription: otherProvider[0].description,
      opportunityId,
      requiresConfirmation: true,
    });
  const seen = new Set();
  return hypotheses
    .filter((hypothesis) => {
      const key = `${hypothesis.type}:${hypothesis.sourceProductCode || ""}:${hypothesis.suggestedProductCode || ""}:${hypothesis.opportunityId || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}

export function shouldLoadProviderCatalogForQuestion(question = "") {
  const normalizedQuestion = String(question || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\b(expansion|expandir|ampliar|upsell|cross sell|venta cruzada|ventas cruzadas|productos? complementarios?|complementar|catalogo de productos|catalogo de proveedores)\b/.test(
    normalizedQuestion,
  );
}

export async function buildAuthorizedCustomerSnapshot({
  user,
  accountId,
  opportunityId,
  contactId,
  activityHistoryStartDate = null,
  activityHistoryEndDate = null,
  includeContactHistory = false,
  includeProviderCatalog = true,
}) {
  const governanceSettings = await getMiCoachGovernanceSettings();
  const snapshotQueryMetrics = [];
  const loadSnapshotRows = async (
    source,
    executeQuery,
    resultLimit = null,
    rethrow = false,
  ) => {
    try {
      const captured = captureSnapshotQueryRows(
        source,
        await executeQuery(),
        resultLimit,
      );
      snapshotQueryMetrics.push(captured.metric);
      return captured.rows;
    } catch (error) {
      snapshotQueryMetrics.push(
        captureSnapshotQueryFailure(source, resultLimit),
      );
      if (rethrow) {
        try {
          error.customerSnapshotQueryMetrics = [...snapshotQueryMetrics];
        } catch {}
        throw error;
      }
      return [];
    }
  };
  const normalizedAccountId = Number(accountId || 0);
  const normalizedOpportunityId = Number(opportunityId || 0);
  const normalizedContactId = Number(contactId || 0);

  if (
    !normalizedAccountId &&
    !normalizedOpportunityId &&
    !normalizedContactId
  ) {
    throw createHttpError(400, "Selecciona una cuenta, oportunidad o contacto");
  }

  const [account, opportunity, contact] = await Promise.all([
    normalizedAccountId
      ? getAccessibleAccount({ user, accountId: normalizedAccountId })
      : Promise.resolve(null),
    normalizedOpportunityId
      ? getAccessibleOpportunity({
          user,
          opportunityId: normalizedOpportunityId,
        })
      : Promise.resolve(null),
    normalizedContactId
      ? getAccessibleContact({ user, contactId: normalizedContactId })
      : Promise.resolve(null),
  ]);

  if (
    opportunity &&
    ((opportunity.commercial_status_code === "ganada" &&
      !governanceSettings.includeWonOpportunities) ||
      (opportunity.commercial_status_code === "perdida" &&
        !governanceSettings.includeLostOpportunities) ||
      (opportunity.commercial_status_code === "anulada" &&
        !governanceSettings.includeCancelledOpportunities))
  ) {
    throw createHttpError(404, "La oportunidad no esta disponible");
  }

  const resolvedAccountId = resolveAccountId({ account, opportunity, contact });
  let resolvedAccount = account;
  if (!resolvedAccount && resolvedAccountId) {
    resolvedAccount = await getAccessibleAccount({
      user,
      accountId: resolvedAccountId,
    });
  }

  if (
    account &&
    opportunity &&
    Number(opportunity.account_id) !== Number(account.id)
  ) {
    throw createHttpError(
      400,
      "La oportunidad no pertenece a la cuenta seleccionada",
    );
  }
  if (account && contact && Number(contact.account_id) !== Number(account.id)) {
    throw createHttpError(
      400,
      "El contacto no pertenece a la cuenta seleccionada",
    );
  }

  const relatedContacts =
    resolvedAccountId && hasReadPermission(user, "contactos")
      ? await loadSnapshotRows(
          "contacts",
          () =>
            query(
              `SELECT c.id, c.account_id, c.first_name, c.last_name, c.email, c.phone,
              c.mobile, c.position_title, c.department,
                  CASE WHEN manager.id IS NOT NULL THEN c.manager_contact_id ELSE NULL END AS manager_contact_id,
                  CASE WHEN influenced.id IS NOT NULL THEN c.influences_contact_id ELSE NULL END AS influences_contact_id,
              pp.name AS purchase_participation,
              h.name AS hierarchy_level, rt.name AS relationship_type,
              il.name AS influence_level, cas.code AS activation_status_code,
              CONCAT(manager.first_name, ' ', manager.last_name) AS manager_name,
              CONCAT(influenced.first_name, ' ', influenced.last_name) AS influences_name
           FROM contacts c
           INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
             LEFT JOIN contact_purchase_participations pp ON pp.id = c.purchase_participation_id
             LEFT JOIN contact_hierarchy_levels h ON h.id = c.hierarchy_level_id
             LEFT JOIN contact_relationship_types rt ON rt.id = c.relationship_type_id
             LEFT JOIN contact_influence_levels il ON il.id = c.influence_level_id
             LEFT JOIN contacts manager ON manager.id = c.manager_contact_id AND manager.account_id = c.account_id
             LEFT JOIN contacts influenced ON influenced.id = c.influences_contact_id AND influenced.account_id = c.account_id
           WHERE c.account_id = ?
             ${includeContactHistory ? "" : "AND cas.code = 'activado'"}
             ${hasReadAllPermission(user, "cuentas") ? "" : "AND EXISTS (SELECT 1 FROM account_owners ao_contact_scope WHERE ao_contact_scope.account_id = c.account_id AND ao_contact_scope.user_id = ?)"}
           ORDER BY c.first_name, c.last_name
           ${includeContactHistory ? "" : "LIMIT 51"}`,
              hasReadAllPermission(user, "cuentas")
                ? [resolvedAccountId]
                : [resolvedAccountId, Number(user.id)],
            ),
          includeContactHistory ? null : 50,
        )
      : [];

  const relatedOpportunities =
    resolvedAccountId && hasReadPermission(user, "oportunidades")
      ? await loadSnapshotRows(
          "opportunities_active",
          () =>
            query(
              `SELECT o.id, o.name, o.account_id, o.contact_id, o.amount_usd, o.close_date, o.updated_at,
              o.sales_stage_id,
                  oss.code AS stage_code, oss.name AS stage_name,
                  ocs.code AS commercial_status_code
           FROM opportunities o
           INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
           INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
           INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
           WHERE o.account_id = ? AND oas.code = 'activada'
             ${hasReadAllPermission(user, "oportunidades") ? "" : "AND (EXISTS (SELECT 1 FROM account_owners ao_opportunity_scope WHERE ao_opportunity_scope.account_id = o.account_id AND ao_opportunity_scope.user_id = ?) OR o.created_by = ? OR o.seller_user_id = ?)"}
           ORDER BY o.close_date IS NULL, o.close_date ASC, o.amount_usd DESC
           LIMIT 51`,
              hasReadAllPermission(user, "oportunidades")
                ? [resolvedAccountId]
                : [
                    resolvedAccountId,
                    Number(user.id),
                    Number(user.id),
                    Number(user.id),
                  ],
            ),
          50,
        )
      : [];

  const visibleRelatedOpportunities = filterCustomerOpportunityHistory(
    relatedOpportunities,
    governanceSettings,
  );
  const visibleOpportunityIds = new Set(
    visibleRelatedOpportunities.map((item) => Number(item.id)),
  );

  const relatedInactiveOpportunities =
    resolvedAccountId && hasReadPermission(user, "oportunidades")
      ? await loadSnapshotRows(
          "opportunities_inactive",
          () =>
            query(
              `SELECT o.id, o.name, o.account_id, o.contact_id, o.amount_usd,
              o.close_date, o.updated_at, o.sales_stage_id, oss.code AS stage_code,
                  oss.name AS stage_name, ocs.code AS commercial_status_code,
                  oas.code AS activation_status_code
           FROM opportunities o
           INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
           INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
           INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
           WHERE o.account_id = ? AND oas.code <> 'activada'
             ${hasReadAllPermission(user, "oportunidades") ? "" : "AND (EXISTS (SELECT 1 FROM account_owners ao_opportunity_scope WHERE ao_opportunity_scope.account_id = o.account_id AND ao_opportunity_scope.user_id = ?) OR o.created_by = ? OR o.seller_user_id = ?)"}
           ORDER BY o.updated_at DESC, o.close_date IS NULL, o.close_date ASC
           LIMIT 51`,
              hasReadAllPermission(user, "oportunidades")
                ? [resolvedAccountId]
                : [
                    resolvedAccountId,
                    Number(user.id),
                    Number(user.id),
                    Number(user.id),
                  ],
            ),
          50,
        )
      : [];

  if (resolvedAccountId && hasReadPermission(user, "interacciones")) {
    await ensureLandingSchema();
  }
  const interactionAccessScope = hasReadAllPermission(user, "interacciones")
    ? ""
    : "AND (i.seller_user_id = ? OR i.created_by = ? OR EXISTS (SELECT 1 FROM account_owners ao_interaction_scope WHERE ao_interaction_scope.account_id = COALESCE(i.account_id, (SELECT related_opportunity.account_id FROM opportunities related_opportunity WHERE related_opportunity.id = i.primary_opportunity_id)) AND ao_interaction_scope.user_id = ?) OR EXISTS (SELECT 1 FROM landing_submissions ls WHERE ls.id = i.landing_submission_id AND ls.sent_to_leads_by = ?) OR EXISTS (SELECT 1 FROM landing_submission_crm_links lscl INNER JOIN landing_submissions ls ON ls.id = lscl.submission_id WHERE lscl.lead_id = i.id AND ls.sent_to_leads_by = ?))";
  const interactionHistoryFilter = activityHistoryStartDate
    ? "AND COALESCE(i.created_at, i.updated_at) >= ? AND COALESCE(i.created_at, i.updated_at) < DATE_ADD(?, INTERVAL 1 DAY)"
    : "";
  const interactionParams = hasReadAllPermission(user, "interacciones")
    ? [resolvedAccountId, resolvedAccountId]
    : [
        resolvedAccountId,
        resolvedAccountId,
        Number(user.id),
        Number(user.id),
        Number(user.id),
        Number(user.id),
        Number(user.id),
      ];
  if (activityHistoryStartDate) {
    interactionParams.push(activityHistoryStartDate, activityHistoryEndDate);
  }
  const relatedInteractions =
    resolvedAccountId && hasReadPermission(user, "interacciones")
      ? await loadSnapshotRows(
          "interactions",
          () =>
            query(
              `SELECT i.id, i.primary_opportunity_id, i.title, i.analysis_status, i.summary, i.source_notes,
                  i.lead_substatus_code, i.lead_reason_code, i.lead_required_action_code,
                  i.lead_next_action_due_at, i.updated_at, i.created_at
           FROM interactions i
           WHERE (i.account_id = ? OR i.primary_opportunity_id IN (
             SELECT o.id FROM opportunities o WHERE o.account_id = ?
           ))
             ${interactionAccessScope}
             ${interactionHistoryFilter}
           ORDER BY i.updated_at DESC, i.created_at DESC
           ${activityHistoryStartDate || includeContactHistory ? "" : "LIMIT 31"}`,
              interactionParams,
            ),
          activityHistoryStartDate || includeContactHistory ? null : 30,
          Boolean(activityHistoryStartDate || includeContactHistory),
        )
      : [];

  let contactIdsByInteraction = new Map();
  if (
    includeContactHistory &&
    hasReadPermission(user, "contactos") &&
    hasReadPermission(user, "interacciones") &&
    relatedInteractions.length &&
    relatedContacts.length
  ) {
    const interactionIds = relatedInteractions.map((item) => Number(item.id));
    const contactIds = relatedContacts.map((item) => Number(item.id));
    const interactionPlaceholders = interactionIds.map(() => "?").join(",");
    const contactPlaceholders = contactIds.map(() => "?").join(",");
    const contactLinkRows = await query(
      `SELECT l.interaction_id, l.contact_id
       FROM interaction_contact_links l
       INNER JOIN contacts c ON c.id = l.contact_id
       WHERE l.interaction_id IN (${interactionPlaceholders})
         AND l.contact_id IN (${contactPlaceholders})
         AND c.account_id = ?`,
      [...interactionIds, ...contactIds, resolvedAccountId],
    ).catch((error) => {
      throw error;
    });
    contactIdsByInteraction = contactLinkRows.reduce((groups, row) => {
      const interactionId = Number(row.interaction_id);
      const linked = groups.get(interactionId) || [];
      linked.push(Number(row.contact_id));
      groups.set(interactionId, linked);
      return groups;
    }, new Map());
  }

  let relatedRenewals = [];
  if (resolvedAccountId && hasReadPermission(user, "oportunidades")) {
    await ensureManufacturerRegistrationsSchema();
    relatedRenewals = await loadSnapshotRows(
      "renewals",
      () =>
        query(
          `SELECT r.id, r.opportunity_id, r.provider_id, p.name AS provider_name,
              r.status_code, r.expires_at, r.renewal_count, r.last_renewed_at, r.notes
       FROM opportunity_manufacturer_registrations r
       INNER JOIN opportunities o ON o.id = r.opportunity_id
       INNER JOIN providers p ON p.id = r.provider_id
      INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
      WHERE o.account_id = ?
         ${hasReadAllPermission(user, "oportunidades") ? "" : "AND (EXISTS (SELECT 1 FROM account_owners ao_renewal_scope WHERE ao_renewal_scope.account_id = o.account_id AND ao_renewal_scope.user_id = ?) OR o.created_by = ? OR o.seller_user_id = ?)"}
       ORDER BY r.expires_at IS NULL, r.expires_at ASC, r.id DESC
       LIMIT 51`,
          hasReadAllPermission(user, "oportunidades")
            ? [resolvedAccountId]
            : [
                resolvedAccountId,
                Number(user.id),
                Number(user.id),
                Number(user.id),
              ],
        ),
      50,
    );
  }

  const relatedProducts =
    resolvedAccountId && hasReadPermission(user, "oportunidades")
      ? await loadSnapshotRows(
          "quotation_products",
          () =>
            query(
              `SELECT q.id AS quotation_id, qv.id AS quotation_version_id,
                q.opportunity_id, qsi.provider_id, p.name AS provider_name,
                qsi.product_code, qsi.product_description, qsi.item_type,
                qsi.is_renewal, qsi.quantity, qsi.list_price_unit,
                qv.currency_code, qs.code AS quotation_status
         FROM quotations q
         INNER JOIN opportunities o ON o.id = q.opportunity_id
         INNER JOIN quotation_versions qv ON qv.id = q.latest_version_id
         INNER JOIN quotation_statuses qs ON qs.id = qv.status_id
         INNER JOIN quotation_sections qsec ON qsec.quotation_version_id = qv.id
         INNER JOIN quotation_section_items qsi ON qsi.quotation_section_id = qsec.id
         INNER JOIN providers p ON p.id = qsi.provider_id
           WHERE o.account_id = ?
             ${hasReadAllPermission(user, "oportunidades") ? "" : "AND (EXISTS (SELECT 1 FROM account_owners ao_product_scope WHERE ao_product_scope.account_id = o.account_id AND ao_product_scope.user_id = ?) OR o.created_by = ? OR o.seller_user_id = ?)"}
         ORDER BY qv.quotation_date DESC, qsi.display_order ASC
           LIMIT 201`,
              hasReadAllPermission(user, "oportunidades")
                ? [resolvedAccountId]
                : [
                    resolvedAccountId,
                    Number(user.id),
                    Number(user.id),
                    Number(user.id),
                  ],
            ),
          200,
        )
      : [];
  const catalogItems =
    includeProviderCatalog &&
    resolvedAccountId &&
    hasReadPermission(user, "oportunidades")
      ? await loadSnapshotRows(
          "provider_catalog",
          () =>
            query(
              `SELECT ppli.provider_id AS providerId, ppli.code, ppli.description FROM provider_price_list_items ppli INNER JOIN provider_price_lists ppl ON ppl.id = ppli.price_list_id INNER JOIN provider_price_list_item_statuses ps ON ps.id = ppli.activation_status_id WHERE ppl.is_active = 1 AND ps.is_active = 1 ORDER BY ppli.updated_at DESC LIMIT ${PROVIDER_CATALOG_RESULT_LIMIT + 1}`,
            ),
          PROVIDER_CATALOG_RESULT_LIMIT,
        )
      : [];

  relatedRenewals = filterCustomerOpportunityArtifacts(
    relatedRenewals,
    visibleOpportunityIds,
  );
  const visibleRelatedProducts = filterCustomerOpportunityArtifacts(
    relatedProducts,
    visibleOpportunityIds,
  );
  const coachOpportunityIds = [
    ...new Set(
      [
        ...visibleRelatedOpportunities,
        ...relatedInactiveOpportunities,
        ...(opportunity ? [opportunity] : []),
      ]
        .map((item) => Number(item.id))
        .filter(Boolean),
    ),
  ];
  const coachContextByOpportunity = new Map();
  let relatedOpportunityActivities = [];
  let relatedCalendarActivities = [];
  if (coachOpportunityIds.length) {
    const placeholders = coachOpportunityIds.map(() => "?").join(",");
    const [
      stageQuestions,
      workspaceActions,
      workspaceWeaknesses,
      assessments,
      playbookRows,
    ] = await Promise.all([
      query(
        `SELECT o.id AS opportunity_id, q.id AS question_id,
                  q.sales_stage_id, q.code, q.prompt, q.is_required,
                  a.answer_value
           FROM opportunities o
           INNER JOIN opportunity_stage_questions q
             ON q.sales_stage_id = o.sales_stage_id AND q.is_active = 1
           LEFT JOIN opportunity_stage_question_answers a
             ON a.id = (SELECT a2.id FROM opportunity_stage_question_answers a2
                        WHERE a2.opportunity_id = o.id
                          AND a2.question_id = q.id
                        ORDER BY a2.id DESC LIMIT 1)
           WHERE o.id IN (${placeholders})
           ORDER BY o.id, q.display_order`,
        coachOpportunityIds,
      ).catch(() => []),
      query(
        `SELECT opportunity_id, id, title, action_type, status, priority,
                  owner_user_id, due_date, scheduled_at, success_criteria,
                  notes, is_primary_next_step
           FROM opportunity_workspace_actions
           WHERE opportunity_id IN (${placeholders})
           ORDER BY opportunity_id, due_date IS NULL, due_date, updated_at DESC`,
        coachOpportunityIds,
      ).catch(() => []),
      query(
        `SELECT opportunity_id, title, category, severity, status, detail,
                  mitigation_plan
           FROM opportunity_workspace_weaknesses
           WHERE opportunity_id IN (${placeholders})
           ORDER BY opportunity_id, FIELD(severity, 'high', 'medium', 'low'), updated_at DESC`,
        coachOpportunityIds,
      ).catch(() => []),
      query(
        `SELECT opportunity_id, criterion_code, status, summary, evidence_count
           FROM opportunity_workspace_criterion_assessments
           WHERE opportunity_id IN (${placeholders})`,
        coachOpportunityIds,
      ).catch(() => []),
      query(
        `SELECT st.sales_stage_id, sales.code AS stage_code,
                  sales.name AS stage_name, st.objective,
                  st.exit_criteria_summary, c.code AS criterion_code,
                  c.title AS criterion_title, c.description AS criterion_description,
                  c.is_required
           FROM opportunity_playbooks p
           INNER JOIN opportunity_playbook_versions v
             ON v.playbook_id = p.id AND v.is_active = 1
           INNER JOIN opportunity_playbook_stage_templates st
             ON st.playbook_version_id = v.id
           INNER JOIN opportunity_sales_stages sales ON sales.id = st.sales_stage_id
           LEFT JOIN opportunity_playbook_stage_criteria c
             ON c.stage_template_id = st.id
           WHERE p.is_active = 1
             AND st.sales_stage_id IN (
               SELECT DISTINCT sales_stage_id FROM opportunities
               WHERE id IN (${placeholders})
             )
           ORDER BY st.display_order, c.display_order, c.id`,
        coachOpportunityIds,
      ).catch(() => []),
    ]);
    const groupRows = (rows) =>
      rows.reduce((groups, row) => {
        const id = Number(row.opportunity_id);
        const group = groups.get(id) || [];
        group.push(row);
        groups.set(id, group);
        return groups;
      }, new Map());
    const questionsByOpportunity = groupRows(stageQuestions);
    const actionsByOpportunity = groupRows(workspaceActions);
    const weaknessesByOpportunity = groupRows(workspaceWeaknesses);
    const assessmentsByOpportunity = groupRows(assessments);
    const stagesById = new Map();
    for (const row of playbookRows) {
      const stageId = Number(row.sales_stage_id);
      const stage = stagesById.get(stageId) || {
        id: stageId,
        code: row.stage_code || "",
        name: row.stage_name || "",
        objective: row.objective || "",
        expectedOutcome: row.exit_criteria_summary || "",
        criteria: [],
      };
      if (row.criterion_code) {
        stage.criteria.push({
          code: row.criterion_code,
          title: row.criterion_title || "",
          description: row.criterion_description || "",
          required: Boolean(row.is_required),
        });
      }
      stagesById.set(stageId, stage);
    }
    for (const item of [
      ...visibleRelatedOpportunities,
      ...relatedInactiveOpportunities,
      ...(opportunity ? [opportunity] : []),
    ]) {
      const id = Number(item.id);
      const stageId = Number(item.sales_stage_id || 0) || null;
      coachContextByOpportunity.set(id, {
        salesStageId: stageId,
        currentStage: stageId
          ? stagesById.get(stageId) || {
              id: stageId,
              code: item.stage_code || "",
              name: item.stage_name || "",
              objective: "",
              expectedOutcome: "",
              criteria: [],
            }
          : null,
        stageQuestions: (questionsByOpportunity.get(id) || []).map((row) => ({
          questionId: Number(row.question_id),
          code: row.code || "",
          prompt: row.prompt || "",
          required: Boolean(row.is_required),
          answer: row.answer_value || null,
        })),
        workspace: {
          actions: (actionsByOpportunity.get(id) || []).map((row) => ({
            id: Number(row.id),
            title: row.title || "",
            actionType: row.action_type || "other",
            status: row.status || "pending",
            priority: row.priority || "medium",
            ownerUserId: Number(row.owner_user_id || 0) || null,
            dueDate: row.due_date || null,
            scheduledAt: row.scheduled_at || null,
            successCriteria: row.success_criteria || "",
            notes: row.notes || "",
            primary: Boolean(row.is_primary_next_step),
          })),
          weaknesses: (weaknessesByOpportunity.get(id) || []).map((row) => ({
            title: row.title || "",
            category: row.category || "",
            severity: row.severity || "medium",
            status: row.status || "open",
            detail: row.detail || "",
            mitigation: row.mitigation_plan || "",
          })),
          criteria: (assessmentsByOpportunity.get(id) || []).map((row) => ({
            code: row.criterion_code || "",
            status: row.status || "missing",
            summary: row.summary || "",
            evidenceCount: Number(row.evidence_count || 0),
          })),
        },
      });
    }
  }
  if (
    resolvedAccountId &&
    activityHistoryStartDate &&
    hasReadPermission(user, "oportunidades") &&
    hasReadPermission(user, "desarrollo_comercial")
  ) {
    const activityOpportunityScope = hasReadAllPermission(user, "oportunidades")
      ? ""
      : "AND (EXISTS (SELECT 1 FROM account_owners ao_activity_scope WHERE ao_activity_scope.account_id = o.account_id AND ao_activity_scope.user_id = ?) OR o.created_by = ? OR o.seller_user_id = ?)";
    const activityDateScope = activityHistoryStartDate
      ? "AND COALESCE(a.due_date, a.created_at) >= ? AND COALESCE(a.due_date, a.created_at) < DATE_ADD(?, INTERVAL 1 DAY)"
      : "";
    const activityParams = [resolvedAccountId];
    if (!hasReadAllPermission(user, "oportunidades")) {
      activityParams.push(Number(user.id), Number(user.id), Number(user.id));
    }
    if (activityHistoryStartDate) {
      activityParams.push(activityHistoryStartDate, activityHistoryEndDate);
    }
    const rows = await loadSnapshotRows(
      "opportunity_activities",
      () =>
        query(
          `SELECT a.id, a.opportunity_id, a.title, a.action_type, a.status,
              a.priority, a.due_date, a.success_criteria, a.notes,
              a.created_at, o.account_id, o.name AS opportunity_name
       FROM opportunity_workspace_actions a
       INNER JOIN opportunities o ON o.id = a.opportunity_id
       WHERE o.account_id = ? ${activityOpportunityScope} ${activityDateScope}
       ORDER BY COALESCE(a.due_date, a.created_at) DESC, a.id DESC`,
          activityParams,
        ),
      null,
      Boolean(activityHistoryStartDate),
    );
    relatedOpportunityActivities = rows.map((row) => ({
      id: Number(row.id),
      accountId: Number(row.account_id),
      opportunityId: Number(row.opportunity_id),
      opportunityName: row.opportunity_name || "",
      title: row.title || "",
      actionType: row.action_type || "other",
      status: row.status || "pending",
      priority: row.priority || "medium",
      dueDate: row.due_date || null,
      notes: row.notes || "",
      successCriteria: row.success_criteria || "",
      createdAt: row.created_at || null,
    }));
  }
  if (
    resolvedAccountId &&
    activityHistoryStartDate &&
    hasReadPermission(user, "calendario_comercial") &&
    hasReadPermission(user, "oportunidades")
  ) {
    await ensureCommercialCalendarActivitiesSchema();
    const calendarAccessScope = hasReadAllPermission(
      user,
      "calendario_comercial",
    )
      ? ""
      : "AND (cca.seller_user_id = ? OR cca.created_by = ?)";
    const calendarParams = [
      resolvedAccountId,
      resolvedAccountId,
      resolvedAccountId,
      resolvedAccountId,
      activityHistoryStartDate,
      activityHistoryEndDate,
    ];
    if (!hasReadAllPermission(user, "calendario_comercial")) {
      calendarParams.push(Number(user.id), Number(user.id));
    }
    const calendarRows = await loadSnapshotRows(
      "calendar_activities",
      () =>
        query(
          `SELECT cca.id, cca.kind, cca.activity_type, cca.status,
              cca.scheduled_at, cca.due_date, cca.objective, cca.note,
              cca.success_criteria, cca.opportunity_id, cca.interaction_id,
              cca.account_id, cca.created_at, o.name AS opportunity_name
       FROM commercial_calendar_activities cca
       LEFT JOIN opportunities o ON o.id = cca.opportunity_id
       WHERE (
         cca.account_id = ? OR
         cca.opportunity_id IN (
           SELECT account_opportunities.id FROM opportunities account_opportunities
           WHERE account_opportunities.account_id = ?
         ) OR
         cca.interaction_id IN (
           SELECT i.id FROM interactions i
           WHERE i.account_id = ? OR i.primary_opportunity_id IN (
             SELECT interaction_opportunities.id FROM opportunities interaction_opportunities
             WHERE interaction_opportunities.account_id = ?
           )
         )
       )
         AND COALESCE(cca.scheduled_at, cca.due_date, cca.created_at) >= ?
         AND COALESCE(cca.scheduled_at, cca.due_date, cca.created_at) < DATE_ADD(?, INTERVAL 1 DAY)
         ${calendarAccessScope}
       ORDER BY COALESCE(cca.scheduled_at, cca.due_date, cca.created_at) DESC,
                cca.id DESC`,
          calendarParams,
        ),
      null,
      true,
    );
    relatedCalendarActivities = calendarRows.map((row) => ({
      id: Number(row.id),
      accountId: Number(row.account_id || resolvedAccountId),
      opportunityId: Number(row.opportunity_id || 0) || null,
      opportunityName: row.opportunity_name || "",
      interactionId: Number(row.interaction_id || 0) || null,
      activityType: row.activity_type || "",
      status: row.status || "pending",
      scheduledAt: row.scheduled_at || null,
      dueDate: row.due_date || null,
      title: row.objective || "",
      notes: row.note || "",
      successCriteria: row.success_criteria || "",
      createdAt: row.created_at || null,
    }));
  }
  const coachContextFor = (item) =>
    coachContextByOpportunity.get(Number(item?.id)) || {};

  const normalizedData = {
    snapshotVersion: "account-intelligence.v1",
    capturedAt: new Date().toISOString(),
    account: resolvedAccount
      ? {
          id: Number(resolvedAccount.id),
          name: resolvedAccount.name || "",
          registrationCode: resolvedAccount.registration_code || "",
          phone: resolvedAccount.phone || "",
          website: resolvedAccount.website || "",
          city: resolvedAccount.city || "",
          stateRegion: resolvedAccount.state_region || "",
          description: clip(resolvedAccount.description, 2000),
        }
      : null,
    selectedOpportunity: opportunity
      ? {
          ...coachContextFor(opportunity),
          id: Number(opportunity.id),
          name: opportunity.name || "",
          accountId: Number(opportunity.account_id),
          contactId: Number(opportunity.contact_id || 0) || null,
          amountUsd: Number(opportunity.amount_usd || 0),
          closeDate: opportunity.close_date || null,
          updatedAt: opportunity.updated_at || null,
          stageCode: opportunity.stage_code || "",
          stageName: opportunity.stage_name || "",
          commercialStatusCode: opportunity.commercial_status_code || "",
          activationStatusCode: "activada",
          lifecycle: isOpenCustomerOpportunity({
            commercialStatusCode: opportunity.commercial_status_code,
          })
            ? "open"
            : "historical",
        }
      : null,
    selectedContact: contact
      ? {
          id: Number(contact.id),
          accountId: Number(contact.account_id),
          name: [contact.first_name, contact.last_name]
            .filter(Boolean)
            .join(" ")
            .trim(),
          email: contact.email || "",
          phone: contact.phone || "",
          mobile: contact.mobile || "",
          positionTitle: contact.position_title || "",
          department: contact.department || "",
        }
      : null,
    contacts: relatedContacts.map((item) => ({
      id: Number(item.id),
      accountId: Number(item.account_id),
      name: [item.first_name, item.last_name].filter(Boolean).join(" ").trim(),
      email: item.email || "",
      phone: item.phone || "",
      mobile: item.mobile || "",
      positionTitle: item.position_title || "",
      department: item.department || "",
      activationStatusCode: item.activation_status_code || "",
      purchaseParticipation: item.purchase_participation || "",
      hierarchyLevel: item.hierarchy_level || "",
      relationshipType: item.relationship_type || "",
      influenceLevel: item.influence_level || "",
      managerContactId: Number(item.manager_contact_id || 0) || null,
      managerName: item.manager_name || "",
      influencesContactId: Number(item.influences_contact_id || 0) || null,
      influencesName: item.influences_name || "",
    })),
    opportunities: visibleRelatedOpportunities.map((item) => ({
      ...coachContextFor(item),
      id: Number(item.id),
      name: item.name || "",
      accountId: Number(item.account_id),
      contactId: Number(item.contact_id || 0) || null,
      amountUsd: Number(item.amount_usd || 0),
      closeDate: item.close_date || null,
      updatedAt: item.updated_at || null,
      stageCode: item.stage_code || "",
      stageName: item.stage_name || "",
      commercialStatusCode: item.commercial_status_code || "",
      activationStatusCode: "activada",
      lifecycle: isOpenCustomerOpportunity({
        commercialStatusCode: item.commercial_status_code,
      })
        ? "open"
        : "historical",
    })),
    inactiveOpportunities: relatedInactiveOpportunities.map((item) => ({
      ...coachContextFor(item),
      id: Number(item.id),
      name: item.name || "",
      accountId: Number(item.account_id),
      contactId: Number(item.contact_id || 0) || null,
      amountUsd: Number(item.amount_usd || 0),
      closeDate: item.close_date || null,
      updatedAt: item.updated_at || null,
      stageCode: item.stage_code || "",
      stageName: item.stage_name || "",
      commercialStatusCode: item.commercial_status_code || "",
      activationStatusCode: item.activation_status_code || "",
      lifecycle: "inactive",
    })),
    interactions: relatedInteractions.map((item) => ({
      id: Number(item.id),
      accountId: Number(resolvedAccountId),
      contactIds: contactIdsByInteraction.get(Number(item.id)) || [],
      opportunityId: Number(item.primary_opportunity_id || 0) || null,
      title: item.title || "",
      analysisStatus: item.analysis_status || "",
      summary: clip(item.summary, 1200),
      sourceNotes: clip(item.source_notes, 1200),
      leadSubstatusCode: item.lead_substatus_code || "",
      leadReasonCode: item.lead_reason_code || "",
      leadRequiredActionCode: item.lead_required_action_code || "",
      leadNextActionDueAt: item.lead_next_action_due_at || null,
      createdAt: item.created_at || null,
      updatedAt: item.updated_at || item.created_at || null,
    })),
    activities: relatedInteractions.map((item) => ({
      id: Number(item.id),
      accountId: Number(resolvedAccountId),
      opportunityId: Number(item.primary_opportunity_id || 0) || null,
      title: item.title || "",
      analysisStatus: item.analysis_status || "",
      summary: clip(item.summary, 1200),
      sourceNotes: clip(item.source_notes, 1200),
      leadSubstatusCode: item.lead_substatus_code || "",
      leadReasonCode: item.lead_reason_code || "",
      leadRequiredActionCode: item.lead_required_action_code || "",
      leadNextActionDueAt: item.lead_next_action_due_at || null,
      createdAt: item.created_at || null,
      updatedAt: item.updated_at || item.created_at || null,
    })),
    opportunityActivities: relatedOpportunityActivities,
    calendarActivities: relatedCalendarActivities,
    renewals: relatedRenewals.map((item) => ({
      id: Number(item.id),
      opportunityId: Number(item.opportunity_id),
      providerId: Number(item.provider_id),
      providerName: item.provider_name || "",
      statusCode: item.status_code || "",
      expiresAt: item.expires_at || null,
      renewalCount: Number(item.renewal_count || 0),
      lastRenewedAt: item.last_renewed_at || null,
      notes: item.notes || "",
    })),
    products: visibleRelatedProducts.map((item) => ({
      quotationId: Number(item.quotation_id),
      quotationVersionId: Number(item.quotation_version_id),
      opportunityId: Number(item.opportunity_id),
      providerId: Number(item.provider_id),
      providerName: item.provider_name || "",
      productCode: item.product_code || "",
      description: item.product_description || "",
      itemType: item.item_type || "producto",
      isRenewal: Boolean(item.is_renewal),
      quantity: Number(item.quantity || 0),
      listPriceUnit:
        item.list_price_unit === null ? null : Number(item.list_price_unit),
      currencyCode: item.currency_code || null,
      commercialStatus: item.quotation_status || "unknown",
      fulfillmentStatus: "not_verified",
    })),
    expansionHypotheses: [],
    supportCases: [],
    dataAvailability: { products: true, supportCases: false },
    permissions: {
      canReadAccounts: hasReadPermission(user, "cuentas"),
      canReadContacts: hasReadPermission(user, "contactos"),
      canReadOpportunities: hasReadPermission(user, "oportunidades"),
      canReadInteractions: hasReadPermission(user, "interacciones"),
      canReadOpportunityActivities:
        hasReadPermission(user, "oportunidades") &&
        hasReadPermission(user, "desarrollo_comercial"),
      canReadCalendarActivities:
        hasReadPermission(user, "calendario_comercial") &&
        hasReadPermission(user, "oportunidades"),
      canReadAllCalendarActivities: hasReadAllPermission(
        user,
        "calendario_comercial",
      ),
    },
  };
  normalizedData.expansionHypotheses = buildExpansionHypotheses({
    products: normalizedData.products,
    renewals: normalizedData.renewals,
    catalogItems,
    opportunities: normalizedData.opportunities,
  });
  const normalizedSnapshot = normalizeCustomerIntelligenceSnapshot({
    ...normalizedData,
    accountHealth: buildAccountHealth(normalizedData),
  });
  CUSTOMER_SNAPSHOT_QUERY_METRICS.set(normalizedSnapshot, snapshotQueryMetrics);
  return normalizedSnapshot;
}

function buildFinding({
  category,
  title,
  summary,
  evidenceText,
  sourceType = "crm",
  sourceReference = "CRM",
  confidence = "medium",
  certainty = "evidenced",
  metadata = {},
}) {
  const normalizedCategory = FINDING_CATEGORIES.has(category)
    ? category
    : "missing_information";
  const finding = {
    sourceDomain:
      sourceType === "tavily" || sourceType === "public_web"
        ? "public_web"
        : "crm_internal",
    category: normalizedCategory,
    title: clip(title, 190),
    summary: clip(summary, 4000),
    evidenceText: clip(evidenceText, 4000),
    sourceType,
    sourceReference: clip(sourceReference, 500),
    confidence,
    certainty,
    status: "suggested",
    metadata,
  };
  const normalized = normalizeCustomerIntelligenceFinding(finding);
  return { ...finding, ...normalized };
}

export function generateCustomerIntelligenceFindings(snapshot) {
  const findings = [];
  const account = snapshot.account;
  const selectedOpportunity = snapshot.selectedOpportunity;
  const contacts = Array.isArray(snapshot.contacts) ? snapshot.contacts : [];
  const opportunities = Array.isArray(snapshot.opportunities)
    ? snapshot.opportunities
    : [];
  const interactions = Array.isArray(snapshot.interactions)
    ? snapshot.interactions
    : [];

  if (account?.description) {
    findings.push(
      buildFinding({
        category: "need",
        title: "Contexto de negocio documentado",
        summary: `La cuenta tiene una descripcion comercial disponible: ${clip(account.description, 500)}`,
        evidenceText: account.description,
        sourceReference: `account:${account.id}:description`,
        confidence: "high",
        certainty: "confirmed",
      }),
    );
  } else if (account) {
    findings.push(
      buildFinding({
        category: "missing_information",
        title: "Falta descripcion del negocio de la cuenta",
        summary:
          "No hay una descripcion suficiente del negocio del cliente. Conviene documentar que hace, como opera y que resultado espera lograr.",
        evidenceText: "Campo description de cuenta vacio o no disponible.",
        sourceReference: `account:${account.id}`,
        confidence: "high",
        certainty: "confirmed",
      }),
    );
  }

  if (contacts.length) {
    const namedContacts = contacts
      .slice(0, 5)
      .map((contact) =>
        [contact.name, contact.positionTitle || contact.department]
          .filter(Boolean)
          .join(" - "),
      );
    findings.push(
      buildFinding({
        category: "stakeholder",
        title: "Contactos activos disponibles",
        summary: `Hay ${contacts.length} contacto(s) activo(s) para trabajar el mapa comercial.`,
        evidenceText: namedContacts.join("; "),
        sourceReference: `account:${account?.id || selectedOpportunity?.accountId}:contacts`,
        confidence: contacts.length >= 2 ? "high" : "medium",
        certainty: "confirmed",
        metadata: { contactCount: contacts.length },
      }),
    );
    const contactsWithRelationshipGaps = contacts.filter(
      (contact) =>
        !contact.purchaseParticipation ||
        !contact.hierarchyLevel ||
        !contact.influenceLevel ||
        (!contact.managerContactId && !contact.influencesContactId),
    );
    if (contactsWithRelationshipGaps.length) {
      findings.push(
        buildFinding({
          category: "missing_information",
          title: "Mapa de relación incompleto",
          summary: `${contactsWithRelationshipGaps.length} contacto(s) necesitan completar participación, nivel o relaciones.`,
          evidenceText: contactsWithRelationshipGaps
            .slice(0, 5)
            .map((contact) => contact.name || `Contacto ${contact.id}`)
            .join("; "),
          sourceReference: `account:${account?.id || selectedOpportunity?.accountId}:relationship-map`,
          confidence: "high",
          certainty: "confirmed",
          metadata: {
            contactIds: contactsWithRelationshipGaps.map(
              (contact) => contact.id,
            ),
          },
        }),
      );
    }
  } else if (snapshot.permissions.canReadContacts) {
    findings.push(
      buildFinding({
        category: "missing_information",
        title: "No hay contactos activos documentados",
        summary:
          "La cuenta no tiene contactos activos accesibles. El siguiente paso comercial deberia identificar responsable tecnico, usuario final y responsable economico.",
        evidenceText: "Consulta de contactos activos sin resultados.",
        sourceReference: `account:${account?.id || selectedOpportunity?.accountId}:contacts`,
        confidence: "high",
        certainty: "confirmed",
      }),
    );
  }

  const openOpportunities = opportunities.filter(isOpenCustomerOpportunity);
  if (openOpportunities.length) {
    const openPipeline = openOpportunities.reduce(
      (sum, opportunity) => sum + Number(opportunity.amountUsd || 0),
      0,
    );
    findings.push(
      buildFinding({
        category: "technology_project",
        title: "Oportunidades activas como senales de proyecto",
        summary: `La cuenta tiene ${openOpportunities.length} oportunidad(es) abierta(s), por un pipeline aproximado de ${openPipeline.toFixed(2)} USD.`,
        evidenceText: openOpportunities
          .slice(0, 5)
          .map(
            (opportunity) =>
              `${opportunity.name} (${opportunity.stageName || "sin etapa"})`,
          )
          .join("; "),
        sourceReference: `account:${account?.id || selectedOpportunity?.accountId}:opportunities`,
        confidence: "high",
        certainty: "confirmed",
        metadata: {
          opportunityCount: openOpportunities.length,
          openPipelineUsd: openPipeline,
        },
      }),
    );
  } else if (snapshot.permissions.canReadOpportunities) {
    findings.push(
      buildFinding({
        category: "missing_information",
        title: "No hay oportunidades activas visibles",
        summary:
          "No se encontraron oportunidades activas para esta cuenta. Conviene validar necesidades actuales antes de crear una oportunidad nueva.",
        evidenceText: "Consulta de oportunidades activas sin resultados.",
        sourceReference: `account:${account?.id || selectedOpportunity?.accountId}:opportunities`,
        confidence: "medium",
        certainty: "confirmed",
      }),
    );
  }

  if (selectedOpportunity) {
    findings.push(
      buildFinding({
        category: "next_step",
        title: "Oportunidad seleccionada para desarrollo comercial",
        summary: `La oportunidad ${selectedOpportunity.name} esta en etapa ${selectedOpportunity.stageName || "sin etapa"} y requiere validar la siguiente informacion comercial antes de avanzar.`,
        evidenceText: `Importe ${selectedOpportunity.amountUsd || 0} USD; cierre ${selectedOpportunity.closeDate || "sin fecha"}.`,
        sourceReference: `opportunity:${selectedOpportunity.id}`,
        confidence: "high",
        certainty: "confirmed",
      }),
    );
  }

  if (interactions.length) {
    findings.push(
      buildFinding({
        category: "business_challenge",
        title: "Interacciones recientes disponibles para extraer necesidades",
        summary: `Hay ${interactions.length} interaccion(es) reciente(s) que pueden contener necesidades, objeciones o acciones pendientes del cliente.`,
        evidenceText: interactions
          .slice(0, 3)
          .map(
            (interaction) =>
              `${interaction.title}: ${interaction.summary || interaction.sourceNotes || "sin resumen"}`,
          )
          .join(" | "),
        sourceReference: `account:${account?.id || selectedOpportunity?.accountId}:interactions`,
        confidence: "medium",
        certainty: "evidenced",
        metadata: { interactionCount: interactions.length },
      }),
    );
  } else if (snapshot.permissions.canReadInteractions) {
    findings.push(
      buildFinding({
        category: "missing_information",
        title: "No hay interacciones recientes accesibles",
        summary:
          "No se encontraron interacciones recientes. Conviene registrar la proxima conversacion para alimentar el descubrimiento comercial.",
        evidenceText: "Consulta de interacciones sin resultados.",
        sourceReference: `account:${account?.id || selectedOpportunity?.accountId}:interactions`,
        confidence: "medium",
        certainty: "confirmed",
      }),
    );
  }

  return findings;
}

function buildResultSummary(snapshot, findings) {
  const missingCount = findings.filter(
    (finding) => finding.category === "missing_information",
  ).length;
  const confirmedCount = findings.filter(
    (finding) => finding.certainty === "confirmed",
  ).length;
  return {
    sourceDomain: "crm_internal",
    scope: [
      "executive_summary",
      "account_health",
      "risks",
      "opportunities",
      "key_contacts",
      "recent_activity",
      "recommended_actions",
    ],
    headline: snapshot.account?.name
      ? `Investigacion interna de ${snapshot.account.name}`
      : "Investigacion interna del cliente",
    summary: `Se generaron ${findings.length} hallazgo(s): ${confirmedCount} confirmado(s) por datos internos y ${missingCount} hueco(s) de informacion.`,
    generatedAt: new Date().toISOString(),
    counts: {
      findings: findings.length,
      missingInformation: missingCount,
      contacts: snapshot.contacts.length,
      opportunities: snapshot.opportunities.filter(isOpenCustomerOpportunity)
        .length,
      interactions: snapshot.interactions.length,
    },
  };
}

function buildDiscoveryQuestions(snapshot, findings) {
  const questions = [];
  const hasContacts = snapshot.contacts.length > 0;
  const hasOpportunities = snapshot.opportunities.some(
    isOpenCustomerOpportunity,
  );
  const missingFindings = findings.filter(
    (finding) => finding.category === "missing_information",
  );

  if (!hasContacts) {
    questions.push(
      "¿Quién es el responsable técnico y quién aprueba presupuesto para esta iniciativa?",
    );
  }
  if (!hasOpportunities) {
    questions.push(
      "¿Qué iniciativa o problema de negocio deberíamos convertir en una oportunidad concreta?",
    );
  }
  if (snapshot.selectedOpportunity) {
    questions.push(
      `¿Qué condición debe cumplirse para avanzar la oportunidad ${snapshot.selectedOpportunity.name} a la siguiente etapa?`,
    );
    questions.push(
      "¿Cuál es el criterio de éxito que el cliente usará para evaluar la solución?",
    );
  }
  if (missingFindings.length) {
    questions.push(
      "¿Qué información falta para validar necesidad, impacto, presupuesto y fecha objetivo?",
    );
  }
  questions.push(
    "¿Qué pasa en la operación del cliente si este reto no se atiende durante el trimestre?",
  );
  questions.push("¿Qué áreas además de TI se ven afectadas por este problema?");

  return Array.from(new Set(questions)).slice(0, 6);
}

function buildDiscoveryRisks(snapshot, findings) {
  const risks = [];
  if (!snapshot.contacts.length) {
    risks.push(
      "No hay contactos activos documentados; el siguiente contacto puede no llegar al decisor correcto.",
    );
  }
  if (!snapshot.opportunities.some(isOpenCustomerOpportunity)) {
    risks.push(
      "No hay oportunidad activa visible; la conversación puede quedarse en exploración sin avance comercial.",
    );
  }
  if (findings.some((finding) => finding.category === "missing_information")) {
    risks.push(
      "Existen huecos de información que pueden debilitar la calificación de necesidad, impacto o presupuesto.",
    );
  }
  if (snapshot.selectedOpportunity && !snapshot.selectedOpportunity.closeDate) {
    risks.push("La oportunidad seleccionada no tiene fecha de cierre clara.");
  }
  return risks.slice(0, 5);
}

function buildDiscoveryNextSteps(snapshot, findings) {
  const nextSteps = [];
  if (snapshot.selectedOpportunity) {
    nextSteps.push({
      title: "Agendar llamada de descubrimiento dirigida",
      actionType: "call",
      priority: "high",
      opportunityId: snapshot.selectedOpportunity.id,
      successCriteria:
        "Validar necesidad, decisor, impacto de negocio y siguiente hito con fecha.",
      notes: "Preparada desde inteligencia comercial interna de Mi Coach.",
    });
  }
  if (findings.some((finding) => finding.category === "missing_information")) {
    nextSteps.push({
      title: "Completar huecos de información del cliente",
      actionType: "next_step",
      priority: "medium",
      opportunityId: snapshot.selectedOpportunity?.id || null,
      successCriteria:
        "Registrar contactos clave, área dueña, necesidad y criterio de éxito.",
      notes: "Usar las preguntas sugeridas por el briefing comercial.",
    });
  }
  nextSteps.push({
    title: "Enviar resumen de descubrimiento y próximos pasos",
    actionType: "send_email",
    priority: "medium",
    opportunityId: snapshot.selectedOpportunity?.id || null,
    successCriteria:
      "Obtener confirmación del cliente sobre necesidad, responsables y fecha de seguimiento.",
    notes: "Personalizar el correo sugerido antes de enviarlo.",
  });
  return nextSteps.slice(0, 4);
}

export function generateCommercialDiscoveryResult(snapshot, findings = []) {
  const accountName = snapshot.account?.name || "el cliente";
  const questions = buildDiscoveryQuestions(snapshot, findings);
  const risks = buildDiscoveryRisks(snapshot, findings);
  const nextSteps = buildDiscoveryNextSteps(snapshot, findings);
  const confirmedFindings = findings.filter(
    (finding) => finding.certainty === "confirmed",
  );
  const missingFindings = findings.filter(
    (finding) => finding.category === "missing_information",
  );
  const primaryContact =
    snapshot.selectedContact || snapshot.contacts[0] || null;
  const contactLine = primaryContact
    ? `${primaryContact.name || "Contacto"}${primaryContact.positionTitle ? `, ${primaryContact.positionTitle}` : ""}`
    : "Contacto por identificar";

  return {
    headline: `Briefing comercial para ${accountName}`,
    summary: `Preparacion basada en ${findings.length} hallazgo(s) internos. Enfocate en validar necesidad, decisor, impacto y siguiente compromiso.`,
    briefing: {
      objective: snapshot.selectedOpportunity
        ? `Avanzar la oportunidad ${snapshot.selectedOpportunity.name} con informacion comercial verificable.`
        : "Convertir el conocimiento disponible en una conversacion de descubrimiento con siguiente paso concreto.",
      knownContext: confirmedFindings
        .slice(0, 4)
        .map((finding) => finding.summary),
      missingInformation: missingFindings
        .slice(0, 5)
        .map((finding) => finding.title),
      targetContact: contactLine,
      questions,
      risks,
      nextSteps,
      callGuide: [
        `Abrir con el contexto conocido de ${accountName} y confirmar si sigue vigente.`,
        "Validar el problema de negocio antes de hablar de solución.",
        "Identificar decisor, influenciadores, presupuesto y fecha objetivo.",
        "Cerrar con un siguiente paso calendarizado y responsable claro.",
      ],
      emailDraft: {
        subject: `Siguiente paso para entender prioridades de ${accountName}`,
        body: `Hola ${primaryContact?.name || ""},\n\nMe gustaría validar contigo algunas prioridades de ${accountName} para entender si podemos apoyar en los retos actuales de tecnología y operación.\n\nPropongo revisar en una llamada breve: necesidad principal, impacto de negocio, responsables involucrados y siguiente hito.\n\n¿Te parece si coordinamos una conversación esta semana?\n\nSaludos,`,
      },
    },
  };
}

function generateExecutiveBriefingFallback(snapshot, findings = []) {
  const health = snapshot.accountHealth;
  const risks = health.signals
    .filter((signal) => ["high", "medium"].includes(signal.severity))
    .slice(0, 5);
  const latestInteractions = snapshot.interactions
    .slice(0, 3)
    .map((item) => item.summary || item.title)
    .filter(Boolean);
  const firstOpenOpportunity = snapshot.opportunities.find(
    isOpenCustomerOpportunity,
  );
  const questions = [
    "¿Qué cambió en las prioridades del cliente desde la última conversación?",
    "¿Quién decide, quién influye y qué condición habilita el siguiente paso?",
    "¿Cuál es la fecha crítica y cómo se validará el resultado esperado?",
  ];
  return {
    headline: `Resumen ejecutivo de ${snapshot.account?.name || "la cuenta"}`,
    summary: `La cuenta presenta salud ${health.status} con score ${health.score}/100, ${snapshot.opportunities.filter(isOpenCustomerOpportunity).length} oportunidad(es) abierta(s), ${snapshot.contacts.length} contacto(s) y ${snapshot.interactions.length} interacción(es) recientes.`,
    executiveBriefing: {
      accountName: snapshot.account?.name || "Cuenta sin nombre",
      healthStatus: health.status,
      healthScore: health.score,
      knownContext: findings
        .filter((finding) => finding.certainty === "confirmed")
        .slice(0, 5)
        .map((finding) => finding.summary),
      recentChanges: latestInteractions,
      prioritizedRisks: risks.map((signal) => ({
        title: signal.title,
        summary: signal.summary,
        evidence: signal.evidence,
        severity: signal.severity,
      })),
      meetingQuestions: questions,
      nextBestStep:
        risks[0]?.title ||
        (firstOpenOpportunity
          ? `Dar seguimiento a ${firstOpenOpportunity.name}`
          : "Identificar la próxima iniciativa comercial del cliente"),
      recommendedActions:
        snapshot.selectedOpportunity || firstOpenOpportunity
          ? [
              {
                title: risks[0]?.title || "Agendar seguimiento comercial",
                actionType: "call",
                priority: risks[0]?.severity === "high" ? "high" : "medium",
                opportunityId: String(
                  snapshot.selectedOpportunity?.id ||
                    firstOpenOpportunity?.id ||
                    "",
                ),
                notes: "Acción sugerida por el resumen ejecutivo de Mi Coach.",
                successCriteria:
                  "Confirmar necesidad, responsable y siguiente hito con fecha.",
              },
            ]
          : [],
      evidence: risks.map((signal) => signal.evidence),
    },
    generatedAt: new Date().toISOString(),
  };
}

function agentResult(
  agentId,
  summary,
  findings = [],
  evidence = [],
  confidence = "medium",
  requiresConfirmation = false,
) {
  const sourceDomain =
    agentId === "public_research" ||
    agentId === "contact_research" ||
    agentId === "technology_research"
      ? "public_web"
      : "crm_internal";
  return {
    agentId,
    status: "completed",
    summary,
    findings,
    evidence,
    confidence,
    requiresConfirmation,
    sourceDomain,
    durationMs: 0,
    sourceCount: evidence.length,
  };
}

async function runPublicSpecialistAgent({
  agentId,
  subject,
  queryText,
  queryTexts = [],
  systemPrompt,
  fields,
  snapshot,
  user,
  jobId,
  category,
}) {
  const searches = [queryText, ...queryTexts]
    .filter(Boolean)
    .map((query) => searchTavily({ query }));
  const tavilyResults = await Promise.all(searches);
  const tavily = {
    enabled: tavilyResults.some((result) => result.enabled),
    results: tavilyResults
      .flatMap((result) => result.results || [])
      .filter(
        (result, index, results) =>
          results.findIndex((candidate) => candidate.url === result.url) ===
          index,
      ),
    warnings: tavilyResults.flatMap((result) => result.warnings || []),
  };
  if (!tavily.enabled || !tavily.results.length) {
    return agentResult(
      agentId,
      "No se encontraron fuentes públicas para este agente.",
      [],
      tavily.warnings || [],
      "low",
    );
  }
  const result = await runStructuredTextResearch({
    schemaName: `account_${agentId}`,
    systemPrompt,
    subject,
    context: {
      account: snapshot.account,
      existingContacts: snapshot.contacts,
      existingProducts: snapshot.products,
      publicSources: tavily.results,
    },
    currentValues: {},
    fields,
    aiUsageContext: {
      userId: Number(user.id),
      featureCode: `commercial_intelligence.${agentId}`,
      jobType: "agent_orchestration",
      jobId,
    },
  });
  if (!result)
    return agentResult(
      agentId,
      "No fue posible interpretar las fuentes públicas.",
      [],
      tavily.warnings || [],
      "low",
    );
  let rawItems = Array.isArray(result.items) ? result.items : [];
  let enrichmentSources = [];
  if (agentId === "contact_research" && rawItems.length) {
    const candidates = rawItems
      .filter((item) => item?.firstName && item?.lastName)
      .slice(0, 10);
    const enrichmentResults = await Promise.all(
      candidates.map((item) =>
        searchTavily({
          query: `site:linkedin.com/in "${item.firstName} ${item.lastName}" "${subject}" email teléfono contacto`,
          maxResults: 5,
        }),
      ),
    );
    enrichmentSources = enrichmentResults
      .flatMap((search) => search.results || [])
      .filter(
        (source, index, sources) =>
          sources.findIndex((candidate) => candidate.url === source.url) ===
          index,
      );
    if (enrichmentSources.length) {
      const enriched = await runStructuredTextResearch({
        schemaName: "account_contact_enrichment",
        systemPrompt:
          "Enriquece contactos candidatos usando únicamente las fuentes públicas proporcionadas. Solo devuelve email o teléfono si aparecen explícitamente en la evidencia. Conserva nombre y cargo si están sustentados; no inventes datos.",
        subject,
        context: {
          candidateContacts: candidates,
          publicSources: enrichmentSources,
        },
        currentValues: {},
        fields,
        aiUsageContext: {
          userId: Number(user.id),
          featureCode: "commercial_intelligence.contact_enrichment",
          jobType: "agent_orchestration",
          jobId,
        },
      });
      if (Array.isArray(enriched?.items) && enriched.items.length)
        rawItems = enriched.items;
    }
  }
  const findings = rawItems.map((item, index) =>
    normalizeCustomerExternalFinding(
      {
        category,
        title: item.title || `${agentId} ${index + 1}`,
        summary:
          item.summary ||
          item.businessChallenge ||
          item.roleTitle ||
          "Señal pública",
        evidenceText:
          item.evidence ||
          item.evidenceText ||
          "Evidencia pública recuperada por Tavily.",
        sourceUrl: item.sourceUrl || "",
        confidence: item.confidence || "medium",
        targetEntity: agentId === "contact_research" ? "contact" : "account",
        targetField:
          agentId === "contact_research" ? "positionTitle" : "description",
        suggestedValue:
          item.suggestedValue || item.summary || item.businessChallenge || "",
        contactData:
          agentId === "contact_research"
            ? {
                firstName: item.firstName || "",
                lastName: item.lastName || "",
                positionTitle: item.positionTitle || "",
                department: item.department || "",
                email: item.email || "",
                phone: item.phone || "",
                mobile: item.mobile || "",
              }
            : null,
      },
      index,
      "tavily",
    ),
  );
  return agentResult(
    agentId,
    `${findings.length} resultado(s) públicos encontrados${enrichmentSources.length ? " y enriquecidos por candidato" : ""}.`,
    findings,
    [...tavily.results, ...enrichmentSources].map((source) => source.url),
    findings.length ? "medium" : "low",
    true,
  );
}

export async function runAccountIntelligenceAgents(
  snapshot,
  { includePublicResearch = false, user = null, jobId = null } = {},
) {
  const crmFindings = generateCustomerIntelligenceFindings(snapshot);
  const healthFindings = snapshot.accountHealth.signals.map((signal) =>
    normalizeCustomerIntelligenceFinding({
      category: signal.severity === "high" ? "risk" : "missing_information",
      title: signal.title,
      summary: signal.summary,
      evidence: signal.evidence,
      source: signal.source,
      sourceUrl: "",
      confidence: signal.severity === "high" ? "high" : "medium",
      certainty: "confirmed",
    }),
  );
  const expansionFindings = snapshot.expansionHypotheses.map((hypothesis) =>
    normalizeCustomerIntelligenceFinding({
      category: hypothesis.type === "renewal" ? "renewal" : "expansion",
      title: hypothesis.title,
      summary: hypothesis.summary,
      evidence: hypothesis.evidence,
      source: "crm:expansion_hypotheses",
      confidence: hypothesis.confidence,
      certainty: "inferred",
    }),
  );
  const actionFindings = snapshot.expansionHypotheses
    .slice(0, 5)
    .map((hypothesis) =>
      normalizeCustomerIntelligenceFinding({
        category: "next_step",
        title: hypothesis.title,
        summary:
          "Revisar esta hipótesis con el cliente antes de crear o ampliar una oportunidad.",
        evidence: hypothesis.evidence,
        source: "agent:actions",
        confidence: "medium",
        certainty: "inferred",
        requiresConfirmation: true,
      }),
    );
  let publicAgent = agentResult(
    "public_research",
    includePublicResearch
      ? "La investigación pública se ejecutó mediante Tavily."
      : "Investigación pública no solicitada en esta ejecución.",
    [],
    [],
    includePublicResearch ? "medium" : "low",
  );
  let contactAgent = agentResult(
    "contact_research",
    "Búsqueda de contactos públicos no solicitada en esta ejecución.",
    [],
    [],
    "low",
    true,
  );
  let technologyAgent = agentResult(
    "technology_research",
    "Búsqueda de iniciativas tecnológicas no solicitada en esta ejecución.",
    [],
    [],
    "low",
    true,
  );
  if (includePublicResearch && user) {
    const external = await runCustomerExternalResearch({
      snapshot,
      user,
      jobId,
    });
    publicAgent = agentResult(
      "public_research",
      external.enabled
        ? `Tavily recuperó ${external.findings.length} hallazgo(s).`
        : "Tavily no pudo recuperar fuentes públicas.",
      external.findings,
      external.warnings,
      external.enabled ? "medium" : "low",
    );
    [contactAgent, technologyAgent] = await Promise.all([
      runPublicSpecialistAgent({
        agentId: "contact_research",
        subject: snapshot.account?.name || "cuenta",
        queryText:
          String(snapshot.account?.name || "empresa") +
          " tecnología seguridad infraestructura operaciones arquitectura producto innovación transformación digital responsables líderes de proyecto contactos",
        queryTexts: [
          `site:linkedin.com/in "${snapshot.account?.name || "empresa"}" tecnología OR seguridad OR infraestructura OR operaciones`,
          `site:linkedin.com/in "${snapshot.account?.name || "empresa"}" ${PUBLIC_CONTACT_ROLE_TERMS.join(" OR ")}`,
        ],
        systemPrompt:
          "Extrae únicamente contactos profesionales públicamente identificables. Exige nombre y apellido; no inventes emails ni teléfonos. Devuelve solo personas con cargo, área, evidencia y URL.",
        fields: [
          {
            key: "items",
            type: "array",
            example: [],
            items: {
              type: "object",
              fields: [
                { key: "firstName", type: "string", example: "Ana" },
                { key: "lastName", type: "string", example: "Pérez" },
                { key: "positionTitle", type: "string", example: "CTO" },
                { key: "department", type: "string", example: "Tecnología" },
                { key: "email", type: "string", example: "" },
                { key: "phone", type: "string", example: "" },
                { key: "mobile", type: "string", example: "" },
                { key: "title", type: "string", example: "Contacto público" },
                {
                  key: "summary",
                  type: "string",
                  example: "Persona identificada",
                },
                { key: "evidence", type: "string", example: "Evidencia" },
                {
                  key: "sourceUrl",
                  type: "string",
                  example: "https://example.com",
                },
                {
                  key: "confidence",
                  type: "enum",
                  enum: ["high", "medium", "low"],
                  example: "medium",
                },
              ],
            },
          },
        ],
        snapshot,
        user,
        jobId,
        category: "stakeholder",
      }),
      runPublicSpecialistAgent({
        agentId: "technology_research",
        subject: snapshot.account?.name || "cuenta",
        queryText:
          String(snapshot.account?.name || "empresa") +
          " tecnología que usa implementación arquitectura cloud ciberseguridad aplicaciones Kubernetes networking DNS DHCP IPAM APIs",
        queryTexts: [
          `"${snapshot.account?.name || "empresa"}" cloud OR AWS OR Azure OR Google Cloud OR multinube implementa usa arquitectura`,
          `"${snapshot.account?.name || "empresa"}" ciberseguridad OR SOC OR firewall OR WAF OR IAM usa implementa`,
          `"${snapshot.account?.name || "empresa"}" aplicaciones OR microservicios OR APIs OR integración tecnológica`,
          `"${snapshot.account?.name || "empresa"}" Kubernetes OR contenedores OR Docker OR OpenShift`,
          `"${snapshot.account?.name || "empresa"}" networking OR redes OR DNS OR DHCP OR IPAM`,
        ],
        systemPrompt:
          "Identifica únicamente tecnologías que la cuenta usa, implementa, migra, opera o anuncia públicamente. Prioriza cloud, ciberseguridad, aplicaciones, Kubernetes, networking, DNS, DHCP, IPAM y APIs. No devuelvas tendencias generales ni tecnologías que solo sean relevantes para el sector; cada resultado debe indicar la tecnología concreta, cómo se relaciona con la cuenta, evidencia, URL y confianza. No conviertas una inferencia en hecho.",
        fields: [
          {
            key: "items",
            type: "array",
            example: [],
            items: {
              type: "object",
              fields: [
                { key: "title", type: "string", example: "Iniciativa cloud" },
                { key: "summary", type: "string", example: "Resumen" },
                {
                  key: "businessChallenge",
                  type: "string",
                  example: "Reto de negocio",
                },
                { key: "evidence", type: "string", example: "Evidencia" },
                {
                  key: "sourceUrl",
                  type: "string",
                  example: "https://example.com",
                },
                {
                  key: "confidence",
                  type: "enum",
                  enum: ["high", "medium", "low"],
                  example: "medium",
                },
              ],
            },
          },
        ],
        snapshot,
        user,
        jobId,
        category: "technology_project",
      }),
    ]);
  }
  const synthesis = agentResult(
    "synthesis",
    `Síntesis coordinada con ${crmFindings.length} hallazgo(s) CRM, ${healthFindings.length} señal(es) de salud, ${expansionFindings.length} hipótesis de expansión y ${publicAgent.findings.length} hallazgo(s) públicos.`,
    deduplicateCustomerIntelligenceFindings([
      ...crmFindings,
      ...healthFindings,
      ...expansionFindings,
      ...publicAgent.findings,
    ]).slice(0, 20),
    [...publicAgent.evidence],
    "medium",
  );
  const derivedActionFindings = [
    ...actionFindings,
    ...healthFindings
      .filter((finding) => finding.category === "risk")
      .slice(0, 5)
      .map((finding) =>
        normalizeCustomerIntelligenceFinding({
          category: "next_step",
          title: `Atender: ${finding.title}`,
          summary: "Revisar esta señal antes de avanzar comercialmente.",
          evidence: finding.evidence,
          source: "agent:actions",
          confidence: "medium",
          certainty: "inferred",
          requiresConfirmation: true,
        }),
      ),
  ];
  const agents = [
    agentResult(
      "crm_context",
      `Contexto CRM: ${snapshot.contacts.length} contactos, ${snapshot.opportunities.filter(isOpenCustomerOpportunity).length} oportunidades abiertas y ${snapshot.interactions.length} interacciones.`,
      crmFindings,
      [snapshot.account?.name || "Cuenta"],
      "high",
    ),
    agentResult(
      "commercial_health",
      `Salud comercial: ${snapshot.accountHealth.status} (${snapshot.accountHealth.score}/100).`,
      healthFindings,
      snapshot.accountHealth.signals.map((signal) => signal.evidence),
      snapshot.accountHealth.status === "at_risk" ? "high" : "medium",
    ),
    publicAgent,
    contactAgent,
    technologyAgent,
    agentResult(
      "expansion",
      `Se identificaron ${snapshot.expansionHypotheses.length} hipótesis de renovación o expansión.`,
      expansionFindings,
      snapshot.expansionHypotheses.map((item) => item.evidence),
      "medium",
      true,
    ),
    synthesis,
    agentResult(
      "actions",
      `${derivedActionFindings.length} acción(es) requieren revisión humana.`,
      derivedActionFindings,
      derivedActionFindings.map((item) => item.evidence),
      "medium",
      true,
    ),
  ];
  return agents.map((agent) => ({
    ...agent,
    durationMs: 0,
    sourceCount: agent.evidence.length,
  }));
}

export async function createAccountIntelligenceAgentsJob({ user, payload }) {
  await ensureCommercialIntelligenceSchema();
  const snapshot = await buildAuthorizedCustomerSnapshot({ user, ...payload });
  const result = await query(
    `INSERT INTO customer_intelligence_jobs (public_id, account_id, opportunity_id, contact_id, requested_by_user_id, job_type, status, request_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'agent_orchestration', 'pending', ?, NOW(3), NOW(3))`,
    [
      `cia_${randomUUID()}`,
      snapshot.account?.id || null,
      snapshot.selectedOpportunity?.id || null,
      snapshot.selectedContact?.id || null,
      Number(user.id),
      JSON.stringify(payload),
    ],
  );
  return {
    job: { id: Number(result.insertId), status: "pending", pollAfterMs: 500 },
    snapshot,
  };
}

export async function processAccountIntelligenceAgentsJob({ jobId, user }) {
  const rows = await query(
    `SELECT * FROM customer_intelligence_jobs WHERE id = ? AND requested_by_user_id = ? AND job_type = 'agent_orchestration' LIMIT 1`,
    [Number(jobId), Number(user.id)],
  );
  const job = rows[0];
  if (!job) return null;
  const snapshot = await buildAuthorizedCustomerSnapshot({
    user,
    accountId: job.account_id,
    opportunityId: job.opportunity_id,
    contactId: job.contact_id,
  });
  const request = parseJson(job.request_json, {});
  if (request?.includePublicResearch) {
    if (!hasPermission(user, "fuentes_externas.execute"))
      throw createHttpError(403, "No autorizado", {
        requiredPermission: "fuentes_externas.execute",
      });
    await assertExternalResearchGovernance(user);
  }
  const startedAt = Date.now();
  const includePublicResearch = Boolean(request?.includePublicResearch);
  try {
    const agents = await runAccountIntelligenceAgents(snapshot, {
      includePublicResearch,
      user,
      jobId,
    });
    const elapsed = Date.now() - startedAt;
    const result = normalizeCustomerIntelligenceOrchestration({
      sourceDomain: includePublicResearch ? "public_web" : "crm_internal",
      orchestrationVersion: "account-intelligence.agents.v1",
      agents: agents.map((agent) => ({
        ...agent,
        durationMs: agent.durationMs || elapsed,
      })),
      generatedAt: new Date().toISOString(),
      writesPerformed: false,
    });
    result.telemetry = {
      durationMs: elapsed,
      sourceCount: agents.reduce(
        (sum, agent) => sum + agent.evidence.length,
        0,
      ),
      findingCount: agents.reduce(
        (sum, agent) => sum + agent.findings.length,
        0,
      ),
      writesPerformed: false,
    };
    await query(
      `UPDATE customer_intelligence_jobs SET status = 'completed', result_json = ?, error_message = NULL, updated_at = NOW(3), finished_at = NOW(3) WHERE id = ?`,
      [JSON.stringify(result), Number(jobId)],
    );
    return {
      ...mapJobRow({
        ...job,
        status: "completed",
        result_json: JSON.stringify(result),
      }),
      result,
    };
  } catch (error) {
    await query(
      `UPDATE customer_intelligence_jobs SET status = 'failed', error_message = ?, updated_at = NOW(3), finished_at = NOW(3) WHERE id = ?`,
      [
        clip(
          error?.message ||
            "No fue posible ejecutar los agentes especializados",
          1000,
        ),
        Number(jobId),
      ],
    ).catch(() => undefined);
    return null;
  }
}

export async function getAccountIntelligenceMetrics({ user }) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT status, job_type, COUNT(*) AS total
     FROM customer_intelligence_jobs
     WHERE requested_by_user_id = ? AND created_at >= DATE_SUB(NOW(3), INTERVAL 30 DAY)
     GROUP BY status, job_type`,
    [Number(user.id)],
  );
  const usageRows = await query(
    `SELECT COUNT(*) AS requests, COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(cost_micros), 0) AS costMicros
     FROM ai_usage_ledger
     WHERE user_id = ? AND feature_code LIKE 'commercial_intelligence.%'
       AND created_at_utc >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)`,
    [Number(user.id)],
  ).catch(() => []);
  return {
    periodDays: 30,
    jobs: rows.map((row) => ({
      status: row.status,
      jobType: row.job_type,
      total: Number(row.total || 0),
    })),
    aiUsage: {
      requests: Number(usageRows[0]?.requests || 0),
      tokens: Number(usageRows[0]?.tokens || 0),
      costMicros: Number(usageRows[0]?.costMicros || 0),
    },
  };
}

async function insertCustomerAccountChatSession({ user, snapshot }) {
  const publicId = `cacs_${randomUUID()}`;
  const initialConversationContext = validateCustomerConversationContext(
    buildCustomerConversationContext({
      accountId: snapshot.account?.id,
      effectiveContext: {
        accountId: snapshot.account?.id,
        opportunityId: snapshot.selectedOpportunity?.id,
        contactId: snapshot.selectedContact?.id,
      },
    }),
    snapshot,
    snapshot.account?.id,
  );
  const result = await query(
    `INSERT INTO customer_intelligence_chat_sessions
      (public_id, requested_by_user_id, account_id, opportunity_id, contact_id,
       history_json, context_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
    [
      publicId,
      Number(user.id),
      snapshot.account?.id || null,
      snapshot.selectedOpportunity?.id || null,
      snapshot.selectedContact?.id || null,
      JSON.stringify([]),
      JSON.stringify(initialConversationContext),
    ],
  );
  return {
    id: Number(result.insertId),
    publicId,
    accountId: snapshot.account?.id || null,
    opportunityId: snapshot.selectedOpportunity?.id || null,
    contactId: snapshot.selectedContact?.id || null,
  };
}

export async function createCustomerAccountChatSession({ user, payload }) {
  await ensureCommercialIntelligenceSchema();
  const snapshot = await buildAuthorizedCustomerSnapshot({ user, ...payload });
  return {
    session: await insertCustomerAccountChatSession({ user, snapshot }),
  };
}

export async function getCustomerAccountChatSession({ user, sessionId }) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT id, public_id, account_id, opportunity_id, contact_id, history_json,
            created_at, updated_at
     FROM customer_intelligence_chat_sessions
     WHERE id = ? AND requested_by_user_id = ? LIMIT 1`,
    [Number(sessionId), Number(user.id)],
  );
  const row = rows[0];
  if (!row) return null;
  const history = parseJson(row.history_json, []);
  return {
    id: Number(row.id),
    publicId: row.public_id,
    accountId: row.account_id === null ? null : Number(row.account_id),
    opportunityId:
      row.opportunity_id === null ? null : Number(row.opportunity_id),
    contactId: row.contact_id === null ? null : Number(row.contact_id),
    history: Array.isArray(history) ? history.slice(-8) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCustomerAccountChatDiagnostics({
  queryText = "",
  status = "all",
  accountId = null,
  dateFrom = "",
  dateTo = "",
  page = 1,
  pageSize = 25,
}) {
  await ensureCommercialIntelligenceSchema();
  const safePage = Math.max(1, Math.trunc(Number(page) || 1));
  const safePageSize = Math.min(
    100,
    Math.max(1, Math.trunc(Number(pageSize) || 25)),
  );
  const offset = (safePage - 1) * safePageSize;
  const search = String(queryText || "")
    .trim()
    .slice(0, 160);
  const params = [];
  const filters = [];
  if (search) {
    const like = `%${search}%`;
    filters.push(
      `(CAST(s.id AS CHAR) = ? OR EXISTS (
         SELECT 1 FROM customer_intelligence_jobs searched_job
         WHERE searched_job.job_type = 'account_chat'
           AND searched_job.requested_by_user_id = s.requested_by_user_id
           AND CAST(JSON_UNQUOTE(JSON_EXTRACT(searched_job.request_json, '$.chatSessionId')) AS UNSIGNED) = s.id
           AND CAST(searched_job.id AS CHAR) = ?
       ) OR u.full_name LIKE ? OR u.email LIKE ? OR COALESCE(a.name, '') LIKE ?)`,
    );
    params.push(search, search, like, like, like);
  }
  const safeAccountId = Number(accountId || 0);
  if (Number.isInteger(safeAccountId) && safeAccountId > 0) {
    filters.push("s.account_id = ?");
    params.push(safeAccountId);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateFrom || ""))) {
    filters.push("DATE(s.created_at) >= ?");
    params.push(dateFrom);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateTo || ""))) {
    filters.push("DATE(s.created_at) <= ?");
    params.push(dateTo);
  }
  if (status === "errors") {
    filters.push(
      `EXISTS (
         SELECT 1 FROM customer_intelligence_jobs filtered_job
         WHERE filtered_job.job_type = 'account_chat'
           AND filtered_job.requested_by_user_id = s.requested_by_user_id
           AND CAST(JSON_UNQUOTE(JSON_EXTRACT(filtered_job.request_json, '$.chatSessionId')) AS UNSIGNED) = s.id
           AND (filtered_job.status = 'failed' OR JSON_UNQUOTE(JSON_EXTRACT(filtered_job.result_json, '$.responseType')) = 'error')
       )`,
    );
  } else if (status === "active") {
    filters.push(
      `EXISTS (
         SELECT 1 FROM customer_intelligence_jobs filtered_job
         WHERE filtered_job.job_type = 'account_chat'
           AND filtered_job.requested_by_user_id = s.requested_by_user_id
           AND CAST(JSON_UNQUOTE(JSON_EXTRACT(filtered_job.request_json, '$.chatSessionId')) AS UNSIGNED) = s.id
           AND filtered_job.status IN ('pending', 'processing')
       )`,
    );
  }
  const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const latestJobJoin = `LEFT JOIN customer_intelligence_jobs j
    ON j.id = (
      SELECT MAX(j2.id)
      FROM customer_intelligence_jobs j2
      WHERE j2.job_type = 'account_chat'
        AND j2.requested_by_user_id = s.requested_by_user_id
        AND CAST(JSON_UNQUOTE(JSON_EXTRACT(j2.request_json, '$.chatSessionId')) AS UNSIGNED) = s.id
    )`;
  const countRows = await query(
    `SELECT COUNT(*) AS total
     FROM customer_intelligence_chat_sessions s
     INNER JOIN users u ON u.id = s.requested_by_user_id
     LEFT JOIN accounts a ON a.id = s.account_id
     ${latestJobJoin}
     ${whereSql}`,
    params,
  );
  const rows = await query(
    `SELECT s.id AS session_id, s.public_id AS session_public_id,
            s.account_id, a.name AS account_name,
            s.requested_by_user_id AS user_id, u.full_name AS user_name,
            u.email AS user_email, s.created_at AS session_created_at,
            s.updated_at AS session_updated_at, j.id AS job_id,
            j.status AS job_status, j.created_at AS job_created_at,
            j.finished_at AS job_finished_at,
            JSON_UNQUOTE(JSON_EXTRACT(j.request_json, '$.question')) AS question,
            JSON_UNQUOTE(JSON_EXTRACT(j.result_json, '$.responseType')) AS response_type,
            JSON_UNQUOTE(JSON_EXTRACT(j.result_json, '$.answer')) AS answer,
            JSON_UNQUOTE(JSON_EXTRACT(j.result_json, '$.debug.issue.title')) AS issue_title,
            JSON_UNQUOTE(JSON_EXTRACT(j.result_json, '$.debug.issue.block')) AS issue_block
     FROM customer_intelligence_chat_sessions s
     INNER JOIN users u ON u.id = s.requested_by_user_id
     LEFT JOIN accounts a ON a.id = s.account_id
     ${latestJobJoin}
     ${whereSql}
     ORDER BY COALESCE(j.created_at, s.updated_at) DESC, s.id DESC
     LIMIT ? OFFSET ?`,
    [...params, safePageSize, offset],
  );
  return {
    page: safePage,
    pageSize: safePageSize,
    total: Number(countRows[0]?.total || 0),
    sessions: rows.map((row) => ({
      sessionId: Number(row.session_id),
      sessionPublicId: row.session_public_id,
      accountId: row.account_id === null ? null : Number(row.account_id),
      accountName: row.account_name || "",
      userId: Number(row.user_id),
      userName: row.user_name || "",
      userEmail: row.user_email || "",
      sessionCreatedAt: row.session_created_at,
      sessionUpdatedAt: row.session_updated_at,
      latestJob: row.job_id
        ? {
            jobId: Number(row.job_id),
            status: row.job_status,
            createdAt: row.job_created_at,
            finishedAt: row.job_finished_at,
            question: row.question || "",
            responseType: row.response_type || null,
            answer: row.answer || "",
            issueTitle: row.issue_title || null,
            issueBlock: row.issue_block || null,
          }
        : null,
    })),
  };
}

export async function getCustomerAccountChatDiagnosticSession({
  sessionId,
  jobId,
}) {
  await ensureCommercialIntelligenceSchema();
  let resolvedSessionId = Number(sessionId || 0);
  let selectedJobId = Number(jobId || 0);
  if (!resolvedSessionId && selectedJobId > 0) {
    const jobRows = await query(
      `SELECT id, request_json
       FROM customer_intelligence_jobs
       WHERE id = ? AND job_type = 'account_chat'
       LIMIT 1`,
      [selectedJobId],
    );
    const jobRow = jobRows[0];
    if (!jobRow) return null;
    const request = parseJson(jobRow.request_json, {});
    resolvedSessionId = Number(request.chatSessionId || 0);
  }
  if (!Number.isInteger(resolvedSessionId) || resolvedSessionId <= 0)
    return null;
  const sessionRows = await query(
    `SELECT s.id, s.public_id, s.account_id, s.opportunity_id, s.contact_id,
            s.history_json, s.created_at, s.updated_at,
            u.id AS user_id, u.full_name AS user_name, u.email AS user_email,
            a.name AS account_name
     FROM customer_intelligence_chat_sessions s
     INNER JOIN users u ON u.id = s.requested_by_user_id
     LEFT JOIN accounts a ON a.id = s.account_id
     WHERE s.id = ?
     LIMIT 1`,
    [resolvedSessionId],
  );
  const session = sessionRows[0];
  if (!session) return null;
  const jobRows = await query(
    `SELECT id, status, request_json, result_json, error_message,
            created_at, finished_at
     FROM customer_intelligence_jobs
     WHERE job_type = 'account_chat'
       AND requested_by_user_id = ?
       AND CAST(JSON_UNQUOTE(JSON_EXTRACT(request_json, '$.chatSessionId')) AS UNSIGNED) = ?
       AND (id = ? OR id IN (
         SELECT recent_job.id
         FROM (
           SELECT id
           FROM customer_intelligence_jobs
           WHERE job_type = 'account_chat'
             AND requested_by_user_id = ?
             AND CAST(JSON_UNQUOTE(JSON_EXTRACT(request_json, '$.chatSessionId')) AS UNSIGNED) = ?
           ORDER BY id DESC
           LIMIT 40
         ) recent_job
       ))
     ORDER BY (id = ?) DESC, id DESC
     LIMIT 40`,
    [
      Number(session.user_id),
      resolvedSessionId,
      selectedJobId,
      Number(session.user_id),
      resolvedSessionId,
      selectedJobId,
    ],
  );
  const history = parseJson(session.history_json, []);
  return {
    session: {
      id: Number(session.id),
      publicId: session.public_id,
      accountId:
        session.account_id === null ? null : Number(session.account_id),
      accountName: session.account_name || "",
      opportunityId:
        session.opportunity_id === null ? null : Number(session.opportunity_id),
      contactId:
        session.contact_id === null ? null : Number(session.contact_id),
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      user: {
        id: Number(session.user_id),
        name: session.user_name || "",
        email: session.user_email || "",
      },
      history: Array.isArray(history) ? history.slice(-80) : [],
      jobs: jobRows.map((row) => {
        const request = parseJson(row.request_json, {});
        const result = parseJson(row.result_json, {});
        return {
          id: Number(row.id),
          status: row.status,
          createdAt: row.created_at,
          finishedAt: row.finished_at,
          question: String(request.question || ""),
          errorMessage: row.error_message || null,
          response: {
            answer: String(result.answer || ""),
            responseType: result.responseType || null,
            entities: result.entities || {},
          },
          debug: result.debug || null,
        };
      }),
      selectedJobId: selectedJobId || null,
    },
  };
}

export async function createCustomerAccountChatJob({ user, payload }) {
  await ensureCommercialIntelligenceSchema();
  if (payload.includePublicResearch) {
    if (!hasPermission(user, "fuentes_externas.execute"))
      throw createHttpError(403, "No autorizado", {
        requiredPermission: "fuentes_externas.execute",
      });
    await assertExternalResearchGovernance(user);
  }
  const snapshot = await buildAuthorizedCustomerSnapshot({ user, ...payload });
  let chatSession;
  const requestedChatSessionId = Number(payload.chatSessionId || 0);
  if (requestedChatSessionId > 0) {
    const sessionRows = await query(
      `SELECT id, account_id, opportunity_id, contact_id, context_json
       FROM customer_intelligence_chat_sessions
       WHERE id = ? AND requested_by_user_id = ? LIMIT 1`,
      [requestedChatSessionId, Number(user.id)],
    );
    const session = sessionRows[0];
    if (!session) {
      throw createHttpError(404, "Sesion de chat de cuenta no encontrada");
    }
    const sameContext =
      Number(session.account_id || 0) === Number(snapshot.account?.id || 0) &&
      Number(session.opportunity_id || 0) ===
        Number(snapshot.selectedOpportunity?.id || 0) &&
      Number(session.contact_id || 0) ===
        Number(snapshot.selectedContact?.id || 0);
    if (!sameContext) {
      throw createHttpError(
        409,
        "La sesion de chat pertenece a otro contexto de cliente",
      );
    }
    const conversationContext = validateCustomerConversationContext(
      parseJson(session.context_json, null),
      snapshot,
      snapshot.account?.id,
    );
    chatSession = { id: Number(session.id) };
    payload = { ...payload, conversationContext };
  } else {
    chatSession = await insertCustomerAccountChatSession({ user, snapshot });
  }
  const result = await query(
    `INSERT INTO customer_intelligence_jobs (public_id, account_id, opportunity_id, contact_id, requested_by_user_id, job_type, status, request_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'account_chat', 'pending', ?, NOW(3), NOW(3))`,
    [
      `cac_${randomUUID()}`,
      snapshot.account?.id || null,
      snapshot.selectedOpportunity?.id || null,
      snapshot.selectedContact?.id || null,
      Number(user.id),
      JSON.stringify({
        ...payload,
        chatSessionId: chatSession.id,
        question: payload.question,
      }),
    ],
  );
  return {
    job: {
      id: Number(result.insertId),
      chatSessionId: chatSession.id,
      status: "pending",
      pollAfterMs: 700,
    },
    snapshot,
  };
}

export async function processCustomerAccountChatJob({ jobId, user }) {
  const executionTrace = createTurnExecutionTrace({
    enabled: config.nodeEnv !== "production",
  });
  const workerSpanId = `account-chat-worker-${Number(jobId)}`;
  const workerStartedAt = Date.now();
  executionTrace.record({
    spanId: workerSpanId,
    lane: "worker",
    from: "B2",
    to: "B3",
    label: "Despachar job al worker",
    phase: "call",
    status: "started",
    input: { jobId: Number(jobId) },
  });
  const rows = await query(
    `SELECT * FROM customer_intelligence_jobs WHERE id = ? AND requested_by_user_id = ? AND job_type = 'account_chat' LIMIT 1`,
    [Number(jobId), Number(user.id)],
  );
  const job = rows[0];
  if (!job) return null;
  let request;
  let snapshot;
  let agents;
  let conversationHistory;
  let persistedConversationHistory;
  let conversationContext;
  let continuationContext;
  let activityHistoryRange = null;
  let nextConversationContext = null;
  let conversationContextUpdated = false;
  let preparationStage = "request";
  const turnStartedAt = Date.now();
  try {
    request = parseJson(job.request_json, {});
    preparationStage = "history";
    const sessionRows = await query(
      `SELECT history_json, context_json FROM customer_intelligence_chat_sessions
       WHERE id = ? AND requested_by_user_id = ?
         AND account_id <=> ? AND opportunity_id <=> ? AND contact_id <=> ?
       LIMIT 1`,
      [
        Number(request.chatSessionId || 0),
        Number(user.id),
        job.account_id,
        job.opportunity_id,
        job.contact_id,
      ],
    );
    if (!sessionRows.length) {
      throw createHttpError(404, "Sesion de chat de cuenta no encontrada");
    }
    persistedConversationHistory = parseJson(sessionRows[0].history_json, []);
    conversationHistory = (
      Array.isArray(persistedConversationHistory)
        ? persistedConversationHistory
        : []
    ).map((message) => ({
      role: message.role,
      text: message.text,
      ...(message.activityHistory
        ? { activityHistory: message.activityHistory }
        : {}),
    }));
    const persistedConversationContext = parseJson(
      sessionRows[0].context_json,
      null,
    );
    activityHistoryRange = getCustomerActivityHistoryRange(request.question);
    const includeContactHistory =
      isCustomerContactHistoryQuestion(request.question) ||
      Boolean(
        persistedConversationContext?.intents?.includes("contact_history"),
      );
    preparationStage = "snapshot";
    snapshot = await executionTrace.span(
      {
        from: "B3",
        to: "snapshot",
        label: "Autorizar contexto y construir snapshot",
        parentSpanId: workerSpanId,
        input: {
          accountId: Number(job.account_id || 0) || null,
          opportunityId: Number(job.opportunity_id || 0) || null,
          contactId: Number(job.contact_id || 0) || null,
        },
      },
      () =>
        buildAuthorizedCustomerSnapshot({
          user,
          accountId: job.account_id,
          opportunityId: job.opportunity_id,
          contactId: job.contact_id,
          activityHistoryStartDate: activityHistoryRange?.startDate || null,
          activityHistoryEndDate: activityHistoryRange?.endDate || null,
          includeContactHistory,
          includeProviderCatalog: shouldLoadProviderCatalogForQuestion(
            request.question,
          ),
        }),
      (value) => ({
        accountId: value.account?.id || null,
        snapshotMetrics: getCustomerSnapshotQueryMetrics(value),
      }),
    );
    conversationContext = validateCustomerConversationContext(
      persistedConversationContext,
      snapshot,
      job.account_id,
    );
    nextConversationContext = conversationContext;
    continuationContext = conversationContext;
    preparationStage = "agents";
    agents = await executionTrace.span(
      {
        from: "B3",
        to: "agents",
        label: "Preparar agentes de inteligencia",
        parentSpanId: workerSpanId,
        input: {
          includePublicResearch: Boolean(request.includePublicResearch),
          accountId: snapshot.account?.id || null,
        },
      },
      () =>
        runAccountIntelligenceAgents(snapshot, {
          includePublicResearch: Boolean(request.includePublicResearch),
          user,
          jobId,
        }),
      (value) =>
        (Array.isArray(value) ? value : []).map((agent) => ({
          agentId: agent.agentId,
          status: agent.status,
          evidenceCount: Array.isArray(agent.evidence)
            ? agent.evidence.length
            : 0,
        })),
    );
  } catch (error) {
    await recordCoachTurnQualityTrace({
      channel: "customer_account",
      process: "account_chat",
      userId: user.id,
      sessionId: request?.chatSessionId,
      jobId,
      trace: {
        intentType: "preparation_error",
        intentSubtype: preparationStage,
        primaryEntity: Number(job.account_id || 0) ? "account" : "none",
        entityResolution: {
          resolvedEntityIds: {
            accountId: Number(job.account_id || 0) || null,
            opportunityId: Number(job.opportunity_id || 0) || null,
            contactId: Number(job.contact_id || 0) || null,
          },
        },
        appliedRules: {
          channel: "customer_account",
          process: "account_chat",
          accountScoped: true,
        },
        validationStatus: "error",
        validationReasons: ["chat_preparation_failed"],
        responseType: "error",
        confidence: "low",
        evidenceCount: 0,
        toolsUsed: [],
        toolMetrics: [],
        diagnostics: {
          fallback: { used: false, reasonCode: null },
          failureStage: preparationStage,
          agentMetrics: [],
          snapshotMetrics: Array.isArray(error?.customerSnapshotQueryMetrics)
            ? error.customerSnapshotQueryMetrics
            : [],
        },
        operationsProposed: 0,
        operationsRejected: 0,
        latencyMs: Math.max(0, Date.now() - turnStartedAt),
        errorCode: "chat_preparation_failed",
      },
    }).catch(() => undefined);
    executionTrace.record({
      spanId: workerSpanId,
      lane: "worker",
      from: "B3",
      to: "B2",
      label: "Retornar fallo de preparación",
      phase: "return",
      status: "failed",
      durationMs: Math.max(0, Date.now() - workerStartedAt),
      errorCode: String(
        error?.code || error?.name || "chat_preparation_failed",
      ).slice(0, 80),
    });
    const preparationError = clip(
      error?.message || "No fue posible preparar el chat de cuenta",
      1000,
    );
    const preparationDebug = {
      architecture: "account_chat_v1",
      issue: {
        severity: "error",
        title: "Falló la preparación del turno",
        block: "B3",
        message: preparationError,
        nextAction: `Revisa la etapa ${preparationStage} y el span fallido de B3.`,
      },
      flow: [],
      flowEdges: [],
      executionTrace: executionTrace.snapshot(),
      currentTurn: {
        jobId: Number(jobId),
        chatSessionId: Number(request?.chatSessionId || 0) || null,
        accountId: Number(job.account_id || 0) || null,
        questionLength: String(request?.question || "").length,
        diagnostics: { failureStage: preparationStage },
      },
      nextTurn: null,
    };
    await query(
      `UPDATE customer_intelligence_jobs
       SET status = 'failed', error_message = ?, result_json = ?,
           updated_at = NOW(3), finished_at = NOW(3)
       WHERE id = ?`,
      [
        preparationError,
        JSON.stringify({ debug: preparationDebug }),
        Number(jobId),
      ],
    ).catch(() => undefined);
    return null;
  }
  const adapter = createCustomerAccountAdapter({
    user,
    snapshot: {
      ...snapshot,
      selectedOpportunity:
        snapshot.selectedOpportunity ||
        (continuationContext?.opportunityId
          ? [
              ...(snapshot.opportunities || []),
              ...(snapshot.inactiveOpportunities || []),
            ].find(
              (item) => Number(item.id) === continuationContext.opportunityId,
            ) || null
          : null),
      selectedContact:
        snapshot.selectedContact ||
        (continuationContext?.contactId
          ? (snapshot.contacts || []).find(
              (item) => Number(item.id) === continuationContext.contactId,
            ) || null
          : null),
    },
    conversationContext: continuationContext,
    snapshotQueryMetrics: getCustomerSnapshotQueryMetrics(snapshot),
    agents,
    jobId,
    executionTrace,
    traceParentSpanId: workerSpanId,
  });
  let response;
  let qualityTrace;
  let engineResult;
  try {
    engineResult = await executionTrace.span(
      {
        from: "B3",
        to: "B4",
        label: "Delegar turno al adaptador",
        parentSpanId: workerSpanId,
        input: {
          channel: "customer_account",
          accountId: snapshot.account?.id || null,
          historyMessageCount: conversationHistory.length,
          questionLength: String(request.question || "").length,
          agentCount: agents.length,
          validatedConversationContext: {
            version: continuationContext?.version || null,
            accountId: continuationContext?.accountId || null,
            opportunityId: continuationContext?.opportunityId || null,
            contactId: continuationContext?.contactId || null,
            intents: continuationContext?.intents || [],
            filterNames: Object.keys(continuationContext?.filters || {}),
          },
        },
      },
      ({ spanId }) =>
        adapter.runTurn({
          question: request.question,
          history: conversationHistory,
          context: {
            accountId: snapshot.account?.id || null,
            opportunityId:
              Number(job.opportunity_id || 0) ||
              snapshot.selectedOpportunity?.id ||
              null,
            contactId:
              Number(job.contact_id || 0) ||
              snapshot.selectedContact?.id ||
              null,
            leadId: null,
          },
          conversationContext: continuationContext,
          traceParentSpanId: spanId,
        }),
      (value) => ({
        channel: "customer_account",
        responseType: value.response?.responseType || null,
        answerLength: String(value.response?.answer || "").length,
        toolCount: value.qualityTrace?.toolsUsed?.length || 0,
      }),
    );
    response = engineResult.response;
    qualityTrace = engineResult.qualityTrace;
    response = {
      ...response,
      entities: sanitizeCustomerResponseEntities(
        response,
        snapshot,
        qualityTrace?.toolsUsed || [],
      ),
    };
    if (
      response?.responseType !== "error" &&
      response?.responseType !== "clarification" &&
      !response?.clarification
    ) {
      const currentRange = getCustomerActivityHistoryRange(request.question);
      const routing = engineResult.channelIntentRouting;
      const routingFilters = routing?.filters || {};
      const inheritsConversationFilters = [
        "conversation_history",
        "active_context",
      ].includes(routing?.referenceResolution?.source);
      const filters = {
        ...(inheritsConversationFilters
          ? conversationContext?.filters || {}
          : {}),
        ...routingFilters,
      };
      const resolvedRange =
        currentRange ||
        (inheritsConversationFilters
          ? getCustomerActivityHistoryRangeFromFilters(filters)
          : null);
      if (resolvedRange) {
        filters.startDate = resolvedRange.startDate;
        filters.endDate = resolvedRange.endDate;
        if (resolvedRange.months) filters.periodMonths = resolvedRange.months;
      }
      nextConversationContext = validateCustomerConversationContext(
        buildCustomerConversationContext({
          accountId: snapshot.account?.id,
          effectiveContext: response.entities || {},
          routing: {
            ...routing,
            filters,
          },
        }),
        snapshot,
        snapshot.account?.id,
      );
      conversationContextUpdated = true;
    }
  } catch (error) {
    console.error("[account-chat] Adapter execution failed", {
      jobId: Number(jobId),
      errorName: String(error?.name || "Error").slice(0, 80),
      errorCode: String(error?.code || "").slice(0, 80) || null,
      errorMessage: String(error?.message || "").slice(0, 500),
      stack: String(error?.stack || "")
        .split("\n")
        .slice(0, 8)
        .join("\n")
        .slice(0, 2500),
    });
    response = buildCustomerEvidenceFailureResponse({
      status: "adapter_execution_error",
      errorCode: "adapter_execution_failed",
    });
    qualityTrace = {
      process: "account_chat",
      validationStatus: "error",
      validationReasons: ["adapter_execution_failed"],
      errorCode: "adapter_execution_failed",
      toolMetrics: [],
      diagnostics: {
        fallback: {
          used: true,
          reasonCode: "adapter_execution_failed",
        },
        failureStage: "adapter",
        agentMetrics: [],
      },
    };
  }
  response = {
    ...response,
    entities: sanitizeCustomerResponseEntities(
      response,
      snapshot,
      qualityTrace?.toolsUsed || [],
    ),
  };
  const agentMetrics = (Array.isArray(agents) ? agents : [])
    .slice(0, 20)
    .map((agent) => ({
      agentId: agent.agentId,
      status: agent.status,
      evidenceCount: Array.isArray(agent.evidence) ? agent.evidence.length : 0,
      errorCode: agent.status === "failed" ? "tool_error" : null,
    }));
  qualityTrace = {
    ...qualityTrace,
    diagnostics: {
      ...qualityTrace?.diagnostics,
      agentMetrics,
      snapshotMetrics: getCustomerSnapshotQueryMetrics(snapshot),
    },
  };
  const publicSources =
    agents.find((agent) => agent.agentId === "public_research")?.evidence || [];
  const truncatedSnapshotSources = getCustomerSnapshotQueryMetrics(snapshot)
    .filter((metric) => metric.truncated === true)
    .map((metric) => metric.source)
    .slice(0, 20);
  const unqueriedAuthorizedTools = Array.isArray(
    qualityTrace?.diagnostics?.evidence?.unqueriedAuthorizedTools,
  )
    ? qualityTrace.diagnostics.evidence.unqueriedAuthorizedTools
        .map((toolName) => String(toolName || "").slice(0, 80))
        .filter(Boolean)
        .slice(0, 20)
    : [];
  const partialResultSources = [
    ...truncatedSnapshotSources,
    ...unqueriedAuthorizedTools.map((toolName) => `consulta:${toolName}`),
  ];
  const partialResultsWarning = partialResultSources.length
    ? ` La verificación alcanzó límites de consulta (${partialResultSources.join(", ")}); los resultados pueden estar incompletos.`
    : "";
  response = {
    ...response,
    entities: sanitizeCustomerResponseEntities(
      response,
      snapshot,
      qualityTrace?.toolsUsed || [],
    ),
    partialResults: {
      isPartial: partialResultSources.length > 0,
      sources: partialResultSources,
    },
    answer:
      partialResultsWarning &&
      response.responseType !== "error" &&
      response.responseType !== "clarification"
        ? `${String(response.answer || "")}${partialResultsWarning}`
        : response.answer,
    sourceDomain: publicSources.length ? "mixed" : "crm_internal",
    inferences: Array.isArray(response.inferences)
      ? response.inferences
          .map((item) => clip(item, 1200))
          .filter(Boolean)
          .slice(0, 8)
      : [],
    agents: agents.map((agent) => ({
      agentId: agent.agentId,
      status: agent.status,
      summary: agent.summary,
      sourceDomain: agent.sourceDomain,
      confidence: agent.confidence,
      evidence: agent.evidence,
    })),
    publicSources,
  };
  const qualityTraceId = await recordCoachTurnQualityTrace({
    channel: "customer_account",
    process: qualityTrace?.process || "account_chat",
    userId: user.id,
    sessionId: request.chatSessionId,
    jobId,
    trace: qualityTrace,
  }).catch((error) => {
    console.warn(
      "[mi-agent] No fue posible registrar traza de Cliente existente:",
      error?.message || error,
    );
    return null;
  });
  if (qualityTraceId) response.qualityTraceId = qualityTraceId;
  const persistenceSpanId = `account-chat-persist-${Number(jobId)}`;
  const persistenceStartedAt = Date.now();
  executionTrace.record({
    spanId: persistenceSpanId,
    parentSpanId: workerSpanId,
    lane: "worker",
    from: "B3",
    to: "B11",
    label: "Persistir resultado e historial",
    phase: "call",
    status: "started",
    input: {
      jobId: Number(jobId),
      chatSessionId: Number(request.chatSessionId || 0),
      answerLength: String(response.answer || "").length,
    },
  });
  let persistedHistoryForTrace = null;
  try {
    await withTransaction(async (conn) => {
      const [sessionRows] = await conn.query(
        `SELECT history_json, context_json FROM customer_intelligence_chat_sessions
       WHERE id = ? AND requested_by_user_id = ?
         AND account_id <=> ? AND opportunity_id <=> ? AND contact_id <=> ?
       LIMIT 1 FOR UPDATE`,
        [
          Number(request.chatSessionId || 0),
          Number(user.id),
          job.account_id,
          job.opportunity_id,
          job.contact_id,
        ],
      );
      if (!sessionRows.length) {
        throw createHttpError(404, "Sesion de chat de cuenta no encontrada");
      }
      const nextHistory = appendCustomerAccountChatHistory(
        persistedConversationHistory,
        request.question,
        response.answer,
        { activityHistory: response.activityHistory },
      );
      persistedHistoryForTrace = nextHistory;
      const persistedConversationContext =
        nextConversationContext || parseJson(sessionRows[0].context_json, null);
      if (config.nodeEnv !== "production") {
        const plannerDiagnostics = qualityTrace?.diagnostics?.planner || null;
        const evidenceDiagnostics = qualityTrace?.diagnostics?.evidence || null;
        const toolsUsed = Array.isArray(qualityTrace?.toolsUsed)
          ? qualityTrace.toolsUsed
          : [];
        const evidenceStatus = evidenceDiagnostics?.status || null;
        const fallbackUsed = Boolean(qualityTrace?.diagnostics?.fallback?.used);
        const plannerReturnEvent = executionTrace.events.find(
          (event) =>
            event.label === "Solicitar plan estructurado" &&
            event.phase === "return",
        );
        const routingValidationEvent = executionTrace.events.find(
          (event) =>
            event.label === "Validar routing y aplicar políticas" &&
            event.phase === "return",
        );
        const engineInputSummary = {
          channel: adapter.channel,
          jobId: Number(jobId),
          questionLength: String(request.question || "").length,
          historyMessageCount: conversationHistory.length,
          context: {
            accountId: snapshot.account?.id || null,
            opportunityId:
              Number(job.opportunity_id || 0) ||
              snapshot.selectedOpportunity?.id ||
              null,
            contactId:
              Number(job.contact_id || 0) ||
              snapshot.selectedContact?.id ||
              null,
            leadId: null,
          },
          conversationContext: {
            version: continuationContext?.version ?? null,
            accountId: continuationContext?.accountId ?? null,
            opportunityId: continuationContext?.opportunityId ?? null,
            contactId: continuationContext?.contactId ?? null,
            intents: continuationContext?.intents || [],
            filters: continuationContext?.filters || {},
          },
          toolCatalog: adapter.availableTools.map((tool) => tool.name),
          permissionCount: adapter.permissions.size,
          policy: {
            channelRules: adapter.channelRules,
            operationPolicy: adapter.operationPolicy,
            businessRuleScope: qualityTrace?.appliedRules?.scope || {},
          },
        };
        let issue;
        if (response.responseType === "error") {
          issue = {
            severity: "error",
            title: "El turno no pudo completarse",
            block: [
              "query_error",
              "query_limit_reached",
              "insufficient_evidence",
              "timeout",
            ].includes(evidenceStatus)
              ? "B9"
              : "B10",
            message: response.answer,
            nextAction:
              evidenceStatus && evidenceStatus !== "sufficient"
                ? "Revisa el estado de evidencia, las consultas fallidas y los límites en el bloque B9."
                : "Revisa el error de generación o auditoría de respuesta en el bloque B10.",
          };
        } else if (
          evidenceStatus &&
          !["sufficient", "no_results", "clarification"].includes(
            evidenceStatus,
          )
        ) {
          issue = {
            severity: "error",
            title: "La evidencia no quedó verificada",
            block: "B9",
            message: `El verificador terminó con estado: ${evidenceStatus}.`,
            nextAction:
              "Revisa consultas fallidas, hechos pendientes, truncamientos y herramientas no ejecutadas.",
          };
        } else if (response.responseType === "clarification") {
          issue = {
            severity: "warning",
            title: "El chat necesita una precisión para continuar",
            block: response.channelIntentRouting?.requiresClarification
              ? "B6"
              : "B10",
            message:
              response.clarification?.message ||
              response.answer ||
              "La solicitud necesita más contexto.",
            nextAction:
              "Revisa la ambigüedad o el dato faltante y responde con una referencia más específica.",
          };
        } else if (evidenceStatus === "no_results") {
          issue = {
            severity: "warning",
            title: "La consulta se ejecutó, pero no encontró coincidencias",
            block: "B9",
            message:
              "Esto no demuestra que el registro nunca haya existido; indica que no hubo resultados con los filtros consultados.",
            nextAction:
              "Comprueba filtros, cuenta seleccionada y alcance de las herramientas en B6–B8.",
          };
        } else if (
          fallbackUsed ||
          qualityTrace?.diagnostics?.planner?.fallbackUsed
        ) {
          issue = {
            severity: "warning",
            title: "El turno usó una ruta alternativa",
            block: "B6",
            message:
              "La interpretación principal no se utilizó o no estuvo disponible.",
            nextAction:
              "Revisa el plan, la intención elegida y el motivo del fallback en B6.",
          };
        } else {
          issue = {
            severity: "success",
            title: "El turno terminó sin señales de error",
            block: null,
            message:
              "La respuesta y el contexto para continuar quedaron guardados.",
            nextAction: "No hay un bloque que requiera revisión.",
          };
        }
        response.debug = {
          architecture: "account_chat_v1",
          executionTrace: executionTrace.snapshot(),
          issue,
          flow: [
            {
              block: "B1",
              label: "Chat web",
              status: "completed",
              input: {
                accountId: Number(request.accountId || 0) || null,
                question: request.question,
              },
              output: { forwardedToApi: true },
              checks: [
                diagnosticCheck({
                  field: "question",
                  state: String(request.question || "").trim()
                    ? "pass"
                    : "error",
                  expected: "pregunta no vacía",
                  actual: String(request.question || "").length,
                  message: String(request.question || "").trim()
                    ? "La pregunta llegó al flujo."
                    : "No llegó una pregunta para procesar.",
                }),
              ],
            },
            {
              block: "B2",
              label: "Rutas de sesión y jobs",
              status: "completed",
              input: {
                chatSessionId: Number(request.chatSessionId || 0) || null,
                questionLength: String(request.question || "").length,
              },
              output: {
                jobId: Number(jobId),
                initialStatus: "pending",
                accepted: true,
              },
              checks: [
                diagnosticCheck({
                  field: "jobId",
                  state: Number(jobId) > 0 ? "pass" : "error",
                  expected: "ID positivo",
                  actual: Number(jobId) || null,
                  message:
                    Number(jobId) > 0
                      ? "El job tiene un ID válido."
                      : "No se creó un ID válido para el job.",
                }),
                diagnosticCheck({
                  field: "chatSessionId",
                  state: Number(request.chatSessionId) > 0 ? "pass" : "error",
                  expected: "ID positivo después de crear o recuperar sesión",
                  actual: Number(request.chatSessionId) || null,
                  message:
                    Number(request.chatSessionId) > 0
                      ? "El job está asociado a una sesión."
                      : "El job debería estar asociado a una sesión.",
                }),
                diagnosticCheck({
                  field: "jobAccepted",
                  state: Number(jobId) > 0 ? "pass" : "error",
                  expected: "job aceptado para procesamiento",
                  actual: Number(jobId) > 0 ? true : null,
                  message:
                    Number(jobId) > 0
                      ? "B2 aceptó el job; pending es el estado inicial esperado mientras B1 consulta el resultado."
                      : "B2 no confirmó la creación del job.",
                }),
              ],
            },
            {
              block: "B3",
              label: "Servicio del canal",
              status: "completed",
              input: { accountId: Number(job.account_id || 0) || null },
              output: {
                validatedContext: {
                  accountId: snapshot.account?.id || null,
                  opportunityId: snapshot.selectedOpportunity?.id || null,
                  contactId: snapshot.selectedContact?.id || null,
                },
                historyMessageCount: conversationHistory.length,
                snapshotMetrics: getCustomerSnapshotQueryMetrics(snapshot),
                agentMetrics,
              },
              checks: [
                diagnosticCheck({
                  field: "accountId",
                  state:
                    Number(snapshot.account?.id || 0) > 0 &&
                    Number(snapshot.account?.id) === Number(job.account_id)
                      ? "pass"
                      : "error",
                  expected: "ID positivo que coincide con la cuenta del job",
                  actual: snapshot.account?.id || null,
                  message:
                    Number(snapshot.account?.id || 0) > 0 &&
                    Number(snapshot.account?.id) === Number(job.account_id)
                      ? "La cuenta del snapshot coincide con la cuenta autorizada del job."
                      : "La cuenta del snapshot falta o no coincide con el job.",
                }),
                ...["opportunityId", "contactId"].map((field) => {
                  const value =
                    field === "opportunityId"
                      ? snapshot.selectedOpportunity?.id
                      : snapshot.selectedContact?.id;
                  return diagnosticCheck({
                    field,
                    state: value ? "pass" : "not_applicable",
                    expected: "ID si el turno seleccionó esa entidad",
                    actual: value || null,
                    message: value
                      ? "Hay una entidad seleccionada para el contexto."
                      : "No se seleccionó esta entidad; null es válido para una consulta a nivel de cuenta.",
                  });
                }),
              ],
            },
            {
              block: "B4",
              label: "Adaptador del canal",
              status: "completed",
              input: {
                channel: adapter.channel,
                context: {
                  accountId: snapshot.account?.id || null,
                  opportunityId:
                    Number(job.opportunity_id || 0) ||
                    snapshot.selectedOpportunity?.id ||
                    null,
                  contactId:
                    Number(job.contact_id || 0) ||
                    snapshot.selectedContact?.id ||
                    null,
                },
                snapshotMetrics: getCustomerSnapshotQueryMetrics(snapshot),
                preparedAgentCount: agentMetrics.length,
              },
              output: { engineInput: engineInputSummary },
              checks: [
                diagnosticCheck({
                  field: "channel",
                  state:
                    adapter.channel === "customer_account" ? "pass" : "error",
                  expected: "customer_account",
                  actual: adapter.channel,
                  message:
                    adapter.channel === "customer_account"
                      ? "El adaptador corresponde a Cliente existente."
                      : "El adaptador no corresponde al canal solicitado.",
                }),
                diagnosticCheck({
                  field: "accountId",
                  state:
                    Number(engineInputSummary.context.accountId || 0) > 0
                      ? "pass"
                      : "error",
                  expected: "ID positivo para Cliente existente",
                  actual: engineInputSummary.context.accountId,
                  message:
                    Number(engineInputSummary.context.accountId || 0) > 0
                      ? "El adaptador pasa una cuenta al motor."
                      : "Falta la cuenta requerida para este canal.",
                }),
              ],
            },
            {
              block: "B5",
              label: "Motor conversacional",
              status: "completed",
              input: engineInputSummary,
              output: {
                responseType: response.responseType || null,
                responseTypeReceived:
                  qualityTrace?.diagnostics?.responseTypeNormalization
                    ?.received ?? null,
                responseTypeSource:
                  qualityTrace?.diagnostics?.responseTypeNormalization
                    ?.source || "missing",
                confidence: response.confidence || null,
                answerLength: String(response.answer || "").length,
                clarificationRequired: Boolean(response.clarification),
                operationCount: Array.isArray(response.operations)
                  ? response.operations.length
                  : 0,
                validationStatus: qualityTrace?.validationStatus || null,
                plannerRoutingReturned: Boolean(
                  engineResult?.channelIntentRouting,
                ),
                latencyMs: qualityTrace?.latencyMs || null,
              },
              checks: [
                diagnosticCheck({
                  field: "responseType",
                  state: !response.responseType
                    ? "error"
                    : qualityTrace?.diagnostics?.responseTypeNormalization
                          ?.source === "customer_account_default"
                      ? "warning"
                      : "pass",
                  expected: "tipo de respuesta normalizado definido",
                  actual: {
                    received:
                      qualityTrace?.diagnostics?.responseTypeNormalization
                        ?.received ?? null,
                    normalized: response.responseType || null,
                    source:
                      qualityTrace?.diagnostics?.responseTypeNormalization
                        ?.source || "missing",
                  },
                  message: !response.responseType
                    ? "El resultado final sigue sin tipo de respuesta."
                    : qualityTrace?.diagnostics?.responseTypeNormalization
                          ?.source === "customer_account_default"
                      ? "El resultado original omitió el tipo; Cliente existente aplicó el default informational."
                      : "El tipo de respuesta normalizado está definido.",
                }),
                diagnosticCheck({
                  field: "validationStatus",
                  state: ["valid", "clarification"].includes(
                    qualityTrace?.validationStatus,
                  )
                    ? "pass"
                    : qualityTrace?.validationStatus === "error" ||
                        qualityTrace?.validationStatus === "invalid"
                      ? "error"
                      : "warning",
                  expected: "valid o clarification",
                  actual: qualityTrace?.validationStatus || null,
                  message:
                    qualityTrace?.validationStatus === "clarification"
                      ? "La respuesta solicita una aclaración de forma controlada."
                      : qualityTrace?.validationStatus === "valid"
                        ? "La respuesta pasó la validación."
                        : "La respuesta requiere revisar su estado de validación.",
                }),
              ],
            },
            {
              block: "B6",
              label: "Planificador IA",
              status: plannerDiagnostics ? "completed" : "not_reached",
              input: qualityTrace?.diagnostics?.plannerInput || null,
              output: {
                diagnostics: plannerDiagnostics,
                proposedPlan:
                  plannerReturnEvent?.output?.proposedRouting || null,
                routingValidation: routingValidationEvent?.output || null,
                normalizedPlan: response.channelIntentRouting || null,
              },
              checks: [
                diagnosticCheck({
                  field: "normalizedPlan",
                  state: response.channelIntentRouting ? "pass" : "warning",
                  expected: "plan normalizado o motivo explícito de aclaración",
                  actual: response.channelIntentRouting?.intent || null,
                  message: response.channelIntentRouting
                    ? "B5 recibió y normalizó el routing del planificador."
                    : `No hay routing normalizado: ${plannerDiagnostics?.reasonCode || "revisar diagnóstico del planificador"}.`,
                }),
                diagnosticCheck({
                  field: "allowedTools",
                  state: (() => {
                    const plannedTools =
                      response.channelIntentRouting?.allowedTools || [];
                    const authorizedTools =
                      qualityTrace?.diagnostics?.plannerInput
                        ?.availableToolNames || [];
                    return plannedTools.every((tool) =>
                      authorizedTools.includes(tool),
                    )
                      ? "pass"
                      : "error";
                  })(),
                  expected:
                    "herramientas del plan incluidas en las herramientas permitidas",
                  actual: response.channelIntentRouting?.allowedTools || [],
                  message:
                    "El plan normalizado no debe ampliar el conjunto de herramientas autorizadas.",
                }),
              ],
            },
            {
              block: "B7",
              label: "Read model del canal",
              status: evidenceDiagnostics ? "completed" : "not_reached",
              input: {
                plannedTools:
                  plannerDiagnostics?.evaluation?.plannerTools || [],
                validatedRouting: response.channelIntentRouting
                  ? {
                      intents: response.channelIntentRouting.intents || [],
                      intent: response.channelIntentRouting.intent || null,
                      allowedTools:
                        response.channelIntentRouting.allowedTools || [],
                      referenceResolution: response.channelIntentRouting
                        .referenceResolution
                        ? {
                            targetType:
                              response.channelIntentRouting.referenceResolution
                                .targetType || null,
                            cardinality:
                              response.channelIntentRouting.referenceResolution
                                .cardinality || null,
                            source:
                              response.channelIntentRouting.referenceResolution
                                .source || null,
                          }
                        : null,
                      filters: Object.fromEntries(
                        Object.entries(
                          response.channelIntentRouting.filters || {},
                        ).filter(([key]) =>
                          [
                            "opportunityStatus",
                            "stageCode",
                            "closeYear",
                            "periodMonths",
                            "startDate",
                            "endDate",
                          ].includes(key),
                        ),
                      ),
                      requiresClarification: Boolean(
                        response.channelIntentRouting.requiresClarification,
                      ),
                    }
                  : null,
                policy: engineInputSummary.policy,
              },
              output: {
                availableSources: getCustomerSnapshotQueryMetrics(snapshot).map(
                  (metric) => metric.source,
                ),
              },
              checks: [
                diagnosticCheck({
                  field: "plannedTools",
                  state: evidenceDiagnostics ? "pass" : "not_checked",
                  expected:
                    "el read model continúa con el plan o detiene el flujo de forma controlada",
                  actual: plannerDiagnostics?.evaluation?.plannerTools || [],
                  message: evidenceDiagnostics
                    ? "El flujo de lectura llegó a la verificación de evidencia."
                    : "No hay evidencia de que se ejecutara una lectura del canal.",
                }),
              ],
            },
            {
              block: "B8",
              label: "Herramientas CRM autorizadas",
              status: toolsUsed.length ? "executed" : "no_reads",
              input: { toolNames: toolsUsed },
              output: { toolMetrics: qualityTrace?.toolMetrics || [] },
              checks: [
                diagnosticCheck({
                  field: "toolMetrics",
                  state: (qualityTrace?.toolMetrics || []).some(
                    (metric) => metric.errorCode,
                  )
                    ? "warning"
                    : toolsUsed.length
                      ? "pass"
                      : "not_applicable",
                  expected:
                    "métricas para lecturas ejecutadas; cero lecturas puede ser válido",
                  actual: (qualityTrace?.toolMetrics || []).length,
                  message: (qualityTrace?.toolMetrics || []).some(
                    (metric) => metric.errorCode,
                  )
                    ? "Una o más herramientas reportaron error."
                    : toolsUsed.length
                      ? "Las lecturas ejecutadas tienen métricas."
                      : "Este turno no ejecutó lecturas CRM.",
                }),
              ],
            },
            {
              block: "B9",
              label: "Verificador de evidencia",
              status: evidenceDiagnostics?.status || "not_reached",
              input: {
                toolMetrics: qualityTrace?.toolMetrics || [],
              },
              output: evidenceDiagnostics,
              checks: [
                diagnosticCheck({
                  field: "evidenceStatus",
                  state: !evidenceDiagnostics
                    ? "not_checked"
                    : ["sufficient", "no_results", "clarification"].includes(
                          evidenceDiagnostics.status,
                        )
                      ? "pass"
                      : [
                            "query_error",
                            "timeout",
                            "verification_error",
                          ].includes(evidenceDiagnostics.status)
                        ? "error"
                        : "warning",
                  expected:
                    "sufficient, no_results o clarification; fallos identificados aparte",
                  actual: evidenceDiagnostics?.status || null,
                  message: !evidenceDiagnostics
                    ? "El verificador no fue alcanzado; no se evalúa como fallo por sí solo."
                    : ["sufficient", "no_results", "clarification"].includes(
                          evidenceDiagnostics.status,
                        )
                      ? "La verificación terminó en un estado controlado."
                      : `Revisar estado de evidencia: ${evidenceDiagnostics.status}.`,
                }),
              ],
            },
            {
              block: "B10",
              label: "Respuesta final",
              status: "completed",
              input: {
                evidenceStatus: evidenceDiagnostics?.status || null,
                responseType: response.responseType || "informational",
              },
              output: {
                answer: response.answer || "",
                responseType: response.responseType || "informational",
                entities: response.entities || {},
                auditDiagnostics:
                  qualityTrace?.diagnostics?.answerAudit || null,
              },
              checks: [
                ...(qualityTrace?.diagnostics?.answerAudit
                  ? [
                      diagnosticCheck({
                        field: "answerAudit",
                        state:
                          qualityTrace.diagnostics.answerAudit.status ===
                          "supported"
                            ? "pass"
                            : qualityTrace.diagnostics.answerAudit.status ===
                                "unsupported"
                              ? "error"
                              : "warning",
                        expected: "auditoría de respuesta respaldada",
                        actual: {
                          status: qualityTrace.diagnostics.answerAudit.status,
                          unsupportedClaimCount: Array.isArray(
                            qualityTrace.diagnostics.answerAudit
                              .unsupportedClaims,
                          )
                            ? qualityTrace.diagnostics.answerAudit
                                .unsupportedClaims.length
                            : 0,
                          providerResponseId:
                            qualityTrace.diagnostics.answerAudit
                              .providerResponseId || null,
                        },
                        message:
                          qualityTrace.diagnostics.answerAudit.status ===
                          "supported"
                            ? "La auditoría respaldó la respuesta propuesta."
                            : qualityTrace.diagnostics.answerAudit.status ===
                                "unsupported"
                              ? "La auditoría marcó afirmaciones como no respaldadas; revisa el detalle de B10."
                              : "No se obtuvo un dictamen concluyente de la auditoría; revisa el detalle de B10.",
                      }),
                    ]
                  : []),
                diagnosticCheck({
                  field: "answer",
                  state: String(response.answer || "").trim()
                    ? "pass"
                    : "error",
                  expected: "texto de respuesta o aclaración no vacío",
                  actual: String(response.answer || "").length,
                  message: String(response.answer || "").trim()
                    ? "Hay contenido que mostrar al usuario."
                    : "La respuesta final está vacía.",
                }),
              ],
            },
            {
              block: "B11",
              label: "Persistencia del servicio",
              status: "completed",
              input: {
                jobId: Number(jobId),
                chatSessionId: Number(request.chatSessionId || 0),
              },
              output: {
                jobStatus: "completed",
                historyMessageCount: nextHistory.length,
                contextDisposition: conversationContextUpdated
                  ? "recomputed"
                  : "preserved",
                context: persistedConversationContext,
              },
              checks: [
                diagnosticCheck({
                  field: "persistedJobId",
                  state: Number(jobId) > 0 ? "pass" : "error",
                  expected: "ID positivo del job completado",
                  actual: Number(jobId) || null,
                  message:
                    Number(jobId) > 0
                      ? "El resultado quedó asociado al job."
                      : "No se identifica el job que debía persistirse.",
                }),
                diagnosticCheck({
                  field: "persistedSessionId",
                  state: Number(request.chatSessionId) > 0 ? "pass" : "error",
                  expected: "ID positivo de sesión",
                  actual: Number(request.chatSessionId) || null,
                  message:
                    Number(request.chatSessionId) > 0
                      ? "El historial quedó asociado a una sesión."
                      : "Falta la sesión donde debía persistirse el historial.",
                }),
              ],
            },
          ],
          flowEdges: [
            { from: "B1", to: "B2", kind: "request", label: "POST pregunta" },
            { from: "B2", to: "B3", kind: "dispatch", label: "despacha job" },
            { from: "B3", to: "B4", kind: "call", label: "prepara el canal" },
            { from: "B4", to: "B5", kind: "call", label: "invoca y espera" },
            { from: "B5", to: "B6", kind: "call", label: "solicita plan" },
            { from: "B6", to: "B5", kind: "return", label: "devuelve plan" },
            { from: "B5", to: "B7", kind: "call", label: "prepara lecturas" },
            { from: "B7", to: "B8", kind: "call", label: "ejecuta lecturas" },
            {
              from: "B8",
              to: "B7",
              kind: "return",
              label: "devuelve resultados",
            },
            {
              from: "B7",
              to: "B5",
              kind: "return",
              label: "entrega evidencia",
            },
            { from: "B5", to: "B9", kind: "call", label: "verifica evidencia" },
            {
              from: "B9",
              to: "B7",
              kind: "conditional_loop",
              label: "si falta evidencia, solicita lecturas adicionales",
            },
            {
              from: "B9",
              to: "B5",
              kind: "return",
              label: "devuelve dictamen",
            },
            { from: "B5", to: "B10", kind: "call", label: "forma respuesta" },
            {
              from: "B10",
              to: "B5",
              kind: "return",
              label: "devuelve respuesta",
            },
            {
              from: "B5",
              to: "B4",
              kind: "return",
              label: "retorna resultado",
            },
            {
              from: "B4",
              to: "B3",
              kind: "return",
              label: "retorna al servicio",
            },
            {
              from: "B3",
              to: "B11",
              kind: "persist",
              label: "guarda job e historial",
            },
            { from: "B1", to: "B2", kind: "poll", label: "GET estado del job" },
            {
              from: "B2",
              to: "B1",
              kind: "result",
              label: "entrega resultado",
            },
          ],
          currentTurn: {
            jobId: Number(jobId),
            chatSessionId: Number(request.chatSessionId || 0),
            question: request.question,
            historyReceived: conversationHistory,
            validatedContextReceived: continuationContext,
            channelIntentRouting: response.channelIntentRouting || null,
            diagnostics: {
              planner: plannerDiagnostics,
              evidence: evidenceDiagnostics,
              toolMetrics: qualityTrace?.toolMetrics || [],
              validationStatus: qualityTrace?.validationStatus || null,
              responseType: response.responseType || "informational",
              fallback: qualityTrace?.diagnostics?.fallback || null,
            },
          },
          nextTurn: {
            history: nextHistory.map((message) => ({
              role: message.role,
              text: message.text,
              ...(message.activityHistory
                ? { activityHistory: message.activityHistory }
                : {}),
            })),
            context: persistedConversationContext,
            contextDisposition: conversationContextUpdated
              ? "recomputed"
              : "preserved",
            entryBlocks: ["B1", "B2", "B3", "B4", "B5", "B6"],
          },
        };
        const latestAssistantMessage = nextHistory[nextHistory.length - 1];
        if (latestAssistantMessage?.role === "assistant") {
          latestAssistantMessage.turnDebug = response.debug;
        }
      }
      await conn.query(
        `UPDATE customer_intelligence_chat_sessions
       SET history_json = ?, context_json = ?, updated_at = NOW(3)
       WHERE id = ? AND requested_by_user_id = ?`,
        [
          JSON.stringify(nextHistory),
          JSON.stringify(persistedConversationContext),
          Number(request.chatSessionId),
          Number(user.id),
        ],
      );
      if (config.nodeEnv !== "production" && response.debug) {
        executionTrace.record({
          spanId: persistenceSpanId,
          parentSpanId: workerSpanId,
          lane: "worker",
          from: "B11",
          to: "B3",
          label: "Retorno de persistencia",
          phase: "return",
          status: "completed",
          durationMs: Math.max(0, Date.now() - persistenceStartedAt),
          output: {
            jobStatus: "completed",
            historyMessageCount: persistedHistoryForTrace?.length || 0,
          },
        });
        executionTrace.record({
          spanId: workerSpanId,
          lane: "worker",
          from: "B3",
          to: "B2",
          label: "Retornar resultado del worker",
          phase: "return",
          status: "completed",
          durationMs: Math.max(0, Date.now() - workerStartedAt),
          output: { jobStatus: "completed" },
        });
        response.debug.executionTrace = executionTrace.snapshot();
        const latestAssistantMessage =
          persistedHistoryForTrace?.[persistedHistoryForTrace.length - 1];
        if (latestAssistantMessage?.role === "assistant") {
          latestAssistantMessage.turnDebug = response.debug;
        }
        await conn.query(
          `UPDATE customer_intelligence_chat_sessions
         SET history_json = ?, updated_at = NOW(3)
         WHERE id = ? AND requested_by_user_id = ?`,
          [
            JSON.stringify(persistedHistoryForTrace),
            Number(request.chatSessionId),
            Number(user.id),
          ],
        );
      }
      await conn.query(
        `UPDATE customer_intelligence_jobs
       SET status = 'completed', result_json = ?, updated_at = NOW(3),
           finished_at = NOW(3)
       WHERE id = ? AND requested_by_user_id = ? AND job_type = 'account_chat'`,
        [JSON.stringify(response), Number(jobId), Number(user.id)],
      );
    });
  } catch (error) {
    const persistenceError = clip(
      error?.message || "No fue posible guardar el resultado del chat",
      1000,
    );
    const persistenceReturnEvent = executionTrace.events.find(
      (event) => event.spanId === persistenceSpanId && event.phase === "return",
    );
    if (persistenceReturnEvent) {
      Object.assign(persistenceReturnEvent, {
        at: new Date().toISOString(),
        status: "failed",
        durationMs: Math.max(0, Date.now() - persistenceStartedAt),
        errorCode: String(
          error?.code || error?.name || "persistence_failed",
        ).slice(0, 80),
      });
    } else {
      executionTrace.record({
        spanId: persistenceSpanId,
        parentSpanId: workerSpanId,
        lane: "worker",
        from: "B11",
        to: "B3",
        label: "Retorno de persistencia",
        phase: "return",
        status: "failed",
        durationMs: Math.max(0, Date.now() - persistenceStartedAt),
        errorCode: String(
          error?.code || error?.name || "persistence_failed",
        ).slice(0, 80),
      });
    }
    const workerReturnEvent = executionTrace.events.find(
      (event) => event.spanId === workerSpanId && event.phase === "return",
    );
    const workerErrorCode = String(
      error?.code || error?.name || "persistence_failed",
    ).slice(0, 80);
    if (workerReturnEvent) {
      Object.assign(workerReturnEvent, {
        at: new Date().toISOString(),
        label: "Retornar fallo del worker",
        status: "failed",
        durationMs: Math.max(0, Date.now() - workerStartedAt),
        errorCode: workerErrorCode,
      });
    } else {
      executionTrace.record({
        spanId: workerSpanId,
        lane: "worker",
        from: "B3",
        to: "B2",
        label: "Retornar fallo del worker",
        phase: "return",
        status: "failed",
        durationMs: Math.max(0, Date.now() - workerStartedAt),
        errorCode: workerErrorCode,
      });
    }
    const failureDebug = {
      ...(response.debug || {}),
      architecture: "account_chat_v1",
      issue: {
        severity: "error",
        title: "Falló la persistencia del turno",
        block: "B11",
        message: persistenceError,
        nextAction: "Revisa la transacción de historial y resultado del job.",
      },
      executionTrace: executionTrace.snapshot(),
      currentTurn: {
        jobId: Number(jobId),
        chatSessionId: Number(request.chatSessionId || 0) || null,
        accountId: Number(job.account_id || 0) || null,
        questionLength: String(request.question || "").length,
      },
      nextTurn: null,
    };
    await query(
      `UPDATE customer_intelligence_jobs
       SET status = 'failed', error_message = ?, result_json = ?,
           updated_at = NOW(3), finished_at = NOW(3)
       WHERE id = ? AND requested_by_user_id = ? AND job_type = 'account_chat'`,
      [
        persistenceError,
        config.nodeEnv === "production"
          ? null
          : JSON.stringify({ debug: failureDebug }),
        Number(jobId),
        Number(user.id),
      ],
    ).catch(() => undefined);
    return null;
  }
  return {
    ...mapJobRow({
      ...job,
      status: "completed",
      result_json: JSON.stringify(response),
    }),
    result: response,
  };
}

export async function createCustomerExecutiveBriefingJob({ user, payload }) {
  await ensureCommercialIntelligenceSchema();
  const snapshot = await buildAuthorizedCustomerSnapshot({ user, ...payload });
  const publicId = `ceb_${randomUUID()}`;
  const result = await query(
    `INSERT INTO customer_intelligence_jobs
      (public_id, account_id, opportunity_id, contact_id, requested_by_user_id,
       job_type, status, request_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'executive_briefing', 'pending', ?, NOW(3), NOW(3))`,
    [
      publicId,
      snapshot.account?.id || null,
      snapshot.selectedOpportunity?.id || null,
      snapshot.selectedContact?.id || null,
      Number(user.id),
      JSON.stringify({ ...payload, requestedAt: new Date().toISOString() }),
    ],
  );
  return {
    job: {
      id: Number(result.insertId),
      publicId,
      status: "pending",
      pollAfterMs: 1000,
    },
    snapshot,
  };
}

export async function processCustomerExecutiveBriefingJob({ jobId, user }) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT * FROM customer_intelligence_jobs WHERE id = ? AND requested_by_user_id = ? AND job_type = 'executive_briefing' LIMIT 1`,
    [Number(jobId), Number(user.id)],
  );
  const job = rows[0];
  if (!job) return null;
  if (!["pending", "running"].includes(String(job.status)))
    return mapJobRow(job);
  await query(
    `UPDATE customer_intelligence_jobs SET status = 'running', updated_at = NOW(3) WHERE id = ?`,
    [Number(jobId)],
  );
  try {
    const snapshot = await buildAuthorizedCustomerSnapshot({
      user,
      accountId: job.account_id,
      opportunityId: job.opportunity_id,
      contactId: job.contact_id,
    });
    const findings = generateCustomerIntelligenceFindings(snapshot);
    const aiResult = await runStructuredWebResearch({
      schemaName: "account_executive_briefing",
      systemPrompt:
        "Eres un asistente comercial B2B. Resume una cuenta usando exclusivamente el snapshot autorizado y sus evidencias. No inventes hechos; separa hechos, riesgos e hipótesis.",
      subject: snapshot.account?.name || "cuenta",
      context: { snapshot, findings, accountHealth: snapshot.accountHealth },
      currentValues: {},
      fields: [
        { key: "summary", type: "string", example: "Resumen ejecutivo" },
        {
          key: "recentChanges",
          type: "array",
          example: ["Cambio reciente"],
          items: { type: "string", example: "Cambio reciente" },
        },
        {
          key: "prioritizedRisks",
          type: "array",
          example: [],
          items: {
            type: "object",
            fields: [
              { key: "title", type: "string", example: "Riesgo" },
              { key: "summary", type: "string", example: "Resumen" },
              { key: "evidence", type: "string", example: "Evidencia" },
              {
                key: "severity",
                type: "enum",
                enum: ["high", "medium", "low"],
                example: "medium",
              },
            ],
          },
        },
        {
          key: "meetingQuestions",
          type: "array",
          example: ["Pregunta"],
          items: { type: "string", example: "Pregunta" },
        },
        {
          key: "nextBestStep",
          type: "string",
          example: "Siguiente mejor paso",
        },
        {
          key: "evidence",
          type: "array",
          example: ["Evidencia"],
          items: { type: "string", example: "Evidencia" },
        },
        {
          key: "recommendedActions",
          type: "array",
          example: [],
          items: {
            type: "object",
            fields: [
              { key: "title", type: "string", example: "Agendar seguimiento" },
              { key: "actionType", type: "string", example: "call" },
              {
                key: "priority",
                type: "enum",
                enum: ["high", "medium", "low"],
                example: "medium",
              },
              { key: "opportunityId", type: "string", example: "123" },
              { key: "notes", type: "string", example: "Nota" },
              { key: "successCriteria", type: "string", example: "Criterio" },
            ],
          },
        },
      ],
      aiUsageContext: {
        userId: Number(user.id),
        featureCode: "commercial_intelligence.executive_briefing",
        jobType: "executive_briefing",
        jobId,
      },
    });
    const fallback = generateExecutiveBriefingFallback(snapshot, findings);
    const executiveBriefing = aiResult
      ? {
          ...fallback.executiveBriefing,
          ...aiResult,
          healthStatus: snapshot.accountHealth.status,
          healthScore: snapshot.accountHealth.score,
        }
      : fallback.executiveBriefing;
    const result = {
      sourceDomain: "crm_internal",
      scope: [
        "executive_summary",
        "account_health",
        "risks",
        "opportunities",
        "key_contacts",
        "recent_activity",
        "recommended_actions",
      ],
      headline: fallback.headline,
      summary: aiResult?.summary || fallback.summary,
      executiveBriefing,
      generatedAt: new Date().toISOString(),
    };
    await query(
      `UPDATE customer_intelligence_jobs SET status = 'completed', result_json = ?, error_message = NULL, updated_at = NOW(3), finished_at = NOW(3) WHERE id = ?`,
      [JSON.stringify(result), Number(jobId)],
    );
    return {
      ...mapJobRow({
        ...job,
        status: "completed",
        result_json: JSON.stringify(result),
        error_message: null,
      }),
      result,
    };
  } catch (error) {
    await query(
      `UPDATE customer_intelligence_jobs SET status = 'failed', error_message = ?, updated_at = NOW(3), finished_at = NOW(3) WHERE id = ?`,
      [
        clip(
          error?.message || "No fue posible preparar el resumen ejecutivo",
          1000,
        ),
        Number(jobId),
      ],
    ).catch(() => undefined);
    return null;
  }
}

function normalizeCustomerExternalFinding(
  rawFinding,
  index = 0,
  sourceType = "public_web",
) {
  const sourceUrl = clip(
    rawFinding?.sourceUrl || rawFinding?.sourceReference || "",
    500,
  );
  const title = clip(rawFinding?.title || `Señal publica ${index + 1}`, 190);
  const summary = clip(
    rawFinding?.summary || rawFinding?.description || "",
    4000,
  );
  const evidenceText = clip(
    rawFinding?.evidenceText || rawFinding?.evidence || "",
    4000,
  );
  const rawContactData =
    rawFinding?.contactData && typeof rawFinding.contactData === "object"
      ? rawFinding.contactData
      : null;
  const contactData = rawContactData
    ? {
        ...rawContactData,
        email: cleanPublicContactValue(rawContactData.email),
        phone: cleanPublicContactValue(rawContactData.phone),
        mobile: cleanPublicContactValue(rawContactData.mobile),
      }
    : null;
  const contactName =
    contactData?.firstName && contactData?.lastName
      ? `${contactData.firstName} ${contactData.lastName}`.trim()
      : "";
  const inferredTargetEntity =
    rawFinding?.targetEntity ||
    (contactData?.firstName && contactData?.lastName ? "contact" : "account");
  return buildFinding({
    category: rawFinding?.category || "business_challenge",
    title: contactName || title,
    summary: summary || title,
    evidenceText:
      evidenceText ||
      "Señal detectada en investigacion externa; requiere validacion comercial.",
    sourceType,
    sourceReference: sourceUrl || "fuente_publica_no_especificada",
    confidence: ["high", "medium", "low"].includes(rawFinding?.confidence)
      ? rawFinding.confidence
      : "medium",
    certainty: "evidenced",
    metadata: {
      externalResearch: true,
      contactData,
      targetEntity: inferredTargetEntity,
      targetField: rawFinding?.targetField || "description",
      suggestedValue: clip(
        rawFinding?.suggestedValue || summary || evidenceText,
        10000,
      ),
    },
  });
}

async function runCustomerExternalResearch({ snapshot, user, jobId }) {
  const subject =
    snapshot.account?.name ||
    snapshot.selectedOpportunity?.name ||
    snapshot.selectedContact?.name ||
    "cliente";
  const tavily = await searchTavily({
    query: `${subject} ${snapshot.account?.city || ""} noticias proyectos tecnología empresa`,
  });
  const contactSearch = await searchTavily({
    query: `${subject} liderazgo directivos CTO CIO CISO director tecnología contacto empresa`,
  });
  const publicResults = [
    ...(tavily.results || []),
    ...(contactSearch.results || []),
  ].filter(
    (result, index, results) =>
      results.findIndex((candidate) => candidate.url === result.url) === index,
  );
  if ((!tavily.enabled && !contactSearch.enabled) || !publicResults.length) {
    return {
      enabled: false,
      findings: [],
      warnings: [...(tavily.warnings || []), ...(contactSearch.warnings || [])],
      provider: "tavily",
    };
  }
  const result = await runStructuredTextResearch({
    schemaName: "customer_external_research",
    systemPrompt: [
      "Eres un agente de inteligencia comercial B2B.",
      "Interpreta exclusivamente las fuentes públicas recuperadas por Tavily.",
      "No afirmes inferencias como hechos; cada hallazgo debe tener evidencia y fuente.",
      "Devuelve hallazgos utiles para preparar conversaciones comerciales en español.",
    ].join("\n"),
    subject,
    context: {
      account: snapshot.account,
      selectedOpportunity: snapshot.selectedOpportunity,
      selectedContact: snapshot.selectedContact,
      publicSources: publicResults,
    },
    currentValues: {},
    fields: [
      {
        key: "findings",
        type: "array",
        example: [],
        items: {
          type: "object",
          fields: [
            { key: "category", type: "string", example: "technology_project" },
            {
              key: "title",
              type: "string",
              example: "Posible iniciativa cloud",
            },
            { key: "summary", type: "string", example: "Resumen de señal" },
            {
              key: "evidenceText",
              type: "string",
              example: "Fragmento exacto",
            },
            {
              key: "sourceUrl",
              type: "string",
              example: "https://example.com",
            },
            {
              key: "confidence",
              type: "enum",
              enum: ["high", "medium", "low"],
              example: "medium",
            },
            {
              key: "targetEntity",
              type: "enum",
              enum: ["account", "contact", "opportunity"],
              example: "account",
            },
            { key: "targetField", type: "string", example: "description" },
            {
              key: "suggestedValue",
              type: "string",
              example: "Valor sugerido para actualizar el CRM",
            },
            {
              key: "contactData",
              type: "object",
              fields: [
                { key: "firstName", type: "string", example: "Ana" },
                { key: "lastName", type: "string", example: "Pérez" },
                { key: "positionTitle", type: "string", example: "CTO" },
                { key: "department", type: "string", example: "Tecnología" },
                { key: "email", type: "string", example: "ana@example.com" },
                { key: "phone", type: "string", example: "" },
                { key: "mobile", type: "string", example: "" },
              ],
            },
          ],
        },
      },
      {
        key: "warnings",
        type: "array",
        example: [],
        items: {
          type: "string",
          example: "No se encontraron fuentes suficientes",
        },
        required: false,
      },
    ],
    aiUsageContext: {
      userId: Number(user.id),
      featureCode: "commercial_intelligence.external",
      jobType: "customer_external_research",
      jobId,
    },
  });

  if (!result) {
    return {
      enabled: false,
      findings: [],
      warnings: [
        "OpenAI no esta disponible para interpretar los resultados de Tavily.",
      ],
      provider: "tavily",
    };
  }
  return {
    enabled: true,
    findings: Array.isArray(result.findings)
      ? result.findings
          .map((finding, index) =>
            normalizeCustomerExternalFinding(finding, index, "tavily"),
          )
          .filter((finding) => finding.title)
      : [],
    warnings: [
      ...(tavily.warnings || []),
      ...(contactSearch.warnings || []),
      ...(Array.isArray(result.warnings)
        ? result.warnings.filter(Boolean)
        : []),
    ],
    provider: "tavily",
  };
}

async function insertFindings(
  conn,
  { jobId, userId, accountId, opportunityId, contactId, findings },
) {
  const now = new Date();
  const inserted = [];
  for (const finding of deduplicateCustomerIntelligenceFindings(findings)) {
    const publicId = `cif_${randomUUID()}`;
    const [result] = await conn.query(
      `INSERT INTO customer_intelligence_findings
        (public_id, job_id, account_id, opportunity_id, contact_id, category,
         title, summary, evidence_text, source_type, source_reference,
         confidence, certainty, status, metadata_json, created_by_user_id,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'suggested', ?, ?, ?, ?)`,
      [
        publicId,
        jobId,
        accountId || null,
        opportunityId || null,
        contactId || null,
        finding.category,
        finding.title,
        finding.summary,
        finding.evidenceText,
        finding.sourceType,
        finding.sourceReference,
        finding.confidence,
        finding.certainty,
        JSON.stringify(finding.metadata || {}),
        userId,
        now,
        now,
      ],
    );
    inserted.push({ ...finding, id: Number(result.insertId), publicId });
  }
  return inserted;
}

export async function createCustomerIntelligenceJob({ user, payload }) {
  await ensureCommercialIntelligenceSchema();
  const snapshot = await buildAuthorizedCustomerSnapshot({
    user,
    accountId: payload.accountId,
    opportunityId: payload.opportunityId,
    contactId: payload.contactId,
  });

  const accountId = snapshot.account?.id || null;
  const opportunityId = snapshot.selectedOpportunity?.id || null;
  const contactId = snapshot.selectedContact?.id || null;
  const publicId = `cij_${randomUUID()}`;
  const request = {
    accountId,
    opportunityId,
    contactId,
    objective: clip(payload.objective, 1000),
    requestedAt: new Date().toISOString(),
  };

  const result = await query(
    `INSERT INTO customer_intelligence_jobs
      (public_id, account_id, opportunity_id, contact_id, requested_by_user_id,
       job_type, status, request_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'customer_research', 'pending', ?, NOW(3), NOW(3))`,
    [
      publicId,
      accountId,
      opportunityId,
      contactId,
      Number(user.id),
      JSON.stringify(request),
    ],
  );

  return {
    job: {
      id: Number(result.insertId),
      publicId,
      status: "pending",
      pollAfterMs: 1000,
    },
    snapshot,
  };
}

export async function createAccountInternalAnalysisJob({ user, payload }) {
  await ensureCommercialIntelligenceSchema();
  const snapshot = await buildAuthorizedCustomerSnapshot({ user, ...payload });
  const result = await query(
    `INSERT INTO customer_intelligence_jobs
      (public_id, account_id, opportunity_id, contact_id, requested_by_user_id,
       job_type, status, request_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'account_internal_analysis', 'pending', ?, NOW(3), NOW(3))`,
    [
      `cia_${randomUUID()}`,
      snapshot.account?.id || null,
      snapshot.selectedOpportunity?.id || null,
      snapshot.selectedContact?.id || null,
      Number(user.id),
      JSON.stringify(payload),
    ],
  );
  return {
    job: { id: Number(result.insertId), status: "pending", pollAfterMs: 700 },
    snapshot,
  };
}

export async function processAccountInternalAnalysisJob({ jobId, user }) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT * FROM customer_intelligence_jobs WHERE id = ? AND requested_by_user_id = ? AND job_type = 'account_internal_analysis' LIMIT 1`,
    [Number(jobId), Number(user.id)],
  );
  const job = rows[0];
  if (!job) return null;
  const snapshot = await buildAuthorizedCustomerSnapshot({
    user,
    accountId: job.account_id,
    opportunityId: job.opportunity_id,
    contactId: job.contact_id,
  });
  const agents = await runAccountIntelligenceAgents(snapshot, {
    includePublicResearch: false,
  });
  const findings = generateCustomerIntelligenceFindings(snapshot);
  const persistedFindings = await withTransaction(async (conn) => {
    await conn.query(
      `DELETE FROM customer_intelligence_findings WHERE job_id = ?`,
      [Number(jobId)],
    );
    return insertFindings(conn, {
      jobId: Number(jobId),
      userId: Number(user.id),
      accountId: job.account_id === null ? null : Number(job.account_id),
      opportunityId:
        job.opportunity_id === null ? null : Number(job.opportunity_id),
      contactId: job.contact_id === null ? null : Number(job.contact_id),
      findings,
    });
  });
  const result = {
    sourceDomain: "crm_internal",
    scope: [
      "executive_summary",
      "account_health",
      "risks",
      "opportunities",
      "key_contacts",
      "recent_activity",
      "renewal_expansion",
      "recommended_actions",
    ],
    headline: snapshot.account?.name
      ? `Análisis de cuenta: ${snapshot.account.name}`
      : "Análisis de cuenta",
    summary: `Análisis interno consolidado con ${snapshot.contacts.length} contacto(s), ${snapshot.opportunities.length} oportunidad(es), ${snapshot.products.length} producto(s) y ${snapshot.renewals.length} renovación(es).`,
    snapshot,
    accountHealth: snapshot.accountHealth,
    findings: persistedFindings,
    agents,
    generatedAt: new Date().toISOString(),
    writesPerformed: false,
  };
  await query(
    `UPDATE customer_intelligence_jobs SET status = 'completed', result_json = ?, updated_at = NOW(3), finished_at = NOW(3) WHERE id = ?`,
    [JSON.stringify(result), Number(jobId)],
  );
  return {
    ...mapJobRow({
      ...job,
      status: "completed",
      result_json: JSON.stringify(result),
    }),
    result,
    findings: persistedFindings,
  };
}

export async function createCommercialDiscoveryJob({ user, payload }) {
  await ensureCommercialIntelligenceSchema();
  const snapshot = await buildAuthorizedCustomerSnapshot({
    user,
    accountId: payload.accountId,
    opportunityId: payload.opportunityId,
    contactId: payload.contactId,
  });

  const accountId = snapshot.account?.id || null;
  const opportunityId = snapshot.selectedOpportunity?.id || null;
  const contactId = snapshot.selectedContact?.id || null;
  const publicId = `cdj_${randomUUID()}`;
  const request = {
    accountId,
    opportunityId,
    contactId,
    objective: clip(payload.objective || "Preparar llamada comercial", 1000),
    requestedAt: new Date().toISOString(),
  };

  const result = await query(
    `INSERT INTO customer_intelligence_jobs
      (public_id, account_id, opportunity_id, contact_id, requested_by_user_id,
       job_type, status, request_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'commercial_discovery', 'pending', ?, NOW(3), NOW(3))`,
    [
      publicId,
      accountId,
      opportunityId,
      contactId,
      Number(user.id),
      JSON.stringify(request),
    ],
  );

  return {
    job: {
      id: Number(result.insertId),
      publicId,
      status: "pending",
      pollAfterMs: 1000,
    },
    snapshot,
  };
}

export async function createCustomerExternalResearchJob({ user, payload }) {
  await ensureCommercialIntelligenceSchema();
  await assertExternalResearchGovernance(user);
  const snapshot = await buildAuthorizedCustomerSnapshot({
    user,
    accountId: payload.accountId,
    opportunityId: payload.opportunityId,
    contactId: payload.contactId,
  });
  const accountId = snapshot.account?.id || null;
  const opportunityId = snapshot.selectedOpportunity?.id || null;
  const contactId = snapshot.selectedContact?.id || null;
  const publicId = `cej_${randomUUID()}`;
  const result = await query(
    `INSERT INTO customer_intelligence_jobs
      (public_id, account_id, opportunity_id, contact_id, requested_by_user_id,
       job_type, status, request_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'external_research', 'pending', ?, NOW(3), NOW(3))`,
    [
      publicId,
      accountId,
      opportunityId,
      contactId,
      Number(user.id),
      JSON.stringify({
        accountId,
        opportunityId,
        contactId,
        requestedAt: new Date().toISOString(),
      }),
    ],
  );
  return {
    job: {
      id: Number(result.insertId),
      publicId,
      status: "pending",
      pollAfterMs: 1000,
    },
    snapshot,
  };
}

export async function processCustomerIntelligenceJob({ jobId, user }) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT * FROM customer_intelligence_jobs
     WHERE id = ? AND requested_by_user_id = ? LIMIT 1`,
    [Number(jobId), Number(user.id)],
  );
  const job = rows[0];
  if (!job) return null;
  if (!["pending", "running"].includes(String(job.status))) {
    return mapJobRow(job);
  }

  await query(
    `UPDATE customer_intelligence_jobs
     SET status = 'running', updated_at = NOW(3)
     WHERE id = ?`,
    [Number(jobId)],
  );

  try {
    const snapshot = await buildAuthorizedCustomerSnapshot({
      user,
      accountId: job.account_id,
      opportunityId: job.opportunity_id,
      contactId: job.contact_id,
    });
    const findings = generateCustomerIntelligenceFindings(snapshot);
    const resultSummary = buildResultSummary(snapshot, findings);

    const persistedFindings = await withTransaction(async (conn) => {
      await conn.query(
        `DELETE FROM customer_intelligence_findings WHERE job_id = ?`,
        [Number(jobId)],
      );
      const inserted = await insertFindings(conn, {
        jobId: Number(jobId),
        userId: Number(user.id),
        accountId: job.account_id === null ? null : Number(job.account_id),
        opportunityId:
          job.opportunity_id === null ? null : Number(job.opportunity_id),
        contactId: job.contact_id === null ? null : Number(job.contact_id),
        findings,
      });
      await conn.query(
        `UPDATE customer_intelligence_jobs
         SET status = 'completed', result_json = ?, error_message = NULL,
             updated_at = NOW(3), finished_at = NOW(3)
         WHERE id = ?`,
        [
          JSON.stringify({ ...resultSummary, findings: inserted }),
          Number(jobId),
        ],
      );
      return inserted;
    });

    return {
      ...mapJobRow({
        ...job,
        status: "completed",
        result_json: JSON.stringify({
          ...resultSummary,
          findings: persistedFindings,
        }),
        error_message: null,
      }),
      result: { ...resultSummary, findings: persistedFindings },
    };
  } catch (error) {
    await query(
      `UPDATE customer_intelligence_jobs
       SET status = 'failed', error_message = ?, updated_at = NOW(3), finished_at = NOW(3)
       WHERE id = ?`,
      [
        clip(error?.message || "No fue posible investigar el cliente", 1000),
        Number(jobId),
      ],
    ).catch(() => undefined);
    return null;
  }
}

export async function processCommercialDiscoveryJob({ jobId, user }) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT * FROM customer_intelligence_jobs
     WHERE id = ? AND requested_by_user_id = ? LIMIT 1`,
    [Number(jobId), Number(user.id)],
  );
  const job = rows[0];
  if (!job) return null;
  if (!["pending", "running"].includes(String(job.status))) {
    return mapJobRow(job);
  }

  await query(
    `UPDATE customer_intelligence_jobs
     SET status = 'running', updated_at = NOW(3)
     WHERE id = ?`,
    [Number(jobId)],
  );

  try {
    const snapshot = await buildAuthorizedCustomerSnapshot({
      user,
      accountId: job.account_id,
      opportunityId: job.opportunity_id,
      contactId: job.contact_id,
    });
    const findings = generateCustomerIntelligenceFindings(snapshot);
    const result = generateCommercialDiscoveryResult(snapshot, findings);

    await query(
      `UPDATE customer_intelligence_jobs
       SET status = 'completed', result_json = ?, error_message = NULL,
           updated_at = NOW(3), finished_at = NOW(3)
       WHERE id = ?`,
      [JSON.stringify({ ...result, sourceFindings: findings }), Number(jobId)],
    );

    return {
      ...mapJobRow({
        ...job,
        status: "completed",
        result_json: JSON.stringify({ ...result, sourceFindings: findings }),
        error_message: null,
      }),
      result: { ...result, sourceFindings: findings },
    };
  } catch (error) {
    await query(
      `UPDATE customer_intelligence_jobs
       SET status = 'failed', error_message = ?, updated_at = NOW(3), finished_at = NOW(3)
       WHERE id = ?`,
      [
        clip(error?.message || "No fue posible preparar la llamada", 1000),
        Number(jobId),
      ],
    ).catch(() => undefined);
    return null;
  }
}

export async function processCustomerExternalResearchJob({ jobId, user }) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT * FROM customer_intelligence_jobs
     WHERE id = ? AND requested_by_user_id = ? LIMIT 1`,
    [Number(jobId), Number(user.id)],
  );
  const job = rows[0];
  if (!job) return null;
  if (!["pending", "running"].includes(String(job.status)))
    return mapJobRow(job);
  await query(
    `UPDATE customer_intelligence_jobs SET status = 'running', updated_at = NOW(3) WHERE id = ?`,
    [Number(jobId)],
  );
  try {
    const snapshot = await buildAuthorizedCustomerSnapshot({
      user,
      accountId: job.account_id,
      opportunityId: job.opportunity_id,
      contactId: job.contact_id,
    });
    const external = await runCustomerExternalResearch({
      snapshot,
      user,
      jobId: Number(jobId),
    });
    let inserted = [];
    if (external.findings.length) {
      inserted = await withTransaction(async (conn) =>
        insertFindings(conn, {
          jobId: Number(jobId),
          userId: Number(user.id),
          accountId: job.account_id === null ? null : Number(job.account_id),
          opportunityId:
            job.opportunity_id === null ? null : Number(job.opportunity_id),
          contactId: job.contact_id === null ? null : Number(job.contact_id),
          findings: external.findings,
        }),
      );
    }
    const result = {
      sourceDomain: "public_web",
      scope: ["public_research", "executive_summary"],
      headline: "Investigacion externa del cliente",
      summary: external.enabled
        ? `Se detectaron ${inserted.length} hallazgo(s) desde fuentes publicas.`
        : "La investigacion externa no se ejecuto porque Tavily no esta habilitado o no pudo recuperar fuentes.",
      externalResearch: {
        enabled: external.enabled,
        provider: external.provider || "tavily",
        warnings: external.warnings,
        findingCount: inserted.length,
        researchedAt: new Date().toISOString(),
      },
      findings: inserted,
      generatedAt: new Date().toISOString(),
    };
    await query(
      `UPDATE customer_intelligence_jobs
       SET status = 'completed', result_json = ?, error_message = NULL,
           updated_at = NOW(3), finished_at = NOW(3)
       WHERE id = ?`,
      [JSON.stringify(result), Number(jobId)],
    );
    return {
      ...mapJobRow({
        ...job,
        status: "completed",
        result_json: JSON.stringify(result),
        error_message: null,
      }),
      result,
    };
  } catch (error) {
    await query(
      `UPDATE customer_intelligence_jobs
       SET status = 'failed', error_message = ?, updated_at = NOW(3), finished_at = NOW(3)
       WHERE id = ?`,
      [
        clip(
          error?.message || "No fue posible investigar fuentes externas",
          1000,
        ),
        Number(jobId),
      ],
    ).catch(() => undefined);
    return null;
  }
}

export async function getCustomerIntelligenceJob({ user, jobId }) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT * FROM customer_intelligence_jobs
     WHERE id = ? AND requested_by_user_id = ? LIMIT 1`,
    [Number(jobId), Number(user.id)],
  );
  const job = mapJobRow(rows[0]);
  if (!job) return null;
  const findings = await query(
    `SELECT * FROM customer_intelligence_findings
     WHERE job_id = ?
     ORDER BY created_at ASC, id ASC`,
    [Number(job.id)],
  );
  return { ...job, findings: findings.map(mapFindingRow) };
}

export async function listCustomerIntelligenceFindings({ user, filters = {} }) {
  await ensureCommercialIntelligenceSchema();
  const where = [];
  const params = [];

  if (filters.accountId) {
    await getAccessibleAccount({ user, accountId: Number(filters.accountId) });
    where.push("account_id = ?");
    params.push(Number(filters.accountId));
  }
  if (filters.opportunityId) {
    await getAccessibleOpportunity({
      user,
      opportunityId: Number(filters.opportunityId),
    });
    where.push("opportunity_id = ?");
    params.push(Number(filters.opportunityId));
  }
  if (filters.contactId) {
    await getAccessibleContact({ user, contactId: Number(filters.contactId) });
    where.push("contact_id = ?");
    params.push(Number(filters.contactId));
  }
  if (filters.status) {
    where.push("status = ?");
    params.push(String(filters.status));
  }

  if (!where.length) {
    where.push("created_by_user_id = ?");
    params.push(Number(user.id));
  }

  const rows = await query(
    `SELECT * FROM customer_intelligence_findings
     WHERE ${where.join(" AND ")}
     ORDER BY updated_at DESC, id DESC
     LIMIT 100`,
    params,
  );
  return rows.map(mapFindingRow);
}

export async function updateCustomerIntelligenceFindingStatus({
  user,
  findingId,
  status,
}) {
  await ensureCommercialIntelligenceSchema();
  const allowedStatuses = new Set([
    "confirmed",
    "rejected",
    "suggested",
    "outdated",
  ]);
  if (!allowedStatuses.has(status)) {
    throw createHttpError(400, "Estado de hallazgo invalido");
  }

  const rows = await query(
    `SELECT * FROM customer_intelligence_findings WHERE id = ? LIMIT 1`,
    [Number(findingId)],
  );
  const finding = rows[0];
  if (!finding) return null;

  if (finding.account_id) {
    await getAccessibleAccount({ user, accountId: Number(finding.account_id) });
  }
  if (finding.opportunity_id) {
    await getAccessibleOpportunity({
      user,
      opportunityId: Number(finding.opportunity_id),
    });
  }
  if (finding.contact_id) {
    await getAccessibleContact({ user, contactId: Number(finding.contact_id) });
  }

  await query(
    `UPDATE customer_intelligence_findings
     SET status = ?, validated_by_user_id = ?, validated_at = NOW(3), updated_at = NOW(3)
     WHERE id = ?`,
    [status, Number(user.id), Number(findingId)],
  );

  const updatedRows = await query(
    `SELECT * FROM customer_intelligence_findings WHERE id = ? LIMIT 1`,
    [Number(findingId)],
  );
  return mapFindingRow(updatedRows[0]);
}

export async function applyCustomerIntelligenceFinding({
  user,
  findingId,
  target,
  field,
  value,
  mode,
}) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT * FROM customer_intelligence_findings WHERE id = ? LIMIT 1`,
    [Number(findingId)],
  );
  const finding = rows[0];
  if (!finding) return null;
  if (finding.status !== "confirmed") {
    throw createHttpError(
      409,
      "El hallazgo debe confirmarse antes de guardar cambios",
    );
  }

  const targetConfig = {
    account: {
      id: finding.account_id,
      permission: "cuentas.update",
      table: "accounts",
      fields: {
        description: "description",
        website: "website",
        phone: "phone",
        city: "city",
        stateRegion: "state_region",
      },
    },
    contact: {
      id: finding.contact_id,
      permission: "contactos.update",
      table: "contacts",
      fields: {
        positionTitle: "position_title",
        department: "department",
        email: "email",
        phone: "phone",
        mobile: "mobile",
        city: "city",
        stateRegion: "state_region",
      },
    },
    opportunity: {
      id: finding.opportunity_id,
      permission: "oportunidades.update",
      table: "opportunities",
      fields: { name: "name" },
    },
  }[target];

  if (!targetConfig?.id || !targetConfig.fields[field]) {
    throw createHttpError(
      400,
      "El campo seleccionado no corresponde al registro del hallazgo",
    );
  }
  if (!hasPermission(user, targetConfig.permission)) {
    throw createHttpError(403, "No autorizado", {
      requiredPermission: targetConfig.permission,
    });
  }
  if (target === "account")
    await getAccessibleAccount({ user, accountId: targetConfig.id });
  if (target === "contact")
    await getAccessibleContact({ user, contactId: targetConfig.id });
  if (target === "opportunity")
    await getAccessibleOpportunity({ user, opportunityId: targetConfig.id });

  const normalizedValue = clip(value, 10000);
  if (!normalizedValue) throw createHttpError(400, "El valor es obligatorio");
  const [currentRows] = await query(
    `SELECT ${targetConfig.fields[field]} AS current_value FROM ${targetConfig.table} WHERE id = ? LIMIT 1`,
    [Number(targetConfig.id)],
  );
  const currentValue = String(currentRows?.current_value || "").trim();
  const nextValue =
    mode === "append" && currentValue
      ? `${currentValue}\n\n${normalizedValue}`
      : normalizedValue;
  await query(
    `UPDATE ${targetConfig.table} SET ${targetConfig.fields[field]} = ?, updated_at = NOW(3) WHERE id = ?`,
    [nextValue, Number(targetConfig.id)],
  );
  return {
    finding: mapFindingRow(finding),
    target,
    field,
    mode,
    value: nextValue,
    recordId: Number(targetConfig.id),
  };
}

export async function applyCustomerContactFinding({
  user,
  findingId,
  contactId,
  contactData,
}) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT * FROM customer_intelligence_findings WHERE id = ? LIMIT 1`,
    [Number(findingId)],
  );
  const finding = rows[0];
  if (!finding) return null;
  if (finding.status !== "confirmed") {
    throw createHttpError(
      409,
      "El hallazgo debe confirmarse antes de guardar cambios",
    );
  }
  if (!finding.account_id)
    throw createHttpError(400, "El hallazgo no tiene una cuenta relacionada");
  await getAccessibleAccount({ user, accountId: Number(finding.account_id) });
  const data = {
    firstName: String(contactData?.firstName || "").trim(),
    lastName: String(contactData?.lastName || "").trim(),
    positionTitle: String(contactData?.positionTitle || "").trim(),
    department: String(contactData?.department || "").trim(),
    email: String(contactData?.email || "").trim(),
    phone: String(contactData?.phone || "").trim(),
    mobile: String(contactData?.mobile || "").trim(),
  };
  if (!data.firstName || !data.lastName)
    throw createHttpError(400, "Nombre y apellido son obligatorios");
  if (contactId) {
    if (!hasPermission(user, "contactos.update"))
      throw createHttpError(403, "No autorizado", {
        requiredPermission: "contactos.update",
      });
    await getAccessibleContact({ user, contactId: Number(contactId) });
    await query(
      `UPDATE contacts SET first_name = ?, last_name = ?, position_title = ?, department = ?, email = ?, phone = ?, mobile = ?, updated_by = ?, updated_at = NOW(3) WHERE id = ? AND account_id = ?`,
      [
        data.firstName,
        data.lastName,
        data.positionTitle || null,
        data.department || null,
        data.email || null,
        data.phone || null,
        data.mobile || null,
        Number(user.id),
        Number(contactId),
        Number(finding.account_id),
      ],
    );
    return {
      mode: "updated",
      contactId: Number(contactId),
      finding: mapFindingRow(finding),
    };
  }
  if (!hasPermission(user, "contactos.create"))
    throw createHttpError(403, "No autorizado", {
      requiredPermission: "contactos.create",
    });
  const [country] = await query("SELECT id FROM countries ORDER BY id LIMIT 1");
  const [purchase] = await query(
    "SELECT id FROM contact_purchase_participations ORDER BY id LIMIT 1",
  );
  const [hierarchy] = await query(
    "SELECT id FROM contact_hierarchy_levels ORDER BY id LIMIT 1",
  );
  const [relationship] = await query(
    "SELECT id FROM contact_relationship_types ORDER BY id LIMIT 1",
  );
  const [influence] = await query(
    "SELECT id FROM contact_influence_levels ORDER BY id LIMIT 1",
  );
  const [employment] = await query(
    "SELECT id FROM contact_employment_statuses ORDER BY id LIMIT 1",
  );
  const [activation] = await query(
    "SELECT id FROM contact_activation_statuses WHERE code = 'activado' ORDER BY id LIMIT 1",
  );
  const result = await query(
    `INSERT INTO contacts
      (first_name, last_name, account_id, position_title, phone, mobile, email,
       department, country_id, purchase_participation_id, hierarchy_level_id,
       relationship_type_id, influence_level_id, employment_status_id,
       activation_status_id, created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?, NOW(3))`,
    [
      data.firstName,
      data.lastName,
      Number(finding.account_id),
      data.positionTitle || null,
      data.phone || null,
      data.mobile || null,
      data.email || null,
      data.department || null,
      country?.id || null,
      purchase?.id,
      hierarchy?.id,
      relationship?.id,
      influence?.id,
      employment?.id,
      activation?.id,
      Number(user.id),
      Number(user.id),
    ],
  );
  return {
    mode: "created",
    contactId: Number(result.insertId),
    finding: mapFindingRow(finding),
  };
}

export async function getMiCoachGovernanceOverview() {
  await ensureCommercialIntelligenceSchema();
  const retentionSettings = await getMiCoachGovernanceSettings();
  await query(
    `DELETE FROM customer_intelligence_findings
     WHERE created_at < DATE_SUB(NOW(3), INTERVAL ? DAY)`,
    [retentionSettings.findingRetentionDays],
  ).catch(() => undefined);
  await query(
    `DELETE FROM customer_intelligence_jobs
     WHERE created_at < DATE_SUB(NOW(3), INTERVAL ? DAY)`,
    [retentionSettings.findingRetentionDays],
  ).catch(() => undefined);
  await query(
    `DELETE FROM prospect_research_sessions
     WHERE created_at < DATE_SUB(NOW(3), INTERVAL ? DAY)`,
    [retentionSettings.findingRetentionDays],
  ).catch(() => undefined);
  const [settingsRows, jobRows, findingRows, prospectRows] = await Promise.all([
    query(
      `SELECT settings_json, updated_at, updated_by_user_id
       FROM mi_coach_governance_settings
       WHERE singleton_key = 'default'
       LIMIT 1`,
    ),
    query(
      `SELECT status, job_type, COUNT(*) AS total
       FROM customer_intelligence_jobs
       WHERE created_at >= DATE_SUB(NOW(3), INTERVAL 30 DAY)
       GROUP BY status, job_type`,
    ).catch(() => []),
    query(
      `SELECT status, source_type, COUNT(*) AS total
       FROM customer_intelligence_findings
       WHERE created_at >= DATE_SUB(NOW(3), INTERVAL 30 DAY)
       GROUP BY status, source_type`,
    ).catch(() => []),
    query(
      `SELECT status, COUNT(*) AS total
       FROM prospect_research_sessions
       WHERE created_at >= DATE_SUB(NOW(3), INTERVAL 30 DAY)
       GROUP BY status`,
    ).catch(() => []),
  ]);
  const settingsRow = settingsRows[0] || {};
  return {
    settings: normalizeGovernanceSettings(
      parseJson(settingsRow.settings_json, DEFAULT_GOVERNANCE_SETTINGS),
    ),
    updatedAt: settingsRow.updated_at || null,
    updatedByUserId: settingsRow.updated_by_user_id
      ? Number(settingsRow.updated_by_user_id)
      : null,
    businessRules: await loadCoachBusinessRules({
      channel: "coach",
      process: "default",
    }),
    metrics: {
      jobsLast30Days: jobRows.map((row) => ({
        status: row.status,
        jobType: row.job_type,
        total: Number(row.total || 0),
      })),
      findingsLast30Days: findingRows.map((row) => ({
        status: row.status,
        sourceType: row.source_type,
        total: Number(row.total || 0),
      })),
      prospectSessionsLast30Days: prospectRows.map((row) => ({
        status: row.status,
        total: Number(row.total || 0),
      })),
    },
  };
}

export async function updateMiCoachGovernanceSettings({ user, settings }) {
  await ensureCommercialIntelligenceSchema();
  const normalized = normalizeGovernanceSettings(settings);
  await query(
    `INSERT INTO mi_coach_governance_settings
      (singleton_key, settings_json, updated_by_user_id, created_at, updated_at)
     VALUES ('default', ?, ?, NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE
       settings_json = VALUES(settings_json),
       updated_by_user_id = VALUES(updated_by_user_id),
       updated_at = NOW(3)`,
    [JSON.stringify(normalized), Number(user.id)],
  );
  return getMiCoachGovernanceOverview();
}
