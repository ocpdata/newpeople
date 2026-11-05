import { expect, test } from "@playwright/test";

async function openProcessing(page, {
  selected = true, canUpdate = true, failRegistration = false, failRemoval = false,
  failProviderRegistration = false, failProviderRemoval = false,
  accepted = false, acceptanceRecorded = accepted, failAcceptance = false,
  completionFailures = 0, staleList = false, canCorrectAcceptance = false,
  kickoffUsers = [], allUsers = kickoffUsers, previousKickoffAttendees = null,
} = {}) {
  let quotationStatus = accepted ? "aceptada" : "ganada";
  let recorded = acceptanceRecorded;
  const transitions = [];
  const completions = [];
  const stageRequests = [];
  const invitations = [];
  const corrections = [];
  const correctionHeaders = [];
  let acceptanceData = {};
  const latestInvitation = previousKickoffAttendees ? {
    id: 1, inviteSubject: "Convocatoria anterior", inviteBodyTemplate: "Mensaje anterior",
    internalAttendeesUserIds: previousKickoffAttendees, statusCode: "draft",
    meetingDate: "2026-11-06",
  } : null;
  const stages = () => [
    { stageCode: "quotation_accepted", stageName: "Cotización aceptada",
      status: quotationStatus === "aceptada" ? "completed" : "not_started",
      acceptanceRecorded: recorded, stageData: acceptanceData },
    { stageCode: "kickoff_internal", stageName: "Kick Off interno", status: "not_started", stageData: {} },
  ];
  let value = { amount: null, currencyCode: null };
  let orderIds = selected ? [20] : [];
  const additionalValues = {};
  const registrations = [];
  const removals = [];
  const providerRegistrations = [];
  const providerRemovals = [];
  const providerQuotes = [{ documentId: 30, source: "quotation", originalFileName: "proveedor.pdf" }];
  const quotationDocuments = [
    { documentId: 20, originalFileName: "orden-cliente.pdf" },
    { documentId: 30, originalFileName: "proveedor.pdf" },
    { documentId: 31, originalFileName: "proveedor-adicional.pdf" },
    { documentId: 32, originalFileName: "proveedor-otra-version.pdf" },
  ];
  const closingDocuments = () => {
    const orders = orderIds.map((id) => ({
      documentId: id, source: id === 20 ? "quotation" : "opportunity",
      originalFileName: id === 20 ? "orden-cliente.pdf" : "otro-documento.pdf",
      ...(id === 20 ? value : additionalValues[id] || { amount: null, currencyCode: null }),
    }));
    return {
    quotationDocuments,
    opportunityDocuments: [{ documentId: 21, originalFileName: "otro-documento.pdf" }],
    savedSelections: {
      purchaseOrder: orders[0] || null,
      purchaseOrders: orders,
      providerQuotes,
    },
    };
  };
  await page.addInitScript(() => window.localStorage.setItem("crm_token", "order-test"));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().headers()["x-acceptance-correction-reason"]) {
      correctionHeaders.push({ path: url.pathname, reason: decodeURIComponent(route.request().headers()["x-acceptance-correction-reason"]) });
    }
    if (url.pathname === "/api/auth/bootstrap-status") return route.fulfill({ json: { hasUsers: true } });
    if (url.pathname === "/api/auth/me") return route.fulfill({
      json: { id: 501, full_name: "Usuario", permissions: [canUpdate ? "aceptar_pedido.procesamiento.update" : "aceptar_pedido.procesamiento.read"] },
    });
    if (url.pathname === "/api/quotations") return route.fulfill({ json: [{
      id: 1, latestVersionId: 10, latestVersionNumber: 1, latestProposalName: "Proyecto OC",
      latestStatusCode: staleList ? "ganada" : quotationStatus,
      latestStatusName: quotationStatus === "aceptada" ? "Aceptada" : "Ganada",
      latestCurrencyCode: "USD", activationStatusCode: "activada",
    }] });
    if (url.pathname === "/api/quotations/1/processing") return route.fulfill({
      json: { quotation: { statusCode: quotationStatus }, permissions: { canUpdate, canConvoke: canUpdate, canCorrectAcceptance },
        assignableUsers: allUsers,
        kickoffInternal: { assignableUsers: kickoffUsers, latestInvitation, invitations: latestInvitation ? [latestInvitation] : [] },
        stages: stages() },
    });
    if (url.pathname === "/api/quotations/1/processing/kickoff-internal/invitations") {
      invitations.push(route.request().postDataJSON());
      return route.fulfill({ json: { message: "Convocatoria guardada" } });
    }
    if (url.pathname === "/api/quotation-versions/10/transition") {
      transitions.push(route.request().postDataJSON());
      if (failAcceptance) return route.fulfill({ status: 500, json: { message: "Error al aceptar cotización" } });
      quotationStatus = "aceptada";
      return route.fulfill({ json: { statusCode: "aceptada", statusName: "Aceptada", acceptedAt: "2026-11-05T12:00:00.000Z" } });
    }
    if (url.pathname === "/api/quotations/1/processing/stages/quotation_accepted") {
      stageRequests.push(route.request().postDataJSON());
      return route.fulfill({ json: { stages: stages() } });
    }
    if (url.pathname === "/api/quotations/1/processing/acceptance-correction") {
      const body = route.request().postDataJSON();
      corrections.push(body);
      acceptanceData = { acceptedAt: body.acceptedAt };
      return route.fulfill({ json: { stages: stages() } });
    }
    if (url.pathname === "/api/quotations/1/processing/complete-acceptance") {
      completions.push(route.request().method());
      if (completionFailures > 0) {
        completionFailures -= 1;
        return route.fulfill({ status: 500, json: { message: "Error de registro operativo" } });
      }
      recorded = true;
      return route.fulfill({ json: { stages: stages() } });
    }
    if (/\/won-documents\/provider-quotes\/(quotation|opportunity)\/\d+$/.test(url.pathname) && route.request().method() === "DELETE") {
      providerRemovals.push(url.pathname);
      if (failProviderRemoval) return route.fulfill({ status: 500, json: { message: "Error al quitar cotización de proveedor" } });
      const id = Number(url.pathname.split("/").at(-1));
      providerQuotes.splice(providerQuotes.findIndex((item) => item.documentId === id), 1);
      return route.fulfill({ json: { message: "Cotizacion de proveedor retirada del cierre" } });
    }
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
    if (url.pathname === "/api/quotation-versions/10/won-documents/provider-quotes") {
      const body = route.request().postDataJSON();
      providerRegistrations.push(body);
      if (failProviderRegistration) return route.fulfill({ status: 500, json: { message: "Error al registrar cotización de proveedor" } });
      providerQuotes.push({
        ...body, originalFileName: quotationDocuments.find((item) => item.documentId === body.documentId).originalFileName,
      });
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
  return { registrations, removals, providerRegistrations, providerRemovals,
    transitions, completions, stageRequests, invitations, corrections, correctionHeaders, value: () => value };
}

test("corrige aceptacion con motivo y vuelve a bloquear sin aceptar ni enviar correo", async ({ page }) => {
  const state = await openProcessing(page, { accepted: true, canCorrectAcceptance: true });
  await expect(page.getByLabel("Valor de la orden de compra")).toBeDisabled();
  await page.getByRole("button", { name: "Modificar datos de aceptación", exact: true }).click();
  await expect(page.getByRole("button", { name: "Iniciar modificación" })).toBeDisabled();
  await page.getByLabel("Motivo de modificación").fill("Corrección documental solicitada");
  await page.getByRole("button", { name: "Iniciar modificación" }).click();
  await expect(page.getByLabel("Valor de la orden de compra")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Aceptada", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Correo vendedor", exact: true })).toBeDisabled();
  await page.getByLabel("Valor de la orden de compra").fill("125");
  await page.getByLabel("Moneda de la orden de compra").selectOption("USD");
  await page.getByRole("button", { name: "Guardar valor de orden", exact: true }).click();
  await expect.poll(() => state.value().amount).toBe(125);
  await page.getByLabel("Fecha de aceptacion", { exact: true }).fill("2026-11-06");
  await page.getByLabel("Notas", { exact: true }).fill("Corrección de fecha documentada");
  await page.getByRole("button", { name: "Finalizar modificación", exact: true }).click();
  await expect(page.getByLabel("Valor de la orden de compra")).toBeDisabled();
  expect(state.corrections).toEqual([{ acceptedAt: "2026-11-06T12:00:00.000Z", notes: "Corrección de fecha documentada" }]);
  expect(state.correctionHeaders).toHaveLength(2);
  expect(state.correctionHeaders.every((entry) => entry.reason === "Corrección documental solicitada")).toBe(true);
  expect(state.transitions).toEqual([]);
});

test("oculta correccion sin permiso", async ({ page }) => {
  await openProcessing(page, { accepted: true });
  await expect(page.getByRole("button", { name: "Modificar datos de aceptación" })).toHaveCount(0);
});

test("exige completar el registro antes de modificar aceptacion", async ({ page }) => {
  await openProcessing(page, { accepted: true, acceptanceRecorded: false, canCorrectAcceptance: true });
  await expect(page.getByRole("button", { name: "Modificar datos de aceptación", exact: true })).toBeDisabled();
});

test("audita el motivo en documentos corregidos y no mantiene el desbloqueo al reabrir", async ({ page }) => {
  const state = await openProcessing(page, { accepted: true, canCorrectAcceptance: true });
  await page.getByRole("button", { name: "Modificar datos de aceptación", exact: true }).click();
  await page.getByLabel("Motivo de modificación").fill("Sustitución de documentos del cierre");
  await page.getByRole("button", { name: "Iniciar modificación" }).click();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Quitar cotización de proveedor del cierre: proveedor.pdf", exact: true }).click();
  await expect.poll(() => state.providerRemovals.length).toBe(1);
  await page.getByLabel("Archivo de cotización de proveedor", { exact: true }).selectOption("quotation:30");
  await page.getByRole("button", { name: "Registrar cotización de proveedor", exact: true }).click();
  await expect.poll(() => state.providerRegistrations.length).toBe(1);
  await page.getByRole("button", { name: "Quitar orden de compra del cierre", exact: true }).click();
  await expect.poll(() => state.removals.length).toBe(1);
  await page.getByLabel("Archivo de orden de compra", { exact: true }).selectOption("quotation:20");
  await page.getByRole("button", { name: "Registrar orden de compra", exact: true }).click();
  await expect.poll(() => state.registrations.length).toBe(1);
  expect(state.correctionHeaders).toHaveLength(4);
  expect(state.correctionHeaders.every((entry) => entry.reason === "Sustitución de documentos del cierre")).toBe(true);
  await page.getByRole("button", { name: "Cerrar procesamiento", exact: true }).click();
  await page.getByRole("cell", { name: "Proyecto OC", exact: true }).click();
  await expect(page.getByLabel("Valor de la orden de compra")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Modificar datos de aceptación", exact: true })).toBeVisible();
});

test("mantiene modo correccion si falla al guardar fecha y notas", async ({ page }) => {
  await openProcessing(page, { accepted: true, canCorrectAcceptance: true });
  await page.route("**/api/quotations/1/processing/acceptance-correction", (route) =>
    route.fulfill({ status: 500, json: { message: "No fue posible guardar la corrección" } }));
  await page.getByRole("button", { name: "Modificar datos de aceptación", exact: true }).click();
  await page.getByLabel("Motivo de modificación").fill("Corrección documental solicitada");
  await page.getByRole("button", { name: "Iniciar modificación" }).click();
  await page.getByLabel("Fecha de aceptacion", { exact: true }).fill("2026-11-06");
  await page.getByRole("button", { name: "Finalizar modificación", exact: true }).click();
  await expect(page.getByText("No fue posible guardar la corrección", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finalizar modificación", exact: true })).toBeVisible();
  await expect(page.getByLabel("Fecha de aceptacion", { exact: true })).toBeEnabled();
});

const assignedSeller = { id: 1, fullName: "Vendedor asignado", email: "assigned@example.test" };
const otherSeller = { id: 2, fullName: "Otro vendedor", email: "other@example.test" };
const operationsUser = { id: 3, fullName: "Operaciones", email: "ops@example.test" };
const multiRoleSeller = { id: 4, fullName: "Vendedor multirrol", email: "multi@example.test" };

test("organiza convocatoria y minuta con seleccion clara en escritorio y movil", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openProcessing(page, { kickoffUsers: [assignedSeller, operationsUser] });
  await page.getByRole("tab", { name: /Kick Off interno/ }).click();
  const card = page.locator(".kickoff-internal-invitation-card");
  const minutes = page.locator(".kickoff-internal-minutes-card");
  const upload = minutes.getByLabel("Archivo de minuta (texto/audio)");
  const attendees = page.getByRole("group", { name: "Convocados internos", exact: true });
  await page.getByRole("checkbox", { name: /Operaciones/ }).check();
  await expect(attendees.getByText("Seleccionados: 1", { exact: true })).toBeVisible();
  await expect(attendees.locator(".is-selected")).toHaveCount(1);
  const name = await attendees.locator(".is-selected strong").boundingBox();
  const email = await attendees.locator(".is-selected small").boundingBox();
  expect(email.y).toBeGreaterThan(name.y);
  const picker = await attendees.boundingBox();
  const dates = await card.locator(".kickoff-internal-right-field").first().boundingBox();
  expect(dates.x).toBeGreaterThan(picker.x + picker.width);
  await card.screenshot({ path: testInfo.outputPath("kickoff-desktop.png") });
  await expect(upload).toBeVisible();
  expect((await upload.boundingBox()).height).toBeGreaterThanOrEqual(64);
  await minutes.screenshot({ path: testInfo.outputPath("minutes-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileAttendees = await attendees.boundingBox();
  const mobileDates = await card.locator(".kickoff-internal-right-field").first().boundingBox();
  expect(mobileDates.y).toBeGreaterThanOrEqual(mobileAttendees.y + mobileAttendees.height);
  expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await card.screenshot({ path: testInfo.outputPath("kickoff-mobile.png") });
  expect((await upload.boundingBox()).height).toBeGreaterThanOrEqual(64);
  expect(await minutes.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await minutes.screenshot({ path: testInfo.outputPath("minutes-mobile.png") });
});

test("convocados internos muestra solo el vendedor asignado y otros usuarios", async ({ page }) => {
  const state = await openProcessing(page, {
    kickoffUsers: [assignedSeller, operationsUser],
    allUsers: [assignedSeller, otherSeller, operationsUser, multiRoleSeller],
  });
  await page.getByRole("tab", { name: /Kick Off interno/ }).click();
  await expect(page.getByRole("checkbox", { name: /Vendedor asignado/ })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Operaciones/ })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Otro vendedor|Vendedor multirrol/ })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: /Vendedor asignado/ })).not.toBeChecked();
  await page.getByRole("checkbox", { name: /Operaciones/ }).check();
  await page.getByRole("button", { name: "Abrir vista previa de correo", exact: true }).click();
  await page.getByRole("button", { name: "Guardar borrador", exact: true }).click();
  await expect.poll(() => state.invitations.length).toBe(1);
  expect(state.invitations[0].internalAttendeesUserIds).toEqual([3]);
});

test("convocados historicos no elegibles se advierten sin eliminarlos silenciosamente", async ({ page }) => {
  const state = await openProcessing(page, {
    kickoffUsers: [assignedSeller, operationsUser],
    allUsers: [assignedSeller, otherSeller, operationsUser],
    previousKickoffAttendees: [2, 3],
  });
  await page.getByRole("tab", { name: /Kick Off interno/ }).click();
  await expect(page.getByText(/La convocatoria anterior contiene convocados no disponibles/)).toBeVisible();
  await expect(page.getByText("Seleccionados: 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Otro vendedor/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Abrir vista previa de correo", exact: true }).click();
  await expect(page.getByText("Retira los convocados internos no disponibles antes de preparar la convocatoria.", { exact: true })).toBeVisible();
  expect(state.invitations).toHaveLength(0);
  await page.getByRole("button", { name: "Cerrar notificacion de error", exact: true }).click();
  await page.getByRole("button", { name: "Retirar convocado no disponible: Otro vendedor", exact: true }).click();
  await expect(page.getByText("Seleccionados: 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Abrir vista previa de correo", exact: true }).click();
  await page.getByRole("button", { name: "Guardar borrador", exact: true }).click();
  await expect.poll(() => state.invitations.length).toBe(1);
  expect(state.invitations[0].internalAttendeesUserIds).toEqual([3]);
});

test("sin vendedor asignado permite convocar a los demas usuarios", async ({ page }) => {
  await openProcessing(page, { kickoffUsers: [operationsUser], allUsers: [otherSeller, operationsUser] });
  await page.getByRole("tab", { name: /Kick Off interno/ }).click();
  await expect(page.getByRole("checkbox", { name: /Operaciones/ })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /vendedor/i })).toHaveCount(0);
});

async function expectAcceptedClosureLocked(page) {
  await expect(page.getByRole("button", { name: "Aceptada", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Correo vendedor", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Archivo de orden de compra", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Archivo de cotización de proveedor", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Valor de la orden de compra", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Moneda de la orden de compra", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Registrar|Quitar .*del cierre|Guardar valor de orden/ })).toHaveCount(0);
  await expect(page.getByText("Cotización aceptada. No se permiten cambios en los documentos de cierre ni el envío de correo al vendedor.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Descargar documento", exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Descargar documento", exact: true }).nth(0)).toBeEnabled();
  await expect(page.getByRole("button", { name: "Descargar documento", exact: true }).nth(1)).toBeEnabled();
  await expect(page.getByLabel("Fecha de aceptacion", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Notas", { exact: true })).toBeDisabled();
}

test("aceptar bloquea el cierre y correo y conserva el bloqueo al reabrir", async ({ page }) => {
  const state = await openProcessing(page);
  await page.getByRole("button", { name: "Aceptar", exact: true }).click();
  await expectAcceptedClosureLocked(page);
  await expect(page.getByText("Cotización aceptada y registro operativo completado.", { exact: true })).toBeVisible();
  expect(state.transitions).toEqual([{ actionCode: "aceptar" }]);
  expect(state.completions).toHaveLength(1);
  expect(state.stageRequests[0].status).toBe("not_started");
  await page.getByRole("button", { name: "Cerrar notificacion de exito", exact: true }).click();
  await page.getByRole("button", { name: "Cerrar procesamiento", exact: true }).click();
  await page.getByRole("cell", { name: "Proyecto OC", exact: true }).click();
  await expectAcceptedClosureLocked(page);
  await expect(page.getByRole("button", { name: "Completar registro", exact: true })).toHaveCount(0);
});

test("bloquea cotizaciones ya aceptadas segun la respuesta operativa aunque el listado este desactualizado", async ({ page }) => {
  await openProcessing(page, { accepted: true, staleList: true });
  await expectAcceptedClosureLocked(page);
  await expect(page.getByRole("button", { name: "Completar registro", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: /Kick Off interno/ }).click();
  await expect(page.getByRole("button", { name: "Culminar Kick Off Interno", exact: true })).toBeEnabled();
});

test("recupera un registro pendiente sin repetir aceptacion ni desbloquear documentos", async ({ page }) => {
  const state = await openProcessing(page, { completionFailures: 1 });
  await page.getByRole("button", { name: "Aceptar", exact: true }).click();
  await expect(page.getByText(/La cotización está aceptada, pero el registro operativo quedó pendiente/)).toBeVisible();
  await expectAcceptedClosureLocked(page);
  await page.getByRole("button", { name: "Cerrar notificacion de error", exact: true }).click();
  await page.getByRole("button", { name: "Cerrar procesamiento", exact: true }).click();
  await page.getByRole("cell", { name: "Proyecto OC", exact: true }).click();
  await page.getByRole("button", { name: "Completar registro", exact: true }).click();
  await expect(page.getByText("Cotización aceptada y registro operativo completado.", { exact: true })).toBeVisible();
  await expectAcceptedClosureLocked(page);
  expect(state.transitions).toHaveLength(1);
  expect(state.completions).toHaveLength(2);
});

test("un fallo de aceptacion mantiene los documentos editables", async ({ page }) => {
  await openProcessing(page, { failAcceptance: true });
  await page.getByRole("button", { name: "Aceptar", exact: true }).click();
  await expect(page.getByText("Error al aceptar cotización", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aceptar", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Archivo de cotización de proveedor", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("Valor de la orden de compra", { exact: true })).toBeEnabled();
});

test("no permite aceptar mientras guarda un valor ni editar documentos durante la aceptacion", async ({ page }) => {
  await openProcessing(page);
  let releaseValue;
  const valueGate = new Promise((resolve) => { releaseValue = resolve; });
  await page.route("**/won-documents/quotation/20/value", async (route) => {
    await valueGate;
    await route.fallback();
  });
  await page.getByLabel("Valor de la orden de compra", { exact: true }).fill("100");
  await page.getByLabel("Moneda de la orden de compra", { exact: true }).selectOption("USD");
  await page.getByRole("button", { name: "Guardar valor de orden", exact: true }).click();
  await expect(page.getByRole("button", { name: "Aceptar", exact: true })).toBeDisabled();
  releaseValue();
  await expect(page.getByRole("button", { name: "Aceptar", exact: true })).toBeEnabled();
  let releaseAcceptance;
  const acceptanceGate = new Promise((resolve) => { releaseAcceptance = resolve; });
  await page.route("**/quotation-versions/10/transition", async (route) => {
    await acceptanceGate;
    await route.fallback();
  });
  await page.getByRole("button", { name: "Aceptar", exact: true }).click();
  await expect(page.getByLabel("Archivo de cotización de proveedor", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Correo vendedor", exact: true })).toBeDisabled();
  releaseAcceptance();
  await expectAcceptedClosureLocked(page);
});

test("quita solo la cotizacion proveedor elegida y permite agregarla otra vez", async ({ page }) => {
  const state = await openProcessing(page);
  const picker = page.getByLabel("Archivo de cotización de proveedor", { exact: true });
  await picker.selectOption("quotation:31");
  await page.getByRole("button", { name: "Registrar cotización de proveedor", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Quitar cotización de proveedor del cierre: proveedor.pdf", exact: true }).click();
  await expect(page.getByText("proveedor.pdf", { exact: true })).toHaveCount(0);
  await expect(page.getByText("proveedor-adicional.pdf", { exact: true })).toBeVisible();
  await expect(picker.locator("option[value='quotation:30']")).toHaveCount(1);
  await expect(page.getByRole("group", { name: "Orden de compra: orden-cliente.pdf", exact: true })).toBeVisible();
  expect(state.providerRemovals).toEqual(["/api/quotation-versions/10/won-documents/provider-quotes/quotation/30"]);
  await page.getByRole("button", { name: "Cerrar procesamiento", exact: true }).click();
  await page.getByRole("cell", { name: "Proyecto OC", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cotizaciones de proveedores (1)", exact: true })).toBeVisible();
  await expect(picker.locator("option[value='quotation:30']")).toHaveCount(1);
  await picker.selectOption("quotation:30");
  await page.getByRole("button", { name: "Registrar cotización de proveedor", exact: true }).click();
  await expect(page.getByText("proveedor.pdf", { exact: true })).toBeVisible();
});

test("cancelar quitar proveedor conserva el documento", async ({ page }) => {
  const state = await openProcessing(page);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Quitar cotización de proveedor del cierre: proveedor.pdf", exact: true }).click();
  expect(state.providerRemovals).toEqual([]);
  await expect(page.getByText("proveedor.pdf", { exact: true })).toBeVisible();
});

test("presenta quitar proveedor con el mismo formato que quitar orden", async ({ page }) => {
  await openProcessing(page);
  const providerCard = page.getByRole("group", { name: "Cotización de proveedor: proveedor.pdf", exact: true });
  const orderCard = page.getByRole("group", { name: "Orden de compra: orden-cliente.pdf", exact: true });
  const providerButton = providerCard.getByRole("button", { name: /Quitar cotización de proveedor del cierre/ });
  const orderButton = orderCard.getByRole("button", { name: "Quitar orden de compra del cierre", exact: true });
  await expect(providerButton).toHaveText("Quitar del cierre");
  await expect(providerCard.getByRole("button", { name: "Descargar documento", exact: true })).toBeVisible();
  const appearance = (element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor, border: style.borderColor };
  };
  expect(await providerButton.evaluate(appearance)).toEqual(await orderButton.evaluate(appearance));
  const header = await providerCard.locator("article").boundingBox();
  const button = await providerButton.boundingBox();
  expect(button.y).toBeGreaterThanOrEqual(header.y + header.height);
});

test("alinea los selectores de cierre arriba sin estirar la columna con menos contenido", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openProcessing(page);
  const sections = page.locator(".processing-accepted-won-documents-card .accept-order-won-documents-section");
  const orderPicker = sections.nth(0).locator(".purchase-order-document-picker");
  const providerPicker = sections.nth(1).locator(".purchase-order-document-picker");
  await expect(providerPicker).toBeVisible();
  const orderBox = await orderPicker.boundingBox();
  const providerBox = await providerPicker.boundingBox();
  expect(Math.abs(orderBox.y - providerBox.y)).toBeLessThan(2);
  expect(await sections.nth(1).evaluate((element) => getComputedStyle(element).alignContent)).toBe("start");
  const title = await providerPicker.locator("strong").boundingBox();
  const description = await providerPicker.locator("p").first().boundingBox();
  expect(description.y - (title.y + title.height)).toBeLessThan(10);
  await page.setViewportSize({ width: 390, height: 844 });
  const providerSection = await sections.nth(1).boundingBox();
  const orderSection = await sections.nth(0).boundingBox();
  expect(providerSection.y).toBeGreaterThanOrEqual(orderSection.y + orderSection.height);
  expect(providerSection.width).toBeLessThanOrEqual(390);
});

test("un error al quitar proveedor conserva el documento y permite reintentar", async ({ page }) => {
  await openProcessing(page, { failProviderRemoval: true });
  page.once("dialog", (dialog) => dialog.accept());
  const button = page.getByRole("button", { name: "Quitar cotización de proveedor del cierre: proveedor.pdf", exact: true });
  await button.click();
  await expect(page.getByRole("alert")).toContainText("Error al quitar cotización de proveedor");
  await expect(page.getByText("proveedor.pdf", { exact: true })).toBeVisible();
  await expect(button).toBeEnabled();
});

test("agrega varias cotizaciones proveedor desde archivos de cotizacion y las conserva al reabrir", async ({ page }) => {
  const state = await openProcessing(page);
  const order = page.getByRole("group", { name: "Orden de compra: orden-cliente.pdf", exact: true });
  await order.getByLabel("Valor de la orden de compra", { exact: true }).fill("1500");
  await order.getByLabel("Moneda de la orden de compra", { exact: true }).selectOption("MXN");
  await order.getByRole("button", { name: "Guardar valor de orden", exact: true }).click();
  await expect(order.getByRole("status")).toContainText("Valor de orden de compra guardado.");
  const picker = page.getByLabel("Archivo de cotización de proveedor", { exact: true });
  await expect(page.getByRole("heading", { name: "Cotizaciones de proveedores (1)", exact: true })).toBeVisible();
  await expect(picker.locator("option[value='quotation:30']")).toHaveCount(0);
  await expect(picker.locator("option[value='quotation:20']")).toHaveCount(0);
  await expect(picker.locator("option[value='opportunity:21']")).toHaveCount(0);
  await picker.selectOption("quotation:31");
  await page.getByRole("button", { name: "Registrar cotización de proveedor", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cotizaciones de proveedores (2)", exact: true })).toBeVisible();
  await expect(picker.locator("option[value='quotation:31']")).toHaveCount(0);
  await picker.selectOption("quotation:32");
  await page.getByRole("button", { name: "Registrar cotización de proveedor", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cotizaciones de proveedores (3)", exact: true })).toBeVisible();
  expect(state.providerRegistrations).toEqual([
    { source: "quotation", documentId: 31 }, { source: "quotation", documentId: 32 },
  ]);
  await expect(page.getByRole("group", { name: "Orden de compra: orden-cliente.pdf", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar procesamiento", exact: true }).click();
  await page.getByRole("cell", { name: "Proyecto OC", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cotizaciones de proveedores (3)", exact: true })).toBeVisible();
  await expect(page.getByText("proveedor-adicional.pdf", { exact: true })).toBeVisible();
  await expect(page.getByText("proveedor-otra-version.pdf", { exact: true })).toBeVisible();
  await expect(page.getByText("proveedor.pdf", { exact: true })).toBeVisible();
  await expect(order.getByLabel("Valor de la orden de compra", { exact: true })).toHaveValue("1500");
  await expect(order.getByLabel("Moneda de la orden de compra", { exact: true })).toHaveValue("MXN");
  await expect(picker.locator("option[value='quotation:20']")).toHaveCount(0);
});

test("actualiza archivos disponibles para proveedor al agregar o quitar una orden de compra", async ({ page }) => {
  await openProcessing(page, { selected: false });
  const providerPicker = page.getByLabel("Archivo de cotización de proveedor", { exact: true });
  await expect(providerPicker.locator("option[value='quotation:20']")).toHaveCount(1);
  await page.getByLabel("Archivo de orden de compra", { exact: true }).selectOption("quotation:20");
  await page.getByRole("button", { name: "Registrar orden de compra", exact: true }).click();
  await expect(providerPicker.locator("option[value='quotation:20']")).toHaveCount(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Quitar orden de compra del cierre", exact: true }).click();
  await expect(providerPicker.locator("option[value='quotation:20']")).toHaveCount(1);
});

test("excluye del selector de ordenes los documentos de proveedor y actualiza al agregarlos o quitarlos", async ({ page }) => {
  await openProcessing(page);
  const orderPicker = page.getByLabel("Archivo de orden de compra", { exact: true });
  const providerPicker = page.getByLabel("Archivo de cotización de proveedor", { exact: true });
  await expect(orderPicker.locator("option[value='quotation:30']")).toHaveCount(0);
  await expect(orderPicker.locator("option[value='quotation:31']")).toHaveCount(1);
  await providerPicker.selectOption("quotation:31");
  await page.getByRole("button", { name: "Registrar cotización de proveedor", exact: true }).click();
  await expect(orderPicker.locator("option[value='quotation:31']")).toHaveCount(0);
  await page.getByRole("button", { name: "Cerrar procesamiento", exact: true }).click();
  await page.getByRole("cell", { name: "Proyecto OC", exact: true }).click();
  await expect(orderPicker.locator("option[value='quotation:31']")).toHaveCount(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Quitar cotización de proveedor del cierre: proveedor-adicional.pdf", exact: true }).click();
  await expect(orderPicker.locator("option[value='quotation:31']")).toHaveCount(1);
});

test("no permite agregar cotizaciones proveedor con acceso solo de consulta", async ({ page }) => {
  const state = await openProcessing(page, { canUpdate: false });
  await expect(page.getByLabel("Archivo de cotización de proveedor", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Registrar cotización de proveedor", exact: true })).toHaveCount(0);
  await expect(page.getByText("proveedor.pdf", { exact: true })).toBeVisible();
  expect(state.providerRegistrations).toEqual([]);
  await expect(page.getByRole("button", { name: /Quitar cotización de proveedor del cierre/ })).toHaveCount(0);
});

test("muestra errores al agregar una cotizacion proveedor sin alterar documentos existentes", async ({ page }) => {
  await openProcessing(page, { failProviderRegistration: true });
  await page.getByLabel("Archivo de cotización de proveedor", { exact: true }).selectOption("quotation:31");
  await page.getByRole("button", { name: "Registrar cotización de proveedor", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Error al registrar cotización de proveedor");
  await expect(page.getByRole("heading", { name: "Cotizaciones de proveedores (1)", exact: true })).toBeVisible();
  await expect(page.getByText("proveedor.pdf", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Orden de compra: orden-cliente.pdf", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar cotización de proveedor", exact: true })).toBeEnabled();
});

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
