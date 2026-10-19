export const businessImpacts = {
  none: { kind: "none", label: "Sin confirmación de negocio",
    description: "Este caso no prevé una acción comercial confirmable. El lote sí guarda sesiones y evidencias técnicas." },
  confirm: { kind: "confirm", label: "Puede modificar datos · requiere confirmación",
    description: "Puede preparar una propuesta sobre datos reales. Solo se ejecuta con revisión, permisos y una confirmación adicional; el lote no la ejecuta." },
  module: { kind: "module", label: "Puede crear registros · requiere guardar en el módulo",
    description: "Puede preparar un alta o actividad. El traslado no crea el registro: debes completar y guardar el formulario existente." },
  form: { kind: "form", label: "Puede modificar respuestas · requiere guardar en el módulo",
    description: "Este escenario manual guarda respuestas en el formulario existente. No inicia por sí mismo la validación ni acredita avance de etapa; el lote lo omite por requerir interacción." },
  validation: { kind: "validation", label: "Puede avanzar la etapa · requiere iniciar validación",
    description: "Confirmar la acción inicia el validador actual, que puede avanzar automáticamente la etapa. Ejecutar el lote no inicia esa validación." },
};

// Classify the documented scenario, not every case in an action category.
const confirmCases = new Set(["A02-01", "A02-02", "A03-01", "A03-02", "A03-03", "A04-01", "A04-02",
  "A06-01", "A06-02", "A06-03", "A07-01", "A07-02", "K05", "SEQ05"]);
const moduleCases = new Set(["A01-01", "A01-02", "A05-01", "A05-02", "A05-03", "A07-03", "SEQ04"]);
const validationCases = new Set(["A08-02", "A08-04", "A08-05", "A08-07", "A08-09", "A08-10"]);

export function businessImpactForCase(id) {
  const sourceId = id.replace(/\.v\d+$/, "");
  return businessImpacts[sourceId === "A08-12" ? "form" : validationCases.has(sourceId) ? "validation" : moduleCases.has(sourceId) ? "module"
    : confirmCases.has(sourceId) ? "confirm" : "none"];
}

export const operationBusinessImpacts = Object.fromEntries([
  ...["account_field", "contact_field", "opportunity_field", "stage_answer", "lead_call_outcome",
    "link_contact_to_opportunity", "reschedule_activity"].map((kind) => [kind, businessImpacts.confirm]),
  ...["create_contact", "create_opportunity", "activity"].map((kind) => [kind, businessImpacts.module]),
  ["validate_stage", businessImpacts.validation],
]);
