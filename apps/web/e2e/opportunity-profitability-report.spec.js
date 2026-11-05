import { expect, test } from "@playwright/test";

const totals = { sale: 1500, productCost: 700, serviceCost: 300, totalCost: 1000, profit: 500, marginPct: 100 / 3 };
const payload = {
  page: 1, pageSize: 10, total: 11,
  summary: { opportunityCount: 11, quotationCount: 12, missingCount: 0, totals, convertibleSubtotal: totals },
  items: [{
    id: 3, name: "Proyecto rentable", accountName: "Cliente visible", sellerName: "Vendedor",
    quotationCount: 2, missingCount: 0, totals, convertibleSubtotal: totals,
    quotations: [
      { id: 301, versionNumber: 2, proposalName: "Productos", statusName: "Ganada", currency: "USD", exchangeRate: 1, original: totals, usd: totals },
      { id: 302, versionNumber: 1, proposalName: "Servicios", statusName: "Aceptada", currency: "MXN", exchangeRate: 20,
        original: { sale: 2000, productCost: 0, serviceCost: 1500, totalCost: 1500, profit: 500, marginPct: 25 },
        usd: { sale: 100, productCost: 0, serviceCost: 75, totalCost: 75, profit: 25, marginPct: 25 } },
    ],
  }],
};

async function openReport(page, { permissions = ["reportes.rentabilidad.read_all"], data = payload, fail = false, failCatalogs = false } = {}) {
  const requests = [];
  await page.addInitScript(() => window.localStorage.setItem("crm_token", "report-test"));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/bootstrap-status") return route.fulfill({ json: { hasUsers: true } });
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { id: 501, full_name: "Usuario reportes", permissions } });
    if (url.pathname === "/api/reports/opportunities-quotations/catalogs") {
      return route.fulfill({ json: { accounts: [], sellers: [], presales: [] } });
    }
    if (url.pathname === "/api/reports/opportunities-quotations") {
      return route.fulfill({ json: {
        page: 1, pageSize: 10, total: 0, items: [],
        summary: { opportunityCount: 0, quotationCount: 0, wonCount: 0, acceptedCount: 0, matchingCount: 0,
          opportunityAmountUsd: 0, currencies: [], quotedUsd: { amount: 0, matchingAmount: 0, missingCount: 0, matchingMissingCount: 0 } },
      } });
    }
    if (url.pathname === "/api/reports/opportunity-profitability/catalogs") {
      return route.fulfill(failCatalogs ? { status: 500, json: { message: "Error de catálogos" } } : {
        json: { accounts: [{ id: 1, name: "Cliente visible" }], sellers: [{ id: 19, name: "Vendedor" }] },
      });
    }
    if (url.pathname === "/api/reports/opportunity-profitability") {
      requests.push(Object.fromEntries(url.searchParams));
      if (fail) return route.fulfill({ status: 500, json: { message: "Error de rentabilidad" } });
      return route.fulfill({ json: { ...data, page: Number(url.searchParams.get("page") || 1) } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/reports");
  return requests;
}

test("abre el reporte y desglosa cotizaciones con sus monedas e importes", async ({ page }) => {
  await openReport(page);
  await page.getByRole("link", { name: /Rentabilidad de oportunidades ganadas/ }).click();
  await expect(page.getByRole("heading", { name: "Rentabilidad de oportunidades ganadas" })).toBeVisible();
  await expect(page.getByText("#3 Proyecto rentable", { exact: true })).toBeVisible();
  await expect(page.getByText("11 oportunidades · 12 cotizaciones", { exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Costo de servicios", exact: true })).toBeVisible();
  await expect(page.locator("dl").getByText("33.33%", { exact: true })).toBeVisible();
  await page.getByText("Ver cotizaciones de #3").click();
  const details = page.getByRole("table", { name: "Cotizaciones de Proyecto rentable" });
  await expect(details.getByText("#301 Productos · v2")).toBeVisible();
  await expect(details.getByText("#302 Servicios · v1")).toBeVisible();
  await expect(details.getByText("1 USD = 20.00 MXN")).toBeVisible();
  await expect(details.getByText("2,000.00", { exact: true })).toBeVisible();
  await expect(details.getByText("Equivalente USD de #302")).toBeVisible();
});

test("envia filtros y ordenamiento sin cambiar las reglas fijas y mantiene filtros al paginar", async ({ page }) => {
  const requests = await openReport(page);
  await page.goto("/reports/opportunity-profitability");
  await page.getByLabel("Buscar oportunidad o cliente").fill("Proyecto");
  await page.getByLabel("Cliente", { exact: true }).selectOption("1");
  await page.getByLabel("Vendedor", { exact: true }).selectOption("19");
  await page.getByLabel("Cierre comercial desde").fill("2026-11-01");
  await page.getByLabel("Cierre comercial hasta").fill("2026-11-30");
  await page.getByLabel("Ordenar por").selectOption("profit");
  await page.getByLabel("Dirección").selectOption("asc");
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect.poll(() => requests.at(-1)).toMatchObject({
    search: "Proyecto", accountId: "1", sellerUserId: "19", dateFrom: "2026-11-01", dateTo: "2026-11-30",
    sort: "profit", direction: "asc", page: "1",
  });
  await page.getByRole("button", { name: "Siguiente", exact: true }).click();
  await expect.poll(() => requests.at(-1)).toMatchObject({ search: "Proyecto", page: "2", sort: "profit" });
  await expect(page.getByText("Página 2 de 2")).toBeVisible();
  await expect(page.locator("dl").getByText("1,500.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await expect(page.getByLabel("Buscar oportunidad o cliente")).toHaveValue("");
  await expect.poll(() => requests.at(-1).page).toBe("1");
});

test("advierte totales incompletos y no presenta el margen global como calculado", async ({ page }) => {
  const data = {
    ...payload, summary: { ...payload.summary, missingCount: 1, totals: null },
    items: [{ ...payload.items[0], missingCount: 1, totals: null,
      quotations: [{ ...payload.items[0].quotations[1], exchangeRate: null, usd: null }] }],
  };
  await openReport(page, { data });
  await page.goto("/reports/opportunity-profitability");
  await expect(page.getByRole("alert")).toContainText("Total incompleto");
  await expect(page.locator("dl")).toContainText("Subtotal convertible");
  await expect(page.locator("dl")).toContainText("No calculable");
  await expect(page.locator("dl")).not.toContainText("33.33%");
  await page.getByText("Ver cotizaciones de #3").click();
  await expect(page.getByText("Tipo de cambio faltante o inválido", { exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "Cotizaciones de Proyecto rentable" }).getByText("2,000.00", { exact: true })).toBeVisible();
});

test("muestra perdidas y margen no calculable con venta cero", async ({ page }) => {
  const zero = { sale: 0, productCost: 100, serviceCost: 0, totalCost: 100, profit: -100, marginPct: null };
  await openReport(page, { data: {
    ...payload, summary: { ...payload.summary, totals: zero },
    items: [{ ...payload.items[0], totals: zero }],
  } });
  await page.goto("/reports/opportunity-profitability");
  await expect(page.locator("dl")).toContainText("No calculable");
  await expect(page.locator(".report-opportunity-row .profitability-negative")).toHaveText("-100.00");
});

test("informa errores del reporte y permite reintentar", async ({ page }) => {
  await openReport(page, { fail: true, failCatalogs: true });
  await page.goto("/reports/opportunity-profitability");
  await expect(page.getByText("Error de rentabilidad", { exact: true })).toBeVisible();
  await expect(page.getByText("Error de catálogos", { exact: true })).toBeVisible();
  await page.route("**/api/reports/opportunity-profitability?**", (route) => route.fulfill({ json: payload }));
  await page.getByRole("button", { name: "Reintentar reporte" }).click();
  await expect(page.getByText("#3 Proyecto rentable", { exact: true })).toBeVisible();
});

test("muestra el estado vacio", async ({ page }) => {
  await openReport(page, { data: { ...payload, total: 0, items: [], summary: { ...payload.summary, opportunityCount: 0, quotationCount: 0 } } });
  await page.goto("/reports/opportunity-profitability");
  await expect(page.getByText("No hay oportunidades ganadas con cotizaciones elegibles para estos filtros.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Siguiente", exact: true })).toBeDisabled();
});

test("oculta el acceso y no consulta datos sin permisos suficientes", async ({ page }) => {
  const requests = await openReport(page, { permissions: ["oportunidades.read"] });
  await expect(page.getByRole("link", { name: /Rentabilidad de oportunidades ganadas/ })).toHaveCount(0);
  await page.goto("/reports/opportunity-profitability");
  await expect(page.getByRole("alert")).toContainText("Acceso insuficiente");
  expect(requests).toEqual([]);
});

test("el permiso propio incluye entrada y detalle sin habilitar el otro reporte ni modulos de origen", async ({ page }) => {
  const requests = await openReport(page, { permissions: ["reportes.rentabilidad.read"] });
  const sidebar = page.locator(".sidebar");
  await expect(sidebar.getByRole("link", { name: "Reportes", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Oportunidades", exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: "Cotizaciones", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Oportunidades y cotizaciones/ })).toHaveCount(0);
  await page.getByRole("link", { name: /Rentabilidad de oportunidades ganadas/ }).click();
  await expect(page.getByText("Alcance: Mis datos (vendedor asignado actual)")).toBeVisible();
  await expect(page.getByLabel("Vendedor", { exact: true })).toHaveCount(0);
  await expect(page.getByText("#3 Proyecto rentable", { exact: true })).toBeVisible();
  await page.getByText("Ver cotizaciones de #3").click();
  await expect(page.getByRole("table", { name: "Cotizaciones de Proyecto rentable" })).toBeVisible();
  await page.goto("/reports/opportunities-quotations");
  await expect(page.getByRole("alert")).toContainText("Acceso insuficiente");
  expect(requests.length).toBeGreaterThan(0);
});

test("cada reporte muestra su alcance independiente", async ({ page }) => {
  await openReport(page, { permissions: ["reportes.oportunidades_cotizaciones.read_all", "reportes.rentabilidad.read"] });
  await expect(page.getByRole("link", { name: /Rentabilidad de oportunidades ganadas/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Oportunidades y cotizaciones/ })).toBeVisible();
  await page.getByRole("link", { name: /Oportunidades y cotizaciones/ }).click();
  await expect(page.getByText("Alcance: Todos los usuarios")).toBeVisible();
  await page.goto("/reports/opportunity-profitability");
  await expect(page.getByText("Alcance: Mis datos (vendedor asignado actual)")).toBeVisible();
});

test("mantiene la tabla dentro de su contenedor en escritorio y movil", async ({ page }, testInfo) => {
  await openReport(page);
  await page.goto("/reports/opportunity-profitability");
  await expect(page.getByText("#3 Proyecto rentable", { exact: true })).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole("button", { name: "Aplicar filtros" })).toBeVisible();
    if (width === 1440) {
      const cards = page.locator(".report-totals > div");
      expect((await cards.nth(3).boundingBox()).y).toBe((await cards.first().boundingBox()).y);
    }
    await page.locator(".opportunity-profitability-report").screenshot({ path: testInfo.outputPath(`rentabilidad-${width}.png`) });
  }
});
