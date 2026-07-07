import express from "express";
import { z } from "zod";
import { query } from "./db.js";
import { requirePermission } from "./auth.js";
import { parseAuditChangedFields } from "./audit.js";

const router = express.Router();

function buildInPlaceholders(values = []) {
  return values.map(() => "?").join(", ");
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
        .filter(
          (row) => row.entity_type === "account" && Number(row.entity_id),
        )
        .map((row) => Number(row.entity_id)),
    ),
  );
  const contactEntityIds = Array.from(
    new Set(
      rows
        .filter(
          (row) => row.entity_type === "contact" && Number(row.entity_id),
        )
        .map((row) => Number(row.entity_id)),
    ),
  );

  const entityNames = new Map();

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

  res.json({
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items: rows.map((row) => ({
      ...row,
      entity_name:
        entityNames.get(`${String(row.entity_type || "")}:${Number(row.entity_id || 0)}`) ||
        null,
      changed_fields: parseAuditChangedFields(row.changed_fields),
    })),
  });
});

export default router;
