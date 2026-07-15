import express from "express";
import { z } from "zod";
import { requirePermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import { query } from "./db.js";
import {
  AI_PARAMETER_CAPABILITY_KEYS,
  CAMPAIGN_MATRIX_EMAIL_TYPE_VALUES,
  CAMPAIGN_MATRIX_PRIORITY_VALUES,
  CAMPAIGN_MATRIX_SUBTYPE_VALUES,
  CAMPAIGN_MATRIX_TYPE_VALUES,
  buildCompanyDocumentBranding,
  createInstitutionalAsset,
  addInstitutionalAssetVersion,
  archiveInstitutionalAsset,
  createProposalContentComponent,
  deleteProposalContentComponent,
  getCampaignMatrixCatalogs,
  getAiParametersConfiguration,
  getCompanyDocumentBranding,
  getCompanyProfile,
  getChatbotSettings,
  getInstitutionalAsset,
  getPublishedAiParameterEntryByCapabilityKey,
  getProposalContentConfiguration,
  listInstitutionalAssets,
  listAiParameterEntryRevisions,
  PROPOSAL_CONTENT_COMPONENT_DEFINITIONS,
  publishAiParameterConfiguration,
  publishProposalContentConfiguration,
  reorderProposalContentComponents,
  restoreAiParameterEntryRevision,
  saveAiParameterEntryDraft,
  saveProposalContentComponent,
  setProposalContentComponentStatus,
  getTemporaryFeatureSettings,
  saveChatbotSettings,
  saveTemporaryFeatureSettings,
  getCommercialSettings,
  isValidIanaTimezone,
  saveCommercialSettings,
} from "./settings.js";

const router = express.Router();

const optionalTrimmedString = (maxLength) =>
  z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }, z.string().max(maxLength).optional());

const optionalEmail = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}, z.string().email().max(190).optional());

const optionalUrl = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}, z.string().url().max(300).optional());

const logoUrlValueSchema = z
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
  }, "Logo invalido");

const companyProfileSchema = z.object({
  legalName: z.string().trim().min(3).max(190),
  sellerLeagueScreenDisplayMinutes: z.number().int().min(1).max(60).optional(),
  commercialName: optionalTrimmedString(190),
  taxId: z.string().trim().min(3).max(120),
  logoUrl: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }, logoUrlValueSchema.optional()),
  addressLine1: z.string().trim().min(3).max(255),
  addressLine2: optionalTrimmedString(255),
  city: z.string().trim().min(2).max(120),
  stateRegion: z.string().trim().min(2).max(120),
  countryId: z.number().int().positive(),
  postalCode: z.string().trim().min(2).max(20),
  email: optionalEmail,
  phone: optionalTrimmedString(40),
  website: optionalUrl,
  description: optionalTrimmedString(2000),
});

const temporaryFeatureSettingsSchema = z.object({
  accountsPendingEnabled: z.boolean(),
  contactsPendingEnabled: z.boolean(),
  opportunitiesPendingEnabled: z.boolean(),
});

const chatbotSettingsSchema = z.object({
  requestTimeoutMs: z.number().int().min(5000).max(300000),
});

const aiParameterCapabilityKeySchema = z.enum([
  AI_PARAMETER_CAPABILITY_KEYS.proposalExecutiveSummary,
  AI_PARAMETER_CAPABILITY_KEYS.proposalBackground,
  AI_PARAMETER_CAPABILITY_KEYS.proposalGenericSection,
]);

const proposalComponentKindSchema = z.enum(["system", "custom"]);

const aiParameterBaseEntrySchema = z.object({
  title: z.string().trim().min(3).max(190),
  description: optionalTrimmedString(5000),
  isEnabled: z.boolean(),
  modelOverride: z.preprocess(
    (value) => (value == null ? undefined : value),
    optionalTrimmedString(80),
  ),
  timeoutMs: z.number().int().min(5000).max(300000),
  systemPrompt: z.string().trim().min(20).max(20000),
  userPromptTemplate: z.string().trim().min(3).max(20000),
  outputSchema: z.record(z.string(), z.unknown()),
  parameters: z.record(z.string(), z.unknown()),
  changeSummary: optionalTrimmedString(500),
});

const aiParameterExecutiveSummarySchema =
  aiParameterBaseEntrySchema.superRefine((value, context) => {
    const parameters = value.parameters || {};
    const maxLibraryAssets = Number(parameters.maxLibraryAssets);
    if (
      !Number.isInteger(maxLibraryAssets) ||
      maxLibraryAssets < 1 ||
      maxLibraryAssets > 8
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "parameters.maxLibraryAssets debe estar entre 1 y 8",
        path: ["parameters", "maxLibraryAssets"],
      });
    }

    const defaultLanguageCode = String(
      parameters.defaultLanguageCode || "",
    ).trim();
    if (!defaultLanguageCode || defaultLanguageCode.length > 8) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "parameters.defaultLanguageCode es obligatorio",
        path: ["parameters", "defaultLanguageCode"],
      });
    }

    const libraryModes = Array.isArray(parameters.supportedLibraryContentModes)
      ? parameters.supportedLibraryContentModes
      : [];
    if (
      libraryModes.length === 0 ||
      libraryModes.some(
        (item) => !["source_text", "summary_extract"].includes(String(item)),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "parameters.supportedLibraryContentModes debe incluir solo source_text y/o summary_extract",
        path: ["parameters", "supportedLibraryContentModes"],
      });
    }

    const priorityModes = Array.isArray(parameters.supportedSourcePriorityModes)
      ? parameters.supportedSourcePriorityModes
      : [];
    if (
      priorityModes.length === 0 ||
      priorityModes.some(
        (item) =>
          !["non_library_first", "balanced", "library_first"].includes(
            String(item),
          ),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "parameters.supportedSourcePriorityModes debe incluir solo non_library_first, balanced y/o library_first",
        path: ["parameters", "supportedSourcePriorityModes"],
      });
    }

    if (typeof parameters.allowInstructionsField !== "boolean") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "parameters.allowInstructionsField debe ser boolean",
        path: ["parameters", "allowInstructionsField"],
      });
    }

    if (typeof parameters.allowOverwrite !== "boolean") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "parameters.allowOverwrite debe ser boolean",
        path: ["parameters", "allowOverwrite"],
      });
    }
  });

function getAiParameterEntrySchema(capabilityKey) {
  if (capabilityKey === AI_PARAMETER_CAPABILITY_KEYS.proposalExecutiveSummary) {
    return aiParameterExecutiveSummarySchema;
  }
  return aiParameterBaseEntrySchema;
}

function validateAiParameterWarnings(capabilityKey, payload) {
  const warnings = [];
  if (capabilityKey === AI_PARAMETER_CAPABILITY_KEYS.proposalExecutiveSummary) {
    const systemPrompt = String(payload.systemPrompt || "");
    if (!systemPrompt.includes("JSON")) {
      warnings.push({
        field: "systemPrompt",
        code: "missing_json_instruction",
        message:
          "Conviene indicar explicitamente que la respuesta debe ser JSON valido.",
      });
    }
    if (!systemPrompt.includes("documentSources")) {
      warnings.push({
        field: "systemPrompt",
        code: "missing_document_sources_reference",
        message: "El prompt no menciona documentSources como fuente primaria.",
      });
    }
    if (!systemPrompt.includes("generationPolicy")) {
      warnings.push({
        field: "systemPrompt",
        code: "missing_generation_policy_reference",
        message:
          "El prompt no menciona generationPolicy; podria ignorar prioridades de fuente.",
      });
    }
  }
  return warnings;
}

function parseAiParameterEntry(capabilityKey, body) {
  return getAiParameterEntrySchema(capabilityKey).parse(body);
}

const institutionalAssetPayloadSchema = z.object({
  name: z.string().trim().min(2).max(190),
  description: optionalTrimmedString(5000),
  category: z.string().trim().min(2).max(80),
  status: z.enum(["draft", "active", "archived"]).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).optional().default([]),
  fileUrl: logoUrlValueSchema,
  fileName: optionalTrimmedString(255),
  mimeType: optionalTrimmedString(120),
  fileSizeBytes: z.number().int().nonnegative().optional().nullable(),
  width: z.number().int().positive().optional().nullable(),
  height: z.number().int().positive().optional().nullable(),
  checksum: optionalTrimmedString(120),
  altText: optionalTrimmedString(500),
  caption: optionalTrimmedString(5000),
});

const proposalContentBlockSchema = z
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
      return;
    }

    if (value.type === "list" && !Array.isArray(value.items)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Los bloques de lista requieren items",
        path: ["items"],
      });
    }
  });

const proposalLayoutModeSchema = z.enum([
  "stack",
  "horizontal-gallery",
  "manual-rows",
]);

const proposalLayoutRowSchema = z
  .object({
    blockIndexes: z.array(z.number().int().min(0)).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (!Array.isArray(value.blockIndexes) || value.blockIndexes.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "layoutConfig.rows[n].blockIndexes debe contener al menos un indice",
        path: ["blockIndexes"],
        params: {
          issueCode: "layout_config_row_empty",
        },
      });
      return;
    }

    if (new Set(value.blockIndexes).size !== value.blockIndexes.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "layoutConfig.rows[n].blockIndexes contiene indices duplicados",
        path: ["blockIndexes"],
        params: {
          issueCode: "layout_config_duplicate_indexes_in_row",
        },
      });
    }
  });

const proposalLayoutConfigSchema = z
  .object({
    mode: proposalLayoutModeSchema,
    rows: z.array(proposalLayoutRowSchema).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === "manual-rows") {
      if (!Array.isArray(value.rows) || value.rows.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "layoutConfig.rows es obligatorio cuando mode = manual-rows",
          path: ["rows"],
          params: {
            issueCode: "layout_config_rows_required",
          },
        });
        return;
      }

      const seenBlockIndexes = new Set();
      for (let rowIndex = 0; rowIndex < value.rows.length; rowIndex += 1) {
        const row = value.rows[rowIndex];
        for (const blockIndex of row.blockIndexes || []) {
          if (seenBlockIndexes.has(blockIndex)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message:
                "layoutConfig.rows contiene indices repetidos entre filas",
              path: ["rows", rowIndex, "blockIndexes"],
              params: {
                issueCode: "layout_config_duplicate_indexes_across_rows",
              },
            });
            break;
          }
          seenBlockIndexes.add(blockIndex);
        }
      }
      return;
    }

    if (
      value.rows !== undefined &&
      value.rows !== null &&
      value.rows.length > 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "layoutConfig.rows solo se permite cuando mode = manual-rows",
        path: ["rows"],
        params: {
          issueCode: "layout_config_rows_not_allowed",
        },
      });
    }
  });

const proposalContentComponentPayloadSchema = z
  .object({
    title: z.string().trim().min(2).max(190).optional(),
    componentKind: proposalComponentKindSchema.optional(),
    isVisible: z.boolean().optional(),
    aiEnabled: z.boolean().optional(),
    aiMode: z.enum(["auto", "manual"]).nullish(),
    aiSettings: z.record(z.string(), z.unknown()).nullish(),
    layoutConfig: proposalLayoutConfigSchema.nullish(),
    blocks: z.array(proposalContentBlockSchema).default([]),
  })
  .superRefine((value, context) => {
    if (value.aiEnabled && !value.aiMode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "aiMode es obligatorio cuando aiEnabled = true",
        path: ["aiMode"],
      });
    }

    if (!value.layoutConfig || value.layoutConfig.mode !== "manual-rows") {
      return;
    }

    const rows = Array.isArray(value.layoutConfig.rows)
      ? value.layoutConfig.rows
      : [];
    const blocks = Array.isArray(value.blocks) ? value.blocks : [];

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      for (
        let blockPositionInRow = 0;
        blockPositionInRow < row.blockIndexes.length;
        blockPositionInRow += 1
      ) {
        const blockIndex = row.blockIndexes[blockPositionInRow];
        const block = blocks[blockIndex];

        if (!block) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "layoutConfig.rows[n].blockIndexes[m] referencia un bloque inexistente",
            path: [
              "layoutConfig",
              "rows",
              rowIndex,
              "blockIndexes",
              blockPositionInRow,
            ],
            params: {
              issueCode: "layout_config_block_index_out_of_range",
              blockIndex,
            },
          });
          continue;
        }

        if (block.type !== "image") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "layoutConfig.rows[n].blockIndexes[m] referencia un bloque no compatible; solo se permiten imagenes",
            path: [
              "layoutConfig",
              "rows",
              rowIndex,
              "blockIndexes",
              blockPositionInRow,
            ],
            params: {
              issueCode: "layout_config_block_not_compatible",
              blockIndex,
            },
          });
          continue;
        }

        if (!block.assetId || !block.assetVersionId) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "layoutConfig.rows[n].blockIndexes[m] referencia una imagen incompleta",
            path: [
              "layoutConfig",
              "rows",
              rowIndex,
              "blockIndexes",
              blockPositionInRow,
            ],
            params: {
              issueCode: "layout_config_block_image_incomplete",
              blockIndex,
            },
          });
        }
      }
    }
  });

const proposalContentComponentCreateSchema =
  proposalContentComponentPayloadSchema.safeExtend({
    title: z.string().trim().min(2).max(190),
    componentCode: z
      .string()
      .trim()
      .min(3)
      .max(80)
      .regex(/^[a-z0-9_]+$/)
      .optional(),
    componentKind: proposalComponentKindSchema.optional().default("custom"),
  });

const proposalContentReorderSchema = z.object({
  orderedComponentCodes: z.array(z.string().trim().min(1).max(80)).min(1),
});

function inferValidationIssueCode(issue) {
  const path = Array.isArray(issue.path) ? issue.path : [];
  if (issue.params?.issueCode) {
    return issue.params.issueCode;
  }
  if (path[0] === "layoutConfig" && path[1] === "mode") {
    return "layout_config_invalid_mode";
  }
  if (
    path[0] === "layoutConfig" &&
    path.includes("blockIndexes") &&
    (issue.code === z.ZodIssueCode.invalid_type ||
      issue.code === z.ZodIssueCode.too_small ||
      issue.code === z.ZodIssueCode.invalid_value)
  ) {
    return "layout_config_invalid_block_index";
  }
  return issue.code;
}

function buildValidationIssueLocation(path, payload, issue) {
  const field = [...path]
    .reverse()
    .find((segment) => typeof segment === "string");

  const location = {
    scope:
      path[0] === "blocks"
        ? "blocks"
        : path[0] === "title"
          ? "title"
          : "layoutConfig",
    field,
  };

  if (path[0] === "blocks" && Number.isInteger(path[1])) {
    location.blockIndex = Number(path[1]);
  }

  if (
    path[0] === "layoutConfig" &&
    path[1] === "rows" &&
    Number.isInteger(path[2])
  ) {
    location.rowIndex = Number(path[2]);
  }

  if (
    path[0] === "layoutConfig" &&
    path[1] === "rows" &&
    Number.isInteger(path[2]) &&
    path[3] === "blockIndexes" &&
    Number.isInteger(path[4])
  ) {
    location.blockPositionInRow = Number(path[4]);
    const blockIndex =
      payload?.layoutConfig?.rows?.[Number(path[2])]?.blockIndexes?.[
        Number(path[4])
      ];
    if (Number.isInteger(blockIndex)) {
      location.blockIndex = blockIndex;
    } else if (Number.isInteger(issue?.params?.blockIndex)) {
      location.blockIndex = Number(issue.params.blockIndex);
    }
  }

  return location;
}

function buildValidationIssues(error, payload) {
  return (error?.issues || []).map((issue) => ({
    code: inferValidationIssueCode(issue),
    message: issue.message,
    path: Array.isArray(issue.path) ? issue.path : [],
    location: buildValidationIssueLocation(issue.path, payload, issue),
  }));
}

function parseChangedFields(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

router.get(
  "/ai-parameters",
  requirePermission("configuracion.read"),
  async (_req, res) => {
    const config = await getAiParametersConfiguration();
    res.json({ config });
  },
);

router.put(
  "/ai-parameters/entries/:capabilityKey",
  requirePermission("configuracion.update"),
  async (req, res) => {
    const capabilityKey = aiParameterCapabilityKeySchema.parse(
      req.params.capabilityKey,
    );
    const payload = parseAiParameterEntry(capabilityKey, req.body || {});
    const config = await saveAiParameterEntryDraft(
      capabilityKey,
      payload,
      req.user?.id || null,
      payload.changeSummary || "Actualizacion manual",
    );
    await logAuditEvent({
      action: "updated_ai_parameters",
      entityType: "ai_parameters",
      entityId: capabilityKey,
      performedByUserId: req.user?.id || null,
      metadata: {
        capabilityKey,
        changeSummary: payload.changeSummary || "Actualizacion manual",
      },
    });
    res.json({
      message: "Borrador de parametros IA actualizado",
      config,
      entry:
        config.entries.find((item) => item.capabilityKey === capabilityKey) ||
        null,
    });
  },
);

router.post(
  "/ai-parameters/entries/:capabilityKey/validate",
  requirePermission("configuracion.read"),
  async (req, res) => {
    const capabilityKey = aiParameterCapabilityKeySchema.parse(
      req.params.capabilityKey,
    );
    const payload = parseAiParameterEntry(capabilityKey, req.body || {});
    const warnings = validateAiParameterWarnings(capabilityKey, payload);
    res.json({ valid: true, warnings, normalized: payload });
  },
);

router.post(
  "/ai-parameters/publish",
  requirePermission("configuracion.update"),
  async (req, res) => {
    const config = await publishAiParameterConfiguration(req.user?.id || null);
    await logAuditEvent({
      action: "published_ai_parameters",
      entityType: "ai_parameters",
      entityId: "default",
      performedByUserId: req.user?.id || null,
      metadata: {
        status: config.status,
        publishedAt: config.publishedAt,
      },
    });
    res.json({ message: "Parametros IA publicados", config });
  },
);

router.get(
  "/ai-parameters/entries/:capabilityKey/revisions",
  requirePermission("configuracion.read"),
  async (req, res) => {
    const capabilityKey = aiParameterCapabilityKeySchema.parse(
      req.params.capabilityKey,
    );
    const revisions = await listAiParameterEntryRevisions(capabilityKey);
    res.json({ revisions });
  },
);

router.post(
  "/ai-parameters/entries/:capabilityKey/restore/:revisionNumber",
  requirePermission("configuracion.update"),
  async (req, res) => {
    const capabilityKey = aiParameterCapabilityKeySchema.parse(
      req.params.capabilityKey,
    );
    const revisionNumber = z.coerce
      .number()
      .int()
      .positive()
      .parse(req.params.revisionNumber);
    const config = await restoreAiParameterEntryRevision(
      capabilityKey,
      revisionNumber,
      req.user?.id || null,
    );
    await logAuditEvent({
      action: "restored_ai_parameters_revision",
      entityType: "ai_parameters",
      entityId: capabilityKey,
      performedByUserId: req.user?.id || null,
      metadata: {
        capabilityKey,
        revisionNumber,
      },
    });
    res.json({
      message: `Revision ${revisionNumber} restaurada como nuevo borrador`,
      config,
      entry:
        config.entries.find((item) => item.capabilityKey === capabilityKey) ||
        null,
    });
  },
);

router.get(
  "/company-profile",
  requirePermission("configuracion.read"),
  async (_req, res) => {
    const profile = await getCompanyProfile();
    res.json({ profile });
  },
);

router.get(
  "/temporary-features",
  requirePermission("configuracion.read"),
  async (_req, res) => {
    const settings = await getTemporaryFeatureSettings();
    res.json({ settings });
  },
);

router.get(
  "/institutional-assets",
  requirePermission("configuracion.read"),
  async (req, res) => {
    const assets = await listInstitutionalAssets({
      status:
        typeof req.query.status === "string" ? req.query.status : undefined,
      category:
        typeof req.query.category === "string" ? req.query.category : undefined,
      search:
        typeof req.query.search === "string" ? req.query.search : undefined,
    });
    res.json({ items: assets });
  },
);

router.post(
  "/institutional-assets",
  requirePermission("configuracion.update"),
  async (req, res) => {
    const parsed = institutionalAssetPayloadSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const asset = await createInstitutionalAsset(
      parsed.data,
      Number(req.user?.id) || null,
    );

    await logAuditEvent({
      req,
      module: "configuracion",
      action: "created_institutional_asset",
      entityType: "institutional_asset",
      entityId: asset?.id || null,
      detail: `Asset institucional ${parsed.data.name} creado`,
      after: asset,
    });

    return res.status(201).json({
      message: "Asset institucional creado",
      asset,
    });
  },
);

router.get(
  "/institutional-assets/:assetId",
  requirePermission("configuracion.read"),
  async (req, res) => {
    const assetId = Number(req.params.assetId);
    if (!Number.isInteger(assetId) || assetId <= 0) {
      return res.status(400).json({ message: "Id de asset invalido" });
    }

    const asset = await getInstitutionalAsset(assetId);
    if (!asset) {
      return res.status(404).json({ message: "Asset no encontrado" });
    }

    return res.json({ asset });
  },
);

router.post(
  "/institutional-assets/:assetId/versions",
  requirePermission("configuracion.update"),
  async (req, res) => {
    const assetId = Number(req.params.assetId);
    if (!Number.isInteger(assetId) || assetId <= 0) {
      return res.status(400).json({ message: "Id de asset invalido" });
    }

    const parsed = institutionalAssetPayloadSchema
      .omit({
        name: true,
        description: true,
        category: true,
        status: true,
        tags: true,
      })
      .safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const before = await getInstitutionalAsset(assetId);
    const asset = await addInstitutionalAssetVersion(
      assetId,
      parsed.data,
      Number(req.user?.id) || null,
    );
    if (!asset) {
      return res.status(404).json({ message: "Asset no encontrado" });
    }

    await logAuditEvent({
      req,
      module: "configuracion",
      action: "versioned_institutional_asset",
      entityType: "institutional_asset",
      entityId: asset.id,
      detail: `Nueva version para asset ${asset.name}`,
      before,
      after: asset,
    });

    return res.json({
      message: "Version registrada",
      asset,
    });
  },
);

router.post(
  "/institutional-assets/:assetId/archive",
  requirePermission("configuracion.update"),
  async (req, res) => {
    const assetId = Number(req.params.assetId);
    if (!Number.isInteger(assetId) || assetId <= 0) {
      return res.status(400).json({ message: "Id de asset invalido" });
    }

    const before = await getInstitutionalAsset(assetId);
    if (!before) {
      return res.status(404).json({ message: "Asset no encontrado" });
    }

    const asset = await archiveInstitutionalAsset(
      assetId,
      Number(req.user?.id) || null,
    );

    await logAuditEvent({
      req,
      module: "configuracion",
      action: "archived_institutional_asset",
      entityType: "institutional_asset",
      entityId: asset?.id || assetId,
      detail: `Asset ${before.name} archivado`,
      before,
      after: asset,
    });

    return res.json({
      message: "Asset archivado",
      asset,
    });
  },
);

router.get(
  "/proposal-content-config",
  requirePermission("configuracion.read"),
  async (_req, res) => {
    const config = await getProposalContentConfiguration();
    res.json({
      config,
      componentDefinitions: PROPOSAL_CONTENT_COMPONENT_DEFINITIONS,
    });
  },
);

router.put(
  "/proposal-content-config/components/:componentCode",
  requirePermission("configuracion.update"),
  async (req, res) => {
    const componentCode = String(req.params.componentCode || "").trim();

    const parsed = proposalContentComponentPayloadSchema.safeParse(
      req.body || {},
    );
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
        issues: buildValidationIssues(parsed.error, req.body || {}),
      });
    }

    const before = await getProposalContentConfiguration();
    const config = await saveProposalContentComponent({
      componentCode,
      title: parsed.data.title,
      componentKind: parsed.data.componentKind,
      isVisible: parsed.data.isVisible,
      aiEnabled: parsed.data.aiEnabled,
      aiMode: parsed.data.aiMode,
      aiSettings: parsed.data.aiSettings,
      layoutConfig: parsed.data.layoutConfig,
      blocks: parsed.data.blocks,
      actorUserId: Number(req.user?.id) || null,
    });

    await logAuditEvent({
      req,
      module: "configuracion",
      action: "updated_proposal_content_component",
      entityType: "proposal_content_component",
      entityId:
        config?.components.find(
          (component) => component.componentCode === componentCode,
        )?.id || null,
      detail: `Contenido default actualizado para ${componentCode}`,
      before:
        before?.components.find(
          (component) => component.componentCode === componentCode,
        ) || null,
      after:
        config?.components.find(
          (component) => component.componentCode === componentCode,
        ) || null,
    });

    return res.json({
      message: "Componente actualizado",
      config,
    });
  },
);

router.post(
  "/proposal-content-config/components",
  requirePermission("configuracion.update"),
  async (req, res) => {
    const parsed = proposalContentComponentCreateSchema.safeParse(
      req.body || {},
    );
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
        issues: buildValidationIssues(parsed.error, req.body || {}),
      });
    }

    const before = await getProposalContentConfiguration();
    try {
      const config = await createProposalContentComponent({
        title: parsed.data.title,
        componentCode: parsed.data.componentCode,
        componentKind: parsed.data.componentKind,
        isVisible: parsed.data.isVisible ?? true,
        aiEnabled: parsed.data.aiEnabled ?? false,
        aiMode: parsed.data.aiMode ?? null,
        aiSettings: parsed.data.aiSettings ?? null,
        layoutConfig: parsed.data.layoutConfig ?? null,
        blocks: parsed.data.blocks,
        actorUserId: Number(req.user?.id) || null,
      });

      const createdComponent = config?.components.at(-1) || null;
      await logAuditEvent({
        req,
        module: "configuracion",
        action: "created_proposal_content_component",
        entityType: "proposal_content_component",
        entityId: createdComponent?.id || null,
        detail: `Componente ${createdComponent?.componentCode || parsed.data.title} creado`,
        before,
        after: createdComponent,
      });

      return res.status(201).json({
        message: "Componente creado",
        config,
        component: createdComponent,
      });
    } catch (error) {
      return res.status(400).json({
        message: String(error?.message || "No fue posible crear el componente"),
      });
    }
  },
);

router.post(
  "/proposal-content-config/components/reorder",
  requirePermission("configuracion.update"),
  async (req, res) => {
    const parsed = proposalContentReorderSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const before = await getProposalContentConfiguration();
    try {
      const config = await reorderProposalContentComponents({
        orderedComponentCodes: parsed.data.orderedComponentCodes,
        actorUserId: Number(req.user?.id) || null,
      });
      await logAuditEvent({
        req,
        module: "configuracion",
        action: "reordered_proposal_content_components",
        entityType: "proposal_content_config",
        entityId: config?.id || null,
        detail: "Orden de componentes de propuesta actualizado",
        before,
        after: config,
      });
      return res.json({
        message: "Orden actualizado",
        config,
      });
    } catch (error) {
      return res.status(400).json({
        message: String(
          error?.message || "No fue posible reordenar los componentes",
        ),
      });
    }
  },
);

router.post(
  "/proposal-content-config/components/:componentCode/archive",
  requirePermission("configuracion.update"),
  async (req, res) => {
    const componentCode = String(req.params.componentCode || "").trim();
    const before = await getProposalContentConfiguration();
    try {
      const config = await setProposalContentComponentStatus({
        componentCode,
        status: "archived",
        actorUserId: Number(req.user?.id) || null,
      });
      await logAuditEvent({
        req,
        module: "configuracion",
        action: "archived_proposal_content_component",
        entityType: "proposal_content_component",
        entityId:
          config?.components.find(
            (component) => component.componentCode === componentCode,
          )?.id || null,
        detail: `Componente ${componentCode} archivado`,
        before,
        after:
          config?.components.find(
            (component) => component.componentCode === componentCode,
          ) || null,
      });
      return res.json({ message: "Componente archivado", config });
    } catch (error) {
      return res.status(400).json({
        message: String(
          error?.message || "No fue posible archivar el componente",
        ),
      });
    }
  },
);

router.post(
  "/proposal-content-config/components/:componentCode/restore",
  requirePermission("configuracion.update"),
  async (req, res) => {
    const componentCode = String(req.params.componentCode || "").trim();
    const before = await getProposalContentConfiguration();
    try {
      const config = await setProposalContentComponentStatus({
        componentCode,
        status: "active",
        actorUserId: Number(req.user?.id) || null,
      });
      await logAuditEvent({
        req,
        module: "configuracion",
        action: "restored_proposal_content_component",
        entityType: "proposal_content_component",
        entityId:
          config?.components.find(
            (component) => component.componentCode === componentCode,
          )?.id || null,
        detail: `Componente ${componentCode} restaurado`,
        before,
        after:
          config?.components.find(
            (component) => component.componentCode === componentCode,
          ) || null,
      });
      return res.json({ message: "Componente restaurado", config });
    } catch (error) {
      return res.status(400).json({
        message: String(
          error?.message || "No fue posible restaurar el componente",
        ),
      });
    }
  },
);

router.delete(
  "/proposal-content-config/components/:componentCode",
  requirePermission("configuracion.update"),
  async (req, res) => {
    const componentCode = String(req.params.componentCode || "").trim();
    const before = await getProposalContentConfiguration();
    try {
      const removedComponent =
        before?.components.find(
          (component) => component.componentCode === componentCode,
        ) || null;
      const config = await deleteProposalContentComponent({
        componentCode,
        actorUserId: Number(req.user?.id) || null,
      });
      await logAuditEvent({
        req,
        module: "configuracion",
        action: "deleted_proposal_content_component",
        entityType: "proposal_content_component",
        entityId: removedComponent?.id || null,
        detail: `Componente ${componentCode} eliminado`,
        before: removedComponent,
        after: null,
      });
      return res.json({ message: "Componente eliminado", config });
    } catch (error) {
      return res.status(400).json({
        message: String(
          error?.message || "No fue posible eliminar el componente",
        ),
      });
    }
  },
);

router.post(
  "/proposal-content-config/publish",
  requirePermission("configuracion.update"),
  async (req, res) => {
    const before = await getProposalContentConfiguration();
    const config = await publishProposalContentConfiguration(
      Number(req.user?.id) || null,
    );

    await logAuditEvent({
      req,
      module: "configuracion",
      action: "published_proposal_content_config",
      entityType: "proposal_content_config",
      entityId: config?.id || null,
      detail: "Configuracion de propuestas publicada",
      before,
      after: config,
    });

    return res.json({
      message: "Configuracion publicada",
      config,
    });
  },
);

router.get("/document-branding", async (_req, res) => {
  const company = await getCompanyDocumentBranding();
  res.json({ company });
});

router.put(
  "/company-profile",
  requirePermission("configuracion.update"),
  async (req, res) => {
    const parsed = companyProfileSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const profileBefore = await getCompanyProfile();
    const existingId = profileBefore.id ? Number(profileBefore.id) : null;
    const actorUserId = Number(req.user?.id) || null;
    const now = new Date();
    const payload = {
      legalName: parsed.data.legalName.trim(),
      commercialName: parsed.data.commercialName || null,
      taxId: parsed.data.taxId.trim(),
      logoUrl: parsed.data.logoUrl || null,
      addressLine1: parsed.data.addressLine1.trim(),
      addressLine2: parsed.data.addressLine2 || null,
      city: parsed.data.city.trim(),
      stateRegion: parsed.data.stateRegion.trim(),
      countryId: Number(parsed.data.countryId),
      postalCode: parsed.data.postalCode.trim(),
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      website: parsed.data.website || null,
      description: parsed.data.description || null,
    };

    if (existingId) {
      await query(
        `UPDATE company_profile
       SET legal_name = ?, commercial_name = ?, tax_id = ?, logo_url = ?,
           address_line1 = ?, address_line2 = ?, city = ?, state_region = ?,
           country_id = ?, postal_code = ?, email = ?, phone = ?, website = ?,
           description = ?, updated_by_user_id = ?, updated_at = ?
       WHERE id = ?`,
        [
          payload.legalName,
          payload.commercialName,
          payload.taxId,
          payload.logoUrl,
          payload.addressLine1,
          payload.addressLine2,
          payload.city,
          payload.stateRegion,
          payload.countryId,
          payload.postalCode,
          payload.email,
          payload.phone,
          payload.website,
          payload.description,
          actorUserId,
          now,
          existingId,
        ],
      );
    } else {
      await query(
        `INSERT INTO company_profile
        (singleton_key, legal_name, commercial_name, tax_id, logo_url,
         address_line1, address_line2, city, state_region, country_id,
         postal_code, email, phone, website, description,
         created_by_user_id, updated_by_user_id, created_at, updated_at)
       VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payload.legalName,
          payload.commercialName,
          payload.taxId,
          payload.logoUrl,
          payload.addressLine1,
          payload.addressLine2,
          payload.city,
          payload.stateRegion,
          payload.countryId,
          payload.postalCode,
          payload.email,
          payload.phone,
          payload.website,
          payload.description,
          actorUserId,
          actorUserId,
          now,
          now,
        ],
      );
    }

    const profile = await getCompanyProfile();

    await logAuditEvent({
      req,
      module: "configuracion",
      action: existingId
        ? "updated_company_profile"
        : "created_company_profile",
      entityType: "company_profile",
      entityId: profile.id,
      detail: "Perfil institucional actualizado",
      before: buildCompanyDocumentBranding(profileBefore),
      after: buildCompanyDocumentBranding(profile),
    });

    res.json({
      message: "Configuracion de empresa actualizada correctamente",
      profile,
    });
  },
);

router.put(
  "/temporary-features",
  requirePermission("configuracion.update"),
  async (req, res) => {
    const parsed = temporaryFeatureSettingsSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const before = await getTemporaryFeatureSettings();
    const settings = await saveTemporaryFeatureSettings(
      parsed.data,
      Number(req.user?.id) || null,
    );

    await logAuditEvent({
      req,
      module: "configuracion",
      action: "updated_temporary_feature_settings",
      entityType: "temporary_feature_settings",
      entityId: settings.id,
      detail: "Configuracion temporal actualizada",
      before,
      after: settings,
    });

    res.json({
      message: "Configuracion temporal actualizada correctamente",
      settings,
    });
  },
);

router.get(
  "/chatbot",
  requirePermission("configuracion.read"),
  async (_req, res) => {
    const settings = await getChatbotSettings();
    res.json({ settings });
  },
);

router.put(
  "/chatbot",
  requirePermission("configuracion.update"),
  async (req, res) => {
    const parsed = chatbotSettingsSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const before = await getChatbotSettings();
    const settings = await saveChatbotSettings(
      parsed.data,
      Number(req.user?.id) || null,
    );

    await logAuditEvent({
      req,
      module: "configuracion",
      action: "updated_chatbot_settings",
      entityType: "chatbot_settings",
      entityId: settings.id,
      detail: "Configuracion del chatbot actualizada",
      before,
      after: settings,
    });

    res.json({
      message: "Configuracion del chatbot actualizada correctamente",
      settings,
    });
  },
);

const commercialSettingsSchema = z.object({
  businessTimezone: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .refine((value) => isValidIanaTimezone(value), {
      message: "Zona horaria invalida",
    })
    .optional(),
  sellerLeagueScreenDisplayMinutes: z
    .number()
    .int()
    .min(1)
    .max(60)
    .optional(),
  stageSlaMap: z.record(z.string(), z.number().int().min(1).max(90)),
  stageWeightMap: z.record(z.string(), z.number().min(0).max(1)).optional(),
  leadExecutionGuides: z
    .record(z.string(), z.string().max(5000))
    .optional()
    .default({}),
  campaignMatrixRows: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(80).optional(),
        campaignType: z.enum(CAMPAIGN_MATRIX_TYPE_VALUES),
        priority: z.enum(CAMPAIGN_MATRIX_PRIORITY_VALUES),
        campaignSubtype: z.enum(CAMPAIGN_MATRIX_SUBTYPE_VALUES),
        emailType: z.enum(CAMPAIGN_MATRIX_EMAIL_TYPE_VALUES),
        exampleEmail: z.string().max(5000).optional().default(""),
        operationalRequirement: z.string().max(2000).optional().default(""),
      }),
    )
    .max(300)
    .superRefine((rows, context) => {
      const seen = new Set();
      rows.forEach((row, index) => {
        const key = `${row.campaignType}::${row.campaignSubtype}`;
        if (seen.has(key)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "No se permite repetir la combinacion tipo/subtipo",
            path: [index, "campaignSubtype"],
          });
          return;
        }
        seen.add(key);
      });
    })
    .optional()
    .default([]),
});

router.get(
  "/commercial",
  requirePermission("configuracion.read"),
  async (_req, res) => {
    const settings = await getCommercialSettings();
    res.json({ settings, matrixCatalogs: getCampaignMatrixCatalogs() });
  },
);

router.put(
  "/commercial",
  requirePermission("configuracion.update"),
  async (req, res) => {
    const parsed = commercialSettingsSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos invalidos",
        errors: parsed.error.flatten(),
      });
    }

    const before = await getCommercialSettings();
    const settings = await saveCommercialSettings(
      parsed.data,
      Number(req.user?.id) || null,
    );

    await logAuditEvent({
      req,
      module: "configuracion",
      action: "updated_commercial_settings",
      entityType: "commercial_settings",
      entityId: settings.id,
      detail: "Configuracion comercial actualizada",
      before,
      after: settings,
    });

    res.json({
      message: "Configuracion comercial actualizada correctamente",
      settings,
      matrixCatalogs: getCampaignMatrixCatalogs(),
    });
  },
);

router.get(
  "/audit",
  requirePermission("configuracion.read"),
  async (req, res) => {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isInteger(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), 100)
      : 25;

    const rows = await query(
      `SELECT id, module, action, entity_type, entity_id, status, detail,
            changed_fields, performed_by_user_id, performed_by_name,
            performed_by_email, created_at
     FROM audit_log
     WHERE module = 'configuracion'
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
      [limit],
    );

    res.json(
      rows.map((row) => ({
        ...row,
        changed_fields: parseChangedFields(row.changed_fields),
      })),
    );
  },
);

export default router;
