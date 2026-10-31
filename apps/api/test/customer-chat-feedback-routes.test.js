import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("../src/ai-services/client.js", () => ({ aiFetch: vi.fn() }));
vi.mock("../src/ai-usage/service.js", async (importOriginal) => ({
  ...(await importOriginal()),
  assertAiBudgetAvailable: vi.fn(async () => undefined),
  recordAiUsageFromOpenAiResponse: vi.fn(async () => null),
}));

import { app } from "../src/app.js";
import { query } from "../src/db.js";
import {
  TEST_PREFIX,
  cleanupArtifacts,
  createDirectAccount,
  createRole,
  createUser,
  login,
} from "./helpers/apiTestUtils.js";

const api = () => supertest(app);
const SELLER_PERMISSIONS = ["mi_coach.access", "inteligencia_comercial.access", "inteligencia_comercial.read"];

describe("rutas del feedback del chat de cliente", () => {
  const ids = { users: [], roles: [] };
  let sellerToken;
  let reviewerToken;
  let evaluatorToken;
  let outsiderToken;
  let accountId;
  let sessionId;
  let jobId;
  let sellerId;
  const customCaseIds = [];

  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  const makeUser = async (label, permissionCodes) => {
    const roleId = await createRole({ name: `${TEST_PREFIX}_fb_${label}`, permissionCodes });
    ids.roles.push(roleId);
    const email = `${TEST_PREFIX}.fb.${label}@example.com`;
    const userId = await createUser({ fullName: `Feedback ${label}`, email, roleIds: [roleId] });
    ids.users.push(userId);
    const response = await login(api(), email);
    expect(response.status).toBe(200);
    return { userId, token: response.body.token };
  };

  beforeAll(async () => {
    const seller = await makeUser("seller", SELLER_PERMISSIONS);
    sellerToken = seller.token;
    sellerId = seller.userId;
    reviewerToken = (await makeUser("reviewer", [...SELLER_PERMISSIONS, "mi_coach.chat_diagnostics"])).token;
    evaluatorToken = (await makeUser("evaluator", [...SELLER_PERMISSIONS, "mi_coach.chat_diagnostics", "mi_coach.evaluations_write"])).token;
    outsiderToken = (await makeUser("outsider", SELLER_PERMISSIONS)).token;
    accountId = await createDirectAccount({ ownerUserId: sellerId, actorUserId: sellerId, suffix: `${TEST_PREFIX}_fbroutes` });
    const session = await query(
      `INSERT INTO customer_intelligence_chat_sessions
        (public_id, requested_by_user_id, account_id, history_json) VALUES (?, ?, ?, '[]')`,
      [`cacs_${TEST_PREFIX}_fbroutes`, sellerId, accountId],
    );
    sessionId = Number(session.insertId);
    const job = await query(
      `INSERT INTO customer_intelligence_jobs
        (public_id, account_id, requested_by_user_id, job_type, status, request_json, result_json, created_at, updated_at, finished_at)
       VALUES (?, ?, ?, 'account_chat', 'completed', ?, ?, NOW(3), NOW(3), NOW(3))`,
      [
        `cac_${TEST_PREFIX}_fbroutes`, accountId, sellerId,
        JSON.stringify({ chatSessionId: sessionId, question: "¿Cuál es la etapa?" }),
        JSON.stringify({ answer: "Está en negociación." }),
      ],
    );
    jobId = Number(job.insertId);
  });

  afterAll(async () => {
    if (customCaseIds.length) await query("DELETE FROM customer_chat_evaluation_custom_cases WHERE id IN (?)", [customCaseIds]);
    await query("DELETE FROM customer_chat_turn_feedback WHERE job_id = ?", [jobId]);
    await query("DELETE FROM customer_intelligence_jobs WHERE id = ?", [jobId]);
    await query("DELETE FROM customer_intelligence_chat_sessions WHERE id = ?", [sessionId]);
    await cleanupArtifacts({ accountIds: [accountId], userIds: ids.users, roleIds: ids.roles });
  });

  test("el vendedor califica su respuesta y la lista de la sesión no devuelve el comentario", async () => {
    const response = await api().post(`/api/commercial-intelligence/account-chat/jobs/${jobId}/feedback`)
      .set(auth(sellerToken))
      .send({ rating: "negative", reasonCode: "incorrect_data", comment: "La etapa no es esa" });
    expect(response.status).toBe(200);
    expect(response.body.feedback).toEqual({ jobId, rating: "negative", reasonCode: "incorrect_data", hasComment: true });

    const session = await api().get(`/api/commercial-intelligence/account-chat/sessions/${sessionId}`).set(auth(sellerToken));
    expect(session.status).toBe(200);
    expect(session.body.session.feedback).toEqual([{ jobId, rating: "negative", reasonCode: "incorrect_data", hasComment: true }]);
    expect(JSON.stringify(session.body)).not.toContain("La etapa no es esa");
  });

  test("valida el cuerpo y no deja calificar la respuesta de otro usuario", async () => {
    const invalid = await api().post(`/api/commercial-intelligence/account-chat/jobs/${jobId}/feedback`)
      .set(auth(sellerToken)).send({ rating: "regular" });
    expect(invalid.status).toBe(400);
    const foreign = await api().post(`/api/commercial-intelligence/account-chat/jobs/${jobId}/feedback`)
      .set(auth(outsiderToken)).send({ rating: "positive" });
    expect(foreign.status).toBe(404);
  });

  test("el triaje solo lo ven quienes tienen el permiso de diagnóstico", async () => {
    for (const token of [sellerToken, outsiderToken]) {
      const denied = await api().get("/api/commercial-intelligence/account-chat/diagnostics/feedback").set(auth(token));
      expect(denied.status).toBe(403);
      expect(denied.body.requiredPermission).toBe("mi_coach.chat_diagnostics");
    }
    const allowed = await api().get("/api/commercial-intelligence/account-chat/diagnostics/feedback?reasonCode=incorrect_data")
      .set(auth(reviewerToken));
    expect(allowed.status).toBe(200);
    const item = allowed.body.items.find((entry) => entry.jobId === jobId);
    expect(item).toMatchObject({
      comment: "La etapa no es esa", question: "¿Cuál es la etapa?", answerExcerpt: "Está en negociación.", triageStatus: "new",
    });
    expect(allowed.body.summary.negative).toBeGreaterThanOrEqual(1);
    const badFilter = await api().get("/api/commercial-intelligence/account-chat/diagnostics/feedback?rating=otro").set(auth(reviewerToken));
    expect(badFilter.status).toBe(400);
  });

  test("el revisor marca el feedback y queda en la auditoría sin el texto del comentario", async () => {
    const list = await api().get("/api/commercial-intelligence/account-chat/diagnostics/feedback").set(auth(reviewerToken));
    const item = list.body.items.find((entry) => entry.jobId === jobId);
    const denied = await api().patch(`/api/commercial-intelligence/account-chat/diagnostics/feedback/${item.id}`)
      .set(auth(sellerToken)).send({ triageStatus: "reviewed" });
    expect(denied.status).toBe(403);
    const updated = await api().patch(`/api/commercial-intelligence/account-chat/diagnostics/feedback/${item.id}`)
      .set(auth(reviewerToken)).send({ triageStatus: "reviewed", note: "Se revisa la etapa" });
    expect(updated.status).toBe(200);
    const [audit] = await query(
      "SELECT detail, changed_fields FROM audit_log WHERE action = 'chat_feedback_triaged' AND entity_id = ? ORDER BY id DESC LIMIT 1",
      [item.id],
    );
    expect(audit.detail).toContain("reviewed");
    expect(`${audit.detail}${audit.changed_fields || ""}`).not.toContain("La etapa no es esa");
  });

  test("convertir en caso de prueba exige además el permiso de escritura de evaluaciones", async () => {
    const list = await api().get("/api/commercial-intelligence/account-chat/diagnostics/feedback").set(auth(reviewerToken));
    const item = list.body.items.find((entry) => entry.jobId === jobId);
    const body = { title: "Etapa de la oportunidad", question: "¿Cuál es la etapa?", expected: "Debe indicar la etapa vigente de la oportunidad." };
    const denied = await api().post(`/api/commercial-intelligence/account-chat/diagnostics/feedback/${item.id}/convert`)
      .set(auth(reviewerToken)).send(body);
    expect(denied.status).toBe(403);
    expect(denied.body.requiredPermission).toBe("mi_coach.evaluations_write");

    const short = await api().post(`/api/commercial-intelligence/account-chat/diagnostics/feedback/${item.id}/convert`)
      .set(auth(evaluatorToken)).send({ ...body, expected: "corto" });
    expect(short.status).toBe(400);

    const created = await api().post(`/api/commercial-intelligence/account-chat/diagnostics/feedback/${item.id}/convert`)
      .set(auth(evaluatorToken)).send(body);
    expect(created.status).toBe(201);
    expect(created.body.evaluationCaseId).toMatch(/^U-\d+$/);
    customCaseIds.push(Number(created.body.evaluationCaseId.replace("U-", "")));

    const again = await api().post(`/api/commercial-intelligence/account-chat/diagnostics/feedback/${item.id}/convert`)
      .set(auth(evaluatorToken)).send(body);
    expect(again.status).toBe(409);

    const converted = await api().get("/api/commercial-intelligence/account-chat/diagnostics/feedback?triageStatus=converted")
      .set(auth(reviewerToken));
    expect(converted.body.items.find((entry) => entry.jobId === jobId)).toMatchObject({
      triageStatus: "converted", evaluationCaseId: created.body.evaluationCaseId,
    });
  });
});
