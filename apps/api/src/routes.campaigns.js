import express from "express";
import { z } from "zod";
import { requireAnyPermission } from "./auth.js";
import { query, withTransaction } from "./db.js";
import { ensureCampaignsSchema } from "./campaigns/schema.js";
import {
  buildCampaignTypeSubtypePolicy,
  getCommercialSettings,
} from "./settings.js";

const router = express.Router();

const TIPO_CAMPANA_VALUES = [
  "reconocimiento",
  "captacion_de_leads",
  "nutricion",
  "conversion",
  "fidelizacion",
  "reactivacion",
  "promocion",
  "lanzamiento_de_producto",
  "upsell",
  "cross_sell",
  "evento",
  "referidos",
  "educacion",
];

const SUBTIPO_CAMPANA_VALUES = [
  "correo_masivo",
  "correo_automatizado",
  "redes_sociales_organicas",
  "redes_sociales_pagadas",
  "anuncios_busqueda",
  "anuncios_display",
  "webinar",
  "landing_page",
  "sms",
  "whatsapp",
  "evento_presencial",
  "evento_virtual",
  "encuesta",
  "programa_de_referidos",
];

const ESTADO_CAMPANA_VALUES = [
  "borrador",
  "en_ejecucion",
  "pausada",
  "finalizada",
  "cancelada",
];

const ETAPA_CICLO_VIDA_VALUES = [
  "visitante",
  "lead_nuevo",
  "lead_calificado",
  "oportunidad",
  "cliente_nuevo",
  "cliente_activo",
  "cliente_en_riesgo",
  "cliente_inactivo",
];

const ESTADO_INTERACCION_VALUES = [
  "no_enviado",
  "enviado",
  "entregado",
  "abierto",
  "clickeado",
  "respondido",
  "registrado",
  "convertido",
  "dado_de_baja",
  "rebotado",
  "suprimido",
];

const CAMPAIGN_READ_PERMISSIONS = ["campanas.read"];
const CAMPAIGN_CREATE_PERMISSIONS = ["campanas.create"];
const CAMPAIGN_UPDATE_PERMISSIONS = ["campanas.update"];

const COMPATIBILIDAD_NIVEL_VALUES = [
  "permitido",
  "permitido_con_aprobacion",
  "bloqueado",
];

const campaignUpsertSchema = z.object({
  name: z.string().trim().min(2).max(180),
  description: z.string().trim().max(10000).optional().nullable(),
  campaign_goal_text: z.string().trim().max(10000).optional().nullable(),
  classification_guide_context: z
    .string()
    .trim()
    .max(12000)
    .optional()
    .nullable(),
  classification_guide_examples: z
    .array(z.string().trim().max(1200))
    .max(10)
    .optional()
    .nullable(),
  audience_account_type_filters: z
    .array(z.string().trim().max(120))
    .max(200)
    .optional()
    .nullable(),
  audience_sector_filters: z
    .array(z.string().trim().max(120))
    .max(200)
    .optional()
    .nullable(),
  tipo_campana: z.enum(TIPO_CAMPANA_VALUES),
  subtipo_campana: z.enum(SUBTIPO_CAMPANA_VALUES),
  aprobacion_compatibilidad: z.boolean().optional(),
  justificacion_aprobacion_compatibilidad: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable(),
  estado_campana: z.enum(ESTADO_CAMPANA_VALUES),
  etapa_ciclo_vida: z.enum(ETAPA_CICLO_VIDA_VALUES).optional().nullable(),
  starts_at: z.string().datetime({ offset: true }).optional().nullable(),
  ends_at: z.string().datetime({ offset: true }).optional().nullable(),
});

const accountInteractionInputSchema = z.object({
  account_id: z.number().int().positive(),
  etapa_ciclo_vida: z.enum(ETAPA_CICLO_VIDA_VALUES).optional().nullable(),
  estado_interaccion: z.enum(ESTADO_INTERACCION_VALUES),
  notes: z.string().trim().max(500).optional().nullable(),
  contact_ids: z.array(z.number().int().positive()).max(500).optional(),
  last_interaction_at: z
    .string()
    .datetime({ offset: true })
    .optional()
    .nullable(),
});

const replaceCampaignAccountsSchema = z.object({
  items: z.array(accountInteractionInputSchema).max(500),
});

const upsertCampaignAccountSchema = accountInteractionInputSchema.omit({
  account_id: true,
});

const campaignEmailGuideUpsertSchema = z.object({
  campaign_email_guide: z.record(z.string(), z.unknown()).optional().nullable(),
});

const campaignEmailDraftUpsertSchema = z.object({
  campaign_email_draft: z.record(z.string(), z.unknown()).optional().nullable(),
});

function toDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseJsonStringArray(rawValue, maxItems) {
  try {
    const parsed =
      typeof rawValue === "string" ? JSON.parse(rawValue || "[]") : rawValue;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, maxItems);
  } catch {
    return [];
  }
}

function mapCampaignRow(row) {
  const classificationGuideExamples = parseJsonStringArray(
    row.classification_guide_examples_json,
    10,
  );
  const audienceAccountTypeFilters = parseJsonStringArray(
    row.audience_account_type_filters_json,
    200,
  );
  const audienceSectorFilters = parseJsonStringArray(
    row.audience_sector_filters_json,
    200,
  );

  let campaignEmailGuide = null;
  try {
    const rawGuide = row.campaign_email_guide_json;
    const parsedGuide =
      typeof rawGuide === "string" ? JSON.parse(rawGuide) : rawGuide;
    if (
      parsedGuide &&
      typeof parsedGuide === "object" &&
      !Array.isArray(parsedGuide)
    ) {
      campaignEmailGuide = parsedGuide;
    }
  } catch {
    campaignEmailGuide = null;
  }

  let campaignEmailDraft = null;
  try {
    const rawDraft = row.campaign_email_draft_json;
    const parsedDraft =
      typeof rawDraft === "string" ? JSON.parse(rawDraft) : rawDraft;
    if (
      parsedDraft &&
      typeof parsedDraft === "object" &&
      !Array.isArray(parsedDraft)
    ) {
      campaignEmailDraft = parsedDraft;
    }
  } catch {
    campaignEmailDraft = null;
  }

  return {
    id: Number(row.id),
    name: row.name || "",
    description: row.description || "",
    campaign_goal_text: row.campaign_goal_text || "",
    classification_guide_context: row.classification_guide_context || "",
    classification_guide_examples: classificationGuideExamples,
    audience_account_type_filters: audienceAccountTypeFilters,
    audience_sector_filters: audienceSectorFilters,
    campaign_email_guide: campaignEmailGuide,
    campaign_email_draft: campaignEmailDraft,
    tipo_campana: row.tipo_campana,
    subtipo_campana: row.subtipo_campana,
    compatibilidad_nivel: row.compatibilidad_nivel || "permitido",
    compatibilidad_aprobada: Boolean(Number(row.compatibilidad_aprobada || 0)),
    compatibilidad_justificacion: row.compatibilidad_justificacion || "",
    compatibilidad_evaluada_at: row.compatibilidad_evaluada_at || null,
    estado_campana: row.estado_campana,
    etapa_ciclo_vida: row.etapa_ciclo_vida || null,
    starts_at: row.starts_at || null,
    ends_at: row.ends_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    targeted_accounts_count: Number(row.targeted_accounts_count || 0),
  };
}

function evaluateCampaignSubtypeCompatibility(
  tipoCampana,
  subtipoCampana,
  policyByType = {},
) {
  const tipo = String(tipoCampana || "").trim();
  const subtipo = String(subtipoCampana || "").trim();
  const policy = policyByType?.[tipo];

  if (!policy) {
    return {
      nivel: "bloqueado",
      motivo: "Tipo de campana sin configuracion de politica",
    };
  }

  if ((policy.permitido || []).includes(subtipo)) {
    return { nivel: "permitido", motivo: "Combinacion permitida" };
  }

  if ((policy.permitido_con_aprobacion || []).includes(subtipo)) {
    return {
      nivel: "permitido_con_aprobacion",
      motivo: "Combinacion permitida solo con aprobacion",
    };
  }

  return {
    nivel: "bloqueado",
    motivo: "Combinacion bloqueada por matriz de configuracion",
  };
}

async function getResolvedCampaignSubtypePolicy() {
  try {
    const commercialSettings = await getCommercialSettings();
    return buildCampaignTypeSubtypePolicy(
      commercialSettings?.campaignMatrixRows,
    );
  } catch {
    // Fall back to default matrix-derived policy when settings are unavailable.
    return buildCampaignTypeSubtypePolicy([]);
  }
}

function resolveCompatibilityApproval({ payload, compatibilidad }) {
  const nivel = String(compatibilidad?.nivel || "permitido").trim();

  if (nivel === "bloqueado") {
    return {
      ok: false,
      message: "La combinacion tipo/subtipo esta bloqueada por politica",
    };
  }

  return {
    ok: true,
    aprobado: false,
    justificacion: null,
  };
}

function mapCampaignAccountRow(row) {
  return {
    account_id: Number(row.account_id),
    account_name: row.account_name || "",
    economic_sector: row.economic_sector || "",
    etapa_ciclo_vida: row.etapa_ciclo_vida || null,
    estado_interaccion: row.estado_interaccion,
    notes: row.notes || "",
    last_interaction_at: row.last_interaction_at || null,
    updated_at: row.updated_at || null,
    updated_by_name: row.updated_by_name || "",
    contacts: Array.isArray(row.contacts) ? row.contacts : [],
  };
}

function mapCampaignAudienceContacts(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    const accountId = Number(row.account_id || 0);
    const contactId = Number(row.contact_id || 0);
    if (!accountId || !contactId) return;

    const current = grouped.get(accountId) || [];
    current.push({
      contact_id: contactId,
      contact_name: toContactDisplayName(row),
      email: row.email || "",
      position_title: row.position_title || "",
    });
    grouped.set(accountId, current);
  });
  return grouped;
}

async function listCampaignAudienceAccounts(campaignId) {
  const rows = await query(
    `SELECT cai.*, a.name AS account_name,
            es.name AS economic_sector,
            u.full_name AS updated_by_name
     FROM campaign_account_interactions cai
     INNER JOIN accounts a ON a.id = cai.account_id
     INNER JOIN economic_sectors es ON es.id = a.economic_sector_id
     LEFT JOIN users u ON u.id = cai.updated_by
     WHERE cai.campaign_id = ?
     ORDER BY cai.updated_at DESC, cai.id DESC`,
    [campaignId],
  );

  const accountIds = rows
    .map((row) => Number(row.account_id || 0))
    .filter((accountId) => Number.isInteger(accountId) && accountId > 0);

  const contactsByAccount = accountIds.length
    ? mapCampaignAudienceContacts(
        await query(
          `SELECT caic.account_id,
                  c.id AS contact_id,
                  c.first_name,
                  c.last_name,
                  c.email,
                  c.position_title
           FROM campaign_account_interaction_contacts caic
           INNER JOIN contacts c ON c.id = caic.contact_id
           INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
           WHERE caic.campaign_id = ?
             AND cas.code = 'activado'
             AND caic.account_id IN (${accountIds.map(() => "?").join(", ")})
           ORDER BY caic.account_id ASC, c.first_name ASC, c.last_name ASC, c.id ASC`,
          [campaignId, ...accountIds],
        ),
      )
    : new Map();

  return rows.map((row) => ({
    ...row,
    contacts: contactsByAccount.get(Number(row.account_id || 0)) || [],
  }));
}

async function validateCampaignAudienceContactIds({ accountId, contactIds }) {
  const normalizedIds = Array.from(
    new Set(
      (Array.isArray(contactIds) ? contactIds : [])
        .map((contactId) => Number(contactId || 0))
        .filter((contactId) => Number.isInteger(contactId) && contactId > 0),
    ),
  );
  if (!normalizedIds.length) return [];

  const rows = await query(
    `SELECT c.id, c.account_id
     FROM contacts c
     INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
     WHERE c.id IN (${normalizedIds.map(() => "?").join(", ")})
       AND cas.code = 'activado'`,
    normalizedIds,
  );

  if (rows.length !== normalizedIds.length) {
    throw new Error("Uno o mas contactos no existen");
  }

  const mismatched = rows.some(
    (row) => Number(row.account_id || 0) !== Number(accountId),
  );
  if (mismatched) {
    throw new Error("Uno o mas contactos no pertenecen a la cuenta");
  }

  return normalizedIds;
}

async function validateCampaignAudienceAccountIds(accountIds) {
  const normalizedIds = Array.from(
    new Set(
      (Array.isArray(accountIds) ? accountIds : [])
        .map((accountId) => Number(accountId || 0))
        .filter((accountId) => Number.isInteger(accountId) && accountId > 0),
    ),
  );
  if (!normalizedIds.length) return [];

  const rows = await query(
    `SELECT a.id
     FROM accounts a
     INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
     WHERE a.id IN (${normalizedIds.map(() => "?").join(", ")})
       AND aas.code = 'activada'`,
    normalizedIds,
  );

  if (rows.length !== normalizedIds.length) {
    throw new Error("Una o mas cuentas no existen o no estan activas");
  }

  return normalizedIds;
}

function getLifecycleAccountFilterSql(stage) {
  if (stage === "visitante") {
    return "am.total_opportunities = 0";
  }
  if (stage === "lead_nuevo") {
    return "am.created_or_assigned_active_leads > 0 AND am.qualified_leads = 0";
  }
  if (stage === "lead_calificado") {
    return "am.qualified_leads > 0 AND am.created_or_assigned_active_leads = 0";
  }
  if (stage === "oportunidad") {
    return "am.open_opportunities_from_desarrollo > 0";
  }
  if (stage === "cliente_nuevo") {
    return "am.won_opportunities_last_90_days > 0 AND am.won_opportunities_before_90_days = 0";
  }
  if (stage === "cliente_activo") {
    return "am.won_opportunities > 0 AND COALESCE(am.last_activity_at, am.last_won_at) >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 120 DAY)";
  }
  if (stage === "cliente_en_riesgo") {
    return "am.won_opportunities > 0 AND COALESCE(am.last_activity_at, am.last_won_at) < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 120 DAY) AND COALESCE(am.last_activity_at, am.last_won_at) >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 270 DAY)";
  }
  if (stage === "cliente_inactivo") {
    return "((am.won_opportunities = 0 AND am.total_opportunities > 0 AND COALESCE(am.last_activity_at, '1970-01-01') < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 180 DAY)) OR (am.won_opportunities > 0 AND COALESCE(am.last_activity_at, am.last_won_at) < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 270 DAY)))";
  }
  return "1 = 0";
}

function getLifecycleRuleSummary(stage) {
  if (!stage) {
    return "Todas las cuentas activas y todos sus contactos activos";
  }
  if (stage === "visitante") {
    return "Cuentas sin oportunidades registradas";
  }
  if (stage === "lead_nuevo") {
    return "Cuentas con leads creados o asignados activos/no cerrados y sin leads calificados";
  }
  if (stage === "lead_calificado") {
    return "Cuentas con leads calificados y sin leads creados/asignados activos";
  }
  if (stage === "oportunidad") {
    return "Cuentas con oportunidades abiertas/activas desde etapa Desarrollo en adelante";
  }
  if (stage === "cliente_nuevo") {
    return "Cuentas con oportunidades ganadas en los ultimos 90 dias y sin ganadas previas";
  }
  if (stage === "cliente_activo") {
    return "Cuentas con oportunidades ganadas y actividad en los ultimos 120 dias";
  }
  if (stage === "cliente_en_riesgo") {
    return "Cuentas con oportunidades ganadas pero sin actividad entre 120 y 270 dias";
  }
  if (stage === "cliente_inactivo") {
    return "Cuentas sin actividad comercial reciente segun umbrales de inactividad";
  }
  return "Sin regla";
}

function toContactDisplayName(row) {
  const firstName = String(row.first_name || "").trim();
  const lastName = String(row.last_name || "").trim();
  const fullName = `${firstName} ${lastName}`.trim();
  if (fullName) return fullName;
  if (row.email) return String(row.email);
  return `Contacto ${Number(row.contact_id || 0)}`;
}

function mapContactsByAccount(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    const accountId = Number(row.account_id || 0);
    const contactId = Number(row.contact_id || 0);
    if (!accountId || !contactId) return;

    const current = grouped.get(accountId) || [];
    current.push({
      contact_id: contactId,
      contact_name: toContactDisplayName(row),
      email: row.email || "",
      position_title: row.position_title || "",
    });
    grouped.set(accountId, current);
  });

  return grouped;
}

async function listSuggestedContactsByStage(stage, accountIds) {
  if (!Array.isArray(accountIds) || accountIds.length === 0) {
    return new Map();
  }

  const placeholders = accountIds.map(() => "?").join(", ");
  const stageKey = String(stage || "").trim();

  if (!stageKey || stageKey === "visitante") {
    const rows = await query(
      `SELECT c.account_id,
              c.id AS contact_id,
              c.first_name,
              c.last_name,
              c.email,
              c.position_title
       FROM contacts c
       INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
       WHERE c.account_id IN (${placeholders})
         AND cas.code = 'activado'
       ORDER BY c.account_id ASC, c.first_name ASC, c.last_name ASC, c.id ASC`,
      accountIds,
    );
    return mapContactsByAccount(rows);
  }

  if (stageKey === "lead_nuevo") {
    const rows = await query(
      `SELECT DISTINCT i.account_id,
              c.id AS contact_id,
              c.first_name,
              c.last_name,
              c.email,
              c.position_title
       FROM interactions i
       INNER JOIN interaction_contact_links icl ON icl.interaction_id = i.id
       INNER JOIN contacts c ON c.id = icl.contact_id
       INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
       WHERE i.account_id IN (${placeholders})
         AND cas.code = 'activado'
         AND i.analysis_status IN ('created', 'lead_unassigned', 'lead_assigned')
         AND COALESCE(i.lead_substatus_code, '') NOT IN ('disqualified_temporary', 'disqualified_definitive')
       ORDER BY i.account_id ASC, c.first_name ASC, c.last_name ASC, c.id ASC`,
      accountIds,
    );
    return mapContactsByAccount(rows);
  }

  if (stageKey === "lead_calificado") {
    const rows = await query(
      `SELECT DISTINCT i.account_id,
              c.id AS contact_id,
              c.first_name,
              c.last_name,
              c.email,
              c.position_title
       FROM interactions i
       INNER JOIN interaction_contact_links icl ON icl.interaction_id = i.id
       INNER JOIN contacts c ON c.id = icl.contact_id
       INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
       WHERE i.account_id IN (${placeholders})
         AND cas.code = 'activado'
         AND i.analysis_status = 'lead_qualified'
       ORDER BY i.account_id ASC, c.first_name ASC, c.last_name ASC, c.id ASC`,
      accountIds,
    );
    return mapContactsByAccount(rows);
  }

  if (stageKey === "oportunidad") {
    const rows = await query(
      `SELECT DISTINCT o.account_id,
              c.id AS contact_id,
              c.first_name,
              c.last_name,
              c.email,
              c.position_title
       FROM opportunities o
       INNER JOIN contacts c ON c.id = o.contact_id
       INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
       INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
       INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
       WHERE o.account_id IN (${placeholders})
         AND cas.code = 'activado'
         AND ocs.code = 'en_proceso'
         AND COALESCE(oss.stage_order, 0) >= 3
       ORDER BY o.account_id ASC, c.first_name ASC, c.last_name ASC, c.id ASC`,
      accountIds,
    );
    return mapContactsByAccount(rows);
  }

  if (stageKey === "cliente_nuevo") {
    const rows = await query(
      `SELECT DISTINCT o.account_id,
              c.id AS contact_id,
              c.first_name,
              c.last_name,
              c.email,
              c.position_title
       FROM opportunities o
       INNER JOIN contacts c ON c.id = o.contact_id
       INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
       INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
       WHERE o.account_id IN (${placeholders})
         AND cas.code = 'activado'
         AND ocs.code = 'ganada'
         AND COALESCE(o.commercial_closed_at, o.updated_at, o.created_at) >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 90 DAY)
       ORDER BY o.account_id ASC, c.first_name ASC, c.last_name ASC, c.id ASC`,
      accountIds,
    );
    return mapContactsByAccount(rows);
  }

  if (stageKey === "cliente_activo") {
    const rows = await query(
      `SELECT DISTINCT contact_source.account_id,
              c.id AS contact_id,
              c.first_name,
              c.last_name,
              c.email,
              c.position_title
       FROM (
         SELECT o.account_id, o.contact_id
         FROM opportunities o
         INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
         WHERE o.account_id IN (${placeholders})
           AND ocs.code = 'ganada'
         UNION
         SELECT o.account_id, o.contact_id
         FROM opportunities o
         WHERE o.account_id IN (${placeholders})
           AND COALESCE(o.updated_at, o.created_at, o.commercial_closed_at) >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 120 DAY)
       ) contact_source
       INNER JOIN contacts c ON c.id = contact_source.contact_id
       INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
        AND cas.code = 'activado'
       ORDER BY contact_source.account_id ASC, c.first_name ASC, c.last_name ASC, c.id ASC`,
      [...accountIds, ...accountIds],
    );
    return mapContactsByAccount(rows);
  }

  if (stageKey === "cliente_en_riesgo" || stageKey === "cliente_inactivo") {
    const rows = await query(
      `WITH last_activity AS (
         SELECT
           o.account_id,
           MAX(COALESCE(o.updated_at, o.created_at, o.commercial_closed_at)) AS last_activity_at
         FROM opportunities o
         WHERE o.account_id IN (${placeholders})
         GROUP BY o.account_id
       )
       SELECT DISTINCT contact_source.account_id,
              c.id AS contact_id,
              c.first_name,
              c.last_name,
              c.email,
              c.position_title
       FROM (
         SELECT o.account_id, o.contact_id
         FROM opportunities o
         INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
         WHERE o.account_id IN (${placeholders})
           AND ocs.code = 'ganada'
         UNION
         SELECT o.account_id, o.contact_id
         FROM opportunities o
         INNER JOIN last_activity la ON la.account_id = o.account_id
           AND COALESCE(o.updated_at, o.created_at, o.commercial_closed_at) = la.last_activity_at
       ) contact_source
       INNER JOIN contacts c ON c.id = contact_source.contact_id
       INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
        AND cas.code = 'activado'
       ORDER BY contact_source.account_id ASC, c.first_name ASC, c.last_name ASC, c.id ASC`,
      [...accountIds, ...accountIds],
    );
    return mapContactsByAccount(rows);
  }

  return new Map();
}

router.use(async (_req, _res, next) => {
  try {
    await ensureCampaignsSchema();
    next();
  } catch (error) {
    next(error);
  }
});

router.get(
  "/catalogs",
  requireAnyPermission(CAMPAIGN_READ_PERMISSIONS),
  async (_req, res) => {
    const resolvedPolicy = await getResolvedCampaignSubtypePolicy();
    const commercialSettings = await getCommercialSettings().catch(() => null);
    const accountTypeRows = await query(
      `SELECT name
       FROM account_types
       WHERE is_active = 1
       ORDER BY name ASC`,
    );

    return res.json({
      tipo_campana: TIPO_CAMPANA_VALUES,
      subtipo_campana: SUBTIPO_CAMPANA_VALUES,
      estado_campana: ESTADO_CAMPANA_VALUES,
      etapa_ciclo_vida: ETAPA_CICLO_VIDA_VALUES,
      estado_interaccion: ESTADO_INTERACCION_VALUES,
      account_types: accountTypeRows
        .map((row) => String(row.name || "").trim())
        .filter(Boolean),
      compatibilidad_tipo_subtipo: {
        niveles: COMPATIBILIDAD_NIVEL_VALUES,
        por_tipo: resolvedPolicy,
      },
      campaign_matrix_rows: commercialSettings?.campaignMatrixRows || [],
    });
  },
);

router.get(
  "/accounts/suggestions",
  requireAnyPermission(CAMPAIGN_READ_PERMISSIONS),
  async (req, res) => {
    const stage = String(req.query.etapa_ciclo_vida || "").trim();
    if (stage && !ETAPA_CICLO_VIDA_VALUES.includes(stage)) {
      return res.status(400).json({
        message: "etapa_ciclo_vida invalida",
        allowedValues: ETAPA_CICLO_VIDA_VALUES,
      });
    }

    const filterSql = stage ? getLifecycleAccountFilterSql(stage) : "1 = 1";
    const rows = await query(
      `WITH owners_data AS (
         SELECT ao.account_id,
                GROUP_CONCAT(
                  u.full_name
                  ORDER BY u.full_name SEPARATOR ', '
                ) AS owner_names
         FROM account_owners ao
         INNER JOIN users u ON u.id = ao.user_id
         GROUP BY ao.account_id
       ),
       opportunity_metrics AS (
         SELECT
           a.id AS account_id,
           COUNT(o.id) AS total_opportunities,
           SUM(CASE WHEN ocs.code = 'en_proceso' THEN 1 ELSE 0 END) AS open_opportunities,
           SUM(CASE WHEN ocs.code = 'en_proceso' AND COALESCE(oss.stage_order, 0) >= 3 THEN 1 ELSE 0 END) AS open_opportunities_from_desarrollo,
           SUM(CASE WHEN ocs.code = 'ganada' THEN 1 ELSE 0 END) AS won_opportunities,
           SUM(CASE WHEN ocs.code = 'ganada' AND COALESCE(o.commercial_closed_at, o.updated_at, o.created_at) >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 90 DAY) THEN 1 ELSE 0 END) AS won_opportunities_last_90_days,
           SUM(CASE WHEN ocs.code = 'ganada' AND COALESCE(o.commercial_closed_at, o.updated_at, o.created_at) < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 90 DAY) THEN 1 ELSE 0 END) AS won_opportunities_before_90_days,
           MAX(CASE WHEN ocs.code = 'en_proceso' THEN oss.stage_order ELSE NULL END) AS max_open_stage_order,
           MAX(CASE WHEN ocs.code = 'ganada' THEN COALESCE(o.commercial_closed_at, o.updated_at, o.created_at) ELSE NULL END) AS last_won_at,
           MAX(COALESCE(o.updated_at, o.created_at, o.commercial_closed_at)) AS last_activity_at
         FROM accounts a
         LEFT JOIN opportunities o ON o.account_id = a.id
         LEFT JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
         LEFT JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
         GROUP BY a.id
       ),
       lead_metrics AS (
         SELECT
           a.id AS account_id,
           SUM(
             CASE
               WHEN i.analysis_status IN ('created', 'lead_unassigned', 'lead_assigned')
                 AND COALESCE(i.lead_substatus_code, '') NOT IN ('disqualified_temporary', 'disqualified_definitive')
               THEN 1
               ELSE 0
             END
           ) AS created_or_assigned_active_leads,
           SUM(CASE WHEN i.analysis_status = 'lead_qualified' THEN 1 ELSE 0 END) AS qualified_leads
         FROM accounts a
         LEFT JOIN interactions i ON i.account_id = a.id
         GROUP BY a.id
       ),
       account_metrics AS (
         SELECT
           a.id AS account_id,
           a.name AS account_name,
           COALESCE(om.total_opportunities, 0) AS total_opportunities,
           COALESCE(om.open_opportunities, 0) AS open_opportunities,
           COALESCE(om.open_opportunities_from_desarrollo, 0) AS open_opportunities_from_desarrollo,
           COALESCE(om.won_opportunities, 0) AS won_opportunities,
           COALESCE(om.won_opportunities_last_90_days, 0) AS won_opportunities_last_90_days,
           COALESCE(om.won_opportunities_before_90_days, 0) AS won_opportunities_before_90_days,
           om.max_open_stage_order,
           om.last_won_at,
           om.last_activity_at,
           COALESCE(lm.created_or_assigned_active_leads, 0) AS created_or_assigned_active_leads,
           COALESCE(lm.qualified_leads, 0) AS qualified_leads
         FROM accounts a
         INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
         LEFT JOIN opportunity_metrics om ON om.account_id = a.id
         LEFT JOIN lead_metrics lm ON lm.account_id = a.id
         WHERE aas.code <> 'desactivada'
       )
       SELECT
         am.account_id,
         am.account_name,
         am.total_opportunities,
         am.open_opportunities,
         am.won_opportunities,
         am.max_open_stage_order,
         am.last_won_at,
         am.last_activity_at,
         COALESCE(od.owner_names, '') AS owners_display
       FROM account_metrics am
       LEFT JOIN owners_data od ON od.account_id = am.account_id
       WHERE ${filterSql}
       ORDER BY am.account_name ASC
       LIMIT 1000`,
    );

    const accountIds = rows
      .map((row) => Number(row.account_id || 0))
      .filter((accountId) => Number.isInteger(accountId) && accountId > 0);
    const contactsByAccount = await listSuggestedContactsByStage(
      stage,
      accountIds,
    );

    return res.json({
      etapa_ciclo_vida: stage || null,
      ruleSummary: getLifecycleRuleSummary(stage),
      count: rows.length,
      items: rows.map((row) => ({
        account_id: Number(row.account_id),
        account_name: row.account_name || "",
        owners_display: row.owners_display || "",
        total_opportunities: Number(row.total_opportunities || 0),
        open_opportunities: Number(row.open_opportunities || 0),
        won_opportunities: Number(row.won_opportunities || 0),
        max_open_stage_order: row.max_open_stage_order
          ? Number(row.max_open_stage_order)
          : null,
        last_won_at: row.last_won_at || null,
        last_activity_at: row.last_activity_at || null,
        contacts: contactsByAccount.get(Number(row.account_id || 0)) || [],
      })),
    });
  },
);

router.get(
  "/accounts/suggested-contacts",
  requireAnyPermission(CAMPAIGN_READ_PERMISSIONS),
  async (req, res) => {
    const stage = String(req.query.etapa_ciclo_vida || "").trim();
    const accountIdsParam = String(req.query.account_ids || "").trim();

    if (!stage) {
      return res.status(400).json({
        message: "etapa_ciclo_vida es requerido",
      });
    }

    if (!ETAPA_CICLO_VIDA_VALUES.includes(stage)) {
      return res.status(400).json({
        message: "etapa_ciclo_vida invalida",
        allowedValues: ETAPA_CICLO_VIDA_VALUES,
      });
    }

    if (!accountIdsParam) {
      return res.json({});
    }

    const accountIds = accountIdsParam
      .split(",")
      .map((id) => Number(String(id).trim()))
      .filter((id) => Number.isInteger(id) && id > 0);

    if (accountIds.length === 0) {
      return res.json({});
    }

    try {
      const contactsByAccount = await listSuggestedContactsByStage(
        stage,
        accountIds,
      );

      const result = {};
      accountIds.forEach((accountId) => {
        result[accountId] = contactsByAccount.get(accountId) || [];
      });

      return res.json(result);
    } catch (requestError) {
      return res.status(500).json({
        message: "Error loading suggested contacts",
        error: requestError.message,
      });
    }
  },
);

router.get(
  "/",
  requireAnyPermission(CAMPAIGN_READ_PERMISSIONS),
  async (req, res) => {
    const estado = String(req.query.estado_campana || "").trim();
    const tipo = String(req.query.tipo_campana || "").trim();
    const search = String(req.query.search || "").trim();

    const where = ["1 = 1"];
    const params = [];

    if (estado) {
      where.push("c.estado_campana = ?");
      params.push(estado);
    }

    if (tipo) {
      where.push("c.tipo_campana = ?");
      params.push(tipo);
    }

    if (search) {
      where.push(
        "(c.name LIKE ? OR c.description LIKE ? OR c.campaign_goal_text LIKE ?)",
      );
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const rows = await query(
      `SELECT c.*,
            COUNT(cai.id) AS targeted_accounts_count
     FROM campaigns c
     LEFT JOIN campaign_account_interactions cai ON cai.campaign_id = c.id
     WHERE ${where.join(" AND ")}
     GROUP BY c.id
     ORDER BY c.updated_at DESC, c.id DESC`,
      params,
    );

    return res.json({ items: rows.map(mapCampaignRow) });
  },
);

router.post(
  "/",
  requireAnyPermission(CAMPAIGN_CREATE_PERMISSIONS),
  async (req, res) => {
    const parsed = campaignUpsertSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const payload = parsed.data;
    const resolvedPolicy = await getResolvedCampaignSubtypePolicy();
    const compatibilidad = evaluateCampaignSubtypeCompatibility(
      payload.tipo_campana,
      payload.subtipo_campana,
      resolvedPolicy,
    );
    const approvalDecision = resolveCompatibilityApproval({
      payload,
      compatibilidad,
    });
    if (!approvalDecision.ok) {
      return res.status(400).json({
        message: approvalDecision.message,
        compatibilidad,
      });
    }
    const now = new Date();

    const result = await query(
      `INSERT INTO campaigns
       (name, description, campaign_goal_text, classification_guide_context, classification_guide_examples_json,
        audience_account_type_filters_json, audience_sector_filters_json,
        tipo_campana, subtipo_campana,
        compatibilidad_nivel, compatibilidad_aprobada, compatibilidad_justificacion, compatibilidad_evaluada_at,
        estado_campana, etapa_ciclo_vida,
        starts_at, ends_at, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.name,
        payload.description || null,
        payload.campaign_goal_text || null,
        payload.classification_guide_context || null,
        JSON.stringify(payload.classification_guide_examples || []),
        JSON.stringify(payload.audience_account_type_filters || []),
        JSON.stringify(payload.audience_sector_filters || []),
        payload.tipo_campana,
        payload.subtipo_campana,
        compatibilidad.nivel,
        approvalDecision.aprobado ? 1 : 0,
        approvalDecision.justificacion,
        now,
        payload.estado_campana,
        payload.etapa_ciclo_vida || null,
        toDateOrNull(payload.starts_at),
        toDateOrNull(payload.ends_at),
        Number(req.user.id),
        Number(req.user.id),
        now,
        now,
      ],
    );

    const campaignId = Number(result.insertId || 0);
    const rows = await query(
      `SELECT c.*, 0 AS targeted_accounts_count
     FROM campaigns c
     WHERE c.id = ?
     LIMIT 1`,
      [campaignId],
    );

    return res.status(201).json({ campaign: mapCampaignRow(rows[0]) });
  },
);

router.get(
  "/:campaignId",
  requireAnyPermission(CAMPAIGN_READ_PERMISSIONS),
  async (req, res) => {
    const campaignId = Number(req.params.campaignId);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({ message: "campaignId invalido" });
    }

    const rows = await query(
      `SELECT c.*, COUNT(cai.id) AS targeted_accounts_count
     FROM campaigns c
     LEFT JOIN campaign_account_interactions cai ON cai.campaign_id = c.id
     WHERE c.id = ?
     GROUP BY c.id
     LIMIT 1`,
      [campaignId],
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Campana no encontrada" });
    }

    return res.json({ campaign: mapCampaignRow(rows[0]) });
  },
);

router.patch(
  "/:campaignId/email-draft",
  requireAnyPermission(CAMPAIGN_UPDATE_PERMISSIONS),
  async (req, res) => {
    const campaignId = Number(req.params.campaignId);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({ message: "campaignId invalido" });
    }

    const parsed = campaignEmailDraftUpsertSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const payload = parsed.data;
    const now = new Date();

    const updateResult = await query(
      `UPDATE campaigns
       SET campaign_email_draft_json = ?,
           updated_by = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        payload.campaign_email_draft
          ? JSON.stringify(payload.campaign_email_draft)
          : null,
        Number(req.user.id),
        now,
        campaignId,
      ],
    );

    if (!Number(updateResult.affectedRows || 0)) {
      return res.status(404).json({ message: "Campana no encontrada" });
    }

    const rows = await query(
      `SELECT c.*, COUNT(cai.id) AS targeted_accounts_count
       FROM campaigns c
       LEFT JOIN campaign_account_interactions cai ON cai.campaign_id = c.id
       WHERE c.id = ?
       GROUP BY c.id
       LIMIT 1`,
      [campaignId],
    );

    return res.json({ campaign: mapCampaignRow(rows[0]) });
  },
);

router.patch(
  "/:campaignId/email-guide",
  requireAnyPermission(CAMPAIGN_UPDATE_PERMISSIONS),
  async (req, res) => {
    const campaignId = Number(req.params.campaignId);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({ message: "campaignId invalido" });
    }

    const parsed = campaignEmailGuideUpsertSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const payload = parsed.data;
    const now = new Date();

    const updateResult = await query(
      `UPDATE campaigns
       SET campaign_email_guide_json = ?,
           updated_by = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        payload.campaign_email_guide
          ? JSON.stringify(payload.campaign_email_guide)
          : null,
        Number(req.user.id),
        now,
        campaignId,
      ],
    );

    if (!Number(updateResult.affectedRows || 0)) {
      return res.status(404).json({ message: "Campana no encontrada" });
    }

    const rows = await query(
      `SELECT c.*, COUNT(cai.id) AS targeted_accounts_count
       FROM campaigns c
       LEFT JOIN campaign_account_interactions cai ON cai.campaign_id = c.id
       WHERE c.id = ?
       GROUP BY c.id
       LIMIT 1`,
      [campaignId],
    );

    return res.json({ campaign: mapCampaignRow(rows[0]) });
  },
);

router.patch(
  "/:campaignId",
  requireAnyPermission(CAMPAIGN_UPDATE_PERMISSIONS),
  async (req, res) => {
    const campaignId = Number(req.params.campaignId);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({ message: "campaignId invalido" });
    }

    const parsed = campaignUpsertSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const payload = parsed.data;
    const resolvedPolicy = await getResolvedCampaignSubtypePolicy();
    const compatibilidad = evaluateCampaignSubtypeCompatibility(
      payload.tipo_campana,
      payload.subtipo_campana,
      resolvedPolicy,
    );
    const approvalDecision = resolveCompatibilityApproval({
      payload,
      compatibilidad,
    });
    if (!approvalDecision.ok) {
      return res.status(400).json({
        message: approvalDecision.message,
        compatibilidad,
      });
    }
    const now = new Date();

    const updateResult = await query(
      `UPDATE campaigns
     SET name = ?,
         description = ?,
         campaign_goal_text = ?,
         classification_guide_context = ?,
         classification_guide_examples_json = ?,
         audience_account_type_filters_json = ?,
         audience_sector_filters_json = ?,
         tipo_campana = ?,
         subtipo_campana = ?,
         compatibilidad_nivel = ?,
         compatibilidad_aprobada = ?,
         compatibilidad_justificacion = ?,
         compatibilidad_evaluada_at = ?,
         estado_campana = ?,
         etapa_ciclo_vida = ?,
         starts_at = ?,
         ends_at = ?,
         updated_by = ?,
         updated_at = ?
     WHERE id = ?`,
      [
        payload.name,
        payload.description || null,
        payload.campaign_goal_text || null,
        payload.classification_guide_context || null,
        JSON.stringify(payload.classification_guide_examples || []),
        JSON.stringify(payload.audience_account_type_filters || []),
        JSON.stringify(payload.audience_sector_filters || []),
        payload.tipo_campana,
        payload.subtipo_campana,
        compatibilidad.nivel,
        approvalDecision.aprobado ? 1 : 0,
        approvalDecision.justificacion,
        now,
        payload.estado_campana,
        payload.etapa_ciclo_vida || null,
        toDateOrNull(payload.starts_at),
        toDateOrNull(payload.ends_at),
        Number(req.user.id),
        now,
        campaignId,
      ],
    );

    if (!Number(updateResult.affectedRows || 0)) {
      return res.status(404).json({ message: "Campana no encontrada" });
    }

    const rows = await query(
      `SELECT c.*, COUNT(cai.id) AS targeted_accounts_count
     FROM campaigns c
     LEFT JOIN campaign_account_interactions cai ON cai.campaign_id = c.id
     WHERE c.id = ?
     GROUP BY c.id
     LIMIT 1`,
      [campaignId],
    );

    return res.json({ campaign: mapCampaignRow(rows[0]) });
  },
);

router.get(
  "/:campaignId/accounts",
  requireAnyPermission(CAMPAIGN_READ_PERMISSIONS),
  async (req, res) => {
    const campaignId = Number(req.params.campaignId);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({ message: "campaignId invalido" });
    }

    const rows = await listCampaignAudienceAccounts(campaignId);

    return res.json({ items: rows.map(mapCampaignAccountRow) });
  },
);

router.put(
  "/:campaignId/accounts",
  requireAnyPermission(CAMPAIGN_UPDATE_PERMISSIONS),
  async (req, res) => {
    const campaignId = Number(req.params.campaignId);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({ message: "campaignId invalido" });
    }

    const parsed = replaceCampaignAccountsSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const items = parsed.data.items;

    try {
      await validateCampaignAudienceAccountIds(
        items.map((item) => Number(item.account_id || 0)),
      );
    } catch (error) {
      return res
        .status(400)
        .json({ message: error.message || "Cuentas invalidas" });
    }

    await withTransaction(async (conn) => {
      await conn.query(
        `DELETE FROM campaign_account_interactions WHERE campaign_id = ?`,
        [campaignId],
      );

      for (const item of items) {
        await conn.query(
          `INSERT INTO campaign_account_interactions
             (campaign_id, account_id, etapa_ciclo_vida, estado_interaccion, notes,
              last_interaction_at, created_at, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, NOW(3), NOW(3), ?)`,
          [
            campaignId,
            Number(item.account_id),
            item.etapa_ciclo_vida || null,
            item.estado_interaccion,
            item.notes || null,
            toDateOrNull(item.last_interaction_at),
            Number(req.user.id),
          ],
        );

        await conn.query(
          `DELETE FROM campaign_account_interaction_contacts
           WHERE campaign_id = ? AND account_id = ?`,
          [campaignId, Number(item.account_id)],
        );

        const validContactIds = await validateCampaignAudienceContactIds({
          accountId: Number(item.account_id),
          contactIds: item.contact_ids || [],
        });
        for (const contactId of validContactIds) {
          await conn.query(
            `INSERT INTO campaign_account_interaction_contacts
               (campaign_id, account_id, contact_id, created_at, updated_by)
             VALUES (?, ?, ?, NOW(3), ?)`,
            [
              campaignId,
              Number(item.account_id),
              contactId,
              Number(req.user.id),
            ],
          );
        }
      }
    });

    return res.status(202).json({ updated: true, count: items.length });
  },
);

router.patch(
  "/:campaignId/accounts/:accountId",
  requireAnyPermission(CAMPAIGN_UPDATE_PERMISSIONS),
  async (req, res) => {
    const campaignId = Number(req.params.campaignId);
    const accountId = Number(req.params.accountId);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({ message: "campaignId invalido" });
    }
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return res.status(400).json({ message: "accountId invalido" });
    }

    const parsed = upsertCampaignAccountSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const payload = parsed.data;

    let validContactIds = [];
    try {
      await validateCampaignAudienceAccountIds([accountId]);
      validContactIds = await validateCampaignAudienceContactIds({
        accountId,
        contactIds: payload.contact_ids || [],
      });
    } catch (error) {
      return res
        .status(400)
        .json({ message: error.message || "Contactos invalidos" });
    }

    await query(
      `INSERT INTO campaign_account_interactions
         (campaign_id, account_id, etapa_ciclo_vida, estado_interaccion, notes,
          last_interaction_at, created_at, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, NOW(3), NOW(3), ?)
       ON DUPLICATE KEY UPDATE
         etapa_ciclo_vida = VALUES(etapa_ciclo_vida),
         estado_interaccion = VALUES(estado_interaccion),
         notes = VALUES(notes),
         last_interaction_at = VALUES(last_interaction_at),
         updated_at = NOW(3),
         updated_by = VALUES(updated_by)`,
      [
        campaignId,
        accountId,
        payload.etapa_ciclo_vida || null,
        payload.estado_interaccion,
        payload.notes || null,
        toDateOrNull(payload.last_interaction_at),
        Number(req.user.id),
      ],
    );

    await query(
      `DELETE FROM campaign_account_interaction_contacts
       WHERE campaign_id = ? AND account_id = ?`,
      [campaignId, accountId],
    );

    for (const contactId of validContactIds) {
      await query(
        `INSERT INTO campaign_account_interaction_contacts
           (campaign_id, account_id, contact_id, created_at, updated_by)
         VALUES (?, ?, ?, NOW(3), ?)`,
        [campaignId, accountId, contactId, Number(req.user.id)],
      );
    }

    const rows = await listCampaignAudienceAccounts(campaignId);
    const item = rows.find(
      (row) => Number(row.account_id || 0) === Number(accountId),
    );

    return res.json({ item: item ? mapCampaignAccountRow(item) : null });
  },
);

export default router;
