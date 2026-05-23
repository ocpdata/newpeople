import express from "express";
import { query, withTransaction } from "./db.js";
import { requireAnyPermission, requirePermission } from "./auth.js";
import { listProductTypes } from "./productTypes.js";
import { ensureAccountInteractionsSchema } from "./account-interactions/schema.js";

const router = express.Router();
const ALLOWED_OPPORTUNITY_STAGE_QUESTION_RESPONSE_TYPES = new Set([
  "long_text",
]);
const contactGlobalReadPermission = "contactos.read_all";
const opportunityGlobalReadPermission = "oportunidades.read_all";
const accountGlobalReadPermission = "cuentas.read_all";
let ensureQuotationDeliveryTimesCatalogPromise;
let ensureQuotationValidityCatalogPromise;
let ensureQuotationWarrantyCatalogPromise;
let ensureQuotationPaymentTermsCatalogPromise;
let ensureQuotationStatusesCatalogPromise;

async function ensureQuotationStatusesCatalog() {
  if (!ensureQuotationStatusesCatalogPromise) {
    ensureQuotationStatusesCatalogPromise = (async () => {
      const rows = await query(
        `SELECT 1
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'quotation_statuses'
           AND COLUMN_NAME = 'ui_key'
         LIMIT 1`,
      );

      if (!rows.length) {
        await query(
          `ALTER TABLE quotation_statuses
           ADD COLUMN ui_key VARCHAR(80) NOT NULL DEFAULT 'default'
           AFTER name`,
        );
      }

      await query(
        `UPDATE quotation_statuses
         SET ui_key = CASE code
           WHEN 'borrador' THEN 'draft'
           WHEN 'en_aprobacion' THEN 'pending'
           WHEN 'rechazada' THEN 'rejected'
           WHEN 'aprobada' THEN 'approved'
           WHEN 'enviada' THEN 'sent'
           WHEN 'ganada' THEN 'won'
           WHEN 'perdida' THEN 'lost'
           WHEN 'anulada' THEN 'cancelled'
           WHEN 'aceptada' THEN 'accepted'
           WHEN 'no_vigente' THEN 'inactive'
           ELSE 'default'
         END
         WHERE ui_key IS NULL OR TRIM(ui_key) = '' OR ui_key = 'default'`,
      );
    })().catch((error) => {
      ensureQuotationStatusesCatalogPromise = undefined;
      throw error;
    });
  }

  await ensureQuotationStatusesCatalogPromise;
}

function hasGlobalContactReadScope(user) {
  return user?.permissionSet?.has(contactGlobalReadPermission);
}

function hasGlobalAccountReadScope(user) {
  return user?.permissionSet?.has(accountGlobalReadPermission);
}

function hasGlobalOpportunityReadScope(user) {
  return user?.permissionSet?.has(opportunityGlobalReadPermission);
}

function applyOwnedAccountScope({
  user,
  accountExpression,
  params,
  allowGlobal,
}) {
  if (allowGlobal?.(user)) return "";
  params.push(Number(user.id));
  return `INNER JOIN account_owners ao_scope ON ao_scope.account_id = ${accountExpression} AND ao_scope.user_id = ?`;
}

function normalizeQuestionPrompt(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function parseQuestionBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return null;
}

function parseDisplayOrder(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function clampDisplayOrder(displayOrder, maxOrder) {
  if (!displayOrder) return maxOrder;
  return Math.min(Math.max(displayOrder, 1), maxOrder);
}

function buildOpportunityStageQuestionCode(stageCode) {
  return `${stageCode}_manual_${Date.now()}_${Math.floor(
    Math.random() * 100000,
  )}`;
}

async function ensureQuotationDeliveryTimesCatalog() {
  if (!ensureQuotationDeliveryTimesCatalogPromise) {
    ensureQuotationDeliveryTimesCatalogPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS quotation_delivery_times (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          code VARCHAR(80) NOT NULL,
          name VARCHAR(120) NOT NULL,
          display_order SMALLINT UNSIGNED NOT NULL DEFAULT 1,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          CONSTRAINT uq_quotation_delivery_times_code UNIQUE (code)
        )
      `);

      await query(
        `INSERT INTO quotation_delivery_times (
           code,
           name,
           display_order,
           is_active,
           created_at,
           updated_at
         ) VALUES
           ('inmediato', 'Inmediato', 1, 1, NOW(3), NOW(3)),
           ('5_dias', '5 días', 2, 1, NOW(3), NOW(3)),
           ('10_dias', '10 días', 3, 1, NOW(3), NOW(3)),
           ('15_dias', '15 días', 4, 1, NOW(3), NOW(3)),
           ('30_dias', '30 días', 5, 1, NOW(3), NOW(3)),
           ('45_dias', '45 días', 6, 1, NOW(3), NOW(3)),
           ('60_dias', '60 días', 7, 1, NOW(3), NOW(3)),
           (
             'segun_notas',
             'De acuerdo a lo indicado en notas',
             8,
             1,
             NOW(3),
             NOW(3)
           )
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           display_order = VALUES(display_order),
           is_active = VALUES(is_active),
           updated_at = VALUES(updated_at)`,
      );
    })().catch((error) => {
      ensureQuotationDeliveryTimesCatalogPromise = undefined;
      throw error;
    });
  }

  await ensureQuotationDeliveryTimesCatalogPromise;
}

async function ensureQuotationValidityCatalog() {
  if (!ensureQuotationValidityCatalogPromise) {
    ensureQuotationValidityCatalogPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS quotation_validity_terms (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          code VARCHAR(80) NOT NULL,
          name VARCHAR(120) NOT NULL,
          display_order SMALLINT UNSIGNED NOT NULL DEFAULT 1,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          CONSTRAINT uq_quotation_validity_terms_code UNIQUE (code)
        )
      `);

      await query(
        `INSERT INTO quotation_validity_terms (
           code,
           name,
           display_order,
           is_active,
           created_at,
           updated_at
         ) VALUES
           ('5_dias', '5 días', 1, 1, NOW(3), NOW(3)),
           ('10_dias', '10 días', 2, 1, NOW(3), NOW(3)),
           ('15_dias', '15 días', 3, 1, NOW(3), NOW(3)),
           ('30_dias', '30 días', 4, 1, NOW(3), NOW(3)),
           ('45_dias', '45 días', 5, 1, NOW(3), NOW(3)),
           ('60_dias', '60 días', 6, 1, NOW(3), NOW(3)),
           (
             'segun_notas',
             'De acuerdo a lo indicado en notas',
             7,
             1,
             NOW(3),
             NOW(3)
           )
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           display_order = VALUES(display_order),
           is_active = VALUES(is_active),
           updated_at = VALUES(updated_at)`,
      );
    })().catch((error) => {
      ensureQuotationValidityCatalogPromise = undefined;
      throw error;
    });
  }

  await ensureQuotationValidityCatalogPromise;
}

async function ensureQuotationWarrantyCatalog() {
  if (!ensureQuotationWarrantyCatalogPromise) {
    ensureQuotationWarrantyCatalogPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS quotation_warranty_terms (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          code VARCHAR(80) NOT NULL,
          name VARCHAR(120) NOT NULL,
          display_order SMALLINT UNSIGNED NOT NULL DEFAULT 1,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          CONSTRAINT uq_quotation_warranty_terms_code UNIQUE (code)
        )
      `);

      await query(
        `INSERT INTO quotation_warranty_terms (
           code,
           name,
           display_order,
           is_active,
           created_at,
           updated_at
         ) VALUES
           ('1_ano', '1 año', 1, 1, NOW(3), NOW(3)),
           ('2_anos', '2 años', 2, 1, NOW(3), NOW(3)),
           ('3_anos', '3 años', 3, 1, NOW(3), NOW(3)),
           ('4_anos', '4 años', 4, 1, NOW(3), NOW(3)),
           ('5_anos', '5 años', 5, 1, NOW(3), NOW(3)),
           (
             'segun_notas',
             'De acuerdo a lo indicado en notas',
             6,
             1,
             NOW(3),
             NOW(3)
           )
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           display_order = VALUES(display_order),
           is_active = VALUES(is_active),
           updated_at = VALUES(updated_at)`,
      );
    })().catch((error) => {
      ensureQuotationWarrantyCatalogPromise = undefined;
      throw error;
    });
  }

  await ensureQuotationWarrantyCatalogPromise;
}

router.get(
  "/account-interaction-types",
  requireAnyPermission(["cuentas.read", "cuentas.create", "cuentas.update"]),
  async (_req, res) => {
    await ensureAccountInteractionsSchema();
    const rows = await query(
      `SELECT id, code, name, display_order
       FROM account_interaction_types
       WHERE is_active = 1
       ORDER BY display_order, id`,
    );
    res.json(
      rows.map((row) => ({
        id: Number(row.id),
        code: String(row.code),
        name: String(row.name),
        displayOrder: Number(row.display_order || 0),
      })),
    );
  },
);

router.get(
  "/account-interaction-results",
  requireAnyPermission(["cuentas.read", "cuentas.create", "cuentas.update"]),
  async (_req, res) => {
    await ensureAccountInteractionsSchema();
    const rows = await query(
      `SELECT id, code, name, display_order
       FROM account_interaction_results
       WHERE is_active = 1
       ORDER BY display_order, id`,
    );
    res.json(
      rows.map((row) => ({
        id: Number(row.id),
        code: String(row.code),
        name: String(row.name),
        displayOrder: Number(row.display_order || 0),
      })),
    );
  },
);

async function ensureQuotationPaymentTermsCatalog() {
  if (!ensureQuotationPaymentTermsCatalogPromise) {
    ensureQuotationPaymentTermsCatalogPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS quotation_payment_terms (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          code VARCHAR(80) NOT NULL,
          name VARCHAR(180) NOT NULL,
          display_order SMALLINT UNSIGNED NOT NULL DEFAULT 1,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          CONSTRAINT uq_quotation_payment_terms_code UNIQUE (code)
        )
      `);

      await query(
        `INSERT INTO quotation_payment_terms (
           code,
           name,
           display_order,
           is_active,
           created_at,
           updated_at
         ) VALUES
           ('100_adelantado', '100% adelantado', 1, 1, NOW(3), NOW(3)),
           (
             '50_adelantado_50_entrega',
             '50% adelantado - 50% contra entrega',
             2,
             1,
             NOW(3),
             NOW(3)
           ),
           ('100_entrega', '100% contra entrega', 3, 1, NOW(3), NOW(3)),
           (
             '15_dias_facturado',
             '15 días despues de facturado',
             4,
             1,
             NOW(3),
             NOW(3)
           ),
           (
             '30_dias_facturado',
             '30 días despues de facturado',
             5,
             1,
             NOW(3),
             NOW(3)
           ),
           (
             '45_dias_facturado',
             '45 días despues de facturado',
             6,
             1,
             NOW(3),
             NOW(3)
           ),
           (
             '60_dias_facturado',
             '60 días despues de facturado',
             7,
             1,
             NOW(3),
             NOW(3)
           ),
           (
             '90_dias_facturado',
             '90 días despues de facturado',
             8,
             1,
             NOW(3),
             NOW(3)
           ),
           (
             'segun_notas',
             'De acuerdo a lo indicado en notas',
             9,
             1,
             NOW(3),
             NOW(3)
           )
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           display_order = VALUES(display_order),
           is_active = VALUES(is_active),
           updated_at = VALUES(updated_at)`,
      );
    })().catch((error) => {
      ensureQuotationPaymentTermsCatalogPromise = undefined;
      throw error;
    });
  }

  await ensureQuotationPaymentTermsCatalogPromise;
}

async function getOpportunitySalesStageById(stageId) {
  const rows = await query(
    `SELECT id, code, name, stage_order
     FROM opportunity_sales_stages
     WHERE id = ?
       AND is_active = 1
     LIMIT 1`,
    [stageId],
  );
  return rows.length ? rows[0] : null;
}

async function getOpportunityStageQuestionById(questionId) {
  const rows = await query(
    `SELECT q.id, q.sales_stage_id, q.code, q.prompt, q.response_type,
            q.display_order, q.is_required, q.is_active,
            s.code AS sales_stage_code, s.name AS sales_stage_name
     FROM opportunity_stage_questions q
     INNER JOIN opportunity_sales_stages s ON s.id = q.sales_stage_id
     WHERE q.id = ?
     LIMIT 1`,
    [questionId],
  );
  return rows.length ? rows[0] : null;
}

async function getOpportunityStageQuestionsByStageId(
  salesStageId,
  { includeInactive = false } = {},
) {
  const params = [salesStageId];
  const activeClause = includeInactive ? "" : "AND q.is_active = 1";
  return query(
    `SELECT q.id, q.sales_stage_id, q.code, q.prompt, q.response_type,
            q.display_order, q.is_required, q.is_active,
            s.code AS sales_stage_code, s.name AS sales_stage_name
     FROM opportunity_stage_questions q
     INNER JOIN opportunity_sales_stages s ON s.id = q.sales_stage_id
     WHERE q.sales_stage_id = ?
       ${activeClause}
       AND s.is_active = 1
     ORDER BY q.display_order, q.id`,
    params,
  );
}

async function makeRoomForStageQuestion(
  conn,
  salesStageId,
  displayOrder,
  excludeQuestionId = null,
) {
  const params = [salesStageId, displayOrder];
  let excludeClause = "";
  if (excludeQuestionId) {
    params.push(excludeQuestionId);
    excludeClause = "AND id <> ?";
  }
  const [rows] = await conn.query(
    `SELECT id, display_order
     FROM opportunity_stage_questions
     WHERE sales_stage_id = ?
       AND display_order >= ?
       ${excludeClause}
     ORDER BY display_order DESC, id DESC`,
    params,
  );

  for (const row of rows) {
    await conn.query(
      `UPDATE opportunity_stage_questions
       SET display_order = ?
       WHERE id = ?`,
      [Number(row.display_order) + 1, Number(row.id)],
    );
  }
}

async function moveStageQuestionWithinStage(conn, question, targetOrder) {
  const currentOrder = Number(question.display_order);
  if (currentOrder === targetOrder) {
    return;
  }

  await conn.query(
    `UPDATE opportunity_stage_questions
     SET display_order = 255
     WHERE id = ?`,
    [Number(question.id)],
  );

  if (targetOrder < currentOrder) {
    const [rows] = await conn.query(
      `SELECT id, display_order
       FROM opportunity_stage_questions
       WHERE sales_stage_id = ?
         AND display_order >= ?
         AND display_order < ?
       ORDER BY display_order DESC, id DESC`,
      [Number(question.sales_stage_id), targetOrder, currentOrder],
    );
    for (const row of rows) {
      await conn.query(
        `UPDATE opportunity_stage_questions
         SET display_order = ?
         WHERE id = ?`,
        [Number(row.display_order) + 1, Number(row.id)],
      );
    }
  } else {
    const [rows] = await conn.query(
      `SELECT id, display_order
       FROM opportunity_stage_questions
       WHERE sales_stage_id = ?
         AND display_order > ?
         AND display_order <= ?
       ORDER BY display_order ASC, id ASC`,
      [Number(question.sales_stage_id), currentOrder, targetOrder],
    );
    for (const row of rows) {
      await conn.query(
        `UPDATE opportunity_stage_questions
         SET display_order = ?
         WHERE id = ?`,
        [Number(row.display_order) - 1, Number(row.id)],
      );
    }
  }

  await conn.query(
    `UPDATE opportunity_stage_questions
     SET display_order = ?
     WHERE id = ?`,
    [targetOrder, Number(question.id)],
  );
}

function validateOpportunityStageQuestionPayload(body) {
  const salesStageId = Number(body?.salesStageId);
  const prompt = normalizeQuestionPrompt(body?.prompt);
  const responseType = String(body?.responseType || "").trim();
  const displayOrder = parseDisplayOrder(body?.displayOrder);
  const isRequired = parseQuestionBoolean(body?.isRequired);

  if (!Number.isInteger(salesStageId) || salesStageId <= 0) {
    return { ok: false, message: "salesStageId invalido" };
  }
  if (prompt.length < 5) {
    return {
      ok: false,
      message: "La pregunta debe tener al menos 5 caracteres",
    };
  }
  if (!ALLOWED_OPPORTUNITY_STAGE_QUESTION_RESPONSE_TYPES.has(responseType)) {
    return { ok: false, message: "Tipo de respuesta invalido" };
  }
  if (body?.displayOrder !== undefined && displayOrder === null) {
    return { ok: false, message: "displayOrder invalido" };
  }
  if (isRequired === null) {
    return { ok: false, message: "isRequired invalido" };
  }

  return {
    ok: true,
    value: {
      salesStageId,
      prompt,
      responseType,
      displayOrder,
      isRequired,
    },
  };
}

router.get(
  "/countries",
  requirePermission("cuentas.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, iso2, iso3, name FROM countries WHERE is_active = 1 ORDER BY name",
    );
    res.json(rows);
  },
);

router.get(
  "/currencies",
  requirePermission("cuentas.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name, symbol, decimals FROM currencies WHERE is_active = 1 ORDER BY name",
    );
    res.json(rows);
  },
);

router.get(
  "/account-types",
  requirePermission("cuentas.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM account_types WHERE is_active = 1 ORDER BY name",
    );
    res.json(rows);
  },
);

router.get(
  "/economic-sectors",
  requirePermission("cuentas.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM economic_sectors WHERE is_active = 1 ORDER BY name",
    );
    res.json(rows);
  },
);

router.get(
  "/account-activation-statuses",
  requirePermission("cuentas.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM account_activation_statuses WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

router.get(
  "/account-owner-users",
  requirePermission("cuentas.read"),
  async (_req, res) => {
    const rows = await query(
      `SELECT id, full_name, email, status
       FROM users
       WHERE status = 'active'
       ORDER BY full_name`,
    );
    res.json(rows);
  },
);

router.get(
  "/contact-accounts",
  requirePermission("contactos.read"),
  async (req, res) => {
    const params = [];
    const ownershipJoin = applyOwnedAccountScope({
      user: req.user,
      accountExpression: "a.id",
      params,
      allowGlobal: hasGlobalContactReadScope,
    });
    const rows = await query(
      `SELECT a.id, a.name, a.country_id, a.state_region, a.city, a.address_line, a.postal_code
       FROM accounts a
       INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
       ${ownershipJoin}
       WHERE aas.code = 'activada'
       ORDER BY a.name`,
      params,
    );
    res.json(rows);
  },
);

router.get(
  "/contact-countries",
  requirePermission("contactos.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, iso2, iso3, name FROM countries WHERE is_active = 1 ORDER BY name",
    );
    res.json(rows);
  },
);

router.get(
  "/contact-purchase-participations",
  requirePermission("contactos.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM contact_purchase_participations WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

router.get(
  "/contact-relationship-types",
  requirePermission("contactos.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM contact_relationship_types WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

router.get(
  "/contact-employment-statuses",
  requirePermission("contactos.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM contact_employment_statuses WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

router.get(
  "/contact-activation-statuses",
  requirePermission("contactos.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM contact_activation_statuses WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

router.get(
  "/product-types",
  requireAnyPermission(["proveedores.read", "proveedores_precios.read"]),
  async (_req, res) => {
    const rows = await listProductTypes();
    res.json(
      rows.map((row) => ({
        id: Number(row.id),
        code: String(row.code),
        name: String(row.name),
        description: row.description || null,
        sort_order: Number(row.sort_order || 0),
      })),
    );
  },
);

router.get(
  "/provider-countries",
  requirePermission("proveedores.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, iso2, iso3, name FROM countries WHERE is_active = 1 ORDER BY name",
    );
    res.json(rows);
  },
);

router.get(
  "/provider-activation-statuses",
  requirePermission("proveedores.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM provider_activation_statuses WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

router.get(
  "/provider-price-list-item-statuses",
  requireAnyPermission(["proveedores.read", "proveedores_precios.read"]),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM provider_price_list_item_statuses WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

router.get(
  "/provider-price-list-currencies",
  requireAnyPermission(["proveedores.read", "proveedores_precios.read"]),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name, symbol, decimals FROM currencies WHERE is_active = 1 ORDER BY name",
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-accounts",
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const params = [];
    const ownershipJoin = applyOwnedAccountScope({
      user: req.user,
      accountExpression: "a.id",
      params,
      allowGlobal: hasGlobalOpportunityReadScope,
    });
    const rows = await query(
      `SELECT a.id, a.name
       FROM accounts a
       INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
       ${ownershipJoin}
       WHERE aas.code = 'activada'
       ORDER BY a.name`,
      params,
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-contacts",
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const params = [];
    const ownershipJoin = applyOwnedAccountScope({
      user: req.user,
      accountExpression: "c.account_id",
      params,
      allowGlobal: hasGlobalOpportunityReadScope,
    });
    const rows = await query(
      `SELECT c.id, c.account_id,
              CONCAT(c.first_name, ' ', c.last_name) AS full_name
       FROM contacts c
       INNER JOIN accounts a ON a.id = c.account_id
       INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
       INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
       ${ownershipJoin}
       WHERE aas.code = 'activada'
         AND cas.code = 'activado'
       ORDER BY full_name`,
      params,
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-seller-users",
  requirePermission("oportunidades.read"),
  async (_req, res) => {
    const rows = await query(
      `SELECT DISTINCT u.id, u.full_name, u.email
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE u.status = 'active'
         AND LOWER(TRIM(r.name)) = 'vendedor'
       ORDER BY u.full_name`,
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-presales-users",
  requirePermission("oportunidades.read"),
  async (_req, res) => {
    const rows = await query(
      `SELECT DISTINCT u.id, u.full_name, u.email
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE u.status = 'active'
         AND LOWER(TRIM(r.name)) = 'preventa'
       ORDER BY u.full_name`,
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-business-lines",
  requirePermission("oportunidades.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM opportunity_business_lines WHERE is_active = 1 ORDER BY name",
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-sales-stages",
  requirePermission("oportunidades.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name, stage_order FROM opportunity_sales_stages WHERE is_active = 1 ORDER BY stage_order",
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-commercial-statuses",
  requirePermission("oportunidades.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM opportunity_commercial_statuses WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-stage-questions",
  requirePermission("oportunidades.read"),
  async (req, res) => {
    const salesStageId = Number(req.query.salesStageId);
    if (!Number.isInteger(salesStageId) || salesStageId <= 0) {
      return res.status(400).json({ message: "salesStageId invalido" });
    }

    const rows = await query(
      `SELECT q.id, q.sales_stage_id, q.code, q.prompt, q.response_type,
              q.display_order, q.is_required, q.is_active
       FROM opportunity_stage_questions q
       INNER JOIN opportunity_sales_stages s ON s.id = q.sales_stage_id
       WHERE q.sales_stage_id = ?
         AND q.is_active = 1
         AND s.is_active = 1
       ORDER BY q.display_order, q.id`,
      [salesStageId],
    );
    res.json(rows);
  },
);

router.get(
  "/opportunity-stage-questions-admin",
  requirePermission("proceso_comercial_config.read"),
  async (req, res) => {
    const salesStageId = Number(req.query.salesStageId);
    if (!Number.isInteger(salesStageId) || salesStageId <= 0) {
      return res.status(400).json({ message: "salesStageId invalido" });
    }

    const stage = await getOpportunitySalesStageById(salesStageId);
    if (!stage) {
      return res.status(404).json({ message: "Etapa de venta no encontrada" });
    }

    const rows = await getOpportunityStageQuestionsByStageId(salesStageId, {
      includeInactive: true,
    });
    res.json({
      salesStage: stage,
      responseTypes: Array.from(
        ALLOWED_OPPORTUNITY_STAGE_QUESTION_RESPONSE_TYPES,
      ),
      questions: rows,
    });
  },
);

router.post(
  "/opportunity-stage-questions",
  requirePermission("proceso_comercial_config.update"),
  async (req, res) => {
    const parsed = validateOpportunityStageQuestionPayload(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ message: parsed.message });
    }

    const stage = await getOpportunitySalesStageById(parsed.value.salesStageId);
    if (!stage) {
      return res.status(404).json({ message: "Etapa de venta no encontrada" });
    }

    const existingQuestions = await getOpportunityStageQuestionsByStageId(
      Number(stage.id),
      { includeInactive: true },
    );
    const targetOrder = clampDisplayOrder(
      parsed.value.displayOrder,
      existingQuestions.length + 1,
    );

    const questionId = await withTransaction(async (conn) => {
      await makeRoomForStageQuestion(conn, Number(stage.id), targetOrder);
      const [result] = await conn.query(
        `INSERT INTO opportunity_stage_questions
          (sales_stage_id, code, prompt, response_type, display_order, is_required, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [
          Number(stage.id),
          buildOpportunityStageQuestionCode(stage.code),
          parsed.value.prompt,
          parsed.value.responseType,
          targetOrder,
          parsed.value.isRequired ? 1 : 0,
        ],
      );
      return Number(result.insertId);
    });

    const question = await getOpportunityStageQuestionById(questionId);
    return res.status(201).json({
      message: "Pregunta creada correctamente",
      question,
    });
  },
);

router.put(
  "/opportunity-stage-questions/:id",
  requirePermission("proceso_comercial_config.update"),
  async (req, res) => {
    const questionId = Number(req.params.id);
    if (!Number.isInteger(questionId) || questionId <= 0) {
      return res.status(400).json({ message: "questionId invalido" });
    }

    const question = await getOpportunityStageQuestionById(questionId);
    if (!question) {
      return res.status(404).json({ message: "Pregunta no encontrada" });
    }

    const parsed = validateOpportunityStageQuestionPayload(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ message: parsed.message });
    }

    const targetStage = await getOpportunitySalesStageById(
      parsed.value.salesStageId,
    );
    if (!targetStage) {
      return res.status(404).json({ message: "Etapa de venta no encontrada" });
    }

    const targetStageQuestions = await getOpportunityStageQuestionsByStageId(
      Number(targetStage.id),
      { includeInactive: true },
    );
    const movingAcrossStages =
      Number(question.sales_stage_id) !== Number(targetStage.id);
    const targetOrder = clampDisplayOrder(
      parsed.value.displayOrder,
      movingAcrossStages
        ? targetStageQuestions.length + 1
        : targetStageQuestions.length,
    );

    await withTransaction(async (conn) => {
      if (!movingAcrossStages) {
        await moveStageQuestionWithinStage(
          conn,
          question,
          targetOrder || Number(question.display_order),
        );
        await conn.query(
          `UPDATE opportunity_stage_questions
           SET prompt = ?, response_type = ?, is_required = ?
           WHERE id = ?`,
          [
            parsed.value.prompt,
            parsed.value.responseType,
            parsed.value.isRequired ? 1 : 0,
            questionId,
          ],
        );
        return;
      }

      await conn.query(
        `UPDATE opportunity_stage_questions
         SET display_order = 255
         WHERE id = ?`,
        [questionId],
      );

      const [sourceRows] = await conn.query(
        `SELECT id, display_order
         FROM opportunity_stage_questions
         WHERE sales_stage_id = ?
           AND display_order > ?
         ORDER BY display_order ASC, id ASC`,
        [Number(question.sales_stage_id), Number(question.display_order)],
      );
      for (const row of sourceRows) {
        await conn.query(
          `UPDATE opportunity_stage_questions
           SET display_order = ?
           WHERE id = ?`,
          [Number(row.display_order) - 1, Number(row.id)],
        );
      }

      await makeRoomForStageQuestion(conn, Number(targetStage.id), targetOrder);

      await conn.query(
        `UPDATE opportunity_stage_questions
         SET sales_stage_id = ?, prompt = ?, response_type = ?,
             display_order = ?, is_required = ?
         WHERE id = ?`,
        [
          Number(targetStage.id),
          parsed.value.prompt,
          parsed.value.responseType,
          targetOrder,
          parsed.value.isRequired ? 1 : 0,
          questionId,
        ],
      );
    });

    const updatedQuestion = await getOpportunityStageQuestionById(questionId);
    return res.json({
      message: "Pregunta actualizada correctamente",
      question: updatedQuestion,
    });
  },
);

router.patch(
  "/opportunity-stage-questions/:id/status",
  requirePermission("proceso_comercial_config.update"),
  async (req, res) => {
    const questionId = Number(req.params.id);
    if (!Number.isInteger(questionId) || questionId <= 0) {
      return res.status(400).json({ message: "questionId invalido" });
    }

    const nextIsActive = parseQuestionBoolean(req.body?.isActive);
    if (nextIsActive === null) {
      return res.status(400).json({ message: "isActive invalido" });
    }

    const question = await getOpportunityStageQuestionById(questionId);
    if (!question) {
      return res.status(404).json({ message: "Pregunta no encontrada" });
    }

    await query(
      `UPDATE opportunity_stage_questions
       SET is_active = ?
       WHERE id = ?`,
      [nextIsActive ? 1 : 0, questionId],
    );

    const updatedQuestion = await getOpportunityStageQuestionById(questionId);
    return res.json({
      message: nextIsActive
        ? "Pregunta activada correctamente"
        : "Pregunta desactivada correctamente",
      question: updatedQuestion,
    });
  },
);

router.post(
  "/opportunity-stage-questions/reorder",
  requirePermission("proceso_comercial_config.update"),
  async (req, res) => {
    const salesStageId = Number(req.body?.salesStageId);
    const questionIds = Array.isArray(req.body?.questionIds)
      ? req.body.questionIds.map((value) => Number(value))
      : [];

    if (!Number.isInteger(salesStageId) || salesStageId <= 0) {
      return res.status(400).json({ message: "salesStageId invalido" });
    }
    if (
      !questionIds.length ||
      questionIds.some((value) => !Number.isInteger(value) || value <= 0)
    ) {
      return res.status(400).json({ message: "questionIds invalidos" });
    }

    const stage = await getOpportunitySalesStageById(salesStageId);
    if (!stage) {
      return res.status(404).json({ message: "Etapa de venta no encontrada" });
    }

    const currentQuestions = await getOpportunityStageQuestionsByStageId(
      salesStageId,
      { includeInactive: true },
    );
    if (currentQuestions.length !== questionIds.length) {
      return res
        .status(400)
        .json({ message: "La lista de preguntas no coincide con la etapa" });
    }

    const currentIds = new Set(currentQuestions.map((row) => Number(row.id)));
    if (
      questionIds.some((id) => !currentIds.has(id)) ||
      currentIds.size !== questionIds.length
    ) {
      return res
        .status(400)
        .json({ message: "La lista de preguntas no coincide con la etapa" });
    }

    await withTransaction(async (conn) => {
      let working = currentQuestions.map((row) => ({
        id: Number(row.id),
        sales_stage_id: Number(row.sales_stage_id),
        display_order: Number(row.display_order),
      }));

      for (let index = 0; index < questionIds.length; index += 1) {
        const desiredId = Number(questionIds[index]);
        const desiredOrder = index + 1;
        const currentQuestion = working.find((row) => row.id === desiredId);
        if (!currentQuestion) continue;
        if (currentQuestion.display_order === desiredOrder) continue;

        await moveStageQuestionWithinStage(conn, currentQuestion, desiredOrder);

        const reordered = working.filter((row) => row.id !== desiredId);
        reordered.splice(desiredOrder - 1, 0, {
          ...currentQuestion,
          display_order: desiredOrder,
        });
        working = reordered.map((row, workingIndex) => ({
          ...row,
          display_order: workingIndex + 1,
        }));
      }
    });

    const questions = await getOpportunityStageQuestionsByStageId(
      salesStageId,
      {
        includeInactive: true,
      },
    );
    return res.json({
      message: "Orden actualizado correctamente",
      questions,
    });
  },
);

router.get(
  "/opportunity-activation-statuses",
  requirePermission("oportunidades.read"),
  async (_req, res) => {
    const rows = await query(
      "SELECT id, code, name FROM opportunity_activation_statuses WHERE is_active = 1 ORDER BY id",
    );
    res.json(rows);
  },
);

router.get(
  "/quotation-statuses",
  requireAnyPermission([
    "cotizaciones.operacion",
    "cotizaciones.revision",
    "cotizaciones.ingreso",
    "cotizaciones.administracion",
    "cotizaciones.externo",
  ]),
  async (_req, res) => {
    await ensureQuotationStatusesCatalog();
    const rows = await query(
      `SELECT id, code, name, ui_key AS uiKey, display_order
       FROM quotation_statuses
       WHERE is_active = 1
       ORDER BY display_order, id`,
    );
    res.json(rows);
  },
);

router.get(
  "/quotation-actions",
  requireAnyPermission([
    "cotizaciones.operacion",
    "cotizaciones.revision",
    "cotizaciones.ingreso",
    "cotizaciones.administracion",
    "cotizaciones.externo",
  ]),
  async (_req, res) => {
    const rows = await query(
      `SELECT id, code, name, display_order
       FROM quotation_actions
       WHERE is_active = 1
       ORDER BY display_order, id`,
    );
    res.json(rows);
  },
);

router.get(
  "/quotation-section-inclusion-types",
  requireAnyPermission([
    "cotizaciones.operacion",
    "cotizaciones.revision",
    "cotizaciones.ingreso",
    "cotizaciones.administracion",
    "cotizaciones.externo",
  ]),
  async (_req, res) => {
    const rows = await query(
      `SELECT id, code, name, display_order
       FROM quotation_section_inclusion_types
       WHERE is_active = 1
       ORDER BY display_order, id`,
    );
    res.json(rows);
  },
);

router.get(
  "/quotation-delivery-times",
  requireAnyPermission([
    "cotizaciones.operacion",
    "cotizaciones.revision",
    "cotizaciones.ingreso",
    "cotizaciones.administracion",
    "cotizaciones.externo",
  ]),
  async (_req, res) => {
    await ensureQuotationDeliveryTimesCatalog();
    const rows = await query(
      `SELECT id, code, name, display_order
       FROM quotation_delivery_times
       WHERE is_active = 1
       ORDER BY display_order, id`,
    );
    res.json(rows);
  },
);

router.get(
  "/quotation-validity-terms",
  requireAnyPermission([
    "cotizaciones.operacion",
    "cotizaciones.revision",
    "cotizaciones.ingreso",
    "cotizaciones.administracion",
    "cotizaciones.externo",
  ]),
  async (_req, res) => {
    await ensureQuotationValidityCatalog();
    const rows = await query(
      `SELECT id, code, name, display_order
       FROM quotation_validity_terms
       WHERE is_active = 1
       ORDER BY display_order, id`,
    );
    res.json(rows);
  },
);

router.get(
  "/quotation-warranty-terms",
  requireAnyPermission([
    "cotizaciones.operacion",
    "cotizaciones.revision",
    "cotizaciones.ingreso",
    "cotizaciones.administracion",
    "cotizaciones.externo",
  ]),
  async (_req, res) => {
    await ensureQuotationWarrantyCatalog();
    const rows = await query(
      `SELECT id, code, name, display_order
       FROM quotation_warranty_terms
       WHERE is_active = 1
       ORDER BY display_order, id`,
    );
    res.json(rows);
  },
);

router.get(
  "/quotation-payment-terms",
  requireAnyPermission([
    "cotizaciones.operacion",
    "cotizaciones.revision",
    "cotizaciones.ingreso",
    "cotizaciones.administracion",
    "cotizaciones.externo",
  ]),
  async (_req, res) => {
    await ensureQuotationPaymentTermsCatalog();
    const rows = await query(
      `SELECT id, code, name, display_order
       FROM quotation_payment_terms
       WHERE is_active = 1
       ORDER BY display_order, id`,
    );
    res.json(rows);
  },
);

router.get(
  "/quotation-currencies",
  requireAnyPermission([
    "cotizaciones.operacion",
    "cotizaciones.revision",
    "cotizaciones.ingreso",
    "cotizaciones.administracion",
    "cotizaciones.externo",
  ]),
  async (_req, res) => {
    const rows = await query(
      `SELECT DISTINCT curr.id, curr.code, curr.name, curr.symbol, curr.decimals
       FROM countries c
       INNER JOIN country_currency cc ON cc.country_id = c.id
       INNER JOIN currencies curr ON curr.id = cc.currency_id
       WHERE c.is_active = 1
         AND curr.is_active = 1
         AND (cc.valid_to IS NULL OR cc.valid_to >= CURRENT_DATE())
         AND (cc.valid_from IS NULL OR cc.valid_from <= CURRENT_DATE())
       ORDER BY curr.name, curr.code`,
    );
    res.json(rows);
  },
);

router.get(
  "/quotation-activation-statuses",
  requireAnyPermission([
    "cotizaciones.operacion",
    "cotizaciones.revision",
    "cotizaciones.ingreso",
    "cotizaciones.administracion",
    "cotizaciones.externo",
  ]),
  async (_req, res) => {
    const rows = await query(
      `SELECT id, code, name, display_order
       FROM quotation_activation_statuses
       WHERE is_active = 1
       ORDER BY display_order, id`,
    );
    res.json(rows);
  },
);

router.get(
  "/quotation-providers",
  requireAnyPermission([
    "cotizaciones.operacion",
    "cotizaciones.revision",
    "cotizaciones.ingreso",
    "cotizaciones.administracion",
    "cotizaciones.externo",
  ]),
  async (_req, res) => {
    const rows = await query(
      `SELECT p.id, p.name
       FROM providers p
       INNER JOIN provider_activation_statuses pas ON pas.id = p.activation_status_id
       WHERE pas.code = 'activado'
       ORDER BY p.name`,
    );
    res.json(rows);
  },
);

export default router;
