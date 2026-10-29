import { useState } from "react";
import TopologyEditor from "./TopologyEditor";

export default function TopologyTab({ overview, canEdit, busy, onSave, onPropose }) {
  const { scope, quotationItems } = overview;
  const [mode, setMode] = useState("proposed");
  const [candidate, setCandidate] = useState(null);
  const [warnings, setWarnings] = useState([]);

  const propose = async () => {
    const result = await onPropose();
    if (result?.topology) {
      setCandidate(result.topology);
      setWarnings(result.warnings || []);
    }
  };

  const save = async (topology) => {
    await onSave(topology, mode);
    setCandidate(null);
    setWarnings([]);
  };

  const isProposed = mode === "proposed";
  const value = isProposed ? candidate || scope.topology : scope.asisTopology;

  return (
    <div className="ts-tab">
      <section className="ts-card">
        <div className="ts-card-head">
          <div>
            <h4>Topología</h4>
            <p className="field-hint">
              Arrastra para mover, conecta desde el punto derecho de un componente y edita los detalles en el panel.
              Lo que guardes es exactamente lo que se imprime. Los componentes bloqueados no cambian al proponer de nuevo.
            </p>
          </div>
          <div className="ts-segmented" role="group" aria-label="Diagrama">
            <button type="button" className={isProposed ? "is-selected" : ""} onClick={() => { setMode("proposed"); setCandidate(null); }}>
              Solución propuesta
            </button>
            <button type="button" className={!isProposed ? "is-selected" : ""} onClick={() => { setMode("asis"); setCandidate(null); }}>
              Situación actual
            </button>
          </div>
        </div>
        {warnings.length ? (
          <ul className="ts-warnings">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
        ) : null}
        {candidate ? (
          <p className="ts-warn">Propuesta sin guardar: revisa el diagrama y pulsa “Guardar topología”.</p>
        ) : null}
        {!isProposed && !scope.asisTopology ? (
          <p className="field-hint">
            Aún no hay diagrama de la situación actual. Para importarlo: 1) sube el documento del cliente (.drawio o
            imagen) en los documentos de la oportunidad; 2) en la pestaña Cuestionario, tarjeta “Documentos técnicos del
            cliente”, pulsa “Analizar documentos”; 3) en el documento analizado, pulsa “Usar como topología de situación
            actual”. También puedes dibujarlo aquí.
          </p>
        ) : null}
      </section>
      <TopologyEditor
        key={mode}
        value={value}
        title={isProposed ? "Solución propuesta" : "Situación actual"}
        quotationItems={quotationItems}
        readOnly={!canEdit}
        busy={busy}
        startDirty={Boolean(candidate) && isProposed}
        onSave={save}
        onPropose={canEdit && isProposed ? propose : null}
      />
    </div>
  );
}
