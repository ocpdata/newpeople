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
  {
    id: 4,
    code: "seguimiento_comercial.read",
    module: "seguimiento_comercial",
    action: "read",
    description: "Ver el modulo de seguimiento comercial",
  },
  {
    id: 5,
    code: "usuarios.read",
    module: "usuarios",
    action: "read",
    description: "Consultar usuarios",
  },
  {
    id: 6,
    code: "usuarios.create",
    module: "usuarios",
    action: "create",
    description: "Crear usuarios",
  },
  {
    id: 7,
    code: "usuarios.update",
    module: "usuarios",
    action: "update",
    description: "Actualizar usuarios",
  },
  {
    id: 8,
    code: "roles.read",
    module: "roles",
    action: "read",
    description: "Consultar roles",
  },
  {
    id: 9,
    code: "roles.create",
    module: "roles",
    action: "create",
    description: "Crear roles",
  },
  {
    id: 10,
    code: "roles.update",
    module: "roles",
    action: "update",
    description: "Actualizar roles",
  },
  {
    id: 11,
    code: "roles.assign",
    module: "roles",
    action: "assign",
    description: "Asignar roles",
  },
  {
    id: 12,
    code: "permissions.read",
    module: "permissions",
    action: "read",
    description: "Ver permisos",
  },
  {
    id: 13,
    code: "ritmo_comercial.read",
    module: "ritmo_comercial",
    action: "read",
    description: "Acceder al modulo de ritmo comercial",
  },
  {
    id: 14,
    code: "ritmo_comercial.read_all",
    module: "ritmo_comercial",
    action: "read_all",
    description: "Ver todos los vendedores en el modulo de ritmo comercial",
  },
  {
    id: 15,
    code: "ritmo_comercial.display",
    module: "ritmo_comercial",
    action: "display",
    description: "Permitir que el usuario aparezca en el modulo de ritmo comercial",
  },
  {
    id: 16,
    code: "registros_fabricantes.read",
    module: "registros_fabricantes",
    action: "read",
    description: "Consultar registros de fabricantes por oportunidad",
  },
  {
    id: 17,
    code: "pruebas.read",
    module: "pruebas",
    action: "read",
    description: "Ver ejecuciones de pruebas de seguridad",
  },
  {
    id: 18,
    code: "pruebas.execute",
    module: "pruebas",
    action: "execute",
    description: "Ejecutar perfiles de pruebas de seguridad",
  },
  {
    id: 19,
    code: "pruebas.admin",
    module: "pruebas",
    action: "admin",
    description: "Ejecutar pruebas de seguridad con integraciones externas",
  },
  {
    id: 20,
    code: "registros_fabricantes.request",
    module: "registros_fabricantes",
    action: "request",
    description: "Solicitar registros de fabricantes",
  },
  {
    id: 21,
    code: "registros_fabricantes.update",
    module: "registros_fabricantes",
    action: "update",
    description: "Actualizar datos administrativos de registros de fabricantes",
  },
  {
    id: 22,
    code: "registros_fabricantes.manage",
    module: "registros_fabricantes",
    action: "manage",
    description: "Aprobar, rechazar, reabrir y renovar registros de fabricantes",
  },
  {
    id: 23,
    code: "registros_fabricantes.read_all",
    module: "registros_fabricantes",
    action: "read_all",
    description: "Consultar registros de fabricantes de todas las oportunidades",
  },
  {
    id: 24,
    code: "proveedores.read",
    module: "proveedores",
    action: "read",
    description: "Consultar proveedores",
  },
  {
    id: 25,
    code: "proveedores.create",
    module: "proveedores",
    action: "create",
    description: "Crear proveedores",
  },
  {
    id: 26,
    code: "proveedores.update",
    module: "proveedores",
    action: "update",
    description: "Actualizar proveedores",
  },
  {
    id: 27,
    code: "proveedores_precios.read",
    module: "proveedores_precios",
    action: "read",
    description: "Consultar listas y precios de proveedor",
  },
  {
    id: 28,
    code: "proveedores_precios.create",
    module: "proveedores_precios",
    action: "create",
    description: "Crear listas y precios de proveedor",
  },
  {
    id: 29,
    code: "proveedores_precios.update",
    module: "proveedores_precios",
    action: "update",
    description: "Editar listas, precios y estados",
  },
  {
    id: 30,
    code: "propuestas.read",
    module: "propuestas",
    action: "read",
    description: "Ver propuestas",
  },
  {
    id: 31,
    code: "propuestas.create",
    module: "propuestas",
    action: "create",
    description: "Crear propuestas",
  },
  {
    id: 32,
    code: "propuestas.update",
    module: "propuestas",
    action: "update",
    description: "Actualizar propuestas",
  },
  {
    id: 33,
    code: "proceso_comercial_config.read",
    module: "proceso_comercial_config",
    action: "read",
    description: "Ver la configuracion del proceso comercial",
  },
  {
    id: 34,
    code: "proceso_comercial_config.update",
    module: "proceso_comercial_config",
    action: "update",
    description: "Actualizar la configuracion del proceso comercial",
  },
  {
    id: 35,
    code: "playbooks.manage",
    module: "playbooks",
    action: "manage",
    description: "Administrar playbooks tecnicos por solucion",
  },
  {
    id: 36,
    code: "planeacion_comercial.read",
    module: "planeacion_comercial",
    action: "read",
    description: "Consultar metas trimestrales y comisiones",
  },
  {
    id: 37,
    code: "planeacion_comercial.create",
    module: "planeacion_comercial",
    action: "create",
    description: "Crear metas y comisiones anuales",
  },
  {
    id: 38,
    code: "planeacion_comercial.update",
    module: "planeacion_comercial",
    action: "update",
    description: "Editar metas y comisiones",
  },
  {
    id: 39,
    code: "planeacion_comercial.audit.read",
    module: "planeacion_comercial",
    action: "audit.read",
    description: "Consultar auditoria de metas y comisiones",
  },
  {
    id: 40,
    code: "oportunidades.read",
    module: "oportunidades",
    action: "read",
    description: "Consultar oportunidades y notas",
  },
  {
    id: 41,
    code: "oportunidades.update",
    module: "oportunidades",
    action: "update",
    description: "Editar oportunidades y agregar notas",
  },
  {
    id: 42,
    code: "oportunidades.notes.create",
    module: "oportunidades.notes",
    action: "create",
    description: "Permiso temporal de pruebas: oportunidades.notes.create",
  },
  {
    id: 43,
    code: "oportunidades.notes.read",
    module: "oportunidades.notes",
    action: "read",
    description: "Permiso temporal de pruebas: oportunidades.notes.read",
  },
  {
    id: 44,
    code: "oportunidades.read_all",
    module: "oportunidades",
    action: "read_all",
    description: "Consultar oportunidades de todas las cuentas",
  },
  {
    id: 45,
    code: "oportunidades.request",
    module: "oportunidades",
    action: "request",
    description: "Solicitar alta de oportunidades",
  },
  {
    id: 46,
    code: "oportunidades.create",
    module: "oportunidades",
    action: "create",
    description: "Crear oportunidades",
  },
  {
    id: 47,
    code: "oportunidades.update_won",
    module: "oportunidades",
    action: "update_won",
    description: "Editar oportunidades ganadas",
  },
  {
    id: 48,
    code: "oportunidades.bypass_stage_validation",
    module: "oportunidades",
    action: "bypass_stage_validation",
    description: "Omitir validación al avanzar de etapa",
  },
  {
    id: 49,
    code: "oportunidades.bypass_demostracion_validation",
    module: "oportunidades",
    action: "bypass_demostracion_validation",
    description: "Omitir validación en demostración",
  },
  {
    id: 50,
    code: "landing.read",
    module: "landing",
    action: "read_pages",
    description: "Consultar páginas de captación",
  },
  {
    id: 51,
    code: "landing.create",
    module: "landing",
    action: "create",
    description: "Crear páginas de captación",
  },
  {
    id: 52,
    code: "landing.update",
    module: "landing",
    action: "update",
    description: "Editar páginas de captación",
  },
  {
    id: 53,
    code: "landing.publish",
    module: "landing",
    action: "publish",
    description: "Publicar páginas de captación",
  },
  {
    id: 54,
    code: "landing.submissions.read",
    module: "landing",
    action: "read_submissions",
    description: "Consultar envíos de formularios",
  },
  {
    id: 55,
    code: "landing.submissions.reprocess",
    module: "landing",
    action: "reprocess_submissions",
    description: "Gestionar envíos de formularios",
  },
  {
    id: 56,
    code: "interacciones.analyze",
    module: "interacciones",
    action: "analyze",
    description: "Analizar leads",
  },
  {
    id: 57,
    code: "interacciones.create",
    module: "interacciones",
    action: "create",
    description: "Registrar leads",
  },
  {
    id: 58,
    code: "interacciones.dashboard.access",
    module: "interacciones",
    action: "dashboard_access",
    description: "Acceder a tableros de leads",
  },
  {
    id: 59,
    code: "interacciones.dashboard.drilldown.view",
    module: "interacciones",
    action: "dashboard_drilldown_view",
    description: "Abrir detalle de tableros de leads",
  },
  {
    id: 60,
    code: "interacciones.dashboard.executive.view",
    module: "interacciones",
    action: "dashboard_executive_view",
    description: "Ver tablero ejecutivo de leads",
  },
  {
    id: 61,
    code: "interacciones.dashboard.management.view",
    module: "interacciones",
    action: "dashboard_management_view",
    description: "Ver tablero de gestión de leads",
  },
  {
    id: 62,
    code: "interacciones.dashboard.operations.view",
    module: "interacciones",
    action: "dashboard_operations_view",
    description: "Ver tablero operativo de leads",
  },
  {
    id: 63,
    code: "interacciones.read",
    module: "interacciones",
    action: "read",
    description: "Consultar leads asignados",
  },
  {
    id: 64,
    code: "interacciones.read_all",
    module: "interacciones",
    action: "read_all",
    description: "Consultar todos los leads",
  },
  {
    id: 65,
    code: "interacciones.resolve",
    module: "interacciones",
    action: "resolve",
    description: "Resolver leads",
  },
  {
    id: 66,
    code: "interacciones.resolve.assign_any",
    module: "interacciones",
    action: "resolve_assign_any",
    description: "Asignar leads a cualquier vendedor",
  },
  {
    id: 67,
    code: "interacciones.resolve.assign_self",
    module: "interacciones",
    action: "resolve_assign_self",
    description: "Asignar leads al usuario actual",
  },
  {
    id: 68,
    code: "interacciones.update",
    module: "interacciones",
    action: "update",
    description: "Actualizar y dar seguimiento a leads",
  },
  {
    id: 69,
    code: "ia.budget.read_self",
    module: "ia",
    action: "budget_read_self",
    description: "Consultar mi crédito y consumo de IA",
  },
  {
    id: 70,
    code: "ia.budget.read_all",
    module: "ia",
    action: "budget_read_all",
    description: "Consultar crédito y consumo de todos",
  },
  {
    id: 71,
    code: "ia.budget.manage",
    module: "ia",
    action: "budget_manage",
    description: "Administrar crédito y servicios de IA",
  },
  {
    id: 72,
    code: "ia.usage.read_all",
    module: "ia",
    action: "usage_read_all",
    description: "Consultar reportes de uso de IA",
  },
  {
    id: 73,
    code: "herramientas.read",
    module: "herramientas",
    action: "read",
    description: "Consultar herramientas del sistema",
  },
  {
    id: 74,
    code: "herramientas.update",
    module: "herramientas",
    action: "update",
    description: "Aplicar correcciones en herramientas",
  },
  {
    id: 75,
    code: "herramientas.admin",
    module: "herramientas",
    action: "admin",
    description: "Administrar herramientas avanzadas",
  },
  {
    id: 76,
    code: "enablement_comercial.admin",
    module: "enablement_comercial",
    action: "admin",
    description: "Administrar catálogos de la biblioteca",
  },
  {
    id: 77,
    code: "enablement_comercial.analytics",
    module: "enablement_comercial",
    action: "analytics",
    description: "Consultar biblioteca (permiso heredado)",
  },
  {
    id: 78,
    code: "enablement_comercial.manage",
    module: "enablement_comercial",
    action: "manage",
    description: "Gestionar todos los materiales",
  },
  {
    id: 79,
    code: "enablement_comercial.read",
    module: "enablement_comercial",
    action: "read",
    description: "Consultar biblioteca (compatibilidad)",
  },
  {
    id: 80,
    code: "enablement_comercial.update",
    module: "enablement_comercial",
    action: "update",
    description: "Cargar y editar materiales propios (compatibilidad)",
  },
  {
    id: 81,
    code: "enablement_comercial.upload",
    module: "enablement_comercial",
    action: "upload",
    description: "Cargar y editar materiales propios",
  },
  {
    id: 82,
    code: "enablement_comercial.use",
    module: "enablement_comercial",
    action: "use",
    description: "Buscar y usar materiales comerciales",
  },
  {
    id: 83,
    code: "documentacion_rag.access",
    module: "documentacion_rag",
    action: "access",
    description: "Consultar la base de conocimiento IA",
  },
  {
    id: 84,
    code: "documentacion_rag.manage",
    module: "documentacion_rag",
    action: "manage",
    description: "Administrar la base de conocimiento IA",
  },
  {
    id: 85,
    code: "cuentas.assign_owners_any",
    module: "cuentas",
    action: "assign_owners_any",
    description: "Asignar propietarios de cuentas",
  },
  {
    id: 86,
    code: "cuentas.create",
    module: "cuentas",
    action: "create",
    description: "Crear cuentas activas",
  },
  {
    id: 87,
    code: "cuentas.read",
    module: "cuentas",
    action: "read",
    description: "Consultar cuentas asignadas",
  },
  {
    id: 88,
    code: "cuentas.read_all",
    module: "cuentas",
    action: "read_all",
    description: "Consultar todas las cuentas",
  },
  {
    id: 89,
    code: "cuentas.request",
    module: "cuentas",
    action: "request",
    description: "Solicitar alta de cuentas",
  },
  {
    id: 90,
    code: "cuentas.update",
    module: "cuentas",
    action: "update",
    description: "Editar cuentas",
  },
  {
    id: 91,
    code: "contactos.create",
    module: "contactos",
    action: "create",
    description: "Crear contactos activos",
  },
  {
    id: 92,
    code: "contactos.read",
    module: "contactos",
    action: "read",
    description: "Consultar contactos de cuentas asignadas",
  },
  {
    id: 93,
    code: "contactos.read_all",
    module: "contactos",
    action: "read_all",
    description: "Consultar contactos de todas las cuentas",
  },
  {
    id: 94,
    code: "contactos.request",
    module: "contactos",
    action: "request",
    description: "Solicitar alta de contactos",
  },
  {
    id: 95,
    code: "contactos.update",
    module: "contactos",
    action: "update",
    description: "Editar contactos",
  },
  {
    id: 96,
    code: "cotizaciones.aprobacion_humana",
    module: "cotizaciones",
    action: "aprobacion_humana",
    description: "Aprobar cotizaciones sin IA",
  },
  {
    id: 97,
    code: "cotizaciones.aprobacion_ia",
    module: "cotizaciones",
    action: "aprobacion_ia",
    description: "Aprobar cotizaciones con IA",
  },
  {
    id: 98,
    code: "cotizaciones.externo",
    module: "cotizaciones",
    action: "externo",
    description: "Consultar cotizaciones como cliente",
  },
  {
    id: 99,
    code: "cotizaciones.revision",
    module: "cotizaciones",
    action: "revision",
    description: "Revisar cotizaciones para aprobación",
  },
  {
    id: 100,
    code: "configuracion.read",
    module: "configuracion",
    action: "read",
    description: "Ver configuración general",
  },
  {
    id: 101,
    code: "configuracion.update",
    module: "configuracion",
    action: "update",
    description: "Actualizar configuración general",
  },
  {
    id: 102,
    code: "comercial.seller.eligible",
    module: "comercial",
    action: "seller_eligible",
    description: "Habilitar perfil de vendedor",
  },
  {
    id: 103,
    code: "campanas.read",
    module: "campanas",
    action: "read",
    description: "Consultar campañas",
  },
  {
    id: 104,
    code: "campanas.create",
    module: "campanas",
    action: "create",
    description: "Crear campañas",
  },
  {
    id: 105,
    code: "campanas.update",
    module: "campanas",
    action: "update",
    description: "Editar campañas y audiencia",
  },
  {
    id: 106,
    code: "calendario_comercial.read",
    module: "calendario_comercial",
    action: "read",
    description: "Consultar mi agenda",
  },
  {
    id: 107,
    code: "calendario_comercial.read_all",
    module: "calendario_comercial",
    action: "read_all",
    description: "Consultar la agenda del equipo",
  },
  {
    id: 108,
    code: "calendario_comercial.update",
    module: "calendario_comercial",
    action: "update",
    description: "Gestionar actividades de la agenda",
  },
  {
    id: 109,
    code: "audit.read",
    module: "audit",
    action: "read",
    description: "Consultar auditoría del sistema",
  },
  {
    id: 110,
    code: "aceptar_pedido.procesamiento.read",
    module: "aceptar_pedido",
    action: "procesamiento_read",
    description: "Consultar procesamiento de pedidos",
  },
  {
    id: 111,
    code: "aceptar_pedido.procesamiento.update",
    module: "aceptar_pedido",
    action: "procesamiento_update",
    description: "Actualizar procesamiento de pedidos",
  },
  {
    id: 112,
    code: "aceptar_pedido.procesamiento.ia",
    module: "aceptar_pedido",
    action: "procesamiento_ia",
    description: "Generar resúmenes con IA",
  },
  {
    id: 113,
    code: "aceptar_pedido.procesamiento.convocar",
    module: "aceptar_pedido",
    action: "procesamiento_convocar",
    description: "Enviar convocatorias de kick off",
  },
  { id: 114, code: "reportes.access", module: "reportes", action: "access", description: "Entrar al modulo sin habilitar reportes" },
  { id: 115, code: "reportes.oportunidades_cotizaciones.read", module: "reportes", action: "oportunidades_cotizaciones.read", description: "Consultar datos propios por vendedor asignado actual" },
  { id: 116, code: "reportes.oportunidades_cotizaciones.read_all", module: "reportes", action: "oportunidades_cotizaciones.read_all", description: "Consultar todos los usuarios sin permisos de origen" },
  { id: 117, code: "reportes.rentabilidad.read", module: "reportes", action: "rentabilidad.read", description: "Consultar rentabilidad propia con costos y margen" },
  { id: 118, code: "reportes.rentabilidad.read_all", module: "reportes", action: "rentabilidad.read_all", description: "Consultar rentabilidad de todos los usuarios con costos y margen" },
  { id: 119, code: "mi_coach.evaluations_read", module: "mi_coach", action: "evaluations_read", description: "Consultar las pruebas y reportes de calidad del chat de Coach y Cuenta nueva" },
  { id: 120, code: "mi_coach.evaluations_execute", module: "mi_coach", action: "evaluations_execute", description: "Ejecutar pruebas del chat y actualizar el monitoreo de calidad de Coach y Cuenta nueva" },
  { id: 121, code: "mi_coach.evaluations_write", module: "mi_coach", action: "evaluations_write", description: "Convertir feedback de conversaciones de clientes en casos de prueba. También requiere permiso de soporte" },
  { id: 122, code: "mi_coach.execute", module: "mi_coach", action: "execute", description: "Confirmar operaciones propuestas por Mi Coach" },
];

for (const width of [1280, 900]) {
  test(`permisos legibles y seleccionables a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem("crm_token", "roles-layout-test");
    });
    let selectedIds = permissions.map((permission) => permission.id);
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
    await expect(rows).toHaveCount(permissions.length);
    const allPermissionGroupToggles = page.locator(
      ".permission-family-header .permission-collapse-button, .permission-module-header .permission-collapse-button",
    );
    for (
      let index = 0;
      index < await allPermissionGroupToggles.count();
      index += 1
    ) {
      await expect(allPermissionGroupToggles.nth(index)).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    }
    const familyToggles = page.locator(
      ".permission-family-header .permission-collapse-button",
    );
    for (let index = 0; index < await familyToggles.count(); index += 1) {
      await familyToggles.nth(index).evaluate((button) => button.click());
    }
    const moduleToggles = page.locator(
      ".permission-module-header .permission-collapse-button",
    );
    for (let index = 0; index < await moduleToggles.count(); index += 1) {
      await moduleToggles.nth(index).evaluate((button) => button.click());
    }
    const reportsGroup = page.locator(".permission-module-group").filter({
      has: page.getByText("Reportes", { exact: true }),
    });
    await expect(reportsGroup.locator(".permission-code")).toHaveText([
      "Acceder al modulo Reportes",
      "Oportunidades y cotizaciones: datos propios",
      "Oportunidades y cotizaciones: todos los usuarios",
      "Rentabilidad: datos propios",
      "Rentabilidad: todos los usuarios",
    ]);
    const reportTitle = reportsGroup.locator(
      ".permission-module-header > .permission-collapse-button > span",
    );
    const reportDescription = reportsGroup.locator(".permission-module-description");
    const titleBox = await reportTitle.boundingBox();
    const descriptionBox = await reportDescription.boundingBox();
    expect(descriptionBox.y).toBeGreaterThan(titleBox.y + titleBox.height);
    await expect(reportDescription).toHaveCSS("text-transform", "none");
    await expect(reportDescription).toHaveCSS("font-weight", "400");
    await reportsGroup.screenshot({ path: `test-results/reportes-permisos-${width}.png` });
    const coachFamily = page.locator(".permission-family-group").filter({
      has: page.locator(".permission-family-header > .permission-collapse-button > span").getByText(
        "Mi Coach",
        { exact: true },
      ),
    });
    const coachFamilyTitle = coachFamily.locator(
      ".permission-family-header > .permission-collapse-button",
    );
    const coachFamilyDescription = coachFamily.locator(
      ".permission-family-description",
    );
    const coachTitleBox = await coachFamilyTitle.boundingBox();
    const coachDescriptionBox = await coachFamilyDescription.boundingBox();
    expect(coachDescriptionBox.y).toBeGreaterThanOrEqual(
      coachTitleBox.y + coachTitleBox.height,
    );
    const commonCoachGroup = coachFamily.locator(".permission-module-group").filter({
      has: page.getByText("Acceso y capacidades comunes", { exact: true }),
    });
    await expect(commonCoachGroup.locator(".permission-code")).toContainText([
      "Consultar calidad de Coach y Cuenta nueva",
      "Ejecutar pruebas de calidad",
      "Crear casos de prueba desde feedback",
      "Aplicar acciones propuestas por Mi Coach",
    ]);
    await expect(
      commonCoachGroup.locator(".permission-description"),
    ).toContainText([
      "Ver las pruebas del chat y los reportes de calidad de ambos módulos.",
      "Ejecutar pruebas del chat y actualizar el monitoreo de Coach y Cuenta nueva.",
      "Convertir feedback de conversaciones de clientes en casos de prueba. También requiere permiso de soporte.",
      "Confirma y aplica en el sistema las acciones sugeridas por Mi Coach. También necesitas permiso para modificar el registro involucrado.",
    ]);
    await expect(coachFamily.locator(".permission-module-group")).toHaveCount(1);
    const coachFamilyToggle = coachFamily.getByRole("button", {
      name: "Mi Coach",
      exact: true,
    });
    await expect(coachFamilyToggle).toHaveAttribute("aria-expanded", "true");
    await coachFamilyToggle.evaluate((button) => button.click());
    await expect(coachFamilyToggle).toHaveAttribute("aria-expanded", "false");
    await expect(commonCoachGroup.locator(".checkbox-grid")).toBeHidden();
    await coachFamilyToggle.evaluate((button) => button.click());
    const commonCoachToggle = commonCoachGroup.getByRole("button", {
      name: "Acceso y capacidades comunes",
      exact: true,
    });
    await commonCoachToggle.evaluate((button) => button.click());
    await expect(commonCoachToggle).toHaveAttribute("aria-expanded", "false");
    await expect(commonCoachGroup.locator(".checkbox-grid")).toBeHidden();
    await commonCoachToggle.evaluate((button) => button.click());
    for (let index = 0; index < permissions.length; index += 1) {
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
    const logisticsPermissionRow = rows.filter({
      has: page.getByText("Gestionar cotizaciones en logística", { exact: true }),
    });
    await expect(logisticsPermissionRow.locator(".permission-code")).toHaveText(
      "Gestionar cotizaciones en logística",
    );
    const configurationFamily = page.locator(".permission-family-group").filter({
      has: page.locator(".permission-family-header > .permission-collapse-button > span").getByText(
        "Configuración",
        { exact: true },
      ),
    });
    await expect(
      configurationFamily.locator(".permission-family-description"),
    ).toHaveText(
      "Ajustes generales y configuración de módulos especializados.",
    );
    const configurationSubgroups = configurationFamily.locator(
      ".permission-module-group",
    );
    await expect(
      configurationSubgroups.locator(
        ".permission-module-header > .permission-collapse-button > span",
      ),
    ).toHaveText([
      "Configuración general",
      "Preguntas por etapa",
      "Crédito y consumo de IA",
    ]);
    await expect(
      configurationSubgroups.nth(0).locator(".permission-code"),
    ).toHaveText(["read", "update"]);
    await expect(
      configurationSubgroups.nth(1).locator(".permission-code"),
    ).toHaveText([
      "Consultar preguntas por etapa",
      "Administrar preguntas por etapa",
    ]);
    await expect(
      configurationSubgroups.nth(2).locator(".permission-code"),
    ).toHaveText([
      "Consultar mi crédito y consumo de IA",
      "Consultar crédito y consumo de todos",
      "Administrar crédito y servicios de IA",
      "Consultar reportes de uso de IA",
    ]);
    const pipelineGroup = page.locator(".permission-module-group").filter({
      has: page.getByText("Embudo de ventas", { exact: true }),
    });
    await expect(
      pipelineGroup.locator(".permission-module-header > .permission-collapse-button > span"),
    ).toHaveText(
      "Embudo de ventas",
    );
    await expect(pipelineGroup.locator(".permission-module-description")).toHaveText(
      "Consulta oportunidades abiertas y ganadas por periodo, y detecta riesgos como bloqueos, falta de actividad o ausencia de un siguiente paso.",
    );
    await expect(pipelineGroup.locator(".permission-code")).toHaveText(
      "Consultar el embudo de ventas",
    );
    await expect(pipelineGroup.locator(".permission-description")).toHaveText(
      "Permite abrir el embudo de ventas y consultar oportunidades abiertas, ganadas y por periodo. También requiere lectura de oportunidades.",
    );
    const usersGroup = page.locator(".permission-module-group").filter({
      has: page.getByText("Usuarios", { exact: true }),
    });
    await expect(usersGroup.locator(".permission-module-description")).toHaveText(
      "Administra las cuentas de usuario: consulta el directorio, crea usuarios y actualiza sus datos, acceso y estado según los permisos asignados.",
    );
    await expect(
      usersGroup.locator(".permission-code"),
    ).toHaveText([
      "Consultar usuarios",
      "Crear usuarios",
      "Actualizar usuarios y accesos",
    ]);
    await expect(
      usersGroup.locator(".permission-description"),
    ).toHaveText([
      "Ver el directorio de usuarios y su historial de auditoría.",
      "Crear cuentas, asignar roles y enviar la invitación para configurar el acceso.",
      "Editar datos, cambiar roles y estado de las cuentas, y reenviar invitaciones de acceso o restablecimiento.",
    ]);
    const accessManagementGroup = page.locator(".permission-family-group").filter({
      has: page.getByText("Roles y permisos", { exact: true }),
    });
    await expect(accessManagementGroup.locator(".permission-family-description")).toHaveText(
      "Administra perfiles de acceso y consulta el catálogo para definir qué puede hacer cada rol.",
    );
    const rolesGroup = accessManagementGroup.locator(".permission-module-group").filter({
    has: page.locator(".permission-module-header > .permission-collapse-button > span").getByText("Roles", { exact: true }),
    });
    await expect(rolesGroup.locator(".permission-module-description")).toHaveText(
    "Define los perfiles de acceso: consulta roles y sus usuarios, crea roles personalizados y administra sus permisos. Asignar roles a usuarios requiere un permiso aparte.",
    );
    await expect(rolesGroup.locator(".permission-code")).toHaveText([
    "Consultar roles",
    "Crear roles",
    "Administrar roles y permisos",
    "Asignar roles a usuarios",
    ]);
    await expect(rolesGroup.locator(".permission-description")).toHaveText([
    "Ver los roles disponibles, los permisos configurados y los usuarios asignados a cada rol.",
    "Crear perfiles de acceso personalizados con nombre y descripción.",
    "Editar, activar o desactivar roles personalizados y definir los permisos que incluyen. No permite modificar roles del sistema.",
    "Cambiar los roles asignados a una cuenta de usuario; no concede permiso para editar los roles.",
    ]);
    const permissionsGroup = accessManagementGroup.locator(".permission-module-group").filter({
    has: page.getByText("Catálogo de permisos", { exact: true }),
    });
    await expect(permissionsGroup.locator(".permission-module-description")).toHaveText(
      "Consulta el catálogo de permisos disponibles para configurar el acceso de cada rol.",
    );
    await expect(permissionsGroup.locator(".permission-code")).toHaveText(
    "Consultar el catálogo de permisos",
    );
    await expect(permissionsGroup.locator(".permission-description")).toHaveText(
    "Ver los permisos disponibles para configurar el acceso de cada rol.",
    );
    const rhythmGroup = page.locator(".permission-module-group").filter({
    has: page.getByText("Ritmo comercial", { exact: true }),
    });
    await expect(
    rhythmGroup.locator(".permission-module-header > .permission-collapse-button > span"),
    ).toHaveText("Ritmo comercial");
    await expect(rhythmGroup.locator(".permission-module-description")).toHaveText(
    "Da seguimiento al desempeño comercial con métricas de cuota, pipeline del trimestre, oportunidades, leads y conversiones. Cada vendedor consulta su propio resultado; el ranking, el detalle del equipo y la vista en pantalla requieren permisos adicionales.",
    );
    await expect(rhythmGroup.locator(".permission-code")).toHaveText([
    "Consultar ritmo comercial",
    "Consultar ritmo de todo el equipo",
    "Aparecer en el ritmo comercial",
    ]);
    await expect(rhythmGroup.locator(".permission-description")).toHaveText([
    "Acceder al tablero y consultar las métricas del propio vendedor: cuota, avance, pipeline, oportunidades y conversiones. No permite consultar el detalle de otros vendedores.",
    "Ver el ranking y el detalle comercial de todos los vendedores, incluida la vista de equipo en pantalla.",
    "Incluir al vendedor en el ranking y en las listas visibles para usuarios con acceso al ritmo comercial.",
    ]);
    const manufacturerGroup = page.locator(".permission-module-group").filter({
    has: page.getByText("Registros con fabricantes", { exact: true }),
    });
    await expect(
    manufacturerGroup.locator(".permission-module-header > .permission-collapse-button > span"),
    ).toHaveText("Registros con fabricantes");
    await expect(manufacturerGroup.locator(".permission-module-description")).toHaveText(
    "Da seguimiento a los registros de fabricante vinculados a oportunidades: consulta solicitudes, aprobaciones, vencimientos y renovaciones. El acceso a cada oportunidad también depende de los permisos comerciales asignados.",
    );
    await expect(manufacturerGroup.locator(".permission-code")).toHaveText([
    "Consultar registros según acceso",
    "Solicitar registros de fabricantes",
    "Editar solicitudes de registro",
    "Gestionar aprobaciones y renovaciones",
    "Consultar registros de todas las oportunidades",
    ]);
    await expect(manufacturerGroup.locator(".permission-description")).toHaveText([
    "Ver los registros asociados a oportunidades que puedes consultar. También requiere permiso de lectura de oportunidades.",
    "Crear un registro de fabricante en una oportunidad abierta. También requiere permiso para actualizar oportunidades.",
    "Cambiar el fabricante, la fecha de solicitud o las notas del registro. También requiere permiso para actualizar oportunidades.",
    "Aprobar o rechazar registros, reabrir solicitudes y renovar registros aprobados.",
    "Consultar registros de todas las oportunidades incluidas en tu alcance comercial. También requiere permiso de lectura de oportunidades.",
    ]);
    const providersGroup = page.locator(".permission-module-group").filter({
    has: page.getByText("Proveedores", { exact: true }),
    });
    await expect(
    providersGroup.locator(".permission-module-header > .permission-collapse-button > span"),
    ).toHaveText("Proveedores");
    await expect(providersGroup.locator(".permission-module-description")).toHaveText(
    "Administra el catálogo de proveedores: consulta sus datos y contactos, crea proveedores y actualiza su información o estado. Las listas de precios tienen permisos separados.",
    );
    await expect(providersGroup.locator(".permission-code")).toHaveText([
    "Consultar proveedores",
    "Crear proveedores",
    "Actualizar proveedores",
    ]);
    await expect(providersGroup.locator(".permission-description")).toHaveText([
    "Ver el catálogo y los datos de proveedores y sus contactos.",
    "Registrar proveedores con sus datos de contacto, ubicación y estado inicial.",
    "Editar datos y contactos, y activar o desactivar proveedores. No concede acceso para editar sus listas de precios.",
    ]);
    const providerPricesGroup = page.locator(".permission-module-group").filter({
    has: page.getByText("Listas de precios de proveedores", { exact: true }),
    });
    await expect(providerPricesGroup.locator(".permission-module-description")).toHaveText(
    "Administra listas de precios y sus productos, servicios o grupos: consulta, crea y actualiza precios y estados. Requiere acceso al proveedor correspondiente.",
    );
    await expect(providerPricesGroup.locator(".permission-code")).toHaveText([
    "Consultar listas y precios",
    "Crear listas y precios",
    "Actualizar listas y precios",
    ]);
    await expect(providerPricesGroup.locator(".permission-description")).toHaveText([
    "Ver listas de precios, sus productos, servicios o grupos, monedas y estados.",
    "Crear listas de precios y agregarles productos, servicios o grupos con su precio y moneda.",
    "Editar listas, precios, productos y estados, incluida su activación o desactivación.",
    ]);
    const proposalsGroup = page.locator(".permission-module-group").filter({
    has: page.getByText("Propuestas", { exact: true }),
    });
    await expect(proposalsGroup.locator(".permission-module-description")).toHaveText(
    "Consulta y prepara propuestas comerciales y sus documentos: revisa propuestas existentes, crea nuevas y actualiza su contenido. Las acciones de cotización y aprobación siguen sujetas a sus permisos específicos.",
    );
    await expect(proposalsGroup.locator(".permission-code")).toHaveText([
    "Consultar propuestas",
    "Crear propuestas",
    "Actualizar propuestas",
    ]);
    await expect(proposalsGroup.locator(".permission-description")).toHaveText([
    "Ver propuestas comerciales y consultar los documentos y contenidos asociados.",
    "Crear propuestas y documentos de propuesta para preparar ofertas comerciales.",
    "Editar propuestas y sus documentos, incluido su contenido. No sustituye los permisos necesarios para operar o aprobar cotizaciones.",
    ]);
    const stageQuestionsGroup = page.locator(".permission-module-group").filter({
    has: page.getByText("Preguntas por etapa", { exact: true }),
    });
    await expect(stageQuestionsGroup.locator(".permission-module-description")).toHaveText(
    "Configura las preguntas que se muestran al registrar información de una oportunidad en cada etapa de venta. Permite consultar el catálogo o, con permiso de edición, crear preguntas, ajustar su contenido y orden, y activarlas o desactivarlas; no cambia las etapas comerciales.",
    );
    await expect(stageQuestionsGroup.locator(".permission-code")).toHaveText([
    "Consultar preguntas por etapa",
    "Administrar preguntas por etapa",
    ]);
    await expect(stageQuestionsGroup.locator(".permission-description")).toHaveText([
    "Ver las preguntas activas e inactivas y su configuración para cada etapa de venta.",
    "Crear y editar preguntas, definir si son obligatorias y su tipo de respuesta, cambiar su orden y activarlas o desactivarlas.",
    ]);
    const playbooksGroup = page.locator(".permission-module-group").filter({
    has: page.getByText("Playbooks técnicos", { exact: true }),
    });
    await expect(
    playbooksGroup.locator(".permission-module-header > .permission-collapse-button > span"),
    ).toHaveText("Playbooks técnicos");
    await expect(playbooksGroup.locator(".permission-module-description")).toHaveText(
    "Centraliza por solución las preguntas técnicas, reglas de validación y dimensionamiento, estructura del alcance y plantillas de topología. El contenido se versiona y sirve como base para las propuestas; el preventa revisa y aprueba el resultado.",
    );
    await expect(playbooksGroup.locator(".permission-code")).toHaveText(
    "Administrar playbooks técnicos",
    );
    await expect(playbooksGroup.locator(".permission-description")).toHaveText(
    "Editar playbooks por solución y sus metadatos, vincular su tema de Documentación RAG, generar borradores y guardar versiones. No concede por sí solo permiso para aprobar propuestas.",
    );
    const commercialPlanningGroup = page.locator(".permission-module-group").filter({
    has: page.getByText("Metas y comisiones", { exact: true }),
    });
    await expect(
    commercialPlanningGroup.locator(".permission-module-header > .permission-collapse-button > span"),
    ).toHaveText("Metas y comisiones");
    await expect(commercialPlanningGroup.locator(".permission-module-description")).toHaveText(
    "Define las metas trimestrales por vendedor y las tasas de comisión, y permite consultar el seguimiento de ventas aceptadas y comisiones. La consulta, creación inicial, edición y revisión de cambios se controlan con permisos independientes.",
    );
    await expect(commercialPlanningGroup.locator(".permission-code")).toHaveText([
    "Consultar metas y comisiones",
    "Crear planeación anual",
    "Editar metas y comisiones",
    "Consultar auditoría de planeación",
    ]);
    await expect(commercialPlanningGroup.locator(".permission-description")).toHaveText([
    "Ver las cuotas trimestrales, las tasas de comisión configuradas y el seguimiento de ventas aceptadas y comisiones.",
    "Guardar por primera vez las metas y la configuración de comisiones de un año, incluidos sus cuatro trimestres.",
    "Actualizar las cuotas y el margen esperado por vendedor, así como las tasas de comisión por trimestre y categoría en años ya configurados.",
    "Revisar la trazabilidad de los cambios guardados en la configuración trimestral de planeación y comisiones.",
    ]);
    const opportunityFamily = page.locator(".permission-family-group").filter({
    has: page.getByText("Oportunidades", { exact: true }),
    });
    const opportunitiesGroup = opportunityFamily.locator(".permission-module-group").filter({
    has: page.getByText("Gestión de oportunidades", { exact: true }),
    });
    await expect(opportunitiesGroup.locator(".permission-code")).toHaveText([
      "Consultar oportunidades y sus notas",
      "Editar oportunidades y agregar notas",
      "Consultar oportunidades de todas las cuentas",
      "Solicitar alta de oportunidades",
      "Crear oportunidades",
      "Editar oportunidades ganadas",
      "Omitir validación al avanzar de etapa",
      "Omitir validación en Demostración",
    ]);
    await expect(opportunitiesGroup.locator(".permission-description")).toHaveText([
      "Consultar el listado, los datos y las notas de las oportunidades de cuentas de las que seas propietario. No concede creación ni edición; para consultar oportunidades de todas las cuentas también necesitas oportunidades.read_all.",
      "Editar oportunidades accesibles, agregar notas y operar su flujo comercial, sujeto a las validaciones y reglas de cierre. Cambiar la activación requiere oportunidades.create; editar oportunidades ganadas requiere oportunidades.update_won.",
      "Amplía a todas las cuentas el alcance de las oportunidades y de los registros relacionados. Requiere oportunidades.read y no concede creación ni edición.",
      "Registrar solicitudes de alta de oportunidades como Pendientes de activación para su revisión. No las activa; su disponibilidad depende de la configuración del flujo de pendientes.",
      "Crear oportunidades activadas, sujeto a las validaciones del sistema. Junto con oportunidades.update permite los cambios de activación previstos; no concede por sí solo la edición de oportunidades ganadas.",
      "Editar campos de oportunidades ganadas junto con oportunidades.update. No las reabre ni permite cambiar su etapa o estado comercial; solo aplica a oportunidades accesibles.",
      "Avanzar manualmente a la siguiente etapa sin completar la validación habitual, dejando un motivo en auditoría. Solo aplica a oportunidades accesibles y no cerradas; no concede edición general.",
      "Avanzar manualmente desde Demostración sin completar su validación habitual, dejando un motivo en auditoría. No habilita excepciones en otras etapas ni concede edición general.",
    ]);
    await expect(opportunityFamily.locator(".permission-family-description")).toHaveText(
    "Gestiona las oportunidades y consulta o registra sus notas. Los permisos temporales de notas se identifican por separado.",
    );
    const temporaryNotesGroup = opportunityFamily.locator(".permission-module-group").filter({
    has: page.getByText("Permisos temporales de notas", { exact: true }),
    });
    await expect(temporaryNotesGroup.locator(".permission-code")).toHaveText([
    "Crear nota (temporal)",
    "Consultar notas (temporal)",
    ]);
    await expect(temporaryNotesGroup.locator(".permission-description")).toHaveText([
      "Permiso temporal de pruebas; no habilita por sí solo el registro de notas. La creación real requiere oportunidades.update.",
      "Permiso temporal de pruebas; no habilita por sí solo la consulta de notas. La lectura real requiere oportunidades.read.",
    ]);
    await expect(
    page.locator(".permission-module-header").filter({
      hasText: "OPORTUNIDADES.NOTES",
    }),
    ).toHaveCount(0);
    const landingGroup = page.locator(".permission-module-group").filter({
    has: page.getByText("Páginas de captación", { exact: true }),
    });
    await expect(landingGroup.locator(".permission-module-description")).toHaveText(
    "Crea y administra páginas de captación para eventos, sus versiones y publicación. También permite consultar los envíos de formularios y gestionar su procesamiento hacia el CRM mediante permisos separados.",
    );
    await expect(landingGroup.locator(".permission-code")).toHaveText([
    "Consultar páginas de captación",
    "Crear páginas de captación",
    "Editar páginas de captación",
    "Publicar páginas de captación",
    "Consultar envíos de formularios",
    "Gestionar envíos y procesamiento en CRM",
    ]);
    await expect(landingGroup.locator(".permission-description")).toHaveText([
    "Ver el listado y el detalle de las páginas de captación y sus versiones. No permite crearlas, editarlas ni publicarlas.",
    "Crear páginas de captación asociadas a eventos y preparar sus formularios para recibir registros.",
    "Modificar contenido HTML, versiones, formularios y configuración de confirmación o seguridad; también permite importar contenido y eliminar páginas.",
    "Publicar una versión validada para que la página quede disponible públicamente. No concede permiso para editar su contenido.",
    "Ver los registros recibidos por los formularios y su estado de procesamiento. No permite modificarlos ni enviarlos al CRM.",
    "Asignar vendedor, guardar notas internas, reprocesar un envío hacia el CRM o eliminarlo. No concede por sí solo acceso para consultar páginas o envíos.",
    ]);
    const leadsGroup = page.locator(".permission-module-group").filter({
    has: page.getByText("Leads", { exact: true }),
    });
    await expect(leadsGroup.locator(".permission-module-description")).toHaveText(
    "Gestiona el ciclo de los leads: consulta la bandeja y los tableros, registra y actualiza leads, analiza su información y convierte los casos resueltos en registros del CRM. El alcance de consulta y la asignación a vendedores dependen de permisos específicos.",
    );
    await expect(leadsGroup.locator(".permission-code")).toHaveText([
    "Analizar leads",
    "Registrar leads",
    "Acceder a tableros de leads",
    "Abrir detalle de tableros de leads",
    "Ver tablero ejecutivo de leads",
    "Ver tablero de gestión de leads",
    "Ver tablero operativo de leads",
    "Consultar leads asignados",
    "Consultar todos los leads",
    "Resolver leads y vincular registros",
    "Asignar leads a cualquier vendedor",
    "Asignar leads al usuario actual",
    "Actualizar y dar seguimiento a leads",
    ]);
    await expect(leadsGroup.locator(".permission-description")).toHaveText([
    "Ejecutar o consultar el análisis del lead para obtener hallazgos y sugerencias de posibles cuentas, contactos u oportunidades. No aplica por sí solo esos cambios en el CRM.",
    "Crear un lead y registrar sus datos iniciales, incluidos los documentos asociados al ingreso. No concede permiso para editar o resolver otros leads.",
    "Habilitar la entrada a los tableros de leads. Cada tablero requiere además su permiso de visualización, salvo que se tenga acceso global.",
    "Permiso previsto para abrir desde un tablero el detalle de sus indicadores en la bandeja. La consulta de leads sigue sujeta al alcance de lectura.",
    "Consultar los indicadores ejecutivos del desempeño y avance de los leads.",
    "Consultar los indicadores de gestión comercial y seguimiento de los leads.",
    "Consultar la situación operativa de la bandeja y el estado de atención de los leads.",
    "Ver la bandeja y el detalle de los leads dentro del alcance asignado. No concede acceso global ni permite crear o modificar leads.",
    "Ampliar la consulta de leads más allá del alcance individual, incluida la vista global. No concede permiso para crear, editar, analizar o resolver leads.",
    "Revisar las sugerencias del lead y vincular o crear los registros correspondientes en el CRM. Para asignarlo a un vendedor se necesita además un permiso de asignación.",
    "Al resolver un lead, elegir cualquier vendedor elegible para asignárselo. Requiere también interacciones.resolve.",
    "Al resolver un lead creado por ti, asignarlo únicamente a tu usuario. Requiere también interacciones.resolve y que seas elegible como vendedor.",
    "Editar leads y gestionar su información, documentos y seguimiento, como registrar resultados de llamadas o enviar correos asociados. El acceso sigue limitado al alcance permitido.",
    ]);
    const sellerProfileGroup = page.locator(".permission-module-group").filter({
      has: page.getByText("Perfil de vendedor", { exact: true }),
    });
    await expect(sellerProfileGroup.locator(".permission-module-description")).toHaveText(
      "Identifica a los usuarios que pueden ser asignados como vendedores al resolver leads. Este perfil solo habilita la elegibilidad; el acceso a leads y los permisos para asignarlos se configuran por separado.",
    );
    await expect(sellerProfileGroup.locator(".permission-code")).toHaveText(
      "Habilitar perfil de vendedor",
    );
    await expect(sellerProfileGroup.locator(".permission-description")).toHaveText(
      "Permite que el usuario sea seleccionado o autoasignado como vendedor al resolver leads. No concede acceso a leads ni capacidad para asignarlos; esas acciones requieren permisos independientes.",
    );
    const campaignsGroup = page.locator(".permission-module-group").filter({
      has: page.getByText("Campañas", { exact: true }),
    });
    await expect(campaignsGroup.locator(".permission-module-description")).toHaveText(
      "Administra campañas de marketing y su contexto comercial: consulta catálogos, campañas, sugerencias de cuentas y audiencias; crea campañas y actualiza sus datos y la audiencia por cuenta y contacto. La consulta, creación y edición dependen de permisos separados.",
    );
    await expect(campaignsGroup.locator(".permission-code")).toHaveText([
      "Consultar campañas",
      "Crear campañas",
      "Editar campañas y audiencia",
    ]);
    await expect(campaignsGroup.locator(".permission-description")).toHaveText([
      "Consultar catálogos, campañas, sugerencias de cuentas y la audiencia asociada. No permite crear ni modificar campañas.",
      "Crear campañas con su contexto comercial, tipo, subtipo y etapa objetivo, sujeto a las combinaciones permitidas. No concede edición posterior.",
      "Modificar los datos y el estado de las campañas, y administrar su audiencia por cuenta y los contactos asociados.",
    ]);
    const agendaGroup = page.locator(".permission-module-group").filter({
      has: page.getByText("Agenda", { exact: true }),
    });
    await expect(agendaGroup.locator(".permission-module-description")).toHaveText(
      "Consulta y organiza actividades comerciales en la agenda, revisa pendientes y alertas, y da seguimiento a compromisos. La visibilidad de la agenda propia o del equipo y la gestión de actividades se controlan con permisos independientes; editar actividades de oportunidades también requiere los permisos correspondientes de oportunidades.",
    );
    await expect(agendaGroup.locator(".permission-code")).toHaveText([
      "Consultar mi agenda",
      "Consultar la agenda del equipo",
      "Gestionar actividades de la agenda",
    ]);
    await expect(agendaGroup.locator(".permission-description")).toHaveText([
      "Consultar las actividades y alertas de la agenda propia. No permite ver la agenda de otros vendedores ni crear o modificar actividades.",
      "Consultar las actividades y alertas de todos los vendedores y seleccionar a quién mostrar en la agenda. No concede permisos para crear o modificar actividades.",
      "Crear actividades, reprogramarlas y actualizar su estado desde la agenda. Las actividades de oportunidades también requieren los permisos correspondientes para modificar esas oportunidades.",
    ]);
    const auditGroup = page.locator(".permission-module-group").filter({
      has: page.getByText("Auditoría", { exact: true }),
    });
    await expect(auditGroup.locator(".permission-module-description")).toHaveText(
      "Consulta la bitácora transversal de eventos de seguridad y operaciones del sistema, con filtros por fecha, módulo, acción, entidad, estado y usuario. Permite revisar quién realizó cada acción y los cambios registrados; es de solo lectura y no incluye exportación.",
    );
    await expect(auditGroup.locator(".permission-code")).toHaveText(
      "Consultar auditoría del sistema",
    );
    await expect(auditGroup.locator(".permission-description")).toHaveText(
      "Consultar eventos de seguridad, administración y operaciones registrados en la bitácora global, aplicar filtros y revisar sus detalles y cambios. Es un permiso de solo lectura; no permite modificar ni eliminar registros.",
    );
    const acceptOrderGroup = page.locator(".permission-module-group").filter({
      has: page.getByText("Aceptación de pedidos", { exact: true }),
    });
    await expect(acceptOrderGroup.locator(".permission-module-description")).toHaveText(
      "Da seguimiento al cierre y procesamiento posterior a la aceptación de cotizaciones: consulta etapas y documentos, actualiza el flujo operativo, genera resúmenes con IA y envía convocatorias. La edición, el uso de IA y el envío de convocatorias requieren permisos específicos.",
    );
    await expect(acceptOrderGroup.locator(".permission-code")).toHaveText([
      "Consultar procesamiento de pedidos",
      "Actualizar procesamiento de pedidos",
      "Generar resúmenes con IA",
      "Enviar convocatorias de kick off",
    ]);
    await expect(acceptOrderGroup.locator(".permission-description")).toHaveText([
      "Consultar las etapas, el estado y los documentos del procesamiento posterior a la aceptación de una cotización. No permite editar información, generar contenido con IA ni enviar convocatorias.",
      "Editar la información operativa de las etapas y gestionar sus documentos y evidencias para dar seguimiento al pedido aceptado.",
      "Generar o volver a generar resúmenes con IA a partir de las evidencias del procesamiento, cuando haya contenido compatible disponible.",
      "Enviar convocatorias y notificaciones de kick off asociadas al procesamiento del pedido. No concede permisos para editar las etapas ni generar resúmenes con IA.",
    ]);
    const aiGroup = page.locator(".permission-module-group").filter({
    has: page.getByText("Crédito y consumo de IA", { exact: true }),
    });
    await expect(aiGroup.locator(".permission-module-description")).toHaveText(
    "Consulta el crédito y el consumo de IA propio o de la organización, revisa reportes agregados y administra límites, asignaciones y tarifas de proveedores. El acceso personal, la consulta global y la administración se controlan por separado.",
    );
    await expect(aiGroup.locator(".permission-code")).toHaveText([
    "Consultar mi crédito y consumo de IA",
    "Consultar crédito y consumo de todos",
    "Administrar crédito y servicios de IA",
    "Consultar reportes de uso de IA",
    ]);
    await expect(aiGroup.locator(".permission-description")).toHaveText([
    "Consultar el crédito disponible y el consumo de IA asociados a tu propio usuario; no permite consultar datos de otras personas.",
    "Consultar saldos, consumo y detalle de uso de IA de cualquier usuario, además de tarifas y reportes agregados. No permite modificar créditos ni políticas.",
    "Configurar límites y políticas de consumo, asignaciones de crédito por usuario y tarifas de modelos de IA, incluida su sincronización y vigencia.",
    "Consultar reportes agregados de consumo de IA por usuario, proveedor u otros criterios disponibles. No permite ver o modificar la configuración de crédito.",
    ]);
    const toolsGroup = page.locator(".permission-module-group").filter({
    has: page.getByText("Herramientas del sistema", { exact: true }),
    });
    await expect(toolsGroup.locator(".permission-module-description")).toHaveText(
    "Reúne herramientas administrativas para revisar incidencias en datos operativos y aplicar correcciones controladas. Actualmente incluye el diagnóstico y la consolidación auditada de duplicados en listas de precios; cada acción requiere su permiso específico.",
    );
    await expect(toolsGroup.locator(".permission-code")).toHaveText([
    "Consultar herramientas del sistema",
    "Aplicar correcciones en herramientas",
    "Administrar herramientas avanzadas",
    ]);
    await expect(toolsGroup.locator(".permission-description")).toHaveText([
    "Consultar el catálogo, revisar incidencias y ver los grupos duplicados en listas de precios, su detalle y referencias antes de decidir una acción.",
    "Consolidar grupos de productos duplicados en listas de precios, archivando duplicados o eliminándolos cuando la validación lo permite. Las acciones quedan auditadas.",
    "Permiso previsto para acciones administrativas avanzadas. Actualmente las herramientas disponibles se controlan con herramientas.read y herramientas.update; este permiso no habilita acciones adicionales.",
    ]);
    const enablementGroup = page.locator(".permission-module-group").filter({
    has: page.getByText("Biblioteca comercial", { exact: true }),
    });
    await expect(enablementGroup.locator(".permission-module-description")).toHaveText(
    "Centraliza materiales comerciales vigentes —archivos y enlaces— para encontrarlos, previsualizarlos y usarlos en oportunidades, leads, propuestas y correos. Incluye carga, edición, publicación y control de catálogos; la visibilidad para clientes y los cambios sobre materiales ajenos dependen del permiso asignado.",
    );
    await expect(enablementGroup.locator(".permission-code")).toHaveText([
    "Administrar catálogos de la biblioteca",
    "Consultar biblioteca (permiso heredado)",
    "Gestionar todos los materiales",
    "Consultar biblioteca (compatibilidad)",
    "Cargar y editar materiales propios (compatibilidad)",
    "Cargar y editar materiales propios",
    "Buscar y usar materiales comerciales",
    ]);
    await expect(enablementGroup.locator(".permission-description")).toHaveText([
    "Crear, editar y eliminar valores de catálogos como tipos, fabricantes, tecnologías y soluciones. También permite gestionar materiales de cualquier usuario, incluidos los restringidos.",
    "Código heredado que actualmente conserva acceso de consulta a materiales activos. No habilita reportes o analítica de uso ni permite modificar materiales.",
    "Editar, activar o desactivar materiales de cualquier usuario y eliminar materiales. No concede administración de los catálogos de la biblioteca.",
    "Permiso heredado que conserva acceso de consulta a materiales activos. No permite cargarlos, editarlos ni administrar catálogos.",
    "Permiso heredado que conserva las capacidades de carga y edición de materiales propios, incluida su activación o desactivación; no permite administrar materiales ajenos ni catálogos.",
    "Crear materiales y editar los propios, incluidos sus archivos o enlaces; permite activarlos y desactivarlos. No permite modificar o eliminar materiales ajenos ni administrar catálogos.",
    "Consultar materiales activos, revisar su detalle y usarlos, por ejemplo, descargarlos, marcarlos como favoritos o generar enlaces compartibles cuando el material lo permite. No concede carga ni edición.",
    ]);
    const knowledgeBaseGroup = page.locator(".permission-module-group").filter({
    has: page.getByText("Base de conocimiento IA", { exact: true }),
    });
    await expect(knowledgeBaseGroup.locator(".permission-module-description")).toHaveText(
    "Organiza documentos internos por temas para que la IA los consulte como fuente de conocimiento. La biblioteca permite revisar los temas y documentos, mientras que los permisos de administración controlan su importación, carga, actualización, clasificación y eliminación. El acceso a esta pantalla no es requisito para consultar documentos activos desde el chatbot.",
    );
    await expect(knowledgeBaseGroup.locator(".permission-code")).toHaveText([
    "Consultar la base de conocimiento IA",
    "Administrar la base de conocimiento IA",
    ]);
    await expect(knowledgeBaseGroup.locator(".permission-description")).toHaveText([
    "Entrar al módulo para consultar los temas, documentos y su estado. No permite importar, cargar, reemplazar, clasificar ni eliminar contenido; el chatbot puede consultar documentos activos sin este permiso.",
    "Gestionar temas y documentos: importar desde Pinecone Assistant, cargar o reemplazar archivos, actualizar resúmenes y clasificación, eliminar documentos y habilitar o deshabilitar temas. Incluye acceso de consulta.",
    ]);
    const accountsGroup = page.locator(".permission-module-group").filter({
    has: page.getByText("Cuentas", { exact: true }),
    });
    await expect(accountsGroup.locator(".permission-module-description")).toHaveText(
    "Administra las cuentas comerciales, sus datos fiscales y de contacto, estado de activación y propietarios. La consulta puede limitarse a las cuentas propias o ampliarse a todas; el alta directa, las solicitudes pendientes, la edición y la asignación de propietarios se controlan con permisos distintos.",
    );
    await expect(accountsGroup.locator(".permission-code")).toHaveText([
    "Asignar propietarios de cuentas",
    "Crear cuentas activas",
    "Consultar cuentas asignadas",
    "Consultar todas las cuentas",
    "Solicitar alta de cuentas",
    "Editar cuentas",
    ]);
    await expect(accountsGroup.locator(".permission-description")).toHaveText([
    "Elegir propietarios al crear una cuenta (con cuentas.create o cuentas.request) o editarla (con cuentas.update). Sin este permiso, la cuenta nueva se asigna a quien la crea y la edición conserva sus propietarios. No amplía el acceso a otras cuentas.",
    "Crear cuentas directamente activadas, sujetas a la validación de datos y duplicados. Junto con cuentas.update permite cambiar el estado de activación; elegir otros propietarios requiere además cuentas.assign_owners_any.",
    "Consultar el listado y los datos de las cuentas de las que eres propietario. Para ampliar el alcance a todas las cuentas se requiere además cuentas.read_all. No permite crear ni editar cuentas.",
    "Ampliar a todas las cuentas el alcance de cuentas.read. Para consultar se requiere también cuentas.read; junto con cuentas.update permite editar cuentas ajenas. No concede creación ni asignación de propietarios.",
    "Registrar nuevas cuentas como Pendientes de activación para revisión, si el flujo de pendientes está habilitado. No permite activarlas; si también tienes cuentas.create, se crean activadas.",
    "Editar los datos de cuentas a las que tienes acceso. No permite crearlas; cambiar su estado requiere también cuentas.create y elegir propietarios requiere cuentas.assign_owners_any. cuentas.read_all amplía el alcance de edición a todas.",
    ]);
    const contactsGroup = page.locator(".permission-module-group").filter({
    has: page.getByText("Contactos", { exact: true }),
    });
    await expect(contactsGroup.locator(".permission-module-description")).toHaveText(
    "Administra la información y relación de los contactos vinculados a cuentas, incluidos sus datos de contacto, función, influencia y estado. El acceso sigue el alcance de las cuentas propias o puede ampliarse con un permiso global; alta directa, solicitudes pendientes y edición tienen permisos separados.",
    );
    await expect(contactsGroup.locator(".permission-code")).toHaveText([
    "Crear contactos activos",
    "Consultar contactos de cuentas asignadas",
    "Consultar contactos de todas las cuentas",
    "Solicitar alta de contactos",
    "Editar contactos",
    ]);
    await expect(contactsGroup.locator(".permission-description")).toHaveText([
    "Crear contactos activos asociados a una cuenta accesible, sujetos a validaciones y revisión de posibles duplicados. Junto con contactos.update permite cambiar el estado; elegir otra cuenta requiere acceso a ella.",
    "Ver los contactos asociados a cuentas de las que eres propietario. Para ampliar la consulta a contactos de otras cuentas se requiere además contactos.read_all. No permite crear ni editar contactos.",
    "Ampliar a todas las cuentas el alcance de contactos.read. Requiere también contactos.read; junto con permisos de creación o edición, permite operar contactos de otras cuentas. No concede creación ni edición por sí solo.",
    "Registrar contactos nuevos como Pendientes de activación para revisión, si el flujo de pendientes está habilitado. No permite activarlos; si también tienes contactos.create, se crean activados.",
    "Actualizar los datos y la información relacional de contactos dentro de tu alcance. No permite crearlos; cambiar su estado de activación requiere también contactos.create. contactos.read_all amplía el alcance a contactos de todas las cuentas.",
    ]);
    const quotationsGroup = page.locator(".permission-module-group").filter({
    has: page.getByText("Cotizaciones", { exact: true }),
    });
    await expect(quotationsGroup.locator(".permission-module-description")).toHaveText(
    "Gestiona el ciclo de cotización desde la preparación hasta la aprobación y el resultado comercial. Los permisos distinguen operación de ventas, ingreso de logística, revisión y aprobación humana o con IA; la administración amplia y la consulta de cliente son accesos separados.",
    );
    await expect(quotationsGroup.locator(".permission-code")).toHaveText([
    "Administrar cotizaciones",
    "Gestionar cotizaciones en logística",
    "Gestionar cotizaciones como vendedor",
    "Aprobar cotizaciones sin IA",
    "Aprobar cotizaciones con IA",
    "Consultar cotizaciones como cliente",
    "Revisar cotizaciones para aprobación",
    ]);
    await expect(quotationsGroup.locator(".permission-description")).toHaveText([
    "Acceder a todas las acciones y al historial de versiones; crear o editar versiones incluso en estados avanzados. Es un permiso amplio, sujeto a las validaciones del flujo.",
    "Gestionar el ingreso de cotizaciones: editar borradores, solicitar aprobación, registrar como ganada una cotización aprobada o devolver una ganada a borrador, según las reglas del flujo.",
    "Crear y preparar cotizaciones, solicitar su aprobación, enviarlas y registrar su resultado comercial según el estado. Aprobarlas requiere además autorización para aprobar sin IA o con IA.",
    "Aprobar manualmente cotizaciones en estados habilitados. La acción sigue sujeta a las reglas de transición y validaciones comerciales.",
    "Ejecutar la aprobación asistida por IA en los estados habilitados. La acción depende de las reglas de transición, las validaciones y el resultado del análisis.",
    "Consultar, sin modificarlas, las cotizaciones disponibles para el cliente en estados aprobada, enviada, ganada o aceptada.",
    "Revisar, corregir y rechazar cotizaciones en el flujo de aprobación. Este permiso no aprueba por sí solo: se requiere además autorización para aprobar sin IA o con IA.",
    ]);
    const securityTestsGroup = page.locator(".permission-module-group").filter({
    has: page.getByText("Pruebas de seguridad", { exact: true }),
    });
    await expect(
    securityTestsGroup.locator(".permission-module-header > .permission-collapse-button > span"),
    ).toHaveText("Pruebas de seguridad");
    await expect(securityTestsGroup.locator(".permission-module-description")).toHaveText(
    "Permite revisar ejecuciones y reportes de pruebas controladas de seguridad, como validaciones del WAF, límites de solicitudes y defensas de API. Algunas pruebas avanzadas requieren permisos administrativos.",
    );
    await expect(securityTestsGroup.locator(".permission-code")).toHaveText([
    "Consultar pruebas de seguridad",
    "Ejecutar pruebas de seguridad",
    "Administrar pruebas avanzadas",
    ]);
    await expect(securityTestsGroup.locator(".permission-description")).toHaveText([
    "Ver ejecuciones, su estado y los reportes de las pruebas de seguridad.",
    "Iniciar y cancelar pruebas controladas con perfiles permitidos; las pruebas avanzadas requieren autorización administrativa.",
    "Ejecutar pruebas restringidas, como perfiles F5, DDoS L7 y pruebas de API, y eliminar ejecuciones finalizadas.",
    ]);
    await logisticsPermissionRow.locator(".permission-description").click();
    await expect(logisticsPermissionRow.getByRole("checkbox")).not.toBeChecked();
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect.poll(() => savedIds).toEqual(permissions.filter((permission) => permission.id !== 2).map((permission) => permission.id));
    await expect(page.getByText(/Permisos guardados correctamente/)).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("roles-layout.png") });
  });
}
