// Existing-customer chat jobs: creating, cancelling, running under a turn budget and reading them.

import { abortActiveTurn, runWithTurnContext } from "./turn-context.js";
import { config } from "../config.js";
import { ensureCommercialIntelligenceSchema } from "./schema.js";
import { query } from "../db.js";
import { randomUUID } from "node:crypto";
import { validateCustomerConversationContext } from "./conversation-context.js";
import { assertExternalResearchGovernance } from "./governance-settings.js";
import { buildAuthorizedCustomerSnapshot } from "./customer-snapshot.js";
import { createHttpError, customerChatDataForUser, hasPermission, mapFindingRow, mapJobRow, parseJson } from "./service-helpers.js";
import { insertCustomerAccountChatSession, withOperationOutcomes } from "./chat-sessions.js";
import { runCustomerAccountChatJob } from "./chat-worker.js";

export async function createCustomerAccountChatJob({ user, payload }) {
  await ensureCommercialIntelligenceSchema();
  if (payload.includePublicResearch) {
    if (!hasPermission(user, "fuentes_externas.execute"))
      throw createHttpError(403, "No autorizado", {
        requiredPermission: "fuentes_externas.execute",
      });
    await assertExternalResearchGovernance(user);
  }
  const snapshot = await buildAuthorizedCustomerSnapshot({ user, ...payload });
  let chatSession;
  const requestedChatSessionId = Number(payload.chatSessionId || 0);
  if (requestedChatSessionId > 0) {
    const sessionRows = await query(
      `SELECT id, account_id, opportunity_id, contact_id, context_json
       FROM customer_intelligence_chat_sessions
       WHERE id = ? AND requested_by_user_id = ? LIMIT 1`,
      [requestedChatSessionId, Number(user.id)],
    );
    const session = sessionRows[0];
    if (!session) {
      throw createHttpError(404, "Sesion de chat de cuenta no encontrada");
    }
    const sameContext =
      Number(session.account_id || 0) === Number(snapshot.account?.id || 0) &&
      Number(session.opportunity_id || 0) ===
        Number(snapshot.selectedOpportunity?.id || 0) &&
      Number(session.contact_id || 0) ===
        Number(snapshot.selectedContact?.id || 0);
    if (!sameContext) {
      throw createHttpError(
        409,
        "La sesion de chat pertenece a otro contexto de cliente",
      );
    }
    const conversationContext = validateCustomerConversationContext(
      parseJson(session.context_json, null),
      snapshot,
      snapshot.account?.id,
    );
    chatSession = { id: Number(session.id) };
    payload = { ...payload, conversationContext };
  } else {
    chatSession = await insertCustomerAccountChatSession({ user, snapshot });
  }
  const result = await query(
    `INSERT INTO customer_intelligence_jobs (public_id, account_id, opportunity_id, contact_id, requested_by_user_id, job_type, status, request_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'account_chat', 'pending', ?, NOW(3), NOW(3))`,
    [
      `cac_${randomUUID()}`,
      snapshot.account?.id || null,
      snapshot.selectedOpportunity?.id || null,
      snapshot.selectedContact?.id || null,
      Number(user.id),
      JSON.stringify({
        ...payload,
        chatSessionId: chatSession.id,
        question: payload.question,
      }),
    ],
  );
  return {
    job: {
      id: Number(result.insertId),
      chatSessionId: chatSession.id,
      status: "pending",
      pollAfterMs: 700,
    },
    snapshot,
  };
}

export async function cancelCustomerAccountChatJob({ user, jobId }) {
  await ensureCommercialIntelligenceSchema();
  // Only a pending turn can be cancelled; a finished one is returned as is so the client shows it.
  await query(
    `UPDATE customer_intelligence_jobs
     SET status = 'cancelled', error_message = 'Cancelado por el usuario',
         updated_at = NOW(3), finished_at = NOW(3)
     WHERE id = ? AND requested_by_user_id = ? AND job_type = 'account_chat'
       AND status = 'pending'`,
    [Number(jobId), Number(user.id)],
  );
  // Stops the provider calls of a turn already running in this process; other processes notice it by polling.
  abortActiveTurn(jobId);
  return getCustomerIntelligenceJob({ user, jobId });
}

export const CANCEL_POLL_MS = 2000;

// Runs the turn inside a context that counts its provider calls, bounds its duration and aborts the
// in-flight calls as soon as the user cancels it.
export async function processCustomerAccountChatJob({ jobId, user, deadlineAt = null }) {
  const limits = config.customerChat || {};
  return runWithTurnContext({
    jobId,
    maxLlmCalls: Number(limits.maxLlmCallsPerTurn) > 0 ? Number(limits.maxLlmCallsPerTurn) : Infinity,
    maxDurationMs: Number(limits.maxTurnMs) > 0 ? Number(limits.maxTurnMs) : 0,
  }, async () => {
    const poll = setInterval(() => {
      query(
        `SELECT status FROM customer_intelligence_jobs WHERE id = ? AND requested_by_user_id = ? LIMIT 1`,
        [Number(jobId), Number(user.id)],
      ).then((rows) => { if (rows[0]?.status === "cancelled") abortActiveTurn(jobId); }).catch(() => undefined);
    }, CANCEL_POLL_MS);
    poll.unref?.();
    try {
      return await runCustomerAccountChatJob({ jobId, user, deadlineAt });
    } finally {
      clearInterval(poll);
    }
  });
}

export async function getCustomerIntelligenceJob({ user, jobId }) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT * FROM customer_intelligence_jobs
     WHERE id = ? AND requested_by_user_id = ? LIMIT 1`,
    [Number(jobId), Number(user.id)],
  );
  const job = mapJobRow(rows[0]);
  if (!job) return null;
  const findings = await query(
    `SELECT * FROM customer_intelligence_findings
     WHERE job_id = ?
     ORDER BY created_at ASC, id ASC`,
    [Number(job.id)],
  );
  return {
    ...job,
    result: job.jobType === "account_chat"
      ? await withOperationOutcomes(customerChatDataForUser(job.result, user), Number(job.request?.chatSessionId || 0) || null)
      : job.result,
    findings: findings.map(mapFindingRow),
  };
}
