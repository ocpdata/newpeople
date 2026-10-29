import { query } from "../db.js";
import { parseJsonSafe } from "./hash.js";

const ADMINISTRATION_PERMISSION = "cotizaciones.administracion";

// Quotation version the proposal document was built from; 0 means the document has no quotation.
export function quotationVersionIdOf(proposal) {
  return Number(proposal?.quotation_version_id || 0);
}

function readMetadata(contentJson) {
  const content = parseJsonSafe(contentJson, {}) || {};
  return content.metadata && typeof content.metadata === "object" ? content.metadata : {};
}

// A proposal document is visible to administrators, to the owners of its account and to the presales of its opportunity.
// Without a user the document is loaded without an access check (used when rendering output that was already authorized).
export async function loadProposalDocumentSource({ documentId, user = null }) {
  const id = Number(documentId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const params = [id];
  let access = "";
  if (user && !user.permissionSet?.has(ADMINISTRATION_PERMISSION)) {
    access = `AND (
      EXISTS (SELECT 1 FROM account_owners ao WHERE ao.account_id = pd.account_id AND ao.user_id = ?)
      OR o.presales_user_id = ?
    )`;
    params.push(Number(user.id), Number(user.id));
  }
  const rows = await query(
    `SELECT pd.id, pd.title, pd.status, pd.opportunity_id, pd.quotation_id,
            o.name AS opportunity_name, a.name AS account_name,
            TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS contact_name,
            v.content_json
     FROM proposal_documents pd
     INNER JOIN opportunities o ON o.id = pd.opportunity_id
     LEFT JOIN accounts a ON a.id = pd.account_id
     LEFT JOIN contacts c ON c.id = pd.contact_id
     LEFT JOIN proposal_document_versions v ON v.id = pd.current_version_id
     WHERE pd.id = ? ${access}
     LIMIT 1`,
    params,
  );
  const row = rows[0];
  if (!row) return null;
  const metadata = readMetadata(row.content_json);
  return {
    id: Number(row.id),
    title: row.title,
    status: row.status,
    opportunity_id: Number(row.opportunity_id),
    opportunity_name: row.opportunity_name || "",
    account_name: row.account_name || "",
    contact_name: row.contact_name || "",
    quotation_id: metadata.quotation_id ? Number(metadata.quotation_id) : row.quotation_id ? Number(row.quotation_id) : null,
    quotation_version_id: metadata.quotation_version_id ? Number(metadata.quotation_version_id) : null,
    template_code: metadata.template_code ? String(metadata.template_code) : "",
  };
}
