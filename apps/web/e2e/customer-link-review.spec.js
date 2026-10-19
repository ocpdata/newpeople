import { expect, test } from "@playwright/test";

async function mountReview(page, { status = 200, completed = true } = {}) {
  const writes = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    if (request.url().endsWith("/api/opportunities/3/coach-contact")) {
      writes.push(request.postDataJSON());
      return route.fulfill({ status, json: status === 200
        ? { operation: { status: completed ? "completed" : "handed_off" } }
        : { message: "El contacto asociado cambió. Vuelve a revisar." } });
    }
    return route.fulfill({ status: 200, json: {} });
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const source = await (await fetch("/src/coach/CustomerLinkReview.jsx")).text();
    const reactPath = source.match(/from "(\/node_modules\/\.vite\/deps\/react\.js[^"]*)"/)[1];
    const React = (await import(reactPath)).default;
    const suffix = reactPath.slice(reactPath.indexOf("?"));
    const { createRoot } = (await import(`/node_modules/.vite/deps/react-dom_client.js${suffix}`)).default;
    const { CustomerLinkReview } = await import("/src/coach/CustomerLinkReview.jsx");
    const element = document.createElement("div");
    element.id = "a04-review-fixture";
    document.body.appendChild(element);
    const root = createRoot(element);
    globalThis.__a04Saved = false;
    globalThis.__a04Cleanup = () => { root.unmount(); element.remove(); delete globalThis.__a04Saved; delete globalThis.__a04Cleanup; };
    root.render(React.createElement(CustomerLinkReview, {
      token: "44a6bf85-cd5a-431e-9697-fd0b2da5e9f6", canSave: true,
      handoff: { version: 2, payload: { linkDraftId: "77769f2d-6399-4e7e-9d4e-0601efc57f50", opportunityId: 3,
        linkSummary: { accountName: "Cuenta ficticia", opportunityName: "Proyecto ficticio",
          currentContactName: "Persona Anterior", contactName: "Elena Prueba", effect: "replace" } } },
      onSaved: () => { globalThis.__a04Saved = true; },
    }));
  });
  return writes;
}
test.afterEach(async ({ page }) => {
  await page.evaluate(() => globalThis.__a04Cleanup?.());
});
test("A04 module review shows replacement and writes only after explicit confirmation", async ({ page }) => {
  const writes = await mountReview(page);
  const panel = page.getByRole("region", { name: "Revisar vínculo contacto-oportunidad" });
  await expect(panel).toContainText("Contacto actual: Persona Anterior");
  await expect(panel).toContainText("Contacto propuesto: Elena Prueba");
  await expect(panel).toContainText("No se conservarán ambos contactos");
  expect(writes).toEqual([]);
  await panel.getByRole("button", { name: "Confirmar y guardar vínculo" }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__a04Saved)).toBe(true);
  expect(writes).toEqual([{ token: "44a6bf85-cd5a-431e-9697-fd0b2da5e9f6", version: 2 }]);
});
test("A04 module review preserves the unsaved proposal on concurrent-change rejection", async ({ page }) => {
  await mountReview(page, { status: 409 });
  const panel = page.getByRole("region", { name: "Revisar vínculo contacto-oportunidad" });
  await panel.getByRole("button", { name: "Confirmar y guardar vínculo" }).click();
  await expect(panel.getByRole("alert")).toContainText("El contacto asociado cambió");
  expect(await page.evaluate(() => globalThis.__a04Saved)).toBe(false);
  await expect(panel).toContainText("propuesta no guardada");
});
test("A04 module review never treats an incomplete server response as a saved relationship", async ({ page }) => {
  await mountReview(page, { completed: false });
  const panel = page.getByRole("region", { name: "Revisar vínculo contacto-oportunidad" });
  await panel.getByRole("button", { name: "Confirmar y guardar vínculo" }).click();
  await expect(panel.getByRole("alert")).toContainText("no confirmó el guardado");
  expect(await page.evaluate(() => globalThis.__a04Saved)).toBe(false);
});
