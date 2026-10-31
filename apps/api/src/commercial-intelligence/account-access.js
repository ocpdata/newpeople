// Reads an account, opportunity or contact only when the user is allowed to see it.

import { query } from "../db.js";
import { createHttpError, hasReadAllPermission, hasReadPermission } from "./service-helpers.js";

export async function getAccessibleAccount({ user, accountId }) {
  if (!hasReadPermission(user, "cuentas")) {
    throw createHttpError(403, "No autorizado", {
      requiredPermission: "cuentas.read",
    });
  }

  const params = [Number(accountId)];
  const scope = hasReadAllPermission(user, "cuentas")
    ? ""
    : "AND EXISTS (SELECT 1 FROM account_owners ao WHERE ao.account_id = a.id AND ao.user_id = ?)";
  if (!hasReadAllPermission(user, "cuentas")) params.push(Number(user.id));

  const rows = await query(
    `SELECT a.id, a.name, a.registration_code, a.phone, a.website,
            a.city, a.state_region, a.description, aas.code AS status_code
     FROM accounts a
     INNER JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
     WHERE a.id = ? AND aas.code = 'activada' ${scope}
     LIMIT 1`,
    params,
  );
  if (!rows.length) {
    throw createHttpError(404, "La cuenta no esta disponible");
  }
  return rows[0];
}

export async function getAccessibleOpportunity({ user, opportunityId }) {
  if (!hasReadPermission(user, "oportunidades")) {
    throw createHttpError(403, "No autorizado", {
      requiredPermission: "oportunidades.read",
    });
  }

  const params = [Number(opportunityId)];
  const scope = hasReadAllPermission(user, "oportunidades")
    ? ""
    : `AND (
        EXISTS (SELECT 1 FROM account_owners ao WHERE ao.account_id = o.account_id AND ao.user_id = ?)
        OR o.created_by = ?
        OR o.seller_user_id = ?
      )`;
  if (!hasReadAllPermission(user, "oportunidades")) {
    params.push(Number(user.id), Number(user.id), Number(user.id));
  }

  const rows = await query(
    `SELECT o.id, o.name, o.account_id, o.contact_id, o.amount_usd, o.close_date,
          o.sales_stage_id,
            o.updated_at, oss.code AS stage_code, oss.name AS stage_name,
            ocs.code AS commercial_status_code,
            a.name AS account_name
     FROM opportunities o
     INNER JOIN accounts a ON a.id = o.account_id
     INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
     INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
     INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
     WHERE o.id = ? AND oas.code = 'activada' ${scope}
     LIMIT 1`,
    params,
  );
  if (!rows.length) {
    throw createHttpError(404, "La oportunidad no esta disponible");
  }
  return rows[0];
}

export async function getAccessibleContact({ user, contactId }) {
  if (!hasReadPermission(user, "contactos")) {
    throw createHttpError(403, "No autorizado", {
      requiredPermission: "contactos.read",
    });
  }

  const params = [Number(contactId)];
  const scope = hasReadAllPermission(user, "contactos")
    ? ""
    : "AND EXISTS (SELECT 1 FROM account_owners ao WHERE ao.account_id = c.account_id AND ao.user_id = ?)";
  if (!hasReadAllPermission(user, "contactos")) params.push(Number(user.id));

  const rows = await query(
    `SELECT c.id, c.account_id, c.first_name, c.last_name, c.email, c.phone,
            c.mobile, c.position_title, c.department,
            a.name AS account_name
     FROM contacts c
     INNER JOIN accounts a ON a.id = c.account_id
     INNER JOIN contact_activation_statuses cas ON cas.id = c.activation_status_id
     WHERE c.id = ? AND cas.code = 'activado' ${scope}
     LIMIT 1`,
    params,
  );
  if (!rows.length) {
    throw createHttpError(404, "El contacto no esta disponible");
  }
  return rows[0];
}

export function resolveAccountId({ account, opportunity, contact }) {
  return (
    Number(
      account?.id || opportunity?.account_id || contact?.account_id || 0,
    ) || null
  );
}
