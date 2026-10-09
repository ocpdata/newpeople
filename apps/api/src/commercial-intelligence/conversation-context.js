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
  };
}

export function buildCustomerConversationContext({
  accountId,
  effectiveContext = {},
  routing = null,
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
  };
}
