import { filterValidCoachOperations } from "../coach/contract.js";
import { normalizeActivityOperation } from "../coach/operation-contract.js";
import { opportunityRecords, permissionGranted } from "./customer-chat-records.js";

export function normalizeCustomerOperations(
  operations,
  snapshot,
  context,
  permissions = new Set(),
) {
  const accountId = Number(snapshot?.account?.id || context.accountId || 0);
  const contactIds = new Set(
    (snapshot?.contacts || []).map((item) => Number(item.id)).filter(Boolean),
  );
  const opportunityIds = new Set(
    [
      ...(snapshot?.opportunities || []),
      ...(snapshot?.inactiveOpportunities || []),
      ...(snapshot?.selectedOpportunity ? [snapshot.selectedOpportunity] : []),
    ]
      .filter((item) => Number(item.accountId || accountId) === accountId)
      .map((item) => Number(item.id))
      .filter(Boolean),
  );
  const interactionIds = new Set(
    (snapshot?.interactions || [])
      .map((item) => Number(item.id))
      .filter(Boolean),
  );
  const candidates = (Array.isArray(operations) ? operations : []).map(
    (item) => {
      const operation = {
        ...item,
        sourceChannel: "customer_account",
        requiresConfirmation: true,
      };
      if (
        [
          "activity",
          "stage_answer",
          "opportunity_field",
          "link_contact_to_opportunity",
        ].includes(operation.kind)
      ) {
        operation.opportunityId =
          Number(operation.opportunityId || context.opportunityId || 0) || null;
      }
      if (operation.kind === "account_field") {
        operation.accountId = Number(operation.accountId || accountId) || null;
      }
      if (operation.kind === "contact_field") {
        operation.contactId =
          Number(operation.contactId || context.contactId || 0) || null;
      }
      if (operation.kind === "create_opportunity") {
        const sourcePayload =
          operation.payload &&
          typeof operation.payload === "object" &&
          !Array.isArray(operation.payload)
            ? operation.payload
            : {};
        const proposedAccountId = Number(
          operation.accountId || sourcePayload.accountId || accountId,
        );
        const contactId =
          Number(operation.contactId || sourcePayload.contactId || 0) || null;
        if (
          proposedAccountId !== accountId ||
          (sourcePayload.accountId &&
            Number(sourcePayload.accountId) !== accountId) ||
          (operation.contactId &&
            sourcePayload.contactId &&
            Number(operation.contactId) !== Number(sourcePayload.contactId)) ||
          (contactId && !contactIds.has(contactId))
        ) {
          return null;
        }
        const payload = { accountId };
        const name = String(sourcePayload.name || operation.name || "")
          .trim()
          .slice(0, 180);
        if (name) payload.name = name;
        if (sourcePayload.amountUsd !== undefined) {
          const amountUsd = Number(sourcePayload.amountUsd);
          if (Number.isFinite(amountUsd) && amountUsd >= 0) {
            payload.amountUsd = amountUsd;
          }
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(sourcePayload.closeDate || ""))) {
          payload.closeDate = String(sourcePayload.closeDate);
        }
        if (contactId) payload.contactId = contactId;
        return {
          kind: "create_opportunity",
          title: String(
            operation.title || `Crear oportunidad${name ? ` ${name}` : ""}`,
          )
            .trim()
            .slice(0, 300),
          evidence: [],
          missingFields: Array.isArray(operation.missingFields)
            ? operation.missingFields
                .map((field) =>
                  String(field || "")
                    .trim()
                    .slice(0, 120),
                )
                .filter(Boolean)
                .slice(0, 30)
            : [],
          requiresConfirmation: true,
          sourceChannel: "customer_account",
          targetModule: "opportunities",
          payload,
          accountId,
          contactId,
          opportunityId: null,
          interactionId: null,
          quotationVersionId: null,
          source: { type: "account", id: accountId },
        };
      }
      if (operation.kind === "link_contact_to_opportunity") {
        const opportunityId = Number(operation.opportunityId || 0) || null;
        const contactId = Number(operation.contactId || 0) || null;
        if (
          !opportunityIds.has(opportunityId) ||
          !contactIds.has(contactId) ||
          (operation.accountId && Number(operation.accountId) !== accountId)
        ) {
          return null;
        }
        return {
          kind: "link_contact_to_opportunity",
          title: String(operation.title || "Vincular contacto a oportunidad")
            .trim()
            .slice(0, 300),
          evidence: [],
          missingFields: [],
          requiresConfirmation: true,
          sourceChannel: "customer_account",
          targetModule: "opportunities",
          payload: { accountId, contactId },
          accountId,
          contactId,
          opportunityId,
          interactionId: null,
          quotationVersionId: null,
          source: { type: "opportunity", id: opportunityId },
        };
      }
      if (operation.kind === "opportunity_note") {
        const opportunityId = Number(operation.opportunityId || 0) || null;
        const noteText = String(operation.noteText || "").trim().slice(0, 4000);
        if (
          !opportunityIds.has(opportunityId) ||
          Number(operation.accountId || accountId) !== accountId ||
          !noteText
        ) {
          return null;
        }
        return {
          kind: "opportunity_note",
          title: String(operation.title || "Registrar nota en oportunidad")
            .trim()
            .slice(0, 300),
          evidence: [],
          missingFields: [],
          requiresConfirmation: true,
          sourceChannel: "customer_account",
          accountId,
          opportunityId,
          noteText,
          sourceType: "chat_report",
          attribution: operation.attribution,
          certainty: operation.certainty,
          entityType: "opportunity",
          source: { type: "opportunity", id: opportunityId },
        };
      }
      if (operation.kind === "create_contact") {
        const proposedAccountId = Number(
          operation.accountId || operation.payload?.accountId || 0,
        );
        if (proposedAccountId && proposedAccountId !== accountId) return null;
        const sourcePayload =
          operation.payload &&
          typeof operation.payload === "object" &&
          !Array.isArray(operation.payload)
            ? operation.payload
            : {};
        const contactFields = [
          "firstName",
          "lastName",
          "positionTitle",
          "email",
          "phone",
          "mobile",
          "department",
          "city",
          "stateRegion",
        ];
        return {
          kind: "create_contact",
          title: String(operation.title || "Crear contacto")
            .trim()
            .slice(0, 300),
          evidence: [],
          missingFields: Array.isArray(operation.missingFields)
            ? operation.missingFields
                .map((field) =>
                  String(field || "")
                    .trim()
                    .slice(0, 120),
                )
                .filter(Boolean)
                .slice(0, 30)
            : [],
          requiresConfirmation: true,
          sourceChannel: "customer_account",
          targetModule: "contacts",
          payload: {
            ...Object.fromEntries(
              contactFields
                .filter((field) => sourcePayload[field] !== undefined)
                .map((field) => [
                  field,
                  String(sourcePayload[field] || "")
                    .trim()
                    .slice(0, 500),
                ]),
            ),
            accountId,
          },
          accountId,
          contactId: null,
          opportunityId: null,
          interactionId: null,
          quotationVersionId: null,
        };
      } else delete operation.payload;
      return operation;
    },
  );
  return filterValidCoachOperations(candidates).filter((operation) => {
    if (operation.kind === "account_field")
      return Number(operation.accountId) === accountId;
    if (operation.kind === "contact_field")
      return contactIds.has(Number(operation.contactId));
    if (operation.kind === "create_contact") {
      const canCreateContact =
        permissionGranted(permissions, "contactos.create") ||
        permissionGranted(permissions, "contactos.request");
      return (
        accountId > 0 &&
        Number(operation.accountId) === accountId &&
        canCreateContact
      );
    }
    if (operation.kind === "create_opportunity") {
      const canCreateOpportunity =
        permissionGranted(permissions, "oportunidades.create") ||
        permissionGranted(permissions, "oportunidades.request");
      return (
        accountId > 0 &&
        Number(operation.accountId) === accountId &&
        canCreateOpportunity
      );
    }
    if (operation.kind === "link_contact_to_opportunity") {
      const canUpdateOpportunity = permissionGranted(
        permissions,
        "oportunidades.update",
      );
      const canReadContact =
        permissionGranted(permissions, "contactos.read") ||
        permissionGranted(permissions, "contactos.read_all");
      return (
        Number(operation.accountId) === accountId &&
        opportunityIds.has(Number(operation.opportunityId)) &&
        contactIds.has(Number(operation.contactId)) &&
        canUpdateOpportunity &&
        canReadContact
      );
    }
    if (operation.kind === "opportunity_note")
      return (
        Number(operation.accountId) === accountId &&
        opportunityIds.has(Number(operation.opportunityId)) &&
        permissionGranted(permissions, "oportunidades.update") &&
        permissionGranted(permissions, "mi_coach.execute")
      );
    if (
      ["activity", "stage_answer", "opportunity_field"].includes(operation.kind)
    )
      return opportunityIds.has(Number(operation.opportunityId));
    if (operation.kind === "lead_call_outcome")
      return interactionIds.has(Number(operation.interactionId));
    return false;
  });
}

export function normalizeCustomerResponse(
  result,
  snapshot,
  question,
  context,
  permissions = new Set(),
) {
  const original = result || {};
  const normalizedQuestion = String(question || "").normalize("NFD")
    .replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es");
  const sendsExternalCommunication =
    /\b(?:envia|enviale|mand(a|ale)|mandame)\b[\s\S]{0,120}\b(?:correo|email|whats?app|mensaje|sms)\b/i
      .test(normalizedQuestion) ||
    /\b(?:correo|email|whats?app|mensaje|sms)\b[\s\S]{0,80}\b(?:envia|manda)\b/i
      .test(normalizedQuestion);
  const cancelsActivity =
    /\b(?:cancela(?:r)?|anula(?:r)?|elimina(?:r)?|borra(?:r)?)\b[\s\S]{0,80}\b(?:actividad|llamada|reunion|cita|evento)\b/i
      .test(normalizedQuestion);
  const requestsContactCreation =
    /\b(?:crear?|crea|agrega|anade|registra|dar de alta)\s+(?:un|una|el|la)?\s*(?:nuevo|nueva)?\s*contacto\b/i
      .test(normalizedQuestion) ||
    /\bcontacto\s+nuevo\b/i.test(normalizedQuestion) &&
      /\b(?:crear?|crea|agrega|anade|registra|dar de alta)\b/i.test(normalizedQuestion);
  const requestsOpportunityCreation =
    /\b(?:crear?|crea|agrega|anade|registra|dar de alta)\s+(?:un|una|la)?\s*(?:nuevo|nueva)?\s*(?:oportunidad|negocio)\b/i
      .test(normalizedQuestion) ||
    /\b(?:oportunidad|negocio)\s+nuev[oa]\b/i.test(normalizedQuestion) &&
      /\b(?:crear?|crea|agrega|anade|registra|dar de alta)\b/i.test(normalizedQuestion);
  const mismatchedCreation =
    !(requestsContactCreation && requestsOpportunityCreation) &&
    ((requestsContactCreation && (original.operations || []).some((operation) => operation?.kind === "create_opportunity")) ||
      (requestsOpportunityCreation && (original.operations || []).some((operation) => operation?.kind === "create_contact")));
  const blockedAnswer = sendsExternalCommunication
    ? "No puedo enviar correos ni mensajes desde este chat. No se envió ninguna comunicación. Si quieres, puedo preparar un borrador para que lo revises y lo envíes por tu canal habitual."
    : cancelsActivity
      ? "No puedo cancelar actividades desde este chat. No se canceló ni reprogramó ninguna actividad."
      : mismatchedCreation
        ? `Pediste crear ${requestsContactCreation ? "un contacto" : "una oportunidad"}, pero la respuesta intentaba crear ${requestsContactCreation ? "una oportunidad" : "un contacto"}. No preparé ningún registro. Confirma los datos del registro solicitado para continuar.`
        : null;
  const normalized = blockedAnswer
    ? {
        ...original,
        answer: blockedAnswer,
        responseType: "informational",
        operations: [],
        recommendedActions: [],
        activityDraft: null,
        activityDraftDiscarded: false,
        stageAnswerPrefill: null,
      }
    : original;
  const recommendedActions = Array.isArray(normalized.recommendedActions)
    ? normalized.recommendedActions
        .map((action) => ({
          ...action,
          opportunityId: Number(action.opportunityId || 0) || null,
          requiresConfirmation: true,
        }))
        .slice(0, 5)
    : [];
  const operations = normalizeCustomerOperations(
    normalized.operations,
    snapshot,
    context,
    permissions,
  );
  const publicSources = Array.isArray(normalized.publicSources)
    ? normalized.publicSources
        .map((source) => {
          const rawUrl = String(source?.url || source?.sourceUrl || "").trim();
          try {
            const parsedUrl = new URL(rawUrl);
            if (!["http:", "https:"].includes(parsedUrl.protocol)) return null;
            return {
              title: String(source.title || parsedUrl.hostname).slice(0, 200),
              url: parsedUrl.href,
              sourceUrl: parsedUrl.href,
              domain: parsedUrl.hostname,
              sourceDomain: "public_web",
              confidence: source.confidence || "low",
              certainty: source.certainty || "evidenced",
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .slice(0, 24)
    : [];
  const rawStageAnswerPrefill = normalized.stageAnswerPrefill;
  const stageAnswerOpportunityId = Number(
    rawStageAnswerPrefill?.opportunityId || 0,
  );
  const stageAnswerQuestionIds = [
    ...new Set(
      (Array.isArray(rawStageAnswerPrefill?.questionIds)
        ? rawStageAnswerPrefill.questionIds
        : []
      )
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ].slice(0, 8);
  const stageAnswerOpportunityIsInScope = opportunityRecords(snapshot).some(
    (opportunity) =>
      Number(opportunity.id) === stageAnswerOpportunityId &&
      Number(opportunity.accountId || snapshot.account?.id) ===
        Number(snapshot.account?.id),
  );
  const stageAnswerPrefill =
    stageAnswerOpportunityIsInScope &&
    stageAnswerQuestionIds.length &&
    String(rawStageAnswerPrefill?.appendText || "").trim()
      ? {
          opportunityId: stageAnswerOpportunityId,
          questionIds: stageAnswerQuestionIds,
          questionPrompts: Array.isArray(rawStageAnswerPrefill.questionPrompts)
            ? rawStageAnswerPrefill.questionPrompts
                .map((prompt) => String(prompt || "").trim().slice(0, 500))
                .filter(Boolean)
                .slice(0, 8)
            : [],
          appendText: String(rawStageAnswerPrefill.appendText).trim().slice(0, 4000),
        }
      : null;
  for (const operation of operations) {
    if (operation.kind !== "activity") continue;
    if (
      !recommendedActions.some(
        (action) =>
          Number(action.opportunityId || 0) ===
            Number(operation.opportunityId || 0) &&
          action.title === operation.title,
      )
    ) {
      recommendedActions.push({
        title: operation.title,
        opportunityId: operation.opportunityId,
        actionType: operation.actionType,
        notes: operation.notes,
        successCriteria: operation.successCriteria,
        dueDate: operation.dueDate,
        scheduledAt: operation.scheduledAt,
        evidence: operation.evidence,
      });
    }
  }
  for (const action of recommendedActions) {
    const activity = normalizeActivityOperation(action, context);
    if (
      activity.opportunityId &&
      !operations.some(
        (operation) =>
          operation.kind === "activity" &&
          Number(operation.opportunityId) === Number(activity.opportunityId) &&
          operation.title === activity.title,
      )
    ) {
      operations.push(activity);
    }
  }
  return {
    answer: String(
      normalized.answer || "No fue posible responder la pregunta.",
    ),
    responseType: normalized.responseType || "informational",
    ...(["user_provided", "mixed_document", "knowledge_library", "mixed_knowledge"].includes(normalized.contentSource)
      ? { contentSource: normalized.contentSource } : {}),
    evidence: Array.isArray(normalized.evidence) ? normalized.evidence : [],
    inferences: Array.isArray(normalized.inferences)
      ? normalized.inferences
      : [],
    pendingItems: Array.isArray(normalized.pendingItems)
      ? normalized.pendingItems
          .map((item) =>
            String(item || "")
              .trim()
              .slice(0, 500),
          )
          .filter(Boolean)
          .slice(0, 8)
      : [],
    confidence: ["high", "medium", "low"].includes(normalized.confidence)
      ? normalized.confidence
      : "low",
    recommendedActions: normalized.activityDraft ? [] : recommendedActions,
    publicSources,
    activityHistory: normalized.activityHistory || null,
    ...(normalized.activityDraft
      ? { activityDraft: normalized.activityDraft }
      : {}),
    ...(normalized.activityDraftDiscarded
      ? { activityDraftDiscarded: true }
      : {}),
    ...(stageAnswerPrefill ? { stageAnswerPrefill } : {}),
    ...(Array.isArray(normalized.documentReportCandidates) && normalized.documentReportCandidates.length <= 100 &&
      normalized.documentReportCandidates.every((id) => Number.isSafeInteger(id) && id > 0)
      ? { documentReportCandidates: [...new Set(normalized.documentReportCandidates)] } : {}),
    source: "account_intelligence",
    entities: {
      accountId: context.accountId || null,
      opportunityId:
        Number(
          normalized.entities?.opportunityId || context.opportunityId || 0,
        ) || null,
      contactId:
        Number(normalized.entities?.contactId || context.contactId || 0) ||
        null,
      leadId: null,
      names: [],
    },
    operations,
    clarification: normalized.clarification || null,
  };
}
