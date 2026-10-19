import { expect, test } from "@playwright/test";

async function mountReview(page, { status = 200, completed = true } = {}) {
  const writes = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    if (request.url().endsWith("/api/opportunities/3/coach-reschedule")) {
      writes.push(request.postDataJSON());
      return route.fulfill({ status, json: status === 200
        ? { operation: { status: completed ? "completed" : "handed_off" } }
        : { message: "La actividad cambió. Vuelve al chat y revisa." } });
    }
    return route.fulfill({ status: 200, json: {} });
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const source = await (await fetch("/src/coach/CustomerRescheduleReview.jsx")).text();
    const reactPath = source.match(/from "(\/node_modules\/\.vite\/deps\/react\.js[^"]*)"/)[1];
    const React = (await import(reactPath)).default;
    const suffix = reactPath.slice(reactPath.indexOf("?"));
    const { createRoot } = (await import(`/node_modules/.vite/deps/react-dom_client.js${suffix}`)).default;
    const { CustomerRescheduleReview } = await import("/src/coach/CustomerRescheduleReview.jsx");
    const element = document.createElement("div");
    element.id = "a06-review-fixture";
    document.body.appendChild(element);
    const root = createRoot(element);
    globalThis.__a06Saved = false;
    globalThis.__a06Cleanup = () => { root.unmount(); element.remove(); delete globalThis.__a06Saved; delete globalThis.__a06Cleanup; };
    root.render(React.createElement(CustomerRescheduleReview, {
      token: "44a6bf85-cd5a-431e-9697-fd0b2da5e9f6", canSave: true,
      handoff: { version: 2, payload: { kind: "reschedule_activity", activityId: 75, opportunityId: 3,
        scheduleSummary: { accountName: "Cuenta ficticia", opportunityName: "Proyecto ficticio", activityTitle: "Reunión Compras",
          before: "2030-10-20T10:00:00", after: "2030-10-23T10:00:00", timeZone: "America/Mexico_City" } } },
      onSaved: () => { globalThis.__a06Saved = true; },
    }));
  });
  return writes;
}
test.afterEach(async ({ page }) => { await page.evaluate(() => globalThis.__a06Cleanup?.()); });
test("A06 review preserves identity and writes only after explicit confirmation", async ({ page }) => {
  const writes = await mountReview(page);
  const panel = page.getByRole("region", { name: "Revisar reprogramación" });
  await expect(panel).toContainText("Programación actual: 2030-10-20T10:00:00");
  await expect(panel).toContainText("Programación propuesta: 2030-10-23T10:00:00");
  await expect(panel).toContainText("ID 75");
  await expect(panel).toContainText("no se creará otra actividad");
  expect(writes).toEqual([]);
  await panel.getByRole("button", { name: "Confirmar y reprogramar" }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__a06Saved)).toBe(true);
  expect(writes).toEqual([{ token: "44a6bf85-cd5a-431e-9697-fd0b2da5e9f6", version: 2 }]);
});
test("A06 concurrent conflict leaves proposal unsaved with visible error", async ({ page }) => {
  await mountReview(page, { status: 409 });
  const panel = page.getByRole("region", { name: "Revisar reprogramación" });
  await panel.getByRole("button", { name: "Confirmar y reprogramar" }).click();
  await expect(panel.getByRole("alert")).toContainText("La actividad cambió");
  expect(await page.evaluate(() => globalThis.__a06Saved)).toBe(false);
  await expect(panel).toContainText("propuesta no guardada");
});
test("A06 incomplete response never credits a saved schedule", async ({ page }) => {
  await mountReview(page, { completed: false });
  const panel = page.getByRole("region", { name: "Revisar reprogramación" });
  await panel.getByRole("button", { name: "Confirmar y reprogramar" }).click();
  await expect(panel.getByRole("alert")).toContainText("no confirmó la reprogramación");
  expect(await page.evaluate(() => globalThis.__a06Saved)).toBe(false);
});
