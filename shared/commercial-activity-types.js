export const COMMERCIAL_ACTIVITY_TYPES = [
  { value: "call", label: "Llamada" },
  { value: "meeting_in_person", label: "Reunión presencial" },
  { value: "meeting_virtual", label: "Reunión virtual" },
  { value: "presentation", label: "Presentación" },
  { value: "demo", label: "Demostración" },
  { value: "visit", label: "Visita" },
  { value: "send_email", label: "Correo" },
  { value: "proposal", label: "Propuesta" },
  { value: "event", label: "Evento" },
  { value: "other", label: "Otro" },
];

export const COMMERCIAL_ACTIVITY_TYPE_LABELS = Object.freeze(
  Object.fromEntries(
    COMMERCIAL_ACTIVITY_TYPES.map(({ value, label }) => [value, label]),
  ),
);

const LEGACY_ACTIVITY_TYPE_ALIASES = Object.freeze({
  conference: "meeting_virtual",
  meeting: "meeting_virtual",
  demo: "demo",
  quotation: "proposal",
  prepare_proposal: "proposal",
  next_step: "other",
  follow_up: "other",
  waiting_customer: "other",
  negotiation: "other",
});

export function normalizeCommercialActivityType(value, fallback = "other") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (COMMERCIAL_ACTIVITY_TYPE_LABELS[normalized]) return normalized;
  return LEGACY_ACTIVITY_TYPE_ALIASES[normalized] || fallback;
}

export function getCommercialActivityTypeLabel(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  const currentLabel = COMMERCIAL_ACTIVITY_TYPE_LABELS[normalized];
  if (currentLabel) return currentLabel;
  if (normalized === "conference" || normalized === "meeting") {
    return "Reunión (tipo no especificado)";
  }
  return COMMERCIAL_ACTIVITY_TYPE_LABELS[
    normalizeCommercialActivityType(normalized)
  ];
}
