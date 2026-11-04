import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";
import { pool, query } from "../src/db.js";
import { getUserAuthContext } from "../src/auth.js";
import { assertModelPriced } from "../src/customer-chat-acceptance/runner.js";
import { recordChannelQualityRun } from "../src/channel-quality/store.js";
import { prospectBank, runProspectBank, validateBank } from "../src/channel-quality/live/prospect-live.js";

const USAGE = `Banco de evaluación de Cuenta nueva con IA real (datos sintéticos, con costo).

  --live                  Obligatorio: confirma que se harán llamadas pagadas al proveedor.
  --user <id>             Usuario con permisos de prospección; sus llamadas de IA se registran con su id.
  --judge-model <modelo>  Modelo evaluador (por defecto el modelo del analista); debe tener tarifa vigente.
  --only S01,S12          Limita los escenarios.
  --concurrency <n>       Escenarios en paralelo (por defecto 3).
  --out <directorio>      Destino del reporte (por defecto acceptance-runs/prospect/).
  --no-record             No registra el resultado en «Calidad Coach y Cuenta nueva».`;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
};
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const log = (message) => console.log(`[cuenta-nueva] ${message}`);

function gitRevision() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: apiRoot }).toString().trim();
  } catch {
    return null;
  }
}

async function loadUsage({ since, userId }) {
  const [row] = await query(
    `SELECT COUNT(*) AS calls, COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(cost_micros), 0) AS cost_micros, GROUP_CONCAT(DISTINCT CONCAT(feature_code, ':', model)) AS models
     FROM ai_usage_ledger
     WHERE user_id = ? AND created_at_utc >= ? AND feature_code IN ('prospect_research.chat', 'prospect_research.chat_classifier', 'prospect_chat.acceptance_judge')`,
    [Number(userId), since],
  );
  return {
    calls: Number(row.calls), promptTokens: Number(row.prompt_tokens), completionTokens: Number(row.completion_tokens),
    costUsd: Number(row.cost_micros) / 1e6, models: String(row.models || "").split(",").filter(Boolean),
  };
}

async function main() {
  if (flag("--help") || !flag("--live")) {
    console.log(USAGE);
    if (!flag("--help")) process.exitCode = 1;
    return;
  }
  const problems = validateBank();
  if (problems.length) throw new Error(`El banco no es válido:\n${problems.join("\n")}`);
  if (!config.openai.apiKey) throw new Error("Falta la configuración del proveedor de IA.");
  const userId = Number(option("--user"));
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("Indica --user <id>.");
  const user = await getUserAuthContext(userId);
  if (!user) throw new Error(`No existe el usuario ${userId}.`);
  if (!user.permissionSet?.has("prospeccion.read")) throw new Error(`El usuario ${userId} no tiene prospeccion.read.`);
  const judgeModel = option("--judge-model", config.openai.analystModel || config.openai.model);
  await assertModelPriced(query, judgeModel);
  const only = option("--only") ? option("--only").split(",").map((item) => item.trim()).filter(Boolean) : null;
  const unknown = (only || []).filter((id) => !prospectBank.scenarios.some((scenario) => scenario.id === id));
  if (unknown.length) throw new Error(`Escenarios desconocidos: ${unknown.join(", ")}`);
  const concurrency = Math.min(6, Math.max(1, Number(option("--concurrency", 3)) || 3));

  const startedAt = new Date();
  log(`Evaluando ${only ? only.length : prospectBank.scenarios.length} escenarios con el usuario ${userId} y evaluador ${judgeModel}.`);
  const run = await runProspectBank({ user, judgeModel, only, concurrency, log });
  const usage = await loadUsage({ since: startedAt, userId });

  const report = {
    channel: "prospect", generatedAt: new Date().toISOString(), commit: gitRevision(), judgeModel, bankVersion: prospectBank.version,
    partial: Boolean(only), usage, groups: run.groups, results: run.results, scenarios: run.scenarios,
  };
  const outDir = path.resolve(option("--out", path.join(apiRoot, "acceptance-runs", "prospect")));
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `prospect-${startedAt.toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("");
  for (const scenario of run.scenarios) {
    const mark = { passed: "✔", failed: "✘", not_graded: "·" }[scenario.status];
    const failed = run.results.find((item) => item.id === scenario.id);
    console.log(`${mark} ${scenario.id} ${scenario.title}${scenario.critical ? " [crítico]" : ""}${scenario.futureCapability ? " [capacidad futura]" : ""}${failed ? ` → ${failed.error}` : ""}`);
  }
  console.log("");
  console.log(Object.entries(run.groups).map(([name, group]) => `${name} ${group.passed}/${group.total}`).join(" · "));
  console.log(`Llamadas de IA: ${usage.calls} · costo ≈ USD ${usage.costUsd.toFixed(4)} · modelos: ${usage.models.join(", ") || "n/d"}`);
  console.log(`Reporte: ${file}`);

  if (!only && !flag("--no-record") && !run.notGraded) {
    const recorded = await recordChannelQualityRun({
      channel: "prospect", source: "live", report: { groups: run.groups, results: run.results },
      metrics: { costUsd: usage.costUsd, calls: usage.calls }, model: judgeModel, commitSha: report.commit, trigger: "manual", evaluatedAt: startedAt,
    });
    console.log(`Registrado en Calidad Coach y Cuenta nueva: ${recorded.status}${recorded.reasons.length ? ` · ${recorded.reasons.join(" | ")}` : ""}`);
  } else if (only || flag("--no-record")) {
    log("Ejecución parcial o --no-record: no se registra en la tendencia.");
  }
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
