import { useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "../api";
import { AudienceBadge, FilterMenu, StatusBadge } from "./LibraryParts";
import {
  API_BASE,
  describeExpiry,
  formatDate,
  toggleValue,
} from "./libraryModel";
import useAssetList from "./useAssetList";

const PAGE_SIZE = 50;

const EMPTY_FILTERS = {
  status: "all",
  assetTypeCodes: [],
  manufacturerCodes: [],
  technologyCodes: [],
  sharing: "",
  sourceType: "",
  expiry: "",
};

export default function MyMaterialsView({
  catalogs,
  canManage,
  refreshKey,
  notify,
  onEdit,
}) {
  const [scope, setScope] = useState("mine");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState("updated_desc");
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryDraft.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [queryDraft]);

  const params = useMemo(() => {
    const next = { pageSize: PAGE_SIZE, status: filters.status, sort };
    if (scope === "mine") next.mine = "true";
    if (query) next.q = query;
    ["assetTypeCodes", "manufacturerCodes", "technologyCodes"].forEach((key) => {
      if (filters[key].length) next[key] = filters[key].join(",");
    });
    ["sharing", "sourceType", "expiry"].forEach((key) => {
      if (filters[key]) next[key] = filters[key];
    });
    return next;
  }, [scope, filters, sort, query]);
  const optionsFor = (type) => catalogs?.[type] || [];
  const hasActiveFilters =
    Boolean(queryDraft) ||
    JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  function setFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function toggleFilter(key, code) {
    setFilters((current) => ({ ...current, [key]: toggleValue(current[key], code) }));
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setQueryDraft("");
    setQuery("");
  }
  const { items, total, hasMore, error, loading, loadMore, patchItem, removeItem } =
    useAssetList(params, String(refreshKey));

  async function toggleActive(asset) {
    setBusyId(asset.publicId);
    try {
      const action = asset.isActive ? "deactivate" : "activate";
      const response = await api.post(
        `${API_BASE}/assets/${asset.publicId}/${action}`,
        {},
      );
      patchItem(asset.publicId, response.data);
      notify(asset.isActive ? "Material desactivado." : "Material activado.", "success");
    } catch (requestError) {
      notify(getApiErrorMessage(requestError, "No fue posible cambiar el estado"), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(asset) {
    if (
      !window.confirm(
        `Esto elimina "${asset.title}" y su archivo de forma permanente. Si solo quieres ocultarlo, usa Desactivar. ¿Eliminar?`,
      )
    ) {
      return;
    }
    setBusyId(asset.publicId);
    try {
      await api.delete(`${API_BASE}/assets/${asset.publicId}`);
      removeItem(asset.publicId);
      notify("Material eliminado.", "success");
    } catch (requestError) {
      notify(getApiErrorMessage(requestError, "No fue posible eliminar el material"), "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="sl-mine">
      <div className="sl-mine-toolbar">
        <input
          type="search"
          value={queryDraft}
          onChange={(event) => setQueryDraft(event.target.value)}
          placeholder="Buscar en mis materiales"
          aria-label="Buscar en mis materiales"
        />
        <select
          value={filters.status}
          onChange={(event) => setFilter("status", event.target.value)}
          aria-label="Estado"
        >
          <option value="all">Todos los estados</option>
          <option value="active">Activos</option>
          <option value="inactive">Desactivados</option>
        </select>
        {canManage ? (
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            aria-label="Alcance"
          >
            <option value="mine">Solo míos</option>
            <option value="all">Todos los materiales</option>
          </select>
        ) : null}
      </div>

      <div className="sl-mine-toolbar sl-mine-filters">
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
        <select
          value={filters.sharing}
          onChange={(event) => setFilter("sharing", event.target.value)}
          aria-label="Compartir"
        >
          <option value="">Cliente o interno</option>
          <option value="client">Para cliente</option>
          <option value="internal">Solo interno</option>
        </select>
        <select
          value={filters.sourceType}
          onChange={(event) => setFilter("sourceType", event.target.value)}
          aria-label="Origen"
        >
          <option value="">Archivo o enlace</option>
          <option value="file">Archivo</option>
          <option value="url">Enlace</option>
        </select>
        <select
          value={filters.expiry}
          onChange={(event) => setFilter("expiry", event.target.value)}
          aria-label="Vigencia"
        >
          <option value="">Cualquier vigencia</option>
          <option value="expired">Vencidos</option>
          <option value="expiring">Vencen en 7 días</option>
        </select>
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value)}
          aria-label="Ordenar"
        >
          <option value="updated_desc">Más recientes</option>
          <option value="created_desc">Más nuevos</option>
          <option value="title_asc">Título A–Z</option>
        </select>
        {hasActiveFilters ? (
          <button type="button" className="btn-tertiary" onClick={clearFilters}>
            Limpiar filtros
          </button>
        ) : null}
        <strong className="sl-mine-total" aria-live="polite">
          {total} {total === 1 ? "material" : "materiales"}
        </strong>
      </div>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="sl-table-wrap">
        <table className="sl-table">
          <thead>
            <tr>
              <th scope="col">Material</th>
              <th scope="col">Estado</th>
              <th scope="col">Vence</th>
              <th scope="col">Actualizado</th>
              <th scope="col">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {items.map((asset) => (
              <tr key={asset.publicId}>
                <td>
                  <strong>{asset.title}</strong>
                  <div className="sl-card-badges">
                    <span className="sl-muted">{asset.assetTypeLabel}</span>
                    <AudienceBadge asset={asset} />
                  </div>
                </td>
                <td>
                  <StatusBadge asset={asset} />
                </td>
                <td className={asset.isExpired ? "sl-expired" : ""}>
                  {describeExpiry(asset) || "—"}
                </td>
                <td>{formatDate(asset.updatedAt)}</td>
                <td>
                  <div className="sl-inline-actions">
                    {asset.canEdit ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => onEdit(asset)}
                        disabled={busyId === asset.publicId}
                      >
                        Editar
                      </button>
                    ) : null}
                    {asset.canToggle ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => toggleActive(asset)}
                        disabled={busyId === asset.publicId}
                      >
                        {asset.isActive ? "Desactivar" : "Reactivar"}
                      </button>
                    ) : null}
                    {asset.canDelete ? (
                      <button
                        type="button"
                        className="btn-danger"
                        onClick={() => remove(asset)}
                        disabled={busyId === asset.publicId}
                      >
                        Eliminar
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {!items.length && !loading ? (
              <tr>
                <td colSpan={5} className="sl-muted">
                  No hay materiales para mostrar.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {loading ? <p className="sl-muted">Cargando...</p> : null}
      {hasMore ? (
        <div className="sl-load-more">
          <button
            type="button"
            className="btn-secondary"
            disabled={loading}
            onClick={loadMore}
          >
            Cargar más
          </button>
        </div>
      ) : null}
    </div>
  );
}
