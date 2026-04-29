import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { app } from "./app.js";
import { startAuditRetentionJob } from "./audit.js";
import { ensureCorePermissions } from "./permissions.js";

export async function startServer() {
  await ensureCorePermissions();
  await startAuditRetentionJob();
  return app.listen(config.port, () => {
    console.log(`API running on http://localhost:${config.port}`);
  });
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  startServer();
}
