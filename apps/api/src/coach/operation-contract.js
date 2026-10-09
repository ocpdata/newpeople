export function normalizeActivityOperation(action = {}, context = {}) {
  const actionTypes = new Set([
    "next_step",
    "follow_up",
    "call",
    "meeting",
    "conference",
    "presentation",
    "visit",
    "send_email",
    "waiting_customer",
    "demo",
    "quotation",
    "negotiation",
    "other",
  ]);
  const statuses = new Set(["pending", "in_progress", "blocked", "done"]);
  const priorities = new Set(["low", "medium", "high"]);
  return {
    kind: "activity",
    title: String(action.title || "Actividad sugerida").trim(),
    evidence: Array.isArray(action.evidence) ? action.evidence : [],
    missingFields: [],
    requiresConfirmation: true,
    sourceChannel: "customer_account",
    opportunityId:
      Number(action.opportunityId || context.opportunityId || 0) || null,
    activityId: null,
    actionType: actionTypes.has(action.actionType) ? action.actionType : "call",
    status: statuses.has(action.status) ? action.status : "pending",
    priority: priorities.has(action.priority) ? action.priority : "medium",
    scheduledAt: action.scheduledAt || "",
    dueDate: action.dueDate || null,
    notes: action.notes || "",
    successCriteria: action.successCriteria || "Confirmar el siguiente paso.",
    source: context.opportunityId
      ? { type: "opportunity", id: Number(context.opportunityId) }
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
