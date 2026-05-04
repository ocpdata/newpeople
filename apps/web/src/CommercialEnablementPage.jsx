import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "./api";

const TAB_OPTIONS = [
  { id: "recommendations", label: "Recomendaciones" },
  { id: "library", label: "Biblioteca" },
  { id: "templates", label: "Plantillas" },
  { id: "solutions", label: "Soluciones" },
  { id: "collaboration", label: "Gerente y preventa" },
  { id: "analytics", label: "Analitica" },
];

const RESOURCE_KIND_OPTIONS = [
  { value: "case_study", label: "Caso de exito" },
  { value: "battlecard", label: "Battlecard" },
  { value: "one_pager", label: "One-pager" },
  { value: "objection_guide", label: "Guia de objeciones" },
  { value: "discovery_guide", label: "Discovery guide" },
  { value: "industry_questions", label: "Preguntas por industria" },
  { value: "value_message", label: "Mensajes de valor" },
  { value: "meeting_template", label: "Agenda de reunion" },
  { value: "minutes_template", label: "Minuta" },
  { value: "follow_up_template", label: "Correo post-reunion" },
  { value: "executive_recap_template", label: "Recap ejecutivo" },
  { value: "technical_request_template", label: "Solicitud tecnica" },
  { value: "solution_guide", label: "Playbook por solucion" },
  { value: "manager_guide", label: "Guia para gerente" },
  { value: "presales_guide", label: "Guia para preventa" },
];

const STATUS_OPTIONS = [
  { value: "draft", label: "Borrador" },
  { value: "published", label: "Vigente" },
  { value: "obsolete", label: "Obsoleto" },
];

function splitTags(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinTags(values) {
  return Array.isArray(values) ? values.join(", ") : "";
}

function buildResourceDraft(resource = null) {
  return {
    kind: resource?.kind || "case_study",
    status: resource?.status || "draft",
    title: resource?.title || "",
    summary: resource?.summary || "",
    bodyMarkdown: resource?.bodyMarkdown || "",
    solutionCodes: joinTags(resource?.solutionCodes),
    industryTags: joinTags(resource?.industryTags),
    stageCodes: joinTags(resource?.stageCodes),
    themeTags: joinTags(resource?.themeTags),
    competitorTags: joinTags(resource?.competitorTags),
    personaTags: joinTags(resource?.personaTags),
    needTags: joinTags(resource?.needTags),
    recommendedRoleTags: joinTags(resource?.recommendedRoleTags),
    validUntil: resource?.validUntil || "",
  };
}

function normalizeExecutionDashboard(data) {
  const workboard = Array.isArray(data?.workboard) ? data.workboard : [];
  return {
    workboard: workboard.map((item) => ({
      ...item,
      recommendedResources: Array.isArray(item?.recommendedResources)
        ? item.recommendedResources
        : [],
    })),
  };
}

function groupResources(resources) {
  const grouped = {
    library: [],
    templates: [],
    solutions: [],
    collaboration: [],
  };

  for (const resource of resources) {
    if (
      [
        "meeting_template",
        "minutes_template",
        "follow_up_template",
        "executive_recap_template",
        "technical_request_template",
      ].includes(resource.kind)
    ) {
      grouped.templates.push(resource);
      continue;
    }

    if (resource.kind === "solution_guide") {
      grouped.solutions.push(resource);
      continue;
    }

    if (["manager_guide", "presales_guide"].includes(resource.kind)) {
      grouped.collaboration.push(resource);
      continue;
    }

    grouped.library.push(resource);
  }

  return grouped;
}

function SummaryCard({ label, value, helper }) {
  return (
    <article className="commercial-enable-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{helper}</p>
    </article>
  );
}

export default function CommercialEnablementPage({ currentUser }) {
  const [activeTab, setActiveTab] = useState("recommendations");
  const [dashboard, setDashboard] = useState(null);
  const [executionDashboard, setExecutionDashboard] = useState({
    workboard: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingAssets, setUploadingAssets] = useState(false);
  const [feedbackKey, setFeedbackKey] = useState("");
  const [selectedResourcePublicId, setSelectedResourcePublicId] =
    useState(null);
  const [resourceDraft, setResourceDraft] = useState(buildResourceDraft());
  const [searchText, setSearchText] = useState("");

  const permissionSet = useMemo(
    () => new Set(currentUser?.permissions || []),
    [currentUser],
  );
  const canEdit = permissionSet.has("enablement_comercial.update");
  const canSeeAnalytics = permissionSet.has("enablement_comercial.analytics");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");

    const [enablementResult, executionResult] = await Promise.allSettled([
      api.get("/api/commercial-enablement/dashboard"),
      api.get("/api/execution-commercial/dashboard"),
    ]);

    if (enablementResult.status !== "fulfilled") {
      setError(
        getApiErrorMessage(
          enablementResult.reason,
          "No fue posible cargar el modulo de enablement comercial",
        ),
      );
      setLoading(false);
      return;
    }

    const nextDashboard = enablementResult.value.data;
    setDashboard(nextDashboard);
    setExecutionDashboard(
      executionResult.status === "fulfilled"
        ? normalizeExecutionDashboard(executionResult.value.data)
        : { workboard: [] },
    );
    setSelectedResourcePublicId((current) => {
      const resources = Array.isArray(nextDashboard?.resources)
        ? nextDashboard.resources
        : [];
      if (
        current &&
        resources.some((resource) => resource.publicId === current)
      ) {
        return current;
      }
      return resources[0]?.publicId || null;
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const resources = Array.isArray(dashboard?.resources)
    ? dashboard.resources
    : [];
  const groupedResources = useMemo(
    () => groupResources(resources),
    [resources],
  );
  const selectedResource = useMemo(
    () =>
      resources.find(
        (resource) => resource.publicId === selectedResourcePublicId,
      ) ||
      resources[0] ||
      null,
    [resources, selectedResourcePublicId],
  );

  useEffect(() => {
    setResourceDraft(buildResourceDraft(selectedResource));
  }, [selectedResource]);

  const tabResources = useMemo(() => {
    if (activeTab === "templates") return groupedResources.templates;
    if (activeTab === "solutions") return groupedResources.solutions;
    if (activeTab === "collaboration") return groupedResources.collaboration;
    return groupedResources.library;
  }, [activeTab, groupedResources]);

  const filteredResources = useMemo(() => {
    const query = String(searchText || "")
      .trim()
      .toLowerCase();
    if (!query) return tabResources;
    return tabResources.filter((resource) => {
      const haystack = [
        resource.title,
        resource.summary,
        resource.kindLabel,
        ...(resource.solutionCodes || []),
        ...(resource.industryTags || []),
        ...(resource.stageCodes || []),
        ...(resource.themeTags || []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [searchText, tabResources]);

  const recommendationSnapshots = useMemo(
    () =>
      (executionDashboard?.workboard || [])
        .filter(
          (item) =>
            Array.isArray(item.recommendedResources) &&
            item.recommendedResources.length,
        )
        .slice(0, 8),
    [executionDashboard],
  );

  async function handleSaveResource(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const payload = {
        kind: resourceDraft.kind,
        status: resourceDraft.status,
        title: resourceDraft.title,
        summary: resourceDraft.summary,
        bodyMarkdown: resourceDraft.bodyMarkdown,
        solutionCodes: splitTags(resourceDraft.solutionCodes),
        industryTags: splitTags(resourceDraft.industryTags),
        stageCodes: splitTags(resourceDraft.stageCodes),
        themeTags: splitTags(resourceDraft.themeTags),
        competitorTags: splitTags(resourceDraft.competitorTags),
        personaTags: splitTags(resourceDraft.personaTags),
        needTags: splitTags(resourceDraft.needTags),
        recommendedRoleTags: splitTags(resourceDraft.recommendedRoleTags),
        validUntil: resourceDraft.validUntil || null,
      };

      const response = selectedResource?.publicId
        ? await api.put(
            `/api/commercial-enablement/resources/${selectedResource.publicId}`,
            payload,
          )
        : await api.post("/api/commercial-enablement/resources", payload);

      setSelectedResourcePublicId(response.data.publicId);
      await loadData();
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible guardar el recurso comercial",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleUploadAssets(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length || !selectedResource?.publicId) return;

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    setUploadingAssets(true);
    setError("");

    try {
      await api.post(
        `/api/commercial-enablement/resources/${selectedResource.publicId}/assets`,
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        },
      );
      await loadData();
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible cargar el adjunto"),
      );
    } finally {
      setUploadingAssets(false);
      event.target.value = "";
    }
  }

  async function handleDeleteAsset(assetPublicId) {
    if (!selectedResource?.publicId) return;
    setUploadingAssets(true);
    setError("");
    try {
      await api.delete(
        `/api/commercial-enablement/resources/${selectedResource.publicId}/assets/${assetPublicId}`,
      );
      await loadData();
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible eliminar el adjunto"),
      );
    } finally {
      setUploadingAssets(false);
    }
  }

  async function handleFeedback(
    resourcePublicId,
    eventType,
    contextType,
    contextEntityId,
  ) {
    setFeedbackKey(`${resourcePublicId}-${eventType}`);
    setError("");
    try {
      await api.post(
        `/api/commercial-enablement/resources/${resourcePublicId}/feedback`,
        {
          eventType,
          contextType,
          contextEntityId,
        },
      );
      await loadData();
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible registrar la retroalimentacion",
        ),
      );
    } finally {
      setFeedbackKey("");
    }
  }

  if (loading) {
    return (
      <section className="panel centered">
        Cargando enablement comercial...
      </section>
    );
  }

  return (
    <section className="panel commercial-enable-page">
      <header className="commercial-enable-hero">
        <div>
          <span className="commercial-enable-eyebrow">
            Enablement comercial
          </span>
          <h2>Recursos y activos conectados al flujo comercial</h2>
          <p className="section-helper-text">
            Reune biblioteca, plantillas, playbooks por solucion, guias para
            gerente y preventa, y recomendaciones contextuales para reducir
            improvisacion y elevar consistencia comercial.
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={loadData}>
          Actualizar modulo
        </button>
      </header>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="commercial-enable-summary-grid">
        <SummaryCard
          label="Recursos totales"
          value={dashboard?.summary?.totalResources || 0}
          helper="Biblioteca, plantillas y guias activas del modulo"
        />
        <SummaryCard
          label="Recursos vigentes"
          value={dashboard?.summary?.publishedResources || 0}
          helper="Activos listos para ser usados en venta"
        />
        <SummaryCard
          label="Plantillas"
          value={dashboard?.summary?.templates || 0}
          helper="Agendas, minutas, recaps y seguimientos reutilizables"
        />
        <SummaryCard
          label="Playbooks por solucion"
          value={dashboard?.summary?.solutionGuides || 0}
          helper="Conocimiento comercial estructurado por oferta"
        />
        <SummaryCard
          label="Guias de apoyo"
          value={dashboard?.summary?.roleGuides || 0}
          helper="Material para gerente comercial y preventa"
        />
        <SummaryCard
          label="Adjuntos activos"
          value={dashboard?.summary?.activeAssets || 0}
          helper="Archivos locales listos para pruebas y futura migracion"
        />
      </div>

      <div
        className="commercial-enable-tabs"
        role="tablist"
        aria-label="Vistas de enablement comercial"
      >
        {TAB_OPTIONS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`commercial-enable-tab ${activeTab === tab.id ? "is-active" : ""}`.trim()}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "recommendations" ? (
        <div className="commercial-enable-board-grid single-column">
          <section className="commercial-enable-block">
            <div className="commercial-enable-block-header">
              <h3>Recomendaciones contextuales por oportunidad</h3>
              <span>{recommendationSnapshots.length} casos priorizados</span>
            </div>
            <div className="commercial-enable-recommendation-grid">
              {recommendationSnapshots.map((item) => (
                <article
                  key={item.id}
                  className="commercial-enable-opportunity-card"
                >
                  <div className="commercial-enable-item-topline">
                    <strong>{item.name}</strong>
                    <span>{item.stageName}</span>
                  </div>
                  <p>{item.accountName}</p>
                  <p className="commercial-enable-muted">
                    {item.executionState?.summary ||
                      item.recommendedRoute ||
                      "Sin resumen contextual"}
                  </p>
                  <div className="commercial-enable-resource-stack">
                    {item.recommendedResources.map((resource) => (
                      <article
                        key={resource.publicId}
                        className="commercial-enable-resource-mini-card"
                      >
                        <div className="commercial-enable-item-topline">
                          <strong>{resource.title}</strong>
                          <span>{resource.kindLabel}</span>
                        </div>
                        <p>{resource.summary}</p>
                        <p className="commercial-enable-muted">
                          Motivo: {resource.recommendationReason}
                        </p>
                        <div className="commercial-enable-action-row">
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => {
                              setSelectedResourcePublicId(resource.publicId);
                              setActiveTab(
                                resource.kind === "solution_guide"
                                  ? "solutions"
                                  : [
                                        "manager_guide",
                                        "presales_guide",
                                      ].includes(resource.kind)
                                    ? "collaboration"
                                    : [
                                          "meeting_template",
                                          "minutes_template",
                                          "follow_up_template",
                                          "executive_recap_template",
                                          "technical_request_template",
                                        ].includes(resource.kind)
                                      ? "templates"
                                      : "library",
                              );
                            }}
                          >
                            Abrir ficha
                          </button>
                          <button
                            type="button"
                            className="link-button"
                            disabled={
                              feedbackKey === `${resource.publicId}-used`
                            }
                            onClick={() =>
                              handleFeedback(
                                resource.publicId,
                                "used",
                                "execution_workboard",
                                item.id,
                              )
                            }
                          >
                            Marcar como usado
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {["library", "templates", "solutions", "collaboration"].includes(
        activeTab,
      ) ? (
        <div className="commercial-enable-board-grid">
          <section className="commercial-enable-block">
            <div className="commercial-enable-block-header">
              <h3>
                {activeTab === "library"
                  ? "Biblioteca comercial"
                  : activeTab === "templates"
                    ? "Plantillas operativas"
                    : activeTab === "solutions"
                      ? "Repositorio por solucion"
                      : "Guias para gerente y preventa"}
              </h3>
              <span>{filteredResources.length} recursos</span>
            </div>
            <div className="commercial-enable-toolbar">
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Filtrar por titulo, etapa, solucion o tema"
              />
              {canEdit ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setSelectedResourcePublicId(null);
                    setResourceDraft(buildResourceDraft());
                  }}
                >
                  Nuevo recurso
                </button>
              ) : null}
            </div>
            <div className="commercial-enable-list">
              {filteredResources.map((resource) => (
                <article
                  key={resource.publicId}
                  className={`commercial-enable-list-card ${selectedResource?.publicId === resource.publicId ? "is-selected" : ""}`.trim()}
                >
                  <button
                    type="button"
                    className="commercial-enable-list-button"
                    onClick={() =>
                      setSelectedResourcePublicId(resource.publicId)
                    }
                  >
                    <div className="commercial-enable-item-topline">
                      <strong>{resource.title}</strong>
                      <span>{resource.kindLabel}</span>
                    </div>
                    <p>{resource.summary}</p>
                    <div className="commercial-enable-chip-row">
                      <span>{resource.statusLabel}</span>
                      <span>{resource.assetCount} adjuntos</span>
                      <span>{resource.usageCount} usos</span>
                    </div>
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section className="commercial-enable-block commercial-enable-editor-block">
            <div className="commercial-enable-block-header">
              <h3>
                {selectedResource ? "Ficha del recurso" : "Nuevo recurso"}
              </h3>
              <span>
                {selectedResource?.kindLabel ||
                  "Completa la metadata y el contenido"}
              </span>
            </div>

            <form
              className="commercial-enable-form"
              onSubmit={handleSaveResource}
            >
              <label>
                Tipo de recurso
                <select
                  value={resourceDraft.kind}
                  onChange={(event) =>
                    setResourceDraft((current) => ({
                      ...current,
                      kind: event.target.value,
                    }))
                  }
                  disabled={!canEdit}
                >
                  {RESOURCE_KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Estado
                <select
                  value={resourceDraft.status}
                  onChange={(event) =>
                    setResourceDraft((current) => ({
                      ...current,
                      status: event.target.value,
                    }))
                  }
                  disabled={!canEdit}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Titulo
                <input
                  value={resourceDraft.title}
                  onChange={(event) =>
                    setResourceDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  disabled={!canEdit}
                />
              </label>
              <label>
                Resumen
                <textarea
                  rows="3"
                  value={resourceDraft.summary}
                  onChange={(event) =>
                    setResourceDraft((current) => ({
                      ...current,
                      summary: event.target.value,
                    }))
                  }
                  disabled={!canEdit}
                />
              </label>
              <label>
                Contenido operativo
                <textarea
                  rows="10"
                  value={resourceDraft.bodyMarkdown}
                  onChange={(event) =>
                    setResourceDraft((current) => ({
                      ...current,
                      bodyMarkdown: event.target.value,
                    }))
                  }
                  disabled={!canEdit}
                />
              </label>
              <label>
                Soluciones
                <input
                  value={resourceDraft.solutionCodes}
                  onChange={(event) =>
                    setResourceDraft((current) => ({
                      ...current,
                      solutionCodes: event.target.value,
                    }))
                  }
                  placeholder="customer_edge, network_security"
                  disabled={!canEdit}
                />
              </label>
              <label>
                Industrias
                <input
                  value={resourceDraft.industryTags}
                  onChange={(event) =>
                    setResourceDraft((current) => ({
                      ...current,
                      industryTags: event.target.value,
                    }))
                  }
                  placeholder="finanzas, retail"
                  disabled={!canEdit}
                />
              </label>
              <label>
                Etapas comerciales
                <input
                  value={resourceDraft.stageCodes}
                  onChange={(event) =>
                    setResourceDraft((current) => ({
                      ...current,
                      stageCodes: event.target.value,
                    }))
                  }
                  placeholder="contacto_inicial, desarrollo, cotizacion"
                  disabled={!canEdit}
                />
              </label>
              <label>
                Temas / riesgos
                <input
                  value={resourceDraft.themeTags}
                  onChange={(event) =>
                    setResourceDraft((current) => ({
                      ...current,
                      themeTags: event.target.value,
                    }))
                  }
                  placeholder="riesgo, presupuesto, champion, preventa"
                  disabled={!canEdit}
                />
              </label>
              <label>
                Competidores
                <input
                  value={resourceDraft.competitorTags}
                  onChange={(event) =>
                    setResourceDraft((current) => ({
                      ...current,
                      competitorTags: event.target.value,
                    }))
                  }
                  placeholder="competidor_precio, proveedor_actual"
                  disabled={!canEdit}
                />
              </label>
              <label>
                Roles de interlocutor
                <input
                  value={resourceDraft.personaTags}
                  onChange={(event) =>
                    setResourceDraft((current) => ({
                      ...current,
                      personaTags: event.target.value,
                    }))
                  }
                  placeholder="sponsor, decisor, tecnico"
                  disabled={!canEdit}
                />
              </label>
              <label>
                Necesidades / triggers
                <input
                  value={resourceDraft.needTags}
                  onChange={(event) =>
                    setResourceDraft((current) => ({
                      ...current,
                      needTags: event.target.value,
                    }))
                  }
                  placeholder="roi, continuidad, demostracion"
                  disabled={!canEdit}
                />
              </label>
              <label>
                Roles recomendados
                <input
                  value={resourceDraft.recommendedRoleTags}
                  onChange={(event) =>
                    setResourceDraft((current) => ({
                      ...current,
                      recommendedRoleTags: event.target.value,
                    }))
                  }
                  placeholder="seller, manager, presales"
                  disabled={!canEdit}
                />
              </label>
              <label>
                Vigencia
                <input
                  type="date"
                  value={resourceDraft.validUntil}
                  onChange={(event) =>
                    setResourceDraft((current) => ({
                      ...current,
                      validUntil: event.target.value,
                    }))
                  }
                  disabled={!canEdit}
                />
              </label>
              {canEdit ? (
                <button
                  type="submit"
                  className="primary-button"
                  disabled={saving}
                >
                  {saving
                    ? "Guardando..."
                    : selectedResource
                      ? "Actualizar recurso"
                      : "Crear recurso"}
                </button>
              ) : null}
            </form>

            {selectedResource ? (
              <div className="commercial-enable-assets-panel">
                <div className="commercial-enable-block-header">
                  <h3>Activos y evidencia</h3>
                  <span>{selectedResource.assets?.length || 0} adjuntos</span>
                </div>
                {canEdit ? (
                  <label className="commercial-enable-upload-field">
                    <span>
                      {uploadingAssets
                        ? "Procesando adjuntos..."
                        : "Subir archivos de apoyo"}
                    </span>
                    <input type="file" multiple onChange={handleUploadAssets} />
                  </label>
                ) : null}
                <div className="commercial-enable-asset-list">
                  {(selectedResource.assets || []).map((asset) => (
                    <article
                      key={asset.publicId}
                      className="commercial-enable-asset-card"
                    >
                      <div>
                        <strong>{asset.originalFileName}</strong>
                        <p>
                          {asset.mimeType} ·{" "}
                          {Math.round((asset.byteSize || 0) / 1024)} KB
                        </p>
                      </div>
                      <div className="commercial-enable-action-row">
                        <a
                          className="link-button"
                          href={`${api.defaults.baseURL}/api/commercial-enablement/resources/${selectedResource.publicId}/assets/${asset.publicId}/content`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Abrir
                        </a>
                        {canEdit ? (
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => handleDeleteAsset(asset.publicId)}
                          >
                            Eliminar
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
                <div className="commercial-enable-feedback-row">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={
                      feedbackKey === `${selectedResource.publicId}-used`
                    }
                    onClick={() =>
                      handleFeedback(
                        selectedResource.publicId,
                        "used",
                        "module_library",
                        selectedResource.id,
                      )
                    }
                  >
                    Marcar como usado
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={
                      feedbackKey === `${selectedResource.publicId}-helpful`
                    }
                    onClick={() =>
                      handleFeedback(
                        selectedResource.publicId,
                        "helpful",
                        "module_library",
                        selectedResource.id,
                      )
                    }
                  >
                    Me sirvio
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={
                      feedbackKey === `${selectedResource.publicId}-not_helpful`
                    }
                    onClick={() =>
                      handleFeedback(
                        selectedResource.publicId,
                        "not_helpful",
                        "module_library",
                        selectedResource.id,
                      )
                    }
                  >
                    No me sirvio
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {activeTab === "analytics" ? (
        canSeeAnalytics ? (
          <div className="commercial-enable-board-grid single-column">
            <section className="commercial-enable-block">
              <div className="commercial-enable-block-header">
                <h3>Analitica de adopcion</h3>
                <span>
                  {dashboard?.analytics?.totalUsage || 0} usos registrados
                </span>
              </div>
              <div className="commercial-enable-summary-grid compact">
                <SummaryCard
                  label="Feedback positivo"
                  value={dashboard?.analytics?.totalHelpful || 0}
                  helper="Cuantas veces el equipo confirmo utilidad"
                />
                <SummaryCard
                  label="Feedback negativo"
                  value={dashboard?.analytics?.totalNotHelpful || 0}
                  helper="Recursos que requieren refuerzo o reemplazo"
                />
                <SummaryCard
                  label="Obsoletos"
                  value={dashboard?.analytics?.obsoleteResources || 0}
                  helper="Activos marcados para reemplazo"
                />
                <SummaryCard
                  label="Vencidos"
                  value={dashboard?.analytics?.expiredResources || 0}
                  helper="Contenido con fecha de vigencia pasada"
                />
              </div>
            </section>

            <section className="commercial-enable-block">
              <div className="commercial-enable-block-header">
                <h3>Top recursos</h3>
                <span>
                  {dashboard?.analytics?.topResources?.length || 0} destacados
                </span>
              </div>
              <div className="commercial-enable-list">
                {(dashboard?.analytics?.topResources || []).map((resource) => (
                  <article
                    key={resource.publicId}
                    className="commercial-enable-resource-mini-card"
                  >
                    <div className="commercial-enable-item-topline">
                      <strong>{resource.title}</strong>
                      <span>{resource.kindLabel}</span>
                    </div>
                    <p>{resource.summary}</p>
                    <div className="commercial-enable-chip-row">
                      <span>{resource.helpfulCount} utiles</span>
                      <span>{resource.usageCount} usos</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="commercial-enable-block">
              <div className="commercial-enable-block-header">
                <h3>Cobertura por grupo</h3>
                <span>
                  {dashboard?.analytics?.coverageByKind?.length || 0} frentes
                </span>
              </div>
              <div className="commercial-enable-table-wrap">
                <table className="commercial-enable-table">
                  <thead>
                    <tr>
                      <th>Grupo</th>
                      <th>Recursos</th>
                      <th>Feedback util</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(dashboard?.analytics?.coverageByKind || []).map(
                      (item) => (
                        <tr key={item.group}>
                          <td>{item.group}</td>
                          <td>{item.count}</td>
                          <td>{item.helpfulCount}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="commercial-enable-block">
              <div className="commercial-enable-block-header">
                <h3>Cobertura por etapa</h3>
                <span>
                  {dashboard?.analytics?.stageCoverage?.length || 0} etapas
                </span>
              </div>
              <div className="commercial-enable-table-wrap">
                <table className="commercial-enable-table">
                  <thead>
                    <tr>
                      <th>Etapa</th>
                      <th>Recursos activos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(dashboard?.analytics?.stageCoverage || []).map((item) => (
                      <tr key={item.stageCode}>
                        <td>{item.stageCode}</td>
                        <td>{item.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : (
          <div className="empty-state">
            No cuentas con permiso para consultar analitica del modulo.
          </div>
        )
      ) : null}
    </section>
  );
}
