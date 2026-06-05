import express from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { buffer as streamToBuffer } from "node:stream/consumers";
import { z } from "zod";
import { query, withTransaction } from "./db.js";
import { getUserAuthContext, requireAnyPermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import { buildProposalPdfBuffer } from "./proposalPdf.js";
import { buildQuotationPdfBuffer } from "./quotationPdf.js";
import {
  AI_PARAMETER_CAPABILITY_KEYS,
  cloneProposalComponents,
  getPublishedAiParameterEntryByCapabilityKey,
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
  extractContentFromBuffer,
  getDocumentContentStream,
  listOpportunityDocuments,
  parseMultipartFiles,
} from "./opportunity-documents/service.js";
import { createDocumentStorage } from "./opportunity-documents/storage.js";
import {
  getCommercialEnablementAssetDetail,
  getCommercialEnablementCatalogs,
  getCommercialEnablementFileStream,
  listCommercialEnablementAssets,
} from "./commercial-enablement/service.js";
import {
  assertAiBudgetAvailable,
  recordAiUsageFromOpenAiResponse,
} from "./ai-usage/service.js";

const router = express.Router();
const documentStorage = createDocumentStorage();

const quotationPermissionCodes = [
  "cotizaciones.operacion",
  "cotizaciones.revision",
  "cotizaciones.ingreso",
  "cotizaciones.aprobacion_humana",
  "cotizaciones.aprobacion_ia",
  "cotizaciones.administracion",
  "cotizaciones.externo",
];

const proposalReadPermissionCodes = [
  "propuestas.read",
  "propuestas.create",
  "propuestas.update",
];

const proposalCreatePermissionCodes = ["propuestas.create"];
const proposalUpdatePermissionCodes = ["propuestas.update"];

const proposalReadAccessPermissionCodes = Array.from(
  new Set([...proposalReadPermissionCodes, ...quotationPermissionCodes]),
);
const proposalCreateAccessPermissionCodes = Array.from(
  new Set([...proposalCreatePermissionCodes, ...quotationPermissionCodes]),
);
const proposalUpdateAccessPermissionCodes = Array.from(
  new Set([...proposalUpdatePermissionCodes, ...quotationPermissionCodes]),
);

const quotationHumanApprovalPermissionCode = "cotizaciones.aprobacion_humana";
const quotationAiApprovalPermissionCode = "cotizaciones.aprobacion_ia";

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
  approvalContext: z
    .object({
      approvalMode: z.enum(["with_ai", "without_ai"]).optional(),
      confirmMissingRequiredServices: z.boolean().optional().default(false),
      missingRequiredServicesReason: z
        .string()
        .trim()
        .max(2000)
        .optional()
        .nullable(),
      confirmProviderBackingException: z.boolean().optional().default(false),
      providerBackingExceptionReason: z
        .string()
        .trim()
        .max(2000)
        .optional()
        .nullable(),
      acknowledgedUnbackedItemIds: z
        .array(z.number().int().positive())
        .optional()
        .default([]),
    })
    .optional(),
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

const quotationPublicShareCreateSchema = z.object({
  pdfPayload: quotationPdfRenderSchema,
  ttlDays: z.number().int().min(1).max(365).optional().default(30),
});

const quotationShareEligibleStatusCodes = new Set([
  "aprobada",
  "enviada",
  "ganada",
  "aceptada",
]);

let quotationPublicShareTableEnsured = false;

async function ensureQuotationPublicShareTable() {
  if (quotationPublicShareTableEnsured) {
    return;
  }

  await query(
    `CREATE TABLE IF NOT EXISTS quotation_public_share_links (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      quotation_version_id BIGINT UNSIGNED NOT NULL,
      created_by_user_id BIGINT UNSIGNED NOT NULL,
      token_hash CHAR(64) NOT NULL,
      pdf_payload_json LONGTEXT NOT NULL,
      expires_at DATETIME(3) NOT NULL,
      last_accessed_at DATETIME(3) NULL,
      access_count INT UNSIGNED NOT NULL DEFAULT 0,
      revoked_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
      updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
      CONSTRAINT uq_quotation_public_share_links_token_hash UNIQUE (token_hash),
      CONSTRAINT fk_quotation_public_share_links_version FOREIGN KEY (quotation_version_id) REFERENCES quotation_versions(id) ON DELETE CASCADE,
      CONSTRAINT fk_quotation_public_share_links_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
      INDEX idx_quotation_public_share_links_version (quotation_version_id, expires_at),
      INDEX idx_quotation_public_share_links_expiry (expires_at)
    )`,
  );

  quotationPublicShareTableEnsured = true;
}

function buildQuotationPublicShareToken() {
  return randomBytes(24).toString("hex");
}

function buildQuotationPublicShareTokenHash(token) {
  return createHash("sha256")
    .update(String(token || ""))
    .digest("hex");
}

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
const PROPOSAL_BACKGROUND_JOB_COMPONENT_CODE = "background";
const PROPOSAL_EXEC_SUMMARY_JOB_TYPE = "generate_parallel_suggestion";
const PROPOSAL_EXEC_SUMMARY_JOB_POLL_INTERVAL_MS = 3000;
const PROPOSAL_EXEC_SUMMARY_JOB_LEASE_SECONDS = 150;
const PROPOSAL_EXEC_SUMMARY_JOB_RESULT_TTL_MINUTES = 180;
const PROPOSAL_EXEC_SUMMARY_MAX_LIBRARY_ASSETS = 4;
const PROPOSAL_BROCHURE_MAX_ITEMS = 10;
const PROPOSAL_BROCHURE_DEFAULT_REQUESTED_COUNT = 3;
const PROPOSAL_BROCHURE_RECOMMENDATION_CANDIDATE_LIMIT = 20;
const PROPOSAL_EXEC_SUMMARY_MAX_ANSWERS = 16;
const PROPOSAL_EXEC_SUMMARY_MAX_DOCUMENTS = 4;
const PROPOSAL_EXEC_SUMMARY_MAX_DOCUMENT_TEXT_CHARS = 1500;
const PROPOSAL_EXEC_SUMMARY_MAX_LIBRARY_SUMMARY_CHARS = 500;
const PROPOSAL_EXEC_SUMMARY_MAX_LIBRARY_SOURCE_TEXT_CHARS = 4000;
const PROPOSAL_EXEC_SUMMARY_MAX_SECTION_ITEMS = 8;
const PROPOSAL_EXEC_SUMMARY_OPENAI_TIMEOUT_MS = 120000;
const QUOTATION_PROVIDER_IMPORT_PREVIEW_JOB_POLL_INTERVAL_MS = 3000;
const QUOTATION_PROVIDER_IMPORT_PREVIEW_JOB_LEASE_SECONDS = 240;
const QUOTATION_PROVIDER_IMPORT_PREVIEW_JOB_RESULT_TTL_MINUTES = 180;
const PROPOSAL_BACKGROUND_DEFAULT_SYSTEM_PROMPT =
  "Redacta la seccion de antecedentes para una propuesta B2B en espanol. Responde exclusivamente con JSON valido. No inventes hechos, fechas, compromisos, entregables ni relaciones que no esten sustentados por el contexto. Sintetiza el contexto comercial previo, la situacion actual del cliente, los detonantes de la oportunidad y la informacion documental relevante. Usa documentSources como fuentes documentales primarias. Trata los documentos de biblioteca con la misma prioridad estructural que los demas documentos cuando su texto este disponible. Si generationPolicy.libraryContentMode es source_text, usa el texto fuente del activo de biblioteca como documento de primer nivel. Si es summary_extract, usa solo summary y extracto resumido del activo. Si generationPolicy.sourcePriorityMode es non_library_first, prioriza fuentes no biblioteca al decidir enfoque y enfasis. Si es library_first, prioriza los documentos de biblioteca para el framing y la redaccion sin contradecir datos duros del resto del contexto. Si es balanced, reconcilia ambas familias con el mismo peso. Si generationPolicy.librarySourceMode es manual, los assets seleccionados deben influir explicitamente en el enfoque del texto. La salida debe tener title, paragraphs y warnings. paragraphs debe ser un arreglo de 1 a 3 parrafos en espanol, sin markdown.";
const PROPOSAL_GENERIC_SECTION_DEFAULT_SYSTEM_PROMPT =
  "Redacta contenido comercial en espanol para una seccion de propuesta B2B. Responde exclusivamente con JSON valido. No inventes hechos, promesas, entregables, fechas ni capacidades que no esten respaldadas por el contexto. Adapta el texto al titulo y objetivo de la seccion objetivo. Usa documentSources como fuentes documentales primarias. Trata los documentos de biblioteca con la misma prioridad estructural que los demas documentos cuando su texto este disponible. Si generationPolicy.libraryContentMode es source_text, usa el texto fuente del activo de biblioteca como documento de primer nivel. Si es summary_extract, usa solo summary y extracto resumido del activo. Si generationPolicy.sourcePriorityMode es non_library_first, prioriza fuentes no biblioteca al decidir enfoque y enfasis. Si es library_first, prioriza los documentos de biblioteca para el framing y la redaccion sin contradecir datos duros del resto del contexto. Si es balanced, reconcilia ambas familias con el mismo peso. Si generationPolicy.librarySourceMode es manual, los assets seleccionados deben influir explicitamente en el enfoque del texto. La salida debe tener title, paragraphs y warnings. paragraphs debe ser un arreglo de 1 a 3 parrafos en espanol, sin markdown.";

function buildProposalAiComponentConfig({
  componentCode,
  componentTitle,
  aiCapabilityKey,
}) {
  const normalizedCode = String(componentCode || "").trim();
  const normalizedTitle = String(componentTitle || "").trim();
  if (
    aiCapabilityKey === AI_PARAMETER_CAPABILITY_KEYS.proposalExecutiveSummary
  ) {
    return {
      componentCode: normalizedCode,
      componentTitle: normalizedTitle || "Resumen ejecutivo",
      defaultSuggestionTitle:
        normalizedTitle && normalizedTitle !== "Resumen ejecutivo"
          ? `${normalizedTitle} sugerido`
          : "Resumen ejecutivo sugerido",
      capabilityKey: AI_PARAMETER_CAPABILITY_KEYS.proposalExecutiveSummary,
      defaultSystemPrompt:
        "Redacta un resumen ejecutivo comercial en espanol para una propuesta B2B. Responde exclusivamente con JSON valido. No inventes capacidades, entregables ni promesas que no esten sustentadas por el contexto. Prioriza continuidad operativa, objetivos del cliente, alcance comercial y valor de negocio. Usa documentSources como fuentes documentales primarias. Trata los documentos de biblioteca con la misma prioridad estructural que los demas documentos cuando su texto este disponible. Si generationPolicy.libraryContentMode es source_text, usa el texto fuente del activo de biblioteca como documento de primer nivel. Si es summary_extract, usa solo summary y extracto resumido del activo. Si generationPolicy.sourcePriorityMode es non_library_first, prioriza fuentes no biblioteca al decidir enfoque y enfasis. Si es library_first, prioriza los documentos de biblioteca para el framing y la redaccion sin contradecir datos duros del resto del contexto. Si es balanced, reconcilia ambas familias con el mismo peso. Si generationPolicy.librarySourceMode es manual, los assets seleccionados deben influir explicitamente en el enfoque del resumen. La salida debe tener title, paragraphs y warnings. paragraphs debe ser un arreglo de 1 a 3 parrafos en espanol, sin markdown.",
      aiDisabledMessage:
        "La generacion asistida del resumen ejecutivo esta deshabilitada",
      suggestionTone: "executive_commercial",
    };
  }

  if (aiCapabilityKey === AI_PARAMETER_CAPABILITY_KEYS.proposalBackground) {
    return {
      componentCode: normalizedCode,
      componentTitle: normalizedTitle || "Antecedentes",
      defaultSuggestionTitle:
        normalizedTitle && normalizedTitle !== "Antecedentes"
          ? `${normalizedTitle} sugeridos`
          : "Antecedentes sugeridos",
      capabilityKey: AI_PARAMETER_CAPABILITY_KEYS.proposalBackground,
      defaultSystemPrompt: PROPOSAL_BACKGROUND_DEFAULT_SYSTEM_PROMPT,
      aiDisabledMessage:
        "La generacion asistida de antecedentes esta deshabilitada",
      suggestionTone: "commercial_background",
    };
  }

  if (aiCapabilityKey === AI_PARAMETER_CAPABILITY_KEYS.proposalGenericSection) {
    const fallbackTitle = normalizedTitle || "Seccion comercial";
    return {
      componentCode: normalizedCode,
      componentTitle: fallbackTitle,
      defaultSuggestionTitle: `${fallbackTitle} sugerida`,
      capabilityKey: AI_PARAMETER_CAPABILITY_KEYS.proposalGenericSection,
      defaultSystemPrompt: PROPOSAL_GENERIC_SECTION_DEFAULT_SYSTEM_PROMPT,
      aiDisabledMessage:
        "La generacion asistida no esta disponible para esta seccion",
      suggestionTone: "commercial_section",
    };
  }

  return null;
}

function getProposalAiComponentConfig(componentCode) {
  const normalizedCode = String(componentCode || "").trim();
  if (normalizedCode === PROPOSAL_EXEC_SUMMARY_JOB_COMPONENT_CODE) {
    return buildProposalAiComponentConfig({
      componentCode: normalizedCode,
      componentTitle: "Resumen ejecutivo",
      aiCapabilityKey: AI_PARAMETER_CAPABILITY_KEYS.proposalExecutiveSummary,
    });
  }
  if (normalizedCode === PROPOSAL_BACKGROUND_JOB_COMPONENT_CODE) {
    return buildProposalAiComponentConfig({
      componentCode: normalizedCode,
      componentTitle: "Antecedentes",
      aiCapabilityKey: AI_PARAMETER_CAPABILITY_KEYS.proposalBackground,
    });
  }
  return null;
}

async function getProposalAiComponentConfigForProposal({
  proposalId,
  componentCode,
}) {
  const normalizedProposalId = Number(proposalId || 0);
  const normalizedComponentCode = String(componentCode || "").trim();
  if (!normalizedProposalId || !normalizedComponentCode) {
    return null;
  }

  const components = await listProposalComponents(normalizedProposalId);
  const component = components.find(
    (entry) => entry.componentCode === normalizedComponentCode,
  );
  if (!component) {
    return getProposalAiComponentConfig(normalizedComponentCode);
  }

  const activeConfig = await getProposalContentConfiguration();
  const activeComponent = Array.isArray(activeConfig?.components)
    ? activeConfig.components.find(
        (entry) => entry.componentCode === normalizedComponentCode,
      )
    : null;

  if (activeComponent?.aiEnabled && activeComponent?.aiCapabilityKey) {
    return buildProposalAiComponentConfig({
      componentCode: normalizedComponentCode,
      componentTitle:
        activeComponent.title || component.title || normalizedComponentCode,
      aiCapabilityKey: activeComponent.aiCapabilityKey,
    });
  }

  if (!component.aiEnabled || !component.aiCapabilityKey) {
    return null;
  }
  return buildProposalAiComponentConfig({
    componentCode: component.componentCode,
    componentTitle: component.title,
    aiCapabilityKey: component.aiCapabilityKey,
  });
}

async function proposalHasComponent(proposalId, componentCode) {
  const components = await listProposalComponents(Number(proposalId));
  return components.some(
    (component) =>
      component.componentCode === String(componentCode || "").trim(),
  );
}

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

const proposalPdfBrochureSchema = z.object({
  publicId: z.string().trim().max(120).optional().default(""),
  title: z.string().trim().max(255).optional().default(""),
  summary: z.string().trim().max(5000).optional().default(""),
  assetTypeCode: z.string().trim().max(80).optional().default(""),
  assetTypeLabel: z.string().trim().max(120).optional().default(""),
  visibilityLabel: z.string().trim().max(120).optional().default(""),
  files: z
    .array(
      z.object({
        publicId: z.string().trim().max(120).optional().default(""),
        fileName: z.string().trim().max(255).optional().default(""),
        fileUrl: z.string().trim().max(10_000_000).optional().default(""),
        publicUrl: z.string().trim().max(10_000_000).optional().default(""),
        downloadUrl: z.string().trim().max(10_000_000).optional().default(""),
        mimeType: z.string().trim().max(255).optional().default(""),
      }),
    )
    .optional()
    .default([]),
  links: z
    .array(
      z.object({
        label: z.string().trim().max(255).optional().default(""),
        url: z.string().trim().max(10_000_000).optional().default(""),
      }),
    )
    .optional()
    .default([]),
});

const proposalPdfBlockSchema = z
  .object({
    type: z.enum(["heading", "paragraph", "list", "image", "brochure"]),
    text: z.string().trim().max(50_000).optional().default(""),
    items: z.array(z.string().trim().max(1000)).optional().default([]),
    image: proposalPdfImageSchema.optional().nullable(),
    assetPublicId: z.string().trim().max(120).optional().default(""),
    brochure: proposalPdfBrochureSchema.optional().nullable(),
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

    if (
      value.type === "brochure" &&
      !value.assetPublicId &&
      !value.brochure?.publicId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "El folleto requiere assetPublicId o brochure.publicId",
        path: ["assetPublicId"],
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
  brochureBlocks: z.array(proposalPdfBlockSchema).optional().default([]),
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
  brochureBlocks: z.array(proposalPdfBlockSchema).optional().default([]),
});

const proposalRebaseSchema = z.object({
  quotationVersionId: z.number().int().positive(),
});

const PRODUCT_BROCHURES_COMPONENT_CODE = "product_brochures";
const PROPOSAL_BROCHURE_RECOMMENDATION_SYSTEM_PROMPT =
  'Selecciona folletos comerciales para adjuntar a una propuesta B2B. Responde exclusivamente con JSON valido. No redactes texto narrativo. Usa solo candidatos provistos. Prioriza assets client_safe, utiles para cliente y alineados al contexto comercial. Devuelve {"recommendedAssetPublicIds": string[], "warnings": string[]}. Nunca inventes publicIds. Devuelve como maximo requestedBrochureCount elementos.';

function isProductBrochuresComponentCode(value) {
  return String(value || "").trim() === PRODUCT_BROCHURES_COMPONENT_CODE;
}

function normalizeProposalBrochureSelectionMode(value, fallback = "manual") {
  if (value === "auto") {
    return "auto";
  }
  return fallback === "auto" ? "auto" : "manual";
}

function normalizeProposalBrochureRequestedCount(
  value,
  fallback = PROPOSAL_BROCHURE_DEFAULT_REQUESTED_COUNT,
) {
  const normalized = Number(value || fallback);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    return PROPOSAL_BROCHURE_DEFAULT_REQUESTED_COUNT;
  }
  return Math.min(PROPOSAL_BROCHURE_MAX_ITEMS, normalized);
}

const proposalComponentBlockSchema = z
  .object({
    id: z.number().int().positive().optional(),
    type: z.enum(["heading", "paragraph", "list", "image", "brochure"]),
    text: z.string().optional().default(""),
    items: z.array(z.string().trim().max(1000)).optional().default([]),
    assetId: z.number().int().positive().optional().nullable(),
    assetVersionId: z.number().int().positive().optional().nullable(),
    assetPublicId: z.string().trim().min(4).max(80).optional().nullable(),
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
      return;
    }

    if (value.type === "brochure" && !value.assetPublicId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Los bloques de folleto requieren assetPublicId",
        path: ["assetPublicId"],
      });
    }
  });

const proposalBrochureComponentSettingsSchema = z
  .object({
    selectionMode: z.enum(["manual", "auto"]).optional(),
    requestedBrochureCount: z
      .number()
      .int()
      .positive()
      .max(PROPOSAL_BROCHURE_MAX_ITEMS)
      .optional(),
  })
  .strict();

const proposalComponentUpdateSchema = z.object({
  title: z.string().trim().min(2).max(190).optional(),
  blocks: z.array(proposalComponentBlockSchema).default([]),
  componentSettings: proposalBrochureComponentSettingsSchema.optional(),
  consumeSuggestionPublicId: z.string().trim().max(64).optional().nullable(),
});

const proposalBrochureRecommendationSchema = z.object({
  requestedBrochureCount: z
    .number()
    .int()
    .positive()
    .max(PROPOSAL_BROCHURE_MAX_ITEMS)
    .optional()
    .default(PROPOSAL_BROCHURE_DEFAULT_REQUESTED_COUNT),
});

const proposalReplaceImageSchema = z.object({
  blockId: z.number().int().positive(),
  assetId: z.number().int().positive(),
  assetVersionId: z.number().int().positive(),
});

const proposalExecutiveSummaryGenerationSchema = z
  .object({
    mode: z
      .enum([PROPOSAL_EXEC_SUMMARY_JOB_TYPE])
      .optional()
      .default(PROPOSAL_EXEC_SUMMARY_JOB_TYPE),
    languageCode: z.string().trim().max(10).optional().default("es"),
    instructions: z.string().trim().max(1000).optional().default(""),
    maxLibraryAssets: z.number().int().positive().max(4).optional().default(4),
    sourceScopeMode: z
      .enum(["both", "documents_only", "library_only"])
      .optional()
      .default("both"),
    librarySourceMode: z.enum(["auto", "manual"]).optional().default("auto"),
    libraryContentMode: z
      .enum(["source_text", "summary_extract"])
      .optional()
      .default("source_text"),
    sourcePriorityMode: z
      .enum(["non_library_first", "library_first", "balanced"])
      .optional()
      .default("balanced"),
    selectedLibraryAssetPublicIds: z
      .array(z.string().trim().min(4).max(80))
      .max(4)
      .optional()
      .default([]),
  })
  .superRefine((value, ctx) => {
    const selectedIds = Array.isArray(value.selectedLibraryAssetPublicIds)
      ? value.selectedLibraryAssetPublicIds.map((item) =>
          String(item || "").trim(),
        )
      : [];
    const uniqueIds = Array.from(new Set(selectedIds.filter(Boolean)));

    if (selectedIds.length !== uniqueIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selectedLibraryAssetPublicIds"],
        message: "No se permiten activos repetidos",
      });
    }

    if (
      value.sourceScopeMode !== "documents_only" &&
      value.librarySourceMode === "manual" &&
      uniqueIds.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selectedLibraryAssetPublicIds"],
        message:
          "Debes seleccionar al menos un activo cuando el modo de fuente es manual",
      });
    }

    if (value.sourceScopeMode === "documents_only" && uniqueIds.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selectedLibraryAssetPublicIds"],
        message:
          "No debes enviar activos de biblioteca cuando el alcance es solo documentos",
      });
    }

    if (
      value.sourceScopeMode !== "documents_only" &&
      value.librarySourceMode === "auto" &&
      uniqueIds.length > 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selectedLibraryAssetPublicIds"],
        message:
          "No debes enviar activos seleccionados cuando el modo de fuente es automatico",
      });
    }
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

const quotationDuplicateSchema = z.object({
  targetOpportunityId: z.number().int().positive(),
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
  isRenewal: z.boolean().optional().default(false),
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
  importWarnings: z.array(z.string().trim().max(500)).optional().default([]),
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

const providerDocumentImportPreviewSchema = z.object({
  documentLinkId: z.number().int().positive(),
  providerId: z.number().int().positive().optional().nullable(),
});

const providerDocumentImportCommercialTermsSchema = z.object({
  deliveryTime: z.string().trim().min(1).max(120).optional().nullable(),
  quotationValidity: z.string().trim().min(1).max(120).optional().nullable(),
  warranty: z.string().trim().min(1).max(120).optional().nullable(),
  paymentTerms: z.string().trim().min(1).max(180).optional().nullable(),
  currencyCode: z.string().trim().min(1).max(20).optional().nullable(),
});

const providerDocumentImportCommercialTermsSelectionSchema = z.object({
  deliveryTime: z.boolean().optional().default(false),
  quotationValidity: z.boolean().optional().default(false),
  warranty: z.boolean().optional().default(false),
  paymentTerms: z.boolean().optional().default(false),
  currencyCode: z.boolean().optional().default(false),
});

const providerDocumentImportResolutionActionSchema = z.enum([
  "use_existing",
  "treat_as_missing",
]);

const providerDocumentImportCreateMissingItemSchema = z.object({
  previewId: z.string().trim().min(1).max(120),
  providerCode: z.string().trim().min(1).max(120),
  productDescription: z.string().trim().min(1).max(5000),
  quantity: z.number().positive(),
  originalCurrencyCode: z.string().trim().min(1).max(20).optional().nullable(),
  resolvedCostUnit: z.number().nonnegative(),
  manufacturerDiscountPct: z.number().min(0).max(100).optional().default(0),
  resolutionAction: providerDocumentImportResolutionActionSchema
    .optional()
    .nullable(),
  selectedSuggestedPriceListItemId: z
    .number()
    .int()
    .positive()
    .optional()
    .nullable(),
  selectedForPriceListCreation: z.boolean().optional().default(false),
});

const providerDocumentImportApplyItemSchema = z.object({
  previewId: z.string().trim().min(1).max(120),
  providerCode: z.string().trim().min(1).max(120),
  productDescription: z.string().trim().min(1).max(5000),
  quantity: z.number().positive(),
  originalCurrencyCode: z.string().trim().min(1).max(20).optional().nullable(),
  resolvedCostUnit: z.number().nonnegative(),
  manufacturerDiscountPct: z.number().min(0).max(100).optional().default(0),
  matchedPriceListItemId: z.number().int().positive().optional().nullable(),
  matchStatus: z.string().trim().min(1).max(80).optional().default("matched"),
  resolutionAction: providerDocumentImportResolutionActionSchema
    .optional()
    .nullable(),
  selectedSuggestedPriceListItemId: z
    .number()
    .int()
    .positive()
    .optional()
    .nullable(),
  sourceSnippet: z.string().trim().max(1000).optional().nullable(),
  warnings: z.array(z.string().trim().min(1).max(500)).optional().default([]),
});

const providerDocumentImportCreateMissingItemsSchema = z.object({
  documentLinkId: z.number().int().positive(),
  confirmedProviderId: z.number().int().positive(),
  items: z.array(providerDocumentImportCreateMissingItemSchema).min(1),
});

const providerDocumentImportDraftCreateMissingItemsSchema = z.object({
  confirmedProviderId: z.number().int().positive(),
  items: z.array(providerDocumentImportCreateMissingItemSchema).min(1),
});

const providerDocumentImportApplySchema = z.object({
  documentLinkId: z.number().int().positive(),
  confirmedProviderId: z.number().int().positive(),
  commercialTerms: providerDocumentImportCommercialTermsSchema.optional(),
  commercialTermsSelection:
    providerDocumentImportCommercialTermsSelectionSchema.optional(),
  items: z.array(providerDocumentImportApplyItemSchema).min(1),
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
let ensureQuotationDocumentImportsSchemaPromise;
let ensureQuotationProviderDocumentImportPreviewJobSchemaPromise;
let ensureProposalSchemaPromise;
let quotationProviderDocumentImportPreviewWorkerQueued = false;
let quotationProviderDocumentImportPreviewWorkerStarted = false;
const tableColumnPresenceCache = new Map();

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

async function hasTableColumn(tableName, columnName) {
  const columnCacheKey = `${tableName}.${columnName}`;

  if (tableColumnPresenceCache.has(columnCacheKey)) {
    return tableColumnPresenceCache.get(columnCacheKey);
  }

  const safeTableName = String(tableName || "")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .trim();
  const safeColumnName = String(columnName || "")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .trim();

  if (!safeTableName || !safeColumnName) {
    throw new Error("Invalid table or column name for proposal schema");
  }

  let hasColumn;
  try {
    const rows = await query(
      `SELECT 1
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = '${safeTableName}'
         AND COLUMN_NAME = '${safeColumnName}'
       LIMIT 1`,
    );
    hasColumn = rows.length > 0;
  } catch (_error) {
    // Fallback for environments with restricted information_schema access.
    const rows = await query(
      `SHOW COLUMNS FROM \`${safeTableName}\` LIKE '${safeColumnName}'`,
    );
    hasColumn = rows.length > 0;
  }

  tableColumnPresenceCache.set(columnCacheKey, hasColumn);
  return hasColumn;
}

async function ensureTableColumn(tableName, columnName, ddl) {
  const columnCacheKey = `${tableName}.${columnName}`;
  const hasColumn = await hasTableColumn(tableName, columnName);

  if (!hasColumn) {
    await query(ddl);
    tableColumnPresenceCache.set(columnCacheKey, true);
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
          ai_enabled TINYINT(1) NOT NULL DEFAULT 1,
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

      await ensureTableColumn(
        "quotation_version_documents",
        "ai_enabled",
        `ALTER TABLE quotation_version_documents
         ADD COLUMN ai_enabled TINYINT(1) NOT NULL DEFAULT 1
         AFTER document_id`,
      );
    })().catch((error) => {
      ensureQuotationVersionDocumentsSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureQuotationVersionDocumentsSchemaPromise;
}

async function ensureQuotationDocumentImportsSchema() {
  if (!ensureQuotationDocumentImportsSchemaPromise) {
    ensureQuotationDocumentImportsSchemaPromise = (async () => {
      await query(
        `CREATE TABLE IF NOT EXISTS quotation_version_document_imports (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          quotation_id BIGINT UNSIGNED NOT NULL,
          quotation_version_id BIGINT UNSIGNED NOT NULL,
          document_id BIGINT UNSIGNED NOT NULL,
          provider_id BIGINT UNSIGNED NOT NULL,
          created_section_id BIGINT UNSIGNED NOT NULL,
          requested_by_user_id BIGINT UNSIGNED NOT NULL,
          preview_snapshot_json LONGTEXT NULL,
          apply_snapshot_json LONGTEXT NULL,
          warnings_json LONGTEXT NULL,
          created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          CONSTRAINT fk_qvdi_quotation FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE,
          CONSTRAINT fk_qvdi_version FOREIGN KEY (quotation_version_id) REFERENCES quotation_versions(id) ON DELETE CASCADE,
          CONSTRAINT fk_qvdi_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
          CONSTRAINT fk_qvdi_provider FOREIGN KEY (provider_id) REFERENCES providers(id),
          CONSTRAINT fk_qvdi_section FOREIGN KEY (created_section_id) REFERENCES quotation_sections(id) ON DELETE CASCADE,
          CONSTRAINT fk_qvdi_requested_by FOREIGN KEY (requested_by_user_id) REFERENCES users(id),
          INDEX idx_qvdi_document (document_id, created_at),
          INDEX idx_qvdi_version (quotation_version_id, created_at),
          INDEX idx_qvdi_quotation (quotation_id, created_at)
        )`,
      );
    })().catch((error) => {
      ensureQuotationDocumentImportsSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureQuotationDocumentImportsSchemaPromise;
}

export async function ensureQuotationProviderDocumentImportPreviewJobSchema() {
  if (!ensureQuotationProviderDocumentImportPreviewJobSchemaPromise) {
    ensureQuotationProviderDocumentImportPreviewJobSchemaPromise =
      (async () => {
        await query(
          `CREATE TABLE IF NOT EXISTS quotation_provider_document_import_preview_jobs (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          public_id VARCHAR(64) NOT NULL,
          quotation_id BIGINT UNSIGNED NOT NULL,
          quotation_version_id BIGINT UNSIGNED NOT NULL,
          document_id BIGINT UNSIGNED NOT NULL,
          provider_id BIGINT UNSIGNED NULL,
          requested_by_user_id BIGINT UNSIGNED NOT NULL,
          status ENUM('pending','running','completed','failed','stale') NOT NULL DEFAULT 'pending',
          request_fingerprint CHAR(64) NOT NULL,
          progress_phase VARCHAR(80) NULL,
          progress_label VARCHAR(255) NULL,
          progress_percent INT UNSIGNED NOT NULL DEFAULT 0,
          source_snapshot_json LONGTEXT NULL,
          result_json LONGTEXT NULL,
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
          UNIQUE KEY uq_qpdip_jobs_public_id (public_id),
          KEY idx_qpdip_jobs_lookup (quotation_version_id, requested_by_user_id, created_at),
          KEY idx_qpdip_jobs_process (status, lease_expires_at, created_at),
          CONSTRAINT fk_qpdip_jobs_quotation FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE,
          CONSTRAINT fk_qpdip_jobs_version FOREIGN KEY (quotation_version_id) REFERENCES quotation_versions(id) ON DELETE CASCADE,
          CONSTRAINT fk_qpdip_jobs_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
          CONSTRAINT fk_qpdip_jobs_provider FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL,
          CONSTRAINT fk_qpdip_jobs_requested_by FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        );
      })().catch((error) => {
        ensureQuotationProviderDocumentImportPreviewJobSchemaPromise =
          undefined;
        throw error;
      });
  }

  return ensureQuotationProviderDocumentImportPreviewJobSchemaPromise;
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

      await ensureTableColumn(
        "proposal_templates",
        "archived_at",
        `ALTER TABLE proposal_templates
         ADD COLUMN archived_at DATETIME(3) NULL
         AFTER updated_at`,
      );

      await ensureTableColumn(
        "proposals",
        "archived_at",
        `ALTER TABLE proposals
         ADD COLUMN archived_at DATETIME(3) NULL
         AFTER updated_at`,
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
    aiEnabled: row.ai_enabled == null ? true : Number(row.ai_enabled) === 1,
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
            qvd.ai_enabled,
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
            qvd.ai_enabled,
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

function roundProviderDocumentImportMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function normalizeProviderDocumentImportCurrencyCode(value, fallback = "USD") {
  const normalized = String(value || fallback || "USD")
    .trim()
    .toUpperCase();
  return normalized || "USD";
}

function normalizeProviderDocumentImportText(value, maxLength = 5000) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

const PROVIDER_DOCUMENT_IMPORT_ITEM_WARNING_SEVERITIES = [
  "info",
  "warning",
  "blocking",
];

function buildProviderDocumentImportItemWarning({
  code,
  severity = "info",
  action,
  descriptionNote,
}) {
  const normalizedCode = String(code || "").trim();
  const normalizedAction = normalizeProviderDocumentImportText(action, 240);
  const normalizedDescriptionNote = normalizeProviderDocumentImportText(
    descriptionNote,
    500,
  );
  if (!normalizedCode || !normalizedAction || !normalizedDescriptionNote) {
    return null;
  }

  return {
    code: normalizedCode,
    severity: PROVIDER_DOCUMENT_IMPORT_ITEM_WARNING_SEVERITIES.includes(
      String(severity || "").trim(),
    )
      ? String(severity).trim()
      : "info",
    action: normalizedAction,
    descriptionNote: normalizedDescriptionNote,
  };
}

function dedupeProviderDocumentImportItemWarnings(itemWarnings = []) {
  const warnings = Array.isArray(itemWarnings) ? itemWarnings : [itemWarnings];
  const seen = new Set();
  return warnings.filter((warning) => {
    if (!warning || typeof warning !== "object") {
      return false;
    }

    const key = `${String(warning.code || "").trim()}::${String(
      warning.descriptionNote || "",
    ).trim()}`;
    if (!String(warning.code || "").trim() || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildProviderDocumentImportWarningStrings(itemWarnings = []) {
  return Array.from(
    new Set(
      dedupeProviderDocumentImportItemWarnings(itemWarnings)
        .map((warning) =>
          normalizeProviderDocumentImportText(
            warning.descriptionNote || warning.action,
            500,
          ),
        )
        .filter(Boolean),
    ),
  );
}

function buildProviderDocumentImportItemSignalText(item) {
  return [
    item?.providerCode,
    item?.productDescription,
    item?.notes,
    item?.sourceSnippet,
    item?.warranty,
    ...(Array.isArray(item?.detectedFields) ? item.detectedFields : []),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" | ");
}

function extractProviderDocumentImportServiceTermMonths(text) {
  const rawText = String(text || "");
  const match = rawText.match(
    /(?:service\s+term|subscription|maintenance|support|renewal|contract)?\s*:?\s*(\d{1,3})\s*(?:months?|meses?|month|mes)\b/i,
  );
  const monthCount = Number(match?.[1] || 0);
  return Number.isInteger(monthCount) && monthCount > 0 ? monthCount : null;
}

function detectProviderDocumentImportServiceType(text) {
  const rawText = String(text || "");
  if (
    /maintenance|soporte|support\s+contract|hardware\s+only\s+maintenance/i.test(
      rawText,
    )
  ) {
    return "maintenance";
  }
  if (/subscription|subscripcion|saas|license\s+subscription/i.test(rawText)) {
    return "subscription";
  }
  return null;
}

function buildProviderDocumentImportSpecificWarnings({
  item,
  activePriceList,
  selectedProvider,
  suggestedProviderCandidate,
  hasProviderMismatch,
  suggestedMatchCandidates = [],
  createBlockedReason = null,
}) {
  const signalText = buildProviderDocumentImportItemSignalText(item);
  const serviceType = detectProviderDocumentImportServiceType(signalText);
  const serviceTermMonths =
    extractProviderDocumentImportServiceTermMonths(signalText);
  const warnings = [];

  if (serviceTermMonths) {
    warnings.push(
      buildProviderDocumentImportItemWarning({
        code: "service_term_detected",
        severity: "warning",
        action:
          "Confirmar que la vigencia detectada corresponde al periodo cotizado y que el precio aplica al plazo completo.",
        descriptionNote:
          serviceType === "maintenance"
            ? `Se detectó mantenimiento con vigencia de ${serviceTermMonths} meses; confirma cobertura y periodo exacto.`
            : serviceType === "subscription"
              ? `Se detectó una suscripción por ${serviceTermMonths} meses; confirma vigencia y si el precio corresponde al plazo completo.`
              : `Se detectó un término de servicio de ${serviceTermMonths} meses; confirma vigencia y alcance del periodo cotizado.`,
      }),
    );
  }

  if (serviceType === "subscription") {
    warnings.push(
      buildProviderDocumentImportItemWarning({
        code: "subscription_scope_review",
        severity: "warning",
        action:
          "Validar si el item corresponde a suscripción nueva, renovación o ampliación, y confirmar alcance funcional y vigencia.",
        descriptionNote:
          "El item parece corresponder a una suscripción; valida vigencia, alcance funcional y tipo de contratación.",
      }),
    );
  }

  if (serviceType === "maintenance") {
    warnings.push(
      buildProviderDocumentImportItemWarning({
        code: "maintenance_scope_review",
        severity: "warning",
        action:
          "Verificar activo o licencia base asociada y confirmar cobertura, vigencia y nivel de soporte.",
        descriptionNote:
          "El item parece corresponder a mantenimiento; valida cobertura, vigencia y activo o licencia base asociada.",
      }),
    );
  }

  if (/renewal|renovacion|renew|co-?term|coterm|extension/i.test(signalText)) {
    warnings.push(
      buildProviderDocumentImportItemWarning({
        code: "renewal_indicator_detected",
        severity: "warning",
        action:
          "Confirmar si el item debe cotizarse como renovación y revisar fechas de inicio, vencimiento o co-terminación.",
        descriptionNote:
          "El item parece una renovación; confirma fechas de vigencia y si requiere co-terminación.",
      }),
    );
  }

  if (/bundle|package|suite|includes|incluye|edition/i.test(signalText)) {
    warnings.push(
      buildProviderDocumentImportItemWarning({
        code: "included_components_unclear",
        severity: "warning",
        action:
          "Confirmar qué componentes, módulos o servicios están incluidos y cuáles deben cotizarse por separado.",
        descriptionNote:
          "El item parece incluir componentes o módulos; confirma el alcance exacto de lo incluido.",
      }),
    );
  }

  if (/warranty|garantia|24x7|nbd|rma|advance replacement/i.test(signalText)) {
    warnings.push(
      buildProviderDocumentImportItemWarning({
        code: "warranty_reference_detected",
        severity: "info",
        action:
          "Verificar plazo, cobertura y condiciones de garantía indicadas para el item.",
        descriptionNote:
          "El item incluye una referencia de garantía; valida plazo, cobertura y condiciones aplicables.",
      }),
    );
  }

  if (
    /shipping|freight|delivery|logistics|transport|flete|envio/i.test(
      signalText,
    )
  ) {
    warnings.push(
      buildProviderDocumentImportItemWarning({
        code: "shipping_or_freight_detected",
        severity: "warning",
        action:
          "Confirmar destino, alcance logístico y si el cargo debe cotizarse como línea separada.",
        descriptionNote:
          "El item parece corresponder a logística o flete; valida destino y alcance del cargo.",
      }),
    );
  }

  if (
    /payment terms|lead time|delivery time|validity|condiciones comerciales/i.test(
      signalText,
    )
  ) {
    warnings.push(
      buildProviderDocumentImportItemWarning({
        code: "commercial_conditions_reference_detected",
        severity: "info",
        action:
          "Revisar si el item depende de condiciones comerciales específicas y confirmar su aplicación.",
        descriptionNote:
          "El item hace referencia a condiciones comerciales específicas; valida su aplicación en esta cotización.",
      }),
    );
  }

  if (Number(item?.resolvedCostUnit || 0) <= 0) {
    warnings.push(
      buildProviderDocumentImportItemWarning({
        code: "price_not_reliable",
        severity: "blocking",
        action:
          "Revisar el costo unitario antes de aplicar el item en la cotización.",
        descriptionNote:
          "No se pudo validar un costo unitario confiable para este item; revisa el precio antes de aplicarlo.",
      }),
    );
  }

  if (
    item?.originalCurrencyCode &&
    activePriceList?.currency_code &&
    normalizeProviderDocumentImportCurrencyCode(item.originalCurrencyCode) !==
      normalizeProviderDocumentImportCurrencyCode(activePriceList.currency_code)
  ) {
    warnings.push(
      buildProviderDocumentImportItemWarning({
        code: "currency_mismatch",
        severity: "blocking",
        action:
          "Validar la moneda del item contra la lista activa del proveedor y corregir antes de importar.",
        descriptionNote:
          "La moneda detectada no coincide con la lista activa del proveedor; valida la moneda antes de aplicar.",
      }),
    );
  }

  if (hasProviderMismatch && selectedProvider && suggestedProviderCandidate) {
    warnings.push(
      buildProviderDocumentImportItemWarning({
        code: "provider_mismatch",
        severity: "blocking",
        action:
          "Confirmar si el proveedor detectado es correcto antes de importar el item.",
        descriptionNote: `El proveedor detectado (${suggestedProviderCandidate.name}) no coincide con el confirmado (${selectedProvider.name}); valida el proveedor antes de continuar.`,
      }),
    );
  }

  if (
    Array.isArray(suggestedMatchCandidates) &&
    suggestedMatchCandidates.length > 1
  ) {
    warnings.push(
      buildProviderDocumentImportItemWarning({
        code: "provider_code_ambiguous",
        severity: "warning",
        action:
          "Revisar coincidencias similares en la lista del proveedor y seleccionar manualmente el código correcto.",
        descriptionNote:
          "El código del item tiene varias coincidencias posibles; valida manualmente la referencia correcta.",
      }),
    );
  }

  if (
    item?.confidence === "low" ||
    (!String(item?.sourceSnippet || "").trim() &&
      String(item?.notes || "").trim())
  ) {
    warnings.push(
      buildProviderDocumentImportItemWarning({
        code: "source_evidence_weak",
        severity: "warning",
        action:
          "Confirmar manualmente el detalle del item porque la evidencia detectada en el documento es incompleta o ambigua.",
        descriptionNote:
          "La evidencia del documento para este item es limitada; valida manualmente el detalle antes de aplicarlo.",
      }),
    );
  }

  if (
    /user|seat|node|device|appliance|instance|site license/i.test(signalText)
  ) {
    warnings.push(
      buildProviderDocumentImportItemWarning({
        code: "license_metric_unclear",
        severity: "warning",
        action:
          "Validar la métrica de licenciamiento aplicable y cómo se relaciona con la cantidad cotizada.",
        descriptionNote:
          "El licenciamiento del item requiere validación; confirma la métrica aplicable y su relación con la cantidad.",
      }),
    );
  }

  if (
    createBlockedReason &&
    /lista activa|price list/i.test(String(createBlockedReason))
  ) {
    warnings.push(
      buildProviderDocumentImportItemWarning({
        code: "provider_price_list_missing",
        severity: "blocking",
        action:
          "Confirmar la lista activa del proveedor antes de crear o importar este item.",
        descriptionNote:
          "El proveedor confirmado no tiene una lista activa compatible para este item; valida la lista antes de continuar.",
      }),
    );
  }

  return dedupeProviderDocumentImportItemWarnings(warnings);
}

function normalizeProviderDocumentImportWarningToSpanish(warning) {
  const normalizedWarning = normalizeProviderDocumentImportText(warning, 500);
  if (!normalizedWarning) {
    return "";
  }

  const comparableWarning =
    normalizeProviderDocumentImportComparableText(normalizedWarning);
  const knownWarningsByComparable = {
    "no se pudo resolver un costo unitario confiable":
      "No se pudo resolver un costo unitario confiable",
    "el proveedor confirmado no tiene una lista activa de productos para importar":
      "El proveedor confirmado no tiene una lista activa de productos para importar",
    "el item no tiene codigo de proveedor":
      "El item no tiene codigo de proveedor",
    "el item no tiene descripcion suficiente":
      "El item no tiene descripcion suficiente",
    "el item no tiene un costo confiable para crear en lista":
      "No se pudo resolver un costo unitario confiable",
    "la moneda del item no coincide con la lista activa del proveedor":
      "La moneda del item no coincide con la lista activa del proveedor",
    "unable to resolve a reliable unit cost":
      "No se pudo resolver un costo unitario confiable",
    "could not resolve a reliable unit cost":
      "No se pudo resolver un costo unitario confiable",
    "the confirmed provider does not have an active product price list for import":
      "El proveedor confirmado no tiene una lista activa de productos para importar",
    "the item does not have supplier code":
      "El item no tiene codigo de proveedor",
    "the item does not have enough description":
      "El item no tiene descripcion suficiente",
    "the item does not have enough description to create":
      "El item no tiene descripcion suficiente",
    "the item does not have a reliable cost to create in price list":
      "No se pudo resolver un costo unitario confiable",
    "item currency does not match provider active list":
      "La moneda del item no coincide con la lista activa del proveedor",
  };

  if (knownWarningsByComparable[comparableWarning]) {
    return knownWarningsByComparable[comparableWarning];
  }

  const serviceTermMatch = comparableWarning.match(
    /^(subscription|maintenance)(?: with service)? term:? (\d+) months?$/,
  );
  if (serviceTermMatch) {
    const warningType =
      serviceTermMatch[1] === "maintenance" ? "Mantenimiento" : "Suscripcion";
    const monthCount = Number(serviceTermMatch[2]) || 0;
    return `El item corresponde a ${
      warningType === "Mantenimiento" ? "mantenimiento" : "una suscripcion"
    } con termino de servicio de ${monthCount} ${
      monthCount === 1 ? "mes" : "meses"
    }`;
  }

  const bareServiceTermMatch = comparableWarning.match(
    /^service term:? (\d+) months?$/,
  );
  if (bareServiceTermMatch) {
    const monthCount = Number(bareServiceTermMatch[1]) || 0;
    return `El item indica un termino de servicio de ${monthCount} ${
      monthCount === 1 ? "mes" : "meses"
    }`;
  }

  if (/subscription/i.test(normalizedWarning)) {
    return "El item corresponde a una suscripcion y conviene validar su vigencia y alcance en el documento fuente";
  }

  if (/maintenance/i.test(normalizedWarning)) {
    return "El item corresponde a mantenimiento y conviene validar su vigencia y alcance en el documento fuente";
  }

  if (/warranty|garantia/i.test(normalizedWarning)) {
    return "Este item incluye una referencia a garantia; revisa el plazo y el alcance indicados en el documento fuente";
  }

  if (/delivery|shipping|freight/i.test(normalizedWarning)) {
    return "Este item incluye una referencia a entrega o flete; revisa el alcance logistico indicado en el documento fuente";
  }

  if (
    comparableWarning ===
    "warning imported from ai analysis review item detail in source document"
  ) {
    return "Este item requiere revisar el detalle, el alcance y las condiciones comerciales indicadas en el documento fuente";
  }

  if (
    /\b(unable|could not|missing|invalid|provider|price list|currency|cost|item|with|service|term|month|months|subscription|maintenance|review|source|document)\b/i.test(
      normalizedWarning,
    )
  ) {
    return "Este item tiene una observacion relevante; revisa el detalle, el alcance y las condiciones comerciales antes de aplicarlo";
  }

  return comparableWarning ===
    normalizeProviderDocumentImportComparableText(normalizedWarning)
    ? normalizedWarning
    : "Este item tiene una observacion; revisa el documento fuente antes de aplicarlo";
}

function normalizeProviderDocumentImportWarningsToSpanish(warnings = []) {
  const sourceWarnings = Array.isArray(warnings) ? warnings : [warnings];
  return Array.from(
    new Set(
      sourceWarnings
        .map((warning) =>
          normalizeProviderDocumentImportWarningToSpanish(warning),
        )
        .filter(Boolean),
    ),
  );
}

function appendProviderDocumentImportWarningsToDescription(
  description,
  selectedWarnings = [],
) {
  const baseDescription =
    normalizeProviderDocumentImportDescription(description);
  const normalizedBase = normalizeText(baseDescription).replace(/[_-]+/g, " ");
  const uniqueWarnings = Array.from(
    new Set(
      normalizeProviderDocumentImportWarningsToSpanish(selectedWarnings).filter(
        (warning) => {
          const normalizedWarning = normalizeText(warning).replace(
            /[_-]+/g,
            " ",
          );
          return (
            normalizedWarning && !normalizedBase.includes(normalizedWarning)
          );
        },
      ),
    ),
  );

  if (!uniqueWarnings.length) {
    return baseDescription;
  }

  const notesBlock = uniqueWarnings
    .map((warning) => `Nota: ${warning}`)
    .join("\n");

  return baseDescription ? `${baseDescription}\n${notesBlock}` : notesBlock;
}

function normalizeProviderDocumentImportDescription(value) {
  const normalizedValue = String(value || "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!normalizedValue) {
    return "";
  }

  const segments = normalizedValue
    .split(/Nota:\s*/g)
    .map((segment) => String(segment || "").trim())
    .filter(Boolean);

  if (segments.length <= 1) {
    return normalizedValue;
  }

  const [baseDescription, ...noteSegments] = segments;
  const notesBlock = noteSegments
    .map((segment) => `Nota: ${segment}`)
    .join("\n");
  return [baseDescription, notesBlock].filter(Boolean).join("\n");
}

function resolveProviderDocumentImportPreviewErrorMessage(
  error,
  fallbackMessage = "No fue posible analizar el documento del proveedor",
) {
  const directMessage = String(error?.message || "").trim();
  if (directMessage) {
    return directMessage;
  }

  if (typeof error === "string") {
    const rawMessage = error.trim();
    if (rawMessage) {
      return rawMessage;
    }
  }

  const causeMessage = String(error?.cause?.message || "").trim();
  if (causeMessage) {
    return causeMessage;
  }

  const errorName = String(error?.name || "").trim();
  const errorCode = String(error?.code || "").trim();
  if (errorName || errorCode) {
    return [errorName, errorCode].filter(Boolean).join(" ");
  }

  if (error && typeof error === "object") {
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") {
        return serialized;
      }
    } catch {
      // Ignore serialization failures and fall back to the default message.
    }
  }

  return fallbackMessage;
}

const PROVIDER_DOCUMENT_IMPORT_COMMERCIAL_NOTES_MAX_LENGTH = 50000;
const PROVIDER_DOCUMENT_IMPORT_COMMERCIAL_FALLBACK_CODE = "segun_notas";
const PROVIDER_DOCUMENT_IMPORT_COMMERCIAL_ALIASES_BY_FIELD = {
  deliveryTime: {
    inmediato: "inmediato",
    "5 dias": "5_dias",
    "10 dias": "10_dias",
    "15 dias": "15_dias",
    "30 dias": "30_dias",
    "45 dias": "45_dias",
    "60 dias": "60_dias",
    "de acuerdo a lo indicado en notas": "segun_notas",
  },
  quotationValidity: {
    "5 dias": "5_dias",
    "10 dias": "10_dias",
    "15 dias": "15_dias",
    "30 dias": "30_dias",
    "45 dias": "45_dias",
    "60 dias": "60_dias",
    "de acuerdo a lo indicado en notas": "segun_notas",
  },
  warranty: {
    "1 ano": "1_ano",
    "2 anos": "2_anos",
    "3 anos": "3_anos",
    "4 anos": "4_anos",
    "5 anos": "5_anos",
    "de acuerdo a lo indicado en notas": "segun_notas",
  },
  paymentTerms: {
    contado: "100_adelantado",
    "100% adelantado": "100_adelantado",
    "50% adelantado - 50% contra entrega": "50_adelantado_50_entrega",
    "50% anticipo y saldo contra entrega": "50_adelantado_50_entrega",
    "100% contra entrega": "100_entrega",
    "factura a 15 dias": "15_dias_facturado",
    "15 dias despues de facturado": "15_dias_facturado",
    "factura a 30 dias": "30_dias_facturado",
    "30 dias despues de facturado": "30_dias_facturado",
    "45 dias despues de facturado": "45_dias_facturado",
    "60 dias despues de facturado": "60_dias_facturado",
    "90 dias despues de facturado": "90_dias_facturado",
    "de acuerdo a lo indicado en notas": "segun_notas",
  },
};

function normalizeProviderDocumentImportComparableText(value) {
  return normalizeProviderDocumentImportText(value, 500)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function listActiveQuotationCommercialTermOptions(tableName) {
  const allowedTables = new Set([
    "quotation_delivery_times",
    "quotation_validity_terms",
    "quotation_warranty_terms",
    "quotation_payment_terms",
  ]);
  if (!allowedTables.has(tableName)) {
    return [];
  }

  const rows = await query(
    `SELECT code, name
     FROM ${tableName}
     WHERE is_active = 1
     ORDER BY display_order, id`,
  );

  return rows.map((row) => ({
    code: String(row.code || "").trim(),
    name: String(row.name || "").trim(),
  }));
}

function buildProviderDocumentImportCommercialTermIndex(options = []) {
  const byCode = new Map();
  const byComparableName = new Map();

  for (const option of options) {
    const code = String(option?.code || "").trim();
    const name = String(option?.name || "").trim();
    if (!code) continue;
    byCode.set(code.toLowerCase(), code);
    const comparableName = normalizeProviderDocumentImportComparableText(name);
    if (comparableName && !byComparableName.has(comparableName)) {
      byComparableName.set(comparableName, code);
    }
  }

  return {
    byCode,
    byComparableName,
    fallbackCode:
      byCode.get(PROVIDER_DOCUMENT_IMPORT_COMMERCIAL_FALLBACK_CODE) ||
      byCode.get(
        PROVIDER_DOCUMENT_IMPORT_COMMERCIAL_FALLBACK_CODE.toLowerCase(),
      ) ||
      null,
  };
}

function resolveProviderDocumentImportCommercialTermCode({
  field,
  value,
  index,
}) {
  const rawValue = normalizeProviderDocumentImportText(value, 180);
  if (!rawValue) {
    return {
      code: "",
      usedFallback: false,
      unresolvedText: "",
    };
  }

  const lowerRawValue = rawValue.toLowerCase();
  const exactCodeMatch = index.byCode.get(lowerRawValue);
  if (exactCodeMatch) {
    return {
      code: exactCodeMatch,
      usedFallback: false,
      unresolvedText: "",
    };
  }

  const comparableValue =
    normalizeProviderDocumentImportComparableText(rawValue);
  const byNameMatch = index.byComparableName.get(comparableValue);
  if (byNameMatch) {
    return {
      code: byNameMatch,
      usedFallback: false,
      unresolvedText: "",
    };
  }

  const aliasCode =
    PROVIDER_DOCUMENT_IMPORT_COMMERCIAL_ALIASES_BY_FIELD?.[field]?.[
      comparableValue
    ] || null;
  if (aliasCode) {
    const normalizedAliasCode = String(aliasCode).toLowerCase();
    const aliasMatch = index.byCode.get(normalizedAliasCode);
    if (aliasMatch) {
      return {
        code: aliasMatch,
        usedFallback: false,
        unresolvedText: "",
      };
    }
  }

  if (index.fallbackCode) {
    return {
      code: index.fallbackCode,
      usedFallback: true,
      unresolvedText: rawValue,
    };
  }

  return {
    code: rawValue,
    usedFallback: false,
    unresolvedText: "",
  };
}

function appendProviderDocumentImportNotes(baseNotes, noteLines = []) {
  const currentNotes = String(baseNotes || "").trim();
  const normalizedNotes =
    normalizeProviderDocumentImportComparableText(currentNotes);
  const uniqueLines = noteLines
    .map((line) => normalizeProviderDocumentImportText(line, 500))
    .filter(Boolean)
    .filter((line) => {
      const comparableLine =
        normalizeProviderDocumentImportComparableText(line);
      return comparableLine && !normalizedNotes.includes(comparableLine);
    });

  if (!uniqueLines.length) {
    return currentNotes;
  }

  const noteBlock = uniqueLines.map((line) => `- ${line}`).join("\n");

  const combinedNotes = currentNotes
    ? `${currentNotes}\n\n${noteBlock}`
    : noteBlock;
  return combinedNotes.slice(
    0,
    PROVIDER_DOCUMENT_IMPORT_COMMERCIAL_NOTES_MAX_LENGTH,
  );
}

function formatProviderDocumentImportFallbackNoteValue(value) {
  const rawValue = normalizeProviderDocumentImportText(value, 180);
  if (!rawValue) {
    return "";
  }

  const comparableValue = normalizeProviderDocumentImportComparableText(
    rawValue,
  ).replace(/[_-]+/g, " ");

  if (
    comparableValue === "de acuerdo a lo indicado en notas" ||
    comparableValue === "segun notas" ||
    comparableValue === "according to notes" ||
    comparableValue === "as indicated in notes"
  ) {
    return "De acuerdo a lo indicado en notas";
  }

  const isoDateMatch = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch;
    return `${day}/${month}/${year}`;
  }

  const dayMatch = comparableValue.match(/^(\d+)\s*(?:dias?|days?)$/u);
  if (dayMatch) {
    return `${dayMatch[1]} dias`;
  }

  const yearMatch = comparableValue.match(/^(\d+)\s*(?:anos?|years?)$/u);
  if (yearMatch) {
    return `${yearMatch[1]} ${yearMatch[1] === "1" ? "ano" : "anos"}`;
  }

  const invoicedDaysMatch = comparableValue.match(
    /^(?:factura a )?(\d+)\s*(?:dias?|days?)\s*(?:despues de facturado|after invoiced|after invoice|after billing|net)?$/u,
  );
  if (invoicedDaysMatch) {
    return `${invoicedDaysMatch[1]} dias despues de facturado`;
  }

  const netDaysMatch = comparableValue.match(/^net\s*(\d+)$/u);
  if (netDaysMatch) {
    return `${netDaysMatch[1]} dias despues de facturado`;
  }

  if (
    comparableValue === "inmediato" ||
    comparableValue === "immediate" ||
    comparableValue === "immediately"
  ) {
    return "Inmediato";
  }

  if (
    comparableValue === "contado" ||
    comparableValue === "cash" ||
    comparableValue === "cash in advance" ||
    comparableValue === "advance payment" ||
    comparableValue === "100 adelantado" ||
    comparableValue === "100% adelantado" ||
    comparableValue === "100 advance" ||
    comparableValue === "100% advance" ||
    comparableValue === "100 upfront" ||
    comparableValue === "100% upfront"
  ) {
    return "100% adelantado";
  }

  if (
    comparableValue === "50 adelantado 50 entrega" ||
    comparableValue === "50% adelantado 50% contra entrega" ||
    comparableValue === "50% anticipo y saldo contra entrega" ||
    comparableValue === "50 anticipo y saldo contra entrega" ||
    comparableValue === "50 advance 50 on delivery" ||
    comparableValue === "50% advance 50% on delivery"
  ) {
    return "50% adelantado - 50% contra entrega";
  }

  if (
    comparableValue === "100 entrega" ||
    comparableValue === "100% contra entrega" ||
    comparableValue === "100 on delivery" ||
    comparableValue === "100% on delivery"
  ) {
    return "100% contra entrega";
  }

  return rawValue;
}

function buildProviderDocumentImportFallbackNoteLine(label, value) {
  const formattedValue = formatProviderDocumentImportFallbackNoteValue(value);
  if (!formattedValue) {
    return "";
  }

  return `${label}: ${formattedValue}`;
}

function normalizeProviderDocumentImportCost({
  resolvedCostUnit,
  unitPrice,
  listPriceUnit,
  discountPct,
}) {
  const explicitCost = Number(resolvedCostUnit);
  if (Number.isFinite(explicitCost) && explicitCost >= 0) {
    return explicitCost;
  }

  const normalizedUnitPrice = Number(unitPrice);
  if (Number.isFinite(normalizedUnitPrice) && normalizedUnitPrice >= 0) {
    return normalizedUnitPrice;
  }

  const normalizedListPrice = Number(listPriceUnit);
  const normalizedDiscountPct = Number(discountPct);
  if (
    Number.isFinite(normalizedListPrice) &&
    normalizedListPrice >= 0 &&
    Number.isFinite(normalizedDiscountPct) &&
    normalizedDiscountPct >= 0 &&
    normalizedDiscountPct <= 100
  ) {
    return normalizedListPrice * (1 - normalizedDiscountPct / 100);
  }

  if (Number.isFinite(normalizedListPrice) && normalizedListPrice >= 0) {
    return normalizedListPrice;
  }

  return 0;
}

function buildProviderDocumentImportCommercialTermsSuggestion(analysis = {}) {
  return {
    deliveryTime:
      normalizeProviderDocumentImportText(analysis.deliveryTime, 120) ||
      "30 dias",
    quotationValidity:
      normalizeProviderDocumentImportText(analysis.quotationValidity, 120) ||
      "30 dias",
    warranty:
      normalizeProviderDocumentImportText(analysis.warranty, 120) || "1 ano",
    paymentTerms:
      normalizeProviderDocumentImportText(analysis.paymentTerms, 180) ||
      "30 dias",
    currencyCode: normalizeProviderDocumentImportCurrencyCode(
      analysis.currencyCode,
      "USD",
    ),
  };
}

async function listActiveProvidersForImport() {
  const rows = await query(
    `SELECT p.id, p.name
     FROM providers p
     INNER JOIN provider_activation_statuses pas ON pas.id = p.activation_status_id
     WHERE pas.code = 'activado'
     ORDER BY p.name, p.id`,
  );

  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name || "",
  }));
}

async function getActiveProviderImportPriceList(providerId) {
  const rows = await query(
    `SELECT ppl.id, ppl.provider_id, ppl.name, ppl.currency_id, ppl.item_type,
            curr.code AS currency_code, curr.name AS currency_name,
            p.name AS provider_name
     FROM provider_price_lists ppl
     INNER JOIN providers p ON p.id = ppl.provider_id
     INNER JOIN provider_activation_statuses pas ON pas.id = p.activation_status_id
     INNER JOIN currencies curr ON curr.id = ppl.currency_id
     WHERE ppl.provider_id = ?
       AND ppl.is_active = 1
       AND ppl.item_type = 'producto'
       AND pas.code = 'activado'
     ORDER BY ppl.id DESC
     LIMIT 1`,
    [Number(providerId)],
  );

  return rows.length ? rows[0] : null;
}

async function getCurrencyByCode(code) {
  if (!String(code || "").trim()) return null;
  const rows = await query(
    `SELECT id, code, name
     FROM currencies
     WHERE UPPER(code) = ?
     LIMIT 1`,
    [normalizeProviderDocumentImportCurrencyCode(code)],
  );
  return rows.length ? rows[0] : null;
}

async function getQuotationDocumentLinkForQuotation({ quotationId, linkId }) {
  await ensureQuotationVersionDocumentsSchema();
  const rows = await query(
    `SELECT qvd.id AS link_id,
            qvd.quotation_version_id,
            qvd.ai_enabled,
            qv.quotation_id,
            qv.version_number,
            d.id AS document_id,
            d.public_id AS document_public_id,
            d.original_file_name,
            d.stored_file_name,
            d.mime_type,
            d.file_extension,
            d.byte_size,
            d.storage_key,
            d.storage_bucket
     FROM quotation_version_documents qvd
     INNER JOIN quotation_versions qv ON qv.id = qvd.quotation_version_id
     INNER JOIN documents d ON d.id = qvd.document_id
     WHERE qv.quotation_id = ?
       AND qvd.id = ?
       AND COALESCE(d.is_deleted, 0) = 0
     ORDER BY qv.version_number DESC, qvd.created_at DESC, qvd.id DESC
     LIMIT 1`,
    [Number(quotationId), Number(linkId)],
  );

  return rows[0] || null;
}

async function getQuotationDocumentImportHistory({ quotationId, documentId }) {
  await ensureQuotationDocumentImportsSchema();
  const rows = await query(
    `SELECT qvdi.id,
            qvdi.quotation_version_id,
            qvdi.created_section_id,
            qvdi.created_at,
            qv.version_number,
            qs.title AS section_title,
            p.name AS provider_name,
            u.full_name AS requested_by_user_name
     FROM quotation_version_document_imports qvdi
     INNER JOIN quotation_versions qv ON qv.id = qvdi.quotation_version_id
     INNER JOIN quotation_sections qs ON qs.id = qvdi.created_section_id
     INNER JOIN providers p ON p.id = qvdi.provider_id
     INNER JOIN users u ON u.id = qvdi.requested_by_user_id
     WHERE qvdi.quotation_id = ?
       AND qvdi.document_id = ?
     ORDER BY qvdi.created_at DESC, qvdi.id DESC`,
    [Number(quotationId), Number(documentId)],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    quotationVersionId: Number(row.quotation_version_id),
    versionNumber: Number(row.version_number),
    createdSectionId: Number(row.created_section_id),
    sectionTitle: row.section_title || "",
    providerName: row.provider_name || "",
    requestedByUserName: row.requested_by_user_name || "",
    createdAt: row.created_at,
  }));
}

async function getProviderPriceListItemByCode({ priceListId, code }) {
  const rows = await query(
    `SELECT ppli.id, ppli.code, ppli.description, ppli.price, ppli.currency_id
     FROM provider_price_list_items ppli
     INNER JOIN provider_price_list_item_statuses pils ON pils.id = ppli.activation_status_id
     WHERE ppli.price_list_id = ?
       AND ppli.code = ?
       AND pils.code = 'activo'
     LIMIT 1`,
    [Number(priceListId), String(code || "").trim()],
  );

  return rows.length ? rows[0] : null;
}

async function findProviderPriceListItemByNormalizedCode({
  priceListId,
  code,
  excludeItemId = null,
}) {
  const normalizedCode = normalizeProviderDocumentImportCode(code);
  if (!normalizedCode) {
    return null;
  }

  const params = [Number(priceListId), normalizedCode];
  let sql = `SELECT ppli.id, ppli.code, ppli.description, ppli.price, ppli.currency_id,
                    ppli.activation_status_id
     FROM provider_price_list_items ppli
     WHERE ppli.price_list_id = ?
       AND REPLACE(UPPER(TRIM(ppli.code)), ' ', '') = ?`;

  if (excludeItemId != null) {
    sql += " AND ppli.id <> ?";
    params.push(Number(excludeItemId));
  }

  sql += " ORDER BY ppli.id ASC LIMIT 1";
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

function normalizeProviderDocumentImportCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

async function getProviderPriceListItemsByNormalizedCode({
  priceListId,
  code,
}) {
  const normalizedCode = normalizeProviderDocumentImportCode(code);
  if (!normalizedCode) {
    return [];
  }

  const rows = await query(
    `SELECT ppli.id, ppli.code, ppli.description, ppli.price, ppli.currency_id
     FROM provider_price_list_items ppli
     INNER JOIN provider_price_list_item_statuses pils ON pils.id = ppli.activation_status_id
     WHERE ppli.price_list_id = ?
       AND REPLACE(UPPER(TRIM(ppli.code)), ' ', '') = ?
       AND pils.code = 'activo'
     ORDER BY ppli.code ASC
     LIMIT 10`,
    [Number(priceListId), normalizedCode],
  );

  return Array.isArray(rows) ? rows : [];
}

async function listActiveProviderPriceListItems({ priceListId }) {
  const rows = await query(
    `SELECT ppli.id, ppli.code, ppli.description, ppli.price, ppli.currency_id
     FROM provider_price_list_items ppli
     INNER JOIN provider_price_list_item_statuses pils ON pils.id = ppli.activation_status_id
     WHERE ppli.price_list_id = ?
       AND pils.code = 'activo'
     ORDER BY ppli.code ASC`,
    [Number(priceListId)],
  );

  return Array.isArray(rows) ? rows : [];
}

function normalizeProviderDocumentImportCodeComparable(code) {
  return normalizeProviderDocumentImportCode(code).replace(/[^A-Z0-9]/g, "");
}

function computeProviderDocumentImportPrefixLength(left, right) {
  const source = String(left || "");
  const target = String(right || "");
  const maxLength = Math.min(source.length, target.length);
  let length = 0;
  while (length < maxLength && source[length] === target[length]) {
    length += 1;
  }
  return length;
}

function computeProviderDocumentImportLevenshteinDistance(left, right) {
  const source = String(left || "");
  const target = String(right || "");
  if (!source) return target.length;
  if (!target) return source.length;

  const previous = Array.from(
    { length: target.length + 1 },
    (_, index) => index,
  );
  const current = new Array(target.length + 1).fill(0);

  for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex += 1) {
    current[0] = sourceIndex;
    for (let targetIndex = 1; targetIndex <= target.length; targetIndex += 1) {
      const substitutionCost =
        source[sourceIndex - 1] === target[targetIndex - 1] ? 0 : 1;
      current[targetIndex] = Math.min(
        previous[targetIndex] + 1,
        current[targetIndex - 1] + 1,
        previous[targetIndex - 1] + substitutionCost,
      );
    }
    for (let targetIndex = 0; targetIndex <= target.length; targetIndex += 1) {
      previous[targetIndex] = current[targetIndex];
    }
  }

  return previous[target.length];
}

function computeProviderDocumentImportCodeSimilarity(left, right) {
  const normalizedLeft = normalizeProviderDocumentImportCodeComparable(left);
  const normalizedRight = normalizeProviderDocumentImportCodeComparable(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }
  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  const maxLength = Math.max(normalizedLeft.length, normalizedRight.length);
  if (!maxLength) {
    return 0;
  }

  const distance = computeProviderDocumentImportLevenshteinDistance(
    normalizedLeft,
    normalizedRight,
  );
  const similarity = 1 - distance / maxLength;
  const prefixLength = computeProviderDocumentImportPrefixLength(
    normalizedLeft,
    normalizedRight,
  );

  if (
    prefixLength >= 4 &&
    Math.abs(normalizedLeft.length - normalizedRight.length) <= 3
  ) {
    return Math.max(similarity, 0.84);
  }

  return similarity;
}

function buildProviderDocumentImportSimilarMatchCandidates({
  detectedCode,
  activePriceListItems,
}) {
  const normalizedDetected =
    normalizeProviderDocumentImportCodeComparable(detectedCode);
  if (!normalizedDetected) {
    return [];
  }

  return activePriceListItems
    .map((candidate) => {
      const normalizedCandidate = normalizeProviderDocumentImportCodeComparable(
        candidate.code,
      );
      const similarity = computeProviderDocumentImportCodeSimilarity(
        normalizedDetected,
        normalizedCandidate,
      );
      return {
        id: Number(candidate.id),
        code: candidate.code || "",
        description: candidate.description || "",
        similarity,
      };
    })
    .filter((candidate) => candidate.similarity >= 0.84)
    .sort((left, right) => {
      if (right.similarity !== left.similarity) {
        return right.similarity - left.similarity;
      }
      return String(left.code || "").localeCompare(String(right.code || ""));
    })
    .slice(0, 5);
}

function buildProviderDocumentImportSuggestedMatchReason({
  detectedCode,
  matchedCode,
  similarity = null,
}) {
  const normalizedDetected = normalizeProviderDocumentImportCode(detectedCode);
  const normalizedMatched = normalizeProviderDocumentImportCode(matchedCode);
  const comparableDetected =
    normalizeProviderDocumentImportCodeComparable(detectedCode);
  const comparableMatched =
    normalizeProviderDocumentImportCodeComparable(matchedCode);
  if (
    comparableDetected &&
    comparableDetected === comparableMatched &&
    String(detectedCode || "").trim() !== String(matchedCode || "").trim()
  ) {
    return "Coincide por formato del codigo (espacios o separadores)";
  }

  if (
    normalizedDetected &&
    normalizedDetected === normalizedMatched &&
    String(detectedCode || "").trim() !== String(matchedCode || "").trim()
  ) {
    return "Coincide ignorando espacios internos";
  }

  if (Number(similarity || 0) >= 0.84) {
    return "Codigo muy similar al existente en la lista activa del proveedor";
  }

  return "Coincide por codigo normalizado";
}

function normalizeProviderDocumentImportComparableName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findSuggestedProviderCandidate({ activeProviders, providerName }) {
  const normalizedProviderName =
    normalizeProviderDocumentImportComparableName(providerName);
  if (!normalizedProviderName) {
    return null;
  }

  return (
    activeProviders.find((provider) => {
      const normalizedCandidateName =
        normalizeProviderDocumentImportComparableName(provider.name);
      return (
        normalizedCandidateName === normalizedProviderName ||
        normalizedCandidateName.includes(normalizedProviderName) ||
        normalizedProviderName.includes(normalizedCandidateName)
      );
    }) || null
  );
}

function resolveProviderDocumentImportPreviewItemForAction({
  previewItem,
  payloadItem,
}) {
  if (!previewItem || typeof previewItem !== "object") {
    return {
      resolved: false,
      matchStatus: "missing_in_price_list",
      matchedPriceListItemId: null,
      canCreateInPriceList: false,
      createBlockedReason:
        "El item ya no esta disponible en el analisis actual",
    };
  }

  if (previewItem.matchStatus === "matched") {
    return {
      resolved: true,
      matchStatus: "matched",
      matchedPriceListItemId: previewItem.matchedPriceListItemId
        ? Number(previewItem.matchedPriceListItemId)
        : null,
      canCreateInPriceList: false,
      createBlockedReason: null,
    };
  }

  if (
    [
      "suggested_match_pending_confirmation",
      "ambiguous_similar_match",
    ].includes(previewItem.matchStatus)
  ) {
    const resolutionAction = String(payloadItem?.resolutionAction || "").trim();
    const selectedSuggestedPriceListItemId = Number(
      payloadItem?.selectedSuggestedPriceListItemId || 0,
    );
    const suggestedMatchCandidates = Array.isArray(
      previewItem.suggestedMatchCandidates,
    )
      ? previewItem.suggestedMatchCandidates
      : [];
    const selectedCandidate = suggestedMatchCandidates.find(
      (candidate) => Number(candidate.id) === selectedSuggestedPriceListItemId,
    );

    if (resolutionAction === "use_existing") {
      return {
        resolved: Boolean(selectedCandidate),
        matchStatus: selectedCandidate ? "matched" : previewItem.matchStatus,
        matchedPriceListItemId: selectedCandidate
          ? Number(selectedCandidate.id)
          : null,
        canCreateInPriceList: false,
        createBlockedReason: selectedCandidate
          ? null
          : "Selecciona un item existente valido para confirmar la coincidencia",
      };
    }

    if (resolutionAction === "treat_as_missing") {
      return {
        resolved: true,
        matchStatus: "missing_in_price_list",
        matchedPriceListItemId: null,
        canCreateInPriceList: Boolean(previewItem.canCreateInPriceList),
        createBlockedReason: previewItem.createBlockedReason || null,
      };
    }

    return {
      resolved: false,
      matchStatus: previewItem.matchStatus,
      matchedPriceListItemId: null,
      canCreateInPriceList: Boolean(previewItem.canCreateInPriceList),
      createBlockedReason:
        previewItem.createBlockedReason ||
        "Debes resolver la coincidencia sugerida antes de continuar",
    };
  }

  return {
    resolved: true,
    matchStatus: previewItem.matchStatus,
    matchedPriceListItemId: previewItem.matchedPriceListItemId
      ? Number(previewItem.matchedPriceListItemId)
      : null,
    canCreateInPriceList: Boolean(previewItem.canCreateInPriceList),
    createBlockedReason: previewItem.createBlockedReason || null,
  };
}

function buildProviderDocumentImportInstructions() {
  return "Analiza una propuesta de proveedor B2B y responde exclusivamente con JSON valido. No inventes proveedor, moneda, items ni condiciones cuando no haya evidencia. Todos los items deben representarse como productos. Identifica codigos, descripciones, cantidades, precios, descuentos, garantia y condiciones comerciales si aparecen. Si agregas notes por item, deben ser concretas, específicas para ese item y basadas en evidencia textual; evita frases genéricas como revisar el documento fuente sin indicar el dato detectado. Devuelve campos nulos o warnings cuando no puedas inferir algo con suficiente evidencia. expectedShape: { providerName, currencyCode, deliveryTime, quotationValidity, warranty, paymentTerms, warnings: string[], items: [{ providerCode, description, quantity, currencyCode, listPriceUnit, unitPrice, discountPct, resolvedCostUnit, warranty, notes, detectedFields: string[], confidence, sourceSnippet }] }";
}

function buildProviderDocumentImportPrompt({ documentRow, extractedContent }) {
  return {
    model: config.openai.model,
    input: [
      {
        role: "system",
        content: buildProviderDocumentImportInstructions(),
      },
      {
        role: "user",
        content: JSON.stringify({
          document: {
            fileName: documentRow.original_file_name,
            mimeType: documentRow.mime_type,
            fileExtension: documentRow.file_extension,
          },
          extractedContent: {
            summary: normalizeProviderDocumentImportText(
              extractedContent.contentSummary ||
                extractedContent.normalizedText,
              4000,
            ),
            normalizedText: normalizeProviderDocumentImportText(
              extractedContent.normalizedText,
              40000,
            ),
            structuredContent:
              extractedContent.structuredContentJson || undefined,
          },
        }),
      },
    ],
  };
}

function buildProviderDocumentImportPdfPrompt({
  documentRow,
  extractedContent,
  buffer,
}) {
  const content = [
    {
      type: "input_text",
      text: JSON.stringify({
        instructions:
          "Analiza el PDF adjunto y responde exclusivamente con JSON valido siguiendo el expectedShape indicado por el sistema.",
        document: {
          fileName: documentRow.original_file_name,
          mimeType: documentRow.mime_type,
          fileExtension: documentRow.file_extension,
        },
        extractedContent: {
          summary: normalizeProviderDocumentImportText(
            extractedContent?.contentSummary ||
              extractedContent?.normalizedText,
            4000,
          ),
          normalizedText: normalizeProviderDocumentImportText(
            extractedContent?.normalizedText,
            12000,
          ),
          structuredContent:
            extractedContent?.structuredContentJson || undefined,
        },
      }),
    },
    {
      type: "input_file",
      filename: documentRow.original_file_name || "documento.pdf",
      file_data: buffer.toString("base64"),
    },
  ];

  return {
    model: config.openai.model,
    input: [
      {
        role: "system",
        content: buildProviderDocumentImportInstructions(),
      },
      {
        role: "user",
        content,
      },
    ],
  };
}

async function requestProviderDocumentImportAnalysis(payload) {
  const response = await fetch(
    `${config.openai.baseUrl.replace(/\/$/, "")}/responses`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const responseData = await response.json();
  const parsed = extractJsonObject(getOpenAiOutputText(responseData));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("OpenAI request failed: invalid JSON response");
  }

  return parsed;
}

async function analyzeProviderDocumentImport({
  documentRow,
  extractedContent,
  buffer,
  extractionError = null,
}) {
  if (!config.openai.apiKey) {
    const error = new Error(
      "La importacion asistida requiere configuracion de OpenAI en el backend",
    );
    error.status = 503;
    throw error;
  }

  const normalizedText = String(extractedContent?.normalizedText || "").trim();
  const isPdfDocument =
    String(documentRow?.file_extension || "")
      .trim()
      .toLowerCase() === ".pdf" ||
    String(documentRow?.mime_type || "")
      .trim()
      .toLowerCase() === "application/pdf";
  const canUsePdfFallback =
    isPdfDocument && Buffer.isBuffer(buffer) && buffer.length > 0;

  let parsed = null;
  let primaryError = extractionError || null;

  if (normalizedText) {
    try {
      parsed = await requestProviderDocumentImportAnalysis(
        buildProviderDocumentImportPrompt({ documentRow, extractedContent }),
      );
    } catch (error) {
      primaryError = error;
      if (!canUsePdfFallback) {
        throw error;
      }
    }
  }

  if (!parsed) {
    if (!canUsePdfFallback) {
      throw (
        primaryError ||
        new Error(
          "No fue posible extraer contenido util del documento para el analisis",
        )
      );
    }

    try {
      parsed = await requestProviderDocumentImportAnalysis(
        buildProviderDocumentImportPdfPrompt({
          documentRow,
          extractedContent,
          buffer,
        }),
      );
    } catch (fallbackError) {
      if (primaryError) {
        fallbackError.message = `${fallbackError.message}. Fallback PDF: ${primaryError.message}`;
      }
      throw fallbackError;
    }
  }

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  return {
    providerName: normalizeProviderDocumentImportText(parsed.providerName, 180),
    currencyCode: normalizeProviderDocumentImportCurrencyCode(
      parsed.currencyCode,
      "USD",
    ),
    deliveryTime: normalizeProviderDocumentImportText(parsed.deliveryTime, 120),
    quotationValidity: normalizeProviderDocumentImportText(
      parsed.quotationValidity,
      120,
    ),
    warranty: normalizeProviderDocumentImportText(parsed.warranty, 120),
    paymentTerms: normalizeProviderDocumentImportText(parsed.paymentTerms, 180),
    warnings: (Array.isArray(parsed.warnings) ? parsed.warnings : [])
      .map((warning) => normalizeProviderDocumentImportText(warning, 500))
      .filter(Boolean),
    items: items
      .map((item, index) => {
        const resolvedCostUnit = normalizeProviderDocumentImportCost(
          item || {},
        );
        const quantity = Number(item?.quantity);
        return {
          previewId: `import-item-${index + 1}`,
          providerCode: normalizeProviderDocumentImportText(
            item?.providerCode,
            120,
          ),
          productDescription: normalizeProviderDocumentImportText(
            item?.description,
            5000,
          ),
          quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
          originalCurrencyCode: normalizeProviderDocumentImportCurrencyCode(
            item?.currencyCode || parsed.currencyCode || "USD",
            "USD",
          ),
          listPriceUnit:
            item?.listPriceUnit == null ? null : Number(item.listPriceUnit),
          unitPrice: item?.unitPrice == null ? null : Number(item.unitPrice),
          manufacturerDiscountPct:
            item?.discountPct == null ? 0 : Number(item.discountPct),
          resolvedCostUnit: roundProviderDocumentImportMoney(resolvedCostUnit),
          warranty: normalizeProviderDocumentImportText(item?.warranty, 120),
          notes: normalizeProviderDocumentImportText(item?.notes, 500),
          detectedFields: (Array.isArray(item?.detectedFields)
            ? item.detectedFields
            : []
          )
            .map((field) => normalizeProviderDocumentImportText(field, 80))
            .filter(Boolean),
          confidence: ["high", "medium", "low"].includes(
            String(item?.confidence || "").trim(),
          )
            ? String(item.confidence).trim()
            : "low",
          sourceSnippet: normalizeProviderDocumentImportText(
            item?.sourceSnippet,
            1000,
          ),
        };
      })
      .filter((item) => item.providerCode && item.productDescription),
  };
}

function convertProviderDocumentImportCostToQuotationPrice({
  originalCostUnit,
  originalCurrencyCode,
  quotationCurrencyCode,
  exchangeRate,
}) {
  const cost = Number(originalCostUnit || 0);
  if (!(cost >= 0)) return 0;

  const originalCurrency = normalizeProviderDocumentImportCurrencyCode(
    originalCurrencyCode,
    quotationCurrencyCode || "USD",
  );
  const quotationCurrency = normalizeProviderDocumentImportCurrencyCode(
    quotationCurrencyCode,
    originalCurrency,
  );
  const normalizedExchangeRate = Number(exchangeRate || 1);

  if (originalCurrency === quotationCurrency) {
    return roundProviderDocumentImportMoney(cost);
  }

  return roundProviderDocumentImportMoney(cost * normalizedExchangeRate);
}

async function buildProviderDocumentImportPreview({
  version,
  documentRow,
  providerId = null,
}) {
  const history = await getQuotationDocumentImportHistory({
    quotationId: version.quotation_id,
    documentId: documentRow.document_id,
  });

  const { stream } = await getDocumentContentStream({
    documentPublicId: documentRow.document_public_id,
  });
  const buffer = await streamToBuffer(stream);
  let extractedContent = null;
  let extractionError = null;
  try {
    extractedContent = await extractContentFromBuffer({
      buffer,
      mimeType: documentRow.mime_type,
      fileName: documentRow.original_file_name,
      extension: documentRow.file_extension,
    });
  } catch (error) {
    const isPdfDocument =
      String(documentRow?.file_extension || "")
        .trim()
        .toLowerCase() === ".pdf" ||
      String(documentRow?.mime_type || "")
        .trim()
        .toLowerCase() === "application/pdf";
    if (!isPdfDocument) {
      throw error;
    }
    extractionError = error;
    extractedContent = {
      extractionStatus: "failed",
      transcriptionStatus: "pending",
      detectedFormat: "pdf",
      rawText: "",
      normalizedText: "",
      structuredContentJson: null,
      transcriptText: null,
      transcriptionLanguage: null,
      transcriptionConfidence: null,
      durationSeconds: null,
      pageCount: null,
      contentSummary: "",
    };
  }
  const analysis = await analyzeProviderDocumentImport({
    documentRow,
    extractedContent,
    buffer,
    extractionError,
  });

  return buildProviderDocumentImportPreviewFromAnalysis({
    documentRow,
    analysis,
    providerId,
    history,
    fallbackVersionNumber: version?.version_number,
    extractedContentSummary: extractedContent?.contentSummary || "",
  });
}

async function buildProviderDocumentImportPreviewFromAnalysis({
  documentRow,
  analysis,
  providerId = null,
  history = [],
  fallbackVersionNumber = 0,
  extractedContentSummary = "",
}) {
  const activeProviders = await listActiveProvidersForImport();

  const selectedProviderId = providerId ? Number(providerId) : null;
  const selectedProvider = selectedProviderId
    ? activeProviders.find((provider) => provider.id === selectedProviderId) ||
      null
    : null;
  const suggestedProviderCandidate = findSuggestedProviderCandidate({
    activeProviders,
    providerName: analysis.providerName,
  });
  const hasProviderMismatch =
    Boolean(selectedProvider && suggestedProviderCandidate) &&
    Number(selectedProvider.id) !== Number(suggestedProviderCandidate.id);
  const activePriceList = selectedProvider
    ? await getActiveProviderImportPriceList(selectedProvider.id)
    : null;
  const activePriceListItems = activePriceList
    ? await listActiveProviderPriceListItems({
        priceListId: activePriceList.id,
      })
    : [];
  const commercialTerms =
    buildProviderDocumentImportCommercialTermsSuggestion(analysis);

  const items = [];
  for (const item of analysis.items) {
    let matchedPriceListItemId = null;
    let matchStatus = "provider_required";
    let canCreateInPriceList = false;
    let createBlockedReason = null;
    let suggestedMatchReason = null;
    let suggestedMatchCandidates = [];

    if (hasProviderMismatch) {
      matchStatus = "provider_required";
    } else if (selectedProvider && activePriceList) {
      const matchedItem = activePriceListItems.find(
        (candidate) =>
          String(candidate.code || "").trim() ===
          String(item.providerCode || "").trim(),
      );
      if (matchedItem) {
        matchedPriceListItemId = Number(matchedItem.id);
        matchStatus = "matched";
      } else {
        const normalizedMatches = activePriceListItems.filter(
          (candidate) =>
            normalizeProviderDocumentImportCode(candidate.code) ===
              normalizeProviderDocumentImportCode(item.providerCode) &&
            String(candidate.code || "").trim() !==
              String(item.providerCode || "").trim(),
        );
        const similarMatches = normalizedMatches.length
          ? []
          : buildProviderDocumentImportSimilarMatchCandidates({
              detectedCode: item.providerCode,
              activePriceListItems,
            }).filter(
              (candidate) =>
                !normalizedMatches.some(
                  (normalizedCandidate) =>
                    Number(normalizedCandidate.id) === Number(candidate.id),
                ),
            );

        suggestedMatchCandidates = [
          ...normalizedMatches,
          ...similarMatches,
        ].map((candidate) => ({
          id: Number(candidate.id),
          code: candidate.code || "",
          description: candidate.description || "",
          reason: buildProviderDocumentImportSuggestedMatchReason({
            detectedCode: item.providerCode,
            matchedCode: candidate.code,
            similarity: candidate.similarity,
          }),
          similarity:
            candidate.similarity == null ? null : Number(candidate.similarity),
        }));
        if (suggestedMatchCandidates.length === 1) {
          matchStatus = "suggested_match_pending_confirmation";
          suggestedMatchReason = suggestedMatchCandidates[0].reason;
        } else if (suggestedMatchCandidates.length > 1) {
          matchStatus = "ambiguous_similar_match";
          suggestedMatchReason =
            "Se encontraron multiples coincidencias similares";
        } else {
          matchStatus = "missing_in_price_list";
        }

        const currencyMatches =
          !item.originalCurrencyCode ||
          normalizeProviderDocumentImportCurrencyCode(
            item.originalCurrencyCode,
          ) ===
            normalizeProviderDocumentImportCurrencyCode(
              activePriceList.currency_code,
            );
        if (!item.providerCode) {
          createBlockedReason = "El item no tiene codigo de proveedor";
        } else if (!item.productDescription) {
          createBlockedReason = "El item no tiene descripcion suficiente";
        } else if (!currencyMatches) {
          createBlockedReason =
            "La moneda del item no coincide con la lista activa del proveedor";
        } else {
          canCreateInPriceList = true;
        }
      }
    } else if (selectedProvider && !activePriceList) {
      matchStatus = "missing_price_list";
      createBlockedReason =
        "El proveedor confirmado no tiene una lista activa de productos";
    }

    const itemWarnings = buildProviderDocumentImportSpecificWarnings({
      item,
      activePriceList,
      selectedProvider,
      suggestedProviderCandidate,
      hasProviderMismatch,
      suggestedMatchCandidates,
      createBlockedReason,
    });
    const warnings = buildProviderDocumentImportWarningStrings(itemWarnings);

    items.push({
      ...item,
      matchedPriceListItemId,
      requiresPriceListCreation: matchStatus === "missing_in_price_list",
      matchStatus,
      canCreateInPriceList,
      createBlockedReason,
      suggestedMatchReason,
      suggestedMatchCandidates,
      itemWarnings,
      listCurrencyCode: activePriceList?.currency_code || null,
      warnings,
    });
  }

  const hasPendingSuggestedMatches = items.some((item) =>
    [
      "suggested_match_pending_confirmation",
      "ambiguous_similar_match",
    ].includes(item.matchStatus),
  );
  const hasPendingCreatableItems = items.some(
    (item) =>
      item.matchStatus === "missing_in_price_list" && item.canCreateInPriceList,
  );
  const hasBlockingMissingPriceList = items.some(
    (item) => item.matchStatus === "missing_price_list",
  );
  const workflowStage = hasProviderMismatch
    ? "provider_mismatch_confirmation_required"
    : hasBlockingMissingPriceList
      ? "blocked_missing_price_list"
      : hasPendingSuggestedMatches
        ? "resolve_suggested_matches"
        : hasPendingCreatableItems
          ? "ready_to_create_missing_items"
          : "ready_to_apply";

  return {
    document: {
      id: Number(documentRow.document_id || 0),
      publicId: String(documentRow.document_public_id || ""),
      originalFileName: documentRow.original_file_name || "Documento",
      mimeType: documentRow.mime_type || "application/octet-stream",
      fileExtension: documentRow.file_extension || null,
      versionNumber: Number(
        documentRow.version_number || fallbackVersionNumber || 0,
      ),
    },
    activeProviders,
    suggestedProviderName: analysis.providerName || "",
    suggestedProviderCandidate: suggestedProviderCandidate
      ? {
          id: Number(suggestedProviderCandidate.id),
          name: suggestedProviderCandidate.name || "",
        }
      : null,
    confirmedProvider: selectedProvider,
    activePriceList: activePriceList
      ? {
          id: Number(activePriceList.id),
          name: activePriceList.name || "",
          currencyId: Number(activePriceList.currency_id),
          currencyCode: activePriceList.currency_code || "",
        }
      : null,
    suggestedSectionName: "Seccion sugerida",
    commercialTerms,
    workflowStage,
    items,
    priorImports: history,
    extractedContentSummary,
  };
}

async function buildDraftProviderDocumentImportPreview({
  uploadedFile,
  providerId = null,
}) {
  const fileName =
    uploadedFile?.originalFilename || uploadedFile?.newFilename || "Documento";
  const mimeType = String(uploadedFile?.mimetype || "application/octet-stream");
  const extension = path.extname(fileName || "") || null;
  const buffer = await readFile(uploadedFile.filepath);
  let extractedContent = null;
  let extractionError = null;

  try {
    extractedContent = await extractContentFromBuffer({
      buffer,
      mimeType,
      fileName,
      extension,
    });
  } catch (error) {
    const isPdfDocument =
      String(extension || "")
        .trim()
        .toLowerCase() === ".pdf" ||
      mimeType.trim().toLowerCase() === "application/pdf";
    if (!isPdfDocument) {
      throw error;
    }
    extractionError = error;
    extractedContent = {
      extractionStatus: "failed",
      transcriptionStatus: "pending",
      detectedFormat: "pdf",
      rawText: "",
      normalizedText: "",
      structuredContentJson: null,
      transcriptText: null,
      transcriptionLanguage: null,
      transcriptionConfidence: null,
      durationSeconds: null,
      pageCount: null,
      contentSummary: "",
    };
  }

  const documentRow = {
    document_id: 0,
    document_public_id: "",
    original_file_name: fileName,
    mime_type: mimeType,
    file_extension: extension,
    version_number: 0,
  };
  const analysis = await analyzeProviderDocumentImport({
    documentRow,
    extractedContent,
    buffer,
    extractionError,
  });

  return buildProviderDocumentImportPreviewFromAnalysis({
    documentRow,
    analysis,
    providerId,
    history: [],
    fallbackVersionNumber: 0,
    extractedContentSummary: extractedContent?.contentSummary || "",
  });
}

function patchProviderDocumentImportPreviewWithCreatedItems(
  preview,
  createdItems = [],
) {
  if (!preview || typeof preview !== "object") {
    return preview;
  }

  const previewItems = Array.isArray(preview.items) ? preview.items : [];
  if (
    !previewItems.length ||
    !Array.isArray(createdItems) ||
    !createdItems.length
  ) {
    return preview;
  }

  const createdByPreviewId = new Map(
    createdItems
      .map((item) => ({
        previewId: String(item?.previewId || "").trim(),
        createdPriceListItemId:
          Number(item?.createdPriceListItemId || 0) || null,
      }))
      .filter((item) => item.previewId),
  );

  if (!createdByPreviewId.size) {
    return preview;
  }

  const items = previewItems.map((item) => {
    const previewId = String(item?.previewId || "").trim();
    const createdRecord = createdByPreviewId.get(previewId);
    if (!createdRecord) {
      return item;
    }

    return {
      ...item,
      matchedPriceListItemId:
        createdRecord.createdPriceListItemId ||
        item.matchedPriceListItemId ||
        null,
      requiresPriceListCreation: false,
      matchStatus: "matched",
      canCreateInPriceList: false,
      createBlockedReason: null,
      suggestedMatchReason: null,
      suggestedMatchCandidates: [],
    };
  });

  const hasPendingSuggestedMatches = items.some((item) =>
    [
      "suggested_match_pending_confirmation",
      "ambiguous_similar_match",
    ].includes(item.matchStatus),
  );
  const hasPendingCreatableItems = items.some(
    (item) =>
      item.matchStatus === "missing_in_price_list" && item.canCreateInPriceList,
  );
  const hasBlockingMissingPriceList = items.some(
    (item) => item.matchStatus === "missing_price_list",
  );

  return {
    ...preview,
    workflowStage: hasBlockingMissingPriceList
      ? "blocked_missing_price_list"
      : hasPendingSuggestedMatches
        ? "resolve_suggested_matches"
        : hasPendingCreatableItems
          ? "ready_to_create_missing_items"
          : "ready_to_apply",
    items,
  };
}

function buildQuotationProviderDocumentImportPreviewJobPublicId() {
  return `qpdip_${randomUUID().replace(/-/g, "")}`;
}

function buildQuotationProviderDocumentImportPreviewJobSnapshot({
  version,
  documentRow,
  providerId,
}) {
  return {
    quotationId: Number(version?.quotation_id || 0),
    quotationVersionId: Number(version?.id || 0),
    quotationVersionNumber: Number(version?.version_number || 0),
    documentLinkId: Number(documentRow?.link_id || 0),
    documentId: Number(documentRow?.document_id || 0),
    documentPublicId: String(documentRow?.document_public_id || "").trim(),
    originalFileName: String(documentRow?.original_file_name || "").trim(),
    mimeType: String(documentRow?.mime_type || "").trim(),
    fileExtension: String(documentRow?.file_extension || "").trim(),
    aiEnabled:
      documentRow?.ai_enabled == null
        ? true
        : Number(documentRow.ai_enabled) === 1,
    providerId: providerId ? Number(providerId) : null,
  };
}

function hashQuotationProviderDocumentImportPreviewJobSnapshot(snapshot) {
  return createHash("sha256")
    .update(JSON.stringify(snapshot || {}))
    .digest("hex");
}

function buildQuotationProviderDocumentImportPreviewJobResponse(row) {
  if (!row) return null;

  const result = safeParseJsonObject(row.result_json) || null;
  const snapshot = safeParseJsonObject(row.source_snapshot_json) || {};
  const isExpired =
    row.expires_at && new Date(row.expires_at).getTime() <= Date.now();
  const status =
    isExpired && ["completed", "failed", "stale"].includes(row.status)
      ? "expired"
      : row.status;
  const response = {
    job: {
      id: String(row.public_id || ""),
      status,
      pollAfterMs: QUOTATION_PROVIDER_IMPORT_PREVIEW_JOB_POLL_INTERVAL_MS,
      progress: {
        phase: String(row.progress_phase || "queued").trim() || "queued",
        label:
          String(row.progress_label || "").trim() ||
          "Analizando documento del proveedor",
        percent: Math.max(0, Number(row.progress_percent || 0) || 0),
      },
      request: {
        quotationId: Number(row.quotation_id || snapshot.quotationId || 0),
        quotationVersionId: Number(
          row.quotation_version_id || snapshot.quotationVersionId || 0,
        ),
        documentLinkId: Number(snapshot.documentLinkId || 0),
        documentId: Number(row.document_id || snapshot.documentId || 0),
        providerId:
          row.provider_id == null && snapshot.providerId == null
            ? null
            : Number((row.provider_id ?? snapshot.providerId) || 0),
      },
      createdAt: row.created_at,
      startedAt: row.started_at || null,
      finishedAt: row.finished_at || null,
      expiresAt: row.expires_at || null,
      resultAvailable: status === "completed" && Boolean(result),
    },
  };

  if (status === "completed" && result) {
    response.result = result;
    return response;
  }

  if (status === "failed") {
    response.error = {
      code: row.error_code || "provider_document_import_preview_failed",
      message:
        String(row.error_message || "").trim() ||
        "No fue posible analizar el documento del proveedor",
    };
    return response;
  }

  if (status === "stale") {
    response.error = {
      code: row.error_code || "stale_snapshot",
      message:
        String(row.error_message || "").trim() ||
        "El documento o la cotizacion cambiaron antes de completar el analisis. Solicita un nuevo analisis.",
    };
    return response;
  }

  if (status === "expired") {
    response.error = {
      code: "preview_expired",
      message:
        "El resultado del analisis ya expiro. Vuelve a solicitar el analisis del documento.",
    };
  }

  return response;
}

async function createOrReuseQuotationProviderDocumentImportPreviewJob({
  version,
  documentRow,
  providerId,
  requestedByUserId,
}) {
  await ensureQuotationProviderDocumentImportPreviewJobSchema();

  const snapshot = buildQuotationProviderDocumentImportPreviewJobSnapshot({
    version,
    documentRow,
    providerId,
  });
  const fingerprint =
    hashQuotationProviderDocumentImportPreviewJobSnapshot(snapshot);
  const reusableRows = await query(
    `SELECT *
     FROM quotation_provider_document_import_preview_jobs
     WHERE quotation_version_id = ?
       AND requested_by_user_id = ?
       AND request_fingerprint = ?
       AND status IN ('pending', 'running')
     ORDER BY id DESC
     LIMIT 1`,
    [Number(version.id), Number(requestedByUserId), fingerprint],
  );

  if (reusableRows.length) {
    return {
      wasReused: true,
      response: buildQuotationProviderDocumentImportPreviewJobResponse(
        reusableRows[0],
      ),
    };
  }

  const publicId = buildQuotationProviderDocumentImportPreviewJobPublicId();
  await query(
    `INSERT INTO quotation_provider_document_import_preview_jobs (
       public_id,
       quotation_id,
       quotation_version_id,
       document_id,
       provider_id,
       requested_by_user_id,
       status,
       request_fingerprint,
       progress_phase,
       progress_label,
       progress_percent,
       source_snapshot_json
     ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 'queued', 'Analisis en cola', 0, ?)`,
    [
      publicId,
      Number(version.quotation_id),
      Number(version.id),
      Number(documentRow.document_id),
      providerId ? Number(providerId) : null,
      Number(requestedByUserId),
      fingerprint,
      JSON.stringify(snapshot),
    ],
  );

  const rows = await query(
    `SELECT *
     FROM quotation_provider_document_import_preview_jobs
     WHERE public_id = ?
     LIMIT 1`,
    [publicId],
  );

  return {
    wasReused: false,
    response: buildQuotationProviderDocumentImportPreviewJobResponse(rows[0]),
  };
}

async function getReusableQuotationProviderDocumentImportPreviewResult({
  version,
  documentRow,
  providerId,
}) {
  await ensureQuotationProviderDocumentImportPreviewJobSchema();

  const snapshot = buildQuotationProviderDocumentImportPreviewJobSnapshot({
    version,
    documentRow,
    providerId,
  });
  const fingerprint =
    hashQuotationProviderDocumentImportPreviewJobSnapshot(snapshot);
  const rows = await query(
    `SELECT result_json
     FROM quotation_provider_document_import_preview_jobs
     WHERE quotation_version_id = ?
       AND request_fingerprint = ?
       AND status = 'completed'
       AND result_json IS NOT NULL
       AND (expires_at IS NULL OR expires_at > NOW(3))
     ORDER BY finished_at DESC, id DESC
     LIMIT 1`,
    [Number(version.id), fingerprint],
  );

  return rows.length ? safeParseJsonObject(rows[0].result_json) || null : null;
}

async function getQuotationProviderDocumentImportPreviewJob({
  publicId,
  quotationVersionId,
}) {
  await ensureQuotationProviderDocumentImportPreviewJobSchema();
  const rows = await query(
    `SELECT *
     FROM quotation_provider_document_import_preview_jobs
     WHERE public_id = ?
       AND quotation_version_id = ?
     LIMIT 1`,
    [String(publicId || "").trim(), Number(quotationVersionId)],
  );
  return rows.length
    ? buildQuotationProviderDocumentImportPreviewJobResponse(rows[0])
    : null;
}

async function claimNextQuotationProviderDocumentImportPreviewJob() {
  const candidates = await query(
    `SELECT id
     FROM quotation_provider_document_import_preview_jobs
     WHERE (
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
  );

  for (const candidate of candidates) {
    const leaseToken = randomUUID().replace(/-/g, "");
    const row = await withTransaction(async (conn) => {
      const [updateResult] = await conn.query(
        `UPDATE quotation_provider_document_import_preview_jobs
         SET status = 'running',
             attempt_count = attempt_count + 1,
             lease_token = ?,
             lease_expires_at = DATE_ADD(NOW(3), INTERVAL ? SECOND),
             started_at = COALESCE(started_at, NOW(3)),
             progress_phase = 'preparing',
             progress_label = 'Preparando analisis del documento',
             progress_percent = GREATEST(progress_percent, 10),
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
          QUOTATION_PROVIDER_IMPORT_PREVIEW_JOB_LEASE_SECONDS,
          Number(candidate.id),
        ],
      );

      if (!updateResult.affectedRows) {
        return null;
      }

      const [rows] = await conn.query(
        `SELECT *
         FROM quotation_provider_document_import_preview_jobs
         WHERE id = ?
         LIMIT 1`,
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

async function updateQuotationProviderDocumentImportPreviewJobProgress({
  jobId,
  leaseToken,
  phase,
  label,
  percent,
}) {
  await query(
    `UPDATE quotation_provider_document_import_preview_jobs
     SET progress_phase = ?,
         progress_label = ?,
         progress_percent = ?,
         updated_at = NOW(3)
     WHERE id = ?
       AND lease_token = ?`,
    [
      String(phase || "queued").trim() || "queued",
      String(label || "Analizando documento del proveedor").trim() ||
        "Analizando documento del proveedor",
      Math.max(0, Math.min(100, Number(percent || 0) || 0)),
      Number(jobId),
      String(leaseToken || "").trim(),
    ],
  );
}

async function finalizeQuotationProviderDocumentImportPreviewJob({
  jobId,
  leaseToken,
  status,
  result,
  errorCode,
  errorMessage,
}) {
  await query(
    `UPDATE quotation_provider_document_import_preview_jobs
     SET status = ?,
         progress_phase = CASE
           WHEN ? = 'completed' THEN 'completed'
           WHEN ? = 'failed' THEN 'failed'
           WHEN ? = 'stale' THEN 'stale'
           ELSE progress_phase
         END,
         progress_label = CASE
           WHEN ? = 'completed' THEN 'Analisis completado'
           WHEN ? = 'failed' THEN 'Analisis fallido'
           WHEN ? = 'stale' THEN 'Analisis invalido por cambios'
           ELSE progress_label
         END,
         progress_percent = CASE WHEN ? = 'completed' THEN 100 ELSE progress_percent END,
         result_json = ?,
         error_code = ?,
         error_message = ?,
         finished_at = NOW(3),
         expires_at = DATE_ADD(NOW(3), INTERVAL ? MINUTE),
         lease_token = NULL,
         lease_expires_at = NULL,
         updated_at = NOW(3)
     WHERE id = ?
       AND lease_token = ?`,
    [
      status,
      status,
      status,
      status,
      status,
      status,
      status,
      status,
      result ? JSON.stringify(result) : null,
      errorCode || null,
      errorMessage || null,
      QUOTATION_PROVIDER_IMPORT_PREVIEW_JOB_RESULT_TTL_MINUTES,
      Number(jobId),
      String(leaseToken || "").trim(),
    ],
  );
}

async function processQuotationProviderDocumentImportPreviewJob(row) {
  const snapshot = safeParseJsonObject(row.source_snapshot_json) || {};

  try {
    const user = await getUserAuthContext(Number(row.requested_by_user_id));
    if (!user) {
      await finalizeQuotationProviderDocumentImportPreviewJob({
        jobId: Number(row.id),
        leaseToken: row.lease_token,
        status: "failed",
        errorCode: "requester_not_found",
        errorMessage:
          "No fue posible resolver el usuario solicitante del analisis",
      });
      return;
    }

    const version = await getAccessibleQuotationVersion({
      user,
      versionId: Number(row.quotation_version_id),
    });
    if (!version) {
      await finalizeQuotationProviderDocumentImportPreviewJob({
        jobId: Number(row.id),
        leaseToken: row.lease_token,
        status: "failed",
        errorCode: "quotation_version_not_found",
        errorMessage: "Version de cotizacion no encontrada o sin acceso",
      });
      return;
    }

    const documentRow = await getQuotationDocumentLinkForQuotation({
      quotationId: Number(row.quotation_id),
      linkId: Number(snapshot.documentLinkId || 0),
    });
    if (!documentRow) {
      await finalizeQuotationProviderDocumentImportPreviewJob({
        jobId: Number(row.id),
        leaseToken: row.lease_token,
        status: "stale",
        errorCode: "document_not_available",
        errorMessage:
          "El documento ya no esta disponible en la cotizacion para completar el analisis.",
      });
      return;
    }

    if (Number(documentRow.ai_enabled) !== 1) {
      await finalizeQuotationProviderDocumentImportPreviewJob({
        jobId: Number(row.id),
        leaseToken: row.lease_token,
        status: "stale",
        errorCode: "document_ai_disabled",
        errorMessage:
          "El documento fue excluido de IA antes de completar el analisis. Selecciona otro documento habilitado.",
      });
      return;
    }

    const currentFingerprint =
      hashQuotationProviderDocumentImportPreviewJobSnapshot(
        buildQuotationProviderDocumentImportPreviewJobSnapshot({
          version,
          documentRow,
          providerId: snapshot.providerId,
        }),
      );
    if (currentFingerprint !== row.request_fingerprint) {
      await finalizeQuotationProviderDocumentImportPreviewJob({
        jobId: Number(row.id),
        leaseToken: row.lease_token,
        status: "stale",
        errorCode: "stale_snapshot",
        errorMessage:
          "La cotizacion o el documento cambiaron antes de completar el analisis. Solicita un nuevo analisis.",
      });
      return;
    }

    await updateQuotationProviderDocumentImportPreviewJobProgress({
      jobId: Number(row.id),
      leaseToken: row.lease_token,
      phase: "analyzing_document",
      label: "Extrayendo y analizando documento con IA",
      percent: 40,
    });

    const result = await buildProviderDocumentImportPreview({
      version,
      documentRow,
      providerId: snapshot.providerId,
    });

    await finalizeQuotationProviderDocumentImportPreviewJob({
      jobId: Number(row.id),
      leaseToken: row.lease_token,
      status: "completed",
      result,
    });
  } catch (error) {
    await finalizeQuotationProviderDocumentImportPreviewJob({
      jobId: Number(row.id),
      leaseToken: row.lease_token,
      status: "failed",
      errorCode: error?.code || "provider_document_import_preview_failed",
      errorMessage: resolveProviderDocumentImportPreviewErrorMessage(error),
    });
  }
}

export function queueQuotationProviderDocumentImportPreviewProcessing() {
  quotationProviderDocumentImportPreviewWorkerQueued = true;
}

export async function processPendingQuotationProviderDocumentImportPreviewJobs({
  limit = 1,
} = {}) {
  let processed = 0;
  while (processed < limit) {
    const row = await claimNextQuotationProviderDocumentImportPreviewJob();
    if (!row) {
      break;
    }
    processed += 1;
    await processQuotationProviderDocumentImportPreviewJob(row);
  }
  return processed;
}

export async function startQuotationProviderDocumentImportPreviewWorker() {
  if (quotationProviderDocumentImportPreviewWorkerStarted) {
    return;
  }
  quotationProviderDocumentImportPreviewWorkerStarted = true;

  const tick = async () => {
    const shouldDrainQueue = quotationProviderDocumentImportPreviewWorkerQueued;
    quotationProviderDocumentImportPreviewWorkerQueued = false;

    try {
      const processed =
        await processPendingQuotationProviderDocumentImportPreviewJobs({
          limit: shouldDrainQueue ? 3 : 1,
        });
      if (processed > 0) {
        quotationProviderDocumentImportPreviewWorkerQueued = true;
      }
    } catch (error) {
      console.error(
        "Quotation provider document import preview worker error:",
        error?.message || error,
      );
    }
  };

  const interval = setInterval(() => {
    tick();
  }, QUOTATION_PROVIDER_IMPORT_PREVIEW_JOB_POLL_INTERVAL_MS);
  interval.unref?.();

  queueQuotationProviderDocumentImportPreviewProcessing();
  await tick();
}

async function copyQuotationVersionDocuments(
  conn,
  { sourceVersionId, targetVersionId, createdByUserId, createdAt },
) {
  await conn.query(
    `INSERT INTO quotation_version_documents
      (quotation_version_id, document_id, ai_enabled, created_by_user_id, created_at)
     SELECT ?, qvd.document_id, qvd.ai_enabled, ?, ?
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
            qvd.ai_enabled,
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
         (quotation_version_id, document_id, ai_enabled, created_by_user_id, created_at)
       VALUES (?, ?, 1, ?, ?)`,
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
        "is_renewal",
        `ALTER TABLE quotation_section_items
        ADD COLUMN is_renewal TINYINT(1) NOT NULL DEFAULT 0
        AFTER item_type`,
      );
      await ensureQuotationSectionItemsColumn(
        "bundle_parent_item_id",
        `ALTER TABLE quotation_section_items
         ADD COLUMN bundle_parent_item_id BIGINT UNSIGNED NULL
        AFTER is_renewal`,
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
        "import_warnings_json",
        `ALTER TABLE quotation_section_items
         ADD COLUMN import_warnings_json LONGTEXT NULL
         AFTER source_component_price_list_item_id`,
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
    await ensureQuotationDocumentImportsSchema();
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
      isRenewal: Boolean(item.isRenewal),
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
      isRenewal: Boolean(item.isRenewal),
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
      items: normalizedItems.items.map((item) => ({
        ...item,
        importWarnings: normalizeProviderDocumentImportWarningsToSpanish(
          item.importWarnings || [],
        ),
      })),
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
         SET provider_id = ?, product_code = ?, product_description = ?, item_type = ?, is_renewal = ?,
             bundle_parent_item_id = NULL, bundle_origin_type = ?,
             source_provider_price_list_item_id = ?, source_component_price_list_item_id = ?,
             import_warnings_json = ?,
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
          item.isRenewal ? 1 : 0,
          item.bundleOriginType || null,
          item.sourceProviderPriceListItemId || null,
          item.sourceComponentPriceListItemId || null,
          JSON.stringify(item.importWarnings || []),
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
          (quotation_section_id, provider_id, product_code, product_description, item_type, is_renewal, bundle_parent_item_id,
           bundle_origin_type, source_provider_price_list_item_id, source_component_price_list_item_id, import_warnings_json,
           quantity, original_currency_code, original_list_price_unit, list_price_unit,
           manufacturer_discount_pct, import_cost_pct, profit_margin_pct,
           final_discount_pct, display_order, bundle_sort_order, created_at, updated_at, created_by_user_id, updated_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          Number(sectionId),
          Number(item.providerId),
          item.productCode,
          item.productDescription,
          item.itemType || "producto",
          item.isRenewal ? 1 : 0,
          item.bundleOriginType || null,
          item.sourceProviderPriceListItemId || null,
          item.sourceComponentPriceListItemId || null,
          JSON.stringify(item.importWarnings || []),
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
        (quotation_section_id, provider_id, product_code, product_description, item_type, is_renewal, bundle_parent_item_id,
         bundle_origin_type, source_provider_price_list_item_id, source_component_price_list_item_id,
         quantity, original_currency_code, original_list_price_unit, list_price_unit,
         manufacturer_discount_pct, import_cost_pct, profit_margin_pct,
         final_discount_pct, display_order, bundle_sort_order, created_at, updated_at, created_by_user_id, updated_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sectionId,
        Number(item.providerId),
        item.productCode,
        item.productDescription,
        item.itemType || "producto",
        item.isRenewal ? 1 : 0,
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

function hasQuotationAiApprovalPermission(user) {
  return (
    hasQuotationAdministration(user) ||
    user?.permissionSet?.has(quotationAiApprovalPermissionCode)
  );
}

function hasQuotationHumanApprovalPermission(user) {
  return (
    hasQuotationAdministration(user) ||
    user?.permissionSet?.has(quotationHumanApprovalPermissionCode)
  );
}

function hasQuotationAnyApprovalPermission(user) {
  return (
    hasQuotationHumanApprovalPermission(user) ||
    hasQuotationAiApprovalPermission(user)
  );
}

function hasAnyQuotationPermission(user) {
  return quotationPermissionCodes.some((permission) =>
    user?.permissionSet?.has(permission),
  );
}

function hasAnyProposalReadPermission(user) {
  return proposalReadPermissionCodes.some((permission) =>
    user?.permissionSet?.has(permission),
  );
}

function hasProposalCreatePermission(user) {
  return proposalCreatePermissionCodes.some((permission) =>
    user?.permissionSet?.has(permission),
  );
}

function hasProposalUpdatePermission(user) {
  return proposalUpdatePermissionCodes.some((permission) =>
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
              qsi.product_code, qsi.product_description, qsi.item_type, qsi.is_renewal,
              qsi.bundle_parent_item_id, qsi.bundle_origin_type,
              qsi.source_provider_price_list_item_id,
              qsi.source_component_price_list_item_id,
              qsi.import_warnings_json,
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
        importWarnings: normalizeProviderDocumentImportWarningsToSpanish(
          safeParseJsonArray(item.import_warnings_json) || [],
        ),
        productCode: item.product_code,
        productDescription: item.product_description,
        itemType: item.item_type || "producto",
        isRenewal: Boolean(item.is_renewal),
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
  const hasArchivedAtColumn = await hasTableColumn(
    "proposal_templates",
    "archived_at",
  );
  const rows = await query(
    `SELECT *
     FROM proposal_templates
     WHERE ${hasArchivedAtColumn ? "archived_at IS NULL AND" : ""} status = 'active'
     ORDER BY is_default DESC, name ASC, id ASC`,
  );

  return rows.map(serializeProposalTemplateRow);
}

async function getProposalTemplateById(templateId) {
  const hasArchivedAtColumn = await hasTableColumn(
    "proposal_templates",
    "archived_at",
  );
  const rows = await query(
    `SELECT *
     FROM proposal_templates
     WHERE id = ?
       ${hasArchivedAtColumn ? "AND archived_at IS NULL" : ""}
     LIMIT 1`,
    [Number(templateId)],
  );

  return rows.length ? serializeProposalTemplateRow(rows[0]) : null;
}

async function getDefaultProposalTemplate() {
  const hasArchivedAtColumn = await hasTableColumn(
    "proposal_templates",
    "archived_at",
  );
  const rows = await query(
    `SELECT *
     FROM proposal_templates
     WHERE ${hasArchivedAtColumn ? "archived_at IS NULL AND" : ""} status = 'active'
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
          componentKind: component.componentKind || "custom",
          isVisible:
            component.isVisible === undefined
              ? true
              : Boolean(component.isVisible),
          aiEnabled: Boolean(component.aiEnabled),
          aiMode: component.aiEnabled ? component.aiMode || "auto" : null,
          aiCapabilityKey: component.aiEnabled
            ? component.aiCapabilityKey || null
            : null,
          aiSettings: component.aiSettings || null,
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
    // Legacy proposals without revisions are safe to rehydrate from current config.
    return true;
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
  const [components, proposalContentConfig] = await Promise.all([
    listProposalComponents(Number(proposalRow.id)),
    getProposalContentConfiguration(),
  ]);
  const configComponentByCode = new Map(
    Array.isArray(proposalContentConfig?.components)
      ? proposalContentConfig.components.map((component) => [
          component.componentCode,
          component,
        ])
      : [],
  );
  const normalizedComponents = components.map((component) => {
    const configComponent = configComponentByCode.get(component.componentCode);
    if (!configComponent || !configComponent.aiEnabled) {
      return component;
    }

    return {
      ...component,
      aiEnabled: true,
      aiMode: configComponent.aiMode || "auto",
      aiCapabilityKey: configComponent.aiCapabilityKey || null,
    };
  });
  return serializeProposalRow(proposalRow, {
    components: normalizedComponents,
  });
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
          consumed_at DATETIME(3) NULL,
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

      await ensureTableColumn(
        "proposal_ai_jobs",
        "consumed_at",
        `ALTER TABLE proposal_ai_jobs
         ADD COLUMN consumed_at DATETIME(3) NULL
         AFTER finished_at`,
      );
    })();
  }

  return ensureProposalExecutiveSummaryGenerationJobSchemaPromise;
}

async function buildProposalExecutiveSummaryJobResponse(row) {
  if (!row) return null;
  const componentConfig = await getProposalAiComponentConfigForProposal({
    proposalId: row.proposal_id,
    componentCode: row.component_code,
  });
  const snapshot = safeParseJsonObject(row.source_snapshot_json) || {};
  return {
    publicId: row.public_id,
    proposalId: Number(row.proposal_id),
    componentCode: row.component_code,
    jobType: row.job_type,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    consumedAt: row.consumed_at || null,
    updatedAt: row.updated_at,
    requestedBy: {
      userId: Number(row.requested_by_user_id),
    },
    request: {
      languageCode:
        String(snapshot.languageCode || row.language_code || "es")
          .trim()
          .toLowerCase() || "es",
      instructions: String(
        snapshot.instructions || row.instructions_text || "",
      ).trim(),
      maxLibraryAssets: Math.min(
        PROPOSAL_EXEC_SUMMARY_MAX_LIBRARY_ASSETS,
        Number(
          snapshot.maxLibraryAssets ||
            row.max_library_assets ||
            PROPOSAL_EXEC_SUMMARY_MAX_LIBRARY_ASSETS,
        ),
      ),
      sourceScopeMode:
        snapshot.sourceScopeMode === "documents_only" ||
        snapshot.sourceScopeMode === "library_only"
          ? snapshot.sourceScopeMode
          : "both",
      librarySourceMode:
        snapshot.librarySourceMode === "manual" ? "manual" : "auto",
      libraryContentMode:
        snapshot.libraryContentMode === "summary_extract"
          ? "summary_extract"
          : "source_text",
      sourcePriorityMode:
        snapshot.sourcePriorityMode === "non_library_first" ||
        snapshot.sourcePriorityMode === "library_first"
          ? snapshot.sourcePriorityMode
          : "balanced",
      selectedLibraryAssetPublicIds: Array.isArray(
        snapshot.selectedLibraryAssetPublicIds,
      )
        ? snapshot.selectedLibraryAssetPublicIds
            .map((value) => String(value || "").trim())
            .filter(Boolean)
        : [],
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
              `No fue posible generar la sugerencia de ${String(componentConfig?.componentTitle || "este componente").toLowerCase()}`,
            retryable: row.status !== "canceled",
          }
        : null,
  };
}

async function getProposalExecutiveSummaryGenerationJob({
  publicId,
  proposalId,
  componentCode = PROPOSAL_EXEC_SUMMARY_JOB_COMPONENT_CODE,
}) {
  await ensureProposalExecutiveSummaryGenerationJobSchema();
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
      String(componentCode || "").trim(),
      PROPOSAL_EXEC_SUMMARY_JOB_TYPE,
    ],
  );
  return rows.length ? buildProposalExecutiveSummaryJobResponse(rows[0]) : null;
}

async function getLatestProposalExecutiveSummaryGenerationJob({
  proposalId,
  componentCode = PROPOSAL_EXEC_SUMMARY_JOB_COMPONENT_CODE,
}) {
  await ensureProposalExecutiveSummaryGenerationJobSchema();
  const rows = await query(
    `SELECT *
     FROM proposal_ai_jobs
     WHERE proposal_id = ?
       AND component_code = ?
       AND job_type = ?
       AND consumed_at IS NULL
     ORDER BY id DESC
     LIMIT 1`,
    [
      Number(proposalId),
      String(componentCode || "").trim(),
      PROPOSAL_EXEC_SUMMARY_JOB_TYPE,
    ],
  );
  return rows.length ? buildProposalExecutiveSummaryJobResponse(rows[0]) : null;
}

async function consumeProposalExecutiveSummaryGenerationJob({
  proposalId,
  publicId,
  componentCode = PROPOSAL_EXEC_SUMMARY_JOB_COMPONENT_CODE,
}) {
  await ensureProposalExecutiveSummaryGenerationJobSchema();
  const normalizedProposalId = Number(proposalId || 0);
  const normalizedPublicId = String(publicId || "").trim();
  const normalizedComponentCode = String(componentCode || "").trim();
  if (!normalizedProposalId || !normalizedPublicId) {
    return false;
  }

  const rows = await query(
    `SELECT id
     FROM proposal_ai_jobs
     WHERE proposal_id = ?
       AND public_id = ?
       AND component_code = ?
       AND job_type = ?
       AND status = 'completed'
       AND consumed_at IS NULL
     LIMIT 1`,
    [
      normalizedProposalId,
      normalizedPublicId,
      normalizedComponentCode,
      PROPOSAL_EXEC_SUMMARY_JOB_TYPE,
    ],
  );

  if (!rows.length) {
    return false;
  }

  await query(
    `UPDATE proposal_ai_jobs
     SET consumed_at = NOW(3)
     WHERE proposal_id = ?
       AND component_code = ?
       AND job_type = ?
       AND status = 'completed'
       AND consumed_at IS NULL
       AND id <= ?`,
    [
      normalizedProposalId,
      normalizedComponentCode,
      PROPOSAL_EXEC_SUMMARY_JOB_TYPE,
      Number(rows[0].id),
    ],
  );

  return true;
}

function buildProposalComponentComparableText(blocks) {
  return normalizeProposalAiText(
    (Array.isArray(blocks) ? blocks : [])
      .flatMap((block) => {
        if (block?.type === "list") {
          return Array.isArray(block.items) ? block.items : [];
        }
        return [block?.text || ""];
      })
      .filter(Boolean)
      .join("\n\n"),
  );
}

async function consumeMatchingProposalExecutiveSummaryGenerationJob({
  proposalId,
  blocks,
  componentCode = PROPOSAL_EXEC_SUMMARY_JOB_COMPONENT_CODE,
}) {
  const latestJob = await getLatestProposalExecutiveSummaryGenerationJob({
    proposalId,
    componentCode,
  });
  if (!latestJob || latestJob.status !== "completed") {
    return false;
  }

  const savedText = buildProposalComponentComparableText(blocks);
  const suggestionText = normalizeProposalAiText(
    latestJob.result?.suggestion?.plainText || "",
  );

  if (!savedText || !suggestionText || savedText !== suggestionText) {
    return false;
  }

  return consumeProposalExecutiveSummaryGenerationJob({
    proposalId,
    publicId: latestJob.publicId,
    componentCode,
  });
}

function buildProposalExecutiveSummaryFingerprintSnapshot({
  proposal,
  component,
  componentCode = PROPOSAL_EXEC_SUMMARY_JOB_COMPONENT_CODE,
  instructions,
  languageCode,
  maxLibraryAssets,
  sourceScopeMode,
  librarySourceMode,
  libraryContentMode,
  sourcePriorityMode,
  selectedLibraryAssetPublicIds,
}) {
  return {
    proposalId: Number(proposal?.id || 0),
    quotationVersionId: Number(proposal?.quotation_version_id || 0),
    componentCode: String(componentCode || "").trim(),
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
    sourceScopeMode:
      sourceScopeMode === "documents_only" || sourceScopeMode === "library_only"
        ? sourceScopeMode
        : "both",
    librarySourceMode: librarySourceMode === "manual" ? "manual" : "auto",
    libraryContentMode:
      libraryContentMode === "summary_extract"
        ? "summary_extract"
        : "source_text",
    sourcePriorityMode:
      sourcePriorityMode === "non_library_first" ||
      sourcePriorityMode === "library_first"
        ? sourcePriorityMode
        : "balanced",
    selectedLibraryAssetPublicIds: Array.from(
      new Set(
        (Array.isArray(selectedLibraryAssetPublicIds)
          ? selectedLibraryAssetPublicIds
          : []
        )
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    ).sort((left, right) => left.localeCompare(right, "es")),
  };
}

async function createOrReuseProposalExecutiveSummaryGenerationJob({
  proposal,
  componentCode = PROPOSAL_EXEC_SUMMARY_JOB_COMPONENT_CODE,
  requestedByUserId,
  instructions,
  languageCode,
  maxLibraryAssets,
  sourceScopeMode,
  librarySourceMode,
  libraryContentMode,
  sourcePriorityMode,
  selectedLibraryAssetPublicIds,
}) {
  await ensureProposalExecutiveSummaryGenerationJobSchema();
  const componentConfig = await getProposalAiComponentConfigForProposal({
    proposalId: Number(proposal?.id),
    componentCode,
  });
  if (!componentConfig) {
    const error = new Error("Componente no soportado");
    error.status = 422;
    error.body = {
      message: "El componente no soporta sugerencias IA",
      error: { code: "unsupported_component", retryable: false },
    };
    throw error;
  }
  const proposalDetail = await serializeProposalDetail(proposal);
  const component = Array.isArray(proposalDetail.components)
    ? proposalDetail.components.find(
        (entry) => entry.componentCode === componentConfig.componentCode,
      )
    : null;

  if (!component) {
    const error = new Error("Componente no encontrado");
    error.status = 422;
    error.body = {
      message: `La propuesta no tiene el componente ${componentConfig.componentTitle}`,
      error: { code: "unsupported_component", retryable: false },
    };
    throw error;
  }

  const snapshot = buildProposalExecutiveSummaryFingerprintSnapshot({
    proposal,
    component,
    componentCode: componentConfig.componentCode,
    instructions,
    languageCode,
    maxLibraryAssets,
    sourceScopeMode,
    librarySourceMode,
    libraryContentMode,
    sourcePriorityMode,
    selectedLibraryAssetPublicIds,
  });
  const fingerprint = hashProposalExecutiveSummarySnapshot(snapshot);

  const reusableRows = await query(
    `SELECT *
     FROM proposal_ai_jobs
     WHERE proposal_id = ?
       AND component_code = ?
       AND job_type = ?
       AND request_fingerprint = ?
       AND status IN ('pending', 'running')
     ORDER BY id DESC
     LIMIT 1`,
    [
      Number(proposal.id),
      componentConfig.componentCode,
      PROPOSAL_EXEC_SUMMARY_JOB_TYPE,
      fingerprint,
    ],
  );

  if (reusableRows.length) {
    return {
      wasReused: true,
      response: await buildProposalExecutiveSummaryJobResponse(reusableRows[0]),
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
      componentConfig.componentCode,
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
    response: await buildProposalExecutiveSummaryJobResponse(rows[0]),
  };
}

async function resolveProposalExecutiveSummaryLibraryAssets({
  user,
  proposal,
  opportunity,
  manufacturerCodes,
  solutionCodes,
  industryCodes,
  stageCodes,
  maxLibraryAssets,
  librarySourceMode,
  libraryContentMode,
  selectedLibraryAssetPublicIds,
}) {
  async function buildLibraryAssetContext(
    asset,
    { matchScore = null, matchReasons = [], selectionMode },
  ) {
    const sourceRows = asset?.id
      ? await query(
          `SELECT source_file_name, source_mime_type, extracted_text, extracted_text_summary
             FROM commercial_enablement_item_source_contents
            WHERE item_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 1`,
          [Number(asset.id)],
        )
      : [];
    const sourceContent = sourceRows[0] || null;
    const extractedText = String(sourceContent?.extracted_text || "").trim();
    const extractedSummary = String(
      sourceContent?.extracted_text_summary || "",
    ).trim();
    const assetSummary = summarizeProposalAiText(
      asset.summary,
      PROPOSAL_EXEC_SUMMARY_MAX_LIBRARY_SUMMARY_CHARS,
    );

    let documentText = "";
    let contentModeUsed =
      libraryContentMode === "summary_extract"
        ? "summary_extract"
        : "source_text";

    if (contentModeUsed === "source_text") {
      documentText = summarizeProposalAiText(
        extractedText || extractedSummary || assetSummary,
        PROPOSAL_EXEC_SUMMARY_MAX_LIBRARY_SOURCE_TEXT_CHARS,
      );
      if (!documentText) {
        contentModeUsed = "summary_extract";
      }
    }

    if (contentModeUsed === "summary_extract") {
      const extractText = summarizeProposalAiText(
        extractedSummary || extractedText,
        PROPOSAL_EXEC_SUMMARY_MAX_DOCUMENT_TEXT_CHARS,
      );
      documentText = [assetSummary, extractText].filter(Boolean).join("\n\n");
    }

    return {
      assetPublicId: asset.publicId,
      title: asset.title,
      summary: assetSummary,
      assetTypeCode: asset.assetTypeCode,
      matchScore,
      matchReasons,
      selectionMode,
      contentModeUsed,
      sourceFileName: sourceContent?.source_file_name || "",
      sourceMimeType: sourceContent?.source_mime_type || "",
      documentText,
      manufacturerCodes: asset.catalogs
        .filter((catalog) => catalog.catalogType === "manufacturer")
        .map((catalog) => catalog.code),
      solutionCodes: asset.catalogs
        .filter((catalog) => catalog.catalogType === "solution")
        .map((catalog) => catalog.code),
      industryCodes: asset.catalogs
        .filter((catalog) => catalog.catalogType === "industry")
        .map((catalog) => catalog.code),
      stageCodes: asset.tags
        .filter((tag) => tag.tagGroup === "stage")
        .map((tag) => tag.code),
    };
  }

  const normalizedMode = librarySourceMode === "manual" ? "manual" : "auto";
  const normalizedSelectedIds = Array.from(
    new Set(
      (Array.isArray(selectedLibraryAssetPublicIds)
        ? selectedLibraryAssetPublicIds
        : []
      )
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );

  if (normalizedMode === "manual") {
    const assets = await Promise.all(
      normalizedSelectedIds.map((assetPublicId) =>
        getCommercialEnablementAssetDetail({ user, assetPublicId }),
      ),
    );
    const invalidAssetPublicIds = normalizedSelectedIds.filter(
      (assetPublicId, index) => {
        const asset = assets[index];
        return (
          !asset ||
          asset.status !== "published" ||
          asset.visibilityLevel !== "client_safe"
        );
      },
    );

    if (invalidAssetPublicIds.length) {
      const error = new Error("Activos de biblioteca no validos");
      error.status = 422;
      error.body = {
        message:
          "Uno o mas activos seleccionados no son validos para esta generacion",
        error: {
          code: "invalid_library_sources",
          retryable: false,
        },
        details: {
          invalidAssetPublicIds,
        },
      };
      throw error;
    }

    return Promise.all(
      assets.map((asset) =>
        buildLibraryAssetContext(asset, {
          matchScore: null,
          matchReasons: [],
          selectionMode: "manual",
        }),
      ),
    );
  }

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

  const selectedEntries = scoredAssets.slice(
    0,
    Math.min(PROPOSAL_EXEC_SUMMARY_MAX_LIBRARY_ASSETS, maxLibraryAssets),
  );
  const detailedAssets = await Promise.all(
    selectedEntries.map((entry) =>
      getCommercialEnablementAssetDetail({
        user,
        assetPublicId: entry.item.publicId,
      }).then((asset) => ({ asset, entry })),
    ),
  );

  return Promise.all(
    detailedAssets
      .filter((item) => item.asset)
      .map(({ asset, entry }) =>
        buildLibraryAssetContext(asset, {
          matchScore: entry.score,
          matchReasons: entry.reasons,
          selectionMode: "auto",
        }),
      ),
  );
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
     WHERE job_type = ?
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
    [PROPOSAL_EXEC_SUMMARY_JOB_TYPE],
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

async function resolveProposalBrochureAssetsByPublicIds({
  user,
  assetPublicIds,
}) {
  const normalizedAssetPublicIds = Array.from(
    new Set(
      (Array.isArray(assetPublicIds) ? assetPublicIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );

  if (normalizedAssetPublicIds.length > PROPOSAL_BROCHURE_MAX_ITEMS) {
    const error = new Error("Se excedio el maximo de folletos permitidos");
    error.status = 422;
    error.body = {
      message: `La seccion admite como maximo ${PROPOSAL_BROCHURE_MAX_ITEMS} folletos.`,
      error: { code: "brochure_limit_exceeded", retryable: false },
    };
    throw error;
  }

  const assets = await Promise.all(
    normalizedAssetPublicIds.map((assetPublicId) =>
      getCommercialEnablementAssetDetail({ user, assetPublicId }),
    ),
  );

  const invalidAssetPublicIds = normalizedAssetPublicIds.filter(
    (assetPublicId, index) => {
      const asset = assets[index];
      return (
        !asset ||
        asset.status !== "published" ||
        asset.visibilityLevel !== "client_safe"
      );
    },
  );

  if (invalidAssetPublicIds.length) {
    const error = new Error("Activos de folleto no validos");
    error.status = 422;
    error.body = {
      message:
        "Uno o mas folletos seleccionados no son validos para esta propuesta",
      error: { code: "invalid_brochure_assets", retryable: false },
      details: { invalidAssetPublicIds },
    };
    throw error;
  }

  return {
    assetPublicIds: normalizedAssetPublicIds,
    brochureAssetsByPublicId: Object.fromEntries(
      assets.map((asset) => [asset.publicId, asset]),
    ),
  };
}

async function buildProposalBrochureRecommendationContext({ proposal, user }) {
  const proposalDetail = await serializeProposalDetail(proposal);
  const currentComponent = Array.isArray(proposalDetail.components)
    ? proposalDetail.components.find((component) =>
        isProductBrochuresComponentCode(component.componentCode),
      ) || null
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

  return {
    proposal,
    opportunity,
    quotationSections,
    manufacturerCodes: pickMatchingCatalogCodes(
      sourceText,
      catalogs?.manufacturer,
    ),
    solutionCodes: pickMatchingCatalogCodes(sourceText, catalogs?.solution),
    industryCodes: pickMatchingCatalogCodes(sourceText, catalogs?.industry, 2),
    stageCodes: [String(opportunity?.sales_stage_code || "").trim()].filter(
      Boolean,
    ),
    opportunityNameNormalized: normalizeProposalAiText(
      opportunity?.name || proposal.opportunity_name || "",
    ),
  };
}

function selectProposalBrochureRecommendationCandidates(
  libraryAssets,
  context,
) {
  const attachableAssets = (
    Array.isArray(libraryAssets) ? libraryAssets : []
  ).filter(
    (item) =>
      (Array.isArray(item.files) && item.files.length > 0) ||
      (Array.isArray(item.links) && item.links.length > 0),
  );

  const scoredAssets = attachableAssets
    .map((item) => {
      const scored = scoreLibraryAssetForProposalContext(item, {
        manufacturerCodes: context.manufacturerCodes,
        solutionCodes: context.solutionCodes,
        industryCodes: context.industryCodes,
        stageCodes: context.stageCodes,
        opportunityNameNormalized: context.opportunityNameNormalized,
      });

      const brochureBoost =
        item.assetTypeCode === "solution_brief" ||
        item.assetTypeCode === "manufacturer_brief" ||
        item.assetTypeCode === "customer_document"
          ? 2
          : 0;

      return {
        item,
        score: scored.score + brochureBoost,
        reasons: brochureBoost
          ? [...scored.reasons, "brochure_type"]
          : scored.reasons,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.item.usageCount - left.item.usageCount ||
        String(left.item.title).localeCompare(String(right.item.title), "es"),
    );

  const preferred = scoredAssets.filter((entry) => entry.score > 0);
  const fallbackPool = preferred.length ? preferred : scoredAssets;
  return fallbackPool.slice(
    0,
    PROPOSAL_BROCHURE_RECOMMENDATION_CANDIDATE_LIMIT,
  );
}

async function requestProposalBrochureRecommendations({
  proposal,
  user,
  requestedBrochureCount,
}) {
  const requestedCount = normalizeProposalBrochureRequestedCount(
    requestedBrochureCount,
  );
  const context = await buildProposalBrochureRecommendationContext({
    proposal,
    user,
  });

  const libraryAssetsResponse = await listCommercialEnablementAssets({
    user,
    filters: {
      status: "published",
      onlyClientSafe: "true",
    },
  }).catch(() => null);

  const candidateEntries = selectProposalBrochureRecommendationCandidates(
    libraryAssetsResponse?.items,
    context,
  );

  if (!candidateEntries.length) {
    return {
      items: [],
      warnings: [
        {
          code: "no_brochure_candidates",
          message:
            "No se encontraron folletos publicados y compartibles con cliente para esta propuesta.",
        },
      ],
    };
  }

  const candidateMap = new Map(
    candidateEntries.map((entry) => [entry.item.publicId, entry.item]),
  );
  const fallbackItems = candidateEntries
    .slice(0, requestedCount)
    .map((entry) => entry.item);

  if (!config.openai.apiKey) {
    return {
      items: fallbackItems,
      warnings: [
        {
          code: "brochure_ai_fallback",
          message:
            "Se usaron recomendaciones automaticas basadas en contexto porque la integracion IA no esta disponible.",
        },
      ],
    };
  }

  const payload = {
    model: config.openai.model,
    input: [
      {
        role: "system",
        content: PROPOSAL_BROCHURE_RECOMMENDATION_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            requestedBrochureCount: requestedCount,
            proposal: {
              proposalId: Number(proposal.id),
              title: proposal.title || "",
              opportunityName: proposal.opportunity_name || "",
            },
            opportunity: {
              stageCode: String(context.opportunity?.sales_stage_code || ""),
              stageName: String(context.opportunity?.sales_stage_name || ""),
            },
            quotationSections: Array.isArray(context.quotationSections)
              ? context.quotationSections.map((section) => ({
                  title: section.title || "",
                  items: Array.isArray(section.items)
                    ? section.items.map((item) => ({
                        productCode: item.productCode || "",
                        productDescription: item.productDescription || "",
                      }))
                    : [],
                }))
              : [],
            candidates: candidateEntries.map(({ item, reasons }) => ({
              publicId: item.publicId,
              title: item.title,
              summary: item.summary || "",
              assetTypeCode: item.assetTypeCode || "",
              assetTypeLabel: item.assetTypeLabel || "",
              catalogs: Array.isArray(item.catalogs)
                ? item.catalogs.map((catalog) => ({
                    catalogType: catalog.catalogType,
                    name: catalog.name,
                    code: catalog.code,
                  }))
                : [],
              files: Array.isArray(item.files) ? item.files.length : 0,
              links: Array.isArray(item.links) ? item.links.length : 0,
              matchReasons: reasons,
            })),
          },
          null,
          2,
        ),
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
    const recommendedAssetPublicIds = Array.from(
      new Set(
        (Array.isArray(parsed?.recommendedAssetPublicIds)
          ? parsed.recommendedAssetPublicIds
          : []
        )
          .map((value) => String(value || "").trim())
          .filter((value) => candidateMap.has(value)),
      ),
    ).slice(0, requestedCount);

    const recommendedItems = recommendedAssetPublicIds.length
      ? recommendedAssetPublicIds
          .map((assetPublicId) => candidateMap.get(assetPublicId))
          .filter(Boolean)
      : fallbackItems;

    const warnings = Array.isArray(parsed?.warnings)
      ? parsed.warnings
          .map((message) => summarizeProposalAiText(message, 500))
          .filter(Boolean)
          .map((message) => ({ code: "model_warning", message }))
      : [];

    if (recommendedItems.length < requestedCount) {
      warnings.push({
        code: "brochure_results_truncated",
        message: `Solo se encontraron ${recommendedItems.length} folletos recomendables para esta propuesta.`,
      });
    }

    return { items: recommendedItems, warnings };
  } catch {
    return {
      items: fallbackItems,
      warnings: [
        {
          code: "brochure_ai_fallback",
          message:
            "La recomendacion IA no estuvo disponible y se uso la seleccion automatica por contexto.",
        },
      ],
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function buildProposalExecutiveSummaryGenerationContext({
  proposal,
  user,
  componentCode = PROPOSAL_EXEC_SUMMARY_JOB_COMPONENT_CODE,
  instructions,
  languageCode,
  maxLibraryAssets,
  sourceScopeMode,
  librarySourceMode,
  libraryContentMode,
  sourcePriorityMode,
  selectedLibraryAssetPublicIds,
}) {
  const componentConfig = await getProposalAiComponentConfigForProposal({
    proposalId: Number(proposal?.id),
    componentCode,
  });
  if (!componentConfig) {
    throw new Error("Unsupported proposal AI component");
  }
  const proposalDetail = await serializeProposalDetail(proposal);
  const currentComponent = Array.isArray(proposalDetail.components)
    ? proposalDetail.components.find(
        (component) =>
          component.componentCode === componentConfig.componentCode,
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

  const normalizedSourceScopeMode =
    sourceScopeMode === "documents_only" || sourceScopeMode === "library_only"
      ? sourceScopeMode
      : "both";

  const matchedAssets =
    normalizedSourceScopeMode === "documents_only"
      ? []
      : await resolveProposalExecutiveSummaryLibraryAssets({
          user,
          proposal,
          opportunity,
          manufacturerCodes,
          solutionCodes,
          industryCodes,
          stageCodes,
          maxLibraryAssets,
          librarySourceMode,
          libraryContentMode,
          selectedLibraryAssetPublicIds,
        });

  const documentSources = [
    ...(normalizedSourceScopeMode === "library_only"
      ? []
      : Array.isArray(documents)
        ? documents
        : []
    )
      .slice(0, PROPOSAL_EXEC_SUMMARY_MAX_DOCUMENTS)
      .map((document) => ({
        sourceKind: "opportunity_document",
        sourcePriorityGroup: "non_library",
        documentPublicId: document.publicId,
        title: document.originalFileName,
        mimeType: document.mimeType,
        text: summarizeProposalAiText(
          document.contentSummary ||
            document.transcriptText ||
            document.normalizedText ||
            document.rawText,
          PROPOSAL_EXEC_SUMMARY_MAX_DOCUMENT_TEXT_CHARS,
        ),
      })),
    ...(Array.isArray(matchedAssets) ? matchedAssets : []).map((asset) => ({
      sourceKind: "library_asset",
      sourcePriorityGroup: "library",
      assetPublicId: asset.assetPublicId,
      title: asset.title,
      mimeType: asset.sourceMimeType || null,
      text: asset.documentText || "",
      contentModeUsed: asset.contentModeUsed || "summary_extract",
      selectionMode: asset.selectionMode || "auto",
    })),
  ].filter((source) => String(source.text || "").trim());

  return {
    requestedBy: {
      userId: Number(user?.id || 0) || null,
    },
    proposal: {
      id: Number(proposal.id),
      title: proposal.title || "",
      quotationVersionId: Number(proposal.quotation_version_id),
      opportunityId: Number(proposal.opportunity_id),
      currentComponentDraft: {
        title: currentComponent?.title || componentConfig.componentTitle,
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
      documentSources: documentSources.filter(
        (source) => source.sourceKind === "library_asset",
      ),
      limit: Math.min(
        PROPOSAL_EXEC_SUMMARY_MAX_LIBRARY_ASSETS,
        Number(maxLibraryAssets || PROPOSAL_EXEC_SUMMARY_MAX_LIBRARY_ASSETS),
      ),
    },
    documentSources,
    generationPolicy: {
      componentCode: componentConfig.componentCode,
      aiCapabilityKey: componentConfig.capabilityKey,
      languageCode:
        String(languageCode || "es")
          .trim()
          .toLowerCase() || "es",
      mode: "parallel",
      sourceScopeMode: normalizedSourceScopeMode,
      librarySourceMode: librarySourceMode === "manual" ? "manual" : "auto",
      libraryContentMode:
        libraryContentMode === "summary_extract"
          ? "summary_extract"
          : "source_text",
      sourcePriorityMode:
        sourcePriorityMode === "non_library_first" ||
        sourcePriorityMode === "library_first"
          ? sourcePriorityMode
          : "balanced",
      selectedLibraryAssetPublicIds: Array.isArray(
        selectedLibraryAssetPublicIds,
      )
        ? selectedLibraryAssetPublicIds
        : [],
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
  const requestedByUserId = Number(context?.requestedBy?.userId || 0);
  if (requestedByUserId) {
    await assertAiBudgetAvailable({ userId: requestedByUserId });
  }

  const componentConfig = buildProposalAiComponentConfig({
    componentCode: context?.generationPolicy?.componentCode,
    componentTitle: context?.component?.title,
    aiCapabilityKey: context?.generationPolicy?.aiCapabilityKey,
  });
  if (!componentConfig) {
    const error = new Error(
      "La generacion asistida no esta disponible para este componente",
    );
    error.code = "ai_generation_disabled";
    throw error;
  }
  if (!config.openai.apiKey) {
    const error = new Error(
      "La generacion asistida no esta disponible en este momento",
    );
    error.code = "ai_generation_disabled";
    throw error;
  }

  const aiParameters = await getPublishedAiParameterEntryByCapabilityKey(
    componentConfig.capabilityKey,
  );
  if (aiParameters && aiParameters.isEnabled === false) {
    const error = new Error(componentConfig.aiDisabledMessage);
    error.code = "ai_generation_disabled";
    throw error;
  }

  const expectedShape =
    aiParameters?.outputSchema &&
    typeof aiParameters.outputSchema === "object" &&
    !Array.isArray(aiParameters.outputSchema)
      ? aiParameters.outputSchema
      : {
          title: componentConfig.defaultSuggestionTitle,
          paragraphs: ["string"],
          warnings: ["string"],
        };
  const effectiveContext = {
    ...context,
    aiParameters: aiParameters?.parameters || {},
  };
  const userPromptTemplate = String(
    aiParameters?.userPromptTemplate || "{context, expectedShape}",
  ).trim();
  const userPromptContent =
    userPromptTemplate === "{context, expectedShape}"
      ? JSON.stringify({ context: effectiveContext, expectedShape })
      : userPromptTemplate
          .replaceAll("{{context}}", JSON.stringify(effectiveContext, null, 2))
          .replaceAll(
            "{{expectedShape}}",
            JSON.stringify(expectedShape, null, 2),
          );

  const payload = {
    model: aiParameters?.modelOverride || config.openai.model,
    input: [
      {
        role: "system",
        content:
          aiParameters?.systemPrompt || componentConfig.defaultSystemPrompt,
      },
      {
        role: "user",
        content: userPromptContent,
      },
    ],
  };

  const controller = new AbortController();
  const aiRequestStartedAt = new Date();
  const internalRequestId = randomUUID();
  const timeoutId = setTimeout(
    () => controller.abort(),
    Math.max(
      5000,
      Number(
        aiParameters?.timeoutMs || PROPOSAL_EXEC_SUMMARY_OPENAI_TIMEOUT_MS,
      ),
    ),
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
    if (requestedByUserId) {
      await recordAiUsageFromOpenAiResponse({
        internalRequestId,
        userId: requestedByUserId,
        featureCode: "proposals.exec_summary",
        model: payload.model,
        openAiResponse: responseData,
        jobType: "proposal_ai_job",
        jobId: Number(context?.job?.id || 0) || null,
        startedAt: aiRequestStartedAt,
      });
    }

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
      throw new Error("OpenAI request failed: empty proposal AI suggestion");
    }

    return {
      suggestion: {
        mode: "parallel",
        componentCode: componentConfig.componentCode,
        title:
          summarizeProposalAiText(
            parsed.title || componentConfig.defaultSuggestionTitle,
            180,
          ) || componentConfig.defaultSuggestionTitle,
        blocks: paragraphs.map((text) => ({ type: "paragraph", text })),
        plainText: paragraphs.join("\n\n"),
        suggestionMetadata: {
          tone: componentConfig.suggestionTone,
          languageCode:
            String(context?.generationPolicy?.languageCode || "es").trim() ||
            "es",
          generatedAt: new Date().toISOString(),
          aiParameters: {
            capabilityKey: componentConfig.capabilityKey,
            publishedRevisionNumber:
              Number(aiParameters?.publishedRevisionNumber || 0) || null,
            model: aiParameters?.modelOverride || config.openai.model,
          },
        },
      },
      sourceSummary: {
        opportunityAnswersUsed: Array.isArray(context?.opportunity?.answers)
          ? context.opportunity.answers.length
          : 0,
        opportunityDocumentsUsed: Array.isArray(context?.documentSources)
          ? context.documentSources.filter(
              (source) => source.sourceKind === "opportunity_document",
            ).length
          : 0,
        quotationSectionsUsed: Array.isArray(context?.quotation?.sections)
          ? context.quotation.sections.length
          : 0,
        libraryAssetsUsed: Array.isArray(context?.documentSources)
          ? context.documentSources.filter(
              (source) => source.sourceKind === "library_asset",
            ).length
          : 0,
        documentSourcesUsed: Array.isArray(context?.documentSources)
          ? context.documentSources.length
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
            contentModeUsed:
              asset.contentModeUsed === "summary_extract"
                ? "summary_extract"
                : "source_text",
            selectionMode: asset.selectionMode === "manual" ? "manual" : "auto",
            matchReasons: Array.isArray(asset.matchReasons)
              ? asset.matchReasons
              : [],
          }),
        ),
        generationPolicy: {
          sourceScopeMode:
            context?.generationPolicy?.sourceScopeMode === "documents_only" ||
            context?.generationPolicy?.sourceScopeMode === "library_only"
              ? context.generationPolicy.sourceScopeMode
              : "both",
          librarySourceMode:
            context?.generationPolicy?.librarySourceMode === "manual"
              ? "manual"
              : "auto",
          libraryContentMode:
            context?.generationPolicy?.libraryContentMode === "summary_extract"
              ? "summary_extract"
              : "source_text",
          sourcePriorityMode:
            context?.generationPolicy?.sourcePriorityMode ===
              "non_library_first" ||
            context?.generationPolicy?.sourcePriorityMode === "library_first"
              ? context.generationPolicy.sourcePriorityMode
              : "balanced",
        },
        aiParameters: {
          capabilityKey: componentConfig.capabilityKey,
          publishedRevisionNumber:
            Number(aiParameters?.publishedRevisionNumber || 0) || null,
          model: aiParameters?.modelOverride || config.openai.model,
          timeoutMs: Math.max(
            5000,
            Number(
              aiParameters?.timeoutMs ||
                PROPOSAL_EXEC_SUMMARY_OPENAI_TIMEOUT_MS,
            ),
          ),
        },
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
    const componentConfig = await getProposalAiComponentConfigForProposal({
      proposalId: Number(row.proposal_id),
      componentCode: row.component_code,
    });
    if (!componentConfig) {
      await finalizeProposalExecutiveSummaryGenerationJob({
        jobId: Number(row.id),
        leaseToken: row.lease_token,
        status: "failed",
        errorCode: "unsupported_component",
        errorMessage: "El componente del job no soporta sugerencias IA",
      });
      return;
    }
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
      componentCode: componentConfig.componentCode,
      instructions: row.instructions_text,
      languageCode: row.language_code,
      maxLibraryAssets: row.max_library_assets,
      sourceScopeMode: snapshot.sourceScopeMode,
      librarySourceMode: snapshot.librarySourceMode,
      libraryContentMode: snapshot.libraryContentMode,
      sourcePriorityMode: snapshot.sourcePriorityMode,
      selectedLibraryAssetPublicIds: snapshot.selectedLibraryAssetPublicIds,
    });

    await updateProposalExecutiveSummaryJobProgress({
      jobId: Number(row.id),
      leaseToken: row.lease_token,
      phase: "generating_text",
      label: `La IA esta redactando ${String(componentConfig.componentTitle || "el contenido").toLowerCase()}`,
      percent: 80,
    });

    const result = await requestProposalExecutiveSummarySuggestion({
      ...context,
      job: {
        id: Number(row.id),
      },
    });
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
    const componentConfig = await getProposalAiComponentConfigForProposal({
      proposalId: Number(row.proposal_id),
      componentCode: row.component_code,
    });
    await finalizeProposalExecutiveSummaryGenerationJob({
      jobId: Number(row.id),
      leaseToken: row.lease_token,
      status: "failed",
      errorCode: error?.code || "ai_generation_failed",
      errorMessage:
        String(error?.message || "").trim() ||
        `No fue posible generar ${String(componentConfig?.componentTitle || "el contenido").toLowerCase()} con IA.`,
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
  const statusCode = String(versionRow?.status_code || "").trim();
  const statusSupportsDirectApproval = [
    "borrador",
    "en_aprobacion",
    "rechazada",
  ].includes(statusCode);
  const canApproveAny = hasQuotationAnyApprovalPermission(user);

  if (statusSupportsDirectApproval && canApproveAny) {
    allowed.add("aprobar");
  }

  if (canApproveAny) {
    allowed.delete("solicitar_aprobacion");
  }

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

async function getQuotationApprovalCapabilities({ user, versionRow }) {
  const allowedCodes = new Set(
    await getAllowedQuotationActionCodes({ user, versionRow }),
  );
  const canApproveAction = allowedCodes.has("aprobar");
  const canApproveWithAi =
    canApproveAction && hasQuotationAiApprovalPermission(user);
  const canApproveWithoutAi =
    canApproveAction && hasQuotationHumanApprovalPermission(user);
  const canApprove = canApproveWithAi || canApproveWithoutAi;
  const canRequestApproval =
    allowedCodes.has("solicitar_aprobacion") && !canApprove;

  return {
    canRequestApproval,
    canApprove,
    canApproveWithoutAi,
    canApproveWithAi,
  };
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

function assertProposalReadPermission(req, res) {
  if (
    !hasAnyProposalReadPermission(req.user) &&
    !hasAnyQuotationPermission(req.user)
  ) {
    res.status(403).json({ message: "No autorizado" });
    return false;
  }
  return true;
}

function assertProposalCreatePermission(req, res) {
  if (
    !hasProposalCreatePermission(req.user) &&
    !hasAnyQuotationPermission(req.user)
  ) {
    res.status(403).json({ message: "No autorizado" });
    return false;
  }
  return true;
}

function assertProposalUpdatePermission(req, res) {
  if (
    !hasProposalUpdatePermission(req.user) &&
    !hasAnyQuotationPermission(req.user)
  ) {
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

    const duplicateItem = await findProviderPriceListItemByNormalizedCode({
      priceListId: parsed.data.priceListId,
      code: parsed.data.code,
    });
    if (duplicateItem) {
      return res.status(409).json({
        message: "Ya existe un producto con ese codigo en la lista",
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
  requireAnyPermission(proposalReadAccessPermissionCodes),
  async (req, res) => {
    if (!assertProposalReadPermission(req, res)) return;
    const templates = await getAvailableProposalTemplates();
    return res.json(templates);
  },
);

router.get(
  "/proposal-assets",
  requireAnyPermission(proposalReadAccessPermissionCodes),
  async (req, res) => {
    if (!assertProposalReadPermission(req, res)) return;
    const assets = await listInstitutionalAssets({ status: "active" });
    return res.json({ items: assets });
  },
);

router.get(
  "/proposals",
  requireAnyPermission(proposalReadAccessPermissionCodes),
  async (req, res) => {
    if (!assertProposalReadPermission(req, res)) return;

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
  requireAnyPermission(proposalReadAccessPermissionCodes),
  async (req, res) => {
    if (!assertProposalReadPermission(req, res)) return;
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
  "/proposals/:proposalId/components/:componentCode/generation-jobs/latest",
  requireAnyPermission(proposalReadAccessPermissionCodes),
  async (req, res) => {
    if (!assertProposalReadPermission(req, res)) return;
    const proposalId = Number(req.params.proposalId);
    const componentCode = String(req.params.componentCode || "").trim();
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
    if (
      !(await getProposalAiComponentConfigForProposal({
        proposalId,
        componentCode,
      }))
    ) {
      return res
        .status(404)
        .json({ message: "Componente no soporta sugerencias IA" });
    }

    return res.json({
      job: await getLatestProposalExecutiveSummaryGenerationJob({
        proposalId,
        componentCode,
      }),
    });
  },
);

router.get(
  "/proposals/:proposalId/components/:componentCode/generation-jobs/:jobPublicId",
  requireAnyPermission(proposalReadAccessPermissionCodes),
  async (req, res) => {
    if (!assertProposalReadPermission(req, res)) return;
    const proposalId = Number(req.params.proposalId);
    const componentCode = String(req.params.componentCode || "").trim();
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
    if (
      !(await getProposalAiComponentConfigForProposal({
        proposalId,
        componentCode,
      }))
    ) {
      return res
        .status(404)
        .json({ message: "Componente no soporta sugerencias IA" });
    }

    const job = await getProposalExecutiveSummaryGenerationJob({
      publicId: jobPublicId,
      proposalId,
      componentCode,
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
  requireAnyPermission(proposalCreateAccessPermissionCodes),
  async (req, res) => {
    if (!assertProposalCreatePermission(req, res)) return;
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
    } else {
      const existingComponents = await listProposalComponents(proposalId);
      const needsBootstrapComponents = existingComponents.length === 0;
      const canAutoSync = needsBootstrapComponents
        ? true
        : !sourceProposalId &&
          (await canAutoSyncProposalFromCurrentConfig(proposalId));

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
  requireAnyPermission(proposalUpdateAccessPermissionCodes),
  async (req, res) => {
    if (!assertProposalUpdatePermission(req, res)) return;
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

    const hasArchivedAtColumn = await hasTableColumn(
      "proposals",
      "archived_at",
    );

    if (hasArchivedAtColumn) {
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
    } else {
      await query(
        `UPDATE proposals
         SET title = ?, status_code = ?,
             content_json = ?, updated_by_user_id = ?, updated_at = NOW(3)
         WHERE id = ?`,
        [
          nextTitle,
          nextStatusCode,
          JSON.stringify(nextContent),
          Number(req.user.id),
          proposalId,
        ],
      );
    }

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
  requireAnyPermission(proposalUpdateAccessPermissionCodes),
  async (req, res) => {
    if (!assertProposalUpdatePermission(req, res)) return;
    const proposalId = Number(req.params.proposalId);
    const componentCode = String(req.params.componentCode || "").trim();
    if (!Number.isInteger(proposalId) || proposalId <= 0) {
      return res.status(400).json({ message: "Id de propuesta invalido" });
    }
    if (!(await proposalHasComponent(proposalId, componentCode))) {
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

    if (
      !isProductBrochuresComponentCode(componentCode) &&
      parsed.data.blocks.some((block) => block.type === "brochure")
    ) {
      return res.status(400).json({
        message:
          "Solo la seccion de folletos permite adjuntar folletos comerciales",
      });
    }

    let nextBlocks = parsed.data.blocks;
    let componentSettings;
    let brochureAssetsByPublicId = {};

    if (isProductBrochuresComponentCode(componentCode)) {
      if (nextBlocks.some((block) => block.type !== "brochure")) {
        return res.status(400).json({
          message:
            "La seccion de folletos solo admite adjuntos de biblioteca comercial",
        });
      }

      const { assetPublicIds, brochureAssetsByPublicId: resolvedBrochures } =
        await resolveProposalBrochureAssetsByPublicIds({
          user: req.user,
          assetPublicIds: nextBlocks.map((block) => block.assetPublicId),
        });

      nextBlocks = assetPublicIds.map((assetPublicId) => ({
        type: "brochure",
        assetPublicId,
      }));
      brochureAssetsByPublicId = resolvedBrochures;
      componentSettings = {
        selectionMode: normalizeProposalBrochureSelectionMode(
          parsed.data.componentSettings?.selectionMode,
          "manual",
        ),
        requestedBrochureCount: normalizeProposalBrochureRequestedCount(
          parsed.data.componentSettings?.requestedBrochureCount,
          PROPOSAL_BROCHURE_DEFAULT_REQUESTED_COUNT,
        ),
      };
    }

    await saveProposalComponentBlocks({
      proposalId,
      componentCode,
      title: parsed.data.title,
      blocks: nextBlocks,
      componentSettings,
      brochureAssetsByPublicId,
      actorUserId: Number(req.user.id),
    });
    const aiComponentConfig = await getProposalAiComponentConfigForProposal({
      proposalId,
      componentCode,
    });
    if (aiComponentConfig && parsed.data.consumeSuggestionPublicId) {
      await consumeProposalExecutiveSummaryGenerationJob({
        proposalId,
        publicId: parsed.data.consumeSuggestionPublicId,
        componentCode,
      });
    } else if (aiComponentConfig) {
      await consumeMatchingProposalExecutiveSummaryGenerationJob({
        proposalId,
        blocks: nextBlocks,
        componentCode,
      });
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
  "/proposals/:proposalId/components/:componentCode/brochure-recommendations",
  requireAnyPermission(proposalUpdateAccessPermissionCodes),
  async (req, res) => {
    if (!assertProposalUpdatePermission(req, res)) return;

    const proposalId = Number(req.params.proposalId);
    const componentCode = String(req.params.componentCode || "").trim();
    if (!Number.isInteger(proposalId) || proposalId <= 0) {
      return res.status(400).json({ message: "Id de propuesta invalido" });
    }
    if (!isProductBrochuresComponentCode(componentCode)) {
      return res.status(404).json({ message: "Componente no soportado" });
    }
    if (!(await proposalHasComponent(proposalId, componentCode))) {
      return res.status(404).json({ message: "Componente no encontrado" });
    }

    const parsed = proposalBrochureRecommendationSchema.safeParse(
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

    const recommendation = await requestProposalBrochureRecommendations({
      proposal,
      user: req.user,
      requestedBrochureCount: parsed.data.requestedBrochureCount,
    });

    return res.json({
      requestedBrochureCount: normalizeProposalBrochureRequestedCount(
        parsed.data.requestedBrochureCount,
      ),
      items: Array.isArray(recommendation.items) ? recommendation.items : [],
      warnings: Array.isArray(recommendation.warnings)
        ? recommendation.warnings
        : [],
    });
  },
);

router.post(
  "/proposals/:proposalId/components/:componentCode/generation-jobs",
  requireAnyPermission(proposalUpdateAccessPermissionCodes),
  async (req, res) => {
    if (!assertProposalUpdatePermission(req, res)) return;
    const proposalId = Number(req.params.proposalId);
    const componentCode = String(req.params.componentCode || "").trim();
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
    if (
      !(await getProposalAiComponentConfigForProposal({
        proposalId,
        componentCode,
      }))
    ) {
      return res
        .status(404)
        .json({ message: "Componente no soporta sugerencias IA" });
    }

    try {
      if (
        parsed.data.sourceScopeMode !== "documents_only" &&
        parsed.data.librarySourceMode === "manual"
      ) {
        await resolveProposalExecutiveSummaryLibraryAssets({
          user: req.user,
          proposal,
          opportunity: null,
          manufacturerCodes: [],
          solutionCodes: [],
          industryCodes: [],
          stageCodes: [],
          maxLibraryAssets: parsed.data.maxLibraryAssets,
          librarySourceMode: parsed.data.librarySourceMode,
          libraryContentMode: parsed.data.libraryContentMode,
          selectedLibraryAssetPublicIds:
            parsed.data.selectedLibraryAssetPublicIds,
        });
      }

      const creation = await createOrReuseProposalExecutiveSummaryGenerationJob(
        {
          proposal,
          componentCode,
          requestedByUserId: Number(req.user.id),
          instructions: parsed.data.instructions,
          languageCode: parsed.data.languageCode,
          maxLibraryAssets: parsed.data.maxLibraryAssets,
          sourceScopeMode: parsed.data.sourceScopeMode,
          librarySourceMode: parsed.data.librarySourceMode,
          libraryContentMode: parsed.data.libraryContentMode,
          sourcePriorityMode: parsed.data.sourcePriorityMode,
          selectedLibraryAssetPublicIds:
            parsed.data.selectedLibraryAssetPublicIds,
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
  requireAnyPermission(proposalUpdateAccessPermissionCodes),
  async (req, res) => {
    if (!assertProposalUpdatePermission(req, res)) return;
    const proposalId = Number(req.params.proposalId);
    const componentCode = String(req.params.componentCode || "").trim();
    if (!Number.isInteger(proposalId) || proposalId <= 0) {
      return res.status(400).json({ message: "Id de propuesta invalido" });
    }
    if (!(await proposalHasComponent(proposalId, componentCode))) {
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
  requireAnyPermission(proposalUpdateAccessPermissionCodes),
  async (req, res) => {
    if (!assertProposalUpdatePermission(req, res)) return;
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
  requireAnyPermission(proposalUpdateAccessPermissionCodes),
  async (req, res) => {
    if (!assertProposalUpdatePermission(req, res)) return;
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
    const approvalCapabilities = await getQuotationApprovalCapabilities({
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
      approvalCapabilities,
      isLatestVersion: Number(version.id) === Number(version.latest_version_id),
    });
  },
);

router.post(
  "/quotation-versions/:versionId/duplicate",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;
    if (
      !hasQuotationAdministration(req.user) &&
      !req.user?.permissionSet?.has("cotizaciones.operacion")
    ) {
      return res
        .status(403)
        .json({ message: "No autorizado para duplicar cotizaciones" });
    }

    const sourceVersionId = Number(req.params.versionId);
    if (!Number.isInteger(sourceVersionId) || sourceVersionId <= 0) {
      return res.status(400).json({ message: "Id de version invalido" });
    }

    const parsed = quotationDuplicateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const sourceVersion = await getAccessibleQuotationVersion({
      user: req.user,
      versionId: sourceVersionId,
    });
    if (!sourceVersion) {
      return res.status(404).json({ message: "Version origen no encontrada" });
    }

    const targetOpportunityId = Number(parsed.data.targetOpportunityId);
    const targetOpportunity = await getAccessibleOpportunity({
      user: req.user,
      opportunityId: targetOpportunityId,
    });
    if (!targetOpportunity) {
      return res
        .status(404)
        .json({ message: "Oportunidad destino no encontrada" });
    }
    if (targetOpportunity.activation_status_code !== "activada") {
      return res.status(400).json({
        message:
          "Solo se puede duplicar una cotizacion hacia una oportunidad activa",
      });
    }

    const targetSellerUserId = Number(targetOpportunity.seller_user_id || 0);
    if (!targetSellerUserId) {
      return res.status(400).json({
        message:
          "La oportunidad destino no tiene vendedor asignado y no puede recibir cotizaciones",
      });
    }

    const targetContactId = Number(targetOpportunity.contact_id || 0);
    if (!targetContactId) {
      return res.status(400).json({
        message:
          "La oportunidad destino no tiene contacto principal y no puede recibir cotizaciones",
      });
    }

    const targetContactValidation = await validateQuotationContact({
      accountId: Number(targetOpportunity.account_id),
      contactId: targetContactId,
    });
    if (!targetContactValidation.ok) {
      return res.status(400).json({ message: targetContactValidation.message });
    }

    const sourceSections = await getQuotationVersionSections(sourceVersion.id);
    const sourceQuotation = await getAccessibleQuotation({
      user: req.user,
      quotationId: Number(sourceVersion.quotation_id),
    });

    const defaultQuotationActivation = await getCatalogRowByCode(
      "quotation_activation_statuses",
      "activada",
    );
    if (!defaultQuotationActivation) {
      return res
        .status(500)
        .json({ message: "Catalogos de cotizacion incompletos" });
    }

    const now = new Date();

    const result = await withTransaction(async (conn) => {
      const [quotationResult] = await conn.query(
        `INSERT INTO quotations
          (opportunity_id, latest_version_id, activation_status_id, created_at, updated_at, created_by_user_id, updated_by_user_id)
         VALUES (?, NULL, ?, ?, ?, ?, ?)`,
        [
          targetOpportunityId,
          Number(
            sourceQuotation?.activation_status_id ||
              defaultQuotationActivation.id,
          ),
          now,
          now,
          Number(req.user.id),
          Number(req.user.id),
        ],
      );
      const duplicatedQuotationId = Number(quotationResult.insertId);

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
          duplicatedQuotationId,
          targetContactId,
          sourceVersion.proposal_name,
          sourceVersion.quotation_date,
          sourceVersion.introduction || "",
          Number(sourceVersion.status_id),
          Number(sourceVersion.activation_status_id),
          sourceVersion.summary_discount_mode ?? null,
          sourceVersion.summary_discount_value == null
            ? null
            : Number(sourceVersion.summary_discount_value),
          sourceVersion.summary_distribution_mode ?? null,
          sourceVersion.summary_vat_mode ?? null,
          sourceVersion.summary_vat_pct == null
            ? null
            : Number(sourceVersion.summary_vat_pct),
          sourceVersion.internal_notes || "",
          sourceVersion.delivery_time ?? null,
          sourceVersion.quotation_validity ?? null,
          sourceVersion.warranty_term ?? null,
          sourceVersion.payment_terms ?? null,
          sourceVersion.currency_code ?? null,
          sourceVersion.exchange_rate == null
            ? null
            : Number(sourceVersion.exchange_rate),
          sourceVersion.quotation_notes || "",
          now,
          now,
          Number(req.user.id),
          Number(req.user.id),
        ],
      );
      const duplicatedVersionId = Number(versionResult.insertId);

      for (const section of sourceSections) {
        const [sectionResult] = await conn.query(
          `INSERT INTO quotation_sections
            (quotation_version_id, title, inclusion_type_id, activation_status_id, display_order,
             created_at, updated_at, created_by_user_id, updated_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            duplicatedVersionId,
            section.title,
            Number(section.inclusionTypeId),
            Number(section.activationStatusId),
            Number(section.displayOrder),
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
          quotationCurrencyCode: sourceVersion.currency_code,
        });
      }

      await conn.query(
        `UPDATE quotations
         SET latest_version_id = ?, updated_at = ?, updated_by_user_id = ?
         WHERE id = ?`,
        [duplicatedVersionId, now, Number(req.user.id), duplicatedQuotationId],
      );

      return {
        quotationId: duplicatedQuotationId,
        versionId: duplicatedVersionId,
      };
    });

    await logAuditEvent({
      req,
      module: "cotizaciones",
      action: "duplicated",
      entityType: "quotation",
      entityId: result.quotationId,
      detail: "Cotizacion duplicada hacia otra oportunidad",
      after: {
        source_quotation_version_id: sourceVersionId,
        target_opportunity_id: targetOpportunityId,
        latest_version_id: result.versionId,
      },
    });

    return res.status(201).json({
      quotationId: result.quotationId,
      latestVersionId: result.versionId,
      message: "Cotizacion duplicada",
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
    const approvalCapabilities = await getQuotationApprovalCapabilities({
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
      approvalCapabilities,
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

router.patch(
  "/quotation-version-documents/:linkId/ai-eligibility",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;

    const linkId = Number(req.params.linkId);
    if (!Number.isInteger(linkId) || linkId <= 0) {
      return res.status(400).json({ message: "Id de documento invalido" });
    }

    const aiEnabled = Boolean(req.body?.aiEnabled);
    const link = await getQuotationVersionDocumentLink({ linkId });
    if (!link) {
      return res.status(404).json({ message: "Documento no encontrado" });
    }

    const version = await getAccessibleQuotationVersion({
      user: req.user,
      versionId: Number(link.quotation_version_id),
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
        message: "No autorizado para actualizar este documento",
      });
    }

    await ensureQuotationVersionDocumentsSchema();
    await query(
      `UPDATE quotation_version_documents
       SET ai_enabled = ?
       WHERE id = ?`,
      [aiEnabled ? 1 : 0, linkId],
    );

    await logAuditEvent({
      req,
      module: "cotizaciones",
      action: aiEnabled
        ? "quotation_document_ai_enabled"
        : "quotation_document_ai_disabled",
      entityType: "quotation_version_document",
      entityId: linkId,
      detail: aiEnabled
        ? "Documento habilitado para IA"
        : "Documento excluido de IA",
      after: { ai_enabled: aiEnabled },
    });

    return res.json({
      message: aiEnabled
        ? "Documento habilitado para IA"
        : "Documento excluido de IA",
      documents: await listQuotationVersionDocuments({
        versionId: Number(link.quotation_version_id),
      }),
      allDocuments: await listQuotationDocuments({
        quotationId: Number(link.quotation_id),
      }),
    });
  },
);

router.post(
  "/quotation-versions/:versionId/provider-document-import/preview",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;

    const versionId = Number(req.params.versionId);
    if (!Number.isInteger(versionId) || versionId <= 0) {
      return res.status(400).json({ message: "Id de version invalido" });
    }

    const parsed = providerDocumentImportPreviewSchema.safeParse(
      req.body || {},
    );
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

    const documentRow = await getQuotationDocumentLinkForQuotation({
      quotationId: version.quotation_id,
      linkId: parsed.data.documentLinkId,
    });
    if (!documentRow) {
      return res.status(404).json({
        message: "Documento no encontrado en esta cotizacion",
      });
    }
    if (Number(documentRow.ai_enabled) !== 1) {
      return res.status(409).json({
        message: "El documento seleccionado esta excluido de IA",
      });
    }

    try {
      const result =
        await createOrReuseQuotationProviderDocumentImportPreviewJob({
          version,
          documentRow,
          providerId: parsed.data.providerId,
          requestedByUserId: Number(req.user.id),
        });

      if (!result.wasReused) {
        queueQuotationProviderDocumentImportPreviewProcessing();
      }

      return res.status(202).json(result.response);
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        message:
          error.message || "No fue posible analizar el documento del proveedor",
      });
    }
  },
);

router.post(
  "/quotation-create/provider-document-import/preview",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;

    const { files, fields } = await parseMultipartFiles(req);
    if (!files.length) {
      return res
        .status(400)
        .json({ message: "Selecciona un documento para analizar" });
    }

    const [uploadedFile] = files;
    const providerId = Number(fields?.providerId || 0) || null;

    try {
      const result = await buildDraftProviderDocumentImportPreview({
        uploadedFile,
        providerId,
      });
      return res.json({
        message: "Documento analizado",
        result,
        workflowStage: result.workflowStage,
      });
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        message:
          error.message || "No fue posible analizar el documento del proveedor",
      });
    } finally {
      await cleanupTempFiles(files);
    }
  },
);

router.get(
  "/quotation-versions/:versionId/provider-document-import/preview/jobs/:jobId",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;

    const versionId = Number(req.params.versionId);
    const jobId = String(req.params.jobId || "").trim();
    if (!Number.isInteger(versionId) || versionId <= 0 || !jobId) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const version = await getAccessibleQuotationVersion({
      user: req.user,
      versionId,
    });
    if (!version) {
      return res.status(404).json({ message: "Version no encontrada" });
    }

    const job = await getQuotationProviderDocumentImportPreviewJob({
      publicId: jobId,
      quotationVersionId: versionId,
    });
    if (!job) {
      return res.status(404).json({ message: "Job no encontrado" });
    }

    return res.json(job);
  },
);

router.post(
  "/quotation-versions/:versionId/provider-document-import/create-missing-items",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;

    const versionId = Number(req.params.versionId);
    if (!Number.isInteger(versionId) || versionId <= 0) {
      return res.status(400).json({ message: "Id de version invalido" });
    }

    const parsed = providerDocumentImportCreateMissingItemsSchema.safeParse(
      req.body || {},
    );
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
      return res.status(403).json({
        message: "No autorizado para crear items faltantes en esta version",
      });
    }

    const documentRow = await getQuotationDocumentLinkForQuotation({
      quotationId: version.quotation_id,
      linkId: parsed.data.documentLinkId,
    });
    if (!documentRow) {
      return res.status(404).json({
        message: "Documento no encontrado en esta cotizacion",
      });
    }
    if (Number(documentRow.ai_enabled) !== 1) {
      return res.status(409).json({
        message: "El documento seleccionado esta excluido de IA",
      });
    }

    const activePriceList = await getActiveProviderImportPriceList(
      parsed.data.confirmedProviderId,
    );
    if (!activePriceList) {
      return res.status(409).json({
        message:
          "El proveedor confirmado no tiene una lista activa de productos",
      });
    }

    const latestPreview =
      (await getReusableQuotationProviderDocumentImportPreviewResult({
        version,
        documentRow,
        providerId: parsed.data.confirmedProviderId,
      })) ||
      (await buildProviderDocumentImportPreview({
        version,
        documentRow,
        providerId: parsed.data.confirmedProviderId,
      }));

    const requestedItems = (parsed.data.items || []).filter(
      (item) => item.selectedForPriceListCreation,
    );
    if (!requestedItems.length) {
      return res.status(409).json({
        message:
          "Selecciona al menos un item faltante para crear en la lista del proveedor",
      });
    }

    const requestedNormalizedCodes = new Set();

    const latestPreviewItemsById = new Map(
      (latestPreview.items || []).map((item) => [String(item.previewId), item]),
    );
    const invalidRequestedItems = requestedItems.filter((item) => {
      const latestItem = latestPreviewItemsById.get(String(item.previewId));
      const resolvedItem = resolveProviderDocumentImportPreviewItemForAction({
        previewItem: latestItem,
        payloadItem: item,
      });
      return (
        !latestItem ||
        !resolvedItem.resolved ||
        resolvedItem.matchStatus !== "missing_in_price_list" ||
        !resolvedItem.canCreateInPriceList
      );
    });
    if (invalidRequestedItems.length) {
      return res.status(409).json({
        message:
          "Algunos items seleccionados ya no se pueden crear en la lista. Actualiza el analisis y vuelve a intentarlo.",
      });
    }

    for (const requestedItem of requestedItems) {
      const latestItem = latestPreviewItemsById.get(
        String(requestedItem.previewId),
      );
      const normalizedCode = normalizeProviderDocumentImportCode(
        latestItem?.providerCode,
      );
      if (!normalizedCode) {
        return res.status(409).json({
          message:
            "Uno de los items seleccionados no tiene un codigo valido para crear en la lista del proveedor.",
        });
      }
      if (requestedNormalizedCodes.has(normalizedCode)) {
        return res.status(409).json({
          message:
            "Hay items seleccionados con codigos duplicados. Deja solo un item por codigo antes de crear en la lista del proveedor.",
        });
      }
      requestedNormalizedCodes.add(normalizedCode);
    }

    const activePriceItemStatusId = await getProviderPriceItemActiveStatusId();
    const productTypeId = await getProductTypeIdByCode("producto");
    if (!activePriceItemStatusId || !productTypeId) {
      return res.status(500).json({
        message:
          "No fue posible resolver la configuracion base para crear items faltantes",
      });
    }

    const equivalentItemsByNormalizedCode = new Map();
    for (const requestedItem of requestedItems) {
      const latestItem = latestPreviewItemsById.get(
        String(requestedItem.previewId),
      );
      const normalizedCode = normalizeProviderDocumentImportCode(
        latestItem?.providerCode,
      );
      const equivalentItem = await findProviderPriceListItemByNormalizedCode({
        priceListId: activePriceList.id,
        code: latestItem?.providerCode,
      });
      if (equivalentItem) {
        equivalentItemsByNormalizedCode.set(normalizedCode, equivalentItem);
      }
    }

    const now = new Date();
    const createdItems = await withTransaction(async (conn) => {
      const created = [];

      for (const requestedItem of requestedItems) {
        const latestItem = latestPreviewItemsById.get(
          String(requestedItem.previewId),
        );
        const normalizedCode = normalizeProviderDocumentImportCode(
          latestItem.providerCode,
        );
        const equivalentItem =
          equivalentItemsByNormalizedCode.get(normalizedCode) || null;
        if (equivalentItem) {
          created.push({
            previewId: latestItem.previewId,
            providerCode: latestItem.providerCode,
            createdPriceListItemId: Number(equivalentItem.id),
            reused: true,
          });
          continue;
        }
        const existingItem = await getProviderPriceListItemByCode({
          priceListId: activePriceList.id,
          code: latestItem.providerCode,
        });
        if (existingItem) {
          created.push({
            previewId: latestItem.previewId,
            providerCode: latestItem.providerCode,
            createdPriceListItemId: Number(existingItem.id),
            reused: true,
          });
          continue;
        }

        const [providerItemInsertResult] = await conn.query(
          `INSERT INTO provider_price_list_items
            (provider_id, price_list_id, code, description, product_type_id, item_type, price, currency_id, activation_status_id,
             created_by, created_at, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, 'producto', ?, ?, ?, ?, ?, ?, ?)`,
          [
            Number(parsed.data.confirmedProviderId),
            Number(activePriceList.id),
            latestItem.providerCode,
            latestItem.productDescription,
            Number(productTypeId),
            Number(latestItem.resolvedCostUnit),
            Number(activePriceList.currency_id),
            Number(activePriceItemStatusId),
            Number(req.user.id),
            now,
            Number(req.user.id),
            now,
          ],
        );
        created.push({
          previewId: latestItem.previewId,
          providerCode: latestItem.providerCode,
          createdPriceListItemId: Number(providerItemInsertResult.insertId),
          reused: false,
        });
      }

      return created;
    });

    const refreshedPreview = patchProviderDocumentImportPreviewWithCreatedItems(
      latestPreview,
      createdItems,
    );

    await logAuditEvent({
      req,
      module: "cotizaciones",
      action: "provider_document_import_missing_items_created",
      entityType: "quotation_version",
      entityId: versionId,
      detail:
        "Items faltantes creados en la lista del proveedor desde sugerencia IA",
      after: {
        document_link_id: Number(parsed.data.documentLinkId),
        provider_id: Number(parsed.data.confirmedProviderId),
        created_count: createdItems.length,
      },
    });

    return res.status(201).json({
      message: `Se ${createdItems.length === 1 ? "creo" : "crearon"} ${createdItems.length} item${createdItems.length === 1 ? "" : "s"} en la lista del proveedor`,
      createdCount: createdItems.length,
      createdItems,
      preview: refreshedPreview,
      workflowStage: refreshedPreview.workflowStage,
    });
  },
);

router.post(
  "/quotation-create/provider-document-import/create-missing-items",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;

    const parsed =
      providerDocumentImportDraftCreateMissingItemsSchema.safeParse(
        req.body || {},
      );
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const activePriceList = await getActiveProviderImportPriceList(
      parsed.data.confirmedProviderId,
    );
    if (!activePriceList) {
      return res.status(409).json({
        message:
          "El proveedor confirmado no tiene una lista activa de productos",
      });
    }

    const requestedItems = (parsed.data.items || []).filter(
      (item) => item.selectedForPriceListCreation,
    );
    if (!requestedItems.length) {
      return res.status(409).json({
        message:
          "Selecciona al menos un item faltante para crear en la lista del proveedor",
      });
    }

    const requestedNormalizedCodes = new Set();
    for (const requestedItem of requestedItems) {
      const normalizedCode = normalizeProviderDocumentImportCode(
        requestedItem?.providerCode,
      );
      if (!normalizedCode) {
        return res.status(409).json({
          message:
            "Uno de los items seleccionados no tiene un codigo valido para crear en la lista del proveedor.",
        });
      }
      if (requestedNormalizedCodes.has(normalizedCode)) {
        return res.status(409).json({
          message:
            "Hay items seleccionados con codigos duplicados. Deja solo un item por codigo antes de crear en la lista del proveedor.",
        });
      }
      requestedNormalizedCodes.add(normalizedCode);
    }

    const activePriceItemStatusId = await getProviderPriceItemActiveStatusId();
    const productTypeId = await getProductTypeIdByCode("producto");
    if (!activePriceItemStatusId || !productTypeId) {
      return res.status(500).json({
        message:
          "No fue posible resolver la configuracion base para crear items faltantes",
      });
    }

    const equivalentItemsByNormalizedCode = new Map();
    for (const requestedItem of requestedItems) {
      const normalizedCode = normalizeProviderDocumentImportCode(
        requestedItem?.providerCode,
      );
      const equivalentItem = await findProviderPriceListItemByNormalizedCode({
        priceListId: activePriceList.id,
        code: requestedItem?.providerCode,
      });
      if (equivalentItem) {
        equivalentItemsByNormalizedCode.set(normalizedCode, equivalentItem);
      }
    }

    const now = new Date();
    const createdItems = await withTransaction(async (conn) => {
      const created = [];

      for (const requestedItem of requestedItems) {
        const normalizedCode = normalizeProviderDocumentImportCode(
          requestedItem.providerCode,
        );
        const equivalentItem =
          equivalentItemsByNormalizedCode.get(normalizedCode) || null;
        if (equivalentItem) {
          created.push({
            previewId: requestedItem.previewId,
            providerCode: requestedItem.providerCode,
            createdPriceListItemId: Number(equivalentItem.id),
            reused: true,
          });
          continue;
        }

        const existingItem = await getProviderPriceListItemByCode({
          priceListId: activePriceList.id,
          code: requestedItem.providerCode,
        });
        if (existingItem) {
          created.push({
            previewId: requestedItem.previewId,
            providerCode: requestedItem.providerCode,
            createdPriceListItemId: Number(existingItem.id),
            reused: true,
          });
          continue;
        }

        const [providerItemInsertResult] = await conn.query(
          `INSERT INTO provider_price_list_items
            (provider_id, price_list_id, code, description, product_type_id, item_type, price, currency_id, activation_status_id,
             created_by, created_at, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, 'producto', ?, ?, ?, ?, ?, ?, ?)`,
          [
            Number(parsed.data.confirmedProviderId),
            Number(activePriceList.id),
            requestedItem.providerCode,
            requestedItem.productDescription,
            Number(productTypeId),
            Number(requestedItem.resolvedCostUnit),
            Number(activePriceList.currency_id),
            Number(activePriceItemStatusId),
            Number(req.user.id),
            now,
            Number(req.user.id),
            now,
          ],
        );
        created.push({
          previewId: requestedItem.previewId,
          providerCode: requestedItem.providerCode,
          createdPriceListItemId: Number(providerItemInsertResult.insertId),
          reused: false,
        });
      }

      return created;
    });

    await logAuditEvent({
      req,
      module: "cotizaciones",
      action: "provider_document_import_missing_items_created",
      entityType: "provider_price_list",
      entityId: Number(activePriceList.id),
      detail:
        "Items faltantes creados en la lista del proveedor desde el modal de crear cotizacion",
      after: {
        provider_id: Number(parsed.data.confirmedProviderId),
        created_count: createdItems.length,
      },
    });

    return res.status(201).json({
      message: `Se ${createdItems.length === 1 ? "creo" : "crearon"} ${createdItems.length} item${createdItems.length === 1 ? "" : "s"} en la lista del proveedor`,
      createdCount: createdItems.length,
      createdItems,
    });
  },
);

router.post(
  "/quotation-versions/:versionId/provider-document-import/apply",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;

    const versionId = Number(req.params.versionId);
    if (!Number.isInteger(versionId) || versionId <= 0) {
      return res.status(400).json({ message: "Id de version invalido" });
    }

    const parsed = providerDocumentImportApplySchema.safeParse(req.body || {});
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
      return res.status(403).json({
        message: "No autorizado para importar items en esta version",
      });
    }

    const documentRow = await getQuotationDocumentLinkForQuotation({
      quotationId: version.quotation_id,
      linkId: parsed.data.documentLinkId,
    });
    if (!documentRow) {
      return res.status(404).json({
        message: "Documento no encontrado en esta cotizacion",
      });
    }
    if (Number(documentRow.ai_enabled) !== 1) {
      return res.status(409).json({
        message: "El documento seleccionado esta excluido de IA",
      });
    }

    const activePriceList = await getActiveProviderImportPriceList(
      parsed.data.confirmedProviderId,
    );
    if (!activePriceList) {
      return res.status(409).json({
        message:
          "El proveedor confirmado no tiene una lista activa de productos",
      });
    }

    const activePriceListItems = await listActiveProviderPriceListItems({
      priceListId: Number(activePriceList.id),
    });
    const activePriceListItemsById = new Map(
      activePriceListItems.map((item) => [Number(item.id), item]),
    );
    const activePriceListItemsByExactCode = new Map(
      activePriceListItems.map((item) => [
        String(item.code || "").trim(),
        item,
      ]),
    );
    const activePriceListItemsByNormalizedCode = new Map(
      activePriceListItems.map((item) => [
        normalizeProviderDocumentImportCode(item.code),
        item,
      ]),
    );

    const resolvedApplyItems = (parsed.data.items || []).map((item) => {
      const directMatchedItemId = Number(
        item.matchedPriceListItemId ||
          item.selectedSuggestedPriceListItemId ||
          0,
      );
      const directMatchedItem = directMatchedItemId
        ? activePriceListItemsById.get(directMatchedItemId) || null
        : null;
      const exactCodeMatch = activePriceListItemsByExactCode.get(
        String(item.providerCode || "").trim(),
      );
      const normalizedCodeMatch = activePriceListItemsByNormalizedCode.get(
        normalizeProviderDocumentImportCode(item.providerCode),
      );
      const matchedItem =
        directMatchedItem || exactCodeMatch || normalizedCodeMatch || null;

      return {
        payloadItem: item,
        matchedPriceListItemId: matchedItem ? Number(matchedItem.id) : null,
      };
    });
    const resolvedApplyItemsByPreviewId = new Map(
      resolvedApplyItems.map((item) => [
        String(item.payloadItem.previewId),
        item,
      ]),
    );

    const invalidApplyItems = resolvedApplyItems.filter(
      ({ payloadItem, matchedPriceListItemId }) => {
        const resolutionAction = String(
          payloadItem?.resolutionAction || "",
        ).trim();
        return (
          resolutionAction === "treat_as_missing" || !matchedPriceListItemId
        );
      },
    );
    if (invalidApplyItems.length) {
      return res.status(409).json({
        message:
          "Todavia hay items sin resolver contra la lista del proveedor. Primero crea los faltantes y actualiza el analisis.",
      });
    }

    const normalizedWarningsByPreviewId = new Map(
      (parsed.data.items || []).map((item) => [
        String(item.previewId),
        normalizeProviderDocumentImportWarningsToSpanish(item.warnings || []),
      ]),
    );
    const itemWarnings = Array.from(
      new Set(
        Array.from(normalizedWarningsByPreviewId.values()).flatMap(
          (warnings) => warnings,
        ),
      ),
    );

    if (
      parsed.data.items.some((item) => Number(item.resolvedCostUnit || 0) < 0)
    ) {
      return res.status(409).json({
        message:
          "Todos los items importados deben tener un costo unitario resuelto mayor o igual a cero",
      });
    }

    const activeSectionStatus = await getCatalogRowByCode(
      "quotation_activation_statuses",
      "activada",
    );
    const includedSectionType = await getCatalogRowByCode(
      "quotation_section_inclusion_types",
      "incluida",
    );
    const activePriceItemStatusId = await getProviderPriceItemActiveStatusId();
    const productTypeId = await getProductTypeIdByCode("producto");
    if (
      !activeSectionStatus ||
      !includedSectionType ||
      !activePriceItemStatusId ||
      !productTypeId
    ) {
      return res.status(500).json({
        message: "No fue posible resolver la configuracion base de importacion",
      });
    }

    const now = new Date();
    const commercialTermsSelection = {
      deliveryTime: Boolean(parsed.data.commercialTermsSelection?.deliveryTime),
      quotationValidity: Boolean(
        parsed.data.commercialTermsSelection?.quotationValidity,
      ),
      warranty: Boolean(parsed.data.commercialTermsSelection?.warranty),
      paymentTerms: Boolean(parsed.data.commercialTermsSelection?.paymentTerms),
      currencyCode: Boolean(parsed.data.commercialTermsSelection?.currencyCode),
    };
    const [
      deliveryTimeOptions,
      quotationValidityOptions,
      warrantyOptions,
      paymentTermsOptions,
    ] = await Promise.all([
      listActiveQuotationCommercialTermOptions("quotation_delivery_times"),
      listActiveQuotationCommercialTermOptions("quotation_validity_terms"),
      listActiveQuotationCommercialTermOptions("quotation_warranty_terms"),
      listActiveQuotationCommercialTermOptions("quotation_payment_terms"),
    ]);
    const deliveryTimeIndex =
      buildProviderDocumentImportCommercialTermIndex(deliveryTimeOptions);
    const quotationValidityIndex =
      buildProviderDocumentImportCommercialTermIndex(quotationValidityOptions);
    const warrantyIndex =
      buildProviderDocumentImportCommercialTermIndex(warrantyOptions);
    const paymentTermsIndex =
      buildProviderDocumentImportCommercialTermIndex(paymentTermsOptions);

    const suggestedCommercialTerms = {
      deliveryTime:
        parsed.data.commercialTerms?.deliveryTime ||
        latestPreview.commercialTerms?.deliveryTime ||
        "",
      quotationValidity:
        parsed.data.commercialTerms?.quotationValidity ||
        latestPreview.commercialTerms?.quotationValidity ||
        "",
      warranty:
        parsed.data.commercialTerms?.warranty ||
        latestPreview.commercialTerms?.warranty ||
        "",
      paymentTerms:
        parsed.data.commercialTerms?.paymentTerms ||
        latestPreview.commercialTerms?.paymentTerms ||
        "",
    };
    const requestedCommercialTerms = {
      deliveryTime:
        parsed.data.commercialTerms?.deliveryTime ||
        latestPreview.commercialTerms?.deliveryTime ||
        version.delivery_time ||
        "30_dias",
      quotationValidity:
        parsed.data.commercialTerms?.quotationValidity ||
        latestPreview.commercialTerms?.quotationValidity ||
        version.quotation_validity ||
        "30_dias",
      warranty:
        parsed.data.commercialTerms?.warranty ||
        latestPreview.commercialTerms?.warranty ||
        version.warranty_term ||
        "1_ano",
      paymentTerms:
        parsed.data.commercialTerms?.paymentTerms ||
        latestPreview.commercialTerms?.paymentTerms ||
        version.payment_terms ||
        "30_dias_facturado",
    };
    const resolvedDeliveryTime =
      resolveProviderDocumentImportCommercialTermCode({
        field: "deliveryTime",
        value: requestedCommercialTerms.deliveryTime,
        index: deliveryTimeIndex,
      });
    const resolvedQuotationValidity =
      resolveProviderDocumentImportCommercialTermCode({
        field: "quotationValidity",
        value: requestedCommercialTerms.quotationValidity,
        index: quotationValidityIndex,
      });
    const resolvedWarranty = resolveProviderDocumentImportCommercialTermCode({
      field: "warranty",
      value: requestedCommercialTerms.warranty,
      index: warrantyIndex,
    });
    const resolvedPaymentTerms =
      resolveProviderDocumentImportCommercialTermCode({
        field: "paymentTerms",
        value: requestedCommercialTerms.paymentTerms,
        index: paymentTermsIndex,
      });

    const commercialFallbackNotes = [];
    if (
      commercialTermsSelection.deliveryTime &&
      resolvedDeliveryTime.usedFallback &&
      normalizeProviderDocumentImportText(
        suggestedCommercialTerms.deliveryTime,
        180,
      )
    ) {
      commercialFallbackNotes.push(
        buildProviderDocumentImportFallbackNoteLine(
          "Tiempo de entrega",
          suggestedCommercialTerms.deliveryTime,
        ),
      );
    }
    if (
      commercialTermsSelection.quotationValidity &&
      resolvedQuotationValidity.usedFallback &&
      normalizeProviderDocumentImportText(
        suggestedCommercialTerms.quotationValidity,
        180,
      )
    ) {
      commercialFallbackNotes.push(
        buildProviderDocumentImportFallbackNoteLine(
          "Validez",
          suggestedCommercialTerms.quotationValidity,
        ),
      );
    }
    if (
      commercialTermsSelection.warranty &&
      resolvedWarranty.usedFallback &&
      normalizeProviderDocumentImportText(
        suggestedCommercialTerms.warranty,
        180,
      )
    ) {
      commercialFallbackNotes.push(
        buildProviderDocumentImportFallbackNoteLine(
          "Garantia",
          suggestedCommercialTerms.warranty,
        ),
      );
    }
    if (
      commercialTermsSelection.paymentTerms &&
      resolvedPaymentTerms.usedFallback &&
      normalizeProviderDocumentImportText(
        suggestedCommercialTerms.paymentTerms,
        180,
      )
    ) {
      commercialFallbackNotes.push(
        buildProviderDocumentImportFallbackNoteLine(
          "Pago",
          suggestedCommercialTerms.paymentTerms,
        ),
      );
    }

    const updatedQuotationNotes = appendProviderDocumentImportNotes(
      version.quotation_notes || "",
      commercialFallbackNotes,
    );

    const finalCommercialTerms = {
      deliveryTime:
        resolvedDeliveryTime.code || version.delivery_time || "30_dias",
      quotationValidity:
        resolvedQuotationValidity.code ||
        version.quotation_validity ||
        "30_dias",
      warranty: resolvedWarranty.code || version.warranty_term || "1_ano",
      paymentTerms:
        resolvedPaymentTerms.code ||
        version.payment_terms ||
        "30_dias_facturado",
      currencyCode: normalizeProviderDocumentImportCurrencyCode(
        parsed.data.commercialTerms?.currencyCode ||
          version.currency_code ||
          activePriceList.currency_code ||
          "USD",
        "USD",
      ),
    };

    const result = await withTransaction(async (conn) => {
      const [displayOrderRows] = await Promise.all([
        conn.query(
          `SELECT COALESCE(MAX(display_order), 0) AS max_display_order
           FROM quotation_sections
           WHERE quotation_version_id = ?`,
          [versionId],
        ),
      ]);
      const maxDisplayOrder = Number(
        displayOrderRows[0]?.[0]?.max_display_order ||
          displayOrderRows[0]?.max_display_order ||
          0,
      );

      const [sectionInsertResult] = await conn.query(
        `INSERT INTO quotation_sections
          (quotation_version_id, title, inclusion_type_id, activation_status_id, display_order,
           created_at, updated_at, created_by_user_id, updated_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          Number(versionId),
          "Seccion sugerida",
          Number(includedSectionType.id),
          Number(activeSectionStatus.id),
          maxDisplayOrder + 1,
          now,
          now,
          Number(req.user.id),
          Number(req.user.id),
        ],
      );
      const createdSectionId = Number(sectionInsertResult.insertId);

      let createdProviderItems = 0;
      const insertedQuotationItemIds = [];

      for (const [index, item] of parsed.data.items.entries()) {
        const resolvedItem = resolvedApplyItemsByPreviewId.get(
          String(item.previewId),
        );
        const sourceProviderPriceListItemId =
          resolvedItem?.matchedPriceListItemId
            ? Number(resolvedItem.matchedPriceListItemId)
            : item.matchedPriceListItemId
              ? Number(item.matchedPriceListItemId)
              : null;

        if (!sourceProviderPriceListItemId) {
          throw Object.assign(
            new Error(
              "Todos los items aplicados deben existir ya en la lista del proveedor",
            ),
            { status: 409 },
          );
        }

        const originalCurrencyCode =
          normalizeProviderDocumentImportCurrencyCode(
            item.originalCurrencyCode || finalCommercialTerms.currencyCode,
            finalCommercialTerms.currencyCode,
          );
        const originalListPriceUnit = roundProviderDocumentImportMoney(
          item.resolvedCostUnit,
        );
        const listPriceUnit = convertProviderDocumentImportCostToQuotationPrice(
          {
            originalCostUnit: originalListPriceUnit,
            originalCurrencyCode,
            quotationCurrencyCode: finalCommercialTerms.currencyCode,
            exchangeRate: version.exchange_rate || 1,
          },
        );

        const [quotationItemInsertResult] = await conn.query(
          `INSERT INTO quotation_section_items
            (quotation_section_id, provider_id, product_code, product_description, item_type, is_renewal, bundle_parent_item_id,
             bundle_origin_type, source_provider_price_list_item_id, source_component_price_list_item_id, import_warnings_json,
             quantity, original_currency_code, original_list_price_unit, list_price_unit,
             manufacturer_discount_pct, import_cost_pct, profit_margin_pct,
             final_discount_pct, display_order, bundle_sort_order, created_at, updated_at, created_by_user_id, updated_by_user_id)
           VALUES (?, ?, ?, ?, 'producto', 0, NULL, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, 0, 30, 0, ?, NULL, ?, ?, ?, ?)`,
          [
            createdSectionId,
            Number(parsed.data.confirmedProviderId),
            item.providerCode,
            appendProviderDocumentImportWarningsToDescription(
              item.productDescription,
              normalizedWarningsByPreviewId.get(String(item.previewId)) || [],
            ),
            sourceProviderPriceListItemId,
            JSON.stringify(
              normalizedWarningsByPreviewId.get(String(item.previewId)) || [],
            ),
            Number(item.quantity),
            originalCurrencyCode,
            originalListPriceUnit,
            listPriceUnit,
            Number(item.manufacturerDiscountPct || 0),
            index + 1,
            now,
            now,
            Number(req.user.id),
            Number(req.user.id),
          ],
        );
        insertedQuotationItemIds.push(
          Number(quotationItemInsertResult.insertId),
        );
      }

      if (Object.values(commercialTermsSelection).some(Boolean)) {
        await conn.query(
          `UPDATE quotation_versions
           SET delivery_time = ?, quotation_validity = ?, warranty_term = ?, payment_terms = ?, currency_code = ?, quotation_notes = ?,
               updated_at = ?, updated_by_user_id = ?
           WHERE id = ?`,
          [
            commercialTermsSelection.deliveryTime
              ? finalCommercialTerms.deliveryTime
              : version.delivery_time,
            commercialTermsSelection.quotationValidity
              ? finalCommercialTerms.quotationValidity
              : version.quotation_validity,
            commercialTermsSelection.warranty
              ? finalCommercialTerms.warranty
              : version.warranty_term,
            commercialTermsSelection.paymentTerms
              ? finalCommercialTerms.paymentTerms
              : version.payment_terms,
            commercialTermsSelection.currencyCode
              ? finalCommercialTerms.currencyCode
              : version.currency_code,
            updatedQuotationNotes,
            now,
            Number(req.user.id),
            Number(versionId),
          ],
        );
      }

      await conn.query(
        `INSERT INTO quotation_version_document_imports
          (quotation_id, quotation_version_id, document_id, provider_id, created_section_id,
           requested_by_user_id, preview_snapshot_json, apply_snapshot_json, warnings_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          Number(version.quotation_id),
          Number(versionId),
          Number(documentRow.document_id),
          Number(parsed.data.confirmedProviderId),
          createdSectionId,
          Number(req.user.id),
          JSON.stringify({
            documentLinkId: parsed.data.documentLinkId,
            documentId: documentRow.document_id,
            commercialTerms: finalCommercialTerms,
            commercialTermsSelection,
            itemCount: parsed.data.items.length,
          }),
          JSON.stringify(parsed.data),
          JSON.stringify(itemWarnings),
          now,
        ],
      );

      return {
        createdSectionId,
        createdProviderItems,
        createdQuotationItems: insertedQuotationItemIds.length,
        appliedCommercialTerms: Object.values(commercialTermsSelection).some(
          Boolean,
        ),
      };
    });

    await logAuditEvent({
      req,
      module: "cotizaciones",
      action: "provider_document_import_applied",
      entityType: "quotation_version",
      entityId: versionId,
      detail: "Items de cotizacion creados desde documento de proveedor con IA",
      after: {
        document_link_id: Number(parsed.data.documentLinkId),
        document_id: Number(documentRow.document_id),
        provider_id: Number(parsed.data.confirmedProviderId),
        created_section_id: Number(result.createdSectionId),
        created_provider_items: Number(result.createdProviderItems),
        created_quotation_items: Number(result.createdQuotationItems),
        applied_commercial_terms: Boolean(result.appliedCommercialTerms),
      },
    });

    return res.status(201).json({
      message: "Importacion aplicada correctamente",
      ...result,
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
  "/quotation-versions/:versionId/public-share-link",
  requireAnyPermission(quotationPermissionCodes),
  async (req, res) => {
    if (!assertQuotationPermission(req, res)) return;

    const versionId = Number(req.params.versionId);
    if (!Number.isInteger(versionId) || versionId <= 0) {
      return res.status(400).json({ message: "Id de version invalido" });
    }

    const parsed = quotationPublicShareCreateSchema.safeParse(req.body || {});
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
      return res.status(409).json({
        message:
          "Solo la version mayor puede compartirse mediante enlace publico.",
      });
    }
    if (!quotationShareEligibleStatusCodes.has(String(version.status_code))) {
      return res.status(409).json({
        message:
          "La version debe estar aprobada o en estado posterior para generar un enlace publico.",
      });
    }

    await ensureQuotationPublicShareTable();

    const now = new Date();
    const ttlDays = Number(parsed.data.ttlDays || 30);
    const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
    const token = buildQuotationPublicShareToken();
    const tokenHash = buildQuotationPublicShareTokenHash(token);

    await query(
      `INSERT INTO quotation_public_share_links
        (quotation_version_id, created_by_user_id, token_hash, pdf_payload_json, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(version.id),
        Number(req.user.id),
        tokenHash,
        JSON.stringify(parsed.data.pdfPayload),
        expiresAt,
        now,
        now,
      ],
    );

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const shareUrl = `${baseUrl}/api/public/quotation-shares/${encodeURIComponent(token)}/pdf`;

    await logAuditEvent({
      req,
      module: "cotizaciones",
      action: "generar_enlace_publico",
      entityType: "quotation_version",
      entityId: Number(version.id),
      detail: "Enlace publico de cotizacion generado",
      after: {
        expires_at: expiresAt.toISOString(),
      },
    });

    return res.json({
      url: shareUrl,
      expiresAt: expiresAt.toISOString(),
      versionId: Number(version.id),
    });
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
  requireAnyPermission(proposalReadAccessPermissionCodes),
  async (req, res) => {
    if (!assertProposalReadPermission(req, res)) return;

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
    const brochureAttachments = [];
    const brochureAttachmentKeys = new Set();

    for (const block of parsed.data.brochureBlocks || []) {
      if (block.type !== "brochure" || !block.assetPublicId) {
        continue;
      }

      for (const file of block.brochure?.files || []) {
        const filePublicId = String(file?.publicId || "").trim();
        if (!filePublicId) {
          continue;
        }

        const attachmentKey = `${block.assetPublicId}:${filePublicId}`;
        if (brochureAttachmentKeys.has(attachmentKey)) {
          continue;
        }

        brochureAttachmentKeys.add(attachmentKey);

        try {
          const resource = await getCommercialEnablementFileStream({
            assetPublicId: block.assetPublicId,
            filePublicId,
            user: req.user,
          });
          if (!resource) {
            continue;
          }

          brochureAttachments.push({
            title:
              String(block.brochure?.title || "").trim() ||
              String(resource.fileName || file.fileName || "").trim() ||
              "Folleto",
            fileName:
              String(resource.fileName || file.fileName || "").trim() ||
              "folleto",
            mimeType:
              String(resource.mimeType || file.mimeType || "").trim() ||
              "application/octet-stream",
            buffer: await streamToBuffer(resource.stream),
          });
        } catch {
          // Ignore missing brochure attachments and keep generating the proposal.
        }
      }
    }

    const { buffer, fileName } = await buildProposalPdfBuffer({
      ...parsed.data,
      company,
      quotationAttachment,
      brochureAttachments,
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

const QUOTATION_APPROVAL_TOTAL_MARGIN_MIN_PCT = 30;
const QUOTATION_APPROVAL_PRODUCT_MARGIN_MIN_PCT = 10;
const QUOTATION_APPROVAL_SERVICE_MARGIN_MIN_PCT = 40;
const QUOTATION_APPROVAL_COST_TOLERANCE_ABS = 0.01;
const QUOTATION_APPROVAL_COST_TOLERANCE_REL = 0.001;
const QUOTATION_APPROVAL_MANDATORY_SERVICE_RULES = {
  implementation: /implementacion|implementation|impl\b/i,
  support: /soporte|support/i,
};

function buildQuotationApprovalBlockingRule(code, message, details = {}) {
  return {
    code,
    message,
    ...details,
  };
}

function buildQuotationApprovalWarning(code, message, details = {}) {
  return {
    code,
    message,
    ...details,
  };
}

function normalizeQuotationApprovalComparableText(value) {
  return normalizeProviderDocumentImportComparableText(value)
    .replace(/[_-]+/g, " ")
    .trim();
}

function normalizeQuotationApprovalTermValue(field, value) {
  const comparable = normalizeQuotationApprovalComparableText(value);
  if (!comparable) {
    return null;
  }

  if (
    comparable === "segun notas" ||
    comparable === "de acuerdo a lo indicado en notas" ||
    comparable === "according to notes" ||
    comparable === "as indicated in notes"
  ) {
    return null;
  }

  if (field === "warranty") {
    const yearMatch = comparable.match(/^(\d+)\s*(?:ano|anos|year|years)$/u);
    if (yearMatch) {
      return Number(yearMatch[1]) * 12;
    }
    const monthMatch = comparable.match(
      /^(\d+)\s*(?:mes|meses|month|months)$/u,
    );
    if (monthMatch) {
      return Number(monthMatch[1]);
    }
    return null;
  }

  if (
    comparable === "inmediato" ||
    comparable === "immediate" ||
    comparable === "immediately"
  ) {
    return 0;
  }

  if (
    comparable === "contado" ||
    comparable === "100 adelantado" ||
    comparable === "100% adelantado" ||
    comparable === "100 advance" ||
    comparable === "100% advance" ||
    comparable === "100 upfront" ||
    comparable === "100% upfront" ||
    comparable === "100 entrega" ||
    comparable === "100% contra entrega" ||
    comparable === "100 on delivery" ||
    comparable === "100% on delivery" ||
    comparable === "50 adelantado 50 entrega" ||
    comparable === "50% adelantado 50% contra entrega" ||
    comparable === "50% anticipo y saldo contra entrega" ||
    comparable === "50 anticipo y saldo contra entrega" ||
    comparable === "50 advance 50 on delivery" ||
    comparable === "50% advance 50% on delivery"
  ) {
    return 0;
  }

  const daysMatch = comparable.match(/^(\d+)\s*(?:dia|dias|day|days)$/u);
  if (daysMatch) {
    return Number(daysMatch[1]);
  }

  const invoicedDaysMatch = comparable.match(
    /^(?:factura a )?(\d+)\s*(?:dia|dias|day|days)\s*(?:despues de facturado|after invoiced|after invoice|after billing|net)?$/u,
  );
  if (invoicedDaysMatch) {
    return Number(invoicedDaysMatch[1]);
  }

  const netDaysMatch = comparable.match(/^net\s*(\d+)$/u);
  if (netDaysMatch) {
    return Number(netDaysMatch[1]);
  }

  return null;
}

function evaluateQuotationApprovalCommercialTerms({
  version,
  providerCommercialTerms,
  warnings,
  blockingRules,
}) {
  const fieldConfig = [
    {
      field: "deliveryTime",
      quotationRaw: version.delivery_time,
      providerRaw: providerCommercialTerms?.deliveryTime,
      label: "tiempo de entrega",
      relation: "greater_or_equal",
    },
    {
      field: "quotationValidity",
      quotationRaw: version.quotation_validity,
      providerRaw: providerCommercialTerms?.quotationValidity,
      label: "validez",
      relation: "less_or_equal",
    },
    {
      field: "warranty",
      quotationRaw: version.warranty_term,
      providerRaw: providerCommercialTerms?.warranty,
      label: "garantia",
      relation: "less_or_equal",
    },
    {
      field: "paymentTerms",
      quotationRaw: version.payment_terms,
      providerRaw: providerCommercialTerms?.paymentTerms,
      label: "condiciones de pago",
      relation: "less_or_equal",
    },
  ];

  for (const config of fieldConfig) {
    const providerComparable = normalizeQuotationApprovalTermValue(
      config.field,
      config.providerRaw,
    );

    if (providerComparable == null) {
      warnings.push(
        buildQuotationApprovalWarning(
          `approval_provider_data_missing_${config.field}`,
          `No se pudo validar ${config.label} contra documento del proveedor; se permite aprobar por falta de dato proveedor.`,
        ),
      );
      continue;
    }

    const quotationComparable = normalizeQuotationApprovalTermValue(
      config.field,
      config.quotationRaw,
    );
    if (quotationComparable == null) {
      blockingRules.push(
        buildQuotationApprovalBlockingRule(
          `approval_commercial_term_not_comparable_${config.field}`,
          `No se pudo normalizar ${config.label} de la cotizacion para comparar con proveedor.`,
        ),
      );
      continue;
    }

    const failsRule =
      config.relation === "greater_or_equal"
        ? quotationComparable < providerComparable
        : quotationComparable > providerComparable;

    if (failsRule) {
      blockingRules.push(
        buildQuotationApprovalBlockingRule(
          `approval_commercial_term_not_compliant_${config.field}`,
          `La cotizacion no cumple la regla de ${config.label} frente al proveedor.`,
          {
            quotationValue: config.quotationRaw || null,
            providerValue: config.providerRaw || null,
          },
        ),
      );
    }
  }
}

function buildQuotationApprovalLeafItems(items) {
  const parentIds = new Set(
    items
      .map((item) =>
        item?.bundleParentItemId ? Number(item.bundleParentItemId) : null,
      )
      .filter((id) => Number.isInteger(id) && id > 0),
  );

  return items.filter((item) => !parentIds.has(Number(item.id)));
}

function calculateQuotationApprovalGlobalDiscountPct({ version, totalSale }) {
  if (totalSale <= 0) {
    return 0;
  }
  if (String(version.summary_distribution_mode || "") === "per_item") {
    return 0;
  }

  if (String(version.summary_discount_mode || "") === "amount") {
    const discountAmount = Math.max(
      0,
      Math.min(Number(version.summary_discount_value || 0), totalSale),
    );
    return (discountAmount / totalSale) * 100;
  }

  if (String(version.summary_discount_mode || "") === "percentage") {
    return Math.max(
      0,
      Math.min(Number(version.summary_discount_value || 0), 100),
    );
  }

  return 0;
}

function evaluateQuotationApprovalMargins({ version, items, blockingRules }) {
  const lineMetrics = items
    .filter((item) => item.itemType !== "grupo_productos")
    .map((item) => {
      const pricing = calculateProposalSalePrice(item);
      return {
        item,
        saleTotal: Number(pricing.salePriceTotal || 0),
        costTotal: Number(pricing.costUnit || 0) * Number(item.quantity || 0),
      };
    })
    .filter((line) => line.saleTotal > 0);

  const totalSale = lineMetrics.reduce((sum, line) => sum + line.saleTotal, 0);
  const totalCost = lineMetrics.reduce((sum, line) => sum + line.costTotal, 0);
  const globalDiscountPct = calculateQuotationApprovalGlobalDiscountPct({
    version,
    totalSale,
  });
  const globalFactor = 1 - globalDiscountPct / 100;
  const adjustedTotalSale = totalSale * globalFactor;

  if (adjustedTotalSale <= 0) {
    blockingRules.push(
      buildQuotationApprovalBlockingRule(
        "approval_total_margin_not_computable",
        "No se pudo calcular margen total posterior al descuento global.",
      ),
    );
    return;
  }

  const totalMarginPct =
    ((adjustedTotalSale - totalCost) / adjustedTotalSale) * 100;
  if (totalMarginPct < QUOTATION_APPROVAL_TOTAL_MARGIN_MIN_PCT) {
    blockingRules.push(
      buildQuotationApprovalBlockingRule(
        "approval_total_margin_below_threshold",
        `El margen total posterior al descuento global debe ser al menos ${QUOTATION_APPROVAL_TOTAL_MARGIN_MIN_PCT}%.`,
        {
          expectedMinPct: QUOTATION_APPROVAL_TOTAL_MARGIN_MIN_PCT,
          actualPct: Number(totalMarginPct.toFixed(4)),
        },
      ),
    );
  }

  for (const line of lineMetrics) {
    const adjustedSale = line.saleTotal * globalFactor;
    if (adjustedSale <= 0) {
      continue;
    }
    const marginPct = ((adjustedSale - line.costTotal) / adjustedSale) * 100;

    if (
      line.item.itemType === "producto" &&
      marginPct < QUOTATION_APPROVAL_PRODUCT_MARGIN_MIN_PCT
    ) {
      blockingRules.push(
        buildQuotationApprovalBlockingRule(
          "approval_product_line_margin_below_threshold",
          `El margen por linea de producto debe ser al menos ${QUOTATION_APPROVAL_PRODUCT_MARGIN_MIN_PCT}%.`,
          {
            itemId: Number(line.item.id),
            productCode: String(line.item.productCode || "").trim(),
            actualPct: Number(marginPct.toFixed(4)),
          },
        ),
      );
    }

    if (
      line.item.itemType === "servicio_propio" &&
      marginPct < QUOTATION_APPROVAL_SERVICE_MARGIN_MIN_PCT
    ) {
      blockingRules.push(
        buildQuotationApprovalBlockingRule(
          "approval_service_line_margin_below_threshold",
          `El margen por linea de servicio debe ser al menos ${QUOTATION_APPROVAL_SERVICE_MARGIN_MIN_PCT}%.`,
          {
            itemId: Number(line.item.id),
            productCode: String(line.item.productCode || "").trim(),
            actualPct: Number(marginPct.toFixed(4)),
          },
        ),
      );
    }
  }
}

function evaluateQuotationApprovalMandatoryServices({
  items,
  approvalContext,
  blockingRules,
}) {
  const serviceLines = items.filter(
    (item) => item.itemType === "servicio_propio",
  );

  const hasMandatoryImplementation = serviceLines.some((item) => {
    const signal = normalizeQuotationApprovalComparableText(
      `${item.productCode || ""} ${item.productDescription || ""}`,
    );
    return QUOTATION_APPROVAL_MANDATORY_SERVICE_RULES.implementation.test(
      signal,
    );
  });
  const hasMandatorySupport = serviceLines.some((item) => {
    const signal = normalizeQuotationApprovalComparableText(
      `${item.productCode || ""} ${item.productDescription || ""}`,
    );
    return QUOTATION_APPROVAL_MANDATORY_SERVICE_RULES.support.test(signal);
  });

  const missingMandatoryServices = [];
  if (!hasMandatoryImplementation) {
    missingMandatoryServices.push("implementacion");
  }
  if (!hasMandatorySupport) {
    missingMandatoryServices.push("soporte");
  }

  const requiresConfirmation = missingMandatoryServices.length > 0;
  if (!requiresConfirmation) {
    return {
      missingMandatoryServices,
      mandatoryServicesExceptionApplied: false,
      mandatoryServicesExceptionReason: "",
    };
  }

  const acceptedException = Boolean(
    approvalContext?.confirmMissingRequiredServices,
  );
  if (!acceptedException) {
    blockingRules.push(
      buildQuotationApprovalBlockingRule(
        "approval_missing_required_services_confirmation",
        "Faltan servicios obligatorios de implementacion/soporte. Debes confirmar exclusion para continuar.",
        {
          missingMandatoryServices,
          requiresConfirmation: true,
        },
      ),
    );
    return {
      missingMandatoryServices,
      mandatoryServicesExceptionApplied: false,
      mandatoryServicesExceptionReason: "",
    };
  }

  const mandatoryServicesExceptionReason = String(
    approvalContext?.missingRequiredServicesReason || "",
  ).trim();
  if (mandatoryServicesExceptionReason.length < 5) {
    blockingRules.push(
      buildQuotationApprovalBlockingRule(
        "approval_missing_required_services_reason_required",
        "Debes registrar un motivo para excluir servicios obligatorios.",
        {
          missingMandatoryServices,
          requiresConfirmation: true,
        },
      ),
    );
  }

  return {
    missingMandatoryServices,
    mandatoryServicesExceptionApplied: true,
    mandatoryServicesExceptionReason,
  };
}

async function evaluateQuotationApprovalProviderCostAlignment({
  items,
  blockingRules,
  warnings,
  shouldBlockOnMismatch = true,
}) {
  const productLines = items.filter((item) => item.itemType === "producto");
  if (!productLines.length) {
    return;
  }

  const sourceIds = new Set();
  for (const item of productLines) {
    const sourceId = Number(
      item.sourceProviderPriceListItemId || item.sourceComponentPriceListItemId,
    );
    if (!Number.isInteger(sourceId) || sourceId <= 0) {
      blockingRules.push(
        buildQuotationApprovalBlockingRule(
          "approval_product_cost_source_missing",
          "Todas las lineas de producto deben tener referencia de costo proveedor para aprobar.",
          {
            itemId: Number(item.id),
            productCode: String(item.productCode || "").trim(),
          },
        ),
      );
      continue;
    }
    sourceIds.add(sourceId);
  }

  if (!sourceIds.size) {
    return;
  }

  const placeholders = Array.from(sourceIds)
    .map(() => "?")
    .join(", ");
  const providerCostRows = await query(
    `SELECT id, price
     FROM provider_price_list_items
     WHERE id IN (${placeholders})`,
    Array.from(sourceIds),
  );
  const providerCostByItemId = providerCostRows.reduce((map, row) => {
    map.set(Number(row.id), Number(row.price || 0));
    return map;
  }, new Map());

  for (const item of productLines) {
    const sourceId = Number(
      item.sourceProviderPriceListItemId || item.sourceComponentPriceListItemId,
    );
    if (!Number.isInteger(sourceId) || sourceId <= 0) {
      continue;
    }

    if (!providerCostByItemId.has(sourceId)) {
      warnings.push(
        buildQuotationApprovalWarning(
          "approval_provider_cost_reference_not_found",
          "No se encontro el costo de referencia del proveedor para una linea de producto.",
          {
            itemId: Number(item.id),
            sourcePriceListItemId: sourceId,
          },
        ),
      );
      continue;
    }

    const providerCost = Number(providerCostByItemId.get(sourceId) || 0);
    const quotationCost = Number(
      item.originalListPriceUnit == null
        ? item.listPriceUnit || 0
        : item.originalListPriceUnit,
    );
    const absDiff = Math.abs(quotationCost - providerCost);
    const tolerance = Math.max(
      QUOTATION_APPROVAL_COST_TOLERANCE_ABS,
      Math.abs(providerCost) * QUOTATION_APPROVAL_COST_TOLERANCE_REL,
    );

    if (absDiff > tolerance) {
      const mismatchDetails = {
        itemId: Number(item.id),
        productCode: String(item.productCode || "").trim(),
        providerCost: Number(providerCost.toFixed(6)),
        quotationCost: Number(quotationCost.toFixed(6)),
        absDiff: Number(absDiff.toFixed(6)),
        allowedDiff: Number(tolerance.toFixed(6)),
      };

      if (shouldBlockOnMismatch) {
        blockingRules.push(
          buildQuotationApprovalBlockingRule(
            "approval_product_cost_mismatch",
            "El costo del producto debe coincidir con el costo proveedor (tolerancia tecnica aplicada).",
            mismatchDetails,
          ),
        );
      } else {
        warnings.push(
          buildQuotationApprovalWarning(
            "approval_product_cost_mismatch_waived",
            "Se detecto descuadre de costo proveedor, pero se permite continuar por excepcion confirmada de respaldo de proveedor.",
            mismatchDetails,
          ),
        );
      }
    }
  }
}

function evaluateQuotationApprovalProviderBacking({
  items,
  approvalContext,
  latestProviderDocumentImport,
  blockingRules,
}) {
  const providerDocumentMissing = !latestProviderDocumentImport;
  const backedSourceIds = new Set(
    latestProviderDocumentImport?.supportedProviderPriceListItemIds || [],
  );

  const unbackedItems = [];
  if (!providerDocumentMissing) {
    for (const item of items) {
      if (item.itemType === "grupo_productos") {
        continue;
      }

      const itemId = Number(item.id || 0);
      if (!Number.isInteger(itemId) || itemId <= 0) {
        continue;
      }

      const itemProviderId = Number(item.providerId || 0);
      const importedProviderId = Number(
        latestProviderDocumentImport.providerId || 0,
      );
      let reasonCode = "";

      if (
        Number.isInteger(itemProviderId) &&
        itemProviderId > 0 &&
        Number.isInteger(importedProviderId) &&
        importedProviderId > 0 &&
        itemProviderId !== importedProviderId
      ) {
        reasonCode = "provider_mismatch";
      }

      const sourceId = Number(
        item.sourceProviderPriceListItemId ||
          item.sourceComponentPriceListItemId ||
          0,
      );
      if (!reasonCode) {
        if (!Number.isInteger(sourceId) || sourceId <= 0) {
          reasonCode = "missing_source_reference";
        } else if (!backedSourceIds.has(sourceId)) {
          reasonCode = "not_found_in_provider_document";
        }
      }

      if (!reasonCode) {
        continue;
      }

      unbackedItems.push({
        itemId,
        productCode: String(item.productCode || "").trim(),
        productDescription: String(item.productDescription || "").trim(),
        sourcePriceListItemId:
          Number.isInteger(sourceId) && sourceId > 0 ? sourceId : null,
        reasonCode,
      });
    }
  }

  const requiresConfirmation =
    providerDocumentMissing || unbackedItems.length > 0;
  if (!requiresConfirmation) {
    return {
      providerDocumentMissing,
      unbackedItems,
      providerBackingExceptionApplied: false,
      providerBackingExceptionReason: "",
      acknowledgedUnbackedItemIds: [],
    };
  }

  const acceptedException = Boolean(
    approvalContext?.confirmProviderBackingException,
  );
  if (!acceptedException) {
    blockingRules.push(
      buildQuotationApprovalBlockingRule(
        "approval_provider_backing_confirmation_required",
        providerDocumentMissing
          ? "No existe documento de proveedor de respaldo. Debes confirmar excepcion de responsabilidad para continuar."
          : "Hay items cotizados sin respaldo en el documento del proveedor. Debes confirmar excepcion de responsabilidad para continuar.",
        {
          requiresConfirmation: true,
          providerDocumentMissing,
          unbackedItems,
          acknowledgedUnbackedItemIds: unbackedItems.map((item) => item.itemId),
        },
      ),
    );
    return {
      providerDocumentMissing,
      unbackedItems,
      providerBackingExceptionApplied: false,
      providerBackingExceptionReason: "",
      acknowledgedUnbackedItemIds: [],
    };
  }

  const acknowledgedUnbackedItemIds = Array.from(
    new Set(
      (Array.isArray(approvalContext?.acknowledgedUnbackedItemIds)
        ? approvalContext.acknowledgedUnbackedItemIds
        : []
      )
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ).sort((left, right) => left - right);

  const expectedUnbackedItemIds = unbackedItems
    .map((item) => Number(item.itemId))
    .filter((id) => Number.isInteger(id) && id > 0)
    .sort((left, right) => left - right);

  if (expectedUnbackedItemIds.length) {
    const hasMismatch =
      acknowledgedUnbackedItemIds.length !== expectedUnbackedItemIds.length ||
      acknowledgedUnbackedItemIds.some(
        (id, index) => id !== expectedUnbackedItemIds[index],
      );
    if (hasMismatch) {
      blockingRules.push(
        buildQuotationApprovalBlockingRule(
          "approval_provider_backing_ack_mismatch",
          "La confirmacion de items sin respaldo esta desactualizada. Vuelve a confirmar la excepcion con la lista vigente.",
          {
            requiresConfirmation: true,
            providerDocumentMissing,
            unbackedItems,
            expectedAcknowledgedUnbackedItemIds: expectedUnbackedItemIds,
          },
        ),
      );
    }
  }

  const providerBackingExceptionReason = String(
    approvalContext?.providerBackingExceptionReason || "",
  ).trim();
  if (providerBackingExceptionReason.length < 15) {
    blockingRules.push(
      buildQuotationApprovalBlockingRule(
        "approval_provider_backing_reason_required",
        "Debes registrar un motivo de al menos 15 caracteres para aprobar sin respaldo completo de proveedor.",
        {
          requiresConfirmation: true,
          providerDocumentMissing,
          unbackedItems,
          minLength: 15,
        },
      ),
    );
  }

  return {
    providerDocumentMissing,
    unbackedItems,
    providerBackingExceptionApplied: true,
    providerBackingExceptionReason,
    acknowledgedUnbackedItemIds,
  };
}

async function getLatestQuotationProviderDocumentImport(quotationId) {
  const rows = await query(
    `SELECT id, quotation_id, quotation_version_id, document_id, provider_id,
            preview_snapshot_json, apply_snapshot_json, created_at
     FROM quotation_version_document_imports
     WHERE quotation_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [Number(quotationId)],
  );

  if (!rows.length) {
    return null;
  }

  const row = rows[0];
  const previewSnapshot = safeParseJsonObject(row.preview_snapshot_json) || {};
  const applySnapshot = safeParseJsonObject(row.apply_snapshot_json) || {};
  const commercialTerms =
    previewSnapshot && typeof previewSnapshot === "object"
      ? previewSnapshot.commercialTerms || null
      : null;
  const supportedProviderPriceListItemIds = Array.from(
    new Set(
      (Array.isArray(applySnapshot?.items) ? applySnapshot.items : [])
        .map((item) =>
          Number(
            item?.matchedPriceListItemId ||
              item?.selectedSuggestedPriceListItemId ||
              0,
          ),
        )
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  );

  return {
    id: Number(row.id),
    quotationId: Number(row.quotation_id),
    quotationVersionId: Number(row.quotation_version_id),
    documentId: Number(row.document_id),
    providerId: Number(row.provider_id),
    commercialTerms,
    supportedProviderPriceListItemIds,
  };
}

async function evaluateQuotationApprovalPolicies({ version, approvalContext }) {
  const blockingRules = [];
  const warnings = [];

  const sections = await getQuotationVersionSections(Number(version.id));
  const flatItems = sections.flatMap((section) => section.items || []);
  const leafItems = buildQuotationApprovalLeafItems(flatItems);

  evaluateQuotationApprovalMargins({
    version,
    items: leafItems,
    blockingRules,
  });

  const mandatoryServicesResult = evaluateQuotationApprovalMandatoryServices({
    items: leafItems,
    approvalContext,
    blockingRules,
  });

  const latestProviderDocumentImport =
    await getLatestQuotationProviderDocumentImport(
      Number(version.quotation_id),
    );

  const providerBackingResult = evaluateQuotationApprovalProviderBacking({
    items: leafItems,
    approvalContext,
    latestProviderDocumentImport,
    blockingRules,
  });

  const shouldBlockOnProviderCostMismatch = !Boolean(
    providerBackingResult?.providerBackingExceptionApplied,
  );

  await evaluateQuotationApprovalProviderCostAlignment({
    items: leafItems,
    blockingRules,
    warnings,
    shouldBlockOnMismatch: shouldBlockOnProviderCostMismatch,
  });

  if (latestProviderDocumentImport) {
    evaluateQuotationApprovalCommercialTerms({
      version,
      providerCommercialTerms: latestProviderDocumentImport.commercialTerms,
      warnings,
      blockingRules,
    });
  }

  return {
    isValid: blockingRules.length === 0,
    blockingRules,
    warnings,
    mandatoryServicesResult,
    providerBackingResult,
    providerDocumentImport: latestProviderDocumentImport,
  };
}

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
    const approvalContext = parsed.data.approvalContext || {};
    const approvalMode = String(approvalContext?.approvalMode || "").trim();
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

    if (actionCode === "aprobar") {
      if (!["with_ai", "without_ai"].includes(approvalMode)) {
        return res.status(400).json({
          message:
            "Debes indicar si la aprobacion se realizara con IA o sin IA.",
        });
      }

      if (
        approvalMode === "with_ai" &&
        !hasQuotationAiApprovalPermission(req.user)
      ) {
        return res.status(403).json({
          code: "quotation_approval_ai_forbidden",
          message: "No autorizado para aprobar con IA.",
        });
      }

      if (
        approvalMode === "without_ai" &&
        !hasQuotationHumanApprovalPermission(req.user)
      ) {
        return res.status(403).json({
          code: "quotation_approval_human_forbidden",
          message: "No autorizado para aprobar sin IA.",
        });
      }
    }

    if (
      actionCode === "solicitar_aprobacion" &&
      hasQuotationAnyApprovalPermission(req.user)
    ) {
      return res.status(403).json({
        code: "quotation_request_approval_forbidden_for_approver",
        message:
          "No autorizado para solicitar aprobacion cuando ya tienes capacidad de aprobar.",
      });
    }

    const targetStatusCode = quotationActionTransitionMap[actionCode];
    const targetStatus = await getCatalogRowByCode(
      "quotation_statuses",
      targetStatusCode,
    );
    if (!targetStatus) {
      return res.status(400).json({ message: "Transicion invalida" });
    }

    let approvalValidationResult = null;
    const shouldSkipApprovalValidation =
      actionCode === "aprobar" &&
      approvalContext?.approvalMode === "without_ai";

    if (actionCode === "aprobar" && !shouldSkipApprovalValidation) {
      approvalValidationResult = await evaluateQuotationApprovalPolicies({
        version,
        approvalContext,
      });

      const confirmationBlockingRule =
        approvalValidationResult.blockingRules.find(
          (rule) =>
            rule.code === "approval_missing_required_services_confirmation",
        ) || null;

      const providerBackingConfirmationRule =
        approvalValidationResult.blockingRules.find(
          (rule) =>
            rule.code === "approval_provider_backing_confirmation_required",
        ) || null;

      const providerBackingReasonRule =
        approvalValidationResult.blockingRules.find(
          (rule) => rule.code === "approval_provider_backing_reason_required",
        ) || null;

      const providerBackingAckMismatchRule =
        approvalValidationResult.blockingRules.find(
          (rule) => rule.code === "approval_provider_backing_ack_mismatch",
        ) || null;

      if (confirmationBlockingRule) {
        return res.status(409).json({
          code: "quotation_approval_missing_required_services_confirmation",
          message: confirmationBlockingRule.message,
          validation: {
            blockingRules: approvalValidationResult.blockingRules,
            warnings: approvalValidationResult.warnings,
          },
        });
      }

      if (providerBackingConfirmationRule) {
        return res.status(409).json({
          code: "quotation_approval_provider_backing_confirmation_required",
          message: providerBackingConfirmationRule.message,
          validation: {
            blockingRules: approvalValidationResult.blockingRules,
            warnings: approvalValidationResult.warnings,
          },
        });
      }

      if (providerBackingReasonRule) {
        return res.status(409).json({
          code: "quotation_approval_provider_backing_reason_required",
          message: providerBackingReasonRule.message,
          validation: {
            blockingRules: approvalValidationResult.blockingRules,
            warnings: approvalValidationResult.warnings,
          },
        });
      }

      if (providerBackingAckMismatchRule) {
        return res.status(409).json({
          code: "quotation_approval_provider_backing_ack_mismatch",
          message: providerBackingAckMismatchRule.message,
          validation: {
            blockingRules: approvalValidationResult.blockingRules,
            warnings: approvalValidationResult.warnings,
          },
        });
      }

      if (!approvalValidationResult.isValid) {
        return res.status(409).json({
          code: "quotation_approval_policy_failed",
          message: "La cotizacion no cumple reglas para aprobar.",
          validation: {
            blockingRules: approvalValidationResult.blockingRules,
            warnings: approvalValidationResult.warnings,
          },
        });
      }
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
      after: {
        status_id: Number(targetStatus.id),
        approval_validation:
          actionCode === "aprobar"
            ? {
                approval_mode: String(approvalContext?.approvalMode || ""),
                validation_skipped: shouldSkipApprovalValidation,
                warnings:
                  approvalValidationResult?.warnings?.map(
                    (warning) => warning.code,
                  ) || [],
                missing_mandatory_services:
                  approvalValidationResult?.mandatoryServicesResult
                    ?.missingMandatoryServices || [],
                mandatory_services_exception_applied: Boolean(
                  approvalValidationResult?.mandatoryServicesResult
                    ?.mandatoryServicesExceptionApplied,
                ),
                mandatory_services_exception_reason:
                  approvalValidationResult?.mandatoryServicesResult
                    ?.mandatoryServicesExceptionReason || "",
                provider_backing_exception_applied: Boolean(
                  approvalValidationResult?.providerBackingResult
                    ?.providerBackingExceptionApplied,
                ),
                provider_backing_exception_reason:
                  approvalValidationResult?.providerBackingResult
                    ?.providerBackingExceptionReason || "",
                provider_document_missing: Boolean(
                  approvalValidationResult?.providerBackingResult
                    ?.providerDocumentMissing,
                ),
                unbacked_items:
                  approvalValidationResult?.providerBackingResult
                    ?.unbackedItems || [],
                acknowledged_unbacked_item_ids:
                  approvalValidationResult?.providerBackingResult
                    ?.acknowledgedUnbackedItemIds || [],
                provider_document_import_id:
                  approvalValidationResult?.providerDocumentImport?.id || null,
              }
            : null,
      },
    });

    return res.json({
      message:
        actionCode === "aprobar" &&
        (approvalValidationResult?.warnings?.length || 0) > 0
          ? "Estado actualizado con advertencias de validacion"
          : "Estado actualizado",
      statusCode: targetStatus.code,
      statusName: targetStatus.name,
      validation:
        actionCode === "aprobar"
          ? {
              blockingRules: approvalValidationResult?.blockingRules || [],
              warnings: approvalValidationResult?.warnings || [],
            }
          : undefined,
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
    const approvalCapabilities = await getQuotationApprovalCapabilities({
      user: req.user,
      versionRow: version,
    });
    return res.json({
      versionId,
      latestVersionId: version.latest_version_id
        ? Number(version.latest_version_id)
        : null,
      actions,
      approvalCapabilities,
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
