import { expect, test } from "@playwright/test";
import { Buffer } from "node:buffer";

const order = (id = 1, extra = {}) => ({
  orderId: id, orderNumber: `OC-${id}`, orderDate: "2026-11-06", providerId: 5,
  providerName: "Proveedor de prueba", currencyCode: "MXN", accountId: id + 6,
  accountName: `Cuenta ${id}`, opportunityId: id, opportunityName: `Proyecto ${id}`, ivaPct: 16,
  lines: [{ itemId: id * 10, code: `ITEM-${id}`, description: "Producto comprado",
    quantity: 5, unitCost: 100, discountPct: 10, amount: 450,
    invoicedQuantity: 0, reservedQuantity: 0, availableQuantity: 5 }], ...extra,
});
const preinvoice = () => ({
  id: 20, documentType: "preinvoice", invoiceNumber: null, invoiceDate: "2026-11-06",
  providerId: 5, providerName: "Proveedor de prueba", currencyCode: "MXN",
  exchangeRate: 20, exchangeRateSource: "manual", exchangeRateDate: null,
  subtotal: 180, ivaAmount: 28.8, totalAmount: 208.8, totalUsd: 10.44,
  orders: [{ ...order(), lines: [{ ...order().lines[0], quantity: 2, amount: 180 }] }],
});

async function openPage(page, { orders = [order()], documents = [], failLoad = false, failSave = false, failConvert = false, canUpdate = true } = {}) {
  let stored = structuredClone(documents);
  const creates = [];
  const converts = [];
  await page.addInitScript(() => window.localStorage.setItem("crm_token", "supplier-invoice-test"));
  function availableOrders() {
    return orders.map((source) => ({ ...source, lines: source.lines.map((line) => {
      let invoicedQuantity = 0, reservedQuantity = 0;
      stored.forEach((document) => {
        document.orders.filter((entry) => entry.orderId === source.orderId).forEach((entry) => {
          entry.lines.filter((item) => item.itemId === line.itemId).forEach((item) => {
            if (document.documentType === "preinvoice") reservedQuantity += item.quantity;
            else invoicedQuantity += item.quantity;
          });
        });
      });
      return { ...line, invoicedQuantity, reservedQuantity, availableQuantity: line.quantity - invoicedQuantity - reservedQuantity };
    }) }));
  }
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/bootstrap-status") return route.fulfill({ json: { hasUsers: true } });
    if (path === "/api/auth/me") return route.fulfill({
      json: { id: 1, full_name: "Usuario", permissions: [canUpdate
        ? "aceptar_pedido.procesamiento.update" : "aceptar_pedido.procesamiento.read"] },
    });
    if (path === "/api/quotation-invoices/exchange-rate") return route.fulfill({
      json: { baseCurrency: "USD", targetCurrency: "MXN", exchangeRate: 20, rateDate: "2026-11-05" },
    });
    if (path === "/api/provider-invoices/orders") return route.fulfill(failLoad
      ? { status: 500, json: { message: "No se pudieron consultar las ordenes" } } : { json: availableOrders() });
    if (path === "/api/provider-invoices") {
      if (request.method() === "GET") return route.fulfill({ json: stored });
      const body = request.postDataJSON();
      creates.push(body);
      if (failSave) return route.fulfill({ status: 409, json: { message: "Cantidad ya reservada por otro usuario" } });
      const selectedOrders = body.orderItems.map((entry) => {
        const source = orders.find((item) => item.orderId === entry.orderId);
        return { ...source, lines: entry.items.map((item) => ({
          ...source.lines.find((line) => line.itemId === item.itemId), quantity: item.quantity,
        })) };
      });
      const subtotal = selectedOrders.reduce((sum, source) => sum + source.lines.reduce((a, line) =>
        a + line.quantity * line.unitCost * (1 - line.discountPct / 100), 0), 0);
      const ivaAmount = selectedOrders.reduce((sum, source) => sum + source.lines.reduce((a, line) =>
        a + line.quantity * line.unitCost * (1 - line.discountPct / 100) * source.ivaPct / 100, 0), 0);
      const totalAmount = subtotal + ivaAmount;
      const document = { ...preinvoice(), ...body, id: 20,
        invoiceNumber: body.documentType === "preinvoice" ? null : body.invoiceNumber,
        orders: selectedOrders, subtotal, ivaAmount, totalAmount, totalUsd: totalAmount / body.exchangeRate };
      stored.push(document);
      return route.fulfill({ status: 201, json: document });
    }
    if (path === "/api/provider-invoices/20/convert") {
      const body = request.postDataJSON();
      converts.push(body);
      if (failConvert) return route.fulfill({ status: 409, json: { message: "Numero de factura duplicado para este proveedor" } });
      stored = stored.map((document) => document.id === 20
        ? { ...document, ...body, documentType: "invoice", totalUsd: document.totalAmount / body.exchangeRate }
        : document);
      return route.fulfill({ json: stored[0] });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/provider-invoice-reception");
  await expect(page.getByRole("heading", { name: "Facturas de proveedores", exact: true })).toBeVisible();
  await expect(page.getByText("Cargando documentos...", { exact: true })).toHaveCount(0);
  return { creates, converts };
}

async function openCreate(page, ids = [1]) {
  for (const id of ids) await page.getByRole("checkbox", { name: `Incluir orden OC-${id}`, exact: true }).check();
  await page.getByRole("button", { name: "Registrar factura o prefactura", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Registrar factura o prefactura", exact: true });
  await expect(dialog.getByLabel("Tipo de cambio a USD")).toHaveValue("20");
  return dialog;
}

test("registra factura parcial con items y relaciones precargadas", async ({ page }) => {
  const requests = await openPage(page);
  const dialog = await openCreate(page);
  await expect(dialog.getByText("Cuenta 1 · Proyecto 1 · IVA 16%")).toBeVisible();
  await dialog.getByLabel("Numero de factura del proveedor").fill("PROV-100");
  await dialog.getByLabel("Cantidad OC-1 ITEM-1").fill("2");
  await expect(dialog.getByText("Total en USD:")).toContainText("10.44");
  await dialog.getByRole("button", { name: "Registrar factura", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(requests.creates[0]).toMatchObject({
    documentType: "invoice", invoiceNumber: "PROV-100", exchangeRate: 20,
    orderItems: [{ orderId: 1, items: [{ itemId: 10, quantity: 2 }] }],
  });
  await expect(page.getByRole("cell", { name: "PROV-100", exact: true })).toBeVisible();
  const next = await openCreate(page);
  await expect(next.getByLabel("Cantidad OC-1 ITEM-1")).toHaveValue("3");
});

test("reserva con prefactura y la convierte conservando los items", async ({ page }) => {
  const requests = await openPage(page);
  const dialog = await openCreate(page);
  await dialog.getByRole("button", { name: "Guardar prefactura" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Incluir orden OC-1" })).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "Sin asignar", exact: true })).toBeVisible();
  expect(requests.creates[0]).toMatchObject({ documentType: "preinvoice", invoiceNumber: null });
  await page.reload();
  await page.getByRole("button", { name: "Convertir en factura", exact: true }).click();
  const convert = page.getByRole("dialog", { name: "Convertir prefactura de proveedor en factura" });
  await convert.getByLabel("Numero de factura del proveedor").fill("PROV-200");
  await convert.getByLabel("Tipo de cambio a USD").fill("25");
  await convert.getByRole("button", { name: "Confirmar conversion" }).click();
  await expect(convert).not.toBeVisible();
  await expect(page.getByRole("cell", { name: "PROV-200", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Convertir en factura", exact: true })).toHaveCount(0);
  expect(requests.converts[0]).toMatchObject({ invoiceNumber: "PROV-200", exchangeRate: 25 });
  await expect(page.getByRole("checkbox", { name: "Incluir orden OC-1" })).toHaveCount(0);
});

test("agrupa varias cuentas pero no mezcla proveedores ni monedas", async ({ page }) => {
  await openPage(page, { orders: [order(), order(2), order(3, { providerId: 6 }), order(4, { currencyCode: "USD" })] });
  await page.getByRole("checkbox", { name: "Incluir orden OC-1", exact: true }).check();
  await expect(page.getByRole("checkbox", { name: "Incluir orden OC-3", exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Incluir orden OC-4", exact: true })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Incluir orden OC-2", exact: true }).check();
  await page.getByRole("button", { name: "Registrar factura o prefactura", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Cuenta 1 · Proyecto 1 · IVA 16%")).toBeVisible();
  await expect(dialog.getByText("Cuenta 2 · Proyecto 2 · IVA 16%")).toBeVisible();
});

test("exige numero para factura y permite corregir cantidades fuera del disponible", async ({ page }) => {
  await openPage(page);
  const dialog = await openCreate(page);
  await dialog.getByRole("button", { name: "Registrar factura", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Ingresa el numero de factura del proveedor.");
  await dialog.getByLabel("Cantidad OC-1 ITEM-1").fill("6");
  await dialog.getByRole("button", { name: "Guardar prefactura" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Selecciona al menos un item y cantidades dentro del disponible.");
  await dialog.getByLabel("Cantidad OC-1 ITEM-1").fill("1");
  await dialog.getByRole("button", { name: "Guardar prefactura" }).click();
  await expect(dialog).not.toBeVisible();
});

test("error al guardar mantiene datos y permite reintentar", async ({ page }) => {
  await openPage(page, { failSave: true });
  const dialog = await openCreate(page);
  await dialog.getByLabel("Numero de factura del proveedor").fill("PROV-100");
  await dialog.getByRole("button", { name: "Registrar factura", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Cantidad ya reservada por otro usuario");
  await expect(dialog.getByLabel("Numero de factura del proveedor")).toHaveValue("PROV-100");
  await expect(dialog.getByRole("button", { name: "Registrar factura", exact: true })).toBeEnabled();
});

test("error de conversion conserva numero y prefactura", async ({ page }) => {
  await openPage(page, { documents: [preinvoice()], failConvert: true });
  await page.getByRole("button", { name: "Convertir en factura", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Numero de factura del proveedor").fill("DUPLICADO");
  await dialog.getByRole("button", { name: "Confirmar conversion" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Numero de factura duplicado para este proveedor");
  await expect(dialog.getByLabel("Numero de factura del proveedor")).toHaveValue("DUPLICADO");
});

test("filtros del listado no liberan reservas y vista conserva importes historicos", async ({ page }) => {
  await openPage(page, { documents: [preinvoice()] });
  const filters = page.getByRole("group", { name: "Filtros de documentos de proveedores" });
  await filters.getByLabel("Tipo de documento").selectOption("invoice");
  await expect(page.getByText("No hay documentos que coincidan con los filtros.", { exact: true })).toBeVisible();
  const dialog = await openCreate(page);
  await expect(dialog.getByLabel("Cantidad OC-1 ITEM-1")).toHaveValue("3");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await filters.getByRole("button", { name: "Limpiar filtros" }).click();
  await page.getByRole("button", { name: "Ver documento", exact: true }).click();
  const view = page.getByRole("dialog", { name: "Documento de proveedor" });
  await expect(view.getByText("Total en USD:")).toContainText("10.44");
  await expect(view.getByLabel("Numero de factura del proveedor")).toHaveCount(0);
});

test("fallo al cargar no permite registrar documentos", async ({ page }) => {
  await openPage(page, { failLoad: true });
  await expect(page.getByRole("alert")).toHaveText("No se pudieron consultar las ordenes");
  await expect(page.getByRole("button", { name: "Registrar factura o prefactura", exact: true })).toBeDisabled();
});

test("registro se adapta a movil y calcula descuentos e IVA propios de cada orden", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page, { orders: [order(), order(2, { ivaPct: 0 })] });
  const dialog = await openCreate(page, [1, 2]);
  await expect(dialog.getByText("Total en USD:")).toContainText("48.60");
  const panel = dialog.locator(".supplier-invoice-modal");
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("modal de registro aprovecha el ancho de escritorio", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPage(page);
  const dialog = await openCreate(page);
  const panel = dialog.locator(".supplier-invoice-modal");
  await expect(panel).toHaveCSS("width", "1180px");
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("bloquea doble registro y cierre mientras guarda", async ({ page }) => {
  await openPage(page);
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let requests = 0;
  await page.route("**/api/provider-invoices", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    requests += 1;
    await pending;
    return route.fulfill({ json: { id: 20 } });
  });
  const dialog = await openCreate(page);
  await dialog.getByRole("button", { name: "Guardar prefactura" }).click();
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  await expect(dialog.getByLabel("Cantidad OC-1 ITEM-1")).toBeDisabled();
  await expect(dialog.getByLabel("Numero de factura del proveedor")).toBeDisabled();
  expect(requests).toBe(1);
  release();
  await expect(dialog).not.toBeVisible();
});

test("consulta disponibilidad fresca antes de abrir el registro", async ({ page }) => {
  await openPage(page);
  await page.getByRole("checkbox", { name: "Incluir orden OC-1", exact: true }).check();
  await page.route("**/api/provider-invoices/orders", (route) => route.fulfill({ json: [{
    ...order(), lines: [{ ...order().lines[0], reservedQuantity: 4, availableQuantity: 1 }],
  }] }));
  await page.getByRole("button", { name: "Registrar factura o prefactura", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Cantidad OC-1 ITEM-1")).toHaveValue("1");
});

test("consulta sin permiso de edicion no permite registrar ni convertir", async ({ page }) => {
  await openPage(page, { documents: [preinvoice()], canUpdate: false });
  await expect(page.getByRole("checkbox", { name: "Incluir orden OC-1" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Registrar factura o prefactura", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Convertir en factura", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Ver documento", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("fallo de adjuntos reintenta solo la carga sin duplicar la prefactura", async ({ page }) => {
  const requests = await openPage(page);
  let uploads = 0;
  await page.route("**/api/provider-invoices/20/attachments", (route) => {
    uploads += 1;
    expect(route.request().headers()["content-type"]).toContain("multipart/form-data");
    return route.fulfill(uploads === 1
      ? { status: 500, json: { message: "Fallo al guardar comprobante" } }
      : { json: { attachments: [] } });
  });
  const dialog = await openCreate(page);
  await dialog.getByLabel("Comprobantes del proveedor (opcional)").setInputFiles({
    name: "factura.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 proveedor"),
  });
  await dialog.getByRole("button", { name: "Guardar prefactura" }).click();
  const attachmentDialog = page.getByRole("dialog", { name: "Adjuntar comprobantes de proveedor" });
  await expect(attachmentDialog.getByRole("alert")).toContainText("El documento ya fue guardado.");
  expect(requests.creates).toHaveLength(1);
  await attachmentDialog.getByRole("button", { name: "Reintentar adjuntos" }).click();
  await expect(attachmentDialog).not.toBeVisible();
  expect(requests.creates).toHaveLength(1);
  expect(uploads).toBe(2);
});

test("descarga comprobante con el cliente autenticado y nombre original", async ({ page }) => {
  await openPage(page, { documents: [{
    ...preinvoice(), attachments: [{ id: 8, fileName: "comprobante.pdf",
      downloadUrl: "/api/provider-invoices/20/attachments/8/content" }],
  }] });
  await page.route("**/api/provider-invoices/20/attachments/8/content", (route) => {
    expect(route.request().headers().authorization).toBeTruthy();
    return route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4 proveedor" });
  });
  await page.getByRole("button", { name: "Ver documento", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("dialog").getByRole("button", { name: "comprobante.pdf", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("comprobante.pdf");
});

test("agrega comprobantes a un documento existente sin registrarlo otra vez", async ({ page }) => {
  const requests = await openPage(page, { documents: [preinvoice()] });
  let uploaded = false;
  await page.route("**/api/provider-invoices/20/attachments", (route) => {
    uploaded = true;
    return route.fulfill({ json: { attachments: [] } });
  });
  await page.getByRole("button", { name: "Adjuntar comprobantes", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Adjuntar comprobantes de proveedor" });
  await dialog.getByLabel("Comprobantes del proveedor (opcional)").setInputFiles({
    name: "comprobante.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 proveedor"),
  });
  await dialog.getByRole("button", { name: "Adjuntar comprobantes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(uploaded).toBe(true);
  expect(requests.creates).toHaveLength(0);
});
