import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  COMMISSION_CATEGORIES,
  COMMISSION_MIN_QUOTA_ATTAINMENT_PCT,
  describeCommissionBlock,
  describeSellerCommissionStatus,
  isSellerActive,
} from "./commissionRules";

const QUARTERS = [1, 2, 3, 4];

function formatMoney(value, currencyCode = "USD", maximumFractionDigits = 0) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currencyCode || "USD",
    maximumFractionDigits,
  }).format(Number(value || 0));
}

function CompactSale({ value, currencyCode }) {
  const amount = Number(value || 0);
  const magnitude = Math.abs(amount);
  const label = amount === 0
    ? `Venta ${currencyCode} 0`
    : magnitude < 1000
      ? `Venta ${amount < 0 ? "> -" : "< "}${currencyCode} 1 mil`
      : `Venta ≈ ${currencyCode} ${new Intl.NumberFormat("es-MX", {
        maximumFractionDigits: 0,
      }).format(amount / 1000)} mil`;
  const exact = `Venta aceptada: ${formatMoney(amount, currencyCode, 2)}`;
  return (
    <div className="commission-quarter-sale" tabIndex={0} aria-label={exact}>
      {label}
      <span className="commission-sale-tooltip" aria-hidden="true">{exact}</span>
    </div>
  );
}

function formatPct(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Sin fecha";
  return parsed.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

function sumCommission(summary) {
  return Number(summary?.calculatedTotalCommissionAmount || 0);
}

function sumEligibleContribution(summary) {
  return Number(summary?.eligibleProductContributionAmount || 0)
    + Number(summary?.eligibleServiceContributionAmount || 0)
    + Number(summary?.eligibleRenewalContributionAmount || 0);
}

// Contribución de todas las cotizaciones aceptadas, sin importar si generan comisión.
function sumContribution(summary) {
  return (summary?.quotations || []).reduce((sum, quotation) => sum + Number(quotation.totalContributionAmount || 0), 0);
}

function quotationCommission(quotation) {
  return (quotation.items || []).reduce((sum, item) => sum + Number(item.commissionAmount || 0), 0);
}

function quotationLink(quotationId) {
  return `/quotations?quotationId=${quotationId}`;
}

// Une los vendedores de los cuatro trimestres y calcula los totales anuales.
function buildTrackingModel(quarters) {
  const byQuarter = new Map();
  const sellers = new Map();
  const pending = [];
  const invalid = [];
  (quarters || []).forEach(({ quarter, tracking }) => {
    const summaries = new Map();
    (tracking?.summaries || []).forEach((summary) => {
      summaries.set(summary.sellerUserId, summary);
      if (!sellers.has(summary.sellerUserId)) {
        sellers.set(summary.sellerUserId, {
          id: summary.sellerUserId,
          name: summary.sellerUserName,
          email: summary.sellerUserEmail,
        });
      }
    });
    byQuarter.set(quarter, { summaries, tracking });
    (tracking?.invalidQuotations || []).forEach((item) => {
      invalid.push({ ...item, quarter });
    });
    (tracking?.pendingQuotations || []).forEach((item) => {
      pending.push({ ...item, quarter });
      if (!sellers.has(item.sellerUserId)) {
        sellers.set(item.sellerUserId, {
          id: item.sellerUserId,
          name: item.sellerUserName,
          email: item.sellerUserEmail,
        });
      }
    });
  });
  return { byQuarter, sellers: Array.from(sellers.values()), pending, invalid };
}

function InvalidQuotationsCard({ items }) {
  if (!items.length) return null;
  return (
    <section className="commercial-planning-card commission-invalid-card">
      <div className="commercial-planning-card-header">
        <div>
          <h3>Sin convertir a la moneda de la cuota</h3>
          <p>
            {items.length} cotización(es) no se incluyen en venta, cumplimiento ni comisión porque su
            moneda o tipo de cambio no permite convertirlas con seguridad. Corrige la cotización para
            que cuente.
          </p>
        </div>
      </div>
      <div className="commercial-planning-table-wrap">
        <table className="commercial-planning-table">
          <thead>
            <tr>
              <th>Cotización</th>
              <th>Vendedor</th>
              <th>Trimestre</th>
              <th>Estado</th>
              <th>Moneda / TC</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`invalid-${item.quarter}-${item.quotationId}`}>
                <td>
                  <Link to={quotationLink(item.quotationId)}>{item.proposalName}</Link>
                  <div className="field-hint">#{item.quotationId}</div>
                </td>
                <td>{item.sellerUserName}</td>
                <td>T{item.quarter}</td>
                <td>{item.statusCode === "ganada" ? "Ganada" : "Aceptada"}</td>
                <td>{item.quotationCurrencyCode} · {item.exchangeRate ?? "sin TC"}</td>
                <td>{item.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProgressBar({ pct }) {
  const value = Number(pct || 0);
  return (
    <div className="commission-progress" role="img" aria-label={`Cumplimiento ${formatPct(value)}`}>
      <div className="commission-progress-fill" style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }} />
      <div className="commission-progress-mark" style={{ left: `${COMMISSION_MIN_QUOTA_ATTAINMENT_PCT}%` }} />
    </div>
  );
}

function SummaryCard({ label, value, hint, tone }) {
  return (
    <div className={`commission-summary-card${tone ? ` is-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function PendingQuotationsCard({ items, currencyCode, showSeller }) {
  if (!items.length) return null;
  const total = items.reduce((sum, item) => sum + Number(item.totalSaleAmount || 0), 0);
  return (
    <section className="commercial-planning-card commission-pending-card">
      <div className="commercial-planning-card-header">
        <div>
          <h3>Pendientes de aceptar</h3>
          <p>
            {items.length} cotización(es) ganada(s) por {formatMoney(total, currencyCode)}. No suman a la
            venta, al cumplimiento ni a la comisión hasta que el aceptador las apruebe.
          </p>
        </div>
      </div>
      <div className="commercial-planning-table-wrap">
        <table className="commercial-planning-table">
          <thead>
            <tr>
              <th>Cotización</th>
              {showSeller ? <th>Vendedor</th> : null}
              <th>Trimestre</th>
              <th>Fecha ganada</th>
              <th>Cuenta</th>
              <th>Venta</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`pending-${item.quarter}-${item.quotationId}`}>
                <td>
                  <Link to={quotationLink(item.quotationId)}>{item.proposalName}</Link>
                  <div className="field-hint">#{item.quotationId}</div>
                </td>
                {showSeller ? <td>{item.sellerUserName}</td> : null}
                <td>T{item.quarter}</td>
                <td>{formatDate(item.wonAt)}</td>
                <td>{item.accountName}</td>
                <td>{formatMoney(item.totalSaleAmount, currencyCode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SellerDetail({ summary, currencyCode }) {
  const rows = COMMISSION_CATEGORIES.map((category) => {
    const prefix = category.key === "products" ? "Product" : category.key === "services" ? "Service" : "Renewal";
    return {
      key: category.key,
      label: category.label,
      contribution: Number(summary[`eligible${prefix}ContributionAmount`] || 0),
      rate: Number(summary[category.rateField] || 0),
      amount: Number(summary[`calculated${prefix}CommissionAmount`] || 0),
    };
  });
  return (
    <div className="commission-seller-detail">
      <table className="commercial-planning-table commission-category-table">
        <thead>
          <tr>
            <th>Categoría</th>
            <th>Contribución elegible</th>
            <th>% comisión</th>
            <th>Comisión</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td>{formatMoney(row.contribution, currencyCode)}</td>
              <td>{row.rate}%</td>
              <td>{formatMoney(row.amount, currencyCode)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="commercial-planning-table-wrap">
        <table className="commercial-planning-table commercial-planning-commission-detail-table">
          <thead>
            <tr>
              <th>Cotización</th>
              <th>Fecha ganada</th>
              <th>Cuenta</th>
              <th>Venta</th>
              <th>Margen</th>
              <th>Estado</th>
              <th>Comisión</th>
            </tr>
          </thead>
          <tbody>
            {(summary.quotations || []).map((quotation) => (
              <tr key={`quotation-${summary.sellerUserId}-${quotation.quotationId}`}>
                <td>
                  <Link to={quotationLink(quotation.quotationId)}>{quotation.proposalName}</Link>
                  <div className="field-hint">#{quotation.quotationId}</div>
                </td>
                <td>{formatDate(quotation.wonAt)}</td>
                <td>
                  {quotation.accountName}
                  {quotation.opportunityName ? <div className="field-hint">{quotation.opportunityName}</div> : null}
                </td>
                <td>
                  {formatMoney(quotation.totalSaleAmount, currencyCode)}
                  {Number(quotation.discountAmount || 0) > 0 ? (
                    <div className="field-hint">Con descuento de {formatMoney(quotation.discountAmount, currencyCode)}</div>
                  ) : null}
                </td>
                <td>{formatPct(quotation.quotationMarginPct)}</td>
                <td>
                  <span className={quotation.passesMarginRule && quotation.sellerPassesQuotaRule ? "commission-status-ok" : "commission-status-blocked"}>
                    {describeCommissionBlock({
                      passesMarginRule: quotation.passesMarginRule,
                      sellerPassesQuotaRule: quotation.sellerPassesQuotaRule,
                      marginPct: quotation.quotationMarginPct,
                      quotaAttainmentPct: summary.quotaAttainmentPct,
                    })}
                  </span>
                </td>
                <td>{formatMoney(quotationCommission(quotation), currencyCode)}</td>
              </tr>
            ))}
            {!(summary.quotations || []).length ? (
              <tr><td colSpan="7" className="centered">Sin cotizaciones aceptadas en el trimestre.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

async function exportTrackingToExcel({ year, model, currencyCode, sellerRows, totalLabel }) {
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  const sheet = (rows) => XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);

  const visibleSellerIds = new Set(sellerRows.map(({ seller }) => seller.id));
  const yearRows = sellerRows.map(({ seller }) => {
    const row = { Vendedor: seller.name, Correo: seller.email || "" };
    let total = 0;
    let sales = 0;
    let contribution = 0;
    QUARTERS.forEach((quarter) => {
      const summary = model.byQuarter.get(quarter)?.summaries.get(seller.id);
      row[`Comisión T${quarter}`] = sumCommission(summary);
      row[`Venta T${quarter}`] = Number(summary?.acceptedSalesAmount || 0);
      total += sumCommission(summary);
      sales += Number(summary?.acceptedSalesAmount || 0);
      contribution += sumContribution(summary);
    });
    row["Comisión total"] = total;
    row["Venta aceptada"] = sales;
    row["Contribución"] = contribution;
    return row;
  });
  const totalRow = { Vendedor: totalLabel, Correo: "" };
  const numericColumns = [
    ...QUARTERS.flatMap((quarter) => [`Comisión T${quarter}`, `Venta T${quarter}`]),
    "Comisión total",
    "Venta aceptada",
    "Contribución",
  ];
  numericColumns.forEach((column) => {
    totalRow[column] = yearRows.reduce((sum, row) => sum + row[column], 0);
  });
  yearRows.push(totalRow);
  XLSX.utils.book_append_sheet(book, sheet(yearRows), "Resumen anual");

  const quarterRows = [];
  const quotationRows = [];
  QUARTERS.forEach((quarter) => {
    model.byQuarter.get(quarter)?.summaries.forEach((summary) => {
      if (!visibleSellerIds.has(summary.sellerUserId)) return;
      const status = describeSellerCommissionStatus(summary, (value) => formatMoney(value, currencyCode));
      quarterRows.push({
        Trimestre: `T${quarter}`,
        Vendedor: summary.sellerUserName,
        Cuota: summary.salesQuotaAmount,
        "Venta aceptada": summary.acceptedSalesAmount,
        "Cumplimiento (%)": summary.quotaAttainmentPct,
        Habilitado: summary.commissionEnabled ? "Sí" : "No",
        Estado: status.label,
        "Cotizaciones elegibles": summary.eligibleQuotationCount,
        "Bloqueadas por margen": summary.blockedLowMarginQuotationCount,
        "Comisión productos": summary.calculatedProductCommissionAmount,
        "Comisión servicios": summary.calculatedServiceCommissionAmount,
        "Comisión renovaciones": summary.calculatedRenewalCommissionAmount,
        "Comisión total": summary.calculatedTotalCommissionAmount,
      });
      (summary.quotations || []).forEach((quotation) => {
        quotationRows.push({
          Trimestre: `T${quarter}`,
          Vendedor: summary.sellerUserName,
          Cotización: quotation.quotationId,
          Propuesta: quotation.proposalName,
          Cuenta: quotation.accountName,
          "Fecha ganada": quotation.wonAt ? new Date(quotation.wonAt).toISOString().slice(0, 10) : "",
          Venta: quotation.totalSaleAmount,
          "Margen (%)": quotation.quotationMarginPct,
          Estado: describeCommissionBlock({
            passesMarginRule: quotation.passesMarginRule,
            sellerPassesQuotaRule: quotation.sellerPassesQuotaRule,
            marginPct: quotation.quotationMarginPct,
            quotaAttainmentPct: summary.quotaAttainmentPct,
          }),
          Comisión: quotationCommission(quotation),
        });
      });
    });
  });
  XLSX.utils.book_append_sheet(book, sheet(quarterRows), "Por trimestre");
  XLSX.utils.book_append_sheet(book, sheet(quotationRows), "Cotizaciones aceptadas");
  XLSX.utils.book_append_sheet(book, sheet(model.pending.filter((item) => visibleSellerIds.has(item.sellerUserId)).map((item) => ({
    Trimestre: `T${item.quarter}`,
    Vendedor: item.sellerUserName,
    Cotización: item.quotationId,
    Propuesta: item.proposalName,
    Cuenta: item.accountName,
    "Fecha ganada": item.wonAt ? new Date(item.wonAt).toISOString().slice(0, 10) : "",
    Venta: item.totalSaleAmount,
  }))), "Pendientes de aceptar");
  XLSX.utils.book_append_sheet(book, sheet(model.invalid.filter((item) => visibleSellerIds.has(item.sellerUserId)).map((item) => ({
    Trimestre: `T${item.quarter}`,
    Vendedor: item.sellerUserName,
    Cotización: item.quotationId,
    Propuesta: item.proposalName,
    Estado: item.statusCode,
    Moneda: item.quotationCurrencyCode,
    "Tipo de cambio": item.exchangeRate ?? "",
    Motivo: item.reason,
  }))), "Sin convertir");
  XLSX.writeFile(book, `comisiones-seguimiento-${year}.xlsx`);
}

export default function CommissionTrackingView({ year, quarters }) {
  const [view, setView] = useState("year");
  const [sellerFilter, setSellerFilter] = useState("all");
  const [onlyActive, setOnlyActive] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [exporting, setExporting] = useState(false);

  const model = useMemo(() => buildTrackingModel(quarters), [quarters]);
  const currencyCode = quarters?.[0]?.tracking?.baseCurrencyCode || "USD";
  const scopeQuarters = view === "year" ? QUARTERS : [view];
  const inScope = (sellerId) => sellerFilter === "all" || String(sellerId) === sellerFilter;

  const pendingByKey = (quarter, sellerId) =>
    model.pending.filter((item) => item.quarter === quarter && item.sellerUserId === sellerId).length;

  const sellerRows = model.sellers
    .filter((seller) => inScope(seller.id))
    .map((seller) => {
      const perQuarter = QUARTERS.map((quarter) => model.byQuarter.get(quarter)?.summaries.get(seller.id) || null);
      const scoped = scopeQuarters.map((quarter) => model.byQuarter.get(quarter)?.summaries.get(seller.id) || null);
      const commission = scoped.reduce((sum, summary) => sum + sumCommission(summary), 0);
      const sales = scoped.reduce((sum, summary) => sum + Number(summary?.acceptedSalesAmount || 0), 0);
      const quota = scoped.reduce((sum, summary) => sum + Number(summary?.salesQuotaAmount || 0), 0);
      const contribution = scoped.reduce((sum, summary) => sum + sumContribution(summary), 0);
      const active = scopeQuarters.some((quarter) =>
        isSellerActive(model.byQuarter.get(quarter)?.summaries.get(seller.id) || {}, pendingByKey(quarter, seller.id)),
      );
      return { seller, perQuarter, scoped, commission, sales, quota, contribution, active };
    })
    .filter((row) => !onlyActive || row.active)
    .sort((left, right) =>
      Number(right.active) - Number(left.active) ||
      right.commission - left.commission ||
      right.sales - left.sales ||
      String(left.seller.name || "").localeCompare(String(right.seller.name || ""), "es"));

  const pendingInScope = model.pending.filter((item) => scopeQuarters.includes(item.quarter) && inScope(item.sellerUserId));
  const invalidInScope = model.invalid.filter((item) => scopeQuarters.includes(item.quarter) && inScope(item.sellerUserId));
  const totals = sellerRows.reduce((acc, row) => {
    row.scoped.forEach((summary) => {
      acc.contribution += sumEligibleContribution(summary);
    });
    acc.totalContribution += row.contribution;
    acc.commission += row.commission;
    acc.sales += row.sales;
    acc.quota += row.quota;
    if (row.scoped.some((summary) => summary?.commissionEnabled)) acc.enabled += 1;
    return acc;
  }, { commission: 0, sales: 0, quota: 0, contribution: 0, totalContribution: 0, enabled: 0 });
  const pendingTotal = pendingInScope.reduce((sum, item) => sum + Number(item.totalSaleAmount || 0), 0);
  const money = (value) => formatMoney(value, currencyCode);
  const totalLabel = sellerFilter !== "all" || onlyActive ? "Total mostrado" : "Total";
  const quarterTotals = QUARTERS.map((_, index) => sellerRows.reduce((acc, row) => {
    acc.commission += sumCommission(row.perQuarter[index]);
    acc.sales += Number(row.perQuarter[index]?.acceptedSalesAmount || 0);
    return acc;
  }, { commission: 0, sales: 0 }));

  function toggleExpanded(sellerId) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(sellerId)) next.delete(sellerId);
      else next.add(sellerId);
      return next;
    });
  }

  async function handleExport() {
    setExporting(true);
    try {
      await exportTrackingToExcel({ year, model, currencyCode, sellerRows, totalLabel });
    } finally {
      setExporting(false);
    }
  }

  const scopeLabel = view === "year" ? `Año ${year}` : `T${view} ${year}`;

  return (
    <div className="commercial-planning-section-stack">
      <div className="commission-tracking-controls">
        <div className="commission-tracking-tabs" role="group" aria-label="Periodo del seguimiento">
          {["year", ...QUARTERS].map((option) => (
            <button
              key={option}
              type="button"
              className={view === option ? "is-active" : ""}
              aria-pressed={view === option}
              onClick={() => setView(option)}
            >
              {option === "year" ? "Año completo" : `T${option}`}
            </button>
          ))}
        </div>
        <label>
          Vendedor
          <select value={sellerFilter} onChange={(event) => setSellerFilter(event.target.value)}>
            <option value="all">Todos</option>
            {model.sellers.map((seller) => (
              <option key={seller.id} value={String(seller.id)}>{seller.name}</option>
            ))}
          </select>
        </label>
        <label className="commission-tracking-check">
          <input type="checkbox" checked={onlyActive} onChange={(event) => setOnlyActive(event.target.checked)} />
          Solo con actividad
        </label>
        <button type="button" className="btn-secondary" onClick={handleExport} disabled={exporting}>
          {exporting ? "Exportando..." : "Exportar a Excel"}
        </button>
      </div>

      <div className="commission-summary-grid" aria-label={`Resumen ${scopeLabel}`}>
        <SummaryCard label="Comisión a pagar" value={money(totals.commission)} hint={scopeLabel} tone="primary" />
        <SummaryCard
          label="Venta aceptada / cuota"
          value={`${money(totals.sales)} / ${money(totals.quota)}`}
          hint={totals.quota > 0 ? `${formatPct((totals.sales / totals.quota) * 100)} de cumplimiento` : "Sin cuota definida"}
        />
        <SummaryCard
          label="Vendedores habilitados"
          value={`${totals.enabled} de ${sellerRows.length}`}
          hint={`Cumplen ${COMMISSION_MIN_QUOTA_ATTAINMENT_PCT}% de cuota`}
        />
        <SummaryCard label="Contribución elegible" value={money(totals.contribution)} />
        <SummaryCard
          label="Por aceptar"
          value={`${pendingInScope.length} · ${money(pendingTotal)}`}
          hint={pendingInScope.length ? "Ganadas sin aceptar; no suman" : "Nada pendiente"}
          tone={pendingInScope.length ? "warn" : undefined}
        />
        {invalidInScope.length ? (
          <SummaryCard
            label="Sin convertir"
            value={String(invalidInScope.length)}
            hint="Moneda o tipo de cambio inválido; no suman"
            tone="warn"
          />
        ) : null}
      </div>

      {view === "year" ? (
        <section className="commercial-planning-card">
          <div className="commercial-planning-card-header">
            <div>
              <h3>Comisiones por trimestre · {year}</h3>
              <p>Selecciona un trimestre para ver cumplimiento, categorías y cotizaciones.</p>
            </div>
          </div>
          <div className="commercial-planning-table-wrap">
            <table className="commercial-planning-table commission-year-table">
              <thead>
                <tr>
                  <th>Vendedor</th>
                  {QUARTERS.map((quarter) => (
                    <th key={quarter}>
                      <button type="button" className="commission-link-button" onClick={() => setView(quarter)}>
                        T{quarter}
                      </button>
                    </th>
                  ))}
                  <th>Total comisión</th>
                  <th>Venta aceptada</th>
                  <th>Contribución</th>
                </tr>
              </thead>
              <tbody>
                {sellerRows.map((row) => (
                  <tr key={`year-${row.seller.id}`}>
                    <td>
                      <strong>{row.seller.name}</strong>
                      <div className="field-hint">{row.seller.email}</div>
                    </td>
                    {row.perQuarter.map((summary, index) => (
                      <td key={QUARTERS[index]}>
                        {formatMoney(sumCommission(summary), currencyCode)}
                        {summary && Number(summary.salesQuotaAmount || 0) > 0 ? (
                          <div className={`field-hint ${summary.commissionEnabled ? "commission-status-ok" : ""}`}>
                            {formatPct(summary.quotaAttainmentPct)} cumpl.
                          </div>
                        ) : (
                          <div className="field-hint">Sin cuota</div>
                        )}
                        <CompactSale value={summary?.acceptedSalesAmount} currencyCode={currencyCode} />
                      </td>
                    ))}
                    <td><strong>{money(row.commission)}</strong></td>
                    <td>{money(row.sales)}</td>
                    <td>{money(row.contribution)}</td>
                  </tr>
                ))}
                {!sellerRows.length ? (
                  <tr><td colSpan="8" className="centered">No hay vendedores para mostrar.</td></tr>
                ) : null}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{totalLabel}</th>
                  {quarterTotals.map((total, index) => (
                    <td key={QUARTERS[index]}>
                      <strong>{money(total.commission)}</strong>
                      <CompactSale value={total.sales} currencyCode={currencyCode} />
                    </td>
                  ))}
                  <td><strong>{money(totals.commission)}</strong></td>
                  <td>{money(totals.sales)}</td>
                  <td>{money(totals.totalContribution)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ) : (
        <section className="commercial-planning-card">
          <div className="commercial-planning-card-header">
            <div>
              <h3>T{view} {year}</h3>
              <p>Haz clic en un vendedor para ver su desglose por categoría y cotización.</p>
            </div>
          </div>
          <div className="commercial-planning-table-wrap">
            <table className="commercial-planning-table commission-quarter-table">
              <thead>
                <tr>
                  <th>Vendedor</th>
                  <th>Cumplimiento</th>
                  <th>Estado</th>
                  <th>Venta / Cuota</th>
                  <th>Contribución</th>
                  <th>Comisión</th>
                </tr>
              </thead>
              <tbody>
                {sellerRows.map((row) => {
                  const summary = row.scoped[0];
                  const isOpen = expanded.has(row.seller.id);
                  const status = summary
                    ? describeSellerCommissionStatus(summary, money)
                    : { tone: "muted", label: "Sin datos" };
                  return (
                    <Fragment key={`quarter-${row.seller.id}`}>
                      <tr className={row.active ? "" : "commission-row-inactive"}>
                        <td>
                          <button
                            type="button"
                            className="commission-seller-toggle"
                            aria-expanded={isOpen}
                            onClick={() => toggleExpanded(row.seller.id)}
                          >
                            <span aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                            <strong>{row.seller.name}</strong>
                          </button>
                          <div className="field-hint">{row.seller.email}</div>
                        </td>
                        <td>
                          {Number(summary?.salesQuotaAmount || 0) > 0 ? (
                            <>
                              <ProgressBar pct={summary.quotaAttainmentPct} />
                              <div className="field-hint">{formatPct(summary.quotaAttainmentPct)}</div>
                            </>
                          ) : (
                            <span className="field-hint">—</span>
                          )}
                        </td>
                        <td><span className={`commission-pill is-${status.tone}`}>{status.label}</span></td>
                        <td>
                          {money(row.sales)} / {row.quota > 0 ? money(row.quota) : "—"}
                        </td>
                        <td>{money(row.contribution)}</td>
                        <td><strong>{money(row.commission)}</strong></td>
                      </tr>
                      {isOpen && summary ? (
                        <tr className="commission-detail-row">
                          <td colSpan="6">
                            <SellerDetail summary={summary} currencyCode={currencyCode} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
                {!sellerRows.length ? (
                  <tr><td colSpan="6" className="centered">No hay vendedores para mostrar.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <PendingQuotationsCard items={pendingInScope} currencyCode={currencyCode} showSeller />
      <InvalidQuotationsCard items={invalidInScope} />
    </div>
  );
}
