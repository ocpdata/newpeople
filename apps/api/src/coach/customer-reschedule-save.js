import { withTransaction } from "../db.js";
import { ensureCoachSchema } from "./schema.js";
import { mapCoachOperationRow, appendCoachOperationEvent } from "./service.js";
import { checkCustomerRescheduleAccess } from "./customer-reschedule-access.js";
import { logAuditEvent } from "../audit.js";

export async function saveCustomerReschedule({ req, token, opportunityId, version }) {
  await ensureCoachSchema();
  const fail = (status, message) => { throw Object.assign(new Error(message), { status, code: "COACH_RESCHEDULE_CONFLICT" }); };
  return withTransaction(async (conn) => {
    const execute = async (sql, args) => (await conn.query(sql, args))[0];
    const rows = await execute("SELECT * FROM coach_session_operations WHERE handoff_token=? AND user_id=? FOR UPDATE", [token, Number(req.user.id)]);
    const saved = rows[0] ? mapCoachOperationRow(rows[0]) : null;
    const operation = saved?.pendingOperation;
    if (saved?.kind !== "reschedule_activity" || saved.targetModule !== "calendar" ||
        operation.opportunityId !== opportunityId) fail(404, "No existe esta propuesta para la oportunidad");
    const access = await checkCustomerRescheduleAccess(req.user, operation, { execute, lock: true, compareCurrent: saved.status !== "completed" });
    if (access) fail(access.status, access.message);
    if (saved.status === "completed") return saved;
    if (saved.status !== "handed_off" || new Date(saved.handoffExpiresAt).getTime() <= Date.now()) fail(409, "El traslado expiró, fue cancelado o atendido");
    if (saved.version !== version) fail(409, "La revisión cambió. Vuelve a cargar la propuesta");
    const [update] = await conn.query(`UPDATE opportunity_workspace_actions SET scheduled_at=?,due_date=?,updated_by_user_id=?,updated_at=NOW(3)
      WHERE id=? AND opportunity_id=? AND status='pending'`,
    [new Date(operation.proposedAt), operation.proposedDueDate, Number(req.user.id), operation.activityId, opportunityId]);
    if (update.affectedRows !== 1) fail(409, "La actividad cambió o ya no está pendiente");
    const before = JSON.parse(operation.observedVersion);
    const auditId = await logAuditEvent({ connection: conn, required: true, req, module: "opportunities.workspace",
      action: "workspace_activity_rescheduled", entityType: "opportunity", entityId: opportunityId,
      detail: "Reprogramación A06 confirmada en Calendario",
      before: { activity_id: operation.activityId, scheduled_at: before.scheduledAt, due_date: before.dueDate },
      after: { activity_id: operation.activityId, scheduled_at: operation.proposedAt, due_date: operation.proposedDueDate,
        time_zone: operation.scheduleSummary.timeZone } });
    await execute("UPDATE audit_log SET coach_operation_id=? WHERE id=?", [saved.id, auditId]);
    const result = { entityType: "opportunity", entityId: opportunityId, activityId: operation.activityId, auditId,
      before: operation.scheduleSummary.before, after: operation.scheduleSummary.after };
    await execute(`UPDATE coach_session_operations SET status='completed',result_payload=?,domain_audit_id=?,
      completed_at=NOW(3),version=version+1,updated_at=NOW(3) WHERE id=?`, [JSON.stringify(result), auditId, saved.id]);
    await appendCoachOperationEvent({ operationId: saved.id, sessionId: saved.sessionId, userId: req.user.id,
      eventType: "completed", fromStatus: saved.status, toStatus: "completed", source: "handoff",
      domainModule: "calendar", domainEntityType: "opportunity", domainEntityId: opportunityId,
      domainAuditId: auditId, eventKey: `reschedule-completed:${saved.id}` }, execute);
    return mapCoachOperationRow((await execute("SELECT * FROM coach_session_operations WHERE id=?", [saved.id]))[0]);
  });
}
