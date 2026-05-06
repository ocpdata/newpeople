import { withTransaction } from "../db.js";

const COMMERCIAL_MANAGER_ROLE_NAMES = [
  "gerente comercial",
  "gerente de ventas",
  "director comercial",
  "director de ventas",
  "lider comercial",
  "coordinador comercial",
  "jefe comercial",
];

const COMMERCIAL_PLANNING_PERMISSIONS = [
  {
    code: "planeacion_comercial.read",
    module: "planeacion_comercial",
    action: "read",
    description: "Ver planeacion comercial trimestral",
  },
  {
    code: "planeacion_comercial.create",
    module: "planeacion_comercial",
    action: "create",
    description: "Crear periodos y versiones de planeacion comercial",
  },
  {
    code: "planeacion_comercial.update",
    module: "planeacion_comercial",
    action: "update",
    description: "Editar metas trimestrales de planeacion comercial",
  },
  {
    code: "planeacion_comercial.publish",
    module: "planeacion_comercial",
    action: "publish",
    description: "Publicar versiones de planeacion comercial",
  },
  {
    code: "planeacion_comercial.close",
    module: "planeacion_comercial",
    action: "close",
    description: "Cerrar periodos de planeacion comercial",
  },
  {
    code: "planeacion_comercial.audit.read",
    module: "planeacion_comercial",
    action: "audit.read",
    description: "Consultar auditoria de planeacion comercial",
  },
  {
    code: "planeacion_comercial.override_validation",
    module: "planeacion_comercial",
    action: "override_validation",
    description: "Publicar planeacion comercial con advertencias justificadas",
  },
];

async function assignPermissionsToRoles(conn, roleRows, permissionRows, now) {
  for (const role of roleRows) {
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
}

export async function ensureCommercialPlanningPermissions() {
  await withTransaction(async (conn) => {
    const now = new Date();

    for (const permission of COMMERCIAL_PLANNING_PERMISSIONS) {
      await conn.query(
        `INSERT INTO permissions (code, module, action, description, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM permissions WHERE code = ?
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
    }

    const placeholders = COMMERCIAL_PLANNING_PERMISSIONS.map(() => "?").join(
      ", ",
    );
    const [permissionRows] = await conn.query(
      `SELECT id, code
       FROM permissions
       WHERE code IN (${placeholders})`,
      COMMERCIAL_PLANNING_PERMISSIONS.map((permission) => permission.code),
    );

    const [adminRoles] = await conn.query(
      `SELECT id
       FROM roles
       WHERE is_system = 1 OR name = 'Administrador'`,
    );
    if (adminRoles.length) {
      await assignPermissionsToRoles(conn, adminRoles, permissionRows, now);
    }

    const managerPlaceholders = COMMERCIAL_MANAGER_ROLE_NAMES.map(
      () => "?",
    ).join(", ");
    const [managerRoles] = await conn.query(
      `SELECT id
       FROM roles
       WHERE LOWER(TRIM(name)) IN (${managerPlaceholders})`,
      COMMERCIAL_MANAGER_ROLE_NAMES,
    );

    if (managerRoles.length) {
      await assignPermissionsToRoles(conn, managerRoles, permissionRows, now);
    }
  });
}
