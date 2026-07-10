import { withTransaction } from "../db.js";

const CALENDAR_MANAGER_ROLE_NAMES = [
  "gerente comercial",
  "gerente de ventas",
  "director comercial",
  "director de ventas",
  "lider comercial",
  "coordinador comercial",
  "jefe comercial",
  "preventa",
];

const COMMERCIAL_CALENDAR_PERMISSIONS = [
  {
    code: "calendario_comercial.read",
    module: "calendario_comercial",
    action: "read",
    description: "Ver el modulo de calendario comercial",
  },
  {
    code: "calendario_comercial.read_all",
    module: "calendario_comercial",
    action: "read_all",
    description: "Ver calendarios comerciales de todos los vendedores",
  },
  {
    code: "calendario_comercial.update",
    module: "calendario_comercial",
    action: "update",
    description: "Crear y actualizar actividades desde el calendario comercial",
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

export async function ensureCommercialCalendarPermissions(options = {}) {
  const autoAssignRoles = Boolean(options.autoAssignRoles);
  await withTransaction(async (conn) => {
    const now = new Date();

    for (const permission of COMMERCIAL_CALENDAR_PERMISSIONS) {
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

    const placeholders = COMMERCIAL_CALENDAR_PERMISSIONS.map(() => "?").join(
      ", ",
    );
    const [permissionRows] = await conn.query(
      `SELECT id, code
       FROM permissions
       WHERE code IN (${placeholders})`,
      COMMERCIAL_CALENDAR_PERMISSIONS.map((permission) => permission.code),
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
    await assignPermissionsToRoles(conn, adminRoles, permissionRows, now);

    const [sellerRoles] = await conn.query(
      `SELECT id
       FROM roles
       WHERE LOWER(TRIM(name)) = 'vendedor'`,
    );
    await assignPermissionsToRoles(
      conn,
      sellerRoles,
      permissionRows.filter((permission) =>
        ["calendario_comercial.read", "calendario_comercial.update"].includes(
          permission.code,
        ),
      ),
      now,
    );

    const managerPlaceholders = CALENDAR_MANAGER_ROLE_NAMES.map(() => "?").join(
      ", ",
    );
    const [managerRoles] = await conn.query(
      `SELECT id
       FROM roles
       WHERE LOWER(TRIM(name)) IN (${managerPlaceholders})`,
      CALENDAR_MANAGER_ROLE_NAMES,
    );
    await assignPermissionsToRoles(conn, managerRoles, permissionRows, now);

    const [readRoles] = await conn.query(
      `SELECT DISTINCT rp.role_id AS id
       FROM role_permissions rp
       INNER JOIN permissions p ON p.id = rp.permission_id
       WHERE p.code IN ('oportunidades.read', 'oportunidades.read_all')`,
    );
    await assignPermissionsToRoles(
      conn,
      readRoles,
      permissionRows.filter((permission) =>
        ["calendario_comercial.read"].includes(permission.code),
      ),
      now,
    );

    const [readAllRoles] = await conn.query(
      `SELECT DISTINCT rp.role_id AS id
       FROM role_permissions rp
       INNER JOIN permissions p ON p.id = rp.permission_id
       WHERE p.code = 'oportunidades.read_all'`,
    );
    await assignPermissionsToRoles(
      conn,
      readAllRoles,
      permissionRows.filter((permission) =>
        ["calendario_comercial.read_all"].includes(permission.code),
      ),
      now,
    );

    const [updateRoles] = await conn.query(
      `SELECT DISTINCT rp.role_id AS id
       FROM role_permissions rp
       INNER JOIN permissions p ON p.id = rp.permission_id
       WHERE p.code = 'oportunidades.update'`,
    );
    await assignPermissionsToRoles(
      conn,
      updateRoles,
      permissionRows.filter((permission) =>
        ["calendario_comercial.update"].includes(permission.code),
      ),
      now,
    );
  });
}
