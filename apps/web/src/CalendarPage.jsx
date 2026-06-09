import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "./api";

const VIEW_OPTIONS = [
  { value: "day", label: "Dia" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mes" },
];

function toDateInputValue(value) {
  if (!value) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return "Sin fecha";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Sin fecha";
  return parsed.toLocaleString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function trafficLabel(value) {
  if (value === "red") return "Rojo";
  if (value === "amber") return "Ambar";
  return "Verde";
}

export default function CalendarPage({ currentUser }) {
  const permissionSet = useMemo(
    () => new Set(currentUser?.permissions || []),
    [currentUser],
  );
  const canReadAll = permissionSet.has("calendario_comercial.read_all");

  const [calendarView, setCalendarView] = useState("week");
  const [calendarDate, setCalendarDate] = useState(toDateInputValue());
  const [selectedSellerId, setSelectedSellerId] = useState("");
  const [slaDays, setSlaDays] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  const loadCalendarModule = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = {
        view: calendarView,
        date: calendarDate,
        includeCompleted: false,
        slaDays,
      };
      if (selectedSellerId) {
        params.sellerUserId = Number(selectedSellerId);
      }

      const response = await api.get("/api/commercial-development/calendar", {
        params,
      });
      const nextData = response.data || null;
      setData(nextData);

      const nextSellerId = String(nextData?.selectedSellerUserId || "");
      if (!selectedSellerId && nextSellerId) {
        setSelectedSellerId(nextSellerId);
      }

      const resolvedSla = Number(nextData?.slaConfig?.days || 0);
      if (resolvedSla > 0 && resolvedSla !== slaDays) {
        setSlaDays(resolvedSla);
      }
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar el modulo calendario.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [calendarDate, calendarView, selectedSellerId, slaDays]);

  useEffect(() => {
    loadCalendarModule();
  }, [loadCalendarModule]);

  const sellers = data?.sellers || [];
  const days = data?.days || [];
  const alerts = data?.alerts || {};
  const myDay = data?.myDay || [];
  const indicators = data?.indicators || {};

  return (
    <div className="calendar-module-page">
      <header className="calendar-module-header">
        <div>
          <h2>Calendario</h2>
          <p>
            Agenda comercial, alertas del dia y control de riesgos operativos.
          </p>
        </div>
        <div className="calendar-module-filters">
          <label>
            Vista
            <select
              value={calendarView}
              onChange={(event) => setCalendarView(event.target.value)}
            >
              {VIEW_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fecha
            <input
              type="date"
              value={calendarDate}
              onChange={(event) => setCalendarDate(event.target.value)}
            />
          </label>
          <label>
            Vendedor
            <select
              value={selectedSellerId}
              onChange={(event) => setSelectedSellerId(event.target.value)}
              disabled={!canReadAll}
            >
              {sellers.map((seller) => (
                <option key={seller.id} value={seller.id}>
                  {seller.fullName}
                </option>
              ))}
            </select>
          </label>
          <label>
            SLA (dias)
            <input
              type="number"
              min={Number(data?.slaConfig?.minDays || 1)}
              max={Number(data?.slaConfig?.maxDays || 30)}
              value={slaDays}
              onChange={(event) => setSlaDays(Number(event.target.value || 1))}
            />
          </label>
          <button
            type="button"
            className="btn-primary"
            onClick={loadCalendarModule}
            disabled={loading}
          >
            {loading ? "Actualizando..." : "Actualizar"}
          </button>
        </div>
      </header>

      {error ? <p className="form-error">{error}</p> : null}

      <section className="calendar-module-section">
        <div className="calendar-module-section-header">
          <h3>Actividades en calendario</h3>
          <span>
            Zona horaria oficial: {data?.businessTimezone || "America/Mexico_City"}
          </span>
        </div>
        <div className="calendar-module-grid">
          {days.map((day) => (
            <article key={day.date} className="calendar-module-day-card">
              <header>
                <strong>{formatDate(day.date)}</strong>
                <span>{day.count} actividades</span>
              </header>
              <ul>
                {(day.items || []).slice(0, 6).map((item) => (
                  <li key={item.id}>
                    <span>{formatDateTime(item.scheduledAt)}</span>
                    <strong>{item.title || "Sin objetivo"}</strong>
                    <small>
                      {item.opportunityName} · {item.accountName}
                    </small>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="calendar-module-section">
        <div className="calendar-module-section-header">
          <h3>Alertas del dia</h3>
          <span>
            Total: {Number(alerts?.counters?.total || 0)} · Vencidas: {Number(alerts?.counters?.overdue || 0)}
          </span>
        </div>
        <div className="calendar-module-alerts-layout">
          <article className="calendar-module-panel">
            <h4>Bandeja de alertas priorizadas por riesgo</h4>
            <ul className="calendar-module-alert-list">
              {(alerts?.prioritized || []).slice(0, 20).map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.title || "Actividad"}</strong>
                    <p>
                      {item.opportunityName} · {formatDateTime(item.scheduledAt)}
                    </p>
                  </div>
                  <div className="calendar-module-alert-meta">
                    <span className={`calendar-traffic is-${item.trafficLight}`}>
                      {trafficLabel(item.trafficLight)}
                    </span>
                    <span>Riesgo {item.riskScore}</span>
                  </div>
                </li>
              ))}
            </ul>
          </article>

          <article className="calendar-module-panel">
            <h4>Vista Mi dia</h4>
            <ul className="calendar-module-plain-list">
              {myDay.length ? (
                myDay.map((item) => (
                  <li key={`my-day-${item.id}`}>
                    <span>{formatDateTime(item.scheduledAt)}</span>
                    <strong>{item.title || "Actividad"}</strong>
                    <small>{item.opportunityName}</small>
                  </li>
                ))
              ) : (
                <li>Sin actividades para hoy.</li>
              )}
            </ul>

            <h4>Semaforo por actividad</h4>
            <div className="calendar-module-traffic-summary">
              <span className="calendar-traffic is-red">
                Rojo {Number(indicators?.byTrafficLight?.red || 0)}
              </span>
              <span className="calendar-traffic is-amber">
                Ambar {Number(indicators?.byTrafficLight?.amber || 0)}
              </span>
              <span className="calendar-traffic is-green">
                Verde {Number(indicators?.byTrafficLight?.green || 0)}
              </span>
            </div>
          </article>

          <article className="calendar-module-panel">
            <h4>Alertas inteligentes por silencio</h4>
            <ul className="calendar-module-plain-list">
              {(alerts?.silence || []).slice(0, 10).map((item) => (
                <li key={`silence-${item.id}`}>
                  <strong>{item.opportunityName}</strong>
                  <small>{item.daysWithoutActivity} dias sin actividad</small>
                </li>
              ))}
              {!alerts?.silence?.length ? <li>Sin alertas de silencio.</li> : null}
            </ul>

            <h4>Alertas por dependencias relacionadas</h4>
            <ul className="calendar-module-plain-list">
              {(alerts?.dependencyLinked || []).slice(0, 10).map((item) => (
                <li key={`dependency-${item.id}`}>
                  <strong>{item.title || "Actividad"}</strong>
                  <small>{item.opportunityName} · dependencia vencida</small>
                </li>
              ))}
              {!alerts?.dependencyLinked?.length ? (
                <li>Sin alertas de dependencias vencidas.</li>
              ) : null}
            </ul>

            <h4>Recordatorios automaticos</h4>
            <ul className="calendar-module-plain-list">
              {(alerts?.reminders || []).slice(0, 10).map((item) => (
                <li key={`reminder-${item.activityId}-${item.remindAt}`}>
                  <strong>{item.title}</strong>
                  <small>{formatDateTime(item.remindAt)} · {item.message}</small>
                </li>
              ))}
              {!alerts?.reminders?.length ? <li>Sin recordatorios activos.</li> : null}
            </ul>
          </article>
        </div>
      </section>

      <section className="calendar-module-section">
        <div className="calendar-module-section-header">
          <h3>Indicadores para gestion</h3>
        </div>
        <div className="calendar-module-kpi-grid">
          <article>
            <span>Pendientes</span>
            <strong>{Number(alerts?.counters?.total || 0)}</strong>
          </article>
          <article>
            <span>Vencidas</span>
            <strong>{Number(alerts?.counters?.overdue || 0)}</strong>
          </article>
          <article>
            <span>Hoy</span>
            <strong>{Number(alerts?.counters?.today || 0)}</strong>
          </article>
          <article>
            <span>Bloqueadas</span>
            <strong>{Number(alerts?.counters?.blocked || 0)}</strong>
          </article>
          <article>
            <span>Riesgo alto</span>
            <strong>{Number(alerts?.counters?.highRisk || 0)}</strong>
          </article>
        </div>

        {canReadAll ? (
          <div className="calendar-module-seller-indicators">
            <h4>Indicadores por vendedor</h4>
            <ul className="calendar-module-plain-list">
              {(indicators?.bySeller || []).map((item) => (
                <li key={`seller-indicator-${item.sellerUserId}`}>
                  <strong>{item.sellerUserName}</strong>
                  <small>
                    Total {item.total} · Vencidas {item.overdue} · Riesgo alto {item.highRisk}
                  </small>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
