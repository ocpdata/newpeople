// Reference facts for the Coach live bank. They are computed straight from the CRM tables, never through Coach's own
// tools, so a retrieval bug in Coach cannot hide itself. "Open" means in process and activated, which is the default
// scope Coach documents for pipeline questions. The bank runs as a user with global scope, so no ownership filter applies.

const OPEN = "cs.code = 'en_proceso' AND aas.code = 'activada'";
const FROM_OPPORTUNITIES = `FROM opportunities o
  JOIN accounts a ON a.id = o.account_id
  JOIN opportunity_commercial_statuses cs ON cs.id = o.commercial_status_id
  JOIN opportunity_activation_statuses aas ON aas.id = o.activation_status_id
  LEFT JOIN opportunity_sales_stages st ON st.id = o.sales_stage_id`;

const money = (value) => Number(value || 0);

export async function loadCoachFacts(run) {
  const [totals] = await run(`SELECT COUNT(*) AS count, COALESCE(SUM(o.amount_usd), 0) AS amount ${FROM_OPPORTUNITIES} WHERE ${OPEN}`);
  const topAccounts = await run(
    `SELECT a.name, COUNT(*) AS openCount ${FROM_OPPORTUNITIES} WHERE ${OPEN} GROUP BY a.id, a.name ORDER BY openCount DESC, a.name LIMIT 3`,
  );
  const topOpportunities = await run(
    `SELECT o.id, o.name, a.name AS account, o.amount_usd AS amountUsd, st.name AS stage ${FROM_OPPORTUNITIES}
     WHERE ${OPEN} ORDER BY o.amount_usd DESC, o.id LIMIT 3`,
  );
  // Coach counts activated records by default, so the closed totals do too.
  const closed = await run(`SELECT cs.code AS status, COUNT(*) AS count ${FROM_OPPORTUNITIES} WHERE aas.code = 'activada' GROUP BY cs.code`);
  const closedCount = (code) => Number(closed.find((row) => row.status === code)?.count || 0);
  const named = (rows) => rows.map((row) => ({ ...row, amountUsd: row.amountUsd === undefined ? undefined : money(row.amountUsd) }));
  const opportunities = named(topOpportunities);
  return {
    definition: "Abiertas = comerciales en proceso y activadas; ganadas, perdidas y anuladas = también solo activadas. Montos en USD.",
    open: { count: Number(totals.count), amountUsd: money(totals.amount) },
    topAccounts: topAccounts.map((row) => ({ name: row.name, openCount: Number(row.openCount) })),
    topOpportunities: opportunities,
    focus: opportunities[0] || null,
    won: closedCount("ganada"),
    lost: closedCount("perdida"),
    cancelled: closedCount("anulada"),
  };
}

// Replaces {{path}} placeholders (for example {{focus.name}} or {{topAccounts.0.name}}) with the loaded facts.
export function renderFacts(template, facts) {
  return String(template ?? "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
    const value = path.split(".").reduce((current, key) => (current == null ? undefined : current[key]), facts);
    if (value === undefined || value === null) throw new Error(`El dato de referencia «${path}» no existe en la base.`);
    return typeof value === "number" ? value.toLocaleString("en-US") : String(value);
  });
}
