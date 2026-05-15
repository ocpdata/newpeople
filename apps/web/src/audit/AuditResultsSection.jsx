import {
  formatAuditDateTime,
  formatAuditModuleLabel,
  summarizeAuditChanges,
} from "./useSystemAuditPage";

export default function AuditResultsSection({
  items,
  loading,
  filters,
  totalPages,
  startItem,
  endItem,
  total,
  changePage,
  changePageSize,
}) {
  return (
    <>
      <table className="audit-table system-audit-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Modulo</th>
            <th>Accion</th>
            <th>Entidad</th>
            <th>Actor</th>
            <th>Estado</th>
            <th>Cambios</th>
            <th>Detalle</th>
          </tr>
        </thead>
        <tbody>
          {items.length > 0 ? (
            items.map((entry) => (
              <tr key={entry.id}>
                <td className="audit-date">{formatAuditDateTime(entry.created_at)}</td>
                <td>{formatAuditModuleLabel(entry.module)}</td>
                <td>{entry.action}</td>
                <td>
                  {entry.entity_type}
                  {entry.entity_name
                    ? `: ${entry.entity_name}`
                    : entry.entity_id
                      ? ` #${entry.entity_id}`
                      : ""}
                </td>
                <td>{entry.performed_by_name || entry.performed_by_email || "-"}</td>
                <td>
                  <span
                    className={
                      entry.status === "error"
                        ? "audit-action-badge audit-status-error"
                        : "audit-action-badge audit-status-success"
                    }
                  >
                    {entry.status === "error" ? "Error" : "Exito"}
                  </span>
                </td>
                <td className="audit-detail">{summarizeAuditChanges(entry)}</td>
                <td className="audit-detail">{entry.detail || "-"}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={8} className="empty-state">
                {loading ? "Cargando eventos..." : "No hay eventos para estos filtros"}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="users-pagination">
        <div className="users-pagination-left">
          <span className="users-pagination-info">
            {startItem}–{endItem} de {total}
          </span>
        </div>
        <div className="users-pagination-center">
          <button
            type="button"
            className="users-page-btn"
            disabled={filters.page <= 1 || loading}
            onClick={() => changePage(filters.page - 1)}
          >
            ‹
          </button>
          <span className="users-pagination-pages">
            {filters.page} / {Math.max(1, totalPages)}
          </span>
          <button
            type="button"
            className="users-page-btn"
            disabled={filters.page >= totalPages || loading}
            onClick={() => changePage(filters.page + 1)}
          >
            ›
          </button>
        </div>
        <div className="users-pagination-right">
          <span className="users-pagination-label">Por página:</span>
          {[10, 25, 50, 100].map((pageSize) => (
            <button
              key={pageSize}
              type="button"
              className={`users-perpage-btn${filters.pageSize === pageSize ? " is-active" : ""}`}
              onClick={() => changePageSize(pageSize)}
              disabled={loading}
            >
              {pageSize}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}