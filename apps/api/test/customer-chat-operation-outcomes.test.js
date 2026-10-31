import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("../src/ai-services/client.js", () => ({ aiFetch: vi.fn() }));

import { app } from "../src/app.js";
import { query } from "../src/db.js";
import { chatOperationSignature } from "../src/coach/chat-confirmation.js";
import { getCustomerIntelligenceJob } from "../src/commercial-intelligence/service.js";
import { listChatOperationOutcomes, recordChatOperationOutcome } from "../src/commercial-intelligence/operation-outcomes.js";
import { TEST_PREFIX, cleanupArtifacts, createDirectAccount, createRole, createUser, login } from "./helpers/apiTestUtils.js";

const api = () => supertest(app);
const CI = "/api/commercial-intelligence";
const SELLER_PERMISSIONS = ["mi_coach.access", "inteligencia_comercial.access", "inteligencia_comercial.read", "cuentas.read"];

const note = { kind: "opportunity_note", sourceChannel: "customer_account", accountId: 1, opportunityId: 300, noteText: "Nota de prueba", title: "Registrar nota" };
const field = { kind: "opportunity_field", sourceChannel: "customer_account", opportunityId: 300, field: "amountUsd", currentValue: 10, value: 50, title: "Actualizar monto" };

describe("confirmación en el chat: resultados persistidos", () => {
  const ids = { users: [], roles: [] };
  const sessionIds = [];
  const jobIds = [];
  let sellerToken;
  let sellerId;
  let otherId;
  let accountId;
  let sessionId;
  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  const makeUser = async (label, permissionCodes) => {
    const roleId = await createRole({ name: `${TEST_PREFIX}_conf_${label}`, permissionCodes });
    ids.roles.push(roleId);
    const email = `${TEST_PREFIX}.conf.${label}@example.com`;
    const userId = await createUser({ fullName: `Conf ${label}`, email, roleIds: [roleId] });
    ids.users.push(userId);
    const response = await login(api(), email);
    expect(response.status).toBe(200);
    return { userId, token: response.body.token };
  };

  beforeAll(async () => {
    const seller = await makeUser("seller", SELLER_PERMISSIONS);
    const other = await makeUser("other", SELLER_PERMISSIONS);
    sellerToken = seller.token; sellerId = seller.userId; otherId = other.userId;
    accountId = await createDirectAccount({ ownerUserId: sellerId, actorUserId: sellerId, suffix: `${TEST_PREFIX}_conf` });
    const history = [
      { role: "user", text: "Registra una nota y sube el monto" },
      { role: "assistant", text: "Preparé dos cambios.", operations: [note, field] },
    ];
    const session = await query(
      `INSERT INTO customer_intelligence_chat_sessions (public_id, requested_by_user_id, account_id, history_json) VALUES (?, ?, ?, ?)`,
      [`cacs_${TEST_PREFIX}_conf`, sellerId, accountId, JSON.stringify(history)],
    );
    sessionId = Number(session.insertId);
    sessionIds.push(sessionId);
  });

  afterAll(async () => {
    if (jobIds.length) await query("DELETE FROM customer_intelligence_jobs WHERE id IN (?)", [jobIds]);
    if (sessionIds.length) await query("DELETE FROM customer_intelligence_chat_sessions WHERE id IN (?)", [sessionIds]);
    await cleanupArtifacts({ accountIds: [accountId], userIds: ids.users, roleIds: ids.roles });
  });

  test("la conversación devuelve cada operación con su firma y, si ya se respondió, el resultado", async () => {
    const before = await api().get(`${CI}/account-chat/sessions/${sessionId}`).set(auth(sellerToken));
    const operations = before.body.session.history[1].operations;
    expect(operations.map((item) => item.signature)).toEqual([chatOperationSignature(note), chatOperationSignature(field)]);
    expect(operations.some((item) => item.outcome)).toBe(false);

    expect(await recordChatOperationOutcome({ userId: sellerId, chatSessionId: sessionId, operation: note, status: "confirmed", operationId: 1 })).toBe(true);
    expect(await recordChatOperationOutcome({ userId: sellerId, chatSessionId: sessionId, operation: field, status: "discarded" })).toBe(true);
    const after = await api().get(`${CI}/account-chat/sessions/${sessionId}`).set(auth(sellerToken));
    expect(after.body.session.history[1].operations.map((item) => item.outcome)).toEqual(["confirmed", "discarded"]);
    expect(after.body.session.history[0]).not.toHaveProperty("operations");
  });

  test("el resultado se actualiza y no se mezcla entre conversaciones ni usuarios", async () => {
    expect(await recordChatOperationOutcome({ userId: sellerId, chatSessionId: sessionId, operation: field, status: "confirmed", operationId: 2 })).toBe(true);
    expect((await listChatOperationOutcomes({ chatSessionId: sessionId })).get(chatOperationSignature(field))).toBe("confirmed");
    expect(await recordChatOperationOutcome({ userId: otherId, chatSessionId: sessionId, operation: note, status: "discarded" })).toBe(false);
    expect((await listChatOperationOutcomes({ chatSessionId: sessionId })).get(chatOperationSignature(note))).toBe("confirmed");
    expect((await listChatOperationOutcomes({ chatSessionId: 0 })).size).toBe(0);
    await expect(recordChatOperationOutcome({ userId: sellerId, chatSessionId: sessionId, operation: note, status: "otro" })).rejects.toThrow(/desconocido/);
  });

  test("el resultado de un turno también trae firma y resultado", async () => {
    const result = await query(
      `INSERT INTO customer_intelligence_jobs
        (public_id, account_id, requested_by_user_id, job_type, status, request_json, result_json, created_at, updated_at, finished_at)
       VALUES (?, ?, ?, 'account_chat', 'completed', ?, ?, NOW(3), NOW(3), NOW(3))`,
      [`cac_${TEST_PREFIX}_conf`, accountId, sellerId, JSON.stringify({ chatSessionId: sessionId, question: "q" }),
        JSON.stringify({ answer: "Preparé una nota.", operations: [note] })],
    );
    jobIds.push(Number(result.insertId));
    const job = await getCustomerIntelligenceJob({ user: { id: sellerId, permissionSet: new Set() }, jobId: Number(result.insertId) });
    expect(job.result.operations).toEqual([{ ...note, signature: chatOperationSignature(note), outcome: "confirmed" }]);
    const plain = await query(
      `INSERT INTO customer_intelligence_jobs
        (public_id, account_id, requested_by_user_id, job_type, status, request_json, result_json, created_at, updated_at, finished_at)
       VALUES (?, ?, ?, 'account_chat', 'completed', ?, ?, NOW(3), NOW(3), NOW(3))`,
      [`cac_${TEST_PREFIX}_conf2`, accountId, sellerId, JSON.stringify({ chatSessionId: sessionId }), JSON.stringify({ answer: "Sin cambios." })],
    );
    jobIds.push(Number(plain.insertId));
    const withoutOperations = await getCustomerIntelligenceJob({ user: { id: sellerId, permissionSet: new Set() }, jobId: Number(plain.insertId) });
    expect(withoutOperations.result).toEqual({ answer: "Sin cambios." });
  });
});
