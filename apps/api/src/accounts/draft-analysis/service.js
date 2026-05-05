import {
  runAccountDraftAnalysisPipeline,
  runAccountDuplicateReviewPipeline,
} from "./pipeline.js";

export async function analyzeAccountDraft(input) {
  return runAccountDraftAnalysisPipeline(input);
}

export async function analyzeAccountDuplicateReview(input) {
  return runAccountDuplicateReviewPipeline(input);
}
