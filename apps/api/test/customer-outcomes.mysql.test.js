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
  loadCoachBusinessRules: async () => ({ operationPolicy: { allowedKinds: local.enabled ? ["lead_call_outcome"] : [] }, scope: {} }),
}));
vi.mock("../src/coach/channel-intent-governance.js", () => ({ loadChannelIntentConfigurations: async () => [] }));
import { ensureCoachSchema } from "../src/coach/schema.js";
import { createCoachSession, persistCoachOperations, updateCoachOperation } from "../src/coach/service.js";
import { checkCustomerOutcomeAccess, readCustomerOutcomes } from "../src/coach/customer-outcome-access.js";
import { reviewControlledCoachOperation, executeControlledCoachOperation, revertControlledCoachOperation } from "../src/coach/controlled-operation-service.js";
import { getLeadCallOutcomeCatalogResponse, validateLeadCallOutcomeForCoach } from "../src/lead-call-outcomes.js";
import { buildCustomerOutcomeResponse } from "../src/commercial-intelligence/customer-outcomes.js";

describe.skipIf(!process.env.G06_MYSQL_TEST_SOCKET)("A07 isolated MySQL existing controlled executor", () => {
  let admin, session;
  const database = `newpeople_a07_test_${process.pid}`;
  const user = { id: 7, name: "Vendedor ficticio", permissionSet: new Set([
    "mi_coach.access", "mi_coach.execute", "inteligencia_comercial.access", "cuentas.read", "interacciones.read", "interacciones.update",
  ]) };
  const req = { user, headers: {}, ip: "127.0.0.1" };
  const snapshot = { account: { id: 1, name: "Cuenta ficticia" } };
  const sql = async (text, args = []) => (await local.pool.query(text, args))[0];
  const saveMemory = (memory) => sql("UPDATE customer_intelligence_chat_sessions SET context_json=? WHERE id=1", [JSON.stringify({ outcomeMemory: memory })]);
  const prepare = async (code = "contact_attempt_pending", changes = [], previous) => {
    const name = getLeadCallOutcomeCatalogResponse().substatuses.find((item) => item.code === code).name;
    const spec = { mode: previous ? "continue" : "start", leadReference: "105", resultReference: name,
      selectionTarget: "none", position: 0, changes, evidence: `105 ${name} ${changes.map((item) => item.evidence).join(" ")}` };
    const result = await buildCustomerOutcomeResponse({ component: { object: "lead", scope: "single", outcomeSpec: spec },
      movement: "new_request", question: spec.evidence, snapshot, previous, timeZone: local.timeZone,
      readOutcomes: (accountId) => readCustomerOutcomes({ user, accountId }) });
    await saveMemory(result.outcomeMemory);
    return result;
  };
  const persist = async (operation) => (await persistCoachOperations({ userId: 7, sessionId: session.id,
    sourceJobId: null, originalIntent: "Prueba A07 aislada", operations: [operation] }))[0];
  const review = (saved, actor = user) => reviewControlledCoachOperation({ user: actor, operationId: saved.id, version: saved.version });
  const execute = (saved, key = `same-call-${saved.id}`, actor = user) => executeControlledCoachOperation({
    req: { ...req, user: actor }, operationId: saved.id, version: saved.version,
    idempotencyKey: key, validateLeadOutcome: validateLeadCallOutcomeForCoach,
  });
  const counts = async () => (await sql(`SELECT (SELECT COUNT(*) FROM interaction_lead_outcome_events) AS outcomes,
    (SELECT COUNT(*) FROM audit_log) AS audits,(SELECT COUNT(*) FROM coach_operation_events WHERE event_type='completed') AS completed`))[0];
  beforeAll(async () => {
    const options = { user: "root", socketPath: process.env.G06_MYSQL_TEST_SOCKET, timezone: "Z" };
    admin = await mysql.createConnection(options);
    await admin.query(`CREATE DATABASE ${database}`);
    local.pool = mysql.createPool({ ...options, database, connectionLimit: 5 });
    await sql("CREATE TABLE users(id BIGINT UNSIGNED PRIMARY KEY)");
    await sql("INSERT INTO users VALUES(7)");
    await sql(`CREATE TABLE audit_log(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,entity_id BIGINT UNSIGNED,
      module VARCHAR(60),action VARCHAR(100),entity_type VARCHAR(60),status VARCHAR(20),detail TEXT,changed_fields JSON,
      performed_by_user_id BIGINT,performed_by_name VARCHAR(180),performed_by_email VARCHAR(190),
      ip_address VARCHAR(64),user_agent VARCHAR(500),created_at DATETIME(3))`);
    await sql("CREATE TABLE accounts(id BIGINT PRIMARY KEY,name VARCHAR(180),activation_status_id BIGINT)");
    await sql("CREATE TABLE account_activation_statuses(id BIGINT PRIMARY KEY,code VARCHAR(30))");
    await sql("INSERT INTO account_activation_statuses VALUES(1,'activada'),(2,'desactivada')");
    await sql("INSERT INTO accounts VALUES(1,'Cuenta ficticia',1)");
    await sql("CREATE TABLE account_owners(account_id BIGINT,user_id BIGINT)");
    await sql("INSERT INTO account_owners VALUES(1,7)");
    await sql(`CREATE TABLE interactions(id BIGINT PRIMARY KEY,title VARCHAR(255),account_id BIGINT,seller_user_id BIGINT,created_by BIGINT,
      landing_submission_id BIGINT,analysis_status VARCHAR(40),resolved_at DATETIME(3),disqualification_reason TEXT,
      lead_substatus_code VARCHAR(80),lead_reason_code VARCHAR(80),lead_required_action_code VARCHAR(80),
      lead_commercial_comment TEXT,lead_next_action_due_at DATETIME(3),lead_referred_contact_name VARCHAR(255),
      lead_referred_area_name VARCHAR(255),updated_by BIGINT,updated_at DATETIME(3))`);
    await sql("INSERT INTO interactions(id,title,account_id,seller_user_id,created_by,analysis_status) VALUES(105,'Lead ficticio',1,7,7,'created')");
    await sql("CREATE TABLE landing_submissions(id BIGINT PRIMARY KEY,sent_to_leads_by BIGINT)");
    await sql("CREATE TABLE landing_submission_crm_links(submission_id BIGINT,lead_id BIGINT)");
    await sql(`CREATE TABLE interaction_lead_outcome_events(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,public_id VARCHAR(64),interaction_id BIGINT,
      event_type VARCHAR(40),from_status_code VARCHAR(40),to_status_code VARCHAR(40),substatus_code VARCHAR(80),reason_code VARCHAR(80),
      required_action_code VARCHAR(80),commercial_comment TEXT,next_action_due_at DATETIME(3),referred_contact_name VARCHAR(255),
      referred_area_name VARCHAR(255),transition_rule_json JSON,created_by BIGINT,effective_at DATETIME(3),created_at DATETIME(3),invalidated_at DATETIME(3))`);
    await sql("CREATE TABLE customer_intelligence_chat_sessions(id BIGINT PRIMARY KEY,requested_by_user_id BIGINT,account_id BIGINT,context_json JSON)");
    await sql("INSERT INTO customer_intelligence_chat_sessions VALUES(1,7,1,JSON_OBJECT())");
    await ensureCoachSchema();
    session = await createCoachSession(7, { accountId: 1 });
  });
  beforeEach(async () => {
    local.enabled = true; local.timeZone = "America/Mexico_City";
    await sql(`UPDATE interactions SET title='Lead ficticio',account_id=1,analysis_status='created',resolved_at=NULL,disqualification_reason=NULL,
      lead_substatus_code=NULL,lead_reason_code=NULL,lead_required_action_code=NULL,lead_commercial_comment=NULL,
      lead_next_action_due_at=NULL,lead_referred_contact_name=NULL,lead_referred_area_name=NULL WHERE id=105`);
    await sql("UPDATE accounts SET activation_status_id=1,name='Cuenta ficticia' WHERE id=1");
    await sql("DELETE FROM interaction_lead_outcome_events");
  });
  afterAll(async () => {
    if (local.pool) { await local.pool.end(); local.pool = null; }
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS ${database}`); await admin.end(); }
  });
  it("prepares and reviews without a domain write, then atomically saves one event, outcome, audit and completion", async () => {
    const initial = await counts();
    const proposal = await prepare();
    expect(proposal.operations).toHaveLength(1);
    expect(await checkCustomerOutcomeAccess(user, proposal.operations[0])).toBeNull();
    const saved = await persist(proposal.operations[0]);
    const reviewed = await review(saved);
    expect(await counts()).toEqual(initial);
    const completed = await execute(reviewed);
    expect(completed.status).toBe("completed");
    expect(await counts()).toEqual({ outcomes: initial.outcomes + 1, audits: initial.audits + 1, completed: initial.completed + 1 });
    expect(completed.result.after).toMatchObject({ analysis_status: "created", lead_substatus_code: "contact_attempt_pending" });
    const retry = await execute(reviewed);
    expect(retry.id).toBe(completed.id);
    expect(await counts()).toEqual({ outcomes: initial.outcomes + 1, audits: initial.audits + 1, completed: initial.completed + 1 });
    await expect(execute(reviewed, "different-key")).rejects.toMatchObject({ code: "COACH_OPERATION_NOT_READY" });
  });
  it("persists conditional referred names in domain, event and exact audit before/after", async () => {
    const proposal = await prepare("wrong_contact_identified", [{ field: "referredContactName", action: "set", value: "Ana Ficticia", evidence: "Ana Ficticia" }]);
    const completed = await execute(await review(await persist(proposal.operations[0])));
    expect(completed.result.before.lead_referred_contact_name).toBeNull();
    expect(completed.result.after.lead_referred_contact_name).toBe("Ana Ficticia");
    expect((await sql("SELECT referred_contact_name FROM interaction_lead_outcome_events"))[0].referred_contact_name).toBe("Ana Ficticia");
    const changes = (await sql("SELECT changed_fields FROM audit_log WHERE id=?", [completed.domainAuditId]))[0].changed_fields;
    expect(changes.lead_referred_contact_name).toEqual({ before: null, after: "Ana Ficticia" });
    await revertControlledCoachOperation({ req, operationId: completed.id });
    expect((await sql("SELECT lead_referred_contact_name FROM interactions WHERE id=105"))[0].lead_referred_contact_name).toBeNull();
  });
  it("records full resolved_at effect for terminal outcomes and reverts it exactly", async () => {
    const proposal = await prepare("disqualified_definitive", [{ field: "comment", action: "set", value: "No existe interés definitivo", evidence: "No existe interés definitivo" }]);
    if (!proposal.operations.length) {
      const response = await buildCustomerOutcomeResponse({ component: { scope: "single", outcomeSpec: {
        mode: "continue", leadReference: "", resultReference: "", selectionTarget: "result", position: 1,
        changes: [{ field: "comment", action: "set", value: "No existe interés definitivo", evidence: "No existe interés definitivo" }],
        evidence: "primer resultado: No existe interés definitivo",
      } }, movement: "continue", question: "primer resultado: No existe interés definitivo", snapshot, previous: proposal.outcomeMemory,
      timeZone: local.timeZone, readOutcomes: (accountId) => readCustomerOutcomes({ user, accountId }) });
      proposal.operations = response.operations; await saveMemory(response.outcomeMemory);
    }
    const completed = await execute(await review(await persist(proposal.operations[0])));
    expect(completed.result.after.analysis_status).toBe("lead_disqualified");
    expect(completed.result.after.resolved_at).toBeTruthy();
    await revertControlledCoachOperation({ req, operationId: completed.id });
    expect((await sql("SELECT analysis_status,resolved_at FROM interactions WHERE id=105"))[0]).toMatchObject({ analysis_status: "created", resolved_at: null });
  });
  it("deduplicates the draft across sessions, applies only higher revisions and invalidates review", async () => {
    const first = await prepare();
    const saved = await persist(first.operations[0]);
    await review(saved);
    const corrected = await prepare("contact_attempt_pending", [{ field: "comment", action: "set", value: "Nota corregida", evidence: "Nota corregida" }], first.outcomeMemory);
    const next = await persist(corrected.operations[0]);
    expect(next.id).toBe(saved.id);
    expect(next.reviewedAt).toBeNull();
    expect(next.pendingOperation.comment).toBe("Nota corregida");
    const old = await persist(first.operations[0]);
    expect(old.pendingOperation.outcomeRevision).toBe(next.pendingOperation.outcomeRevision);
    await expect(review(saved)).rejects.toMatchObject({ code: "COACH_OPERATION_VERSION_CONFLICT" });
  });
  it("does not allow direct PATCH changes to versioned data", async () => {
    const proposal = await prepare();
    const saved = await persist(proposal.operations[0]);
    expect((await updateCoachOperation(7, saved.id, { version: saved.version,
      pendingOperation: { ...saved.pendingOperation, comment: "Override" } })).outcome).toBe("invalid");
  });
  it.each(["analysis_status='lead_qualified'", "lead_commercial_comment='Cambio externo'", "title='Renombrado'", "account_id=2"])(
    "rejects domain changes between review and confirmation: %s", async (change) => {
      const proposal = await prepare();
      const reviewed = await review(await persist(proposal.operations[0]));
      const initial = await counts();
      await sql(`UPDATE interactions SET ${change} WHERE id=105`);
      await expect(execute(reviewed)).rejects.toMatchObject({ code: "COACH_OUTCOME_STALE" });
      expect(await counts()).toEqual(initial);
    });
  it.each(["policy", "permissions", "memory", "account", "timezone", "summary"])("revalidates %s at confirmation", async (change) => {
    const proposal = await prepare();
    const reviewed = await review(await persist(proposal.operations[0]));
    if (change === "policy") local.enabled = false;
    if (change === "memory") await saveMemory(null);
    if (change === "account") await sql("UPDATE accounts SET name='Cuenta renombrada' WHERE id=1");
    if (change === "timezone") local.timeZone = "America/New_York";
    if (change === "summary") await sql("UPDATE coach_session_operations SET pending_operation=JSON_SET(pending_operation,'$.outcomeSummary.proposed.result','Inventado') WHERE id=?", [reviewed.id]);
    const actor = change === "permissions" ? { ...user, permissionSet: new Set(["mi_coach.execute", "interacciones.update", "interacciones.read"]) } : user;
    await expect(execute(reviewed, "key", actor)).rejects.toHaveProperty("status");
  });
  it("blocks stale memory before review and requires review before execution", async () => {
    const proposal = await prepare();
    const saved = await persist(proposal.operations[0]);
    await expect(execute(saved)).rejects.toMatchObject({ code: "COACH_REVIEW_REQUIRED" });
    await saveMemory(null);
    await expect(review(saved)).rejects.toMatchObject({ code: "COACH_OUTCOME_STALE" });
  });
  it("does not permit an old payload with an incremented revision to bypass incomplete corrections", async () => {
    const first = await prepare("wrong_contact_identified", [{ field: "referredContactName", action: "set", value: "Ana", evidence: "Ana" }]);
    const next = await prepare("wrong_contact_identified",
      [{ field: "referredContactName", action: "remove", value: "", evidence: "quítala" }], first.outcomeMemory);
    expect(next.operations).toEqual([]);
    expect(next.outcomeMemory.proposalKey).toBe("");
    expect(await checkCustomerOutcomeAccess(user, { ...first.operations[0], outcomeRevision: next.outcomeMemory.revision }))
      .toMatchObject({ status: 409 });
  });
  it("allows an explicit new call with identical result but never reopens the old draft", async () => {
    const first = await prepare();
    const completed = await execute(await review(await persist(first.operations[0])));
    expect((await persist(first.operations[0])).status).toBe("completed");
    const second = await prepare();
    const next = await execute(await review(await persist(second.operations[0])), "new-call");
    expect(next.id).not.toBe(completed.id);
    expect(await sql("SELECT id FROM interaction_lead_outcome_events")).toHaveLength(2);
    await expect(revertControlledCoachOperation({ req, operationId: completed.id })).rejects.toMatchObject({ code: "COACH_REVERT_CONFLICT" });
  });
  it("rejects a new outside event even when domain values remain identical", async () => {
    const proposal = await prepare();
    const reviewed = await review(await persist(proposal.operations[0]));
    await sql("INSERT INTO interaction_lead_outcome_events(interaction_id,event_type) VALUES(105,'activity_update')");
    await expect(execute(reviewed)).rejects.toMatchObject({ code: "COACH_OUTCOME_STALE" });
  });
  it("rejects invalidation of the last observed event without a domain-field change", async () => {
    await sql("INSERT INTO interaction_lead_outcome_events(interaction_id,event_type) VALUES(105,'activity_update')");
    const proposal = await prepare();
    const reviewed = await review(await persist(proposal.operations[0]));
    await sql("UPDATE interaction_lead_outcome_events SET invalidated_at=NOW(3) WHERE interaction_id=105");
    await expect(execute(reviewed)).rejects.toMatchObject({ code: "COACH_OUTCOME_STALE" });
  });
  it.each(["audit", "completion"])("rolls back domain/event/audit/execution when %s fails", async (failure) => {
    const proposal = await prepare();
    const reviewed = await review(await persist(proposal.operations[0]));
    const initial = await counts();
    const table = failure === "audit" ? "audit_log" : "coach_operation_events";
    await sql(`CREATE TRIGGER a07_fail BEFORE INSERT ON ${table} FOR EACH ROW BEGIN
      ${failure === "completion" ? "IF NEW.event_type='completed' THEN" : ""}
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='A07 test rollback';
      ${failure === "completion" ? "END IF;" : ""} END`);
    try {
      await expect(execute(reviewed)).rejects.toThrow("A07 test rollback");
      expect(await counts()).toEqual(initial);
      expect((await sql("SELECT lead_substatus_code FROM interactions WHERE id=105"))[0].lead_substatus_code).toBeNull();
      expect((await sql("SELECT status FROM coach_session_operations WHERE id=?", [reviewed.id]))[0].status).toBe("ready");
    } finally { await sql("DROP TRIGGER a07_fail"); }
  });
  it("serializes duplicate confirmations into a single domain event", async () => {
    const proposal = await prepare();
    const reviewed = await review(await persist(proposal.operations[0]));
    const results = await Promise.all([execute(reviewed), execute(reviewed)]);
    expect(results.every((result) => result.status === "completed")).toBe(true);
    expect(await sql("SELECT id FROM interaction_lead_outcome_events")).toHaveLength(1);
  });
  it("saves dates as date-only commitments and supports existing datetime commitments in review", async () => {
    await sql("UPDATE interactions SET lead_next_action_due_at='2030-10-20 16:00:00' WHERE id=105");
    const proposal = await prepare("meeting_requested", [{ field: "dueDateText", action: "set", value: "2030-10-23", evidence: "2030-10-23" }]);
    expect(proposal.operations[0].outcomeSummary.currentDueDate).toBe("2030-10-20");
    const completed = await execute(await review(await persist(proposal.operations[0])));
    expect(completed.result.after.lead_next_action_due_at).toBeTruthy();
    expect((await sql("SELECT DATE_FORMAT(lead_next_action_due_at,'%Y-%m-%d %H:%i:%s') AS due FROM interactions WHERE id=105"))[0].due).toBe("2030-10-23 00:00:00");
    await revertControlledCoachOperation({ req, operationId: completed.id });
    expect((await sql("SELECT DATE_FORMAT(lead_next_action_due_at,'%Y-%m-%d %H:%i:%s') AS due FROM interactions WHERE id=105"))[0].due).toBe("2030-10-20 16:00:00");
  });
  it("persists conditional area and comment without materializing records", async () => {
    const proposal = await prepare("account_has_other_potential", [
      { field: "comment", action: "set", value: "Explorar otra área", evidence: "Explorar otra área" },
      { field: "referredAreaName", action: "set", value: "Compras", evidence: "Compras" },
    ]);
    const completed = await execute(await review(await persist(proposal.operations[0])));
    expect(completed.result.after).toMatchObject({ lead_referred_area_name: "Compras", lead_commercial_comment: "Explorar otra área" });
    expect(await sql("SELECT id FROM interactions")).toHaveLength(1);
    expect((await sql("SELECT referred_area_name FROM interaction_lead_outcome_events"))[0].referred_area_name).toBe("Compras");
  });
  it.each(["lead_qualified", "lead_disqualified"])("blocks finalized state %s at review", async (status) => {
    const proposal = await prepare();
    const saved = await persist(proposal.operations[0]);
    await sql("UPDATE interactions SET analysis_status=? WHERE id=105", [status]);
    await expect(review(saved)).rejects.toMatchObject({ code: "COACH_OUTCOME_STALE" });
  });
  it("detects a relative-date rollover before confirmation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2030-10-17T12:00:00Z"));
      const proposal = await prepare("meeting_requested", [{ field: "dueDateText", action: "set", value: "mañana", evidence: "mañana" }]);
      const reviewed = await review(await persist(proposal.operations[0]));
      vi.setSystemTime(new Date("2030-10-18T12:00:00Z"));
      await expect(execute(reviewed)).rejects.toMatchObject({ code: "COACH_OUTCOME_STALE" });
    } finally { vi.useRealTimers(); }
  });
  it("blocks deactivated accounts and revoked read scopes", async () => {
    await sql("UPDATE accounts SET activation_status_id=2 WHERE id=1");
    await expect(readCustomerOutcomes({ user, accountId: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(readCustomerOutcomes({ user: { ...user, permissionSet: new Set(["interacciones.read"]) }, accountId: 1 })).rejects.toMatchObject({ status: 403 });
  });
  it("allows read_all but never returns leads from another fixed account", async () => {
    const reader = { ...user, permissionSet: new Set(["cuentas.read_all", "interacciones.read_all"]) };
    await sql("INSERT INTO interactions(id,title,account_id,analysis_status) VALUES(999,'Privado',2,'created')");
    try {
      expect((await readCustomerOutcomes({ user: reader, accountId: 1 })).leads.map((lead) => lead.id)).toEqual([105]);
    } finally { await sql("DELETE FROM interactions WHERE id=999"); }
  });
});
