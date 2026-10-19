import { withTransaction } from "../db.js";

export async function ensureEvaluationAdministratorAccess() {
  await withTransaction(async (conn) => {
    const [migration] = await conn.query(`INSERT IGNORE INTO mi_coach_permission_migrations(migration_key,applied_at)
      VALUES ('customer_chat_evaluation_administrator_v1',NOW(3))`);
    if (!migration.affectedRows) return;
    await conn.query(`INSERT INTO role_permissions(role_id,permission_id,created_at)
      SELECT r.id,p.id,NOW(3) FROM roles r CROSS JOIN permissions p
      WHERE (r.is_system=1 OR r.name='Administrador')
        AND p.code IN ('mi_coach.evaluations_read','mi_coach.evaluations_execute')
        AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id=r.id AND rp.permission_id=p.id)`);
  });
}
