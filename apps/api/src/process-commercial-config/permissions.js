import { withTransaction } from "../db.js";

const PROCESS_COMMERCIAL_CONFIG_PERMISSIONS = [
  {
    code: "proceso_comercial_config.read",
    module: "proceso_comercial_config",
    action: "read",
    description: "Ver la configuracion del proceso comercial",
  },
  {
    code: "proceso_comercial_config.update",
    module: "proceso_comercial_config",
    action: "update",
    description: "Actualizar la configuracion del proceso comercial",
  },
];

export async function ensureProcessCommercialConfigPermissions(options = {}) {
  const autoAssignRoles = Boolean(options.autoAssignRoles);
  await withTransaction(async (conn) => {
    const now = new Date();

    for (const permission of PROCESS_COMMERCIAL_CONFIG_PERMISSIONS) {
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

    if (!autoAssignRoles) {
      return;
    }

    const placeholders = PROCESS_COMMERCIAL_CONFIG_PERMISSIONS.map(() => "?").join(
      ", ",
    );
    const [permissionRows] = await conn.query(
      `SELECT id
       FROM permissions
       WHERE code IN (${placeholders})`,
      PROCESS_COMMERCIAL_CONFIG_PERMISSIONS.map((permission) => permission.code),
    );

    const [adminRoles] = await conn.query(
      `SELECT id
       FROM roles
       WHERE is_system = 1 OR name = 'Administrador'`,
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