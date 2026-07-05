import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getApiErrorMessage } from "./api";
import "./campaign-management-page.css";

const TABS = [
  { key: "summary", label: "Resumen" },
  { key: "audience", label: "Audiencia" },
  { key: "capture", label: "Captacion" },
  { key: "records", label: "Registros" },
  { key: "results", label: "Resultados" },
];

function formatLabel(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("es-CO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export default function CampaignManagementPage() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState([]);
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(true);
  const [campaignsError, setCampaignsError] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  const [campaignAccounts, setCampaignAccounts] = useState([]);
  const [isLoadingAudience, setIsLoadingAudience] = useState(false);
  const [audienceError, setAudienceError] = useState("");
  const [activeTab, setActiveTab] = useState("summary");

  const selectedCampaign = useMemo(() => {
    return (
      campaigns.find((campaign) => campaign.id === selectedCampaignId) || null
    );
  }, [campaigns, selectedCampaignId]);

  const audienceAccountsCount = campaignAccounts.length;
  const audienceContactsCount = useMemo(() => {
    return campaignAccounts.reduce((total, item) => {
      return total + (Array.isArray(item.contacts) ? item.contacts.length : 0);
    }, 0);
  }, [campaignAccounts]);

  const checklist = useMemo(() => {
    const hasStrategy =
      Boolean(String(selectedCampaign?.name || "").trim()) &&
      Boolean(String(selectedCampaign?.tipo_campana || "").trim()) &&
      Boolean(String(selectedCampaign?.subtipo_campana || "").trim());
    const hasAudience = audienceAccountsCount > 0;
    const captureSubtype = String(selectedCampaign?.subtipo_campana || "");
    const hasCapture = [
      "landing_page",
      "webinar",
      "evento_presencial",
      "evento_virtual",
    ].includes(captureSubtype);
    const isActive = ["en_ejecucion", "finalizada"].includes(
      String(selectedCampaign?.estado_campana || ""),
    );

    return [
      { key: "strategy", label: "Estrategia definida", done: hasStrategy },
      { key: "audience", label: "Audiencia guardada", done: hasAudience },
      {
        key: "capture",
        label: "Captacion configurada",
        done: hasCapture,
      },
      {
        key: "status",
        label: "Campana activa/finalizada",
        done: isActive,
      },
    ];
  }, [audienceAccountsCount, selectedCampaign]);

  useEffect(() => {
    let mounted = true;

    async function loadCampaigns() {
      setIsLoadingCampaigns(true);
      setCampaignsError("");

      try {
        const { data } = await api.get("/api/campaigns");
        if (!mounted) return;

        const items = Array.isArray(data?.items) ? data.items : [];
        setCampaigns(items);
        if (!selectedCampaignId && items[0]?.id) {
          setSelectedCampaignId(Number(items[0].id));
        }
      } catch (error) {
        if (!mounted) return;
        setCampaignsError(
          getApiErrorMessage(error, "No fue posible cargar campanas"),
        );
      } finally {
        if (mounted) {
          setIsLoadingCampaigns(false);
        }
      }
    }

    loadCampaigns();

    return () => {
      mounted = false;
    };
  }, [selectedCampaignId]);

  useEffect(() => {
    let mounted = true;

    async function loadAudience() {
      if (!selectedCampaignId) {
        setCampaignAccounts([]);
        return;
      }

      setIsLoadingAudience(true);
      setAudienceError("");
      try {
        const { data } = await api.get(
          `/api/campaigns/${selectedCampaignId}/accounts`,
        );
        if (!mounted) return;
        setCampaignAccounts(Array.isArray(data?.items) ? data.items : []);
      } catch (error) {
        if (!mounted) return;
        setAudienceError(
          getApiErrorMessage(
            error,
            "No fue posible cargar la audiencia de la campana",
          ),
        );
      } finally {
        if (mounted) {
          setIsLoadingAudience(false);
        }
      }
    }

    loadAudience();

    return () => {
      mounted = false;
    };
  }, [selectedCampaignId]);

  return (
    <section className="campaign-management-page">
      <header className="campaign-management-header">
        <div>
          <h2>Gestion de campanas</h2>
          <p>
            Modulo temporal para centralizar estrategia, audiencia, captacion y
            resultados sin reemplazar los modulos actuales.
          </p>
        </div>
        <div className="campaign-management-header-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => navigate("/campaigns")}
          >
            Abrir Campanas actuales
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => navigate("/landing")}
          >
            Abrir Landing por evento
          </button>
        </div>
      </header>

      {campaignsError ? (
        <p className="campaign-management-alert campaign-management-alert-error">
          {campaignsError}
        </p>
      ) : null}

      <div className="campaign-management-layout">
        <aside className="campaign-management-sidebar">
          <div className="campaign-management-sidebar-head">
            <h3>Campanas</h3>
            <small>{campaigns.length} registradas</small>
          </div>
          {isLoadingCampaigns ? <p>Cargando campanas...</p> : null}

          {!isLoadingCampaigns && campaigns.length === 0 ? (
            <p className="campaign-management-empty">
              No hay campanas para mostrar.
            </p>
          ) : null}

          {campaigns.length > 0 ? (
            <ul>
              {campaigns.map((campaign) => {
                const isSelected = campaign.id === selectedCampaignId;
                return (
                  <li key={campaign.id}>
                    <button
                      type="button"
                      className={isSelected ? "is-selected" : ""}
                      onClick={() => setSelectedCampaignId(campaign.id)}
                    >
                      <strong>
                        {campaign.name || `Campana ${campaign.id}`}
                      </strong>
                      <span>
                        {formatLabel(campaign.tipo_campana)} ·{" "}
                        {formatLabel(campaign.estado_campana)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </aside>

        <main className="campaign-management-main">
          {!selectedCampaign ? (
            <p className="campaign-management-empty">
              Selecciona una campana para abrir su centro de gestion.
            </p>
          ) : (
            <>
              <section className="campaign-management-summary card">
                <div className="campaign-management-summary-head">
                  <div>
                    <h3>{selectedCampaign.name || "Campana sin nombre"}</h3>
                    <p>
                      {formatLabel(selectedCampaign.tipo_campana)} ·{" "}
                      {formatLabel(selectedCampaign.subtipo_campana)} ·{" "}
                      {formatLabel(selectedCampaign.estado_campana)}
                    </p>
                  </div>
                  <div className="campaign-management-kpis">
                    <article>
                      <strong>{audienceAccountsCount}</strong>
                      <span>Cuentas</span>
                    </article>
                    <article>
                      <strong>{audienceContactsCount}</strong>
                      <span>Contactos</span>
                    </article>
                    <article>
                      <strong>
                        {selectedCampaign.targeted_accounts_count || 0}
                      </strong>
                      <span>Objetivo guardado</span>
                    </article>
                  </div>
                </div>

                <div className="campaign-management-checklist">
                  {checklist.map((item) => (
                    <div
                      key={item.key}
                      className={item.done ? "is-done" : "is-pending"}
                    >
                      <span>{item.done ? "Listo" : "Pendiente"}</span>
                      <strong>{item.label}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="card">
                <div className="campaign-management-tabs">
                  {TABS.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      className={activeTab === tab.key ? "is-active" : ""}
                      onClick={() => setActiveTab(tab.key)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {activeTab === "summary" ? (
                  <div className="campaign-management-tab-body">
                    <div className="campaign-management-grid-two">
                      <article>
                        <h4>Definicion</h4>
                        <p>
                          <strong>Nombre:</strong>{" "}
                          {selectedCampaign.name || "-"}
                        </p>
                        <p>
                          <strong>Descripcion:</strong>{" "}
                          {selectedCampaign.description || "-"}
                        </p>
                        <p>
                          <strong>Etapa objetivo:</strong>{" "}
                          {selectedCampaign.etapa_ciclo_vida
                            ? formatLabel(selectedCampaign.etapa_ciclo_vida)
                            : "Sin definir"}
                        </p>
                      </article>
                      <article>
                        <h4>Calendario</h4>
                        <p>
                          <strong>Inicio:</strong>{" "}
                          {formatDate(selectedCampaign.starts_at)}
                        </p>
                        <p>
                          <strong>Fin:</strong>{" "}
                          {formatDate(selectedCampaign.ends_at)}
                        </p>
                        <p>
                          <strong>Actualizacion:</strong>{" "}
                          {formatDate(selectedCampaign.updated_at)}
                        </p>
                      </article>
                    </div>
                  </div>
                ) : null}

                {activeTab === "audience" ? (
                  <div className="campaign-management-tab-body">
                    {isLoadingAudience ? <p>Cargando audiencia...</p> : null}
                    {audienceError ? (
                      <p className="campaign-management-alert campaign-management-alert-error">
                        {audienceError}
                      </p>
                    ) : null}
                    {!isLoadingAudience &&
                    !audienceError &&
                    campaignAccounts.length === 0 ? (
                      <p className="campaign-management-empty">
                        Esta campana aun no tiene audiencia guardada.
                      </p>
                    ) : null}
                    {campaignAccounts.length > 0 ? (
                      <div className="campaign-management-audience-list">
                        {campaignAccounts.map((item) => (
                          <article key={item.account_id}>
                            <header>
                              <strong>{item.account_name}</strong>
                              {String(item.economic_sector || "").trim() ? (
                                <span>{item.economic_sector}</span>
                              ) : null}
                            </header>
                            <p>
                              Etapa:{" "}
                              {item.etapa_ciclo_vida
                                ? formatLabel(item.etapa_ciclo_vida)
                                : "-"}
                            </p>
                            <p>
                              Contactos:{" "}
                              {Array.isArray(item.contacts)
                                ? item.contacts.length
                                : 0}
                            </p>
                          </article>
                        ))}
                      </div>
                    ) : null}
                    <div className="campaign-management-inline-actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => navigate("/campaigns")}
                      >
                        Gestionar audiencia en Campanas
                      </button>
                    </div>
                  </div>
                ) : null}

                {activeTab === "capture" ? (
                  <div className="campaign-management-tab-body">
                    <div className="campaign-management-grid-two">
                      <article>
                        <h4>Activo de captacion</h4>
                        <p>
                          Subtipo actual:{" "}
                          {formatLabel(selectedCampaign.subtipo_campana)}
                        </p>
                        <p>
                          Usa Landing por evento para crear, publicar o vincular
                          la experiencia de conversion de esta campana.
                        </p>
                      </article>
                      <article>
                        <h4>Publicacion y operacion</h4>
                        <p>
                          Administra versiones, URL publica, confirmaciones y
                          formularios desde el modulo especialista de landing.
                        </p>
                      </article>
                    </div>
                    <div className="campaign-management-inline-actions">
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => navigate("/landing")}
                      >
                        Ir a Landing por evento
                      </button>
                    </div>
                  </div>
                ) : null}

                {activeTab === "records" ? (
                  <div className="campaign-management-tab-body">
                    <p>
                      Consulta registros por evento y su envio a CRM desde el
                      modulo de Landing por evento.
                    </p>
                    <div className="campaign-management-inline-actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => navigate("/landing")}
                      >
                        Ver registros en Landing
                      </button>
                    </div>
                  </div>
                ) : null}

                {activeTab === "results" ? (
                  <div className="campaign-management-tab-body">
                    <div className="campaign-management-kpi-grid">
                      <article>
                        <strong>{audienceAccountsCount}</strong>
                        <span>Cuentas en audiencia</span>
                      </article>
                      <article>
                        <strong>{audienceContactsCount}</strong>
                        <span>Contactos en audiencia</span>
                      </article>
                      <article>
                        <strong>
                          {selectedCampaign.targeted_accounts_count || 0}
                        </strong>
                        <span>Objetivo persistido</span>
                      </article>
                    </div>
                    <p className="campaign-management-note">
                      Esta vista resume indicadores base del flujo temporal. Las
                      metricas avanzadas de captacion y conversion se
                      incorporaran progresivamente.
                    </p>
                  </div>
                ) : null}
              </section>
            </>
          )}
        </main>
      </div>
    </section>
  );
}
