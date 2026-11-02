import { ensureSellerSnapshotSchema, localIso, mondayOf } from "../../commercial-tracking/seller-snapshots.js";

// The development database has no weekly history yet, so the live bank seeds two earlier weeks for the asking seller
// and removes them afterwards. They are marked with a captured_at date no real capture can have.
const SEED_MARK = "2000-01-01 00:00:00";

export const SEEDED_WEEKS = Object.freeze([
  { weeksAgo: 4, openPipelineCount: 11, openPipelineUsd: 300000, quarterPipelineCount: 3, quarterPipelineUsd: 100000, quarterWeightedUsd: 30000, overdueCount: 3, noNextStepCount: 6, scoreTotal: 10, rankPosition: 3 },
  { weeksAgo: 1, openPipelineCount: 12, openPipelineUsd: 340000, quarterPipelineCount: 4, quarterPipelineUsd: 120000, quarterWeightedUsd: 40000, overdueCount: 2, noNextStepCount: 5, scoreTotal: 5, rankPosition: 4 },
]);

const weekOf = (now, weeksAgo) => {
  const monday = new Date(`${mondayOf(now)}T00:00:00`);
  monday.setDate(monday.getDate() - weeksAgo * 7);
  return localIso(monday);
};

export async function seedSnapshotHistory({ run, sellerId, now = new Date() }) {
  await ensureSellerSnapshotSchema(run);
  const [current] = await run("SELECT * FROM seller_weekly_snapshots WHERE seller_user_id = ? AND week_start = ?", [sellerId, mondayOf(now)]);
  if (!current) throw new Error("Falta la foto de la semana actual para sembrar la historia.");
  for (const week of SEEDED_WEEKS) {
    await run(
      `INSERT INTO seller_weekly_snapshots (week_start, seller_user_id, seller_name, quarter_year, quarter_number, quota_amount_usd, open_pipeline_count, open_pipeline_usd,
        quarter_pipeline_count, quarter_pipeline_usd, quarter_weighted_usd, overdue_count, no_next_step_count, score_total, rank_position, team_size, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE open_pipeline_count = VALUES(open_pipeline_count), captured_at = VALUES(captured_at)`,
      [weekOf(now, week.weeksAgo), sellerId, current.seller_name, current.quarter_year, current.quarter_number, current.quota_amount_usd, week.openPipelineCount, week.openPipelineUsd,
        week.quarterPipelineCount, week.quarterPipelineUsd, week.quarterWeightedUsd, week.overdueCount, week.noNextStepCount, week.scoreTotal, week.rankPosition, current.team_size, SEED_MARK],
    );
  }
}

export async function removeSeededSnapshotHistory({ run, sellerId }) {
  await run("DELETE FROM seller_weekly_snapshots WHERE seller_user_id = ? AND captured_at = ?", [sellerId, SEED_MARK]);
}

// Reference facts, computed from the current numbers (league and open pipeline) and the seeded constants.
export function snapshotReferenceFacts({ seeded, current, now = new Date() }) {
  const none = { openPipelineUsd: "n/d", quarterWeightedUsd: "n/d", overdueCount: "n/d", noNextStepCount: "n/d", scoreTotal: "n/d", rankPosition: "n/d" };
  const currentValues = { openPipelineUsd: current.openPipelineUsd, quarterWeightedUsd: current.quarterWeightedUsd, scoreTotal: current.scoreTotal, rankPosition: current.rankPosition, overdueCount: current.overdueCount, noNextStepCount: current.noNextStepCount };
  if (!seeded) {
    return { seeded: false, current: currentValues, changeVsPreviousWeek: none, changeVsFourWeeksAgo: none, note: "No hay historia semanal: solo existe la foto de esta semana. La respuesta correcta es decir que aún no hay historia suficiente para comparar." };
  }
  const change = (week) => ({
    openPipelineUsd: current.openPipelineUsd - week.openPipelineUsd,
    quarterWeightedUsd: current.quarterWeightedUsd - week.quarterWeightedUsd,
    overdueCount: current.overdueCount - week.overdueCount,
    noNextStepCount: current.noNextStepCount - week.noNextStepCount,
    scoreTotal: Number((current.scoreTotal - week.scoreTotal).toFixed(2)),
    rankPosition: current.rankPosition - week.rankPosition,
  });
  const [fourWeeks, oneWeek] = SEEDED_WEEKS;
  return {
    seeded: true,
    currentWeek: mondayOf(now),
    previousWeek: weekOf(now, 1),
    fourWeeksAgoWeek: weekOf(now, 4),
    current: currentValues,
    previousWeekValues: oneWeek,
    fourWeeksAgoValues: fourWeeks,
    changeVsPreviousWeek: change(oneWeek),
    changeVsFourWeeksAgo: change(fourWeeks),
    note: "En el lugar, un número menor es mejor: un cambio negativo es subir de lugar.",
  };
}
