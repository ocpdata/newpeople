import { expect, test } from "@playwright/test";

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
        const trackingMatch = pathname.match(/^\/api\/commercial-planning\/periods\/(\d+)\/commission-tracking$/);
        if (trackingMatch && request.method() === "GET") {
          const quarter = Number(trackingMatch[1]) - 40;
          const period = activePeriods.find((item) => item.quarter === quarter);
          const seller = commissionPlan.quarters[quarter - 1].sellers[0];
          return json({
            period,
            baseCurrencyCode: "USD",
            summaries: [{
              ...seller,
              acceptedSalesAmount: 0,
              quotaAttainmentPct: 0,
              commissionEnabled: false,
              eligibleQuotationCount: 0,
              blockedLowMarginQuotationCount: 0,
              blockedByQuotaQuotationCount: 0,
              eligibleProductContributionAmount: 0,
              eligibleServiceContributionAmount: 0,
              eligibleRenewalContributionAmount: 0,
              calculatedTotalCommissionAmount: 0,
              quotations: [],
            }],
          });
        }
      return json({ message: "Configuración anual de comisiones actualizada correctamente", ...commissionPlan });
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
  await page.getByLabel("Moneda anual").selectOption("MXN");
  await page.getByLabel("Cuota Ana Vendedora T1").fill("50000");
  await page.getByLabel("Margen Ana Vendedora T1").fill("20");
  await page.getByRole("button", { name: "Guardar metas" }).click();
  await expect(page.getByText("Metas del año actualizadas correctamente")).toBeVisible();
  expect(targetWrites).toHaveLength(2);
  expect(targetWrites[1].currencyCode).toBe("MXN");
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
  await expect(page.getByRole("columnheader", { name: "% Renovaciones" }).first()).toBeInViewport();
  await page.getByLabel("Productos Ana Vendedora T2").fill("12.5");
  await page.getByRole("button", { name: "Guardar configuración" }).click();
  await expect(page.getByText("Configuración anual de comisiones actualizada correctamente")).toBeVisible();
  expect(commissionWrites).toHaveLength(1);
  expect(commissionWrites[0].quarters).toHaveLength(4);
  expect(commissionWrites[0].quarters[1].configs[0]).toEqual(expect.objectContaining({
    sellerUserId: 31,
    productCommissionPct: 12.5,
  }));

  await page.getByRole("button", { name: "Comisiones · Seguimiento" }).click();
  await expect(page.getByLabel("Año de seguimiento de comisiones")).toHaveValue(String(year));
  for (const quarter of [1, 2, 3, 4]) {
    await expect(page.getByRole("heading", { name: `T${quarter} ${year}` })).toBeVisible();
  }
  await page.getByLabel("Año de seguimiento de comisiones").selectOption(String(year + 1));
  await expect(page.getByRole("heading", { name: `T1 ${year + 1}` })).toBeVisible();
});