import { expect, test } from "@playwright/test";

const permissions = [
  {
    id: 1,
    code: "cotizaciones.administracion",
    module: "cotizaciones",
    action: "administracion",
    description:
      "Administrar cotizaciones, acceder a versiones historicas y editar o crear versiones incluso en estados aprobada, enviada, ganada y aceptada. Habilita todas las acciones del modulo, sujetas a las validaciones de cada operacion.",
  },
  {
    id: 2,
    code: "cotizaciones.ingreso",
    module: "cotizaciones",
    action: "ingreso",
    description:
      "Para logistica. Permite aceptar cotizaciones ganadas o devolverlas a borrador. Tambien permite editar borradores, solicitar aprobacion y marcar cotizaciones aprobadas como ganadas.",
  },
  {
    id: 3,
    code: "cotizaciones.operacion",
    module: "cotizaciones",
    action: "operacion",
    description:
      "Para vendedores. Permite crear y preparar cotizaciones, solicitar aprobacion, enviarlas y registrar su resultado comercial segun el estado. La aprobacion requiere un permiso adicional.",
  },
];

for (const width of [1280, 900]) {
  test(`permisos legibles y seleccionables a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem("crm_token", "roles-layout-test");
    });
    let selectedIds = [1, 2, 3];
    let savedIds;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body = [];
      if (path === "/api/auth/bootstrap-status") {
        body = { hasUsers: true };
      } else if (path === "/api/auth/me") {
        body = {
          id: 1,
          full_name: "Administrador de prueba",
          permissions: ["roles.read", "roles.update"],
        };
      } else if (path === "/api/roles") {
        body = [{
          id: 1,
          name: "Equipo comercial",
          description: "Rol de prueba",
          is_active: 1,
          is_system: 0,
        }];
      } else if (path === "/api/roles/permissions") {
        body = permissions;
      } else if (path === "/api/roles/1/permissions") {
        if (route.request().method() === "PUT") {
          savedIds = route.request().postDataJSON().permissionIds;
          selectedIds = savedIds;
        }
        body = { permissionIds: selectedIds };
      }
      await route.fulfill({ json: body });
    });
    await page.goto("/roles");
    await page.getByRole("button", { name: /Equipo comercial/ }).click();
    const rows = page.locator(".permission-module-group .checkbox-grid > label");
    await expect(rows).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      const row = rows.nth(index);
      await expect(row.getByRole("checkbox")).toBeChecked();
      const title = await row.locator(".permission-code").boundingBox();
      const description = await row.locator(".permission-description").boundingBox();
      expect(description.y).toBeGreaterThanOrEqual(title.y + title.height);
      expect(Math.abs(title.x - description.x)).toBeLessThan(1);
      expect(await row.evaluate((element) =>
        element.scrollWidth <= element.clientWidth,
      )).toBe(true);
    }
    await expect(
      rows.nth(1).locator(".permission-code"),
    ).toHaveText("Gestionar cotizaciones en logística");
    await rows.nth(1).locator(".permission-description").click();
    await expect(rows.nth(1).getByRole("checkbox")).not.toBeChecked();
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect.poll(() => savedIds).toEqual([1, 3]);
    await expect(page.getByText(/Permisos guardados correctamente/)).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("roles-layout.png") });
  });
}
