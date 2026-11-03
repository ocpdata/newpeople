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

const COMMERCIAL_ENABLEMENT_PERMISSIONS = [
  {
    code: "enablement_comercial.use",
    module: "enablement_comercial",
    action: "use",
    description:
      "Consultar materiales activos, revisar su detalle y usarlos, por ejemplo, descargarlos, marcarlos como favoritos o generar enlaces compartibles cuando el material lo permite. No concede carga ni edicion.",
  },
  {
    code: "enablement_comercial.upload",
    module: "enablement_comercial",
    action: "upload",
    description:
      "Crear materiales y editar los propios, incluidos sus archivos o enlaces; permite activarlos y desactivarlos. No permite modificar o eliminar materiales ajenos ni administrar catalogos.",
  },
  {
    code: "enablement_comercial.manage",
    module: "enablement_comercial",
    action: "manage",
    description:
      "Editar, activar o desactivar materiales de cualquier usuario y eliminar materiales. No concede administracion de los catalogos de la biblioteca.",
  },
  {
    code: "enablement_comercial.admin",
    module: "enablement_comercial",
    action: "admin",
    description:
      "Crear, editar y eliminar valores de catalogos como tipos, fabricantes, tecnologias y soluciones. Tambien permite gestionar materiales de cualquier usuario, incluidos los restringidos.",
  },
  {
    code: "enablement_comercial.read",
    module: "enablement_comercial",
    action: "read",
    description:
      "Permiso heredado que conserva acceso de consulta a materiales activos. No permite cargarlos, editarlos ni administrar catalogos.",
  },
  {
    code: "enablement_comercial.update",
    module: "enablement_comercial",
    action: "update",
    description:
      "Permiso heredado que conserva las capacidades de carga y edicion de materiales propios, incluida su activacion o desactivacion; no permite administrar materiales ajenos ni catalogos.",
  },
  {
    code: "enablement_comercial.analytics",
    module: "enablement_comercial",
    action: "analytics",
    description:
      "Codigo heredado que actualmente conserva acceso de consulta a materiales activos. No habilita reportes o analitica de uso ni permite modificar materiales.",
  },
];

const MANAGER_PERMISSION_CODES = [
  "enablement_comercial.use",
  "enablement_comercial.upload",
  "enablement_comercial.manage",
  "enablement_comercial.read",
  "enablement_comercial.update",
  "enablement_comercial.analytics",
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

export async function ensureCommercialEnablementPermissions(options = {}) {
  const autoAssignRoles = Boolean(options.autoAssignRoles);
  await withTransaction(async (conn) => {
    const now = new Date();

    for (const permission of COMMERCIAL_ENABLEMENT_PERMISSIONS) {
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
      await conn.query(
        `UPDATE permissions
         SET description = ?, updated_at = ?
         WHERE code = ? AND IFNULL(description, '') <> ?`,
        [permission.description, now, permission.code, permission.description],
      );
    }

    const placeholders = COMMERCIAL_ENABLEMENT_PERMISSIONS.map(() => "?").join(
      ", ",
    );
    const [permissionRows] = await conn.query(
      `SELECT id, code
       FROM permissions
       WHERE code IN (${placeholders})`,
      COMMERCIAL_ENABLEMENT_PERMISSIONS.map((permission) => permission.code),
    );

    if (!autoAssignRoles) {
      return;
    }

    const [adminRoles] = await conn.query(
      `SELECT id
       FROM roles
       WHERE is_system = 1 OR name = 'Administrador'`,
    );
    if (adminRoles.length) {
      await assignPermissionsToRoles(conn, adminRoles, permissionRows, now);
    }

    const managerPlaceholders = COMMERCIAL_MANAGER_ROLE_NAMES.map(
      () => "?",
    ).join(", ");
    const [managerRoles] = await conn.query(
      `SELECT id
       FROM roles
       WHERE LOWER(TRIM(name)) IN (${managerPlaceholders})`,
      COMMERCIAL_MANAGER_ROLE_NAMES,
    );
    if (managerRoles.length) {
      const managerPermissionPlaceholders = MANAGER_PERMISSION_CODES.map(
        () => "?",
      ).join(", ");
      const [managerPermissionRows] = await conn.query(
        `SELECT id
         FROM permissions
         WHERE code IN (${managerPermissionPlaceholders})`,
        MANAGER_PERMISSION_CODES,
      );
      await assignPermissionsToRoles(
        conn,
        managerRoles,
        managerPermissionRows,
        now,
      );
    }
  });
}
