import { pool } from "../src/db.js";
import { QUALITY_CHANNELS } from "../src/channel-quality/gates.js";
import { recordChannelQualityRun } from "../src/channel-quality/store.js";
import { runCoachLab } from "../src/channel-quality/lab/coach.js";
import { runProspectLab } from "../src/channel-quality/lab/prospect.js";

// Runs the deterministic lab of a channel (no AI, no cost) and records the score in "Calidad en el tiempo".
// Usage: npm run quality:lab --workspace=apps/api -- --channel=coach|prospect [--commit=<sha>] [--dry-run]
const LABS = { coach: runCoachLab, prospect: runProspectLab };

function parseArgs(argv) {
  const options = { channel: null, commit: process.env.GIT_COMMIT || null, dryRun: false };
  for (const rawArg of argv) {
    const arg = String(rawArg || "").trim();
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg.startsWith("--channel=")) options.channel = arg.slice("--channel=".length);
    else if (arg.startsWith("--commit=")) options.commit = arg.slice("--commit=".length);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!QUALITY_CHANNELS.includes(options.channel)) {
    throw new Error(`Indica --channel=${QUALITY_CHANNELS.join("|")}`);
  }
  const report = LABS[options.channel]();
  const summary = Object.entries(report.groups).map(([name, group]) => `${name} ${group.passed}/${group.total}`).join(" · ");
  if (options.dryRun) {
    console.log(`[${options.channel}] ${summary}`);
    for (const failed of report.results) console.log(`  ✗ ${failed.id}: ${failed.error}`);
    return;
  }
  const run = await recordChannelQualityRun({
    channel: options.channel,
    source: "lab",
    report,
    commitSha: options.commit && /^[0-9a-f]{7,40}$/i.test(options.commit) ? options.commit : null,
    trigger: "manual",
  });
  console.log(`[${options.channel}] ${run.status}${run.duplicate ? " (ya registrado)" : ""} · ${summary}`);
  for (const reason of run.reasons) console.log(`  - ${reason}`);
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
