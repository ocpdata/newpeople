import { Trash2, CheckCircle2, AlertCircle, Clock3, ArrowRight, Pencil, X } from "lucide-react";
import {
  COACH_OPERATION_STATUS_META,
  COACH_RESPONSE_TYPE_LABELS,
  COACH_CONFIDENCE_LABELS,
} from "./miAgentConstants";
import {
  formatCoachTargetModule,
  formatCoachOperationLabel,
  formatCoachDateTime,
  formatCoachFieldLabel,
  formatCoachOperationSummary,
} from "./miAgentHelpers";
import { CoachQualityFeedback } from "./CoachQualityFeedback";
import { CoachStageReadiness, CoachSemanticSections } from "./MiAgentWidgets";

export function CoachConversationPanel({ applyCoachClarification, askCoach, askingCoach, canCreateAccounts, canCreateActions, canCreateContacts, canReadCustomerIntelligence, canReadLeads, canResolveLeads, canUpdateAccounts, canUpdateCalendar, canUpdateContacts, canUpdateLeads, cancelPendingCoachOperation, clearCoachConversation, coachAccounts, coachContacts, coachContext, coachMessages, coachOperationAction, coachOpportunities, coachPendingOperations, coachQuestion, coachRecentOperations, coachThreadRef, coachUndoOperationId, continueCoachOperation, hasCoachConversation, hasCoachFoundation, loadingCoachContext, openCoachDetailHandoff, openCoachOperationConfirmation, requestCoachGeneralScope, setCoachQuestion, showCoachFoundation, undoCoachOperation, updateCoachFoundationVisibility }) {
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
      <div className="mi-agent-coach-conversation-heading">
        <div>
          <strong>Conversación</strong>
          <small>
            {coachMessages.length
              ? `${coachMessages.length} mensajes en esta sesión`
              : "Inicia una conversación con tu contexto actual"}
          </small>
        </div>
        <button
          type="button"
          className="btn-ghost mi-agent-coach-clear-button"
          disabled={askingCoach || !hasCoachConversation}
          onClick={clearCoachConversation}
          title="Limpiar conversación"
        >
          <Trash2 size={14} aria-hidden="true" />
          Limpiar conversación
        </button>
        {hasCoachFoundation ? (
          <label className="mi-agent-coach-foundation-toggle">
            <span>Mostrar fundamento</span>
            <input
              type="checkbox"
              role="switch"
              checked={showCoachFoundation}
              onChange={(event) =>
                updateCoachFoundationVisibility(event.target.checked)
              }
            />
            <span
              className="mi-agent-coach-foundation-toggle-track"
              aria-hidden="true"
            />
          </label>
        ) : null}
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
                  <p>Analizando tu contexto comercial...</p>
                ) : message.error ? (
                  <p>{message.error}</p>
                ) : (
                  <>
                    <div className="mi-agent-coach-result-meta">
                      <span>
                        {COACH_RESPONSE_TYPE_LABELS[
                          message.result?.responseType
                        ] || "Respuesta del Coach"}
                      </span>
                      <span>
                        {COACH_CONFIDENCE_LABELS[
                          message.result?.confidence
                        ] || "Confianza media"}
                      </span>
                    </div>
                    <p className="mi-agent-coach-answer-text">
                      {message.result?.answer || "Lectura comercial"}
                    </p>
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
                    <CoachQualityFeedback
                      traceId={message.result?.qualityTraceId}
                    />
                    <CoachStageReadiness
                      readiness={message.result?.stageReadiness}
                    />
                    {showCoachFoundation ? (
                      <CoachSemanticSections
                        result={message.result}
                      />
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
