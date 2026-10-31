// Existing-customer chat conversations: creating, listing and reading them.

import { IN_CHAT_CONFIRMATION_KINDS, IN_CHAT_FIELD_ALLOWLIST } from "../coach/chat-confirmation.js";
import { buildAccountDossier } from "./dossier/opportunity-dossier.js";
import { buildCustomerConversationContext, validateCustomerConversationContext } from "./conversation-context.js";
import { enabledChannelTools, withReadOnlyConnection } from "./dossier/access.js";
import { ensureCommercialIntelligenceSchema } from "./schema.js";
import { listChatOperationOutcomes, withOperationSignatures } from "./operation-outcomes.js";
import { listOwnFeedbackForSession } from "./turn-feedback.js";
import { loadChannelIntentConfigurations } from "../coach/channel-intent-governance.js";
import { pool, query } from "../db.js";
import { randomUUID } from "node:crypto";
import { buildAuthorizedCustomerSnapshot } from "./customer-snapshot.js";
import { createHttpError, customerChatDataForUser, parseJson } from "./service-helpers.js";
import { getAccessibleAccount } from "./account-access.js";
import { getMiCoachGovernanceSettings } from "./governance-settings.js";

export async function insertCustomerAccountChatSession({ user, snapshot }) {
  const publicId = `cacs_${randomUUID()}`;
  const initialConversationContext = validateCustomerConversationContext(
    buildCustomerConversationContext({
      accountId: snapshot.account?.id,
      effectiveContext: {
        accountId: snapshot.account?.id,
        opportunityId: snapshot.selectedOpportunity?.id,
        contactId: snapshot.selectedContact?.id,
      },
    }),
    snapshot,
    snapshot.account?.id,
  );
  const result = await query(
    `INSERT INTO customer_intelligence_chat_sessions
      (public_id, requested_by_user_id, account_id, opportunity_id, contact_id,
       history_json, context_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
    [
      publicId,
      Number(user.id),
      snapshot.account?.id || null,
      snapshot.selectedOpportunity?.id || null,
      snapshot.selectedContact?.id || null,
      JSON.stringify([]),
      JSON.stringify(initialConversationContext),
    ],
  );
  return {
    id: Number(result.insertId),
    publicId,
    accountId: snapshot.account?.id || null,
    opportunityId: snapshot.selectedOpportunity?.id || null,
    contactId: snapshot.selectedContact?.id || null,
  };
}

export async function createCustomerAccountChatSession({ user, payload }) {
  await ensureCommercialIntelligenceSchema();
  const snapshot = await buildAuthorizedCustomerSnapshot({ user, ...payload });
  return {
    session: await insertCustomerAccountChatSession({ user, snapshot }),
  };
}

export async function getCustomerChatFocusOptions({ user, accountId }) {
  const governance = {
    ...(await getMiCoachGovernanceSettings()),
    channelTools: enabledChannelTools(await loadChannelIntentConfigurations({ channel: "customer_account" })),
  };
  const dossier = await withReadOnlyConnection(pool, (run) =>
    buildAccountDossier({ user, accountId: Number(accountId), governance, run }));
  const section = dossier.sections.opportunities;
  return {
    enabled: true,
    status: section.status,
    opportunities: section.items.map((item) => ({
      id: item.id, name: item.name, stageName: item.stageName, closeDate: item.closeDate,
      commercialStatusName: item.commercialStatusName,
    })),
  };
}

// What the chat card may do for this seller's organization: today, confirm a few kinds of change in place.
export async function getCustomerChatCapabilities() {
  const settings = await getMiCoachGovernanceSettings();
  return {
    inChatConfirmation: {
      enabled: settings.customerChatConfirmationEnabled === true,
      kinds: [...IN_CHAT_CONFIRMATION_KINDS],
      fields: Object.fromEntries(Object.entries(IN_CHAT_FIELD_ALLOWLIST).map(([kind, fields]) => [kind, [...fields]])),
    },
  };
}

// Operations are returned with their signature and the answer already given (confirmed or discarded).
export async function withOperationOutcomes(result, chatSessionId) {
  if (!Array.isArray(result?.operations) || !result.operations.length) return result;
  const outcomes = chatSessionId ? await listChatOperationOutcomes({ chatSessionId }) : new Map();
  return { ...result, operations: withOperationSignatures(result.operations, outcomes) };
}

export const DEFAULT_SESSION_HISTORY_LIMIT = 8;

export const MAX_SESSION_HISTORY_LIMIT = 80;

export const SESSION_TITLE_LENGTH = 80;

export const CHAT_SESSION_LIST_PAGE_SIZE = 20;

export function buildChatSessionTitle(firstText) {
  const text = String(firstText || "").replace(/\s+/g, " ").trim();
  if (!text) return "Conversación sin título";
  return text.length > SESSION_TITLE_LENGTH ? `${text.slice(0, SESSION_TITLE_LENGTH - 1).trimEnd()}…` : text;
}

// The seller's own earlier conversations about one account, newest first. Empty sessions are not listed.
export async function listCustomerAccountChatSessions({ user, accountId, page = 1 }) {
  await ensureCommercialIntelligenceSchema();
  const normalizedAccountId = Number(accountId || 0);
  if (!Number.isInteger(normalizedAccountId) || normalizedAccountId <= 0) {
    throw createHttpError(400, "Cuenta invalida");
  }
  await getAccessibleAccount({ user, accountId: normalizedAccountId });
  const safePage = Math.max(1, Math.trunc(Number(page) || 1));
  const rows = await query(
    `SELECT id, opportunity_id, created_at, updated_at,
            JSON_LENGTH(history_json) AS message_count,
            JSON_UNQUOTE(JSON_EXTRACT(history_json, '$[0].text')) AS first_text
     FROM customer_intelligence_chat_sessions
     WHERE requested_by_user_id = ? AND account_id = ? AND JSON_LENGTH(history_json) > 0
     ORDER BY updated_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    [
      Number(user.id),
      normalizedAccountId,
      CHAT_SESSION_LIST_PAGE_SIZE + 1,
      (safePage - 1) * CHAT_SESSION_LIST_PAGE_SIZE,
    ],
  );
  return {
    page: safePage,
    hasMore: rows.length > CHAT_SESSION_LIST_PAGE_SIZE,
    sessions: rows.slice(0, CHAT_SESSION_LIST_PAGE_SIZE).map((row) => ({
      id: Number(row.id),
      title: buildChatSessionTitle(row.first_text),
      messageCount: Number(row.message_count || 0),
      opportunityId: row.opportunity_id === null ? null : Number(row.opportunity_id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
}

export async function getCustomerAccountChatSession({ user, sessionId, limit = DEFAULT_SESSION_HISTORY_LIMIT }) {
  await ensureCommercialIntelligenceSchema();
  const historyLimit = Math.min(
    MAX_SESSION_HISTORY_LIMIT,
    Math.max(1, Math.trunc(Number(limit) || DEFAULT_SESSION_HISTORY_LIMIT)),
  );
  const rows = await query(
    `SELECT id, public_id, account_id, opportunity_id, contact_id, history_json,
            created_at, updated_at
     FROM customer_intelligence_chat_sessions
     WHERE id = ? AND requested_by_user_id = ? LIMIT 1`,
    [Number(sessionId), Number(user.id)],
  );
  const row = rows[0];
  if (!row) return null;
  const history = parseJson(row.history_json, []);
  const feedback = await listOwnFeedbackForSession({ user, sessionId: Number(row.id) });
  const shownMessages = Array.isArray(history)
    ? history.slice(-historyLimit).map((message) => customerChatDataForUser(message, user)) : [];
  const outcomes = shownMessages.some((message) => message?.operations?.length)
    ? await listChatOperationOutcomes({ chatSessionId: Number(row.id) }) : new Map();
  const visibleHistory = shownMessages.map((message) => (message?.operations?.length
    ? { ...message, operations: withOperationSignatures(message.operations, outcomes) } : message));
  return {
    id: Number(row.id),
    publicId: row.public_id,
    accountId: row.account_id === null ? null : Number(row.account_id),
    opportunityId:
      row.opportunity_id === null ? null : Number(row.opportunity_id),
    contactId: row.contact_id === null ? null : Number(row.contact_id),
    history: visibleHistory,
    feedback,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
