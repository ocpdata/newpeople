import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getApiErrorMessage } from "./api";
import "./opportunities-quotations-report.css";

const INITIAL_FILTERS = {
  search: "", accountId: "", sellerUserId: "", dateFrom: "", dateTo: "",
  sort: "id", direction: "desc", pageSize: "10",
};
const METRICS = [
  ["sale", "Venta neta"], ["productCost", "Costo de productos"], ["serviceCost", "Costo de servicios"],
  ["totalCost", "Costo total"], ["profit", "Utilidad bruta"], ["marginPct", "Margen bruto %"],
];
const CONTRIBUTION_METRICS = [
  ["sale", "Venta neta"], ["productCost", "Costo de productos"],
  ["profit", "Contribución"], ["marginPct", "Margen de contribución %"],
];
const format = (value) => value == null ? "No calculable" : new Intl.NumberFormat("es-MX", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(value);

function MetricCells({ values, metrics = METRICS }) {
  return metrics.map(([key]) => (
    <td key={key} className={`report-money${values?.[key] < 0 ? " profitability-negative" : ""}`}>
      {!values ? "Total incompleto" : `${format(values[key])}${key === "marginPct" && values[key] != null ? "%" : ""}`}
    </td>
  ));
}

export default function OpportunityProfitabilityReportPage({ canReadReport, scope, contribution = false }) {
  const metrics = contribution ? CONTRIBUTION_METRICS : METRICS;
  const title = contribution ? "Contribución de oportunidades ganadas" : "Rentabilidad de oportunidades ganadas";
  const endpoint = contribution ? "/api/reports/opportunity-contribution" : "/api/reports/opportunity-profitability";
  const [draft, setDraft] = useState(INITIAL_FILTERS);
  const [applied, setApplied] = useState({ filters: INITIAL_FILTERS, page: 1 });
  const [catalogs, setCatalogs] = useState({ accounts: [], sellers: [] });
  const [catalogError, setCatalogError] = useState("");
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canReadReport) return;
    let ignore = false;
    setCatalogError("");
    api.get(`${endpoint}/catalogs`).then(({ data }) => {
      if (!ignore) setCatalogs(data);
    }).catch((failure) => {
      if (!ignore) setCatalogError(getApiErrorMessage(failure, "No fue posible cargar los filtros."));
    });
    return () => { ignore = true; };
  }, [canReadReport, catalogRefresh, endpoint]);

  useEffect(() => {
    if (!canReadReport) return;
    let ignore = false;
    setLoading(true);
    setError("");
    setPayload(null);
    api.get(endpoint, {
      params: Object.fromEntries(Object.entries({ ...applied.filters, page: applied.page }).filter(([, value]) => value !== "")),
    }).then(({ data }) => {
      if (!ignore) setPayload(data);
    }).catch((failure) => {
      if (!ignore) setError(getApiErrorMessage(failure, "No fue posible cargar el reporte."));
    }).finally(() => {
      if (!ignore) setLoading(false);
    });
    return () => { ignore = true; };
  }, [canReadReport, applied, endpoint]);

  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const select = (key, label, options) => (
    <label>{label}
      <select aria-label={label} value={draft[key]} onChange={(event) => update(key, event.target.value)}>
        {options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
      </select>
    </label>
  );
  const pages = payload ? Math.max(1, Math.ceil(payload.total / payload.pageSize)) : 1;
  const summary = payload?.summary;
  const summaryValues = summary?.totals || summary?.convertibleSubtotal;

  return (
    <section className="dashboard-home-page opportunities-quotations-report opportunity-profitability-report">
      <header className="panel dashboard-home-hero">
        <div>
          <Link to="/reports">Volver a Reportes</Link>
          <h2>{title}</h2>
          {canReadReport && <p>Alcance: {scope === "all" ? "Todos los usuarios" : "Mis datos (vendedor asignado actual)"}</p>}
          <p>Rentabilidad cotizada; importes sin IVA. Consolidado en USD con el tipo de cambio guardado en cada cotización.</p>
          {contribution && <p>Venta neta de productos y servicios menos costo de productos. No se resta el costo de servicios: la contribución no representa utilidad final ni margen real de ejecución.</p>}
        </div>
      </header>
      {!canReadReport ? <p className="panel" role="alert">Acceso insuficiente: necesitas un permiso del reporte {contribution ? "Contribución" : "Rentabilidad"}.</p> : (
        <>
          <form className="panel report-filters" onSubmit={(event) => {
            event.preventDefault();
            setApplied({ filters: draft, page: 1 });
          }}>
            <h3>Filtros</h3>
            <p className="report-results-note">Solo oportunidades ganadas con cotizaciones ganadas o aceptadas. Se suman sus versiones vigentes.</p>
            {catalogError && <div role="alert"><p>{catalogError}</p><button type="button" onClick={() => setCatalogRefresh((value) => value + 1)}>Reintentar filtros</button></div>}
            <div className="report-filter-grid profitability-filters">
              <label>Buscar oportunidad o cliente<input type="search" maxLength={200} value={draft.search} onChange={(event) => update("search", event.target.value)} /></label>
              {select("accountId", "Cliente", [["", "Todos"], ...catalogs.accounts.map((item) => [item.id, item.name])])}
              {scope === "all" && select("sellerUserId", "Vendedor", [["", "Todos"], ...catalogs.sellers.map((item) => [item.id, item.name])])}
              <label>Cierre comercial desde<input type="date" value={draft.dateFrom} max={draft.dateTo || undefined} onChange={(event) => update("dateFrom", event.target.value)} /></label>
              <label>Cierre comercial hasta<input type="date" value={draft.dateTo} min={draft.dateFrom || undefined} onChange={(event) => update("dateTo", event.target.value)} /></label>
              {select("sort", "Ordenar por", [["id", "Oportunidad"], ["name", "Nombre"], ["sale", "Venta neta"], ["totalCost", contribution ? "Costo de productos" : "Costo total"], ["profit", contribution ? "Contribución" : "Utilidad bruta"], ["marginPct", contribution ? "Margen de contribución %" : "Margen bruto %"]])}
              {select("direction", "Dirección", [["desc", "Descendente"], ["asc", "Ascendente"]])}
              {select("pageSize", "Resultados por página", [["10", "10"], ["50", "50"], ["100", "100"]])}
            </div>
            <div className="report-actions">
              <button type="submit" className="btn-primary">Aplicar filtros</button>
              <button type="button" className="btn-secondary" onClick={() => {
                setDraft(INITIAL_FILTERS);
                setApplied({ filters: INITIAL_FILTERS, page: 1 });
              }}>Limpiar filtros</button>
            </div>
          </form>
          {loading && <p role="status">Cargando reporte…</p>}
          {error && <div className="panel" role="alert"><p>{error}</p><button type="button" onClick={() => setApplied((current) => ({ ...current }))}>Reintentar reporte</button></div>}
          {payload && (
            <section className="panel report-results" aria-label={contribution ? "Resultados de contribución" : "Resultados de rentabilidad"}>
              <div className="report-results-header">
                <h3>{contribution ? "Contribución cotizada en USD" : "Rentabilidad cotizada en USD"}</h3>
                <span className="report-result-count">{summary.opportunityCount} oportunidades · {summary.quotationCount} cotizaciones</span>
              </div>
              {summary.missingCount > 0 && (
                <p role="alert" className="profitability-warning">
                  Total incompleto: {summary.missingCount} cotizaciones sin tipo de cambio válido. Los importes del resumen son un subtotal convertible; no se calcula el margen global.
                </p>
              )}
              <dl className="report-totals">
                {["sale", contribution ? "productCost" : "totalCost", "profit", "marginPct"].map((key) => (
                  <div key={key}>
                    <dt>{metrics.find(([field]) => field === key)[1]}{key !== "marginPct" ? " (USD)" : ""}{summary.missingCount && key !== "marginPct" ? " · Subtotal convertible" : ""}</dt>
                    <dd>{key === "marginPct" ? (summary.totals ? `${format(summary.totals.marginPct)}${summary.totals.marginPct == null ? "" : "%"}` : "No calculable") : format(summaryValues[key])}</dd>
                  </div>
                ))}
              </dl>
              <p className="report-results-note">Resumen de todos los resultados filtrados. El margen global se calcula sobre los importes acumulados, no como promedio de porcentajes.</p>
              {!payload.items.length ? <p>No hay oportunidades ganadas con cotizaciones elegibles para estos filtros.</p> : (
                <div className="report-table-scroll" role="region" aria-label="Tabla de rentabilidad" tabIndex={0}>
                  <table className="report-main-table">
                    <caption className="profitability-caption">Importes en USD · Venta neta sin IVA</caption>
                    <thead><tr><th>Oportunidad</th><th>Cliente</th><th>Vendedor</th><th>Cotizaciones</th>{metrics.map(([key, title]) => <th key={key}>{title}</th>)}</tr></thead>
                    <tbody>{payload.items.map((item) => (
                      <Fragment key={item.id}>
                        <tr className="report-opportunity-row">
                          <td>#{item.id} {item.name}</td><td>{item.accountName}</td><td>{item.sellerName || "Sin asignar"}</td><td>{item.quotationCount}</td>
                          <MetricCells values={item.totals} metrics={metrics} />
                        </tr>
                        <tr className="report-detail-row"><td colSpan={4 + metrics.length}>
                          {item.missingCount > 0 && <p className="profitability-warning">Total incompleto: {item.missingCount} cotizaciones sin conversión válida. Revisa el desglose.</p>}
                          <details className="report-quotation-details">
                            <summary>Ver cotizaciones de #{item.id}</summary>
                            <div className="report-detail-content">
                              <table aria-label={`Cotizaciones de ${item.name}`}>
                                <thead><tr><th>Cotización / versión</th><th>Estado</th><th>Moneda</th><th>Tipo de cambio guardado</th>{metrics.map(([key, title]) => <th key={key}>{title}</th>)}</tr></thead>
                                <tbody>{item.quotations.map((q) => (
                                  <Fragment key={q.id}>
                                    <tr>
                                      <td>#{q.id} {q.proposalName} · v{q.versionNumber}</td><td>{q.statusName}</td><td>{q.currency || "Sin moneda"}</td>
                                      <td>{!q.usd ? "Tipo de cambio faltante o inválido" : q.currency?.trim().toUpperCase() === "USD" ? "No requiere conversión" : `1 USD = ${format(q.exchangeRate)} ${q.currency}`}</td>
                                      <MetricCells values={q.original} metrics={metrics} />
                                    </tr>
                                    <tr><td colSpan={4}>Equivalente USD de #{q.id}</td><MetricCells values={q.usd} metrics={metrics} /></tr>
                                  </Fragment>
                                ))}</tbody>
                              </table>
                            </div>
                          </details>
                        </td></tr>
                      </Fragment>
                    ))}</tbody>
                  </table>
                </div>
              )}
              <div className="report-actions report-pagination">
                <button type="button" className="btn-secondary" disabled={payload.page <= 1} onClick={() => setApplied((current) => ({ ...current, page: payload.page - 1 }))}>Anterior</button>
                <span>Página {payload.page} de {pages}</span>
                <button type="button" className="btn-secondary" disabled={payload.page >= pages} onClick={() => setApplied((current) => ({ ...current, page: payload.page + 1 }))}>Siguiente</button>
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}
