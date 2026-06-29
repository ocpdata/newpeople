import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, getApiErrorMessage } from "./api";

const TABS = [
  { id: "use", label: "Buscar y usar" },
  { id: "manage", label: "Cargar y administrar" },
  { id: "governance", label: "Gobierno" },
];

const CATALOG_ADMIN_TYPES = [
  {
    adminKey: "manufacturer",
    type: "manufacturer",
    label: "Fabricantes",
    singularLabel: "Fabricante",
  },
  {
    adminKey: "technology",
    type: "technology",
    label: "Tecnologias",
    singularLabel: "Tecnologia",
  },
  {
    adminKey: "solution",
    type: "solution",
    label: "Soluciones",
    singularLabel: "Solucion",
  },
  {
    adminKey: "industry",
    type: "industry",
    label: "Industrias",
    singularLabel: "Industria",
  },
];

const EMPTY_BOOTSTRAP = {
  permissions: {
    canUse: false,
    canUpload: false,
    canManage: false,
    canAdmin: false,
  },
  summary: {
    totalVisibleAssets: 0,
    clientSafeAssets: 0,
    internalAssets: 0,
    recentAssets: 0,
  },
  catalogs: {},
  adminCatalogs: {},
  recent: [],
};

const EMPTY_ASSET_RESULT = {
  page: 1,
  pageSize: 24,
  total: 0,
  items: [],
};

const EMPTY_ANALYTICS = {
  totals: {
    totalAssets: 0,
    publishedAssets: 0,
    totalUsageEvents: 0,
  },
  usageByType: {},
  topItems: [],
};

const EMPTY_GOVERNANCE = {
  summary: {
    totalAssets: 0,
    draftAssets: 0,
    obsoleteAssets: 0,
    qualityIssues: 0,
    duplicateCandidates: 0,
  },
  qualityIssues: [],
  duplicateCandidates: [],
  manageableItems: [],
};

const EMPTY_PUBLISH_SECTION_ERRORS = {
  catalogContext: false,
};

const PUBLISH_SECTION_MESSAGES = {
  catalogContext: "Debes indicar al menos un fabricante o una tecnologia",
};

const ASSET_FIELD_MESSAGES = {
  title: "Titulo requerido",
  summary: "Resumen requerido",
};

const SINGLE_RESOURCE_MESSAGE =
  "Cada activo solo puede tener un archivo o una URL. Quita el recurso actual antes de agregar otro.";

function emptyLinkDraft() {
  return {
    url: "",
    linkType: "external",
    label: "",
    description: "",
    isPrimary: false,
  };
}

function emptyDraft() {
  return {
    title: "",
    summary: "",
    internalDescription: "",
    assetTypeCode: "presentation",
    status: "published",
    sourceType: "mixed",
    visibilityLevel: "client_safe",
    audienceCode: "mixed",
    languageCode: "es",
    manufacturerCodes: [],
    solutionCodes: [],
    technologyCodes: [],
    needCodes: [],
    requirementCodes: [],
    competitorCodes: [],
    industryCodes: [],
    stageCodes: [],
    themeTags: [],
    personaTags: [],
    recommendedRoleTags: [],
    isInternal: false,
    isDownloadable: true,
  };
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function splitCommaValues(value) {
  return uniqueStrings(String(value || "").split(","));
}

function joinCommaValues(values) {
  return Array.isArray(values) ? values.join(", ") : "";
}

function matchesStatusFilter(statusFilter, assetStatus) {
  const normalizedFilter = String(statusFilter || "all").trim();
  if (!normalizedFilter || normalizedFilter === "all") return true;
  return normalizedFilter === String(assetStatus || "").trim();
}

function upsertAssetResult(currentResult, nextAsset, statusFilter) {
  if (!nextAsset?.publicId) return currentResult;

  const currentItems = Array.isArray(currentResult?.items)
    ? currentResult.items
    : [];
  const withoutCurrent = currentItems.filter(
    (item) => item.publicId !== nextAsset.publicId,
  );

  if (!matchesStatusFilter(statusFilter, nextAsset.status)) {
    return {
      ...(currentResult || EMPTY_ASSET_RESULT),
      items: withoutCurrent,
      total: withoutCurrent.length,
    };
  }

  return {
    ...(currentResult || EMPTY_ASSET_RESULT),
    items: [nextAsset, ...withoutCurrent],
    total: withoutCurrent.length + 1,
  };
}

function toggleValue(values, value) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) return values;
  return values.includes(normalizedValue)
    ? values.filter((entry) => entry !== normalizedValue)
    : [...values, normalizedValue];
}

function getCatalogCodes(asset, catalogType) {
  return Array.isArray(asset?.catalogs)
    ? asset.catalogs
        .filter((entry) => entry.catalogType === catalogType)
        .map((entry) => entry.code)
    : [];
}

function getTagCodes(asset, tagGroup) {
  return Array.isArray(asset?.tags)
    ? asset.tags
        .filter((entry) => entry.tagGroup === tagGroup)
        .map((entry) => entry.code)
    : [];
}

function buildDraftFromAsset(asset) {
  if (!asset) return emptyDraft();
  return {
    title: asset.title || "",
    summary: asset.summary || "",
    internalDescription: asset.internalDescription || "",
    assetTypeCode: asset.assetTypeCode || "presentation",
    status: asset.status || "published",
    sourceType: asset.sourceType || "mixed",
    visibilityLevel: asset.visibilityLevel || "client_safe",
    audienceCode: asset.audienceCode || "mixed",
    languageCode: asset.languageCode || "es",
    manufacturerCodes: getCatalogCodes(asset, "manufacturer"),
    solutionCodes: getCatalogCodes(asset, "solution"),
    technologyCodes: getCatalogCodes(asset, "technology"),
    needCodes: getCatalogCodes(asset, "need"),
    requirementCodes: getCatalogCodes(asset, "requirement"),
    competitorCodes: getCatalogCodes(asset, "competitor"),
    industryCodes: getCatalogCodes(asset, "industry"),
    stageCodes: getTagCodes(asset, "stage"),
    themeTags: getTagCodes(asset, "theme"),
    personaTags: getTagCodes(asset, "persona"),
    recommendedRoleTags: getTagCodes(asset, "recommended_role"),
    isInternal: Boolean(asset.isInternal),
    isDownloadable: asset.isDownloadable !== false,
  };
}

function buildAssetPayload(draftValue) {
  return {
    ...draftValue,
    title: String(draftValue?.title || "").trim(),
    summary: String(draftValue?.summary || "").trim(),
    internalDescription: String(draftValue?.internalDescription || "").trim(),
    manufacturerCodes: uniqueStrings(draftValue?.manufacturerCodes),
    solutionCodes: uniqueStrings(draftValue?.solutionCodes),
    technologyCodes: uniqueStrings(draftValue?.technologyCodes),
    needCodes: uniqueStrings(draftValue?.needCodes),
    requirementCodes: uniqueStrings(draftValue?.requirementCodes),
    competitorCodes: uniqueStrings(draftValue?.competitorCodes),
    industryCodes: uniqueStrings(draftValue?.industryCodes),
    stageCodes: uniqueStrings(draftValue?.stageCodes),
    themeTags: uniqueStrings(draftValue?.themeTags),
    personaTags: uniqueStrings(draftValue?.personaTags),
    recommendedRoleTags: uniqueStrings(draftValue?.recommendedRoleTags),
    isInternal: draftValue?.visibilityLevel !== "client_safe",
  };
}

function buildDraftFromIntakeSession(session) {
  const payload = session?.acceptedPayload || session?.draftPayload || {};
  return {
    ...emptyDraft(),
    ...payload,
    sourceType: "file",
    isInternal: payload?.visibilityLevel !== "client_safe",
  };
}

function buildPendingFileId(file) {
  return [
    file?.name || "archivo",
    file?.size || 0,
    file?.lastModified || 0,
  ].join("::");
}

function deriveSourceType(baseSourceType, fileCount, linkCount) {
  const hasFiles = Number(fileCount) > 0;
  const hasLinks = Number(linkCount) > 0;

  if (hasFiles && hasLinks) return "mixed";
  if (hasFiles) return "file";
  if (hasLinks) return "url";
  return baseSourceType || "mixed";
}

function buildFiltersForApi(filters, activeTab) {
  const includeDrafts = activeTab === "manage" ? "true" : "false";
  return {
    q: filters.q || "",
    manufacturerCodes: filters.manufacturerCodes.join(","),
    solutionCodes: filters.solutionCodes.join(","),
    technologyCodes: filters.technologyCodes.join(","),
    needCodes: filters.needCodes.join(","),
    requirementCodes: filters.requirementCodes.join(","),
    competitorCodes: filters.competitorCodes.join(","),
    industryCodes: filters.industryCodes.join(","),
    assetTypeCodes: filters.assetTypeCodes.join(","),
    audienceCodes: filters.audienceCodes.join(","),
    visibilityLevels: filters.visibilityLevels.join(","),
    stageCodes: filters.stageCodes.join(","),
    tags: filters.tags.join(","),
    languageCodes: filters.languageCodes.join(","),
    onlyClientSafe: filters.onlyClientSafe ? "true" : "false",
    includeDrafts,
    status:
      activeTab === "manage"
        ? filters.status || "all"
        : filters.status === "all"
          ? "published"
          : filters.status || "published",
    sort: filters.sort || "updated_desc",
    page: 1,
    pageSize: 24,
  };
}

function metricValue(value) {
  return new Intl.NumberFormat("es-PE").format(Number(value || 0));
}

function getManageStatusHelper(status) {
  switch (status) {
    case "draft":
      return "Borradores listos para completar, adjuntar y publicar";
    case "published":
      return "Activos vigentes disponibles para mantenimiento";
    case "obsolete":
      return "Material retirado de uso, pendiente de depuracion o reemplazo";
    case "archived":
      return "Activos archivados conservados solo para referencia";
    default:
      return "Incluye borradores y activos vigentes disponibles para gestion";
  }
}

function getPublishSectionErrors(assetLike) {
  const manufacturerCodes = Array.isArray(assetLike?.manufacturerCodes)
    ? assetLike.manufacturerCodes
    : [];
  const solutionCodes = Array.isArray(assetLike?.solutionCodes)
    ? assetLike.solutionCodes
    : [];

  return {
    catalogContext:
      manufacturerCodes.length === 0 && solutionCodes.length === 0,
  };
}

function hasPublishSectionErrors(sectionErrors) {
  return Object.values(sectionErrors || {}).some(Boolean);
}

function buildPublishSectionErrorMessage(sectionErrors) {
  return Object.entries(PUBLISH_SECTION_MESSAGES)
    .filter(([key]) => sectionErrors?.[key])
    .map(([, message]) => message)
    .join(" | ");
}

function getPublishSectionErrorsFromIssues(issues) {
  if (!Array.isArray(issues)) return EMPTY_PUBLISH_SECTION_ERRORS;
  return {
    catalogContext: issues.includes(PUBLISH_SECTION_MESSAGES.catalogContext),
  };
}

function getAssetFieldErrorsFromIssues(issues) {
  if (!Array.isArray(issues)) {
    return {
      title: false,
      summary: false,
    };
  }
  return {
    title: issues.includes(ASSET_FIELD_MESSAGES.title),
    summary: issues.includes(ASSET_FIELD_MESSAGES.summary),
  };
}

function SummaryCard({ label, value, helper, tone = "default" }) {
  return (
    <article
      className={`enablement-library-metric enablement-library-metric-${tone}`}
    >
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{helper}</p>
    </article>
  );
}

function AnalyzeDocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M12 3l1.55 3.95L17.5 8.5l-3.95 1.55L12 14l-1.55-3.95L6.5 8.5l3.95-1.55L12 3zm6 8l.9 2.1L21 14l-2.1.9L18 17l-.9-2.1L15 14l2.1-.9L18 11zM7 14l1.2 2.8L11 18l-2.8 1.2L7 22l-1.2-2.8L3 18l2.8-1.2L7 14z"
        fill="currentColor"
      />
    </svg>
  );
}

function emptyCatalogAdminDrafts() {
  return CATALOG_ADMIN_TYPES.reduce((accumulator, entry) => {
    accumulator[entry.adminKey] = {
      name: "",
      description: "",
    };
    return accumulator;
  }, {});
}

function getIntakeStatusLabel(status) {
  switch (String(status || "").trim()) {
    case "analysis_pending":
      return "Análisis pendiente";
    case "pending":
      return "Pendiente";
    case "completed":
      return "Completado";
    case "failed":
      return "Fallido";
    default:
      return String(status || "").trim();
  }
}

function getIntakeAnalysisModelLabel(model) {
  const normalizedModel = String(model || "").trim();
  if (!normalizedModel || normalizedModel === "heuristic_prefill") {
    return "";
  }
  return normalizedModel;
}

function OptionPicker({
  title,
  options,
  values,
  onToggle,
  requirementHint,
  invalidMessage,
  sectionRef,
}) {
  const hasOptions = Array.isArray(options) && options.length > 0;
  if (!hasOptions && !requirementHint && !invalidMessage) return null;

  return (
    <section
      ref={sectionRef}
      className={`enablement-library-picker ${invalidMessage ? "is-invalid" : ""}`}
    >
      <div className="enablement-library-picker-header">
        <div className="enablement-library-picker-title">{title}</div>
        {requirementHint ? (
          <span className="enablement-library-picker-required">
            Obligatorio para publicar
          </span>
        ) : null}
      </div>
      {hasOptions ? (
        <div className="enablement-library-chip-cloud">
          {options.map((option) => {
            const isActive = values.includes(option.code);
            return (
              <button
                key={`${title}-${option.code}`}
                type="button"
                className={`enablement-library-chip ${isActive ? "is-active" : ""}`}
                onClick={() => onToggle(option.code)}
              >
                {option.name}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="enablement-library-picker-empty">
          No hay opciones disponibles en este catalogo.
        </div>
      )}
      {invalidMessage ? (
        <div className="enablement-library-picker-helper is-error">
          {invalidMessage}
        </div>
      ) : requirementHint ? (
        <div className="enablement-library-picker-helper">
          {requirementHint}
        </div>
      ) : null}
    </section>
  );
}

function EditableAssetListItem({ asset, isSelected, onSelect }) {
  const primaryLabel = getUseResultPrimaryLabel(asset);

  return (
    <button
      type="button"
      className={`enablement-library-use-result-row enablement-library-editable-result-row ${isSelected ? "is-selected" : ""}`.trim()}
      onClick={() => onSelect(asset.publicId)}
      title={primaryLabel}
    >
      <div className="enablement-library-use-result-main">
        <strong>{primaryLabel}</strong>
      </div>
    </button>
  );
}

function getUseResultPrimaryLabel(asset) {
  if (Array.isArray(asset?.files) && asset.files.length) {
    return String(asset.files[0]?.originalFileName || "").trim() || "Archivo";
  }
  if (Array.isArray(asset?.links) && asset.links.length) {
    return String(asset.links[0]?.label || asset.links[0]?.url || "").trim() ||
      "URL";
  }
  return String(asset?.title || "").trim() || "Material";
}

function UseResultListItem({ asset, isSelected, onSelect }) {
  const primaryLabel = getUseResultPrimaryLabel(asset);
  const secondaryLabel = String(asset?.title || "").trim();

  return (
    <button
      type="button"
      className={`enablement-library-use-result-row ${isSelected ? "is-selected" : ""}`.trim()}
      onClick={() => onSelect(asset.publicId)}
      title={primaryLabel}
    >
      <div className="enablement-library-use-result-main">
        <strong>{primaryLabel}</strong>
        <span>{secondaryLabel || "Sin titulo"}</span>
      </div>
      <span className="enablement-library-use-result-meta">
        {asset.assetTypeLabel}
      </span>
    </button>
  );
}

function EmptyState({ title, helper }) {
  return (
    <div className="enablement-library-empty">
      <strong>{title}</strong>
      <p>{helper}</p>
    </div>
  );
}

function GovernanceAssetCard({
  item,
  meta,
  onOpen,
  onDeactivate,
  onDelete,
  working,
}) {
  return (
    <div className="enablement-library-mini-card static enablement-library-governance-asset-card">
      <div className="enablement-library-catalog-entry-main">
        <strong>{item.title}</strong>
        <span>{meta}</span>
      </div>
      <div className="enablement-library-inline-actions">
        <button
          type="button"
          className="enablement-library-action subtle"
          onClick={() => onOpen(item.publicId)}
          disabled={working}
        >
          Abrir
        </button>
        <button
          type="button"
          className="enablement-library-action subtle is-danger"
          onClick={() => onDeactivate(item)}
          disabled={working}
        >
          Desactivar
        </button>
        <button
          type="button"
          className="enablement-library-action subtle is-danger"
          onClick={() => onDelete(item)}
          disabled={working}
        >
          Eliminar
        </button>
      </div>
    </div>
  );
}

function GovernanceAssetListRow({
  item,
  meta,
  isDuplicate,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onOpen,
  onDeactivate,
  onDelete,
  working,
}) {
  return (
    <div className="enablement-library-governance-list-row" role="listitem">
      <div className="enablement-library-catalog-entry-main">
        <div className="enablement-library-governance-list-row-heading">
          <strong>{item.title}</strong>
          {isDuplicate ? (
            <span className="enablement-library-duplicate-flag">
              Posible duplicado
            </span>
          ) : null}
        </div>
        <span>{meta}</span>
      </div>
      <div className="user-kebab-wrap enablement-library-governance-list-row-menu">
        <button
          type="button"
          className="kebab-btn"
          onClick={() => onToggleMenu(item.publicId)}
          aria-label={`Abrir acciones para ${item.title}`}
          aria-expanded={menuOpen}
        >
          ⋮
        </button>
        {menuOpen ? (
          <div className="user-kebab-menu">
            <button
              type="button"
              onClick={() => {
                onCloseMenu();
                onOpen(item.publicId);
              }}
              disabled={working}
            >
              Abrir
            </button>
            <button
              type="button"
              className="user-kebab-menu-danger"
              onClick={() => {
                onCloseMenu();
                onDeactivate(item);
              }}
              disabled={working}
            >
              Desactivar
            </button>
            <button
              type="button"
              className="user-kebab-menu-danger"
              onClick={() => {
                onCloseMenu();
                onDelete(item);
              }}
              disabled={working}
            >
              Eliminar
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function CommercialEnablementPage({ currentUser }) {
  const [activeTab, setActiveTab] = useState("use");
  const [bootstrap, setBootstrap] = useState(EMPTY_BOOTSTRAP);
  const [assetsResult, setAssetsResult] = useState(EMPTY_ASSET_RESULT);
  const [selectedAssetPublicId, setSelectedAssetPublicId] = useState(null);
  const [isCreatingNewAsset, setIsCreatingNewAsset] = useState(false);
  const [assetDetail, setAssetDetail] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [working, setWorking] = useState(false);
  const [reanalyzingAssetSummary, setReanalyzingAssetSummary] = useState(false);
  const [workingMessage, setWorkingMessage] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [assetSaveFeedback, setAssetSaveFeedback] = useState(null);
  const assetEditorFormRef = useRef(null);
  const validationHighlightTimeoutsRef = useRef(new Map());
  const titleInputRef = useRef(null);
  const summaryInputRef = useRef(null);
  const manufacturerSectionRef = useRef(null);
  const [catalogAdminDrafts, setCatalogAdminDrafts] = useState(
    emptyCatalogAdminDrafts,
  );
  const [catalogAdminEditors, setCatalogAdminEditors] = useState({});
  const [catalogAdminVisibility, setCatalogAdminVisibility] =
    useState("active");
  const [openCatalogAdminMenuId, setOpenCatalogAdminMenuId] = useState(null);
  const [openGovernanceMenuId, setOpenGovernanceMenuId] = useState(null);
  const [linkDraft, setLinkDraft] = useState(emptyLinkDraft);
  const [editingLinkPublicId, setEditingLinkPublicId] = useState(null);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [pendingLinks, setPendingLinks] = useState([]);
  const [creationMode, setCreationMode] = useState("manual");
  const [intakeSession, setIntakeSession] = useState(null);
  const [intakeHint, setIntakeHint] = useState("");
  const [intakeExtractedText, setIntakeExtractedText] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [analytics, setAnalytics] = useState(EMPTY_ANALYTICS);
  const [governance, setGovernance] = useState(EMPTY_GOVERNANCE);
  const [publishSectionErrors, setPublishSectionErrors] = useState(
    EMPTY_PUBLISH_SECTION_ERRORS,
  );
  const [filters, setFilters] = useState({
    q: "",
    manufacturerCodes: [],
    solutionCodes: [],
    technologyCodes: [],
    needCodes: [],
    requirementCodes: [],
    competitorCodes: [],
    industryCodes: [],
    assetTypeCodes: [],
    audienceCodes: [],
    visibilityLevels: [],
    languageCodes: [],
    stageCodes: [],
    tags: [],
    onlyClientSafe: false,
    status: "published",
    sort: "updated_desc",
  });
  const [searchQueryDraft, setSearchQueryDraft] = useState("");
  const permissionSet = useMemo(
    () => new Set(currentUser?.permissions || []),
    [currentUser],
  );
  const permissions = bootstrap.permissions || EMPTY_BOOTSTRAP.permissions;
  const canUse =
    permissions.canUse ||
    permissionSet.has("enablement_comercial.use") ||
    permissionSet.has("enablement_comercial.read");
  const canUpload =
    permissions.canUpload ||
    permissionSet.has("enablement_comercial.upload") ||
    permissionSet.has("enablement_comercial.update");
  const canManage =
    permissions.canManage ||
    permissionSet.has("enablement_comercial.manage") ||
    permissionSet.has("enablement_comercial.analytics");
  const canAdmin =
    permissions.canAdmin || permissionSet.has("enablement_comercial.admin");

  const catalogs = bootstrap.catalogs || {};
  const adminCatalogs = bootstrap.adminCatalogs || catalogs;
  const visibleTabs = TABS.filter((tab) => {
    if (tab.id === "manage") return canUpload || canManage || canAdmin;
    if (tab.id === "governance") return canManage || canAdmin;
    return true;
  });

  const activeFilters = filters;

  const selectedAssetFromList = useMemo(
    () =>
      assetsResult.items.find(
        (asset) => asset.publicId === selectedAssetPublicId,
      ) || null,
    [assetsResult.items, selectedAssetPublicId],
  );
  const duplicateCandidateIds = useMemo(
    () =>
      new Set(
        (governance.duplicateCandidates || [])
          .map((item) => item?.publicId)
          .filter(Boolean),
      ),
    [governance.duplicateCandidates],
  );
  const selectedAsset =
    assetDetail?.publicId === selectedAssetPublicId
      ? assetDetail
      : selectedAssetFromList;

  function handleSelectAsset(publicId) {
    setIsCreatingNewAsset(false);
    setSelectedAssetPublicId(publicId);
    setEditingLinkPublicId(null);
    setCreationMode("manual");
    setIntakeSession(null);
    setIntakeHint("");
    setIntakeExtractedText("");
    setReviewConfirmed(false);
  }

  function handleStartNewAsset() {
    setIsCreatingNewAsset(true);
    setSelectedAssetPublicId(null);
    setAssetDetail(null);
    setEditingLinkPublicId(null);
    setDraft(emptyDraft());
    setPublishSectionErrors(EMPTY_PUBLISH_SECTION_ERRORS);
    setAssetSaveFeedback(null);
    setPendingFiles([]);
    setPendingLinks([]);
    setCreationMode("manual");
    setIntakeSession(null);
    setIntakeHint("");
    setIntakeExtractedText("");
    setReviewConfirmed(false);
    setLinkDraft(emptyLinkDraft());
    setSuccess("");
    setError("");
  }

  function handleChangeCreationMode(nextMode) {
    setCreationMode(nextMode);
    setEditingLinkPublicId(null);
    setAssetSaveFeedback(null);
    setSuccess("");
    setError("");
    setPendingFiles([]);
    setPendingLinks([]);
    setLinkDraft(emptyLinkDraft());

    if (nextMode === "manual") {
      setIntakeSession(null);
      setIntakeHint("");
      setIntakeExtractedText("");
      setReviewConfirmed(false);
      setDraft(emptyDraft());
      return;
    }

    setDraft(emptyDraft());
  }

  const loadBootstrap = useCallback(async () => {
    const response = await api.get("/api/commercial-enablement/bootstrap");
    setBootstrap(response.data || EMPTY_BOOTSTRAP);
  }, []);

  const loadAssets = useCallback(
    async (currentTab, currentFilters) => {
      setLoadingAssets(true);
      try {
        const response = await api.get("/api/commercial-enablement/assets", {
          params: buildFiltersForApi(currentFilters, currentTab),
        });
        const payload = response.data || EMPTY_ASSET_RESULT;
        setAssetsResult(payload);
        setSelectedAssetPublicId((current) => {
          if (
            current &&
            payload.items.some((item) => item.publicId === current)
          ) {
            return current;
          }
          if (currentTab === "manage" && isCreatingNewAsset) {
            return null;
          }
          return payload.items[0]?.publicId || null;
        });
      } finally {
        setLoadingAssets(false);
      }
    },
    [isCreatingNewAsset],
  );

  const loadAssetDetail = useCallback(async (assetPublicId) => {
    if (!assetPublicId) {
      setAssetDetail(null);
      return;
    }
    const response = await api.get(
      `/api/commercial-enablement/assets/${assetPublicId}`,
    );
    setAssetDetail(response.data || null);
  }, []);

  const loadGovernance = useCallback(async () => {
    if (!(canManage || canAdmin)) return;
    const [analyticsResponse, governanceResponse] = await Promise.all([
      api.get("/api/commercial-enablement/analytics/overview"),
      api.get("/api/commercial-enablement/governance/overview"),
    ]);
    setAnalytics({
      ...EMPTY_ANALYTICS,
      ...(analyticsResponse.data || {}),
      totals: {
        ...EMPTY_ANALYTICS.totals,
        ...(analyticsResponse.data?.totals || {}),
      },
    });
    setGovernance({
      ...EMPTY_GOVERNANCE,
      ...(governanceResponse.data || {}),
      summary: {
        ...EMPTY_GOVERNANCE.summary,
        ...(governanceResponse.data?.summary || {}),
      },
      qualityIssues: Array.isArray(governanceResponse.data?.qualityIssues)
        ? governanceResponse.data.qualityIssues
        : [],
      duplicateCandidates: Array.isArray(
        governanceResponse.data?.duplicateCandidates,
      )
        ? governanceResponse.data.duplicateCandidates
        : [],
      manageableItems: Array.isArray(governanceResponse.data?.manageableItems)
        ? governanceResponse.data.manageableItems
        : [],
    });
  }, [canAdmin, canManage]);

  const refreshAll = useCallback(
    async (options = {}) => {
      const nextTab = options.activeTab || activeTab;
      const nextFilters = options.filters || activeFilters;
      setError("");
      setSuccess("");
      setLoading(true);
      try {
        await Promise.all([loadBootstrap(), loadAssets(nextTab, nextFilters)]);
      } catch (requestError) {
        setError(
          getApiErrorMessage(
            requestError,
            "No fue posible cargar el módulo de biblioteca comercial",
          ),
        );
      } finally {
        setLoading(false);
      }
    },
    [activeFilters, activeTab, loadAssets, loadBootstrap],
  );

  useEffect(() => {
    // Refreshing all library data on dependency changes is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (loading) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAssets(activeTab, activeFilters).catch((requestError) => {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible actualizar la biblioteca comercial",
        ),
      );
    });
  }, [activeFilters, activeTab, loadAssets, loading]);

  useEffect(() => {
    if (
      assetDetail?.publicId &&
      assetDetail.publicId !== selectedAssetPublicId
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAssetDetail(null);
    }
  }, [assetDetail?.publicId, selectedAssetPublicId]);

  useEffect(() => {
    if (
      assetDetail?.publicId &&
      assetDetail.publicId === selectedAssetPublicId
    ) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAssetDetail(selectedAssetPublicId).catch((requestError) => {
      setError(
        getApiErrorMessage(requestError, "No fue posible cargar el activo"),
      );
    });
  }, [assetDetail?.publicId, loadAssetDetail, selectedAssetPublicId]);

  useEffect(() => {
    if (activeTab === "governance") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadGovernance().catch((requestError) => {
        setError(
          getApiErrorMessage(requestError, "No fue posible cargar gobierno"),
        );
      });
    }
  }, [activeTab, loadGovernance]);

  useEffect(() => {
    setSearchQueryDraft(String(filters.q || ""));
  }, [filters.q]);

  useEffect(() => {
    if (!openGovernanceMenuId) return undefined;

    function handleOutsideClick(event) {
      if (
        event.target.closest(".enablement-library-governance-list-row-menu")
      ) {
        return;
      }
      setOpenGovernanceMenuId(null);
    }

    document.addEventListener("click", handleOutsideClick);
    return () => {
      document.removeEventListener("click", handleOutsideClick);
    };
  }, [openGovernanceMenuId]);

  useEffect(() => {
    if (!openCatalogAdminMenuId) return undefined;

    function handleOutsideClick(event) {
      if (event.target.closest(".enablement-library-catalog-entry-menu")) {
        return;
      }
      setOpenCatalogAdminMenuId(null);
    }

    document.addEventListener("click", handleOutsideClick);
    return () => {
      document.removeEventListener("click", handleOutsideClick);
    };
  }, [openCatalogAdminMenuId]);

  useEffect(() => {
    // These drafts intentionally reset when the selected asset changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(buildDraftFromAsset(selectedAsset));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPublishSectionErrors(EMPTY_PUBLISH_SECTION_ERRORS);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLinkDraft(emptyLinkDraft());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingFiles([]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingLinks([]);
  }, [selectedAsset]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPublishSectionErrors((current) => {
      if (!hasPublishSectionErrors(current)) return current;
      if (draft.status !== "published") return EMPTY_PUBLISH_SECTION_ERRORS;
      return getPublishSectionErrors(draft);
    });
  }, [draft.status, draft.manufacturerCodes, draft.solutionCodes]);

  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  function applySearchFilters(event) {
    event?.preventDefault();
    const nextQuery = String(searchQueryDraft || "");
    setFilters((current) => {
      if (current.q === nextQuery) return current;
      return { ...current, q: nextQuery };
    });
  }

  function toggleGovernanceMenu(publicId) {
    setOpenGovernanceMenuId((currentValue) =>
      currentValue === publicId ? null : publicId,
    );
  }

  function toggleFilterValue(field, value) {
    setFilters((current) => ({
      ...current,
      [field]: toggleValue(current[field], value),
    }));
  }

  function updateDraftField(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function toggleDraftValue(field, value) {
    setDraft((current) => ({
      ...current,
      [field]: toggleValue(current[field], value),
    }));
  }

  function updateCatalogAdminDraft(catalogType, field, value) {
    setCatalogAdminDrafts((current) => ({
      ...current,
      [catalogType]: {
        ...current[catalogType],
        [field]: value,
      },
    }));
  }

  function buildCatalogAdminEditor(entry) {
    return {
      name: String(entry?.name || "").trim(),
      description: String(entry?.description || "").trim(),
    };
  }

  function buildCatalogAdminEditorKey(catalogKey, entry) {
    if (!entry) return "";
    return `${catalogKey}:${entry.publicId || entry.code || "item"}`;
  }

  function startCatalogAdminEdit(catalogKey, entry) {
    if (!entry?.publicId) return;
    const editorKey = buildCatalogAdminEditorKey(catalogKey, entry);
    if (!editorKey) return;
    setOpenCatalogAdminMenuId(null);
    setCatalogAdminEditors((current) => ({
      ...current,
      [editorKey]: buildCatalogAdminEditor(entry),
    }));
  }

  function updateCatalogAdminEditor(editorKey, field, value) {
    if (!editorKey) return;
    setCatalogAdminEditors((current) => ({
      ...current,
      [editorKey]: {
        ...current[editorKey],
        [field]: value,
      },
    }));
  }

  function cancelCatalogAdminEdit(editorKey) {
    if (!editorKey) return;
    setCatalogAdminEditors((current) => {
      const next = { ...current };
      delete next[editorKey];
      return next;
    });
  }

  function buildCatalogAdminMenuKey(catalogKey, entry) {
    if (!entry) return "";
    return `${catalogKey}:${entry.publicId || entry.code || "item"}`;
  }

  function toggleCatalogAdminMenu(menuKey) {
    if (!menuKey) return;
    setOpenCatalogAdminMenuId((currentValue) =>
      currentValue === menuKey ? null : menuKey,
    );
  }

  function focusAssetValidationTarget(target) {
    window.requestAnimationFrame(() => {
      const element = target?.current;
      if (!element) return;

      const isField =
        element instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
      const highlightClass = isField
        ? "is-validation-target"
        : "is-validation-target-section";
      const activeTimeout = validationHighlightTimeoutsRef.current.get(element);
      if (activeTimeout) {
        clearTimeout(activeTimeout);
      }
      element.classList.remove(highlightClass);
      void element.offsetWidth;
      element.classList.add(highlightClass);
      const timeoutId = window.setTimeout(() => {
        element.classList.remove(highlightClass);
        validationHighlightTimeoutsRef.current.delete(element);
      }, 1800);
      validationHighlightTimeoutsRef.current.set(element, timeoutId);

      element.scrollIntoView({ behavior: "smooth", block: "center" });
      if (typeof element.focus === "function") {
        element.focus({ preventScroll: true });
        return;
      }
      const focusable = element.querySelector(
        "input, textarea, select, button, [tabindex]:not([tabindex='-1'])",
      );
      focusable?.focus?.({ preventScroll: true });
    });
  }

  function focusFirstMissingAssetField(payload, options = {}) {
    const fieldErrors = options.fieldErrors || {};
    const sectionErrors = options.sectionErrors || {};

    if (fieldErrors.title || !String(payload?.title || "").trim()) {
      focusAssetValidationTarget(titleInputRef);
      return;
    }
    if (fieldErrors.summary || !String(payload?.summary || "").trim()) {
      focusAssetValidationTarget(summaryInputRef);
      return;
    }
    if (sectionErrors?.catalogContext) {
      focusAssetValidationTarget(manufacturerSectionRef);
    }
  }

  async function runAssetMutation(action, successMessage, options = {}) {
    const onSuccessMessage = options.onSuccessMessage;
    const onErrorMessage = options.onErrorMessage;
    const trackAssetResult = options.trackAssetResult !== false;
    setWorkingMessage(options.workingMessage || "Procesando cambios...");
    setWorking(true);
    setError("");
    try {
      const result = await action();
      setPublishSectionErrors(EMPTY_PUBLISH_SECTION_ERRORS);
      let nextFilters = activeFilters;

      if (trackAssetResult && result?.data?.publicId) {
        setIsCreatingNewAsset(false);
        setSelectedAssetPublicId(result.data.publicId);
        setAssetDetail(result.data);

        if (
          activeTab === "manage" &&
          !matchesStatusFilter(activeFilters.status, result.data.status)
        ) {
          nextFilters = { ...activeFilters, status: "all" };
          setFilters((current) => ({ ...current, status: "all" }));
        }

        if (activeTab === "manage") {
          setAssetsResult((current) =>
            upsertAssetResult(current, result.data, nextFilters.status),
          );
        }
      }

      await Promise.all([
        loadBootstrap(),
        loadAssets(activeTab, nextFilters),
        activeTab === "governance" ? loadGovernance() : Promise.resolve(),
      ]);
      if (typeof onSuccessMessage === "function") {
        onSuccessMessage(successMessage);
      } else {
        setSuccess(successMessage);
      }
      return result?.data;
    } catch (requestError) {
      const responseIssues = requestError?.response?.data?.issues;
      const responseFieldErrors = getAssetFieldErrorsFromIssues(responseIssues);
      const responseSectionErrors =
        getPublishSectionErrorsFromIssues(responseIssues);
      if (
        responseFieldErrors.title ||
        responseFieldErrors.summary ||
        hasPublishSectionErrors(responseSectionErrors)
      ) {
        setPublishSectionErrors(responseSectionErrors);
        focusFirstMissingAssetField(draft, {
          fieldErrors: responseFieldErrors,
          sectionErrors: responseSectionErrors,
        });
      }
      const errorMessage = getApiErrorMessage(
        requestError,
        "No fue posible ejecutar la acción",
      );
      if (typeof onErrorMessage === "function") {
        onErrorMessage(errorMessage);
      } else {
        setError(errorMessage);
      }
      return null;
    } finally {
      setWorkingMessage("");
      setWorking(false);
    }
  }

  async function handleCreateIntakeSession(event) {
    const inputElement = event.target;
    const file = inputElement.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("files", file);

    setWorking(true);
    setError("");
    setSuccess("");
    setAssetSaveFeedback(null);
    try {
      const response = await api.post(
        `/api/commercial-enablement/intake-sessions?hint=${encodeURIComponent(intakeHint)}`,
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
          timeout: 60000,
        },
      );
      const createdSession = response.data || null;
      setIntakeSession(createdSession);
      setDraft(buildDraftFromIntakeSession(createdSession));
      setReviewConfirmed(Boolean(createdSession?.reviewConfirmed));
      setIntakeExtractedText("");
      setPendingFiles([]);
      setPendingLinks([]);
      setLinkDraft(emptyLinkDraft());
      setAssetSaveFeedback({
        tone: "success",
        message:
          "Documento cargado. Usa Analizar documento para generar sugerencias antes de crear el activo.",
      });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible cargar el documento para la sesion asistida",
      );
      setError(message);
      setAssetSaveFeedback({ tone: "error", message });
    } finally {
      inputElement.value = "";
      setWorking(false);
    }
  }

  async function handleRefreshIntakeAnalysis(forceRegenerate = false) {
    if (!intakeSession?.publicId) return;
    setWorkingMessage(
      forceRegenerate
        ? "La IA esta reanalizando el documento..."
        : "La IA esta analizando el documento...",
    );
    setWorking(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(
        `/api/commercial-enablement/intake-sessions/${intakeSession.publicId}/analyze`,
        {
          hint: intakeHint,
          forceRegenerate,
        },
        {
          timeout: 120000,
        },
      );
      const nextSession = response.data || null;
      setIntakeSession(nextSession);
      setDraft(buildDraftFromIntakeSession(nextSession));
      setReviewConfirmed(Boolean(nextSession?.reviewConfirmed));
      setAssetSaveFeedback({
        tone: "success",
        message: forceRegenerate
          ? "Documento reanalizado. Verifica los cambios antes de continuar."
          : "Documento analizado. Revisa las sugerencias antes de continuar.",
      });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible volver a analizar el documento",
      );
      setError(message);
      setAssetSaveFeedback({ tone: "error", message });
    } finally {
      setWorkingMessage("");
      setWorking(false);
    }
  }

  async function handleReanalyzeAssetSummary() {
    if (!selectedAsset?.publicId || reanalyzingAssetSummary) return;

    setReanalyzingAssetSummary(true);
    setWorkingMessage(
      "La IA esta resumiendo el contenido del documento. Espera la respuesta...",
    );
    setWorking(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(
        `/api/commercial-enablement/assets/${selectedAsset.publicId}/reanalyze-summary`,
        {
          forceRegenerate: true,
        },
        {
          timeout: 120000,
        },
      );

      const nextSummary = String(
        response.data?.summarySuggestion?.text || "",
      ).trim();
      if (!nextSummary) {
        throw new Error("No se recibio una propuesta de resumen valida");
      }

      setDraft((current) => ({
        ...current,
        summary: nextSummary,
      }));
      setSuccess(
        "Se genero una nueva propuesta de resumen. Revisa el texto antes de guardar.",
      );
      setAssetSaveFeedback({
        tone: "success",
        message:
          "Se genero una nueva propuesta de resumen. Revisa el texto antes de guardar.",
      });
      window.requestAnimationFrame(() => {
        const element = summaryInputRef.current;
        if (!element) return;
        element.focus();
        const end = element.value.length;
        try {
          element.setSelectionRange(end, end);
        } catch {
          // noop
        }
      });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible reanalizar el resumen del activo",
      );
      setError(message);
      setAssetSaveFeedback({ tone: "error", message });
    } finally {
      setReanalyzingAssetSummary(false);
      setWorkingMessage("");
      setWorking(false);
    }
  }

  async function handleLoadExtractedContent() {
    if (!intakeSession?.publicId || intakeExtractedText) return;
    setWorking(true);
    setError("");
    try {
      const response = await api.get(
        `/api/commercial-enablement/intake-sessions/${intakeSession.publicId}/extracted-content`,
      );
      const combined = Array.isArray(response.data?.contents)
        ? response.data.contents.map((entry) => entry.textContent).join("\n\n")
        : "";
      setIntakeExtractedText(combined);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar el texto extraido",
        ),
      );
    } finally {
      setWorking(false);
    }
  }

  async function handleSaveIntakeReview() {
    if (!intakeSession?.publicId) return;

    setWorking(true);
    setError("");
    try {
      const acceptedPayload = buildAssetPayload({
        ...draft,
        sourceType: "file",
      });
      const response = await api.patch(
        `/api/commercial-enablement/intake-sessions/${intakeSession.publicId}/review`,
        {
          acceptedPayload,
          reviewConfirmed,
        },
      );
      setIntakeSession(response.data || null);
      setAssetSaveFeedback({
        tone: "success",
        message: reviewConfirmed
          ? "Revision asistida guardada. Ya puedes crear el activo."
          : "Cambios guardados en la revision asistida.",
      });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible guardar la revision asistida",
      );
      setError(message);
      setAssetSaveFeedback({ tone: "error", message });
    } finally {
      setWorking(false);
    }
  }

  async function handleCancelIntakeSession() {
    if (!intakeSession?.publicId) {
      handleChangeCreationMode("manual");
      return;
    }

    setWorking(true);
    setError("");
    try {
      await api.post(
        `/api/commercial-enablement/intake-sessions/${intakeSession.publicId}/cancel`,
      );
      setCreationMode("manual");
      setIntakeSession(null);
      setIntakeHint("");
      setIntakeExtractedText("");
      setReviewConfirmed(false);
      setDraft(emptyDraft());
      setAssetSaveFeedback({
        tone: "success",
        message:
          "Sesion asistida cancelada. Puedes volver a crear el activo manualmente o cargar otro documento.",
      });
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        "No fue posible cancelar la sesion asistida",
      );
      setError(message);
      setAssetSaveFeedback({ tone: "error", message });
    } finally {
      setWorking(false);
    }
  }

  async function handleSaveAsset(event) {
    event?.preventDefault?.();
    setAssetSaveFeedback(null);

    if (
      creationMode === "assisted" &&
      !selectedAsset?.publicId &&
      intakeSession?.publicId
    ) {
      const payload = buildAssetPayload({
        ...draft,
        sourceType: "file",
      });
      const nextPublishSectionErrors =
        payload.status === "published"
          ? getPublishSectionErrors(payload)
          : EMPTY_PUBLISH_SECTION_ERRORS;

      if (!payload.title || payload.title.length < 3) {
        setError(ASSET_FIELD_MESSAGES.title);
        setAssetSaveFeedback({
          tone: "error",
          message: ASSET_FIELD_MESSAGES.title,
        });
        focusFirstMissingAssetField(payload, {
          fieldErrors: { title: true, summary: false },
          sectionErrors: nextPublishSectionErrors,
        });
        return;
      }

      if (payload.status === "published" && !payload.summary) {
        setError(ASSET_FIELD_MESSAGES.summary);
        setAssetSaveFeedback({
          tone: "error",
          message: ASSET_FIELD_MESSAGES.summary,
        });
        focusFirstMissingAssetField(payload, {
          fieldErrors: { title: false, summary: true },
          sectionErrors: nextPublishSectionErrors,
        });
        return;
      }

      if (hasPublishSectionErrors(nextPublishSectionErrors)) {
        setPublishSectionErrors(nextPublishSectionErrors);
        const validationMessage = buildPublishSectionErrorMessage(
          nextPublishSectionErrors,
        );
        setError(validationMessage);
        setAssetSaveFeedback({
          tone: "error",
          message: validationMessage,
        });
        focusFirstMissingAssetField(payload, {
          fieldErrors: { title: false, summary: false },
          sectionErrors: nextPublishSectionErrors,
        });
        return;
      }

      if (!reviewConfirmed) {
        setError(
          "Debes confirmar la revision manual antes de crear el activo.",
        );
        setAssetSaveFeedback({
          tone: "error",
          message:
            "Confirma la revision manual para registrar las sugerencias aceptadas.",
        });
        return;
      }

      const saved = await runAssetMutation(
        async () => {
          await api.patch(
            `/api/commercial-enablement/intake-sessions/${intakeSession.publicId}/review`,
            {
              acceptedPayload: payload,
              reviewConfirmed: true,
            },
          );
          return api.post(
            `/api/commercial-enablement/intake-sessions/${intakeSession.publicId}/create-asset`,
            {
              finalPayload: payload,
              reviewConfirmed: true,
            },
          );
        },
        "Activo creado desde documento",
        {
          onSuccessMessage: (message) =>
            setAssetSaveFeedback({ tone: "success", message }),
          onErrorMessage: (message) =>
            setAssetSaveFeedback({ tone: "error", message }),
        },
      );

      if (saved?.publicId) {
        setCreationMode("manual");
        setIntakeSession(null);
        setIntakeHint("");
        setIntakeExtractedText("");
        setReviewConfirmed(false);
      }
      return;
    }

    const isCreating = !selectedAsset?.publicId;
    const pendingFilesToUpload = isCreating ? pendingFiles : [];
    const pendingLinksToCreate = isCreating ? pendingLinks : [];
    const pendingResourceCount =
      pendingFilesToUpload.length + pendingLinksToCreate.length;
    const payload = buildAssetPayload({
      ...draft,
      sourceType: deriveSourceType(
        draft.sourceType,
        pendingFilesToUpload.length,
        pendingLinksToCreate.length,
      ),
    });

    if (isCreating && pendingResourceCount > 1) {
      setSuccess("");
      setError(SINGLE_RESOURCE_MESSAGE);
      setAssetSaveFeedback({
        tone: "error",
        message: SINGLE_RESOURCE_MESSAGE,
      });
      return;
    }

    const nextPublishSectionErrors =
      payload.status === "published"
        ? getPublishSectionErrors(payload)
        : EMPTY_PUBLISH_SECTION_ERRORS;

    if (!payload.title || payload.title.length < 3) {
      setSuccess("");
      setError(ASSET_FIELD_MESSAGES.title);
      setAssetSaveFeedback({
        tone: "error",
        message: ASSET_FIELD_MESSAGES.title,
      });
      focusFirstMissingAssetField(payload, {
        fieldErrors: { title: true, summary: false },
        sectionErrors: nextPublishSectionErrors,
      });
      return;
    }

    if (payload.status === "published" && !payload.summary) {
      setSuccess("");
      setError(ASSET_FIELD_MESSAGES.summary);
      setAssetSaveFeedback({
        tone: "error",
        message: ASSET_FIELD_MESSAGES.summary,
      });
      focusFirstMissingAssetField(payload, {
        fieldErrors: { title: false, summary: true },
        sectionErrors: nextPublishSectionErrors,
      });
      return;
    }

    if (hasPublishSectionErrors(nextPublishSectionErrors)) {
      setPublishSectionErrors(nextPublishSectionErrors);
      setSuccess("");
      const validationMessage = buildPublishSectionErrorMessage(
        nextPublishSectionErrors,
      );
      setError(validationMessage);
      setAssetSaveFeedback({
        tone: "error",
        message: validationMessage,
      });
      focusFirstMissingAssetField(payload, {
        fieldErrors: { title: false, summary: false },
        sectionErrors: nextPublishSectionErrors,
      });
      return;
    }

    const saved = await runAssetMutation(
      () =>
        selectedAsset?.publicId
          ? api.put(
              `/api/commercial-enablement/assets/${selectedAsset.publicId}`,
              payload,
            )
          : api.post("/api/commercial-enablement/assets", payload),
      selectedAsset?.publicId
        ? "Activo actualizado"
        : payload.status === "draft"
          ? "Activo creado como borrador. Se muestra en Cargar y administrar y no suma en Activos visibles hasta publicarlo"
          : "Activo creado",
      {
        onSuccessMessage: (message) =>
          setAssetSaveFeedback({ tone: "success", message }),
        onErrorMessage: (message) =>
          setAssetSaveFeedback({ tone: "error", message }),
      },
    );

    if (saved?.publicId) {
      setIsCreatingNewAsset(false);
      setSelectedAssetPublicId(saved.publicId);
      // Actualizar selectedAsset con los datos del response para garantizar que
      // los cambios de categorías (como soluciones) se reflejen correctamente
      setSelectedAsset(saved);
      // Reconstruir draft desde los datos actualizados
      setDraft(buildDraftFromAsset(saved));
    }

    if (!saved?.publicId || !isCreating) {
      return;
    }

    if (!pendingFilesToUpload.length && !pendingLinksToCreate.length) {
      return;
    }

    setWorking(true);

    const failedFiles = [];
    const failedLinks = [];

    try {
      for (const pendingFile of pendingFilesToUpload) {
        const formData = new FormData();
        formData.append("files", pendingFile.file);

        try {
          await api.post(
            `/api/commercial-enablement/assets/${saved.publicId}/files`,
            formData,
            {
              headers: { "Content-Type": "multipart/form-data" },
            },
          );
        } catch {
          failedFiles.push(pendingFile);
        }
      }

      for (const pendingLink of pendingLinksToCreate) {
        try {
          await api.post(
            `/api/commercial-enablement/assets/${saved.publicId}/links`,
            {
              url: pendingLink.url,
              linkType: pendingLink.linkType,
              label: pendingLink.label,
              description: pendingLink.description,
              isPrimary: pendingLink.isPrimary,
            },
          );
        } catch {
          failedLinks.push(pendingLink);
        }
      }

      await Promise.all([
        loadBootstrap(),
        loadAssets(activeTab, activeFilters),
        loadAssetDetail(saved.publicId),
        activeTab === "governance" ? loadGovernance() : Promise.resolve(),
      ]);

      setPendingFiles(failedFiles);
      setPendingLinks(failedLinks);
      setLinkDraft(emptyLinkDraft());

      const attachedCount =
        pendingFilesToUpload.length +
        pendingLinksToCreate.length -
        failedFiles.length -
        failedLinks.length;

      if (!failedFiles.length && !failedLinks.length) {
        setAssetSaveFeedback({
          tone: "success",
          message:
            attachedCount > 0
              ? "Activo creado con su recurso adjunto"
              : "Activo creado",
        });
        return;
      }

      setAssetSaveFeedback({
        tone: "error",
        message:
          attachedCount > 0
            ? "Activo creado, pero el recurso adicional no pudo adjuntarse"
            : "Activo creado, pero el recurso no pudo adjuntarse",
      });
    } finally {
      setWorking(false);
    }
  }

  async function handleUploadFiles(event) {
    const inputElement = event.target;
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const currentResourceCount = selectedAsset?.publicId
      ? (selectedAsset.files?.length || 0) + (selectedAsset.links?.length || 0)
      : pendingFiles.length + pendingLinks.length;

    if (files.length > 1) {
      inputElement.value = "";
      setError("Solo se permite un archivo por activo");
      setAssetSaveFeedback({
        tone: "error",
        message: "Solo se permite un archivo por activo",
      });
      return;
    }

    if (currentResourceCount > 0) {
      inputElement.value = "";
      setError(SINGLE_RESOURCE_MESSAGE);
      setAssetSaveFeedback({
        tone: "error",
        message: SINGLE_RESOURCE_MESSAGE,
      });
      return;
    }

    if (!selectedAsset?.publicId) {
      setPendingFiles((current) => [
        ...current,
        ...files.map((file) => ({
          id: buildPendingFileId(file),
          file,
        })),
      ]);
      setWorkingMessage("Subiendo archivo...");
      setWorking(true);
      setError("");
      try {
        await new Promise((resolve) => {
          requestAnimationFrame(() => resolve());
        });
        inputElement.value = "";
        setAssetSaveFeedback({
          tone: "success",
          message: "Archivo listo para guardarse con el activo",
        });
      } catch (selectionError) {
        setError(
          getApiErrorMessage(
            selectionError,
            "No fue posible preparar el archivo para el activo",
          ),
        );
        setAssetSaveFeedback({
          tone: "error",
          message: "No fue posible preparar el archivo para el activo",
        });
      } finally {
        inputElement.value = "";
        setWorkingMessage("");
        setWorking(false);
      }
      return;
    }

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    await runAssetMutation(
      () =>
        api.post(
          `/api/commercial-enablement/assets/${selectedAsset.publicId}/files`,
          formData,
          {
            headers: { "Content-Type": "multipart/form-data" },
          },
        ),
      "Archivo cargado",
      { workingMessage: "Subiendo archivo..." },
    );
    inputElement.value = "";
  }

  async function handleCreateLink(event) {
    event?.preventDefault?.();
    const currentResourceCount = selectedAsset?.publicId
      ? (selectedAsset.files?.length || 0) + (selectedAsset.links?.length || 0)
      : pendingFiles.length + pendingLinks.length;
    const normalizedUrl = String(linkDraft.url || "").trim();
    if (!normalizedUrl) {
      setError("Debes indicar una URL valida");
      setAssetSaveFeedback({
        tone: "error",
        message: "Debes indicar una URL valida",
      });
      return;
    }

    try {
      new URL(normalizedUrl);
    } catch {
      setError("Debes indicar una URL valida");
      setAssetSaveFeedback({
        tone: "error",
        message: "Debes indicar una URL valida",
      });
      return;
    }

    if (currentResourceCount > 0) {
      setError(SINGLE_RESOURCE_MESSAGE);
      setAssetSaveFeedback({
        tone: "error",
        message: SINGLE_RESOURCE_MESSAGE,
      });
      return;
    }

    const payload = {
      ...linkDraft,
      url: normalizedUrl,
      label: linkDraft.label || normalizedUrl,
    };

    if (!selectedAsset?.publicId) {
      setPendingLinks((current) => [
        ...current,
        {
          id: `${Date.now()}-${current.length}`,
          ...payload,
        },
      ]);
      setLinkDraft(emptyLinkDraft());
      setAssetSaveFeedback({
        tone: "success",
        message: "URL lista para guardarse con el activo",
      });
      return;
    }

    const result = await runAssetMutation(
      () =>
        api.post(
          `/api/commercial-enablement/assets/${selectedAsset.publicId}/links`,
          payload,
        ),
      "URL agregada",
    );
    if (result) {
      setLinkDraft(emptyLinkDraft());
    }
  }

  function handleStartEditLink(link) {
    setLinkDraft({
      url: link?.url || "",
      linkType: link?.linkType || "external",
      label: link?.label || "",
      description: link?.description || "",
      isPrimary: Boolean(link?.isPrimary),
    });
    setEditingLinkPublicId(link?.publicId || link?.id || null);
  }

  function handleCancelEditLink() {
    setEditingLinkPublicId(null);
    setLinkDraft(emptyLinkDraft());
  }

  async function handleSaveLinkEdit(linkPublicId) {
    if (!linkPublicId) return;

    const normalizedUrl = String(linkDraft.url || "").trim();
    if (!normalizedUrl) {
      setError("Debes indicar una URL valida");
      setAssetSaveFeedback({
        tone: "error",
        message: "Debes indicar una URL valida",
      });
      return;
    }

    try {
      new URL(normalizedUrl);
    } catch {
      setError("Debes indicar una URL valida");
      setAssetSaveFeedback({
        tone: "error",
        message: "Debes indicar una URL valida",
      });
      return;
    }

    const payload = {
      ...linkDraft,
      url: normalizedUrl,
      label: linkDraft.label || normalizedUrl,
    };

    if (!selectedAsset?.publicId) {
      setPendingLinks((current) =>
        current.map((link) =>
          link.id === linkPublicId
            ? {
                ...link,
                ...payload,
              }
            : link,
        ),
      );
      setEditingLinkPublicId(null);
      setLinkDraft(emptyLinkDraft());
      setError("");
      setAssetSaveFeedback({
        tone: "success",
        message: "URL actualizada",
      });
      return;
    }

    const result = await runAssetMutation(
      () =>
        api.put(
          `/api/commercial-enablement/assets/${selectedAsset.publicId}/links/${linkPublicId}`,
          payload,
        ),
      "URL actualizada",
    );

    if (result) {
      setEditingLinkPublicId(null);
      setLinkDraft(emptyLinkDraft());
    }
  }

  async function handleReplaceFile(filePublicId, event) {
    if (!filePublicId) return;
    const inputElement = event.target;
    const file = inputElement.files?.[0];
    if (!file) return;

    if (!selectedAsset?.publicId) {
      setPendingFiles((current) =>
        current.map((pendingFile) =>
          pendingFile.id === filePublicId
            ? {
                id: buildPendingFileId(file),
                file,
              }
            : pendingFile,
        ),
      );
      inputElement.value = "";
      setError("");
      setAssetSaveFeedback({
        tone: "success",
        message: "Archivo reemplazado",
      });
      return;
    }

    const formData = new FormData();
    formData.append("files", file);
    await runAssetMutation(
      () =>
        api.put(
          `/api/commercial-enablement/assets/${selectedAsset.publicId}/files/${filePublicId}`,
          formData,
          {
            headers: { "Content-Type": "multipart/form-data" },
          },
        ),
      "Archivo reemplazado",
    );
    inputElement.value = "";
  }

  function handleRemovePendingFile(fileId) {
    setPendingFiles((current) =>
      current.filter((pendingFile) => pendingFile.id !== fileId),
    );
  }

  function handleRemovePendingLink(linkId) {
    setPendingLinks((current) =>
      current.filter((pendingLink) => pendingLink.id !== linkId),
    );
  }

  async function handleCreateCatalogEntry(event, catalogKey, catalogType) {
    event.preventDefault();
    if (!canAdmin) return;

    const draftValue = catalogAdminDrafts[catalogKey] || {};
    const payload = {
      name: String(draftValue.name || "").trim(),
      description: String(draftValue.description || "").trim(),
    };

    if (!payload.name) {
      setSuccess("");
      setError("Debes indicar un nombre para la nueva opcion de catalogo");
      return;
    }

    setWorking(true);
    setError("");
    setSuccess("");
    try {
      const nextCatalogs = await api.post(
        `/api/commercial-enablement/catalogs/${catalogType}`,
        payload,
      );
      setBootstrap((current) => ({
        ...current,
        catalogs: nextCatalogs.data?.catalogs || current.catalogs || {},
        adminCatalogs:
          nextCatalogs.data?.adminCatalogs ||
          nextCatalogs.data?.catalogs ||
          current.adminCatalogs ||
          current.catalogs ||
          {},
      }));
      setCatalogAdminDrafts((current) => ({
        ...current,
        [catalogKey]: { name: "", description: "" },
      }));
      setSuccess("Catalogo actualizado");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible crear la opcion de catalogo",
        ),
      );
    } finally {
      setWorking(false);
    }
  }

  async function handleUpdateCatalogEntry(catalogKey, entry, overrides = {}) {
    if (!canAdmin || !entry?.publicId) return;
    const editorKey = buildCatalogAdminEditorKey(catalogKey, entry);

    const draftValue =
      catalogAdminEditors[editorKey] || buildCatalogAdminEditor(entry);
    const payload = {
      name: String(draftValue.name || "").trim(),
      description: String(draftValue.description || "").trim(),
      sortOrder: Number(entry.sortOrder || 0),
      isActive: overrides.isActive ?? true,
    };

    if (!payload.name) {
      setSuccess("");
      setError("Debes indicar un nombre para la opcion de catalogo");
      return;
    }

    setWorking(true);
    setError("");
    setSuccess("");
    try {
      const nextCatalogs = await api.put(
        `/api/commercial-enablement/catalogs/entry/${entry.publicId}`,
        payload,
      );
      setBootstrap((current) => ({
        ...current,
        catalogs: nextCatalogs.data?.catalogs || current.catalogs || {},
        adminCatalogs:
          nextCatalogs.data?.adminCatalogs ||
          nextCatalogs.data?.catalogs ||
          current.adminCatalogs ||
          current.catalogs ||
          {},
      }));
      cancelCatalogAdminEdit(editorKey);
      setSuccess(
        payload.isActive === false
          ? "Opcion desactivada"
          : "Catalogo actualizado",
      );
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          payload.isActive === false
            ? "No fue posible desactivar la opcion"
            : "No fue posible actualizar la opcion de catalogo",
        ),
      );
    } finally {
      setWorking(false);
    }
  }

  async function handleDeleteCatalogEntry(catalogKey, entry) {
    if (!canAdmin || !entry?.publicId) return;
    const editorKey = buildCatalogAdminEditorKey(catalogKey, entry);
    if (
      !window.confirm(
        `Se eliminara la opcion de catalogo "${entry.name}" de forma permanente. ¿Continuar?`,
      )
    ) {
      return;
    }

    setWorking(true);
    setError("");
    setSuccess("");
    try {
      const nextCatalogs = await api.delete(
        `/api/commercial-enablement/catalogs/entry/${entry.publicId}`,
      );
      setBootstrap((current) => ({
        ...current,
        catalogs: nextCatalogs.data?.catalogs || current.catalogs || {},
        adminCatalogs:
          nextCatalogs.data?.adminCatalogs ||
          nextCatalogs.data?.catalogs ||
          current.adminCatalogs ||
          current.catalogs ||
          {},
      }));
      cancelCatalogAdminEdit(editorKey);
      setSuccess("Opcion eliminada");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible eliminar la opcion de catalogo",
        ),
      );
    } finally {
      setWorking(false);
    }
  }

  async function handleGovernanceAssetStatus(item, endpoint, successMessage) {
    if (!item?.publicId) return;
    setWorking(true);
    setError("");
    setSuccess("");
    try {
      const result = await api.post(
        `/api/commercial-enablement/assets/${item.publicId}/${endpoint}`,
      );
      if (selectedAssetPublicId === item.publicId && result?.data?.publicId) {
        setAssetDetail(result.data);
      }
      await Promise.all([
        loadBootstrap(),
        loadAssets(activeTab, activeFilters),
        loadGovernance(),
      ]);
      setSuccess(successMessage);
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible actualizar el activo"),
      );
    } finally {
      setWorking(false);
    }
  }

  async function handleGovernanceAssetDelete(item) {
    if (!item?.publicId) return;
    if (
      !window.confirm(
        `Se eliminara el activo "${item.title}" de forma permanente. ¿Continuar?`,
      )
    ) {
      return;
    }

    setWorking(true);
    setError("");
    setSuccess("");
    try {
      await api.delete(`/api/commercial-enablement/assets/${item.publicId}`);
      if (selectedAssetPublicId === item.publicId) {
        setIsCreatingNewAsset(false);
        setSelectedAssetPublicId(null);
        setAssetDetail(null);
      }
      await Promise.all([
        loadBootstrap(),
        loadAssets(activeTab, activeFilters),
        loadGovernance(),
      ]);
      setSuccess("Activo eliminado");
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible eliminar el activo"),
      );
    } finally {
      setWorking(false);
    }
  }

  async function handleDeleteFile(filePublicId) {
    if (!selectedAsset?.publicId) return;
    await runAssetMutation(
      () =>
        api.delete(
          `/api/commercial-enablement/assets/${selectedAsset.publicId}/files/${filePublicId}`,
        ),
      "Archivo eliminado",
    );
  }

  async function handleDeleteLink(linkPublicId) {
    if (!selectedAsset?.publicId) return;
    await runAssetMutation(
      () =>
        api.delete(
          `/api/commercial-enablement/assets/${selectedAsset.publicId}/links/${linkPublicId}`,
        ),
      "URL eliminada",
    );
  }

  async function handleOpenFile(assetPublicId, file) {
    setError("");
    if (file?.isAvailable === false) {
      setError("El archivo ya no esta disponible en almacenamiento.");
      return;
    }
    try {
      const response = await api.get(
        `/api/commercial-enablement/assets/${assetPublicId}/files/${file.publicId}/content`,
        { responseType: "blob" },
      );
      const objectUrl = window.URL.createObjectURL(response.data);
      const openedWindow = window.open(objectUrl, "_blank", "noopener");

      if (!openedWindow) {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = file.originalFileName || "archivo";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }

      window.setTimeout(() => {
        window.URL.revokeObjectURL(objectUrl);
      }, 60000);

      await Promise.allSettled([
        api.post(
          `/api/commercial-enablement/assets/${assetPublicId}/usage-events`,
          {
            eventType: "opened_file",
            metadata: { filePublicId: file.publicId },
          },
        ),
        loadBootstrap(),
      ]);
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible abrir el archivo"),
      );
    }
  }

  async function handleOpenLink(assetPublicId, link) {
    setError("");
    const rawUrl = (link?.url || "").trim();

    if (!rawUrl) {
      setError("La URL no es valida.");
      return;
    }

    const normalizedUrl = /^[a-z][a-z\d+.-]*:/i.test(rawUrl)
      ? rawUrl
      : `https://${rawUrl}`;

    const anchor = document.createElement("a");
    anchor.href = normalizedUrl;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    try {
      await api.post(
        `/api/commercial-enablement/assets/${assetPublicId}/usage-events`,
        {
          eventType: "opened_link",
          metadata: { linkPublicId: link.publicId },
        },
      );
      await loadBootstrap();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No fue posible abrir la URL"));
    }
  }

  const summary = bootstrap.summary || EMPTY_BOOTSTRAP.summary;
  const analyticsTotals = analytics?.totals || EMPTY_ANALYTICS.totals;
  const governanceSummary = governance?.summary || EMPTY_GOVERNANCE.summary;
  const listItems = assetsResult.items || [];
  const publishMode = draft.status === "published";
  const catalogRequirementHint = publishMode
    ? "Selecciona al menos un fabricante aquí o una tecnologia en la seccion vecina."
    : "";
  const primaryMetric =
    activeTab === "manage"
      ? {
          label: "Activos editables",
          value: metricValue(assetsResult.total || listItems.length),
          helper: getManageStatusHelper(filters.status),
        }
      : {
          label: "Activos visibles",
          value: metricValue(summary.totalVisibleAssets),
          helper: "Material listo para consultar en la biblioteca",
        };
  const governanceMetrics = [
    {
      label: "Activos totales",
      value: metricValue(analyticsTotals.totalAssets),
      helper: "Todo el inventario del módulo",
    },
    {
      label: "Publicados",
      value: metricValue(analyticsTotals.publishedAssets),
      helper: "Material disponible para uso inmediato",
      tone: "positive",
    },
  ];
  const usageMetrics = [
    {
      label: "Compartibles con cliente",
      value: metricValue(summary.clientSafeAssets),
      helper: "Documentos y enlaces aptos para envio externo",
      tone: "positive",
    },
    {
      label: "Internos",
      value: metricValue(summary.internalAssets),
      helper: "Soporte comercial para preparacion interna",
    },
  ];
  const headerMetrics =
    activeTab === "governance"
      ? [...usageMetrics, ...governanceMetrics]
      : activeTab === "manage"
        ? [primaryMetric, ...usageMetrics]
        : usageMetrics;
  const displayedFiles = selectedAsset?.publicId
    ? selectedAsset.files || []
    : pendingFiles;
  const displayedLinks = selectedAsset?.publicId
    ? selectedAsset.links || []
    : pendingLinks;
  const isAssistedCreateMode =
    !selectedAsset?.publicId &&
    isCreatingNewAsset &&
    creationMode === "assisted";
  const currentResourceCount = displayedFiles.length + displayedLinks.length;
  const canAttachResource = !isAssistedCreateMode && currentResourceCount === 0;
  const hasExistingResource = currentResourceCount > 0;
  const canRemoveExistingResource =
    Boolean(selectedAsset?.publicId) && currentResourceCount > 1;
  const isEditingExistingLink = Boolean(editingLinkPublicId);
  const resourceHelperMessage = canAttachResource
    ? "Cada activo solo admite un recurso: un archivo o una URL."
    : "Este activo ya tiene un recurso configurado. Para cambiarlo, usa los controles del recurso actual.";
  const pendingResourceCount = pendingFiles.length + pendingLinks.length;
  const intakeWarnings = Array.isArray(intakeSession?.warnings)
    ? intakeSession.warnings
    : [];

  return (
    <div className="enablement-library-page">
      <header className="enablement-library-hero">
        <div>
          <span className="enablement-library-eyebrow">
            Biblioteca Comercial
          </span>
          <h1>Biblioteca comercial para preparar, comparar y compartir</h1>
          <p>
            Encuentra material por fabricante, tecnologia, necesidad o
            requerimiento. Separa claramente el uso del contenido, la carga de
            nuevos activos y el gobierno de calidad.
          </p>
        </div>
        <div
          className="enablement-library-tabs"
          role="tablist"
          aria-label="Secciones"
        >
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`enablement-library-tab ${activeTab === tab.id ? "is-active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <section className="enablement-library-metrics">
        {headerMetrics.map((metric) => (
          <SummaryCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            helper={metric.helper}
            tone={metric.tone}
          />
        ))}
      </section>

      {error ? <div className="form-error">{error}</div> : null}
      {success ? <div className="form-success">{success}</div> : null}

      {loading ? (
        <div className="enablement-library-loading">
          Cargando biblioteca comercial...
        </div>
      ) : null}

      {working ? (
        <div
          className="enablement-library-working-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={workingMessage || "Procesando operacion"}
        >
          <div className="enablement-library-working-dialog">
            <div
              className="enablement-library-working-spinner"
              aria-hidden="true"
            />
            <strong>{workingMessage || "Procesando operacion..."}</strong>
            <p>Espera a que termine el proceso actual antes de continuar.</p>
          </div>
        </div>
      ) : null}

      {!loading && activeTab === "use" ? (
        <div className="enablement-library-layout">
          <aside className="enablement-library-sidebar">
            <section className="enablement-library-panel">
              <div className="enablement-library-panel-header">
                <h2>Buscar material</h2>
                <span>{assetsResult.total} resultado(s)</span>
              </div>
              <div className="enablement-library-form-grid single-column">
                <form
                  className="enablement-library-search-row"
                  onSubmit={applySearchFilters}
                >
                  <input
                    value={searchQueryDraft}
                    onChange={(event) => setSearchQueryDraft(event.target.value)}
                    placeholder="Buscar por titulo, resumen o contexto"
                  />
                  <button
                    type="submit"
                    className="enablement-library-inline-button enablement-library-icon-button"
                    title="Buscar"
                    aria-label="Buscar"
                  >
                    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                      <circle cx="11" cy="11" r="6" />
                      <path d="m16 16 5 5" />
                    </svg>
                  </button>
                </form>
                <div className="enablement-library-inline-fields">
                  <select
                    value={filters.sort}
                    onChange={(event) =>
                      updateFilter("sort", event.target.value)
                    }
                  >
                    <option value="updated_desc">
                      Actualizados recientemente
                    </option>
                    <option value="title_asc">Titulo A-Z</option>
                    <option value="most_used">Más usados</option>
                  </select>
                  <select
                    value={filters.status}
                    onChange={(event) =>
                      updateFilter("status", event.target.value)
                    }
                  >
                    <option value="published">Solo vigentes</option>
                    <option value="all">Todo visible</option>
                    <option value="obsolete">Obsoletos</option>
                  </select>
                </div>
                <label className="enablement-library-check">
                  <input
                    type="checkbox"
                    checked={filters.onlyClientSafe}
                    onChange={(event) =>
                      updateFilter("onlyClientSafe", event.target.checked)
                    }
                  />
                  Solo compartibles con cliente
                </label>
              </div>
            </section>

            <section className="enablement-library-panel">
              <div className="enablement-library-panel-header">
                <h2>Filtros de negocio</h2>
                <span>Seleccion multiple</span>
              </div>
              <OptionPicker
                title="Tipo de activo"
                options={catalogs.asset_type}
                values={filters.assetTypeCodes}
                onToggle={(value) => toggleFilterValue("assetTypeCodes", value)}
              />
              <OptionPicker
                title="Fabricante"
                options={catalogs.manufacturer}
                values={filters.manufacturerCodes}
                onToggle={(value) =>
                  toggleFilterValue("manufacturerCodes", value)
                }
              />
              <OptionPicker
                title="Tecnologias"
                options={catalogs.technology}
                values={filters.technologyCodes}
                onToggle={(value) =>
                  toggleFilterValue("technologyCodes", value)
                }
              />
              <OptionPicker
                title="Soluciones"
                options={catalogs.solution}
                values={filters.solutionCodes}
                onToggle={(value) => toggleFilterValue("solutionCodes", value)}
              />
              <OptionPicker
                title="Industria"
                options={catalogs.industry}
                values={filters.industryCodes}
                onToggle={(value) => toggleFilterValue("industryCodes", value)}
              />
            </section>
          </aside>

          <section className="enablement-library-results">
            <section className="enablement-library-panel">
              <div className="enablement-library-panel-header">
                <h2>Resultados</h2>
                <span>
                  {loadingAssets
                    ? "Actualizando..."
                    : `${listItems.length} en esta vista`}
                </span>
              </div>
              {listItems.length ? (
                <div className="enablement-library-use-result-list" role="list">
                  {listItems.map((asset) => (
                    <UseResultListItem
                      key={asset.publicId}
                      asset={asset}
                      isSelected={asset.publicId === selectedAsset?.publicId}
                      onSelect={handleSelectAsset}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No hay activos para estos filtros"
                  helper="Ajusta la busqueda o limpia algunos criterios para ampliar resultados."
                />
              )}
            </section>
          </section>

          <aside className="enablement-library-detail">
            <section className="enablement-library-panel">
              <div className="enablement-library-panel-header">
                <h2>Detalle</h2>
                <span>{selectedAsset?.statusLabel || "Sin seleccion"}</span>
              </div>
              {selectedAsset ? (
                <div className="enablement-library-detail-stack">
                  <div className="enablement-library-detail-topline">
                    <span>{selectedAsset.assetTypeLabel}</span>
                    <span>{selectedAsset.visibilityLabel}</span>
                    <span>{selectedAsset.audienceLabel}</span>
                  </div>
                  <h3>{selectedAsset.title}</h3>
                  <p>{selectedAsset.summary}</p>
                  <div className="enablement-library-chip-cloud">
                    {selectedAsset.catalogs.slice(0, 12).map((entry) => (
                      <span
                        key={`${selectedAsset.publicId}-${entry.catalogType}-${entry.code}`}
                        className="enablement-library-chip is-static"
                      >
                        {entry.name}
                      </span>
                    ))}
                  </div>
                  <div className="enablement-library-resource-group">
                    <h4>Archivos</h4>
                    {selectedAsset.files.length ? (
                      selectedAsset.files.map((file) => (
                        <div
                          key={file.publicId}
                          className="enablement-library-resource-row"
                        >
                          <div>
                            <strong>{file.originalFileName}</strong>
                            <span>{metricValue(file.byteSize)} bytes</span>
                          </div>
                          <div className="enablement-library-inline-actions">
                            <button
                              type="button"
                              className="enablement-library-inline-button"
                              disabled={file.isAvailable === false}
                              onClick={() =>
                                handleOpenFile(selectedAsset.publicId, file)
                              }
                            >
                              {file.isAvailable === false
                                ? "No disponible"
                                : "Abrir"}
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="enablement-library-muted">
                        Sin archivos adjuntos.
                      </p>
                    )}
                  </div>
                  <div className="enablement-library-resource-group">
                    <h4>URLs</h4>
                    {selectedAsset.links.length ? (
                      selectedAsset.links.map((link) => (
                        <div
                          key={link.publicId}
                          className="enablement-library-resource-row"
                        >
                          <div>
                            <strong>{link.label}</strong>
                            <span>{link.linkType}</span>
                          </div>
                          <div className="enablement-library-inline-actions">
                            <button
                              type="button"
                              className="enablement-library-inline-button"
                              onClick={() =>
                                handleOpenLink(selectedAsset.publicId, link)
                              }
                            >
                              Abrir URL
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="enablement-library-muted">
                        Sin URLs registradas.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <EmptyState
                  title="Selecciona un activo"
                  helper="El panel derecho muestra archivos y URLs del material seleccionado."
                />
              )}
            </section>
          </aside>
        </div>
      ) : null}

      {!loading && activeTab === "manage" ? (
        <div className="enablement-library-layout manage-layout">
          <section className="enablement-library-results">
            <section className="enablement-library-panel">
              <div className="enablement-library-panel-header">
                <h2>Activos editables</h2>
                <span>{assetsResult.total} en esta vista</span>
                <div className="enablement-library-inline-actions">
                  <button
                    type="button"
                    className="enablement-library-action"
                    onClick={handleStartNewAsset}
                  >
                    Nuevo activo
                  </button>
                </div>
              </div>
              <div className="enablement-library-form-grid">
                <form
                  className="enablement-library-search-row"
                  onSubmit={applySearchFilters}
                >
                  <input
                    value={searchQueryDraft}
                    onChange={(event) => setSearchQueryDraft(event.target.value)}
                    placeholder="Buscar para editar"
                  />
                  <button
                    type="submit"
                    className="enablement-library-inline-button enablement-library-icon-button"
                    title="Buscar"
                    aria-label="Buscar"
                  >
                    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                      <circle cx="11" cy="11" r="6" />
                      <path d="m16 16 5 5" />
                    </svg>
                  </button>
                </form>
                <select
                  value={filters.status}
                  onChange={(event) =>
                    updateFilter("status", event.target.value)
                  }
                >
                  <option value="all">Todos</option>
                  <option value="draft">Borradores</option>
                  <option value="published">Vigentes</option>
                  <option value="obsolete">Obsoletos</option>
                  <option value="archived">Archivados</option>
                </select>
              </div>
              <div className="enablement-library-use-result-list enablement-library-use-result-list-compact">
                {listItems.map((asset) => (
                  <EditableAssetListItem
                    key={asset.publicId}
                    asset={asset}
                    isSelected={asset.publicId === selectedAsset?.publicId}
                    onSelect={handleSelectAsset}
                  />
                ))}
              </div>
            </section>
          </section>

          <section className="enablement-library-detail wide">
            <section className="enablement-library-panel">
              <div className="enablement-library-panel-header">
                <h2>{selectedAsset ? "Editar activo" : "Crear activo"}</h2>
                <span>{selectedAsset?.publicId || "Nuevo registro"}</span>
              </div>
              {assetSaveFeedback ? (
                <div
                  className={
                    assetSaveFeedback.tone === "error"
                      ? "form-error"
                      : "form-success"
                  }
                >
                  {assetSaveFeedback.message}
                </div>
              ) : null}
              {error ? <div className="form-error">{error}</div> : null}
              {success ? <div className="form-success">{success}</div> : null}
              <form
                ref={assetEditorFormRef}
                className="enablement-library-editor"
                onSubmit={handleSaveAsset}
              >
                <div className="enablement-library-editor-shell">
                  {!selectedAsset && isCreatingNewAsset ? (
                    <section className="enablement-library-editor-section is-primary">
                      <div className="enablement-library-editor-section-header">
                        <div>
                          <span className="enablement-library-editor-kicker">
                            Ingreso
                          </span>
                          <h3>Modo de creacion</h3>
                          <p>
                            El flujo manual conserva el editor actual. El flujo
                            asistido crea un borrador desde un documento y exige
                            revision humana antes de guardar.
                          </p>
                        </div>
                      </div>
                      <div className="enablement-library-mode-switch">
                        <button
                          type="button"
                          className={`enablement-library-chip ${creationMode === "manual" ? "is-active" : ""}`}
                          onClick={() => handleChangeCreationMode("manual")}
                        >
                          Carga manual
                        </button>
                        <button
                          type="button"
                          className={`enablement-library-chip ${creationMode === "assisted" ? "is-active" : ""}`}
                          onClick={() => handleChangeCreationMode("assisted")}
                        >
                          Desde documento
                        </button>
                      </div>
                      {isAssistedCreateMode ? (
                        <div className="enablement-library-intake-stack">
                          {!intakeSession?.publicId ? (
                            <>
                              <label>
                                Contexto para la sugerencia
                                <textarea
                                  rows={3}
                                  value={intakeHint}
                                  onChange={(event) =>
                                    setIntakeHint(event.target.value)
                                  }
                                  placeholder="Ejemplo: brochure para sector salud, orientado a discovery con CIO"
                                />
                              </label>
                              <label className="enablement-library-upload-field">
                                <span>Cargar documento fuente</span>
                                <input
                                  type="file"
                                  accept=".pdf,.docx,.ppt,.pptx,.txt,.csv,.xlsx,.xls,.eml,.png,.jpg,.jpeg,.mp3,.wav,.m4a"
                                  onChange={handleCreateIntakeSession}
                                />
                              </label>
                              <p className="enablement-library-muted">
                                Se extrae el texto, se sugieren campos iniciales
                                y luego debes confirmar manualmente antes de
                                crear el activo.
                              </p>
                            </>
                          ) : (
                            <>
                              <div className="enablement-library-intake-summary">
                                <div>
                                  <strong>
                                    {intakeSession.sourceFileName}
                                  </strong>
                                  {getIntakeAnalysisModelLabel(
                                    intakeSession.analysisModel,
                                  ) ? (
                                    <span>
                                      {getIntakeAnalysisModelLabel(
                                        intakeSession.analysisModel,
                                      )}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="enablement-library-card-topline">
                                  <span>
                                    {getIntakeStatusLabel(intakeSession.status)}
                                  </span>
                                  <span>
                                    {getIntakeStatusLabel(
                                      intakeSession.analysisStatus,
                                    )}
                                  </span>
                                  <span>
                                    {intakeSession.languageDetected ||
                                      draft.languageCode}
                                  </span>
                                </div>
                              </div>
                              {intakeSession.extractionPreview ? (
                                <div className="enablement-library-note-box">
                                  <strong>
                                    Vista previa del texto extraido
                                  </strong>
                                  <p>{intakeSession.extractionPreview}</p>
                                </div>
                              ) : null}
                              {intakeWarnings.length ? (
                                <div className="enablement-library-warning-list">
                                  {intakeWarnings.map((warning, index) => (
                                    <div
                                      key={`intake-warning-${index}`}
                                      className="enablement-library-picker-helper is-error"
                                    >
                                      {warning.message || warning.code}
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              <div className="enablement-library-inline-actions">
                                <button
                                  type="button"
                                  className="enablement-library-inline-button"
                                  onClick={() =>
                                    handleRefreshIntakeAnalysis(
                                      intakeSession.analysisStatus ===
                                        "completed",
                                    )
                                  }
                                  disabled={working}
                                  aria-label={
                                    intakeSession.analysisStatus === "completed"
                                      ? "Reanalizar documento"
                                      : "Analizar documento"
                                  }
                                >
                                  <AnalyzeDocumentIcon />
                                  <span>
                                    {intakeSession.analysisStatus ===
                                    "completed"
                                      ? "Reanalizar documento"
                                      : "Analizar documento"}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  className="enablement-library-inline-button"
                                  onClick={handleLoadExtractedContent}
                                  disabled={working}
                                >
                                  Ver extracción completa
                                </button>
                                <button
                                  type="button"
                                  className="enablement-library-inline-button"
                                  onClick={handleCancelIntakeSession}
                                  disabled={working}
                                >
                                  Cancelar borrador asistido
                                </button>
                              </div>
                              {intakeExtractedText ? (
                                <label>
                                  Texto extraido
                                  <textarea
                                    rows={8}
                                    value={intakeExtractedText}
                                    readOnly
                                  />
                                </label>
                              ) : null}
                            </>
                          )}
                        </div>
                      ) : null}
                    </section>
                  ) : null}

                  <section className="enablement-library-editor-section is-primary">
                    <div className="enablement-library-editor-section-header">
                      <div>
                        <span className="enablement-library-editor-kicker">
                          Base
                        </span>
                        <h3>Informacion principal</h3>
                        <p>
                          Define el material, su estado y a quien va dirigido.
                        </p>
                      </div>
                      <div className="enablement-library-card-topline">
                        <span>{draft.status || "published"}</span>
                        <span>{draft.visibilityLevel || "client_safe"}</span>
                        <span>{draft.audienceCode || "mixed"}</span>
                      </div>
                    </div>
                    <div className="enablement-library-form-grid enablement-library-editor-meta-grid">
                      <label className="enablement-library-field-span-2">
                        Titulo
                        <input
                          ref={titleInputRef}
                          required
                          minLength={3}
                          value={draft.title}
                          onChange={(event) =>
                            updateDraftField("title", event.target.value)
                          }
                        />
                      </label>
                      <label>
                        Tipo de activo
                        <select
                          value={draft.assetTypeCode}
                          onChange={(event) =>
                            updateDraftField(
                              "assetTypeCode",
                              event.target.value,
                            )
                          }
                        >
                          {(catalogs.asset_type || []).map((option) => (
                            <option key={option.code} value={option.code}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Estado
                        <select
                          value={draft.status}
                          onChange={(event) =>
                            updateDraftField("status", event.target.value)
                          }
                        >
                          <option value="draft">Borrador</option>
                          <option value="published">Vigente</option>
                          <option value="obsolete">Obsoleto</option>
                          <option value="archived">Archivado</option>
                        </select>
                      </label>
                      <label>
                        Visibilidad
                        <select
                          value={draft.visibilityLevel}
                          onChange={(event) =>
                            updateDraftField(
                              "visibilityLevel",
                              event.target.value,
                            )
                          }
                        >
                          {(catalogs.visibility || []).map((option) => (
                            <option key={option.code} value={option.code}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Audiencia
                        <select
                          value={draft.audienceCode}
                          onChange={(event) =>
                            updateDraftField("audienceCode", event.target.value)
                          }
                        >
                          {(catalogs.audience || []).map((option) => (
                            <option key={option.code} value={option.code}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Idioma
                        <select
                          value={draft.languageCode}
                          onChange={(event) =>
                            updateDraftField("languageCode", event.target.value)
                          }
                        >
                          {(
                            catalogs.language || [
                              { code: "es", name: "Espanol" },
                            ]
                          ).map((option) => (
                            <option key={option.code} value={option.code}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </section>

                  <section className="enablement-library-editor-section">
                    <div className="enablement-library-editor-section-header">
                      <div>
                        <span className="enablement-library-editor-kicker">
                          Mensaje
                        </span>
                        <h3>Contenido del activo</h3>
                        <p>
                          Resume el contenido del documento de forma clara y
                          util para su consulta y reutilizacion.
                        </p>
                      </div>
                    </div>
                    <div className="enablement-library-form-grid enablement-library-editor-copy-grid">
                      <label className="enablement-library-field-span-2">
                        <span className="enablement-library-field-label-row">
                          <span>Resumen</span>
                          {selectedAsset?.publicId ? (
                            <button
                              type="button"
                              className="enablement-library-inline-button enablement-library-icon-button"
                              onClick={handleReanalyzeAssetSummary}
                              disabled={
                                working ||
                                reanalyzingAssetSummary ||
                                !selectedAsset?.sourceContent
                                  ?.canReanalyzeSummary
                              }
                              aria-label={
                                reanalyzingAssetSummary
                                  ? "Reanalizando resumen"
                                  : "Reanalizar resumen"
                              }
                              title={
                                selectedAsset?.sourceContent
                                  ?.canReanalyzeSummary
                                  ? reanalyzingAssetSummary
                                    ? "Reanalizando resumen..."
                                    : "Reanalizar resumen"
                                  : "Este activo no tiene contenido fuente disponible para reanalizar"
                              }
                            >
                              <AnalyzeDocumentIcon />
                            </button>
                          ) : null}
                        </span>
                        <textarea
                          ref={summaryInputRef}
                          rows={4}
                          value={draft.summary}
                          onChange={(event) =>
                            updateDraftField("summary", event.target.value)
                          }
                        />
                      </label>
                    </div>
                  </section>

                  <section className="enablement-library-editor-section">
                    <div className="enablement-library-editor-section-header">
                      <div>
                        <span className="enablement-library-editor-kicker">
                          Contexto
                        </span>
                        <h3>Clasificación</h3>
                        <p>
                          Relaciona el material con fabricantes, tecnologias,
                          industrias y momentos de uso.
                        </p>
                      </div>
                    </div>
                    <div className="enablement-library-editor-context-grid">
                      <OptionPicker
                        title="Fabricante"
                        sectionRef={manufacturerSectionRef}
                        options={catalogs.manufacturer}
                        values={draft.manufacturerCodes}
                        onToggle={(value) =>
                          toggleDraftValue("manufacturerCodes", value)
                        }
                        requirementHint={catalogRequirementHint}
                        invalidMessage={
                          publishSectionErrors.catalogContext
                            ? PUBLISH_SECTION_MESSAGES.catalogContext
                            : ""
                        }
                      />
                      <OptionPicker
                        title="Tecnologias"
                        options={catalogs.technology}
                        values={draft.technologyCodes}
                        onToggle={(value) =>
                          toggleDraftValue("technologyCodes", value)
                        }
                        requirementHint={catalogRequirementHint}
                        invalidMessage={
                          publishSectionErrors.catalogContext
                            ? PUBLISH_SECTION_MESSAGES.catalogContext
                            : ""
                        }
                      />
                      <OptionPicker
                        title="Soluciones"
                        options={catalogs.solution}
                        values={draft.solutionCodes}
                        onToggle={(value) =>
                          toggleDraftValue("solutionCodes", value)
                        }
                      />
                      <OptionPicker
                        title="Industria"
                        options={catalogs.industry}
                        values={draft.industryCodes}
                        onToggle={(value) =>
                          toggleDraftValue("industryCodes", value)
                        }
                      />
                    </div>
                    <div className="enablement-library-form-grid">
                      <label>
                        Etapas relacionadas
                        <input
                          value={joinCommaValues(draft.stageCodes)}
                          onChange={(event) =>
                            updateDraftField(
                              "stageCodes",
                              splitCommaValues(event.target.value),
                            )
                          }
                          placeholder="contacto_inicial, desarrollo, cotizacion"
                        />
                      </label>
                      <label>
                        Temas
                        <input
                          value={joinCommaValues(draft.themeTags)}
                          onChange={(event) =>
                            updateDraftField(
                              "themeTags",
                              splitCommaValues(event.target.value),
                            )
                          }
                          placeholder="presentacion, diferenciacion, discovery"
                        />
                      </label>
                      <label>
                        Personas / roles
                        <input
                          value={joinCommaValues(draft.personaTags)}
                          onChange={(event) =>
                            updateDraftField(
                              "personaTags",
                              splitCommaValues(event.target.value),
                            )
                          }
                          placeholder="cfo, ti, operaciones"
                        />
                      </label>
                      <label>
                        Roles recomendados
                        <input
                          value={joinCommaValues(draft.recommendedRoleTags)}
                          onChange={(event) =>
                            updateDraftField(
                              "recommendedRoleTags",
                              splitCommaValues(event.target.value),
                            )
                          }
                          placeholder="seller, manager, presales"
                        />
                      </label>
                    </div>
                  </section>

                  <section className="enablement-library-editor-section is-accent">
                    <div className="enablement-library-editor-section-header">
                      <div>
                        <span className="enablement-library-editor-kicker">
                          Entrega
                        </span>
                        <h3>Distribucion y recursos</h3>
                        <p>
                          Define si el material es descargable y agrega archivos
                          o URLs desde este mismo bloque.
                        </p>
                      </div>
                      <div className="enablement-library-card-topline">
                        <span>
                          {selectedAsset?.title ||
                            "Se guardaran junto con el activo"}
                        </span>
                      </div>
                    </div>
                    <div className="enablement-library-check-grid">
                      <label className="enablement-library-check enablement-library-check-review">
                        <input
                          type="checkbox"
                          checked={draft.isDownloadable}
                          onChange={(event) =>
                            updateDraftField(
                              "isDownloadable",
                              event.target.checked,
                            )
                          }
                          disabled={isAssistedCreateMode}
                        />
                        <span>Permitir descarga</span>
                      </label>
                    </div>
                    {isAssistedCreateMode ? (
                      <div className="enablement-library-note-box">
                        <strong>
                          Documento fuente adjunto automaticamente
                        </strong>
                        <p>
                          En el flujo asistido el archivo cargado se adjunta al
                          crear el activo. Si necesitas reemplazarlo por otro
                          archivo o por una URL, primero elimina el recurso
                          actual despues de guardar el activo.
                        </p>
                      </div>
                    ) : null}
                    {!selectedAsset && !isAssistedCreateMode ? (
                      <p className="enablement-library-muted">
                        Agrega un archivo o una URL al formulario. Cuando
                        guardes, el activo se creara con ese recurso en la misma
                        accion.
                      </p>
                    ) : null}
                    {hasExistingResource ? (
                      <p className="enablement-library-muted">
                        Este activo ya tiene un recurso asignado. Los controles
                        para agregar archivo o URL se ocultan mientras exista
                        ese recurso.
                      </p>
                    ) : null}
                    {!isAssistedCreateMode ? (
                      <p className="enablement-library-muted">
                        {resourceHelperMessage}
                      </p>
                    ) : null}
                    <div className="enablement-library-stack">
                      {!hasExistingResource && !isAssistedCreateMode ? (
                        <label className="enablement-library-upload-field">
                          <span>Subir archivo</span>
                          <input
                            type="file"
                            onChange={handleUploadFiles}
                            disabled={!canAttachResource}
                          />
                        </label>
                      ) : null}
                      {!isAssistedCreateMode ? (
                        <>
                          <div className="enablement-library-mini-list">
                            {displayedFiles.length ? (
                              displayedFiles.map((file) => (
                                <div
                                  key={file.publicId || file.id}
                                  className="enablement-library-resource-row"
                                >
                                  <div>
                                    <strong>
                                      {file.originalFileName || file.file?.name}
                                    </strong>
                                    <span>
                                      {file.mimeType ||
                                        file.file?.type ||
                                        "Pendiente"}
                                    </span>
                                  </div>
                                  <div className="enablement-library-inline-actions">
                                    {selectedAsset ? (
                                      <button
                                        type="button"
                                        className="enablement-library-inline-button"
                                        disabled={file.isAvailable === false}
                                        onClick={() =>
                                          selectedAsset &&
                                          handleOpenFile(
                                            selectedAsset.publicId,
                                            file,
                                          )
                                        }
                                      >
                                        {file.isAvailable === false
                                          ? "No disponible"
                                          : "Abrir"}
                                      </button>
                                    ) : null}
                                    {selectedAsset ? (
                                      <label className="enablement-library-inline-button">
                                        Reemplazar archivo
                                        <input
                                          type="file"
                                          hidden
                                          onChange={(event) =>
                                            handleReplaceFile(
                                              file.publicId,
                                              event,
                                            )
                                          }
                                        />
                                      </label>
                                    ) : null}
                                    {!selectedAsset ? (
                                      <button
                                        type="button"
                                        className="enablement-library-inline-button"
                                        onClick={() =>
                                          handleRemovePendingFile(file.id)
                                        }
                                      >
                                        Quitar
                                      </button>
                                    ) : null}
                                    {canRemoveExistingResource ? (
                                      <button
                                        type="button"
                                        className="enablement-library-inline-button"
                                        onClick={() =>
                                          handleDeleteFile(file.publicId)
                                        }
                                      >
                                        Quitar
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <p className="enablement-library-muted">
                                Sin archivo cargado.
                              </p>
                            )}
                          </div>
                          {!hasExistingResource || isEditingExistingLink ? (
                            <div className="enablement-library-link-form">
                              <input
                                value={linkDraft.url}
                                onChange={(event) =>
                                  setLinkDraft((current) => ({
                                    ...current,
                                    url: event.target.value,
                                  }))
                                }
                                placeholder="https://..."
                              />
                              <input
                                value={linkDraft.label}
                                onChange={(event) =>
                                  setLinkDraft((current) => ({
                                    ...current,
                                    label: event.target.value,
                                  }))
                                }
                                placeholder="Etiqueta visible"
                              />
                              <input
                                value={linkDraft.description}
                                onChange={(event) =>
                                  setLinkDraft((current) => ({
                                    ...current,
                                    description: event.target.value,
                                  }))
                                }
                                placeholder="Descripción corta"
                              />
                              <button
                                type="button"
                                className="enablement-library-action subtle"
                                onClick={
                                  isEditingExistingLink
                                    ? () =>
                                        handleSaveLinkEdit(editingLinkPublicId)
                                    : handleCreateLink
                                }
                                disabled={
                                  isEditingExistingLink
                                    ? false
                                    : !canAttachResource
                                }
                              >
                                {isEditingExistingLink
                                  ? "Guardar cambios de URL"
                                  : selectedAsset
                                    ? "Guardar URL"
                                    : "Preparar URL"}
                              </button>
                              {isEditingExistingLink ? (
                                <button
                                  type="button"
                                  className="enablement-library-action subtle"
                                  onClick={handleCancelEditLink}
                                >
                                  Cancelar
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                          <div className="enablement-library-mini-list">
                            {displayedLinks.length ? (
                              displayedLinks.map((link) => (
                                <div
                                  key={link.publicId || link.id}
                                  className="enablement-library-resource-row"
                                >
                                  <div>
                                    <strong>{link.label}</strong>
                                    <span>{link.url}</span>
                                  </div>
                                  <div className="enablement-library-inline-actions">
                                    {selectedAsset ? (
                                      <button
                                        type="button"
                                        className="enablement-library-inline-button"
                                        onClick={() =>
                                          selectedAsset &&
                                          handleOpenLink(
                                            selectedAsset.publicId,
                                            link,
                                          )
                                        }
                                      >
                                        Abrir URL
                                      </button>
                                    ) : null}
                                    {selectedAsset ? (
                                      <button
                                        type="button"
                                        className="enablement-library-inline-button"
                                        onClick={() =>
                                          handleStartEditLink(link)
                                        }
                                      >
                                        Editar URL
                                      </button>
                                    ) : null}
                                    {!selectedAsset ? (
                                      <button
                                        type="button"
                                        className="enablement-library-inline-button"
                                        onClick={() =>
                                          handleRemovePendingLink(link.id)
                                        }
                                      >
                                        Quitar
                                      </button>
                                    ) : null}
                                    {canRemoveExistingResource ? (
                                      <button
                                        type="button"
                                        className="enablement-library-inline-button"
                                        onClick={() =>
                                          handleDeleteLink(link.publicId)
                                        }
                                      >
                                        Quitar
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <p className="enablement-library-muted">
                                Sin URL registrada.
                              </p>
                            )}
                          </div>
                        </>
                      ) : null}
                    </div>
                  </section>
                </div>
                <div className="enablement-library-editor-actions">
                  {isAssistedCreateMode && intakeSession?.publicId ? (
                    <>
                      <label className="enablement-library-check enablement-library-check-review">
                        <input
                          type="checkbox"
                          checked={reviewConfirmed}
                          onChange={(event) =>
                            setReviewConfirmed(event.target.checked)
                          }
                        />
                        <span>
                          Confirmo que revise y corregi este borrador antes de
                          crear el activo.
                        </span>
                      </label>
                      <div className="enablement-library-inline-actions">
                        <button
                          type="button"
                          className="enablement-library-inline-button"
                          onClick={handleSaveIntakeReview}
                          disabled={working}
                        >
                          Guardar sin crear
                        </button>
                      </div>
                    </>
                  ) : null}
                  <button
                    type="submit"
                    className="enablement-library-action"
                    disabled={working}
                  >
                    {working
                      ? "Guardando..."
                      : selectedAsset
                        ? "Guardar cambios"
                        : isAssistedCreateMode
                          ? "Crear activo desde documento"
                          : pendingResourceCount > 0
                            ? `Crear activo con ${pendingResourceCount} recurso(s)`
                            : "Crear activo"}
                  </button>
                </div>
              </form>
            </section>
          </section>
        </div>
      ) : null}

      {!loading && activeTab === "governance" ? (
        <div className="enablement-library-governance">
          <div className="enablement-library-governance-grid">
            <section className="enablement-library-panel">
              <div className="enablement-library-panel-header">
                <h2>Activos administrables</h2>
                <span>Acciones directas desde Gobierno</span>
              </div>
              <div className="enablement-library-governance-list" role="list">
                {(Array.isArray(governance.manageableItems)
                  ? governance.manageableItems.filter(
                      (item) => item && item.publicId,
                    )
                  : []
                ).length ? (
                  (Array.isArray(governance.manageableItems)
                    ? governance.manageableItems.filter(
                        (item) => item && item.publicId,
                      )
                    : []
                  ).map((item) => (
                    <GovernanceAssetListRow
                      key={item.publicId}
                      item={item}
                      meta={`${item.assetTypeLabel} · ${item.usageCount} uso(s) · ${item.status} · Actualizado ${item.updatedAt}`}
                      isDuplicate={duplicateCandidateIds.has(item.publicId)}
                      menuOpen={openGovernanceMenuId === item.publicId}
                      onToggleMenu={toggleGovernanceMenu}
                      onCloseMenu={() => setOpenGovernanceMenuId(null)}
                      onOpen={(publicId) => {
                        handleSelectAsset(publicId);
                        setActiveTab(canUpload ? "manage" : "use");
                      }}
                      onDeactivate={(asset) =>
                        handleGovernanceAssetStatus(
                          asset,
                          "obsolete",
                          "Activo marcado como obsoleto",
                        )
                      }
                      onDelete={handleGovernanceAssetDelete}
                      working={working}
                    />
                  ))
                ) : (
                  <div className="enablement-library-mini-card static">
                    <strong>No hay activos administrables</strong>
                    <span>
                      Cuando existan activos con problemas de calidad,
                      duplicados o acciones pendientes, aparecerán aquí.
                    </span>
                  </div>
                )}
              </div>
            </section>

            {canAdmin ? (
              <section className="enablement-library-panel">
                <div className="enablement-library-panel-header">
                  <h2>Catalogos administrables</h2>
                  <div className="enablement-library-stack">
                    <span>
                      Crea opciones para Fabricante, Tecnologia, Solucion e
                      Industria
                    </span>
                    <div className="enablement-library-inline-actions">
                      <button
                        type="button"
                        className={`enablement-library-inline-button ${catalogAdminVisibility === "active" ? "is-active" : ""}`}
                        onClick={() => setCatalogAdminVisibility("active")}
                      >
                        Activos
                      </button>
                      <button
                        type="button"
                        className={`enablement-library-inline-button ${catalogAdminVisibility === "all" ? "is-active" : ""}`}
                        onClick={() => setCatalogAdminVisibility("all")}
                      >
                        Todos
                      </button>
                    </div>
                  </div>
                </div>
                <div className="enablement-library-catalog-grid">
                  {CATALOG_ADMIN_TYPES.map((catalogConfig) => {
                    const allItems = Array.isArray(
                      adminCatalogs[catalogConfig.type],
                    )
                      ? adminCatalogs[catalogConfig.type].filter(
                          (entry) => entry && entry.code,
                        )
                      : [];
                    const activeCount = allItems.filter(
                      (entry) => entry.isActive !== false,
                    ).length;
                    const items = allItems.filter((entry) =>
                      catalogAdminVisibility === "all"
                        ? true
                        : entry.isActive !== false,
                    );
                    const draftValue =
                      catalogAdminDrafts[catalogConfig.adminKey] || {};
                    return (
                      <section
                        key={catalogConfig.adminKey}
                        className="enablement-library-catalog-card"
                      >
                        <div className="enablement-library-catalog-card-header">
                          <div>
                            <h3>{catalogConfig.label}</h3>
                            <p>
                              {catalogAdminVisibility === "all"
                                ? `${activeCount} activa(s) de ${allItems.length} total(es)`
                                : `${activeCount} opcion(es) activas`}
                            </p>
                          </div>
                        </div>
                        <form
                          className="enablement-library-stack"
                          onSubmit={(event) =>
                            handleCreateCatalogEntry(
                              event,
                              catalogConfig.adminKey,
                              catalogConfig.type,
                            )
                          }
                        >
                          <input
                            value={draftValue.name || ""}
                            onChange={(event) =>
                              updateCatalogAdminDraft(
                                catalogConfig.adminKey,
                                "name",
                                event.target.value,
                              )
                            }
                            placeholder={`Nuevo ${catalogConfig.singularLabel || catalogConfig.label}`}
                          />
                          <textarea
                            rows={2}
                            value={draftValue.description || ""}
                            onChange={(event) =>
                              updateCatalogAdminDraft(
                                catalogConfig.adminKey,
                                "description",
                                event.target.value,
                              )
                            }
                            placeholder="Descripción breve"
                          />
                          <button
                            type="submit"
                            className="enablement-library-action subtle"
                            disabled={working}
                          >
                            Agregar opcion
                          </button>
                        </form>
                        <div className="enablement-library-mini-list">
                          {items.length ? (
                            items.map((entry) => {
                              const menuKey = buildCatalogAdminMenuKey(
                                catalogConfig.adminKey,
                                entry,
                              );
                              const editorKey = buildCatalogAdminEditorKey(
                                catalogConfig.adminKey,
                                entry,
                              );
                              const editorValue =
                                catalogAdminEditors[editorKey] ||
                                buildCatalogAdminEditor(entry);
                              const isEditing = Boolean(
                                catalogAdminEditors[editorKey],
                              );

                              return isEditing ? (
                                <form
                                  key={
                                    entry.publicId ||
                                    `${catalogConfig.type}-${entry.code}`
                                  }
                                  className="enablement-library-mini-card static enablement-library-catalog-entry-editor"
                                  onSubmit={(event) => {
                                    event.preventDefault();
                                    handleUpdateCatalogEntry(
                                      catalogConfig.adminKey,
                                      entry,
                                    );
                                  }}
                                >
                                  <input
                                    value={editorValue.name}
                                    onChange={(event) =>
                                      updateCatalogAdminEditor(
                                        editorKey,
                                        "name",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Nombre"
                                  />
                                  <textarea
                                    rows={2}
                                    value={editorValue.description}
                                    onChange={(event) =>
                                      updateCatalogAdminEditor(
                                        editorKey,
                                        "description",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Descripción breve"
                                  />
                                  <div className="enablement-library-inline-actions">
                                    <button
                                      type="submit"
                                      className="enablement-library-action"
                                      disabled={working}
                                    >
                                      Guardar
                                    </button>
                                    <button
                                      type="button"
                                      className="enablement-library-action subtle"
                                      onClick={() =>
                                        cancelCatalogAdminEdit(editorKey)
                                      }
                                      disabled={working}
                                    >
                                      Cancelar
                                    </button>
                                    <button
                                      type="button"
                                      className="enablement-library-action subtle is-danger"
                                      onClick={() =>
                                        handleUpdateCatalogEntry(
                                          catalogConfig.adminKey,
                                          entry,
                                          {
                                            isActive: entry.isActive === false,
                                          },
                                        )
                                      }
                                      disabled={working}
                                    >
                                      {entry.isActive === false
                                        ? "Reactivar"
                                        : "Desactivar"}
                                    </button>
                                    <button
                                      type="button"
                                      className="enablement-library-action subtle is-danger"
                                      onClick={() =>
                                        handleDeleteCatalogEntry(
                                          catalogConfig.adminKey,
                                          entry,
                                        )
                                      }
                                      disabled={working}
                                    >
                                      Eliminar
                                    </button>
                                  </div>
                                </form>
                              ) : (
                                <div
                                  key={
                                    entry.publicId ||
                                    `${catalogConfig.type}-${entry.code}`
                                  }
                                  className="enablement-library-mini-card static enablement-library-catalog-entry"
                                >
                                  <div className="enablement-library-catalog-entry-main">
                                    <strong>{entry.name}</strong>
                                    {entry.isActive === false ? (
                                      <span className="enablement-library-duplicate-flag">
                                        Inactivo
                                      </span>
                                    ) : null}
                                    {entry.description ? (
                                      <p>{entry.description}</p>
                                    ) : null}
                                  </div>
                                  <div className="user-kebab-wrap enablement-library-catalog-entry-menu">
                                    <button
                                      type="button"
                                      className="kebab-btn"
                                      onClick={() =>
                                        toggleCatalogAdminMenu(menuKey)
                                      }
                                      aria-label={`Abrir acciones para ${entry.name}`}
                                      aria-expanded={
                                        openCatalogAdminMenuId === menuKey
                                      }
                                      disabled={working}
                                    >
                                      ⋮
                                    </button>
                                    {openCatalogAdminMenuId === menuKey ? (
                                      <div className="user-kebab-menu">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenCatalogAdminMenuId(null);
                                            startCatalogAdminEdit(
                                              catalogConfig.adminKey,
                                              entry,
                                            );
                                          }}
                                          disabled={working}
                                        >
                                          Editar
                                        </button>
                                        <button
                                          type="button"
                                          className="user-kebab-menu-danger"
                                          onClick={() => {
                                            setOpenCatalogAdminMenuId(null);
                                            handleUpdateCatalogEntry(
                                              catalogConfig.adminKey,
                                              entry,
                                              {
                                                isActive:
                                                  entry.isActive === false,
                                              },
                                            );
                                          }}
                                          disabled={working}
                                        >
                                          {entry.isActive === false
                                            ? "Reactivar"
                                            : "Desactivar"}
                                        </button>
                                        <button
                                          type="button"
                                          className="user-kebab-menu-danger"
                                          onClick={() => {
                                            setOpenCatalogAdminMenuId(null);
                                            handleDeleteCatalogEntry(
                                              catalogConfig.adminKey,
                                              entry,
                                            );
                                          }}
                                          disabled={working}
                                        >
                                          Eliminar
                                        </button>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <div className="enablement-library-mini-card static">
                              <strong>Sin opciones</strong>
                              <span>
                                Crea la primera opcion desde este panel.
                              </span>
                            </div>
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      ) : null}

      {!canUse ? (
        <EmptyState
          title="No tienes permisos de uso"
          helper="Solicita acceso a biblioteca comercial para consultar o administrar el contenido."
        />
      ) : null}
    </div>
  );
}
