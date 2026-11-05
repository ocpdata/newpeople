import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "./api";
import { formatBusinessDateTime, getBusinessDateParts } from "./business-timezone";
import { setQuotationNavigationGuard } from "./quotations/quotationNavigationGuard";
import ConflictPanel from "./monthly-financials/ConflictPanel";
import MonthForm from "./monthly-financials/MonthForm";
import YearGrid from "./monthly-financials/YearGrid";
import {
  FIELDS, FIELD_LABELS, MONTHS, MONTH_NAMES, MONTH_SHORT, cellError, emptyMonth, formsFromRecords,
  isValidValue, monthChanged, monthFromRecord, monthTotals, parsePastedGrid, registeredCount,
} from "./monthly-financials/utils";
import "./monthly-financials.css";

const pendingMessage = "Hay cambios sin guardar. ¿Deseas salir y descartarlos?";
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;
const recordsByMonth = (list) => Object.fromEntries(list.map((record) => [record.month, record]));

function focusCell(month, field) {
  const input = document.getElementById(`financial-cell-${month}-${field}`);
  input?.focus();
  input?.select();
}

export default function MonthlyFinancialsPage({ canRead, canUpdate }) {
  const [today] = useState(() => getBusinessDateParts(new Date()));
  const [year, setYear] = useState(today.year);
  const [view, setView] = useState(() => (window.matchMedia?.("(max-width: 700px)").matches ? "month" : "year"));
  const [selectedMonth, setSelectedMonth] = useState(today.month);
  const [records, setRecords] = useState({});
  const [forms, setForms] = useState(() => formsFromRecords({}));
  const [currencyCode, setCurrencyCode] = useState("");
  const [mixedCurrencies, setMixedCurrencies] = useState(false);
  const [currencies, setCurrencies] = useState([]);
  const [catalogError, setCatalogError] = useState("");
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [conflicts, setConflicts] = useState([]);
  const [pasteMessage, setPasteMessage] = useState(null);

  const applyServerYear = useCallback((list) => {
    const byMonth = recordsByMonth(list);
    const codes = new Set(list.map((record) => record.currencyCode));
    setRecords(byMonth);
    setForms(formsFromRecords(byMonth));
    setMixedCurrencies(codes.size > 1);
    setCurrencyCode((current) => (codes.size === 1 ? [...codes][0] : codes.size > 1 ? "" : current));
  }, []);

  useEffect(() => {
    if (!canRead) return;
    let ignore = false;
    api.get("/api/monthly-financials/currencies").then(({ data }) => {
      if (ignore) return;
      setCurrencies(data);
      if (data.length === 1) setCurrencyCode((current) => current || data[0].code);
    }).catch((failure) => {
      if (!ignore) setCatalogError(getApiErrorMessage(failure, "No fue posible cargar las monedas."));
    });
    return () => { ignore = true; };
  }, [canRead, catalogRetry]);

  useEffect(() => {
    if (!canRead) return;
    let ignore = false;
    api.get(`/api/monthly-financials/${year}`).then(({ data }) => {
      if (!ignore) applyServerYear(data.records);
    }).catch((failure) => {
      if (ignore) return;
      setLoadFailed(true);
      setError(getApiErrorMessage(failure, "No fue posible cargar el año."));
    }).finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [canRead, year, retry, applyServerYear]);

  const currencyMismatch = useCallback(
    (month) => Boolean(records[month]) && currencyCode !== "" && records[month].currencyCode !== currencyCode,
    [records, currencyCode],
  );
  const dirtyMonths = useMemo(() => new Set(MONTHS.filter((month) =>
    monthChanged(forms[month], records[month]) || currencyMismatch(month))), [forms, records, currencyMismatch]);
  const dirty = dirtyMonths.size > 0;
  const conflictMonths = useMemo(() => new Set(conflicts.map((conflict) => conflict.month)), [conflicts]);
  const totalsByMonth = useMemo(
    () => Object.fromEntries(MONTHS.map((month) => [month, monthTotals(forms[month])])),
    [forms],
  );
  const errorList = useMemo(() => MONTHS.flatMap((month) => FIELDS.flatMap((key) => {
    const message = cellError(key, forms[month][key]);
    return message ? [{ month, key, message }] : [];
  })), [forms]);
  const errors = useMemo(
    () => Object.fromEntries(errorList.map(({ month, key, message }) => [`${month}-${key}`, message])),
    [errorList],
  );
  const lastChange = useMemo(() => {
    const candidates = view === "month" ? [records[selectedMonth]] : Object.values(records);
    return candidates.filter(Boolean).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0];
  }, [records, view, selectedMonth]);

  useEffect(() => {
    setQuotationNavigationGuard("monthly-financials", { active: dirty || saving, message: pendingMessage });
    const beforeUnload = (event) => {
      if (!dirty && !saving) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      setQuotationNavigationGuard("monthly-financials", { active: false });
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [dirty, saving]);

  function resetLoad() {
    setLoading(true);
    setLoadFailed(false);
    setError("");
    setSaved(false);
    setAttemptedSave(false);
    setConflicts([]);
    setPasteMessage(null);
  }

  function changeYear(next) {
    if (next < MIN_YEAR || next > MAX_YEAR || next === year) return;
    if (dirty && !window.confirm(pendingMessage)) return;
    resetLoad();
    setRecords({});
    setForms(formsFromRecords({}));
    setYear(next);
  }

  const changeCell = useCallback((month, key, value) => {
    setForms((current) => ({ ...current, [month]: { ...current[month], [key]: value } }));
    setSaved(false);
    setPasteMessage(null);
  }, []);

  const navigateCell = useCallback((month, key, delta) => {
    const next = FIELDS[FIELDS.indexOf(key) + delta];
    if (next) focusCell(month, next);
  }, []);

  const pasteCells = useCallback((month, key, text) => {
    const rows = parsePastedGrid(text);
    const firstRow = FIELDS.indexOf(key);
    const width = Math.max(...rows.map((row) => row.length));
    const monthLimit = view === "month" ? 1 : MONTHS.length - month + 1;
    if (firstRow + rows.length > FIELDS.length || width > monthLimit) {
      setPasteMessage({ type: "error", text: "El contenido pegado excede la tabla desde la celda seleccionada. No se aplicó ningún cambio." });
      return;
    }
    for (const [rowIndex, row] of rows.entries()) {
      for (const [columnIndex, value] of row.entries()) {
        const field = FIELDS[firstRow + rowIndex];
        if (value !== "" && !isValidValue(field, value)) {
          setPasteMessage({
            type: "error",
            text: `"${value}" no es válido en ${FIELD_LABELS[field]}, ${MONTH_NAMES[month + columnIndex - 1]}. No se aplicó ningún cambio.`,
          });
          return;
        }
      }
    }
    setForms((current) => {
      const next = { ...current };
      for (const [rowIndex, row] of rows.entries()) {
        for (const [columnIndex, value] of row.entries()) {
          const target = month + columnIndex;
          next[target] = { ...next[target], [FIELDS[firstRow + rowIndex]]: value };
        }
      }
      return next;
    });
    setSaved(false);
    setPasteMessage({ type: "ok", text: `Se pegaron ${rows.reduce((sum, row) => sum + row.length, 0)} celdas. Revisa los datos y guarda los cambios.` });
  }, [view]);

  const repeatRate = useCallback((key) => {
    setForms((current) => {
      const next = { ...current };
      let last = "";
      for (const month of MONTHS) {
        const value = current[month][key];
        if (value !== "") last = value;
        else if (isValidValue(key, last)) next[month] = { ...current[month], [key]: last };
      }
      return next;
    });
    setSaved(false);
    setPasteMessage(null);
  }, []);

  function goToCell(month, field) {
    setSelectedMonth(month);
    window.setTimeout(() => focusCell(month, field), 0);
  }

  async function save(event) {
    event.preventDefault();
    setAttemptedSave(true);
    if (errorList.length) {
      goToCell(errorList[0].month, errorList[0].key);
      return;
    }
    if (!currencyCode) {
      document.getElementById("financial-currency")?.focus();
      return;
    }
    const months = [...dirtyMonths].map((month) => ({
      month,
      currencyCode,
      version: records[month]?.version || 0,
      ...Object.fromEntries(FIELDS.map((key) => [key, forms[month][key] === "" ? null : forms[month][key]])),
    }));
    if (months.some(({ month }) => currencyMismatch(month)) &&
      !window.confirm("Cambiar la moneda no convierte los importes. Confirma que las cifras capturadas corresponden a la nueva moneda.")) return;
    setSaving(true);
    setError("");
    try {
      const { data } = await api.put(`/api/monthly-financials/${year}`, { months });
      applyServerYear(data.records);
      setSaved(true);
      setAttemptedSave(false);
    } catch (failure) {
      setError(getApiErrorMessage(failure, "No fue posible guardar. Tu captura se conserva; puedes reintentar."));
      if (failure.response?.status === 409 && failure.response.data?.conflicts) setConflicts(failure.response.data.conflicts);
    } finally { setSaving(false); }
  }

  function loadCurrentVersions() {
    if (!window.confirm("¿Descartar tu captura de los meses en conflicto y cargar la versión actual?")) return;
    setRecords((current) => ({ ...current, ...Object.fromEntries(conflicts.map(({ month, record }) => [month, record])) }));
    setForms((current) => ({
      ...current,
      ...Object.fromEntries(conflicts.map(({ month, record }) => [month, record ? monthFromRecord(record) : emptyMonth()])),
    }));
    setConflicts([]);
    setError("");
  }

  if (!canRead) return <p className="panel" role="alert">No tienes permiso para consultar información financiera mensual.</p>;

  const readOnly = !canUpdate || saving || conflicts.length > 0 || loadFailed;
  const cellHandlers = { onChange: changeCell, onPaste: pasteCells, onNavigate: navigateCell };
  const dirtyNames = [...dirtyMonths].map((month) => MONTH_SHORT[month - 1]).join(", ");
  const pendingInMonth = FIELDS.length - registeredCount(forms[selectedMonth]);

  return (
    <section className="dashboard-home-page monthly-financials">
      <header className="panel dashboard-home-hero">
        <div><h2>Información financiera mensual</h2><p>Captura el año completo en una sola pantalla. No hay cierres de periodos.</p></div>
      </header>
      <div className="panel monthly-financial-toolbar">
        <div className="mf-year" role="group" aria-label="Año">
          <button type="button" aria-label="Año anterior" disabled={saving || year <= MIN_YEAR} onClick={() => changeYear(year - 1)}>‹</button>
          <strong aria-live="polite">{year}</strong>
          <button type="button" aria-label="Año siguiente" disabled={saving || year >= MAX_YEAR} onClick={() => changeYear(year + 1)}>›</button>
        </div>
        <div className="mf-view" role="group" aria-label="Vista">
          <button type="button" aria-pressed={view === "year"} onClick={() => setView("year")}>Año completo</button>
          <button type="button" aria-pressed={view === "month"} onClick={() => setView("month")}>Un mes</button>
        </div>
        {view === "month" && (
          <label><span id="financial-month-label">Mes</span>
            <select aria-labelledby="financial-month-label" value={selectedMonth} onChange={(event) => setSelectedMonth(Number(event.target.value))}>
              {MONTH_NAMES.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
            </select>
          </label>
        )}
        <label><span id="financial-currency-label">Moneda del año</span>
          <select
            id="financial-currency"
            aria-labelledby="financial-currency-label"
            aria-invalid={attemptedSave && !currencyCode}
            value={currencyCode}
            disabled={!canUpdate || saving || conflicts.length > 0}
            onChange={(event) => { setCurrencyCode(event.target.value); setSaved(false); }}
          >
            <option value="">Selecciona moneda</option>
            {currencyCode && !currencies.some((item) => item.code === currencyCode) && <option value={currencyCode}>{currencyCode} (no disponible)</option>}
            {currencies.map((currency) => <option key={currency.code} value={currency.code}>{currency.code} — {currency.name}</option>)}
          </select>
          {attemptedSave && !currencyCode && <small className="monthly-financial-error">Selecciona la moneda del año.</small>}
        </label>
      </div>
      {catalogError && <div className="panel" role="alert">{catalogError} <button type="button" onClick={() => { setCatalogError(""); setCatalogRetry((value) => value + 1); }}>Recargar monedas</button></div>}
      {loading ? <p role="status">Cargando información del año…</p> : (
        <>
          {error && <div className="panel monthly-financial-error" role="alert">
            <p>{error}</p>
            {loadFailed && <button type="button" onClick={() => { resetLoad(); setRetry((value) => value + 1); }}>Reintentar carga</button>}
          </div>}
          {mixedCurrencies && !currencyCode && (
            <div className="panel monthly-financial-warning" role="alert">
              Este año tiene meses con monedas distintas, por lo que no se calculan totales anuales. Selecciona la moneda del año; los importes no se convierten.
            </div>
          )}
          {attemptedSave && errorList.length > 0 && (
            <div className="panel monthly-financial-error" role="alert">
              <p>Revisa {errorList.length} {errorList.length === 1 ? "celda" : "celdas"} antes de guardar:</p>
              <ul className="mf-error-list">
                {errorList.slice(0, 8).map(({ month, key, message }) => (
                  <li key={`${month}-${key}`}>
                    <button type="button" onClick={() => goToCell(month, key)}>{FIELD_LABELS[key]}, {MONTH_NAMES[month - 1]}</button>: {message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {pasteMessage && <div className={`panel ${pasteMessage.type === "error" ? "monthly-financial-error" : ""}`} role={pasteMessage.type === "error" ? "alert" : "status"}>{pasteMessage.text}</div>}
          {conflicts.length > 0 && <ConflictPanel conflicts={conflicts} forms={forms} currencyCode={currencyCode} onLoadCurrent={loadCurrentVersions} />}
          {!loadFailed && (
            <form onSubmit={save} noValidate>
              <p className="monthly-financial-legend">
                Vacío significa pendiente; escribe 0 para un cero confirmado. {currencyCode ? `Importes en ${currencyCode}.` : "Selecciona la moneda del año."}
                {" "}Compras no equivale a costo de ventas.{canUpdate && view === "year" ? " Puedes pegar un rango copiado desde Excel." : ""}
              </p>
              <fieldset disabled={readOnly} className="monthly-financial-form">
                {view === "year" ? (
                  <YearGrid
                    forms={forms}
                    errors={errors}
                    totalsByMonth={totalsByMonth}
                    dirtyMonths={dirtyMonths}
                    conflictMonths={conflictMonths}
                    disabled={readOnly}
                    mixedCurrencies={mixedCurrencies && !currencyCode}
                    onRepeat={repeatRate}
                    {...cellHandlers}
                  />
                ) : (
                  <MonthForm
                    month={selectedMonth}
                    form={forms[selectedMonth]}
                    totals={totalsByMonth[selectedMonth]}
                    currencyCode={currencyCode}
                    disabled={readOnly}
                    {...cellHandlers}
                  />
                )}
              </fieldset>
              <footer className="panel monthly-financial-footer">
                <div role="status">
                  <strong>{saving ? "Guardando…" : dirty ? "Hay cambios sin guardar" : saved ? "Guardado" : canUpdate ? "Listo para capturar" : "Solo consulta"}</strong>
                  {dirty && <p>Cambios en: {dirtyNames}.</p>}
                  {view === "month" && pendingInMonth > 0 && <p>Hay {pendingInMonth} campos pendientes en {MONTH_NAMES[selectedMonth - 1]}. Puedes guardar información parcial.</p>}
                  {lastChange?.updatedAt && <small>Última modificación: {formatBusinessDateTime(lastChange.updatedAt)} · {lastChange.updatedByName || "Usuario no disponible"} ({MONTH_NAMES[lastChange.month - 1]})</small>}
                </div>
                {canUpdate && <button type="submit" className="btn-primary" disabled={saving || !dirty || conflicts.length > 0 || !currencies.length || loadFailed}>Guardar cambios</button>}
              </footer>
            </form>
          )}
        </>
      )}
    </section>
  );
}
