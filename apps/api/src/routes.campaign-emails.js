import { randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
import { query, withTransaction } from "./db.js";
import { requireAnyPermission } from "./auth.js";
import { ensureCampaignEmailDispatchSchema } from "./campaign-emails/schema.js";
import {
  GOOGLE_GMAIL_SEND_SCOPE,
  decryptOpaqueSecret,
  exchangeGoogleRefreshToken,
  hasGoogleMailSendScope,
  sendGoogleMailMessage,
} from "./utils.js";

const router = express.Router();

const CAMPAIGN_EMAIL_SEND_PERMISSIONS = [
  "campanas.read",
  "campanas.create",
  "campanas.update",
];

const FIXED_BATCH_SIZE = 50;
const FIXED_MAX_SENDS_PER_HOUR = 50;
const FIXED_MAX_SENDS_PER_DAY = 300;
const RECIPIENT_LEASE_SECONDS = 300;
const RECIPIENT_RETRY_DELAY_MINUTES = 15;
const MAX_RECIPIENT_ATTEMPTS = 3;
const WORKER_POLL_INTERVAL_MS = 30_000;

let campaignEmailWorkerStarted = false;
let campaignEmailWorkerTimer = null;
let campaignEmailWorkerRunning = false;

const testSendSchema = z.object({
  recipients: z.array(z.string().trim().max(190)).max(100).optional(),
  recipientsText: z.string().trim().max(4000).optional(),
  subject: z.string().trim().max(220).min(1),
  preheader: z.string().trim().max(300).optional().nullable(),
  htmlContent: z.string().trim().max(2_000_000).min(1),
});

const campaignSendSchema = z.object({
  campaignId: z.number().int().positive().optional(),
  recipients: z.array(z.string().trim().max(190)).min(1).max(5000),
  subject: z.string().trim().max(220).min(1),
  preheader: z.string().trim().max(300).optional().nullable(),
  htmlContent: z.string().trim().max(2_000_000).min(1),
  batchSize: z.number().int().positive().max(5000).optional(),
  maxSendsPerHour: z.number().int().positive().max(5000).optional(),
  maxSendsPerDay: z.number().int().positive().max(50000).optional(),
});

const emailSchema = z.string().trim().email().max(190);

function normalizeRecipientList({ recipients, recipientsText }) {
  const fromArray = Array.isArray(recipients) ? recipients : [];
  const fromText = String(recipientsText || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const merged = [...fromArray, ...fromText]
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);

  return Array.from(new Set(merged));
}

async function findUserGoogleMailConnection(userId) {
  const rows = await query(
    `SELECT id, google_email, refresh_token_encrypted, scope_text, revoked_at
       FROM user_google_mail_connections
      WHERE user_id = ?
        AND revoked_at IS NULL
      LIMIT 1`,
    [Number(userId)],
  );

  return rows[0] || null;
}

function buildHtmlWithPreheader({ preheader, htmlContent }) {
  const normalizedPreheader = String(preheader || "").trim();
  const normalizedHtml = String(htmlContent || "").trim();
  if (!normalizedPreheader) return normalizedHtml;

  return `${`<div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${normalizedPreheader}</div>`}${normalizedHtml}`;
}

function classifyRecipients(rawRecipients = []) {
  const normalized = Array.from(
    new Set(
      rawRecipients
        .map((email) =>
          String(email || "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    ),
  );

  const validationResults = normalized.map((email) => ({
    email,
    isValid: emailSchema.safeParse(email).success,
  }));

  return {
    validRecipients: validationResults
      .filter((item) => item.isValid)
      .map((item) => item.email),
    invalidRecipients: validationResults
      .filter((item) => !item.isValid)
      .map((item) => item.email),
  };
}

async function resolveGoogleAccessTokenForUser(userId) {
  const googleConnection = await findUserGoogleMailConnection(userId);
  if (!googleConnection) {
    const error = new Error(
      "Debes conectar tu cuenta de Google antes de enviar correos",
    );
    error.status = 409;
    error.reason = "google_reconnect_required";
    throw error;
  }

  if (!hasGoogleMailSendScope(googleConnection.scope_text || "")) {
    const error = new Error(
      "Tu conexión de Google no incluye permisos para enviar correo",
    );
    error.status = 409;
    error.reason = "google_scope_missing";
    error.requiredScope = GOOGLE_GMAIL_SEND_SCOPE;
    throw error;
  }

  try {
    const refreshToken = decryptOpaqueSecret(
      googleConnection.refresh_token_encrypted,
    );
    const tokenPayload = await exchangeGoogleRefreshToken(refreshToken);
    const accessToken = String(tokenPayload?.access_token || "").trim();
    if (!accessToken) {
      throw new Error("No fue posible renovar token de Google");
    }

    return {
      accessToken,
      fromEmail: String(googleConnection.google_email || "").trim(),
    };
  } catch (error) {
    const errorCode = String(error?.code || "google_send_failed").toLowerCase();
    if (
      errorCode === "invalid_grant" ||
      errorCode === "invalid_token" ||
      errorCode === "unauthenticated"
    ) {
      const tokenError = new Error(
        "La conexión con Google expiró o fue revocada. Reconecta tu cuenta para continuar",
      );
      tokenError.status = 409;
      tokenError.reason = "google_reconnect_required";
      throw tokenError;
    }

    if (errorCode === "insufficient_scope") {
      const tokenError = new Error(
        "Tu conexión con Google no tiene permisos suficientes para enviar correo",
      );
      tokenError.status = 409;
      tokenError.reason = "google_scope_missing";
      tokenError.requiredScope = GOOGLE_GMAIL_SEND_SCOPE;
      throw tokenError;
    }

    const tokenError = new Error(
      String(error?.detail || error?.message || "") ||
        "No fue posible preparar el envío con Google",
    );
    tokenError.status = 502;
    tokenError.reason = "google_send_failed";
    throw tokenError;
  }
}

async function sendToRecipients({
  accessToken,
  from,
  recipients,
  subject,
  preheader,
  htmlContent,
}) {
  const htmlBody = buildHtmlWithPreheader({ preheader, htmlContent });
  const results = [];

  for (const recipient of recipients) {
    try {
      await sendGoogleMailMessage({
        accessToken,
        from,
        to: recipient,
        cc: "",
        subject,
        messageBody: String(preheader || "Mensaje enviado").trim(),
        htmlBody,
        attachments: [],
      });

      results.push({
        email: recipient,
        status: "sent",
        message: "Enviado",
      });
    } catch (error) {
      results.push({
        email: recipient,
        status: "failed",
        message:
          String(error?.detail || error?.message || "") ||
          "Google rechazó el envío",
      });
    }
  }

  return results;
}

function summarizeResults(results = []) {
  return {
    total: results.length,
    sent: results.filter((item) => item.status === "sent").length,
    failed: results.filter((item) => item.status === "failed").length,
    invalid: results.filter((item) => item.status === "invalid").length,
    skipped: results.filter((item) => item.status === "skipped").length,
  };
}

function toPositiveInt(value, fallback) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) return fallback;
  return Math.trunc(normalized);
}

function toSafeNumber(value, fallback = 0) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function buildDispatchPublicId() {
  return `cmpmailrun_${randomUUID().replace(/-/g, "")}`;
}

async function createDispatch({
  campaignId,
  requestedByUserId,
  subject,
  preheader,
  htmlContent,
  recipients,
}) {
  await ensureCampaignEmailDispatchSchema();

  const publicId = buildDispatchPublicId();
  await query(
    `INSERT INTO campaign_email_dispatches
       (public_id, campaign_id, requested_by_user_id, status,
        subject, preheader, html_content,
        batch_size, max_sends_per_hour, max_sends_per_day,
        timezone, started_at, created_at, updated_at)
     VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, 'UTC', NOW(3), NOW(3), NOW(3))`,
    [
      publicId,
      campaignId || null,
      Number(requestedByUserId),
      subject,
      preheader || null,
      htmlContent,
      FIXED_BATCH_SIZE,
      FIXED_MAX_SENDS_PER_HOUR,
      FIXED_MAX_SENDS_PER_DAY,
    ],
  );

  const dispatchRows = await query(
    `SELECT *
     FROM campaign_email_dispatches
     WHERE public_id = ?
     LIMIT 1`,
    [publicId],
  );
  const dispatch = dispatchRows[0] || null;
  if (!dispatch) {
    throw new Error("No fue posible crear la corrida de envío");
  }

  const chunkSize = 400;
  for (let index = 0; index < recipients.length; index += chunkSize) {
    const chunk = recipients.slice(index, index + chunkSize);
    const placeholders = chunk
      .map(() => "(?, ?, 'pending', 0, NOW(3), NOW(3))")
      .join(", ");
    const values = [];
    for (const email of chunk) {
      values.push(Number(dispatch.id), String(email));
    }

    await query(
      `INSERT INTO campaign_email_dispatch_recipients
         (dispatch_id, email, status, attempt_count, created_at, updated_at)
       VALUES ${placeholders}`,
      values,
    );
  }

  return dispatch;
}

async function getDispatchRowByPublicId(publicId, requestedByUserId) {
  await ensureCampaignEmailDispatchSchema();
  const rows = await query(
    `SELECT *
     FROM campaign_email_dispatches
     WHERE public_id = ?
       AND requested_by_user_id = ?
     LIMIT 1`,
    [String(publicId || "").trim(), Number(requestedByUserId)],
  );
  return rows[0] || null;
}

async function getDispatchSummary(dispatchId) {
  const totalsRows = await query(
    `SELECT
        COUNT(*) AS total,
        SUM(status = 'pending') AS pending,
        SUM(status = 'running') AS running,
        SUM(status = 'sent') AS sent,
        SUM(status = 'failed') AS failed,
        SUM(status = 'skipped') AS skipped
     FROM campaign_email_dispatch_recipients
     WHERE dispatch_id = ?`,
    [Number(dispatchId)],
  );

  const windowsRows = await query(
    `SELECT
        SUM(status = 'sent' AND sent_at >= DATE_SUB(NOW(3), INTERVAL 1 HOUR)) AS sent_last_hour,
        SUM(status = 'sent' AND sent_at >= CURRENT_DATE() AND sent_at < DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY)) AS sent_today
     FROM campaign_email_dispatch_recipients
     WHERE dispatch_id = ?`,
    [Number(dispatchId)],
  );

  const nextRetryRows = await query(
    `SELECT MIN(next_retry_at) AS next_retry_at
     FROM campaign_email_dispatch_recipients
     WHERE dispatch_id = ?
       AND status = 'failed'
       AND attempt_count < ?
       AND next_retry_at IS NOT NULL`,
    [Number(dispatchId), MAX_RECIPIENT_ATTEMPTS],
  );

  const totals = totalsRows[0] || {};
  const windows = windowsRows[0] || {};

  return {
    total: toSafeNumber(totals.total),
    pending: toSafeNumber(totals.pending),
    running: toSafeNumber(totals.running),
    sent: toSafeNumber(totals.sent),
    failed: toSafeNumber(totals.failed),
    skipped: toSafeNumber(totals.skipped),
    sentLastHour: toSafeNumber(windows.sent_last_hour),
    sentToday: toSafeNumber(windows.sent_today),
    nextRetryAt: nextRetryRows[0]?.next_retry_at || null,
  };
}

async function getDispatchResults(dispatchId, limit = 100) {
  const rows = await query(
    `SELECT email, status, last_error_message, sent_at, updated_at
     FROM campaign_email_dispatch_recipients
     WHERE dispatch_id = ?
     ORDER BY
       CASE status
         WHEN 'running' THEN 0
         WHEN 'failed' THEN 1
         WHEN 'pending' THEN 2
         WHEN 'sent' THEN 3
         ELSE 4
       END,
       sent_at DESC,
       updated_at DESC,
       id DESC
     LIMIT ?`,
    [Number(dispatchId), toPositiveInt(limit, 100)],
  );

  return rows.map((row) => ({
    email: String(row.email || ""),
    status: String(row.status || "pending"),
    message:
      String(row.last_error_message || "").trim() ||
      (String(row.status || "") === "sent" ? "Enviado" : "En cola"),
    sentAt: row.sent_at || null,
    updatedAt: row.updated_at || null,
  }));
}

function buildDispatchPayload(dispatchRow, summary) {
  if (!dispatchRow) return null;
  return {
    id: String(dispatchRow.public_id || ""),
    campaignId: dispatchRow.campaign_id
      ? Number(dispatchRow.campaign_id)
      : null,
    status: String(dispatchRow.status || "running"),
    subject: String(dispatchRow.subject || ""),
    config: {
      batchSize: toSafeNumber(dispatchRow.batch_size, FIXED_BATCH_SIZE),
      maxSendsPerHour: toSafeNumber(
        dispatchRow.max_sends_per_hour,
        FIXED_MAX_SENDS_PER_HOUR,
      ),
      maxSendsPerDay: toSafeNumber(
        dispatchRow.max_sends_per_day,
        FIXED_MAX_SENDS_PER_DAY,
      ),
    },
    startedAt: dispatchRow.started_at || null,
    pausedAt: dispatchRow.paused_at || null,
    resumedAt: dispatchRow.resumed_at || null,
    finishedAt: dispatchRow.finished_at || null,
    lastErrorMessage:
      String(dispatchRow.last_error_message || "").trim() || null,
    summary,
  };
}

async function claimRecipientsForDispatch(dispatchId, limit) {
  const leaseToken = randomUUID().replace(/-/g, "");

  const rows = await withTransaction(async (conn) => {
    const [updateResult] = await conn.query(
      `UPDATE campaign_email_dispatch_recipients
       SET status = 'running',
           attempt_count = CASE WHEN status = 'running' THEN attempt_count ELSE attempt_count + 1 END,
           lease_token = ?,
           lease_expires_at = DATE_ADD(NOW(3), INTERVAL ? SECOND),
           updated_at = NOW(3)
       WHERE dispatch_id = ?
         AND (
           status = 'pending'
           OR (
             status = 'failed'
             AND attempt_count < ?
             AND next_retry_at IS NOT NULL
             AND next_retry_at <= NOW(3)
           )
           OR (
             status = 'running'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at <= NOW(3)
           )
         )
       ORDER BY id ASC
       LIMIT ?`,
      [
        leaseToken,
        RECIPIENT_LEASE_SECONDS,
        Number(dispatchId),
        MAX_RECIPIENT_ATTEMPTS,
        toPositiveInt(limit, 1),
      ],
    );

    if (!Number(updateResult?.affectedRows || 0)) {
      return [];
    }

    const [claimedRows] = await conn.query(
      `SELECT id, email, attempt_count
       FROM campaign_email_dispatch_recipients
       WHERE dispatch_id = ?
         AND lease_token = ?
       ORDER BY id ASC`,
      [Number(dispatchId), leaseToken],
    );

    return claimedRows;
  });

  return {
    leaseToken,
    recipients: Array.isArray(rows) ? rows : [],
  };
}

async function markRecipientSent({ recipientId, leaseToken }) {
  await query(
    `UPDATE campaign_email_dispatch_recipients
     SET status = 'sent',
         sent_at = NOW(3),
         next_retry_at = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         last_error_message = NULL,
         updated_at = NOW(3)
     WHERE id = ?
       AND lease_token = ?`,
    [Number(recipientId), String(leaseToken || "")],
  );
}

async function markRecipientFailed({
  recipientId,
  leaseToken,
  attemptCount,
  errorMessage,
}) {
  const shouldRetry = Number(attemptCount) < MAX_RECIPIENT_ATTEMPTS;
  if (shouldRetry) {
    await query(
      `UPDATE campaign_email_dispatch_recipients
       SET status = 'failed',
           next_retry_at = DATE_ADD(NOW(3), INTERVAL ? MINUTE),
           lease_token = NULL,
           lease_expires_at = NULL,
           last_error_message = ?,
           updated_at = NOW(3)
       WHERE id = ?
         AND lease_token = ?`,
      [
        RECIPIENT_RETRY_DELAY_MINUTES,
        String(errorMessage || "Google rechazó el envío").slice(0, 1000),
        Number(recipientId),
        String(leaseToken || ""),
      ],
    );
    return;
  }

  await query(
    `UPDATE campaign_email_dispatch_recipients
     SET status = 'failed',
         next_retry_at = NULL,
         lease_token = NULL,
         lease_expires_at = NULL,
         last_error_message = ?,
         updated_at = NOW(3)
     WHERE id = ?
       AND lease_token = ?`,
    [
      String(errorMessage || "Google rechazó el envío").slice(0, 1000),
      Number(recipientId),
      String(leaseToken || ""),
    ],
  );
}

async function completeDispatchIfNoPending(dispatchId) {
  const rows = await query(
    `SELECT COUNT(*) AS open_count
     FROM campaign_email_dispatch_recipients
     WHERE dispatch_id = ?
       AND (
         status = 'pending'
         OR status = 'running'
         OR (status = 'failed' AND attempt_count < ?)
       )`,
    [Number(dispatchId), MAX_RECIPIENT_ATTEMPTS],
  );

  const openCount = toSafeNumber(rows[0]?.open_count);
  if (openCount > 0) {
    return false;
  }

  await query(
    `UPDATE campaign_email_dispatches
     SET status = 'completed',
         finished_at = NOW(3),
         updated_at = NOW(3)
     WHERE id = ?
       AND status = 'running'`,
    [Number(dispatchId)],
  );
  return true;
}

async function calculateDispatchWindowQuota(dispatchId, dispatchConfig) {
  const rows = await query(
    `SELECT
        SUM(status = 'sent' AND sent_at >= DATE_SUB(NOW(3), INTERVAL 1 HOUR)) AS sent_last_hour,
        SUM(status = 'sent' AND sent_at >= CURRENT_DATE() AND sent_at < DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY)) AS sent_today
     FROM campaign_email_dispatch_recipients
     WHERE dispatch_id = ?`,
    [Number(dispatchId)],
  );
  const metrics = rows[0] || {};
  const sentLastHour = toSafeNumber(metrics.sent_last_hour);
  const sentToday = toSafeNumber(metrics.sent_today);

  const maxPerHour = toPositiveInt(
    dispatchConfig?.max_sends_per_hour,
    FIXED_MAX_SENDS_PER_HOUR,
  );
  const maxPerDay = toPositiveInt(
    dispatchConfig?.max_sends_per_day,
    FIXED_MAX_SENDS_PER_DAY,
  );
  const batchSize = toPositiveInt(dispatchConfig?.batch_size, FIXED_BATCH_SIZE);

  const availableByHour = Math.max(0, maxPerHour - sentLastHour);
  const availableByDay = Math.max(0, maxPerDay - sentToday);
  const allowedNow = Math.max(
    0,
    Math.min(batchSize, availableByHour, availableByDay),
  );

  return {
    allowedNow,
    sentLastHour,
    sentToday,
  };
}

async function processSingleDispatch(dispatchRow) {
  const dispatchId = Number(dispatchRow?.id || 0);
  const requestedByUserId = Number(dispatchRow?.requested_by_user_id || 0);
  if (!dispatchId || !requestedByUserId) return;

  const { allowedNow } = await calculateDispatchWindowQuota(
    dispatchId,
    dispatchRow,
  );
  if (allowedNow <= 0) {
    await completeDispatchIfNoPending(dispatchId);
    return;
  }

  let tokenData;
  try {
    tokenData = await resolveGoogleAccessTokenForUser(requestedByUserId);
  } catch (error) {
    await query(
      `UPDATE campaign_email_dispatches
       SET status = 'paused',
           paused_at = NOW(3),
           last_error_message = ?,
           updated_at = NOW(3)
       WHERE id = ?
         AND status = 'running'`,
      [
        String(
          error?.message || "No fue posible preparar envío con Google",
        ).slice(0, 1000),
        dispatchId,
      ],
    );
    return;
  }

  const { leaseToken, recipients } = await claimRecipientsForDispatch(
    dispatchId,
    allowedNow,
  );
  if (!recipients.length) {
    await completeDispatchIfNoPending(dispatchId);
    return;
  }

  for (const recipient of recipients) {
    try {
      await sendGoogleMailMessage({
        accessToken: tokenData.accessToken,
        from: tokenData.fromEmail,
        to: String(recipient.email || ""),
        cc: "",
        subject: String(dispatchRow.subject || "").trim(),
        messageBody: String(dispatchRow.preheader || "Mensaje enviado").trim(),
        htmlBody: buildHtmlWithPreheader({
          preheader: String(dispatchRow.preheader || ""),
          htmlContent: String(dispatchRow.html_content || ""),
        }),
        attachments: [],
      });
      await markRecipientSent({ recipientId: recipient.id, leaseToken });
    } catch (error) {
      await markRecipientFailed({
        recipientId: recipient.id,
        leaseToken,
        attemptCount: toSafeNumber(recipient.attempt_count, 1),
        errorMessage:
          String(
            error?.detail || error?.message || "Google rechazó el envío",
          ) || "Google rechazó el envío",
      });
    }
  }

  await completeDispatchIfNoPending(dispatchId);
}

export async function processPendingCampaignEmailDispatches({
  limit = 2,
} = {}) {
  await ensureCampaignEmailDispatchSchema();

  const runningDispatches = await query(
    `SELECT *
     FROM campaign_email_dispatches
     WHERE status = 'running'
     ORDER BY updated_at ASC, id ASC
     LIMIT ?`,
    [toPositiveInt(limit, 2)],
  );

  for (const dispatch of runningDispatches) {
    await processSingleDispatch(dispatch);
  }

  return { processedCount: runningDispatches.length };
}

function queueCampaignEmailDispatchProcessing() {
  if (process.env.NODE_ENV === "test") return;

  setTimeout(async () => {
    if (campaignEmailWorkerRunning) return;
    campaignEmailWorkerRunning = true;
    try {
      await processPendingCampaignEmailDispatches({ limit: 1 });
    } catch (error) {
      console.error(
        "Queued campaign email dispatch processing error:",
        error?.message || error,
      );
    } finally {
      campaignEmailWorkerRunning = false;
    }
  }, 0);
}

export async function startCampaignEmailDispatchWorker() {
  if (campaignEmailWorkerStarted || process.env.NODE_ENV === "test") {
    return;
  }

  campaignEmailWorkerStarted = true;
  await ensureCampaignEmailDispatchSchema();
  queueCampaignEmailDispatchProcessing();

  campaignEmailWorkerTimer = setInterval(async () => {
    if (campaignEmailWorkerRunning) return;
    campaignEmailWorkerRunning = true;
    try {
      await processPendingCampaignEmailDispatches({ limit: 5 });
    } catch (error) {
      console.error(
        "Scheduled campaign email dispatch worker error:",
        error?.message || error,
      );
    } finally {
      campaignEmailWorkerRunning = false;
    }
  }, WORKER_POLL_INTERVAL_MS);

  if (typeof campaignEmailWorkerTimer?.unref === "function") {
    campaignEmailWorkerTimer.unref();
  }
}

router.post(
  "/test-send",
  requireAnyPermission(CAMPAIGN_EMAIL_SEND_PERMISSIONS),
  async (req, res) => {
    const parsed = testSendSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos para envío de prueba",
        issues: parsed.error.flatten(),
      });
    }

    const recipientsRaw = normalizeRecipientList(parsed.data);
    if (!recipientsRaw.length) {
      return res.status(400).json({
        message: "Debes indicar al menos un correo de prueba",
      });
    }

    const { validRecipients, invalidRecipients } =
      classifyRecipients(recipientsRaw);

    if (!validRecipients.length) {
      return res.status(400).json({
        message:
          "La lista de correos de prueba no contiene destinatarios válidos",
        results: invalidRecipients.map((email) => ({
          email,
          status: "invalid",
          message: "Formato de correo inválido",
        })),
      });
    }

    let accessToken = "";
    let fromEmail = "";
    try {
      const tokenData = await resolveGoogleAccessTokenForUser(req.user.id);
      accessToken = tokenData.accessToken;
      fromEmail = tokenData.fromEmail;
    } catch (error) {
      return res.status(Number(error?.status) || 502).json({
        message: String(error?.message || "") || "Error de envío",
        reason: String(error?.reason || "google_send_failed"),
        requiredScope: error?.requiredScope || undefined,
      });
    }

    const subject = String(parsed.data.subject || "").trim();
    const preheader = String(parsed.data.preheader || "").trim();
    const htmlContent = String(parsed.data.htmlContent || "").trim();

    const results = await sendToRecipients({
      accessToken,
      from: fromEmail,
      recipients: validRecipients,
      subject,
      preheader,
      htmlContent,
    });

    for (const invalidEmail of invalidRecipients) {
      results.push({
        email: invalidEmail,
        status: "invalid",
        message: "Formato de correo inválido",
      });
    }

    return res.json({
      summary: summarizeResults(results),
      results,
    });
  },
);

router.post(
  "/send",
  requireAnyPermission(CAMPAIGN_EMAIL_SEND_PERMISSIONS),
  async (req, res) => {
    const parsed = campaignSendSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos para iniciar envío",
        issues: parsed.error.flatten(),
      });
    }

    const { validRecipients, invalidRecipients } = classifyRecipients(
      parsed.data.recipients,
    );

    if (!validRecipients.length) {
      return res.status(400).json({
        message: "No hay destinatarios válidos para enviar",
      });
    }

    try {
      await resolveGoogleAccessTokenForUser(req.user.id);
    } catch (error) {
      return res.status(Number(error?.status) || 502).json({
        message: String(error?.message || "") || "Error de envío",
        reason: String(error?.reason || "google_send_failed"),
        requiredScope: error?.requiredScope || undefined,
      });
    }

    let dispatch;
    try {
      dispatch = await createDispatch({
        campaignId: Number(parsed.data.campaignId || 0) || null,
        requestedByUserId: req.user.id,
        subject: String(parsed.data.subject || "").trim(),
        preheader: String(parsed.data.preheader || "").trim(),
        htmlContent: String(parsed.data.htmlContent || "").trim(),
        recipients: validRecipients,
      });
    } catch (error) {
      return res.status(500).json({
        message:
          String(error?.message || "") ||
          "No fue posible crear la corrida de envío",
      });
    }

    queueCampaignEmailDispatchProcessing();

    const dispatchSummary = await getDispatchSummary(dispatch.id);
    const dispatchPayload = buildDispatchPayload(dispatch, dispatchSummary);

    const invalidResults = invalidRecipients.map((email) => ({
      email,
      status: "invalid",
      message: "Formato de correo inválido",
    }));

    return res.json({
      message:
        "Envío programado. Se procesará automáticamente con tope fijo de 50 por hora y 300 por día.",
      dispatch: dispatchPayload,
      summary: {
        queued: dispatchSummary.total,
        invalid: invalidRecipients.length,
        batchSize: FIXED_BATCH_SIZE,
        maxSendsPerHour: FIXED_MAX_SENDS_PER_HOUR,
        maxSendsPerDay: FIXED_MAX_SENDS_PER_DAY,
      },
      invalidResults,
    });
  },
);

router.get(
  "/runs/:runId",
  requireAnyPermission(CAMPAIGN_EMAIL_SEND_PERMISSIONS),
  async (req, res) => {
    const dispatch = await getDispatchRowByPublicId(
      req.params.runId,
      req.user.id,
    );
    if (!dispatch) {
      return res
        .status(404)
        .json({ message: "Corrida de envío no encontrada" });
    }

    const summary = await getDispatchSummary(dispatch.id);
    const results = await getDispatchResults(dispatch.id, 120);
    return res.json({
      dispatch: buildDispatchPayload(dispatch, summary),
      results,
    });
  },
);

router.get(
  "/campaign/:campaignId/latest",
  requireAnyPermission(CAMPAIGN_EMAIL_SEND_PERMISSIONS),
  async (req, res) => {
    const campaignId = Number(req.params.campaignId || 0);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({ message: "campaignId invalido" });
    }

    await ensureCampaignEmailDispatchSchema();
    const rows = await query(
      `SELECT *
       FROM campaign_email_dispatches
       WHERE campaign_id = ?
         AND requested_by_user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [campaignId, Number(req.user.id)],
    );

    const dispatch = rows[0] || null;
    if (!dispatch) {
      return res.json({ dispatch: null, results: [] });
    }

    const summary = await getDispatchSummary(dispatch.id);
    const results = await getDispatchResults(dispatch.id, 120);
    return res.json({
      dispatch: buildDispatchPayload(dispatch, summary),
      results,
    });
  },
);

router.post(
  "/runs/:runId/pause",
  requireAnyPermission(CAMPAIGN_EMAIL_SEND_PERMISSIONS),
  async (req, res) => {
    const dispatch = await getDispatchRowByPublicId(
      req.params.runId,
      req.user.id,
    );
    if (!dispatch) {
      return res
        .status(404)
        .json({ message: "Corrida de envío no encontrada" });
    }

    await query(
      `UPDATE campaign_email_dispatches
       SET status = 'paused',
           paused_at = NOW(3),
           updated_at = NOW(3)
       WHERE id = ?
         AND status = 'running'`,
      [Number(dispatch.id)],
    );

    const updated = await getDispatchRowByPublicId(
      req.params.runId,
      req.user.id,
    );
    const summary = await getDispatchSummary(dispatch.id);
    return res.json({ dispatch: buildDispatchPayload(updated, summary) });
  },
);

router.post(
  "/runs/:runId/resume",
  requireAnyPermission(CAMPAIGN_EMAIL_SEND_PERMISSIONS),
  async (req, res) => {
    const dispatch = await getDispatchRowByPublicId(
      req.params.runId,
      req.user.id,
    );
    if (!dispatch) {
      return res
        .status(404)
        .json({ message: "Corrida de envío no encontrada" });
    }

    await query(
      `UPDATE campaign_email_dispatches
       SET status = 'running',
           resumed_at = NOW(3),
           last_error_message = NULL,
           updated_at = NOW(3)
       WHERE id = ?
         AND status IN ('paused', 'failed')`,
      [Number(dispatch.id)],
    );

    queueCampaignEmailDispatchProcessing();

    const updated = await getDispatchRowByPublicId(
      req.params.runId,
      req.user.id,
    );
    const summary = await getDispatchSummary(dispatch.id);
    return res.json({ dispatch: buildDispatchPayload(updated, summary) });
  },
);

router.post(
  "/runs/:runId/cancel",
  requireAnyPermission(CAMPAIGN_EMAIL_SEND_PERMISSIONS),
  async (req, res) => {
    const dispatch = await getDispatchRowByPublicId(
      req.params.runId,
      req.user.id,
    );
    if (!dispatch) {
      return res
        .status(404)
        .json({ message: "Corrida de envío no encontrada" });
    }

    await query(
      `UPDATE campaign_email_dispatches
       SET status = 'canceled',
           finished_at = NOW(3),
           updated_at = NOW(3)
       WHERE id = ?
         AND status IN ('running', 'paused')`,
      [Number(dispatch.id)],
    );

    await query(
      `UPDATE campaign_email_dispatch_recipients
       SET status = 'skipped',
           lease_token = NULL,
           lease_expires_at = NULL,
           next_retry_at = NULL,
           last_error_message = 'Corrida cancelada por usuario',
           updated_at = NOW(3)
       WHERE dispatch_id = ?
         AND (
           status = 'pending'
           OR status = 'running'
           OR (status = 'failed' AND attempt_count < ?)
         )`,
      [Number(dispatch.id), MAX_RECIPIENT_ATTEMPTS],
    );

    const updated = await getDispatchRowByPublicId(
      req.params.runId,
      req.user.id,
    );
    const summary = await getDispatchSummary(dispatch.id);
    return res.json({ dispatch: buildDispatchPayload(updated, summary) });
  },
);

export default router;
