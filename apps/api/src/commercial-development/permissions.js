import { withTransaction } from "../db.js";

const COMMERCIAL_DEVELOPMENT_PERMISSIONS = [
  {
    code: "desarrollo_comercial.read",
    module: "desarrollo_comercial",
    action: "read",
    description: "Ver el modulo de desarrollo comercial",
  },
  {
    code: "desarrollo_comercial.update",
    module: "desarrollo_comercial",
    action: "update",
    description: "Operar el modulo de desarrollo comercial",
  },
];

async function assignPermissionToRoles(conn, roleRows, permissionRow, now) {
  if (!permissionRow) return;

  for (const role of roleRows) {
    await conn.query(
      `INSERT INTO role_permissions (role_id, permission_id, created_at)
       SELECT ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1
         FROM role_permissions
         WHERE role_id = ? AND permission_id = ?
       )`,
      [role.id, permissionRow.id, now, role.id, permissionRow.id],
    );
  }
}

export async function ensureCommercialDevelopmentPermissions(options = {}) {
  const autoAssignRoles = Boolean(options.autoAssignRoles);
  await withTransaction(async (conn) => {
    const now = new Date();

    for (const permission of COMMERCIAL_DEVELOPMENT_PERMISSIONS) {
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

    const placeholders = COMMERCIAL_DEVELOPMENT_PERMISSIONS.map(() => "?").join(
      ", ",
    );
    const [permissionRows] = await conn.query(
      `SELECT id, code
       FROM permissions
       WHERE code IN (${placeholders})`,
      COMMERCIAL_DEVELOPMENT_PERMISSIONS.map((permission) => permission.code),
    );
    const permissionByCode = new Map(
      permissionRows.map((permission) => [permission.code, permission]),
    );

    if (!autoAssignRoles) {
      return;
    }

    const [adminRoles] = await conn.query(
      `SELECT id
       FROM roles
       WHERE is_system = 1 OR name = 'Administrador'`,
    );
    await assignPermissionToRoles(
      conn,
      adminRoles,
      permissionByCode.get("desarrollo_comercial.read"),
      now,
    );
    await assignPermissionToRoles(
      conn,
      adminRoles,
      permissionByCode.get("desarrollo_comercial.update"),
      now,
    );

    const [readRoles] = await conn.query(
      `SELECT DISTINCT rp.role_id AS id
       FROM role_permissions rp
       INNER JOIN permissions p ON p.id = rp.permission_id
       INNER JOIN roles r ON r.id = rp.role_id
       WHERE p.code IN ('oportunidades.read', 'oportunidades.read_all')
         AND LOWER(TRIM(r.name)) <> 'vendedor'`,
    );
    await assignPermissionToRoles(
      conn,
      readRoles,
      permissionByCode.get("desarrollo_comercial.read"),
      now,
    );

    const [updateRoles] = await conn.query(
      `SELECT DISTINCT rp.role_id AS id
       FROM role_permissions rp
       INNER JOIN permissions p ON p.id = rp.permission_id
       INNER JOIN roles r ON r.id = rp.role_id
       WHERE p.code = 'oportunidades.update'
         AND LOWER(TRIM(r.name)) <> 'vendedor'`,
    );
    await assignPermissionToRoles(
      conn,
      updateRoles,
      permissionByCode.get("desarrollo_comercial.read"),
      now,
    );
    await assignPermissionToRoles(
      conn,
      updateRoles,
      permissionByCode.get("desarrollo_comercial.update"),
      now,
    );
  });
}