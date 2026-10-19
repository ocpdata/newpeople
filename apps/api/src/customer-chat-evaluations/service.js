import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { pool, query, withTransaction } from "../db.js";
import { config } from "../config.js";
import { getUserAuthContext } from "../auth.js";
import { getEvaluationCatalog, SMOKE_CASE_IDS } from "./catalog.js";
import { businessImpactForCase } from "./business-impact.js";
import { ensureEvaluationSchema } from "./schema.js";
import { evaluateResponse, safeEvidence, summarizeCases } from "./checks.js";
import {
  buildAuthorizedCustomerSnapshot, createCustomerAccountChatJob,
  processCustomerAccountChatJob, getCustomerIntelligenceJob,
  getCustomerSnapshotQueryMetrics,
} from "../commercial-intelligence/service.js";
import { getCoachBusinessRules, loadCoachBusinessRules } from "../coach/business-rules.js";
import { loadSemanticClassifierPrompt } from "../coach/semantic-classifier-prompts.js";
import { loadPlannerPrompt } from "../coach/planner-prompts.js";
import { loadChannelIntentConfigurations } from "../coach/channel-intent-governance.js";

export const evaluationRequestSchema = z.object({
  requestKey: z.string().uuid(), suite: z.enum(["smoke", "full", "selected"]).default("smoke"),
  caseIds: z.array(z.string().max(32)).max(400).default([]),
  repetitions: z.number().int().min(1).max(3).default(1),
  maxTurns: z.number().int().min(1).max(1200).default(100),
  maxMinutes: z.number().int().min(1).max(120).default(30),
  acknowledgePaidCalls: z.literal(true),
  parentId: z.string().uuid().optional(),
}).strict();

export const evaluationError = (status, message) => Object.assign(new Error(message), { status });
const parse = (value) => typeof value === "string" ? JSON.parse(value) : value;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
const digest = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const terminal = new Set(["completed", "cancelled", "interrupted", "failed"]);
export async function recordEvaluationEvent(runId, userId, type, metadata = {}, execute = query) {
  await execute("INSERT INTO customer_chat_evaluation_events(run_id,user_id,event_type,metadata_json) VALUES(?,?,?,?)",
    [runId, userId, type, JSON.stringify(safeEvidence(metadata))]);
}

export function requireEvaluationPermission(user, action = "read") {
  if (user?.status && user.status !== "active") throw evaluationError(403, "Usuario inactivo");
  if (!user?.permissionSet?.has("mi_coach.access") || !user.permissionSet.has(`mi_coach.evaluations_${action}`)) {
    throw evaluationError(403, "No tienes permiso para esta operación de evaluación.");
  }
}
function requireChat(user) {
  for (const permission of ["inteligencia_comercial.access", "inteligencia_comercial.read"]) {
    if (!user.permissionSet.has(permission)) throw evaluationError(403, `Falta ${permission}`);
  }
}
function reference(snapshot) {
  const metrics = getCustomerSnapshotQueryMetrics(snapshot);
  if (metrics.some((item) => item.errorCode)) throw evaluationError(502, "Falló una lectura de referencia; no se compararán datos incompletos como si fueran ausencia.");
  return safeEvidence({
    account: { id: snapshot.account?.id, name: snapshot.account?.name },
    opportunities: snapshot.opportunities?.map((item) => ({
      id: item.id, name: item.name, amountUsd: item.amountUsd, closeDate: item.closeDate,
      stageName: item.stageName, commercialStatusCode: item.commercialStatusCode, contactId: item.contactId,
    })),
    contacts: snapshot.contacts?.map((item) => ({ id: item.id, name: item.name, positionTitle: item.positionTitle })),
    activities: [...(snapshot.opportunityActivities || []), ...(snapshot.activities || [])].map((item) => ({
      id: item.id, opportunityId: item.opportunityId || item.opportunity_id, title: item.title,
      status: item.status, scheduledAt: item.scheduledAt || item.scheduled_at, updatedAt: item.updatedAt || item.updated_at,
    })),
    coverage: metrics,
  });
}
async function configurationFor(user) {
  const [rules, classifier, planner, intents] = await Promise.all([
    loadCoachBusinessRules({ channel: "customer_account", process: "default" }),
    loadSemanticClassifierPrompt({ channel: "customer_account" }),
    loadPlannerPrompt({ channel: "customer_account" }),
    loadChannelIntentConfigurations({ channel: "customer_account" }),
  ]);
  return { model: config.openai.model, rules: safeEvidence(rules), permissions: [...user.permissionSet].sort(),
    classifier: { version: classifier.version, hash: digest(classifier.instruction) },
    planner: { version: planner.version, hash: digest(planner.instruction) },
    intentsHash: digest(intents), evaluatorVersion: "1", applicationRevision: process.env.GIT_COMMIT || null };
}
export async function preflightEvaluation(user) {
  requireEvaluationPermission(user, "execute"); requireChat(user);
  const catalog = await getEvaluationCatalog();
  const accounts = [...new Set(catalog.cases.map((item) => item.accountId))];
  const checks = [];
  for (const accountId of accounts) {
    try {
      const snapshot = await buildAuthorizedCustomerSnapshot({ user, accountId, includeProviderCatalog: false });
      checks.push({ accountId, ready: Boolean(snapshot.account?.id), reference: reference(snapshot) });
    } catch (error) {
      if (![400, 403, 404, 422].includes(error.status)) throw error;
      checks.push({ accountId, ready: false, message: error.message });
    }
  }
  return { instance: "Instancia actual", userId: Number(user.id), model: config.openai.model,
    providerReady: Boolean(config.openai.apiKey), catalogVersion: catalog.version,
    cases: catalog.cases.length, accounts: checks, businessWrites: false,
    warning: "Llamadas reales de IA con costo. Se guardarán sesiones y resultados, sin confirmar cambios de negocio.",
    rules: (await configurationFor(user)).rules };
}
function selectCases(catalog, request) {
  if (request.suite === "selected") {
    if (!request.caseIds.length || request.caseIds.some((id) => !catalog.cases.some((item) => item.id === id))) {
      throw evaluationError(400, "Selecciona casos válidos del catálogo.");
    }
    return catalog.cases.filter((item) => request.caseIds.includes(item.id));
  }
  if (request.suite === "smoke") return SMOKE_CASE_IDS
    .map((id) => catalog.cases.find((item) => item.id === id)).filter(Boolean);
  return catalog.cases;
}
export async function createEvaluation(user, input) {
  requireEvaluationPermission(user, "read"); requireEvaluationPermission(user, "execute"); requireChat(user);
  const request = evaluationRequestSchema.parse(input);
  if (!config.openai.apiKey) throw evaluationError(422, "Falta la configuración del proveedor de IA.");
  const catalog = await getEvaluationCatalog();
  const selected = selectCases(catalog, request);
  if (!selected.length) throw evaluationError(422, "No hay casos seleccionados.");
  const runtime = await configurationFor(user);
  await ensureEvaluationSchema();
  const requestHash = digest(request);
  return withTransaction(async (conn) => {
    await conn.query("SELECT id FROM customer_chat_evaluation_control WHERE id=1 FOR UPDATE");
    await conn.query("SELECT id FROM users WHERE id=? FOR UPDATE", [Number(user.id)]);
    const [prior] = await conn.query("SELECT * FROM customer_chat_evaluation_runs WHERE user_id=? AND request_key=?", [user.id, request.requestKey]);
    if (prior.length) {
      if (prior[0].request_hash !== requestHash) throw evaluationError(409, "La clave ya pertenece a otra solicitud.");
      return { id: prior[0].id, reused: true };
    }
    if (request.parentId) {
      const [parents] = await conn.query("SELECT id FROM customer_chat_evaluation_runs WHERE id=? AND user_id=?", [request.parentId, user.id]);
      if (!parents.length) throw evaluationError(404, "La ejecución anterior no está disponible.");
    }
    const [active] = await conn.query("SELECT id FROM customer_chat_evaluation_runs WHERE status IN ('pending','running') LIMIT 1");
    if (active.length) throw evaluationError(409, "Ya hay una evaluación activa en esta instancia. Espera o solicita cancelarla.");
    const id = randomUUID();
    const settings = { ...request, catalogVersion: catalog.version, runtime, businessWrites: false,
      defaultRules: getCoachBusinessRules({ channel: "customer_account" }).operationPolicy };
    await conn.query(`INSERT INTO customer_chat_evaluation_runs
      (id,user_id,request_key,request_hash,parent_id,status,configuration) VALUES (?,?,?,?,?,'pending',?)`,
    [id, user.id, request.requestKey, requestHash, request.parentId || null, JSON.stringify(settings)]);
    let ordinal = 0;
    for (let repetition = 1; repetition <= request.repetitions; repetition += 1) {
      for (const definition of selected) {
        await conn.query(`INSERT INTO customer_chat_evaluation_cases
          (run_id,case_id,repetition,ordinal,definition_json) VALUES (?,?,?,?,?)`,
        [id, definition.id, repetition, ++ordinal, JSON.stringify(definition)]);
      }
    }
    await recordEvaluationEvent(id, user.id, "created", { suite: request.suite, cases: selected.length, repetitions: request.repetitions },
      async (...args) => (await conn.query(...args))[0]);
    return { id, reused: false };
  });
}
async function ownedRun(user, id) {
  requireEvaluationPermission(user);
  const rows = await query("SELECT * FROM customer_chat_evaluation_runs WHERE id=? AND user_id=?", [id, user.id]);
  if (!rows.length) throw evaluationError(404, "Evaluación no encontrada.");
  return { ...rows[0], configuration: parse(rows[0].configuration) };
}
function assertEvidencePermissions(user, run) {
  const original = run.configuration.runtime.permissions;
  if (original.some((permission) => /\.read(?:_all)?$/.test(permission) && !user.permissionSet.has(permission))) {
    throw evaluationError(403, "Se revocaron permisos de lectura usados por esta evaluación. No se mostrarán evidencias anteriores.");
  }
}
export async function listEvaluations(user, page = 1) {
  requireEvaluationPermission(user); await ensureEvaluationSchema();
  const rows = await query(`SELECT id,parent_id,status,created_at,finished_at,error_message FROM customer_chat_evaluation_runs
    WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET ?`, [user.id, (page - 1) * 20]);
  return { page, hasMore: rows.length > 20, runs: rows.slice(0, 20) };
}
export async function getEvaluation(user, id, page = 1) {
  await ensureEvaluationSchema();
  const run = await ownedRun(user, id);
  const rows = await query(`SELECT id,case_id,repetition,ordinal,status,review_json,started_at,finished_at,definition_json
    FROM customer_chat_evaluation_cases WHERE run_id=? ORDER BY ordinal LIMIT 51 OFFSET ?`, [id, (page - 1) * 50]);
  const counts = await query("SELECT status,COUNT(*) AS count FROM customer_chat_evaluation_cases WHERE run_id=? GROUP BY status", [id]);
  return { run: { id: run.id, parentId: run.parent_id, status: run.status, cancelRequested: Boolean(run.cancel_requested),
    configuration: safeEvidence(run.configuration), createdAt: run.created_at, finishedAt: run.finished_at, error: run.error_message },
    counts: Object.fromEntries(counts.map((item) => [item.status, Number(item.count)])),
    page, hasMore: rows.length > 50,
    cases: rows.slice(0, 50).map(({ definition_json, ...row }) => ({ ...row,
      businessImpact: parse(definition_json).businessImpact || businessImpactForCase(row.case_id), review: parse(row.review_json) })) };
}
export async function getEvaluationCase(user, runId, caseRowId) {
  await ensureEvaluationSchema();
  const run = await ownedRun(user, runId); assertEvidencePermissions(user, run);
  const rows = await query("SELECT * FROM customer_chat_evaluation_cases WHERE run_id=? AND id=?", [runId, caseRowId]);
  if (!rows.length) throw evaluationError(404, "Caso no encontrado.");
  const row = rows[0];
  requireChat(user);
  await buildAuthorizedCustomerSnapshot({ user, accountId: parse(row.definition_json).accountId, includeProviderCatalog: false });
  return { id: row.id, caseId: row.case_id, repetition: row.repetition, status: row.status,
    jobId: row.job_id, sessionId: row.session_id,
    definition: { ...parse(row.definition_json), businessImpact: parse(row.definition_json).businessImpact || businessImpactForCase(row.case_id) },
    result: safeEvidence(parse(row.result_json)), review: parse(row.review_json) };
}
export async function cancelEvaluation(user, id) {
  requireEvaluationPermission(user, "execute"); await ensureEvaluationSchema(); await ownedRun(user, id);
  await query("UPDATE customer_chat_evaluation_runs SET cancel_requested=1 WHERE id=? AND status IN ('pending','running')", [id]);
  await recordEvaluationEvent(id, user.id, "cancellation_requested");
  return { cancellationRequested: true, message: "Se detendrán los siguientes pasos; no se revierten efectos ni llamadas ya iniciadas." };
}
export async function reviewEvaluationCase(user, id, caseId, input) {
  requireEvaluationPermission(user, "execute"); await ensureEvaluationSchema(); await ownedRun(user, id);
  await getEvaluationCase(user, id, caseId);
  const review = z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().trim().min(10).max(4000) }).strict().parse(input);
  await withTransaction(async (conn) => {
    const [rows] = await conn.query("SELECT status,result_json FROM customer_chat_evaluation_cases WHERE run_id=? AND id=? FOR UPDATE", [id, caseId]);
    if (!rows.length || !["human_review", "failed"].includes(rows[0].status)) throw evaluationError(409, "Solo se revisan casos terminados con evidencia.");
    if (!parse(rows[0].result_json)?.steps?.length) throw evaluationError(409, "No hay evidencia conservada para aprobar este caso.");
    if (rows[0].status === "failed" && review.decision === "approved") throw evaluationError(409, "La revisión no puede aprobar un fallo automático.");
    await conn.query("UPDATE customer_chat_evaluation_cases SET review_json=? WHERE run_id=? AND id=?",
      [JSON.stringify({ ...review, userId: user.id, at: new Date().toISOString() }), id, caseId]);
    await recordEvaluationEvent(id, user.id, "case_reviewed", { caseId, ...review }, async (...args) => (await conn.query(...args))[0]);
  });
  return { reviewed: true };
}
export async function exportEvaluation(user, id) {
  await ensureEvaluationSchema(); const run = await ownedRun(user, id);
  assertEvidencePermissions(user, run);
  const rows = await query("SELECT * FROM customer_chat_evaluation_cases WHERE run_id=? ORDER BY ordinal", [id]);
  requireChat(user);
  for (const accountId of new Set(rows.map((row) => parse(row.definition_json).accountId))) {
    await buildAuthorizedCustomerSnapshot({ user, accountId, includeProviderCatalog: false });
  }
  const cases = rows.map((row) => ({ id: row.id, caseId: row.case_id, repetition: row.repetition, status: row.status,
    jobId: row.job_id, sessionId: row.session_id,
    definition: { ...parse(row.definition_json), businessImpact: parse(row.definition_json).businessImpact || businessImpactForCase(row.case_id) },
    result: parse(row.result_json), review: parse(row.review_json) }));
  const events = await query("SELECT event_type,metadata_json,created_at FROM customer_chat_evaluation_events WHERE run_id=? ORDER BY id", [id]);
  const actions = await query("SELECT case_row_id,account_id,operation_id,status,result_json FROM customer_chat_evaluation_actions WHERE run_id=?", [id]);
  return safeEvidence({ version: 1, runId: id, status: run.status, configuration: run.configuration,
    summary: summarizeCases(cases), cases, events: events.map((item) => ({ ...item, metadata_json: parse(item.metadata_json) })),
    actions: actions.map((item) => ({ ...item, result_json: parse(item.result_json) })) });
}

async function actorFor(run) {
  const user = await getUserAuthContext(run.user_id);
  requireEvaluationPermission(user, "execute"); requireEvaluationPermission(user); requireChat(user);
  return user;
}
async function finishCase(id, status, result, workerId) {
  const saved = await query(`UPDATE customer_chat_evaluation_cases c
    INNER JOIN customer_chat_evaluation_runs r ON r.id=c.run_id
    SET c.status=?,c.result_json=?,c.finished_at=NOW(3)
    WHERE c.id=? AND r.worker_id=? AND r.status='running'`,
  [status, JSON.stringify(safeEvidence(result)), id, workerId]);
  if (!saved.affectedRows) throw evaluationError(409, "El worker ya no es propietario del caso.");
}
export async function awaitEvaluationChat(work, timeoutMs) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(
        evaluationError(504, "El chat excedió el tiempo del paso. Su trabajo puede terminar después; no se repetirá automáticamente."),
        { code: "EVALUATION_CHAT_TIMEOUT" })), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
export async function processEvaluationRun(run, workerId) {
  const settings = parse(run.configuration);
  const deadline = Date.now() + settings.maxMinutes * 60000;
  let turns = 0;
  const rows = await query("SELECT * FROM customer_chat_evaluation_cases WHERE run_id=? ORDER BY ordinal", [run.id]);
  for (const row of rows) {
    if (row.status !== "pending") continue;
    const [current] = await query("SELECT cancel_requested,worker_id,status FROM customer_chat_evaluation_runs WHERE id=?", [run.id]);
    if (!current || current.worker_id !== workerId || current.status !== "running") throw evaluationError(409, "Se perdió la titularidad del trabajo.");
    await query("UPDATE customer_chat_evaluation_runs SET heartbeat_at=NOW(3) WHERE id=? AND worker_id=?", [run.id, workerId]);
    if (current.cancel_requested || Date.now() >= deadline || turns >= settings.maxTurns) {
      const message = current.cancel_requested ? "Cancelación solicitada" : "Límite de tiempo o mensajes alcanzado";
      await query("UPDATE customer_chat_evaluation_cases SET status='omitted',result_json=?,finished_at=NOW(3) WHERE run_id=? AND status='pending'",
        [JSON.stringify({ reason: message }), run.id]);
      await query("UPDATE customer_chat_evaluation_runs SET status=?,finished_at=NOW(3),error_message=? WHERE id=? AND worker_id=?",
        [current.cancel_requested ? "cancelled" : "interrupted", message, run.id, workerId]);
      return;
    }
    const definition = parse(row.definition_json);
    if (definition.blockedReason) { await finishCase(row.id, "omitted", { reason: definition.blockedReason }, workerId); continue; }
    const evidence = { steps: [], checks: [], referenceBefore: null, referenceAfter: null };
    try {
      const user = await actorFor(run);
      if (digest(await configurationFor(user)) !== digest(settings.runtime)) throw evaluationError(409, "Cambió la configuración o los permisos desde el lanzamiento.");
      if (definition.businessImpact?.kind === "validation" && !settings.runtime.rules.operationPolicy?.allowedKinds?.includes("validate_stage")) {
        throw evaluationError(409, "Precondición incumplida: validate_stage está deshabilitado. No se envió la pregunta ni se cambiaron permisos; habilitarlo requiere una decisión administrativa explícita.");
      }
      const before = reference(await buildAuthorizedCustomerSnapshot({ user, accountId: definition.accountId, includeProviderCatalog: false }));
      const expectedAccount = definition.accountId === 22 ? "Totalplay" : "Grupo Hotelero Santa Fe";
      if (before.account.name !== expectedAccount) throw evaluationError(409, `El catálogo requiere la cuenta ${expectedAccount}; verifica sus referencias antes de ejecutar.`);
      evidence.referenceBefore = before;
      await query("UPDATE customer_chat_evaluation_cases SET status='running',started_at=NOW(3) WHERE id=?", [row.id]);
      let sessionId;
      for (const step of definition.steps) {
        const stepStartedAt = Date.now();
        const [freshRun] = await query("SELECT cancel_requested,worker_id,status FROM customer_chat_evaluation_runs WHERE id=?", [run.id]);
        if (freshRun.worker_id !== workerId || freshRun.status !== "running") throw evaluationError(409, "Se perdió la titularidad del trabajo.");
        if (freshRun.cancel_requested || Date.now() >= deadline || turns >= settings.maxTurns) {
          throw Object.assign(evaluationError(409, "Ejecución detenida antes del siguiente mensaje."),
            { code: "EVALUATION_STOPPED", stopStatus: freshRun.cancel_requested ? "cancelled" : "interrupted" });
        }
        const actor = await actorFor(run);
        const { job } = await createCustomerAccountChatJob({ user: actor, payload: {
          accountId: definition.accountId, question: step.question, includePublicResearch: false,
          ...(sessionId ? { chatSessionId: sessionId } : {}),
        } });
        turns += 1; sessionId = job.chatSessionId;
        await query("UPDATE customer_chat_evaluation_cases SET job_id=?,session_id=? WHERE id=?", [job.id, sessionId, row.id]);
        await awaitEvaluationChat(processCustomerAccountChatJob({ jobId: job.id, user: actor,
          deadlineAt: Math.min(deadline, Date.now() + 90000) }),
          Math.max(1, Math.min(90000, deadline - Date.now())));
        await query("UPDATE customer_chat_evaluation_runs SET heartbeat_at=NOW(3) WHERE id=? AND worker_id=?", [run.id, workerId]);
        const finished = await getCustomerIntelligenceJob({ user: actor, jobId: job.id });
        if (!finished || finished.status !== "completed") {
          evidence.jobFailure = safeEvidence(finished?.result?.debug?.currentTurn?.diagnostics || null);
          throw Object.assign(evaluationError(502, finished?.errorMessage || "El chat no confirmó una respuesta completada."),
            { code: finished?.result?.errorCode || "EVALUATION_CHAT_JOB_FAILED" });
        }
        const checked = evaluateResponse({ definition, result: finished.result, accountId: definition.accountId, reference: before });
        evidence.steps.push({ question: step.question, expected: step.expected, answer: finished.result.answer,
          responseType: finished.result.responseType, errorCode: finished.result.errorCode, operations: finished.result.operations,
          activityHistory: finished.result.activityHistory,
          relationshipStatus: finished.result.relationshipStatus,
          stageReadiness: finished.result.stageReadiness,
          stageReadinessPrinciple: finished.result.stageReadinessPrinciple,
          accountSummary: finished.result.accountSummary,
          documentCoverage: finished.result.documentCoverage,
          documentEvidence: finished.result.documentEvidence,
          evidence: finished.result.evidence, components: finished.result.components, evaluationOutcome: checked.outcome,
          jobId: job.id, sessionId, durationMs: Date.now() - stepStartedAt, checks: checked.checks });
        evidence.checks.push(...checked.checks);
        await query("UPDATE customer_chat_evaluation_cases SET result_json=? WHERE id=?", [JSON.stringify(safeEvidence(evidence)), row.id]);
      }
      const afterUser = await actorFor(run);
      evidence.referenceAfter = reference(await buildAuthorizedCustomerSnapshot({ user: afterUser, accountId: definition.accountId, includeProviderCatalog: false }));
      const referenceChanged = digest(evidence.referenceBefore) !== digest(evidence.referenceAfter);
      const capabilityBlocked = evidence.steps.some((step) => step.evaluationOutcome === "inconclusive");
      const status = referenceChanged ? "inconclusive"
        : evidence.steps.some((step) => step.evaluationOutcome === "failed") ? "failed"
          : capabilityBlocked ? "inconclusive" : "human_review";
      evidence.reason = referenceChanged ? "Los datos de referencia cambiaron durante el caso."
        : status === "failed" ? `Fallaron las comprobaciones: ${evidence.checks.filter((check) => !check.passed).map((check) => check.name).join("; ")}.`
          : capabilityBlocked ? "La capacidad está deshabilitada o faltan permisos; no se evaluó el escenario positivo."
        : "Revisar exactitud y utilidad contra las expectativas y datos vigentes. Las comprobaciones automáticas no bastan para aprobar semántica.";
      await finishCase(row.id, status, evidence, workerId);
    } catch (error) {
      console.error("[customer-chat-evaluation] Case failed", { runId: run.id, caseId: definition.id, message: error.message });
      await finishCase(row.id, error.code === "CUSTOMER_TURN_CONTRACT_INVALID" ? "failed" : error.status === 409 ? "inconclusive" : "environment_error",
        { ...evidence, errorCode: error.code || null, reason: error.message }, workerId);
      if (["EVALUATION_CHAT_TIMEOUT", "EVALUATION_STOPPED"].includes(error.code)) {
        await query("UPDATE customer_chat_evaluation_cases SET status='omitted',result_json=?,finished_at=NOW(3) WHERE run_id=? AND status='pending'",
          [JSON.stringify({ reason: error.message }), run.id]);
        await query("UPDATE customer_chat_evaluation_runs SET status=?,finished_at=NOW(3),error_message=? WHERE id=? AND worker_id=?",
          [error.stopStatus || "interrupted", error.message, run.id, workerId]);
        return;
      }
    }
  }
  await query("UPDATE customer_chat_evaluation_runs SET status=IF(cancel_requested=1,'cancelled','completed'),finished_at=NOW(3) WHERE id=? AND worker_id=?",
    [run.id, workerId]);
}

export async function processPendingEvaluations() {
  await ensureEvaluationSchema();
  const conn = await pool.getConnection();
  const workerId = randomUUID();
  let locked = false;
  try {
    const [locks] = await conn.query("SELECT GET_LOCK('newpeople_customer_chat_evaluation',0) AS acquired");
    if (!Number(locks[0].acquired)) return;
    locked = true;
    await query(`UPDATE customer_chat_evaluation_cases c INNER JOIN customer_chat_evaluation_runs r ON r.id=c.run_id
      SET c.result_json=JSON_OBJECT('reason','Evidencia expirada: retención de 30 días')
      WHERE r.finished_at < DATE_SUB(NOW(),INTERVAL 30 DAY)
      AND NOT EXISTS (SELECT 1 FROM customer_chat_evaluation_actions a WHERE a.run_id=r.id)`);
    await query(`UPDATE customer_chat_evaluation_cases c INNER JOIN customer_chat_evaluation_runs r ON r.id=c.run_id
      SET c.status='inconclusive',c.result_json=JSON_SET(COALESCE(c.result_json,JSON_OBJECT()),
      '$.reason','Worker interrumpido; no se repite el paso automáticamente','$.reconciliationRequired',true),
      c.finished_at=NOW(3) WHERE r.status='running' AND c.status='running'`);
    await query(`UPDATE customer_chat_evaluation_cases c INNER JOIN customer_chat_evaluation_runs r ON r.id=c.run_id
      SET c.status='omitted',c.result_json=JSON_OBJECT('reason','Ejecución interrumpida'),c.finished_at=NOW(3)
      WHERE r.status='running' AND c.status='pending'`);
    await query("UPDATE customer_chat_evaluation_runs SET status='interrupted',finished_at=NOW(3),error_message='Worker interrumpido; revisar trabajos vinculados' WHERE status='running'");
    const [run] = await query("SELECT * FROM customer_chat_evaluation_runs WHERE status='pending' ORDER BY created_at LIMIT 1");
    if (!run) return;
    await query("UPDATE customer_chat_evaluation_runs SET status='running',worker_id=?,heartbeat_at=NOW(3) WHERE id=?", [workerId, run.id]);
    try { await processEvaluationRun(run, workerId); }
    catch (error) {
      console.error("[customer-chat-evaluation] Run failed", { runId: run.id, message: error.message });
      await query("UPDATE customer_chat_evaluation_runs SET status='failed',finished_at=NOW(3),error_message=? WHERE id=? AND worker_id=?", [error.message, run.id, workerId]);
    }
  } finally {
    try { if (locked) await conn.query("SELECT RELEASE_LOCK('newpeople_customer_chat_evaluation')"); }
    finally { conn.release(); }
  }
}
export { terminal };
