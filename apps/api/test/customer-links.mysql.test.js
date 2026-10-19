import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mysql from "mysql2/promise";
const local = vi.hoisted(() => ({ pool: null, enabled: true }));
vi.mock("../src/db.js", () => ({
  query: async (sql, args) => (await local.pool.query(sql, args))[0],
  withTransaction: async (work) => {
    const conn = await local.pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await work(conn);
      await conn.commit();
      return result;
    } catch (error) { await conn.rollback(); throw error; }
    finally { conn.release(); }
  },
}));
vi.mock("../src/coach/business-rules.js", () => ({
  loadCoachBusinessRules: async () => ({ operationPolicy: { allowedKinds: local.enabled ? ["link_contact_to_opportunity"] : [] }, scope: {} }),
}));
vi.mock("../src/coach/channel-intent-governance.js", () => ({ loadChannelIntentConfigurations: async () => [] }));
import { ensureCoachSchema } from "../src/coach/schema.js";
import { createCoachSession, persistCoachOperations, updateCoachOperation, createCoachHandoff,
  getCoachHandoff, completeCoachHandoff, cancelCoachHandoff } from "../src/coach/service.js";
import { checkCustomerLinkAccess, readCustomerLinkPair } from "../src/coach/customer-link-access.js";
import { saveCustomerLinkHandoff } from "../src/coach/customer-link-save.js";
import { buildCustomerLinkResponse } from "../src/commercial-intelligence/customer-links.js";
import { HISTORY_FIELDS } from "../src/opportunity-audit.js";

describe.skipIf(!process.env.G06_MYSQL_TEST_SOCKET)("A04 isolated MySQL module save", () => {
  let admin, session;
  const database = `newpeople_a04_test_${process.pid}`;
  const user = { id: 7, name: "Vendedor ficticio", permissionSet: new Set([
    "mi_coach.access", "mi_coach.execute", "inteligencia_comercial.access", "cuentas.read", "contactos.read", "oportunidades.read", "oportunidades.update",
  ]) };
  const req = { user, headers: {}, ip: "127.0.0.1" };
  const snapshot = { account: { id: 1, name: "Cuenta ficticia" }, contacts: [
    { id: 2, accountId: 1, name: "Elena Prueba" }, { id: 5, accountId: 1, name: "Ana Otra" }],
  opportunities: [{ id: 3, accountId: 1, name: "Proyecto ficticio" }] };
  const sql = async (text, args = []) => (await local.pool.query(text, args))[0];
  const saveMemory = (memory) => sql("UPDATE customer_intelligence_chat_sessions SET context_json=? WHERE id=1", [JSON.stringify({ linkMemory: memory })]);
  const prepare = async (patch = {}, previous) => {
    const spec = { mode: previous ? "continue" : "start", opportunityReference: "Proyecto ficticio", contactReference: "Elena Prueba",
      intent: "assign", selectionTarget: "none", position: 0, evidence: "Vincula Elena Prueba Ana Otra a Proyecto ficticio", ...patch };
    const result = await buildCustomerLinkResponse({ component: { object: "opportunity", scope: "single", linkSpec: spec },
      movement: "new_request", question: spec.evidence, snapshot, previous,
      readPair: (ids) => readCustomerLinkPair({ user, ...ids }) });
    await saveMemory(result.linkMemory);
    return result;
  };
  const persist = async (operation, sessionId = session.id) => (await persistCoachOperations({
    userId: 7, sessionId, sourceJobId: null, originalIntent: "Prueba vínculo aislado", operations: [operation],
  }))[0];
  const transfer = async (operation) => (await createCoachHandoff(7, (await persist(operation)).id)).operation;
  const save = (saved, actor = user) => saveCustomerLinkHandoff({
    req: { ...req, user: actor }, token: saved.handoffToken, opportunityId: 3, version: saved.version,
  });
  beforeAll(async () => {
    const options = { user: "root", socketPath: process.env.G06_MYSQL_TEST_SOCKET };
    admin = await mysql.createConnection(options);
    await admin.query(`CREATE DATABASE ${database}`);
    local.pool = mysql.createPool({ ...options, database, connectionLimit: 5 });
    await sql("CREATE TABLE users(id BIGINT UNSIGNED PRIMARY KEY)");
    await sql("INSERT INTO users VALUES(7)");
    await sql(`CREATE TABLE audit_log(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, entity_id BIGINT UNSIGNED,
      module VARCHAR(60), action VARCHAR(100), entity_type VARCHAR(60), status VARCHAR(20), detail TEXT, changed_fields JSON,
      performed_by_user_id BIGINT, performed_by_name VARCHAR(180), performed_by_email VARCHAR(190),
      ip_address VARCHAR(64), user_agent VARCHAR(500), created_at DATETIME(3))`);
    await sql("CREATE TABLE accounts(id BIGINT PRIMARY KEY, name VARCHAR(180), activation_status_id BIGINT)");
    await sql("CREATE TABLE account_activation_statuses(id BIGINT PRIMARY KEY, code VARCHAR(30))");
    await sql("INSERT INTO account_activation_statuses VALUES(1,'activada'),(2,'desactivada')");
    await sql("INSERT INTO accounts VALUES(1,'Cuenta ficticia',1)");
    await sql("CREATE TABLE account_owners(account_id BIGINT, user_id BIGINT)");
    await sql("INSERT INTO account_owners VALUES(1,7)");
    await sql("CREATE TABLE contacts(id BIGINT PRIMARY KEY, account_id BIGINT, first_name VARCHAR(120), last_name VARCHAR(120), activation_status_id BIGINT)");
    await sql("CREATE TABLE contact_activation_statuses(id BIGINT PRIMARY KEY, code VARCHAR(30))");
    await sql("INSERT INTO contact_activation_statuses VALUES(1,'activado'),(2,'desactivado')");
    await sql("INSERT INTO contacts VALUES(2,1,'Elena','Prueba',1),(5,1,'Ana','Otra',1),(6,1,'Persona','Anterior',1)");
    await sql(`CREATE TABLE opportunities(id BIGINT PRIMARY KEY, contact_id BIGINT,
      ${HISTORY_FIELDS.map((field) => `${field} ${field === "name" ? "VARCHAR(180)" : ["close_date", "commercial_closed_at", "created_at"].includes(field) ? "DATETIME" : "BIGINT"}`).join(",")},
      updated_by BIGINT, updated_at DATETIME(3))`);
    await sql("CREATE TABLE opportunity_commercial_statuses(id BIGINT PRIMARY KEY, code VARCHAR(30))");
    await sql("INSERT INTO opportunity_commercial_statuses VALUES(1,'abierta'),(2,'ganada'),(3,'perdida'),(4,'anulada')");
    await sql("INSERT INTO opportunities(id,name,account_id,contact_id,amount_usd,commercial_status_id) VALUES(3,'Proyecto ficticio',1,6,500000,1)");
    await sql("CREATE TABLE customer_intelligence_chat_sessions(id BIGINT PRIMARY KEY, requested_by_user_id BIGINT, account_id BIGINT, context_json JSON)");
    await sql("INSERT INTO customer_intelligence_chat_sessions VALUES(1,7,1,JSON_OBJECT())");
    await ensureCoachSchema();
    session = await createCoachSession(7, { accountId: 1 });
  });
  beforeEach(async () => {
    local.enabled = true;
    await sql("UPDATE opportunities SET contact_id=6,commercial_status_id=1,account_id=1,name='Proyecto ficticio' WHERE id=3");
    await sql("UPDATE contacts SET account_id=1,activation_status_id=1 WHERE id IN (2,5)");
    await sql("UPDATE contacts SET first_name='Elena' WHERE id=2");
    await sql("UPDATE accounts SET activation_status_id=1,name='Cuenta ficticia' WHERE id=1");
    await sql("UPDATE account_owners SET user_id=7");
  });
  afterAll(async () => {
    if (local.pool) { await local.pool.end(); local.pool = null; }
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS ${database}`); await admin.end(); }
  });
  it("prepares, transfers and loads without writing CRM, then saves only the relationship with audit and completion atomically", async () => {
    const result = await prepare();
    expect(await checkCustomerLinkAccess(user, result.operations[0])).toBeNull();
    const handed = await transfer(result.operations[0]);
    expect((await getCoachHandoff(7, handed.handoffToken, "opportunities")).outcome).toBe("ready");
    expect((await sql("SELECT contact_id FROM opportunities WHERE id=3"))[0].contact_id).toBe(6);
    const completed = await save(handed);
    expect(completed.status).toBe("completed");
    expect(completed.result).toMatchObject({ before: 6, after: 2, entityId: 3 });
    expect((await sql("SELECT contact_id,amount_usd FROM opportunities WHERE id=3"))[0]).toEqual({ contact_id: 2, amount_usd: 500000 });
    const audits = await sql("SELECT * FROM audit_log WHERE id=?", [completed.domainAuditId]);
    const changed = typeof audits[0].changed_fields === "string" ? JSON.parse(audits[0].changed_fields) : audits[0].changed_fields;
    expect(changed.contact_id).toEqual({ before: 6, after: 2 });
    expect(audits[0].coach_operation_id).toBe(completed.id);
    const histories = await sql("SELECT changed_fields FROM audit_log WHERE action='commercial_history_changed' AND entity_id=3 ORDER BY id DESC LIMIT 1");
    const history = typeof histories[0].changed_fields === "string" ? JSON.parse(histories[0].changed_fields) : histories[0].changed_fields;
    expect(history.commercial_history.after.before_state.contact_id).toBe(6);
    expect(history.commercial_history.after.after_state.contact_id).toBe(2);
  });
  it("does not allow the generic completion endpoint to claim a save", async () => {
    const handed = await transfer((await prepare()).operations[0]);
    expect((await completeCoachHandoff(7, handed.handoffToken, "opportunities", { entityId: 3 })).outcome).toBe("save_required");
    expect((await sql("SELECT contact_id FROM opportunities WHERE id=3"))[0].contact_id).toBe(6);
  });
  it("deduplicates concurrent submissions and reuses a valid transfer token", async () => {
    const result = await prepare();
    const other = await createCoachSession(7, { accountId: 1 });
    const [one, two] = await Promise.all([persist(result.operations[0]), persist(result.operations[0], other.id)]);
    expect(one.id).toBe(two.id);
    const handed = (await createCoachHandoff(7, one.id)).operation;
    expect((await createCoachHandoff(7, two.id)).operation.handoffToken).toBe(handed.handoffToken);
  });
  it("updates a correction in place, invalidates the old token and never restores older history", async () => {
    const first = await prepare();
    const handed = await transfer(first.operations[0]);
    const corrected = await prepare({ contactReference: "Ana Otra" }, first.linkMemory);
    expect(await checkCustomerLinkAccess(user, first.operations[0])).toMatchObject({ status: 409 });
    const updated = await persist(corrected.operations[0]);
    expect(updated.id).toBe(handed.id);
    expect(updated.handoffToken).toBeNull();
    expect(updated.status).toBe("ready");
    expect((await persist(first.operations[0])).pendingOperation.contactId).toBe(5);
    expect((await getCoachHandoff(7, handed.handoffToken, "opportunities")).outcome).toBe("not_found");
    const next = (await createCoachHandoff(7, updated.id)).operation;
    expect((await save(next)).result.after).toBe(5);
  });
  it("rejects external edits to the payload, revision and observed relationship via PATCH", async () => {
    const saved = await persist((await prepare()).operations[0]);
    for (const patch of [{ payload: { accountId: 1, contactId: 5 } }, { linkRevision: 9 }, { currentContactId: 99 }]) {
      const result = await updateCoachOperation(7, saved.id, { version: saved.version, pendingOperation: { ...saved.pendingOperation, ...patch } });
      expect(result.outcome).toBe("invalid");
    }
  });
  it("rejects cancelled conversational memory even when the transfer is still present", async () => {
    const handed = await transfer((await prepare()).operations[0]);
    await saveMemory(null);
    await expect(save(handed)).rejects.toMatchObject({ status: 409 });
  });
  it("rejects a discarded module handoff without reopening it", async () => {
    const result = await prepare();
    const handed = await transfer(result.operations[0]);
    await cancelCoachHandoff(7, handed.handoffToken, "opportunities", "Descartar prueba");
    await expect(save(handed)).rejects.toMatchObject({ status: 409 });
    expect((await persist(result.operations[0])).status).toBe("cancelled");
  });
  it("detects a concurrent relation edit and never overwrites it", async () => {
    const handed = await transfer((await prepare()).operations[0]);
    await sql("UPDATE opportunities SET contact_id=5 WHERE id=3");
    await expect(save(handed)).rejects.toMatchObject({ status: 409 });
    expect((await sql("SELECT contact_id FROM opportunities WHERE id=3"))[0].contact_id).toBe(5);
  });
  it.each([2, 3, 4])("blocks an opportunity closed with status %s after preparation", async (status) => {
    const handed = await transfer((await prepare()).operations[0]);
    await sql("UPDATE opportunities SET commercial_status_id=? WHERE id=3", [status]);
    await expect(save(handed)).rejects.toMatchObject({ status: 422 });
  });
  it.each(["contact", "opportunity"])("revalidates %s membership", async (object) => {
    const handed = await transfer((await prepare()).operations[0]);
    await sql(`UPDATE ${object === "contact" ? "contacts" : "opportunities"} SET account_id=99 WHERE id=?`, [object === "contact" ? 2 : 3]);
    await expect(save(handed)).rejects.toMatchObject({ status: 404 });
  });
  it.each(["owner", "account", "contact"])("blocks revoked eligibility: %s", async (which) => {
    const handed = await transfer((await prepare()).operations[0]);
    if (which === "owner") await sql("UPDATE account_owners SET user_id=99");
    if (which === "account") await sql("UPDATE accounts SET activation_status_id=2 WHERE id=1");
    if (which === "contact") await sql("UPDATE contacts SET activation_status_id=2 WHERE id=2");
    await expect(save(handed)).rejects.toMatchObject({ status: 404 });
  });
  it.each(["mi_coach.access", "inteligencia_comercial.access", "mi_coach.execute", "oportunidades.update", "cuentas.read", "contactos.read", "oportunidades.read"])(
    "revalidates permission %s at save", async (permission) => {
      const handed = await transfer((await prepare()).operations[0]);
      await expect(save(handed, { ...user, permissionSet: new Set([...user.permissionSet].filter((code) => code !== permission)) }))
        .rejects.toMatchObject({ status: 403 });
    });
  it("honors policy revocation, expired transfer and mismatched module/opportunity/version", async () => {
    const handed = await transfer((await prepare()).operations[0]);
    local.enabled = false;
    await expect(save(handed)).rejects.toMatchObject({ status: 409 });
    local.enabled = true;
    await expect(save({ ...handed, version: handed.version + 1 })).rejects.toMatchObject({ status: 409 });
    await expect(saveCustomerLinkHandoff({ req, token: handed.handoffToken, opportunityId: 99, version: handed.version }))
      .rejects.toMatchObject({ status: 404 });
    await sql("UPDATE coach_session_operations SET handoff_expires_at=DATE_SUB(NOW(),INTERVAL 1 DAY) WHERE id=?", [handed.id]);
    await expect(save(handed)).rejects.toMatchObject({ status: 409 });
  });
  it("serializes two saves with one write, audit and completion event", async () => {
    const handed = await transfer((await prepare()).operations[0]);
    const [one, two] = await Promise.all([save(handed), save(handed)]);
    expect(one.result).toEqual(two.result);
    expect((await sql("SELECT COUNT(*) AS n FROM audit_log WHERE coach_operation_id=?", [handed.id]))[0].n).toBe(1);
    expect((await sql("SELECT COUNT(*) AS n FROM coach_operation_events WHERE operation_id=? AND event_type='completed'", [handed.id]))[0].n).toBe(1);
  });
  it("rolls back domain write, history and completion on audit failure", async () => {
    const handed = await transfer((await prepare()).operations[0]);
    const before = (await sql("SELECT COUNT(*) AS n FROM audit_log"))[0].n;
    await sql("CREATE TRIGGER a04_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW BEGIN IF NEW.action='updated' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated A04 failure'; END IF; END");
    try {
      await expect(save(handed)).rejects.toThrow("isolated A04 failure");
      expect((await sql("SELECT contact_id FROM opportunities WHERE id=3"))[0].contact_id).toBe(6);
      expect((await sql("SELECT status FROM coach_session_operations WHERE id=?", [handed.id]))[0].status).toBe("handed_off");
      expect((await sql("SELECT COUNT(*) AS n FROM audit_log"))[0].n).toBe(before);
    } finally { await sql("DROP TRIGGER a04_audit_failure"); }
  });
  it("returns no-change without an operation when already linked", async () => {
    await sql("UPDATE opportunities SET contact_id=2 WHERE id=3");
    const result = await prepare();
    expect(result.operations).toEqual([]);
    expect(result.linkMetadata.effect).toBe("no_change");
  });
  it("rolls back domain, history, audit and finalization when the completion event fails", async () => {
    const handed = await transfer((await prepare()).operations[0]);
    const before = (await sql("SELECT COUNT(*) AS n FROM audit_log"))[0].n;
    await sql("CREATE TRIGGER a04_event_failure BEFORE INSERT ON coach_operation_events FOR EACH ROW BEGIN IF NEW.event_type='completed' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated A04 event failure'; END IF; END");
    try {
      await expect(save(handed)).rejects.toThrow("isolated A04 event failure");
      expect((await sql("SELECT contact_id FROM opportunities WHERE id=3"))[0].contact_id).toBe(6);
      expect((await sql("SELECT status FROM coach_session_operations WHERE id=?", [handed.id]))[0].status).toBe("handed_off");
      expect((await sql("SELECT COUNT(*) AS n FROM audit_log"))[0].n).toBe(before);
    } finally { await sql("DROP TRIGGER a04_event_failure"); }
  });
  it("prepares and saves an assignment where the schema allows no current contact", async () => {
    await sql("UPDATE opportunities SET contact_id=NULL WHERE id=3");
    const result = await prepare();
    expect(result.linkMetadata.effect).toBe("assign");
    expect((await save(await transfer(result.operations[0]))).result).toMatchObject({ before: null, after: 2 });
  });
  it.each(["account", "contact", "opportunity"])("requires a refreshed proposal when the %s name changes after review", async (object) => {
    const first = await prepare();
    const handed = await transfer(first.operations[0]);
    if (object === "contact") await sql("UPDATE contacts SET first_name='Elena Renombrada' WHERE id=2");
    if (object === "account") await sql("UPDATE accounts SET name='Cuenta renombrada' WHERE id=1");
    if (object === "opportunity") await sql("UPDATE opportunities SET name='Proyecto renombrado' WHERE id=3");
    await expect(save(handed)).rejects.toMatchObject({ status: 409 });
    const refreshed = await prepare({ mode: "refresh", opportunityReference: "", contactReference: "", intent: "unspecified", evidence: "" }, first.linkMemory);
    expect(refreshed.operations[0].linkRevision).toBeGreaterThan(first.operations[0].linkRevision);
    expect((await save(await transfer(refreshed.operations[0]))).status).toBe("completed");
  });
});
