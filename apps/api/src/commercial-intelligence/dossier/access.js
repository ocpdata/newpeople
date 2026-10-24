import { hasQuotationReadAccess } from "../../coach/quotation-read-service.js";

// Mirrors the read rules of buildAuthorizedCustomerSnapshot and the chat read tools.
export const has = (user, permission) => Boolean(user?.permissionSet?.has(permission));
export const canRead = (user, module) => has(user, `${module}.read`) || has(user, `${module}.read_all`);
export const canReadAll = (user, module) => has(user, `${module}.read_all`);

export function dossierError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export async function withReadOnlyConnection(pool, work) {
  const connection = await pool.getConnection();
  try {
    await connection.query("START TRANSACTION READ ONLY");
    return await work(async (sql, params) => (await connection.query(sql, params))[0]);
  } finally {
    await connection.rollback();
    connection.release();
  }
}

export function sectionPermissions(user) {
  const base = canRead(user, "cuentas") && canRead(user, "oportunidades");
  return {
    contacts: canRead(user, "contactos"),
    activities: canRead(user, "oportunidades") && canRead(user, "desarrollo_comercial"),
    calendarActivities: canRead(user, "calendario_comercial") && canRead(user, "oportunidades"),
    opportunityNotes: base,
    quotations: canRead(user, "oportunidades") && hasQuotationReadAccess(user),
    purchaseOrders: canRead(user, "oportunidades") && hasQuotationReadAccess(user),
    documents: base,
    interactions: canRead(user, "interacciones"),
    history: base,
  };
}

export function allowedCommercialStatuses(governance) {
  return ["en_proceso",
    ...(governance.includeWonOpportunities ? ["ganada"] : []),
    ...(governance.includeLostOpportunities ? ["perdida"] : []),
    ...(governance.includeCancelledOpportunities ? ["anulada"] : [])];
}

export function opportunityScopeSql(user, alias = "o") {
  if (canReadAll(user, "oportunidades")) return { sql: "", params: [] };
  return {
    sql: `AND (EXISTS (SELECT 1 FROM account_owners ao_scope WHERE ao_scope.account_id = ${alias}.account_id AND ao_scope.user_id = ?)
      OR ${alias}.created_by = ? OR ${alias}.seller_user_id = ?)`,
    params: [Number(user.id), Number(user.id), Number(user.id)],
  };
}

export async function authorizeAccount({ user, accountId, run }) {
  if (!canRead(user, "cuentas")) throw dossierError(403, "DOSSIER_PERMISSION_DENIED", "Sin permiso para consultar cuentas.");
  const scoped = !canReadAll(user, "cuentas");
  const rows = await run(
    `SELECT a.id, a.name FROM accounts a
     INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
     WHERE a.id = ? AND aas.code = 'activada'
       ${scoped ? "AND EXISTS (SELECT 1 FROM account_owners ao WHERE ao.account_id = a.id AND ao.user_id = ?)" : ""}
     LIMIT 1`,
    [Number(accountId), ...(scoped ? [Number(user.id)] : [])],
  );
  if (!rows.length) throw dossierError(404, "DOSSIER_ACCOUNT_UNAVAILABLE", "La cuenta no está disponible.");
  return { id: Number(rows[0].id), name: rows[0].name };
}
