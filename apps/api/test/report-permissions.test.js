import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => {
  const query = vi.fn(async () => [[]]);
  return { query, withTransaction: (work) => work({ query }) };
});

import { query } from "../src/db.js";
import { ensureCorePermissions } from "../src/permissions.js";
import { canAccessReports, getReportScope, REPORT_PERMISSIONS } from "../../../shared/report-permissions.js";

beforeEach(() => query.mockClear());

describe("Report permissions", () => {
  it("registers five permissions in the Reports group without assigning existing roles", async () => {
    await ensureCorePermissions({ autoAssignRoles: false });
    const inserts = query.mock.calls.filter(([sql, params]) =>
      sql.includes("INSERT INTO permissions") && params[1] === "reportes");
    expect(inserts.map(([, params]) => params[0])).toEqual([
      "reportes.access",
      "reportes.oportunidades_cotizaciones.read",
      "reportes.oportunidades_cotizaciones.read_all",
      "reportes.rentabilidad.read",
      "reportes.rentabilidad.read_all",
    ]);
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO role_permissions"))).toBe(false);
    expect(inserts.every(([sql]) => sql.includes("WHERE NOT EXISTS"))).toBe(true);
  });

  it("allows module-only access without report access", () => {
    const can = (permission) => permission === "reportes.access";
    expect(canAccessReports(can)).toBe(true);
    expect(getReportScope(can, "profitability")).toBeNull();
    expect(getReportScope(can, "opportunitiesQuotations")).toBeNull();
  });

  it.each(Object.keys(REPORT_PERMISSIONS))("includes module access and prioritizes global scope for %s", (report) => {
    const { own, all } = REPORT_PERMISSIONS[report];
    expect(canAccessReports((code) => code === own)).toBe(true);
    expect(getReportScope((code) => code === own, report)).toBe("own");
    expect(canAccessReports((code) => code === all)).toBe(true);
    expect(getReportScope((code) => code === all, report)).toBe("all");
    expect(getReportScope((code) => [own, all].includes(code), report)).toBe("all");
  });

  it("does not grant access through source module permissions", () => {
    expect(canAccessReports((permission) => ["oportunidades.read_all", "cotizaciones.administracion"].includes(permission))).toBe(false);
  });
});
