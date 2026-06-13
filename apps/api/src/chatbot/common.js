import { randomUUID } from "node:crypto";

export const CHATBOT_JOB_POLL_AFTER_MS = 2000;
export const CHATBOT_JOB_LEASE_SECONDS = 120;
export const CHATBOT_JOB_RESULT_TTL_MINUTES = 180;
export const CHATBOT_MAX_EVIDENCE_ITEMS = 12;

export const CHATBOT_ACCOUNT_READ_PERMISSIONS = [
  "cuentas.read",
  "cuentas.read_all",
];
export const CHATBOT_CONTACT_READ_PERMISSIONS = [
  "contactos.read",
  "contactos.read_all",
];
export const CHATBOT_OPPORTUNITY_READ_PERMISSIONS = [
  "oportunidades.read",
  "oportunidades.read_all",
];
export const CHATBOT_QUOTATION_READ_PERMISSIONS = [
  "cotizaciones.operacion",
  "cotizaciones.revision",
  "cotizaciones.ingreso",
  "cotizaciones.administracion",
  "cotizaciones.externo",
];
export const CHATBOT_PROPOSAL_READ_PERMISSIONS = [
  "propuestas.read",
  "propuestas.create",
  "propuestas.update",
];

export function buildPublicId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${randomUUID()
    .replace(/-/g, "")
    .slice(0, 14)}`;
}

export function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function extractJsonObject(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

export function hasAnyPermission(user, permissionCodes = []) {
  const set = user?.permissionSet;
  if (!set || typeof set.has !== "function") return false;
  return permissionCodes.some((permissionCode) => set.has(permissionCode));
}

export function buildOwnershipWhere({ canReadAll, ownerColumn, userId }) {
  if (canReadAll) {
    return { where: "", params: [] };
  }
  return {
    where: ` WHERE ${ownerColumn} = ?`,
    params: [Number(userId)],
  };
}

export function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@._&\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeLikeTerm(value) {
  return String(value || "").replace(/[\\%_]/g, "\\$&");
}

export function tokenizeSearchText(value) {
  return normalizeSearchText(value)
    .split(" ")
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !/^\d+$/.test(item))
    .slice(0, 8);
}

export function buildScopedOwnershipJoin({
  user,
  params,
  accountExpression,
  bypassPermissions,
}) {
  if (hasAnyPermission(user, bypassPermissions)) return "";
  params.push(Number(user.id));
  return `INNER JOIN account_owners ao_scope ON ao_scope.account_id = ${accountExpression} AND ao_scope.user_id = ?`;
}

export function buildAccountOwnershipJoin(user, params, accountAlias = "a") {
  return buildScopedOwnershipJoin({
    user,
    params,
    accountExpression: `${accountAlias}.id`,
    bypassPermissions: ["cuentas.read_all"],
  });
}

export function buildAccountExpressionOwnershipJoin({
  user,
  params,
  accountExpression = "o.account_id",
  bypassPermissions,
}) {
  return buildScopedOwnershipJoin({
    user,
    params,
    accountExpression,
    bypassPermissions,
  });
}

export function buildTokenWhereClause(columnExpression, tokens, params) {
  if (!tokens.length) return "1 = 0";
  const clauses = [];
  for (const token of tokens) {
    clauses.push(`${columnExpression} LIKE ?`);
    params.push(`%${escapeLikeTerm(token)}%`);
  }
  return clauses.join(" AND ");
}
