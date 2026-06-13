import express from "express";
import {
  assertAiBudgetAvailable,
  getAiCreditSummaryByUserId,
  listAiUsageByUserId,
} from "./ai-usage/service.js";
import { query } from "./db.js";
import { getChatbotSettings } from "./settings.js";
import { getDomainSuggestions } from "./chatbot/capabilities.js";
import { buildPublicId, parseJson } from "./chatbot/common.js";
import { messageSchema, sessionSchema } from "./chatbot/schemas.js";
import {
  buildJobResponse,
  processPendingChatbotJobs,
  queueChatbotProcessing,
  startChatbotWorker,
} from "./chatbot/worker.js";

const router = express.Router();

router.get("/settings", async (_req, res) => {
  const settings = await getChatbotSettings();
  return res.json({ settings });
});

router.post("/sessions", async (req, res) => {
  const parsed = sessionSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      message: "Datos invalidos",
      errors: parsed.error.flatten(),
    });
  }

  const publicId = buildPublicId("chat");
  await query(
    `INSERT INTO chatbot_sessions
       (public_id, user_id, locale, context_json)
     VALUES (?, ?, ?, ?)`,
    [
      publicId,
      Number(req.user.id),
      String(parsed.data.locale || "es").slice(0, 16),
      JSON.stringify(parsed.data.userContext || {}),
    ],
  );

  return res.status(201).json({
    sessionId: publicId,
    status: "active",
    createdAt: new Date().toISOString(),
    suggestions: getDomainSuggestions(req.user),
  });
});

router.post("/messages", async (req, res) => {
  const parsed = messageSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      message: "Datos invalidos",
      errors: parsed.error.flatten(),
    });
  }

  const sessionRows = await query(
    `SELECT *
     FROM chatbot_sessions
     WHERE public_id = ?
       AND user_id = ?
       AND status = 'active'
     LIMIT 1`,
    [parsed.data.sessionId, Number(req.user.id)],
  );

  if (!sessionRows.length) {
    return res.status(404).json({ message: "Sesion de chatbot no encontrada" });
  }

  try {
    await assertAiBudgetAvailable({ userId: Number(req.user.id) });
  } catch (error) {
    const status = Number(error?.status) || 402;
    return res.status(status).json({
      code: String(error?.code || "AI_BUDGET_EXCEEDED"),
      message:
        String(error?.message || "No tienes credito IA disponible").trim() ||
        "No tienes credito IA disponible",
    });
  }

  const session = sessionRows[0];
  const messagePublicId = buildPublicId("msg");
  const jobPublicId = buildPublicId("job");

  const insertMessageResult = await query(
    `INSERT INTO chatbot_messages
       (public_id, session_id, user_id, role, content_text, source_json)
     VALUES (?, ?, ?, 'user', ?, NULL)`,
    [
      messagePublicId,
      Number(session.id),
      Number(req.user.id),
      String(parsed.data.message || "").trim(),
    ],
  );

  await query(
    `INSERT INTO chatbot_jobs
       (public_id, session_id, message_id, user_id, feature_code, status, request_json, progress)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, 0)`,
    [
      jobPublicId,
      Number(session.id),
      Number(insertMessageResult.insertId || 0),
      Number(req.user.id),
      String(parsed.data.featureCode || "chatbot.assistant").trim(),
      JSON.stringify({
        prompt: String(parsed.data.message || "").trim(),
        useContext: Boolean(parsed.data.useContext),
        contextSnapshot:
          parsed.data.contextSnapshot &&
          typeof parsed.data.contextSnapshot === "object"
            ? parsed.data.contextSnapshot
            : {},
      }),
    ],
  );

  queueChatbotProcessing();

  return res.status(202).json({
    messageId: messagePublicId,
    jobId: jobPublicId,
    jobStatus: "queued",
    acceptedAt: new Date().toISOString(),
    estimatedWaitMs: 2500,
  });
});

router.get("/jobs/:jobId", async (req, res) => {
  const rows = await query(
    `SELECT *
     FROM chatbot_jobs
     WHERE public_id = ?
       AND user_id = ?
     LIMIT 1`,
    [String(req.params.jobId || "").trim(), Number(req.user.id)],
  );

  if (!rows.length) {
    return res.status(404).json({ message: "Job no encontrado" });
  }

  return res.json(buildJobResponse(rows[0]));
});

router.get("/sessions/:sessionId/messages", async (req, res) => {
  const sessionRows = await query(
    `SELECT id, public_id
     FROM chatbot_sessions
     WHERE public_id = ?
       AND user_id = ?
     LIMIT 1`,
    [String(req.params.sessionId || "").trim(), Number(req.user.id)],
  );

  if (!sessionRows.length) {
    return res.status(404).json({ message: "Sesion no encontrada" });
  }

  const session = sessionRows[0];
  const rows = await query(
    `SELECT public_id, role, content_text, source_json, created_at
     FROM chatbot_messages
     WHERE session_id = ?
     ORDER BY id ASC`,
    [Number(session.id)],
  );

  return res.json({
    sessionId: String(session.public_id),
    items: rows.map((row) => ({
      id: String(row.public_id || ""),
      role: String(row.role || "assistant"),
      content: String(row.content_text || ""),
      source: parseJson(row.source_json, null),
      createdAt: row.created_at || null,
    })),
  });
});

router.get("/wallet/me", async (req, res) => {
  const summary = await getAiCreditSummaryByUserId(Number(req.user.id));
  return res.json(summary);
});

router.get("/usage/me", async (req, res) => {
  const result = await listAiUsageByUserId({
    userId: Number(req.user.id),
    fromUtc: req.query?.fromUtc ? String(req.query.fromUtc) : undefined,
    toUtc: req.query?.toUtc ? String(req.query.toUtc) : undefined,
    featureCode: req.query?.featureCode
      ? String(req.query.featureCode)
      : "chatbot.assistant",
    limit: req.query?.limit ? Number(req.query.limit) : 50,
    cursor: req.query?.cursor ? Number(req.query.cursor) : null,
  });
  return res.json(result);
});

export { queueChatbotProcessing, processPendingChatbotJobs, startChatbotWorker };
export default router;
