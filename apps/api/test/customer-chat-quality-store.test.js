import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("../src/ai-services/client.js", () => ({ aiFetch: vi.fn() }));

import { app } from "../src/app.js";
import { query } from "../src/db.js";
import { getQualityOverview, purgeOldQualityRuns, recordQualityRun } from "../src/customer-chat-quality/store.js";
import { runProductionMonitor } from "../src/customer-chat-quality/production-monitor.js";
import { TEST_PREFIX, cleanupArtifacts, createRole, createUser, login } from "./helpers/apiTestUtils.js";

const api = () => supertest(app);
const contract = (catalog, critical = 9, dialogue = 13) => ({
  model: "test-model",
  groups: { catalog: { passed: catalog, total: 46 }, dialogue: { passed: dialogue, total: 13 }, critical: { passed: critical, total: 9 } },
  results: critical < 9 ? [{ group: "critical", expected: "compound", passed: false, error: "boom" }] : [],
});

describe("registro y consulta de la calidad del chat de cliente", () => {
  const ids = { users: [], roles: [] };
  const runIds = [];
  const base = Date.UTC(2001, 0, 1);
  const at = (day) => new Date(base + day * 86400000).toISOString();
  let readerToken;
  let executorToken;
  let outsiderToken;
  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  const makeUser = async (label, permissionCodes) => {
    const roleId = await createRole({ name: `${TEST_PREFIX}_q_${label}`, permissionCodes });
    ids.roles.push(roleId);
    const email = `${TEST_PREFIX}.q.${label}@example.com`;
    ids.users.push(await createUser({ fullName: `Quality ${label}`, email, roleIds: [roleId] }));
    const response = await login(api(), email);
    expect(response.status).toBe(200);
    return response.body.token;
  };

  beforeAll(async () => {
    readerToken = await makeUser("reader", ["mi_coach.access", "mi_coach.evaluations_read"]);
    executorToken = await makeUser("executor", ["mi_coach.access", "mi_coach.evaluations_read", "mi_coach.evaluations_execute"]);
    outsiderToken = await makeUser("outsider", ["mi_coach.access"]);
  });

  afterAll(async () => {
    if (runIds.length) await query("DELETE FROM customer_chat_quality_runs WHERE id IN (?)", [runIds]);
    await cleanupArtifacts({ userIds: ids.users, roleIds: ids.roles });
  });

  test("guarda el commit, el modelo y compara con la ejecución anterior", async () => {
    const first = await recordQualityRun({ source: "contract", report: contract(46), model: "test-model", commitSha: "a".repeat(40), trigger: "ci", evaluatedAt: at(1) });
    const second = await recordQualityRun({ source: "contract", report: contract(43), model: "test-model", commitSha: "b".repeat(40), evaluatedAt: at(2) });
    const third = await recordQualityRun({ source: "contract", report: contract(46, 8), evaluatedAt: at(3) });
    runIds.push(first.id, second.id, third.id);
    expect(first).toMatchObject({ status: "passed", trigger: "ci", model: "test-model", commit: "a".repeat(40) });
    expect(second.status).toBe("failed");
    expect(second.reasons.join(" ")).toMatch(/Categoría y objeto: 43\/46/);
    expect(third.status).toBe("failed");
    expect(third.details).toEqual([{ group: "critical", id: "compound", error: "boom" }]);
  });

  test("marca regresión sin romper los umbrales", async () => {
    const before = await recordQualityRun({ source: "contract", report: contract(46), evaluatedAt: at(10) });
    const after = await recordQualityRun({ source: "contract", report: contract(46, 9, 12), evaluatedAt: at(11) });
    runIds.push(before.id, after.id);
    expect(after.status).toBe("regressed");
  });

  test("rechaza fuentes y fechas inválidas", async () => {
    await expect(recordQualityRun({ source: "x", report: {} })).rejects.toThrow(/desconocida/);
    await expect(recordQualityRun({ source: "contract", report: contract(46), evaluatedAt: "no-es-fecha" })).rejects.toThrow(/Fecha/);
  });

  test("el resumen devuelve la última ejecución de cada fuente aunque sea antigua", async () => {
    const overview = await getQualityOverview({ days: 30 });
    expect(overview.latest.contract).toBeTruthy();
    expect(overview.runs.every((run) => new Date(run.evaluatedAt).getTime() > Date.now() - 31 * 86400000)).toBe(true);
  });

  test("el monitoreo no se repite antes de 20 horas salvo que se fuerce", async () => {
    const forced = await runProductionMonitor({ force: true, trigger: "manual" });
    runIds.push(forced.id);
    expect(forced.source).toBe("production_monitor");
    expect(forced.metrics.windowDays).toBe(7);
    expect(await runProductionMonitor()).toBeNull();
  });

  test("elimina ejecuciones de más de 24 meses", async () => {
    const old = await recordQualityRun({ source: "pipeline", report: { scenarios: [] }, evaluatedAt: at(0) });
    expect(await purgeOldQualityRuns({ months: 24 })).toBeGreaterThanOrEqual(1);
    const [row] = await query("SELECT id FROM customer_chat_quality_runs WHERE id = ?", [old.id]);
    expect(row).toBeUndefined();
  });

  test("la ruta de calidad exige permiso de lectura y el snapshot el de ejecución", async () => {
    expect((await api().get("/api/mi-agent/evaluations/quality").set(auth(outsiderToken))).status).toBe(403);
    const read = await api().get("/api/mi-agent/evaluations/quality").set(auth(readerToken));
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ days: 90, runs: expect.any(Array), latest: expect.any(Object) });
    expect((await api().get("/api/mi-agent/evaluations/quality?days=0").set(auth(readerToken))).status).toBe(400);
    expect((await api().post("/api/mi-agent/evaluations/quality/production-snapshot").set(auth(readerToken))).status).toBe(403);
    const snapshot = await api().post("/api/mi-agent/evaluations/quality/production-snapshot").set(auth(executorToken));
    expect(snapshot.status).toBe(200);
    runIds.push(snapshot.body.run.id);
  });
});
