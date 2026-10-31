// Mi Coach governance settings: defaults, normalization, storage and the external research guard.

import { ensureCommercialIntelligenceSchema } from "./schema.js";
import { ensureProspectResearchSchema } from "../prospect-research/schema.js";
import { loadCoachBusinessRules } from "../coach/business-rules.js";
import { query } from "../db.js";
import { clip, createHttpError, parseJson } from "./service-helpers.js";

export const DEFAULT_GOVERNANCE_SETTINGS = {
  externalSourcesEnabled: false,
  includeWonOpportunities: true,
  includeLostOpportunities: true,
  includeCancelledOpportunities: false,
  dailyResearchLimitPerUser: 25,
  findingRetentionDays: 365,
  requireEvidenceForExternalFindings: true,
  allowProspectConversion: true,
  // Lets the seller confirm notes and opportunity data from the chat card instead of the Coach (off until an admin enables it).
  customerChatConfirmationEnabled: false,
  qualifiedOpportunityStageCodes: [
    "desarrollo",
    "cotizacion",
    "demostracion",
    "negociacion",
    "waiting",
  ],
  committedOpportunityStageCodes: ["negociacion", "waiting"],
  notes: "Configuracion inicial de gobierno de Mi Coach",
};

export const OPPORTUNITY_STAGE_CODES = new Set([
  "contacto_inicial",
  "identificacion_oportunidad",
  "desarrollo",
  "cotizacion",
  "demostracion",
  "negociacion",
  "waiting",
]);

export function normalizeStageCodeList(value, fallback) {
  const candidates = Array.isArray(value) ? value : fallback;
  const normalized = [
    ...new Set(candidates.map((code) => String(code || "").trim())),
  ].filter((code) => OPPORTUNITY_STAGE_CODES.has(code));
  return normalized.length ? normalized : [...fallback];
}

export function normalizeGovernanceSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const qualifiedOpportunityStageCodes = normalizeStageCodeList(
    source.qualifiedOpportunityStageCodes,
    DEFAULT_GOVERNANCE_SETTINGS.qualifiedOpportunityStageCodes,
  );
  const requestedCommittedStages = normalizeStageCodeList(
    source.committedOpportunityStageCodes,
    DEFAULT_GOVERNANCE_SETTINGS.committedOpportunityStageCodes,
  ).filter((code) => qualifiedOpportunityStageCodes.includes(code));
  const committedOpportunityStageCodes = requestedCommittedStages.length
    ? requestedCommittedStages
    : [
        qualifiedOpportunityStageCodes[
          qualifiedOpportunityStageCodes.length - 1
        ],
      ];
  return {
    externalSourcesEnabled: Boolean(source.externalSourcesEnabled),
    includeWonOpportunities: source.includeWonOpportunities !== false,
    includeLostOpportunities: source.includeLostOpportunities !== false,
    includeCancelledOpportunities: Boolean(
      source.includeCancelledOpportunities,
    ),
    dailyResearchLimitPerUser: Math.max(
      1,
      Math.min(
        500,
        Number(
          source.dailyResearchLimitPerUser ||
            DEFAULT_GOVERNANCE_SETTINGS.dailyResearchLimitPerUser,
        ),
      ),
    ),
    findingRetentionDays: Math.max(
      30,
      Math.min(
        3650,
        Number(
          source.findingRetentionDays ||
            DEFAULT_GOVERNANCE_SETTINGS.findingRetentionDays,
        ),
      ),
    ),
    requireEvidenceForExternalFindings:
      source.requireEvidenceForExternalFindings !== false,
    allowProspectConversion: source.allowProspectConversion !== false,
    customerChatConfirmationEnabled: source.customerChatConfirmationEnabled === true,
    qualifiedOpportunityStageCodes,
    committedOpportunityStageCodes,
    notes: clip(source.notes || DEFAULT_GOVERNANCE_SETTINGS.notes, 1000),
  };
}

export async function getMiCoachGovernanceSettings() {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT settings_json FROM mi_coach_governance_settings
     WHERE singleton_key = 'default' LIMIT 1`,
  );
  return normalizeGovernanceSettings(
    parseJson(rows[0]?.settings_json, DEFAULT_GOVERNANCE_SETTINGS),
  );
}

export async function assertExternalResearchGovernance(user) {
  const settings = await getMiCoachGovernanceSettings();
  if (!settings.externalSourcesEnabled) {
    throw createHttpError(
      403,
      "Las fuentes externas estan deshabilitadas por gobierno de Mi Coach",
      {
        requiredPermission: "mi_coach.admin",
      },
    );
  }
  await ensureProspectResearchSchema();
  const rows = await query(
    `SELECT
       (SELECT COUNT(*) FROM customer_intelligence_jobs
        WHERE requested_by_user_id = ? AND job_type = 'external_research'
          AND created_at >= DATE_SUB(NOW(3), INTERVAL 1 DAY))
       +
       (SELECT COUNT(*) FROM prospect_research_sessions
        WHERE requested_by_user_id = ?
          AND external_researched_at >= DATE_SUB(NOW(3), INTERVAL 1 DAY))
       AS total`,
    [Number(user.id), Number(user.id)],
  );
  if (Number(rows[0]?.total || 0) >= settings.dailyResearchLimitPerUser) {
    throw createHttpError(
      429,
      "Se alcanzo el limite diario de investigacion externa para este usuario",
    );
  }
  return settings;
}

export async function getMiCoachGovernanceOverview() {
  await ensureCommercialIntelligenceSchema();
  const retentionSettings = await getMiCoachGovernanceSettings();
  await query(
    `DELETE FROM customer_intelligence_findings
     WHERE created_at < DATE_SUB(NOW(3), INTERVAL ? DAY)`,
    [retentionSettings.findingRetentionDays],
  ).catch(() => undefined);
  await query(
    `DELETE FROM customer_intelligence_jobs
     WHERE created_at < DATE_SUB(NOW(3), INTERVAL ? DAY)`,
    [retentionSettings.findingRetentionDays],
  ).catch(() => undefined);
  await query(
    `DELETE FROM prospect_research_sessions
     WHERE created_at < DATE_SUB(NOW(3), INTERVAL ? DAY)`,
    [retentionSettings.findingRetentionDays],
  ).catch(() => undefined);
  const [settingsRows, jobRows, findingRows, prospectRows] = await Promise.all([
    query(
      `SELECT settings_json, updated_at, updated_by_user_id
       FROM mi_coach_governance_settings
       WHERE singleton_key = 'default'
       LIMIT 1`,
    ),
    query(
      `SELECT status, job_type, COUNT(*) AS total
       FROM customer_intelligence_jobs
       WHERE created_at >= DATE_SUB(NOW(3), INTERVAL 30 DAY)
       GROUP BY status, job_type`,
    ).catch(() => []),
    query(
      `SELECT status, source_type, COUNT(*) AS total
       FROM customer_intelligence_findings
       WHERE created_at >= DATE_SUB(NOW(3), INTERVAL 30 DAY)
       GROUP BY status, source_type`,
    ).catch(() => []),
    query(
      `SELECT status, COUNT(*) AS total
       FROM prospect_research_sessions
       WHERE created_at >= DATE_SUB(NOW(3), INTERVAL 30 DAY)
       GROUP BY status`,
    ).catch(() => []),
  ]);
  const settingsRow = settingsRows[0] || {};
  return {
    settings: normalizeGovernanceSettings(
      parseJson(settingsRow.settings_json, DEFAULT_GOVERNANCE_SETTINGS),
    ),
    updatedAt: settingsRow.updated_at || null,
    updatedByUserId: settingsRow.updated_by_user_id
      ? Number(settingsRow.updated_by_user_id)
      : null,
    businessRules: await loadCoachBusinessRules({
      channel: "coach",
      process: "default",
    }),
    metrics: {
      jobsLast30Days: jobRows.map((row) => ({
        status: row.status,
        jobType: row.job_type,
        total: Number(row.total || 0),
      })),
      findingsLast30Days: findingRows.map((row) => ({
        status: row.status,
        sourceType: row.source_type,
        total: Number(row.total || 0),
      })),
      prospectSessionsLast30Days: prospectRows.map((row) => ({
        status: row.status,
        total: Number(row.total || 0),
      })),
    },
  };
}

export async function updateMiCoachGovernanceSettings({ user, settings }) {
  await ensureCommercialIntelligenceSchema();
  const normalized = normalizeGovernanceSettings(settings);
  await query(
    `INSERT INTO mi_coach_governance_settings
      (singleton_key, settings_json, updated_by_user_id, created_at, updated_at)
     VALUES ('default', ?, ?, NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE
       settings_json = VALUES(settings_json),
       updated_by_user_id = VALUES(updated_by_user_id),
       updated_at = NOW(3)`,
    [JSON.stringify(normalized), Number(user.id)],
  );
  return getMiCoachGovernanceOverview();
}
