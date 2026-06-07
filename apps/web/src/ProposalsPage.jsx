import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import ProposalTemplatePickerModal from "./ProposalTemplatePickerModal";
import ProposalPrintPreviewModal from "./proposals/ProposalPrintPreviewModal";
import ModalInlineHelp from "./help/ModalInlineHelp";
import { api, getApiErrorMessage } from "./api";

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatMoney(value, currencyCode) {
  if (value == null || value === "") return "-";
  return Number(value).toLocaleString("es-MX", {
    style: "currency",
    currency: currencyCode || "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatProposalStatusLabel(statusCode) {
  if (statusCode === "archived") return "Desactivada";
  return "Activa";
}

function normalizeProposalStatusCode(statusCode) {
  if (statusCode === "archived") return "archived";
  if (statusCode === "draft" || statusCode === "ready") return "active";
  if (statusCode === "active") return "active";
  return "active";
}

function getProposalTemplateContext({
  accountName,
  contactName,
  companyCommercialName,
  companyLegalName,
}) {
  const companyName =
    String(companyCommercialName || "").trim() ||
    String(companyLegalName || "").trim() ||
    "nuestra empresa";

  return {
    client_name: String(accountName || "").trim() || "cliente",
    contact_name: String(contactName || "").trim() || "contacto",
    company_name: companyName,
  };
}

function resolveProposalTemplateText(text, context) {
  return String(text || "").replace(
    /\{\{\s*(client_name|contact_name|company_name)\s*\}\}/g,
    (match, token) => context[token] || match,
  );
}

function resolveProposalTemplateBlock(block, componentCode, context) {
  if (block.type === "list") {
    return {
      ...block,
      items: Array.isArray(block.items)
        ? block.items.map((item) => resolveProposalTemplateText(item, context))
        : [],
    };
  }

  if (block.type === "heading" || block.type === "paragraph") {
    return {
      ...block,
      text: resolveProposalTemplateText(block.text, context),
    };
  }

  return block;
}

const PROPOSAL_SECTION_DISPLAY_TITLES = {
  document_rights: "Derechos del documento",
  certifications: "Certificaciones",
  presentation: "Presentación",
  mission: "Misión",
  vision: "Visión",
  key_partners: "Socios principales",
  key_clients: "Principales clientes",
  executive_summary: "Resumen ejecutivo",
  background: "Antecedentes",
  solution_description: "Descripción de la solución",
  services: "Servicios",
  product_brochures: "Folletos de los productos",
  commercial_proposal: "Propuesta económica",
  next_steps: "Siguientes pasos",
};

const PROPOSAL_BLOCK_TYPE_LABELS = {
  heading: "Encabezado",
  paragraph: "Párrafo",
  list: "Lista",
  image: "Imagen",
  brochure: "Folleto",
};
const EXECUTIVE_SUMMARY_COMPONENT_CODE = "executive_summary";
const BACKGROUND_COMPONENT_CODE = "background";
const PRODUCT_BROCHURES_COMPONENT_CODE = "product_brochures";
const PROPOSAL_BROCHURE_MAX_ITEMS = 10;
const PROPOSAL_BROCHURE_DEFAULT_REQUESTED_COUNT = 3;

function normalizeProposalAiMode(value, fallback = "auto") {
  return value === "manual" ? "manual" : fallback;
}

function getDefaultProposalAiCapabilityKey(componentCode, componentKind) {
  if (componentCode === EXECUTIVE_SUMMARY_COMPONENT_CODE) {
    return "proposal.executive_summary";
  }
  if (componentCode === BACKGROUND_COMPONENT_CODE) {
    return "proposal.background";
  }
  if (componentKind === "custom") {
    return "proposal.generic_section";
  }
  return "proposal.generic_section";
}

function isProductBrochuresComponent(componentOrCode) {
  const componentCode =
    typeof componentOrCode === "string"
      ? componentOrCode
      : componentOrCode?.componentCode;
  return (
    String(componentCode || "").trim() === PRODUCT_BROCHURES_COMPONENT_CODE
  );
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

function createBrochureBlockFromAsset(asset) {
  return {
    id: null,
    type: "brochure",
    assetPublicId: asset?.publicId || "",
    brochure: asset
      ? {
          publicId: asset.publicId || "",
          title: asset.title || "",
          summary: asset.summary || "",
          assetTypeCode: asset.assetTypeCode || "",
          assetTypeLabel:
            asset.assetTypeLabel || asset.assetTypeCode || "Activo",
          visibilityLevel: asset.visibilityLevel || "client_safe",
          visibilityLabel: asset.visibilityLabel || "Compartible con cliente",
          audienceCode: asset.audienceCode || "client",
          audienceLabel: asset.audienceLabel || "Cliente",
          files: Array.isArray(asset.files) ? asset.files : [],
          links: Array.isArray(asset.links) ? asset.links : [],
        }
      : null,
    text: "",
    items: [],
    assetId: null,
    assetVersionId: null,
    image: null,
  };
}

function normalizeProposalBlock(block) {
  if (!block || typeof block !== "object") {
    return null;
  }

  return {
    ...block,
    type: block.type || "paragraph",
    text: block.text || "",
    items: Array.isArray(block.items) ? block.items.filter(Boolean) : [],
    assetId: block.assetId || null,
    assetVersionId: block.assetVersionId || null,
    image: block.image && typeof block.image === "object" ? block.image : null,
    assetPublicId: block.assetPublicId || null,
    brochure:
      block.brochure && typeof block.brochure === "object"
        ? block.brochure
        : null,
  };
}

function normalizeProposalComponent(component) {
  if (!component || typeof component !== "object") {
    return null;
  }

  const componentKind = component?.componentKind || "custom";
  const aiEnabled =
    component?.aiEnabled === undefined
      ? Boolean(component?.aiCapabilityKey)
      : Boolean(component.aiEnabled);
  const aiMode = aiEnabled
    ? normalizeProposalAiMode(component?.aiMode, "auto")
    : null;
  const aiCapabilityKey = aiEnabled
    ? component?.aiCapabilityKey ||
      getDefaultProposalAiCapabilityKey(component?.componentCode, componentKind)
    : null;
  return {
    ...component,
    componentKind,
    isVisible:
      component?.isVisible === undefined ? true : Boolean(component.isVisible),
    aiEnabled,
    aiMode,
    aiCapabilityKey,
    layoutConfig:
      component.layoutConfig && typeof component.layoutConfig === "object"
        ? {
            ...component.layoutConfig,
            rows: Array.isArray(component.layoutConfig.rows)
              ? component.layoutConfig.rows
                  .map((row) => {
                    const blockIndexes = Array.isArray(row?.blockIndexes)
                      ? row.blockIndexes.filter((index) =>
                          Number.isInteger(index),
                        )
                      : [];
                    return blockIndexes.length ? { blockIndexes } : null;
                  })
                  .filter(Boolean)
              : [],
          }
        : null,
    blocks: Array.isArray(component.blocks)
      ? component.blocks.map(normalizeProposalBlock).filter(Boolean)
      : [],
  };
}

function normalizeProposalPricingSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  return {
    ...snapshot,
    summary:
      snapshot.summary && typeof snapshot.summary === "object"
        ? {
            ...snapshot.summary,
            subtotal: Number(snapshot.summary.subtotal || 0),
            total: Number(snapshot.summary.total || 0),
            currencyCode: snapshot.summary.currencyCode || "USD",
          }
        : null,
    sections: Array.isArray(snapshot.sections)
      ? snapshot.sections
          .filter((section) => section && typeof section === "object")
          .map((section) => ({
            ...section,
            items: Array.isArray(section.items)
              ? section.items.filter((item) => item && typeof item === "object")
              : [],
          }))
      : [],
  };
}

function normalizeProposalDetail(proposal) {
  if (!proposal || typeof proposal !== "object") return proposal;
  return {
    ...proposal,
    components: Array.isArray(proposal.components)
      ? proposal.components.map(normalizeProposalComponent).filter(Boolean)
      : [],
    pricingSnapshot: normalizeProposalPricingSnapshot(proposal.pricingSnapshot),
  };
}

function isProposalAiEnabledComponent(component) {
  return Boolean(component?.aiEnabled && component?.aiCapabilityKey);
}

function getProposalAiComponentCodes(proposal) {
  return (Array.isArray(proposal?.components) ? proposal.components : [])
    .filter((component) => isProposalAiEnabledComponent(component))
    .map((component) => component.componentCode);
}

function createDefaultProposalAiComponentState() {
  return {
    sourceMode: "auto",
    sourceScopeMode: "both",
    libraryContentMode: "source_text",
    sourcePriorityMode: "balanced",
    libraryQuery: "",
    selectedLibraryAssetPublicIds: [],
    showJobError: false,
  };
}

function buildDefaultProposalAiState() {
  return {};
}

function buildDefaultProposalAiStateFromProposal(proposal) {
  const nextState = {};
  (Array.isArray(proposal?.components) ? proposal.components : []).forEach(
    (component) => {
      if (!isProposalAiEnabledComponent(component)) {
        return;
      }
      nextState[component.componentCode] = {
        ...createDefaultProposalAiComponentState(),
        sourceMode: normalizeProposalAiMode(component.aiMode, "auto"),
      };
    },
  );
  return nextState;
}

function getProposalAiComponentState(state, componentCode) {
  return state?.[componentCode] || createDefaultProposalAiComponentState();
}

function normalizeProposalAiSourceScopeMode(value, fallback = "both") {
  if (value === "documents_only" || value === "library_only") {
    return value;
  }
  return fallback === "documents_only" || fallback === "library_only"
    ? fallback
    : "both";
}

function buildProposalAiComponentStateFromJob(
  job,
  fallbackSourceMode = "auto",
) {
  return {
    sourceMode: normalizeProposalAiMode(fallbackSourceMode, "auto"),
    sourceScopeMode: normalizeProposalAiSourceScopeMode(
      job?.request?.sourceScopeMode,
      "both",
    ),
    libraryContentMode:
      job?.request?.libraryContentMode === "summary_extract"
        ? "summary_extract"
        : "source_text",
    sourcePriorityMode:
      job?.request?.sourcePriorityMode === "non_library_first" ||
      job?.request?.sourcePriorityMode === "library_first"
        ? job.request.sourcePriorityMode
        : "balanced",
    selectedLibraryAssetPublicIds: Array.isArray(
      job?.request?.selectedLibraryAssetPublicIds,
    )
      ? job.request.selectedLibraryAssetPublicIds
      : [],
  };
}

function ProposalBlockAddIcon({ type }) {
  if (type === "heading") {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path
          fill="currentColor"
          d="M5.75 5.5a.75.75 0 0 1 .75.75v4.5h5v-4.5a.75.75 0 0 1 1.5 0v11.5a.75.75 0 0 1-1.5 0v-5.5h-5v5.5a.75.75 0 0 1-1.5 0V6.25a.75.75 0 0 1 .75-.75Zm11 0a.75.75 0 0 1 .75.75v10.8h1a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1 0-1.5h1V7h-1a.75.75 0 0 1 0-1.5h1.75Z"
        />
      </svg>
    );
  }

  if (type === "paragraph") {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path
          fill="currentColor"
          d="M5 7.25c0-.41.34-.75.75-.75h12.5a.75.75 0 0 1 0 1.5H5.75A.75.75 0 0 1 5 7.25Zm0 4.25c0-.41.34-.75.75-.75h12.5a.75.75 0 0 1 0 1.5H5.75A.75.75 0 0 1 5 11.5Zm.75 3.5a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5Z"
        />
      </svg>
    );
  }

  if (type === "list") {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path
          fill="currentColor"
          d="M6.25 6.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Zm3.5.75c0-.41.34-.75.75-.75h7.75a.75.75 0 0 1 0 1.5H10.5a.75.75 0 0 1-.75-.75Zm-3.5 4a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Zm3.5.75c0-.41.34-.75.75-.75h7.75a.75.75 0 0 1 0 1.5H10.5a.75.75 0 0 1-.75-.75Zm-3.5 4a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Zm3.5.75c0-.41.34-.75.75-.75h7.75a.75.75 0 0 1 0 1.5H10.5a.75.75 0 0 1-.75-.75Z"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.75 5A1.75 1.75 0 0 0 5 6.75v10.5C5 18.22 5.78 19 6.75 19h10.5A1.75 1.75 0 0 0 19 17.25V6.75C19 5.78 18.22 5 17.25 5H6.75Zm0 1.5h10.5c.14 0 .25.11.25.25v7.02l-2.74-2.74a1.75 1.75 0 0 0-2.47 0l-3.54 3.54-1.04-1.04a1.75 1.75 0 0 0-2.21-.22V6.75c0-.14.11-.25.25-.25Zm9 2a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5ZM6.5 17.25v-1.82l1.51-1.51a.25.25 0 0 1 .35 0l1.57 1.57 3.42-3.42a.25.25 0 0 1 .35 0l3.8 3.8v1.38a.25.25 0 0 1-.25.25H6.75a.25.25 0 0 1-.25-.25Z"
      />
    </svg>
  );
}

function normalizeComparableLabel(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function getProposalSectionDisplayTitle(componentCode, currentTitle) {
  const fallbackTitle = currentTitle || componentCode || "";
  const canonicalTitle = PROPOSAL_SECTION_DISPLAY_TITLES[componentCode];
  if (!canonicalTitle) {
    return fallbackTitle;
  }

  const normalizedCurrentTitle = normalizeComparableLabel(currentTitle);
  const normalizedCanonicalTitle = normalizeComparableLabel(canonicalTitle);
  const normalizedComponentCode = normalizeComparableLabel(componentCode);

  if (
    !normalizedCurrentTitle ||
    normalizedCurrentTitle === normalizedCanonicalTitle ||
    normalizedCurrentTitle === normalizedComponentCode
  ) {
    return canonicalTitle;
  }

  return fallbackTitle;
}

function getProposalSectionLayout(component) {
  if (component && typeof component === "object") {
    const explicitMode = String(
      component.resolvedLayoutMode || component.layoutConfig?.mode || "",
    )
      .trim()
      .toLowerCase();
    if (explicitMode) {
      return explicitMode;
    }

    return component.componentCode === "certifications"
      ? "horizontal-gallery"
      : "stack";
  }

  return component === "certifications" ? "horizontal-gallery" : "stack";
}

function getProposalBlockTypeLabel(type) {
  return PROPOSAL_BLOCK_TYPE_LABELS[type] || type || "Bloque";
}

function normalizeProposalTemplateOption(template) {
  return {
    id: Number(template.id),
    code: template.code || "",
    name: template.name || "",
    description: template.description || "",
    previewTitle: template.previewTitle || template.preview_title || "",
    coverStyle: template.coverStyle || template.cover_style || "corporate",
    isDefault: Boolean(template.isDefault ?? template.is_default),
  };
}

function normalizeAssetOption(asset) {
  return {
    id: Number(asset.id),
    name: asset.name || "",
    category: asset.category || "generic_proposal_media",
    status: asset.status || "active",
    currentVersion: asset.currentVersion
      ? {
          id: Number(asset.currentVersion.id),
          versionNumber: Number(asset.currentVersion.versionNumber || 1),
          fileUrl: asset.currentVersion.fileUrl || "",
          fileName: asset.currentVersion.fileName || "",
          altText: asset.currentVersion.altText || "",
          caption: asset.currentVersion.caption || "",
        }
      : null,
  };
}

function normalizeCommercialEnablementAssetOption(asset) {
  return {
    publicId: asset.publicId || "",
    title: asset.title || "",
    summary: asset.summary || "",
    assetTypeCode: asset.assetTypeCode || "",
    assetTypeLabel: asset.assetTypeLabel || asset.assetTypeCode || "Activo",
    visibilityLevel: asset.visibilityLevel || "client_safe",
    visibilityLabel: asset.visibilityLabel || "Compartible con cliente",
    audienceCode: asset.audienceCode || "client",
    audienceLabel: asset.audienceLabel || "Cliente",
    files: Array.isArray(asset.files) ? asset.files : [],
    links: Array.isArray(asset.links) ? asset.links : [],
    catalogs: Array.isArray(asset.catalogs) ? asset.catalogs : [],
    tags: Array.isArray(asset.tags) ? asset.tags : [],
  };
}

function getCommercialEnablementCatalogNames(asset, catalogType, limit = 2) {
  return (Array.isArray(asset?.catalogs) ? asset.catalogs : [])
    .filter((entry) => entry.catalogType === catalogType)
    .map((entry) => entry.name)
    .filter(Boolean)
    .slice(0, limit);
}

function parseJsonObject(value) {
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

function normalizeProposalAiSuggestion(result) {
  const parsedResult = parseJsonObject(result);
  if (!parsedResult?.suggestion) return null;
  return {
    title: parsedResult.suggestion.title || "Resumen ejecutivo sugerido",
    blocks: Array.isArray(parsedResult.suggestion.blocks)
      ? parsedResult.suggestion.blocks.map((block) => ({
          type: block.type || "paragraph",
          text: block.text || "",
          items: Array.isArray(block.items) ? block.items : [],
          assetId: null,
          assetVersionId: null,
          image: null,
        }))
      : [],
    plainText: parsedResult.suggestion.plainText || "",
    sourceSummary: parsedResult.sourceSummary || null,
    sources: parsedResult.sources || null,
    warnings: Array.isArray(parsedResult.warnings) ? parsedResult.warnings : [],
  };
}

function normalizeProposalAiJob(job) {
  if (!job?.publicId) return null;
  const parsedResult = parseJsonObject(job.result);
  return {
    publicId: job.publicId,
    status: job.status || "pending",
    createdAt: job.createdAt || null,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    updatedAt: job.updatedAt || null,
    progress: {
      phase: job.progress?.phase || "queued",
      label: job.progress?.label || "Trabajo en cola",
      percent: Number(job.progress?.percent || 0),
    },
    request: {
      languageCode: job.request?.languageCode || "es",
      instructions: job.request?.instructions || "",
      maxLibraryAssets: Number(job.request?.maxLibraryAssets || 4),
      librarySourceMode:
        job.request?.librarySourceMode === "manual" ? "manual" : "auto",
      libraryContentMode:
        job.request?.libraryContentMode === "summary_extract"
          ? "summary_extract"
          : "source_text",
      sourcePriorityMode:
        job.request?.sourcePriorityMode === "non_library_first" ||
        job.request?.sourcePriorityMode === "library_first"
          ? job.request.sourcePriorityMode
          : "balanced",
      selectedLibraryAssetPublicIds: Array.isArray(
        job.request?.selectedLibraryAssetPublicIds,
      )
        ? job.request.selectedLibraryAssetPublicIds
        : [],
    },
    result: parsedResult,
    error: job.error || null,
  };
}

function isProposalAiJobTerminal(job) {
  return job?.status === "completed" || job?.status === "failed";
}

function formatExecutiveSummaryLibraryContentModeLabel(mode) {
  return mode === "summary_extract" ? "Summary + extract" : "Texto fuente";
}

function formatExecutiveSummarySourcePriorityModeLabel(mode) {
  if (mode === "non_library_first") return "Documentos primero";
  if (mode === "library_first") return "Biblioteca primero";
  return "Balanceado";
}

function formatProposalAiSourceScopeModeLabel(mode) {
  if (mode === "documents_only") return "Solo documentos";
  if (mode === "library_only") return "Solo biblioteca";
  return "Ambas";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No fue posible leer el archivo"));
    reader.readAsDataURL(file);
  });
}

function ProposalAiIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M12 3.75a.75.75 0 0 1 .73.58l.52 2.21a3 3 0 0 0 2.23 2.23l2.21.52a.75.75 0 0 1 0 1.46l-2.21.52a3 3 0 0 0-2.23 2.23l-.52 2.21a.75.75 0 0 1-1.46 0l-.52-2.21a3 3 0 0 0-2.23-2.23l-2.21-.52a.75.75 0 0 1 0-1.46l2.21-.52a3 3 0 0 0 2.23-2.23l.52-2.21A.75.75 0 0 1 12 3.75Zm6.25 11.5a.75.75 0 0 1 .73.58l.18.77a1.5 1.5 0 0 0 1.11 1.11l.77.18a.75.75 0 0 1 0 1.46l-.77.18a1.5 1.5 0 0 0-1.11 1.11l-.18.77a.75.75 0 0 1-1.46 0l-.18-.77a1.5 1.5 0 0 0-1.11-1.11l-.77-.18a.75.75 0 0 1 0-1.46l.77-.18a1.5 1.5 0 0 0 1.11-1.11l.18-.77a.75.75 0 0 1 .73-.58Zm-12.5 2a.75.75 0 0 1 .73.58l.13.55a1.25 1.25 0 0 0 .92.92l.55.13a.75.75 0 0 1 0 1.46l-.55.13a1.25 1.25 0 0 0-.92.92l-.13.55a.75.75 0 0 1-1.46 0l-.13-.55a1.25 1.25 0 0 0-.92-.92l-.55-.13a.75.75 0 0 1 0-1.46l.55-.13a1.25 1.25 0 0 0 .92-.92l.13-.55a.75.75 0 0 1 .73-.58Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ProposalAiDocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M7 3.75A1.75 1.75 0 0 0 5.25 5.5v13A1.75 1.75 0 0 0 7 20.25h10A1.75 1.75 0 0 0 18.75 18.5V9.31a1.75 1.75 0 0 0-.5-1.23l-3.33-3.33a1.75 1.75 0 0 0-1.23-.5zm6.25 1.9 3.6 3.6h-2.1A1.5 1.5 0 0 1 13.25 7.75zM8.5 11.25a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1-.75-.75zm0 3.5a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1-.75-.75z" />
    </svg>
  );
}

function ProposalAiPriorityIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M6.22 7.72a.75.75 0 0 1 1.06 0L9.25 9.69V5.5a.75.75 0 0 1 1.5 0v4.19l1.97-1.97a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L6.22 8.78a.75.75 0 0 1 0-1.06zM10 12.75a.75.75 0 0 1 .75.75v4.19l1.97-1.97a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0l-3.25-3.25a.75.75 0 0 1 1.06-1.06l1.97 1.97V13.5a.75.75 0 0 1 .75-.75zm5.25-7a.75.75 0 0 1 .75.75v11a.75.75 0 0 1-1.5 0v-11a.75.75 0 0 1 .75-.75z" />
    </svg>
  );
}

function cloneComponentDraft(component) {
  const isBrochureComponent = isProductBrochuresComponent(component);
  return {
    title: component.title || "",
    blocks: Array.isArray(component.blocks)
      ? component.blocks.map((block) => ({
          id: block.id || null,
          type: block.type || "paragraph",
          text: block.text || "",
          items: Array.isArray(block.items) ? block.items : [],
          assetId: block.assetId || null,
          assetVersionId: block.assetVersionId || null,
          image: block.image || null,
          assetPublicId: block.assetPublicId || null,
          brochure: block.brochure || null,
        }))
      : [],
    brochureSelectionMode: isBrochureComponent
      ? normalizeProposalBrochureSelectionMode(
          component?.aiSettings?.selectionMode,
          "manual",
        )
      : "manual",
    requestedBrochureCount: isBrochureComponent
      ? normalizeProposalBrochureRequestedCount(
          component?.aiSettings?.requestedBrochureCount,
          PROPOSAL_BROCHURE_DEFAULT_REQUESTED_COUNT,
        )
      : PROPOSAL_BROCHURE_DEFAULT_REQUESTED_COUNT,
  };
}

function buildComponentDraftMap(components) {
  return Object.fromEntries(
    (Array.isArray(components) ? components : []).map((component) => [
      component.componentCode,
      cloneComponentDraft(component),
    ]),
  );
}

function buildMetadataDraftFromProposal(proposal) {
  return {
    title: proposal?.title || "",
    statusCode: normalizeProposalStatusCode(proposal?.statusCode),
  };
}

function serializeComponentDraft(draft, componentCode = null) {
  const isBrochureComponent = isProductBrochuresComponent(componentCode);
  return {
    title: draft.title,
    blocks: draft.blocks.map((block) => ({
      type: block.type,
      text: block.text || "",
      items: Array.isArray(block.items) ? block.items.filter(Boolean) : [],
      assetId: block.assetId || null,
      assetVersionId: block.assetVersionId || null,
      image:
        block.type === "image" && !block.assetId && !block.assetVersionId
          ? block.image || null
          : null,
      assetPublicId: block.assetPublicId || null,
    })),
    ...(isBrochureComponent
      ? {
          componentSettings: {
            selectionMode: normalizeProposalBrochureSelectionMode(
              draft.brochureSelectionMode,
              "manual",
            ),
            requestedBrochureCount: normalizeProposalBrochureRequestedCount(
              draft.requestedBrochureCount,
              PROPOSAL_BROCHURE_DEFAULT_REQUESTED_COUNT,
            ),
          },
        }
      : {}),
  };
}

function createEmptyBlock(type = "paragraph") {
  return {
    id: null,
    type,
    text: "",
    items: type === "list" ? [""] : [],
    assetId: null,
    assetVersionId: null,
    image: null,
  };
}

function hasPreviewableBlockContent(block) {
  if (!block) return false;
  if (block.type === "brochure") {
    return Boolean(block.brochure?.publicId || block.assetPublicId);
  }
  if (block.type === "image") {
    return Boolean(
      block.image?.fileUrl || block.assetId || block.assetVersionId,
    );
  }
  if (block.type === "list") {
    return Array.isArray(block.items) && block.items.filter(Boolean).length > 0;
  }
  return Boolean(String(block.text || "").trim());
}

function isProposalComponentDirty(component, componentDrafts) {
  if (!component) return false;
  const persisted = serializeComponentDraft(
    cloneComponentDraft(component),
    component.componentCode,
  );
  const current = serializeComponentDraft(
    componentDrafts[component.componentCode] || cloneComponentDraft(component),
    component.componentCode,
  );
  return JSON.stringify(persisted) !== JSON.stringify(current);
}

function buildProposalPrintModel(
  selectedProposal,
  metadataDraft,
  componentDrafts,
  companyBranding,
) {
  if (!selectedProposal) return null;

  const templateContext = getProposalTemplateContext({
    accountName: selectedProposal.accountName,
    contactName: selectedProposal.contactName,
    companyCommercialName: companyBranding?.commercialName,
    companyLegalName: companyBranding?.legalName,
  });

  const brochureBlocks = [];
  const sections = (selectedProposal.components || [])
    .map((component) => {
      const draft = componentDrafts[component.componentCode];
      const resolvedDraft = draft || cloneComponentDraft(component);
      const blocks = (
        Array.isArray(resolvedDraft.blocks) ? resolvedDraft.blocks : []
      )
        .map((block) => {
          if (!hasPreviewableBlockContent(block)) return null;

          if (block.type === "brochure") {
            const brochureBlock = {
              type: "brochure",
              brochure: block.brochure || null,
              assetPublicId: block.assetPublicId || null,
            };
            brochureBlocks.push(brochureBlock);
            return null;
          }

          if (block.type === "image") {
            return block.image?.fileUrl
              ? {
                  type: "image",
                  title: resolvedDraft.title || component.title || "",
                  image: {
                    fileUrl: block.image.fileUrl,
                    fileName: block.image.fileName || "",
                    altText:
                      block.image.altText ||
                      resolvedDraft.title ||
                      component.title ||
                      "Imagen de propuesta",
                    caption: block.image.caption || "",
                  },
                }
              : null;
          }

          if (block.type === "list") {
            return {
              type: "list",
              items: Array.isArray(block.items)
                ? resolveProposalTemplateBlock(
                    {
                      type: "list",
                      items: block.items.filter(Boolean),
                    },
                    component.componentCode,
                    templateContext,
                  ).items
                : [],
            };
          }

          return resolveProposalTemplateBlock(
            {
              type: block.type || "paragraph",
              text: block.text || "",
            },
            component.componentCode,
            templateContext,
          );
        })
        .filter(Boolean);

      if (!blocks.length) {
        return null;
      }

      return {
        id: component.componentCode,
        title: getProposalSectionDisplayTitle(
          component.componentCode,
          resolvedDraft.title || component.title || component.componentCode,
        ),
        subtitle: component.componentCode,
        layout: getProposalSectionLayout(component),
        layoutConfig: component.layoutConfig
          ? {
              mode: component.layoutConfig.mode,
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
        blocks,
      };
    })
    .filter(Boolean);

  const pricingSummary = selectedProposal.pricingSnapshot?.summary || null;
  const pricingSections = (
    selectedProposal.pricingSnapshot?.sections || []
  ).map((section) => ({
    id: section.id,
    title: section.title || "Seccion sin titulo",
    items: (section.items || [])
      .filter((item) => item.itemType !== "grupo_productos")
      .map((item) => ({
        id: item.id,
        productCode: item.productCode || "-",
        productDescription: item.productDescription || "Sin descripcion",
        quantity: item.quantity || 0,
        salePriceTotal: Number(item.salePriceTotal || 0),
        totalLabel: formatMoney(
          item.salePriceTotal,
          pricingSummary?.currencyCode,
        ),
      })),
  }));

  return {
    title: metadataDraft.title || selectedProposal.title || "",
    statusCode: normalizeProposalStatusCode(
      metadataDraft.statusCode || selectedProposal.statusCode || "active",
    ),
    statusLabel: formatProposalStatusLabel(
      normalizeProposalStatusCode(
        metadataDraft.statusCode || selectedProposal.statusCode || "active",
      ),
    ),
    templateName: selectedProposal.templateName || "Sin plantilla",
    coverStyle: selectedProposal.templateSnapshot?.coverStyle || "corporate",
    updatedAtLabel: formatDateTime(selectedProposal.updatedAt),
    accountName: selectedProposal.accountName || "Sin cuenta",
    contactName: selectedProposal.contactName || "Sin contacto",
    quotationId: selectedProposal.quotationId || "-",
    quotationVersionNumber: selectedProposal.quotationVersionNumber || "-",
    sections,
    brochureBlocks,
    pricing: {
      summary: {
        subtotal: Number(pricingSummary?.subtotal || 0),
        total: Number(pricingSummary?.total || 0),
        currencyCode: pricingSummary?.currencyCode || "USD",
        subtotalLabel: formatMoney(
          pricingSummary?.subtotal,
          pricingSummary?.currencyCode,
        ),
        totalLabel: formatMoney(
          pricingSummary?.total,
          pricingSummary?.currencyCode,
        ),
      },
      sections: pricingSections,
    },
  };
}

function buildProposalQuotationAttachmentRef(selectedProposal) {
  const quotationVersionId =
    Number(selectedProposal?.quotationVersionId || 0) || null;
  if (!quotationVersionId) {
    return null;
  }

  return { quotationVersionId };
}

function buildProposalPdfPayload(printModel, selectedProposal) {
  if (!printModel || typeof printModel !== "object") {
    return null;
  }

  const quotationAttachmentRef =
    buildProposalQuotationAttachmentRef(selectedProposal);
  if (!quotationAttachmentRef) {
    return null;
  }

  return {
    header: {
      proposalTitle: printModel.title || "",
      accountName: printModel.accountName || "",
      contactName: printModel.contactName || "",
      quotationNumber: String(printModel.quotationId || ""),
      quotationVersionNumber: String(printModel.quotationVersionNumber || ""),
      updatedAtLabel: printModel.updatedAtLabel || "",
      statusLabel: printModel.statusLabel || "",
      templateName: printModel.templateName || "",
    },
    theme: {
      coverStyle: printModel.coverStyle || "corporate",
    },
    sections: Array.isArray(printModel.sections)
      ? printModel.sections.map((section) => ({
          title: section.title || "Seccion sin titulo",
          subtitle: section.subtitle || "",
          layout: section.layout || "stack",
          layoutConfig: section.layoutConfig
            ? {
                mode: section.layoutConfig.mode || section.layout || "stack",
                rows: Array.isArray(section.layoutConfig.rows)
                  ? section.layoutConfig.rows.map((row) => ({
                      blockIndexes: Array.isArray(row.blockIndexes)
                        ? row.blockIndexes.filter((index) =>
                            Number.isInteger(index),
                          )
                        : [],
                    }))
                  : undefined,
              }
            : null,
          blocks: Array.isArray(section.blocks)
            ? section.blocks
                .map((block) => {
                  if (block.type === "brochure") {
                    return block.brochure?.publicId || block.assetPublicId
                      ? {
                          type: "brochure",
                          assetPublicId:
                            block.brochure?.publicId || block.assetPublicId,
                          brochure: block.brochure || null,
                        }
                      : null;
                  }

                  if (block.type === "brochure") {
                    return block.brochure?.publicId || block.assetPublicId
                      ? {
                          type: "brochure",
                          assetPublicId:
                            block.brochure?.publicId || block.assetPublicId,
                          brochure: block.brochure || null,
                        }
                      : null;
                  }

                  if (block.type === "image") {
                    return block.image?.fileUrl
                      ? {
                          type: "image",
                          image: {
                            fileUrl: block.image.fileUrl,
                            altText: block.image.altText || "",
                            caption: block.image.caption || "",
                            fileName: block.image.fileName || "",
                          },
                        }
                      : null;
                  }

                  if (block.type === "list") {
                    return {
                      type: "list",
                      items: Array.isArray(block.items)
                        ? block.items.filter(Boolean)
                        : [],
                    };
                  }

                  return {
                    type: block.type || "paragraph",
                    text: block.text || "",
                  };
                })
                .filter(Boolean)
            : [],
        }))
      : [],
    brochureBlocks: Array.isArray(printModel.brochureBlocks)
      ? printModel.brochureBlocks
          .map((block) =>
            block.brochure?.publicId || block.assetPublicId
              ? {
                  type: "brochure",
                  assetPublicId:
                    block.brochure?.publicId || block.assetPublicId,
                  brochure: block.brochure || null,
                }
              : null,
          )
          .filter(Boolean)
      : [],
    pricing: {
      summary: {
        subtotal: Number(printModel.pricing?.summary?.subtotal || 0),
        total: Number(printModel.pricing?.summary?.total || 0),
        currencyCode: printModel.pricing?.summary?.currencyCode || "USD",
      },
      sections: Array.isArray(printModel.pricing?.sections)
        ? printModel.pricing.sections.map((section) => ({
            title: section.title || "Seccion sin titulo",
            items: Array.isArray(section.items)
              ? section.items.map((item) => ({
                  productCode: item.productCode || "",
                  productDescription: item.productDescription || "",
                  quantity: Number(item.quantity || 0),
                  salePriceTotal: Number(item.salePriceTotal || 0),
                }))
              : [],
          }))
        : [],
    },
    quotationAttachmentRef,
  };
}

function isProposalPreviewDirty(
  selectedProposal,
  metadataDraft,
  componentDrafts,
) {
  if (!selectedProposal) return false;

  if ((metadataDraft.title || "") !== (selectedProposal.title || "")) {
    return true;
  }
  if (
    normalizeProposalStatusCode(metadataDraft.statusCode || "active") !==
    normalizeProposalStatusCode(selectedProposal.statusCode || "active")
  ) {
    return true;
  }

  const persistedComponents = (selectedProposal.components || []).map(
    (component) =>
      serializeComponentDraft(
        cloneComponentDraft(component),
        component.componentCode,
      ),
  );
  const currentComponents = (selectedProposal.components || []).map(
    (component) =>
      serializeComponentDraft(
        componentDrafts[component.componentCode] ||
          cloneComponentDraft(component),
        component.componentCode,
      ),
  );

  return (
    JSON.stringify(persistedComponents) !== JSON.stringify(currentComponents)
  );
}

function ProposalComponentCard({
  component,
  draft,
  proposalId,
  assets,
  busy,
  isDirty,
  aiJob,
  aiSuggestion,
  proposalAiState,
  proposalAiLibraryAssets,
  proposalAiLibraryLoading,
  componentBrochureSuggestion,
  brochureLibraryQuery,
  isBrochureRecommendationBusy,
  onProposalAiLibraryContentModeChange,
  onProposalAiSourceScopeModeChange,
  onProposalAiSourcePriorityModeChange,
  onProposalAiLibraryQueryChange,
  onToggleProposalAiLibraryAsset,
  onBrochureLibraryQueryChange,
  onChangeDraft,
  onSave,
  onGenerateSuggestion,
  onRecommendBrochures,
  onApplySuggestion,
  onApplyBrochureSuggestion,
  onDismissSuggestion,
  onDismissBrochureSuggestion,
}) {
  const displayTitle = getProposalSectionDisplayTitle(
    component.componentCode,
    draft.title || component.title || component.componentCode,
  );
  const isAiEnabledComponent = isProposalAiEnabledComponent(component);
  const isProductBrochureSection = isProductBrochuresComponent(component);
  const componentAiState = getProposalAiComponentState(
    proposalAiState,
    component.componentCode,
  );
  const usesLibraryScope =
    componentAiState.sourceScopeMode !== "documents_only";
  const usesDocumentsScope =
    componentAiState.sourceScopeMode !== "library_only";
  const isGeneratingSuggestion =
    aiJob && ["pending", "running"].includes(aiJob.status);
  const [isAiPanelExpanded, setIsAiPanelExpanded] = useState(false);
  const [isAiSuggestionExpanded, setIsAiSuggestionExpanded] = useState(false);

  useEffect(() => {
    setIsAiPanelExpanded(false);
    setIsAiSuggestionExpanded(false);
  }, [proposalId, component.componentCode]);
  const filteredProposalAiLibraryAssets = isAiEnabledComponent
    ? proposalAiLibraryAssets.filter((asset) => {
        const normalizedQuery = normalizeComparableLabel(
          componentAiState.libraryQuery,
        );
        if (!normalizedQuery) return true;

        return normalizeComparableLabel(
          [
            asset.title,
            asset.summary,
            asset.assetTypeLabel,
            ...getCommercialEnablementCatalogNames(asset, "manufacturer", 4),
            ...getCommercialEnablementCatalogNames(asset, "solution", 4),
          ].join(" "),
        ).includes(normalizedQuery);
      })
    : [];
  const selectedProposalAiAssets = isAiEnabledComponent
    ? componentAiState.selectedLibraryAssetPublicIds.map(
        (assetPublicId) =>
          proposalAiLibraryAssets.find(
            (asset) => asset.publicId === assetPublicId,
          ) || null,
      )
    : [];
  const selectedBrochureBlocks = isProductBrochureSection
    ? draft.blocks.filter((block) => block.type === "brochure")
    : [];
  const selectedBrochureAssets = isProductBrochureSection
    ? selectedBrochureBlocks
        .map(
          (block) =>
            proposalAiLibraryAssets.find(
              (asset) => asset.publicId === block.assetPublicId,
            ) ||
            block.brochure ||
            null,
        )
        .filter(Boolean)
    : [];
  const filteredBrochureAssets = isProductBrochureSection
    ? proposalAiLibraryAssets.filter((asset) => {
        const normalizedQuery = normalizeComparableLabel(brochureLibraryQuery);
        if (!normalizedQuery) return true;
        return normalizeComparableLabel(
          [
            asset.title,
            asset.summary,
            asset.assetTypeLabel,
            ...getCommercialEnablementCatalogNames(asset, "manufacturer", 4),
            ...getCommercialEnablementCatalogNames(asset, "solution", 4),
          ].join(" "),
        ).includes(normalizedQuery);
      })
    : [];
  const canGenerateProposalAiSuggestion =
    !busy &&
    !isGeneratingSuggestion &&
    (!isAiEnabledComponent ||
      !usesLibraryScope ||
      componentAiState.sourceMode === "auto" ||
      componentAiState.selectedLibraryAssetPublicIds.length > 0);

  function updateBrochureBlocks(nextBlocks) {
    onChangeDraft(component.componentCode, {
      ...draft,
      blocks: nextBlocks,
    });
  }

  function toggleBrochureAsset(asset) {
    const currentBlocks = Array.isArray(draft.blocks)
      ? draft.blocks.filter((block) => block.type === "brochure")
      : [];
    const existingIndex = currentBlocks.findIndex(
      (block) => block.assetPublicId === asset.publicId,
    );
    if (existingIndex >= 0) {
      updateBrochureBlocks(
        currentBlocks.filter((block) => block.assetPublicId !== asset.publicId),
      );
      return;
    }
    if (currentBlocks.length >= PROPOSAL_BROCHURE_MAX_ITEMS) {
      return;
    }
    updateBrochureBlocks([
      ...currentBlocks,
      createBrochureBlockFromAsset(asset),
    ]);
  }

  function moveBrochureAsset(assetPublicId, direction) {
    const currentBlocks = Array.isArray(draft.blocks)
      ? [...draft.blocks.filter((block) => block.type === "brochure")]
      : [];
    const currentIndex = currentBlocks.findIndex(
      (block) => block.assetPublicId === assetPublicId,
    );
    if (currentIndex === -1) return;
    const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex < 0 || nextIndex >= currentBlocks.length) return;
    const [moved] = currentBlocks.splice(currentIndex, 1);
    currentBlocks.splice(nextIndex, 0, moved);
    updateBrochureBlocks(currentBlocks);
  }

  function updateBlock(index, changes) {
    onChangeDraft(component.componentCode, {
      ...draft,
      blocks: draft.blocks.map((block, blockIndex) =>
        blockIndex === index ? { ...block, ...changes } : block,
      ),
    });
  }

  function removeBlock(index) {
    onChangeDraft(component.componentCode, {
      ...draft,
      blocks: draft.blocks.filter((_, blockIndex) => blockIndex !== index),
    });
  }

  async function selectLocalImage(index, file) {
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    updateBlock(index, {
      assetId: null,
      assetVersionId: null,
      image: {
        fileUrl: dataUrl,
        fileName: file.name || "imagen-local",
        mimeType: file.type || "image/*",
        fileSizeBytes: Number(file.size || 0) || null,
        altText: "",
        caption: "",
      },
    });
  }

  return (
    <section
      className={
        isDirty ? "proposal-component-card is-dirty" : "proposal-component-card"
      }
    >
      <div className="proposal-component-card-head">
        <div>
          <div className="proposal-component-card-title-row">
            <h4>{displayTitle}</h4>
            {isDirty ? (
              <span className="proposal-chip proposal-chip-soft">
                Cambios sin guardar
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <label className="proposal-component-title-field">
        <span>Titulo visible</span>
        <input
          type="text"
          value={draft.title}
          onChange={(event) =>
            onChangeDraft(component.componentCode, {
              ...draft,
              title: event.target.value,
            })
          }
        />
      </label>

      {isProductBrochureSection ? (
        <section className="proposal-brochure-panel">
          <div className="proposal-brochure-panel-head">
            <div>
              <strong>Folletos de la biblioteca comercial</strong>
              <p className="field-hint">
                Selecciona folletos manualmente o pide una recomendacion
                automatica. Esta seccion no genera texto, solo adjunta folletos.
              </p>
            </div>
          </div>

          <div className="proposal-component-ai-policy-card proposal-component-ai-scope-card">
            <div className="proposal-component-ai-policy-head">
              <span className="proposal-component-ai-policy-icon">
                <ProposalAiPriorityIcon />
              </span>
              <div>
                <strong>Modo de seleccion</strong>
                <p className="field-hint">
                  Manual para elegir folletos especificos o automatico con IA
                  para recibir una recomendacion.
                </p>
              </div>
            </div>
            <div className="proposal-component-ai-policy-toggle is-dual">
              <button
                type="button"
                className={
                  draft.brochureSelectionMode === "manual"
                    ? "proposal-component-ai-policy-pill is-selected"
                    : "proposal-component-ai-policy-pill"
                }
                onClick={() =>
                  onChangeDraft(component.componentCode, {
                    ...draft,
                    brochureSelectionMode: "manual",
                  })
                }
              >
                <ProposalAiDocumentIcon />
                <span>Manual</span>
              </button>
              <button
                type="button"
                className={
                  draft.brochureSelectionMode === "auto"
                    ? "proposal-component-ai-policy-pill is-selected"
                    : "proposal-component-ai-policy-pill"
                }
                onClick={() =>
                  onChangeDraft(component.componentCode, {
                    ...draft,
                    brochureSelectionMode: "auto",
                  })
                }
              >
                <ProposalAiIcon />
                <span>Automatico con IA</span>
              </button>
            </div>
          </div>

          {draft.brochureSelectionMode === "auto" ? (
            <div className="proposal-brochure-auto-controls">
              <label className="proposal-brochure-count-field">
                <span>Cantidad de folletos</span>
                <input
                  type="number"
                  min="1"
                  max={String(PROPOSAL_BROCHURE_MAX_ITEMS)}
                  value={draft.requestedBrochureCount}
                  onChange={(event) =>
                    onChangeDraft(component.componentCode, {
                      ...draft,
                      requestedBrochureCount:
                        normalizeProposalBrochureRequestedCount(
                          event.target.value,
                          PROPOSAL_BROCHURE_DEFAULT_REQUESTED_COUNT,
                        ),
                    })
                  }
                />
              </label>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy || isBrochureRecommendationBusy}
                onClick={() => onRecommendBrochures(component.componentCode)}
              >
                {isBrochureRecommendationBusy
                  ? "Recomendando..."
                  : "Sugerir folletos con IA"}
              </button>
            </div>
          ) : null}

          {componentBrochureSuggestion ? (
            <div className="proposal-component-ai-suggestion-card">
              <div className="proposal-component-ai-suggestion-copy">
                <strong>Folletos sugeridos</strong>
                <p className="field-hint">
                  La sugerencia reemplazara la seleccion actual solo cuando la
                  apliques.
                </p>
              </div>
              <div className="proposal-brochure-selected-list">
                {componentBrochureSuggestion.items.map((asset) => (
                  <article
                    key={`${component.componentCode}-suggested-${asset.publicId}`}
                    className="proposal-brochure-card"
                  >
                    <div>
                      <strong>{asset.title}</strong>
                      <p>{asset.summary || "Sin resumen disponible"}</p>
                    </div>
                    <div className="proposal-brochure-card-meta">
                      <span>{asset.assetTypeLabel}</span>
                      <span>
                        {asset.files.length} archivo(s) · {asset.links.length}{" "}
                        URL(s)
                      </span>
                    </div>
                  </article>
                ))}
              </div>
              {componentBrochureSuggestion.warnings.length ? (
                <div className="proposal-brochure-warnings">
                  {componentBrochureSuggestion.warnings.map(
                    (warning, index) => (
                      <span key={`${component.componentCode}-warning-${index}`}>
                        {warning.message}
                      </span>
                    ),
                  )}
                </div>
              ) : null}
              <div className="proposal-component-ai-actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() =>
                    onApplyBrochureSuggestion(component.componentCode)
                  }
                >
                  Usar sugerencia
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    onDismissBrochureSuggestion(component.componentCode)
                  }
                >
                  Descartar
                </button>
              </div>
            </div>
          ) : null}

          <div className="proposal-component-ai-library-selected-bar">
            <strong>
              Folletos seleccionados: {selectedBrochureAssets.length}
            </strong>
            {selectedBrochureAssets.length >= PROPOSAL_BROCHURE_MAX_ITEMS ? (
              <span className="field-hint">
                Capacidad tecnica maxima alcanzada (
                {PROPOSAL_BROCHURE_MAX_ITEMS}).
              </span>
            ) : null}
          </div>

          {selectedBrochureAssets.length ? (
            <div className="proposal-brochure-selected-list">
              {selectedBrochureAssets.map((asset, index) => (
                <article
                  key={`${component.componentCode}-selected-${asset.publicId}`}
                  className="proposal-brochure-card"
                >
                  <div>
                    <strong>{asset.title}</strong>
                    <p>{asset.summary || "Sin resumen disponible"}</p>
                  </div>
                  <div className="proposal-brochure-card-meta">
                    <span>{asset.assetTypeLabel || "Activo"}</span>
                    <span>
                      {(asset.files || []).length} archivo(s) ·{" "}
                      {(asset.links || []).length} URL(s)
                    </span>
                  </div>
                  <div className="proposal-brochure-card-actions">
                    <button
                      type="button"
                      className="btn-tertiary"
                      disabled={index === 0}
                      onClick={() => moveBrochureAsset(asset.publicId, "up")}
                    >
                      Subir
                    </button>
                    <button
                      type="button"
                      className="btn-tertiary"
                      disabled={index === selectedBrochureAssets.length - 1}
                      onClick={() => moveBrochureAsset(asset.publicId, "down")}
                    >
                      Bajar
                    </button>
                    <button
                      type="button"
                      className="btn-tertiary"
                      onClick={() =>
                        updateBrochureBlocks(
                          selectedBrochureBlocks.filter(
                            (block) => block.assetPublicId !== asset.publicId,
                          ),
                        )
                      }
                    >
                      Quitar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="field-hint proposal-component-ai-helper-note">
              Aun no hay folletos seleccionados para esta propuesta.
            </p>
          )}

          {draft.brochureSelectionMode === "manual" ? (
            <div className="proposal-component-ai-library-picker">
              <label className="proposal-component-ai-library-search">
                <span>Buscar folletos</span>
                <input
                  type="search"
                  value={brochureLibraryQuery}
                  placeholder="Buscar por titulo, resumen, fabricante o solucion"
                  onChange={(event) =>
                    onBrochureLibraryQueryChange(
                      component.componentCode,
                      event.target.value,
                    )
                  }
                />
              </label>

              {proposalAiLibraryLoading ? (
                <div className="proposal-component-ai-status-row">
                  <span
                    className="proposal-component-ai-spinner"
                    aria-hidden="true"
                  />
                  <span>Cargando biblioteca comercial...</span>
                </div>
              ) : filteredBrochureAssets.length ? (
                <div className="proposal-component-ai-library-grid">
                  {filteredBrochureAssets.slice(0, 12).map((asset) => {
                    const isSelected = selectedBrochureBlocks.some(
                      (block) => block.assetPublicId === asset.publicId,
                    );
                    return (
                      <label
                        key={asset.publicId}
                        className={
                          isSelected
                            ? "proposal-component-ai-library-option is-selected"
                            : "proposal-component-ai-library-option"
                        }
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleBrochureAsset(asset)}
                          disabled={
                            !isSelected &&
                            selectedBrochureBlocks.length >=
                              PROPOSAL_BROCHURE_MAX_ITEMS
                          }
                        />
                        <div className="proposal-component-ai-library-option-copy">
                          <div className="proposal-component-ai-library-option-topline">
                            <strong>{asset.title}</strong>
                            <span>{asset.assetTypeLabel}</span>
                          </div>
                          <p>{asset.summary || "Sin resumen disponible"}</p>
                          <div className="proposal-component-ai-library-option-meta">
                            <span>{asset.visibilityLabel}</span>
                            <span>
                              {asset.files.length} archivo(s) ·{" "}
                              {asset.links.length} URL(s)
                            </span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="proposal-component-ai-library-empty">
                  <strong>No hay folletos disponibles</strong>
                  <span>
                    Ajusta tu busqueda o verifica que existan activos publicados
                    y compartibles con cliente.
                  </span>
                </div>
              )}
            </div>
          ) : null}
        </section>
      ) : isAiEnabledComponent ? (
        <section className="proposal-component-ai-panel">
          <div className="proposal-component-ai-panel-head">
            <div>
              <strong>Sugerencia paralela con IA</strong>
              <p className="field-hint">
                Usa contexto de oportunidad, cotizacion y las fuentes elegidas
                para proponer un texto alterno.
              </p>
            </div>
            <div className="proposal-component-ai-panel-head-actions">
              {aiJob &&
              (aiJob.status !== "failed" || componentAiState.showJobError) ? (
                <span
                  className={
                    isGeneratingSuggestion
                      ? "proposal-chip proposal-chip-soft"
                      : aiJob.status === "completed"
                        ? "proposal-chip proposal-chip-outline"
                        : "proposal-chip"
                  }
                >
                  {aiJob.progress?.label || "Sugerencia IA"}
                </span>
              ) : null}
              <button
                type="button"
                className="btn-secondary proposal-component-ai-panel-toggle"
                aria-expanded={isAiPanelExpanded}
                aria-controls={`proposal-ai-panel-${component.componentCode}`}
                onClick={() => setIsAiPanelExpanded((current) => !current)}
                aria-label={
                  isAiPanelExpanded
                    ? "Contraer seccion de IA"
                    : "Expandir seccion de IA"
                }
                title={
                  isAiPanelExpanded
                    ? "Contraer seccion de IA"
                    : "Expandir seccion de IA"
                }
              >
                <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                  {isAiPanelExpanded ? (
                    <path d="M7.41 14.59 12 10l4.59 4.59L18 13.17l-6-6-6 6z" />
                  ) : (
                    <path d="m7.41 8.59 1.42-1.42L12 10.34l3.17-3.17 1.42 1.42-4.59 4.59z" />
                  )}
                </svg>
              </button>
            </div>
          </div>

          {isAiPanelExpanded ? (
            <>
              <div
                id={`proposal-ai-panel-${component.componentCode}`}
                className="proposal-component-ai-source-mode-panel"
              >
                <div className="proposal-component-ai-policy-card proposal-component-ai-scope-card">
                  <div className="proposal-component-ai-policy-head">
                    <span className="proposal-component-ai-policy-icon">
                      <ProposalAiPriorityIcon />
                    </span>
                    <div>
                      <strong>Usar fuentes de</strong>
                      <p className="field-hint">
                        Define si la sugerencia toma evidencia documental de la
                        oportunidad, de la biblioteca comercial o de ambas.
                      </p>
                    </div>
                  </div>
                  <div className="proposal-component-ai-policy-toggle is-triple">
                    <button
                      type="button"
                      className={
                        componentAiState.sourceScopeMode === "both"
                          ? "proposal-component-ai-policy-pill is-selected"
                          : "proposal-component-ai-policy-pill"
                      }
                      onClick={() =>
                        onProposalAiSourceScopeModeChange(
                          component.componentCode,
                          "both",
                        )
                      }
                    >
                      <ProposalAiPriorityIcon />
                      <span>Ambas</span>
                    </button>
                    <button
                      type="button"
                      className={
                        componentAiState.sourceScopeMode === "documents_only"
                          ? "proposal-component-ai-policy-pill is-selected"
                          : "proposal-component-ai-policy-pill"
                      }
                      onClick={() =>
                        onProposalAiSourceScopeModeChange(
                          component.componentCode,
                          "documents_only",
                        )
                      }
                    >
                      <ProposalAiDocumentIcon />
                      <span>Solo documentos</span>
                    </button>
                    <button
                      type="button"
                      className={
                        componentAiState.sourceScopeMode === "library_only"
                          ? "proposal-component-ai-policy-pill is-selected"
                          : "proposal-component-ai-policy-pill"
                      }
                      onClick={() =>
                        onProposalAiSourceScopeModeChange(
                          component.componentCode,
                          "library_only",
                        )
                      }
                    >
                      <ProposalAiDocumentIcon />
                      <span>Solo biblioteca</span>
                    </button>
                  </div>
                </div>

                {usesLibraryScope ? (
                  <>
                    <div className="proposal-component-ai-source-mode-copy">
                      <strong>Fuentes de biblioteca</strong>
                      <p className="field-hint">
                        {componentAiState.sourceMode === "manual"
                          ? "Esta seccion usa modo manual. Debes elegir explicitamente los activos de biblioteca antes de generar la sugerencia."
                          : "Esta seccion usa modo automatico. La IA elegira automaticamente hasta 4 activos sugeridos."}
                      </p>
                    </div>
                    <div className="proposal-component-ai-source-mode-toggle">
                      <div className="proposal-component-ai-source-pill is-selected">
                        <span>
                          {componentAiState.sourceMode === "manual"
                            ? "Manual"
                            : "Automatico"}
                        </span>
                        <small>
                          {componentAiState.sourceMode === "manual"
                            ? "Solo usa los activos elegidos"
                            : "La IA elige hasta 4 activos"}
                        </small>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="proposal-component-ai-source-mode-copy">
                    <strong>Alcance activo</strong>
                    <p className="field-hint">
                      Se excluye la biblioteca comercial. La sugerencia sigue
                      usando el contexto de oportunidad, cotizacion y borrador
                      actual de la seccion.
                    </p>
                  </div>
                )}

                <div className="proposal-component-ai-policy-grid">
                  {usesLibraryScope ? (
                    <div className="proposal-component-ai-policy-card">
                      <div className="proposal-component-ai-policy-head">
                        <span className="proposal-component-ai-policy-icon">
                          <ProposalAiDocumentIcon />
                        </span>
                        <div>
                          <strong>Contenido de biblioteca</strong>
                          <p className="field-hint">
                            Elige si cada activo aporta texto fuente o una vista
                            breve con summary y extract.
                          </p>
                        </div>
                      </div>
                      <div className="proposal-component-ai-policy-toggle is-dual">
                        <button
                          type="button"
                          className={
                            componentAiState.libraryContentMode ===
                            "source_text"
                              ? "proposal-component-ai-policy-pill is-selected"
                              : "proposal-component-ai-policy-pill"
                          }
                          onClick={() =>
                            onProposalAiLibraryContentModeChange(
                              component.componentCode,
                              "source_text",
                            )
                          }
                        >
                          <ProposalAiDocumentIcon />
                          <span>Texto fuente</span>
                        </button>
                        <button
                          type="button"
                          className={
                            componentAiState.libraryContentMode ===
                            "summary_extract"
                              ? "proposal-component-ai-policy-pill is-selected"
                              : "proposal-component-ai-policy-pill"
                          }
                          onClick={() =>
                            onProposalAiLibraryContentModeChange(
                              component.componentCode,
                              "summary_extract",
                            )
                          }
                        >
                          <ProposalAiDocumentIcon />
                          <span>Summary + extract</span>
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {usesLibraryScope && usesDocumentsScope ? (
                    <div className="proposal-component-ai-policy-card">
                      <div className="proposal-component-ai-policy-head">
                        <span className="proposal-component-ai-policy-icon">
                          <ProposalAiPriorityIcon />
                        </span>
                        <div>
                          <strong>Prioridad de fuentes</strong>
                          <p className="field-hint">
                            Decide si el foco narrativo favorece documentos de
                            la oportunidad, la biblioteca o un balance entre
                            ambos.
                          </p>
                        </div>
                      </div>
                      <div className="proposal-component-ai-policy-toggle is-triple">
                        <button
                          type="button"
                          className={
                            componentAiState.sourcePriorityMode ===
                            "non_library_first"
                              ? "proposal-component-ai-policy-pill is-selected"
                              : "proposal-component-ai-policy-pill"
                          }
                          onClick={() =>
                            onProposalAiSourcePriorityModeChange(
                              component.componentCode,
                              "non_library_first",
                            )
                          }
                        >
                          <ProposalAiPriorityIcon />
                          <span>Documentos primero</span>
                        </button>
                        <button
                          type="button"
                          className={
                            componentAiState.sourcePriorityMode === "balanced"
                              ? "proposal-component-ai-policy-pill is-selected"
                              : "proposal-component-ai-policy-pill"
                          }
                          onClick={() =>
                            onProposalAiSourcePriorityModeChange(
                              component.componentCode,
                              "balanced",
                            )
                          }
                        >
                          <ProposalAiPriorityIcon />
                          <span>Balanceado</span>
                        </button>
                        <button
                          type="button"
                          className={
                            componentAiState.sourcePriorityMode ===
                            "library_first"
                              ? "proposal-component-ai-policy-pill is-selected"
                              : "proposal-component-ai-policy-pill"
                          }
                          onClick={() =>
                            onProposalAiSourcePriorityModeChange(
                              component.componentCode,
                              "library_first",
                            )
                          }
                        >
                          <ProposalAiPriorityIcon />
                          <span>Biblioteca primero</span>
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              {usesLibraryScope && componentAiState.sourceMode === "manual" ? (
                <div className="proposal-component-ai-library-picker">
                  <label className="proposal-component-ai-library-search">
                    <span>Buscar activos</span>
                    <input
                      type="search"
                      value={componentAiState.libraryQuery}
                      placeholder="Buscar por titulo, resumen, fabricante o solucion"
                      onChange={(event) =>
                        onProposalAiLibraryQueryChange(
                          component.componentCode,
                          event.target.value,
                        )
                      }
                    />
                  </label>

                  <div className="proposal-component-ai-library-selected-bar">
                    <strong>
                      Seleccionados:{" "}
                      {componentAiState.selectedLibraryAssetPublicIds.length}
                      /4
                    </strong>
                    <div className="proposal-component-ai-library-selected-chips">
                      {selectedProposalAiAssets.filter(Boolean).length ? (
                        selectedProposalAiAssets
                          .filter(Boolean)
                          .map((asset) => (
                            <button
                              key={asset.publicId}
                              type="button"
                              className="proposal-component-ai-library-selected-chip"
                              onClick={() =>
                                onToggleProposalAiLibraryAsset(
                                  component.componentCode,
                                  asset.publicId,
                                )
                              }
                            >
                              <span>{asset.title}</span>
                              <strong>×</strong>
                            </button>
                          ))
                      ) : (
                        <span className="field-hint">
                          Selecciona entre 1 y 4 activos compartibles con
                          cliente.
                        </span>
                      )}
                    </div>
                  </div>

                  {proposalAiLibraryLoading ? (
                    <div className="proposal-component-ai-status-row">
                      <span
                        className="proposal-component-ai-spinner"
                        aria-hidden="true"
                      />
                      <span>Cargando biblioteca comercial...</span>
                    </div>
                  ) : filteredProposalAiLibraryAssets.length ? (
                    <div className="proposal-component-ai-library-grid">
                      {filteredProposalAiLibraryAssets
                        .slice(0, 8)
                        .map((asset) => {
                          const isSelected =
                            componentAiState.selectedLibraryAssetPublicIds.includes(
                              asset.publicId,
                            );
                          const manufacturerNames =
                            getCommercialEnablementCatalogNames(
                              asset,
                              "manufacturer",
                            );
                          const solutionNames =
                            getCommercialEnablementCatalogNames(
                              asset,
                              "solution",
                            );
                          return (
                            <label
                              key={asset.publicId}
                              className={
                                isSelected
                                  ? "proposal-component-ai-library-option is-selected"
                                  : "proposal-component-ai-library-option"
                              }
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() =>
                                  onToggleProposalAiLibraryAsset(
                                    component.componentCode,
                                    asset.publicId,
                                  )
                                }
                                disabled={
                                  !isSelected &&
                                  componentAiState.selectedLibraryAssetPublicIds
                                    .length >= 4
                                }
                              />
                              <div className="proposal-component-ai-library-option-copy">
                                <div className="proposal-component-ai-library-option-topline">
                                  <strong>{asset.title}</strong>
                                  <span>{asset.assetTypeLabel}</span>
                                </div>
                                <p>
                                  {asset.summary || "Sin resumen disponible"}
                                </p>
                                <div className="proposal-component-ai-library-option-meta">
                                  <span>{asset.visibilityLabel}</span>
                                  {manufacturerNames.map((name) => (
                                    <span key={`${asset.publicId}-${name}`}>
                                      {name}
                                    </span>
                                  ))}
                                  {solutionNames.map((name) => (
                                    <span key={`${asset.publicId}-${name}`}>
                                      {name}
                                    </span>
                                  ))}
                                  <span>
                                    {asset.files.length} archivo(s) ·{" "}
                                    {asset.links.length} URL(s)
                                  </span>
                                </div>
                              </div>
                            </label>
                          );
                        })}
                    </div>
                  ) : (
                    <div className="proposal-component-ai-library-empty">
                      <strong>No hay activos disponibles</strong>
                      <span>
                        Ajusta tu busqueda o verifica que existan activos
                        publicados y compartibles con cliente.
                      </span>
                    </div>
                  )}
                </div>
              ) : usesLibraryScope ? (
                <p className="field-hint proposal-component-ai-helper-note">
                  La IA elegira automaticamente hasta 4 activos publicados y
                  compartibles con cliente usando{" "}
                  {formatExecutiveSummaryLibraryContentModeLabel(
                    componentAiState.libraryContentMode,
                  ).toLowerCase()}{" "}
                  con prioridad{" "}
                  {formatExecutiveSummarySourcePriorityModeLabel(
                    componentAiState.sourcePriorityMode,
                  ).toLowerCase()}
                  .
                </p>
              ) : (
                <p className="field-hint proposal-component-ai-helper-note">
                  La sugerencia se generara usando solo documentos de la
                  oportunidad, junto con el contexto comercial general de la
                  propuesta.
                </p>
              )}
              {aiSuggestion ? (
                <div className="proposal-component-ai-suggestion-card">
                  <div className="proposal-component-ai-suggestion-head">
                    <div>
                      <strong>Sugerencia paralela con IA</strong>
                      <p className="field-hint">
                        {isAiSuggestionExpanded
                          ? "Revisa el texto sugerido, las fuentes usadas y decide si quieres aplicarlo."
                          : "Sugerencia disponible. Expande para ver el detalle completo."}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary proposal-component-ai-suggestion-toggle"
                      aria-expanded={isAiSuggestionExpanded}
                      aria-controls={`proposal-ai-suggestion-${component.componentCode}`}
                      onClick={() =>
                        setIsAiSuggestionExpanded((current) => !current)
                      }
                    >
                      {isAiSuggestionExpanded ? "Contraer" : "Expandir"}
                    </button>
                  </div>

                  {isAiSuggestionExpanded ? (
                    <div
                      id={`proposal-ai-suggestion-${component.componentCode}`}
                      className="proposal-component-ai-suggestion-body"
                    >
                      <div className="proposal-component-ai-suggestion-copy">
                        {aiSuggestion.blocks.map((block, index) => (
                          <p key={`${component.componentCode}-ai-${index}`}>
                            {block.text}
                          </p>
                        ))}
                      </div>

                      {aiSuggestion.sourceSummary ? (
                        <div className="proposal-component-ai-sources">
                          <span>
                            Respuestas:{" "}
                            {aiSuggestion.sourceSummary
                              .opportunityAnswersUsed || 0}
                          </span>
                          <span>
                            Documentos:{" "}
                            {aiSuggestion.sourceSummary
                              .opportunityDocumentsUsed || 0}
                          </span>
                          <span>
                            Secciones:{" "}
                            {aiSuggestion.sourceSummary.quotationSectionsUsed ||
                              0}
                          </span>
                          <span>
                            Activos:{" "}
                            {aiSuggestion.sourceSummary.libraryAssetsUsed || 0}
                          </span>
                          <span>
                            Fuentes:{" "}
                            {formatProposalAiSourceScopeModeLabel(
                              aiSuggestion.sources?.generationPolicy
                                ?.sourceScopeMode,
                            )}
                          </span>
                          <span>
                            Contenido:{" "}
                            {formatExecutiveSummaryLibraryContentModeLabel(
                              aiSuggestion.sources?.generationPolicy
                                ?.libraryContentMode,
                            )}
                          </span>
                          <span>
                            Prioridad:{" "}
                            {formatExecutiveSummarySourcePriorityModeLabel(
                              aiSuggestion.sources?.generationPolicy
                                ?.sourcePriorityMode,
                            )}
                          </span>
                        </div>
                      ) : null}

                      {Array.isArray(aiSuggestion.sources?.libraryAssets) &&
                      aiSuggestion.sources.libraryAssets.length ? (
                        <div className="proposal-component-ai-library-used-list">
                          <strong>Biblioteca usada</strong>
                          <span>
                            {aiSuggestion.sources.libraryAssets
                              .map((asset) => asset.title)
                              .filter(Boolean)
                              .join(", ")}
                          </span>
                        </div>
                      ) : null}

                      <div className="proposal-component-ai-actions">
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() =>
                            onApplySuggestion(component.componentCode)
                          }
                        >
                          Usar sugerencia
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() =>
                            onDismissSuggestion(component.componentCode)
                          }
                        >
                          Descartar
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : isGeneratingSuggestion ? (
                <div className="proposal-component-ai-status-row">
                  <span
                    className="proposal-component-ai-spinner"
                    aria-hidden="true"
                  />
                  <span>
                    {aiJob?.progress?.label || "Generando sugerencia..."}
                  </span>
                </div>
              ) : aiJob?.status === "failed" &&
                componentAiState.showJobError ? (
                <div className="proposal-component-ai-error">
                  {aiJob.error?.message ||
                    "No fue posible generar una sugerencia para esta seccion."}
                </div>
              ) : (
                <p className="field-hint">
                  Genera una version sugerida sin sobrescribir el contenido
                  actual.
                </p>
              )}
            </>
          ) : (
            <p className="field-hint proposal-component-ai-helper-note">
              Seccion minimizada. Expande para configurar fuentes y revisar la
              sugerencia de IA.
            </p>
          )}
        </section>
      ) : null}

      <div className="proposal-component-toolbar">
        {isProductBrochureSection
          ? null
          : ["heading", "paragraph", "list", "image"].map((type) => (
              <button
                key={type}
                type="button"
                className="proposal-component-add-icon-button"
                onClick={() =>
                  onChangeDraft(component.componentCode, {
                    ...draft,
                    blocks: [...draft.blocks, createEmptyBlock(type)],
                  })
                }
                aria-label={`Agregar ${getProposalBlockTypeLabel(type).toLowerCase()}`}
                title={`Agregar ${getProposalBlockTypeLabel(type).toLowerCase()}`}
              >
                <ProposalBlockAddIcon type={type} />
              </button>
            ))}
        <div className="proposal-component-toolbar-actions">
          {!isProductBrochureSection && isAiEnabledComponent ? (
            <button
              type="button"
              className={
                isGeneratingSuggestion
                  ? "proposal-component-ai-icon-button is-loading"
                  : "proposal-component-ai-icon-button"
              }
              disabled={!canGenerateProposalAiSuggestion}
              onClick={() => onGenerateSuggestion(component.componentCode)}
              aria-label={
                isGeneratingSuggestion
                  ? "Generando sugerencia con IA"
                  : usesLibraryScope &&
                      componentAiState.sourceMode === "manual" &&
                      !componentAiState.selectedLibraryAssetPublicIds.length
                    ? "Selecciona al menos un activo de biblioteca"
                    : "Generar sugerencia con IA"
              }
              title={
                isGeneratingSuggestion
                  ? aiJob?.progress?.label || "Generando sugerencia con IA"
                  : usesLibraryScope &&
                      componentAiState.sourceMode === "manual" &&
                      !componentAiState.selectedLibraryAssetPublicIds.length
                    ? "Selecciona al menos un activo de biblioteca"
                    : "Generar sugerencia con IA"
              }
            >
              <ProposalAiIcon />
            </button>
          ) : null}
          <button
            type="button"
            className="proposal-component-save-icon-button"
            disabled={busy}
            onClick={() => onSave(component.componentCode)}
            aria-label={busy ? "Guardando seccion" : "Guardar seccion"}
            title={busy ? "Guardando..." : "Guardar seccion"}
          >
            {busy ? (
              <span aria-hidden="true">...</span>
            ) : (
              <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path d="M5 4.75A1.75 1.75 0 0 1 6.75 3h8.836c.464 0 .909.184 1.237.513l2.664 2.664c.329.328.513.773.513 1.237V19.25A1.75 1.75 0 0 1 18.25 21h-12.5A1.75 1.75 0 0 1 4 19.25zm2 0v4.5h8v-4.5zm0 8.5v5.75h10v-8.75h-2.25a1.75 1.75 0 0 1-1.75-1.75V5H9v4.5A1.75 1.75 0 0 1 7.25 11H7z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {isProductBrochureSection ? null : (
        <div className="proposal-component-block-list">
          {draft.blocks.map((block, index) => (
            <article
              key={`${component.componentCode}-${index}`}
              className="proposal-component-block-card"
            >
              <div className="proposal-component-block-head">
                <strong>{getProposalBlockTypeLabel(block.type)}</strong>
                <button
                  type="button"
                  className="proposal-component-remove-icon-button"
                  onClick={() => removeBlock(index)}
                  aria-label="Quitar bloque"
                  title="Quitar bloque"
                >
                  <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                    <path d="M9.75 4.75h4.5a1 1 0 0 1 .92.61l.39.89h3.19a.75.75 0 0 1 0 1.5h-.69l-.6 9.02A2.25 2.25 0 0 1 14.22 19H9.78a2.25 2.25 0 0 1-2.24-2.23l-.6-9.02h-.69a.75.75 0 0 1 0-1.5h3.19l.39-.89a1 1 0 0 1 .92-.61zm-1.3 3 .58 8.92a.75.75 0 0 0 .75.73h4.44a.75.75 0 0 0 .75-.73l.58-8.92zm2.8 2.1a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5a.75.75 0 0 1 .75-.75zm2.5 0a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5a.75.75 0 0 1 .75-.75z" />
                  </svg>
                </button>
              </div>

              {block.type === "heading" || block.type === "paragraph" ? (
                <textarea
                  rows={block.type === "heading" ? 2 : 8}
                  value={block.text}
                  onChange={(event) =>
                    updateBlock(index, { text: event.target.value })
                  }
                />
              ) : null}

              {block.type === "list" ? (
                <textarea
                  rows={5}
                  value={(block.items || []).join("\n")}
                  placeholder="Un item por linea"
                  onChange={(event) =>
                    updateBlock(index, {
                      items: event.target.value
                        .split("\n")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }
                />
              ) : null}

              {block.type === "image" ? (
                <div className="proposal-component-image-editor">
                  <label>
                    <span>Imagen desde tu PC</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={async (event) => {
                        const file = event.target.files?.[0] || null;
                        try {
                          await selectLocalImage(index, file);
                        } catch {
                          // Evita romper el modal por errores de lectura local.
                        }
                      }}
                    />
                  </label>

                  {block.image?.fileUrl ? (
                    <div
                      className={
                        component.componentCode === "certifications"
                          ? "proposal-component-image-preview is-certifications"
                          : "proposal-component-image-preview"
                      }
                    >
                      <img
                        src={block.image.fileUrl}
                        alt={block.image.altText || component.title}
                      />
                      <span>
                        {block.image.caption ||
                          block.image.fileName ||
                          "Imagen seleccionada"}
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ProposalEditorModal({
  isOpen,
  proposal,
  loading,
  hasUnsavedChanges,
  metadataDraft,
  componentDrafts,
  dirtyComponentCodes,
  proposalAssets,
  componentGenerationJobs,
  componentSuggestions,
  componentBrochureSuggestions,
  brochureLibraryQueries,
  proposalAiState,
  proposalAiLibraryAssets,
  proposalAiLibraryLoading,
  busyAction,
  onClose,
  onOpenPreview,
  onOpenApplyTemplateModal,
  onRebaseProposal,
  onCreateNewProposalFromLatest,
  onMetadataDraftChange,
  onSaveMetadata,
  onComponentDraftChange,
  onSaveComponent,
  onProposalAiLibraryContentModeChange,
  onProposalAiSourceScopeModeChange,
  onProposalAiSourcePriorityModeChange,
  onProposalAiLibraryQueryChange,
  onToggleProposalAiLibraryAsset,
  onGenerateSuggestion,
  onRecommendBrochures,
  onApplySuggestion,
  onApplyBrochureSuggestion,
  onDismissSuggestion,
  onDismissBrochureSuggestion,
  onBrochureLibraryQueryChange,
}) {
  const [activeComponentIndex, setActiveComponentIndex] = useState(0);

  useEffect(() => {
    setActiveComponentIndex(0);
  }, [isOpen, proposal?.id]);

  useEffect(() => {
    const componentCount = Array.isArray(proposal?.components)
      ? proposal.components.length
      : 0;
    if (!componentCount) {
      if (activeComponentIndex !== 0) {
        setActiveComponentIndex(0);
      }
      return;
    }
    if (activeComponentIndex > componentCount - 1) {
      setActiveComponentIndex(componentCount - 1);
    }
  }, [proposal, activeComponentIndex]);

  const proposalComponents = Array.isArray(proposal?.components)
    ? proposal.components
    : [];
  const activeComponent = proposalComponents[activeComponentIndex] || null;
  const activeComponentCode = activeComponent?.componentCode || null;
  const hasPreviousComponent = activeComponentIndex > 0;
  const hasNextComponent = activeComponentIndex < proposalComponents.length - 1;
  const isActiveComponentDirty = activeComponentCode
    ? dirtyComponentCodes.has(activeComponentCode)
    : false;

  async function requestLeaveCurrentSection() {
    if (!activeComponentCode || !isActiveComponentDirty) {
      return true;
    }

    const shouldSaveBeforeContinue = window.confirm(
      "Tienes cambios sin guardar en esta seccion. Aceptar: guardar y continuar. Cancelar: elegir otra opcion.",
    );
    if (shouldSaveBeforeContinue) {
      const saved = await onSaveComponent(activeComponentCode);
      return Boolean(saved);
    }

    return window.confirm(
      "Continuar sin guardar en esta seccion? Los cambios se mantendran en el borrador local hasta que guardes.",
    );
  }

  async function moveToComponentIndex(nextIndex) {
    if (
      nextIndex < 0 ||
      nextIndex >= proposalComponents.length ||
      nextIndex === activeComponentIndex
    ) {
      return;
    }

    const canLeaveCurrentSection = await requestLeaveCurrentSection();
    if (!canLeaveCurrentSection) {
      return;
    }

    setActiveComponentIndex(nextIndex);
  }

  async function handleSaveAndMoveNext() {
    if (!activeComponentCode) {
      return;
    }
    const saved = await onSaveComponent(activeComponentCode);
    if (saved && hasNextComponent) {
      setActiveComponentIndex((current) =>
        Math.min(current + 1, proposalComponents.length - 1),
      );
    }
  }

  async function handleCloseRequest() {
    if (!hasUnsavedChanges) {
      onClose();
      return;
    }

    const shouldClose = window.confirm(
      "Hay cambios sin guardar en la propuesta. Cerrar sin guardar?",
    );
    if (shouldClose) {
      onClose();
    }
  }

  if (!isOpen) return null;

  return (
    <div className="modal-overlay modal-overlay-elevated">
      <div
        className="modal-dialog modal-dialog-account modal-dialog-with-scroll-shell proposal-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Editor de propuesta"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header proposal-editor-modal-header">
          <div>
            <div className="account-modal-title-row">
              <h3 className="modal-title">Editar propuesta</h3>
              <ModalInlineHelp helpKey="proposal.edit" />
            </div>
            <p className="modal-message">
              Wizard por secciones para editar contenido, validar IA y guardar
              paso a paso.
            </p>
          </div>
          <div className="account-modal-header-actions">
            <button
              type="button"
              className="opportunity-documents-apply-icon-button account-modal-close-button"
              onClick={handleCloseRequest}
              aria-label="Cerrar modal de edición de propuesta"
              title="Cerrar"
            >
              ×
            </button>
          </div>
        </div>

        <div className="modal-dialog-scroll-shell proposal-editor-modal-body">
          {loading ? <p className="field-hint">Cargando propuesta...</p> : null}

          {!loading && !proposal ? (
            <div className="proposal-empty-state proposal-editor-empty-state">
              <h3>No fue posible abrir la propuesta</h3>
              <p className="field-hint">
                Intenta nuevamente desde el listado de propuestas.
              </p>
            </div>
          ) : null}

          {proposal ? (
            <>
              <section
                className={`proposal-studio-hero is-${proposal.templateSnapshot?.coverStyle || "corporate"}`}
              >
                <div className="proposal-studio-hero-copy">
                  <span className="proposal-preview-eyebrow">
                    Proposal studio
                  </span>
                  <h3>{proposal.title}</h3>
                  <p>
                    {proposal.accountName} · {proposal.contactName}
                    {" · "}
                    Actualizada {formatDateTime(proposal.updatedAt)}
                  </p>
                </div>
                <div className="proposal-studio-hero-aside">
                  <span className="proposal-chip proposal-chip-outline">
                    {formatProposalStatusLabel(proposal.statusCode)}
                  </span>
                  <span className="proposal-chip proposal-chip-outline">
                    {proposal.templateName || "Sin plantilla"}
                  </span>
                  <span className="proposal-studio-version">
                    Cotizacion #{proposal.quotationId} · v
                    {proposal.quotationVersionNumber}
                  </span>
                </div>
              </section>

              <div className="proposal-detail-header">
                <div>
                  <h3>Metadatos editoriales</h3>
                  <p className="field-hint">
                    La narrativa vive por componentes. Aqui solo ajustas el
                    estado general y el titulo interno.
                  </p>
                </div>
                <div className="proposal-detail-meta">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={onOpenPreview}
                  >
                    Previsualizar propuesta
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busyAction === `apply-template-${proposal.id}`}
                    onClick={onOpenApplyTemplateModal}
                  >
                    Cambiar plantilla visual
                  </button>
                </div>
              </div>

              {proposal.updateAvailable ? (
                <div className="proposal-update-banner">
                  <div>
                    <strong>Hay una version aprobada mas reciente</strong>
                    <p className="field-hint">
                      Esta propuesta usa la v{proposal.quotationVersionNumber}.
                      Ya existe la v{proposal.latestApprovedVersionNumber}.
                    </p>
                  </div>
                  <div className="proposal-update-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busyAction === `rebase-${proposal.id}`}
                      onClick={onRebaseProposal}
                    >
                      Actualizar propuesta
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={busyAction === "create-proposal"}
                      onClick={onCreateNewProposalFromLatest}
                    >
                      Crear nueva propuesta
                    </button>
                  </div>
                </div>
              ) : null}

              <section className="proposal-editor-card">
                <div className="proposal-editor-card-head">
                  <div className="proposal-editor-card-head-main">
                    <h4>Configuracion general</h4>
                    <p className="field-hint">
                      Titulo interno y estado operativo de la propuesta.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="proposal-editor-save-icon-button"
                    disabled={busyAction === `save-metadata-${proposal.id}`}
                    onClick={onSaveMetadata}
                    aria-label={
                      busyAction === `save-metadata-${proposal.id}`
                        ? "Guardando metadatos"
                        : "Guardar metadatos"
                    }
                    title={
                      busyAction === `save-metadata-${proposal.id}`
                        ? "Guardando..."
                        : "Guardar metadatos"
                    }
                  >
                    {busyAction === `save-metadata-${proposal.id}` ? (
                      <span aria-hidden="true">...</span>
                    ) : (
                      <svg
                        viewBox="0 0 24 24"
                        focusable="false"
                        aria-hidden="true"
                      >
                        <path d="M5 4.75A1.75 1.75 0 0 1 6.75 3h8.836c.464 0 .909.184 1.237.513l2.664 2.664c.329.328.513.773.513 1.237V19.25A1.75 1.75 0 0 1 18.25 21h-12.5A1.75 1.75 0 0 1 4 19.25zm2 0v4.5h8v-4.5zm0 8.5v5.75h10v-8.75h-2.25a1.75 1.75 0 0 1-1.75-1.75V5H9v4.5A1.75 1.75 0 0 1 7.25 11H7z" />
                      </svg>
                    )}
                  </button>
                </div>
                <div className="proposal-editor-card-grid proposal-editor-card-grid-dual">
                  <label>
                    <span>Titulo interno</span>
                    <input
                      type="text"
                      value={metadataDraft.title}
                      onChange={(event) =>
                        onMetadataDraftChange((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Estado</span>
                    <button
                      type="button"
                      className={
                        normalizeProposalStatusCode(
                          metadataDraft.statusCode,
                        ) === "archived"
                          ? "proposal-editor-status-toggle is-inactive"
                          : "proposal-editor-status-toggle is-active"
                      }
                      aria-label={
                        normalizeProposalStatusCode(
                          metadataDraft.statusCode,
                        ) === "archived"
                          ? "Cambiar propuesta a activa"
                          : "Cambiar propuesta a desactivada"
                      }
                      onClick={() =>
                        onMetadataDraftChange((current) => ({
                          ...current,
                          statusCode:
                            normalizeProposalStatusCode(current.statusCode) ===
                            "archived"
                              ? "active"
                              : "archived",
                        }))
                      }
                    >
                      <svg
                        viewBox="0 0 24 24"
                        focusable="false"
                        aria-hidden="true"
                      >
                        {normalizeProposalStatusCode(
                          metadataDraft.statusCode,
                        ) === "archived" ? (
                          <path d="M6.75 6.75h10.5v10.5H6.75zM4.5 12a7.5 7.5 0 1 0 15 0 7.5 7.5 0 0 0-15 0zm3.03-3.97 8.44 8.44" />
                        ) : (
                          <path d="M12 4.5a7.5 7.5 0 1 0 7.5 7.5A7.5 7.5 0 0 0 12 4.5zm3.12 5.78-3.66 4.88a.75.75 0 0 1-1.13.09l-1.94-1.94a.75.75 0 1 1 1.06-1.06l1.32 1.32 3.05-4.06a.75.75 0 0 1 1.2.9z" />
                        )}
                      </svg>
                      <span>
                        {formatProposalStatusLabel(
                          normalizeProposalStatusCode(metadataDraft.statusCode),
                        )}
                      </span>
                    </button>
                  </label>
                </div>
              </section>

              {proposalComponents.length ? (
                <section className="proposal-editor-wizard-shell">
                  <header className="proposal-editor-wizard-head">
                    <div>
                      <h4>Secciones de la propuesta</h4>
                      <p className="field-hint">
                        Paso {activeComponentIndex + 1} de{" "}
                        {proposalComponents.length}. Guarda cada seccion antes
                        de continuar.
                      </p>
                    </div>
                  </header>

                  <div className="proposal-editor-step-chip-list">
                    {proposalComponents.map((component, index) => {
                      const isActive = index === activeComponentIndex;
                      const isDirty = dirtyComponentCodes.has(
                        component.componentCode,
                      );
                      const stepTitle = getProposalSectionDisplayTitle(
                        component.componentCode,
                        component.title || component.componentCode,
                      );

                      return (
                        <button
                          key={component.componentCode}
                          type="button"
                          className={
                            isActive
                              ? "proposal-editor-step-chip is-active"
                              : isDirty
                                ? "proposal-editor-step-chip is-dirty"
                                : "proposal-editor-step-chip"
                          }
                          onClick={() => {
                            void moveToComponentIndex(index);
                          }}
                        >
                          <span className="proposal-editor-step-chip-index">
                            Paso {index + 1}
                          </span>
                          <strong>{stepTitle}</strong>
                          <small>
                            {isActive
                              ? "En edicion"
                              : isDirty
                                ? "Con cambios"
                                : "Sin cambios"}
                          </small>
                        </button>
                      );
                    })}
                  </div>

                  <div className="proposal-component-stack proposal-component-stack-wizard">
                    {activeComponent ? (
                      <ProposalComponentCard
                        key={activeComponent.componentCode}
                        component={activeComponent}
                        proposalId={proposal?.id}
                        draft={
                          componentDrafts[activeComponent.componentCode] ||
                          cloneComponentDraft(activeComponent)
                        }
                        assets={proposalAssets}
                        busy={
                          busyAction ===
                          `save-component-${activeComponent.componentCode}`
                        }
                        isDirty={dirtyComponentCodes.has(
                          activeComponent.componentCode,
                        )}
                        aiJob={
                          componentGenerationJobs[activeComponent.componentCode]
                        }
                        aiSuggestion={
                          componentSuggestions[activeComponent.componentCode]
                        }
                        componentBrochureSuggestion={
                          componentBrochureSuggestions[
                            activeComponent.componentCode
                          ] || null
                        }
                        brochureLibraryQuery={
                          brochureLibraryQueries[
                            activeComponent.componentCode
                          ] || ""
                        }
                        isBrochureRecommendationBusy={
                          busyAction ===
                          `recommend-brochures-${activeComponent.componentCode}`
                        }
                        proposalAiState={proposalAiState}
                        proposalAiLibraryAssets={proposalAiLibraryAssets}
                        proposalAiLibraryLoading={proposalAiLibraryLoading}
                        onProposalAiLibraryContentModeChange={
                          onProposalAiLibraryContentModeChange
                        }
                        onProposalAiSourceScopeModeChange={
                          onProposalAiSourceScopeModeChange
                        }
                        onProposalAiSourcePriorityModeChange={
                          onProposalAiSourcePriorityModeChange
                        }
                        onProposalAiLibraryQueryChange={
                          onProposalAiLibraryQueryChange
                        }
                        onToggleProposalAiLibraryAsset={
                          onToggleProposalAiLibraryAsset
                        }
                        onBrochureLibraryQueryChange={
                          onBrochureLibraryQueryChange
                        }
                        onChangeDraft={(componentCode, nextDraft) =>
                          onComponentDraftChange((current) => ({
                            ...current,
                            [componentCode]: nextDraft,
                          }))
                        }
                        onSave={onSaveComponent}
                        onGenerateSuggestion={onGenerateSuggestion}
                        onRecommendBrochures={onRecommendBrochures}
                        onApplySuggestion={onApplySuggestion}
                        onApplyBrochureSuggestion={onApplyBrochureSuggestion}
                        onDismissSuggestion={onDismissSuggestion}
                        onDismissBrochureSuggestion={
                          onDismissBrochureSuggestion
                        }
                      />
                    ) : null}
                  </div>

                  <footer className="proposal-editor-wizard-footer">
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={!hasPreviousComponent}
                      onClick={() => {
                        void moveToComponentIndex(activeComponentIndex - 1);
                      }}
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={
                        !activeComponentCode ||
                        busyAction === `save-component-${activeComponentCode}`
                      }
                      onClick={() => {
                        if (activeComponentCode) {
                          void onSaveComponent(activeComponentCode);
                        }
                      }}
                    >
                      Guardar seccion
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={
                        !activeComponentCode ||
                        !hasNextComponent ||
                        busyAction === `save-component-${activeComponentCode}`
                      }
                      onClick={() => {
                        void handleSaveAndMoveNext();
                      }}
                    >
                      Guardar y siguiente
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={!hasNextComponent}
                      onClick={() => {
                        void moveToComponentIndex(activeComponentIndex + 1);
                      }}
                    >
                      Siguiente
                    </button>
                  </footer>
                </section>
              ) : (
                <div className="proposal-empty-state proposal-editor-empty-state">
                  <h3>Esta propuesta no tiene secciones editables</h3>
                  <p className="field-hint">
                    Verifica la configuracion de contenido o crea una propuesta
                    nueva con una plantilla activa.
                  </p>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function ProposalsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const createRequestRef = useRef("");
  const proposalsLoadRequestRef = useRef(0);
  const appliedProposalSuggestionJobRef = useRef(new Map());
  const componentGenerationJobsRef = useRef({});
  const [proposals, setProposals] = useState([]);
  const [proposalSearchTerm, setProposalSearchTerm] = useState("");
  const [proposalStatusFilter, setProposalStatusFilter] = useState("all");
  const [proposalsPage, setProposalsPage] = useState(1);
  const [proposalsPerPage, setProposalsPerPage] = useState(10);
  const [selectedProposal, setSelectedProposal] = useState(null);
  const [openProposalMenuId, setOpenProposalMenuId] = useState(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [proposalTemplates, setProposalTemplates] = useState([]);
  const [proposalAssets, setProposalAssets] = useState([]);
  const [loadingProposalTemplates, setLoadingProposalTemplates] =
    useState(false);
  const [templatePickerState, setTemplatePickerState] = useState({
    isOpen: false,
    mode: "create",
    versionId: null,
    proposalId: null,
    sourceProposalId: null,
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [templateApplyMode, setTemplateApplyMode] =
    useState("preserve_content");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [companyBranding, setCompanyBranding] = useState(null);
  const [metadataDraft, setMetadataDraft] = useState({
    title: "",
    statusCode: "active",
  });
  const [componentDrafts, setComponentDrafts] = useState({});
  const [componentGenerationJobs, setComponentGenerationJobs] = useState({});
  const [componentSuggestions, setComponentSuggestions] = useState({});
  const [componentBrochureSuggestions, setComponentBrochureSuggestions] =
    useState({});
  const [brochureLibraryQueries, setBrochureLibraryQueries] = useState({});
  const [proposalAiState, setProposalAiState] = useState(
    buildDefaultProposalAiState(),
  );
  const [proposalAiLibraryAssets, setProposalAiLibraryAssets] = useState([]);
  const [proposalAiLibraryLoading, setProposalAiLibraryLoading] =
    useState(false);
  const [proposalAiLibraryLoaded, setProposalAiLibraryLoaded] = useState(false);
  const proposalAiComponentCodes = useMemo(
    () => getProposalAiComponentCodes(selectedProposal),
    [selectedProposal],
  );
  const proposalAiHasActiveJob = proposalAiComponentCodes.some(
    (componentCode) => {
      const job = componentGenerationJobs[componentCode] || null;
      return job && !isProposalAiJobTerminal(job);
    },
  );
  const proposalAiRequiresLibraryAssets = proposalAiComponentCodes.some(
    (componentCode) =>
      getProposalAiComponentState(proposalAiState, componentCode)
        .sourceScopeMode !== "documents_only" &&
      getProposalAiComponentState(proposalAiState, componentCode).sourceMode ===
        "manual",
  );
  const proposalHasBrochureComponent = Array.isArray(
    selectedProposal?.components,
  )
    ? selectedProposal.components.some((component) =>
        isProductBrochuresComponent(component),
      )
    : false;
  const proposalRequiresCommercialLibrary =
    proposalAiRequiresLibraryAssets || proposalHasBrochureComponent;

  useEffect(() => {
    componentGenerationJobsRef.current = componentGenerationJobs;
  }, [componentGenerationJobs]);

  function setProposalAiComponentState(componentCode, nextValue) {
    setProposalAiState((current) => {
      const previousState = getProposalAiComponentState(current, componentCode);
      const resolvedState =
        typeof nextValue === "function"
          ? nextValue(previousState)
          : { ...previousState, ...nextValue };
      return {
        ...current,
        [componentCode]: resolvedState,
      };
    });
  }

  function resetAllProposalAiState() {
    appliedProposalSuggestionJobRef.current.clear();
    setComponentGenerationJobs({});
    setComponentSuggestions({});
    setComponentBrochureSuggestions({});
    setBrochureLibraryQueries({});
    setProposalAiState(buildDefaultProposalAiState());
    setProposalAiLibraryAssets([]);
    setProposalAiLibraryLoading(false);
    setProposalAiLibraryLoaded(false);
  }

  function resetProposalAiComponentState(componentCode) {
    setComponentGenerationJobs((current) => {
      const next = { ...current };
      delete next[componentCode];
      return next;
    });
    setComponentSuggestions((current) => {
      const next = { ...current };
      delete next[componentCode];
      return next;
    });
    setProposalAiComponentState(
      componentCode,
      createDefaultProposalAiComponentState(),
    );
  }

  const selectedProposalId =
    Number(searchParams.get("proposalId") || 0) || null;
  const createFromVersionId =
    Number(searchParams.get("createFromVersionId") || 0) || null;
  const sourceProposalId =
    Number(searchParams.get("sourceProposalId") || 0) || null;
  const selectedTemplateIdFromQuery =
    Number(searchParams.get("templateId") || 0) || null;

  const defaultTemplateId = useMemo(
    () =>
      proposalTemplates.find((template) => template.isDefault)?.id ||
      proposalTemplates[0]?.id ||
      null,
    [proposalTemplates],
  );
  const previewModel = useMemo(
    () =>
      buildProposalPrintModel(
        selectedProposal,
        metadataDraft,
        componentDrafts,
        companyBranding,
      ),
    [selectedProposal, metadataDraft, componentDrafts, companyBranding],
  );
  const previewDirty = useMemo(
    () =>
      isProposalPreviewDirty(selectedProposal, metadataDraft, componentDrafts),
    [selectedProposal, metadataDraft, componentDrafts],
  );
  const dirtyComponentCodes = useMemo(() => {
    const next = new Set();
    (selectedProposal?.components || []).forEach((component) => {
      if (isProposalComponentDirty(component, componentDrafts)) {
        next.add(component.componentCode);
      }
    });
    return next;
  }, [selectedProposal, componentDrafts]);
  const proposalStatusCounts = useMemo(() => {
    return proposals.reduce(
      (counts, proposal) => {
        const statusCode = normalizeProposalStatusCode(proposal.statusCode);
        if (statusCode === "archived") {
          counts.archived += 1;
        } else {
          counts.active += 1;
        }
        return counts;
      },
      { active: 0, archived: 0 },
    );
  }, [proposals]);
  const filteredProposals = useMemo(() => {
    const normalizedSearch = normalizeComparableLabel(proposalSearchTerm);

    return proposals.filter((proposal) => {
      const matchesStatus =
        proposalStatusFilter === "all" ||
        normalizeProposalStatusCode(proposal.statusCode) ===
          proposalStatusFilter;

      if (!matchesStatus) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const searchableText = normalizeComparableLabel(
        [
          proposal.title || `Propuesta ${proposal.id}`,
          proposal.accountName || "",
          proposal.contactName || "",
          proposal.id,
          proposal.quotationId,
          proposal.quotationVersionNumber,
          formatProposalStatusLabel(proposal.statusCode),
        ].join(" "),
      );

      return searchableText.includes(normalizedSearch);
    });
  }, [proposals, proposalSearchTerm, proposalStatusFilter]);
  const totalProposalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredProposals.length / proposalsPerPage)),
    [filteredProposals.length, proposalsPerPage],
  );
  const pagedProposals = useMemo(() => {
    const start = (proposalsPage - 1) * proposalsPerPage;
    return filteredProposals.slice(start, start + proposalsPerPage);
  }, [filteredProposals, proposalsPage, proposalsPerPage]);

  useEffect(() => {
    setProposalsPage(1);
  }, [proposalSearchTerm, proposalStatusFilter]);

  useEffect(() => {
    if (proposalsPage > totalProposalPages) {
      setProposalsPage(totalProposalPages);
    }
  }, [proposalsPage, totalProposalPages]);

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      if (!selectedProposal) {
        setMetadataDraft({ title: "", statusCode: "active" });
        setComponentDrafts({});
        setComponentBrochureSuggestions({});
        setBrochureLibraryQueries({});
        resetAllProposalAiState();
        return;
      }

      setMetadataDraft(buildMetadataDraftFromProposal(selectedProposal));
      setComponentDrafts(buildComponentDraftMap(selectedProposal.components));
      setComponentBrochureSuggestions({});
      setBrochureLibraryQueries({});
      setProposalAiState(
        buildDefaultProposalAiStateFromProposal(selectedProposal),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [selectedProposal]);

  async function refreshLatestProposalAiGeneration(proposalId, componentCode) {
    const numericProposalId = Number(proposalId || 0);
    if (
      !numericProposalId ||
      !proposalAiComponentCodes.includes(componentCode)
    ) {
      return null;
    }

    const { data } = await api.get(
      `/api/proposals/${numericProposalId}/components/${componentCode}/generation-jobs/latest`,
    );
    const nextJob = normalizeProposalAiJob(data?.job);

    setComponentGenerationJobs((current) => {
      const next = { ...current };
      if (nextJob) {
        next[componentCode] = nextJob;
      } else {
        delete next[componentCode];
      }
      return next;
    });

    setProposalAiComponentState(
      componentCode,
      buildProposalAiComponentStateFromJob(
        nextJob,
        normalizeProposalAiMode(
          selectedProposal?.components?.find(
            (component) => component.componentCode === componentCode,
          )?.aiMode,
          "auto",
        ),
      ),
    );

    const nextSuggestion = normalizeProposalAiSuggestion(nextJob?.result);
    setComponentSuggestions((current) => {
      const next = { ...current };
      if (nextSuggestion) {
        next[componentCode] = nextSuggestion;
      } else {
        delete next[componentCode];
      }
      return next;
    });

    return nextJob;
  }

  useEffect(() => {
    if (!selectedProposal?.id) {
      return undefined;
    }

    let cancelled = false;

    async function loadLatestProposalAiGenerations() {
      try {
        const entries = await Promise.all(
          proposalAiComponentCodes.map(async (componentCode) => {
            const { data } = await api.get(
              `/api/proposals/${selectedProposal.id}/components/${componentCode}/generation-jobs/latest`,
            );
            return [componentCode, normalizeProposalAiJob(data?.job)];
          }),
        );
        if (cancelled) return;

        const nextJobs = {};
        const nextSuggestions = {};
        const nextState =
          buildDefaultProposalAiStateFromProposal(selectedProposal);
        entries.forEach(([componentCode, nextJob]) => {
          if (nextJob) {
            nextJobs[componentCode] = nextJob;
          }
          const nextSuggestion = normalizeProposalAiSuggestion(nextJob?.result);
          if (nextSuggestion) {
            nextSuggestions[componentCode] = nextSuggestion;
          }
          nextState[componentCode] = buildProposalAiComponentStateFromJob(
            nextJob,
            normalizeProposalAiMode(
              selectedProposal?.components?.find(
                (component) => component.componentCode === componentCode,
              )?.aiMode,
              "auto",
            ),
          );
        });

        setComponentGenerationJobs(nextJobs);
        setComponentSuggestions(nextSuggestions);
        setProposalAiState(nextState);
      } catch {
        if (cancelled) return;
        resetAllProposalAiState();
      }
    }

    loadLatestProposalAiGenerations();

    return () => {
      cancelled = true;
    };
  }, [selectedProposal, selectedProposal?.id, proposalAiComponentCodes]);

  useEffect(() => {
    if (!selectedProposalId) {
      return undefined;
    }

    let cancelled = false;

    const syncLatest = async () => {
      try {
        const results = await Promise.all(
          proposalAiComponentCodes.map(async (componentCode) => {
            const currentJob =
              componentGenerationJobsRef.current[componentCode] || null;
            const { data } = await api.get(
              `/api/proposals/${selectedProposalId}/components/${componentCode}/generation-jobs/latest`,
            );
            const nextJob = normalizeProposalAiJob(data?.job);
            return { componentCode, currentJob, nextJob };
          }),
        );
        if (cancelled) return;
        const nextJobs = {};
        const nextSuggestions = {};
        results.forEach(({ componentCode, currentJob, nextJob }) => {
          if (nextJob) {
            nextJobs[componentCode] = nextJob;
          }
          const nextSuggestion = normalizeProposalAiSuggestion(nextJob?.result);
          if (nextSuggestion) {
            nextSuggestions[componentCode] = nextSuggestion;
          }
          setProposalAiComponentState(
            componentCode,
            buildProposalAiComponentStateFromJob(
              nextJob,
              normalizeProposalAiMode(
                selectedProposal?.components?.find(
                  (component) => component.componentCode === componentCode,
                )?.aiMode,
                "auto",
              ),
            ),
          );
          if (!nextJob) return;
          const shouldNotifyTerminalTransition =
            Boolean(currentJob?.publicId) &&
            currentJob.publicId === nextJob.publicId &&
            currentJob.status !== nextJob.status &&
            isProposalAiJobTerminal(nextJob);
          if (!shouldNotifyTerminalTransition) return;
          if (nextJob.status === "completed") {
            setProposalAiComponentState(componentCode, {
              showJobError: false,
            });
            setSuccess("Sugerencia IA lista para revisar");
          } else if (nextJob.status === "failed") {
            setProposalAiComponentState(componentCode, {
              showJobError: true,
            });
            setError(
              nextJob.error?.message ||
                "No fue posible generar la sugerencia IA para esta seccion",
            );
          }
        });
        setComponentGenerationJobs(nextJobs);
        setComponentSuggestions(nextSuggestions);
      } catch (err) {
        if (cancelled) return;
        setError(
          getApiErrorMessage(
            err,
            "No fue posible sincronizar el ultimo estado de la sugerencia IA",
          ),
        );
      }
    };

    syncLatest();

    const intervalId = window.setInterval(() => {
      if (proposalAiHasActiveJob) {
        syncLatest();
      }
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    selectedProposal,
    selectedProposalId,
    proposalAiHasActiveJob,
    proposalAiComponentCodes,
  ]);

  useEffect(() => {
    if (!selectedProposal?.id) {
      return undefined;
    }

    if (!proposalRequiresCommercialLibrary) {
      return undefined;
    }
    if (proposalAiLibraryLoaded) {
      return undefined;
    }

    let cancelled = false;

    async function loadProposalAiLibraryAssets() {
      setProposalAiLibraryLoading(true);
      try {
        const { data } = await api.get("/api/commercial-enablement/assets", {
          params: {
            status: "published",
            onlyClientSafe: "true",
            page: 1,
            pageSize: 100,
            sort: "updated_desc",
          },
        });

        if (cancelled) return;

        setProposalAiLibraryAssets(
          Array.isArray(data?.items)
            ? data.items.map(normalizeCommercialEnablementAssetOption)
            : [],
        );
        setProposalAiLibraryLoaded(true);
      } catch (err) {
        if (cancelled) return;
        setProposalAiLibraryAssets([]);
        setProposalAiLibraryLoaded(true);
        const statusCode = Number(err?.response?.status || 0);
        if (statusCode === 403) {
          // La biblioteca comercial es opcional para editar propuestas; omitir ruido de permisos cruzados.
          return;
        }
        setError(
          getApiErrorMessage(
            err,
            "No fue posible cargar la biblioteca comercial para la sugerencia IA",
          ),
        );
      } finally {
        if (!cancelled) {
          setProposalAiLibraryLoading(false);
        }
      }
    }

    loadProposalAiLibraryAssets();

    return () => {
      cancelled = true;
    };
  }, [
    selectedProposal?.id,
    proposalRequiresCommercialLibrary,
    proposalAiLibraryLoaded,
  ]);

  useEffect(() => {
    if (!error && !success) return undefined;
    const timeoutId = window.setTimeout(() => {
      setError("");
      setSuccess("");
    }, 4500);
    return () => window.clearTimeout(timeoutId);
  }, [error, success]);

  async function loadProposalTemplates() {
    setLoadingProposalTemplates(true);
    try {
      const { data } = await api.get("/api/proposal-templates");
      const nextTemplates = Array.isArray(data)
        ? data.map(normalizeProposalTemplateOption)
        : [];
      setProposalTemplates(nextTemplates);
      return nextTemplates;
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible cargar las plantillas de propuestas",
        ),
      );
      return [];
    } finally {
      setLoadingProposalTemplates(false);
    }
  }

  async function loadProposalAssets() {
    try {
      const { data } = await api.get("/api/proposal-assets");
      setProposalAssets(
        Array.isArray(data?.items) ? data.items.map(normalizeAssetOption) : [],
      );
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible cargar los assets de propuesta",
        ),
      );
    }
  }

  async function loadCompanyBranding() {
    try {
      const { data } = await api.get("/api/settings/document-branding");
      setCompanyBranding(data?.company || null);
    } catch {
      setCompanyBranding(null);
    }
  }

  async function loadProposalDetail(proposalId) {
    if (!proposalId) {
      setSelectedProposal(null);
      return;
    }

    setLoadingDetail(true);
    setSelectedProposal(null);
    try {
      const { data } = await api.get(`/api/proposals/${proposalId}`);
      setSelectedProposal(normalizeProposalDetail(data || null));
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible cargar el detalle de la propuesta",
        ),
      );
    } finally {
      setLoadingDetail(false);
    }
  }

  async function loadProposals({ nextSelectedProposalId } = {}) {
    const requestId = proposalsLoadRequestRef.current + 1;
    proposalsLoadRequestRef.current = requestId;
    setLoadingList(true);
    try {
      const { data } = await api.get("/api/proposals");
      if (proposalsLoadRequestRef.current !== requestId) return;
      const nextProposals = Array.isArray(data) ? data : [];
      setProposals(nextProposals);

      if (nextSelectedProposalId) {
        setSearchParams(
          { proposalId: String(nextSelectedProposalId) },
          { replace: true },
        );
      } else if (
        selectedProposalId &&
        !nextProposals.some(
          (proposal) => Number(proposal.id) === Number(selectedProposalId),
        )
      ) {
        setSearchParams({}, { replace: true });
      }
    } catch (err) {
      if (proposalsLoadRequestRef.current !== requestId) return;
      setError(getApiErrorMessage(err, "No fue posible cargar las propuestas"));
    } finally {
      if (proposalsLoadRequestRef.current === requestId) {
        setLoadingList(false);
      }
    }
  }

  const loadProposalsRef = useRef(loadProposals);
  const loadProposalDetailRef = useRef(loadProposalDetail);
  const loadProposalTemplatesRef = useRef(loadProposalTemplates);
  const loadProposalAssetsRef = useRef(loadProposalAssets);
  const loadCompanyBrandingRef = useRef(loadCompanyBranding);

  useEffect(() => {
    loadProposalsRef.current = loadProposals;
    loadProposalDetailRef.current = loadProposalDetail;
    loadProposalTemplatesRef.current = loadProposalTemplates;
    loadProposalAssetsRef.current = loadProposalAssets;
    loadCompanyBrandingRef.current = loadCompanyBranding;
  });

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      void loadProposalsRef.current();
      void loadProposalTemplatesRef.current();
      void loadProposalAssetsRef.current();
      void loadCompanyBrandingRef.current();
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      if (selectedProposalId) {
        void loadProposalDetailRef.current(selectedProposalId);
        return;
      }

      setSelectedProposal(null);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedProposalId]);

  useEffect(() => {
    if (openProposalMenuId === null) return undefined;

    function handleDocumentPointerDown(event) {
      if (event.target.closest(".proposal-kebab-wrap")) return;
      setOpenProposalMenuId(null);
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
    };
  }, [openProposalMenuId]);

  useEffect(() => {
    if (!createFromVersionId) {
      createRequestRef.current = "";
      return;
    }

    const requestKey = `${createFromVersionId}:${sourceProposalId || ""}:${selectedTemplateIdFromQuery || ""}`;
    if (createRequestRef.current === requestKey) return;
    createRequestRef.current = requestKey;

    let cancelled = false;

    async function createProposalFromVersion() {
      setBusyAction("create-proposal");
      try {
        const { data } = await api.post(
          `/api/quotation-versions/${createFromVersionId}/proposals`,
          {
            ...(sourceProposalId ? { sourceProposalId } : {}),
            ...(selectedTemplateIdFromQuery
              ? { templateId: selectedTemplateIdFromQuery }
              : {}),
          },
        );
        if (cancelled) return;
        const nextProposalId = Number(data?.proposal?.id || 0);
        setSuccess(
          data?.created === false
            ? "La propuesta ya existia y se abrio la version actual"
            : "Propuesta creada correctamente",
        );
        setProposalStatusFilter("all");
        setProposalSearchTerm("");
        await loadProposalsRef.current({
          nextSelectedProposalId: nextProposalId,
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            getApiErrorMessage(
              err,
              "No fue posible crear la propuesta desde la cotizacion",
            ),
          );
        }
      } finally {
        if (!cancelled) {
          setBusyAction("");
        }
      }
    }

    createProposalFromVersion();

    return () => {
      cancelled = true;
    };
  }, [createFromVersionId, sourceProposalId, selectedTemplateIdFromQuery]);

  function updateProposalInList(nextProposal) {
    if (!nextProposal?.id) return;
    setProposals((current) => {
      const hasMatch = current.some(
        (proposal) => Number(proposal.id) === Number(nextProposal.id),
      );
      if (!hasMatch) {
        return [nextProposal, ...current];
      }
      return current.map((proposal) =>
        Number(proposal.id) === Number(nextProposal.id)
          ? nextProposal
          : proposal,
      );
    });
    setSelectedProposal(normalizeProposalDetail(nextProposal));
  }

  function closeTemplatePicker() {
    setTemplatePickerState({
      isOpen: false,
      mode: "create",
      versionId: null,
      proposalId: null,
      sourceProposalId: null,
    });
    setTemplateApplyMode("preserve_content");
  }

  async function openTemplatePicker({
    mode,
    versionId = null,
    proposalId = null,
    sourceProposalId: nextSourceProposalId = null,
    initialTemplateId = null,
  }) {
    const templates = proposalTemplates.length
      ? proposalTemplates
      : await loadProposalTemplates();
    setSelectedTemplateId(
      Number(initialTemplateId || 0) ||
        templates.find((template) => template.isDefault)?.id ||
        templates[0]?.id ||
        null,
    );
    setTemplatePickerState({
      isOpen: true,
      mode,
      versionId,
      proposalId,
      sourceProposalId: nextSourceProposalId,
    });
  }

  async function handleConfirmTemplatePicker() {
    if (templatePickerState.mode === "apply") {
      const proposalId = Number(templatePickerState.proposalId || 0) || null;
      if (!proposalId || !selectedTemplateId) return;
      setBusyAction(`apply-template-${proposalId}`);
      try {
        const { data } = await api.post(
          `/api/proposals/${proposalId}/apply-template`,
          {
            templateId: selectedTemplateId,
            mode: templateApplyMode,
          },
        );
        setSuccess("Plantilla aplicada correctamente");
        closeTemplatePicker();
        updateProposalInList(data?.proposal);
        await loadProposalDetail(proposalId);
      } catch (err) {
        setError(
          getApiErrorMessage(err, "No fue posible aplicar la plantilla"),
        );
      } finally {
        setBusyAction("");
      }
      return;
    }

    const versionId = Number(templatePickerState.versionId || 0) || null;
    if (!versionId) return;
    const params = new URLSearchParams({
      createFromVersionId: String(versionId),
    });
    if (selectedTemplateId) {
      params.set("templateId", String(selectedTemplateId));
    }
    if (templatePickerState.sourceProposalId) {
      params.set(
        "sourceProposalId",
        String(templatePickerState.sourceProposalId),
      );
    }
    closeTemplatePicker();
    navigate(`/proposals?${params.toString()}`);
  }

  async function handleSaveMetadata() {
    if (!selectedProposal) return;
    setBusyAction(`save-metadata-${selectedProposal.id}`);
    try {
      const { data } = await api.put(`/api/proposals/${selectedProposal.id}`, {
        title: metadataDraft.title,
        statusCode: metadataDraft.statusCode,
      });
      updateProposalInList(data?.proposal);
      setSuccess("Metadatos de la propuesta actualizados");
      await loadProposalDetail(selectedProposal.id);
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible guardar la propuesta"));
    } finally {
      setBusyAction("");
    }
  }

  async function handleSaveComponent(componentCode) {
    if (!selectedProposal || !componentDrafts[componentCode]) return false;
    setBusyAction(`save-component-${componentCode}`);
    try {
      const suggestionTrackingKey = `${Number(selectedProposal.id)}:${componentCode}`;
      const consumeSuggestionPublicId = proposalAiComponentCodes.includes(
        componentCode,
      )
        ? appliedProposalSuggestionJobRef.current.get(suggestionTrackingKey) ||
          null
        : null;
      const { data } = await api.put(
        `/api/proposals/${selectedProposal.id}/components/${componentCode}`,
        {
          ...serializeComponentDraft(
            componentDrafts[componentCode],
            componentCode,
          ),
          ...(consumeSuggestionPublicId ? { consumeSuggestionPublicId } : {}),
        },
      );
      if (consumeSuggestionPublicId) {
        appliedProposalSuggestionJobRef.current.delete(suggestionTrackingKey);
        resetProposalAiComponentState(componentCode);
      }
      updateProposalInList(data?.proposal);
      setSuccess("Seccion actualizada");
      await loadProposalDetail(selectedProposal.id);
      return true;
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible guardar la seccion"));
      return false;
    } finally {
      setBusyAction("");
    }
  }

  function setBrochureLibraryQuery(componentCode, nextValue) {
    setBrochureLibraryQueries((current) => ({
      ...current,
      [componentCode]: nextValue,
    }));
  }

  async function handleRecommendBrochures(componentCode) {
    if (!selectedProposal || !isProductBrochuresComponent(componentCode)) {
      return;
    }

    const draft = componentDrafts[componentCode];
    if (!draft) {
      return;
    }

    setBusyAction(`recommend-brochures-${componentCode}`);
    try {
      const { data } = await api.post(
        `/api/proposals/${selectedProposal.id}/components/${componentCode}/brochure-recommendations`,
        {
          requestedBrochureCount: normalizeProposalBrochureRequestedCount(
            draft.requestedBrochureCount,
            PROPOSAL_BROCHURE_DEFAULT_REQUESTED_COUNT,
          ),
        },
      );

      setComponentBrochureSuggestions((current) => ({
        ...current,
        [componentCode]: {
          items: Array.isArray(data?.items)
            ? data.items.map(normalizeCommercialEnablementAssetOption)
            : [],
          warnings: Array.isArray(data?.warnings) ? data.warnings : [],
        },
      }));
      setSuccess("Folletos sugeridos listos para revisar");
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible recomendar folletos para esta seccion",
        ),
      );
    } finally {
      setBusyAction("");
    }
  }

  function handleApplyBrochureSuggestion(componentCode) {
    const suggestion = componentBrochureSuggestions[componentCode];
    if (!suggestion) return;

    const nextBlocks = suggestion.items.map((asset) =>
      createBrochureBlockFromAsset(asset),
    );

    setComponentDrafts((current) => ({
      ...current,
      [componentCode]: {
        ...(current[componentCode] || {
          title:
            selectedProposal?.components?.find(
              (component) => component.componentCode === componentCode,
            )?.title || "",
          brochureSelectionMode: "auto",
          requestedBrochureCount: PROPOSAL_BROCHURE_DEFAULT_REQUESTED_COUNT,
          blocks: [],
        }),
        title:
          current[componentCode]?.title ||
          selectedProposal?.components?.find(
            (component) => component.componentCode === componentCode,
          )?.title ||
          "",
        brochureSelectionMode: "auto",
        requestedBrochureCount: normalizeProposalBrochureRequestedCount(
          current[componentCode]?.requestedBrochureCount,
          PROPOSAL_BROCHURE_DEFAULT_REQUESTED_COUNT,
        ),
        blocks: nextBlocks,
      },
    }));
    setComponentBrochureSuggestions((current) => {
      const next = { ...current };
      delete next[componentCode];
      return next;
    });
  }

  function handleDismissBrochureSuggestion(componentCode) {
    setComponentBrochureSuggestions((current) => {
      const next = { ...current };
      delete next[componentCode];
      return next;
    });
  }
  function handleToggleProposalAiLibraryAsset(componentCode, assetPublicId) {
    setProposalAiComponentState(componentCode, (current) => {
      if (current.selectedLibraryAssetPublicIds.includes(assetPublicId)) {
        return {
          ...current,
          selectedLibraryAssetPublicIds:
            current.selectedLibraryAssetPublicIds.filter(
              (value) => value !== assetPublicId,
            ),
        };
      }
      if (current.selectedLibraryAssetPublicIds.length >= 4) {
        return current;
      }
      return {
        ...current,
        selectedLibraryAssetPublicIds: [
          ...current.selectedLibraryAssetPublicIds,
          assetPublicId,
        ],
      };
    });
  }

  async function handleGenerateSuggestion(componentCode) {
    if (
      !selectedProposal ||
      !proposalAiComponentCodes.includes(componentCode)
    ) {
      return;
    }

    const componentAiState = getProposalAiComponentState(
      proposalAiState,
      componentCode,
    );

    if (
      componentAiState.sourceScopeMode !== "documents_only" &&
      componentAiState.sourceMode === "manual" &&
      componentAiState.selectedLibraryAssetPublicIds.length === 0
    ) {
      setError(
        "Selecciona al menos un activo de biblioteca para usar el modo manual",
      );
      return;
    }

    setBusyAction(`generate-component-${componentCode}`);
    try {
      setProposalAiComponentState(componentCode, { showJobError: false });
      const { data } = await api.post(
        `/api/proposals/${selectedProposal.id}/components/${componentCode}/generation-jobs`,
        {
          mode: "generate_parallel_suggestion",
          languageCode: "es",
          maxLibraryAssets: 4,
          sourceScopeMode: componentAiState.sourceScopeMode,
          librarySourceMode: componentAiState.sourceMode,
          libraryContentMode: componentAiState.libraryContentMode,
          sourcePriorityMode: componentAiState.sourcePriorityMode,
          selectedLibraryAssetPublicIds:
            componentAiState.sourceScopeMode !== "documents_only" &&
            componentAiState.sourceMode === "manual"
              ? componentAiState.selectedLibraryAssetPublicIds
              : [],
        },
      );
      const nextJob = normalizeProposalAiJob(data?.job);
      if (nextJob) {
        setComponentGenerationJobs((current) => ({
          ...current,
          [componentCode]: nextJob,
        }));
        if (nextJob.status === "completed") {
          const nextSuggestion = normalizeProposalAiSuggestion(nextJob.result);
          if (nextSuggestion) {
            setComponentSuggestions((current) => ({
              ...current,
              [componentCode]: nextSuggestion,
            }));
          }
        }
      }
      setSuccess(
        data?.reused
          ? "Ya existe una sugerencia IA en proceso"
          : "Generacion IA iniciada",
      );
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible iniciar la sugerencia IA para esta seccion",
        ),
      );
    } finally {
      setBusyAction("");
    }
  }

  function handleApplySuggestion(componentCode) {
    const suggestion = componentSuggestions[componentCode];
    if (!suggestion) return;
    const mergedSuggestionText = suggestion.blocks
      .map((block) => String(block?.text || "").trim())
      .filter(Boolean)
      .join("\n\n");
    const nextComponentDraft = {
      title: suggestion.title || "",
      blocks: mergedSuggestionText
        ? [
            {
              id: null,
              type: "paragraph",
              text: mergedSuggestionText,
              items: [],
              assetId: null,
              assetVersionId: null,
              image: null,
            },
          ]
        : [],
    };

    setComponentDrafts((current) => {
      return {
        ...current,
        [componentCode]: nextComponentDraft,
      };
    });
    setSelectedProposal((current) => {
      if (!current) return current;
      return {
        ...current,
        components: Array.isArray(current.components)
          ? current.components.map((component) =>
              component.componentCode === componentCode
                ? {
                    ...component,
                    title: nextComponentDraft.title,
                    blocks: nextComponentDraft.blocks,
                  }
                : component,
            )
          : current.components,
      };
    });
    if (
      proposalAiComponentCodes.includes(componentCode) &&
      selectedProposal?.id
    ) {
      const appliedJobPublicId =
        componentGenerationJobs[componentCode]?.publicId || null;
      if (appliedJobPublicId) {
        appliedProposalSuggestionJobRef.current.set(
          `${Number(selectedProposal.id)}:${componentCode}`,
          appliedJobPublicId,
        );
      }
    }
    setSuccess("Sugerencia aplicada al borrador");
  }

  function handleDismissSuggestion(componentCode) {
    setComponentSuggestions((current) => {
      const next = { ...current };
      delete next[componentCode];
      return next;
    });
  }

  async function handleRebaseProposal() {
    if (!selectedProposal?.latestApprovedVersionId) return;
    setBusyAction(`rebase-${selectedProposal.id}`);
    try {
      const { data } = await api.post(
        `/api/proposals/${selectedProposal.id}/rebase`,
        {
          quotationVersionId: selectedProposal.latestApprovedVersionId,
        },
      );
      updateProposalInList(data?.proposal);
      setSuccess("Propuesta actualizada a la nueva version aprobada");
      await loadProposalDetail(selectedProposal.id);
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible actualizar la propuesta a la nueva version",
        ),
      );
    } finally {
      setBusyAction("");
    }
  }

  function handleCreateNewProposalFromLatest() {
    if (!selectedProposal?.latestApprovedVersionId) return;
    openTemplatePicker({
      mode: "create",
      versionId: selectedProposal.latestApprovedVersionId,
      sourceProposalId: selectedProposal.id,
      initialTemplateId: selectedProposal.templateId,
    });
  }

  function handleOpenApplyTemplateModal() {
    if (!selectedProposal) return;
    openTemplatePicker({
      mode: "apply",
      proposalId: selectedProposal.id,
      initialTemplateId: selectedProposal.templateId || defaultTemplateId,
    });
  }

  async function resolvePreviewSource() {
    if (!selectedProposal) {
      return null;
    }

    if (previewDirty) {
      return {
        proposal: selectedProposal,
        metadata: metadataDraft,
        drafts: componentDrafts,
      };
    }

    try {
      const { data } = await api.get(`/api/proposals/${selectedProposal.id}`);
      const freshProposal = data || null;
      if (!freshProposal) {
        return null;
      }

      updateProposalInList(freshProposal);
      const nextMetadataDraft = buildMetadataDraftFromProposal(freshProposal);
      const nextComponentDrafts = buildComponentDraftMap(
        freshProposal.components,
      );
      setMetadataDraft(nextMetadataDraft);
      setComponentDrafts(nextComponentDrafts);

      return {
        proposal: freshProposal,
        metadata: nextMetadataDraft,
        drafts: nextComponentDrafts,
      };
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible actualizar la propuesta antes de abrir la vista previa",
        ),
      );
      return null;
    }
  }

  async function handleOpenPreview() {
    const previewSource = await resolvePreviewSource();
    if (!previewSource) return;
    setIsPreviewOpen(true);
  }

  function handleClosePreview() {
    setIsPreviewOpen(false);
  }

  async function handleOpenPdfPreview() {
    if (!selectedProposal || typeof window === "undefined") return;

    const previewSource = await resolvePreviewSource();
    if (!previewSource) return;

    const nextPreviewModel = buildProposalPrintModel(
      previewSource.proposal,
      previewSource.metadata,
      previewSource.drafts,
      companyBranding,
    );
    if (!nextPreviewModel) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setError(
        "El navegador bloqueo la ventana de vista previa. Permite ventanas emergentes e intenta de nuevo.",
      );
      return;
    }

    try {
      printWindow.document.title = "Generando PDF...";
      printWindow.document.body.innerHTML = `
        <div style="font-family: Arial, sans-serif; padding: 32px; color: #123044;">
          <h1 style="margin: 0 0 12px; font-size: 22px;">Generando vista previa PDF</h1>
          <p style="margin: 0; font-size: 14px; color: #42515c;">
            Estamos preparando el documento oficial de la propuesta.
          </p>
        </div>
      `;
    } catch {
      // Ignore bootstrap failures and continue with fetch navigation.
    }

    try {
      const pdfPayload = buildProposalPdfPayload(
        nextPreviewModel,
        previewSource.proposal,
      );
      const requestUrl = new URL(
        "/api/proposals/render-pdf",
        api.defaults.baseURL || window.location.origin,
      );
      const authToken = window.localStorage.getItem("crm_token") || "";

      const response = await fetch(requestUrl.toString(), {
        method: "POST",
        headers: {
          Accept: "application/pdf",
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(pdfPayload),
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const errorData = await response.json().catch(() => null);
          const validationErrors = errorData?.errors?.fieldErrors
            ? Object.entries(errorData.errors.fieldErrors)
                .flatMap(([field, messages]) => {
                  if (!Array.isArray(messages) || messages.length === 0) {
                    return [];
                  }
                  return `${field}: ${messages.join(", ")}`;
                })
                .join(" | ")
            : "";
          throw new Error(
            validationErrors
              ? `${errorData?.message || "No fue posible generar la vista previa PDF"}: ${validationErrors}`
              : errorData?.message ||
                  "No fue posible generar la vista previa PDF",
          );
        }

        const textError = await response.text().catch(() => "");
        throw new Error(
          textError || "No fue posible generar la vista previa PDF",
        );
      }

      const pdfBlob = await response.blob();
      if (!pdfBlob || pdfBlob.size === 0) {
        throw new Error("La vista previa PDF se genero vacia");
      }

      const objectUrl = window.URL.createObjectURL(pdfBlob);
      const revokeObjectUrl = () => {
        window.URL.revokeObjectURL(objectUrl);
      };

      const handleLoad = () => {
        printWindow.removeEventListener("load", handleLoad);
        printWindow.addEventListener("pagehide", revokeObjectUrl, {
          once: true,
        });
      };

      printWindow.addEventListener("load", handleLoad, { once: true });
      printWindow.location.replace(objectUrl);
      handleClosePreview();
    } catch (err) {
      printWindow.close();
      setError(err?.message || "No fue posible generar la vista previa PDF");
    }
  }

  function handleSelectProposal(proposalId) {
    setOpenProposalMenuId(null);
    setSearchParams({ proposalId: String(proposalId) }, { replace: true });
  }

  function handleCloseProposalEditor() {
    setSearchParams({}, { replace: true });
  }

  function toggleProposalMenu(proposalId) {
    setOpenProposalMenuId((current) =>
      Number(current) === Number(proposalId) ? null : proposalId,
    );
  }

  return (
    <section className="panel proposal-shell">
      <div className="roles-page-header">
        <div className="roles-page-header-left">
          <div className="module-title-with-icon">
            <h2 data-help-id="proposals.title">Propuestas</h2>
            <span
              className="module-title-icon module-title-icon-quotations"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M5.75 4.75h9.19a2.25 2.25 0 0 1 1.59.66l1.06 1.06a2.25 2.25 0 0 1 .66 1.59V17A2.25 2.25 0 0 1 16 19.25H8A2.25 2.25 0 0 1 5.75 17z" />
                <path d="M8.5 9.25h7" />
                <path d="M8.5 12.25h7" />
                <path d="M8.5 15.25h4.5" />
              </svg>
            </span>
          </div>
          <p className="roles-subtitle">
            Propuestas comerciales con contenido institucional por seccion,
            imagenes historicas y pricing heredado desde cotizacion.
          </p>
        </div>
      </div>

      <div className="proposal-layout proposal-layout-structured proposal-layout-list-only">
        <aside className="proposal-list-card">
          <div className="proposal-list-header">
            <div>
              <h3>Propuestas</h3>
              <span className="field-hint">
                {filteredProposals.length} de {proposals.length} registradas
              </span>
            </div>
            <div className="proposal-list-filters accounts-pills-bar-row">
              <div
                className="accounts-status-pills"
                role="group"
                aria-label="Filtrar propuestas por estado"
              >
                <button
                  type="button"
                  className={
                    proposalStatusFilter === "active"
                      ? "status-filter-pill status-filter-pill-active is-selected"
                      : "status-filter-pill status-filter-pill-active"
                  }
                  aria-pressed={proposalStatusFilter === "active"}
                  onClick={() => setProposalStatusFilter("active")}
                >
                  <span className="status-filter-pill-dot" aria-hidden="true" />
                  <span className="status-filter-pill-text">Activas</span>
                  <span className="status-filter-pill-count">
                    {proposalStatusCounts.active}
                  </span>
                </button>
                <button
                  type="button"
                  className={
                    proposalStatusFilter === "archived"
                      ? "status-filter-pill status-filter-pill-inactive is-selected"
                      : "status-filter-pill status-filter-pill-inactive"
                  }
                  aria-pressed={proposalStatusFilter === "archived"}
                  onClick={() => setProposalStatusFilter("archived")}
                >
                  <span className="status-filter-pill-dot" aria-hidden="true" />
                  <span className="status-filter-pill-text">Desactivadas</span>
                  <span className="status-filter-pill-count">
                    {proposalStatusCounts.archived}
                  </span>
                </button>
                <button
                  type="button"
                  className={
                    proposalStatusFilter === "all"
                      ? "status-filter-pill status-filter-pill-all is-selected"
                      : "status-filter-pill status-filter-pill-all"
                  }
                  aria-pressed={proposalStatusFilter === "all"}
                  onClick={() => setProposalStatusFilter("all")}
                >
                  <span className="status-filter-pill-dot" aria-hidden="true" />
                  <span className="status-filter-pill-text">Todas</span>
                  <span className="status-filter-pill-count">
                    {proposals.length}
                  </span>
                </button>
              </div>
              <input
                className="accounts-search-inline"
                type="search"
                value={proposalSearchTerm}
                placeholder="Buscar por titulo, cuenta o contacto"
                aria-label="Buscar propuestas"
                onChange={(event) => setProposalSearchTerm(event.target.value)}
              />
            </div>
          </div>

          {loadingList ? (
            <p className="field-hint">Cargando propuestas...</p>
          ) : null}

          {!loadingList && proposals.length === 0 ? (
            <p className="field-hint">
              Aun no hay propuestas. Crea la primera desde cotizaciones.
            </p>
          ) : null}

          {!loadingList &&
          proposals.length > 0 &&
          filteredProposals.length === 0 ? (
            <p className="field-hint">
              Ninguna propuesta coincide con el filtro actual.
            </p>
          ) : null}

          <table>
            <thead>
              <tr>
                <th>Titulo</th>
                <th>Cuenta</th>
                <th>Contacto</th>
                <th>Estado</th>
                <th>Cotizacion</th>
                <th>Actualizada</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredProposals.length > 0 ? (
                pagedProposals.map((proposal) => {
                  const isSelected =
                    Number(selectedProposalId) === Number(proposal.id);

                  return (
                    <tr
                      key={proposal.id}
                      className={
                        isSelected
                          ? "accounts-row-clickable proposal-row-selected"
                          : "accounts-row-clickable"
                      }
                      onClick={() => handleSelectProposal(proposal.id)}
                    >
                      <td>
                        <strong>
                          {proposal.title || `Propuesta #${proposal.id}`}
                        </strong>
                      </td>
                      <td>{proposal.accountName || "Sin cuenta"}</td>
                      <td>{proposal.contactName || "Sin contacto"}</td>
                      <td>
                        <span className="proposal-chip proposal-chip-soft">
                          {formatProposalStatusLabel(proposal.statusCode)}
                        </span>
                      </td>
                      <td>
                        #{proposal.quotationId} · v
                        {proposal.quotationVersionNumber || "-"}
                      </td>
                      <td>{formatDateTime(proposal.updatedAt)}</td>
                      <td
                        className="accounts-actions-cell"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="user-kebab-wrap proposal-kebab-wrap">
                          <button
                            type="button"
                            className="kebab-btn"
                            data-help-id="proposals.actions"
                            aria-label="Abrir acciones de propuesta"
                            title="Acciones"
                            onClick={() => toggleProposalMenu(proposal.id)}
                          >
                            ⋮
                          </button>
                          {openProposalMenuId === proposal.id ? (
                            <div className="user-kebab-menu proposal-actions-menu">
                              data-help-id="proposals.save-component"
                              <button
                                type="button"
                                onClick={() =>
                                  handleSelectProposal(proposal.id)
                                }
                              >
                                Editar
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="empty-state">
                    No hay propuestas que coincidan con los filtros
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {filteredProposals.length > 0 ? (
            <div className="users-pagination">
              <div className="users-pagination-left">
                <span className="users-pagination-info">
                  {(proposalsPage - 1) * proposalsPerPage + 1}-
                  {Math.min(
                    proposalsPage * proposalsPerPage,
                    filteredProposals.length,
                  )}{" "}
                  de {filteredProposals.length}
                </span>
              </div>
              <div className="users-pagination-center">
                <button
                  type="button"
                  className="users-page-btn"
                  disabled={proposalsPage === 1}
                  onClick={() => setProposalsPage((page) => page - 1)}
                >
                  ‹
                </button>
                <span className="users-pagination-pages">
                  {proposalsPage} / {totalProposalPages}
                </span>
                <button
                  type="button"
                  className="users-page-btn"
                  disabled={proposalsPage === totalProposalPages}
                  onClick={() => setProposalsPage((page) => page + 1)}
                >
                  ›
                </button>
              </div>
              <div className="users-pagination-right">
                <span className="users-pagination-label">Por pagina:</span>
                {[10, 50, 100].map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={`users-perpage-btn${
                      proposalsPerPage === size ? " is-active" : ""
                    }`}
                    onClick={() => setProposalsPerPage(size)}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
      </div>

      {error ? <div className="toast toast-error">{error}</div> : null}
      {success ? <div className="toast toast-success">{success}</div> : null}

      <ProposalTemplatePickerModal
        isOpen={templatePickerState.isOpen}
        title={
          templatePickerState.mode === "apply"
            ? "Cambiar plantilla"
            : "Elegir plantilla"
        }
        subtitle={
          templatePickerState.mode === "apply"
            ? "La plantilla cambia la presentacion visual. El contenido estructurado e imagenes historicas de la propuesta se conservan salvo reemplazo explicito posterior."
            : "La plantilla define la portada y el tono visual. El pricing sigue viniendo de la cotizacion aprobada."
        }
        templates={proposalTemplates}
        loading={loadingProposalTemplates}
        selectedTemplateId={selectedTemplateId}
        onSelectTemplate={setSelectedTemplateId}
        onClose={closeTemplatePicker}
        onConfirm={handleConfirmTemplatePicker}
        confirmLabel={
          templatePickerState.mode === "apply"
            ? "Aplicar plantilla"
            : "Crear propuesta"
        }
        busy={
          templatePickerState.mode === "apply" &&
          busyAction === `apply-template-${templatePickerState.proposalId}`
        }
        footerContent={
          templatePickerState.mode === "apply" ? (
            <div className="proposal-template-mode-panel">
              <div className="proposal-template-mode-panel-copy">
                <strong>Modo de aplicacion</strong>
                <p className="field-hint">
                  La estructura por componentes ya es propia de la propuesta. La
                  plantilla solo redefine el acabado visual y el contenido
                  legacy derivado.
                </p>
              </div>
              <div
                className="proposal-template-mode-switch"
                role="group"
                aria-label="Modo de aplicacion de plantilla"
              >
                <button
                  type="button"
                  className={
                    templateApplyMode === "preserve_content"
                      ? "proposal-template-mode-pill is-selected"
                      : "proposal-template-mode-pill"
                  }
                  onClick={() => setTemplateApplyMode("preserve_content")}
                >
                  <span>Conservar contenido</span>
                  <small>Solo actualiza la presentacion</small>
                </button>
                <button
                  type="button"
                  className={
                    templateApplyMode === "replace_content"
                      ? "proposal-template-mode-pill is-selected"
                      : "proposal-template-mode-pill"
                  }
                  onClick={() => setTemplateApplyMode("replace_content")}
                >
                  <span>Reemplazar legacy</span>
                  <small>No altera tus componentes editados</small>
                </button>
              </div>
            </div>
          ) : null
        }
      />

      <ProposalEditorModal
        isOpen={Boolean(selectedProposalId)}
        proposal={selectedProposal}
        loading={loadingDetail}
        hasUnsavedChanges={previewDirty}
        metadataDraft={metadataDraft}
        componentDrafts={componentDrafts}
        dirtyComponentCodes={dirtyComponentCodes}
        proposalAssets={proposalAssets}
        componentGenerationJobs={componentGenerationJobs}
        componentSuggestions={componentSuggestions}
        componentBrochureSuggestions={componentBrochureSuggestions}
        brochureLibraryQueries={brochureLibraryQueries}
        proposalAiState={proposalAiState}
        proposalAiLibraryAssets={proposalAiLibraryAssets}
        proposalAiLibraryLoading={proposalAiLibraryLoading}
        busyAction={busyAction}
        onClose={handleCloseProposalEditor}
        onOpenPreview={handleOpenPreview}
        onOpenApplyTemplateModal={handleOpenApplyTemplateModal}
        onRebaseProposal={handleRebaseProposal}
        onCreateNewProposalFromLatest={handleCreateNewProposalFromLatest}
        onMetadataDraftChange={setMetadataDraft}
        onSaveMetadata={handleSaveMetadata}
        onComponentDraftChange={setComponentDrafts}
        onSaveComponent={handleSaveComponent}
        onProposalAiLibraryContentModeChange={(componentCode, value) =>
          setProposalAiComponentState(componentCode, {
            libraryContentMode: value,
          })
        }
        onProposalAiSourceScopeModeChange={(componentCode, value) =>
          setProposalAiComponentState(componentCode, {
            sourceScopeMode: value,
          })
        }
        onProposalAiSourcePriorityModeChange={(componentCode, value) =>
          setProposalAiComponentState(componentCode, {
            sourcePriorityMode: value,
          })
        }
        onProposalAiLibraryQueryChange={(componentCode, value) =>
          setProposalAiComponentState(componentCode, { libraryQuery: value })
        }
        onToggleProposalAiLibraryAsset={handleToggleProposalAiLibraryAsset}
        onGenerateSuggestion={handleGenerateSuggestion}
        onRecommendBrochures={handleRecommendBrochures}
        onApplySuggestion={handleApplySuggestion}
        onApplyBrochureSuggestion={handleApplyBrochureSuggestion}
        onDismissSuggestion={handleDismissSuggestion}
        onDismissBrochureSuggestion={handleDismissBrochureSuggestion}
        onBrochureLibraryQueryChange={setBrochureLibraryQuery}
      />

      <ProposalPrintPreviewModal
        isOpen={isPreviewOpen}
        model={previewModel}
        dirty={previewDirty}
        onClose={handleClosePreview}
        onOpenPdfPreview={handleOpenPdfPreview}
      />
    </section>
  );
}
