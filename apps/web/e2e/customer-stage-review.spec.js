import { expect, test } from "@playwright/test";

async function mountReview(page, { initialStarted = false, jobStatus = "completed", postStatus = 202, malformed = false,
  readStatus = 200, canValidate = true } = {}) {
  const writes = [];
  let started = initialStarted;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    if (request.url().includes("/api/opportunities/3/coach-stage-validation")) {
      if (request.method() === "POST") {
        writes.push(request.postDataJSON());
        if (postStatus !== 202) return route.fulfill({ status: postStatus, json: { message: "Faltan respuestas guardadas" } });
        started = !malformed;
        return route.fulfill({ status: 202, json: malformed ? {} : { job: { id: "existing-job", status: "pending" } } });
      }
      if (readStatus !== 200) return route.fulfill({ status: readStatus, json: { message: "Solicitud no vigente" } });
      const completed = started && jobStatus === "completed";
      return route.fulfill({ status: 200, json: {
        operation: { version: 2, status: completed ? "completed" : "handed_off",
          result: started ? { validationJobId: "existing-job", outcome: completed ? "validated_without_advance" : "validation_pending" } : null },
        validation: started ? { job: { id: "existing-job", status: jobStatus, pollAfterMs: 100 },
          ...(completed ? { result: { message: "Sin avance automático", validation: {
            decision: "advance_with_caution", summary: "Resultado original", reasons: ["Evidencia insuficiente"] } } } : {}),
          ...(["failed", "stale", "expired"].includes(jobStatus) ? { error: { message: "Error original del validador" } } : {}),
        } : null,
      } });
    }
    return route.fulfill({ status: 200, json: {} });
  });
  await page.goto("/");
  await page.evaluate(async ({ canValidate }) => {
    const source = await (await fetch("/src/coach/CustomerStageReview.jsx")).text();
    const reactPath = source.match(/from "(\/node_modules\/\.vite\/deps\/react\.js[^"]*)"/)[1];
    const React = (await import(reactPath)).default;
    const suffix = reactPath.slice(reactPath.indexOf("?"));
    const { createRoot } = (await import(`/node_modules/.vite/deps/react-dom_client.js${suffix}`)).default;
    const { CustomerStageReview } = await import("/src/coach/CustomerStageReview.jsx");
    const element = document.createElement("div"); document.body.appendChild(element);
    const root = createRoot(element);
    globalThis.__a08Finished = false;
    globalThis.__a08Cleanup = () => { root.unmount(); element.remove(); delete globalThis.__a08Finished; delete globalThis.__a08Cleanup; };
    root.render(React.createElement(CustomerStageReview, {
      token: "44a6bf85-cd5a-431e-9697-fd0b2da5e9f6", canValidate,
      handoff: { version: 2, payload: { kind: "validate_stage", opportunityId: 3, stageSummary: {
        accountName: "Cuenta ficticia", opportunityName: "Proyecto ficticio", currentStageName: "Inicial", targetStageName: "Negociación" } } },
      onOpenOpportunity: async () => { throw new Error("No se pudo abrir el formulario"); },
      onFinished: async () => { globalThis.__a08Finished = true; },
    }));
  }, { canValidate });
  return writes;
}
test.afterEach(async ({ page }) => { await page.evaluate(() => globalThis.__a08Cleanup?.()); });
const panel = (page) => page.getByRole("region", { name: "Validar avance desde Mi Coach" });
const startButton = (page) => panel(page).getByRole("button", { name: "Solicitar validación con IA (puede avanzar)", exact: true });
test("A08 evaluates only after explicit request and retains the original result until closed", async ({ page }) => {
  const writes = await mountReview(page);
  await expect(startButton(page)).toBeEnabled();
  expect(writes).toEqual([]);
  await startButton(page).click();
  await expect(panel(page).getByRole("region", { name: "Resultado de validación" })).toContainText("Resultado original");
  await expect(panel(page)).toContainText("Evidencia insuficiente");
  expect(writes).toEqual([{ token: "44a6bf85-cd5a-431e-9697-fd0b2da5e9f6", version: 2 }]);
  expect(await page.evaluate(() => globalThis.__a08Finished)).toBe(false);
  await panel(page).getByRole("button", { name: "Cerrar resultado" }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__a08Finished)).toBe(true);
});
test("A08 rehydrated running job is polled without starting again", async ({ page }) => {
  const writes = await mountReview(page, { initialStarted: true, jobStatus: "running" });
  await expect(panel(page).getByRole("status")).toContainText("running");
  await expect(startButton(page)).toHaveCount(0);
  expect(writes).toEqual([]);
});
for (const jobStatus of ["failed", "stale", "expired"]) {
  test(`A08 preserves ${jobStatus} without automatic retry or false completion`, async ({ page }) => {
    const writes = await mountReview(page, { initialStarted: true, jobStatus });
    await expect(panel(page).getByRole("alert")).toContainText("Error original del validador");
    await expect(startButton(page)).toHaveCount(0);
    await expect(panel(page).getByRole("button", { name: "Cerrar resultado" })).toHaveCount(0);
    expect(writes).toEqual([]);
  });
}
test("A08 keeps prerequisite errors visible and status retry does not execute a validator", async ({ page }) => {
  const writes = await mountReview(page, { postStatus: 400 });
  await startButton(page).click();
  await expect(panel(page).getByRole("alert")).toContainText("Faltan respuestas guardadas");
  await expect(startButton(page)).toBeDisabled();
  await panel(page).getByRole("button", { name: "Consultar estado nuevamente" }).click();
  await expect(startButton(page)).toBeEnabled();
  expect(writes).toHaveLength(1);
});
test("A08 malformed job acknowledgement never credits completion", async ({ page }) => {
  await mountReview(page, { malformed: true });
  await startButton(page).click();
  await expect(panel(page).getByRole("alert")).toContainText("El validador no confirmó el trabajo");
  await expect(panel(page).getByRole("button", { name: "Cerrar resultado" })).toHaveCount(0);
});
test("A08 a stale read blocks execution", async ({ page }) => {
  const writes = await mountReview(page, { readStatus: 409 });
  await expect(panel(page).getByRole("alert")).toContainText("Solicitud no vigente");
  await expect(startButton(page)).toBeDisabled();
  expect(writes).toEqual([]);
});
test("A08 denied execution remains read-only and form errors are visible", async ({ page }) => {
  const writes = await mountReview(page, { canValidate: false });
  await expect(startButton(page)).toBeDisabled();
  await panel(page).getByRole("button", { name: "Revisar respuestas en Oportunidades" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("No se pudo abrir el formulario");
  expect(writes).toEqual([]);
});
