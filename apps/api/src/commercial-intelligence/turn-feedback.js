import { query } from "../db.js";
import { ensureCommercialIntelligenceSchema } from "./schema.js";

export const FEEDBACK_RATINGS = ["positive", "negative"];
export const FEEDBACK_REASONS = {
  incorrect_data: "Dato incorrecto",
  misunderstood: "No entendió la pregunta",
  missing_info: "Falta información",
  wrong_action: "Acción equivocada",
  format: "Formato o redacción",
  other: "Otro",
};
export const FEEDBACK_TRIAGE_STATUSES = ["new", "reviewed", "dismissed", "converted"];
export const FEEDBACK_COMMENT_MAX_LENGTH = 1000;
export const FEEDBACK_TRIAGE_NOTE_MAX_LENGTH = 500;
// Comments may contain customer data: they are erased after this period (ratings are kept).
export const FEEDBACK_COMMENT_RETENTION_MONTHS = 12;

function createHttpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function cleanText(value, maxLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxLength) : null;
}

// Saves (or updates) the seller's rating of one completed turn of their own chat.
export async function submitCustomerChatFeedback({ user, jobId, rating, reasonCode = null, comment = null }) {
  await ensureCommercialIntelligenceSchema();
  if (!FEEDBACK_RATINGS.includes(rating)) throw createHttpError(400, "Calificación inválida");
  if (reasonCode !== null && !FEEDBACK_REASONS[reasonCode]) throw createHttpError(400, "Motivo inválido");
  const rows = await query(
    `SELECT id, account_id, status, request_json FROM customer_intelligence_jobs
     WHERE id = ? AND requested_by_user_id = ? AND job_type = 'account_chat' LIMIT 1`,
    [Number(jobId), Number(user.id)],
  );
  const job = rows[0];
  if (!job) throw createHttpError(404, "Respuesta no encontrada");
  if (job.status !== "completed") throw createHttpError(409, "Solo puedes calificar respuestas terminadas");
  const sessionId = Number(parseJson(job.request_json, {})?.chatSessionId || 0);
  if (!sessionId) throw createHttpError(409, "La respuesta no pertenece a una conversación");

  const negative = rating === "negative";
  const reason = negative ? reasonCode : null;
  const text = negative ? cleanText(comment, FEEDBACK_COMMENT_MAX_LENGTH) : null;
  await query(
    `INSERT INTO customer_chat_turn_feedback
       (job_id, session_id, account_id, user_id, rating, reason_code, comment, comment_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, IF(? IS NULL, NULL, NOW(3)))
     ON DUPLICATE KEY UPDATE
       comment_at = IF(VALUES(comment) IS NULL, NULL,
         IF(comment <=> VALUES(comment), comment_at, NOW(3))),
       rating = VALUES(rating),
       reason_code = VALUES(reason_code),
       comment = VALUES(comment),
       triage_status = IF(triage_status = 'converted', 'converted', 'new'),
       updated_at = NOW(3)`,
    [
      Number(jobId),
      sessionId,
      job.account_id === null ? null : Number(job.account_id),
      Number(user.id),
      rating,
      reason,
      text,
      text,
    ],
  );
  return { jobId: Number(jobId), rating, reasonCode: reason, hasComment: Boolean(text) };
}

// What the author can see about their own ratings. The comment text is never returned here.
export async function listOwnFeedbackForSession({ user, sessionId }) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT job_id, rating, reason_code, comment IS NOT NULL AS has_comment
     FROM customer_chat_turn_feedback WHERE session_id = ? AND user_id = ?`,
    [Number(sessionId), Number(user.id)],
  );
  return rows.map((row) => ({
    jobId: Number(row.job_id),
    rating: row.rating,
    reasonCode: row.reason_code || null,
    hasComment: Boolean(Number(row.has_comment)),
  }));
}

function triageFilters({ rating, triageStatus, reasonCode }) {
  const where = [];
  const params = [];
  if (rating && rating !== "all") {
    where.push("f.rating = ?");
    params.push(rating);
  }
  if (triageStatus && triageStatus !== "all") {
    where.push("f.triage_status = ?");
    params.push(triageStatus);
  }
  if (reasonCode && reasonCode !== "all") {
    where.push("f.reason_code = ?");
    params.push(reasonCode);
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

// Triage queue and summary for reviewers (route-level permission: mi_coach.chat_diagnostics).
export async function listFeedbackForTriage({
  rating = "negative",
  triageStatus = "all",
  reasonCode = "all",
  page = 1,
  pageSize = 10,
} = {}) {
  await ensureCommercialIntelligenceSchema();
  const safePage = Math.max(1, Math.trunc(Number(page) || 1));
  const safePageSize = Math.min(50, Math.max(1, Math.trunc(Number(pageSize) || 10)));
  const filters = triageFilters({ rating, triageStatus, reasonCode });

  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM customer_chat_turn_feedback f ${filters.sql}`,
    filters.params,
  );
  const rows = await query(
    `SELECT f.id, f.job_id, f.session_id, f.account_id, f.rating, f.reason_code, f.comment,
            f.triage_status, f.triage_note, f.triaged_at, f.evaluation_case_id, f.created_at,
            u.full_name AS user_name, u.email AS user_email,
            a.name AS account_name,
            JSON_UNQUOTE(JSON_EXTRACT(j.request_json, '$.question')) AS question,
            LEFT(JSON_UNQUOTE(JSON_EXTRACT(j.result_json, '$.answer')), 600) AS answer_excerpt,
            t.intent_subtype, t.response_type, t.latency_ms, t.error_code,
            reviewer.full_name AS triaged_by_name
     FROM customer_chat_turn_feedback f
     INNER JOIN users u ON u.id = f.user_id
     LEFT JOIN users reviewer ON reviewer.id = f.triaged_by_user_id
     LEFT JOIN accounts a ON a.id = f.account_id
     LEFT JOIN customer_intelligence_jobs j ON j.id = f.job_id
     LEFT JOIN coach_turn_quality_traces t ON t.id = (
       SELECT MAX(t2.id) FROM coach_turn_quality_traces t2
       WHERE t2.job_id = f.job_id AND t2.channel = 'customer_account'
     )
     ${filters.sql}
     ORDER BY f.created_at DESC, f.id DESC
     LIMIT ? OFFSET ?`,
    [...filters.params, safePageSize, (safePage - 1) * safePageSize],
  );

  const summaryRows = await query(
    `SELECT rating, reason_code, triage_status, COUNT(*) AS total
     FROM customer_chat_turn_feedback GROUP BY rating, reason_code, triage_status`,
  );
  const [{ completedTurns }] = await query(
    `SELECT COUNT(*) AS completedTurns FROM customer_intelligence_jobs
     WHERE job_type = 'account_chat' AND status = 'completed'`,
  );
  const summary = { positive: 0, negative: 0, byReason: {}, byStatus: {}, completedTurns: Number(completedTurns) };
  for (const row of summaryRows) {
    const count = Number(row.total);
    if (row.rating === "positive") summary.positive += count;
    if (row.rating !== "negative") continue;
    summary.negative += count;
    const reason = row.reason_code || "unspecified";
    summary.byReason[reason] = (summary.byReason[reason] || 0) + count;
    summary.byStatus[row.triage_status] = (summary.byStatus[row.triage_status] || 0) + count;
  }
  const rated = summary.positive + summary.negative;
  summary.negativeRatePct = rated ? Number(((summary.negative / rated) * 100).toFixed(1)) : 0;
  summary.feedbackRatePct = summary.completedTurns
    ? Number(((rated / summary.completedTurns) * 100).toFixed(1))
    : 0;

  return {
    page: safePage,
    pageSize: safePageSize,
    total: Number(total),
    summary,
    items: rows.map((row) => ({
      id: Number(row.id),
      jobId: Number(row.job_id),
      sessionId: Number(row.session_id),
      accountId: row.account_id === null ? null : Number(row.account_id),
      accountName: row.account_name || "",
      rating: row.rating,
      reasonCode: row.reason_code || null,
      comment: row.comment || "",
      triageStatus: row.triage_status,
      triageNote: row.triage_note || "",
      triagedAt: row.triaged_at || null,
      triagedByName: row.triaged_by_name || "",
      evaluationCaseId: row.evaluation_case_id || null,
      createdAt: row.created_at,
      userName: row.user_name || row.user_email || "",
      question: row.question || "",
      answerExcerpt: row.answer_excerpt || "",
      intent: row.intent_subtype || "",
      responseType: row.response_type || "",
      latencyMs: row.latency_ms === null || row.latency_ms === undefined ? null : Number(row.latency_ms),
      errorCode: row.error_code || "",
    })),
  };
}

export async function getFeedbackForTriage(feedbackId) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT f.*, a.name AS account_name,
            JSON_UNQUOTE(JSON_EXTRACT(j.request_json, '$.question')) AS question
     FROM customer_chat_turn_feedback f
     LEFT JOIN accounts a ON a.id = f.account_id
     LEFT JOIN customer_intelligence_jobs j ON j.id = f.job_id
     WHERE f.id = ? LIMIT 1`,
    [Number(feedbackId)],
  );
  return rows[0] || null;
}

export async function updateFeedbackTriage({ feedbackId, user, triageStatus, note = null }) {
  await ensureCommercialIntelligenceSchema();
  if (!["new", "reviewed", "dismissed"].includes(triageStatus)) throw createHttpError(400, "Estado inválido");
  const result = await query(
    `UPDATE customer_chat_turn_feedback
     SET triage_status = ?, triage_note = ?, triaged_by_user_id = ?, triaged_at = NOW(3)
     WHERE id = ? AND rating = 'negative' AND triage_status <> 'converted'`,
    [triageStatus, cleanText(note, FEEDBACK_TRIAGE_NOTE_MAX_LENGTH), Number(user.id), Number(feedbackId)],
  );
  if (!Number(result?.affectedRows || 0)) {
    throw createHttpError(404, "Feedback no encontrado o ya convertido en caso de prueba");
  }
  return { id: Number(feedbackId), triageStatus };
}

export async function markFeedbackConverted({ feedbackId, user, evaluationCaseId }) {
  await ensureCommercialIntelligenceSchema();
  await query(
    `UPDATE customer_chat_turn_feedback
     SET triage_status = 'converted', evaluation_case_id = ?, triaged_by_user_id = ?, triaged_at = NOW(3)
     WHERE id = ?`,
    [String(evaluationCaseId), Number(user.id), Number(feedbackId)],
  );
}

// Erases comment text older than the retention period; the rating and reason stay for statistics.
export async function purgeExpiredFeedbackComments({ months = FEEDBACK_COMMENT_RETENTION_MONTHS } = {}) {
  await ensureCommercialIntelligenceSchema();
  const result = await query(
    `UPDATE customer_chat_turn_feedback
     SET comment = NULL, comment_at = NULL
     WHERE comment IS NOT NULL AND comment_at < DATE_SUB(NOW(3), INTERVAL ? MONTH)`,
    [Number(months)],
  );
  return Number(result?.affectedRows || 0);
}

const RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
let retentionStarted = false;
export function startFeedbackRetentionWorker() {
  if (retentionStarted || process.env.NODE_ENV === "test") return;
  retentionStarted = true;
  const sweep = async () => {
    try {
      const purged = await purgeExpiredFeedbackComments();
      if (purged > 0) console.warn(`[customer-chat-feedback] ${purged} comentario(s) vencidos eliminados`);
    } catch (error) {
      console.error("[customer-chat-feedback] No fue posible purgar comentarios:", error?.message || error);
    }
  };
  void sweep();
  const timer = setInterval(() => void sweep(), RETENTION_SWEEP_INTERVAL_MS);
  timer.unref?.();
}
