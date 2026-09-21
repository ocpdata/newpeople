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
import { hasAnyPermission } from "./chatbot/common.js";
import { ensureChatbotSchema } from "./chatbot/schema.js";
import { saveOpportunityAction } from "./opportunity-workspace/service.js";
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

router.get("/operation-drafts/:draftId", async (req, res) => {
  await ensureChatbotSchema();
  const rows = await query(
    `SELECT public_id, status, intent, target_entity, target_entity_id,
            draft_json, result_json, error_message, created_at, approved_at,
            completed_at
     FROM chatbot_operation_drafts
     WHERE public_id = ? AND user_id = ?
     LIMIT 1`,
    [String(req.params.draftId || "").trim(), Number(req.user.id)],
  );
  const row = rows[0];
  if (!row) return res.status(404).json({ message: "Borrador de operación no encontrado" });
  return res.json({
    draftId: row.public_id,
    status: row.status,
    intent: row.intent,
    target: { entity: row.target_entity, id: row.target_entity_id ? Number(row.target_entity_id) : null },
    operation: parseJson(row.draft_json, null),
    result: parseJson(row.result_json, null),
    error: row.error_message || null,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    completedAt: row.completed_at,
  });
});

router.post("/operation-drafts/:draftId/approve", async (req, res) => {
  await ensureChatbotSchema();
  if (!hasAnyPermission(req.user, ["oportunidades.update"])) {
    return res.status(403).json({ message: "No tienes permiso para modificar oportunidades" });
  }
  const rows = await query(
    `SELECT * FROM chatbot_operation_drafts
     WHERE public_id = ? AND user_id = ? AND status IN ('drafted','needs_clarification')
     LIMIT 1`,
    [String(req.params.draftId || "").trim(), Number(req.user.id)],
  );
  const draft = rows[0];
  if (!draft) return res.status(404).json({ message: "Borrador no encontrado o ya procesado" });
  const operation = parseJson(draft.draft_json, {});
  const change = Array.isArray(operation.changes)
    ? operation.changes[0]
    : null;
  if (!change || !operation.target?.id) {
    return res.status(400).json({ message: "Esta operación todavía no tiene un ejecutor disponible" });
  }
  const isStageAnswer = operation.target?.entity === "stage_answer";
  const isOpportunityAmount = operation.target?.entity === "opportunity" && change.field === "amountUsd";
  const isActivity = operation.operation === "create_activity" && change.kind === "activity";
  const amount = Number(change.proposedValue);
  if (isOpportunityAmount && (!Number.isFinite(amount) || amount < 0)) {
    return res.status(400).json({ message: "El importe propuesto no es válido" });
  }
  if (!isStageAnswer && !isOpportunityAmount && !isActivity) {
    return res.status(400).json({ message: "Esta operación todavía no tiene un ejecutor disponible" });
  }
  const canUpdateAll = hasAnyPermission(req.user, ["oportunidades.read_all"]);
  const accessibleRows = await query(
    `SELECT o.id
     FROM opportunities o
     ${canUpdateAll ? "" : "LEFT JOIN account_owners ao ON ao.account_id = o.account_id AND ao.user_id = ?"}
     WHERE o.id = ?
       ${canUpdateAll ? "" : "AND (ao.user_id IS NOT NULL OR o.created_by = ? OR o.seller_user_id = ?)"}
     LIMIT 1`,
    canUpdateAll
      ? [Number(operation.target.id)]
      : [Number(req.user.id), Number(operation.target.id), Number(req.user.id), Number(req.user.id)],
  );
  if (!accessibleRows.length) {
    return res.status(404).json({ message: "Oportunidad no encontrada o fuera de alcance" });
  }
  await query(
    `UPDATE chatbot_operation_drafts
     SET status = 'executing', approved_at = NOW(3), updated_at = NOW(3)
     WHERE id = ? AND status IN ('drafted','needs_clarification')`,
    [Number(draft.id)],
  );
  try {
    let result;
    if (isOpportunityAmount) {
      const updateResult = await query(
        `UPDATE opportunities
         SET amount_usd = ?, updated_at = NOW(3), updated_by = ?
         WHERE id = ?`,
        [amount, Number(req.user.id), Number(operation.target.id)],
      );
      if (!updateResult?.affectedRows) throw new Error("La oportunidad no existe o no pudo actualizarse");
      result = { entity: "opportunity", id: Number(operation.target.id), field: "amountUsd", value: amount };
    } else if (isActivity) {
      const opportunityRows = await query(
        `SELECT sales_stage_id FROM opportunities WHERE id = ? LIMIT 1`,
        [Number(operation.target.id)],
      );
      const salesStageId = Number(opportunityRows?.[0]?.sales_stage_id || 0);
      if (!salesStageId) throw new Error("La oportunidad no tiene una etapa válida");
      if (!change.scheduledDate || !change.scheduledTime) {
        throw new Error("La actividad necesita fecha y hora");
      }
      const actionId = await saveOpportunityAction({
        opportunityId: Number(operation.target.id),
        actionId: null,
        payload: {
          linked_stage_id: salesStageId,
          action_type: change.activityType || "conference",
          priority: "medium",
          title: change.objective || "Reunión con cliente",
          owner_user_id: Number(req.user.id),
          due_date: change.scheduledDate,
          scheduled_at: `${change.scheduledDate} ${change.scheduledTime}:00`,
          success_criteria: "Registrar resultado de la actividad.",
          notes: change.note || null,
          is_primary_next_step: 0,
          details_json: JSON.stringify({ source: "chatbot" }),
          status: "pending",
        },
        userId: Number(req.user.id),
      });
      result = {
        entity: "activity",
        opportunityId: Number(operation.target.id),
        activityId: Number(actionId),
        scheduledDate: change.scheduledDate,
        scheduledTime: change.scheduledTime,
      };
    } else {
      const opportunityRows = await query(
        `SELECT sales_stage_id FROM opportunities WHERE id = ? LIMIT 1`,
        [Number(operation.target.id)],
      );
      const salesStageId = Number(opportunityRows?.[0]?.sales_stage_id || 0);
      const questionRows = await query(
        `SELECT id, code, prompt FROM opportunity_stage_questions
         WHERE id = ? AND sales_stage_id = ? AND is_active = 1 LIMIT 1`,
        [Number(change.questionId || 0), salesStageId],
      );
      const question = questionRows?.[0];
      if (!question) throw new Error("La pregunta no pertenece a la etapa actual");
      await query(
        `INSERT INTO opportunity_stage_question_answers
          (opportunity_id, sales_stage_id, question_id, question_code_snapshot,
           question_prompt_snapshot, answer_value, answered_by_user_id, answered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3))`,
        [
          Number(operation.target.id),
          salesStageId,
          Number(question.id),
          question.code,
          question.prompt,
          change.mode === "append" && String(change.previousValue || "").trim()
            ? `${String(change.previousValue).trim()}\n${String(change.proposedValue || "").trim()}`
            : String(change.proposedValue || "").trim(),
          Number(req.user.id),
        ],
      );
      result = {
        entity: "stage_answer",
        opportunityId: Number(operation.target.id),
        questionId: Number(question.id),
        mode: change.mode === "append" ? "append" : "replace",
        value:
          change.mode === "append" && String(change.previousValue || "").trim()
            ? `${String(change.previousValue).trim()}\n${String(change.proposedValue || "").trim()}`
            : String(change.proposedValue || "").trim(),
      };
    }
    await query(
      `UPDATE chatbot_operation_drafts
       SET status = 'completed', result_json = ?, completed_at = NOW(3), updated_at = NOW(3)
       WHERE id = ?`,
      [JSON.stringify(result), Number(draft.id)],
    );
    return res.json({ draftId: draft.public_id, status: "completed", result });
  } catch (error) {
    await query(
      `UPDATE chatbot_operation_drafts
       SET status = 'failed', error_message = ?, updated_at = NOW(3)
       WHERE id = ?`,
      [String(error?.message || "No fue posible ejecutar la operación").slice(0, 1000), Number(draft.id)],
    );
    return res.status(400).json({ message: String(error?.message || "No fue posible ejecutar la operación") });
  }
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
