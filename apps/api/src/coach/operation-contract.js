import { normalizeCommercialActivityType } from "../../../../shared/commercial-activity-types.js";

export function normalizeActivityOperation(action = {}, context = {}) {
  const statuses = new Set(["pending", "in_progress", "blocked", "done"]);
  const priorities = new Set(["low", "medium", "high"]);
  const calendarKind = ["standalone", "lead", "opportunity"].includes(
    action.calendarKind,
  )
    ? action.calendarKind
    : action.opportunityId || context.opportunityId
      ? "opportunity"
      : action.interactionId || context.interactionId
        ? "lead"
        : "standalone";
  const opportunityId =
    Number(action.opportunityId || context.opportunityId || 0) || null;
  const interactionId =
    Number(action.interactionId || context.interactionId || 0) || null;
  const accountId = Number(action.accountId || context.accountId || 0) || null;
  const contactId = Number(action.contactId || context.contactId || 0) || null;
  return {
    kind: "activity",
    title: String(action.title || "Actividad sugerida").trim(),
    calendarKind,
    evidence: Array.isArray(action.evidence) ? action.evidence : [],
    missingFields: [],
    requiresConfirmation: true,
    sourceChannel: "customer_account",
    opportunityId,
    interactionId,
    accountId,
    contactId,
    activityId: null,
    actionType: normalizeCommercialActivityType(action.actionType),
    status: statuses.has(action.status) ? action.status : "pending",
    priority: priorities.has(action.priority) ? action.priority : "medium",
    scheduledAt: action.scheduledAt || "",
    dueDate: action.dueDate || null,
    notes: action.notes || "",
    successCriteria: action.successCriteria || "Confirmar el siguiente paso.",
    source:
      calendarKind === "opportunity" && opportunityId
        ? { type: "opportunity", id: opportunityId }
        : calendarKind === "lead" && interactionId
          ? { type: "lead", id: interactionId }
          : accountId
            ? { type: "account", id: accountId }
            : null,
  };
}

export function normalizeProspectConversionOperation(
  action = {},
  { prospectSessionId, target = "account" } = {},
) {
  const kind =
    target === "contact"
      ? "create_contact"
      : target === "opportunity"
        ? "create_opportunity"
        : "create_account";
  const targetModule =
    kind === "create_contact"
      ? "contacts"
      : kind === "create_opportunity"
        ? "opportunities"
        : "accounts";
  return {
    kind,
    title: String(action.title || `Convertir prospecto a ${target}`).trim(),
    evidence: Array.isArray(action.evidence) ? action.evidence : [],
    missingFields: [],
    requiresConfirmation: true,
    sourceChannel: "prospect",
    targetModule,
    payload: {
      prospectSessionId: Number(prospectSessionId),
      target,
      actionType: action.actionType || "conversion",
      notes: action.notes || "",
      successCriteria: action.successCriteria || "Conversión confirmada.",
    },
    accountId: null,
    contactId: null,
    opportunityId: null,
    interactionId: null,
    quotationVersionId: null,
    source: null,
  };
}
