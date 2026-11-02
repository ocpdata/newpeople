// Reference facts for the Coach "seller needs" bank. They answer the questions a seller asks about their own performance
// (quota, rank, agenda, closed deals, trend, commission) and come from the CRM tables and from the Ritmo comercial
// endpoint, never from Coach's own tools. The league payload is the same one the Ritmo comercial screen shows.

const OPEN = "cs.code = 'en_proceso' AND aas.code = 'activada'";
const FROM_OPPORTUNITIES = `FROM opportunities o
  JOIN accounts a ON a.id = o.account_id
  JOIN opportunity_commercial_statuses cs ON cs.id = o.commercial_status_id
  JOIN opportunity_activation_statuses aas ON aas.id = o.activation_status_id
  LEFT JOIN opportunity_sales_stages st ON st.id = o.sales_stage_id`;

const round = (value, digits = 1) => Number(Number(value || 0).toFixed(digits));
const last = (list) => (Array.isArray(list) && list.length ? Number(list[list.length - 1] || 0) : 0);
const previous = (list) => (Array.isArray(list) && list.length > 1 ? Number(list[list.length - 2] || 0) : 0);

export async function loadSellerNeedsFacts({ run, league, sellerId }) {
  const rows = Array.isArray(league?.leaderboard) ? league.leaderboard : [];
  const me = rows.find((row) => Number(row.sellerUserId) === Number(sellerId));
  if (!me) throw new Error(`El vendedor ${sellerId} no aparece en Ritmo comercial.`);
  const quarter = league.quarterContext.current;
  const scores = { closing: me.scoreClosing, build: me.scoreBuild, discipline: me.scoreDiscipline };
  const lowest = Object.entries(scores).sort((left, right) => Number(left[1]) - Number(right[1]))[0];
  const gap = Number(me.gapAmountUsd || 0);

  const [focus] = await run(
    `SELECT o.name, a.name AS account, o.amount_usd AS amountUsd, st.name AS stage ${FROM_OPPORTUNITIES}
     WHERE ${OPEN} AND o.seller_user_id = ? ORDER BY o.amount_usd DESC, o.id LIMIT 1`,
    [sellerId],
  );
  // Ritmo comercial and Coach do not count "open" the same way, so the reference keeps both.
  const openList = await run(
    `SELECT o.name, a.name AS account, o.amount_usd AS amountUsd, st.name AS stage, o.close_date AS closeDate,
            EXISTS (SELECT 1 FROM opportunity_workspace_actions w WHERE w.opportunity_id = o.id AND w.status = 'pending') AS hasPendingAction
     ${FROM_OPPORTUNITIES} WHERE ${OPEN} AND o.seller_user_id = ? ORDER BY o.amount_usd DESC`,
    [sellerId],
  );
  const closed = await run(
    `SELECT cs.code AS status, COUNT(*) AS count, AVG(DATEDIFF(o.commercial_closed_at, o.created_at)) AS cycleDays
     FROM opportunities o JOIN opportunity_commercial_statuses cs ON cs.id = o.commercial_status_id
     WHERE o.seller_user_id = ? GROUP BY cs.code`,
    [sellerId],
  );
  const count = (code) => Number(closed.find((row) => row.status === code)?.count || 0);
  const lostReasons = await run(
    `SELECT LEFT(o.commercial_close_reason, 160) AS reason FROM opportunities o
     JOIN opportunity_commercial_statuses cs ON cs.id = o.commercial_status_id
     WHERE o.seller_user_id = ? AND cs.code = 'perdida' AND o.commercial_close_reason IS NOT NULL ORDER BY o.commercial_closed_at DESC LIMIT 7`,
    [sellerId],
  );
  const pending = await run(
    `SELECT a.title, a.due_date AS dueDate, o.name AS opportunity FROM opportunity_workspace_actions a
     JOIN opportunities o ON o.id = a.opportunity_id
     WHERE o.seller_user_id = ? AND a.status = 'pending' ORDER BY a.due_date IS NULL, a.due_date LIMIT 6`,
    [sellerId],
  );
  const [created] = await run(
    `SELECT SUM(o.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS thisMonth,
            SUM(o.created_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH)
                AND o.created_at < DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS lastMonth
     FROM opportunities o WHERE o.seller_user_id = ?`,
    [sellerId],
  );
  const [commission] = await run(
    `SELECT product_commission_pct AS productPct, service_commission_pct AS servicePct, renewal_commission_pct AS renewalPct
     FROM commercial_planning_commission_configs c JOIN commercial_planning_periods p ON p.id = c.period_id
     WHERE c.seller_user_id = ? AND p.plan_year = ? AND p.plan_quarter = ? LIMIT 1`,
    [sellerId, quarter.year, quarter.quarter],
  );
  const decided = count("ganada") + count("perdida");
  return {
    definition: "Datos del vendedor que pregunta. Cuota, avance, puntuación, ranking, vencidos y sin siguiente paso son los de Ritmo comercial del trimestre actual. Montos en USD.",
    seller: { name: me.sellerUserName },
    quarter: { label: quarter.label, daysElapsed: quarter.daysElapsed, daysRemaining: quarter.daysRemaining, weeksRemaining: quarter.weeksRemaining },
    me: {
      quotaUsd: Number(me.quotaAmountUsd || 0), wonUsd: Number(me.wonAmountUsd || 0), attainmentPct: Number(me.attainmentPct || 0),
      gapUsd: gap, weeklyNeededUsd: Math.round(gap / Math.max(Number(quarter.weeksRemaining) || 1, 1)),
      rank: me.rankPosition, score: round(me.scoreTotal), scoreClosing: round(scores.closing), scoreBuild: round(scores.build),
      scoreDiscipline: round(scores.discipline), lowestScoreComponent: lowest[0], rankGapToNext: round(me.rankGapToNext),
      overdue: Number(me.overdueCount || 0), noNextStep: Number(me.noNextStepCount || 0), openCount: Number(me.openOpportunities || 0),
      pipelineWeightedUsd: Math.round(Number(me.pipelineWeightedUsd || 0)), coverageRatio: round(me.coverageRatio, 2),
      opportunitiesCreatedLastWeek: last(me.opportunitiesPerWeekWeeklyCounts), opportunitiesCreatedWeekBefore: previous(me.opportunitiesPerWeekWeeklyCounts),
      leadsLastWeek: last(me.leadsPerWeekWeeklyCounts), leadsWeekBefore: previous(me.leadsPerWeekWeeklyCounts),
    },
    openAllStages: {
      count: openList.length,
      amountUsd: Math.round(openList.reduce((sum, row) => sum + Number(row.amountUsd || 0), 0)),
      withoutPendingAction: openList.filter((row) => !Number(row.hasPendingAction)).length,
      opportunities: openList.map((row) => ({ name: row.name, account: row.account, amountUsd: Number(row.amountUsd), stage: row.stage, closeDate: row.closeDate ? String(row.closeDate).slice(0, 10) : null })),
    },
    team: {
      size: rows.length,
      ranking: rows.map((row) => ({ rank: row.rankPosition, seller: row.sellerUserName, score: round(row.scoreTotal) })).sort((a, b) => a.rank - b.rank),
    },
    closed: {
      won: count("ganada"), lost: count("perdida"), cancelled: count("anulada"), decided,
      winRatePct: decided ? round((count("ganada") / decided) * 100) : 0,
      avgCycleDays: round(closed.find((row) => row.status === "ganada")?.cycleDays, 0),
      lostReasons: lostReasons.map((row) => row.reason),
    },
    agenda: { pendingActions: pending.map((row) => ({ title: row.title, dueDate: row.dueDate ? String(row.dueDate).slice(0, 10) : null, opportunity: row.opportunity })) },
    created: { thisMonth: Number(created?.thisMonth || 0), lastMonth: Number(created?.lastMonth || 0) },
    commission: commission
      ? { productPct: Number(commission.productPct), servicePct: Number(commission.servicePct), renewalPct: Number(commission.renewalPct) }
      : null,
    focus: focus ? { name: focus.name, account: focus.account, stage: focus.stage, amountUsd: Number(focus.amountUsd) } : null,
  };
}
