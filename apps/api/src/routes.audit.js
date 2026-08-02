import express from "express";
import { z } from "zod";
import { query } from "./db.js";
import { requirePermission } from "./auth.js";
import { ensureAuditAiUsageSchema, parseAuditChangedFields } from "./audit.js";

const router = express.Router();

const MICROS_PER_USD = 1_000_000;

function buildInPlaceholders(values = []) {
  return values.map(() => "?").join(", ");
}

function toUsdFromMicros(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric / MICROS_PER_USD : 0;
}

function canReadAiCost(user) {
  const permissions = user?.permissionSet;
  return Boolean(
    permissions?.has("ia.usage.read_all") ||
    permissions?.has("ia.budget.read_all") ||
    permissions?.has("configuracion.read"),
  );
}

function splitGroupedValues(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const AI_USAGE_MODULE_SQL = `CASE
  WHEN ul.feature_code LIKE 'accounts.%' THEN 'cuentas'
  WHEN ul.feature_code LIKE 'contacts.%' THEN 'contactos'
  WHEN ul.feature_code LIKE 'interactions.%' THEN 'interacciones'
  WHEN ul.feature_code LIKE 'opportunities.%' THEN 'oportunidades'
  WHEN ul.feature_code LIKE 'quotations.%' THEN 'cotizaciones'
  WHEN ul.feature_code LIKE 'proposals.%' THEN 'propuestas'
  WHEN ul.feature_code LIKE 'commercial_enablement.%' THEN 'biblioteca_comercial'
  WHEN ul.feature_code LIKE 'commercial_execution.%' THEN 'ejecucion_comercial'
  WHEN ul.feature_code LIKE 'chatbot.%' THEN 'chatbot'
  WHEN ul.feature_code LIKE 'landing.%' THEN 'landing'
  ELSE 'ia'
END`;

function buildAuditWhere(filters) {
  const where = [];
  const params = [];

  if (filters.from) {
    where.push("l.created_at >= ?");
    params.push(new Date(filters.from));
  }

  if (filters.to) {
    where.push("l.created_at <= ?");
    params.push(new Date(filters.to));
  }

  if (filters.module) {
    where.push("l.module = ?");
    params.push(filters.module);
  }

  if (filters.action) {
    where.push("l.action = ?");
    params.push(filters.action);
  }

  if (filters.entityType) {
    where.push("l.entity_type = ?");
    params.push(filters.entityType);
  }

  if (filters.status) {
    where.push("l.status = ?");
    params.push(filters.status);
  }

  if (filters.actorUserId) {
    where.push("l.performed_by_user_id = ?");
    params.push(filters.actorUserId);
  }

  if (filters.aiUsage === "with_ai") {
    where.push(
      `(EXISTS (
          SELECT 1
          FROM audit_log_ai_usage lau
          WHERE lau.audit_log_id = l.id
        )
        OR EXISTS (
          SELECT 1
          FROM opportunity_stage_answer_suggestion_jobs j
          INNER JOIN ai_usage_ledger ul
            ON ul.job_type = 'opportunity_stage_answer_suggestion_job'
           AND ul.job_id = j.id
          WHERE l.action IN ('stage_answer_suggestions_generated', 'stage_answer_suggestions_reused')
            AND j.public_id = JSON_UNQUOTE(JSON_EXTRACT(l.changed_fields, '$.job_public_id.after'))
        ))`,
    );
  } else if (filters.aiUsage === "without_ai") {
    where.push(
      `NOT EXISTS (
          SELECT 1
          FROM audit_log_ai_usage lau
          WHERE lau.audit_log_id = l.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM opportunity_stage_answer_suggestion_jobs j
          INNER JOIN ai_usage_ledger ul
            ON ul.job_type = 'opportunity_stage_answer_suggestion_job'
           AND ul.job_id = j.id
          WHERE l.action IN ('stage_answer_suggestions_generated', 'stage_answer_suggestions_reused')
            AND j.public_id = JSON_UNQUOTE(JSON_EXTRACT(l.changed_fields, '$.job_public_id.after'))
        )`,
    );
  }

  if (filters.q) {
    where.push(
      `(LOWER(l.detail) LIKE ?
       OR LOWER(l.module) LIKE ?
       OR LOWER(l.action) LIKE ?
       OR LOWER(l.entity_type) LIKE ?
       OR LOWER(l.performed_by_name) LIKE ?
       OR LOWER(l.performed_by_email) LIKE ?)`,
    );
    const term = `%${String(filters.q).toLowerCase()}%`;
    params.push(term, term, term, term, term, term);
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

function buildUnlinkedAiUsageWhere(filters) {
  const where = [
    `NOT EXISTS (
      SELECT 1
      FROM audit_log_ai_usage lau
      WHERE lau.ai_usage_ledger_id = ul.id
    )`,
    `NOT EXISTS (
      SELECT 1
      FROM opportunity_stage_answer_suggestion_jobs j
      INNER JOIN audit_log l
        ON l.action IN ('stage_answer_suggestions_generated', 'stage_answer_suggestions_reused')
       AND j.public_id = JSON_UNQUOTE(JSON_EXTRACT(l.changed_fields, '$.job_public_id.after'))
      WHERE ul.job_type = 'opportunity_stage_answer_suggestion_job'
        AND ul.job_id = j.id
    )`,
  ];
  const params = [];

  if (filters.aiUsage === "without_ai") {
    where.push("1 = 0");
  }

  if (filters.from) {
    where.push("ul.created_at_utc >= ?");
    params.push(new Date(filters.from));
  }

  if (filters.to) {
    where.push("ul.created_at_utc <= ?");
    params.push(new Date(filters.to));
  }

  if (filters.module) {
    where.push(`${AI_USAGE_MODULE_SQL} = ?`);
    params.push(filters.module);
  }

  if (filters.action) {
    where.push(filters.action === "ai_usage_recorded" ? "1 = 1" : "1 = 0");
  }

  if (filters.entityType) {
    where.push(filters.entityType === "ai_usage" ? "1 = 1" : "1 = 0");
  }

  if (filters.status) {
    where.push("ul.status = ?");
    params.push(filters.status);
  }

  if (filters.actorUserId) {
    where.push("ul.user_id = ?");
    params.push(filters.actorUserId);
  }

  if (filters.q) {
    where.push(
      `(LOWER(ul.feature_code) LIKE ?
       OR LOWER(ul.model) LIKE ?
       OR LOWER(ul.job_type) LIKE ?
       OR LOWER(u.full_name) LIKE ?
       OR LOWER(u.email) LIKE ?)`,
    );
    const term = `%${String(filters.q).toLowerCase()}%`;
    params.push(term, term, term, term, term);
  }

  return {
    whereSql: `WHERE ${where.join(" AND ")}`,
    params,
  };
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  from: z.string().optional(),
  to: z.string().optional(),
  module: z.string().max(60).optional(),
  action: z.string().max(60).optional(),
  entityType: z.string().max(60).optional(),
  status: z.enum(["success", "error"]).optional(),
  actorUserId: z.coerce.number().int().positive().optional(),
  aiUsage: z.enum(["with_ai", "without_ai"]).optional(),
  q: z.string().max(160).optional(),
});

router.get("/", requirePermission("audit.read"), async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Filtros invalidos", errors: parsed.error.flatten() });
  }

  const filters = parsed.data;
  await ensureAuditAiUsageSchema();
  const auditFilter = buildAuditWhere(filters);
  const aiUsageFilter = buildUnlinkedAiUsageWhere(filters);
  const page = filters.page;
  const pageSize = filters.pageSize;
  const offset = (page - 1) * pageSize;

  const countRows = await query(
    `SELECT (
       SELECT COUNT(*)
       FROM audit_log l
       ${auditFilter.whereSql}
     ) + (
       SELECT COUNT(*)
       FROM ai_usage_ledger ul
       INNER JOIN users u ON u.id = ul.user_id
       ${aiUsageFilter.whereSql}
     ) AS total`,
    [...auditFilter.params, ...aiUsageFilter.params],
  );

  const total = Number(countRows[0]?.total || 0);

  const rows = await query(
    `SELECT *
     FROM (
       SELECT CAST(l.id AS CHAR) AS id,
              'audit_log' AS source_type,
              l.id AS audit_log_id,
              NULL AS ai_usage_ledger_id,
              l.module,
              l.action,
              l.entity_type,
              l.entity_id,
              l.status,
              l.detail,
              l.changed_fields,
              l.performed_by_user_id,
              l.performed_by_name,
              l.performed_by_email,
              l.created_at,
              NULL AS ai_usage_count,
              NULL AS ai_total_tokens,
              NULL AS ai_total_cost_micros,
              NULL AS ai_feature_codes,
              NULL AS ai_models,
              l.created_at AS sort_created_at,
              l.id AS sort_id
       FROM audit_log l
       ${auditFilter.whereSql}
       UNION ALL
       SELECT CONCAT('ai:', ul.id) AS id,
              'ai_usage_ledger' AS source_type,
              NULL AS audit_log_id,
              ul.id AS ai_usage_ledger_id,
              ${AI_USAGE_MODULE_SQL} AS module,
              'ai_usage_recorded' AS action,
              'ai_usage' AS entity_type,
              ul.id AS entity_id,
              CASE WHEN ul.status = 'error' THEN 'error' ELSE 'success' END AS status,
              CONCAT('Uso IA registrado: ', ul.feature_code) AS detail,
              NULL AS changed_fields,
              ul.user_id AS performed_by_user_id,
              u.full_name AS performed_by_name,
              u.email AS performed_by_email,
              ul.created_at_utc AS created_at,
              1 AS ai_usage_count,
              ul.total_tokens AS ai_total_tokens,
              ul.cost_micros AS ai_total_cost_micros,
              ul.feature_code AS ai_feature_codes,
              ul.model AS ai_models,
              ul.created_at_utc AS sort_created_at,
              ul.id AS sort_id
       FROM ai_usage_ledger ul
       INNER JOIN users u ON u.id = ul.user_id
       ${aiUsageFilter.whereSql}
     ) combined_events
     ORDER BY sort_created_at DESC, sort_id DESC
     LIMIT ? OFFSET ?`,
    [...auditFilter.params, ...aiUsageFilter.params, pageSize, offset],
  );

  const userEntityIds = Array.from(
    new Set(
      rows
        .filter((row) => row.entity_type === "user" && Number(row.entity_id))
        .map((row) => Number(row.entity_id)),
    ),
  );
  const roleEntityIds = Array.from(
    new Set(
      rows
        .filter((row) => row.entity_type === "role" && Number(row.entity_id))
        .map((row) => Number(row.entity_id)),
    ),
  );
  const accountEntityIds = Array.from(
    new Set(
      rows
        .filter((row) => row.entity_type === "account" && Number(row.entity_id))
        .map((row) => Number(row.entity_id)),
    ),
  );
  const contactEntityIds = Array.from(
    new Set(
      rows
        .filter((row) => row.entity_type === "contact" && Number(row.entity_id))
        .map((row) => Number(row.entity_id)),
    ),
  );

  const entityNames = new Map();
  const aiUsageByAuditId = new Map();
  const allowAiCost = canReadAiCost(req.user);

  if (userEntityIds.length) {
    const userRows = await query(
      `SELECT id, full_name FROM users WHERE id IN (${buildInPlaceholders(
        userEntityIds,
      )})`,
      userEntityIds,
    );
    for (const row of userRows) {
      entityNames.set(`user:${Number(row.id)}`, String(row.full_name || ""));
    }
  }

  if (roleEntityIds.length) {
    const roleRows = await query(
      `SELECT id, name FROM roles WHERE id IN (${buildInPlaceholders(
        roleEntityIds,
      )})`,
      roleEntityIds,
    );
    for (const row of roleRows) {
      entityNames.set(`role:${Number(row.id)}`, String(row.name || ""));
    }
  }

  if (accountEntityIds.length) {
    const accountRows = await query(
      `SELECT id, name FROM accounts WHERE id IN (${buildInPlaceholders(
        accountEntityIds,
      )})`,
      accountEntityIds,
    );
    for (const row of accountRows) {
      entityNames.set(`account:${Number(row.id)}`, String(row.name || ""));
    }
  }

  if (contactEntityIds.length) {
    const contactRows = await query(
      `SELECT id, first_name, last_name
       FROM contacts
       WHERE id IN (${buildInPlaceholders(contactEntityIds)})`,
      contactEntityIds,
    );
    for (const row of contactRows) {
      const fullName = String(
        `${String(row.first_name || "").trim()} ${String(
          row.last_name || "",
        ).trim()}`,
      )
        .trim()
        .replace(/\s+/g, " ");
      entityNames.set(`contact:${Number(row.id)}`, fullName);
    }
  }

  const auditLogIds = rows.map((row) => Number(row.id || 0)).filter(Boolean);
  if (auditLogIds.length) {
    const aiUsageRows = await query(
      `SELECT usage_source.audit_log_id,
              COUNT(*) AS ai_usage_count,
              COALESCE(SUM(ul.total_tokens), 0) AS ai_total_tokens,
              COALESCE(SUM(ul.cost_micros), 0) AS ai_total_cost_micros,
              GROUP_CONCAT(DISTINCT ul.feature_code ORDER BY ul.feature_code SEPARATOR ',') AS ai_feature_codes,
              GROUP_CONCAT(DISTINCT ul.model ORDER BY ul.model SEPARATOR ',') AS ai_models
       FROM (
         SELECT lau.audit_log_id, lau.ai_usage_ledger_id
         FROM audit_log_ai_usage lau
         WHERE lau.audit_log_id IN (${buildInPlaceholders(auditLogIds)})
         UNION
         SELECT l.id AS audit_log_id, ul.id AS ai_usage_ledger_id
         FROM audit_log l
         INNER JOIN opportunity_stage_answer_suggestion_jobs j
           ON j.public_id = JSON_UNQUOTE(JSON_EXTRACT(l.changed_fields, '$.job_public_id.after'))
         INNER JOIN ai_usage_ledger ul
           ON ul.job_type = 'opportunity_stage_answer_suggestion_job'
          AND ul.job_id = j.id
         WHERE l.id IN (${buildInPlaceholders(auditLogIds)})
           AND l.action IN ('stage_answer_suggestions_generated', 'stage_answer_suggestions_reused')
       ) usage_source
       INNER JOIN ai_usage_ledger ul ON ul.id = usage_source.ai_usage_ledger_id
       GROUP BY usage_source.audit_log_id`,
      [...auditLogIds, ...auditLogIds],
    );

    for (const row of aiUsageRows) {
      const auditLogId = Number(row.audit_log_id || 0);
      const costMicros = Number(row.ai_total_cost_micros || 0);
      aiUsageByAuditId.set(auditLogId, {
        ai_used: true,
        ai_usage_count: Number(row.ai_usage_count || 0),
        ai_total_tokens: Number(row.ai_total_tokens || 0),
        ai_total_cost_micros: allowAiCost ? costMicros : null,
        ai_total_cost_usd: allowAiCost ? toUsdFromMicros(costMicros) : null,
        ai_cost_visible: allowAiCost,
        ai_feature_codes: splitGroupedValues(row.ai_feature_codes),
        ai_models: splitGroupedValues(row.ai_models),
      });
    }
  }

  res.json({
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items: rows.map((row) => {
      const isVirtualAiUsage = row.source_type === "ai_usage_ledger";
      const virtualCostMicros = Number(row.ai_total_cost_micros || 0);
      const aiUsage = isVirtualAiUsage
        ? {
            ai_used: true,
            ai_usage_count: Number(row.ai_usage_count || 1),
            ai_total_tokens: Number(row.ai_total_tokens || 0),
            ai_total_cost_micros: allowAiCost ? virtualCostMicros : null,
            ai_total_cost_usd: allowAiCost
              ? toUsdFromMicros(virtualCostMicros)
              : null,
            ai_cost_visible: allowAiCost,
            ai_feature_codes: splitGroupedValues(row.ai_feature_codes),
            ai_models: splitGroupedValues(row.ai_models),
          }
        : aiUsageByAuditId.get(Number(row.id || 0)) || {
            ai_used: false,
            ai_usage_count: 0,
            ai_total_tokens: 0,
            ai_total_cost_micros: allowAiCost ? 0 : null,
            ai_total_cost_usd: allowAiCost ? 0 : null,
            ai_cost_visible: allowAiCost,
            ai_feature_codes: [],
            ai_models: [],
          };

      return {
        ...row,
        entity_name:
          entityNames.get(
            `${String(row.entity_type || "")}:${Number(row.entity_id || 0)}`,
          ) || null,
        changed_fields: parseAuditChangedFields(row.changed_fields),
        ...aiUsage,
      };
    }),
  });
});

export default router;
