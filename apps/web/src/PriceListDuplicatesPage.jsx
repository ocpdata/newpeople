import { Link } from "react-router-dom";
import { usePriceListDuplicatesPage } from "./tools/usePriceListDuplicatesPage";
import "./tools/tools.css";

const STATE_OPTIONS = [
  ["", "Todos los estados"],
  ["review_required", "Requiere revision"],
  ["ready_to_consolidate", "Listo para consolidar"],
];

const RISK_OPTIONS = [
  ["", "Todos los riesgos"],
  ["low", "Bajo"],
  ["medium", "Medio"],
  ["high", "Alto"],
];

const BOOLEAN_FILTER_OPTIONS = [
  ["", "Todos"],
  ["true", "Si"],
  ["false", "No"],
];

export default function PriceListDuplicatesPage() {
  const {
    summary,
    groups,
    filters,
    loadingSummary,
    loadingGroups,
    loadingDetail,
    groupDetail,
    selectedGroupKey,
    selectedKeepCandidateId,
    selectedDuplicateIds,
    validation,
    submittingAction,
    error,
    success,
    totalActiveFilters,
    updateFilter,
    clearFilters,
    loadGroupDetail,
    validateConsolidation,
    chooseKeepCandidate,
    toggleDuplicateSelection,
    executeAction,
  } = usePriceListDuplicatesPage();

  return (
    <section className="panel tools-page tools-duplicates-page">
      <header className="tools-page-header">
        <div>
          <div className="module-title-with-icon">
            <h2>Duplicados en listas de precios</h2>
            <span className="module-title-icon tools-title-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M4 7a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7zm10 0a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7zm3-1h1a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H8a2 2 0 0 1-2-2v-1h2v1h9a1 1 0 0 0 1-1V8h-1V6z" />
              </svg>
            </span>
          </div>
          <p className="roles-subtitle tools-page-subtitle">
            Detecta grupos con codigo normalizado equivalente dentro de la misma
            lista, analiza impacto y consolida de forma segura.
          </p>
          <p className="field-hint">
            <Link to="/tools">Herramientas</Link> / Duplicados en listas de precios
          </p>
        </div>
      </header>

      {error ? <div className="toast toast-error">{error}</div> : null}
      {success ? <div className="toast toast-success">{success}</div> : null}

      <div className="tools-summary-strip">
        <article className="tools-summary-card">
          <span>Grupos</span>
          <strong>{loadingSummary ? "..." : Number(summary?.groupCount || 0)}</strong>
        </article>
        <article className="tools-summary-card">
          <span>Items involucrados</span>
          <strong>{loadingSummary ? "..." : Number(summary?.itemCount || 0)}</strong>
        </article>
        <article className="tools-summary-card">
          <span>Alto riesgo</span>
          <strong>
            {loadingSummary ? "..." : Number(summary?.highRiskGroupCount || 0)}
          </strong>
        </article>
        <article className="tools-summary-card">
          <span>Listos para consolidar</span>
          <strong>
            {loadingSummary ? "..." : Number(summary?.readyToConsolidateCount || 0)}
          </strong>
        </article>
      </div>

      <div className="tools-duplicates-layout">
        <aside className="tools-filters-card">
          <div className="tools-card-heading">
            <div>
              <h3>Filtros</h3>
              <p>{totalActiveFilters} activos</p>
            </div>
            <button type="button" className="btn-secondary" onClick={clearFilters}>
              Limpiar
            </button>
          </div>

          <label className="tools-filter-field">
            <span>Proveedor</span>
            <input
              type="number"
              value={filters.providerId}
              onChange={(event) => updateFilter("providerId", event.target.value)}
              placeholder="Id del proveedor"
            />
          </label>

          <label className="tools-filter-field">
            <span>Lista de precios</span>
            <input
              type="number"
              value={filters.priceListId}
              onChange={(event) => updateFilter("priceListId", event.target.value)}
              placeholder="Id de la lista"
            />
          </label>

          <label className="tools-filter-field">
            <span>Codigo normalizado</span>
            <input
              type="text"
              value={filters.normalizedCode}
              onChange={(event) => updateFilter("normalizedCode", event.target.value)}
              placeholder="ABC123"
            />
          </label>

          <label className="tools-filter-field">
            <span>Estado</span>
            <select
              value={filters.state}
              onChange={(event) => updateFilter("state", event.target.value)}
            >
              {STATE_OPTIONS.map(([value, label]) => (
                <option key={value || "all"} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="tools-filter-field">
            <span>Riesgo</span>
            <select
              value={filters.riskLevel}
              onChange={(event) => updateFilter("riskLevel", event.target.value)}
            >
              {RISK_OPTIONS.map(([value, label]) => (
                <option key={value || "all"} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="tools-filter-field">
            <span>Referencias en cotizacion</span>
            <select
              value={filters.hasQuotationReferences}
              onChange={(event) =>
                updateFilter("hasQuotationReferences", event.target.value)
              }
            >
              {BOOLEAN_FILTER_OPTIONS.map(([value, label]) => (
                <option key={value || "all"} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="tools-filter-field">
            <span>Referencias en bundles</span>
            <select
              value={filters.hasBundleReferences}
              onChange={(event) =>
                updateFilter("hasBundleReferences", event.target.value)
              }
            >
              {BOOLEAN_FILTER_OPTIONS.map(([value, label]) => (
                <option key={value || "all"} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </aside>

        <div className="tools-main-column">
          <section className="tools-groups-card">
            <div className="tools-card-heading">
              <div>
                <h3>Grupos detectados</h3>
                <p>
                  {loadingGroups
                    ? "Buscando coincidencias..."
                    : `${groups.length} grupos visibles con los filtros actuales`}
                </p>
              </div>
            </div>

            <div className="tools-groups-table-wrap">
              <table className="tools-groups-table">
                <thead>
                  <tr>
                    <th>Proveedor</th>
                    <th>Lista</th>
                    <th>Codigo</th>
                    <th>Duplicados</th>
                    <th>Riesgo</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <tr
                      key={group.groupKey}
                      className={
                        group.groupKey === selectedGroupKey ? "is-selected" : ""
                      }
                    >
                      <td>{group.providerName}</td>
                      <td>{group.priceListName}</td>
                      <td>{group.normalizedCode}</td>
                      <td>{group.duplicateCount}</td>
                      <td>
                        <span className={`tools-risk-pill is-${group.riskLevel}`}>
                          {group.riskLevel}
                        </span>
                      </td>
                      <td>{group.status}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => void loadGroupDetail(group.groupKey)}
                        >
                          Ver detalle
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="tools-group-detail-card">
            <div className="tools-card-heading">
              <div>
                <h3>Detalle del grupo</h3>
                <p>
                  {loadingDetail
                    ? "Cargando detalle..."
                    : groupDetail
                      ? `${groupDetail.providerName} / ${groupDetail.priceListName}`
                      : "Selecciona un grupo para inspeccionar su impacto"}
                </p>
              </div>
              {groupDetail ? (
                <span className={`tools-risk-pill is-${groupDetail.riskLevel}`}>
                  {groupDetail.riskLevel}
                </span>
              ) : null}
            </div>

            {groupDetail ? (
              <>
                <div className="tools-detail-impact-grid">
                  <article className="tools-impact-card">
                    <span>Reapunte en cotizaciones</span>
                    <strong>{Number(groupDetail.impact?.totalQuotationItemsToRepoint || 0)}</strong>
                  </article>
                  <article className="tools-impact-card">
                    <span>Componentes de bundle</span>
                    <strong>{Number(groupDetail.impact?.totalBundleComponentsToRepoint || 0)}</strong>
                  </article>
                  <article className="tools-impact-card">
                    <span>Grupos padre afectados</span>
                    <strong>{Number(groupDetail.impact?.totalBundleParentsAffected || 0)}</strong>
                  </article>
                </div>

                <div className="tools-detail-items-grid">
                  {groupDetail.items.map((item) => {
                    const isKeep = Number(selectedKeepCandidateId || 0) === Number(item.id);
                    const isSelectedDuplicate = selectedDuplicateIds.includes(Number(item.id));
                    return (
                      <article
                        key={item.id}
                        className={`tools-detail-item-card ${isKeep ? "is-keep" : ""}`}
                      >
                        <div className="tools-detail-item-head">
                          <div>
                            <h4>{item.code}</h4>
                            <p>Id {item.id}</p>
                          </div>
                          <span className={`tools-state-pill is-${item.activationStatusCode}`}>
                            {item.activationStatusCode}
                          </span>
                        </div>

                        <p className="tools-detail-description">
                          {item.description || "Sin descripcion"}
                        </p>

                        <div className="tools-detail-meta">
                          <span>{item.itemType}</span>
                          <span>
                            {Number(item.price || 0).toFixed(2)} {item.currencyCode}
                          </span>
                          <span>Refs cotizacion: {item.references.quotationItems}</span>
                          <span>Como componente: {item.references.bundleComponents}</span>
                          <span>Como grupo: {item.references.bundleParents}</span>
                        </div>

                        <div className="tools-detail-actions">
                          <label className="tools-radio-row">
                            <input
                              type="radio"
                              name="keepCandidate"
                              checked={isKeep}
                              onChange={() => chooseKeepCandidate(item.id)}
                            />
                            <span>Conservar este item</span>
                          </label>

                          {!isKeep ? (
                            <label className="tools-checkbox-row">
                              <input
                                type="checkbox"
                                checked={isSelectedDuplicate}
                                onChange={() => toggleDuplicateSelection(item.id)}
                              />
                              <span>Incluir como duplicado sobrante</span>
                            </label>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>

                <div className="tools-validation-card">
                  <div>
                    <h4>Prevalidacion</h4>
                    <p className="field-hint">
                      Revisa warnings y bloqueos antes de consolidar o archivar.
                    </p>
                  </div>

                  {validation ? (
                    <div className="tools-validation-grid">
                      <div>
                        <strong>Estado</strong>
                        <p>{validation.statusAfterValidation}</p>
                      </div>
                      <div>
                        <strong>Plan</strong>
                        <p>
                          Cotizaciones: {validation.plan?.quotationItemsToRepoint || 0} |
                          Componentes: {validation.plan?.bundleComponentsToRepoint || 0} |
                          Archivar: {validation.plan?.itemsToArchive || 0} |
                          Borrar: {validation.plan?.itemsToDelete || 0}
                        </p>
                      </div>
                      <div>
                        <strong>Warnings</strong>
                        {validation.warnings?.length ? (
                          <ul>
                            {validation.warnings.map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        ) : (
                          <p>Sin warnings.</p>
                        )}
                      </div>
                      <div>
                        <strong>Bloqueos</strong>
                        {validation.blockers?.length ? (
                          <ul>
                            {validation.blockers.map((blocker) => (
                              <li key={blocker}>{blocker}</li>
                            ))}
                          </ul>
                        ) : (
                          <p>Sin bloqueos.</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="field-hint">
                      Aun no se ha ejecutado la validacion del grupo seleccionado.
                    </p>
                  )}
                </div>

                <div className="tools-detail-footer-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={submittingAction === "validate"}
                    onClick={() => void validateConsolidation()}
                  >
                    {submittingAction === "validate" ? "Validando..." : "Validar consolidacion"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={submittingAction === "archive_duplicates"}
                    onClick={() => void executeAction("archive_duplicates")}
                  >
                    {submittingAction === "archive_duplicates"
                      ? "Archivando..."
                      : "Archivar duplicados"}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={submittingAction === "delete_safe_duplicates"}
                    onClick={() => void executeAction("delete_safe_duplicates")}
                  >
                    {submittingAction === "delete_safe_duplicates"
                      ? "Consolidando..."
                      : "Consolidar"}
                  </button>
                </div>
              </>
            ) : (
              <p className="field-hint">
                No hay un grupo seleccionado todavia.
              </p>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}