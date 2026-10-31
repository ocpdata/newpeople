import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query } from "../src/db.js";
import {
  FEEDBACK_COMMENT_RETENTION_MONTHS,
  getFeedbackForTriage,
  listFeedbackForTriage,
  listOwnFeedbackForSession,
  markFeedbackConverted,
  purgeExpiredFeedbackComments,
  submitCustomerChatFeedback,
  updateFeedbackTriage,
} from "../src/commercial-intelligence/turn-feedback.js";
import { createCustomEvaluationCase } from "../src/customer-chat-evaluations/custom-cases.js";
import { getEvaluationCatalog } from "../src/customer-chat-evaluations/catalog.js";
import { TEST_PREFIX, createDirectAccount, createUser } from "./helpers/apiTestUtils.js";

describe("feedback de las respuestas del chat de cliente", () => {
  let ownerId;
  let otherId;
  let reviewerId;
  let accountId;
  let sessionId;
  const owner = () => ({ id: ownerId });
  const jobIds = [];
  const customCaseIds = [];

  const insertJob = async ({ userId = ownerId, status = "completed", question = "¿Cuál es el monto?", answer = "El monto es 100 USD." } = {}) => {
    const result = await query(
      `INSERT INTO customer_intelligence_jobs
        (public_id, account_id, requested_by_user_id, job_type, status, request_json, result_json, created_at, updated_at, finished_at)
       VALUES (?, ?, ?, 'account_chat', ?, ?, ?, NOW(3), NOW(3), NOW(3))`,
      [
        `cac_${TEST_PREFIX}_${Math.random().toString(36).slice(2, 10)}`,
        accountId,
        userId,
        status,
        JSON.stringify({ chatSessionId: sessionId, question }),
        JSON.stringify({ answer }),
      ],
    );
    jobIds.push(Number(result.insertId));
    return Number(result.insertId);
  };

  beforeAll(async () => {
    ownerId = await createUser({ fullName: "Feedback Owner", email: `${TEST_PREFIX}.feedback.owner@example.com` });
    otherId = await createUser({ fullName: "Feedback Other", email: `${TEST_PREFIX}.feedback.other@example.com` });
    reviewerId = await createUser({ fullName: "Feedback Reviewer", email: `${TEST_PREFIX}.feedback.reviewer@example.com` });
    accountId = await createDirectAccount({ ownerUserId: ownerId, actorUserId: ownerId, suffix: `${TEST_PREFIX}_feedback` });
    const session = await query(
      `INSERT INTO customer_intelligence_chat_sessions
        (public_id, requested_by_user_id, account_id, history_json) VALUES (?, ?, ?, '[]')`,
      [`cacs_${TEST_PREFIX}_feedback`, ownerId, accountId],
    );
    sessionId = Number(session.insertId);
  });

  afterAll(async () => {
    if (customCaseIds.length) await query("DELETE FROM customer_chat_evaluation_custom_cases WHERE id IN (?)", [customCaseIds]);
    await query("DELETE FROM customer_chat_turn_feedback WHERE user_id IN (?, ?)", [ownerId, otherId]);
    await query("DELETE FROM customer_intelligence_jobs WHERE requested_by_user_id IN (?, ?)", [ownerId, otherId]);
    await query("DELETE FROM customer_intelligence_chat_sessions WHERE id = ?", [sessionId]);
    await query("DELETE FROM accounts WHERE id = ?", [accountId]).catch(() => undefined);
    await query("DELETE FROM users WHERE id IN (?, ?, ?)", [ownerId, otherId, reviewerId]);
  });

  it("guarda una calificación negativa con motivo y comentario, y el autor no recibe el comentario", async () => {
    const jobId = await insertJob();
    const saved = await submitCustomerChatFeedback({
      user: owner(), jobId, rating: "negative", reasonCode: "incorrect_data", comment: "  El monto   está mal  ",
    });
    expect(saved).toEqual({ jobId, rating: "negative", reasonCode: "incorrect_data", hasComment: true });
    const own = await listOwnFeedbackForSession({ user: owner(), sessionId });
    expect(own).toEqual([{ jobId, rating: "negative", reasonCode: "incorrect_data", hasComment: true }]);
    expect(JSON.stringify(own)).not.toContain("El monto");
    const [row] = await query("SELECT comment, comment_at, triage_status FROM customer_chat_turn_feedback WHERE job_id = ?", [jobId]);
    expect(row.comment).toBe("El monto está mal");
    expect(row.comment_at).toBeTruthy();
    expect(row.triage_status).toBe("new");
  });

  it("rechaza calificar respuestas ajenas, no terminadas o con datos inválidos", async () => {
    const foreignId = await insertJob({ userId: otherId });
    await expect(submitCustomerChatFeedback({ user: owner(), jobId: foreignId, rating: "positive" })).rejects.toMatchObject({ status: 404 });
    const pendingId = await insertJob({ status: "pending" });
    await expect(submitCustomerChatFeedback({ user: owner(), jobId: pendingId, rating: "positive" })).rejects.toMatchObject({ status: 409 });
    const jobId = await insertJob();
    await expect(submitCustomerChatFeedback({ user: owner(), jobId, rating: "meh" })).rejects.toMatchObject({ status: 400 });
    await expect(submitCustomerChatFeedback({ user: owner(), jobId, rating: "negative", reasonCode: "otro" })).rejects.toMatchObject({ status: 400 });
  });

  it("cambiar a positivo limpia motivo y comentario; repetir el mismo comentario no reinicia su fecha", async () => {
    const jobId = await insertJob();
    await submitCustomerChatFeedback({ user: owner(), jobId, rating: "negative", reasonCode: "other", comment: "No me sirvió" });
    await query("UPDATE customer_chat_turn_feedback SET comment_at = '2025-01-01 00:00:00' WHERE job_id = ?", [jobId]);
    await submitCustomerChatFeedback({ user: owner(), jobId, rating: "negative", reasonCode: "other", comment: "No me sirvió" });
    let [row] = await query("SELECT comment_at FROM customer_chat_turn_feedback WHERE job_id = ?", [jobId]);
    expect(new Date(row.comment_at).getUTCFullYear()).toBe(2025);
    await submitCustomerChatFeedback({ user: owner(), jobId, rating: "negative", reasonCode: "other", comment: "Otro texto" });
    [row] = await query("SELECT comment_at FROM customer_chat_turn_feedback WHERE job_id = ?", [jobId]);
    expect(new Date(row.comment_at).getUTCFullYear()).toBeGreaterThan(2025);
    await submitCustomerChatFeedback({ user: owner(), jobId, rating: "positive", reasonCode: "other", comment: "ignorado" });
    [row] = await query("SELECT rating, reason_code, comment, comment_at FROM customer_chat_turn_feedback WHERE job_id = ?", [jobId]);
    expect(row).toMatchObject({ rating: "positive", reason_code: null, comment: null, comment_at: null });
  });

  it("lista el triaje con pregunta, extracto de respuesta y un resumen", async () => {
    const jobId = await insertJob({ question: "Pregunta de triaje", answer: "Respuesta de triaje" });
    await submitCustomerChatFeedback({ user: owner(), jobId, rating: "negative", reasonCode: "misunderstood", comment: "No entendió" });
    const result = await listFeedbackForTriage({ rating: "negative", triageStatus: "new", reasonCode: "misunderstood" });
    const item = result.items.find((entry) => entry.jobId === jobId);
    expect(item).toMatchObject({
      rating: "negative", reasonCode: "misunderstood", comment: "No entendió",
      question: "Pregunta de triaje", answerExcerpt: "Respuesta de triaje", userName: "Feedback Owner", triageStatus: "new",
    });
    expect(item.accountName).toBeTruthy();
    expect(result.summary.negative).toBeGreaterThanOrEqual(1);
    expect(result.summary.byReason.misunderstood).toBeGreaterThanOrEqual(1);
    expect(result.summary.byStatus.new).toBeGreaterThanOrEqual(1);
    expect(result.summary.negativeRatePct).toBeGreaterThan(0);
  });

  it("marca un feedback como revisado y no permite cambiar uno ya convertido", async () => {
    const jobId = await insertJob();
    await submitCustomerChatFeedback({ user: owner(), jobId, rating: "negative", reasonCode: "format" });
    const feedback = (await listFeedbackForTriage({ reasonCode: "format" })).items.find((entry) => entry.jobId === jobId);
    await updateFeedbackTriage({ feedbackId: feedback.id, user: { id: reviewerId }, triageStatus: "reviewed", note: "Se corrige el formato" });
    const reviewed = (await listFeedbackForTriage({ triageStatus: "reviewed" })).items.find((entry) => entry.id === feedback.id);
    expect(reviewed).toMatchObject({ triageStatus: "reviewed", triageNote: "Se corrige el formato", triagedByName: "Feedback Reviewer" });
    await markFeedbackConverted({ feedbackId: feedback.id, user: { id: reviewerId }, evaluationCaseId: "U-1" });
    await expect(updateFeedbackTriage({ feedbackId: feedback.id, user: { id: reviewerId }, triageStatus: "dismissed" })).rejects.toMatchObject({ status: 404 });
    await expect(updateFeedbackTriage({ feedbackId: feedback.id, user: { id: reviewerId }, triageStatus: "otro" })).rejects.toMatchObject({ status: 400 });
    // Re-rating a converted feedback keeps it converted.
    await submitCustomerChatFeedback({ user: owner(), jobId, rating: "negative", reasonCode: "format", comment: "Sigue igual" });
    expect((await getFeedbackForTriage(feedback.id)).triage_status).toBe("converted");
  });

  it("borra solo los comentarios con más de 12 meses y conserva calificación y motivo", async () => {
    expect(FEEDBACK_COMMENT_RETENTION_MONTHS).toBe(12);
    const oldId = await insertJob();
    const freshId = await insertJob();
    await submitCustomerChatFeedback({ user: owner(), jobId: oldId, rating: "negative", reasonCode: "other", comment: "Dato del cliente" });
    await submitCustomerChatFeedback({ user: owner(), jobId: freshId, rating: "negative", reasonCode: "other", comment: "Comentario reciente" });
    await query("UPDATE customer_chat_turn_feedback SET comment_at = DATE_SUB(NOW(3), INTERVAL 13 MONTH) WHERE job_id = ?", [oldId]);
    await query("UPDATE customer_chat_turn_feedback SET comment_at = DATE_SUB(NOW(3), INTERVAL 11 MONTH) WHERE job_id = ?", [freshId]);
    const purged = await purgeExpiredFeedbackComments();
    expect(purged).toBeGreaterThanOrEqual(1);
    const rows = await query("SELECT job_id, rating, reason_code, comment FROM customer_chat_turn_feedback WHERE job_id IN (?, ?)", [oldId, freshId]);
    const byJob = new Map(rows.map((row) => [Number(row.job_id), row]));
    expect(byJob.get(oldId)).toMatchObject({ rating: "negative", reason_code: "other", comment: null });
    expect(byJob.get(freshId).comment).toBe("Comentario reciente");
  });

  it("los casos creados desde feedback se suman al catálogo y cambian su versión", async () => {
    const before = await getEvaluationCatalog();
    const created = await createCustomEvaluationCase({
      title: "Monto de la oportunidad", question: "¿Cuál es el monto?", expected: "Debe responder el monto en USD.",
      accountId, accountName: "Cuenta de prueba", sourceFeedbackId: null, userId: reviewerId,
    });
    customCaseIds.push(Number(created.id.replace("U-", "")));
    const after = await getEvaluationCatalog();
    const found = after.cases.find((item) => item.id === created.id);
    expect(found).toMatchObject({
      category: "USR", accountId, expectedAccountName: "Cuenta de prueba", blockedReason: null, requiresHumanReview: true,
      steps: [{ question: "¿Cuál es el monto?", expected: "Debe responder el monto en USD." }],
    });
    expect(after.cases.length).toBe(before.cases.length + 1);
    expect(after.version).not.toBe(before.version);
  });
});
