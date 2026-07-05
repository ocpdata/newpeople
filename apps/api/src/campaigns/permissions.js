import { withTransaction } from "../db.js";

const CAMPAIGN_PERMISSIONS = [
  {
    code: "campanas.read",
    module: "campanas",
    action: "read",
    description: "Ver modulo de campanas",
  },
  {
    code: "campanas.create",
    module: "campanas",
    action: "create",
    description: "Crear campanas",
  },
  {
    code: "campanas.update",
    module: "campanas",
    action: "update",
    description: "Editar campanas y su audiencia por cuenta",
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

export async function ensureCampaignPermissions() {
  await withTransaction(async (conn) => {
    const now = new Date();

    for (const permission of CAMPAIGN_PERMISSIONS) {
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

    const placeholders = CAMPAIGN_PERMISSIONS.map(() => "?").join(", ");
    const [permissionRows] = await conn.query(
      `SELECT id, code
       FROM permissions
       WHERE code IN (${placeholders})`,
      CAMPAIGN_PERMISSIONS.map((permission) => permission.code),
    );
    const permissionByCode = new Map(
      permissionRows.map((permission) => [permission.code, permission]),
    );

    const [adminRoles] = await conn.query(
      `SELECT id
       FROM roles
       WHERE is_system = 1 OR name = 'Administrador'`,
    );

    for (const permission of CAMPAIGN_PERMISSIONS) {
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
      permissionByCode.get("campanas.read"),
      now,
    );

    const [commercialUpdateRoles] = await conn.query(
      `SELECT DISTINCT rp.role_id AS id
       FROM role_permissions rp
       INNER JOIN permissions p ON p.id = rp.permission_id
       WHERE p.code = 'desarrollo_comercial.update'`,
    );

    for (const permissionCode of ["campanas.create", "campanas.update"]) {
      await assignPermissionToRoles(
        conn,
        commercialUpdateRoles,
        permissionByCode.get(permissionCode),
        now,
      );
    }
  });
}
