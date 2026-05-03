import { runAccountDraftAnalysisPipeline } from "./pipeline.js";

export async function analyzeAccountDraft(input) {
  return runAccountDraftAnalysisPipeline(input);
}
