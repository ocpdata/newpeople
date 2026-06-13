import { query } from "../db.js";

export async function getOpportunityRecommendedStrategy(opportunityId) {
  const safeOpportunityId = Number(opportunityId || 0);
  if (!Number.isInteger(safeOpportunityId) || safeOpportunityId <= 0) {
    return null;
  }

  const rows = await query(
    `SELECT heading, route, final_objective, steps_json,
            derived_from_stage_id, derived_from_stage_code, updated_at
     FROM opportunity_workspace_recommended_strategy
     WHERE opportunity_id = ?
     LIMIT 1`,
    [safeOpportunityId],
  );

  if (!rows.length) {
    return null;
  }

  const row = rows[0];
  let steps = [];
  try {
    const parsed =
      typeof row.steps_json === "string"
        ? JSON.parse(row.steps_json)
        : row.steps_json;
    steps = Array.isArray(parsed)
      ? parsed.map((step) => ({
          priorityLabel: String(step?.priorityLabel || "").trim(),
          title: String(step?.title || "").trim(),
          text: String(step?.text || "").trim(),
        }))
      : [];
  } catch {
    steps = [];
  }

  return {
    heading: String(row.heading || "").trim(),
    route: String(row.route || "").trim(),
    finalObjective: String(row.final_objective || "").trim(),
    steps,
    derivedFromStageId: row.derived_from_stage_id
      ? Number(row.derived_from_stage_id)
      : null,
    derivedFromStageCode: String(row.derived_from_stage_code || "").trim(),
    updatedAt: row.updated_at || null,
  };
}
