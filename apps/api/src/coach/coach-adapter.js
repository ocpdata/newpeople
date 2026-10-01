import { getCoachReadToolCatalog } from "./read-tools.js";
import { runConversationEngine } from "./conversation-engine.js";

export function createCoachAdapter({ user, dependencies }) {
  const availableTools = getCoachReadToolCatalog();
  const permissions = user?.permissionSet || new Set();

  return {
    channel: "coach",
    availableTools,
    channelRules: {},
    permissions,
    operationPolicy: {},
    runTurn({ question, context = {}, history = [], jobId }) {
      return runConversationEngine({
        question,
        context,
        history,
        user,
        jobId,
        availableTools,
        channelRules: {},
        permissions,
        operationPolicy: {},
        dependencies,
      });
    },
  };
}

export function comparableCoachResult(result = {}) {
  return {
    intent: result?.intent || null,
    responseType: result?.responseType || null,
    entities: result?.entities || null,
    operations: Array.isArray(result?.operations)
      ? result.operations.map((operation) => ({
          kind: operation.kind,
          opportunityId: operation.opportunityId || null,
          accountId: operation.accountId || null,
          contactId: operation.contactId || null,
          interactionId: operation.interactionId || null,
        }))
      : [],
  };
}

export function coachResultsMatch(primaryResult, legacyResult) {
  return (
    JSON.stringify(comparableCoachResult(primaryResult)) ===
    JSON.stringify(comparableCoachResult(legacyResult))
  );
}

function comparableFacts(result = {}) {
  return Array.isArray(result?.facts)
    ? result.facts.map((fact) => ({
        sourceType: fact.sourceType || null,
        sourceId: fact.sourceId || null,
        label: fact.label || null,
        excerpt: fact.excerpt || null,
      }))
    : [];
}

export function comparableCoachExecution({
  result = {},
  observability = {},
  errorMessage = null,
} = {}) {
  return {
    intent: result?.intent || null,
    responseType: result?.responseType || null,
    answer: result?.answer || null,
    entities: result?.entities || null,
    fundamentals: {
      facts: comparableFacts(result),
      evidence: Array.isArray(result?.evidence) ? result.evidence : [],
      inferences: Array.isArray(result?.inferences) ? result.inferences : [],
      pendingItems: Array.isArray(result?.pendingItems)
        ? result.pendingItems
        : [],
      confidence: result?.confidence || null,
    },
    clarification: result?.clarification || null,
    operations: comparableCoachResult(result).operations,
    activeContext: result?.activeContext || null,
    tools: {
      used: Array.isArray(observability?.toolsUsed)
        ? observability.toolsUsed
        : [],
      queriedIds: Array.isArray(observability?.queriedIds)
        ? observability.queriedIds
        : [],
    },
    error: errorMessage || observability?.error || null,
  };
}

export function compareCoachExecutions(primary, legacy) {
  const primaryComparable = comparableCoachExecution(primary);
  const legacyComparable = comparableCoachExecution(legacy);
  const differences = Object.keys(primaryComparable).filter(
    (key) =>
      JSON.stringify(primaryComparable[key]) !==
      JSON.stringify(legacyComparable[key]),
  );
  const approvedDifferences = differences.filter(
    (key) => key === "tools",
  );
  const unexplainedDifferences = differences.filter(
    (key) => !approvedDifferences.includes(key),
  );
  return {
    matched: differences.length === 0,
    regression: unexplainedDifferences.length > 0,
    differences,
    approvedDifferences,
    unexplainedDifferences,
    primary: primaryComparable,
    legacy: legacyComparable,
  };
}
