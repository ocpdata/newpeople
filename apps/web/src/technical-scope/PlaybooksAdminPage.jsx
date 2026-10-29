import { useCallback, useEffect, useState } from "react";
import { getApiErrorMessage } from "../api";
import { playbooksApi } from "./technicalScopeApi";
import "./technical-scope.css";

const STATUS_LABELS = { borrador_ia: "Borrador IA", validado: "Validado", archivado: "Archivado" };

function DiagnosticTable({ rows }) {
  return (
    <div className="ts-card">
      <h4>Diagnóstico de datos del CRM</h4>
      <p className="field-hint">
        Evidencia disponible por solución (oportunidades cuyo nombre o partidas mencionan la solución). Sirve para saber
        cuánto puede aprender el borrador del CRM.
      </p>
      <table className="ts-diagnostic">
        <thead>
          <tr>
            <th>Solución</th><th>Oportunidades</th><th>En proceso</th><th>Ganadas</th><th>Perdidas</th>
            <th>Cotizaciones</th><th>Propuestas</th><th>Documentos</th><th>Respuestas de etapa</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.playbookCode}>
              <td>{row.playbookName}</td>
              <td>{row.opportunities}</td>
              <td>{row.byCommercialStatus.en_proceso || 0}</td>
              <td>{row.byCommercialStatus.ganada || 0}</td>
              <td>{row.byCommercialStatus.perdida || 0}</td>
              <td>{row.quotations}</td>
              <td>{row.proposals}</td>
              <td>{row.documents}</td>
              <td>{row.stageAnswers}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlaybookEditor({ code, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [contentText, setContentText] = useState("");
  const [metadata, setMetadata] = useState({ name: "", ragTopicName: "", detectionKeywords: "" });
  const [status, setStatus] = useState("borrador_ia");
  const [notes, setNotes] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [reloadToken, setReloadToken] = useState(0);
  const [topics, setTopics] = useState([]);

  useEffect(() => {
    let active = true;
    playbooksApi
      .ragTopics()
      .then((data) => active && setTopics(data.topics))
      .catch((err) => {
        if (active) setError(getApiErrorMessage(err, "No fue posible cargar los temas de Documentación RAG"));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    playbooksApi
      .detail(code)
      .then((data) => {
        if (!active) return;
        setDetail(data);
        setContentText(JSON.stringify(data.playbook.content, null, 2));
        setStatus(data.playbook.status);
        setMetadata({
          name: data.playbook.name,
          ragTopicName: data.playbook.ragTopicName,
          detectionKeywords: data.playbook.detectionKeywords.join(", "),
        });
      })
      .catch((err) => {
        if (active) setError(getApiErrorMessage(err, "No fue posible cargar el playbook"));
      });
    return () => {
      active = false;
    };
  }, [code, reloadToken]);

  const run = async (action, success) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      setNotice(typeof result === "string" ? result : success);
      setReloadToken((token) => token + 1);
      onChanged();
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible completar la operación"));
    } finally {
      setBusy(false);
    }
  };

  const saveVersion = (overwriteCurrent = false) => {
    let content;
    try {
      content = JSON.parse(contentText);
    } catch {
      setError("El contenido no es un JSON válido");
      return;
    }
    return run(async () => {
      await playbooksApi.updateMetadata(code, {
        name: metadata.name,
        ragTopicName: metadata.ragTopicName,
        detectionKeywords: metadata.detectionKeywords.split(",").map((entry) => entry.trim()).filter(Boolean),
      });
      const result = await playbooksApi.save(code, { content, status, notes, overwriteCurrent });
      return result.overwritten ? "Cambios guardados en la versión actual" : "Nueva versión guardada";
    });
  };

  const canOverwrite =
    Boolean(detail) &&
    detail.playbook.status === "borrador_ia" &&
    status === "borrador_ia" &&
    !detail.currentVersionInUse;

  if (!detail) return error ? <p className="ts-error">{error}</p> : <p className="field-hint">Cargando…</p>;

  return (
    <div className="ts-card">
      <h4>{detail.playbook.name} · versión {detail.playbook.currentVersionNumber}</h4>
      {error ? <p className="ts-error" role="alert">{error}</p> : null}
      {notice ? <p className="ts-ok" role="status">{notice}</p> : null}

      <div className="ts-grid-2">
        <label>Nombre
          <input value={metadata.name} onChange={(event) => setMetadata({ ...metadata, name: event.target.value })} />
        </label>
        <label>Tema de Documentación RAG
          <select value={metadata.ragTopicName} onChange={(event) => setMetadata({ ...metadata, ragTopicName: event.target.value })}>
            <option value="">Sin tema</option>
            {metadata.ragTopicName && !topics.some((topic) => topic.name === metadata.ragTopicName) ? (
              <option value={metadata.ragTopicName}>{metadata.ragTopicName} (no existe)</option>
            ) : null}
            {topics.map((topic) => (
              <option key={topic.name} value={topic.name}>{topic.name} ({topic.documentCount} documentos)</option>
            ))}
          </select>
        </label>
        <label>Palabras clave de detección (separadas por coma)
          <input value={metadata.detectionKeywords} onChange={(event) => setMetadata({ ...metadata, detectionKeywords: event.target.value })} />
        </label>
        <label>Estado
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>

      <div className="ts-card">
        <h5>Generar borrador con IA desde el tema RAG y el CRM</h5>
        <p className="field-hint">
          Lee los documentos del tema “{detail.playbook.ragTopicName || "sin tema"}” y señales generalizadas del CRM
          (nunca datos de clientes). Crea una nueva versión como borrador IA.
        </p>
        <input value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Instrucciones adicionales (opcional)" />
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => run(() => playbooksApi.generateDraft(code, instructions), "Borrador generado como nueva versión")}
        >
          {busy ? "Procesando…" : "Generar borrador"}
        </button>
      </div>

      <label>Contenido del playbook (JSON: módulos, preguntas, reglas, alcance y plantillas de topología)
        <textarea className="ts-json" rows={24} value={contentText} onChange={(event) => setContentText(event.target.value)} spellCheck={false} />
      </label>
      <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notas de esta versión (opcional)" />
      <div className="ts-actions">
        {canOverwrite ? (
          <button type="button" className="btn-primary" disabled={busy} onClick={() => saveVersion(true)}>
            Guardar cambios en la versión {detail.playbook.currentVersionNumber}
          </button>
        ) : null}
        <button type="button" className={canOverwrite ? "btn-secondary" : "btn-primary"} disabled={busy} onClick={() => saveVersion(false)}>
          Guardar como nueva versión
        </button>
      </div>
      <p className="field-hint">
        {canOverwrite
          ? "Esta versión es un borrador IA que ninguna propuesta ha usado, por lo que puedes ajustarla sin crear otra versión."
          : "Las versiones validadas o ya usadas en una propuesta no se modifican: cada guardado crea una versión nueva."}
      </p>

      <h5>Versiones</h5>
      <ul className="ts-extractions">
        {detail.versions.map((version) => (
          <li key={version.id}>
            <strong>v{version.versionNumber}</strong>
            <span className="proposal-chip proposal-chip-soft">{STATUS_LABELS[version.status] || version.status}</span>
            <span className="field-hint">{version.generatedBy} · {new Date(version.createdAt).toLocaleString("es-MX")}</span>
            {version.notes ? <span className="field-hint">{version.notes.split("\n")[0]}</span> : null}
          </li>
        ))}
      </ul>

      {detail.suggestions.length ? (
        <>
          <h5>Mejoras sugeridas por las correcciones de los preventas</h5>
          <ul className="ts-extractions">
            {detail.suggestions.map((suggestion) => (
              <li key={suggestion.id}>
                <strong>{suggestion.subjectCode}</strong>
                <span className="field-hint">
                  IA sugirió {JSON.stringify(suggestion.detail?.suggested)}; el preventa confirmó {JSON.stringify(suggestion.detail?.confirmed)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

export default function PlaybooksAdminPage() {
  const [playbooks, setPlaybooks] = useState([]);
  const [selected, setSelected] = useState(null);
  const [diagnostic, setDiagnostic] = useState(null);
  const [error, setError] = useState("");

  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let active = true;
    playbooksApi
      .list()
      .then((data) => active && setPlaybooks(data.playbooks))
      .catch((err) => {
        if (active) setError(getApiErrorMessage(err, "No fue posible cargar los playbooks"));
      });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  return (
    <section className="ts-admin">
      <header>
        <h2>Playbooks técnicos por solución</h2>
        <p className="field-hint">
          Preguntas del cuestionario, reglas de dimensionamiento, esqueleto del alcance y plantillas de topología que usa
          el alcance técnico de las propuestas. Cada guardado crea una versión. Los playbooks “Borrador IA” se usan igual,
          pero el preventa siempre aprueba el resultado.
        </p>
      </header>
      {error ? <p className="ts-error" role="alert">{error}</p> : null}

      <div className="ts-card">
        <table className="ts-diagnostic">
          <thead>
            <tr><th>Solución</th><th>Fabricante</th><th>Estado</th><th>Versión</th><th>Tema RAG</th><th /></tr>
          </thead>
          <tbody>
            {playbooks.map((playbook) => (
              <tr key={playbook.code} className={selected === playbook.code ? "is-selected" : ""}>
                <td>{playbook.name}</td>
                <td>{playbook.manufacturer}</td>
                <td><span className="proposal-chip proposal-chip-soft">{STATUS_LABELS[playbook.status] || playbook.status}</span></td>
                <td>{playbook.currentVersionNumber}</td>
                <td>{playbook.ragTopicName}</td>
                <td><button type="button" className="btn-secondary" onClick={() => setSelected(playbook.code)}>Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div>
          <button
            type="button"
            className="btn-secondary"
            onClick={async () => {
              try {
                setDiagnostic((await playbooksApi.diagnostic()).diagnostic);
              } catch (err) {
                setError(getApiErrorMessage(err, "No fue posible ejecutar el diagnóstico"));
              }
            }}
          >
            Ejecutar diagnóstico de datos del CRM
          </button>
        </div>
      </div>

      {diagnostic ? <DiagnosticTable rows={diagnostic} /> : null}
      {selected ? <PlaybookEditor key={selected} code={selected} onChanged={reload} /> : null}
    </section>
  );
}
