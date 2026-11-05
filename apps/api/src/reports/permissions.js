import { getReportScope } from "../../../../shared/report-permissions.js";

export function requireReportScope(user, report) {
  const scope = getReportScope((permission) => user?.permissionSet?.has(permission), report);
  if (!scope) {
    const error = new Error("No autorizado para consultar este reporte");
    error.status = 403;
    throw error;
  }
  return scope;
}
