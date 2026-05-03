import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { app } from "./app.js";
import { ensureAccountInteractionsSchema } from "./account-interactions/schema.js";
import { ensureInteractionPermissions } from "./interactions/permissions.js";
import { ensureInteractionSchema } from "./interactions/schema.js";
import { startAuditRetentionJob } from "./audit.js";
import { startOpportunityDocumentProcessingWorker } from "./opportunity-documents/async.js";
import { ensureOpportunityDocumentSchema } from "./opportunity-documents/schema.js";
import { ensureCorePermissions } from "./permissions.js";

export async function startServer() {
  await ensureCorePermissions();
  await ensureInteractionPermissions();
  await ensureAccountInteractionsSchema();
  await ensureInteractionSchema();
  await ensureOpportunityDocumentSchema();
  await startAuditRetentionJob();
  await startOpportunityDocumentProcessingWorker();
  return app.listen(config.port, () => {
    console.log(`API running on http://localhost:${config.port}`);
  });
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  startServer();
}
