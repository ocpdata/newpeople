import { query } from "../db.js";
import {
  CHATBOT_ACCOUNT_READ_PERMISSIONS,
  CHATBOT_CONTACT_READ_PERMISSIONS,
  CHATBOT_OPPORTUNITY_READ_PERMISSIONS,
  CHATBOT_PROPOSAL_READ_PERMISSIONS,
  CHATBOT_QUOTATION_READ_PERMISSIONS,
  hasAnyPermission,
} from "./common.js";

export function getReadableDomainHints(user) {
  return {
    accounts: hasAnyPermission(user, CHATBOT_ACCOUNT_READ_PERMISSIONS),
    contacts: hasAnyPermission(user, CHATBOT_CONTACT_READ_PERMISSIONS),
    opportunities: hasAnyPermission(user, CHATBOT_OPPORTUNITY_READ_PERMISSIONS),
    quotations: hasAnyPermission(user, CHATBOT_QUOTATION_READ_PERMISSIONS),
    proposals: hasAnyPermission(user, CHATBOT_PROPOSAL_READ_PERMISSIONS),
  };
}

export function getDomainSuggestions(user) {
  const hints = getReadableDomainHints(user);
  const suggestions = [
    "Como crear una oportunidad paso a paso",
    "Como registrar seguimiento comercial efectivo",
    "Que significa cada estado de una actividad",
  ];

  if (hints.accounts) suggestions.push("Dame un resumen de mis cuentas");
  if (hints.contacts) suggestions.push("Dame un resumen de mis contactos");
  if (hints.opportunities) {
    suggestions.push("Dame un resumen de mis oportunidades activas");
  }
  if (hints.quotations) {
    suggestions.push("Dame un resumen de mis cotizaciones recientes");
  }
  if (hints.proposals) {
    suggestions.push("Dame un resumen de mis propuestas recientes");
  }

  return suggestions.slice(0, 8);
}

export async function listCatalogCodes(tableName) {
  const rows = await query(
    `SELECT code FROM ${tableName} WHERE code IS NOT NULL ORDER BY id ASC`,
  );
  return rows.map((row) => String(row.code || "").trim()).filter(Boolean);
}

export async function loadChatbotPlannerMetadata(user) {
  const allowedDomains = getReadableDomainHints(user);
  const [
    accountActivationStatusCodes,
    contactActivationStatusCodes,
    opportunityActivationStatusCodes,
    opportunityCommercialStatusCodes,
    opportunitySalesStageCodes,
    quotationActivationStatusCodes,
    quotationStatusCodes,
    proposalStatusRows,
  ] = await Promise.all([
    listCatalogCodes("account_activation_statuses"),
    listCatalogCodes("contact_activation_statuses"),
    listCatalogCodes("opportunity_activation_statuses"),
    listCatalogCodes("opportunity_commercial_statuses"),
    listCatalogCodes("opportunity_sales_stages"),
    listCatalogCodes("quotation_activation_statuses"),
    listCatalogCodes("quotation_statuses"),
    query(
      `SELECT DISTINCT status_code
       FROM proposals
       WHERE status_code IS NOT NULL
       ORDER BY status_code ASC`,
    ).catch(() => []),
  ]);

  const proposalStatusCodes = [
    ...new Set(
      (Array.isArray(proposalStatusRows) ? proposalStatusRows : [])
        .map((row) => String(row.status_code || "").trim())
        .filter(Boolean)
        .concat(["active", "archived"]),
    ),
  ];

  return {
    allowedDomains,
    domains: {
      accounts: {
        enabled: Boolean(allowedDomains.accounts),
        activationStatusCodes: accountActivationStatusCodes,
        filterableFields: ["activationStatusCodes", "activeOnly"],
      },
      contacts: {
        enabled: Boolean(allowedDomains.contacts),
        activationStatusCodes: contactActivationStatusCodes,
        filterableFields: ["activationStatusCodes", "activeOnly"],
      },
      opportunities: {
        enabled: Boolean(allowedDomains.opportunities),
        activationStatusCodes: opportunityActivationStatusCodes,
        commercialStatusCodes: opportunityCommercialStatusCodes,
        salesStageCodes: opportunitySalesStageCodes,
        filterableFields: [
          "activationStatusCodes",
          "commercialStatusCodes",
          "salesStageCodes",
          "openOnly",
          "activeOnly",
        ],
      },
      quotations: {
        enabled: Boolean(allowedDomains.quotations),
        activationStatusCodes: quotationActivationStatusCodes,
        latestStatusCodes: quotationStatusCodes,
        filterableFields: [
          "activationStatusCodes",
          "latestStatusCodes",
          "activeOnly",
        ],
      },
      proposals: {
        enabled: Boolean(allowedDomains.proposals),
        statusCodes: proposalStatusCodes,
        quotationVersionStatusCodes: quotationStatusCodes,
        filterableFields: ["statusCodes", "quotationVersionStatusCodes"],
      },
    },
  };
}
