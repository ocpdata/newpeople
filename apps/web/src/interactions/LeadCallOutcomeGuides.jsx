import {
  getLeadCallOutcomeActionGuide,
  getLeadCallOutcomeReasonGuide,
  getLeadCallOutcomeSubstatusGuide,
} from "./leadCallOutcomeGuideData";

function getLeadOutcomeIconMeta(kind, code) {
  const normalizedCode = String(code || "");

  if (kind === "substatus") {
    if (normalizedCode === "contact_attempt_pending") {
      return { tone: "info", icon: "search" };
    }
    if (
      normalizedCode === "meeting_requested" ||
      normalizedCode === "meeting_confirmed"
    ) {
      return { tone: "success", icon: "calendar" };
    }
    if (
      normalizedCode === "needs_follow_up_later" ||
      normalizedCode === "budget_timing_issue" ||
      normalizedCode === "priority_not_now"
    ) {
      return { tone: "warning", icon: "clock" };
    }
    if (
      normalizedCode === "wrong_contact_identified" ||
      normalizedCode === "alternative_contact_needed"
    ) {
      return { tone: "accent", icon: "user" };
    }
    if (
      normalizedCode === "account_has_other_potential" ||
      normalizedCode === "value_misaligned_current_contact"
    ) {
      return { tone: "teal", icon: "branch" };
    }
    if (
      normalizedCode === "disqualified_temporary" ||
      normalizedCode === "disqualified_definitive"
    ) {
      return { tone: "danger", icon: "stop" };
    }
  }

  if (kind === "reason") {
    if (normalizedCode === "needs_more_information") {
      return { tone: "info", icon: "search" };
    }
    if (
      normalizedCode === "interest_confirmed" ||
      normalizedCode === "meeting_accepted"
    ) {
      return { tone: "success", icon: "spark" };
    }
    if (
      normalizedCode === "follow_up_later_requested" ||
      normalizedCode === "budget_next_cycle" ||
      normalizedCode === "timing_not_right"
    ) {
      return { tone: "warning", icon: "clock" };
    }
    if (
      normalizedCode === "wrong_contact" ||
      normalizedCode === "referred_to_other_contact"
    ) {
      return { tone: "accent", icon: "user" };
    }
    if (
      normalizedCode === "account_potential_other_use_case" ||
      normalizedCode === "offer_not_relevant_current_area"
    ) {
      return { tone: "teal", icon: "branch" };
    }
    if (
      normalizedCode === "no_current_initiative" ||
      normalizedCode === "no_interest_definitive" ||
      normalizedCode === "do_not_contact_requested"
    ) {
      return { tone: "danger", icon: "stop" };
    }
  }

  if (kind === "action") {
    if (normalizedCode === "collect_missing_context") {
      return { tone: "info", icon: "search" };
    }
    if (normalizedCode === "schedule_meeting") {
      return { tone: "success", icon: "calendar" };
    }
    if (normalizedCode === "revisit_on_date") {
      return { tone: "warning", icon: "clock" };
    }
    if (normalizedCode === "contact_referred_person") {
      return { tone: "accent", icon: "user" };
    }
    if (normalizedCode === "explore_other_area") {
      return { tone: "teal", icon: "branch" };
    }
    if (
      normalizedCode === "close_as_disqualified" ||
      normalizedCode === "mark_do_not_contact"
    ) {
      return { tone: "danger", icon: "stop" };
    }
  }

  return { tone: "neutral", icon: "spark" };
}

function LeadOutcomeIcon({ kind, code }) {
  const iconMeta = getLeadOutcomeIconMeta(kind, code);

  return (
    <span
      className={`lead-outcome-guide-card-icon tone-${iconMeta.tone}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" focusable="false">
        {iconMeta.icon === "search" ? (
          <>
            <circle cx="11" cy="11" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path d="M15.2 15.2 19 19" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
          </>
        ) : null}
        {iconMeta.icon === "calendar" ? (
          <>
            <rect x="4.5" y="6" width="15" height="13" rx="3" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path d="M8 4.8v2.5M16 4.8v2.5M4.5 9.5h15" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
          </>
        ) : null}
        {iconMeta.icon === "clock" ? (
          <>
            <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path d="M12 8.5v4.1l2.8 1.9" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
          </>
        ) : null}
        {iconMeta.icon === "user" ? (
          <>
            <circle cx="9" cy="8.4" r="2.7" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path d="M4.8 17.5c.8-2.6 2.7-4 4.9-4s4.1 1.4 4.9 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
            <path d="M15.5 9.8h4M17.5 7.8v4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
          </>
        ) : null}
        {iconMeta.icon === "branch" ? (
          <>
            <path d="M8 6.5h5.5a3 3 0 0 1 3 3v1.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
            <path d="M8 17.5h5.5a3 3 0 0 0 3-3v-1.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
            <circle cx="7" cy="6.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <circle cx="7" cy="17.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <circle cx="17" cy="12" r="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
          </>
        ) : null}
        {iconMeta.icon === "stop" ? (
          <>
            <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path d="M8.8 15.2 15.2 8.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
          </>
        ) : null}
        {iconMeta.icon === "spark" ? (
          <>
            <path d="m12 4.8 1.6 4.1 4.1 1.6-4.1 1.6-1.6 4.1-1.6-4.1-4.1-1.6 4.1-1.6Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
            <path d="m17.2 15.5.8 2 .8-2 2-.8-2-.8-.8-2-.8 2-2 .8Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
          </>
        ) : null}
      </svg>
    </span>
  );
}

export function LeadCallOutcomeOptionCards({
  label,
  entries,
  selectedCode,
  onSelect,
  getGuide,
  disabled,
  kind = "substatus",
  columns = 1,
}) {
  const canSelect = typeof onSelect === "function";

  return (
    <div className="account-form-section account-modal-section lead-outcome-guide-shell">
      <div className="lead-outcome-guide-head">
        <label>{label}</label>
        <span className="lead-outcome-guide-count">
          {entries.length} {entries.length === 1 ? "opción" : "opciones"}
        </span>
      </div>
      <div
        className={`lead-outcome-guide-grid${columns === 2 ? " has-two-columns" : ""}`}
      >
        {entries.map((entry) => {
          const guide = getGuide?.(entry.code);
          const isSelected = entry.code === selectedCode;
          const CardTag = canSelect ? "button" : "div";
          return (
            <CardTag
              key={entry.code}
              className={`lead-outcome-guide-card${isSelected ? " is-selected" : ""}${canSelect ? " is-clickable" : ""}`}
              type={canSelect ? "button" : undefined}
              onClick={canSelect ? () => onSelect(entry.code) : undefined}
              disabled={canSelect ? disabled : undefined}
              aria-pressed={canSelect ? isSelected : undefined}
            >
              <div className="lead-outcome-guide-card-main">
                <LeadOutcomeIcon kind={kind} code={entry.code} />
                <div className="lead-outcome-guide-card-stack">
                  <div className="lead-outcome-guide-card-topline">
                    <p className="field-hint lead-outcome-guide-card-title">
                      <strong>{entry.name}</strong>
                    </p>
                    {isSelected ? (
                      <span className="lead-outcome-guide-selected-badge">
                        Seleccionada
                      </span>
                    ) : null}
                  </div>
                  {guide?.optionHint ? (
                    <p className="field-hint lead-outcome-guide-card-kicker">
                      {guide.optionHint}
                    </p>
                  ) : null}
                  {entry.description ? (
                    <p className="field-hint lead-outcome-guide-card-copy">
                      {entry.description}
                    </p>
                  ) : null}
                  {guide?.whenToUse ? (
                    <p className="field-hint lead-outcome-guide-card-copy">
                      {guide.whenToUse}
                    </p>
                  ) : null}
                  {guide?.avoidWhen ? (
                    <p className="field-hint lead-outcome-guide-card-warning">
                      <strong>Evitar cuando:</strong> {guide.avoidWhen}
                    </p>
                  ) : null}
                </div>
              </div>
            </CardTag>
          );
        })}
      </div>
    </div>
  );
}

export function LeadCallOutcomeInlineGuide({
  title = "Ayuda para seguimiento comercial",
  summary = "Ver criterios de situación, motivo y acción obligatoria",
  substatusEntries,
  reasonEntries,
  actionEntries,
  selectedSubstatusCode,
  selectedReasonCode,
  selectedActionCode,
}) {
  const hasEntries =
    substatusEntries.length || reasonEntries.length || actionEntries.length;

  if (!hasEntries) {
    return null;
  }

  return (
    <details className="account-form-section account-modal-section lead-outcome-inline-guide">
      <summary className="accounts-module-help-trigger account-modal-help-trigger account-modal-help-trigger-labeled lead-outcome-inline-guide-summary">
        <span>{summary}</span>
        <span className="lead-outcome-inline-guide-summary-hint">
          Abrir guía
        </span>
      </summary>
      <div className="lead-outcome-inline-guide-body">
        <strong className="lead-outcome-inline-guide-title">{title}</strong>
        <p className="field-hint lead-outcome-inline-guide-copy">
          Esta guía resume cuándo conviene usar cada combinación en el registro de resultado de llamada.
        </p>
        {substatusEntries.length ? (
          <LeadCallOutcomeOptionCards
            label="Situación del lead"
            entries={substatusEntries}
            selectedCode={selectedSubstatusCode}
            getGuide={getLeadCallOutcomeSubstatusGuide}
            kind="substatus"
          />
        ) : null}
        {reasonEntries.length ? (
          <LeadCallOutcomeOptionCards
            label="Motivo principal"
            entries={reasonEntries}
            selectedCode={selectedReasonCode}
            getGuide={getLeadCallOutcomeReasonGuide}
            kind="reason"
          />
        ) : null}
        {actionEntries.length ? (
          <LeadCallOutcomeOptionCards
            label="Siguiente acción obligatoria"
            entries={actionEntries}
            selectedCode={selectedActionCode}
            getGuide={getLeadCallOutcomeActionGuide}
            kind="action"
          />
        ) : null}
      </div>
    </details>
  );
}