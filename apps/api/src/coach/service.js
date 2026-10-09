import { query, withTransaction } from "../db.js";
import { randomUUID } from "node:crypto";
import { ensureCoachSchema } from "./schema.js";

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function recordCoachJobAction(execute, operation, action) {
  if (!operation?.sourceJobId) return;
  try {
    const rows = await execute(
      `SELECT observability_json FROM mi_agent_analysis_jobs WHERE id = ? LIMIT 1`,
      [Number(operation.sourceJobId)],
    );
    const observability = parseJson(rows[0]?.observability_json, {}) || {};
    const actions = Array.isArray(observability.actions)
      ? observability.actions
      : [];
    actions.push({
      ...action,
      operationId: Number(operation.id),
      recordedAt: new Date().toISOString(),
    });
    await execute(
      `UPDATE mi_agent_analysis_jobs SET observability_json = ?, updated_at = NOW(3) WHERE id = ?`,
      [
        JSON.stringify({
          ...observability,
          actions: actions.slice(-20),
          lastAction: actions.at(-1),
        }),
        Number(operation.sourceJobId),
      ],
    );
  } catch {
    // Observability must never block the business operation.
  }
}

function normalizeContext(context = {}) {
  return {
    accountId: Number(context.accountId || 0) || null,
    contactId: Number(context.contactId || 0) || null,
    opportunityId: Number(context.opportunityId || 0) || null,
    quotationId: Number(context.quotationId || 0) || null,
    proposalId: Number(context.proposalId || 0) || null,
    leadId: Number(context.leadId || 0) || null,
  };
}

function normalizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message && typeof message === "object")
    .map((message) => ({
      role: message.role === "coach" ? "coach" : "seller",
      text: String(message.text || "")
        .trim()
        .slice(0, 4000),
      result:
        message.result && typeof message.result === "object"
          ? message.result
          : undefined,
      context:
        message.context && typeof message.context === "object"
          ? normalizeContext(message.context)
          : undefined,
      createdAt: message.createdAt || new Date().toISOString(),
    }))
    .filter((message) => message.text || message.result)
    .slice(-40);
}

const ACTIVE_OPERATION_STATUSES = [
  "proposed",
  "collecting",
  "ready",
  "handed_off",
  "executing",
  "failed",
];

function transitionEventType(status) {
  return {
    collecting: "fields_collected",
    ready: "ready",
    handed_off: "handed_off",
    executing: "execution_started",
    completed: "completed",
    failed: "execution_failed",
    rejected: "rejected",
    cancelled: "cancelled",
    superseded: "superseded",
    reverted: "reverted",
  }[status];
}

async function insertCoachOperationEvent(
  execute,
  {
    operationId,
    sessionId,
    userId,
    actorUserId = null,
    eventType,
    fromStatus = null,
    toStatus = null,
    source = "system",
    domainModule = null,
    domainEntityType = null,
    domainEntityId = null,
    domainAuditId = null,
    idempotencyKey = null,
    eventKey,
    reasonCode = null,
    detail = null,
    metadata = null,
  },
) {
  await execute(
    `INSERT IGNORE INTO coach_operation_events
      (operation_id, session_id, user_id, actor_user_id, event_type, from_status, to_status,
       source, domain_module, domain_entity_type, domain_entity_id,
       domain_audit_id, idempotency_key, event_key, reason_code, detail, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(operationId),
      Number(sessionId),
      Number(userId),
      Number(
        actorUserId ||
          (["user", "handoff", "domain_module"].includes(source) ? userId : 0),
      ) || null,
      eventType,
      fromStatus,
      toStatus,
      source,
      domainModule,
      domainEntityType,
      Number(domainEntityId || 0) || null,
      Number(domainAuditId || 0) || null,
      idempotencyKey,
      eventKey,
      reasonCode,
      detail ? String(detail).slice(0, 1000) : null,
      metadata ? JSON.stringify(metadata) : null,
    ],
  );
}

export async function appendCoachOperationEvent(event, execute = query) {
  if (execute === query) await ensureCoachSchema();
  return insertCoachOperationEvent(execute, event);
}

const OPERATION_TRANSITIONS = {
  proposed: new Set([
    "collecting",
    "ready",
    "handed_off",
    "rejected",
    "cancelled",
    "superseded",
  ]),
  collecting: new Set([
    "ready",
    "handed_off",
    "rejected",
    "cancelled",
    "superseded",
  ]),
  ready: new Set([
    "collecting",
    "handed_off",
    "executing",
    "failed",
    "rejected",
    "cancelled",
    "superseded",
  ]),
  handed_off: new Set([
    "collecting",
    "ready",
    "executing",
    "completed",
    "failed",
    "cancelled",
  ]),
  executing: new Set(["completed", "failed"]),
  failed: new Set([
    "collecting",
    "ready",
    "executing",
    "rejected",
    "cancelled",
  ]),
  completed: new Set(["reverted"]),
  rejected: new Set(),
  cancelled: new Set(),
  superseded: new Set(),
  reverted: new Set(),
};

const TARGET_MODULES = {
  activity: "calendar",
  stage_answer: "opportunities",
  opportunity_field: "opportunities",
  account_field: "accounts",
  contact_field: "contacts",
  lead_call_outcome: "interactions",
  lead_resolve: "interactions",
  create_lead: "interactions",
  create_contact_mapping: "contact_mapping",
  create_account: "accounts",
  create_contact: "contacts",
  create_opportunity: "opportunities",
  link_contact_to_opportunity: "opportunities",
  create_quotation: "quotations",
  create_proposal: "proposals",
};

const TARGET_ROUTES = {
  activity: "/calendar",
  stage_answer: "/opportunities",
  opportunity_field: "/opportunities",
  account_field: "/accounts",
  contact_field: "/contacts",
  lead_call_outcome: "/interactions",
  lead_resolve: "/interactions",
  create_lead: "/interactions",
  create_contact_mapping: "/contact-mapping",
  create_account: "/accounts",
  create_contact: "/contacts",
  create_opportunity: "/opportunities",
  link_contact_to_opportunity: "/opportunities",
  create_quotation: "/quotations",
  create_proposal: "/proposals",
};

function operationFields(operation = {}) {
  const omitted = new Set([
    "kind",
    "title",
    "evidence",
    "missingFields",
    "requiresConfirmation",
    "source",
    "entityType",
  ]);
  return Object.fromEntries(
    Object.entries(operation).filter(
      ([key, value]) => !omitted.has(key) && value !== undefined,
    ),
  );
}

export function mapCoachOperationRow(row) {
  const originalOperation = parseJson(row.original_operation, {});
  const pendingOperation = parseJson(row.pending_operation, {});
  return {
    id: Number(row.id),
    sessionId: Number(row.session_id),
    userId: Number(row.user_id),
    sourceJobId: Number(row.source_job_id || 0) || null,
    operationIndex: Number(row.operation_index),
    kind: row.operation_kind,
    sourceChannel:
      pendingOperation.sourceChannel ||
      originalOperation.sourceChannel ||
      "coach",
    status: row.status,
    originalIntent: row.original_intent,
    identifiedEntities: parseJson(row.identified_entities, {}),
    collectedFields: parseJson(row.collected_fields, {}),
    missingFields: parseJson(row.missing_fields, []),
    evidence: parseJson(row.evidence, []),
    targetModule:
      row.operation_kind === "activity" &&
      ACTIVE_OPERATION_STATUSES.includes(row.status)
        ? TARGET_MODULES.activity
        : row.target_module || null,
    targetRoute:
      row.operation_kind === "activity" &&
      ACTIVE_OPERATION_STATUSES.includes(row.status)
        ? TARGET_ROUTES.activity
        : row.target_route || null,
    handoffToken: row.handoff_token || null,
    handoffExpiresAt: row.handoff_expires_at,
    handoffConsumedAt: row.handoff_consumed_at,
    originalOperation,
    pendingOperation,
    result: parseJson(row.result_payload, null),
    errorDetail: row.error_detail || null,
    cancellationReason: row.cancellation_reason || null,
    executionKey: row.execution_key || null,
    domainAuditId: Number(row.domain_audit_id || 0) || null,
    version: Number(row.version),
    handedOffAt: row.handed_off_at,
    approvedAt: row.approved_at,
    reviewedAt: row.reviewed_at,
    executingAt: row.executing_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    rejectedAt: row.rejected_at,
    cancelledAt: row.cancelled_at,
    revertedAt: row.reverted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function persistCoachOperations({
  userId,
  sessionId,
  sourceJobId,
  originalIntent,
  entities = {},
  operations = [],
}) {
  await ensureCoachSchema();
  return withTransaction(async (conn) => {
    const execute = async (sql, params) => {
      const [rows] = await conn.query(sql, params);
      return rows;
    };
    const sessions = await execute(
      `SELECT status FROM coach_conversation_sessions
       WHERE id = ? AND user_id = ? FOR UPDATE`,
      [Number(sessionId), Number(userId)],
    );
    if (sessions[0]?.status !== "active") return [];
    const persisted = [];
    for (const [operationIndex, operation] of operations
      .slice(0, 6)
      .entries()) {
      const missingFields = Array.isArray(operation.missingFields)
        ? operation.missingFields
        : [];
      const status = missingFields.length ? "collecting" : "ready";
      const insertResult = await execute(
        `INSERT INTO coach_session_operations
        (session_id, user_id, source_job_id, operation_index, operation_kind, status,
         original_intent, identified_entities, collected_fields, missing_fields,
         evidence, target_module, target_route, original_operation, pending_operation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
        [
          Number(sessionId),
          Number(userId),
          Number(sourceJobId) || null,
          operationIndex,
          String(operation.kind || "unknown").slice(0, 80),
          status,
          String(originalIntent || "").slice(0, 4000),
          JSON.stringify(entities || {}),
          JSON.stringify(operationFields(operation)),
          JSON.stringify(missingFields),
          JSON.stringify(operation.evidence || []),
          TARGET_MODULES[operation.kind] || null,
          TARGET_ROUTES[operation.kind] || null,
          JSON.stringify(operation),
          JSON.stringify(operation),
        ],
      );
      const rows = sourceJobId
        ? await execute(
            `SELECT * FROM coach_session_operations
             WHERE source_job_id = ? AND operation_index = ? AND user_id = ? LIMIT 1`,
            [Number(sourceJobId), operationIndex, Number(userId)],
          )
        : await execute(
            `SELECT * FROM coach_session_operations
             WHERE id = ? AND user_id = ? LIMIT 1`,
            [Number(insertResult.insertId), Number(userId)],
          );
      if (rows[0]) {
        const persistedOperation = mapCoachOperationRow(rows[0]);
        await insertCoachOperationEvent(execute, {
          operationId: persistedOperation.id,
          sessionId: persistedOperation.sessionId,
          userId,
          eventType: "proposed",
          toStatus: "proposed",
          source: "coach",
          eventKey: "proposed",
          metadata: { sourceJobId: persistedOperation.sourceJobId },
        });
        await insertCoachOperationEvent(execute, {
          operationId: persistedOperation.id,
          sessionId: persistedOperation.sessionId,
          userId,
          eventType: status === "ready" ? "ready" : "fields_collected",
          fromStatus: "proposed",
          toStatus: status,
          source: "coach",
          eventKey: `initial:${status}`,
        });
        persisted.push(persistedOperation);
      }
    }
    if (persisted.length) {
      await execute(
        `UPDATE coach_conversation_sessions SET updated_at = NOW(3)
         WHERE id = ? AND user_id = ?`,
        [Number(sessionId), Number(userId)],
      );
    }
    return persisted;
  });
}

export async function listCoachSessionOperations(
  userId,
  sessionId,
  { activeOnly = false } = {},
) {
  await ensureCoachSchema();
  const params = [Number(sessionId), Number(userId)];
  const statusFilter = activeOnly
    ? ` AND status IN (${ACTIVE_OPERATION_STATUSES.map(() => "?").join(", ")})`
    : "";
  if (activeOnly) params.push(...ACTIVE_OPERATION_STATUSES);
  const rows = await query(
    `SELECT * FROM coach_session_operations
     WHERE session_id = ? AND user_id = ?${statusFilter}
     ORDER BY updated_at DESC, id DESC`,
    params,
  );
  return rows.map(mapCoachOperationRow);
}

export async function getCoachOperation(userId, operationId) {
  await ensureCoachSchema();
  const rows = await query(
    `SELECT * FROM coach_session_operations
     WHERE id = ? AND user_id = ? LIMIT 1`,
    [Number(operationId), Number(userId)],
  );
  return rows[0] ? mapCoachOperationRow(rows[0]) : null;
}

function isActiveHandoff(operation) {
  if (!operation?.handoffToken || !operation?.handoffExpiresAt) return false;
  return new Date(operation.handoffExpiresAt).getTime() > Date.now();
}

export async function createCoachHandoff(userId, operationId) {
  await ensureCoachSchema();
  return withTransaction(async (conn) => {
    const execute = async (sql, params) => {
      const [rows] = await conn.query(sql, params);
      return rows;
    };
    const rows = await execute(
      `SELECT * FROM coach_session_operations
       WHERE id = ? AND user_id = ? FOR UPDATE`,
      [Number(operationId), Number(userId)],
    );
    const existing = rows[0] ? mapCoachOperationRow(rows[0]) : null;
    if (!existing) return { outcome: "not_found", operation: null };
    if (!existing.targetModule || !existing.targetRoute) {
      return { outcome: "unsupported", operation: existing };
    }
    if (
      ["completed", "rejected", "cancelled", "superseded"].includes(
        existing.status,
      )
    ) {
      return { outcome: "closed", operation: existing };
    }
    if (isActiveHandoff(existing)) {
      return { outcome: "ready", operation: existing };
    }
    if (!["ready", "failed", "handed_off"].includes(existing.status)) {
      return { outcome: "not_ready", operation: existing };
    }
    const token = randomUUID();
    await execute(
      `UPDATE coach_session_operations
     SET handoff_token = ?, handoff_expires_at = DATE_ADD(NOW(3), INTERVAL 24 HOUR),
         handoff_consumed_at = NULL, status = 'handed_off', version = version + 1,
         approved_at = COALESCE(approved_at, NOW(3)), handed_off_at = NOW(3),
         updated_at = NOW(3)
     WHERE id = ? AND user_id = ?`,
      [token, Number(operationId), Number(userId)],
    );
    await insertCoachOperationEvent(execute, {
      operationId: existing.id,
      sessionId: existing.sessionId,
      userId,
      eventType: "approved",
      fromStatus: existing.status,
      toStatus: "handed_off",
      source: "user",
      eventKey: `approved:${existing.version + 1}`,
    });
    await insertCoachOperationEvent(execute, {
      operationId: existing.id,
      sessionId: existing.sessionId,
      userId,
      eventType: "handed_off",
      fromStatus: existing.status,
      toStatus: "handed_off",
      source: "handoff",
      eventKey: `handed_off:${existing.version + 1}`,
      metadata: { targetModule: existing.targetModule },
    });
    await recordCoachJobAction(execute, existing, {
      event: "handed_off",
      status: "handed_off",
      domainModule: existing.targetModule,
    });
    const updatedRows = await execute(
      `SELECT * FROM coach_session_operations
       WHERE id = ? AND user_id = ? LIMIT 1`,
      [Number(operationId), Number(userId)],
    );
    return {
      outcome: "ready",
      operation: mapCoachOperationRow(updatedRows[0]),
    };
  });
}

export async function getCoachHandoff(userId, token, expectedModule) {
  await ensureCoachSchema();
  const rows = await query(
    `SELECT * FROM coach_session_operations
     WHERE handoff_token = ? AND user_id = ?
       AND status IN ('handed_off', 'failed')
     LIMIT 1`,
    [String(token || ""), Number(userId)],
  );
  const operation = rows[0] ? mapCoachOperationRow(rows[0]) : null;
  if (!operation) return { outcome: "not_found", operation: null };
  if (new Date(operation.handoffExpiresAt).getTime() <= Date.now()) {
    await transitionCoachOperation(userId, operation.id, {
      status: "cancelled",
      cancellationReason: "El handoff expiró",
      source: "system",
      reasonCode: "handoff_expired",
      eventType: "expired",
    });
    return { outcome: "expired", operation: null };
  }
  if (operation.targetModule !== expectedModule) {
    return { outcome: "wrong_module", operation: null };
  }
  await query(
    `UPDATE coach_session_operations
     SET handoff_consumed_at = COALESCE(handoff_consumed_at, NOW(3)), updated_at = NOW(3)
     WHERE id = ? AND user_id = ?`,
    [operation.id, Number(userId)],
  );
  return {
    outcome: "ready",
    operation: await getCoachOperation(userId, operation.id),
  };
}

export async function completeCoachHandoff(
  userId,
  token,
  expectedModule,
  result,
) {
  const loaded = await getCoachHandoff(userId, token, expectedModule);
  if (loaded.outcome !== "ready") return loaded;
  return transitionCoachOperation(userId, loaded.operation.id, {
    status: "completed",
    result,
    source: "handoff",
    domainModule: expectedModule,
    domainEntityType: result?.entityType,
    domainEntityId: result?.entityId,
    domainAuditId: result?.auditId,
  });
}

export async function cancelCoachHandoff(
  userId,
  token,
  expectedModule,
  cancellationReason,
) {
  const loaded = await getCoachHandoff(userId, token, expectedModule);
  if (loaded.outcome !== "ready") return loaded;
  return transitionCoachOperation(userId, loaded.operation.id, {
    status: "cancelled",
    cancellationReason,
    source: "user",
    reasonCode: "handoff_discarded",
  });
}

export async function updateCoachOperation(
  userId,
  operationId,
  { pendingOperation, collectedFields, missingFields, version },
) {
  await ensureCoachSchema();
  return withTransaction(async (conn) => {
    const execute = async (sql, params) => {
      const [rows] = await conn.query(sql, params);
      return rows;
    };
    const existingRows = await execute(
      `SELECT * FROM coach_session_operations
       WHERE id = ? AND user_id = ? FOR UPDATE`,
      [Number(operationId), Number(userId)],
    );
    const existing = existingRows[0]
      ? mapCoachOperationRow(existingRows[0])
      : null;
    if (!existing) return { outcome: "not_found", operation: null };
    if (!ACTIVE_OPERATION_STATUSES.includes(existing.status)) {
      return { outcome: "closed", operation: existing };
    }
    if (Number(version) !== existing.version) {
      return { outcome: "conflict", operation: existing };
    }
    const nextPendingOperation =
      pendingOperation && typeof pendingOperation === "object"
        ? pendingOperation
        : existing.pendingOperation;
    const immutableFields = [
      "kind",
      "entityType",
      "accountId",
      "contactId",
      "opportunityId",
      "interactionId",
      "quotationVersionId",
      "field",
      "questionId",
    ];
    const identityChanged = immutableFields.some(
      (field) =>
        JSON.stringify(nextPendingOperation?.[field] ?? null) !==
        JSON.stringify(existing.pendingOperation?.[field] ?? null),
    );
    if (identityChanged) {
      return { outcome: "invalid", operation: existing };
    }
    if (existing.reviewedAt) {
      for (const field of ["currentValue", "previousAnswer"]) {
        if (
          Object.prototype.hasOwnProperty.call(existing.pendingOperation, field)
        ) {
          nextPendingOperation[field] = existing.pendingOperation[field];
        } else {
          delete nextPendingOperation[field];
        }
      }
    }
    const nextCollectedFields =
      collectedFields && typeof collectedFields === "object"
        ? collectedFields
        : operationFields(nextPendingOperation);
    const nextMissingFields = Array.isArray(missingFields)
      ? missingFields
      : existing.missingFields;
    const status = nextMissingFields.length ? "collecting" : "ready";
    const updateResult = await execute(
      `UPDATE coach_session_operations
     SET pending_operation = ?, collected_fields = ?, missing_fields = ?, status = ?,
         error_detail = NULL, version = version + 1, updated_at = NOW(3)
     WHERE id = ? AND user_id = ? AND version = ?`,
      [
        JSON.stringify(nextPendingOperation),
        JSON.stringify(nextCollectedFields),
        JSON.stringify(nextMissingFields),
        status,
        Number(operationId),
        Number(userId),
        existing.version,
      ],
    );
    if (!Number(updateResult?.affectedRows || 0)) {
      return {
        outcome: "conflict",
        operation: existing,
      };
    }
    await insertCoachOperationEvent(execute, {
      operationId: existing.id,
      sessionId: existing.sessionId,
      userId,
      eventType: status === "ready" ? "ready" : "fields_collected",
      fromStatus: existing.status,
      toStatus: status,
      source: "user",
      eventKey: `draft:${existing.version + 1}:${status}`,
    });
    await execute(
      `UPDATE coach_conversation_sessions SET updated_at = NOW(3)
     WHERE id = ? AND user_id = ?`,
      [existing.sessionId, Number(userId)],
    );
    const updatedRows = await execute(
      `SELECT * FROM coach_session_operations
       WHERE id = ? AND user_id = ? LIMIT 1`,
      [Number(operationId), Number(userId)],
    );
    return {
      outcome: "updated",
      operation: mapCoachOperationRow(updatedRows[0]),
    };
  });
}

export async function transitionCoachOperation(
  userId,
  operationId,
  {
    status,
    result = null,
    errorDetail = null,
    cancellationReason = null,
    source = "system",
    domainModule = null,
    domainEntityType = null,
    domainEntityId = null,
    domainAuditId = null,
    reasonCode = null,
    eventType: explicitEventType = null,
  },
) {
  await ensureCoachSchema();
  return withTransaction(async (conn) => {
    const execute = async (sql, params) => {
      const [rows] = await conn.query(sql, params);
      return rows;
    };
    const existingRows = await execute(
      `SELECT * FROM coach_session_operations
       WHERE id = ? AND user_id = ? FOR UPDATE`,
      [Number(operationId), Number(userId)],
    );
    const existing = existingRows[0]
      ? mapCoachOperationRow(existingRows[0])
      : null;
    if (!existing) return null;
    if (!OPERATION_TRANSITIONS[existing.status]?.has(status)) {
      return { outcome: "invalid_transition", operation: existing };
    }
    if (domainAuditId) {
      await execute(
        `UPDATE audit_log
         SET coach_operation_id = COALESCE(coach_operation_id, ?)
         WHERE id = ? AND performed_by_user_id = ?`,
        [Number(operationId), Number(domainAuditId), Number(userId)],
      );
    }
    await execute(
      `UPDATE coach_session_operations
     SET status = ?, result_payload = ?, error_detail = ?, cancellation_reason = ?,
       domain_audit_id = COALESCE(?, domain_audit_id),
         handed_off_at = CASE WHEN ? = 'handed_off' THEN NOW(3) ELSE handed_off_at END,
         approved_at = CASE WHEN ? = 'executing' THEN NOW(3) ELSE approved_at END,
         executing_at = CASE WHEN ? = 'executing' THEN NOW(3) ELSE executing_at END,
         completed_at = CASE WHEN ? = 'completed' THEN NOW(3) ELSE completed_at END,
         failed_at = CASE WHEN ? = 'failed' THEN NOW(3) ELSE failed_at END,
         rejected_at = CASE WHEN ? = 'rejected' THEN NOW(3) ELSE rejected_at END,
         cancelled_at = CASE WHEN ? = 'cancelled' THEN NOW(3) ELSE cancelled_at END,
         reverted_at = CASE WHEN ? = 'reverted' THEN NOW(3) ELSE reverted_at END,
         version = version + 1, updated_at = NOW(3)
     WHERE id = ? AND user_id = ?`,
      [
        status,
        JSON.stringify(result),
        errorDetail ? String(errorDetail).slice(0, 1000) : null,
        cancellationReason ? String(cancellationReason).slice(0, 1000) : null,
        Number(domainAuditId || 0) || null,
        status,
        status,
        status,
        status,
        status,
        status,
        status,
        status,
        Number(operationId),
        Number(userId),
      ],
    );
    const eventType = explicitEventType || transitionEventType(status);
    if (eventType) {
      await recordCoachJobAction(execute, existing, {
        event: eventType || status,
        status,
        domainModule: domainModule || existing.targetModule,
        domainAuditId: domainAuditId || null,
      });
      await insertCoachOperationEvent(execute, {
        operationId: existing.id,
        sessionId: existing.sessionId,
        userId,
        eventType,
        fromStatus: existing.status,
        toStatus: status,
        source,
        domainModule: domainModule || existing.targetModule,
        domainEntityType,
        domainEntityId,
        domainAuditId,
        eventKey: `transition:${status}:${existing.version + 1}`,
        reasonCode,
        detail: errorDetail || cancellationReason,
      });
    }
    await execute(
      `UPDATE coach_conversation_sessions SET updated_at = NOW(3)
       WHERE id = ? AND user_id = ?`,
      [existing.sessionId, Number(userId)],
    );
    const updatedRows = await execute(
      `SELECT * FROM coach_session_operations
       WHERE id = ? AND user_id = ? LIMIT 1`,
      [Number(operationId), Number(userId)],
    );
    return {
      outcome: "updated",
      operation: mapCoachOperationRow(updatedRows[0]),
    };
  });
}

export async function getLatestActiveCoachSession(userId) {
  await ensureCoachSchema();
  const rows = await query(
    `SELECT s.* FROM coach_conversation_sessions s
     WHERE s.user_id = ?
     ORDER BY s.updated_at DESC, s.id DESC LIMIT 1`,
    [Number(userId)],
  );
  return rows[0]?.status === "active" ? mapSession(rows[0]) : null;
}

function mapSession(row) {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    status: row.status,
    context: normalizeContext({
      accountId: row.account_id,
      contactId: row.contact_id,
      opportunityId: row.opportunity_id,
      quotationId: row.quotation_id,
      proposalId: row.proposal_id,
      leadId: row.lead_id,
    }),
    contextSnapshot: parseJson(row.context_snapshot, null),
    messages: normalizeMessages(parseJson(row.messages, [])),
    draftOperation: parseJson(row.draft_operation, null),
    pendingQuestion: row.pending_question || null,
    version: Number(row.session_version || 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createCoachSession(userId, context = {}) {
  await ensureCoachSchema();
  const normalizedContext = normalizeContext(context);
  const result = await query(
    `INSERT INTO coach_conversation_sessions
      (user_id, account_id, contact_id, opportunity_id, quotation_id, proposal_id, lead_id, context_snapshot, messages)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(userId),
      normalizedContext.accountId,
      normalizedContext.contactId,
      normalizedContext.opportunityId,
      normalizedContext.quotationId,
      normalizedContext.proposalId,
      normalizedContext.leadId,
      JSON.stringify(normalizedContext),
      JSON.stringify([]),
    ],
  );
  return getCoachSession(userId, Number(result.insertId));
}

export async function getCoachSession(userId, sessionId) {
  await ensureCoachSchema();
  const rows = await query(
    `SELECT * FROM coach_conversation_sessions
     WHERE id = ? AND user_id = ? LIMIT 1`,
    [Number(sessionId), Number(userId)],
  );
  return rows[0] ? mapSession(rows[0]) : null;
}

export async function closeCoachSession(userId, sessionId) {
  await ensureCoachSchema();
  const result = await withTransaction(async (conn) => {
    const execute = async (sql, params) => {
      const [rows] = await conn.query(sql, params);
      return rows;
    };
    const sessions = await execute(
      `SELECT status FROM coach_conversation_sessions
       WHERE id = ? AND user_id = ? FOR UPDATE`,
      [Number(sessionId), Number(userId)],
    );
    if (!sessions[0]) return { outcome: "not_found" };
    if (sessions[0].status === "closed") return { outcome: "closed" };

    const pendingOperations = await execute(
      `SELECT id FROM coach_session_operations
       WHERE session_id = ? AND user_id = ?
         AND status IN (${ACTIVE_OPERATION_STATUSES.map(() => "?").join(", ")})`,
      [Number(sessionId), Number(userId), ...ACTIVE_OPERATION_STATUSES],
    );
    if (pendingOperations.length) return { outcome: "operations_in_progress" };

    await execute(
      `UPDATE coach_conversation_sessions
       SET status = 'closed', closed_at = NOW(3), updated_at = NOW(3)
       WHERE id = ? AND user_id = ? AND status = 'active'`,
      [Number(sessionId), Number(userId)],
    );
    return { outcome: "closed" };
  });
  return result.outcome === "closed"
    ? { ...result, session: await getCoachSession(userId, sessionId) }
    : { ...result, session: null };
}

export async function getOrCreateCoachSession(userId, sessionId, context = {}) {
  if (sessionId) {
    const existing = await getCoachSession(userId, sessionId);
    if (existing?.status === "active") return existing;
  }
  return createCoachSession(userId, context);
}

export async function updateCoachSession(
  userId,
  sessionId,
  { context = {}, messages, draftOperation, pendingQuestion } = {},
) {
  const existing = await getCoachSession(userId, sessionId);
  if (!existing || existing.status !== "active") return null;
  const normalizedContext = normalizeContext({
    ...existing.context,
    ...context,
  });
  const nextMessages =
    messages === undefined ? existing.messages : normalizeMessages(messages);
  await query(
    `UPDATE coach_conversation_sessions
     SET account_id = ?, contact_id = ?, opportunity_id = ?, quotation_id = ?, proposal_id = ?, lead_id = ?,
       context_snapshot = ?, messages = ?, draft_operation = ?, pending_question = ?,
       session_version = session_version + 1, updated_at = NOW(3)
     WHERE id = ? AND user_id = ? AND status = 'active'`,
    [
      normalizedContext.accountId,
      normalizedContext.contactId,
      normalizedContext.opportunityId,
      normalizedContext.quotationId,
      normalizedContext.proposalId,
      normalizedContext.leadId,
      JSON.stringify(normalizedContext),
      JSON.stringify(nextMessages),
      draftOperation === undefined
        ? JSON.stringify(existing.draftOperation)
        : JSON.stringify(draftOperation),
      pendingQuestion === undefined
        ? existing.pendingQuestion
        : String(pendingQuestion || "").trim() || null,
      Number(sessionId),
      Number(userId),
    ],
  );
  return getCoachSession(userId, sessionId);
}

export async function setCoachPendingQuestion(userId, sessionId, question) {
  return updateCoachSession(userId, sessionId, {
    pendingQuestion: question,
  });
}

export async function appendCoachSessionTurn(
  userId,
  sessionId,
  turn,
  context = {},
) {
  const session = await getCoachSession(userId, sessionId);
  if (!session) return null;
  return updateCoachSession(userId, sessionId, {
    context,
    messages: [
      ...session.messages,
      { ...turn, context: normalizeContext(context) },
    ],
  });
}
