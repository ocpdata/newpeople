import { expect, test } from "@playwright/test";

const quotation = (id, status, matches, currency = "USD") => ({
  id, versionNumber: 2, proposalName: `Propuesta ${id}`,
  statusCode: status, statusName: status === "aceptada" ? "Aceptada" : "Borrador",
  activationStatus: "Activada", quotationDate: "2026-11-02",
  currency, exchangeRate: currency === "USD" ? 1 : 20, totalAmount: 104.4, matchesFilters: matches,
  purchaseOrders: id === 301 ? [
    { documentId: 1, source: "quotation", originalFileName: "orden-usd.pdf", amount: 1500, currencyCode: "USD" },
    { documentId: 2, source: "opportunity", originalFileName: "orden-mxn.pdf", amount: 3000, currencyCode: "MXN" },
  ] : [{ documentId: 3, source: "quotation", originalFileName: "orden-pendiente.pdf", amount: null, currencyCode: null }],
});
const opportunity = {
  id: 3, name: "Proyecto comercial", accountId: 1, accountName: "Cuenta visible",
  amountUsd: 300, expectedCloseDate: "2026-11-15", actualCloseDate: "2026-11-03T23:59:59.000Z",
  sellerName: "Vendedor", presalesName: "Preventa", salesStage: "Waiting",
  commercialStatusCode: "ganada", commercialStatusName: "Ganada", activationStatus: "Activada",
  quotations: [quotation(301, "aceptada", true), quotation(302, "borrador", false, "MXN")],
};
const payload = {
  page: 1, pageSize: 10, total: 11,
  summary: {
    opportunityCount: 11, wonCount: 3, opportunityAmountUsd: 1500,
    quotationCount: 5, acceptedCount: 2, matchingCount: 2,
    quotedUsd: { amount: 375.84, matchingAmount: 219.24, missingCount: 0, matchingMissingCount: 0 },
    currencies: [
      { currency: "USD", amount: 365.4, matchingAmount: 208.8 },
      { currency: "MXN", amount: 208.8, matchingAmount: 208.8 },
    ],
  },
  items: [opportunity],
};

async function openReport(page, { permissions = ["oportunidades.read", "cotizaciones.operacion"], fail = false, reportPayload = payload } = {}) {
  const requests = [];
  await page.addInitScript(() => window.localStorage.setItem("crm_token", "report-test"));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/bootstrap-status") return route.fulfill({ json: { hasUsers: true } });
    if (url.pathname === "/api/auth/me") return route.fulfill({
      json: { id: 501, full_name: "Usuario reportes", permissions },
    });
    if (url.pathname === "/api/reports/opportunities-quotations/catalogs") return route.fulfill({
      json: {
        accounts: [{ id: 1, name: "Cuenta visible" }],
        sellers: [{ id: 19, name: "Vendedor" }], presales: [{ id: 20, name: "Preventa" }],
      },
    });
    if (url.pathname === "/api/reports/opportunities-quotations") {
      requests.push(Object.fromEntries(url.searchParams));
      if (fail) {
        return route.fulfill({ status: 500, json: { message: "No fue posible consultar el reporte" } });
      }
      const empty = url.searchParams.get("search") === "sin resultados";
      return route.fulfill({
        json: {
          ...reportPayload, page: Number(url.searchParams.get("page") || 1),
          ...(empty ? { total: 0, items: [], summary: {
            ...reportPayload.summary, opportunityCount: 0,
            quotedUsd: { amount: 0, matchingAmount: 0, missingCount: 0, matchingMissingCount: 0 },
          } } : {}),
        },
      });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/reports");
  return requests;
}

test("navega desde Reportes y muestra las cotizaciones actuales agrupadas", async ({ page }) => {
  await openReport(page);
  await page.getByRole("link", { name: /Oportunidades y cotizaciones/ }).click();
  await expect(page.getByRole("heading", { name: "Oportunidades y cotizaciones" })).toBeVisible();
  await expect(page.getByLabel("Anulada", { exact: true })).toHaveCount(0);
  await expect(page.getByText("#3 Proyecto comercial", { exact: true })).toBeVisible();
  await expect(page.getByText("Total cotizado equivalente en USD: 375.84", { exact: true })).toBeVisible();
  await expect(page.getByText("Cotizado USD: 365.40", { exact: true })).toBeVisible();
  await expect(page.getByText("Cotizado MXN: 208.80", { exact: true })).toBeVisible();
  const opportunityRow = page.getByRole("row").filter({ has: page.getByText("#3 Proyecto comercial", { exact: true }) });
  await expect(opportunityRow.getByRole("cell", { name: "300.00", exact: true })).toBeVisible();
  await expect(opportunityRow.getByText("#301: 104.40 USD", { exact: true })).toBeVisible();
  await expect(opportunityRow.getByText("#302: 104.40 MXN")).toBeVisible();
  await expect(opportunityRow.getByRole("cell", { name: /#302: 5.22 USD/ })).toBeVisible();
  await expect(opportunityRow.getByRole("cell", { name: /#302: 1 USD = 20 MXN/ })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Equivalentes de cotizaciones (USD)", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Valores de órdenes de compra", exact: true })).toBeVisible();
  await expect(opportunityRow.getByText("1,500.00 USD", { exact: true })).toBeVisible();
  await expect(opportunityRow.getByText("3,000.00 MXN", { exact: true })).toBeVisible();
  await expect(opportunityRow.getByText("Valor sin registrar", { exact: true })).toBeVisible();
  await expect(page.getByText(/orden-usd\.pdf|orden-mxn\.pdf|orden-pendiente\.pdf/)).toHaveCount(0);
  await expect(opportunityRow.getByText(/Tipo de cambio faltante o inválido/)).toHaveCount(0);
  await page.getByText(/Cotizaciones de #3:/).click();
  const quotations = page.getByRole("table", { name: "Cotizaciones de Proyecto comercial" });
  await expect(quotations.getByText("#301 Propuesta 301")).toBeVisible();
  await expect(quotations.getByText("#302 Propuesta 302")).toBeVisible();
  await expect(quotations.getByRole("columnheader", { name: "Cumple los filtros", exact: true })).toBeVisible();
  await expect(quotations.getByRole("row").filter({ hasText: "#301 Propuesta 301" })
    .getByRole("cell", { name: "Cumple", exact: true })).toBeVisible();
  await expect(quotations.getByRole("row").filter({ hasText: "#302 Propuesta 302" })
    .getByRole("cell", { name: "No cumple", exact: true })).toBeVisible();
  await expect(quotations.getByRole("cell", { name: "5.22 USD", exact: true })).toBeVisible();
  await expect(quotations.getByRole("cell", { name: "104.40 MXN", exact: true })).toBeVisible();
  await expect(quotations.getByRole("cell", { name: "1 USD = 20 MXN (guardado)", exact: true })).toBeVisible();
  await expect(quotations.getByText("1,500.00 USD", { exact: true })).toBeVisible();
  await page.getByLabel("Mostrar cotizaciones").selectOption("matching");
  await expect(quotations.getByText("#301 Propuesta 301")).toBeVisible();
  await expect(quotations.getByText("#302 Propuesta 302")).toHaveCount(0);
  await expect(opportunityRow.getByText("#302: 104.40 MXN")).toHaveCount(0);
  await expect(opportunityRow.getByText("Valor sin registrar", { exact: true })).toHaveCount(0);
  await expect(opportunityRow.getByText("#301: 104.40 USD", { exact: true })).toBeVisible();
  await expect(page.getByText("Cotizado USD: 208.80")).toBeVisible();
  await expect(page.getByText("Total cotizado equivalente en USD: 219.24", { exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader").filter({ hasText: /Estado|Activación|Fecha|Cierre/ })).toHaveCount(0);
});

test("advierte cuando el equivalente es parcial y cambia con la seleccion de cotizaciones", async ({ page }) => {
  await openReport(page, { reportPayload: {
    ...payload, summary: {
      ...payload.summary,
      quotedUsd: { amount: 365.4, matchingAmount: 208.8, missingCount: 1, matchingMissingCount: 0 },
    },
  } });
  await page.getByRole("link", { name: /Oportunidades y cotizaciones/ }).click();
  await expect(page.getByText(/Subtotal convertible en USD: 365.40/)).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("1 cotización sin conversión por falta de moneda, importe o tipo de cambio válido.");
  await expect(page.getByText("Cotizado MXN: 208.80")).toBeVisible();
  await page.getByLabel("Mostrar cotizaciones").selectOption("matching");
  await expect(page.getByText("Total cotizado equivalente en USD: 208.80", { exact: true })).toBeVisible();
  await expect(page.getByText(/cotizaci[oó]n.*sin conversión/)).toHaveCount(0);
});

test("organiza resumen y detalle en escritorio y permite consultar la tabla en movil", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await openReport(page);
  await page.getByRole("link", { name: /Oportunidades y cotizaciones/ }).click();
  const results = page.getByRole("region", { name: "Resultados del reporte", exact: true });
  await expect(results.getByText("11 oportunidades", { exact: true })).toBeVisible();
  await expect(results.getByRole("list", { name: "Totales cotizados por moneda" })).toBeVisible();
  await page.getByText(/Cotizaciones de #3:/).click();
  await results.screenshot({ path: testInfo.outputPath("resultados-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  const totals = results.locator(".report-totals");
  await totals.scrollIntoViewIfNeeded();
  expect(await totals.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(2);
  const scroll = results.locator(".report-table-scroll");
  expect(await scroll.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await results.screenshot({ path: testInfo.outputPath("resultados-mobile.png") });
});

test("agrupa filtros y conserva opciones avanzadas en escritorio y movil", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const requests = await openReport(page);
  await page.getByRole("link", { name: /Oportunidades y cotizaciones/ }).click();
  const filters = page.locator(".report-filters");
  await expect(page.getByRole("region", { name: "Búsqueda y responsables" })).toBeVisible();
  await expect(page.getByLabel("Activación de cotización")).not.toBeVisible();
  await page.getByText("Opciones avanzadas", { exact: false }).click();
  await page.getByLabel("Activación de cotización").selectOption("activada");
  await page.getByLabel("Ordenar por").selectOption("amount");
  await page.getByLabel("Dirección", { exact: true }).selectOption("asc");
  await page.getByLabel("Oportunidades por página").selectOption("50");
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect.poll(() => requests.at(-1)?.pageSize).toBe("50");
  expect(requests.at(-1)).toMatchObject({ quotationActivation: "activada", sort: "amount", direction: "asc" });
  await filters.screenshot({ path: testInfo.outputPath("filtros-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  const grid = filters.locator(".report-filter-grid").first();
  expect(await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(1);
  await filters.screenshot({ path: testInfo.outputPath("filtros-mobile.png") });
  await page.getByRole("button", { name: "Limpiar", exact: true }).click();
  await expect(page.getByLabel("Activación de cotización")).toHaveValue("all");
  await expect(page.getByLabel("Oportunidades por página")).toHaveValue("10");
});

test("distingue una orden con valor cero de una cotizacion sin orden", async ({ page }) => {
  await openReport(page);
  await page.route("**/api/reports/opportunities-quotations?**", (route) => route.fulfill({
    json: {
      ...payload,
      items: [{
        ...opportunity,
        quotations: [
          { ...quotation(301, "aceptada", true), purchaseOrders: [
            { documentId: 1, source: "quotation", originalFileName: "orden-cero.pdf", amount: 0, currencyCode: "USD" },
          ] },
          { ...quotation(302, "borrador", true), purchaseOrders: [] },
        ],
      }],
    },
  }));
  await page.getByRole("link", { name: /Oportunidades y cotizaciones/ }).click();
  const opportunityRow = page.getByRole("row").filter({ has: page.getByText("#3 Proyecto comercial", { exact: true }) });
  await expect(opportunityRow.getByText("0.00 USD", { exact: true })).toBeVisible();
  await expect(opportunityRow.getByText("Sin orden de compra registrada", { exact: true })).toBeVisible();
});

test("muestra la falta de tipo de cambio sin asumir una conversión", async ({ page }) => {
  await openReport(page);
  await page.route("**/api/reports/opportunities-quotations?**", (route) => route.fulfill({
    json: {
      ...payload,
      items: [{
        ...opportunity,
        quotations: [{ ...quotation(302, "borrador", true, "MXN"), exchangeRate: null }],
      }],
    },
  }));
  await page.getByRole("link", { name: /Oportunidades y cotizaciones/ }).click();
  await expect(page.getByText(/Tipo de cambio faltante o inválido/).first()).toBeVisible();
  await expect(page.getByText(/#302: 5.22 USD/)).toHaveCount(0);
});

test("aplica filtros combinados, pagina y limpia sin enviar filtros vacíos", async ({ page }) => {
  const requests = await openReport(page);
  await page.getByRole("link", { name: /Oportunidades y cotizaciones/ }).click();
  await expect(page.getByRole("button", { name: "Siguiente", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Siguiente", exact: true }).click();
  await expect(page.getByText("Página 2 de 2")).toBeVisible();
  await page.getByLabel("Consulta rápida").selectOption("both");
  await page.getByLabel("Cuenta", { exact: true }).selectOption("1");
  await page.getByLabel("Vendedor", { exact: true }).selectOption("19");
  await page.getByLabel("Preventa", { exact: true }).selectOption("20");
  await page.getByRole("group", { name: /Estado de cotización/ }).getByLabel("Aceptada", { exact: true }).check();
  await page.getByLabel("Fecha a filtrar").selectOption("actual_close");
  await page.getByLabel("Desde", { exact: true }).fill("2026-11-01");
  await page.getByLabel("Hasta", { exact: true }).fill("2026-11-30");
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page.getByText("Página 1 de 2")).toBeVisible();
  expect(requests.at(-1)).toMatchObject({
    preset: "both", accountId: "1", sellerUserId: "19", presalesUserId: "20",
    quotationStatuses: "aceptada", dateType: "actual_close",
    dateFrom: "2026-11-01", dateTo: "2026-11-30", page: "1",
  });
  await page.getByRole("button", { name: "Limpiar", exact: true }).click();
  await expect(page.getByLabel("Cuenta", { exact: true })).toHaveValue("");
  await expect.poll(() => requests.at(-1)?.preset).toBe("all");
  expect(requests.at(-1)).not.toHaveProperty("dateFrom");
  expect(requests.at(-1)).not.toHaveProperty("quotationStatuses");
  await page.getByLabel("Buscar oportunidad o cuenta").fill("sin resultados");
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page.getByText("No hay resultados para los filtros seleccionados.")).toBeVisible();
});

test("expone errores y permite reintentar el reporte", async ({ page }) => {
  await openReport(page, { fail: true });
  await page.getByRole("link", { name: /Oportunidades y cotizaciones/ }).click();
  await expect(page.getByRole("alert")).toContainText("No fue posible consultar el reporte");
  await page.route("**/api/reports/opportunities-quotations?**", (route) => route.fulfill({ json: payload }));
  await page.getByRole("button", { name: "Reintentar reporte" }).click();
  await expect(page.getByText("#3 Proyecto comercial", { exact: true })).toBeVisible();
});

test("no consulta datos ni ofrece la tarjeta sin acceso a ambos módulos", async ({ page }) => {
  const requests = await openReport(page, { permissions: ["oportunidades.read_all"] });
  await expect(page.getByRole("link", { name: /Oportunidades y cotizaciones/ })).toHaveCount(0);
  await page.goto("/reports/opportunities-quotations");
  await expect(page.getByRole("alert")).toContainText("Acceso insuficiente");
  expect(requests).toHaveLength(0);
});
