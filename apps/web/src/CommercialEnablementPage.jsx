import {
  useCallback,
  useDeferredValue,
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
  { type: "manufacturer", label: "Fabricantes" },
  { type: "solution", label: "Soluciones" },
  { type: "industry", label: "Industrias" },
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
  catalogContext: "Debes indicar al menos un fabricante o una solucion",
};

const ASSET_FIELD_MESSAGES = {
  title: "Titulo requerido",
  summary: "Resumen requerido",
};

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
    status: "draft",
    sourceType: "mixed",
    visibilityLevel: "internal_sales",
    audienceCode: "seller",
    languageCode: "es",
    manufacturerCodes: [],
    solutionCodes: [],
    needCodes: [],
    requirementCodes: [],
    competitorCodes: [],
    industryCodes: [],
    stageCodes: [],
    themeTags: [],
    personaTags: [],
    recommendedRoleTags: [],
    isInternal: true,
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
    status: asset.status || "draft",
    sourceType: asset.sourceType || "mixed",
    visibilityLevel: asset.visibilityLevel || "internal_sales",
    audienceCode: asset.audienceCode || "seller",
    languageCode: asset.languageCode || "es",
    manufacturerCodes: getCatalogCodes(asset, "manufacturer"),
    solutionCodes: getCatalogCodes(asset, "solution"),
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

function buildPendingFileId(file) {
  return [file?.name || "archivo", file?.size || 0, file?.lastModified || 0].join(
    "::",
  );
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

function emptyCatalogAdminDrafts() {
  return CATALOG_ADMIN_TYPES.reduce((accumulator, entry) => {
    accumulator[entry.type] = {
      name: "",
      description: "",
    };
    return accumulator;
  }, {});
}

function buildCatalogAdminEditor(entry) {
  return {
    name: entry?.name || "",
    description: entry?.description || "",
  };
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

function AssetListCard({ asset, isSelected, onSelect }) {
  const manufacturers = asset.catalogs
    ?.filter((entry) => entry.catalogType === "manufacturer")
    .map((entry) => entry.name)
    .slice(0, 2);
  return (
    <button
      type="button"
      className={`enablement-library-card ${isSelected ? "is-selected" : ""}`}
      onClick={() => onSelect(asset.publicId)}
    >
      <div className="enablement-library-card-topline">
        <span>{asset.assetTypeLabel}</span>
        <strong>{asset.statusLabel}</strong>
      </div>
      <h3>{asset.title}</h3>
      <p>{asset.summary || "Sin resumen"}</p>
      <div className="enablement-library-card-meta">
        <span>{asset.visibilityLabel}</span>
        <span>{asset.audienceLabel}</span>
        <span>{asset.files.length} archivo(s)</span>
        <span>{asset.links.length} URL(s)</span>
      </div>
      {manufacturers?.length ? (
        <div className="enablement-library-card-tags">
          {manufacturers.map((name) => (
            <span key={`${asset.publicId}-${name}`}>{name}</span>
          ))}
        </div>
      ) : null}
      <div className="enablement-library-card-actions">
        <small>{asset.usageCount} uso(s)</small>
      </div>
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
  const [assetDetail, setAssetDetail] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [working, setWorking] = useState(false);
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
  const [pendingFiles, setPendingFiles] = useState([]);
  const [pendingLinks, setPendingLinks] = useState([]);
  const [analytics, setAnalytics] = useState(EMPTY_ANALYTICS);
  const [governance, setGovernance] = useState(EMPTY_GOVERNANCE);
  const [publishSectionErrors, setPublishSectionErrors] = useState(
    EMPTY_PUBLISH_SECTION_ERRORS,
  );
  const [filters, setFilters] = useState({
    q: "",
    manufacturerCodes: [],
    solutionCodes: [],
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

  const deferredQuery = useDeferredValue(filters.q);
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

  const activeFilters = useMemo(
    () => ({ ...filters, q: deferredQuery }),
    [filters, deferredQuery],
  );

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

  const loadBootstrap = useCallback(async () => {
    const response = await api.get("/api/commercial-enablement/bootstrap");
    setBootstrap(response.data || EMPTY_BOOTSTRAP);
  }, []);

  const loadAssets = useCallback(async (currentTab, currentFilters) => {
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
        return payload.items[0]?.publicId || null;
      });
    } finally {
      setLoadingAssets(false);
    }
  }, []);

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
    setAnalytics(analyticsResponse.data || EMPTY_ANALYTICS);
    setGovernance(governanceResponse.data || EMPTY_GOVERNANCE);
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
            "No fue posible cargar el modulo de biblioteca comercial",
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

  function startCatalogAdminEdit(entry) {
    if (!entry?.publicId) return;
    setOpenCatalogAdminMenuId(null);
    setCatalogAdminEditors((current) => ({
      ...current,
      [entry.publicId]: buildCatalogAdminEditor(entry),
    }));
  }

  function updateCatalogAdminEditor(publicId, field, value) {
    setCatalogAdminEditors((current) => ({
      ...current,
      [publicId]: {
        ...current[publicId],
        [field]: value,
      },
    }));
  }

  function cancelCatalogAdminEdit(publicId) {
    setCatalogAdminEditors((current) => {
      const next = { ...current };
      delete next[publicId];
      return next;
    });
  }

  function toggleCatalogAdminMenu(publicId) {
    setOpenCatalogAdminMenuId((currentValue) =>
      currentValue === publicId ? null : publicId,
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
    setWorking(true);
    setError("");
    try {
      const result = await action();
      setPublishSectionErrors(EMPTY_PUBLISH_SECTION_ERRORS);
      let nextFilters = activeFilters;

      if (trackAssetResult && result?.data?.publicId) {
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
        "No fue posible ejecutar la accion",
      );
      if (typeof onErrorMessage === "function") {
        onErrorMessage(errorMessage);
      } else {
        setError(errorMessage);
      }
      return null;
    } finally {
      setWorking(false);
    }
  }

  async function handleSaveAsset(event) {
    event?.preventDefault?.();
    setAssetSaveFeedback(null);
    const isCreating = !selectedAsset?.publicId;
    const pendingFilesToUpload = isCreating ? pendingFiles : [];
    const pendingLinksToCreate = isCreating ? pendingLinks : [];
    const payload = buildAssetPayload({
      ...draft,
      sourceType: deriveSourceType(
        draft.sourceType,
        pendingFilesToUpload.length,
        pendingLinksToCreate.length,
      ),
    });

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
      setSelectedAssetPublicId(saved.publicId);
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
              ? `Activo creado con ${attachedCount} recurso(s) adjuntos`
              : "Activo creado",
        });
        return;
      }

      setAssetSaveFeedback({
        tone: "error",
        message:
          attachedCount > 0
            ? `Activo creado y ${attachedCount} recurso(s) adjuntos, pero ${failedFiles.length + failedLinks.length} quedaron pendientes`
            : `Activo creado, pero ${failedFiles.length + failedLinks.length} recurso(s) quedaron pendientes`,
      });
    } finally {
      setWorking(false);
    }
  }

  async function handleUploadFiles(event) {
    const inputElement = event.target;
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    if (!selectedAsset?.publicId) {
      setPendingFiles((current) => [
        ...current,
        ...files.map((file) => ({
          id: buildPendingFileId(file),
          file,
        })),
      ]);
      inputElement.value = "";
      setAssetSaveFeedback({
        tone: "success",
        message: `${files.length} archivo(s) listo(s) para guardarse con el activo`,
      });
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
      "Archivos cargados",
    );
    inputElement.value = "";
  }

  async function handleCreateLink(event) {
    event?.preventDefault?.();
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

  async function handleCreateCatalogEntry(event, catalogType) {
    event.preventDefault();
    if (!canAdmin) return;

    const draftValue = catalogAdminDrafts[catalogType] || {};
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
        [catalogType]: { name: "", description: "" },
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

  async function handleUpdateCatalogEntry(entry, overrides = {}) {
    if (!canAdmin || !entry?.publicId) return;

    const draftValue =
      catalogAdminEditors[entry.publicId] || buildCatalogAdminEditor(entry);
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
      cancelCatalogAdminEdit(entry.publicId);
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

  async function handleDeleteCatalogEntry(entry) {
    if (!canAdmin || !entry?.publicId) return;
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
      cancelCatalogAdminEdit(entry.publicId);
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
  const listItems = assetsResult.items || [];
  const publishMode = draft.status === "published";
  const catalogRequirementHint = publishMode
    ? "Selecciona al menos un fabricante aqui o una solucion en la seccion vecina."
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
      value: metricValue(analytics.totals.totalAssets),
      helper: "Todo el inventario del modulo",
    },
    {
      label: "Publicados",
      value: metricValue(analytics.totals.publishedAssets),
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
  const pendingResourceCount = pendingFiles.length + pendingLinks.length;

  return (
    <div className="enablement-library-page">
      <header className="enablement-library-hero">
        <div>
          <span className="enablement-library-eyebrow">
            Biblioteca Comercial
          </span>
          <h1>Biblioteca comercial para preparar, comparar y compartir</h1>
          <p>
            Encuentra material por fabricante, solucion, necesidad o
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

      {!loading && activeTab === "use" ? (
        <div className="enablement-library-layout">
          <aside className="enablement-library-sidebar">
            <section className="enablement-library-panel">
              <div className="enablement-library-panel-header">
                <h2>Buscar material</h2>
                <span>{assetsResult.total} resultado(s)</span>
              </div>
              <div className="enablement-library-form-grid single-column">
                <input
                  value={filters.q}
                  onChange={(event) => updateFilter("q", event.target.value)}
                  placeholder="Buscar por titulo, resumen o contexto"
                />
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
                    <option value="most_used">Mas usados</option>
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
                title="Solucion"
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
                <div className="enablement-library-card-list">
                  {listItems.map((asset) => (
                    <AssetListCard
                      key={asset.publicId}
                      asset={asset}
                      isSelected={asset.publicId === selectedAsset?.publicId}
                      onSelect={setSelectedAssetPublicId}
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
                  {selectedAsset.internalDescription ? (
                    <div className="enablement-library-note-box">
                      <strong>Uso interno</strong>
                      <p>{selectedAsset.internalDescription}</p>
                    </div>
                  ) : null}
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
                    onClick={() => {
                      setSelectedAssetPublicId(null);
                      setAssetDetail(null);
                      setDraft(emptyDraft());
                      setPublishSectionErrors(EMPTY_PUBLISH_SECTION_ERRORS);
                      setAssetSaveFeedback(null);
                      setPendingFiles([]);
                      setPendingLinks([]);
                      setLinkDraft(emptyLinkDraft());
                      setSuccess("");
                      setError("");
                    }}
                  >
                    Nuevo activo
                  </button>
                </div>
              </div>
              <div className="enablement-library-form-grid">
                <input
                  value={filters.q}
                  onChange={(event) => updateFilter("q", event.target.value)}
                  placeholder="Buscar para editar"
                />
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
              <div className="enablement-library-card-list compact">
                {listItems.map((asset) => (
                  <AssetListCard
                    key={asset.publicId}
                    asset={asset}
                    isSelected={asset.publicId === selectedAsset?.publicId}
                    onSelect={setSelectedAssetPublicId}
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
                        <span>{draft.status || "draft"}</span>
                        <span>{draft.visibilityLevel || "internal_sales"}</span>
                        <span>{draft.audienceCode || "seller"}</span>
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
                            updateDraftField("assetTypeCode", event.target.value)
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
                            updateDraftField("visibilityLevel", event.target.value)
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
                            catalogs.language || [{ code: "es", name: "Espanol" }]
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
                          Resume el valor comercial y agrega notas internas para el equipo.
                        </p>
                      </div>
                    </div>
                    <div className="enablement-library-form-grid enablement-library-editor-copy-grid">
                      <label>
                        Resumen comercial
                        <textarea
                          ref={summaryInputRef}
                          rows={4}
                          value={draft.summary}
                          onChange={(event) =>
                            updateDraftField("summary", event.target.value)
                          }
                        />
                      </label>
                      <label>
                        Indicaciones internas
                        <textarea
                          rows={6}
                          value={draft.internalDescription}
                          onChange={(event) =>
                            updateDraftField(
                              "internalDescription",
                              event.target.value,
                            )
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
                        <h3>Clasificacion comercial</h3>
                        <p>
                          Relaciona el material con fabricantes, soluciones, industrias y momentos de uso.
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
                        title="Solucion"
                        options={catalogs.solution}
                        values={draft.solutionCodes}
                        onToggle={(value) =>
                          toggleDraftValue("solutionCodes", value)
                        }
                        requirementHint={catalogRequirementHint}
                        invalidMessage={
                          publishSectionErrors.catalogContext
                            ? PUBLISH_SECTION_MESSAGES.catalogContext
                            : ""
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
                          Define si el material es descargable y agrega archivos o URLs desde este mismo bloque.
                        </p>
                      </div>
                      <div className="enablement-library-card-topline">
                        <span>
                          {selectedAsset?.title || "Se guardaran junto con el activo"}
                        </span>
                      </div>
                    </div>
                    <div className="enablement-library-check-grid">
                      <label className="enablement-library-check">
                        <input
                          type="checkbox"
                          checked={draft.isDownloadable}
                          onChange={(event) =>
                            updateDraftField("isDownloadable", event.target.checked)
                          }
                        />
                        Permitir descarga
                      </label>
                    </div>
                    {!selectedAsset ? (
                      <p className="enablement-library-muted">
                        Agrega archivos y URLs al mismo formulario. Cuando guardes,
                        el activo se creara y estos recursos se registraran en la misma accion.
                      </p>
                    ) : null}
                    <div className="enablement-library-stack">
                      <label className="enablement-library-upload-field">
                        <span>Subir archivos</span>
                        <input type="file" multiple onChange={handleUploadFiles} />
                      </label>
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
                                  {file.mimeType || file.file?.type || "Pendiente"}
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
                                      handleOpenFile(selectedAsset.publicId, file)
                                    }
                                  >
                                    {file.isAvailable === false
                                      ? "No disponible"
                                      : "Abrir"}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="enablement-library-inline-button"
                                  onClick={() =>
                                    selectedAsset
                                      ? handleDeleteFile(file.publicId)
                                      : handleRemovePendingFile(file.id)
                                  }
                                >
                                  Quitar
                                </button>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="enablement-library-muted">
                            Sin archivos cargados.
                          </p>
                        )}
                      </div>
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
                          placeholder="Descripcion corta"
                        />
                        <button
                          type="button"
                          className="enablement-library-action subtle"
                          onClick={handleCreateLink}
                        >
                          {selectedAsset ? "Agregar URL" : "Preparar URL"}
                        </button>
                      </div>
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
                                      handleOpenLink(selectedAsset.publicId, link)
                                    }
                                  >
                                    Abrir URL
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="enablement-library-inline-button"
                                  onClick={() =>
                                    selectedAsset
                                      ? handleDeleteLink(link.publicId)
                                      : handleRemovePendingLink(link.id)
                                  }
                                >
                                  Quitar
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
                  </section>
                </div>
                <div className="enablement-library-editor-actions">
                  <button
                    type="submit"
                    className="enablement-library-action"
                    disabled={working}
                  >
                    {working
                      ? "Guardando..."
                      : selectedAsset
                        ? "Guardar cambios"
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
                {governance.manageableItems.map((item) => (
                  <GovernanceAssetListRow
                    key={item.publicId}
                    item={item}
                    meta={`${item.assetTypeLabel} · ${item.usageCount} uso(s) · ${item.status} · Actualizado ${item.updatedAt}`}
                    isDuplicate={duplicateCandidateIds.has(item.publicId)}
                    menuOpen={openGovernanceMenuId === item.publicId}
                    onToggleMenu={toggleGovernanceMenu}
                    onCloseMenu={() => setOpenGovernanceMenuId(null)}
                    onOpen={(publicId) => {
                      setSelectedAssetPublicId(publicId);
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
                ))}
              </div>
            </section>

            {canAdmin ? (
              <section className="enablement-library-panel">
                <div className="enablement-library-panel-header">
                  <h2>Catalogos administrables</h2>
                  <div className="enablement-library-stack">
                    <span>Crea opciones para Fabricante, Solucion e Industria</span>
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
                    const allItems = adminCatalogs[catalogConfig.type] || [];
                    const activeCount = allItems.filter(
                      (entry) => entry.isActive !== false,
                    ).length;
                    const items = allItems.filter((entry) =>
                      catalogAdminVisibility === "all"
                        ? true
                        : entry.isActive !== false,
                    );
                    const draftValue =
                      catalogAdminDrafts[catalogConfig.type] || {};
                    return (
                      <section
                        key={catalogConfig.type}
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
                            handleCreateCatalogEntry(event, catalogConfig.type)
                          }
                        >
                          <input
                            value={draftValue.name || ""}
                            onChange={(event) =>
                              updateCatalogAdminDraft(
                                catalogConfig.type,
                                "name",
                                event.target.value,
                              )
                            }
                            placeholder={`Nuevo ${catalogConfig.label.slice(0, -1) || catalogConfig.label}`}
                          />
                          <textarea
                            rows={2}
                            value={draftValue.description || ""}
                            onChange={(event) =>
                              updateCatalogAdminDraft(
                                catalogConfig.type,
                                "description",
                                event.target.value,
                              )
                            }
                            placeholder="Descripcion breve"
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
                              const editorValue =
                                catalogAdminEditors[entry.publicId] ||
                                buildCatalogAdminEditor(entry);
                              const isEditing = Boolean(
                                catalogAdminEditors[entry.publicId],
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
                                    handleUpdateCatalogEntry(entry);
                                  }}
                                >
                                  <input
                                    value={editorValue.name}
                                    onChange={(event) =>
                                      updateCatalogAdminEditor(
                                        entry.publicId,
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
                                        entry.publicId,
                                        "description",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Descripcion breve"
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
                                        cancelCatalogAdminEdit(entry.publicId)
                                      }
                                      disabled={working}
                                    >
                                      Cancelar
                                    </button>
                                    <button
                                      type="button"
                                      className="enablement-library-action subtle is-danger"
                                      onClick={() =>
                                        handleUpdateCatalogEntry(entry, {
                                          isActive: entry.isActive === false,
                                        })
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
                                        handleDeleteCatalogEntry(entry)
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
                                        toggleCatalogAdminMenu(entry.publicId)
                                      }
                                      aria-label={`Abrir acciones para ${entry.name}`}
                                      aria-expanded={
                                        openCatalogAdminMenuId ===
                                        entry.publicId
                                      }
                                      disabled={working}
                                    >
                                      ⋮
                                    </button>
                                    {openCatalogAdminMenuId ===
                                    entry.publicId ? (
                                      <div className="user-kebab-menu">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenCatalogAdminMenuId(null);
                                            startCatalogAdminEdit(entry);
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
                                            handleUpdateCatalogEntry(entry, {
                                              isActive:
                                                entry.isActive === false,
                                            });
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
                                            handleDeleteCatalogEntry(entry);
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
