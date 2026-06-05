import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { app } from "./app.js";
import { startAccountDraftAnalysisWorker } from "./accounts/draft-analysis/async.js";
import { ensureAccountDraftAnalysisJobSchema } from "./accounts/draft-analysis/jobs-schema.js";
import { ensureCommercialNarrativeJobSchema } from "./commercial-development/narrative-jobs-schema.js";
import { ensureAccountInteractionsSchema } from "./account-interactions/schema.js";
import { ensureInteractionPermissions } from "./interactions/permissions.js";
import { ensureInteractionAnalysisJobSchema } from "./interactions/analysis-jobs-schema.js";
import { ensureInteractionSchema } from "./interactions/schema.js";
import { startAuditRetentionJob } from "./audit.js";
import { ensureCommercialExecutionSchema } from "./commercial-execution/schema.js";
import { ensureCommercialEnablementStarterData } from "./commercial-enablement/library-service.js";
import { ensureCommercialEnablementPermissions } from "./commercial-enablement/permissions.js";
import { ensureCommercialEnablementSchema } from "./commercial-enablement/schema.js";
import { ensureCommercialDevelopmentPermissions } from "./commercial-development/permissions.js";
import { ensureCommercialTrackingPermissions } from "./commercial-tracking/permissions.js";
import { ensureCommercialPlanningPermissions } from "./commercial-planning/permissions.js";
import { ensureCommercialPlanningSchema } from "./commercial-planning/schema.js";
import { ensureManufacturerRegistrationPermissions } from "./manufacturer-registrations/permissions.js";
import { ensureManufacturerRegistrationsSchema } from "./manufacturer-registrations/schema.js";
import { ensureOpportunityWorkspaceSchema } from "./opportunity-workspace/schema.js";
import { ensureProcessCommercialConfigPermissions } from "./process-commercial-config/permissions.js";
import { startCommercialNarrativeWorker } from "./routes.execution-commercial.js";
import { startInteractionAnalysisWorker } from "./routes.interactions.js";
import {
  ensureQuotationProviderDocumentImportPreviewJobSchema,
  ensureProposalExecutiveSummaryGenerationJobSchema,
  startQuotationProviderDocumentImportPreviewWorker,
  startProposalExecutiveSummaryGenerationWorker,
} from "./routes.quotations.js";
import { startOpportunityStageAnswerSuggestionWorker } from "./opportunity-stage-answer-suggestions/async.js";
import { ensureOpportunityStageAnswerSuggestionJobSchema } from "./opportunity-stage-answer-suggestions/schema.js";
import { startOpportunityStageValidationWorker } from "./opportunity-stage-validations/async.js";
import { ensureOpportunityStageValidationJobSchema } from "./opportunity-stage-validations/schema.js";
import { startOpportunityDocumentProcessingWorker } from "./opportunity-documents/async.js";
import { ensureOpportunityDocumentSchema } from "./opportunity-documents/schema.js";
import { ensureCorePermissions } from "./permissions.js";
import { ensureAiUsageSchema } from "./ai-usage/service.js";

export async function startServer() {
  await ensureCorePermissions();
  await ensureAiUsageSchema();
  await ensureInteractionPermissions();
  await ensureCommercialDevelopmentPermissions();
  await ensureCommercialTrackingPermissions();
  await ensureCommercialEnablementPermissions();
  await ensureCommercialPlanningPermissions();
  await ensureManufacturerRegistrationPermissions();
  await ensureProcessCommercialConfigPermissions();
  await ensureAccountDraftAnalysisJobSchema();
  await ensureAccountInteractionsSchema();
  await ensureCommercialNarrativeJobSchema();
  await ensureInteractionSchema();
  await ensureInteractionAnalysisJobSchema();
  await ensureOpportunityDocumentSchema();
  await ensureOpportunityStageAnswerSuggestionJobSchema();
  await ensureOpportunityStageValidationJobSchema();
  await ensureOpportunityWorkspaceSchema();
  await ensureQuotationProviderDocumentImportPreviewJobSchema();
  await ensureProposalExecutiveSummaryGenerationJobSchema();
  await ensureCommercialExecutionSchema();
  await ensureCommercialEnablementSchema();
  await ensureCommercialEnablementStarterData();
  await ensureCommercialPlanningSchema();
  await ensureManufacturerRegistrationsSchema();
  await startAuditRetentionJob();
  await startAccountDraftAnalysisWorker();
  await startCommercialNarrativeWorker();
  await startInteractionAnalysisWorker();
  await startOpportunityDocumentProcessingWorker();
  await startQuotationProviderDocumentImportPreviewWorker();
  await startProposalExecutiveSummaryGenerationWorker();
  await startOpportunityStageAnswerSuggestionWorker();
  await startOpportunityStageValidationWorker();
  return app.listen(config.port, () => {
    console.log(`API running on http://localhost:${config.port}`);
  });
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  startServer();
}
