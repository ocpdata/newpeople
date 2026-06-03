import { withTransaction } from "./db.js";

const CORE_PERMISSIONS = [
  {
    code: "configuracion.read",
    module: "configuracion",
    action: "read",
    description: "Ver configuracion general",
  },
  {
    code: "configuracion.update",
    module: "configuracion",
    action: "update",
    description: "Actualizar configuracion general",
  },
  {
    code: "cuentas.request",
    module: "cuentas",
    action: "request",
    description: "Solicitar creacion de cuentas",
  },
  {
    code: "contactos.request",
    module: "contactos",
    action: "request",
    description: "Solicitar creacion de contactos",
  },
  {
    code: "oportunidades.request",
    module: "oportunidades",
    action: "request",
    description: "Solicitar creacion de oportunidades",
  },
  {
    code: "herramientas.read",
    module: "herramientas",
    action: "read",
    description: "Ver modulo de herramientas administrativas",
  },
  {
    code: "herramientas.update",
    module: "herramientas",
    action: "update",
    description: "Ejecutar acciones correctivas en herramientas administrativas",
  },
  {
    code: "herramientas.admin",
    module: "herramientas",
    action: "admin",
    description: "Administrar herramientas operativas de alto impacto",
  },
];

export async function ensureCorePermissions() {
  await withTransaction(async (conn) => {
    const now = new Date();

    for (const permission of CORE_PERMISSIONS) {
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

    const placeholders = CORE_PERMISSIONS.map(() => "?").join(", ");
    const [permissionRows] = await conn.query(
      `SELECT id
       FROM permissions
       WHERE code IN (${placeholders})`,
      CORE_PERMISSIONS.map((permission) => permission.code),
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