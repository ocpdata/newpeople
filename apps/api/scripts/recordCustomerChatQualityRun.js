import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pool } from "../src/db.js";
import { QUALITY_SOURCES } from "../src/customer-chat-quality/gates.js";
import { recordQualityRun } from "../src/customer-chat-quality/store.js";

// Stores the JSON report of a live evaluation so results can be compared over time.
// Usage: npm run quality:record --workspace=apps/api -- --source=contract|pipeline --file=report.json [--commit=sha] [--trigger=ci]

const options = Object.fromEntries(process.argv.slice(2)
  .filter((arg) => arg.startsWith("--") && arg.includes("="))
  .map((arg) => [arg.slice(2, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)]));

function currentCommit() {
  if (options.commit) return options.commit;
  if (process.env.GITHUB_SHA || process.env.GIT_COMMIT) return process.env.GITHUB_SHA || process.env.GIT_COMMIT;
  try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return null; }
}

try {
  if (!["contract", "pipeline"].includes(options.source) || !QUALITY_SOURCES.includes(options.source)) {
    throw new Error("Indica --source=contract o --source=pipeline.");
  }
  if (!options.file) throw new Error("Indica --file=<reporte.json>.");
  const report = JSON.parse(await readFile(options.file, "utf8"));
  const run = await recordQualityRun({
    source: options.source, report, model: report.model, commitSha: currentCommit(),
    trigger: options.trigger || (process.env.GITHUB_ACTIONS ? "ci" : "manual"), evaluatedAt: report.evaluatedAt,
  });
  console.log(JSON.stringify({ id: run.id, source: run.source, status: run.status, groups: run.groups, reasons: run.reasons }, null, 2));
  if (run.status === "regressed") console.log(`::warning::La calidad bajó frente a la ejecución anterior: ${run.reasons.join(" ")}`);
  if (run.status === "failed") process.exitCode = 2;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
