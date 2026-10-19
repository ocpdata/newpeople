export function CustomerOutcomeSummary({ operation }) {
  const summary = operation?.outcomeSummary;
  if (!summary) return null;
  return (
    <section aria-label="Revisión del resultado de llamada">
      <h4>{summary.accountName} · {summary.leadLabel}</h4>
      <dl>
        <dt>Estado actual</dt><dd>{summary.currentStatus}</dd>
        <dt>Resultado actual</dt><dd>{summary.currentResult} / {summary.currentReason} / {summary.currentAction}</dd>
        <dt>Comentario actual</dt><dd>{summary.currentComment || "(sin dato)"}</dd>
        <dt>Fecha compromiso actual</dt><dd>{summary.currentDueDate || "(sin dato)"}</dd>
        <dt>Persona referida actual</dt><dd>{summary.currentReferredContactName || "(sin dato)"}</dd>
        <dt>Área objetivo actual</dt><dd>{summary.currentReferredAreaName || "(sin dato)"}</dd>
        <dt>Resultado propuesto</dt><dd>{summary.proposed.result}</dd>
        <dt>Razón</dt><dd>{summary.proposed.reason}</dd>
        <dt>Acción requerida</dt><dd>{summary.proposed.action}</dd>
        <dt>Estado resultante</dt><dd>{summary.proposed.status}</dd>
        <dt>Comentario propuesto</dt><dd>{operation.comment || "(sin dato)"}</dd>
        <dt>Fecha compromiso propuesta</dt><dd>{operation.nextActionDueAt || "(sin dato)"} · {summary.timeZone}</dd>
        <dt>Persona referida</dt><dd>{operation.referredContactName || "(sin dato)"}</dd>
        <dt>Área objetivo</dt><dd>{operation.referredAreaName || "(sin dato)"}</dd>
      </dl>
      <p>Confirma una llamada y su resultado comercial. No crea reuniones, tareas, contactos ni oportunidades.</p>
      {operation.requiredActionCode === "mark_do_not_contact" || operation.requiredActionCode === "close_as_disqualified" ||
        operation.substatusCode === "disqualified_temporary" ? (
          <p>Este resultado descalifica el lead: registra la fecha de resolución y el motivo comercial. No envía comunicaciones ni modifica preferencias externas.</p>
        ) : null}
      <p>Para corregir los datos o descartar el borrador, vuelve al chat y revisa la nueva propuesta.</p>
    </section>
  );
}
