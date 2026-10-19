import { query, withTransaction } from "../db.js";
import { COMMERCIAL_AUDIT_ACTIONS, HISTORY_FIELDS, recordOpportunityAuditState } from "../opportunity-audit.js";

export { HISTORY_FIELDS };
export const OPPORTUNITY_HISTORY_DDL = [
  `CREATE TABLE IF NOT EXISTS opportunity_audit_history_control (
    id TINYINT PRIMARY KEY, installed_at_utc DATETIME(3) NOT NULL,
    baseline_completed_at_utc DATETIME(3) NULL
  ) ENGINE=InnoDB`,
];

export async function installOpportunityCommercialHistory({ transact = withTransaction } = {}) {
  return transact(async (connection) => {
    const [lock] = await connection.query("SELECT GET_LOCK('opportunity_audit_history_install', 30) AS acquired");
    if (Number(lock[0]?.acquired) !== 1) throw new Error("No se pudo obtener el bloqueo de instalacion de historia comercial.");
    try {
      for (const sql of OPPORTUNITY_HISTORY_DDL) await connection.query(sql);
      await connection.beginTransaction();
      const [opportunities] = await connection.query("SELECT * FROM opportunities ORDER BY id FOR UPDATE");
      const [existing] = await connection.query(`SELECT DISTINCT entity_id FROM audit_log
        WHERE entity_type='opportunity' AND status='success'
        AND action IN ('commercial_history_baseline','commercial_history_created')`);
      const captured = new Set(existing.map((row) => Number(row.entity_id)));
      for (const opportunity of opportunities) {
        if (captured.has(Number(opportunity.id))) continue;
        await recordOpportunityAuditState({
          connection, opportunityId: opportunity.id, kind: "baseline", before: null, after: opportunity,
        });
      }
      await connection.query(`INSERT INTO opportunity_audit_history_control(id,installed_at_utc,baseline_completed_at_utc)
        VALUES(1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE baseline_completed_at_utc=COALESCE(baseline_completed_at_utc,UTC_TIMESTAMP(3))`);
      const [counts] = await connection.query(`SELECT action AS event_kind,COUNT(*) AS count FROM audit_log
        WHERE entity_type='opportunity' AND action IN (${COMMERCIAL_AUDIT_ACTIONS.map(() => "?").join(",")})
        GROUP BY action`, COMMERCIAL_AUDIT_ACTIONS);
      return counts;
    } finally {
      await connection.query("SELECT RELEASE_LOCK('opportunity_audit_history_install')");
    }
  });
}

function auditEvent(row) {
  const fields = typeof row.changed_fields === "string" ? JSON.parse(row.changed_fields) : row.changed_fields;
  if (!COMMERCIAL_AUDIT_ACTIONS.includes(row.action)) return {
    id: row.id, opportunity_id: row.entity_id, event_kind: "legacy", recorded_at_utc: row.created_at,
    before_state: { recorded_at: row.created_at, action: row.action }, after_state: fields,
  };
  const history = fields?.commercial_history?.after;
  const validState = (state) => state && typeof state === "object" && !Array.isArray(state) &&
    HISTORY_FIELDS.every((field) => Object.hasOwn(state, field));
  if (history?.version !== 1 || `commercial_history_${history.kind}` !== row.action ||
      !Number.isFinite(Date.parse(history.recorded_at_utc)) ||
      (history.kind === "created" || history.kind === "baseline" ? !validState(history.after_state) || history.before_state !== null :
        !validState(history.before_state) || (history.kind === "changed" ? !validState(history.after_state) : history.after_state !== null))) {
    throw Object.assign(new Error("Un registro de auditoria comercial no cumple el formato verificable."), { code: "HISTORY_INVALID_AUDIT" });
  }
  return {
    id: row.id, opportunity_id: row.entity_id, event_kind: history.kind,
    recorded_at_utc: history.recorded_at_utc, before_state: history.before_state, after_state: history.after_state,
  };
}

function authorizedOpportunityScope({ user, accountId, governance }) {
  const permissions = user.permissionSet;
  if (!permissions?.has("cuentas.read") || !permissions.has("oportunidades.read")) {
    throw Object.assign(new Error("Sin permiso base de cuentas y oportunidades para historia comercial."), { code: "HISTORY_ACCESS_DENIED" });
  }
  const accountScope = permissions.has("cuentas.read_all") ? "" :
    "AND EXISTS(SELECT 1 FROM account_owners a WHERE a.account_id=o.account_id AND a.user_id=?)";
  const opportunityScope = permissions.has("oportunidades.read_all") ? "" :
    "AND (o.created_by=? OR o.seller_user_id=? OR EXISTS(SELECT 1 FROM account_owners a WHERE a.account_id=o.account_id AND a.user_id=?))";
  const params = [accountId, ...(!permissions.has("cuentas.read_all") ? [user.id] : []),
    ...(!permissions.has("oportunidades.read_all") ? [user.id, user.id, user.id] : [])];
  const statuses = ["en_proceso", ...(governance.includeWonOpportunities ? ["ganada"] : []),
    ...(governance.includeLostOpportunities ? ["perdida"] : []), ...(governance.includeCancelledOpportunities ? ["anulada"] : [])];
  const scope = `FROM opportunities o INNER JOIN opportunity_commercial_statuses s ON s.id=o.commercial_status_id
    WHERE o.account_id=? ${accountScope} ${opportunityScope} AND s.code IN (${statuses.map(() => "?").join(",")})`;
  return { scope, params: [...params, ...statuses] };
}

export async function readOpportunityScenarioBasis({ user, accountId, governance, signal, transact = withTransaction }) {
  const { scope, params } = authorizedOpportunityScope({ user, accountId, governance });
  return transact(async (connection) => {
    signal?.throwIfAborted();
    const [opportunities] = await connection.query({
      sql: `SELECT o.id,o.name,o.account_id,o.amount_usd,o.close_date,s.code AS commercial_status_code,
        a.code AS activation_status_code,st.code AS stage_code ${scope.replace("WHERE o.account_id", "INNER JOIN opportunity_activation_statuses a ON a.id=o.activation_status_id INNER JOIN opportunity_sales_stages st ON st.id=o.sales_stage_id WHERE o.account_id")}
        ORDER BY o.id LIMIT 10001`, timeout: 45000,
    }, params);
    signal?.throwIfAborted();
    if (opportunities.length > 10000) throw Object.assign(new Error("El escenario supera 10.000 oportunidades; no se simula un total truncado."), { code: "SCENARIO_LIMIT" });
    return { opportunities, complete: true };
  });
}

export async function readOpportunityCommercialHistory({ user, accountId, governance, execute = query, signal, transact = withTransaction }) {
  const { scope, params } = authorizedOpportunityScope({ user, accountId, governance });
  return transact(async (connection) => {
    const run = async (sql, args = []) => {
      signal?.throwIfAborted();
      const result = execute === query ? (await connection.query({ sql, timeout: 45000 }, args))[0] : await execute(sql, args);
      signal?.throwIfAborted();
      return result;
    };
    const control = await run("SELECT installed_at_utc,baseline_completed_at_utc FROM opportunity_audit_history_control WHERE id=1");
    if (!control[0]?.baseline_completed_at_utc) throw Object.assign(new Error("La historia comercial de auditoria aun no tiene estado base verificado."), { code: "HISTORY_NOT_READY" });
    const opportunities = await run(`SELECT o.* ${scope} ORDER BY o.id LIMIT 10001`, params);
    if (opportunities.length > 10000) throw Object.assign(new Error("El conjunto historico supera 10.000 oportunidades; reduce el alcance."), { code: "HISTORY_LIMIT" });
    const audits = opportunities.length ? await run(`SELECT a.id,a.entity_id,a.action,a.created_at,a.changed_fields FROM audit_log a
      INNER JOIN (SELECT o.id ${scope}) authorized ON authorized.id=a.entity_id
      WHERE a.entity_type='opportunity' AND a.status='success' AND a.changed_fields IS NOT NULL
      ORDER BY a.entity_id,a.id LIMIT 100001`, params) : [];
    if (audits.length > 100000) throw Object.assign(new Error("La historia supera 100.000 eventos; no se devuelve un total truncado."), { code: "HISTORY_LIMIT" });
    const events = audits.map(auditEvent);
    const catalogs = await run(`SELECT 'stage' AS catalog,id,code,name,stage_order AS display_order FROM opportunity_sales_stages
      UNION ALL SELECT 'commercial',id,code,name,NULL FROM opportunity_commercial_statuses
      UNION ALL SELECT 'activation',id,code,name,NULL FROM opportunity_activation_statuses`);
    const entries = (kind) => catalogs.filter((item) => item.catalog === kind).map(({ catalog, ...item }) => item);
    return {
      opportunities, events, stages: entries("stage"), commercialStatuses: entries("commercial"),
      activationStatuses: entries("activation"), control: control[0], complete: true,
    };
  });
}
