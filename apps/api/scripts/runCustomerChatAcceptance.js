import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";
import { pool } from "../src/db.js";
import { getUserAuthContext } from "../src/auth.js";
import { loadAcceptanceBank, selectConversations } from "../src/customer-chat-acceptance/bank.js";
import { verifyBankFacts, withReadOnlyConnection } from "../src/customer-chat-acceptance/facts.js";
import { gradeTurn, judgeTurn } from "../src/customer-chat-acceptance/judge.js";
import { renderMarkdownReport, summarizeRun } from "../src/customer-chat-acceptance/report.js";
import { assertModelPriced, loadAiUsageByJob, runConversation } from "../src/customer-chat-acceptance/runner.js";
import { checkDossierCoverage, dossierTargets, summarizeCoverage } from "../src/customer-chat-acceptance/dossier-coverage.js";
import { buildAccountDossier, buildOpportunityDossier } from "../src/commercial-intelligence/dossier/opportunity-dossier.js";
import { getMiCoachGovernanceSettings } from "../src/commercial-intelligence/service.js";

const USAGE = `Banco de aceptación del chat de Cliente existente.

  --check-facts                 Solo verifica que los hechos del banco coinciden con la base (sin IA).
  --check-dossier --user <id>   Verifica que el expediente contiene los hechos del banco (sin IA).
  --dump-dossiers               Con --check-dossier, guarda los expedientes en --out.
  --live --user <id>            Ejecuta las conversaciones con el chat real (llamadas de IA con coste).
  --judge-model <modelo>        Evalúa las respuestas con ese modelo (requiere tarifa registrada).
  --regrade <reporte.json>      Vuelve a evaluar un reporte existente sin ejecutar el chat.
  --conversation <A,B>          Limita las conversaciones.
  --engine dossier              Motor de chat a medir (el motor de expedientes es el único disponible).
  --analyst-model <modelo>      Modelo del analista para --engine dossier.
  --analyst-effort <nivel>      Esfuerzo de razonamiento opcional del analista (low, medium, high).
  --out <directorio>            Destino de los reportes (por defecto acceptance-runs/).
  --allow-drift                 Ejecuta aunque los hechos del banco no coincidan con la base.`;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
};
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const log = (message) => console.log(`[aceptacion] ${message}`);

function gitRevision() {
  try {
    const revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: apiRoot }).toString().trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "src"], { cwd: apiRoot }).toString().trim();
    return dirty ? `${revision} (con cambios sin commit en src)` : revision;
  } catch {
    return null;
  }
}

async function checkFacts(bank) {
  const results = await withReadOnlyConnection(pool, (run) => verifyBankFacts(bank, run));
  const failed = results.filter((item) => !item.ok);
  log(`Hechos verificados: ${results.length - failed.length}/${results.length}`);
  for (const item of failed) {
    log(`  DERIVA ${item.factId}: esperado ${JSON.stringify(item.expected)}, actual ${JSON.stringify(item.actual)}${item.reason ? ` (${item.reason})` : ""}`);
  }
  return { total: results.length, ok: results.length - failed.length, failed };
}

async function gradeReport(report, bank, { judgeModel, user }) {
  const byId = new Map(bank.conversations.map((conversation) => [conversation.id, conversation]));
  for (const conversationResult of report.conversations) {
    const conversation = byId.get(conversationResult.conversationId);
    if (!conversation) throw new Error(`El reporte contiene una conversación que ya no está en el banco: ${conversationResult.conversationId}`);
    const previousQuestions = [];
    for (const turnResult of conversationResult.turns) {
      const turn = conversation.turns.find((item) => item.id === turnResult.turnId);
      if (!turn || turn.question !== turnResult.question) {
        throw new Error(`El turno ${conversation.id}/${turnResult.turnId} cambió en el banco; ejecuta de nuevo el chat.`);
      }
      delete turnResult.judgeError;
      let judgement = null;
      if (judgeModel && turnResult.execution.answer) {
        try {
          log(`${conversation.id}/${turn.id}: evaluando`);
          judgement = await judgeTurn({ bank, turn, previousQuestions: [...previousQuestions],
            answer: turnResult.execution.answer, model: judgeModel, userId: user.id });
        } catch (error) {
          turnResult.judgeError = String(error?.message || error).slice(0, 500);
          log(`${conversation.id}/${turn.id}: error del evaluador: ${turnResult.judgeError}`);
        }
      }
      turnResult.grade = gradeTurn({ turn, execution: turnResult.execution, judgement });
      previousQuestions.push(turn.question);
    }
  }
  report.judgeModel = judgeModel;
  report.summary = summarizeRun(report);
  return report;
}

async function saveReport(report, outDir, suffix) {
  await mkdir(outDir, { recursive: true });
  const base = path.join(outDir, `${report.startedAt.replace(/[:.]/g, "-")}-${report.engine}${report.analystModel ? `-${report.analystModel}` : ""}${suffix}`);
  await writeFile(`${base}.json`, JSON.stringify(report, null, 2));
  await writeFile(`${base}.md`, renderMarkdownReport(report));
  log(`Reporte: ${base}.md`);
  return base;
}

async function checkDossier(bank, user, outDir) {
  const governance = await getMiCoachGovernanceSettings();
  const targets = dossierTargets(bank);
  const opportunityDossiers = new Map();
  const accountDossiers = new Map();
  for (const opportunityId of targets.opportunityIds) {
    const dossier = await withReadOnlyConnection(pool, (run) => buildOpportunityDossier({ user, opportunityId, governance, run }));
    opportunityDossiers.set(opportunityId, dossier);
    const statuses = Object.values(dossier.sections).map((section) => `${section.key}:${section.status}`).join(" ");
    log(`Expediente oportunidad ${opportunityId}: ~${dossier.size.approxTokens} tokens · ${statuses}`);
  }
  for (const accountId of targets.accountIds) {
    const dossier = await withReadOnlyConnection(pool, (run) => buildAccountDossier({ user, accountId, governance, run }));
    accountDossiers.set(accountId, dossier);
    log(`Expediente cuenta ${accountId}: ~${dossier.size.approxTokens} tokens`);
  }
  const results = checkDossierCoverage(bank, { opportunityDossiers, accountDossiers });
  const summary = summarizeCoverage(results);
  log(`Hechos en el expediente: ${summary.located}/${summary.total} · críticos ${summary.criticalLocated}/${summary.criticalTotal}`);
  for (const item of summary.missing) {
    log(`  FALTA ${item.factId}${item.critical ? " (crítico)" : ""}: ${item.reason}${item.actual !== undefined ? ` · actual ${JSON.stringify(item.actual)}` : ""}`);
  }
  if (flag("--dump-dossiers")) {
    await mkdir(outDir, { recursive: true });
    for (const [kind, dossiers] of [["oportunidad", opportunityDossiers], ["cuenta", accountDossiers]]) {
      for (const [id, dossier] of dossiers) {
        const file = path.join(outDir, `expediente-${kind}-${id}.json`);
        await writeFile(file, JSON.stringify(dossier, null, 2));
        log(`Expediente guardado: ${file}`);
      }
    }
  }
  return summary;
}

async function main() {
  if (flag("--help") || !args.length) {
    console.log(USAGE);
    return;
  }
  const bank = await loadAcceptanceBank();
  const outDir = path.resolve(apiRoot, option("--out", "acceptance-runs"));
  const judgeModel = option("--judge-model");
  const userId = Number(option("--user", process.env.CUSTOMER_CHAT_ACCEPTANCE_USER_ID || 0));

  if (flag("--check-facts")) {
    const factCheck = await checkFacts(bank);
    if (factCheck.failed.length) process.exitCode = 1;
    return;
  }
  if (!userId) throw new Error("Indica el usuario que ejecuta las conversaciones con --user <id>.");
  const user = await getUserAuthContext(userId);
  if (!user) throw new Error(`Usuario ${userId} no encontrado.`);
  if (flag("--check-dossier")) {
    const summary = await checkDossier(bank, user, outDir);
    if (summary.missing.length) process.exitCode = 1;
    return;
  }
  if (judgeModel) await withReadOnlyConnection(pool, (run) => assertModelPriced(run, judgeModel));

  const regradePath = option("--regrade");
  if (regradePath) {
    if (!judgeModel) throw new Error("--regrade requiere --judge-model.");
    const report = JSON.parse(await readFile(path.resolve(regradePath), "utf8"));
    await gradeReport(report, bank, { judgeModel, user });
    await saveReport(report, outDir, `-reevaluado-${judgeModel}`);
    return;
  }
  if (!flag("--live")) throw new Error("Requiere --live para autorizar llamadas de IA con coste.");

  const conversations = selectConversations(bank, String(option("--conversation", "")).split(",").filter(Boolean));
  const factCheck = await checkFacts(bank);
  if (factCheck.failed.length && !flag("--allow-drift")) {
    throw new Error("Los hechos del banco no coinciden con la base. Actualiza el banco o usa --allow-drift.");
  }
  const engine = option("--engine", "dossier");
  if (engine !== "dossier") throw new Error(`Motor desconocido: ${engine}. El flujo anterior fue retirado.`);
  config.openai.analystModel = option("--analyst-model", config.openai.analystModel);
  config.openai.analystReasoningEffort = option("--analyst-effort", config.openai.analystReasoningEffort);
  if (!config.openai.analystModel) throw new Error("--engine dossier requiere --analyst-model o OPENAI_ANALYST_MODEL.");
  for (const model of new Set([config.openai.analystModel, config.openai.routerModel])) {
    await withReadOnlyConnection(pool, (run) => assertModelPriced(run, model));
  }
  const report = {
    bankVersion: bank.version, engine, startedAt: new Date().toISOString(), gitRevision: gitRevision(),
    chatModel: config.openai.model, judgeModel: null, userId,
    ...(engine === "dossier" ? { analystModel: config.openai.analystModel, analystReasoningEffort: config.openai.analystReasoningEffort || null,
      routerModel: config.openai.routerModel } : {}),
    factCheck: { total: factCheck.total, ok: factCheck.ok, failed: factCheck.failed }, conversations: [],
  };
  for (const conversation of conversations) {
    report.conversations.push(await runConversation({ conversation, user, engine, log }));
  }
  const jobIds = report.conversations.flatMap((item) => item.turns.map((turn) => turn.execution.jobId)).filter(Boolean);
  const usage = await withReadOnlyConnection(pool, (run) => loadAiUsageByJob(run, jobIds));
  for (const turn of report.conversations.flatMap((item) => item.turns)) {
    if (turn.execution.jobId) turn.execution.aiUsage = usage.get(turn.execution.jobId) || null;
  }
  report.finishedAt = new Date().toISOString();
  await saveReport(report, outDir, "-respuestas");
  await gradeReport(report, bank, { judgeModel, user });
  await saveReport(report, outDir, judgeModel ? `-evaluado-${judgeModel}` : "-sin-evaluar");
}

main()
  .catch((error) => {
    console.error(`[aceptacion] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
