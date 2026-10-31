import { COMMERCIAL_ACTIVITY_TYPES } from "../../../../shared/commercial-activity-types.js";

export const PRIORITY_LABELS = {
  critical: "Critica",
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

export const ACTION_STATUS_LABELS = {
  pending: "Pendiente",
  done: "Creada",
};

export const COACH_POLL_TIMEOUT_MS = 180000;

export const COACH_FOUNDATION_VISIBILITY_KEY = "mi-agent-coach-show-foundation";

export const PROSPECT_SESSION_STORAGE_KEY = "mi-agent-prospect-session";

export const COACH_HANDOFF_OPERATION_KINDS = new Set([
  "activity",
  "reschedule_activity",
  "validate_stage",
  "create_account",
  "create_contact",
  "create_opportunity",
  "link_contact_to_opportunity",
  "create_lead",
  "create_contact_mapping",
  "create_quotation",
  "create_proposal",
  "lead_resolve",
]);

export const COACH_RESPONSE_TYPE_LABELS = {
  informational: "Consulta informativa",
  recommendation: "Recomendación",
  change_request: "Solicitud de cambio",
  operation: "Operación completada",
  error: "Error de operación",
  handoff: "Continuar en otro espacio",
};

export const COACH_RULE_CHANNEL_LABELS = {
  coach: "Coach",
  customer_account: "Cliente existente",
  prospect: "Cuenta nueva",
};

export const COACH_INTERACTION_MODE_LABELS = {
  coaching: "Coaching del vendedor",
  brief_context: "Contexto breve",
  deep_exploration: "Exploración detallada",
  operation: "Propuesta de operación",
};

export const COACH_INTENT_PROCESS_OPTIONS = [
  {
    value: "seller_coaching",
    label: "Coaching del vendedor",
    description:
      "Aplica a recomendaciones sobre desempeño, prioridades, riesgos y próximos pasos del proceso comercial.",
  },
  {
    value: "brief_context",
    label: "Contexto breve",
    description:
      "Aplica a consultas puntuales de CRM; la entidad y el planificador determinan los datos necesarios.",
  },
  {
    value: "operation",
    label: "Propuesta de operación",
    description:
      "Aplica a propuestas de creación o actualización, siempre sujetas a permisos y confirmación.",
  },
];

export const COACH_OPPORTUNITY_STAGE_OPTIONS = [
  { code: "contacto_inicial", label: "Contacto Inicial" },
  {
    code: "identificacion_oportunidad",
    label: "Identificación de Oportunidad",
  },
  { code: "desarrollo", label: "Desarrollo" },
  { code: "cotizacion", label: "Cotización" },
  { code: "demostracion", label: "Demostración" },
  { code: "negociacion", label: "Negociación" },
  { code: "waiting", label: "Waiting" },
];

export const COACH_OPERATION_OPTIONS = {
  coach: [
    ["activity", "Preparar borrador de actividad"],
    ["stage_answer", "Actualizar respuesta de etapa"],
    ["lead_call_outcome", "Registrar resultado de llamada de un lead"],
    ["account_field", "Actualizar datos de la cuenta"],
    ["contact_field", "Actualizar datos de un contacto existente"],
    ["opportunity_field", "Actualizar datos de una oportunidad"],
  ],
  customer_account: [
    ["activity", "Preparar borrador de actividad"],
    ["reschedule_activity", "Reprogramar una actividad pendiente"],
    ["validate_stage", "Preparar validación de avance en Oportunidades"],
    ["stage_answer", "Actualizar respuesta de etapa"],
    ["lead_call_outcome", "Registrar resultado de llamada de un lead"],
    ["account_field", "Actualizar datos de la cuenta"],
    ["contact_field", "Actualizar datos de un contacto existente"],
    ["create_contact", "Crear contacto en la cuenta actual"],
    ["opportunity_field", "Actualizar datos de una oportunidad"],
    ["create_opportunity", "Crear oportunidad en esta cuenta"],
    [
      "link_contact_to_opportunity",
      "Vincular contacto existente a una oportunidad",
    ],
  ],
  prospect: [
    ["create_account", "Crear cuenta"],
    ["create_contact", "Crear contacto"],
    ["create_opportunity", "Crear oportunidad"],
  ],
};

export const COACH_OPERATION_DESCRIPTIONS = {
  reschedule_activity: "Reprograma una actividad pendiente de oportunidad, conservando su identidad y confirmando en Calendario.",
  validate_stage: "Prepara la validación existente en Oportunidades; puede avanzar automáticamente según su resultado.",
  activity:
    "Crea un borrador; las continuaciones completan el mismo borrador. No edita una actividad ya registrada.",
  stage_answer:
    "Cambia una respuesta de la etapa actual, no la etapa comercial.",
  lead_call_outcome:
    "Registra el resultado de una llamada de un lead autorizado.",
  account_field: "Propone actualizar campos permitidos de la cuenta.",
  contact_field:
    "Propone actualizar campos permitidos de un contacto ya registrado.",
  create_contact:
    "Propone un contacto nuevo asociado a la cuenta seleccionada.",
  opportunity_field:
    "Propone actualizar campos permitidos de una oportunidad existente.",
  create_opportunity:
    "Propone una oportunidad nueva bajo la cuenta seleccionada; se completa y guarda en Oportunidades.",
  link_contact_to_opportunity:
    "Propone cambiar el contacto asociado; ambos registros deben pertenecer a esta cuenta.",
};

export const COACH_CONFIDENCE_LABELS = {
  high: "Alta confianza",
  medium: "Confianza media",
  low: "Baja confianza",
};

export const STAGE_READINESS_RECOMMENDATION_LABELS = {
  advance: "Avanzar",
  advance_with_caution: "Avanzar con cautela",
  remain: "Permanecer en la etapa",
};

export const COACH_OPERATION_STATUS_META = {
  proposed: { label: "Propuesta", tone: "neutral" },
  collecting: { label: "Información incompleta", tone: "attention" },
  ready: { label: "Lista para revisar", tone: "actionable" },
  handed_off: { label: "Pendiente en módulo", tone: "progress" },
  executing: { label: "Aplicando cambio", tone: "progress" },
  completed: { label: "Completada", tone: "success" },
  failed: { label: "Requiere atención", tone: "error" },
  rejected: { label: "Rechazada", tone: "neutral" },
  cancelled: { label: "Cancelada", tone: "neutral" },
  superseded: { label: "Reemplazada", tone: "neutral" },
  reverted: { label: "Revertida", tone: "attention" },
};

export const COACH_OPERATION_LABELS = {
  activity: "Preparar borrador de actividad",
  stage_answer: "Actualizar respuesta de etapa",
  opportunity_field: "Actualizar datos de oportunidad",
  opportunity_note: "Registrar nota en oportunidad",
  account_field: "Actualizar datos de cuenta",
  contact_field: "Actualizar datos de contacto",
  lead_call_outcome: "Registrar resultado del lead",
  lead_resolve: "Resolver lead",
  create_account: "Crear cuenta",
  create_contact: "Crear contacto",
  create_opportunity: "Crear oportunidad en esta cuenta",
  link_contact_to_opportunity: "Vincular contacto a oportunidad",
  reschedule_activity: "Reprogramar actividad",
  validate_stage: "Validar avance de etapa",
  create_lead: "Crear lead",
  create_contact_mapping: "Crear mapeo de contacto",
  create_quotation: "Crear cotización",
  create_proposal: "Crear propuesta",
};

export const COACH_TARGET_MODULE_LABELS = {
  accounts: "Cuentas",
  contacts: "Contactos",
  opportunities: "Oportunidades",
  interactions: "Leads",
  contact_mapping: "Mapeo de contactos",
  quotations: "Cotizaciones",
  proposals: "Propuestas",
  calendar: "Calendario",
  commercial_development: "Desarrollo comercial",
};

export const COACH_SOURCE_LABELS = {
  account: "Cuenta",
  contact: "Contacto",
  opportunity: "Oportunidad",
  lead: "Lead",
  stage_answer: "Respuesta de etapa",
  activity: "Actividad",
  quotation: "Cotización",
  proposal: "Propuesta",
  document: "Documento",
  process_guide: "Proceso comercial",
  crm_context: "CRM",
  conversation: "Conversación",
};

export const COACH_ACTIVITY_TYPE_OPTIONS = COMMERCIAL_ACTIVITY_TYPES;

export const CUSTOMER_FINDING_CATEGORY_LABELS = {
  company_profile: "Perfil de empresa",
  business_challenge: "Reto de negocio",
  technology_project: "Proyecto tecnológico",
  stakeholder: "Contacto / influencia",
  decision_area: "Área de decisión",
  need: "Necesidad",
  pain_point: "Dolor",
  risk: "Riesgo",
  next_step: "Siguiente paso",
  missing_information: "Hueco de información",
};

export const PROSPECT_RESEARCH_TRACK_LABELS = {
  company_profile: "Perfil de empresa",
  business_signals: "Señales de negocio",
  technology_signals: "Tecnología e infraestructura",
  public_people: "Personas y áreas",
};

export const CUSTOMER_FINDING_STATUS_LABELS = {
  suggested: "Sugerido",
  confirmed: "Confirmado",
  rejected: "Rechazado",
  outdated: "Obsoleto",
};

export const PROSPECT_CONVERSION_TARGETS = new Set([
  "account",
  "contact",
  "opportunity",
]);

export const PROSPECT_CONVERSION_ACTION_TYPES = new Set([
  "convert",
  "conversion",
  "create",
]);

export const CUSTOMER_AGENT_LABELS = {
  crm_context: "Contexto CRM",
  commercial_health: "Salud comercial",
  public_research: "Investigación pública",
  contact_research: "Investigación de contactos",
  technology_research: "Investigación tecnológica",
  expansion: "Oportunidades de expansión",
  synthesis: "Síntesis ejecutiva",
  actions: "Acciones sugeridas",
};

export const CUSTOMER_AGENT_STATUS_LABELS = {
  completed: "Completado",
  skipped: "No ejecutado",
  failed: "Con error",
};

export const CUSTOMER_QUOTATION_STATUS_LABELS = {
  won: "Ganada",
  ganada: "Ganada",
  accepted: "Aceptada",
  aceptada: "Aceptada",
  draft: "Borrador",
  borrador: "Borrador",
  sent: "Enviada",
  enviada: "Enviada",
  rejected: "Rechazada",
  rechazada: "Rechazada",
  pending: "Pendiente",
  pendiente: "Pendiente",
};

export const CUSTOMER_FINDING_APPLY_FIELDS = {
  account: [
    ["description", "Descripción"],
    ["website", "Sitio web"],
    ["phone", "Teléfono"],
    ["city", "Ciudad"],
    ["stateRegion", "Estado / región"],
  ],
  contact: [
    ["positionTitle", "Puesto"],
    ["department", "Departamento"],
    ["email", "Correo"],
    ["phone", "Teléfono"],
    ["mobile", "Móvil"],
    ["city", "Ciudad"],
    ["stateRegion", "Estado / región"],
  ],
  opportunity: [["name", "Nombre"]],
};
