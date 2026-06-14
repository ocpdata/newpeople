import { query } from "../db.js";
import { getOpportunityRecommendedStrategy } from "./opportunity-strategy.js";
import { searchInternalAppKnowledge } from "./app-knowledge.js";
import { searchMarkdownKnowledge } from "./knowledge-base.js";
import {
  CHATBOT_ACCOUNT_READ_PERMISSIONS,
  CHATBOT_CONTACT_READ_PERMISSIONS,
  CHATBOT_MAX_EVIDENCE_ITEMS,
  CHATBOT_OPPORTUNITY_READ_PERMISSIONS,
  CHATBOT_PROPOSAL_READ_PERMISSIONS,
  CHATBOT_QUOTATION_READ_PERMISSIONS,
  buildAccountExpressionOwnershipJoin,
  buildAccountOwnershipJoin,
  hasAnyPermission,
} from "./common.js";

function pushFilterCodeParams(params, values) {
  for (const value of values || []) {
    params.push(value);
  }
}

function buildAccountsEvidenceWhereClauses({ filters }) {
  const clauses = [];
  if (
    filters?.accounts?.activeOnly &&
    !filters?.accounts?.activationStatusCodes?.length
  ) {
    clauses.push("aas.code = 'activada'");
  }
  if (filters?.accounts?.activationStatusCodes?.length) {
    clauses.push(
      `aas.code IN (${filters.accounts.activationStatusCodes.map(() => "?").join(", ")})`,
    );
  }
  return clauses;
}

function buildContactsEvidenceWhereClauses({ filters }) {
  const clauses = [];
  if (
    filters?.contacts?.activeOnly &&
    !filters?.contacts?.activationStatusCodes?.length
  ) {
    clauses.push("cas.code = 'activado'");
  }
  if (filters?.contacts?.activationStatusCodes?.length) {
    clauses.push(
      `cas.code IN (${filters.contacts.activationStatusCodes.map(() => "?").join(", ")})`,
    );
  }
  return clauses;
}

function buildOpportunityEvidenceWhereClauses({ filters }) {
  const clauses = [];
  if (
    filters?.opportunities?.activeOnly &&
    !filters?.opportunities?.activationStatusCodes?.length
  ) {
    clauses.push("oas.code = 'activada'");
  }
  if (filters?.opportunities?.openOnly) {
    clauses.push("ocs.code NOT IN ('ganada', 'perdida', 'anulada')");
  }
  if (filters?.opportunities?.activationStatusCodes?.length) {
    clauses.push(
      `oas.code IN (${filters.opportunities.activationStatusCodes.map(() => "?").join(", ")})`,
    );
  }
  if (filters?.opportunities?.commercialStatusCodes?.length) {
    clauses.push(
      `ocs.code IN (${filters.opportunities.commercialStatusCodes.map(() => "?").join(", ")})`,
    );
  }
  if (filters?.opportunities?.salesStageCodes?.length) {
    clauses.push(
      `oss.code IN (${filters.opportunities.salesStageCodes.map(() => "?").join(", ")})`,
    );
  }
  return clauses;
}

function buildQuotationsEvidenceWhereClauses({ filters }) {
  const clauses = [];
  if (
    filters?.quotations?.activeOnly &&
    !filters?.quotations?.activationStatusCodes?.length
  ) {
    clauses.push("qas.code = 'activo'");
  }
  if (filters?.quotations?.activationStatusCodes?.length) {
    clauses.push(
      `qas.code IN (${filters.quotations.activationStatusCodes.map(() => "?").join(", ")})`,
    );
  }
  if (filters?.quotations?.latestStatusCodes?.length) {
    clauses.push(
      `qs.code IN (${filters.quotations.latestStatusCodes.map(() => "?").join(", ")})`,
    );
  }
  return clauses;
}

function buildProposalsEvidenceWhereClauses({ filters }) {
  const clauses = [];
  if (filters?.proposals?.statusCodes?.length) {
    clauses.push(
      `p.status_code IN (${filters.proposals.statusCodes.map(() => "?").join(", ")})`,
    );
  }
  if (filters?.proposals?.quotationVersionStatusCodes?.length) {
    clauses.push(
      `qvs.code IN (${filters.proposals.quotationVersionStatusCodes.map(() => "?").join(", ")})`,
    );
  }
  return clauses;
}

function pushAccountFilterParams(params, filters) {
  pushFilterCodeParams(params, filters?.accounts?.activationStatusCodes);
}

function pushContactFilterParams(params, filters) {
  pushFilterCodeParams(params, filters?.contacts?.activationStatusCodes);
}

function pushOpportunityFilterParams(params, filters) {
  pushFilterCodeParams(params, filters?.opportunities?.activationStatusCodes);
  pushFilterCodeParams(params, filters?.opportunities?.commercialStatusCodes);
  pushFilterCodeParams(params, filters?.opportunities?.salesStageCodes);
}

function pushQuotationFilterParams(params, filters) {
  pushFilterCodeParams(params, filters?.quotations?.activationStatusCodes);
  pushFilterCodeParams(params, filters?.quotations?.latestStatusCodes);
}

function pushProposalFilterParams(params, filters) {
  pushFilterCodeParams(params, filters?.proposals?.statusCodes);
  pushFilterCodeParams(params, filters?.proposals?.quotationVersionStatusCodes);
}

export async function fetchAccountBundle({
  user,
  accountId,
  requestedDomains,
  filters,
}) {
  const accountParams = [];
  const accountOwnershipJoin = buildAccountOwnershipJoin(
    user,
    accountParams,
    "a",
  );
  accountParams.push(Number(accountId));
  const accountWhereClauses = ["a.id = ?"];
  accountWhereClauses.push(...buildAccountsEvidenceWhereClauses({ filters }));
  pushAccountFilterParams(accountParams, filters);

  const accountRows = await query(
    `SELECT a.id, a.name, a.registration_code, a.phone, a.website,
            a.city, a.state_region, a.address_line,
            aas.code AS activation_status_code,
            c.name AS country_name,
            aas.name AS activation_status,
            atp.name AS account_type,
            es.name AS economic_sector
     FROM accounts a
     ${accountOwnershipJoin}
     LEFT JOIN countries c ON c.id = a.country_id
     LEFT JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
     LEFT JOIN account_types atp ON atp.id = a.account_type_id
     LEFT JOIN economic_sectors es ON es.id = a.economic_sector_id
     WHERE ${accountWhereClauses.join(" AND ")}
     LIMIT 1`,
    accountParams,
  );

  if (!accountRows.length) return null;

  const account = accountRows[0];
  const evidence = {
    anchorType: "account",
    anchorId: Number(account.id),
    anchorName: account.name || "",
    account: {
      id: Number(account.id),
      name: account.name || "",
      registrationCode: account.registration_code || "",
      phone: account.phone || "",
      website: account.website || "",
      city: account.city || "",
      stateRegion: account.state_region || "",
      addressLine: account.address_line || "",
      countryName: account.country_name || "",
      activationStatusCode: account.activation_status_code || "",
      activationStatus: account.activation_status || "",
      accountType: account.account_type || "",
      economicSector: account.economic_sector || "",
    },
    contacts: [],
    opportunities: [],
    quotations: [],
    proposals: [],
  };

  if (requestedDomains.includes("contacts")) {
    const contactParams = [];
    const contactOwnershipJoin = buildAccountExpressionOwnershipJoin({
      user,
      params: contactParams,
      accountExpression: "c.account_id",
      bypassPermissions: ["contactos.read_all"],
    });
    contactParams.push(Number(accountId));
    const contactWhereClauses = ["c.account_id = ?"];
    contactWhereClauses.push(...buildContactsEvidenceWhereClauses({ filters }));
    pushContactFilterParams(contactParams, filters);
    contactParams.push(CHATBOT_MAX_EVIDENCE_ITEMS);
    const rows = await query(
      `SELECT c.id, c.first_name, c.last_name, c.position_title, c.phone,
              c.mobile, c.email, c.department,
              cas.code AS activation_status_code,
              cas.name AS activation_status
       FROM contacts c
       ${contactOwnershipJoin}
       LEFT JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
       WHERE ${contactWhereClauses.join(" AND ")}
       ORDER BY c.updated_at DESC, c.id DESC
       LIMIT ?`,
      contactParams,
    );
    evidence.contacts = rows.map((row) => ({
      id: Number(row.id),
      fullName: `${row.first_name || ""} ${row.last_name || ""}`.trim(),
      positionTitle: row.position_title || "",
      phone: row.phone || "",
      mobile: row.mobile || "",
      email: row.email || "",
      department: row.department || "",
      activationStatusCode: row.activation_status_code || "",
      activationStatus: row.activation_status || "",
    }));
  }

  if (requestedDomains.includes("opportunities")) {
    const opportunityParams = [];
    const opportunityOwnershipJoin = buildAccountExpressionOwnershipJoin({
      user,
      params: opportunityParams,
      accountExpression: "o.account_id",
      bypassPermissions: ["oportunidades.read_all"],
    });
    opportunityParams.push(Number(accountId));
    const opportunityWhereClauses = ["o.account_id = ?"];
    opportunityWhereClauses.push(
      ...buildOpportunityEvidenceWhereClauses({ filters }),
    );
    pushOpportunityFilterParams(opportunityParams, filters);
    opportunityParams.push(CHATBOT_MAX_EVIDENCE_ITEMS);
    const rows = await query(
      `SELECT o.id, o.name, o.amount_usd, o.close_date,
              CONCAT(c.first_name, ' ', c.last_name) AS contact_name,
              oss.code AS sales_stage_code,
              oss.name AS sales_stage_name,
              ocs.code AS commercial_status_code,
              ocs.name AS commercial_status_name,
              obl.name AS business_line_name,
              oas.code AS activation_status_code,
              oas.name AS activation_status_name
       FROM opportunities o
       ${opportunityOwnershipJoin}
       INNER JOIN contacts c ON c.id = o.contact_id
       INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
       INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
       INNER JOIN opportunity_business_lines obl ON obl.id = o.business_line_id
       INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
       WHERE ${opportunityWhereClauses.join(" AND ")}
       ORDER BY o.updated_at DESC, o.id DESC
       LIMIT ?`,
      opportunityParams,
    );
    evidence.opportunities = rows.map((row) => ({
      id: Number(row.id),
      name: row.name || "",
      amountUsd:
        row.amount_usd === null || row.amount_usd === undefined
          ? null
          : Number(row.amount_usd),
      closeDate: row.close_date || null,
      contactName: row.contact_name || "",
      salesStageCode: row.sales_stage_code || "",
      salesStageName: row.sales_stage_name || "",
      commercialStatusCode: row.commercial_status_code || "",
      commercialStatusName: row.commercial_status_name || "",
      businessLineName: row.business_line_name || "",
      activationStatusCode: row.activation_status_code || "",
      activationStatusName: row.activation_status_name || "",
    }));
  }

  if (requestedDomains.includes("quotations")) {
    const quotationParams = [];
    const quotationOwnershipJoin = buildAccountExpressionOwnershipJoin({
      user,
      params: quotationParams,
      accountExpression: "o.account_id",
      bypassPermissions: ["cotizaciones.administracion"],
    });
    quotationParams.push(Number(accountId));
    const quotationWhereClauses = ["o.account_id = ?"];
    quotationWhereClauses.push(
      ...buildQuotationsEvidenceWhereClauses({ filters }),
    );
    pushQuotationFilterParams(quotationParams, filters);
    quotationParams.push(CHATBOT_MAX_EVIDENCE_ITEMS);
    const rows = await query(
      `SELECT q.id, q.opportunity_id, q.latest_version_id,
              o.name AS opportunity_name,
              lv.version_number AS latest_version_number,
              qs.code AS latest_status_code,
              qs.name AS latest_status_name,
              lv.proposal_name AS latest_proposal_name,
              lv.quotation_date AS latest_quotation_date,
              qas.code AS activation_status_code,
              qas.name AS activation_status_name,
              q.created_at, q.updated_at
       FROM quotations q
       INNER JOIN opportunities o ON o.id = q.opportunity_id
       ${quotationOwnershipJoin}
       LEFT JOIN quotation_versions lv ON lv.id = q.latest_version_id
       LEFT JOIN quotation_statuses qs ON qs.id = lv.status_id
       INNER JOIN quotation_activation_statuses qas ON qas.id = q.activation_status_id
       WHERE ${quotationWhereClauses.join(" AND ")}
       ORDER BY q.updated_at DESC, q.id DESC
       LIMIT ?`,
      quotationParams,
    );
    evidence.quotations = rows.map((row) => ({
      id: Number(row.id),
      opportunityId: Number(row.opportunity_id),
      opportunityName: row.opportunity_name || "",
      latestVersionId: row.latest_version_id
        ? Number(row.latest_version_id)
        : null,
      latestVersionNumber: row.latest_version_number
        ? Number(row.latest_version_number)
        : null,
      latestStatusCode: row.latest_status_code || "",
      latestStatusName: row.latest_status_name || "",
      latestProposalName: row.latest_proposal_name || "",
      latestQuotationDate: row.latest_quotation_date || null,
      activationStatusCode: row.activation_status_code || "",
      activationStatusName: row.activation_status_name || "",
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
    }));
  }

  if (requestedDomains.includes("proposals")) {
    const proposalParams = [];
    const proposalOwnershipJoin = buildAccountExpressionOwnershipJoin({
      user,
      params: proposalParams,
      accountExpression: "o.account_id",
      bypassPermissions: ["cotizaciones.administracion"],
    });
    proposalParams.push(Number(accountId));
    const proposalWhereClauses = ["p.account_id = ?"];
    proposalWhereClauses.push(
      ...buildProposalsEvidenceWhereClauses({ filters }),
    );
    pushProposalFilterParams(proposalParams, filters);
    proposalParams.push(CHATBOT_MAX_EVIDENCE_ITEMS);
    const rows = await query(
      `SELECT p.id, p.title, p.status_code, p.quotation_id,
              p.quotation_version_id, p.opportunity_id,
              o.name AS opportunity_name,
              qv.version_number AS quotation_version_number,
              qvs.code AS quotation_version_status_code,
              qvs.name AS quotation_version_status_name,
              qv.proposal_name AS quotation_proposal_name,
              p.updated_at
       FROM proposals p
       INNER JOIN quotations q ON q.id = p.quotation_id
       INNER JOIN quotation_versions qv ON qv.id = p.quotation_version_id
       LEFT JOIN quotation_statuses qvs ON qvs.id = qv.status_id
       INNER JOIN opportunities o ON o.id = p.opportunity_id
       ${proposalOwnershipJoin}
       WHERE ${proposalWhereClauses.join(" AND ")}
       ORDER BY p.updated_at DESC, p.id DESC
       LIMIT ?`,
      proposalParams,
    );
    evidence.proposals = rows.map((row) => ({
      id: Number(row.id),
      title: row.title || "",
      statusCode: row.status_code || "",
      quotationId: Number(row.quotation_id),
      quotationVersionId: Number(row.quotation_version_id),
      quotationVersionNumber: row.quotation_version_number
        ? Number(row.quotation_version_number)
        : null,
      quotationVersionStatusCode: row.quotation_version_status_code || "",
      quotationVersionStatusName: row.quotation_version_status_name || "",
      quotationProposalName: row.quotation_proposal_name || "",
      opportunityId: Number(row.opportunity_id),
      opportunityName: row.opportunity_name || "",
      updatedAt: row.updated_at || null,
    }));
  }

  return evidence;
}

export async function fetchContactBundle({
  user,
  contactId,
  requestedDomains,
  filters,
}) {
  const params = [];
  const ownershipJoin = buildAccountExpressionOwnershipJoin({
    user,
    params,
    accountExpression: "c.account_id",
    bypassPermissions: ["contactos.read_all"],
  });
  params.push(Number(contactId));
  const contactWhereClauses = ["c.id = ?"];
  contactWhereClauses.push(...buildContactsEvidenceWhereClauses({ filters }));
  pushContactFilterParams(params, filters);
  const rows = await query(
    `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.mobile,
            c.position_title, c.department, c.account_id,
            a.name AS account_name,
            cas.code AS activation_status_code,
            cas.name AS activation_status
     FROM contacts c
     ${ownershipJoin}
     INNER JOIN accounts a ON a.id = c.account_id
     LEFT JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
     WHERE ${contactWhereClauses.join(" AND ")}
     LIMIT 1`,
    params,
  );

  if (!rows.length) return null;

  const row = rows[0];
  const accountBundle = await fetchAccountBundle({
    user,
    accountId: Number(row.account_id),
    requestedDomains,
    filters,
  });
  if (!accountBundle) return null;

  return {
    ...accountBundle,
    anchorType: "contact",
    anchorId: Number(row.id),
    anchorName: `${row.first_name || ""} ${row.last_name || ""}`.trim(),
    contact: {
      id: Number(row.id),
      fullName: `${row.first_name || ""} ${row.last_name || ""}`.trim(),
      email: row.email || "",
      phone: row.phone || "",
      mobile: row.mobile || "",
      positionTitle: row.position_title || "",
      department: row.department || "",
      activationStatusCode: row.activation_status_code || "",
      activationStatus: row.activation_status || "",
      accountId: Number(row.account_id),
      accountName: row.account_name || "",
    },
  };
}

export async function fetchOpportunityBundle({
  user,
  opportunityId,
  requestedDomains,
  filters,
}) {
  const params = [];
  const ownershipJoin = buildAccountExpressionOwnershipJoin({
    user,
    params,
    accountExpression: "o.account_id",
    bypassPermissions: ["oportunidades.read_all"],
  });
  params.push(Number(opportunityId));
  const opportunityWhereClauses = ["o.id = ?"];
  opportunityWhereClauses.push(
    ...buildOpportunityEvidenceWhereClauses({ filters }),
  );
  pushOpportunityFilterParams(params, filters);
  const rows = await query(
    `SELECT o.id, o.name, o.account_id, a.name AS account_name,
            o.amount_usd, o.close_date,
            CONCAT(c.first_name, ' ', c.last_name) AS contact_name,
            oss.code AS sales_stage_code,
            oss.name AS sales_stage_name,
            ocs.code AS commercial_status_code,
            ocs.name AS commercial_status_name,
            oas.code AS activation_status_code,
            oas.name AS activation_status_name
     FROM opportunities o
     ${ownershipJoin}
     INNER JOIN accounts a ON a.id = o.account_id
     INNER JOIN contacts c ON c.id = o.contact_id
     INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
     INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
     WHERE ${opportunityWhereClauses.join(" AND ")}
     LIMIT 1`,
    params,
  );

  if (!rows.length) return null;

  const row = rows[0];
  const accountBundle = await fetchAccountBundle({
    user,
    accountId: Number(row.account_id),
    requestedDomains,
    filters,
  });
  if (!accountBundle) return null;

  const recommendedStrategy = await getOpportunityRecommendedStrategy(
    Number(row.id),
  );

  return {
    ...accountBundle,
    anchorType: "opportunity",
    anchorId: Number(row.id),
    anchorName: row.name || "",
    recommendedStrategy,
    opportunity: {
      id: Number(row.id),
      name: row.name || "",
      accountId: Number(row.account_id),
      accountName: row.account_name || "",
      amountUsd:
        row.amount_usd === null || row.amount_usd === undefined
          ? null
          : Number(row.amount_usd),
      closeDate: row.close_date || null,
      contactName: row.contact_name || "",
      salesStageCode: row.sales_stage_code || "",
      salesStageName: row.sales_stage_name || "",
      commercialStatusCode: row.commercial_status_code || "",
      commercialStatusName: row.commercial_status_name || "",
      activationStatusCode: row.activation_status_code || "",
      activationStatusName: row.activation_status_name || "",
    },
  };
}

export async function fetchRecentDomainRecords(
  user,
  requestedDomains,
  filters,
) {
  const evidence = {
    anchorType: "recent",
    account: null,
    contacts: [],
    opportunities: [],
    quotations: [],
    proposals: [],
  };

  if (
    requestedDomains.includes("accounts") &&
    hasAnyPermission(user, CHATBOT_ACCOUNT_READ_PERMISSIONS)
  ) {
    const params = [];
    const ownershipJoin = buildAccountOwnershipJoin(user, params, "a");
    const whereClauses = buildAccountsEvidenceWhereClauses({ filters });
    pushAccountFilterParams(params, filters);
    params.push(CHATBOT_MAX_EVIDENCE_ITEMS);
    const rows = await query(
      `SELECT a.id, a.name, a.city, a.state_region,
              aas.code AS activation_status_code,
              aas.name AS activation_status
       FROM accounts a
       ${ownershipJoin}
       LEFT JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
       ${whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : ""}
       ORDER BY a.updated_at DESC, a.id DESC
       LIMIT ?`,
      params,
    );
    evidence.accounts = rows.map((row) => ({
      id: Number(row.id),
      name: row.name || "",
      city: row.city || "",
      stateRegion: row.state_region || "",
      activationStatusCode: row.activation_status_code || "",
      activationStatus: row.activation_status || "",
    }));
  }

  if (
    requestedDomains.includes("contacts") &&
    hasAnyPermission(user, CHATBOT_CONTACT_READ_PERMISSIONS)
  ) {
    const params = [];
    const ownershipJoin = buildAccountExpressionOwnershipJoin({
      user,
      params,
      accountExpression: "c.account_id",
      bypassPermissions: ["contactos.read_all"],
    });
    const whereClauses = buildContactsEvidenceWhereClauses({ filters });
    pushContactFilterParams(params, filters);
    params.push(CHATBOT_MAX_EVIDENCE_ITEMS);
    const rows = await query(
      `SELECT c.id, c.first_name, c.last_name, c.email,
              a.name AS account_name, c.position_title,
              cas.code AS activation_status_code,
              cas.name AS activation_status
       FROM contacts c
       ${ownershipJoin}
       INNER JOIN accounts a ON a.id = c.account_id
       LEFT JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
       ${whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : ""}
       ORDER BY c.updated_at DESC, c.id DESC
       LIMIT ?`,
      params,
    );
    evidence.contacts = rows.map((row) => ({
      id: Number(row.id),
      fullName: `${row.first_name || ""} ${row.last_name || ""}`.trim(),
      email: row.email || "",
      accountName: row.account_name || "",
      positionTitle: row.position_title || "",
      activationStatusCode: row.activation_status_code || "",
      activationStatus: row.activation_status || "",
    }));
  }

  if (
    requestedDomains.includes("opportunities") &&
    hasAnyPermission(user, CHATBOT_OPPORTUNITY_READ_PERMISSIONS)
  ) {
    const params = [];
    const ownershipJoin = buildAccountExpressionOwnershipJoin({
      user,
      params,
      accountExpression: "o.account_id",
      bypassPermissions: ["oportunidades.read_all"],
    });
    const whereClauses = buildOpportunityEvidenceWhereClauses({ filters });
    pushOpportunityFilterParams(params, filters);
    params.push(CHATBOT_MAX_EVIDENCE_ITEMS);
    const rows = await query(
      `SELECT o.id, o.name, o.amount_usd, o.close_date,
              a.name AS account_name,
              ocs.code AS commercial_status_code,
              ocs.name AS commercial_status_name,
              oas.code AS activation_status_code,
              oss.code AS sales_stage_code,
              oss.name AS sales_stage_name
       FROM opportunities o
       ${ownershipJoin}
       INNER JOIN accounts a ON a.id = o.account_id
       INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
       INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
       INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
       ${whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : ""}
       ORDER BY o.updated_at DESC, o.id DESC
       LIMIT ?`,
      params,
    );
    evidence.opportunities = rows.map((row) => ({
      id: Number(row.id),
      name: row.name || "",
      amountUsd:
        row.amount_usd === null || row.amount_usd === undefined
          ? null
          : Number(row.amount_usd),
      closeDate: row.close_date || null,
      accountName: row.account_name || "",
      commercialStatusCode: row.commercial_status_code || "",
      commercialStatusName: row.commercial_status_name || "",
      activationStatusCode: row.activation_status_code || "",
      salesStageCode: row.sales_stage_code || "",
      salesStageName: row.sales_stage_name || "",
    }));
  }

  if (
    requestedDomains.includes("quotations") &&
    hasAnyPermission(user, CHATBOT_QUOTATION_READ_PERMISSIONS)
  ) {
    const params = [];
    const ownershipJoin = buildAccountExpressionOwnershipJoin({
      user,
      params,
      accountExpression: "o.account_id",
      bypassPermissions: ["cotizaciones.administracion"],
    });
    const whereClauses = buildQuotationsEvidenceWhereClauses({ filters });
    pushQuotationFilterParams(params, filters);
    params.push(CHATBOT_MAX_EVIDENCE_ITEMS);
    const rows = await query(
      `SELECT q.id, o.name AS opportunity_name, a.name AS account_name,
              qas.code AS activation_status_code,
              lv.version_number AS latest_version_number,
              qs.code AS latest_status_code,
              qs.name AS latest_status_name,
              lv.proposal_name AS latest_proposal_name,
              q.updated_at
       FROM quotations q
       INNER JOIN opportunities o ON o.id = q.opportunity_id
       INNER JOIN accounts a ON a.id = o.account_id
       ${ownershipJoin}
       LEFT JOIN quotation_versions lv ON lv.id = q.latest_version_id
       LEFT JOIN quotation_statuses qs ON qs.id = lv.status_id
       INNER JOIN quotation_activation_statuses qas ON qas.id = q.activation_status_id
       ${whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : ""}
       ORDER BY q.updated_at DESC, q.id DESC
       LIMIT ?`,
      params,
    );
    evidence.quotations = rows.map((row) => ({
      id: Number(row.id),
      opportunityName: row.opportunity_name || "",
      accountName: row.account_name || "",
      activationStatusCode: row.activation_status_code || "",
      latestVersionNumber: row.latest_version_number
        ? Number(row.latest_version_number)
        : null,
      latestStatusCode: row.latest_status_code || "",
      latestStatusName: row.latest_status_name || "",
      latestProposalName: row.latest_proposal_name || "",
      updatedAt: row.updated_at || null,
    }));
  }

  if (
    requestedDomains.includes("proposals") &&
    hasAnyPermission(user, CHATBOT_PROPOSAL_READ_PERMISSIONS)
  ) {
    const params = [];
    const ownershipJoin = buildAccountExpressionOwnershipJoin({
      user,
      params,
      accountExpression: "o.account_id",
      bypassPermissions: ["cotizaciones.administracion"],
    });
    const whereClauses = buildProposalsEvidenceWhereClauses({ filters });
    pushProposalFilterParams(params, filters);
    params.push(CHATBOT_MAX_EVIDENCE_ITEMS);
    const rows = await query(
      `SELECT p.id, p.title, p.status_code, a.name AS account_name,
              o.name AS opportunity_name,
              qvs.code AS quotation_version_status_code,
              p.updated_at
       FROM proposals p
       INNER JOIN opportunities o ON o.id = p.opportunity_id
       INNER JOIN accounts a ON a.id = p.account_id
       INNER JOIN quotation_versions qv ON qv.id = p.quotation_version_id
       LEFT JOIN quotation_statuses qvs ON qvs.id = qv.status_id
       ${ownershipJoin}
       ${whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : ""}
       ORDER BY p.updated_at DESC, p.id DESC
       LIMIT ?`,
      params,
    );
    evidence.proposals = rows.map((row) => ({
      id: Number(row.id),
      title: row.title || "",
      statusCode: row.status_code || "",
      accountName: row.account_name || "",
      opportunityName: row.opportunity_name || "",
      quotationVersionStatusCode: row.quotation_version_status_code || "",
      updatedAt: row.updated_at || null,
    }));
  }

  return evidence;
}

export async function executeChatbotPlan({
  user,
  plannerOutput,
  resolverOutput,
  prompt,
}) {
  const requestedDomains = Array.isArray(plannerOutput?.requestedDomains)
    ? plannerOutput.requestedDomains
    : [];
  const filters = plannerOutput?.filters || {};

  const appKnowledge = String(prompt || "").trim()
    ? await searchInternalAppKnowledge({ user, prompt, limit: 6 })
    : [];

  if (resolverOutput?.resolutionStatus === "resolved") {
    if (resolverOutput.selectedEntityType === "account") {
      const result = await fetchAccountBundle({
        user,
        accountId: Number(resolverOutput.selectedEntityId),
        requestedDomains,
        filters,
      });
      if (
        result &&
        requestedDomains.includes("documentation") &&
        String(prompt || "").trim()
      ) {
        result.documentation = await searchMarkdownKnowledge({
          prompt,
          limit: 6,
        });
      }
      if (result && appKnowledge.length) {
        result.applicationKnowledge = appKnowledge;
      }
      return result;
    }
    if (resolverOutput.selectedEntityType === "contact") {
      const result = await fetchContactBundle({
        user,
        contactId: Number(resolverOutput.selectedEntityId),
        requestedDomains,
        filters,
      });
      if (
        result &&
        requestedDomains.includes("documentation") &&
        String(prompt || "").trim()
      ) {
        result.documentation = await searchMarkdownKnowledge({
          prompt,
          limit: 6,
        });
      }
      if (result && appKnowledge.length) {
        result.applicationKnowledge = appKnowledge;
      }
      return result;
    }
    if (resolverOutput.selectedEntityType === "opportunity") {
      const result = await fetchOpportunityBundle({
        user,
        opportunityId: Number(resolverOutput.selectedEntityId),
        requestedDomains,
        filters,
      });
      if (
        result &&
        requestedDomains.includes("documentation") &&
        String(prompt || "").trim()
      ) {
        result.documentation = await searchMarkdownKnowledge({
          prompt,
          limit: 6,
        });
      }
      if (result && appKnowledge.length) {
        result.applicationKnowledge = appKnowledge;
      }
      return result;
    }
  }

  const fallbackEvidence = await fetchRecentDomainRecords(
    user,
    requestedDomains,
    filters,
  );

  if (
    requestedDomains.includes("documentation") &&
    String(prompt || "").trim()
  ) {
    fallbackEvidence.documentation = await searchMarkdownKnowledge({
      prompt,
      limit: 6,
    });
  }

  if (appKnowledge.length) {
    fallbackEvidence.applicationKnowledge = appKnowledge;
  }

  return fallbackEvidence;
}
