import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";

test("planeacion comercial captura y actualiza los cuatro trimestres por año", async ({
  page,
}) => {
  const year = new Date().getFullYear();
  const activePeriods = [4, 3, 2, 1].map((quarter) => ({
    id: 40 + quarter,
    year,
    quarter,
    label: `T${quarter} ${year}`,
    status: "active",
    baseCurrencyCode: "USD",
    targetCount: quarter === 4 ? 1 : 0,
    totalQuotaAmount: quarter === 4 ? 100000 : 0,
    totalContributionAmount: quarter === 4 ? 24000 : 0,
    expectedMarginAveragePercent: quarter === 4 ? 24 : null,
  }));
  const makePlan = (planYear = year) => ({
    year: planYear,
    currencyCode: "USD",
    currencyLocked: true,
    hasPersistedPeriods: true,
    eligibleSellers: [{ id: 31, fullName: "Ana Vendedora", email: "ana@example.test" }],
    quarters: [1, 2, 3, 4].map((quarter) => ({
      quarter,
      period: {
        ...activePeriods.find((item) => item.quarter === quarter),
        year: planYear,
        label: `T${quarter} ${planYear}`,
      },
      targets: quarter === 4 ? [{
        id: 4201,
        periodId: 44,
        sellerUserId: 31,
        sellerUserName: "Ana Vendedora",
        sellerUserEmail: "ana@example.test",
        salesQuotaAmount: 100000,
        currencyCode: "USD",
        expectedMarginPercent: 24,
        expectedContributionAmount: 24000,
        status: "complete",
      }] : [],
    })),
  });
  let annualPlan = makePlan();
  const targetWrites = [];
  const commissionWrites = [];
  const makeCommissionPlan = (planYear) => ({
    year: planYear,
    currencyCode: "USD",
    hasPersistedPeriods: true,
    quarters: [1, 2, 3, 4].map((quarter) => ({
      quarter,
      period: {
        ...activePeriods.find((item) => item.quarter === quarter),
        year: planYear,
        label: `T${quarter} ${planYear}`,
      },
      sellers: [{
        sellerUserId: 31,
        sellerUserName: "Ana Vendedora",
        sellerUserEmail: "ana@example.test",
        salesQuotaAmount: quarter === 4 ? 125000 : 0,
        productCommissionPct: 5,
        serviceCommissionPct: 4,
        renewalCommissionPct: 3,
      }],
    })),
  });
  let commissionPlan = makeCommissionPlan(year);

  await page.addInitScript(() => {
    window.localStorage.setItem("crm_token", "commercial-planning-test");
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const json = (body, status = 200) =>
      route.fulfill({ status, json: body });

    if (pathname === "/api/auth/bootstrap-status") {
      return json({ hasUsers: true });
    }
    if (pathname === "/api/auth/me") {
      return json({
        id: 31,
        full_name: "Admin Planeación",
        permissions: [
          "planeacion_comercial.read",
          "planeacion_comercial.create",
          "planeacion_comercial.update",
          "planeacion_comercial.audit.read",
        ],
      });
    }
    if (pathname === "/api/catalogs/currencies") {
      return json([
        { code: "USD", name: "Dólar estadounidense" },
        { code: "MXN", name: "Peso mexicano" },
      ]);
    }
    if (pathname === "/api/commercial-planning/periods" && request.method() === "GET") {
      return json({ periods: activePeriods });
    }
    if (/^\/api\/commercial-planning\/years\/\d+$/.test(pathname) && request.method() === "GET") {
      annualPlan = makePlan(Number(pathname.split("/").at(-1)));
      return json(annualPlan);
    }
    if (pathname === "/api/commercial-planning/periods/44" && request.method() === "GET") {
      return json({
        period: activePeriods.find((item) => item.quarter === 4),
        targets: annualPlan.quarters[3].targets,
        eligibleSellers: [{
          id: 31,
          fullName: "Ana Vendedora",
          email: "ana@example.test",
        }],
      });
    }
    if (pathname === `/api/commercial-planning/years/${year}/targets` && request.method() === "PUT") {
      const body = request.postDataJSON();
      targetWrites.push(body);
      annualPlan.currencyCode = body.currencyCode;
      for (const { quarter, targets } of body.quarters) {
        annualPlan.quarters[quarter - 1].targets = targets.map((target, index) => ({
          ...target,
          id: 4201 + index,
          periodId: 40 + quarter,
          sellerUserName: "Ana Vendedora",
          sellerUserEmail: "ana@example.test",
          currencyCode: body.currencyCode,
        }));
      }
      return json({ message: "Metas del año actualizadas correctamente", ...annualPlan });
    }
    if (/^\/api\/commercial-planning\/years\/\d+\/commission-configs$/.test(pathname) && request.method() === "GET") {
      commissionPlan = makeCommissionPlan(Number(pathname.split("/").at(-2)));
      return json(commissionPlan);
    }
    if (pathname === `/api/commercial-planning/years/${year}/commission-configs` && request.method() === "PUT") {
      const body = request.postDataJSON();
      commissionWrites.push(body);
      commissionPlan = {
        ...commissionPlan,
        quarters: body.quarters.map((quarter) => ({
          ...commissionPlan.quarters[quarter.quarter - 1],
          sellers: quarter.configs.map((config) => ({
            ...commissionPlan.quarters[quarter.quarter - 1].sellers[0],
            ...config,
          })),
        })),
      };
      return json({ message: "Configuración anual de comisiones actualizada correctamente", ...commissionPlan });
    }
    const trackingMatch = pathname.match(/^\/api\/commercial-planning\/periods\/(\d+)\/commission-tracking$/);
    if (trackingMatch && request.method() === "GET") {
          const quarter = Number(trackingMatch[1]) - 40;
          const period = activePeriods.find((item) => item.quarter === quarter);
          const seller = commissionPlan.quarters[quarter - 1].sellers[0];
          return json({
            period,
            baseCurrencyCode: "USD",
            invalidQuotations: quarter === 2 ? [{
              quotationId: 9003,
              proposalName: "Cotización en MXN sin tipo de cambio",
              sellerUserId: seller.sellerUserId,
              sellerUserName: seller.sellerUserName,
              statusCode: "aceptada",
              quotationCurrencyCode: "MXN",
              exchangeRate: 1,
              wonAt: `${year}-05-01T12:00:00.000Z`,
              reason: "La cotización está en MXN con tipo de cambio inválido (1).",
            }] : [],
            pendingQuotations: quarter === 1 ? [{
              quotationId: 9002,
              proposalName: "Cotización ganada pendiente",
              accountName: "Cuenta pendiente",
              sellerUserId: seller.sellerUserId,
              sellerUserName: seller.sellerUserName,
              totalSaleAmount: 4000,
              quotationMarginPct: 18,
              statusCode: "ganada",
              wonAt: `${year}-03-01T12:00:00.000Z`,
            }] : [],
            summaries: [{
              ...seller,
              acceptedSalesAmount: quarter === 4 ? 100000 : 0,
              quotaAttainmentPct: quarter === 4 ? 80 : 0,
              commissionEnabled: quarter === 4,
              acceptedQuotationCount: 1,
              eligibleQuotationCount: quarter === 4 ? 1 : 0,
              blockedLowMarginQuotationCount: 0,
              blockedByQuotaQuotationCount: 0,
              eligibleProductContributionAmount: 0,
              eligibleServiceContributionAmount: 0,
              eligibleRenewalContributionAmount: 0,
              calculatedTotalCommissionAmount: quarter === 4 ? 500 : 0,
              quotations: [{
                quotationId: 9001,
                proposalName: "Cotización aceptada de prueba",
                accountName: "Cuenta de prueba",
                totalSaleAmount: 1000,
                quotationMarginPct: 20,
                currencyCode: "USD",
                statusCode: "accepted",
                wonAt: `${year}-02-15T12:00:00.000Z`,
                passesMarginRule: true,
                sellerPassesQuotaRule: true,
                items: [],
              }],
            }, {
              sellerUserId: 32,
              sellerUserName: "Luis Sin Cuota",
              sellerUserEmail: "luis@example.test",
              salesQuotaAmount: 0,
              acceptedSalesAmount: [499, 1499.6, 0, 377803.56][quarter - 1],
              acceptedQuotationCount: quarter === 3 ? 0 : 1,
              calculatedTotalCommissionAmount: 0,
              commissionEnabled: false,
              quotations: [],
            }],
          });
    }
    return json({});
  });

  await page.goto("/commercial-planning");
  await expect(page.getByRole("heading", { name: "Planeación Comercial" })).toBeVisible();
  await expect(page.getByText("Vista activa")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Resumen", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Auditoría", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Períodos" })).toHaveCount(0);

  await expect(page.getByRole("heading", { name: "Metas anuales" })).toBeVisible();
  await page.getByRole("button", { name: "Metas", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Moneda" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Observaciones" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Última actualización" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Contribución esperada" }).first()).toBeInViewport();
  await expect(page.locator(".commercial-planning-quarter-grid")).not.toContainText("USD");
  await expect(page.locator(".commercial-planning-annual-target-table tbody tr").first().locator("td").nth(1)).toHaveCSS("text-align", "right");
  await expect(page.getByLabel("Cuota Ana Vendedora T4")).toHaveCSS("text-align", "right");
  for (const quarter of [1, 2, 3, 4]) {
    await expect(page.getByRole("heading", { name: `T${quarter} ${year}` })).toBeVisible();
  }
  await page.getByLabel("Año de metas").selectOption(String(year + 1));
  await expect(page.getByRole("heading", { name: `T1 ${year + 1}` })).toBeVisible();
  await page.getByLabel("Año de metas").selectOption(String(year));
  await expect(page.getByRole("heading", { name: `T1 ${year}` })).toBeVisible();
  await page.getByLabel("Cuota Ana Vendedora T4").fill("125000");
  const annualSellerRow = page.locator(".commercial-planning-annual-quota-summary-table tbody")
    .getByRole("row", { name: /Ana Vendedora/ });
  await expect(annualSellerRow.getByRole("cell").nth(4)).toHaveText("125,000");
  await expect(annualSellerRow.getByRole("cell").nth(5)).toHaveText("125,000");
  await expect(annualSellerRow.getByRole("cell").nth(6)).toHaveText("30,000");
  await page.getByRole("button", { name: "Guardar metas" }).click();
  await expect(page.getByText("Metas del año actualizadas correctamente")).toBeVisible();
  expect(targetWrites).toHaveLength(1);
  expect(targetWrites[0].currencyCode).toBe("USD");
  expect(targetWrites[0].quarters).toHaveLength(4);
  expect(targetWrites[0].quarters[3].targets[0]).toEqual(expect.objectContaining({
    sellerUserId: 31,
    salesQuotaAmount: 125000,
    expectedMarginPercent: 24,
  }));

  await expect(page.getByRole("button", { name: "Cerrar período" })).toHaveCount(0);
  await expect(page.getByLabel("Cuota Ana Vendedora T4")).toBeEnabled();
  await expect(page.getByLabel("Moneda anual")).toBeDisabled();
  await expect(page.getByText("Las cuotas del año están en USD.")).toBeVisible();
  await page.getByLabel("Cuota Ana Vendedora T1").fill("50000");
  await page.getByLabel("Margen Ana Vendedora T1").fill("20");
  await page.getByRole("button", { name: "Guardar metas" }).click();
  await expect(page.getByText("Metas del año actualizadas correctamente")).toBeVisible();
  expect(targetWrites).toHaveLength(2);
  expect(targetWrites[1].currencyCode).toBe("USD");
  expect(targetWrites[1].quarters.map((item) => item.quarter)).toEqual([1, 2, 3, 4]);

  await page.getByRole("button", { name: "Comisiones · Configuración" }).click();
  await expect(page.getByLabel("Año de comisiones")).toHaveValue(String(year));
  for (const quarter of [1, 2, 3, 4]) {
    await expect(page.getByRole("heading", { name: `T${quarter} ${year}` })).toBeVisible();
  }
  await expect(page.getByLabel("Cuota total T4")).toHaveText("125,000");
  await page.getByLabel("Año de comisiones").selectOption(String(year + 1));
  await expect(page.getByRole("heading", { name: `T1 ${year + 1}` })).toBeVisible();
  await page.getByLabel("Año de comisiones").selectOption(String(year));
  await expect(page.getByRole("heading", { name: `T1 ${year}` })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Notas" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Última actualización" })).toHaveCount(0);
  await expect(page.locator(".commercial-planning-quarter-grid")).not.toContainText("USD");
  await page.getByRole("columnheader", { name: "% Renovaciones" }).first().scrollIntoViewIfNeeded();
  await expect(page.getByRole("columnheader", { name: "% Renovaciones" }).first()).toBeInViewport();
  await page.getByLabel("Productos Ana Vendedora T2").fill("12.5");

  await expect(page.getByText("Reglas de comisión", { exact: true })).toBeVisible();
  await expect(page.getByText(/Cuota mínima 70% · Margen mínimo 10%/).first()).toBeVisible();
  await page.getByText("Reglas de comisión", { exact: true }).click();
  await expect(page.getByRole("cell", { name: "70%", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "10%", exact: true })).toBeVisible();
  await page.getByText("Categorías de comisión", { exact: true }).click();
  await expect(page.getByText(/Esta regla tiene prioridad/)).toBeVisible();
  await expect(page.getByText("Sin cuota en Metas")).toHaveCount(3);
  await page.getByLabel("Aplicar % Productos a todos T1").fill("7");
  await page.getByRole("button", { name: "Aplicar a T1" }).click();
  await expect(page.getByLabel("Productos Ana Vendedora T1")).toHaveValue("7");
  await expect(page.getByLabel("Servicios Ana Vendedora T1")).toHaveValue("4");
  await page.getByRole("button", { name: "Copiar de T2" }).click();
  await expect(page.getByLabel("Productos Ana Vendedora T3")).toHaveValue("12.5");

  await page.getByText("Simulador de comisión", { exact: true }).click();
  await page.getByLabel("Trimestre a simular").selectOption("4");
  await page.getByLabel("Venta aceptada acumulada del trimestre").fill("90000");
  await page.getByLabel("Margen de la cotización (%)").fill("15");
  await page.getByLabel("Contribución de productos").fill("2000");
  await expect(page.getByText("Elegible: la cotización genera comisión.")).toBeVisible();
  await expect(page.getByRole("row", { name: /Comisión estimada/ })).toContainText("100.00");
  await page.getByLabel("Margen de la cotización (%)").fill("7.5");
  await expect(page.getByText(/Bloqueada por margen: 10%/)).toBeVisible();
  await expect(page.getByRole("row", { name: /Comisión estimada/ })).toContainText("0.00");

  await page.getByRole("button", { name: "Guardar configuración" }).click();
  await expect(page.getByText("Configuración anual de comisiones actualizada correctamente")).toBeVisible();
  expect(commissionWrites).toHaveLength(1);
  expect(commissionWrites[0].quarters).toHaveLength(4);
  expect(commissionWrites[0].quarters[0].configs[0].productCommissionPct).toBe(7);
  expect(commissionWrites[0].quarters[2].configs[0].productCommissionPct).toBe(12.5);
  expect(commissionWrites[0].quarters[1].configs[0]).toEqual(expect.objectContaining({
    sellerUserId: 31,
    productCommissionPct: 12.5,
  }));

  await page.getByRole("button", { name: "Comisiones · Seguimiento" }).click();
  await expect(page.getByText("Reglas de comisión", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Año de seguimiento de comisiones")).toHaveValue(String(year));
  await expect(page.getByRole("button", { name: "Año completo" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: `Comisiones por trimestre · ${year}` })).toBeVisible();
  await expect(page.locator(".commission-year-table tbody tr").first()).toContainText("USD 500");
  const activityCheck = page.locator(".commission-tracking-check");
  expect((await activityCheck.locator("input").boundingBox()).width).toBeLessThan(30);
  expect((await activityCheck.boundingBox()).height).toBeLessThan(40);
  const annualTable = page.locator(".commission-year-table");
  const anaRow = annualTable.getByRole("row", { name: /Ana Vendedora/ });
  const luisRow = annualTable.getByRole("row", { name: /Luis Sin Cuota/ });
  await expect(anaRow.locator("td").nth(4)).toContainText("Venta ≈ USD 100 mil");
  await expect(anaRow.locator("td").nth(1)).toContainText("Venta USD 0");
  await expect(luisRow.locator("td").nth(1)).toContainText("Venta < USD 1 mil");
  await expect(luisRow.locator("td").nth(2)).toContainText("Venta ≈ USD 1 mil");
  const luisT4 = luisRow.locator("td").nth(4);
  await expect(luisT4).toContainText("Sin cuota");
  await expect(luisT4).toContainText("Venta ≈ USD 378 mil");
  await luisT4.locator(".commission-quarter-sale").focus();
  await expect(luisT4.locator(".commission-sale-tooltip")).toBeVisible();
  await expect(luisT4.locator(".commission-sale-tooltip")).toHaveText("Venta aceptada: USD 377,803.56");
  const totalRow = annualTable.locator("tfoot tr");
  await expect(totalRow.getByRole("rowheader")).toHaveText("Total");
  await expect(totalRow.locator("td").nth(3)).toContainText("Venta ≈ USD 478 mil");
  await expect(totalRow.locator("td").nth(4)).toHaveText("USD 500");
  await expect(totalRow.locator("td").nth(5)).toHaveText("USD 479,802");
  await expect(totalRow).not.toContainText("cumpl.");

  const annualDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar a Excel" }).click();
  const annualDownload = await annualDownloadPromise;
  const workbook = XLSX.read(await readFile(await annualDownload.path()), { type: "buffer" });
  const annualRows = XLSX.utils.sheet_to_json(workbook.Sheets["Resumen anual"]);
  expect(annualRows).toHaveLength(3);
  expect(annualRows[1]["Venta T4"]).toBe(377803.56);
  expect(annualRows[2]["Venta T4"]).toBeCloseTo(477803.56, 2);
  expect(annualRows[2]["Venta aceptada"]).toBeCloseTo(479802.16, 2);
  expect(annualRows[2]["Comisión total"]).toBe(500);

  const sellerFilter = page.locator(".commission-tracking-controls").getByRole("combobox");
  await sellerFilter.selectOption("32");
  await expect(annualTable.locator("tbody tr")).toHaveCount(1);
  await expect(totalRow.getByRole("rowheader")).toHaveText("Total mostrado");
  await expect(totalRow.locator("td").nth(4)).toHaveText("USD 0");
  await expect(totalRow.locator("td").nth(5)).toHaveText("USD 379,802");
  const filteredDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar a Excel" }).click();
  const filteredWorkbook = XLSX.read(await readFile(await (await filteredDownloadPromise).path()), { type: "buffer" });
  const filteredRows = XLSX.utils.sheet_to_json(filteredWorkbook.Sheets["Resumen anual"]);
  expect(filteredRows).toHaveLength(2);
  expect(filteredRows[0].Vendedor).toBe("Luis Sin Cuota");
  expect(filteredRows[1].Vendedor).toBe("Total mostrado");
  expect(filteredRows[1]["Venta aceptada"]).toBeCloseTo(379802.16, 2);
  expect(XLSX.utils.sheet_to_json(filteredWorkbook.Sheets["Pendientes de aceptar"])).toHaveLength(0);
  await sellerFilter.selectOption("all");
  await page.getByLabel("Solo con actividad").check();
  await expect(totalRow.getByRole("rowheader")).toHaveText("Total mostrado");
  await expect(totalRow.locator("td").nth(5)).toHaveText("USD 479,802");
  await page.getByLabel("Solo con actividad").uncheck();
  await expect(page.getByRole("heading", { name: "Pendientes de aceptar" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sin convertir a la moneda de la cuota" })).toBeVisible();
  await expect(page.getByText("Cotización en MXN sin tipo de cambio")).toBeVisible();
  await expect(page.getByLabel(`Resumen Año ${year}`)).toContainText("Moneda o tipo de cambio inválido");
  await expect(page.getByText("Cotización ganada pendiente")).toBeVisible();
  await expect(page.getByLabel(`Resumen Año ${year}`)).toContainText("1 · USD 4,000");

  const periodTabs = page.getByRole("group", { name: "Periodo del seguimiento" });
  await periodTabs.getByRole("button", { name: "T4", exact: true }).click();
  await expect(page.getByRole("heading", { name: `T4 ${year}` })).toBeVisible();
  await expect(page.getByText("Habilitado", { exact: true })).toBeVisible();
  await expect(page.getByText("Cotización ganada pendiente")).toHaveCount(0);
  await page.getByRole("button", { name: /Ana Vendedora/ }).click();
  await expect(page.getByText("Cotización aceptada de prueba")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Contribución elegible" })).toBeVisible();

  await periodTabs.getByRole("button", { name: "T1", exact: true }).click();
  await expect(page.getByText("Cotización ganada pendiente")).toBeVisible();
  await expect(page.getByText("Sin cuota ni ventas")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar a Excel" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(`comisiones-seguimiento-${year}.xlsx`);

  await page.getByLabel("Año de seguimiento de comisiones").selectOption(String(year + 1));
  await expect(page.getByRole("button", { name: "Año completo" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: `Comisiones por trimestre · ${year + 1}` })).toBeVisible();
});