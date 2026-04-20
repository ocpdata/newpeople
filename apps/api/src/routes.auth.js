import express from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query, withTransaction } from "./db.js";
import { normalizeEmail, signToken } from "./utils.js";
import { authRequired, loadUser } from "./auth.js";

const router = express.Router();

const registerSchema = z.object({
  fullName: z.string().min(3).max(160),
  email: z.string().email(),
  password: z.string().min(8).max(72),
  mobile: z.string().max(30).optional(),
  description: z.string().max(2000).optional(),
  avatarUrl: z.string().url().max(500).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
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
         (full_name, email, description, registered_at, avatar_url, mobile, status, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        [
          fullName,
          email,
          parsed.data.description || null,
          now,
          parsed.data.avatarUrl || null,
          parsed.data.mobile || null,
          passwordHash,
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
    return res.status(401).json({ message: "Credenciales invalidas" });
  }

  const user = rows[0];
  const ok = await bcrypt.compare(parsed.data.password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ message: "Credenciales invalidas" });
  }

  if (user.status !== "active") {
    return res.status(403).json({ message: "Usuario inactivo" });
  }

  const now = new Date();
  await query(
    "UPDATE users SET last_visit_at = ?, updated_at = ? WHERE id = ?",
    [now, now, user.id],
  );

  const token = signToken(user);
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

router.get("/me", authRequired, loadUser, async (req, res) => {
  const { permissionSet, ...user } = req.user;
  res.json({
    ...user,
    permissions: Array.from(permissionSet),
  });
});

export default router;
