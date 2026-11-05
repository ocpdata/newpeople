export const REPORT_PERMISSIONS = {
  opportunitiesQuotations: {
    own: "reportes.oportunidades_cotizaciones.read",
    all: "reportes.oportunidades_cotizaciones.read_all",
  },
  profitability: {
    own: "reportes.rentabilidad.read",
    all: "reportes.rentabilidad.read_all",
  },
  contribution: {
    own: "reportes.contribucion.read",
    all: "reportes.contribucion.read_all",
  },
};

export function getReportScope(can, report) {
  const permissions = REPORT_PERMISSIONS[report];
  if (can(permissions.all)) return "all";
  if (can(permissions.own)) return "own";
  return null;
}

export function canAccessReports(can) {
  return can("reportes.access") ||
    Object.keys(REPORT_PERMISSIONS).some((report) => getReportScope(can, report) !== null);
}
