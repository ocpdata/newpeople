import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mysql from "mysql2/promise";
const local = vi.hoisted(() => ({ pool: null }));
vi.mock("../src/db.js", () => ({
  query: async (text, args) => {
    if (!local.pool) throw new Error("Isolated MySQL is not initialized");
    return (await local.pool.query(text, args))[0];
  },
  withTransaction: async (work) => {
    if (!local.pool) throw new Error("Isolated MySQL is not initialized");
    const connection = await local.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  },
}));
vi.mock("../src/coach/business-rules.js", () => ({
  loadCoachBusinessRules: async () => ({ operationPolicy: { allowedKinds: ["create_contact", "create_opportunity"] }, scope: {} }),
}));
vi.mock("../src/coach/channel-intent-governance.js", () => ({ loadChannelIntentConfigurations: async () => [] }));
import { ensureCoachSchema } from "../src/coach/schema.js";
import { createCoachHandoff, createCoachSession, persistCoachOperations, updateCoachOperation } from "../src/coach/service.js";
import { buildCustomerCreationResponse } from "../src/commercial-intelligence/customer-creation.js";
import { checkCustomerCreationAccess } from "../src/coach/customer-creation-access.js";

describe.skipIf(!process.env.G06_MYSQL_TEST_SOCKET)("A01 isolated MySQL draft persistence", () => {
  let admin;
  let session;
  let operation;
  let memory;
  const user = { id: 7, permissionSet: new Set(["cuentas.read", "mi_coach.execute", "contactos.create", "contactos.read", "oportunidades.create"]) };
  const database = `newpeople_a01_test_${process.pid}`;
  const sql = async (text, args = []) => (await local.pool.query(text, args))[0];
  const persist = async (item = operation, sessionId = session.id) => (await persistCoachOperations({
    userId: 7, sessionId, sourceJobId: null, originalIntent: "Preparar contacto", operations: [item],
  }))[0];
  beforeAll(async () => {
    const options = { user: "root", socketPath: process.env.G06_MYSQL_TEST_SOCKET };
    admin = await mysql.createConnection(options);
    await admin.query(`CREATE DATABASE ${database}`);
    local.pool = mysql.createPool({ ...options, database, connectionLimit: 4 });
    await sql("CREATE TABLE users(id BIGINT UNSIGNED PRIMARY KEY)");
    await sql("INSERT INTO users VALUES(7)");
    await sql("CREATE TABLE audit_log(id BIGINT UNSIGNED PRIMARY KEY, entity_id BIGINT UNSIGNED)");
    await sql("CREATE TABLE accounts(id BIGINT PRIMARY KEY, activation_status_id BIGINT)");
    await sql("CREATE TABLE account_activation_statuses(id BIGINT PRIMARY KEY, code VARCHAR(30))");
    await sql("CREATE TABLE account_owners(account_id BIGINT, user_id BIGINT)");
    await sql("CREATE TABLE customer_intelligence_chat_sessions(id BIGINT PRIMARY KEY, requested_by_user_id BIGINT, account_id BIGINT, context_json JSON)");
    await sql("INSERT INTO accounts VALUES(1,1)");
    await sql("INSERT INTO account_activation_statuses VALUES(1,'activada')");
    await sql("INSERT INTO account_owners VALUES(1,7)");
    await ensureCoachSchema();
    session = await createCoachSession(7, { accountId: 1 });
    const result = buildCustomerCreationResponse({
      component: { object: "contact", creationSpec: { mode: "start", fields: [
        { field: "firstName", value: "Ana", evidence: "Ana" }, { field: "lastName", value: "Luna", evidence: "Luna" },
      ] } }, movement: "new_request", question: "Ana Luna",
      snapshot: { account: { id: 1, name: "Cuenta ficticia" }, contacts: [] },
    });
    operation = result.operations[0];
    memory = result.creationMemory;
    await sql("INSERT INTO customer_intelligence_chat_sessions VALUES(1,7,1,?)", [JSON.stringify({ creationMemory: memory })]);
  });
  afterAll(async () => {
    if (local.pool) { await local.pool.end(); local.pool = null; }
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS ${database}`); await admin.end(); }
  });
  it("persists a draft without creating any CRM domain tables or records", async () => {
    const saved = await persist();
    expect(saved.pendingOperation.creationDraftId).toBe(operation.creationDraftId);
    expect(saved.status).toBe("ready");
    const tables = await sql("SHOW TABLES");
    expect(tables.some((row) => ["contacts", "opportunities"].includes(Object.values(row)[0]))).toBe(false);
  });
  it("serializes concurrent retries across distinct Coach sessions to one operation", async () => {
    const secondSession = await createCoachSession(7, { accountId: 1 });
    const results = await Promise.all([persist(), persist(operation, secondSession.id), persist()]);
    expect(new Set(results.map((item) => item.id)).size).toBe(1);
    expect((await sql("SELECT COUNT(*) AS total FROM coach_session_operations"))[0].total).toBe(1);
  });
  it("updates the same draft for an explicit later revision and refuses an old historical version", async () => {
    const revised = { ...operation, creationRevision: 2, payload: { ...operation.payload, email: "ana@example.invalid" } };
    const saved = await persist(revised);
    const old = await persist(operation);
    expect(old.id).toBe(saved.id);
    expect(old.pendingOperation.creationRevision).toBe(2);
    expect(old.pendingOperation.payload.email).toBe("ana@example.invalid");
    expect((await sql("SELECT COUNT(*) AS total FROM coach_session_operations"))[0].total).toBe(1);
  });
  it("does not move an existing draft to another account", async () => {
    const result = await persist({ ...operation, creationRevision: 3, accountId: 99, payload: { ...operation.payload, accountId: 99 } });
    expect(result.pendingOperation.accountId).toBe(1);
  });
  it("reuses the same handoff and does not reopen or modify the already transferred draft", async () => {
    const saved = await persist({ ...operation, creationRevision: 2 });
    const first = await createCoachHandoff(7, saved.id);
    const repeated = await createCoachHandoff(7, saved.id);
    expect(repeated.operation.handoffToken).toBe(first.operation.handoffToken);
    const retried = await persist({ ...operation, creationRevision: 3 });
    expect(retried.status).toBe("handed_off");
    expect(retried.pendingOperation.creationRevision).toBe(2);
    const edit = await updateCoachOperation(7, saved.id, {
      version: first.operation.version, pendingOperation: { ...operation, creationRevision: 3 },
    });
    expect(edit.outcome).toBe("closed");
  });
  it("does not create a second operation after completion, cancellation or rejection", async () => {
    for (const status of ["completed", "cancelled", "rejected"]) {
      await sql("UPDATE coach_session_operations SET status = ?", [status]);
      const result = await persist();
      expect(result.status).toBe(status);
      expect((await sql("SELECT COUNT(*) AS total FROM coach_session_operations"))[0].total).toBe(1);
    }
  });
  it("starts a distinct operation only with a new draft identity", async () => {
    const second = { ...operation, creationDraftId: "20a19b39-1b35-48b6-9a7b-bbfa576cbb04" };
    const saved = await persist(second);
    expect(saved.status).toBe("ready");
    expect((await sql("SELECT COUNT(*) AS total FROM coach_session_operations"))[0].total).toBe(2);
  });
  it("checks the real persisted JSON draft revision and rejects stale or cancelled history", async () => {
    expect(await checkCustomerCreationAccess(user, operation)).toBeNull();
    expect(await checkCustomerCreationAccess(user, { ...operation, creationRevision: 2 })).toMatchObject({ status: 409 });
    await sql("UPDATE customer_intelligence_chat_sessions SET context_json = JSON_OBJECT()");
    expect(await checkCustomerCreationAccess(user, operation)).toMatchObject({ status: 409 });
    await sql("UPDATE customer_intelligence_chat_sessions SET context_json = ?", [JSON.stringify({ creationMemory: memory })]);
  });
  it("revalidates current account ownership without touching a domain record", async () => {
    await sql("DELETE FROM account_owners WHERE account_id = 1 AND user_id = 7");
    expect(await checkCustomerCreationAccess(user, operation)).toMatchObject({ status: 404 });
    await sql("INSERT INTO account_owners VALUES(1,7)");
    expect(await checkCustomerCreationAccess(user, operation)).toBeNull();
  });
});
