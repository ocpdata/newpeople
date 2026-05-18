import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { app } from "./app.js";
import { ensureAccountInteractionsSchema } from "./account-interactions/schema.js";
import { ensureInteractionPermissions } from "./interactions/permissions.js";
import { ensureInteractionSchema } from "./interactions/schema.js";
import { startAuditRetentionJob } from "./audit.js";
import { ensureCommercialExecutionSchema } from "./commercial-execution/schema.js";
import { ensureCommercialEnablementPermissions } from "./commercial-enablement/permissions.js";
import { ensureCommercialEnablementSchema } from "./commercial-enablement/schema.js";
import { ensureCommercialDevelopmentPermissions } from "./commercial-development/permissions.js";
import { ensureCommercialPlanningPermissions } from "./commercial-planning/permissions.js";
import { ensureCommercialPlanningSchema } from "./commercial-planning/schema.js";
import { ensureManufacturerRegistrationPermissions } from "./manufacturer-registrations/permissions.js";
import { ensureManufacturerRegistrationsSchema } from "./manufacturer-registrations/schema.js";
import { ensureOpportunityWorkspaceSchema } from "./opportunity-workspace/schema.js";
import { ensureProcessCommercialConfigPermissions } from "./process-commercial-config/permissions.js";
import { startOpportunityStageAnswerSuggestionWorker } from "./opportunity-stage-answer-suggestions/async.js";
import { ensureOpportunityStageAnswerSuggestionJobSchema } from "./opportunity-stage-answer-suggestions/schema.js";
import { startOpportunityDocumentProcessingWorker } from "./opportunity-documents/async.js";
import { ensureOpportunityDocumentSchema } from "./opportunity-documents/schema.js";
import { ensureCorePermissions } from "./permissions.js";

export async function startServer() {
  await ensureCorePermissions();
  await ensureInteractionPermissions();
  await ensureCommercialDevelopmentPermissions();
  await ensureCommercialEnablementPermissions();
  await ensureCommercialPlanningPermissions();
  await ensureManufacturerRegistrationPermissions();
  await ensureProcessCommercialConfigPermissions();
  await ensureAccountInteractionsSchema();
  await ensureInteractionSchema();
  await ensureOpportunityDocumentSchema();
  await ensureOpportunityStageAnswerSuggestionJobSchema();
  await ensureOpportunityWorkspaceSchema();
  await ensureCommercialExecutionSchema();
  await ensureCommercialEnablementSchema();
  await ensureCommercialPlanningSchema();
  await ensureManufacturerRegistrationsSchema();
  await startAuditRetentionJob();
  await startOpportunityDocumentProcessingWorker();
  await startOpportunityStageAnswerSuggestionWorker();
  return app.listen(config.port, () => {
    console.log(`API running on http://localhost:${config.port}`);
  });
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  startServer();
}
