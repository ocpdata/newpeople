import { query } from "./db.js";

export async function listKickoffInternalAttendees({ quotationId }) {
  const rows = await query(
    `SELECT u.id, u.full_name, u.email
     FROM users u
     WHERE COALESCE(u.status, 'active') = 'active'
       AND (
         NOT EXISTS (
           SELECT 1 FROM user_roles ur
           INNER JOIN roles r ON r.id = ur.role_id
           WHERE ur.user_id = u.id
             AND (LOWER(TRIM(r.name)) = 'vendedor' OR LOWER(TRIM(r.name)) LIKE 'vendedor %')
         )
         OR EXISTS (
           SELECT 1 FROM quotations q
           INNER JOIN opportunities o ON o.id = q.opportunity_id
           WHERE q.id = ? AND o.seller_user_id = u.id
         )
       )
     ORDER BY u.full_name ASC, u.id ASC`,
    [quotationId],
  );
  return rows.map((row) => ({
    id: Number(row.id), fullName: row.full_name || `Usuario #${row.id}`, email: row.email || "",
  }));
}

export async function validateKickoffInternalAttendees({ quotationId, userIds }) {
  const eligible = await listKickoffInternalAttendees({ quotationId });
  const eligibleIds = new Set(eligible.map((user) => user.id));
  const invalidUserIds = userIds.filter((id) => !eligibleIds.has(Number(id)));
  if (invalidUserIds.length) {
    throw Object.assign(new Error(
      "Hay convocados internos no disponibles. Solo se permite al vendedor asignado a la cotizacion y a los usuarios activos que no sean vendedores. Retira los convocados no disponibles antes de guardar o enviar.",
    ), { status: 400, invalidUserIds });
  }
}
