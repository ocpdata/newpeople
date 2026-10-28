import { useEffect, useMemo, useState } from "react";
import { COMMISSION_MIN_QUOTA_ATTAINMENT_PCT } from "./commissionRules";
import {
  QUARTER_NUMBERS,
  cleanClipboardNumber,
  collectChangedKeys,
  collectTargetAlerts,
  draftContribution,
  fetchYearResults,
  mergeAnnualTargetDrafts,
  parseClipboardGrid,
  sellerYearCells,
  splitAnnualQuota,
  sumResultCells,
  toNumber,
} from "./annualTargetsModel";
import {
  formatAmount,
  formatGroupedDecimalInput,
  formatPercent,
  normalizeDecimalInput,
  withCurrentCatalogOption,
} from "./planningFormat";

const MIN_PLANNING_YEAR = 2020;
const MAX_VISIBLE_ALERTS = 8;
const EDITABLE_COLUMNS = QUARTER_NUMBERS.length * 2;
const FIELD_BY_COLUMN = ["salesQuotaAmount", "expectedMarginPercent"];

function percentOf(value, base) {
  return base > 0 ? (value / base) * 100 : null;
}

function formatVariation(current, previous) {
  if (!(previous > 0)) return "—";
  const variation = ((current - previous) / previous) * 100;
  return `${variation > 0 ? "+" : ""}${variation.toFixed(1)}%`;
}

function SummaryCard({ label, value, hint }) {
  return (
    <div className="commission-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function AttainmentBar({ pct }) {
  return (
    <div className="commission-progress" role="img" aria-label={`Cumplimiento ${pct.toFixed(1)}%`}>
      <div className="commission-progress-fill" style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }} />
      <div className="commission-progress-mark" style={{ left: `${COMMISSION_MIN_QUOTA_ATTAINMENT_PCT}%` }} />
    </div>
  );
}

function QuarterProgressCell({ cell }) {
  const pct = percentOf(cell.sales, cell.quota);
  return (
    <td>
      <div>{formatAmount(cell.sales)} / {cell.quota > 0 ? formatAmount(cell.quota) : "—"}</div>
      {pct === null ? (
        <div className="field-hint">Sin cuota</div>
      ) : (
        <>
          <AttainmentBar pct={pct} />
          <div className={`field-hint ${pct >= COMMISSION_MIN_QUOTA_ATTAINMENT_PCT ? "commission-status-ok" : ""}`}>
            {pct.toFixed(1)}% · mín. {formatAmount((cell.quota * COMMISSION_MIN_QUOTA_ATTAINMENT_PCT) / 100)}
          </div>
        </>
      )}
    </td>
  );
}

export default function AnnualTargetsView({
  year,
  onYearChange,
  plan,
  drafts,
  setDrafts,
  currencyCode,
  onCurrencyChange,
  currencies,
  loading,
  canEdit,
  canSave,
  saving,
  onSave,
}) {
  const [results, setResults] = useState(null);
  const [priorResults, setPriorResults] = useState(null);
  const [notice, setNotice] = useState(null);
  const [distSeller, setDistSeller] = useState("all");
  const [distAnnual, setDistAnnual] = useState("");
  const [distMode, setDistMode] = useState("even");
  const [distPercentages, setDistPercentages] = useState(["25", "25", "25", "25"]);
  const [copyFrom, setCopyFrom] = useState("1");
  const [copyTo, setCopyTo] = useState("all");
  const [marginValue, setMarginValue] = useState("");
  const [marginQuarter, setMarginQuarter] = useState("all");

  const baseline = useMemo(() => mergeAnnualTargetDrafts(plan), [plan]);
  const changedKeys = useMemo(() => collectChangedKeys(drafts, baseline), [drafts, baseline]);
  const currencyChanged = Boolean(plan) && currencyCode !== (plan.currencyCode || "USD");
  const changeCount = changedKeys.size + (currencyChanged ? 1 : 0);
  const dirty = changeCount > 0;

  const rows = useMemo(() => drafts[0]?.sellers || [], [drafts]);
  const draftIndex = useMemo(() => {
    const index = new Map();
    drafts.forEach((quarter) => quarter.sellers.forEach((seller) => {
      index.set(`${quarter.quarter}:${seller.sellerUserId}`, seller);
    }));
    return index;
  }, [drafts]);
  const alerts = useMemo(() => collectTargetAlerts(drafts), [drafts]);

  const today = new Date();
  const currentQuarter = year === today.getFullYear() ? Math.floor(today.getMonth() / 3) + 1 : null;
  const yearOptions = useMemo(() => {
    const thisYear = new Date().getFullYear();
    const years = new Set([year]);
    for (let candidate = thisYear - 3; candidate <= thisYear + 5; candidate += 1) {
      if (candidate >= MIN_PLANNING_YEAR) years.add(candidate);
    }
    return [...years].sort((left, right) => left - right);
  }, [year]);

  useEffect(() => {
    if (!plan || plan.year !== year) return undefined;
    let cancelled = false;
    fetchYearResults(year, plan)
      .then((value) => { if (!cancelled) setResults(value); })
      .catch(() => { if (!cancelled) setResults(null); });
    return () => { cancelled = true; };
  }, [plan, year]);

  useEffect(() => {
    if (year - 1 < MIN_PLANNING_YEAR) return undefined;
    let cancelled = false;
    fetchYearResults(year - 1)
      .then((value) => { if (!cancelled) setPriorResults(value); })
      .catch(() => { if (!cancelled) setPriorResults(null); });
    return () => { cancelled = true; };
  }, [year]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty]);

  const currentResults = results?.year === year ? results : null;
  const previousResults = priorResults?.year === year - 1 ? priorResults : null;

  function patchDrafts(transform) {
    setDrafts((current) => current.map((quarter) => ({
      ...quarter,
      sellers: quarter.sellers.map((seller) => {
        const patch = transform(quarter.quarter, seller);
        return patch ? { ...seller, ...patch } : seller;
      }),
    })));
  }

  function updateDraft(quarter, sellerUserId, field, value) {
    patchDrafts((draftQuarter, seller) => (
      draftQuarter === quarter && seller.sellerUserId === sellerUserId ? { [field]: value } : null
    ));
  }

  function handleYearChange(event) {
    const nextYear = Number(event.target.value);
    if (dirty && !window.confirm("Tienes cambios sin guardar. Si cambias de año se perderán. ¿Continuar?")) return;
    setNotice(null);
    onYearChange(nextYear);
  }

  function handleDiscard() {
    setDrafts(mergeAnnualTargetDrafts(plan));
    onCurrencyChange(plan?.currencyCode || "USD");
    setNotice({ tone: "ok", text: "Se descartaron los cambios sin guardar." });
  }

  function handleDistribute() {
    const total = toNumber(distAnnual);
    if (!normalizeDecimalInput(distAnnual) || total < 0) {
      setNotice({ tone: "error", text: "Captura una cuota anual válida para distribuir." });
      return;
    }
    const percentages = distMode === "even" ? [25, 25, 25, 25] : distPercentages.map(toNumber);
    const percentageTotal = percentages.reduce((sum, value) => sum + value, 0);
    if (percentages.some((value) => value < 0) || Math.abs(percentageTotal - 100) > 0.01) {
      setNotice({ tone: "error", text: `Los porcentajes deben sumar 100% (suman ${percentageTotal.toFixed(2)}%).` });
      return;
    }
    const amounts = splitAnnualQuota(total, percentages);
    patchDrafts((quarter, seller) => (
      distSeller === "all" || String(seller.sellerUserId) === distSeller
        ? { salesQuotaAmount: amounts[quarter - 1] }
        : null
    ));
    const scope = distSeller === "all" ? "todos los vendedores" : rows.find((seller) => String(seller.sellerUserId) === distSeller)?.sellerUserName;
    setNotice({ tone: "ok", text: `Cuota anual distribuida para ${scope}. Revisa y guarda para aplicar.` });
  }

  function handleCopyQuarter() {
    if (copyTo === copyFrom) {
      setNotice({ tone: "error", text: "Elige un trimestre destino distinto al de origen." });
      return;
    }
    const sourceQuarter = Number(copyFrom);
    const targetQuarters = copyTo === "all"
      ? QUARTER_NUMBERS.filter((quarter) => quarter !== sourceQuarter)
      : [Number(copyTo)];
    patchDrafts((quarter, seller) => {
      if (!targetQuarters.includes(quarter)) return null;
      const source = draftIndex.get(`${sourceQuarter}:${seller.sellerUserId}`);
      return source
        ? { salesQuotaAmount: source.salesQuotaAmount, expectedMarginPercent: source.expectedMarginPercent }
        : null;
    });
    setNotice({
      tone: "ok",
      text: `T${sourceQuarter} copiado a ${targetQuarters.map((quarter) => `T${quarter}`).join(", ")}. Revisa y guarda para aplicar.`,
    });
  }

  function handleApplyMargin() {
    const normalized = normalizeDecimalInput(marginValue);
    const margin = Number(normalized);
    if (!normalized || !Number.isFinite(margin) || margin < 0) {
      setNotice({ tone: "error", text: "Captura un margen válido (mayor o igual a cero)." });
      return;
    }
    let applied = 0;
    patchDrafts((quarter, seller) => {
      const inScope = marginQuarter === "all" || Number(marginQuarter) === quarter;
      if (!inScope || String(seller.salesQuotaAmount).trim() === "") return null;
      applied += 1;
      return { expectedMarginPercent: normalized };
    });
    setNotice({
      tone: "ok",
      text: applied
        ? `Margen de ${margin}% aplicado a las filas con cuota. Revisa y guarda para aplicar.`
        : "No hay filas con cuota en el alcance elegido; captura o distribuye cuotas primero.",
    });
  }

  function handlePaste(event, rowIndex, columnIndex) {
    const text = event.clipboardData?.getData("text") || "";
    if (!/[\t\n]/.test(text.replace(/[\r\n]+$/, ""))) return;
    event.preventDefault();

    const updates = new Map();
    let skipped = 0;
    parseClipboardGrid(text).forEach((cells, rowOffset) => cells.forEach((cell, columnOffset) => {
      const row = rows[rowIndex + rowOffset];
      const column = columnIndex + columnOffset;
      const value = cleanClipboardNumber(cell);
      if (!row || column >= EDITABLE_COLUMNS || value === null) {
        skipped += 1;
        return;
      }
      const quarter = Math.floor(column / 2) + 1;
      updates.set(`${quarter}:${row.sellerUserId}:${FIELD_BY_COLUMN[column % 2]}`, value);
    }));

    patchDrafts((quarter, seller) => {
      const patch = {};
      FIELD_BY_COLUMN.forEach((field) => {
        const key = `${quarter}:${seller.sellerUserId}:${field}`;
        if (updates.has(key)) patch[field] = updates.get(key);
      });
      return Object.keys(patch).length ? patch : null;
    });
    setNotice({
      tone: skipped ? "warn" : "ok",
      text: `Se pegaron ${updates.size} celdas${skipped ? ` (${skipped} omitidas por estar fuera de la tabla o no ser numéricas)` : ""}.`,
    });
  }

  const quarterTotals = QUARTER_NUMBERS.map((quarter) => rows.reduce((acc, row) => {
    const draft = draftIndex.get(`${quarter}:${row.sellerUserId}`);
    acc.quota += toNumber(draft?.salesQuotaAmount);
    acc.contribution += draftContribution(draft);
    return acc;
  }, { quota: 0, contribution: 0 }));
  const annualQuota = quarterTotals.reduce((sum, total) => sum + total.quota, 0);
  const annualContribution = quarterTotals.reduce((sum, total) => sum + total.contribution, 0);
  const annualMargin = percentOf(annualContribution, annualQuota);

  const resultCellsBySeller = new Map(rows.map((row) => [row.sellerUserId, sellerYearCells(currentResults, row.sellerUserId)]));
  const resultTotals = sumResultCells([...resultCellsBySeller.values()].flat());
  const quarterResultTotals = QUARTER_NUMBERS.map((_, index) => sumResultCells(
    [...resultCellsBySeller.values()].map((cells) => cells[index]),
  ));
  const salesAttainment = percentOf(resultTotals.sales, resultTotals.quota);
  const contributionAttainment = percentOf(resultTotals.contribution, resultTotals.expectedContribution);

  const priorCellsBySeller = new Map(rows.map((row) => [row.sellerUserId, sumResultCells(sellerYearCells(previousResults, row.sellerUserId))]));
  const priorTotals = sumResultCells([...priorCellsBySeller.values()]);
  const hasPriorData = priorTotals.quota > 0 || priorTotals.sales > 0;
  const annualQuotaBySeller = new Map(rows.map((row) => [
    row.sellerUserId,
    QUARTER_NUMBERS.reduce((sum, quarter) => sum + toNumber(draftIndex.get(`${quarter}:${row.sellerUserId}`)?.salesQuotaAmount), 0),
  ]));

  const editingDisabled = !canEdit || saving;

  return (
    <div className="commercial-planning-annual">
      <header className="commercial-planning-annual-header">
        <div>
          <h3>Metas anuales</h3>
          <p>
            Montos en {currencyCode}. Los cambios quedan vigentes al guardar.
            {dirty ? (
              <span className="targets-dirty-pill"> {changeCount} cambio(s) sin guardar</span>
            ) : null}
          </p>
        </div>
        <div className="commercial-planning-annual-controls">
          <label>
            Año
            <select aria-label="Año de metas" value={year} onChange={handleYearChange}>
              {yearOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label>
            Moneda anual
            <select
              aria-label="Moneda anual"
              value={currencyCode}
              onChange={(event) => onCurrencyChange(event.target.value)}
              disabled={!canEdit || saving || Boolean(plan?.currencyLocked)}
            >
              {withCurrentCatalogOption(currencies, currencyCode).map((currency) => (
                <option key={currency.id || currency.code} value={currency.code}>
                  {currency.code}{currency.name ? ` - ${currency.name}` : ""}
                </option>
              ))}
            </select>
            {plan?.currencyLocked ? (
              <small className="field-hint">
                Las cuotas del año están en {plan.currencyCode}. Para cambiarla, borra primero todas las cuotas del año.
              </small>
            ) : null}
          </label>
          {canSave ? (
            <>
              <button type="button" className="btn-secondary" onClick={handleDiscard} disabled={!dirty || saving}>
                Descartar cambios
              </button>
              <button type="button" className="btn-primary" onClick={onSave} disabled={saving || !canEdit || loading}>
                {saving ? "Guardando..." : "Guardar metas"}
              </button>
            </>
          ) : null}
        </div>
      </header>

      {loading ? (
        <div className="field-hint">Cargando metas de {year}...</div>
      ) : (
        <>
          <div className="commission-summary-grid" aria-label={`Resumen de metas ${year}`}>
            <SummaryCard
              label="Cuota anual del equipo"
              value={formatAmount(annualQuota)}
              hint={`${rows.filter((row) => annualQuotaBySeller.get(row.sellerUserId) > 0).length} de ${rows.length} vendedores con cuota`}
            />
            <SummaryCard
              label="Contribución esperada"
              value={formatAmount(annualContribution)}
              hint={`Margen ponderado ${formatPercent(annualMargin)}`}
            />
            <SummaryCard
              label="Venta aceptada real"
              value={formatAmount(resultTotals.sales)}
              hint={salesAttainment === null ? "Sin cuota guardada" : `${salesAttainment.toFixed(1)}% de la cuota guardada`}
            />
            <SummaryCard
              label="Contribución real"
              value={formatAmount(resultTotals.contribution)}
              hint={contributionAttainment === null ? "Sin contribución esperada guardada" : `${contributionAttainment.toFixed(1)}% de la esperada guardada`}
            />
          </div>

          {alerts.length ? (
            <div className="targets-alerts" role="status">
              <strong>Datos incompletos</strong>
              <ul>
                {alerts.slice(0, MAX_VISIBLE_ALERTS).map((alert) => <li key={alert}>{alert}</li>)}
              </ul>
              {alerts.length > MAX_VISIBLE_ALERTS ? (
                <small>y {alerts.length - MAX_VISIBLE_ALERTS} más.</small>
              ) : null}
            </div>
          ) : null}

          {canEdit ? (
            <details className="targets-tools" open>
              <summary>Herramientas de captura</summary>
              <div className="targets-tools-grid">
                <fieldset className="targets-tool">
                  <legend>Distribuir cuota anual</legend>
                  <label>
                    Vendedor
                    <select aria-label="Vendedor a distribuir" value={distSeller} onChange={(event) => setDistSeller(event.target.value)}>
                      <option value="all">Todos (misma cuota a cada uno)</option>
                      {rows.map((seller) => (
                        <option key={seller.sellerUserId} value={String(seller.sellerUserId)}>{seller.sellerUserName}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Cuota anual
                    <input
                      aria-label="Cuota anual a distribuir"
                      type="text"
                      inputMode="decimal"
                      value={formatGroupedDecimalInput(distAnnual)}
                      onChange={(event) => setDistAnnual(normalizeDecimalInput(event.target.value))}
                      disabled={editingDisabled}
                    />
                  </label>
                  <label>
                    Reparto
                    <select aria-label="Tipo de reparto" value={distMode} onChange={(event) => setDistMode(event.target.value)}>
                      <option value="even">Parejo (25% por trimestre)</option>
                      <option value="custom">Personalizado</option>
                    </select>
                  </label>
                  {distMode === "custom" ? (
                    <div className="targets-tool-percentages">
                      {QUARTER_NUMBERS.map((quarter, index) => (
                        <label key={quarter}>
                          T{quarter} %
                          <input
                            aria-label={`Porcentaje T${quarter}`}
                            type="number"
                            min="0"
                            step="0.01"
                            value={distPercentages[index]}
                            onChange={(event) => setDistPercentages((current) => current.map((value, position) => (position === index ? event.target.value : value)))}
                            disabled={editingDisabled}
                          />
                        </label>
                      ))}
                    </div>
                  ) : null}
                  <button type="button" className="btn-secondary" onClick={handleDistribute} disabled={editingDisabled}>Distribuir</button>
                </fieldset>

                <fieldset className="targets-tool">
                  <legend>Copiar trimestre</legend>
                  <label>
                    Origen
                    <select aria-label="Trimestre origen" value={copyFrom} onChange={(event) => setCopyFrom(event.target.value)}>
                      {QUARTER_NUMBERS.map((quarter) => <option key={quarter} value={String(quarter)}>T{quarter}</option>)}
                    </select>
                  </label>
                  <label>
                    Destino
                    <select aria-label="Trimestre destino" value={copyTo} onChange={(event) => setCopyTo(event.target.value)}>
                      <option value="all">Todos los demás</option>
                      {QUARTER_NUMBERS.map((quarter) => <option key={quarter} value={String(quarter)}>T{quarter}</option>)}
                    </select>
                  </label>
                  <small className="field-hint">Copia cuota y margen de todos los vendedores.</small>
                  <button type="button" className="btn-secondary" onClick={handleCopyQuarter} disabled={editingDisabled}>Copiar</button>
                </fieldset>

                <fieldset className="targets-tool">
                  <legend>Aplicar margen</legend>
                  <label>
                    Margen esperado (%)
                    <input
                      aria-label="Margen a aplicar"
                      type="number"
                      min="0"
                      step="0.01"
                      value={marginValue}
                      onChange={(event) => setMarginValue(event.target.value)}
                      disabled={editingDisabled}
                    />
                  </label>
                  <label>
                    Trimestre
                    <select aria-label="Trimestre del margen" value={marginQuarter} onChange={(event) => setMarginQuarter(event.target.value)}>
                      <option value="all">Todos</option>
                      {QUARTER_NUMBERS.map((quarter) => <option key={quarter} value={String(quarter)}>T{quarter}</option>)}
                    </select>
                  </label>
                  <small className="field-hint">Solo se aplica a vendedores con cuota capturada.</small>
                  <button type="button" className="btn-secondary" onClick={handleApplyMargin} disabled={editingDisabled}>Aplicar</button>
                </fieldset>
              </div>
              <small className="field-hint">
                También puedes pegar un rango copiado de Excel en cualquier celda de cuota o margen de la tabla.
              </small>
              {notice ? (
                <div className={`targets-notice is-${notice.tone}`} role="status">{notice.text}</div>
              ) : null}
            </details>
          ) : null}

          <section className="commercial-planning-quarter-panel targets-matrix">
            <div className="commercial-planning-table-wrap">
              <table className="commercial-planning-table commercial-planning-annual-target-table">
                <thead>
                  <tr>
                    <th rowSpan="2" className="targets-sticky">Vendedor</th>
                    {QUARTER_NUMBERS.map((quarter) => (
                      <th
                        key={quarter}
                        colSpan="3"
                        className={`targets-group${currentQuarter === quarter ? " is-current" : ""}`}
                      >
                        T{quarter} {year}
                        {currentQuarter === quarter ? <span className="targets-badge">En curso</span> : null}
                      </th>
                    ))}
                    <th colSpan="2" className="targets-group">Año {year}</th>
                  </tr>
                  <tr>
                    {QUARTER_NUMBERS.map((quarter) => (
                      <QuarterSubheaders key={quarter} />
                    ))}
                    <th>Cuota anual</th>
                    <th title="Cuota anual × margen esperado de cada trimestre">Contribución anual</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => {
                    const annualRowContribution = QUARTER_NUMBERS.reduce(
                      (sum, quarter) => sum + draftContribution(draftIndex.get(`${quarter}:${row.sellerUserId}`)),
                      0,
                    );
                    return (
                      <tr key={row.sellerUserId}>
                        <td className="targets-sticky">
                          <strong>{row.sellerUserName}</strong>
                          <div className="field-hint">{row.sellerEmail}</div>
                        </td>
                        {QUARTER_NUMBERS.map((quarter) => {
                          const draft = draftIndex.get(`${quarter}:${row.sellerUserId}`);
                          const quotaKey = `${quarter}:${row.sellerUserId}:salesQuotaAmount`;
                          const marginKey = `${quarter}:${row.sellerUserId}:expectedMarginPercent`;
                          const columnIndex = (quarter - 1) * 2;
                          return (
                            <TargetCells
                              key={quarter}
                              quarter={quarter}
                              sellerName={row.sellerUserName}
                              draft={draft}
                              quotaChanged={changedKeys.has(quotaKey)}
                              marginChanged={changedKeys.has(marginKey)}
                              disabled={editingDisabled}
                              onChange={(field, value) => updateDraft(quarter, row.sellerUserId, field, value)}
                              onPaste={(event, offset) => handlePaste(event, rowIndex, columnIndex + offset)}
                            />
                          );
                        })}
                        <td className="is-numeric">{formatAmount(annualQuotaBySeller.get(row.sellerUserId))}</td>
                        <td className="is-numeric">{formatAmount(annualRowContribution)}</td>
                      </tr>
                    );
                  })}
                  {!rows.length ? (
                    <tr><td colSpan="15" className="centered">No hay vendedores elegibles.</td></tr>
                  ) : null}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="targets-sticky"><strong>Total equipo</strong></td>
                    {QUARTER_NUMBERS.map((quarter, index) => (
                      <TotalCells key={quarter} total={quarterTotals[index]} />
                    ))}
                    <td className="is-numeric"><strong>{formatAmount(annualQuota)}</strong></td>
                    <td className="is-numeric"><strong>{formatAmount(annualContribution)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {rows.length ? (
            <section className="commercial-planning-annual-quota-summary">
              <h4>Avance vs. meta · {year}</h4>
              <p className="field-hint">
                Venta aceptada contra la cuota guardada. La marca roja indica el {COMMISSION_MIN_QUOTA_ATTAINMENT_PCT}% de cuota mínimo para comisión.
                {dirty ? " Tienes cambios sin guardar; el avance usa las metas guardadas." : ""}
                {currentResults ? "" : " Cargando avance..."}
              </p>
              <div className="commercial-planning-table-wrap">
                <table className="commercial-planning-table targets-progress-table">
                  <thead>
                    <tr>
                      <th className="targets-sticky">Vendedor</th>
                      {QUARTER_NUMBERS.map((quarter) => <th key={quarter}>T{quarter}</th>)}
                      <th>Anual</th>
                      <th>Contribución real / esperada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const cells = resultCellsBySeller.get(row.sellerUserId);
                      const annual = sumResultCells(cells);
                      const contributionPct = percentOf(annual.contribution, annual.expectedContribution);
                      return (
                        <tr key={`progress-${row.sellerUserId}`}>
                          <td className="targets-sticky"><strong>{row.sellerUserName}</strong></td>
                          {cells.map((cell, index) => <QuarterProgressCell key={QUARTER_NUMBERS[index]} cell={cell} />)}
                          <QuarterProgressCell cell={annual} />
                          <td>
                            <div>{formatAmount(annual.contribution)} / {formatAmount(annual.expectedContribution)}</div>
                            <div className="field-hint">
                              {contributionPct === null ? "Sin contribución esperada" : `${contributionPct.toFixed(1)}% de la esperada`}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="targets-sticky"><strong>Total equipo</strong></td>
                      {quarterResultTotals.map((cell, index) => (
                        <QuarterProgressCell key={QUARTER_NUMBERS[index]} cell={cell} />
                      ))}
                      <QuarterProgressCell cell={resultTotals} />
                      <td>
                        <div><strong>{formatAmount(resultTotals.contribution)} / {formatAmount(resultTotals.expectedContribution)}</strong></div>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          ) : null}

          {rows.length && hasPriorData ? (
            <section className="commercial-planning-annual-quota-summary">
              <h4>Referencia del año anterior · {year - 1}</h4>
              <div className="commercial-planning-table-wrap">
                <table className="commercial-planning-table targets-prior-table">
                  <thead>
                    <tr>
                      <th className="targets-sticky">Vendedor</th>
                      <th>Cuota {year - 1}</th>
                      <th>Venta aceptada {year - 1}</th>
                      <th>Cumplimiento {year - 1}</th>
                      <th>Cuota {year} (captura)</th>
                      <th>Var. vs. cuota {year - 1}</th>
                      <th>Var. vs. venta {year - 1}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const prior = priorCellsBySeller.get(row.sellerUserId);
                      const priorPct = percentOf(prior.sales, prior.quota);
                      const current = annualQuotaBySeller.get(row.sellerUserId);
                      return (
                        <tr key={`prior-${row.sellerUserId}`}>
                          <td className="targets-sticky"><strong>{row.sellerUserName}</strong></td>
                          <td className="is-numeric">{formatAmount(prior.quota)}</td>
                          <td className="is-numeric">{formatAmount(prior.sales)}</td>
                          <td className="is-numeric">{priorPct === null ? "—" : `${priorPct.toFixed(1)}%`}</td>
                          <td className="is-numeric">{formatAmount(current)}</td>
                          <td className="is-numeric">{formatVariation(current, prior.quota)}</td>
                          <td className="is-numeric">{formatVariation(current, prior.sales)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="targets-sticky"><strong>Total equipo</strong></td>
                      <td className="is-numeric"><strong>{formatAmount(priorTotals.quota)}</strong></td>
                      <td className="is-numeric"><strong>{formatAmount(priorTotals.sales)}</strong></td>
                      <td className="is-numeric">
                        <strong>{percentOf(priorTotals.sales, priorTotals.quota) === null ? "—" : `${percentOf(priorTotals.sales, priorTotals.quota).toFixed(1)}%`}</strong>
                      </td>
                      <td className="is-numeric"><strong>{formatAmount(annualQuota)}</strong></td>
                      <td className="is-numeric"><strong>{formatVariation(annualQuota, priorTotals.quota)}</strong></td>
                      <td className="is-numeric"><strong>{formatVariation(annualQuota, priorTotals.sales)}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function QuarterSubheaders() {
  return (
    <>
      <th>Cuota</th>
      <th>Margen %</th>
      <th>
        <abbr title="Contribución esperada = cuota × margen esperado">Contrib. esp.</abbr>
      </th>
    </>
  );
}

function TargetCells({ quarter, sellerName, draft, quotaChanged, marginChanged, disabled, onChange, onPaste }) {
  return (
    <>
      <td>
        <input
          aria-label={`Cuota ${sellerName} T${quarter}`}
          className={quotaChanged ? "is-changed" : undefined}
          type="text"
          inputMode="decimal"
          value={formatGroupedDecimalInput(draft?.salesQuotaAmount)}
          onChange={(event) => onChange("salesQuotaAmount", normalizeDecimalInput(event.target.value))}
          onPaste={(event) => onPaste(event, 0)}
          disabled={disabled}
        />
      </td>
      <td>
        <input
          aria-label={`Margen ${sellerName} T${quarter}`}
          className={marginChanged ? "is-changed" : undefined}
          type="number"
          min="0"
          step="0.01"
          value={draft?.expectedMarginPercent ?? ""}
          onChange={(event) => onChange("expectedMarginPercent", event.target.value)}
          onPaste={(event) => onPaste(event, 1)}
          disabled={disabled}
        />
      </td>
      <td className="is-numeric">{formatAmount(draftContribution(draft))}</td>
    </>
  );
}

function TotalCells({ total }) {
  const margin = percentOf(total.contribution, total.quota);
  return (
    <>
      <td className="is-numeric"><strong>{formatAmount(total.quota)}</strong></td>
      <td className="is-numeric"><strong>{formatPercent(margin)}</strong></td>
      <td className="is-numeric"><strong>{formatAmount(total.contribution)}</strong></td>
    </>
  );
}
