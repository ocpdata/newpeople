// Support view of existing-customer chats: listing, reading and closing diagnostics.

import { config } from "../config.js";
import { ensureCommercialIntelligenceSchema } from "./schema.js";
import { getCommercialSettings } from "../settings.js";
import { logAuditEvent } from "../audit.js";
import { query, withTransaction } from "../db.js";
import { createHttpError, hasPermission, parseJson } from "./service-helpers.js";

export async function listCustomerAccountChatDiagnostics({
  queryText = "",
  status = "all",
  reviewStatus = "all",
  accountId = null,
  dateFrom = "",
  dateTo = "",
  page = 1,
  pageSize = 10,
}) {
  await ensureCommercialIntelligenceSchema();
  const safePage = Math.max(1, Math.trunc(Number(page) || 1));
  const safePageSize = Math.min(
    100,
    Math.max(1, Math.trunc(Number(pageSize) || 10)),
  );
  const offset = (safePage - 1) * safePageSize;
  const search = String(queryText || "")
    .trim()
    .slice(0, 160);
  const params = [];
  const filters = [];
  if (search) {
    const like = `%${search}%`;
    filters.push(
      `(CAST(s.id AS CHAR) = ? OR EXISTS (
         SELECT 1 FROM customer_intelligence_jobs searched_job
         WHERE searched_job.job_type = 'account_chat'
           AND searched_job.requested_by_user_id = s.requested_by_user_id
           AND CAST(JSON_UNQUOTE(JSON_EXTRACT(searched_job.request_json, '$.chatSessionId')) AS UNSIGNED) = s.id
           AND CAST(searched_job.id AS CHAR) = ?
       ) OR u.full_name LIKE ? OR u.email LIKE ? OR COALESCE(a.name, '') LIKE ?)`,
    );
    params.push(search, search, like, like, like);
  }
  const safeAccountId = Number(accountId || 0);
  if (Number.isInteger(safeAccountId) && safeAccountId > 0) {
    filters.push("s.account_id = ?");
    params.push(safeAccountId);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateFrom || ""))) {
    filters.push("DATE(s.created_at) >= ?");
    params.push(dateFrom);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateTo || ""))) {
    filters.push("DATE(s.created_at) <= ?");
    params.push(dateTo);
  }
  if (status === "errors") {
    filters.push(
      `EXISTS (
         SELECT 1 FROM customer_intelligence_jobs filtered_job
         WHERE filtered_job.job_type = 'account_chat'
           AND filtered_job.requested_by_user_id = s.requested_by_user_id
           AND CAST(JSON_UNQUOTE(JSON_EXTRACT(filtered_job.request_json, '$.chatSessionId')) AS UNSIGNED) = s.id
           AND (filtered_job.status = 'failed' OR JSON_UNQUOTE(JSON_EXTRACT(filtered_job.result_json, '$.responseType')) = 'error')
       )`,
    );
  } else if (status === "active") {
    filters.push(
      `EXISTS (
         SELECT 1 FROM customer_intelligence_jobs filtered_job
         WHERE filtered_job.job_type = 'account_chat'
           AND filtered_job.requested_by_user_id = s.requested_by_user_id
           AND CAST(JSON_UNQUOTE(JSON_EXTRACT(filtered_job.request_json, '$.chatSessionId')) AS UNSIGNED) = s.id
           AND filtered_job.status IN ('pending', 'processing')
       )`,
    );
  }
  if (reviewStatus === "closed") filters.push("r.session_id IS NOT NULL AND r.closed_through_job_id = COALESCE(j.id, 0)");
  if (reviewStatus === "pending") filters.push("(r.session_id IS NULL OR r.closed_through_job_id <> COALESCE(j.id, 0))");
  const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const latestJobJoin = `LEFT JOIN customer_intelligence_jobs j
    ON j.id = (
      SELECT MAX(j2.id)
      FROM customer_intelligence_jobs j2
      WHERE j2.job_type = 'account_chat'
        AND j2.requested_by_user_id = s.requested_by_user_id
        AND CAST(JSON_UNQUOTE(JSON_EXTRACT(j2.request_json, '$.chatSessionId')) AS UNSIGNED) = s.id
    )
    LEFT JOIN customer_chat_diagnostic_reviews r ON r.session_id = s.id
    LEFT JOIN users reviewer ON reviewer.id = r.closed_by_user_id`;
  const countRows = await query(
    `SELECT COUNT(*) AS total
     FROM customer_intelligence_chat_sessions s
     INNER JOIN users u ON u.id = s.requested_by_user_id
     LEFT JOIN accounts a ON a.id = s.account_id
     ${latestJobJoin}
     ${whereSql}`,
    params,
  );
  const rows = await query(
    `SELECT s.id AS session_id, s.public_id AS session_public_id,
            r.closed_at, r.closed_through_job_id, reviewer.full_name AS reviewer_name,
            s.account_id, a.name AS account_name,
            s.requested_by_user_id AS user_id, u.full_name AS user_name,
            u.email AS user_email, s.created_at AS session_created_at,
            s.updated_at AS session_updated_at, j.id AS job_id,
            j.status AS job_status, j.created_at AS job_created_at,
            j.finished_at AS job_finished_at,
            JSON_UNQUOTE(JSON_EXTRACT(j.request_json, '$.question')) AS question,
            JSON_UNQUOTE(JSON_EXTRACT(j.result_json, '$.responseType')) AS response_type,
            JSON_UNQUOTE(JSON_EXTRACT(j.result_json, '$.answer')) AS answer,
            JSON_UNQUOTE(JSON_EXTRACT(j.result_json, '$.debug.issue.title')) AS issue_title,
            JSON_UNQUOTE(JSON_EXTRACT(j.result_json, '$.debug.issue.block')) AS issue_block
     FROM customer_intelligence_chat_sessions s
     INNER JOIN users u ON u.id = s.requested_by_user_id
     LEFT JOIN accounts a ON a.id = s.account_id
     ${latestJobJoin}
     ${whereSql}
     ORDER BY COALESCE(j.created_at, s.updated_at) DESC, s.id DESC
     LIMIT ? OFFSET ?`,
    [...params, safePageSize, offset],
  );
  return {
    page: safePage,
    pageSize: safePageSize,
    businessTimezone: (await getCommercialSettings()).businessTimezone || config.app.businessTimezone,
    total: Number(countRows[0]?.total || 0),
    sessions: rows.map((row) => ({
      sessionId: Number(row.session_id),
      sessionPublicId: row.session_public_id,
      accountId: row.account_id === null ? null : Number(row.account_id),
      accountName: row.account_name || "",
      userId: Number(row.user_id),
      userName: row.user_name || "",
      userEmail: row.user_email || "",
      sessionCreatedAt: row.session_created_at,
      sessionUpdatedAt: row.session_updated_at,
      diagnosticReview: {
        status: row.closed_at && Number(row.closed_through_job_id) === Number(row.job_id || 0) ? "closed" : "pending",
        closedAt: row.closed_at || null,
        closedByName: row.reviewer_name || "",
      },
      latestJob: row.job_id
        ? {
            jobId: Number(row.job_id),
            status: row.job_status,
            createdAt: row.job_created_at,
            finishedAt: row.job_finished_at,
            question: row.question || "",
            responseType: row.response_type || null,
            answer: row.answer || "",
            issueTitle: row.issue_title || null,
            issueBlock: row.issue_block || null,
          }
        : null,
    })),
  };
}

export async function getCustomerAccountChatDiagnosticSession({
  sessionId,
  jobId,
}) {
  await ensureCommercialIntelligenceSchema();
  let resolvedSessionId = Number(sessionId || 0);
  let selectedJobId = Number(jobId || 0);
  if (!resolvedSessionId && selectedJobId > 0) {
    const jobRows = await query(
      `SELECT id, request_json
       FROM customer_intelligence_jobs
       WHERE id = ? AND job_type = 'account_chat'
       LIMIT 1`,
      [selectedJobId],
    );
    const jobRow = jobRows[0];
    if (!jobRow) return null;
    const request = parseJson(jobRow.request_json, {});
    resolvedSessionId = Number(request.chatSessionId || 0);
  }
  if (!Number.isInteger(resolvedSessionId) || resolvedSessionId <= 0)
    return null;
  const sessionRows = await query(
    `SELECT s.id, s.public_id, s.account_id, s.opportunity_id, s.contact_id,
            s.history_json, s.created_at, s.updated_at,
            u.id AS user_id, u.full_name AS user_name, u.email AS user_email,
            a.name AS account_name
     FROM customer_intelligence_chat_sessions s
     INNER JOIN users u ON u.id = s.requested_by_user_id
     LEFT JOIN accounts a ON a.id = s.account_id
     WHERE s.id = ?
     LIMIT 1`,
    [resolvedSessionId],
  );
  const session = sessionRows[0];
  if (!session) return null;
  const jobRows = await query(
    `SELECT id, status, request_json, result_json, error_message,
            created_at, finished_at
     FROM customer_intelligence_jobs
     WHERE job_type = 'account_chat'
       AND requested_by_user_id = ?
       AND CAST(JSON_UNQUOTE(JSON_EXTRACT(request_json, '$.chatSessionId')) AS UNSIGNED) = ?
       AND (id = ? OR id IN (
         SELECT recent_job.id
         FROM (
           SELECT id
           FROM customer_intelligence_jobs
           WHERE job_type = 'account_chat'
             AND requested_by_user_id = ?
             AND CAST(JSON_UNQUOTE(JSON_EXTRACT(request_json, '$.chatSessionId')) AS UNSIGNED) = ?
           ORDER BY id DESC
           LIMIT 40
         ) recent_job
       ))
     ORDER BY (id = ?) DESC, id DESC
     LIMIT 40`,
    [
      Number(session.user_id),
      resolvedSessionId,
      selectedJobId,
      Number(session.user_id),
      resolvedSessionId,
      selectedJobId,
    ],
  );
  const history = parseJson(session.history_json, []);
  const reviewRows = await query(
    `SELECT r.closed_at, r.closed_through_job_id, u.full_name AS reviewer_name,
      (SELECT COALESCE(MAX(j.id), 0) FROM customer_intelligence_jobs j
       WHERE j.job_type = 'account_chat' AND j.requested_by_user_id = ?
       AND CAST(JSON_UNQUOTE(JSON_EXTRACT(j.request_json, '$.chatSessionId')) AS UNSIGNED) = ?) AS latest_job_id
     FROM customer_chat_diagnostic_reviews r LEFT JOIN users u ON u.id = r.closed_by_user_id
     WHERE r.session_id = ?`, [Number(session.user_id), resolvedSessionId, resolvedSessionId],
  );
  const review = reviewRows[0];
  return {
    session: {
      id: Number(session.id),
      publicId: session.public_id,
      accountId:
        session.account_id === null ? null : Number(session.account_id),
      accountName: session.account_name || "",
      opportunityId:
        session.opportunity_id === null ? null : Number(session.opportunity_id),
      contactId:
        session.contact_id === null ? null : Number(session.contact_id),
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      diagnosticReview: {
        status: review && Number(review.closed_through_job_id) === Number(review.latest_job_id) ? "closed" : "pending",
        closedAt: review?.closed_at || null,
        closedByName: review?.reviewer_name || "",
      },
      user: {
        id: Number(session.user_id),
        name: session.user_name || "",
        email: session.user_email || "",
      },
      history: Array.isArray(history) ? history.slice(-80) : [],
      jobs: jobRows.map((row) => {
        const request = parseJson(row.request_json, {});
        const result = parseJson(row.result_json, {});
        return {
          id: Number(row.id),
          status: row.status,
          createdAt: row.created_at,
          finishedAt: row.finished_at,
          question: String(request.question || ""),
          errorMessage: row.error_message || null,
          response: {
            answer: String(result.answer || ""),
            responseType: result.responseType || null,
            entities: result.entities || {},
          },
          debug: result.debug || null,
        };
      }),
      selectedJobId: selectedJobId || null,
    },
  };
}

export async function closeCustomerChatDiagnostic({ user, sessionId, latestJobId, req }) {
  if (!hasPermission(user, "mi_coach.chat_diagnostics")) throw createHttpError(403, "No autorizado");
  await ensureCommercialIntelligenceSchema();
  await withTransaction(async (connection) => {
    const [sessions] = await connection.query(
      "SELECT id, requested_by_user_id FROM customer_intelligence_chat_sessions WHERE id = ? FOR UPDATE", [sessionId],
    );
    if (!sessions.length) throw createHttpError(404, "Sesion de chat no encontrada");
    const [jobs] = await connection.query(
      `SELECT id, status FROM customer_intelligence_jobs WHERE job_type = 'account_chat'
       AND requested_by_user_id = ?
       AND CAST(JSON_UNQUOTE(JSON_EXTRACT(request_json, '$.chatSessionId')) AS UNSIGNED) = ?
       ORDER BY id DESC`, [sessions[0].requested_by_user_id, sessionId],
    );
    const currentJobId = Number(jobs[0]?.id || 0);
    if (currentJobId !== latestJobId) throw createHttpError(409, "La sesión tiene nuevos turnos. Actualiza y revísalos antes de cerrar el diagnóstico.");
    if (jobs.some((job) => ["pending", "processing"].includes(job.status))) {
      throw createHttpError(409, "Espera a que terminen los turnos en proceso antes de cerrar el diagnóstico.");
    }
    const [reviews] = await connection.query(
      "SELECT closed_through_job_id FROM customer_chat_diagnostic_reviews WHERE session_id = ?", [sessionId],
    );
    if (reviews.length && Number(reviews[0].closed_through_job_id) === currentJobId) return;
    await connection.query(
      `INSERT INTO customer_chat_diagnostic_reviews (session_id, closed_through_job_id, closed_by_user_id, closed_at)
       VALUES (?, ?, ?, NOW(3)) ON DUPLICATE KEY UPDATE
       closed_through_job_id = VALUES(closed_through_job_id), closed_by_user_id = VALUES(closed_by_user_id), closed_at = NOW(3)`,
      [sessionId, currentJobId, user.id],
    );
    await logAuditEvent({
      req, actor: user, module: "mi_coach", action: "close_chat_diagnostic",
      entityType: "customer_chat_session", entityId: sessionId,
      after: { reviewStatus: "closed", closedThroughJobId: currentJobId },
      connection, required: true,
    });
  });
}
