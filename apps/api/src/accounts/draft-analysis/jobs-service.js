import { createHash, randomUUID } from "node:crypto";
import { getUserAuthContext } from "../../auth.js";
import { query, withTransaction } from "../../db.js";
import { ensureAccountDraftAnalysisJobSchema } from "./jobs-schema.js";
import {
  normalizeAccountDraft,
  normalizeDraftAnalysisOptions,
} from "./schemas.js";
import * as draftAnalysisService from "./service.js";

const JOB_PUBLIC_ID_PREFIX = "acctdraftjob_";
const PIPELINE_VERSION = "v1";
const JOB_RESULT_TTL_HOURS = 24;
const JOB_POLL_AFTER_MS = 3000;
const JOB_LEASE_SECONDS = 300;
const JOB_MAX_TRANSIENT_RETRIES = 3;

function parseJsonField(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  return value;
}

function buildJobPublicId() {
  return `${JOB_PUBLIC_ID_PREFIX}${randomUUID().replace(/-/g, "")}`;
}

function buildSnapshot({ draft, options, requestedByUserId }) {
  return {
    requestedByUserId: Number(requestedByUserId || 0),
    draft: normalizeAccountDraft(draft),
    options: normalizeDraftAnalysisOptions(options),
  };
}

function buildRequestFingerprint({ draft, options, requestedByUserId }) {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        pipelineVersion: PIPELINE_VERSION,
        ...buildSnapshot({ draft, options, requestedByUserId }),
      }),
    )
    .digest("hex")}`;
}

function buildPollAfterMs(status) {
  return status === "pending" || status === "running" ? JOB_POLL_AFTER_MS : 0;
}

function buildReusableFlag(status) {
  return status === "pending" || status === "running" || status === "completed";
}

function serializeJobRow(row) {
  if (!row) return null;

  const result = parseJsonField(row.result_json, null);

  return {
    id: String(row.public_id || ""),
    requestedByUserId: Number(row.requested_by_user_id || 0),
    status: String(row.status || "pending"),
    resultAvailable: Boolean(row.status === "completed" && result),
    fingerprint: String(row.request_fingerprint || ""),
    isReusable: buildReusableFlag(String(row.status || "pending")),
    createdAt: row.created_at || null,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    expiresAt: row.expires_at || null,
    pollAfterMs: buildPollAfterMs(String(row.status || "pending")),
  };
}

function buildJobResponse(row) {
  const result = parseJsonField(row?.result_json, null);
  const base = {
    job: serializeJobRow(row),
  };

  if (String(row?.status || "") === "completed" && result) {
    return {
      ...base,
      result,
    };
  }

  if (["failed", "expired"].includes(String(row?.status || ""))) {
    return {
      ...base,
      error: {
        code:
          String(row?.error_code || "").trim() ||
          (String(row?.status || "") === "expired"
            ? "expired_result"
            : "generation_failed"),
        message:
          String(row?.error_message || "").trim() ||
          "No fue posible analizar el borrador de cuenta.",
      },
    };
  }

  return base;
}

async function expireOutdatedJobs() {
  await query(
    `UPDATE account_draft_analysis_jobs
     SET status = 'expired',
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = NOW(3)
     WHERE status IN ('completed', 'failed')
       AND expires_at IS NOT NULL
       AND expires_at <= NOW(3)`,
  );
}

async function getJobRowByPublicId(publicId) {
  await ensureAccountDraftAnalysisJobSchema();
  await expireOutdatedJobs();

  const rows = await query(
    `SELECT *
     FROM account_draft_analysis_jobs
     WHERE public_id = ?
     LIMIT 1`,
    [publicId],
  );
  return rows[0] || null;
}

async function getReusableJob({ fingerprint, requestedByUserId }) {
  const rows = await query(
    `SELECT *
     FROM account_draft_analysis_jobs
     WHERE requested_by_user_id = ?
       AND request_fingerprint = ?
       AND status IN ('pending', 'running', 'completed')
       AND (expires_at IS NULL OR expires_at > NOW(3))
     ORDER BY
       CASE status
         WHEN 'completed' THEN 0
         WHEN 'running' THEN 1
         ELSE 2
       END,
       finished_at DESC,
       created_at DESC
     LIMIT 1`,
    [Number(requestedByUserId), String(fingerprint)],
  );
  return rows[0] || null;
}

export async function createOrReuseAccountDraftAnalysisJob({
  draft,
  options,
  requestedByUserId,
  forceRegenerate = false,
}) {
  await ensureAccountDraftAnalysisJobSchema();
  await expireOutdatedJobs();

  const normalizedDraft = normalizeAccountDraft(draft);
  const normalizedOptions = normalizeDraftAnalysisOptions(options);
  const fingerprint = buildRequestFingerprint({
    draft: normalizedDraft,
    options: normalizedOptions,
    requestedByUserId,
  });

  if (!forceRegenerate) {
    const existingJob = await getReusableJob({
      fingerprint,
      requestedByUserId,
    });
    if (existingJob) {
      return {
        row: existingJob,
        response: buildJobResponse(existingJob),
        wasReused: true,
      };
    }
  }

  const publicId = buildJobPublicId();
  const snapshot = buildSnapshot({
    draft: normalizedDraft,
    options: normalizedOptions,
    requestedByUserId,
  });

  await query(
    `INSERT INTO account_draft_analysis_jobs
       (public_id, requested_by_user_id, status, request_fingerprint,
        pipeline_version, attempt_count, expires_at, source_snapshot_json,
        created_at, updated_at)
     VALUES (?, ?, 'pending', ?, ?, 0,
             DATE_ADD(NOW(3), INTERVAL ? HOUR), ?, NOW(3), NOW(3))`,
    [
      publicId,
      Number(requestedByUserId),
      fingerprint,
      PIPELINE_VERSION,
      JOB_RESULT_TTL_HOURS,
      JSON.stringify(snapshot),
    ],
  );

  const row = await getJobRowByPublicId(publicId);

  return {
    row,
    response: buildJobResponse(row),
    wasReused: false,
  };
}

export async function getAccountDraftAnalysisJob(publicId) {
  const row = await getJobRowByPublicId(publicId);
  return row ? buildJobResponse(row) : null;
}

async function claimNextPendingJob() {
  const candidates = await query(
    `SELECT id
     FROM account_draft_analysis_jobs
     WHERE (
         status = 'pending'
         OR (
           status = 'running'
           AND lease_expires_at IS NOT NULL
           AND lease_expires_at <= NOW(3)
         )
       )
       AND (expires_at IS NULL OR expires_at > NOW(3))
     ORDER BY created_at ASC, id ASC
     LIMIT 20`,
  );

  for (const candidate of candidates) {
    const leaseToken = randomUUID().replace(/-/g, "");
    const row = await withTransaction(async (conn) => {
      const [updateResult] = await conn.query(
        `UPDATE account_draft_analysis_jobs
         SET status = 'running',
             attempt_count = attempt_count + 1,
             lease_token = ?,
             lease_expires_at = DATE_ADD(NOW(3), INTERVAL ? SECOND),
             started_at = COALESCE(started_at, NOW(3)),
             updated_at = NOW(3)
         WHERE id = ?
           AND (
             status = 'pending'
             OR (
               status = 'running'
               AND lease_expires_at IS NOT NULL
               AND lease_expires_at <= NOW(3)
             )
           )`,
        [leaseToken, JOB_LEASE_SECONDS, Number(candidate.id)],
      );

      if (!updateResult.affectedRows) {
        return null;
      }

      const [rows] = await conn.query(
        `SELECT *
         FROM account_draft_analysis_jobs
         WHERE id = ?
         LIMIT 1`,
        [Number(candidate.id)],
      );

      return rows[0] || null;
    });

    if (row) {
      return row;
    }
  }

  return null;
}

async function updateJobStatus({
  jobId,
  leaseToken,
  status,
  result,
  errorCode,
  errorMessage,
}) {
  await query(
    `UPDATE account_draft_analysis_jobs
     SET status = ?,
         result_json = ?,
         error_code = ?,
         error_message = ?,
         finished_at = NOW(3),
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = NOW(3)
     WHERE id = ?
       AND lease_token = ?`,
    [
      status,
      result ? JSON.stringify(result) : null,
      errorCode || null,
      errorMessage || null,
      Number(jobId),
      String(leaseToken || ""),
    ],
  );
}

function isTransientAiNetworkError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  const code = String(error?.code || "").toUpperCase();

  if (["ETIMEDOUT", "ECONNRESET", "ECONNABORTED", "EAI_AGAIN"].includes(code)) {
    return true;
  }

  return (
    message.includes("etimedout") ||
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("econnaborted") ||
    message.includes("eai_again") ||
    message.includes("abort")
  );
}

async function requeueJobForRetry({ jobId, leaseToken, errorMessage }) {
  await query(
    `UPDATE account_draft_analysis_jobs
     SET status = 'pending',
         error_code = 'transient_retry',
         error_message = ?,
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = NOW(3)
     WHERE id = ?
       AND lease_token = ?`,
    [
      String(errorMessage || "").trim() ||
        "Reintentando por timeout temporal del proveedor IA.",
      Number(jobId),
      String(leaseToken || ""),
    ],
  );
}

async function processSingleJob(row) {
  const jobId = Number(row?.id || 0);
  const leaseToken = String(row?.lease_token || "");
  const requestedByUserId = Number(row?.requested_by_user_id || 0);
  const snapshot = parseJsonField(row?.source_snapshot_json, null);

  if (!jobId || !leaseToken || !requestedByUserId || !snapshot) {
    return false;
  }

  const user = await getUserAuthContext(requestedByUserId);
  if (!user || user.status !== "active") {
    await updateJobStatus({
      jobId,
      leaseToken,
      status: "failed",
      errorCode: "user_not_available",
      errorMessage:
        "El usuario solicitante ya no esta disponible para ejecutar el analisis.",
    });
    return true;
  }

  try {
    const result = await draftAnalysisService.analyzeAccountDraft({
      draft: snapshot.draft,
      options: snapshot.options,
      user,
      aiUsageContext: {
        userId: requestedByUserId,
        featureCode: "accounts.draft_analysis",
        jobType: "account_draft_analysis",
        jobId,
      },
    });

    await updateJobStatus({
      jobId,
      leaseToken,
      status: "completed",
      result,
    });
    return true;
  } catch (error) {
    const attemptCount = Number(row?.attempt_count || 0);
    const isTransientError = isTransientAiNetworkError(error);
    const shouldRetryTransientError =
      isTransientError && attemptCount < JOB_MAX_TRANSIENT_RETRIES;

    if (shouldRetryTransientError) {
      await requeueJobForRetry({
        jobId,
        leaseToken,
        errorMessage: String(error?.message || "").trim(),
      });
      return true;
    }

    await updateJobStatus({
      jobId,
      leaseToken,
      status: "failed",
      errorCode: "generation_failed",
      errorMessage: isTransientError
        ? "No fue posible completar el analisis IA del borrador tras varios reintentos. Intenta nuevamente en unos segundos."
        : String(error?.message || "").trim() ||
          "No fue posible analizar el borrador de cuenta.",
    });
    return true;
  }
}

export async function processPendingAccountDraftAnalysisJobs({
  limit = 5,
} = {}) {
  await ensureAccountDraftAnalysisJobSchema();
  await expireOutdatedJobs();

  let processedCount = 0;

  for (let index = 0; index < limit; index += 1) {
    const nextJob = await claimNextPendingJob();
    if (!nextJob) break;

    await processSingleJob(nextJob);
    processedCount += 1;
  }

  return { processedCount };
}
