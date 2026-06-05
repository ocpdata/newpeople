import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db.js";
import { config } from "../config.js";

const PROVIDER_OPENAI = "openai";
const DEFAULT_CURRENCY_CODE = "USD";
const MICROS_PER_USD = 1_000_000;
const DEFAULT_INITIAL_CREDIT_USD = Number(
  process.env.AI_DEFAULT_INITIAL_CREDIT_USD || 5,
);
const DEFAULT_INPUT_USD_PER_MILLION_MICROS = Number(
  process.env.AI_DEFAULT_INPUT_USD_PER_MILLION_MICROS || 300_000,
);
const DEFAULT_OUTPUT_USD_PER_MILLION_MICROS = Number(
  process.env.AI_DEFAULT_OUTPUT_USD_PER_MILLION_MICROS || 1_200_000,
);
const DEFAULT_CACHED_USD_PER_MILLION_MICROS = Number(
  process.env.AI_DEFAULT_CACHED_USD_PER_MILLION_MICROS || 30_000,
);

let ensureAiUsageSchemaPromise;

function nowDate() {
  return new Date();
}

function toMicrosFromUsd(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * MICROS_PER_USD);
}

function toUsdFromMicros(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric / MICROS_PER_USD : 0;
}

function normalizePositiveInt(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.floor(numeric);
}

function toUtcIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseDateOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildBudgetExceededError(message) {
  const error = new Error(
    message || "No tienes saldo disponible para ejecutar funciones de IA.",
  );
  error.code = "AI_BUDGET_EXCEEDED";
  error.status = 402;
  return error;
}

function buildRateNotFoundError(model) {
  const error = new Error(
    `No existe una tarifa configurada para el modelo ${String(model || "")}.`,
  );
  error.code = "AI_RATE_NOT_FOUND";
  error.status = 500;
  return error;
}

function coalesceUsageFromOpenAiResponse(responseData) {
  const usage = responseData?.usage || {};
  const promptTokens = normalizePositiveInt(
    usage.input_tokens ?? usage.prompt_tokens,
  );
  const completionTokens = normalizePositiveInt(
    usage.output_tokens ?? usage.completion_tokens,
  );
  const cachedTokens = normalizePositiveInt(
    usage?.input_tokens_details?.cached_tokens ??
      usage?.prompt_tokens_details?.cached_tokens,
  );
  const totalTokens = normalizePositiveInt(
    usage.total_tokens ?? promptTokens + completionTokens,
  );

  return {
    promptTokens,
    completionTokens,
    cachedTokens,
    totalTokens,
  };
}

function calculateCostMicros({ usage, rate }) {
  const promptCost = Math.round(
    (Number(usage.promptTokens || 0) *
      Number(rate.input_usd_per_million_micros || 0)) /
      1_000_000,
  );
  const completionCost = Math.round(
    (Number(usage.completionTokens || 0) *
      Number(rate.output_usd_per_million_micros || 0)) /
      1_000_000,
  );
  const cachedCost = Math.round(
    (Number(usage.cachedTokens || 0) *
      Number(rate.cached_input_usd_per_million_micros || 0)) /
      1_000_000,
  );

  return Math.max(0, promptCost + completionCost + cachedCost);
}

async function ensureWalletRow(conn, userId) {
  const initialGrantMicros = Math.max(
    0,
    toMicrosFromUsd(DEFAULT_INITIAL_CREDIT_USD),
  );
  const now = nowDate();

  await conn.query(
    `INSERT INTO ai_user_wallets
       (user_id, currency_code, balance_micros, hard_limit_enabled,
        warning_threshold_percent, critical_threshold_percent,
        lifetime_granted_micros, lifetime_consumed_micros, version,
        created_at_utc, updated_at_utc)
     SELECT ?, ?, ?, 1, 80, 95, ?, 0, 1, ?, ?
     WHERE NOT EXISTS (
       SELECT 1
       FROM ai_user_wallets
       WHERE user_id = ?
     )`,
    [
      Number(userId),
      DEFAULT_CURRENCY_CODE,
      initialGrantMicros,
      initialGrantMicros,
      now,
      now,
      Number(userId),
    ],
  );
}

async function getActiveRate({ conn, model }) {
  const sql = `SELECT *
               FROM ai_pricing_rates
               WHERE provider = ?
                 AND model = ?
                 AND valid_from_utc <= NOW(3)
                 AND (valid_to_utc IS NULL OR valid_to_utc > NOW(3))
               ORDER BY valid_from_utc DESC, id DESC
               LIMIT 1`;

  const params = [PROVIDER_OPENAI, String(model || "").trim()];

  const rows = conn
    ? (await conn.query(sql, params))[0]
    : await query(sql, params);

  const row = rows[0] || null;
  if (!row) {
    throw buildRateNotFoundError(model);
  }
  return row;
}

export async function ensureAiUsageSchema() {
  if (!ensureAiUsageSchemaPromise) {
    ensureAiUsageSchemaPromise = (async () => {
      await query(
        `CREATE TABLE IF NOT EXISTS ai_pricing_rates (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          provider VARCHAR(20) NOT NULL,
          model VARCHAR(120) NOT NULL,
          input_usd_per_million_micros BIGINT NOT NULL,
          output_usd_per_million_micros BIGINT NOT NULL,
          cached_input_usd_per_million_micros BIGINT NOT NULL DEFAULT 0,
          valid_from_utc DATETIME(3) NOT NULL,
          valid_to_utc DATETIME(3) NULL,
          source VARCHAR(80) NOT NULL,
          source_reference VARCHAR(255) NULL,
          created_by_user_id BIGINT UNSIGNED NULL,
          created_at_utc DATETIME(3) NOT NULL,
          updated_at_utc DATETIME(3) NOT NULL,
          UNIQUE KEY uq_ai_pricing_rates_provider_model_from (provider, model, valid_from_utc),
          KEY idx_ai_pricing_rates_provider_model_to (provider, model, valid_to_utc)
        )`,
      );

      await query(
        `CREATE TABLE IF NOT EXISTS ai_user_wallets (
          user_id BIGINT UNSIGNED PRIMARY KEY,
          currency_code CHAR(3) NOT NULL DEFAULT 'USD',
          balance_micros BIGINT NOT NULL DEFAULT 0,
          hard_limit_enabled TINYINT(1) NOT NULL DEFAULT 1,
          warning_threshold_percent TINYINT NOT NULL DEFAULT 80,
          critical_threshold_percent TINYINT NOT NULL DEFAULT 95,
          lifetime_granted_micros BIGINT NOT NULL DEFAULT 0,
          lifetime_consumed_micros BIGINT NOT NULL DEFAULT 0,
          version INT NOT NULL DEFAULT 1,
          created_at_utc DATETIME(3) NOT NULL,
          updated_at_utc DATETIME(3) NOT NULL,
          CONSTRAINT fk_ai_user_wallets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          KEY idx_ai_user_wallets_balance (balance_micros)
        )`,
      );

      await query(
        `CREATE TABLE IF NOT EXISTS ai_wallet_transactions (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          user_id BIGINT UNSIGNED NOT NULL,
          transaction_type VARCHAR(30) NOT NULL,
          amount_micros BIGINT NOT NULL,
          balance_before_micros BIGINT NOT NULL,
          balance_after_micros BIGINT NOT NULL,
          reason_code VARCHAR(50) NOT NULL,
          reason_text VARCHAR(500) NULL,
          idempotency_key VARCHAR(120) NULL,
          reference_type VARCHAR(40) NULL,
          reference_id BIGINT UNSIGNED NULL,
          created_by_user_id BIGINT UNSIGNED NULL,
          created_at_utc DATETIME(3) NOT NULL,
          CONSTRAINT fk_ai_wallet_transactions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE KEY uq_ai_wallet_transactions_idempotency (idempotency_key),
          KEY idx_ai_wallet_transactions_user_created (user_id, created_at_utc),
          KEY idx_ai_wallet_transactions_reference (reference_type, reference_id)
        )`,
      );

      await query(
        `CREATE TABLE IF NOT EXISTS ai_usage_ledger (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          internal_request_id CHAR(36) NOT NULL,
          user_id BIGINT UNSIGNED NOT NULL,
          provider VARCHAR(20) NOT NULL,
          model VARCHAR(120) NOT NULL,
          feature_code VARCHAR(80) NOT NULL,
          api_key_alias VARCHAR(80) NULL,
          prompt_tokens INT UNSIGNED NOT NULL DEFAULT 0,
          completion_tokens INT UNSIGNED NOT NULL DEFAULT 0,
          cached_tokens INT UNSIGNED NOT NULL DEFAULT 0,
          total_tokens INT UNSIGNED NOT NULL DEFAULT 0,
          pricing_rate_id BIGINT UNSIGNED NOT NULL,
          cost_micros BIGINT NOT NULL DEFAULT 0,
          wallet_transaction_id BIGINT UNSIGNED NULL,
          openai_request_id VARCHAR(120) NULL,
          job_type VARCHAR(40) NULL,
          job_id BIGINT UNSIGNED NULL,
          status VARCHAR(30) NOT NULL,
          error_code VARCHAR(80) NULL,
          error_message VARCHAR(500) NULL,
          started_at_utc DATETIME(3) NOT NULL,
          completed_at_utc DATETIME(3) NULL,
          created_at_utc DATETIME(3) NOT NULL,
          CONSTRAINT uq_ai_usage_ledger_internal_request UNIQUE (internal_request_id),
          CONSTRAINT fk_ai_usage_ledger_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          CONSTRAINT fk_ai_usage_ledger_pricing_rate FOREIGN KEY (pricing_rate_id) REFERENCES ai_pricing_rates(id) ON DELETE RESTRICT,
          CONSTRAINT fk_ai_usage_ledger_wallet_tx FOREIGN KEY (wallet_transaction_id) REFERENCES ai_wallet_transactions(id) ON DELETE SET NULL,
          KEY idx_ai_usage_ledger_user_created (user_id, created_at_utc),
          KEY idx_ai_usage_ledger_feature_created (feature_code, created_at_utc),
          KEY idx_ai_usage_ledger_model_created (model, created_at_utc),
          KEY idx_ai_usage_ledger_status_created (status, created_at_utc)
        )`,
      );

      const now = nowDate();
      const defaultModel = String(config.openai.model || "gpt-4o-mini").trim();
      await query(
        `INSERT INTO ai_pricing_rates
           (provider, model, input_usd_per_million_micros,
            output_usd_per_million_micros,
            cached_input_usd_per_million_micros,
            valid_from_utc, valid_to_utc,
            source, source_reference, created_by_user_id,
            created_at_utc, updated_at_utc)
         SELECT ?, ?, ?, ?, ?, ?, NULL, 'seed_default', 'env_default', NULL, ?, ?
         WHERE NOT EXISTS (
           SELECT 1
           FROM ai_pricing_rates
           WHERE provider = ? AND model = ?
         )`,
        [
          PROVIDER_OPENAI,
          defaultModel,
          Math.max(0, Math.round(DEFAULT_INPUT_USD_PER_MILLION_MICROS)),
          Math.max(0, Math.round(DEFAULT_OUTPUT_USD_PER_MILLION_MICROS)),
          Math.max(0, Math.round(DEFAULT_CACHED_USD_PER_MILLION_MICROS)),
          now,
          now,
          now,
          PROVIDER_OPENAI,
          defaultModel,
        ],
      );
    })().catch((error) => {
      ensureAiUsageSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureAiUsageSchemaPromise;
}

export async function assertAiBudgetAvailable({ userId }) {
  await ensureAiUsageSchema();

  const safeUserId = Number(userId || 0);
  if (!safeUserId) {
    return;
  }

  await withTransaction(async (conn) => {
    await ensureWalletRow(conn, safeUserId);

    const [walletRows] = await conn.query(
      `SELECT user_id, balance_micros, hard_limit_enabled
       FROM ai_user_wallets
       WHERE user_id = ?
       LIMIT 1
       FOR UPDATE`,
      [safeUserId],
    );

    const wallet = walletRows[0] || null;
    if (!wallet) {
      throw buildBudgetExceededError();
    }

    if (
      Number(wallet.hard_limit_enabled) &&
      Number(wallet.balance_micros) <= 0
    ) {
      throw buildBudgetExceededError();
    }
  });
}

export async function recordAiUsageFromOpenAiResponse({
  internalRequestId,
  userId,
  featureCode,
  model,
  openAiResponse,
  apiKeyAlias = null,
  jobType = null,
  jobId = null,
  startedAt = null,
}) {
  await ensureAiUsageSchema();

  const safeUserId = Number(userId || 0);
  if (!safeUserId) {
    return null;
  }

  const safeModel = String(model || config.openai.model || "").trim();
  const safeFeatureCode =
    String(featureCode || "unspecified").trim() || "unspecified";
  const requestId = String(internalRequestId || randomUUID()).slice(0, 36);
  const usage = coalesceUsageFromOpenAiResponse(openAiResponse);
  const openAiRequestId = String(
    openAiResponse?.id || openAiResponse?.response_id || "",
  ).trim();

  return withTransaction(async (conn) => {
    await ensureWalletRow(conn, safeUserId);

    const [walletRows] = await conn.query(
      `SELECT *
       FROM ai_user_wallets
       WHERE user_id = ?
       LIMIT 1
       FOR UPDATE`,
      [safeUserId],
    );

    const wallet = walletRows[0];
    if (!wallet) {
      throw new Error("No fue posible cargar la billetera de IA del usuario");
    }

    const rate = await getActiveRate({ conn, model: safeModel });
    const costMicros = calculateCostMicros({ usage, rate });
    const balanceBefore = Number(wallet.balance_micros || 0);
    const balanceAfter = balanceBefore - costMicros;
    const now = nowDate();

    const [txResult] = await conn.query(
      `INSERT INTO ai_wallet_transactions
         (user_id, transaction_type, amount_micros,
          balance_before_micros, balance_after_micros,
          reason_code, reason_text, idempotency_key,
          reference_type, reference_id, created_by_user_id,
          created_at_utc)
       VALUES (?, 'charge', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        safeUserId,
        -Math.abs(costMicros),
        balanceBefore,
        balanceAfter,
        "ai_usage_charge",
        `Cargo IA por ${safeFeatureCode}`,
        requestId,
        jobType ? "ai_job" : "ai_usage",
        jobId ? Number(jobId) : null,
        safeUserId,
        now,
      ],
    );

    const transactionId = Number(txResult.insertId || 0);

    await conn.query(
      `UPDATE ai_user_wallets
       SET balance_micros = ?,
           lifetime_consumed_micros = lifetime_consumed_micros + ?,
           version = version + 1,
           updated_at_utc = ?
       WHERE user_id = ?`,
      [balanceAfter, Math.abs(costMicros), now, safeUserId],
    );

    await conn.query(
      `INSERT INTO ai_usage_ledger
         (internal_request_id, user_id, provider, model, feature_code,
          api_key_alias, prompt_tokens, completion_tokens, cached_tokens,
          total_tokens, pricing_rate_id, cost_micros, wallet_transaction_id,
          openai_request_id, job_type, job_id, status, error_code,
          error_message, started_at_utc, completed_at_utc, created_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'success', NULL,
               NULL, ?, ?, ?)`,
      [
        requestId,
        safeUserId,
        PROVIDER_OPENAI,
        safeModel,
        safeFeatureCode,
        apiKeyAlias,
        usage.promptTokens,
        usage.completionTokens,
        usage.cachedTokens,
        usage.totalTokens,
        Number(rate.id),
        costMicros,
        transactionId || null,
        openAiRequestId || null,
        jobType || null,
        jobId ? Number(jobId) : null,
        startedAt ? new Date(startedAt) : now,
        now,
        now,
      ],
    );

    return {
      requestId,
      costMicros,
      costUsd: toUsdFromMicros(costMicros),
      balanceMicros: balanceAfter,
      balanceUsd: toUsdFromMicros(balanceAfter),
      usage,
    };
  });
}

export async function getAiCreditSummaryByUserId(userId) {
  await ensureAiUsageSchema();

  const safeUserId = Number(userId || 0);
  if (!safeUserId) {
    throw new Error("Usuario invalido");
  }

  await withTransaction(async (conn) => {
    await ensureWalletRow(conn, safeUserId);
  });

  const rows = await query(
    `SELECT user_id, balance_micros, hard_limit_enabled,
            warning_threshold_percent, critical_threshold_percent,
            lifetime_granted_micros, lifetime_consumed_micros,
            updated_at_utc
     FROM ai_user_wallets
     WHERE user_id = ?
     LIMIT 1`,
    [safeUserId],
  );

  const wallet = rows[0];
  const lifetimeGrantedMicros = Number(wallet?.lifetime_granted_micros || 0);
  const lifetimeConsumedMicros = Number(wallet?.lifetime_consumed_micros || 0);
  const consumedPercent =
    lifetimeGrantedMicros > 0
      ? Math.min(
          100,
          Math.round((lifetimeConsumedMicros / lifetimeGrantedMicros) * 100),
        )
      : 0;

  const warningThresholdPercent = Number(
    wallet?.warning_threshold_percent || 80,
  );
  const criticalThresholdPercent = Number(
    wallet?.critical_threshold_percent || 95,
  );

  let state = "normal";
  if (Number(wallet?.balance_micros || 0) <= 0) {
    state = "exhausted";
  } else if (consumedPercent >= criticalThresholdPercent) {
    state = "critical";
  } else if (consumedPercent >= warningThresholdPercent) {
    state = "warning";
  }

  return {
    userId: safeUserId,
    balanceMicros: Number(wallet?.balance_micros || 0),
    balanceUsd: toUsdFromMicros(wallet?.balance_micros || 0),
    lifetimeGrantedMicros,
    lifetimeGrantedUsd: toUsdFromMicros(lifetimeGrantedMicros),
    lifetimeConsumedMicros,
    lifetimeConsumedUsd: toUsdFromMicros(lifetimeConsumedMicros),
    consumedPercent,
    warningThresholdPercent,
    criticalThresholdPercent,
    hardLimitEnabled: Boolean(wallet?.hard_limit_enabled),
    state,
    asOfUtc: toUtcIso(wallet?.updated_at_utc || nowDate()),
  };
}

export async function listAiUsageByUserId({
  userId,
  fromUtc,
  toUtc,
  featureCode,
  limit = 50,
  cursor = null,
}) {
  await ensureAiUsageSchema();

  const safeUserId = Number(userId || 0);
  const safeLimit = Math.max(1, Math.min(200, Number(limit || 50)));
  const safeFrom =
    parseDateOrNull(fromUtc) || new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const safeTo = parseDateOrNull(toUtc) || new Date();

  if (safeTo < safeFrom) {
    throw new Error("Rango de fechas invalido");
  }

  const where = ["user_id = ?", "created_at_utc BETWEEN ? AND ?"];
  const params = [safeUserId, safeFrom, safeTo];

  if (featureCode) {
    where.push("feature_code = ?");
    params.push(String(featureCode).trim());
  }

  if (cursor) {
    where.push("id < ?");
    params.push(Number(cursor));
  }

  const items = await query(
    `SELECT id, internal_request_id, model, feature_code,
            prompt_tokens, completion_tokens, cached_tokens,
            total_tokens, cost_micros, status,
            error_code, error_message, created_at_utc
     FROM ai_usage_ledger
     WHERE ${where.join(" AND ")}
     ORDER BY id DESC
     LIMIT ?`,
    [...params, safeLimit + 1],
  );

  const page = items.slice(0, safeLimit);
  const nextCursor =
    items.length > safeLimit ? Number(page[page.length - 1].id) : null;

  const totalsRows = await query(
    `SELECT COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COALESCE(SUM(cost_micros), 0) AS total_cost_micros,
            COUNT(*) AS request_count
     FROM ai_usage_ledger
     WHERE user_id = ?
       AND created_at_utc BETWEEN ? AND ?
       ${featureCode ? "AND feature_code = ?" : ""}`,
    featureCode
      ? [safeUserId, safeFrom, safeTo, String(featureCode).trim()]
      : [safeUserId, safeFrom, safeTo],
  );

  const totals = totalsRows[0] || {};

  return {
    items: page.map((row) => ({
      id: Number(row.id),
      internalRequestId: row.internal_request_id,
      model: row.model,
      featureCode: row.feature_code,
      promptTokens: Number(row.prompt_tokens || 0),
      completionTokens: Number(row.completion_tokens || 0),
      cachedTokens: Number(row.cached_tokens || 0),
      totalTokens: Number(row.total_tokens || 0),
      costMicros: Number(row.cost_micros || 0),
      costUsd: toUsdFromMicros(row.cost_micros || 0),
      status: row.status,
      errorCode: row.error_code || null,
      errorMessage: row.error_message || null,
      createdAtUtc: toUtcIso(row.created_at_utc),
    })),
    nextCursor,
    totals: {
      requestCount: Number(totals.request_count || 0),
      totalTokens: Number(totals.total_tokens || 0),
      totalCostMicros: Number(totals.total_cost_micros || 0),
      totalCostUsd: toUsdFromMicros(totals.total_cost_micros || 0),
    },
  };
}

export async function getAdminWalletByUserId(userId) {
  const summary = await getAiCreditSummaryByUserId(userId);
  const txRows = await query(
    `SELECT id, transaction_type, amount_micros,
            balance_before_micros, balance_after_micros,
            reason_code, reason_text, reference_type,
            reference_id, created_at_utc
     FROM ai_wallet_transactions
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT 20`,
    [Number(userId)],
  );

  return {
    wallet: summary,
    recentTransactions: txRows.map((row) => ({
      id: Number(row.id),
      transactionType: row.transaction_type,
      amountMicros: Number(row.amount_micros || 0),
      amountUsd: toUsdFromMicros(row.amount_micros || 0),
      balanceBeforeMicros: Number(row.balance_before_micros || 0),
      balanceAfterMicros: Number(row.balance_after_micros || 0),
      reasonCode: row.reason_code,
      reasonText: row.reason_text,
      referenceType: row.reference_type,
      referenceId: row.reference_id ? Number(row.reference_id) : null,
      createdAtUtc: toUtcIso(row.created_at_utc),
    })),
  };
}

export async function listAdminWalletSummaries() {
  await ensureAiUsageSchema();

  await query(
    `INSERT INTO ai_user_wallets
       (user_id, currency_code, balance_micros, hard_limit_enabled,
        warning_threshold_percent, critical_threshold_percent,
        lifetime_granted_micros, lifetime_consumed_micros, version,
        created_at_utc, updated_at_utc)
     SELECT u.id, 'USD', ?, 1, 80, 95, ?, 0, 1, NOW(3), NOW(3)
     FROM users u
     LEFT JOIN ai_user_wallets aw ON aw.user_id = u.id
     WHERE aw.user_id IS NULL`,
    [
      Math.max(0, toMicrosFromUsd(DEFAULT_INITIAL_CREDIT_USD)),
      Math.max(0, toMicrosFromUsd(DEFAULT_INITIAL_CREDIT_USD)),
    ],
  );

  const rows = await query(
    `SELECT u.id,
            u.full_name,
            u.email,
            u.status AS user_status,
            GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS roles,
            aw.currency_code,
            COALESCE(aw.balance_micros, 0) AS balance_micros,
            COALESCE(aw.hard_limit_enabled, 1) AS hard_limit_enabled,
            COALESCE(aw.warning_threshold_percent, 80) AS warning_threshold_percent,
            COALESCE(aw.critical_threshold_percent, 95) AS critical_threshold_percent,
            COALESCE(aw.lifetime_granted_micros, 0) AS lifetime_granted_micros,
            COALESCE(aw.lifetime_consumed_micros, 0) AS lifetime_consumed_micros,
            aw.updated_at_utc
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     LEFT JOIN ai_user_wallets aw ON aw.user_id = u.id
     GROUP BY u.id
     ORDER BY u.full_name ASC, u.id ASC`,
  );

  return rows.map((row) => {
    const lifetimeGrantedMicros = Number(row.lifetime_granted_micros || 0);
    const lifetimeConsumedMicros = Number(row.lifetime_consumed_micros || 0);
    const consumedPercent =
      lifetimeGrantedMicros > 0
        ? Math.min(
            100,
            Math.round((lifetimeConsumedMicros / lifetimeGrantedMicros) * 100),
          )
        : 0;

    let state = "normal";
    if (Number(row.balance_micros || 0) <= 0) {
      state = "exhausted";
    } else if (
      consumedPercent >= Number(row.critical_threshold_percent || 95)
    ) {
      state = "critical";
    } else if (consumedPercent >= Number(row.warning_threshold_percent || 80)) {
      state = "warning";
    }

    return {
      userId: Number(row.id),
      fullName: String(row.full_name || ""),
      email: String(row.email || ""),
      status: String(row.user_status || ""),
      roles: String(row.roles || ""),
      balanceMicros: Number(row.balance_micros || 0),
      balanceUsd: toUsdFromMicros(row.balance_micros || 0),
      lifetimeGrantedMicros,
      lifetimeGrantedUsd: toUsdFromMicros(lifetimeGrantedMicros),
      lifetimeConsumedMicros,
      lifetimeConsumedUsd: toUsdFromMicros(lifetimeConsumedMicros),
      consumedPercent,
      warningThresholdPercent: Number(row.warning_threshold_percent || 80),
      criticalThresholdPercent: Number(row.critical_threshold_percent || 95),
      hardLimitEnabled: Boolean(row.hard_limit_enabled),
      state,
      asOfUtc: toUtcIso(row.updated_at_utc || nowDate()),
    };
  });
}

async function applyWalletTransaction({
  userId,
  amountMicros,
  transactionType,
  reasonCode,
  reasonText,
  idempotencyKey,
  createdByUserId,
  referenceType = null,
  referenceId = null,
}) {
  await ensureAiUsageSchema();

  const safeUserId = Number(userId || 0);
  const safeAmount = Math.round(Number(amountMicros || 0));
  if (!safeUserId || !safeAmount) {
    throw new Error("Solicitud de wallet invalida");
  }

  const safeIdempotency = String(idempotencyKey || "").trim();
  if (!safeIdempotency) {
    throw new Error("idempotencyKey es obligatorio");
  }

  return withTransaction(async (conn) => {
    await ensureWalletRow(conn, safeUserId);

    const [walletRows] = await conn.query(
      `SELECT *
       FROM ai_user_wallets
       WHERE user_id = ?
       LIMIT 1
       FOR UPDATE`,
      [safeUserId],
    );

    const wallet = walletRows[0];
    if (!wallet) {
      throw new Error("No se encontro wallet del usuario");
    }

    const before = Number(wallet.balance_micros || 0);
    const after = before + safeAmount;
    const hardLimitEnabled = Number(wallet.hard_limit_enabled) === 1;

    if (hardLimitEnabled && after < 0) {
      const error = new Error("El ajuste dejaria el saldo en negativo");
      error.code = "AI_INVALID_POLICY";
      error.status = 422;
      throw error;
    }

    const now = nowDate();
    let insertResult;

    try {
      [insertResult] = await conn.query(
        `INSERT INTO ai_wallet_transactions
           (user_id, transaction_type, amount_micros,
            balance_before_micros, balance_after_micros,
            reason_code, reason_text, idempotency_key,
            reference_type, reference_id, created_by_user_id,
            created_at_utc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          safeUserId,
          transactionType,
          safeAmount,
          before,
          after,
          reasonCode,
          reasonText || null,
          safeIdempotency,
          referenceType,
          referenceId,
          Number(createdByUserId || 0) || null,
          now,
        ],
      );
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") {
        const conflict = new Error("idempotencyKey ya fue utilizado");
        conflict.code = "AI_IDEMPOTENCY_CONFLICT";
        conflict.status = 409;
        throw conflict;
      }
      throw error;
    }

    await conn.query(
      `UPDATE ai_user_wallets
       SET balance_micros = ?,
           lifetime_granted_micros = lifetime_granted_micros + ?,
           lifetime_consumed_micros = lifetime_consumed_micros + ?,
           version = version + 1,
           updated_at_utc = ?
       WHERE user_id = ?`,
      [
        after,
        safeAmount > 0 ? safeAmount : 0,
        safeAmount < 0 ? Math.abs(safeAmount) : 0,
        now,
        safeUserId,
      ],
    );

    return {
      transactionId: Number(insertResult.insertId || 0),
      newBalanceMicros: after,
      newBalanceUsd: toUsdFromMicros(after),
    };
  });
}

export async function grantWalletCredit({
  userId,
  amountUsd,
  reasonCode,
  reasonText,
  idempotencyKey,
  actorUserId,
}) {
  const amountMicros = toMicrosFromUsd(amountUsd);
  if (amountMicros <= 0) {
    throw new Error("amountUsd debe ser mayor a cero");
  }

  return applyWalletTransaction({
    userId,
    amountMicros,
    transactionType: "grant",
    reasonCode: String(reasonCode || "admin_grant"),
    reasonText,
    idempotencyKey,
    createdByUserId: actorUserId,
    referenceType: "admin_grant",
  });
}

export async function adjustWalletCredit({
  userId,
  amountUsd,
  reasonCode,
  reasonText,
  idempotencyKey,
  actorUserId,
}) {
  const amountMicros = toMicrosFromUsd(amountUsd);
  if (!amountMicros) {
    throw new Error("amountUsd debe ser distinto de cero");
  }

  return applyWalletTransaction({
    userId,
    amountMicros,
    transactionType: "adjustment",
    reasonCode: String(reasonCode || "admin_adjustment"),
    reasonText,
    idempotencyKey,
    createdByUserId: actorUserId,
    referenceType: "admin_adjustment",
  });
}

export async function updateWalletPolicy({
  userId,
  hardLimitEnabled,
  warningThresholdPercent,
  criticalThresholdPercent,
}) {
  await ensureAiUsageSchema();

  const safeUserId = Number(userId || 0);
  if (!safeUserId) {
    throw new Error("Usuario invalido");
  }

  return withTransaction(async (conn) => {
    await ensureWalletRow(conn, safeUserId);

    const [walletRows] = await conn.query(
      `SELECT *
       FROM ai_user_wallets
       WHERE user_id = ?
       LIMIT 1
       FOR UPDATE`,
      [safeUserId],
    );

    const wallet = walletRows[0];
    if (!wallet) {
      throw new Error("Wallet no encontrada");
    }

    const nextHardLimit =
      typeof hardLimitEnabled === "boolean"
        ? hardLimitEnabled
        : Number(wallet.hard_limit_enabled) === 1;
    const nextWarning =
      warningThresholdPercent === undefined
        ? Number(wallet.warning_threshold_percent || 80)
        : Math.max(1, Math.min(99, Number(warningThresholdPercent)));
    const nextCritical =
      criticalThresholdPercent === undefined
        ? Number(wallet.critical_threshold_percent || 95)
        : Math.max(1, Math.min(100, Number(criticalThresholdPercent)));

    if (
      !Number.isFinite(nextWarning) ||
      !Number.isFinite(nextCritical) ||
      nextWarning >= nextCritical
    ) {
      const error = new Error("Politica de umbrales invalida");
      error.code = "AI_INVALID_POLICY";
      error.status = 400;
      throw error;
    }

    await conn.query(
      `UPDATE ai_user_wallets
       SET hard_limit_enabled = ?,
           warning_threshold_percent = ?,
           critical_threshold_percent = ?,
           version = version + 1,
           updated_at_utc = ?
       WHERE user_id = ?`,
      [nextHardLimit ? 1 : 0, nextWarning, nextCritical, nowDate(), safeUserId],
    );
  });

  return getAiCreditSummaryByUserId(safeUserId);
}

export async function aggregateAiUsage({ fromUtc, toUtc, groupBy }) {
  await ensureAiUsageSchema();

  const safeFrom =
    parseDateOrNull(fromUtc) || new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const safeTo = parseDateOrNull(toUtc) || new Date();
  const allowedGroupBy = new Set(["user", "feature", "model", "day"]);
  const safeGroupBy = allowedGroupBy.has(groupBy) ? groupBy : "user";

  const selectBy = {
    user: "CAST(user_id AS CHAR) AS group_key",
    feature: "feature_code AS group_key",
    model: "model AS group_key",
    day: "DATE_FORMAT(created_at_utc, '%Y-%m-%d') AS group_key",
  }[safeGroupBy];

  const rows = await query(
    `SELECT ${selectBy},
            COUNT(*) AS request_count,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COALESCE(SUM(cost_micros), 0) AS total_cost_micros
     FROM ai_usage_ledger
     WHERE created_at_utc BETWEEN ? AND ?
     GROUP BY group_key
     ORDER BY total_cost_micros DESC`,
    [safeFrom, safeTo],
  );

  const grandTotal = rows.reduce(
    (acc, row) => {
      acc.requestCount += Number(row.request_count || 0);
      acc.totalTokens += Number(row.total_tokens || 0);
      acc.totalCostMicros += Number(row.total_cost_micros || 0);
      return acc;
    },
    { requestCount: 0, totalTokens: 0, totalCostMicros: 0 },
  );

  return {
    groupBy: safeGroupBy,
    fromUtc: safeFrom.toISOString(),
    toUtc: safeTo.toISOString(),
    groups: rows.map((row) => ({
      key: row.group_key,
      requestCount: Number(row.request_count || 0),
      totalTokens: Number(row.total_tokens || 0),
      totalCostMicros: Number(row.total_cost_micros || 0),
      totalCostUsd: toUsdFromMicros(row.total_cost_micros || 0),
    })),
    grandTotal: {
      ...grandTotal,
      totalCostUsd: toUsdFromMicros(grandTotal.totalCostMicros),
    },
  };
}
