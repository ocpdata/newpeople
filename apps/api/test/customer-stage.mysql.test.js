import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mysql from "mysql2/promise";
const local = vi.hoisted(() => ({ pool: null, enabled: true, create: vi.fn(), getJob: vi.fn(), queue: vi.fn() }));
vi.mock("../src/db.js", () => ({
  query: async (...args) => (await local.pool.query(...args))[0],
  withTransaction: async (work) => {
    const conn = await local.pool.getConnection();
    try { await conn.beginTransaction(); const result = await work(conn); await conn.commit(); return result; }
    catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  },
}));
vi.mock("../src/coach/business-rules.js", () => ({
  loadCoachBusinessRules: async () => ({ operationPolicy: { allowedKinds: local.enabled ? ["validate_stage"] : [] }, scope: {} }),
}));
vi.mock("../src/coach/channel-intent-governance.js", () => ({ loadChannelIntentConfigurations: async () => [] }));
vi.mock("../src/opportunity-stage-validations/schema.js", () => ({ ensureOpportunityStageValidationJobSchema: vi.fn() }));
vi.mock("../src/opportunity-stage-validations/service.js", () => ({
  createOrReuseOpportunityStageValidationJob: local.create, getOpportunityStageValidationJob: local.getJob,
}));
vi.mock("../src/opportunity-stage-validations/async.js", () => ({ queueOpportunityStageValidationProcessing: local.queue }));
import { ensureCoachSchema } from "../src/coach/schema.js";
import { createCoachSession, persistCoachOperations, createCoachHandoff, completeCoachHandoff,
  updateCoachOperation, transitionCoachOperation, getCoachHandoff } from "../src/coach/service.js";
import { checkCustomerStageAccess, readCustomerStages } from "../src/coach/customer-stage-access.js";
import { startCustomerStageValidation, readCustomerStageValidation } from "../src/coach/customer-stage-validation.js";
import { buildCustomerStageResponse } from "../src/commercial-intelligence/customer-stage.js";

describe.skipIf(!process.env.G06_MYSQL_TEST_SOCKET)("A08 isolated MySQL handoff/job tracking", () => {
  let admin, session;
  const database = `newpeople_a08_test_${process.pid}`;
  const user = { id: 7, permissionSet: new Set(["mi_coach.access", "inteligencia_comercial.access", "mi_coach.execute",
    "cuentas.read", "oportunidades.read", "oportunidades.update"]) };
  const snapshot = { account: { id: 1 } };
  const sql = async (...args) => (await local.pool.query(...args))[0];
  const saveMemory = (memory) => sql("UPDATE customer_intelligence_chat_sessions SET context_json=? WHERE id=1", [JSON.stringify({ stageMemory: memory })]);
  const prepare = async (patch = {}, previous) => {
    const spec = { mode: previous ? "continue" : "start", opportunityReference: "Alfa", targetReference: "",
      request: "advance", position: 0, evidence: "Avanza Alfa", ...patch };
    const result = await buildCustomerStageResponse({ component: { scope: "single", stageSpec: spec }, movement: "new_request",
      question: spec.evidence, snapshot, previous, readStages: (accountId) => readCustomerStages({ user, accountId }) });
    await saveMemory(result.stageMemory); return result;
  };
  const persist = async (operation) => (await persistCoachOperations({ userId: 7, sessionId: session.id,
    sourceJobId: null, originalIntent: "A08 test", operations: [operation] }))[0];
  const transfer = async () => (await createCoachHandoff(7, (await persist((await prepare()).operations[0])).id)).operation;
  const start = (saved, actor = user) => startCustomerStageValidation({ user: actor, token: saved.handoffToken, opportunityId: 3, version: saved.version });
  const read = (saved, actor = user) => readCustomerStageValidation({ user: actor, token: saved.handoffToken, opportunityId: 3 });
  beforeAll(async () => {
    const options = { user: "root", socketPath: process.env.G06_MYSQL_TEST_SOCKET, timezone: "Z" };
    admin = await mysql.createConnection(options); await admin.query(`CREATE DATABASE ${database}`);
    local.pool = mysql.createPool({ ...options, database, connectionLimit: 5 });
    await sql("CREATE TABLE users(id BIGINT UNSIGNED PRIMARY KEY)"); await sql("INSERT INTO users VALUES(7)");
    await sql("CREATE TABLE audit_log(id BIGINT UNSIGNED PRIMARY KEY,entity_id BIGINT,performed_by_user_id BIGINT)");
    await sql("CREATE TABLE accounts(id BIGINT PRIMARY KEY,name VARCHAR(180),activation_status_id BIGINT)");
    await sql("CREATE TABLE account_activation_statuses(id BIGINT PRIMARY KEY,code VARCHAR(30))");
    await sql("INSERT INTO account_activation_statuses VALUES(1,'activada'),(2,'desactivada')");
    await sql("INSERT INTO accounts VALUES(1,'Cuenta ficticia',1)");
    await sql("CREATE TABLE account_owners(account_id BIGINT,user_id BIGINT)"); await sql("INSERT INTO account_owners VALUES(1,7)");
    await sql("CREATE TABLE opportunities(id BIGINT PRIMARY KEY,name VARCHAR(180),account_id BIGINT,sales_stage_id BIGINT,commercial_status_id BIGINT)");
    await sql("CREATE TABLE opportunity_sales_stages(id BIGINT PRIMARY KEY,code VARCHAR(60),name VARCHAR(180),stage_order INT,is_active INT)");
    await sql("INSERT INTO opportunity_sales_stages VALUES(1,'initial','Inicial',1,1),(2,'negotiation','Negociación',2,1),(3,'waiting','Waiting',3,1)");
    await sql("CREATE TABLE opportunity_commercial_statuses(id BIGINT PRIMARY KEY,code VARCHAR(30))");
    await sql("INSERT INTO opportunity_commercial_statuses VALUES(1,'abierta'),(2,'ganada')");
    await sql("INSERT INTO opportunities VALUES(3,'Alfa',1,1,1)");
    await sql("CREATE TABLE customer_intelligence_chat_sessions(id BIGINT PRIMARY KEY,requested_by_user_id BIGINT,account_id BIGINT,context_json JSON)");
    await sql("INSERT INTO customer_intelligence_chat_sessions VALUES(1,7,1,JSON_OBJECT())");
    await ensureCoachSchema(); session = await createCoachSession(7, { accountId: 1 });
  });
  beforeEach(async () => {
    local.enabled = true; vi.clearAllMocks();
    local.create.mockResolvedValue({ wasReused: false, response: { job: { id: "job-existing", status: "pending", pollAfterMs: 10 } } });
    local.getJob.mockResolvedValue({ job: { id: "job-existing", status: "running" } });
    await sql("UPDATE opportunities SET name='Alfa',account_id=1,sales_stage_id=1,commercial_status_id=1");
    await sql("UPDATE accounts SET name='Cuenta ficticia',activation_status_id=1");
    await sql("UPDATE opportunity_sales_stages SET is_active=1,name=CASE id WHEN 1 THEN 'Inicial' WHEN 2 THEN 'Negociación' ELSE 'Waiting' END");
  });
  afterAll(async () => {
    if (local.pool) { await local.pool.end(); local.pool = null; }
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS ${database}`); await admin.end(); }
  });
  it("prepares/persists/transfers/loads without a validation job or stage mutation", async () => {
    const saved = await transfer();
    expect((await getCoachHandoff(7, saved.handoffToken, "opportunities")).outcome).toBe("ready");
    expect((await read(saved)).validation).toBeNull();
    expect(local.create).not.toHaveBeenCalled(); expect(local.queue).not.toHaveBeenCalled();
    expect((await sql("SELECT sales_stage_id FROM opportunities WHERE id=3"))[0].sales_stage_id).toBe(1);
    expect((await completeCoachHandoff(7, saved.handoffToken, "opportunities", {})).outcome).toBe("save_required");
  });
  it("starts exactly the existing validator with unchanged arguments after explicit action", async () => {
    const saved = await transfer();
    await start(saved);
    expect(local.create).toHaveBeenCalledExactlyOnceWith({ opportunityId: 3, requestedByUserId: 7, note: "" });
    expect(local.queue).toHaveBeenCalledTimes(1);
    const state = await read(saved);
    expect(state.operation.result.validationJobId).toBe("job-existing");
    await start(saved);
    expect(local.create).toHaveBeenCalledTimes(1);
    expect((await sql("SELECT sales_stage_id FROM opportunities WHERE id=3"))[0].sales_stage_id).toBe(1);
  });
  it("serializes duplicate starts into one call to the validator", async () => {
    const saved = await transfer();
    await Promise.all([start(saved), start(saved)]);
    expect(local.create).toHaveBeenCalledTimes(1);
  });
  it("reuses an existing job without queueing a second execution", async () => {
    local.create.mockResolvedValue({ wasReused: true, response: { job: { id: "reused", status: "running" } } });
    await start(await transfer());
    expect(local.queue).not.toHaveBeenCalled();
  });
  it("recovers a pending job if linking fails, without abandoning it or accepting an unpersisted link", async () => {
    const saved = await transfer();
    await sql("CREATE TRIGGER a08_link_failure BEFORE INSERT ON coach_operation_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='A08 link failed'");
    try { await expect(start(saved)).rejects.toThrow("A08 link failed"); }
    finally { await sql("DROP TRIGGER a08_link_failure"); }
    expect(local.queue).not.toHaveBeenCalled();
    expect((await read(saved)).validation).toBeNull();
    local.create.mockResolvedValue({ wasReused: true, response: { job: { id: "job-existing", status: "pending" } } });
    await start(saved);
    expect(local.queue).toHaveBeenCalledTimes(1);
    expect((await read(saved)).operation.result.validationJobId).toBe("job-existing");
    expect(await sql("SELECT id FROM coach_operation_events WHERE operation_id=? AND event_type='execution_started'", [saved.id])).toHaveLength(1);
  });
  it.each(["not_ready_to_advance", "advance_with_caution", "ready_to_advance"])("tracks decision %s without inventing an advance", async (decision) => {
    const saved = await transfer(); await start(saved);
    local.getJob.mockResolvedValue({ job: { id: "job-existing", status: "completed" }, result: {
      validation: { decision, reasons: ["Regla existente"] }, autoAdvanced: false, advancedSalesStage: null, message: "Evaluación original",
    } });
    const state = await read(saved);
    expect(state.operation.status).toBe("completed");
    expect(state.operation.result.outcome).toBe("validated_without_advance");
    expect(state.validation.result.validation.decision).toBe(decision);
    expect((await sql("SELECT sales_stage_id FROM opportunities WHERE id=3"))[0].sales_stage_id).toBe(1);
    expect((await getCoachHandoff(7, saved.handoffToken, "opportunities")).outcome).toBe("ready");
    expect((await read(saved)).operation.result).toEqual(state.operation.result);
  });
  it("credits an advance only when the existing job reports it and the persisted stage matches", async () => {
    const saved = await transfer(); await start(saved);
    await sql("UPDATE opportunities SET sales_stage_id=2 WHERE id=3");
    local.getJob.mockResolvedValue({ job: { id: "job-existing", status: "completed" }, result: {
      validation: { decision: "ready_to_advance" }, autoAdvanced: true, advancedSalesStage: { id: 2, name: "Negociación" },
    } });
    const state = await read(saved);
    expect(state.operation.result.outcome).toBe("advanced");
    expect((await read(saved)).operation.version).toBe(state.operation.version);
    expect(await sql("SELECT id FROM coach_operation_events WHERE operation_id=? AND event_type='completed'", [saved.id])).toHaveLength(1);
  });
  it("does not confuse a subsequent stage change with the current validation result", async () => {
    const saved = await transfer(); await start(saved);
    await sql("UPDATE opportunities SET sales_stage_id=3 WHERE id=3");
    local.getJob.mockResolvedValue({ result: { validation: { decision: "ready_to_advance" },
      autoAdvanced: true, advancedSalesStage: { id: 2 } } });
    expect((await read(saved)).operation.result.outcome).toBe("stage_changed_after_validation");
  });
  it.each(["failed", "stale", "expired"])("preserves %s errors without retrying the validator", async (status) => {
    const saved = await transfer(); await start(saved);
    local.getJob.mockResolvedValue({ job: { id: "job-existing", status }, error: { code: status, message: "Error original" } });
    const state = await read(saved);
    expect(state.validation.error.message).toBe("Error original");
    await start(saved);
    expect(local.create).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed success without crediting completion", async () => {
    const saved = await transfer(); await start(saved);
    local.getJob.mockResolvedValue({ result: { message: "ok" } });
    await expect(read(saved)).rejects.toMatchObject({ status: 409 });
  });
  it.each(["stage", "name", "account", "closed", "policy", "memory", "catalog"])("rejects stale %s before starting a job", async (change) => {
    const saved = await transfer();
    if (change === "stage") await sql("UPDATE opportunities SET sales_stage_id=2 WHERE id=3");
    if (change === "name") await sql("UPDATE opportunities SET name='Cambio' WHERE id=3");
    if (change === "account") await sql("UPDATE opportunities SET account_id=99 WHERE id=3");
    if (change === "closed") await sql("UPDATE opportunities SET commercial_status_id=2 WHERE id=3");
    if (change === "policy") local.enabled = false;
    if (change === "memory") await saveMemory(null);
    if (change === "catalog") await sql("UPDATE opportunity_sales_stages SET name='Cambio' WHERE id=2");
    await expect(start(saved)).rejects.toHaveProperty("status");
    expect(local.create).not.toHaveBeenCalled();
  });
  it("rejects revoked execution permission on both start and tracking", async () => {
    const saved = await transfer();
    const actor = { ...user, permissionSet: new Set(["oportunidades.update"]) };
    await expect(start(saved, actor)).rejects.toMatchObject({ status: 403 });
    await expect(read(saved, actor)).rejects.toMatchObject({ status: 403 });
  });
  it("requires the current token version and expiry", async () => {
    const saved = await transfer();
    await expect(start({ ...saved, version: saved.version - 1 })).rejects.toMatchObject({ status: 409 });
    await sql("UPDATE coach_session_operations SET handoff_expires_at=DATE_SUB(NOW(),INTERVAL 1 DAY) WHERE id=?", [saved.id]);
    await expect(start(saved)).rejects.toMatchObject({ status: 409 });
  });
  it("keeps job tracking after chat discard and never cancels an existing validation job", async () => {
    const saved = await transfer(); await start(saved);
    await saveMemory(null);
    expect((await read(saved)).validation.job.id).toBe("job-existing");
    expect((await transitionCoachOperation(7, saved.id, { status: "cancelled" })).outcome).toBe("invalid_transition");
  });
  it("deduplicates revisions and prevents historical correction after a job starts", async () => {
    const first = await prepare();
    const persisted = await persist(first.operations[0]);
    const corrected = await prepare({ mode: "refresh" }, first.stageMemory);
    const next = await persist(corrected.operations[0]);
    expect(next.id).toBe(persisted.id);
    expect(next.pendingOperation.stageRevision).toBe(2);
    expect((await persist(first.operations[0])).pendingOperation.stageRevision).toBe(2);
    expect((await updateCoachOperation(7, next.id, { version: next.version,
      pendingOperation: { ...next.pendingOperation, stageSummary: { ...next.pendingOperation.stageSummary, targetStageId: 3 } } })).outcome).toBe("invalid");
    const saved = (await createCoachHandoff(7, next.id)).operation; await start(saved);
    expect(await checkCustomerStageAccess(user, next.pendingOperation, { compareCurrent: false })).toBeNull();
    const refreshed = await prepare({ mode: "refresh" }, corrected.stageMemory);
    const existing = await persist(refreshed.operations[0]);
    expect(existing.result.validationJobId).toBe("job-existing");
    expect(existing.pendingOperation.stageRevision).toBe(2);
  });
  it("propagates the existing validator prerequisite errors unchanged", async () => {
    const error = Object.assign(new Error("Faltan respuestas"), { status: 400, body: { message: "Faltan respuestas", validation: { decision: "not_ready_to_advance" } } });
    local.create.mockRejectedValue(error);
    const saved = await transfer();
    await expect(start(saved)).rejects.toBe(error);
    expect(local.queue).not.toHaveBeenCalled();
    expect((await read(saved)).validation).toBeNull();
  });
});
