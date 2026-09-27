import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db.js";
import { runStructuredTextResearch, runStructuredWebResearch } from "../structuredWebResearch.js";
import { searchTavily } from "../tavily.js";
import { ensureOpportunityWorkspaceSchema } from "../opportunity-workspace/schema.js";
import { ensureManufacturerRegistrationsSchema } from "../manufacturer-registrations/schema.js";
import { ensureCommercialIntelligenceSchema } from "./schema.js";
import {
  CUSTOMER_INTELLIGENCE_CATEGORIES,
  normalizeCustomerIntelligenceFinding,
  normalizeCustomerIntelligenceOrchestration,
  normalizeCustomerIntelligenceSnapshot,
} from "./contract.js";

const FINDING_CATEGORIES = new Set(CUSTOMER_INTELLIGENCE_CATEGORIES);

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
  notes: "Configuracion inicial de gobierno de Mi Coach",
};

function clip(value, max = 1200) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max)}...`;
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
    const sourceKey = normalizeFindingKeyPart(normalized.sourceUrl || normalized.source);
    const targetKey = [normalized.targetEntity, normalized.targetField, normalized.suggestedValue]
      .map(normalizeFindingKeyPart)
      .join("|");
    const key = [normalized.sourceDomain, normalized.category, normalizeFindingKeyPart(normalized.title), sourceKey, targetKey]
      .join("|");
    const previous = unique.get(key);
    if (!previous) {
      unique.set(key, normalized);
      continue;
    }
    unique.set(key, {
      ...previous,
      evidence: [previous.evidence, normalized.evidence].filter(Boolean).join(" | ").slice(0, 4000),
      confidence: previous.confidence === "high" || normalized.confidence === "high"
        ? "high"
        : previous.confidence === "medium" || normalized.confidence === "medium"
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
  return {
    externalSourcesEnabled: Boolean(source.externalSourcesEnabled),
    includeWonOpportunities: source.includeWonOpportunities !== false,
    includeLostOpportunities: source.includeLostOpportunities !== false,
    includeCancelledOpportunities: Boolean(source.includeCancelledOpportunities),
    dailyResearchLimitPerUser: Math.max(1, Math.min(500, Number(source.dailyResearchLimitPerUser || DEFAULT_GOVERNANCE_SETTINGS.dailyResearchLimitPerUser))),
    findingRetentionDays: Math.max(30, Math.min(3650, Number(source.findingRetentionDays || DEFAULT_GOVERNANCE_SETTINGS.findingRetentionDays))),
    requireEvidenceForExternalFindings: source.requireEvidenceForExternalFindings !== false,
    allowProspectConversion: source.allowProspectConversion !== false,
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
    throw createHttpError(403, "Las fuentes externas estan deshabilitadas por gobierno de Mi Coach", {
      requiredPermission: "mi_coach.admin",
    });
  }
  const rows = await query(
    `SELECT COUNT(*) AS total FROM customer_intelligence_jobs
     WHERE requested_by_user_id = ? AND job_type = 'external_research'
       AND created_at >= DATE_SUB(NOW(3), INTERVAL 1 DAY)`,
    [Number(user.id)],
  );
  if (Number(rows[0]?.total || 0) >= settings.dailyResearchLimitPerUser) {
    throw createHttpError(429, "Se alcanzo el limite diario de investigacion externa para este usuario");
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
    opportunityId: row.opportunity_id === null ? null : Number(row.opportunity_id),
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
    opportunityId: row.opportunity_id === null ? null : Number(row.opportunity_id),
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
      row.validated_by_user_id === null ? null : Number(row.validated_by_user_id),
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
  return Number(
    account?.id || opportunity?.account_id || contact?.account_id || 0,
  ) || null;
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

export function buildAccountHealth({ account, contacts = [], opportunities = [], interactions = [], renewals = [], products = [], now = new Date() }) {
  const signals = [];
  const nowTimestamp = new Date(now).getTime();
  const latestInteraction = interactions
    .map((item) => item.updatedAt || item.createdAt)
    .filter(Boolean)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || null;
  const daysSinceLastInteraction = daysSince(latestInteraction, nowTimestamp);
  const riskyOpportunities = opportunities.filter((opportunity) => {
    const closeDays = daysUntil(opportunity.closeDate, nowTimestamp);
    const staleDays = daysSince(opportunity.updatedAt, nowTimestamp);
    return (closeDays !== null && closeDays <= 30) || (staleDays !== null && staleDays >= 30);
  });

  if (!account?.description) {
    signals.push({ code: "missing_account_description", severity: "medium", title: "Falta contexto de cuenta", summary: "La cuenta no tiene una descripción comercial suficiente.", evidence: "Campo description vacío o no disponible.", source: "crm:accounts.description", entityType: "account", entityId: account?.id || null });
  }
  if (!contacts.length) {
    signals.push({ code: "no_active_contacts", severity: "medium", title: "Sin contactos activos", summary: "No hay contactos activos disponibles para mapear la relación comercial.", evidence: "Consulta de contactos activos sin resultados.", source: "crm:contacts", entityType: "account", entityId: account?.id || null });
  }
  if (!opportunities.length) {
    signals.push({ code: "no_open_opportunities", severity: "low", title: "Sin oportunidades abiertas", summary: "No hay oportunidades abiertas visibles para esta cuenta.", evidence: "Consulta de oportunidades activas sin resultados.", source: "crm:opportunities", entityType: "account", entityId: account?.id || null });
  }
  if (daysSinceLastInteraction === null || daysSinceLastInteraction >= 30) {
    signals.push({ code: "stale_account_activity", severity: "high", title: "Actividad comercial atrasada", summary: "La cuenta no tiene una interacción reciente accesible.", evidence: daysSinceLastInteraction === null ? "No hay interacciones recientes." : `Última interacción hace ${daysSinceLastInteraction} días.`, source: "crm:interactions", entityType: "account", entityId: account?.id || null });
  }
  for (const opportunity of riskyOpportunities.slice(0, 5)) {
    const closeDays = daysUntil(opportunity.closeDate, nowTimestamp);
    const staleDays = daysSince(opportunity.updatedAt, nowTimestamp);
    const reason = closeDays !== null && closeDays <= 30
      ? `Cierre previsto en ${closeDays} días.`
      : `Sin actualización comercial hace ${staleDays} días.`;
    signals.push({ code: "opportunity_needs_attention", severity: "high", title: `Revisar oportunidad: ${opportunity.name}`, summary: "La oportunidad tiene una señal determinística de riesgo.", evidence: reason, source: "crm:opportunities", entityType: "opportunity", entityId: opportunity.id });
  }
  for (const renewal of renewals.filter((item) => daysSince(item.expiresAt, nowTimestamp) !== null && daysSince(item.expiresAt, nowTimestamp) <= 90).slice(0, 5)) {
    const expiryDays = daysSince(renewal.expiresAt, nowTimestamp);
    signals.push({ code: "renewal_due_soon", severity: "medium", title: `Renovación próxima: ${renewal.providerName}`, summary: "Existe un registro de fabricante cercano a su fecha de vencimiento.", evidence: `Vencimiento previsto en ${expiryDays} días.`, source: "crm:manufacturer_registrations", entityType: "opportunity", entityId: renewal.opportunityId });
  }

  const highCount = signals.filter((signal) => signal.severity === "high").length;
  const mediumCount = signals.filter((signal) => signal.severity === "medium").length;
  const score = Math.max(0, 100 - highCount * 25 - mediumCount * 10 - signals.filter((signal) => signal.severity === "low").length * 5);
  return {
    status: !account ? "insufficient_data" : highCount ? "at_risk" : mediumCount ? "attention" : "healthy",
    score,
    signals,
    metrics: {
      contactCount: contacts.length,
      opportunityCount: opportunities.length,
      riskyOpportunityCount: riskyOpportunities.length,
      interactionCount: interactions.length,
      daysSinceLastInteraction,
      renewalCount: renewals.length,
      productCount: products.length,
    },
  };
}

export function buildExpansionHypotheses({ products = [], renewals = [], catalogItems = [], opportunities = [] }) {
  const hypotheses = [];
  const opportunityId = opportunities[0]?.id || null;
  for (const renewal of renewals.filter((item) => item.expiresAt)) {
    hypotheses.push({ type: "renewal", title: `Preparar renovación de ${renewal.providerName}`, summary: "El registro tiene una fecha de vencimiento y requiere validar continuidad.", evidence: `Vencimiento: ${renewal.expiresAt}.`, confidence: "high", sourceProductCode: null, suggestedProductCode: null, suggestedProductDescription: null, opportunityId: renewal.opportunityId || opportunityId, requiresConfirmation: true });
  }
  const existingCodes = new Set(products.map((product) => product.productCode).filter(Boolean));
  const sameProvider = catalogItems.filter((item) => products.some((product) => Number(product.providerId) === Number(item.providerId)) && !existingCodes.has(item.code));
  const otherProvider = catalogItems.filter((item) => !products.some((product) => Number(product.providerId) === Number(item.providerId)) && !existingCodes.has(item.code));
  const sourceProduct = products[0] || null;
  if (sourceProduct && sameProvider[0]) hypotheses.push({ type: "upsell", title: `Explorar ampliación de ${sourceProduct.description}`, summary: "Existe otra oferta activa del mismo proveedor que podría complementar o ampliar la solución actual.", evidence: `Producto actual: ${sourceProduct.description}; alternativa: ${sameProvider[0].description}.`, confidence: "low", sourceProductCode: sourceProduct.productCode || null, suggestedProductCode: sameProvider[0].code, suggestedProductDescription: sameProvider[0].description, opportunityId, requiresConfirmation: true });
  if (sourceProduct && otherProvider[0]) hypotheses.push({ type: "cross_sell", title: `Explorar solución complementaria: ${otherProvider[0].description}`, summary: "Existe una oferta de otro proveedor que puede evaluarse como complemento, no como hecho confirmado.", evidence: `Producto actual: ${sourceProduct.description}; catálogo complementario: ${otherProvider[0].description}.`, confidence: "low", sourceProductCode: sourceProduct.productCode || null, suggestedProductCode: otherProvider[0].code, suggestedProductDescription: otherProvider[0].description, opportunityId, requiresConfirmation: true });
  const seen = new Set();
  return hypotheses.filter((hypothesis) => {
    const key = `${hypothesis.type}:${hypothesis.sourceProductCode || ""}:${hypothesis.suggestedProductCode || ""}:${hypothesis.opportunityId || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

export async function buildAuthorizedCustomerSnapshot({ user, accountId, opportunityId, contactId }) {
  const normalizedAccountId = Number(accountId || 0);
  const normalizedOpportunityId = Number(opportunityId || 0);
  const normalizedContactId = Number(contactId || 0);

  if (!normalizedAccountId && !normalizedOpportunityId && !normalizedContactId) {
    throw createHttpError(400, "Selecciona una cuenta, oportunidad o contacto");
  }

  const [account, opportunity, contact] = await Promise.all([
    normalizedAccountId
      ? getAccessibleAccount({ user, accountId: normalizedAccountId })
      : Promise.resolve(null),
    normalizedOpportunityId
      ? getAccessibleOpportunity({ user, opportunityId: normalizedOpportunityId })
      : Promise.resolve(null),
    normalizedContactId
      ? getAccessibleContact({ user, contactId: normalizedContactId })
      : Promise.resolve(null),
  ]);

  const resolvedAccountId = resolveAccountId({ account, opportunity, contact });
  let resolvedAccount = account;
  if (!resolvedAccount && resolvedAccountId) {
    resolvedAccount = await getAccessibleAccount({ user, accountId: resolvedAccountId });
  }

  if (account && opportunity && Number(opportunity.account_id) !== Number(account.id)) {
    throw createHttpError(400, "La oportunidad no pertenece a la cuenta seleccionada");
  }
  if (account && contact && Number(contact.account_id) !== Number(account.id)) {
    throw createHttpError(400, "El contacto no pertenece a la cuenta seleccionada");
  }

  const relatedContacts =
    resolvedAccountId && hasReadPermission(user, "contactos")
      ? await query(
          `SELECT c.id, c.account_id, c.first_name, c.last_name, c.email, c.phone,
                  c.mobile, c.position_title, c.department
           FROM contacts c
           INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
           WHERE c.account_id = ? AND cas.code = 'activado'
             ${hasReadAllPermission(user, "cuentas") ? "" : "AND EXISTS (SELECT 1 FROM account_owners ao_contact_scope WHERE ao_contact_scope.account_id = c.account_id AND ao_contact_scope.user_id = ?)"}
           ORDER BY c.first_name, c.last_name
           LIMIT 50`,
          hasReadAllPermission(user, "cuentas") ? [resolvedAccountId] : [resolvedAccountId, Number(user.id)],
        ).catch(() => [])
      : [];

  const relatedOpportunities =
    resolvedAccountId && hasReadPermission(user, "oportunidades")
      ? await query(
          `SELECT o.id, o.name, o.account_id, o.contact_id, o.amount_usd, o.close_date, o.updated_at,
                  oss.code AS stage_code, oss.name AS stage_name,
                  ocs.code AS commercial_status_code
           FROM opportunities o
           INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
           INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
           INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
           WHERE o.account_id = ? AND oas.code = 'activada'
             ${hasReadAllPermission(user, "oportunidades") ? "" : "AND (EXISTS (SELECT 1 FROM account_owners ao_opportunity_scope WHERE ao_opportunity_scope.account_id = o.account_id AND ao_opportunity_scope.user_id = ?) OR o.created_by = ? OR o.seller_user_id = ?)"}
           ORDER BY o.close_date IS NULL, o.close_date ASC, o.amount_usd DESC
           LIMIT 50`,
          hasReadAllPermission(user, "oportunidades")
            ? [resolvedAccountId]
            : [resolvedAccountId, Number(user.id), Number(user.id), Number(user.id)],
        ).catch(() => [])
      : [];

  const relatedInteractions =
    resolvedAccountId && hasReadPermission(user, "interacciones")
      ? await query(
          `SELECT i.id, i.title, i.analysis_status, i.summary, i.source_notes,
                  i.lead_substatus_code, i.lead_reason_code, i.lead_required_action_code,
                  i.lead_next_action_due_at, i.updated_at, i.created_at
           FROM interactions i
           WHERE i.account_id = ? OR i.primary_opportunity_id IN (
             SELECT o.id FROM opportunities o WHERE o.account_id = ?
           )
           ORDER BY i.updated_at DESC, i.created_at DESC
           LIMIT 30`,
          [resolvedAccountId, resolvedAccountId],
        ).catch(() => [])
      : [];

  let relatedRenewals = [];
  if (resolvedAccountId && hasReadPermission(user, "oportunidades")) {
    await ensureManufacturerRegistrationsSchema();
    relatedRenewals = await query(
      `SELECT r.id, r.opportunity_id, r.provider_id, p.name AS provider_name,
              r.status_code, r.expires_at, r.renewal_count, r.last_renewed_at, r.notes
       FROM opportunity_manufacturer_registrations r
       INNER JOIN opportunities o ON o.id = r.opportunity_id
       INNER JOIN providers p ON p.id = r.provider_id
       INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
       WHERE o.account_id = ? AND oas.code = 'activada'
       ORDER BY r.expires_at IS NULL, r.expires_at ASC, r.id DESC
       LIMIT 50`,
      [resolvedAccountId],
    ).catch(() => []);
  }

  const relatedProducts = resolvedAccountId && hasReadPermission(user, "oportunidades")
    ? await query(
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
         INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
         WHERE o.account_id = ? AND oas.code = 'activada'
           AND qs.code IN ('ganada', 'aceptada')
         ORDER BY qv.quotation_date DESC, qsi.display_order ASC
         LIMIT 200`,
        [resolvedAccountId],
      ).catch(() => [])
    : [];
  const catalogItems = resolvedAccountId && hasReadPermission(user, "oportunidades")
    ? await query(`SELECT ppli.provider_id AS providerId, ppli.code, ppli.description FROM provider_price_list_items ppli INNER JOIN provider_price_lists ppl ON ppl.id = ppli.price_list_id INNER JOIN provider_price_list_item_statuses ps ON ps.id = ppli.activation_status_id WHERE ppl.is_active = 1 AND ps.is_active = 1 ORDER BY ppli.updated_at DESC LIMIT 100`).catch(() => [])
    : [];

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
        }
      : null,
    selectedContact: contact
      ? {
          id: Number(contact.id),
          accountId: Number(contact.account_id),
          name: [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim(),
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
    })),
    opportunities: relatedOpportunities.map((item) => ({
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
    })),
    interactions: relatedInteractions.map((item) => ({
      id: Number(item.id),
      title: item.title || "",
      analysisStatus: item.analysis_status || "",
      summary: clip(item.summary, 1200),
      sourceNotes: clip(item.source_notes, 1200),
      leadSubstatusCode: item.lead_substatus_code || "",
      leadReasonCode: item.lead_reason_code || "",
      leadRequiredActionCode: item.lead_required_action_code || "",
      leadNextActionDueAt: item.lead_next_action_due_at || null,
      updatedAt: item.updated_at || item.created_at || null,
    })),
    activities: relatedInteractions.map((item) => ({
      id: Number(item.id),
      title: item.title || "",
      analysisStatus: item.analysis_status || "",
      summary: clip(item.summary, 1200),
      sourceNotes: clip(item.source_notes, 1200),
      leadSubstatusCode: item.lead_substatus_code || "",
      leadReasonCode: item.lead_reason_code || "",
      leadRequiredActionCode: item.lead_required_action_code || "",
      leadNextActionDueAt: item.lead_next_action_due_at || null,
      updatedAt: item.updated_at || item.created_at || null,
    })),
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
    products: relatedProducts.map((item) => ({
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
      listPriceUnit: item.list_price_unit === null ? null : Number(item.list_price_unit),
      currencyCode: item.currency_code || null,
      commercialStatus: item.quotation_status === "ganada" ? "won" : "accepted",
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
    },
  };
  normalizedData.expansionHypotheses = buildExpansionHypotheses({ products: normalizedData.products, renewals: normalizedData.renewals, catalogItems, opportunities: normalizedData.opportunities });
  return normalizeCustomerIntelligenceSnapshot({
    ...normalizedData,
    accountHealth: buildAccountHealth(normalizedData),
  });
}

function buildFinding({ category, title, summary, evidenceText, sourceType = "crm", sourceReference = "CRM", confidence = "medium", certainty = "evidenced", metadata = {} }) {
  const normalizedCategory = FINDING_CATEGORIES.has(category)
    ? category
    : "missing_information";
  const finding = {
    sourceDomain: sourceType === "tavily" || sourceType === "public_web" ? "public_web" : "crm_internal",
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
  const opportunities = Array.isArray(snapshot.opportunities) ? snapshot.opportunities : [];
  const interactions = Array.isArray(snapshot.interactions) ? snapshot.interactions : [];

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
        summary: "No hay una descripcion suficiente del negocio del cliente. Conviene documentar que hace, como opera y que resultado espera lograr.",
        evidenceText: "Campo description de cuenta vacio o no disponible.",
        sourceReference: `account:${account.id}`,
        confidence: "high",
        certainty: "confirmed",
      }),
    );
  }

  if (contacts.length) {
    const namedContacts = contacts.slice(0, 5).map((contact) =>
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
  } else if (snapshot.permissions.canReadContacts) {
    findings.push(
      buildFinding({
        category: "missing_information",
        title: "No hay contactos activos documentados",
        summary: "La cuenta no tiene contactos activos accesibles. El siguiente paso comercial deberia identificar responsable tecnico, usuario final y responsable economico.",
        evidenceText: "Consulta de contactos activos sin resultados.",
        sourceReference: `account:${account?.id || selectedOpportunity?.accountId}:contacts`,
        confidence: "high",
        certainty: "confirmed",
      }),
    );
  }

  if (opportunities.length) {
    const openPipeline = opportunities.reduce(
      (sum, opportunity) => sum + Number(opportunity.amountUsd || 0),
      0,
    );
    findings.push(
      buildFinding({
        category: "technology_project",
        title: "Oportunidades activas como senales de proyecto",
        summary: `La cuenta tiene ${opportunities.length} oportunidad(es) activa(s), por un pipeline aproximado de ${openPipeline.toFixed(2)} USD.`,
        evidenceText: opportunities
          .slice(0, 5)
          .map((opportunity) => `${opportunity.name} (${opportunity.stageName || "sin etapa"})`)
          .join("; "),
        sourceReference: `account:${account?.id || selectedOpportunity?.accountId}:opportunities`,
        confidence: "high",
        certainty: "confirmed",
        metadata: { opportunityCount: opportunities.length, openPipelineUsd: openPipeline },
      }),
    );
  } else if (snapshot.permissions.canReadOpportunities) {
    findings.push(
      buildFinding({
        category: "missing_information",
        title: "No hay oportunidades activas visibles",
        summary: "No se encontraron oportunidades activas para esta cuenta. Conviene validar necesidades actuales antes de crear una oportunidad nueva.",
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
          .map((interaction) => `${interaction.title}: ${interaction.summary || interaction.sourceNotes || "sin resumen"}`)
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
        summary: "No se encontraron interacciones recientes. Conviene registrar la proxima conversacion para alimentar el descubrimiento comercial.",
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
  const missingCount = findings.filter((finding) => finding.category === "missing_information").length;
  const confirmedCount = findings.filter((finding) => finding.certainty === "confirmed").length;
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
      opportunities: snapshot.opportunities.length,
      interactions: snapshot.interactions.length,
    },
  };
}

function buildDiscoveryQuestions(snapshot, findings) {
  const questions = [];
  const hasContacts = snapshot.contacts.length > 0;
  const hasOpportunities = snapshot.opportunities.length > 0;
  const missingFindings = findings.filter(
    (finding) => finding.category === "missing_information",
  );

  if (!hasContacts) {
    questions.push("¿Quién es el responsable técnico y quién aprueba presupuesto para esta iniciativa?");
  }
  if (!hasOpportunities) {
    questions.push("¿Qué iniciativa o problema de negocio deberíamos convertir en una oportunidad concreta?");
  }
  if (snapshot.selectedOpportunity) {
    questions.push(`¿Qué condición debe cumplirse para avanzar la oportunidad ${snapshot.selectedOpportunity.name} a la siguiente etapa?`);
    questions.push("¿Cuál es el criterio de éxito que el cliente usará para evaluar la solución?");
  }
  if (missingFindings.length) {
    questions.push("¿Qué información falta para validar necesidad, impacto, presupuesto y fecha objetivo?");
  }
  questions.push("¿Qué pasa en la operación del cliente si este reto no se atiende durante el trimestre?");
  questions.push("¿Qué áreas además de TI se ven afectadas por este problema?");

  return Array.from(new Set(questions)).slice(0, 6);
}

function buildDiscoveryRisks(snapshot, findings) {
  const risks = [];
  if (!snapshot.contacts.length) {
    risks.push("No hay contactos activos documentados; el siguiente contacto puede no llegar al decisor correcto.");
  }
  if (!snapshot.opportunities.length) {
    risks.push("No hay oportunidad activa visible; la conversación puede quedarse en exploración sin avance comercial.");
  }
  if (findings.some((finding) => finding.category === "missing_information")) {
    risks.push("Existen huecos de información que pueden debilitar la calificación de necesidad, impacto o presupuesto.");
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
      successCriteria: "Validar necesidad, decisor, impacto de negocio y siguiente hito con fecha.",
      notes: "Preparada desde inteligencia comercial interna de Mi Coach.",
    });
  }
  if (findings.some((finding) => finding.category === "missing_information")) {
    nextSteps.push({
      title: "Completar huecos de información del cliente",
      actionType: "next_step",
      priority: "medium",
      opportunityId: snapshot.selectedOpportunity?.id || null,
      successCriteria: "Registrar contactos clave, área dueña, necesidad y criterio de éxito.",
      notes: "Usar las preguntas sugeridas por el briefing comercial.",
    });
  }
  nextSteps.push({
    title: "Enviar resumen de descubrimiento y próximos pasos",
    actionType: "send_email",
    priority: "medium",
    opportunityId: snapshot.selectedOpportunity?.id || null,
    successCriteria: "Obtener confirmación del cliente sobre necesidad, responsables y fecha de seguimiento.",
    notes: "Personalizar el correo sugerido antes de enviarlo.",
  });
  return nextSteps.slice(0, 4);
}

export function generateCommercialDiscoveryResult(snapshot, findings = []) {
  const accountName = snapshot.account?.name || "el cliente";
  const questions = buildDiscoveryQuestions(snapshot, findings);
  const risks = buildDiscoveryRisks(snapshot, findings);
  const nextSteps = buildDiscoveryNextSteps(snapshot, findings);
  const confirmedFindings = findings.filter((finding) => finding.certainty === "confirmed");
  const missingFindings = findings.filter((finding) => finding.category === "missing_information");
  const primaryContact = snapshot.selectedContact || snapshot.contacts[0] || null;
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
      knownContext: confirmedFindings.slice(0, 4).map((finding) => finding.summary),
      missingInformation: missingFindings.slice(0, 5).map((finding) => finding.title),
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
  const risks = health.signals.filter((signal) => ["high", "medium"].includes(signal.severity)).slice(0, 5);
  const latestInteractions = snapshot.interactions.slice(0, 3).map((item) => item.summary || item.title).filter(Boolean);
  const questions = [
    "¿Qué cambió en las prioridades del cliente desde la última conversación?",
    "¿Quién decide, quién influye y qué condición habilita el siguiente paso?",
    "¿Cuál es la fecha crítica y cómo se validará el resultado esperado?",
  ];
  return {
    headline: `Resumen ejecutivo de ${snapshot.account?.name || "la cuenta"}`,
    summary: `La cuenta presenta salud ${health.status} con score ${health.score}/100, ${snapshot.opportunities.length} oportunidad(es) abierta(s), ${snapshot.contacts.length} contacto(s) y ${snapshot.interactions.length} interacción(es) recientes.`,
    executiveBriefing: {
      accountName: snapshot.account?.name || "Cuenta sin nombre",
      healthStatus: health.status,
      healthScore: health.score,
      knownContext: findings.filter((finding) => finding.certainty === "confirmed").slice(0, 5).map((finding) => finding.summary),
      recentChanges: latestInteractions,
      prioritizedRisks: risks.map((signal) => ({ title: signal.title, summary: signal.summary, evidence: signal.evidence, severity: signal.severity })),
      meetingQuestions: questions,
      nextBestStep: risks[0]?.title || (snapshot.opportunities[0] ? `Dar seguimiento a ${snapshot.opportunities[0].name}` : "Identificar la próxima iniciativa comercial del cliente"),
      recommendedActions: snapshot.selectedOpportunity || snapshot.opportunities[0] ? [{
        title: risks[0]?.title || "Agendar seguimiento comercial",
        actionType: "call",
        priority: risks[0]?.severity === "high" ? "high" : "medium",
        opportunityId: String(snapshot.selectedOpportunity?.id || snapshot.opportunities[0]?.id || ""),
        notes: "Acción sugerida por el resumen ejecutivo de Mi Coach.",
        successCriteria: "Confirmar necesidad, responsable y siguiente hito con fecha.",
      }] : [],
      evidence: risks.map((signal) => signal.evidence),
    },
    generatedAt: new Date().toISOString(),
  };
}

function agentResult(agentId, summary, findings = [], evidence = [], confidence = "medium", requiresConfirmation = false) {
  const sourceDomain = agentId === "public_research" || agentId === "contact_research" || agentId === "technology_research" ? "public_web" : "crm_internal";
  return { agentId, status: "completed", summary, findings, evidence, confidence, requiresConfirmation, sourceDomain, durationMs: 0, sourceCount: evidence.length };
}

async function runPublicSpecialistAgent({ agentId, subject, queryText, queryTexts = [], systemPrompt, fields, snapshot, user, jobId, category }) {
  const searches = [queryText, ...queryTexts].filter(Boolean).map((query) => searchTavily({ query }));
  const tavilyResults = await Promise.all(searches);
  const tavily = {
    enabled: tavilyResults.some((result) => result.enabled),
    results: tavilyResults.flatMap((result) => result.results || []).filter((result, index, results) => results.findIndex((candidate) => candidate.url === result.url) === index),
    warnings: tavilyResults.flatMap((result) => result.warnings || []),
  };
  if (!tavily.enabled || !tavily.results.length) {
    return agentResult(agentId, "No se encontraron fuentes públicas para este agente.", [], tavily.warnings || [], "low");
  }
  const result = await runStructuredTextResearch({
    schemaName: `account_${agentId}`,
    systemPrompt,
    subject,
    context: { account: snapshot.account, existingContacts: snapshot.contacts, existingProducts: snapshot.products, publicSources: tavily.results },
    currentValues: {},
    fields,
    aiUsageContext: { userId: Number(user.id), featureCode: `commercial_intelligence.${agentId}`, jobType: "agent_orchestration", jobId },
  });
  if (!result) return agentResult(agentId, "No fue posible interpretar las fuentes públicas.", [], tavily.warnings || [], "low");
  let rawItems = Array.isArray(result.items) ? result.items : [];
  let enrichmentSources = [];
  if (agentId === "contact_research" && rawItems.length) {
    const candidates = rawItems.filter((item) => item?.firstName && item?.lastName).slice(0, 10);
    const enrichmentResults = await Promise.all(candidates.map((item) => searchTavily({
      query: `site:linkedin.com/in "${item.firstName} ${item.lastName}" "${subject}" email teléfono contacto`,
      maxResults: 5,
    })));
    enrichmentSources = enrichmentResults
      .flatMap((search) => search.results || [])
      .filter((source, index, sources) => sources.findIndex((candidate) => candidate.url === source.url) === index);
    if (enrichmentSources.length) {
      const enriched = await runStructuredTextResearch({
        schemaName: "account_contact_enrichment",
        systemPrompt: "Enriquece contactos candidatos usando únicamente las fuentes públicas proporcionadas. Solo devuelve email o teléfono si aparecen explícitamente en la evidencia. Conserva nombre y cargo si están sustentados; no inventes datos.",
        subject,
        context: { candidateContacts: candidates, publicSources: enrichmentSources },
        currentValues: {},
        fields,
        aiUsageContext: { userId: Number(user.id), featureCode: "commercial_intelligence.contact_enrichment", jobType: "agent_orchestration", jobId },
      });
      if (Array.isArray(enriched?.items) && enriched.items.length) rawItems = enriched.items;
    }
  }
  const findings = rawItems.map((item, index) => normalizeCustomerExternalFinding({
    category,
    title: item.title || `${agentId} ${index + 1}`,
    summary: item.summary || item.businessChallenge || item.roleTitle || "Señal pública",
    evidenceText: item.evidence || item.evidenceText || "Evidencia pública recuperada por Tavily.",
    sourceUrl: item.sourceUrl || "",
    confidence: item.confidence || "medium",
    targetEntity: agentId === "contact_research" ? "contact" : "account",
    targetField: agentId === "contact_research" ? "positionTitle" : "description",
    suggestedValue: item.suggestedValue || item.summary || item.businessChallenge || "",
    contactData: agentId === "contact_research" ? {
      firstName: item.firstName || "",
      lastName: item.lastName || "",
      positionTitle: item.positionTitle || "",
      department: item.department || "",
      email: item.email || "",
      phone: item.phone || "",
      mobile: item.mobile || "",
    } : null,
  }, index, "tavily"));
  return agentResult(agentId, `${findings.length} resultado(s) públicos encontrados${enrichmentSources.length ? " y enriquecidos por candidato" : ""}.`, findings, [...tavily.results, ...enrichmentSources].map((source) => source.url), findings.length ? "medium" : "low", true);
}

export async function runAccountIntelligenceAgents(snapshot, { includePublicResearch = false, user = null, jobId = null } = {}) {
  const crmFindings = generateCustomerIntelligenceFindings(snapshot);
  const healthFindings = snapshot.accountHealth.signals.map((signal) => normalizeCustomerIntelligenceFinding({
    category: signal.severity === "high" ? "risk" : "missing_information",
    title: signal.title,
    summary: signal.summary,
    evidence: signal.evidence,
    source: signal.source,
    sourceUrl: "",
    confidence: signal.severity === "high" ? "high" : "medium",
    certainty: "confirmed",
  }));
  const expansionFindings = snapshot.expansionHypotheses.map((hypothesis) => normalizeCustomerIntelligenceFinding({
    category: hypothesis.type === "renewal" ? "renewal" : "expansion",
    title: hypothesis.title,
    summary: hypothesis.summary,
    evidence: hypothesis.evidence,
    source: "crm:expansion_hypotheses",
    confidence: hypothesis.confidence,
    certainty: "inferred",
  }));
  const actionFindings = snapshot.expansionHypotheses.slice(0, 5).map((hypothesis) => normalizeCustomerIntelligenceFinding({
    category: "next_step",
    title: hypothesis.title,
    summary: "Revisar esta hipótesis con el cliente antes de crear o ampliar una oportunidad.",
    evidence: hypothesis.evidence,
    source: "agent:actions",
    confidence: "medium",
    certainty: "inferred",
    requiresConfirmation: true,
  }));
  let publicAgent = agentResult("public_research", includePublicResearch ? "La investigación pública se ejecutó mediante Tavily." : "Investigación pública no solicitada en esta ejecución.", [], [], includePublicResearch ? "medium" : "low");
  let contactAgent = agentResult("contact_research", "Búsqueda de contactos públicos no solicitada en esta ejecución.", [], [], "low", true);
  let technologyAgent = agentResult("technology_research", "Búsqueda de iniciativas tecnológicas no solicitada en esta ejecución.", [], [], "low", true);
  if (includePublicResearch && user) {
    const external = await runCustomerExternalResearch({ snapshot, user, jobId });
    publicAgent = agentResult("public_research", external.enabled ? `Tavily recuperó ${external.findings.length} hallazgo(s).` : "Tavily no pudo recuperar fuentes públicas.", external.findings, external.warnings, external.enabled ? "medium" : "low");
    [contactAgent, technologyAgent] = await Promise.all([
      runPublicSpecialistAgent({
        agentId: "contact_research",
        subject: snapshot.account?.name || "cuenta",
        queryText: String(snapshot.account?.name || "empresa") + " tecnología seguridad infraestructura operaciones arquitectura producto innovación transformación digital responsables líderes de proyecto contactos",
        queryTexts: [
          `site:linkedin.com/in "${snapshot.account?.name || "empresa"}" tecnología OR seguridad OR infraestructura OR operaciones`,
          `site:linkedin.com/in "${snapshot.account?.name || "empresa"}" ${PUBLIC_CONTACT_ROLE_TERMS.join(" OR ")}`,
        ],
        systemPrompt: "Extrae únicamente contactos profesionales públicamente identificables. Exige nombre y apellido; no inventes emails ni teléfonos. Devuelve solo personas con cargo, área, evidencia y URL.",
        fields: [{ key: "items", type: "array", example: [], items: { type: "object", fields: [{ key: "firstName", type: "string", example: "Ana" }, { key: "lastName", type: "string", example: "Pérez" }, { key: "positionTitle", type: "string", example: "CTO" }, { key: "department", type: "string", example: "Tecnología" }, { key: "email", type: "string", example: "" }, { key: "phone", type: "string", example: "" }, { key: "mobile", type: "string", example: "" }, { key: "title", type: "string", example: "Contacto público" }, { key: "summary", type: "string", example: "Persona identificada" }, { key: "evidence", type: "string", example: "Evidencia" }, { key: "sourceUrl", type: "string", example: "https://example.com" }, { key: "confidence", type: "enum", enum: ["high", "medium", "low"], example: "medium" }] } }],
        snapshot, user, jobId, category: "stakeholder",
      }),
      runPublicSpecialistAgent({
        agentId: "technology_research",
        subject: snapshot.account?.name || "cuenta",
        queryText: String(snapshot.account?.name || "empresa") + " tecnología que usa implementación arquitectura cloud ciberseguridad aplicaciones Kubernetes networking DNS DHCP IPAM APIs",
        queryTexts: [
          `"${snapshot.account?.name || "empresa"}" cloud OR AWS OR Azure OR Google Cloud OR multinube implementa usa arquitectura`,
          `"${snapshot.account?.name || "empresa"}" ciberseguridad OR SOC OR firewall OR WAF OR IAM usa implementa`,
          `"${snapshot.account?.name || "empresa"}" aplicaciones OR microservicios OR APIs OR integración tecnológica`,
          `"${snapshot.account?.name || "empresa"}" Kubernetes OR contenedores OR Docker OR OpenShift`,
          `"${snapshot.account?.name || "empresa"}" networking OR redes OR DNS OR DHCP OR IPAM`,
        ],
        systemPrompt: "Identifica únicamente tecnologías que la cuenta usa, implementa, migra, opera o anuncia públicamente. Prioriza cloud, ciberseguridad, aplicaciones, Kubernetes, networking, DNS, DHCP, IPAM y APIs. No devuelvas tendencias generales ni tecnologías que solo sean relevantes para el sector; cada resultado debe indicar la tecnología concreta, cómo se relaciona con la cuenta, evidencia, URL y confianza. No conviertas una inferencia en hecho.",
        fields: [{ key: "items", type: "array", example: [], items: { type: "object", fields: [{ key: "title", type: "string", example: "Iniciativa cloud" }, { key: "summary", type: "string", example: "Resumen" }, { key: "businessChallenge", type: "string", example: "Reto de negocio" }, { key: "evidence", type: "string", example: "Evidencia" }, { key: "sourceUrl", type: "string", example: "https://example.com" }, { key: "confidence", type: "enum", enum: ["high", "medium", "low"], example: "medium" }] } }],
        snapshot, user, jobId, category: "technology_project",
      }),
    ]);
  }
  const synthesis = agentResult("synthesis", `Síntesis coordinada con ${crmFindings.length} hallazgo(s) CRM, ${healthFindings.length} señal(es) de salud, ${expansionFindings.length} hipótesis de expansión y ${publicAgent.findings.length} hallazgo(s) públicos.`, deduplicateCustomerIntelligenceFindings([...crmFindings, ...healthFindings, ...expansionFindings, ...publicAgent.findings]).slice(0, 20), [...publicAgent.evidence], "medium");
  const derivedActionFindings = [...actionFindings, ...healthFindings.filter((finding) => finding.category === "risk").slice(0, 5).map((finding) => normalizeCustomerIntelligenceFinding({ category: "next_step", title: `Atender: ${finding.title}`, summary: "Revisar esta señal antes de avanzar comercialmente.", evidence: finding.evidence, source: "agent:actions", confidence: "medium", certainty: "inferred", requiresConfirmation: true }))];
  const agents = [
    agentResult("crm_context", `Contexto CRM: ${snapshot.contacts.length} contactos, ${snapshot.opportunities.length} oportunidades y ${snapshot.interactions.length} interacciones.`, crmFindings, [snapshot.account?.name || "Cuenta"], "high"),
    agentResult("commercial_health", `Salud comercial: ${snapshot.accountHealth.status} (${snapshot.accountHealth.score}/100).`, healthFindings, snapshot.accountHealth.signals.map((signal) => signal.evidence), snapshot.accountHealth.status === "at_risk" ? "high" : "medium"),
    publicAgent,
    contactAgent,
    technologyAgent,
    agentResult("expansion", `Se identificaron ${snapshot.expansionHypotheses.length} hipótesis de renovación o expansión.`, expansionFindings, snapshot.expansionHypotheses.map((item) => item.evidence), "medium", true),
    synthesis,
    agentResult("actions", `${derivedActionFindings.length} acción(es) requieren revisión humana.`, derivedActionFindings, derivedActionFindings.map((item) => item.evidence), "medium", true),
  ];
  return agents.map((agent) => ({ ...agent, durationMs: 0, sourceCount: agent.evidence.length }));
}

export async function createAccountIntelligenceAgentsJob({ user, payload }) {
  await ensureCommercialIntelligenceSchema();
  const snapshot = await buildAuthorizedCustomerSnapshot({ user, ...payload });
  const result = await query(`INSERT INTO customer_intelligence_jobs (public_id, account_id, opportunity_id, contact_id, requested_by_user_id, job_type, status, request_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'agent_orchestration', 'pending', ?, NOW(3), NOW(3))`, [`cia_${randomUUID()}`, snapshot.account?.id || null, snapshot.selectedOpportunity?.id || null, snapshot.selectedContact?.id || null, Number(user.id), JSON.stringify(payload)]);
  return { job: { id: Number(result.insertId), status: "pending", pollAfterMs: 500 }, snapshot };
}

export async function processAccountIntelligenceAgentsJob({ jobId, user }) {
  const rows = await query(`SELECT * FROM customer_intelligence_jobs WHERE id = ? AND requested_by_user_id = ? AND job_type = 'agent_orchestration' LIMIT 1`, [Number(jobId), Number(user.id)]);
  const job = rows[0];
  if (!job) return null;
  const snapshot = await buildAuthorizedCustomerSnapshot({ user, accountId: job.account_id, opportunityId: job.opportunity_id, contactId: job.contact_id });
  const request = parseJson(job.request_json, {});
  if (request?.includePublicResearch) {
    if (!hasPermission(user, "fuentes_externas.execute")) throw createHttpError(403, "No autorizado", { requiredPermission: "fuentes_externas.execute" });
    await assertExternalResearchGovernance(user);
  }
  const startedAt = Date.now();
  const includePublicResearch = Boolean(request?.includePublicResearch);
  try {
    const agents = await runAccountIntelligenceAgents(snapshot, { includePublicResearch, user, jobId });
    const elapsed = Date.now() - startedAt;
    const result = normalizeCustomerIntelligenceOrchestration({
      sourceDomain: includePublicResearch ? "public_web" : "crm_internal",
      orchestrationVersion: "account-intelligence.agents.v1",
      agents: agents.map((agent) => ({ ...agent, durationMs: agent.durationMs || elapsed })),
      generatedAt: new Date().toISOString(),
      writesPerformed: false,
    });
    result.telemetry = { durationMs: elapsed, sourceCount: agents.reduce((sum, agent) => sum + agent.evidence.length, 0), findingCount: agents.reduce((sum, agent) => sum + agent.findings.length, 0), writesPerformed: false };
    await query(`UPDATE customer_intelligence_jobs SET status = 'completed', result_json = ?, error_message = NULL, updated_at = NOW(3), finished_at = NOW(3) WHERE id = ?`, [JSON.stringify(result), Number(jobId)]);
    return { ...mapJobRow({ ...job, status: "completed", result_json: JSON.stringify(result) }), result };
  } catch (error) {
    await query(`UPDATE customer_intelligence_jobs SET status = 'failed', error_message = ?, updated_at = NOW(3), finished_at = NOW(3) WHERE id = ?`, [clip(error?.message || "No fue posible ejecutar los agentes especializados", 1000), Number(jobId)]).catch(() => undefined);
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
    jobs: rows.map((row) => ({ status: row.status, jobType: row.job_type, total: Number(row.total || 0) })),
    aiUsage: { requests: Number(usageRows[0]?.requests || 0), tokens: Number(usageRows[0]?.tokens || 0), costMicros: Number(usageRows[0]?.costMicros || 0) },
  };
}

function buildAccountChatFallback(snapshot, question) {
  const normalized = String(question || "").toLowerCase();
  const risk = snapshot.accountHealth.signals.find((signal) => signal.severity === "high") || snapshot.accountHealth.signals[0];
  const answer = normalized.includes("riesgo")
    ? (risk?.summary || "No se detectaron riesgos determinísticos en el contexto disponible.")
    : normalized.includes("contact")
      ? `La cuenta tiene ${snapshot.contacts.length} contacto(s) accesible(s). ${snapshot.contacts.slice(0, 3).map((contact) => contact.name || "Contacto sin nombre").join(", ") || "No hay contactos documentados."}`
      : normalized.includes("oportun")
        ? `La cuenta tiene ${snapshot.opportunities.length} oportunidad(es) abierta(s): ${snapshot.opportunities.slice(0, 3).map((opportunity) => opportunity.name).join(", ") || "ninguna"}.`
        : `La cuenta ${snapshot.account?.name || "seleccionada"} tiene salud ${snapshot.accountHealth.status} (${snapshot.accountHealth.score}/100), ${snapshot.contacts.length} contacto(s), ${snapshot.opportunities.length} oportunidad(es) y ${snapshot.interactions.length} interacción(es) recientes.`;
  return { answer, evidence: [risk?.evidence, `Snapshot capturado: ${snapshot.capturedAt}`].filter(Boolean), confidence: risk ? "medium" : "low", recommendedActions: risk ? [{ title: risk.title, opportunityId: risk.entityType === "opportunity" ? risk.entityId : snapshot.opportunities[0]?.id || null, actionType: "call", notes: "Revisar desde Cliente existente.", successCriteria: "Validar la señal con el cliente.", requiresConfirmation: true }] : [], source: "account_intelligence" };
}

export async function createCustomerAccountChatJob({ user, payload }) {
  await ensureCommercialIntelligenceSchema();
  if (payload.includePublicResearch) {
    if (!hasPermission(user, "fuentes_externas.execute")) throw createHttpError(403, "No autorizado", { requiredPermission: "fuentes_externas.execute" });
    await assertExternalResearchGovernance(user);
  }
  const snapshot = await buildAuthorizedCustomerSnapshot({ user, ...payload });
  const result = await query(`INSERT INTO customer_intelligence_jobs (public_id, account_id, opportunity_id, contact_id, requested_by_user_id, job_type, status, request_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'account_chat', 'pending', ?, NOW(3), NOW(3))`, [`cac_${randomUUID()}`, snapshot.account?.id || null, snapshot.selectedOpportunity?.id || null, snapshot.selectedContact?.id || null, Number(user.id), JSON.stringify({ ...payload, question: payload.question })]);
  return { job: { id: Number(result.insertId), status: "pending", pollAfterMs: 700 }, snapshot };
}

export async function processCustomerAccountChatJob({ jobId, user }) {
  const rows = await query(`SELECT * FROM customer_intelligence_jobs WHERE id = ? AND requested_by_user_id = ? AND job_type = 'account_chat' LIMIT 1`, [Number(jobId), Number(user.id)]);
  const job = rows[0];
  if (!job) return null;
  const request = parseJson(job.request_json, {});
  const snapshot = await buildAuthorizedCustomerSnapshot({ user, accountId: job.account_id, opportunityId: job.opportunity_id, contactId: job.contact_id });
  const agents = await runAccountIntelligenceAgents(snapshot, { includePublicResearch: Boolean(request.includePublicResearch), user, jobId });
  const fallback = buildAccountChatFallback(snapshot, request.question);
  let response = fallback;
  try {
    const aiResult = await runStructuredTextResearch({
      schemaName: "account_contextual_chat",
      systemPrompt: "Responde preguntas comerciales sobre una cuenta usando exclusivamente el snapshot autorizado. No inventes datos. Incluye evidencia y acciones que siempre requieran confirmación.",
      subject: snapshot.account?.name || "cuenta",
      context: { question: request.question, snapshot, agents },
      currentValues: {},
      fields: [
        { key: "answer", type: "string", example: "Respuesta contextual" },
        { key: "evidence", type: "array", example: ["Evidencia"], items: { type: "string", example: "Evidencia" } },
        { key: "confidence", type: "enum", enum: ["high", "medium", "low"], example: "medium" },
        { key: "recommendedActions", type: "array", example: [], items: { type: "object", fields: [{ key: "title", type: "string", example: "Acción" }, { key: "opportunityId", type: "string", example: "" }, { key: "actionType", type: "string", example: "call" }, { key: "notes", type: "string", example: "Notas" }, { key: "successCriteria", type: "string", example: "Criterio" }, { key: "requiresConfirmation", type: "string", example: "true" }] } },
        { key: "source", type: "string", example: "account_intelligence" },
      ],
      aiUsageContext: { userId: Number(user.id), featureCode: "commercial_intelligence.account_chat", jobType: "account_chat", jobId },
    });
    if (aiResult) response = { ...fallback, ...aiResult, source: "account_intelligence", recommendedActions: (aiResult.recommendedActions || []).map((action) => ({ ...action, opportunityId: Number(action.opportunityId || 0) || null, requiresConfirmation: true })) };
  } catch {
    response = fallback;
  }
  response = { ...response, agents: agents.map((agent) => ({ agentId: agent.agentId, status: agent.status, summary: agent.summary })), publicSources: agents.find((agent) => agent.agentId === "public_research")?.evidence || [] };
  await query(`UPDATE customer_intelligence_jobs SET status = 'completed', result_json = ?, updated_at = NOW(3), finished_at = NOW(3) WHERE id = ?`, [JSON.stringify(response), Number(jobId)]);
  return { ...mapJobRow({ ...job, status: "completed", result_json: JSON.stringify(response) }), result: response };
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
    [publicId, snapshot.account?.id || null, snapshot.selectedOpportunity?.id || null, snapshot.selectedContact?.id || null, Number(user.id), JSON.stringify({ ...payload, requestedAt: new Date().toISOString() })],
  );
  return { job: { id: Number(result.insertId), publicId, status: "pending", pollAfterMs: 1000 }, snapshot };
}

export async function processCustomerExecutiveBriefingJob({ jobId, user }) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(`SELECT * FROM customer_intelligence_jobs WHERE id = ? AND requested_by_user_id = ? AND job_type = 'executive_briefing' LIMIT 1`, [Number(jobId), Number(user.id)]);
  const job = rows[0];
  if (!job) return null;
  if (!["pending", "running"].includes(String(job.status))) return mapJobRow(job);
  await query(`UPDATE customer_intelligence_jobs SET status = 'running', updated_at = NOW(3) WHERE id = ?`, [Number(jobId)]);
  try {
    const snapshot = await buildAuthorizedCustomerSnapshot({ user, accountId: job.account_id, opportunityId: job.opportunity_id, contactId: job.contact_id });
    const findings = generateCustomerIntelligenceFindings(snapshot);
    const aiResult = await runStructuredWebResearch({
      schemaName: "account_executive_briefing",
      systemPrompt: "Eres un asistente comercial B2B. Resume una cuenta usando exclusivamente el snapshot autorizado y sus evidencias. No inventes hechos; separa hechos, riesgos e hipótesis.",
      subject: snapshot.account?.name || "cuenta",
      context: { snapshot, findings, accountHealth: snapshot.accountHealth },
      currentValues: {},
      fields: [
        { key: "summary", type: "string", example: "Resumen ejecutivo" },
        { key: "recentChanges", type: "array", example: ["Cambio reciente"], items: { type: "string", example: "Cambio reciente" } },
        { key: "prioritizedRisks", type: "array", example: [], items: { type: "object", fields: [{ key: "title", type: "string", example: "Riesgo" }, { key: "summary", type: "string", example: "Resumen" }, { key: "evidence", type: "string", example: "Evidencia" }, { key: "severity", type: "enum", enum: ["high", "medium", "low"], example: "medium" }] } },
        { key: "meetingQuestions", type: "array", example: ["Pregunta"], items: { type: "string", example: "Pregunta" } },
        { key: "nextBestStep", type: "string", example: "Siguiente mejor paso" },
        { key: "evidence", type: "array", example: ["Evidencia"], items: { type: "string", example: "Evidencia" } },
        { key: "recommendedActions", type: "array", example: [], items: { type: "object", fields: [{ key: "title", type: "string", example: "Agendar seguimiento" }, { key: "actionType", type: "string", example: "call" }, { key: "priority", type: "enum", enum: ["high", "medium", "low"], example: "medium" }, { key: "opportunityId", type: "string", example: "123" }, { key: "notes", type: "string", example: "Nota" }, { key: "successCriteria", type: "string", example: "Criterio" }] } },
      ],
      aiUsageContext: { userId: Number(user.id), featureCode: "commercial_intelligence.executive_briefing", jobType: "executive_briefing", jobId },
    });
    const fallback = generateExecutiveBriefingFallback(snapshot, findings);
    const executiveBriefing = aiResult ? { ...fallback.executiveBriefing, ...aiResult, healthStatus: snapshot.accountHealth.status, healthScore: snapshot.accountHealth.score } : fallback.executiveBriefing;
    const result = { sourceDomain: "crm_internal", scope: ["executive_summary", "account_health", "risks", "opportunities", "key_contacts", "recent_activity", "recommended_actions"], headline: fallback.headline, summary: aiResult?.summary || fallback.summary, executiveBriefing, generatedAt: new Date().toISOString() };
    await query(`UPDATE customer_intelligence_jobs SET status = 'completed', result_json = ?, error_message = NULL, updated_at = NOW(3), finished_at = NOW(3) WHERE id = ?`, [JSON.stringify(result), Number(jobId)]);
    return { ...mapJobRow({ ...job, status: "completed", result_json: JSON.stringify(result), error_message: null }), result };
  } catch (error) {
    await query(`UPDATE customer_intelligence_jobs SET status = 'failed', error_message = ?, updated_at = NOW(3), finished_at = NOW(3) WHERE id = ?`, [clip(error?.message || "No fue posible preparar el resumen ejecutivo", 1000), Number(jobId)]).catch(() => undefined);
    return null;
  }
}

function normalizeCustomerExternalFinding(rawFinding, index = 0, sourceType = "public_web") {
  const sourceUrl = clip(rawFinding?.sourceUrl || rawFinding?.sourceReference || "", 500);
  const title = clip(rawFinding?.title || `Señal publica ${index + 1}`, 190);
  const summary = clip(rawFinding?.summary || rawFinding?.description || "", 4000);
  const evidenceText = clip(rawFinding?.evidenceText || rawFinding?.evidence || "", 4000);
  const rawContactData = rawFinding?.contactData && typeof rawFinding.contactData === "object"
    ? rawFinding.contactData
    : null;
  const contactData = rawContactData ? {
    ...rawContactData,
    email: cleanPublicContactValue(rawContactData.email),
    phone: cleanPublicContactValue(rawContactData.phone),
    mobile: cleanPublicContactValue(rawContactData.mobile),
  } : null;
  const contactName = contactData?.firstName && contactData?.lastName
    ? `${contactData.firstName} ${contactData.lastName}`.trim()
    : "";
  const inferredTargetEntity = rawFinding?.targetEntity || (contactData?.firstName && contactData?.lastName ? "contact" : "account");
  return buildFinding({
    category: rawFinding?.category || "business_challenge",
    title: contactName || title,
    summary: summary || title,
    evidenceText: evidenceText || "Señal detectada en investigacion externa; requiere validacion comercial.",
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
      suggestedValue: clip(rawFinding?.suggestedValue || summary || evidenceText, 10000),
    },
  });
}

async function runCustomerExternalResearch({ snapshot, user, jobId }) {
  const subject = snapshot.account?.name || snapshot.selectedOpportunity?.name || snapshot.selectedContact?.name || "cliente";
  const tavily = await searchTavily({
    query: `${subject} ${snapshot.account?.city || ""} noticias proyectos tecnología empresa`,
  });
  const contactSearch = await searchTavily({
    query: `${subject} liderazgo directivos CTO CIO CISO director tecnología contacto empresa`,
  });
  const publicResults = [...(tavily.results || []), ...(contactSearch.results || [])]
    .filter((result, index, results) => results.findIndex((candidate) => candidate.url === result.url) === index);
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
            { key: "title", type: "string", example: "Posible iniciativa cloud" },
            { key: "summary", type: "string", example: "Resumen de señal" },
            { key: "evidenceText", type: "string", example: "Fragmento exacto" },
            { key: "sourceUrl", type: "string", example: "https://example.com" },
            { key: "confidence", type: "enum", enum: ["high", "medium", "low"], example: "medium" },
            { key: "targetEntity", type: "enum", enum: ["account", "contact", "opportunity"], example: "account" },
            { key: "targetField", type: "string", example: "description" },
            { key: "suggestedValue", type: "string", example: "Valor sugerido para actualizar el CRM" },
            { key: "contactData", type: "object", fields: [
              { key: "firstName", type: "string", example: "Ana" },
              { key: "lastName", type: "string", example: "Pérez" },
              { key: "positionTitle", type: "string", example: "CTO" },
              { key: "department", type: "string", example: "Tecnología" },
              { key: "email", type: "string", example: "ana@example.com" },
              { key: "phone", type: "string", example: "" },
              { key: "mobile", type: "string", example: "" },
            ] },
          ],
        },
      },
      {
        key: "warnings",
        type: "array",
        example: [],
        items: { type: "string", example: "No se encontraron fuentes suficientes" },
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
      warnings: ["OpenAI no esta disponible para interpretar los resultados de Tavily."],
      provider: "tavily",
    };
  }
  return {
    enabled: true,
    findings: Array.isArray(result.findings)
      ? result.findings.map((finding, index) => normalizeCustomerExternalFinding(finding, index, "tavily")).filter((finding) => finding.title)
      : [],
      warnings: [...(tavily.warnings || []), ...(contactSearch.warnings || []), ...(Array.isArray(result.warnings) ? result.warnings.filter(Boolean) : [])],
      provider: "tavily",
  };
}

async function insertFindings(conn, { jobId, userId, accountId, opportunityId, contactId, findings }) {
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
    [`cia_${randomUUID()}`, snapshot.account?.id || null, snapshot.selectedOpportunity?.id || null, snapshot.selectedContact?.id || null, Number(user.id), JSON.stringify(payload)],
  );
  return { job: { id: Number(result.insertId), status: "pending", pollAfterMs: 700 }, snapshot };
}

export async function processAccountInternalAnalysisJob({ jobId, user }) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(`SELECT * FROM customer_intelligence_jobs WHERE id = ? AND requested_by_user_id = ? AND job_type = 'account_internal_analysis' LIMIT 1`, [Number(jobId), Number(user.id)]);
  const job = rows[0];
  if (!job) return null;
  const snapshot = await buildAuthorizedCustomerSnapshot({ user, accountId: job.account_id, opportunityId: job.opportunity_id, contactId: job.contact_id });
  const agents = await runAccountIntelligenceAgents(snapshot, { includePublicResearch: false });
  const findings = generateCustomerIntelligenceFindings(snapshot);
  const persistedFindings = await withTransaction(async (conn) => {
    await conn.query(`DELETE FROM customer_intelligence_findings WHERE job_id = ?`, [Number(jobId)]);
    return insertFindings(conn, {
      jobId: Number(jobId),
      userId: Number(user.id),
      accountId: job.account_id === null ? null : Number(job.account_id),
      opportunityId: job.opportunity_id === null ? null : Number(job.opportunity_id),
      contactId: job.contact_id === null ? null : Number(job.contact_id),
      findings,
    });
  });
  const result = { sourceDomain: "crm_internal", scope: ["executive_summary", "account_health", "risks", "opportunities", "key_contacts", "recent_activity", "renewal_expansion", "recommended_actions"], headline: snapshot.account?.name ? `Análisis de cuenta: ${snapshot.account.name}` : "Análisis de cuenta", summary: `Análisis interno consolidado con ${snapshot.contacts.length} contacto(s), ${snapshot.opportunities.length} oportunidad(es), ${snapshot.products.length} producto(s) y ${snapshot.renewals.length} renovación(es).`, snapshot, accountHealth: snapshot.accountHealth, findings: persistedFindings, agents, generatedAt: new Date().toISOString(), writesPerformed: false };
  await query(`UPDATE customer_intelligence_jobs SET status = 'completed', result_json = ?, updated_at = NOW(3), finished_at = NOW(3) WHERE id = ?`, [JSON.stringify(result), Number(jobId)]);
  return { ...mapJobRow({ ...job, status: "completed", result_json: JSON.stringify(result) }), result, findings: persistedFindings };
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
      JSON.stringify({ accountId, opportunityId, contactId, requestedAt: new Date().toISOString() }),
    ],
  );
  return {
    job: { id: Number(result.insertId), publicId, status: "pending", pollAfterMs: 1000 },
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
        result_json: JSON.stringify({ ...resultSummary, findings: persistedFindings }),
        error_message: null,
      }),
      result: { ...resultSummary, findings: persistedFindings },
    };
  } catch (error) {
    await query(
      `UPDATE customer_intelligence_jobs
       SET status = 'failed', error_message = ?, updated_at = NOW(3), finished_at = NOW(3)
       WHERE id = ?`,
      [clip(error?.message || "No fue posible investigar el cliente", 1000), Number(jobId)],
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
      [clip(error?.message || "No fue posible preparar la llamada", 1000), Number(jobId)],
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
  if (!["pending", "running"].includes(String(job.status))) return mapJobRow(job);
  await query(`UPDATE customer_intelligence_jobs SET status = 'running', updated_at = NOW(3) WHERE id = ?`, [Number(jobId)]);
  try {
    const snapshot = await buildAuthorizedCustomerSnapshot({
      user,
      accountId: job.account_id,
      opportunityId: job.opportunity_id,
      contactId: job.contact_id,
    });
    const external = await runCustomerExternalResearch({ snapshot, user, jobId: Number(jobId) });
    let inserted = [];
    if (external.findings.length) {
      inserted = await withTransaction(async (conn) =>
        insertFindings(conn, {
          jobId: Number(jobId),
          userId: Number(user.id),
          accountId: job.account_id === null ? null : Number(job.account_id),
          opportunityId: job.opportunity_id === null ? null : Number(job.opportunity_id),
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
    return { ...mapJobRow({ ...job, status: "completed", result_json: JSON.stringify(result), error_message: null }), result };
  } catch (error) {
    await query(
      `UPDATE customer_intelligence_jobs
       SET status = 'failed', error_message = ?, updated_at = NOW(3), finished_at = NOW(3)
       WHERE id = ?`,
      [clip(error?.message || "No fue posible investigar fuentes externas", 1000), Number(jobId)],
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
    await getAccessibleOpportunity({ user, opportunityId: Number(filters.opportunityId) });
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

export async function updateCustomerIntelligenceFindingStatus({ user, findingId, status }) {
  await ensureCommercialIntelligenceSchema();
  const allowedStatuses = new Set(["confirmed", "rejected", "suggested", "outdated"]);
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
    await getAccessibleOpportunity({ user, opportunityId: Number(finding.opportunity_id) });
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

export async function applyCustomerIntelligenceFinding({ user, findingId, target, field, value, mode }) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT * FROM customer_intelligence_findings WHERE id = ? LIMIT 1`,
    [Number(findingId)],
  );
  const finding = rows[0];
  if (!finding) return null;
  if (finding.status !== "confirmed") {
    throw createHttpError(409, "El hallazgo debe confirmarse antes de guardar cambios");
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
    throw createHttpError(400, "El campo seleccionado no corresponde al registro del hallazgo");
  }
  if (!hasPermission(user, targetConfig.permission)) {
    throw createHttpError(403, "No autorizado", { requiredPermission: targetConfig.permission });
  }
  if (target === "account") await getAccessibleAccount({ user, accountId: targetConfig.id });
  if (target === "contact") await getAccessibleContact({ user, contactId: targetConfig.id });
  if (target === "opportunity") await getAccessibleOpportunity({ user, opportunityId: targetConfig.id });

  const normalizedValue = clip(value, 10000);
  if (!normalizedValue) throw createHttpError(400, "El valor es obligatorio");
  const [currentRows] = await query(
    `SELECT ${targetConfig.fields[field]} AS current_value FROM ${targetConfig.table} WHERE id = ? LIMIT 1`,
    [Number(targetConfig.id)],
  );
  const currentValue = String(currentRows?.current_value || "").trim();
  const nextValue = mode === "append" && currentValue
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

export async function applyCustomerContactFinding({ user, findingId, contactId, contactData }) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(`SELECT * FROM customer_intelligence_findings WHERE id = ? LIMIT 1`, [Number(findingId)]);
  const finding = rows[0];
  if (!finding) return null;
  if (finding.status !== "confirmed") {
    throw createHttpError(409, "El hallazgo debe confirmarse antes de guardar cambios");
  }
  if (!finding.account_id) throw createHttpError(400, "El hallazgo no tiene una cuenta relacionada");
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
  if (!data.firstName || !data.lastName) throw createHttpError(400, "Nombre y apellido son obligatorios");
  if (contactId) {
    if (!hasPermission(user, "contactos.update")) throw createHttpError(403, "No autorizado", { requiredPermission: "contactos.update" });
    await getAccessibleContact({ user, contactId: Number(contactId) });
    await query(`UPDATE contacts SET first_name = ?, last_name = ?, position_title = ?, department = ?, email = ?, phone = ?, mobile = ?, updated_by = ?, updated_at = NOW(3) WHERE id = ? AND account_id = ?`, [data.firstName, data.lastName, data.positionTitle || null, data.department || null, data.email || null, data.phone || null, data.mobile || null, Number(user.id), Number(contactId), Number(finding.account_id)]);
    return { mode: "updated", contactId: Number(contactId), finding: mapFindingRow(finding) };
  }
  if (!hasPermission(user, "contactos.create")) throw createHttpError(403, "No autorizado", { requiredPermission: "contactos.create" });
  const [country] = await query("SELECT id FROM countries ORDER BY id LIMIT 1");
  const [purchase] = await query("SELECT id FROM contact_purchase_participations ORDER BY id LIMIT 1");
  const [hierarchy] = await query("SELECT id FROM contact_hierarchy_levels ORDER BY id LIMIT 1");
  const [relationship] = await query("SELECT id FROM contact_relationship_types ORDER BY id LIMIT 1");
  const [influence] = await query("SELECT id FROM contact_influence_levels ORDER BY id LIMIT 1");
  const [employment] = await query("SELECT id FROM contact_employment_statuses ORDER BY id LIMIT 1");
  const [activation] = await query("SELECT id FROM contact_activation_statuses WHERE code = 'activado' ORDER BY id LIMIT 1");
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
  return { mode: "created", contactId: Number(result.insertId), finding: mapFindingRow(finding) };
}

export async function getNextAutomaticCustomerBriefing({ user }) {
  await ensureCommercialIntelligenceSchema();
  await ensureOpportunityWorkspaceSchema();

  if (!hasReadPermission(user, "oportunidades")) {
    return {
      activity: null,
      briefing: null,
      message: "No hay permiso para leer oportunidades y preparar un briefing automatico.",
    };
  }

  const params = [];
  const scopeJoin = hasReadAllPermission(user, "oportunidades")
    ? ""
    : "LEFT JOIN account_owners ao_scope ON ao_scope.account_id = o.account_id AND ao_scope.user_id = ?";
  if (!hasReadAllPermission(user, "oportunidades")) params.push(Number(user.id));

  const scopeWhere = hasReadAllPermission(user, "oportunidades")
    ? ""
    : "AND (ao_scope.user_id IS NOT NULL OR o.created_by = ? OR o.seller_user_id = ? OR a.owner_user_id = ?)";
  if (!hasReadAllPermission(user, "oportunidades")) {
    params.push(Number(user.id), Number(user.id), Number(user.id));
  }

  const rows = await query(
    `SELECT a.id AS action_id, a.opportunity_id, a.action_type, a.status,
            a.title, a.notes, a.scheduled_at, a.due_date, a.success_criteria,
            o.name AS opportunity_name, o.account_id, ac.name AS account_name
     FROM opportunity_workspace_actions a
     INNER JOIN opportunities o ON o.id = a.opportunity_id
     ${scopeJoin}
     INNER JOIN accounts ac ON ac.id = o.account_id
     INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
     INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     WHERE oas.code = 'activada'
       AND ocs.code NOT IN ('ganada', 'perdida', 'anulada')
       AND a.status IN ('pending', 'confirmed', 'rescheduled', 'in_progress', 'blocked')
       AND (
         (a.scheduled_at IS NOT NULL AND a.scheduled_at >= NOW(3))
         OR (a.scheduled_at IS NULL AND a.due_date IS NOT NULL AND a.due_date >= CURDATE())
       )
       ${scopeWhere}
     ORDER BY a.scheduled_at IS NULL, a.scheduled_at ASC, a.due_date ASC, a.id ASC
     LIMIT 1`,
    params,
  ).catch(() => []);

  const activity = rows[0];
  if (!activity) {
    return {
      activity: null,
      briefing: null,
      message: "No hay actividades próximas accesibles para preparar briefing automático.",
    };
  }

  const snapshot = await buildAuthorizedCustomerSnapshot({
    user,
    opportunityId: Number(activity.opportunity_id),
  });
  const findings = generateCustomerIntelligenceFindings(snapshot);
  const discovery = generateCommercialDiscoveryResult(snapshot, findings);

  return {
    activity: {
      id: Number(activity.action_id),
      opportunityId: Number(activity.opportunity_id),
      opportunityName: activity.opportunity_name || "",
      accountId: Number(activity.account_id),
      accountName: activity.account_name || "",
      actionType: activity.action_type || "",
      status: activity.status || "",
      title: activity.title || "Actividad comercial",
      notes: activity.notes || "",
      scheduledAt: activity.scheduled_at || null,
      dueDate: activity.due_date || null,
      successCriteria: activity.success_criteria || "",
    },
    briefing: discovery.briefing,
    summary: discovery.summary,
    findings,
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
    settings: normalizeGovernanceSettings(parseJson(settingsRow.settings_json, DEFAULT_GOVERNANCE_SETTINGS)),
    updatedAt: settingsRow.updated_at || null,
    updatedByUserId: settingsRow.updated_by_user_id ? Number(settingsRow.updated_by_user_id) : null,
    metrics: {
      jobsLast30Days: jobRows.map((row) => ({ status: row.status, jobType: row.job_type, total: Number(row.total || 0) })),
      findingsLast30Days: findingRows.map((row) => ({ status: row.status, sourceType: row.source_type, total: Number(row.total || 0) })),
      prospectSessionsLast30Days: prospectRows.map((row) => ({ status: row.status, total: Number(row.total || 0) })),
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
