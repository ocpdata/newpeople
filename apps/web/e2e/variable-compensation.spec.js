import { expect, test } from "@playwright/test";
import { DEFAULT_VARIABLE_RULES, calculateVariable } from "../../../shared/variable-compensation.js";

const rulesState = (overrides = {}) => ({ rules: DEFAULT_VARIABLE_RULES, validated: false, version: 0, isDefault: true, updatedAt: null, updatedByName: null, ...overrides });
const sale = (id, extra) => ({
  quotationId: id, proposalName: `Propuesta ${id}`, wonAt: "2026-10-15T06:00:00.000Z", accountId: id, accountName: `Cliente ${id}`,
  sellerUserId: 1, sellerUserName: "Ana López", line: "products", lineAmounts: {}, saleAmount: 100000, costAmount: 60000, marginPct: 40,
  lowMargin: false, newClient: false, ...extra,
});
const sales = [
  sale(1, { saleAmount: 2000000, costAmount: 1300000, marginPct: 35 }),
  sale(2, { sellerUserId: 2, sellerUserName: "Bruno Ruiz", line: "services", newClient: true, accountName: "Aurora Textil" }),
  sale(3, { sellerUserId: 2, sellerUserName: "Bruno Ruiz", line: "renewals", saleAmount: 50000, costAmount: 48000, marginPct: 4, lowMargin: true, accountName: "Marina del Rey" }),
];

function okPayload(rules = rulesState()) {
  const variable = calculateVariable(rules.rules, { attainmentPct: 73.4778, marginPct: 33.7142, sellersInQuota: 1, newClientsMet: false, existingAccountsMet: null });
  return {
    status: "ok", period: { year: 2026, quarter: 4, label: "T4 2026", totalDays: 92, dayNumber: 37, daysRemaining: 55 },
    isCurrentQuarter: true, currencyCode: "USD", rules, variable,
    company: {
      quotaAmount: 2800000, salesAmount: 2057500, attainmentPct: 73.48, costAmount: 1363500, contributionAmount: 694000, marginPct: 33.71,
      marginExcludingLowPct: 35, remainingQuotaAmount: 742500, requiredDailyAmount: 13500, pendingAcceptanceAmount: 90000, pendingAcceptanceCount: 2,
    },
    sellers: [
      { sellerUserId: 1, sellerUserName: "Ana López", quotaAmount: 1400000, salesAmount: 1500000, attainmentPct: 107.1, inQuota: true },
      { sellerUserId: 2, sellerUserName: "Bruno Ruiz", quotaAmount: 1400000, salesAmount: 557500, attainmentPct: 39.8, inQuota: false },
    ],
    sellersInQuota: 1,
    newClients: { amount: 100000, requiredAmount: 280000, clientMinAmount: 18760, qualifyingClients: 1, requiredClients: 3, amountMet: false, clientsMet: false, met: false },
    existingAccounts: { available: false, growthPct: null, met: null, currentAmount: 1957500, baselineAmount: null },
    warnings: [
      { code: "no_baseline", message: "No hay planeación comparable de T4 2025; el crecimiento de cuentas actuales no se puede evaluar." },
      ...(rules.validated ? [] : [{ code: "rules_unvalidated", message: "Las reglas de pago están pendientes de validar con la carta de compensación." }]),
    ],
    sales,
  };
}

async function open(page, { permissions = ["variable_comercial.read"], payload = okPayload(), fail = false } = {}) {
  const state = { puts: [], gets: [], payload, fail };
  await page.addInitScript(() => localStorage.setItem("crm_token", "variable-test"));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/auth/bootstrap-status") return route.fulfill({ json: { hasUsers: true } });
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { id: 7, full_name: "Dirección", permissions, businessTimezone: "America/Mexico_City" } });
    if (url.pathname === "/api/variable-compensation/rules" && request.method() === "PUT") {
      state.puts.push(request.postDataJSON());
      state.payload = okPayload(rulesState({ ...request.postDataJSON(), isDefault: false, version: 1, updatedByName: "Dirección" }));
      return route.fulfill({ json: state.payload.rules });
    }
    if (url.pathname === "/api/variable-compensation") {
      state.gets.push(url.search);
      if (state.fail) return route.fulfill({ status: 500, json: { message: "Fallo temporal" } });
      return route.fulfill({ json: state.payload });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/variable-compensation");
  return state;
}

test("muestra el variable, los cinco componentes y las advertencias", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("heading", { name: "Variable comercial" }).first()).toBeVisible();
  await expect(page.getByLabel("Variable del trimestre").first()).toContainText("$62,564 MXN");
  for (const name of ["Cuota de venta", "Margen promedio", "Equipo en cuota", "Clientes nuevos", "Cuentas actuales"]) {
    await expect(page.getByRole("article", { name })).toBeVisible();
  }
  await expect(page.getByRole("article", { name: "Equipo en cuota" })).toContainText("Se activa con 80% de la cuota");
  await expect(page.getByRole("article", { name: "Cuentas actuales" })).toContainText("Sin base");
  await expect(page.getByText("pendientes de validar con la carta")).toBeVisible();
  await expect(page.getByText("2 venta(s) ganada(s) por aceptar")).toBeVisible();
  await expect(page.getByText("Día 37 de 92 · 55 días restantes")).toBeVisible();
});

test("el simulador recalcula con la misma fórmula", async ({ page }) => {
  await open(page);
  const output = page.locator(".vc-sim-output");
  const simulator = page.locator(".vc-simulator");
  await simulator.getByLabel(/Cuota alcanzada/).fill("100");
  await simulator.getByLabel(/Margen promedio/).fill("35");
  await expect(output).toContainText("$130,000 MXN");
  await simulator.getByLabel(/Cuota alcanzada/).fill("60");
  await expect(output).toContainText("$0 MXN");
  await expect(output).toContainText("Bajo el piso");
});

test("filtra la tabla de ventas y marca clientes nuevos y márgenes bajos", async ({ page }) => {
  await open(page);
  const rows = page.locator(".vc-table tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(page.getByText("Margen bajo").first()).toBeVisible();
  await page.getByLabel("Solo clientes nuevos").check();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Aurora Textil");
  await page.getByLabel("Solo clientes nuevos").uncheck();
  await page.locator(".vc-filters select").nth(1).selectOption("renewals");
  await expect(rows).toHaveCount(1);
  await page.locator(".vc-filters select").nth(1).selectOption("");
  await page.locator(".vc-filters select").first().selectOption("2");
  await expect(page.getByRole("status").filter({ hasText: "ventas" })).toContainText("2 de 3 ventas");
});

test("cambia de trimestre y pide el periodo elegido", async ({ page }) => {
  const state = await open(page);
  await expect(page.getByLabel("Variable del trimestre").first()).toBeVisible();
  await page.getByRole("button", { name: "T2" }).click();
  await expect.poll(() => state.gets.at(-1)).toContain("quarter=2");
  await page.getByRole("button", { name: "Año anterior" }).click();
  await expect.poll(() => state.gets.at(-1)).toContain("year=2025");
});

test("permite reintentar si falla el cálculo", async ({ page }) => {
  const state = await open(page, { fail: true });
  await expect(page.getByRole("alert")).toContainText("Fallo temporal");
  state.fail = false;
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByLabel("Variable del trimestre").first()).toContainText("$62,564 MXN");
});

test("avisa cuando el trimestre no tiene planeación ni cuotas", async ({ page }) => {
  await open(page, { payload: { status: "no_planning", period: { year: 2026, quarter: 4 }, rules: rulesState() } });
  await expect(page.getByText("No hay planeación comercial para T4 2026")).toBeVisible();
});

test("las reglas son de solo lectura sin permiso de edición", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Reglas de pago" }).click();
  await expect(page.getByText("Solo consulta: no tienes permiso para editar las reglas.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar reglas" })).toHaveCount(0);
  await expect(page.getByLabel("Tope trimestral")).toBeDisabled();
});

test("edita y valida las reglas con control de versión", async ({ page }) => {
  const state = await open(page, { permissions: ["variable_comercial.update"] });
  await page.getByRole("button", { name: "Reglas de pago" }).click();
  await page.getByLabel("Tope trimestral").fill("300000");
  await page.getByLabel(/validadas contra la carta/).check();
  await page.getByRole("button", { name: "Guardar reglas" }).click();
  await expect.poll(() => state.puts.length).toBe(1);
  expect(state.puts[0]).toMatchObject({ validated: true, version: 0, rules: { quarterlyCap: 300000 } });
  await expect(page.getByText("pendientes de validar con la carta")).toHaveCount(0);
});

test("rechaza reglas inválidas sin enviarlas", async ({ page }) => {
  const state = await open(page, { permissions: ["variable_comercial.update"] });
  await page.getByRole("button", { name: "Reglas de pago" }).click();
  await page.getByLabel("Margen para pago parcial (%)").fill("40");
  await page.getByRole("button", { name: "Guardar reglas" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "margen parcial" })).toBeVisible();
  expect(state.puts).toHaveLength(0);
});

test("sin permiso no aparece en el menú y la ruta redirige", async ({ page }) => {
  await open(page, { permissions: ["oportunidades.read"] });
  await expect(page.getByRole("link", { name: "Variable comercial" })).toHaveCount(0);
  await expect(page).not.toHaveURL(/variable-compensation/);
});
