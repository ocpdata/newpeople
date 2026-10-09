import { expect, test } from "@playwright/test";

const labels = [
  "Llamada",
  "Reunión presencial",
  "Reunión virtual",
  "Presentación",
  "Demostración",
  "Visita",
  "Correo",
  "Propuesta",
  "Evento",
  "Otro",
];

async function mockCalendar(
  page,
  {
    canUpdate = true,
    expired = false,
    failComplete = false,
    missingDate = false,
    calendarKind = "standalone",
    withRelations = false,
    failSave = false,
  } = {},
) {
  const requests = { creates: [], completes: [], cancels: [] };
  await page.addInitScript(() =>
    localStorage.setItem("crm_token", "calendar-test"),
  );
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (pathname === "/api/auth/bootstrap-status")
      return json({ hasUsers: true });
    if (pathname === "/api/auth/me")
      return json({
        id: 31,
        full_name: "Seller",
        roles: [],
        permissions: [
          "mi_coach.use",
          "mi_coach.execute",
          "oportunidades.read",
          "calendario_comercial.read",
          ...(canUpdate ? ["calendario_comercial.update"] : []),
        ],
      });
    if (pathname === "/api/mi-agent/coach/handoffs/calendar-test") {
      if (expired)
        return json({ message: "El borrador no existe o expiró" }, 404);
      expect(new URL(route.request().url()).searchParams.get("module")).toBe(
        "calendar",
      );
      return json({
        handoff: {
          operationId: 22,
          kind: "activity",
          module: "calendar",
          payload: {
            kind: "activity",
            calendarKind,
            opportunityId: calendarKind === "opportunity" ? 44 : null,
            interactionId: calendarKind === "lead" ? 55 : null,
            accountId: withRelations ? 33 : null,
            contactId: withRelations ? 66 : null,
            title: "Revisar arquitectura",
            actionType: "demo",
            scheduledAt: missingDate ? "" : "2026-12-15T10:30",
            notes: "Contexto del chat",
            successCriteria: "Acordar piloto",
          },
        },
      });
    }
    if (pathname.endsWith("/calendar/activities") && method === "POST") {
      requests.creates.push(route.request().postDataJSON());
      if (failSave) return json({ message: "Error al guardar actividad" }, 500);
      return json({ id: 901, kind: "standalone" }, 201);
    }
    if (pathname.endsWith("/calendar-test/complete")) {
      requests.completes.push(route.request().postDataJSON());
      if (failComplete && requests.completes.length === 1)
        return json(
          { message: "Confirmación temporalmente no disponible" },
          500,
        );
      return json({ operation: { id: 22, status: "completed" } });
    }
    if (pathname.endsWith("/calendar-test/cancel")) {
      requests.cancels.push(route.request().postDataJSON());
      return json({ operation: { id: 22, status: "cancelled" } });
    }
    if (pathname.endsWith("/calendar"))
      return json({ sellers: [], days: [], alerts: {}, indicators: {} });
    if (pathname === "/api/accounts")
      return json([{ id: 33, name: "Cuenta vinculada" }]);
    if (pathname === "/api/contacts")
      return json([{ id: 66, first_name: "Ana", last_name: "Perez" }]);
    if (pathname === "/api/interactions")
      return json({
        items: [
          { id: 55, title: "Lead vinculado", analysisStatus: "lead_assigned" },
        ],
      });
    if (pathname === "/api/commercial-tracking/open-opportunities")
      return json({ items: [{ id: 44, name: "Oportunidad vinculada" }] });
    return json({});
  });
  await page.goto("/calendar?coachDraft=calendar-test");
  return requests;
}

test("opens an editable draft with the ten types and saves only on confirmation", async ({
  page,
}) => {
  const requests = await mockCalendar(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "Objetivo", exact: true }),
  ).toHaveValue("Revisar arquitectura");
  await expect(
    dialog.getByRole("textbox", { name: "Nota", exact: true }),
  ).toHaveValue("Contexto del chat");
  await expect(
    dialog.getByRole("textbox", { name: "Resultado esperado", exact: true }),
  ).toHaveValue("Acordar piloto");
  await expect(
    dialog.getByRole("combobox", { name: "Tipo", exact: true }),
  ).toHaveValue("demo");
  await expect(
    dialog
      .getByRole("combobox", { name: "Tipo", exact: true })
      .locator("option"),
  ).toHaveText(labels);
  expect(requests.creates).toHaveLength(0);
  await dialog
    .getByRole("textbox", { name: "Objetivo", exact: true })
    .fill("Revisar arquitectura editada");
  await dialog.getByRole("button", { name: /Guardar/ }).click();
  await expect(dialog).not.toBeVisible();
  expect(requests.creates).toHaveLength(1);
  expect(requests.creates[0]).toMatchObject({
    kind: "standalone",
    activityType: "demo",
    objective: "Revisar arquitectura editada",
    note: "Contexto del chat",
    successCriteria: "Acordar piloto",
  });
  expect(requests.completes[0]).toMatchObject({
    module: "calendar",
    entityId: 901,
    entityType: "commercial_calendar_activity",
  });
  expect(requests.cancels).toHaveLength(0);
  await expect(page).toHaveURL(/\/calendar$/);
});

test("closing the modal cancels without creating an activity", async ({
  page,
}) => {
  const requests = await mockCalendar(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Cerrar/ }).click();
  await expect(dialog).not.toBeVisible();
  expect(requests.creates).toHaveLength(0);
  expect(requests.cancels).toHaveLength(1);
  expect(requests.completes).toHaveLength(0);
});

test("retrying handoff completion does not duplicate the saved activity", async ({
  page,
}) => {
  const requests = await mockCalendar(page, { failComplete: true });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Guardar/ }).click();
  await expect(
    dialog.getByText("Confirmación temporalmente no disponible"),
  ).toBeVisible();
  await dialog.getByRole("button", { name: /Guardar/ }).click();
  await expect(dialog).not.toBeVisible();
  expect(requests.creates).toHaveLength(1);
  expect(requests.completes).toHaveLength(2);
});

test("missing date stays editable and cannot save", async ({ page }) => {
  const requests = await mockCalendar(page, { missingDate: true });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Guardar/ }).click();
  await expect(
    dialog.getByText("Completa fecha/hora y objetivo para guardar."),
  ).toBeVisible();
  expect(requests.creates).toHaveLength(0);
});

test("permission and expiry errors do not open or save an activity", async ({
  page,
}) => {
  const requests = await mockCalendar(page, { canUpdate: false });
  await expect(
    page.getByText(/Necesitas permiso de actualización de Calendario/),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(requests.creates).toHaveLength(0);
});

test("expired handoff shows a clear error", async ({ page }) => {
  await mockCalendar(page, { expired: true });
  await expect(page.getByText("El borrador no existe o expiró")).toBeVisible();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

for (const calendarKind of ["lead", "opportunity"]) {
  test(`preserves the ${calendarKind} relation when saving`, async ({
    page,
  }) => {
    const requests = await mockCalendar(page, { calendarKind });
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /Guardar/ }).click();
    await expect(dialog).not.toBeVisible();
    expect(requests.creates[0]).toMatchObject({
      kind: calendarKind,
      ...(calendarKind === "lead"
        ? { interactionId: 55 }
        : { opportunityId: 44 }),
    });
    expect(requests.completes[0].entityType).toBe(
      calendarKind === "opportunity"
        ? "opportunity_activity"
        : "commercial_calendar_activity",
    );
  });
}

test("preserves account and contact and keeps save errors editable", async ({
  page,
}) => {
  const requests = await mockCalendar(page, {
    withRelations: true,
    failSave: true,
  });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Guardar/ }).click();
  await expect(dialog.getByText("Error al guardar actividad")).toBeVisible();
  expect(requests.creates[0]).toMatchObject({
    accountId: 33,
    contactId: 66,
    accountLinkMode: "existing",
    contactLinkMode: "existing",
  });
  expect(requests.completes).toHaveLength(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/calendar-coach-mobile.png",
    fullPage: true,
  });
});
