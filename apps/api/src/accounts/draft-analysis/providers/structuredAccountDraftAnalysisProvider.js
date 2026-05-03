import { runProfiledStructuredWebResearch } from "../../../structuredWebResearch.js";
import { accountDraftAnalysisResearchProfile } from "../profile.js";

export async function runStructuredAccountDraftAnalysis(input) {
  return runProfiledStructuredWebResearch(
    accountDraftAnalysisResearchProfile.analysis,
    input,
  );
}
