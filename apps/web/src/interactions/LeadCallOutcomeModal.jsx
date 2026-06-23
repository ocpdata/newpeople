import { useMemo, useState } from "react";
import { formatBusinessDateTime } from "../business-timezone";
import {
  getLeadCallOutcomeActionGuide,
  getLeadCallOutcomeReasonGuide,
  getLeadCallOutcomeSubstatusGuide,
} from "./leadCallOutcomeGuideData";
import { LeadCallOutcomeOptionCards } from "./LeadCallOutcomeGuides";

const EMPTY_LEAD_CATALOG = Object.freeze([]);
const EMPTY_LEAD_HISTORY = Object.freeze([]);

function formatDateTime(value) {
  return formatBusinessDateTime(value, {
    options: {
      dateStyle: "short",
      timeStyle: "short",
    },
  });
}

function normalizeLeadDisplayText(value) {
  const text = String(value || "");
  if (!text) return "";

  return text
    .replace(
      /\b(interacciones|interacciónes|ieracciones|ieracciónes)\b/gi,
      (match) =>
        match.charAt(0) === match.charAt(0).toUpperCase() ? "Leads" : "leads",
    )
    .replace(
      /\b(interaccion|interacción|iteraccion|iteracción)\b/gi,
      (match) =>
        match.charAt(0) === match.charAt(0).toUpperCase() ? "Lead" : "lead",
    )
    .replace(/\b[Nn]ueva\s+lead\b/g, (match) =>
      match.charAt(0) === "N" ? "Nuevo lead" : "nuevo lead",
    );
}

function getLeadCatalogEntryByCode(entries, code) {
  if (!Array.isArray(entries) || !code) return null;
  return entries.find((entry) => String(entry?.code) === String(code)) || null;
}

function getLeadOutcomeEventTypeLabel(eventType) {
  switch (eventType) {
    case "admin_correction":
      return "Corrección administrativa";
    case "legacy_snapshot":
      return "Snapshot heredado";
    case "activity_update":
    default:
      return "Actualización por actividad";
  }
}

function extractLeadOutcomeDateText(value) {
  if (!value) return "";
  const text = String(value).trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || "";
}

function buildLeadCallOutcomeForm(detail, transitionRules) {
  const initialRule =
    transitionRules.find(
      (rule) =>
        rule.substatusCode === detail?.leadSubstatusCode &&
        rule.reasonCode === detail?.leadReasonCode &&
        rule.requiredActionCode === detail?.leadRequiredActionCode,
    ) ||
    transitionRules[0] ||
    null;

  return {
    substatusCode: initialRule?.substatusCode || "",
    reasonCode: initialRule?.reasonCode || "",
    requiredActionCode: initialRule?.requiredActionCode || "",
    comment: detail?.leadCommercialComment || "",
    nextActionDueAt: extractLeadOutcomeDateText(detail?.leadNextActionDueAt),
    referredContactName: detail?.leadReferredContactName || "",
    referredAreaName: detail?.leadReferredAreaName || "",
    eventType: "activity_update",
    correctionReason: "",
    correctionTargetEventId: "",
  };
}

export default function LeadCallOutcomeModal({
  isOpen,
  detail,
  catalogs,
  onClose,
  onSubmit,
  saving,
}) {
  const transitionRules = Array.isArray(catalogs?.transitionRules)
    ? catalogs.transitionRules
    : EMPTY_LEAD_CATALOG;
  const substatuses = Array.isArray(catalogs?.substatuses)
    ? catalogs.substatuses
    : EMPTY_LEAD_CATALOG;
  const reasons = Array.isArray(catalogs?.reasons)
    ? catalogs.reasons
    : EMPTY_LEAD_CATALOG;
  const requiredActions = Array.isArray(catalogs?.requiredActions)
    ? catalogs.requiredActions
    : EMPTY_LEAD_CATALOG;
  const statuses = Array.isArray(catalogs?.statuses)
    ? catalogs.statuses
    : EMPTY_LEAD_CATALOG;
  const [form, setForm] = useState(() =>
    buildLeadCallOutcomeForm(detail, transitionRules),
  );

  const substatusOptions = useMemo(
    () =>
      transitionRules
        .map((rule) =>
          getLeadCatalogEntryByCode(substatuses, rule.substatusCode),
        )
        .filter(Boolean)
        .filter(
          (entry, index, entries) =>
            entries.findIndex((candidate) => candidate.code === entry.code) ===
            index,
        ),
    [substatuses, transitionRules],
  );

  const selectedSubstatusCode = substatusOptions.some(
    (entry) => entry.code === form.substatusCode,
  )
    ? form.substatusCode
    : substatusOptions[0]?.code || "";

  const reasonOptions = useMemo(() => {
    return transitionRules
      .filter((rule) => rule.substatusCode === selectedSubstatusCode)
      .map((rule) => getLeadCatalogEntryByCode(reasons, rule.reasonCode))
      .filter(Boolean)
      .filter(
        (entry, index, entries) =>
          entries.findIndex((candidate) => candidate.code === entry.code) ===
          index,
      );
  }, [reasons, selectedSubstatusCode, transitionRules]);

  const selectedReasonCode = reasonOptions.some(
    (entry) => entry.code === form.reasonCode,
  )
    ? form.reasonCode
    : reasonOptions[0]?.code || "";

  const requiredActionOptions = useMemo(() => {
    return transitionRules
      .filter(
        (rule) =>
          rule.substatusCode === selectedSubstatusCode &&
          rule.reasonCode === selectedReasonCode,
      )
      .map((rule) =>
        getLeadCatalogEntryByCode(requiredActions, rule.requiredActionCode),
      )
      .filter(Boolean)
      .filter(
        (entry, index, entries) =>
          entries.findIndex((candidate) => candidate.code === entry.code) ===
          index,
      );
  }, [
    requiredActions,
    selectedReasonCode,
    selectedSubstatusCode,
    transitionRules,
  ]);

  const selectedRequiredActionCode = requiredActionOptions.some(
    (entry) => entry.code === form.requiredActionCode,
  )
    ? form.requiredActionCode
    : requiredActionOptions[0]?.code || "";

  const selectedRule = useMemo(
    () =>
      transitionRules.find(
        (rule) =>
          rule.substatusCode === selectedSubstatusCode &&
          rule.reasonCode === selectedReasonCode &&
          rule.requiredActionCode === selectedRequiredActionCode,
      ) || null,
    [
      selectedReasonCode,
      selectedRequiredActionCode,
      selectedSubstatusCode,
      transitionRules,
    ],
  );

  if (!isOpen || !detail) return null;

  const resultStatus = getLeadCatalogEntryByCode(
    statuses,
    selectedRule?.resultStatusCode,
  );
  const selectedSubstatus = getLeadCatalogEntryByCode(
    substatuses,
    selectedSubstatusCode,
  );
  const selectedSubstatusGuide = getLeadCallOutcomeSubstatusGuide(
    selectedSubstatusCode,
  );
  const selectedReason = getLeadCatalogEntryByCode(reasons, selectedReasonCode);
  const selectedReasonGuide = getLeadCallOutcomeReasonGuide(selectedReasonCode);
  const selectedRequiredAction = getLeadCatalogEntryByCode(
    requiredActions,
    selectedRequiredActionCode,
  );
  const selectedActionGuide = getLeadCallOutcomeActionGuide(
    selectedRequiredActionCode,
  );
  const leadOutcomeHistory = Array.isArray(detail?.leadOutcomeHistory)
    ? detail.leadOutcomeHistory
    : EMPTY_LEAD_HISTORY;

  return (
    <div
      className="modal-overlay modal-overlay-elevated"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div className="modal-dialog resolve-confirmation-modal lead-outcome-modal">
        <div className="modal-header interaction-modal-header-with-close">
          <button
            type="button"
            className="btn-secondary account-modal-close-button interaction-modal-close-left"
            onClick={onClose}
            disabled={saving}
            aria-label="Cerrar modal de resultado de llamada"
            title="Cerrar"
          >
            ×
          </button>
          <div>
            <span className="lead-decision-kicker">Resultado guiado</span>
            <h3 className="modal-title">Registrar situación del lead</h3>
            <p className="roles-subtitle resolve-confirmation-subtitle">
              {normalizeLeadDisplayText(detail.title)}
            </p>
          </div>
        </div>

        <form
          className="account-create-form in-modal lead-outcome-modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectedRule || saving) return;
            onSubmit({
              ...form,
              substatusCode: selectedSubstatusCode,
              reasonCode: selectedReasonCode,
              requiredActionCode: selectedRequiredActionCode,
              eventType: form.eventType || "activity_update",
              correctionTargetEventId: form.correctionTargetEventId
                ? Number(form.correctionTargetEventId)
                : null,
            });
          }}
        >
          <div className="lead-outcome-modal-layout">
            <div className="lead-outcome-modal-main">
              <div className="lead-outcome-modal-grid">
                <section className="lead-outcome-modal-block">
                  <LeadCallOutcomeOptionCards
                    label="Situación del lead"
                    entries={substatusOptions}
                    selectedCode={selectedSubstatusCode}
                    disabled={saving}
                    getGuide={getLeadCallOutcomeSubstatusGuide}
                    kind="substatus"
                    onSelect={(code) =>
                      setForm((currentValue) => ({
                        ...currentValue,
                        substatusCode: code,
                        reasonCode: "",
                        requiredActionCode: "",
                      }))
                    }
                  />
                  {selectedSubstatusGuide || selectedSubstatus?.description ? (
                    <p className="field-hint lead-outcome-modal-selection-hint">
                      {selectedSubstatusGuide?.whenToUse ||
                        selectedSubstatus?.description ||
                        ""}
                    </p>
                  ) : null}
                </section>

                <section className="lead-outcome-modal-block">
                  <LeadCallOutcomeOptionCards
                    label="Motivo principal"
                    entries={reasonOptions}
                    selectedCode={selectedReasonCode}
                    disabled={saving || !reasonOptions.length}
                    getGuide={getLeadCallOutcomeReasonGuide}
                    kind="reason"
                    onSelect={(code) =>
                      setForm((currentValue) => ({
                        ...currentValue,
                        reasonCode: code,
                        requiredActionCode: "",
                      }))
                    }
                  />
                  {selectedReasonGuide || selectedReason ? (
                    <p className="field-hint lead-outcome-modal-selection-hint">
                      {selectedReasonGuide?.whenToUse ||
                        selectedReason?.name ||
                        ""}
                    </p>
                  ) : null}
                </section>

                <section className="lead-outcome-modal-block lead-outcome-modal-block-wide">
                  <LeadCallOutcomeOptionCards
                    label="Siguiente acción obligatoria"
                    entries={requiredActionOptions}
                    selectedCode={selectedRequiredActionCode}
                    disabled={saving || !requiredActionOptions.length}
                    getGuide={getLeadCallOutcomeActionGuide}
                    kind="action"
                    onSelect={(code) =>
                      setForm((currentValue) => ({
                        ...currentValue,
                        requiredActionCode: code,
                      }))
                    }
                  />
                  {selectedActionGuide || selectedRequiredAction ? (
                    <p className="field-hint lead-outcome-modal-selection-hint">
                      {selectedActionGuide?.whenToUse ||
                        selectedRequiredAction?.name ||
                        ""}
                    </p>
                  ) : null}
                </section>
              </div>
            </div>

            <aside className="lead-outcome-modal-sidebar">
              <section className="account-form-section account-modal-section lead-outcome-summary-panel">
                <div className="lead-outcome-summary-head">
                  <strong>Lectura rápida</strong>
                  <span className="lead-outcome-summary-pill">
                    {resultStatus?.name || "Sin transición válida"}
                  </span>
                </div>
                <div className="lead-outcome-summary-list">
                  <article className="lead-outcome-summary-item">
                    <span>Situación</span>
                    <strong>{selectedSubstatus?.name || "Sin definir"}</strong>
                  </article>
                  <article className="lead-outcome-summary-item">
                    <span>Motivo</span>
                    <strong>{selectedReason?.name || "Sin definir"}</strong>
                  </article>
                  <article className="lead-outcome-summary-item">
                    <span>Acción</span>
                    <strong>
                      {selectedRequiredAction?.name || "Sin definir"}
                    </strong>
                  </article>
                </div>
              </section>

              <section className="account-form-section account-modal-section lead-outcome-side-panel">
                <div className="field-group">
                  <label>Tipo de registro</label>
                  <select
                    value={form.eventType || "activity_update"}
                    onChange={(event) =>
                      setForm((currentValue) => ({
                        ...currentValue,
                        eventType: event.target.value,
                        correctionTargetEventId:
                          event.target.value === "admin_correction"
                            ? currentValue.correctionTargetEventId
                            : "",
                        correctionReason:
                          event.target.value === "admin_correction"
                            ? currentValue.correctionReason
                            : "",
                      }))
                    }
                    disabled={saving}
                  >
                    <option value="activity_update">
                      Actualización por actividad
                    </option>
                    <option value="admin_correction">
                      Corrección administrativa
                    </option>
                  </select>
                </div>

                {form.eventType === "admin_correction" ? (
                  <>
                    <div className="field-group">
                      <label>Evento a corregir (opcional)</label>
                      <select
                        value={form.correctionTargetEventId || ""}
                        onChange={(event) =>
                          setForm((currentValue) => ({
                            ...currentValue,
                            correctionTargetEventId: event.target.value,
                          }))
                        }
                        disabled={saving}
                      >
                        <option value="">Seleccionar evento</option>
                        {leadOutcomeHistory.map((eventItem) => (
                          <option
                            key={eventItem.id}
                            value={String(eventItem.id)}
                          >
                            {`${formatDateTime(eventItem.createdAt)} · ${getLeadOutcomeEventTypeLabel(eventItem.eventType)}`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field-group">
                      <label>Motivo de la corrección</label>
                      <textarea
                        value={form.correctionReason || ""}
                        onChange={(event) =>
                          setForm((currentValue) => ({
                            ...currentValue,
                            correctionReason: event.target.value,
                          }))
                        }
                        disabled={saving}
                        rows={3}
                        placeholder="Describe por qué se corrige el registro anterior"
                      />
                    </div>
                  </>
                ) : null}
              </section>

              {selectedRule?.requiresDueDate ||
              selectedRule?.requiresReferredContact ||
              selectedRule?.requiresReferredArea ? (
                <section className="account-form-section account-modal-section lead-outcome-side-panel">
                  <strong>Datos obligatorios para esta ruta</strong>
                  {selectedRule?.requiresDueDate ? (
                    <div className="field-group">
                      <label>Fecha compromiso</label>
                      <input
                        type="date"
                        value={form.nextActionDueAt}
                        onChange={(event) =>
                          setForm((currentValue) => ({
                            ...currentValue,
                            nextActionDueAt: event.target.value,
                          }))
                        }
                        disabled={saving}
                      />
                    </div>
                  ) : null}

                  {selectedRule?.requiresReferredContact ? (
                    <div className="field-group">
                      <label>Persona referida</label>
                      <input
                        value={form.referredContactName}
                        onChange={(event) =>
                          setForm((currentValue) => ({
                            ...currentValue,
                            referredContactName: event.target.value,
                          }))
                        }
                        disabled={saving}
                        placeholder="Nombre o referencia del nuevo contacto"
                      />
                    </div>
                  ) : null}

                  {selectedRule?.requiresReferredArea ? (
                    <div className="field-group">
                      <label>Área objetivo</label>
                      <input
                        value={form.referredAreaName}
                        onChange={(event) =>
                          setForm((currentValue) => ({
                            ...currentValue,
                            referredAreaName: event.target.value,
                          }))
                        }
                        disabled={saving}
                        placeholder="Ej. Compras, Operaciones, TI"
                      />
                    </div>
                  ) : null}
                </section>
              ) : null}

              <section className="account-form-section account-modal-section lead-outcome-side-panel">
                <label>Comentario del vendedor</label>
                <textarea
                  value={form.comment}
                  onChange={(event) =>
                    setForm((currentValue) => ({
                      ...currentValue,
                      comment: event.target.value,
                    }))
                  }
                  disabled={saving}
                  rows={5}
                  placeholder="Resumen corto de la conversación y contexto de la decisión"
                />
              </section>
            </aside>
          </div>

          <div className="modal-buttons lead-decision-actions">
            <button
              type="submit"
              className="btn-primary"
              disabled={!selectedRule || saving}
            >
              {saving ? "Guardando..." : "Registrar situación"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
