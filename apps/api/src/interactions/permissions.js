import { withTransaction } from "../db.js";

const INTERACTION_PERMISSIONS = [
  {
    code: "interacciones.read",
    module: "interacciones",
    action: "read",
    description: "Ver interacciones",
  },
  {
    code: "interacciones.read_all",
    module: "interacciones",
    action: "read_all",
    description: "Ver todas las interacciones",
  },
  {
    code: "interacciones.create",
    module: "interacciones",
    action: "create",
    description: "Crear interacciones",
  },
  {
    code: "interacciones.update",
    module: "interacciones",
    action: "update",
    description: "Actualizar interacciones",
  },
  {
    code: "interacciones.analyze",
    module: "interacciones",
    action: "analyze",
    description: "Analizar interacciones",
  },
  {
    code: "interacciones.resolve",
    module: "interacciones",
    action: "resolve",
    description: "Resolver interacciones",
  },
  {
    code: "interacciones.resolve.assign_self",
    module: "interacciones",
    action: "resolve_assign_self",
    description: "Resolver interacciones asignando solo al usuario actual",
  },
  {
    code: "interacciones.resolve.assign_any",
    module: "interacciones",
    action: "resolve_assign_any",
    description: "Resolver interacciones asignando cualquier vendedor",
  },
];

export async function ensureInteractionPermissions() {
  await withTransaction(async (conn) => {
    const now = new Date();

    for (const permission of INTERACTION_PERMISSIONS) {
      await conn.query(
        `INSERT INTO permissions (code, module, action, description, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1
           FROM permissions
           WHERE code = ?
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

    const placeholders = INTERACTION_PERMISSIONS.map(() => "?").join(", ");
    const [permissionRows] = await conn.query(
      `SELECT id
       FROM permissions
       WHERE code IN (${placeholders})`,
      INTERACTION_PERMISSIONS.map((permission) => permission.code),
    );

    for (const role of adminRoles) {
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
  });
}
