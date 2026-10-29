import { query } from "../db.js";
import { parseJsonSafe } from "./hash.js";
import { computeScopeContentHash } from "./section-model.js";
import { withSectionContent } from "./tiptap.js";

export const SCOPE_STATUS = Object.freeze({
  draft: "draft",
  inReview: "in_review",
  approved: "approved",
});

export function serializeScopeRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    proposalDocumentId: Number(row.proposal_document_id),
    opportunityId: Number(row.opportunity_id),
    quotationVersionId: Number(row.quotation_version_id),
    status: row.status,
    playbookCodes: parseJsonSafe(row.playbook_codes_json, []) || [],
    snapshot: parseJsonSafe(row.profile_snapshot_json, null),
    sections: (parseJsonSafe(row.sections_json, []) || []).map(withSectionContent),
    topology: parseJsonSafe(row.topology_json, null),
    asisTopology: parseJsonSafe(row.asis_topology_json, null),
    contentHash: row.content_hash || null,
    approvedHash: row.approved_hash || null,
    requestedByUserId: row.requested_by_user_id
      ? Number(row.requested_by_user_id)
      : null,
    requestedAt: row.requested_at || null,
    approvedByUserId: row.approved_by_user_id
      ? Number(row.approved_by_user_id)
      : null,
    approvedAt: row.approved_at || null,
    approvalChecklist: parseJsonSafe(row.approval_checklist_json, null),
    approvalComment: row.approval_comment || "",
    selfApproved: Boolean(row.self_approved),
    lastEditedByUserId: row.last_edited_by_user_id
      ? Number(row.last_edited_by_user_id)
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getScopeRowByDocumentId(proposalDocumentId) {
  const rows = await query(
    `SELECT * FROM proposal_technical_scopes WHERE proposal_document_id = ? LIMIT 1`,
    [Number(proposalDocumentId)],
  );
  return rows[0] || null;
}

export function snapshotAnswersOf(scope) {
  return Array.isArray(scope?.snapshot?.answers) ? scope.snapshot.answers : [];
}

// The hash always uses the quotation version the scope was built for, so a rebase invalidates the approval.
export function computeHashForScope(scope, quotationVersionId) {
  return computeScopeContentHash({
    sections: scope.sections,
    topology: scope.topology,
    asisTopology: scope.asisTopology,
    quotationVersionId,
    snapshotAnswers: snapshotAnswersOf(scope),
  });
}
