import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { installOpportunityCommercialHistory, readOpportunityCommercialHistory, readOpportunityScenarioBasis } from "../src/commercial-intelligence/opportunity-history-store.js";
import { buildCustomerScenarioResponse, resolveCustomerScenarioRequest } from "../src/commercial-intelligence/customer-scenarios.js";
import { buildCustomerTrendResponse, resolveCustomerTrendRequest } from "../src/commercial-intelligence/customer-trends.js";
import { mutateAuditedOpportunity } from "../src/opportunity-audit.js";
import { prepareCustomerCommercialHistory } from "../src/commercial-intelligence/customer-trends.js";

describe.skipIf(!process.env.G06_MYSQL_TEST_SOCKET)("G06 isolated MySQL transactional acceptance", () => {
  let connection;
  const database = `newpeople_g06_test_${process.pid}`;
  const transact = async (work) => {
    await connection.beginTransaction();
    try { const result = await work(connection); await connection.commit(); return result; }
    catch (error) { await connection.rollback(); throw error; }
  };
  const sql = async (text, args = []) => (await connection.query(text, args))[0];
  beforeAll(async () => {
    connection = await mysql.createConnection({ user: "root", socketPath: process.env.G06_MYSQL_TEST_SOCKET });
    await sql(`CREATE DATABASE ${database}`);
    await sql(`USE ${database}`);
    await sql(`CREATE TABLE opportunities (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, name VARCHAR(180), account_id BIGINT,
      amount_usd DECIMAL(15,2), sales_stage_id BIGINT, commercial_status_id BIGINT, activation_status_id BIGINT,
      close_date DATE, commercial_closed_at DATETIME(3), seller_user_id BIGINT, presales_user_id BIGINT,
      created_by BIGINT, created_at DATETIME(3)
    ) ENGINE=InnoDB`);
    await sql(`CREATE TABLE audit_log(
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,entity_id BIGINT,entity_type VARCHAR(60),status VARCHAR(20),
      module VARCHAR(60),action VARCHAR(60),detail VARCHAR(255),created_at DATETIME(3),changed_fields JSON,
      performed_by_user_id BIGINT,performed_by_name VARCHAR(180),performed_by_email VARCHAR(255),
      ip_address VARCHAR(64),user_agent VARCHAR(500)
    ) ENGINE=InnoDB`);
    await sql(`CREATE TABLE account_owners(account_id BIGINT,user_id BIGINT)`);
    await sql(`CREATE TABLE opportunity_commercial_statuses(id BIGINT PRIMARY KEY,code VARCHAR(30),name VARCHAR(100))`);
    await sql(`CREATE TABLE opportunity_activation_statuses(id BIGINT PRIMARY KEY,code VARCHAR(30),name VARCHAR(100))`);
    await sql(`CREATE TABLE opportunity_sales_stages(id BIGINT PRIMARY KEY,code VARCHAR(30),name VARCHAR(100),stage_order INT)`);
    await sql(`INSERT INTO opportunity_commercial_statuses VALUES(1,'en_proceso','En proceso'),(2,'ganada','Ganada')`);
    await sql(`INSERT INTO opportunity_activation_statuses VALUES(1,'activada','Activada')`);
    await sql(`INSERT INTO opportunity_sales_stages VALUES(1,'inicio','Inicio',10),(2,'evaluacion','Evaluación',20)`);
    await sql(`INSERT INTO account_owners VALUES(1,7)`);
    await sql(`INSERT INTO opportunities VALUES(1,'Preexistente',1,500,1,1,1,'2027-01-31',NULL,7,NULL,7,'2025-01-01 10:00:00')`);
    await sql(`INSERT INTO audit_log(id,entity_id,entity_type,status,action,created_at,changed_fields)
      VALUES(1,1,'opportunity','success','updated','2025-02-01 10:00:00',JSON_OBJECT('amount_usd',JSON_OBJECT('before',100,'after',500)))`);
  });
  afterAll(async () => {
    if (connection) {
      await sql(`DROP DATABASE ${database}`);
      await connection.end();
    }
  });
  const mutate = (opportunityId, statement, args = []) => transact((conn) =>
    mutateAuditedOpportunity({ connection: conn, opportunityId, actor: { id: 7, full_name: "Vendedor" } }, statement, args));
  it("G07 reads current data before G06 installation and simulates without opportunity or audit writes", async () => {
    const before = await sql("SELECT * FROM opportunities"), audits = await sql("SELECT * FROM audit_log");
    const user = { id: 7, permissionSet: new Set(["cuentas.read", "oportunidades.read"]) };
    const data = await readOpportunityScenarioBasis({ user, accountId: 1, governance: {}, transact });
    expect(data.opportunities).toHaveLength(1);
    expect(data.opportunities[0].activation_status_code).toBe("activada");
    expect(data.opportunities[0].stage_code).toBe("inicio");
    const request = resolveCustomerScenarioRequest({
      component: { object: "account", reference: "", scenarioSpec: {
        set: "account", references: [], alternatives: [{ name: "A", assumptions: [], changes: [
          { kind: "amount_percent", value: -10, unit: "percent", date: "", status: "en_proceso", references: [] },
          { kind: "close_shift", value: 1, unit: "months", date: "", status: "en_proceso", references: [] },
        ] }],
      } }, snapshot: { account: { id: 1 } }, context: { accountId: 1 }, movement: "new_request", now: new Date(),
    });
    const result = buildCustomerScenarioResponse({ request, data });
    expect(result.scenarioMetadata.tables[0].rows[0].slice(2, 7)).toEqual([
      "USD 500.00", "USD 450.00", "-USD 50.00", "2027-01-31", "2027-02-28",
    ]);
    expect(await readOpportunityScenarioBasis({ user: { ...user, id: 999 }, accountId: 1, governance: {}, transact }))
      .toMatchObject({ opportunities: [] });
    expect(await sql("SELECT * FROM opportunities")).toEqual(before);
    expect(await sql("SELECT * FROM audit_log")).toEqual(audits);
  });
  it("records baseline in audit, preserves old audit and is idempotent without triggers", async () => {
    await installOpportunityCommercialHistory({ transact });
    const first = await sql("SELECT id,action FROM audit_log ORDER BY id");
    expect(first.map((item) => item.action)).toEqual(["updated", "commercial_history_baseline"]);
    await installOpportunityCommercialHistory({ transact });
    expect(await sql("SELECT id FROM audit_log ORDER BY id")).toEqual(first.map(({ id }) => ({ id })));
    expect(await sql("SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()")).toHaveLength(0);
  });
  it("captures creation, changes and before/after values atomically", async () => {
    await mutate(null, `INSERT INTO opportunities VALUES(2,'Nueva',1,100,1,1,1,'2027-01-31',NULL,7,NULL,7,NOW(3))`);
    await mutate(2, "UPDATE opportunities SET amount_usd=700,sales_stage_id=2 WHERE id=2");
    const audits = await sql("SELECT action,changed_fields,performed_by_user_id FROM audit_log WHERE entity_id=2 ORDER BY id");
    expect(audits.map((item) => item.action)).toEqual(["commercial_history_created", "commercial_history_changed"]);
    expect(Number(audits[1].changed_fields.commercial_history.after.before_state.amount_usd)).toBe(100);
    expect(Number(audits[1].changed_fields.commercial_history.after.after_state.amount_usd)).toBe(700);
    expect(audits[1].performed_by_user_id).toBe(7);
    await connection.beginTransaction();
    await mutateAuditedOpportunity({ connection, opportunityId: 2 }, "UPDATE opportunities SET amount_usd=800 WHERE id=2");
    expect((await sql("SELECT COUNT(*) AS total FROM audit_log WHERE entity_id=2"))[0].total).toBe(3);
    await connection.rollback();
    expect(Number((await sql("SELECT amount_usd FROM opportunities WHERE id=2"))[0].amount_usd)).toBe(700);
    expect((await sql("SELECT COUNT(*) AS total FROM audit_log WHERE entity_id=2"))[0].total).toBe(2);
  });
  it("an audit insertion failure rolls back the opportunity update", async () => {
    await sql(`ALTER TABLE audit_log ADD CONSTRAINT g06_test_audit_failure
      CHECK (CAST(JSON_UNQUOTE(JSON_EXTRACT(changed_fields,'$.commercial_history.after.after_state.amount_usd')) AS DECIMAL(15,2)) <> 9999)`);
    await expect(mutate(2, "UPDATE opportunities SET amount_usd=9999 WHERE id=2")).rejects.toThrow();
    expect(Number((await sql("SELECT amount_usd FROM opportunities WHERE id=2"))[0].amount_usd)).toBe(700);
    expect((await sql("SELECT COUNT(*) AS total FROM audit_log WHERE entity_id=2"))[0].total).toBe(2);
    await sql("ALTER TABLE audit_log DROP CHECK g06_test_audit_failure");
  });
  it("reads the full authorized source and produces verified current cuts", async () => {
    const data = await readOpportunityCommercialHistory({
      user: { id: 7, permissionSet: new Set(["cuentas.read", "oportunidades.read"]) },
      accountId: 1, governance: { includeWonOpportunities: true }, transact,
    });
    expect(data.opportunities).toHaveLength(2);
    expect(data.events).toHaveLength(4);
    const now = new Date(), day = now.toISOString().slice(0, 10);
    const request = resolveCustomerTrendRequest({
      component: { object: "account", reference: "", trendSpec: { metric: "pipeline", period: { mode: "absolute", startDate: day, endDate: day } } },
      context: { accountId: 1 }, snapshot: { account: { id: 1, name: "Cuenta" } }, movement: "new_request", now, timezone: "UTC",
    });
    const result = buildCustomerTrendResponse({ request, data });
    expect(result.trendMetadata.table.rows[0][2]).toBe("2");
    expect(result.trendMetadata.table.rows[0][3]).toBe("USD 1,200.00");
  });
  it("serializes concurrent application changes into a continuous audit chain", async () => {
    const other = await mysql.createConnection({ user: "root", socketPath: process.env.G06_MYSQL_TEST_SOCKET, database });
    try {
      await connection.beginTransaction();
      await mutateAuditedOpportunity({ connection, opportunityId: 2 }, "UPDATE opportunities SET amount_usd=800 WHERE id=2");
      await other.beginTransaction();
      const next = mutateAuditedOpportunity({ connection: other, opportunityId: 2 }, "UPDATE opportunities SET amount_usd=900 WHERE id=2");
      await connection.commit();
      await next;
      await other.commit();
      const rows = await sql("SELECT changed_fields FROM audit_log WHERE entity_id=2 ORDER BY id DESC LIMIT 2");
      expect(Number(rows[0].changed_fields.commercial_history.after.before_state.amount_usd)).toBe(800);
      expect(Number(rows[0].changed_fields.commercial_history.after.after_state.amount_usd)).toBe(900);
      expect(Number(rows[1].changed_fields.commercial_history.after.before_state.amount_usd)).toBe(700);
    } finally {
      await connection.rollback();
      await other.rollback();
      await other.end();
    }
  });
  it("does not certify an unaudited direct SQL change", async () => {
    await sql("UPDATE opportunities SET amount_usd=901 WHERE id=2");
    const data = await readOpportunityCommercialHistory({
      user: { id: 7, permissionSet: new Set(["cuentas.read", "oportunidades.read"]) },
      accountId: 1, governance: {}, transact,
    });
    expect(prepareCustomerCommercialHistory(data).find((item) => item.opportunity.id === 2).continuous).toBe(false);
  });
});
