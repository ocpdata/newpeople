import { query } from "../db.js";
import {
  CHATBOT_ACCOUNT_READ_PERMISSIONS,
  CHATBOT_CONTACT_READ_PERMISSIONS,
  CHATBOT_OPPORTUNITY_READ_PERMISSIONS,
  buildAccountExpressionOwnershipJoin,
  buildAccountOwnershipJoin,
  buildTokenWhereClause,
  hasAnyPermission,
  normalizeSearchText,
  tokenizeSearchText,
} from "./common.js";

async function fetchAccountCandidates({ user, searchText, limit = 8 }) {
  if (!hasAnyPermission(user, CHATBOT_ACCOUNT_READ_PERMISSIONS)) {
    return [];
  }

  const tokens = tokenizeSearchText(searchText);
  if (!tokens.length) return [];

  const params = [];
  const ownershipJoin = buildAccountOwnershipJoin(user, params, "a");
  const whereClause = buildTokenWhereClause("a.name", tokens, params);
  const normalizedSearch = normalizeSearchText(searchText);
  params.push(normalizedSearch);
  params.push(`%${normalizedSearch}%`);
  params.push(Number(limit));

  const rows = await query(
    `SELECT DISTINCT a.id, a.name, a.city, a.state_region,
            c.name AS country_name,
            aas.code AS activation_status_code,
            aas.name AS activation_status
     FROM accounts a
     ${ownershipJoin}
     LEFT JOIN countries c ON c.id = a.country_id
     LEFT JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
     WHERE ${whereClause}
     ORDER BY
       CASE
         WHEN LOWER(a.name) = ? THEN 0
         WHEN LOWER(a.name) LIKE ? THEN 1
         ELSE 2
       END,
       a.name ASC,
       a.id ASC
     LIMIT ?`,
    params,
  );

  return rows.map((row) => ({
    id: Number(row.id),
    entityType: "account",
    displayName: row.name || "",
    secondaryText: [row.city, row.state_region, row.country_name]
      .filter(Boolean)
      .join(", "),
    metadata: {
      city: row.city || "",
      stateRegion: row.state_region || "",
      countryName: row.country_name || "",
      activationStatusCode: row.activation_status_code || "",
      activationStatus: row.activation_status || "",
    },
  }));
}

async function fetchContactCandidates({ user, searchText, limit = 8 }) {
  if (!hasAnyPermission(user, CHATBOT_CONTACT_READ_PERMISSIONS)) {
    return [];
  }

  const tokens = tokenizeSearchText(searchText);
  if (!tokens.length) return [];

  const params = [];
  const ownershipJoin = buildAccountExpressionOwnershipJoin({
    user,
    params,
    accountExpression: "c.account_id",
    bypassPermissions: ["contactos.read_all"],
  });
  const whereClause = buildTokenWhereClause(
    "CONCAT_WS(' ', c.first_name, c.last_name, c.email, a.name)",
    tokens,
    params,
  );
  params.push(Number(limit));

  const rows = await query(
    `SELECT DISTINCT c.id,
            c.first_name,
            c.last_name,
            c.email,
            c.account_id,
            a.name AS account_name,
            c.position_title,
            cas.code AS activation_status_code
     FROM contacts c
     ${ownershipJoin}
     INNER JOIN accounts a ON a.id = c.account_id
     LEFT JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
     WHERE ${whereClause}
     ORDER BY c.first_name ASC, c.last_name ASC, c.id ASC
     LIMIT ?`,
    params,
  );

  return rows.map((row) => ({
    id: Number(row.id),
    entityType: "contact",
    displayName: `${row.first_name || ""} ${row.last_name || ""}`.trim(),
    secondaryText: [row.account_name, row.email].filter(Boolean).join(" - "),
    metadata: {
      email: row.email || "",
      accountId: Number(row.account_id),
      accountName: row.account_name || "",
      positionTitle: row.position_title || "",
      activationStatusCode: row.activation_status_code || "",
    },
  }));
}

async function fetchOpportunityCandidates({ user, searchText, limit = 8 }) {
  if (!hasAnyPermission(user, CHATBOT_OPPORTUNITY_READ_PERMISSIONS)) {
    return [];
  }

  const tokens = tokenizeSearchText(searchText);
  if (!tokens.length) return [];

  const params = [];
  const ownershipJoin = buildAccountExpressionOwnershipJoin({
    user,
    params,
    accountExpression: "o.account_id",
    bypassPermissions: ["oportunidades.read_all"],
  });
  const whereClause = buildTokenWhereClause(
    "CONCAT_WS(' ', o.name, a.name)",
    tokens,
    params,
  );
  params.push(Number(limit));

  const rows = await query(
    `SELECT DISTINCT o.id,
            o.name,
            o.account_id,
            a.name AS account_name,
            o.amount_usd,
            o.close_date,
            oss.code AS sales_stage_code,
            oss.name AS sales_stage_name,
            ocs.code AS commercial_status_code
     FROM opportunities o
     ${ownershipJoin}
     INNER JOIN accounts a ON a.id = o.account_id
     INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
     INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     WHERE ${whereClause}
     ORDER BY o.updated_at DESC, o.id DESC
     LIMIT ?`,
    params,
  );

  return rows.map((row) => ({
    id: Number(row.id),
    entityType: "opportunity",
    displayName: row.name || "",
    secondaryText: [row.account_name, row.sales_stage_name]
      .filter(Boolean)
      .join(" - "),
    metadata: {
      accountId: Number(row.account_id),
      accountName: row.account_name || "",
      amountUsd:
        row.amount_usd === null || row.amount_usd === undefined
          ? null
          : Number(row.amount_usd),
      closeDate: row.close_date || null,
      salesStageCode: row.sales_stage_code || "",
      salesStageName: row.sales_stage_name || "",
      commercialStatusCode: row.commercial_status_code || "",
    },
  }));
}

export async function fetchCandidatesForPlan({
  user,
  plannerOutput,
  limit = 8,
}) {
  const targetEntityType = String(plannerOutput?.targetEntityType || "none");
  const searchText = String(plannerOutput?.targetEntityName || "").trim();
  if (!searchText || targetEntityType === "none") {
    return [];
  }

  if (targetEntityType === "account") {
    return fetchAccountCandidates({ user, searchText, limit });
  }
  if (targetEntityType === "contact") {
    return fetchContactCandidates({ user, searchText, limit });
  }
  if (targetEntityType === "opportunity") {
    return fetchOpportunityCandidates({ user, searchText, limit });
  }

  return [];
}
