import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getApiErrorMessage } from "./api";
import "./opportunities-quotations-report.css";

const INITIAL_FILTERS = {
  preset: "all", accountId: "", sellerUserId: "", presalesUserId: "",
  commercialStatuses: [], quotationStatuses: [], quotationPresence: "all",
  opportunityActivation: "all", quotationActivation: "all",
  dateType: "expected_close", dateFrom: "", dateTo: "", search: "",
  sort: "id", direction: "desc", pageSize: "10",
};
const PRESETS = [
  ["all", "Todas"],
  ["won", "Oportunidades ganadas"],
  ["accepted", "Con cotizaciones aceptadas"],
  ["both", "Ambas condiciones (Y)"],
  ["either", "Cualquiera de las dos (O)"],
  ["won_without_accepted", "Ganadas sin cotización aceptada"],
  ["accepted_not_won", "Con cotización aceptada y oportunidad no ganada"],
];
const COMMERCIAL_STATES = [
  ["en_proceso", "En proceso"], ["ganada", "Ganada"],
  ["perdida", "Perdida"],
];
const QUOTATION_STATES = [
  ["borrador", "Borrador"], ["en_aprobacion", "En aprobación"],
  ["aprobada", "Aprobada"], ["enviada", "Enviada"], ["ganada", "Ganada"],
  ["aceptada", "Aceptada"], ["rechazada", "Rechazada"], ["perdida", "Perdida"],
  ["no_vigente", "No vigente"],
];

function formatAmount(value) {
  return value == null ? "-" : new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
}

function PurchaseOrderAmounts({ quotation }) {
  const orders = quotation.purchaseOrders || [];
  return orders.length ? orders.map((order) => (
    <div key={`${order.source}:${order.documentId}`}>
      {order.amount == null
        ? "Valor sin registrar"
        : `${formatAmount(order.amount)} ${order.currencyCode || "(sin moneda)"}`}
    </div>
  )) : <span>Sin orden de compra registrada</span>;
}

function quotationConversion(quotation, field) {
  const currency = quotation.currency?.trim().toUpperCase();
  const exchangeRate = Number(quotation.exchangeRate);
  const needsConversion = currency && currency !== "USD";
  const validRate = Number.isFinite(exchangeRate) && exchangeRate > 0 && exchangeRate !== 1;
  if (!needsConversion) return "-";
  if (!validRate) return "Tipo de cambio faltante o inválido";
  if (field === "rate") {
    return `1 USD = ${new Intl.NumberFormat("es-MX", {
      maximumFractionDigits: 4,
    }).format(exchangeRate)} ${currency} (guardado)`;
  }
  return quotation.totalAmount == null
    ? "Sin monto de cotización"
    : `${formatAmount(quotation.totalAmount / exchangeRate)} USD`;
}

function requestParams(filters, page) {
  return Object.fromEntries(Object.entries({ ...filters, page })
    .map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : value])
    .filter(([, value]) => value !== ""));
}

export default function OpportunitiesQuotationsReportPage({ canReadReport }) {
  const [draft, setDraft] = useState(INITIAL_FILTERS);
  const [applied, setApplied] = useState({ filters: INITIAL_FILTERS, page: 1 });
  const [catalogs, setCatalogs] = useState({ accounts: [], sellers: [], presales: [] });
  const [catalogError, setCatalogError] = useState("");
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [displayMode, setDisplayMode] = useState("all");

  useEffect(() => {
    if (!canReadReport) return;
    let ignore = false;
    setCatalogError("");
    api.get("/api/reports/opportunities-quotations/catalogs").then(({ data }) => {
      if (!ignore) setCatalogs(data);
    }).catch((requestError) => {
      if (!ignore) setCatalogError(getApiErrorMessage(requestError, "No fue posible cargar los filtros del reporte."));
    });
    return () => { ignore = true; };
  }, [canReadReport, catalogRefresh]);

  useEffect(() => {
    if (!canReadReport) return;
    let ignore = false;
    setLoading(true);
    setError("");
    setPayload(null);
    api.get("/api/reports/opportunities-quotations", {
      params: requestParams(applied.filters, applied.page),
    }).then(({ data }) => {
      if (!ignore) setPayload(data);
    }).catch((requestError) => {
      if (!ignore) setError(getApiErrorMessage(requestError, "No fue posible cargar el reporte."));
    }).finally(() => {
      if (!ignore) setLoading(false);
    });
    return () => { ignore = true; };
  }, [applied, canReadReport]);

  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const select = (key, label, options) => (
    <label>
      {label}
      <select aria-label={label} value={draft[key]} onChange={(event) => update(key, event.target.value)}>
        {options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
      </select>
    </label>
  );
  const states = (key, title, options) => (
    <fieldset>
      <legend>{title}</legend>
      <p className="report-results-note">Sin selección se incluyen todos los estados.</p>
      <div className="report-state-options">
        {options.map(([value, label]) => (
          <label key={value}>
            <input type="checkbox" checked={draft[key].includes(value)} onChange={(event) => {
              update(key, event.target.checked ? [...draft[key], value] : draft[key].filter((item) => item !== value));
            }} />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <section className="dashboard-home-page opportunities-quotations-report">
      <header className="panel dashboard-home-hero">
        <div>
          <Link to="/reports">Volver a Reportes</Link>
          <h2>Oportunidades y cotizaciones</h2>
          <p>Consulta de solo lectura. Se evalúa únicamente la versión actual de cada cotización.</p>
        </div>
      </header>
      {!canReadReport ? (
        <p className="panel" role="alert">
          Acceso insuficiente: necesitas permisos de consulta de oportunidades y cotizaciones.
        </p>
      ) : (
        <>
          <form className="panel report-filters" onSubmit={(event) => {
            event.preventDefault();
            setApplied({ filters: draft, page: 1 });
          }}>
            <h3>Filtros</h3>
            <p className="report-results-note">Elige una consulta rápida y ajusta solo lo que necesites.</p>
            {catalogError && (
              <div role="alert">
                <p className="form-error">{catalogError}</p>
                <button type="button" onClick={() => setCatalogRefresh((value) => value + 1)}>Reintentar filtros</button>
              </div>
            )}
            <section className="report-filter-section" aria-label="Búsqueda y responsables">
            <h4>Búsqueda y responsables</h4>
            <div className="report-filter-grid">
              {select("preset", "Consulta rápida", PRESETS)}
              <label>Buscar oportunidad o cuenta<input type="search" maxLength={200} value={draft.search} onChange={(event) => update("search", event.target.value)} placeholder="Nombre o ID de oportunidad" /></label>
              {select("accountId", "Cuenta", [["", "Todas"], ...catalogs.accounts.map((item) => [item.id, item.name])])}
              {select("sellerUserId", "Vendedor", [["", "Todos"], ...catalogs.sellers.map((item) => [item.id, item.name])])}
              {select("presalesUserId", "Preventa", [["", "Todos"], ...catalogs.presales.map((item) => [item.id, item.name])])}
              {select("quotationPresence", "Con cotizaciones", [["all", "Todas"], ["with", "Con cotizaciones"], ["without", "Sin cotizaciones"]])}
            </div>
            </section>
            <section className="report-filter-section" aria-label="Periodo">
            <h4>Periodo <span className="report-filter-optional">Opcional</span></h4>
            <div className="report-filter-grid report-date-grid">
              {select("dateType", "Fecha a filtrar", [["expected_close", "Cierre previsto"], ["actual_close", "Cierre comercial real"], ["quotation", "Fecha de cotización"]])}
              <label>Desde<input type="date" value={draft.dateFrom} max={draft.dateTo || undefined} onChange={(event) => update("dateFrom", event.target.value)} /></label>
              <label>Hasta<input type="date" value={draft.dateTo} min={draft.dateFrom || undefined} onChange={(event) => update("dateTo", event.target.value)} /></label>
            </div>
            </section>
            <section className="report-filter-section" aria-label="Estados">
              <h4>Estados</h4>
              {states("commercialStatuses", "Estado comercial de oportunidad", COMMERCIAL_STATES)}
              {states("quotationStatuses", "Estado de cotización", QUOTATION_STATES)}
            </section>
            <details className="report-advanced-filters">
              <summary>Opciones avanzadas <span>Activación y orden de resultados</span></summary>
              <div className="report-filter-grid">
              {select("opportunityActivation", "Activación de oportunidad", [["all", "Todas"], ["activada", "Activada"], ["pendiente_activacion", "Pendiente"], ["desactivada", "Desactivada"]])}
              {select("quotationActivation", "Activación de cotización", [["all", "Todas"], ["activada", "Activada"], ["desactivada", "Desactivada"]])}
              {select("sort", "Ordenar por", [["id", "ID"], ["name", "Oportunidad"], ["account", "Cuenta"], ["amount", "Importe"], ["expected_close", "Cierre previsto"], ["actual_close", "Cierre real"]])}
              {select("direction", "Dirección", [["desc", "Descendente"], ["asc", "Ascendente"]])}
              {select("pageSize", "Oportunidades por página", [["10", "10"], ["50", "50"], ["100", "100"]])}
            </div>
            </details>
            <p className="report-results-note report-filter-help">
              Todos los filtros se combinan. Los estados y fechas de cotización deben cumplirse en la misma cotización.
              La activación limita qué cotizaciones se consideran, también al buscar oportunidades sin cotizaciones.
            </p>
            <div className="report-actions report-filter-actions">
              <button type="submit" className="btn-primary">Aplicar filtros</button>
              <button type="button" className="btn-secondary" onClick={() => {
                setDraft(INITIAL_FILTERS);
                setApplied({ filters: INITIAL_FILTERS, page: 1 });
                setDisplayMode("all");
              }}>Limpiar</button>
            </div>
          </form>

          {loading && <p role="status">Cargando reporte...</p>}
          {error && <div className="panel" role="alert">
            <p className="form-error">{error}</p>
            <button type="button" onClick={() => setApplied((current) => ({ ...current }))}>Reintentar reporte</button>
          </div>}
          {payload && (
            <section className="panel report-results" aria-label="Resultados del reporte">
              <header className="report-results-header">
                <div>
                  <h3>Resultados</h3>
                  <p>Resumen de todos los resultados filtrados, no solo de esta página.</p>
                </div>
                <span className="report-result-count">{payload.total} oportunidades</span>
              </header>
              <dl className="report-totals">
                <div><dt>Oportunidades</dt><dd>{payload.summary.opportunityCount}</dd></div>
                <div><dt>Ganadas</dt><dd>{payload.summary.wonCount}</dd></div>
                <div><dt>Importe de oportunidades (USD)</dt><dd>{formatAmount(payload.summary.opportunityAmountUsd)}</dd></div>
                <div><dt>Cotizaciones</dt><dd>{payload.summary.quotationCount}</dd></div>
                <div><dt>Aceptadas</dt><dd>{payload.summary.acceptedCount}</dd></div>
                <div><dt>Cotizaciones que cumplen los filtros</dt><dd>{payload.summary.matchingCount}</dd></div>
              </dl>
              <div className="report-results-toolbar">
              <label className="report-display-mode">Mostrar cotizaciones
                <select value={displayMode} onChange={(event) => setDisplayMode(event.target.value)}>
                  <option value="all">Todas, incluidas las de contexto</option>
                  <option value="matching">Solo las que cumplen el filtro</option>
                </select>
              </label>
              <ul className="report-currency-totals" aria-label="Totales cotizados por moneda">
                {payload.summary.currencies.map((item) => (
                  <li key={item.currency || "unknown"}>
                    Cotizado {item.currency || "(sin moneda)"}: {formatAmount(displayMode === "matching" ? item.matchingAmount : item.amount)}
                  </li>
                ))}
              </ul>
              </div>
              <p className="report-results-note">Importes cotizados con descuentos e IVA. Cada moneda se totaliza por separado; no se suma al monto de oportunidades.</p>
              {!payload.items.length ? <p>No hay resultados para los filtros seleccionados.</p> : (
                <div className="report-table-scroll">
                  <table className="report-main-table" aria-label="Oportunidades y sus importes">
                    <thead><tr>
                      <th>Oportunidad</th><th>Cuenta</th><th>Vendedor / Preventa</th>
                      <th>Monto de oportunidad (USD)</th><th>Montos de cotizaciones</th>
                      <th>Equivalentes de cotizaciones (USD)</th><th>Tipo de cambio</th>
                      <th>Valores de órdenes de compra</th>
                    </tr></thead>
                    <tbody>
                      {payload.items.map((item) => {
                        const quotations = displayMode === "matching" ? item.quotations.filter((quotation) => quotation.matchesFilters) : item.quotations;
                        return (
                          <Fragment key={item.id}>
                            <tr className="report-opportunity-row">
                              <td><strong>#{item.id} {item.name}</strong></td><td>{item.accountName}</td>
                              <td><span className="report-owner">{item.sellerName || "Sin vendedor"}</span><span className="report-owner-secondary">Preventa: {item.presalesName || "Sin asignar"}</span></td>
                              <td className="report-money">{formatAmount(item.amountUsd)}</td>
                              <td>
                                {quotations.length ? quotations.map((quotation) => (
                                  <div className="report-quote-amount" key={quotation.id}>
                                    #{quotation.id}: {formatAmount(quotation.totalAmount)} {quotation.currency || ""}
                                  </div>
                                )) : "Sin cotizaciones para esta selección."}
                              </td>
                              <td>
                                {quotations.length ? quotations.map((quotation) => (
                                  <div className="report-quote-amount" key={quotation.id}>#{quotation.id}: {quotationConversion(quotation, "amount")}</div>
                                )) : "-"}
                              </td>
                              <td>
                                {quotations.length ? quotations.map((quotation) => (
                                  <div className="report-quote-amount" key={quotation.id}>#{quotation.id}: {quotationConversion(quotation, "rate")}</div>
                                )) : "-"}
                              </td>
                              <td>
                                {quotations.length ? quotations.map((quotation) => (
                                  <div className="report-order-amount" key={quotation.id}>
                                    <span className="report-quotation-reference">Cotización #{quotation.id}</span>
                                    <PurchaseOrderAmounts quotation={quotation} />
                                  </div>
                                )) : "-"}
                              </td>
                            </tr>
                            <tr className="report-detail-row"><td colSpan={8}>
                              <details className="report-quotation-details">
                                <summary>
                                  Cotizaciones de #{item.id}: {item.quotations.length} total,
                                  {" "}{item.quotations.filter((quotation) => quotation.statusCode === "aceptada").length} aceptadas,
                                  {" "}{quotations.length} visibles
                                </summary>
                                <div className="report-detail-content">
                                <p className="report-results-note">“Cumple los filtros” se refiere a la selección actual, no a una comparación de importes.</p>
                                {!quotations.length ? <p>Sin cotizaciones para esta selección.</p> : (
                                  <table aria-label={`Cotizaciones de ${item.name}`}>
                                    <thead><tr><th>Cotización</th><th>Versión</th><th>Importe original</th><th>Equivalente (USD)</th><th>Tipo de cambio</th><th>Valores de órdenes de compra</th><th>Cumple los filtros</th></tr></thead>
                                    <tbody>{quotations.map((quotation) => (
                                      <tr key={quotation.id} className={quotation.matchesFilters ? "report-quotation-match" : ""}>
                                        <td>#{quotation.id} {quotation.proposalName || "Sin nombre"}</td>
                                        <td>{quotation.versionNumber ?? "-"}</td>
                                        <td>{formatAmount(quotation.totalAmount)} {quotation.currency || ""}</td>
                                        <td>{quotationConversion(quotation, "amount")}</td>
                                        <td>{quotationConversion(quotation, "rate")}</td>
                                        <td><PurchaseOrderAmounts quotation={quotation} /></td>
                                        <td><span className={`report-filter-badge ${quotation.matchesFilters ? "is-match" : ""}`}>{quotation.matchesFilters ? "Cumple" : "No cumple"}</span></td>
                                      </tr>
                                    ))}</tbody>
                                  </table>
                                )}
                                </div>
                              </details>
                            </td></tr>
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="report-actions report-pagination">
                <button type="button" disabled={payload.page <= 1} onClick={() => setApplied((current) => ({ ...current, page: payload.page - 1 }))}>Anterior</button>
                <span>Página {payload.page} de {Math.max(1, Math.ceil(payload.total / payload.pageSize))}</span>
                <button type="button" disabled={payload.page * payload.pageSize >= payload.total} onClick={() => setApplied((current) => ({ ...current, page: payload.page + 1 }))}>Siguiente</button>
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}
