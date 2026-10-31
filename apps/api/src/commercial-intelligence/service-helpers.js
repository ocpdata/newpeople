// Small helpers shared by the commercial intelligence modules.

import { normalizeCustomerIntelligenceFinding } from "./contract.js";

export function clip(value, max = 1200) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

export function diagnosticCheck({ field, state, expected, actual, message }) {
  return { field, state, expected, actual, message };
}

export function parseJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function hasPermission(user, permission) {
  return Boolean(user?.permissionSet?.has(permission));
}

export function customerChatDataForUser(value, user) {
  if (!value || typeof value !== "object" ||
      hasPermission(user, "mi_coach.chat_diagnostics")) return value;
  const { debug, turnDebug, qualityTraceId, ...visible } = value;
  return visible;
}

export function hasReadPermission(user, moduleName) {
  return Boolean(
    hasPermission(user, `${moduleName}.read`) ||
    hasPermission(user, `${moduleName}.read_all`),
  );
}

export function hasReadAllPermission(user, moduleName) {
  return hasPermission(user, `${moduleName}.read_all`);
}

export function createHttpError(status, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, details);
  return error;
}

export function mapJobRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    publicId: row.public_id,
    accountId: row.account_id === null ? null : Number(row.account_id),
    opportunityId:
      row.opportunity_id === null ? null : Number(row.opportunity_id),
    contactId: row.contact_id === null ? null : Number(row.contact_id),
    requestedByUserId: Number(row.requested_by_user_id),
    jobType: row.job_type,
    status: row.status,
    request: parseJson(row.request_json, null),
    result: parseJson(row.result_json, null),
    errorMessage: row.error_message || null,
    progress: parseJson(row.progress_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at || null,
  };
}

export function mapFindingRow(row) {
  if (!row) return null;
  const finding = {
    id: Number(row.id),
    publicId: row.public_id,
    jobId: row.job_id === null ? null : Number(row.job_id),
    accountId: row.account_id === null ? null : Number(row.account_id),
    opportunityId:
      row.opportunity_id === null ? null : Number(row.opportunity_id),
    contactId: row.contact_id === null ? null : Number(row.contact_id),
    category: row.category,
    title: row.title,
    summary: row.summary || "",
    evidenceText: row.evidence_text || "",
    sourceType: row.source_type,
    sourceReference: row.source_reference || "",
    confidence: row.confidence,
    certainty: row.certainty,
    status: row.status,
    metadata: parseJson(row.metadata_json, {}),
    createdByUserId:
      row.created_by_user_id === null ? null : Number(row.created_by_user_id),
    validatedByUserId:
      row.validated_by_user_id === null
        ? null
        : Number(row.validated_by_user_id),
    validatedAt: row.validated_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  const normalized = normalizeCustomerIntelligenceFinding({
    ...finding,
    evidence: finding.evidenceText,
    source: finding.sourceType,
    sourceUrl: finding.sourceReference,
  });
  return { ...finding, ...normalized };
}

export function daysSince(value, now = Date.now()) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((now - timestamp) / 86400000));
}

export function daysUntil(value, now = Date.now()) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.floor((timestamp - now) / 86400000);
}

export function isOpenCustomerOpportunity(opportunity) {
  const activationStatusCode = String(
    opportunity?.activationStatusCode ||
      opportunity?.activation_status_code ||
      "activada",
  ).toLowerCase();
  const commercialStatusCode = String(
    opportunity?.commercialStatusCode ||
      opportunity?.commercial_status_code ||
      "",
  ).toLowerCase();
  return (
    activationStatusCode === "activada" && commercialStatusCode === "en_proceso"
  );
}

export function isCustomerOpportunityHistoryStatusAllowed(item, settings) {
  if (item.commercial_status_code === "ganada") {
    return settings.includeWonOpportunities;
  }
  if (item.commercial_status_code === "perdida") {
    return settings.includeLostOpportunities;
  }
  if (item.commercial_status_code === "anulada") {
    return settings.includeCancelledOpportunities;
  }
  return true;
}

export function filterCustomerOpportunityHistory(opportunities, settings) {
  return opportunities.filter((item) =>
    (!item.activation_status_code || item.activation_status_code === "activada") &&
    isCustomerOpportunityHistoryStatusAllowed(item, settings));
}

export function filterCustomerOpportunityArtifacts(
  records,
  visibleOpportunityIds,
) {
  const visibleIds = new Set(
    [...visibleOpportunityIds].map((id) => Number(id)),
  );
  return records.filter((record) =>
    visibleIds.has(Number(record.opportunity_id ?? record.opportunityId)),
  );
}
