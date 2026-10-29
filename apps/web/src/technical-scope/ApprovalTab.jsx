import { useState } from "react";
import { SCOPE_STATUS_LABELS } from "./technicalScopeApi";

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function FindingsList({ verification }) {
  if (!verification) {
    return <p className="field-hint">Genera el alcance para ver la verificación contra la cotización.</p>;
  }
  if (!verification.findings.length) {
    return <p className="ts-ok">Sin hallazgos: el alcance es coherente con la cotización y el playbook.</p>;
  }
  return (
    <ul className="ts-findings">
      {verification.findings.map((finding, index) => (
        <li key={`${finding.code}-${index}`} className={finding.severity === "blocking" ? "is-blocking" : "is-warning"}>
          <span className="proposal-chip">{finding.severity === "blocking" ? "Bloqueante" : "Advertencia"}</span>
          {finding.message}
        </li>
      ))}
    </ul>
  );
}

export function ChecklistForm({ items, onSubmit, busy, label }) {
  const [checked, setChecked] = useState({});
  const [comment, setComment] = useState("");
  const complete = items.every((item) => checked[item.key]);
  return (
    <div className="ts-card ts-approval-form">
      <h4>{label}</h4>
      {items.map((item) => (
        <label key={item.key} className="ts-check">
          <input
            type="checkbox"
            checked={Boolean(checked[item.key])}
            onChange={(event) => setChecked({ ...checked, [item.key]: event.target.checked })}
          />
          {item.label}
        </label>
      ))}
      <textarea
        rows={2}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Comentarios de la aprobación (opcional)"
        aria-label="Comentarios de la aprobación"
      />
      <button type="button" className="btn-primary" disabled={busy || !complete} onClick={() => onSubmit(checked, comment)}>
        Aprobar
      </button>
    </div>
  );
}

export default function ApprovalTab({ overview, busy, onSubmit, onApprove, onReturn, onDiscard }) {
  const { scope, capabilities, verification, stale } = overview;
  const status = scope.status;
  const hasTopology = Boolean(scope.topology?.nodes?.length);
  const checklistItems = [
    { key: "assumptionsReviewed", label: "Revisé los supuestos, exclusiones y responsabilidades del cliente." },
    { key: "findingsResolved", label: "Los hallazgos de la verificación están resueltos o aceptados." },
    ...(hasTopology ? [{ key: "topologyReviewed", label: "Revisé la topología y coincide con la solución." }] : []),
  ];

  return (
    <div className="ts-tab">
      <section className="ts-card">
        <div className="ts-card-head">
          <div>
            <h4>Estado: {SCOPE_STATUS_LABELS[status] || status}</h4>
            {scope.printable ? (
              <p className="ts-ok">La propuesta se puede imprimir y enviar con este alcance aprobado.</p>
            ) : (
              <p className="ts-warn">
                La propuesta no se puede imprimir ni enviar por correo hasta que el alcance técnico esté aprobado.
              </p>
            )}
            {status === "approved" ? (
              <p className="field-hint">
                Aprobado {formatDate(scope.approvedAt)}
                {scope.selfApproved ? " · aprobado por quien lo elaboró (queda registrado en la auditoría)" : ""}
                {scope.approvalComment ? ` · “${scope.approvalComment}”` : ""}
              </p>
            ) : null}
          </div>
        </div>
        {stale.quotationChanged ? (
          <p className="ts-error">
            La versión de cotización de la propuesta cambió. Genera o revisa el alcance y envíalo de nuevo a revisión.
          </p>
        ) : null}
        {stale.answersChanged ? (
          <p className="ts-warn">
            Las respuestas del cuestionario cambiaron después de congelar la copia usada en este alcance. Al enviarlo a
            revisión se actualizará la copia.
          </p>
        ) : null}
      </section>

      <section className="ts-card">
        <div className="ts-card-head">
          <div>
            <h4>Verificación contra la cotización</h4>
            {verification ? (
              <p className="field-hint">
                {verification.blocking} bloqueante(s) · {verification.warnings} advertencia(s)
              </p>
            ) : null}
          </div>
        </div>
        <FindingsList verification={verification} />
      </section>

      {capabilities.canEdit ? (
        <section className="ts-card ts-actions-row">
          {status === "draft" ? (
            <button type="button" className="btn-primary" disabled={busy || scope.sections.length === 0} onClick={onSubmit}>
              Enviar a revisión
            </button>
          ) : null}
          {status !== "draft" ? (
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => onReturn("")}>
              Regresar a borrador
            </button>
          ) : null}
          <button
            type="button"
            className="btn-link"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Se descartará el alcance técnico de esta propuesta (las respuestas del cuestionario se conservan). ¿Continuar?")) {
                onDiscard();
              }
            }}
          >
            Descartar alcance técnico
          </button>
        </section>
      ) : null}

      {status === "in_review" && capabilities.canApprove ? (
        <ChecklistForm items={checklistItems} busy={busy} label="Aprobar alcance técnico" onSubmit={onApprove} />
      ) : null}
      {status === "in_review" && !capabilities.canApprove ? (
        <p className="field-hint">Solo el preventa asignado o un usuario con permiso de aprobación puede aprobar.</p>
      ) : null}
    </div>
  );
}
