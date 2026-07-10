import { withTransaction } from "../db.js";

const MANAGER_ROLE_NAMES = [
  "gerente comercial",
  "gerente de ventas",
  "director comercial",
  "director de ventas",
  "lider comercial",
  "coordinador comercial",
  "jefe comercial",
];

const REQUESTER_ROLE_NAMES = ["vendedor"];

const MANUFACTURER_REGISTRATION_PERMISSIONS = [
  {
    code: "registros_fabricantes.read",
    module: "registros_fabricantes",
    action: "read",
    description: "Consultar registros de fabricantes por oportunidad",
  },
  {
    code: "registros_fabricantes.request",
    module: "registros_fabricantes",
    action: "request",
    description: "Solicitar registros de fabricantes",
  },
  {
    code: "registros_fabricantes.update",
    module: "registros_fabricantes",
    action: "update",
    description: "Actualizar datos administrativos de registros de fabricantes",
  },
  {
    code: "registros_fabricantes.manage",
    module: "registros_fabricantes",
    action: "manage",
    description:
      "Aprobar, rechazar, reabrir y renovar registros de fabricantes",
  },
  {
    code: "registros_fabricantes.read_all",
    module: "registros_fabricantes",
    action: "read_all",
    description:
      "Consultar registros de fabricantes de todas las oportunidades",
  },
];

const LEGACY_CREATE_PERMISSION = {
  code: "registros_fabricantes.create",
  action: "create",
  description: "Crear registros de fabricantes",
};

async function assignPermissionsToRoles(conn, roleRows, permissionRows, now) {
  for (const role of roleRows) {
    for (const permission of permissionRows) {
      await conn.query(
        `INSERT INTO role_permissions (role_id, permission_id, created_at)
         SELECT ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM role_permissions WHERE role_id = ? AND permission_id = ?
         )`,
        [role.id, permission.id, now, role.id, permission.id],
      );
    }
  }
}

export async function ensureManufacturerRegistrationPermissions(options = {}) {
  const autoAssignRoles = Boolean(options.autoAssignRoles);
  await withTransaction(async (conn) => {
    const now = new Date();

    const [legacyPermissionRows] = await conn.query(
      `SELECT id
       FROM permissions
       WHERE code = ?`,
      [LEGACY_CREATE_PERMISSION.code],
    );

    if (legacyPermissionRows.length) {
      const [requestPermissionRows] = await conn.query(
        `SELECT id
         FROM permissions
         WHERE code = ?`,
        ["registros_fabricantes.request"],
      );

      if (requestPermissionRows.length) {
        for (const legacyPermission of legacyPermissionRows) {
          await conn.query(
            `DELETE FROM role_permissions
             WHERE permission_id = ?`,
            [legacyPermission.id],
          );
          await conn.query(
            `DELETE FROM permissions
             WHERE id = ?`,
            [legacyPermission.id],
          );
        }
      } else {
        await conn.query(
          `UPDATE permissions
           SET code = ?, action = ?, description = ?, updated_at = ?
           WHERE code = ?`,
          [
            "registros_fabricantes.request",
            "request",
            "Solicitar registros de fabricantes",
            now,
            LEGACY_CREATE_PERMISSION.code,
          ],
        );
      }
    }

    for (const permission of MANUFACTURER_REGISTRATION_PERMISSIONS) {
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

    const placeholders = MANUFACTURER_REGISTRATION_PERMISSIONS.map(
      () => "?",
    ).join(", ");
    const [permissionRows] = await conn.query(
      `SELECT id, code FROM permissions WHERE code IN (${placeholders})`,
      MANUFACTURER_REGISTRATION_PERMISSIONS.map(
        (permission) => permission.code,
      ),
    );

    const requesterPermissions = permissionRows.filter((permission) =>
      ["registros_fabricantes.read", "registros_fabricantes.request"].includes(
        permission.code,
      ),
    );

    const [adminRoles] = await conn.query(
      `SELECT id FROM roles WHERE is_system = 1 OR name = 'Administrador'`,
    );
    if (adminRoles.length) {
      await assignPermissionsToRoles(conn, adminRoles, permissionRows, now);
    }

    const requesterPlaceholders = REQUESTER_ROLE_NAMES.map(() => "?").join(
      ", ",
    );
    const [requesterRoles] = await conn.query(
      `SELECT id FROM roles WHERE LOWER(TRIM(name)) IN (${requesterPlaceholders})`,
      REQUESTER_ROLE_NAMES,
    );
    if (requesterRoles.length && requesterPermissions.length) {
      await assignPermissionsToRoles(
        conn,
        requesterRoles,
        requesterPermissions,
        now,
      );
    }

    const managerPlaceholders = MANAGER_ROLE_NAMES.map(() => "?").join(", ");
    const [managerRoles] = await conn.query(
      `SELECT id FROM roles WHERE LOWER(TRIM(name)) IN (${managerPlaceholders})`,
      MANAGER_ROLE_NAMES,
    );
    if (managerRoles.length) {
      await assignPermissionsToRoles(conn, managerRoles, permissionRows, now);
    }
  });
}
