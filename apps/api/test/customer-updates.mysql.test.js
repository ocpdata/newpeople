import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mysql from "mysql2/promise";
const local = vi.hoisted(() => ({ pool: null }));
vi.mock("../src/db.js", () => ({
  query: async (text, args) => (await local.pool.query(text, args))[0],
  withTransaction: async (work) => {
    const connection = await local.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  },
}));
vi.mock("../src/coach/business-rules.js", () => ({
  loadCoachBusinessRules: async () => ({ operationPolicy: { allowedKinds: ["account_field", "contact_field", "opportunity_field"] }, scope: {} }),
}));
vi.mock("../src/coach/channel-intent-governance.js", () => ({ loadChannelIntentConfigurations: async () => [] }));
import { ensureCoachSchema } from "../src/coach/schema.js";
import { createCoachSession, persistCoachOperations, updateCoachOperation } from "../src/coach/service.js";
import { executeControlledCoachOperation, reviewControlledCoachOperation } from "../src/coach/controlled-operation-service.js";
import { buildCustomerUpdateResponse } from "../src/commercial-intelligence/customer-updates.js";
import { checkCustomerUpdateAccess, loadCustomerUpdateStates, readCustomerUpdateRecord } from "../src/coach/customer-update-access.js";
import { CUSTOMER_UPDATE_FIELDS } from "../src/coach/customer-field-values.js";

describe.skipIf(!process.env.G06_MYSQL_TEST_SOCKET)("A02 isolated MySQL controlled updates", () => {
  let admin, session;
  const database = `newpeople_a02_test_${process.pid}`;
  const user = { id: 7, name: "Vendedor ficticio", permissionSet: new Set([
    "cuentas.read", "cuentas.update", "contactos.read", "contactos.update", "oportunidades.read", "oportunidades.update", "mi_coach.execute",
  ]) };
  const req = { user, headers: {}, ip: "127.0.0.1" };
  const snapshot = { account: { id: 1, name: "Cuenta ficticia" }, contacts: [{ id: 2, accountId: 1, name: "Elena Prueba" }],
    opportunities: [{ id: 3, accountId: 1, name: "Proyecto ficticio" }] };
  const sql = async (text, args = []) => (await local.pool.query(text, args))[0];
  const persist = async (operation, sessionId = session.id) => (await persistCoachOperations({
    userId: user.id, sessionId, sourceJobId: null, originalIntent: "Prueba A02 aislada", operations: [operation],
  }))[0];
  const saveMemory = (memory) => sql("UPDATE customer_intelligence_chat_sessions SET context_json = ? WHERE id=1", [JSON.stringify({ updateMemory: memory })]);
  const prepare = async ({ object = "account", field = "city", value = "Puebla", action = "set", changes,
    previous, mode = "start" } = {}) => {
    const entries = changes || [{ field, value, action, evidence: `${value || "vacía"}${field === "amountUsd" ? " USD" : ""}` }];
    const result = await buildCustomerUpdateResponse({
      component: { object, scope: "single", updateSpec: { mode, targetReference: object === "account" ? "" : object === "contact" ? "Elena Prueba" : "Proyecto ficticio", changes: entries } },
      movement: "new_request", question: entries.map((entry) => entry.evidence).join("; "), snapshot, previous,
      readRecord: (object, targetId) => readCustomerUpdateRecord({ user, object, targetId, accountId: 1 }),
      loadStates: (draftId) => loadCustomerUpdateStates({ user, draftId }),
    });
    await saveMemory(result.updateMemory);
    return result;
  };
  const review = (saved, actor = user) => reviewControlledCoachOperation({ user: actor, operationId: saved.id, version: saved.version });
  const execute = (saved, idempotencyKey = `a02-key-${saved.id}`) => executeControlledCoachOperation({
    req, operationId: saved.id, version: saved.version, idempotencyKey,
  });
  beforeAll(async () => {
    const options = { user: "root", socketPath: process.env.G06_MYSQL_TEST_SOCKET };
    admin = await mysql.createConnection(options);
    await admin.query(`CREATE DATABASE ${database}`);
    local.pool = mysql.createPool({ ...options, database, connectionLimit: 4 });
    await sql("CREATE TABLE users(id BIGINT UNSIGNED PRIMARY KEY)");
    await sql("INSERT INTO users VALUES(7)");
    await sql(`CREATE TABLE audit_log(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, entity_id BIGINT UNSIGNED,
      module VARCHAR(60), action VARCHAR(100), entity_type VARCHAR(60), status VARCHAR(20), detail TEXT, changed_fields JSON,
      performed_by_user_id BIGINT, performed_by_name VARCHAR(180), performed_by_email VARCHAR(190),
      ip_address VARCHAR(64), user_agent VARCHAR(500), created_at DATETIME(3))`);
    for (const [object, table] of Object.entries({ account: "accounts", contact: "contacts", opportunity: "opportunities" })) {
      const fields = Object.entries(CUSTOMER_UPDATE_FIELDS[object]).map(([field, [column]]) =>
        `${column} ${field === "amountUsd" ? "DECIMAL(15,2)" : field === "closeDate" ? "DATE" : "TEXT"}`).join(", ");
      await sql(`CREATE TABLE ${table}(id BIGINT PRIMARY KEY, ${object === "account" ? "" : "account_id BIGINT,"}
        ${fields}, ${object === "opportunity" ? "commercial_status_id BIGINT," : object === "account" ? "activation_status_id BIGINT DEFAULT 1," : ""}
        updated_by BIGINT, updated_at DATETIME(3))`);
    }
    await sql("CREATE TABLE account_activation_statuses(id BIGINT PRIMARY KEY, code VARCHAR(30))");
    await sql("INSERT INTO account_activation_statuses VALUES(1,'activada'),(2,'desactivada')");
    await sql("CREATE TABLE opportunity_commercial_statuses(id BIGINT PRIMARY KEY, code VARCHAR(30))");
    await sql("INSERT INTO opportunity_commercial_statuses VALUES(1,'abierta'),(2,'ganada'),(3,'perdida'),(4,'anulada')");
    await sql("CREATE TABLE account_owners(account_id BIGINT, user_id BIGINT)");
    await sql("INSERT INTO account_owners VALUES(1,7)");
    await sql("INSERT INTO accounts(id,name,city,phone) VALUES(1,'Cuenta ficticia','Morelia','555')");
    await sql("INSERT INTO contacts(id,account_id,first_name,last_name,email) VALUES(2,1,'Elena','Prueba','old@example.invalid')");
    await sql("INSERT INTO opportunities(id,account_id,name,amount_usd,close_date,commercial_status_id) VALUES(3,1,'Proyecto ficticio',500000,'2028-01-01',1)");
    await sql("CREATE TABLE customer_intelligence_chat_sessions(id BIGINT PRIMARY KEY, requested_by_user_id BIGINT, account_id BIGINT, context_json JSON)");
    await sql("INSERT INTO customer_intelligence_chat_sessions VALUES(1,7,1,JSON_OBJECT())");
    await ensureCoachSchema();
    session = await createCoachSession(7, { accountId: 1 });
  });
  beforeEach(async () => {
    await sql("UPDATE accounts SET city='Morelia', phone='555', activation_status_id=1 WHERE id=1");
    await sql("UPDATE contacts SET email='old@example.invalid', account_id=1 WHERE id=2");
    await sql("UPDATE opportunities SET amount_usd=500000, close_date='2028-01-01', commercial_status_id=1 WHERE id=3");
    await sql("UPDATE account_owners SET user_id=7 WHERE account_id=1");
  });
  afterAll(async () => {
    if (local.pool) { await local.pool.end(); local.pool = null; }
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS ${database}`); await admin.end(); }
  });
  it("prepares and persists without changing CRM, then reviews and atomically saves one audited change", async () => {
    const result = await prepare();
    const saved = await persist(result.operations[0]);
    expect((await sql("SELECT city FROM accounts WHERE id=1"))[0].city).toBe("Morelia");
    const reviewed = await review(saved);
    expect(reviewed.reviewedAt).toBeTruthy();
    const completed = await execute(reviewed);
    expect(completed.status).toBe("completed");
    expect((await sql("SELECT city FROM accounts WHERE id=1"))[0].city).toBe("Puebla");
    const audit = (await sql("SELECT * FROM audit_log WHERE coach_operation_id=?", [saved.id]))[0];
    expect(audit).toBeTruthy();
    const changes = typeof audit.changed_fields === "string" ? JSON.parse(audit.changed_fields) : audit.changed_fields;
    expect(changes.city).toEqual({ before: "Morelia", after: "Puebla" });
    expect((await sql("SELECT COUNT(*) AS n FROM coach_operation_events WHERE operation_id=? AND event_type='completed'", [saved.id]))[0].n).toBe(1);
  });
  it("deduplicates concurrent submissions across sessions and does not restore an older revision", async () => {
    const result = await prepare();
    const second = await createCoachSession(7, { accountId: 1 });
    const [one, two] = await Promise.all([persist(result.operations[0]), persist(result.operations[0], second.id)]);
    expect(one.id).toBe(two.id);
    const revised = await prepare({ previous: result.updateMemory, mode: "continue", value: "Toluca" });
    const updated = await persist(revised.operations[0]);
    expect(updated.id).toBe(one.id);
    expect((await persist(result.operations[0])).pendingOperation.value).toBe("Toluca");
  });
  it("invalidates review when a newer conversational value replaces the proposal", async () => {
    const result = await prepare();
    const reviewed = await review(await persist(result.operations[0]));
    const revised = await prepare({ previous: result.updateMemory, mode: "continue", value: "Toluca" });
    const saved = await persist(revised.operations[0]);
    expect(saved.reviewedAt).toBeNull();
    await expect(execute(saved)).rejects.toMatchObject({ code: "COACH_REVIEW_REQUIRED" });
    await expect(execute(reviewed)).rejects.toMatchObject({ code: "COACH_OPERATION_VERSION_CONFLICT" });
    const completed = await execute(await review(saved));
    expect(completed.result.after).toBe("Toluca");
  });
  it("blocks stale history and external modifications of current/value/identity via PATCH", async () => {
    const result = await prepare();
    const reviewed = await review(await persist(result.operations[0]));
    const edited = await updateCoachOperation(7, reviewed.id, { version: reviewed.version, pendingOperation: {
      ...reviewed.pendingOperation, value: "Injected", currentValue: "Injected", updateAccountId: 99, updateDraftId: "other",
    } });
    expect(edited.operation.pendingOperation).toMatchObject(result.operations[0]);
    expect(edited.operation.reviewedAt).toBeTruthy();
    await saveMemory(null);
    await expect(execute(edited.operation)).rejects.toMatchObject({ code: "COACH_UPDATE_STALE" });
  });
  it("detects CRM concurrent edits after review and refuses to overwrite them", async () => {
    const result = await prepare();
    const reviewed = await review(await persist(result.operations[0]));
    await sql("UPDATE accounts SET city='Editado por otro' WHERE id=1");
    await expect(execute(reviewed)).rejects.toMatchObject({ code: "COACH_TARGET_CHANGED" });
    expect((await sql("SELECT city FROM accounts WHERE id=1"))[0].city).toBe("Editado por otro");
    expect((await sql("SELECT COUNT(*) AS n FROM audit_log WHERE coach_operation_id=?", [reviewed.id]))[0].n).toBe(0);
  });
  it("revalidates owner and read/write permissions at review and execution", async () => {
    const result = await prepare();
    const saved = await persist(result.operations[0]);
    await expect(review(saved, { ...user, permissionSet: new Set(["cuentas.read", "mi_coach.execute"]) }))
      .rejects.toMatchObject({ status: 403 });
    const reviewed = await review(saved);
    await sql("UPDATE account_owners SET user_id=99 WHERE account_id=1");
    await expect(execute(reviewed)).rejects.toMatchObject({ status: 404 });
  });
  it("revalidates that the contact still belongs to the fixed account", async () => {
    const result = await prepare({ object: "contact", field: "email", value: "elena@example.invalid" });
    const reviewed = await review(await persist(result.operations[0]));
    await sql("UPDATE contacts SET account_id=99 WHERE id=2");
    await expect(execute(reviewed)).rejects.toMatchObject({ status: 404 });
  });
  it("blocks the proposal and execution when the fixed account is no longer activated", async () => {
    const result = await prepare();
    const reviewed = await review(await persist(result.operations[0]));
    await sql("UPDATE accounts SET activation_status_id=2 WHERE id=1");
    expect(await checkCustomerUpdateAccess(user, result.operations[0])).toMatchObject({ status: 404 });
    await expect(execute(reviewed)).rejects.toMatchObject({ status: 404 });
    expect((await sql("SELECT city FROM accounts WHERE id=1"))[0].city).toBe("Morelia");
  });
  it.each([2, 3, 4])("blocks a now-terminal opportunity with commercial status %s before review or execution", async (status) => {
    const result = await prepare({ object: "opportunity", field: "amountUsd", value: "550000" });
    const saved = await persist(result.operations[0]);
    await sql("UPDATE opportunities SET commercial_status_id=? WHERE id=3", [status]);
    await expect(review(saved)).rejects.toMatchObject({ status: 422 });
    await sql("UPDATE opportunities SET commercial_status_id=1 WHERE id=3");
    const reviewed = await review(saved);
    await sql("UPDATE opportunities SET commercial_status_id=? WHERE id=3", [status]);
    await expect(execute(reviewed)).rejects.toMatchObject({ status: 422 });
  });
  it("compares MySQL DECIMAL values numerically and records G06 history in the same transaction", async () => {
    const result = await prepare({ object: "opportunity", field: "amountUsd", value: "550.000,25" });
    const completed = await execute(await review(await persist(result.operations[0])));
    expect(completed.result.before).toBe(500000);
    expect((await sql("SELECT amount_usd FROM opportunities WHERE id=3"))[0].amount_usd).toBe("550000.25");
    const audit = await sql("SELECT action FROM audit_log WHERE entity_type='opportunity' AND entity_id=3 AND action='commercial_history_changed'");
    expect(audit.length).toBeGreaterThan(0);
  });
  it("saves zero and a real date without losing or shifting the literal value", async () => {
    const result = await prepare({ object: "opportunity", field: "amountUsd", value: "0" });
    const completed = await execute(await review(await persist(result.operations[0])));
    expect(completed.result.after).toBe(0);
    const date = await prepare({ object: "opportunity", field: "closeDate", value: "2028-02-29" });
    const reviewed = await review(await persist(date.operations[0]));
    expect(reviewed.pendingOperation.currentValue).toBe("2028-01-01");
    expect((await execute(reviewed)).result.after).toBe("2028-02-29");
  });
  it("distinguishes explicit clears, no-change values and pending values", async () => {
    const same = await prepare({ value: "Morelia" });
    expect(same.operations).toEqual([]);
    const clear = await prepare({ field: "phone", value: "", action: "clear" });
    const completed = await execute(await review(await persist(clear.operations[0])));
    expect(completed.result.after).toBeNull();
    expect((await sql("SELECT phone FROM accounts WHERE id=1"))[0].phone).toBeNull();
  });
  it("repeats the same idempotency key without a second write or audit", async () => {
    const result = await prepare();
    const reviewed = await review(await persist(result.operations[0]));
    const completed = await execute(reviewed);
    const repeated = await execute(reviewed);
    expect(repeated.id).toBe(completed.id);
    expect(repeated.result).toEqual(completed.result);
    expect((await sql("SELECT COUNT(*) AS n FROM audit_log WHERE coach_operation_id=?", [reviewed.id]))[0].n).toBe(1);
    await expect(execute(reviewed, "different-key")).rejects.toMatchObject({ code: "COACH_OPERATION_NOT_READY" });
  });
  it("advances the queue only after observing completed persistent operations", async () => {
    const result = await prepare({ changes: [
      { field: "city", value: "Puebla", evidence: "Puebla", action: "set" },
      { field: "phone", value: "123", evidence: "123", action: "set" },
    ] });
    const completed = await execute(await review(await persist(result.operations[0])));
    const next = await prepare({ previous: result.updateMemory, mode: "next", changes: [] });
    expect(next.operations[0].field).toBe("phone");
    expect(next.updateMemory.items[0].status).toBe("completed");
    expect(await checkCustomerUpdateAccess(user, completed.pendingOperation)).toMatchObject({ status: 409 });
    expect((await persist(completed.pendingOperation)).status).toBe("completed");
  });
  it("rolls back the CRM write and completion if domain audit insertion fails", async () => {
    const result = await prepare();
    const reviewed = await review(await persist(result.operations[0]));
    await sql("CREATE TRIGGER a02_fail_audit BEFORE INSERT ON audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated audit failure'");
    try {
      await expect(execute(reviewed)).rejects.toThrow("isolated audit failure");
      expect((await sql("SELECT city FROM accounts WHERE id=1"))[0].city).toBe("Morelia");
      expect((await sql("SELECT status FROM coach_session_operations WHERE id=?", [reviewed.id]))[0].status).toBe("ready");
    } finally { await sql("DROP TRIGGER a02_fail_audit"); }
  });
});
