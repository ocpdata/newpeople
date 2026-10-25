import { z } from "zod";
import { TASK_KINDS, TASK_TYPES } from "./turn-plan.js";

// Single validated conversation state for the customer chat (design §4.2). It replaces the
// separate memories kept today (dossierMemory, turnMemory, pendingActivity, pendingActivityIntent...).

export const STATE_VERSION = 1;
const MAX_CITED = 60;

const stateSchema = z.object({
  version: z.literal(STATE_VERSION),
  accountId: z.number().int().positive(),
  focus: z.object({
    level: z.enum(["account", "opportunity", "opportunities"]),
    opportunityIds: z.array(z.number().int().positive()).max(3),
  }).strict(),
  lastTasks: z.array(z.object({
    type: z.enum(TASK_TYPES),
    kind: z.string().max(40),
    ask: z.string().max(300),
    status: z.enum(["completed", "clarification", "failed", "limited"]),
  }).strict()).max(6),
  pendingAction: z.object({
    kind: z.enum(TASK_KINDS.action),
    opportunityId: z.number().int().positive().nullable(),
    fields: z.record(z.string(), z.union([z.string().max(1200), z.number(), z.boolean(), z.null()])),
    missingFields: z.array(z.string().max(60)).max(20),
    draftId: z.number().int().positive().nullable(),
    draftVersion: z.number().int().positive().nullable(),
  }).strict().nullable(),
  pendingClarification: z.object({
    question: z.string().max(1000),
    optionOpportunityIds: z.array(z.number().int().positive()).max(10),
  }).strict().nullable(),
  lastDocument: z.object({
    source: z.enum(["quotation", "attachment", "crm_document", "library"]),
    recordId: z.number().int().positive().nullable(),
    versionId: z.number().int().positive().nullable(),
  }).strict().nullable(),
  citedEvidenceIds: z.array(z.string().max(80)).max(MAX_CITED),
}).strict();

export function emptyConversationState(accountId) {
  return {
    version: STATE_VERSION, accountId: Number(accountId), focus: { level: "account", opportunityIds: [] },
    lastTasks: [], pendingAction: null, pendingClarification: null, lastDocument: null, citedEvidenceIds: [],
  };
}

/**
 * Validates a stored state against the account and the opportunities the user can see now.
 * References to opportunities that are no longer visible are dropped instead of trusted.
 */
export function validateConversationState(value, { accountId, opportunityIds = [] }) {
  const parsed = stateSchema.safeParse(value);
  if (!parsed.success || parsed.data.accountId !== Number(accountId)) return emptyConversationState(accountId);
  const visible = new Set(opportunityIds.map(Number));
  const state = structuredClone(parsed.data);
  state.focus.opportunityIds = state.focus.opportunityIds.filter((id) => visible.has(id));
  if (!state.focus.opportunityIds.length) state.focus.level = "account";
  else if (state.focus.opportunityIds.length === 1) state.focus.level = "opportunity";
  if (state.pendingAction?.opportunityId && !visible.has(state.pendingAction.opportunityId)) state.pendingAction = null;
  if (state.pendingClarification) {
    state.pendingClarification.optionOpportunityIds = state.pendingClarification.optionOpportunityIds
      .filter((id) => visible.has(id));
  }
  return state;
}

const ACTIVITY_FIELDS = ["actionType", "timing", "title", "notes", "successCriteria", "temporalPreference", "scheduledAt"];

/** Builds the unified state from the memories stored today, so both paths can coexist during migration. */
export function conversationStateFromLegacyContext(context, { accountId, opportunityIds = [] }) {
  const state = emptyConversationState(accountId);
  if (!context || Number(context.accountId) !== Number(accountId)) return state;
  const memory = context.dossierMemory;
  if (memory) {
    state.focus = { level: memory.level || "account", opportunityIds: (memory.focusOpportunityIds || []).slice(0, 3) };
    state.lastTasks = (memory.obligations || []).slice(0, 6).map((item) => ({
      type: "consult", kind: "summary", ask: String(item.ask || "").slice(0, 300), status: "completed",
    }));
    state.citedEvidenceIds = (memory.citedEvidenceIds || []).slice(0, MAX_CITED);
  } else if (Number(context.opportunityId || 0)) {
    state.focus = { level: "opportunity", opportunityIds: [Number(context.opportunityId)] };
  }
  const draft = context.pendingActivity?.operation;
  const intent = context.pendingActivityIntent;
  if (draft || intent) {
    const source = draft || intent;
    state.pendingAction = {
      kind: "schedule_activity",
      opportunityId: Number(draft?.opportunityId || 0) || null,
      fields: Object.fromEntries(ACTIVITY_FIELDS.filter((key) => source[key] !== undefined)
        .map((key) => [key, source[key] ?? null])),
      missingFields: draft ? [...(draft.missingFields || [])] : ["opportunityId"],
      draftId: Number(context.pendingActivity?.operationId || 0) || null,
      draftVersion: Number(context.pendingActivity?.version || 0) || null,
    };
  }
  return validateConversationState(state, { accountId, opportunityIds });
}
