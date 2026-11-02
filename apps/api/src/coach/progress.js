import { query } from "../db.js";

// User-facing phases of a Coach turn, shown while the job runs.
export const COACH_PROGRESS_PHASES = {
  understanding: "Entendiendo tu pregunta",
  context: "Identificando el registro y el contexto",
  crm: "Consultando tus datos del CRM",
  verifying: "Verificando la información",
  answering: "Redactando la respuesta",
  auditing: "Comprobando la respuesta",
  saving: "Guardando la conversación",
};

// Execution-trace span labels (see block-pipeline.js and agent-gateway.js) that mark the start of a phase.
const PHASE_BY_TRACE_LABEL = {
  "Planificar turno de Coach": "understanding",
  "Resolver contexto y preparar lecturas": "context",
  "Solicitar lectura adicional": "crm",
  "Verificar evidencia de Coach": "verifying",
  "Formar respuesta de Coach": "answering",
  "Auditar respuesta final de Coach": "auditing",
  "Persistir operaciones y sesión de Coach": "saving",
};

export function phaseForCoachTraceEvent(event) {
  if (!event || event.phase !== "call" || event.status !== "started")
    return null;
  const label = String(event.label || "");
  if (label.startsWith("Lectura autorizada")) return "crm";
  return PHASE_BY_TRACE_LABEL[label] || null;
}

// Writes the current phase to the running job so polling clients can show what is happening.
// Writes are serialized and never throw: progress is informational and must not affect the turn.
export function createCoachProgressReporter({
  jobId,
  run = query,
  now = () => new Date(),
}) {
  let currentPhase = null;
  let queue = Promise.resolve();

  const report = (phase) => {
    if (!COACH_PROGRESS_PHASES[phase] || phase === currentPhase) return;
    currentPhase = phase;
    const progress = {
      phase,
      label: COACH_PROGRESS_PHASES[phase],
      at: now().toISOString(),
    };
    queue = queue
      .then(() =>
        run(
          `UPDATE mi_agent_analysis_jobs SET progress_json = ?, updated_at = NOW(3)
           WHERE id = ? AND status IN ('pending', 'running')`,
          [JSON.stringify(progress), Number(jobId)],
        ),
      )
      .catch(() => undefined);
  };

  return {
    report,
    onEvent: (event) => report(phaseForCoachTraceEvent(event)),
    flush: () => queue,
  };
}
