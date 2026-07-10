import { withTransaction } from "../db.js";

const LANDING_PERMISSIONS = [
  {
    code: "landing.read",
    module: "landing",
    action: "read_pages",
    description: "Ver el modulo de landing pages",
  },
  {
    code: "landing.create",
    module: "landing",
    action: "create",
    description: "Crear landings por evento",
  },
  {
    code: "landing.update",
    module: "landing",
    action: "update",
    description: "Editar landings por evento",
  },
  {
    code: "landing.publish",
    module: "landing",
    action: "publish",
    description: "Publicar landings por evento",
  },
  {
    code: "landing.submissions.read",
    module: "landing",
    action: "read_submissions",
    description: "Ver envios de formularios de landing",
  },
  {
    code: "landing.submissions.reprocess",
    module: "landing",
    action: "reprocess_submissions",
    description: "Reprocesar envios de landing hacia CRM",
  },
];

async function assignPermissionToRoles(conn, roleRows, permissionRow, now) {
  if (!permissionRow) return;

  for (const role of roleRows) {
    await conn.query(
      `INSERT INTO role_permissions (role_id, permission_id, created_at)
       SELECT ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM role_permissions WHERE role_id = ? AND permission_id = ?
       )`,
      [role.id, permissionRow.id, now, role.id, permissionRow.id],
    );
  }
}

export async function ensureLandingPermissions(options = {}) {
  const autoAssignRoles = Boolean(options.autoAssignRoles);
  await withTransaction(async (conn) => {
    const now = new Date();

    for (const permission of LANDING_PERMISSIONS) {
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

    const placeholders = LANDING_PERMISSIONS.map(() => "?").join(", ");
    const [permissionRows] = await conn.query(
      `SELECT id, code
       FROM permissions
       WHERE code IN (${placeholders})`,
      LANDING_PERMISSIONS.map((permission) => permission.code),
    );
    const permissionByCode = new Map(
      permissionRows.map((permission) => [permission.code, permission]),
    );

    const [adminRoles] = await conn.query(
      `SELECT id
       FROM roles
       WHERE is_system = 1 OR name = 'Administrador'`,
    );

    for (const permission of LANDING_PERMISSIONS) {
      await assignPermissionToRoles(
        conn,
        adminRoles,
        permissionByCode.get(permission.code),
        now,
      );
    }

    const [commercialReadRoles] = await conn.query(
      `SELECT DISTINCT rp.role_id AS id
       FROM role_permissions rp
       INNER JOIN permissions p ON p.id = rp.permission_id
       WHERE p.code IN ('desarrollo_comercial.read', 'desarrollo_comercial.update')`,
    );

    await assignPermissionToRoles(
      conn,
      commercialReadRoles,
      permissionByCode.get("landing.read"),
      now,
    );
    await assignPermissionToRoles(
      conn,
      commercialReadRoles,
      permissionByCode.get("landing.submissions.read"),
      now,
    );

    const [commercialUpdateRoles] = await conn.query(
      `SELECT DISTINCT rp.role_id AS id
       FROM role_permissions rp
       INNER JOIN permissions p ON p.id = rp.permission_id
       WHERE p.code = 'desarrollo_comercial.update'`,
    );

    for (const permissionCode of [
      "landing.create",
      "landing.update",
      "landing.publish",
      "landing.submissions.reprocess",
    ]) {
      await assignPermissionToRoles(
        conn,
        commercialUpdateRoles,
        permissionByCode.get(permissionCode),
        now,
      );
    }
  });
}
