import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "./api";

const VIEW_OPTIONS = [
  { value: "day", label: "Dia" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mes" },
];

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

function toDateInputValue(value) {
  if (!value) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return "Sin fecha";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Sin fecha";
  return parsed.toLocaleString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatTime(value) {
  if (!value) return "Sin hora";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Sin hora";
  return parsed.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDateTimeInputValue(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
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
  const parsed = new Date(datePart);
  if (Number.isNaN(parsed.getTime())) return datePart;
  parsed.setDate(parsed.getDate() + daysToShift);
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function activityStatusLabel(statusValue) {
  return (
    CALENDAR_ACTIVITY_STATUS_OPTIONS.find((item) => item.value === statusValue)
      ?.label || "Programada"
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
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "tarde";
  return parsed.getHours() < MORNING_CUTOFF_HOUR ? "manana" : "tarde";
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

function trafficLabel(value) {
  if (value === "red") return "Rojo";
  if (value === "amber") return "Ambar";
  return "Verde";
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
            <span className="calendar-activity-editor-status-pill">
              Estado actual: {currentStatusLabel}
            </span>
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
            {notice ? (
              <p className="calendar-activity-editor-notice">{notice}</p>
            ) : null}

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
                  {saving ? "..." : "S"}
                </button>
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

  const loadCalendarModule = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = {
        view: calendarView,
        date: calendarDate,
        includeCompleted: false,
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

  const closeActivityModal = () => {
    if (activitySaving) return;
    setActivityModalOpen(false);
    setActivityLoading(false);
    setActivityError("");
    setActivityNotice("");
    setActivityDraft(normalizeCalendarActivityDraft(null));
  };

  const openActivityModal = async (item) => {
    const opportunityId = Number(item?.opportunityId || 0);
    const activityId = Number(item?.id || 0);
    if (!opportunityId || !activityId) return;

    setActivityModalOpen(true);
    setActivityLoading(true);
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

  const handleActivityFieldChange = (field, value) => {
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
    );
  };

  const updateCalendarActivity = async (
    payload,
    successMessage,
    fallbackErrorMessage,
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
    );
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
          <label>
            Vendedor
            <select
              value={selectedSellerId}
              onChange={(event) => setSelectedSellerId(event.target.value)}
              disabled={!canReadAll}
            >
              {canReadAll ? <option value="all">Todos</option> : null}
              {sellers.map((seller) => (
                <option key={seller.id} value={seller.id}>
                  {seller.fullName}
                </option>
              ))}
            </select>
          </label>
          <label>
            SLA (dias)
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
            <p>Vista laboral (lunes a viernes), agrupada en manana y tarde.</p>
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
            const groupedItems = groupItemsByDayPart(items);
            const visibleMorning = groupedItems.manana.slice(0, 3);
            const visibleAfternoon = groupedItems.tarde.slice(0, 3);
            const visibleItemsCount =
              visibleMorning.length + visibleAfternoon.length;
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
                    <section className="calendar-module-day-group">
                      <h5>Manana</h5>
                      {visibleMorning.length ? (
                        <ul className="calendar-module-day-group-list">
                          {visibleMorning.map((item) => (
                            <li
                              key={item.id}
                              className="calendar-module-day-item"
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
                                  {showReadOnlyBadge ? (
                                    <span className="calendar-module-readonly-badge">
                                      Solo lectura
                                    </span>
                                  ) : null}
                                  <strong>
                                    {item.title || "Sin objetivo"}
                                  </strong>
                                  <small>
                                    {item.opportunityName} · {item.accountName}
                                  </small>
                                </div>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="calendar-module-day-group-empty">
                          Sin actividades de manana.
                        </p>
                      )}
                    </section>

                    <section className="calendar-module-day-group">
                      <h5>Tarde</h5>
                      {visibleAfternoon.length ? (
                        <ul className="calendar-module-day-group-list">
                          {visibleAfternoon.map((item) => (
                            <li
                              key={`${item.id}-afternoon`}
                              className="calendar-module-day-item"
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
                                  {showReadOnlyBadge ? (
                                    <span className="calendar-module-readonly-badge">
                                      Solo lectura
                                    </span>
                                  ) : null}
                                  <strong>
                                    {item.title || "Sin objetivo"}
                                  </strong>
                                  <small>
                                    {item.opportunityName} · {item.accountName}
                                  </small>
                                </div>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="calendar-module-day-group-empty">
                          Sin actividades de tarde.
                        </p>
                      )}
                    </section>
                  </div>
                ) : (
                  <p className="calendar-module-day-empty">
                    No hay actividades programadas para este dia.
                  </p>
                )}

                {remainingItems > 0 ? (
                  <p className="calendar-module-day-more">
                    +{remainingItems} actividades adicionales
                  </p>
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
                <li key={item.id}>
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
                      <strong>{item.title || "Actividad"}</strong>
                      <p>
                        {item.opportunityName} ·{" "}
                        {formatDateTime(item.scheduledAt)}
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
                  <li key={`my-day-${item.id}`}>
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
                      <span>{formatDateTime(item.scheduledAt)}</span>
                      <strong>{item.title || "Actividad"}</strong>
                      <small>{item.opportunityName}</small>
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
                  <strong>{item.title || "Actividad"}</strong>
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
    </div>
  );
}
