import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mysql from "mysql2/promise";
const state = vi.hoisted(() => ({
  pool: null, chat: vi.fn(), snapshot: vi.fn(), actor: vi.fn(), metrics: vi.fn(), result: vi.fn(),
  rules: vi.fn(), permissions: new Set(), model: "evaluation-test", failCreate: false,
}));
vi.mock("../src/db.js", () => ({
  pool: { getConnection: async () => state.pool.getConnection() },
  query: async (...args) => (await state.pool.query(...args))[0],
  withTransaction: async (work) => {
    const conn = await state.pool.getConnection();
    try { await conn.beginTransaction(); const result = await work(conn); await conn.commit(); return result; }
    catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  },
}));
vi.mock("../src/config.js", () => ({ config: { port: 4000, openai: { apiKey: "unit-test-not-a-secret", model: "evaluation-test" } } }));
vi.mock("../src/auth.js", () => ({ getUserAuthContext: state.actor }));
vi.mock("../src/commercial-intelligence/service.js", () => ({
  buildAuthorizedCustomerSnapshot: state.snapshot, processCustomerAccountChatJob: state.chat,
  createCustomerAccountChatJob: vi.fn(async () => ({ job: { id: 100, chatSessionId: 200 } })),
  getCustomerIntelligenceJob: state.result, getCustomerSnapshotQueryMetrics: state.metrics,
}));
vi.mock("../src/coach/business-rules.js", () => ({
  getCoachBusinessRules: () => ({ operationPolicy: {} }), loadCoachBusinessRules: state.rules,
}));
vi.mock("../src/coach/semantic-classifier-prompts.js", () => ({
  loadSemanticClassifierPrompt: async () => ({ version: 1, instruction: "Clasificador de pruebas" }),
}));
vi.mock("../src/coach/planner-prompts.js", () => ({
  loadPlannerPrompt: async () => ({ version: 1, instruction: "Planificador de pruebas" }),
}));
vi.mock("../src/coach/channel-intent-governance.js", () => ({
  loadChannelIntentConfigurations: async () => [],
}));
import { randomUUID } from "node:crypto";
import {
  createEvaluation, processPendingEvaluations, getEvaluation, getEvaluationCase, listEvaluations,
  cancelEvaluation, reviewEvaluationCase, exportEvaluation, preflightEvaluation, evaluationRequestSchema,
  awaitEvaluationChat,
} from "../src/customer-chat-evaluations/service.js";
import { ensureEvaluationSchema } from "../src/customer-chat-evaluations/schema.js";
import { confirmEvaluationAction, readEvaluationActions } from "../src/customer-chat-evaluations/actions.js";
import { ensureEvaluationAdministratorAccess } from "../src/customer-chat-evaluations/permissions.js";
describe.skipIf(!process.env.G06_MYSQL_TEST_SOCKET)("Evaluation persistence and worker in isolated MySQL", () => {
  let admin;
  const database = `newpeople_evaluations_test_${process.pid}`;
  const sql = async (...args) => (await state.pool.query(...args))[0];
  const user = { id: 7, status: "active", permissionSet: new Set(["mi_coach.access", "mi_coach.evaluations_read",
    "mi_coach.evaluations_execute", "inteligencia_comercial.access", "inteligencia_comercial.read"]) };
  const launch = (patch = {}) => createEvaluation(user, { requestKey: randomUUID(), suite: "selected",
    caseIds: ["Q01-01"], acknowledgePaidCalls: true, ...patch });
  const caseRows = (id) => sql("SELECT * FROM customer_chat_evaluation_cases WHERE run_id=? ORDER BY ordinal", [id]);
  beforeAll(async () => {
    const options = { user: "root", socketPath: process.env.G06_MYSQL_TEST_SOCKET, timezone: "Z" };
    admin = await mysql.createConnection(options); await admin.query(`CREATE DATABASE ${database}`);
    state.pool = mysql.createPool({ ...options, database, connectionLimit: 6 });
    await sql("CREATE TABLE users(id BIGINT UNSIGNED PRIMARY KEY)"); await sql("INSERT INTO users VALUES(7),(8)");
    await ensureEvaluationSchema();
  });
  beforeEach(async () => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    await sql("DELETE FROM customer_chat_evaluation_events"); await sql("DELETE FROM customer_chat_evaluation_actions");
    await sql("DELETE FROM customer_chat_evaluation_cases"); await sql("DELETE FROM customer_chat_evaluation_runs");
    state.snapshot.mockResolvedValue({ account: { id: 22, name: "Totalplay" },
      opportunities: [{ id: 36, name: "Hardware Refresh", amountUsd: 500000 }], contacts: [] });
    state.actor.mockResolvedValue(user); state.metrics.mockReturnValue([]);
    state.rules.mockResolvedValue({ operationPolicy: {} });
    state.result.mockResolvedValue({ status: "completed", result: { answer: "Respuesta de prueba", operations: [] } });
    state.chat.mockResolvedValue(undefined);
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    if (state.pool) { await state.pool.end(); state.pool = null; }
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS ${database}`); await admin.end(); }
  });
  it("validates requests strictly and blocks missing paid-call consent", () => {
    expect(evaluationRequestSchema.safeParse({ requestKey: randomUUID() }).success).toBe(false);
    expect(evaluationRequestSchema.safeParse({ requestKey: randomUUID(), acknowledgePaidCalls: true, url: "http://elsewhere" }).success).toBe(false);
  });
  it("times out an unresolved chat explicitly and clears its deadline timer", async () => {
    vi.useFakeTimers();
    try {
      const timed = awaitEvaluationChat(new Promise(() => {}), 90000);
      const rejected = expect(timed).rejects.toMatchObject({ status: 504, code: "EVALUATION_CHAT_TIMEOUT" });
      await vi.advanceTimersByTimeAsync(90000); await rejected;
      expect(vi.getTimerCount()).toBe(0);
      expect(await awaitEvaluationChat(Promise.resolve("complete"), 90000)).toBe("complete");
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("creates an immutable versioned selection and deduplicates the same launch", async () => {
    const requestKey = randomUUID();
    const run = await launch({ requestKey });
    expect(await launch({ requestKey })).toEqual({ id: run.id, reused: true });
    await expect(launch({ requestKey, repetitions: 2 })).rejects.toMatchObject({ status: 409 });
    const detail = await getEvaluation(user, run.id);
    expect(detail.cases).toHaveLength(1);
    expect(detail.run.configuration.businessWrites).toBe(false);
    expect(detail.run.configuration.runtime.model).toBe("evaluation-test");
    expect((await sql("SELECT * FROM customer_chat_evaluation_events WHERE run_id=?", [run.id]))).toHaveLength(1);
  });
  it("keeps one creation event across repetitions", async () => {
    const { id } = await launch({ repetitions: 3 });
    expect(await caseRows(id)).toHaveLength(3);
    expect(await sql("SELECT * FROM customer_chat_evaluation_events WHERE run_id=? AND event_type='created'", [id])).toHaveLength(1);
  });
  it("keeps case effects consistent across catalog snapshots, history and exports, including older runs", async () => {
    const { id } = await launch({ caseIds: ["A08-04", "A08-06", "A05-01"] });
    const rows = await caseRows(id);
    for (const row of rows) {
      const definition = typeof row.definition_json === "string" ? JSON.parse(row.definition_json) : row.definition_json;
      delete definition.businessImpact;
      await sql("UPDATE customer_chat_evaluation_cases SET definition_json=? WHERE id=?", [JSON.stringify(definition), row.id]);
    }
    const history = await getEvaluation(user, id);
    const expected = { "A08-04": "validation", "A08-06": "none", "A05-01": "module" };
    for (const row of history.cases) {
      expect(row.businessImpact.kind).toBe(expected[row.case_id]);
      expect(row).not.toHaveProperty("definition_json");
      expect((await getEvaluationCase(user, id, row.id)).definition.businessImpact.kind).toBe(expected[row.case_id]);
    }
    for (const item of (await exportEvaluation(user, id)).cases) expect(item.definition.businessImpact.kind).toBe(expected[item.caseId]);
  });
  it("interrupts after a chat timeout without replaying it or losing its reconciliation IDs", async () => {
    const { id } = await launch({ caseIds: ["Q01-01", "Q02-01"] });
    state.chat.mockImplementationOnce(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      setImmediate(() => { void vi.advanceTimersByTimeAsync(90000).finally(() => vi.useRealTimers()); });
      return new Promise(() => {});
    });
    try { await processPendingEvaluations(); } finally { vi.useRealTimers(); }
    const detail = await getEvaluation(user, id);
    expect(detail.run.status).toBe("interrupted");
    expect(detail.counts).toEqual({ environment_error: 1, omitted: 1 });
    const timedCase = await getEvaluationCase(user, id, detail.cases[0].id);
    expect(timedCase).toMatchObject({ jobId: 100, sessionId: 200 });
    expect((await exportEvaluation(user, id)).cases[0]).toMatchObject({ jobId: 100, sessionId: 200 });
    await processPendingEvaluations();
    expect(state.chat).toHaveBeenCalledTimes(1);
  });
  it("serializes simultaneous launch requests", async () => {
    const results = await Promise.allSettled([launch(), launch()]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(await sql("SELECT id FROM customer_chat_evaluation_runs")).toHaveLength(1);
  });
  it("runs the real chat service interface but never confirms business operations", async () => {
    const { id } = await launch();
    await processPendingEvaluations();
    const detail = await getEvaluation(user, id);
    expect(detail.run.status).toBe("completed");
    expect(detail.counts).toEqual({ human_review: 1 });
    const item = await getEvaluationCase(user, id, detail.cases[0].id);
    expect(item.result.steps[0].answer).toBe("Respuesta de prueba");
    expect(item.result.steps[0].jobId).toBe(100);
    expect(state.chat).toHaveBeenCalledExactlyOnceWith({ user, jobId: 100, deadlineAt: expect.any(Number) });
    expect(state.chat.mock.calls[0][0].deadlineAt).toBeLessThanOrEqual(Date.now() + 90000);
    expect(state.chat.mock.calls[0][0].deadlineAt).toBeGreaterThan(Date.now());
    expect(await sql("SELECT * FROM customer_chat_evaluation_actions")).toHaveLength(0);
  });
  it("preserves multitur n continuity and initial referenced messages", async () => {
    const { id } = await launch({ caseIds: ["SEQ06"] }); await processPendingEvaluations();
    const item = await getEvaluationCase(user, id, (await caseRows(id))[0].id);
    expect(item.result.steps).toHaveLength(4);
    expect(new Set(item.result.steps.map((step) => step.sessionId))).toEqual(new Set([200]));
  });
  it("persists structured history in case detail and exports without creating business actions", async () => {
    const activityHistory = { mode: "timeline", metadata: { shown: 1, matched: 1, partial: false },
      sections: [{ key: "timeline", title: "Cronología registrada", available: true, items: [
        { id: "interactions:1", title: "Registro sintético", dateMeaning: "Creación de interacción",
          accountLink: "Mediante oportunidad" },
      ] }] };
    state.result.mockResolvedValue({ status: "completed", result: { answer: "Un registro mostrado.", operations: [], activityHistory } });
    const { id } = await launch({ caseIds: ["Q06-02"] });
    await processPendingEvaluations();
    const item = await getEvaluationCase(user, id, (await caseRows(id))[0].id);
    expect(item.result.steps[0].activityHistory).toEqual(activityHistory);
    const exported = await exportEvaluation(user, id);
    expect(exported.cases[0].result.steps[0].activityHistory).toEqual(activityHistory);
    expect(await sql("SELECT * FROM customer_chat_evaluation_actions")).toHaveLength(0);
  });
  it("omits fault-injection controls explicitly without calling the chat", async () => {
    const { id } = await launch({ caseIds: ["K10"] }); await processPendingEvaluations();
    expect((await getEvaluation(user, id)).counts).toEqual({ omitted: 1 });
    expect(state.chat).not.toHaveBeenCalled();
  });
  it("cancels before the next case without starting a model call", async () => {
    const { id } = await launch(); await cancelEvaluation(user, id); await processPendingEvaluations();
    const detail = await getEvaluation(user, id);
    expect(detail.run.status).toBe("cancelled"); expect(detail.counts).toEqual({ omitted: 1 });
    expect(state.chat).not.toHaveBeenCalled();
  });
  it("respects message limits without success-shaped omitted cases", async () => {
    const { id } = await launch({ caseIds: ["Q01-01", "Q01-02"], maxTurns: 1 }); await processPendingEvaluations();
    expect((await getEvaluation(user, id)).run.status).toBe("interrupted");
    expect((await getEvaluation(user, id)).counts).toEqual({ human_review: 1, omitted: 1 });
    expect(state.chat).toHaveBeenCalledTimes(1);
  });
  it("a turn limit inside the final conversation interrupts rather than completing it", async () => {
    const { id } = await launch({ caseIds: ["SEQ06"], maxTurns: 1 }); await processPendingEvaluations();
    expect((await getEvaluation(user, id)).run.status).toBe("interrupted");
    expect((await getEvaluation(user, id)).counts).toEqual({ inconclusive: 1 });
    expect(state.chat).toHaveBeenCalledTimes(1);
  });
  it("cancels between conversation messages without erasing the completed first turn", async () => {
    const { id } = await launch({ caseIds: ["SEQ06"] });
    state.chat.mockImplementation(async () => {
      await sql("UPDATE customer_chat_evaluation_runs SET cancel_requested=1 WHERE id=?", [id]);
    });
    await processPendingEvaluations();
    expect((await getEvaluation(user, id)).run.status).toBe("cancelled");
    const item = await getEvaluationCase(user, id, (await caseRows(id))[0].id);
    expect(item.result.steps).toHaveLength(1);
    expect(state.chat).toHaveBeenCalledTimes(1);
  });
  it("detects changed configuration without sending a question under another policy", async () => {
    const { id } = await launch();
    state.rules.mockResolvedValue({ operationPolicy: { allowedKinds: ["changed"] } });
    await processPendingEvaluations();
    expect((await getEvaluation(user, id)).counts).toEqual({ inconclusive: 1 });
    expect(state.chat).not.toHaveBeenCalled();
  });
  it("does not spend chat calls on a disabled stage validator or enable it to pass the test", async () => {
    const { id } = await launch({ caseIds: ["A08-04"] });
    await processPendingEvaluations();
    expect((await getEvaluation(user, id)).counts).toEqual({ inconclusive: 1 });
    const item = await getEvaluationCase(user, id, (await caseRows(id))[0].id);
    expect(item.result.reason).toContain("validate_stage está deshabilitado");
    expect(state.chat).not.toHaveBeenCalled();
  });
  it("records capability restrictions as inconclusive and gives actual failed-check reasons", async () => {
    const { id } = await launch({ caseIds: ["Q01-01", "C01-01"] });
    state.result.mockResolvedValueOnce({ status: "completed", result: { answer: "Deshabilitado", operations: [],
      components: [{ status: "disabled" }] } }).mockResolvedValueOnce({ status: "completed",
      result: { answer: "Estimada Kimberly, confirmemos el siguiente paso.", operations: [] } });
    await processPendingEvaluations();
    expect((await getEvaluation(user, id)).counts).toEqual({ inconclusive: 1, failed: 1 });
    const rows = await caseRows(id);
    const failed = await getEvaluationCase(user, id, rows.find((item) => item.case_id === "C01-01").id);
    expect(failed.result.reason).toContain("Asunto del correo presente");
  });
  it("identifies an invalid B3 contract as a chat failure and preserves its diagnostic instead of blaming the environment", async () => {
    const { id } = await launch({ caseIds: ["A09-01"] });
    state.result.mockResolvedValue({ status: "failed", errorMessage: "B3 devolvió un contrato de turno inválido.",
      result: { errorCode: "CUSTOMER_TURN_CONTRACT_INVALID", debug: { currentTurn: { diagnostics: {
        contractFailure: { validationIssues: [{ path: ["components"], message: "Falta el componente de la solicitud" }] },
      } } } } });
    await processPendingEvaluations();
    expect((await getEvaluation(user, id)).counts).toEqual({ failed: 1 });
    const item = await getEvaluationCase(user, id, (await caseRows(id))[0].id);
    expect(item.result.errorCode).toBe("CUSTOMER_TURN_CONTRACT_INVALID");
    expect(item.result.jobFailure.contractFailure.validationIssues[0].path).toEqual(["components"]);
    expect(item.jobId).toBe(100);
    expect(state.chat).toHaveBeenCalledTimes(1);
  });
  it("reports provider failures without automatic retries", async () => {
    state.chat.mockRejectedValue(new Error("Proveedor no disponible"));
    const { id } = await launch(); await processPendingEvaluations();
    expect((await getEvaluation(user, id)).counts).toEqual({ environment_error: 1 });
    expect(state.chat).toHaveBeenCalledTimes(1);
  });
  it("does not treat failed reference reads as empty CRM data", async () => {
    state.metrics.mockReturnValue([{ errorCode: "query_error" }]);
    const { id } = await launch(); await processPendingEvaluations();
    expect((await getEvaluation(user, id)).counts).toEqual({ environment_error: 1 });
    expect(state.chat).not.toHaveBeenCalled();
  });
  it("marks changes during a case as inconclusive", async () => {
    state.snapshot.mockResolvedValueOnce({ account: { id: 22, name: "Totalplay" }, opportunities: [] })
      .mockResolvedValue({ account: { id: 22, name: "Totalplay" }, opportunities: [{ id: 36, name: "Changed" }] });
    const { id } = await launch(); await processPendingEvaluations();
    expect((await getEvaluation(user, id)).counts).toEqual({ inconclusive: 1 });
  });
  it("revalidates the actor and prevents privilege elevation", async () => {
    const { id } = await launch();
    state.actor.mockResolvedValue({ ...user, permissionSet: new Set() });
    await processPendingEvaluations();
    expect((await getEvaluation(user, id)).counts).toEqual({ environment_error: 1 });
    expect(state.chat).not.toHaveBeenCalled();
  });
  it("recovers a crashed worker without replaying uncertain messages", async () => {
    const { id } = await launch({ caseIds: ["Q01-01", "Q01-02"] });
    await sql("UPDATE customer_chat_evaluation_runs SET status='running',worker_id=? WHERE id=?", [randomUUID(), id]);
    await sql("UPDATE customer_chat_evaluation_cases SET status='running',result_json=? WHERE run_id=? AND ordinal=1",
      [JSON.stringify({ steps: [{ question: "Turno persistido", answer: "Respuesta persistida" }] }), id]);
    await processPendingEvaluations();
    const detail = await getEvaluation(user, id);
    expect(detail.run.status).toBe("interrupted"); expect(detail.counts).toEqual({ inconclusive: 1, omitted: 1 });
    const recovered = await getEvaluationCase(user, id, detail.cases[0].id);
    expect(recovered.result.steps[0].answer).toBe("Respuesta persistida");
    expect(state.chat).not.toHaveBeenCalled();
  });
  it("keeps human approval and its event separate from automated checks", async () => {
    const { id } = await launch(); await processPendingEvaluations();
    const row = (await caseRows(id))[0];
    await reviewEvaluationCase(user, id, row.id, { decision: "approved", note: "Revisado contra las fuentes vigentes" });
    const exported = await exportEvaluation(user, id);
    expect(exported.summary.approved).toBe(1);
    expect(exported.cases[0].status).toBe("human_review");
    expect(exported.events.at(-1).event_type).toBe("case_reviewed");
  });
  it("cannot override a deterministic failure by approving it manually", async () => {
    state.result.mockResolvedValue({ status: "completed", result: { answer: "", operations: [] } });
    const { id } = await launch(); await processPendingEvaluations();
    await expect(reviewEvaluationCase(user, id, (await caseRows(id))[0].id,
      { decision: "approved", note: "Intento de aprobación indebida" })).rejects.toMatchObject({ status: 409 });
  });
  it("enforces ownership on detail, export and reviews", async () => {
    const { id } = await launch();
    const other = { ...user, id: 8 };
    await expect(getEvaluation(other, id)).rejects.toMatchObject({ status: 404 });
    await expect(exportEvaluation(other, id)).rejects.toMatchObject({ status: 404 });
    expect((await listEvaluations(other)).runs).toEqual([]);
  });
  it("does not reveal historic evidence after a read permission is revoked", async () => {
    const { id } = await launch(); await processPendingEvaluations();
    const restricted = { ...user, permissionSet: new Set([...user.permissionSet].filter((permission) => permission !== "inteligencia_comercial.read")) };
    await expect(getEvaluationCase(restricted, id, (await caseRows(id))[0].id)).rejects.toMatchObject({ status: 403 });
    await expect(exportEvaluation(restricted, id)).rejects.toMatchObject({ status: 403 });
  });
  it("checks the current instance without paid model calls", async () => {
    const result = await preflightEvaluation(user);
    expect(result.instance).toBe("Instancia actual");
    expect(result.model).toBe("evaluation-test");
    expect(state.chat).not.toHaveBeenCalled();
  });
  it("exports all cases beyond a page without truncating the catalog", async () => {
    const { id } = await launch({ suite: "full", repetitions: 2, caseIds: [] });
    const detail = await getEvaluation(user, id);
    const exported = await exportEvaluation(user, id);
    expect(detail.cases).toHaveLength(50); expect(detail.hasMore).toBe(true);
    expect(exported.cases.length).toBeGreaterThan(350);
    expect(exported.summary.total).toBe(exported.cases.length);
  });
  async function prepareAction(kind = "opportunity_field") {
    const operation = { kind, accountId: 22, opportunityId: 36, title: "Acción de prueba", missingFields: [] };
    state.result.mockResolvedValue({ status: "completed", result: { answer: "Propuesta de prueba", operations: [operation] } });
    const { id } = await launch(); await processPendingEvaluations();
    const row = (await caseRows(id))[0];
    await reviewEvaluationCase(user, id, row.id, { decision: "approved", note: "Validado para ejecutar exclusivamente este registro" });
    const req = { user: { ...user, permissionSet: new Set([...user.permissionSet, "mi_coach.evaluations_write"]) },
      headers: { authorization: "Bearer test-token" } };
    return { req, runId: id, caseId: row.id, input: { operationIndex: 0, accountId: 22, acknowledgeBusinessWrite: true } };
  }
  const callAction = ({ req, runId, caseId, input }) => confirmEvaluationAction(req, runId, caseId, input);
  function mockModuleFetch({ failExecute = false, stage = false, creation = false } = {}) {
    const fetchMock = vi.fn(async (url, options) => {
      let data;
      if (url.endsWith("/coach/operations")) data = { operation: { id: 99, version: 1 } };
      else if (url.endsWith("/review")) data = { operation: { id: 99, version: 2 } };
      else if (url.endsWith("/execute")) return { ok: !failExecute, status: failExecute ? 409 : 200,
        json: async () => failExecute ? { message: "Cambió el registro" } : { operation: { status: "completed" }, result: { auditId: 12 } } };
      else if (url.endsWith("/handoff")) data = { operation: { id: 99, version: 2 },
        handoff: { token: "44a6bf85-cd5a-431e-9697-fd0b2da5e9f6", url: "/opportunities?coachDraft=test" } };
      else if (url.endsWith("/coach-stage-validation")) data = { job: { id: "original-job", status: "pending" } };
      else if (stage && url.includes("/coach-stage-validation/")) data = { operation: { status: "completed", result: { outcome: "advanced" } } };
      else if (url.endsWith("/coach-contact") || url.endsWith("/coach-reschedule")) data = { operation: { status: "completed" } };
      else if (options.method === "GET") data = { operation: { id: 99, status: creation ? "handed_off" : "completed" } };
      else throw new Error(`Unexpected request ${url}`);
      return { ok: true, status: 200, json: async () => data };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  it("requires an additional write permission and exact account authorization", async () => {
    const prepared = await prepareAction();
    await expect(callAction({ ...prepared, req: { ...prepared.req, user } })).rejects.toMatchObject({ status: 403 });
    await expect(callAction({ ...prepared, input: { ...prepared.input, accountId: 25 } })).rejects.toMatchObject({ status: 403 });
    expect(await sql("SELECT * FROM customer_chat_evaluation_actions")).toHaveLength(0);
  });
  it("uses the existing review and executor with idempotency, never SQL business updates", async () => {
    const prepared = await prepareAction();
    const fetchMock = mockModuleFetch();
    const result = await callAction(prepared);
    expect(result.operation.status).toBe("completed");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:4000/api/mi-agent/coach/operations",
      "http://127.0.0.1:4000/api/mi-agent/coach/operations/99/review",
      "http://127.0.0.1:4000/api/mi-agent/coach/operations/99/execute",
    ]);
    await callAction(prepared);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const events = await sql("SELECT event_type FROM customer_chat_evaluation_events WHERE run_id=?", [prepared.runId]);
    expect(events.at(-1).event_type).toBe("business_write_authorized");
  });
  it.each(["link_contact_to_opportunity", "reschedule_activity"])("delegates %s only to its existing domain endpoint", async (kind) => {
    const prepared = await prepareAction(kind); const fetchMock = mockModuleFetch();
    expect((await callAction(prepared)).operation.status).toBe("completed");
    expect(fetchMock.mock.calls.at(-1)[0]).toContain(kind === "reschedule_activity" ? "/coach-reschedule" : "/coach-contact");
  });
  it("A08 initiates and tracks the original validator without direct stage transition", async () => {
    const prepared = await prepareAction("validate_stage"); const fetchMock = mockModuleFetch({ stage: true });
    const result = await callAction(prepared);
    expect(result.outcome).toBe("validation_pending"); expect(result.job.id).toBe("original-job");
    expect((await sql("SELECT status FROM customer_chat_evaluation_actions"))[0].status).toBe("submitted");
    expect(fetchMock.mock.calls.every(([url]) => !url.includes("stage-transition"))).toBe(true);
    expect((await readEvaluationActions(prepared.req, prepared.runId, prepared.caseId)).actions[0].result.operation.result.outcome).toBe("advanced");
  });
  it.each(["create_contact", "create_opportunity", "activity"])("does not credit a %s handoff as a saved record", async (kind) => {
    const prepared = await prepareAction(kind); const fetchMock = mockModuleFetch({ creation: true });
    expect((await callAction(prepared)).outcome).toBe("module_review_required");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await sql("SELECT status FROM customer_chat_evaluation_actions"))[0].status).toBe("module_review_required");
    const reconciled = (await readEvaluationActions(prepared.req, prepared.runId, prepared.caseId)).actions[0];
    expect(reconciled.result.outcome).toBe("module_review_required");
    expect(reconciled.result.handoff.url).toBe("/opportunities?coachDraft=test");
    expect(reconciled.result.operation.status).toBe("handed_off");
  });
  it("does not retry an uncertain write and preserves the conflict for reconciliation", async () => {
    const prepared = await prepareAction(); const fetchMock = mockModuleFetch({ failExecute: true });
    await expect(callAction(prepared)).rejects.toMatchObject({ status: 409 });
    expect((await sql("SELECT status FROM customer_chat_evaluation_actions"))[0].status).toBe("uncertain");
    await expect(callAction(prepared)).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((await readEvaluationActions(prepared.req, prepared.runId, prepared.caseId)).actions).toHaveLength(1);
  });
  it("grants initial admin read/execute once, never writes, and preserves later revocations", async () => {
    await sql("CREATE TABLE mi_coach_permission_migrations(migration_key VARCHAR(100) PRIMARY KEY,applied_at DATETIME(3))");
    await sql("CREATE TABLE roles(id INT PRIMARY KEY,name VARCHAR(80),is_system INT)");
    await sql("CREATE TABLE permissions(id INT PRIMARY KEY,code VARCHAR(80))");
    await sql("CREATE TABLE role_permissions(role_id INT,permission_id INT,created_at DATETIME(3),PRIMARY KEY(role_id,permission_id))");
    await sql("INSERT INTO roles VALUES(1,'Administrador',1),(2,'Vendedor',0)");
    await sql("INSERT INTO permissions VALUES(1,'mi_coach.evaluations_read'),(2,'mi_coach.evaluations_execute'),(3,'mi_coach.evaluations_write')");
    await ensureEvaluationAdministratorAccess();
    expect(await sql("SELECT role_id,permission_id FROM role_permissions ORDER BY permission_id")).toEqual([
      { role_id: 1, permission_id: 1 }, { role_id: 1, permission_id: 2 },
    ]);
    await sql("DELETE FROM role_permissions WHERE permission_id=2");
    await ensureEvaluationAdministratorAccess();
    expect(await sql("SELECT role_id,permission_id FROM role_permissions")).toEqual([{ role_id: 1, permission_id: 1 }]);
  });
});
