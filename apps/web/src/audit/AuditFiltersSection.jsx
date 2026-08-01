import DatePicker from "react-datepicker";
import { es } from "date-fns/locale";
import { formatDateFilterValue, parseDateFilterValue } from "../appFilters";

export default function AuditFiltersSection({
  total,
  activeAuditFilterCount,
  filters,
  auditModuleOptions,
  auditActionOptions,
  auditEntityOptions,
  auditStatusOptions,
  auditAiUsageOptions,
  updateFilter,
}) {
  const fromDate = parseDateFilterValue(filters.from);
  const toDate = parseDateFilterValue(filters.to);

  return (
    <div className="audit-toolbar">
      <div className="users-header-row audit-header-row">
        <div className="roles-page-header-left">
          <div className="module-title-with-icon">
            <h2>Auditoria del sistema</h2>
            <span
              className="module-title-icon audit-module-title-icon"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M5.75 3h8.19a2.75 2.75 0 0 1 1.94.8l2.52 2.52a2.75 2.75 0 0 1 .8 1.95v10.98A2.75 2.75 0 0 1 16.45 22h-10.7A2.75 2.75 0 0 1 3 19.25V5.75A2.75 2.75 0 0 1 5.75 3m0 1.5c-.69 0-1.25.56-1.25 1.25v13.5c0 .69.56 1.25 1.25 1.25h10.7c.69 0 1.25-.56 1.25-1.25V8.5h-2.95A2.75 2.75 0 0 1 12 5.75V4.5zm7.75.31v.94c0 .69.56 1.25 1.25 1.25h.94zM7.5 10a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 7.5 10m0 3.5a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1-.75-.75m0 3.5a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 7.5 17" />
              </svg>
            </span>
          </div>
          <p className="roles-subtitle audit-subtitle">
            Explora eventos por actor, modulo, accion, entidad y rango de
            fechas.
          </p>
        </div>
        <div className="audit-toolbar-meta">
          <span className="audit-total-pill">{total} eventos</span>
          <span className="audit-filter-summary">
            {activeAuditFilterCount === 0
              ? "Sin filtros activos"
              : `${activeAuditFilterCount} filtros activos`}
          </span>
        </div>
      </div>

      <div className="audit-screen-filters">
        <label className="audit-filter-card audit-filter-search-card">
          <span className="audit-filter-label">Busqueda rápida</span>
          <span className="audit-filter-help">
            Actor, modulo, accion, entidad o detalle
          </span>
          <div className="audit-search-input-wrap">
            <span className="audit-search-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M10.5 4a6.5 6.5 0 1 1 0 13a6.5 6.5 0 0 1 0-13m0-1.5a8 8 0 1 0 4.94 14.29l4.13 4.12a.75.75 0 1 0 1.06-1.06l-4.12-4.13A8 8 0 0 0 10.5 2.5" />
              </svg>
            </span>
            <input
              type="text"
              placeholder="Ej. login_failed, Juan Perez o cuentas"
              value={filters.q}
              onChange={(event) => updateFilter("q", event.target.value)}
            />
          </div>
        </label>

        <div className="audit-filter-grid">
          <label className="audit-filter-card">
            <span className="audit-filter-label">Modulo</span>
            <select
              value={filters.module}
              onChange={(event) => updateFilter("module", event.target.value)}
            >
              {auditModuleOptions.map((option) => (
                <option
                  key={option.value || "all-modules"}
                  value={option.value}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="audit-filter-card">
            <span className="audit-filter-label">Accion</span>
            <select
              value={filters.action}
              onChange={(event) => updateFilter("action", event.target.value)}
            >
              {auditActionOptions.map((option) => (
                <option
                  key={option.value || "all-actions"}
                  value={option.value}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="audit-filter-card">
            <span className="audit-filter-label">Entidad</span>
            <select
              value={filters.entityType}
              onChange={(event) =>
                updateFilter("entityType", event.target.value)
              }
            >
              {auditEntityOptions.map((option) => (
                <option
                  key={option.value || "all-entities"}
                  value={option.value}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="audit-filter-card">
            <span className="audit-filter-label">Uso IA</span>
            <select
              value={filters.aiUsage}
              onChange={(event) => updateFilter("aiUsage", event.target.value)}
            >
              {auditAiUsageOptions.map((option) => (
                <option
                  key={option.value || "all-ai-usage"}
                  value={option.value}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="audit-filter-card audit-filter-status-card">
            <span className="audit-filter-label">Estado</span>
            <div
              className="audit-status-pills"
              role="group"
              aria-label="Filtrar auditoria por estado"
            >
              {auditStatusOptions.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className={`audit-status-pill audit-status-pill-${option.tone}${filters.status === option.value ? " is-selected" : ""}`}
                  aria-pressed={filters.status === option.value}
                  onClick={() => updateFilter("status", option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="audit-filter-card audit-filter-date-card">
            <span className="audit-filter-label">Periodo</span>
            <div className="audit-date-range-grid">
              <label className="audit-date-field">
                <span>Desde</span>
                <DatePicker
                  selected={fromDate}
                  onChange={(date) =>
                    updateFilter("from", formatDateFilterValue(date))
                  }
                  selectsStart
                  startDate={fromDate}
                  endDate={toDate}
                  maxDate={toDate || undefined}
                  placeholderText="Selecciona fecha"
                  dateFormat="dd/MM/yyyy"
                  locale={es}
                  showMonthDropdown
                  showYearDropdown
                  dropdownMode="select"
                  fixedHeight
                  todayButton="Hoy"
                  calendarClassName="audit-datepicker-calendar"
                  popperClassName="audit-datepicker-popper"
                  className="audit-date-input"
                  autoComplete="off"
                  isClearable={false}
                  showPopperArrow={false}
                />
              </label>
              <label className="audit-date-field">
                <span>Hasta</span>
                <DatePicker
                  selected={toDate}
                  onChange={(date) =>
                    updateFilter("to", formatDateFilterValue(date))
                  }
                  selectsEnd
                  startDate={fromDate}
                  endDate={toDate}
                  minDate={fromDate || undefined}
                  placeholderText="Selecciona fecha"
                  dateFormat="dd/MM/yyyy"
                  locale={es}
                  showMonthDropdown
                  showYearDropdown
                  dropdownMode="select"
                  fixedHeight
                  todayButton="Hoy"
                  calendarClassName="audit-datepicker-calendar"
                  popperClassName="audit-datepicker-popper"
                  className="audit-date-input"
                  autoComplete="off"
                  isClearable={false}
                  showPopperArrow={false}
                />
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
