import { normalizeSearchText } from "./common.js";

const CONTEXT_SUPPORTED_ENTITY_TYPES = new Set([
  "account",
  "contact",
  "opportunity",
]);

const ENTITY_DOMAIN_MAP = {
  account: "accounts",
  contact: "contacts",
  opportunity: "opportunities",
};

export function normalizeChatbotActiveEntity(contextSnapshot) {
  const activeEntity =
    contextSnapshot && typeof contextSnapshot === "object"
      ? contextSnapshot.activeEntity
      : null;
  if (!activeEntity || typeof activeEntity !== "object") {
    return null;
  }

  const type = String(activeEntity.type || "")
    .trim()
    .toLowerCase();
  const id = Number(activeEntity.id || 0);
  const name = String(activeEntity.name || "").trim();
  if (
    !CONTEXT_SUPPORTED_ENTITY_TYPES.has(type) ||
    !Number.isInteger(id) ||
    id <= 0
  ) {
    return null;
  }

  return {
    type,
    id,
    name,
    surface: String(contextSnapshot?.surface || "")
      .trim()
      .toLowerCase(),
    viewType: String(contextSnapshot?.viewType || "")
      .trim()
      .toLowerCase(),
  };
}

export function mergeRequestedDomainsForEntity(requestedDomains, entityType) {
  const normalized = Array.isArray(requestedDomains)
    ? [...requestedDomains]
    : [];
  const baseDomain =
    ENTITY_DOMAIN_MAP[
      String(entityType || "")
        .trim()
        .toLowerCase()
    ];
  if (baseDomain && !normalized.includes(baseDomain)) {
    normalized.unshift(baseDomain);
  }
  return [...new Set(normalized)];
}

export function isContextualChatbotPrompt(prompt, contextSnapshot) {
  const text = normalizeSearchText(prompt);
  if (!text) return false;

  const hasDeicticReference =
    /\b(esta|este|esto|aqui|actual|visible|mostrada|mostrado|pantalla)\b/.test(
      text,
    ) ||
    /\b(esta oportunidad|esta cuenta|este contacto|esta cotizacion|esta propuesta|lo que estoy viendo)\b/.test(
      text,
    );

  if (hasDeicticReference) {
    return true;
  }

  const activeEntity = normalizeChatbotActiveEntity(contextSnapshot);
  if (!activeEntity) {
    return false;
  }

  const isFocusedSurface =
    activeEntity.viewType.includes("modal") ||
    activeEntity.surface.includes("modal") ||
    activeEntity.surface.includes("detail") ||
    activeEntity.surface.includes("workspace");

  if (!isFocusedSurface) {
    return false;
  }

  return /\b(estrategia|venta|cerrar|cierre|siguiente paso|riesgo|explicacion|explica|resumen|resume|estatus|avance|mejor explicacion|que sigue)\b/.test(
    text,
  );
}

export function buildDirectResolverFromContext(plannerOutput, contextSnapshot) {
  const activeEntity = normalizeChatbotActiveEntity(contextSnapshot);
  if (!activeEntity) {
    return null;
  }

  if (String(plannerOutput?.targetEntityType || "") !== activeEntity.type) {
    return null;
  }

  return {
    resolutionStatus: "resolved",
    selectedEntityType: activeEntity.type,
    selectedEntityId: activeEntity.id,
    confidence: 0.99,
    clarificationNeeded: false,
    clarificationQuestion: "",
  };
}
