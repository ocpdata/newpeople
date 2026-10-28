import { useCallback, useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { api, getApiErrorMessage } from "../api";
import { ChipPicker } from "./LibraryParts";
import {
  API_BASE,
  buildDraftFromAsset,
  buildDraftFromIntake,
  buildPayload,
  emptyDraft,
  formatBytes,
  getMissingDraftFields,
  getResource,
  toggleValue,
} from "./libraryModel";

const STEP_LABELS = ["Archivo o enlace", "Revisión", "Publicar"];

function Field({ label, required, hint, children }) {
  return (
    <label className="sl-field">
      <span>
        {label}
        {required ? <b aria-hidden="true"> *</b> : null}
      </span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function MaterialFields({ draft, setDraft, catalogs, aiSuggested }) {
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const toggle = (key, code) =>
    setDraft((current) => ({ ...current, [key]: toggleValue(current[key], code) }));

  return (
    <div className="sl-form">
      {aiSuggested ? (
        <p className="sl-callout sl-callout-info">
          La IA propuso estos datos. Corrige solo lo que esté mal.
        </p>
      ) : null}
      <Field label="Título" required>
        <input
          type="text"
          value={draft.title}
          maxLength={190}
          onChange={(event) => set("title", event.target.value)}
        />
      </Field>
      <Field label="Tipo" required>
        <select
          value={draft.assetTypeCode}
          onChange={(event) => set("assetTypeCode", event.target.value)}
        >
          <option value="">Selecciona un tipo</option>
          {(catalogs.asset_type || []).map((option) => (
            <option key={option.code} value={option.code}>
              {option.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="sl-field">
        <span>
          Fabricante <b aria-hidden="true">*</b>
        </span>
        <ChipPicker
          options={catalogs.manufacturer || []}
          selected={draft.manufacturerCodes}
          onToggle={(code) => toggle("manufacturerCodes", code)}
          emptyLabel="No hay fabricantes en el catálogo"
        />
      </div>
      <div className="sl-field">
        <span>Tecnología</span>
        <ChipPicker
          options={catalogs.technology || []}
          selected={draft.technologyCodes}
          onToggle={(code) => toggle("technologyCodes", code)}
          emptyLabel="No hay tecnologías en el catálogo"
        />
        <small>Indica al menos un fabricante o una tecnología.</small>
      </div>
      <Field label="Resumen">
        <textarea
          rows={3}
          value={draft.summary}
          maxLength={4000}
          onChange={(event) => set("summary", event.target.value)}
        />
      </Field>
      <Field label="Cuándo usarlo" hint='Ej. "Ideal para discovery con CIO de salud".'>
        <input
          type="text"
          value={draft.usageNote}
          maxLength={500}
          onChange={(event) => set("usageNote", event.target.value)}
        />
      </Field>
      <details className="sl-more">
        <summary>Más detalles</summary>
        <div className="sl-field">
          <span>Solución</span>
          <ChipPicker
            options={catalogs.solution || []}
            selected={draft.solutionCodes}
            onToggle={(code) => toggle("solutionCodes", code)}
          />
        </div>
        <div className="sl-field">
          <span>Industria</span>
          <ChipPicker
            options={catalogs.industry || []}
            selected={draft.industryCodes}
            onToggle={(code) => toggle("industryCodes", code)}
          />
        </div>
        <Field label="Idioma">
          <select
            value={draft.languageCode}
            onChange={(event) => set("languageCode", event.target.value)}
          >
            {(catalogs.language?.length
              ? catalogs.language
              : [
                  { code: "es", name: "Español" },
                  { code: "en", name: "Inglés" },
                ]
            ).map((option) => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>
      </details>
    </div>
  );
}

function ShareQuestion({ draft, setDraft }) {
  return (
    <fieldset className="sl-fieldset sl-share-question">
      <legend>¿Se puede enviar al cliente?</legend>
      <label className="sl-check">
        <input
          type="radio"
          name="sl-shareable"
          checked={draft.visibilityLevel === "client_safe"}
          onChange={() =>
            setDraft((current) => ({ ...current, visibilityLevel: "client_safe" }))
          }
        />
        Sí, es material para cliente
      </label>
      <label className="sl-check">
        <input
          type="radio"
          name="sl-shareable"
          checked={draft.visibilityLevel !== "client_safe"}
          onChange={() =>
            setDraft((current) => ({
              ...current,
              visibilityLevel:
                current.visibilityLevel === "client_safe"
                  ? "internal_sales"
                  : current.visibilityLevel,
            }))
          }
        />
        No, solo uso interno
      </label>
    </fieldset>
  );
}

function FileDropZone({ onFile, disabled }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  function pick(files) {
    const file = files?.[0];
    if (file) onFile(file);
  }

  return (
    <div
      className={`sl-dropzone ${dragging ? "is-dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) pick(event.dataTransfer.files);
      }}
    >
      <Upload size={28} aria-hidden="true" />
      <p>Arrastra un archivo aquí</p>
      <button
        type="button"
        className="btn-secondary"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        Elegir archivo
      </button>
      <input
        ref={inputRef}
        type="file"
        hidden
        onChange={(event) => {
          pick(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}

export default function UploadModal({ mode, asset, catalogs, onClose, onSaved, notify }) {
  const isEdit = mode === "edit";
  const [step, setStep] = useState(isEdit ? 2 : 1);
  const [sourceMode, setSourceMode] = useState("file");
  const [urlValue, setUrlValue] = useState(
    isEdit ? getResource(asset).link?.url || "" : "",
  );
  const [session, setSession] = useState(null);
  const [duplicateOf, setDuplicateOf] = useState(null);
  const [fileName, setFileName] = useState("");
  const [analysisFailed, setAnalysisFailed] = useState(false);
  const [aiSuggested, setAiSuggested] = useState(false);
  const [replacementFile, setReplacementFile] = useState(null);
  const [draft, setDraft] = useState(() =>
    isEdit ? buildDraftFromAsset(asset) : emptyDraft(),
  );
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState("");
  const [error, setError] = useState("");
  const sessionRef = useRef(null);

  const updateSession = useCallback((value) => {
    sessionRef.current = value;
    setSession(value);
  }, []);

  const cancelSession = useCallback(() => {
    const current = sessionRef.current;
    if (current?.publicId && current.status !== "completed") {
      api
        .post(`${API_BASE}/intake-sessions/${current.publicId}/cancel`)
        .catch(() => undefined);
    }
  }, []);

  function handleClose() {
    if (busy) return;
    cancelSession();
    onClose();
  }

  useEffect(() => {
    function handleKey(event) {
      if (event.key === "Escape" && !busy) {
        cancelSession();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [busy, cancelSession, onClose]);

  async function analyze(currentSession) {
    setBusy(true);
    setBusyMessage("La IA está analizando el documento...");
    setError("");
    setAnalysisFailed(false);
    try {
      const response = await api.post(
        `${API_BASE}/intake-sessions/${currentSession.publicId}/analyze`,
        { hint: "", forceRegenerate: false },
        { timeout: 120000 },
      );
      updateSession(response.data);
      setDraft(buildDraftFromIntake(response.data));
      setAiSuggested(true);
      setStep(2);
    } catch (requestError) {
      setAnalysisFailed(true);
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible analizar el documento. Intenta de nuevo.",
        ),
      );
    } finally {
      setBusy(false);
      setBusyMessage("");
    }
  }

  async function handleFile(file) {
    setBusy(true);
    setBusyMessage("Cargando archivo...");
    setError("");
    setDuplicateOf(null);
    setFileName(file.name);
    try {
      const formData = new FormData();
      formData.append("files", file);
      const response = await api.post(`${API_BASE}/intake-sessions`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 60000,
      });
      const created = response.data;
      updateSession(created);
      if (created.duplicateOf) {
        setDuplicateOf(created.duplicateOf);
        setBusy(false);
        setBusyMessage("");
        return;
      }
      await analyze(created);
    } catch (requestError) {
      setBusy(false);
      setBusyMessage("");
      setError(
        getApiErrorMessage(requestError, "No fue posible cargar el archivo"),
      );
    }
  }

  function handleUrlContinue() {
    let parsed;
    try {
      parsed = new URL(urlValue.trim());
    } catch {
      setError("Escribe una URL válida, por ejemplo https://ejemplo.com/material");
      return;
    }
    setError("");
    setDraft((current) => ({
      ...current,
      sourceType: "url",
      title: current.title || parsed.hostname.replace(/^www\./, ""),
    }));
    setStep(2);
  }

  const missing = getMissingDraftFields(draft);

  async function handleCreate(publish) {
    setBusy(true);
    setBusyMessage(publish ? "Publicando material..." : "Guardando material...");
    setError("");
    let createdId = null;
    try {
      let saved;
      if (sourceMode === "file") {
        const payload = buildPayload(draft, {
          status: publish ? "published" : "archived",
          sourceType: "file",
        });
        await api
          .patch(`${API_BASE}/intake-sessions/${session.publicId}/review`, {
            acceptedPayload: payload,
            reviewConfirmed: true,
          })
          .catch(() => undefined);
        const response = await api.post(
          `${API_BASE}/intake-sessions/${session.publicId}/create-asset`,
          { finalPayload: payload, reviewConfirmed: true },
        );
        saved = response.data;
      } else {
        const payload = buildPayload(draft, {
          status: "archived",
          sourceType: "url",
        });
        const created = await api.post(`${API_BASE}/assets`, payload);
        createdId = created.data.publicId;
        await api.post(`${API_BASE}/assets/${createdId}/links`, {
          url: urlValue.trim(),
          label: payload.title.slice(0, 190),
        });
        saved = publish
          ? (await api.post(`${API_BASE}/assets/${createdId}/activate`, {})).data
          : (await api.get(`${API_BASE}/assets/${createdId}`)).data;
      }
      notify(publish ? "Material publicado." : "Material guardado como desactivado.", "success");
      sessionRef.current = { ...sessionRef.current, status: "completed" };
      onSaved(saved);
    } catch (requestError) {
      if (createdId) {
        api.delete(`${API_BASE}/assets/${createdId}`).catch(() => undefined);
      }
      setError(
        getApiErrorMessage(requestError, "No fue posible guardar el material"),
      );
    } finally {
      setBusy(false);
      setBusyMessage("");
    }
  }

  async function handleEditSave() {
    setBusy(true);
    setBusyMessage("Guardando cambios...");
    setError("");
    try {
      const payload = buildPayload(draft, {
        status: asset.status === "published" ? "published" : "archived",
        sourceType: asset.sourceType,
      });
      await api.put(`${API_BASE}/assets/${asset.publicId}`, payload);
      const resource = getResource(asset);
      if (replacementFile && resource.kind === "file") {
        const formData = new FormData();
        formData.append("file", replacementFile);
        await api.put(
          `${API_BASE}/assets/${asset.publicId}/files/${resource.file.publicId}`,
          formData,
          { headers: { "Content-Type": "multipart/form-data" }, timeout: 120000 },
        );
      }
      if (resource.kind === "link" && urlValue.trim() !== resource.link.url) {
        await api.put(
          `${API_BASE}/assets/${asset.publicId}/links/${resource.link.publicId}`,
          { url: urlValue.trim(), label: payload.title.slice(0, 190) },
        );
      }
      const detail = await api.get(`${API_BASE}/assets/${asset.publicId}`);
      notify("Cambios guardados.", "success");
      onSaved(detail.data);
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, "No fue posible guardar los cambios"),
      );
    } finally {
      setBusy(false);
      setBusyMessage("");
    }
  }

  const resource = isEdit ? getResource(asset) : { kind: "none" };
  const isUrlMaterial = isEdit ? resource.kind === "link" : sourceMode === "url";

  return (
    <div className="modal-overlay modal-overlay-elevated">
      <div
        className="sl-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sl-modal-title"
      >
        <header className="sl-modal-header">
          <h2 id="sl-modal-title">
            {isEdit ? "Editar material" : "Subir material"}
          </h2>
          <button
            type="button"
            className="btn-tertiary"
            onClick={handleClose}
            disabled={busy}
          >
            Cerrar
          </button>
        </header>

        {!isEdit ? (
          <ol className="sl-steps" aria-label="Pasos">
            {STEP_LABELS.map((label, index) => (
              <li
                key={label}
                className={step === index + 1 ? "is-current" : step > index + 1 ? "is-done" : ""}
                aria-current={step === index + 1 ? "step" : undefined}
              >
                {index + 1}. {label}
              </li>
            ))}
          </ol>
        ) : null}

        <div className="sl-modal-body">
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          {busy ? (
            <p className="sl-busy" role="status">
              {busyMessage || "Procesando..."}
            </p>
          ) : null}

          {step === 1 && !isEdit ? (
            <div className="sl-step">
              <div className="sl-segmented" role="tablist" aria-label="Origen del material">
                <button
                  type="button"
                  role="tab"
                  aria-selected={sourceMode === "file"}
                  className={sourceMode === "file" ? "is-active" : ""}
                  onClick={() => setSourceMode("file")}
                  disabled={busy}
                >
                  Archivo
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sourceMode === "url"}
                  className={sourceMode === "url" ? "is-active" : ""}
                  onClick={() => setSourceMode("url")}
                  disabled={busy}
                >
                  Enlace (URL)
                </button>
              </div>
              {sourceMode === "file" ? (
                <>
                  <FileDropZone onFile={handleFile} disabled={busy} />
                  {fileName ? (
                    <p className="sl-muted">
                      {fileName}
                      {session?.sourceSizeBytes
                        ? ` · ${formatBytes(session.sourceSizeBytes)}`
                        : ""}
                    </p>
                  ) : null}
                  {duplicateOf ? (
                    <div className="sl-callout sl-callout-warning" role="alert">
                      <p>
                        Ya existe un material con este mismo archivo:{" "}
                        <strong>{duplicateOf.title}</strong>
                        {duplicateOf.isActive ? "" : " (desactivado)"}. Para
                        actualizarlo, edítalo y reemplaza su archivo.
                      </p>
                      <div className="sl-inline-actions">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => analyze(session).then(() => setDuplicateOf(null))}
                          disabled={busy}
                        >
                          Subir de todos modos
                        </button>
                        <button
                          type="button"
                          className="btn-tertiary"
                          onClick={handleClose}
                          disabled={busy}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {analysisFailed && session ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => analyze(session)}
                      disabled={busy}
                    >
                      Reintentar análisis
                    </button>
                  ) : null}
                </>
              ) : (
                <div className="sl-form">
                  <Field label="URL del material" required hint="Los materiales con enlace vencen a los 30 días y se pueden renovar.">
                    <input
                      type="url"
                      value={urlValue}
                      placeholder="https://"
                      onChange={(event) => setUrlValue(event.target.value)}
                    />
                  </Field>
                  <div className="sl-inline-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleUrlContinue}
                      disabled={busy || !urlValue.trim()}
                    >
                      Continuar
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="sl-step">
              <MaterialFields
                draft={draft}
                setDraft={setDraft}
                catalogs={catalogs}
                aiSuggested={aiSuggested && !isEdit}
              />
              {isEdit ? (
                <>
                  <ShareQuestion draft={draft} setDraft={setDraft} />
                  <div className="sl-field">
                    <span>{isUrlMaterial ? "URL del material" : "Archivo"}</span>
                    {isUrlMaterial ? (
                      <input
                        type="url"
                        value={urlValue}
                        onChange={(event) => setUrlValue(event.target.value)}
                      />
                    ) : (
                      <>
                        <p className="sl-muted">
                          {resource.file?.originalFileName}{" "}
                          {replacementFile
                            ? `→ ${replacementFile.name}`
                            : ""}
                        </p>
                        <input
                          type="file"
                          onChange={(event) =>
                            setReplacementFile(event.target.files?.[0] || null)
                          }
                        />
                        <small>
                          Reemplazar el archivo crea una nueva versión del mismo
                          material.
                        </small>
                      </>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {step === 3 && !isEdit ? (
            <div className="sl-step">
              <ShareQuestion draft={draft} setDraft={setDraft} />
              {isUrlMaterial ? (
                <p className="sl-callout sl-callout-info">
                  Este material tiene enlace: vence a los 30 días y se renueva
                  al reactivarlo.
                </p>
              ) : null}
              <p className="sl-muted">
                Si no lo publicas ahora, queda desactivado y solo tú y los
                gestores lo ven.
              </p>
            </div>
          ) : null}
        </div>

        <footer className="sl-modal-footer">
          {missing.length && step >= 2 ? (
            <span className="sl-missing" role="status">
              Falta: {missing.join(", ")}
            </span>
          ) : (
            <span />
          )}
          <div className="sl-inline-actions">
            {step === 2 && !isEdit ? (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setStep(1)}
                  disabled={busy}
                >
                  Atrás
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setStep(3)}
                  disabled={busy || missing.length > 0}
                >
                  Siguiente
                </button>
              </>
            ) : null}
            {step === 3 && !isEdit ? (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setStep(2)}
                  disabled={busy}
                >
                  Atrás
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => handleCreate(false)}
                  disabled={busy || missing.length > 0}
                >
                  Guardar desactivado
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => handleCreate(true)}
                  disabled={busy || missing.length > 0}
                >
                  Publicar
                </button>
              </>
            ) : null}
            {isEdit ? (
              <button
                type="button"
                className="btn-primary"
                onClick={handleEditSave}
                disabled={busy || missing.length > 0}
              >
                Guardar cambios
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}
