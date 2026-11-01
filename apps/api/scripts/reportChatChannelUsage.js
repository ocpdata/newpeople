import { pool } from "../src/db.js";
import { loadChannelUsage, formatChannelUsage } from "../src/channel-quality/usage.js";

// Read-only usage report of the three chats (Coach, Cliente existente as reference, Cuenta nueva).
// Usage: npm run report:chat-channels --workspace=apps/api -- [--days=30 | --since=YYYY-MM-DD] [--json]
// Run it with the production environment to decide where to invest next.

function parseArgs(argv) {
  const options = { days: 30, since: null, json: false };
  for (const rawArg of argv) {
    const arg = String(rawArg || "").trim();
    if (arg === "--json") options.json = true;
    else if (arg.startsWith("--days=")) {
      const value = Number(arg.split("=")[1]);
      if (Number.isInteger(value) && value > 0 && value <= 365) options.days = value;
    } else if (arg.startsWith("--since=")) {
      const value = arg.slice("--since=".length);
      if (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))) options.since = value;
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await loadChannelUsage(options);
  console.log(options.json ? JSON.stringify(report, null, 2) : formatChannelUsage(report));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
