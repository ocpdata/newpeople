import { resolveCoachEntities } from "../coach/entity-resolver.js";
import { getCustomerServerPolicy, customerSingleTargetClarification } from "../coach/server-policy.js";
import { searchCoachOpportunities } from "../coach/read-tools.js";
import {
  accountRecord,
  formatUsd,
  normalize,
  opportunityRecords,
  permissionGranted,
  scopeCustomerSnapshot,
} from "./customer-chat-records.js";

export function resolveCustomerOpportunity(snapshot, question, routing, businessRules, availableCandidates) {
  const resolution = resolveCoachEntities(
    {
      accounts: accountRecord(snapshot),
      coachOpportunities: availableCandidates || opportunityRecords(snapshot),
    },
    question,
    {},
    { ignoreStageFilters: true },
  );
  if (resolution.opportunity) return resolution.opportunity;
  const policy = getCustomerServerPolicy(businessRules);
  if (resolution.candidates.opportunities.length > 1 && policy.ambiguousTarget === "ask") return null;
  const resolvedId = Number(routing?.serverResolvedEntityIds?.opportunityId || 0);
  const namedReference = String(routing?.entities?.opportunityReference || "").trim();
  const text = normalize(question);
  const genericSelection = /\b(?:esta|esa|la oportunidad seleccionada|la oportunidad actual)\b/.test(text) ||
    !/\boportunidad\b/.test(text) ||
    /\boportunidad(?:\s+(?:a|en|por)\s+\$?\d|\s*[.!?]*$)/.test(text);
  if (!genericSelection) return null;
  if (namedReference && (
    !resolvedId ||
    (!/^opportunity_\d+$/.test(namedReference) &&
      normalize(namedReference) !== normalize(snapshot.selectedOpportunity?.name))
  )) return null;
  if (policy.selectedOpportunityFallback === "require_explicit") {
    return null;
  }
  const selected = snapshot.selectedOpportunity;
  return selected && (availableCandidates || opportunityRecords(snapshot))
    .some((item) => Number(item.id) === Number(selected.id))
    ? selected : null;
}

export function isExplicitCustomerAmountChange(question) {
  const normalizedQuestion = normalize(question);
  return (
    /\b(?:actualiza|actualizar|cambia|cambiar|modifica|modificar|ajusta|ajustar|sube|subir|incrementa|incrementar|reduce|reducir|baja|bajar)\b/.test(
      normalizedQuestion,
    ) && /\b(?:monto|importe)\b/.test(normalizedQuestion)
  );
}

export function isPendingAmountSelectionReply(snapshot, question, pending) {
  if (!pending || !Array.isArray(pending.candidateIds) ||
    Number(pending.accountId) !== Number(snapshot?.account?.id)) return false;
  const words = (text) => normalize(text).replace(/[^a-z0-9]+/g, " ").trim();
  const rawReply = words(question);
  const reply = rawReply
    .replace(/^(?:(?:la|el|oportunidad|selecciona|elige|quiero|solo|solamente|esa|esta|entonces)\s+)+/, "")
    .replace(/\s+por favor$/, "");
  return opportunityRecords(scopeCustomerSnapshot(snapshot || {})).some((item) =>
    pending.candidateIds.includes(Number(item.id)) && words(item.name) &&
    [rawReply, reply].includes(words(item.name)));
}

function buildCustomerEmailDraft(snapshot, question, contactReadAllowed) {
  const contacts =
    contactReadAllowed && Array.isArray(snapshot.contacts)
      ? snapshot.contacts
      : [];
  const normalizedQuestion = normalize(question)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const questionWords = new Set(normalizedQuestion.split(/\s+/));
  const matchingContacts = contacts.filter((contact) => {
    const name = normalize(contact.name).trim();
    const nameWords = name.split(/\s+/).filter(Boolean);
    return (
      (name && normalizedQuestion.includes(name)) ||
      (nameWords.length && questionWords.has(nameWords[0]))
    );
  });
  const selectedContact = snapshot.selectedContext?.contactId
    ? contacts.find(
        (contact) =>
          Number(contact.id) === Number(snapshot.selectedContext.contactId),
      )
    : null;
  const recipient =
    matchingContacts.length === 1 ? matchingContacts[0] : selectedContact;
  const accountName = snapshot.account?.name || "la cuenta";
  const greetingName = recipient?.name?.trim().split(/\s+/)[0] || "";
  const greeting = greetingName ? `Hola ${greetingName},` : "Hola,";
  const subject = `Conversación sobre nuevas oportunidades para ${accountName}`;
  const body = [
    greeting,
    "",
    `Me gustaría coordinar una breve conversación para conocer tus prioridades y explorar nuevas oportunidades en las que podamos apoyar a ${accountName}.`,
    "",
    "¿Tendrías disponibilidad para reunirnos en los próximos días?",
    "",
    "Saludos,",
    "[Tu nombre]",
  ].join("\n");
  return {
    answer: `Borrador de correo${recipient ? ` para ${recipient.name}` : ""}\nAsunto: ${subject}\n\n${body}\n\nNo se envió el correo.`,
    evidence: [
      `Borrador preparado con el nombre de cuenta autorizado: ${accountName}.`,
      ...(recipient
        ? [`Contacto autorizado seleccionado: ${recipient.name}.`]
        : []),
    ],
    inferences: [],
    confidence: recipient ? "high" : "medium",
    recommendedActions: [],
    operations: [],
    source: "account_intelligence",
  };
}

export function buildCustomerIntentResponse({
  snapshot,
  question,
  routing,
  permissions,
  allowedOperationKinds,
  businessRules = {},
  pendingAmountSelection = null,
} = {}) {
  if (routing?.intent === "email_draft") {
    return buildCustomerEmailDraft(
      snapshot || {},
      question || "",
      routing.allowedTools?.includes("searchContacts") === true,
    );
  }
  if (routing?.intent !== "crm_operation") return null;

  const normalizedQuestion = normalize(question);
  const continuingSelection = !isExplicitCustomerAmountChange(question) &&
    isPendingAmountSelectionReply(snapshot, question, pendingAmountSelection);
  if (!/\b(monto|importe)\b/.test(normalizedQuestion) && !continuingSelection) return null;
  const amountMatch = String(question || "").match(
    /\b(?:a|en|por)\s+\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:usd|dolares?)?\b/i,
  );
  const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, "")) :
    continuingSelection ? Number(pendingAmountSelection.amount) : NaN;
  if (!Number.isFinite(amount) || amount < 0) {
    return {
      answer:
        "Indica el nuevo monto como una cantidad numérica para preparar la propuesta. No se modificó el CRM.",
      responseType: "clarification",
      clarification: {
        type: "missing_fields",
        message:
          "Indica el nuevo monto como una cantidad numérica para preparar la propuesta.",
        missing: ["Nuevo monto"],
      },
      evidence: [],
      inferences: [],
      confidence: "medium",
      recommendedActions: [],
      operations: [],
      source: "account_intelligence",
    };
  }
  if (!permissionGranted(permissions, "oportunidades.update")) {
    return {
      answer:
        "No tienes permiso para preparar cambios en oportunidades. No se modificó el CRM.",
      responseType: "clarification",
      evidence: [],
      inferences: [],
      confidence: "high",
      recommendedActions: [],
      operations: [],
      source: "account_intelligence",
    };
  }
  if (businessRules.scope?.opportunitySearchAllowed === false) {
    return {
      answer: "La consulta de oportunidades está deshabilitada para este canal. No se creó una propuesta.",
      responseType: "clarification", operations: [], evidence: [], inferences: [],
      clarification: {
        type: "missing_fields", ruleId: "opportunitySearchAllowed",
        message: "La consulta de oportunidades está deshabilitada para este canal.",
      },
    };
  }
  if (
    Array.isArray(allowedOperationKinds) &&
    !allowedOperationKinds.includes("opportunity_field")
  ) {
    return {
      answer:
        'La política de Cliente existente no permite cambios en campos de oportunidad. Un administrador debe habilitar "Campo de oportunidad" en Administración de Mi Coach > Reglas del servidor. No se creó una propuesta ni se modificó el CRM.',
      responseType: "clarification",
      clarification: {
        type: "missing_fields",
        message:
          'Un administrador debe habilitar "Campo de oportunidad" en las reglas de Cliente existente.',
        missing: ["Permiso de política para opportunity_field"],
      },
      evidence: [],
      inferences: [],
      confidence: "high",
      recommendedActions: [],
      operations: [],
      source: "account_intelligence",
    };
  }
  const scoped = scopeCustomerSnapshot(snapshot || {});
  const filters = continuingSelection ? pendingAmountSelection.filters : routing?.filters || {};
  const status = filters?.opportunityStatus;
  const openOnly = status === "open" || /\babiertas?\b/.test(normalizedQuestion);
  const opportunities = searchCoachOpportunities({
    coachOpportunities: opportunityRecords(scoped),
  }, {
    accountId: scoped.account?.id,
    openOnly,
    activeOnly: openOnly,
    commercialStatusCodes: openOnly ? ["en_proceso"] :
      status === "historical" ? ["ganada", "perdida", "anulada"] : [],
    stageCodes: filters?.stageCode ? [filters.stageCode] : [],
    closeYear: filters?.closeYear,
  }).filter((item) => !continuingSelection ||
    pendingAmountSelection.candidateIds.includes(Number(item.id)));
  const multiple = customerSingleTargetClarification(question, routing, businessRules);
  const opportunity = multiple ? null : resolveCustomerOpportunity(
    scoped, question || "", routing,
    continuingSelection ? {
      ...businessRules,
      serverPolicy: { ...businessRules.serverPolicy, selectedOpportunityFallback: "require_explicit" },
    } : businessRules,
    opportunities,
  );
  if (!opportunity) {
    const message = multiple?.message ||
      "No pude identificar una única oportunidad de esta cuenta. Selecciónala o indica su nombre para preparar el cambio.";
    return {
      answer: `${message} No se modificó el CRM.`,
      responseType: "clarification",
      clarification: {
        type: "select_opportunity",
        message,
        missing: ["Oportunidad única"],
        candidates: opportunities.map((item) => ({
          id: Number(item.id), name: item.name, entityType: "opportunity",
        })),
        ruleId: multiple?.ruleId || "ambiguous-target",
        pendingAmountSelection: {
          accountId: Number(scoped.account?.id), amount,
          candidateIds: opportunities.map((item) => Number(item.id)),
          filters: {
            ...filters,
            ...(/\babiertas?\b/.test(normalizedQuestion) ? { opportunityStatus: "open" } : {}),
          },
        },
      },
      evidence: [],
      inferences: [],
      confidence: "medium",
      recommendedActions: [],
      operations: [],
      source: "account_intelligence",
    };
  }

  const currentValue = Number(opportunity.amountUsd || 0);
  const operation = {
    kind: "opportunity_field",
    title: `Actualizar monto de ${opportunity.name || "la oportunidad"}`,
    opportunityId: Number(opportunity.id),
    field: "amountUsd",
    currentValue,
    value: amount,
    sourceChannel: "customer_account",
    requiresConfirmation: true,
    evidence: [
      {
        sourceType: "opportunity",
        sourceId: Number(opportunity.id),
        label: `Oportunidad CRM: ${opportunity.name || opportunity.id}`,
        excerpt: `Monto actual: ${formatUsd(currentValue)}.`,
      },
    ],
    source: { type: "opportunity", id: Number(opportunity.id) },
  };
  return {
    answer: `Preparé una propuesta para cambiar el monto de ${opportunity.name || "la oportunidad"} de ${formatUsd(currentValue)} a ${formatUsd(amount)}. Requiere tu confirmación; todavía no se modificó el CRM.`,
    evidence: [
      `Oportunidad CRM ${opportunity.name || opportunity.id}; monto actual ${formatUsd(currentValue)}.`,
    ],
    inferences: [],
    confidence: "high",
    recommendedActions: [],
    operations: [operation],
    amountSelectionCompleted: continuingSelection,
    source: "account_intelligence",
  };
}
