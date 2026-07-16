import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "../api";
import { formatBusinessDateTime } from "../business-timezone";
import { DEFAULT_CAMPAIGN_MATRIX_ROWS } from "./campaignMatrixDefaults";

const DEFAULT_SELECTED_AI_CAPABILITY_KEY = "proposal.executive_summary";

const EMPTY_FORM = {
  legalName: "",
  commercialName: "",
  taxId: "",
  logoUrl: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  stateRegion: "",
  countryId: "",
  postalCode: "",
  email: "",
  phone: "",
  website: "",
  description: "",
};

const EMPTY_TEMPORARY_FEATURE_SETTINGS = {
  accountsPendingEnabled: false,
  contactsPendingEnabled: false,
  opportunitiesPendingEnabled: false,
  updatedAt: null,
  updatedByUserName: "",
};

const EMPTY_CHATBOT_SETTINGS = {
  requestTimeoutMs: 60000,
  updatedAt: null,
  updatedByUserName: "",
};

const STAGE_SLA_ENTRIES = [
  { code: "contacto_inicial", label: "Contacto inicial" },
  {
    code: "identificacion_oportunidad",
    label: "Identificación de oportunidad",
  },
  { code: "desarrollo", label: "Desarrollo" },
  { code: "cotizacion", label: "Cotización" },
  { code: "demostracion", label: "Demostración" },
  { code: "negociacion", label: "Negociación" },
  { code: "waiting", label: "En espera" },
];

const STAGE_WEIGHT_ENTRIES = [
  { code: "contacto_inicial", label: "Contacto inicial" },
  {
    code: "identificacion_oportunidad",
    label: "Identificación de oportunidad",
  },
  { code: "desarrollo", label: "Desarrollo" },
  { code: "cotizacion", label: "Cotización" },
  { code: "demostracion", label: "Demostración" },
  { code: "negociacion", label: "Negociación" },
  { code: "waiting", label: "En espera" },
  { code: "ganada", label: "Ganada" },
  { code: "perdida", label: "Perdida" },
  { code: "anulada", label: "Anulada" },
];

const DEFAULT_STAGE_SLA_MAP = {
  contacto_inicial: 3,
  identificacion_oportunidad: 3,
  desarrollo: 5,
  cotizacion: 5,
  demostracion: 6,
  negociacion: 4,
  waiting: 3,
};

const DEFAULT_STAGE_WEIGHT_MAP = {
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

const LEAD_EXECUTION_GUIDE_ENTRIES = [
  { key: "company_intro", label: "Presentación de la empresa" },
  {
    key: "expectation_confirmation",
    label: "Confirmación de expectativas del prospecto",
  },
  {
    key: "solution_presentation_start",
    label: "Inicio de presentación de la solución",
  },
  {
    key: "pain_focus",
    label: "Enfoque en dolor, reto o situación",
  },
  { key: "problem_resolution", label: "Cómo resolvemos el problema" },
  { key: "key_points", label: "Puntos clave de la solución" },
  { key: "conclusion", label: "Conclusión de la presentación" },
  { key: "storytelling", label: "Historias entre secciones" },
  {
    key: "demo_offer",
    label: "Oferta de demostración y reunión técnica",
  },
  { key: "next_meeting", label: "Definir fecha de siguiente reunión" },
];

const DEFAULT_LEAD_EXECUTION_GUIDES = {
  company_intro:
    "Indicar que la empresa tiene 15 años en el mercado mexicano y que somos parte de un grupo de empresas ubicadas en Peru, Chile y Mexico con un total de mas de 900 personas. En Mexico somos partners principales de las marcas F5 y Bluecat y contamos con ingenieros certificados y con mucha experiencia en estos dos fabricantes.",
  expectation_confirmation:
    "Si el prospecto indicó expectativas para esta reunion, confírmalas para alinearte con el. Si no las indicó, explica que presentaremos nuestras soluciones y que podemos profundizar en la que le haga mas sentido.",
  solution_presentation_start:
    "Inicia la presentacion con el contexto de la solucion seleccionada y valida que el enfoque siga alineado con la prioridad del prospecto.",
  pain_focus:
    "Enfoca los primeros slides en el dolor, reto o problema principal del prospecto. Esta es la parte mas importante para que el resto de la presentacion tenga sentido.",
  problem_resolution:
    "Explica de forma clara como resolvemos el problema, reto o dolor identificado y por que nuestro enfoque reduce riesgo o friccion.",
  key_points:
    "Muestra de dos a tres puntos clave de valor de la solucion. Evita saturar con demasiados detalles tecnicos en esta etapa.",
  conclusion:
    "Cierra resumiendo el dolor identificado, la solucion propuesta y los puntos clave de valor para confirmar entendimiento compartido.",
  storytelling:
    "Despues de cada bloque, cuenta una historia breve o caso real para mantener interes y aterrizar el valor en un contexto cercano al cliente.",
  demo_offer:
    "Ofrece una demostracion y solicita una reunion mas tecnica para profundizar. Sugiere invitar personal tecnico del prospecto.",
  next_meeting:
    "Define fecha y hora de la siguiente reunion antes de cerrar la conversacion y confirma responsables de seguimiento.",
};
const EMPTY_CAMPAIGN_MATRIX_ROW = {
  id: "",
  campaignType: "reconocimiento",
  priority: "prioritaria",
  campaignSubtype: "correo_masivo",
  emailType: "correo_masivo",
  exampleEmail: "",
  operationalRequirement: "",
};

const EMPTY_COMMERCIAL_SETTINGS = {
  businessTimezone: "America/Mexico_City",
  sellerLeagueScreenDisplayMinutes: 1,
  sellerLeagueScreenRotationMinutes: 1,
  stageSlaMap: { ...DEFAULT_STAGE_SLA_MAP },
  stageWeightMap: { ...DEFAULT_STAGE_WEIGHT_MAP },
  leadExecutionGuides: { ...DEFAULT_LEAD_EXECUTION_GUIDES },
  campaignMatrixRows: [...DEFAULT_CAMPAIGN_MATRIX_ROWS],
  updatedAt: null,
  updatedByUserName: "",
};

const EMPTY_CAMPAIGN_MATRIX_CATALOGS = {
  campaignTypes: [],
  priorities: [],
  campaignSubtypes: [],
  emailTypes: [],
};

function createCampaignMatrixRowId() {
  return `campaign_matrix_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeCampaignMatrixRows(rows) {
  const source = Array.isArray(rows) ? rows : [];
  const normalized = source
    .map((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        return null;
      }
      const campaignType = String(row.campaignType || "").trim();
      const priority = String(row.priority || "").trim();
      const campaignSubtype = String(row.campaignSubtype || "").trim();
      const emailType = String(row.emailType || "").trim();
      if (!campaignType || !priority || !campaignSubtype || !emailType) {
        return null;
      }

      return {
        id:
          String(row.id || "").trim() ||
          `campaign_matrix_${String(index + 1).padStart(3, "0")}`,
        campaignType,
        priority,
        campaignSubtype,
        emailType,
        exampleEmail: String(row.exampleEmail || ""),
        operationalRequirement: String(row.operationalRequirement || ""),
      };
    })
    .filter(Boolean);

  if (normalized.length > 0) {
    return normalized;
  }

  return DEFAULT_CAMPAIGN_MATRIX_ROWS.map((row) => ({ ...row }));
}

function normalizeCampaignMatrixCatalogs(catalogs) {
  return {
    campaignTypes: Array.isArray(catalogs?.campaignTypes)
      ? catalogs.campaignTypes
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [],
    priorities: Array.isArray(catalogs?.priorities)
      ? catalogs.priorities
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [],
    campaignSubtypes: Array.isArray(catalogs?.campaignSubtypes)
      ? catalogs.campaignSubtypes
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [],
    emailTypes: Array.isArray(catalogs?.emailTypes)
      ? catalogs.emailTypes
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [],
  };
}

const EMPTY_PROPOSAL_CONTENT_CONFIG = {
  id: null,
  status: "active",
  publishedAt: null,
  updatedAt: null,
  components: [],
};

const EMPTY_PROPOSAL_CONTENT_COMPONENT = {
  id: null,
  componentCode: "",
  title: "",
  displayOrder: 0,
  status: "active",
  componentKind: "custom",
  isRequired: false,
  isVisible: true,
  aiEnabled: false,
  aiMode: null,
  aiCapabilityKey: null,
  aiSettings: null,
  layoutConfig: null,
  resolvedLayoutMode: "stack",
  blocks: [],
};

const EMPTY_AI_PARAMETER_ENTRY = {
  capabilityKey: "proposal.executive_summary",
  title: "Resumen ejecutivo",
  description: "",
  isEnabled: true,
  modelOverride: "",
  timeoutMs: 120000,
  systemPrompt: "",
  userPromptTemplate: "{context, expectedShape}",
  outputSchema: {
    title: "string",
    paragraphs: ["string"],
    warnings: ["string"],
  },
  parameters: {
    maxLibraryAssets: 4,
    allowInstructionsField: true,
    defaultLanguageCode: "es",
    supportedLibraryContentModes: ["source_text", "summary_extract"],
    supportedSourcePriorityModes: [
      "non_library_first",
      "balanced",
      "library_first",
    ],
    targetAudience: "client",
    allowOverwrite: false,
  },
  draftRevisionNumber: null,
  publishedRevisionNumber: null,
  published: null,
  updatedAt: null,
  updatedByUserName: "",
};

const EMPTY_AI_PARAMETERS_CONFIG = {
  status: "published",
  publishedAt: null,
  publishedByUserName: "",
  updatedAt: null,
  updatedByUserName: "",
  capabilities: [
    {
      capabilityKey: "proposal.executive_summary",
      title: "Resumen ejecutivo",
      description:
        "Generación del resumen ejecutivo comercial para propuestas.",
    },
    {
      capabilityKey: "proposal.background",
      title: "Antecedentes",
      description: "Generación de la sección de antecedentes para propuestas.",
    },
    {
      capabilityKey: "proposal.generic_section",
      title: "Sección genérica",
      description:
        "Generación genérica de contenido para secciónes de propuestas.",
    },
  ],
  entries: [
    EMPTY_AI_PARAMETER_ENTRY,
    {
      ...EMPTY_AI_PARAMETER_ENTRY,
      capabilityKey: "proposal.background",
      title: "Antecedentes",
      description: "",
    },
    {
      ...EMPTY_AI_PARAMETER_ENTRY,
      capabilityKey: "proposal.generic_section",
      title: "Sección genérica",
      description: "",
    },
  ],
};

function normalizeInstitutionalAsset(asset) {
  if (!asset) return null;
  return {
    id: Number(asset.id),
    code: String(asset.code || ""),
    name: String(asset.name || ""),
    description: String(asset.description || ""),
    category: String(asset.category || "generic_proposal_media"),
    mediaType: String(asset.mediaType || "image"),
    status: String(asset.status || "active"),
    tags: Array.isArray(asset.tags) ? asset.tags : [],
    currentVersionId: asset.currentVersionId
      ? Number(asset.currentVersionId)
      : null,
    currentVersion: asset.currentVersion
      ? {
          id: Number(asset.currentVersion.id),
          versionNumber: Number(asset.currentVersion.versionNumber || 1),
          fileUrl: String(asset.currentVersion.fileUrl || ""),
          fileName: String(asset.currentVersion.fileName || ""),
          mimeType: String(asset.currentVersion.mimeType || ""),
          fileSizeBytes:
            asset.currentVersion.fileSizeBytes == null
              ? null
              : Number(asset.currentVersion.fileSizeBytes),
          width:
            asset.currentVersion.width == null
              ? null
              : Number(asset.currentVersion.width),
          height:
            asset.currentVersion.height == null
              ? null
              : Number(asset.currentVersion.height),
          altText: String(asset.currentVersion.altText || ""),
          caption: String(asset.currentVersion.caption || ""),
        }
      : null,
    versions: Array.isArray(asset.versions)
      ? asset.versions.map((version) => ({
          id: Number(version.id),
          versionNumber: Number(version.versionNumber || 1),
          fileUrl: String(version.fileUrl || ""),
          fileName: String(version.fileName || ""),
          mimeType: String(version.mimeType || ""),
          altText: String(version.altText || ""),
          caption: String(version.caption || ""),
        }))
      : [],
  };
}

function normalizeProposalContentConfig(config) {
  if (!config) return { ...EMPTY_PROPOSAL_CONTENT_CONFIG };
  return {
    id: config.id ? Number(config.id) : null,
    status: String(config.status || "active"),
    publishedAt: config.publishedAt || null,
    updatedAt: config.updatedAt || null,
    components: Array.isArray(config.components)
      ? config.components.map((component) => ({
          ...EMPTY_PROPOSAL_CONTENT_COMPONENT,
          id: component.id ? Number(component.id) : null,
          componentCode: String(component.componentCode || ""),
          title: String(component.title || ""),
          displayOrder: Number(component.displayOrder || 0),
          status: String(component.status || "active"),
          componentKind: String(component.componentKind || "custom"),
          isRequired: Boolean(component.isRequired),
          isVisible:
            component.isVisible === undefined
              ? true
              : Boolean(component.isVisible),
          aiEnabled: Boolean(component.aiEnabled),
          aiMode: component.aiMode ? String(component.aiMode) : null,
          aiCapabilityKey: component.aiCapabilityKey
            ? String(component.aiCapabilityKey)
            : null,
          aiSettings:
            component.aiSettings && typeof component.aiSettings === "object"
              ? component.aiSettings
              : null,
          layoutConfig: component.layoutConfig || null,
          resolvedLayoutMode: String(component.resolvedLayoutMode || ""),
          blocks: Array.isArray(component.blocks)
            ? component.blocks.map((block) => ({
                id: block.id ? Number(block.id) : null,
                type: String(block.type || "paragraph"),
                text: String(block.text || ""),
                items: Array.isArray(block.items) ? block.items : [],
                assetId: block.assetId ? Number(block.assetId) : null,
                assetVersionId: block.assetVersionId
                  ? Number(block.assetVersionId)
                  : null,
                image: block.image || null,
              }))
            : [],
        }))
      : [],
  };
}

function buildProposalContentComponentPayload(component) {
  return {
    title: String(component?.title || "").trim(),
    componentKind: String(component?.componentKind || "custom"),
    isVisible:
      component?.isVisible === undefined ? true : Boolean(component.isVisible),
    aiEnabled: Boolean(component?.aiEnabled),
    aiMode: component?.aiEnabled
      ? String(component?.aiMode || "").trim() || undefined
      : null,
    aiSettings:
      component?.aiSettings && typeof component.aiSettings === "object"
        ? component.aiSettings
        : null,
    layoutConfig: component?.layoutConfig || null,
    blocks: Array.isArray(component?.blocks) ? component.blocks : [],
  };
}

function normalizeAiParameterEntry(entry) {
  if (!entry) {
    return { ...EMPTY_AI_PARAMETER_ENTRY };
  }
  return {
    capabilityKey: String(
      entry.capabilityKey || EMPTY_AI_PARAMETER_ENTRY.capabilityKey,
    ),
    title: String(entry.title || EMPTY_AI_PARAMETER_ENTRY.title),
    description: String(entry.description || ""),
    isEnabled: entry.isEnabled === undefined ? true : Boolean(entry.isEnabled),
    modelOverride: String(entry.modelOverride || ""),
    timeoutMs:
      entry.timeoutMs == null
        ? EMPTY_AI_PARAMETER_ENTRY.timeoutMs
        : Number(entry.timeoutMs),
    systemPrompt: String(entry.systemPrompt || ""),
    userPromptTemplate: String(
      entry.userPromptTemplate || EMPTY_AI_PARAMETER_ENTRY.userPromptTemplate,
    ),
    outputSchema:
      entry.outputSchema && typeof entry.outputSchema === "object"
        ? entry.outputSchema
        : EMPTY_AI_PARAMETER_ENTRY.outputSchema,
    parameters:
      entry.parameters && typeof entry.parameters === "object"
        ? {
            ...EMPTY_AI_PARAMETER_ENTRY.parameters,
            ...entry.parameters,
          }
        : { ...EMPTY_AI_PARAMETER_ENTRY.parameters },
    draftRevisionNumber:
      entry.draftRevisionNumber == null
        ? null
        : Number(entry.draftRevisionNumber),
    publishedRevisionNumber:
      entry.publishedRevisionNumber == null
        ? null
        : Number(entry.publishedRevisionNumber),
    published: entry.published
      ? {
          ...normalizeAiParameterEntry(entry.published),
          published: null,
        }
      : null,
    updatedAt: entry.updatedAt || null,
    updatedByUserName: String(entry.updatedByUserName || ""),
  };
}

function normalizeAiParametersConfig(config) {
  if (!config) {
    return { ...EMPTY_AI_PARAMETERS_CONFIG };
  }

  const entries = Array.isArray(config.entries)
    ? config.entries.map(normalizeAiParameterEntry)
    : [normalizeAiParameterEntry(null)];

  return {
    status: String(config.status || "published"),
    publishedAt: config.publishedAt || null,
    publishedByUserName: String(config.publishedByUserName || ""),
    updatedAt: config.updatedAt || null,
    updatedByUserName: String(config.updatedByUserName || ""),
    capabilities: Array.isArray(config.capabilities)
      ? config.capabilities.map((item) => ({
          capabilityKey: String(item.capabilityKey || ""),
          title: String(item.title || ""),
          description: String(item.description || ""),
        }))
      : EMPTY_AI_PARAMETERS_CONFIG.capabilities,
    entries,
  };
}

function serializeAiParameterDraft(draft) {
  return JSON.stringify({
    capabilityKey: String(draft?.capabilityKey || ""),
    title: String(draft?.title || "").trim(),
    description: String(draft?.description || "").trim(),
    isEnabled: Boolean(draft?.isEnabled),
    modelOverride: String(draft?.modelOverride || "").trim(),
    timeoutMs: Number(draft?.timeoutMs || 0),
    systemPrompt: String(draft?.systemPrompt || "").trim(),
    userPromptTemplate: String(draft?.userPromptTemplate || "").trim(),
    outputSchema: draft?.outputSchema || {},
    parameters: draft?.parameters || {},
  });
}

function buildAiParameterDraftPayload(draft, changeSummary = "") {
  return {
    title: String(draft?.title || "").trim(),
    description: String(draft?.description || "").trim() || undefined,
    isEnabled: Boolean(draft?.isEnabled),
    modelOverride: String(draft?.modelOverride || "").trim() || undefined,
    timeoutMs: Number(draft?.timeoutMs || 120000),
    systemPrompt: String(draft?.systemPrompt || "").trim(),
    userPromptTemplate: String(draft?.userPromptTemplate || "").trim(),
    outputSchema: draft?.outputSchema || {},
    parameters: draft?.parameters || {},
    changeSummary: String(changeSummary || "").trim() || undefined,
  };
}

const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function validateCompanyProfile(form) {
  const errors = {};

  if (!String(form.legalName || "").trim()) {
    errors.legalName = "La razon social es obligatoria";
  }

  if (!String(form.taxId || "").trim()) {
    errors.taxId = "El registro fiscal es obligatorio";
  }

  if (!String(form.addressLine1 || "").trim()) {
    errors.addressLine1 = "La direccion principal es obligatoria";
  }

  if (!String(form.city || "").trim()) {
    errors.city = "La ciudad es obligatoria";
  }

  if (!String(form.stateRegion || "").trim()) {
    errors.stateRegion = "El estado o región es obligatorio";
  }

  if (!String(form.countryId || "").trim()) {
    errors.countryId = "Selecciona un pais";
  }

  if (!String(form.postalCode || "").trim()) {
    errors.postalCode = "El codigo postal es obligatorio";
  }

  const email = String(form.email || "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Escribe un correo institucional válido";
  }

  const website = String(form.website || "").trim();
  if (website && !isValidHttpUrl(website)) {
    errors.website = "El sitio web debe iniciar con http:// o https://";
  }

  return errors;
}

function normalizeProfileToForm(profile) {
  if (!profile) return EMPTY_FORM;
  return {
    legalName: String(profile.legalName || ""),
    commercialName: String(profile.commercialName || ""),
    taxId: String(profile.taxId || ""),
    logoUrl: String(profile.logoUrl || ""),
    addressLine1: String(profile.addressLine1 || ""),
    addressLine2: String(profile.addressLine2 || ""),
    city: String(profile.city || ""),
    stateRegion: String(profile.stateRegion || ""),
    countryId: profile.countryId ? String(profile.countryId) : "",
    postalCode: String(profile.postalCode || ""),
    email: String(profile.email || ""),
    phone: String(profile.phone || ""),
    website: String(profile.website || ""),
    description: String(profile.description || ""),
  };
}

function serializeForm(form) {
  return JSON.stringify({
    legalName: String(form.legalName || "").trim(),
    commercialName: String(form.commercialName || "").trim(),
    taxId: String(form.taxId || "").trim(),
    logoUrl: String(form.logoUrl || "").trim(),
    addressLine1: String(form.addressLine1 || "").trim(),
    addressLine2: String(form.addressLine2 || "").trim(),
    city: String(form.city || "").trim(),
    stateRegion: String(form.stateRegion || "").trim(),
    countryId: String(form.countryId || "").trim(),
    postalCode: String(form.postalCode || "").trim(),
    email: String(form.email || "").trim(),
    phone: String(form.phone || "").trim(),
    website: String(form.website || "").trim(),
    description: String(form.description || "").trim(),
  });
}

function normalizeTemporaryFeatureSettings(settings) {
  if (!settings) {
    return { ...EMPTY_TEMPORARY_FEATURE_SETTINGS };
  }

  return {
    accountsPendingEnabled: Boolean(settings.accountsPendingEnabled),
    contactsPendingEnabled: Boolean(settings.contactsPendingEnabled),
    opportunitiesPendingEnabled: Boolean(settings.opportunitiesPendingEnabled),
    updatedAt: settings.updatedAt || null,
    updatedByUserName: String(settings.updatedByUserName || ""),
  };
}

function serializeTemporaryFeatureSettings(settings) {
  return JSON.stringify({
    accountsPendingEnabled: Boolean(settings.accountsPendingEnabled),
    contactsPendingEnabled: Boolean(settings.contactsPendingEnabled),
    opportunitiesPendingEnabled: Boolean(settings.opportunitiesPendingEnabled),
  });
}

function deserializeTemporaryFeatureSettingsSnapshot(snapshot) {
  try {
    return normalizeTemporaryFeatureSettings(JSON.parse(snapshot || "null"));
  } catch {
    return { ...EMPTY_TEMPORARY_FEATURE_SETTINGS };
  }
}

function normalizeChatbotSettings(settings) {
  if (!settings) {
    return { ...EMPTY_CHATBOT_SETTINGS };
  }

  return {
    requestTimeoutMs: Math.max(
      5000,
      Number(settings.requestTimeoutMs || 60000),
    ),
    updatedAt: settings.updatedAt || null,
    updatedByUserName: String(settings.updatedByUserName || ""),
  };
}

function serializeChatbotSettings(settings) {
  return JSON.stringify({
    requestTimeoutMs: Number(settings.requestTimeoutMs || 0),
  });
}

function deserializeChatbotSettingsSnapshot(snapshot) {
  try {
    return normalizeChatbotSettings(JSON.parse(snapshot || "null"));
  } catch {
    return { ...EMPTY_CHATBOT_SETTINGS };
  }
}

function normalizeCommercialSettings(settings) {
  if (!settings) {
    return {
      ...EMPTY_COMMERCIAL_SETTINGS,
      stageSlaMap: { ...DEFAULT_STAGE_SLA_MAP },
      stageWeightMap: { ...DEFAULT_STAGE_WEIGHT_MAP },
      leadExecutionGuides: { ...DEFAULT_LEAD_EXECUTION_GUIDES },
    };
  }

  const stageSlaMap = { ...DEFAULT_STAGE_SLA_MAP };
  const stageWeightMap = { ...DEFAULT_STAGE_WEIGHT_MAP };
  const leadExecutionGuides = { ...DEFAULT_LEAD_EXECUTION_GUIDES };
  if (settings.stageSlaMap && typeof settings.stageSlaMap === "object") {
    Object.entries(settings.stageSlaMap).forEach(([code, days]) => {
      const parsed = Number(days);
      if (
        Object.prototype.hasOwnProperty.call(DEFAULT_STAGE_SLA_MAP, code) &&
        Number.isInteger(parsed) &&
        parsed >= 1 &&
        parsed <= 90
      ) {
        stageSlaMap[code] = parsed;
      }
    });
  }
  if (settings.stageWeightMap && typeof settings.stageWeightMap === "object") {
    Object.entries(settings.stageWeightMap).forEach(([code, weight]) => {
      const parsed = Number(weight);
      if (
        Object.prototype.hasOwnProperty.call(DEFAULT_STAGE_WEIGHT_MAP, code) &&
        Number.isFinite(parsed) &&
        parsed >= 0 &&
        parsed <= 1
      ) {
        stageWeightMap[code] = parsed;
      }
    });
  }
  if (
    settings.leadExecutionGuides &&
    typeof settings.leadExecutionGuides === "object"
  ) {
    Object.entries(settings.leadExecutionGuides).forEach(([key, value]) => {
      if (
        Object.prototype.hasOwnProperty.call(DEFAULT_LEAD_EXECUTION_GUIDES, key)
      ) {
        leadExecutionGuides[key] = String(value || "").trim();
      }
    });
  }

  const campaignMatrixRows = normalizeCampaignMatrixRows(
    settings.campaignMatrixRows,
  );

  return {
    businessTimezone:
      String(settings.businessTimezone || "").trim() ||
      EMPTY_COMMERCIAL_SETTINGS.businessTimezone,
    sellerLeagueScreenDisplayMinutes: (() => {
      const parsed = Number(settings.sellerLeagueScreenDisplayMinutes);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 60) {
        return EMPTY_COMMERCIAL_SETTINGS.sellerLeagueScreenDisplayMinutes;
      }
      return parsed;
    })(),
    sellerLeagueScreenRotationMinutes: (() => {
      const parsed = Number(settings.sellerLeagueScreenRotationMinutes);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 60) {
        return EMPTY_COMMERCIAL_SETTINGS.sellerLeagueScreenRotationMinutes;
      }
      return parsed;
    })(),
    stageSlaMap,
    stageWeightMap,
    leadExecutionGuides,
    campaignMatrixRows,
    updatedAt: settings.updatedAt || null,
    updatedByUserName: String(settings.updatedByUserName || ""),
  };
}

function serializeCommercialSettings(settings) {
  return JSON.stringify({
    businessTimezone: String(settings?.businessTimezone || "").trim(),
    sellerLeagueScreenDisplayMinutes: Number(
      settings?.sellerLeagueScreenDisplayMinutes || 1,
    ),
    sellerLeagueScreenRotationMinutes: Number(
      settings?.sellerLeagueScreenRotationMinutes || 1,
    ),
    stageSlaMap: settings?.stageSlaMap || {},
    stageWeightMap: settings?.stageWeightMap || {},
    leadExecutionGuides: settings?.leadExecutionGuides || {},
    campaignMatrixRows: normalizeCampaignMatrixRows(
      settings?.campaignMatrixRows,
    ),
  });
}

function deserializeCommercialSettingsSnapshot(snapshot) {
  try {
    const parsed = JSON.parse(snapshot || "null");
    return normalizeCommercialSettings(parsed);
  } catch {
    return {
      ...EMPTY_COMMERCIAL_SETTINGS,
      stageSlaMap: { ...DEFAULT_STAGE_SLA_MAP },
      stageWeightMap: { ...DEFAULT_STAGE_WEIGHT_MAP },
      leadExecutionGuides: { ...DEFAULT_LEAD_EXECUTION_GUIDES },
    };
  }
}

function formatDateTime(value) {
  return formatBusinessDateTime(value, {
    options: {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    },
    fallback: "Sin cambios registrados",
  });
}

function summarizeChangedFields(changedFields) {
  const entries = Object.entries(changedFields || {});
  if (!entries.length) return "Cambio registrado";
  return entries
    .slice(0, 3)
    .map(([field]) => field)
    .join(", ");
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No fue posible leer la imagen"));
    reader.readAsDataURL(file);
  });
}

export function useConfigurationPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeSection, setActiveSection] = useState("company");
  const [countries, setCountries] = useState([]);
  const [accountTypes, setAccountTypes] = useState([]);
  const [accountTypeDraft, setAccountTypeDraft] = useState({
    name: "",
    code: "",
    description: "",
  });
  const [accountTypeActionKey, setAccountTypeActionKey] = useState("");
  const [economicSectors, setEconomicSectors] = useState([]);
  const [economicSectorDraft, setEconomicSectorDraft] = useState({
    name: "",
    code: "",
    description: "",
  });
  const [economicSectorActionKey, setEconomicSectorActionKey] = useState("");
  const [companyProfile, setCompanyProfile] = useState(null);
  const [temporaryFeatureSettings, setTemporaryFeatureSettings] = useState(
    EMPTY_TEMPORARY_FEATURE_SETTINGS,
  );
  const [chatbotSettings, setChatbotSettings] = useState(
    EMPTY_CHATBOT_SETTINGS,
  );
  const [form, setForm] = useState(EMPTY_FORM);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState(
    serializeForm(EMPTY_FORM),
  );
  const [savingTemporaryFeatures, setSavingTemporaryFeatures] = useState(false);
  const [
    initialTemporaryFeaturesSnapshot,
    setInitialTemporaryFeaturesSnapshot,
  ] = useState(
    serializeTemporaryFeatureSettings(EMPTY_TEMPORARY_FEATURE_SETTINGS),
  );
  const [savingChatbotSettings, setSavingChatbotSettings] = useState(false);
  const [initialChatbotSettingsSnapshot, setInitialChatbotSettingsSnapshot] =
    useState(serializeChatbotSettings(EMPTY_CHATBOT_SETTINGS));
  const [commercialSettings, setCommercialSettings] = useState(
    EMPTY_COMMERCIAL_SETTINGS,
  );
  const [campaignMatrixCatalogs, setCampaignMatrixCatalogs] = useState(
    EMPTY_CAMPAIGN_MATRIX_CATALOGS,
  );
  const [savingCommercialSettings, setSavingCommercialSettings] =
    useState(false);
  const [
    initialCommercialSettingsSnapshot,
    setInitialCommercialSettingsSnapshot,
  ] = useState(serializeCommercialSettings(EMPTY_COMMERCIAL_SETTINGS));
  const [auditEntries, setAuditEntries] = useState([]);
  const [workspacePlaybooks, setWorkspacePlaybooks] = useState([]);
  const [workspacePlaybookDetail, setWorkspacePlaybookDetail] = useState(null);
  const [activatingWorkspaceVersionId, setActivatingWorkspaceVersionId] =
    useState(null);
  const [savingWorkspacePlaybookKey, setSavingWorkspacePlaybookKey] =
    useState("");
  const [proposalContentConfig, setProposalContentConfig] = useState(
    EMPTY_PROPOSAL_CONTENT_CONFIG,
  );
  const [proposalContentLoadError, setProposalContentLoadError] = useState("");
  const [proposalComponentDefinitions, setProposalComponentDefinitions] =
    useState([]);
  const [institutionalAssets, setInstitutionalAssets] = useState([]);
  const [aiParametersConfig, setAiParametersConfig] = useState(
    EMPTY_AI_PARAMETERS_CONFIG,
  );
  const [aiWalletSummaries, setAiWalletSummaries] = useState([]);
  const [aiWalletSummariesLoading, setAiWalletSummariesLoading] =
    useState(true);
  const [aiWalletSummariesError, setAiWalletSummariesError] = useState("");
  const [aiPricingRates, setAiPricingRates] = useState([]);
  const [aiPricingRatesLoading, setAiPricingRatesLoading] = useState(true);
  const [aiPricingRatesError, setAiPricingRatesError] = useState("");
  const [aiPricingActionKey, setAiPricingActionKey] = useState("");
  const [aiPricingSyncPreview, setAiPricingSyncPreview] = useState([]);
  const [selectedAiWalletUserId, setSelectedAiWalletUserId] = useState(null);
  const [selectedAiWalletDetail, setSelectedAiWalletDetail] = useState(null);
  const [selectedAiWalletDetailLoading, setSelectedAiWalletDetailLoading] =
    useState(false);
  const [aiWalletActionKey, setAiWalletActionKey] = useState("");
  const [selectedAiCapabilityKey, setSelectedAiCapabilityKey] = useState(
    DEFAULT_SELECTED_AI_CAPABILITY_KEY,
  );
  const [aiParameterDraft, setAiParameterDraft] = useState(
    EMPTY_AI_PARAMETER_ENTRY,
  );
  const [initialAiParameterSnapshot, setInitialAiParameterSnapshot] = useState(
    serializeAiParameterDraft(EMPTY_AI_PARAMETER_ENTRY),
  );
  const [aiParameterValidationWarnings, setAiParameterValidationWarnings] =
    useState([]);
  const [aiParameterRevisions, setAiParameterRevisions] = useState([]);
  const [savingAiParameters, setSavingAiParameters] = useState(false);
  const [publishingAiParameters, setPublishingAiParameters] = useState(false);
  const [validatingAiParameters, setValidatingAiParameters] = useState(false);
  const [restoringAiParameterKey, setRestoringAiParameterKey] = useState("");
  const [savingProposalContent, setSavingProposalContent] = useState(false);
  const [publishingProposalContent, setPublishingProposalContent] =
    useState(false);
  const [assetActionKey, setAssetActionKey] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadConfiguration() {
      setLoading(true);
      setError("");
      try {
        const [
          profileResponse,
          temporaryFeaturesResponse,
          chatbotSettingsResponse,
          commercialSettingsResponse,
          countriesResponse,
          accountTypesResponse,
          economicSectorsResponse,
          auditResponse,
          playbooksResponse,
          proposalContentResponse,
          institutionalAssetsResponse,
          aiParametersResponse,
          aiWalletsResponse,
          aiPricingResponse,
        ] = await Promise.all([
          api.get("/api/settings/company-profile"),
          api
            .get("/api/settings/temporary-features")
            .catch(() => ({ data: { settings: null } })),
          api
            .get("/api/settings/chatbot")
            .catch(() => ({ data: { settings: null } })),
          api.get("/api/settings/commercial").catch(() => ({
            data: {
              settings: null,
              matrixCatalogs: EMPTY_CAMPAIGN_MATRIX_CATALOGS,
            },
          })),
          api.get("/api/catalogs/countries"),
          api
            .get("/api/catalogs/account-types-management")
            .catch(() => ({ data: { items: [] } })),
          api
            .get("/api/catalogs/economic-sectors-management")
            .catch(() => ({ data: { items: [] } })),
          api.get("/api/settings/audit?limit=25"),
          api
            .get("/api/opportunities/workspace-playbooks")
            .catch(() => ({ data: { items: [] } })),
          api.get("/api/settings/proposal-content-config").catch((err) => ({
            data: { config: null, componentDefinitions: [] },
            loadError: getApiErrorMessage(
              err,
              "No fue posible cargar la configuracion de propuestas",
            ),
          })),
          api
            .get("/api/settings/institutional-assets")
            .catch(() => ({ data: { items: [] } })),
          api.get("/api/settings/ai-parameters").catch(() => ({
            data: { config: EMPTY_AI_PARAMETERS_CONFIG },
          })),
          api.get("/api/admin/ai/wallets").catch(() => ({
            data: { items: [] },
          })),
          api.get("/api/admin/ai/pricing-rates").catch(() => ({
            data: { items: [] },
          })),
        ]);

        if (cancelled) return;

        const nextProfile = profileResponse.data?.profile || null;
        const nextTemporaryFeatureSettings = normalizeTemporaryFeatureSettings(
          temporaryFeaturesResponse.data?.settings,
        );
        const nextChatbotSettings = normalizeChatbotSettings(
          chatbotSettingsResponse.data?.settings,
        );
        const nextCommercialSettings = normalizeCommercialSettings(
          commercialSettingsResponse.data?.settings,
        );
        const nextCampaignMatrixCatalogs = normalizeCampaignMatrixCatalogs(
          commercialSettingsResponse.data?.matrixCatalogs,
        );
        const nextForm = normalizeProfileToForm(nextProfile);
        setCompanyProfile(nextProfile);
        setTemporaryFeatureSettings(nextTemporaryFeatureSettings);
        setChatbotSettings(nextChatbotSettings);
        setCommercialSettings(nextCommercialSettings);
        setCampaignMatrixCatalogs(nextCampaignMatrixCatalogs);
        setForm(nextForm);
        setInitialSnapshot(serializeForm(nextForm));
        setInitialTemporaryFeaturesSnapshot(
          serializeTemporaryFeatureSettings(nextTemporaryFeatureSettings),
        );
        setInitialChatbotSettingsSnapshot(
          serializeChatbotSettings(nextChatbotSettings),
        );
        setInitialCommercialSettingsSnapshot(
          serializeCommercialSettings(nextCommercialSettings),
        );
        setCountries(
          Array.isArray(countriesResponse.data) ? countriesResponse.data : [],
        );
        setAccountTypes(
          Array.isArray(accountTypesResponse.data?.items)
            ? accountTypesResponse.data.items
            : [],
        );
        setEconomicSectors(
          Array.isArray(economicSectorsResponse.data?.items)
            ? economicSectorsResponse.data.items
            : [],
        );
        setAuditEntries(
          Array.isArray(auditResponse.data) ? auditResponse.data : [],
        );
        setWorkspacePlaybooks(
          Array.isArray(playbooksResponse.data?.items)
            ? playbooksResponse.data.items
            : [],
        );
        setProposalContentConfig(
          normalizeProposalContentConfig(proposalContentResponse.data?.config),
        );
        setProposalContentLoadError(
          String(proposalContentResponse.loadError || ""),
        );
        setProposalComponentDefinitions(
          Array.isArray(proposalContentResponse.data?.componentDefinitions)
            ? proposalContentResponse.data.componentDefinitions
            : [],
        );
        setInstitutionalAssets(
          Array.isArray(institutionalAssetsResponse.data?.items)
            ? institutionalAssetsResponse.data.items
                .map(normalizeInstitutionalAsset)
                .filter(Boolean)
            : [],
        );
        const nextAiParametersConfig = normalizeAiParametersConfig(
          aiParametersResponse.data?.config,
        );
        const nextAiWalletSummaries = Array.isArray(
          aiWalletsResponse.data?.items,
        )
          ? aiWalletsResponse.data.items
          : [];
        const nextAiPricingRates = Array.isArray(aiPricingResponse.data?.items)
          ? aiPricingResponse.data.items
          : [];
        const nextAiEntry =
          nextAiParametersConfig.entries.find(
            (entry) =>
              entry.capabilityKey === DEFAULT_SELECTED_AI_CAPABILITY_KEY,
          ) ||
          nextAiParametersConfig.entries[0] ||
          normalizeAiParameterEntry();
        setAiParametersConfig(nextAiParametersConfig);
        setAiWalletSummaries(nextAiWalletSummaries);
        setAiWalletSummariesError("");
        setAiPricingRates(nextAiPricingRates);
        setAiPricingRatesError("");
        setAiPricingSyncPreview([]);
        const nextAiWalletUserId = nextAiWalletSummaries[0]?.userId || null;
        setSelectedAiWalletUserId(nextAiWalletUserId);
        if (nextAiWalletUserId) {
          void loadAiWalletDetail(nextAiWalletUserId).catch(() => {});
        }
        setSelectedAiCapabilityKey(nextAiEntry.capabilityKey);
        setAiParameterDraft(nextAiEntry);
        setInitialAiParameterSnapshot(serializeAiParameterDraft(nextAiEntry));
        setAiParameterValidationWarnings([]);
        setAiParameterRevisions([]);
        const activePlaybook = Array.isArray(playbooksResponse.data?.items)
          ? playbooksResponse.data.items.find((item) => item.isActive)
          : null;
        if (activePlaybook?.versionId) {
          const detailResponse = await api.get(
            `/api/opportunities/workspace-playbooks/${activePlaybook.versionId}`,
          );
          if (!cancelled) {
            setWorkspacePlaybookDetail(detailResponse.data?.playbook || null);
          }
        } else {
          setWorkspacePlaybookDetail(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            getApiErrorMessage(err, "No fue posible cargar la configuracion"),
          );
          setAiWalletSummariesError(
            getApiErrorMessage(err, "No fue posible cargar el credito IA"),
          );
          setAiPricingRatesError(
            getApiErrorMessage(err, "No fue posible cargar las tarifas IA"),
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setAiWalletSummariesLoading(false);
          setAiPricingRatesLoading(false);
        }
      }
    }

    void loadConfiguration();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!error && !success) return undefined;
    const timeoutId = window.setTimeout(() => {
      setError("");
      setSuccess("");
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [error, success]);

  const isDirty = useMemo(
    () => serializeForm(form) !== initialSnapshot,
    [form, initialSnapshot],
  );
  const temporaryFeaturesDirty = useMemo(
    () =>
      serializeTemporaryFeatureSettings(temporaryFeatureSettings) !==
      initialTemporaryFeaturesSnapshot,
    [temporaryFeatureSettings, initialTemporaryFeaturesSnapshot],
  );
  const chatbotSettingsDirty = useMemo(
    () =>
      serializeChatbotSettings(chatbotSettings) !==
      initialChatbotSettingsSnapshot,
    [chatbotSettings, initialChatbotSettingsSnapshot],
  );
  const commercialSettingsDirty = useMemo(
    () =>
      serializeCommercialSettings(commercialSettings) !==
      initialCommercialSettingsSnapshot,
    [commercialSettings, initialCommercialSettingsSnapshot],
  );
  const aiParametersDirty = useMemo(
    () =>
      serializeAiParameterDraft(aiParameterDraft) !==
      initialAiParameterSnapshot,
    [aiParameterDraft, initialAiParameterSnapshot],
  );

  const validationErrors = useMemo(() => validateCompanyProfile(form), [form]);
  const canSave = isDirty && Object.keys(validationErrors).length === 0;
  const temporaryFeaturesCanSave = temporaryFeaturesDirty;

  useEffect(() => {
    if (
      !isDirty &&
      !temporaryFeaturesDirty &&
      !chatbotSettingsDirty &&
      !commercialSettingsDirty &&
      !aiParametersDirty
    ) {
      return undefined;
    }

    function handleBeforeUnload(event) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [
    isDirty,
    temporaryFeaturesDirty,
    chatbotSettingsDirty,
    commercialSettingsDirty,
    aiParametersDirty,
  ]);

  function updateField(field, value) {
    setSaveAttempted(false);
    setForm((current) => ({ ...current, [field]: value }));
  }

  function confirmDiscardChanges() {
    if (
      !isDirty &&
      !temporaryFeaturesDirty &&
      !chatbotSettingsDirty &&
      !commercialSettingsDirty &&
      !aiParametersDirty
    ) {
      return true;
    }
    return window.confirm("Hay cambios sin guardar. ¿Deseas descartarlos?");
  }

  function changeSection(nextSection) {
    if (nextSection === activeSection) return;
    if (!confirmDiscardChanges()) return;
    setActiveSection(nextSection);
  }

  function discardChanges() {
    if (!confirmDiscardChanges()) return;
    if (activeSection === "ai_parameters") {
      const nextEntry =
        aiParametersConfig.entries.find(
          (entry) => entry.capabilityKey === selectedAiCapabilityKey,
        ) || normalizeAiParameterEntry(null);
      setAiParameterDraft(nextEntry);
      setInitialAiParameterSnapshot(serializeAiParameterDraft(nextEntry));
      setAiParameterValidationWarnings([]);
    } else if (activeSection === "global") {
      const nextTemporaryFeatureSettings =
        deserializeTemporaryFeatureSettingsSnapshot(
          initialTemporaryFeaturesSnapshot,
        );
      const nextChatbotSettings = deserializeChatbotSettingsSnapshot(
        initialChatbotSettingsSnapshot,
      );
      const nextCommercialSettings = deserializeCommercialSettingsSnapshot(
        initialCommercialSettingsSnapshot,
      );
      setTemporaryFeatureSettings(nextTemporaryFeatureSettings);
      setChatbotSettings(nextChatbotSettings);
      setCommercialSettings(nextCommercialSettings);
    } else {
      const nextForm = normalizeProfileToForm(companyProfile);
      setForm(nextForm);
      setSaveAttempted(false);
      setInitialSnapshot(serializeForm(nextForm));
    }
    setError("");
    setSuccess("");
  }

  async function handleLogoChange(file) {
    if (!file) {
      updateField("logoUrl", "");
      return;
    }

    if (!String(file.type || "").startsWith("image/")) {
      setError("Selecciona un archivo de imagen válido");
      return;
    }

    if (file.size > MAX_LOGO_SIZE_BYTES) {
      setError("El logo no debe exceder 2 MB");
      return;
    }

    try {
      const logoUrl = await readImageFile(file);
      updateField("logoUrl", logoUrl);
    } catch (err) {
      setError(String(err?.message || "No fue posible cargar el logo"));
    }
  }

  async function saveCompanyProfile() {
    const nextValidationErrors = validateCompanyProfile(form);
    if (Object.keys(nextValidationErrors).length > 0) {
      setSaveAttempted(true);
      setError(Object.values(nextValidationErrors)[0]);
      setSuccess("");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        legalName: form.legalName.trim(),
        commercialName: form.commercialName.trim() || undefined,
        taxId: form.taxId.trim(),
        logoUrl: form.logoUrl.trim() || undefined,
        addressLine1: form.addressLine1.trim(),
        addressLine2: form.addressLine2.trim() || undefined,
        city: form.city.trim(),
        stateRegion: form.stateRegion.trim(),
        countryId: Number(form.countryId),
        postalCode: form.postalCode.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        website: form.website.trim() || undefined,
        description: form.description.trim() || undefined,
      };

      const [saveResponse, auditResponse] = await Promise.all([
        api.put("/api/settings/company-profile", payload),
        api.get("/api/settings/audit?limit=25"),
      ]);

      const nextProfile = saveResponse.data?.profile || null;
      const nextForm = normalizeProfileToForm(nextProfile);
      setCompanyProfile(nextProfile);
      setForm(nextForm);
      setSaveAttempted(false);
      setInitialSnapshot(serializeForm(nextForm));
      setAuditEntries(
        Array.isArray(auditResponse.data) ? auditResponse.data : [],
      );
      setSuccess(
        saveResponse.data?.message ||
          "Configuracion de empresa actualizada correctamente",
      );
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible guardar la configuracion institucional",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  function updateTemporaryFeatureSetting(field, value) {
    setTemporaryFeatureSettings((current) => ({
      ...current,
      [field]: Boolean(value),
    }));
  }

  async function saveTemporaryFeatureSettings() {
    setSavingTemporaryFeatures(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        accountsPendingEnabled: Boolean(
          temporaryFeatureSettings.accountsPendingEnabled,
        ),
        contactsPendingEnabled: Boolean(
          temporaryFeatureSettings.contactsPendingEnabled,
        ),
        opportunitiesPendingEnabled: Boolean(
          temporaryFeatureSettings.opportunitiesPendingEnabled,
        ),
      };

      const [saveResponse, auditResponse] = await Promise.all([
        api.put("/api/settings/temporary-features", payload),
        api.get("/api/settings/audit?limit=25"),
      ]);

      const nextSettings = normalizeTemporaryFeatureSettings(
        saveResponse.data?.settings,
      );
      setTemporaryFeatureSettings(nextSettings);
      setInitialTemporaryFeaturesSnapshot(
        serializeTemporaryFeatureSettings(nextSettings),
      );
      setAuditEntries(
        Array.isArray(auditResponse.data) ? auditResponse.data : [],
      );
      setSuccess(
        saveResponse.data?.message ||
          "Configuracion temporal actualizada correctamente",
      );
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible guardar la configuracion temporal",
        ),
      );
    } finally {
      setSavingTemporaryFeatures(false);
    }
  }

  function updateChatbotSetting(field, value) {
    setChatbotSettings((current) => ({
      ...current,
      [field]: Number(value || 0),
    }));
  }

  async function saveChatbotSettings() {
    setSavingChatbotSettings(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        requestTimeoutMs: Math.max(
          5000,
          Number(chatbotSettings.requestTimeoutMs || 60000),
        ),
      };

      const [saveResponse, auditResponse] = await Promise.all([
        api.put("/api/settings/chatbot", payload),
        api.get("/api/settings/audit?limit=25"),
      ]);

      const nextSettings = normalizeChatbotSettings(
        saveResponse.data?.settings,
      );
      setChatbotSettings(nextSettings);
      setInitialChatbotSettingsSnapshot(serializeChatbotSettings(nextSettings));
      setAuditEntries(
        Array.isArray(auditResponse.data) ? auditResponse.data : [],
      );
      setSuccess(
        saveResponse.data?.message ||
          "Configuracion del chatbot actualizada correctamente",
      );
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible guardar la configuracion del chatbot",
        ),
      );
    } finally {
      setSavingChatbotSettings(false);
    }
  }

  function updateCommercialSetting(stageCode, days) {
    setCommercialSettings((current) => ({
      ...current,
      stageSlaMap: {
        ...current.stageSlaMap,
        [stageCode]: Number(days) || 1,
      },
    }));
  }

  function updateCommercialBusinessTimezone(value) {
    setCommercialSettings((current) => ({
      ...current,
      businessTimezone: String(value || "").trim(),
    }));
  }

  function updateCommercialScreenDisplayMinutes(value) {
    const parsed = Number(value);
    const safeValue = Number.isInteger(parsed)
      ? Math.max(1, Math.min(parsed, 60))
      : 1;
    setCommercialSettings((current) => ({
      ...current,
      sellerLeagueScreenDisplayMinutes: safeValue,
    }));
  }

  function updateCommercialScreenRotationMinutes(value) {
    const parsed = Number(value);
    const safeValue = Number.isInteger(parsed)
      ? Math.max(1, Math.min(parsed, 60))
      : 1;
    setCommercialSettings((current) => ({
      ...current,
      sellerLeagueScreenRotationMinutes: safeValue,
    }));
  }

  function updateCommercialWeightSetting(stageCode, percent) {
    const normalizedPercent = Number(percent);
    const safePercent = Number.isFinite(normalizedPercent)
      ? Math.max(0, Math.min(normalizedPercent, 100))
      : 0;
    setCommercialSettings((current) => ({
      ...current,
      stageWeightMap: {
        ...current.stageWeightMap,
        [stageCode]: safePercent / 100,
      },
    }));
  }

  function updateCommercialGuideSetting(guideKey, guideText) {
    setCommercialSettings((current) => ({
      ...current,
      leadExecutionGuides: {
        ...(current.leadExecutionGuides || {}),
        [guideKey]: String(guideText || ""),
      },
    }));
  }

  function updateCampaignMatrixRow(rowId, field, value) {
    setCommercialSettings((current) => ({
      ...current,
      campaignMatrixRows: normalizeCampaignMatrixRows(
        (current.campaignMatrixRows || []).map((row) =>
          row.id === rowId ? { ...row, [field]: value } : row,
        ),
      ),
    }));
  }

  function addCampaignMatrixRow() {
    setCommercialSettings((current) => ({
      ...current,
      campaignMatrixRows: [
        ...(current.campaignMatrixRows || []),
        {
          ...EMPTY_CAMPAIGN_MATRIX_ROW,
          id: createCampaignMatrixRowId(),
          campaignType:
            campaignMatrixCatalogs.campaignTypes[0] ||
            EMPTY_CAMPAIGN_MATRIX_ROW.campaignType,
          priority:
            campaignMatrixCatalogs.priorities[0] ||
            EMPTY_CAMPAIGN_MATRIX_ROW.priority,
          campaignSubtype:
            campaignMatrixCatalogs.campaignSubtypes[0] ||
            EMPTY_CAMPAIGN_MATRIX_ROW.campaignSubtype,
          emailType:
            campaignMatrixCatalogs.emailTypes[0] ||
            EMPTY_CAMPAIGN_MATRIX_ROW.emailType,
        },
      ],
    }));
  }

  function removeCampaignMatrixRow(rowId) {
    setCommercialSettings((current) => ({
      ...current,
      campaignMatrixRows: (current.campaignMatrixRows || []).filter(
        (row) => row.id !== rowId,
      ),
    }));
  }

  async function saveCommercialSettings() {
    setSavingCommercialSettings(true);
    setError("");
    setSuccess("");
    try {
      const [saveResponse, auditResponse] = await Promise.all([
        api.put("/api/settings/commercial", {
          businessTimezone:
            String(commercialSettings.businessTimezone || "").trim() ||
            EMPTY_COMMERCIAL_SETTINGS.businessTimezone,
          sellerLeagueScreenDisplayMinutes: Number(
            commercialSettings.sellerLeagueScreenDisplayMinutes || 1,
          ),
          sellerLeagueScreenRotationMinutes: Number(
            commercialSettings.sellerLeagueScreenRotationMinutes || 1,
          ),
          stageSlaMap: commercialSettings.stageSlaMap,
          stageWeightMap: commercialSettings.stageWeightMap,
          leadExecutionGuides: commercialSettings.leadExecutionGuides,
          campaignMatrixRows: commercialSettings.campaignMatrixRows,
        }),
        api.get("/api/settings/audit?limit=25"),
      ]);

      const nextSettings = normalizeCommercialSettings(
        saveResponse.data?.settings,
      );
      setCampaignMatrixCatalogs(
        normalizeCampaignMatrixCatalogs(saveResponse.data?.matrixCatalogs),
      );
      setCommercialSettings(nextSettings);
      window.dispatchEvent(
        new CustomEvent("business-timezone-updated", {
          detail: {
            businessTimezone: nextSettings.businessTimezone,
          },
        }),
      );
      setInitialCommercialSettingsSnapshot(
        serializeCommercialSettings(nextSettings),
      );
      setAuditEntries(
        Array.isArray(auditResponse.data) ? auditResponse.data : [],
      );
      setSuccess(
        saveResponse.data?.message ||
          "Configuracion comercial actualizada correctamente",
      );
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible guardar la configuracion comercial",
        ),
      );
    } finally {
      setSavingCommercialSettings(false);
    }
  }

  async function activateWorkspacePlaybook(versionId) {
    setActivatingWorkspaceVersionId(versionId);
    setError("");
    setSuccess("");
    try {
      const [activateResponse, playbooksResponse, detailResponse] =
        await Promise.all([
          api.post(
            `/api/opportunities/workspace-playbooks/${versionId}/activate`,
          ),
          api.get("/api/opportunities/workspace-playbooks"),
          api.get(`/api/opportunities/workspace-playbooks/${versionId}`),
        ]);
      setWorkspacePlaybooks(
        Array.isArray(playbooksResponse.data?.items)
          ? playbooksResponse.data.items
          : [],
      );
      setWorkspacePlaybookDetail(detailResponse.data?.playbook || null);
      setSuccess(
        activateResponse.data?.playbook
          ? `Playbook activo: ${activateResponse.data.playbook.name} ${activateResponse.data.playbook.version}`
          : "Playbook activado correctamente",
      );
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible activar la version del playbook",
        ),
      );
    } finally {
      setActivatingWorkspaceVersionId(null);
    }
  }

  async function updateWorkspacePlaybookStage({
    versionId,
    salesStageCode,
    objective,
    exitCriteriaSummary,
  }) {
    setSavingWorkspacePlaybookKey(`stage:${salesStageCode}`);
    setError("");
    setSuccess("");
    try {
      const response = await api.put(
        `/api/opportunities/workspace-playbooks/${versionId}/stages/${salesStageCode}`,
        { objective, exitCriteriaSummary },
      );
      setWorkspacePlaybookDetail(response.data?.playbook || null);
      setSuccess("Etapa del playbook actualizada");
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible actualizar la etapa del playbook",
        ),
      );
      throw err;
    } finally {
      setSavingWorkspacePlaybookKey("");
    }
  }

  async function updateWorkspacePlaybookCriterion({
    versionId,
    salesStageCode,
    criterionCode,
    title,
    description,
    themeCode,
    displayOrder,
  }) {
    setSavingWorkspacePlaybookKey(
      `criterion:${salesStageCode}:${criterionCode}`,
    );
    setError("");
    setSuccess("");
    try {
      const response = await api.put(
        `/api/opportunities/workspace-playbooks/${versionId}/stages/${salesStageCode}/criteria/${criterionCode}`,
        {
          title,
          description,
          themeCode,
          displayOrder,
        },
      );
      setWorkspacePlaybookDetail(response.data?.playbook || null);
      setSuccess("Criterio del playbook actualizado");
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible actualizar el criterio del playbook",
        ),
      );
      throw err;
    } finally {
      setSavingWorkspacePlaybookKey("");
    }
  }

  const latestUpdateText = useMemo(() => {
    if (!companyProfile?.updatedAt) {
      return "Sin cambios registrados";
    }
    return `${formatDateTime(companyProfile.updatedAt)} por ${
      companyProfile.updatedByUserName || "sistema"
    }`;
  }, [companyProfile]);

  const latestTemporaryFeaturesUpdateText = useMemo(() => {
    if (!temporaryFeatureSettings.updatedAt) {
      return "Sin cambios registrados";
    }
    return `${formatDateTime(temporaryFeatureSettings.updatedAt)} por ${
      temporaryFeatureSettings.updatedByUserName || "sistema"
    }`;
  }, [temporaryFeatureSettings]);

  const latestChatbotSettingsUpdateText = useMemo(() => {
    if (!chatbotSettings.updatedAt) {
      return "Sin cambios registrados";
    }
    return `${formatDateTime(chatbotSettings.updatedAt)} por ${
      chatbotSettings.updatedByUserName || "sistema"
    }`;
  }, [chatbotSettings]);

  const latestCommercialSettingsUpdateText = useMemo(() => {
    if (!commercialSettings.updatedAt) {
      return "Sin cambios registrados";
    }
    return `${formatDateTime(commercialSettings.updatedAt)} por ${
      commercialSettings.updatedByUserName || "sistema"
    }`;
  }, [commercialSettings]);

  const latestProposalContentUpdateText = useMemo(() => {
    if (!proposalContentConfig.updatedAt) {
      return proposalContentConfig.publishedAt
        ? formatDateTime(proposalContentConfig.publishedAt)
        : "Sin cambios publicados";
    }
    return formatDateTime(proposalContentConfig.updatedAt);
  }, [proposalContentConfig]);

  const latestAiParametersUpdateText = useMemo(() => {
    if (!aiParametersConfig.updatedAt) {
      return aiParametersConfig.publishedAt
        ? formatDateTime(aiParametersConfig.publishedAt)
        : "Sin cambios publicados";
    }
    return `${formatDateTime(aiParametersConfig.updatedAt)} por ${
      aiParametersConfig.updatedByUserName || "sistema"
    }`;
  }, [aiParametersConfig]);

  const latestAiWalletUpdateText = useMemo(() => {
    if (!aiWalletSummaries.length) {
      return "Sin cambios registrados";
    }

    const latestWallet = [...aiWalletSummaries].sort((left, right) => {
      return String(right.asOfUtc || "").localeCompare(
        String(left.asOfUtc || ""),
      );
    })[0];

    return `${formatDateTime(latestWallet.asOfUtc)} por sistema`;
  }, [aiWalletSummaries, formatDateTime]);

  const latestAiPricingUpdateText = useMemo(() => {
    if (!aiPricingRates.length) {
      return "Sin tarifas configuradas";
    }

    const latestRate = [...aiPricingRates].sort((left, right) => {
      return String(right.updatedAtUtc || "").localeCompare(
        String(left.updatedAtUtc || ""),
      );
    })[0];

    return latestRate?.updatedAtUtc
      ? formatDateTime(latestRate.updatedAtUtc)
      : "Sin cambios registrados";
  }, [aiPricingRates, formatDateTime]);

  function updateAccountTypeDraft(field, value) {
    setAccountTypeDraft((current) => ({
      ...current,
      [field]: String(value || ""),
    }));
  }

  async function reloadAccountTypes() {
    const response = await api.get("/api/catalogs/account-types-management");
    const items = Array.isArray(response.data?.items)
      ? response.data.items
      : [];
    setAccountTypes(items);
    return items;
  }

  async function createAccountType() {
    const name = String(accountTypeDraft.name || "").trim();
    const code = String(accountTypeDraft.code || "").trim();
    const description = String(accountTypeDraft.description || "").trim();
    if (name.length < 2) {
      setError("El nombre del tipo de cuenta debe tener al menos 2 caracteres");
      setSuccess("");
      return null;
    }

    setAccountTypeActionKey("create");
    setError("");
    setSuccess("");
    try {
      await api.post("/api/catalogs/account-types-management", {
        name,
        code: code || undefined,
        description: description || undefined,
      });
      await reloadAccountTypes();
      setAccountTypeDraft({ name: "", code: "", description: "" });
      setSuccess("Tipo de cuenta creado correctamente");
      return true;
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible crear el tipo de cuenta"),
      );
      throw err;
    } finally {
      setAccountTypeActionKey("");
    }
  }

  async function renameAccountType(accountTypeId, nextName, nextDescription) {
    const normalizedId = Number(accountTypeId || 0);
    const normalizedName = String(nextName || "").trim();
    const normalizedDescription = String(nextDescription || "").trim();
    if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
      return null;
    }
    if (normalizedName.length < 2) {
      setError("El nombre del tipo de cuenta debe tener al menos 2 caracteres");
      setSuccess("");
      return null;
    }

    setAccountTypeActionKey(`rename:${normalizedId}`);
    setError("");
    setSuccess("");
    try {
      await api.patch(
        `/api/catalogs/account-types-management/${normalizedId}`,
        {
          name: normalizedName,
          description: normalizedDescription,
        },
      );
      await reloadAccountTypes();
      setSuccess("Tipo de cuenta actualizado correctamente");
      return true;
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible actualizar el tipo de cuenta"),
      );
      throw err;
    } finally {
      setAccountTypeActionKey("");
    }
  }

  async function setAccountTypeStatus(accountTypeId, isActive) {
    const normalizedId = Number(accountTypeId || 0);
    if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
      return null;
    }

    setAccountTypeActionKey(`status:${normalizedId}`);
    setError("");
    setSuccess("");
    try {
      await api.patch(
        `/api/catalogs/account-types-management/${normalizedId}`,
        {
          isActive: Boolean(isActive),
        },
      );
      await reloadAccountTypes();
      setSuccess(
        isActive ? "Tipo de cuenta activado" : "Tipo de cuenta desactivado",
      );
      return true;
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible actualizar el estado del tipo de cuenta",
        ),
      );
      throw err;
    } finally {
      setAccountTypeActionKey("");
    }
  }

  function updateEconomicSectorDraft(field, value) {
    setEconomicSectorDraft((current) => ({
      ...current,
      [field]: String(value || ""),
    }));
  }

  async function reloadEconomicSectors() {
    const response = await api.get("/api/catalogs/economic-sectors-management");
    const items = Array.isArray(response.data?.items)
      ? response.data.items
      : [];
    setEconomicSectors(items);
    return items;
  }

  async function createEconomicSector() {
    const name = String(economicSectorDraft.name || "").trim();
    const code = String(economicSectorDraft.code || "").trim();
    const description = String(economicSectorDraft.description || "").trim();
    if (name.length < 2) {
      setError("El nombre del sector debe tener al menos 2 caracteres");
      setSuccess("");
      return null;
    }

    setEconomicSectorActionKey("create");
    setError("");
    setSuccess("");
    try {
      await api.post("/api/catalogs/economic-sectors-management", {
        name,
        code: code || undefined,
        description: description || undefined,
      });
      await reloadEconomicSectors();
      setEconomicSectorDraft({ name: "", code: "", description: "" });
      setSuccess("Sector economico creado correctamente");
      return true;
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible crear el sector"));
      throw err;
    } finally {
      setEconomicSectorActionKey("");
    }
  }

  async function renameEconomicSector(sectorId, nextName, nextDescription) {
    const normalizedId = Number(sectorId || 0);
    const normalizedName = String(nextName || "").trim();
    const normalizedDescription = String(nextDescription || "").trim();
    if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
      return null;
    }
    if (normalizedName.length < 2) {
      setError("El nombre del sector debe tener al menos 2 caracteres");
      setSuccess("");
      return null;
    }

    setEconomicSectorActionKey(`rename:${normalizedId}`);
    setError("");
    setSuccess("");
    try {
      await api.patch(
        `/api/catalogs/economic-sectors-management/${normalizedId}`,
        {
          name: normalizedName,
          description: normalizedDescription,
        },
      );
      await reloadEconomicSectors();
      setSuccess("Sector economico actualizado correctamente");
      return true;
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible actualizar el sector"));
      throw err;
    } finally {
      setEconomicSectorActionKey("");
    }
  }

  async function setEconomicSectorStatus(sectorId, isActive) {
    const normalizedId = Number(sectorId || 0);
    if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
      return null;
    }

    setEconomicSectorActionKey(`status:${normalizedId}`);
    setError("");
    setSuccess("");
    try {
      await api.patch(
        `/api/catalogs/economic-sectors-management/${normalizedId}`,
        {
          isActive: Boolean(isActive),
        },
      );
      await reloadEconomicSectors();
      setSuccess(
        isActive ? "Sector economico activado" : "Sector economico desactivado",
      );
      return true;
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible actualizar el estado del sector",
        ),
      );
      throw err;
    } finally {
      setEconomicSectorActionKey("");
    }
  }

  async function reloadAiParametersConfig(
    nextCapabilityKey = selectedAiCapabilityKey,
  ) {
    const response = await api.get("/api/settings/ai-parameters");
    const nextConfig = normalizeAiParametersConfig(response.data?.config);
    const nextEntry =
      nextConfig.entries.find(
        (entry) => entry.capabilityKey === nextCapabilityKey,
      ) ||
      nextConfig.entries[0] ||
      normalizeAiParameterEntry(null);
    setAiParametersConfig(nextConfig);
    setSelectedAiCapabilityKey(nextEntry.capabilityKey);
    setAiParameterDraft(nextEntry);
    setInitialAiParameterSnapshot(serializeAiParameterDraft(nextEntry));
    return nextEntry;
  }

  const loadAiParameterRevisions = useCallback(
    async (capabilityKey) => {
      const nextCapabilityKey =
        capabilityKey ||
        selectedAiCapabilityKey ||
        DEFAULT_SELECTED_AI_CAPABILITY_KEY;
      const response = await api.get(
        `/api/settings/ai-parameters/entries/${nextCapabilityKey}/revisions`,
      );
      setAiParameterRevisions(
        Array.isArray(response.data?.revisions) ? response.data.revisions : [],
      );
    },
    [selectedAiCapabilityKey],
  );

  function updateAiParameterField(field, value) {
    setAiParameterDraft((current) => ({ ...current, [field]: value }));
  }

  function updateAiParameterParameter(field, value) {
    setAiParameterDraft((current) => ({
      ...current,
      parameters: {
        ...(current.parameters || {}),
        [field]: value,
      },
    }));
  }

  async function selectAiCapability(capabilityKey) {
    if (capabilityKey === selectedAiCapabilityKey) return;
    if (aiParametersDirty && !confirmDiscardChanges()) return;
    const nextEntry =
      aiParametersConfig.entries.find(
        (entry) => entry.capabilityKey === capabilityKey,
      ) || normalizeAiParameterEntry(null);
    setSelectedAiCapabilityKey(capabilityKey);
    setAiParameterDraft(nextEntry);
    setInitialAiParameterSnapshot(serializeAiParameterDraft(nextEntry));
    setAiParameterValidationWarnings([]);
    setAiParameterRevisions([]);
    if (activeSection === "ai_parameters") {
      try {
        await loadAiParameterRevisions(capabilityKey);
      } catch {
        setAiParameterRevisions([]);
      }
    }
  }

  async function validateAiParametersDraft() {
    setValidatingAiParameters(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(
        `/api/settings/ai-parameters/entries/${selectedAiCapabilityKey}/validate`,
        buildAiParameterDraftPayload(aiParameterDraft),
      );
      setAiParameterValidationWarnings(
        Array.isArray(response.data?.warnings) ? response.data.warnings : [],
      );
      setSuccess("Validacion de parametros IA completada");
      return response.data;
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible validar los parametros IA"),
      );
      throw err;
    } finally {
      setValidatingAiParameters(false);
    }
  }

  async function saveAiParametersDraft(changeSummary = "") {
    setSavingAiParameters(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.put(
        `/api/settings/ai-parameters/entries/${selectedAiCapabilityKey}`,
        buildAiParameterDraftPayload(aiParameterDraft, changeSummary),
      );
      const nextConfig = normalizeAiParametersConfig(response.data?.config);
      const nextEntry =
        normalizeAiParameterEntry(response.data?.entry) ||
        nextConfig.entries.find(
          (entry) => entry.capabilityKey === selectedAiCapabilityKey,
        ) ||
        normalizeAiParameterEntry(null);
      setAiParametersConfig(nextConfig);
      setAiParameterDraft(nextEntry);
      setInitialAiParameterSnapshot(serializeAiParameterDraft(nextEntry));
      setSuccess(response.data?.message || "Borrador IA actualizado");
      await loadAiParameterRevisions(selectedAiCapabilityKey);
      return nextEntry;
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible guardar el borrador IA"),
      );
      throw err;
    } finally {
      setSavingAiParameters(false);
    }
  }

  async function publishAiParameters() {
    setPublishingAiParameters(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post("/api/settings/ai-parameters/publish");
      const nextConfig = normalizeAiParametersConfig(response.data?.config);
      const nextEntry =
        nextConfig.entries.find(
          (entry) => entry.capabilityKey === selectedAiCapabilityKey,
        ) ||
        nextConfig.entries[0] ||
        normalizeAiParameterEntry(null);
      setAiParametersConfig(nextConfig);
      setAiParameterDraft(nextEntry);
      setInitialAiParameterSnapshot(serializeAiParameterDraft(nextEntry));
      setSuccess(response.data?.message || "Parámetros IA publicados");
      await loadAiParameterRevisions(selectedAiCapabilityKey);
      return nextEntry;
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible publicar los parametros IA"),
      );
      throw err;
    } finally {
      setPublishingAiParameters(false);
    }
  }

  async function restoreAiParameterRevision(revisionNumber) {
    setRestoringAiParameterKey(`${selectedAiCapabilityKey}:${revisionNumber}`);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(
        `/api/settings/ai-parameters/entries/${selectedAiCapabilityKey}/restore/${revisionNumber}`,
      );
      const nextConfig = normalizeAiParametersConfig(response.data?.config);
      const nextEntry =
        normalizeAiParameterEntry(response.data?.entry) ||
        nextConfig.entries.find(
          (entry) => entry.capabilityKey === selectedAiCapabilityKey,
        ) ||
        normalizeAiParameterEntry(null);
      setAiParametersConfig(nextConfig);
      setAiParameterDraft(nextEntry);
      setInitialAiParameterSnapshot(serializeAiParameterDraft(nextEntry));
      setSuccess(response.data?.message || "Revision restaurada");
      await loadAiParameterRevisions(selectedAiCapabilityKey);
      return nextEntry;
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible restaurar la revision IA"),
      );
      throw err;
    } finally {
      setRestoringAiParameterKey("");
    }
  }

  useEffect(() => {
    if (activeSection !== "ai_parameters") return;
    queueMicrotask(() => {
      void loadAiParameterRevisions(selectedAiCapabilityKey).catch(() => {
        queueMicrotask(() => {
          setAiParameterRevisions([]);
        });
      });
    });
  }, [activeSection, selectedAiCapabilityKey, loadAiParameterRevisions]);

  async function reloadProposalContentWorkspace() {
    try {
      const [configResponse, assetsResponse] = await Promise.all([
        api.get("/api/settings/proposal-content-config"),
        api.get("/api/settings/institutional-assets"),
      ]);
      setProposalContentConfig(
        normalizeProposalContentConfig(configResponse.data?.config),
      );
      setProposalContentLoadError("");
      setProposalComponentDefinitions(
        Array.isArray(configResponse.data?.componentDefinitions)
          ? configResponse.data.componentDefinitions
          : [],
      );
      setInstitutionalAssets(
        Array.isArray(assetsResponse.data?.items)
          ? assetsResponse.data.items
              .map(normalizeInstitutionalAsset)
              .filter(Boolean)
          : [],
      );
    } catch (err) {
      setProposalContentLoadError(
        getApiErrorMessage(
          err,
          "No fue posible cargar la configuracion de propuestas",
        ),
      );
      throw err;
    }
  }

  const reloadAiWalletSummaries = useCallback(async () => {
    setAiWalletSummariesLoading(true);
    setAiWalletSummariesError("");
    try {
      const response = await api.get("/api/admin/ai/wallets");
      const items = Array.isArray(response.data?.items)
        ? response.data.items
        : [];
      setAiWalletSummaries(items);
      if (!selectedAiWalletUserId && items[0]?.userId) {
        setSelectedAiWalletUserId(items[0].userId);
        void loadAiWalletDetail(items[0].userId).catch(() => {});
      }
      return items;
    } catch (err) {
      const message = getApiErrorMessage(
        err,
        "No fue posible cargar el credito IA",
      );
      setAiWalletSummariesError(message);
      throw err;
    } finally {
      setAiWalletSummariesLoading(false);
    }
  }, [selectedAiWalletUserId]);

  const loadAiWalletDetail = useCallback(async (userId) => {
    if (!userId) {
      setSelectedAiWalletDetail(null);
      return null;
    }

    setSelectedAiWalletDetailLoading(true);
    try {
      const response = await api.get(`/api/admin/ai/wallets/${userId}`);
      const detail = response.data || null;
      setSelectedAiWalletDetail(detail);
      return detail;
    } catch (err) {
      setSelectedAiWalletDetail(null);
      throw err;
    } finally {
      setSelectedAiWalletDetailLoading(false);
    }
  }, []);

  const reloadAiPricingRates = useCallback(async () => {
    setAiPricingRatesLoading(true);
    setAiPricingRatesError("");
    try {
      const response = await api.get("/api/admin/ai/pricing-rates");
      const items = Array.isArray(response.data?.items)
        ? response.data.items
        : [];
      setAiPricingRates(items);
      return items;
    } catch (err) {
      const message = getApiErrorMessage(
        err,
        "No fue posible cargar las tarifas IA",
      );
      setAiPricingRatesError(message);
      throw err;
    } finally {
      setAiPricingRatesLoading(false);
    }
  }, []);

  async function selectAiWalletUser(userId) {
    const nextUserId = Number(userId || 0) || null;
    setSelectedAiWalletUserId(nextUserId);
    if (!nextUserId) {
      setSelectedAiWalletDetail(null);
      return;
    }
    await loadAiWalletDetail(nextUserId);
  }

  async function grantAiWalletCredit(userId, payload) {
    setAiWalletActionKey(`grant:${userId}`);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(
        `/api/admin/ai/wallets/${userId}/grants`,
        payload,
      );
      await reloadAiWalletSummaries();
      await loadAiWalletDetail(userId);
      setSuccess("Credito IA recargado correctamente");
      return response.data;
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible recargar el credito IA"),
      );
      throw err;
    } finally {
      setAiWalletActionKey("");
    }
  }

  async function adjustAiWalletCredit(userId, payload) {
    setAiWalletActionKey(`adjust:${userId}`);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(
        `/api/admin/ai/wallets/${userId}/adjustments`,
        payload,
      );
      await reloadAiWalletSummaries();
      await loadAiWalletDetail(userId);
      setSuccess("Ajuste IA aplicado correctamente");
      return response.data;
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible aplicar el ajuste IA"));
      throw err;
    } finally {
      setAiWalletActionKey("");
    }
  }

  async function updateAiWalletPolicy(userId, payload) {
    setAiWalletActionKey(`policy:${userId}`);
    setError("");
    setSuccess("");
    try {
      const response = await api.patch(
        `/api/admin/ai/wallets/${userId}/policy`,
        payload,
      );
      await reloadAiWalletSummaries();
      await loadAiWalletDetail(userId);
      setSuccess("Politica IA actualizada correctamente");
      return response.data;
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible actualizar la politica IA"),
      );
      throw err;
    } finally {
      setAiWalletActionKey("");
    }
  }

  async function createAiPricingRate(payload) {
    setAiPricingActionKey("create");
    setError("");
    setSuccess("");
    try {
      const response = await api.post("/api/admin/ai/pricing-rates", payload);
      await reloadAiPricingRates();
      setSuccess("Tarifa IA creada correctamente");
      return response.data?.rate || null;
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible crear la tarifa IA"));
      throw err;
    } finally {
      setAiPricingActionKey("");
    }
  }

  async function closeAiPricingRate(rateId, payload = {}) {
    setAiPricingActionKey(`close:${rateId}`);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(
        `/api/admin/ai/pricing-rates/${rateId}/close`,
        payload,
      );
      await reloadAiPricingRates();
      setSuccess("Vigencia de tarifa IA cerrada");
      return response.data?.rate || null;
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible cerrar la vigencia de tarifa"),
      );
      throw err;
    } finally {
      setAiPricingActionKey("");
    }
  }

  async function syncAiPricingRates({ dryRun = true } = {}) {
    setAiPricingActionKey(dryRun ? "sync-preview" : "sync-apply");
    setError("");
    setSuccess("");
    try {
      const response = await api.post(
        "/api/admin/ai/pricing-rates/sync-openai",
        {
          dryRun,
        },
      );
      const preview = Array.isArray(response.data?.preview)
        ? response.data.preview
        : [];
      setAiPricingSyncPreview(preview);
      if (!dryRun) {
        await reloadAiPricingRates();
      }
      setSuccess(
        dryRun
          ? "Vista previa de sincronizacion generada"
          : "Tarifas IA sincronizadas correctamente",
      );
      return response.data || null;
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible sincronizar las tarifas IA"),
      );
      throw err;
    } finally {
      setAiPricingActionKey("");
    }
  }

  async function saveProposalContentComponent(componentCode, payload) {
    setSavingProposalContent(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.put(
        `/api/settings/proposal-content-config/components/${componentCode}`,
        buildProposalContentComponentPayload(payload),
      );
      setProposalContentConfig(
        normalizeProposalContentConfig(response.data?.config),
      );
      setSuccess(response.data?.message || "Componente actualizado");
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible guardar el contenido default de la propuesta",
        ),
      );
      throw err;
    } finally {
      setSavingProposalContent(false);
    }
  }

  async function createProposalContentComponent(payload) {
    setSavingProposalContent(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(
        "/api/settings/proposal-content-config/components",
        buildProposalContentComponentPayload(payload),
      );
      setProposalContentConfig(
        normalizeProposalContentConfig(response.data?.config),
      );
      setSuccess(response.data?.message || "Componente creado");
      return response.data?.component || null;
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible crear el componente de propuesta",
        ),
      );
      throw err;
    } finally {
      setSavingProposalContent(false);
    }
  }

  async function reorderProposalContent(orderedComponentCodes) {
    setSavingProposalContent(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(
        "/api/settings/proposal-content-config/components/reorder",
        { orderedComponentCodes },
      );
      setProposalContentConfig(
        normalizeProposalContentConfig(response.data?.config),
      );
      setSuccess(response.data?.message || "Orden actualizado");
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible reordenar los componentes"),
      );
      throw err;
    } finally {
      setSavingProposalContent(false);
    }
  }

  async function archiveProposalContentComponent(componentCode) {
    setSavingProposalContent(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(
        `/api/settings/proposal-content-config/components/${componentCode}/archive`,
      );
      setProposalContentConfig(
        normalizeProposalContentConfig(response.data?.config),
      );
      setSuccess(response.data?.message || "Componente archivado");
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible archivar el componente"),
      );
      throw err;
    } finally {
      setSavingProposalContent(false);
    }
  }

  async function restoreProposalContentComponent(componentCode) {
    setSavingProposalContent(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(
        `/api/settings/proposal-content-config/components/${componentCode}/restore`,
      );
      setProposalContentConfig(
        normalizeProposalContentConfig(response.data?.config),
      );
      setSuccess(response.data?.message || "Componente restaurado");
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible restaurar el componente"),
      );
      throw err;
    } finally {
      setSavingProposalContent(false);
    }
  }

  async function deleteProposalContent(componentCode) {
    setSavingProposalContent(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.delete(
        `/api/settings/proposal-content-config/components/${componentCode}`,
      );
      setProposalContentConfig(
        normalizeProposalContentConfig(response.data?.config),
      );
      setSuccess(response.data?.message || "Componente eliminado");
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible eliminar el componente"),
      );
      throw err;
    } finally {
      setSavingProposalContent(false);
    }
  }

  async function publishProposalContent() {
    setPublishingProposalContent(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(
        "/api/settings/proposal-content-config/publish",
      );
      setProposalContentConfig(
        normalizeProposalContentConfig(response.data?.config),
      );
      setSuccess(response.data?.message || "Configuracion publicada");
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible publicar la configuracion de propuestas",
        ),
      );
      throw err;
    } finally {
      setPublishingProposalContent(false);
    }
  }

  async function createProposalAsset(payload) {
    setAssetActionKey("create");
    setError("");
    setSuccess("");
    try {
      const response = await api.post(
        "/api/settings/institutional-assets",
        payload,
      );
      await reloadProposalContentWorkspace();
      setSuccess(response.data?.message || "Asset creado");
      return response.data?.asset || null;
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible crear el asset institucional"),
      );
      throw err;
    } finally {
      setAssetActionKey("");
    }
  }

  async function addProposalAssetVersion(assetId, payload) {
    setAssetActionKey(`version:${assetId}`);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(
        `/api/settings/institutional-assets/${assetId}/versions`,
        payload,
      );
      await reloadProposalContentWorkspace();
      setSuccess(response.data?.message || "Version registrada");
      return response.data?.asset || null;
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible registrar la version del asset",
        ),
      );
      throw err;
    } finally {
      setAssetActionKey("");
    }
  }

  async function archiveProposalAsset(assetId) {
    setAssetActionKey(`archive:${assetId}`);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(
        `/api/settings/institutional-assets/${assetId}/archive`,
      );
      await reloadProposalContentWorkspace();
      setSuccess(response.data?.message || "Asset archivado");
      return response.data?.asset || null;
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible archivar el asset"));
      throw err;
    } finally {
      setAssetActionKey("");
    }
  }

  const sectionItems = useMemo(
    () => [
      {
        id: "company",
        title: "Empresa",
        description: "Datos institucionales, fiscales y de contacto",
        dirty: isDirty,
      },
      {
        id: "global",
        title: "Parámetros globales",
        description: "Ajustes funcionales comunes a toda la aplicacion",
        dirty:
          temporaryFeaturesDirty ||
          chatbotSettingsDirty ||
          commercialSettingsDirty,
      },
      {
        id: "catalogs",
        title: "Catalogos",
        description: "Gestion de catalogos maestros para cuentas y contacto",
        dirty: false,
      },
      {
        id: "ai_parameters",
        title: "Parámetros IA",
        description: "Prompts, timeouts y politicas publicadas por capacidad",
        dirty: aiParametersDirty,
      },
      {
        id: "ai_budget",
        title: "Credito IA",
        description: "Credito por usuario, umbrales y control operativo",
        dirty: false,
      },
      {
        id: "proposal_content",
        title: "Propuestas comerciales",
        description: "Assets institucionales y contenido default por sección",
        dirty: false,
      },
      {
        id: "modules",
        title: "Parámetros por módulo",
        description: "Reglas específicas por área funcional",
        dirty: false,
      },
      {
        id: "audit",
        title: "Historial de cambios",
        description: "Auditoria y trazabilidad de configuracion",
        dirty: false,
      },
    ],
    [
      aiParametersDirty,
      chatbotSettingsDirty,
      commercialSettingsDirty,
      isDirty,
      temporaryFeaturesDirty,
    ],
  );

  return {
    loading,
    saving,
    error,
    success,
    activeSection,
    countries,
    accountTypes,
    accountTypeDraft,
    accountTypeActionKey,
    economicSectors,
    economicSectorDraft,
    economicSectorActionKey,
    companyProfile,
    temporaryFeatureSettings,
    chatbotSettings,
    commercialSettings,
    form,
    auditEntries,
    workspacePlaybooks,
    workspacePlaybookDetail,
    activatingWorkspaceVersionId,
    savingWorkspacePlaybookKey,
    proposalContentConfig,
    proposalContentLoadError,
    proposalComponentDefinitions,
    institutionalAssets,
    aiParametersConfig,
    aiWalletSummaries,
    aiWalletSummariesLoading,
    aiWalletSummariesError,
    aiPricingRates,
    aiPricingRatesLoading,
    aiPricingRatesError,
    aiPricingActionKey,
    aiPricingSyncPreview,
    selectedAiWalletUserId,
    selectedAiWalletDetail,
    selectedAiWalletDetailLoading,
    aiWalletActionKey,
    selectedAiCapabilityKey,
    aiParameterDraft,
    aiParameterValidationWarnings,
    aiParameterRevisions,
    savingAiParameters,
    publishingAiParameters,
    validatingAiParameters,
    restoringAiParameterKey,
    savingProposalContent,
    publishingProposalContent,
    assetActionKey,
    fieldErrors: saveAttempted ? validationErrors : {},
    isDirty,
    canSave,
    savingTemporaryFeatures,
    savingChatbotSettings,
    savingCommercialSettings,
    temporaryFeaturesDirty,
    temporaryFeaturesCanSave,
    chatbotSettingsDirty,
    commercialSettingsDirty,
    aiParametersDirty,
    latestUpdateText,
    latestTemporaryFeaturesUpdateText,
    latestChatbotSettingsUpdateText,
    latestCommercialSettingsUpdateText,
    latestAiWalletUpdateText,
    latestAiPricingUpdateText,
    latestProposalContentUpdateText,
    latestAiParametersUpdateText,
    sectionItems,
    stageSlaEntries: STAGE_SLA_ENTRIES,
    stageWeightEntries: STAGE_WEIGHT_ENTRIES,
    leadExecutionGuideEntries: LEAD_EXECUTION_GUIDE_ENTRIES,
    campaignMatrixCatalogs,
    formatDateTime,
    summarizeChangedFields,
    updateField,
    updateAccountTypeDraft,
    updateEconomicSectorDraft,
    changeSection,
    discardChanges,
    handleLogoChange,
    saveCompanyProfile,
    updateTemporaryFeatureSetting,
    saveTemporaryFeatureSettings,
    updateChatbotSetting,
    saveChatbotSettings,
    updateCommercialSetting,
    updateCommercialBusinessTimezone,
    updateCommercialScreenDisplayMinutes,
    updateCommercialScreenRotationMinutes,
    updateCommercialWeightSetting,
    updateCommercialGuideSetting,
    updateCampaignMatrixRow,
    addCampaignMatrixRow,
    removeCampaignMatrixRow,
    saveCommercialSettings,
    reloadAccountTypes,
    createAccountType,
    renameAccountType,
    setAccountTypeStatus,
    reloadEconomicSectors,
    createEconomicSector,
    renameEconomicSector,
    setEconomicSectorStatus,
    reloadAiWalletSummaries,
    reloadAiPricingRates,
    loadAiWalletDetail,
    selectAiWalletUser,
    grantAiWalletCredit,
    adjustAiWalletCredit,
    updateAiWalletPolicy,
    createAiPricingRate,
    closeAiPricingRate,
    syncAiPricingRates,
    activateWorkspacePlaybook,
    updateWorkspacePlaybookStage,
    updateWorkspacePlaybookCriterion,
    updateAiParameterField,
    updateAiParameterParameter,
    selectAiCapability,
    validateAiParametersDraft,
    saveAiParametersDraft,
    publishAiParameters,
    restoreAiParameterRevision,
    saveProposalContentComponent,
    createProposalContentComponent,
    reorderProposalContent,
    archiveProposalContentComponent,
    restoreProposalContentComponent,
    deleteProposalContent,
    publishProposalContent,
    createProposalAsset,
    addProposalAssetVersion,
    archiveProposalAsset,
    reloadProposalContentWorkspace,
    reloadAiParametersConfig,
  };
}
