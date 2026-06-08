import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getApiErrorMessage } from "./api";
import "./tools/tools.css";

export default function ToolsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;

    async function loadTools() {
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get("/api/tools");
        if (ignore) return;
        setItems(Array.isArray(data?.items) ? data.items : []);
      } catch (loadError) {
        if (ignore) return;
        setError(
          getApiErrorMessage(
            loadError,
            "No fue posible cargar el catalogo de herramientas",
          ),
        );
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void loadTools();
    return () => {
      ignore = true;
    };
  }, []);

  return (
    <section className="panel tools-page">
      <header className="tools-page-header">
        <div>
          <div className="module-title-with-icon">
            <h2>Herramientas</h2>
            <span className="module-title-icon tools-title-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M14.7 3.3a1 1 0 0 1 1.41 0l1.59 1.59a1 1 0 0 1 0 1.41l-2.12 2.12 2.3 2.3a3 3 0 0 1 .7 3.11l-6.38 6.38a2 2 0 0 1-2.83 0l-3.12-3.12a2 2 0 0 1 0-2.83l6.38-6.38a3 3 0 0 1 3.11-.7l-2.3-2.3-2.12 2.12a1 1 0 0 1-1.41 0L8.3 7.29a1 1 0 0 1 0-1.41L9.89 4.3a1 1 0 0 1 1.41 0l3.4 3.4 2.12-2.12a1 1 0 0 1 0-1.41L14.7 3.3z" />
              </svg>
            </span>
          </div>
          <p className="roles-subtitle tools-page-subtitle">
            Operaciones administrativas para diagnosticar, revisar y corregir datos
            sensibles sin salir del CRM.
          </p>
          <p className="field-hint">
            Usa estas herramientas cuando necesites analizar impacto antes de tocar
            datos vivos.
          </p>
        </div>
      </header>

      {error ? <div className="toast toast-error">{error}</div> : null}
      {loading ? <p className="field-hint">Cargando herramientas...</p> : null}

      <div className="tools-index-grid">
        {items.map((item) => {
          const stats = item?.stats || {};
          const primaryMetric =
            Number(stats.groupCount || 0) > 0
              ? `${Number(stats.groupCount)} grupos detectados`
              : item.status === "planned"
                ? "Disponible más adelante"
                : "Sin incidencias activas";

          return (
            <article key={item.key} className="tools-index-card">
              <div className="tools-index-card-head">
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </div>
                <span className={`tools-risk-pill is-${item.riskLevel || "low"}`}>
                  Riesgo {item.riskLevel || "low"}
                </span>
              </div>

              <div className="tools-index-metrics">
                <strong>{primaryMetric}</strong>
                {item.key === "price_list_duplicates" ? (
                  <div className="tools-index-metric-grid">
                    <span>Proveedores: {Number(stats.providerCount || 0)}</span>
                    <span>Listas: {Number(stats.priceListCount || 0)}</span>
                    <span>Alto riesgo: {Number(stats.highRiskGroupCount || 0)}</span>
                    <span>
                      Listos: {Number(stats.readyToConsolidateCount || 0)}
                    </span>
                  </div>
                ) : (
                  <span className="field-hint">Planeada para siguientes iteraciones.</span>
                )}
              </div>

              <div className="tools-index-actions">
                {item.status === "planned" ? (
                  <span className="tools-planned-badge">Planeada</span>
                ) : (
                  <Link className="btn-primary" to={item.href || "/tools"}>
                    Abrir herramienta
                  </Link>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}