import express from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query } from "./db.js";
import { buildInviteSetupUrl, normalizeEmail, sendUserInvitationEmail } from "./utils.js";
import { requirePermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import { issuePasswordSetupToken } from "./passwordSetupTokens.js";

const router = express.Router();

const avatarUrlValueSchema = z
  .string()
  .max(3_000_000)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return true;
      }
      return parsed.protocol === "data:" && value.startsWith("data:image/");
    } catch {
      return false;
    }
  }, "Avatar invalido");

const avatarUrlSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  avatarUrlValueSchema.optional(),
);

const nullableAvatarUrlSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  avatarUrlValueSchema.nullable().optional(),
);

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

async function logInviteDeliveryFailure({ req, userId, email, result, action, detail }) {
  await audit(action, req.user?.id, userId, {
    email,
    reason: result.reason || "unknown",
    detail: result.detail || null,
    purpose: result.purpose || null,
    expiresAt: result.expiresAt || null,
  });

  await logAuditEvent({
    req,
    module: "usuarios",
    action,
    entityType: "user",
    entityId: userId,
    status: "error",
    detail,
    after: {
      email,
      invite_email_sent: false,
      invite_email_reason: result.reason || "unknown",
      invite_email_detail: result.detail || null,
      invite_purpose: result.purpose || null,
      invite_expires_at: result.expiresAt || null,
    },
  });
}

const createUserSchema = z.object({
  fullName: z.string().min(3).max(160),
  email: z.string().email(),
  description: z.string().max(2000).optional(),
  mobile: z.string().max(30).optional(),
  avatarUrl: avatarUrlSchema.optional(),
  status: z.enum(["active", "inactive"]).optional(),
  roleIds: z.array(z.number().int().positive()).optional(),
});

async function getActiveAccountsWithoutAlternativeOwners(userId) {
  const rows = await query(
    `SELECT a.id, a.name
     FROM accounts a
     INNER JOIN account_owners ao_target
       ON ao_target.account_id = a.id AND ao_target.user_id = ?
     INNER JOIN account_activation_statuses aas
       ON aas.id = a.activation_status_id AND aas.code = 'activada'
     LEFT JOIN account_owners ao_other
       ON ao_other.account_id = a.id AND ao_other.user_id <> ?
     LEFT JOIN users u_other
       ON u_other.id = ao_other.user_id AND u_other.status = 'active'
     GROUP BY a.id, a.name
     HAVING COUNT(u_other.id) = 0
     ORDER BY a.name, a.id`,
    [userId, userId],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
  }));
}

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
            uc.full_name AS created_by_name,
            uu.full_name AS updated_by_name,
            u.avatar_url, u.mobile, u.status,
            GROUP_CONCAT(r.name ORDER BY r.name SEPARATOR ', ') AS roles
     FROM users u
     LEFT JOIN users uc ON uc.id = u.created_by
     LEFT JOIN users uu ON uu.id = u.updated_by
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
    const inviteUrl = buildInviteSetupUrl("preview-token");

    const result = await sendUserInvitationEmail({
      to: email,
      fullName: parsed.data.fullName || "Usuario",
      inviteUrl,
      purpose: "invite",
    });

    if (result.sent) {
      return res.json({ message: "Correo de prueba enviado correctamente" });
    }

    return res.status(502).json({
      message: "No fue posible enviar el correo de prueba",
      reason: result.reason || "unknown",
      detail: result.detail || null,
    });
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
  const temporaryPassword = await bcrypt.hash(`pending:${email}:${now.getTime()}`, 10);

  const insert = await query(
    `INSERT INTO users
      (full_name, email, description, registered_at, avatar_url, mobile, status, password_hash, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      body.fullName,
      email,
      body.description || null,
      now,
      body.avatarUrl || null,
      body.mobile || null,
      body.status || "active",
      temporaryPassword,
      req.user?.id || null,
      req.user?.id || null,
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

  const passwordSetupInvite = await issuePasswordSetupToken({
    userId,
    purpose: "invite",
    createdBy: req.user?.id || null,
  });
  const inviteUrl = passwordSetupInvite.inviteUrl;
  const inviteResult = await sendUserInvitationEmail({
    to: email,
    fullName: body.fullName,
    inviteUrl,
    purpose: passwordSetupInvite.purpose,
    expiresAt: passwordSetupInvite.expiresAt,
  });
  const inviteEmailSent = Boolean(inviteResult.sent);

  await audit("created", req.user?.id, userId, {
    email,
    fullName: body.fullName,
    inviteEmailSent,
    inviteEmailReason: inviteResult.reason || null,
    inviteEmailDetail: inviteResult.detail || null,
    invitePurpose: passwordSetupInvite.purpose,
    inviteExpiresAt: passwordSetupInvite.expiresAt,
  });

  await logAuditEvent({
    req,
    module: "usuarios",
    action: "created",
    entityType: "user",
    entityId: userId,
    detail: inviteEmailSent
      ? "Usuario creado"
      : `Usuario creado. Invitacion pendiente: ${inviteResult.reason || "unknown"}`,
    after: {
      full_name: body.fullName,
      email,
      mobile: body.mobile || null,
      status: body.status || "active",
      role_ids: Array.isArray(body.roleIds) ? body.roleIds : [],
      invite_email_sent: inviteEmailSent,
      invite_email_reason: inviteResult.reason || null,
      invite_email_detail: inviteResult.detail || null,
      invite_purpose: passwordSetupInvite.purpose,
      invite_expires_at: passwordSetupInvite.expiresAt,
    },
  });

  if (!inviteEmailSent) {
    await logInviteDeliveryFailure({
      req,
      userId,
      email,
      result: {
        ...inviteResult,
        purpose: passwordSetupInvite.purpose,
        expiresAt: passwordSetupInvite.expiresAt,
      },
      action: "invitation_email_failed",
      detail: `No fue posible enviar la invitacion al crear el usuario: ${inviteResult.reason || "unknown"}`,
    });
  }

  res.status(201).json({
    id: userId,
    inviteEmailSent,
    inviteEmailReason: inviteResult.reason || null,
    inviteEmailDetail: inviteResult.detail || null,
    inviteExpiresAt: passwordSetupInvite.expiresAt,
    inviteSetupUrl: inviteEmailSent ? null : inviteUrl,
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

    if (parsed.data.status === "inactive" && previousStatus !== "inactive") {
      const blockedAccounts = await getActiveAccountsWithoutAlternativeOwners(userId);
      if (blockedAccounts.length > 0) {
        return res.status(409).json({
          message:
            "No es posible desactivar al usuario porque dejaria cuentas activas sin propietarios activos",
          accounts: blockedAccounts,
        });
      }
    }

    await query("UPDATE users SET status = ?, updated_by = ?, updated_at = ? WHERE id = ?", [
      parsed.data.status,
      req.user?.id || null,
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
    const passwordSetupInvite = await issuePasswordSetupToken({
      userId,
      purpose: "reset",
      createdBy: req.user?.id || null,
    });
    const inviteUrl = passwordSetupInvite.inviteUrl;

    const result = await sendUserInvitationEmail({
      to: user.email,
      fullName: user.full_name,
      inviteUrl,
      purpose: passwordSetupInvite.purpose,
      expiresAt: passwordSetupInvite.expiresAt,
    });

    if (result.sent) {
      await audit("password_reset_sent", req.user?.id, userId, {
        purpose: passwordSetupInvite.purpose,
        expiresAt: passwordSetupInvite.expiresAt,
      });
      await logAuditEvent({
        req,
        module: "usuarios",
        action: "password_reset_sent",
        entityType: "user",
        entityId: userId,
        detail: "Invitacion de reinicio enviada",
        after: {
          invite_purpose: passwordSetupInvite.purpose,
          invite_expires_at: passwordSetupInvite.expiresAt,
        },
      });
      return res.json({
        message: `Correo de reinicio enviado a ${user.email}`,
        inviteExpiresAt: passwordSetupInvite.expiresAt,
      });
    }

    await logInviteDeliveryFailure({
      req,
      userId,
      email: user.email,
      result: {
        ...result,
        purpose: passwordSetupInvite.purpose,
        expiresAt: passwordSetupInvite.expiresAt,
      },
      action: "password_reset_failed",
      detail: `No fue posible enviar la invitacion de reinicio: ${result.reason || "unknown"}`,
    });

    return res.status(502).json({
      message: "No fue posible enviar correo de reinicio",
      reason: result.reason || "unknown",
      detail: result.detail || null,
      inviteSetupUrl: inviteUrl,
      inviteExpiresAt: passwordSetupInvite.expiresAt,
    });
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
      avatarUrl: nullableAvatarUrlSchema,
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
    body.mobile !== undefined ||
    body.avatarUrl !== undefined
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
    if (body.avatarUrl !== undefined) {
      fields.push("avatar_url = ?");
      values.push(body.avatarUrl || null);
    }
    fields.push("updated_by = ?");
    values.push(req.user?.id || null);
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
