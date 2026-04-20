import express from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod";
import { query } from "./db.js";
import { normalizeEmail, sendUserInvitationEmail } from "./utils.js";
import { config } from "./config.js";
import { requirePermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";

const router = express.Router();

async function audit(action, performedByUserId, affectedUserId, detail = null) {
  try {
    await query(
      "INSERT INTO user_audit_log (action, performed_by_user_id, affected_user_id, detail, created_at) VALUES (?, ?, ?, ?, ?)",
      [
        action,
        performedByUserId || null,
        affectedUserId || null,
        detail ? JSON.stringify(detail) : null,
        new Date(),
      ],
    );
  } catch (error) {
    console.error("Audit log error:", error.message);
  }
}

const createUserSchema = z.object({
  fullName: z.string().min(3).max(160),
  email: z.string().email(),
  description: z.string().max(2000).optional(),
  mobile: z.string().max(30).optional(),
  avatarUrl: z.string().url().max(500).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  roleIds: z.array(z.number().int().positive()).optional(),
});

router.get("/audit", requirePermission("usuarios.read"), async (_req, res) => {
  const rows = await query(
    `SELECT l.id, l.action, l.detail, l.created_at,
            pb.full_name AS performed_by_name, pb.email AS performed_by_email,
            au.full_name AS affected_user_name, au.email AS affected_user_email
     FROM user_audit_log l
     LEFT JOIN users pb ON pb.id = l.performed_by_user_id
     LEFT JOIN users au ON au.id = l.affected_user_id
     ORDER BY l.created_at DESC
     LIMIT 100`,
  );
  res.json(rows);
});

router.get("/", requirePermission("usuarios.read"), async (_req, res) => {
  const rows = await query(
    `SELECT u.id, u.full_name, u.email, u.description, u.registered_at, u.last_visit_at,
            u.created_at, u.updated_at,
            u.avatar_url, u.mobile, u.status,
            GROUP_CONCAT(r.name ORDER BY r.name SEPARATOR ', ') AS roles
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     GROUP BY u.id
     ORDER BY u.id DESC`,
  );
  res.json(rows);
});

router.post(
  "/test-invite-email",
  requirePermission("usuarios.create"),
  async (req, res) => {
    const parsed = z
      .object({
        email: z.string().email(),
        fullName: z.string().min(1).max(160).optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
    }

    const email = normalizeEmail(parsed.data.email);
    const inviteUrl = `${config.app.inviteSetupUrl}?email=${encodeURIComponent(email)}`;

    try {
      const result = await sendUserInvitationEmail({
        to: email,
        fullName: parsed.data.fullName || "Usuario",
        inviteUrl,
      });

      if (result.sent) {
        return res.json({ message: "Correo de prueba enviado correctamente" });
      }

      return res.status(202).json({
        message: "SMTP no configurado. Correo de prueba pendiente",
        detail: result.reason || "unknown",
      });
    } catch (error) {
      return res.status(500).json({
        message: "No fue posible enviar el correo de prueba",
        detail: String(error?.message || error),
      });
    }
  },
);

router.post("/", requirePermission("usuarios.create"), async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
  }

  const body = parsed.data;
  const email = normalizeEmail(body.email);

  const existing = await query("SELECT id FROM users WHERE email = ?", [email]);
  if (existing.length > 0) {
    return res.status(409).json({ message: "El email ya existe." });
  }

  const now = new Date();
  const temporaryPassword = crypto.randomBytes(32).toString("hex");
  const hash = await bcrypt.hash(temporaryPassword, 10);

  const insert = await query(
    `INSERT INTO users
      (full_name, email, description, registered_at, avatar_url, mobile, status, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      body.fullName,
      email,
      body.description || null,
      now,
      body.avatarUrl || null,
      body.mobile || null,
      body.status || "active",
      hash,
      now,
      now,
    ],
  );

  const userId = insert.insertId;
  if (Array.isArray(body.roleIds) && body.roleIds.length > 0) {
    for (const roleId of body.roleIds) {
      await query(
        "INSERT INTO user_roles (user_id, role_id, created_at) VALUES (?, ?, ?)",
        [userId, roleId, now],
      );
    }
  }

  const inviteUrl = `${config.app.inviteSetupUrl}?email=${encodeURIComponent(email)}`;
  let inviteEmailSent = false;
  try {
    const inviteResult = await sendUserInvitationEmail({
      to: email,
      fullName: body.fullName,
      inviteUrl,
    });
    inviteEmailSent = Boolean(inviteResult.sent);
  } catch (mailError) {
    console.error("No fue posible enviar correo de invitacion:", mailError);
  }

  await audit("created", req.user?.id, userId, {
    email,
    fullName: body.fullName,
  });

  await logAuditEvent({
    req,
    module: "usuarios",
    action: "created",
    entityType: "user",
    entityId: userId,
    detail: "Usuario creado",
    after: {
      full_name: body.fullName,
      email,
      mobile: body.mobile || null,
      status: body.status || "active",
      role_ids: Array.isArray(body.roleIds) ? body.roleIds : [],
    },
  });

  res.status(201).json({
    id: userId,
    inviteEmailSent,
    message: inviteEmailSent
      ? "Usuario creado y correo de invitacion enviado"
      : "Usuario creado. Correo de invitacion pendiente",
  });
});

router.patch(
  "/:id/status",
  requirePermission("usuarios.update"),
  async (req, res) => {
    const userId = Number(req.params.id);
    const parsed = z
      .object({ status: z.enum(["active", "inactive"]) })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Estado invalido" });
    }

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ message: "Id de usuario invalido" });
    }

    const users = await query(
      "SELECT id, status FROM users WHERE id = ? LIMIT 1",
      [userId],
    );
    if (users.length === 0) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const previousStatus = users[0].status;

    await query("UPDATE users SET status = ?, updated_at = ? WHERE id = ?", [
      parsed.data.status,
      new Date(),
      userId,
    ]);

    await audit("status_changed", req.user?.id, userId, {
      status: parsed.data.status,
    });

    await logAuditEvent({
      req,
      module: "usuarios",
      action: "status_changed",
      entityType: "user",
      entityId: userId,
      detail: "Estado de usuario actualizado",
      before: { status: previousStatus },
      after: { status: parsed.data.status },
    });

    res.json({
      message:
        parsed.data.status === "active"
          ? "Usuario activado"
          : "Usuario desactivado",
    });
  },
);

router.post(
  "/:id/reset-password-invite",
  requirePermission("usuarios.update"),
  async (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ message: "Id de usuario invalido" });
    }

    const rows = await query(
      "SELECT id, full_name, email FROM users WHERE id = ? LIMIT 1",
      [userId],
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const user = rows[0];
    const inviteUrl = `${config.app.inviteSetupUrl}?email=${encodeURIComponent(user.email)}`;

    try {
      const result = await sendUserInvitationEmail({
        to: user.email,
        fullName: user.full_name,
        inviteUrl,
      });

      if (result.sent) {
        await audit("password_reset_sent", req.user?.id, userId);
        await logAuditEvent({
          req,
          module: "usuarios",
          action: "password_reset_sent",
          entityType: "user",
          entityId: userId,
          detail: "Invitacion de reinicio enviada",
        });
        return res.json({
          message: `Correo de reinicio enviado a ${user.email}`,
        });
      }

      return res.status(202).json({
        message: "SMTP no configurado. Correo de reinicio pendiente",
        detail: result.reason || "unknown",
      });
    } catch (error) {
      return res.status(500).json({
        message: "No fue posible enviar correo de reinicio",
        detail: String(error?.message || error),
      });
    }
  },
);

router.put("/:id", requirePermission("usuarios.update"), async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "Id de usuario invalido" });
  }

  const parsed = z
    .object({
      fullName: z.string().min(3).max(160).optional(),
      email: z.string().email().optional(),
      mobile: z.string().max(30).optional().nullable(),
      roleIds: z.array(z.number().int().positive()).optional(),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
  }

  const rows = await query("SELECT id FROM users WHERE id = ? LIMIT 1", [
    userId,
  ]);
  if (rows.length === 0) {
    return res.status(404).json({ message: "Usuario no encontrado" });
  }

  const [beforeUser] = await query(
    "SELECT id, full_name, email, mobile, status FROM users WHERE id = ? LIMIT 1",
    [userId],
  );
  const beforeRoleRows = await query(
    "SELECT role_id FROM user_roles WHERE user_id = ? ORDER BY role_id",
    [userId],
  );

  const body = parsed.data;
  const now = new Date();

  if (
    body.fullName !== undefined ||
    body.email !== undefined ||
    body.mobile !== undefined
  ) {
    const fields = [];
    const values = [];
    if (body.fullName !== undefined) {
      fields.push("full_name = ?");
      values.push(body.fullName);
    }
    if (body.email !== undefined) {
      const newEmail = normalizeEmail(body.email);
      const conflict = await query(
        "SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1",
        [newEmail, userId],
      );
      if (conflict.length > 0) {
        return res
          .status(409)
          .json({ message: "El email ya esta en uso por otro usuario" });
      }
      fields.push("email = ?");
      values.push(newEmail);
    }
    if (body.mobile !== undefined) {
      fields.push("mobile = ?");
      values.push(body.mobile || null);
    }
    fields.push("updated_at = ?");
    values.push(now);
    values.push(userId);
    await query(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, values);
  }

  if (Array.isArray(body.roleIds)) {
    await query("DELETE FROM user_roles WHERE user_id = ?", [userId]);
    for (const roleId of body.roleIds) {
      await query(
        "INSERT INTO user_roles (user_id, role_id, created_at) VALUES (?, ?, ?)",
        [userId, roleId, now],
      );
    }
  }

  await audit("updated", req.user?.id, userId, {
    fields: Object.keys(body).filter((k) => k !== "roleIds"),
    rolesUpdated: Array.isArray(body.roleIds),
  });

  const [afterUser] = await query(
    "SELECT id, full_name, email, mobile, status FROM users WHERE id = ? LIMIT 1",
    [userId],
  );
  const afterRoleRows = await query(
    "SELECT role_id FROM user_roles WHERE user_id = ? ORDER BY role_id",
    [userId],
  );

  await logAuditEvent({
    req,
    module: "usuarios",
    action: "updated",
    entityType: "user",
    entityId: userId,
    detail: "Usuario actualizado",
    before: {
      full_name: beforeUser?.full_name || null,
      email: beforeUser?.email || null,
      mobile: beforeUser?.mobile || null,
      status: beforeUser?.status || null,
      role_ids: beforeRoleRows.map((row) => Number(row.role_id)),
    },
    after: {
      full_name: afterUser?.full_name || null,
      email: afterUser?.email || null,
      mobile: afterUser?.mobile || null,
      status: afterUser?.status || null,
      role_ids: afterRoleRows.map((row) => Number(row.role_id)),
    },
  });

  res.json({ message: "Usuario actualizado" });
});

router.put(
  "/:id/roles",
  requirePermission("roles.assign"),
  async (req, res) => {
    const userId = Number(req.params.id);
    const parsed = z
      .object({ roleIds: z.array(z.number().int().positive()) })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Payload invalido" });
    }

    await query("DELETE FROM user_roles WHERE user_id = ?", [userId]);
    const now = new Date();
    for (const roleId of parsed.data.roleIds) {
      await query(
        "INSERT INTO user_roles (user_id, role_id, created_at) VALUES (?, ?, ?)",
        [userId, roleId, now],
      );
    }

    await logAuditEvent({
      req,
      module: "usuarios",
      action: "roles_assigned",
      entityType: "user",
      entityId: userId,
      detail: "Roles asignados al usuario",
      after: {
        role_ids: parsed.data.roleIds.map(Number),
      },
    });

    res.json({ message: "Roles actualizados" });
  },
);

export default router;
