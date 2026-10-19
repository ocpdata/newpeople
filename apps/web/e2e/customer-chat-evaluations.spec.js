import { expect, test } from "@playwright/test";
import { businessImpacts, operationBusinessImpacts } from "../../api/src/customer-chat-evaluations/business-impact.js";
const runId = "44a6bf85-cd5a-431e-9697-fd0b2da5e9f6";
const otherId = "77769f2d-6399-4e7e-9d4e-0601efc57f50";
async function openEvaluations(page, { execute = true, read = true, write = false, status = "completed", failLaunch = false,
  emptyHistory = false, actionHistory = [], actionKind = "validate_stage", failActionRead = false, activityHistory } = {}) {
  const requests = { launches: [], preflights: 0, reviews: [], actions: [], cancellations: 0, exports: 0 };
  let runStatus = status, review = null;
  const definition = { id: "Q01-01", category: "Q01", accountId: 22, title: "Resumen de Totalplay", businessImpact: businessImpacts.none,
    steps: [{ question: "Resume Totalplay", expected: "Resumen autorizado" }] };
  const operation = { kind: actionKind, accountId: 22, opportunityId: 36, title: "Propuesta sobre Hardware Refresh", missingFields: [] };
  const result = { reason: "Revisión semántica pendiente", steps: [{
    question: "Resume Totalplay", expected: "Resumen autorizado", answer: "Respuesta real registrada", activityHistory,
    checks: [{ name: "Respuesta presente", passed: true, detail: "Texto disponible" }], operations: write ? [operation] : [],
  }] };
  await page.addInitScript(() => localStorage.setItem("crm_token", "evaluation-browser-test"));
  await page.route("**/api/**", async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const json = (data, status = 200) => route.fulfill({ status, json: data });
    if (path === "/api/auth/bootstrap-status") return json({ hasUsers: true });
    if (path === "/api/auth/me") return json({ id: 31, full_name: "Evaluador", roles: [], permissions: [
      "mi_coach.access", ...(read ? ["mi_coach.evaluations_read"] : []),
      ...(execute ? ["mi_coach.evaluations_execute"] : []), ...(write ? ["mi_coach.evaluations_write"] : []),
    ] });
    if (!path.startsWith("/api/mi-agent/evaluations")) return json({});
    if (path.endsWith("/catalog")) return json({ version: "catalog-test", categories: ["Q01", "A08", "A05", "A02"],
      smokeCaseIds: ["Q01-01", "A08-04"], operationBusinessImpacts, cases: [definition,
        { ...definition, id: "A08-04", category: "A08", title: "Valida el avance", businessImpact: businessImpacts.validation },
        { ...definition, id: "A08-06", category: "A08", title: "Solo evalúa, sin cambiar", businessImpact: businessImpacts.none },
        { ...definition, id: "A05-01", category: "A05", title: "Prepara una llamada", businessImpact: businessImpacts.module },
        { ...definition, id: "A02-01", category: "A02", title: "Prepara cambiar monto", businessImpact: businessImpacts.confirm },
      ] });
    if (path.endsWith("/preflight")) {
      requests.preflights += 1;
      return json({ instance: "Instancia actual", model: "test-model", userId: 31, providerReady: true, catalogVersion: "catalog-test",
        cases: 1, accounts: [{ accountId: 22, ready: true, reference: { account: { name: "Totalplay" } } }] });
    }
    if (path.endsWith("/runs") && req.method() === "POST") {
      requests.launches.push(req.postDataJSON());
      return json(failLaunch ? { message: "Ya hay una evaluación activa" } : { id: runId }, failLaunch ? 409 : 202);
    }
    if (path.endsWith("/runs")) return json({ page: 1, hasMore: false, runs: emptyHistory ? [] : [
      { id: runId, status: runStatus, created_at: "2026-10-17" },
      { id: otherId, status: "completed", created_at: "2026-10-16" },
    ] });
    if (path.endsWith("/cancel")) {
      requests.cancellations += 1; runStatus = "cancelled"; return json({ cancellationRequested: true });
    }
    if (path.endsWith("/review")) {
      review = req.postDataJSON(); requests.reviews.push(review); return json({ reviewed: true });
    }
    if (path.endsWith("/actions") && req.method() === "POST") {
      requests.actions.push(req.postDataJSON()); return json({ outcome: "validation_pending", job: { id: "original-job" } });
    }
    if (path.endsWith("/actions")) return failActionRead ? json({ message: "No se pudo reconciliar la acción" }, 409)
      : json({ actions: actionHistory, warning: "No se repite la ejecución" });
    if (path.endsWith("/cases/1")) return json({ id: 1, caseId: "Q01-01", status: "human_review", definition, result, review });
    if (path.endsWith("/export")) {
      requests.exports += 1;
      return json({ runId: path.includes(otherId) ? otherId : runId, configuration: { catalogVersion: "catalog-test", runtime: { model: "test-model" } },
        cases: [{ caseId: "Q01-01", repetition: 1, status: path.includes(otherId) ? "failed" : "human_review", result }],
        summary: { total: 1 } });
    }
    return json({ run: { id: runId, status: runStatus, configuration: {}, cancelRequested: runStatus === "cancelled" },
      counts: { human_review: 1 }, cases: [{ id: 1, case_id: "Q01-01", repetition: 1, status: "human_review",
        businessImpact: businessImpacts.none, review }], hasMore: false });
  });
  await page.goto("/mi-agent");
  return requests;
}
test("evaluation tab uses the current instance and requires preflight plus paid-call consent", async ({ page }) => {
  const requests = await openEvaluations(page);
  const panel = page.getByRole("region", { name: "Pruebas del chat", exact: true });
  await expect(panel).toContainText("instancia actual");
  await expect(panel.getByRole("button", { name: "Ejecutar pruebas", exact: true })).toBeDisabled();
  expect(requests.launches).toEqual([]);
  await panel.getByRole("button", { name: "Verificar entorno" }).click();
  await expect(panel).toContainText("test-model");
  await panel.getByLabel(/Autorizo llamadas reales/).check();
  await panel.getByRole("button", { name: "Ejecutar pruebas", exact: true }).click();
  await expect.poll(() => requests.launches.length).toBe(1);
  expect(requests.launches[0]).toMatchObject({ suite: "smoke", acknowledgePaidCalls: true, repetitions: 1 });
  expect(requests.launches[0]).not.toHaveProperty("url");
  expect(requests.actions).toEqual([]);
  await expect(page.getByRole("region", { name: "Resultado de ejecución" })).toBeVisible();
});
test("evaluation tab read-only permission does not enable paid executions", async ({ page }) => {
  const requests = await openEvaluations(page, { execute: false });
  await expect(page.getByRole("button", { name: "Pruebas del chat", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Verificar entorno" })).toBeDisabled();
  expect(requests.preflights).toBe(0);
  await expect(page.getByText("Tienes acceso de consulta:", { exact: false })).toBeVisible();
});
test("evaluation setup explains each step and category filters only selected cases", async ({ page }) => {
  const requests = await openEvaluations(page);
  await expect(page.getByRole("heading", { name: "Elige qué quieres probar" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Verifica el entorno" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Autoriza e inicia la prueba" })).toBeVisible();
  const category = page.getByLabel(/^Categoría/);
  await expect(category).toBeDisabled();
  await page.getByLabel(/^Conjunto/).selectOption("selected");
  await expect(category).toBeEnabled();
  await category.selectOption({ label: "Q01 · Resumen de cuenta" });
  await expect(page.getByText("0 casos seleccionados", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Verificar entorno" }).click();
  await page.getByLabel(/Autorizo llamadas reales/).check();
  await expect(page.getByRole("button", { name: "Ejecutar pruebas", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Seleccionar categoría visible" }).click();
  await expect(page.getByText("1 caso seleccionado", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ejecutar pruebas", exact: true }).click();
  await expect.poll(() => requests.launches.length).toBe(1);
  expect(requests.launches[0]).toMatchObject({ suite: "selected", caseIds: ["Q01-01"] });
});
test("evaluation empty state and mobile controls stay readable without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = await openEvaluations(page, { emptyHistory: true });
  await expect(page.getByText("Aún no hay ejecuciones en esta página")).toBeVisible();
  const panel = page.getByRole("region", { name: "Pruebas del chat", exact: true });
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const checkbox = page.getByLabel(/Autorizo llamadas reales/);
  const bounds = await checkbox.boundingBox();
  expect(bounds.width).toBe(18);
  expect(bounds.height).toBe(18);
  const fields = [page.getByLabel(/^Repeticiones/), page.getByLabel(/^Límite de mensajes/), page.getByLabel(/^Límite de minutos/)];
  const positions = await Promise.all(fields.map((field) => field.boundingBox()));
  expect(positions[1].y).toBeGreaterThan(positions[0].y + positions[0].height);
  expect(positions[2].y).toBeGreaterThan(positions[1].y + positions[1].height);
  expect(requests.launches).toEqual([]);
});
test("evaluation result explains technical completion separately from human approval", async ({ page }) => {
  await openEvaluations(page);
  await page.getByRole("button", { name: new RegExp(`^${runId}`) }).click();
  const result = page.getByRole("region", { name: "Resultado de ejecución" });
  await expect(result).toContainText("no que todas las respuestas sean correctas");
  await expect(result.getByRole("progressbar", { name: "Progreso de casos" })).toHaveAttribute("value", "1");
  await result.getByText("Cómo interpretar los resultados", { exact: true }).click();
  await expect(result).toContainText("aún debes verificar los datos, la utilidad y las expectativas del caso");
});
test("evaluation tab is hidden without its own read permission", async ({ page }) => {
  await openEvaluations(page, { read: false, execute: false });
  await expect(page.getByRole("button", { name: "Pruebas del chat", exact: true })).toHaveCount(0);
});
test("evaluation history survives reload without launching another run", async ({ page }) => {
  const requests = await openEvaluations(page);
  await page.getByRole("button", { name: new RegExp(`^${runId}`) }).click();
  await expect(page.getByRole("region", { name: "Resultado de ejecución" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Resultado de ejecución" })).toBeVisible();
  expect(requests.launches).toEqual([]);
});
test("evaluation detail preserves expectations and requires a justified human review", async ({ page }) => {
  const requests = await openEvaluations(page);
  await page.getByRole("button", { name: new RegExp(`^${runId}`) }).click();
  await page.getByRole("button", { name: "Ver Q01-01", exact: true }).click();
  const detail = page.getByRole("region", { name: "Detalle del caso" });
  await expect(detail).toContainText("Respuesta real registrada");
  await expect(detail).toContainText("Resumen autorizado");
  await expect(detail.getByRole("button", { name: "Aprobar semántica" })).toBeDisabled();
  await detail.getByLabel("Justificación").fill("Verificado contra la cuenta y los datos actuales");
  await detail.getByRole("button", { name: "Aprobar semántica" }).click();
  await expect.poll(() => requests.reviews.length).toBe(1);
  expect(requests.reviews[0].decision).toBe("approved");
});
test("evaluation detail renders stored history with date meaning and link provenance without launching calls", async ({ page }) => {
  const requests = await openEvaluations(page, { activityHistory: {
    mode: "timeline", coverage: [{ source: "interactions", status: "partial" }], warnings: ["Lectura parcial."],
    sections: [{ key: "timeline", title: "Cronología registrada", available: true, items: [
      { id: "interactions:1", title: "Seguimiento sintético", sourceTitle: "Interacciones", recordId: 1,
        date: "2026-06-01", dateMeaning: "Creación de interacción", accountLink: "Mediante oportunidad",
        details: "Registro creado; conversación no acreditada." },
    ] }],
  } });
  await page.getByRole("button", { name: new RegExp(`^${runId}`) }).click();
  await page.getByRole("button", { name: "Ver Q01-01", exact: true }).click();
  const detail = page.getByRole("region", { name: "Detalle del caso" });
  await detail.getByText("Historial estructurado devuelto por el chat", { exact: true }).click();
  const chronology = detail.getByRole("heading", { name: "Cronología registrada" }).locator("..");
  await expect(chronology).toContainText("Seguimiento sintético");
  await expect(chronology).toContainText("Creación de interacción");
  await expect(chronology).toContainText("Mediante oportunidad");
  await expect(chronology).toContainText("conversación no acreditada");
  expect(requests.launches).toEqual([]);
  expect(requests.actions).toEqual([]);
});
test("evaluation supports exporting and comparing immutable runs", async ({ page }) => {
  const requests = await openEvaluations(page);
  await page.getByRole("button", { name: new RegExp(`^${runId}`) }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar JSON" }).click();
  expect((await download).suggestedFilename()).toBe(`evaluacion-${runId}.json`);
  await page.getByLabel("Comparar con").selectOption(otherId);
  await page.getByRole("button", { name: "Comparar ejecuciones" }).click();
  await expect(page.getByRole("region", { name: "Comparación de ejecuciones" })).toContainText("Fallido → Revisión humana");
  expect(requests.exports).toBe(3);
});
test("evaluation cancellation stops future steps without claiming rollback", async ({ page }) => {
  const requests = await openEvaluations(page, { status: "running" });
  await page.getByRole("button", { name: new RegExp(`^${runId}`) }).click();
  await page.getByRole("button", { name: "Detener próximos pasos" }).click();
  await expect.poll(() => requests.cancellations).toBe(1);
  await expect(page.getByRole("region", { name: "Resultado de ejecución" })).toContainText("Cancelada");
  expect(requests.actions).toEqual([]);
});
test("evaluation launch errors are visible without a success-shaped fallback", async ({ page }) => {
  await openEvaluations(page, { failLaunch: true });
  await page.getByRole("button", { name: "Verificar entorno" }).click();
  await page.getByLabel(/Autorizo llamadas reales/).check();
  await page.getByRole("button", { name: "Ejecutar pruebas", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Ya hay una evaluación activa");
});
test("evaluation writes require an explicit reviewed account and separate confirmation", async ({ page }) => {
  const requests = await openEvaluations(page, { write: true });
  await page.getByRole("button", { name: new RegExp(`^${runId}`) }).click();
  await page.getByRole("button", { name: "Ver Q01-01", exact: true }).click();
  await expect(page.getByText("A08 puede avanzar la etapa.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar acción 1" })).toBeDisabled();
  expect(requests.actions).toEqual([]);
  await page.getByLabel("Justificación").fill("Revisé la identidad y el destino de esta propuesta");
  await page.getByRole("button", { name: "Aprobar semántica" }).click();
  await expect.poll(() => requests.reviews.length).toBe(1);
  await page.getByLabel("ID de cuenta autorizada para esta prueba").fill("22");
  await page.getByLabel(/Revisé la propuesta/).check();
  await page.getByRole("button", { name: "Confirmar acción 1" }).click();
  await expect.poll(() => requests.actions.length).toBe(1);
  expect(requests.actions[0]).toEqual({ operationIndex: 0, accountId: 22, acknowledgeBusinessWrite: true });
  await expect(page.getByRole("region", { name: "Efectos reales de las acciones" }))
    .toContainText("Validación iniciada · resultado pendiente");
});
test("evaluation marks per-case business effects and summarizes the selected suite without executing them", async ({ page }) => {
  const requests = await openEvaluations(page);
  const summary = page.getByRole("complementary", { name: "Efectos de negocio de la selección" });
  await expect(summary).toContainText("Validación con posible autoavance de etapa: 1");
  await expect(summary).toContainText("Sin confirmación de negocio prevista: 1");
  await summary.getByText("Ver marcas de los casos de este conjunto").click();
  await expect(summary).toContainText("A08-04");
  await expect(summary).toContainText("Puede avanzar la etapa");
  await page.getByLabel(/^Conjunto/).selectOption("selected");
  await page.getByLabel(/^Categoría/).selectOption("A08");
  const advance = page.locator("label").filter({ has: page.getByRole("checkbox", { name: /A08-04/ }) });
  const evaluateOnly = page.locator("label").filter({ has: page.getByRole("checkbox", { name: /A08-06/ }) });
  await expect(advance).toContainText("Puede avanzar la etapa");
  await expect(evaluateOnly).toContainText("Sin confirmación de negocio");
  await page.getByRole("checkbox", { name: /A08-04/ }).check();
  await expect(summary).toContainText("Validación con posible autoavance de etapa: 1");
  await page.getByLabel(/^Conjunto/).selectOption("full");
  await expect(summary).toContainText("Modificación de datos con confirmación adicional: 1");
  await expect(summary).toContainText("Creación de registros al guardar en el módulo: 1");
  expect(requests.actions).toEqual([]);
  expect(requests.launches).toEqual([]);
});
for (const scenario of [
  { name: "pending validator", kind: "validate_stage", status: "submitted", result: { outcome: "validation_pending" },
    label: "Validación iniciada · resultado pendiente", confirmed: false },
  { name: "module handoff", kind: "activity", status: "module_review_required", result: { outcome: "module_review_required" },
    label: "Pendiente de guardar en el módulo", confirmed: false },
  { name: "confirmed field update", kind: "opportunity_field", status: "completed", result: { operation: { status: "completed" } },
    label: "Cambio confirmado por el módulo", confirmed: true },
  { name: "confirmed stage advancement", kind: "validate_stage", status: "submitted",
    result: { operation: { status: "completed", result: { outcome: "advanced" } } },
    label: "Cambio confirmado por el módulo", confirmed: true },
  { name: "validator without advancement", kind: "validate_stage", status: "submitted",
    result: { operation: { status: "completed", result: { outcome: "validated_without_advance" } } },
    label: "Validación finalizada sin avance", confirmed: false },
  { name: "uncertain write", kind: "opportunity_field", status: "uncertain", result: { reconciliationRequired: true },
    label: "Resultado incierto o no completado", confirmed: false },
  { name: "ledger without module confirmation", kind: "opportunity_field", status: "completed", result: {},
    label: "Sin cambio confirmado", confirmed: false },
]) {
  test(`evaluation distinguishes ${scenario.name} from an approved chat answer`, async ({ page }) => {
    const requests = await openEvaluations(page, { write: true, actionKind: scenario.kind,
      actionHistory: [{ key: "recorded-action", status: scenario.status, proposal: { kind: scenario.kind, accountId: 22 }, result: scenario.result }] });
    await page.getByRole("button", { name: new RegExp(`^${runId}`) }).click();
    await page.getByRole("button", { name: "Ver Q01-01", exact: true }).click();
    const actions = page.getByRole("region", { name: "Efectos reales de las acciones" });
    await expect(actions).toContainText(scenario.label);
    await expect(actions.getByText("Cambio confirmado por el módulo", { exact: true })).toHaveCount(scenario.confirmed ? 1 : 0);
    await expect(actions).toContainText(operationBusinessImpacts[scenario.kind].label);
    expect(requests.actions).toEqual([]);
    await page.getByRole("button", { name: "Consultar estado de acciones sin repetir" }).click();
    await expect(actions).toContainText(scenario.label);
    expect(requests.actions).toEqual([]);
  });
}
test("evaluation keeps evidence readable and does not imply no changes when action reconciliation fails", async ({ page }) => {
  await openEvaluations(page, { failActionRead: true });
  await page.getByRole("button", { name: new RegExp(`^${runId}`) }).click();
  await page.getByRole("button", { name: "Ver Q01-01", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("No se pudo reconciliar la acción");
  const detail = page.getByRole("region", { name: "Detalle del caso" });
  await expect(detail).toContainText("Respuesta real registrada");
  await expect(detail).toContainText("no asumas que no hubo cambios");
  await expect(detail).not.toContainText("No hay confirmaciones de negocio registradas");
});
