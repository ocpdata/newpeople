import { query } from "../db.js";

// User-facing phases of an account-chat turn, shown while the job is pending.
export const CHAT_PROGRESS_PHASES = {
  attachment: "Leyendo el archivo adjunto",
  context: "Preparando el contexto de la cuenta",
  understanding: "Entendiendo tu pregunta",
  dossier: "Consultando el expediente de la cuenta",
  crm: "Consultando los registros del CRM",
  documents: "Revisando los documentos",
  verifying: "Verificando la información",
  answering: "Redactando la respuesta",
  saving: "Guardando la conversación",
};

// Execution-trace span labels (see processCustomerAccountChatJob) that mark the start of a phase.
const PHASE_BY_TRACE_LABEL = {
  "Autorizar contexto y construir snapshot": "context",
  "Clasificar intención de la solicitud": "understanding",
  "Delegar turno al adaptador": "understanding",
  "Responder con expediente y analista": "dossier",
  "Ejecutar motor conversacional": "crm",
  "Recuperar conocimiento documental": "documents",
  "Verificar evidencia": "verifying",
  "Solicitar evidencia adicional": "verifying",
  "Redactar y auditar respuesta conversacional": "answering",
  "Persistir resultado e historial": "saving",
};

export function phaseForTraceEvent(event) {
  if (!event || event.phase !== "call" || event.status !== "started") return null;
  return PHASE_BY_TRACE_LABEL[event.label] || null;
}

// Writes the current phase to the pending job so polling clients can show what is happening.
// Writes are serialized and never throw: progress is informational and must not affect the turn.
export function createChatProgressReporter({ jobId, run = query, now = () => new Date() }) {
  let currentPhase = null;
  let queue = Promise.resolve();

  const report = (phase) => {
    if (!CHAT_PROGRESS_PHASES[phase] || phase === currentPhase) return;
    currentPhase = phase;
    const progress = { phase, label: CHAT_PROGRESS_PHASES[phase], at: now().toISOString() };
    queue = queue
      .then(() =>
        run(
          `UPDATE customer_intelligence_jobs SET progress_json = ?, updated_at = NOW(3)
           WHERE id = ? AND status = 'pending'`,
          [JSON.stringify(progress), Number(jobId)],
        ),
      )
      .catch(() => undefined);
  };

  return {
    report,
    onEvent: (event) => report(phaseForTraceEvent(event)),
    flush: () => queue,
  };
}
