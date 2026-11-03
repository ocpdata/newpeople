import { useState } from "react";
import { CheckCircle2, AlertCircle, Clock3, ArrowRight, Pencil, X } from "lucide-react";
import {
  COACH_OPERATION_STATUS_META,
  COACH_RESPONSE_TYPE_LABELS,
} from "./miAgentConstants";
import {
  formatCoachTargetModule,
  formatCoachOperationLabel,
  formatCoachDateTime,
  formatCoachFieldLabel,
  formatCoachOperationSummary,
} from "./miAgentHelpers";
import { ChannelTurnFeedback } from "./ChannelTurnFeedback";
import { CustomerChatAnswer } from "./CustomerChatAnswer";
import { CustomerChatCopyButton } from "./CustomerChatCopyButton";
import { CustomerChatProgress } from "./CustomerChatProgress";
import { CoachStageReadiness, CoachSemanticSections } from "./MiAgentWidgets";
import { validCitationAnchors } from "./customerChatShared";

// Message ids may carry free text; the marker link and the list item must share an id that survives URL encoding.
const citationKey = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, "-");

// A marker in the answer opens the evidence list of that message and points to the cited record.
function selectCoachCitation(targetId) {
  const item = document.getElementById(targetId);
  if (!item) return;
  const details = item.closest("details");
  if (details) details.open = true;
  item.scrollIntoView?.({ block: "nearest" });
  item.focus({ preventScroll: true });
  item.setAttribute("data-highlight", "true");
  window.setTimeout(() => item.removeAttribute("data-highlight"), 2500);
}

// Informational answers and errors need no label: the text already says what they are.
const COACH_VISIBLE_RESPONSE_TYPES = new Set([
  "recommendation",
  "change_request",
  "operation",
  "handoff",
]);

const COACH_FOUNDATION_VISIBILITY_KEY = "mi-agent-coach-show-foundation";

const COACH_TEST_QUESTION_GROUPS = [
  {
    title: "Prioridades y cartera",
    questions: [
      "¿Qué oportunidades debería priorizar esta semana y por qué?",
      "¿Cuáles de mis oportunidades tienen mayor riesgo?",
      "¿Qué oportunidades abiertas no tienen siguiente paso?",
      "¿Qué oportunidades están vencidas o requieren seguimiento?",
      "¿Cómo está mi pipeline del trimestre y qué debería atender primero?",
      "¿Qué oportunidades están más cerca de cerrarse?",
    ],
  },
  {
    title: "Desempeño y desarrollo comercial",
    questions: [
      "¿Cómo voy contra mi cuota?",
      "¿Qué puedo mejorar para aumentar mi tasa de cierre?",
      "¿Qué patrones ves en mis oportunidades ganadas y perdidas?",
      "¿Qué hábito comercial debería trabajar esta semana?",
      "¿Cómo puedo mejorar mi descubrimiento de necesidades con los clientes?",
      "Dame un plan concreto para mejorar mi seguimiento comercial.",
    ],
  },
  {
    title: "Agenda y próximos pasos",
    questions: [
      "¿Qué tengo pendiente para hoy?",
      "¿Qué seguimientos tengo que hacer esta semana?",
      "¿Qué debería hacer hoy con mis oportunidades más importantes?",
      "¿Qué oportunidades llevan más tiempo sin actividad?",
    ],
  },
  {
    title: "Una oportunidad o cuenta",
    questions: [
      "Dame el detalle de la oportunidad [nombre de una oportunidad real].",
      "¿Qué siguiente paso recomiendas para [oportunidad] y por qué?",
      "¿Qué sabemos de [cuenta existente] y qué seguimiento conviene?",
      "¿Qué contactos están relacionados con [cuenta u oportunidad]?",
    ],
  },
  {
    title: "Conversación, límites y acciones",
    questions: [
      "Primero dime qué debo priorizar; después, ¿cómo puedo avanzar con la primera oportunidad?",
      "¿Qué oportunidades de mi cartera necesitan atención?",
      "¿Y qué hago con la primera?",
      "¿Qué sabes de una oportunidad que no aparece en mi cartera?",
      "¿Cuántos empleados tiene una empresa famosa?",
      "¿Puedes registrar una llamada de seguimiento para [oportunidad]?",
    ],
  },
];

function hasCoachFoundation(result) {
  return Boolean(
    result?.facts?.length ||
      result?.evidence?.length ||
      result?.inferences?.length ||
      result?.recommendation,
  );
}

export function CoachConversationPanel({ applyCoachClarification, askCoach, askingCoach, canCreateAccounts, canCreateActions, canCreateContacts, canReadCustomerIntelligence, canReadLeads, canResolveLeads, canUpdateAccounts, canUpdateCalendar, canUpdateContacts, canUpdateLeads, cancelCoachTurn, cancelingCoach, cancelPendingCoachOperation, clearCoachConversation, coachAccounts, coachContacts, coachContext, coachMessages, coachOperationAction, coachOpportunities, coachPendingOperations, coachQuestion, coachRecentOperations, coachThreadRef, coachUndoOperationId, continueCoachOperation, hasCoachConversation, loadingCoachContext, openCoachDetailHandoff, openCoachOperationConfirmation, requestCoachGeneralScope, setCoachQuestion, undoCoachOperation }) {
  const [showCoachFoundation, setShowCoachFoundation] = useState(
    () => window.localStorage.getItem(COACH_FOUNDATION_VISIBILITY_KEY) === "true",
  );
  const hasFoundation = coachMessages.some(
    (message) => message.role !== "seller" && hasCoachFoundation(message.result),
  );
  const updateCoachFoundationVisibility = (visible) => {
    setShowCoachFoundation(visible);
    window.localStorage.setItem(COACH_FOUNDATION_VISIBILITY_KEY, String(visible));
  };

  return (
    <section className="mi-agent-coach-panel">
      <div className="mi-agent-section-heading">
        <div>
          <span className="mi-agent-section-label">
            Coach comercial
          </span>
          <h3>Pregúntale a tu Coach</h3>
        </div>
        <span>Asesoría general para tu desempeño comercial</span>
      </div>
      <div className="mi-agent-coach-context-heading">
        <div>
          <strong>Ámbito de la conversación</strong>
          <small>
            Empieza con tu cartera y prioridades generales. Menciona
            una cuenta, oportunidad, contacto o lead para enfocar la
            conversación.
          </small>
        </div>
      </div>
      <div
        className="mi-agent-coach-context-summary"
        aria-label="Alcance actual del Coach"
        role="group"
      >
        <strong>
          {coachContext.accountId ||
          coachContext.opportunityId ||
          coachContext.contactId ||
          coachContext.leadId
            ? "Enfoque activo"
            : "Ámbito general del vendedor"}
        </strong>
        {coachContext.accountId ? (
          <span>
            {coachAccounts.find(
              (item) =>
                String(item.id) === String(coachContext.accountId),
            )?.name || "Cuenta en contexto"}
          </span>
        ) : null}
        {coachContext.opportunityId ? (
          <span>
            {coachOpportunities.find(
              (item) =>
                String(item.id) ===
                String(coachContext.opportunityId),
            )?.name || "Oportunidad en contexto"}
          </span>
        ) : null}
        {coachContext.contactId ? (
          <span>
            {coachContacts.find(
              (item) =>
                String(item.id) === String(coachContext.contactId),
            )?.full_name || "Contacto en contexto"}
          </span>
        ) : null}
        {coachContext.leadId ? <span>Lead en contexto</span> : null}
        {coachContext.accountId ||
        coachContext.opportunityId ||
        coachContext.contactId ||
        coachContext.leadId ? (
          <button
            type="button"
            className="mi-agent-secondary-button"
            onClick={requestCoachGeneralScope}
            disabled={loadingCoachContext || askingCoach}
          >
            Volver al ámbito general
          </button>
        ) : null}
      </div>
      <div className="mi-agent-coach-quick-questions">
        <strong>Preguntas rápidas</strong>
        <div className="mi-agent-coach-suggestions">
          {coachContext.opportunityId ? (
            <>
              <button
                type="button"
                disabled={askingCoach}
                onClick={() =>
                  askCoach("¿Qué falta para avanzar de etapa?")
                }
              >
                ¿Qué falta para avanzar?
              </button>
              <button
                type="button"
                disabled={askingCoach}
                onClick={() =>
                  askCoach("Registra una actividad de seguimiento")
                }
              >
                Registrar actividad
              </button>
            </>
          ) : coachContext.accountId ? (
            <>
              <button
                type="button"
                disabled={askingCoach}
                onClick={() =>
                  askCoach(
                    "¿Qué oportunidad debería priorizar en esta cuenta y cuál sería el siguiente paso?",
                  )
                }
              >
                ¿Qué priorizar en esta cuenta?
              </button>
              <button
                type="button"
                disabled={askingCoach}
                onClick={() =>
                  askCoach(
                    "¿Qué puedo mejorar en mi seguimiento de esta cuenta?",
                  )
                }
              >
                ¿Cómo mejorar mi seguimiento?
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={askingCoach}
                onClick={() =>
                  askCoach(
                    "¿Cómo puedo mejorar mi desempeño este mes?",
                  )
                }
              >
                ¿Cómo mejorar mi desempeño?
              </button>
              <button
                type="button"
                disabled={askingCoach}
                onClick={() =>
                  askCoach(
                    "¿Qué oportunidades debo priorizar por riesgo y qué seguimiento debo hacer?",
                  )
                }
              >
                ¿Qué atender primero?
              </button>
            </>
          )}
        </div>
      </div>
      <details className="mi-agent-coach-test-questions">
        <summary>Más preguntas para probar Coach</summary>
        <p>
          Selecciona una pregunta para cargarla en el campo de texto. En las
          preguntas con corchetes, sustituye el texto por un registro real.
        </p>
        {COACH_TEST_QUESTION_GROUPS.map((group) => (
          <section key={group.title}>
            <strong>{group.title}</strong>
            <div className="mi-agent-coach-suggestions">
              {group.questions.map((question) => (
                <button
                  type="button"
                  key={question}
                  disabled={askingCoach}
                  onClick={() => setCoachQuestion(question)}
                >
                  {question}
                </button>
              ))}
            </div>
          </section>
        ))}
      </details>
      <div className="mi-agent-coach-conversation-heading">
        <div className="mi-agent-coach-conversation-actions">
          <button
            type="button"
            className="mi-agent-secondary-button"
            disabled={askingCoach || !hasCoachConversation}
            onClick={clearCoachConversation}
          >
            Nueva conversación
          </button>
          <label className="mi-agent-coach-foundation-toggle">
            <span>Mostrar fundamento</span>
            <input
              type="checkbox"
              role="switch"
              checked={showCoachFoundation}
              disabled={!hasFoundation}
              onChange={(event) =>
                updateCoachFoundationVisibility(event.target.checked)
              }
            />
            <span
              className="mi-agent-coach-foundation-toggle-track"
              aria-hidden="true"
            />
          </label>
        </div>
        <div className="mi-agent-coach-conversation-label">
          <strong>Conversación</strong>
          <small>
            {coachMessages.length
              ? `${coachMessages.length} mensajes en esta sesión`
              : "Inicia una conversación con tu contexto actual"}
          </small>
        </div>
      </div>
      <form
        className="mi-agent-coach-form"
        onSubmit={(event) => {
          event.preventDefault();
          askCoach();
        }}
      >
        <input
          value={coachQuestion}
          onChange={(event) => setCoachQuestion(event.target.value)}
          placeholder="Escribe tu pregunta para el Coach..."
          disabled={askingCoach}
        />
        <button
          type="submit"
          className="mi-agent-primary-button"
          disabled={askingCoach || !coachQuestion.trim()}
        >
          {askingCoach ? "Consultando..." : "Preguntar"}
        </button>
      </form>
      {coachUndoOperationId ? (
        <button
          type="button"
          className="btn-secondary mi-agent-coach-undo-button"
          onClick={undoCoachOperation}
        >
          Deshacer último cambio
        </button>
      ) : null}
      {coachMessages
        .filter((message) => message.result?.clarification)
        .slice(-1)
        .map((message) => {
          const clarification = message.result.clarification;
          return (
            <div
              className="mi-agent-coach-action"
              key={`${message.id}-clarification`}
            >
              <strong>{clarification.message}</strong>
              <small>Falta: {clarification.missing.join(", ")}</small>
              {clarification.candidates.length ? (
                clarification.candidates.map((candidate) => (
                  <button
                    type="button"
                    className="btn-secondary"
                    key={`${candidate.entityType}-${candidate.id}`}
                    onClick={() =>
                      applyCoachClarification(
                        candidate,
                        clarification,
                      )
                    }
                  >
                    Usar {candidate.name}
                    {candidate.accountName
                      ? ` · ${candidate.accountName}`
                      : ""}
                    {candidate.stageName
                      ? ` · ${candidate.stageName}`
                      : ""}
                    {candidate.email ? ` · ${candidate.email}` : ""}
                  </button>
                ))
              ) : (
                <small>
                  No hay registros accesibles para seleccionar.
                </small>
              )}
            </div>
          );
        })}
      {coachPendingOperations.length ? (
        <section
          className="mi-agent-coach-pending"
          aria-label="Acciones pendientes del Coach"
        >
          <div>
            <strong>Acciones pendientes</strong>
            <small>
              Retoma las acciones que iniciaste o descarta las que ya
              no necesitas.
            </small>
          </div>
          <div className="mi-agent-coach-pending-list">
            {coachPendingOperations.map((persistedOperation) => {
              const statusMeta =
                COACH_OPERATION_STATUS_META[
                  persistedOperation.status
                ] || COACH_OPERATION_STATUS_META.proposed;
              const missingFields =
                persistedOperation.missingFields || [];
              const actionPending =
                coachOperationAction.id === persistedOperation.id &&
                coachOperationAction.state === "loading";
              const actionError =
                coachOperationAction.id === persistedOperation.id &&
                coachOperationAction.state === "error"
                  ? coachOperationAction.message
                  : null;
              const handoffExpiresAt =
                persistedOperation.handoffExpiresAt
                  ? new Date(persistedOperation.handoffExpiresAt)
                  : null;
              const handoffExpired =
                handoffExpiresAt &&
                // The expiry must be evaluated on every render.
                // eslint-disable-next-line react-hooks/purity
                handoffExpiresAt.getTime() <= Date.now();
              const targetModuleLabel = formatCoachTargetModule(
                persistedOperation.targetModule ||
                  persistedOperation.pendingOperation?.targetModule,
              );
              return (
                <article
                  key={persistedOperation.id}
                  className={`is-${statusMeta.tone}`}
                >
                  <div>
                    <span className="mi-agent-coach-operation-status">
                      {persistedOperation.status === "completed" ? (
                        <CheckCircle2 size={13} aria-hidden="true" />
                      ) : persistedOperation.status === "failed" ? (
                        <AlertCircle size={13} aria-hidden="true" />
                      ) : (
                        <Clock3 size={13} aria-hidden="true" />
                      )}
                      {statusMeta.label}
                    </span>
                    <strong>
                      {formatCoachOperationLabel(persistedOperation)}
                    </strong>
                    {persistedOperation.status === "failed" ? (
                      <small>
                        {persistedOperation.errorDetail ||
                          "La acción requiere revisión."}
                      </small>
                    ) : targetModuleLabel ? (
                      <small>
                        {targetModuleLabel}
                        {persistedOperation.handedOffAt
                          ? ` · enviada ${formatCoachDateTime(persistedOperation.handedOffAt)}`
                          : ""}
                      </small>
                    ) : null}
                    {persistedOperation.status === "handed_off" ? (
                      <small
                        className={handoffExpired ? "form-error" : ""}
                      >
                        {handoffExpired
                          ? "El acceso al módulo venció; corrige para generar uno nuevo."
                          : `Handoff vigente${handoffExpiresAt ? ` hasta ${formatCoachDateTime(handoffExpiresAt)}` : ""}.`}
                      </small>
                    ) : null}
                    {missingFields.length ? (
                      <div className="mi-agent-coach-missing-fields">
                        <span>
                          Falta completar antes de continuar:
                        </span>
                        <ul>
                          {missingFields.map((field) => (
                            <li key={field}>
                              {formatCoachFieldLabel(field)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {actionError ? (
                      <small className="form-error" role="alert">
                        {actionError}
                      </small>
                    ) : null}
                  </div>
                  <div className="mi-agent-coach-pending-actions">
                    {persistedOperation.status === "collecting" ||
                    (persistedOperation.status === "handed_off" &&
                      !handoffExpired) ? (
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={actionPending}
                        onClick={() =>
                          continueCoachOperation(persistedOperation)
                        }
                      >
                        <ArrowRight size={14} aria-hidden="true" />
                        {actionPending
                          ? "Abriendo..."
                          : persistedOperation.status === "collecting"
                            ? "Completar datos"
                            : `Abrir en ${targetModuleLabel || "el módulo"}`}
                      </button>
                    ) : null}
                    {["ready", "failed"].includes(
                      persistedOperation.status,
                    ) || handoffExpired ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={actionPending}
                        onClick={() =>
                          openCoachOperationConfirmation({
                            ...persistedOperation.pendingOperation,
                            persistentId: persistedOperation.id,
                          })
                        }
                      >
                        <Pencil size={14} aria-hidden="true" />
                        Revisar
                      </button>
                    ) : null}
                    {[
                      "proposed",
                      "collecting",
                      "ready",
                      "handed_off",
                      "failed",
                    ].includes(persistedOperation.status) ? (
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={actionPending}
                        onClick={() =>
                          cancelPendingCoachOperation(
                            persistedOperation,
                          )
                        }
                      >
                        <X size={14} aria-hidden="true" />
                        Descartar
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
      {coachRecentOperations.length ? (
        <details className="mi-agent-coach-recent">
          <summary>
            Actividad reciente
            <span>{coachRecentOperations.length}</span>
          </summary>
          <div>
            {coachRecentOperations.map((operation) => {
              const statusMeta =
                COACH_OPERATION_STATUS_META[operation.status] ||
                COACH_OPERATION_STATUS_META.completed;
              return (
                <article key={operation.id}>
                  <span className={`is-${statusMeta.tone}`}>
                    {operation.status === "completed" ? (
                      <CheckCircle2 size={13} aria-hidden="true" />
                    ) : (
                      <Clock3 size={13} aria-hidden="true" />
                    )}
                    {statusMeta.label}
                  </span>
                  <strong>
                    {formatCoachOperationLabel(operation)}
                  </strong>
                  <small>
                    {formatCoachDateTime(
                      operation.completedAt ||
                        operation.revertedAt ||
                        operation.rejectedAt ||
                        operation.cancelledAt ||
                        operation.updatedAt,
                    ) || "Actualizada recientemente"}
                  </small>
                </article>
              );
            })}
          </div>
        </details>
      ) : null}
      {coachMessages.length ? (
        <div
          ref={coachThreadRef}
          className="mi-agent-coach-thread"
          aria-live="polite"
        >
          {coachMessages.map((message) =>
            message.role === "seller" ? (
              <div
                key={message.id}
                className="mi-agent-coach-message is-seller"
              >
                <span>Vendedor</span>
                <p>{message.text}</p>
              </div>
            ) : (
              <div
                key={message.id}
                className="mi-agent-coach-message is-coach"
              >
                <span>Coach</span>
                {message.pending ? (
                  <CustomerChatProgress
                    turn={{
                      startedAt: message.startedAt,
                      jobId: message.jobId,
                      progress: message.progress || {
                        label: "Analizando tu contexto comercial",
                      },
                    }}
                    onCancel={() => cancelCoachTurn(message)}
                    canceling={cancelingCoach}
                  />
                ) : message.error ? (
                  <p>{message.error}</p>
                ) : (
                  <>
                    {COACH_VISIBLE_RESPONSE_TYPES.has(
                      message.result?.responseType,
                    ) ? (
                      <div className="mi-agent-coach-result-meta">
                        <span>
                          {
                            COACH_RESPONSE_TYPE_LABELS[
                              message.result.responseType
                            ]
                          }
                        </span>
                      </div>
                    ) : null}
                    <CustomerChatAnswer
                      answer={message.result?.answer || "Lectura comercial"}
                      citationAnchors={validCitationAnchors(
                        message.result?.answer,
                        message.result?.citationAnchors,
                        message.result?.citations?.length || 0,
                      )}
                      citationLabels={(message.result?.citations || []).map(
                        (citation) => citation.label,
                      )}
                      citationIdPrefix={`coach-${citationKey(message.id)}`}
                      onCitationSelect={selectCoachCitation}
                    />
                    <CustomerChatCopyButton text={message.result?.answer} />
                    {message.result?.citations?.length ? (
                      <details className="mi-agent-dossier-citations">
                        <summary>
                          Evidencia del CRM citada (
                          {message.result.citations.length})
                        </summary>
                        <ul>
                          {message.result.citations.map(
                            (citation, citationIndex) => (
                              <li
                                key={citation.evidenceId}
                                id={`cita-coach-${citationKey(message.id)}-${citationIndex + 1}`}
                                tabIndex={-1}
                              >
                                <span className="mi-agent-dossier-citation-number">
                                  [{citationIndex + 1}]
                                </span>{" "}
                                <strong>{citation.label}</strong>
                                {citation.detail ? (
                                  <span> · {citation.detail}</span>
                                ) : null}
                                {citation.excerpt ? (
                                  <p>{citation.excerpt}</p>
                                ) : null}
                              </li>
                            ),
                          )}
                        </ul>
                      </details>
                    ) : null}
                    {message.result?.detailHandoff ? (
                      <div className="mi-agent-coach-handoff">
                        <small>
                          Coach mantiene el foco en tu desempeño; el
                          detalle se revisa en el espacio
                          especializado.
                        </small>
                        {message.result.detailHandoff.destination ===
                        "customer_account" ? (
                          <button
                            type="button"
                            className="mi-agent-secondary-button"
                            onClick={() =>
                              openCoachDetailHandoff(
                                message.result.detailHandoff,
                              )
                            }
                            disabled={
                              askingCoach ||
                              !canReadCustomerIntelligence
                            }
                          >
                            Abrir Cliente existente
                          </button>
                        ) : message.result.detailHandoff
                            .destination === "lead_management" ? (
                          <button
                            type="button"
                            className="mi-agent-secondary-button"
                            onClick={() =>
                              openCoachDetailHandoff(
                                message.result.detailHandoff,
                              )
                            }
                            disabled={askingCoach || !canReadLeads}
                          >
                            Abrir gestión de leads
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    <ChannelTurnFeedback
                      traceId={message.result?.qualityTraceId}
                      channelLabel="Coach"
                    />
                    <CoachStageReadiness
                      readiness={message.result?.stageReadiness}
                    />
                    {showCoachFoundation &&
                    hasCoachFoundation(message.result) ? (
                      <div className="mi-agent-coach-foundation">
                        <strong>Fundamento de la respuesta</strong>
                        <CoachSemanticSections result={message.result} />
                      </div>
                    ) : null}
                    {message.result?.operations
                      ?.filter(
                        (operation) =>
                          !operation.persistentId ||
                          coachPendingOperations.some(
                            (pending) =>
                              pending.id === operation.persistentId,
                          ),
                      )
                      .map((operation, index) => (
                        <div
                          className="mi-agent-coach-action"
                          key={`${operation.kind}-${operation.opportunityId || operation.accountId || operation.contactId || operation.interactionId}-${index}`}
                        >
                          <strong>
                            {operation.title || "Cambio propuesto"}
                          </strong>
                          <small>
                            {formatCoachOperationSummary(operation)}
                          </small>
                          {(
                            operation.kind === "activity"
                              ? canUpdateCalendar
                              : operation.kind === "lead_call_outcome"
                                ? canUpdateLeads
                                : operation.kind === "account_field"
                                  ? canUpdateAccounts
                                  : operation.kind === "contact_field"
                                    ? canUpdateContacts
                                    : operation.kind ===
                                        "create_account"
                                      ? canCreateAccounts
                                      : operation.kind ===
                                          "create_contact"
                                        ? canCreateContacts
                                        : operation.kind ===
                                            "lead_resolve"
                                          ? canResolveLeads
                                          : canCreateActions
                          ) ? (
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() =>
                                openCoachOperationConfirmation(
                                  operation,
                                )
                              }
                            >
                              Revisar y confirmar
                            </button>
                          ) : (
                            <small>
                              Requiere permiso de actualización.
                            </small>
                          )}
                        </div>
                      ))}
                    {message.result?.action?.title ? (
                      <div className="mi-agent-coach-action">
                        <strong>
                          Acción sugerida:{" "}
                          {message.result.action.title}
                        </strong>
                        <small>
                          Criterio de éxito:{" "}
                          {message.result.action.successCriteria ||
                            "Definir un siguiente compromiso."}
                        </small>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ),
          )}
        </div>
      ) : null}
    </section>
  );
}
