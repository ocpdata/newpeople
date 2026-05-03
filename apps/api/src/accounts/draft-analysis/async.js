export function buildAccountDraftAnalysisExecutionPlan({
  options,
  supportsStructuredResearch,
}) {
  const strategy = supportsStructuredResearch
    ? "structured_web_research"
    : "heuristic_pipeline";

  return {
    mode: "sync",
    canDefer: true,
    queueName: "account-draft-analysis",
    strategy,
  };
}
