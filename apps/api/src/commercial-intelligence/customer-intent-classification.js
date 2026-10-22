function normalizeQuestion(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isGeneralCustomerSalesProcessQuestion(question = "") {
  const text = normalizeQuestion(question);
  return /\b(?:como es|cual es|explica|describe|que etapas tiene)\b[\s\S]{0,80}\b(?:proceso de ventas?|proceso comercial|metodologia de ventas?)\b/
    .test(text) &&
    !/\b(?:esta|la)\s+(?:cuenta|oportunidad|cotizacion)\b|\bpara\s+(?:esta|la)\s+(?:cuenta|oportunidad)\b/
      .test(text);
}

const EMAIL_CONTENT_PATTERN = /\b(correo|email|mail)\b/;
const DRAFT_CONTENT_PATTERN =
  /\b(correo|email|mail|mensaje|documento|archivo|resumen|texto|guion|plantilla)\b/;
const DRAFT_REQUEST_PATTERN =
  /\b(ayudame a (?:escribir|redactar)|(?:escribe|escribir|redacta|redactar|redactame|redactarme|prepara|preparar|crea|crear|arma|armar|haz|modelo de|borrador de)\b)/;
const EXPLICIT_OPERATION_PATTERN =
  /\b(agenda|agendar|programa|programar|registra|registrar|crea|crear|actualiza|actualizar|modifica|modificar|cambia|cambiar|vincula|vincular|elimina|eliminar|borra|borrar)\b/;
const SEPARATE_OPERATION_PATTERN =
  /\b(?:y|tambien|ademas)\s+(?:agenda|agendar|programa|programar|registra|registrar|crea|crear|actualiza|actualizar|modifica|modificar|cambia|cambiar|vincula|vincular|elimina|eliminar|borra|borrar)\b/;

export function classifyCustomerRequestB3(question = "") {
  const text = normalizeQuestion(question);
  if (!text) {
    return {
      bucket: "unknown",
      confidence: 0.2,
      signals: [],
    };
  }

  const requestsContentDraft =
    DRAFT_CONTENT_PATTERN.test(text) && DRAFT_REQUEST_PATTERN.test(text);
  if (requestsContentDraft && SEPARATE_OPERATION_PATTERN.test(text)) {
    return {
      bucket: "mixed_request",
      confidence: 0.95,
      signals: ["email_draft_request", "separate_operation_request"],
    };
  }
  if (requestsContentDraft) {
    return {
      bucket: "content_draft",
      confidence: 0.98,
      contentKind: EMAIL_CONTENT_PATTERN.test(text) ? "email" : "other",
      signals: [
        EMAIL_CONTENT_PATTERN.test(text)
          ? "email_draft_request"
          : "content_draft_request",
      ],
    };
  }
  if (EXPLICIT_OPERATION_PATTERN.test(text)) {
    return {
      bucket: "operation_request",
      confidence: 0.85,
      signals: ["explicit_operation_request"],
    };
  }
  return {
    bucket: "unknown",
    confidence: 0.45,
    signals: [],
  };
}

export function resolveCustomerIntentB3({
  preDecision,
  semanticDecision,
  availableIntents = [],
} = {}) {
  const enabledIntents = new Set(
    (Array.isArray(availableIntents) ? availableIntents : [])
      .filter((item) => item?.enabled !== false)
      .map((item) => String(item?.code || "")),
  );
  const semanticIntent = String(semanticDecision?.intent || "clarify_needed");
  const clarification = (reason, question, resolver, confidence = 0.95) => ({
    intent: "clarify_needed",
    confidence,
    reason,
    clarificationQuestion: question,
    requiresClarification: true,
    source: {
      preclassifierBucket: preDecision?.bucket || "unknown",
      semanticIntent,
      resolver,
    },
  });

  if (preDecision?.bucket === "mixed_request") {
    return clarification(
      "mixed_content_and_operation_request",
      "¿Quieres solo el borrador, agendar la reunión o ambas cosas?",
      "strong_conflict",
      preDecision.confidence,
    );
  }

  if (preDecision?.bucket === "content_draft") {
    if (preDecision.contentKind === "email" && enabledIntents.has("email_draft")) {
      return {
        intent: "email_draft",
        confidence: preDecision.confidence,
        reason:
          semanticIntent === "crm_operation"
            ? "explicit_draft_request_overrode_operation_inference"
            : "explicit_email_draft_request",
        clarificationQuestion: "",
        requiresClarification: false,
        source: {
          preclassifierBucket: preDecision.bucket,
          semanticIntent,
          resolver: "deterministic_draft_request",
        },
      };
    }
    if (semanticIntent === "crm_operation" || semanticIntent === "email_draft") {
      return clarification(
        "content_draft_vs_operation_conflict",
        "¿Quieres preparar ese contenido o ejecutar la operación del CRM/Calendario?",
        "strong_conflict",
        preDecision.confidence,
      );
    }
    return {
      ...semanticDecision,
      source: {
        preclassifierBucket: preDecision.bucket,
        semanticIntent,
        resolver: "semantic_intent",
      },
    };
  }

  if (
    preDecision?.bucket === "operation_request" &&
    semanticIntent === "email_draft"
  ) {
    return clarification(
      "operation_vs_draft_conflict",
      "¿Quieres que redacte el correo o que programe una acción en Calendario?",
      "strong_conflict",
      preDecision.confidence,
    );
  }

  if (semanticDecision?.requiresClarification || semanticIntent === "clarify_needed") {
    return clarification(
      semanticDecision?.reason || "semantic_intent_uncertain",
      semanticDecision?.clarificationQuestion ||
        "¿Quieres consultar la cuenta o preparar una operación en CRM/Calendario?",
      "semantic_clarification",
      semanticDecision?.confidence || 0,
    );
  }

  if (!enabledIntents.has(semanticIntent)) {
    return clarification(
      "semantic_intent_disabled",
      "No pude resolver la solicitud dentro de las capacidades de este canal.",
      "intent_allowlist",
    );
  }

  return {
    ...semanticDecision,
    source: {
      preclassifierBucket: preDecision?.bucket || "unknown",
      semanticIntent,
      resolver: "semantic_intent",
    },
  };
}