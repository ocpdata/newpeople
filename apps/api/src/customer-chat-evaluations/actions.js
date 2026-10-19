import { z } from "zod";
import { query, pool } from "../db.js";
import { config } from "../config.js";
import { getEvaluationCase, getEvaluation, requireEvaluationPermission, evaluationError, recordEvaluationEvent } from "./service.js";
import { safeEvidence } from "./checks.js";

const requestSchema = z.object({
  operationIndex: z.number().int().min(0).max(20), accountId: z.number().int().positive(),
  acknowledgeBusinessWrite: z.literal(true),
}).strict();
const controlled = new Set(["account_field", "contact_field", "opportunity_field", "stage_answer", "lead_call_outcome"]);
const handoffs = new Set(["link_contact_to_opportunity", "reschedule_activity", "validate_stage", "create_contact", "create_opportunity", "activity"]);
export async function callCurrentInstance(req, path, body) {
  if (!path.startsWith("/api/") || path.includes("..") || path.includes("://")) throw evaluationError(400, "Ruta interna inválida.");
  if (!req.headers.authorization?.startsWith("Bearer ")) throw evaluationError(401, "La confirmación requiere la sesión autenticada.");
  const response = await fetch(`http://127.0.0.1:${config.port}${path}`, {
    method: body === undefined ? "GET" : "POST", redirect: "error",
    headers: { Authorization: req.headers.authorization, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  if (!response.ok) throw evaluationError(response.status, data.message || "La operación del módulo fue rechazada.");
  return data;
}
export async function confirmEvaluationAction(req, runId, caseRowId, input) {
  const user = req.user;
  requireEvaluationPermission(user, "execute"); requireEvaluationPermission(user, "write");
  const request = requestSchema.parse(input);
  const { run } = await getEvaluation(user, runId);
  if (["running", "pending"].includes(run.status)) throw evaluationError(409, "Espera a que termine el lote antes de confirmar acciones.");
  const item = await getEvaluationCase(user, runId, caseRowId);
  if (item.status !== "human_review" || item.review?.decision !== "approved") {
    throw evaluationError(409, "Primero revisa y aprueba la semántica de este caso sin fallos automáticos.");
  }
  const operation = item.result?.steps?.at(-1)?.operations?.[request.operationIndex];
  if (!operation || !controlled.has(operation.kind) && !handoffs.has(operation.kind)) throw evaluationError(422, "No existe una acción confirmable de este tipo.");
  if (Number(operation.accountId) !== request.accountId || request.accountId !== item.definition.accountId) {
    throw evaluationError(403, "La cuenta autorizada debe coincidir exactamente con el escenario y la propuesta.");
  }
  if (operation.missingFields?.length) throw evaluationError(422, "La propuesta está incompleta; no se inventarán campos para ejecutarla.");
  const actionKey = `${runId}:${caseRowId}:${request.operationIndex}`;
  const conn = await pool.getConnection();
  let locked = false;
  try {
    const [locks] = await conn.query("SELECT GET_LOCK(?,0) AS acquired", [`eval-action:${caseRowId}`]);
    if (!Number(locks[0].acquired)) throw evaluationError(409, "Ya hay una confirmación en curso.");
    locked = true;
    const existing = await query("SELECT * FROM customer_chat_evaluation_actions WHERE action_key=?", [actionKey]);
    if (existing.length) {
      const action = existing[0];
      if (!["completed", "submitted", "module_review_required"].includes(action.status)) {
        throw evaluationError(409, "La confirmación ya fue iniciada. Consulta su estado; no se repetirá automáticamente.");
      }
      return typeof action.result_json === "string" ? JSON.parse(action.result_json) : action.result_json;
    }
    await conn.beginTransaction();
    try {
      await conn.query(`INSERT INTO customer_chat_evaluation_actions
        (action_key,run_id,case_row_id,user_id,account_id,status,proposal_json) VALUES (?,?,?,?,?,'started',?)`,
      [actionKey, runId, caseRowId, user.id, request.accountId, JSON.stringify(safeEvidence(operation))]);
      await recordEvaluationEvent(runId, user.id, "business_write_authorized", { caseRowId, operationIndex: request.operationIndex,
        accountId: request.accountId, kind: operation.kind }, async (...args) => (await conn.query(...args))[0]);
      await conn.commit();
    } catch (error) { await conn.rollback(); throw error; }
    try {
      const proposed = await callCurrentInstance(req, "/api/mi-agent/coach/operations", {
        originChannel: "customer_account", context: { accountId: request.accountId },
        operation,
      });
      const saved = proposed.operation;
      if (!saved?.id) throw evaluationError(502, "El módulo no confirmó la propuesta persistida.");
      await query("UPDATE customer_chat_evaluation_actions SET operation_id=? WHERE action_key=?", [saved.id, actionKey]);
      let result;
      if (controlled.has(operation.kind)) {
        const reviewed = await callCurrentInstance(req, `/api/mi-agent/coach/operations/${saved.id}/review`, { version: saved.version });
        result = await callCurrentInstance(req, `/api/mi-agent/coach/operations/${saved.id}/execute`, {
          version: reviewed.operation.version, idempotencyKey: actionKey,
        });
        if (result.operation?.status !== "completed") throw evaluationError(502, "El ejecutor no confirmó la escritura.");
      } else {
        const transferred = await callCurrentInstance(req, `/api/mi-agent/coach/operations/${saved.id}/handoff`, {});
        if (!transferred.handoff?.token) throw evaluationError(502, "No se confirmó el traslado al módulo.");
        if (["create_contact", "create_opportunity", "activity"].includes(operation.kind)) {
          result = { outcome: "module_review_required", handoff: transferred.handoff,
            message: "Continúa en el formulario existente para completar y guardar. El traslado no acredita una escritura ni una prueba de persistencia aprobada." };
        } else {
          const domainPath = operation.kind === "validate_stage" ? "coach-stage-validation"
            : operation.kind === "reschedule_activity" ? "coach-reschedule" : "coach-contact";
          result = await callCurrentInstance(req, `/api/opportunities/${operation.opportunityId}/${domainPath}`, {
            token: transferred.handoff.token, version: transferred.operation.version,
          });
          if (operation.kind === "validate_stage") {
            if (!result.job?.id) throw evaluationError(502, "El validador no confirmó el trabajo.");
            result = { ...result, outcome: "validation_pending", handoff: transferred.handoff };
          } else if (result.operation?.status !== "completed") throw evaluationError(502, "El módulo no confirmó la escritura.");
        }
      }
      const status = result.outcome === "validation_pending" ? "submitted"
        : result.outcome === "module_review_required" ? "module_review_required" : "completed";
      await query("UPDATE customer_chat_evaluation_actions SET status=?,result_json=?,finished_at=NOW(3) WHERE action_key=?",
        [status, JSON.stringify(safeEvidence(result)), actionKey]);
      return safeEvidence(result);
    } catch (error) {
      await query("UPDATE customer_chat_evaluation_actions SET status='uncertain',result_json=? WHERE action_key=?",
        [JSON.stringify({ message: error.message, reconciliationRequired: true }), actionKey]);
      console.error("[customer-chat-evaluation] Action requires reconciliation", { actionKey, message: error.message });
      throw error;
    }
  } finally {
    try { if (locked) await conn.query("SELECT RELEASE_LOCK(?)", [`eval-action:${caseRowId}`]); }
    finally { conn.release(); }
  }
}
export async function readEvaluationActions(req, runId, caseRowId) {
  await getEvaluationCase(req.user, runId, caseRowId);
  const rows = await query("SELECT * FROM customer_chat_evaluation_actions WHERE run_id=? AND case_row_id=? ORDER BY created_at",
    [runId, caseRowId]);
  const results = [];
  for (const row of rows) {
    const proposal = typeof row.proposal_json === "string" ? JSON.parse(row.proposal_json) : row.proposal_json;
    let result = typeof row.result_json === "string" ? JSON.parse(row.result_json) : row.result_json;
    if (proposal.kind === "validate_stage" && result?.handoff?.token) {
      result = { ...result, ...await callCurrentInstance(req,
        `/api/opportunities/${proposal.opportunityId}/coach-stage-validation/${result.handoff.token}`) };
    } else if (row.operation_id) {
      result = { ...result, ...await callCurrentInstance(req, `/api/mi-agent/coach/operations/${row.operation_id}`) };
    }
    results.push({ key: row.action_key, status: row.status, proposal: safeEvidence(proposal), result: safeEvidence(result) });
  }
  return { actions: results, warning: "Consultar el estado no repite escrituras. Las auditorías y trabajos iniciados se conservan." };
}
