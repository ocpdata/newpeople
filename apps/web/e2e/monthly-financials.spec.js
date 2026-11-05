import { expect, test } from "@playwright/test";
import { MONTHLY_FINANCIAL_FIELDS } from "../../../shared/monthly-financials.js";

const blank = () => Object.fromEntries(MONTHLY_FINANCIAL_FIELDS.map((key) => [key, null]));
const record = (month, values = {}, extra = {}) => ({
  ...blank(), ...values, month, year: 2026, currencyCode: "MXN", version: 1,
  updatedAt: "2026-06-05T18:00:00Z", updatedByName: "Contabilidad", ...extra,
});
const currencies = [{ code: "MXN", name: "Peso mexicano" }, { code: "USD", name: "Dólar" }];

async function open(page, options = {}) {
  const permissions = options.permissions ?? ["informacion_financiera.update"];
  const state = {
    records: options.records ?? [], requests: [], urls: [], failSave: false, failLoad: Boolean(options.failLoad), conflictMonths: [],
  };
  await page.addInitScript(() => localStorage.setItem("crm_token", "financial-test"));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/api/auth/bootstrap-status") return route.fulfill({ json: { hasUsers: true } });
    if (pathname === "/api/auth/me") return route.fulfill({ json: { id: 501, full_name: "Finanzas", permissions, businessTimezone: "America/Mexico_City" } });
    if (pathname === "/api/monthly-financials/currencies") return route.fulfill({ json: options.currencies ?? currencies });
    if (pathname.startsWith("/api/monthly-financials/")) {
      state.urls.push(`${request.method()} ${pathname}`);
      if (request.method() === "GET") {
        if (state.failLoad) return route.fulfill({ status: 500, json: { message: "Fallo de carga" } });
        return route.fulfill({ json: { year: 2026, records: state.records } });
      }
      const { months } = request.postDataJSON();
      state.requests.push(months);
      if (state.failSave) return route.fulfill({ status: 500, json: { message: "Fallo temporal de guardado" } });
      if (state.conflictMonths.length) {
        return route.fulfill({ status: 409, json: {
          message: "Otra persona modificó este periodo.",
          conflicts: state.conflictMonths.map((month) => ({ month, record: state.records.find((item) => item.month === month) ?? null })),
        } });
      }
      for (const item of months) {
        const { month, ...values } = item;
        const previous = state.records.find((candidate) => candidate.month === month);
        const saved = record(month, Object.fromEntries(MONTHLY_FINANCIAL_FIELDS.map((key) => [key, values[key] == null ? null : Number(values[key]).toFixed(2)])),
          { currencyCode: values.currencyCode, version: values.version + 1, updatedByName: "Finanzas" });
        state.records = [...state.records.filter((candidate) => candidate !== previous), saved].sort((a, b) => a.month - b.month);
      }
      return route.fulfill({ json: { year: 2026, records: state.records } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/monthly-financials");
  if (permissions.length) {
    await expect(page.getByRole("heading", { name: "Información financiera mensual" })).toBeVisible();
    await expect(page.getByText("Cargando información del año…")).toHaveCount(0);
  }
  return state;
}

const cell = (page, concept, month) => page.getByLabel(`${concept}, ${month}`, { exact: true });
const save = (page) => page.getByRole("button", { name: "Guardar cambios" });
const currency = (page) => page.getByLabel("Moneda del año");
const saved = (page) => page.getByText("Guardado", { exact: true });
const totalRow = (page, name) => page.getByRole("row", { name: new RegExp(`^${name}`) }).first();
const paste = (locator, text) => locator.evaluate((element, value) => {
  const data = new DataTransfer();
  data.setData("text", value);
  element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
}, text);

test("muestra el año completo con doce meses, cuatro secciones y una sola acción de guardado", async ({ page }) => {
  await open(page);
  await expect(page.locator(".monthly-financial-grid thead .mf-month abbr")).toHaveText(["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]);
  await expect(page.locator(".monthly-financial-grid .mf-band th")).toHaveText(["Ventas y compras", "Gastos generales", "Otros ingresos y gastos", "Porcentajes"]);
  await expect(page.locator(".monthly-financial-grid tbody input")).toHaveCount(13 * 12);
  await expect(page.getByRole("button", { name: "Guardar cambios" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Año completo" })).toHaveAttribute("aria-pressed", "true");
  await expect(cell(page, "Compras", "Enero")).toHaveValue("");
});

test("guarda solo los meses modificados, mantiene vacío distinto de cero y calcula subtotales", async ({ page }) => {
  const state = await open(page);
  await currency(page).selectOption("MXN");
  await cell(page, "Compras", "Enero").fill("0");
  await cell(page, "Gastos de venta", "Marzo").fill("1234.50");
  await save(page).click();
  await expect(saved(page)).toBeVisible();
  expect(state.requests).toHaveLength(1);
  expect(state.requests[0].map((item) => item.month)).toEqual([1, 3]);
  expect(state.requests[0][0]).toMatchObject({ month: 1, purchases: "0", salesDiscounts: null, currencyCode: "MXN", version: 0 });
  expect(state.requests[0][1]).toMatchObject({ month: 3, sellingExpenses: "1234.50", purchases: null, version: 0 });
  await expect(cell(page, "Compras", "Enero")).toHaveValue("0.00");
  await expect(cell(page, "Compras", "Febrero")).toHaveValue("");
  await expect(cell(page, "Gastos de venta", "Marzo")).toHaveValue("1,234.50");
  await expect(page.locator(".mf-month small").nth(0)).toHaveText("1/13");
  await expect(page.locator(".mf-month small").nth(1)).toHaveText("Sin datos");
  const expenses = totalRow(page, "Total de gastos generales").locator("td");
  await expect(expenses.nth(2)).toContainText("1,234.50");
  await expect(expenses.nth(2)).toContainText("parcial");
  await expect(expenses.nth(12)).toContainText("parcial");
  await expect(page.getByText("Última modificación:", { exact: false })).toContainText("Finanzas");
});

test("el total de un mes es completo solo con todos sus componentes registrados", async ({ page }) => {
  await open(page);
  for (const [concept, value] of [["Gastos de venta", "0.10"], ["Gastos de administración", "0.20"], ["Depreciación de planta y equipo", "0"], ["Amortización de gastos diferidos", "0"]]) {
    await cell(page, concept, "Enero").fill(value);
  }
  const january = totalRow(page, "Total de gastos generales").locator("td").nth(0);
  await expect(january).toContainText("0.30");
  await expect(january).not.toContainText("parcial");
  await expect(totalRow(page, "Total de otros ingresos").locator("td").nth(0)).toHaveText("—");
});

test("pega rangos desde Excel, y rechaza pegados inválidos o fuera de la tabla sin cambiar nada", async ({ page }) => {
  const state = await open(page);
  await paste(cell(page, "Descuentos sobre ventas", "Enero"), "10\t20\t30\n5\t\t7\n");
  await expect(cell(page, "Descuentos sobre ventas", "Marzo")).toHaveValue("30.00");
  await expect(cell(page, "Devoluciones sobre ventas", "Enero")).toHaveValue("5.00");
  await expect(cell(page, "Devoluciones sobre ventas", "Febrero")).toHaveValue("");
  await expect(page.getByText("Se pegaron 6 celdas")).toBeVisible();
  await paste(cell(page, "Compras", "Enero"), "1\tabc");
  await expect(page.getByRole("alert").filter({ hasText: '"abc" no es válido en Compras, Febrero' })).toBeVisible();
  await expect(cell(page, "Compras", "Enero")).toHaveValue("");
  await paste(cell(page, "Compras", "Diciembre"), "1\t2");
  await expect(page.getByRole("alert").filter({ hasText: "excede la tabla" })).toBeVisible();
  await expect(cell(page, "Compras", "Diciembre")).toHaveValue("");
  expect(state.requests).toHaveLength(0);
});

test("repite una tasa solo en los meses vacíos siguientes, sin sobrescribir", async ({ page }) => {
  await open(page);
  await cell(page, "ISR (%)", "Enero").fill("30");
  await cell(page, "ISR (%)", "Abril").fill("25");
  await page.getByRole("button", { name: "Repetir ISR (%) en los meses vacíos siguientes" }).click();
  await expect(cell(page, "ISR (%)", "Febrero")).toHaveValue("30.00");
  await expect(cell(page, "ISR (%)", "Marzo")).toHaveValue("30.00");
  await expect(cell(page, "ISR (%)", "Abril")).toHaveValue("25.00");
  await expect(cell(page, "ISR (%)", "Diciembre")).toHaveValue("25.00");
  await expect(cell(page, "PTU (%)", "Febrero")).toHaveValue("");
});

test("Enter y las flechas mueven la captura entre conceptos del mismo mes", async ({ page }) => {
  await open(page);
  await cell(page, "Descuentos sobre ventas", "Mayo").focus();
  await page.keyboard.press("Enter");
  await expect(cell(page, "Devoluciones sobre ventas", "Mayo")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(cell(page, "Compras", "Mayo")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(cell(page, "Devoluciones sobre ventas", "Mayo")).toBeFocused();
  await expect(page.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
});

test("valida celdas y moneda sin enviar y lleva a la primera celda con error", async ({ page }) => {
  const state = await open(page);
  await cell(page, "Compras", "Febrero").fill("-1");
  await cell(page, "ISR (%)", "Marzo").fill("100.01");
  await save(page).click();
  await expect(page.getByRole("alert").filter({ hasText: "Revisa 2 celdas" })).toBeVisible();
  await expect(cell(page, "Compras", "Febrero")).toHaveAttribute("aria-invalid", "true");
  await expect(cell(page, "Compras", "Febrero")).toBeFocused();
  await cell(page, "Compras", "Febrero").fill("5");
  await cell(page, "ISR (%)", "Marzo").fill("30");
  await save(page).click();
  await expect(page.locator("small.monthly-financial-error")).toHaveText("Selecciona la moneda del año.");
  await expect(currency(page)).toHaveAttribute("aria-invalid", "true");
  expect(state.requests).toHaveLength(0);
});

test("preselecciona la moneda cuando solo existe una activa", async ({ page }) => {
  await open(page, { currencies: [currencies[0]] });
  await expect(currency(page)).toHaveValue("MXN");
});

test("un error de guardado conserva toda la captura y permite reintentar", async ({ page }) => {
  const state = await open(page);
  state.failSave = true;
  await currency(page).selectOption("MXN");
  await cell(page, "Compras", "Enero").fill("123.45");
  await cell(page, "Compras", "Junio").fill("9");
  await save(page).click();
  await expect(page.getByRole("alert").filter({ hasText: "Fallo temporal" })).toBeVisible();
  await expect(cell(page, "Compras", "Enero")).toHaveValue("123.45");
  await expect(cell(page, "Compras", "Junio")).toHaveValue("9.00");
  state.failSave = false;
  await save(page).click();
  await expect(saved(page)).toBeVisible();
  expect(state.requests).toHaveLength(2);
});

test("un fallo de consulta no se presenta como un año vacío y permite recargar", async ({ page }) => {
  const state = await open(page, { failLoad: true });
  await expect(page.getByRole("alert")).toContainText("Fallo de carga");
  await expect(page.getByRole("region", { name: "Tabla anual de información financiera" })).toHaveCount(0);
  state.failLoad = false;
  await page.getByRole("button", { name: "Reintentar carga" }).click();
  await expect(page.getByRole("region", { name: "Tabla anual de información financiera" })).toBeVisible();
});

test("un conflicto en un mes conserva todo, compara solo ese mes y permite guardar el resto", async ({ page }) => {
  const state = await open(page, { records: [record(1, { purchases: "10.00" }), record(2, { purchases: "20.00" })] });
  await cell(page, "Compras", "Enero").fill("11");
  await cell(page, "Compras", "Febrero").fill("21");
  state.records = [record(1, { purchases: "10.00" }), record(2, { purchases: "99.00" }, { version: 2 })];
  state.conflictMonths = [2];
  await save(page).click();
  const panel = page.getByRole("alert").filter({ hasText: "Hay una versión más reciente" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Febrero" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Enero" })).toHaveCount(0);
  await expect(panel.getByRole("row", { name: /Compras/ })).toContainText("21.00");
  await expect(panel.getByRole("row", { name: /Compras/ })).toContainText("99.00");
  await expect(save(page)).toBeDisabled();
  await expect(cell(page, "Compras", "Enero")).toHaveValue("11.00");
  page.once("dialog", (dialog) => dialog.dismiss());
  await panel.getByRole("button", { name: "Cargar versión actual" }).click();
  await expect(cell(page, "Compras", "Febrero")).toHaveValue("21.00");
  page.once("dialog", (dialog) => dialog.accept());
  await panel.getByRole("button", { name: "Cargar versión actual" }).click();
  await expect(cell(page, "Compras", "Febrero")).toHaveValue("99.00");
  await expect(cell(page, "Compras", "Enero")).toHaveValue("11.00");
  state.conflictMonths = [];
  await save(page).click();
  await expect(saved(page)).toBeVisible();
  expect(state.requests.at(-1)).toHaveLength(1);
  expect(state.requests.at(-1)[0]).toMatchObject({ month: 1, purchases: "11", version: 1 });
});

test("advierte al cambiar de año o navegar con cambios sin guardar", async ({ page }) => {
  const state = await open(page);
  const year = Number(await page.locator(".mf-year strong").innerText());
  await cell(page, "Compras", "Enero").fill("10");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Año anterior" }).click();
  await expect(page.locator(".mf-year strong")).toHaveText(String(year));
  await expect(cell(page, "Compras", "Enero")).toHaveValue("10.00");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator(".sidebar").getByRole("link", { name: "Inicio", exact: true }).click();
  await expect(page).toHaveURL(/monthly-financials/);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Año anterior" }).click();
  await expect(page.locator(".mf-year strong")).toHaveText(String(year - 1));
  await expect(cell(page, "Compras", "Enero")).toHaveValue("");
  expect(state.urls.at(-1)).toBe(`GET /api/monthly-financials/${year - 1}`);
});

test("cambiar la moneda exige confirmar y reenvía solo los meses con registro", async ({ page }) => {
  const state = await open(page, { records: [record(2, { purchases: "20.00" }), record(5, { purchases: "50.00" })] });
  await expect(currency(page)).toHaveValue("MXN");
  await currency(page).selectOption("USD");
  page.once("dialog", async (dialog) => { expect(dialog.message()).toContain("no convierte"); await dialog.dismiss(); });
  await save(page).click();
  expect(state.requests).toHaveLength(0);
  page.once("dialog", (dialog) => dialog.accept());
  await save(page).click();
  await expect(saved(page)).toBeVisible();
  expect(state.requests[0].map((item) => [item.month, item.currencyCode, item.version, item.purchases])).toEqual([[2, "USD", 1, "20.00"], [5, "USD", 1, "50.00"]]);
});

test("un año con monedas mezcladas no calcula totales hasta unificar la moneda", async ({ page }) => {
  const state = await open(page, { records: [record(1, { purchases: "10.00" }), record(2, { purchases: "20.00" }, { currencyCode: "USD" })] });
  await expect(page.getByRole("alert").filter({ hasText: "monedas distintas" })).toBeVisible();
  await expect(currency(page)).toHaveValue("");
  await expect(save(page)).toBeDisabled();
  await expect(page.getByRole("row", { name: /^Compras/ }).locator("td").nth(12)).toHaveText("—");
  await currency(page).selectOption("MXN");
  await expect(save(page)).toBeEnabled();
  page.once("dialog", (dialog) => dialog.accept());
  await save(page).click();
  await expect(saved(page)).toBeVisible();
  expect(state.requests[0].map((item) => [item.month, item.currencyCode])).toEqual([[2, "MXN"]]);
});

test("la vista de un mes edita los mismos datos y se guarda con el año", async ({ page }) => {
  const state = await open(page);
  await currency(page).selectOption("MXN");
  await page.getByRole("button", { name: "Un mes" }).click();
  await page.getByLabel("Mes", { exact: true }).selectOption("3");
  await page.getByLabel("Compras", { exact: true }).fill("50");
  await page.getByLabel("Compras", { exact: true }).blur();
  await expect(page.getByLabel("Compras", { exact: true })).toHaveValue("50.00");
  await page.getByRole("button", { name: "Año completo" }).click();
  await expect(cell(page, "Compras", "Marzo")).toHaveValue("50.00");
  await save(page).click();
  await expect(saved(page)).toBeVisible();
  expect(state.requests[0].map((item) => item.month)).toEqual([3]);
});

test("permiso de consulta ve el año completo, pero no puede editarlo", async ({ page }) => {
  await open(page, { permissions: ["informacion_financiera.read"], records: [record(1, { purchases: "1234.50" })] });
  await expect(cell(page, "Compras", "Enero")).toHaveValue("1,234.50");
  await expect(cell(page, "Compras", "Enero")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Repetir ISR (%) en los meses vacíos siguientes" })).toBeDisabled();
  await expect(save(page)).toHaveCount(0);
  await expect(currency(page)).toBeDisabled();
  await expect(page.getByText("Solo consulta")).toBeVisible();
});

test("sin permisos oculta el enlace y no consulta datos", async ({ page }) => {
  let calls = 0;
  page.on("request", (request) => { if (request.url().includes("/api/monthly-financials")) calls += 1; });
  await open(page, { permissions: [] });
  await expect(page.getByRole("alert")).toContainText("No tienes permiso");
  await expect(page.locator(".sidebar").getByRole("link", { name: "Información financiera mensual" })).toHaveCount(0);
  expect(calls).toBe(0);
});

test("la tabla anual se desplaza dentro de su contenedor y conserva fijos los conceptos", async ({ page }) => {
  await open(page);
  const region = page.getByRole("region", { name: "Tabla anual de información financiera" });
  expect(await region.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.locator(".monthly-financials").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await region.evaluate((element) => { element.scrollLeft = 700; });
  const label = await page.locator(".monthly-financial-grid tbody .mf-label").nth(1).boundingBox();
  const wrap = await region.boundingBox();
  expect(Math.abs(label.x - wrap.x)).toBeLessThan(3);
});

test("en móvil inicia en la vista de un mes sin desbordamiento horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(page.getByRole("button", { name: "Un mes" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Compras", { exact: true })).toBeVisible();
  await expect(save(page)).toBeVisible();
  expect(await page.locator(".monthly-financials").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
