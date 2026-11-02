import { query } from "../db.js";

// Weekly photo of each seller's Ritmo comercial numbers, so Coach can say how quota, pipeline, score and rank
// moved. The values come from the same calculation the Ritmo comercial screen uses; nothing is recomputed here.

const SNAPSHOT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RETENTION_WEEKS = 104;

let schemaReady = null;
export function ensureSellerSnapshotSchema(run = query) {
  if (!schemaReady) {
    schemaReady = run(`CREATE TABLE IF NOT EXISTS seller_weekly_snapshots (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      week_start DATE NOT NULL,
      seller_user_id BIGINT UNSIGNED NOT NULL,
      seller_name VARCHAR(160) NULL,
      quarter_year SMALLINT NOT NULL,
      quarter_number TINYINT NOT NULL,
      quota_amount_usd DECIMAL(16,2) NOT NULL DEFAULT 0,
      won_amount_usd DECIMAL(16,2) NOT NULL DEFAULT 0,
      attainment_pct DECIMAL(7,2) NULL,
      gap_amount_usd DECIMAL(16,2) NOT NULL DEFAULT 0,
      open_pipeline_count INT NOT NULL DEFAULT 0,
      open_pipeline_usd DECIMAL(16,2) NOT NULL DEFAULT 0,
      quarter_pipeline_count INT NOT NULL DEFAULT 0,
      quarter_pipeline_usd DECIMAL(16,2) NOT NULL DEFAULT 0,
      quarter_weighted_usd DECIMAL(16,2) NOT NULL DEFAULT 0,
      next_quarter_weighted_usd DECIMAL(16,2) NOT NULL DEFAULT 0,
      overdue_count INT NOT NULL DEFAULT 0,
      no_next_step_count INT NOT NULL DEFAULT 0,
      score_total DECIMAL(7,2) NULL,
      score_closing DECIMAL(7,2) NULL,
      score_build DECIMAL(7,2) NULL,
      score_discipline DECIMAL(7,2) NULL,
      rank_position INT NULL,
      team_size INT NULL,
      captured_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY seller_week (week_start, seller_user_id),
      KEY seller_time (seller_user_id, week_start)
    ) ENGINE=InnoDB`).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

const pad = (value) => String(value).padStart(2, "0");
export const localIso = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const mondayOf = (value) => {
  const date = value instanceof Date ? new Date(value) : new Date(`${String(value).slice(0, 10)}T00:00:00`);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return localIso(date);
};

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const nullable = (value) => {
  const parsed = Number(value);
  return value === null || value === undefined || !Number.isFinite(parsed) ? null : parsed;
};

// Pure: the league leaderboard plus the open pipeline of every seller become one row per seller.
export function buildSnapshotRows({ league, openBySeller = new Map(), weekStart }) {
  const leaderboard = Array.isArray(league?.leaderboard) ? league.leaderboard : [];
  const quarter = league?.quarterContext?.current || {};
  return leaderboard
    .filter((row) => Number(row?.sellerUserId) > 0)
    .map((row) => {
      const open = openBySeller.get(Number(row.sellerUserId)) || { count: 0, amountUsd: 0 };
      return {
        weekStart,
        sellerUserId: Number(row.sellerUserId),
        sellerName: String(row.sellerUserName || "").slice(0, 160) || null,
        quarterYear: Number(quarter.year || 0),
        quarterNumber: Number(quarter.quarter || 0),
        quotaAmountUsd: number(row.quotaAmountUsd),
        wonAmountUsd: number(row.wonAmountUsd),
        attainmentPct: nullable(row.attainmentPct),
        gapAmountUsd: number(row.gapAmountUsd),
        openPipelineCount: Number(open.count || 0),
        openPipelineUsd: number(open.amountUsd),
        quarterPipelineCount: Number(row.openOpportunities || 0),
        quarterPipelineUsd: number(row.funnelOpenAmountUsd),
        quarterWeightedUsd: number(row.pipelineWeightedUsd),
        nextQuarterWeightedUsd: number(row.nextQuarterTimeWeightedOpenPipelineUsd ?? row.nextQuarterOpenPipelineUsd),
        overdueCount: Number(row.overdueCount || 0),
        noNextStepCount: Number(row.noNextStepCount || 0),
        scoreTotal: nullable(row.scoreTotal),
        scoreClosing: nullable(row.scoreClosing),
        scoreBuild: nullable(row.scoreBuild),
        scoreDiscipline: nullable(row.scoreDiscipline),
        rankPosition: nullable(row.rankPosition),
        teamSize: leaderboard.length,
      };
    });
}

// The league is computed for the whole team, as the Ritmo comercial screen does for a user with read_all.
export const SNAPSHOT_SYSTEM_USER = Object.freeze({
  id: 0,
  roles: [],
  permissionSet: new Set(["ritmo_comercial.read", "ritmo_comercial.read_all", "oportunidades.read", "oportunidades.read_all"]),
});

export async function loadOpenPipelineBySeller(run = query) {
  const rows = await run(
    `SELECT o.seller_user_id AS sellerUserId, COUNT(*) AS total, COALESCE(SUM(o.amount_usd), 0) AS amountUsd
     FROM opportunities o
     JOIN opportunity_commercial_statuses cs ON cs.id = o.commercial_status_id
     JOIN opportunity_activation_statuses aas ON aas.id = o.activation_status_id
     WHERE o.seller_user_id IS NOT NULL AND cs.code = 'en_proceso' AND aas.code = 'activada'
     GROUP BY o.seller_user_id`,
  );
  return new Map(rows.map((row) => [Number(row.sellerUserId), { count: Number(row.total), amountUsd: Number(row.amountUsd) }]));
}

const COLUMNS = [
  ["weekStart", "week_start"], ["sellerUserId", "seller_user_id"], ["sellerName", "seller_name"], ["quarterYear", "quarter_year"],
  ["quarterNumber", "quarter_number"], ["quotaAmountUsd", "quota_amount_usd"], ["wonAmountUsd", "won_amount_usd"],
  ["attainmentPct", "attainment_pct"], ["gapAmountUsd", "gap_amount_usd"], ["openPipelineCount", "open_pipeline_count"],
  ["openPipelineUsd", "open_pipeline_usd"], ["quarterPipelineCount", "quarter_pipeline_count"], ["quarterPipelineUsd", "quarter_pipeline_usd"],
  ["quarterWeightedUsd", "quarter_weighted_usd"], ["nextQuarterWeightedUsd", "next_quarter_weighted_usd"], ["overdueCount", "overdue_count"],
  ["noNextStepCount", "no_next_step_count"], ["scoreTotal", "score_total"], ["scoreClosing", "score_closing"], ["scoreBuild", "score_build"],
  ["scoreDiscipline", "score_discipline"], ["rankPosition", "rank_position"], ["teamSize", "team_size"],
];

// Writing the same week twice replaces its row, so several API instances or a manual run cannot duplicate it.
export async function captureWeeklySnapshots({ buildLeague, run = query, now = new Date() }) {
  await ensureSellerSnapshotSchema(run);
  const weekStart = mondayOf(now);
  const [league, openBySeller] = await Promise.all([
    buildLeague({ user: SNAPSHOT_SYSTEM_USER, forceGlobalScope: true }),
    loadOpenPipelineBySeller(run),
  ]);
  const rows = buildSnapshotRows({ league, openBySeller, weekStart });
  for (const row of rows) {
    const names = COLUMNS.map(([, column]) => column);
    await run(
      `INSERT INTO seller_weekly_snapshots (${names.join(", ")}, captured_at)
       VALUES (${names.map(() => "?").join(", ")}, ?)
       ON DUPLICATE KEY UPDATE ${names.filter((column) => !["week_start", "seller_user_id"].includes(column)).map((column) => `${column} = VALUES(${column})`).join(", ")}, captured_at = VALUES(captured_at)`,
      [...COLUMNS.map(([key]) => row[key]), now],
    );
  }
  await run("DELETE FROM seller_weekly_snapshots WHERE week_start < ?", [localIso(new Date(now.getTime() - RETENTION_WEEKS * 7 * 86400000))]);
  return { weekStart, sellers: rows.length };
}

export async function hasSnapshotForWeek({ run = query, now = new Date() }) {
  await ensureSellerSnapshotSchema(run);
  const [row] = await run("SELECT COUNT(*) AS total FROM seller_weekly_snapshots WHERE week_start = ?", [mondayOf(now)]);
  return Number(row?.total || 0) > 0;
}

let started = false;
export function startSellerSnapshotWorker({ buildLeague }) {
  if (started || process.env.NODE_ENV === "test") return;
  started = true;
  // Checking several times a day, not only on Monday, makes the capture recover from a restart or a failed run.
  const tick = async () => {
    try {
      if (!(await hasSnapshotForWeek({}))) {
        const result = await captureWeeklySnapshots({ buildLeague });
        console.info(`[seller-snapshots] Foto semanal ${result.weekStart}: ${result.sellers} vendedores.`);
      }
    } catch (error) {
      console.error("[seller-snapshots] No fue posible guardar la foto semanal:", error?.message || error);
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), SNAPSHOT_CHECK_INTERVAL_MS);
  timer.unref?.();
}

const mapRow = (row) => ({
  weekStart: String(row.week_start instanceof Date ? localIso(row.week_start) : row.week_start).slice(0, 10),
  sellerUserId: Number(row.seller_user_id),
  sellerName: row.seller_name || null,
  quarterYear: Number(row.quarter_year),
  quarterNumber: Number(row.quarter_number),
  quotaAmountUsd: number(row.quota_amount_usd),
  wonAmountUsd: number(row.won_amount_usd),
  attainmentPct: nullable(row.attainment_pct),
  gapAmountUsd: number(row.gap_amount_usd),
  openPipelineCount: Number(row.open_pipeline_count),
  openPipelineUsd: number(row.open_pipeline_usd),
  quarterPipelineCount: Number(row.quarter_pipeline_count),
  quarterPipelineUsd: number(row.quarter_pipeline_usd),
  quarterWeightedUsd: number(row.quarter_weighted_usd),
  nextQuarterWeightedUsd: number(row.next_quarter_weighted_usd),
  overdueCount: Number(row.overdue_count),
  noNextStepCount: Number(row.no_next_step_count),
  scoreTotal: nullable(row.score_total),
  scoreClosing: nullable(row.score_closing),
  scoreBuild: nullable(row.score_build),
  scoreDiscipline: nullable(row.score_discipline),
  rankPosition: nullable(row.rank_position),
  teamSize: nullable(row.team_size),
  capturedAt: row.captured_at instanceof Date ? row.captured_at.toISOString() : String(row.captured_at || ""),
});

// sellerIds null = the whole team; the caller decides which of the two the user may see.
export async function loadSnapshots({ run = query, sellerIds = null, weeks = 12, now = new Date() }) {
  await ensureSellerSnapshotSchema(run);
  const since = localIso(new Date(mondayOfDate(now).getTime() - (weeks - 1) * 7 * 86400000));
  const scoped = Array.isArray(sellerIds);
  if (scoped && !sellerIds.length) return [];
  const rows = await run(
    `SELECT * FROM seller_weekly_snapshots WHERE week_start >= ?${scoped ? ` AND seller_user_id IN (${sellerIds.map(() => "?").join(", ")})` : ""}
     ORDER BY seller_user_id, week_start`,
    scoped ? [since, ...sellerIds.map(Number)] : [since],
  );
  return rows.map(mapRow);
}

const mondayOfDate = (date) => new Date(`${mondayOf(date)}T00:00:00`);

const DELTA_FIELDS = [
  "quotaAmountUsd", "wonAmountUsd", "attainmentPct", "gapAmountUsd", "openPipelineCount", "openPipelineUsd", "quarterPipelineCount",
  "quarterPipelineUsd", "quarterWeightedUsd", "nextQuarterWeightedUsd", "overdueCount", "noNextStepCount", "scoreTotal", "scoreClosing",
  "scoreBuild", "scoreDiscipline", "rankPosition",
];
const round2 = (value) => Number(Number(value).toFixed(2));

function differences(current, earlier) {
  if (!current || !earlier) return null;
  const sameQuarter = current.quarterYear === earlier.quarterYear && current.quarterNumber === earlier.quarterNumber;
  const changes = {};
  for (const field of DELTA_FIELDS) {
    if (current[field] === null || earlier[field] === null) continue;
    changes[field] = { from: earlier[field], to: current[field], change: round2(current[field] - earlier[field]) };
  }
  return { fromWeek: earlier.weekStart, toWeek: current.weekStart, sameQuarter, changes };
}

const pointOf = (row) => Object.fromEntries([["weekStart", row.weekStart], ["quarter", `T${row.quarterNumber} ${row.quarterYear}`], ...DELTA_FIELDS.map((field) => [field, row[field]])]);

// One seller: the series (oldest first), the last photo against the previous one and against four weeks earlier.
export function shapeSellerSnapshots(rows) {
  const ordered = [...rows].sort((left, right) => left.weekStart.localeCompare(right.weekStart));
  const latest = ordered[ordered.length - 1] || null;
  const weekBefore = ordered.length > 1 ? ordered[ordered.length - 2] : null;
  const fourWeeksBefore = latest ? ordered.find((row) => row.weekStart === addWeeks(latest.weekStart, -4)) || null : null;
  return {
    weeksAvailable: ordered.length,
    firstWeek: ordered[0]?.weekStart || null,
    latestWeek: latest?.weekStart || null,
    capturedAt: latest?.capturedAt || null,
    series: ordered.map(pointOf),
    vsPreviousWeek: differences(latest, weekBefore),
    vsFourWeeksAgo: differences(latest, fourWeeksBefore),
  };
}

function addWeeks(iso, weeks) {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + weeks * 7);
  return localIso(date);
}

export function shapeTeamSnapshots(rows) {
  const bySeller = new Map();
  for (const row of rows) bySeller.set(row.sellerUserId, [...(bySeller.get(row.sellerUserId) || []), row]);
  return [...bySeller.values()].map((sellerRows) => {
    const shaped = shapeSellerSnapshots(sellerRows);
    const latest = sellerRows.reduce((best, row) => (row.weekStart > best.weekStart ? row : best), sellerRows[0]);
    return { sellerUserId: latest.sellerUserId, seller: latest.sellerName, latest: pointOf(latest), vsPreviousWeek: shaped.vsPreviousWeek, vsFourWeeksAgo: shaped.vsFourWeeksAgo };
  }).sort((left, right) => (left.latest.rankPosition ?? 99) - (right.latest.rankPosition ?? 99));
}
