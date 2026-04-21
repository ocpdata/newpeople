import { config } from "./config.js";
import { query, withTransaction } from "./db.js";
import { buildInviteSetupUrl, createOpaqueToken, hashOpaqueToken } from "./utils.js";

let ensurePasswordSetupTokenTablePromise;

export async function ensurePasswordSetupTokenTable() {
  if (!ensurePasswordSetupTokenTablePromise) {
    ensurePasswordSetupTokenTablePromise = query(`
      CREATE TABLE IF NOT EXISTS password_setup_tokens (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        token_hash CHAR(64) NOT NULL,
        purpose ENUM('invite', 'reset') NOT NULL DEFAULT 'invite',
        expires_at DATETIME(3) NOT NULL,
        used_at DATETIME(3) NULL,
        created_by BIGINT UNSIGNED NULL,
        created_at DATETIME(3) NOT NULL,
        CONSTRAINT fk_password_setup_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_password_setup_tokens_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT uq_password_setup_tokens_hash UNIQUE (token_hash)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `).catch((error) => {
      ensurePasswordSetupTokenTablePromise = undefined;
      throw error;
    });
  }

  await ensurePasswordSetupTokenTablePromise;
}

function getPasswordSetupExpiryDate() {
  return new Date(
    Date.now() + config.app.passwordSetupTokenMinutes * 60 * 1000,
  );
}

export async function issuePasswordSetupToken({
  userId,
  purpose = "invite",
  createdBy = null,
}) {
  await ensurePasswordSetupTokenTable();

  const { token, tokenHash } = createOpaqueToken();
  const now = new Date();
  const expiresAt = getPasswordSetupExpiryDate();

  await withTransaction(async (conn) => {
    await conn.query(
      "DELETE FROM password_setup_tokens WHERE user_id = ? AND used_at IS NULL",
      [userId],
    );

    await conn.query(
      `INSERT INTO password_setup_tokens
        (user_id, token_hash, purpose, expires_at, used_at, created_by, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      [userId, tokenHash, purpose, expiresAt, createdBy, now],
    );
  });

  return {
    token,
    purpose,
    expiresAt,
    inviteUrl: buildInviteSetupUrl(token),
  };
}

export async function findPasswordSetupToken(rawToken) {
  await ensurePasswordSetupTokenTable();

  const tokenHash = hashOpaqueToken(rawToken);
  const rows = await query(
    `SELECT pst.id, pst.user_id, pst.purpose, pst.expires_at, pst.used_at,
            u.id AS user_id, u.full_name, u.email, u.status
     FROM password_setup_tokens pst
     INNER JOIN users u ON u.id = pst.user_id
     WHERE pst.token_hash = ?
     LIMIT 1`,
    [tokenHash],
  );

  return rows[0] || null;
}

export function resolvePasswordSetupTokenState(record) {
  if (!record) return "invalid";
  if (record.used_at) return "used";

  const expiresAt = new Date(record.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    return "expired";
  }

  if (record.status !== "active") return "inactive";
  return "valid";
}

export async function consumePasswordSetupToken({ tokenId, userId, passwordHash, now }) {
  await ensurePasswordSetupTokenTable();

  return withTransaction(async (conn) => {
    await conn.query(
      "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
      [passwordHash, now, userId],
    );

    const [result] = await conn.query(
      "UPDATE password_setup_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL",
      [now, tokenId],
    );

    if (Number(result.affectedRows) !== 1) {
      throw new Error("PASSWORD_SETUP_TOKEN_NOT_AVAILABLE");
    }

    await conn.query(
      "UPDATE password_setup_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
      [now, userId],
    );
  });
}