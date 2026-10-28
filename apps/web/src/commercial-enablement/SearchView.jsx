import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { api, getApiErrorMessage } from "../api";
import MaterialCard from "./MaterialCard";
import MaterialPanel from "./MaterialPanel";
import { FilterMenu, MoreFiltersMenu } from "./LibraryParts";
import useAssetList from "./useAssetList";
import {
  API_BASE,
  copyShareLink,
  downloadAssetFile,
  describeCopyResult,
  getResource,
  openAssetLink,
  toggleValue,
} from "./libraryModel";

const PAGE_SIZE = 24;

const SHORTCUTS = [
  { id: "", label: "Todos" },
  { id: "favorites", label: "★ Favoritos" },
  { id: "recent", label: "Recientes" },
  { id: "new", label: "Nuevos" },
];

const EMPTY_FILTERS = {
  assetTypeCodes: [],
  manufacturerCodes: [],
  technologyCodes: [],
  solutionCodes: [],
  industryCodes: [],
  languageCodes: [],
  competitorCodes: [],
  onlyClientSafe: false,
};

const FILTER_LABELS = {
  assetTypeCodes: ["asset_type", "Tipo"],
  manufacturerCodes: ["manufacturer", "Fabricante"],
  technologyCodes: ["technology", "Tecnología"],
  solutionCodes: ["solution", "Solución"],
  industryCodes: ["industry", "Industria"],
  languageCodes: ["language", "Idioma"],
  competitorCodes: ["competitor", "Competidor"],
};

function buildParams({ query, shortcut, filters, sort }) {
  const params = { pageSize: PAGE_SIZE };
  if (query) params.q = query;
  if (shortcut) params.shortcut = shortcut;
  if (sort) params.sort = sort;
  Object.keys(FILTER_LABELS).forEach((key) => {
    if (filters[key].length) params[key] = filters[key].join(",");
  });
  if (filters.onlyClientSafe) params.onlyClientSafe = "true";
  return params;
}

export default function SearchView({
  catalogs,
  refreshKey,
  notify,
  onEdit,
}) {
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [shortcut, setShortcut] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryDraft.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [queryDraft]);

  const params = useMemo(
    () => buildParams({ query, shortcut, filters, sort }),
    [query, shortcut, filters, sort],
  );
  const { items, total, hasMore, error, loading, isInitialLoad, loadMore, patchItem, removeItem } =
    useAssetList(params, `${refreshKey}:${reloadKey}`);
  const optionsFor = (type) => catalogs?.[type] || [];

  function toggleFilter(key, code) {
    setFilters((current) => ({ ...current, [key]: toggleValue(current[key], code) }));
  }

  const activeChips = [];
  Object.entries(FILTER_LABELS).forEach(([key, [type, label]]) => {
    filters[key].forEach((code) => {
      const option = optionsFor(type).find((entry) => entry.code === code);
      activeChips.push({
        id: `${key}:${code}`,
        label: `${label}: ${option?.name || code}`,
        remove: () => toggleFilter(key, code),
      });
    });
  });
  if (filters.onlyClientSafe) {
    activeChips.push({
      id: "onlyClientSafe",
      label: "Solo para cliente",
      remove: () =>
        setFilters((current) => ({ ...current, onlyClientSafe: false })),
    });
  }

  function applyPanelChange(next) {
    const publicId = next?.publicId || selectedId;
    if (!publicId) return;
    if (shortcut === "favorites" && next.isFavorite === false) {
      removeItem(publicId);
      return;
    }
    patchItem(publicId, next);
  }

  async function handleToggleFavorite(asset) {
    try {
      const response = asset.isFavorite
        ? await api.delete(`${API_BASE}/assets/${asset.publicId}/favorite`)
        : await api.post(`${API_BASE}/assets/${asset.publicId}/favorite`);
      applyPanelChange({
        publicId: asset.publicId,
        isFavorite: response.data.isFavorite,
      });
    } catch (requestError) {
      notify(
        getApiErrorMessage(requestError, "No fue posible actualizar favoritos"),
        "error",
      );
    }
  }

  async function handleCopyLink(asset) {
    try {
      const result = await copyShareLink(asset);
      notify(describeCopyResult(result), result.copied ? "success" : "error");
    } catch (requestError) {
      notify(
        getApiErrorMessage(requestError, "No fue posible crear el enlace"),
        "error",
      );
    }
  }

  async function handleDownload(asset) {
    const resource = getResource(asset);
    try {
      if (resource.kind === "link") openAssetLink(asset, resource.link);
      else if (resource.kind === "file") await downloadAssetFile(asset, resource.file);
    } catch (requestError) {
      notify(
        getApiErrorMessage(requestError, "No fue posible descargar el archivo"),
        "error",
      );
    }
  }

  const hasCriteria =
    Boolean(query) || Boolean(shortcut) || activeChips.length > 0;

  return (
    <div className="sl-search">
      <div className="sl-searchbox">
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          value={queryDraft}
          onChange={(event) => setQueryDraft(event.target.value)}
          placeholder='¿Qué necesitas? Ej. "Fortinet salud caso de éxito"'
          aria-label="Buscar material"
        />
        {queryDraft ? (
          <button
            type="button"
            className="sl-icon-button"
            onClick={() => setQueryDraft("")}
            aria-label="Limpiar búsqueda"
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="sl-shortcuts" role="tablist" aria-label="Atajos">
        {SHORTCUTS.map((entry) => (
          <button
            key={entry.id || "all"}
            type="button"
            role="tab"
            aria-selected={shortcut === entry.id}
            className={`sl-shortcut ${shortcut === entry.id ? "is-active" : ""}`}
            onClick={() => setShortcut(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="sl-filters">
        <FilterMenu
          label="Tipo"
          options={optionsFor("asset_type")}
          selected={filters.assetTypeCodes}
          onToggle={(code) => toggleFilter("assetTypeCodes", code)}
        />
        <FilterMenu
          label="Fabricante"
          options={optionsFor("manufacturer")}
          selected={filters.manufacturerCodes}
          onToggle={(code) => toggleFilter("manufacturerCodes", code)}
        />
        <FilterMenu
          label="Tecnología"
          options={optionsFor("technology")}
          selected={filters.technologyCodes}
          onToggle={(code) => toggleFilter("technologyCodes", code)}
        />
        <MoreFiltersMenu
          groups={[
            { key: "solution", label: "Solución", options: optionsFor("solution"), selected: filters.solutionCodes, onToggle: (code) => toggleFilter("solutionCodes", code) },
            { key: "industry", label: "Industria", options: optionsFor("industry"), selected: filters.industryCodes, onToggle: (code) => toggleFilter("industryCodes", code) },
            { key: "language", label: "Idioma", options: optionsFor("language"), selected: filters.languageCodes, onToggle: (code) => toggleFilter("languageCodes", code) },
            { key: "competitor", label: "Competidor", options: optionsFor("competitor"), selected: filters.competitorCodes, onToggle: (code) => toggleFilter("competitorCodes", code) },
          ]}
        />
        <label className="sl-check sl-check-inline">
          <input
            type="checkbox"
            checked={filters.onlyClientSafe}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                onlyClientSafe: event.target.checked,
              }))
            }
          />
          Solo para cliente
        </label>
      </div>

      {activeChips.length ? (
        <div className="sl-active-chips">
          {activeChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className="sl-chip is-selected"
              onClick={chip.remove}
              aria-label={`Quitar filtro ${chip.label}`}
            >
              {chip.label} <X size={12} aria-hidden="true" />
            </button>
          ))}
          <button
            type="button"
            className="btn-tertiary"
            onClick={() => setFilters(EMPTY_FILTERS)}
          >
            Limpiar filtros
          </button>
        </div>
      ) : null}

      <div className="sl-results-bar">
        <strong aria-live="polite">
          {isInitialLoad
            ? "Buscando..."
            : `${total} ${total === 1 ? "material" : "materiales"}`}
        </strong>
        <label>
          Ordenar:{" "}
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="">{query ? "Relevancia" : "Más recientes"}</option>
            {query ? <option value="updated_desc">Más recientes</option> : null}
            <option value="created_desc">Nuevos primero</option>
            <option value="title_asc">Título A-Z</option>
          </select>
        </label>
      </div>

      {error ? (
        <p className="form-error" role="alert">
          {error}{" "}
          <button type="button" className="btn-tertiary" onClick={() => setReloadKey((key) => key + 1)}>
            Reintentar
          </button>
        </p>
      ) : null}

      {!loading && !items.length && !error ? (
        <div className="sl-empty">
          <strong>
            {hasCriteria
              ? "No encontramos materiales con esos criterios."
              : "Aún no hay materiales en la biblioteca."}
          </strong>
          {hasCriteria ? (
            <p>Prueba con menos palabras o quita algún filtro.</p>
          ) : null}
        </div>
      ) : null}

      <div className="sl-grid">
        {items.map((asset) => (
          <MaterialCard
            key={asset.publicId}
            asset={asset}
            isSelected={asset.publicId === selectedId}
            onOpen={(entry) => setSelectedId(entry.publicId)}
            onToggleFavorite={handleToggleFavorite}
            onCopyLink={handleCopyLink}
            onDownload={handleDownload}
          />
        ))}
      </div>

      {hasMore ? (
        <div className="sl-load-more">
          <button
            type="button"
            className="btn-secondary"
            disabled={loading}
            onClick={loadMore}
          >
            {loading ? "Cargando..." : "Cargar más"}
          </button>
        </div>
      ) : null}

      {selectedId ? (
        <MaterialPanel
          key={selectedId}
          publicId={selectedId}
          onClose={() => setSelectedId(null)}
          onOpenRelated={setSelectedId}
          onChanged={applyPanelChange}
          onEdit={onEdit}
          onDeleted={() => {
            setSelectedId(null);
            setReloadKey((key) => key + 1);
          }}
          notify={notify}
        />
      ) : null}
    </div>
  );
}
