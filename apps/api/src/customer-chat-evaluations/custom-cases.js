import { query } from "../db.js";
import { businessImpactForCase } from "./business-impact.js";
import { ensureEvaluationSchema } from "./schema.js";

// Cases created by reviewers from negative feedback. They join the catalog read from the
// validation document and run like any other case, against the account they came from.
export const CUSTOM_CASE_CATEGORY = "USR";

export function customCaseDefinition(row) {
  const id = `U-${Number(row.id)}`;
  return {
    id,
    category: CUSTOM_CASE_CATEGORY,
    title: row.title,
    accountId: Number(row.account_id),
    expectedAccountName: row.account_name,
    steps: [{ question: row.question, expected: row.expected }],
    blockedReason: null,
    requiresHumanReview: true,
    mode: "proposal_only",
    businessImpact: businessImpactForCase(id),
    custom: true,
    sourceFeedbackId: row.source_feedback_id === null ? null : Number(row.source_feedback_id),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || ""),
  };
}

// Custom cases are additive: if they cannot be read, the base catalog still works.
export async function listCustomEvaluationCases() {
  try {
    await ensureEvaluationSchema();
    const rows = await query("SELECT * FROM customer_chat_evaluation_custom_cases WHERE active = 1 ORDER BY id");
    return Array.isArray(rows) ? rows.map(customCaseDefinition) : [];
  } catch {
    return [];
  }
}

export async function createCustomEvaluationCase({ title, question, expected, accountId, accountName, sourceFeedbackId = null, userId = null }) {
  await ensureEvaluationSchema();
  const result = await query(
    `INSERT INTO customer_chat_evaluation_custom_cases
       (title, question, expected, account_id, account_name, source_feedback_id, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [title, question, expected, Number(accountId), accountName, sourceFeedbackId, userId],
  );
  const [row] = await query("SELECT * FROM customer_chat_evaluation_custom_cases WHERE id = ?", [Number(result.insertId)]);
  return customCaseDefinition(row);
}
