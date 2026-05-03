import { pool } from "../src/db.js";
import { purgeExpiredOpportunityDraftSessions } from "../src/opportunity-documents/service.js";

const dryRun = !process.argv.includes("--apply");

try {
  const result = await purgeExpiredOpportunityDraftSessions({ dryRun });
  const actionLabel = dryRun ? "dry_run" : "applied";
  console.log(
    JSON.stringify(
      {
        action: "opportunity_document_session_cleanup",
        mode: actionLabel,
        ...result,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        action: "opportunity_document_session_cleanup",
        mode: dryRun ? "dry_run" : "applied",
        error: error?.message || String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
