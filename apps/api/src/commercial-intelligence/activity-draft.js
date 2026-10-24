import { normalizeActivityOperation } from "../coach/operation-contract.js";
import { getCommercialActivityTypeLabel } from "../../../../shared/commercial-activity-types.js";
import { normalizeCustomerSearchText, validateCustomerRecordList } from "./customer-record-list.js";

export function resolveCustomerActivityListOpportunity({ question, conversationContext, snapshot }) {
  const text = normalizeCustomerSearchText(question);
  if (!/\b(?:esta|esa|dicha) oportunidad\b/.test(text)) return null;
  const previous = conversationContext?.turnMemory?.contract?.components;
  if (!Array.isArray(previous) || previous.length !== 1 ||
      !["query.record_list", "query.record_search"].includes(previous[0].category) ||
      previous[0].object !== "opportunity" ||
      conversationContext.turnMemory.pendingComponentIds?.includes(previous[0].id)) return null;
  const list = validateCustomerRecordList(
    conversationContext?.recordList, snapshot, snapshot?.account?.id,
  );
  if (!list || list.object !== "opportunity" || list.ids.length !== 1 ||
      Number(conversationContext.accountId) !== Number(snapshot.account.id)) return null;
  const id = list.ids[0];
  if (conversationContext.opportunityId && Number(conversationContext.opportunityId) !== id) return null;
  const records = [
    ...(snapshot.opportunities || []), ...(snapshot.inactiveOpportunities || []),
    ...(snapshot.selectedOpportunity ? [snapshot.selectedOpportunity] : []),
  ];
  if (records.some((record) => Number(record.id) !== id && record.name &&
      ` ${text} `.includes(` ${normalizeCustomerSearchText(record.name)} `))) return null;
  return id;
}

function snapshotOpportunityDetail(opportunity, snapshot) {
  if (!opportunity) return null;
  const contact = (snapshot.contacts || []).find(
    (item) =>
      Number(item.id) === Number(opportunity.contactId || 0) &&
      Number(item.accountId) === Number(snapshot.account?.id),
  );
  const contactName = contact
    ? [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() || contact.name
    : "";
  return {
    id: Number(opportunity.id),
    name: opportunity.name,
    associatedContact: contactName ? { id: Number(contact.id), name: contactName } : null,
  };
}

export function buildCustomerActivityDraftResponse({
  routing,
  readToolResults,
  snapshot,
  permissions,
  pendingActivity = null,
  pendingActivityIntent = null,
  selectedOpportunityId = null,
}) {
  const draft = routing?.activityDraft;
  const hasActivityDraftIntent =
    draft &&
    ["prepare", "continue", "discard"].includes(draft.action) &&
    !["other_account", "out_of_scope"].includes(routing.ambiguity?.reason) &&
    routing.validationDiagnostics?.operationPolicyDenied !== true &&
    (!routing.operationKind || ["none", "activity"].includes(routing.operationKind)) &&
    (!routing.intents?.length ||
      routing.intents.every((intent) => ["crm_operation", "contact_query"].includes(intent)));
  if (
    !draft ||
    (routing.operationKind &&
      !["none", "activity"].includes(routing.operationKind)) ||
    !["prepare", "continue", "discard"].includes(draft.action) ||
    routing.mode !== "operation" ||
    (routing.requiresClarification && !hasActivityDraftIntent) ||
    routing.intents?.some(
      (intent) => !["crm_operation", "contact_query"].includes(intent),
    )
  )
    return null;
  const allowed = (permission) =>
    permissions?.has?.(permission) || permissions?.includes?.(permission);
  if (!allowed("mi_coach.execute") || !allowed("calendario_comercial.update")) {
    return {
      answer:
        "Necesitas permiso para ejecutar operaciones del Coach y actualizar Calendario antes de preparar esta actividad.",
      responseType: "clarification",
      operations: [],
      evidence: [],
      pendingItems: [],
      confidence: "high",
    };
  }
  if (draft.action === "discard") {
    return {
      answer:
        "La propuesta de actividad fue descartada; no se creó ninguna actividad.",
      responseType: "informational",
      operations: [],
      evidence: [],
      pendingItems: [],
      confidence: "high",
      activityDraftDiscarded: true,
    };
  }
  const prior = pendingActivity?.operation || null;
  const timing = ["completed", "scheduled"].includes(draft.timing)
    ? draft.timing
    : ["completed", "scheduled"].includes(pendingActivityIntent?.timing)
      ? pendingActivityIntent.timing
    : prior?.status === "done"
      ? "completed"
      : prior?.status === "pending"
        ? "scheduled"
        : "unclear";
  const activityIntent = {
    actionType: draft.actionType || pendingActivityIntent?.actionType || "call",
    timing,
    title: String(pendingActivityIntent?.title || draft.title || "")
      .trim()
      .slice(0, 1200),
    notes: String(draft.notes || pendingActivityIntent?.notes || "")
      .trim()
      .slice(0, 4000),
    successCriteria: String(
      draft.successCriteria || pendingActivityIntent?.successCriteria || "",
    )
      .trim()
      .slice(0, 1200),
    temporalPreference: String(
      draft.temporalPreference || pendingActivityIntent?.temporalPreference || "",
    )
      .trim()
      .slice(0, 1200),
  };
  if (routing.requiresClarification) {
    return {
      answer:
        routing.ambiguity?.clarificationQuestion ||
        "Necesito identificar la oportunidad autorizada antes de preparar esta actividad.",
      responseType: "clarification",
      operations: [],
      evidence: [],
      pendingItems: routing.ambiguity?.missingContext || ["Oportunidad"],
      confidence: "low",
      activityIntent,
    };
  }
  if (timing === "unclear") {
    return {
      answer:
        "¿La llamada ya ocurrió o quieres programarla? Necesito confirmarlo antes de preparar la actividad.",
      responseType: "clarification",
      operations: [],
      evidence: [],
      pendingItems: ["Cuándo se realizará la llamada"],
      confidence: "medium",
      activityIntent,
    };
  }
  // An explicitly selected opportunity applies only when the request names no other opportunity.
  const opportunityId = Number(
    routing.serverResolvedEntityIds?.opportunityId ||
      (!String(routing.entities?.opportunityReference || "").trim() &&
        Number(selectedOpportunityId || 0)) ||
      0,
  );
  const scopedOpportunity = [
    ...(snapshot.opportunities || []),
    ...(snapshot.inactiveOpportunities || []),
    ...(snapshot.selectedOpportunity ? [snapshot.selectedOpportunity] : []),
  ].find(
    (item) =>
      Number(item.id) === opportunityId &&
      Number(item.accountId || snapshot.account?.id) ===
        Number(snapshot.account?.id),
  );
  const opportunityReads = (readToolResults || []).filter(
    (item) => item.toolName === "getOpportunity" &&
      (Number(item.result?.id) === opportunityId || Number(item.input?.opportunityId) === opportunityId || item.error),
  );
  // Authorized snapshot data is used only when no opportunity read was attempted; a failed read never falls back.
  const opportunity = opportunityReads.length
    ? opportunityReads.find((item) => !item.error && Number(item.result?.id) === opportunityId)?.result
    : snapshotOpportunityDetail(scopedOpportunity, snapshot);
  if (!opportunity || !scopedOpportunity) {
    return {
      answer:
        "¿Para qué oportunidad quieres preparar la actividad? Necesito verificar su vínculo con esta cuenta.",
      responseType: "clarification",
      operations: [],
      evidence: [],
      pendingItems: ["Oportunidad"],
      confidence: "low",
      activityIntent,
    };
  }
  if (!allowed("oportunidades.update")) {
    return {
      answer:
        "Necesitas permiso para actualizar oportunidades antes de preparar esta actividad vinculada.",
      responseType: "clarification",
      operations: [],
      evidence: [],
      pendingItems: [],
      confidence: "high",
    };
  }
  if (prior && Number(prior.opportunityId) !== opportunityId) {
    return {
      answer:
        "La oportunidad no coincide con el borrador pendiente. Descártalo o identifica la oportunidad original antes de continuar.",
      responseType: "clarification",
      operations: [],
      evidence: [],
      pendingItems: ["Oportunidad"],
      confidence: "low",
    };
  }
  const contactId = Number(scopedOpportunity.contactId || 0) || null;
  const contact = (snapshot.contacts || []).find(
    (item) =>
      Number(item.id) === contactId &&
      Number(item.accountId) === Number(snapshot.account?.id),
  );
  if (
    (!allowed("contactos.read") && !allowed("contactos.read_all")) ||
    !contact ||
    !opportunity.associatedContact
  ) {
    return {
      answer:
        "No pude verificar el contacto asociado a esta oportunidad. Confirma el contacto autorizado antes de preparar la actividad.",
      responseType: "clarification",
      operations: [],
      evidence: [],
      pendingItems: ["Contacto"],
      confidence: "low",
      activityIntent,
    };
  }
  const scheduledAt = draft.scheduledAt || prior?.scheduledAt || "";
  const scheduledDate = new Date(`${scheduledAt}:00Z`);
  const validScheduledAt =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(scheduledAt) &&
    !Number.isNaN(scheduledDate.getTime()) &&
    scheduledDate.toISOString().slice(0, 16) === scheduledAt;
  const operation = normalizeActivityOperation(
    {
      ...prior,
      title:
        pendingActivityIntent?.title ||
        draft.title ||
        prior?.title ||
        `${getCommercialActivityTypeLabel(draft.actionType)} con ${opportunity.associatedContact.name}`,
      actionType: draft.actionType,
      status: timing === "completed" ? "done" : "pending",
      scheduledAt: validScheduledAt ? scheduledAt : "",
      notes: draft.notes || pendingActivityIntent?.notes || prior?.notes || "",
      successCriteria:
        draft.successCriteria ||
        pendingActivityIntent?.successCriteria ||
        prior?.successCriteria ||
        "",
      evidence: [
        {
          sourceType: "opportunity",
          sourceId: opportunityId,
          label: "Oportunidad y contacto asociado verificados",
          excerpt: opportunity.name || scopedOpportunity.name,
        },
      ],
    },
    { opportunityId, accountId: snapshot.account.id, contactId },
  );
  operation.missingFields = validScheduledAt ? [] : ["scheduledAt"];
  const activityLabel = getCommercialActivityTypeLabel(operation.actionType)
    .toLowerCase();
  const timingLabel = timing === "completed" ? "realizada" : "programada";
  const notesLabel = operation.notes ? ` Nota: “${operation.notes}”.` : "";
  return {
    answer: validScheduledAt
      ? `Voy a registrar la ${activityLabel} como ${timingLabel} con ${opportunity.associatedContact.name} para ${scopedOpportunity.name} (${scheduledAt.replace("T", " ")}).${notesLabel} No se ha guardado todavía; revisa y confirma el borrador para guardarlo en Calendario.`
      : timing === "completed"
        ? `¿Qué día y a qué hora ocurrió la ${activityLabel} con ${opportunity.associatedContact.name} para ${scopedOpportunity.name}?${notesLabel} El borrador se registrará como realizada y aún no se ha guardado en Calendario.`
        : /^\d{4}-\d{2}-\d{2}$/.test(draft.temporalPreference || "")
          ? `¿A qué hora del ${draft.temporalPreference} quieres realizar la ${activityLabel} con ${opportunity.associatedContact.name} para ${scopedOpportunity.name}? El borrador se registrará como programada y aún no se ha guardado en Calendario.`
          : `¿Qué día y a qué hora${draft.temporalPreference && !draft.temporalPreference.includes("_") ? ` (${draft.temporalPreference})` : ""} quieres realizar la ${activityLabel} con ${opportunity.associatedContact.name} para ${scopedOpportunity.name}? El borrador se registrará como programada y aún no se ha guardado en Calendario.`,
    responseType: "operation",
    entities: { opportunityId, contactId },
    operations: [operation],
    evidence: [
      "getOpportunity: oportunidad y contacto asociado verificados en esta cuenta.",
    ],
    inferences: [],
    recommendedActions: [],
    pendingItems: validScheduledAt ? [] : ["Fecha y hora"],
    confidence: "high",
    activityDraft: {
      operation,
      timing,
      activityIntent,
      temporalPreference:
        draft.temporalPreference || pendingActivity?.temporalPreference || "",
      action: prior ? "continue" : draft.action,
    },
  };
}
