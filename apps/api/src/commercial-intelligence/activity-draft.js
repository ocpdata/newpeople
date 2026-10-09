import { normalizeActivityOperation } from "../coach/operation-contract.js";
import { getCommercialActivityTypeLabel } from "../../../../shared/commercial-activity-types.js";

export function buildCustomerActivityDraftResponse({
  routing,
  readToolResults,
  snapshot,
  permissions,
  pendingActivity = null,
}) {
  const draft = routing?.activityDraft;
  if (
    !draft ||
    !["prepare", "continue", "discard"].includes(draft.action) ||
    routing.mode !== "operation" ||
    routing.requiresClarification ||
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
  const opportunityId = Number(
    routing.serverResolvedEntityIds?.opportunityId || 0,
  );
  const opportunity = readToolResults.find(
    (item) =>
      item.toolName === "getOpportunity" &&
      !item.error &&
      Number(item.result?.id) === opportunityId,
  )?.result;
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
  if (!opportunity || !scopedOpportunity) {
    return {
      answer:
        "¿Para qué oportunidad quieres preparar la actividad? Necesito verificar su vínculo con esta cuenta.",
      responseType: "clarification",
      operations: [],
      evidence: [],
      pendingItems: ["Oportunidad"],
      confidence: "low",
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
  const prior = pendingActivity?.operation || null;
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
        draft.title ||
        prior?.title ||
        `${getCommercialActivityTypeLabel(draft.actionType)} con ${opportunity.associatedContact.name}`,
      actionType: draft.actionType,
      scheduledAt: validScheduledAt ? scheduledAt : "",
      notes: draft.notes || prior?.notes || "",
      successCriteria: draft.successCriteria || prior?.successCriteria || "",
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
  return {
    answer: validScheduledAt
      ? `El borrador de ${getCommercialActivityTypeLabel(operation.actionType).toLowerCase()} con ${opportunity.associatedContact.name} para ${scopedOpportunity.name} está listo para revisar en Calendario (${scheduledAt.replace("T", " ")}). No se ha guardado ni confirmado con el contacto.`
      : `¿Qué día y a qué hora${draft.temporalPreference && !draft.temporalPreference.includes("_") ? ` (${draft.temporalPreference})` : ""} quieres realizar la ${getCommercialActivityTypeLabel(operation.actionType).toLowerCase()} con ${opportunity.associatedContact.name} para ${scopedOpportunity.name}? El borrador no se ha guardado en Calendario.`,
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
      temporalPreference:
        draft.temporalPreference || pendingActivity?.temporalPreference || "",
      action: prior ? "continue" : draft.action,
    },
  };
}
