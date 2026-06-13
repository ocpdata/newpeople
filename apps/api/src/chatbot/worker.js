import { randomUUID } from "node:crypto";
import { getUserAuthContext } from "../auth.js";
import { query } from "../db.js";
import {
  buildPublicId,
  CHATBOT_JOB_LEASE_SECONDS,
  CHATBOT_JOB_POLL_AFTER_MS,
  CHATBOT_JOB_RESULT_TTL_MINUTES,
  parseJson,
} from "./common.js";
import { runChatbotPipeline } from "./index.js";

let chatbotWorkerStarted = false;
let chatbotWorkerQueued = false;

export function buildJobResponse(row) {
  const result = parseJson(row?.result_json, null);
  const source = parseJson(row?.request_json, {});

  return {
    jobId: String(row?.public_id || ""),
    status: String(row?.status || "queued"),
    progress: Number(row?.progress || 0),
    startedAt: row?.started_at || null,
    finishedAt: row?.finished_at || null,
    result,
    source,
    error:
      row?.error_code || row?.error_message
        ? {
            code: String(row.error_code || "chatbot_job_failed"),
            message:
              String(
                row.error_message ||
                  "No fue posible completar la respuesta del chatbot",
              ).trim() || "No fue posible completar la respuesta del chatbot",
          }
        : null,
  };
}

async function claimNextChatbotJob() {
  const candidates = await query(
    `SELECT *
     FROM chatbot_jobs
     WHERE (
       status = 'queued'
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
    const updateResult = await query(
      `UPDATE chatbot_jobs
       SET status = 'running',
           attempts = attempts + 1,
           lease_token = ?,
           lease_expires_at = DATE_ADD(NOW(3), INTERVAL ? SECOND),
           started_at = COALESCE(started_at, NOW(3)),
           progress = 10,
           updated_at = NOW(3)
       WHERE id = ?
         AND (
           status = 'queued'
           OR (
             status = 'running'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at <= NOW(3)
           )
         )`,
      [leaseToken, CHATBOT_JOB_LEASE_SECONDS, Number(candidate.id)],
    );

    if (updateResult?.affectedRows) {
      const rows = await query(
        `SELECT *
         FROM chatbot_jobs
         WHERE id = ?
         LIMIT 1`,
        [Number(candidate.id)],
      );
      return rows[0] || null;
    }
  }

  return null;
}

async function finalizeChatbotJob({
  row,
  status,
  result,
  errorCode,
  errorMessage,
}) {
  await query(
    `UPDATE chatbot_jobs
     SET status = ?,
         result_json = ?,
         error_code = ?,
         error_message = ?,
         progress = ?,
         finished_at = NOW(3),
         expires_at = DATE_ADD(NOW(3), INTERVAL ? MINUTE),
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
      status === "completed" ? 100 : 0,
      CHATBOT_JOB_RESULT_TTL_MINUTES,
      Number(row.id),
      String(row.lease_token || ""),
    ],
  );

  if (status === "completed" && result?.answer) {
    await query(
      `INSERT INTO chatbot_messages
         (public_id, session_id, user_id, role, content_text, source_json)
       VALUES (?, ?, ?, 'assistant', ?, ?)`,
      [
        buildPublicId("msg"),
        Number(row.session_id),
        Number(row.user_id),
        String(result.answer || "").trim(),
        JSON.stringify({
          sourceType: String(result.sourceType || "knowledge"),
          references: Array.isArray(result.references) ? result.references : [],
          confidence: Number(result.confidence || 0),
          sourceReason: String(result.sourceReason || ""),
        }),
      ],
    );
  }
}

async function processChatbotJob(row) {
  try {
    const requester = await getUserAuthContext(Number(row.user_id));
    if (!requester) {
      await finalizeChatbotJob({
        row,
        status: "failed",
        errorCode: "requester_not_found",
        errorMessage: "No fue posible resolver el usuario solicitante",
      });
      return;
    }

    const request = parseJson(row.request_json, {});
    const prompt = String(request?.prompt || "").trim();
    if (!prompt) {
      await finalizeChatbotJob({
        row,
        status: "failed",
        errorCode: "invalid_prompt",
        errorMessage: "El prompt del job es invalido",
      });
      return;
    }

    const result = await runChatbotPipeline({
      user: requester,
      prompt,
      contextSnapshot:
        request?.useContext === false
          ? {}
          : request?.contextSnapshot &&
              typeof request.contextSnapshot === "object"
            ? request.contextSnapshot
            : {},
      featureCode: String(row.feature_code || "chatbot.assistant"),
      internalRequestId: `chatbot_job:${String(row.public_id || row.id)}`,
    });

    await finalizeChatbotJob({ row, status: "completed", result });
  } catch (error) {
    await finalizeChatbotJob({
      row,
      status: "failed",
      errorCode: String(error?.code || "chatbot_generation_failed").trim(),
      errorMessage:
        String(
          error?.message || "No fue posible completar la respuesta del chatbot",
        ).trim() || "No fue posible completar la respuesta del chatbot",
    });
  }
}

export function queueChatbotProcessing() {
  chatbotWorkerQueued = true;
}

export async function processPendingChatbotJobs({ limit = 1 } = {}) {
  let processed = 0;
  while (processed < limit) {
    const row = await claimNextChatbotJob();
    if (!row) break;
    processed += 1;
    await processChatbotJob(row);
  }
  return processed;
}

export async function startChatbotWorker() {
  if (chatbotWorkerStarted) {
    return;
  }

  chatbotWorkerStarted = true;

  const tick = async () => {
    if (!chatbotWorkerQueued) {
      return;
    }
    chatbotWorkerQueued = false;
    try {
      const processed = await processPendingChatbotJobs({ limit: 5 });
      if (processed > 0) {
        chatbotWorkerQueued = true;
      }
    } catch (error) {
      console.error("Chatbot worker error:", error?.message || error);
    }
  };

  const interval = setInterval(() => {
    tick();
  }, CHATBOT_JOB_POLL_AFTER_MS);
  interval.unref?.();

  queueChatbotProcessing();
  await tick();
}
