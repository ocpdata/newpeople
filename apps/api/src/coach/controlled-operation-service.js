import { randomUUID } from "node:crypto";
import { buildChangedFields } from "../audit.js";
import { withTransaction } from "../db.js";
import {
  getControlledCoachOperationPolicy,
  hasAnyPermission,
  validateControlledCoachOperation,
} from "./operation-policy.js";
import { appendCoachOperationEvent, mapCoachOperationRow } from "./service.js";

const FIELD_DEFINITIONS = {
  account_field: {
    table: "accounts",
    columns: {
      name: "name",
      phone: "phone",
      website: "website",
      city: "city",
      stateRegion: "state_region",
      companyDescription: "description",
    },
  },
  contact_field: {
    table: "contacts",
    columns: {
      firstName: "first_name",
      lastName: "last_name",
      email: "email",
      mobile: "mobile",
      phone: "phone",
      positionTitle: "position_title",
      department: "department",
      city: "city",
      stateRegion: "state_region",
      hierarchyLevelId: "hierarchy_level_id",
      relationshipTypeId: "relationship_type_id",
      influenceLevelId: "influence_level_id",
      managerContactId: "manager_contact_id",
      influencesContactId: "influences_contact_id",
    },
  },
  opportunity_field: {
    table: "opportunities",
    columns: {
      name: "name",
      amountUsd: "amount_usd",
      closeDate: "close_date",
    },
  },
};

const NUMERIC_CONTACT_FIELDS = new Set([
  "hierarchyLevelId",
  "relationshipTypeId",
  "influenceLevelId",
  "managerContactId",
  "influencesContactId",
]);

export class CoachOperationError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "CoachOperationError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function normalizeComparable(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value === undefined || value === "") return null;
  return value;
}

function valuesEqual(left, right) {
  return (
    JSON.stringify(normalizeComparable(left)) ===
    JSON.stringify(normalizeComparable(right))
  );
}

function normalizeFieldValue(kind, field, value) {
  if (kind === "opportunity_field" && field === "amountUsd") {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new CoachOperationError(
        400,
        "COACH_VALUE_INVALID",
        "El importe de la oportunidad no es válido",
      );
    }
    return amount;
  }
  if (kind === "opportunity_field" && field === "closeDate") {
    const date = value === null || value === "" ? null : String(value).trim();
    if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new CoachOperationError(
        400,
        "COACH_VALUE_INVALID",
        "La fecha de cierre no es válida",
      );
    }
    return date;
  }
  if (kind === "contact_field" && NUMERIC_CONTACT_FIELDS.has(field)) {
    return Number(value || 0) || null;
  }
  const text = String(value ?? "").trim();
  if (
    (kind === "account_field" || kind === "opportunity_field") &&
    field === "name" &&
    (text.length < 2 || text.length > 180)
  ) {
    throw new CoachOperationError(
      400,
      "COACH_VALUE_INVALID",
      "El nombre propuesto no es válido",
    );
  }
  return text || null;
}

async function requireEntityAccess(conn, user, policy, entityId) {
  const userId = Number(user.id);
  const globalPermission = {
    account: "cuentas.read_all",
    contact: "cuentas.read_all",
    opportunity: "oportunidades.read_all",
    interaction: "interacciones.read_all",
  }[policy.entityType];
  const hasGlobalScope = user.permissionSet?.has(globalPermission);
  let rows;
  if (policy.entityType === "account") {
    [rows] = await conn.query(
      `SELECT a.id FROM accounts a
       ${hasGlobalScope ? "" : "INNER JOIN account_owners ao ON ao.account_id = a.id AND ao.user_id = ?"}
       WHERE a.id = ? LIMIT 1`,
      hasGlobalScope ? [entityId] : [userId, entityId],
    );
  } else if (policy.entityType === "contact") {
    [rows] = await conn.query(
      `SELECT c.id FROM contacts c
       ${hasGlobalScope ? "" : "INNER JOIN account_owners ao ON ao.account_id = c.account_id AND ao.user_id = ?"}
       WHERE c.id = ? LIMIT 1`,
      hasGlobalScope ? [entityId] : [userId, entityId],
    );
  } else if (policy.entityType === "opportunity") {
    [rows] = await conn.query(
      `SELECT o.id FROM opportunities o
       ${hasGlobalScope ? "" : "INNER JOIN account_owners ao ON ao.account_id = o.account_id AND ao.user_id = ?"}
       WHERE o.id = ? LIMIT 1`,
      hasGlobalScope ? [entityId] : [userId, entityId],
    );
  } else {
    [rows] = await conn.query(
      `SELECT i.id FROM interactions i
       ${hasGlobalScope ? "" : "LEFT JOIN account_owners ao ON ao.account_id = i.account_id AND ao.user_id = ?"}
       WHERE i.id = ? AND (${hasGlobalScope ? "1 = 1" : "i.seller_user_id = ? OR ao.user_id IS NOT NULL OR i.created_by = ? OR EXISTS (SELECT 1 FROM landing_submissions ls WHERE ls.id = i.landing_submission_id AND ls.sent_to_leads_by = ?) OR EXISTS (SELECT 1 FROM landing_submission_crm_links lscl INNER JOIN landing_submissions ls ON ls.id = lscl.submission_id WHERE lscl.lead_id = i.id AND ls.sent_to_leads_by = ?)"}) LIMIT 1`,
      hasGlobalScope
        ? [entityId]
        : [userId, entityId, userId, userId, userId, userId],
    );
  }
  if (!rows.length) {
    throw new CoachOperationError(
      404,
      "COACH_ENTITY_NOT_FOUND",
      "El registro no existe o no está disponible",
    );
  }
}

async function insertAudit(
  conn,
  { req, module, action, entityType, entityId, detail, before, after },
) {
  const changedFields = buildChangedFields(before, after);
  const [result] = await conn.query(
    `INSERT INTO audit_log
      (module, action, entity_type, entity_id, coach_operation_id, status, detail, changed_fields,
       performed_by_user_id, performed_by_name, performed_by_email,
       ip_address, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, 'success', ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
    [
      module,
      action,
      entityType,
      entityId,
      Number(req.coachOperationId || 0) || null,
      detail,
      Object.keys(changedFields).length ? JSON.stringify(changedFields) : null,
      Number(req.user.id),
      req.user.full_name || req.user.name || null,
      req.user.email || null,
      String(req.ip || "").slice(0, 64) || null,
      String(req.headers?.["user-agent"] || "").slice(0, 500) || null,
    ],
  );
  return Number(result.insertId);
}

async function executeFieldUpdate(conn, { operation, policy, entityId, req }) {
  const definition = FIELD_DEFINITIONS[operation.kind];
  const field = String(operation.field || "");
  const column = definition?.columns[field];
  if (!column)
    throw new CoachOperationError(
      400,
      "COACH_FIELD_NOT_ALLOWED",
      "Campo no permitido",
    );
  const extraColumns =
    operation.kind === "opportunity_field" ? ", commercial_status_id" : "";
  const [rows] = await conn.query(
    `SELECT ${column} AS value${extraColumns} FROM ${definition.table} WHERE id = ? FOR UPDATE`,
    [entityId],
  );
  if (!rows.length)
    throw new CoachOperationError(
      404,
      "COACH_ENTITY_NOT_FOUND",
      "El registro ya no existe",
    );
  if (operation.kind === "opportunity_field") {
    const [statusRows] = await conn.query(
      `SELECT ocs.code FROM opportunity_commercial_statuses ocs WHERE ocs.id = ? LIMIT 1`,
      [rows[0].commercial_status_id],
    );
    if (["ganada", "perdida", "anulada"].includes(statusRows[0]?.code)) {
      throw new CoachOperationError(
        422,
        "COACH_ENTITY_CLOSED",
        "No puedes modificar una oportunidad cerrada",
      );
    }
  }
  const currentValue = normalizeComparable(rows[0].value);
  if (!Object.prototype.hasOwnProperty.call(operation, "currentValue")) {
    throw new CoachOperationError(
      409,
      "COACH_REVIEW_REQUIRED",
      "Debes revisar el valor actual antes de confirmar",
      { currentValue },
    );
  }
  if (!valuesEqual(currentValue, operation.currentValue)) {
    throw new CoachOperationError(
      409,
      "COACH_TARGET_CHANGED",
      "El registro cambió después de preparar la propuesta",
      { currentValue },
    );
  }
  const nextValue = normalizeFieldValue(operation.kind, field, operation.value);
  const updatedBy =
    operation.kind === "opportunity_field" ? "" : ", updated_by = ?";
  await conn.query(
    `UPDATE ${definition.table} SET ${column} = ?${updatedBy}, updated_at = NOW(3) WHERE id = ?`,
    operation.kind === "opportunity_field"
      ? [nextValue, entityId]
      : [nextValue, Number(req.user.id), entityId],
  );
  const module =
    policy.entityType === "account"
      ? "cuentas"
      : policy.entityType === "contact"
        ? "contactos"
        : "oportunidades";
  const action =
    operation.kind === "opportunity_field"
      ? "coach_opportunity_field_updated"
      : "coach_field_updated";
  const auditId = await insertAudit(conn, {
    req,
    module,
    action,
    entityType: policy.entityType,
    entityId,
    detail: `Campo actualizado desde Coach: ${field}`,
    before: { [field]: currentValue },
    after: { [field]: nextValue },
  });
  return {
    auditId,
    entityType: policy.entityType,
    entityId,
    field,
    before: currentValue,
    after: nextValue,
  };
}

async function executeStageAnswer(conn, { operation, entityId, req }) {
  const [stateRows] = await conn.query(
    `SELECT o.sales_stage_id, ocs.code AS commercial_status_code
     FROM opportunities o INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     WHERE o.id = ? FOR UPDATE`,
    [entityId],
  );
  const state = stateRows[0];
  if (!state)
    throw new CoachOperationError(
      404,
      "COACH_ENTITY_NOT_FOUND",
      "La oportunidad ya no existe",
    );
  if (["ganada", "perdida", "anulada"].includes(state.commercial_status_code)) {
    throw new CoachOperationError(
      422,
      "COACH_ENTITY_CLOSED",
      "No puedes registrar respuestas en una oportunidad cerrada",
    );
  }
  const [questions] = await conn.query(
    `SELECT id, code, prompt FROM opportunity_stage_questions
     WHERE id = ? AND sales_stage_id = ? AND is_active = 1 LIMIT 1`,
    [Number(operation.questionId), Number(state.sales_stage_id)],
  );
  const question = questions[0];
  if (!question)
    throw new CoachOperationError(
      422,
      "COACH_STAGE_QUESTION_INVALID",
      "La pregunta no pertenece a la etapa actual",
    );
  const [previousRows] = await conn.query(
    `SELECT answer_value FROM opportunity_stage_question_answers
     WHERE opportunity_id = ? AND question_id = ? ORDER BY id DESC LIMIT 1`,
    [entityId, Number(operation.questionId)],
  );
  const before = previousRows[0]?.answer_value || null;
  const proposed = String(operation.answerValue ?? "").trim();
  const answer =
    operation.answerMode === "append" && before
      ? `${before}\n${proposed}`
      : proposed;
  if (!answer)
    throw new CoachOperationError(
      400,
      "COACH_VALUE_INVALID",
      "La respuesta es obligatoria",
    );
  if (
    Object.prototype.hasOwnProperty.call(operation, "previousAnswer") &&
    !valuesEqual(before || "", operation.previousAnswer || "")
  ) {
    throw new CoachOperationError(
      409,
      "COACH_TARGET_CHANGED",
      "La respuesta cambió después de preparar la propuesta",
      { currentValue: before },
    );
  }
  const [insertResult] = await conn.query(
    `INSERT INTO opportunity_stage_question_answers
      (opportunity_id, sales_stage_id, question_id, question_code_snapshot,
       question_prompt_snapshot, answer_value, answered_by_user_id, answered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3))`,
    [
      entityId,
      Number(state.sales_stage_id),
      Number(question.id),
      question.code,
      question.prompt,
      answer,
      Number(req.user.id),
    ],
  );
  const auditId = await insertAudit(conn, {
    req,
    module: "oportunidades",
    action: "stage_answers_saved",
    entityType: "opportunity",
    entityId,
    detail: "Respuesta de etapa guardada desde Coach",
    before: { answer: before },
    after: { answer },
  });
  return {
    auditId,
    entityType: "opportunity",
    entityId,
    questionId: Number(question.id),
    answerId: Number(insertResult.insertId),
    before,
    after: answer,
  };
}

async function executeLeadOutcome(
  conn,
  { operation, entityId, req, validateLeadOutcome },
) {
  const [rows] = await conn.query(
    `SELECT analysis_status, resolved_at, disqualification_reason,
          lead_substatus_code, lead_reason_code, lead_required_action_code,
          lead_commercial_comment, lead_next_action_due_at
     FROM interactions WHERE id = ? FOR UPDATE`,
    [entityId],
  );
  const before = rows[0];
  if (!before)
    throw new CoachOperationError(
      404,
      "COACH_ENTITY_NOT_FOUND",
      "El lead ya no existe",
    );
  const validated = validateLeadOutcome({
    currentStatusCode: before.analysis_status,
    operation,
  });
  if (!validated.ok)
    throw new CoachOperationError(
      validated.status || 400,
      validated.code || "COACH_VALUE_INVALID",
      validated.message,
    );
  const {
    rule,
    comment,
    nextActionDueAt,
    referredContactName,
    referredAreaName,
  } = validated;
  const [eventResult] = await conn.query(
    `INSERT INTO interaction_lead_outcome_events
      (public_id, interaction_id, event_type, from_status_code, to_status_code,
       substatus_code, reason_code, required_action_code, commercial_comment,
       next_action_due_at, referred_contact_name, referred_area_name,
       transition_rule_json, created_by, effective_at, created_at)
     VALUES (?, ?, 'activity_update', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
    [
      randomUUID().replace(/-/g, ""),
      entityId,
      before.analysis_status,
      rule.resultStatusCode,
      operation.substatusCode,
      operation.reasonCode,
      operation.requiredActionCode,
      comment || null,
      nextActionDueAt || null,
      referredContactName || null,
      referredAreaName || null,
      JSON.stringify(rule),
      Number(req.user.id),
    ],
  );
  await conn.query(
    `UPDATE interactions SET analysis_status = ?,
       resolved_at = CASE WHEN ? = 'lead_disqualified' THEN NOW(3) ELSE resolved_at END,
       disqualification_reason = CASE WHEN ? = 'lead_disqualified' THEN ? ELSE NULL END,
       lead_substatus_code = ?, lead_reason_code = ?, lead_required_action_code = ?,
       lead_commercial_comment = ?, lead_next_action_due_at = ?,
       lead_referred_contact_name = ?, lead_referred_area_name = ?,
       updated_by = ?, updated_at = NOW(3) WHERE id = ?`,
    [
      rule.resultStatusCode,
      rule.resultStatusCode,
      rule.resultStatusCode,
      comment || "Lead descalificado",
      operation.substatusCode,
      operation.reasonCode,
      operation.requiredActionCode,
      comment || null,
      nextActionDueAt || null,
      referredContactName || null,
      referredAreaName || null,
      Number(req.user.id),
      entityId,
    ],
  );
  const after = {
    analysis_status: rule.resultStatusCode,
    disqualification_reason:
      rule.resultStatusCode === "lead_disqualified"
        ? comment || "Lead descalificado"
        : null,
    lead_substatus_code: operation.substatusCode,
    lead_reason_code: operation.reasonCode,
    lead_required_action_code: operation.requiredActionCode,
    lead_commercial_comment: comment || null,
    lead_next_action_due_at: nextActionDueAt || null,
  };
  const auditId = await insertAudit(conn, {
    req,
    module: "interacciones",
    action: "updated",
    entityType: "interaction",
    entityId,
    detail: "Resultado comercial del lead registrado desde Coach",
    before,
    after,
  });
  return {
    auditId,
    entityType: "interaction",
    entityId,
    eventId: Number(eventResult.insertId),
    before,
    after,
  };
}

async function readControlledCurrentValue(conn, operation, entityId) {
  if (operation.kind.endsWith("_field")) {
    const definition = FIELD_DEFINITIONS[operation.kind];
    const column = definition?.columns[String(operation.field || "")];
    if (!column) {
      throw new CoachOperationError(
        400,
        "COACH_FIELD_NOT_ALLOWED",
        "Campo no permitido",
      );
    }
    const [rows] = await conn.query(
      `SELECT ${column} AS value FROM ${definition.table} WHERE id = ? LIMIT 1`,
      [entityId],
    );
    if (!rows.length) {
      throw new CoachOperationError(
        404,
        "COACH_ENTITY_NOT_FOUND",
        "El registro ya no existe",
      );
    }
    return { currentValue: normalizeComparable(rows[0].value) };
  }
  if (operation.kind === "stage_answer") {
    const [rows] = await conn.query(
      `SELECT answer_value FROM opportunity_stage_question_answers
       WHERE opportunity_id = ? AND question_id = ? ORDER BY id DESC LIMIT 1`,
      [entityId, Number(operation.questionId)],
    );
    return { previousAnswer: rows[0]?.answer_value || "" };
  }
  const [rows] = await conn.query(
    `SELECT analysis_status, lead_substatus_code, lead_reason_code,
            lead_required_action_code, lead_commercial_comment,
            lead_next_action_due_at
     FROM interactions WHERE id = ? LIMIT 1`,
    [entityId],
  );
  if (!rows.length) {
    throw new CoachOperationError(
      404,
      "COACH_ENTITY_NOT_FOUND",
      "El lead ya no existe",
    );
  }
  return { currentValue: rows[0] };
}

export async function reviewControlledCoachOperation({
  user,
  operationId,
  version,
}) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT * FROM coach_session_operations
       WHERE id = ? AND user_id = ? FOR UPDATE`,
      [Number(operationId), Number(user.id)],
    );
    if (!rows.length) {
      throw new CoachOperationError(
        404,
        "COACH_OPERATION_NOT_FOUND",
        "Operación no encontrada",
      );
    }
    const persisted = mapCoachOperationRow(rows[0]);
    if (!["ready", "failed"].includes(persisted.status)) {
      throw new CoachOperationError(
        409,
        "COACH_OPERATION_NOT_READY",
        "La operación no está disponible para revisión",
        { operation: persisted },
      );
    }
    if (Number(version) !== persisted.version) {
      throw new CoachOperationError(
        409,
        "COACH_OPERATION_VERSION_CONFLICT",
        "La operación cambió en otra ventana",
        { operation: persisted },
      );
    }
    const validation = validateControlledCoachOperation(
      persisted.pendingOperation,
    );
    if (!validation.ok) {
      throw new CoachOperationError(
        400,
        validation.code,
        "La operación controlada no es válida",
      );
    }
    if (!hasAnyPermission(user, validation.policy.domainReadPermissions)) {
      throw new CoachOperationError(
        403,
        "COACH_REVIEW_FORBIDDEN",
        "No tienes permisos para revisar este registro",
        { requiredPermission: validation.policy.domainReadPermissions },
      );
    }
    await requireEntityAccess(
      conn,
      user,
      validation.policy,
      validation.entityId,
    );
    const observed = await readControlledCurrentValue(
      conn,
      persisted.pendingOperation,
      validation.entityId,
    );
    const pendingOperation = { ...persisted.pendingOperation, ...observed };
    await conn.query(
      `UPDATE coach_session_operations
         SET pending_operation = ?, status = 'ready', error_detail = NULL,
           reviewed_at = NOW(3),
           version = version + 1, updated_at = NOW(3)
       WHERE id = ?`,
      [JSON.stringify(pendingOperation), persisted.id],
    );
    const [reviewedRows] = await conn.query(
      `SELECT * FROM coach_session_operations WHERE id = ? LIMIT 1`,
      [persisted.id],
    );
    return mapCoachOperationRow(reviewedRows[0]);
  });
}

export async function executeControlledCoachOperation({
  req,
  operationId,
  version,
  idempotencyKey,
  validateLeadOutcome,
}) {
  const safeKey = String(idempotencyKey || "").trim();
  if (!safeKey || safeKey.length > 100)
    throw new CoachOperationError(
      400,
      "COACH_IDEMPOTENCY_KEY_REQUIRED",
      "La clave de idempotencia es obligatoria",
    );
  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT * FROM coach_session_operations WHERE id = ? AND user_id = ? FOR UPDATE`,
      [Number(operationId), Number(req.user.id)],
    );
    if (!rows.length)
      throw new CoachOperationError(
        404,
        "COACH_OPERATION_NOT_FOUND",
        "Operación no encontrada",
      );
    const persisted = mapCoachOperationRow(rows[0]);
    if (persisted.executionKey === safeKey && persisted.status === "completed")
      return persisted;
    if (persisted.status !== "ready")
      throw new CoachOperationError(
        409,
        "COACH_OPERATION_NOT_READY",
        "La operación no está lista",
        { operation: persisted },
      );
    if (Number(version) !== persisted.version)
      throw new CoachOperationError(
        409,
        "COACH_OPERATION_VERSION_CONFLICT",
        "La operación cambió en otra ventana",
        { operation: persisted },
      );
    if (!persisted.reviewedAt) {
      throw new CoachOperationError(
        409,
        "COACH_REVIEW_REQUIRED",
        "Debes revisar el valor actual antes de confirmar",
        { operation: persisted },
      );
    }
    const operation = persisted.pendingOperation;
    const validation = validateControlledCoachOperation(operation);
    if (!validation.ok)
      throw new CoachOperationError(
        400,
        validation.code,
        "La operación controlada no es válida",
      );
    const policy = getControlledCoachOperationPolicy(operation.kind);
    if (
      !req.user.permissionSet?.has("mi_coach.execute") ||
      !hasAnyPermission(req.user, policy.domainPermission)
    ) {
      throw new CoachOperationError(
        403,
        "COACH_EXECUTION_FORBIDDEN",
        "No tienes permisos para confirmar esta operación",
        { requiredPermission: policy.domainPermission },
      );
    }
    await requireEntityAccess(conn, req.user, policy, validation.entityId);
    await conn.query(
      `UPDATE coach_session_operations SET status = 'executing', execution_key = ?,
       approved_at = NOW(3), executing_at = NOW(3), error_detail = NULL,
       version = version + 1, updated_at = NOW(3) WHERE id = ?`,
      [safeKey, persisted.id],
    );
    const executeEvent = (event) =>
      appendCoachOperationEvent(event, (...args) => conn.query(...args));
    await executeEvent({
      operationId: persisted.id,
      sessionId: persisted.sessionId,
      userId: req.user.id,
      eventType: "approved",
      fromStatus: "ready",
      toStatus: "executing",
      source: "user",
      eventKey: `approved:${safeKey}`,
      idempotencyKey: safeKey,
    });
    await executeEvent({
      operationId: persisted.id,
      sessionId: persisted.sessionId,
      userId: req.user.id,
      eventType: "execution_started",
      fromStatus: "ready",
      toStatus: "executing",
      source: "system",
      eventKey: `execution_started:${safeKey}`,
      idempotencyKey: safeKey,
    });
    const operationReq = { ...req, coachOperationId: persisted.id };
    const result = operation.kind.endsWith("_field")
      ? await executeFieldUpdate(conn, {
          operation,
          policy,
          entityId: validation.entityId,
          req: operationReq,
        })
      : operation.kind === "stage_answer"
        ? await executeStageAnswer(conn, {
            operation,
            entityId: validation.entityId,
            req: operationReq,
          })
        : await executeLeadOutcome(conn, {
            operation,
            entityId: validation.entityId,
            req: operationReq,
            validateLeadOutcome,
          });
    await conn.query(
      `UPDATE coach_session_operations SET status = 'completed', result_payload = ?,
       domain_audit_id = ?, completed_at = NOW(3), version = version + 1,
       updated_at = NOW(3) WHERE id = ?`,
      [JSON.stringify(result), result.auditId, persisted.id],
    );
    await executeEvent({
      operationId: persisted.id,
      sessionId: persisted.sessionId,
      userId: req.user.id,
      eventType: "completed",
      fromStatus: "executing",
      toStatus: "completed",
      source: "domain_module",
      domainModule: persisted.targetModule,
      domainEntityType: policy.entityType,
      domainEntityId: result.entityId,
      domainAuditId: result.auditId,
      eventKey: `completed:${safeKey}`,
      idempotencyKey: safeKey,
    });
    const [completedRows] = await conn.query(
      `SELECT * FROM coach_session_operations WHERE id = ? LIMIT 1`,
      [persisted.id],
    );
    return mapCoachOperationRow(completedRows[0]);
  });
}

async function revertFieldUpdate(conn, { operation, persisted, req, policy }) {
  const definition = FIELD_DEFINITIONS[operation.kind];
  const field = String(operation.field || "");
  const column = definition?.columns[field];
  const entityId = Number(persisted.result?.entityId || 0);
  const [rows] = await conn.query(
    `SELECT ${column} AS value FROM ${definition.table} WHERE id = ? FOR UPDATE`,
    [entityId],
  );
  if (!rows.length)
    throw new CoachOperationError(
      404,
      "COACH_ENTITY_NOT_FOUND",
      "El registro ya no existe",
    );
  if (!valuesEqual(rows[0].value, persisted.result?.after)) {
    throw new CoachOperationError(
      409,
      "COACH_REVERT_CONFLICT",
      "El valor fue modificado después de la operación",
      { currentValue: normalizeComparable(rows[0].value) },
    );
  }
  const updatedBy =
    operation.kind === "opportunity_field" ? "" : ", updated_by = ?";
  await conn.query(
    `UPDATE ${definition.table} SET ${column} = ?${updatedBy}, updated_at = NOW(3) WHERE id = ?`,
    operation.kind === "opportunity_field"
      ? [persisted.result.before, entityId]
      : [persisted.result.before, Number(req.user.id), entityId],
  );
  return insertAudit(conn, {
    req,
    module:
      policy.entityType === "account"
        ? "cuentas"
        : policy.entityType === "contact"
          ? "contactos"
          : "oportunidades",
    action: "coach_operation_reverted",
    entityType: policy.entityType,
    entityId,
    detail: `Cambio del Coach revertido: ${field}`,
    before: { [field]: persisted.result.after },
    after: { [field]: persisted.result.before },
  });
}

async function revertStageAnswer(conn, { persisted, operation, req }) {
  const entityId = Number(persisted.result?.entityId || 0);
  const questionId = Number(
    persisted.result?.questionId || operation.questionId || 0,
  );
  const [latestRows] = await conn.query(
    `SELECT id, answer_value, sales_stage_id, question_code_snapshot,
            question_prompt_snapshot
     FROM opportunity_stage_question_answers
     WHERE opportunity_id = ? AND question_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    [entityId, questionId],
  );
  const latest = latestRows[0];
  if (
    !latest ||
    Number(latest.id) !== Number(persisted.result?.answerId) ||
    !valuesEqual(latest.answer_value, persisted.result?.after)
  ) {
    throw new CoachOperationError(
      409,
      "COACH_REVERT_CONFLICT",
      "La respuesta fue modificada después de la operación",
    );
  }
  if (
    persisted.result?.before === null ||
    persisted.result?.before === undefined
  ) {
    await conn.query(
      `DELETE FROM opportunity_stage_question_answers WHERE id = ?`,
      [latest.id],
    );
  } else {
    await conn.query(
      `INSERT INTO opportunity_stage_question_answers
       (opportunity_id, sales_stage_id, question_id, question_code_snapshot,
        question_prompt_snapshot, answer_value, answered_by_user_id, answered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3))`,
      [
        entityId,
        latest.sales_stage_id,
        questionId,
        latest.question_code_snapshot,
        latest.question_prompt_snapshot,
        persisted.result.before,
        Number(req.user.id),
      ],
    );
  }
  return insertAudit(conn, {
    req,
    module: "oportunidades",
    action: "stage_answer_undone",
    entityType: "opportunity",
    entityId,
    detail: "Respuesta de etapa del Coach revertida",
    before: { answer: persisted.result.after },
    after: { answer: persisted.result.before },
  });
}

async function revertLeadOutcome(conn, { persisted, req }) {
  const entityId = Number(persisted.result?.entityId || 0);
  const [rows] = await conn.query(
    `SELECT analysis_status, resolved_at, disqualification_reason,
          lead_substatus_code, lead_reason_code,
            lead_required_action_code, lead_commercial_comment,
            lead_next_action_due_at
     FROM interactions WHERE id = ? FOR UPDATE`,
    [entityId],
  );
  const current = rows[0];
  const expected = persisted.result?.after || {};
  if (
    !current ||
    Object.entries(expected).some(
      ([key, value]) => !valuesEqual(current[key], value),
    )
  ) {
    throw new CoachOperationError(
      409,
      "COACH_REVERT_CONFLICT",
      "El lead fue modificado después de la operación",
    );
  }
  const before = persisted.result?.before || {};
  await conn.query(
    `UPDATE interactions SET analysis_status = ?, resolved_at = ?,
       disqualification_reason = ?, lead_substatus_code = ?,
       lead_reason_code = ?, lead_required_action_code = ?,
       lead_commercial_comment = ?, lead_next_action_due_at = ?,
       updated_by = ?, updated_at = NOW(3) WHERE id = ?`,
    [
      before.analysis_status,
      before.resolved_at,
      before.disqualification_reason,
      before.lead_substatus_code,
      before.lead_reason_code,
      before.lead_required_action_code,
      before.lead_commercial_comment,
      before.lead_next_action_due_at,
      Number(req.user.id),
      entityId,
    ],
  );
  await conn.query(
    `UPDATE interaction_lead_outcome_events SET invalidated_at = NOW(3)
     WHERE id = ? AND interaction_id = ? AND invalidated_at IS NULL`,
    [Number(persisted.result?.eventId || 0), entityId],
  );
  return insertAudit(conn, {
    req,
    module: "interacciones",
    action: "coach_lead_outcome_undone",
    entityType: "interaction",
    entityId,
    detail: "Resultado de lead del Coach revertido",
    before: expected,
    after: before,
  });
}

export async function revertControlledCoachOperation({ req, operationId }) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT * FROM coach_session_operations WHERE id = ? AND user_id = ? FOR UPDATE`,
      [Number(operationId), Number(req.user.id)],
    );
    if (!rows.length)
      throw new CoachOperationError(
        404,
        "COACH_OPERATION_NOT_FOUND",
        "Operación no encontrada",
      );
    const persisted = mapCoachOperationRow(rows[0]);
    if (persisted.status !== "completed")
      throw new CoachOperationError(
        409,
        "COACH_OPERATION_NOT_REVERSIBLE",
        "La operación no está disponible para reversión",
      );
    const operation = persisted.pendingOperation;
    const validation = validateControlledCoachOperation(operation);
    if (!validation.ok || !validation.policy.reversible)
      throw new CoachOperationError(
        409,
        "COACH_OPERATION_NOT_REVERSIBLE",
        "La operación no es reversible",
      );
    if (
      !req.user.permissionSet?.has("mi_coach.execute") ||
      !hasAnyPermission(req.user, validation.policy.domainPermission)
    ) {
      throw new CoachOperationError(
        403,
        "COACH_EXECUTION_FORBIDDEN",
        "No tienes permisos para revertir esta operación",
      );
    }
    await requireEntityAccess(
      conn,
      req.user,
      validation.policy,
      validation.entityId,
    );
    const operationReq = { ...req, coachOperationId: persisted.id };
    const reversalAuditId = operation.kind.endsWith("_field")
      ? await revertFieldUpdate(conn, {
          operation,
          persisted,
          req: operationReq,
          policy: validation.policy,
        })
      : operation.kind === "stage_answer"
        ? await revertStageAnswer(conn, {
            operation,
            persisted,
            req: operationReq,
          })
        : await revertLeadOutcome(conn, {
            persisted,
            req: operationReq,
          });
    const result = { ...persisted.result, reversalAuditId };
    await conn.query(
      `UPDATE coach_session_operations SET status = 'reverted', result_payload = ?,
       reverted_at = NOW(3), version = version + 1, updated_at = NOW(3) WHERE id = ?`,
      [JSON.stringify(result), persisted.id],
    );
    await appendCoachOperationEvent(
      {
        operationId: persisted.id,
        sessionId: persisted.sessionId,
        userId: req.user.id,
        eventType: "reverted",
        fromStatus: "completed",
        toStatus: "reverted",
        source: "domain_module",
        domainModule: persisted.targetModule,
        domainEntityType: validation.policy.entityType,
        domainEntityId: validation.entityId,
        domainAuditId: reversalAuditId,
        eventKey: `reverted:${persisted.version + 1}`,
      },
      (...args) => conn.query(...args),
    );
    const [revertedRows] = await conn.query(
      `SELECT * FROM coach_session_operations WHERE id = ? LIMIT 1`,
      [persisted.id],
    );
    return mapCoachOperationRow(revertedRows[0]);
  });
}
