import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("../src/ai-services/client.js", () => ({ aiFetch: vi.fn() }));

import { app } from "../src/app.js";
import { query } from "../src/db.js";
import { buildChatSessionTitle, CHAT_SESSION_LIST_PAGE_SIZE } from "../src/commercial-intelligence/service.js";
import { TEST_PREFIX, cleanupArtifacts, createDirectAccount, createRole, createUser, login } from "./helpers/apiTestUtils.js";

const api = () => supertest(app);
const PERMISSIONS = ["mi_coach.access", "inteligencia_comercial.access", "inteligencia_comercial.read", "cuentas.read"];
const BASE = "/api/commercial-intelligence/account-chat/sessions";

describe("historial de conversaciones del chat de cuenta", () => {
  const ids = { users: [], roles: [] };
  const sessionIds = [];
  let sellerToken;
  let otherToken;
  let sellerId;
  let otherId;
  let accountId;
  let otherAccountId;
  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  const makeUser = async (label) => {
    const roleId = await createRole({ name: `${TEST_PREFIX}_hist_${label}`, permissionCodes: PERMISSIONS });
    ids.roles.push(roleId);
    const email = `${TEST_PREFIX}.hist.${label}@example.com`;
    const userId = await createUser({ fullName: `Hist ${label}`, email, roleIds: [roleId] });
    ids.users.push(userId);
    const response = await login(api(), email);
    expect(response.status).toBe(200);
    return { userId, token: response.body.token };
  };

  const insertSession = async ({ userId = sellerId, account = accountId, history, updatedAt = new Date() }) => {
    const result = await query(
      `INSERT INTO customer_intelligence_chat_sessions
        (public_id, requested_by_user_id, account_id, history_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [`cacs_${TEST_PREFIX}_${Math.random().toString(36).slice(2, 10)}`, userId, account, JSON.stringify(history), updatedAt, updatedAt],
    );
    sessionIds.push(Number(result.insertId));
    return Number(result.insertId);
  };
  const turn = (question, answer = "Respuesta") => [{ role: "user", text: question }, { role: "assistant", text: answer }];

  beforeAll(async () => {
    const seller = await makeUser("seller");
    const other = await makeUser("other");
    sellerToken = seller.token; sellerId = seller.userId; otherToken = other.token; otherId = other.userId;
    accountId = await createDirectAccount({ ownerUserId: sellerId, actorUserId: sellerId, suffix: `${TEST_PREFIX}_hist1` });
    otherAccountId = await createDirectAccount({ ownerUserId: sellerId, actorUserId: sellerId, suffix: `${TEST_PREFIX}_hist2` });
  });

  afterAll(async () => {
    if (sessionIds.length) await query("DELETE FROM customer_intelligence_chat_sessions WHERE id IN (?)", [sessionIds]);
    await cleanupArtifacts({ accountIds: [accountId, otherAccountId], userIds: ids.users, roleIds: ids.roles });
  });

  test("construye títulos legibles a partir del primer mensaje", () => {
    expect(buildChatSessionTitle("  ¿Cómo   va\n la cuenta? ")).toBe("¿Cómo va la cuenta?");
    expect(buildChatSessionTitle("")).toBe("Conversación sin título");
    expect(buildChatSessionTitle(null)).toBe("Conversación sin título");
    const long = buildChatSessionTitle("a".repeat(200));
    expect(long).toHaveLength(80);
    expect(long.endsWith("…")).toBe(true);
  });

  test("lista solo las conversaciones propias de la cuenta, de la más reciente a la más antigua, sin las vacías", async () => {
    const older = await insertSession({ history: turn("Primera pregunta"), updatedAt: new Date(Date.now() - 3600000) });
    const newer = await insertSession({ history: [...turn("Segunda pregunta"), ...turn("Otra más")], updatedAt: new Date() });
    await insertSession({ history: [] });
    await insertSession({ userId: otherId, history: turn("De otro vendedor") });
    await insertSession({ account: otherAccountId, history: turn("De otra cuenta") });
    const response = await api().get(`${BASE}?accountId=${accountId}`).set(auth(sellerToken));
    expect(response.status).toBe(200);
    expect(response.body.sessions.map((item) => item.id)).toEqual([newer, older]);
    expect(response.body.sessions[0]).toMatchObject({ title: "Segunda pregunta", messageCount: 4, opportunityId: null });
    expect(response.body.sessions[1]).toMatchObject({ title: "Primera pregunta", messageCount: 2 });
    expect(response.body).toMatchObject({ page: 1, hasMore: false });
    expect(JSON.stringify(response.body)).not.toContain("Respuesta");
  });

  test("no muestra conversaciones a quien no tiene acceso a la cuenta", async () => {
    const denied = await api().get(`${BASE}?accountId=${accountId}`).set(auth(otherToken));
    expect([403, 404]).toContain(denied.status);
    expect(JSON.stringify(denied.body)).not.toContain("Primera pregunta");
  });

  test("valida los parámetros y exige autenticación", async () => {
    expect((await api().get(BASE).set(auth(sellerToken))).status).toBe(400);
    expect((await api().get(`${BASE}?accountId=abc`).set(auth(sellerToken))).status).toBe(400);
    expect((await api().get(`${BASE}?accountId=${accountId}&page=0`).set(auth(sellerToken))).status).toBe(400);
    expect((await api().get(`${BASE}?accountId=${accountId}`)).status).toBe(401);
  });

  test("pagina el listado", async () => {
    for (let index = 0; index < CHAT_SESSION_LIST_PAGE_SIZE; index += 1) {
      await insertSession({ history: turn(`Pregunta ${index}`), updatedAt: new Date(Date.now() - (index + 10) * 60000) });
    }
    const first = await api().get(`${BASE}?accountId=${accountId}`).set(auth(sellerToken));
    expect(first.body.sessions).toHaveLength(CHAT_SESSION_LIST_PAGE_SIZE);
    expect(first.body.hasMore).toBe(true);
    const second = await api().get(`${BASE}?accountId=${accountId}&page=2`).set(auth(sellerToken));
    expect(second.body.page).toBe(2);
    expect(second.body.sessions.length).toBeGreaterThan(0);
    expect(second.body.hasMore).toBe(false);
  });

  test("la sesión devuelve 8 mensajes por defecto y hasta el límite pedido", async () => {
    const history = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", text: `m${index}` }));
    const id = await insertSession({ history });
    const byDefault = await api().get(`${BASE}/${id}`).set(auth(sellerToken));
    expect(byDefault.body.session.history).toHaveLength(8);
    const more = await api().get(`${BASE}/${id}?limit=25`).set(auth(sellerToken));
    expect(more.body.session.history).toHaveLength(25);
    expect(more.body.session.history.at(-1).text).toBe("m29");
    const invalid = await api().get(`${BASE}/${id}?limit=9999`).set(auth(sellerToken));
    expect(invalid.body.session.history).toHaveLength(8);
    expect((await api().get(`${BASE}/${id}`).set(auth(otherToken))).status).toBe(404);
  });
});
