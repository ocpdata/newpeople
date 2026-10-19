import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mysql from "mysql2/promise";
const local = vi.hoisted(() => ({ pool: null, enabled: true, timeZone: "America/Mexico_City" }));
vi.mock("../src/db.js", () => ({
  query: async (sql, args) => (await local.pool.query(sql, args))[0],
  withTransaction: async (work) => {
    const conn = await local.pool.getConnection();
    try { await conn.beginTransaction(); const result = await work(conn); await conn.commit(); return result; }
    catch (error) { await conn.rollback(); throw error; }
    finally { conn.release(); }
  },
}));
vi.mock("../src/settings.js", () => ({ getCommercialSettings: async () => ({ businessTimezone: local.timeZone }) }));
vi.mock("../src/coach/business-rules.js", () => ({
  loadCoachBusinessRules: async () => ({ operationPolicy: { allowedKinds: local.enabled ? ["reschedule_activity"] : [] }, scope: {} }),
}));
vi.mock("../src/coach/channel-intent-governance.js", () => ({ loadChannelIntentConfigurations: async () => [] }));
import { ensureCoachSchema } from "../src/coach/schema.js";
import { createCoachSession, persistCoachOperations, updateCoachOperation, createCoachHandoff,
  getCoachHandoff, completeCoachHandoff, cancelCoachHandoff } from "../src/coach/service.js";
import { checkCustomerRescheduleAccess, readCustomerSchedule } from "../src/coach/customer-reschedule-access.js";
import { saveCustomerReschedule } from "../src/coach/customer-reschedule-save.js";
import { buildCustomerRescheduleResponse } from "../src/commercial-intelligence/customer-reschedule.js";

describe.skipIf(!process.env.G06_MYSQL_TEST_SOCKET)("A06 isolated MySQL module save", () => {
  let admin, session;
  const database = `newpeople_a06_test_${process.pid}`;
  const user = { id: 7, name: "Vendedor ficticio", permissionSet: new Set([
    "mi_coach.access", "mi_coach.execute", "inteligencia_comercial.access", "cuentas.read", "oportunidades.read",
    "calendario_comercial.read", "calendario_comercial.update", "oportunidades.update", "desarrollo_comercial.update",
  ]) };
  const req = { user, headers: {}, ip: "127.0.0.1" };
  const snapshot = { account: { id: 1, name: "Cuenta ficticia" } };
  const sql = async (text, args = []) => (await local.pool.query(text, args))[0];
  const saveMemory = (memory) => sql("UPDATE customer_intelligence_chat_sessions SET context_json=? WHERE id=1", [JSON.stringify({ rescheduleMemory: memory })]);
  const prepare = async (patch = {}, previous) => {
    const spec = { mode: previous ? "continue" : "start", opportunityReference: "Proyecto ficticio", activityReference: "75",
      selectionTarget: "none", position: 0, dateText: "2030-10-23", timeText: "", evidence: "Mueve 75 de Proyecto ficticio al 2030-10-23", ...patch };
    const result = await buildCustomerRescheduleResponse({ component: { object: "activity", scope: "single", rescheduleSpec: spec },
      movement: "new_request", question: spec.evidence, snapshot, previous, timeZone: local.timeZone,
      readSchedule: (accountId) => readCustomerSchedule({ user, accountId }) });
    await saveMemory(result.rescheduleMemory);
    return result;
  };
  const persist = async (operation) => (await persistCoachOperations({ userId: 7, sessionId: session.id,
    sourceJobId: null, originalIntent: "Prueba A06 aislada", operations: [operation] }))[0];
  const transfer = async (operation) => (await createCoachHandoff(7, (await persist(operation)).id)).operation;
  const save = (saved, actor = user) => saveCustomerReschedule({
    req: { ...req, user: actor }, token: saved.handoffToken, opportunityId: 3, version: saved.version,
  });
  beforeAll(async () => {
    const options = { user: "root", socketPath: process.env.G06_MYSQL_TEST_SOCKET, timezone: "Z" };
    admin = await mysql.createConnection(options);
    await admin.query(`CREATE DATABASE ${database}`);
    local.pool = mysql.createPool({ ...options, database, connectionLimit: 5 });
    await sql("CREATE TABLE users(id BIGINT UNSIGNED PRIMARY KEY)");
    await sql("INSERT INTO users VALUES(7)");
    await sql(`CREATE TABLE audit_log(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, entity_id BIGINT UNSIGNED,
      module VARCHAR(60), action VARCHAR(100), entity_type VARCHAR(60), status VARCHAR(20), detail TEXT, changed_fields JSON,
      performed_by_user_id BIGINT, performed_by_name VARCHAR(180), performed_by_email VARCHAR(190),
      ip_address VARCHAR(64), user_agent VARCHAR(500), created_at DATETIME(3))`);
    await sql("CREATE TABLE accounts(id BIGINT PRIMARY KEY,name VARCHAR(180),activation_status_id BIGINT)");
    await sql("CREATE TABLE account_activation_statuses(id BIGINT PRIMARY KEY,code VARCHAR(30))");
    await sql("INSERT INTO account_activation_statuses VALUES(1,'activada'),(2,'desactivada')");
    await sql("INSERT INTO accounts VALUES(1,'Cuenta ficticia',1)");
    await sql("CREATE TABLE account_owners(account_id BIGINT,user_id BIGINT)");
    await sql("INSERT INTO account_owners VALUES(1,7)");
    await sql("CREATE TABLE opportunities(id BIGINT PRIMARY KEY,name VARCHAR(180),account_id BIGINT,commercial_status_id BIGINT)");
    await sql("CREATE TABLE opportunity_commercial_statuses(id BIGINT PRIMARY KEY,code VARCHAR(30))");
    await sql("INSERT INTO opportunity_commercial_statuses VALUES(1,'abierta'),(2,'ganada'),(3,'perdida'),(4,'anulada')");
    await sql("INSERT INTO opportunities VALUES(3,'Proyecto ficticio',1,1)");
    await sql(`CREATE TABLE opportunity_workspace_actions(id BIGINT PRIMARY KEY,opportunity_id BIGINT,title VARCHAR(180),
      action_type VARCHAR(60),status VARCHAR(30),scheduled_at DATETIME(3),due_date DATE,notes TEXT,owner_user_id BIGINT,
      updated_by_user_id BIGINT,updated_at DATETIME(3))`);
    await sql("INSERT INTO opportunity_workspace_actions VALUES(75,3,'Reunión ficticia','meeting_virtual','pending','2030-10-20 16:00:00','2030-10-20','Nota que debe conservarse',7,7,NOW(3))");
    await sql("CREATE TABLE customer_intelligence_chat_sessions(id BIGINT PRIMARY KEY,requested_by_user_id BIGINT,account_id BIGINT,context_json JSON)");
    await sql("INSERT INTO customer_intelligence_chat_sessions VALUES(1,7,1,JSON_OBJECT())");
    await ensureCoachSchema();
    session = await createCoachSession(7, { accountId: 1 });
  });
  beforeEach(async () => {
    local.enabled = true; local.timeZone = "America/Mexico_City";
    await sql("UPDATE opportunities SET commercial_status_id=1,account_id=1,name='Proyecto ficticio' WHERE id=3");
    await sql("UPDATE opportunity_workspace_actions SET opportunity_id=3,title='Reunión ficticia',action_type='meeting_virtual',status='pending',scheduled_at='2030-10-20 16:00:00',due_date='2030-10-20' WHERE id=75");
    await sql("UPDATE accounts SET activation_status_id=1,name='Cuenta ficticia' WHERE id=1");
    await sql("UPDATE account_owners SET user_id=7");
  });
  afterAll(async () => {
    if (local.pool) { await local.pool.end(); local.pool = null; }
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS ${database}`); await admin.end(); }
  });
  it("prepares/transfers/loads without a domain write then updates only scheduling, retaining identity and row count", async () => {
    const result = await prepare();
    expect(result.operations).toHaveLength(1);
    expect(await checkCustomerRescheduleAccess(user, result.operations[0])).toBeNull();
    const handed = await transfer(result.operations[0]);
    expect((await getCoachHandoff(7, handed.handoffToken, "calendar")).outcome).toBe("ready");
    expect((await sql("SELECT scheduled_at FROM opportunity_workspace_actions WHERE id=75"))[0].scheduled_at.toISOString()).toBe("2030-10-20T16:00:00.000Z");
    const completed = await save(handed);
    expect(completed.status).toBe("completed");
    expect(completed.result.activityId).toBe(75);
    const rows = await sql("SELECT * FROM opportunity_workspace_actions");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 75, notes: "Nota que debe conservarse", owner_user_id: 7, status: "pending" });
    expect(rows[0].scheduled_at.toISOString()).toBe("2030-10-23T16:00:00.000Z");
    const audit = (await sql("SELECT coach_operation_id,changed_fields FROM audit_log WHERE id=?", [completed.domainAuditId]))[0];
    expect(audit.coach_operation_id).toBe(handed.id);
    const changed = typeof audit.changed_fields === "string" ? JSON.parse(audit.changed_fields) : audit.changed_fields;
    expect(changed.scheduled_at).toEqual({ before: "2030-10-20T16:00:00.000Z", after: "2030-10-23T16:00:00.000Z" });
    expect(changed.due_date).toEqual({ before: "2030-10-20", after: "2030-10-23" });
  });
  it("generic completion cannot impersonate an actual save", async () => {
    const handed = await transfer((await prepare()).operations[0]);
    expect((await completeCoachHandoff(7, handed.handoffToken, "calendar", { entityType: "opportunity", entityId: 3 })).outcome).toBe("save_required");
  });
  it("correction reuses operation and invalidates previous token and historical revisions", async () => {
    const first = await prepare(), handed = await transfer(first.operations[0]);
    const next = await prepare({ dateText: "2030-10-24", evidence: "Mueve 75 de Proyecto ficticio al 2030-10-24" }, first.rescheduleMemory);
    const persisted = await persist(next.operations[0]);
    expect(persisted.id).toBe(handed.id);
    expect(persisted.handoffToken).toBeNull();
    expect((await persist(first.operations[0])).pendingOperation.proposedDueDate).toBe("2030-10-24");
    expect((await getCoachHandoff(7, handed.handoffToken, "calendar")).outcome).toBe("not_found");
    expect((await save((await createCoachHandoff(7, persisted.id)).operation)).result.after).toContain("2030-10-24");
  });
  it("PATCH cannot alter the activity, temporal values or observed state", async () => {
    const saved = await persist((await prepare()).operations[0]);
    for (const patch of [{ activityId: 99 }, { proposedDueDate: "2031-01-01" }, { observedVersion: "[]" }]) {
      expect((await updateCoachOperation(7, saved.id, { version: saved.version, pendingOperation: { ...saved.pendingOperation, ...patch } })).outcome).toBe("invalid");
    }
  });
  it("cancelled memory or module transfer cannot be saved or reopened", async () => {
    const result = await prepare(), handed = await transfer(result.operations[0]);
    await saveMemory(null);
    await expect(save(handed)).rejects.toMatchObject({ status: 409 });
    await saveMemory(result.rescheduleMemory);
    await cancelCoachHandoff(7, handed.handoffToken, "calendar", "Descartar prueba");
    await expect(save(handed)).rejects.toMatchObject({ status: 409 });
    expect((await persist(result.operations[0])).status).toBe("cancelled");
  });
  it("detects a concurrent reschedule and never overwrites it", async () => {
    const handed = await transfer((await prepare()).operations[0]);
    await sql("UPDATE opportunity_workspace_actions SET scheduled_at='2030-10-25 17:00:00' WHERE id=75");
    await expect(save(handed)).rejects.toMatchObject({ status: 409 });
  });
  it.each(["done", "cancelled", "blocked", "in_progress"])("revalidates activity state %s", async (status) => {
    const handed = await transfer((await prepare()).operations[0]);
    await sql("UPDATE opportunity_workspace_actions SET status=? WHERE id=75", [status]);
    await expect(save(handed)).rejects.toMatchObject({ status: 422 });
  });
  it.each([2, 3, 4])("blocks closed opportunity state %s", async (status) => {
    const handed = await transfer((await prepare()).operations[0]);
    await sql("UPDATE opportunities SET commercial_status_id=? WHERE id=3", [status]);
    await expect(save(handed)).rejects.toMatchObject({ status: 422 });
  });
  it.each(["account", "opportunity", "activity", "owner"])("revalidates eligibility %s", async (object) => {
    const handed = await transfer((await prepare()).operations[0]);
    if (object === "account") await sql("UPDATE accounts SET activation_status_id=2");
    if (object === "opportunity") await sql("UPDATE opportunities SET account_id=99");
    if (object === "activity") await sql("UPDATE opportunity_workspace_actions SET opportunity_id=99");
    if (object === "owner") await sql("UPDATE account_owners SET user_id=99");
    await expect(save(handed)).rejects.toMatchObject({ status: 404 });
  });
  it.each([...user.permissionSet])("revalidates permission %s", async (permission) => {
    const handed = await transfer((await prepare()).operations[0]);
    await expect(save(handed, { ...user, permissionSet: new Set([...user.permissionSet].filter((code) => code !== permission)) })).rejects.toMatchObject({ status: 403 });
  });
  it("supports read_all while retaining fixed-account constraints", async () => {
    const handed = await transfer((await prepare()).operations[0]);
    const permissionSet = new Set([...user.permissionSet].filter((code) => !code.endsWith(".read")));
    for (const domain of ["cuentas", "oportunidades", "calendario_comercial"]) permissionSet.add(`${domain}.read_all`);
    await sql("UPDATE account_owners SET user_id=99");
    expect((await save(handed, { ...user, permissionSet })).status).toBe("completed");
  });
  it("revalidates policy, version, opportunity, expiration and timezone", async () => {
    const handed = await transfer((await prepare()).operations[0]);
    local.enabled = false;
    await expect(save(handed)).rejects.toMatchObject({ status: 409 }); local.enabled = true;
    local.timeZone = "UTC";
    await expect(save(handed)).rejects.toMatchObject({ status: 409 }); local.timeZone = "America/Mexico_City";
    await expect(save({ ...handed, version: handed.version + 1 })).rejects.toMatchObject({ status: 409 });
    await expect(saveCustomerReschedule({ req, token: handed.handoffToken, opportunityId: 99, version: handed.version })).rejects.toMatchObject({ status: 404 });
    await sql("UPDATE coach_session_operations SET handoff_expires_at=DATE_SUB(NOW(),INTERVAL 1 DAY) WHERE id=?", [handed.id]);
    await expect(save(handed)).rejects.toMatchObject({ status: 409 });
  });
  it.each(["account", "opportunity", "activity"])("requires refresh after %s rename", async (object) => {
    const first = await prepare(), handed = await transfer(first.operations[0]);
    if (object === "account") await sql("UPDATE accounts SET name='Cuenta renombrada'");
    if (object === "opportunity") await sql("UPDATE opportunities SET name='Proyecto renombrado'");
    if (object === "activity") await sql("UPDATE opportunity_workspace_actions SET title='Reunión renombrada'");
    await expect(save(handed)).rejects.toMatchObject({ status: 409 });
    const refreshed = await prepare({ mode: "refresh", opportunityReference: "", activityReference: "", dateText: "", evidence: "" }, first.rescheduleMemory);
    expect((await save(await transfer(refreshed.operations[0]))).status).toBe("completed");
  });
  it("serializes simultaneous confirmations with one audit and one completion", async () => {
    const handed = await transfer((await prepare()).operations[0]);
    const [one, two] = await Promise.all([save(handed), save(handed)]);
    expect(one.result).toEqual(two.result);
    expect((await sql("SELECT COUNT(*) AS n FROM audit_log WHERE coach_operation_id=?", [handed.id]))[0].n).toBe(1);
    expect((await sql("SELECT COUNT(*) AS n FROM coach_operation_events WHERE operation_id=? AND event_type='completed'", [handed.id]))[0].n).toBe(1);
  });
  it.each(["audit", "event"])("rolls back schedule, audit and finalization on %s failure", async (target) => {
    const handed = await transfer((await prepare()).operations[0]);
    const before = (await sql("SELECT COUNT(*) AS n FROM audit_log"))[0].n;
    const table = target === "audit" ? "audit_log" : "coach_operation_events";
    const condition = target === "audit" ? "NEW.action='workspace_activity_rescheduled'" : "NEW.event_type='completed'";
    await sql(`CREATE TRIGGER a06_failure BEFORE INSERT ON ${table} FOR EACH ROW BEGIN IF ${condition} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated A06 failure'; END IF; END`);
    try {
      await expect(save(handed)).rejects.toThrow("isolated A06 failure");
      expect((await sql("SELECT scheduled_at FROM opportunity_workspace_actions WHERE id=75"))[0].scheduled_at.toISOString()).toBe("2030-10-20T16:00:00.000Z");
      expect((await sql("SELECT status FROM coach_session_operations WHERE id=?", [handed.id]))[0].status).toBe("handed_off");
      expect((await sql("SELECT COUNT(*) AS n FROM audit_log"))[0].n).toBe(before);
    } finally { await sql("DROP TRIGGER a06_failure"); }
  });
  it("fails explicitly rather than selecting from a truncated account activity list", async () => {
    const values = Array.from({ length: 1000 }, (_, index) => [index + 100, 3, `Llamada ficticia ${index}`, "call", "pending"]);
    await sql(`INSERT INTO opportunity_workspace_actions(id,opportunity_id,title,action_type,status)
      VALUES ${values.map(() => "(?,?,?,?,?)").join(",")}`, values.flat());
    try {
      await expect(readCustomerSchedule({ user, accountId: 1 })).rejects.toMatchObject({ status: 422 });
    } finally { await sql("DELETE FROM opportunity_workspace_actions WHERE id BETWEEN 100 AND 1099"); }
  });
});
