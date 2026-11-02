import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";
import { pool, query } from "../src/db.js";
import express from "express";
import { app } from "../src/app.js";
import miAgentRoutes from "../src/routes.mi-agent.js";
import { buildCommissionTrackingPayload } from "../src/routes.commercial-planning.js";
import { getUserAuthContext } from "../src/auth.js";
import { signToken } from "../src/utils.js";
import { assertModelPriced } from "../src/customer-chat-acceptance/runner.js";
import { recordChannelQualityRun } from "../src/channel-quality/store.js";
import { loadCoachFacts } from "../src/channel-quality/live/coach-facts.js";
import { listCommercialEnablementAssets } from "../src/commercial-enablement/library-service.js";
import { loadSellerNeedsFacts } from "../src/channel-quality/live/coach-needs-facts.js";
import needsBank from "../src/channel-quality/live/coach-needs-bank.json" with { type: "json" };
import { coachBank, createCoachHttpClient, runCoachBank, validateCoachBank } from "../src/channel-quality/live/coach-live.js";

const USAGE = `Banco de evaluación de Coach con IA real (datos de la base de desarrollo, con costo).

  --live                  Obligatorio: confirma que se harán llamadas pagadas al proveedor.
  --user <id>             Usuario con mi_coach.use y alcance global; sus llamadas de IA se registran con su id.
  --judge-model <modelo>  Modelo evaluador (por defecto el modelo del analista); debe tener tarifa vigente.
  --bank needs            Banco de necesidades del vendedor (cuota, agenda, cierres, tendencia, comisiones). Es una línea base: no se registra.
  --as-user <id>          Con --bank needs: vendedor que pregunta (se le simula acceso a Coach; no se modifica la base).
  --only K01,K08          Limita los escenarios.
  --concurrency <n>       Escenarios en paralelo (por defecto 3).
  --out <directorio>      Destino del reporte (por defecto acceptance-runs/coach/).
  --no-record             No registra el resultado en «Calidad Coach y Cuenta nueva».`;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
};
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const log = (message) => console.log(`[coach] ${message}`);

function gitRevision() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: apiRoot }).toString().trim();
  } catch {
    return null;
  }
}

async function loadUsage({ since, userIds }) {
  const [row] = await query(
    `SELECT COUNT(*) AS calls, COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(cost_micros), 0) AS cost_micros, GROUP_CONCAT(DISTINCT CONCAT(feature_code, ':', model)) AS models
     FROM ai_usage_ledger
     WHERE user_id IN (?) AND created_at_utc >= ? AND (feature_code LIKE 'mi_coach%' OR feature_code = 'coach_chat.acceptance_judge')`,
    [userIds.map(Number), since],
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
  const problems = [...validateCoachBank(coachBank), ...validateCoachBank(needsBank)];
  if (problems.length) throw new Error(`El banco no es válido:\n${problems.join("\n")}`);
  if (!config.openai.apiKey) throw new Error("Falta la configuración del proveedor de IA.");
  const userId = Number(option("--user"));
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("Indica --user <id>.");
  const user = await getUserAuthContext(userId);
  if (!user) throw new Error(`No existe el usuario ${userId}.`);
  if (!user.permissionSet?.has("mi_coach.use")) throw new Error(`El usuario ${userId} no tiene mi_coach.use.`);
  const judgeModel = option("--judge-model", config.openai.analystModel || config.openai.model);
  await assertModelPriced(query, judgeModel);
  const only = option("--only") ? option("--only").split(",").map((item) => item.trim()).filter(Boolean) : null;
  const needs = option("--bank") === "needs";
  const selectedBank = needs ? needsBank : coachBank;
  const actorId = needs ? Number(option("--as-user")) : userId;
  if (!Number.isInteger(actorId) || actorId <= 0) throw new Error("Con --bank needs indica --as-user <id>.");
  const unknown = (only || []).filter((id) => !selectedBank.scenarios.some((scenario) => scenario.id === id));
  if (unknown.length) throw new Error(`Escenarios desconocidos: ${unknown.join(", ")}`);
  const concurrency = Math.min(6, Math.max(1, Number(option("--concurrency", 3)) || 3));

  const listen = (instance) => new Promise((resolve) => { const server = instance.listen(0, "127.0.0.1", () => resolve(server)); });
  const adminToken = signToken({ id: user.id, email: user.email, full_name: user.full_name });
  const servers = [];
  let facts;
  let client;
  if (needs) {
    // The league payload is read with the global-scope user, as the Ritmo comercial screen would show it.
    const adminServer = await listen(app);
    servers.push(adminServer);
    const league = await (await fetch(`http://127.0.0.1:${adminServer.address().port}/api/commercial-tracking/seller-league-tv`, { headers: { authorization: `Bearer ${adminToken}` } })).json();
    const [period] = await query(
      "SELECT id FROM commercial_planning_periods WHERE plan_year = ? AND plan_quarter = ? ORDER BY id DESC LIMIT 1",
      [league.quarterContext.current.year, league.quarterContext.current.quarter],
    );
    const commissionTracking = period ? await buildCommissionTrackingPayload(Number(period.id)) : null;
    const actorForLibrary = await getUserAuthContext(actorId);
    actorForLibrary.permissionSet = new Set([...actorForLibrary.permissionSet, "enablement_comercial.use"]);
    const library = await listCommercialEnablementAssets({ user: actorForLibrary, filters: { pageSize: 100 } }).catch(() => ({ items: [] }));
    facts = await loadSellerNeedsFacts({ run: query, league, sellerId: actorId, commissionTracking, libraryAssets: library.items });
    // The seller does not have Coach or library access in this database, so access is simulated for the run without changing any data.
    const actor = await getUserAuthContext(actorId);
    actor.permissionSet = new Set([...actor.permissionSet, "mi_coach.use", ...(flag("--without-library") ? [] : ["enablement_comercial.use"])]);
    const actorApp = express();
    actorApp.use(express.json());
    actorApp.use("/api/mi-agent", (req, _res, next) => { req.user = actor; req.auth = { sub: actor.id }; next(); }, miAgentRoutes);
    const actorServer = await listen(actorApp);
    servers.push(actorServer);
    client = createCoachHttpClient({ baseUrl: `http://127.0.0.1:${actorServer.address().port}`, token: signToken({ id: actor.id, email: actor.email, full_name: actor.full_name }) });
    log(`Vendedor que pregunta: ${facts.seller.name} (cuota ${facts.me.quotaUsd}, lugar ${facts.me.rank} de ${facts.team.size}).`);
  } else {
    facts = await loadCoachFacts(query);
    log(`Datos de referencia: ${facts.open.count} oportunidades abiertas, principal ${facts.focus?.name || "n/d"}.`);
    const server = await listen(app);
    servers.push(server);
    client = createCoachHttpClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, token: adminToken });
  }

  const startedAt = new Date();
  try {
    log(`Evaluando ${only ? only.length : selectedBank.scenarios.length} escenarios con el usuario ${userId} y evaluador ${judgeModel}.`);
    const run = await runCoachBank({ user, client, facts, judgeModel, only, concurrency, log, bank: selectedBank });
    const usage = await loadUsage({ since: startedAt, userIds: [...new Set([userId, actorId])] });

    const report = {
      channel: "coach", generatedAt: new Date().toISOString(), commit: gitRevision(), judgeModel, bankVersion: selectedBank.version, bank: needs ? "needs" : "regression", actorId,
      partial: Boolean(only), facts, usage, groups: run.groups, results: run.results, scenarios: run.scenarios,
    };
    const outDir = path.resolve(option("--out", path.join(apiRoot, "acceptance-runs", needs ? "coach-needs" : "coach")));
    await mkdir(outDir, { recursive: true });
    const file = path.join(outDir, `coach-${startedAt.toISOString().replace(/[:.]/g, "-")}.json`);
    await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.log("");
    for (const scenario of run.scenarios) {
      const mark = { passed: "✔", failed: "✘", not_graded: "·" }[scenario.status];
      const failed = run.results.find((item) => item.id === scenario.id);
      console.log(`${mark} ${scenario.id} ${scenario.title}${scenario.critical ? " [crítico]" : ""}${failed ? ` → ${failed.error}` : ""}`);
    }
    console.log("");
    console.log(Object.entries(run.groups).map(([name, group]) => `${name} ${group.passed}/${group.total}`).join(" · "));
    console.log(`Llamadas de IA: ${usage.calls} · costo ≈ USD ${usage.costUsd.toFixed(4)} · modelos: ${usage.models.join(", ") || "n/d"}`);
    console.log(`Reporte: ${file}`);

    if (!needs && !only && !flag("--no-record") && !run.notGraded) {
      const recorded = await recordChannelQualityRun({
        channel: "coach", source: "live", report: { groups: run.groups, results: run.results },
        metrics: { costUsd: usage.costUsd, calls: usage.calls }, model: judgeModel, commitSha: report.commit, trigger: "manual", evaluatedAt: startedAt,
      });
      console.log(`Registrado en Calidad Coach y Cuenta nueva: ${recorded.status}${recorded.reasons.length ? ` · ${recorded.reasons.join(" | ")}` : ""}`);
    } else if (needs || only || flag("--no-record")) {
      log("Ejecución parcial o --no-record: no se registra en la tendencia.");
    }
  } finally {
    for (const server of servers) await new Promise((resolve) => { server.close(resolve); });
  }
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
