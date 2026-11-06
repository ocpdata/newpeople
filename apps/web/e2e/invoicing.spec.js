import { expect, test } from "@playwright/test";

const quotation = {
  id: 1, accountId: 7, accountName: "Cliente prefacturas",
  latestCurrencyCode: "USD", latestBaseSaleTotal: 1000, latestTotalSaleAmount: 1000,
};
const items = [{ quotationId: 1, items: [{
  productId: 11, code: "SERVICIO", description: "Servicio de prueba", quantity: 4,
  unitCostWithDiscount: 100,
}] }];

function withMoney(document) {
  const subtotal = document.subtotal ?? document.quotationItems.flatMap((entry) => entry.items)
    .reduce((sum, item) => sum + item.quantity * item.unitCostWithDiscount, 0);
  const ivaAmount = document.ivaAmount ?? Math.round(subtotal * 16) / 100;
  const totalAmount = document.totalAmount ?? subtotal + ivaAmount;
  return { ...document, subtotal, ivaAmount, totalAmount,
    totalUsd: Math.round(totalAmount / document.exchangeRate * 100) / 100 };
}

async function openInvoicing(page, { documents = [], failCreate = false, failConvert = false, failLoad = false,
  currency = "USD", failRate = false } = {}) {
  let stored = structuredClone(documents);
  const creates = [];
  const conversions = [];
  const deletions = [];
  await page.addInitScript(() => window.localStorage.setItem("crm_token", "invoice-test"));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/bootstrap-status") return route.fulfill({ json: { hasUsers: true } });
    if (path === "/api/auth/me") return route.fulfill({
      json: { id: 501, full_name: "Usuario", permissions: ["aceptar_pedido.procesamiento.update"] },
    });
    if (path === "/api/quotations") return route.fulfill({ json: [{ ...quotation, latestCurrencyCode: currency }] });
    if (path === "/api/quotations/1/processing") return route.fulfill({
      json: { quotation: { accountName: quotation.accountName, currencyCode: currency, products: [
        { id: 11, code: "SERVICIO", description: "Servicio de prueba", quantity: 10, unitCostWithDiscount: 100 },
      ] } },
    });
    if (path === "/api/quotation-invoices/exchange-rate") return route.fulfill(failRate
      ? { status: 502, json: { message: "Proveedor no disponible. Ingresa el tipo de cambio manualmente." } }
      : { json: { baseCurrency: "USD", targetCurrency: currency, exchangeRate: 20,
        provider: "frankfurter", rateDate: "2026-11-05" } });
    if (path === "/api/quotation-invoices") {
      if (request.method() === "GET") return route.fulfill(
        failLoad ? { status: 500, json: { message: "Fallo al consultar documentos" } } : { json: stored });
      const body = request.postDataJSON();
      creates.push(body);
      if (failCreate) return route.fulfill({ status: 409, json: { message: "Cantidad ya reservada por otro usuario" } });
      const document = withMoney({ ...body, id: 10, invoiceNumber: body.documentType === "invoice" ? "AQ-2026-25" : null });
      stored.push(document);
      return route.fulfill({ json: document });
    }
    if (path === "/api/quotation-invoices/10/convert") {
      conversions.push(request.postDataJSON());
      if (failConvert) return route.fulfill({ status: 409, json: { message: "La prefactura ya fue convertida" } });
      stored = stored.map((document) => document.id === 10
        ? withMoney({ ...document, ...request.postDataJSON(), documentType: "invoice", invoiceNumber: "AQ-2026-25" })
        : document);
      return route.fulfill({ json: stored.find((document) => document.id === 10) });
    }
    if (path === "/api/quotation-invoices/10" && request.method() === "DELETE") {
      deletions.push(path);
      stored = stored.filter((document) => document.id !== 10);
      return route.fulfill({ json: { message: "Eliminado" } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/invoicing");
  await expect(page.getByText("Cliente prefacturas", { exact: true })).toBeVisible();
  return { creates, conversions, deletions };
}

async function openItems(page) {
  await page.getByRole("row").filter({ hasText: "Cliente prefacturas" }).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Crear factura con seleccionadas" }).click();
  const dialog = page.getByRole("dialog", { name: "Items de cotizaciones seleccionadas" });
  await expect(dialog.getByLabel("Cantidad SERVICIO")).toBeVisible();
  return dialog;
}

function preinvoice() {
  return { id: 10, documentType: "preinvoice", invoiceNumber: null,
    invoiceDate: "2026-11-01", quotationIds: [1], quotationItems: items };
}

test("crea una prefactura persistente sin numero y reserva cantidades", async ({ page }) => {
  const requests = await openInvoicing(page);
  const dialog = await openItems(page);
  await dialog.getByLabel("Cantidad SERVICIO").fill("4");
  await dialog.getByRole("button", { name: "Crear prefactura", exact: true }).click();
  const model = page.getByRole("dialog", { name: "Modelo de prefactura" });
  await expect(model.getByText("Sin numero de factura")).toBeVisible();
  await expect(model.getByText("Prefactura · No es un comprobante fiscal")).toBeVisible();
  await model.getByRole("button", { name: "Guardar prefactura" }).click();
  await expect(page.getByRole("columnheader", { name: "Numero de factura", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Sin asignar", exact: true })).toBeVisible();
  expect(requests.creates).toHaveLength(1);
  expect(requests.creates[0]).toMatchObject({ documentType: "preinvoice", quotationIds: [1] });
  expect(requests.creates[0]).not.toHaveProperty("invoiceNumber");
  expect(requests.creates[0].quotationItems[0].items[0].quantity).toBe(4);
  await page.reload();
  const next = await openItems(page);
  await expect(next.getByLabel("Cantidad SERVICIO")).toHaveValue("6");
  await expect(next.getByText(/Facturado:.*0.*Reservado:.*400.*Disponible:.*600/)).toBeVisible();
});

test("facturado y reservado descuentan cantidades por separado", async ({ page }) => {
  await openInvoicing(page, { documents: [preinvoice(), {
    ...preinvoice(), id: 20, documentType: "invoice", invoiceNumber: "AQ-2026-20",
    quotationItems: [{ quotationId: 1, items: [{ ...items[0].items[0], quantity: 2 }] }],
  }] });
  const dialog = await openItems(page);
  await expect(dialog.getByLabel("Cantidad SERVICIO")).toHaveValue("4");
  await expect(dialog.getByText(/Facturado:.*200.*Reservado:.*400.*Disponible:.*400/)).toBeVisible();
});

test("convierte la misma prefactura solicitando fecha y asigna numero servidor", async ({ page }) => {
  const requests = await openInvoicing(page, { documents: [preinvoice()] });
  await page.getByRole("button", { name: "Convertir prefactura 10 en factura" }).click();
  const dialog = page.getByRole("dialog", { name: "Convertir prefactura en factura" });
  await expect(dialog.getByLabel("Fecha de factura")).not.toHaveValue("");
  await dialog.getByLabel("Fecha de factura").fill("2026-11-05");
  await dialog.getByRole("button", { name: "Confirmar conversion" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Ver factura AQ-2026-25" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Convertir prefactura 10 en factura" })).toHaveCount(0);
  expect(requests.conversions).toEqual([{
    invoiceDate: "2026-11-05", currencyCode: "USD", exchangeRate: 1,
    exchangeRateSource: "manual", exchangeRateDate: null,
  }]);
  const next = await openItems(page);
  await expect(next.getByLabel("Cantidad SERVICIO")).toHaveValue("6");
  await expect(next.getByText(/Facturado:.*400.*Reservado:.*0.*Disponible:.*600/)).toBeVisible();
});

test("eliminar prefactura libera su reserva", async ({ page }) => {
  const requests = await openInvoicing(page, { documents: [preinvoice()] });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Eliminar prefactura 10" }).click();
  await expect(page.getByRole("cell", { name: "Sin asignar", exact: true })).toHaveCount(0);
  const dialog = await openItems(page);
  await expect(dialog.getByLabel("Cantidad SERVICIO")).toHaveValue("10");
  expect(requests.deletions).toHaveLength(1);
});

test("conserva creacion directa y usa numero asignado por servidor", async ({ page }) => {
  const requests = await openInvoicing(page);
  const dialog = await openItems(page);
  await dialog.getByRole("button", { name: "Confirmar creacion de factura" }).click();
  const model = page.getByRole("dialog", { name: "Modelo de factura" });
  await expect(model.getByText("Numero asignado al confirmar")).toBeVisible();
  await model.getByRole("button", { name: "Crear factura", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ver factura AQ-2026-25" })).toBeVisible();
  expect(requests.creates[0].documentType).toBe("invoice");
  expect(requests.creates[0]).not.toHaveProperty("invoiceNumber");
});

test("error al crear mantiene el modelo y los items seleccionados", async ({ page }) => {
  await openInvoicing(page, { failCreate: true });
  const dialog = await openItems(page);
  await dialog.getByRole("button", { name: "Crear prefactura", exact: true }).click();
  const model = page.getByRole("dialog", { name: "Modelo de prefactura" });
  await model.getByRole("button", { name: "Guardar prefactura" }).click();
  await expect(model.getByRole("alert")).toHaveText("Cantidad ya reservada por otro usuario");
  await expect(model.getByRole("button", { name: "Guardar prefactura" })).toBeEnabled();
});

test("error al convertir conserva fecha y no oculta el error", async ({ page }) => {
  await openInvoicing(page, { documents: [preinvoice()], failConvert: true });
  await page.getByRole("button", { name: "Convertir prefactura 10 en factura" }).click();
  const dialog = page.getByRole("dialog", { name: "Convertir prefactura en factura" });
  await dialog.getByLabel("Fecha de factura").fill("2026-11-05");
  await dialog.getByRole("button", { name: "Confirmar conversion" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("La prefactura ya fue convertida");
  await expect(dialog.getByLabel("Fecha de factura")).toHaveValue("2026-11-05");
});

test("fallo al consultar reservas impide continuar con cantidades ficticias", async ({ page }) => {
  await openInvoicing(page, { failLoad: true });
  await page.getByRole("row").filter({ hasText: "Cliente prefacturas" }).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Crear factura con seleccionadas" }).click();
  const dialog = page.getByRole("dialog", { name: "Items de cotizaciones seleccionadas" });
  await expect(dialog.getByText(/No fue posible consultar las cantidades/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Crear prefactura", exact: true })).toBeDisabled();
});

test("copias comparten disponibilidad y permiten corregir el exceso", async ({ page }) => {
  await openInvoicing(page, { documents: [preinvoice()] });
  const dialog = await openItems(page);
  await dialog.getByLabel("Cantidad SERVICIO").fill("4");
  await dialog.getByRole("button", { name: "Duplicar item" }).click();
  await dialog.getByRole("checkbox", { name: "Incluir item SERVICIO en factura" }).nth(1).check();
  await dialog.getByLabel("Cantidad SERVICIO").nth(1).fill("3");
  await dialog.getByRole("button", { name: "Crear prefactura", exact: true }).click();
  await expect(dialog.getByText(/No puedes facturar mas que el pendiente/)).toBeVisible();
  await expect(dialog.getByText(/Facturado:.*0.*Reservado:.*400.*Disponible:.*600/)).toBeVisible();
  await dialog.getByLabel("Cantidad SERVICIO").nth(1).fill("2");
  await dialog.getByRole("button", { name: "Crear prefactura", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Modelo de prefactura" })).toBeVisible();
});

test("items totalmente reservados no se pueden volver a seleccionar", async ({ page }) => {
  await openInvoicing(page, { documents: [{
    ...preinvoice(),
    quotationItems: [{ quotationId: 1, items: [{ ...items[0].items[0], quantity: 10 }] }],
  }] });
  await page.getByRole("row").filter({ hasText: "Cliente prefacturas" }).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Crear factura con seleccionadas" }).click();
  const dialog = page.getByRole("dialog", { name: "Items de cotizaciones seleccionadas" });
  await expect(dialog.getByText(/No hay items disponibles/)).toBeVisible();
  await dialog.getByRole("checkbox", { name: "Mostrar items completados o reservados" }).check();
  await expect(dialog.getByLabel("Cantidad SERVICIO")).toBeDisabled();
  await expect(dialog.getByRole("checkbox", { name: "Incluir item SERVICIO en factura" })).toBeDisabled();
});

test("guardar bloquea doble envio y cierre del modelo mientras espera", async ({ page }) => {
  await openInvoicing(page);
  let release;
  const responseReady = new Promise((resolve) => { release = resolve; });
  let count = 0;
  await page.route("**/api/quotation-invoices", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    count += 1;
    await responseReady;
    return route.fulfill({ json: { id: 10 } });
  });
  const dialog = await openItems(page);
  await dialog.getByRole("button", { name: "Crear prefactura", exact: true }).click();
  const model = page.getByRole("dialog", { name: "Modelo de prefactura" });
  await model.getByRole("button", { name: "Guardar prefactura" }).click();
  await expect(model.getByRole("button", { name: "Guardando..." })).toBeDisabled();
  await expect(model.getByRole("button", { name: "Cerrar modelo" })).toBeDisabled();
  expect(count).toBe(1);
  release();
  await expect(model).not.toBeVisible();
});

for (const documentType of ["preinvoice", "invoice"]) {
  test(`guarda tipo de cambio sugerido y columnas monetarias en ${documentType}`, async ({ page }) => {
    const requests = await openInvoicing(page, { currency: "MXN" });
    const itemsDialog = await openItems(page);
    await itemsDialog.getByRole("button", { name: documentType === "preinvoice"
      ? "Crear prefactura" : "Confirmar creacion de factura", exact: true }).click();
    const model = page.getByRole("dialog", { name: documentType === "preinvoice" ? "Modelo de prefactura" : "Modelo de factura" });
    await expect(model.getByLabel("Tipo de cambio a USD")).toHaveValue("20");
    await expect(model.getByText(/Fuente: Frankfurter.*05\/11\/2026/)).toBeVisible();
    await expect(model.getByText("Total en USD:")).toContainText("58.00");
    await model.getByRole("button", { name: documentType === "preinvoice" ? "Guardar prefactura" : "Crear factura", exact: true }).click();
    expect(requests.creates[0]).toMatchObject({
      currencyCode: "MXN", exchangeRate: 20, exchangeRateSource: "suggested", exchangeRateDate: "2026-11-05",
    });
    await page.reload();
    const documentRow = page.getByRole("row").filter({ has: page.getByRole("button", { name: documentType === "preinvoice" ? "Ver prefactura 10" : "Ver factura AQ-2026-25", exact: true }) });
    await expect(documentRow.getByRole("cell", { name: "MXN 1,160.00", exact: true })).toBeVisible();
    await expect(documentRow.getByRole("cell", { name: "1 USD = 20 MXN", exact: true })).toBeVisible();
    await expect(documentRow.getByRole("cell", { name: "USD 58.00", exact: true })).toBeVisible();
  });
}

test("una respuesta tardia no reemplaza la tasa ingresada manualmente", async ({ page }) => {
  const requests = await openInvoicing(page, { currency: "MXN" });
  let release;
  const pendingResponse = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/quotation-invoices/exchange-rate?*", async (route) => {
    await pendingResponse;
    return route.fulfill({ json: { baseCurrency: "USD", targetCurrency: "MXN", exchangeRate: 20, rateDate: "2026-11-05" } });
  });
  const dialog = await openItems(page);
  await dialog.getByRole("button", { name: "Crear prefactura", exact: true }).click();
  const model = page.getByRole("dialog", { name: "Modelo de prefactura" });
  await expect(model.getByRole("status")).toBeVisible();
  await model.getByLabel("Tipo de cambio a USD").fill("25");
  const responseArrived = page.waitForResponse((response) =>
    response.url().includes("/api/quotation-invoices/exchange-rate"));
  release();
  await responseArrived;
  await expect(model.getByLabel("Tipo de cambio a USD")).toHaveValue("25");
  await expect(model.getByText("Total en USD:")).toContainText("46.40");
  await model.getByRole("button", { name: "Guardar prefactura" }).click();
  expect(requests.creates[0]).toMatchObject({ exchangeRate: 25, exchangeRateSource: "manual", exchangeRateDate: null });
});

test("si falla Frankfurter permite tasa manual y rechaza cero o vacio", async ({ page }) => {
  const requests = await openInvoicing(page, { currency: "MXN", failRate: true });
  const dialog = await openItems(page);
  await dialog.getByRole("button", { name: "Crear prefactura", exact: true }).click();
  const model = page.getByRole("dialog", { name: "Modelo de prefactura" });
  await expect(model.getByRole("alert")).toHaveText(/Proveedor no disponible/);
  const save = model.getByRole("button", { name: "Guardar prefactura" });
  await expect(save).toBeDisabled();
  await model.getByLabel("Tipo de cambio a USD").fill("0");
  await expect(save).toBeDisabled();
  await model.getByLabel("Tipo de cambio a USD").fill("25");
  await save.click();
  expect(requests.creates[0]).toMatchObject({ exchangeRate: 25, exchangeRateSource: "manual" });
});

test("permite recuperar la tasa sugerida despues de una edicion manual", async ({ page }) => {
  await openInvoicing(page, { currency: "MXN" });
  const dialog = await openItems(page);
  await dialog.getByRole("button", { name: "Crear prefactura", exact: true }).click();
  const model = page.getByRole("dialog", { name: "Modelo de prefactura" });
  await expect(model.getByLabel("Tipo de cambio a USD")).toHaveValue("20");
  await model.getByLabel("Tipo de cambio a USD").fill("25");
  await model.getByRole("button", { name: "Usar ultima tasa disponible" }).click();
  await expect(model.getByLabel("Tipo de cambio a USD")).toHaveValue("20");
  await expect(model.getByText(/Fuente: Frankfurter/)).toBeVisible();
});

test("tarjeta de tipo de cambio alinea controles y se adapta a pantallas pequenas", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openInvoicing(page, { currency: "MXN" });
  const dialog = await openItems(page);
  await dialog.getByRole("button", { name: "Crear prefactura", exact: true }).click();
  const card = page.getByRole("region", { name: "Tipo de cambio del documento" });
  const input = card.getByLabel("Tipo de cambio a USD");
  const button = card.getByRole("button", { name: "Usar ultima tasa disponible" });
  await expect(input).toHaveValue("20");
  const inputBox = await input.boundingBox();
  const buttonBox = await button.boundingBox();
  expect(Math.abs(inputBox.y + inputBox.height - buttonBox.y - buttonBox.height)).toBeLessThan(2);
  await expect(card.getByText("Total en USD:")).toContainText("58.00");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const element of [input, button, card.getByText("Total en USD:")]) {
    const box = await element.boundingBox();
    const cardBox = await card.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(cardBox.x);
    expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
  }
});

test("conversion presenta resumen en columnas y se adapta a movil sin desbordarse", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openInvoicing(page, { currency: "MXN", documents: [withMoney({
    ...preinvoice(), currencyCode: "MXN", exchangeRate: 20, exchangeRateSource: "manual",
  })] });
  await page.getByRole("button", { name: "Convertir prefactura 10 en factura" }).click();
  const dialog = page.getByRole("dialog", { name: "Convertir prefactura en factura" });
  const input = dialog.getByLabel("Fecha de factura");
  const amount = dialog.getByText("MXN 464.00", { exact: true });
  const inputBox = await input.boundingBox();
  const amountBox = await amount.boundingBox();
  expect(amountBox.x).toBeGreaterThan(inputBox.x + inputBox.width);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const mobileInput = await input.boundingBox();
    const mobileAmount = await amount.boundingBox();
    expect(mobileAmount.y).toBeGreaterThan(mobileInput.y + mobileInput.height);
    const panel = dialog.locator(".invoice-conversion-modal");
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await dialog.getByRole("button", { name: "Confirmar conversion" }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole("button", { name: "Confirmar conversion" })).toBeVisible();
  }
});

for (const changeRate of [false, true]) {
  test(`conversion ${changeRate ? "cambia" : "conserva"} la tasa guardada sin cambiar el monto original`, async ({ page }) => {
    const saved = withMoney({ ...preinvoice(), currencyCode: "MXN", exchangeRate: 20,
      exchangeRateSource: "suggested", exchangeRateDate: "2026-11-05" });
    const requests = await openInvoicing(page, { currency: "MXN", documents: [saved] });
    await page.getByRole("button", { name: "Convertir prefactura 10 en factura" }).click();
    const dialog = page.getByRole("dialog", { name: "Convertir prefactura en factura" });
    await expect(dialog.getByLabel("Tipo de cambio a USD")).toHaveValue("20");
    if (changeRate) await dialog.getByLabel("Tipo de cambio a USD").fill("16");
    await expect(dialog.getByText("Total en USD:")).toContainText(changeRate ? "29.00" : "23.20");
    await dialog.getByRole("button", { name: "Confirmar conversion" }).click();
    const row = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Ver factura AQ-2026-25" }) });
    await expect(row.getByRole("cell", { name: "MXN 464.00", exact: true })).toBeVisible();
    await expect(row.getByRole("cell", { name: `USD ${changeRate ? "29.00" : "23.20"}`, exact: true })).toBeVisible();
    expect(requests.conversions[0]).toMatchObject({
      exchangeRate: changeRate ? 16 : 20, exchangeRateSource: changeRate ? "manual" : "suggested",
      exchangeRateDate: changeRate ? null : "2026-11-05",
    });
  });
}

test("documentos historicos sin datos muestran no disponible sin asumir tasa 1", async ({ page }) => {
  await openInvoicing(page, { documents: [preinvoice()] });
  const row = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Ver prefactura 10", exact: true }) });
  await expect(row.getByRole("cell", { name: "No disponible", exact: true })).toHaveCount(5);
});

test("muestra nombres de oportunidad devueltos por el documento", async ({ page }) => {
  await openInvoicing(page, { documents: [{
    ...preinvoice(), opportunityNames: ["Proyecto principal", "Otra oportunidad"], accountName: "Cuenta registrada",
  }] });
  await expect(page.getByRole("columnheader", { name: "Nombre de oportunidad", exact: true })).toBeVisible();
  const row = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Ver prefactura 10", exact: true }) });
  await expect(row.getByRole("cell", { name: "Proyecto principal, Otra oportunidad", exact: true })).toBeVisible();
  await expect(row.getByRole("cell").first()).toHaveText("Proyecto principal, Otra oportunidad");
  await expect(row.getByRole("cell").nth(1)).toHaveText("Cuenta registrada");
  await expect(page.getByRole("columnheader", { name: "Nombre de cuenta", exact: true })).toBeVisible();
  await expect(page.getByRole("table").filter({ has: row }).getByRole("columnheader").first()).toHaveText("Nombre de oportunidad");
});

test("acciones de documentos usan iconos alineados del mismo tamano", async ({ page }) => {
  await openInvoicing(page, { documents: [preinvoice()] });
  const row = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Ver prefactura 10", exact: true }) });
  const buttons = row.getByRole("button");
  await expect(buttons).toHaveCount(3);
  const boxes = await buttons.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { width: box.width, height: box.height, top: box.top };
  }));
  for (const box of boxes) {
    expect(box.width).toBe(30);
    expect(box.height).toBe(30);
    expect(box.top).toBe(boxes[0].top);
  }
  await expect(page.getByRole("button", { name: "Convertir prefactura 10 en factura" })).toHaveAttribute("title", "Convertir en factura");
});

test("filtra documentos por fechas inclusivas, tipo y cuenta y permite limpiar", async ({ page }) => {
  await openInvoicing(page, { documents: [
    { ...preinvoice(), accountId: 7, accountName: "Cuenta A", invoiceDate: "2026-11-01" },
    { ...preinvoice(), id: 11, accountId: 7, accountName: "Cuenta A", documentType: "invoice",
      invoiceNumber: "AQ-2026-1", invoiceDate: "2026-11-05", quotationItems: [] },
    { ...preinvoice(), id: 12, accountId: 8, accountName: "Cuenta A", documentType: "invoice",
      invoiceNumber: "AQ-2026-2", invoiceDate: "2026-11-06", quotationItems: [] },
  ] });
  const filters = page.getByRole("group", { name: "Filtros de documentos registrados" });
  await expect(page.getByText("Mostrando 3 de 3 documentos", { exact: true })).toBeVisible();
  await filters.getByLabel("Fecha de inicio").fill("2026-11-05");
  await expect(page.getByText("Mostrando 2 de 3 documentos", { exact: true })).toBeVisible();
  await filters.getByLabel("Fecha de fin").fill("2026-11-05");
  await expect(page.getByText("Mostrando 1 de 3 documentos", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver factura AQ-2026-1", exact: true })).toBeVisible();
  await filters.getByLabel("Tipo de documento").selectOption("preinvoice");
  await expect(page.getByText("No hay documentos que coincidan con los filtros.", { exact: true })).toBeVisible();
  await filters.getByRole("button", { name: "Limpiar filtros" }).click();
  await filters.getByLabel("Cuenta", { exact: true }).selectOption("8");
  await expect(page.getByText("Mostrando 1 de 3 documentos", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver factura AQ-2026-2", exact: true })).toBeVisible();
  await filters.getByRole("button", { name: "Limpiar filtros" }).click();
  await filters.getByLabel("Fecha de fin").fill("2026-11-01");
  await expect(page.getByText("Mostrando 1 de 3 documentos", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver prefactura 10", exact: true })).toBeVisible();
  await filters.getByLabel("Fecha de inicio").fill("2026-11-06");
  await expect(page.getByRole("alert")).toHaveText("La fecha de inicio no puede ser posterior a la fecha de fin.");
  await filters.getByRole("button", { name: "Limpiar filtros" }).click();
  await expect(page.getByText("Mostrando 3 de 3 documentos", { exact: true })).toBeVisible();
});

test("ocultar una prefactura con filtros no libera sus reservas", async ({ page }) => {
  await openInvoicing(page, { documents: [preinvoice()] });
  const filters = page.getByRole("group", { name: "Filtros de documentos registrados" });
  await filters.getByLabel("Tipo de documento").selectOption("invoice");
  await expect(page.getByText("Mostrando 0 de 1 documentos", { exact: true })).toBeVisible();
  const dialog = await openItems(page);
  await expect(dialog.getByLabel("Cantidad SERVICIO")).toHaveValue("6");
});

test("USD fija la tasa 1 y el modelo guardado usa su moneda e importes historicos", async ({ page }) => {
  const saved = withMoney({ ...preinvoice(), currencyCode: "MXN", exchangeRate: 20, exchangeRateSource: "manual" });
  await openInvoicing(page, { documents: [saved] });
  await page.getByRole("button", { name: "Ver prefactura 10" }).click();
  const stored = page.getByRole("dialog", { name: "Modelo de prefactura" });
  await expect(stored.getByText("Tipo de cambio a USD:")).toContainText("1 USD = 20 MXN");
  await expect(stored.getByText("Total en USD:")).toContainText("23.20");
  await expect(stored.getByText("Moneda: MXN")).toBeVisible();
  await stored.getByRole("button", { name: "Cerrar", exact: true }).click();
  const dialog = await openItems(page);
  await dialog.getByRole("button", { name: "Crear prefactura", exact: true }).click();
  const model = page.getByRole("dialog", { name: "Modelo de prefactura" });
  await expect(model.getByLabel("Tipo de cambio a USD")).toBeDisabled();
  await expect(model.getByLabel("Tipo de cambio a USD")).toHaveValue("1");
});
