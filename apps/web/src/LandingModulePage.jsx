import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "./api";
import "./landing-module.css";

const DEFAULT_FORM_SCHEMA = {
  form_schema_version: 1,
  submit: {
    button_text: "Registrarme",
    success_message: "Gracias por registrarte",
    redirect_url: null,
  },
  fields: [
    {
      key: "first_name",
      label: "Nombre",
      type: "text",
      required: true,
      placeholder: "Tu nombre",
      default_value: null,
      options: [],
      validation: {
        min_length: 2,
        max_length: 120,
        regex: null,
      },
      crm_map: {
        entity: "contact",
        field: "first_name",
        required_for_entity: true,
      },
    },
    {
      key: "email",
      label: "Correo",
      type: "email",
      required: true,
      placeholder: "correo@empresa.com",
      default_value: null,
      options: [],
      validation: {
        min_length: 5,
        max_length: 180,
        regex: null,
      },
      crm_map: {
        entity: "contact",
        field: "email",
        required_for_entity: true,
      },
    },
    {
      key: "company_name",
      label: "Empresa",
      type: "text",
      required: false,
      placeholder: "Nombre de empresa",
      default_value: null,
      options: [],
      validation: {
        min_length: 2,
        max_length: 180,
        regex: null,
      },
      crm_map: {
        entity: "account",
        field: "name",
        required_for_entity: false,
      },
    },
  ],
};

const DEFAULT_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Landing</title>
    <style>
      body { font-family: 'Segoe UI', Tahoma, sans-serif; margin: 0; background: linear-gradient(135deg,#eff5ff,#f9fbff); color: #123; }
      .wrap { max-width: 860px; margin: 0 auto; padding: 48px 20px 64px; }
      .hero { background: #fff; border: 1px solid #d8e3f5; border-radius: 16px; padding: 28px; box-shadow: 0 16px 36px rgba(18,57,119,.08); }
      h1 { margin: 0 0 10px; color: #133a6f; }
      p { margin: 0 0 16px; color: #36537a; }
      form { display: grid; gap: 12px; margin-top: 20px; }
      input, button { border-radius: 10px; border: 1px solid #b6c9e6; padding: 10px 12px; font-size: 14px; }
      button { background: #0f4d9d; color: #fff; border-color: #0f4d9d; font-weight: 600; cursor: pointer; }
      button:hover { background: #0b3f82; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <section class="hero">
        <h1>Webinar F5</h1>
        <p>Regístrate para asegurar tu lugar.</p>
        <form data-landing-form>
          <input name="first_name" placeholder="Nombre" />
          <input name="email" type="email" placeholder="Correo" />
          <input name="company_name" placeholder="Empresa" />
          <input name="hp_field" type="text" style="display:none" tabindex="-1" autocomplete="off" />
          <button type="submit">Registrarme</button>
        </form>
      </section>
    </div>
  </body>
</html>`;

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function parseJsonOrThrow(text, fallbackMessage) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    throw new Error(fallbackMessage);
  }
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 120);
}

export default function LandingModulePage() {
  const [activeTab, setActiveTab] = useState("events");

  const [globalError, setGlobalError] = useState("");
  const [globalSuccess, setGlobalSuccess] = useState("");

  const [isLoadingList, setIsLoadingList] = useState(false);
  const [landingItems, setLandingItems] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [selectedLandingId, setSelectedLandingId] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState(null);

  const [landingDetail, setLandingDetail] = useState(null);
  const [selectedVersionId, setSelectedVersionId] = useState(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const [newEventId, setNewEventId] = useState("");
  const [newEventName, setNewEventName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newSourceType, setNewSourceType] = useState("manual_edit");

  const [editorHtml, setEditorHtml] = useState(DEFAULT_HTML);
  const [editorFormSchemaText, setEditorFormSchemaText] = useState(
    prettyJson(DEFAULT_FORM_SCHEMA),
  );
  const [importUrl, setImportUrl] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [isSavingEditor, setIsSavingEditor] = useState(false);

  const [submissions, setSubmissions] = useState([]);
  const [isLoadingSubmissions, setIsLoadingSubmissions] = useState(false);
  const [crmStatusFilter, setCrmStatusFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const selectedVersion = useMemo(() => {
    const versions = Array.isArray(landingDetail?.versions) ? landingDetail.versions : [];
    return versions.find((version) => Number(version.id) === Number(selectedVersionId)) || null;
  }, [landingDetail, selectedVersionId]);

  const selectedPublicUrl = useMemo(() => {
    const slug = String(landingDetail?.landing_page?.slug || "").trim();
    if (!slug) return "";
    const apiBaseUrl = String(api.defaults.baseURL || window.location.origin)
      .trim()
      .replace(/\/+$/, "");
    return `${apiBaseUrl}/landing/${slug}.html`;
  }, [landingDetail]);

  const pushSuccess = useCallback((message) => {
    setGlobalSuccess(message);
    setGlobalError("");
  }, []);

  const pushError = useCallback((message) => {
    setGlobalError(message);
    setGlobalSuccess("");
  }, []);

  const loadLandingList = useCallback(async () => {
    try {
      setIsLoadingList(true);
      const { data } = await api.get("/api/landing/v1/landing-pages", {
        params: {
          page: 1,
          page_size: 100,
          status: statusFilter || undefined,
          search: searchText || undefined,
        },
      });
      const items = Array.isArray(data?.items) ? data.items : [];
      setLandingItems(items);

      if (!selectedLandingId && items[0]?.id) {
        setSelectedLandingId(Number(items[0].id));
        setSelectedEventId(Number(items[0].event_id));
      }
    } catch (error) {
      pushError(getApiErrorMessage(error, "No fue posible cargar las landings"));
    } finally {
      setIsLoadingList(false);
    }
  }, [pushError, searchText, selectedLandingId, statusFilter]);

  const loadLandingDetail = useCallback(
    async (landingId) => {
      if (!landingId) return;
      try {
        setIsLoadingDetail(true);
        const { data } = await api.get(`/api/landing/v1/landing-pages/${landingId}`);
        setLandingDetail(data || null);
        const currentVersionId = Number(data?.landing_page?.current_version_id || 0);
        const versions = Array.isArray(data?.versions) ? data.versions : [];
        const nextVersionId = currentVersionId || Number(versions[0]?.id || 0) || null;
        setSelectedVersionId(nextVersionId);

        const currentVersion = versions.find((version) => Number(version.id) === Number(nextVersionId)) || versions[0] || null;
        if (currentVersion) {
          setEditorHtml(String(currentVersion.html_content || DEFAULT_HTML));
          const schemaValue =
            typeof currentVersion.form_schema_json === "string"
              ? parseJsonOrThrow(currentVersion.form_schema_json, "Schema JSON invalido en API")
              : currentVersion.form_schema_json || DEFAULT_FORM_SCHEMA;
          setEditorFormSchemaText(prettyJson(schemaValue));
        }
      } catch (error) {
        pushError(getApiErrorMessage(error, "No fue posible cargar el detalle de la landing"));
      } finally {
        setIsLoadingDetail(false);
      }
    },
    [pushError],
  );

  const loadSubmissions = useCallback(async () => {
    if (!selectedEventId) {
      setSubmissions([]);
      return;
    }

    try {
      setIsLoadingSubmissions(true);
      const { data } = await api.get(`/api/landing/v1/events/${selectedEventId}/submissions`, {
        params: {
          page: 1,
          page_size: 100,
          crm_status: crmStatusFilter || undefined,
          from: fromDate || undefined,
          to: toDate || undefined,
        },
      });

      setSubmissions(Array.isArray(data?.items) ? data.items : []);
    } catch (error) {
      pushError(getApiErrorMessage(error, "No fue posible cargar los registros del evento"));
    } finally {
      setIsLoadingSubmissions(false);
    }
  }, [crmStatusFilter, fromDate, pushError, selectedEventId, toDate]);

  useEffect(() => {
    loadLandingList();
  }, [loadLandingList]);

  useEffect(() => {
    if (!selectedLandingId) return;
    loadLandingDetail(selectedLandingId);
  }, [loadLandingDetail, selectedLandingId]);

  useEffect(() => {
    if (activeTab !== "submissions") return;
    loadSubmissions();
  }, [activeTab, loadSubmissions]);

  function onSelectLanding(item) {
    setSelectedLandingId(Number(item.id));
    setSelectedEventId(Number(item.event_id));
    setActiveTab("editor");
    setGlobalError("");
    setGlobalSuccess("");
  }

  async function handleCreateOrUpsertLanding(event) {
    event.preventDefault();
    setGlobalError("");
    setGlobalSuccess("");

    const eventId = Number(newEventId || 0);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      pushError("Debes indicar un Event ID válido");
      return;
    }
    if (!String(newEventName || "").trim()) {
      pushError("Debes indicar el nombre del evento");
      return;
    }

    const normalizedSlug = normalizeSlug(newSlug);
    if (!normalizedSlug || normalizedSlug.length < 3) {
      pushError("El slug debe tener al menos 3 caracteres alfanuméricos");
      return;
    }

    let parsedSchema;
    try {
      parsedSchema = parseJsonOrThrow(
        editorFormSchemaText,
        "El schema del formulario no es JSON válido",
      );
    } catch (error) {
      pushError(error.message);
      return;
    }

    try {
      setIsSavingEditor(true);
      const { data } = await api.put(`/api/landing/v1/events/${eventId}/landing`, {
        eventName: String(newEventName || "").trim(),
        slug: normalizedSlug,
        source_type: newSourceType,
        initial_prompt: null,
        html_content: String(editorHtml || "").trim() || DEFAULT_HTML,
        source_url: null,
        form_schema: parsedSchema,
      });

      const landingId = Number(data?.landing_page?.id || 0);
      if (landingId > 0) {
        setSelectedLandingId(landingId);
        setSelectedEventId(Number(data?.landing_page?.event_id || eventId));
        setActiveTab("editor");
        await loadLandingList();
        await loadLandingDetail(landingId);
      }

      pushSuccess("Landing guardada correctamente");
    } catch (error) {
      pushError(getApiErrorMessage(error, "No fue posible crear/actualizar la landing"));
    } finally {
      setIsSavingEditor(false);
    }
  }

  async function handleSaveCurrentVersion() {
    if (!selectedLandingId || !selectedVersionId) {
      pushError("Selecciona una landing y versión para guardar");
      return;
    }

    let parsedSchema;
    try {
      parsedSchema = parseJsonOrThrow(
        editorFormSchemaText,
        "El schema del formulario no es JSON válido",
      );
    } catch (error) {
      pushError(error.message);
      return;
    }

    try {
      setIsSavingEditor(true);
      await api.patch(
        `/api/landing/v1/landing-pages/${selectedLandingId}/versions/${selectedVersionId}`,
        {
          html_content: String(editorHtml || "").trim(),
          form_schema: parsedSchema,
          publish_notes: null,
        },
      );
      await loadLandingDetail(selectedLandingId);
      pushSuccess("Versión actualizada");
    } catch (error) {
      pushError(getApiErrorMessage(error, "No fue posible guardar la versión"));
    } finally {
      setIsSavingEditor(false);
    }
  }

  async function handlePublishVersion() {
    if (!selectedLandingId || !selectedVersionId) {
      pushError("Selecciona una landing y versión para publicar");
      return;
    }

    try {
      setIsSavingEditor(true);
      await api.post(`/api/landing/v1/landing-pages/${selectedLandingId}/publish`, {
        version_id: Number(selectedVersionId),
      });
      await loadLandingList();
      await loadLandingDetail(selectedLandingId);
      pushSuccess("Landing publicada");
    } catch (error) {
      pushError(getApiErrorMessage(error, "No fue posible publicar la landing"));
    } finally {
      setIsSavingEditor(false);
    }
  }

  async function handleImportUrl(event) {
    event.preventDefault();
    if (!selectedLandingId) {
      pushError("Primero selecciona una landing");
      return;
    }
    if (!String(importUrl || "").trim()) {
      pushError("Debes indicar una URL para importar");
      return;
    }

    try {
      setIsSavingEditor(true);
      const { data } = await api.post(
        `/api/landing/v1/landing-pages/${selectedLandingId}/import-url`,
        {
          source_url: String(importUrl || "").trim(),
        },
      );
      setImportUrl("");
      await loadLandingDetail(selectedLandingId);
      if (data?.version_id) {
        setSelectedVersionId(Number(data.version_id));
      }
      pushSuccess("Importación completada");
    } catch (error) {
      pushError(getApiErrorMessage(error, "No fue posible importar la URL"));
    } finally {
      setIsSavingEditor(false);
    }
  }

  async function handleUploadHtml(event) {
    event.preventDefault();
    if (!selectedLandingId) {
      pushError("Primero selecciona una landing");
      return;
    }
    if (!uploadFile) {
      pushError("Selecciona un archivo HTML para subir");
      return;
    }

    try {
      setIsSavingEditor(true);
      const payload = new FormData();
      payload.append("file", uploadFile);
      payload.append("form_schema", editorFormSchemaText);
      const { data } = await api.post(
        `/api/landing/v1/landing-pages/${selectedLandingId}/versions/html-upload`,
        payload,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        },
      );

      setUploadFile(null);
      await loadLandingDetail(selectedLandingId);
      if (data?.version_id) {
        setSelectedVersionId(Number(data.version_id));
      }
      pushSuccess("Archivo HTML subido como nueva versión");
    } catch (error) {
      pushError(getApiErrorMessage(error, "No fue posible subir el archivo HTML"));
    } finally {
      setIsSavingEditor(false);
    }
  }

  async function handleReprocessSubmission(submissionId) {
    try {
      await api.post(`/api/landing/v1/submissions/${submissionId}/reprocess`, {
        force: true,
      });
      pushSuccess("Registro enviado a reproceso");
      await loadSubmissions();
    } catch (error) {
      pushError(getApiErrorMessage(error, "No fue posible reprocesar el registro"));
    }
  }

  function useVersionInEditor(version) {
    if (!version) return;
    setSelectedVersionId(Number(version.id));
    setEditorHtml(String(version.html_content || DEFAULT_HTML));
    const schemaValue =
      typeof version.form_schema_json === "string"
        ? parseJsonOrThrow(version.form_schema_json, "Schema JSON inválido")
        : version.form_schema_json || DEFAULT_FORM_SCHEMA;
    setEditorFormSchemaText(prettyJson(schemaValue));
  }

  return (
    <div className="landing-module-page">
      <header className="landing-module-head">
        <div>
          <h2>Landing por evento</h2>
          <p>
            Crea, edita y publica landings; captura registros y revisa la integración CRM.
          </p>
        </div>
      </header>

      <div className="landing-module-tabs" role="tablist" aria-label="Secciones landing">
        <button
          className={activeTab === "events" ? "is-active" : ""}
          onClick={() => setActiveTab("events")}
        >
          Eventos / Landings
        </button>
        <button
          className={activeTab === "editor" ? "is-active" : ""}
          onClick={() => setActiveTab("editor")}
        >
          Editor / Publicación
        </button>
        <button
          className={activeTab === "submissions" ? "is-active" : ""}
          onClick={() => setActiveTab("submissions")}
        >
          Registros por evento
        </button>
      </div>

      {globalError ? <div className="landing-alert landing-alert-error">{globalError}</div> : null}
      {globalSuccess ? <div className="landing-alert landing-alert-success">{globalSuccess}</div> : null}

      {activeTab === "events" ? (
        <section className="landing-panel">
          <div className="landing-grid-two">
            <article className="landing-card">
              <h3>Crear o actualizar landing por evento</h3>
              <form className="landing-form-grid" onSubmit={handleCreateOrUpsertLanding}>
                <label>
                  Event ID
                  <input
                    type="number"
                    value={newEventId}
                    onChange={(event) => setNewEventId(event.target.value)}
                    placeholder="88"
                    min="1"
                    required
                  />
                </label>
                <label>
                  Nombre del evento
                  <input
                    type="text"
                    value={newEventName}
                    onChange={(event) => setNewEventName(event.target.value)}
                    placeholder="Webinar F5"
                    required
                  />
                </label>
                <label>
                  Slug
                  <input
                    type="text"
                    value={newSlug}
                    onChange={(event) => setNewSlug(normalizeSlug(event.target.value))}
                    placeholder="webinarf5"
                    required
                  />
                </label>
                <label>
                  Fuente
                  <select
                    value={newSourceType}
                    onChange={(event) => setNewSourceType(event.target.value)}
                  >
                    <option value="manual_edit">Edición manual</option>
                    <option value="ai">IA</option>
                    <option value="html_upload">HTML</option>
                    <option value="url_import_once">URL</option>
                  </select>
                </label>
                <div className="landing-form-actions">
                  <button type="submit" disabled={isSavingEditor}>
                    {isSavingEditor ? "Guardando..." : "Guardar landing"}
                  </button>
                </div>
              </form>
            </article>

            <article className="landing-card">
              <h3>Landings registradas</h3>
              <div className="landing-list-filters">
                <input
                  type="text"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Buscar por evento, slug o event id"
                />
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="">Todos los estados</option>
                  <option value="draft">Borrador</option>
                  <option value="published">Publicada</option>
                  <option value="archived">Archivada</option>
                </select>
                <button type="button" onClick={loadLandingList} disabled={isLoadingList}>
                  {isLoadingList ? "Cargando..." : "Refrescar"}
                </button>
              </div>

              <div className="landing-list-wrap">
                <table className="landing-table">
                  <thead>
                    <tr>
                      <th>Evento</th>
                      <th>Slug</th>
                      <th>Estado</th>
                      <th>Versión</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {landingItems.length === 0 ? (
                      <tr>
                        <td colSpan={5}>No hay landings registradas</td>
                      </tr>
                    ) : (
                      landingItems.map((item) => (
                        <tr
                          key={item.id}
                          className={
                            Number(selectedLandingId) === Number(item.id)
                              ? "is-selected"
                              : ""
                          }
                        >
                          <td>
                            <strong>{item.event_name}</strong>
                            <div className="landing-muted">Event ID: {item.event_id}</div>
                          </td>
                          <td>{item.slug}</td>
                          <td>{item.status}</td>
                          <td>
                            {item.current_version_number
                              ? `v${item.current_version_number}`
                              : "-"}
                          </td>
                          <td>
                            <button type="button" onClick={() => onSelectLanding(item)}>
                              Abrir
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </section>
      ) : null}

      {activeTab === "editor" ? (
        <section className="landing-panel">
          <div className="landing-grid-two landing-grid-editor">
            <article className="landing-card">
              <h3>Editor y publicación</h3>
              {!selectedLandingId ? (
                <p className="landing-muted">Selecciona una landing desde la pestaña Eventos/Landings.</p>
              ) : (
                <>
                  <div className="landing-meta-grid">
                    <div>
                      <span className="landing-muted">Landing ID</span>
                      <strong>{selectedLandingId}</strong>
                    </div>
                    <div>
                      <span className="landing-muted">Event ID</span>
                      <strong>{landingDetail?.landing_page?.event_id || "-"}</strong>
                    </div>
                    <div>
                      <span className="landing-muted">Slug</span>
                      <strong>{landingDetail?.landing_page?.slug || "-"}</strong>
                    </div>
                    <div>
                      <span className="landing-muted">Estado</span>
                      <strong>{landingDetail?.landing_page?.status || "-"}</strong>
                    </div>
                  </div>

                  <div className="landing-inline-actions">
                    <select
                      value={selectedVersionId || ""}
                      onChange={(event) => {
                        const nextId = Number(event.target.value || 0);
                        setSelectedVersionId(nextId || null);
                        const version = (landingDetail?.versions || []).find(
                          (entry) => Number(entry.id) === nextId,
                        );
                        if (version) {
                          useVersionInEditor(version);
                        }
                      }}
                    >
                      {(landingDetail?.versions || []).map((version) => (
                        <option key={version.id} value={version.id}>
                          v{version.version_number} · {version.source_type}
                          {version.is_active ? " · activa" : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleSaveCurrentVersion}
                      disabled={isSavingEditor || isLoadingDetail}
                    >
                      Guardar versión
                    </button>
                    <button
                      type="button"
                      onClick={handlePublishVersion}
                      disabled={isSavingEditor || isLoadingDetail}
                    >
                      Publicar
                    </button>
                    {selectedPublicUrl ? (
                      <a href={selectedPublicUrl} target="_blank" rel="noreferrer">
                        Ver landing
                      </a>
                    ) : null}
                  </div>

                  <label className="landing-label-block">
                    HTML
                    <textarea
                      value={editorHtml}
                      onChange={(event) => setEditorHtml(event.target.value)}
                      rows={14}
                    />
                  </label>

                  <label className="landing-label-block">
                    Form schema (JSON)
                    <textarea
                      value={editorFormSchemaText}
                      onChange={(event) => setEditorFormSchemaText(event.target.value)}
                      rows={14}
                    />
                  </label>

                  <form className="landing-inline-actions" onSubmit={handleImportUrl}>
                    <input
                      type="url"
                      value={importUrl}
                      onChange={(event) => setImportUrl(event.target.value)}
                      placeholder="https://sitio.com/landing"
                    />
                    <button type="submit" disabled={isSavingEditor}>
                      Importar URL (una vez)
                    </button>
                  </form>

                  <form className="landing-inline-actions" onSubmit={handleUploadHtml}>
                    <input
                      type="file"
                      accept=".html,text/html"
                      onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
                    />
                    <button type="submit" disabled={isSavingEditor}>
                      Subir HTML como nueva versión
                    </button>
                  </form>
                </>
              )}
            </article>

            <article className="landing-card">
              <h3>Vista previa</h3>
              <div className="landing-preview-wrap">
                <iframe
                  title="Vista previa landing"
                  srcDoc={editorHtml || DEFAULT_HTML}
                  sandbox="allow-forms allow-same-origin allow-scripts"
                />
              </div>
              {selectedVersion ? (
                <p className="landing-muted">
                  Versión seleccionada: v{selectedVersion.version_number} · {selectedVersion.source_type}
                </p>
              ) : null}
            </article>
          </div>
        </section>
      ) : null}

      {activeTab === "submissions" ? (
        <section className="landing-panel">
          <article className="landing-card">
            <h3>Registros por evento</h3>
            <div className="landing-inline-actions landing-submission-filters">
              <input
                type="number"
                value={selectedEventId || ""}
                onChange={(event) => setSelectedEventId(Number(event.target.value || 0) || null)}
                placeholder="Event ID"
              />
              <select
                value={crmStatusFilter}
                onChange={(event) => setCrmStatusFilter(event.target.value)}
              >
                <option value="">Todos los estados</option>
                <option value="pending">pending</option>
                <option value="processed">processed</option>
                <option value="failed">failed</option>
                <option value="duplicate_review">duplicate_review</option>
              </select>
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
              />
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
              />
              <button type="button" onClick={loadSubmissions} disabled={isLoadingSubmissions}>
                {isLoadingSubmissions ? "Cargando..." : "Buscar"}
              </button>
            </div>

            <div className="landing-list-wrap">
              <table className="landing-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Contacto</th>
                    <th>Cuenta</th>
                    <th>Estado CRM</th>
                    <th>IDs CRM</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {submissions.length === 0 ? (
                    <tr>
                      <td colSpan={6}>No hay registros para este evento</td>
                    </tr>
                  ) : (
                    submissions.map((submission) => {
                      const contact = submission.payload_normalized?.contact || {};
                      const account = submission.payload_normalized?.account || {};
                      return (
                        <tr key={submission.submission_id}>
                          <td>{new Date(submission.submitted_at).toLocaleString()}</td>
                          <td>
                            <strong>
                              {contact.first_name || ""} {contact.last_name || ""}
                            </strong>
                            <div className="landing-muted">{contact.email || "-"}</div>
                            <div className="landing-muted">{contact.phone || contact.mobile || ""}</div>
                          </td>
                          <td>
                            <strong>{account.name || "-"}</strong>
                            <div className="landing-muted">{account.website || ""}</div>
                          </td>
                          <td>
                            <span className={`landing-status status-${submission.crm_processing_status}`}>
                              {submission.crm_processing_status}
                            </span>
                            {submission.crm_error_message ? (
                              <div className="landing-error-inline">{submission.crm_error_message}</div>
                            ) : null}
                          </td>
                          <td>
                            <div className="landing-muted">
                              lead: {submission.crm_links?.lead_id || "-"}
                            </div>
                            <div className="landing-muted">
                              account: {submission.crm_links?.account_id || "-"}
                            </div>
                            <div className="landing-muted">
                              contact: {submission.crm_links?.contact_id || "-"}
                            </div>
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() => handleReprocessSubmission(submission.submission_id)}
                            >
                              Reprocesar
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      ) : null}
    </div>
  );
}
