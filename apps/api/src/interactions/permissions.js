import { withTransaction } from "../db.js";

const INTERACTION_PERMISSIONS = [
  {
    code: "interacciones.read",
    module: "interacciones",
    action: "read",
    description:
      "Consultar la bandeja y el detalle de leads dentro del alcance permitido",
  },
  {
    code: "interacciones.read_all",
    module: "interacciones",
    action: "read_all",
    description:
      "Ampliar la consulta de leads más allá del alcance individual; no concede creación ni edición",
  },
  {
    code: "interacciones.create",
    module: "interacciones",
    action: "create",
    description:
      "Crear leads y registrar sus datos iniciales y documentos de ingreso",
  },
  {
    code: "interacciones.update",
    module: "interacciones",
    action: "update",
    description:
      "Editar leads y gestionar su información, documentos y seguimiento",
  },
  {
    code: "interacciones.analyze",
    module: "interacciones",
    action: "analyze",
    description:
      "Ejecutar análisis de leads y consultar hallazgos y sugerencias sin aplicarlos al CRM",
  },
  {
    code: "interacciones.resolve",
    module: "interacciones",
    action: "resolve",
    description:
      "Revisar sugerencias de un lead y vincular o crear los registros correspondientes en el CRM",
  },
  {
    code: "interacciones.dashboard.access",
    module: "interacciones",
    action: "dashboard_access",
    description:
      "Habilitar la entrada a tableros de leads; la vista de cada tablero requiere su permiso específico",
  },
  {
    code: "interacciones.dashboard.executive.view",
    module: "interacciones",
    action: "dashboard_executive_view",
    description: "Consultar indicadores ejecutivos del desempeño de los leads",
  },
  {
    code: "interacciones.dashboard.management.view",
    module: "interacciones",
    action: "dashboard_management_view",
    description: "Consultar indicadores de gestión comercial y seguimiento de leads",
  },
  {
    code: "interacciones.dashboard.operations.view",
    module: "interacciones",
    action: "dashboard_operations_view",
    description: "Consultar la situación operativa y el estado de atención de los leads",
  },
  {
    code: "interacciones.dashboard.drilldown.view",
    module: "interacciones",
    action: "dashboard_drilldown_view",
    description:
      "Permiso previsto para abrir desde un tablero el detalle de sus indicadores en la bandeja",
  },
  {
    code: "interacciones.resolve.assign_self",
    module: "interacciones",
    action: "resolve_assign_self",
    description:
      "Al resolver un lead propio, asignarlo al usuario actual; requiere permiso de resolución y elegibilidad como vendedor",
  },
  {
    code: "interacciones.resolve.assign_any",
    module: "interacciones",
    action: "resolve_assign_any",
    description:
      "Al resolver un lead, asignarlo a cualquier vendedor elegible; requiere permiso de resolución",
  },
  {
    code: "comercial.seller.eligible",
    module: "comercial",
    action: "seller_eligible",
    description:
      "Habilita al usuario para ser asignado como vendedor al resolver leads. No concede acceso a leads ni permisos para asignarlos.",
  },
];

export async function ensureInteractionPermissions(options = {}) {
  const autoAssignRoles = Boolean(options.autoAssignRoles);
  await withTransaction(async (conn) => {
    const now = new Date();

    for (const permission of INTERACTION_PERMISSIONS) {
      await conn.query(
        `INSERT INTO permissions (code, module, action, description, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1
           FROM permissions
           WHERE code = ?
         )`,
        [
          permission.code,
          permission.module,
          permission.action,
          permission.description,
          now,
          now,
          permission.code,
        ],
      );
      await conn.query(
        `UPDATE permissions
         SET description = ?, updated_at = ?
         WHERE code = ? AND IFNULL(description, '') <> ?`,
        [permission.description, now, permission.code, permission.description],
      );
    }

    if (!autoAssignRoles) {
      return;
    }

    const [adminRoles] = await conn.query(
      `SELECT id
       FROM roles
       WHERE is_system = 1 OR name = 'Administrador'`,
    );

    if (!adminRoles.length) {
      return;
    }

    const placeholders = INTERACTION_PERMISSIONS.map(() => "?").join(", ");
    const [permissionRows] = await conn.query(
      `SELECT id
       FROM permissions
       WHERE code IN (${placeholders})`,
      INTERACTION_PERMISSIONS.map((permission) => permission.code),
    );

    for (const role of adminRoles) {
      for (const permission of permissionRows) {
        await conn.query(
          `INSERT INTO role_permissions (role_id, permission_id, created_at)
           SELECT ?, ?, ?
           WHERE NOT EXISTS (
             SELECT 1
             FROM role_permissions
             WHERE role_id = ? AND permission_id = ?
           )`,
          [role.id, permission.id, now, role.id, permission.id],
        );
      }
    }
  });
}
