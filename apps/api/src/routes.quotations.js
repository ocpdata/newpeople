import express from "express";
import { z } from "zod";
import { query, withTransaction } from "./db.js";
import { requireAnyPermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";

const router = express.Router();

const quotationPermissionCodes = [
  "cotizaciones.operacion",
  "cotizaciones.revision",
  "cotizaciones.ingreso",
  "cotizaciones.administracion",
  "cotizaciones.externo",
];

const quotationItemTypes = ["producto", "servicio_propio", "grupo_productos"];

const quotationBundleOriginTypes = ["price_list_bundle", "manual_bundle"];

const quotationSummaryDiscountModes = ["percentage", "amount"];
const quotationSummaryDistributionModes = ["total", "per_item"];
const quotationSummaryVatModes = ["without_vat", "total", "per_item"];
const DEFAULT_QUOTATION_VAT_PCT = 16;

const quotationActionTransitionMap = {
  solicitar_aprobacion: "en_aprobacion",
  aprobar: "aprobada",
  rechazar: "rechazada",
  enviar: "enviada",
  declarar_ganada: "ganada",
  declarar_perdida: "perdida",
  declarar_anulada: "anulada",
  ponerla_borrador: "borrador",
  aceptar: "aceptada",
};

const versionPayloadSchema = z.object({
  contactId: z.number().int().positive(),
  proposalName: z.string().trim().min(2).max(180).optional(),
  quotationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  introduction: z.string().trim().max(50000).optional().nullable(),
  activationStatusCode: z.string().trim().min(1).max(80).optional(),
  summaryDiscountMode: z
    .enum(quotationSummaryDiscountModes)
    .optional()
    .nullable(),
  summaryDiscountValue: z.number().min(0).optional().nullable(),
  summaryDistributionMode: z
    .enum(quotationSummaryDistributionModes)
    .optional()
    .nullable(),
  summaryVatMode: z.enum(quotationSummaryVatModes).optional().nullable(),
  summaryVatPct: z.number().min(0).max(100).optional().nullable(),
  internalNotes: z.string().trim().max(50000).optional().nullable(),
  deliveryTime: z.string().trim().min(1).max(120).optional().nullable(),
  quotationValidity: z.string().trim().min(1).max(120).optional().nullable(),
  warranty: z.string().trim().min(1).max(120).optional().nullable(),
  paymentTerms: z.string().trim().min(1).max(180).optional().nullable(),
  currencyCode: z.string().trim().min(1).max(20).optional().nullable(),
  exchangeRate: z.number().positive().optional().nullable(),
  quotationNotes: z.string().trim().max(50000).optional().nullable(),
});

const versionUpdateSchema = versionPayloadSchema;

const transitionSchema = z.object({
  actionCode: z.enum([
    "solicitar_aprobacion",
    "aprobar",
    "rechazar",
    "enviar",
    "declarar_ganada",
    "declarar_perdida",
    "declarar_anulada",
    "ponerla_borrador",
    "aceptar",
  ]),
});

const sectionSchema = z.object({
  title: z.string().trim().min(1).max(180),
  inclusionTypeId: z.number().int().positive(),
  items: z
    .array(z.lazy(() => itemSchema))
    .optional()
    .default([]),
  displayOrder: z.number().int().positive().optional(),
});

const quotationCreateSchema = z.object({
  accountId: z.number().int().positive(),
  contactId: z.number().int().positive(),
  sellerUserId: z.number().int().positive(),
  proposalName: z.string().trim().min(2).max(180).optional(),
  quotationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  introduction: z.string().trim().max(50000).optional().nullable(),
  activationStatusCode: z.string().trim().min(1).max(80).optional(),
  summaryDiscountMode: z
    .enum(quotationSummaryDiscountModes)
    .optional()
    .nullable(),
  summaryDiscountValue: z.number().min(0).optional().nullable(),
  summaryDistributionMode: z
    .enum(quotationSummaryDistributionModes)
    .optional()
    .nullable(),
  summaryVatMode: z.enum(quotationSummaryVatModes).optional().nullable(),
  summaryVatPct: z.number().min(0).max(100).optional().nullable(),
  internalNotes: z.string().trim().max(50000).optional().nullable(),
  deliveryTime: z.string().trim().min(1).max(120).optional().nullable(),
  quotationValidity: z.string().trim().min(1).max(120).optional().nullable(),
  warranty: z.string().trim().min(1).max(120).optional().nullable(),
  paymentTerms: z.string().trim().min(1).max(180).optional().nullable(),
  currencyCode: z.string().trim().min(1).max(20).optional().nullable(),
  exchangeRate: z.number().positive().optional().nullable(),
  quotationNotes: z.string().trim().max(50000).optional().nullable(),
  sections: z.array(sectionSchema).optional().default([]),
});

const itemSchema = z.object({
  clientItemId: z.string().trim().min(1).max(120).optional(),
  providerId: z.number().int().positive(),
  productCode: z.string().trim().min(1).max(120),
  productDescription: z.string().trim().min(1).max(5000),
  quantity: z.number().positive(),
  listPriceUnit: z.number().nonnegative(),
  manufacturerDiscountPct: z.number().min(0).max(100),
  importCostPct: z.number().min(0).max(100),
  profitMarginPct: z.number().min(0).max(100),
  finalDiscountPct: z.number().min(0).max(100).optional().default(0),
  itemType: z.enum(quotationItemTypes).optional().default("producto"),
  bundleParentClientItemId: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .nullable(),
  bundleParentItemId: z.number().int().positive().optional().nullable(),
  bundleOriginType: z.enum(quotationBundleOriginTypes).optional().nullable(),
  sourceProviderPriceListItemId: z
    .number()
    .int()
    .positive()
    .optional()
    .nullable(),
  sourceComponentPriceListItemId: z
    .number()
    .int()
    .positive()
    .optional()
    .nullable(),
  bundleSortOrder: z.number().int().positive().optional().nullable(),
  displayOrder: z.number().int().positive().optional(),
});

const fullSaveItemSchema = itemSchema.extend({
  id: z.number().int().positive().optional(),
  localId: z.string().trim().min(1).max(120),
  bundleParentLocalId: z.string().trim().min(1).max(120).optional().nullable(),
  bundleParentItemId: z.number().int().positive().optional().nullable(),
});

const fullSaveSectionSchema = z.object({
  id: z.number().int().positive().optional(),
  localId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(180),
  inclusionTypeId: z.number().int().positive(),
  displayOrder: z.number().int().positive().optional(),
  items: z.array(fullSaveItemSchema).optional().default([]),
});

const versionFullSaveSchema = versionPayloadSchema.extend({
  sections: z.array(fullSaveSectionSchema).optional().default([]),
});

function buildQuotationVersionBaseSaleTotalJoin(versionAlias = "lv") {
  return `LEFT JOIN (
      SELECT qs.quotation_version_id,
             SUM(
               CASE
                 WHEN qsi.profit_margin_pct >= 100 THEN 0
                 ELSE qsi.quantity * (
                   (
                     qsi.list_price_unit *
                     (1 - (qsi.manufacturer_discount_pct / 100)) *
                     (1 + (qsi.import_cost_pct / 100))
                   ) /
                   (1 - (qsi.profit_margin_pct / 100)) *
                   (1 - (qsi.final_discount_pct / 100))
                 )
               END
             ) AS base_sale_total
      FROM quotation_sections qs
      INNER JOIN quotation_section_items qsi ON qsi.quotation_section_id = qs.id
      LEFT JOIN quotation_section_items child
        ON child.bundle_parent_item_id = qsi.id
       AND child.quotation_section_id = qs.id
      WHERE child.id IS NULL
        AND qsi.item_type <> 'grupo_productos'
      GROUP BY qs.quotation_version_id
    ) latest_total ON latest_total.quotation_version_id = ${versionAlias}.id`;
}

function buildQuotationVersionEffectiveTotalSql({
  versionAlias = "lv",
  totalsAlias = "latest_total",
} = {}) {
  const baseTotalSql = `COALESCE(${totalsAlias}.base_sale_total, 0)`;
  const vatPctSql = `COALESCE(${versionAlias}.summary_vat_pct, ${DEFAULT_QUOTATION_VAT_PCT})`;
  const totalWithPerItemVatSql = `CASE
      WHEN ${versionAlias}.summary_vat_mode = 'per_item'
        THEN ${baseTotalSql} * (1 + (${vatPctSql} / 100))
      ELSE ${baseTotalSql}
    END`;
  const discountedTotalSql = `CASE
      WHEN ${versionAlias}.summary_distribution_mode = 'per_item'
        THEN ${totalWithPerItemVatSql}
      WHEN ${versionAlias}.summary_discount_mode = 'amount'
        THEN GREATEST(
          ${totalWithPerItemVatSql} - LEAST(COALESCE(${versionAlias}.summary_discount_value, 0), ${totalWithPerItemVatSql}),
          0
        )
      WHEN ${versionAlias}.summary_discount_mode = 'percentage'
        THEN ${totalWithPerItemVatSql} *
          (1 - (LEAST(GREATEST(COALESCE(${versionAlias}.summary_discount_value, 0), 0), 100) / 100))
      ELSE ${totalWithPerItemVatSql}
    END`;

  return `CASE
      WHEN ${versionAlias}.id IS NULL THEN NULL
      WHEN ${versionAlias}.summary_vat_mode = 'total'
        THEN ${discountedTotalSql} * (1 + (${vatPctSql} / 100))
      ELSE ${discountedTotalSql}
    END`;
}

let ensureQuotationSectionItemsSchemaPromise;
let ensureQuotationVersionsSchemaPromise;
let ensureQuotationStatusesSchemaPromise;

async function ensureQuotationStatusesSchema() {
  if (!ensureQuotationStatusesSchemaPromise) {
    ensureQuotationStatusesSchemaPromise = (async () => {
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
      ensureQuotationStatusesSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureQuotationStatusesSchemaPromise;
}

async function ensureQuotationVersionsColumn(columnName, ddl) {
  const rows = await query(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'quotation_versions'
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [columnName],
  );

  if (!rows.length) {
    await query(ddl);
  }
}

async function ensureQuotationVersionsDecimalScale(
  columnName,
  precision,
  scale,
) {
  const rows = await query(
    `SELECT NUMERIC_PRECISION AS numeric_precision,
            NUMERIC_SCALE AS numeric_scale
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'quotation_versions'
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [columnName],
  );

  if (!rows.length) {
    return;
  }

  const currentPrecision = Number(rows[0].numeric_precision || 0);
  const currentScale = Number(rows[0].numeric_scale || 0);

  if (currentPrecision !== precision || currentScale !== scale) {
    await query(
      `ALTER TABLE quotation_versions
       MODIFY COLUMN ${columnName} DECIMAL(${precision}, ${scale}) NULL`,
    );
  }
}

async function ensureQuotationVersionsSchema() {
  if (!ensureQuotationVersionsSchemaPromise) {
    ensureQuotationVersionsSchemaPromise = (async () => {
      await ensureQuotationVersionsColumn(
        "summary_discount_mode",
        `ALTER TABLE quotation_versions
         ADD COLUMN summary_discount_mode VARCHAR(20) NULL
         AFTER activation_status_id`,
      );
      await ensureQuotationVersionsColumn(
        "summary_discount_value",
        `ALTER TABLE quotation_versions
         ADD COLUMN summary_discount_value DECIMAL(15, 8) NULL
         AFTER summary_discount_mode`,
      );
      await ensureQuotationVersionsColumn(
        "summary_distribution_mode",
        `ALTER TABLE quotation_versions
         ADD COLUMN summary_distribution_mode VARCHAR(20) NULL
         AFTER summary_discount_value`,
      );
      await ensureQuotationVersionsColumn(
        "summary_vat_mode",
        `ALTER TABLE quotation_versions
         ADD COLUMN summary_vat_mode VARCHAR(20) NULL
         AFTER summary_distribution_mode`,
      );
      await ensureQuotationVersionsColumn(
        "summary_vat_pct",
        `ALTER TABLE quotation_versions
         ADD COLUMN summary_vat_pct DECIMAL(15, 8) NULL
         AFTER summary_vat_mode`,
      );
      await ensureQuotationVersionsColumn(
        "internal_notes",
        `ALTER TABLE quotation_versions
         ADD COLUMN internal_notes LONGTEXT NULL
         AFTER summary_vat_pct`,
      );
      await ensureQuotationVersionsColumn(
        "delivery_time",
        `ALTER TABLE quotation_versions
         ADD COLUMN delivery_time VARCHAR(120) NULL
         AFTER internal_notes`,
      );
      await ensureQuotationVersionsColumn(
        "quotation_validity",
        `ALTER TABLE quotation_versions
         ADD COLUMN quotation_validity VARCHAR(120) NULL
         AFTER delivery_time`,
      );
      await ensureQuotationVersionsColumn(
        "warranty_term",
        `ALTER TABLE quotation_versions
         ADD COLUMN warranty_term VARCHAR(120) NULL
         AFTER quotation_validity`,
      );
      await ensureQuotationVersionsColumn(
        "payment_terms",
        `ALTER TABLE quotation_versions
         ADD COLUMN payment_terms VARCHAR(180) NULL
         AFTER warranty_term`,
      );
      await ensureQuotationVersionsColumn(
        "currency_code",
        `ALTER TABLE quotation_versions
         ADD COLUMN currency_code VARCHAR(20) NULL
         AFTER payment_terms`,
      );
      await ensureQuotationVersionsColumn(
        "exchange_rate",
        `ALTER TABLE quotation_versions
         ADD COLUMN exchange_rate DECIMAL(15, 4) NULL
         AFTER currency_code`,
      );
      await ensureQuotationVersionsColumn(
        "quotation_notes",
        `ALTER TABLE quotation_versions
         ADD COLUMN quotation_notes LONGTEXT NULL
         AFTER exchange_rate`,
      );
      await ensureQuotationVersionsDecimalScale(
        "summary_discount_value",
        15,
        8,
      );
      await ensureQuotationVersionsDecimalScale("summary_vat_pct", 15, 8);
      await ensureQuotationVersionsDecimalScale("exchange_rate", 15, 4);
    })().catch((error) => {
      ensureQuotationVersionsSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureQuotationVersionsSchemaPromise;
}

async function ensureQuotationSectionItemsColumn(columnName, ddl) {
  const rows = await query(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'quotation_section_items'
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [columnName],
  );

  if (!rows.length) {
    await query(ddl);
  }
}

async function ensureQuotationSectionItemsIndex(indexName, ddl) {
  const rows = await query(
    `SELECT 1
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'quotation_section_items'
       AND INDEX_NAME = ?
     LIMIT 1`,
    [indexName],
  );

  if (!rows.length) {
    await query(ddl);
  }
}

async function ensureQuotationSectionItemsConstraint(constraintName, ddl) {
  const rows = await query(
    `SELECT 1
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'quotation_section_items'
       AND CONSTRAINT_NAME = ?
     LIMIT 1`,
    [constraintName],
  );

  if (!rows.length) {
    await query(ddl);
  }
}

async function ensureQuotationSectionItemsSchema() {
  if (!ensureQuotationSectionItemsSchemaPromise) {
    ensureQuotationSectionItemsSchemaPromise = (async () => {
      await ensureQuotationSectionItemsColumn(
        "final_discount_pct",
        `ALTER TABLE quotation_section_items
         ADD COLUMN final_discount_pct DECIMAL(7, 4) NOT NULL DEFAULT 0
         AFTER profit_margin_pct`,
      );
      await ensureQuotationSectionItemsColumn(
        "item_type",
        `ALTER TABLE quotation_section_items
         ADD COLUMN item_type VARCHAR(40) NOT NULL DEFAULT 'producto'
         AFTER product_description`,
      );
      await ensureQuotationSectionItemsColumn(
        "bundle_parent_item_id",
        `ALTER TABLE quotation_section_items
         ADD COLUMN bundle_parent_item_id BIGINT UNSIGNED NULL
         AFTER item_type`,
      );
      await ensureQuotationSectionItemsColumn(
        "bundle_origin_type",
        `ALTER TABLE quotation_section_items
         ADD COLUMN bundle_origin_type VARCHAR(40) NULL
         AFTER bundle_parent_item_id`,
      );
      await ensureQuotationSectionItemsColumn(
        "source_provider_price_list_item_id",
        `ALTER TABLE quotation_section_items
         ADD COLUMN source_provider_price_list_item_id BIGINT UNSIGNED NULL
         AFTER bundle_origin_type`,
      );
      await ensureQuotationSectionItemsColumn(
        "source_component_price_list_item_id",
        `ALTER TABLE quotation_section_items
         ADD COLUMN source_component_price_list_item_id BIGINT UNSIGNED NULL
         AFTER source_provider_price_list_item_id`,
      );
      await ensureQuotationSectionItemsColumn(
        "bundle_sort_order",
        `ALTER TABLE quotation_section_items
         ADD COLUMN bundle_sort_order INT UNSIGNED NULL
         AFTER display_order`,
      );
      await ensureQuotationSectionItemsIndex(
        "idx_quotation_section_items_bundle_parent",
        `ALTER TABLE quotation_section_items
         ADD INDEX idx_quotation_section_items_bundle_parent (bundle_parent_item_id, bundle_sort_order, display_order)`,
      );
      await ensureQuotationSectionItemsConstraint(
        "fk_quotation_section_items_bundle_parent",
        `ALTER TABLE quotation_section_items
         ADD CONSTRAINT fk_quotation_section_items_bundle_parent
         FOREIGN KEY (bundle_parent_item_id) REFERENCES quotation_section_items(id) ON DELETE CASCADE`,
      );
      await ensureQuotationSectionItemsConstraint(
        "fk_quotation_section_items_source_provider_price_item",
        `ALTER TABLE quotation_section_items
         ADD CONSTRAINT fk_quotation_section_items_source_provider_price_item
         FOREIGN KEY (source_provider_price_list_item_id) REFERENCES provider_price_list_items(id) ON DELETE SET NULL`,
      );
      await ensureQuotationSectionItemsConstraint(
        "fk_quotation_section_items_source_component_price_item",
        `ALTER TABLE quotation_section_items
         ADD CONSTRAINT fk_quotation_section_items_source_component_price_item
         FOREIGN KEY (source_component_price_list_item_id) REFERENCES provider_price_list_items(id) ON DELETE SET NULL`,
      );
    })().catch((error) => {
      ensureQuotationSectionItemsSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureQuotationSectionItemsSchemaPromise;
}

router.use(async (_req, _res, next) => {
  try {
    await ensureQuotationStatusesSchema();
    await ensureQuotationVersionsSchema();
    await ensureQuotationSectionItemsSchema();
    next();
  } catch (error) {
    next(error);
  }
});

function deriveBundleOriginType(item) {
  if (item.bundleOriginType) {
    return item.bundleOriginType;
  }

  if (item.itemType === "grupo_productos") {
    return item.sourceProviderPriceListItemId
      ? "price_list_bundle"
      : "manual_bundle";
  }

  if (item.bundleParentClientItemId || item.bundleParentItemId) {
    return item.sourceComponentPriceListItemId ? "price_list_bundle" : null;
  }

  return null;
}

function validateAndNormalizeSectionItemsForCreate(items = []) {
  const normalizedItems = [];
  const itemByClientId = new Map();
  const nextBundleSortOrderByParent = new Map();

  for (const [index, item] of items.entries()) {
    const clientItemId = String(
      item.clientItemId || `section-item-${index + 1}`,
    ).trim();

    if (itemByClientId.has(clientItemId)) {
      return {
        ok: false,
        message: `Id temporal duplicado para item de cotizacion: ${clientItemId}`,
      };
    }

    const normalizedItem = {
      ...item,
      clientItemId,
      itemType: item.itemType || "producto",
      bundleParentClientItemId: item.bundleParentClientItemId
        ? String(item.bundleParentClientItemId).trim()
        : null,
      bundleOriginType: deriveBundleOriginType(item),
      sourceProviderPriceListItemId: item.sourceProviderPriceListItemId
        ? Number(item.sourceProviderPriceListItemId)
        : null,
      sourceComponentPriceListItemId: item.sourceComponentPriceListItemId
        ? Number(item.sourceComponentPriceListItemId)
        : null,
      bundleSortOrder: item.bundleSortOrder
        ? Number(item.bundleSortOrder)
        : null,
      displayOrder: Number(item.displayOrder || index + 1),
    };

    normalizedItems.push(normalizedItem);
    itemByClientId.set(clientItemId, normalizedItem);
  }

  for (const item of normalizedItems) {
    if (item.bundleParentItemId) {
      return {
        ok: false,
        message:
          "El payload de creacion debe usar bundleParentClientItemId para relacionar componentes",
      };
    }

    if (item.bundleParentClientItemId) {
      const parentItem = itemByClientId.get(item.bundleParentClientItemId);
      if (!parentItem) {
        return {
          ok: false,
          message: `No existe el bundle padre indicado para el item ${item.productCode}`,
        };
      }
      if (parentItem.itemType !== "grupo_productos") {
        return {
          ok: false,
          message: `El item padre de ${item.productCode} debe ser de tipo Bundle`,
        };
      }
      if (item.itemType === "grupo_productos") {
        return {
          ok: false,
          message: "No se permiten bundles anidados dentro de una cotizacion",
        };
      }

      if (!item.bundleOriginType) {
        item.bundleOriginType = parentItem.bundleOriginType || null;
      }

      if (!item.bundleSortOrder) {
        const nextSortOrder =
          (nextBundleSortOrderByParent.get(parentItem.clientItemId) || 0) + 1;
        nextBundleSortOrderByParent.set(parentItem.clientItemId, nextSortOrder);
        item.bundleSortOrder = nextSortOrder;
      }
      continue;
    }

    if (item.itemType === "grupo_productos" && !item.bundleOriginType) {
      item.bundleOriginType = "manual_bundle";
    }

    item.bundleSortOrder = null;
  }

  return { ok: true, items: normalizedItems };
}

function validateAndNormalizeSectionItemsForFullSave(items = []) {
  const normalizedItems = [];
  const itemByLocalId = new Map();
  const itemByPersistedId = new Map();
  const nextBundleSortOrderByParent = new Map();

  for (const [index, item] of items.entries()) {
    const localId = String(item.localId || `section-item-${index + 1}`).trim();
    if (itemByLocalId.has(localId)) {
      return {
        ok: false,
        message: `Id local duplicado para item de cotizacion: ${localId}`,
      };
    }

    if (item.id) {
      const persistedId = Number(item.id);
      if (itemByPersistedId.has(persistedId)) {
        return {
          ok: false,
          message: `Id persistido duplicado para item de cotizacion: ${persistedId}`,
        };
      }
      itemByPersistedId.set(persistedId, true);
    }

    const normalizedItem = {
      ...item,
      id: item.id ? Number(item.id) : null,
      localId,
      itemType: item.itemType || "producto",
      bundleParentLocalId: item.bundleParentLocalId
        ? String(item.bundleParentLocalId).trim()
        : null,
      bundleParentItemId: item.bundleParentItemId
        ? Number(item.bundleParentItemId)
        : null,
      bundleOriginType: deriveBundleOriginType(item),
      sourceProviderPriceListItemId: item.sourceProviderPriceListItemId
        ? Number(item.sourceProviderPriceListItemId)
        : null,
      sourceComponentPriceListItemId: item.sourceComponentPriceListItemId
        ? Number(item.sourceComponentPriceListItemId)
        : null,
      bundleSortOrder: item.bundleSortOrder
        ? Number(item.bundleSortOrder)
        : null,
      displayOrder: Number(item.displayOrder || index + 1),
    };

    normalizedItems.push(normalizedItem);
    itemByLocalId.set(localId, normalizedItem);
  }

  for (const item of normalizedItems) {
    if (item.bundleParentItemId && !item.bundleParentLocalId) {
      const parentById = normalizedItems.find(
        (candidate) => candidate.id && candidate.id === item.bundleParentItemId,
      );
      item.bundleParentLocalId = parentById ? parentById.localId : null;
    }

    if (item.bundleParentLocalId) {
      const parentItem = itemByLocalId.get(item.bundleParentLocalId);
      if (!parentItem) {
        return {
          ok: false,
          message: `No existe el bundle padre indicado para el item ${item.productCode}`,
        };
      }
      if (parentItem.localId === item.localId) {
        return {
          ok: false,
          message: "Un item no puede ser padre de si mismo",
        };
      }
      if (parentItem.itemType !== "grupo_productos") {
        return {
          ok: false,
          message: `El item padre de ${item.productCode} debe ser de tipo Bundle`,
        };
      }
      if (item.itemType === "grupo_productos") {
        return {
          ok: false,
          message: "No se permiten bundles anidados dentro de una cotizacion",
        };
      }

      if (!item.bundleOriginType) {
        item.bundleOriginType = parentItem.bundleOriginType || null;
      }

      if (!item.bundleSortOrder) {
        const nextSortOrder =
          (nextBundleSortOrderByParent.get(parentItem.localId) || 0) + 1;
        nextBundleSortOrderByParent.set(parentItem.localId, nextSortOrder);
        item.bundleSortOrder = nextSortOrder;
      }
      continue;
    }

    if (item.itemType === "grupo_productos" && !item.bundleOriginType) {
      item.bundleOriginType = "manual_bundle";
    }

    item.bundleSortOrder = null;
  }

  return { ok: true, items: normalizedItems };
}

function validateAndNormalizeFullSaveSections(sections = []) {
  const normalizedSections = [];
  const sectionByLocalId = new Map();
  const sectionByPersistedId = new Map();

  for (const [index, section] of sections.entries()) {
    const localId = String(section.localId || `section-${index + 1}`).trim();
    if (sectionByLocalId.has(localId)) {
      return {
        ok: false,
        message: `Id local duplicado para seccion de cotizacion: ${localId}`,
      };
    }

    if (section.id) {
      const persistedId = Number(section.id);
      if (sectionByPersistedId.has(persistedId)) {
        return {
          ok: false,
          message: `Id persistido duplicado para seccion de cotizacion: ${persistedId}`,
        };
      }
      sectionByPersistedId.set(persistedId, true);
    }

    const normalizedItems = validateAndNormalizeSectionItemsForFullSave(
      section.items || [],
    );
    if (!normalizedItems.ok) {
      return normalizedItems;
    }

    const normalizedSection = {
      ...section,
      id: section.id ? Number(section.id) : null,
      localId,
      displayOrder: Number(section.displayOrder || index + 1),
      items: normalizedItems.items,
    };

    normalizedSections.push(normalizedSection);
    sectionByLocalId.set(localId, normalizedSection);
  }

  return { ok: true, sections: normalizedSections };
}

async function upsertQuotationSectionItemsForFullSave(
  conn,
  { sectionId, currentItemsById, items, now, userId },
) {
  const keptItemIds = new Set();
  const persistedItemIdByLocalId = new Map();
  const pendingRelationships = [];

  for (const [itemIndex, item] of items.entries()) {
    const displayOrder = Number(item.displayOrder || itemIndex + 1);
    const bundleSortOrder = item.bundleParentLocalId
      ? Number(item.bundleSortOrder || 1)
      : null;

    if (item.id) {
      const currentItem = currentItemsById.get(Number(item.id));
      if (!currentItem) {
        throw new Error(`Item invalido para la seccion: ${item.id}`);
      }

      await conn.query(
        `UPDATE quotation_section_items
         SET provider_id = ?, product_code = ?, product_description = ?, item_type = ?,
             bundle_parent_item_id = NULL, bundle_origin_type = ?,
             source_provider_price_list_item_id = ?, source_component_price_list_item_id = ?,
             quantity = ?, list_price_unit = ?, manufacturer_discount_pct = ?, import_cost_pct = ?,
             profit_margin_pct = ?, final_discount_pct = ?, display_order = ?, bundle_sort_order = ?,
             updated_at = ?, updated_by_user_id = ?
         WHERE id = ?`,
        [
          Number(item.providerId),
          item.productCode,
          item.productDescription,
          item.itemType || "producto",
          item.bundleOriginType || null,
          item.sourceProviderPriceListItemId || null,
          item.sourceComponentPriceListItemId || null,
          Number(item.quantity),
          Number(item.listPriceUnit),
          Number(item.manufacturerDiscountPct),
          Number(item.importCostPct),
          Number(item.profitMarginPct),
          Number(item.finalDiscountPct || 0),
          displayOrder,
          bundleSortOrder,
          now,
          Number(userId),
          Number(item.id),
        ],
      );

      keptItemIds.add(Number(item.id));
      persistedItemIdByLocalId.set(item.localId, Number(item.id));
    } else {
      const [result] = await conn.query(
        `INSERT INTO quotation_section_items
          (quotation_section_id, provider_id, product_code, product_description, item_type, bundle_parent_item_id,
           bundle_origin_type, source_provider_price_list_item_id, source_component_price_list_item_id,
           quantity, list_price_unit, manufacturer_discount_pct, import_cost_pct, profit_margin_pct,
           final_discount_pct, display_order, bundle_sort_order, created_at, updated_at, created_by_user_id, updated_by_user_id)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          Number(sectionId),
          Number(item.providerId),
          item.productCode,
          item.productDescription,
          item.itemType || "producto",
          item.bundleOriginType || null,
          item.sourceProviderPriceListItemId || null,
          item.sourceComponentPriceListItemId || null,
          Number(item.quantity),
          Number(item.listPriceUnit),
          Number(item.manufacturerDiscountPct),
          Number(item.importCostPct),
          Number(item.profitMarginPct),
          Number(item.finalDiscountPct || 0),
          displayOrder,
          bundleSortOrder,
          now,
          now,
          Number(userId),
          Number(userId),
        ],
      );

      const insertedItemId = Number(result.insertId);
      keptItemIds.add(insertedItemId);
      persistedItemIdByLocalId.set(item.localId, insertedItemId);
    }

    if (item.bundleParentLocalId) {
      pendingRelationships.push({
        itemLocalId: item.localId,
        parentLocalId: item.bundleParentLocalId,
      });
    }
  }

  for (const relation of pendingRelationships) {
    const itemId = persistedItemIdByLocalId.get(relation.itemLocalId);
    const parentId = persistedItemIdByLocalId.get(relation.parentLocalId);
    if (!itemId || !parentId) {
      throw new Error(
        `No fue posible resolver el bundle padre ${relation.parentLocalId}`,
      );
    }
    await conn.query(
      `UPDATE quotation_section_items
       SET bundle_parent_item_id = ?
       WHERE id = ?`,
      [parentId, itemId],
    );
  }

  return { keptItemIds };
}

async function validateBundleParentInSection({
  sectionId,
  bundleParentItemId,
  currentItemId = null,
}) {
  if (!bundleParentItemId) {
    return { ok: true, parentRow: null };
  }

  if (currentItemId && Number(currentItemId) === Number(bundleParentItemId)) {
    return { ok: false, message: "Un item no puede ser padre de si mismo" };
  }

  const rows = await query(
    `SELECT id, quotation_section_id, item_type
     FROM quotation_section_items
     WHERE id = ?
     LIMIT 1`,
    [Number(bundleParentItemId)],
  );

  if (!rows.length) {
    return { ok: false, message: "Bundle padre invalido" };
  }

  const parentRow = rows[0];
  if (Number(parentRow.quotation_section_id) !== Number(sectionId)) {
    return {
      ok: false,
      message: "El bundle padre debe pertenecer a la misma seccion",
    };
  }
  if (String(parentRow.item_type) !== "grupo_productos") {
    return {
      ok: false,
      message: "El item padre debe ser de tipo Bundle",
    };
  }

  return { ok: true, parentRow };
}

async function validatePersistentQuotationItemBundleShape({
  sectionId,
  itemType,
  bundleParentItemId,
  currentItemId = null,
}) {
  if (bundleParentItemId) {
    const parentValidation = await validateBundleParentInSection({
      sectionId,
      bundleParentItemId,
      currentItemId,
    });
    if (!parentValidation.ok) {
      return parentValidation;
    }

    if (itemType === "grupo_productos") {
      return {
        ok: false,
        message: "No se permiten bundles anidados dentro de una cotizacion",
      };
    }
  }

  if (currentItemId && itemType !== "grupo_productos") {
    const childRows = await query(
      `SELECT 1
       FROM quotation_section_items
       WHERE bundle_parent_item_id = ?
       LIMIT 1`,
      [Number(currentItemId)],
    );

    if (childRows.length) {
      return {
        ok: false,
        message: "El item tiene componentes y debe mantenerse como Bundle",
      };
    }
  }

  return { ok: true };
}

async function insertQuotationSectionItems(
  conn,
  { sectionId, items, now, userId, refField, parentRefField },
) {
  const insertedIdsByRef = new Map();
  const pendingRelationships = [];

  for (const [itemIndex, item] of items.entries()) {
    const [result] = await conn.query(
      `INSERT INTO quotation_section_items
        (quotation_section_id, provider_id, product_code, product_description, item_type, bundle_parent_item_id,
         bundle_origin_type, source_provider_price_list_item_id, source_component_price_list_item_id,
         quantity, list_price_unit, manufacturer_discount_pct, import_cost_pct, profit_margin_pct,
         final_discount_pct, display_order, bundle_sort_order, created_at, updated_at, created_by_user_id, updated_by_user_id)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sectionId,
        Number(item.providerId),
        item.productCode,
        item.productDescription,
        item.itemType || "producto",
        item.bundleOriginType || null,
        item.sourceProviderPriceListItemId || null,
        item.sourceComponentPriceListItemId || null,
        Number(item.quantity),
        Number(item.listPriceUnit),
        Number(item.manufacturerDiscountPct),
        Number(item.importCostPct),
        Number(item.profitMarginPct),
        Number(item.finalDiscountPct || 0),
        Number(item.displayOrder || itemIndex + 1),
        item.bundleSortOrder ? Number(item.bundleSortOrder) : null,
        now,
        now,
        Number(userId),
        Number(userId),
      ],
    );

    const insertedId = Number(result.insertId);
    insertedIdsByRef.set(String(item[refField]), insertedId);

    if (item[parentRefField]) {
      pendingRelationships.push({
        itemId: insertedId,
        parentRef: String(item[parentRefField]),
      });
    }
  }

  for (const relation of pendingRelationships) {
    const parentId = insertedIdsByRef.get(relation.parentRef);
    if (!parentId) {
      throw new Error(
        `No fue posible resolver el bundle padre ${relation.parentRef}`,
      );
    }
    await conn.query(
      `UPDATE quotation_section_items
       SET bundle_parent_item_id = ?
       WHERE id = ?`,
      [parentId, relation.itemId],
    );
  }
}

function hasQuotationAdministration(user) {
  return user?.permissionSet?.has("cotizaciones.administracion");
}

function hasAnyQuotationPermission(user) {
  return quotationPermissionCodes.some((permission) =>
    user?.permissionSet?.has(permission),
  );
}

function applyOwnedAccountScope({ user, accountExpression, params }) {
  if (hasQuotationAdministration(user)) return "";
  params.push(Number(user.id));
  return `INNER JOIN account_owners ao_scope ON ao_scope.account_id = ${accountExpression} AND ao_scope.user_id = ?`;
}

function formatDateOnly(value) {
  if (!value) return "";
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const normalized = String(value).trim();
  if (!normalized) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(normalized)) {
    return normalized.slice(0, 10);
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toISOString().slice(0, 10);
}

async function getCatalogRowByCode(table, code) {
  const rows = await query(
    `SELECT id, code, name
     FROM ${table}
     WHERE code = ?
     LIMIT 1`,
    [code],
  );
  return rows.length ? rows[0] : null;
}

async function getCatalogRowById(table, id) {
  const rows = await query(
    `SELECT id, code, name
     FROM ${table}
     WHERE id = ?
     LIMIT 1`,
    [id],
  );
  return rows.length ? rows[0] : null;
}

async function getAccessibleOpportunity({ user, opportunityId }) {
  const params = [];
  const ownershipJoin = applyOwnedAccountScope({
    user,
    accountExpression: "o.account_id",
    params,
  });
  params.push(Number(opportunityId));
  const rows = await query(
    `SELECT o.id, o.account_id, o.contact_id, o.name,
            o.seller_user_id,
            su.full_name AS seller_user_name,
            oas.code AS activation_status_code
     FROM opportunities o
     ${ownershipJoin}
     LEFT JOIN users su ON su.id = o.seller_user_id
     INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
     WHERE o.id = ?
     LIMIT 1`,
    params,
  );
  return rows.length ? rows[0] : null;
}

async function getAccessibleQuotationAccount({ user, accountId }) {
  const params = [];
  const ownershipJoin = applyOwnedAccountScope({
    user,
    accountExpression: "a.id",
    params,
  });
  params.push(Number(accountId));
  const rows = await query(
    `SELECT a.id, a.name
     FROM accounts a
     ${ownershipJoin}
     INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
     WHERE a.id = ?
       AND aas.code = 'activada'
     LIMIT 1`,
    params,
  );
  return rows.length ? rows[0] : null;
}

async function getAccessibleQuotation({ user, quotationId }) {
  const params = [];
  const ownershipJoin = applyOwnedAccountScope({
    user,
    accountExpression: "o.account_id",
    params,
  });
  params.push(Number(quotationId));
  const rows = await query(
    `SELECT q.id, q.opportunity_id, q.latest_version_id,
            q.activation_status_id,
            q.created_at, q.updated_at,
            q.created_by_user_id, q.updated_by_user_id,
            o.account_id,
            o.name AS opportunity_name,
            oas.code AS opportunity_activation_status_code,
            qas.code AS activation_status_code,
            qas.name AS activation_status_name
     FROM quotations q
     INNER JOIN opportunities o ON o.id = q.opportunity_id
     ${ownershipJoin}
     INNER JOIN quotation_activation_statuses qas ON qas.id = q.activation_status_id
     INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
     WHERE q.id = ?
     LIMIT 1`,
    params,
  );
  return rows.length ? rows[0] : null;
}

async function getAccessibleQuotationVersion({ user, versionId }) {
  const params = [];
  const ownershipJoin = applyOwnedAccountScope({
    user,
    accountExpression: "o.account_id",
    params,
  });
  params.push(Number(versionId));
  const rows = await query(
    `SELECT qv.id, qv.quotation_id, qv.version_number, qv.contact_id,
            qv.proposal_name, qv.quotation_date, qv.introduction,
            qv.status_id, qv.activation_status_id,
          qv.summary_discount_mode, qv.summary_discount_value,
          qv.summary_distribution_mode, qv.summary_vat_mode, qv.summary_vat_pct,
          qv.internal_notes,
            qv.delivery_time, qv.quotation_validity, qv.warranty_term,
            qv.payment_terms, qv.currency_code, qv.exchange_rate, qv.quotation_notes,
            qv.created_at, qv.updated_at,
            qv.created_by_user_id, qv.updated_by_user_id,
            q.latest_version_id, q.opportunity_id,
            o.account_id, o.name AS opportunity_name,
            qs.code AS status_code, qs.name AS status_name,
            qs.ui_key AS status_ui_key,
            qas.code AS activation_status_code, qas.name AS activation_status_name,
            CONCAT(c.first_name, ' ', c.last_name) AS contact_name
     FROM quotation_versions qv
     INNER JOIN quotations q ON q.id = qv.quotation_id
     INNER JOIN opportunities o ON o.id = q.opportunity_id
     ${ownershipJoin}
     INNER JOIN quotation_statuses qs ON qs.id = qv.status_id
     INNER JOIN quotation_activation_statuses qas ON qas.id = qv.activation_status_id
     INNER JOIN contacts c ON c.id = qv.contact_id
     WHERE qv.id = ?
     LIMIT 1`,
    params,
  );
  return rows.length ? rows[0] : null;
}

async function validateQuotationContact({ accountId, contactId }) {
  const rows = await query(
    `SELECT id, account_id
     FROM contacts
     WHERE id = ?
     LIMIT 1`,
    [Number(contactId)],
  );
  if (!rows.length) {
    return { ok: false, message: "Contacto invalido" };
  }
  if (Number(rows[0].account_id) !== Number(accountId)) {
    return {
      ok: false,
      message: "El contacto debe pertenecer a la cuenta de la oportunidad",
    };
  }
  return { ok: true };
}

async function validateProvider(providerId) {
  const rows = await query(
    `SELECT p.id
     FROM providers p
     INNER JOIN provider_activation_statuses pas ON pas.id = p.activation_status_id
     WHERE p.id = ?
       AND pas.code = 'activado'
     LIMIT 1`,
    [Number(providerId)],
  );
  return rows.length > 0;
}

async function getQuotationProductComponents(groupItemIds) {
  if (!groupItemIds.length) return new Map();

  const placeholders = groupItemIds.map(() => "?").join(", ");
  const rows = await query(
    `SELECT c.id, c.grupo_item_id, c.component_item_id, c.quantity, c.sort_order,
            child.provider_id AS component_provider_id,
            child.price_list_id AS component_price_list_id,
            child.code AS component_code,
            child.description AS component_description,
            child.product_type_id AS component_product_type_id,
            child.item_type AS component_item_type,
            child.price AS component_price,
            child.currency_id AS component_currency_id,
            curr.code AS component_currency_code,
            curr.name AS component_currency_name,
            curr.symbol AS component_currency_symbol,
            p.name AS component_provider_name,
            ppl.name AS component_price_list_name
     FROM provider_price_list_item_components c
     INNER JOIN provider_price_list_items child ON child.id = c.component_item_id
     INNER JOIN providers p ON p.id = child.provider_id
     INNER JOIN provider_price_lists ppl ON ppl.id = child.price_list_id
     INNER JOIN currencies curr ON curr.id = child.currency_id
     WHERE c.grupo_item_id IN (${placeholders})
     ORDER BY c.grupo_item_id, c.sort_order, c.id`,
    groupItemIds,
  );

  return rows.reduce((map, row) => {
    const key = Number(row.grupo_item_id);
    if (!map.has(key)) {
      map.set(key, []);
    }

    map.get(key).push({
      id: Number(row.id),
      componentItemId: Number(row.component_item_id),
      quantity: Number(row.quantity),
      sortOrder: Number(row.sort_order),
      providerId: Number(row.component_provider_id),
      providerName: String(row.component_provider_name),
      priceListId: Number(row.component_price_list_id),
      priceListName: String(row.component_price_list_name),
      code: String(row.component_code),
      description: row.component_description,
      itemType: String(row.component_item_type),
      productTypeId: Number(row.component_product_type_id),
      price: Number(row.component_price),
      currencyId: Number(row.component_currency_id),
      currencyCode: String(row.component_currency_code),
      currencyName: String(row.component_currency_name),
      currencySymbol: String(row.component_currency_symbol),
    });
    return map;
  }, new Map());
}

async function validateInclusionType(inclusionTypeId) {
  const rows = await query(
    `SELECT id
     FROM quotation_section_inclusion_types
     WHERE id = ?
       AND is_active = 1
     LIMIT 1`,
    [Number(inclusionTypeId)],
  );
  return rows.length > 0;
}

async function getQuotationVersionSections(versionId) {
  const sections = await query(
    `SELECT qs.id, qs.quotation_version_id, qs.title,
            qs.inclusion_type_id, qsit.code AS inclusion_code, qsit.name AS inclusion_name,
            qs.activation_status_id, qas.code AS activation_status_code, qas.name AS activation_status_name,
            qs.display_order
     FROM quotation_sections qs
     INNER JOIN quotation_section_inclusion_types qsit ON qsit.id = qs.inclusion_type_id
     INNER JOIN quotation_activation_statuses qas ON qas.id = qs.activation_status_id
     WHERE qs.quotation_version_id = ?
     ORDER BY qs.display_order, qs.id`,
    [Number(versionId)],
  );

  const sectionIds = sections.map((section) => Number(section.id));
  let itemsBySectionId = new Map();
  if (sectionIds.length) {
    const placeholders = sectionIds.map(() => "?").join(", ");
    const items = await query(
      `SELECT qsi.id, qsi.quotation_section_id, qsi.provider_id,
              p.name AS provider_name,
              qsi.product_code, qsi.product_description, qsi.item_type,
              qsi.bundle_parent_item_id, qsi.bundle_origin_type,
              qsi.source_provider_price_list_item_id,
              qsi.source_component_price_list_item_id,
              qsi.quantity, qsi.list_price_unit,
              qsi.manufacturer_discount_pct, qsi.import_cost_pct,
              qsi.profit_margin_pct, qsi.final_discount_pct,
              qsi.display_order, qsi.bundle_sort_order
       FROM quotation_section_items qsi
       INNER JOIN providers p ON p.id = qsi.provider_id
       WHERE qsi.quotation_section_id IN (${placeholders})
       ORDER BY qsi.display_order, qsi.id`,
      sectionIds,
    );
    itemsBySectionId = items.reduce((map, item) => {
      const key = Number(item.quotation_section_id);
      const existing = map.get(key) || [];
      existing.push({
        id: Number(item.id),
        quotationSectionId: key,
        providerId: Number(item.provider_id),
        providerName: item.provider_name,
        productCode: item.product_code,
        productDescription: item.product_description,
        itemType: item.item_type || "producto",
        bundleParentItemId: item.bundle_parent_item_id
          ? Number(item.bundle_parent_item_id)
          : null,
        bundleOriginType: item.bundle_origin_type || null,
        sourceProviderPriceListItemId: item.source_provider_price_list_item_id
          ? Number(item.source_provider_price_list_item_id)
          : null,
        sourceComponentPriceListItemId: item.source_component_price_list_item_id
          ? Number(item.source_component_price_list_item_id)
          : null,
        quantity: Number(item.quantity),
        listPriceUnit: Number(item.list_price_unit),
        manufacturerDiscountPct: Number(item.manufacturer_discount_pct),
        importCostPct: Number(item.import_cost_pct),
        profitMarginPct: Number(item.profit_margin_pct),
        finalDiscountPct: Number(item.final_discount_pct),
        displayOrder: Number(item.display_order),
        bundleSortOrder: item.bundle_sort_order
          ? Number(item.bundle_sort_order)
          : null,
      });
      map.set(key, existing);
      return map;
    }, new Map());
  }

  return sections.map((section) => ({
    id: Number(section.id),
    quotationVersionId: Number(section.quotation_version_id),
    title: section.title,
    inclusionTypeId: Number(section.inclusion_type_id),
    inclusionCode: section.inclusion_code,
    inclusionName: section.inclusion_name,
    activationStatusId: Number(section.activation_status_id),
    activationStatusCode: section.activation_status_code,
    activationStatusName: section.activation_status_name,
    displayOrder: Number(section.display_order),
    items: itemsBySectionId.get(Number(section.id)) || [],
  }));
}

async function getQuotationVersionSummaryRows(quotationId) {
  return query(
    `SELECT qv.id, qv.quotation_id, qv.version_number, qv.contact_id,
            CONCAT(c.first_name, ' ', c.last_name) AS contact_name,
            qv.proposal_name, qv.quotation_date,
            qv.status_id, qs.code AS status_code, qs.name AS status_name,
            qs.ui_key AS status_ui_key,
            qv.activation_status_id,
            qv.summary_discount_mode,
            qv.summary_discount_value,
          qv.summary_distribution_mode,
          qv.summary_vat_mode,
          qv.summary_vat_pct,
            qv.internal_notes,
            qv.delivery_time,
            qv.quotation_validity,
            qv.warranty_term,
            qv.payment_terms,
            qv.currency_code,
            qv.exchange_rate,
            qv.quotation_notes,
            qas.code AS activation_status_code,
            qas.name AS activation_status_name,
            qv.created_at, qv.updated_at,
            qv.created_by_user_id, qv.updated_by_user_id
     FROM quotation_versions qv
     INNER JOIN contacts c ON c.id = qv.contact_id
     INNER JOIN quotation_statuses qs ON qs.id = qv.status_id
     INNER JOIN quotation_activation_statuses qas ON qas.id = qv.activation_status_id
     WHERE qv.quotation_id = ?
     ORDER BY qv.version_number DESC, qv.id DESC`,
    [Number(quotationId)],
  );
}

async function getAllowedQuotationActionCodes({ user, versionRow }) {
  const allActions = await query(
    `SELECT id, code, name
     FROM quotation_actions
     WHERE is_active = 1
     ORDER BY display_order, id`,
  );

  if (hasQuotationAdministration(user)) {
    return allActions.map((action) => String(action.code));
  }

  const permissionCodes = quotationPermissionCodes.filter((permission) =>
    user?.permissionSet?.has(permission),
  );

  if (!permissionCodes.length) return [];

  const permissionPlaceholders = permissionCodes.map(() => "?").join(", ");
  const allowedRows = await query(
    `SELECT DISTINCT qa.code
     FROM quotation_action_permissions qap
     INNER JOIN quotation_actions qa ON qa.id = qap.action_id
     INNER JOIN permissions p ON p.id = qap.permission_id
     WHERE qap.status_id = ?
       AND qap.is_allowed = 1
       AND p.code IN (${permissionPlaceholders})`,
    [Number(versionRow.status_id), ...permissionCodes],
  );

  const allowed = new Set(allowedRows.map((row) => String(row.code)));

  if (permissionCodes.includes("cotizaciones.operacion")) {
    allowed.add("crear_cotizacion");
    if (Number(versionRow.id) === Number(versionRow.latest_version_id)) {
      allowed.add("crear_version");
    }
  }

  if (Number(versionRow.id) !== Number(versionRow.latest_version_id)) {
    Object.keys(quotationActionTransitionMap).forEach((actionCode) =>
      allowed.delete(actionCode),
    );
    allowed.delete("crear_version");
    allowed.delete("modificar");
  }

  return allActions
    .map((action) => String(action.code))
    .filter((code) => allowed.has(code));
}

async function getAllowedQuotationActionsPayload({ user, versionRow }) {
  const allowedCodes = new Set(
    await getAllowedQuotationActionCodes({ user, versionRow }),
  );
  const allActions = await query(
    `SELECT id, code, name
     FROM quotation_actions
     WHERE is_active = 1
     ORDER BY display_order, id`,
  );
  return allActions.map((action) => ({
    id: Number(action.id),
    code: String(action.code),
    name: String(action.name),
    allowed: allowedCodes.has(String(action.code)),
  }));
}

async function canExecuteQuotationAction({ user, versionRow, actionCode }) {
  const allowedCodes = await getAllowedQuotationActionCodes({
    user,
    versionRow,
  });
  return allowedCodes.includes(actionCode);
}

function assertQuotationPermission(req, res) {
  if (!hasAnyQuotationPermission(req.user)) {
    res.status(403).json({ message: "No autorizado" });
    return false;
  }
  return true;
}

router.get(
  "/quotation-accounts",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;

    const params = [];
    const ownershipJoin = applyOwnedAccountScope({
      user: req.user,
      accountExpression: "o.account_id",
      params,
    });

    const rows = await query(
      `SELECT DISTINCT a.id, a.name
       FROM opportunities o
       ${ownershipJoin}
       INNER JOIN accounts a ON a.id = o.account_id
       INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
       INNER JOIN contacts c ON c.id = o.contact_id
       INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
       INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
       WHERE aas.code = 'activada'
         AND cas.code = 'activado'
         AND oas.code = 'activada'
       ORDER BY a.name, a.id`,
      params,
    );

    return res.json(
      rows.map((row) => ({
        id: Number(row.id),
        name: row.name,
      })),
    );
  },
);

router.get(
  "/quotation-accounts/:accountId/opportunities",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;

    const accountId = Number(req.params.accountId);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return res.status(400).json({ message: "Id de cuenta invalido" });
    }

    const account = await getAccessibleQuotationAccount({
      user: req.user,
      accountId,
    });
    if (!account) {
      return res.status(404).json({ message: "Cuenta no encontrada" });
    }

    const rows = await query(
      `SELECT o.id, o.name,
              o.amount_usd,
              o.close_date,
              o.contact_id,
              CONCAT(c.first_name, ' ', c.last_name) AS contact_name,
              o.seller_user_id,
              su.full_name AS seller_user_name,
              oss.name AS sales_stage,
              oas.code AS activation_status_code,
              oas.name AS activation_status_name
       FROM opportunities o
       INNER JOIN contacts c ON c.id = o.contact_id
       INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
       LEFT JOIN users su ON su.id = o.seller_user_id
       INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
       INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
       WHERE o.account_id = ?
         AND cas.code = 'activado'
         AND oas.code = 'activada'
       ORDER BY o.id DESC`,
      [accountId],
    );

    return res.json(
      rows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        accountId,
        contactId: Number(row.contact_id),
        contactName: row.contact_name,
        amountUsd:
          row.amount_usd === null || row.amount_usd === undefined
            ? null
            : Number(row.amount_usd),
        closeDate: formatDateOnly(row.close_date),
        salesStageName: row.sales_stage || "",
        sellerUserId: row.seller_user_id ? Number(row.seller_user_id) : null,
        sellerUserName: row.seller_user_name || "",
        activationStatusCode: row.activation_status_code,
        activationStatusName: row.activation_status_name,
      })),
    );
  },
);

router.get(
  "/quotation-accounts/:accountId/contacts",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;

    const accountId = Number(req.params.accountId);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return res.status(400).json({ message: "Id de cuenta invalido" });
    }

    const account = await getAccessibleQuotationAccount({
      user: req.user,
      accountId,
    });
    if (!account) {
      return res.status(404).json({ message: "Cuenta no encontrada" });
    }

    const rows = await query(
      `SELECT c.id, c.account_id,
              CONCAT(c.first_name, ' ', c.last_name) AS full_name
       FROM contacts c
       INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
       WHERE c.account_id = ?
         AND cas.code = 'activado'
       ORDER BY full_name`,
      [accountId],
    );

    return res.json(
      rows.map((row) => ({
        id: Number(row.id),
        accountId: Number(row.account_id),
        fullName: row.full_name,
      })),
    );
  },
);

router.get(
  "/quotation-opportunities",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;

    const params = [];
    const ownershipJoin = applyOwnedAccountScope({
      user: req.user,
      accountExpression: "o.account_id",
      params,
    });

    const rows = await query(
      `SELECT o.id, o.name,
              a.id AS account_id,
              a.name AS account_name,
              o.contact_id,
              CONCAT(c.first_name, ' ', c.last_name) AS contact_name,
          o.seller_user_id,
          su.full_name AS seller_user_name,
              oas.code AS activation_status_code,
              oas.name AS activation_status_name
       FROM opportunities o
       ${ownershipJoin}
       INNER JOIN accounts a ON a.id = o.account_id
       INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
       INNER JOIN contacts c ON c.id = o.contact_id
       INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
       LEFT JOIN users su ON su.id = o.seller_user_id
       INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
       WHERE aas.code = 'activada'
         AND cas.code = 'activado'
         AND oas.code = 'activada'
       ORDER BY o.id DESC`,
      params,
    );

    return res.json(
      rows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        accountId: Number(row.account_id),
        accountName: row.account_name,
        contactId: Number(row.contact_id),
        contactName: row.contact_name,
        sellerUserId: row.seller_user_id ? Number(row.seller_user_id) : null,
        sellerUserName: row.seller_user_name || "",
        activationStatusCode: row.activation_status_code,
        activationStatusName: row.activation_status_name,
      })),
    );
  },
);

router.get(
  "/quotation-opportunities/:opportunityId/contacts",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;

    const opportunityId = Number(req.params.opportunityId);
    if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }

    const opportunity = await getAccessibleOpportunity({
      user: req.user,
      opportunityId,
    });
    if (!opportunity) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    const rows = await query(
      `SELECT c.id, c.account_id,
              CONCAT(c.first_name, ' ', c.last_name) AS full_name
       FROM contacts c
       INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
       WHERE c.account_id = ?
         AND cas.code = 'activado'
       ORDER BY full_name`,
      [Number(opportunity.account_id)],
    );

    return res.json(
      rows.map((row) => ({
        id: Number(row.id),
        accountId: Number(row.account_id),
        fullName: row.full_name,
      })),
    );
  },
);

router.get(
  "/quotation-products/search",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;

    const searchQuery = String(req.query.q || "").trim();
    const providerId = Number(req.query.providerId || 0);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
    const params = [];
    let whereClause = "";

    if (providerId) {
      whereClause += " AND ppli.provider_id = ?";
      params.push(providerId);
    }

    if (searchQuery) {
      whereClause +=
        " AND (ppli.code LIKE ? OR ppli.description LIKE ? OR p.name LIKE ? OR ppl.name LIKE ?)";
      const likeValue = `%${searchQuery}%`;
      params.push(likeValue, likeValue, likeValue, likeValue);
    }

    const rows = await query(
      `SELECT ppli.id, ppli.provider_id, ppli.price_list_id, ppli.code,
              ppli.description, ppli.item_type, ppli.price, ppli.currency_id,
              curr.code AS currency_code, curr.name AS currency_name,
              curr.symbol AS currency_symbol, p.name AS provider_name,
              ppl.name AS price_list_name
       FROM provider_price_list_items ppli
       INNER JOIN provider_price_list_item_statuses pils ON pils.id = ppli.activation_status_id
       INNER JOIN provider_price_lists ppl ON ppl.id = ppli.price_list_id
       INNER JOIN providers p ON p.id = ppli.provider_id
       INNER JOIN provider_activation_statuses pas ON pas.id = p.activation_status_id
       INNER JOIN currencies curr ON curr.id = ppli.currency_id
       WHERE pas.code = 'activado'
         AND ppl.is_active = 1
         AND pils.code = 'activo'
         AND ppli.item_type IN ('producto', 'servicio_propio', 'grupo_productos')${whereClause}
       ORDER BY ppli.code ASC, ppli.id DESC
       LIMIT ?`,
      [...params, limit],
    );

    const componentMap = await getQuotationProductComponents(
      rows
        .filter((row) => String(row.item_type) === "grupo_productos")
        .map((row) => Number(row.id)),
    );

    return res.json(
      rows.map((row) => ({
        id: Number(row.id),
        providerId: Number(row.provider_id),
        priceListId: Number(row.price_list_id),
        code: row.code || "",
        description: row.description || "",
        itemType: row.item_type || "",
        price:
          row.price === null || row.price === undefined ? 0 : Number(row.price),
        currencyId: Number(row.currency_id),
        currencyCode: row.currency_code || "",
        currencyName: row.currency_name || "",
        currencySymbol: row.currency_symbol || "",
        providerName: row.provider_name || "",
        priceListName: row.price_list_name || "",
        components: componentMap.get(Number(row.id)) || [],
      })),
    );
  },
);

router.get(
  "/quotations",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;

    const params = [];
    const ownershipJoin = applyOwnedAccountScope({
      user: req.user,
      accountExpression: "o.account_id",
      params,
    });

    const rows = await query(
      `SELECT q.id, q.opportunity_id, q.latest_version_id,
              q.activation_status_id,
              qas.code AS activation_status_code,
              qas.name AS activation_status_name,
              q.created_at, q.updated_at,
        a.id AS account_id,
        a.name AS account_name,
        o.name AS opportunity_name,
        o.amount_usd AS opportunity_amount_usd,
        o.close_date AS opportunity_close_date,
        o.seller_user_id,
        su.full_name AS seller_user_name,
        oss.name AS opportunity_sales_stage_name,
              lv.version_number AS latest_version_number,
              qs.code AS latest_status_code,
              qs.name AS latest_status_name,
              qs.ui_key AS latest_status_ui_key,
              lv.proposal_name AS latest_proposal_name,
          lv.quotation_date AS latest_quotation_date,
          ${buildQuotationVersionEffectiveTotalSql()} AS latest_total_sale_amount
       FROM quotations q
       INNER JOIN opportunities o ON o.id = q.opportunity_id
      INNER JOIN accounts a ON a.id = o.account_id
      LEFT JOIN users su ON su.id = o.seller_user_id
       ${ownershipJoin}
      INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
       INNER JOIN quotation_activation_statuses qas ON qas.id = q.activation_status_id
       LEFT JOIN quotation_versions lv ON lv.id = q.latest_version_id
        ${buildQuotationVersionBaseSaleTotalJoin()}
       LEFT JOIN quotation_statuses qs ON qs.id = lv.status_id
       ORDER BY q.id DESC`,
      params,
    );

    return res.json(
      rows.map((row) => ({
        id: Number(row.id),
        opportunityId: Number(row.opportunity_id),
        accountId: Number(row.account_id),
        accountName: row.account_name || null,
        opportunityName: row.opportunity_name || null,
        opportunitySalesStageName: row.opportunity_sales_stage_name || null,
        opportunityAmountUsd:
          row.opportunity_amount_usd === null ||
          row.opportunity_amount_usd === undefined
            ? null
            : Number(row.opportunity_amount_usd),
        opportunityCloseDate: formatDateOnly(row.opportunity_close_date),
        sellerUserId: row.seller_user_id ? Number(row.seller_user_id) : null,
        sellerUserName: row.seller_user_name || "",
        latestVersionId: row.latest_version_id
          ? Number(row.latest_version_id)
          : null,
        latestVersionNumber: row.latest_version_number
          ? Number(row.latest_version_number)
          : null,
        latestStatusCode: row.latest_status_code || null,
        latestStatusName: row.latest_status_name || null,
        latestStatusUiKey: row.latest_status_ui_key || null,
        latestProposalName: row.latest_proposal_name || null,
        latestQuotationDate: row.latest_quotation_date || null,
        latestTotalSaleAmount:
          row.latest_total_sale_amount === null ||
          row.latest_total_sale_amount === undefined
            ? null
            : Number(row.latest_total_sale_amount),
        activationStatusId: Number(row.activation_status_id),
        activationStatusCode: row.activation_status_code,
        activationStatusName: row.activation_status_name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    );
  },
);

router.get(
  "/opportunities/:opportunityId/quotations",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    const opportunityId = Number(req.params.opportunityId);
    if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }

    const opportunity = await getAccessibleOpportunity({
      user: req.user,
      opportunityId,
    });
    if (!opportunity) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }

    const rows = await query(
      `SELECT q.id, q.opportunity_id, q.latest_version_id,
              q.activation_status_id,
              qas.code AS activation_status_code,
              qas.name AS activation_status_name,
              q.created_at, q.updated_at,
        a.id AS account_id,
        a.name AS account_name,
        o.name AS opportunity_name,
        o.amount_usd AS opportunity_amount_usd,
        o.close_date AS opportunity_close_date,
        o.seller_user_id,
        su.full_name AS seller_user_name,
        oss.name AS opportunity_sales_stage_name,
              lv.version_number AS latest_version_number,
              qs.code AS latest_status_code,
              qs.name AS latest_status_name,
              qs.ui_key AS latest_status_ui_key,
              lv.proposal_name AS latest_proposal_name,
          lv.quotation_date AS latest_quotation_date,
          ${buildQuotationVersionEffectiveTotalSql()} AS latest_total_sale_amount
       FROM quotations q
      INNER JOIN opportunities o ON o.id = q.opportunity_id
      INNER JOIN accounts a ON a.id = o.account_id
      LEFT JOIN users su ON su.id = o.seller_user_id
      INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
       INNER JOIN quotation_activation_statuses qas ON qas.id = q.activation_status_id
       LEFT JOIN quotation_versions lv ON lv.id = q.latest_version_id
        ${buildQuotationVersionBaseSaleTotalJoin()}
       LEFT JOIN quotation_statuses qs ON qs.id = lv.status_id
       WHERE q.opportunity_id = ?
       ORDER BY q.id DESC`,
      [opportunityId],
    );

    return res.json(
      rows.map((row) => ({
        id: Number(row.id),
        opportunityId: Number(row.opportunity_id),
        accountId: Number(row.account_id),
        accountName: row.account_name || null,
        opportunityName: row.opportunity_name || null,
        opportunitySalesStageName: row.opportunity_sales_stage_name || null,
        opportunityAmountUsd:
          row.opportunity_amount_usd === null ||
          row.opportunity_amount_usd === undefined
            ? null
            : Number(row.opportunity_amount_usd),
        opportunityCloseDate: formatDateOnly(row.opportunity_close_date),
        sellerUserId: row.seller_user_id ? Number(row.seller_user_id) : null,
        sellerUserName: row.seller_user_name || "",
        latestVersionId: row.latest_version_id
          ? Number(row.latest_version_id)
          : null,
        latestVersionNumber: row.latest_version_number
          ? Number(row.latest_version_number)
          : null,
        latestStatusCode: row.latest_status_code || null,
        latestStatusName: row.latest_status_name || null,
        latestStatusUiKey: row.latest_status_ui_key || null,
        latestProposalName: row.latest_proposal_name || null,
        latestQuotationDate: row.latest_quotation_date || null,
        latestTotalSaleAmount:
          row.latest_total_sale_amount === null ||
          row.latest_total_sale_amount === undefined
            ? null
            : Number(row.latest_total_sale_amount),
        activationStatusId: Number(row.activation_status_id),
        activationStatusCode: row.activation_status_code,
        activationStatusName: row.activation_status_name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    );
  },
);

router.post(
  "/opportunities/:opportunityId/quotations",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    if (
      !req.user?.permissionSet?.has("cotizaciones.operacion") &&
      !req.user?.permissionSet?.has("cotizaciones.administracion")
    ) {
      return res
        .status(403)
        .json({ message: "No autorizado para crear cotizaciones" });
    }

    const opportunityId = Number(req.params.opportunityId);
    if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
      return res.status(400).json({ message: "Id de oportunidad invalido" });
    }

    const parsed = quotationCreateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const opportunity = await getAccessibleOpportunity({
      user: req.user,
      opportunityId,
    });
    if (!opportunity) {
      return res.status(404).json({ message: "Oportunidad no encontrada" });
    }
    if (opportunity.activation_status_code !== "activada") {
      return res.status(400).json({
        message:
          "Solo se puede crear una cotizacion desde una oportunidad activa",
      });
    }
    if (Number(opportunity.account_id) !== Number(parsed.data.accountId)) {
      return res.status(400).json({
        message: "La oportunidad debe pertenecer a la cuenta seleccionada",
      });
    }
    if (
      Number(opportunity.seller_user_id) !== Number(parsed.data.sellerUserId)
    ) {
      return res.status(400).json({
        message: "El vendedor debe coincidir con el asignado a la oportunidad",
      });
    }

    const defaultStatus = await getCatalogRowByCode(
      "quotation_statuses",
      "borrador",
    );
    const defaultActivation = await getCatalogRowByCode(
      "quotation_activation_statuses",
      parsed.data.activationStatusCode || "activada",
    );
    if (!defaultStatus || !defaultActivation) {
      return res
        .status(500)
        .json({ message: "Catalogos de cotizacion incompletos" });
    }

    const contactId = Number(parsed.data.contactId);
    const contactValidation = await validateQuotationContact({
      accountId: opportunity.account_id,
      contactId,
    });
    if (!contactValidation.ok) {
      return res.status(400).json({ message: contactValidation.message });
    }

    const proposalName = String(
      parsed.data.proposalName || opportunity.name,
    ).trim();
    const quotationDate =
      parsed.data.quotationDate || new Date().toISOString().slice(0, 10);
    const introduction = parsed.data.introduction || "";
    const sections = parsed.data.sections || [];
    const defaultSectionActivation = await getCatalogRowByCode(
      "quotation_activation_statuses",
      "activada",
    );
    if (!defaultSectionActivation) {
      return res
        .status(500)
        .json({ message: "Catalogos de cotizacion incompletos" });
    }

    for (const [index, section] of sections.entries()) {
      const isValidInclusion = await validateInclusionType(
        section.inclusionTypeId,
      );
      if (!isValidInclusion) {
        return res.status(400).json({
          message: `Tipo de inclusion invalido en la seccion ${index + 1}`,
        });
      }

      for (const [itemIndex, item] of (section.items || []).entries()) {
        const providerIsValid = await validateProvider(item.providerId);
        if (!providerIsValid) {
          return res.status(400).json({
            message: `Proveedor invalido en la seccion ${index + 1}, item ${itemIndex + 1}`,
          });
        }
      }
    }

    const now = new Date();
    const summaryDiscountMode = parsed.data.summaryDiscountMode || null;
    const summaryDiscountValue =
      parsed.data.summaryDiscountValue == null
        ? null
        : Number(parsed.data.summaryDiscountValue);
    const summaryDistributionMode = parsed.data.summaryDistributionMode || null;
    const summaryVatMode = parsed.data.summaryVatMode || null;
    const summaryVatPct =
      parsed.data.summaryVatPct == null
        ? null
        : Number(parsed.data.summaryVatPct);
    const internalNotes = parsed.data.internalNotes ?? "";
    const deliveryTime = parsed.data.deliveryTime ?? null;
    const quotationValidity = parsed.data.quotationValidity ?? null;
    const warranty = parsed.data.warranty ?? null;
    const paymentTerms = parsed.data.paymentTerms ?? null;
    const currencyCode = parsed.data.currencyCode ?? null;
    const exchangeRate =
      parsed.data.exchangeRate == null
        ? null
        : Number(parsed.data.exchangeRate);
    const quotationNotes = parsed.data.quotationNotes ?? "";

    const result = await withTransaction(async (conn) => {
      const [quotationResult] = await conn.query(
        `INSERT INTO quotations
          (opportunity_id, latest_version_id, activation_status_id, created_at, updated_at, created_by_user_id, updated_by_user_id)
         VALUES (?, NULL, ?, ?, ?, ?, ?)`,
        [
          opportunityId,
          Number(defaultActivation.id),
          now,
          now,
          Number(req.user.id),
          Number(req.user.id),
        ],
      );
      const quotationId = Number(quotationResult.insertId);

      const [versionResult] = await conn.query(
        `INSERT INTO quotation_versions
          (quotation_id, version_number, contact_id, proposal_name, quotation_date, introduction,
           status_id, activation_status_id, summary_discount_mode, summary_discount_value,
           summary_distribution_mode, summary_vat_mode, summary_vat_pct, internal_notes,
           delivery_time, quotation_validity, warranty_term, payment_terms,
           currency_code, exchange_rate, quotation_notes,
           created_at, updated_at, created_by_user_id, updated_by_user_id)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          quotationId,
          contactId,
          proposalName,
          quotationDate,
          introduction,
          Number(defaultStatus.id),
          Number(defaultActivation.id),
          summaryDiscountMode,
          summaryDiscountValue,
          summaryDistributionMode,
          summaryVatMode,
          summaryVatPct,
          internalNotes,
          deliveryTime,
          quotationValidity,
          warranty,
          paymentTerms,
          currencyCode,
          exchangeRate,
          quotationNotes,
          now,
          now,
          Number(req.user.id),
          Number(req.user.id),
        ],
      );
      const versionId = Number(versionResult.insertId);

      await conn.query(
        `UPDATE quotations
         SET latest_version_id = ?, updated_at = ?, updated_by_user_id = ?
         WHERE id = ?`,
        [versionId, now, Number(req.user.id), quotationId],
      );

      for (const [index, section] of sections.entries()) {
        const [sectionResult] = await conn.query(
          `INSERT INTO quotation_sections
            (quotation_version_id, title, inclusion_type_id, activation_status_id,
             display_order, created_at, updated_at, created_by_user_id, updated_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            versionId,
            section.title,
            Number(section.inclusionTypeId),
            Number(defaultSectionActivation.id),
            Number(section.displayOrder || index + 1),
            now,
            now,
            Number(req.user.id),
            Number(req.user.id),
          ],
        );

        const sectionId = Number(sectionResult.insertId);

        const normalizedItems = validateAndNormalizeSectionItemsForCreate(
          section.items || [],
        );
        if (!normalizedItems.ok) {
          throw new Error(normalizedItems.message);
        }

        await insertQuotationSectionItems(conn, {
          sectionId,
          items: normalizedItems.items,
          now,
          userId: req.user.id,
          refField: "clientItemId",
          parentRefField: "bundleParentClientItemId",
        });
      }

      return { quotationId, versionId, sectionCount: sections.length };
    });

    await logAuditEvent({
      req,
      module: "cotizaciones",
      action: "created",
      entityType: "quotation",
      entityId: result.quotationId,
      detail: "Cotizacion creada",
      after: {
        opportunity_id: opportunityId,
        latest_version_id: result.versionId,
        initial_section_count: result.sectionCount,
      },
    });

    return res.status(201).json({
      id: result.quotationId,
      quotationId: result.quotationId,
      latestVersionId: result.versionId,
      message: "Cotizacion creada",
    });
  },
);

router.get(
  "/quotations/:quotationId",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    const quotationId = Number(req.params.quotationId);
    if (!Number.isInteger(quotationId) || quotationId <= 0) {
      return res.status(400).json({ message: "Id de cotizacion invalido" });
    }

    const quotation = await getAccessibleQuotation({
      user: req.user,
      quotationId,
    });
    if (!quotation) {
      return res.status(404).json({ message: "Cotizacion no encontrada" });
    }

    const versions = await getQuotationVersionSummaryRows(quotationId);
    return res.json({
      id: Number(quotation.id),
      opportunityId: Number(quotation.opportunity_id),
      opportunityName: quotation.opportunity_name,
      latestVersionId: quotation.latest_version_id
        ? Number(quotation.latest_version_id)
        : null,
      activationStatusId: Number(quotation.activation_status_id),
      activationStatusCode: quotation.activation_status_code,
      activationStatusName: quotation.activation_status_name,
      createdAt: quotation.created_at,
      updatedAt: quotation.updated_at,
      createdByUserId: Number(quotation.created_by_user_id),
      updatedByUserId: Number(quotation.updated_by_user_id),
      versions: versions.map((version) => ({
        id: Number(version.id),
        versionNumber: Number(version.version_number),
        contactId: Number(version.contact_id),
        contactName: version.contact_name,
        proposalName: version.proposal_name,
        quotationDate: version.quotation_date,
        statusId: Number(version.status_id),
        statusCode: version.status_code,
        statusName: version.status_name,
        statusUiKey: version.status_ui_key || null,
        activationStatusId: Number(version.activation_status_id),
        activationStatusCode: version.activation_status_code,
        activationStatusName: version.activation_status_name,
        summaryDiscountMode: version.summary_discount_mode || null,
        summaryDiscountValue:
          version.summary_discount_value == null
            ? null
            : Number(version.summary_discount_value),
        summaryDistributionMode: version.summary_distribution_mode || null,
        summaryVatMode: version.summary_vat_mode || null,
        summaryVatPct:
          version.summary_vat_pct == null
            ? null
            : Number(version.summary_vat_pct),
        internalNotes: version.internal_notes || "",
        deliveryTime: version.delivery_time || null,
        quotationValidity: version.quotation_validity || null,
        warranty: version.warranty_term || null,
        paymentTerms: version.payment_terms || null,
        currencyCode: version.currency_code || null,
        exchangeRate:
          version.exchange_rate == null ? null : Number(version.exchange_rate),
        quotationNotes: version.quotation_notes || "",
        createdAt: version.created_at,
        updatedAt: version.updated_at,
      })),
    });
  },
);

router.post(
  "/quotations/:quotationId/versions",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    const quotationId = Number(req.params.quotationId);
    if (!Number.isInteger(quotationId) || quotationId <= 0) {
      return res.status(400).json({ message: "Id de cotizacion invalido" });
    }

    const quotation = await getAccessibleQuotation({
      user: req.user,
      quotationId,
    });
    if (!quotation) {
      return res.status(404).json({ message: "Cotizacion no encontrada" });
    }

    const latestVersion = quotation.latest_version_id
      ? await getAccessibleQuotationVersion({
          user: req.user,
          versionId: quotation.latest_version_id,
        })
      : null;

    if (!latestVersion) {
      return res
        .status(400)
        .json({ message: "La cotizacion no tiene version base" });
    }

    const canCreateVersion = await canExecuteQuotationAction({
      user: req.user,
      versionRow: latestVersion,
      actionCode: "crear_version",
    });
    if (!canCreateVersion && !hasQuotationAdministration(req.user)) {
      return res
        .status(403)
        .json({ message: "No autorizado para crear una nueva version" });
    }

    const parsed = versionPayloadSchema.partial().safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const contactId = Number(parsed.data.contactId || latestVersion.contact_id);
    const contactValidation = await validateQuotationContact({
      accountId: latestVersion.account_id,
      contactId,
    });
    if (!contactValidation.ok) {
      return res.status(400).json({ message: contactValidation.message });
    }

    const activationStatus = await getCatalogRowByCode(
      "quotation_activation_statuses",
      parsed.data.activationStatusCode || latestVersion.activation_status_code,
    );
    if (!activationStatus) {
      return res.status(400).json({ message: "Estado de activacion invalido" });
    }

    const now = new Date();
    const sections = await getQuotationVersionSections(latestVersion.id);
    const newVersionNumber = Number(latestVersion.version_number) + 1;

    const result = await withTransaction(async (conn) => {
      const [versionResult] = await conn.query(
        `INSERT INTO quotation_versions
          (quotation_id, version_number, contact_id, proposal_name, quotation_date, introduction,
           status_id, activation_status_id, summary_discount_mode, summary_discount_value,
           summary_distribution_mode, summary_vat_mode, summary_vat_pct, internal_notes,
           delivery_time, quotation_validity, warranty_term, payment_terms,
           currency_code, exchange_rate, quotation_notes,
           created_at, updated_at, created_by_user_id, updated_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          quotationId,
          newVersionNumber,
          contactId,
          parsed.data.proposalName || latestVersion.proposal_name,
          parsed.data.quotationDate || latestVersion.quotation_date,
          parsed.data.introduction ?? latestVersion.introduction ?? "",
          Number(
            await getCatalogIdFromConn(conn, "quotation_statuses", "borrador"),
          ),
          Number(activationStatus.id),
          parsed.data.summaryDiscountMode ??
            latestVersion.summary_discount_mode ??
            null,
          parsed.data.summaryDiscountValue == null
            ? latestVersion.summary_discount_value == null
              ? null
              : Number(latestVersion.summary_discount_value)
            : Number(parsed.data.summaryDiscountValue),
          parsed.data.summaryDistributionMode ??
            latestVersion.summary_distribution_mode ??
            null,
          parsed.data.summaryVatMode ?? latestVersion.summary_vat_mode ?? null,
          parsed.data.summaryVatPct == null
            ? latestVersion.summary_vat_pct == null
              ? null
              : Number(latestVersion.summary_vat_pct)
            : Number(parsed.data.summaryVatPct),
          parsed.data.internalNotes ?? latestVersion.internal_notes ?? "",
          parsed.data.deliveryTime ?? latestVersion.delivery_time ?? null,
          parsed.data.quotationValidity ??
            latestVersion.quotation_validity ??
            null,
          parsed.data.warranty ?? latestVersion.warranty_term ?? null,
          parsed.data.paymentTerms ?? latestVersion.payment_terms ?? null,
          parsed.data.currencyCode ?? latestVersion.currency_code ?? null,
          parsed.data.exchangeRate == null
            ? latestVersion.exchange_rate == null
              ? null
              : Number(latestVersion.exchange_rate)
            : Number(parsed.data.exchangeRate),
          parsed.data.quotationNotes ?? latestVersion.quotation_notes ?? "",
          now,
          now,
          Number(req.user.id),
          Number(req.user.id),
        ],
      );
      const newVersionId = Number(versionResult.insertId);

      for (const section of sections) {
        const [sectionResult] = await conn.query(
          `INSERT INTO quotation_sections
            (quotation_version_id, title, inclusion_type_id, activation_status_id, display_order,
             created_at, updated_at, created_by_user_id, updated_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newVersionId,
            section.title,
            section.inclusionTypeId,
            section.activationStatusId,
            section.displayOrder,
            now,
            now,
            Number(req.user.id),
            Number(req.user.id),
          ],
        );
        const newSectionId = Number(sectionResult.insertId);
        await insertQuotationSectionItems(conn, {
          sectionId: newSectionId,
          items: section.items,
          now,
          userId: req.user.id,
          refField: "id",
          parentRefField: "bundleParentItemId",
        });
      }

      await conn.query(
        `UPDATE quotations
         SET latest_version_id = ?, updated_at = ?, updated_by_user_id = ?
         WHERE id = ?`,
        [newVersionId, now, Number(req.user.id), quotationId],
      );

      return newVersionId;
    });

    await logAuditEvent({
      req,
      module: "cotizaciones",
      action: "version_created",
      entityType: "quotation",
      entityId: quotationId,
      detail: "Nueva version de cotizacion creada",
      after: { latest_version_id: result },
    });

    return res.status(201).json({
      id: result,
      quotationId,
      message: "Version creada",
    });
  },
);

router.get(
  "/quotation-versions/:versionId",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    const versionId = Number(req.params.versionId);
    if (!Number.isInteger(versionId) || versionId <= 0) {
      return res.status(400).json({ message: "Id de version invalido" });
    }

    const version = await getAccessibleQuotationVersion({
      user: req.user,
      versionId,
    });
    if (!version) {
      return res.status(404).json({ message: "Version no encontrada" });
    }

    const sections = await getQuotationVersionSections(versionId);
    const actions = await getAllowedQuotationActionsPayload({
      user: req.user,
      versionRow: version,
    });

    return res.json({
      id: Number(version.id),
      quotationId: Number(version.quotation_id),
      opportunityId: Number(version.opportunity_id),
      latestVersionId: version.latest_version_id
        ? Number(version.latest_version_id)
        : null,
      versionNumber: Number(version.version_number),
      contactId: Number(version.contact_id),
      contactName: version.contact_name,
      proposalName: version.proposal_name,
      quotationDate: version.quotation_date,
      introduction: version.introduction || "",
      statusId: Number(version.status_id),
      statusCode: version.status_code,
      statusName: version.status_name,
      statusUiKey: version.status_ui_key || null,
      activationStatusId: Number(version.activation_status_id),
      activationStatusCode: version.activation_status_code,
      activationStatusName: version.activation_status_name,
      summaryDiscountMode: version.summary_discount_mode || null,
      summaryDiscountValue:
        version.summary_discount_value == null
          ? null
          : Number(version.summary_discount_value),
      summaryDistributionMode: version.summary_distribution_mode || null,
      summaryVatMode: version.summary_vat_mode || null,
      summaryVatPct:
        version.summary_vat_pct == null
          ? null
          : Number(version.summary_vat_pct),
      internalNotes: version.internal_notes || "",
      deliveryTime: version.delivery_time || null,
      quotationValidity: version.quotation_validity || null,
      warranty: version.warranty_term || null,
      paymentTerms: version.payment_terms || null,
      currencyCode: version.currency_code || null,
      exchangeRate:
        version.exchange_rate == null ? null : Number(version.exchange_rate),
      quotationNotes: version.quotation_notes || "",
      createdAt: version.created_at,
      updatedAt: version.updated_at,
      createdByUserId: Number(version.created_by_user_id),
      updatedByUserId: Number(version.updated_by_user_id),
      sections,
      actions,
      isLatestVersion: Number(version.id) === Number(version.latest_version_id),
    });
  },
);

router.put(
  "/quotation-versions/:versionId",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    const versionId = Number(req.params.versionId);
    if (!Number.isInteger(versionId) || versionId <= 0) {
      return res.status(400).json({ message: "Id de version invalido" });
    }
    const parsed = versionUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const version = await getAccessibleQuotationVersion({
      user: req.user,
      versionId,
    });
    if (!version) {
      return res.status(404).json({ message: "Version no encontrada" });
    }

    const canModify = await canExecuteQuotationAction({
      user: req.user,
      versionRow: version,
      actionCode: "modificar",
    });
    if (!canModify && !hasQuotationAdministration(req.user)) {
      return res
        .status(403)
        .json({ message: "No autorizado para modificar la version" });
    }

    const nextContactId = Number(parsed.data.contactId || version.contact_id);
    const contactValidation = await validateQuotationContact({
      accountId: version.account_id,
      contactId: nextContactId,
    });
    if (!contactValidation.ok) {
      return res.status(400).json({ message: contactValidation.message });
    }

    const activationStatus = await getCatalogRowByCode(
      "quotation_activation_statuses",
      parsed.data.activationStatusCode || version.activation_status_code,
    );
    if (!activationStatus) {
      return res.status(400).json({ message: "Estado de activacion invalido" });
    }

    const now = new Date();
    await query(
      `UPDATE quotation_versions
       SET contact_id = ?, proposal_name = ?, quotation_date = ?, introduction = ?,
           activation_status_id = ?, summary_discount_mode = ?, summary_discount_value = ?,
           summary_distribution_mode = ?, summary_vat_mode = ?, summary_vat_pct = ?, internal_notes = ?,
           delivery_time = ?, quotation_validity = ?, warranty_term = ?, payment_terms = ?,
           currency_code = ?, exchange_rate = ?, quotation_notes = ?,
           updated_at = ?, updated_by_user_id = ?
       WHERE id = ?`,
      [
        nextContactId,
        parsed.data.proposalName || version.proposal_name,
        parsed.data.quotationDate || version.quotation_date,
        parsed.data.introduction ?? version.introduction ?? "",
        Number(activationStatus.id),
        parsed.data.summaryDiscountMode ??
          version.summary_discount_mode ??
          null,
        parsed.data.summaryDiscountValue == null
          ? version.summary_discount_value == null
            ? null
            : Number(version.summary_discount_value)
          : Number(parsed.data.summaryDiscountValue),
        parsed.data.summaryDistributionMode ??
          version.summary_distribution_mode ??
          null,
        parsed.data.summaryVatMode ?? version.summary_vat_mode ?? null,
        parsed.data.summaryVatPct == null
          ? version.summary_vat_pct == null
            ? null
            : Number(version.summary_vat_pct)
          : Number(parsed.data.summaryVatPct),
        parsed.data.internalNotes ?? version.internal_notes ?? "",
        parsed.data.deliveryTime ?? version.delivery_time ?? null,
        parsed.data.quotationValidity ?? version.quotation_validity ?? null,
        parsed.data.warranty ?? version.warranty_term ?? null,
        parsed.data.paymentTerms ?? version.payment_terms ?? null,
        parsed.data.currencyCode ?? version.currency_code ?? null,
        parsed.data.exchangeRate == null
          ? version.exchange_rate == null
            ? null
            : Number(version.exchange_rate)
          : Number(parsed.data.exchangeRate),
        parsed.data.quotationNotes ?? version.quotation_notes ?? "",
        now,
        Number(req.user.id),
        versionId,
      ],
    );

    if (Number(version.id) === Number(version.latest_version_id)) {
      await query(
        `UPDATE quotations
         SET updated_at = ?, updated_by_user_id = ?
         WHERE id = ?`,
        [now, Number(req.user.id), Number(version.quotation_id)],
      );
    }

    await logAuditEvent({
      req,
      module: "cotizaciones",
      action: "version_updated",
      entityType: "quotation_version",
      entityId: versionId,
      detail: "Version de cotizacion actualizada",
      before: {
        contact_id: version.contact_id,
        proposal_name: version.proposal_name,
        quotation_date: version.quotation_date,
        introduction: version.introduction,
        activation_status_id: version.activation_status_id,
      },
      after: {
        contact_id: nextContactId,
        proposal_name: parsed.data.proposalName || version.proposal_name,
        quotation_date: parsed.data.quotationDate || version.quotation_date,
        introduction: parsed.data.introduction ?? version.introduction ?? "",
        activation_status_id: Number(activationStatus.id),
      },
    });

    return res.json({ message: "Version actualizada" });
  },
);

router.put(
  "/quotation-versions/:versionId/full",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    const versionId = Number(req.params.versionId);
    if (!Number.isInteger(versionId) || versionId <= 0) {
      return res.status(400).json({ message: "Id de version invalido" });
    }

    const parsed = versionFullSaveSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const version = await getAccessibleQuotationVersion({
      user: req.user,
      versionId,
    });
    if (!version) {
      return res.status(404).json({ message: "Version no encontrada" });
    }

    const canModify = await canExecuteQuotationAction({
      user: req.user,
      versionRow: version,
      actionCode: "modificar",
    });
    if (!canModify && !hasQuotationAdministration(req.user)) {
      return res
        .status(403)
        .json({ message: "No autorizado para modificar la version" });
    }

    const nextContactId = Number(parsed.data.contactId || version.contact_id);
    const contactValidation = await validateQuotationContact({
      accountId: version.account_id,
      contactId: nextContactId,
    });
    if (!contactValidation.ok) {
      return res.status(400).json({ message: contactValidation.message });
    }

    const activationStatus = await getCatalogRowByCode(
      "quotation_activation_statuses",
      parsed.data.activationStatusCode || version.activation_status_code,
    );
    if (!activationStatus) {
      return res.status(400).json({ message: "Estado de activacion invalido" });
    }

    const normalizedSections = validateAndNormalizeFullSaveSections(
      parsed.data.sections || [],
    );
    if (!normalizedSections.ok) {
      return res.status(400).json({ message: normalizedSections.message });
    }

    for (const section of normalizedSections.sections) {
      const isValidInclusion = await validateInclusionType(
        section.inclusionTypeId,
      );
      if (!isValidInclusion) {
        return res.status(400).json({ message: "Inclusion invalida" });
      }

      for (const item of section.items) {
        const providerIsValid = await validateProvider(item.providerId);
        if (!providerIsValid) {
          return res.status(400).json({ message: "Proveedor invalido" });
        }
      }
    }

    const currentSections = await getQuotationVersionSections(versionId);
    const currentSectionsById = new Map(
      currentSections.map((section) => [Number(section.id), section]),
    );

    const activeSectionStatus = await getCatalogRowByCode(
      "quotation_activation_statuses",
      "activada",
    );
    if (!activeSectionStatus) {
      return res
        .status(500)
        .json({ message: "Catalogos de cotizacion incompletos" });
    }

    const now = new Date();
    try {
      await withTransaction(async (conn) => {
        await conn.query(
          `UPDATE quotation_versions
         SET contact_id = ?, proposal_name = ?, quotation_date = ?, introduction = ?,
             activation_status_id = ?, summary_discount_mode = ?, summary_discount_value = ?,
             summary_distribution_mode = ?, summary_vat_mode = ?, summary_vat_pct = ?, internal_notes = ?,
             delivery_time = ?, quotation_validity = ?, warranty_term = ?, payment_terms = ?,
             currency_code = ?, exchange_rate = ?, quotation_notes = ?,
             updated_at = ?, updated_by_user_id = ?
         WHERE id = ?`,
          [
            nextContactId,
            parsed.data.proposalName || version.proposal_name,
            parsed.data.quotationDate || version.quotation_date,
            parsed.data.introduction ?? version.introduction ?? "",
            Number(activationStatus.id),
            parsed.data.summaryDiscountMode ??
              version.summary_discount_mode ??
              null,
            parsed.data.summaryDiscountValue == null
              ? version.summary_discount_value == null
                ? null
                : Number(version.summary_discount_value)
              : Number(parsed.data.summaryDiscountValue),
            parsed.data.summaryDistributionMode ??
              version.summary_distribution_mode ??
              null,
            parsed.data.summaryVatMode ?? version.summary_vat_mode ?? null,
            parsed.data.summaryVatPct == null
              ? version.summary_vat_pct == null
                ? null
                : Number(version.summary_vat_pct)
              : Number(parsed.data.summaryVatPct),
            parsed.data.internalNotes ?? version.internal_notes ?? "",
            parsed.data.deliveryTime ?? version.delivery_time ?? null,
            parsed.data.quotationValidity ?? version.quotation_validity ?? null,
            parsed.data.warranty ?? version.warranty_term ?? null,
            parsed.data.paymentTerms ?? version.payment_terms ?? null,
            parsed.data.currencyCode ?? version.currency_code ?? null,
            parsed.data.exchangeRate == null
              ? version.exchange_rate == null
                ? null
                : Number(version.exchange_rate)
              : Number(parsed.data.exchangeRate),
            parsed.data.quotationNotes ?? version.quotation_notes ?? "",
            now,
            Number(req.user.id),
            versionId,
          ],
        );

        const keptSectionIds = new Set();

        for (const [
          sectionIndex,
          section,
        ] of normalizedSections.sections.entries()) {
          let persistedSectionId = null;

          if (section.id) {
            const currentSection = currentSectionsById.get(Number(section.id));
            if (!currentSection) {
              throw new Error(
                `Seccion invalida para la version: ${section.id}`,
              );
            }

            persistedSectionId = Number(section.id);
            await conn.query(
              `UPDATE quotation_sections
             SET title = ?, inclusion_type_id = ?, activation_status_id = ?, display_order = ?,
                 updated_at = ?, updated_by_user_id = ?
             WHERE id = ?`,
              [
                section.title,
                Number(section.inclusionTypeId),
                Number(activeSectionStatus.id),
                Number(section.displayOrder || sectionIndex + 1),
                now,
                Number(req.user.id),
                persistedSectionId,
              ],
            );
          } else {
            const [sectionResult] = await conn.query(
              `INSERT INTO quotation_sections
              (quotation_version_id, title, inclusion_type_id, activation_status_id, display_order,
               created_at, updated_at, created_by_user_id, updated_by_user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                Number(versionId),
                section.title,
                Number(section.inclusionTypeId),
                Number(activeSectionStatus.id),
                Number(section.displayOrder || sectionIndex + 1),
                now,
                now,
                Number(req.user.id),
                Number(req.user.id),
              ],
            );
            persistedSectionId = Number(sectionResult.insertId);
          }

          keptSectionIds.add(persistedSectionId);

          const currentSection = currentSectionsById.get(
            Number(section.id),
          ) || {
            items: [],
          };
          const currentItemsById = new Map(
            (currentSection.items || []).map((item) => [Number(item.id), item]),
          );
          const { keptItemIds } = await upsertQuotationSectionItemsForFullSave(
            conn,
            {
              sectionId: persistedSectionId,
              currentItemsById,
              items: section.items,
              now,
              userId: req.user.id,
            },
          );

          const itemIdsToDelete = (currentSection.items || [])
            .map((item) => Number(item.id))
            .filter((itemId) => !keptItemIds.has(itemId));

          if (itemIdsToDelete.length) {
            const placeholders = itemIdsToDelete.map(() => "?").join(", ");
            await conn.query(
              `UPDATE quotation_section_items
             SET bundle_parent_item_id = NULL
             WHERE quotation_section_id = ?
               AND id IN (${placeholders})`,
              [persistedSectionId, ...itemIdsToDelete],
            );
            await conn.query(
              `DELETE FROM quotation_section_items
             WHERE quotation_section_id = ?
               AND id IN (${placeholders})`,
              [persistedSectionId, ...itemIdsToDelete],
            );
          }
        }

        const sectionIdsToDelete = currentSections
          .map((section) => Number(section.id))
          .filter((sectionId) => !keptSectionIds.has(sectionId));

        for (const sectionIdToDelete of sectionIdsToDelete) {
          await conn.query(
            `DELETE FROM quotation_section_items WHERE quotation_section_id = ?`,
            [sectionIdToDelete],
          );
          await conn.query(`DELETE FROM quotation_sections WHERE id = ?`, [
            sectionIdToDelete,
          ]);
        }

        if (Number(version.id) === Number(version.latest_version_id)) {
          await conn.query(
            `UPDATE quotations
             SET updated_at = ?, updated_by_user_id = ?
             WHERE id = ?`,
            [now, Number(req.user.id), Number(version.quotation_id)],
          );
        }
      });
    } catch (error) {
      const message = String(error?.message || "");
      if (
        message.startsWith("Seccion invalida para la version") ||
        message.startsWith("Item invalido para la seccion") ||
        message.startsWith("No fue posible resolver el bundle padre")
      ) {
        return res.status(400).json({ message });
      }
      throw error;
    }

    await logAuditEvent({
      req,
      module: "cotizaciones",
      action: "version_updated",
      entityType: "quotation_version",
      entityId: versionId,
      detail: "Version de cotizacion actualizada con persistencia completa",
      before: {
        contact_id: version.contact_id,
        proposal_name: version.proposal_name,
        quotation_date: version.quotation_date,
        introduction: version.introduction,
        activation_status_id: version.activation_status_id,
      },
      after: {
        contact_id: nextContactId,
        proposal_name: parsed.data.proposalName || version.proposal_name,
        quotation_date: parsed.data.quotationDate || version.quotation_date,
        introduction: parsed.data.introduction ?? version.introduction ?? "",
        activation_status_id: Number(activationStatus.id),
        section_count: normalizedSections.sections.length,
      },
    });

    const refreshedVersion = await getAccessibleQuotationVersion({
      user: req.user,
      versionId,
    });
    const sections = await getQuotationVersionSections(versionId);
    const actions = await getAllowedQuotationActionsPayload({
      user: req.user,
      versionRow: refreshedVersion,
    });

    return res.json({
      id: Number(refreshedVersion.id),
      quotationId: Number(refreshedVersion.quotation_id),
      versionNumber: Number(refreshedVersion.version_number),
      contactId: Number(refreshedVersion.contact_id),
      contactName: refreshedVersion.contact_name,
      proposalName: refreshedVersion.proposal_name,
      quotationDate: refreshedVersion.quotation_date,
      introduction: refreshedVersion.introduction || "",
      statusId: Number(refreshedVersion.status_id),
      statusCode: refreshedVersion.status_code,
      statusName: refreshedVersion.status_name,
      statusUiKey: refreshedVersion.status_ui_key || null,
      activationStatusId: Number(refreshedVersion.activation_status_id),
      activationStatusCode: refreshedVersion.activation_status_code,
      activationStatusName: refreshedVersion.activation_status_name,
      summaryDiscountMode: refreshedVersion.summary_discount_mode || null,
      summaryDiscountValue:
        refreshedVersion.summary_discount_value == null
          ? null
          : Number(refreshedVersion.summary_discount_value),
      summaryDistributionMode:
        refreshedVersion.summary_distribution_mode || null,
      summaryVatMode: refreshedVersion.summary_vat_mode || null,
      summaryVatPct:
        refreshedVersion.summary_vat_pct == null
          ? null
          : Number(refreshedVersion.summary_vat_pct),
      internalNotes: refreshedVersion.internal_notes || "",
      deliveryTime: refreshedVersion.delivery_time || null,
      quotationValidity: refreshedVersion.quotation_validity || null,
      warranty: refreshedVersion.warranty_term || null,
      paymentTerms: refreshedVersion.payment_terms || null,
      currencyCode: refreshedVersion.currency_code || null,
      exchangeRate:
        refreshedVersion.exchange_rate == null
          ? null
          : Number(refreshedVersion.exchange_rate),
      quotationNotes: refreshedVersion.quotation_notes || "",
      createdAt: refreshedVersion.created_at,
      updatedAt: refreshedVersion.updated_at,
      createdByUserId: Number(refreshedVersion.created_by_user_id),
      updatedByUserId: Number(refreshedVersion.updated_by_user_id),
      sections,
      actions,
      isLatestVersion:
        Number(refreshedVersion.id) ===
        Number(refreshedVersion.latest_version_id),
      message: "Version actualizada",
    });
  },
);

router.post(
  "/quotation-versions/:versionId/transition",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    const versionId = Number(req.params.versionId);
    if (!Number.isInteger(versionId) || versionId <= 0) {
      return res.status(400).json({ message: "Id de version invalido" });
    }

    const parsed = transitionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const version = await getAccessibleQuotationVersion({
      user: req.user,
      versionId,
    });
    if (!version) {
      return res.status(404).json({ message: "Version no encontrada" });
    }
    if (Number(version.id) !== Number(version.latest_version_id)) {
      return res.status(400).json({
        message: "Solo la version mayor puede cambiar de estado",
      });
    }

    const actionCode = parsed.data.actionCode;
    const canExecute = await canExecuteQuotationAction({
      user: req.user,
      versionRow: version,
      actionCode,
    });
    if (!canExecute && !hasQuotationAdministration(req.user)) {
      return res
        .status(403)
        .json({ message: "No autorizado para esta accion" });
    }

    const targetStatusCode = quotationActionTransitionMap[actionCode];
    const targetStatus = await getCatalogRowByCode(
      "quotation_statuses",
      targetStatusCode,
    );
    if (!targetStatus) {
      return res.status(400).json({ message: "Transicion invalida" });
    }

    const now = new Date();
    await query(
      `UPDATE quotation_versions
       SET status_id = ?, updated_at = ?, updated_by_user_id = ?
       WHERE id = ?`,
      [Number(targetStatus.id), now, Number(req.user.id), versionId],
    );
    await query(
      `UPDATE quotations
       SET updated_at = ?, updated_by_user_id = ?
       WHERE id = ?`,
      [now, Number(req.user.id), Number(version.quotation_id)],
    );

    await logAuditEvent({
      req,
      module: "cotizaciones",
      action: actionCode,
      entityType: "quotation_version",
      entityId: versionId,
      detail: `Accion ${actionCode} ejecutada`,
      before: { status_id: version.status_id },
      after: { status_id: Number(targetStatus.id) },
    });

    return res.json({
      message: "Estado actualizado",
      statusCode: targetStatus.code,
      statusName: targetStatus.name,
    });
  },
);

router.get(
  "/quotation-versions/:versionId/actions",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    const versionId = Number(req.params.versionId);
    if (!Number.isInteger(versionId) || versionId <= 0) {
      return res.status(400).json({ message: "Id de version invalido" });
    }

    const version = await getAccessibleQuotationVersion({
      user: req.user,
      versionId,
    });
    if (!version) {
      return res.status(404).json({ message: "Version no encontrada" });
    }

    const actions = await getAllowedQuotationActionsPayload({
      user: req.user,
      versionRow: version,
    });
    return res.json({
      versionId,
      latestVersionId: version.latest_version_id
        ? Number(version.latest_version_id)
        : null,
      actions,
    });
  },
);

async function getCatalogIdFromConn(conn, table, code) {
  const [rows] = await conn.query(
    `SELECT id
     FROM ${table}
     WHERE code = ?
     LIMIT 1`,
    [code],
  );
  return rows.length ? Number(rows[0].id) : null;
}

export default router;
