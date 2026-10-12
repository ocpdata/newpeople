function normalizeCoachText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function classifyB3(message = "", context = {}) {
  const text = normalizeCoachText(message);

  if (!text) {
    return {
      bucket: "unknown",
      confidence: 0.2,
      signals: [],
      needsClarification: true,
      riskLevel: "low",
      interactionBias: "clarification",
    };
  }

  const operationSignals =
    /\b(actualiza|actualizar|agendar|crear|cambiar|modificar|registra|registrar|vincula|vincular|envia|enviar|confirma|confirmar|asocia|asociar)\b/.test(
      text,
    );
  const coachingSignals =
    /\b(desempeño|performance|prioriz|recomend|suger|deberia|mejorar|aprovech|oportunidad|riesgo|cuenta grande|cuenta más grande)\b/.test(
      text,
    );
  const deepExplorationSignals =
    /\b(historial completo|detalle completo|explora a fondo|resumen completo|todos los|todo el detalle|investiga a fondo|lista completa)\b/.test(
      text,
    );
  const accountQuerySignals =
    /\b(cuenta|cuentas|resumen de la cuenta|que cuenta es|datos de la cuenta)\b/.test(
      text,
    );

  if (operationSignals) {
    return {
      bucket: "operation",
      confidence: 0.82,
      signals: ["operation request"],
      needsClarification: false,
      riskLevel: "medium",
      interactionBias: "operation",
    };
  }

  if (deepExplorationSignals) {
    return {
      bucket: "deep_exploration",
      confidence: 0.78,
      signals: ["exploration request"],
      needsClarification: false,
      riskLevel: "low",
      interactionBias: "deep_exploration",
    };
  }

  if (coachingSignals) {
    return {
      bucket: "coaching",
      confidence: 0.85,
      signals: ["seller coaching request"],
      needsClarification: false,
      riskLevel: "low",
      interactionBias: "coaching",
    };
  }

  if (accountQuerySignals) {
    return {
      bucket: "brief_context",
      confidence: 0.74,
      signals: ["context lookup"],
      needsClarification: false,
      riskLevel: "low",
      interactionBias: "brief_context",
    };
  }

  return {
    bucket: "unknown",
    confidence: 0.45,
    signals: ["generic question"],
    needsClarification: true,
    riskLevel: "low",
    interactionBias: "clarification",
  };
}
