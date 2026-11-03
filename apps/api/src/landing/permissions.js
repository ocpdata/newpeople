import { withTransaction } from "../db.js";

const LANDING_PERMISSIONS = [
  {
    code: "landing.read",
    module: "landing",
    action: "read_pages",
    description:
      "Consultar el listado y el detalle de las paginas de captacion y sus versiones",
  },
  {
    code: "landing.create",
    module: "landing",
    action: "create",
    description:
      "Crear paginas de captacion asociadas a eventos y preparar sus formularios",
  },
  {
    code: "landing.update",
    module: "landing",
    action: "update",
    description:
      "Modificar contenido, versiones, formularios y configuracion de paginas de captacion; importar contenido y eliminar paginas",
  },
  {
    code: "landing.publish",
    module: "landing",
    action: "publish",
    description:
      "Publicar una version validada de una pagina de captacion para que este disponible publicamente",
  },
  {
    code: "landing.submissions.read",
    module: "landing",
    action: "read_submissions",
    description:
      "Consultar los registros recibidos por los formularios y su estado de procesamiento",
  },
  {
    code: "landing.submissions.reprocess",
    module: "landing",
    action: "reprocess_submissions",
    description:
      "Asignar vendedor, guardar notas internas, reprocesar envios hacia el CRM o eliminarlos",
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
      await conn.query(
        `UPDATE permissions
         SET description = ?, updated_at = ?
         WHERE code = ? AND IFNULL(description, '') <> ?`,
        [permission.description, now, permission.code, permission.description],
      );
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
