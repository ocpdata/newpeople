import express from "express";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { requireAnyPermission } from "./auth.js";
import { query, withTransaction } from "./db.js";
import { logAuditEvent } from "./audit.js";
import { config } from "./config.js";
import {
  assertAiBudgetAvailable,
  recordAiUsageFromOpenAiResponse,
} from "./ai-usage/service.js";
import {
  parseMultipartFiles,
  cleanupTempFiles,
  extractContentFromBuffer,
} from "./opportunity-documents/service.js";
import { renderProposalDocumentPdfBuffer } from "./proposal-documents/pdf.js";
import { renderProposalDocumentHtmlPdfBuffer } from "./proposal-documents/html-pdf.js";
import { getProposalFormat, listProposalFormats, DEFAULT_PROPOSAL_FORMAT_CODE } from "../../../shared/proposal-formats.js";
import { getEmbeddedPdfNodes, hasGraphicNodes } from "./proposal-documents/embedded-pdf.js";
import { addInstitutionalLogo } from "./proposal-documents/page-branding.js";
import {
  hasGoogleMailSendScope,
  decryptOpaqueSecret,
  exchangeGoogleRefreshToken,
  sendGoogleMailMessage,
} from "./utils.js";
import {
  getCompanyProfile,
  getCommercialProposalTemplate,
  listCommercialProposalTemplates,
  getProposalContentConfiguration,
} from "./settings.js";

const proposalDocumentReadPermissions = [
  "propuestas.read",
  "propuestas.create",
  "propuestas.update",
];
const proposalDocumentCreatePermissions = ["propuestas.create"];
const proposalDocumentUpdatePermissions = ["propuestas.update"];

const PROPOSAL_DOCUMENT_AI_FEATURE_CODE = "proposal_documents_section_ai";
const PROPOSAL_DOCUMENT_AI_TIMEOUT_MS = 45_000;
const PROPOSAL_DOCUMENT_IMPORT_AI_FEATURE_CODE =
  "proposal_documents_import_segmentation";
const PROPOSAL_DOCUMENT_IMPORT_AI_TIMEOUT_MS = 60_000;
const PROPOSAL_DOCUMENT_IMPORT_ALLOWED_EXTENSIONS = new Set([".docx", ".pdf"]);
const PROPOSAL_DOCUMENT_IMPORT_MAX_CHARS = 60_000;

const router = express.Router();

const PROPOSAL_DOCUMENT_BLOCK_TYPES = ["heading", "paragraph", "list", "image"];

const proposalDocumentBlockSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    type: z.string().refine((type) => PROPOSAL_DOCUMENT_BLOCK_TYPES.includes(type), {
      message: "Tipo de bloque no soportado",
    }),
    ai_generated: z.boolean().optional().default(false),
  })
  .passthrough();

const proposalDocumentSectionSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    source_code: z.string().trim().max(80).nullable().default(null),
    title: z.string().trim().min(1).max(190),
    blocks: z.array(proposalDocumentBlockSchema).max(300).default([]),
  })
  .passthrough();

const proposalDocumentContentSchema = z.object({
  schema_version: z.number().int().min(1).default(1),
  document: z.any().optional(),
  metadata: z
    .object({
      account_id: z.number().int().positive().nullable().optional(),
      contact_id: z.number().int().positive().nullable().optional(),
      opportunity_id: z.number().int().positive().nullable().optional(),
      quotation_id: z.number().int().positive().nullable().optional(),
      quotation_version_id: z.number().int().positive().nullable().optional(),
      template_code: z.string().trim().max(80).nullable().optional(),
      generated_from: z
        .enum(["manual", "docx_import", "pdf_import"])
        .default("manual"),
      source_context: z.record(z.string(), z.any()).nullable().optional(),
      format_code: z.string().trim().max(40).nullable().optional(),
      format_snapshot: z.record(z.string(), z.any()).nullable().optional(),
    })
    .partial()
    .default({}),
  sections: z.array(proposalDocumentSectionSchema).max(60).default([]),
  removed_sections: z
    .array(proposalDocumentSectionSchema)
    .max(60)
    .default([]),
});

const createProposalDocumentSchema = z.object({
  title: z.string().trim().min(1).max(190),
  opportunity_id: z.number().int().positive(),
  template_code: z.string().trim().min(1).max(40).optional().default("generica"),
  format_code: z.string().trim().max(40).optional().default(DEFAULT_PROPOSAL_FORMAT_CODE),
});

const createSectionCatalogEntrySchema = z.object({
  title: z.string().trim().min(1).max(190),
});

const updateSectionCatalogEntrySchema = z.object({
  title: z.string().trim().min(1).max(190).optional(),
  is_active: z.boolean().optional(),
  direction: z.enum(["up", "down"]).optional(),
});

const updateProposalDocumentSchema = z.object({
  title: z.string().trim().min(1).max(190).optional(),
  content: proposalDocumentContentSchema.optional(),
});

const proposalDocumentSectionAiSchema = z
  .object({
    action: z.enum(["draft", "improve", "shorten", "translate"]),
    section_title: z.string().trim().max(190).optional().default(""),
    current_text: z.string().trim().max(20_000).optional().default(""),
    instructions: z.string().trim().max(2000).optional().default(""),
    target_language: z.string().trim().max(60).optional().default("inglés"),
  })
  .refine(
    (value) =>
      value.action === "draft" || value.current_text.trim().length > 0,
    {
      message: "current_text es requerido para esta acción",
      path: ["current_text"],
    },
  );

const proposalDocumentImportConfirmSectionSchema = z.object({
  source_code: z.string().trim().max(80).nullable().default(null),
  title: z.string().trim().min(1).max(190),
  text: z.string().trim().max(20_000).optional().default(""),
});

const proposalDocumentImportConfirmSchema = z.object({
  import_id: z.number().int().positive(),
  title: z.string().trim().min(1).max(190),
  opportunity_id: z.number().int().positive(),
  sections: z
    .array(proposalDocumentImportConfirmSectionSchema)
    .min(1)
    .max(60),
});

const proposalDocumentSendEmailSchema = z.object({
  to: z.string().trim().email(),
  cc: z.string().trim().max(1000).optional().default(""),
  subject: z.string().trim().min(1).max(200),
  message_body: z.string().trim().min(1).max(5000),
});

const PROPOSAL_DOCUMENT_SUPPORTED_INSTITUTIONAL_BLOCK_TYPES = new Set([
  "heading",
  "paragraph",
  "list",
  "image",
]);

function blocksToTiptapNodes(blocks) {
  return (blocks || []).flatMap((block) => {
    if (block.type === "image" && block.image?.fileUrl) {
      return [{ type: "image", attrs: { src: block.image.fileUrl, alt: block.image.altText || null, title: block.image.caption || null, width: block.image.width || null, height: block.image.height || null, align: "left", verticalAlign: "center" } }];
    }
    if (block.type === "heading") {
      return [{ type: "heading", attrs: { level: 3 }, content: block.text ? [{ type: "text", text: block.text }] : [] }];
    }
    if (block.type === "list") {
      const items = (block.items || []).filter(Boolean).map((item) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: item }] }] }));
      return items.length ? [{ type: "bulletList", content: items }] : [];
    }
    return [{ type: "paragraph", content: block.text ? [{ type: "text", text: block.text }] : [] }];
  });
}

function resolveProposalTemplateText(text, context) {
  return String(text || "").replace(
    /\{\{\s*(client_name|contact_name|company_name)\s*\}\}/g,
    (match, token) => context[token] || match,
  );
}

async function loadInitialBlocksByCatalogCode(context) {
  const blocksByCode = new Map();
  const institutionalConfig = await getProposalContentConfiguration();
  const templateContext = {
    client_name: context.account_name || "cliente",
    contact_name: context.contact_name || "contacto",
    company_name: context.company_name || "nuestra empresa",
  };
  const components = institutionalConfig?.components || [];
  for (const component of components) {
    const convertedBlocks = (component.blocks || [])
      .filter((block) =>
        PROPOSAL_DOCUMENT_SUPPORTED_INSTITUTIONAL_BLOCK_TYPES.has(block.type)
      )
      .map((block) => ({
        id: `block-${randomUUID()}`,
        type: block.type,
        ...(block.type === "image"
          ? { image: block.image || null }
          : block.type === "list"
          ? {
              items: (block.items || []).map((item) =>
                resolveProposalTemplateText(item, templateContext),
              ),
            }
          : {
              text: resolveProposalTemplateText(block.text, templateContext),
            }),
        ai_generated: false,
      }));
    if (convertedBlocks.length > 0) {
      blocksByCode.set(component.componentCode, convertedBlocks);
    }
  }
  return blocksByCode;
}

async function buildProposalDocumentContentFromCatalog(catalogRows, context) {
  const initialBlocksByCode = await loadInitialBlocksByCatalogCode(context);
  return {
    schema_version: 3,
    metadata: { generated_from: "manual" },
    document: { type: "doc", content: catalogRows.map((row) => ({
      type: "proposalSection",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: row.title }] },
        ...blocksToTiptapNodes(initialBlocksByCode.get(row.code) || []),
      ],
    })) },
    sections: [],
    removed_sections: [],
  };
}

function resolveDocumentTemplateVariables(value, context) {
  if (typeof value === "string") return resolveProposalTemplateText(value, context);
  if (Array.isArray(value)) return value.map((item) => resolveDocumentTemplateVariables(item, context));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveDocumentTemplateVariables(item, context)]));
  }
  return value;
}

function serializeSectionCatalogRow(row) {
  return {
    id: Number(row.id),
    code: row.code,
    title: row.title,
    display_order: Number(row.display_order),
    is_active: Boolean(Number(row.is_active)),
  };
}

function serializeProposalDocumentRow(row) {
  return {
    id: Number(row.id),
    title: row.title,
    status: row.status,
    account_id: row.account_id === null ? null : Number(row.account_id),
    contact_id: row.contact_id === null ? null : Number(row.contact_id),
    opportunity_id:
      row.opportunity_id === null ? null : Number(row.opportunity_id),
    quotation_id: row.quotation_id === null ? null : Number(row.quotation_id),
    current_version_id:
      row.current_version_id === null ? null : Number(row.current_version_id),
    updated_at: row.updated_at,
    created_at: row.created_at,
  };
}

function hasQuotationAdministrationAccess(user) {
  return Boolean(user?.permissionSet?.has("cotizaciones.administracion"));
}

function applyOwnedAccountScopeToQuery({ user, accountExpression, params }) {
  if (hasQuotationAdministrationAccess(user)) return "";
  params.push(Number(user.id));
  return `INNER JOIN account_owners ao_scope ON ao_scope.account_id = ${accountExpression} AND ao_scope.user_id = ?`;
}

async function searchAccessibleOpportunities({ user, search, page, pageSize }) {
  const listParams = [];
  const ownershipJoin = applyOwnedAccountScopeToQuery({
    user,
    accountExpression: "o.account_id",
    params: listParams,
  });

  const where = [
    "ocs.code NOT IN ('anulada', 'perdida')",
    "oas.code <> 'desactivada'",
  ];
  const safeSearch = String(search || "").trim();
  if (safeSearch) {
    where.push("(a.name LIKE ? OR o.name LIKE ?)");
    const likeValue = `%${safeSearch}%`;
    listParams.push(likeValue, likeValue);
  }

  const countParams = [...listParams];
  const [{ total } = { total: 0 }] = await query(
    `SELECT COUNT(*) AS total
     FROM opportunities o
     INNER JOIN accounts a ON a.id = o.account_id
     INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
     ${ownershipJoin}
     WHERE ${where.join(" AND ")}`,
    countParams,
  );

  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const offset = (safePage - 1) * safePageSize;
  listParams.push(safePageSize, offset);

  const rows = await query(
    `SELECT o.id AS opportunity_id, o.name AS opportunity_name, o.amount_usd AS total_amount,
            a.id AS account_id, a.name AS account_name,
            CONCAT(c.first_name, ' ', c.last_name) AS contact_name,
            latest_quotation.quotation_id, latest_quotation.quotation_version_id
     FROM opportunities o
     INNER JOIN accounts a ON a.id = o.account_id
     INNER JOIN contacts c ON c.id = o.contact_id
     INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
     ${ownershipJoin}
     LEFT JOIN (
       SELECT q.opportunity_id, q.id AS quotation_id, qv.id AS quotation_version_id
       FROM quotation_versions qv
       INNER JOIN quotations q ON q.id = qv.quotation_id
       INNER JOIN quotation_activation_statuses qas ON qas.id = qv.activation_status_id
       INNER JOIN (
         SELECT q2.opportunity_id, MAX(qv2.updated_at) AS max_updated_at
         FROM quotation_versions qv2
         INNER JOIN quotations q2 ON q2.id = qv2.quotation_id
         INNER JOIN quotation_activation_statuses qas2 ON qas2.id = qv2.activation_status_id
         WHERE qas2.code = 'activada'
         GROUP BY q2.opportunity_id
       ) latest ON latest.opportunity_id = q.opportunity_id AND latest.max_updated_at = qv.updated_at
       WHERE qas.code = 'activada'
     ) latest_quotation ON latest_quotation.opportunity_id = o.id
     WHERE ${where.join(" AND ")}
     ORDER BY o.updated_at DESC
     LIMIT ? OFFSET ?`,
    listParams,
  );

  return {
    items: rows.map((row) => ({
      opportunity_id: Number(row.opportunity_id),
      opportunity_name: row.opportunity_name,
      account_id: Number(row.account_id),
      account_name: row.account_name,
      contact_name: String(row.contact_name || "").trim(),
      quotation_id: row.quotation_id === null ? null : Number(row.quotation_id),
      quotation_version_id:
        row.quotation_version_id === null
          ? null
          : Number(row.quotation_version_id),
      total_amount: Number(row.total_amount || 0),
      currency_code: "USD",
    })),
    pagination: {
      page: safePage,
      page_size: safePageSize,
      total: Number(total || 0),
    },
  };
}

async function loadAccessibleOpportunityContext({ user, opportunityId }) {
  const params = [];
  const ownershipJoin = applyOwnedAccountScopeToQuery({
    user,
    accountExpression: "o.account_id",
    params,
  });
  params.push(Number(opportunityId));

  const rows = await query(
    `SELECT o.id AS opportunity_id, o.name AS opportunity_name, o.account_id, o.contact_id,
            a.name AS account_name,
            CONCAT(c.first_name, ' ', c.last_name) AS contact_name,
            c.email AS contact_email,
            latest_quotation.quotation_id, latest_quotation.quotation_version_id,
            qv.proposal_name, qv.delivery_time, qv.quotation_validity,
            qv.warranty_term, qv.payment_terms
     FROM opportunities o
     INNER JOIN accounts a ON a.id = o.account_id
     INNER JOIN contacts c ON c.id = o.contact_id
     ${ownershipJoin}
     LEFT JOIN (
       SELECT q.opportunity_id, q.id AS quotation_id, qv2.id AS quotation_version_id
       FROM quotation_versions qv2
       INNER JOIN quotations q ON q.id = qv2.quotation_id
       INNER JOIN quotation_activation_statuses qas ON qas.id = qv2.activation_status_id
       INNER JOIN (
         SELECT q2.opportunity_id, MAX(qv3.updated_at) AS max_updated_at
         FROM quotation_versions qv3
         INNER JOIN quotations q2 ON q2.id = qv3.quotation_id
         INNER JOIN quotation_activation_statuses qas2 ON qas2.id = qv3.activation_status_id
         WHERE qas2.code = 'activada'
         GROUP BY q2.opportunity_id
       ) latest ON latest.opportunity_id = q.opportunity_id AND latest.max_updated_at = qv2.updated_at
       WHERE qas.code = 'activada'
     ) latest_quotation ON latest_quotation.opportunity_id = o.id
     LEFT JOIN quotation_versions qv ON qv.id = latest_quotation.quotation_version_id
     WHERE o.id = ?
     LIMIT 1`,
    params,
  );

  return rows[0] || null;
}

async function loadQuotationVersionItemNames(versionId) {
  const rows = await query(
    `SELECT DISTINCT qsi.product_description
     FROM quotation_section_items qsi
     INNER JOIN quotation_sections qs ON qs.id = qsi.quotation_section_id
     WHERE qs.quotation_version_id = ?
     ORDER BY qsi.display_order
     LIMIT 40`,
    [Number(versionId)],
  );
  return rows
    .map((row) => String(row.product_description || "").trim())
    .filter(Boolean);
}

async function buildProposalSourceContext({ user, opportunityId }) {
  const opportunity = await loadAccessibleOpportunityContext({
    user,
    opportunityId,
  });
  if (!opportunity) return null;

  const itemNames = opportunity.quotation_version_id
    ? await loadQuotationVersionItemNames(opportunity.quotation_version_id)
    : [];
  const companyProfile = await getCompanyProfile();

  return {
    opportunity,
    context: {
      account_name: opportunity.account_name || "",
      client_name: opportunity.account_name || "",
      company_name:
        companyProfile?.commercialName ||
        companyProfile?.legalName ||
        "nuestra empresa",
      opportunity_name: opportunity.opportunity_name || "",
      contact_name: String(opportunity.contact_name || "").trim(),
      contact_email: opportunity.contact_email || "",
      quotation_proposal_name: opportunity.proposal_name || "",
      delivery_time: opportunity.delivery_time || "",
      quotation_validity: opportunity.quotation_validity || "",
      warranty_term: opportunity.warranty_term || "",
      payment_terms: opportunity.payment_terms || "",
      items: itemNames,
    },
  };
}

router.get(
  "/proposal-documents",
  requireAnyPermission(proposalDocumentReadPermissions),
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(
      200,
      Math.max(1, Number(req.query.page_size || 25)),
    );
    const offset = (page - 1) * pageSize;
    const status = String(req.query.status || "").trim();
    const search = String(req.query.search || "").trim();

    const where = ["1 = 1"];
    const params = [];
    if (status) {
      where.push("pd.status = ?");
      params.push(status);
    }
    if (search) {
      where.push("pd.title LIKE ?");
      params.push(`%${search}%`);
    }

    const items = await query(
      `SELECT pd.id, pd.title, pd.status, pd.account_id, pd.contact_id,
              pd.opportunity_id, pd.quotation_id, pd.current_version_id,
              pd.created_at, pd.updated_at
       FROM proposal_documents pd
       WHERE ${where.join(" AND ")}
       ORDER BY pd.updated_at DESC, pd.id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    const totalRows = await query(
      `SELECT COUNT(*) AS total
       FROM proposal_documents pd
       WHERE ${where.join(" AND ")}`,
      params,
    );

    return res.json({
      items: items.map(serializeProposalDocumentRow),
      pagination: {
        page,
        page_size: pageSize,
        total: Number(totalRows[0]?.total || 0),
      },
    });
  },
);

router.get(
  "/opportunities/search",
  requireAnyPermission(proposalDocumentCreatePermissions),
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const result = await searchAccessibleOpportunities({
      user: req.user,
      search: req.query.search,
      page: req.query.page,
      pageSize: req.query.page_size,
    });
    return res.json(result);
  },
);

router.get(
  "/proposal-template-catalog",
  requireAnyPermission(proposalDocumentCreatePermissions),
  async (_req, res) => {
    return res.json({ templates: await listCommercialProposalTemplates({ activeOnly: true }) });
  },
);

router.get(
  "/proposal-format-catalog",
  requireAnyPermission(proposalDocumentReadPermissions),
  async (_req, res) => res.json({ formats: listProposalFormats() }),
);

router.post(
  "/proposal-documents",
  requireAnyPermission(proposalDocumentCreatePermissions),
  async (req, res) => {
    const parsed = createProposalDocumentSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }
    const payload = parsed.data;

    const sourceResult = await buildProposalSourceContext({
      user: req.user,
      opportunityId: payload.opportunity_id,
    });
    if (!sourceResult) {
      return res.status(404).json({
        message: "Oportunidad no encontrada o no accesible",
      });
    }
    const { opportunity, context } = sourceResult;
    const format = getProposalFormat(payload.format_code);

    const template = await getCommercialProposalTemplate(payload.template_code);
    if (!template || !template.isActive) {
      return res.status(400).json({ message: "La plantilla seleccionada no existe o está inactiva" });
    }
    const content = resolveDocumentTemplateVariables(template.content, context);
    content.metadata = {
      generated_from: "manual",
      account_id: Number(opportunity.account_id),
      contact_id: Number(opportunity.contact_id),
      opportunity_id: Number(opportunity.opportunity_id),
      quotation_id: opportunity.quotation_id
        ? Number(opportunity.quotation_id)
        : null,
      quotation_version_id: opportunity.quotation_version_id
        ? Number(opportunity.quotation_version_id)
        : null,
      template_code: template.code,
      format_code: format.code,
      format_snapshot: format,
      source_context: context,
    };

    const result = await withTransaction(async (conn) => {
      const now = new Date();
      const [documentResult] = await conn.query(
        `INSERT INTO proposal_documents
           (title, status, account_id, contact_id, opportunity_id, quotation_id,
            created_by, created_at, updated_by, updated_at)
         VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payload.title,
          Number(opportunity.account_id),
          Number(opportunity.contact_id),
          Number(opportunity.opportunity_id),
          opportunity.quotation_id ? Number(opportunity.quotation_id) : null,
          Number(req.user.id),
          now,
          Number(req.user.id),
          now,
        ],
      );
      const documentId = Number(documentResult.insertId || 0);

      const [versionResult] = await conn.query(
        `INSERT INTO proposal_document_versions
           (proposal_document_id, version_number, content_json, is_active, created_by, created_at)
         VALUES (?, 1, ?, 1, ?, ?)`,
        [documentId, JSON.stringify(content), Number(req.user.id), now],
      );
      const versionId = Number(versionResult.insertId || 0);

      await conn.query(
        `UPDATE proposal_documents
         SET current_version_id = ?
         WHERE id = ?`,
        [versionId, documentId],
      );

      return { documentId, versionId };
    });

    await logAuditEvent({
      req,
      module: "proposal_documents",
      action: "created",
      entityType: "proposal_document",
      entityId: result.documentId,
      detail: `Propuesta creada: ${payload.title}`,
    });

    return res.status(201).json({
      proposal_document_id: result.documentId,
      version_id: result.versionId,
    });
  },
);

router.get(
  "/proposal-documents/:proposalDocumentId",
  requireAnyPermission(proposalDocumentReadPermissions),
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const proposalDocumentId = Number(req.params.proposalDocumentId);
    if (!Number.isInteger(proposalDocumentId) || proposalDocumentId <= 0) {
      return res.status(400).json({ message: "proposalDocumentId invalido" });
    }

    const documentRows = await query(
      `SELECT pd.*
       FROM proposal_documents pd
       WHERE pd.id = ?
       LIMIT 1`,
      [proposalDocumentId],
    );
    if (!documentRows.length) {
      return res.status(404).json({ message: "Propuesta no encontrada" });
    }

    const versionRows = await query(
      `SELECT id, version_number, content_json, publish_notes, is_active,
              created_by, created_at, published_by, published_at
       FROM proposal_document_versions
       WHERE proposal_document_id = ?
       ORDER BY version_number DESC`,
      [proposalDocumentId],
    );

    const activeVersion =
      versionRows.find((version) => Number(version.is_active) === 1) ||
      versionRows[0] ||
      null;

    return res.json({
      proposal_document: serializeProposalDocumentRow(documentRows[0]),
      active_version: activeVersion
        ? {
            id: Number(activeVersion.id),
            version_number: Number(activeVersion.version_number),
            content:
              typeof activeVersion.content_json === "string"
                ? JSON.parse(activeVersion.content_json)
                : activeVersion.content_json,
            publish_notes: activeVersion.publish_notes,
            published_at: activeVersion.published_at,
          }
        : null,
      versions: versionRows.map((version) => ({
        id: Number(version.id),
        version_number: Number(version.version_number),
        is_active: Boolean(Number(version.is_active)),
        created_at: version.created_at,
        published_at: version.published_at,
      })),
    });
  },
);

router.patch(
  "/proposal-documents/:proposalDocumentId",
  requireAnyPermission(proposalDocumentUpdatePermissions),
  async (req, res) => {
    const proposalDocumentId = Number(req.params.proposalDocumentId);
    if (!Number.isInteger(proposalDocumentId) || proposalDocumentId <= 0) {
      return res.status(400).json({ message: "proposalDocumentId invalido" });
    }

    const parsed = updateProposalDocumentSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }
    const payload = parsed.data;
    if (!payload.title && !payload.content) {
      return res.status(400).json({ message: "Nada que actualizar" });
    }

    const documentRows = await query(
      `SELECT id, current_version_id
       FROM proposal_documents
       WHERE id = ?
       LIMIT 1`,
      [proposalDocumentId],
    );
    if (!documentRows.length) {
      return res.status(404).json({ message: "Propuesta no encontrada" });
    }
    const currentVersionId = Number(documentRows[0].current_version_id || 0);
    if (payload.content && !currentVersionId) {
      return res
        .status(409)
        .json({ message: "La propuesta no tiene una version activa" });
    }

    await withTransaction(async (conn) => {
      if (payload.content) {
        await conn.query(
          `UPDATE proposal_document_versions
           SET content_json = ?
           WHERE id = ?`,
          [JSON.stringify(payload.content), currentVersionId],
        );
      }
      if (payload.title) {
        await conn.query(
          `UPDATE proposal_documents
           SET title = ?, updated_by = ?, updated_at = NOW(3)
           WHERE id = ?`,
          [payload.title, Number(req.user.id), proposalDocumentId],
        );
      } else {
        await conn.query(
          `UPDATE proposal_documents
           SET updated_by = ?, updated_at = NOW(3)
           WHERE id = ?`,
          [Number(req.user.id), proposalDocumentId],
        );
      }
    });

    return res.json({ proposal_document_id: proposalDocumentId, saved: true });
  },
);

router.post(
  "/proposal-documents/:proposalDocumentId/publish",
  requireAnyPermission(proposalDocumentUpdatePermissions),
  async (req, res) => {
    const proposalDocumentId = Number(req.params.proposalDocumentId);
    if (!Number.isInteger(proposalDocumentId) || proposalDocumentId <= 0) {
      return res.status(400).json({ message: "proposalDocumentId invalido" });
    }

    const documentRows = await query(
      `SELECT id, current_version_id, status
       FROM proposal_documents
       WHERE id = ?
       LIMIT 1`,
      [proposalDocumentId],
    );
    if (!documentRows.length) {
      return res.status(404).json({ message: "Propuesta no encontrada" });
    }
    const currentVersionId = Number(documentRows[0].current_version_id || 0);
    if (!currentVersionId) {
      return res
        .status(409)
        .json({ message: "La propuesta no tiene una version activa" });
    }

    await withTransaction(async (conn) => {
      await conn.query(
        `UPDATE proposal_document_versions
         SET published_by = ?, published_at = NOW(3)
         WHERE id = ?`,
        [Number(req.user.id), currentVersionId],
      );
      await conn.query(
        `UPDATE proposal_documents
         SET status = 'published', updated_by = ?, updated_at = NOW(3)
         WHERE id = ?`,
        [Number(req.user.id), proposalDocumentId],
      );
    });

    await logAuditEvent({
      req,
      module: "proposal_documents",
      action: "published",
      entityType: "proposal_document",
      entityId: proposalDocumentId,
      detail: `Propuesta publicada ${proposalDocumentId}`,
    });

    return res.json({ proposal_document_id: proposalDocumentId, status: "published" });
  },
);

router.delete(
  "/proposal-documents/:proposalDocumentId",
  requireAnyPermission(proposalDocumentUpdatePermissions),
  async (req, res) => {
    const proposalDocumentId = Number(req.params.proposalDocumentId);
    if (!Number.isInteger(proposalDocumentId) || proposalDocumentId <= 0) {
      return res.status(400).json({ message: "proposalDocumentId invalido" });
    }

    const rows = await query(
      `SELECT id, title, status
       FROM proposal_documents
       WHERE id = ?
       LIMIT 1`,
      [proposalDocumentId],
    );
    if (!rows.length) {
      return res.status(404).json({ message: "Propuesta no encontrada" });
    }
    if (String(rows[0].status) !== "draft") {
      return res.status(409).json({
        message: "Solo se puede eliminar una propuesta en estado borrador",
      });
    }

    await query(`DELETE FROM proposal_documents WHERE id = ?`, [
      proposalDocumentId,
    ]);

    await logAuditEvent({
      req,
      module: "proposal_documents",
      action: "deleted",
      entityType: "proposal_document",
      entityId: proposalDocumentId,
      detail: `Propuesta eliminada ${proposalDocumentId}`,
      before: { title: rows[0].title, status: rows[0].status },
    });

    return res.json({ proposal_document_id: proposalDocumentId, deleted: true });
  },
);

function slugifySectionCode(title) {
  return String(title || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "seccion";
}

async function generateUniqueSectionCode(title) {
  const base = slugifySectionCode(title);
  let candidate = base;
  let suffix = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await query(
      `SELECT id FROM proposal_document_section_catalog WHERE code = ? LIMIT 1`,
      [candidate],
    );
    if (!rows.length) return candidate;
    suffix += 1;
    candidate = `${base}_${suffix}`;
  }
}

router.get(
  "/proposal-document-sections/catalog",
  requireAnyPermission(proposalDocumentReadPermissions),
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const includeInactive = String(req.query.include_inactive || "") === "1";
    const rows = await query(
      `SELECT id, code, title, display_order, is_active
       FROM proposal_document_section_catalog
       ${includeInactive ? "" : "WHERE is_active = 1"}
       ORDER BY display_order ASC`,
    );
    return res.json({ items: rows.map(serializeSectionCatalogRow) });
  },
);

router.post(
  "/proposal-document-sections/catalog",
  requireAnyPermission(proposalDocumentUpdatePermissions),
  async (req, res) => {
    const parsed = createSectionCatalogEntrySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }
    const code = await generateUniqueSectionCode(parsed.data.title);
    const maxOrderRows = await query(
      `SELECT COALESCE(MAX(display_order), 0) AS max_order
       FROM proposal_document_section_catalog`,
    );
    const nextOrder = Number(maxOrderRows[0]?.max_order || 0) + 10;

    await query(
      `INSERT INTO proposal_document_section_catalog
         (code, title, display_order, is_active)
       VALUES (?, ?, ?, 1)`,
      [code, parsed.data.title, nextOrder],
    );

    await logAuditEvent({
      req,
      module: "proposal_documents",
      action: "section_catalog_created",
      entityType: "proposal_document_section_catalog",
      entityId: null,
      detail: `Sección de catálogo creada: ${parsed.data.title} (${code})`,
    });

    return res.status(201).json({ code });
  },
);

router.patch(
  "/proposal-document-sections/catalog/:code",
  requireAnyPermission(proposalDocumentUpdatePermissions),
  async (req, res) => {
    const code = String(req.params.code || "").trim();
    const parsed = updateSectionCatalogEntrySchema.safeParse(req.body || {});
    if (!code || !parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.success ? undefined : parsed.error.flatten(),
      });
    }
    const payload = parsed.data;

    const rows = await query(
      `SELECT id, code, title, display_order, is_active
       FROM proposal_document_section_catalog
       WHERE code = ?
       LIMIT 1`,
      [code],
    );
    if (!rows.length) {
      return res.status(404).json({ message: "Sección de catálogo no encontrada" });
    }

    if (payload.direction) {
      const neighborRows = await query(
        `SELECT id, display_order
         FROM proposal_document_section_catalog
         WHERE display_order ${payload.direction === "up" ? "<" : ">"} ?
         ORDER BY display_order ${payload.direction === "up" ? "DESC" : "ASC"}
         LIMIT 1`,
        [rows[0].display_order],
      );
      if (neighborRows.length) {
        await withTransaction(async (conn) => {
          await conn.query(
            `UPDATE proposal_document_section_catalog SET display_order = ? WHERE id = ?`,
            [neighborRows[0].display_order, rows[0].id],
          );
          await conn.query(
            `UPDATE proposal_document_section_catalog SET display_order = ? WHERE id = ?`,
            [rows[0].display_order, neighborRows[0].id],
          );
        });
      }
    }

    if (payload.title !== undefined || payload.is_active !== undefined) {
      const fields = [];
      const params = [];
      if (payload.title !== undefined) {
        fields.push("title = ?");
        params.push(payload.title);
      }
      if (payload.is_active !== undefined) {
        fields.push("is_active = ?");
        params.push(payload.is_active ? 1 : 0);
      }
      params.push(code);
      await query(
        `UPDATE proposal_document_section_catalog
         SET ${fields.join(", ")}, updated_at = NOW(3)
         WHERE code = ?`,
        params,
      );
    }

    return res.json({ code, updated: true });
  },
);

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

function formatProposalSourceContextForPrompt(sourceContext) {
  if (!sourceContext) return "";
  const lines = [];
  if (sourceContext.account_name) {
    lines.push(`Cliente/Cuenta: ${sourceContext.account_name}`);
  }
  if (sourceContext.opportunity_name) {
    lines.push(`Oportunidad: ${sourceContext.opportunity_name}`);
  }
  if (sourceContext.contact_name) {
    lines.push(`Contacto principal: ${sourceContext.contact_name}`);
  }
  if (sourceContext.quotation_proposal_name) {
    lines.push(`Nombre de la cotización: ${sourceContext.quotation_proposal_name}`);
  }
  if (sourceContext.delivery_time) {
    lines.push(`Tiempo de entrega: ${sourceContext.delivery_time}`);
  }
  if (sourceContext.warranty_term) {
    lines.push(`Garantía: ${sourceContext.warranty_term}`);
  }
  if (sourceContext.payment_terms) {
    lines.push(`Términos de pago: ${sourceContext.payment_terms}`);
  }
  if (Array.isArray(sourceContext.items) && sourceContext.items.length) {
    lines.push(
      `Productos/servicios incluidos: ${sourceContext.items.join(", ")}`,
    );
  }
  if (!lines.length) return "";
  return `Contexto comercial de la cotización de origen:\n${lines.join("\n")}`;
}

function buildProposalDocumentAiPrompt(payload, sourceContext) {
  const sectionTitle = payload.section_title || "Sección de la propuesta";
  const delimitedText = `<<<TEXTO>>>\n${payload.current_text}\n<<<FIN_TEXTO>>>`;

  if (payload.action === "draft") {
    const instructions = payload.instructions
      ? `Instrucciones adicionales del usuario: ${payload.instructions}`
      : "No hay instrucciones adicionales; usa buen criterio comercial.";
    const contextText = formatProposalSourceContextForPrompt(sourceContext);
    return {
      system:
        "Eres un redactor experto en propuestas técnicas comerciales en español. " +
        "Usa el contexto comercial proporcionado (cliente, oportunidad, cotización) para " +
        "que el párrafo sea específico y relevante, sin inventar datos que no se te dieron. " +
        "Nunca menciones precios, montos, descuentos ni cifras económicas: esta propuesta es " +
        "puramente técnica. " +
        "Redactas un único párrafo, profesional, claro y directo, sin encabezados, " +
        "sin viñetas, sin comillas ni comentarios adicionales. Responde solo con el párrafo.",
      user: [
        `Sección de la propuesta: "${sectionTitle}".`,
        contextText,
        instructions,
      ]
        .filter(Boolean)
        .join("\n\n"),
    };
  }

  if (payload.action === "improve") {
    return {
      system:
        "Mejoras la redacción de propuestas técnicas comerciales en español, " +
        "conservando el significado e ideas originales, con tono profesional y claro. " +
        "Responde unicamente con el texto mejorado, sin las marcas <<<TEXTO>>>/<<<FIN_TEXTO>>>, " +
        "sin repetir estas instrucciones ni agregar comentarios.",
      user: `El texto a mejorar de la sección "${sectionTitle}" es:\n${delimitedText}`,
    };
  }

  if (payload.action === "shorten") {
    return {
      system:
        "Resumes texto de propuestas técnicas comerciales en español de forma concisa, " +
        "conservando las ideas clave y el tono profesional. " +
        "Responde unicamente con el texto resumido, sin las marcas <<<TEXTO>>>/<<<FIN_TEXTO>>>, " +
        "sin repetir estas instrucciones ni agregar comentarios.",
      user: `El texto a resumir de la sección "${sectionTitle}" es:\n${delimitedText}`,
    };
  }

  return {
    system:
      `Traduces texto de propuestas técnicas comerciales al idioma "${payload.target_language}", ` +
      "conservando el tono profesional. Responde unicamente con el texto traducido, " +
      "sin las marcas <<<TEXTO>>>/<<<FIN_TEXTO>>>, sin repetir estas instrucciones ni agregar comentarios.",
    user: `El texto a traducir de la sección "${sectionTitle}" es:\n${delimitedText}`,
  };
}

router.post(
  "/proposal-documents/:proposalDocumentId/ai/section",
  requireAnyPermission(proposalDocumentUpdatePermissions),
  async (req, res) => {
    const proposalDocumentId = Number(req.params.proposalDocumentId);
    if (!Number.isInteger(proposalDocumentId) || proposalDocumentId <= 0) {
      return res.status(400).json({ message: "proposalDocumentId invalido" });
    }

    const parsed = proposalDocumentSectionAiSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    if (!config.openai.apiKey) {
      return res
        .status(503)
        .json({ message: "La generación con IA no está configurada" });
    }

    const documentRows = await query(
      `SELECT id FROM proposal_documents WHERE id = ? LIMIT 1`,
      [proposalDocumentId],
    );
    if (!documentRows.length) {
      return res.status(404).json({ message: "Propuesta no encontrada" });
    }

    const documentForContext = await loadProposalDocumentForOutput(
      proposalDocumentId,
    );
    const sourceContext = documentForContext?.content?.metadata?.source_context;

    const aiUsageUserId = Number(req.user?.id || 0);
    try {
      if (aiUsageUserId) {
        await assertAiBudgetAvailable({ userId: aiUsageUserId });
      }

      const prompt = buildProposalDocumentAiPrompt(parsed.data, sourceContext);
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        PROPOSAL_DOCUMENT_AI_TIMEOUT_MS,
      );
      const aiUsageStartedAt = new Date();

      let text;
      try {
        const response = await fetch(
          `${config.openai.baseUrl.replace(/\/$/, "")}/responses`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.openai.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: config.openai.model,
              input: [
                { role: "system", content: prompt.system },
                { role: "user", content: prompt.user },
              ],
            }),
            signal: controller.signal,
          },
        );

        const responseData = await response.json().catch(() => null);
        if (!response.ok || !responseData) {
          const errorText =
            responseData?.error?.message ||
            responseData?.error?.code ||
            `OpenAI request failed: ${response.status}`;
          throw new Error(String(errorText || "OpenAI request failed"));
        }

        if (aiUsageUserId) {
          await recordAiUsageFromOpenAiResponse({
            userId: aiUsageUserId,
            featureCode: PROPOSAL_DOCUMENT_AI_FEATURE_CODE,
            model: String(config.openai.model || "").trim(),
            openAiResponse: responseData,
            startedAt: aiUsageStartedAt,
          });
        }

        text = getOpenAiOutputText(responseData).trim();
        if (!text) {
          throw new Error("OpenAI request failed: empty response");
        }
      } finally {
        clearTimeout(timeoutId);
      }

      return res.json({ text });
    } catch (error) {
      return res.status(Number(error?.status) || 502).json({
        message: error?.message || "No fue posible generar contenido con IA",
      });
    }
  },
);

function extractJsonObjectFromText(value) {
  const text = String(value || "").trim();
  if (!text) return null;
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

const proposalDocumentImportSegmentationAiSchema = z.object({
  sections: z
    .array(
      z.object({
        source_code: z.string().trim().max(80).nullable(),
        title: z.string().trim().min(1).max(190),
        text: z.string().trim().max(20_000),
      }),
    )
    .min(1)
    .max(60),
});

async function requestProposalDocumentImportSegmentation({
  userId,
  rawText,
  catalogRows,
}) {
  if (userId) {
    await assertAiBudgetAvailable({ userId });
  }

  const catalogList = catalogRows
    .map((row) => `- ${row.code}: ${row.title}`)
    .join("\n");
  const truncatedText = rawText.slice(0, PROPOSAL_DOCUMENT_IMPORT_MAX_CHARS);

  const requestPayload = {
    model: config.openai.model,
    input: [
      {
        role: "system",
        content:
          "Clasificas el texto de un documento de propuesta técnica comercial " +
          "en secciones estándar. Debes cubrir TODO el texto recibido, sin inventar " +
          "contenido nuevo ni resumir en exceso; puedes reordenar por tema pero no " +
          "omitir información relevante. Para cada fragmento asigna el code de la " +
          "sección estándar que mejor corresponda; si un fragmento no corresponde a " +
          "ninguna, usa source_code null con title \"Otros\". " +
          "Responde unicamente con un JSON con la forma " +
          '{"sections":[{"source_code":"codigo_o_null","title":"Titulo","text":"..."}]}, ' +
          "sin texto adicional antes ni despues del JSON.",
      },
      {
        role: "user",
        content: `Secciones estándar disponibles:\n${catalogList}\n\nTexto del documento:\n${truncatedText}`,
      },
    ],
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    PROPOSAL_DOCUMENT_IMPORT_AI_TIMEOUT_MS,
  );
  const aiUsageStartedAt = new Date();

  try {
    const response = await fetch(
      `${config.openai.baseUrl.replace(/\/$/, "")}/responses`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.openai.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      },
    );

    const responseData = await response.json().catch(() => null);
    if (!response.ok || !responseData) {
      const errorText =
        responseData?.error?.message ||
        responseData?.error?.code ||
        `OpenAI request failed: ${response.status}`;
      throw new Error(String(errorText || "OpenAI request failed"));
    }

    if (userId) {
      await recordAiUsageFromOpenAiResponse({
        userId,
        featureCode: PROPOSAL_DOCUMENT_IMPORT_AI_FEATURE_CODE,
        model: String(config.openai.model || "").trim(),
        openAiResponse: responseData,
        startedAt: aiUsageStartedAt,
      });
    }

    const parsed = extractJsonObjectFromText(getOpenAiOutputText(responseData));
    const validated =
      proposalDocumentImportSegmentationAiSchema.safeParse(parsed);
    if (!validated.success) {
      throw new Error("No fue posible interpretar la segmentación de IA");
    }
    return validated.data.sections;
  } finally {
    clearTimeout(timeoutId);
  }
}

router.post(
  "/proposal-documents/import",
  requireAnyPermission(proposalDocumentCreatePermissions),
  async (req, res) => {
    let parsedFiles = [];
    try {
      if (!config.openai.apiKey) {
        return res
          .status(503)
          .json({ message: "La generación con IA no está configurada" });
      }

      const { files } = await parseMultipartFiles(req);
      parsedFiles = files;
      const rawFiles = Array.isArray(files) ? files : [];
      if (rawFiles.length !== 1) {
        return res
          .status(400)
          .json({ message: "Debes subir exactamente un archivo Word o PDF" });
      }

      const file = rawFiles[0];
      const fileName = String(file.originalFilename || "documento");
      const extension = path.extname(fileName).toLowerCase();
      if (!PROPOSAL_DOCUMENT_IMPORT_ALLOWED_EXTENSIONS.has(extension)) {
        return res.status(400).json({
          message: "Solo se admiten archivos .docx o .pdf",
        });
      }

      const buffer = await readFile(file.filepath);
      const extracted = await extractContentFromBuffer({
        buffer,
        mimeType: file.mimetype,
        fileName,
        extension,
      });
      const rawText = String(extracted?.rawText || "").trim();
      if (!rawText) {
        return res.status(422).json({
          message: "No se encontró texto legible en el archivo",
        });
      }

      const catalogRows = await query(
        `SELECT code, title
         FROM proposal_document_section_catalog
         WHERE is_active = 1
         ORDER BY display_order ASC`,
      );

      const sections = await requestProposalDocumentImportSegmentation({
        userId: Number(req.user?.id || 0),
        rawText,
        catalogRows,
      });

      const importResult = await query(
        `INSERT INTO proposal_document_imports
           (proposal_document_id, source_file_name, source_kind, extracted_chars,
            section_count, status, diagnostics_json, created_by, created_at)
         VALUES (NULL, ?, ?, ?, ?, 'previewed', ?, ?, NOW(3))`,
        [
          fileName,
          extension === ".docx" ? "docx" : "pdf",
          rawText.length,
          sections.length,
          JSON.stringify({ section_count: sections.length }),
          Number(req.user.id),
        ],
      );

      return res.json({
        import_id: Number(importResult.insertId || 0),
        source_file_name: fileName,
        source_kind: extension === ".docx" ? "docx" : "pdf",
        extracted_chars: rawText.length,
        sections,
      });
    } catch (error) {
      return res.status(Number(error?.status) || 500).json({
        message: error?.message || "No fue posible procesar el archivo",
      });
    } finally {
      if (parsedFiles.length) {
        await cleanupTempFiles(parsedFiles).catch(() => undefined);
      }
    }
  },
);

router.post(
  "/proposal-documents/import/confirm",
  requireAnyPermission(proposalDocumentCreatePermissions),
  async (req, res) => {
    const parsed = proposalDocumentImportConfirmSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }
    const payload = parsed.data;

    const importRows = await query(
      `SELECT id, source_file_name, source_kind
       FROM proposal_document_imports
       WHERE id = ?
       LIMIT 1`,
      [payload.import_id],
    );
    if (!importRows.length) {
      return res.status(404).json({ message: "Importación no encontrada" });
    }

    const sourceResult = await buildProposalSourceContext({
      user: req.user,
      opportunityId: payload.opportunity_id,
    });
    if (!sourceResult) {
      return res.status(404).json({
        message: "Oportunidad no encontrada o no accesible",
      });
    }
    const { opportunity, context } = sourceResult;

    const content = {
      schema_version: 3,
      metadata: {
        generated_from:
          importRows[0].source_kind === "docx" ? "docx_import" : "pdf_import",
        account_id: Number(opportunity.account_id),
        contact_id: Number(opportunity.contact_id),
        opportunity_id: Number(opportunity.opportunity_id),
        quotation_id: opportunity.quotation_id
          ? Number(opportunity.quotation_id)
          : null,
        quotation_version_id: opportunity.quotation_version_id
          ? Number(opportunity.quotation_version_id)
          : null,
        source_context: context,
      },
      document: {
        type: "doc",
        content: payload.sections.flatMap((section) => [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: section.title }] },
          { type: "paragraph", content: section.text.trim() ? [{ type: "text", text: section.text.trim() }] : [] },
        ]),
      },
      sections: [],
      removed_sections: [],
    };

    const result = await withTransaction(async (conn) => {
      const now = new Date();
      const [documentResult] = await conn.query(
        `INSERT INTO proposal_documents
           (title, status, account_id, contact_id, opportunity_id, quotation_id,
            created_by, created_at, updated_by, updated_at)
         VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payload.title,
          Number(opportunity.account_id),
          Number(opportunity.contact_id),
          Number(opportunity.opportunity_id),
          opportunity.quotation_id ? Number(opportunity.quotation_id) : null,
          Number(req.user.id),
          now,
          Number(req.user.id),
          now,
        ],
      );
      const documentId = Number(documentResult.insertId || 0);


      const [versionResult] = await conn.query(
        `INSERT INTO proposal_document_versions
           (proposal_document_id, version_number, content_json, is_active, created_by, created_at)
         VALUES (?, 1, ?, 1, ?, ?)`,
        [documentId, JSON.stringify(content), Number(req.user.id), now],
      );
      const versionId = Number(versionResult.insertId || 0);

      await conn.query(
        `UPDATE proposal_documents
         SET current_version_id = ?
         WHERE id = ?`,
        [versionId, documentId],
      );

      await conn.query(
        `UPDATE proposal_document_imports
         SET proposal_document_id = ?, status = 'confirmed'
         WHERE id = ?`,
        [documentId, payload.import_id],
      );

      return { documentId, versionId };
    });

    await logAuditEvent({
      req,
      module: "proposal_documents",
      action: "created_from_import",
      entityType: "proposal_document",
      entityId: result.documentId,
      detail: `Propuesta creada desde ${importRows[0].source_kind}: ${importRows[0].source_file_name}`,
    });

    return res.status(201).json({
      proposal_document_id: result.documentId,
      version_id: result.versionId,
    });
  },
);

async function loadProposalDocumentForOutput(proposalDocumentId) {
  const documentRows = await query(
    `SELECT id, title
     FROM proposal_documents
     WHERE id = ?
     LIMIT 1`,
    [proposalDocumentId],
  );
  if (!documentRows.length) return null;

  const versionRows = await query(
    `SELECT content_json
     FROM proposal_document_versions
     WHERE proposal_document_id = ?
       AND is_active = 1
     LIMIT 1`,
    [proposalDocumentId],
  );
  const contentRaw = versionRows[0]?.content_json;
  const content =
    typeof contentRaw === "string" ? JSON.parse(contentRaw) : contentRaw;

  return { title: documentRows[0].title, content: content || {} };
}

router.get(
  "/proposal-documents/:proposalDocumentId/pdf",
  requireAnyPermission(proposalDocumentReadPermissions),
  async (req, res) => {
    const proposalDocumentId = Number(req.params.proposalDocumentId);
    if (!Number.isInteger(proposalDocumentId) || proposalDocumentId <= 0) {
      return res.status(400).json({ message: "proposalDocumentId invalido" });
    }

    const document = await loadProposalDocumentForOutput(proposalDocumentId);
    if (!document) {
      return res.status(404).json({ message: "Propuesta no encontrada" });
    }

    let buffer;
    try {
      const hasEmbeddedPdf = getEmbeddedPdfNodes(document.content).length > 0;
      const hasGraphics = hasGraphicNodes(document.content);
      buffer = hasEmbeddedPdf || hasGraphics
        ? await renderProposalDocumentPdfBuffer(document)
        : await renderProposalDocumentHtmlPdfBuffer(document);
    } catch (error) {
      buffer = await renderProposalDocumentPdfBuffer(document);
    }
    const companyProfile = await getCompanyProfile();
    buffer = await addInstitutionalLogo(buffer, companyProfile?.logoUrl);
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="propuesta-${proposalDocumentId}.pdf"`,
    );
    return res.send(buffer);
  },
);

async function getUserGoogleMailConnection(userId) {
  const rows = await query(
    `SELECT google_email, refresh_token_encrypted, scope_text, revoked_at
     FROM user_google_mail_connections
     WHERE user_id = ?
     LIMIT 1`,
    [userId],
  );
  const row = rows[0] || null;
  if (!row || row.revoked_at) return null;
  return row;
}

router.post(
  "/proposal-documents/:proposalDocumentId/send-email",
  requireAnyPermission(proposalDocumentUpdatePermissions),
  async (req, res) => {
    const proposalDocumentId = Number(req.params.proposalDocumentId);
    if (!Number.isInteger(proposalDocumentId) || proposalDocumentId <= 0) {
      return res.status(400).json({ message: "proposalDocumentId invalido" });
    }

    const parsed = proposalDocumentSendEmailSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }
    const payload = parsed.data;

    const document = await loadProposalDocumentForOutput(proposalDocumentId);
    if (!document) {
      return res.status(404).json({ message: "Propuesta no encontrada" });
    }

    const connection = await getUserGoogleMailConnection(Number(req.user.id));
    if (!connection) {
      return res.status(409).json({
        message: "Debes conectar tu cuenta de Google antes de enviar propuestas",
        reason: "google_reconnect_required",
      });
    }
    if (!hasGoogleMailSendScope(connection.scope_text || "")) {
      return res.status(409).json({
        message: "Tu conexión de Google no incluye permisos para enviar correo",
        reason: "google_scope_missing",
      });
    }

    try {
      const buffer = await renderProposalDocumentPdfBuffer(document);
      const companyProfile = await getCompanyProfile();
      const brandedBuffer = await addInstitutionalLogo(buffer, companyProfile?.logoUrl);
      const refreshToken = decryptOpaqueSecret(
        connection.refresh_token_encrypted,
      );
      const tokenPayload = await exchangeGoogleRefreshToken(refreshToken);

      await sendGoogleMailMessage({
        accessToken: tokenPayload.access_token,
        from: connection.google_email,
        to: payload.to,
        cc: payload.cc,
        subject: payload.subject,
        messageBody: payload.message_body,
        attachments: [
          {
            filename: `propuesta-${proposalDocumentId}.pdf`,
            contentType: "application/pdf",
            content: brandedBuffer,
          },
        ],
      });

      await logAuditEvent({
        req,
        module: "proposal_documents",
        action: "emailed",
        entityType: "proposal_document",
        entityId: proposalDocumentId,
        detail: `Propuesta enviada por correo a ${payload.to}`,
      });

      return res.json({ sent: true });
    } catch (error) {
      const reason = String(error?.code || "").toLowerCase();
      if (reason.includes("invalid_grant") || reason.includes("unauthorized")) {
        return res.status(409).json({
          message:
            "La conexión con Google expiró o fue revocada. Reconecta para continuar.",
          reason: "google_reconnect_required",
        });
      }
      return res.status(502).json({
        message: error?.message || "No fue posible enviar el correo",
      });
    }
  },
);

export default router;
export { PROPOSAL_DOCUMENT_BLOCK_TYPES };
