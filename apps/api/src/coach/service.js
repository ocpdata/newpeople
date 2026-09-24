import { query } from "../db.js";
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
      text: String(message.text || "").trim().slice(0, 4000),
      result: message.result && typeof message.result === "object" ? message.result : undefined,
      createdAt: message.createdAt || new Date().toISOString(),
    }))
    .filter((message) => message.text || message.result)
    .slice(-40);
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

export async function getOrCreateCoachSession(userId, sessionId, context = {}) {
  if (sessionId) {
    const existing = await getCoachSession(userId, sessionId);
    if (existing) return existing;
  }
  return createCoachSession(userId, context);
}

export async function updateCoachSession(userId, sessionId, { context = {}, messages, draftOperation } = {}) {
  const existing = await getCoachSession(userId, sessionId);
  if (!existing) return null;
  const normalizedContext = normalizeContext({ ...existing.context, ...context });
  const nextMessages = messages === undefined ? existing.messages : normalizeMessages(messages);
  await query(
    `UPDATE coach_conversation_sessions
     SET account_id = ?, contact_id = ?, opportunity_id = ?, quotation_id = ?, proposal_id = ?, lead_id = ?,
         context_snapshot = ?, messages = ?, draft_operation = ?, updated_at = NOW(3)
     WHERE id = ? AND user_id = ?`,
    [
      normalizedContext.accountId,
      normalizedContext.contactId,
      normalizedContext.opportunityId,
      normalizedContext.quotationId,
      normalizedContext.proposalId,
      normalizedContext.leadId,
      JSON.stringify(normalizedContext),
      JSON.stringify(nextMessages),
      draftOperation === undefined ? JSON.stringify(existing.draftOperation) : JSON.stringify(draftOperation),
      Number(sessionId),
      Number(userId),
    ],
  );
  return getCoachSession(userId, sessionId);
}

export async function appendCoachSessionTurn(userId, sessionId, turn, context = {}) {
  const session = await getCoachSession(userId, sessionId);
  if (!session) return null;
  return updateCoachSession(userId, sessionId, {
    context,
    messages: [...session.messages, turn],
  });
}

export async function auditCoachOperation({ userId, sessionId = null, operation, beforeState = null, afterState = null, result, errorMessage = null }) {
  await ensureCoachSchema();
  const operationKind = String(operation?.kind || "unknown").slice(0, 80);
  const rows = await query(
    `INSERT INTO coach_operation_audits
      (session_id, user_id, operation_kind, operation_payload, before_state, after_state, result, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId ? Number(sessionId) : null,
      Number(userId),
      operationKind,
      JSON.stringify(operation || {}),
      JSON.stringify(beforeState),
      JSON.stringify(afterState),
      result,
      errorMessage ? String(errorMessage).slice(0, 1000) : null,
    ],
  );
  return Number(rows.insertId);
}
