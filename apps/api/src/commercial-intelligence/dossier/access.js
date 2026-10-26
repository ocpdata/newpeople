import { hasQuotationReadAccess } from "../../coach/quotation-read-service.js";

// Mirrors the read rules of buildAuthorizedCustomerSnapshot and the chat read tools.
export const has = (user, permission) => Boolean(user?.permissionSet?.has(permission));
export const canRead = (user, module) => has(user, `${module}.read`) || has(user, `${module}.read_all`);
export const canReadAll = (user, module) => has(user, `${module}.read_all`);

export function dossierError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export const READ_QUERY_TIMEOUT_MS = 15000;
export const CONNECTION_ACQUIRE_TIMEOUT_MS = 10000;

function withTimeout(promise, ms, code, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(message), { code })), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// Each read has a time limit: a stalled remote connection fails one section instead of the whole turn.
export async function withReadOnlyConnection(pool, work, { queryTimeoutMs = READ_QUERY_TIMEOUT_MS,
  acquireTimeoutMs = CONNECTION_ACQUIRE_TIMEOUT_MS } = {}) {
  const acquiring = pool.getConnection();
  let connection;
  try {
    connection = await withTimeout(acquiring, acquireTimeoutMs, "DOSSIER_DB_ACQUIRE_TIMEOUT",
      "No se obtuvo una conexión a la base de datos a tiempo.");
  } catch (error) {
    acquiring.then((late) => late.release()).catch(() => {});
    throw error;
  }
  let broken = false;
  const run = async (sql, params) => {
    try {
      return (await connection.query({ sql, timeout: queryTimeoutMs }, params))[0];
    } catch (error) {
      if (["PROTOCOL_SEQUENCE_TIMEOUT", "PROTOCOL_CONNECTION_LOST", "ECONNRESET"].includes(error?.code)) broken = true;
      throw error;
    }
  };
  try {
    await run("START TRANSACTION READ ONLY");
    return await work(run);
  } finally {
    if (broken) {
      connection.destroy();
    } else {
      await connection.rollback().catch(() => { broken = true; });
      if (broken) connection.destroy(); else connection.release();
    }
  }
}

// Channel governance tools that must stay enabled for each dossier source.
export const SECTION_CHANNEL_TOOLS = Object.freeze({
  opportunities: "searchOpportunities",
  contacts: "searchContacts",
  activities: "getOpportunityActivities",
  pendingActivities: "getOpportunityActivities",
  accountActivities: "getOpportunityActivities",
  accountProfile: "searchAccounts",
  stakeholders: "getOpportunity",
  weaknesses: "getOpportunity",
  criterionAssessments: "getOpportunity",
  deliverables: "getOpportunity",
  recommendedStrategy: "getOpportunity",
  themeEntries: "getOpportunity",
  manufacturerRegistrations: "getOpportunity",
  proposals: "getOpportunityQuotation",
  proposalDocuments: "getOpportunityQuotation",
  accountInteractions: "searchInteractions",
  leads: "searchInteractions",
  campaignInteractions: "searchInteractions",
  accountCalendar: "getOpportunityActivities",
  calendarActivities: "getOpportunityActivities",
  opportunityNotes: "getOpportunityNotes",
  quotations: "getOpportunityQuotation",
  purchaseOrders: "getOpportunityQuotation",
  interactions: "searchInteractions",
});

export function enabledChannelTools(intentConfigurations) {
  if (!Array.isArray(intentConfigurations)) return null;
  return new Set(intentConfigurations
    .filter((intent) => intent?.enabled !== false)
    .flatMap((intent) => (Array.isArray(intent?.allowedTools) ? intent.allowedTools : [])));
}

export function channelAllows(governance, key) {
  const tools = governance?.channelTools;
  const tool = SECTION_CHANNEL_TOOLS[key];
  return !(tools instanceof Set) || !tool || tools.has(tool);
}

export function sectionPermissions(user, governance = null) {
  const base = canRead(user, "cuentas") && canRead(user, "oportunidades");
  const permissions = {
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
  permissions.pendingActivities = permissions.activities;
  permissions.accountActivities = permissions.activities;
  const workspace = canRead(user, "oportunidades") && canRead(user, "desarrollo_comercial");
  Object.assign(permissions, {
    accountProfile: canRead(user, "cuentas"),
    stakeholders: workspace, weaknesses: workspace, criterionAssessments: workspace, deliverables: workspace,
    recommendedStrategy: workspace, themeEntries: workspace,
    manufacturerRegistrations: canRead(user, "oportunidades") && canRead(user, "registros_fabricantes"),
    proposals: canRead(user, "oportunidades") && canRead(user, "propuestas"),
    proposalDocuments: canRead(user, "oportunidades") && canRead(user, "propuestas"),
    accountInteractions: canRead(user, "interacciones"),
    leads: canRead(user, "interacciones"),
    campaignInteractions: canRead(user, "campanas"),
    accountCalendar: canRead(user, "calendario_comercial"),
  });
  for (const key of Object.keys(permissions)) {
    permissions[key] = permissions[key] && channelAllows(governance, key);
  }
  return permissions;
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
