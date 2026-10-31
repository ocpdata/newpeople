import supertest from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("../src/ai-services/client.js", () => ({ aiFetch: vi.fn() }));

import { app } from "../src/app.js";
import { config } from "../src/config.js";
import { query } from "../src/db.js";
import { setWeeklyEvaluationEnabled } from "../src/customer-chat-quality/store.js";
import { buildSubmission, endpointFor } from "../src/customer-chat-quality/submission.js";
import { tokenMatches } from "../src/customer-chat-quality/ci-routes.js";
import { TEST_PREFIX, cleanupArtifacts, createRole, createUser, login } from "./helpers/apiTestUtils.js";

const api = () => supertest(app);
const CI = "/api/internal/customer-chat-quality";
const TOKEN = "t".repeat(40);
const ciAuth = (token = TOKEN) => ({ Authorization: `Bearer ${token}` });
const day = (offset) => new Date(Date.UTC(2002, 0, 1) + offset * 86400000).toISOString();
const contractBody = (patch = {}, reportPatch = {}) => ({
  source: "contract", commit: "c".repeat(40),
  report: { model: "m", evaluatedAt: day(1),
    groups: { catalog: { passed: 46, total: 46 }, dialogue: { passed: 13, total: 13 }, critical: { passed: 9, total: 9 } }, ...reportPatch },
  ...patch,
});

describe("integración del flujo semanal con la aplicación", () => {
  const ids = { users: [], roles: [] };
  const runIds = [];
  const originalToken = config.customerChatQuality.ciToken;
  let readerToken;
  let executorToken;
  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  const makeUser = async (label, permissionCodes) => {
    const roleId = await createRole({ name: `${TEST_PREFIX}_ci_${label}`, permissionCodes });
    ids.roles.push(roleId);
    const email = `${TEST_PREFIX}.ci.${label}@example.com`;
    ids.users.push(await createUser({ fullName: `CI ${label}`, email, roleIds: [roleId] }));
    const response = await login(api(), email);
    expect(response.status).toBe(200);
    return response.body.token;
  };

  beforeAll(async () => {
    readerToken = await makeUser("reader", ["mi_coach.access", "mi_coach.evaluations_read"]);
    executorToken = await makeUser("executor", ["mi_coach.access", "mi_coach.evaluations_read", "mi_coach.evaluations_execute"]);
  });

  afterEach(() => { config.customerChatQuality.ciToken = originalToken; });

  afterAll(async () => {
    config.customerChatQuality.ciToken = originalToken;
    await setWeeklyEvaluationEnabled({ enabled: false, userId: null });
    if (runIds.length) await query("DELETE FROM customer_chat_quality_runs WHERE id IN (?)", [runIds]);
    await cleanupArtifacts({ userIds: ids.users, roleIds: ids.roles });
  });

  test("sin token configurado la integración responde 503 y nunca acepta tokens vacíos", async () => {
    config.customerChatQuality.ciToken = "";
    expect((await api().get(`${CI}/status`).set(ciAuth(""))).status).toBe(503);
    config.customerChatQuality.ciToken = "corto";
    expect((await api().get(`${CI}/status`).set(ciAuth("corto"))).status).toBe(503);
  });

  test("rechaza tokens ausentes o incorrectos", async () => {
    config.customerChatQuality.ciToken = TOKEN;
    expect((await api().get(`${CI}/status`)).status).toBe(401);
    expect((await api().get(`${CI}/status`).set(ciAuth("x".repeat(40)))).status).toBe(401);
    expect((await api().post(`${CI}/reports`).set(ciAuth("x".repeat(40))).send(contractBody())).status).toBe(401);
    expect((await api().get(`${CI}/status`).set(auth(executorToken))).status).toBe(401);
  });

  test("el estado refleja el interruptor de la aplicación y no se guarda en caché", async () => {
    config.customerChatQuality.ciToken = TOKEN;
    await setWeeklyEvaluationEnabled({ enabled: false, userId: null });
    const off = await api().get(`${CI}/status`).set(ciAuth());
    expect(off.body).toEqual({ weeklyEnabled: false });
    expect(off.headers["cache-control"]).toBe("no-store");
    await setWeeklyEvaluationEnabled({ enabled: true, userId: null });
    expect((await api().get(`${CI}/status`).set(ciAuth())).body).toEqual({ weeklyEnabled: true });
  });

  test("guarda el reporte, calcula el estado en el servidor y es idempotente", async () => {
    config.customerChatQuality.ciToken = TOKEN;
    const body = contractBody({}, { groups: { catalog: { passed: 40, total: 46 }, dialogue: { passed: 13, total: 13 }, critical: { passed: 9, total: 9 } } });
    body.report.passed = true;
    body.status = "passed";
    const first = await api().post(`${CI}/reports`).set(ciAuth()).send(body);
    expect(first.status).toBe(201);
    runIds.push(first.body.id);
    expect(first.body).toMatchObject({ status: "failed", duplicate: false });
    expect(first.body.reasons.join(" ")).toMatch(/Categoría y objeto: 40\/46/);
    const again = await api().post(`${CI}/reports`).set(ciAuth()).send(body);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: first.body.id, duplicate: true });
    const [row] = await query("SELECT trigger_kind, commit_sha, model FROM customer_chat_quality_runs WHERE id = ?", [first.body.id]);
    expect(row).toEqual({ trigger_kind: "ci", commit_sha: "c".repeat(40), model: "m" });
  });

  test("valida el contenido del reporte", async () => {
    config.customerChatQuality.ciToken = TOKEN;
    const post = (body) => api().post(`${CI}/reports`).set(ciAuth()).send(body);
    expect((await post({ ...contractBody(), source: "evaluation_module" })).status).toBe(400);
    expect((await post(contractBody({ commit: "no-es-sha" }))).status).toBe(400);
    expect((await post(contractBody({}, { groups: { catalog: { passed: 9, total: 3 } } }))).status).toBe(400);
    expect((await post(contractBody({}, { groups: {} }))).status).toBe(400);
    expect((await post(contractBody({}, { evaluatedAt: "ayer" }))).status).toBe(400);
    expect((await post(contractBody({}, { evaluatedAt: new Date(Date.now() + 5 * 86400000).toISOString() }))).status).toBe(400);
    expect((await post({ source: "pipeline", report: { evaluatedAt: day(2), scenarios: [] } })).status).toBe(400);
  });

  test("acepta el reporte de recorridos", async () => {
    config.customerChatQuality.ciToken = TOKEN;
    const scenarios = Array.from({ length: 7 }, (_, index) => ({ name: `s${index}`, status: "pass" }));
    const response = await api().post(`${CI}/reports`).set(ciAuth()).send({ source: "pipeline", report: { evaluatedAt: day(3), scenarios } });
    expect(response.status).toBe(201);
    expect(response.body.status).toBe("passed");
    runIds.push(response.body.id);
  });

  test("el interruptor se lee con permiso de lectura y solo cambia con el de ejecución", async () => {
    const read = await api().get("/api/mi-agent/evaluations/quality").set(auth(readerToken));
    expect(read.status).toBe(200);
    expect(read.body.settings).toMatchObject({ weeklyEnabled: expect.any(Boolean), ciConfigured: expect.any(Boolean) });
    const put = (token, body) => api().put("/api/mi-agent/evaluations/quality/settings").set(auth(token)).send(body);
    expect((await put(readerToken, { weeklyEnabled: true })).status).toBe(403);
    expect((await put(executorToken, { weeklyEnabled: "si" })).status).toBe(400);
    const on = await put(executorToken, { weeklyEnabled: true });
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ weeklyEnabled: true, updatedBy: "CI executor" });
    expect((await put(executorToken, { weeklyEnabled: false })).body.weeklyEnabled).toBe(false);
  });
});

describe("preparación del envío desde el flujo", () => {
  test("envía solo los elementos fallidos y limita su tamaño", () => {
    const results = [
      { group: "catalog", expected: "a", passed: true, actual: { grande: "x".repeat(1000) } },
      { group: "catalog", expected: "b", passed: false, actual: { grande: true }, error: "e".repeat(500) },
    ];
    const body = buildSubmission({ source: "contract", commit: "ABCDEF1", report: { model: "m", evaluatedAt: day(1), groups: { catalog: { passed: 1, total: 2 } }, results } });
    expect(body.commit).toBe("ABCDEF1");
    expect(body.report.results).toEqual([{ group: "catalog", expected: "b", id: undefined, error: "e".repeat(300), passed: false }]);
    expect(JSON.stringify(body)).not.toContain("grande");
    expect(buildSubmission({ source: "contract", commit: "no", report: {} })).not.toHaveProperty("commit");
  });

  test("exige https salvo en servidores locales", () => {
    expect(endpointFor("https://app.example.com/", "api/internal/x")).toBe("https://app.example.com/api/internal/x");
    expect(endpointFor("https://app.example.com/base", "api/x")).toBe("https://app.example.com/base/api/x");
    expect(endpointFor("http://localhost:4000", "api/x")).toBe("http://localhost:4000/api/x");
    expect(() => endpointFor("http://app.example.com", "api/x")).toThrow(/https/);
  });

  test("compara tokens sin aceptar vacíos", () => {
    expect(tokenMatches("abc", "abc")).toBe(true);
    expect(tokenMatches("abd", "abc")).toBe(false);
    expect(tokenMatches("", "")).toBe(false);
  });
});
