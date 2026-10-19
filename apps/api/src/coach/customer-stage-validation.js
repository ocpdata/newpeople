import { withTransaction } from "../db.js";
import { ensureCoachSchema } from "./schema.js";
import { mapCoachOperationRow, appendCoachOperationEvent } from "./service.js";
import { checkCustomerStageAccess, stageError, readCustomerStages } from "./customer-stage-access.js";
import { ensureOpportunityStageValidationJobSchema } from "../opportunity-stage-validations/schema.js";
import { createOrReuseOpportunityStageValidationJob, getOpportunityStageValidationJob } from "../opportunity-stage-validations/service.js";
import { queueOpportunityStageValidationProcessing } from "../opportunity-stage-validations/async.js";

async function load(conn, user, token, opportunityId) {
  const execute = async (...args) => (await conn.query(...args))[0];
  const rows = await execute("SELECT * FROM coach_session_operations WHERE handoff_token=? AND user_id=? FOR UPDATE", [token, Number(user.id)]);
  const saved = rows[0] ? mapCoachOperationRow(rows[0]) : null;
  if (saved?.kind !== "validate_stage" || saved.targetModule !== "opportunities" ||
      saved.pendingOperation.opportunityId !== opportunityId) throw stageError(404, "No existe esta solicitud de validación");
  const access = await checkCustomerStageAccess(user, saved.pendingOperation, {
    execute, lock: true, compareCurrent: !saved.result?.validationJobId,
  });
  if (access) throw stageError(access.status, access.message);
  if (!["handed_off", "completed"].includes(saved.status)) throw stageError(409, "La solicitud fue cancelada o cerrada");
  if (!saved.result?.validationJobId && new Date(saved.handoffExpiresAt).getTime() <= Date.now()) throw stageError(409, "El traslado expiró. Revisa nuevamente en el chat");
  return { saved, execute };
}

export async function startCustomerStageValidation({ user, token, opportunityId, version }) {
  await ensureCoachSchema();
  await ensureOpportunityStageValidationJobSchema();
  const result = await withTransaction(async (conn) => {
    const { saved, execute } = await load(conn, user, token, opportunityId);
    if (saved.result?.validationJobId) {
      const response = await getOpportunityStageValidationJob({ publicId: saved.result.validationJobId, opportunityId });
      if (!response) throw stageError(404, "No se encontró el trabajo vinculado; no se iniciará otro automáticamente");
      return { response, wasReused: true };
    }
    if (saved.version !== version) throw stageError(409, "La revisión cambió. Carga nuevamente la solicitud");
    // The existing validator owns prerequisites, evidence, decisions and automatic advancement.
    const job = await createOrReuseOpportunityStageValidationJob({ opportunityId, requestedByUserId: Number(user.id), note: "" });
    const jobId = job.response?.job?.id;
    if (!jobId) throw stageError(502, "El validador no devolvió un identificador de trabajo");
    await execute(`UPDATE coach_session_operations SET result_payload=?,version=version+1,updated_at=NOW(3) WHERE id=?`,
    [JSON.stringify({ validationJobId: jobId, outcome: "validation_pending" }), saved.id]);
    await appendCoachOperationEvent({ operationId: saved.id, sessionId: saved.sessionId, userId: user.id,
      eventType: "execution_started", fromStatus: saved.status, toStatus: saved.status, source: "domain_module",
      domainModule: "opportunities", domainEntityType: "opportunity", domainEntityId: opportunityId,
      eventKey: `stage-job:${saved.id}`, metadata: { validationJobId: jobId } }, execute);
    return job;
  });
  if (!result.wasReused || result.response?.job?.status === "pending") queueOpportunityStageValidationProcessing();
  return result.response;
}

export async function readCustomerStageValidation({ user, token, opportunityId }) {
  await ensureCoachSchema();
  return withTransaction(async (conn) => {
    const { saved, execute } = await load(conn, user, token, opportunityId);
    if (!saved.result?.validationJobId) return { operation: saved, validation: null };
    if (saved.status === "completed") return { operation: saved, validation: saved.result.validation };
    const validation = await getOpportunityStageValidationJob({ publicId: saved.result.validationJobId, opportunityId });
    if (!validation) throw stageError(404, "No se encontró el trabajo vinculado");
    if (!validation.result) return { operation: saved, validation };
    const result = validation.result;
    if (!["ready_to_advance", "advance_with_caution", "not_ready_to_advance"].includes(result.validation?.decision) ||
        typeof result.autoAdvanced !== "boolean" ||
        (result.autoAdvanced && Number(result.advancedSalesStage?.id) !== saved.pendingOperation.stageSummary.targetStageId)) {
      throw stageError(409, "El resultado no coincide con la solicitud. Revísalo en Oportunidades; no se acredita un avance desde el chat");
    }
    const data = await readCustomerStages({ user, accountId: saved.pendingOperation.accountId, execute, lock: true });
    const currentStageId = Number(data.opportunities.find((item) => Number(item.id) === opportunityId)?.stageId);
    const outcome = result.autoAdvanced && currentStageId === Number(result.advancedSalesStage.id)
      ? "advanced" : result.autoAdvanced ? "stage_changed_after_validation" : "validated_without_advance";
    const linkedResult = { validationJobId: saved.result.validationJobId, outcome, currentStageId, validation };
    await execute(`UPDATE coach_session_operations SET status='completed',result_payload=?,completed_at=NOW(3),
      version=version+1,updated_at=NOW(3) WHERE id=?`, [JSON.stringify(linkedResult), saved.id]);
    await appendCoachOperationEvent({ operationId: saved.id, sessionId: saved.sessionId, userId: user.id,
      eventType: "completed", fromStatus: saved.status, toStatus: "completed", source: "domain_module",
      domainModule: "opportunities", domainEntityType: "opportunity", domainEntityId: opportunityId,
      eventKey: `stage-completed:${saved.id}`, metadata: { outcome, validationJobId: saved.result.validationJobId } }, execute);
    return { operation: mapCoachOperationRow((await execute("SELECT * FROM coach_session_operations WHERE id=?", [saved.id]))[0]), validation };
  });
}
