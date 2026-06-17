import { config } from "./config.js";
import { query, withTransaction } from "./db.js";

let ensureCompanyProfileTablePromise;
let ensureTemporaryFeatureSettingsTablePromise;
let ensureChatbotSettingsTablePromise;
let ensureCommercialSettingsTablePromise;
let ensureAiParametersSchemaPromise;
let ensureInstitutionalAssetsSchemaPromise;
let ensureProposalContentSchemaPromise;
let ensureProposalContentClonesSchemaPromise;

const PROPOSAL_LAYOUT_MODES = ["stack", "horizontal-gallery", "manual-rows"];
const PROPOSAL_COMPONENT_KINDS = ["system", "custom"];
const PROPOSAL_COMPONENT_STATUSES = ["active", "archived"];
const PROPOSAL_AI_MODES = ["auto", "manual"];

export const AI_PARAMETER_CAPABILITY_KEYS = {
  proposalExecutiveSummary: "proposal.executive_summary",
  proposalBackground: "proposal.background",
  proposalGenericSection: "proposal.generic_section",
};

export const PROPOSAL_CONTENT_COMPONENT_DEFINITIONS = [
  {
    code: "document_rights",
    title: "Derechos del documento",
    displayOrder: 1,
    componentKind: "system",
    isVisible: true,
    aiCapabilityKey: null,
  },
  {
    code: "certifications",
    title: "Certificaciones",
    displayOrder: 2,
    componentKind: "system",
    isVisible: true,
    aiCapabilityKey: null,
  },
  {
    code: "presentation",
    title: "Presentacion",
    displayOrder: 3,
    componentKind: "system",
    isVisible: true,
    aiCapabilityKey: null,
  },
  {
    code: "mission",
    title: "Mision",
    displayOrder: 4,
    componentKind: "system",
    isVisible: true,
    aiCapabilityKey: null,
  },
  {
    code: "vision",
    title: "Vision",
    displayOrder: 5,
    componentKind: "system",
    isVisible: true,
    aiCapabilityKey: null,
  },
  {
    code: "key_partners",
    title: "Socios principales",
    displayOrder: 6,
    componentKind: "system",
    isVisible: true,
    aiCapabilityKey: null,
  },
  {
    code: "key_clients",
    title: "Principales clientes",
    displayOrder: 7,
    componentKind: "system",
    isVisible: true,
    aiCapabilityKey: null,
  },
  {
    code: "executive_summary",
    title: "Resumen ejecutivo",
    displayOrder: 8,
    componentKind: "system",
    isVisible: true,
    aiCapabilityKey: AI_PARAMETER_CAPABILITY_KEYS.proposalExecutiveSummary,
  },
  {
    code: "background",
    title: "Antecedentes",
    displayOrder: 9,
    componentKind: "system",
    isVisible: true,
    aiCapabilityKey: AI_PARAMETER_CAPABILITY_KEYS.proposalBackground,
  },
  {
    code: "solution_description",
    title: "Descripcion de la solucion",
    displayOrder: 10,
    componentKind: "system",
    isVisible: true,
    aiCapabilityKey: null,
  },
  {
    code: "services",
    title: "Servicios",
    displayOrder: 11,
    componentKind: "system",
    isVisible: true,
    aiCapabilityKey: null,
  },
  {
    code: "product_brochures",
    title: "Folletos de los productos",
    displayOrder: 12,
    componentKind: "system",
    isVisible: true,
    aiCapabilityKey: null,
  },
  {
    code: "commercial_proposal",
    title: "Propuesta economica",
    displayOrder: 13,
    componentKind: "system",
    isVisible: true,
    aiCapabilityKey: null,
  },
  {
    code: "next_steps",
    title: "Siguientes pasos",
    displayOrder: 14,
    componentKind: "system",
    isVisible: true,
    aiCapabilityKey: null,
  },
];

const AI_PARAMETER_SUPPORTED_LIBRARY_CONTENT_MODES = [
  "source_text",
  "summary_extract",
];
const AI_PARAMETER_SUPPORTED_SOURCE_PRIORITY_MODES = [
  "non_library_first",
  "balanced",
  "library_first",
];
const AI_PARAMETER_PROPOSAL_EXEC_SUMMARY_DEFAULT_PROMPT =
  "Redacta un resumen ejecutivo comercial en espanol para una propuesta B2B. Responde exclusivamente con JSON valido. No inventes capacidades, entregables ni promesas que no esten sustentadas por el contexto. Prioriza continuidad operativa, objetivos del cliente, alcance comercial y valor de negocio. Usa documentSources como fuentes documentales primarias. Trata los documentos de biblioteca con la misma prioridad estructural que los demas documentos cuando su texto este disponible. Si generationPolicy.libraryContentMode es source_text, usa el texto fuente del activo de biblioteca como documento de primer nivel. Si es summary_extract, usa solo summary y extracto resumido del activo. Si generationPolicy.sourcePriorityMode es non_library_first, prioriza fuentes no biblioteca al decidir enfoque y enfasis. Si es library_first, prioriza los documentos de biblioteca para el framing y la redaccion sin contradecir datos duros del resto del contexto. Si es balanced, reconcilia ambas familias con el mismo peso. Si generationPolicy.librarySourceMode es manual, los assets seleccionados deben influir explicitamente en el enfoque del resumen. La salida debe tener title, paragraphs y warnings. paragraphs debe ser un arreglo de 1 a 3 parrafos en espanol, sin markdown.";
const AI_PARAMETER_PROPOSAL_EXEC_SUMMARY_DEFAULT_USER_PROMPT_TEMPLATE =
  "{context, expectedShape}";
const AI_PARAMETER_PROPOSAL_EXEC_SUMMARY_DEFAULT_OUTPUT_SCHEMA = {
  title: "string",
  paragraphs: ["string"],
  warnings: ["string"],
};
const AI_PARAMETER_PROPOSAL_EXEC_SUMMARY_DEFAULT_PARAMETERS = {
  maxLibraryAssets: 4,
  allowInstructionsField: true,
  defaultLanguageCode: "es",
  supportedLibraryContentModes: AI_PARAMETER_SUPPORTED_LIBRARY_CONTENT_MODES,
  supportedSourcePriorityModes: AI_PARAMETER_SUPPORTED_SOURCE_PRIORITY_MODES,
  targetAudience: "client",
  allowOverwrite: false,
};
const AI_PARAMETER_PROPOSAL_BACKGROUND_DEFAULT_PROMPT =
  "Redacta la seccion de antecedentes para una propuesta B2B en espanol. Responde exclusivamente con JSON valido. No inventes hechos, fechas, compromisos, entregables ni relaciones que no esten sustentados por el contexto. Sintetiza el contexto comercial previo, la situacion actual del cliente, los detonantes de la oportunidad y la informacion documental relevante. Usa documentSources como fuentes documentales primarias. Trata los documentos de biblioteca con la misma prioridad estructural que los demas documentos cuando su texto este disponible. Si generationPolicy.libraryContentMode es source_text, usa el texto fuente del activo de biblioteca como documento de primer nivel. Si es summary_extract, usa solo summary y extracto resumido del activo. Si generationPolicy.sourcePriorityMode es non_library_first, prioriza fuentes no biblioteca al decidir enfoque y enfasis. Si es library_first, prioriza los documentos de biblioteca para el framing y la redaccion sin contradecir datos duros del resto del contexto. Si es balanced, reconcilia ambas familias con el mismo peso. Si generationPolicy.librarySourceMode es manual, los assets seleccionados deben influir explicitamente en el enfoque del texto. La salida debe tener title, paragraphs y warnings. paragraphs debe ser un arreglo de 1 a 3 parrafos en espanol, sin markdown.";
const AI_PARAMETER_PROPOSAL_BACKGROUND_DEFAULT_USER_PROMPT_TEMPLATE =
  "{context, expectedShape}";
const AI_PARAMETER_PROPOSAL_BACKGROUND_DEFAULT_OUTPUT_SCHEMA = {
  title: "string",
  paragraphs: ["string"],
  warnings: ["string"],
};
const AI_PARAMETER_PROPOSAL_BACKGROUND_DEFAULT_PARAMETERS = {
  maxLibraryAssets: 4,
  allowInstructionsField: true,
  defaultLanguageCode: "es",
  supportedLibraryContentModes: AI_PARAMETER_SUPPORTED_LIBRARY_CONTENT_MODES,
  supportedSourcePriorityModes: AI_PARAMETER_SUPPORTED_SOURCE_PRIORITY_MODES,
  targetAudience: "client",
  allowOverwrite: false,
};
const AI_PARAMETER_PROPOSAL_GENERIC_SECTION_DEFAULT_PROMPT =
  "Redacta contenido comercial en espanol para una seccion de propuesta B2B. Responde exclusivamente con JSON valido. No inventes hechos, promesas, entregables, fechas ni capacidades que no esten respaldadas por el contexto. Adapta el texto al titulo y objetivo de la seccion objetivo. Usa documentSources como fuentes documentales primarias. Trata los documentos de biblioteca con la misma prioridad estructural que los demas documentos cuando su texto este disponible. Si generationPolicy.libraryContentMode es source_text, usa el texto fuente del activo de biblioteca como documento de primer nivel. Si es summary_extract, usa solo summary y extracto resumido del activo. Si generationPolicy.sourcePriorityMode es non_library_first, prioriza fuentes no biblioteca al decidir enfoque y enfasis. Si es library_first, prioriza los documentos de biblioteca para el framing y la redaccion sin contradecir datos duros del resto del contexto. Si es balanced, reconcilia ambas familias con el mismo peso. Si generationPolicy.librarySourceMode es manual, los assets seleccionados deben influir explicitamente en el enfoque del texto. La salida debe tener title, paragraphs y warnings. paragraphs debe ser un arreglo de 1 a 3 parrafos en espanol, sin markdown.";
const AI_PARAMETER_PROPOSAL_GENERIC_SECTION_DEFAULT_USER_PROMPT_TEMPLATE =
  "{context, expectedShape}";
const AI_PARAMETER_PROPOSAL_GENERIC_SECTION_DEFAULT_OUTPUT_SCHEMA = {
  title: "string",
  paragraphs: ["string"],
  warnings: ["string"],
};
const AI_PARAMETER_PROPOSAL_GENERIC_SECTION_DEFAULT_PARAMETERS = {
  maxLibraryAssets: 4,
  allowInstructionsField: true,
  defaultLanguageCode: "es",
  supportedLibraryContentModes: AI_PARAMETER_SUPPORTED_LIBRARY_CONTENT_MODES,
  supportedSourcePriorityModes: AI_PARAMETER_SUPPORTED_SOURCE_PRIORITY_MODES,
  targetAudience: "client",
  allowOverwrite: false,
};
const AI_PARAMETER_CAPABILITY_DEFINITIONS = [
  {
    capabilityKey: AI_PARAMETER_CAPABILITY_KEYS.proposalExecutiveSummary,
    title: "Resumen ejecutivo",
    description: "Generacion del resumen ejecutivo comercial para propuestas.",
    isEnabled: true,
    modelOverride: null,
    timeoutMs: 120000,
    systemPrompt: AI_PARAMETER_PROPOSAL_EXEC_SUMMARY_DEFAULT_PROMPT,
    userPromptTemplate:
      AI_PARAMETER_PROPOSAL_EXEC_SUMMARY_DEFAULT_USER_PROMPT_TEMPLATE,
    outputSchema: AI_PARAMETER_PROPOSAL_EXEC_SUMMARY_DEFAULT_OUTPUT_SCHEMA,
    parameters: AI_PARAMETER_PROPOSAL_EXEC_SUMMARY_DEFAULT_PARAMETERS,
  },
  {
    capabilityKey: AI_PARAMETER_CAPABILITY_KEYS.proposalBackground,
    title: "Antecedentes",
    description: "Generacion de la seccion de antecedentes para propuestas.",
    isEnabled: true,
    modelOverride: null,
    timeoutMs: 120000,
    systemPrompt: AI_PARAMETER_PROPOSAL_BACKGROUND_DEFAULT_PROMPT,
    userPromptTemplate:
      AI_PARAMETER_PROPOSAL_BACKGROUND_DEFAULT_USER_PROMPT_TEMPLATE,
    outputSchema: AI_PARAMETER_PROPOSAL_BACKGROUND_DEFAULT_OUTPUT_SCHEMA,
    parameters: AI_PARAMETER_PROPOSAL_BACKGROUND_DEFAULT_PARAMETERS,
  },
  {
    capabilityKey: AI_PARAMETER_CAPABILITY_KEYS.proposalGenericSection,
    title: "Seccion generica",
    description:
      "Generacion generica de contenido para secciones de propuestas.",
    isEnabled: true,
    modelOverride: null,
    timeoutMs: 120000,
    systemPrompt: AI_PARAMETER_PROPOSAL_GENERIC_SECTION_DEFAULT_PROMPT,
    userPromptTemplate:
      AI_PARAMETER_PROPOSAL_GENERIC_SECTION_DEFAULT_USER_PROMPT_TEMPLATE,
    outputSchema: AI_PARAMETER_PROPOSAL_GENERIC_SECTION_DEFAULT_OUTPUT_SCHEMA,
    parameters: AI_PARAMETER_PROPOSAL_GENERIC_SECTION_DEFAULT_PARAMETERS,
  },
];

const PROPOSAL_BLOCK_TYPES = [
  "heading",
  "paragraph",
  "list",
  "image",
  "brochure",
];
const INSTITUTIONAL_ASSET_STATUSES = ["draft", "active", "archived"];

function safeParseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function executeQuery(executor, sql, params = []) {
  if (typeof executor === "function") {
    return executor(sql, params);
  }

  const [rows] = await executor.query(sql, params);
  return rows;
}

async function ensureTableColumn(tableName, columnName, ddl) {
  const safeTableName = String(tableName || "")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .trim();
  const safeColumnName = String(columnName || "")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .trim();

  if (!safeTableName || !safeColumnName) {
    throw new Error("Invalid table or column name for schema migration");
  }

  const rows = await query(
    `SHOW COLUMNS FROM \`${safeTableName}\` LIKE '${safeColumnName}'`,
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    await query(`ALTER TABLE \`${safeTableName}\` ${ddl}`);
  }
}

function slugifyCode(value, fallbackPrefix = "asset") {
  const base = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `${base || fallbackPrefix}_${Date.now()}`;
}

function getProposalComponentDefinition(componentCode) {
  return (
    PROPOSAL_CONTENT_COMPONENT_DEFINITIONS.find(
      (component) => component.code === componentCode,
    ) || null
  );
}

function buildProposalComponentCodeFromTitle(title, existingCodes = new Set()) {
  const normalizedBase = String(title || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  const base = normalizedBase || "custom_component";
  let candidate = `custom_${base}`;
  let suffix = 2;
  while (
    existingCodes.has(candidate) ||
    getProposalComponentDefinition(candidate)
  ) {
    candidate = `custom_${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function getDefaultProposalComponentMetadata(componentCode) {
  const definition = getProposalComponentDefinition(componentCode);
  const aiEnabled = Boolean(definition?.aiCapabilityKey);
  return {
    componentKind: definition?.componentKind || "custom",
    isRequired: definition ? true : false,
    isVisible:
      typeof definition?.isVisible === "boolean" ? definition.isVisible : true,
    aiEnabled,
    aiMode: aiEnabled ? "auto" : null,
    aiCapabilityKey: aiEnabled
      ? resolveProposalComponentCapabilityKey({
          componentCode,
          componentKind: definition?.componentKind || "custom",
          aiEnabled,
          capabilityKey: definition?.aiCapabilityKey || null,
        })
      : null,
    aiSettings: null,
  };
}

function normalizeProposalComponentKind(value, fallback = "custom") {
  const normalized = asText(value) || fallback;
  return PROPOSAL_COMPONENT_KINDS.includes(normalized) ? normalized : fallback;
}

function normalizeProposalComponentStatus(value) {
  const normalized = asText(value) || "active";
  return PROPOSAL_COMPONENT_STATUSES.includes(normalized)
    ? normalized
    : "active";
}

function normalizeProposalAiMode(value, fallback = null) {
  const normalized = asText(value);
  if (normalized && PROPOSAL_AI_MODES.includes(normalized)) {
    return normalized;
  }
  return fallback && PROPOSAL_AI_MODES.includes(fallback) ? fallback : null;
}

function resolveProposalComponentCapabilityKey({
  componentCode,
  componentKind,
  aiEnabled,
  capabilityKey = null,
}) {
  if (!aiEnabled) {
    return null;
  }

  const normalizedCapabilityKey = asText(capabilityKey);
  if (
    normalizedCapabilityKey &&
    Object.values(AI_PARAMETER_CAPABILITY_KEYS).includes(
      normalizedCapabilityKey,
    )
  ) {
    return normalizedCapabilityKey;
  }

  const normalizedCode = asText(componentCode);
  if (normalizedCode === "executive_summary") {
    return AI_PARAMETER_CAPABILITY_KEYS.proposalExecutiveSummary;
  }
  if (normalizedCode === "background") {
    return AI_PARAMETER_CAPABILITY_KEYS.proposalBackground;
  }

  if (normalizeProposalComponentKind(componentKind, "custom") === "custom") {
    return AI_PARAMETER_CAPABILITY_KEYS.proposalGenericSection;
  }

  return AI_PARAMETER_CAPABILITY_KEYS.proposalGenericSection;
}

function normalizeProposalComponentCapabilityKey(value, componentCode) {
  const normalized = asText(value);
  if (
    normalized &&
    Object.values(AI_PARAMETER_CAPABILITY_KEYS).includes(normalized)
  ) {
    return normalized;
  }
  return getDefaultProposalComponentMetadata(componentCode).aiCapabilityKey;
}

function normalizeProposalComponentAiEnabled(
  value,
  componentCode,
  capabilityKey,
) {
  if (typeof value === "boolean") {
    return value;
  }
  return Boolean(
    capabilityKey ||
    getDefaultProposalComponentMetadata(componentCode).aiEnabled,
  );
}

function normalizeProposalComponentAiSettings(value) {
  const parsed = safeParseJson(value, null);
  return parsed && typeof parsed === "object" ? parsed : null;
}

function normalizeProposalComponentRow(row) {
  const componentCode = asText(row.component_code);
  const metadataDefaults = getDefaultProposalComponentMetadata(componentCode);
  const componentKind = normalizeProposalComponentKind(
    row.component_kind,
    metadataDefaults.componentKind,
  );
  const aiEnabled = normalizeProposalComponentAiEnabled(
    row.ai_enabled == null ? undefined : Boolean(row.ai_enabled),
    componentCode,
    row.ai_capability_key,
  );
  const aiMode = normalizeProposalAiMode(
    row.ai_mode,
    aiEnabled ? metadataDefaults.aiMode || "auto" : null,
  );
  const aiCapabilityKey = resolveProposalComponentCapabilityKey({
    componentCode,
    componentKind,
    aiEnabled,
    capabilityKey: normalizeProposalComponentCapabilityKey(
      row.ai_capability_key,
      componentCode,
    ),
  });

  return {
    id: Number(row.id),
    componentCode,
    title: asText(row.title),
    displayOrder: Number(row.display_order || 0),
    status: normalizeProposalComponentStatus(row.status),
    componentKind,
    isRequired:
      row.is_required == null
        ? metadataDefaults.isRequired
        : Boolean(row.is_required),
    isVisible:
      row.is_visible == null
        ? metadataDefaults.isVisible
        : Boolean(row.is_visible),
    aiEnabled,
    aiMode,
    aiCapabilityKey,
    aiSettings: normalizeProposalComponentAiSettings(row.ai_settings_json),
  };
}

function normalizeProposalLayoutConfig(value) {
  const parsed = safeParseJson(value, null);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const mode = asText(parsed.mode);
  if (!PROPOSAL_LAYOUT_MODES.includes(mode)) {
    return null;
  }

  if (mode !== "manual-rows") {
    return { mode };
  }

  const rows = Array.isArray(parsed.rows)
    ? parsed.rows
        .map((row) => {
          const blockIndexes = Array.isArray(row?.blockIndexes)
            ? row.blockIndexes
                .map((index) => Number(index))
                .filter((index) => Number.isInteger(index) && index >= 0)
            : [];
          return blockIndexes.length ? { blockIndexes } : null;
        })
        .filter(Boolean)
    : [];

  return rows.length ? { mode, rows } : { mode };
}

function resolveProposalComponentLayoutMode(componentCode, layoutConfig) {
  const explicitMode = asText(layoutConfig?.mode);
  if (PROPOSAL_LAYOUT_MODES.includes(explicitMode)) {
    return explicitMode;
  }

  return componentCode === "certifications" ? "horizontal-gallery" : "stack";
}

function normalizeInstitutionalAssetVersionRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    assetId: Number(row.asset_id),
    versionNumber: Number(row.version_number || 1),
    fileUrl: asText(row.file_url),
    fileName: asText(row.file_name),
    mimeType: asText(row.mime_type),
    fileSizeBytes:
      row.file_size_bytes == null ? null : Number(row.file_size_bytes),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    checksum: asText(row.checksum),
    altText: asText(row.alt_text),
    caption: asText(row.caption),
    status: asText(row.status) || "active",
    createdAt: row.created_at || null,
    createdByUserId: row.created_by_user_id
      ? Number(row.created_by_user_id)
      : null,
  };
}

function buildInstitutionalAssetSnapshot(versionRow, assetRow = null) {
  if (!versionRow) return null;
  return {
    assetId: Number(versionRow.asset_id),
    assetVersionId: Number(versionRow.id),
    name: asText(assetRow?.name || versionRow.asset_name),
    category: asText(assetRow?.category || versionRow.asset_category),
    versionNumber: Number(versionRow.version_number || 1),
    fileUrl: asText(versionRow.file_url),
    fileName: asText(versionRow.file_name),
    mimeType: asText(versionRow.mime_type),
    fileSizeBytes:
      versionRow.file_size_bytes == null
        ? null
        : Number(versionRow.file_size_bytes),
    width: versionRow.width == null ? null : Number(versionRow.width),
    height: versionRow.height == null ? null : Number(versionRow.height),
    checksum: asText(versionRow.checksum),
    altText: asText(versionRow.alt_text),
    caption: asText(versionRow.caption),
  };
}

function normalizeInstitutionalAssetRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    code: asText(row.code),
    name: asText(row.name),
    description: asText(row.description),
    category: asText(row.category),
    mediaType: asText(row.media_type) || "image",
    status: asText(row.status) || "active",
    tags: Array.isArray(safeParseJson(row.tags_json, []))
      ? safeParseJson(row.tags_json, []).filter(Boolean)
      : [],
    currentVersionId: row.current_version_id
      ? Number(row.current_version_id)
      : null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdByUserId: row.created_by_user_id
      ? Number(row.created_by_user_id)
      : null,
    updatedByUserId: row.updated_by_user_id
      ? Number(row.updated_by_user_id)
      : null,
    currentVersion:
      row.current_version_id && row.current_file_url
        ? {
            id: Number(row.current_version_id),
            versionNumber: Number(row.current_version_number || 1),
            fileUrl: asText(row.current_file_url),
            fileName: asText(row.current_file_name),
            mimeType: asText(row.current_mime_type),
            fileSizeBytes:
              row.current_file_size_bytes == null
                ? null
                : Number(row.current_file_size_bytes),
            width: row.current_width == null ? null : Number(row.current_width),
            height:
              row.current_height == null ? null : Number(row.current_height),
            altText: asText(row.current_alt_text),
            caption: asText(row.current_caption),
          }
        : null,
  };
}

function normalizeProposalBlockRow(row) {
  const settings = safeParseJson(row.settings_json, {});
  const block = {
    id: Number(row.id),
    type: asText(row.block_type),
    displayOrder: Number(row.display_order || 0),
    text: asText(row.text_value),
    items: Array.isArray(settings.items) ? settings.items.filter(Boolean) : [],
  };

  if (block.type === "image") {
    block.image = row.asset_snapshot_json
      ? safeParseJson(row.asset_snapshot_json, null)
      : row.asset_version_id
        ? buildInstitutionalAssetSnapshot(
            {
              id: row.asset_version_id,
              asset_id: row.asset_id,
              version_number: row.asset_version_number,
              file_url: row.asset_file_url,
              file_name: row.asset_file_name,
              mime_type: row.asset_mime_type,
              file_size_bytes: row.asset_file_size_bytes,
              width: row.asset_width,
              height: row.asset_height,
              checksum: row.asset_checksum,
              alt_text: row.asset_alt_text,
              caption: row.asset_caption,
              asset_name: row.asset_name,
              asset_category: row.asset_category,
            },
            row,
          )
        : null;
    block.assetId = row.asset_id ? Number(row.asset_id) : null;
    block.assetVersionId = row.asset_version_id
      ? Number(row.asset_version_id)
      : null;
  }

  if (block.type === "brochure") {
    block.assetPublicId = asText(settings.assetPublicId);
    block.brochure = row.asset_snapshot_json
      ? safeParseJson(row.asset_snapshot_json, null)
      : block.assetPublicId
        ? { publicId: block.assetPublicId }
        : null;
  }

  return block;
}

function buildProposalBrochureSnapshot(asset) {
  if (!asset || typeof asset !== "object") {
    return null;
  }

  return {
    publicId: asText(asset.publicId),
    title: asText(asset.title),
    summary: asText(asset.summary),
    assetTypeCode: asText(asset.assetTypeCode),
    assetTypeLabel: asText(asset.assetTypeLabel),
    visibilityLevel: asText(asset.visibilityLevel),
    visibilityLabel: asText(asset.visibilityLabel),
    audienceCode: asText(asset.audienceCode),
    audienceLabel: asText(asset.audienceLabel),
    files: Array.isArray(asset.files)
      ? asset.files.map((file) => ({
          publicId: asText(file?.publicId),
          fileName: asText(file?.fileName),
          mimeType: asText(file?.mimeType),
          publicUrl: asText(file?.publicUrl),
          downloadUrl: asText(file?.downloadUrl),
        }))
      : [],
    links: Array.isArray(asset.links)
      ? asset.links.map((link) => ({
          publicId: asText(link?.publicId),
          label: asText(link?.label),
          url: asText(link?.url),
        }))
      : [],
  };
}

function normalizeProposalComponentRows(componentRows, blockRows) {
  const blocksByComponentId = new Map();
  for (const blockRow of blockRows) {
    const componentId = Number(blockRow.component_id);
    if (!blocksByComponentId.has(componentId)) {
      blocksByComponentId.set(componentId, []);
    }
    blocksByComponentId
      .get(componentId)
      .push(normalizeProposalBlockRow(blockRow));
  }

  return componentRows.map((row) => {
    const normalizedComponent = normalizeProposalComponentRow(row);
    const layoutConfig = normalizeProposalLayoutConfig(row.layout_config_json);
    return {
      ...normalizedComponent,
      layoutConfig,
      resolvedLayoutMode: resolveProposalComponentLayoutMode(
        normalizedComponent.componentCode,
        layoutConfig,
      ),
      blocks: (blocksByComponentId.get(Number(row.id)) || []).sort(
        (left, right) => left.displayOrder - right.displayOrder,
      ),
    };
  });
}

async function seedDefaultProposalContentComponents(
  configId,
  executor = query,
) {
  const normalizedConfigId = Number(configId || 0);
  if (normalizedConfigId <= 0) {
    return;
  }

  for (const component of PROPOSAL_CONTENT_COMPONENT_DEFINITIONS) {
    await executeQuery(
      executor,
      `INSERT INTO proposal_content_components
        (proposal_content_config_id, component_code, title, display_order,
         component_kind, is_required, is_visible, ai_enabled, ai_mode,
         ai_capability_key,
         status, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 'active', NOW(3), NOW(3)
       WHERE NOT EXISTS (
         SELECT 1
         FROM proposal_content_components
         WHERE proposal_content_config_id = ?
           AND component_code = ?
       )`,
      [
        normalizedConfigId,
        component.code,
        component.title,
        component.displayOrder,
        component.componentKind || "system",
        component.isVisible ? 1 : 0,
        component.aiCapabilityKey ? 1 : 0,
        component.aiCapabilityKey ? "auto" : null,
        component.aiCapabilityKey || null,
        normalizedConfigId,
        component.code,
      ],
    );
  }
}

function blocksToPlainText(blocks, fallback = "") {
  const text = (blocks || [])
    .map((block) => {
      if (block.type === "list") {
        return Array.isArray(block.items) ? block.items.join("\n") : "";
      }
      return String(block.text || "").trim();
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return text || fallback;
}

function firstListItems(blocks) {
  return (blocks || [])
    .flatMap((block) => (block.type === "list" ? block.items || [] : []))
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

export function summarizeProposalComponents(components, fallbackTitle = "") {
  const byCode = new Map(
    (components || []).map((component) => [component.componentCode, component]),
  );
  return {
    heroTitle: fallbackTitle || "Propuesta comercial",
    heroSubtitle: blocksToPlainText(
      byCode.get("presentation")?.blocks || [],
      "Propuesta comercial institucional.",
    ),
    executiveSummary: blocksToPlainText(
      byCode.get("executive_summary")?.blocks || [],
    ),
    solutionOverview: blocksToPlainText(
      byCode.get("solution_description")?.blocks || [],
    ),
    valueHighlights: firstListItems(byCode.get("services")?.blocks || []),
    closingMessage: blocksToPlainText(byCode.get("next_steps")?.blocks || []),
  };
}

async function ensureInstitutionalAssetsSchema() {
  if (!ensureInstitutionalAssetsSchemaPromise) {
    ensureInstitutionalAssetsSchemaPromise = (async () => {
      await query(
        `CREATE TABLE IF NOT EXISTS institutional_assets (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          code VARCHAR(120) NOT NULL,
          name VARCHAR(190) NOT NULL,
          description TEXT NULL,
          category VARCHAR(80) NOT NULL,
          media_type VARCHAR(40) NOT NULL DEFAULT 'image',
          status VARCHAR(40) NOT NULL DEFAULT 'active',
          current_version_id BIGINT UNSIGNED NULL,
          tags_json JSON NULL,
          created_by_user_id BIGINT UNSIGNED NULL,
          updated_by_user_id BIGINT UNSIGNED NULL,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          CONSTRAINT uq_institutional_assets_code UNIQUE (code),
          CONSTRAINT fk_institutional_assets_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
          CONSTRAINT fk_institutional_assets_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        )`,
      );
      await query(
        `CREATE TABLE IF NOT EXISTS institutional_asset_versions (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          asset_id BIGINT UNSIGNED NOT NULL,
          version_number INT UNSIGNED NOT NULL,
          file_url LONGTEXT NOT NULL,
          file_name VARCHAR(255) NULL,
          mime_type VARCHAR(120) NULL,
          file_size_bytes BIGINT NULL,
          width INT NULL,
          height INT NULL,
          checksum VARCHAR(120) NULL,
          alt_text VARCHAR(500) NULL,
          caption TEXT NULL,
          status VARCHAR(40) NOT NULL DEFAULT 'active',
          created_by_user_id BIGINT UNSIGNED NULL,
          created_at DATETIME(3) NOT NULL,
          CONSTRAINT uq_institutional_asset_versions UNIQUE (asset_id, version_number),
          CONSTRAINT fk_institutional_asset_versions_asset FOREIGN KEY (asset_id) REFERENCES institutional_assets(id) ON DELETE CASCADE,
          CONSTRAINT fk_institutional_asset_versions_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        )`,
      );
    })().catch((error) => {
      ensureInstitutionalAssetsSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureInstitutionalAssetsSchemaPromise;
}

async function ensureProposalContentSchema() {
  if (!ensureProposalContentSchemaPromise) {
    ensureProposalContentSchemaPromise = (async () => {
      await ensureInstitutionalAssetsSchema();
      await query(
        `CREATE TABLE IF NOT EXISTS proposal_content_configs (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          singleton_key VARCHAR(40) NOT NULL,
          status VARCHAR(40) NOT NULL DEFAULT 'active',
          created_by_user_id BIGINT UNSIGNED NULL,
          updated_by_user_id BIGINT UNSIGNED NULL,
          published_at DATETIME(3) NULL,
          published_by_user_id BIGINT UNSIGNED NULL,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          CONSTRAINT uq_proposal_content_configs_singleton UNIQUE (singleton_key),
          CONSTRAINT fk_proposal_content_configs_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
          CONSTRAINT fk_proposal_content_configs_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
          CONSTRAINT fk_proposal_content_configs_published_by FOREIGN KEY (published_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        )`,
      );
      await query(
        `CREATE TABLE IF NOT EXISTS proposal_content_components (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          proposal_content_config_id BIGINT UNSIGNED NOT NULL,
          component_code VARCHAR(80) NOT NULL,
          title VARCHAR(190) NOT NULL,
          display_order INT UNSIGNED NOT NULL,
          component_kind VARCHAR(40) NOT NULL DEFAULT 'system',
          is_required TINYINT(1) NOT NULL DEFAULT 1,
          is_visible TINYINT(1) NOT NULL DEFAULT 1,
          ai_enabled TINYINT(1) NOT NULL DEFAULT 0,
          ai_mode VARCHAR(20) NULL,
          ai_capability_key VARCHAR(120) NULL,
          ai_settings_json JSON NULL,
          status VARCHAR(40) NOT NULL DEFAULT 'active',
          layout_config_json JSON NULL,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          CONSTRAINT uq_proposal_content_components UNIQUE (proposal_content_config_id, component_code),
          CONSTRAINT fk_proposal_content_components_config FOREIGN KEY (proposal_content_config_id) REFERENCES proposal_content_configs(id) ON DELETE CASCADE
        )`,
      );
      await query(
        `CREATE TABLE IF NOT EXISTS proposal_content_blocks (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          proposal_content_component_id BIGINT UNSIGNED NOT NULL,
          block_type VARCHAR(40) NOT NULL,
          display_order INT UNSIGNED NOT NULL,
          text_value LONGTEXT NULL,
          asset_id BIGINT UNSIGNED NULL,
          asset_version_id BIGINT UNSIGNED NULL,
          settings_json JSON NULL,
          status VARCHAR(40) NOT NULL DEFAULT 'active',
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          CONSTRAINT fk_proposal_content_blocks_component FOREIGN KEY (proposal_content_component_id) REFERENCES proposal_content_components(id) ON DELETE CASCADE,
          CONSTRAINT fk_proposal_content_blocks_asset FOREIGN KEY (asset_id) REFERENCES institutional_assets(id) ON DELETE SET NULL,
          CONSTRAINT fk_proposal_content_blocks_asset_version FOREIGN KEY (asset_version_id) REFERENCES institutional_asset_versions(id) ON DELETE SET NULL
        )`,
      );

      await query(
        `INSERT INTO proposal_content_configs
          (singleton_key, status, created_by_user_id, updated_by_user_id, published_at, published_by_user_id, created_at, updated_at)
         SELECT 'default', 'active', NULL, NULL, NOW(3), NULL, NOW(3), NOW(3)
         WHERE NOT EXISTS (
           SELECT 1 FROM proposal_content_configs WHERE singleton_key = 'default'
         )`,
      );

      const configRows = await query(
        `SELECT id
         FROM proposal_content_configs
         WHERE singleton_key = 'default'
         LIMIT 1`,
      );
      await ensureTableColumn(
        "proposal_content_components",
        "component_kind",
        "ADD COLUMN component_kind VARCHAR(40) NOT NULL DEFAULT 'system' AFTER display_order",
      );
      await ensureTableColumn(
        "proposal_content_components",
        "is_visible",
        "ADD COLUMN is_visible TINYINT(1) NOT NULL DEFAULT 1 AFTER is_required",
      );
      await ensureTableColumn(
        "proposal_content_components",
        "ai_enabled",
        "ADD COLUMN ai_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER is_visible",
      );
      await ensureTableColumn(
        "proposal_content_components",
        "ai_mode",
        "ADD COLUMN ai_mode VARCHAR(20) NULL AFTER ai_enabled",
      );
      await ensureTableColumn(
        "proposal_content_components",
        "ai_capability_key",
        "ADD COLUMN ai_capability_key VARCHAR(120) NULL AFTER ai_mode",
      );
      await ensureTableColumn(
        "proposal_content_components",
        "ai_settings_json",
        "ADD COLUMN ai_settings_json JSON NULL AFTER ai_capability_key",
      );
      await ensureTableColumn(
        "proposal_content_components",
        "layout_config_json",
        "ADD COLUMN layout_config_json JSON NULL AFTER status",
      );

      const configId = Number(configRows[0]?.id || 0);
      if (configId > 0) {
        await seedDefaultProposalContentComponents(configId);
      }
    })().catch((error) => {
      ensureProposalContentSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureProposalContentSchemaPromise;
}

async function ensureProposalContentClonesSchema() {
  if (!ensureProposalContentClonesSchemaPromise) {
    ensureProposalContentClonesSchemaPromise = (async () => {
      await query(
        `CREATE TABLE IF NOT EXISTS proposal_components (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          proposal_id BIGINT UNSIGNED NOT NULL,
          component_code VARCHAR(80) NOT NULL,
          title_snapshot VARCHAR(190) NOT NULL,
          display_order INT UNSIGNED NOT NULL,
          component_kind VARCHAR(40) NOT NULL DEFAULT 'system',
          is_required TINYINT(1) NOT NULL DEFAULT 1,
          is_visible TINYINT(1) NOT NULL DEFAULT 1,
          ai_enabled TINYINT(1) NOT NULL DEFAULT 0,
          ai_mode VARCHAR(20) NULL,
          ai_capability_key VARCHAR(120) NULL,
          ai_settings_json JSON NULL,
          status VARCHAR(40) NOT NULL DEFAULT 'active',
          layout_config_json JSON NULL,
          created_by_user_id BIGINT UNSIGNED NULL,
          updated_by_user_id BIGINT UNSIGNED NULL,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          CONSTRAINT uq_proposal_components UNIQUE (proposal_id, component_code),
          CONSTRAINT fk_proposal_components_proposal FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE,
          CONSTRAINT fk_proposal_components_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
          CONSTRAINT fk_proposal_components_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        )`,
      );
      await query(
        `CREATE TABLE IF NOT EXISTS proposal_blocks (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          proposal_component_id BIGINT UNSIGNED NOT NULL,
          block_type VARCHAR(40) NOT NULL,
          display_order INT UNSIGNED NOT NULL,
          text_value LONGTEXT NULL,
          source_asset_id BIGINT UNSIGNED NULL,
          source_asset_version_id BIGINT UNSIGNED NULL,
          asset_snapshot_json JSON NULL,
          settings_json JSON NULL,
          created_by_user_id BIGINT UNSIGNED NULL,
          updated_by_user_id BIGINT UNSIGNED NULL,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          CONSTRAINT fk_proposal_blocks_component FOREIGN KEY (proposal_component_id) REFERENCES proposal_components(id) ON DELETE CASCADE,
          CONSTRAINT fk_proposal_blocks_asset FOREIGN KEY (source_asset_id) REFERENCES institutional_assets(id) ON DELETE SET NULL,
          CONSTRAINT fk_proposal_blocks_asset_version FOREIGN KEY (source_asset_version_id) REFERENCES institutional_asset_versions(id) ON DELETE SET NULL,
          CONSTRAINT fk_proposal_blocks_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
          CONSTRAINT fk_proposal_blocks_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        )`,
      );

      await ensureTableColumn(
        "proposal_components",
        "component_kind",
        "ADD COLUMN component_kind VARCHAR(40) NOT NULL DEFAULT 'system' AFTER display_order",
      );
      await ensureTableColumn(
        "proposal_components",
        "is_required",
        "ADD COLUMN is_required TINYINT(1) NOT NULL DEFAULT 1 AFTER component_kind",
      );
      await ensureTableColumn(
        "proposal_components",
        "is_visible",
        "ADD COLUMN is_visible TINYINT(1) NOT NULL DEFAULT 1 AFTER is_required",
      );
      await ensureTableColumn(
        "proposal_components",
        "ai_enabled",
        "ADD COLUMN ai_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER is_visible",
      );
      await ensureTableColumn(
        "proposal_components",
        "ai_mode",
        "ADD COLUMN ai_mode VARCHAR(20) NULL AFTER ai_enabled",
      );
      await ensureTableColumn(
        "proposal_components",
        "ai_capability_key",
        "ADD COLUMN ai_capability_key VARCHAR(120) NULL AFTER ai_mode",
      );
      await ensureTableColumn(
        "proposal_components",
        "ai_settings_json",
        "ADD COLUMN ai_settings_json JSON NULL AFTER ai_capability_key",
      );
      await ensureTableColumn(
        "proposal_components",
        "layout_config_json",
        "ADD COLUMN layout_config_json JSON NULL AFTER status",
      );
    })().catch((error) => {
      ensureProposalContentClonesSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureProposalContentClonesSchemaPromise;
}

async function getCurrentProposalContentConfigId(executor = query) {
  await ensureProposalContentSchema();
  const rows = await executeQuery(
    executor,
    `SELECT id
     FROM proposal_content_configs
     WHERE singleton_key = 'default'
     LIMIT 1`,
  );
  return Number(rows[0]?.id || 0);
}

async function getInstitutionalAssetVersionRow(
  assetVersionId,
  executor = query,
) {
  await ensureInstitutionalAssetsSchema();
  const rows = await executeQuery(
    executor,
    `SELECT iav.*, ia.name AS asset_name, ia.category AS asset_category
     FROM institutional_asset_versions iav
     INNER JOIN institutional_assets ia ON ia.id = iav.asset_id
     WHERE iav.id = ?
     LIMIT 1`,
    [Number(assetVersionId)],
  );
  return rows[0] || null;
}

export async function listInstitutionalAssets(filters = {}) {
  await ensureInstitutionalAssetsSchema();
  const params = [];
  const where = [];
  if (filters.status) {
    where.push("ia.status = ?");
    params.push(filters.status);
  }
  if (filters.category) {
    where.push("ia.category = ?");
    params.push(filters.category);
  }
  if (filters.search) {
    where.push("(ia.name LIKE ? OR ia.description LIKE ?)");
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  const rows = await query(
    `SELECT ia.*, iav.id AS current_version_id, iav.version_number AS current_version_number,
            iav.file_url AS current_file_url, iav.file_name AS current_file_name,
            iav.mime_type AS current_mime_type, iav.file_size_bytes AS current_file_size_bytes,
            iav.width AS current_width, iav.height AS current_height,
            iav.alt_text AS current_alt_text, iav.caption AS current_caption
     FROM institutional_assets ia
     LEFT JOIN institutional_asset_versions iav ON iav.id = ia.current_version_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ia.updated_at DESC, ia.id DESC`,
    params,
  );

  return rows.map(normalizeInstitutionalAssetRow);
}

export async function getInstitutionalAsset(assetId) {
  await ensureInstitutionalAssetsSchema();
  const assetRows = await query(
    `SELECT ia.*, iav.id AS current_version_id, iav.version_number AS current_version_number,
            iav.file_url AS current_file_url, iav.file_name AS current_file_name,
            iav.mime_type AS current_mime_type, iav.file_size_bytes AS current_file_size_bytes,
            iav.width AS current_width, iav.height AS current_height,
            iav.alt_text AS current_alt_text, iav.caption AS current_caption
     FROM institutional_assets ia
     LEFT JOIN institutional_asset_versions iav ON iav.id = ia.current_version_id
     WHERE ia.id = ?
     LIMIT 1`,
    [Number(assetId)],
  );
  if (!assetRows.length) return null;

  const versionRows = await query(
    `SELECT *
     FROM institutional_asset_versions
     WHERE asset_id = ?
     ORDER BY version_number DESC, id DESC`,
    [Number(assetId)],
  );

  return {
    ...normalizeInstitutionalAssetRow(assetRows[0]),
    versions: versionRows.map(normalizeInstitutionalAssetVersionRow),
  };
}

export async function createInstitutionalAsset(payload, actorUserId) {
  await ensureInstitutionalAssetsSchema();
  const createdAssetId = await withTransaction(async (conn) => {
    const now = new Date();
    const code = slugifyCode(payload.name || payload.code || "asset");
    const assetResult = await executeQuery(
      conn,
      `INSERT INTO institutional_assets
        (code, name, description, category, media_type, status, current_version_id,
         tags_json, created_by_user_id, updated_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'image', ?, NULL, ?, ?, ?, ?, ?)`,
      [
        code,
        asText(payload.name),
        asText(payload.description) || null,
        asText(payload.category) || "generic_proposal_media",
        INSTITUTIONAL_ASSET_STATUSES.includes(payload.status)
          ? payload.status
          : "active",
        JSON.stringify(Array.isArray(payload.tags) ? payload.tags : []),
        actorUserId || null,
        actorUserId || null,
        now,
        now,
      ],
    );

    const assetId = Number(assetResult.insertId);
    const versionResult = await executeQuery(
      conn,
      `INSERT INTO institutional_asset_versions
        (asset_id, version_number, file_url, file_name, mime_type, file_size_bytes,
         width, height, checksum, alt_text, caption, status, created_by_user_id, created_at)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        assetId,
        asText(payload.fileUrl),
        asText(payload.fileName) || null,
        asText(payload.mimeType) || null,
        payload.fileSizeBytes == null ? null : Number(payload.fileSizeBytes),
        payload.width == null ? null : Number(payload.width),
        payload.height == null ? null : Number(payload.height),
        asText(payload.checksum) || null,
        asText(payload.altText) || null,
        asText(payload.caption) || null,
        actorUserId || null,
        now,
      ],
    );

    await executeQuery(
      conn,
      `UPDATE institutional_assets
       SET current_version_id = ?, updated_at = ?, updated_by_user_id = ?
       WHERE id = ?`,
      [Number(versionResult.insertId), now, actorUserId || null, assetId],
    );

    return assetId;
  });
  return getInstitutionalAsset(createdAssetId);
}

export async function addInstitutionalAssetVersion(
  assetId,
  payload,
  actorUserId,
) {
  await ensureInstitutionalAssetsSchema();
  const committedAssetId = await withTransaction(async (conn) => {
    const rows = await executeQuery(
      conn,
      `SELECT id, status
       FROM institutional_assets
       WHERE id = ?
       LIMIT 1`,
      [Number(assetId)],
    );
    if (!rows.length) {
      return null;
    }
    const versionRows = await executeQuery(
      conn,
      `SELECT COALESCE(MAX(version_number), 0) AS max_version
       FROM institutional_asset_versions
       WHERE asset_id = ?`,
      [Number(assetId)],
    );
    const nextVersionNumber = Number(versionRows[0]?.max_version || 0) + 1;
    const now = new Date();
    const versionResult = await executeQuery(
      conn,
      `INSERT INTO institutional_asset_versions
        (asset_id, version_number, file_url, file_name, mime_type, file_size_bytes,
         width, height, checksum, alt_text, caption, status, created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        Number(assetId),
        nextVersionNumber,
        asText(payload.fileUrl),
        asText(payload.fileName) || null,
        asText(payload.mimeType) || null,
        payload.fileSizeBytes == null ? null : Number(payload.fileSizeBytes),
        payload.width == null ? null : Number(payload.width),
        payload.height == null ? null : Number(payload.height),
        asText(payload.checksum) || null,
        asText(payload.altText) || null,
        asText(payload.caption) || null,
        actorUserId || null,
        now,
      ],
    );

    await executeQuery(
      conn,
      `UPDATE institutional_assets
       SET current_version_id = ?, status = 'active', updated_by_user_id = ?, updated_at = ?
       WHERE id = ?`,
      [
        Number(versionResult.insertId),
        actorUserId || null,
        now,
        Number(assetId),
      ],
    );

    return Number(assetId);
  });
  if (!committedAssetId) return null;
  return getInstitutionalAsset(committedAssetId);
}

export async function archiveInstitutionalAsset(assetId, actorUserId) {
  await ensureInstitutionalAssetsSchema();
  const now = new Date();
  await query(
    `UPDATE institutional_assets
     SET status = 'archived', updated_by_user_id = ?, updated_at = ?
     WHERE id = ?`,
    [actorUserId || null, now, Number(assetId)],
  );
  return getInstitutionalAsset(assetId);
}

export async function getProposalContentConfiguration() {
  await ensureProposalContentSchema();
  await ensureInstitutionalAssetsSchema();
  const configRows = await query(
    `SELECT *
     FROM proposal_content_configs
     WHERE singleton_key = 'default'
     LIMIT 1`,
  );
  const config = configRows[0] || null;
  if (!config) return null;

  let componentRows = await query(
    `SELECT id, component_code, title, display_order, component_kind,
            is_required, is_visible, ai_enabled, ai_mode, ai_capability_key,
            ai_settings_json, status, layout_config_json
     FROM proposal_content_components
     WHERE proposal_content_config_id = ?
     ORDER BY display_order ASC, id ASC`,
    [Number(config.id)],
  );

  if (!componentRows.length) {
    await seedDefaultProposalContentComponents(Number(config.id));
    componentRows = await query(
      `SELECT id, component_code, title, display_order, component_kind,
              is_required, is_visible, ai_enabled, ai_mode, ai_capability_key,
              ai_settings_json, status, layout_config_json
       FROM proposal_content_components
       WHERE proposal_content_config_id = ?
       ORDER BY display_order ASC, id ASC`,
      [Number(config.id)],
    );
  }

  const blockRows = await query(
    `SELECT pcb.id, pcb.proposal_content_component_id AS component_id,
            pcb.block_type, pcb.display_order, pcb.text_value, pcb.settings_json,
            pcb.asset_id, pcb.asset_version_id,
            iav.version_number AS asset_version_number,
            iav.file_url AS asset_file_url,
            iav.file_name AS asset_file_name,
            iav.mime_type AS asset_mime_type,
            iav.file_size_bytes AS asset_file_size_bytes,
            iav.width AS asset_width,
            iav.height AS asset_height,
            iav.checksum AS asset_checksum,
            iav.alt_text AS asset_alt_text,
            iav.caption AS asset_caption,
            ia.name AS asset_name,
            ia.category AS asset_category
     FROM proposal_content_blocks pcb
     LEFT JOIN institutional_assets ia ON ia.id = pcb.asset_id
     LEFT JOIN institutional_asset_versions iav ON iav.id = pcb.asset_version_id
     WHERE pcb.proposal_content_component_id IN (
       SELECT id
       FROM proposal_content_components
       WHERE proposal_content_config_id = ?
     )
     ORDER BY pcb.display_order ASC, pcb.id ASC`,
    [Number(config.id)],
  );

  return {
    id: Number(config.id),
    status: asText(config.status) || "active",
    publishedAt: config.published_at || null,
    updatedAt: config.updated_at || null,
    components: normalizeProposalComponentRows(componentRows, blockRows),
  };
}

export async function saveProposalContentComponent({
  componentCode,
  title,
  componentKind,
  isVisible,
  aiEnabled,
  aiMode,
  aiSettings,
  layoutConfig,
  blocks,
  actorUserId,
}) {
  await ensureProposalContentSchema();
  await ensureInstitutionalAssetsSchema();

  await withTransaction(async (conn) => {
    const configId = await getCurrentProposalContentConfigId(conn);
    const componentRows = await executeQuery(
      conn,
      `SELECT id
       FROM proposal_content_components
       WHERE proposal_content_config_id = ?
         AND component_code = ?
       LIMIT 1`,
      [configId, componentCode],
    );
    const componentId = Number(componentRows[0]?.id || 0);
    if (!componentId) {
      throw new Error("Componente de propuesta no encontrado");
    }
    const now = new Date();
    const metadataDefaults = getDefaultProposalComponentMetadata(componentCode);
    const normalizedComponentKind = normalizeProposalComponentKind(
      componentKind,
      metadataDefaults.componentKind,
    );
    const nextAiEnabled = Boolean(aiEnabled);
    const nextAiMode = nextAiEnabled
      ? normalizeProposalAiMode(aiMode, "auto")
      : null;
    const nextCapabilityKey = resolveProposalComponentCapabilityKey({
      componentCode,
      componentKind: normalizedComponentKind,
      aiEnabled: nextAiEnabled,
      capabilityKey: null,
    });
    if (layoutConfig === undefined) {
      await executeQuery(
        conn,
        `UPDATE proposal_content_components
         SET title = ?, component_kind = ?, is_visible = ?,
             ai_enabled = ?, ai_mode = ?, ai_capability_key = ?,
             ai_settings_json = ?,
             updated_at = ?
         WHERE id = ?`,
        [
          asText(title) || metadataDefaults.title || "Seccion",
          normalizedComponentKind,
          isVisible == null ? 1 : isVisible ? 1 : 0,
          nextAiEnabled ? 1 : 0,
          nextAiMode,
          nextCapabilityKey,
          aiSettings ? JSON.stringify(aiSettings) : null,
          now,
          componentId,
        ],
      );
    } else {
      await executeQuery(
        conn,
        `UPDATE proposal_content_components
         SET title = ?, component_kind = ?, is_visible = ?,
             ai_enabled = ?, ai_mode = ?, ai_capability_key = ?,
             ai_settings_json = ?, layout_config_json = ?, updated_at = ?
         WHERE id = ?`,
        [
          asText(title) || metadataDefaults.title || "Seccion",
          normalizedComponentKind,
          isVisible == null ? 1 : isVisible ? 1 : 0,
          nextAiEnabled ? 1 : 0,
          nextAiMode,
          nextCapabilityKey,
          aiSettings ? JSON.stringify(aiSettings) : null,
          layoutConfig === null ? null : JSON.stringify(layoutConfig),
          now,
          componentId,
        ],
      );
    }

    await executeQuery(
      conn,
      `DELETE FROM proposal_content_blocks
       WHERE proposal_content_component_id = ?`,
      [componentId],
    );

    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      const settings =
        block.type === "list"
          ? { items: Array.isArray(block.items) ? block.items : [] }
          : {};

      await executeQuery(
        conn,
        `INSERT INTO proposal_content_blocks
          (proposal_content_component_id, block_type, display_order, text_value,
           asset_id, asset_version_id, settings_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        [
          componentId,
          block.type,
          index + 1,
          asText(block.text) || null,
          block.assetId ? Number(block.assetId) : null,
          block.assetVersionId ? Number(block.assetVersionId) : null,
          JSON.stringify(settings),
          now,
          now,
        ],
      );
    }

    await executeQuery(
      conn,
      `UPDATE proposal_content_configs
       SET updated_at = ?, updated_by_user_id = ?
       WHERE id = ?`,
      [now, actorUserId || null, configId],
    );
  });
  return getProposalContentConfiguration();
}

export async function createProposalContentComponent({
  title,
  componentCode,
  componentKind = "custom",
  isVisible = true,
  aiEnabled = false,
  aiMode = null,
  aiSettings = null,
  layoutConfig = null,
  blocks = [],
  actorUserId,
}) {
  await ensureProposalContentSchema();
  await ensureInstitutionalAssetsSchema();
  return withTransaction(async (conn) => {
    const configId = await getCurrentProposalContentConfigId(conn);
    const existingRows = await executeQuery(
      conn,
      `SELECT component_code
       FROM proposal_content_components
       WHERE proposal_content_config_id = ?`,
      [configId],
    );
    const existingCodes = new Set(
      existingRows.map((row) => asText(row.component_code)).filter(Boolean),
    );
    const nextComponentCode = asText(componentCode)
      ? asText(componentCode)
      : buildProposalComponentCodeFromTitle(title, existingCodes);
    if (existingCodes.has(nextComponentCode)) {
      throw new Error("Ya existe un componente con ese codigo");
    }

    const orderRows = await executeQuery(
      conn,
      `SELECT COALESCE(MAX(display_order), 0) AS max_display_order
       FROM proposal_content_components
       WHERE proposal_content_config_id = ?`,
      [configId],
    );
    const nextDisplayOrder = Number(orderRows[0]?.max_display_order || 0) + 1;
    const normalizedComponentKind = normalizeProposalComponentKind(
      componentKind,
      "custom",
    );
    const nextAiEnabled = Boolean(aiEnabled);
    const normalizedAiMode = nextAiEnabled
      ? normalizeProposalAiMode(aiMode, "auto")
      : null;
    const normalizedCapabilityKey = nextAiEnabled
      ? resolveProposalComponentCapabilityKey({
          componentCode: nextComponentCode,
          componentKind: normalizedComponentKind,
          aiEnabled: nextAiEnabled,
        })
      : null;
    const now = new Date();
    const insertResult = await executeQuery(
      conn,
      `INSERT INTO proposal_content_components
        (proposal_content_config_id, component_code, title, display_order,
         component_kind, is_required, is_visible, ai_enabled, ai_mode,
         ai_capability_key,
         ai_settings_json, status, layout_config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      [
        configId,
        nextComponentCode,
        asText(title) || "Nueva seccion",
        nextDisplayOrder,
        normalizedComponentKind,
        isVisible ? 1 : 0,
        nextAiEnabled ? 1 : 0,
        normalizedAiMode,
        normalizedCapabilityKey,
        aiSettings ? JSON.stringify(aiSettings) : null,
        layoutConfig ? JSON.stringify(layoutConfig) : null,
        now,
        now,
      ],
    );

    const componentId = Number(insertResult.insertId);
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      const settings =
        block.type === "list"
          ? { items: Array.isArray(block.items) ? block.items : [] }
          : {};
      await executeQuery(
        conn,
        `INSERT INTO proposal_content_blocks
          (proposal_content_component_id, block_type, display_order, text_value,
           asset_id, asset_version_id, settings_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        [
          componentId,
          block.type,
          index + 1,
          asText(block.text) || null,
          block.assetId ? Number(block.assetId) : null,
          block.assetVersionId ? Number(block.assetVersionId) : null,
          JSON.stringify(settings),
          now,
          now,
        ],
      );
    }

    await executeQuery(
      conn,
      `UPDATE proposal_content_configs
       SET updated_at = ?, updated_by_user_id = ?
       WHERE id = ?`,
      [now, actorUserId || null, configId],
    );

    return getProposalContentConfiguration();
  });
}

export async function reorderProposalContentComponents({
  orderedComponentCodes,
  actorUserId,
}) {
  await ensureProposalContentSchema();
  return withTransaction(async (conn) => {
    const configId = await getCurrentProposalContentConfigId(conn);
    const componentRows = await executeQuery(
      conn,
      `SELECT id, component_code
       FROM proposal_content_components
       WHERE proposal_content_config_id = ?`,
      [configId],
    );
    const knownCodes = new Set(
      componentRows.map((row) => asText(row.component_code)).filter(Boolean),
    );
    const normalizedCodes = orderedComponentCodes.map((code) => asText(code));
    if (
      normalizedCodes.length !== componentRows.length ||
      normalizedCodes.some((code) => !knownCodes.has(code))
    ) {
      throw new Error(
        "El orden enviado no coincide con los componentes actuales",
      );
    }

    const now = new Date();
    for (let index = 0; index < normalizedCodes.length; index += 1) {
      await executeQuery(
        conn,
        `UPDATE proposal_content_components
         SET display_order = ?, updated_at = ?
         WHERE proposal_content_config_id = ? AND component_code = ?`,
        [index + 1, now, configId, normalizedCodes[index]],
      );
    }
    await executeQuery(
      conn,
      `UPDATE proposal_content_configs
       SET updated_at = ?, updated_by_user_id = ?
       WHERE id = ?`,
      [now, actorUserId || null, configId],
    );
    return getProposalContentConfiguration();
  });
}

export async function setProposalContentComponentStatus({
  componentCode,
  status,
  actorUserId,
}) {
  await ensureProposalContentSchema();
  const nextStatus = normalizeProposalComponentStatus(status);
  return withTransaction(async (conn) => {
    const configId = await getCurrentProposalContentConfigId(conn);
    const rows = await executeQuery(
      conn,
      `SELECT id, component_kind
       FROM proposal_content_components
       WHERE proposal_content_config_id = ? AND component_code = ?
       LIMIT 1`,
      [configId, componentCode],
    );
    const component = rows[0] || null;
    if (!component) {
      throw new Error("Componente no encontrado");
    }
    const now = new Date();
    await executeQuery(
      conn,
      `UPDATE proposal_content_components
       SET status = ?, is_visible = ?, updated_at = ?
       WHERE id = ?`,
      [
        nextStatus,
        nextStatus === "archived" ? 0 : 1,
        now,
        Number(component.id),
      ],
    );
    await executeQuery(
      conn,
      `UPDATE proposal_content_configs
       SET updated_at = ?, updated_by_user_id = ?
       WHERE id = ?`,
      [now, actorUserId || null, configId],
    );
    return getProposalContentConfiguration();
  });
}

export async function deleteProposalContentComponent({
  componentCode,
  actorUserId,
}) {
  await ensureProposalContentSchema();
  return withTransaction(async (conn) => {
    const configId = await getCurrentProposalContentConfigId(conn);
    const rows = await executeQuery(
      conn,
      `SELECT id, component_kind
       FROM proposal_content_components
       WHERE proposal_content_config_id = ? AND component_code = ?
       LIMIT 1`,
      [configId, componentCode],
    );
    const component = rows[0] || null;
    if (!component) {
      throw new Error("Componente no encontrado");
    }
    if (normalizeProposalComponentKind(component.component_kind) !== "custom") {
      throw new Error("Solo los componentes custom se pueden eliminar");
    }
    const now = new Date();
    await executeQuery(
      conn,
      `DELETE FROM proposal_content_components
       WHERE id = ?`,
      [Number(component.id)],
    );
    await executeQuery(
      conn,
      `UPDATE proposal_content_configs
       SET updated_at = ?, updated_by_user_id = ?
       WHERE id = ?`,
      [now, actorUserId || null, configId],
    );
    return getProposalContentConfiguration();
  });
}

export async function publishProposalContentConfiguration(actorUserId) {
  await ensureProposalContentSchema();
  const configId = await getCurrentProposalContentConfigId();
  const now = new Date();
  await query(
    `UPDATE proposal_content_configs
     SET status = 'active', published_at = ?, published_by_user_id = ?, updated_at = ?, updated_by_user_id = ?
     WHERE id = ?`,
    [now, actorUserId || null, now, actorUserId || null, configId],
  );
  return getProposalContentConfiguration();
}

export async function listProposalComponents(proposalId) {
  await ensureProposalContentClonesSchema();
  await ensureInstitutionalAssetsSchema();
  const componentRows = await query(
    `SELECT id, component_code, title_snapshot AS title, display_order,
            component_kind, is_required, is_visible, ai_enabled, ai_mode,
            ai_capability_key, ai_settings_json, status, layout_config_json
     FROM proposal_components
     WHERE proposal_id = ?
     ORDER BY display_order ASC, id ASC`,
    [Number(proposalId)],
  );
  if (!componentRows.length) return [];

  const blockRows = await query(
    `SELECT pb.id, pb.proposal_component_id AS component_id, pb.block_type,
            pb.display_order, pb.text_value, pb.settings_json, pb.asset_snapshot_json,
            pb.source_asset_id AS asset_id, pb.source_asset_version_id AS asset_version_id,
            iav.version_number AS asset_version_number,
            iav.file_url AS asset_file_url,
            iav.file_name AS asset_file_name,
            iav.mime_type AS asset_mime_type,
            iav.file_size_bytes AS asset_file_size_bytes,
            iav.width AS asset_width,
            iav.height AS asset_height,
            iav.checksum AS asset_checksum,
            iav.alt_text AS asset_alt_text,
            iav.caption AS asset_caption,
            ia.name AS asset_name,
            ia.category AS asset_category
     FROM proposal_blocks pb
     LEFT JOIN institutional_assets ia ON ia.id = pb.source_asset_id
     LEFT JOIN institutional_asset_versions iav ON iav.id = pb.source_asset_version_id
     WHERE pb.proposal_component_id IN (
       SELECT id FROM proposal_components WHERE proposal_id = ?
     )
     ORDER BY pb.display_order ASC, pb.id ASC`,
    [Number(proposalId)],
  );

  return normalizeProposalComponentRows(componentRows, blockRows);
}

async function resolveSourceComponentRows({
  sourceProposalId = null,
  executor = query,
}) {
  if (sourceProposalId) {
    const componentRows = await executeQuery(
      executor,
      `SELECT id, component_code, title_snapshot AS title, display_order,
          component_kind, is_required, is_visible, ai_enabled, ai_mode,
          ai_capability_key, ai_settings_json, status, layout_config_json
       FROM proposal_components
       WHERE proposal_id = ?
       ORDER BY display_order ASC, id ASC`,
      [Number(sourceProposalId)],
    );
    const blockRows = componentRows.length
      ? await executeQuery(
          executor,
          `SELECT id, proposal_component_id AS component_id, block_type, display_order,
                  text_value, source_asset_id AS asset_id,
                  source_asset_version_id AS asset_version_id, asset_snapshot_json,
                  settings_json
           FROM proposal_blocks
           WHERE proposal_component_id IN (${componentRows.map(() => "?").join(", ")})
           ORDER BY display_order ASC, id ASC`,
          componentRows.map((row) => Number(row.id)),
        )
      : [];
    return normalizeProposalComponentRows(componentRows, blockRows);
  }

  const configId = await getCurrentProposalContentConfigId(executor);
  const componentRows = await executeQuery(
    executor,
    `SELECT id, component_code, title, display_order, component_kind,
            is_required, is_visible, ai_enabled, ai_mode, ai_capability_key,
            ai_settings_json, status, layout_config_json
     FROM proposal_content_components
     WHERE proposal_content_config_id = ?
       AND status = 'active'
       AND is_visible = 1
     ORDER BY display_order ASC, id ASC`,
    [configId],
  );
  const blockRows = componentRows.length
    ? await executeQuery(
        executor,
        `SELECT pcb.id, pcb.proposal_content_component_id AS component_id,
                pcb.block_type, pcb.display_order, pcb.text_value, pcb.settings_json,
                pcb.asset_id, pcb.asset_version_id,
                iav.version_number AS asset_version_number,
                iav.file_url AS asset_file_url,
                iav.file_name AS asset_file_name,
                iav.mime_type AS asset_mime_type,
                iav.file_size_bytes AS asset_file_size_bytes,
                iav.width AS asset_width,
                iav.height AS asset_height,
                iav.checksum AS asset_checksum,
                iav.alt_text AS asset_alt_text,
                iav.caption AS asset_caption,
                ia.name AS asset_name,
                ia.category AS asset_category
         FROM proposal_content_blocks pcb
         LEFT JOIN institutional_assets ia ON ia.id = pcb.asset_id
         LEFT JOIN institutional_asset_versions iav ON iav.id = pcb.asset_version_id
         WHERE pcb.proposal_content_component_id IN (${componentRows
           .map(() => "?")
           .join(", ")})
         ORDER BY pcb.display_order ASC, pcb.id ASC`,
        componentRows.map((row) => Number(row.id)),
      )
    : [];
  return normalizeProposalComponentRows(componentRows, blockRows);
}

export async function cloneProposalComponents({
  proposalId,
  actorUserId,
  sourceProposalId = null,
  executor = query,
}) {
  await ensureProposalContentSchema();
  await ensureProposalContentClonesSchema();
  const sourceComponents = await resolveSourceComponentRows({
    sourceProposalId,
    executor,
  });
  const now = new Date();

  await executeQuery(
    executor,
    `DELETE pb
     FROM proposal_blocks pb
     INNER JOIN proposal_components pc ON pc.id = pb.proposal_component_id
     WHERE pc.proposal_id = ?`,
    [Number(proposalId)],
  );
  await executeQuery(
    executor,
    `DELETE FROM proposal_components
     WHERE proposal_id = ?`,
    [Number(proposalId)],
  );

  for (const component of sourceComponents) {
    const componentResult = await executeQuery(
      executor,
      `INSERT INTO proposal_components
        (proposal_id, component_code, title_snapshot, display_order,
         component_kind, is_required, is_visible, ai_enabled, ai_mode,
         ai_capability_key,
         ai_settings_json, status, layout_config_json,
         created_by_user_id, updated_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(proposalId),
        component.componentCode,
        component.title,
        Number(component.displayOrder || 0),
        component.componentKind || "custom",
        component.isRequired ? 1 : 0,
        component.isVisible ? 1 : 0,
        component.aiEnabled ? 1 : 0,
        component.aiEnabled
          ? normalizeProposalAiMode(component.aiMode, "auto")
          : null,
        component.aiEnabled ? component.aiCapabilityKey || null : null,
        component.aiSettings ? JSON.stringify(component.aiSettings) : null,
        component.status || "active",
        component.layoutConfig ? JSON.stringify(component.layoutConfig) : null,
        actorUserId || null,
        actorUserId || null,
        now,
        now,
      ],
    );
    const proposalComponentId = Number(componentResult.insertId);

    for (let index = 0; index < component.blocks.length; index += 1) {
      const block = component.blocks[index];
      const settings =
        block.type === "list"
          ? { items: Array.isArray(block.items) ? block.items : [] }
          : block.type === "brochure"
            ? { assetPublicId: asText(block.assetPublicId) }
            : {};
      const snapshot =
        block.type === "image" && block.image
          ? JSON.stringify(block.image)
          : block.type === "brochure" && block.brochure
            ? JSON.stringify(buildProposalBrochureSnapshot(block.brochure))
            : null;
      await executeQuery(
        executor,
        `INSERT INTO proposal_blocks
          (proposal_component_id, block_type, display_order, text_value,
           source_asset_id, source_asset_version_id, asset_snapshot_json, settings_json,
           created_by_user_id, updated_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          proposalComponentId,
          block.type,
          index + 1,
          asText(block.text) || null,
          block.assetId ? Number(block.assetId) : null,
          block.assetVersionId ? Number(block.assetVersionId) : null,
          snapshot,
          JSON.stringify(settings),
          actorUserId || null,
          actorUserId || null,
          now,
          now,
        ],
      );
    }
  }

  return listProposalComponents(proposalId);
}

export async function saveProposalComponentBlocks({
  proposalId,
  componentCode,
  title,
  blocks,
  componentSettings,
  brochureAssetsByPublicId = {},
  actorUserId,
}) {
  await ensureProposalContentClonesSchema();
  await ensureInstitutionalAssetsSchema();

  return withTransaction(async (conn) => {
    const now = new Date();
    const rows = await executeQuery(
      conn,
      `SELECT id
       FROM proposal_components
       WHERE proposal_id = ? AND component_code = ?
       LIMIT 1`,
      [Number(proposalId), componentCode],
    );

    let proposalComponentId = Number(rows[0]?.id || 0);
    const fallbackSourceRows = await executeQuery(
      conn,
      `SELECT id, component_code, title, display_order, component_kind,
              is_required, is_visible, ai_enabled, ai_capability_key,
              ai_settings_json, status, layout_config_json
       FROM proposal_content_components
       WHERE proposal_content_config_id = ? AND component_code = ?
       LIMIT 1`,
      [await getCurrentProposalContentConfigId(conn), componentCode],
    );
    const fallbackSource = fallbackSourceRows[0]
      ? normalizeProposalComponentRow(fallbackSourceRows[0])
      : {
          componentCode,
          title: asText(title) || "Seccion",
          displayOrder: 999,
          componentKind:
            getDefaultProposalComponentMetadata(componentCode).componentKind,
          isRequired: false,
          isVisible: true,
          aiEnabled: false,
          aiCapabilityKey: null,
          aiSettings: null,
          status: "active",
        };
    if (!proposalComponentId) {
      const insertResult = await executeQuery(
        conn,
        `INSERT INTO proposal_components
          (proposal_id, component_code, title_snapshot, display_order,
           component_kind, is_required, is_visible, ai_enabled, ai_capability_key,
           ai_settings_json, status, layout_config_json,
           created_by_user_id, updated_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?, ?)`,
        [
          Number(proposalId),
          componentCode,
          asText(title) || fallbackSource.title,
          Number(fallbackSource.displayOrder || 0),
          fallbackSource.componentKind,
          fallbackSource.isRequired ? 1 : 0,
          fallbackSource.isVisible ? 1 : 0,
          fallbackSource.aiEnabled ? 1 : 0,
          fallbackSource.aiEnabled
            ? fallbackSource.aiCapabilityKey || null
            : null,
          componentSettings
            ? JSON.stringify(componentSettings)
            : fallbackSource.aiSettings
              ? JSON.stringify(fallbackSource.aiSettings)
              : null,
          actorUserId || null,
          actorUserId || null,
          now,
          now,
        ],
      );
      proposalComponentId = Number(insertResult.insertId);
    } else {
      if (componentSettings) {
        await executeQuery(
          conn,
          `UPDATE proposal_components
           SET title_snapshot = ?, ai_settings_json = ?, updated_at = ?, updated_by_user_id = ?
           WHERE id = ?`,
          [
            asText(title) || fallbackSource.title,
            JSON.stringify(componentSettings),
            now,
            actorUserId || null,
            proposalComponentId,
          ],
        );
      } else {
        await executeQuery(
          conn,
          `UPDATE proposal_components
           SET title_snapshot = ?, updated_at = ?, updated_by_user_id = ?
           WHERE id = ?`,
          [
            asText(title) || fallbackSource.title,
            now,
            actorUserId || null,
            proposalComponentId,
          ],
        );
      }
      await executeQuery(
        conn,
        `DELETE FROM proposal_blocks
         WHERE proposal_component_id = ?`,
        [proposalComponentId],
      );
    }

    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      const settings =
        block.type === "list"
          ? { items: Array.isArray(block.items) ? block.items : [] }
          : block.type === "brochure"
            ? { assetPublicId: asText(block.assetPublicId) }
            : {};
      let snapshot = null;
      if (block.type === "image" && block.assetVersionId) {
        const versionRow = await getInstitutionalAssetVersionRow(
          Number(block.assetVersionId),
          conn,
        );
        snapshot = versionRow
          ? buildInstitutionalAssetSnapshot(versionRow)
          : null;
      } else if (block.type === "image" && block.image?.fileUrl) {
        snapshot = {
          fileUrl: asText(block.image.fileUrl),
          fileName: asText(block.image.fileName),
          mimeType: asText(block.image.mimeType),
          fileSizeBytes:
            block.image.fileSizeBytes == null
              ? null
              : Number(block.image.fileSizeBytes),
          width: block.image.width == null ? null : Number(block.image.width),
          height:
            block.image.height == null ? null : Number(block.image.height),
          checksum: asText(block.image.checksum),
          altText: asText(block.image.altText),
          caption: asText(block.image.caption),
        };
      } else if (block.type === "brochure") {
        snapshot = buildProposalBrochureSnapshot(
          brochureAssetsByPublicId[asText(block.assetPublicId)] || null,
        );
      }

      await executeQuery(
        conn,
        `INSERT INTO proposal_blocks
          (proposal_component_id, block_type, display_order, text_value,
           source_asset_id, source_asset_version_id, asset_snapshot_json, settings_json,
           created_by_user_id, updated_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          proposalComponentId,
          block.type,
          index + 1,
          asText(block.text) || null,
          block.assetId ? Number(block.assetId) : null,
          block.assetVersionId ? Number(block.assetVersionId) : null,
          snapshot ? JSON.stringify(snapshot) : null,
          JSON.stringify(settings),
          actorUserId || null,
          actorUserId || null,
          now,
          now,
        ],
      );
    }

    return listProposalComponents(proposalId);
  });
}

export async function replaceProposalComponentImage({
  proposalId,
  componentCode,
  blockId,
  assetId,
  assetVersionId,
  actorUserId,
}) {
  await ensureProposalContentClonesSchema();
  await ensureInstitutionalAssetsSchema();
  const versionRow = await getInstitutionalAssetVersionRow(assetVersionId);
  if (!versionRow || Number(versionRow.asset_id) !== Number(assetId)) {
    return null;
  }

  const snapshot = buildInstitutionalAssetSnapshot(versionRow);
  const now = new Date();
  await query(
    `UPDATE proposal_blocks pb
     INNER JOIN proposal_components pc ON pc.id = pb.proposal_component_id
     SET pb.source_asset_id = ?,
         pb.source_asset_version_id = ?,
         pb.asset_snapshot_json = ?,
         pb.updated_by_user_id = ?,
         pb.updated_at = ?,
         pc.updated_by_user_id = ?,
         pc.updated_at = ?
     WHERE pb.id = ?
       AND pc.proposal_id = ?
       AND pc.component_code = ?`,
    [
      Number(assetId),
      Number(assetVersionId),
      JSON.stringify(snapshot),
      actorUserId || null,
      now,
      actorUserId || null,
      now,
      Number(blockId),
      Number(proposalId),
      componentCode,
    ],
  );

  return listProposalComponents(proposalId);
}

function asText(value) {
  return String(value || "").trim();
}

function buildFallbackCompanyProfile() {
  const defaultCompany = config.documents.quotation.company;
  const addressLines = Array.isArray(defaultCompany.addressLines)
    ? defaultCompany.addressLines.filter(Boolean)
    : [];

  return {
    id: null,
    singletonKey: "default",
    legalName: asText(defaultCompany.legalName),
    commercialName: "",
    taxId: asText(defaultCompany.taxId),
    logoUrl: asText(defaultCompany.logoPath),
    addressLine1: asText(addressLines[0]),
    addressLine2: asText(addressLines[1]),
    city: "",
    stateRegion: "",
    countryId: null,
    countryCode: "",
    countryName: "",
    postalCode: "",
    email: asText(defaultCompany.email),
    phone: asText(defaultCompany.phone),
    website: "",
    description: "",
    createdAt: null,
    updatedAt: null,
    createdByUserId: null,
    createdByUserName: "",
    updatedByUserId: null,
    updatedByUserName: "",
  };
}

function normalizeCompanyProfileRow(row) {
  if (!row) {
    return buildFallbackCompanyProfile();
  }

  return {
    id: Number(row.id),
    singletonKey: row.singleton_key,
    legalName: asText(row.legal_name),
    commercialName: asText(row.commercial_name),
    taxId: asText(row.tax_id),
    logoUrl: asText(row.logo_url),
    addressLine1: asText(row.address_line1),
    addressLine2: asText(row.address_line2),
    city: asText(row.city),
    stateRegion: asText(row.state_region),
    countryId: row.country_id ? Number(row.country_id) : null,
    countryCode: asText(row.country_code),
    countryName: asText(row.country_name),
    postalCode: asText(row.postal_code),
    email: asText(row.email),
    phone: asText(row.phone),
    website: asText(row.website),
    description: asText(row.description),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdByUserId: row.created_by_user_id
      ? Number(row.created_by_user_id)
      : null,
    createdByUserName: asText(row.created_by_user_name),
    updatedByUserId: row.updated_by_user_id
      ? Number(row.updated_by_user_id)
      : null,
    updatedByUserName: asText(row.updated_by_user_name),
  };
}

function buildFallbackTemporaryFeatureSettings() {
  return {
    id: null,
    singletonKey: "default",
    accountsPendingEnabled: false,
    contactsPendingEnabled: false,
    opportunitiesPendingEnabled: false,
    createdAt: null,
    updatedAt: null,
    createdByUserId: null,
    updatedByUserId: null,
    createdByUserName: "",
    updatedByUserName: "",
  };
}

function normalizeTemporaryFeatureSettingsRow(row) {
  if (!row) {
    return buildFallbackTemporaryFeatureSettings();
  }

  return {
    id: Number(row.id),
    singletonKey: asText(row.singleton_key),
    accountsPendingEnabled: Boolean(row.accounts_pending_enabled),
    contactsPendingEnabled: Boolean(row.contacts_pending_enabled),
    opportunitiesPendingEnabled: Boolean(row.opportunities_pending_enabled),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdByUserId: row.created_by_user_id
      ? Number(row.created_by_user_id)
      : null,
    updatedByUserId: row.updated_by_user_id
      ? Number(row.updated_by_user_id)
      : null,
    createdByUserName: asText(row.created_by_user_name),
    updatedByUserName: asText(row.updated_by_user_name),
  };
}

function buildFallbackChatbotSettings() {
  return {
    id: null,
    singletonKey: "default",
    requestTimeoutMs: 60000,
    createdAt: null,
    updatedAt: null,
    createdByUserId: null,
    updatedByUserId: null,
    createdByUserName: "",
    updatedByUserName: "",
  };
}

function normalizeChatbotSettingsRow(row) {
  if (!row) {
    return buildFallbackChatbotSettings();
  }

  return {
    id: Number(row.id),
    singletonKey: asText(row.singleton_key),
    requestTimeoutMs: Math.max(5000, Number(row.request_timeout_ms || 60000)),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    createdByUserId: row.created_by_user_id
      ? Number(row.created_by_user_id)
      : null,
    updatedByUserId: row.updated_by_user_id
      ? Number(row.updated_by_user_id)
      : null,
    createdByUserName: asText(row.created_by_user_name),
    updatedByUserName: asText(row.updated_by_user_name),
  };
}

function getAiParameterCapabilityDefinition(capabilityKey) {
  return (
    AI_PARAMETER_CAPABILITY_DEFINITIONS.find(
      (entry) => entry.capabilityKey === capabilityKey,
    ) || null
  );
}

function buildDefaultAiParameterEntry(capabilityKey) {
  const definition = getAiParameterCapabilityDefinition(capabilityKey);
  if (!definition) return null;
  return {
    capabilityKey: definition.capabilityKey,
    title: definition.title,
    description: definition.description,
    isEnabled: Boolean(definition.isEnabled),
    modelOverride: definition.modelOverride || null,
    timeoutMs: Number(definition.timeoutMs || 120000),
    systemPrompt: asText(definition.systemPrompt),
    userPromptTemplate: asText(definition.userPromptTemplate),
    outputSchema: safeParseJson(definition.outputSchema, {}) || {},
    parameters: safeParseJson(definition.parameters, {}) || {},
  };
}

function normalizeAiParameterEntrySnapshot(value, fallbackCapabilityKey = "") {
  const defaults = buildDefaultAiParameterEntry(fallbackCapabilityKey) || {
    capabilityKey: fallbackCapabilityKey,
    title: "",
    description: "",
    isEnabled: true,
    modelOverride: null,
    timeoutMs: 120000,
    systemPrompt: "",
    userPromptTemplate: "",
    outputSchema: {},
    parameters: {},
  };
  const parsed = safeParseJson(value, value);
  const source = parsed && typeof parsed === "object" ? parsed : {};
  return {
    capabilityKey: asText(source.capabilityKey || defaults.capabilityKey),
    title: asText(source.title || defaults.title),
    description: asText(source.description || defaults.description),
    isEnabled:
      source.isEnabled === undefined
        ? Boolean(defaults.isEnabled)
        : Boolean(source.isEnabled),
    modelOverride:
      asText(source.modelOverride || defaults.modelOverride) || null,
    timeoutMs: Math.max(
      5000,
      Number(source.timeoutMs || defaults.timeoutMs || 120000),
    ),
    systemPrompt: asText(source.systemPrompt || defaults.systemPrompt),
    userPromptTemplate: asText(
      source.userPromptTemplate || defaults.userPromptTemplate,
    ),
    outputSchema:
      safeParseJson(source.outputSchema || defaults.outputSchema, {}) || {},
    parameters:
      safeParseJson(source.parameters || defaults.parameters, {}) || {},
  };
}

function normalizeAiParameterEntryRow(row, publishedSnapshot = null) {
  const currentSnapshot = normalizeAiParameterEntrySnapshot(
    {
      capabilityKey: row?.capability_key,
      title: row?.title,
      description: row?.description,
      isEnabled: row?.is_enabled,
      modelOverride: row?.model_override,
      timeoutMs: row?.timeout_ms,
      systemPrompt: row?.system_prompt,
      userPromptTemplate: row?.user_prompt_template,
      outputSchema: safeParseJson(row?.output_schema_json, {}),
      parameters: safeParseJson(row?.parameters_json, {}),
    },
    row?.capability_key,
  );
  const published = publishedSnapshot
    ? normalizeAiParameterEntrySnapshot(
        publishedSnapshot,
        row?.capability_key || currentSnapshot.capabilityKey,
      )
    : null;

  return {
    id: row?.id ? Number(row.id) : null,
    capabilityKey: currentSnapshot.capabilityKey,
    title: currentSnapshot.title,
    description: currentSnapshot.description,
    isEnabled: currentSnapshot.isEnabled,
    modelOverride: currentSnapshot.modelOverride,
    timeoutMs: Number(currentSnapshot.timeoutMs || 120000),
    systemPrompt: currentSnapshot.systemPrompt,
    userPromptTemplate: currentSnapshot.userPromptTemplate,
    outputSchema: currentSnapshot.outputSchema,
    parameters: currentSnapshot.parameters,
    draftRevisionNumber: row?.draft_revision_number
      ? Number(row.draft_revision_number)
      : null,
    publishedRevisionNumber: row?.published_revision_number
      ? Number(row.published_revision_number)
      : null,
    updatedAt: row?.updated_at || null,
    updatedByUserId: row?.updated_by_user_id
      ? Number(row.updated_by_user_id)
      : null,
    updatedByUserName: asText(row?.updated_by_user_name),
    createdAt: row?.created_at || null,
    createdByUserId: row?.created_by_user_id
      ? Number(row.created_by_user_id)
      : null,
    createdByUserName: asText(row?.created_by_user_name),
    published: published
      ? {
          revisionNumber: row?.published_revision_number
            ? Number(row.published_revision_number)
            : null,
          title: published.title,
          description: published.description,
          isEnabled: published.isEnabled,
          modelOverride: published.modelOverride,
          timeoutMs: Number(published.timeoutMs || 120000),
          systemPrompt: published.systemPrompt,
          userPromptTemplate: published.userPromptTemplate,
          outputSchema: published.outputSchema,
          parameters: published.parameters,
        }
      : null,
  };
}

function normalizeAiParameterRevisionRow(row, isPublished = false) {
  const snapshot = normalizeAiParameterEntrySnapshot(
    safeParseJson(row?.snapshot_json, {}),
    row?.capability_key,
  );
  return {
    id: row?.id ? Number(row.id) : null,
    capabilityKey: snapshot.capabilityKey || asText(row?.capability_key),
    revisionNumber: row?.revision_number ? Number(row.revision_number) : null,
    changeSummary: asText(row?.change_summary),
    createdAt: row?.created_at || null,
    createdByUserId: row?.created_by_user_id
      ? Number(row.created_by_user_id)
      : null,
    createdByUserName: asText(row?.created_by_user_name),
    isPublished,
    snapshot,
  };
}

async function ensureCompanyProfileTable() {
  if (!ensureCompanyProfileTablePromise) {
    ensureCompanyProfileTablePromise = query(
      `CREATE TABLE IF NOT EXISTS company_profile (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        singleton_key VARCHAR(40) NOT NULL,
        legal_name VARCHAR(190) NOT NULL,
        commercial_name VARCHAR(190) NULL,
        tax_id VARCHAR(120) NOT NULL,
        logo_url LONGTEXT NULL,
        address_line1 VARCHAR(255) NOT NULL,
        address_line2 VARCHAR(255) NULL,
        city VARCHAR(120) NOT NULL,
        state_region VARCHAR(120) NOT NULL,
        country_id BIGINT UNSIGNED NOT NULL,
        postal_code VARCHAR(20) NOT NULL,
        email VARCHAR(190) NULL,
        phone VARCHAR(40) NULL,
        website VARCHAR(300) NULL,
        description TEXT NULL,
        created_by_user_id BIGINT UNSIGNED NULL,
        updated_by_user_id BIGINT UNSIGNED NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        CONSTRAINT uq_company_profile_singleton UNIQUE (singleton_key),
        CONSTRAINT fk_company_profile_country FOREIGN KEY (country_id) REFERENCES countries(id),
        CONSTRAINT fk_company_profile_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_company_profile_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      )`,
    ).catch((error) => {
      ensureCompanyProfileTablePromise = undefined;
      throw error;
    });
  }

  await ensureCompanyProfileTablePromise;
}

async function ensureTemporaryFeatureSettingsTable() {
  if (!ensureTemporaryFeatureSettingsTablePromise) {
    ensureTemporaryFeatureSettingsTablePromise = query(
      `CREATE TABLE IF NOT EXISTS temporary_feature_settings (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        singleton_key VARCHAR(40) NOT NULL,
        accounts_pending_enabled TINYINT(1) NOT NULL DEFAULT 0,
        contacts_pending_enabled TINYINT(1) NOT NULL DEFAULT 0,
        opportunities_pending_enabled TINYINT(1) NOT NULL DEFAULT 0,
        created_by_user_id BIGINT UNSIGNED NULL,
        updated_by_user_id BIGINT UNSIGNED NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        CONSTRAINT uq_temporary_feature_settings_singleton UNIQUE (singleton_key),
        CONSTRAINT fk_temporary_feature_settings_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_temporary_feature_settings_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      )`,
    ).catch((error) => {
      ensureTemporaryFeatureSettingsTablePromise = undefined;
      throw error;
    });
  }

  await ensureTemporaryFeatureSettingsTablePromise;
}

async function ensureChatbotSettingsTable() {
  if (!ensureChatbotSettingsTablePromise) {
    ensureChatbotSettingsTablePromise = query(
      `CREATE TABLE IF NOT EXISTS chatbot_settings (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        singleton_key VARCHAR(40) NOT NULL,
        request_timeout_ms INT UNSIGNED NOT NULL DEFAULT 60000,
        created_by_user_id BIGINT UNSIGNED NULL,
        updated_by_user_id BIGINT UNSIGNED NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        CONSTRAINT uq_chatbot_settings_singleton UNIQUE (singleton_key),
        CONSTRAINT fk_chatbot_settings_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_chatbot_settings_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      )`,
    ).catch((error) => {
      ensureChatbotSettingsTablePromise = undefined;
      throw error;
    });
  }

  await ensureChatbotSettingsTablePromise;
}

async function ensureAiParametersSchema() {
  if (!ensureAiParametersSchemaPromise) {
    ensureAiParametersSchemaPromise = (async () => {
      await query(
        `CREATE TABLE IF NOT EXISTS ai_parameter_sets (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          singleton_key VARCHAR(40) NOT NULL,
          status VARCHAR(40) NOT NULL DEFAULT 'published',
          published_at DATETIME(3) NULL,
          published_by_user_id BIGINT UNSIGNED NULL,
          created_by_user_id BIGINT UNSIGNED NULL,
          updated_by_user_id BIGINT UNSIGNED NULL,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          CONSTRAINT uq_ai_parameter_sets_singleton UNIQUE (singleton_key),
          CONSTRAINT fk_ai_parameter_sets_published_by FOREIGN KEY (published_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
          CONSTRAINT fk_ai_parameter_sets_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
          CONSTRAINT fk_ai_parameter_sets_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        )`,
      );
      await query(
        `CREATE TABLE IF NOT EXISTS ai_parameter_entries (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          ai_parameter_set_id BIGINT UNSIGNED NOT NULL,
          capability_key VARCHAR(120) NOT NULL,
          title VARCHAR(190) NOT NULL,
          description TEXT NULL,
          is_enabled TINYINT(1) NOT NULL DEFAULT 1,
          model_override VARCHAR(80) NULL,
          timeout_ms INT UNSIGNED NOT NULL DEFAULT 120000,
          system_prompt LONGTEXT NOT NULL,
          user_prompt_template LONGTEXT NOT NULL,
          output_schema_json JSON NULL,
          parameters_json JSON NULL,
          draft_revision_number INT UNSIGNED NULL,
          published_revision_number INT UNSIGNED NULL,
          created_by_user_id BIGINT UNSIGNED NULL,
          updated_by_user_id BIGINT UNSIGNED NULL,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          CONSTRAINT uq_ai_parameter_entries UNIQUE (ai_parameter_set_id, capability_key),
          CONSTRAINT fk_ai_parameter_entries_set FOREIGN KEY (ai_parameter_set_id) REFERENCES ai_parameter_sets(id) ON DELETE CASCADE,
          CONSTRAINT fk_ai_parameter_entries_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
          CONSTRAINT fk_ai_parameter_entries_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        )`,
      );
      await query(
        `CREATE TABLE IF NOT EXISTS ai_parameter_revisions (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          ai_parameter_entry_id BIGINT UNSIGNED NOT NULL,
          revision_number INT UNSIGNED NOT NULL,
          snapshot_json JSON NOT NULL,
          change_summary VARCHAR(500) NULL,
          created_by_user_id BIGINT UNSIGNED NULL,
          created_at DATETIME(3) NOT NULL,
          CONSTRAINT uq_ai_parameter_revisions UNIQUE (ai_parameter_entry_id, revision_number),
          CONSTRAINT fk_ai_parameter_revisions_entry FOREIGN KEY (ai_parameter_entry_id) REFERENCES ai_parameter_entries(id) ON DELETE CASCADE,
          CONSTRAINT fk_ai_parameter_revisions_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        )`,
      );
    })().catch((error) => {
      ensureAiParametersSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureAiParametersSchemaPromise;
}

async function ensureDefaultCompanyProfile() {
  await ensureCompanyProfileTable();

  const countryRows = await query(
    `SELECT id
     FROM countries
     WHERE iso2 = 'MX'
     ORDER BY id
     LIMIT 1`,
  );
  const countryId = countryRows[0]?.id;
  if (!countryId) {
    return null;
  }

  await query(
    `INSERT INTO company_profile
      (singleton_key, legal_name, commercial_name, tax_id, logo_url,
       address_line1, address_line2, city, state_region, country_id,
       postal_code, email, phone, website, description,
       created_by_user_id, updated_by_user_id, created_at, updated_at)
     VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NOW(3), NOW(3))`,
    [
      "Access Quality S.A. de C.V.",
      "Access Quality",
      "RFC: AQU110118AV2",
      null,
      "Montecito #38, Piso 7, Oficina 1, WTC, Col. Napoles",
      "",
      "Ciudad de Mexico",
      "CDMX",
      Number(countryId),
      "03810",
      "",
      "",
      "",
      "Configuracion institucional inicial",
    ],
  );

  return countryId;
}

async function ensureDefaultTemporaryFeatureSettings() {
  await ensureTemporaryFeatureSettingsTable();
  await query(
    `INSERT INTO temporary_feature_settings
      (singleton_key, accounts_pending_enabled, contacts_pending_enabled,
       opportunities_pending_enabled, created_by_user_id, updated_by_user_id,
       created_at, updated_at)
     SELECT 'default', 0, 0, 0, NULL, NULL, NOW(3), NOW(3)
     WHERE NOT EXISTS (
       SELECT 1
       FROM temporary_feature_settings tfs
       WHERE tfs.singleton_key = 'default'
     )`,
  );
}

async function ensureDefaultChatbotSettings() {
  await ensureChatbotSettingsTable();
  await query(
    `INSERT INTO chatbot_settings
      (singleton_key, request_timeout_ms, created_by_user_id, updated_by_user_id,
       created_at, updated_at)
     SELECT 'default', 60000, NULL, NULL, NOW(3), NOW(3)
     WHERE NOT EXISTS (
       SELECT 1
       FROM chatbot_settings cs
       WHERE cs.singleton_key = 'default'
     )`,
  );
}
async function ensureDefaultAiParameterSettings() {
  await ensureAiParametersSchema();

  await query(
    `INSERT INTO ai_parameter_sets
      (singleton_key, status, published_at, published_by_user_id, created_by_user_id, updated_by_user_id, created_at, updated_at)
     SELECT 'default', 'published', NOW(3), NULL, NULL, NULL, NOW(3), NOW(3)
     WHERE NOT EXISTS (
       SELECT 1
       FROM ai_parameter_sets aps
       WHERE aps.singleton_key = 'default'
     )`,
  );

  const setRows = await query(
    `SELECT id
     FROM ai_parameter_sets
     WHERE singleton_key = 'default'
     LIMIT 1`,
  );
  const setId = Number(setRows[0]?.id || 0);
  if (!setId) return null;

  for (const definition of AI_PARAMETER_CAPABILITY_DEFINITIONS) {
    const existingRows = await query(
      `SELECT id
       FROM ai_parameter_entries
       WHERE ai_parameter_set_id = ?
         AND capability_key = ?
       LIMIT 1`,
      [setId, definition.capabilityKey],
    );
    if (existingRows.length) continue;

    const snapshot = buildDefaultAiParameterEntry(definition.capabilityKey);
    const now = new Date();
    const insertResult = await query(
      `INSERT INTO ai_parameter_entries
        (ai_parameter_set_id, capability_key, title, description, is_enabled,
         model_override, timeout_ms, system_prompt, user_prompt_template,
         output_schema_json, parameters_json, draft_revision_number,
         published_revision_number, created_by_user_id, updated_by_user_id,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, NULL, NULL, ?, ?)`,
      [
        setId,
        definition.capabilityKey,
        snapshot.title,
        snapshot.description || null,
        snapshot.isEnabled ? 1 : 0,
        snapshot.modelOverride || null,
        snapshot.timeoutMs,
        snapshot.systemPrompt,
        snapshot.userPromptTemplate,
        JSON.stringify(snapshot.outputSchema || {}),
        JSON.stringify(snapshot.parameters || {}),
        now,
        now,
      ],
    );
    await query(
      `INSERT INTO ai_parameter_revisions
        (ai_parameter_entry_id, revision_number, snapshot_json, change_summary, created_by_user_id, created_at)
       VALUES (?, 1, ?, 'Configuracion inicial', NULL, ?)`,
      [Number(insertResult.insertId), JSON.stringify(snapshot), now],
    );
  }

  return setId;
}

function buildAddressLines(profile) {
  const lines = [];
  if (profile.addressLine1) lines.push(profile.addressLine1);
  if (profile.addressLine2) lines.push(profile.addressLine2);

  const locality = [profile.city, profile.stateRegion]
    .filter(Boolean)
    .join(", ");
  const localityWithPostal = [
    locality,
    profile.postalCode ? `CP ${profile.postalCode}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  if (localityWithPostal) lines.push(localityWithPostal);
  if (profile.countryName) lines.push(profile.countryName);
  return lines;
}

// ---------------------------------------------------------------------------
// Commercial settings – stage SLA days
// ---------------------------------------------------------------------------

const STAGE_SLA_DEFAULTS = {
  contacto_inicial: 3,
  identificacion_oportunidad: 3,
  desarrollo: 5,
  cotizacion: 5,
  demostracion: 6,
  negociacion: 4,
  waiting: 3,
};

const STAGE_WEIGHT_DEFAULTS = {
  contacto_inicial: 0.05,
  identificacion_oportunidad: 0.1,
  desarrollo: 0.2,
  cotizacion: 0.4,
  demostracion: 0.55,
  negociacion: 0.75,
  waiting: 0.65,
  ganada: 1,
  perdida: 0,
  anulada: 0,
};

const DEFAULT_BUSINESS_TIMEZONE =
  String(config.app?.businessTimezone || "America/Mexico_City").trim() ||
  "America/Mexico_City";

export function isValidIanaTimezone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function normalizeBusinessTimezone(timeZone) {
  const normalized = String(timeZone || "").trim();
  if (!normalized) {
    return DEFAULT_BUSINESS_TIMEZONE;
  }
  return isValidIanaTimezone(normalized)
    ? normalized
    : DEFAULT_BUSINESS_TIMEZONE;
}

function buildFallbackCommercialSettings() {
  return {
    id: null,
    singletonKey: "default",
    businessTimezone: DEFAULT_BUSINESS_TIMEZONE,
    stageSlaMap: { ...STAGE_SLA_DEFAULTS },
    stageWeightMap: { ...STAGE_WEIGHT_DEFAULTS },
    updatedAt: null,
    updatedByUserId: null,
    updatedByUserName: "",
    createdAt: null,
    createdByUserId: null,
    createdByUserName: "",
  };
}

function normalizeCommercialSettingsRow(row) {
  if (!row) {
    return buildFallbackCommercialSettings();
  }

  let stageSlaMap;
  let stageWeightMap;
  try {
    const parsed =
      typeof row.stage_sla_days_json === "string"
        ? JSON.parse(row.stage_sla_days_json)
        : row.stage_sla_days_json;
    stageSlaMap = { ...STAGE_SLA_DEFAULTS };
    if (parsed && typeof parsed === "object") {
      Object.entries(parsed).forEach(([code, days]) => {
        const parsed_days = Number(days);
        if (
          Object.prototype.hasOwnProperty.call(STAGE_SLA_DEFAULTS, code) &&
          Number.isInteger(parsed_days) &&
          parsed_days >= 1 &&
          parsed_days <= 90
        ) {
          stageSlaMap[code] = parsed_days;
        }
      });
    }
  } catch {
    stageSlaMap = { ...STAGE_SLA_DEFAULTS };
  }

  try {
    const parsed =
      typeof row.forecast_stage_weights_json === "string"
        ? JSON.parse(row.forecast_stage_weights_json)
        : row.forecast_stage_weights_json;
    stageWeightMap = { ...STAGE_WEIGHT_DEFAULTS };
    if (parsed && typeof parsed === "object") {
      Object.entries(parsed).forEach(([code, weight]) => {
        const parsedWeight = Number(weight);
        if (
          Object.prototype.hasOwnProperty.call(STAGE_WEIGHT_DEFAULTS, code) &&
          Number.isFinite(parsedWeight) &&
          parsedWeight >= 0 &&
          parsedWeight <= 1
        ) {
          stageWeightMap[code] = parsedWeight;
        }
      });
    }
  } catch {
    stageWeightMap = { ...STAGE_WEIGHT_DEFAULTS };
  }

  return {
    id: Number(row.id),
    singletonKey: String(row.singleton_key || "default"),
    businessTimezone: normalizeBusinessTimezone(row.business_timezone),
    stageSlaMap,
    stageWeightMap,
    updatedAt: row.updated_at || null,
    updatedByUserId: row.updated_by_user_id
      ? Number(row.updated_by_user_id)
      : null,
    updatedByUserName: String(row.updated_by_user_name || ""),
    createdAt: row.created_at || null,
    createdByUserId: row.created_by_user_id
      ? Number(row.created_by_user_id)
      : null,
    createdByUserName: String(row.created_by_user_name || ""),
  };
}

async function ensureCommercialSettingsTable() {
  if (!ensureCommercialSettingsTablePromise) {
    ensureCommercialSettingsTablePromise = query(
      `CREATE TABLE IF NOT EXISTS commercial_settings (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        singleton_key VARCHAR(40) NOT NULL,
        business_timezone VARCHAR(80) NOT NULL,
        stage_sla_days_json JSON NOT NULL,
        forecast_stage_weights_json JSON NOT NULL,
        created_by_user_id BIGINT UNSIGNED NULL,
        updated_by_user_id BIGINT UNSIGNED NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        CONSTRAINT uq_commercial_settings_singleton UNIQUE (singleton_key),
        CONSTRAINT fk_commercial_settings_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_commercial_settings_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      )`,
    ).catch((error) => {
      ensureCommercialSettingsTablePromise = undefined;
      throw error;
    });
  }

  await ensureCommercialSettingsTablePromise;
  await ensureTableColumn(
    "commercial_settings",
    "business_timezone",
    "ADD COLUMN business_timezone VARCHAR(80) NOT NULL DEFAULT 'America/Mexico_City' AFTER singleton_key",
  );
  await ensureTableColumn(
    "commercial_settings",
    "forecast_stage_weights_json",
    "ADD COLUMN forecast_stage_weights_json JSON NOT NULL AFTER stage_sla_days_json",
  );
}

async function ensureDefaultCommercialSettings() {
  await ensureCommercialSettingsTable();
  await query(
    `INSERT INTO commercial_settings
      (singleton_key, business_timezone, stage_sla_days_json, forecast_stage_weights_json,
       created_by_user_id, updated_by_user_id,
       created_at, updated_at)
     SELECT 'default', ?, ?, ?, NULL, NULL, NOW(3), NOW(3)
     WHERE NOT EXISTS (
       SELECT 1 FROM commercial_settings WHERE singleton_key = 'default'
     )`,
    [
      DEFAULT_BUSINESS_TIMEZONE,
      JSON.stringify(STAGE_SLA_DEFAULTS),
      JSON.stringify(STAGE_WEIGHT_DEFAULTS),
    ],
  );
}

export async function getCommercialSettings() {
  await ensureCommercialSettingsTable();

  const selectSettings = () =>
    query(
      `SELECT cs.*, uc.full_name AS created_by_user_name,
              uu.full_name AS updated_by_user_name
       FROM commercial_settings cs
       LEFT JOIN users uc ON uc.id = cs.created_by_user_id
       LEFT JOIN users uu ON uu.id = cs.updated_by_user_id
       WHERE cs.singleton_key = 'default'
       LIMIT 1`,
    );

  let rows = await selectSettings();
  if (!rows.length) {
    await ensureDefaultCommercialSettings();
    rows = await selectSettings();
  }

  return normalizeCommercialSettingsRow(rows[0] || null);
}

export async function saveCommercialSettings(settings, actorUserId) {
  const current = await getCommercialSettings();
  const existingId = current.id ? Number(current.id) : null;
  const now = new Date();
  const nextBusinessTimezone = normalizeBusinessTimezone(
    settings?.businessTimezone || current.businessTimezone,
  );

  const nextSlaMap = { ...STAGE_SLA_DEFAULTS };
  const nextStageWeightMap = { ...STAGE_WEIGHT_DEFAULTS };
  if (settings.stageSlaMap && typeof settings.stageSlaMap === "object") {
    Object.entries(settings.stageSlaMap).forEach(([code, days]) => {
      const parsed = Number(days);
      if (
        Object.prototype.hasOwnProperty.call(STAGE_SLA_DEFAULTS, code) &&
        Number.isInteger(parsed) &&
        parsed >= 1 &&
        parsed <= 90
      ) {
        nextSlaMap[code] = parsed;
      }
    });
  }
  if (settings.stageWeightMap && typeof settings.stageWeightMap === "object") {
    Object.entries(settings.stageWeightMap).forEach(([code, weight]) => {
      const parsed = Number(weight);
      if (
        Object.prototype.hasOwnProperty.call(STAGE_WEIGHT_DEFAULTS, code) &&
        Number.isFinite(parsed) &&
        parsed >= 0 &&
        parsed <= 1
      ) {
        nextStageWeightMap[code] = parsed;
      }
    });
  }

  if (existingId) {
    await query(
      `UPDATE commercial_settings
       SET business_timezone = ?,
           stage_sla_days_json = ?, forecast_stage_weights_json = ?,
           updated_by_user_id = ?, updated_at = ?
       WHERE id = ?`,
      [
        nextBusinessTimezone,
        JSON.stringify(nextSlaMap),
        JSON.stringify(nextStageWeightMap),
        actorUserId || null,
        now,
        existingId,
      ],
    );
  } else {
    await query(
      `INSERT INTO commercial_settings
        (singleton_key, business_timezone, stage_sla_days_json, forecast_stage_weights_json,
         created_by_user_id, updated_by_user_id,
         created_at, updated_at)
       VALUES ('default', ?, ?, ?, ?, ?, ?, ?)`,
      [
        nextBusinessTimezone,
        JSON.stringify(nextSlaMap),
        JSON.stringify(nextStageWeightMap),
        actorUserId || null,
        actorUserId || null,
        now,
        now,
      ],
    );
  }

  return getCommercialSettings();
}

export { STAGE_SLA_DEFAULTS, STAGE_WEIGHT_DEFAULTS };

export async function getCompanyProfile() {
  await ensureCompanyProfileTable();

  const selectProfile = () =>
    query(
      `SELECT cp.*, c.iso2 AS country_code, c.name AS country_name,
              uc.full_name AS created_by_user_name,
              uu.full_name AS updated_by_user_name
       FROM company_profile cp
       INNER JOIN countries c ON c.id = cp.country_id
       LEFT JOIN users uc ON uc.id = cp.created_by_user_id
       LEFT JOIN users uu ON uu.id = cp.updated_by_user_id
       WHERE cp.singleton_key = 'default'
       LIMIT 1`,
    );

  let rows = await selectProfile();
  if (!rows.length) {
    await ensureDefaultCompanyProfile();
    rows = await selectProfile();
  }

  return normalizeCompanyProfileRow(rows[0] || null);
}

export async function getTemporaryFeatureSettings() {
  await ensureTemporaryFeatureSettingsTable();

  const selectSettings = () =>
    query(
      `SELECT tfs.*, uc.full_name AS created_by_user_name,
              uu.full_name AS updated_by_user_name
       FROM temporary_feature_settings tfs
       LEFT JOIN users uc ON uc.id = tfs.created_by_user_id
       LEFT JOIN users uu ON uu.id = tfs.updated_by_user_id
       WHERE tfs.singleton_key = 'default'
       LIMIT 1`,
    );

  let rows = await selectSettings();
  if (!rows.length) {
    await ensureDefaultTemporaryFeatureSettings();
    rows = await selectSettings();
  }

  return normalizeTemporaryFeatureSettingsRow(rows[0] || null);
}

export async function getChatbotSettings() {
  await ensureChatbotSettingsTable();

  const selectSettings = () =>
    query(
      `SELECT cs.*, uc.full_name AS created_by_user_name,
              uu.full_name AS updated_by_user_name
       FROM chatbot_settings cs
       LEFT JOIN users uc ON uc.id = cs.created_by_user_id
       LEFT JOIN users uu ON uu.id = cs.updated_by_user_id
       WHERE cs.singleton_key = 'default'
       LIMIT 1`,
    );

  let rows = await selectSettings();
  if (!rows.length) {
    await ensureDefaultChatbotSettings();
    rows = await selectSettings();
  }

  return normalizeChatbotSettingsRow(rows[0] || null);
}

export async function saveChatbotSettings(settings, actorUserId) {
  const current = await getChatbotSettings();
  const existingId = current.id ? Number(current.id) : null;
  const now = new Date();
  const payload = {
    requestTimeoutMs: Math.max(
      5000,
      Number(settings.requestTimeoutMs || current.requestTimeoutMs || 60000),
    ),
  };

  if (existingId) {
    await query(
      `UPDATE chatbot_settings
       SET request_timeout_ms = ?, updated_by_user_id = ?, updated_at = ?
       WHERE id = ?`,
      [payload.requestTimeoutMs, actorUserId || null, now, existingId],
    );
  } else {
    await query(
      `INSERT INTO chatbot_settings
        (singleton_key, request_timeout_ms, created_by_user_id, updated_by_user_id,
         created_at, updated_at)
       VALUES ('default', ?, ?, ?, ?, ?)`,
      [
        payload.requestTimeoutMs,
        actorUserId || null,
        actorUserId || null,
        now,
        now,
      ],
    );
  }

  return getChatbotSettings();
}

export async function saveTemporaryFeatureSettings(settings, actorUserId) {
  const current = await getTemporaryFeatureSettings();
  const existingId = current.id ? Number(current.id) : null;
  const now = new Date();
  const payload = {
    accountsPendingEnabled: settings.accountsPendingEnabled ? 1 : 0,
    contactsPendingEnabled: settings.contactsPendingEnabled ? 1 : 0,
    opportunitiesPendingEnabled: settings.opportunitiesPendingEnabled ? 1 : 0,
  };

  if (existingId) {
    await query(
      `UPDATE temporary_feature_settings
       SET accounts_pending_enabled = ?, contacts_pending_enabled = ?,
           opportunities_pending_enabled = ?, updated_by_user_id = ?, updated_at = ?
       WHERE id = ?`,
      [
        payload.accountsPendingEnabled,
        payload.contactsPendingEnabled,
        payload.opportunitiesPendingEnabled,
        actorUserId || null,
        now,
        existingId,
      ],
    );
  } else {
    await query(
      `INSERT INTO temporary_feature_settings
        (singleton_key, accounts_pending_enabled, contacts_pending_enabled,
         opportunities_pending_enabled, created_by_user_id, updated_by_user_id,
         created_at, updated_at)
       VALUES ('default', ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.accountsPendingEnabled,
        payload.contactsPendingEnabled,
        payload.opportunitiesPendingEnabled,
        actorUserId || null,
        actorUserId || null,
        now,
        now,
      ],
    );
  }

  return getTemporaryFeatureSettings();
}

async function getDefaultAiParameterSetId(executor = query) {
  await ensureDefaultAiParameterSettings();
  const rows = await executeQuery(
    executor,
    `SELECT id
     FROM ai_parameter_sets
     WHERE singleton_key = 'default'
     LIMIT 1`,
  );
  return Number(rows[0]?.id || 0);
}

function buildAiParameterEntrySnapshot(payload) {
  return normalizeAiParameterEntrySnapshot(payload, payload?.capabilityKey);
}

async function getAiParameterEntryRow(capabilityKey, executor = query) {
  const setId = await getDefaultAiParameterSetId(executor);
  if (!setId) return null;
  const rows = await executeQuery(
    executor,
    `SELECT ape.*, uc.full_name AS created_by_user_name,
            uu.full_name AS updated_by_user_name
     FROM ai_parameter_entries ape
     LEFT JOIN users uc ON uc.id = ape.created_by_user_id
     LEFT JOIN users uu ON uu.id = ape.updated_by_user_id
     WHERE ape.ai_parameter_set_id = ?
       AND ape.capability_key = ?
     LIMIT 1`,
    [setId, capabilityKey],
  );
  return rows[0] || null;
}

async function getAiParameterRevisionRow(
  entryId,
  revisionNumber,
  executor = query,
) {
  const rows = await executeQuery(
    executor,
    `SELECT apr.*, u.full_name AS created_by_user_name
     FROM ai_parameter_revisions apr
     LEFT JOIN users u ON u.id = apr.created_by_user_id
     WHERE apr.ai_parameter_entry_id = ?
       AND apr.revision_number = ?
     LIMIT 1`,
    [Number(entryId), Number(revisionNumber)],
  );
  return rows[0] || null;
}

async function updateAiParameterSetStatus(actorUserId, executor = query) {
  const setId = await getDefaultAiParameterSetId(executor);
  if (!setId) return null;
  const draftRows = await executeQuery(
    executor,
    `SELECT COUNT(*) AS count
     FROM ai_parameter_entries
     WHERE ai_parameter_set_id = ?
       AND COALESCE(draft_revision_number, 0) <> COALESCE(published_revision_number, 0)`,
    [setId],
  );
  const hasDrafts = Number(draftRows[0]?.count || 0) > 0;
  await executeQuery(
    executor,
    `UPDATE ai_parameter_sets
     SET status = ?, updated_at = NOW(3), updated_by_user_id = ?
     WHERE id = ?`,
    [hasDrafts ? "draft" : "published", actorUserId || null, setId],
  );
  return hasDrafts ? "draft" : "published";
}

export async function getAiParametersConfiguration() {
  await ensureDefaultAiParameterSettings();
  const setRows = await query(
    `SELECT aps.*, up.full_name AS published_by_user_name,
            uc.full_name AS created_by_user_name,
            uu.full_name AS updated_by_user_name
     FROM ai_parameter_sets aps
     LEFT JOIN users up ON up.id = aps.published_by_user_id
     LEFT JOIN users uc ON uc.id = aps.created_by_user_id
     LEFT JOIN users uu ON uu.id = aps.updated_by_user_id
     WHERE aps.singleton_key = 'default'
     LIMIT 1`,
  );
  const setRow = setRows[0] || null;
  if (!setRow) {
    return {
      status: "published",
      publishedAt: null,
      publishedByUserId: null,
      publishedByUserName: "",
      updatedAt: null,
      updatedByUserId: null,
      updatedByUserName: "",
      entries: [],
      capabilities: AI_PARAMETER_CAPABILITY_DEFINITIONS.map((definition) => ({
        capabilityKey: definition.capabilityKey,
        title: definition.title,
        description: definition.description,
      })),
    };
  }

  const entryRows = await query(
    `SELECT ape.*, uc.full_name AS created_by_user_name,
            uu.full_name AS updated_by_user_name
     FROM ai_parameter_entries ape
     LEFT JOIN users uc ON uc.id = ape.created_by_user_id
     LEFT JOIN users uu ON uu.id = ape.updated_by_user_id
     WHERE ape.ai_parameter_set_id = ?
     ORDER BY ape.capability_key ASC`,
    [Number(setRow.id)],
  );

  const publishedRevisionRows = await query(
    `SELECT ape.capability_key, apr.snapshot_json
     FROM ai_parameter_entries ape
     INNER JOIN ai_parameter_revisions apr
       ON apr.ai_parameter_entry_id = ape.id
      AND apr.revision_number = ape.published_revision_number
     WHERE ape.ai_parameter_set_id = ?`,
    [Number(setRow.id)],
  );
  const publishedByCapability = new Map(
    publishedRevisionRows.map((row) => [
      asText(row.capability_key),
      safeParseJson(row.snapshot_json, {}),
    ]),
  );
  const hasDrafts = entryRows.some(
    (row) =>
      Number(row.draft_revision_number || 0) !==
      Number(row.published_revision_number || 0),
  );

  return {
    status: hasDrafts ? "draft" : asText(setRow.status) || "published",
    publishedAt: setRow.published_at || null,
    publishedByUserId: setRow.published_by_user_id
      ? Number(setRow.published_by_user_id)
      : null,
    publishedByUserName: asText(setRow.published_by_user_name),
    updatedAt: setRow.updated_at || null,
    updatedByUserId: setRow.updated_by_user_id
      ? Number(setRow.updated_by_user_id)
      : null,
    updatedByUserName: asText(setRow.updated_by_user_name),
    entries: entryRows.map((row) =>
      normalizeAiParameterEntryRow(
        row,
        publishedByCapability.get(asText(row.capability_key)) || null,
      ),
    ),
    capabilities: AI_PARAMETER_CAPABILITY_DEFINITIONS.map((definition) => ({
      capabilityKey: definition.capabilityKey,
      title: definition.title,
      description: definition.description,
    })),
  };
}

export async function saveAiParameterEntryDraft(
  capabilityKey,
  payload,
  actorUserId,
  changeSummary = "Actualizacion manual",
) {
  await ensureDefaultAiParameterSettings();
  await withTransaction(async (conn) => {
    const entryRow = await getAiParameterEntryRow(capabilityKey, conn);
    if (!entryRow) {
      throw new Error(`AI parameter capability not found: ${capabilityKey}`);
    }
    const snapshot = buildAiParameterEntrySnapshot({
      capabilityKey,
      ...payload,
    });
    const nextRevisionRows = await executeQuery(
      conn,
      `SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_revision
       FROM ai_parameter_revisions
       WHERE ai_parameter_entry_id = ?`,
      [Number(entryRow.id)],
    );
    const nextRevisionNumber = Number(nextRevisionRows[0]?.next_revision || 1);
    const now = new Date();

    await executeQuery(
      conn,
      `INSERT INTO ai_parameter_revisions
        (ai_parameter_entry_id, revision_number, snapshot_json, change_summary, created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        Number(entryRow.id),
        nextRevisionNumber,
        JSON.stringify(snapshot),
        asText(changeSummary) || "Actualizacion manual",
        actorUserId || null,
        now,
      ],
    );

    await executeQuery(
      conn,
      `UPDATE ai_parameter_entries
       SET title = ?, description = ?, is_enabled = ?, model_override = ?, timeout_ms = ?,
           system_prompt = ?, user_prompt_template = ?, output_schema_json = ?, parameters_json = ?,
           draft_revision_number = ?, updated_by_user_id = ?, updated_at = ?
       WHERE id = ?`,
      [
        snapshot.title,
        snapshot.description || null,
        snapshot.isEnabled ? 1 : 0,
        snapshot.modelOverride || null,
        snapshot.timeoutMs,
        snapshot.systemPrompt,
        snapshot.userPromptTemplate,
        JSON.stringify(snapshot.outputSchema || {}),
        JSON.stringify(snapshot.parameters || {}),
        nextRevisionNumber,
        actorUserId || null,
        now,
        Number(entryRow.id),
      ],
    );

    await updateAiParameterSetStatus(actorUserId, conn);
  });

  return getAiParametersConfiguration();
}

export async function publishAiParameterConfiguration(actorUserId) {
  await ensureDefaultAiParameterSettings();
  await withTransaction(async (conn) => {
    const setId = await getDefaultAiParameterSetId(conn);
    const now = new Date();
    await executeQuery(
      conn,
      `UPDATE ai_parameter_entries
       SET published_revision_number = draft_revision_number,
           updated_by_user_id = ?,
           updated_at = ?
       WHERE ai_parameter_set_id = ?`,
      [actorUserId || null, now, setId],
    );
    await executeQuery(
      conn,
      `UPDATE ai_parameter_sets
       SET status = 'published', published_at = ?, published_by_user_id = ?,
           updated_at = ?, updated_by_user_id = ?
       WHERE id = ?`,
      [now, actorUserId || null, now, actorUserId || null, setId],
    );
  });

  return getAiParametersConfiguration();
}

export async function listAiParameterEntryRevisions(capabilityKey) {
  await ensureDefaultAiParameterSettings();
  const entryRow = await getAiParameterEntryRow(capabilityKey);
  if (!entryRow) return [];
  const revisionRows = await query(
    `SELECT apr.*, ape.capability_key, u.full_name AS created_by_user_name
     FROM ai_parameter_revisions apr
     INNER JOIN ai_parameter_entries ape ON ape.id = apr.ai_parameter_entry_id
     LEFT JOIN users u ON u.id = apr.created_by_user_id
     WHERE apr.ai_parameter_entry_id = ?
     ORDER BY apr.revision_number DESC, apr.id DESC`,
    [Number(entryRow.id)],
  );
  return revisionRows.map((row) =>
    normalizeAiParameterRevisionRow(
      row,
      Number(row.revision_number) ===
        Number(entryRow.published_revision_number || 0),
    ),
  );
}

export async function restoreAiParameterEntryRevision(
  capabilityKey,
  revisionNumber,
  actorUserId,
) {
  await ensureDefaultAiParameterSettings();
  const entryRow = await getAiParameterEntryRow(capabilityKey);
  if (!entryRow) {
    throw new Error(`AI parameter capability not found: ${capabilityKey}`);
  }
  const revisionRow = await getAiParameterRevisionRow(
    Number(entryRow.id),
    Number(revisionNumber),
  );
  if (!revisionRow) {
    throw new Error(`AI parameter revision not found: ${revisionNumber}`);
  }
  const snapshot = normalizeAiParameterEntrySnapshot(
    safeParseJson(revisionRow.snapshot_json, {}),
    capabilityKey,
  );
  return saveAiParameterEntryDraft(
    capabilityKey,
    snapshot,
    actorUserId,
    `Restauracion desde revision ${revisionNumber}`,
  );
}

export async function getPublishedAiParameterEntryByCapabilityKey(
  capabilityKey,
) {
  await ensureDefaultAiParameterSettings();
  const entryRow = await getAiParameterEntryRow(capabilityKey);
  if (!entryRow) {
    return buildDefaultAiParameterEntry(capabilityKey);
  }
  if (!entryRow.published_revision_number) {
    return (
      normalizeAiParameterEntryRow(entryRow).published ||
      normalizeAiParameterEntryRow(entryRow)
    );
  }
  const revisionRow = await getAiParameterRevisionRow(
    Number(entryRow.id),
    Number(entryRow.published_revision_number),
  );
  const snapshot = normalizeAiParameterEntrySnapshot(
    safeParseJson(revisionRow?.snapshot_json, {}),
    capabilityKey,
  );
  return {
    capabilityKey: snapshot.capabilityKey,
    title: snapshot.title,
    description: snapshot.description,
    isEnabled: snapshot.isEnabled,
    modelOverride: snapshot.modelOverride,
    timeoutMs: snapshot.timeoutMs,
    systemPrompt: snapshot.systemPrompt,
    userPromptTemplate: snapshot.userPromptTemplate,
    outputSchema: snapshot.outputSchema,
    parameters: snapshot.parameters,
    publishedRevisionNumber:
      Number(entryRow.published_revision_number || 0) || null,
  };
}

export function buildCompanyDocumentBranding(profile) {
  const safeProfile = profile || buildFallbackCompanyProfile();
  return {
    logoUrl: asText(safeProfile.logoUrl),
    legalName: asText(safeProfile.legalName),
    commercialName: asText(safeProfile.commercialName),
    taxId: asText(safeProfile.taxId),
    addressLines: buildAddressLines(safeProfile),
    email: asText(safeProfile.email),
    phone: asText(safeProfile.phone),
  };
}

export async function getCompanyDocumentBranding() {
  return buildCompanyDocumentBranding(await getCompanyProfile());
}
