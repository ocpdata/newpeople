import { useEffect, useState } from "react";
import { api, getApiErrorMessage } from "./api";
import { getBusinessDateParts } from "./business-timezone";
import ComponentCards, { VariableHero } from "./variable-compensation/ComponentCards";
import RulesPanel from "./variable-compensation/RulesPanel";
import SalesTable from "./variable-compensation/SalesTable";
import Simulator from "./variable-compensation/Simulator";
import { QUARTERS } from "./variable-compensation/format";
import "./variable-compensation.css";

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

export default function VariableCompensationPage({ canRead, canUpdate }) {
  const [today] = useState(() => getBusinessDateParts(new Date()));
  const [year, setYear] = useState(today.year);
  const [quarter, setQuarter] = useState(Math.ceil(today.month / 3));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showRules, setShowRules] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const selectPeriod = (nextYear, nextQuarter) => {
    setLoading(true);
    setYear(nextYear);
    setQuarter(nextQuarter);
  };

  useEffect(() => {
    if (!canRead) return undefined;
    const controller = new AbortController();
    api.get("/api/variable-compensation", { params: { year, quarter }, signal: controller.signal })
      .then(({ data: payload }) => { setData(payload); setError(""); })
      .catch((failure) => {
        if (controller.signal.aborted || failure.code === "ERR_CANCELED") return;
        setData(null);
        setError(getApiErrorMessage(failure, "No fue posible calcular el variable del trimestre."));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [canRead, year, quarter, reloadToken]);

  if (!canRead) return <section className="panel"><p>No tienes permiso para consultar el variable comercial.</p></section>;

  const label = `T${quarter} ${year}`;
  return (
    <section className="dashboard-home-page variable-compensation">
      <header className="panel dashboard-home-hero">
        <div>
          <h2>Variable comercial</h2>
          <p>Cálculo en vivo del variable del trimestre con las reglas de pago configuradas y las ventas aceptadas del CRM.</p>
        </div>
      </header>
      <div className="panel vc-toolbar">
        <div className="vc-period" role="group" aria-label="Periodo">
          <button type="button" aria-label="Año anterior" disabled={year <= MIN_YEAR} onClick={() => selectPeriod(year - 1, quarter)}>‹</button>
          <strong aria-live="polite">{year}</strong>
          <button type="button" aria-label="Año siguiente" disabled={year >= MAX_YEAR} onClick={() => selectPeriod(year + 1, quarter)}>›</button>
        </div>
        <div className="vc-quarters" role="group" aria-label="Trimestre">
          {QUARTERS.map((value) => (
            <button key={value} type="button" aria-pressed={quarter === value} onClick={() => selectPeriod(year, value)}>T{value}</button>
          ))}
        </div>
        {data?.status === "ok" && (
          <p className="vc-sub vc-day">
            Día {data.period.dayNumber} de {data.period.totalDays} · {data.period.daysRemaining} días restantes · montos en {data.currencyCode}
          </p>
        )}
        <button type="button" className="vc-rules-toggle" aria-expanded={showRules} onClick={() => setShowRules((value) => !value)}>
          {showRules ? "Ocultar reglas de pago" : "Reglas de pago"}
        </button>
      </div>

      {loading && <p role="status">Calculando {label}…</p>}
      {!loading && error && (
        <div className="panel vc-banner vc-banner-bad" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => { setLoading(true); setReloadToken((value) => value + 1); }}>Reintentar</button>
        </div>
      )}
      {!loading && data?.status === "no_planning" && (
        <div className="panel vc-banner" role="status">
          No hay planeación comercial para {label}. Captura las cuotas del año en Metas y comisiones.
        </div>
      )}
      {!loading && data?.status === "no_quotas" && (
        <div className="panel vc-banner" role="status">
          {label} no tiene cuotas por vendedor capturadas en Metas y comisiones, por lo que no hay contra qué calcular el variable.
        </div>
      )}
      {!loading && data?.status === "ok" && (
        <>
          {data.warnings.map((warning) => (
            <div key={warning.code} className={`panel vc-banner${warning.code === "rules_unvalidated" ? " vc-banner-warn" : ""}`} role="status">{warning.message}</div>
          ))}
          <VariableHero data={data} />
          <h3 className="vc-section-title">Componentes del variable</h3>
          <ComponentCards data={data} />
          <Simulator key={`${year}-${quarter}-${data.rules.version}`} data={data} />
          <SalesTable key={`sales-${year}-${quarter}`} data={data} />
        </>
      )}
      {showRules && data?.rules && (
        <RulesPanel state={data.rules} canUpdate={canUpdate} onSaved={async () => setReloadToken((value) => value + 1)} />
      )}
    </section>
  );
}
