import { withTransaction } from "../db.js";
import { ensureCoachSchema } from "./schema.js";
import { mapCoachOperationRow, appendCoachOperationEvent } from "./service.js";
import { checkCustomerLinkAccess } from "./customer-link-access.js";
import { mutateAuditedOpportunity } from "../opportunity-audit.js";
import { logAuditEvent } from "../audit.js";
import { hasAnyPermission } from "./operation-policy.js";

export async function saveCustomerLinkHandoff({ req, token, opportunityId, version }) {
  await ensureCoachSchema();
  const fail = (status, message) => { throw Object.assign(new Error(message), { status, code: "COACH_LINK_CONFLICT" }); };
  if (!hasAnyPermission(req.user, ["mi_coach.access"]) || !hasAnyPermission(req.user, ["inteligencia_comercial.access"])) {
    fail(403, "Ya no tienes acceso al canal de origen del vínculo");
  }
  return withTransaction(async (conn) => {
    const execute = async (sql, args) => (await conn.query(sql, args))[0];
    const rows = await execute("SELECT * FROM coach_session_operations WHERE handoff_token=? AND user_id=? FOR UPDATE", [token, Number(req.user.id)]);
    const saved = rows[0] ? mapCoachOperationRow(rows[0]) : null;
    const operation = saved?.pendingOperation;
    if (!operation?.linkDraftId || saved.targetModule !== "opportunities" || operation.opportunityId !== opportunityId) fail(404, "No existe este borrador de vínculo para la oportunidad");
    const access = await checkCustomerLinkAccess(req.user, operation, { execute, lock: true, compareCurrent: saved.status !== "completed" });
    if (access) fail(access.status, access.message);
    if (saved.status === "completed") return saved;
    if (saved.status !== "handed_off" || new Date(saved.handoffExpiresAt).getTime() <= Date.now()) fail(409, "El traslado fue atendido, cancelado o expiró");
    if (saved.version !== version) fail(409, "La revisión cambió en otra ventana. Vuelve a cargar el borrador");
    if (operation.currentContactId === operation.contactId) fail(409, "El vínculo ya existe; no hay cambio que guardar");
    await mutateAuditedOpportunity({ connection: conn, opportunityId, req },
      "UPDATE opportunities SET contact_id=?, updated_by=?, updated_at=NOW(3) WHERE id=?",
      [operation.contactId, Number(req.user.id), opportunityId]);
    const auditId = await logAuditEvent({ connection: conn, required: true, req, module: "oportunidades", action: "updated",
      entityType: "opportunity", entityId: opportunityId, detail: "Vínculo contacto-oportunidad A04 confirmado en Oportunidades",
      before: { contact_id: operation.currentContactId }, after: { contact_id: operation.contactId } });
    await execute("UPDATE audit_log SET coach_operation_id=? WHERE id=?", [saved.id, auditId]);
    const result = { entityType: "opportunity", entityId: opportunityId, before: operation.currentContactId, after: operation.contactId, auditId };
    await execute(`UPDATE coach_session_operations SET status='completed', result_payload=?, domain_audit_id=?,
      completed_at=NOW(3), version=version+1, updated_at=NOW(3) WHERE id=?`, [JSON.stringify(result), auditId, saved.id]);
    await appendCoachOperationEvent({ operationId: saved.id, sessionId: saved.sessionId, userId: req.user.id,
      eventType: "completed", fromStatus: saved.status, toStatus: "completed", source: "handoff",
      domainModule: "opportunities", domainEntityType: "opportunity", domainEntityId: opportunityId, domainAuditId: auditId,
      eventKey: `link-completed:${saved.id}` }, execute);
    return mapCoachOperationRow((await execute("SELECT * FROM coach_session_operations WHERE id=?", [saved.id]))[0]);
  });
}
