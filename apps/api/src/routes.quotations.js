import express from "express";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { query, withTransaction } from "./db.js";
import { getUserAuthContext, requireAnyPermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import { buildProposalPdfBuffer } from "./proposalPdf.js";
import { buildQuotationPdfBuffer } from "./quotationPdf.js";
import {
  cloneProposalComponents,
  getProposalContentConfiguration,
  getCompanyDocumentBranding,
  listInstitutionalAssets,
  listProposalComponents,
  PROPOSAL_CONTENT_COMPONENT_DEFINITIONS,
  replaceProposalComponentImage,
  saveProposalComponentBlocks,
  summarizeProposalComponents,
} from "./settings.js";
import { config } from "./config.js";
import {
  ensureProductTypesCatalog,
  getProductTypeByCode,
  getProductTypeIdByCode,
} from "./productTypes.js";
import {
  cleanupTempFiles,
  getDocumentContentStream,
  listOpportunityDocuments,
  parseMultipartFiles,
} from "./opportunity-documents/service.js";
import { createDocumentStorage } from "./opportunity-documents/storage.js";
import {
  getCommercialEnablementCatalogs,
  listCommercialEnablementAssets,
} from "./commercial-enablement/service.js";

const router = express.Router();
const documentStorage = createDocumentStorage();

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

const quotationPdfRowSchema = z.object({
  displayOrder: z.number().int().nonnegative().optional().nullable(),
  productCode: z.string().trim().max(120).optional().nullable(),
  productDescription: z.string().trim().max(5000).optional().nullable(),
  quantity: z.number().nonnegative().optional().nullable(),
  quantityDisplay: z.string().trim().max(120).optional().nullable(),
  salePriceUnit: z.number().nonnegative().optional().nullable(),
  salePriceTotal: z.number().nonnegative().optional().nullable(),
});

const quotationPdfSectionSchema = z.object({
  title: z.string().trim().min(1).max(180),
  subtotal: z.number().nonnegative().optional().default(0),
  rows: z.array(quotationPdfRowSchema).optional().default([]),
});

const quotationPdfRenderSchema = z.object({
  header: z.object({
    quotationNumber: z.string().trim().max(80).optional().default(""),
    versionNumber: z.string().trim().max(80).optional().default(""),
    quotationDate: z.string().trim().max(120).optional().default(""),
    proposalName: z.string().trim().max(180).optional().default(""),
    accountName: z.string().trim().max(180).optional().default(""),
    contactName: z.string().trim().max(180).optional().default(""),
    contactEmail: z.string().trim().max(180).optional().default(""),
    contactPhone: z.string().trim().max(80).optional().default(""),
    sellerName: z.string().trim().max(180).optional().default(""),
    sellerEmail: z.string().trim().max(180).optional().default(""),
    sellerPhone: z.string().trim().max(80).optional().default(""),
  }),
  introduction: z.string().trim().max(50000).optional().default(""),
  sections: z.array(quotationPdfSectionSchema).optional().default([]),
  summary: z.object({
    subtotal: z.number().nonnegative().optional().default(0),
    discount: z.number().nonnegative().optional().default(0),
    discountedSubtotal: z.number().nonnegative().optional().default(0),
    vatAmount: z.number().nonnegative().optional().default(0),
    total: z.number().nonnegative().optional().default(0),
    showVat: z.boolean().optional().default(false),
    vatMode: z
      .enum(["without_vat", "total", "per_item"])
      .optional()
      .default("without_vat"),
    currencyCode: z.string().trim().min(1).max(20).optional().default("USD"),
  }),
  commercialTerms: z
    .object({
      deliveryTime: z.string().trim().max(180).optional().default(""),
      quotationValidity: z.string().trim().max(180).optional().default(""),
      warranty: z.string().trim().max(180).optional().default(""),
      paymentTerms: z.string().trim().max(180).optional().default(""),
      currency: z.string().trim().max(120).optional().default(""),
    })
    .optional()
    .default({}),
  notes: z.string().trim().max(50000).optional().default(""),
});

const quotationExchangeRateQuerySchema = z.object({
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/),
});

const proposalStatusCodes = ["active", "archived"];
const proposalStatusInputCodes = ["draft", "ready", ...proposalStatusCodes];

function normalizeProposalStatusCode(value, fallback = "active") {
  const safeValue = String(value || "")
    .trim()
    .toLowerCase();

  if (safeValue === "archived") {
    return "archived";
  }

  if (
    safeValue === "draft" ||
    safeValue === "ready" ||
    safeValue === "active"
  ) {
    return "active";
  }

  return fallback === "archived" ? "archived" : "active";
}

const proposalContentSchema = z.object({
  heroTitle: z.string().trim().max(180).optional().default(""),
  heroSubtitle: z.string().trim().max(5000).optional().default(""),
  executiveSummary: z.string().trim().max(50000).optional().default(""),
  solutionOverview: z.string().trim().max(50000).optional().default(""),
  valueHighlights: z.array(z.string().trim().max(500)).optional().default([]),
  closingMessage: z.string().trim().max(50000).optional().default(""),
});

const proposalTemplateSectionCodes = [
  "hero",
  "highlights",
  "executive_summary",
  "solution_overview",
  "pricing",
  "closing",
];

const proposalTemplateCoverStyles = ["corporate", "premium", "technical"];
const proposalTemplateStatusCodes = ["draft", "active", "archived"];
const proposalTemplateApplyModes = ["preserve_content", "replace_content"];
const PROPOSAL_EXEC_SUMMARY_JOB_COMPONENT_CODE = "executive_summary";
const PROPOSAL_EXEC_SUMMARY_JOB_TYPE = "generate_parallel_suggestion";
const PROPOSAL_EXEC_SUMMARY_JOB_POLL_INTERVAL_MS = 3000;
const PROPOSAL_EXEC_SUMMARY_JOB_LEASE_SECONDS = 150;
const PROPOSAL_EXEC_SUMMARY_JOB_RESULT_TTL_MINUTES = 180;
const PROPOSAL_EXEC_SUMMARY_MAX_LIBRARY_ASSETS = 4;
const PROPOSAL_EXEC_SUMMARY_MAX_ANSWERS = 16;
const PROPOSAL_EXEC_SUMMARY_MAX_DOCUMENTS = 4;
const PROPOSAL_EXEC_SUMMARY_MAX_DOCUMENT_TEXT_CHARS = 1500;
const PROPOSAL_EXEC_SUMMARY_MAX_LIBRARY_SUMMARY_CHARS = 500;
const PROPOSAL_EXEC_SUMMARY_MAX_SECTION_ITEMS = 8;
const PROPOSAL_EXEC_SUMMARY_OPENAI_TIMEOUT_MS = 120000;

const proposalTemplateThemeSchema = z
  .object({
    accentColor: z.string().trim().max(32).optional().default(""),
    surfaceTint: z.string().trim().max(32).optional().default(""),
    textColor: z.string().trim().max(32).optional().default(""),
  })
  .optional()
  .default({});

const proposalTemplateSnapshotSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(180),
  description: z.string().trim().max(5000).optional().default(""),
  previewTitle: z.string().trim().max(180).optional().default(""),
  coverStyle: z
    .enum(proposalTemplateCoverStyles)
    .optional()
    .default("corporate"),
  themeTokens: proposalTemplateThemeSchema,
  contentDefaults: proposalContentSchema.optional().default({}),
  sectionSchema: z
    .array(z.enum(proposalTemplateSectionCodes))
    .optional()
    .default(proposalTemplateSectionCodes),
  highlightPresets: z.array(z.string().trim().max(500)).optional().default([]),
  placeholderRules: z.array(z.string().trim().max(80)).optional().default([]),
});

const proposalCreateSchema = z.object({
  sourceProposalId: z.number().int().positive().optional().nullable(),
  templateId: z.number().int().positive().optional().nullable(),
});

const proposalUpdateSchema = z.object({
  title: z.string().trim().min(2).max(180).optional(),
  statusCode: z.enum(proposalStatusInputCodes).optional(),
  content: proposalContentSchema.optional(),
});

const proposalPdfImageSchema = z.object({
  fileUrl: z.string().trim().min(1).max(10_000_000),
  altText: z.string().trim().max(500).optional().default(""),
  caption: z.string().trim().max(5000).optional().default(""),
  fileName: z.string().trim().max(255).optional().default(""),
});

const proposalPdfBlockSchema = z
  .object({
    type: z.enum(["heading", "paragraph", "list", "image"]),
    text: z.string().trim().max(50_000).optional().default(""),
    items: z.array(z.string().trim().max(1000)).optional().default([]),
    image: proposalPdfImageSchema.optional().nullable(),
  })
  .superRefine((value, context) => {
    if (
      (value.type === "heading" || value.type === "paragraph") &&
      !value.text
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "El bloque requiere texto",
        path: ["text"],
      });
    }

    if (value.type === "list" && value.items.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La lista requiere al menos un item",
        path: ["items"],
      });
    }

    if (value.type === "image" && !value.image?.fileUrl) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La imagen requiere fileUrl",
        path: ["image", "fileUrl"],
      });
    }
  });

const proposalPdfLayoutModeSchema = z.enum([
  "stack",
  "horizontal-gallery",
  "manual-rows",
]);

const proposalPdfLayoutRowSchema = z.object({
  blockIndexes: z.array(z.number().int().min(0)).optional().default([]),
});

const proposalPdfLayoutConfigSchema = z
  .object({
    mode: proposalPdfLayoutModeSchema,
    rows: z.array(proposalPdfLayoutRowSchema).optional(),
  })
  .nullable();

const proposalPdfSectionSchema = z.object({
  title: z.string().trim().min(1).max(180),
  subtitle: z.string().trim().max(180).optional().default(""),
  layout: proposalPdfLayoutModeSchema.optional().default("stack"),
  layoutConfig: proposalPdfLayoutConfigSchema.optional().default(null),
  blocks: z.array(proposalPdfBlockSchema).optional().default([]),
});

const proposalPdfPricingItemSchema = z.object({
  productCode: z.string().trim().max(120).optional().default(""),
  productDescription: z.string().trim().max(5000).optional().default(""),
  quantity: z.number().nonnegative().optional().default(0),
  salePriceTotal: z.number().nonnegative().optional().default(0),
});

const proposalPdfPricingSectionSchema = z.object({
  title: z.string().trim().min(1).max(180),
  items: z.array(proposalPdfPricingItemSchema).optional().default([]),
});

const proposalPdfRenderSchema = z.object({
  header: z.object({
    proposalTitle: z.string().trim().max(180).optional().default(""),
    accountName: z.string().trim().max(180).optional().default(""),
    contactName: z.string().trim().max(180).optional().default(""),
    quotationNumber: z.string().trim().max(80).optional().default(""),
    quotationVersionNumber: z.string().trim().max(80).optional().default(""),
    updatedAtLabel: z.string().trim().max(120).optional().default(""),
    statusLabel: z.string().trim().max(120).optional().default(""),
    templateName: z.string().trim().max(180).optional().default(""),
  }),
  theme: z
    .object({
      coverStyle: z
        .enum(proposalTemplateCoverStyles)
        .optional()
        .default("corporate"),
    })
    .optional()
    .default({}),
  sections: z.array(proposalPdfSectionSchema).optional().default([]),
  pricing: z.object({
    summary: z.object({
      subtotal: z.number().nonnegative().optional().default(0),
      total: z.number().nonnegative().optional().default(0),
      currencyCode: z.string().trim().min(1).max(20).optional().default("USD"),
    }),
    sections: z.array(proposalPdfPricingSectionSchema).optional().default([]),
  }),
  quotationAttachmentRef: z.object({
    quotationVersionId: z.number().int().positive(),
  }),
});

const proposalTemplateApplySchema = z.object({
  templateId: z.number().int().positive(),
  mode: z.enum(proposalTemplateApplyModes),
});

const proposalRebaseSchema = z.object({
  quotationVersionId: z.number().int().positive(),
});

const proposalComponentBlockSchema = z
  .object({
    id: z.number().int().positive().optional(),
    type: z.enum(["heading", "paragraph", "list", "image"]),
    text: z.string().optional().default(""),
    items: z.array(z.string().trim().max(1000)).optional().default([]),
    assetId: z.number().int().positive().optional().nullable(),
    assetVersionId: z.number().int().positive().optional().nullable(),
  })
  .superRefine((value, context) => {
    if (value.type === "image") {
      if (!value.assetId || !value.assetVersionId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Los bloques de imagen requieren assetId y assetVersionId",
          path: ["assetVersionId"],
        });
      }
    }
  });

const proposalComponentUpdateSchema = z.object({
  title: z.string().trim().min(2).max(190).optional(),
  blocks: z.array(proposalComponentBlockSchema).default([]),
});

const proposalReplaceImageSchema = z.object({
  blockId: z.number().int().positive(),
  assetId: z.number().int().positive(),
  assetVersionId: z.number().int().positive(),
});

const proposalExecutiveSummaryGenerationSchema = z.object({
  mode: z
    .enum([PROPOSAL_EXEC_SUMMARY_JOB_TYPE])
    .optional()
    .default(PROPOSAL_EXEC_SUMMARY_JOB_TYPE),
  languageCode: z.string().trim().max(10).optional().default("es"),
  instructions: z.string().trim().max(1000).optional().default(""),
  maxLibraryAssets: z.number().int().positive().max(4).optional().default(4),
});

const quotationProductListsQuerySchema = z.object({
  providerId: z.coerce.number().int().positive(),
});

const quotationQuickCreateProductSchema = z.object({
  providerId: z.number().int().positive(),
  priceListId: z.number().int().positive(),
  code: z.string().trim().min(1).max(80),
  description: z.string().trim().max(10000).optional().default(""),
  price: z.number().nonnegative(),
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
  originalCurrencyCode: z.string().trim().length(3).optional().nullable(),
  originalListPriceUnit: z.number().nonnegative().optional().nullable(),
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
let ensureQuotationVersionDocumentsSchemaPromise;
let ensureProposalSchemaPromise;

const defaultProposalTemplateSeedRows = [
  {
    code: "corporate_core",
    name: "Corporativa sobria",
    status: "active",
    scope: "global",
    description:
      "Presentacion limpia y formal para propuestas comerciales generales.",
    previewTitle: "Corporate",
    coverStyle: "corporate",
    themeTokens: {
      accentColor: "#173259",
      surfaceTint: "#eef6ff",
      textColor: "#0f2540",
    },
    contentDefaults: {
      heroTitle: "{{proposalName}}",
      heroSubtitle:
        "Presentacion comercial para {{contactName}} en {{accountName}}, basada en la cotizacion aprobada {{quotationNumber}} v{{versionNumber}}.",
      executiveSummary:
        "Compartimos una propuesta estructurada para {{opportunityName}}, alineada al alcance aprobado y al contexto comercial actual.",
      solutionOverview:
        "La propuesta organiza la cotizacion en una narrativa ejecutiva, clara y accionable para facilitar su revision.",
      valueHighlights: [
        "Contexto comercial ya alineado con {{accountName}}",
        "Base economica heredada de la cotizacion aprobada",
        "Presentacion lista para revision con {{contactName}}",
      ],
      closingMessage:
        "Quedamos atentos para revisar esta propuesta con {{contactName}} y acordar los siguientes pasos.",
    },
    sectionSchema: proposalTemplateSectionCodes,
    highlightPresets: [
      "Narrativa comercial mas clara",
      "Pricing heredado sin retrabajo",
      "Formato listo para presentar",
    ],
    placeholderRules: [
      "accountName",
      "contactName",
      "opportunityName",
      "proposalName",
      "quotationNumber",
      "versionNumber",
      "currencyCode",
      "subtotal",
      "total",
    ],
    isDefault: 1,
  },
  {
    code: "executive_premium",
    name: "Ejecutiva premium",
    status: "active",
    scope: "global",
    description:
      "Portada mas editorial para comites, direccion o audiencias ejecutivas.",
    previewTitle: "Executive",
    coverStyle: "premium",
    themeTokens: {
      accentColor: "#7a4d16",
      surfaceTint: "#fff7ea",
      textColor: "#2f2418",
    },
    contentDefaults: {
      heroTitle: "{{proposalName}}",
      heroSubtitle:
        "Una propuesta ejecutiva para {{accountName}} con base en la cotizacion aprobada {{quotationNumber}} v{{versionNumber}}.",
      executiveSummary:
        "Resumimos la iniciativa {{opportunityName}} en una pieza mas cuidada para su presentacion y toma de decision.",
      solutionOverview:
        "El alcance se presenta con mejor jerarquia visual, foco en valor y continuidad con la base economica ya aprobada.",
      valueHighlights: [
        "Lectura mas ejecutiva para {{accountName}}",
        "Total heredado: {{total}}",
        "Version aprobada: {{quotationNumber}} v{{versionNumber}}",
      ],
      closingMessage:
        "Estamos listos para presentar esta propuesta, resolver preguntas y acordar el siguiente paso comercial.",
    },
    sectionSchema: proposalTemplateSectionCodes,
    highlightPresets: [
      "Enfoque ejecutivo",
      "Narrativa premium",
      "Cierre mas claro",
    ],
    placeholderRules: [
      "accountName",
      "contactName",
      "opportunityName",
      "proposalName",
      "quotationNumber",
      "versionNumber",
      "total",
    ],
    isDefault: 0,
  },
  {
    code: "technical_solution",
    name: "Solucion tecnica",
    status: "active",
    scope: "global",
    description:
      "Mas enfasis en alcance, frentes de solucion y claridad tecnica.",
    previewTitle: "Technical",
    coverStyle: "technical",
    themeTokens: {
      accentColor: "#13636a",
      surfaceTint: "#edf8f8",
      textColor: "#0d3035",
    },
    contentDefaults: {
      heroTitle: "{{proposalName}}",
      heroSubtitle:
        "Propuesta de solucion para {{opportunityName}} en {{accountName}}, construida desde la cotizacion aprobada.",
      executiveSummary:
        "La propuesta organiza el alcance aprobado para facilitar su revision tecnica y comercial con {{contactName}}.",
      solutionOverview:
        "El documento destaca frentes de solucion, componentes principales y continuidad con la version aprobada {{versionNumber}}.",
      valueHighlights: [
        "Frentes tecnicos visibles desde el inicio",
        "Continuidad con la cotizacion aprobada",
        "Presentacion clara para revision conjunta",
      ],
      closingMessage:
        "Podemos revisar juntos esta propuesta tecnica, resolver supuestos y confirmar el siguiente paso de ejecucion.",
    },
    sectionSchema: proposalTemplateSectionCodes,
    highlightPresets: [
      "Mayor foco en solucion",
      "Aterrizada para revision tecnica",
      "Pricing intacto",
    ],
    placeholderRules: [
      "accountName",
      "contactName",
      "opportunityName",
      "proposalName",
      "versionNumber",
      "subtotal",
      "total",
    ],
    isDefault: 0,
  },
];

async function ensureTableColumn(tableName, columnName, ddl) {
  const rows = await query(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName],
  );

  if (!rows.length) {
    await query(ddl);
  }
}

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

async function ensureQuotationVersionDocumentsSchema() {
  if (!ensureQuotationVersionDocumentsSchemaPromise) {
    ensureQuotationVersionDocumentsSchemaPromise = (async () => {
      await query(
        `CREATE TABLE IF NOT EXISTS quotation_version_documents (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          quotation_version_id BIGINT UNSIGNED NOT NULL,
          document_id BIGINT UNSIGNED NOT NULL,
          created_by_user_id BIGINT UNSIGNED NOT NULL,
          created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          CONSTRAINT uq_qv_documents_version_document UNIQUE (quotation_version_id, document_id),
          CONSTRAINT fk_qv_documents_version FOREIGN KEY (quotation_version_id) REFERENCES quotation_versions(id) ON DELETE CASCADE,
          CONSTRAINT fk_qv_documents_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
          CONSTRAINT fk_qv_documents_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
          INDEX idx_qv_documents_version (quotation_version_id, created_at),
          INDEX idx_qv_documents_document (document_id)
        )`,
      );
    })().catch((error) => {
      ensureQuotationVersionDocumentsSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureQuotationVersionDocumentsSchemaPromise;
}

async function ensureProposalSchema() {
  if (!ensureProposalSchemaPromise) {
    ensureProposalSchemaPromise = (async () => {
      await query(
        `CREATE TABLE IF NOT EXISTS proposal_templates (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          code VARCHAR(80) NOT NULL,
          name VARCHAR(180) NOT NULL,
          status VARCHAR(40) NOT NULL DEFAULT 'draft',
          scope VARCHAR(40) NOT NULL DEFAULT 'global',
          description TEXT NULL,
          preview_title VARCHAR(180) NULL,
          cover_style VARCHAR(40) NOT NULL DEFAULT 'corporate',
          theme_tokens_json LONGTEXT NULL,
          content_defaults_json LONGTEXT NULL,
          section_schema_json LONGTEXT NULL,
          highlight_presets_json LONGTEXT NULL,
          placeholder_rules_json LONGTEXT NULL,
          is_default TINYINT(1) NOT NULL DEFAULT 0,
          created_by_user_id BIGINT UNSIGNED NULL,
          updated_by_user_id BIGINT UNSIGNED NULL,
          created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          archived_at DATETIME(3) NULL,
          CONSTRAINT uq_proposal_templates_code UNIQUE (code),
          INDEX idx_proposal_templates_status (status, is_default, updated_at),
          CONSTRAINT fk_proposal_templates_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
          CONSTRAINT fk_proposal_templates_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
        )`,
      );

      await query(
        `CREATE TABLE IF NOT EXISTS proposals (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          quotation_id BIGINT UNSIGNED NOT NULL,
          quotation_version_id BIGINT UNSIGNED NOT NULL,
          account_id BIGINT UNSIGNED NOT NULL,
          contact_id BIGINT UNSIGNED NOT NULL,
          opportunity_id BIGINT UNSIGNED NOT NULL,
          owner_user_id BIGINT UNSIGNED NOT NULL,
          title VARCHAR(180) NOT NULL,
          status_code VARCHAR(40) NOT NULL DEFAULT 'active',
          content_json LONGTEXT NULL,
          pricing_snapshot_json LONGTEXT NULL,
          created_by_user_id BIGINT UNSIGNED NOT NULL,
          updated_by_user_id BIGINT UNSIGNED NOT NULL,
          created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          archived_at DATETIME(3) NULL,
          CONSTRAINT fk_proposals_quotation FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE,
          CONSTRAINT fk_proposals_quotation_version FOREIGN KEY (quotation_version_id) REFERENCES quotation_versions(id) ON DELETE CASCADE,
          CONSTRAINT fk_proposals_account FOREIGN KEY (account_id) REFERENCES accounts(id),
          CONSTRAINT fk_proposals_contact FOREIGN KEY (contact_id) REFERENCES contacts(id),
          CONSTRAINT fk_proposals_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id),
          CONSTRAINT fk_proposals_owner FOREIGN KEY (owner_user_id) REFERENCES users(id),
          CONSTRAINT fk_proposals_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
          CONSTRAINT fk_proposals_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id),
          INDEX idx_proposals_quotation (quotation_id, created_at),
          INDEX idx_proposals_quotation_version (quotation_version_id),
          INDEX idx_proposals_owner (owner_user_id, updated_at),
          INDEX idx_proposals_status (status_code, updated_at)
        )`,
      );

      await ensureTableColumn(
        "proposals",
        "template_id",
        `ALTER TABLE proposals
         ADD COLUMN template_id BIGINT UNSIGNED NULL
         AFTER owner_user_id`,
      );
      await ensureTableColumn(
        "proposals",
        "template_snapshot_json",
        `ALTER TABLE proposals
         ADD COLUMN template_snapshot_json LONGTEXT NULL
         AFTER pricing_snapshot_json`,
      );

      await query(
        `CREATE TABLE IF NOT EXISTS proposal_revisions (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          proposal_id BIGINT UNSIGNED NOT NULL,
          revision_number INT NOT NULL,
          quotation_version_id BIGINT UNSIGNED NOT NULL,
          title VARCHAR(180) NOT NULL,
          status_code VARCHAR(40) NOT NULL,
          content_json LONGTEXT NULL,
          pricing_snapshot_json LONGTEXT NULL,
          change_type VARCHAR(40) NOT NULL,
          created_by_user_id BIGINT UNSIGNED NOT NULL,
          created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          CONSTRAINT fk_proposal_revisions_proposal FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE,
          CONSTRAINT fk_proposal_revisions_quotation_version FOREIGN KEY (quotation_version_id) REFERENCES quotation_versions(id) ON DELETE CASCADE,
          CONSTRAINT fk_proposal_revisions_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
          CONSTRAINT uq_proposal_revisions_number UNIQUE (proposal_id, revision_number),
          INDEX idx_proposal_revisions_created_at (proposal_id, created_at)
        )`,
      );

      for (const template of defaultProposalTemplateSeedRows) {
        await query(
          `INSERT INTO proposal_templates
            (code, name, status, scope, description, preview_title, cover_style,
             theme_tokens_json, content_defaults_json, section_schema_json,
             highlight_presets_json, placeholder_rules_json, is_default,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             status = VALUES(status),
             scope = VALUES(scope),
             description = VALUES(description),
             preview_title = VALUES(preview_title),
             cover_style = VALUES(cover_style),
             theme_tokens_json = VALUES(theme_tokens_json),
             content_defaults_json = VALUES(content_defaults_json),
             section_schema_json = VALUES(section_schema_json),
             highlight_presets_json = VALUES(highlight_presets_json),
             placeholder_rules_json = VALUES(placeholder_rules_json),
             is_default = VALUES(is_default),
             updated_at = NOW(3)`,
          [
            template.code,
            template.name,
            template.status,
            template.scope,
            template.description,
            template.previewTitle,
            template.coverStyle,
            JSON.stringify(template.themeTokens || {}),
            JSON.stringify(template.contentDefaults || {}),
            JSON.stringify(
              template.sectionSchema || proposalTemplateSectionCodes,
            ),
            JSON.stringify(template.highlightPresets || []),
            JSON.stringify(template.placeholderRules || []),
            Number(template.isDefault ? 1 : 0),
          ],
        );
      }
    })().catch((error) => {
      ensureProposalSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureProposalSchemaPromise;
}

async function fetchFrankfurterExchangeRate({ targetCurrency }) {
  const baseCurrency = String(config.exchangeRates.baseCurrency || "USD")
    .trim()
    .toUpperCase();
  const normalizedTargetCurrency = String(targetCurrency || "")
    .trim()
    .toUpperCase();

  if (!normalizedTargetCurrency) {
    throw new Error("Moneda objetivo invalida");
  }
  if (normalizedTargetCurrency === baseCurrency) {
    return {
      baseCurrency,
      targetCurrency: normalizedTargetCurrency,
      exchangeRate: 1,
      provider: "frankfurter",
      fetchedAt: new Date().toISOString(),
    };
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    config.exchangeRates.timeoutMs,
  );

  try {
    const response = await fetch(
      `${config.exchangeRates.frankfurterBaseUrl.replace(/\/$/, "")}/latest?from=${encodeURIComponent(baseCurrency)}&to=${encodeURIComponent(normalizedTargetCurrency)}`,
      {
        method: "GET",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Frankfurter request failed: ${response.status} ${errorText}`.trim(),
      );
    }

    const payload = await response.json();
    const exchangeRate = Number(payload?.rates?.[normalizedTargetCurrency]);
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      throw new Error(
        "Frankfurter request failed: invalid exchange rate payload",
      );
    }

    return {
      baseCurrency,
      targetCurrency: normalizedTargetCurrency,
      exchangeRate,
      provider: "frankfurter",
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
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

function buildQuotationDocumentStorageKey({
  quotationId,
  versionId,
  sha256,
  fileName,
}) {
  const safeFileName = String(fileName || "documento")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);

  return path.posix.join(
    "quotations",
    String(quotationId),
    "versions",
    String(versionId),
    `${sha256}__${safeFileName || "documento"}`,
  );
}

function buildQuotationVersionDocumentPayload(row) {
  return {
    id: Number(row.link_id),
    documentId: Number(row.document_id),
    publicId: String(row.document_public_id || ""),
    quotationVersionId: Number(row.quotation_version_id),
    quotationId: Number(row.quotation_id),
    versionNumber: Number(row.version_number),
    originalFileName: row.original_file_name || "documento",
    storedFileName: row.stored_file_name || null,
    mimeType: row.mime_type || "application/octet-stream",
    fileExtension: row.file_extension || null,
    byteSize: Number(row.byte_size || 0),
    createdAt: row.link_created_at,
    uploadedAt: row.document_created_at,
    uploadedByUserId: row.uploaded_by_user_id
      ? Number(row.uploaded_by_user_id)
      : null,
    uploadedByUserName: row.uploaded_by_user_name || null,
  };
}

async function listQuotationVersionDocuments({ versionId }) {
  await ensureQuotationVersionDocumentsSchema();
  const rows = await query(
    `SELECT qvd.id AS link_id,
            qvd.quotation_version_id,
            qvd.created_at AS link_created_at,
            qv.quotation_id,
            qv.version_number,
            d.id AS document_id,
            d.public_id AS document_public_id,
            d.original_file_name,
            d.stored_file_name,
            d.mime_type,
            d.file_extension,
            d.byte_size,
            d.created_at AS document_created_at,
            d.uploaded_by_user_id,
            uploader.full_name AS uploaded_by_user_name
     FROM quotation_version_documents qvd
     INNER JOIN quotation_versions qv ON qv.id = qvd.quotation_version_id
     INNER JOIN documents d ON d.id = qvd.document_id
     LEFT JOIN users uploader ON uploader.id = d.uploaded_by_user_id
     WHERE qvd.quotation_version_id = ?
       AND COALESCE(d.is_deleted, 0) = 0
     ORDER BY qvd.created_at DESC, qvd.id DESC`,
    [Number(versionId)],
  );

  return rows.map(buildQuotationVersionDocumentPayload);
}

async function listQuotationDocuments({ quotationId }) {
  await ensureQuotationVersionDocumentsSchema();
  const rows = await query(
    `SELECT qvd.id AS link_id,
            qvd.quotation_version_id,
            qvd.created_at AS link_created_at,
            qv.quotation_id,
            qv.version_number,
            d.id AS document_id,
            d.public_id AS document_public_id,
            d.original_file_name,
            d.stored_file_name,
            d.mime_type,
            d.file_extension,
            d.byte_size,
            d.created_at AS document_created_at,
            d.uploaded_by_user_id,
            uploader.full_name AS uploaded_by_user_name
     FROM quotation_version_documents qvd
     INNER JOIN quotation_versions qv ON qv.id = qvd.quotation_version_id
     INNER JOIN documents d ON d.id = qvd.document_id
     LEFT JOIN users uploader ON uploader.id = d.uploaded_by_user_id
     WHERE qv.quotation_id = ?
       AND COALESCE(d.is_deleted, 0) = 0
     ORDER BY qv.version_number DESC, qvd.created_at DESC, qvd.id DESC`,
    [Number(quotationId)],
  );

  return rows.map(buildQuotationVersionDocumentPayload);
}

async function copyQuotationVersionDocuments(
  conn,
  { sourceVersionId, targetVersionId, createdByUserId, createdAt },
) {
  await conn.query(
    `INSERT INTO quotation_version_documents
      (quotation_version_id, document_id, created_by_user_id, created_at)
     SELECT ?, qvd.document_id, ?, ?
     FROM quotation_version_documents qvd
     WHERE qvd.quotation_version_id = ?`,
    [
      Number(targetVersionId),
      Number(createdByUserId),
      createdAt,
      Number(sourceVersionId),
    ],
  );
}

async function getQuotationVersionDocumentLink({ linkId }) {
  await ensureQuotationVersionDocumentsSchema();
  const rows = await query(
    `SELECT qvd.id AS link_id,
            qvd.quotation_version_id,
            qvd.document_id,
            qv.quotation_id,
            qv.version_number,
            d.public_id AS document_public_id,
            d.original_file_name,
            d.mime_type
     FROM quotation_version_documents qvd
     INNER JOIN quotation_versions qv ON qv.id = qvd.quotation_version_id
     INNER JOIN documents d ON d.id = qvd.document_id
     WHERE qvd.id = ?
       AND COALESCE(d.is_deleted, 0) = 0
     LIMIT 1`,
    [Number(linkId)],
  );

  return rows[0] || null;
}

async function createQuotationVersionDocuments(
  conn,
  { files, quotationId, versionId, userId },
) {
  const createdDocuments = [];

  for (const file of files) {
    const originalFileName =
      String(file.originalFilename || file.newFilename || "documento").trim() ||
      "documento";
    const mimeType =
      String(file.mimetype || "application/octet-stream").trim() ||
      "application/octet-stream";
    const extension = path.extname(originalFileName || "").slice(1) || null;
    const buffer = await readFile(file.filepath);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const storageKey = buildQuotationDocumentStorageKey({
      quotationId,
      versionId,
      sha256,
      fileName: originalFileName,
    });
    const stored = await documentStorage.save({ buffer, storageKey });
    const now = new Date();
    const publicId = `doc_${randomUUID().replace(/-/g, "")}`;
    const [insertResult] = await conn.query(
      `INSERT INTO documents
         (public_id, upload_session_id, entity_type, entity_id, storage_provider,
          storage_bucket, storage_key, original_file_name, stored_file_name,
          mime_type, file_extension, byte_size, sha256, document_kind, source_label,
          processing_status, processing_error, duration_seconds, is_deleted,
          uploaded_by_user_id, created_at, updated_at)
       VALUES (?, NULL, 'quotation_version', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', NULL, NULL, 0, ?, ?, ?)`,
      [
        publicId,
        Number(versionId),
        stored.storageProvider,
        stored.storageBucket,
        stored.storageKey,
        originalFileName,
        stored.storedFileName,
        mimeType,
        extension,
        Number(file.size || buffer.length || 0),
        sha256,
        "quotation_attachment",
        "Adjunto de cotizacion",
        Number(userId),
        now,
        now,
      ],
    );
    const documentId = Number(insertResult.insertId);
    await conn.query(
      `INSERT INTO quotation_version_documents
         (quotation_version_id, document_id, created_by_user_id, created_at)
       VALUES (?, ?, ?, ?)`,
      [Number(versionId), documentId, Number(userId), now],
    );
    createdDocuments.push(documentId);
  }

  return createdDocuments;
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
        "original_currency_code",
        `ALTER TABLE quotation_section_items
         ADD COLUMN original_currency_code CHAR(3) NULL
         AFTER quantity`,
      );
      await ensureQuotationSectionItemsColumn(
        "original_list_price_unit",
        `ALTER TABLE quotation_section_items
         ADD COLUMN original_list_price_unit DECIMAL(15, 4) NULL
         AFTER original_currency_code`,
      );
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
      await query(
        `UPDATE quotation_section_items
         SET original_currency_code = COALESCE(NULLIF(TRIM(original_currency_code), ''), 'USD'),
             original_list_price_unit = COALESCE(original_list_price_unit, list_price_unit)
         WHERE original_currency_code IS NULL
            OR TRIM(original_currency_code) = ''
            OR original_list_price_unit IS NULL`,
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
    await ensureProposalSchema();
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

function normalizeQuotationItemOriginalValues(
  item,
  fallbackCurrencyCode = "USD",
) {
  return {
    originalCurrencyCode: String(
      item.originalCurrencyCode || fallbackCurrencyCode || "USD",
    )
      .trim()
      .toUpperCase(),
    originalListPriceUnit: Number(
      item.originalListPriceUnit ?? item.listPriceUnit,
    ),
    listPriceUnit: Number(item.listPriceUnit),
  };
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
  { sectionId, currentItemsById, items, now, userId, quotationCurrencyCode },
) {
  const keptItemIds = new Set();
  const persistedItemIdByLocalId = new Map();
  const pendingRelationships = [];

  for (const [itemIndex, item] of items.entries()) {
    const displayOrder = Number(item.displayOrder || itemIndex + 1);
    const bundleSortOrder = item.bundleParentLocalId
      ? Number(item.bundleSortOrder || 1)
      : null;
    const normalizedPrices = normalizeQuotationItemOriginalValues(
      item,
      quotationCurrencyCode,
    );

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
           quantity = ?, original_currency_code = ?, original_list_price_unit = ?, list_price_unit = ?,
           manufacturer_discount_pct = ?, import_cost_pct = ?,
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
          normalizedPrices.originalCurrencyCode,
          normalizedPrices.originalListPriceUnit,
          normalizedPrices.listPriceUnit,
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
           quantity, original_currency_code, original_list_price_unit, list_price_unit,
           manufacturer_discount_pct, import_cost_pct, profit_margin_pct,
           final_discount_pct, display_order, bundle_sort_order, created_at, updated_at, created_by_user_id, updated_by_user_id)
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          normalizedPrices.originalCurrencyCode,
          normalizedPrices.originalListPriceUnit,
          normalizedPrices.listPriceUnit,
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
  {
    sectionId,
    items,
    now,
    userId,
    refField,
    parentRefField,
    quotationCurrencyCode,
  },
) {
  const insertedIdsByRef = new Map();
  const pendingRelationships = [];

  for (const [itemIndex, item] of items.entries()) {
    const normalizedPrices = normalizeQuotationItemOriginalValues(
      item,
      quotationCurrencyCode,
    );
    const [result] = await conn.query(
      `INSERT INTO quotation_section_items
        (quotation_section_id, provider_id, product_code, product_description, item_type, bundle_parent_item_id,
         bundle_origin_type, source_provider_price_list_item_id, source_component_price_list_item_id,
         quantity, original_currency_code, original_list_price_unit, list_price_unit,
         manufacturer_discount_pct, import_cost_pct, profit_margin_pct,
         final_discount_pct, display_order, bundle_sort_order, created_at, updated_at, created_by_user_id, updated_by_user_id)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        normalizedPrices.originalCurrencyCode,
        normalizedPrices.originalListPriceUnit,
        normalizedPrices.listPriceUnit,
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

function hasProviderPriceCreatePermission(user) {
  return user?.permissionSet?.has("proveedores_precios.create");
}

function isUniqueViolation(error, constraintName) {
  const message = String(error?.message || "");
  return (
    message.includes(constraintName) || message.includes("Duplicate entry")
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
                 a.name AS account_name,
            su.full_name AS seller_user_name,
            su.email AS seller_user_email,
            su.mobile AS seller_user_phone,
            qs.code AS status_code, qs.name AS status_name,
            qs.ui_key AS status_ui_key,
            qas.code AS activation_status_code, qas.name AS activation_status_name,
            CONCAT(c.first_name, ' ', c.last_name) AS contact_name,
            c.email AS contact_email,
            COALESCE(NULLIF(TRIM(c.phone), ''), NULLIF(TRIM(c.mobile), '')) AS contact_phone
     FROM quotation_versions qv
     INNER JOIN quotations q ON q.id = qv.quotation_id
     INNER JOIN opportunities o ON o.id = q.opportunity_id
     ${ownershipJoin}
               INNER JOIN accounts a ON a.id = o.account_id
     LEFT JOIN users su ON su.id = o.seller_user_id
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

async function getActiveQuotationProductLists(providerId) {
  return query(
    `SELECT ppl.id, ppl.provider_id, ppl.name, ppl.currency_id, ppl.item_type,
            curr.code AS currency_code, curr.name AS currency_name,
            curr.symbol AS currency_symbol,
            p.name AS provider_name
     FROM provider_price_lists ppl
     INNER JOIN providers p ON p.id = ppl.provider_id
     INNER JOIN provider_activation_statuses pas ON pas.id = p.activation_status_id
     INNER JOIN currencies curr ON curr.id = ppl.currency_id
     WHERE ppl.provider_id = ?
       AND ppl.is_active = 1
       AND pas.code = 'activado'
     ORDER BY ppl.name, ppl.id`,
    [Number(providerId)],
  );
}

async function getActiveQuotationProductList({ providerId, listId }) {
  const rows = await query(
    `SELECT ppl.id, ppl.provider_id, ppl.name, ppl.currency_id, ppl.item_type,
            curr.code AS currency_code, curr.name AS currency_name,
            curr.symbol AS currency_symbol,
            p.name AS provider_name
     FROM provider_price_lists ppl
     INNER JOIN providers p ON p.id = ppl.provider_id
     INNER JOIN provider_activation_statuses pas ON pas.id = p.activation_status_id
     INNER JOIN currencies curr ON curr.id = ppl.currency_id
     WHERE ppl.provider_id = ?
       AND ppl.id = ?
       AND ppl.is_active = 1
       AND pas.code = 'activado'
     LIMIT 1`,
    [Number(providerId), Number(listId)],
  );

  return rows.length ? rows[0] : null;
}

async function getProviderPriceItemActiveStatusId() {
  const row = await getCatalogRowByCode(
    "provider_price_list_item_statuses",
    "activo",
  );
  return row ? Number(row.id) : null;
}

function mapQuotationProductRow(row, componentMap = new Map()) {
  return {
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
  };
}

async function getQuotationProductRows({
  providerId,
  priceListId,
  searchQuery,
  limit,
}) {
  const params = [];
  let whereClause = "";

  if (providerId) {
    whereClause += " AND ppli.provider_id = ?";
    params.push(Number(providerId));
  }

  if (priceListId) {
    whereClause += " AND ppli.price_list_id = ?";
    params.push(Number(priceListId));
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

  return rows;
}

async function getQuotationProductComponents(groupItemIds) {
  if (!groupItemIds.length) return new Map();

  const placeholders = groupItemIds.map(() => "?").join(", ");
  const rows = await query(
    `SELECT c.id, c.grupo_item_id, c.component_item_id, c.unit_price_override, c.quantity, c.sort_order,
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
      unitPriceOverride:
        row.unit_price_override === null ||
        row.unit_price_override === undefined
          ? null
          : Number(row.unit_price_override),
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
              qsi.quantity, qsi.original_currency_code, qsi.original_list_price_unit, qsi.list_price_unit,
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
        originalCurrencyCode: item.original_currency_code || null,
        originalListPriceUnit:
          item.original_list_price_unit == null
            ? null
            : Number(item.original_list_price_unit),
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
            lp.id AS proposal_id,
            lp.status_code AS proposal_status_code,
            qas.code AS activation_status_code,
            qas.name AS activation_status_name,
            qv.created_at, qv.updated_at,
            qv.created_by_user_id, qv.updated_by_user_id
     FROM quotation_versions qv
     INNER JOIN contacts c ON c.id = qv.contact_id
     INNER JOIN quotation_statuses qs ON qs.id = qv.status_id
     INNER JOIN quotation_activation_statuses qas ON qas.id = qv.activation_status_id
     LEFT JOIN (
       SELECT p.id, p.quotation_version_id, p.status_code
       FROM proposals p
       INNER JOIN (
         SELECT quotation_version_id, MAX(id) AS latest_proposal_id
         FROM proposals
         GROUP BY quotation_version_id
       ) latest_proposals
         ON latest_proposals.latest_proposal_id = p.id
     ) lp ON lp.quotation_version_id = qv.id
     WHERE qv.quotation_id = ?
     ORDER BY qv.version_number DESC, qv.id DESC`,
    [Number(quotationId)],
  );
}

function safeParseJsonObject(value) {
  if (!value) return null;
  if (typeof value === "object") {
    return value;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function safeParseJsonArray(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sanitizeProposalContent(content) {
  const parsed = proposalContentSchema.safeParse(content || {});
  if (!parsed.success) {
    return {
      heroTitle: "",
      heroSubtitle: "",
      executiveSummary: "",
      solutionOverview: "",
      valueHighlights: [],
      closingMessage: "",
    };
  }

  return {
    heroTitle: parsed.data.heroTitle || "",
    heroSubtitle: parsed.data.heroSubtitle || "",
    executiveSummary: parsed.data.executiveSummary || "",
    solutionOverview: parsed.data.solutionOverview || "",
    valueHighlights: Array.isArray(parsed.data.valueHighlights)
      ? parsed.data.valueHighlights.filter(Boolean)
      : [],
    closingMessage: parsed.data.closingMessage || "",
  };
}

function sanitizeProposalTemplateSnapshot(snapshot) {
  const parsed = proposalTemplateSnapshotSchema.safeParse(snapshot || {});
  if (!parsed.success) {
    return {
      code: "legacy_minimal",
      name: "Sin plantilla",
      description: "Propuesta legacy sin plantilla aplicada.",
      previewTitle: "Legacy",
      coverStyle: "corporate",
      themeTokens: {},
      contentDefaults: sanitizeProposalContent({}),
      sectionSchema: proposalTemplateSectionCodes,
      highlightPresets: [],
      placeholderRules: [],
    };
  }

  return {
    ...parsed.data,
    contentDefaults: sanitizeProposalContent(parsed.data.contentDefaults || {}),
    highlightPresets: Array.isArray(parsed.data.highlightPresets)
      ? parsed.data.highlightPresets.filter(Boolean)
      : [],
    sectionSchema: Array.isArray(parsed.data.sectionSchema)
      ? parsed.data.sectionSchema.filter(Boolean)
      : proposalTemplateSectionCodes,
  };
}

function serializeProposalTemplateRow(templateRow) {
  const templateSnapshot = sanitizeProposalTemplateSnapshot({
    code: templateRow.code,
    name: templateRow.name,
    description: templateRow.description || "",
    previewTitle: templateRow.preview_title || "",
    coverStyle: templateRow.cover_style || "corporate",
    themeTokens: safeParseJsonObject(templateRow.theme_tokens_json) || {},
    contentDefaults:
      safeParseJsonObject(templateRow.content_defaults_json) || {},
    sectionSchema:
      safeParseJsonArray(templateRow.section_schema_json) ||
      proposalTemplateSectionCodes,
    highlightPresets:
      safeParseJsonArray(templateRow.highlight_presets_json) || [],
    placeholderRules:
      safeParseJsonArray(templateRow.placeholder_rules_json) || [],
  });

  return {
    id: Number(templateRow.id),
    code: templateRow.code,
    name: templateRow.name,
    status: templateRow.status,
    scope: templateRow.scope || "global",
    description: templateRow.description || "",
    previewTitle: templateRow.preview_title || "",
    coverStyle: templateSnapshot.coverStyle,
    themeTokens: templateSnapshot.themeTokens,
    contentDefaults: templateSnapshot.contentDefaults,
    sectionSchema: templateSnapshot.sectionSchema,
    highlightPresets: templateSnapshot.highlightPresets,
    placeholderRules: templateSnapshot.placeholderRules,
    isDefault: Boolean(Number(templateRow.is_default || 0)),
  };
}

async function getAvailableProposalTemplates() {
  const rows = await query(
    `SELECT *
     FROM proposal_templates
     WHERE archived_at IS NULL
       AND status = 'active'
     ORDER BY is_default DESC, name ASC, id ASC`,
  );

  return rows.map(serializeProposalTemplateRow);
}

async function getProposalTemplateById(templateId) {
  const rows = await query(
    `SELECT *
     FROM proposal_templates
     WHERE id = ?
       AND archived_at IS NULL
     LIMIT 1`,
    [Number(templateId)],
  );

  return rows.length ? serializeProposalTemplateRow(rows[0]) : null;
}

async function getDefaultProposalTemplate() {
  const rows = await query(
    `SELECT *
     FROM proposal_templates
     WHERE archived_at IS NULL
       AND status = 'active'
     ORDER BY is_default DESC, id ASC
     LIMIT 1`,
  );

  return rows.length ? serializeProposalTemplateRow(rows[0]) : null;
}

function buildProposalTemplateSnapshot(template) {
  return sanitizeProposalTemplateSnapshot({
    code: template?.code || "legacy_minimal",
    name: template?.name || "Sin plantilla",
    description: template?.description || "",
    previewTitle: template?.previewTitle || template?.name || "",
    coverStyle: template?.coverStyle || "corporate",
    themeTokens: template?.themeTokens || {},
    contentDefaults: template?.contentDefaults || {},
    sectionSchema: template?.sectionSchema || proposalTemplateSectionCodes,
    highlightPresets: template?.highlightPresets || [],
    placeholderRules: template?.placeholderRules || [],
  });
}

function replaceProposalTemplatePlaceholders(value, context) {
  return String(value || "").replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_match, key) => {
      const nextValue = context[key];
      return nextValue == null ? "" : String(nextValue);
    },
  );
}

function buildProposalTemplateContext({ versionRow, sections }) {
  const snapshot = buildProposalPricingSnapshot({ versionRow, sections });
  return {
    accountName: versionRow.account_name || "",
    contactName: versionRow.contact_name || "",
    opportunityName: versionRow.opportunity_name || "",
    proposalName:
      versionRow.proposal_name ||
      `Propuesta comercial v${Number(versionRow.version_number || 1)}`,
    quotationNumber: String(versionRow.quotation_id || ""),
    versionNumber: String(versionRow.version_number || ""),
    currencyCode:
      snapshot.summary?.currencyCode || versionRow.currency_code || "",
    subtotal: formatCurrency(
      snapshot.summary?.subtotal,
      snapshot.summary?.currencyCode,
    ),
    total: formatCurrency(
      snapshot.summary?.total,
      snapshot.summary?.currencyCode,
    ),
  };
}

function resolveTemplateContentDefaults({
  templateSnapshot,
  versionRow,
  sections,
}) {
  const template = sanitizeProposalTemplateSnapshot(templateSnapshot || {});
  const context = buildProposalTemplateContext({ versionRow, sections });
  const defaults = sanitizeProposalContent(template.contentDefaults || {});

  return sanitizeProposalContent({
    heroTitle: replaceProposalTemplatePlaceholders(defaults.heroTitle, context),
    heroSubtitle: replaceProposalTemplatePlaceholders(
      defaults.heroSubtitle,
      context,
    ),
    executiveSummary: replaceProposalTemplatePlaceholders(
      defaults.executiveSummary,
      context,
    ),
    solutionOverview: replaceProposalTemplatePlaceholders(
      defaults.solutionOverview,
      context,
    ),
    valueHighlights: (defaults.valueHighlights || []).map((value) =>
      replaceProposalTemplatePlaceholders(value, context),
    ),
    closingMessage: replaceProposalTemplatePlaceholders(
      defaults.closingMessage,
      context,
    ),
  });
}

function mergeProposalContentWithTemplateDefaults(content, templateDefaults) {
  const currentContent = sanitizeProposalContent(content || {});
  const defaults = sanitizeProposalContent(templateDefaults || {});

  return sanitizeProposalContent({
    heroTitle: currentContent.heroTitle || defaults.heroTitle,
    heroSubtitle: currentContent.heroSubtitle || defaults.heroSubtitle,
    executiveSummary:
      currentContent.executiveSummary || defaults.executiveSummary,
    solutionOverview:
      currentContent.solutionOverview || defaults.solutionOverview,
    valueHighlights:
      currentContent.valueHighlights?.length > 0
        ? currentContent.valueHighlights
        : defaults.valueHighlights,
    closingMessage: currentContent.closingMessage || defaults.closingMessage,
  });
}

function formatCurrency(value, currencyCode) {
  if (value == null || value === "") return "";
  try {
    return Number(value).toLocaleString("es-MX", {
      style: "currency",
      currency: currencyCode || "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  } catch {
    return String(value);
  }
}

function calculateProposalSalePrice(item) {
  if (!item || item.itemType === "grupo_productos") {
    return {
      discountedListPriceUnit: 0,
      costUnit: 0,
      salePriceUnit: 0,
      salePriceTotal: 0,
    };
  }

  const listPriceUnit = Number(item.listPriceUnit || 0);
  const quantity = Number(item.quantity || 0);
  const manufacturerDiscountPct = Number(item.manufacturerDiscountPct || 0);
  const importCostPct = Number(item.importCostPct || 0);
  const profitMarginPct = Number(item.profitMarginPct || 0);
  const finalDiscountPct = Number(item.finalDiscountPct || 0);
  const discountedListPriceUnit =
    listPriceUnit * (1 - manufacturerDiscountPct / 100);
  const costUnit = discountedListPriceUnit * (1 + importCostPct / 100);
  const salePriceUnit =
    profitMarginPct >= 100
      ? 0
      : (costUnit / (1 - profitMarginPct / 100)) * (1 - finalDiscountPct / 100);

  return {
    discountedListPriceUnit,
    costUnit,
    salePriceUnit,
    salePriceTotal: salePriceUnit * quantity,
  };
}

function buildProposalPricingSummary({ versionRow, items }) {
  const baseSubtotal = items.reduce((total, item) => {
    if (item.itemType === "grupo_productos") {
      return total;
    }
    return total + Number(item.salePriceTotal || 0);
  }, 0);
  const vatPct = Number(
    versionRow.summary_vat_pct || DEFAULT_QUOTATION_VAT_PCT,
  );
  const totalWithPerItemVat =
    versionRow.summary_vat_mode === "per_item"
      ? baseSubtotal * (1 + vatPct / 100)
      : baseSubtotal;

  let discountedSubtotal = totalWithPerItemVat;
  if (versionRow.summary_distribution_mode !== "per_item") {
    if (versionRow.summary_discount_mode === "amount") {
      const discountValue = Math.max(
        0,
        Math.min(
          Number(versionRow.summary_discount_value || 0),
          totalWithPerItemVat,
        ),
      );
      discountedSubtotal = Math.max(totalWithPerItemVat - discountValue, 0);
    } else if (versionRow.summary_discount_mode === "percentage") {
      const discountPct = Math.min(
        Math.max(Number(versionRow.summary_discount_value || 0), 0),
        100,
      );
      discountedSubtotal = totalWithPerItemVat * (1 - discountPct / 100);
    }
  }

  const total =
    versionRow.summary_vat_mode === "total"
      ? discountedSubtotal * (1 + vatPct / 100)
      : discountedSubtotal;

  return {
    subtotal: Number(baseSubtotal.toFixed(6)),
    discountedSubtotal: Number(discountedSubtotal.toFixed(6)),
    total: Number(total.toFixed(6)),
    vatAmount: Number((total - discountedSubtotal).toFixed(6)),
    vatMode: versionRow.summary_vat_mode || null,
    vatPct,
    discountMode: versionRow.summary_discount_mode || null,
    discountValue:
      versionRow.summary_discount_value == null
        ? null
        : Number(versionRow.summary_discount_value),
    currencyCode: versionRow.currency_code || null,
  };
}

function buildDefaultProposalContent({
  versionRow,
  sections,
  templateSnapshot,
}) {
  if (templateSnapshot) {
    return resolveTemplateContentDefaults({
      templateSnapshot,
      versionRow,
      sections,
    });
  }

  const sectionTitles = sections
    .map((section) => String(section.title || "").trim())
    .filter(Boolean)
    .slice(0, 3);

  return sanitizeProposalContent({
    heroTitle:
      versionRow.proposal_name ||
      `Propuesta comercial v${Number(versionRow.version_number || 1)}`,
    heroSubtitle:
      versionRow.contact_name && versionRow.opportunity_name
        ? `Presentacion comercial basada en la cotizacion aprobada para ${versionRow.contact_name} sobre ${versionRow.opportunity_name}.`
        : "Presentacion comercial basada en una cotizacion aprobada.",
    executiveSummary: versionRow.introduction || "",
    solutionOverview:
      sectionTitles.length > 0
        ? `La propuesta desarrolla los siguientes frentes: ${sectionTitles.join(", ")}.`
        : "La propuesta organiza la cotizacion en una presentacion comercial mas clara.",
    valueHighlights: sectionTitles,
    closingMessage:
      "Quedamos atentos para revisar esta propuesta y resolver cualquier ajuste de presentacion requerido.",
  });
}

function buildProposalPricingSnapshot({ versionRow, sections }) {
  const snapshotSections = sections.map((section) => ({
    id: Number(section.id),
    title: section.title || "",
    inclusionName: section.inclusionName || "",
    items: section.items.map((item) => {
      const computed = calculateProposalSalePrice(item);
      return {
        id: Number(item.id),
        productCode: item.productCode,
        productDescription: item.productDescription,
        itemType: item.itemType,
        bundleParentItemId: item.bundleParentItemId,
        quantity: Number(item.quantity || 0),
        listPriceUnit: Number(item.listPriceUnit || 0),
        salePriceUnit: Number(computed.salePriceUnit.toFixed(6)),
        salePriceTotal: Number(computed.salePriceTotal.toFixed(6)),
        displayOrder: Number(item.displayOrder || 0),
      };
    }),
  }));

  const flatItems = snapshotSections.flatMap((section) => section.items);

  return {
    quotationId: Number(versionRow.quotation_id),
    quotationVersionId: Number(versionRow.id),
    versionNumber: Number(versionRow.version_number),
    proposalName: versionRow.proposal_name || "",
    quotationDate: formatDateOnly(versionRow.quotation_date),
    currencyCode: versionRow.currency_code || null,
    sections: snapshotSections,
    summary: buildProposalPricingSummary({
      versionRow,
      items: flatItems,
    }),
  };
}

function buildQuotationPdfSections(sections) {
  return (Array.isArray(sections) ? sections : [])
    .map((section) => {
      const rows = (Array.isArray(section.items) ? section.items : [])
        .filter((item) => item.itemType !== "grupo_productos")
        .map((item) => {
          const computed = calculateProposalSalePrice(item);
          return {
            displayOrder:
              item.displayOrder == null ? null : Number(item.displayOrder),
            productCode: item.productCode || "",
            productDescription: item.productDescription || "",
            quantity: Number(item.quantity || 0),
            quantityDisplay: String(Number(item.quantity || 0)),
            salePriceUnit: Number(computed.salePriceUnit.toFixed(6)),
            salePriceTotal: Number(computed.salePriceTotal.toFixed(6)),
          };
        });

      return {
        title: section.title || "",
        subtotal: Number(
          rows.reduce(
            (total, row) => total + Number(row.salePriceTotal || 0),
            0,
          ),
        ),
        rows,
      };
    })
    .filter((section) => section.rows.length > 0);
}

function buildQuotationPdfSummaryFromVersion({ versionRow, sections }) {
  const rows = sections.flatMap((section) => section.rows || []);
  const subtotal = rows.reduce(
    (total, row) => total + Number(row.salePriceTotal || 0),
    0,
  );
  const vatPct = Number(
    versionRow.summary_vat_pct || DEFAULT_QUOTATION_VAT_PCT,
  );
  const totalWithPerItemVat =
    versionRow.summary_vat_mode === "per_item"
      ? subtotal * (1 + vatPct / 100)
      : subtotal;

  let discount = 0;
  let discountedSubtotal = totalWithPerItemVat;
  if (versionRow.summary_distribution_mode !== "per_item") {
    if (versionRow.summary_discount_mode === "amount") {
      discount = Math.max(
        0,
        Math.min(
          Number(versionRow.summary_discount_value || 0),
          totalWithPerItemVat,
        ),
      );
      discountedSubtotal = Math.max(totalWithPerItemVat - discount, 0);
    } else if (versionRow.summary_discount_mode === "percentage") {
      const discountPct = Math.min(
        Math.max(Number(versionRow.summary_discount_value || 0), 0),
        100,
      );
      discount = totalWithPerItemVat * (discountPct / 100);
      discountedSubtotal = totalWithPerItemVat - discount;
    }
  }

  const total =
    versionRow.summary_vat_mode === "total"
      ? discountedSubtotal * (1 + vatPct / 100)
      : discountedSubtotal;

  return {
    subtotal: Number(subtotal.toFixed(6)),
    discount: Number(discount.toFixed(6)),
    discountedSubtotal: Number(discountedSubtotal.toFixed(6)),
    vatAmount: Number((total - discountedSubtotal).toFixed(6)),
    total: Number(total.toFixed(6)),
    showVat: versionRow.summary_vat_mode === "total",
    vatMode:
      versionRow.summary_vat_mode === "total" ||
      versionRow.summary_vat_mode === "per_item"
        ? versionRow.summary_vat_mode
        : "without_vat",
    currencyCode: versionRow.currency_code || "USD",
  };
}

async function getAccessibleQuotationVersionPdfContext({
  user,
  quotationVersionId,
}) {
  const versionRow = await getAccessibleQuotationVersion({
    user,
    versionId: quotationVersionId,
  });
  if (!versionRow) {
    return null;
  }

  const sections = await getQuotationVersionSections(quotationVersionId);
  return { versionRow, sections };
}

function buildQuotationPdfModelFromVersionContext({
  company,
  versionRow,
  sections,
}) {
  const quotationSections = buildQuotationPdfSections(sections);
  return {
    company,
    header: {
      quotationNumber: String(versionRow.quotation_id || ""),
      versionNumber: String(versionRow.version_number || ""),
      quotationDate: formatDateOnly(versionRow.quotation_date),
      proposalName: versionRow.proposal_name || "",
      accountName: versionRow.account_name || "",
      contactName: versionRow.contact_name || "",
      contactEmail: versionRow.contact_email || "",
      contactPhone: versionRow.contact_phone || "",
      sellerName: versionRow.seller_user_name || "",
      sellerEmail: versionRow.seller_user_email || "",
      sellerPhone: versionRow.seller_user_phone || "",
    },
    introduction: versionRow.introduction || "",
    sections: quotationSections,
    summary: buildQuotationPdfSummaryFromVersion({
      versionRow,
      sections: quotationSections,
    }),
    commercialTerms: {
      deliveryTime: versionRow.delivery_time || "",
      quotationValidity: versionRow.quotation_validity || "",
      warranty: versionRow.warranty_term || "",
      paymentTerms: versionRow.payment_terms || "",
      currency: versionRow.currency_code || "",
    },
    notes: versionRow.quotation_notes || "",
  };
}

async function resolveProposalQuotationAttachment({
  user,
  company,
  quotationVersionId,
}) {
  const context = await getAccessibleQuotationVersionPdfContext({
    user,
    quotationVersionId,
  });
  if (!context) {
    throw new Error("No fue posible resolver la cotizacion heredada");
  }

  return buildQuotationPdfModelFromVersionContext({
    company,
    versionRow: context.versionRow,
    sections: context.sections,
  });
}

async function getLatestApprovedQuotationVersion({ quotationId }) {
  const rows = await query(
    `SELECT qv.id, qv.version_number
     FROM quotation_versions qv
     INNER JOIN quotation_statuses qs ON qs.id = qv.status_id
     WHERE qv.quotation_id = ?
       AND qs.code = 'aprobada'
     ORDER BY qv.version_number DESC, qv.id DESC
     LIMIT 1`,
    [Number(quotationId)],
  );

  return rows.length
    ? {
        id: Number(rows[0].id),
        versionNumber: Number(rows[0].version_number),
      }
    : null;
}

async function createProposalRevision({
  proposalId,
  quotationVersionId,
  title,
  statusCode,
  content,
  pricingSnapshot,
  changeType,
  userId,
}) {
  const rows = await query(
    `SELECT COALESCE(MAX(revision_number), 0) AS max_revision
     FROM proposal_revisions
     WHERE proposal_id = ?`,
    [Number(proposalId)],
  );
  const revisionNumber = Number(rows[0]?.max_revision || 0) + 1;
  await query(
    `INSERT INTO proposal_revisions
      (proposal_id, revision_number, quotation_version_id, title, status_code,
       content_json, pricing_snapshot_json, change_type, created_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
    [
      Number(proposalId),
      revisionNumber,
      Number(quotationVersionId),
      title,
      statusCode,
      JSON.stringify(content || {}),
      JSON.stringify(pricingSnapshot || {}),
      changeType,
      Number(userId),
    ],
  );
}

const AUTO_SYNC_PROPOSAL_CHANGE_TYPES = new Set([
  "create_from_version",
  "create_from_version_clone",
  "rebase_to_quotation_version",
  "sync_from_current_config_on_create",
  "sync_from_current_config_on_read",
]);

function buildProposalComponentSyncFingerprint(components) {
  return JSON.stringify(
    Array.isArray(components)
      ? components.map((component) => ({
          componentCode: component.componentCode || "",
          title: component.title || "",
          displayOrder: Number(component.displayOrder || 0),
          status: component.status || "active",
          layoutConfig: component.layoutConfig
            ? {
                mode: component.layoutConfig.mode || null,
                rows: Array.isArray(component.layoutConfig.rows)
                  ? component.layoutConfig.rows.map((row) => ({
                      blockIndexes: Array.isArray(row.blockIndexes)
                        ? row.blockIndexes.filter((index) =>
                            Number.isInteger(index),
                          )
                        : [],
                    }))
                  : undefined,
              }
            : null,
          blocks: Array.isArray(component.blocks)
            ? component.blocks.map((block) => ({
                type: block.type || "paragraph",
                text: block.text || "",
                items: Array.isArray(block.items) ? block.items : [],
                assetId: block.assetId ? Number(block.assetId) : null,
                assetVersionId: block.assetVersionId
                  ? Number(block.assetVersionId)
                  : null,
              }))
            : [],
        }))
      : [],
  );
}

async function syncProposalFromCurrentConfigIfEligible({
  proposalId,
  proposalTitle,
  userId,
  user,
}) {
  const canAutoSync = await canAutoSyncProposalFromCurrentConfig(proposalId);
  if (!canAutoSync) {
    return false;
  }

  const [proposalComponents, proposalContentConfig] = await Promise.all([
    listProposalComponents(Number(proposalId)),
    getProposalContentConfiguration(),
  ]);

  const currentFingerprint =
    buildProposalComponentSyncFingerprint(proposalComponents);
  const sourceFingerprint = buildProposalComponentSyncFingerprint(
    proposalContentConfig?.components || [],
  );

  if (currentFingerprint === sourceFingerprint) {
    return false;
  }

  await cloneProposalComponents({
    proposalId,
    actorUserId: Number(userId),
  });
  const synchronizedContent = await refreshProposalLegacyContentFromComponents({
    proposalId,
    proposalTitle,
    userId: Number(userId),
  });

  const refreshedProposal = await getAccessibleProposal({
    user,
    proposalId,
  });

  if (!refreshedProposal) {
    return true;
  }

  await createProposalRevision({
    proposalId,
    quotationVersionId: Number(refreshedProposal.quotation_version_id),
    title: refreshedProposal.title || proposalTitle,
    statusCode: normalizeProposalStatusCode(
      refreshedProposal.status_code,
      refreshedProposal.archived_at ? "archived" : "active",
    ),
    content: synchronizedContent.content,
    pricingSnapshot:
      safeParseJsonObject(refreshedProposal.pricing_snapshot_json) || {},
    changeType: "sync_from_current_config_on_read",
    userId,
  });

  return true;
}

async function canAutoSyncProposalFromCurrentConfig(proposalId) {
  const rows = await query(
    `SELECT change_type
     FROM proposal_revisions
     WHERE proposal_id = ?
     ORDER BY revision_number ASC`,
    [Number(proposalId)],
  );

  if (!rows.length) {
    return false;
  }

  return rows.every((row) =>
    AUTO_SYNC_PROPOSAL_CHANGE_TYPES.has(String(row.change_type || "").trim()),
  );
}

async function getAccessibleProposal({ user, proposalId }) {
  const params = [];
  const ownershipJoin = applyOwnedAccountScope({
    user,
    accountExpression: "o.account_id",
    params,
  });
  params.push(Number(proposalId));
  const rows = await query(
    `SELECT p.*, a.name AS account_name,
            o.name AS opportunity_name,
            CONCAT(c.first_name, ' ', c.last_name) AS contact_name,
          pt.name AS template_name,
          pt.status AS template_status,
          pt.code AS template_code,
            qv.version_number AS quotation_version_number,
            qv.proposal_name AS quotation_version_proposal_name,
            qv.status_id AS quotation_version_status_id,
            qvs.code AS quotation_version_status_code,
            qvs.name AS quotation_version_status_name,
            q.latest_version_id,
            (
              SELECT qv2.id
              FROM quotation_versions qv2
              INNER JOIN quotation_statuses qs2 ON qs2.id = qv2.status_id
              WHERE qv2.quotation_id = q.id
                AND qs2.code = 'aprobada'
              ORDER BY qv2.version_number DESC, qv2.id DESC
              LIMIT 1
            ) AS latest_approved_version_id,
            (
              SELECT qv2.version_number
              FROM quotation_versions qv2
              INNER JOIN quotation_statuses qs2 ON qs2.id = qv2.status_id
              WHERE qv2.quotation_id = q.id
                AND qs2.code = 'aprobada'
              ORDER BY qv2.version_number DESC, qv2.id DESC
              LIMIT 1
            ) AS latest_approved_version_number
     FROM proposals p
     INNER JOIN quotations q ON q.id = p.quotation_id
     INNER JOIN quotation_versions qv ON qv.id = p.quotation_version_id
     INNER JOIN quotation_statuses qvs ON qvs.id = qv.status_id
     INNER JOIN opportunities o ON o.id = p.opportunity_id
     ${ownershipJoin}
     INNER JOIN accounts a ON a.id = p.account_id
     INNER JOIN contacts c ON c.id = p.contact_id
     LEFT JOIN proposal_templates pt ON pt.id = p.template_id
     WHERE p.id = ?
     LIMIT 1`,
    params,
  );

  return rows.length ? rows[0] : null;
}

function serializeProposalRow(proposalRow, options = {}) {
  const content = sanitizeProposalContent(
    safeParseJsonObject(proposalRow.content_json) || {},
  );
  const pricingSnapshot =
    safeParseJsonObject(proposalRow.pricing_snapshot_json) || {};
  const templateSnapshot = proposalRow.template_snapshot_json
    ? sanitizeProposalTemplateSnapshot(
        safeParseJsonObject(proposalRow.template_snapshot_json) || {},
      )
    : null;
  const latestApprovedVersionId = proposalRow.latest_approved_version_id
    ? Number(proposalRow.latest_approved_version_id)
    : null;
  const quotationVersionId = Number(proposalRow.quotation_version_id);

  return {
    id: Number(proposalRow.id),
    quotationId: Number(proposalRow.quotation_id),
    quotationVersionId,
    quotationVersionNumber: Number(proposalRow.quotation_version_number || 0),
    quotationVersionStatusCode:
      proposalRow.quotation_version_status_code || null,
    quotationVersionStatusName:
      proposalRow.quotation_version_status_name || null,
    quotationProposalName: proposalRow.quotation_version_proposal_name || "",
    accountId: Number(proposalRow.account_id),
    accountName: proposalRow.account_name || "",
    contactId: Number(proposalRow.contact_id),
    contactName: proposalRow.contact_name || "",
    opportunityId: Number(proposalRow.opportunity_id),
    opportunityName: proposalRow.opportunity_name || "",
    ownerUserId: Number(proposalRow.owner_user_id),
    templateId: proposalRow.template_id
      ? Number(proposalRow.template_id)
      : null,
    templateName: proposalRow.template_name || "",
    templateStatus: proposalRow.template_status || null,
    templateCode: proposalRow.template_code || null,
    templateSnapshot,
    isLegacyTemplate: !proposalRow.template_id,
    title: proposalRow.title || "",
    statusCode: normalizeProposalStatusCode(
      proposalRow.status_code,
      proposalRow.archived_at ? "archived" : "active",
    ),
    createdAt: proposalRow.created_at,
    updatedAt: proposalRow.updated_at,
    archivedAt: proposalRow.archived_at || null,
    content,
    pricingSnapshot,
    latestApprovedVersionId,
    latestApprovedVersionNumber: proposalRow.latest_approved_version_number
      ? Number(proposalRow.latest_approved_version_number)
      : null,
    updateAvailable:
      Boolean(latestApprovedVersionId) &&
      latestApprovedVersionId !== quotationVersionId,
    components: Array.isArray(options.components) ? options.components : [],
  };
}

async function serializeProposalDetail(proposalRow) {
  const components = await listProposalComponents(Number(proposalRow.id));
  return serializeProposalRow(proposalRow, { components });
}

async function refreshProposalLegacyContentFromComponents({
  proposalId,
  proposalTitle,
  userId,
}) {
  const components = await listProposalComponents(Number(proposalId));
  const summary = summarizeProposalComponents(components, proposalTitle);
  const nextContent = sanitizeProposalContent(summary);
  await query(
    `UPDATE proposals
     SET content_json = ?, updated_by_user_id = ?, updated_at = NOW(3)
     WHERE id = ?`,
    [JSON.stringify(nextContent), Number(userId), Number(proposalId)],
  );
  return { components, content: nextContent };
}

function getProposalComponentDefinitionOrNull(componentCode) {
  return (
    PROPOSAL_CONTENT_COMPONENT_DEFINITIONS.find(
      (component) => component.code === componentCode,
    ) || null
  );
}

function normalizeProposalAiText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeProposalAiText(value, maxChars) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function extractJsonObject(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function getOpenAiOutputText(responseData) {
  const output = Array.isArray(responseData?.output) ? responseData.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && part?.text) {
        return String(part.text);
      }
    }
  }
  return "";
}

function buildProposalExecutiveSummaryJobPublicId() {
  return `paj_${randomUUID().replace(/-/g, "")}`;
}

function hashProposalExecutiveSummarySnapshot(snapshot) {
  return createHash("sha256")
    .update(JSON.stringify(snapshot || {}))
    .digest("hex");
}

let ensureProposalExecutiveSummaryGenerationJobSchemaPromise = null;
let proposalExecutiveSummaryWorkerQueued = false;
let proposalExecutiveSummaryWorkerStarted = false;

export async function ensureProposalExecutiveSummaryGenerationJobSchema() {
  if (!ensureProposalExecutiveSummaryGenerationJobSchemaPromise) {
    ensureProposalExecutiveSummaryGenerationJobSchemaPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS proposal_ai_jobs (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          public_id VARCHAR(64) NOT NULL,
          proposal_id BIGINT UNSIGNED NOT NULL,
          component_code VARCHAR(80) NOT NULL,
          job_type VARCHAR(80) NOT NULL,
          requested_by_user_id BIGINT UNSIGNED NOT NULL,
          status ENUM('pending','running','completed','failed','canceled') NOT NULL DEFAULT 'pending',
          request_fingerprint CHAR(64) NOT NULL,
          language_code VARCHAR(10) NOT NULL DEFAULT 'es',
          instructions_text TEXT NULL,
          max_library_assets INT UNSIGNED NOT NULL DEFAULT 4,
          progress_phase VARCHAR(80) NULL,
          progress_label VARCHAR(255) NULL,
          progress_percent INT UNSIGNED NOT NULL DEFAULT 0,
          source_snapshot_json JSON NULL,
          result_json JSON NULL,
          error_code VARCHAR(64) NULL,
          error_message TEXT NULL,
          attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
          lease_token VARCHAR(64) NULL,
          lease_expires_at DATETIME(3) NULL,
          started_at DATETIME(3) NULL,
          finished_at DATETIME(3) NULL,
          expires_at DATETIME(3) NULL,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
          PRIMARY KEY (id),
          UNIQUE KEY uq_proposal_ai_jobs_public_id (public_id),
          KEY idx_proposal_ai_jobs_lookup (proposal_id, component_code, status, created_at),
          KEY idx_proposal_ai_jobs_process (status, lease_expires_at, created_at),
          CONSTRAINT fk_proposal_ai_jobs_proposal
            FOREIGN KEY (proposal_id) REFERENCES proposals(id)
            ON DELETE CASCADE,
          CONSTRAINT fk_proposal_ai_jobs_requested_by
            FOREIGN KEY (requested_by_user_id) REFERENCES users(id)
            ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    })();
  }

  return ensureProposalExecutiveSummaryGenerationJobSchemaPromise;
}

function buildProposalExecutiveSummaryJobResponse(row) {
  if (!row) return null;
  return {
    publicId: row.public_id,
    proposalId: Number(row.proposal_id),
    componentCode: row.component_code,
    jobType: row.job_type,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    updatedAt: row.updated_at,
    requestedBy: {
      userId: Number(row.requested_by_user_id),
    },
    progress: {
      phase:
        row.progress_phase ||
        (row.status === "pending" ? "queued" : row.status),
      label:
        row.progress_label ||
        (row.status === "pending"
          ? "Trabajo en cola"
          : row.status === "running"
            ? "Procesando"
            : row.status === "completed"
              ? "Sugerencia lista"
              : row.status === "canceled"
                ? "Generacion cancelada"
                : "No fue posible generar la sugerencia"),
      percent: Number(row.progress_percent || 0),
    },
    result: safeParseJsonObject(row.result_json) || null,
    error:
      row.error_code || row.error_message
        ? {
            code: row.error_code || "generation_failed",
            message:
              row.error_message ||
              "No fue posible generar la sugerencia del resumen ejecutivo",
            retryable: row.status !== "canceled",
          }
        : null,
  };
}

async function getProposalExecutiveSummaryGenerationJob({
  publicId,
  proposalId,
}) {
  const rows = await query(
    `SELECT *
     FROM proposal_ai_jobs
     WHERE public_id = ?
       AND proposal_id = ?
       AND component_code = ?
       AND job_type = ?
     LIMIT 1`,
    [
      publicId,
      Number(proposalId),
      PROPOSAL_EXEC_SUMMARY_JOB_COMPONENT_CODE,
      PROPOSAL_EXEC_SUMMARY_JOB_TYPE,
    ],
  );
  return rows.length ? buildProposalExecutiveSummaryJobResponse(rows[0]) : null;
}

async function getLatestProposalExecutiveSummaryGenerationJob({ proposalId }) {
  const rows = await query(
    `SELECT *
     FROM proposal_ai_jobs
     WHERE proposal_id = ?
       AND component_code = ?
       AND job_type = ?
     ORDER BY id DESC
     LIMIT 1`,
    [
      Number(proposalId),
      PROPOSAL_EXEC_SUMMARY_JOB_COMPONENT_CODE,
      PROPOSAL_EXEC_SUMMARY_JOB_TYPE,
    ],
  );
  return rows.length ? buildProposalExecutiveSummaryJobResponse(rows[0]) : null;
}

function buildProposalExecutiveSummaryFingerprintSnapshot({
  proposal,
  component,
  instructions,
  languageCode,
  maxLibraryAssets,
}) {
  return {
    proposalId: Number(proposal?.id || 0),
    proposalUpdatedAt: proposal?.updated_at || null,
    quotationVersionId: Number(proposal?.quotation_version_id || 0),
    componentCode: PROPOSAL_EXEC_SUMMARY_JOB_COMPONENT_CODE,
    componentTitle: component?.title || "",
    componentBlocks: Array.isArray(component?.blocks)
      ? component.blocks.map((block) => ({
          type: block.type || "paragraph",
          text: block.text || "",
          items: Array.isArray(block.items) ? block.items : [],
        }))
      : [],
    instructions: String(instructions || "").trim(),
    languageCode: String(languageCode || "es")
      .trim()
      .toLowerCase(),
    maxLibraryAssets: Number(maxLibraryAssets || 0),
  };
}

async function createOrReuseProposalExecutiveSummaryGenerationJob({
  proposal,
  requestedByUserId,
  instructions,
  languageCode,
  maxLibraryAssets,
}) {
  const proposalDetail = await serializeProposalDetail(proposal);
  const component = Array.isArray(proposalDetail.components)
    ? proposalDetail.components.find(
        (entry) =>
          entry.componentCode === PROPOSAL_EXEC_SUMMARY_JOB_COMPONENT_CODE,
      )
    : null;

  if (!component) {
    const error = new Error("Componente no encontrado");
    error.status = 422;
    error.body = {
      message: "La propuesta no tiene el componente Resumen ejecutivo",
      error: { code: "unsupported_component", retryable: false },
    };
    throw error;
  }

  const snapshot = buildProposalExecutiveSummaryFingerprintSnapshot({
    proposal,
    component,
    instructions,
    languageCode,
    maxLibraryAssets,
  });
  const fingerprint = hashProposalExecutiveSummarySnapshot(snapshot);

  const reusableRows = await query(
    `SELECT *
     FROM proposal_ai_jobs
     WHERE proposal_id = ?
       AND component_code = ?
       AND job_type = ?
       AND status IN ('pending', 'running')
     ORDER BY id DESC
     LIMIT 1`,
    [
      Number(proposal.id),
      PROPOSAL_EXEC_SUMMARY_JOB_COMPONENT_CODE,
      PROPOSAL_EXEC_SUMMARY_JOB_TYPE,
    ],
  );

  if (reusableRows.length) {
    return {
      wasReused: true,
      response: buildProposalExecutiveSummaryJobResponse(reusableRows[0]),
    };
  }

  const publicId = buildProposalExecutiveSummaryJobPublicId();
  await query(
    `INSERT INTO proposal_ai_jobs (
       public_id, proposal_id, component_code, job_type,
       requested_by_user_id, status, request_fingerprint,
       language_code, instructions_text, max_library_assets,
       progress_phase, progress_label, progress_percent,
       source_snapshot_json
     ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, 'queued', 'Trabajo en cola', 0, ?)`,
    [
      publicId,
      Number(proposal.id),
      PROPOSAL_EXEC_SUMMARY_JOB_COMPONENT_CODE,
      PROPOSAL_EXEC_SUMMARY_JOB_TYPE,
      Number(requestedByUserId),
      fingerprint,
      String(languageCode || "es")
        .trim()
        .toLowerCase() || "es",
      String(instructions || "").trim() || null,
      Math.min(
        PROPOSAL_EXEC_SUMMARY_MAX_LIBRARY_ASSETS,
        Number(maxLibraryAssets || PROPOSAL_EXEC_SUMMARY_MAX_LIBRARY_ASSETS),
      ),
      JSON.stringify(snapshot),
    ],
  );

  const rows = await query(
    `SELECT *
     FROM proposal_ai_jobs
     WHERE public_id = ?
     LIMIT 1`,
    [publicId],
  );

  return {
    wasReused: false,
    response: buildProposalExecutiveSummaryJobResponse(rows[0]),
  };
}

async function updateProposalExecutiveSummaryJobProgress({
  jobId,
  leaseToken,
  phase,
  label,
  percent,
}) {
  await query(
    `UPDATE proposal_ai_jobs
     SET progress_phase = ?,
         progress_label = ?,
         progress_percent = ?,
         updated_at = NOW(3)
     WHERE id = ?
       AND lease_token = ?`,
    [phase, label, Number(percent || 0), Number(jobId), leaseToken],
  );
}

async function claimNextPendingProposalExecutiveSummaryGenerationJob() {
  const candidates = await query(
    `SELECT id
     FROM proposal_ai_jobs
     WHERE component_code = ?
       AND job_type = ?
       AND (
         status = 'pending'
         OR (
           status = 'running'
           AND lease_expires_at IS NOT NULL
           AND lease_expires_at <= NOW(3)
         )
       )
       AND (expires_at IS NULL OR expires_at > NOW(3))
     ORDER BY created_at ASC, id ASC
     LIMIT 20`,
    [PROPOSAL_EXEC_SUMMARY_JOB_COMPONENT_CODE, PROPOSAL_EXEC_SUMMARY_JOB_TYPE],
  );

  for (const candidate of candidates) {
    const leaseToken = randomUUID().replace(/-/g, "");
    const row = await withTransaction(async (conn) => {
      const [updateResult] = await conn.query(
        `UPDATE proposal_ai_jobs
         SET status = 'running',
             attempt_count = attempt_count + 1,
             lease_token = ?,
             lease_expires_at = DATE_ADD(NOW(3), INTERVAL ? SECOND),
             started_at = COALESCE(started_at, NOW(3)),
             progress_phase = 'loading_proposal_context',
             progress_label = 'Cargando contexto de la propuesta',
             progress_percent = 10,
             updated_at = NOW(3)
         WHERE id = ?
           AND (
             status = 'pending'
             OR (
               status = 'running'
               AND lease_expires_at IS NOT NULL
               AND lease_expires_at <= NOW(3)
             )
           )`,
        [
          leaseToken,
          PROPOSAL_EXEC_SUMMARY_JOB_LEASE_SECONDS,
          Number(candidate.id),
        ],
      );
      if (!updateResult.affectedRows) {
        return null;
      }
      const [rows] = await conn.query(
        `SELECT * FROM proposal_ai_jobs WHERE id = ? LIMIT 1`,
        [Number(candidate.id)],
      );
      return rows[0] || null;
    });

    if (row) {
      return row;
    }
  }

  return null;
}

async function finalizeProposalExecutiveSummaryGenerationJob({
  jobId,
  leaseToken,
  status,
  result,
  errorCode,
  errorMessage,
}) {
  await query(
    `UPDATE proposal_ai_jobs
     SET status = ?,
         result_json = ?,
         error_code = ?,
         error_message = ?,
         progress_phase = ?,
         progress_label = ?,
         progress_percent = ?,
         finished_at = NOW(3),
         expires_at = DATE_ADD(NOW(3), INTERVAL ? MINUTE),
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = NOW(3)
     WHERE id = ?
       AND lease_token = ?`,
    [
      status,
      result ? JSON.stringify(result) : null,
      errorCode || null,
      errorMessage || null,
      status === "completed" ? "completed" : "failed",
      status === "completed"
        ? "Sugerencia lista"
        : status === "canceled"
          ? "Generacion cancelada"
          : "No fue posible generar la sugerencia",
      100,
      PROPOSAL_EXEC_SUMMARY_JOB_RESULT_TTL_MINUTES,
      Number(jobId),
      leaseToken,
    ],
  );
}

async function getProposalOpportunityContext(opportunityId) {
  const rows = await query(
    `SELECT o.id, o.name, o.account_id, o.contact_id,
            oss.code AS sales_stage_code, oss.name AS sales_stage_name,
            oas.code AS activation_status_code, oas.name AS activation_status_name
     FROM opportunities o
     LEFT JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
     LEFT JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
     WHERE o.id = ?
     LIMIT 1`,
    [Number(opportunityId)],
  );
  return rows[0] || null;
}

async function listLatestOpportunityAnswersForProposalContext(opportunityId) {
  return query(
    `SELECT a.id,
            a.sales_stage_id,
            a.question_id,
            a.answer_value,
            a.answered_at,
            oss.code AS sales_stage_code,
            oss.name AS sales_stage_name,
            oss.stage_order,
            q.code AS question_code,
            q.prompt,
            q.display_order
     FROM opportunity_stage_question_answers a
     INNER JOIN (
       SELECT MAX(id) AS id
       FROM opportunity_stage_question_answers
       WHERE opportunity_id = ?
       GROUP BY sales_stage_id, question_id
     ) latest_answers ON latest_answers.id = a.id
     INNER JOIN opportunity_sales_stages oss ON oss.id = a.sales_stage_id
     INNER JOIN opportunity_stage_questions q ON q.id = a.question_id
     ORDER BY oss.stage_order ASC, q.display_order ASC, a.id ASC`,
    [Number(opportunityId)],
  );
}

function pickMatchingCatalogCodes(text, entries, minimumTokenSize = 1) {
  const normalizedSource = ` ${normalizeProposalAiText(text)} `;
  if (!normalizedSource.trim()) return [];
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => {
      const tokens = normalizeProposalAiText(
        [entry?.code, entry?.name].filter(Boolean).join(" "),
      )
        .split(" ")
        .filter((token) => token.length >= minimumTokenSize);
      return tokens.some((token) => normalizedSource.includes(` ${token} `));
    })
    .map((entry) => String(entry.code || "").trim())
    .filter(Boolean);
}

function buildExecutiveSummarySourceText({
  proposal,
  currentComponent,
  opportunity,
  answers,
  documents,
  quotationSections,
}) {
  return [
    proposal?.title,
    proposal?.opportunity_name,
    opportunity?.sales_stage_name,
    currentComponent?.title,
    ...(Array.isArray(currentComponent?.blocks)
      ? currentComponent.blocks.flatMap((block) => [
          block.text,
          ...(block.items || []),
        ])
      : []),
    ...(Array.isArray(answers)
      ? answers.flatMap((answer) => [answer.prompt, answer.answer_value])
      : []),
    ...(Array.isArray(documents)
      ? documents.flatMap((document) => [
          document.originalFileName,
          document.contentSummary,
          document.transcriptText,
          document.rawText,
          document.normalizedText,
        ])
      : []),
    ...(Array.isArray(quotationSections)
      ? quotationSections.flatMap((section) => [
          section.title,
          ...(Array.isArray(section.items)
            ? section.items.flatMap((item) => [
                item.productCode,
                item.productDescription,
              ])
            : []),
        ])
      : []),
  ]
    .filter(Boolean)
    .join(" ");
}

function scoreLibraryAssetForProposalContext(item, context) {
  let score = 0;
  const reasons = [];
  const catalogs = Array.isArray(item?.catalogs) ? item.catalogs : [];
  const tags = Array.isArray(item?.tags) ? item.tags : [];
  const hasCatalogMatch = (type, codes) =>
    codes.some((code) =>
      catalogs.some(
        (catalog) =>
          catalog.catalogType === type && String(catalog.code) === String(code),
      ),
    );
  const hasTagMatch = (group, codes) =>
    codes.some((code) =>
      tags.some(
        (tag) => tag.tagGroup === group && String(tag.code) === String(code),
      ),
    );

  if (hasCatalogMatch("manufacturer", context.manufacturerCodes)) {
    score += 5;
    reasons.push("manufacturer");
  }
  if (hasCatalogMatch("solution", context.solutionCodes)) {
    score += 5;
    reasons.push("solution");
  }
  if (hasCatalogMatch("industry", context.industryCodes)) {
    score += 3;
    reasons.push("industry");
  }
  if (hasTagMatch("stage", context.stageCodes)) {
    score += 2;
    reasons.push("stage");
  }

  const searchText = normalizeProposalAiText(
    [item?.title, item?.summary, item?.searchText].filter(Boolean).join(" "),
  );
  if (
    context.opportunityNameNormalized &&
    searchText.includes(context.opportunityNameNormalized)
  ) {
    score += 1;
    reasons.push("text");
  }

  return { score, reasons: Array.from(new Set(reasons)) };
}

async function buildProposalExecutiveSummaryGenerationContext({
  proposal,
  user,
  instructions,
  languageCode,
  maxLibraryAssets,
}) {
  const proposalDetail = await serializeProposalDetail(proposal);
  const currentComponent = Array.isArray(proposalDetail.components)
    ? proposalDetail.components.find(
        (component) =>
          component.componentCode === PROPOSAL_EXEC_SUMMARY_JOB_COMPONENT_CODE,
      )
    : null;

  const [opportunity, answers, documents, quotationSections, catalogs] =
    await Promise.all([
      getProposalOpportunityContext(Number(proposal.opportunity_id)),
      listLatestOpportunityAnswersForProposalContext(
        Number(proposal.opportunity_id),
      ),
      listOpportunityDocuments({
        opportunityId: Number(proposal.opportunity_id),
      }).catch(() => []),
      getQuotationVersionSections(Number(proposal.quotation_version_id)),
      getCommercialEnablementCatalogs(),
    ]);

  const sourceText = buildExecutiveSummarySourceText({
    proposal,
    currentComponent,
    opportunity,
    answers,
    documents,
    quotationSections,
  });

  const manufacturerCodes = pickMatchingCatalogCodes(
    sourceText,
    catalogs?.manufacturer,
  );
  const solutionCodes = pickMatchingCatalogCodes(
    sourceText,
    catalogs?.solution,
  );
  const industryCodes = pickMatchingCatalogCodes(
    sourceText,
    catalogs?.industry,
    2,
  );
  const stageCodes = [
    String(opportunity?.sales_stage_code || "").trim(),
  ].filter(Boolean);

  const libraryAssetsResponse = await listCommercialEnablementAssets({
    user,
    filters: {
      status: "published",
      onlyClientSafe: "true",
    },
  }).catch(() => null);

  const libraryAssets = Array.isArray(libraryAssetsResponse?.items)
    ? libraryAssetsResponse.items
    : [];

  const scoredAssets = libraryAssets
    .map((item) => {
      const scored = scoreLibraryAssetForProposalContext(item, {
        manufacturerCodes,
        solutionCodes,
        industryCodes,
        stageCodes,
        opportunityNameNormalized: normalizeProposalAiText(
          opportunity?.name || proposal.opportunity_name || "",
        ),
      });
      return {
        item,
        score: scored.score,
        reasons: scored.reasons,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.item.usageCount - left.item.usageCount ||
        String(left.item.title).localeCompare(String(right.item.title), "es"),
    );

  const matchedAssets = scoredAssets
    .slice(
      0,
      Math.min(PROPOSAL_EXEC_SUMMARY_MAX_LIBRARY_ASSETS, maxLibraryAssets),
    )
    .map((entry) => ({
      assetPublicId: entry.item.publicId,
      title: entry.item.title,
      summary: summarizeProposalAiText(
        entry.item.summary,
        PROPOSAL_EXEC_SUMMARY_MAX_LIBRARY_SUMMARY_CHARS,
      ),
      assetTypeCode: entry.item.assetTypeCode,
      matchScore: entry.score,
      matchReasons: entry.reasons,
      manufacturerCodes: entry.item.catalogs
        .filter((catalog) => catalog.catalogType === "manufacturer")
        .map((catalog) => catalog.code),
      solutionCodes: entry.item.catalogs
        .filter((catalog) => catalog.catalogType === "solution")
        .map((catalog) => catalog.code),
      industryCodes: entry.item.catalogs
        .filter((catalog) => catalog.catalogType === "industry")
        .map((catalog) => catalog.code),
      stageCodes: entry.item.tags
        .filter((tag) => tag.tagGroup === "stage")
        .map((tag) => tag.code),
    }));

  return {
    proposal: {
      id: Number(proposal.id),
      title: proposal.title || "",
      quotationVersionId: Number(proposal.quotation_version_id),
      opportunityId: Number(proposal.opportunity_id),
      currentComponentDraft: {
        title: currentComponent?.title || "Resumen ejecutivo",
        blocks: Array.isArray(currentComponent?.blocks)
          ? currentComponent.blocks.map((block) => ({
              type: block.type || "paragraph",
              text: block.text || "",
              items: Array.isArray(block.items) ? block.items : [],
            }))
          : [],
      },
      template: {
        id: proposal.template_id ? Number(proposal.template_id) : null,
        code: proposal.template_code || null,
        name: proposal.template_name || "",
      },
    },
    opportunity: {
      id: Number(opportunity?.id || proposal.opportunity_id),
      name: opportunity?.name || proposal.opportunity_name || "",
      accountId: Number(opportunity?.account_id || proposal.account_id),
      accountName: proposal.account_name || "",
      contactId: Number(opportunity?.contact_id || proposal.contact_id),
      contactName: proposal.contact_name || "",
      salesStage: {
        code: opportunity?.sales_stage_code || "",
        name: opportunity?.sales_stage_name || "",
      },
      activationStatus: {
        code: opportunity?.activation_status_code || "",
        name: opportunity?.activation_status_name || "",
      },
      answers: (Array.isArray(answers) ? answers : [])
        .filter((answer) => String(answer.answer_value || "").trim())
        .slice(0, PROPOSAL_EXEC_SUMMARY_MAX_ANSWERS)
        .map((answer) => ({
          questionId: Number(answer.question_id),
          questionLabel: answer.prompt || answer.question_code || "",
          salesStageCode: answer.sales_stage_code || "",
          salesStageName: answer.sales_stage_name || "",
          answerText: summarizeProposalAiText(answer.answer_value, 1200),
        })),
      documents: (Array.isArray(documents) ? documents : [])
        .slice(0, PROPOSAL_EXEC_SUMMARY_MAX_DOCUMENTS)
        .map((document) => ({
          documentPublicId: document.publicId,
          fileName: document.originalFileName,
          mimeType: document.mimeType,
          previewText: summarizeProposalAiText(
            document.contentSummary ||
              document.transcriptText ||
              document.normalizedText ||
              document.rawText,
            PROPOSAL_EXEC_SUMMARY_MAX_DOCUMENT_TEXT_CHARS,
          ),
          linkedSalesStages: Array.isArray(document.stageSuggestions)
            ? document.stageSuggestions
                .map((entry) => entry.salesStageCode || entry.code || "")
                .filter(Boolean)
            : [],
        })),
      metadata: {
        manufacturerCodes,
        solutionCodes,
        industryCodes,
        stageCodes,
      },
    },
    quotation: {
      quotationId: Number(proposal.quotation_id),
      quotationVersionId: Number(proposal.quotation_version_id),
      versionNumber: Number(proposal.quotation_version_number || 0),
      statusCode: proposal.quotation_version_status_code || "",
      proposalName: proposal.quotation_version_proposal_name || "",
      summary: {
        subtotal: Number(
          proposalDetail.pricingSnapshot?.summary?.subtotal || 0,
        ),
        total: Number(proposalDetail.pricingSnapshot?.summary?.total || 0),
        currencyCode:
          proposalDetail.pricingSnapshot?.summary?.currencyCode || "USD",
      },
      sections: (Array.isArray(quotationSections) ? quotationSections : []).map(
        (section) => ({
          title: section.title || "",
          items: (Array.isArray(section.items) ? section.items : [])
            .slice(0, PROPOSAL_EXEC_SUMMARY_MAX_SECTION_ITEMS)
            .map((item) => ({
              productCode: item.productCode || "",
              productDescription: item.productDescription || "",
              quantity: Number(item.quantity || 0),
              salePriceTotal: Number(item.salePriceTotal || 0),
            })),
        }),
      ),
    },
    libraryContext: {
      filtersApplied: {
        status: "published",
        visibilityLevel: "client_safe",
        manufacturerCodes,
        solutionCodes,
        industryCodes,
        stageCodes,
      },
      matchedAssets,
      limit: Math.min(
        PROPOSAL_EXEC_SUMMARY_MAX_LIBRARY_ASSETS,
        Number(maxLibraryAssets || PROPOSAL_EXEC_SUMMARY_MAX_LIBRARY_ASSETS),
      ),
    },
    generationPolicy: {
      languageCode:
        String(languageCode || "es")
          .trim()
          .toLowerCase() || "es",
      mode: "parallel",
      maxLibraryAssets: Math.min(
        PROPOSAL_EXEC_SUMMARY_MAX_LIBRARY_ASSETS,
        Number(maxLibraryAssets || PROPOSAL_EXEC_SUMMARY_MAX_LIBRARY_ASSETS),
      ),
      allowOverwrite: false,
      targetAudience: "client",
      instructions: String(instructions || "").trim(),
    },
  };
}

async function requestProposalExecutiveSummarySuggestion(context) {
  if (!config.openai.apiKey) {
    const error = new Error(
      "La generacion asistida no esta disponible en este momento",
    );
    error.code = "ai_generation_disabled";
    throw error;
  }

  const payload = {
    model: config.openai.model,
    input: [
      {
        role: "system",
        content:
          "Redacta un resumen ejecutivo comercial en espanol para una propuesta B2B. Responde exclusivamente con JSON valido. No inventes capacidades, entregables ni promesas que no esten sustentadas por el contexto. Prioriza continuidad operativa, objetivos del cliente, alcance comercial y valor de negocio. La salida debe tener title, paragraphs y warnings. paragraphs debe ser un arreglo de 1 a 3 parrafos en espanol, sin markdown.",
      },
      {
        role: "user",
        content: JSON.stringify({
          context,
          expectedShape: {
            title: "Resumen ejecutivo sugerido",
            paragraphs: ["string"],
            warnings: ["string"],
          },
        }),
      },
    ],
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    PROPOSAL_EXEC_SUMMARY_OPENAI_TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      `${config.openai.baseUrl.replace(/\/$/, "")}/responses`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.openai.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
    }

    const responseData = await response.json();
    const parsed = extractJsonObject(getOpenAiOutputText(responseData));
    if (!parsed) {
      throw new Error("OpenAI request failed: invalid JSON response");
    }

    const paragraphs = Array.isArray(parsed.paragraphs)
      ? parsed.paragraphs
          .map((value) => summarizeProposalAiText(value, 2400))
          .filter(Boolean)
      : [];
    if (!paragraphs.length) {
      throw new Error(
        "OpenAI request failed: empty executive summary suggestion",
      );
    }

    return {
      suggestion: {
        mode: "parallel",
        componentCode: PROPOSAL_EXEC_SUMMARY_JOB_COMPONENT_CODE,
        title:
          summarizeProposalAiText(
            parsed.title || "Resumen ejecutivo sugerido",
            180,
          ) || "Resumen ejecutivo sugerido",
        blocks: paragraphs.map((text) => ({ type: "paragraph", text })),
        plainText: paragraphs.join("\n\n"),
        suggestionMetadata: {
          tone: "executive_commercial",
          languageCode:
            String(context?.generationPolicy?.languageCode || "es").trim() ||
            "es",
          generatedAt: new Date().toISOString(),
        },
      },
      sourceSummary: {
        opportunityAnswersUsed: Array.isArray(context?.opportunity?.answers)
          ? context.opportunity.answers.length
          : 0,
        opportunityDocumentsUsed: Array.isArray(context?.opportunity?.documents)
          ? context.opportunity.documents.length
          : 0,
        quotationSectionsUsed: Array.isArray(context?.quotation?.sections)
          ? context.quotation.sections.length
          : 0,
        libraryAssetsUsed: Array.isArray(context?.libraryContext?.matchedAssets)
          ? context.libraryContext.matchedAssets.length
          : 0,
      },
      sources: {
        proposal: {
          proposalId: Number(context?.proposal?.id || 0),
          quotationVersionId: Number(
            context?.proposal?.quotationVersionId || 0,
          ),
          opportunityId: Number(context?.proposal?.opportunityId || 0),
        },
        opportunityAnswers: (context?.opportunity?.answers || []).map(
          (answer) => ({
            questionId: Number(answer.questionId || 0),
            questionLabel: answer.questionLabel || "",
            used: true,
          }),
        ),
        opportunityDocuments: (context?.opportunity?.documents || []).map(
          (document) => ({
            documentPublicId: document.documentPublicId,
            fileName: document.fileName,
          }),
        ),
        libraryAssets: (context?.libraryContext?.matchedAssets || []).map(
          (asset) => ({
            assetPublicId: asset.assetPublicId,
            title: asset.title,
            matchReasons: Array.isArray(asset.matchReasons)
              ? asset.matchReasons
              : [],
          }),
        ),
      },
      warnings: Array.isArray(parsed.warnings)
        ? parsed.warnings.map((message) => ({
            code: "model_warning",
            message: summarizeProposalAiText(message, 500),
          }))
        : [],
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function processProposalExecutiveSummaryGenerationJob(row) {
  try {
    const user = await getUserAuthContext(Number(row.requested_by_user_id));
    if (!user) {
      await finalizeProposalExecutiveSummaryGenerationJob({
        jobId: Number(row.id),
        leaseToken: row.lease_token,
        status: "failed",
        errorCode: "requester_not_found",
        errorMessage: "No fue posible resolver el usuario solicitante del job",
      });
      return;
    }

    const proposal = await getAccessibleProposal({
      user,
      proposalId: Number(row.proposal_id),
    });
    if (!proposal) {
      await finalizeProposalExecutiveSummaryGenerationJob({
        jobId: Number(row.id),
        leaseToken: row.lease_token,
        status: "failed",
        errorCode: "proposal_not_found",
        errorMessage: "Propuesta no encontrada",
      });
      return;
    }

    const snapshot = safeParseJsonObject(row.source_snapshot_json) || {};
    const proposalDetail = await serializeProposalDetail(proposal);
    const currentComponent = Array.isArray(proposalDetail.components)
      ? proposalDetail.components.find(
          (component) =>
            component.componentCode ===
            PROPOSAL_EXEC_SUMMARY_JOB_COMPONENT_CODE,
        )
      : null;
    const currentFingerprint = hashProposalExecutiveSummarySnapshot(
      buildProposalExecutiveSummaryFingerprintSnapshot({
        proposal,
        component: currentComponent,
        instructions: row.instructions_text,
        languageCode: row.language_code,
        maxLibraryAssets: row.max_library_assets,
      }),
    );

    if (
      snapshot?.proposalId &&
      currentFingerprint !== row.request_fingerprint
    ) {
      await finalizeProposalExecutiveSummaryGenerationJob({
        jobId: Number(row.id),
        leaseToken: row.lease_token,
        status: "failed",
        errorCode: "stale_snapshot",
        errorMessage:
          "La propuesta cambio antes de completar la generacion. Vuelve a solicitar la sugerencia.",
      });
      return;
    }

    await updateProposalExecutiveSummaryJobProgress({
      jobId: Number(row.id),
      leaseToken: row.lease_token,
      phase: "loading_opportunity_context",
      label: "Cargando contexto de la oportunidad",
      percent: 25,
    });

    const context = await buildProposalExecutiveSummaryGenerationContext({
      proposal,
      user,
      instructions: row.instructions_text,
      languageCode: row.language_code,
      maxLibraryAssets: row.max_library_assets,
    });

    await updateProposalExecutiveSummaryJobProgress({
      jobId: Number(row.id),
      leaseToken: row.lease_token,
      phase: "generating_text",
      label: "La IA esta redactando el resumen ejecutivo",
      percent: 80,
    });

    const result = await requestProposalExecutiveSummarySuggestion(context);
    if (
      Array.isArray(context?.libraryContext?.matchedAssets) &&
      context.libraryContext.matchedAssets.length >= row.max_library_assets
    ) {
      result.warnings = [
        ...(Array.isArray(result.warnings) ? result.warnings : []),
        {
          code: "library_assets_truncated",
          message: `Se limitaron los activos relacionados a ${row.max_library_assets} elementos.`,
        },
      ];
    }

    await finalizeProposalExecutiveSummaryGenerationJob({
      jobId: Number(row.id),
      leaseToken: row.lease_token,
      status: "completed",
      result,
    });
  } catch (error) {
    await finalizeProposalExecutiveSummaryGenerationJob({
      jobId: Number(row.id),
      leaseToken: row.lease_token,
      status: "failed",
      errorCode: error?.code || "ai_generation_failed",
      errorMessage:
        String(error?.message || "").trim() ||
        "No fue posible generar el resumen ejecutivo con IA.",
    });
  }
}

export function queueProposalExecutiveSummaryGenerationProcessing() {
  proposalExecutiveSummaryWorkerQueued = true;
}

export async function processPendingProposalExecutiveSummaryGenerationJobs({
  limit = 1,
} = {}) {
  let processed = 0;
  while (processed < limit) {
    const row = await claimNextPendingProposalExecutiveSummaryGenerationJob();
    if (!row) break;
    processed += 1;
    await processProposalExecutiveSummaryGenerationJob(row);
  }
  return processed;
}

export async function startProposalExecutiveSummaryGenerationWorker() {
  if (proposalExecutiveSummaryWorkerStarted) {
    return;
  }
  proposalExecutiveSummaryWorkerStarted = true;

  const tick = async () => {
    const shouldDrainQueue = proposalExecutiveSummaryWorkerQueued;
    proposalExecutiveSummaryWorkerQueued = false;
    try {
      const processed =
        await processPendingProposalExecutiveSummaryGenerationJobs({
          limit: shouldDrainQueue ? 3 : 1,
        });
      if (processed > 0) {
        proposalExecutiveSummaryWorkerQueued = true;
      }
    } catch (error) {
      console.error(
        "Proposal executive summary generation worker error:",
        error?.message || error,
      );
    }
  };

  const interval = setInterval(() => {
    tick();
  }, PROPOSAL_EXEC_SUMMARY_JOB_POLL_INTERVAL_MS);
  interval.unref?.();

  queueProposalExecutiveSummaryGenerationProcessing();
  await tick();
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
              CONCAT(c.first_name, ' ', c.last_name) AS full_name,
              c.email,
              COALESCE(NULLIF(TRIM(c.phone), ''), NULLIF(TRIM(c.mobile), '')) AS phone
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
        email: row.email || "",
        phone: row.phone || "",
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
              CONCAT(c.first_name, ' ', c.last_name) AS full_name,
              c.email,
              COALESCE(NULLIF(TRIM(c.phone), ''), NULLIF(TRIM(c.mobile), '')) AS phone
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
        email: row.email || "",
        phone: row.phone || "",
      })),
    );
  },
);

router.get(
  "/quotation-product-lists",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;

    const parsed = quotationProductListsQuerySchema.safeParse(req.query || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Proveedor invalido",
        errors: parsed.error.flatten(),
      });
    }

    const lists = await getActiveQuotationProductLists(parsed.data.providerId);
    return res.json(
      lists.map((row) => ({
        id: Number(row.id),
        providerId: Number(row.provider_id),
        providerName: row.provider_name || "",
        name: row.name || "",
        itemType: row.item_type || "",
        currencyId: Number(row.currency_id),
        currencyCode: row.currency_code || "",
        currencyName: row.currency_name || "",
        currencySymbol: row.currency_symbol || "",
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
    const priceListId = Number(req.query.priceListId || 0);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
    const rows = await getQuotationProductRows({
      providerId,
      priceListId,
      searchQuery,
      limit,
    });

    const componentMap = await getQuotationProductComponents(
      rows
        .filter((row) => String(row.item_type) === "grupo_productos")
        .map((row) => Number(row.id)),
    );

    return res.json(
      rows.map((row) => mapQuotationProductRow(row, componentMap)),
    );
  },
);

router.post(
  "/quotation-products",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    if (!hasProviderPriceCreatePermission(req.user)) {
      return res
        .status(403)
        .json({ message: "No autorizado para crear productos" });
    }

    const parsed = quotationQuickCreateProductSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const activeList = await getActiveQuotationProductList({
      providerId: parsed.data.providerId,
      listId: parsed.data.priceListId,
    });
    if (!activeList) {
      return res.status(404).json({ message: "Lista activa no encontrada" });
    }
    if (String(activeList.item_type) === "grupo_productos") {
      return res.status(409).json({
        message: "Desde este modal no se pueden crear bundles",
      });
    }

    await ensureProductTypesCatalog();
    const productTypeId = await getProductTypeIdByCode(activeList.item_type);
    const productType = await getProductTypeByCode(activeList.item_type);
    const activeStatusId = await getProviderPriceItemActiveStatusId();
    if (
      !productTypeId ||
      !productType ||
      Number(productType.is_active) !== 1 ||
      !activeStatusId
    ) {
      return res.status(400).json({
        message: "No fue posible resolver la configuracion de la lista",
      });
    }

    const now = new Date();
    let createdId = null;
    try {
      const insertResult = await query(
        `INSERT INTO provider_price_list_items
          (provider_id, price_list_id, code, description, product_type_id, item_type, price, currency_id, activation_status_id,
           created_by, created_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          Number(parsed.data.providerId),
          Number(parsed.data.priceListId),
          parsed.data.code,
          parsed.data.description || null,
          Number(productTypeId),
          activeList.item_type,
          Number(parsed.data.price),
          Number(activeList.currency_id),
          Number(activeStatusId),
          Number(req.user.id),
          now,
          Number(req.user.id),
          now,
        ],
      );
      createdId = Number(insertResult.insertId);
    } catch (error) {
      if (
        isUniqueViolation(
          error,
          "uq_provider_price_list_items_provider_code",
        ) ||
        isUniqueViolation(error, "uq_provider_price_list_items_list_code")
      ) {
        return res.status(409).json({
          message: "Ya existe un producto con ese codigo en la lista",
        });
      }
      throw error;
    }

    await logAuditEvent({
      req,
      module: "cotizaciones",
      action: "quotation_product_created",
      entityType: "provider_price_list_item",
      entityId: createdId,
      detail: "Producto creado desde el selector de cotizaciones",
      after: {
        provider_id: Number(parsed.data.providerId),
        price_list_id: Number(parsed.data.priceListId),
        code: parsed.data.code,
        description: parsed.data.description || null,
        item_type: activeList.item_type,
        currency_id: Number(activeList.currency_id),
        activation_status_code: "activo",
      },
    });

    const rows = await getQuotationProductRows({
      providerId: parsed.data.providerId,
      priceListId: parsed.data.priceListId,
      searchQuery: parsed.data.code,
      limit: 5,
    });
    const createdRow = rows.find((row) => Number(row.id) === Number(createdId));

    return res.status(201).json({
      message: "Producto creado correctamente",
      product: createdRow ? mapQuotationProductRow(createdRow) : null,
    });
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
        su.email AS seller_user_email,
        su.mobile AS seller_user_phone,
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
        sellerUserEmail: row.seller_user_email || "",
        sellerUserPhone: row.seller_user_phone || "",
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
        su.email AS seller_user_email,
        su.mobile AS seller_user_phone,
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
        sellerUserEmail: row.seller_user_email || "",
        sellerUserPhone: row.seller_user_phone || "",
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
          quotationCurrencyCode: parsed.data.currencyCode || "USD",
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
        proposalId: version.proposal_id ? Number(version.proposal_id) : null,
        hasProposal: Boolean(version.proposal_id),
        proposalStatusCode: version.proposal_status_code
          ? normalizeProposalStatusCode(version.proposal_status_code)
          : null,
        createdAt: version.created_at,
        updatedAt: version.updated_at,
      })),
    });
  },
);

router.get(
  "/proposal-templates",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    const templates = await getAvailableProposalTemplates();
    return res.json(templates);
  },
);

router.get(
  "/proposal-assets",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    const assets = await listInstitutionalAssets({ status: "active" });
    return res.json({ items: assets });
  },
);

router.get(
  "/proposals",
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
      `SELECT p.*, a.name AS account_name,
              o.name AS opportunity_name,
              CONCAT(c.first_name, ' ', c.last_name) AS contact_name,
              pt.name AS template_name,
              pt.status AS template_status,
              pt.code AS template_code,
              qv.version_number AS quotation_version_number,
              qv.proposal_name AS quotation_version_proposal_name,
              qvs.code AS quotation_version_status_code,
              qvs.name AS quotation_version_status_name,
              (
                SELECT qv2.id
                FROM quotation_versions qv2
                INNER JOIN quotation_statuses qs2 ON qs2.id = qv2.status_id
                WHERE qv2.quotation_id = q.id
                  AND qs2.code = 'aprobada'
                ORDER BY qv2.version_number DESC, qv2.id DESC
                LIMIT 1
              ) AS latest_approved_version_id,
              (
                SELECT qv2.version_number
                FROM quotation_versions qv2
                INNER JOIN quotation_statuses qs2 ON qs2.id = qv2.status_id
                WHERE qv2.quotation_id = q.id
                  AND qs2.code = 'aprobada'
                ORDER BY qv2.version_number DESC, qv2.id DESC
                LIMIT 1
              ) AS latest_approved_version_number
       FROM proposals p
       INNER JOIN quotations q ON q.id = p.quotation_id
       INNER JOIN quotation_versions qv ON qv.id = p.quotation_version_id
       INNER JOIN quotation_statuses qvs ON qvs.id = qv.status_id
       INNER JOIN opportunities o ON o.id = p.opportunity_id
       ${ownershipJoin}
       INNER JOIN accounts a ON a.id = p.account_id
       INNER JOIN contacts c ON c.id = p.contact_id
       LEFT JOIN proposal_templates pt ON pt.id = p.template_id
       ORDER BY p.updated_at DESC, p.id DESC`,
      params,
    );

    return res.json(rows.map(serializeProposalRow));
  },
);

router.get(
  "/proposals/:proposalId",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    const proposalId = Number(req.params.proposalId);
    if (!Number.isInteger(proposalId) || proposalId <= 0) {
      return res.status(400).json({ message: "Id de propuesta invalido" });
    }

    let proposal = await getAccessibleProposal({
      user: req.user,
      proposalId,
    });
    if (!proposal) {
      return res.status(404).json({ message: "Propuesta no encontrada" });
    }

    const didSyncFromConfig = await syncProposalFromCurrentConfigIfEligible({
      proposalId,
      proposalTitle: proposal.title,
      userId: Number(req.user.id),
      user: req.user,
    });

    if (didSyncFromConfig) {
      proposal = await getAccessibleProposal({
        user: req.user,
        proposalId,
      });
      if (!proposal) {
        return res.status(404).json({ message: "Propuesta no encontrada" });
      }
    }

    return res.json(await serializeProposalDetail(proposal));
  },
);

router.get(
  "/proposals/:proposalId/components/executive_summary/generation-jobs/latest",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    const proposalId = Number(req.params.proposalId);
    if (!Number.isInteger(proposalId) || proposalId <= 0) {
      return res.status(400).json({ message: "Id de propuesta invalido" });
    }

    const proposal = await getAccessibleProposal({
      user: req.user,
      proposalId,
    });
    if (!proposal) {
      return res.status(404).json({ message: "Propuesta no encontrada" });
    }

    return res.json({
      job: await getLatestProposalExecutiveSummaryGenerationJob({ proposalId }),
    });
  },
);

router.get(
  "/proposals/:proposalId/components/executive_summary/generation-jobs/:jobPublicId",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    const proposalId = Number(req.params.proposalId);
    const jobPublicId = String(req.params.jobPublicId || "").trim();
    if (!Number.isInteger(proposalId) || proposalId <= 0) {
      return res.status(400).json({ message: "Id de propuesta invalido" });
    }
    if (!jobPublicId) {
      return res.status(400).json({ message: "Id de job invalido" });
    }

    const proposal = await getAccessibleProposal({
      user: req.user,
      proposalId,
    });
    if (!proposal) {
      return res.status(404).json({ message: "Propuesta no encontrada" });
    }

    const job = await getProposalExecutiveSummaryGenerationJob({
      publicId: jobPublicId,
      proposalId,
    });
    if (!job) {
      return res.status(404).json({
        message: "Job no encontrado",
        error: {
          code: "job_not_found",
          retryable: false,
        },
      });
    }

    return res.json({ job });
  },
);

router.post(
  "/quotation-versions/:versionId/proposals",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    const versionId = Number(req.params.versionId);
    if (!Number.isInteger(versionId) || versionId <= 0) {
      return res.status(400).json({ message: "Id de version invalido" });
    }

    const parsed = proposalCreateSchema.safeParse(req.body || {});
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

    if (version.status_code !== "aprobada") {
      return res.status(409).json({
        message:
          "Solo se puede crear una propuesta desde una version aprobada de cotizacion",
      });
    }

    let content = null;
    let selectedTemplate = null;
    let templateSnapshot = null;
    const sourceProposalId = Number(parsed.data.sourceProposalId || 0) || null;
    const requestedTemplateId = Number(parsed.data.templateId || 0) || null;
    if (sourceProposalId) {
      const sourceProposal = await getAccessibleProposal({
        user: req.user,
        proposalId: sourceProposalId,
      });
      if (!sourceProposal) {
        return res
          .status(404)
          .json({ message: "Propuesta origen no encontrada" });
      }
      if (
        Number(sourceProposal.quotation_id) !== Number(version.quotation_id)
      ) {
        return res.status(400).json({
          message:
            "La propuesta origen debe pertenecer a la misma cotizacion base",
        });
      }
      content = sanitizeProposalContent(
        safeParseJsonObject(sourceProposal.content_json) || {},
      );
      if (!requestedTemplateId && Number(sourceProposal.template_id || 0) > 0) {
        selectedTemplate = await getProposalTemplateById(
          sourceProposal.template_id,
        );
      }
      templateSnapshot = sourceProposal.template_snapshot_json
        ? sanitizeProposalTemplateSnapshot(
            safeParseJsonObject(sourceProposal.template_snapshot_json) || {},
          )
        : null;
    }

    if (requestedTemplateId) {
      selectedTemplate = await getProposalTemplateById(requestedTemplateId);
      if (!selectedTemplate || selectedTemplate.status !== "active") {
        return res.status(404).json({ message: "Plantilla no encontrada" });
      }
    }

    if (!selectedTemplate && !templateSnapshot) {
      selectedTemplate = await getDefaultProposalTemplate();
    }

    const sections = await getQuotationVersionSections(versionId);
    const pricingSnapshot = buildProposalPricingSnapshot({
      versionRow: version,
      sections,
    });
    const resolvedTemplateSnapshot = templateSnapshot
      ? sanitizeProposalTemplateSnapshot(templateSnapshot)
      : buildProposalTemplateSnapshot(selectedTemplate);
    const normalizedContent =
      content ||
      buildDefaultProposalContent({
        versionRow: version,
        sections,
        templateSnapshot: resolvedTemplateSnapshot,
      });
    const proposalTitle =
      normalizedContent.heroTitle ||
      version.proposal_name ||
      `Propuesta comercial v${Number(version.version_number || 1)}`;

    const creationResult = await withTransaction(async (conn) => {
      await conn.query(
        `SELECT id
         FROM quotation_versions
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [Number(version.id)],
      );

      const [existingRows] = await conn.query(
        `SELECT id
         FROM proposals
         WHERE quotation_version_id = ?
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [Number(version.id)],
      );

      if (Array.isArray(existingRows) && existingRows.length > 0) {
        return {
          proposalId: Number(existingRows[0].id),
          created: false,
        };
      }

      const [result] = await conn.query(
        `INSERT INTO proposals
          (quotation_id, quotation_version_id, account_id, contact_id, opportunity_id,
           owner_user_id, template_id, title, status_code, content_json, pricing_snapshot_json,
           template_snapshot_json,
           created_by_user_id, updated_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
        [
          Number(version.quotation_id),
          Number(version.id),
          Number(version.account_id),
          Number(version.contact_id),
          Number(version.opportunity_id),
          Number(req.user.id),
          selectedTemplate?.id ? Number(selectedTemplate.id) : null,
          proposalTitle,
          JSON.stringify(normalizedContent),
          JSON.stringify(pricingSnapshot),
          JSON.stringify(resolvedTemplateSnapshot),
          Number(req.user.id),
          Number(req.user.id),
        ],
      );

      return {
        proposalId: Number(result.insertId),
        created: true,
      };
    });

    const proposalId = Number(creationResult.proposalId);

    if (creationResult.created) {
      await cloneProposalComponents({
        proposalId,
        actorUserId: Number(req.user.id),
        sourceProposalId: sourceProposalId || null,
      });
      const synchronizedContent =
        await refreshProposalLegacyContentFromComponents({
          proposalId,
          proposalTitle,
          userId: Number(req.user.id),
        });

      await createProposalRevision({
        proposalId,
        quotationVersionId: Number(version.id),
        title: proposalTitle,
        statusCode: "active",
        content: synchronizedContent.content,
        pricingSnapshot,
        changeType: sourceProposalId
          ? "create_from_version_clone"
          : "create_from_version",
        userId: req.user.id,
      });

      await logAuditEvent({
        req,
        module: "propuestas",
        action: "create_from_quotation_version",
        entityType: "proposal",
        entityId: proposalId,
        detail: `Propuesta creada desde la cotizacion ${version.quotation_id} v${version.version_number}`,
        after: {
          quotationId: Number(version.quotation_id),
          quotationVersionId: Number(version.id),
          templateId: selectedTemplate?.id ? Number(selectedTemplate.id) : null,
          templateCode: resolvedTemplateSnapshot.code,
        },
      });
    } else if (!sourceProposalId) {
      const canAutoSync =
        await canAutoSyncProposalFromCurrentConfig(proposalId);
      if (canAutoSync) {
        await cloneProposalComponents({
          proposalId,
          actorUserId: Number(req.user.id),
        });

        const existingProposal = await getAccessibleProposal({
          user: req.user,
          proposalId,
        });
        const synchronizedContent =
          await refreshProposalLegacyContentFromComponents({
            proposalId,
            proposalTitle: existingProposal?.title || proposalTitle,
            userId: Number(req.user.id),
          });

        await createProposalRevision({
          proposalId,
          quotationVersionId: Number(
            existingProposal?.quotation_version_id || version.id,
          ),
          title: existingProposal?.title || proposalTitle,
          statusCode: normalizeProposalStatusCode(
            existingProposal?.status_code,
            existingProposal?.archived_at ? "archived" : "active",
          ),
          content: synchronizedContent.content,
          pricingSnapshot:
            safeParseJsonObject(existingProposal?.pricing_snapshot_json) ||
            pricingSnapshot,
          changeType: "sync_from_current_config_on_create",
          userId: req.user.id,
        });
      }
    }

    const proposal = await getAccessibleProposal({
      user: req.user,
      proposalId,
    });

    return res.status(creationResult.created ? 201 : 200).json({
      message: creationResult.created
        ? "Propuesta creada"
        : "Propuesta existente",
      created: creationResult.created,
      proposal: await serializeProposalDetail(proposal),
    });
  },
);

router.put(
  "/proposals/:proposalId",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    const proposalId = Number(req.params.proposalId);
    if (!Number.isInteger(proposalId) || proposalId <= 0) {
      return res.status(400).json({ message: "Id de propuesta invalido" });
    }

    const parsed = proposalUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const proposal = await getAccessibleProposal({
      user: req.user,
      proposalId,
    });
    if (!proposal) {
      return res.status(404).json({ message: "Propuesta no encontrada" });
    }

    const currentContent = sanitizeProposalContent(
      safeParseJsonObject(proposal.content_json) || {},
    );
    const nextContent = parsed.data.content
      ? sanitizeProposalContent(parsed.data.content)
      : currentContent;
    const nextStatusCode = normalizeProposalStatusCode(
      parsed.data.statusCode || proposal.status_code,
      proposal.archived_at ? "archived" : "active",
    );
    const nextTitle =
      parsed.data.title || proposal.title || currentContent.heroTitle;

    await query(
      `UPDATE proposals
       SET title = ?, status_code = ?,
           content_json = ?, updated_by_user_id = ?, updated_at = NOW(3),
           archived_at = CASE WHEN ? = 'archived' THEN COALESCE(archived_at, NOW(3)) ELSE NULL END
       WHERE id = ?`,
      [
        nextTitle,
        nextStatusCode,
        JSON.stringify(nextContent),
        Number(req.user.id),
        nextStatusCode,
        proposalId,
      ],
    );

    await createProposalRevision({
      proposalId,
      quotationVersionId: Number(proposal.quotation_version_id),
      title: nextTitle,
      statusCode: nextStatusCode,
      content: nextContent,
      pricingSnapshot:
        safeParseJsonObject(proposal.pricing_snapshot_json) || {},
      changeType: "update_content",
      userId: req.user.id,
    });

    await logAuditEvent({
      req,
      module: "propuestas",
      action: "update",
      entityType: "proposal",
      entityId: proposalId,
      detail: "Propuesta actualizada",
    });

    const refreshedProposal = await getAccessibleProposal({
      user: req.user,
      proposalId,
    });
    return res.json({
      message: "Propuesta actualizada",
      proposal: await serializeProposalDetail(refreshedProposal),
    });
  },
);

router.put(
  "/proposals/:proposalId/components/:componentCode",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    const proposalId = Number(req.params.proposalId);
    const componentCode = String(req.params.componentCode || "").trim();
    if (!Number.isInteger(proposalId) || proposalId <= 0) {
      return res.status(400).json({ message: "Id de propuesta invalido" });
    }
    if (!getProposalComponentDefinitionOrNull(componentCode)) {
      return res.status(404).json({ message: "Componente no encontrado" });
    }

    const parsed = proposalComponentUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const proposal = await getAccessibleProposal({
      user: req.user,
      proposalId,
    });
    if (!proposal) {
      return res.status(404).json({ message: "Propuesta no encontrada" });
    }

    await saveProposalComponentBlocks({
      proposalId,
      componentCode,
      title: parsed.data.title,
      blocks: parsed.data.blocks,
      actorUserId: Number(req.user.id),
    });
    const synced = await refreshProposalLegacyContentFromComponents({
      proposalId,
      proposalTitle: proposal.title,
      userId: Number(req.user.id),
    });

    await createProposalRevision({
      proposalId,
      quotationVersionId: Number(proposal.quotation_version_id),
      title: proposal.title,
      statusCode: normalizeProposalStatusCode(
        proposal.status_code,
        proposal.archived_at ? "archived" : "active",
      ),
      content: synced.content,
      pricingSnapshot:
        safeParseJsonObject(proposal.pricing_snapshot_json) || {},
      changeType: `update_component_${componentCode}`,
      userId: req.user.id,
    });

    await logAuditEvent({
      req,
      module: "propuestas",
      action: "update_component",
      entityType: "proposal",
      entityId: proposalId,
      detail: `Componente ${componentCode} actualizado`,
    });

    const refreshedProposal = await getAccessibleProposal({
      user: req.user,
      proposalId,
    });
    return res.json({
      message: "Componente actualizado",
      proposal: await serializeProposalDetail(refreshedProposal),
    });
  },
);

router.post(
  "/proposals/:proposalId/components/executive_summary/generation-jobs",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    const proposalId = Number(req.params.proposalId);
    if (!Number.isInteger(proposalId) || proposalId <= 0) {
      return res.status(400).json({ message: "Id de propuesta invalido" });
    }

    const parsed = proposalExecutiveSummaryGenerationSchema.safeParse(
      req.body || {},
    );
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const proposal = await getAccessibleProposal({
      user: req.user,
      proposalId,
    });
    if (!proposal) {
      return res.status(404).json({ message: "Propuesta no encontrada" });
    }

    try {
      const creation = await createOrReuseProposalExecutiveSummaryGenerationJob(
        {
          proposal,
          requestedByUserId: Number(req.user.id),
          instructions: parsed.data.instructions,
          languageCode: parsed.data.languageCode,
          maxLibraryAssets: parsed.data.maxLibraryAssets,
        },
      );

      queueProposalExecutiveSummaryGenerationProcessing();

      return res.status(202).json({
        message: creation.wasReused
          ? "Ya existe una generacion en progreso"
          : "Generacion iniciada",
        reused: creation.wasReused,
        job: creation.response,
      });
    } catch (error) {
      if (error?.body && error?.status) {
        return res.status(error.status).json(error.body);
      }
      throw error;
    }
  },
);

router.post(
  "/proposals/:proposalId/components/:componentCode/replace-image",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    const proposalId = Number(req.params.proposalId);
    const componentCode = String(req.params.componentCode || "").trim();
    if (!Number.isInteger(proposalId) || proposalId <= 0) {
      return res.status(400).json({ message: "Id de propuesta invalido" });
    }
    if (!getProposalComponentDefinitionOrNull(componentCode)) {
      return res.status(404).json({ message: "Componente no encontrado" });
    }

    const parsed = proposalReplaceImageSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const proposal = await getAccessibleProposal({
      user: req.user,
      proposalId,
    });
    if (!proposal) {
      return res.status(404).json({ message: "Propuesta no encontrada" });
    }

    const components = await replaceProposalComponentImage({
      proposalId,
      componentCode,
      blockId: parsed.data.blockId,
      assetId: parsed.data.assetId,
      assetVersionId: parsed.data.assetVersionId,
      actorUserId: Number(req.user.id),
    });
    if (!components) {
      return res.status(404).json({ message: "Imagen no encontrada" });
    }

    const synced = await refreshProposalLegacyContentFromComponents({
      proposalId,
      proposalTitle: proposal.title,
      userId: Number(req.user.id),
    });

    await createProposalRevision({
      proposalId,
      quotationVersionId: Number(proposal.quotation_version_id),
      title: proposal.title,
      statusCode: normalizeProposalStatusCode(
        proposal.status_code,
        proposal.archived_at ? "archived" : "active",
      ),
      content: synced.content,
      pricingSnapshot:
        safeParseJsonObject(proposal.pricing_snapshot_json) || {},
      changeType: `replace_component_image_${componentCode}`,
      userId: req.user.id,
    });

    await logAuditEvent({
      req,
      module: "propuestas",
      action: "replace_image",
      entityType: "proposal",
      entityId: proposalId,
      detail: `Imagen de ${componentCode} reemplazada`,
      after: {
        blockId: parsed.data.blockId,
        assetId: parsed.data.assetId,
        assetVersionId: parsed.data.assetVersionId,
      },
    });

    const refreshedProposal = await getAccessibleProposal({
      user: req.user,
      proposalId,
    });
    return res.json({
      message: "Imagen actualizada",
      proposal: await serializeProposalDetail(refreshedProposal),
    });
  },
);

router.post(
  "/proposals/:proposalId/apply-template",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    const proposalId = Number(req.params.proposalId);
    if (!Number.isInteger(proposalId) || proposalId <= 0) {
      return res.status(400).json({ message: "Id de propuesta invalido" });
    }

    const parsed = proposalTemplateApplySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const proposal = await getAccessibleProposal({
      user: req.user,
      proposalId,
    });
    if (!proposal) {
      return res.status(404).json({ message: "Propuesta no encontrada" });
    }

    const template = await getProposalTemplateById(parsed.data.templateId);
    if (!template || template.status !== "active") {
      return res.status(404).json({ message: "Plantilla no encontrada" });
    }

    const version = await getAccessibleQuotationVersion({
      user: req.user,
      versionId: Number(proposal.quotation_version_id),
    });
    if (!version) {
      return res.status(404).json({ message: "Version base no encontrada" });
    }

    const sections = await getQuotationVersionSections(Number(version.id));
    const nextTemplateSnapshot = buildProposalTemplateSnapshot(template);
    const templateDefaults = buildDefaultProposalContent({
      versionRow: version,
      sections,
      templateSnapshot: nextTemplateSnapshot,
    });
    const currentContent = sanitizeProposalContent(
      safeParseJsonObject(proposal.content_json) || {},
    );
    const nextContent =
      parsed.data.mode === "replace_content"
        ? templateDefaults
        : mergeProposalContentWithTemplateDefaults(
            currentContent,
            templateDefaults,
          );
    const nextTitle = nextContent.heroTitle || proposal.title || template.name;

    await query(
      `UPDATE proposals
       SET template_id = ?, template_snapshot_json = ?, title = ?, content_json = ?,
           updated_by_user_id = ?, updated_at = NOW(3)
       WHERE id = ?`,
      [
        Number(template.id),
        JSON.stringify(nextTemplateSnapshot),
        nextTitle,
        JSON.stringify(nextContent),
        Number(req.user.id),
        proposalId,
      ],
    );

    await createProposalRevision({
      proposalId,
      quotationVersionId: Number(proposal.quotation_version_id),
      title: nextTitle,
      statusCode: normalizeProposalStatusCode(
        proposal.status_code,
        proposal.archived_at ? "archived" : "active",
      ),
      content: nextContent,
      pricingSnapshot:
        safeParseJsonObject(proposal.pricing_snapshot_json) || {},
      changeType:
        parsed.data.mode === "replace_content"
          ? "apply_template_replace"
          : "apply_template_preserve",
      userId: req.user.id,
    });

    await logAuditEvent({
      req,
      module: "propuestas",
      action: "apply_template",
      entityType: "proposal",
      entityId: proposalId,
      detail: `Plantilla ${template.code} aplicada a la propuesta`,
      after: {
        templateId: Number(template.id),
        templateCode: template.code,
        mode: parsed.data.mode,
      },
    });

    const refreshedProposal = await getAccessibleProposal({
      user: req.user,
      proposalId,
    });
    return res.json({
      message: "Plantilla aplicada",
      proposal: await serializeProposalDetail(refreshedProposal),
    });
  },
);

router.post(
  "/proposals/:proposalId/rebase",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    const proposalId = Number(req.params.proposalId);
    if (!Number.isInteger(proposalId) || proposalId <= 0) {
      return res.status(400).json({ message: "Id de propuesta invalido" });
    }

    const parsed = proposalRebaseSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const proposal = await getAccessibleProposal({
      user: req.user,
      proposalId,
    });
    if (!proposal) {
      return res.status(404).json({ message: "Propuesta no encontrada" });
    }

    const nextVersion = await getAccessibleQuotationVersion({
      user: req.user,
      versionId: parsed.data.quotationVersionId,
    });
    if (!nextVersion) {
      return res.status(404).json({ message: "Version no encontrada" });
    }
    if (Number(nextVersion.quotation_id) !== Number(proposal.quotation_id)) {
      return res.status(400).json({
        message: "La nueva version debe pertenecer a la misma cotizacion base",
      });
    }
    if (nextVersion.status_code !== "aprobada") {
      return res.status(409).json({
        message:
          "Solo se puede actualizar una propuesta hacia una version aprobada de cotizacion",
      });
    }

    const sections = await getQuotationVersionSections(Number(nextVersion.id));
    const pricingSnapshot = buildProposalPricingSnapshot({
      versionRow: nextVersion,
      sections,
    });
    const content = sanitizeProposalContent(
      safeParseJsonObject(proposal.content_json) || {},
    );

    await query(
      `UPDATE proposals
       SET quotation_version_id = ?, contact_id = ?, title = ?, pricing_snapshot_json = ?,
           updated_by_user_id = ?, updated_at = NOW(3)
       WHERE id = ?`,
      [
        Number(nextVersion.id),
        Number(nextVersion.contact_id),
        proposal.title,
        JSON.stringify(pricingSnapshot),
        Number(req.user.id),
        proposalId,
      ],
    );

    await createProposalRevision({
      proposalId,
      quotationVersionId: Number(nextVersion.id),
      title: proposal.title,
      statusCode: normalizeProposalStatusCode(
        proposal.status_code,
        proposal.archived_at ? "archived" : "active",
      ),
      content,
      pricingSnapshot,
      changeType: "rebase_to_quotation_version",
      userId: req.user.id,
    });

    await logAuditEvent({
      req,
      module: "propuestas",
      action: "rebase",
      entityType: "proposal",
      entityId: proposalId,
      detail: `Propuesta actualizada explicitamente a la cotizacion v${nextVersion.version_number}`,
      after: {
        quotationVersionId: Number(nextVersion.id),
      },
    });

    const refreshedProposal = await getAccessibleProposal({
      user: req.user,
      proposalId,
    });
    return res.json({
      message: "Propuesta actualizada a la nueva version",
      proposal: await serializeProposalDetail(refreshedProposal),
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
    await ensureQuotationVersionDocumentsSchema();
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
          quotationCurrencyCode:
            parsed.data.currencyCode || latestVersion.currency_code,
        });
      }

      await copyQuotationVersionDocuments(conn, {
        sourceVersionId: latestVersion.id,
        targetVersionId: newVersionId,
        createdByUserId: req.user.id,
        createdAt: now,
      });

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
    const documents = await listQuotationVersionDocuments({ versionId });
    const allDocuments = await listQuotationDocuments({
      quotationId: version.quotation_id,
    });
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
      documents,
      allDocuments,
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
              quotationCurrencyCode:
                parsed.data.currencyCode || version.currency_code,
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
    const documents = await listQuotationVersionDocuments({ versionId });
    const allDocuments = await listQuotationDocuments({
      quotationId: refreshedVersion.quotation_id,
    });
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
      documents,
      allDocuments,
      actions,
      isLatestVersion:
        Number(refreshedVersion.id) ===
        Number(refreshedVersion.latest_version_id),
      message: "Version actualizada",
    });
  },
);

router.get(
  "/quotation-versions/:versionId/documents",
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

    return res.json(await listQuotationVersionDocuments({ versionId }));
  },
);

router.get(
  "/quotations/:quotationId/documents",
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

    return res.json(await listQuotationDocuments({ quotationId }));
  },
);

router.post(
  "/quotation-versions/:versionId/documents",
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

    const canModify = await canExecuteQuotationAction({
      user: req.user,
      versionRow: version,
      actionCode: "modificar",
    });
    if (!canModify && !hasQuotationAdministration(req.user)) {
      return res.status(403).json({
        message: "No autorizado para adjuntar documentos en la version",
      });
    }

    const { files } = await parseMultipartFiles(req);
    if (!files.length) {
      return res
        .status(400)
        .json({ message: "Selecciona al menos un archivo" });
    }

    const allowedMimeTypes = new Set(config.documents.storage.allowedMimeTypes);
    const invalidFile = files.find((file) => {
      const mimeType = String(file.mimetype || "").trim();
      return !mimeType || !allowedMimeTypes.has(mimeType);
    });
    if (invalidFile) {
      await cleanupTempFiles(files);
      return res.status(400).json({
        message: `Tipo de archivo no permitido: ${invalidFile.originalFilename || invalidFile.newFilename || "archivo"}`,
      });
    }

    try {
      await ensureQuotationVersionDocumentsSchema();
      await withTransaction(async (conn) => {
        await createQuotationVersionDocuments(conn, {
          files,
          quotationId: version.quotation_id,
          versionId,
          userId: req.user.id,
        });
      });
    } finally {
      await cleanupTempFiles(files);
    }

    await logAuditEvent({
      req,
      module: "cotizaciones",
      action: "documents_uploaded",
      entityType: "quotation_version",
      entityId: versionId,
      detail: "Documentos adjuntos cargados en la version de cotizacion",
    });

    return res.status(201).json({
      message: "Documentos cargados",
      documents: await listQuotationVersionDocuments({ versionId }),
      allDocuments: await listQuotationDocuments({
        quotationId: version.quotation_id,
      }),
    });
  },
);

router.get(
  "/quotation-exchange-rate",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;

    const parsed = quotationExchangeRateQuerySchema.safeParse(req.query || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Moneda invalida",
        errors: parsed.error.flatten(),
      });
    }

    try {
      const rate = await fetchFrankfurterExchangeRate({
        targetCurrency: parsed.data.currency,
      });
      return res.json(rate);
    } catch (error) {
      return res.status(502).json({
        message:
          "No fue posible obtener el tipo de cambio sugerido en este momento",
        detail: String(error?.message || "").trim() || undefined,
      });
    }
  },
);

router.get(
  "/quotation-version-documents/:linkId/download",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    const linkId = Number(req.params.linkId);
    if (!Number.isInteger(linkId) || linkId <= 0) {
      return res.status(400).json({ message: "Id de documento invalido" });
    }

    const link = await getQuotationVersionDocumentLink({ linkId });
    if (!link) {
      return res.status(404).json({ message: "Documento no encontrado" });
    }

    const version = await getAccessibleQuotationVersion({
      user: req.user,
      versionId: link.quotation_version_id,
    });
    if (!version) {
      return res.status(404).json({ message: "Documento no disponible" });
    }

    const { document, stream } = await getDocumentContentStream({
      documentPublicId: link.document_public_id,
    });

    res.setHeader(
      "Content-Type",
      document.mime_type || link.mime_type || "application/octet-stream",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(document.original_file_name || link.original_file_name || "documento")}"`,
    );
    stream.on("error", (error) => {
      res.destroy(error);
    });
    stream.pipe(res);
  },
);

router.post(
  "/quotations/render-pdf",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;

    const parsed = quotationPdfRenderSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const company = await getCompanyDocumentBranding();
    const { buffer, fileName } = await buildQuotationPdfBuffer({
      ...parsed.data,
      company,
    });

    await logAuditEvent({
      req,
      module: "cotizaciones",
      action: "generar_pdf",
      entityType: "quotation_document",
      detail: `Documento PDF generado: ${parsed.data.header.proposalName || "cotizacion"}`,
      after: {
        proposalName: parsed.data.header.proposalName || "",
        sectionCount: parsed.data.sections.length,
      },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
    res.setHeader("Cache-Control", "no-store");

    return res.send(buffer);
  },
);

router.post(
  "/proposals/render-pdf",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;

    const parsed = proposalPdfRenderSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const company = await getCompanyDocumentBranding();
    const quotationAttachment = await resolveProposalQuotationAttachment({
      user: req.user,
      company,
      quotationVersionId: parsed.data.quotationAttachmentRef.quotationVersionId,
    });
    const { buffer, fileName } = await buildProposalPdfBuffer({
      ...parsed.data,
      company,
      quotationAttachment,
    });

    await logAuditEvent({
      req,
      module: "propuestas",
      action: "generar_pdf",
      entityType: "proposal_document",
      detail: `Documento PDF generado: ${parsed.data.header.proposalTitle || "propuesta"}`,
      after: {
        proposalTitle: parsed.data.header.proposalTitle || "",
        sectionCount: parsed.data.sections.length,
        quotationVersionId:
          parsed.data.quotationAttachmentRef.quotationVersionId,
      },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
    res.setHeader("Cache-Control", "no-store");

    return res.send(buffer);
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
