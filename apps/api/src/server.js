import { resolve } from "node:path";
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
import { ensureCommercialCalendarPermissions } from "./commercial-calendar/permissions.js";
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
  ensureProposalSchema,
  ensureProposalExecutiveSummaryGenerationJobSchema,
  startQuotationProviderDocumentImportPreviewWorker,
  startProposalExecutiveSummaryGenerationWorker,
} from "./routes.quotations.js";
import { validateConfig } from "./validateConfig.js";
import { startOpportunityStageAnswerSuggestionWorker } from "./opportunity-stage-answer-suggestions/async.js";
import { ensureOpportunityStageAnswerSuggestionJobSchema } from "./opportunity-stage-answer-suggestions/schema.js";
import { startOpportunityStageValidationWorker } from "./opportunity-stage-validations/async.js";
import { ensureOpportunityStageValidationJobSchema } from "./opportunity-stage-validations/schema.js";
import { startOpportunityDocumentProcessingWorker } from "./opportunity-documents/async.js";
import { ensureOpportunityDocumentSchema } from "./opportunity-documents/schema.js";
import { ensureCorePermissions } from "./permissions.js";
import { ensureAiUsageSchema } from "./ai-usage/service.js";
import { ensureChatbotSchema } from "./chatbot/schema.js";
import { startChatbotWorker } from "./routes.chatbot.js";
import { ensureLandingPermissions } from "./landing/permissions.js";
import { ensureLandingSchema } from "./landing/schema.js";
import { startLandingWorker } from "./routes.landing.js";
import { ensureCampaignPermissions } from "./campaigns/permissions.js";
import { ensureCampaignsSchema } from "./campaigns/schema.js";
import { startCampaignEmailDispatchWorker } from "./routes.campaign-emails.js";
import { ensureCampaignEmailDispatchSchema } from "./campaign-emails/schema.js";
import { isInitialRoleAssignmentRequired } from "./permissions-bootstrap.js";
import { ensureSecurityTestSchema } from "./security-tests/schema.js";
import { startSecurityTestWorker } from "./security-tests/async.js";

export async function startServer() {
  validateConfig();
  const server = app.listen(config.port, () => {
    console.log(`API running on http://localhost:${config.port}`);
  });
  const autoAssignRoles = await isInitialRoleAssignmentRequired();
  await ensureCorePermissions({ autoAssignRoles });
  await ensureAiUsageSchema();
  await ensureChatbotSchema();
  await ensureInteractionPermissions({ autoAssignRoles });
  await ensureCommercialDevelopmentPermissions({ autoAssignRoles });
  await ensureCommercialCalendarPermissions({ autoAssignRoles });
  await ensureCommercialTrackingPermissions({ autoAssignRoles });
  await ensureCommercialEnablementPermissions({ autoAssignRoles });
  await ensureCommercialPlanningPermissions({ autoAssignRoles });
  await ensureManufacturerRegistrationPermissions({ autoAssignRoles });
  await ensureProcessCommercialConfigPermissions({ autoAssignRoles });
  await ensureLandingPermissions({ autoAssignRoles });
  await ensureCampaignPermissions({ autoAssignRoles });
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
  await ensureProposalSchema();
  await ensureProposalExecutiveSummaryGenerationJobSchema();
  await ensureCommercialExecutionSchema();
  await ensureCommercialEnablementSchema();
  await ensureCommercialEnablementStarterData();
  await ensureCommercialPlanningSchema();
  await ensureManufacturerRegistrationsSchema();
  await ensureLandingSchema();
  await ensureCampaignsSchema();
  await ensureCampaignEmailDispatchSchema();
  await ensureSecurityTestSchema();
  await startAuditRetentionJob();
  await startAccountDraftAnalysisWorker();
  await startCommercialNarrativeWorker();
  await startInteractionAnalysisWorker();
  await startOpportunityDocumentProcessingWorker();
  await startQuotationProviderDocumentImportPreviewWorker();
  await startProposalExecutiveSummaryGenerationWorker();
  await startOpportunityStageAnswerSuggestionWorker();
  await startOpportunityStageValidationWorker();
  await startChatbotWorker();
  await startLandingWorker();
  await startCampaignEmailDispatchWorker();
  startSecurityTestWorker();
  return server;
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectRun) {
  startServer().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}
