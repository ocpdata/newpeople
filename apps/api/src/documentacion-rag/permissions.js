import { withTransaction } from "../db.js";

export async function ensureDocumentacionRagPermissions({
  autoAssignAdministrators = true,
} = {}) {
  await withTransaction(async (conn) => {
    const now = new Date();
    const permissionDefinitions = [
      [
        "documentacion_rag.access",
        "access",
        "Acceder a la biblioteca de Documentacion RAG",
      ],
      [
        "documentacion_rag.manage",
        "manage",
        "Administrar temas y documentos de la biblioteca Documentacion RAG",
      ],
    ];
    for (const [code, action, description] of permissionDefinitions) {
      await conn.query(
        `INSERT INTO permissions (code, module, action, description, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = ?)`,
        [code, "documentacion_rag", action, description, now, now, code],
      );
    }

    if (!autoAssignAdministrators) return;

    const [roles] = await conn.query(
      "SELECT id FROM roles WHERE is_system = 1 OR name = 'Administrador'",
    );
    const [permissions] = await conn.query(
      "SELECT id FROM permissions WHERE code IN (?, ?)",
      ["documentacion_rag.access", "documentacion_rag.manage"],
    );
    if (!permissions.length) return;

    for (const role of roles) {
      for (const permission of permissions) {
        await conn.query(
          `INSERT INTO role_permissions (role_id, permission_id, created_at)
           SELECT ?, ?, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM role_permissions WHERE role_id = ? AND permission_id = ?
           )`,
          [
            Number(role.id),
            Number(permission.id),
            now,
            Number(role.id),
            Number(permission.id),
          ],
        );
      }
    }
  });
}
