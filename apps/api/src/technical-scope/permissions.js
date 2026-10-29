import { withTransaction } from "../db.js";

export const TECHNICAL_SCOPE_UPDATE_PERMISSION =
  "propuestas.alcance_tecnico.update";
export const TECHNICAL_SCOPE_APPROVE_PERMISSION =
  "propuestas.alcance_tecnico.approve";
export const TECHNICAL_PLAYBOOKS_MANAGE_PERMISSION = "playbooks.manage";

const TECHNICAL_SCOPE_PERMISSIONS = [
  {
    code: TECHNICAL_SCOPE_UPDATE_PERMISSION,
    module: "propuestas",
    action: "alcance_tecnico_update",
    description:
      "Capturar el cuestionario tecnico, generar y editar el alcance tecnico y el SOW de una propuesta",
  },
  {
    code: TECHNICAL_SCOPE_APPROVE_PERMISSION,
    module: "propuestas",
    action: "alcance_tecnico_approve",
    description:
      "Aprobar el alcance tecnico y el SOW de una propuesta, incluidos los propios. Aplica ademas al preventa asignado a la oportunidad",
  },
  {
    code: TECHNICAL_PLAYBOOKS_MANAGE_PERMISSION,
    module: "playbooks",
    action: "manage",
    description:
      "Administrar playbooks tecnicos por solucion: preguntas, alcance, reglas y plantillas de topologia",
  },
];

const PRESALES_ROLE_NAMES = ["preventa", "ingeniero preventa"];

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

export async function ensureTechnicalScopePermissions(options = {}) {
  const autoAssignRoles = Boolean(options.autoAssignRoles);
  await withTransaction(async (conn) => {
    const now = new Date();
    for (const permission of TECHNICAL_SCOPE_PERMISSIONS) {
      await conn.query(
        `INSERT INTO permissions (code, module, action, description, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = ?)`,
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

    const placeholders = TECHNICAL_SCOPE_PERMISSIONS.map(() => "?").join(", ");
    const [permissionRows] = await conn.query(
      `SELECT id, code FROM permissions WHERE code IN (${placeholders})`,
      TECHNICAL_SCOPE_PERMISSIONS.map((permission) => permission.code),
    );

    const [adminRoles] = await conn.query(
      `SELECT id FROM roles WHERE is_system = 1 OR name = 'Administrador'`,
    );
    // Administrators always receive the permissions, also on databases that were already initialized.
    if (adminRoles.length) {
      await assignPermissionsToRoles(conn, adminRoles, permissionRows, now);
    }

    if (!autoAssignRoles) return;

    const presalesPlaceholders = PRESALES_ROLE_NAMES.map(() => "?").join(", ");
    const [presalesRoles] = await conn.query(
      `SELECT id FROM roles WHERE LOWER(TRIM(name)) IN (${presalesPlaceholders})`,
      PRESALES_ROLE_NAMES,
    );
    const presalesPermissions = permissionRows.filter(
      (permission) => permission.code !== TECHNICAL_PLAYBOOKS_MANAGE_PERMISSION,
    );
    if (presalesRoles.length && presalesPermissions.length) {
      await assignPermissionsToRoles(
        conn,
        presalesRoles,
        presalesPermissions,
        now,
      );
    }
  });
}
