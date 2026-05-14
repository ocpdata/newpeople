import { withTransaction } from "../db.js";

const COMMERCIAL_MANAGER_ROLE_NAMES = [
  "gerente comercial",
  "gerente de ventas",
  "director comercial",
  "director de ventas",
  "lider comercial",
  "coordinador comercial",
  "jefe comercial",
  "preventa",
];

const COMMERCIAL_ENABLEMENT_PERMISSIONS = [
  {
    code: "enablement_comercial.use",
    module: "enablement_comercial",
    action: "use",
    description: "Buscar, abrir y usar activos de enablement comercial",
  },
  {
    code: "enablement_comercial.upload",
    module: "enablement_comercial",
    action: "upload",
    description: "Cargar y editar activos de enablement comercial",
  },
  {
    code: "enablement_comercial.manage",
    module: "enablement_comercial",
    action: "manage",
    description:
      "Publicar, obsoletar y gobernar activos de enablement comercial",
  },
  {
    code: "enablement_comercial.admin",
    module: "enablement_comercial",
    action: "admin",
    description: "Administrar catalogos y gobierno del enablement comercial",
  },
  {
    code: "enablement_comercial.read",
    module: "enablement_comercial",
    action: "read",
    description: "Ver biblioteca y recomendaciones de enablement comercial",
  },
  {
    code: "enablement_comercial.update",
    module: "enablement_comercial",
    action: "update",
    description: "Crear y mantener recursos de enablement comercial",
  },
  {
    code: "enablement_comercial.analytics",
    module: "enablement_comercial",
    action: "analytics",
    description: "Consultar analitica del enablement comercial",
  },
];

const MANAGER_PERMISSION_CODES = [
  "enablement_comercial.use",
  "enablement_comercial.upload",
  "enablement_comercial.manage",
  "enablement_comercial.read",
  "enablement_comercial.update",
  "enablement_comercial.analytics",
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

export async function ensureCommercialEnablementPermissions() {
  await withTransaction(async (conn) => {
    const now = new Date();

    for (const permission of COMMERCIAL_ENABLEMENT_PERMISSIONS) {
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

    const placeholders = COMMERCIAL_ENABLEMENT_PERMISSIONS.map(() => "?").join(
      ", ",
    );
    const [permissionRows] = await conn.query(
      `SELECT id, code
       FROM permissions
       WHERE code IN (${placeholders})`,
      COMMERCIAL_ENABLEMENT_PERMISSIONS.map((permission) => permission.code),
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
      const managerPermissionPlaceholders = MANAGER_PERMISSION_CODES.map(
        () => "?",
      ).join(", ");
      const [managerPermissionRows] = await conn.query(
        `SELECT id
         FROM permissions
         WHERE code IN (${managerPermissionPlaceholders})`,
        MANAGER_PERMISSION_CODES,
      );
      await assignPermissionsToRoles(
        conn,
        managerRoles,
        managerPermissionRows,
        now,
      );
    }
  });
}
