import express from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query, withTransaction } from "./db.js";
import { normalizeEmail, signToken } from "./utils.js";
import { authRequired, loadUser } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import {
  consumePasswordSetupToken,
  findPasswordSetupToken,
  resolvePasswordSetupTokenState,
} from "./passwordSetupTokens.js";

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

const registerSchema = z.object({
  fullName: z.string().min(3).max(160),
  email: z.string().email(),
  password: z.string().min(8).max(72),
  mobile: z.string().max(30).optional(),
  description: z.string().max(2000).optional(),
  avatarUrl: avatarUrlSchema.optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
});

const setPasswordSchema = z.object({
  token: z.string().min(32).max(255),
  password: z.string().min(8).max(72),
});

const setPasswordContextSchema = z.object({
  token: z.string().min(32).max(255),
});

router.get("/bootstrap-status", async (_req, res) => {
  const rows = await query("SELECT COUNT(*) AS count FROM users");
  res.json({ hasUsers: Number(rows[0].count) > 0 });
});

router.post("/register-first", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
  }

  const { fullName, password } = parsed.data;
  const email = normalizeEmail(parsed.data.email);
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const result = await withTransaction(async (conn) => {
      const [countRows] = await conn.query(
        "SELECT COUNT(*) AS count FROM users FOR UPDATE",
      );
      if (Number(countRows[0].count) > 0) {
        throw new Error("FIRST_USER_ALREADY_EXISTS");
      }

      const now = new Date();

      const [roleRows] = await conn.query(
        "SELECT id FROM roles WHERE name = ?",
        ["Administrador"],
      );
      let adminRoleId;
      if (roleRows.length > 0) {
        adminRoleId = roleRows[0].id;
      } else {
        const [roleInsert] = await conn.query(
          "INSERT INTO roles (name, description, is_system, created_at, updated_at) VALUES (?, ?, 1, ?, ?)",
          ["Administrador", "Acceso total", now, now],
        );
        adminRoleId = roleInsert.insertId;
      }

      const [existsRows] = await conn.query(
        "SELECT id FROM users WHERE email = ?",
        [email],
      );
      if (existsRows.length > 0) {
        throw new Error("EMAIL_ALREADY_EXISTS");
      }

      const [userInsert] = await conn.query(
        `INSERT INTO users
         (full_name, email, description, registered_at, avatar_url, mobile, status, password_hash, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
        [
          fullName,
          email,
          parsed.data.description || null,
          now,
          parsed.data.avatarUrl || null,
          parsed.data.mobile || null,
          passwordHash,
          null,
          null,
          now,
          now,
        ],
      );

      await conn.query(
        "INSERT INTO user_roles (user_id, role_id, created_at) VALUES (?, ?, ?)",
        [userInsert.insertId, adminRoleId, now],
      );

      return {
        id: userInsert.insertId,
        email,
        full_name: fullName,
      };
    });

    const token = signToken(result);
    await logAuditEvent({
      req,
      module: "auth",
      action: "register_first",
      entityType: "user",
      entityId: result.id,
      detail: "Primer usuario administrador registrado",
      after: {
        full_name: result.full_name,
        email: result.email,
        status: "active",
      },
    });
    return res.status(201).json({ token, user: result });
  } catch (error) {
    if (error.message === "FIRST_USER_ALREADY_EXISTS") {
      return res
        .status(409)
        .json({ message: "Ya existe al menos un usuario. Usa login." });
    }
    if (error.message === "EMAIL_ALREADY_EXISTS") {
      return res.status(409).json({ message: "El email ya existe." });
    }
    return res
      .status(500)
      .json({ message: "No fue posible crear el primer usuario" });
  }
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
  }

  const email = normalizeEmail(parsed.data.email);
  const rows = await query("SELECT * FROM users WHERE email = ?", [email]);
  if (rows.length === 0) {
    await logAuditEvent({
      req,
      actor: { email },
      module: "auth",
      action: "login_failed",
      entityType: "user",
      detail: "Intento de login con usuario inexistente",
      status: "error",
      after: { email },
    });
    return res.status(401).json({ message: "Credenciales invalidas" });
  }

  const user = rows[0];
  const ok = await bcrypt.compare(parsed.data.password, user.password_hash);
  if (!ok) {
    await logAuditEvent({
      req,
      actor: { id: user.id, full_name: user.full_name, email: user.email },
      module: "auth",
      action: "login_failed",
      entityType: "user",
      entityId: user.id,
      detail: "Intento de login con password invalido",
      status: "error",
    });
    return res.status(401).json({ message: "Credenciales invalidas" });
  }

  if (user.status !== "active") {
    await logAuditEvent({
      req,
      actor: { id: user.id, full_name: user.full_name, email: user.email },
      module: "auth",
      action: "login_failed",
      entityType: "user",
      entityId: user.id,
      detail: "Intento de login con usuario inactivo",
      status: "error",
      before: { status: user.status },
    });
    return res.status(403).json({ message: "Usuario inactivo" });
  }

  const now = new Date();
  await query(
    "UPDATE users SET last_visit_at = ?, updated_at = ? WHERE id = ?",
    [now, now, user.id],
  );

  const token = signToken(user);
  await logAuditEvent({
    req,
    actor: { id: user.id, full_name: user.full_name, email: user.email },
    module: "auth",
    action: "login_success",
    entityType: "user",
    entityId: user.id,
    detail: "Inicio de sesion exitoso",
    before: { last_visit_at: user.last_visit_at || null },
    after: { last_visit_at: now },
  });

  return res.json({
    token,
    user: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      status: user.status,
    },
  });
});

router.get("/set-password-context", async (req, res) => {
  const parsed = setPasswordContextSchema.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
  }

  const record = await findPasswordSetupToken(parsed.data.token);
  const state = resolvePasswordSetupTokenState(record);

  if (state === "invalid") {
    return res.status(404).json({ message: "El enlace no es valido o ya no existe" });
  }

  if (state === "used") {
    return res.status(409).json({ message: "Este enlace ya fue utilizado" });
  }

  if (state === "expired") {
    return res.status(410).json({ message: "Este enlace ya expiro" });
  }

  if (state === "inactive") {
    return res.status(403).json({ message: "Usuario inactivo" });
  }

  return res.json({
    email: record.email,
    fullName: record.full_name,
    expiresAt: record.expires_at,
    purpose: record.purpose,
  });
});

router.post("/set-password", async (req, res) => {
  const parsed = setPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Datos invalidos", errors: parsed.error.flatten() });
  }

  const record = await findPasswordSetupToken(parsed.data.token);
  const state = resolvePasswordSetupTokenState(record);

  if (state === "invalid") {
    await logAuditEvent({
      req,
      module: "auth",
      action: "set_password_failed",
      entityType: "user",
      detail: "Intento de configurar password con token invalido",
      status: "error",
    });
    return res.status(404).json({ message: "El enlace no es valido o ya no existe" });
  }

  if (state === "used") {
    await logAuditEvent({
      req,
      actor: { id: record.user_id, full_name: record.full_name, email: record.email },
      module: "auth",
      action: "set_password_failed",
      entityType: "user",
      entityId: record.user_id,
      detail: "Intento de reutilizar un enlace de password ya consumido",
      status: "error",
      after: { purpose: record.purpose },
    });
    return res.status(409).json({ message: "Este enlace ya fue utilizado" });
  }

  if (state === "expired") {
    await logAuditEvent({
      req,
      actor: { id: record.user_id, full_name: record.full_name, email: record.email },
      module: "auth",
      action: "set_password_failed",
      entityType: "user",
      entityId: record.user_id,
      detail: "Intento de configurar password con enlace expirado",
      status: "error",
      before: { expires_at: record.expires_at, purpose: record.purpose },
    });
    return res.status(410).json({ message: "Este enlace ya expiro" });
  }

  if (state === "inactive") {
    await logAuditEvent({
      req,
      actor: { id: record.user_id, full_name: record.full_name, email: record.email },
      module: "auth",
      action: "set_password_failed",
      entityType: "user",
      entityId: record.user_id,
      detail: "Intento de configurar password para usuario inactivo",
      status: "error",
      before: { status: record.status },
    });
    return res.status(403).json({ message: "Usuario inactivo" });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const now = new Date();
  try {
    await consumePasswordSetupToken({
      tokenId: record.id,
      userId: record.user_id,
      passwordHash,
      now,
    });
  } catch (error) {
    if (error.message === "PASSWORD_SETUP_TOKEN_NOT_AVAILABLE") {
      return res.status(409).json({ message: "Este enlace ya fue utilizado" });
    }
    throw error;
  }

  const token = signToken({
    id: record.user_id,
    email: record.email,
    full_name: record.full_name,
  });
  await logAuditEvent({
    req,
    actor: { id: record.user_id, full_name: record.full_name, email: record.email },
    module: "auth",
    action: "password_set",
    entityType: "user",
    entityId: record.user_id,
    detail: "Password configurada desde enlace de invitacion o reinicio",
    after: { updated_at: now, purpose: record.purpose },
  });

  return res.json({
    token,
    user: {
      id: record.user_id,
      full_name: record.full_name,
      email: record.email,
      status: record.status,
    },
    message: "Contrasena configurada correctamente",
  });
});

router.get("/me", authRequired, loadUser, async (req, res) => {
  const { permissionSet, ...user } = req.user;
  res.json({
    ...user,
    permissions: Array.from(permissionSet),
  });
});

export default router;
