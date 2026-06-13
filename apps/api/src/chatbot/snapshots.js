import { query } from "../db.js";
import {
  CHATBOT_ACCOUNT_READ_PERMISSIONS,
  CHATBOT_CONTACT_READ_PERMISSIONS,
  CHATBOT_OPPORTUNITY_READ_PERMISSIONS,
  CHATBOT_PROPOSAL_READ_PERMISSIONS,
  CHATBOT_QUOTATION_READ_PERMISSIONS,
  buildOwnershipWhere,
  hasAnyPermission,
} from "./common.js";

export async function loadEntitySnapshot(user) {
  const userId = Number(user?.id || 0);
  const canReadAccountsAll = hasAnyPermission(user, ["cuentas.read_all"]);
  const canReadContactsAll = hasAnyPermission(user, ["contactos.read_all"]);
  const canReadOpportunitiesAll = hasAnyPermission(user, [
    "oportunidades.read_all",
  ]);

  const result = {};

  if (hasAnyPermission(user, CHATBOT_ACCOUNT_READ_PERMISSIONS)) {
    const owner = buildOwnershipWhere({
      canReadAll: canReadAccountsAll,
      ownerColumn: "created_by",
      userId,
    });
    const rows = await query(
      `SELECT COUNT(*) AS total FROM accounts${owner.where}`,
      owner.params,
    );
    result.accounts = { total: Number(rows?.[0]?.total || 0) };
  }

  if (hasAnyPermission(user, CHATBOT_CONTACT_READ_PERMISSIONS)) {
    const owner = buildOwnershipWhere({
      canReadAll: canReadContactsAll,
      ownerColumn: "created_by",
      userId,
    });
    const rows = await query(
      `SELECT COUNT(*) AS total FROM contacts${owner.where}`,
      owner.params,
    );
    result.contacts = { total: Number(rows?.[0]?.total || 0) };
  }

  if (hasAnyPermission(user, CHATBOT_OPPORTUNITY_READ_PERMISSIONS)) {
    const owner = buildOwnershipWhere({
      canReadAll: canReadOpportunitiesAll,
      ownerColumn: "created_by",
      userId,
    });
    const rows = await query(
      `SELECT COUNT(*) AS total FROM opportunities${owner.where}`,
      owner.params,
    );
    result.opportunities = { total: Number(rows?.[0]?.total || 0) };
  }

  if (hasAnyPermission(user, CHATBOT_QUOTATION_READ_PERMISSIONS)) {
    const rows = await query(
      "SELECT COUNT(*) AS total FROM quotations WHERE created_by_user_id = ?",
      [userId],
    );
    result.quotations = { total: Number(rows?.[0]?.total || 0) };
  }

  if (hasAnyPermission(user, CHATBOT_PROPOSAL_READ_PERMISSIONS)) {
    const rows = await query(
      "SELECT COUNT(*) AS total FROM proposals WHERE created_by_user_id = ?",
      [userId],
    );
    result.proposals = { total: Number(rows?.[0]?.total || 0) };
  }

  return result;
}
