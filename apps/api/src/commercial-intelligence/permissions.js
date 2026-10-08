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

const COMMERCIAL_INTELLIGENCE_PERMISSIONS = [
  {
    code: "inteligencia_comercial.read",
    module: "inteligencia_comercial",
    action: "read",
    description: "Ver inteligencia comercial y hallazgos de clientes",
  },
  {
    code: "inteligencia_comercial.update",
    module: "inteligencia_comercial",
    action: "update",
    description:
      "Confirmar, rechazar y mantener hallazgos de inteligencia comercial",
  },
  {
    code: "inteligencia_comercial.admin",
    module: "inteligencia_comercial",
    action: "admin",
    description:
      "Administrar configuracion y gobierno de inteligencia comercial",
  },
  {
    code: "inteligencia_comercial.chat_diagnostics",
    module: "inteligencia_comercial",
    action: "chat_diagnostics",
    description: "Consultar sesiones y diagnosticos de chat de otros usuarios",
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

export async function ensureCommercialIntelligencePermissions(options = {}) {
  const autoAssignRoles = Boolean(options.autoAssignRoles);
  await withTransaction(async (conn) => {
    const now = new Date();

    await conn.query(`DELETE FROM permissions WHERE code = ?`, [
      "inteligencia_comercial.chat_diagnostics.read",
    ]);

    for (const permission of COMMERCIAL_INTELLIGENCE_PERMISSIONS) {
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

    const placeholders = COMMERCIAL_INTELLIGENCE_PERMISSIONS.map(
      () => "?",
    ).join(", ");
    const [permissionRows] = await conn.query(
      `SELECT id, code FROM permissions WHERE code IN (${placeholders})`,
      COMMERCIAL_INTELLIGENCE_PERMISSIONS.map((permission) => permission.code),
    );

    const [adminRoles] = await conn.query(
      `SELECT id FROM roles WHERE is_system = 1 OR name = 'Administrador'`,
    );
    await assignPermissionsToRoles(conn, adminRoles, permissionRows, now);

    const managerPlaceholders = COMMERCIAL_MANAGER_ROLE_NAMES.map(
      () => "?",
    ).join(", ");
    const [managerRoles] = await conn.query(
      `SELECT id FROM roles WHERE LOWER(TRIM(name)) IN (${managerPlaceholders})`,
      COMMERCIAL_MANAGER_ROLE_NAMES,
    );
    await assignPermissionsToRoles(
      conn,
      managerRoles,
      permissionRows.filter(
        (permission) =>
          permission.code !== "inteligencia_comercial.chat_diagnostics",
      ),
      now,
    );

    const [miCoachRoles] = await conn.query(
      `SELECT DISTINCT rp.role_id AS id
       FROM role_permissions rp
       INNER JOIN permissions p ON p.id = rp.permission_id
       WHERE p.code = 'mi_coach.use'`,
    );
    const readPermissionRows = permissionRows.filter((permission) =>
      ["inteligencia_comercial.read"].includes(permission.code),
    );
    await assignPermissionsToRoles(conn, miCoachRoles, readPermissionRows, now);
  });
}
