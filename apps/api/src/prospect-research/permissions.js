import { withTransaction } from "../db.js";

const COMMERCIAL_ROLE_NAMES = [
  "vendedor",
  "gerente comercial",
  "gerente de ventas",
  "director comercial",
  "director de ventas",
  "lider comercial",
  "coordinador comercial",
  "jefe comercial",
  "preventa",
];

const PROSPECT_RESEARCH_PERMISSIONS = [
  {
    code: "prospeccion.read",
    module: "prospeccion",
    action: "read",
    description: "Ver sesiones y fichas de prospeccion asistida",
  },
  {
    code: "prospeccion.create",
    module: "prospeccion",
    action: "create",
    description: "Crear investigaciones de cuentas nuevas",
  },
  {
    code: "prospeccion.update",
    module: "prospeccion",
    action: "update",
    description: "Confirmar, rechazar y mantener hallazgos de prospeccion",
  },
  {
    code: "prospeccion.admin",
    module: "prospeccion",
    action: "admin",
    description: "Administrar configuracion y gobierno de prospeccion asistida",
  },
];

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

export async function ensureProspectResearchPermissions(options = {}) {
  const autoAssignRoles = Boolean(options.autoAssignRoles);
  await withTransaction(async (conn) => {
    const now = new Date();

    for (const permission of PROSPECT_RESEARCH_PERMISSIONS) {
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

    if (!autoAssignRoles) return;

    const placeholders = PROSPECT_RESEARCH_PERMISSIONS.map(() => "?").join(", ");
    const [permissionRows] = await conn.query(
      `SELECT id, code FROM permissions WHERE code IN (${placeholders})`,
      PROSPECT_RESEARCH_PERMISSIONS.map((permission) => permission.code),
    );

    const [adminRoles] = await conn.query(
      `SELECT id FROM roles WHERE is_system = 1 OR name = 'Administrador'`,
    );
    await assignPermissionsToRoles(conn, adminRoles, permissionRows, now);

    const rolePlaceholders = COMMERCIAL_ROLE_NAMES.map(() => "?").join(", ");
    const [commercialRoles] = await conn.query(
      `SELECT id FROM roles WHERE LOWER(TRIM(name)) IN (${rolePlaceholders})`,
      COMMERCIAL_ROLE_NAMES,
    );
    const nonAdminPermissionRows = permissionRows.filter((permission) =>
      ["prospeccion.read", "prospeccion.create", "prospeccion.update"].includes(
        permission.code,
      ),
    );
    await assignPermissionsToRoles(conn, commercialRoles, nonAdminPermissionRows, now);
  });
}
