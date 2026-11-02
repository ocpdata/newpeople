// When the server has already identified the record a question is about, it reads that record by ID. The planner's text
// filter ("<opportunity> de <account>") matches either the opportunity or the account name, never both, so searching by
// that text can return nothing for a record that exists.

const OPPORTUNITY_DETAIL_TOOLS = ["getOpportunity", "getOpportunityActivities"];

const positiveId = (value) => {
  const id = Number(value || 0);
  return Number.isInteger(id) && id > 0 ? id : 0;
};

export function reinforceCoachReads({
  plan,
  question = "",
  effectiveContext = {},
  authorizedTools = [],
  isStagePreparationQuestion = null,
  maxReads = 8,
}) {
  const reads = (Array.isArray(plan?.reads) ? plan.reads : []).map((read) => ({
    ...read,
    filters: { ...(read.filters || {}) },
  }));
  const allowed = new Set(authorizedTools.map((tool) => tool.name));
  const added = [];
  const accountId = positiveId(effectiveContext?.accountId);
  const opportunityId = positiveId(effectiveContext?.opportunityId);

  if (plan?.intent === "account_query" && accountId) {
    // The account is scoped by ID when the read runs; a text filter can only hide it.
    for (const read of reads)
      if (read.toolName === "searchAccounts") delete read.filters.text;
  }

  if (plan?.intent === "opportunity_query" && opportunityId) {
    const wanted = [
      ...OPPORTUNITY_DETAIL_TOOLS,
      ...(typeof isStagePreparationQuestion === "function" &&
      isStagePreparationQuestion(question)
        ? ["getOpportunityReadiness"]
        : []),
    ];
    // Leave room for the extra reads the evidence check may still request.
    const room = Math.max(0, maxReads - 2 - reads.length);
    for (const toolName of wanted) {
      if (
        added.length >= room ||
        !allowed.has(toolName) ||
        reads.some((read) => read.toolName === toolName)
      )
        continue;
      reads.push({ toolName, filters: {} });
      added.push(toolName);
    }
  }
  return { reads, added };
}

// The tool that returns the resolved record by ID, for turns whose planned reads found nothing.
export function resolvedRecordTool({ effectiveContext = {}, authorizedTools = [] }) {
  const allowed = new Set(authorizedTools.map((tool) => tool.name));
  if (positiveId(effectiveContext?.opportunityId) && allowed.has("getOpportunity"))
    return "getOpportunity";
  if (positiveId(effectiveContext?.accountId) && allowed.has("searchAccounts"))
    return "searchAccounts";
  return null;
}

// An empty text search next to the record read by ID would read as "not found" to the model.
export function pruneEmptySearches(evidence) {
  const foundById = evidence.some(
    (item) =>
      !item.error &&
      item.toolName === "getOpportunity" &&
      item.result &&
      typeof item.result === "object",
  );
  if (!foundById) return evidence;
  return evidence.filter(
    (item) =>
      !(
        item.toolName === "searchOpportunities" &&
        !item.error &&
        Array.isArray(item.result) &&
        item.result.length === 0
      ),
  );
}
