import express from "express";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { requirePermission } from "./auth.js";
import {
  assertAiBudgetAvailable,
  recordAiUsageFromOpenAiResponse,
} from "./ai-usage/service.js";
import { config } from "./config.js";
import { query } from "./db.js";
import { ensureOpportunityWorkspaceSchema } from "./opportunity-workspace/schema.js";
import { logAuditEvent, parseAuditChangedFields } from "./audit.js";
import {
  appendCoachSessionTurn,
  cancelCoachHandoff,
  completeCoachHandoff,
  createCoachSession,
  createCoachHandoff,
  getCoachHandoff,
  getLatestActiveCoachSession,
  getCoachOperation,
  getCoachSession,
  getOrCreateCoachSession,
  listCoachSessionOperations,
  persistCoachOperations,
  transitionCoachOperation,
  updateCoachOperation,
} from "./coach/service.js";
import {
  coachOperationSchema,
  filterValidCoachOperations,
  safeParseCoachResponse,
} from "./coach/contract.js";
import {
  applyCoachEntityResolution,
  buildCoachEntityClarification,
  resolveCoachEntities,
} from "./coach/entity-resolver.js";
import {
  buildStageReadiness,
  isStagePreparationQuestion,
} from "./coach/stage-readiness.js";
import {
  CoachOperationError,
  executeControlledCoachOperation,
  revertControlledCoachOperation,
  reviewControlledCoachOperation,
} from "./coach/controlled-operation-service.js";
import {
  getDelegatedCoachOperationPermissions,
  hasAnyPermission,
} from "./coach/operation-policy.js";
import { validateLeadCallOutcomeForCoach } from "./routes.interactions.js";
import { getCoachMetrics } from "./coach/metrics.js";
import { getMiCoachGovernanceSettings } from "./commercial-intelligence/service.js";

const router = express.Router();
const MI_AGENT_FEATURE_CODE = "mi_agent.analysis";
const MI_COACH_FEATURE_CODE = "mi_coach.chat";
const MI_COACH_USE_PERMISSION = "mi_coach.use";
const MI_COACH_EXECUTE_PERMISSION = "mi_coach.execute";
const TERMINAL_OPPORTUNITY_COLLECTIONS = [
  "wonOpportunities",
  "lostOpportunities",
  "cancelledOpportunities",
];

export function getEnabledCoachTerminalStatusCodes(settings = {}) {
  return [
    settings.includeWonOpportunities ? "ganada" : null,
    settings.includeLostOpportunities ? "perdida" : null,
    settings.includeCancelledOpportunities ? "anulada" : null,
  ].filter(Boolean);
}

export function resolveCoachTurnContext(
  requestContext = {},
  sessionContext = {},
  isExistingSession = false,
) {
  const source = isExistingSession ? sessionContext : requestContext;
  return Object.fromEntries(
    [
      "accountId",
      "contactId",
      "opportunityId",
      "quotationId",
      "proposalId",
      "leadId",
    ].map((key) => [key, Number(source?.[key] || 0) || null]),
  );
}

export function coachSessionContextMatchesRequest(
  requestContext,
  sessionContext = {},
) {
  if (!requestContext || typeof requestContext !== "object") return true;
  return Object.keys(requestContext).every((key) => {
    const requestedId = Number(requestContext[key] || 0) || null;
    const storedId = Number(sessionContext?.[key] || 0) || null;
    return requestedId === storedId;
  });
}

export function getCoachConversationHistory(
  messages = [],
  requestContext = null,
  sessionContext = {},
) {
  if (!coachSessionContextMatchesRequest(requestContext, sessionContext)) {
    return [];
  }
  return (Array.isArray(messages) ? messages : [])
    .filter(
      (message) =>
        !message.context ||
        coachSessionContextMatchesRequest(requestContext, message.context),
    )
    .slice(-8)
    .map((message) => ({
      role: message.role,
      text: message.text || message.result?.answer || "",
    }))
    .filter((message) => message.text);
}

export function resolveCoachContextEntities(
  snapshot,
  question,
  _conversationHistory = [],
  _selectedContext = {},
) {
  const explicitEntities = resolveCoachEntities(snapshot, question);
  return {
    explicitEntities,
    resolvedEntities: explicitEntities,
  };
}

export function resolveCoachResponseContext(
  snapshot,
  currentContext,
  response,
) {
  const opportunities = [
    ...(snapshot?.coachOpportunities || []),
    ...(snapshot?.wonOpportunities || []),
    ...(snapshot?.lostOpportunities || []),
    ...(snapshot?.cancelledOpportunities || []),
  ];
  const accounts = snapshot?.accounts || [];
  const contacts = snapshot?.contactMappings || [];
  const leads = snapshot?.leads || [];
  const facts = Array.isArray(response?.facts) ? response.facts : [];
  const entities = response?.entities || {};
  const findById = (items, id) =>
    items.find((item) => Number(item?.id) === Number(id || 0)) || null;
  const factId = (sourceType) => {
    const ids = new Set(
      facts
        .filter((fact) => fact?.sourceType === sourceType)
        .map((fact) => Number(fact?.sourceId || 0))
        .filter((id) => id > 0),
    );
    return ids.size === 1 ? [...ids][0] : null;
  };
  const explicitEntities = {
    account:
      findById(accounts, entities.accountId) ||
      findById(accounts, factId("account")),
    opportunity:
      findById(opportunities, entities.opportunityId) ||
      findById(opportunities, factId("opportunity")),
    contact: findById(contacts, factId("contact")),
    lead: findById(leads, entities.leadId) || findById(leads, factId("lead")),
    candidates: { accounts: [], opportunities: [], contacts: [], leads: [] },
  };
  const responseText = [
    response?.answer,
    ...(Array.isArray(entities.names) ? entities.names : []),
  ]
    .filter(Boolean)
    .join(" ");
  const responseResolution = resolveCoachEntities(snapshot, responseText);
  if (
    /\boportunidad(?:es)?\b/.test(normalizeCoachMatchText(responseText)) &&
    responseResolution.opportunity &&
    !/\b(?:lead|leads|prospecto|prospectos)\b/.test(
      normalizeCoachMatchText(responseText),
    )
  ) {
    explicitEntities.opportunity = responseResolution.opportunity;
    explicitEntities.lead = null;
  }
  if (!Object.values(explicitEntities).some((entity) => entity?.id)) {
    const namesResolution = responseResolution;
    Object.assign(explicitEntities, {
      account: namesResolution.account,
      opportunity: namesResolution.opportunity,
      contact: namesResolution.contact,
      lead: namesResolution.lead,
      candidates: namesResolution.candidates,
    });
  }
  const resolution = explicitEntities;
  const transition = applyCoachEntityResolution(
    snapshot,
    currentContext,
    resolution,
  );
  return {
    ...transition,
    resolution,
    source: "coach_response",
  };
}
const ANALYSIS_TIMEOUT_MS = 120000;
const PROCESS_GUIDE_URL = new URL(
  "../../../readme/proceso-comercial.md",
  import.meta.url,
);
let processGuideTextPromise;
let ensureMiAgentSchemaPromise;

async function loadProcessGuide() {
  if (!processGuideTextPromise) {
    processGuideTextPromise = readFile(PROCESS_GUIDE_URL, "utf8").catch(
      (error) => {
        processGuideTextPromise = undefined;
        throw error;
      },
    );
  }
  return processGuideTextPromise;
}

async function ensureMiAgentSchema() {
  if (!ensureMiAgentSchemaPromise) {
    ensureMiAgentSchemaPromise = query(
      `CREATE TABLE IF NOT EXISTS mi_agent_analysis_jobs (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        created_by_user_id BIGINT UNSIGNED NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        result_json JSON NULL,
        error_message VARCHAR(1000) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
        updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
        CONSTRAINT fk_mi_agent_analysis_jobs_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_mi_agent_analysis_jobs_user_status (created_by_user_id, status, updated_at)
      )`,
    ).catch((error) => {
      ensureMiAgentSchemaPromise = undefined;
      throw error;
    });
  }
  await ensureMiAgentSchemaPromise;
  for (const [column, definition] of [
    [
      "job_kind",
      "VARCHAR(30) NOT NULL DEFAULT 'analysis' AFTER created_by_user_id",
    ],
    ["question", "TEXT NULL AFTER status"],
    ["context_snapshot", "JSON NULL AFTER question"],
  ]) {
    const rows = await query(
      `SHOW COLUMNS FROM mi_agent_analysis_jobs LIKE '${column}'`,
    );
    if (!rows.length) {
      await query(
        `ALTER TABLE mi_agent_analysis_jobs ADD COLUMN ${column} ${definition}`,
      );
    }
  }
}
const QUALIFIED_STAGE_CODES = [
  "desarrollo",
  "cotizacion",
  "demostracion",
  "negociacion",
  "waiting",
];
const COACH_STAGE_CODES = [
  "contacto_inicial",
  "identificacion_oportunidad",
  ...QUALIFIED_STAGE_CODES,
];

function buildInClause(values) {
  return values.map(() => "?").join(", ");
}

function clip(value, max = 3000) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function normalizeCoachMatchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inferOpportunityIdFromText(opportunities, text) {
  const normalizedText = normalizeCoachMatchText(text);
  return (
    opportunities
      .filter((opportunity) => Number(opportunity?.id || 0) > 0)
      .map((opportunity) => ({
        id: Number(opportunity.id),
        name: normalizeCoachMatchText(opportunity.name),
      }))
      .filter(
        (opportunity) =>
          opportunity.name.length >= 6 &&
          normalizedText.includes(opportunity.name),
      )
      .sort((left, right) => right.name.length - left.name.length)[0]?.id || 0
  );
}

export function buildCoachScopedSnapshot(snapshot, selectedContext = {}) {
  const accountId = Number(selectedContext?.accountId || 0);
  const opportunityId = Number(selectedContext?.opportunityId || 0);
  const contactId = Number(selectedContext?.contactId || 0);
  const leadId = Number(selectedContext?.leadId || 0);
  const selectedLead =
    leadId > 0
      ? (Array.isArray(snapshot?.leads) ? snapshot.leads : []).find(
          (lead) => Number(lead?.id) === leadId,
        ) || null
      : null;
  const contactAccountId =
    contactId > 0
      ? Number(
          (Array.isArray(snapshot?.contactMappings)
            ? snapshot.contactMappings
            : []
          ).find((contact) => Number(contact?.id) === contactId)?.accountId ||
            0,
        )
      : 0;
  const scopedAccountId =
    accountId || contactAccountId || Number(selectedLead?.accountId || 0);
  const scopedOpportunityId =
    opportunityId || Number(selectedLead?.opportunityId || 0);
  const hasSelection =
    accountId > 0 || opportunityId > 0 || contactId > 0 || leadId > 0;
  if (!hasSelection) return snapshot;

  const commercialOpportunities = Array.isArray(snapshot?.coachOpportunities)
    ? snapshot.coachOpportunities
    : Array.isArray(snapshot?.pipeline?.opportunities)
      ? snapshot.pipeline.opportunities
      : Array.isArray(snapshot?.workboard)
        ? snapshot.workboard
        : [];
  const historicalOpportunities = TERMINAL_OPPORTUNITY_COLLECTIONS.flatMap(
    (key) => (Array.isArray(snapshot?.[key]) ? snapshot[key] : []),
  );
  const inactiveOpportunities = Array.isArray(
    snapshot?.inactivePipelineOpportunities,
  )
    ? snapshot.inactivePipelineOpportunities
    : [];
  const allOpportunities = [
    ...commercialOpportunities,
    ...historicalOpportunities,
    ...inactiveOpportunities,
  ];
  const matchesSelection = (item) => {
    if (scopedOpportunityId > 0) return Number(item.id) === scopedOpportunityId;
    if (scopedAccountId > 0)
      return Number(item.account?.id || item.accountId) === scopedAccountId;
    return Number(item.contact?.id || item.contactId) === contactId;
  };
  const opportunities = commercialOpportunities.filter(matchesSelection);
  const scopedHistorical = Object.fromEntries(
    TERMINAL_OPPORTUNITY_COLLECTIONS.map((key) => [
      key,
      (Array.isArray(snapshot?.[key]) ? snapshot[key] : []).filter(
        matchesSelection,
      ),
    ]),
  );
  const scopedInactive = inactiveOpportunities.filter(matchesSelection);
  const scopedAllOpportunities = allOpportunities.filter(matchesSelection);
  const opportunityIds = new Set(
    scopedAllOpportunities.map((item) => Number(item.id)),
  );
  const leads = Array.isArray(snapshot?.leads)
    ? snapshot.leads.filter(
        (lead) =>
          (leadId > 0 && Number(lead.id) === leadId) ||
          (scopedOpportunityId > 0 &&
            Number(lead.opportunityId) === scopedOpportunityId) ||
          (leadId <= 0 &&
            scopedAccountId > 0 &&
            Number(lead.accountId) === scopedAccountId),
      )
    : [];
  const contactMappings = Array.isArray(snapshot?.contactMappings)
    ? snapshot.contactMappings.filter(
        (contact) =>
          (scopedAccountId > 0 &&
            Number(contact.accountId) === scopedAccountId) ||
          (contactId > 0 && Number(contact.id) === contactId),
      )
    : [];
  const accountRecords =
    Array.isArray(snapshot?.accounts) && snapshot.accounts.length
      ? snapshot.accounts
      : [
          ...new Map(
            allOpportunities
              .map((item) => item.account)
              .filter(Boolean)
              .map((account) => [Number(account.id), account]),
          ).values(),
        ];
  const scopedAccounts = accountRecords.filter(
    (account) => scopedAccountId > 0 && Number(account.id) === scopedAccountId,
  );
  const selectedOpportunity =
    scopedOpportunityId > 0
      ? scopedAllOpportunities.find(
          (item) => Number(item.id) === scopedOpportunityId,
        ) || null
      : null;

  return {
    ...snapshot,
    accounts: scopedAccounts,
    pipeline: snapshot?.pipeline
      ? {
          ...snapshot.pipeline,
          opportunities: (Array.isArray(snapshot.pipeline.opportunities)
            ? snapshot.pipeline.opportunities
            : []
          ).filter(matchesSelection),
        }
      : snapshot?.pipeline,
    workboard: (Array.isArray(snapshot?.workboard)
      ? snapshot.workboard
      : []
    ).filter(matchesSelection),
    coachOpportunities: opportunities,
    inactivePipelineOpportunities: scopedInactive,
    ...scopedHistorical,
    leads,
    contactMappings,
    selectedRecord: selectedOpportunity
      ? {
          ...selectedOpportunity,
          type: "opportunity",
        }
      : selectedLead
        ? { ...selectedLead, type: "lead" }
        : null,
    selectedContext: {
      accountId: scopedAccountId || null,
      opportunityId: scopedOpportunityId || null,
      contactId: contactId || null,
      leadId: leadId || null,
      opportunityIds: [...opportunityIds],
    },
  };
}

function getQuarterSelection() {
  const now = new Date();
  const quarter = Math.floor(now.getMonth() / 3) + 1;
  const start = new Date(Date.UTC(now.getFullYear(), (quarter - 1) * 3, 1));
  const end = new Date(Date.UTC(now.getFullYear(), quarter * 3, 0));
  return {
    year: now.getFullYear(),
    quarter,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    label: `Q${quarter} ${now.getFullYear()}`,
  };
}

function hasMiAgentGlobalScope(user) {
  return Boolean(
    user?.permissionSet?.has("oportunidades.read_all") ||
    (Array.isArray(user?.roles) &&
      user.roles.some(
        (role) => role?.is_system || role?.name === "Administrador",
      )),
  );
}

function hasPermission(user, permission) {
  return Boolean(user?.permissionSet?.has(permission));
}

function hasReadPermission(user, basePermission) {
  return Boolean(
    hasPermission(user, `${basePermission}.read`) ||
    hasPermission(user, `${basePermission}.read_all`),
  );
}

function requireEntityReadPermission(user, basePermission) {
  if (hasReadPermission(user, basePermission)) return null;
  return {
    status: 403,
    body: {
      message: "No autorizado",
      requiredPermission: `${basePermission}.read`,
    },
  };
}

function canExecuteCoachWrite(user, permission) {
  return Boolean(
    hasPermission(user, MI_COACH_EXECUTE_PERMISSION) &&
    hasPermission(user, permission),
  );
}

function buildOpportunityScope(user, params) {
  if (hasMiAgentGlobalScope(user)) {
    return "";
  }
  params.push(Number(user.id));
  return "LEFT JOIN account_owners ao_scope ON ao_scope.account_id = o.account_id AND ao_scope.user_id = ?";
}

async function getMiAgentContext(user) {
  await ensureOpportunityWorkspaceSchema();
  const period = getQuarterSelection();
  const canReadOpportunities = hasReadPermission(user, "oportunidades");
  const canReadAccounts = hasReadPermission(user, "cuentas");
  const canReadContacts = hasReadPermission(user, "contactos");
  const canReadLeads = hasReadPermission(user, "interacciones");
  const stageParams = [...COACH_STAGE_CODES];
  const governanceSettings = await getMiCoachGovernanceSettings();
  const terminalStatusCodes =
    getEnabledCoachTerminalStatusCodes(governanceSettings);
  const opportunityParams = [];
  const scopeJoin = buildOpportunityScope(user, opportunityParams);
  const stagePlaceholders = COACH_STAGE_CODES.map(() => "?").join(", ");

  const targetParams = [period.year, period.quarter, Number(user.id)];
  const [targetRows, opportunityRows] = await Promise.all([
    query(
      `SELECT t.sales_quota_amount, t.currency_code
       FROM commercial_planning_periods p
       INNER JOIN commercial_planning_versions v ON v.period_id = p.id AND v.status = 'active'
       INNER JOIN commercial_planning_targets t ON t.version_id = v.id
       WHERE p.plan_year = ? AND p.plan_quarter = ?
         AND t.seller_user_id = ? AND t.status <> 'void'
       ORDER BY v.version_number DESC, v.id DESC
       LIMIT 1`,
      targetParams,
    ).catch((error) => {
      console.error(
        "[mi-agent] No fue posible cargar la cuota:",
        error?.message || error,
      );
      return [];
    }),
    canReadOpportunities
      ? query(
          `SELECT o.id, o.name, o.account_id, o.contact_id, o.amount_usd, o.close_date,
              o.sales_stage_id,
              o.updated_at, oss.code AS stage_code, oss.name AS stage_name,
              oss.stage_order,
              ocs.code AS commercial_status_code,
              oas.code AS activation_status_code,
              oas.name AS activation_status_name,
              a.name AS account_name, a.registration_code AS account_registration_code,
              a.phone AS account_phone, a.website AS account_website,
              a.city AS account_city, a.state_region AS account_state_region,
              a.description AS account_description,
              CONCAT(c.first_name, ' ', c.last_name) AS contact_name,
              c.email AS contact_email, c.phone AS contact_phone,
              c.mobile AS contact_mobile, c.position_title AS contact_position,
              c.department AS contact_department,
              COALESCE(
                (SELECT MAX(a1.updated_at)
                 FROM opportunity_workspace_actions a1
                 WHERE a1.opportunity_id = o.id), o.updated_at
              ) AS last_activity_at,
              (SELECT a2.title
               FROM opportunity_workspace_actions a2
               WHERE a2.opportunity_id = o.id
                 AND a2.status IN ('pending', 'in_progress', 'blocked')
               ORDER BY a2.is_primary_next_step DESC, a2.due_date IS NULL,
                        a2.due_date ASC, a2.id ASC
               LIMIT 1) AS next_action_title,
              (SELECT a3.due_date
               FROM opportunity_workspace_actions a3
               WHERE a3.opportunity_id = o.id
                 AND a3.status IN ('pending', 'in_progress', 'blocked')
               ORDER BY a3.is_primary_next_step DESC, a3.due_date IS NULL,
                        a3.due_date ASC, a3.id ASC
               LIMIT 1) AS next_action_due_date
       FROM opportunities o
       ${scopeJoin}
       INNER JOIN accounts a ON a.id = o.account_id
        LEFT JOIN contacts c ON c.id = o.contact_id
       INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
       INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
       INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
       WHERE oas.code = 'activada'
         AND ocs.code NOT IN ('ganada', 'perdida', 'anulada')
         AND oss.code IN (${stagePlaceholders})
         ${hasMiAgentGlobalScope(user) ? "" : "AND (ao_scope.user_id IS NOT NULL OR o.created_by = ? OR o.seller_user_id = ?)"}
       ORDER BY o.close_date IS NULL, o.close_date ASC, o.amount_usd DESC`,
          [
            ...opportunityParams,
            ...stageParams,
            ...(hasMiAgentGlobalScope(user)
              ? []
              : [Number(user.id), Number(user.id)]),
          ],
        ).catch((error) => {
          console.error(
            "[mi-agent] No fue posible consultar oportunidades:",
            error?.message || error,
          );
          return [];
        })
      : Promise.resolve([]),
  ]);

  const quotaAmount = Number(targetRows[0]?.sales_quota_amount || 0);
  const inactiveParams = [];
  const inactiveScopeJoin = buildOpportunityScope(user, inactiveParams);
  const inactiveRows = canReadOpportunities
    ? await query(
        `SELECT o.id, o.name, o.account_id, o.contact_id, o.amount_usd,
                  o.close_date, o.sales_stage_id, o.updated_at,
                  oss.code AS stage_code, oss.name AS stage_name,
                  oss.stage_order, ocs.code AS commercial_status_code,
                  oas.code AS activation_status_code,
                  oas.name AS activation_status_name,
                  a.name AS account_name,
                  a.registration_code AS account_registration_code,
                  a.phone AS account_phone, a.website AS account_website,
                  a.city AS account_city, a.state_region AS account_state_region,
                  a.description AS account_description,
                  CONCAT(c.first_name, ' ', c.last_name) AS contact_name,
                  c.email AS contact_email, c.phone AS contact_phone,
                  c.mobile AS contact_mobile, c.position_title AS contact_position,
                  c.department AS contact_department,
                  NULL AS last_activity_at, NULL AS next_action_title,
                  NULL AS next_action_due_date
           FROM opportunities o
           ${inactiveScopeJoin}
           INNER JOIN accounts a ON a.id = o.account_id
           LEFT JOIN contacts c ON c.id = o.contact_id
           INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
           INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
           INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
           WHERE oas.code <> 'activada'
             AND ocs.code NOT IN ('ganada', 'perdida', 'anulada')
             AND oss.code IN (${COACH_STAGE_CODES.map(() => "?").join(", ")})
             ${hasMiAgentGlobalScope(user) ? "" : "AND (ao_scope.user_id IS NOT NULL OR o.created_by = ? OR o.seller_user_id = ?)"}
           ORDER BY o.updated_at DESC, o.close_date IS NULL, o.close_date ASC
           LIMIT 300`,
        [
          ...inactiveParams,
          ...COACH_STAGE_CODES,
          ...(hasMiAgentGlobalScope(user)
            ? []
            : [Number(user.id), Number(user.id)]),
        ],
      ).catch((error) => {
        console.error(
          "[mi-agent] No fue posible consultar oportunidades no activas:",
          error?.message || error,
        );
        return [];
      })
    : [];
  const historicalParams = [];
  const historicalScopeJoin = buildOpportunityScope(user, historicalParams);
  const historicalRows =
    canReadOpportunities && terminalStatusCodes.length
      ? await query(
          `SELECT o.id, o.name, o.account_id, o.contact_id, o.amount_usd, o.close_date,
                  o.sales_stage_id, o.updated_at, oss.code AS stage_code,
                  oss.name AS stage_name, oss.stage_order,
                  ocs.code AS commercial_status_code,
                  a.name AS account_name, a.registration_code AS account_registration_code,
                  a.phone AS account_phone, a.website AS account_website,
                  a.city AS account_city, a.state_region AS account_state_region,
                  a.description AS account_description,
                  CONCAT(c.first_name, ' ', c.last_name) AS contact_name,
                  c.email AS contact_email, c.phone AS contact_phone,
                  c.mobile AS contact_mobile, c.position_title AS contact_position,
                  c.department AS contact_department,
                  o.updated_at AS last_activity_at,
                  NULL AS next_action_title, NULL AS next_action_due_date
           FROM opportunities o
           ${historicalScopeJoin}
           INNER JOIN accounts a ON a.id = o.account_id
           LEFT JOIN contacts c ON c.id = o.contact_id
           INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
           INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
           INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
           WHERE oas.code = 'activada'
             AND ocs.code IN (${terminalStatusCodes.map(() => "?").join(", ")})
             ${hasMiAgentGlobalScope(user) ? "" : "AND (ao_scope.user_id IS NOT NULL OR o.created_by = ? OR o.seller_user_id = ?)"}
           ORDER BY o.close_date DESC, o.updated_at DESC
           LIMIT 300`,
          [
            ...historicalParams,
            ...terminalStatusCodes,
            ...(hasMiAgentGlobalScope(user)
              ? []
              : [Number(user.id), Number(user.id)]),
          ],
        ).catch(() => [])
      : [];
  const wonParams = [];
  const wonScopeJoin = buildOpportunityScope(user, wonParams);
  const wonRows = canReadOpportunities
    ? await query(
        `SELECT COALESCE(SUM(o.amount_usd), 0) AS actual_amount
     FROM opportunities o
     ${wonScopeJoin}
     INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
     WHERE oas.code = 'activada' AND ocs.code = 'ganada'
       AND o.close_date BETWEEN ? AND ?
       ${hasMiAgentGlobalScope(user) ? "" : "AND (ao_scope.user_id IS NOT NULL OR o.created_by = ? OR o.seller_user_id = ?)"}`,
        [
          ...wonParams,
          period.startDate,
          period.endDate,
          ...(hasMiAgentGlobalScope(user)
            ? []
            : [Number(user.id), Number(user.id)]),
        ],
      ).catch(() => [])
    : [];

  const actualAmount = Number(wonRows[0]?.actual_amount || 0);
  const leadParams = [];
  const hasLeadGlobalScope = hasPermission(user, "interacciones.read_all");
  const leadScopeJoin = hasLeadGlobalScope
    ? ""
    : "LEFT JOIN account_owners ao_lead_scope ON ao_lead_scope.account_id = i.account_id AND ao_lead_scope.user_id = ?";
  if (!hasLeadGlobalScope) leadParams.push(Number(user.id));
  const leads = canReadLeads
    ? await query(
        `SELECT i.id, i.title, i.lead_source, i.analysis_status, i.processing_status,
            i.summary, i.source_notes, i.account_id, i.primary_opportunity_id,
            i.seller_user_id, i.lead_substatus_code, i.lead_reason_code,
            i.lead_required_action_code, i.lead_commercial_comment,
            i.lead_next_action_due_at, i.created_at, i.updated_at,
            a.name AS account_name, o.name AS opportunity_name
     FROM interactions i
     ${leadScopeJoin}
     LEFT JOIN accounts a ON a.id = i.account_id
     LEFT JOIN opportunities o ON o.id = i.primary_opportunity_id
     WHERE ${hasLeadGlobalScope ? "1 = 1" : "(ao_lead_scope.user_id IS NOT NULL OR i.seller_user_id = ? OR i.created_by = ?)"}
     ORDER BY i.updated_at DESC
     LIMIT 100`,
        hasLeadGlobalScope
          ? []
          : [...leadParams, Number(user.id), Number(user.id)],
      ).catch(() => [])
    : [];
  const hasAccountGlobalScope = hasPermission(user, "cuentas.read_all");
  const accountRows = canReadAccounts
    ? await query(
        `SELECT a.id, a.name, a.registration_code, a.phone, a.website,
                a.city, a.state_region, a.description
         FROM accounts a
         INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
         WHERE aas.code = 'activada'
           ${hasAccountGlobalScope ? "" : "AND EXISTS (SELECT 1 FROM account_owners ao_account WHERE ao_account.account_id = a.id AND ao_account.user_id = ?)"}
         ORDER BY a.name, a.id
         LIMIT 500`,
        hasAccountGlobalScope ? [] : [Number(user.id)],
      ).catch(() => [])
    : [];
  const accessibleAccountIds = Array.from(
    new Set(
      [
        ...accountRows.map((row) => Number(row.id)),
        ...opportunityRows.map((row) => Number(row.account_id)),
      ].filter((id) => id > 0),
    ),
  );
  const contactMappings =
    canReadContacts && accessibleAccountIds.length
      ? await query(
          `SELECT c.id, c.account_id, c.first_name, c.last_name, c.email,
                c.phone, c.mobile, c.position_title, c.department,
                c.manager_contact_id, c.influences_contact_id,
                a.name AS account_name,
                h.name AS hierarchy_level, r.name AS relationship_type,
                i.name AS influence_level
         FROM contacts c
             INNER JOIN accounts a ON a.id = c.account_id
         LEFT JOIN contact_hierarchy_levels h ON h.id = c.hierarchy_level_id
         LEFT JOIN contact_relationship_types r ON r.id = c.relationship_type_id
         LEFT JOIN contact_influence_levels i ON i.id = c.influence_level_id
         WHERE c.account_id IN (${accessibleAccountIds.map(() => "?").join(", ")})
         ORDER BY c.account_id, c.first_name, c.last_name
         LIMIT 500`,
          accessibleAccountIds,
        ).catch(() => [])
      : [];
  const mapOpportunity = (row) => {
    const lastActivity = row.last_activity_at
      ? new Date(row.last_activity_at)
      : null;
    const daysSinceActivity = lastActivity
      ? Math.max(
          0,
          Math.floor((Date.now() - lastActivity.getTime()) / 86400000),
        )
      : 0;
    const riskReasons = [];
    if (!row.next_action_title)
      riskReasons.push("No existe un siguiente paso registrado");
    if (daysSinceActivity > 14)
      riskReasons.push(`${daysSinceActivity} días sin actividad`);
    return {
      id: Number(row.id),
      name: row.name || "",
      accountName: canReadAccounts ? row.account_name || "" : "",
      account: canReadAccounts
        ? {
            id: Number(row.account_id),
            name: row.account_name || "",
            registrationCode: row.account_registration_code || "",
            phone: row.account_phone || "",
            website: row.account_website || "",
            city: row.account_city || "",
            stateRegion: row.account_state_region || "",
            description: clip(row.account_description, 1800),
          }
        : null,
      contact: canReadContacts
        ? {
            id: Number(row.contact_id),
            name: row.contact_name || "",
            email: row.contact_email || "",
            phone: row.contact_phone || "",
            mobile: row.contact_mobile || "",
            position: row.contact_position || "",
            department: row.contact_department || "",
          }
        : null,
      amountUsd: Number(row.amount_usd || 0),
      closeDate: row.close_date || null,
      updatedAt: row.updated_at || null,
      stageCode: row.stage_code || "",
      stageName: row.stage_name || "",
      stageOrder: Number(row.stage_order),
      isQualified: QUALIFIED_STAGE_CODES.includes(row.stage_code),
      salesStageId: Number(row.sales_stage_id || 0) || null,
      commercialStatusCode: row.commercial_status_code || null,
      activationStatusCode: row.activation_status_code || "activada",
      activationStatusName: row.activation_status_name || "Activada",
      lifecycle: ["ganada", "perdida", "anulada"].includes(
        row.commercial_status_code,
      )
        ? "historical"
        : row.activation_status_code &&
            row.activation_status_code !== "activada"
          ? "inactive"
          : "open",
      riskLevel:
        riskReasons.length > 1 ? "high" : riskReasons.length ? "medium" : "low",
      riskReasons,
      daysSinceActivity,
      currentStageValidated: false,
      openWeaknesses: [],
      nextStep: row.next_action_title
        ? {
            title: row.next_action_title,
            dueDate: row.next_action_due_date || null,
          }
        : null,
      nextPendingAction: row.next_action_title || null,
    };
  };
  const coachOpportunities = opportunityRows.map(mapOpportunity);
  const inactivePipelineOpportunities = inactiveRows.map(mapOpportunity);
  const historicalOpportunities = historicalRows.map(mapOpportunity);
  const opportunities = coachOpportunities.filter((item) =>
    QUALIFIED_STAGE_CODES.includes(item.stageCode),
  );

  const qualifiedAmount = opportunities.reduce(
    (sum, item) => sum + item.amountUsd,
    0,
  );
  return {
    period: {
      ...period,
      baseCurrencyCode: targetRows[0]?.currency_code || "USD",
    },
    quota: {
      assignedAmount: quotaAmount,
      actualAmount,
      gapAmount: Math.max(quotaAmount - actualAmount, 0),
      committedOpenAmount: opportunities
        .filter((item) => ["negociacion", "waiting"].includes(item.stageCode))
        .reduce((sum, item) => sum + item.amountUsd, 0),
      weightedOpenAmount: qualifiedAmount,
      currencyCode: targetRows[0]?.currency_code || "USD",
    },
    workboard: opportunities,
    coachOpportunities,
    inactivePipelineOpportunities,
    wonOpportunities: historicalOpportunities.filter(
      (item) => item.commercialStatusCode === "ganada",
    ),
    lostOpportunities: historicalOpportunities.filter(
      (item) => item.commercialStatusCode === "perdida",
    ),
    cancelledOpportunities: historicalOpportunities.filter(
      (item) => item.commercialStatusCode === "anulada",
    ),
    accounts: accountRows.map((account) => ({
      id: Number(account.id),
      name: account.name || "",
      registrationCode: account.registration_code || "",
      phone: account.phone || "",
      website: account.website || "",
      city: account.city || "",
      stateRegion: account.state_region || "",
      description: clip(account.description, 1800),
    })),
    leads: leads.map((lead) => ({
      id: Number(lead.id),
      title: lead.title || "",
      source: lead.lead_source || "",
      analysisStatus: lead.analysis_status || "",
      processingStatus: lead.processing_status || "",
      summary: clip(lead.summary, 1800),
      sourceNotes: clip(lead.source_notes, 1800),
      accountId: Number(lead.account_id || 0) || null,
      accountName: lead.account_name || "",
      opportunityId: Number(lead.primary_opportunity_id || 0) || null,
      opportunityName: lead.opportunity_name || "",
      sellerUserId: Number(lead.seller_user_id || 0) || null,
      substatusCode: lead.lead_substatus_code || "",
      reasonCode: lead.lead_reason_code || "",
      requiredActionCode: lead.lead_required_action_code || "",
      commercialComment: clip(lead.lead_commercial_comment, 1200),
      nextActionDueAt: lead.lead_next_action_due_at || null,
      updatedAt: lead.updated_at || lead.created_at || null,
    })),
    contactMappings: contactMappings.map((contact) => ({
      id: Number(contact.id),
      accountId: Number(contact.account_id),
      accountName: contact.account_name || "",
      name: [contact.first_name, contact.last_name]
        .filter(Boolean)
        .join(" ")
        .trim(),
      email: contact.email || "",
      phone: contact.phone || "",
      mobile: contact.mobile || "",
      positionTitle: contact.position_title || "",
      department: contact.department || "",
      managerContactId: Number(contact.manager_contact_id || 0) || null,
      influencesContactId: Number(contact.influences_contact_id || 0) || null,
      hierarchyLevel: contact.hierarchy_level || "",
      relationshipType: contact.relationship_type || "",
      influenceLevel: contact.influence_level || "",
    })),
    summary: {
      openOpportunities: opportunities.length,
      riskyOpportunities: opportunities.filter(
        (item) => item.riskLevel !== "low",
      ).length,
    },
  };
}

async function getMiAgentEnrichedContext(user, baseContext) {
  const activeOpportunities = Array.isArray(baseContext?.coachOpportunities)
    ? baseContext.coachOpportunities
    : Array.isArray(baseContext?.workboard)
      ? baseContext.workboard
      : [];
  const opportunities = [
    ...activeOpportunities,
    ...TERMINAL_OPPORTUNITY_COLLECTIONS.flatMap((key) =>
      Array.isArray(baseContext?.[key]) ? baseContext[key] : [],
    ),
  ];
  const canReadLeads = hasReadPermission(user, "interacciones");
  const ids = opportunities.map((item) => Number(item.id)).filter(Boolean);
  if (!ids.length) {
    return { ...baseContext, enriched: true, source: "mi_agent" };
  }

  const placeholders = buildInClause(ids);
  const [
    stageQuestions,
    documents,
    actions,
    weaknesses,
    stakeholders,
    themes,
    deliverables,
    strategies,
    validations,
    interactions,
    narratives,
    playbookStages,
    quotations,
    quotationItems,
    proposals,
  ] = await Promise.all([
    query(
      `SELECT o.id AS opportunity_id, q.id AS question_id,
              q.sales_stage_id, q.code, q.prompt, q.response_type,
              q.is_required, q.display_order,
              a.answer_value, a.answered_at, a.answered_by_user_id
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
      ids,
    ).catch(() => []),
    query(
      `SELECT odl.opportunity_id, d.public_id, d.original_file_name,
              dc.content_summary, dc.transcript_text, dc.normalized_text,
              dc.raw_text, da.stage_suggestions_json, da.entities_json,
              da.evidence_json
       FROM opportunity_document_links odl
       INNER JOIN documents d ON d.id = odl.document_id AND d.is_deleted = 0
       LEFT JOIN document_contents dc ON dc.document_id = d.id
       LEFT JOIN document_analyses da ON da.id = (SELECT da2.id FROM document_analyses da2
         WHERE da2.document_id = d.id AND da2.analysis_scope = 'opportunity_draft'
         ORDER BY da2.id DESC LIMIT 1)
       WHERE odl.opportunity_id IN (${placeholders})
       ORDER BY odl.opportunity_id, d.created_at DESC`,
      ids,
    ).catch(() => []),
    query(
      `SELECT opportunity_id, id, title, action_type, status, priority,
              owner_user_id,
              due_date, scheduled_at, success_criteria, notes,
              linked_theme_code, is_primary_next_step, updated_at
       FROM opportunity_workspace_actions
       WHERE opportunity_id IN (${placeholders})
       ORDER BY opportunity_id, due_date IS NULL, due_date, updated_at DESC`,
      ids,
    ).catch(() => []),
    query(
      `SELECT opportunity_id, title, category, severity, status, detail,
              owner_user_id,
              mitigation_plan, due_date, updated_at
       FROM opportunity_workspace_weaknesses
       WHERE opportunity_id IN (${placeholders})
       ORDER BY opportunity_id, FIELD(severity, 'high', 'medium', 'low'), updated_at DESC`,
      ids,
    ).catch(() => []),
    query(
      `SELECT opportunity_id, name, role_code, role_label, influence_level,
              support_level, status, priorities, concerns, next_action,
              last_contact_at, updated_at
       FROM opportunity_workspace_stakeholders
       WHERE opportunity_id IN (${placeholders})
       ORDER BY opportunity_id, updated_at DESC`,
      ids,
    ).catch(() => []),
    query(
      `SELECT opportunity_id, theme_code, claim, status, confidence,
              source_type, evidence_excerpt, updated_at
       FROM opportunity_workspace_theme_entries
       WHERE opportunity_id IN (${placeholders})
       ORDER BY opportunity_id, updated_at DESC`,
      ids,
    ).catch(() => []),
    query(
      `SELECT opportunity_id, deliverable_type, title, audience, status,
              version_label, sent_at, outcome_summary, updated_at
       FROM opportunity_workspace_deliverables
       WHERE opportunity_id IN (${placeholders})
       ORDER BY opportunity_id, updated_at DESC`,
      ids,
    ).catch(() => []),
    query(
      `SELECT opportunity_id, heading, route, final_objective, steps_json,
              derived_from_stage_code, updated_at
       FROM opportunity_workspace_recommended_strategy
       WHERE opportunity_id IN (${placeholders})`,
      ids,
    ).catch(() => []),
    query(
      `SELECT opportunity_id, criterion_code, sales_stage_id, status, score,
              confidence, summary, evidence_count, updated_at
       FROM opportunity_workspace_criterion_assessments
       WHERE opportunity_id IN (${placeholders})`,
      ids,
    ).catch(() => []),
    canReadLeads
      ? query(
          `SELECT COALESCE(i.primary_opportunity_id, iol.opportunity_id) AS opportunity_id,
              i.id, i.title,
              i.summary, i.source_notes, i.topics_json, i.actions_taken_json,
              i.next_steps_json, i.analysis_status, i.analyzed_at,
              i.created_at, i.updated_at
       FROM interactions i
       LEFT JOIN interaction_opportunity_links iol
         ON iol.interaction_id = i.id
        AND iol.opportunity_id IN (${placeholders})
       WHERE i.primary_opportunity_id IN (${placeholders})
          OR iol.opportunity_id IS NOT NULL
      ORDER BY i.created_at DESC`,
          [...ids, ...ids],
        ).catch(() => [])
      : Promise.resolve([]),
    query(
      `SELECT opportunity_id, status, result_json, fallback_json,
              created_at, finished_at
       FROM commercial_opportunity_narrative_jobs
       WHERE opportunity_id IN (${placeholders})
       ORDER BY opportunity_id, created_at DESC`,
      ids,
    ).catch(() => []),
    query(
      `SELECT sales.code AS stage_code, sales.name AS stage_name,
              sales.stage_order, st.objective, st.exit_criteria_summary,
              c.code AS criterion_code, c.title AS criterion_title,
              c.description AS criterion_description, c.is_required
       FROM opportunity_playbooks p
       INNER JOIN opportunity_playbook_versions v
         ON v.playbook_id = p.id AND v.is_active = 1
       INNER JOIN opportunity_playbook_stage_templates st
         ON st.playbook_version_id = v.id
       INNER JOIN opportunity_sales_stages sales ON sales.id = st.sales_stage_id
       LEFT JOIN opportunity_playbook_stage_criteria c
         ON c.stage_template_id = st.id
       WHERE p.is_active = 1
         AND sales.code IN (${COACH_STAGE_CODES.map(() => "?").join(", ")})
       ORDER BY st.display_order, c.display_order, c.id`,
      COACH_STAGE_CODES,
    ).catch(() => []),
    query(
      `SELECT q.id, q.opportunity_id, q.latest_version_id,
              q.created_at, q.updated_at,
              qas.code AS activation_status_code,
              qv.version_number, qv.proposal_name, qv.quotation_date,
              qv.currency_code, qs.code AS status_code, qs.name AS status_name
       FROM quotations q
       INNER JOIN quotation_activation_statuses qas ON qas.id = q.activation_status_id
       LEFT JOIN quotation_versions qv ON qv.id = q.latest_version_id
       LEFT JOIN quotation_statuses qs ON qs.id = qv.status_id
       WHERE q.opportunity_id IN (${placeholders})
       ORDER BY q.opportunity_id, q.updated_at DESC`,
      ids,
    ).catch(() => []),
    query(
      `SELECT q.opportunity_id, q.id AS quotation_id,
              qv.id AS quotation_version_id,
              section.id AS section_id, section.title AS section_title,
              item.id AS item_id, item.product_code,
              item.product_description, item.item_type, item.is_renewal,
              item.quantity, item.original_currency_code,
              item.original_list_price_unit, item.list_price_unit,
              provider.id AS provider_id, provider.name AS provider_name
       FROM quotations q
       INNER JOIN quotation_versions qv ON qv.id = q.latest_version_id
       INNER JOIN quotation_sections section
         ON section.quotation_version_id = qv.id
       INNER JOIN quotation_activation_statuses section_status
         ON section_status.id = section.activation_status_id
        AND section_status.code = 'activada'
       INNER JOIN quotation_section_items item
         ON item.quotation_section_id = section.id
       LEFT JOIN providers provider ON provider.id = item.provider_id
       WHERE q.opportunity_id IN (${placeholders})
       ORDER BY q.opportunity_id, q.id, section.display_order,
                item.display_order, item.id`,
      ids,
    ).catch(() => []),
    query(
      `SELECT id, opportunity_id, quotation_id, quotation_version_id,
              contact_id, title, status_code, created_at, updated_at
       FROM proposals
       WHERE opportunity_id IN (${placeholders})
         AND archived_at IS NULL
       ORDER BY opportunity_id, updated_at DESC`,
      ids,
    ).catch(() => []),
  ]);

  const groupByOpportunity = (rows) =>
    rows.reduce((groups, row) => {
      const id = Number(row.opportunity_id);
      const list = groups.get(id) || [];
      list.push(row);
      groups.set(id, list);
      return groups;
    }, new Map());
  const grouped = {
    stageQuestions: groupByOpportunity(stageQuestions),
    documents: groupByOpportunity(documents),
    actions: groupByOpportunity(actions),
    weaknesses: groupByOpportunity(weaknesses),
    stakeholders: groupByOpportunity(stakeholders),
    themes: groupByOpportunity(themes),
    deliverables: groupByOpportunity(deliverables),
    strategies: groupByOpportunity(strategies),
    validations: groupByOpportunity(validations),
    interactions: groupByOpportunity(interactions),
    narratives: groupByOpportunity(narratives),
    quotations: groupByOpportunity(quotations),
    quotationItems: groupByOpportunity(quotationItems),
    proposals: groupByOpportunity(proposals),
  };
  const stageDefinitions = playbookStages.reduce((definitions, row) => {
    const stageCode = String(row.stage_code || "");
    const definition = definitions.get(stageCode) || {
      code: stageCode,
      name: row.stage_name || "",
      order: Number(row.stage_order || 0),
      objective: clip(row.objective, 1600),
      expectedOutcome: clip(row.exit_criteria_summary, 1600),
      criteria: [],
    };
    if (row.criterion_code) {
      definition.criteria.push({
        code: row.criterion_code,
        title: row.criterion_title || "",
        description: clip(row.criterion_description, 1000),
        required: Boolean(row.is_required),
      });
    }
    definitions.set(stageCode, definition);
    return definitions;
  }, new Map());

  const enrichedOpportunities = opportunities.map((item) => {
    const id = Number(item.id);
    const strategy = grouped.strategies.get(id)?.[0] || null;
    const narrativeRow = grouped.narratives.get(id)?.[0] || null;
    const parseJson = (value) => {
      if (!value) return null;
      if (typeof value === "object") return value;
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    };
    const narrative =
      parseJson(narrativeRow?.result_json) ||
      parseJson(narrativeRow?.fallback_json) ||
      null;
    let strategySteps = [];
    try {
      strategySteps = strategy?.steps_json
        ? JSON.parse(strategy.steps_json)
        : [];
    } catch {
      strategySteps = [];
    }
    return {
      ...item,
      currentStage: stageDefinitions.get(item.stageCode) || {
        code: item.stageCode,
        name: item.stageName,
        order: null,
        objective: "",
        expectedOutcome: "",
        criteria: [],
      },
      stageQuestions: (grouped.stageQuestions.get(id) || []).map((row) => ({
        questionId: Number(row.question_id),
        stageId: Number(row.sales_stage_id),
        code: row.code || "",
        prompt: clip(row.prompt, 500),
        responseType: row.response_type || "",
        required: Boolean(row.is_required),
        answer: row.answer_value ? clip(row.answer_value, 2200) : null,
        answeredAt: row.answered_at || null,
        answeredByUserId: Number(row.answered_by_user_id || 0) || null,
        status: row.answer_value ? "answered" : "pending",
      })),
      stageAnswers: (grouped.stageQuestions.get(id) || [])
        .filter((row) => row.answer_value)
        .map((row) => ({
          questionId: Number(row.question_id),
          stageId: Number(row.sales_stage_id),
          code: row.code || "",
          prompt: clip(row.prompt, 500),
          answer: clip(row.answer_value, 2200),
          required: Boolean(row.is_required),
          answeredAt: row.answered_at || null,
        })),
      documents: (grouped.documents.get(id) || []).slice(0, 4).map((row) => ({
        publicId: row.public_id,
        fileName: row.original_file_name || "",
        summary: clip(row.content_summary, 1200),
        text: clip(
          row.normalized_text || row.transcript_text || row.raw_text,
          1400,
        ),
        analysis: clip(
          [row.stage_suggestions_json, row.entities_json, row.evidence_json]
            .filter(Boolean)
            .join(" "),
          1800,
        ),
      })),
      activities: (grouped.interactions.get(id) || [])
        .slice(0, 6)
        .map((row) => ({
          id: Number(row.id),
          title: row.title || "",
          summary: clip(row.summary, 900),
          notes: clip(row.source_notes, 600),
          topics: clip(row.topics_json, 400),
          actionsTaken: clip(row.actions_taken_json, 500),
          nextSteps: clip(row.next_steps_json, 500),
          status: row.analysis_status || "",
          occurredAt: row.analyzed_at || row.created_at || null,
        })),
      quotations: (grouped.quotations.get(id) || []).slice(0, 6).map((row) => ({
        id: Number(row.id),
        latestVersionId: Number(row.latest_version_id || 0) || null,
        latestVersionNumber: Number(row.version_number || 0) || null,
        name: row.proposal_name || "",
        quotationDate: row.quotation_date || null,
        currencyCode: row.currency_code || null,
        statusCode: row.status_code || null,
        statusName: row.status_name || null,
        activationStatusCode: row.activation_status_code || null,
        updatedAt: row.updated_at || row.created_at || null,
        products: (grouped.quotationItems.get(id) || [])
          .filter((item) => Number(item.quotation_id) === Number(row.id))
          .slice(0, 40)
          .map((item) => ({
            id: Number(item.item_id),
            sectionId: Number(item.section_id),
            sectionTitle: item.section_title || "",
            code: item.product_code || "",
            description: clip(item.product_description, 700),
            type: item.item_type || "producto",
            isRenewal: Boolean(item.is_renewal),
            quantity: Number(item.quantity || 0),
            currencyCode: item.original_currency_code || null,
            originalListPriceUnit:
              item.original_list_price_unit == null
                ? null
                : Number(item.original_list_price_unit),
            listPriceUnit: Number(item.list_price_unit || 0),
            providerId: Number(item.provider_id || 0) || null,
            providerName: item.provider_name || "",
          })),
      })),
      proposals: (grouped.proposals.get(id) || []).slice(0, 6).map((row) => ({
        id: Number(row.id),
        quotationId: Number(row.quotation_id),
        quotationVersionId: Number(row.quotation_version_id),
        contactId: Number(row.contact_id),
        title: row.title || "",
        statusCode: row.status_code || "",
        updatedAt: row.updated_at || row.created_at || null,
      })),
      workspace: {
        developmentNarrative: narrative
          ? {
              jobStatus: narrativeRow?.status || "",
              source:
                narrative?.aiNarrativeSource ||
                (narrativeRow?.result_json ? "openai" : "fallback"),
              generatedAt:
                narrative?.aiNarrativeGeneratedAt ||
                narrativeRow?.finished_at ||
                narrativeRow?.created_at ||
                null,
              statusSummary: clip(narrative?.aiStatusSummary, 1800),
              nextStepRecommendation: clip(
                narrative?.aiNextStepRecommendation,
                1800,
              ),
              contract: narrative?.aiContract
                ? {
                    descriptionSituationText: clip(
                      narrative.aiContract.descriptionSituationText,
                      1600,
                    ),
                    salesStrategyText: clip(
                      narrative.aiContract.salesStrategyText,
                      1600,
                    ),
                    nextBestStepText: clip(
                      narrative.aiContract.nextBestStepText,
                      1600,
                    ),
                    alternativeStepText: clip(
                      narrative.aiContract.alternativeStepText,
                      1600,
                    ),
                  }
                : null,
            }
          : null,
        actions: (grouped.actions.get(id) || []).slice(0, 10).map((row) => ({
          id: Number(row.id),
          title: row.title || "",
          type: row.action_type || "",
          status: row.status || "",
          priority: row.priority || "",
          ownerUserId: Number(row.owner_user_id || 0) || null,
          dueDate: row.due_date || null,
          scheduledAt: row.scheduled_at || null,
          successCriteria: clip(row.success_criteria, 900),
          notes: clip(row.notes, 900),
          theme: row.linked_theme_code || null,
          primary: Boolean(row.is_primary_next_step),
        })),
        weaknesses: (grouped.weaknesses.get(id) || [])
          .slice(0, 8)
          .map((row) => ({
            title: row.title || "",
            category: row.category || "",
            severity: row.severity || "",
            status: row.status || "",
            ownerUserId: Number(row.owner_user_id || 0) || null,
            detail: clip(row.detail, 1000),
            mitigation: clip(row.mitigation_plan, 1000),
            dueDate: row.due_date || null,
          })),
        stakeholders: (grouped.stakeholders.get(id) || [])
          .slice(0, 8)
          .map((row) => ({
            name: row.name || "",
            role: row.role_label || row.role_code || "",
            influence: row.influence_level || "",
            support: row.support_level || "",
            status: row.status || "",
            priorities: clip(row.priorities, 800),
            concerns: clip(row.concerns, 800),
            nextAction: clip(row.next_action, 800),
          })),
        themes: (grouped.themes.get(id) || []).slice(0, 10).map((row) => ({
          theme: row.theme_code || "",
          claim: clip(row.claim, 1000),
          status: row.status || "",
          confidence: row.confidence || "",
          evidence: clip(row.evidence_excerpt, 1200),
        })),
        deliverables: (grouped.deliverables.get(id) || [])
          .slice(0, 6)
          .map((row) => ({
            type: row.deliverable_type || "",
            title: row.title || "",
            audience: row.audience || "",
            status: row.status || "",
            sentAt: row.sent_at || null,
            outcome: clip(row.outcome_summary, 1000),
          })),
        strategy: strategy
          ? {
              heading: clip(strategy.heading, 1200),
              route: clip(strategy.route, 800),
              finalObjective: clip(strategy.final_objective, 1000),
              steps: strategySteps.slice(0, 8),
            }
          : null,
        criteria: (grouped.validations.get(id) || []).map((row) => ({
          code: row.criterion_code || "",
          stageId: Number(row.sales_stage_id || 0),
          status: row.status || "",
          score: Number(row.score || 0),
          confidence: row.confidence || "",
          summary: clip(row.summary, 1000),
          evidenceCount: Number(row.evidence_count || 0),
        })),
      },
    };
  });
  const enrichedById = new Map(
    enrichedOpportunities.map((item) => [Number(item.id), item]),
  );

  return {
    ...baseContext,
    enriched: true,
    source: "mi_agent",
    selectedRecord: baseContext.selectedRecord
      ? enrichedById.get(Number(baseContext.selectedRecord.id)) ||
        baseContext.selectedRecord
      : null,
    coachOpportunities: activeOpportunities.map(
      (item) => enrichedById.get(Number(item.id)) || item,
    ),
    ...Object.fromEntries(
      TERMINAL_OPPORTUNITY_COLLECTIONS.map((key) => [
        key,
        (baseContext[key] || []).map(
          (item) => enrichedById.get(Number(item.id)) || item,
        ),
      ]),
    ),
    workboard: (baseContext.workboard || []).map(
      (item) => enrichedById.get(Number(item.id)) || item,
    ),
  };
}

function extractOutputText(payload) {
  const direct = String(payload?.output_text || "").trim();
  if (direct) return direct;

  return (
    (Array.isArray(payload?.output) ? payload.output : [])
      .flatMap((entry) => (Array.isArray(entry?.content) ? entry.content : []))
      .filter((part) => part?.type === "output_text")
      .map((part) => String(part?.text || "").trim())
      .find(Boolean) || ""
  );
}

function parseJson(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return null;
  try {
    return JSON.parse(normalized);
  } catch {
    const start = normalized.indexOf("{");
    const end = normalized.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(normalized.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

const COACH_INTENTS = new Set([
  "seller_status",
  "today_priorities",
  "at_risk_opportunities",
  "neglected_accounts",
  "pipeline_coverage",
  "opportunity_preparation",
  "context_query",
  "risk_diagnosis",
  "recommendation",
  "interaction_preparation",
  "create_record",
  "update_record",
  "continue_work",
  "clarification",
  "freeform",
]);

export function normalizeCoachResult(
  result,
  snapshot,
  question = "",
  selectedContext = {},
  authoritativeStageReadiness = null,
) {
  const source = result && typeof result === "object" ? result : {};
  const activeOpportunities = Array.isArray(snapshot?.coachOpportunities)
    ? snapshot.coachOpportunities
    : [
        ...(Array.isArray(snapshot?.pipeline?.opportunities)
          ? snapshot.pipeline.opportunities
          : []),
        ...(Array.isArray(snapshot?.workboard) ? snapshot.workboard : []),
      ];
  const opportunities = [
    ...activeOpportunities,
    ...TERMINAL_OPPORTUNITY_COLLECTIONS.flatMap((key) =>
      Array.isArray(snapshot?.[key]) ? snapshot[key] : [],
    ),
  ];
  const opportunityIds = new Set(
    opportunities.map((item) => Number(item?.id)).filter((id) => id > 0),
  );
  const accountIds = new Set(
    [
      ...(Array.isArray(snapshot?.accounts) ? snapshot.accounts : []),
      ...opportunities.flatMap((item) => [
        item?.account,
        { id: item?.accountId },
      ]),
    ]
      .map((item) => Number(item?.id))
      .filter((id) => id > 0),
  );
  const contactIds = new Set(
    opportunities
      .map((item) => Number(item?.contact?.id))
      .filter((id) => id > 0),
  );
  const leads = Array.isArray(snapshot?.leads) ? snapshot.leads : [];
  const leadIds = new Set(
    leads.map((item) => Number(item?.id)).filter((id) => id > 0),
  );
  const contactMappings = Array.isArray(snapshot?.contactMappings)
    ? snapshot.contactMappings
    : [];
  const stageAnswers = opportunities.flatMap((item) =>
    (Array.isArray(item?.stageAnswers) ? item.stageAnswers : []).map(
      (answer) => ({
        ...answer,
        opportunityId: Number(item.id),
      }),
    ),
  );
  const activityIdsByOpportunity = new Map(
    opportunities.map((item) => [
      Number(item.id),
      new Set(
        (Array.isArray(item?.workspace?.actions) ? item.workspace.actions : [])
          .map((action) => Number(action?.id || 0))
          .filter((id) => id > 0),
      ),
    ]),
  );
  contactMappings.forEach((contact) => {
    const contactId = Number(contact?.id || 0);
    const accountId = Number(contact?.accountId || 0);
    if (contactId > 0) contactIds.add(contactId);
    if (accountId > 0) accountIds.add(accountId);
  });
  leads.forEach((lead) => {
    const accountId = Number(lead?.accountId || 0);
    if (accountId > 0) accountIds.add(accountId);
  });
  const rawAction =
    source.action && typeof source.action === "object" ? source.action : null;
  const actionOpportunityId = Number(rawAction?.opportunityId || 0);
  const entities =
    source.entities && typeof source.entities === "object"
      ? source.entities
      : {};
  const selectedContextOpportunityId = Number(
    selectedContext?.opportunityId || 0,
  );
  const selectedContextAccountId = Number(selectedContext?.accountId || 0);
  const selectedContextContactId = Number(selectedContext?.contactId || 0);
  let operations = (Array.isArray(source.operations) ? source.operations : [])
    .map((operation) => {
      if (!operation || typeof operation !== "object") return null;
      const kind = String(operation.kind || "").trim();
      const opportunityId = Number(
        ["activity", "stage_answer", "opportunity_field"].includes(kind)
          ? selectedContextOpportunityId || Number(operation.opportunityId || 0)
          : Number(operation.opportunityId || 0),
      );
      const accountId = Number(
        kind === "account_field"
          ? selectedContextAccountId || Number(operation.accountId || 0)
          : Number(operation.accountId || 0),
      );
      const contactId = Number(
        kind === "contact_field"
          ? selectedContextContactId || Number(operation.contactId || 0)
          : Number(operation.contactId || 0),
      );
      if (
        [
          "create_account",
          "create_contact",
          "create_opportunity",
          "create_quotation",
          "create_proposal",
          "lead_resolve",
        ].includes(kind)
      ) {
        const payload =
          operation.payload && typeof operation.payload === "object"
            ? operation.payload
            : null;
        const entityId = Number(
          operation.interactionId ||
            operation.accountId ||
            operation.contactId ||
            operation.opportunityId ||
            operation.quotationVersionId ||
            0,
        );
        if (!payload || (kind !== "create_account" && entityId <= 0))
          return null;
        if (
          kind === "lead_resolve" &&
          !leadIds.has(Number(operation.interactionId))
        )
          return null;
        const payloadAccountId = Number(
          payload.accountId || payload.accountResolution?.accountId || 0,
        );
        const payloadContactId = Number(payload.contactId || 0);
        if (payloadAccountId && !accountIds.has(payloadAccountId)) return null;
        if (payloadContactId && !contactIds.has(payloadContactId)) return null;
        return {
          ...operation,
          kind,
          entityType:
            kind === "create_account"
              ? "account"
              : kind === "create_contact"
                ? "contact"
                : kind === "create_opportunity"
                  ? "opportunity"
                  : kind === "create_quotation"
                    ? "quotation"
                    : kind === "create_proposal"
                      ? "proposal"
                      : "lead",
          payload,
          title: String(
            operation.title ||
              (kind === "lead_resolve"
                ? "Resolver lead"
                : kind === "create_account"
                  ? "Crear cuenta"
                  : kind === "create_contact"
                    ? "Crear contacto"
                    : kind === "create_opportunity"
                      ? "Crear oportunidad"
                      : kind === "create_quotation"
                        ? "Crear cotización"
                        : "Crear propuesta"),
          ).trim(),
          source: {
            type:
              kind === "lead_resolve" ? "lead" : kind.replace("create_", ""),
            id: entityId || null,
          },
        };
      }
      if (kind === "account_field" && accountId > 0) {
        if (!accountIds.has(accountId)) return null;
        return {
          ...operation,
          kind,
          entityType: "account",
          accountId,
          field: String(operation.field || "").trim(),
          value: String(operation.value ?? "").trim(),
          title: String(operation.title || "Actualizar cuenta").trim(),
          source: { type: "account", id: accountId },
        };
      }
      if (kind === "contact_field" && contactId > 0) {
        if (!contactIds.has(contactId)) return null;
        return {
          ...operation,
          kind,
          entityType: "contact",
          contactId,
          field: String(operation.field || "").trim(),
          value: String(operation.value ?? "").trim(),
          title: String(operation.title || "Actualizar contacto").trim(),
          source: { type: "contact", id: contactId },
        };
      }
      if (
        kind === "lead_call_outcome" &&
        Number(operation.interactionId || 0) > 0
      ) {
        if (!leadIds.has(Number(operation.interactionId))) return null;
        const substatusCode = String(operation.substatusCode || "").trim();
        const reasonCode = String(operation.reasonCode || "").trim();
        const requiredActionCode = String(
          operation.requiredActionCode || "",
        ).trim();
        if (!substatusCode || !reasonCode || !requiredActionCode) return null;
        return {
          kind,
          interactionId: Number(operation.interactionId),
          substatusCode,
          reasonCode,
          requiredActionCode,
          comment: String(operation.comment || "").trim(),
          nextActionDueAt:
            String(operation.nextActionDueAt || "").trim() || null,
          title: String(
            operation.title || "Registrar resultado del lead",
          ).trim(),
          source: { type: "lead", id: Number(operation.interactionId) },
          entityType: "lead",
        };
      }
      if (kind === "activity" && opportunityIds.has(opportunityId)) {
        const activityId = Number(operation.activityId || 0) || null;
        if (
          activityId &&
          !activityIdsByOpportunity.get(opportunityId)?.has(activityId)
        )
          return null;
        return {
          kind,
          entityType: "opportunity_activity",
          ...operation,
          opportunityId,
          actionType:
            String(operation.actionType || "meeting").trim() || "meeting",
          title: String(operation.title || "Actividad comercial").trim(),
          status: ["pending", "in_progress", "blocked", "done"].includes(
            String(operation.status || "").trim(),
          )
            ? String(operation.status).trim()
            : "pending",
          priority: ["low", "medium", "high"].includes(
            String(operation.priority || "").trim(),
          )
            ? String(operation.priority).trim()
            : "medium",
          scheduledAt: String(operation.scheduledAt || "").trim() || null,
          dueDate: String(operation.dueDate || "").trim() || null,
          notes: String(operation.notes || "").trim(),
          successCriteria: String(operation.successCriteria || "").trim(),
          activityId,
          source: { type: "opportunity", id: opportunityId },
        };
      }
      if (!opportunityIds.has(opportunityId)) return null;
      if (kind === "stage_answer") {
        const questionId = Number(operation.questionId || 0);
        const answerValue = String(operation.answerValue || "").trim();
        if (!questionId || !answerValue) return null;
        return {
          kind,
          ...operation,
          opportunityId,
          questionId,
          answerValue,
          answerMode: operation.answerMode === "append" ? "append" : "replace",
          title: String(
            operation.title || "Actualizar respuesta de etapa",
          ).trim(),
          source: { type: "opportunity", id: opportunityId },
          entityType: "stage_answer",
          previousAnswer:
            stageAnswers.find(
              (answer) =>
                Number(answer.opportunityId) === opportunityId &&
                Number(answer.questionId) === questionId,
            )?.answer || "",
        };
      }
      if (
        ["opportunity_field", "account_field", "contact_field"].includes(kind)
      ) {
        const field = String(operation.field || "").trim();
        const allowedFields =
          kind === "opportunity_field"
            ? ["name", "amountUsd", "closeDate"]
            : kind === "account_field"
              ? [
                  "name",
                  "phone",
                  "website",
                  "city",
                  "stateRegion",
                  "companyDescription",
                ]
              : [
                  "firstName",
                  "lastName",
                  "email",
                  "mobile",
                  "phone",
                  "positionTitle",
                  "department",
                  "city",
                  "stateRegion",
                  "hierarchyLevelId",
                  "relationshipTypeId",
                  "influenceLevelId",
                  "managerContactId",
                  "influencesContactId",
                ];
        if (!allowedFields.includes(field)) return null;
        return {
          kind,
          ...operation,
          opportunityId,
          field,
          value: String(operation.value ?? "").trim(),
          title: String(operation.title || "Actualizar oportunidad").trim(),
          source: {
            type:
              kind === "account_field"
                ? "account"
                : kind === "contact_field"
                  ? "contact"
                  : "opportunity",
            id:
              kind === "account_field"
                ? accountId
                : kind === "contact_field"
                  ? contactId
                  : opportunityId,
          },
          entityType:
            kind === "opportunity_field"
              ? "opportunity"
              : kind.replace("_field", ""),
        };
      }
      return null;
    })
    .filter(Boolean)
    .slice(0, 6);
  const normalizedQuestion = String(question || "").trim();
  const selectedOpportunityId = Number(selectedContext?.opportunityId || 0);
  const selectedOpportunity =
    selectedOpportunityId > 0
      ? opportunities.find(
          (item) => Number(item.id) === selectedOpportunityId,
        ) || null
      : null;
  const inferredOpportunityId = inferOpportunityIdFromText(
    opportunities,
    `${normalizedQuestion} ${source.answer || ""}`,
  );
  const selectedAcceptanceAnswer = selectedOpportunity
    ? stageAnswers.find(
        (answer) =>
          Number(answer.opportunityId) === selectedOpportunityId &&
          /aceptaci[oó]n|validaci[oó]n|conformidad/i.test(
            `${answer.code} ${answer.prompt}`,
          ) &&
          String(answer.answer || "").trim(),
      )
    : null;
  const asksAcceptance =
    /acept(o|aron|ada|ado|aci[oó]n)|validaci[oó]n|conformidad/i.test(
      normalizedQuestion,
    ) && /propuesta|t[eé]cnica|soluci[oó]n/i.test(normalizedQuestion);
  const asksAcceptanceGap =
    /100\s*%|cien\s*por\s*ciento|por qu[eé].*100/i.test(normalizedQuestion) &&
    Boolean(selectedAcceptanceAnswer);
  const asksOpportunityAmount =
    selectedOpportunity &&
    /\b(monto|importe|valor|cantidad)\b/i.test(normalizedQuestion) &&
    /\b(oportunidad|esta|seleccionad|actual)\b/i.test(normalizedQuestion);
  const selectedAmount = Number(selectedOpportunity?.amountUsd || 0);
  const asksToChangeAmount =
    selectedOpportunity &&
    (/\b(cambia|cambiar|actualiza|actualizar|modifica|modificar|ajusta|ajustar|sube|subir|aumenta|aumentar|incrementa|incrementar|baja|bajar|pasa|pasar)\b/i.test(
      normalizedQuestion,
    ) ||
      /subi[oó]|aument[oó]|increment[oó]|baj[oó]|pas[oó]/i.test(
        normalizedQuestion,
      )) &&
    /\b(monto|importe|valor|cantidad)\b/i.test(normalizedQuestion);
  const amountMatch = normalizedQuestion.match(
    /(?:a|en|por)\s*\$?\s*([\d.,]+)/i,
  );
  const proposedAmount = amountMatch
    ? Number(String(amountMatch[1]).replace(/,/g, ""))
    : 0;
  if (!operations.length && asksToChangeAmount && proposedAmount > 0) {
    operations = [
      {
        kind: "opportunity_field",
        opportunityId: selectedOpportunityId,
        field: "amountUsd",
        value: String(proposedAmount),
        title: "Actualizar importe de la oportunidad",
        source: { type: "opportunity", id: selectedOpportunityId },
        entityType: "opportunity",
      },
    ];
  }
  let inferredStageAnswer = false;
  const asksForActivity =
    /\b(agend|registr|crea|program).*(reuni[oó]n|llamada|actividad|seguimiento|demostraci[oó]n|visita)|\b(actividad|llamada|reuni[oó]n|demostraci[oó]n|visita)\b.*\b(agend|registr|crea|program)/i.test(
      normalizedQuestion,
    );
  const requestsStageAnswer =
    /\b(actualiza|actualizar|registra|registrar|guarda|guardar|modifica|modificar|captura|capturar|anota|anotar)\b/i.test(
      normalizedQuestion,
    ) ||
    /\b(motivaci[oó]n|motivo|necesidad|problema|prioridad)\b.*\bes\b/i.test(
      normalizedQuestion,
    );
  if (!operations.length && !asksForActivity && requestsStageAnswer) {
    const selectedOpportunityId = Number(selectedContext?.opportunityId || 0);
    const stageAnswerCandidate = stageAnswers.find(
      (answer) =>
        (!selectedOpportunityId ||
          Number(answer.opportunityId) === selectedOpportunityId) &&
        /motiv|motivo|neces|problema|priorid/i.test(
          `${answer.code} ${answer.prompt}`,
        ),
    );
    const opportunityId =
      selectedOpportunityId || Number(stageAnswerCandidate?.opportunityId || 0);
    if (stageAnswerCandidate && opportunityId) {
      const answerValue = normalizedQuestion
        .replace(
          /^\s*(actualiza|actualizar|registra|registrar|guarda|guardar|modifica|modificar|captura|capturar|anota|anotar)\b[^:]*?(?:indicando que|con el texto|que)\s*/i,
          "",
        )
        .replace(
          /^\s*una de las respuestas\s*(?:indicando que|con el texto|que)\s*/i,
          "",
        )
        .trim();
      if (answerValue) {
        operations = [
          {
            kind: "stage_answer",
            opportunityId,
            questionId: Number(stageAnswerCandidate.questionId),
            answerValue,
            answerMode: "replace",
            title: `Registrar respuesta: ${stageAnswerCandidate.prompt}`,
            source: { type: "opportunity", id: opportunityId },
            entityType: "stage_answer",
            previousAnswer: stageAnswerCandidate.answer || "",
          },
        ];
        inferredStageAnswer = true;
      }
    }
  }
  if (!operations.length && asksForActivity && selectedOpportunityId) {
    operations = [
      {
        kind: "activity",
        opportunityId: selectedOpportunityId,
        actionType: /llamada/i.test(normalizedQuestion)
          ? "call"
          : /demostraci[oó]n|demo/i.test(normalizedQuestion)
            ? "presentation"
            : /visita/i.test(normalizedQuestion)
              ? "visit"
              : "conference",
        title: /demostraci[oó]n|demo/i.test(normalizedQuestion)
          ? "Demostración comercial"
          : /visita/i.test(normalizedQuestion)
            ? "Visita comercial"
            : /llamada/i.test(normalizedQuestion)
              ? "Llamada comercial"
              : "Reunión comercial",
        status: "pending",
        priority: "medium",
        scheduledAt: null,
        dueDate: null,
        notes: normalizedQuestion,
        successCriteria: "",
        source: { type: "opportunity", id: selectedOpportunityId },
        entityType: "opportunity_activity",
      },
    ];
  }
  const requestsOpportunityCreation =
    /\b(crea|crear|abrir|abre|genera|generar|registra|registrar)\b.*\boportunidad\b/i.test(
      normalizedQuestion,
    );
  const requestedOpportunityName = Array.isArray(entities.names)
    ? entities.names.map((name) => String(name || "").trim()).find(Boolean) ||
      ""
    : "";
  const requestedAccountId = Number(entities.accountId || 0);
  const requestedContactId = Number(entities.contactId || 0);
  if (
    !operations.length &&
    requestsOpportunityCreation &&
    requestedOpportunityName &&
    accountIds.has(requestedAccountId) &&
    contactIds.has(requestedContactId)
  ) {
    operations = [
      {
        kind: "create_opportunity",
        accountId: requestedAccountId,
        contactId: requestedContactId,
        title: "Crear oportunidad",
        payload: {
          accountId: requestedAccountId,
          contactId: requestedContactId,
          name: requestedOpportunityName,
        },
        source: { type: "account", id: requestedAccountId },
        entityType: "opportunity",
      },
    ];
  }
  const requestsQuotationCreation =
    /\b(crea|crear|genera|generar|prepara|preparar)\b.*\bcotizaci[oó]n\b/i.test(
      normalizedQuestion,
    );
  if (!operations.length && requestsQuotationCreation && selectedOpportunity) {
    const accountId =
      Number(
        selectedOpportunity.account?.id || selectedOpportunity.accountId || 0,
      ) || null;
    const contactId =
      Number(
        selectedOpportunity.contact?.id || selectedOpportunity.contactId || 0,
      ) || null;
    if (accountId && contactId) {
      operations = [
        {
          kind: "create_quotation",
          opportunityId: selectedOpportunityId,
          accountId,
          contactId,
          title: "Crear cotización",
          payload: {
            accountId,
            contactId,
            proposalName: selectedOpportunity.name || "Cotización comercial",
          },
          source: { type: "opportunity", id: selectedOpportunityId },
          entityType: "quotation",
        },
      ];
    }
  }
  operations = filterValidCoachOperations(operations);
  const selectedOperation = operations.find(
    (operation) =>
      Number(operation?.opportunityId || 0) === selectedOpportunityId,
  );
  const modelClaimsMissingOpportunity =
    /no hay una oportunidad|no existe una oportunidad|no está seleccionada|no esta seleccionada|necesito confirmar la oportunidad/i.test(
      String(source.answer || ""),
    );
  const answerWithoutContextContradiction = String(source.answer || "")
    .replace(
      /(?:no hay una oportunidad seleccionada|no existe una oportunidad seleccionada|no está seleccionada la oportunidad|no esta seleccionada la oportunidad)[^.?!]*(?:[.?!]|$)/i,
      "",
    )
    .replace(
      /la oportunidad más cercana en contexto/gi,
      "La oportunidad activa",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
  const operationAnswer =
    selectedOperation?.kind === "opportunity_field" &&
    selectedOperation.field === "amountUsd"
      ? `Se propone cambiar el importe de la oportunidad ${selectedOpportunityId} a ${Number(selectedOperation.value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD.`
      : selectedOperation?.kind === "activity"
        ? `Se propone registrar la actividad en la oportunidad ${selectedOpportunityId}.`
        : selectedOperation?.kind === "stage_answer"
          ? `Se propone actualizar una respuesta de etapa en la oportunidad ${selectedOpportunityId}.`
          : null;
  const requestsActivity =
    /\b(agend|registr|crea|program).*(reuni[oó]n|llamada|actividad)|reuni[oó]n.*(jueves|viernes|lunes|martes|mi[eé]rcoles|s[aá]bado|domingo)/i.test(
      normalizedQuestion,
    );
  const clarification =
    source.clarification && typeof source.clarification === "object"
      ? source.clarification
      : !operations.length && !rawAction?.opportunityId && requestsActivity
        ? {
            type: "select_opportunity",
            message:
              "Para registrar la reunión necesito asociarla a una oportunidad.",
            missing: ["Oportunidad", "Fecha completa"],
            candidates: opportunities.slice(0, 8).map((item) => ({
              id: Number(item.id),
              name: item.name || "Oportunidad sin nombre",
              accountName:
                item.accountName || item.account?.name || "Sin cuenta",
            })),
            activity: {
              actionType: /llamada/i.test(normalizedQuestion)
                ? "call"
                : "meeting",
              title: /compras/i.test(normalizedQuestion)
                ? "Reunión con Compras"
                : "Reunión comercial",
              rawRequest: normalizedQuestion,
            },
          }
        : null;

  const normalizedResponse = {
    intent: COACH_INTENTS.has(String(source.intent || "").trim())
      ? String(source.intent).trim()
      : "freeform",
    responseType: [
      "informational",
      "recommendation",
      "change_request",
      "clarification",
    ].includes(String(source.responseType || "").trim())
      ? inferredStageAnswer
        ? "change_request"
        : String(source.responseType).trim()
      : clarification
        ? "clarification"
        : rawAction
          ? "recommendation"
          : "informational",
    answer:
      asksAcceptance && selectedAcceptanceAnswer
        ? `La oportunidad ${selectedOpportunity.id} tiene registrada una aceptación de la propuesta técnica de ${selectedAcceptanceAnswer.answer}.`
        : asksAcceptanceGap
          ? `La oportunidad ${selectedOpportunity.id} registra una aceptación de la propuesta técnica de ${selectedAcceptanceAnswer.answer}, por lo que no alcanzó el 100%. El contexto comercial no registra una explicación específica de esa diferencia.`
          : asksOpportunityAmount
            ? `El importe de la oportunidad ${selectedOpportunity.id} es ${selectedAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD.`
            : operationAnswer && modelClaimsMissingOpportunity
              ? operationAnswer
              : selectedOpportunity && modelClaimsMissingOpportunity
                ? answerWithoutContextContradiction ||
                  `No encontré información suficiente en los datos de la oportunidad ${selectedOpportunity.id}.`
                : String(source.answer || "").trim() ||
                  "No encontré una respuesta suficiente en el contexto disponible.",
    evidence: (asksAcceptance && selectedAcceptanceAnswer
      ? [
          `Respuesta de etapa ${selectedAcceptanceAnswer.code}: ${selectedAcceptanceAnswer.answer}`,
        ]
      : asksAcceptanceGap
        ? [
            `Respuesta de etapa ${selectedAcceptanceAnswer.code}: ${selectedAcceptanceAnswer.answer}`,
          ]
        : asksOpportunityAmount
          ? [
              `Importe registrado en CRM para la oportunidad ${selectedOpportunity.id}: ${selectedAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD.`,
            ]
          : Array.isArray(source.evidence)
            ? source.evidence
            : []
    )
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 8),
    facts: Array.isArray(source.facts) ? source.facts : [],
    inferences: (Array.isArray(source.inferences) ? source.inferences : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 30),
    pendingItems: (Array.isArray(source.pendingItems)
      ? source.pendingItems
      : []
    )
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 30),
    recommendation:
      source.recommendation && typeof source.recommendation === "object"
        ? source.recommendation
        : String(source.recommendation || "").trim() || null,
    operations,
    clarification,
    confidence: ["high", "medium", "low"].includes(
      String(source.confidence || "").trim(),
    )
      ? String(source.confidence).trim()
      : "medium",
    entities: {
      opportunityId: opportunityIds.has(selectedOpportunityId)
        ? selectedOpportunityId
        : opportunityIds.has(actionOpportunityId)
          ? actionOpportunityId
          : opportunityIds.has(Number(entities.opportunityId || 0))
            ? Number(entities.opportunityId)
            : opportunityIds.has(inferredOpportunityId)
              ? inferredOpportunityId
              : null,
      accountId: accountIds.has(Number(entities.accountId || 0))
        ? Number(entities.accountId)
        : null,
      contactId: contactIds.has(Number(entities.contactId || 0))
        ? Number(entities.contactId)
        : null,
      leadId: leadIds.has(Number(entities.leadId || 0))
        ? Number(entities.leadId)
        : null,
      names: (Array.isArray(entities.names) ? entities.names : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 8),
    },
    action: rawAction
      ? {
          title: String(rawAction.title || "").trim(),
          opportunityId: opportunityIds.has(actionOpportunityId)
            ? actionOpportunityId
            : null,
          actionType: String(rawAction.actionType || "other").trim() || "other",
          status: ["pending", "in_progress", "blocked", "done"].includes(
            String(rawAction.status || "").trim(),
          )
            ? String(rawAction.status).trim()
            : "pending",
          priority: ["low", "medium", "high"].includes(
            String(rawAction.priority || "").trim(),
          )
            ? String(rawAction.priority).trim()
            : "medium",
          suggestedDueDate:
            String(rawAction.suggestedDueDate || "").trim() || null,
          scheduledAt: String(rawAction.scheduledAt || "").trim() || null,
          notes: String(rawAction.notes || "").trim(),
          successCriteria: String(rawAction.successCriteria || "").trim(),
        }
      : null,
    stageReadiness:
      authoritativeStageReadiness ||
      (source.stageReadiness && typeof source.stageReadiness === "object"
        ? source.stageReadiness
        : null),
  };

  const parsedResponse = safeParseCoachResponse(normalizedResponse);
  if (parsedResponse.success) return parsedResponse.data;

  return safeParseCoachResponse({
    intent: authoritativeStageReadiness
      ? "opportunity_preparation"
      : "freeform",
    responseType: "informational",
    answer: normalizedResponse.answer.slice(0, 6000),
    facts: [],
    evidence: normalizedResponse.evidence
      .map((item) => item.slice(0, 1600))
      .slice(0, 30),
    inferences: [],
    pendingItems: [],
    recommendation: null,
    confidence: "low",
    entities: {
      opportunityId: normalizedResponse.entities.opportunityId,
      accountId: normalizedResponse.entities.accountId,
      contactId: normalizedResponse.entities.contactId,
      leadId: normalizedResponse.entities.leadId,
      names: normalizedResponse.entities.names
        .map((item) => item.slice(0, 300))
        .slice(0, 20),
    },
    operations: [],
    clarification: null,
    action: null,
    stageReadiness: authoritativeStageReadiness,
  }).data;
}

function normalizeAnalysis(payload, snapshot, developmentPlan = null) {
  const analysis = payload && typeof payload === "object" ? payload : {};
  const actions = Array.isArray(analysis.actions) ? analysis.actions : [];
  const opportunities = Array.isArray(snapshot?.pipeline?.opportunities)
    ? snapshot.pipeline.opportunities
    : Array.isArray(snapshot?.workboard)
      ? snapshot.workboard
      : [];
  const opportunityById = new Map(
    opportunities.map((opportunity) => [Number(opportunity.id), opportunity]),
  );
  const planByOpportunityId = new Map(
    (Array.isArray(developmentPlan?.opportunities)
      ? developmentPlan.opportunities
      : []
    ).map((item) => [Number(item?.opportunityId || 0), item]),
  );
  const alerts = buildSalesAlerts(snapshot, developmentPlan);
  const activityProgress = buildActivityProgress(snapshot, developmentPlan);
  return {
    headline: String(analysis.headline || "").trim(),
    summary: String(analysis.summary || "").trim(),
    quotaReadout: String(analysis.quotaReadout || "").trim(),
    alerts,
    activityProgress,
    actions: actions.slice(0, 5).map((action, index) => ({
      rank: index + 1,
      title: String(action?.title || "").trim(),
      opportunityId: Number(action?.opportunityId || 0) || null,
      opportunityName:
        String(action?.opportunityName || "").trim() ||
        String(
          opportunityById.get(Number(action?.opportunityId || 0))?.name || "",
        ).trim(),
      accountName:
        String(action?.accountName || "").trim() ||
        String(
          opportunityById.get(Number(action?.opportunityId || 0))
            ?.accountName || "",
        ).trim(),
      developmentNarrative:
        opportunityById.get(Number(action?.opportunityId || 0))?.workspace
          ?.developmentNarrative || null,
      alignedContext: {
        situation: String(
          planByOpportunityId.get(Number(action?.opportunityId || 0))
            ?.situation ||
            action?.situation ||
            "",
        ).trim(),
        strategy: String(
          planByOpportunityId.get(Number(action?.opportunityId || 0))
            ?.strategy ||
            action?.strategy ||
            "",
        ).trim(),
        nextBestStep: String(
          planByOpportunityId.get(Number(action?.opportunityId || 0))
            ?.nextBestStep ||
            action?.nextBestStep ||
            "",
        ).trim(),
        alternativeStep: String(
          planByOpportunityId.get(Number(action?.opportunityId || 0))
            ?.alternativeStep ||
            action?.alternativeStep ||
            "",
        ).trim(),
        alignment: ["aligned", "partially_aligned", "not_aligned"].includes(
          String(action?.alignment || "").trim(),
        )
          ? String(action.alignment).trim()
          : "partially_aligned",
      },
      salesHealth:
        planByOpportunityId.get(Number(action?.opportunityId || 0))?.health ||
        null,
      priority: ["critical", "high", "medium", "low"].includes(
        String(action?.priority || "").trim(),
      )
        ? String(action.priority).trim()
        : "medium",
      stageName: String(action?.stageName || "").trim(),
      reason: String(action?.reason || "").trim(),
      risk: String(action?.risk || "").trim(),
      expectedOutcome: String(action?.expectedOutcome || "").trim(),
      successCriteria: String(action?.successCriteria || "").trim(),
      actionType: String(action?.actionType || "follow_up").trim(),
      executionKit: {
        objective: String(action?.objective || "").trim(),
        knownInformation: Array.isArray(action?.knownInformation)
          ? action.knownInformation
              .map((item) => String(item || "").trim())
              .filter(Boolean)
              .slice(0, 8)
          : [],
        objections: Array.isArray(action?.objections)
          ? action.objections
              .map((item) => String(item || "").trim())
              .filter(Boolean)
              .slice(0, 5)
          : [],
        valueProposition: String(action?.valueProposition || "").trim(),
        followUpMessage: String(action?.followUpMessage || "").trim(),
        minimumOutcome: String(action?.minimumOutcome || "").trim(),
      },
      suggestedDueDate: String(action?.suggestedDueDate || "").trim() || null,
      questions: Array.isArray(action?.questions)
        ? action.questions
            .map((item) => String(item || "").trim())
            .filter(Boolean)
            .slice(0, 5)
        : [],
    })),
    risks: Array.isArray(analysis.risks)
      ? analysis.risks
          .map((item) => String(item || "").trim())
          .filter(Boolean)
          .slice(0, 6)
      : [],
    meta: {
      generatedAt: new Date().toISOString(),
      provider: "openai",
      model: String(config.openai.model || "").trim(),
    },
  };
}

function buildActivityProgress(snapshot, developmentPlan) {
  const opportunities = Array.isArray(snapshot?.workboard)
    ? snapshot.workboard
    : [];
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
  const plans = new Map(
    (Array.isArray(developmentPlan?.opportunities)
      ? developmentPlan.opportunities
      : []
    ).map((item) => [Number(item.opportunityId), item]),
  );
  const details = opportunities.map((opportunity) => {
    const plan = plans.get(Number(opportunity.id));
    const health = plan?.health;
    const recentActivities = (opportunity.activities || []).filter(
      (activity) => {
        const date = new Date(activity.occurredAt || activity.createdAt || 0);
        return date >= periodStart && date <= periodEnd;
      },
    );
    const recentProgress = (opportunity.stageAnswers || []).some((answer) => {
      const date = new Date(answer.answeredAt || 0);
      return (
        date >= periodStart &&
        date <= periodEnd &&
        String(answer.answer || "").trim()
      );
    });
    const activityCount = recentActivities.length;
    const actionCount = (opportunity.workspace?.actions || []).length;
    const solidDimensions = Number(health?.solidCount || 0);
    return {
      opportunityId: Number(opportunity.id),
      opportunityName: opportunity.name || "",
      accountName: opportunity.accountName || opportunity.account?.name || "",
      activityCount,
      actionCount,
      solidDimensions,
      totalDimensions: Number(health?.totalCount || 8),
      progressed: recentProgress,
      activityWithoutProgress: activityCount > 0 && !recentProgress,
    };
  });
  const activityCount = details.reduce(
    (sum, item) => sum + item.activityCount,
    0,
  );
  const progressedOpportunities = details.filter(
    (item) => item.progressed,
  ).length;
  const opportunitiesWithActivity = details.filter(
    (item) => item.activityCount > 0,
  ).length;
  const opportunitiesWithoutProgress = details.filter(
    (item) => item.activityWithoutProgress,
  ).length;
  const message =
    activityCount > 0 && opportunitiesWithoutProgress > 0
      ? `Has tenido ${activityCount} actividades en los últimos 7 días, pero ninguna ha cambiado el estado de ${opportunitiesWithoutProgress} de tus oportunidades.`
      : progressedOpportunities > 0
        ? `Tus actividades recientes han producido avance comercial en ${progressedOpportunities} oportunidades.`
        : "No hay suficiente actividad reciente para medir avance comercial.";
  return {
    periodLabel: "Últimos 7 días",
    message,
    activityCount,
    progressedOpportunities,
    opportunitiesWithActivity,
    opportunitiesWithoutProgress,
    efficiencyPercent: activityCount
      ? Math.round(
          (details
            .filter((item) => item.progressed)
            .reduce((sum, item) => sum + item.solidDimensions, 0) /
            activityCount) *
            100,
        )
      : 0,
    details: details.filter((item) => item.activityCount > 0).slice(0, 12),
  };
}

function buildSalesAlerts(snapshot, developmentPlan) {
  const opportunities = Array.isArray(snapshot?.workboard)
    ? snapshot.workboard
    : [];
  const plans = new Map(
    (Array.isArray(developmentPlan?.opportunities)
      ? developmentPlan.opportunities
      : []
    ).map((item) => [Number(item.opportunityId), item]),
  );
  const alerts = [];
  const add = ({
    code,
    title,
    severity,
    opportunity,
    evidence,
    impact,
    action,
  }) => {
    alerts.push({
      code,
      title,
      severity,
      opportunityId: opportunity ? Number(opportunity.id) : null,
      opportunityName: opportunity?.name || null,
      accountName:
        opportunity?.accountName || opportunity?.account?.name || null,
      amountUsd: opportunity ? Number(opportunity.amountUsd || 0) : null,
      evidence,
      impact,
      action,
    });
  };
  const totalPipeline = opportunities.reduce(
    (sum, item) => sum + Number(item.amountUsd || 0),
    0,
  );
  const byAccount = opportunities.reduce((groups, item) => {
    const key = item.accountName || item.account?.name || "Cuenta sin nombre";
    groups.set(key, (groups.get(key) || 0) + Number(item.amountUsd || 0));
    return groups;
  }, new Map());
  const largestAccount = [...byAccount.entries()].sort(
    (left, right) => right[1] - left[1],
  )[0];

  opportunities.forEach((opportunity) => {
    const plan = plans.get(Number(opportunity.id));
    const health = plan?.health;
    const activityCount = (opportunity.activities || []).length;
    const decider = health?.dimensions?.find(
      (dimension) => dimension.key === "decider",
    );
    const days = Number(opportunity.daysSinceActivity || 0);
    if (days > 14) {
      add({
        code: "stale_opportunity",
        title: "Oportunidad estancada",
        severity: days > 21 ? "critical" : "high",
        opportunity,
        evidence: `${days} días sin actividad registrada.`,
        impact: "La oportunidad puede perder tracción y prioridad.",
        action:
          "Reactivar la conversación con un objetivo y una fecha concreta.",
      });
    }
    if (!opportunity.nextStep?.title && !opportunity.nextPendingAction) {
      add({
        code: "missing_next_activity",
        title: "Sin próxima actividad",
        severity: "high",
        opportunity,
        evidence: "No existe un siguiente paso pendiente o programado.",
        impact: "La oportunidad no tiene un movimiento comercial verificable.",
        action: "Definir y registrar el siguiente compromiso del cliente.",
      });
    }
    if (decider?.state === "unknown") {
      add({
        code: "missing_decision_maker",
        title: "Oportunidad sin decisor",
        severity:
          Number(opportunity.amountUsd || 0) >= 100000 ? "critical" : "high",
        opportunity,
        evidence: "No hay decisor económico o aprobador identificado.",
        impact: "Puedes invertir recursos sin acceso a la decisión final.",
        action:
          "Identificar comprador económico, aprobadores y posibles vetos.",
      });
    }
    if (
      opportunity.stageCode === "cotizacion" &&
      days > 7 &&
      !opportunity.nextStep?.title
    ) {
      add({
        code: "proposal_without_follow_up",
        title: "Propuesta sin seguimiento",
        severity: "high",
        opportunity,
        evidence: `Está en Cotización y lleva ${days} días sin siguiente actividad.`,
        impact:
          "La propuesta puede quedar sin respuesta o perder frente a competidores.",
        action: "Solicitar feedback y confirmar fecha de decisión.",
      });
    }
    if (activityCount >= 2 && Number(health?.solidCount || 0) === 0) {
      add({
        code: "activity_without_progress",
        title: "Actividad sin avance",
        severity: "high",
        opportunity,
        evidence: `Tiene ${activityCount} actividades registradas, pero ninguna dimensión comercial está confirmada.`,
        impact:
          "El esfuerzo comercial no está generando evidencia nueva para mover la oportunidad.",
        action:
          "Orientar la próxima interacción a obtener un dato concreto: decisor, presupuesto, fecha o siguiente compromiso.",
      });
    }
    if (
      opportunity.closeDate &&
      new Date(opportunity.closeDate) < new Date() &&
      opportunity.stageCode !== "waiting"
    ) {
      add({
        code: "inconsistent_close_date",
        title: "Fecha de cierre comprometida",
        severity: "high",
        opportunity,
        evidence: "La fecha objetivo ya pasó y la oportunidad sigue abierta.",
        impact: "El forecast puede estar inflado o desactualizado.",
        action:
          "Confirmar una nueva fecha respaldada por un hito real del cliente.",
      });
    }
  });
  const gap = Number(snapshot?.quota?.gapAmount || 0);
  if (gap > 0 && totalPipeline < gap) {
    add({
      code: "weak_pipeline",
      title: "Pipeline débil",
      severity: "critical",
      evidence: `El pipeline calificado cubre ${(totalPipeline / gap).toFixed(1)}x la brecha.`,
      impact: "La cobertura actual no alcanza para cubrir el objetivo.",
      action: "Generar nuevas oportunidades y fortalecer las existentes.",
    });
  }
  if (
    largestAccount &&
    totalPipeline > 0 &&
    largestAccount[1] / totalPipeline >= 0.5
  ) {
    add({
      code: "excessive_account_dependency",
      title: "Dependencia excesiva",
      severity: largestAccount[1] / totalPipeline >= 0.7 ? "critical" : "high",
      evidence: `${Math.round((largestAccount[1] / totalPipeline) * 100)}% del pipeline depende de ${largestAccount[0]}.`,
      impact: "El objetivo depende demasiado de una sola cuenta.",
      action: "Proteger la cuenta y desarrollar pipeline alternativo.",
    });
  }
  return alerts
    .sort(
      (left, right) =>
        ({ critical: 3, high: 2, medium: 1, low: 0 })[right.severity] -
        { critical: 3, high: 2, medium: 1, low: 0 }[left.severity],
    )
    .slice(0, 12);
}

function buildDevelopmentPlanPrompt(snapshot) {
  const planningSnapshot = {
    period: snapshot?.period || null,
    quota: snapshot?.quota || null,
    pipeline: snapshot?.pipeline || null,
    workboard: (snapshot?.workboard || []).map((item) => ({
      id: Number(item.id),
      name: item.name || "",
      account: item.account || { name: item.accountName || "" },
      contact: item.contact || null,
      amountUsd: Number(item.amountUsd || 0),
      closeDate: item.closeDate || null,
      stageCode: item.stageCode || "",
      stageName: item.stageName || "",
      riskLevel: item.riskLevel || "low",
      riskReasons: (item.riskReasons || []).slice(0, 3),
      stageAnswers: (item.stageAnswers || []).slice(0, 8).map((answer) => ({
        code: answer.code,
        answer: clip(answer.answer, 600),
        required: answer.required,
      })),
      documents: (item.documents || []).slice(0, 3).map((document) => ({
        fileName: document.fileName,
        summary: clip(document.summary, 500),
        text: clip(document.text, 700),
        analysis: clip(document.analysis, 500),
      })),
      activities: (item.activities || []).slice(0, 4).map((activity) => ({
        title: activity.title,
        summary: clip(activity.summary, 600),
        nextSteps: clip(activity.nextSteps, 400),
        occurredAt: activity.occurredAt,
      })),
      workspace: {
        developmentNarrative: item.workspace?.developmentNarrative || null,
        actions: (item.workspace?.actions || []).slice(0, 6),
        weaknesses: (item.workspace?.weaknesses || []).slice(0, 5),
        stakeholders: (item.workspace?.stakeholders || []).slice(0, 5),
        themes: (item.workspace?.themes || []).slice(0, 6),
        deliverables: (item.workspace?.deliverables || []).slice(0, 4),
        strategy: item.workspace?.strategy || null,
        criteria: (item.workspace?.criteria || []).slice(0, 10),
      },
    })),
  };
  return {
    model: config.openai.model,
    temperature: 0.1,
    input: [
      {
        role: "system",
        content:
          "Primero construye el plan comercial de cada oportunidad usando exclusivamente el contexto enriquecido: cuenta, contacto, oportunidad, respuestas y validaciones de etapas, documentos y su analisis, actividades e interacciones, acciones del workspace, debilidades, stakeholders, temas, entregables, estrategia y narrativa previa. No calcules acciones todavia. Para cada oportunidad devuelve, en este orden conceptual: descripcion y situacion actual, estrategia para lograr la venta, siguiente mejor paso y paso alternativo condicionado. Los cuatro bloques deben ser especificos de la oportunidad y sustentados por todas las fuentes. No inventes datos. Devuelve solo JSON valido.",
      },
      {
        role: "system",
        content:
          activeOpportunityId > 0
            ? `REGLA DE CONTEXTO ACTIVO: la oportunidad ${activeOpportunityId} está seleccionada para este hilo. Todas las preguntas actuales y de seguimiento se refieren a esa oportunidad, aunque la pregunta use pronombres, elipsis o no repita su nombre. Usa exclusivamente sus datos de selectedRecord, workboard y stageAnswers. Nunca digas que no hay una oportunidad seleccionada mientras selectedContext.opportunityId sea ${activeOpportunityId}. Solo cambia de oportunidad si el contexto recibido contiene otro opportunityId.`
            : "REGLA DE CONTEXTO ACTIVO: no hay una oportunidad seleccionada. Si la pregunta depende de una oportunidad concreta, identifica una candidata solo cuando el texto la nombre claramente y devuelve su opportunityId.",
      },
      {
        role: "user",
        content: JSON.stringify({
          instructions: {
            neverInvent: true,
            language: "es",
          },
          expectedJsonShape: {
            opportunities: [
              {
                opportunityId: 0,
                situation: "",
                strategy: "",
                nextBestStep: "",
                alternativeStep: "",
              },
            ],
          },
          snapshot: planningSnapshot,
        }),
      },
    ],
  };
}

function buildActionPrompt(snapshot, developmentPlan) {
  const actionSnapshot = {
    period: snapshot?.period || null,
    quota: snapshot?.quota || null,
    pipeline: {
      qualifiedAmount: snapshot?.pipeline?.qualifiedAmount || 0,
      qualifiedCount: snapshot?.pipeline?.qualifiedCount || 0,
      opportunities: (snapshot?.workboard || []).map((item) => ({
        id: Number(item.id),
        name: item.name || "",
        accountName: item.accountName || "",
        amountUsd: Number(item.amountUsd || 0),
        closeDate: item.closeDate || null,
        stageCode: item.stageCode || "",
        stageName: item.stageName || "",
        riskLevel: item.riskLevel || "low",
        riskReasons: item.riskReasons || [],
      })),
    },
    alerts: buildSalesAlerts(snapshot, developmentPlan),
  };
  return {
    model: config.openai.model,
    temperature: 0.1,
    input: [
      {
        role: "system",
        content:
          "Ahora calcula y ordena las acciones recomendadas para el vendedor usando el contexto enriquecido y el plan comercial previamente calculado. Cada accion debe derivarse de una oportunidad concreta y de sus cuatro bloques: situacion actual, estrategia, siguiente mejor paso y paso alternativo. No vuelvas a inventar ni sustituir esos bloques. La accion debe ejecutar el siguiente mejor paso, respetar la estrategia y resolver la situacion actual. Usa el paso alternativo solo como contingencia. Para que el vendedor pueda ejecutarla, incluye tambien un kit practico: tipo de accion, objetivo, informacion conocida del cliente, objeciones probables, propuesta de valor, mensaje de seguimiento, resultado minimo y criterio de exito. Devuelve solo JSON valido.",
      },
      {
        role: "user",
        content: JSON.stringify({
          instructions: {
            maxActions: 5,
            sortByImpactOnQuota: true,
            preferConcreteNextSteps: true,
            neverInvent: true,
            language: "es",
          },
          developmentPlan,
          expectedJsonShape: {
            headline: "",
            summary: "",
            quotaReadout: "",
            actions: [
              {
                title: "",
                opportunityId: 0,
                opportunityName: "",
                accountName: "",
                priority: "critical|high|medium|low",
                stageName: "",
                reason: "",
                risk: "",
                expectedOutcome: "",
                successCriteria: "",
                actionType:
                  "call|meeting|follow_up|demo|quotation|negotiation|waiting|other",
                objective: "",
                knownInformation: [""],
                objections: [""],
                valueProposition: "",
                followUpMessage: "",
                minimumOutcome: "",
                alignment: "aligned|partially_aligned|not_aligned",
                suggestedDueDate: "YYYY-MM-DD|null",
                questions: [""],
              },
            ],
            risks: [""],
          },
          snapshot: actionSnapshot,
        }),
      },
    ],
  };
}

function buildLocalDevelopmentPlan(snapshot) {
  return {
    opportunities: (snapshot?.workboard || []).map((item) => {
      const health = buildOpportunityHealth(item);
      const narrative = item.workspace?.developmentNarrative || {};
      const contract = narrative.contract || {};
      const firstWeakness = item.workspace?.weaknesses?.[0];
      const firstAction = item.workspace?.actions?.[0];
      const strategy = item.workspace?.strategy;
      return {
        opportunityId: Number(item.id),
        health,
        situation:
          contract.descriptionSituationText ||
          narrative.statusSummary ||
          firstWeakness?.detail ||
          `Oportunidad en ${item.stageName || "la etapa actual"} con riesgo ${item.riskLevel || "no determinado"}.`,
        strategy:
          contract.salesStrategyText ||
          strategy?.finalObjective ||
          strategy?.heading ||
          "Consolidar la evidencia comercial y mover la oportunidad al siguiente hito verificable.",
        nextBestStep:
          contract.nextBestStepText ||
          narrative.nextStepRecommendation ||
          firstAction?.title ||
          item.nextStep?.title ||
          "Definir y ejecutar el siguiente compromiso comercial con fecha y responsable.",
        alternativeStep:
          contract.alternativeStepText ||
          "Si el siguiente paso no se concreta, activar una vía alternativa con el sponsor o responsable de decisión.",
      };
    }),
  };
}

function buildOpportunityHealth(item) {
  const answers = Array.isArray(item.stageAnswers) ? item.stageAnswers : [];
  const answerText = answers
    .map((answer) => `${answer.code} ${answer.answer}`)
    .join(" ")
    .toLowerCase();
  const stakeholders = item.workspace?.stakeholders || [];
  const themes = item.workspace?.themes || [];
  const actions = item.workspace?.actions || [];
  const hasAnswer = (patterns) =>
    answers.some((answer) =>
      patterns.some(
        (pattern) =>
          String(answer.code || "")
            .toLowerCase()
            .includes(pattern) && String(answer.answer || "").trim(),
      ),
    );
  const hasTheme = (code) =>
    themes.some(
      (theme) =>
        String(theme.theme || "").toLowerCase() === code &&
        String(theme.claim || theme.evidence || "").trim(),
    );
  const dimensions = [
    {
      key: "need",
      label: "Necesidad",
      state:
        hasAnswer(["need", "interes", "motivacion"]) || hasTheme("need")
          ? "confirmed"
          : "unknown",
      evidence: "Respuestas y temas de necesidad de la oportunidad.",
    },
    {
      key: "motivation",
      label: "Motivación",
      state:
        hasAnswer(["motivacion", "objetivo", "urgencia"]) ||
        /necesit|problema|prioridad|urgenc/.test(answerText)
          ? "high"
          : "unknown",
      evidence: "Motivación y objetivos expresados por el cliente.",
    },
    {
      key: "budget",
      label: "Presupuesto",
      state:
        hasAnswer(["presupuesto", "budget"]) || hasTheme("budget")
          ? "partial"
          : "unknown",
      evidence: "Respuestas económicas y tema de presupuesto.",
    },
    {
      key: "decider",
      label: "Decisor",
      state:
        stakeholders.length &&
        stakeholders.some((stakeholder) =>
          /economic|decisor|compras|finanzas|aprob/i.test(
            `${stakeholder.roleCode} ${stakeholder.roleLabel}`,
          ),
        )
          ? "confirmed"
          : "unknown",
      evidence: "Stakeholders y roles de decisión registrados.",
    },
    {
      key: "date",
      label: "Fecha",
      state:
        item.closeDate || hasAnswer(["fecha", "timeline", "plazo"])
          ? "partial"
          : "unknown",
      evidence: "Fecha objetivo y respuestas de timeline.",
    },
    {
      key: "purchaseProcess",
      label: "Proceso de compra",
      state:
        hasAnswer(["proceso", "purchase", "compra"]) ||
        stakeholders.some((stakeholder) =>
          /compras|aprob|procurement/i.test(
            `${stakeholder.roleCode} ${stakeholder.roleLabel} ${stakeholder.nextAction}`,
          ),
        )
          ? "partial"
          : "unknown",
      evidence: "Respuestas y mapa de stakeholders.",
    },
    {
      key: "competition",
      label: "Competencia",
      state:
        hasAnswer(["competencia", "competitor"]) || hasTheme("competition")
          ? "confirmed"
          : "unknown",
      evidence: "Respuestas y temas competitivos.",
    },
    {
      key: "nextActivity",
      label: "Próxima actividad",
      state:
        item.nextStep?.title ||
        item.nextPendingAction ||
        actions.some((action) =>
          ["pending", "in_progress"].includes(action.status),
        )
          ? "confirmed"
          : "unknown",
      evidence: "Acciones y próximo paso registrados.",
    },
  ];
  const stateLabels = {
    confirmed: "Confirmada",
    high: "Alta",
    partial: "Parcial",
    unknown: "No identificada",
  };
  const solidCount = dimensions.filter((dimension) =>
    ["confirmed", "high"].includes(dimension.state),
  ).length;
  const weakest =
    dimensions.find((dimension) => dimension.state === "unknown") ||
    dimensions.find((dimension) => dimension.state === "partial") ||
    dimensions[0];
  return {
    label: solidCount >= 6 ? "Sólida" : solidCount >= 3 ? "Parcial" : "Débil",
    solidCount,
    totalCount: dimensions.length,
    principalWeakness: weakest?.label || "Sin debilidad identificada",
    dimensions: dimensions.map((dimension) => ({
      ...dimension,
      stateLabel: stateLabels[dimension.state] || dimension.state,
    })),
  };
}

async function requestMiAgentJson({
  payload,
  user,
  jobId,
  startedAt,
  phase,
  featureCode = MI_AGENT_FEATURE_CODE,
  jobType = "mi_agent_analysis",
}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(
      `${config.openai.baseUrl.replace(/\/$/, "")}/responses`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.openai.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Mi agente excedio el tiempo en la fase ${phase}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  const responsePayload = await response.json().catch(() => null);
  if (!response.ok) {
    const providerMessage =
      responsePayload?.error?.message ||
      responsePayload?.message ||
      `HTTP ${response.status}`;
    throw new Error(
      `No fue posible obtener el análisis de Mi agente: ${String(providerMessage).slice(0, 500)}`,
    );
  }
  await recordAiUsageFromOpenAiResponse({
    internalRequestId: randomUUID(),
    userId: Number(user.id),
    featureCode,
    model: String(config.openai.model || "").trim(),
    openAiResponse: responsePayload,
    jobType,
    jobId,
    startedAt,
  });
  const parsed = parseJson(extractOutputText(responsePayload));
  if (!parsed)
    throw new Error("La respuesta de Mi agente no tuvo un formato válido");
  return parsed;
}

function buildCoachPrompt(
  snapshot,
  question,
  processGuide = "",
  selectedContext = {},
  conversationHistory = [],
) {
  const activeOpportunityId = Number(selectedContext?.opportunityId || 0);
  return {
    model: config.openai.model,
    temperature: 0.2,
    input: [
      {
        role: "system",
        content:
          "inactivePipelineOpportunities contiene oportunidades no terminales que están desactivadas o pendientes de activación. Nunca las cuentes como oportunidades abiertas, activas o parte del forecast; si la pregunta busca oportunidades abiertas y esta colección tiene registros de la cuenta consultada, responde que no hay activas y menciona aparte las oportunidades en proceso no activas con su estado de activación. No afirmes que no existen oportunidades de la cuenta cuando haya registros en esta colección. " +
          "Si la respuesta establece una cuenta, oportunidad, contacto o lead como referente para la siguiente pregunta, llena entities con su ID exacto del snapshot autorizado y con sus entidades padre compatibles. Si menciona varios registros del mismo tipo o el referente no es inequívoco, deja ese ID en null y no cambies el contexto activo. " +
          "Para preguntas sobre el número de cotizaciones ganadas, cuenta documentos quotation distintos de la oportunidad seleccionada cuyo statusCode sea ganada; no cuentes versiones ni partidas. Para preguntas sobre productos, servicios, partidas o cantidades cotizadas, usa exclusivamente quotations[].products de la oportunidad correspondiente; conserva la separación por cotización y no infieras productos desde el nombre o la narrativa. " +
          "coachOpportunities contiene pipeline abierto; wonOpportunities, lostOpportunities y cancelledOpportunities contienen historial terminal separado. Nunca sumes registros terminales al pipeline, forecast o preparación de etapa. La ausencia de una entidad en el contexto no demuestra que no exista en el CRM: expresa que no está disponible en el contexto consultado. " +
          "Eres el Coach comercial de un CRM. Responde usando únicamente el contexto enriquecido real y el proceso comercial disponible. Clasifica la solicitud como informativa, recomendación o cambio solicitado; en esta fase no ejecutes cambios. Identifica entidades solo con IDs presentes en el contexto. Separa hechos, evidencia e inferencias. Si existe selectedRecord de tipo opportunity, ese registro es la fuente principal: para preguntas sobre monto, importe, valor, fecha, etapa o nombre responde primero con sus campos exactos y no uses totales globales del pipeline como sustituto. Los totales globales solo aplican cuando la pregunta es general o no hay una oportunidad seleccionada. Si el vendedor pide crear o modificar algo y ya identificaste la entidad, DEBES devolver una operación estructurada editable con todos los datos explícitos: para crear una actividad usa kind=activity sin activityId; para modificar una actividad existente usa kind=activity con activityId tomado únicamente de la lista workspace.actions de la oportunidad, además de actionType, title, status, priority, scheduledAt, dueDate, notes y successCriteria. No conviertas una solicitud explícita de cambio en una recomendación solamente. Si falta la entidad, devuelve la entidad candidata y pide selección. Si el vendedor comparte una afirmación factual que responde claramente una pregunta de etapa existente en el contexto de una oportunidad, puedes proponer una operación kind=stage_answer aunque no use verbos como registrar o actualizar: incluye el questionId real, el answerValue con el texto propuesto, el title y la evidencia de la coincidencia. En ese caso, explica en answer que identificaste una posible respuesta de etapa y que debe revisarse antes de guardarse. Solo propón stage_answer con confianza high o medium y cuando la coincidencia sea clara; si hay varias preguntas posibles o la coincidencia es débil, no propongas ninguna operación. Una solicitud explícita de actividad siempre conserva prioridad y debe seguir produciendo kind=activity sin sustituirla por stage_answer. Devuelve solo JSON válido.",
      },
      {
        role: "user",
        content: JSON.stringify({
          question,
          stageReadinessPolicy:
            "Si snapshot.deterministicStageReadiness existe, úsalo como diagnóstico autoritativo. No cambies qué criterios están cumplidos, pendientes o bloqueados. Redacta answer explicando sus seis bloques: etapa actual, avances confirmados, pendientes, riesgos, siguiente paso y recomendación de avance.",
          expectedJsonShape: {
            intent:
              "seller_status|today_priorities|at_risk_opportunities|neglected_accounts|pipeline_coverage|opportunity_preparation|context_query|risk_diagnosis|recommendation|interaction_preparation|create_record|update_record|continue_work|clarification|freeform",
            responseType:
              "informational|recommendation|change_request|clarification",
            answer: "",
            facts: [
              {
                sourceType: "opportunity",
                sourceId: 0,
                label: "",
                excerpt: "",
              },
            ],
            evidence: [""],
            inferences: [""],
            pendingItems: [""],
            recommendation: {
              action: "",
              rationale: "",
              expectedOutcome: "",
              successCriteria: "",
              responsibleUserId: 0,
              targetDate: "YYYY-MM-DD|null",
            },
            confidence: "high|medium|low",
            entities: {
              opportunityId: 0,
              accountId: 0,
              contactId: 0,
              leadId: 0,
              names: [""],
            },
            operations: [
              {
                kind: "activity|stage_answer|opportunity_field|account_field|contact_field|lead_call_outcome|create_account|create_contact|create_opportunity|create_quotation|create_proposal|lead_resolve",
                opportunityId: 0,
                accountId: 0,
                contactId: 0,
                interactionId: 0,
                questionId: 0,
                answerValue: "",
                answerMode: "replace|append",
                field: "name|amountUsd|closeDate",
                value: "",
                substatusCode: "",
                reasonCode: "",
                requiredActionCode: "",
                comment: "",
                nextActionDueAt: "YYYY-MM-DD|null",
                actionType:
                  "next_step|follow_up|call|meeting|demo|quotation|negotiation|other",
                activityId: 0,
                activitySearch: "",
                status: "pending|in_progress|blocked|done",
                priority: "low|medium|high",
                scheduledAt: "YYYY-MM-DDTHH:mm|null",
                dueDate: "YYYY-MM-DD|null",
                notes: "",
                successCriteria: "",
                title: "",
              },
            ],
            clarification: {
              type: "select_account|select_opportunity|select_contact|select_lead|missing_fields",
              message: "",
              missing: [""],
              candidates: [
                { id: 0, name: "", accountName: "", entityType: "opportunity" },
              ],
            },
            action: {
              title: "",
              opportunityId: 0,
              actionType:
                "next_step|follow_up|call|meeting|demo|quotation|negotiation|other",
              status: "pending|in_progress|blocked|done",
              priority: "low|medium|high",
              suggestedDueDate: "YYYY-MM-DD|null",
              scheduledAt: "YYYY-MM-DDTHH:mm|null",
              notes: "",
              successCriteria: "",
            },
            stageReadiness: {
              currentStage: { id: 0, code: "", name: "", objective: "" },
              confirmedProgress: [{ title: "", detail: "", evidence: [] }],
              pendingItems: [{ title: "", detail: "", evidence: [] }],
              risks: [
                {
                  title: "",
                  detail: "",
                  severity: "low|medium|high|critical",
                  mitigation: "",
                  evidence: [],
                },
              ],
              nextStep: {
                action: "",
                responsibleUserId: 0,
                targetDate: "YYYY-MM-DD|null",
                successCriteria: "",
              },
              recommendation: "advance|advance_with_caution|remain",
              rationale: "",
            },
          },
          processGuide: clip(processGuide, 18000),
          selectedContext,
          conversationHistory,
          snapshot,
        }),
      },
    ],
  };
}

async function executeCoachJob({
  jobId,
  user,
  question,
  selectedContext = {},
  conversationHistory = [],
  sessionId = null,
}) {
  try {
    await query(
      `UPDATE mi_agent_analysis_jobs SET status = 'running', updated_at = NOW(3) WHERE id = ?`,
      [jobId],
    );
    const baseSnapshot = await getMiAgentContext(user);
    let effectiveContext = { ...selectedContext };
    const { explicitEntities } = resolveCoachContextEntities(
      baseSnapshot,
      question,
      conversationHistory,
      effectiveContext,
    );
    const questionContextTransition = applyCoachEntityResolution(
      baseSnapshot,
      effectiveContext,
      explicitEntities,
    );
    effectiveContext = questionContextTransition.context;
    if (questionContextTransition.changed) conversationHistory = [];
    const relationshipClarification = questionContextTransition.conflict
      ? {
          type: "select_opportunity",
          message: questionContextTransition.conflict.message,
          missing: ["Cuenta, oportunidad o contacto compatibles"],
          candidates: questionContextTransition.conflict.candidates,
          originalRequest: question,
          intendedAction: "continue_request",
        }
      : null;
    const entityClarification =
      relationshipClarification ||
      buildCoachEntityClarification(
        explicitEntities,
        question,
        effectiveContext,
      );
    const historicalQuestion =
      explicitEntities.opportunity?.lifecycle === "historical" ||
      /\b(vend|vent|compr|adquiri|ganad|perdid|anulad|cancelad|cerrad|historial|cotiz|propuest)/.test(
        normalizeCoachMatchText(question),
      );
    const analysisBaseSnapshot = historicalQuestion
      ? baseSnapshot
      : {
          ...baseSnapshot,
          wonOpportunities: [],
          lostOpportunities: [],
          cancelledOpportunities: [],
        };
    const scopedSnapshot = await getMiAgentEnrichedContext(
      user,
      buildCoachScopedSnapshot(analysisBaseSnapshot, effectiveContext),
    );
    const preparationRequested = isStagePreparationQuestion(question);
    const selectedOpportunity =
      scopedSnapshot.selectedRecord?.type === "opportunity"
        ? scopedSnapshot.selectedRecord
        : null;
    const deterministicStageReadiness =
      preparationRequested &&
      selectedOpportunity &&
      selectedOpportunity.lifecycle !== "historical"
        ? buildStageReadiness(selectedOpportunity, {
            currentUserId: Number(user.id),
          })
        : null;
    const preparationClarification =
      preparationRequested && !selectedOpportunity
        ? {
            type: "select_opportunity",
            message:
              "Selecciona una oportunidad para evaluar su preparación de etapa.",
            missing: ["Oportunidad"],
            candidates: (scopedSnapshot.coachOpportunities || [])
              .slice(0, 20)
              .map((opportunity) => ({
                id: Number(opportunity.id),
                name: opportunity.name || "Oportunidad sin nombre",
                accountId:
                  Number(
                    opportunity.account?.id || opportunity.accountId || 0,
                  ) || null,
                contactId:
                  Number(
                    opportunity.contact?.id || opportunity.contactId || 0,
                  ) || null,
                opportunityId: Number(opportunity.id),
                accountName:
                  opportunity.accountName || opportunity.account?.name || null,
                stageName: opportunity.stageName || null,
                entityType: "opportunity",
              })),
            originalRequest: question,
            intendedAction: "continue_request",
          }
        : null;
    const clarification = entityClarification || preparationClarification;
    const promptSnapshot = deterministicStageReadiness
      ? { ...scopedSnapshot, deterministicStageReadiness }
      : scopedSnapshot;
    const processGuide = await loadProcessGuide();
    const result = clarification
      ? {
          intent: "clarification",
          responseType: "clarification",
          answer: clarification.message,
          confidence: "high",
          clarification,
          operations: [],
        }
      : await requestMiAgentJson({
          payload: buildCoachPrompt(
            promptSnapshot,
            question,
            processGuide,
            effectiveContext,
            conversationHistory,
          ),
          user,
          jobId,
          startedAt: new Date(),
          phase: "coach",
          featureCode: MI_COACH_FEATURE_CODE,
          jobType: "mi_coach_chat",
        });
    const requiresStageReadiness =
      !clarification &&
      selectedOpportunity &&
      selectedOpportunity.lifecycle !== "historical" &&
      (preparationRequested || result?.intent === "opportunity_preparation");
    const authoritativeStageReadiness = requiresStageReadiness
      ? deterministicStageReadiness ||
        buildStageReadiness(selectedOpportunity, {
          currentUserId: Number(user.id),
        })
      : null;
    const authoritativeResult = authoritativeStageReadiness
      ? {
          ...result,
          intent: "opportunity_preparation",
          stageReadiness: authoritativeStageReadiness,
        }
      : result;
    const responseContextTransition =
      !clarification && !result?.clarification
        ? resolveCoachResponseContext(scopedSnapshot, effectiveContext, result)
        : null;
    const activeContext =
      responseContextTransition && !responseContextTransition.conflict
        ? responseContextTransition.context
        : effectiveContext;
    const activeContextSource = questionContextTransition.changed
      ? "question"
      : responseContextTransition?.changed
        ? "coach_response"
        : "existing_context";
    const normalizedResult = normalizeCoachResult(
      authoritativeResult,
      scopedSnapshot,
      question,
      effectiveContext,
      authoritativeStageReadiness,
    );
    normalizedResult.entities = {
      ...normalizedResult.entities,
      accountId: activeContext.accountId,
      opportunityId: activeContext.opportunityId,
      contactId: activeContext.contactId,
      leadId: activeContext.leadId,
    };
    normalizedResult.activeContext = activeContext;
    normalizedResult.activeContextSource = activeContextSource;
    const persistedOperations = sessionId
      ? await persistCoachOperations({
          userId: user.id,
          sessionId,
          sourceJobId: jobId,
          originalIntent: question,
          entities: normalizedResult.entities,
          operations: normalizedResult.operations,
        })
      : [];
    if (persistedOperations.length) {
      normalizedResult.operations = normalizedResult.operations.map(
        (operation, index) => ({
          ...operation,
          persistentId: persistedOperations[index]?.id,
          persistenceVersion: persistedOperations[index]?.version,
          persistenceStatus: persistedOperations[index]?.status,
        }),
      );
    }
    await query(
      `UPDATE mi_agent_analysis_jobs SET status = 'completed', result_json = ?, error_message = NULL, updated_at = NOW(3) WHERE id = ?`,
      [JSON.stringify(normalizedResult), jobId],
    );
    if (sessionId) {
      await appendCoachSessionTurn(
        user.id,
        sessionId,
        {
          role: "seller",
          text: question,
        },
        activeContext,
      );
      await appendCoachSessionTurn(
        user.id,
        sessionId,
        {
          role: "coach",
          text: normalizedResult.answer,
          result: normalizedResult,
        },
        activeContext,
      );
    }
  } catch (error) {
    await query(
      `UPDATE mi_agent_analysis_jobs SET status = 'failed', error_message = ?, updated_at = NOW(3) WHERE id = ?`,
      [
        String(error?.message || "No fue posible responder la pregunta").slice(
          0,
          1000,
        ),
        jobId,
      ],
    ).catch(() => undefined);
  }
}

async function executeInteractionJob({
  jobId,
  user,
  opportunityId,
  note,
  stageQuestions = [],
}) {
  try {
    await query(
      `UPDATE mi_agent_analysis_jobs SET status = 'running', updated_at = NOW(3) WHERE id = ?`,
      [jobId],
    );
    const fullContext = await getMiAgentEnrichedContext(
      user,
      await getMiAgentContext(user),
    );
    let opportunity = fullContext.workboard?.find(
      (item) => Number(item.id) === Number(opportunityId),
    );
    if (!opportunity) {
      const params = [Number(opportunityId)];
      const globalScope = hasMiAgentGlobalScope(user);
      let scope = "";
      if (!globalScope) {
        scope =
          "LEFT JOIN account_owners ao_scope ON ao_scope.account_id = o.account_id AND ao_scope.user_id = ? AND (ao_scope.user_id IS NOT NULL OR o.created_by = ? OR o.seller_user_id = ?)";
        params.push(Number(user.id), Number(user.id), Number(user.id));
      }
      const rows = await query(
        `SELECT o.id, o.name, o.amount_usd, o.close_date, oss.code AS stage_code,
                oss.name AS stage_name, a.name AS account_name
         FROM opportunities o
         ${scope}
         INNER JOIN accounts a ON a.id = o.account_id
         INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
         WHERE o.id = ?
           ${globalScope ? "" : "AND (ao_scope.user_id IS NOT NULL OR o.created_by = ? OR o.seller_user_id = ?)"}
         LIMIT 1`,
        globalScope
          ? [Number(opportunityId)]
          : [
              Number(user.id),
              Number(user.id),
              Number(user.id),
              Number(opportunityId),
              Number(user.id),
              Number(user.id),
            ],
      );
      const row = rows[0];
      if (row) {
        opportunity = {
          id: Number(row.id),
          name: row.name || "",
          accountName: row.account_name || "",
          amountUsd: Number(row.amount_usd || 0),
          closeDate: row.close_date || null,
          stageCode: row.stage_code || "",
          stageName: row.stage_name || "",
          workspace: {},
          stageAnswers: [],
          documents: [],
          activities: [],
        };
      }
    }
    if (!opportunity)
      throw new Error("Oportunidad no encontrada o fuera de alcance");
    const result = await requestMiAgentJson({
      payload: {
        model: config.openai.model,
        temperature: 0.1,
        input: [
          {
            role: "system",
            content:
              "Analiza una nota de conversación comercial y devuelve solo JSON válido en castellano. Extrae hechos y cambios propuestos, sin inventar. No apliques cambios. Distingue hechos confirmados de inferencias. Si el vendedor solicita actualizar un campo de la oportunidad, como el importe en dólares, devuelve un cambio entity=opportunity y field=amountUsd con el valor numérico en newValue. En ese caso no propongas stageAnswer ni respuesta de etapa, aunque el texto incluya un monto. Solo propone una respuesta de etapa si la nota informa un dato que responde una pregunta de la etapa actual y usa el questionId real de la lista proporcionada. Solo propone una actividad si el vendedor pide explícitamente agendarla, programarla o registrar una actividad realizada. Si no existe esa petición explícita, activity debe ser null. No inventes fechas, horas, objetivos ni actividades. Si la nota o la fecha indicada está en el pasado, decide si la actividad realmente se realizó o sigue pendiente; no asumas automáticamente que por ser fecha pasada ya está completada.",
          },
          {
            role: "user",
            content: JSON.stringify({
              note,
              currentDate: new Date().toISOString().slice(0, 10),
              timeZone: config.app?.businessTimezone || "America/Mexico_City",
              opportunity,
              stageQuestions,
              expectedJsonShape: {
                summary: "",
                changes: [
                  {
                    entity:
                      "activity|opportunity|stage_answer|stakeholder|risk|next_step",
                    field: "",
                    previousValue: "",
                    newValue: "",
                    confidence: "high|medium|low",
                    evidence: "",
                    requiresConfirmation: true,
                  },
                ],
                stageAnswer: {
                  questionId: 0,
                  questionPrompt: "",
                  answerValue: "",
                  confidence: "high|medium|low",
                  evidence: "",
                },
                activity: null,
                nextStep: {
                  title: "",
                  dueDate: "YYYY-MM-DD|null",
                  successCriteria: "",
                },
                warnings: [""],
              },
            }),
          },
        ],
      },
      user,
      jobId,
      startedAt: new Date(),
      phase: "interaction",
    });
    await query(
      `UPDATE mi_agent_analysis_jobs SET status = 'completed', result_json = ?, error_message = NULL, updated_at = NOW(3) WHERE id = ?`,
      [JSON.stringify(result), jobId],
    );
  } catch (error) {
    await query(
      `UPDATE mi_agent_analysis_jobs SET status = 'failed', error_message = ?, updated_at = NOW(3) WHERE id = ?`,
      [
        String(
          error?.message || "No fue posible analizar la conversación",
        ).slice(0, 1000),
        jobId,
      ],
    ).catch(() => undefined);
  }
}

async function executeMiAgentAnalysisJob({ jobId, user }) {
  try {
    await query(
      `UPDATE mi_agent_analysis_jobs
       SET status = 'running', updated_at = NOW(3)
       WHERE id = ? AND created_by_user_id = ?`,
      [jobId, Number(user.id)],
    );

    const startedAt = new Date();
    await assertAiBudgetAvailable({ userId: Number(user.id) });
    const baseContext = await getMiAgentContext(user);
    const snapshot = await getMiAgentEnrichedContext(user, baseContext);
    const developmentPlan = buildLocalDevelopmentPlan(snapshot);
    const parsed = await requestMiAgentJson({
      payload: buildActionPrompt(snapshot, developmentPlan),
      user,
      jobId,
      startedAt,
      phase: "acciones_recomendadas",
    });

    await query(
      `UPDATE mi_agent_analysis_jobs
       SET status = 'completed', result_json = ?, error_message = NULL,
           updated_at = NOW(3)
       WHERE id = ? AND created_by_user_id = ?`,
      [
        JSON.stringify(normalizeAnalysis(parsed, snapshot, developmentPlan)),
        jobId,
        Number(user.id),
      ],
    );
  } catch (error) {
    await query(
      `UPDATE mi_agent_analysis_jobs
       SET status = 'failed', error_message = ?, updated_at = NOW(3)
       WHERE id = ? AND created_by_user_id = ?`,
      [
        String(
          error?.message || "No fue posible analizar la situación comercial",
        ).slice(0, 1000),
        jobId,
        Number(user.id),
      ],
    ).catch(() => undefined);
  }
}

router.get(
  "/context",
  requirePermission(MI_COACH_USE_PERMISSION),
  async (req, res) => {
    return res.json(await getMiAgentContext(req.user));
  },
);

router.post(
  "/analyze",
  requirePermission(MI_COACH_USE_PERMISSION),
  async (req, res) => {
    if (!config.openai.apiKey) {
      return res
        .status(503)
        .json({ message: "La configuracion IA no esta habilitada" });
    }
    await ensureMiAgentSchema();
    const result = await query(
      `INSERT INTO mi_agent_analysis_jobs (created_by_user_id, status)
       VALUES (?, 'pending')`,
      [Number(req.user.id)],
    );
    const jobId = Number(result.insertId);
    setImmediate(() => executeMiAgentAnalysisJob({ jobId, user: req.user }));
    return res.status(202).json({
      job: { id: jobId, status: "pending", pollAfterMs: 1000 },
    });
  },
);

router.post(
  "/coach",
  requirePermission(MI_COACH_USE_PERMISSION),
  async (req, res) => {
    const question = String(req.body?.question || "").trim();
    let conversationHistory = Array.isArray(req.body?.history)
      ? req.body.history
          .filter((message) => message && typeof message === "object")
          .map((message) => ({
            role: message.role === "coach" ? "coach" : "seller",
            text: String(message.text || "")
              .trim()
              .slice(0, 2000),
          }))
          .filter((message) => message.text)
          .slice(-8)
      : [];
    let selectedContext =
      req.body?.context && typeof req.body.context === "object"
        ? {
            accountId: Number(req.body.context.accountId || 0) || null,
            opportunityId: Number(req.body.context.opportunityId || 0) || null,
            contactId: Number(req.body.context.contactId || 0) || null,
            leadId: Number(req.body.context.leadId || 0) || null,
          }
        : {};
    const userId = Number(req.user.id);
    const requestedSessionId = Number(req.body?.sessionId || 0) || null;
    let session = requestedSessionId
      ? await getCoachSession(req.user.id, requestedSessionId)
      : null;
    if (session) {
      selectedContext = resolveCoachTurnContext(
        selectedContext,
        session.context,
        true,
      );
    }
    const hasAccountGlobalScope =
      req.user?.permissionSet?.has("cuentas.read_all");
    if (selectedContext.accountId) {
      const permissionError = requireEntityReadPermission(req.user, "cuentas");
      if (permissionError)
        return res.status(permissionError.status).json(permissionError.body);
      const accountParams = [selectedContext.accountId];
      const accountScope = hasAccountGlobalScope
        ? ""
        : "AND EXISTS (SELECT 1 FROM account_owners ao WHERE ao.account_id = a.id AND ao.user_id = ?)";
      if (!hasAccountGlobalScope) accountParams.push(userId);
      const accountRows = await query(
        `SELECT a.id FROM accounts a
         INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
         WHERE a.id = ? AND aas.code = 'activada' ${accountScope} LIMIT 1`,
        accountParams,
      );
      if (!accountRows.length)
        return res
          .status(404)
          .json({ message: "La cuenta seleccionada no esta disponible" });
    }
    if (selectedContext.opportunityId) {
      const permissionError = requireEntityReadPermission(
        req.user,
        "oportunidades",
      );
      if (permissionError)
        return res.status(permissionError.status).json(permissionError.body);
      const governanceSettings = await getMiCoachGovernanceSettings();
      const enabledTerminalStatusCodes =
        getEnabledCoachTerminalStatusCodes(governanceSettings);
      const terminalStatusCondition = enabledTerminalStatusCodes.length
        ? `AND (ocs.code NOT IN ('ganada', 'perdida', 'anulada') OR ocs.code IN (${enabledTerminalStatusCodes.map(() => "?").join(", ")}))`
        : "AND ocs.code NOT IN ('ganada', 'perdida', 'anulada')";
      const opportunityParams = [
        selectedContext.opportunityId,
        ...enabledTerminalStatusCodes,
      ];
      const opportunityScope = hasMiAgentGlobalScope(req.user)
        ? ""
        : "AND (EXISTS (SELECT 1 FROM account_owners ao WHERE ao.account_id = o.account_id AND ao.user_id = ?) OR o.created_by = ? OR o.seller_user_id = ?)";
      if (!hasMiAgentGlobalScope(req.user))
        opportunityParams.push(userId, userId, userId);
      const relationship = selectedContext.accountId
        ? "AND o.account_id = ?"
        : "";
      if (selectedContext.accountId)
        opportunityParams.push(selectedContext.accountId);
      const opportunityRows = await query(
        `SELECT o.id FROM opportunities o
         INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
         INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
         WHERE o.id = ? AND oas.code = 'activada'
           ${terminalStatusCondition}
           ${opportunityScope} ${relationship} LIMIT 1`,
        opportunityParams,
      );
      if (!opportunityRows.length)
        return res
          .status(404)
          .json({ message: "La oportunidad seleccionada no esta disponible" });
    }
    if (selectedContext.contactId) {
      const permissionError = requireEntityReadPermission(
        req.user,
        "contactos",
      );
      if (permissionError)
        return res.status(permissionError.status).json(permissionError.body);
      const contactParams = [selectedContext.contactId];
      let contactRelationship = "";
      if (selectedContext.accountId) {
        contactRelationship = "AND c.account_id = ?";
        contactParams.push(selectedContext.accountId);
      }
      const contactScope = hasAccountGlobalScope
        ? ""
        : "AND EXISTS (SELECT 1 FROM account_owners ao_contact WHERE ao_contact.account_id = c.account_id AND ao_contact.user_id = ?)";
      if (!hasAccountGlobalScope) contactParams.push(userId);
      const contactRows = await query(
        `SELECT c.id FROM contacts c
         INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
         WHERE c.id = ? AND cas.code = 'activado' ${contactRelationship} ${contactScope} LIMIT 1`,
        contactParams,
      );
      if (!contactRows.length)
        return res
          .status(404)
          .json({ message: "El contacto seleccionado no esta disponible" });
    }
    if (selectedContext.leadId) {
      const permissionError = requireEntityReadPermission(
        req.user,
        "interacciones",
      );
      if (permissionError)
        return res.status(permissionError.status).json(permissionError.body);
      const leadParams = [selectedContext.leadId];
      const hasLeadGlobalScope = hasPermission(
        req.user,
        "interacciones.read_all",
      );
      const leadScope = hasLeadGlobalScope
        ? ""
        : "AND (EXISTS (SELECT 1 FROM account_owners ao_lead WHERE ao_lead.account_id = i.account_id AND ao_lead.user_id = ?) OR i.seller_user_id = ? OR i.created_by = ?)";
      if (!hasLeadGlobalScope) leadParams.push(userId, userId, userId);
      const leadRows = await query(
        `SELECT i.id FROM interactions i
         WHERE i.id = ? ${leadScope}
         LIMIT 1`,
        leadParams,
      );
      if (!leadRows.length)
        return res
          .status(404)
          .json({ message: "El lead seleccionado no esta disponible" });
    }
    if (!question)
      return res.status(400).json({ message: "La pregunta es obligatoria" });
    if (!config.openai.apiKey)
      return res
        .status(503)
        .json({ message: "La configuracion IA no esta habilitada" });
    if (!session)
      session = await createCoachSession(req.user.id, selectedContext);
    if (session) {
      if (!conversationHistory.length) {
        conversationHistory = getCoachConversationHistory(
          session.messages,
          selectedContext,
          session.context,
        );
      }
    }
    await ensureMiAgentSchema();
    const result = await query(
      `INSERT INTO mi_agent_analysis_jobs (created_by_user_id, job_kind, question, context_snapshot, status)
       VALUES (?, 'coach', ?, ?, 'pending')`,
      [Number(req.user.id), question, JSON.stringify(selectedContext)],
    );
    const jobId = Number(result.insertId);
    setImmediate(() =>
      executeCoachJob({
        jobId,
        user: req.user,
        question,
        selectedContext,
        conversationHistory,
        sessionId: session?.id || null,
      }),
    );
    return res.status(202).json({
      sessionId: session?.id || null,
      job: { id: jobId, status: "pending", pollAfterMs: 1000 },
    });
  },
);

router.get(
  "/coach/sessions/active",
  requirePermission(MI_COACH_USE_PERMISSION),
  async (req, res) => {
    const session = await getLatestActiveCoachSession(req.user.id);
    if (!session)
      return res.json({ session: null, operations: [], recentOperations: [] });
    const [operations, allOperations] = await Promise.all([
      listCoachSessionOperations(req.user.id, session.id, {
        activeOnly: true,
      }),
      listCoachSessionOperations(req.user.id, session.id),
    ]);
    const recentOperations = allOperations
      .filter((operation) =>
        [
          "completed",
          "rejected",
          "cancelled",
          "superseded",
          "reverted",
        ].includes(operation.status),
      )
      .slice(0, 6);
    return res.json({ session, operations, recentOperations });
  },
);

router.get(
  "/coach/sessions/:sessionId",
  requirePermission(MI_COACH_USE_PERMISSION),
  async (req, res) => {
    const session = await getCoachSession(
      req.user.id,
      Number(req.params.sessionId || 0),
    );
    if (!session)
      return res.status(404).json({ message: "La sesión del Coach no existe" });
    const [operations, allOperations] = await Promise.all([
      listCoachSessionOperations(req.user.id, session.id, {
        activeOnly: true,
      }),
      listCoachSessionOperations(req.user.id, session.id),
    ]);
    const recentOperations = allOperations
      .filter((operation) =>
        [
          "completed",
          "rejected",
          "cancelled",
          "superseded",
          "reverted",
        ].includes(operation.status),
      )
      .slice(0, 6);
    return res.json({ session, operations, recentOperations });
  },
);

router.post(
  "/coach/operations",
  requirePermission(MI_COACH_USE_PERMISSION),
  async (req, res) => {
    const parsed = coachOperationSchema.safeParse(req.body?.operation);
    if (!parsed.success) {
      return res.status(400).json({
        message: "La operación propuesta no es válida",
        issues: parsed.error.issues,
      });
    }
    const delegatedPermissions = getDelegatedCoachOperationPermissions(
      parsed.data.kind,
    );
    if (
      !delegatedPermissions ||
      !hasPermission(req.user, MI_COACH_EXECUTE_PERMISSION) ||
      !hasAnyPermission(req.user, delegatedPermissions)
    ) {
      return res.status(403).json({
        message: "No autorizado para proponer esta operación",
        requiredPermission: delegatedPermissions || MI_COACH_EXECUTE_PERMISSION,
      });
    }
    const requestedSessionId = Number(req.body?.sessionId || 0) || null;
    const session = requestedSessionId
      ? await getCoachSession(req.user.id, requestedSessionId)
      : await getOrCreateCoachSession(req.user.id, null, req.body?.context);
    if (!session) {
      return res.status(404).json({ message: "La sesión del Coach no existe" });
    }
    const [operation] = await persistCoachOperations({
      userId: req.user.id,
      sessionId: session.id,
      sourceJobId: null,
      originalIntent:
        String(req.body?.originalIntent || parsed.data.title).trim() ||
        parsed.data.title,
      entities: req.body?.context || session.context,
      operations: [parsed.data],
    });
    return res.status(201).json({ sessionId: session.id, operation });
  },
);

router.patch(
  "/coach/operations/:operationId",
  requirePermission(MI_COACH_USE_PERMISSION),
  async (req, res) => {
    const operationId = Number(req.params.operationId || 0);
    const version = Number(req.body?.version || 0);
    if (!operationId || !version) {
      return res.status(400).json({ message: "Operación o versión inválida" });
    }
    const result = await updateCoachOperation(req.user.id, operationId, {
      pendingOperation: req.body?.pendingOperation,
      collectedFields: req.body?.collectedFields,
      missingFields: req.body?.missingFields,
      version,
    });
    if (result.outcome === "not_found")
      return res.status(404).json({ message: "Operación no encontrada" });
    if (result.outcome === "closed")
      return res.status(409).json({ message: "La operación ya está cerrada" });
    if (result.outcome === "conflict")
      return res.status(409).json({
        message: "La operación cambió en otra ventana",
        operation: result.operation,
      });
    if (result.outcome === "invalid")
      return res.status(400).json({
        message: "No puedes cambiar el tipo, entidad o campo de la operación",
        operation: result.operation,
      });
    return res.json({ operation: result.operation });
  },
);

router.post(
  "/coach/operations/:operationId/handoff",
  requirePermission(MI_COACH_USE_PERMISSION),
  async (req, res) => {
    const operationId = Number(req.params.operationId || 0);
    if (!operationId)
      return res.status(400).json({ message: "Operación inválida" });
    const existing = await getCoachOperation(req.user.id, operationId);
    if (!existing)
      return res.status(404).json({ message: "Operación no encontrada" });
    const delegatedPermissions = getDelegatedCoachOperationPermissions(
      existing.kind,
    );
    if (
      !delegatedPermissions ||
      !hasPermission(req.user, MI_COACH_EXECUTE_PERMISSION) ||
      !hasAnyPermission(req.user, delegatedPermissions)
    ) {
      return res.status(403).json({
        message: "No autorizado para enviar esta operación al módulo",
        requiredPermission: delegatedPermissions || MI_COACH_EXECUTE_PERMISSION,
      });
    }
    const result = await createCoachHandoff(req.user.id, operationId);
    if (result.outcome === "not_found")
      return res.status(404).json({ message: "Operación no encontrada" });
    if (result.outcome === "unsupported")
      return res
        .status(409)
        .json({ message: "La operación no admite handoff" });
    if (result.outcome === "closed")
      return res.status(409).json({ message: "La operación ya está cerrada" });
    const operation = result.operation;
    return res.json({
      handoff: {
        token: operation.handoffToken,
        module: operation.targetModule,
        url: `${operation.targetRoute}?coachDraft=${encodeURIComponent(operation.handoffToken)}`,
        expiresAt: operation.handoffExpiresAt,
      },
      operation,
    });
  },
);

router.post(
  "/coach/operations/:operationId/review",
  requirePermission(MI_COACH_USE_PERMISSION),
  async (req, res) => {
    try {
      const operation = await reviewControlledCoachOperation({
        user: req.user,
        operationId: Number(req.params.operationId || 0),
        version: Number(req.body?.version || 0),
      });
      return res.json({ operation });
    } catch (error) {
      if (error instanceof CoachOperationError) {
        return res.status(error.status).json({
          code: error.code,
          message: error.message,
          ...error.details,
        });
      }
      throw error;
    }
  },
);

router.post(
  "/coach/operations/:operationId/execute",
  requirePermission(MI_COACH_USE_PERMISSION),
  async (req, res) => {
    try {
      const operation = await executeControlledCoachOperation({
        req,
        operationId: Number(req.params.operationId || 0),
        version: Number(req.body?.version || 0),
        idempotencyKey: req.body?.idempotencyKey,
        validateLeadOutcome: validateLeadCallOutcomeForCoach,
      });
      return res.json({ operation, result: operation.result });
    } catch (error) {
      if (error instanceof CoachOperationError) {
        return res.status(error.status).json({
          code: error.code,
          message: error.message,
          ...error.details,
        });
      }
      await transitionCoachOperation(
        req.user.id,
        Number(req.params.operationId || 0),
        {
          status: "failed",
          errorDetail: "No fue posible ejecutar la operación controlada",
        },
      ).catch(() => undefined);
      throw error;
    }
  },
);

router.post(
  "/coach/operations/:operationId/revert",
  requirePermission(MI_COACH_USE_PERMISSION),
  async (req, res) => {
    try {
      const operation = await revertControlledCoachOperation({
        req,
        operationId: Number(req.params.operationId || 0),
      });
      return res.json({ operation });
    } catch (error) {
      if (error instanceof CoachOperationError) {
        return res
          .status(error.status)
          .json({ code: error.code, message: error.message, ...error.details });
      }
      throw error;
    }
  },
);

router.get(
  "/coach/handoffs/:token",
  requirePermission(MI_COACH_USE_PERMISSION),
  async (req, res) => {
    const moduleName = String(req.query?.module || "").trim();
    if (!moduleName)
      return res.status(400).json({ message: "El módulo es obligatorio" });
    const result = await getCoachHandoff(
      req.user.id,
      req.params.token,
      moduleName,
    );
    if (result.outcome === "wrong_module")
      return res
        .status(409)
        .json({ message: "El borrador pertenece a otro módulo" });
    if (result.outcome !== "ready")
      return res
        .status(404)
        .json({ message: "El borrador no existe o expiró" });
    const operation = result.operation;
    return res.json({
      handoff: {
        operationId: operation.id,
        kind: operation.kind,
        module: operation.targetModule,
        payload: operation.pendingOperation,
        entities: operation.identifiedEntities,
        missingFields: operation.missingFields,
        evidence: operation.evidence,
        version: operation.version,
        expiresAt: operation.handoffExpiresAt,
      },
    });
  },
);

router.post(
  "/coach/handoffs/:token/complete",
  requirePermission(MI_COACH_USE_PERMISSION),
  async (req, res) => {
    const moduleName = String(req.body?.module || "").trim();
    const entityId = Number(req.body?.entityId || 0) || null;
    if (!moduleName)
      return res.status(400).json({ message: "El módulo es obligatorio" });
    const result = await completeCoachHandoff(
      req.user.id,
      req.params.token,
      moduleName,
      {
        entityType: String(req.body?.entityType || "").slice(0, 80) || null,
        entityId,
        ...(req.body?.result && typeof req.body.result === "object"
          ? req.body.result
          : {}),
      },
    );
    if (result.outcome === "wrong_module")
      return res
        .status(409)
        .json({ message: "El borrador pertenece a otro módulo" });
    if (result.outcome !== "updated")
      return res
        .status(404)
        .json({ message: "El borrador no existe o expiró" });
    return res.json({ operation: result.operation });
  },
);

router.post(
  "/coach/handoffs/:token/cancel",
  requirePermission(MI_COACH_USE_PERMISSION),
  async (req, res) => {
    const moduleName = String(req.body?.module || "").trim();
    const reason = String(req.body?.reason || "").trim();
    if (!moduleName || !reason)
      return res
        .status(400)
        .json({ message: "Módulo y motivo son obligatorios" });
    const result = await cancelCoachHandoff(
      req.user.id,
      req.params.token,
      moduleName,
      reason,
    );
    if (result.outcome === "wrong_module")
      return res
        .status(409)
        .json({ message: "El borrador pertenece a otro módulo" });
    if (result.outcome !== "updated")
      return res
        .status(404)
        .json({ message: "El borrador no existe o expiró" });
    return res.json({ operation: result.operation });
  },
);

router.post(
  "/coach/operations/:operationId/status",
  requirePermission(MI_COACH_USE_PERMISSION),
  async (req, res) => {
    const operationId = Number(req.params.operationId || 0);
    const status = String(req.body?.status || "");
    if (!operationId)
      return res.status(400).json({ message: "Operación inválida" });
    const existing = await getCoachOperation(req.user.id, operationId);
    if (!existing)
      return res.status(404).json({ message: "Operación no encontrada" });
    if (status !== "cancelled") {
      return res.status(409).json({
        message:
          "El estado de la operación solo puede cambiar mediante su flujo autorizado",
        operation: existing,
      });
    }
    const result = await transitionCoachOperation(req.user.id, operationId, {
      status,
      result: req.body?.result,
      errorDetail: req.body?.errorDetail,
      cancellationReason: req.body?.cancellationReason,
    });
    if (result?.outcome === "invalid_transition") {
      return res.status(409).json({
        message: `No se puede cambiar una operación ${existing.status} a ${status}`,
        operation: existing,
      });
    }
    return res.json({ operation: result?.operation || null });
  },
);

router.get(
  "/coach/metrics",
  requirePermission(MI_COACH_USE_PERMISSION),
  async (req, res) => {
    return res.json(await getCoachMetrics(req.user.id));
  },
);

router.post(
  "/coach/operations/:operationId/reject",
  requirePermission(MI_COACH_USE_PERMISSION),
  async (req, res) => {
    const operationId = Number(req.params.operationId || 0);
    if (!operationId)
      return res.status(400).json({ message: "Operación inválida" });
    const result = await transitionCoachOperation(req.user.id, operationId, {
      status: "rejected",
      cancellationReason: req.body?.reason || "Rechazada por el vendedor",
      source: "user",
      reasonCode: "seller_rejected",
    });
    if (!result || result.outcome === "not_found")
      return res.status(404).json({ message: "Operación no encontrada" });
    if (result?.outcome === "invalid_transition")
      return res.status(409).json({
        message: "La operación ya no puede rechazarse",
        operation: result.operation,
      });
    return res.json({ operation: result.operation });
  },
);

router.post(
  "/coach/leads/:interactionId/undo",
  requirePermission(MI_COACH_USE_PERMISSION),
  requirePermission("interacciones.update"),
  async (req, res) => {
    const interactionId = Number(req.params.interactionId || 0);
    if (!Number.isInteger(interactionId) || interactionId <= 0) {
      return res.status(400).json({ message: "Lead invalido" });
    }
    const rows = await query(
      `SELECT i.id, i.analysis_status, i.account_id, i.seller_user_id, i.created_by
       FROM interactions i
       LEFT JOIN account_owners ao ON ao.account_id = i.account_id AND ao.user_id = ?
       WHERE i.id = ? AND (ao.user_id IS NOT NULL OR i.seller_user_id = ? OR i.created_by = ?)
       LIMIT 1`,
      [
        Number(req.user.id),
        interactionId,
        Number(req.user.id),
        Number(req.user.id),
      ],
    );
    if (
      !rows.length &&
      !req.user?.permissionSet?.has("interacciones.read_all")
    ) {
      return res.status(404).json({ message: "Lead no encontrado" });
    }
    const events = await query(
      `SELECT id, event_type, from_status_code, to_status_code, substatus_code,
              reason_code, required_action_code, commercial_comment,
              next_action_due_at
       FROM interaction_lead_outcome_events
       WHERE interaction_id = ? AND invalidated_at IS NULL
       ORDER BY id DESC LIMIT 2`,
      [interactionId],
    );
    if (!events.length)
      return res
        .status(409)
        .json({ message: "No existe resultado de lead para revertir" });
    const latest = events[0];
    const previous = events[1] || null;
    await query(
      `UPDATE interactions
       SET analysis_status = ?, lead_substatus_code = ?, lead_reason_code = ?,
           lead_required_action_code = ?, lead_commercial_comment = ?,
           lead_next_action_due_at = ?, updated_by = ?, updated_at = NOW(3)
       WHERE id = ?`,
      [
        latest.from_status_code || previous?.to_status_code || "created",
        previous?.substatus_code || null,
        previous?.reason_code || null,
        previous?.required_action_code || null,
        previous?.commercial_comment || null,
        previous?.next_action_due_at || null,
        Number(req.user.id),
        interactionId,
      ],
    );
    await query(
      `UPDATE interaction_lead_outcome_events SET invalidated_at = NOW(3) WHERE id = ?`,
      [latest.id],
    );
    await logAuditEvent({
      req,
      module: "mi_agent.coach",
      action: "coach_lead_outcome_undone",
      entityType: "interaction",
      entityId: interactionId,
      detail: "Resultado de lead revertido desde Coach",
      before: { eventId: latest.id, status: latest.to_status_code },
      after: {
        eventId: previous?.id || null,
        status:
          latest.from_status_code || previous?.to_status_code || "created",
      },
    });
    return res.json({ ok: true, interactionId, invalidatedEventId: latest.id });
  },
);

router.post(
  "/coach/operations/:auditId/undo",
  requirePermission(MI_COACH_USE_PERMISSION),
  async (req, res) => {
    const auditId = Number(req.params.auditId || 0);
    if (!Number.isInteger(auditId) || auditId <= 0) {
      return res.status(400).json({ message: "Auditoria invalida" });
    }
    const rows = await query(
      `SELECT id, action, entity_type, entity_id, changed_fields, performed_by_user_id
       FROM audit_log WHERE id = ? AND performed_by_user_id = ? LIMIT 1`,
      [auditId, Number(req.user.id)],
    );
    const audit = rows[0];
    const allowedActions = new Set([
      "coach_opportunity_field_updated",
      "coach_field_updated",
    ]);
    if (!audit || !allowedActions.has(String(audit.action))) {
      return res
        .status(404)
        .json({ message: "Cambio del Coach no reversible" });
    }
    const changes = parseAuditChangedFields(audit.changed_fields);
    const [field, change] = Object.entries(changes)[0] || [];
    const maps = {
      coach_opportunity_field_updated: {
        opportunity: {
          name: "name",
          amountUsd: "amount_usd",
          closeDate: "close_date",
        },
      },
      coach_field_updated: {
        account: {
          name: "name",
          phone: "phone",
          website: "website",
          city: "city",
          stateRegion: "state_region",
          companyDescription: "description",
        },
        contact: {
          firstName: "first_name",
          lastName: "last_name",
          email: "email",
          mobile: "mobile",
          phone: "phone",
          positionTitle: "position_title",
          department: "department",
          city: "city",
          stateRegion: "state_region",
          hierarchyLevelId: "hierarchy_level_id",
          relationshipTypeId: "relationship_type_id",
          influenceLevelId: "influence_level_id",
          managerContactId: "manager_contact_id",
          influencesContactId: "influences_contact_id",
        },
      },
    };
    const tableMap = {
      opportunity: "opportunities",
      account: "accounts",
      contact: "contacts",
    };
    const entityMap = {
      opportunity: "opportunity",
      account: "account",
      contact: "contact",
    };
    const entityKey =
      entityMap[String(audit.entity_type)] || String(audit.entity_type);
    const column = maps[audit.action]?.[entityKey]?.[field];
    const table = tableMap[entityKey];
    const requiredUpdatePermission = {
      opportunity: "oportunidades.update",
      account: "cuentas.update",
      contact: "contactos.update",
    }[entityKey];
    if (
      !requiredUpdatePermission ||
      !canExecuteCoachWrite(req.user, requiredUpdatePermission)
    ) {
      return res.status(403).json({
        message: "No autorizado",
        requiredPermission:
          requiredUpdatePermission || MI_COACH_EXECUTE_PERMISSION,
      });
    }
    if (
      !column ||
      !table ||
      !change ||
      !Object.prototype.hasOwnProperty.call(change, "before")
    ) {
      return res
        .status(409)
        .json({ message: "El cambio no tiene un valor anterior reversible" });
    }
    const idColumn = "id";
    const updateValues =
      entityKey === "opportunity"
        ? [change.before, audit.entity_id]
        : [change.before, Number(req.user.id), audit.entity_id];
    const updateSql =
      entityKey === "opportunity"
        ? `UPDATE ${table} SET ${column} = ?, updated_at = NOW(3) WHERE ${idColumn} = ?`
        : `UPDATE ${table} SET ${column} = ?, updated_by = ?, updated_at = NOW(3) WHERE ${idColumn} = ?`;
    await query(updateSql, updateValues);
    await logAuditEvent({
      req,
      module: "mi_agent.coach",
      action: "coach_operation_undone",
      entityType: entityKey,
      entityId: audit.entity_id,
      detail: `Cambio del Coach revertido: ${field}`,
      before: { [field]: change.after },
      after: { [field]: change.before },
    });
    return res.json({ ok: true, auditId });
  },
);

router.post(
  "/interaction/analyze",
  requirePermission(MI_COACH_USE_PERMISSION),
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const opportunityId = Number(req.body?.opportunityId || 0);
    const note = String(req.body?.note || "").trim();
    const stageQuestions = Array.isArray(req.body?.stageQuestions)
      ? req.body.stageQuestions
          .map((question) => ({
            questionId: Number(
              question?.questionId || question?.question_id || 0,
            ),
            questionPrompt: String(
              question?.questionPrompt || question?.prompt || "",
            ).trim(),
            answerValue: String(
              question?.answerValue || question?.answer_value || "",
            ).trim(),
            required: Boolean(question?.required || question?.is_required),
          }))
          .filter(
            (question) => question.questionId > 0 && question.questionPrompt,
          )
      : [];
    if (!opportunityId || !note)
      return res
        .status(400)
        .json({ message: "opportunityId y note son obligatorios" });
    await ensureMiAgentSchema();
    const result = await query(
      `INSERT INTO mi_agent_analysis_jobs (created_by_user_id, job_kind, question, status) VALUES (?, 'interaction', ?, 'pending')`,
      [Number(req.user.id), note],
    );
    const jobId = Number(result.insertId);
    setImmediate(() =>
      executeInteractionJob({
        jobId,
        user: req.user,
        opportunityId,
        note,
        stageQuestions,
      }),
    );
    return res
      .status(202)
      .json({ job: { id: jobId, status: "pending", pollAfterMs: 1000 } });
  },
);

router.get(
  "/interaction/jobs/:jobId",
  requirePermission(MI_COACH_USE_PERMISSION),
  async (req, res) => {
    await ensureMiAgentSchema();
    const rows = await query(
      `SELECT id, status, result_json, error_message FROM mi_agent_analysis_jobs WHERE id = ? AND created_by_user_id = ? AND job_kind = 'interaction' LIMIT 1`,
      [Number(req.params.jobId || 0), Number(req.user.id)],
    );
    const job = rows[0];
    if (!job)
      return res
        .status(404)
        .json({ message: "Análisis de conversación no encontrado" });
    let result = null;
    try {
      result = job.result_json
        ? typeof job.result_json === "string"
          ? JSON.parse(job.result_json)
          : job.result_json
        : null;
    } catch {
      result = null;
    }
    return res.json({
      job: {
        id: Number(job.id),
        status: job.status,
        errorMessage: job.error_message || null,
      },
      result,
    });
  },
);

router.get(
  "/coach/jobs/:jobId",
  requirePermission(MI_COACH_USE_PERMISSION),
  async (req, res) => {
    await ensureMiAgentSchema();
    const rows = await query(
      `SELECT id, status, question, context_snapshot, result_json, error_message, created_at, updated_at
       FROM mi_agent_analysis_jobs
       WHERE id = ? AND created_by_user_id = ? AND job_kind = 'coach'
       LIMIT 1`,
      [Number(req.params.jobId || 0), Number(req.user.id)],
    );
    const job = rows[0];
    if (!job)
      return res.status(404).json({ message: "Pregunta no encontrada" });
    let result = null;
    try {
      result = job.result_json
        ? typeof job.result_json === "string"
          ? JSON.parse(job.result_json)
          : job.result_json
        : null;
    } catch {
      result = null;
    }
    let contextSnapshot = null;
    try {
      contextSnapshot = job.context_snapshot
        ? typeof job.context_snapshot === "string"
          ? JSON.parse(job.context_snapshot)
          : job.context_snapshot
        : null;
    } catch {
      contextSnapshot = null;
    }
    return res.json({
      job: {
        id: Number(job.id),
        status: job.status,
        question: job.question,
        contextSnapshot,
        errorMessage: job.error_message || null,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
      },
      result,
    });
  },
);

router.get(
  "/analyze/jobs/:jobId",
  requirePermission(MI_COACH_USE_PERMISSION),
  async (req, res) => {
    await ensureMiAgentSchema();
    const jobId = Number(req.params.jobId || 0);
    const rows = await query(
      `SELECT id, status, result_json, error_message, created_at, updated_at
       FROM mi_agent_analysis_jobs
       WHERE id = ? AND created_by_user_id = ?
       LIMIT 1`,
      [jobId, Number(req.user.id)],
    );
    const job = rows[0];
    if (!job)
      return res.status(404).json({ message: "Análisis no encontrado" });
    let result = null;
    if (job.result_json) {
      try {
        result =
          typeof job.result_json === "string"
            ? JSON.parse(job.result_json)
            : job.result_json;
      } catch {
        result = null;
      }
    }
    return res.json({
      job: {
        id: Number(job.id),
        status: job.status,
        errorMessage: job.error_message || null,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
      },
      result,
    });
  },
);

export default router;
