import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { query, withTransaction } from "./db.js";
import {
  GOOGLE_GMAIL_SEND_SCOPE,
  encryptOpaqueSecret,
  hasGoogleMailSendScope,
  normalizeEmail,
  signToken,
} from "./utils.js";
import { authRequired, getUserAuthContext, loadUser } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import { config } from "./config.js";
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
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
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

let googleMailConnectionsTableEnsured = false;

function resolveAppBaseUrl() {
  if (config.app.baseUrl) {
    return String(config.app.baseUrl).replace(/\/$/, "");
  }

  try {
    return new URL(config.app.inviteSetupUrl).origin;
  } catch {
    return "http://localhost:5173";
  }
}

function resolveTrustedOauthReturnUrl(value) {
  const appBaseUrl = new URL(resolveAppBaseUrl());
  const fallbackUrl = new URL("/", appBaseUrl);
  const candidate = String(value || "").trim();

  if (!candidate) {
    return fallbackUrl;
  }

  try {
    const absoluteCandidate = new URL(candidate);
    if (
      ["http:", "https:"].includes(absoluteCandidate.protocol) &&
      (absoluteCandidate.origin === appBaseUrl.origin ||
        (isLoopbackHostname(absoluteCandidate.hostname) &&
          isLoopbackHostname(appBaseUrl.hostname)))
    ) {
      return absoluteCandidate;
    }
  } catch {
    // Continue to internal-path validation.
  }

  if (!candidate.startsWith("/") || candidate.startsWith("//")) {
    return fallbackUrl;
  }

  return new URL(candidate, appBaseUrl);
}

function createGoogleOauthState({ returnTo }) {
  const safeReturnToUrl = resolveTrustedOauthReturnUrl(returnTo);
  return jwt.sign(
    {
      provider: "google",
      aud: "oauth_state",
      returnTo: safeReturnToUrl.toString(),
    },
    config.jwtSecret,
    { expiresIn: "10m" },
  );
}

function resolveGoogleAuthUrl({ returnTo }) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.auth.google.clientId);
  url.searchParams.set("redirect_uri", config.auth.google.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("state", createGoogleOauthState({ returnTo }));
  return url.toString();
}

function resolveGoogleStartUrl() {
  return "/api/auth/oauth/google/start";
}

function resolveGoogleMailStartUrl() {
  return "/api/auth/google-mail/start";
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || "")
    .trim()
    .toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]"
  );
}

function resolveTrustedGoogleMailReturnUrl(value) {
  const appBaseUrl = new URL(resolveAppBaseUrl());
  const fallbackUrl = new URL("/proposals", appBaseUrl);
  const candidate = String(value || "").trim();

  if (!candidate) {
    return fallbackUrl;
  }

  try {
    const absoluteCandidate = new URL(candidate);
    if (
      ["http:", "https:"].includes(absoluteCandidate.protocol) &&
      (absoluteCandidate.origin === appBaseUrl.origin ||
        (isLoopbackHostname(absoluteCandidate.hostname) &&
          isLoopbackHostname(appBaseUrl.hostname)))
    ) {
      return absoluteCandidate;
    }
  } catch {
    // Continue to internal-path validation.
  }

  if (!candidate.startsWith("/") || candidate.startsWith("//")) {
    return fallbackUrl;
  }

  return new URL(candidate, appBaseUrl);
}

function createGoogleMailOauthState({ userId, returnTo }) {
  const safeReturnToUrl = resolveTrustedGoogleMailReturnUrl(returnTo);
  return jwt.sign(
    {
      provider: "google_mail",
      aud: "oauth_google_mail_state",
      sub: Number(userId || 0),
      returnTo: safeReturnToUrl.toString(),
    },
    config.jwtSecret,
    { expiresIn: "10m" },
  );
}

function resolveGoogleMailCallbackRedirect({ status, returnTo }) {
  const url = resolveTrustedGoogleMailReturnUrl(returnTo);

  url.searchParams.set("googleMailConnect", status || "failed");
  return url.toString();
}

function resolveGoogleMailAuthUrl({ userId, returnTo }) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.auth.google.clientId);
  url.searchParams.set("redirect_uri", config.auth.google.mailRedirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_GMAIL_SEND_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent select_account");
  url.searchParams.set(
    "state",
    createGoogleMailOauthState({ userId, returnTo }),
  );
  return url.toString();
}

async function exchangeGoogleCodeForToken(code) {
  const body = new URLSearchParams({
    code,
    client_id: config.auth.google.clientId,
    client_secret: config.auth.google.clientSecret,
    redirect_uri: config.auth.google.redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error("GOOGLE_TOKEN_EXCHANGE_FAILED");
  }

  return response.json();
}

async function fetchGoogleUserProfile(accessToken) {
  const response = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error("GOOGLE_PROFILE_FETCH_FAILED");
  }

  return response.json();
}

async function ensureGoogleMailConnectionsTable() {
  if (googleMailConnectionsTableEnsured) {
    return;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS user_google_mail_connections (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      google_email VARCHAR(190) NOT NULL,
      refresh_token_encrypted TEXT NOT NULL,
      scope_text VARCHAR(2000) NULL,
      last_connected_at DATETIME NOT NULL,
      revoked_at DATETIME NULL,
      last_error_code VARCHAR(120) NULL,
      last_error_at DATETIME NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_user_google_mail_connections_user (user_id),
      CONSTRAINT fk_user_google_mail_connections_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  googleMailConnectionsTableEnsured = true;
}

function redirectWithOauthError(res, reason, returnTo = "") {
  const url = resolveTrustedOauthReturnUrl(returnTo);
  url.searchParams.set("oauthError", reason || "oauth_failed");
  return res.redirect(url.toString());
}

router.get("/bootstrap-status", async (_req, res) => {
  const rows = await query("SELECT COUNT(*) AS count FROM users");
  res.json({ hasUsers: Number(rows[0].count) > 0 });
});

router.get("/oauth/providers", (_req, res) => {
  return res.json({
    google: {
      enabled: config.auth.google.enabled,
      startUrl: config.auth.google.enabled ? resolveGoogleStartUrl() : "",
    },
  });
});

router.get("/oauth/google/start", async (req, res) => {
  if (!config.auth.google.enabled) {
    return redirectWithOauthError(res, "google_disabled");
  }

  const returnTo = String(req.query.returnTo || "").trim();

  try {
    return res.redirect(resolveGoogleAuthUrl({ returnTo }));
  } catch {
    await logAuditEvent({
      req,
      module: "auth",
      action: "oauth_google_start_failed",
      entityType: "user",
      detail: "No fue posible iniciar el flujo OAuth con Google",
      status: "error",
    });
    return redirectWithOauthError(res, "oauth_start_failed", returnTo);
  }
});

router.get("/oauth/google/callback", async (req, res) => {
  const state = String(req.query.state || "");
  const code = String(req.query.code || "");
  const oauthError = String(req.query.error || "");

  if (!config.auth.google.enabled) {
    return redirectWithOauthError(res, "google_disabled");
  }

  if (oauthError) {
    await logAuditEvent({
      req,
      module: "auth",
      action: "oauth_google_callback_denied",
      entityType: "user",
      detail: `Google devolvio error: ${oauthError}`,
      status: "error",
    });
    return redirectWithOauthError(res, "google_denied");
  }

  if (!state || !code) {
    return redirectWithOauthError(res, "google_invalid_callback");
  }

  let payload;
  try {
    payload = jwt.verify(state, config.jwtSecret);
    if (
      payload?.provider === "google_mail" &&
      payload?.aud === "oauth_google_mail_state"
    ) {
      const callbackUrl = new URL(
        "/api/auth/google-mail/callback",
        `${req.protocol}://${req.get("host")}`,
      );
      Object.entries(req.query || {}).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          value.forEach((entry) => callbackUrl.searchParams.append(key, entry));
          return;
        }
        if (value !== undefined && value !== null) {
          callbackUrl.searchParams.set(key, String(value));
        }
      });
      return res.redirect(callbackUrl.toString());
    }

    if (payload?.aud !== "oauth_state" || payload?.provider !== "google") {
      return redirectWithOauthError(res, "google_invalid_state");
    }
  } catch {
    return redirectWithOauthError(res, "google_invalid_state");
  }

  const returnTo = String(payload?.returnTo || "").trim();

  try {
    const tokenResponse = await exchangeGoogleCodeForToken(code);
    const profile = await fetchGoogleUserProfile(tokenResponse.access_token);
    const email = normalizeEmail(profile?.email || "");

    if (!email) {
      return redirectWithOauthError(res, "google_email_missing", returnTo);
    }

    const rows = await query("SELECT * FROM users WHERE email = ?", [email]);
    if (rows.length === 0) {
      await logAuditEvent({
        req,
        actor: { email },
        module: "auth",
        action: "oauth_google_login_failed",
        entityType: "user",
        detail: "Intento OAuth con usuario inexistente",
        status: "error",
      });
      return redirectWithOauthError(res, "google_user_not_found", returnTo);
    }

    const user = rows[0];
    if (user.status !== "active") {
      await logAuditEvent({
        req,
        actor: { id: user.id, full_name: user.full_name, email: user.email },
        module: "auth",
        action: "oauth_google_login_failed",
        entityType: "user",
        entityId: user.id,
        detail: "Intento OAuth con usuario inactivo",
        status: "error",
      });
      return redirectWithOauthError(res, "google_user_inactive", returnTo);
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
      action: "oauth_google_login_success",
      entityType: "user",
      entityId: user.id,
      detail: "Inicio de sesion con Google exitoso",
      before: { last_visit_at: user.last_visit_at || null },
      after: { last_visit_at: now },
    });

    const redirectUrl = resolveTrustedOauthReturnUrl(returnTo);
    redirectUrl.searchParams.set("oauthToken", token);
    return res.redirect(redirectUrl.toString());
  } catch (error) {
    await logAuditEvent({
      req,
      module: "auth",
      action: "oauth_google_callback_failed",
      entityType: "user",
      detail: String(
        error?.message || "No fue posible completar OAuth con Google",
      ),
      status: "error",
    });
    return redirectWithOauthError(res, "google_callback_failed", returnTo);
  }
});

router.get("/google-mail/status", authRequired, loadUser, async (req, res) => {
  await ensureGoogleMailConnectionsTable();

  const rows = await query(
    `SELECT
      google_email,
      scope_text,
      revoked_at,
      last_error_code,
      last_connected_at,
      updated_at
    FROM user_google_mail_connections
    WHERE user_id = ?
    LIMIT 1`,
    [req.user.id],
  );

  const row = rows[0] || null;
  const connected = Boolean(row && !row.revoked_at);
  const hasScope = hasGoogleMailSendScope(row?.scope_text || "");
  const lastErrorCode = String(row?.last_error_code || "").toLowerCase();
  const reconnectErrorCodes = new Set([
    "invalid_grant",
    "invalid_token",
    "insufficient_permissions",
  ]);

  return res.json({
    connected,
    canSend: connected && hasScope,
    missingScope: connected && !hasScope,
    needsReconnect: connected && reconnectErrorCodes.has(lastErrorCode),
    googleEmail: row?.google_email || "",
    lastConnectedAt: row?.last_connected_at || null,
    updatedAt: row?.updated_at || null,
    startUrl: resolveGoogleMailStartUrl(),
  });
});

router.get("/google-mail/start", authRequired, loadUser, async (req, res) => {
  if (!config.auth.google.enabled) {
    return res.status(503).json({
      message: "La integracion con Google no esta habilitada",
      reason: "google_disabled",
    });
  }

  const returnTo = String(req.query.returnTo || "").trim();
  const responseMode = String(req.query.mode || "")
    .trim()
    .toLowerCase();

  try {
    const authUrl = resolveGoogleMailAuthUrl({
      userId: req.user.id,
      returnTo,
    });

    if (responseMode === "json") {
      return res.json({
        url: authUrl,
      });
    }

    return res.redirect(authUrl);
  } catch {
    if (responseMode === "json") {
      return res.status(500).json({
        message: "No fue posible iniciar la conexion con Google",
        reason: "google_mail_start_failed",
      });
    }

    return res.redirect(
      resolveGoogleMailCallbackRedirect({
        status: "failed",
        returnTo,
      }),
    );
  }
});

router.get("/google-mail/callback", async (req, res) => {
  const state = String(req.query.state || "");
  const code = String(req.query.code || "");
  const oauthError = String(req.query.error || "");

  if (!config.auth.google.enabled) {
    return res.redirect(
      resolveGoogleMailCallbackRedirect({
        status: "failed",
        returnTo: "/proposals",
      }),
    );
  }

  let statePayload = null;
  try {
    statePayload = jwt.verify(state, config.jwtSecret);
    if (
      statePayload?.aud !== "oauth_google_mail_state" ||
      statePayload?.provider !== "google_mail"
    ) {
      throw new Error("INVALID_GOOGLE_MAIL_STATE");
    }
  } catch {
    return res.redirect(
      resolveGoogleMailCallbackRedirect({
        status: "failed",
        returnTo: "/proposals",
      }),
    );
  }

  const returnTo = String(statePayload?.returnTo || "").trim();

  if (oauthError) {
    return res.redirect(
      resolveGoogleMailCallbackRedirect({
        status: "denied",
        returnTo,
      }),
    );
  }

  if (!code) {
    return res.redirect(
      resolveGoogleMailCallbackRedirect({
        status: "failed",
        returnTo,
      }),
    );
  }

  try {
    const userId = Number(statePayload?.sub || 0);
    if (!userId) {
      throw new Error("INVALID_GOOGLE_MAIL_STATE_USER");
    }

    const user = await getUserAuthContext(userId);
    if (!user || user.status !== "active") {
      throw new Error("GOOGLE_MAIL_USER_UNAVAILABLE");
    }

    const body = new URLSearchParams({
      code,
      client_id: config.auth.google.clientId,
      client_secret: config.auth.google.clientSecret,
      redirect_uri: config.auth.google.mailRedirectUri,
      grant_type: "authorization_code",
    });
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    const tokenPayload = await tokenResponse
      .json()
      .catch(() => ({ error: "invalid_token_response" }));
    if (!tokenResponse.ok || !tokenPayload?.access_token) {
      throw new Error("GOOGLE_MAIL_TOKEN_EXCHANGE_FAILED");
    }

    const profile = await fetchGoogleUserProfile(tokenPayload.access_token);
    const googleEmail = normalizeEmail(profile?.email || "");
    if (!googleEmail) {
      throw new Error("GOOGLE_MAIL_EMAIL_MISSING");
    }

    await ensureGoogleMailConnectionsTable();

    const currentRows = await query(
      `SELECT refresh_token_encrypted
       FROM user_google_mail_connections
       WHERE user_id = ?
       LIMIT 1`,
      [user.id],
    );

    const refreshToken = String(tokenPayload.refresh_token || "").trim();
    const refreshTokenEncrypted = refreshToken
      ? encryptOpaqueSecret(refreshToken)
      : String(currentRows[0]?.refresh_token_encrypted || "");
    if (!refreshTokenEncrypted) {
      throw new Error("GOOGLE_MAIL_REFRESH_TOKEN_MISSING");
    }

    const now = new Date();
    await query(
      `INSERT INTO user_google_mail_connections (
        user_id,
        google_email,
        refresh_token_encrypted,
        scope_text,
        last_connected_at,
        revoked_at,
        last_error_code,
        last_error_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
      ON DUPLICATE KEY UPDATE
        google_email = VALUES(google_email),
        refresh_token_encrypted = VALUES(refresh_token_encrypted),
        scope_text = VALUES(scope_text),
        last_connected_at = VALUES(last_connected_at),
        revoked_at = NULL,
        last_error_code = NULL,
        last_error_at = NULL,
        updated_at = VALUES(updated_at)`,
      [
        user.id,
        googleEmail,
        refreshTokenEncrypted,
        String(tokenPayload.scope || ""),
        now,
        now,
        now,
      ],
    );

    await logAuditEvent({
      module: "auth",
      action: "google_mail_connected",
      entityType: "user",
      entityId: user.id,
      actor: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
      },
      detail: `Conexion de Gmail delegada configurada para ${googleEmail}`,
      after: {
        google_email: googleEmail,
        has_scope: hasGoogleMailSendScope(String(tokenPayload.scope || "")),
      },
    });

    return res.redirect(
      resolveGoogleMailCallbackRedirect({
        status: "success",
        returnTo,
      }),
    );
  } catch {
    return res.redirect(
      resolveGoogleMailCallbackRedirect({
        status: "failed",
        returnTo,
      }),
    );
  }
});

router.post(
  "/google-mail/disconnect",
  authRequired,
  loadUser,
  async (req, res) => {
    await ensureGoogleMailConnectionsTable();
    await query(
      `UPDATE user_google_mail_connections
       SET revoked_at = ?, updated_at = ?, last_error_code = NULL, last_error_at = NULL
       WHERE user_id = ?`,
      [new Date(), new Date(), req.user.id],
    );

    await logAuditEvent({
      req,
      actor: {
        id: req.user.id,
        full_name: req.user.fullName,
        email: req.user.email,
      },
      module: "auth",
      action: "google_mail_disconnected",
      entityType: "user",
      entityId: req.user.id,
      detail: "Conexion de Gmail delegada revocada por el usuario",
    });

    return res.json({ disconnected: true });
  },
);

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
    return res
      .status(404)
      .json({ message: "El enlace no es valido o ya no existe" });
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
    return res
      .status(404)
      .json({ message: "El enlace no es valido o ya no existe" });
  }

  if (state === "used") {
    await logAuditEvent({
      req,
      actor: {
        id: record.user_id,
        full_name: record.full_name,
        email: record.email,
      },
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
      actor: {
        id: record.user_id,
        full_name: record.full_name,
        email: record.email,
      },
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
      actor: {
        id: record.user_id,
        full_name: record.full_name,
        email: record.email,
      },
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
    actor: {
      id: record.user_id,
      full_name: record.full_name,
      email: record.email,
    },
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
