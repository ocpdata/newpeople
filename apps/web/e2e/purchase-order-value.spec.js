import { expect, test } from "@playwright/test";

async function openProcessing(page, { selected = true, canUpdate = true, failRegistration = false, failRemoval = false } = {}) {
  let value = { amount: null, currencyCode: null };
  let orderIds = selected ? [20] : [];
  const additionalValues = {};
  const registrations = [];
  const removals = [];
  const closingDocuments = () => {
    const orders = orderIds.map((id) => ({
      documentId: id, source: id === 20 ? "quotation" : "opportunity",
      originalFileName: id === 20 ? "orden-cliente.pdf" : "otro-documento.pdf",
      ...(id === 20 ? value : additionalValues[id] || { amount: null, currencyCode: null }),
    }));
    return {
    quotationDocuments: [{ documentId: 20, originalFileName: "orden-cliente.pdf" }],
    opportunityDocuments: [{ documentId: 21, originalFileName: "otro-documento.pdf" }],
    savedSelections: {
      purchaseOrder: orders[0] || null,
      purchaseOrders: orders,
      providerQuotes: [{ documentId: 30, source: "quotation", originalFileName: "proveedor.pdf" }],
    },
    };
  };
  await page.addInitScript(() => window.localStorage.setItem("crm_token", "order-test"));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/bootstrap-status") return route.fulfill({ json: { hasUsers: true } });
    if (url.pathname === "/api/auth/me") return route.fulfill({
      json: { id: 501, full_name: "Usuario", permissions: [canUpdate ? "aceptar_pedido.procesamiento.update" : "aceptar_pedido.procesamiento.read"] },
    });
    if (url.pathname === "/api/quotations") return route.fulfill({ json: [{
      id: 1, latestVersionId: 10, latestVersionNumber: 1, latestProposalName: "Proyecto OC",
      latestStatusCode: "aceptada", latestStatusName: "Aceptada",
      latestCurrencyCode: "USD", activationStatusCode: "activada",
    }] });
    if (url.pathname === "/api/quotations/1/processing") return route.fulfill({
      json: { quotation: {}, permissions: { canUpdate },
        stages: [{ stageCode: "quotation_accepted", stageName: "Cotización aceptada", status: "completed", stageData: {} }] },
    });
    if (/\/won-documents\/(quotation|opportunity)\/\d+$/.test(url.pathname) && route.request().method() === "DELETE") {
      removals.push(url.pathname);
      if (failRemoval) return route.fulfill({ status: 500, json: { message: "Error al quitar la orden" } });
      const id = Number(url.pathname.split("/").at(-1));
      orderIds = orderIds.filter((item) => item !== id);
      if (id === 20) value = { amount: null, currencyCode: null };
      else delete additionalValues[id];
      return route.fulfill({ json: { message: "Orden de compra retirada del cierre" } });
    }
    if (url.pathname === "/api/quotation-versions/10/won-documents/purchase-orders") {
        registrations.push(route.request().postDataJSON());
        if (failRegistration) return route.fulfill({ status: 500, json: { message: "Error al registrar documento" } });
        orderIds.push(route.request().postDataJSON().documentId);
      return route.fulfill({ json: closingDocuments() });
    }
    if (url.pathname === "/api/quotation-versions/10/won-documents") {
      return route.fulfill({ json: closingDocuments() });
    }
    if (url.pathname === "/api/purchase-order-currencies") return route.fulfill({
      json: [{ code: "USD", name: "Dólar" }, { code: "MXN", name: "Peso mexicano" }],
    });
    if (url.pathname.endsWith("/quotation/20/value") && route.request().method() === "PATCH") {
      value = route.request().postDataJSON();
      return route.fulfill({ json: value });
    }
    if (url.pathname.endsWith("/opportunity/21/value") && route.request().method() === "PATCH") {
      additionalValues[21] = route.request().postDataJSON();
      return route.fulfill({ json: additionalValues[21] });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/accept-order");
  await page.getByRole("cell", { name: "Proyecto OC", exact: true }).click();
  return { registrations, removals, value: () => value };
}

test("guarda el importe y moneda por orden y los recupera al reabrir procesamiento", async ({ page }) => {
  const state = await openProcessing(page);
  await expect(page.getByText("orden-cliente.pdf", { exact: true })).toBeVisible();
  await page.getByLabel("Valor de la orden de compra", { exact: true }).fill("12345.67");
  await page.getByLabel("Moneda de la orden de compra", { exact: true }).selectOption("MXN");
  await page.getByRole("button", { name: "Guardar valor de orden", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Valor de orden de compra guardado.");
  expect(state.value()).toEqual({ amount: 12345.67, currencyCode: "MXN" });
  await page.getByRole("button", { name: "Cerrar procesamiento", exact: true }).click();
  await page.getByRole("cell", { name: "Proyecto OC", exact: true }).click();
  await expect(page.getByLabel("Valor de la orden de compra", { exact: true })).toHaveValue("12345.67");
  await expect(page.getByLabel("Moneda de la orden de compra", { exact: true })).toHaveValue("MXN");
});

test("agrupa archivo, importe y acciones por orden y adapta los campos al ancho disponible", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openProcessing(page);
  const card = page.getByRole("group", { name: "Orden de compra: orden-cliente.pdf", exact: true });
  const amount = card.getByLabel("Valor de la orden de compra", { exact: true });
  const currency = card.getByLabel("Moneda de la orden de compra", { exact: true });
  await expect(page.getByRole("heading", { name: "Órdenes de compra (1)", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Descargar documento", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Guardar valor de orden", exact: true })).toHaveText("Guardar valor");
  await expect(card.getByRole("button", { name: "Quitar orden de compra del cierre", exact: true })).toHaveText("Quitar del cierre");
  const desktopAmount = await amount.boundingBox();
  const desktopCurrency = await currency.boundingBox();
  expect(Math.abs(desktopAmount.y - desktopCurrency.y)).toBeLessThan(2);
  expect(desktopCurrency.x).toBeGreaterThan(desktopAmount.x + desktopAmount.width);
  await card.screenshot({ path: testInfo.outputPath("orden-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await currency.scrollIntoViewIfNeeded();
  const mobileCard = await card.boundingBox();
  const mobileAmount = await amount.boundingBox();
  const mobileCurrency = await currency.boundingBox();
  expect(mobileCurrency.y).toBeGreaterThan(mobileAmount.y + mobileAmount.height);
  expect(mobileCurrency.x + mobileCurrency.width).toBeLessThanOrEqual(mobileCard.x + mobileCard.width);
  expect(mobileCard.width).toBeLessThanOrEqual(390);
  await card.screenshot({ path: testInfo.outputPath("orden-mobile.png") });
});

test("registra una orden ya cargada sin subirla nuevamente ni perder cotizaciones proveedor", async ({ page }) => {
  const state = await openProcessing(page, { selected: false });
  await expect(page.getByLabel("Archivo de orden de compra")).toBeVisible();
  await page.getByLabel("Archivo de orden de compra").selectOption("quotation:20");
  await page.getByRole("button", { name: "Registrar orden de compra", exact: true }).click();
  await expect(page.getByText("orden-cliente.pdf", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Valor de la orden de compra", { exact: true })).toBeVisible();
  expect(state.registrations).toEqual([{ source: "quotation", documentId: 20 }]);
  await page.getByRole("button", { name: "Cerrar procesamiento", exact: true }).click();
  await page.getByRole("cell", { name: "Proyecto OC", exact: true }).click();
  await expect(page.getByText("orden-cliente.pdf", { exact: true })).toBeVisible();
});

test("no permite registrar órdenes con acceso solo de consulta", async ({ page }) => {
  await openProcessing(page, { selected: false, canUpdate: false });
  await expect(page.getByLabel("Archivo de orden de compra")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Registrar orden de compra", exact: true })).toHaveCount(0);
});

test("muestra errores al registrar sin presentar el documento como guardado", async ({ page }) => {
  await openProcessing(page, { selected: false, failRegistration: true });
  await page.getByLabel("Archivo de orden de compra").selectOption("quotation:20");
  await page.getByRole("button", { name: "Registrar orden de compra", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Error al registrar documento");
  await expect(page.getByLabel("Valor de la orden de compra", { exact: true })).toHaveCount(0);
});

test("quita la orden y su valor conservando el archivo disponible y las cotizaciones proveedor", async ({ page }) => {
  const state = await openProcessing(page);
  await page.getByLabel("Valor de la orden de compra", { exact: true }).fill("1500");
  await page.getByLabel("Moneda de la orden de compra", { exact: true }).selectOption("MXN");
  await page.getByRole("button", { name: "Guardar valor de orden", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Valor de orden de compra guardado.");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Quitar orden de compra del cierre", exact: true }).click();
  await expect(page.getByLabel("Archivo de orden de compra")).toBeVisible();
  expect(state.removals).toHaveLength(1);
  await expect(page.getByText("proveedor.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar procesamiento", exact: true }).click();
  await page.getByRole("cell", { name: "Proyecto OC", exact: true }).click();
  await expect(page.getByLabel("Archivo de orden de compra")).toBeVisible();
  await page.getByLabel("Archivo de orden de compra").selectOption("quotation:20");
  await page.getByRole("button", { name: "Registrar orden de compra", exact: true }).click();
  await expect(page.getByLabel("Valor de la orden de compra", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Moneda de la orden de compra", { exact: true })).toHaveValue("");
  await expect(page.getByText("proveedor.pdf", { exact: true })).toBeVisible();
});

test("cancelar la confirmacion no quita la orden", async ({ page }) => {
  const state = await openProcessing(page);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Quitar orden de compra del cierre", exact: true }).click();
  await expect(page.getByLabel("Valor de la orden de compra", { exact: true })).toBeVisible();
  expect(state.removals).toHaveLength(0);
});

test("un error al quitar mantiene la orden visible", async ({ page }) => {
  await openProcessing(page, { failRemoval: true });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Quitar orden de compra del cierre", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Error al quitar la orden");
  await expect(page.getByLabel("Valor de la orden de compra", { exact: true })).toBeVisible();
});

test("no muestra quitar orden a usuarios de consulta", async ({ page }) => {
  await openProcessing(page, { canUpdate: false });
  await expect(page.getByLabel("Valor de la orden de compra", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Quitar orden de compra del cierre", exact: true })).toHaveCount(0);
});

test("mantiene varias ordenes con valores independientes y quita solo la elegida", async ({ page }) => {
  await openProcessing(page);
  const first = page.getByRole("group", { name: "Orden de compra: orden-cliente.pdf", exact: true });
  await first.getByLabel("Valor de la orden de compra", { exact: true }).fill("1500");
  await first.getByLabel("Moneda de la orden de compra", { exact: true }).selectOption("USD");
  await first.getByRole("button", { name: "Guardar valor de orden", exact: true }).click();
  await expect(first.getByRole("status")).toContainText("Valor de orden de compra guardado.");
  await expect(page.getByLabel("Archivo de orden de compra").locator('option[value="quotation:20"]')).toHaveCount(0);
  await page.getByLabel("Archivo de orden de compra").selectOption("opportunity:21");
  await page.getByRole("button", { name: "Registrar orden de compra", exact: true }).click();
  const second = page.getByRole("group", { name: "Orden de compra: otro-documento.pdf", exact: true });
  await second.getByLabel("Valor de la orden de compra", { exact: true }).fill("3000");
  await second.getByLabel("Moneda de la orden de compra", { exact: true }).selectOption("MXN");
  await second.getByRole("button", { name: "Guardar valor de orden", exact: true }).click();
  await expect(second.getByRole("status")).toContainText("Valor de orden de compra guardado.");
  await page.getByRole("button", { name: "Cerrar procesamiento", exact: true }).click();
  await page.getByRole("cell", { name: "Proyecto OC", exact: true }).click();
  await expect(first.getByLabel("Valor de la orden de compra", { exact: true })).toHaveValue("1500");
  await expect(first.getByLabel("Moneda de la orden de compra", { exact: true })).toHaveValue("USD");
  await expect(second.getByLabel("Valor de la orden de compra", { exact: true })).toHaveValue("3000");
  await expect(second.getByLabel("Moneda de la orden de compra", { exact: true })).toHaveValue("MXN");
  page.once("dialog", (dialog) => dialog.accept());
  await first.getByRole("button", { name: "Quitar orden de compra del cierre", exact: true }).click();
  await expect(first).toHaveCount(0);
  await expect(second.getByLabel("Valor de la orden de compra", { exact: true })).toHaveValue("3000");
  await expect(page.getByText("proveedor.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar procesamiento", exact: true }).click();
  await page.getByRole("cell", { name: "Proyecto OC", exact: true }).click();
  await expect(first).toHaveCount(0);
  await expect(second.getByLabel("Valor de la orden de compra", { exact: true })).toHaveValue("3000");
});
