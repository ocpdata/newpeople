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

const POTENTIAL_OPPORTUNITY_PERMISSIONS = [
  {
    code: "oportunidades_potenciales.read",
    module: "oportunidades_potenciales",
    action: "read",
    description: "Ver oportunidades potenciales",
  },
  {
    code: "oportunidades_potenciales.read_all",
    module: "oportunidades_potenciales",
    action: "read_all",
    description: "Ver todas las oportunidades potenciales",
  },
  {
    code: "oportunidades_potenciales.review",
    module: "oportunidades_potenciales",
    action: "review",
    description: "Revisar y detectar oportunidades potenciales",
  },
  {
    code: "oportunidades_potenciales.assign",
    module: "oportunidades_potenciales",
    action: "assign",
    description: "Asignar responsables en oportunidades potenciales",
  },
  {
    code: "oportunidades_potenciales.convert",
    module: "oportunidades_potenciales",
    action: "convert",
    description: "Convertir oportunidades potenciales",
  },
  {
    code: "oportunidades_potenciales.analytics",
    module: "oportunidades_potenciales",
    action: "analytics",
    description: "Consultar analitica de oportunidades potenciales",
  },
];

const COMMERCIAL_MANAGER_PERMISSION_CODES = [
  "oportunidades_potenciales.read",
  "oportunidades_potenciales.read_all",
  "oportunidades_potenciales.review",
  "oportunidades_potenciales.assign",
  "oportunidades_potenciales.convert",
  "oportunidades_potenciales.analytics",
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

export async function ensurePotentialOpportunityPermissions() {
  await withTransaction(async (conn) => {
    const now = new Date();

    for (const permission of POTENTIAL_OPPORTUNITY_PERMISSIONS) {
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

    const [adminRoles] = await conn.query(
      `SELECT id
       FROM roles
       WHERE is_system = 1 OR name = 'Administrador'`,
    );

    if (!adminRoles.length) {
      return;
    }

    const placeholders = POTENTIAL_OPPORTUNITY_PERMISSIONS.map(() => "?").join(
      ", ",
    );
    const [permissionRows] = await conn.query(
      `SELECT id
       FROM permissions
       WHERE code IN (${placeholders})`,
      POTENTIAL_OPPORTUNITY_PERMISSIONS.map((permission) => permission.code),
    );

    await assignPermissionsToRoles(conn, adminRoles, permissionRows, now);

    const managerPlaceholders = COMMERCIAL_MANAGER_ROLE_NAMES.map(
      () => "?",
    ).join(", ");
    const [commercialManagerRoles] = await conn.query(
      `SELECT id
       FROM roles
       WHERE LOWER(TRIM(name)) IN (${managerPlaceholders})`,
      COMMERCIAL_MANAGER_ROLE_NAMES,
    );
    if (commercialManagerRoles.length) {
      const managerPermissionPlaceholders =
        COMMERCIAL_MANAGER_PERMISSION_CODES.map(() => "?").join(", ");
      const [commercialManagerPermissionRows] = await conn.query(
        `SELECT id
         FROM permissions
         WHERE code IN (${managerPermissionPlaceholders})`,
        COMMERCIAL_MANAGER_PERMISSION_CODES,
      );
      await assignPermissionsToRoles(
        conn,
        commercialManagerRoles,
        commercialManagerPermissionRows,
        now,
      );
    }
  });
}
