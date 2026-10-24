import { COMMERCIAL_ACTIVITY_TYPES } from "../../../../shared/commercial-activity-types.js";
import { validateCustomerTurnMemory } from "./turn-contract-runtime.js";
import { validateCustomerRecordList } from "./customer-record-list.js";
import { validateCustomerHistoryMemory } from "./customer-history.js";
import { validateCustomerPendingMemory } from "./customer-pending.js";
import { validateCustomerRelationshipMemory } from "./customer-relationships.js";
import { validateCustomerDocumentMemory } from "./customer-documents.js";
import { validateCustomerPriorityMemory } from "./customer-prioritization.js";
import { validateCustomerComparisonMemory } from "./customer-comparison.js";
import { validateCustomerTrendMemory } from "./customer-trends.js";
import { validateCustomerScenarioMemory } from "./customer-scenarios.js";
import { validateCustomerDocumentReportMemory } from "./customer-document-reports.js";
import { validateCustomerCreationMemory } from "./customer-creation.js";
import { validateCustomerUpdateMemory } from "./customer-updates.js";
import { validateCustomerLinkMemory } from "./customer-links.js";
import { validateCustomerRescheduleMemory } from "./customer-reschedule.js";
import { validateCustomerOutcomeMemory } from "./customer-outcomes.js";
import { validateCustomerStageMemory } from "./customer-stage.js";

const INTENT_CODES = new Set([
  "crm_operation",
  "email_draft",
  "quotation_query",
  "contact_history",
  "opportunity_status",
  "opportunity_guidance",
  "account_activity_history",
  "contact_query",
  "opportunity_query",
  "account_overview",
]);

const OPPORTUNITY_STATUSES = new Set([
  "unspecified",
  "open",
  "historical",
  "all",
]);
const MAX_FILTER_RANGE_DAYS = 366 * 5;
const ACTIVITY_TYPES = new Set(
  COMMERCIAL_ACTIVITY_TYPES.map((item) => item.value),
);

function validatedPendingActivityIntent(value) {
  if (!value || typeof value !== "object") return null;
  const actionType = String(value.actionType || "");
  const timing = String(value.timing || "");
  if (
    !ACTIVITY_TYPES.has(actionType) ||
    !["completed", "scheduled", "unclear"].includes(timing)
  ) {
    return null;
  }
  return {
    actionType,
    timing,
    title: String(value.title || "").trim().slice(0, 1200),
    notes: String(value.notes || "").trim().slice(0, 4000),
    successCriteria: String(value.successCriteria || "")
      .trim()
      .slice(0, 1200),
    temporalPreference: String(value.temporalPreference || "")
      .trim()
      .slice(0, 1200),
  };
}

function positiveId(value) {
  const id = Number(value || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validDateOnly(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === text
    ? text
    : null;
}

function validatedFilters(value = {}) {
  const filters = {};
  if (OPPORTUNITY_STATUSES.has(value.opportunityStatus)) {
    filters.opportunityStatus = value.opportunityStatus;
  }
  const stageCode = String(value.stageCode || "").trim();
  if (/^[a-z0-9_]{1,60}$/i.test(stageCode)) filters.stageCode = stageCode;
  const closeYear = Number(value.closeYear || 0);
  if (Number.isInteger(closeYear) && closeYear >= 2000 && closeYear <= 2100) {
    filters.closeYear = closeYear;
  }
  const periodMonths = Number(value.periodMonths || 0);
  if (
    Number.isInteger(periodMonths) &&
    periodMonths >= 1 &&
    periodMonths <= 60
  ) {
    filters.periodMonths = periodMonths;
  }
  const startDate = validDateOnly(value.startDate);
  const endDate = validDateOnly(value.endDate);
  if (startDate && endDate && startDate <= endDate) {
    const spanDays =
      (new Date(`${endDate}T00:00:00.000Z`).getTime() -
        new Date(`${startDate}T00:00:00.000Z`).getTime()) /
      86400000;
    if (spanDays <= MAX_FILTER_RANGE_DAYS) {
      filters.startDate = startDate;
      filters.endDate = endDate;
    }
  }
  return filters;
}

export function getCustomerConversationFilterMemory(
  context,
  expectedAccountId,
) {
  const accountId = positiveId(expectedAccountId);
  if (!accountId || positiveId(context?.accountId) !== accountId) return {};
  return validatedFilters(context?.filters);
}

export function validateCustomerDossierMemory(memory, visibleOpportunityIds) {
  if (!memory || typeof memory !== "object" || !["account", "opportunity", "opportunities"].includes(memory.level)) return null;
  const focusOpportunityIds = [...new Set((Array.isArray(memory.focusOpportunityIds) ? memory.focusOpportunityIds : [])
    .map(positiveId).filter((id) => id && visibleOpportunityIds.has(id)))].slice(0, 3);
  return {
    level: memory.level === "account" || focusOpportunityIds.length ? memory.level : "account",
    focusOpportunityIds,
    obligations: (Array.isArray(memory.obligations) ? memory.obligations : []).slice(0, 8)
      .filter((item) => typeof item?.ask === "string")
      .map((item) => ({ id: String(item.id || "").slice(0, 20), ask: item.ask.slice(0, 300) })),
    citedEvidenceIds: (Array.isArray(memory.citedEvidenceIds) ? memory.citedEvidenceIds : [])
      .filter((id) => typeof id === "string" && /^[a-z]+\d+(?:\.\d+)?$/.test(id)).slice(0, 60),
  };
}

export function validateCustomerConversationContext(
  context,
  snapshot,
  expectedAccountId,
) {
  if (!context || typeof context !== "object") return null;
  const accountId = positiveId(expectedAccountId);
  const selectedAccountId = positiveId(snapshot?.account?.id);
  if (!accountId || selectedAccountId !== accountId) return null;
  if (positiveId(context.accountId) !== accountId) return null;

  const opportunities = [
    ...(snapshot.opportunities || []),
    ...(snapshot.inactiveOpportunities || []),
    ...(snapshot.selectedOpportunity ? [snapshot.selectedOpportunity] : []),
  ];
  const visibleOpportunityIds = new Set(
    opportunities
      .filter((item) => Number(item.accountId || 0) === accountId)
      .map((item) => positiveId(item.id))
      .filter(Boolean),
  );
  const visibleContactIds = new Set(
    (snapshot.contacts || [])
      .filter((item) => Number(item.accountId || 0) === accountId)
      .map((item) => positiveId(item.id))
      .filter(Boolean),
  );
  const visibleLeadIds = new Set(
    (snapshot.interactions || [])
      .filter(
        (item) =>
          Number(item.accountId || 0) === accountId &&
          (item.leadSubstatusCode ||
            item.leadReasonCode ||
            item.leadRequiredActionCode),
      )
      .map((item) => positiveId(item.id))
      .filter(Boolean),
  );
  const opportunityId = positiveId(context.opportunityId);
  const contactId = positiveId(context.contactId);
  const leadId = positiveId(context.leadId);
  const intents = Array.isArray(context.intents)
    ? [
        ...new Set(context.intents.filter((code) => INTENT_CODES.has(code))),
      ].slice(0, 8)
    : [];
  return {
    version: 1,
    accountId,
    opportunityId:
      opportunityId && visibleOpportunityIds.has(opportunityId)
        ? opportunityId
        : null,
    contactId: contactId && visibleContactIds.has(contactId) ? contactId : null,
    leadId: leadId && visibleLeadIds.has(leadId) ? leadId : null,
    intents,
    filters: validatedFilters(context.filters),
    ...(validateCustomerLinkMemory(context.linkMemory, snapshot)
      ? { linkMemory: validateCustomerLinkMemory(context.linkMemory, snapshot) } : {}),
    ...(validateCustomerRescheduleMemory(context.rescheduleMemory, snapshot)
      ? { rescheduleMemory: validateCustomerRescheduleMemory(context.rescheduleMemory, snapshot) } : {}),
    ...(validateCustomerOutcomeMemory(context.outcomeMemory, snapshot)
      ? { outcomeMemory: validateCustomerOutcomeMemory(context.outcomeMemory, snapshot) } : {}),
    ...(validateCustomerStageMemory(context.stageMemory, snapshot)
      ? { stageMemory: validateCustomerStageMemory(context.stageMemory, snapshot) } : {}),
    ...(validateCustomerUpdateMemory(context.updateMemory, snapshot)
      ? { updateMemory: validateCustomerUpdateMemory(context.updateMemory, snapshot) } : {}),
    ...(validateCustomerCreationMemory(context.creationMemory, snapshot)
      ? { creationMemory: validateCustomerCreationMemory(context.creationMemory, snapshot) } : {}),
    ...(validateCustomerDocumentReportMemory(context.documentReportMemory, snapshot)
      ? { documentReportMemory: validateCustomerDocumentReportMemory(context.documentReportMemory, snapshot) } : {}),
    ...(validateCustomerTrendMemory(context.trendMemory, snapshot)
      ? { trendMemory: validateCustomerTrendMemory(context.trendMemory, snapshot) } : {}),
    ...(validateCustomerScenarioMemory(context.scenarioMemory, snapshot)
      ? { scenarioMemory: validateCustomerScenarioMemory(context.scenarioMemory, snapshot) } : {}),
    ...(validateCustomerComparisonMemory(context.comparisonMemory, snapshot)
      ? { comparisonMemory: validateCustomerComparisonMemory(context.comparisonMemory, snapshot) } : {}),
    ...(validateCustomerPriorityMemory(context.priorityMemory, snapshot)
      ? { priorityMemory: validateCustomerPriorityMemory(context.priorityMemory, snapshot) } : {}),
    ...(validateCustomerDocumentMemory(context.documentMemory, snapshot)
      ? { documentMemory: validateCustomerDocumentMemory(context.documentMemory, snapshot) } : {}),
    ...(validateCustomerRelationshipMemory(context.relationshipMemory, snapshot)
      ? { relationshipMemory: validateCustomerRelationshipMemory(context.relationshipMemory, snapshot) } : {}),
    ...(validateCustomerHistoryMemory(context.historyMemory, snapshot)
      ? { historyMemory: validateCustomerHistoryMemory(context.historyMemory, snapshot) } : {}),
    ...(validateCustomerPendingMemory(context.pendingMemory, snapshot)
      ? { pendingMemory: validateCustomerPendingMemory(context.pendingMemory, snapshot) } : {}),
    ...(validateCustomerRecordList(context.recordList, snapshot, accountId)
      ? { recordList: validateCustomerRecordList(context.recordList, snapshot, accountId) } : {}),
    ...(validateCustomerTurnMemory(context.turnMemory)
      ? { turnMemory: validateCustomerTurnMemory(context.turnMemory) }
      : {}),
    ...(validateCustomerDossierMemory(context.dossierMemory, visibleOpportunityIds)
      ? { dossierMemory: validateCustomerDossierMemory(context.dossierMemory, visibleOpportunityIds) }
      : {}),
    ...(Number(context.pendingAmountSelection?.accountId) === accountId &&
    typeof context.pendingAmountSelection?.amount === "number" &&
    Number.isFinite(context.pendingAmountSelection.amount) &&
    context.pendingAmountSelection.amount >= 0 &&
    Array.isArray(context.pendingAmountSelection.candidateIds)
      ? {
          pendingAmountSelection: {
            accountId,
            amount: context.pendingAmountSelection.amount,
            candidateIds: [...new Set(context.pendingAmountSelection.candidateIds
              .map(positiveId).filter((id) => visibleOpportunityIds.has(id)))],
            filters: validatedFilters(context.pendingAmountSelection.filters),
          },
        }
      : {}),
    ...(positiveId(context.pendingActivity?.operationId) &&
    positiveId(context.pendingActivity?.sessionId) &&
    visibleOpportunityIds.has(
      positiveId(context.pendingActivity?.operation?.opportunityId),
    ) &&
    Number(context.pendingActivity?.operation?.accountId) === accountId
      ? {
          pendingActivity: {
            operationId: positiveId(context.pendingActivity.operationId),
            sessionId: positiveId(context.pendingActivity.sessionId),
            version: positiveId(context.pendingActivity.version),
            temporalPreference: String(
              context.pendingActivity.temporalPreference || "",
            ).slice(0, 1200),
            operation: context.pendingActivity.operation,
          },
        }
      : {}),
    ...(validatedPendingActivityIntent(context.pendingActivityIntent)
      ? {
          pendingActivityIntent: validatedPendingActivityIntent(
            context.pendingActivityIntent,
          ),
        }
      : {}),
  };
}

export function buildCustomerConversationContext({
  accountId,
  effectiveContext = {},
  routing = null,
  pendingActivityIntent = null,
} = {}) {
  const safeAccountId = positiveId(accountId);
  if (!safeAccountId) return null;
  return {
    version: 1,
    accountId: safeAccountId,
    opportunityId: positiveId(effectiveContext.opportunityId),
    contactId: positiveId(effectiveContext.contactId),
    leadId: positiveId(effectiveContext.leadId),
    intents: Array.isArray(routing?.intents)
      ? [
          ...new Set(routing.intents.filter((code) => INTENT_CODES.has(code))),
        ].slice(0, 8)
      : routing?.intent && INTENT_CODES.has(routing.intent)
        ? [routing.intent]
        : [],
    filters: validatedFilters(routing?.filters),
    ...(validatedPendingActivityIntent(pendingActivityIntent)
      ? { pendingActivityIntent: validatedPendingActivityIntent(pendingActivityIntent) }
      : {}),
  };
}
