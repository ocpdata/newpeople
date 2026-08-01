import { createHash, randomUUID } from "node:crypto";
import { logAuditEvent } from "../audit.js";
import { query, withTransaction } from "../db.js";
import { listOpportunityDocuments } from "../opportunity-documents/service.js";
import {
  isOpportunityStageAnswerSuggestionsEnabled,
  suggestOpportunityStageAnswers,
} from "../opportunityStageAnswerSuggestions.js";
import { ensureOpportunityStageAnswerSuggestionJobSchema } from "./schema.js";

const JOB_PUBLIC_ID_PREFIX = "suggjob_";
const PIPELINE_VERSION = "v1";
const JOB_RESULT_TTL_HOURS = 24;
const JOB_POLL_AFTER_MS = 3000;
const JOB_LEASE_SECONDS = 300;
const JOB_TIMEOUT_MAX_ATTEMPTS = 3;
const JOB_TIMEOUT_RETRY_DELAYS_SECONDS = [8, 20, 40];

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

function digestValue(value) {
  return createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
}

function buildDocumentFingerprintEntry(document) {
  return {
    publicId: String(document?.publicId || ""),
    originalFileName: String(document?.originalFileName || ""),
    mimeType: String(document?.mimeType || ""),
    byteSize: Number(document?.byteSize || 0),
    createdAt: String(document?.createdAt || ""),
    processingStatus: String(document?.processingStatus || ""),
    textDigest: digestValue(
      document?.normalizedText ||
        document?.rawText ||
        document?.transcriptText ||
        "",
    ),
  };
}

function buildAnswerFingerprintEntry(answer) {
  return {
    questionId: Number(answer?.question_id || 0),
    code: String(answer?.code || ""),
    answerValue: String(answer?.answer_value || ""),
    answeredAt: String(answer?.answered_at || ""),
  };
}

function buildSnapshot({ salesStage, questions, existingAnswers, documents }) {
  return {
    salesStage: {
      id: Number(salesStage?.id || 0),
      code: String(salesStage?.code || ""),
      name: String(salesStage?.name || ""),
    },
    questionIds: (Array.isArray(questions) ? questions : []).map((question) =>
      Number(question?.id || 0),
    ),
    answers: (Array.isArray(existingAnswers) ? existingAnswers : []).map(
      (answer) => ({
        questionId: Number(answer?.question_id || 0),
        answeredAt: String(answer?.answered_at || ""),
        answerDigest: digestValue(answer?.answer_value || ""),
      }),
    ),
    documents: (Array.isArray(documents) ? documents : []).map((document) => ({
      publicId: String(document?.publicId || ""),
      createdAt: String(document?.createdAt || ""),
      textDigest: digestValue(
        document?.normalizedText ||
          document?.rawText ||
          document?.transcriptText ||
          "",
      ),
    })),
  };
}

function buildRequestFingerprint({
  opportunityId,
  salesStage,
  questions,
  existingAnswers,
  documents,
}) {
  const payload = {
    opportunityId: Number(opportunityId || 0),
    pipelineVersion: PIPELINE_VERSION,
    salesStage: {
      id: Number(salesStage?.id || 0),
      code: String(salesStage?.code || ""),
      name: String(salesStage?.name || ""),
    },
    questions: (Array.isArray(questions) ? questions : []).map((question) => ({
      id: Number(question?.id || 0),
      code: String(question?.code || ""),
      prompt: String(question?.prompt || ""),
      responseType: String(question?.response_type || ""),
      isRequired: Boolean(question?.is_required),
    })),
    existingAnswers: (Array.isArray(existingAnswers) ? existingAnswers : [])
      .map(buildAnswerFingerprintEntry)
      .sort((left, right) => left.questionId - right.questionId),
    documents: (Array.isArray(documents) ? documents : [])
      .map(buildDocumentFingerprintEntry)
      .sort((left, right) => left.publicId.localeCompare(right.publicId)),
  };

  return `sha256:${createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")}`;
}

function buildPayloadResult({ salesStage, result }) {
  return {
    salesStageId: Number(salesStage?.id || 0),
    salesStageName: String(salesStage?.name || ""),
    suggestions: Array.isArray(result?.suggestions) ? result.suggestions : [],
    summary: result?.summary || {
      proposedCount: 0,
      fillCount: 0,
      replaceCount: 0,
      ambiguousCount: 0,
      insufficientCount: 0,
    },
    meta: result?.meta || {},
  };
}

function buildPollAfterMs(row) {
  const status = String(row?.status || "pending");
  if (!(status === "pending" || status === "running")) {
    return 0;
  }

  const leaseExpiresAt = row?.lease_expires_at
    ? new Date(row.lease_expires_at)
    : null;
  if (
    status === "pending" &&
    leaseExpiresAt &&
    !Number.isNaN(leaseExpiresAt.getTime())
  ) {
    const waitMs = Math.max(leaseExpiresAt.getTime() - Date.now(), 0);
    return Math.max(JOB_POLL_AFTER_MS, waitMs);
  }

  return JOB_POLL_AFTER_MS;
}

function buildReusableFlag(status) {
  return status === "pending" || status === "running" || status === "completed";
}

function serializeJobRow(row) {
  if (!row) return null;

  const result = parseJsonField(row.result_json, null);

  return {
    id: String(row.public_id || ""),
    opportunityId: Number(row.opportunity_id || 0),
    salesStageId: Number(row.sales_stage_id || 0),
    status: String(row.status || "pending"),
    resultAvailable: Boolean(row.status === "completed" && result),
    fingerprint: String(row.request_fingerprint || ""),
    isReusable: buildReusableFlag(String(row.status || "pending")),
    createdAt: row.created_at || null,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    expiresAt: row.expires_at || null,
    pollAfterMs: buildPollAfterMs(row),
    attemptCount: Number(row.attempt_count || 0),
    retry: {
      isRetryingTimeout:
        String(row.status || "") === "pending" &&
        String(row.error_code || "") === "retrying_openai_timeout",
      maxAttempts: JOB_TIMEOUT_MAX_ATTEMPTS,
      lastErrorCode: String(row.error_code || "").trim() || null,
      lastErrorMessage: String(row.error_message || "").trim() || null,
      nextAttemptAt: row.lease_expires_at || null,
    },
  };
}

function isOpenAiTimeoutError(error) {
  const message = String(error?.message || "");
  return message.includes("OpenAI request exceeded") && message.includes("ms");
}

function getTimeoutRetryDelaySeconds(attemptCount) {
  const index = Math.max(Number(attemptCount || 1) - 1, 0);
  return (
    JOB_TIMEOUT_RETRY_DELAYS_SECONDS[
      Math.min(index, JOB_TIMEOUT_RETRY_DELAYS_SECONDS.length - 1)
    ] ||
    JOB_TIMEOUT_RETRY_DELAYS_SECONDS[
      JOB_TIMEOUT_RETRY_DELAYS_SECONDS.length - 1
    ]
  );
}

async function requeueJobAfterTimeout({
  jobId,
  leaseToken,
  attemptCount,
  errorMessage,
}) {
  const delaySeconds = getTimeoutRetryDelaySeconds(attemptCount);
  await query(
    `UPDATE opportunity_stage_answer_suggestion_jobs
     SET status = 'pending',
         lease_token = NULL,
         lease_expires_at = DATE_ADD(NOW(3), INTERVAL ? SECOND),
         error_code = 'retrying_openai_timeout',
         error_message = ?,
         updated_at = NOW(3)
     WHERE id = ?
       AND lease_token = ?`,
    [
      delaySeconds,
      errorMessage ||
        "La generación excedió el tiempo de espera con OpenAI. Reintentando automáticamente.",
      Number(jobId),
      String(leaseToken || ""),
    ],
  );
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

  if (["failed", "stale", "expired"].includes(String(row?.status || ""))) {
    return {
      ...base,
      error: {
        code:
          String(row?.error_code || "").trim() ||
          (String(row?.status || "") === "stale"
            ? "stale_result"
            : String(row?.status || "") === "expired"
              ? "expired_result"
              : "generation_failed"),
        message:
          String(row?.error_message || "").trim() ||
          "No fue posible proponer respuestas documentales para la etapa seleccionada.",
      },
    };
  }

  return base;
}

async function getOpportunitySalesStageById(stageId) {
  const rows = await query(
    `SELECT id, code, name, stage_order
     FROM opportunity_sales_stages
     WHERE id = ?
       AND is_active = 1
     LIMIT 1`,
    [stageId],
  );
  return rows[0] || null;
}

async function getOpportunityStateById(opportunityId) {
  const rows = await query(
    `SELECT o.id, o.sales_stage_id, o.updated_at
     FROM opportunities o
     WHERE o.id = ?
     LIMIT 1`,
    [opportunityId],
  );
  return rows[0] || null;
}

async function getOpportunityStageQuestions(salesStageId) {
  return query(
    `SELECT id, sales_stage_id, code, prompt, response_type,
            display_order, is_required, is_active
     FROM opportunity_stage_questions
     WHERE sales_stage_id = ?
       AND is_active = 1
     ORDER BY display_order, id`,
    [salesStageId],
  );
}

async function getLatestOpportunityStageAnswers({
  opportunityId,
  salesStageId,
}) {
  return query(
    `SELECT q.id AS question_id,
            a.id AS stage_answer_id,
            q.code,
            q.prompt,
            q.response_type,
            q.display_order,
            q.is_required,
            a.answer_value,
            a.answered_at,
            a.answered_by_user_id
     FROM opportunity_stage_questions q
     LEFT JOIN opportunity_stage_question_answers a
       ON a.id = (
         SELECT a2.id
         FROM opportunity_stage_question_answers a2
         WHERE a2.opportunity_id = ?
           AND a2.sales_stage_id = ?
           AND a2.question_id = q.id
         ORDER BY a2.id DESC
         LIMIT 1
       )
     WHERE q.sales_stage_id = ?
       AND q.is_active = 1
     ORDER BY q.display_order, q.id`,
    [opportunityId, salesStageId, salesStageId],
  );
}

async function loadSuggestionJobContext({ opportunityId, salesStageId }) {
  const [opportunityState, salesStage, questions, existingAnswers, documents] =
    await Promise.all([
      getOpportunityStateById(opportunityId),
      getOpportunitySalesStageById(salesStageId),
      getOpportunityStageQuestions(salesStageId),
      getLatestOpportunityStageAnswers({
        opportunityId,
        salesStageId,
      }),
      listOpportunityDocuments({ opportunityId }),
    ]);

  return {
    opportunityState,
    salesStage,
    questions,
    existingAnswers,
    documents,
  };
}

async function expireOutdatedJobs() {
  await query(
    `UPDATE opportunity_stage_answer_suggestion_jobs
     SET status = 'expired',
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = NOW(3)
     WHERE status IN ('completed', 'failed', 'stale')
       AND expires_at IS NOT NULL
       AND expires_at <= NOW(3)`,
  );
}

async function getJobRowByPublicId({ publicId, opportunityId, salesStageId }) {
  await ensureOpportunityStageAnswerSuggestionJobSchema();
  await expireOutdatedJobs();
  const rows = await query(
    `SELECT *
     FROM opportunity_stage_answer_suggestion_jobs
     WHERE public_id = ?
       AND opportunity_id = ?
       AND sales_stage_id = ?
     LIMIT 1`,
    [publicId, Number(opportunityId), Number(salesStageId)],
  );
  return rows[0] || null;
}

async function getReusableJob({ opportunityId, salesStageId, fingerprint }) {
  const rows = await query(
    `SELECT *
     FROM opportunity_stage_answer_suggestion_jobs
     WHERE opportunity_id = ?
       AND sales_stage_id = ?
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
    [Number(opportunityId), Number(salesStageId), String(fingerprint)],
  );
  return rows[0] || null;
}

export async function createOrReuseOpportunityStageAnswerSuggestionJob({
  opportunityId,
  salesStageId,
  requestedByUserId,
  forceRegenerate = false,
}) {
  await ensureOpportunityStageAnswerSuggestionJobSchema();
  await expireOutdatedJobs();

  const context = await loadSuggestionJobContext({
    opportunityId,
    salesStageId,
  });

  if (!context.opportunityState) {
    const error = new Error("Oportunidad no encontrada");
    error.status = 404;
    throw error;
  }

  if (!context.salesStage) {
    const error = new Error("Etapa de venta no encontrada");
    error.status = 404;
    throw error;
  }

  const fingerprint = buildRequestFingerprint({
    opportunityId,
    salesStage: context.salesStage,
    questions: context.questions,
    existingAnswers: context.existingAnswers,
    documents: context.documents,
  });

  if (!forceRegenerate) {
    const existingJob = await getReusableJob({
      opportunityId,
      salesStageId,
      fingerprint,
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
  const sourceSnapshot = buildSnapshot({
    salesStage: context.salesStage,
    questions: context.questions,
    existingAnswers: context.existingAnswers,
    documents: context.documents,
  });

  await query(
    `INSERT INTO opportunity_stage_answer_suggestion_jobs
       (public_id, opportunity_id, sales_stage_id, requested_by_user_id, status,
        request_fingerprint, pipeline_version, attempt_count, expires_at,
        source_snapshot_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, 0,
             DATE_ADD(NOW(3), INTERVAL ? HOUR), ?, NOW(3), NOW(3))`,
    [
      publicId,
      Number(opportunityId),
      Number(salesStageId),
      Number(requestedByUserId),
      fingerprint,
      PIPELINE_VERSION,
      JOB_RESULT_TTL_HOURS,
      JSON.stringify(sourceSnapshot),
    ],
  );

  const row = await getJobRowByPublicId({
    publicId,
    opportunityId,
    salesStageId,
  });

  return {
    row,
    response: buildJobResponse(row),
    wasReused: false,
  };
}

export async function getOpportunityStageAnswerSuggestionJob({
  publicId,
  opportunityId,
  salesStageId,
}) {
  const row = await getJobRowByPublicId({
    publicId,
    opportunityId,
    salesStageId,
  });
  return row ? buildJobResponse(row) : null;
}

async function claimNextPendingJob() {
  const candidates = await query(
    `SELECT id
     FROM opportunity_stage_answer_suggestion_jobs
     WHERE (
        (
          status = 'pending'
          AND (lease_expires_at IS NULL OR lease_expires_at <= NOW(3))
        )
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
        `UPDATE opportunity_stage_answer_suggestion_jobs
         SET status = 'running',
             attempt_count = attempt_count + 1,
             lease_token = ?,
             lease_expires_at = DATE_ADD(NOW(3), INTERVAL ? SECOND),
             started_at = COALESCE(started_at, NOW(3)),
             updated_at = NOW(3)
         WHERE id = ?
           AND (
             (
               status = 'pending'
               AND (lease_expires_at IS NULL OR lease_expires_at <= NOW(3))
             )
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
         FROM opportunity_stage_answer_suggestion_jobs
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
  summary,
  meta,
  errorCode,
  errorMessage,
}) {
  await query(
    `UPDATE opportunity_stage_answer_suggestion_jobs
     SET status = ?,
         result_json = ?,
         summary_json = ?,
         meta_json = ?,
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
      summary ? JSON.stringify(summary) : null,
      meta ? JSON.stringify(meta) : null,
      errorCode || null,
      errorMessage || null,
      Number(jobId),
      String(leaseToken || ""),
    ],
  );
}

async function processSingleJob(row) {
  const jobId = Number(row?.id || 0);
  const leaseToken = String(row?.lease_token || "");
  const opportunityId = Number(row?.opportunity_id || 0);
  const salesStageId = Number(row?.sales_stage_id || 0);
  const attemptCount = Number(row?.attempt_count || 0);

  if (!jobId || !leaseToken || !opportunityId || !salesStageId) {
    return false;
  }

  if (!isOpportunityStageAnswerSuggestionsEnabled()) {
    await updateJobStatus({
      jobId,
      leaseToken,
      status: "failed",
      errorCode: "feature_disabled",
      errorMessage:
        "Las sugerencias documentales de respuestas no estan habilitadas.",
    });
    return true;
  }

  const context = await loadSuggestionJobContext({
    opportunityId,
    salesStageId,
  });

  if (!context.opportunityState || !context.salesStage) {
    await updateJobStatus({
      jobId,
      leaseToken,
      status: "failed",
      errorCode: "resource_not_found",
      errorMessage: "La oportunidad o la etapa seleccionada ya no existen.",
    });
    return true;
  }

  const currentFingerprint = buildRequestFingerprint({
    opportunityId,
    salesStage: context.salesStage,
    questions: context.questions,
    existingAnswers: context.existingAnswers,
    documents: context.documents,
  });

  if (currentFingerprint !== String(row.request_fingerprint || "")) {
    await updateJobStatus({
      jobId,
      leaseToken,
      status: "stale",
      errorCode: "stale_result",
      errorMessage:
        "La evidencia o las respuestas cambiaron mientras se generaban las sugerencias. Solicita una nueva corrida.",
    });
    return true;
  }

  try {
    const aiUsageRequestIds = [];
    const result = await suggestOpportunityStageAnswers({
      salesStage: context.salesStage,
      questions: context.questions,
      existingAnswers: context.existingAnswers,
      documents: context.documents,
      aiUsageContext: {
        userId: Number(row.requested_by_user_id || 0),
        featureCode: "opportunities.stage_suggestions",
        jobType: "opportunity_stage_answer_suggestion_job",
        jobId,
        aiUsageRequestIds,
      },
    });

    const postContext = await loadSuggestionJobContext({
      opportunityId,
      salesStageId,
    });
    const postFingerprint = buildRequestFingerprint({
      opportunityId,
      salesStage: postContext.salesStage || context.salesStage,
      questions: postContext.questions || context.questions,
      existingAnswers: postContext.existingAnswers || context.existingAnswers,
      documents: postContext.documents || context.documents,
    });

    if (postFingerprint !== String(row.request_fingerprint || "")) {
      await updateJobStatus({
        jobId,
        leaseToken,
        status: "stale",
        errorCode: "stale_result",
        errorMessage:
          "La evidencia o las respuestas cambiaron mientras se generaban las sugerencias. Solicita una nueva corrida.",
      });
      return true;
    }

    const payload = buildPayloadResult({
      salesStage: context.salesStage,
      result,
    });

    await updateJobStatus({
      jobId,
      leaseToken,
      status: "completed",
      result: payload,
      summary: payload.summary,
      meta: payload.meta,
    });
    await logAuditEvent({
      actor: { id: Number(row.requested_by_user_id || 0) || null },
      module: "oportunidades",
      action: "stage_answer_suggestions_generated",
      entityType: "opportunity",
      entityId: opportunityId,
      detail: `Sugerencias IA generadas para etapa ${String(context.salesStage?.name || salesStageId)}`,
      aiUsageRequestIds,
    });
    return true;
  } catch (error) {
    if (
      isOpenAiTimeoutError(error) &&
      attemptCount < JOB_TIMEOUT_MAX_ATTEMPTS
    ) {
      await requeueJobAfterTimeout({
        jobId,
        leaseToken,
        attemptCount,
        errorMessage: String(error?.message || "").trim(),
      });
      return true;
    }

    await updateJobStatus({
      jobId,
      leaseToken,
      status: "failed",
      errorCode: String(error?.code || "generation_failed"),
      errorMessage:
        String(error?.message || "").trim() ||
        "No fue posible proponer respuestas documentales para la etapa seleccionada.",
    });
    return true;
  }
}

export async function processPendingOpportunityStageAnswerSuggestionJobs({
  limit = 5,
} = {}) {
  await ensureOpportunityStageAnswerSuggestionJobSchema();
  await expireOutdatedJobs();

  let processedCount = 0;

  for (let index = 0; index < limit; index += 1) {
    const nextJob = await claimNextPendingJob();
    if (!nextJob) {
      break;
    }

    await processSingleJob(nextJob);
    processedCount += 1;
  }

  return { processedCount };
}
