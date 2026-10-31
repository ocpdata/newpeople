import { AlertCircle } from "lucide-react";
import { formatCoachFieldLabel, normalizeCoachActivityType } from "./miAgentHelpers";
import { CustomerStageSummary } from "./CustomerStageReview";
import { CustomerOutcomeSummary } from "./CustomerOutcomeSummary";
import { CustomerRescheduleSummary } from "./CustomerRescheduleReview";
import { COACH_ACTIVITY_TYPE_OPTIONS, COACH_HANDOFF_OPERATION_KINDS } from "./miAgentConstants";

export function CoachOperationDialog({ applyCoachOperation, canExecuteCoach, coachAccounts, coachDialogRef, coachDraftMissingFields, coachDraftMissingSet, coachDraftSaving, coachOperationDraft, coachOperationOpportunityOptionsOverride, customerSnapshot, rejectCoachOperation, savingCoachOperation, setCoachOperationDraft, snapshot, updateCoachPayloadField }) {
  return (
    <div
      className="modal-overlay mi-agent-coach-action-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={
        coachOperationDraft.operation.kind === "create_contact"
          ? "Confirmar creación de contacto"
          : coachOperationDraft.operation.kind === "create_opportunity"
            ? "Confirmar creación de oportunidad"
            : coachOperationDraft.operation.kind ===
                "link_contact_to_opportunity"
              ? "Confirmar vínculo de contacto a oportunidad"
              : "Confirmar cambio del Coach"
      }
    >
      <div
        ref={coachDialogRef}
        tabIndex={-1}
        className="modal-dialog mi-agent-coach-action-dialog"
      >
        <h3 className="modal-title">
          {coachOperationDraft.operation.kind === "create_contact"
            ? "Confirmar creación de contacto"
            : coachOperationDraft.operation.kind === "create_opportunity"
              ? "Confirmar creación de oportunidad"
              : coachOperationDraft.operation.kind ===
                  "link_contact_to_opportunity"
                ? "Confirmar vínculo de contacto"
                : coachDraftMissingFields.length
                  ? "Completar operación"
                  : coachOperationDraft.persistenceStatus === "failed"
                    ? "Corregir operación"
                    : "Confirmar cambio"}
        </h3>
        <p className="modal-message">
          {coachOperationDraft.operation.kind === "create_contact"
            ? "Revisa los datos y confirma para continuar en Contactos. El contacto no se guardará hasta que lo crees en ese módulo."
            : coachOperationDraft.operation.kind === "create_opportunity"
              ? "Revisa la propuesta y confirma para continuar en Oportunidades. La oportunidad no se guardará hasta que completes el formulario y la crees en ese módulo."
              : coachOperationDraft.operation.kind ===
                  "link_contact_to_opportunity"
                ? "Revisa el vínculo y confirma para continuar en Oportunidades. El contacto asociado no cambiará hasta que guardes el formulario."
                : coachDraftMissingFields.length
                  ? "Completa los datos obligatorios antes de continuar al módulo."
                  : "Revisa el valor propuesto antes de actualizar el CRM."}
        </p>
        {coachDraftMissingFields.length ? (
          <div
            className="mi-agent-coach-missing-summary"
            role="status"
            aria-live="polite"
          >
            <AlertCircle size={16} aria-hidden="true" />
            <div>
              <strong>
                {coachDraftMissingFields.length} campos pendientes
              </strong>
              <span>
                {coachDraftMissingFields
                  .map(formatCoachFieldLabel)
                  .join(", ")}
              </span>
            </div>
          </div>
        ) : null}
        <div className="mi-agent-coach-action-form">
          <label>
            Operación
            <input
              value={
                coachOperationDraft.operation.title ||
                coachOperationDraft.operation.kind
              }
              disabled
            />
          </label>
          {[
            "create_contact",
            "create_opportunity",
            "link_contact_to_opportunity",
          ].includes(coachOperationDraft.operation.kind) ? (
            <label>
              Cuenta
              <input
                value={
                  customerSnapshot?.account?.name ||
                  coachAccounts.find(
                    (account) =>
                      Number(account.id) ===
                      Number(coachOperationDraft.operation.accountId),
                  )?.name ||
                  `Cuenta #${coachOperationDraft.operation.accountId}`
                }
                disabled
              />
            </label>
          ) : null}
          {[
            "create_account",
            "create_contact",
            "create_opportunity",
            "create_lead",
            "create_contact_mapping",
            "create_quotation",
            "create_proposal",
            "lead_resolve",
          ].includes(coachOperationDraft.operation.kind) ? (
            <div className="mi-agent-coach-action-form">
              {(coachOperationDraft.operation.kind === "create_account"
                ? [
                    "name",
                    "registrationCode",
                    "phone",
                    "website",
                    "city",
                    "stateRegion",
                    "postalCode",
                    "companyDescription",
                  ]
                : coachOperationDraft.operation.kind === "create_contact"
                  ? [
                      "firstName",
                      "lastName",
                      "email",
                      "phone",
                      "mobile",
                      "positionTitle",
                      "department",
                      "city",
                      "stateRegion",
                    ]
                  : coachOperationDraft.operation.kind ===
                      "create_contact_mapping"
                    ? [
                        "accountId",
                        "firstName",
                        "lastName",
                        "email",
                        "phone",
                        "mobile",
                        "positionTitle",
                        "department",
                        "city",
                        "stateRegion",
                      ]
                    : coachOperationDraft.operation.kind === "create_lead"
                      ? ["title", "leadSource", "summary", "sourceNotes"]
                      : coachOperationDraft.operation.kind ===
                          "create_opportunity"
                        ? ["name", "amountUsd", "closeDate"]
                        : coachOperationDraft.operation.kind ===
                            "create_quotation"
                          ? [
                              "proposalName",
                              "quotationDate",
                              "introduction",
                              "paymentTerms",
                            ]
                          : coachOperationDraft.operation.kind ===
                              "create_proposal"
                            ? [
                                "quotationVersionId",
                                "sourceProposalId",
                                "templateId",
                              ]
                            : ["summary", "sourceNotes"]
              ).map((field) => (
                <label key={field}>
                  {field}
                  {field === "companyDescription" ||
                  field === "summary" ||
                  field === "sourceNotes" ? (
                    <textarea
                      rows={3}
                      value={coachOperationDraft.payload?.[field] || ""}
                      aria-invalid={coachDraftMissingSet.has(field)}
                      onChange={(event) =>
                        updateCoachPayloadField(field, event.target.value)
                      }
                    />
                  ) : (
                    <input
                      type={
                        field === "amountUsd"
                          ? "number"
                          : field === "closeDate"
                            ? "date"
                            : "text"
                      }
                      value={coachOperationDraft.payload?.[field] ?? ""}
                      aria-invalid={coachDraftMissingSet.has(field)}
                      onChange={(event) =>
                        updateCoachPayloadField(field, event.target.value)
                      }
                    />
                  )}
                  {coachDraftMissingSet.has(field) ? (
                    <small className="mi-agent-coach-field-error">
                      Este campo es obligatorio para continuar.
                    </small>
                  ) : null}
                </label>
              ))}
              {coachOperationDraft.error ? (
                <p className="form-error">{coachOperationDraft.error}</p>
              ) : null}
              {coachOperationDraft.duplicateWarnings?.length ? (
                <div className="mi-agent-coach-duplicate-warning">
                  <strong>
                    Revisa posibles duplicados antes de crear:
                  </strong>
                  <ul>
                    {coachOperationDraft.duplicateWarnings.map(
                      (warning, index) => (
                        <li
                          key={`${warning.matchReason || "duplicate"}-${index}`}
                        >
                          {warning.reasonLabel ||
                            warning.message ||
                            warning.severityMessage ||
                            "Coincidencia detectada"}
                        </li>
                      ),
                    )}
                  </ul>
                  <small>
                    Si ya existe, cancela esta propuesta y selecciona el
                    registro existente desde el contexto del Coach.
                  </small>
                </div>
              ) : null}
            </div>
          ) : coachOperationDraft.operation.kind ===
            "link_contact_to_opportunity" ? (
            <div className="mi-agent-coach-action-form">
              {coachOperationDraft.operation.linkSummary ? (
                <p>
                  Contacto actual: {coachOperationDraft.operation.linkSummary.currentContactName || "(sin contacto)"}.
                  {" "}{coachOperationDraft.operation.linkSummary.effect === "replace"
                    ? "Se sustituirá la asociación; no se conservarán ambos contactos."
                    : "Se asignará el contacto propuesto."}
                  {" "}Propuesta no guardada; confirma el vínculo en Oportunidades.
                </p>
              ) : null}
              <label>
                Oportunidad
                <input
                  value={
                    customerSnapshot?.opportunities?.find(
                      (item) =>
                        Number(item.id) ===
                        Number(coachOperationDraft.operation.opportunityId),
                    )?.name ||
                    `Oportunidad #${coachOperationDraft.operation.opportunityId}`
                  }
                  disabled
                />
              </label>
              <label>
                Contacto que se asociará
                <input
                  value={
                    customerSnapshot?.contacts?.find(
                      (item) =>
                        Number(item.id) ===
                        Number(coachOperationDraft.operation.contactId),
                    )?.name ||
                    `Contacto #${coachOperationDraft.operation.contactId}`
                  }
                  disabled
                />
              </label>
            </div>
          ) : coachOperationDraft.operation.kind === "validate_stage" ? (
            <CustomerStageSummary summary={coachOperationDraft.operation.stageSummary} />
          ) : coachOperationDraft.operation.outcomeDraftId ? (
            <CustomerOutcomeSummary operation={coachOperationDraft.operation} />
          ) : coachOperationDraft.operation.kind === "reschedule_activity" ? (
            <div>
              <CustomerRescheduleSummary summary={coachOperationDraft.operation.scheduleSummary} />
              <p>Actividad ID {coachOperationDraft.operation.activityId}. Propuesta no guardada. Revisa y confirma en Calendario; no se creará una sustituta.</p>
            </div>
          ) : coachOperationDraft.operation.kind === "activity" ? (
            <div
              className="mi-agent-coach-action-form mi-agent-coach-activity-fields"
            >
              <label>
                Origen
                <select
                  value={
                    coachOperationDraft.operation.calendarKind ||
                    (coachOperationDraft.opportunityId
                      ? "opportunity"
                      : coachOperationDraft.operation.interactionId
                        ? "lead"
                        : "standalone")
                  }
                  onChange={(event) =>
                    setCoachOperationDraft((current) => ({
                      ...current,
                      operation: {
                        ...current.operation,
                        calendarKind: event.target.value,
                      },
                    }))
                  }
                >
                  <option value="standalone">Independiente</option>
                  <option value="lead">Lead</option>
                  <option value="opportunity">Oportunidad</option>
                </select>
              </label>
              {coachOperationDraft.operation.calendarKind === "lead" ? (
                <label>
                  Lead ID
                  <input
                    type="number"
                    min="1"
                    value={
                      coachOperationDraft.operation.interactionId || ""
                    }
                    onChange={(event) =>
                      setCoachOperationDraft((current) => ({
                        ...current,
                        operation: {
                          ...current.operation,
                          interactionId: Number(event.target.value) || null,
                        },
                      }))
                    }
                  />
                </label>
              ) : (coachOperationDraft.operation.calendarKind ||
                  (coachOperationDraft.opportunityId
                    ? "opportunity"
                    : "standalone")) === "opportunity" ? (
                <label>
                  Oportunidad
                  <select
                    value={coachOperationDraft.opportunityId}
                    aria-invalid={coachDraftMissingSet.has("opportunityId")}
                    onChange={(event) =>
                      setCoachOperationDraft((current) => ({
                        ...current,
                        opportunityId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Selecciona una oportunidad</option>
                    {(
                      coachOperationOpportunityOptionsOverride ||
                      snapshot.pipeline.opportunities
                    ).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.accountName || "Sin cuenta"}
                      </option>
                    ))}
                  </select>
                  {coachDraftMissingSet.has("opportunityId") ? (
                    <small className="mi-agent-coach-field-error">
                      Selecciona una oportunidad para continuar.
                    </small>
                  ) : null}
                </label>
              ) : null}
              {[
                ["title", "Título"],
                ["actionType", "Tipo"],
                ["scheduledAt", "Fecha y hora"],
                ["priority", "Prioridad"],
                ["notes", "Notas"],
                ["successCriteria", "Criterio de éxito"],
              ].map(([field, label]) => (
                <label key={field}>
                  {label}
                  {field === "actionType" ? (
                    <select
                      value={normalizeCoachActivityType(
                        coachOperationDraft.operation[field],
                      )}
                      aria-invalid={coachDraftMissingSet.has(field)}
                      onChange={(event) =>
                        setCoachOperationDraft((current) => ({
                          ...current,
                          operation: {
                            ...current.operation,
                            [field]: event.target.value,
                          },
                        }))
                      }
                    >
                      {COACH_ACTIVITY_TYPE_OPTIONS.map(
                        ({ value, label }) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                  ) : field === "priority" ? (
                    <select
                      value={
                        coachOperationDraft.operation[field] || "medium"
                      }
                      aria-invalid={coachDraftMissingSet.has(field)}
                      onChange={(event) =>
                        setCoachOperationDraft((current) => ({
                          ...current,
                          operation: {
                            ...current.operation,
                            [field]: event.target.value,
                          },
                        }))
                      }
                    >
                      <option value="critical">Crítica</option>
                      <option value="high">Alta</option>
                      <option value="medium">Media</option>
                      <option value="low">Baja</option>
                    </select>
                  ) : field === "notes" || field === "successCriteria" ? (
                    <textarea
                      rows={2}
                      value={coachOperationDraft.operation[field] || ""}
                      aria-invalid={coachDraftMissingSet.has(field)}
                      onChange={(event) =>
                        setCoachOperationDraft((current) => ({
                          ...current,
                          operation: {
                            ...current.operation,
                            [field]: event.target.value,
                          },
                        }))
                      }
                    />
                  ) : (
                    <input
                      type={
                        field === "scheduledAt"
                          ? "datetime-local"
                          : "text"
                      }
                      value={coachOperationDraft.operation[field] || ""}
                      aria-invalid={coachDraftMissingSet.has(field)}
                      onChange={(event) =>
                        setCoachOperationDraft((current) => ({
                          ...current,
                          operation: {
                            ...current.operation,
                            [field]: event.target.value,
                          },
                        }))
                      }
                    />
                  )}
                  {coachDraftMissingSet.has(field) ? (
                    <small className="mi-agent-coach-field-error">
                      Este campo es obligatorio para continuar.
                    </small>
                  ) : null}
                </label>
              ))}
            </div>
          ) : coachOperationDraft.operation.kind === "opportunity_note" ? (
            <div className="mi-agent-coach-action-form">
              <label>
                Oportunidad
                <input
                  value={
                    (
                      coachOperationOpportunityOptionsOverride ||
                      snapshot.pipeline.opportunities
                    ).find((item) =>
                      Number(item.id) === Number(coachOperationDraft.operation.opportunityId),
                    )?.name ||
                    `Oportunidad #${coachOperationDraft.operation.opportunityId}`
                  }
                  disabled
                />
              </label>
              <label>
                Texto de la nota
                <textarea
                  rows={5}
                  value={coachOperationDraft.operation.noteText || ""}
                  aria-invalid={coachDraftMissingSet.has("noteText")}
                  onChange={(event) =>
                    setCoachOperationDraft((current) => ({
                      ...current,
                      operation: {
                        ...current.operation,
                        noteText: event.target.value,
                      },
                    }))
                  }
                />
                {coachDraftMissingSet.has("noteText") ? (
                  <small className="mi-agent-coach-field-error">
                    El texto de la nota es obligatorio.
                  </small>
                ) : null}
                <small>
                  Fuente: {coachOperationDraft.operation.attribution || "sin atribución"} ·
                  certeza: {coachOperationDraft.operation.certainty || "sin especificar"}.
                  El guardado no se puede deshacer.
                </small>
              </label>
            </div>
          ) : coachOperationDraft.operation.kind === "stage_answer" ||
            coachOperationDraft.operation.kind === "lead_call_outcome" ? (
            <label>
              {coachOperationDraft.operation.kind === "stage_answer"
                ? "Respuesta de etapa"
                : "Comentario del resultado"}
              <textarea
                rows={4}
                value={coachOperationDraft.value}
                aria-invalid={coachDraftMissingSet.has(
                  coachOperationDraft.operation.kind === "stage_answer"
                    ? "answerValue"
                    : "comment",
                )}
                onChange={(event) =>
                  setCoachOperationDraft((current) => ({
                    ...current,
                    value: event.target.value,
                  }))
                }
              />
              {coachDraftMissingSet.has(
                coachOperationDraft.operation.kind === "stage_answer"
                  ? "answerValue"
                  : "comment",
              ) ? (
                <small className="mi-agent-coach-field-error">
                  Este campo es obligatorio para continuar.
                </small>
              ) : null}
            </label>
          ) : (
            <div className="mi-agent-coach-action-form">
              {coachOperationDraft.operation.field ? (
                <>
                  <label>
                    Campo a actualizar
                    <input
                      value={formatCoachFieldLabel(
                        coachOperationDraft.operation.field,
                      )}
                      disabled
                    />
                  </label>
                  <label>
                    Valor actual
                    <input
                      value={
                        coachOperationDraft.operation.currentValue ??
                        "Sin valor"
                      }
                      disabled
                    />
                  </label>
                </>
              ) : null}
              <label>
                Nuevo valor
                <input
                  value={coachOperationDraft.value}
                  disabled={Boolean(coachOperationDraft.operation.updateDraftId)}
                  aria-invalid={coachDraftMissingSet.has("value")}
                  onChange={(event) =>
                    setCoachOperationDraft((current) => ({
                      ...current,
                      value: event.target.value,
                    }))
                  }
                />
                {coachOperationDraft.operation.updateDraftId ? (
                  <small>Para corregir el valor, vuelve al chat. Cada corrección requiere revisar la nueva propuesta antes de guardar.</small>
                ) : null}
                {coachDraftMissingSet.has("value") ? (
                  <small className="mi-agent-coach-field-error">
                    Este campo es obligatorio para continuar.
                  </small>
                ) : null}
              </label>
            </div>
          )}
          {coachOperationDraft.operation.kind === "stage_answer" &&
          coachOperationDraft.operation.previousAnswer ? (
            <label>
              Tratamiento de la respuesta anterior
              <select
                value={coachOperationDraft.answerMode}
                onChange={(event) =>
                  setCoachOperationDraft((current) => ({
                    ...current,
                    answerMode: event.target.value,
                  }))
                }
              >
                <option value="replace">Reemplazar</option>
                <option value="append">
                  Agregar a la respuesta anterior
                </option>
              </select>
            </label>
          ) : null}
          {coachOperationDraft.error ? (
            <p className="form-error" role="alert">
              {coachOperationDraft.error}
            </p>
          ) : null}
          <p className="mi-agent-coach-save-state" aria-live="polite">
            {savingCoachOperation || coachDraftSaving
              ? "Guardando y validando la operación..."
              : coachDraftMissingFields.length
                ? "La operación permanecerá pendiente hasta completar los campos indicados."
                : coachOperationDraft.operation.kind === "activity"
                  ? "Los cambios se guardarán al continuar en el módulo."
                : coachOperationDraft.reviewedAt
                  ? "Valor actual revisado. Confirma para guardar."
                  : "Revisa el valor actual antes de confirmar."}
          </p>
        </div>
        <div className="modal-buttons">
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              rejectCoachOperation(coachOperationDraft.operation)
            }
            disabled={savingCoachOperation || coachDraftSaving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={applyCoachOperation}
            disabled={
              savingCoachOperation ||
              coachDraftSaving ||
              !canExecuteCoach ||
              coachDraftMissingFields.length > 0 ||
              (coachOperationDraft.operation.kind === "activity"
                ? !String(
                    coachOperationDraft.operation.title || "",
                  ).trim() ||
                  !String(
                    coachOperationDraft.operation.scheduledAt || "",
                  ).trim()
                : coachOperationDraft.operation.kind === "opportunity_note"
                  ? !String(coachOperationDraft.operation.noteText || "").trim()
                : [
                      "create_account",
                      "create_contact",
                      "create_opportunity",
                      "link_contact_to_opportunity",
                      "create_lead",
                      "create_contact_mapping",
                      "create_quotation",
                      "create_proposal",
                      "lead_resolve",
                      "reschedule_activity",
                      "validate_stage",
                    ].includes(coachOperationDraft.operation.kind)
                  ? !Object.keys(coachOperationDraft.payload || {}).length
                  : !coachOperationDraft.operation.updateDraftId && !coachOperationDraft.operation.outcomeDraftId && !String(coachOperationDraft.value ?? "").trim())
            }
          >
            {savingCoachOperation
              ? "Preparando..."
              : COACH_HANDOFF_OPERATION_KINDS.has(
                    coachOperationDraft.operation.kind,
                  )
                ? "Continuar en el módulo"
                : coachOperationDraft.reviewedAt
                  ? "Confirmar y guardar"
                  : "Revisar valor actual"}
          </button>
        </div>
      </div>
    </div>
  );
}
