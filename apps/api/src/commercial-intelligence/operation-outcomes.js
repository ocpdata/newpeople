import { query } from "../db.js";
import { ensureCommercialIntelligenceSchema } from "./schema.js";
import { OPERATION_OUTCOMES, chatOperationSignature } from "../coach/chat-confirmation.js";

const parse = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
};

// The pending operation a seller persisted from the chat (their own only), as the server stored it.
export async function loadOwnPersistedOperation({ userId, operationId }) {
  const [row] = await query(
    "SELECT id, status, pending_operation FROM coach_session_operations WHERE id = ? AND user_id = ? LIMIT 1",
    [Number(operationId), Number(userId)],
  );
  if (!row) return null;
  return { id: Number(row.id), status: row.status, operation: parse(row.pending_operation) || {} };
}

export async function ownChatSession({ userId, chatSessionId }) {
  const [row] = await query(
    "SELECT id FROM customer_intelligence_chat_sessions WHERE id = ? AND requested_by_user_id = ? LIMIT 1",
    [Number(chatSessionId), Number(userId)],
  );
  return Boolean(row);
}

export async function getChatOperationOutcome({ userId, chatSessionId, operation }) {
  await ensureCommercialIntelligenceSchema();
  if (!(await ownChatSession({ userId, chatSessionId }))) return null;
  const [row] = await query(
    "SELECT status FROM customer_chat_operation_outcomes WHERE session_id = ? AND signature = ? LIMIT 1",
    [Number(chatSessionId), chatOperationSignature(operation)],
  );
  return row?.status || null;
}

export async function recordChatOperationOutcome({ userId, chatSessionId, operation, status, operationId = null }) {
  if (!OPERATION_OUTCOMES.includes(status)) throw new Error(`Resultado de operación desconocido: ${status}`);
  await ensureCommercialIntelligenceSchema();
  if (!(await ownChatSession({ userId, chatSessionId }))) return false;
  await query(
    `INSERT INTO customer_chat_operation_outcomes (session_id, signature, status, operation_id, user_id)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE status = VALUES(status), operation_id = VALUES(operation_id), created_at = NOW(3)`,
    [Number(chatSessionId), chatOperationSignature(operation), status, operationId ? Number(operationId) : null, Number(userId)],
  );
  return true;
}

// Undoing a confirmed change reopens the proposal: it may be confirmed again in the same conversation.
export async function clearChatOperationOutcome({ userId, chatSessionId, operation }) {
  await ensureCommercialIntelligenceSchema();
  if (!(await ownChatSession({ userId, chatSessionId }))) return false;
  await query(
    "DELETE FROM customer_chat_operation_outcomes WHERE session_id = ? AND signature = ?",
    [Number(chatSessionId), chatOperationSignature(operation)],
  );
  return true;
}

export async function listChatOperationOutcomes({ chatSessionId }) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    "SELECT signature, status FROM customer_chat_operation_outcomes WHERE session_id = ?",
    [Number(chatSessionId)],
  );
  return new Map(rows.map((row) => [row.signature, row.status]));
}

// Adds the signature (and the answer already given, if any) to the operations a chat message proposes.
export function withOperationSignatures(operations, outcomes = new Map()) {
  if (!Array.isArray(operations)) return operations;
  return operations.map((operation) => {
    if (!operation || typeof operation !== "object") return operation;
    const signature = chatOperationSignature(operation);
    const outcome = outcomes.get(signature);
    return { ...operation, signature, ...(outcome ? { outcome } : {}) };
  });
}
