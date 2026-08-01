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
      `EXISTS (
        SELECT 1
        FROM audit_log_ai_usage lau
        WHERE lau.audit_log_id = l.id
      )`,
    );
  } else if (filters.aiUsage === "without_ai") {
    where.push(
      `NOT EXISTS (
        SELECT 1
        FROM audit_log_ai_usage lau
        WHERE lau.audit_log_id = l.id
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

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const page = filters.page;
  const pageSize = filters.pageSize;
  const offset = (page - 1) * pageSize;

  const countRows = await query(
    `SELECT COUNT(*) AS total
     FROM audit_log l
     ${whereSql}`,
    params,
  );

  const total = Number(countRows[0]?.total || 0);

  const rows = await query(
    `SELECT l.id, l.module, l.action, l.entity_type, l.entity_id,
            l.status, l.detail, l.changed_fields,
            l.performed_by_user_id, l.performed_by_name, l.performed_by_email,
            l.created_at
     FROM audit_log l
     ${whereSql}
     ORDER BY l.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
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
      const aiUsage = aiUsageByAuditId.get(Number(row.id || 0)) || {
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
