import { useState } from "react";
import { api, getApiErrorMessage } from "./api";

const ENDPOINT = "/api/commercial-intelligence/governance/server-rules";
const OPERATION_LABELS = {
  activity: "Actividad", stage_answer: "Respuesta de etapa",
  lead_call_outcome: "Resultado de llamada", account_field: "Campo de cuenta",
  contact_field: "Campo de contacto", opportunity_field: "Campo de oportunidad",
  create_contact: "Crear contacto", create_opportunity: "Crear oportunidad",
  link_contact_to_opportunity: "Vincular contacto a oportunidad",
};
const KIND_LABELS = {
  configurable: "Editable", protected: "Control protegido", model: "Evaluación de IA",
};

export default function ServerRulesSection() {
  const [configuration, setConfiguration] = useState(null);
  const [draft, setDraft] = useState(null);
  const [channel, setChannel] = useState("customer_account");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState("");
  const dirty = Boolean(configuration && JSON.stringify(draft) !== JSON.stringify(configuration.rules));

  async function load() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { data } = await api.get(ENDPOINT);
      setConfiguration(data);
      setDraft(structuredClone(data.rules));
      setRevision("");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No fue posible cargar las reglas del servidor."));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { data } = await api.put(`${ENDPOINT}/customer_account`, {
        expectedVersion: configuration.version, rules: draft,
      });
      setConfiguration(data);
      setDraft(structuredClone(data.rules));
      setRevision("");
      setMessage(`Versión ${data.version} guardada. Se aplicará en el siguiente turno de Cliente existente.`);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No fue posible guardar las reglas del servidor."));
    } finally {
      setBusy(false);
    }
  }

  function change(path, value) {
    const [section, key] = path.split(".");
    setDraft((current) => {
      const next = { ...current, [section]: { ...current[section], [key]: value } };
      if (section === "filters" && value === true) {
        if (key === "defaultActiveOnly") next.filters.defaultInactiveOnly = false;
        if (key === "defaultInactiveOnly") next.filters.defaultActiveOnly = false;
      }
      return next;
    });
    setMessage("");
  }

  function restore(rules, label) {
    if (!window.confirm(`¿Cargar ${label} en el formulario? Sustituirá los cambios sin guardar. Debes guardar para activarla como una nueva versión.`)) return;
    setDraft(structuredClone(rules));
    setMessage("Configuración cargada en el formulario. Todavía no está activa; guarda para aplicarla.");
    setError("");
  }

  function renderControl(rule) {
    const [section, key] = rule.path.split(".");
    const value = draft[section][key];
    if (rule.control === "operations") {
      return (
        <fieldset disabled={busy}>
          <legend>{rule.title}</legend>
          <div className="mi-agent-server-rules-operations">
            {rule.values.map((kind) => (
              <label key={kind}>
                <input type="checkbox" checked={value.includes(kind)}
                  onChange={(event) => change(rule.path, event.target.checked
                    ? [...value, kind] : value.filter((item) => item !== kind))} />
                <span>{OPERATION_LABELS[kind] || kind}</span>
              </label>
            ))}
          </div>
        </fieldset>
      );
    }
    return (
      <label className="mi-agent-server-rule-control">
        {rule.control === "boolean" ? (
          <input type="checkbox" checked={value} disabled={busy}
            onChange={(event) => change(rule.path, event.target.checked)} />
        ) : null}
        {rule.title}
        {rule.control === "select" ? (
          <select value={value} disabled={busy} onChange={(event) => change(rule.path, event.target.value)}>
            {rule.options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        ) : null}
        {rule.control === "number" ? (
          <input type="number" min={rule.min} max={rule.max} step={rule.step || 1}
            value={value} required disabled={busy}
            onChange={(event) => change(rule.path, event.target.value === "" ? "" : Number(event.target.value))} />
        ) : null}
      </label>
    );
  }

  return (
    <details id="mi-agent-server-rules" className="mi-agent-server-rules mi-agent-domain-policy"
      onToggle={(event) => {
        if (event.currentTarget.open && !configuration && !busy) load();
      }}>
      <summary className="mi-agent-domain-policy-main-summary">
        <strong role="heading" aria-level={4}>Reglas del servidor</strong>
        <span>Políticas estructuradas conectadas al código, controles protegidos y evaluaciones de IA.</span>
      </summary>
      <div className="mi-agent-domain-policy-content">
        <label>Canal de reglas del servidor
          <select value={channel} onChange={(event) => setChannel(event.target.value)} disabled={busy}>
            <option value="customer_account">Cliente existente · conectado</option>
            <option value="coach">Coach · pendiente de conexión</option>
            <option value="prospect">Cuenta nueva · pendiente de conexión</option>
          </select>
        </label>
        {error ? <p role="alert" className="mi-agent-server-rules-error">{error}</p> : null}
        {message ? <p role="status">{message}</p> : null}
        {channel !== "customer_account" ? (
          <p>Este canal está preparado para una etapa posterior. Esta sección todavía no modifica sus flujos. Su configuración vigente se conserva en Políticas del canal y contexto.</p>
        ) : configuration && draft ? (
          <form onSubmit={(event) => { event.preventDefault(); save(); }}>
            <p><strong>Versión {configuration.version}</strong> · customer_account / default.
              Los cambios se aplican en el siguiente turno, no a un turno ya iniciado.
              Ninguna política concede permisos ni elimina la confirmación o la evidencia obligatoria.</p>
            {configuration.updatedAt ? (
              <p>Actualizada: {new Date(configuration.updatedAt).toLocaleString("es-MX")}
                {configuration.updatedByUserId ? ` · Usuario ${configuration.updatedByUserId}` : ""}</p>
            ) : null}
            {configuration.categories.map((category) => (
              <details key={category.id} className="mi-agent-server-rule-category">
                <summary>{category.title}</summary>
                {category.rules.map((rule) => (
                  <div key={rule.id} className="mi-agent-server-rule">
                    <small>{KIND_LABELS[rule.kind]} · {rule.id}</small>
                    {rule.kind === "configurable" ? renderControl(rule) : <strong>{rule.title}</strong>}
                    <p>{rule.description}</p>
                    {rule.implementation ? <small>Validación: {rule.implementation}</small> : null}
                  </div>
                ))}
              </details>
            ))}
            <div className="mi-agent-workspace-actions">
              <button type="submit" className="mi-agent-primary-button" disabled={busy || !dirty}>
                {busy ? "Guardando..." : "Guardar reglas del servidor"}
              </button>
              <button type="button" className="mi-agent-secondary-button" disabled={busy}
                onClick={() => {
                  if (!dirty || window.confirm("¿Recargar las reglas guardadas y descartar los cambios sin guardar?")) load();
                }}>Recargar reglas guardadas</button>
              <button type="button" className="mi-agent-secondary-button" disabled={busy}
                onClick={() => restore(configuration.initialRules, "la configuración inicial")}>
                Cargar reglas iniciales
              </button>
            </div>
            <details className="mi-agent-server-rule-category">
              <summary>Historial de versiones</summary>
              <label>Versión para restaurar
                <select value={revision} onChange={(event) => setRevision(event.target.value)} disabled={busy}>
                  <option value="">Selecciona una versión</option>
                  {configuration.revisions.map((item) => (
                    <option key={item.version} value={item.version}>
                      Versión {item.version}{item.createdAt ? ` · ${new Date(item.createdAt).toLocaleString("es-MX")}` : ""}
                      {item.createdByUserId ? ` · Usuario ${item.createdByUserId}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" disabled={busy || revision === ""} className="mi-agent-secondary-button"
                onClick={() => restore(configuration.revisions.find((item) => String(item.version) === revision).rules,
                  `la versión ${revision}`)}>Cargar versión en formulario</button>
              <p>Restaurar no borra el historial: al guardar se crea una nueva versión.</p>
            </details>
          </form>
        ) : <button type="button" disabled={busy} onClick={load}>{busy ? "Cargando..." : "Cargar reglas del servidor"}</button>}
      </div>
    </details>
  );
}
