import { expect, test } from "@playwright/test";

const run = (id, channel, source, groups, extra = {}) => ({
  id, channel, source, status: "passed", trigger: "manual", model: null, commit: "abc1234def", groups, metrics: {}, reasons: [], details: [],
  evaluatedAt: "2026-11-01T18:00:00.000Z", ...extra,
});

const overviews = {
  coach: (() => {
    const lab = [
      run(1, "coach", "lab", { cases: { passed: 28, total: 29 }, known_gaps_fixed: { passed: 0, total: 3 } }, { evaluatedAt: "2026-10-30T18:00:00.000Z", status: "failed", reasons: ["Casos aprobados: 28/29."] }),
      run(2, "coach", "lab", { cases: { passed: 29, total: 29 }, known_gaps_fixed: { passed: 0, total: 3 }, cat_action: { passed: 5, total: 5 } }),
    ];
    const production = run(3, "coach", "production_monitor", { reliability: { passed: 9, total: 10 }, satisfaction: { passed: 3, total: 4 } },
      { metrics: { turns: 10, failedTurns: 1, negativeRatings: 1, latencyP95Seconds: 6.4 } });
    return { channel: "coach", days: 90, runs: [...lab, production], latest: { lab: lab[1], production_monitor: production } };
  })(),
  prospect: { channel: "prospect", days: 90, runs: [], latest: {} },
};

async function openQuality(page, { read = true, execute = true } = {}) {
  const requests = { overview: [], snapshots: [] };
  await page.addInitScript(() => localStorage.setItem("crm_token", "channel-quality-browser-test"));
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    const json = (data, status = 200) => route.fulfill({ status, json: data });
    if (pathname === "/api/auth/bootstrap-status") return json({ hasUsers: true });
    if (pathname === "/api/auth/me") {
      return json({ id: 31, full_name: "Evaluador", roles: [], permissions: [
        "mi_coach.access", ...(read ? ["mi_coach.evaluations_read"] : []), ...(execute ? ["mi_coach.evaluations_execute"] : []),
      ] });
    }
    const match = pathname.match(/^\/api\/mi-agent\/channel-quality\/(coach|prospect)(\/production-snapshot)?$/);
    if (match && req.method() === "POST" && match[2]) {
      requests.snapshots.push(match[1]);
      return json({ run: { id: 50 } });
    }
    if (match && req.method() === "GET") {
      requests.overview.push(match[1]);
      return json(overviews[match[1]]);
    }
    // The page opens on "Pruebas del chat" for evaluators; give it the minimum it needs to render.
    if (pathname.endsWith("/evaluations/catalog")) return json({ version: "catalog-test", categories: [], smokeCaseIds: [], operationBusinessImpacts: {}, cases: [] });
    if (pathname.endsWith("/evaluations/quality")) {
      return json({ days: 90, runs: [], latest: {}, settings: { weeklyEnabled: false, updatedAt: null, updatedBy: null, ciConfigured: true, lastCiReportAt: null } });
    }
    if (pathname.endsWith("/evaluations/runs")) return json({ page: 1, hasMore: false, runs: [] });
    return json({});
  });
  await page.goto("/mi-agent");
  return requests;
}

test("la calidad de Coach y Cuenta nueva muestra el laboratorio, la producción y la tendencia", async ({ page }) => {
  const requests = await openQuality(page);
  await page.getByRole("button", { name: "Calidad Coach y Cuenta nueva" }).click();
  const section = page.getByRole("region", { name: "Calidad de Coach y Cuenta nueva" });
  await expect(section).toBeVisible();
  await expect(section.getByRole("tab", { name: "Coach" })).toHaveAttribute("aria-selected", "true");
  await expect(section.getByText("29/29 · 100%").first()).toBeVisible();
  await expect(section.getByText("Brechas conocidas corregidas")).toBeVisible();
  await expect(section.getByText("0/3 · 0%")).toBeVisible();
  await expect(section.getByText("Turnos sin fallo")).toBeVisible();
  await expect(section.getByText("10 turnos · 1 fallidos · 1 valoraciones 👎 · p95 6 s")).toBeVisible();
  await expect(section.getByRole("img", { name: "Tendencia de Pruebas de laboratorio (sin IA)" })).toBeVisible();
  await expect(section.getByRole("table")).toContainText("abc1234");
  await expect(section.getByText("Sin ejecuciones registradas.").first()).toBeVisible();
  expect(new Set(requests.overview)).toEqual(new Set(["coach"]));

  await section.getByRole("tab", { name: "Cuenta nueva" }).click();
  await expect(section.getByText("Todavía no hay ejecuciones registradas para este canal.")).toBeVisible();
  expect(new Set(requests.overview)).toEqual(new Set(["coach", "prospect"]));
  expect(requests.overview.at(-1)).toBe("prospect");
});

test("quien puede ejecutar actualiza el monitoreo del canal elegido", async ({ page }) => {
  const requests = await openQuality(page);
  await page.getByRole("button", { name: "Calidad Coach y Cuenta nueva" }).click();
  const section = page.getByRole("region", { name: "Calidad de Coach y Cuenta nueva" });
  await section.getByRole("tab", { name: "Cuenta nueva" }).click();
  await section.getByRole("button", { name: "Actualizar monitoreo de producción" }).click();
  await expect.poll(() => requests.snapshots).toEqual(["prospect"]);
});

test("sin permiso de ejecución no se ofrece actualizar y sin lectura no aparece la pestaña", async ({ page }) => {
  await openQuality(page, { execute: false });
  await page.getByRole("button", { name: "Calidad Coach y Cuenta nueva" }).click();
  const section = page.getByRole("region", { name: "Calidad de Coach y Cuenta nueva" });
  await expect(section).toBeVisible();
  await expect(section.getByRole("button", { name: "Actualizar monitoreo de producción" })).toHaveCount(0);
});

test("sin permiso de lectura de evaluaciones no hay pestaña de calidad", async ({ page }) => {
  await openQuality(page, { read: false, execute: false });
  await expect(page.getByRole("button", { name: "Calidad Coach y Cuenta nueva" })).toHaveCount(0);
});
