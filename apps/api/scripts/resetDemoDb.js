import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { config } from "../src/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(__dirname, "..");
const schemaPath = resolve(apiDir, "sql/schema.sql");

function runOrThrow(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: ["pipe", "inherit", "inherit"],
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function buildMysqlArgs(extraArgs = []) {
  const args = [
    "-h",
    config.db.host,
    "-P",
    String(config.db.port),
    "-u",
    config.db.user,
  ];

  if (config.db.password) {
    args.push(`-p${config.db.password}`);
  }

  return [...args, ...extraArgs];
}

function buildSchemaSql() {
  const schemaSql = readFileSync(schemaPath, "utf8");
  return schemaSql
    .replace(
      /CREATE DATABASE IF NOT EXISTS\s+`?newpeople_crm`?/i,
      `CREATE DATABASE IF NOT EXISTS \`${config.db.database}\``,
    )
    .replace(/USE\s+`?newpeople_crm`?;/i, `USE \`${config.db.database}\`;`);
}

console.log(`Recreando base demo: ${config.db.database}`);
console.log(`MySQL: ${config.db.host}:${config.db.port} (${config.db.user})`);

runOrThrow("mysql", buildMysqlArgs(["-e", `DROP DATABASE IF EXISTS \`${config.db.database}\``]));
runOrThrow("mysql", buildMysqlArgs(), { input: buildSchemaSql() });
runOrThrow(process.execPath, ["scripts/seedDemo.js", "--reset"], {
  cwd: apiDir,
  stdio: "inherit",
});
