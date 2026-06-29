import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getApiErrorMessage } from "./api";
import {
  addDaysToIsoDate,
  formatBusinessDate,
  formatBusinessDateTime,
  formatBusinessTime,
  toBusinessDateInputValue,
  toBusinessDateTimeInputValue,
} from "./business-timezone";
import LeadCallOutcomeModal from "./interactions/LeadCallOutcomeModal";

const VIEW_OPTIONS = [{ value: "week", label: "Semana" }];

const CALENDAR_ACTIVITY_TYPE_OPTIONS = [
  { value: "call", label: "Llamada" },
  { value: "conference", label: "Conferencia" },
  { value: "visit", label: "Visita" },
  { value: "presentation", label: "Presentacion" },
  { value: "other", label: "Otro" },
];

const CALENDAR_ACTIVITY_STATUS_OPTIONS = [
  { value: "pending", label: "Programada" },
  { value: "confirmed", label: "Confirmada" },
  { value: "rescheduled", label: "Reprogramada" },
  { value: "in_progress", label: "En curso" },
  { value: "blocked", label: "Bloqueada" },
  { value: "done", label: "Realizada" },
  { value: "missed", label: "No realizada" },
  { value: "cancelled", label: "Cancelada" },
];

const MORNING_CUTOFF_HOUR = 12;

const CALENDAR_SOURCE_LABELS = {
  opportunity: "Oportunidad",
  interaction: "Lead",
  unknown: "No definido",
};

const LEAD_SUBSTATUS_CATEGORY_BY_CODE = {
  new_unreviewed: "inicio",
  research_pending: "inicio",
  ready_for_outreach: "inicio",
  contact_attempt_pending: "contacto",
  contacted_waiting_response: "contacto",
  meeting_requested: "avance",
  meeting_confirmed: "avance",
  needs_follow_up_later: "nurture",
  wrong_contact_identified: "redireccion",
  alternative_contact_needed: "redireccion",
  account_has_other_potential: "redireccion",
  value_misaligned_current_contact: "redireccion",
  budget_timing_issue: "nurture",
  priority_not_now: "nurture",
  qualified_opportunity_created: "cierre_positivo",
  disqualified_temporary: "cierre_negativo",
  disqualified_definitive: "cierre_negativo",
};

const EMPTY_LEAD_OUTCOME_CATALOGS = {
  statuses: [],
  substatuses: [],
  reasons: [],
  requiredActions: [],
  transitionRules: [],
};

function toDateInputValue(value) {
  return toBusinessDateInputValue(value);
}

function formatDateTime(value) {
  return formatBusinessDateTime(value, {
    options: {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  });
}

function formatDate(value) {
  return formatBusinessDate(value, {
    options: {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    },
    fallback: String(value || "Sin fecha"),
  });
}

function formatTime(value) {
  return formatBusinessTime(value);
}

function toSortableTimeValue(value) {
  const display = formatBusinessTime(value, {
    fallback: "23:59",
    options: {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    },
  });
  const [hourText, minuteText] = String(display).split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return 23 * 60 + 59;
  }
  return hour * 60 + minute;
}

function sortCalendarItemsBySchedule(items) {
  return [...(items || [])].sort((left, right) => {
    const leftDate = String(left?.scheduledDate || "").trim();
    const rightDate = String(right?.scheduledDate || "").trim();
    if (leftDate && rightDate && leftDate !== rightDate) {
      return leftDate.localeCompare(rightDate);
    }

    const leftTimeValue = toSortableTimeValue(left?.scheduledAt);
    const rightTimeValue = toSortableTimeValue(right?.scheduledAt);
    if (leftTimeValue !== rightTimeValue) {
      return leftTimeValue - rightTimeValue;
    }

    const leftTitle = String(left?.title || "").trim();
    const rightTitle = String(right?.title || "").trim();
    return leftTitle.localeCompare(rightTitle, "es");
  });
}

function toDateTimeInputValue(value) {
  return toBusinessDateTimeInputValue(value);
}

function splitDateTimeInputValue(value) {
  if (!value || !String(value).includes("T")) {
    return { date: "", time: "" };
  }
  const [datePart, timePart] = String(value).split("T");
  return {
    date: datePart || "",
    time: (timePart || "").slice(0, 5),
  };
}

function joinDateAndTime(datePart, timePart) {
  if (!datePart || !timePart) return "";
  return `${datePart}T${timePart}`;
}

function shiftDateInputValue(datePart, daysToShift) {
  if (!datePart) return "";
  return addDaysToIsoDate(datePart, daysToShift);
}

function activityStatusLabel(statusValue) {
  return (
    CALENDAR_ACTIVITY_STATUS_OPTIONS.find((item) => item.value === statusValue)
      ?.label || "Programada"
  );
}

function activityTypeLabel(typeValue) {
  return (
    CALENDAR_ACTIVITY_TYPE_OPTIONS.find((item) => item.value === typeValue)
      ?.label || "Actividad"
  );
}

function normalizeCalendarActivityDraft(activity) {
  if (!activity) {
    return {
      id: null,
      opportunityId: null,
      opportunityName: "",
      accountName: "",
      activityType: "call",
      status: "pending",
      scheduledAt: "",
      objective: "",
      note: "",
      successCriteria: "",
      isPrimaryNextStep: false,
      readonlyByStatus: false,
      calendarSource: "opportunity",
    };
  }

  return {
    id: Number(activity.id || 0) || null,
    opportunityId: Number(activity.opportunityId || 0) || null,
    opportunityName: String(activity.opportunityName || "").trim(),
    accountName: String(activity.accountName || "").trim(),
    activityType: String(activity.activityType || "call").trim() || "call",
    status: String(activity.status || "pending").trim() || "pending",
    scheduledAt: toDateTimeInputValue(activity.scheduledAt),
    objective: String(activity.objective || activity.title || "").trim(),
    note: String(activity.note || "").trim(),
    successCriteria: String(activity.successCriteria || "").trim(),
    isPrimaryNextStep: Boolean(activity.isPrimaryNextStep),
    readonlyByStatus: Boolean(activity.readonlyByStatus),
    calendarSource:
      String(activity.calendarSource || "opportunity").trim() || "opportunity",
  };
}

function parseCalendarDate(value) {
  if (!value) return null;

  const text = String(value);
  const yyyyMmDd = text.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) {
    const [yearText, monthText, dayText] = yyyyMmDd.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const parsed = new Date(year, month - 1, day);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function isWeekdayDate(value) {
  const parsed = parseCalendarDate(value);
  if (!parsed) return true;
  const weekDay = parsed.getDay();
  return weekDay >= 1 && weekDay <= 5;
}

function getDayActivityCount(day) {
  return Number(day?.count || day?.items?.length || 0);
}

function getDayPart(value) {
  const display = formatBusinessTime(value, {
    fallback: "12:00",
    options: {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    },
  });
  const parsedHour = Number(String(display).slice(0, 2));
  return Number.isFinite(parsedHour) && parsedHour < MORNING_CUTOFF_HOUR
    ? "manana"
    : "tarde";
}

function groupItemsByDayPart(items) {
  return (items || []).reduce(
    (groups, item) => {
      groups[getDayPart(item?.scheduledAt)].push(item);
      return groups;
    },
    { manana: [], tarde: [] },
  );
}

function formatActivityContext(item) {
  const parts = [item?.opportunityName, item?.accountName].filter(
    (value) => String(value || "").trim().length > 0,
  );
  return parts.join(" · ") || "Sin contexto comercial";
}

function formatCalendarSchedule(item) {
  const dateText = String(item?.scheduledDate || "").trim();
  if (dateText) {
    const timeText = formatTime(item?.scheduledAt);
    if (timeText && timeText !== "Sin hora") {
      return `${formatDate(dateText)} ${timeText}`;
    }
    return formatDate(dateText);
  }
  return formatDateTime(item?.scheduledAt);
}

function formatActivityTitle(item, fallback = "Sin objetivo") {
  const baseTitle = String(item?.title || "").trim() || fallback;
  return baseTitle;
}

function trafficLabel(value) {
  if (value === "red") return "Rojo";
  if (value === "amber") return "Ambar";
  return "Verde";
}

function normalizeCalendarSource(value) {
  const source = String(value || "").trim();
  if (source === "opportunity") return "opportunity";
  if (source === "interaction") return "interaction";
  return "unknown";
}

function getCalendarSourceLabel(value) {
  return CALENDAR_SOURCE_LABELS[normalizeCalendarSource(value)];
}

function getCalendarSourceBadgeClass(value) {
  const source = normalizeCalendarSource(value);
  if (source === "interaction") return "is-lead";
  if (source === "opportunity") return "is-opportunity";
  return "is-unknown";
}

function getCalendarActivityStatusCardClass(statusValue) {
  const status = String(statusValue || "")
    .trim()
    .toLowerCase();
  if (status === "done") return "is-status-done";
  if (status === "cancelled" || status === "canceled") {
    return "is-status-cancelled";
  }
  return "";
}

function getCalendarActivityStatusBadgeClass(statusValue) {
  const status = String(statusValue || "")
    .trim()
    .toLowerCase();
  if (status === "done") return "is-done";
  if (status === "cancelled" || status === "canceled") {
    return "is-cancelled";
  }
  return "is-open";
}

function getLeadSituationLabel(item) {
  const name = String(item?.leadSubstatusName || "").trim();
  if (name) return name;
  const code = String(item?.leadSubstatusCode || "").trim();
  return code ? code.replace(/_/g, " ") : "Sin situación";
}

function getLeadSituationClass(item) {
  const code = String(item?.leadSubstatusCode || "").trim();
  const category = LEAD_SUBSTATUS_CATEGORY_BY_CODE[code] || "default";
  return `is-lead-situation-${category}`;
}

function getCalendarActivityCardClass(item) {
  if (normalizeCalendarSource(item?.calendarSource) === "interaction") {
    return getLeadSituationClass(item);
  }
  return getCalendarActivityStatusCardClass(item?.status);
}

function CalendarActivityEditorModal({
  isOpen,
  loading,
  saving,
  error,
  notice,
  draft,
  readOnly,
  canUpdateActivities,
  onClose,
  onChange,
  onSave,
  onMarkDone,
  onCancelActivity,
}) {
  if (!isOpen) return null;

  const { date: scheduledDate, time: scheduledTime } = splitDateTimeInputValue(
    draft?.scheduledAt,
  );
  const currentStatusLabel = activityStatusLabel(draft?.status);
  const sourceLabel = getCalendarSourceLabel(draft?.calendarSource);
  const sourceBadgeClass = getCalendarSourceBadgeClass(draft?.calendarSource);
  const typeLabel = activityTypeLabel(draft?.activityType);

  const applyAgendaDate = (nextDate) => {
    onChange(
      "scheduledAt",
      joinDateAndTime(nextDate, scheduledTime || "09:00"),
    );
  };

  const applyAgendaTime = (nextTime) => {
    onChange(
      "scheduledAt",
      joinDateAndTime(scheduledDate || toDateInputValue(), nextTime),
    );
  };

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget && !saving) {
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-dialog calendar-activity-editor-modal">
        <div className="modal-header calendar-activity-editor-header">
          <div>
            <h3 className="modal-title">Actualizar registro</h3>
            <div className="calendar-module-chips-row calendar-activity-editor-chips-row">
              <span className="calendar-activity-editor-status-pill">
                Estado actual: {currentStatusLabel}
              </span>
              <span
                className={`calendar-module-source-badge ${sourceBadgeClass}`}
                aria-label={`Origen: ${sourceLabel}`}
                title={`Origen: ${sourceLabel}`}
              >
                Origen: {sourceLabel}
              </span>
              <span
                className="calendar-module-type-badge"
                aria-label={`Tipo: ${typeLabel}`}
                title={`Tipo: ${typeLabel}`}
              >
                Tipo: {typeLabel}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="calendar-activity-editor-close"
            onClick={onClose}
            disabled={saving}
            aria-label="Cerrar"
            title="Cerrar"
          >
            x
          </button>
        </div>

        {loading ? (
          <div className="calendar-activity-editor-loading">
            Cargando actividad...
          </div>
        ) : (
          <form className="calendar-activity-editor-form" onSubmit={onSave}>
            {error ? <p className="form-error">{error}</p> : null}

            {!canUpdateActivities ? (
              <p className="calendar-activity-editor-readonly-note">
                Tienes acceso de solo lectura: puedes consultar, pero no editar.
              </p>
            ) : null}

            {readOnly && canUpdateActivities ? (
              <p className="calendar-activity-editor-readonly-note">
                Esta actividad se muestra para consulta por su estado actual.
              </p>
            ) : null}

            <div className="calendar-activity-editor-grid">
              <label className="calendar-activity-editor-full-width">
                Objetivo
                <textarea
                  rows="3"
                  value={draft.objective}
                  disabled={readOnly || saving}
                  onChange={(event) =>
                    onChange("objective", event.target.value)
                  }
                  placeholder="Define el objetivo de la actividad"
                />
              </label>

              <label className="calendar-activity-editor-full-width">
                Nota
                <textarea
                  rows="3"
                  value={draft.note}
                  disabled={readOnly || saving}
                  onChange={(event) => onChange("note", event.target.value)}
                  placeholder="Agrega contexto o seguimiento"
                />
              </label>

              <div className="calendar-activity-editor-full-width calendar-activity-editor-agenda-block">
                <strong>Agenda</strong>
                <div className="calendar-activity-editor-agenda-grid">
                  <label>
                    Fecha
                    <input
                      type="date"
                      value={scheduledDate}
                      disabled={readOnly || saving}
                      onChange={(event) => applyAgendaDate(event.target.value)}
                    />
                  </label>
                  <label>
                    Hora
                    <input
                      type="time"
                      value={scheduledTime}
                      disabled={readOnly || saving}
                      onChange={(event) => applyAgendaTime(event.target.value)}
                    />
                  </label>
                </div>
                <div className="calendar-activity-editor-quick-chips">
                  <button
                    type="button"
                    className="calendar-activity-editor-chip"
                    disabled={readOnly || saving}
                    onClick={() => applyAgendaDate(toDateInputValue())}
                  >
                    Hoy
                  </button>
                  <button
                    type="button"
                    className="calendar-activity-editor-chip"
                    disabled={readOnly || saving}
                    onClick={() =>
                      applyAgendaDate(
                        shiftDateInputValue(toDateInputValue(), 1),
                      )
                    }
                  >
                    Manana
                  </button>
                  <button
                    type="button"
                    className="calendar-activity-editor-chip"
                    disabled={readOnly || saving}
                    onClick={() => applyAgendaTime("09:00")}
                  >
                    09:00
                  </button>
                  <button
                    type="button"
                    className="calendar-activity-editor-chip"
                    disabled={readOnly || saving}
                    onClick={() => applyAgendaTime("12:00")}
                  >
                    12:00
                  </button>
                  <button
                    type="button"
                    className="calendar-activity-editor-chip"
                    disabled={readOnly || saving}
                    onClick={() => applyAgendaTime("16:00")}
                  >
                    16:00
                  </button>
                </div>
              </div>

              <label className="calendar-activity-editor-full-width">
                Resultado
                <textarea
                  rows="3"
                  value={draft.successCriteria}
                  disabled={readOnly || saving}
                  onChange={(event) =>
                    onChange("successCriteria", event.target.value)
                  }
                  placeholder="Describe el resultado de la gestion"
                />
              </label>
            </div>

            {!readOnly ? (
              <div className="calendar-activity-editor-actions-block">
                {notice ? (
                  <p className="calendar-activity-editor-notice">{notice}</p>
                ) : null}
                <div className="calendar-activity-editor-icon-actions">
                  <button
                    type="button"
                    className="calendar-activity-editor-icon-button is-done"
                    onClick={onMarkDone}
                    disabled={saving}
                    aria-label="Marcar realizada"
                    title="Marcar realizada"
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    className="calendar-activity-editor-icon-button is-cancel"
                    onClick={onCancelActivity}
                    disabled={saving}
                    aria-label="Cancelar actividad"
                    title="Cancelar actividad"
                  >
                    ×
                  </button>
                  <button
                    type="submit"
                    className="calendar-activity-editor-icon-button is-save"
                    disabled={saving}
                    aria-label="Guardar cambios"
                    title="Guardar cambios"
                  >
                    {saving ? (
                      "..."
                    ) : (
                      <svg
                        className="calendar-activity-editor-save-icon"
                        viewBox="0 0 24 24"
                        focusable="false"
                        aria-hidden="true"
                      >
                        <path
                          d="M5 3h11l3 3v15H5z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                        />
                        <path
                          d="M8 3h8v5H8z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                        />
                        <path
                          d="M8 14h8v5H8z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                        />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="modal-buttons">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onClose}
                  disabled={saving}
                >
                  Cerrar
                </button>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

function CalendarDayActivitiesModal({
  isOpen,
  date,
  items,
  showReadOnlyBadge,
  onClose,
  onOpenActivity,
}) {
  if (!isOpen) return null;
  const orderedItems = sortCalendarItemsBySchedule(items || []);

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-dialog calendar-module-day-activities-modal">
        <div className="modal-header calendar-module-day-activities-header">
          <div>
            <h3 className="modal-title">Actividades del dia</h3>
            <span className="calendar-module-day-activities-date">
              {formatDate(date)} · {items.length} actividad
              {items.length === 1 ? "" : "es"}
            </span>
          </div>
          <button
            type="button"
            className="calendar-activity-editor-close"
            onClick={onClose}
            aria-label="Cerrar actividades del dia"
            title="Cerrar"
          >
            ×
          </button>
        </div>

        <div className="calendar-module-day-activities-body">
          {orderedItems.length ? (
            <ul className="calendar-module-day-group-list">
              {orderedItems.map((item) => (
                <li
                  key={`calendar-day-modal-${item.calendarSource || "unknown"}-${item.id}-${item.scheduledAt || "no-date"}`}
                  className={`calendar-module-day-item ${getCalendarActivityCardClass(item)}`.trim()}
                >
                  <button
                    type="button"
                    className="calendar-module-activity-trigger"
                    onClick={() => onOpenActivity(item)}
                  >
                    <span className="calendar-module-time-chip">
                      {formatTime(item.scheduledAt)}
                    </span>
                    <div className="calendar-module-day-item-content">
                      <div className="calendar-module-chips-row">
                        {showReadOnlyBadge ? (
                          <span className="calendar-module-readonly-badge">
                            Solo lectura
                          </span>
                        ) : null}
                        <span
                          className={`calendar-module-source-badge ${getCalendarSourceBadgeClass(item.calendarSource)}`}
                          aria-label={`Origen: ${getCalendarSourceLabel(item.calendarSource)}`}
                          title={`Origen: ${getCalendarSourceLabel(item.calendarSource)}`}
                        >
                          {getCalendarSourceLabel(item.calendarSource)}
                        </span>
                        {normalizeCalendarSource(item.calendarSource) !==
                        "interaction" ? (
                          <span
                            className="calendar-module-type-badge"
                            aria-label={`Tipo: ${activityTypeLabel(item.activityType)}`}
                            title={`Tipo: ${activityTypeLabel(item.activityType)}`}
                          >
                            {activityTypeLabel(item.activityType)}
                          </span>
                        ) : null}
                        <span
                          className={`calendar-module-status-badge ${getCalendarActivityStatusBadgeClass(item.status)}`}
                          aria-label={`Estado: ${activityStatusLabel(item.status)}`}
                          title={`Estado: ${activityStatusLabel(item.status)}`}
                        >
                          {activityStatusLabel(item.status)}
                        </span>
                        {normalizeCalendarSource(item.calendarSource) ===
                        "interaction" ? (
                          <span
                            className="calendar-module-lead-situation-badge"
                            aria-label={`Situación: ${getLeadSituationLabel(item)}`}
                            title={`Situación: ${getLeadSituationLabel(item)}`}
                          >
                            Situación: {getLeadSituationLabel(item)}
                          </span>
                        ) : null}
                      </div>
                      <strong>{formatActivityTitle(item)}</strong>
                      <small>
                        Cuenta:{" "}
                        {String(item.accountName || "Sin cuenta asignada")}
                      </small>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="calendar-module-day-group-empty">
              Sin actividades para este dia.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CalendarPage({ currentUser }) {
  const permissionSet = useMemo(
    () => new Set(currentUser?.permissions || []),
    [currentUser],
  );
  const canReadAll = permissionSet.has("calendario_comercial.read_all");
  const canUpdateActivities =
    permissionSet.has("desarrollo_comercial.update") &&
    permissionSet.has("oportunidades.update");

  const [calendarView, setCalendarView] = useState("week");
  const [calendarDate, setCalendarDate] = useState(toDateInputValue());
  const [selectedSellerId, setSelectedSellerId] = useState(
    canReadAll ? "all" : "",
  );
  const [slaDays, setSlaDays] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [activityModalOpen, setActivityModalOpen] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activitySaving, setActivitySaving] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [activityNotice, setActivityNotice] = useState("");
  const [activityDraft, setActivityDraft] = useState(
    normalizeCalendarActivityDraft(null),
  );
  const activityModalCloseTimerRef = useRef(null);
  const [leadOutcomeModalOpen, setLeadOutcomeModalOpen] = useState(false);
  const [leadOutcomeSaving, setLeadOutcomeSaving] = useState(false);
  const [leadOutcomeDetail, setLeadOutcomeDetail] = useState(null);
  const [leadOutcomeCatalogs, setLeadOutcomeCatalogs] = useState(
    EMPTY_LEAD_OUTCOME_CATALOGS,
  );
  const [dayActivitiesModalOpen, setDayActivitiesModalOpen] = useState(false);
  const [dayActivitiesDate, setDayActivitiesDate] = useState("");
  const [dayActivitiesItems, setDayActivitiesItems] = useState([]);

  const loadCalendarModule = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = {
        view: calendarView,
        date: calendarDate,
        includeCompleted: true,
        slaDays,
      };
      if (selectedSellerId && selectedSellerId !== "all") {
        params.sellerUserId = Number(selectedSellerId);
      }

      const response = await api.get("/api/commercial-development/calendar", {
        params,
      });
      const nextData = response.data || null;
      setData(nextData);

      const nextSellerId = String(nextData?.selectedSellerUserId || "");
      if (!canReadAll && !selectedSellerId && nextSellerId) {
        setSelectedSellerId(nextSellerId);
      }

      const resolvedSla = Number(nextData?.slaConfig?.days || 0);
      if (resolvedSla > 0 && resolvedSla !== slaDays) {
        setSlaDays(resolvedSla);
      }
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar el modulo calendario.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [calendarDate, calendarView, canReadAll, selectedSellerId, slaDays]);

  useEffect(() => {
    loadCalendarModule();
  }, [loadCalendarModule]);

  const sellers = data?.sellers || [];
  const days = data?.days || [];
  const weekdays = days.filter((day) => isWeekdayDate(day.date));
  const alerts = data?.alerts || {};
  const myDay = data?.myDay || [];
  const indicators = data?.indicators || {};
  const totalActivities = weekdays.reduce(
    (sum, day) => sum + getDayActivityCount(day),
    0,
  );
  const activeDays = weekdays.filter(
    (day) => getDayActivityCount(day) > 0,
  ).length;
  const activityReadOnly =
    !canUpdateActivities || Boolean(activityDraft?.readonlyByStatus);
  const showReadOnlyBadge = !canUpdateActivities;

  const clearActivityModalCloseTimer = useCallback(() => {
    if (activityModalCloseTimerRef.current) {
      window.clearTimeout(activityModalCloseTimerRef.current);
      activityModalCloseTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearActivityModalCloseTimer();
    };
  }, [clearActivityModalCloseTimer]);

  const closeActivityModal = () => {
    if (activitySaving) return;
    clearActivityModalCloseTimer();
    setActivityModalOpen(false);
    setActivityLoading(false);
    setActivityError("");
    setActivityNotice("");
    setActivityDraft(normalizeCalendarActivityDraft(null));
  };

  const closeLeadOutcomeModal = () => {
    if (leadOutcomeSaving) return;
    setLeadOutcomeModalOpen(false);
    setLeadOutcomeDetail(null);
    setLeadOutcomeCatalogs(EMPTY_LEAD_OUTCOME_CATALOGS);
  };

  const openDayActivitiesModal = (day) => {
    const items = Array.isArray(day?.items) ? day.items : [];
    if (!items.length) return;
    setDayActivitiesDate(String(day?.date || ""));
    setDayActivitiesItems(items);
    setDayActivitiesModalOpen(true);
  };

  const closeDayActivitiesModal = () => {
    setDayActivitiesModalOpen(false);
    setDayActivitiesDate("");
    setDayActivitiesItems([]);
  };

  const openActivityModal = async (item) => {
    const opportunityId = Number(item?.opportunityId || 0);
    const activityId = Number(item?.id || 0);
    const interactionId = Number(item?.interactionId || item?.id || 0);
    const calendarSource =
      String(item?.calendarSource || "opportunity").trim() || "opportunity";
    if (!activityId) return;

    if (calendarSource !== "opportunity") {
      if (!interactionId) return;
      setError("");
      try {
        const detailResponse = await api.get(
          `/api/interactions/${interactionId}`,
        );
        const detailData = detailResponse.data || null;
        const catalogsResponse = await api.get(
          "/api/interactions/call-outcome-catalogs",
          {
            params: { status: detailData?.analysisStatus || undefined },
          },
        );
        setLeadOutcomeDetail(detailData);
        setLeadOutcomeCatalogs(
          catalogsResponse.data || EMPTY_LEAD_OUTCOME_CATALOGS,
        );
        setLeadOutcomeModalOpen(true);
      } catch (requestError) {
        setError(
          getApiErrorMessage(
            requestError,
            "No fue posible abrir la situación del lead.",
          ),
        );
      }
      return;
    }

    clearActivityModalCloseTimer();
    setActivityModalOpen(true);
    setActivityError("");
    setActivityNotice("");
    setActivityDraft(
      normalizeCalendarActivityDraft({
        ...item,
        opportunityId,
        id: activityId,
        objective: item?.title || "",
      }),
    );

    if (!opportunityId) {
      setActivityLoading(false);
      setActivityError(
        "No fue posible identificar la oportunidad de esta actividad.",
      );
      return;
    }

    setActivityLoading(true);

    try {
      const response = await api.get(
        `/api/commercial-development/opportunities/${opportunityId}/activities/${activityId}`,
      );
      setActivityDraft(normalizeCalendarActivityDraft(response.data));
    } catch (requestError) {
      setActivityError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar el detalle de la actividad.",
        ),
      );
    } finally {
      setActivityLoading(false);
    }
  };

  const handleOpenActivityFromDayModal = async (item) => {
    closeDayActivitiesModal();
    await openActivityModal(item);
  };

  const handleActivityFieldChange = (field, value) => {
    clearActivityModalCloseTimer();
    setActivityDraft((current) => ({
      ...current,
      [field]: value,
    }));
    setActivityError("");
    setActivityNotice("");
  };

  const handleSaveActivity = async (event) => {
    event.preventDefault();
    if (activityReadOnly || activityLoading || activitySaving) return;

    const opportunityId = Number(activityDraft?.opportunityId || 0);
    const activityId = Number(activityDraft?.id || 0);
    if (!opportunityId || !activityId) {
      setActivityError("No se encontro la actividad a actualizar.");
      return;
    }
    if (!activityDraft?.scheduledAt || !activityDraft?.objective?.trim()) {
      setActivityError("Completa fecha/hora y objetivo para guardar.");
      return;
    }

    await updateCalendarActivity(
      {
        entryKind: "activity",
        activityType: activityDraft.activityType,
        scheduledAt: activityDraft.scheduledAt,
        status: activityDraft.status,
        objective: activityDraft.objective.trim(),
        note: activityDraft.note.trim(),
        successCriteria: activityDraft.successCriteria.trim(),
        isPrimaryNextStep: Boolean(activityDraft.isPrimaryNextStep),
      },
      "Actividad actualizada.",
      "No fue posible actualizar la actividad.",
      {
        autoCloseOnSuccess: true,
        closeDelayMs: 2000,
      },
    );
  };

  const updateCalendarActivity = async (
    payload,
    successMessage,
    fallbackErrorMessage,
    options = {},
  ) => {
    const opportunityId = Number(activityDraft?.opportunityId || 0);
    const activityId = Number(activityDraft?.id || 0);
    if (!opportunityId || !activityId) {
      setActivityError("No se encontro la actividad a actualizar.");
      return false;
    }

    setActivitySaving(true);
    setActivityError("");
    setActivityNotice("");
    try {
      await api.patch(
        `/api/commercial-development/opportunities/${opportunityId}/activities/${activityId}`,
        payload,
      );
      await loadCalendarModule();
      setActivityDraft((current) => ({
        ...current,
        status: payload.status || current.status,
        successCriteria:
          payload.successCriteria === undefined
            ? current.successCriteria
            : String(payload.successCriteria || ""),
        isPrimaryNextStep:
          payload.isPrimaryNextStep === undefined
            ? current.isPrimaryNextStep
            : Boolean(payload.isPrimaryNextStep),
        readonlyByStatus: ["done", "cancelled"].includes(
          payload.status || current.status,
        ),
      }));
      setActivityNotice(successMessage);
      if (options.autoCloseOnSuccess) {
        clearActivityModalCloseTimer();
        const closeDelayMs = Number(options.closeDelayMs || 2000);
        activityModalCloseTimerRef.current = window.setTimeout(() => {
          closeActivityModal();
        }, closeDelayMs);
      }
      return true;
    } catch (requestError) {
      setActivityError(getApiErrorMessage(requestError, fallbackErrorMessage));
      return false;
    } finally {
      setActivitySaving(false);
    }
  };

  const handleMarkActivityDone = async () => {
    if (activityReadOnly || activityLoading || activitySaving) return;
    if (!activityDraft?.scheduledAt || !activityDraft?.objective?.trim()) {
      setActivityError(
        "Completa fecha/hora y objetivo antes de marcar como realizada.",
      );
      return;
    }

    const resultText = String(activityDraft?.successCriteria || "").trim();
    const doneConfirmationMessage = resultText
      ? `Se marcara la actividad como realizada.\n\nResultado registrado:\n${resultText}\n\n¿Deseas continuar?`
      : "No has indicado un resultado en el campo Resultado.\n\nTe recomendamos ingresarlo antes de marcar la actividad como realizada.\n\n¿Deseas continuar de todos modos?";

    if (
      typeof window !== "undefined" &&
      !window.confirm(doneConfirmationMessage)
    ) {
      return;
    }

    await updateCalendarActivity(
      {
        entryKind: "activity",
        activityType: activityDraft.activityType,
        scheduledAt: activityDraft.scheduledAt,
        status: "done",
        objective: activityDraft.objective.trim(),
        note: activityDraft.note.trim(),
        successCriteria: activityDraft.successCriteria.trim(),
        isPrimaryNextStep: false,
      },
      "Actividad marcada como realizada.",
      "No fue posible marcar la actividad como realizada.",
      {
        autoCloseOnSuccess: true,
        closeDelayMs: 2000,
      },
    );
  };

  const handleCancelActivity = async () => {
    if (activityReadOnly || activityLoading || activitySaving) return;
    if (!activityDraft?.scheduledAt || !activityDraft?.objective?.trim()) {
      setActivityError(
        "Completa fecha/hora y objetivo antes de cancelar la actividad.",
      );
      return;
    }

    const cancelConfirmationMessage =
      "¿Confirmas que deseas cancelar esta actividad?";
    if (
      typeof window !== "undefined" &&
      !window.confirm(cancelConfirmationMessage)
    ) {
      return;
    }

    await updateCalendarActivity(
      {
        entryKind: "activity",
        activityType: activityDraft.activityType,
        scheduledAt: activityDraft.scheduledAt,
        status: "cancelled",
        objective: activityDraft.objective.trim(),
        note: activityDraft.note.trim(),
        successCriteria: activityDraft.successCriteria.trim(),
        isPrimaryNextStep: false,
      },
      "Actividad cancelada.",
      "No fue posible cancelar la actividad.",
      {
        autoCloseOnSuccess: true,
        closeDelayMs: 2000,
      },
    );
  };

  const handleSaveLeadOutcome = async (form) => {
    if (!leadOutcomeDetail?.id) return;

    setLeadOutcomeSaving(true);
    setError("");
    try {
      const { data } = await api.post(
        `/api/interactions/${leadOutcomeDetail.id}/call-outcome`,
        form,
      );
      setLeadOutcomeDetail(data || null);
      const catalogsResponse = await api.get(
        "/api/interactions/call-outcome-catalogs",
        {
          params: { status: data?.analysisStatus || undefined },
        },
      );
      setLeadOutcomeCatalogs(
        catalogsResponse.data || EMPTY_LEAD_OUTCOME_CATALOGS,
      );
      setLeadOutcomeModalOpen(false);
      setLeadOutcomeDetail(null);
      setLeadOutcomeCatalogs(EMPTY_LEAD_OUTCOME_CATALOGS);
      await loadCalendarModule();
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible guardar la situación del lead.",
        ),
      );
    } finally {
      setLeadOutcomeSaving(false);
    }
  };

  return (
    <div className="calendar-module-page">
      <header className="calendar-module-header">
        <div>
          <h2>Calendario</h2>
          <p>
            Agenda comercial, alertas del dia y control de riesgos operativos.
          </p>
        </div>
        <div className="calendar-module-filters">
          <label>
            Vista
            <select
              value={calendarView}
              onChange={(event) => setCalendarView(event.target.value)}
            >
              {VIEW_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fecha
            <input
              type="date"
              value={calendarDate}
              onChange={(event) => setCalendarDate(event.target.value)}
            />
          </label>
          {canReadAll ? (
            <label>
              Vendedor
              <select
                value={selectedSellerId}
                onChange={(event) => setSelectedSellerId(event.target.value)}
              >
                <option value="all">Todos</option>
                {sellers.map((seller) => (
                  <option key={seller.id} value={seller.id}>
                    {seller.fullName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            <span title="SLA es el maximo de dias sin actividad antes de marcar una oportunidad en riesgo.">
              SLA (dias)
            </span>
            <input
              type="number"
              min={Number(data?.slaConfig?.minDays || 1)}
              max={Number(data?.slaConfig?.maxDays || 30)}
              value={slaDays}
              onChange={(event) => setSlaDays(Number(event.target.value || 1))}
            />
          </label>
          <button
            type="button"
            className="btn-primary"
            onClick={loadCalendarModule}
            disabled={loading}
          >
            {loading ? "Actualizando..." : "Actualizar"}
          </button>
        </div>
      </header>

      {error ? <p className="form-error">{error}</p> : null}

      <section className="calendar-module-section">
        <div className="calendar-module-section-header calendar-module-activities-header">
          <div className="calendar-module-activities-title">
            <h3>Actividades en calendario</h3>
            <p>
              Vista laboral (lunes a viernes), en lista continua por horario.
            </p>
          </div>
          <div className="calendar-module-activities-meta">
            <span className="calendar-module-badge">
              Total: {totalActivities}
            </span>
            <span className="calendar-module-badge">
              Dias activos: {activeDays}
            </span>
            <span>
              Zona horaria oficial:{" "}
              {data?.businessTimezone || "America/Mexico_City"}
            </span>
          </div>
        </div>
        <div className="calendar-module-grid calendar-module-activities-grid">
          {weekdays.map((day) => {
            const items = day.items || [];
            const dayCount = getDayActivityCount(day);
            const orderedItems = sortCalendarItemsBySchedule(items);
            const visibleItems = orderedItems.slice(0, 6);
            const visibleItemsCount = visibleItems.length;
            const remainingItems = Math.max(
              items.length - visibleItemsCount,
              0,
            );

            return (
              <article key={day.date} className="calendar-module-day-card">
                <header className="calendar-module-day-card-header">
                  <div>
                    <strong>{formatDate(day.date)}</strong>
                    <small>
                      {dayCount > 0
                        ? `${dayCount} ${dayCount === 1 ? "actividad" : "actividades"}`
                        : "Sin actividades"}
                    </small>
                  </div>
                  <span
                    className={`calendar-module-day-load ${
                      dayCount >= 3
                        ? "is-high"
                        : dayCount >= 1
                          ? "is-medium"
                          : "is-empty"
                    }`}
                  >
                    {dayCount >= 3
                      ? "Alta carga"
                      : dayCount >= 1
                        ? "Carga media"
                        : "Libre"}
                  </span>
                </header>

                {dayCount > 0 ? (
                  <div className="calendar-module-day-groups">
                    <ul className="calendar-module-day-group-list">
                      {visibleItems.map((item) => (
                        <li
                          key={`${item.calendarSource || "unknown"}-${item.id}-${item.scheduledAt || "no-date"}`}
                          className={`calendar-module-day-item ${getCalendarActivityCardClass(item)}`.trim()}
                        >
                          <button
                            type="button"
                            className="calendar-module-activity-trigger"
                            onClick={() => openActivityModal(item)}
                          >
                            <span className="calendar-module-time-chip">
                              {formatTime(item.scheduledAt)}
                            </span>
                            <div className="calendar-module-day-item-content">
                              <div className="calendar-module-chips-row">
                                {showReadOnlyBadge ? (
                                  <span className="calendar-module-readonly-badge">
                                    Solo lectura
                                  </span>
                                ) : null}
                                <span
                                  className={`calendar-module-source-badge ${getCalendarSourceBadgeClass(item.calendarSource)}`}
                                  aria-label={`Origen: ${getCalendarSourceLabel(item.calendarSource)}`}
                                  title={`Origen: ${getCalendarSourceLabel(item.calendarSource)}`}
                                >
                                  {getCalendarSourceLabel(item.calendarSource)}
                                </span>
                                {normalizeCalendarSource(
                                  item.calendarSource,
                                ) !== "interaction" ? (
                                  <span
                                    className="calendar-module-type-badge"
                                    aria-label={`Tipo: ${activityTypeLabel(item.activityType)}`}
                                    title={`Tipo: ${activityTypeLabel(item.activityType)}`}
                                  >
                                    {activityTypeLabel(item.activityType)}
                                  </span>
                                ) : null}
                                {normalizeCalendarSource(
                                  item.calendarSource,
                                ) === "interaction" ? (
                                  <span
                                    className="calendar-module-lead-situation-badge"
                                    aria-label={`Situación: ${getLeadSituationLabel(item)}`}
                                    title={`Situación: ${getLeadSituationLabel(item)}`}
                                  >
                                    Situación: {getLeadSituationLabel(item)}
                                  </span>
                                ) : null}
                              </div>
                              <strong>{formatActivityTitle(item)}</strong>
                              <small>{formatActivityContext(item)}</small>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="calendar-module-day-empty">
                    No hay actividades programadas para este dia.
                  </p>
                )}

                {remainingItems > 0 ? (
                  <button
                    type="button"
                    className="calendar-module-day-more-button"
                    onClick={() => openDayActivitiesModal(day)}
                  >
                    +{remainingItems} actividades adicionales
                  </button>
                ) : null}
              </article>
            );
          })}
          {!weekdays.length ? (
            <p className="calendar-module-day-empty calendar-module-weekday-empty">
              No hay dias laborales para mostrar con este filtro.
            </p>
          ) : null}
        </div>
      </section>

      <section className="calendar-module-section">
        <div className="calendar-module-section-header">
          <h3>Alertas del dia</h3>
          <span>
            Total: {Number(alerts?.counters?.total || 0)} · Vencidas:{" "}
            {Number(alerts?.counters?.overdue || 0)}
          </span>
        </div>
        <div className="calendar-module-alerts-layout">
          <article className="calendar-module-panel">
            <h4>Bandeja de alertas priorizadas por riesgo</h4>
            <ul className="calendar-module-alert-list">
              {(alerts?.prioritized || []).slice(0, 20).map((item) => (
                <li
                  key={`alert-${item.calendarSource || "unknown"}-${item.id}-${item.scheduledAt || "no-date"}`}
                >
                  <button
                    type="button"
                    className="calendar-module-alert-trigger"
                    onClick={() => openActivityModal(item)}
                  >
                    <div>
                      {showReadOnlyBadge ? (
                        <span className="calendar-module-readonly-badge">
                          Solo lectura
                        </span>
                      ) : null}
                      <strong>{formatActivityTitle(item, "Actividad")}</strong>
                      <p>
                        {formatActivityContext(item)} ·{" "}
                        {formatCalendarSchedule(item)}
                      </p>
                    </div>
                    <div className="calendar-module-alert-meta">
                      <span
                        className={`calendar-traffic is-${item.trafficLight}`}
                      >
                        {trafficLabel(item.trafficLight)}
                      </span>
                      <span>Riesgo {item.riskScore}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </article>

          <article className="calendar-module-panel">
            <h4>Vista Mi dia</h4>
            <ul className="calendar-module-plain-list">
              {myDay.length ? (
                myDay.map((item) => (
                  <li
                    key={`my-day-${item.calendarSource || "unknown"}-${item.id}-${item.scheduledAt || "no-date"}`}
                  >
                    <button
                      type="button"
                      className="calendar-module-myday-trigger"
                      onClick={() => openActivityModal(item)}
                    >
                      {showReadOnlyBadge ? (
                        <span className="calendar-module-readonly-badge">
                          Solo lectura
                        </span>
                      ) : null}
                      <span>{formatCalendarSchedule(item)}</span>
                      <strong>{formatActivityTitle(item, "Actividad")}</strong>
                      <small>{formatActivityContext(item)}</small>
                    </button>
                  </li>
                ))
              ) : (
                <li>Sin actividades para hoy.</li>
              )}
            </ul>

            <h4>Semaforo por actividad</h4>
            <div className="calendar-module-traffic-summary">
              <span className="calendar-traffic is-red">
                Rojo {Number(indicators?.byTrafficLight?.red || 0)}
              </span>
              <span className="calendar-traffic is-amber">
                Ambar {Number(indicators?.byTrafficLight?.amber || 0)}
              </span>
              <span className="calendar-traffic is-green">
                Verde {Number(indicators?.byTrafficLight?.green || 0)}
              </span>
            </div>
          </article>

          <article className="calendar-module-panel">
            <h4>Alertas inteligentes por silencio</h4>
            <ul className="calendar-module-plain-list">
              {(alerts?.silence || []).slice(0, 10).map((item) => (
                <li key={`silence-${item.id}`}>
                  <strong>{item.opportunityName}</strong>
                  <small>{item.daysWithoutActivity} dias sin actividad</small>
                </li>
              ))}
              {!alerts?.silence?.length ? (
                <li>Sin alertas de silencio.</li>
              ) : null}
            </ul>

            <h4>Alertas por dependencias relacionadas</h4>
            <ul className="calendar-module-plain-list">
              {(alerts?.dependencyLinked || []).slice(0, 10).map((item) => (
                <li key={`dependency-${item.id}`}>
                  <strong>{formatActivityTitle(item, "Actividad")}</strong>
                  <small>{item.opportunityName} · dependencia vencida</small>
                </li>
              ))}
              {!alerts?.dependencyLinked?.length ? (
                <li>Sin alertas de dependencias vencidas.</li>
              ) : null}
            </ul>
          </article>
        </div>
      </section>

      <section className="calendar-module-section">
        <div className="calendar-module-section-header">
          <h3>Indicadores para gestion</h3>
        </div>
        <div className="calendar-module-kpi-grid">
          <article>
            <span>Pendientes</span>
            <strong>{Number(alerts?.counters?.total || 0)}</strong>
          </article>
          <article>
            <span>Vencidas</span>
            <strong>{Number(alerts?.counters?.overdue || 0)}</strong>
          </article>
          <article>
            <span>Hoy</span>
            <strong>{Number(alerts?.counters?.today || 0)}</strong>
          </article>
          <article>
            <span>Bloqueadas</span>
            <strong>{Number(alerts?.counters?.blocked || 0)}</strong>
          </article>
          <article>
            <span>Riesgo alto</span>
            <strong>{Number(alerts?.counters?.highRisk || 0)}</strong>
          </article>
        </div>

        {canReadAll ? (
          <div className="calendar-module-seller-indicators">
            <h4>Indicadores por vendedor</h4>
            <ul className="calendar-module-plain-list">
              {(indicators?.bySeller || []).map((item) => (
                <li key={`seller-indicator-${item.sellerUserId}`}>
                  <strong>{item.sellerUserName}</strong>
                  <small>
                    Total {item.total} · Vencidas {item.overdue} · Riesgo alto{" "}
                    {item.highRisk}
                  </small>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <CalendarActivityEditorModal
        isOpen={activityModalOpen}
        loading={activityLoading}
        saving={activitySaving}
        error={activityError}
        notice={activityNotice}
        draft={activityDraft}
        readOnly={activityReadOnly}
        canUpdateActivities={canUpdateActivities}
        onClose={closeActivityModal}
        onChange={handleActivityFieldChange}
        onSave={handleSaveActivity}
        onMarkDone={handleMarkActivityDone}
        onCancelActivity={handleCancelActivity}
      />

      <CalendarDayActivitiesModal
        isOpen={dayActivitiesModalOpen}
        date={dayActivitiesDate}
        items={dayActivitiesItems}
        showReadOnlyBadge={showReadOnlyBadge}
        onClose={closeDayActivitiesModal}
        onOpenActivity={handleOpenActivityFromDayModal}
      />

      <LeadCallOutcomeModal
        key={`${leadOutcomeDetail?.id || "lead"}-${leadOutcomeModalOpen ? "open" : "closed"}`}
        isOpen={leadOutcomeModalOpen}
        detail={leadOutcomeDetail}
        catalogs={leadOutcomeCatalogs}
        onClose={closeLeadOutcomeModal}
        onSubmit={handleSaveLeadOutcome}
        saving={leadOutcomeSaving}
      />
    </div>
  );
}
