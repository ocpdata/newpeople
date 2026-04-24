import AuditFiltersSection from "./audit/AuditFiltersSection";
import AuditResultsSection from "./audit/AuditResultsSection";
import { useSystemAuditPage } from "./audit/useSystemAuditPage";

export default function SystemAuditPage() {
  const {
    items,
    error,
    loading,
    total,
    totalPages,
    filters,
    startItem,
    endItem,
    activeAuditFilterCount,
    auditModuleOptions,
    auditActionOptions,
    auditEntityOptions,
    auditStatusOptions,
    updateFilter,
    changePage,
    changePageSize,
  } = useSystemAuditPage();

  return (
    <section className="panel">
      <AuditFiltersSection
        total={total}
        activeAuditFilterCount={activeAuditFilterCount}
        filters={filters}
        auditModuleOptions={auditModuleOptions}
        auditActionOptions={auditActionOptions}
        auditEntityOptions={auditEntityOptions}
        auditStatusOptions={auditStatusOptions}
        updateFilter={updateFilter}
      />

      {error && <div className="toast toast-error">{error}</div>}

      <AuditResultsSection
        items={items}
        loading={loading}
        filters={filters}
        totalPages={totalPages}
        startItem={startItem}
        endItem={endItem}
        total={total}
        changePage={changePage}
        changePageSize={changePageSize}
      />
    </section>
  );
}