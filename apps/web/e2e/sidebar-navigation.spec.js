import { expect, test } from "@playwright/test";

async function openApp(page, permissions) {
  await page.addInitScript(() => {
    window.localStorage.setItem("crm_token", "sidebar-test");
  });
  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/auth/bootstrap-status") {
      return route.fulfill({ json: { hasUsers: true } });
    }
    if (pathname === "/api/auth/me") {
      return route.fulfill({
        json: { id: 501, full_name: "Usuario menú", email: "menu@example.test", permissions },
      });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  await expect(page.locator(".sidebar")).toBeVisible();
}

test("organiza las opciones autorizadas en seis divisiones sin cambiar rutas", async ({ page }) => {
  await openApp(page, [
    "cuentas.read", "contactos.read", "interacciones.read", "oportunidades.read",
    "cotizaciones.operacion", "mi_coach.access", "calendario_comercial.read",
    "seguimiento_comercial.read", "ritmo_comercial.read", "planeacion_comercial.read",
    "enablement_comercial.use", "registros_fabricantes.read", "campanas.read",
    "landing.read", "proveedores.read", "aceptar_pedido.procesamiento.read",
    "usuarios.read", "roles.read", "proceso_comercial_config.read", "configuracion.read",
    "documentacion_rag.access", "herramientas.read", "pruebas.read", "audit.read",
  ]);
  const expected = [
    ["Inicio", [
      ["Inicio", "/"], ["Indicadores", "/dashboards"], ["Agenda", "/calendar"], ["Mi coach", "/mi-agent"],
    ]],
    ["Ventas", [
      ["Cuentas", "/accounts"], ["Contactos", "/contacts"], ["Mapa de relaciones", "/contact-mapping"],
      ["Leads", "/interactions"], ["Oportunidades", "/opportunities"], ["Cotizaciones", "/quotations"],
      ["Propuestas", "/proposals-new"], ["Registros con fabricantes", "/manufacturer-registrations"],
    ]],
    ["Gestión de ventas", [
      ["Embudo de ventas", "/commercial-tracking"], ["Metas y comisiones", "/commercial-planning"],
      ["Ritmo de ventas", "/seller-league-tv"], ["Biblioteca de ventas", "/commercial-enablement"],
    ]],
    ["Marketing", [
      ["Campañas", "/campaigns"], ["Correo de campañas", "/campaign-emails"], ["Páginas de captación", "/landing"],
    ]],
    ["Operaciones", [
      ["Aceptación de pedidos", "/accept-order"], ["Facturación a clientes", "/invoicing"],
      ["Facturas de proveedores", "/provider-invoice-reception"], ["Proveedores", "/providers"],
    ]],
    ["Administración", [
      ["Usuarios", "/users"], ["Roles y permisos", "/roles"], ["Proceso de ventas", "/opportunities/questions"],
      ["Configuración general", "/settings"], ["Base de conocimiento IA", "/documentacion-rag"],
      ["Documentación del sistema", "/documentation"], ["Herramientas del sistema", "/tools"],
      ["Pruebas de seguridad", "/security-tests"], ["Auditoría", "/audit"],
    ]],
  ];
  const groups = page.locator(".sidebar-nav-group");
  await expect(groups.locator(".sidebar-nav-group-title > span:first-child")).toHaveText(expected.map(([title]) => title));
  for (const [index, [, links]] of expected.entries()) {
    const groupLinks = groups.nth(index).getByRole("link");
    await expect(groupLinks).toHaveText(links.map(([label]) => label));
    for (const [linkIndex, [, href]] of links.entries()) {
      await expect(groupLinks.nth(linkIndex)).toHaveAttribute("href", href);
    }
  }
  await expect(page.locator(".sidebar").getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
});

for (const { permissions, group, link } of [
  { permissions: ["propuestas.read"], group: "Ventas", link: "Propuestas" },
  { permissions: ["proveedores.read"], group: "Operaciones", link: "Proveedores" },
  { permissions: ["audit.read"], group: "Administración", link: "Auditoría" },
  { permissions: ["pruebas.read"], group: "Administración", link: "Pruebas de seguridad" },
]) {
  test(`muestra solo las divisiones necesarias con permiso ${permissions[0]}`, async ({ page }) => {
    await openApp(page, permissions);
    const sidebar = page.locator(".sidebar");
    await expect(sidebar.locator(".sidebar-nav-group-title > span:first-child")).toHaveText(["Inicio", group]);
    await expect(sidebar.getByRole("link")).toHaveText(["Inicio", link]);
  });
}

test("recuerda divisiones contraídas y abre la de la ruta activa", async ({ page }) => {
  await openApp(page, ["roles.read"]);
  const sidebar = page.locator(".sidebar");
  const toggle = sidebar.getByRole("button", { name: "Administración" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar.getByRole("link", { name: "Roles y permisos" })).toBeHidden();
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.goto("/roles");
  await expect(page.getByRole("heading", { name: "Roles y permisos" })).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar.getByRole("link", { name: "Roles y permisos" })).toHaveAttribute("aria-current", "page");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
});
