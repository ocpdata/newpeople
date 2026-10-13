import { useEffect, useState } from "react";
import { api, getApiErrorMessage } from "./api";

const endpoint = "/api/mi-agent/coach/admin/semantic-classifier-prompts";
const instructionCharacterLimit = 8000;
const labels = {
  coach: "Coach",
  customer_account: "Cliente existente",
  prospect: "Cuenta nueva",
};

function dateLabel(value) {
  return value ? new Date(value).toLocaleString() : "Sin fecha";
}

export default function SemanticClassifierSection() {
  const [prompts, setPrompts] = useState([]);
  const [busy, setBusy] = useState("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.get(endpoint).then((response) => {
      if (!cancelled) {
        setPrompts(response.data.prompts.map((prompt) => ({
          ...prompt, draft: prompt.instruction,
        })));
      }
    }).catch((requestError) => {
      if (!cancelled) {
        setError(getApiErrorMessage(requestError, "No se pudieron cargar las instrucciones de B3"));
      }
    }).finally(() => {
      if (!cancelled) setBusy("");
    });
    return () => { cancelled = true; };
  }, []);

  async function reload() {
    setBusy("load");
    setError("");
    setNotice("");
    try {
      const response = await api.get(endpoint);
      setPrompts(response.data.prompts.map((prompt) => ({
        ...prompt, draft: prompt.instruction,
      })));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No se pudieron recargar las instrucciones de B3"));
    } finally {
      setBusy("");
    }
  }

  function updateDraft(channel, draft) {
    setPrompts((current) => current.map((prompt) =>
      prompt.channel === channel ? { ...prompt, draft } : prompt,
    ));
  }

  async function save(prompt, revision) {
    if (revision && !window.confirm(
      `¿Restaurar la versión ${revision.version} de ${labels[prompt.channel]}? Se guardará como una nueva versión y se conservará el historial.`,
    )) return;
    setBusy(prompt.channel);
    setError("");
    setNotice("");
    try {
      const response = revision
        ? await api.post(
            `${endpoint}/${prompt.channel}/revisions/${revision.version}/restore`,
            { expectedVersion: prompt.version },
          )
        : await api.put(`${endpoint}/${prompt.channel}`, {
            instruction: prompt.draft, expectedVersion: prompt.version,
          });
      const saved = response.data.prompt;
      setPrompts((current) => current.map((item) =>
        item.channel === saved.channel
          ? {
              ...saved,
              draft: saved.instruction,
              revisions: [{
                version: saved.version,
                instruction: saved.instruction,
                createdByUserId: saved.updatedByUserId,
                createdAt: saved.updatedAt,
              }, ...item.revisions],
            }
          : item,
      ));
      setNotice(saved.connected
        ? "Versión guardada. Se aplicará a la clasificación de los nuevos turnos de Cliente existente."
        : "Versión guardada sin conexión. No afecta la ejecución de este canal.");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No se pudieron guardar las instrucciones de B3"));
    } finally {
      setBusy("");
    }
  }

  function loadDefault(prompt) {
    if (!window.confirm(
      "¿Cargar las instrucciones predeterminadas? Solo reemplaza el editor; guarda para registrar una nueva versión.",
    )) return;
    updateDraft(prompt.channel, prompt.initialInstruction);
    setNotice("Instrucciones predeterminadas cargadas en el editor. Guarda para registrar el cambio.");
  }

  return (
    <details className="mi-agent-semantic-classifier-prompts">
      <summary className="mi-agent-intent-governance-summary">
        <strong role="heading" aria-level={4}>Clasificador semántico · B3</strong>
        <span>Instrucciones versionadas para interpretar qué solicita el vendedor.</span>
      </summary>
      <div className="mi-agent-intent-governance-content">
        <p>
          B3 clasifica la intención; B6 planifica las consultas. Estas instrucciones
          no conceden permisos ni cambian el catálogo, los umbrales, el esquema de
          respuesta o las confirmaciones del servidor.
        </p>
        {busy === "load" ? <p role="status">Cargando instrucciones de B3...</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button
          type="button"
          className="mi-agent-secondary-button"
          disabled={Boolean(busy)}
          onClick={reload}
        >
          Recargar instrucciones de B3
        </button>
        {prompts.map((prompt) => (
          <article className="mi-agent-admin-rule-group" key={prompt.channel}>
            <h4>{labels[prompt.channel]}</h4>
            <p>{prompt.connected
              ? "Conectado a B3. La versión guardada se aplica a los turnos nuevos."
              : "Configuración preparada · sin efecto en ejecución. Guardar no conecta este canal."}</p>
            {prompt.channel === "coach" ? (
              <p>El clasificador actual de Coach continúa usando sus instrucciones existentes.</p>
            ) : prompt.channel === "prospect" ? (
              <p>Texto propuesto para uso futuro; no implica un clasificador conectado.</p>
            ) : null}
            <p>
              {prompt.source === "default" ? "Versión inicial" : `Versión ${prompt.version}`}
              {" · "}{dateLabel(prompt.updatedAt)}
              {" · "}{prompt.updatedByUserId ? `Usuario ${prompt.updatedByUserId}` : "Sistema"}
            </p>
            <label>
              Instrucciones del clasificador B3 de {labels[prompt.channel]}
              <textarea
                rows={10}
                maxLength={instructionCharacterLimit}
                aria-describedby={`b3-instruction-count-${prompt.channel}`}
                value={prompt.draft}
                disabled={Boolean(busy)}
                onChange={(event) => updateDraft(prompt.channel, event.target.value)}
              />
            </label>
            <p id={`b3-instruction-count-${prompt.channel}`}>
              {prompt.draft.length} / {instructionCharacterLimit} caracteres
            </p>
            <button
              type="button"
              className="mi-agent-primary-button"
              disabled={Boolean(busy) || !prompt.draft.trim() ||
                prompt.draft.trim() === prompt.instruction}
              onClick={() => save(prompt)}
            >
              {busy === prompt.channel ? "Guardando..." : `Guardar instrucciones de ${labels[prompt.channel]}`}
            </button>
            <button
              type="button"
              className="mi-agent-secondary-button"
              disabled={Boolean(busy) || prompt.draft === prompt.initialInstruction}
              onClick={() => loadDefault(prompt)}
            >
              Cargar instrucciones predeterminadas de {labels[prompt.channel]}
            </button>
            <details>
              <summary>Historial del clasificador de {labels[prompt.channel]}</summary>
              {prompt.revisions.length ? prompt.revisions.map((revision) => (
                <div key={revision.version}>
                  <h5>Versión {revision.version}</h5>
                  <p>
                    {dateLabel(revision.createdAt)} ·{" "}
                    {revision.createdByUserId ? `Usuario ${revision.createdByUserId}` : "Sistema"}
                  </p>
                  <pre>{revision.instruction}</pre>
                  <button
                    type="button"
                    className="mi-agent-secondary-button"
                    disabled={Boolean(busy) || revision.version === prompt.version}
                    onClick={() => save(prompt, revision)}
                  >
                    Restaurar versión {revision.version} de {labels[prompt.channel]}
                  </button>
                </div>
              )) : <p>Todavía no hay versiones personalizadas.</p>}
            </details>
          </article>
        ))}
      </div>
    </details>
  );
}
