import express from "express";
import { z } from "zod";
import { query } from "./db.js";
import { requirePermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";

const router = express.Router();

router.get("/", requirePermission("roles.read"), async (req, res) => {
  const includeInactive = String(req.query.includeInactive || "") === "1";
  const rows = await query(
    `SELECT r.id, r.name, r.description, r.is_system, r.is_active,
            r.created_at, r.updated_at,
            r.created_by_user_id, r.updated_by_user_id,
            uc.full_name AS created_by_user_name,
            uu.full_name AS updated_by_user_name,
            (
              SELECT COUNT(*)
              FROM role_permissions rp
              WHERE rp.role_id = r.id
            ) AS permissions_count
     FROM roles r
     LEFT JOIN users uc ON uc.id = r.created_by_user_id
     LEFT JOIN users uu ON uu.id = r.updated_by_user_id
     ${includeInactive ? "" : "WHERE r.is_active = 1"}
     ORDER BY r.name`,
  );
  res.json(rows);
});

router.post("/", requirePermission("roles.create"), async (req, res) => {
  const parsed = z
    .object({
      name: z.string().min(2).max(80),
      description: z.string().max(255).optional(),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
  }

  const now = new Date();
  const actorUserId = Number(req.user?.id) || null;
  const name = parsed.data.name.trim();
  const description = parsed.data.description?.trim() || null;
  const existing = await query("SELECT id FROM roles WHERE name = ? LIMIT 1", [
    name,
  ]);
  if (existing.length > 0) {
    return res.status(409).json({ message: "El nombre del rol ya existe." });
  }
  const result = await query(
    "INSERT INTO roles (name, description, is_system, is_active, created_by_user_id, updated_by_user_id, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?, ?, ?)",
    [
      name,
      description,
      actorUserId,
      actorUserId,
      now,
      now,
    ],
  );

  await logAuditEvent({
    req,
    module: "roles",
    action: "created",
    entityType: "role",
    entityId: result.insertId,
    detail: "Rol creado",
    after: {
      name,
      description,
      is_active: 1,
      is_system: 0,
    },
  });

  res.status(201).json({ id: result.insertId, message: "Rol creado" });
});

router.put("/:id", requirePermission("roles.update"), async (req, res) => {
  const roleId = Number(req.params.id);
  const parsed = z
    .object({
      name: z.string().min(2).max(80),
      description: z.string().max(255).optional(),
    })
    .safeParse(req.body);

  if (!Number.isInteger(roleId) || roleId <= 0) {
    return res.status(400).json({ message: "Id de rol invalido" });
  }
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
  }

  const roles = await query(
    "SELECT id, name, description, is_system, is_active FROM roles WHERE id = ? LIMIT 1",
    [roleId],
  );
  if (roles.length === 0) {
    return res.status(404).json({ message: "Rol no encontrado" });
  }

  const role = roles[0];
  if (Number(role.is_system) === 1) {
    return res.status(403).json({
      message: "No se puede editar un rol del sistema",
    });
  }

  const name = parsed.data.name.trim();
  const description = parsed.data.description?.trim() || null;
  const existing = await query(
    "SELECT id FROM roles WHERE name = ? AND id <> ? LIMIT 1",
    [name, roleId],
  );
  if (existing.length > 0) {
    return res.status(409).json({ message: "El nombre del rol ya existe." });
  }

  const now = new Date();
  await query(
    "UPDATE roles SET name = ?, description = ?, updated_by_user_id = ?, updated_at = ? WHERE id = ?",
    [name, description, Number(req.user?.id) || null, now, roleId],
  );

  await logAuditEvent({
    req,
    module: "roles",
    action: "updated",
    entityType: "role",
    entityId: roleId,
    detail: "Rol actualizado",
    before: {
      name: role.name,
      description: role.description || null,
    },
    after: {
      name,
      description,
    },
  });

  res.json({ message: "Rol actualizado" });
});

router.patch(
  "/:id/status",
  requirePermission("roles.update"),
  async (req, res) => {
    const roleId = Number(req.params.id);
    const parsed = z.object({ isActive: z.boolean() }).safeParse(req.body);

    if (!Number.isInteger(roleId) || roleId <= 0) {
      return res.status(400).json({ message: "Id de rol invalido" });
    }
    if (!parsed.success) {
      return res.status(400).json({ message: "Payload invalido" });
    }

    const roles = await query(
      "SELECT id, name, is_system, is_active FROM roles WHERE id = ? LIMIT 1",
      [roleId],
    );
    if (roles.length === 0) {
      return res.status(404).json({ message: "Rol no encontrado" });
    }

    const role = roles[0];
    const previousIsActive = Number(role.is_active) === 1;
    if (Number(role.is_system) === 1) {
      return res.status(403).json({
        message: "No se puede cambiar el estado de un rol del sistema",
      });
    }

    await query(
      "UPDATE roles SET is_active = ?, updated_by_user_id = ?, updated_at = ? WHERE id = ?",
      [
        parsed.data.isActive ? 1 : 0,
        Number(req.user?.id) || null,
        new Date(),
        roleId,
      ],
    );

    await logAuditEvent({
      req,
      module: "roles",
      action: "status_changed",
      entityType: "role",
      entityId: roleId,
      detail: "Estado de rol actualizado",
      before: { is_active: previousIsActive },
      after: { is_active: parsed.data.isActive },
    });

    res.json({
      message: parsed.data.isActive
        ? `Rol ${role.name} activado`
        : `Rol ${role.name} desactivado`,
    });
  },
);

router.get(
  "/permissions",
  requirePermission("permissions.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, module, action, description FROM permissions ORDER BY code",
    );
    res.json(rows);
  },
);

router.get(
  "/:id/permissions",
  requirePermission("permissions.read"),
  async (req, res) => {
    const roleId = Number(req.params.id);
    if (!Number.isInteger(roleId) || roleId <= 0) {
      return res.status(400).json({ message: "Id de rol invalido" });
    }

    const rows = await query(
      `SELECT permission_id
       FROM role_permissions
       WHERE role_id = ?
       ORDER BY permission_id`,
      [roleId],
    );

    res.json({ permissionIds: rows.map((r) => Number(r.permission_id)) });
  },
);

router.get("/:id/users", requirePermission("roles.read"), async (req, res) => {
  const roleId = Number(req.params.id);
  if (!Number.isInteger(roleId) || roleId <= 0) {
    return res.status(400).json({ message: "Id de rol invalido" });
  }

  const rows = await query(
    `SELECT u.id, u.full_name, u.email, u.status
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       WHERE ur.role_id = ?
       ORDER BY u.full_name`,
    [roleId],
  );

  res.json(rows);
});

router.put(
  "/:id/permissions",
  requirePermission("roles.update"),
  async (req, res) => {
    const roleId = Number(req.params.id);
    const parsed = z
      .object({
        permissionIds: z.array(z.number().int().positive()),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ message: "Payload invalido" });
    }

    await query("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
    const now = new Date();
    for (const permissionId of parsed.data.permissionIds) {
      await query(
        "INSERT INTO role_permissions (role_id, permission_id, created_at) VALUES (?, ?, ?)",
        [roleId, permissionId, now],
      );
    }

    await query(
      "UPDATE roles SET updated_by_user_id = ?, updated_at = ? WHERE id = ?",
      [Number(req.user?.id) || null, now, roleId],
    );

    await logAuditEvent({
      req,
      module: "roles",
      action: "permissions_updated",
      entityType: "role",
      entityId: roleId,
      detail: "Permisos del rol actualizados",
      after: {
        permission_ids: parsed.data.permissionIds.map(Number),
      },
    });

    res.json({ message: "Permisos del rol actualizados" });
  },
);

export default router;
