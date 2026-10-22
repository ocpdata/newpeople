export const CUSTOMER_TURN_CASES = [
  ["query.account_summary", "Dame un panorama general de la cuenta Taller Aurora.", "account"],
  ["query.record_detail", "Muéstrame el detalle de la oportunidad Renovación Alfa.", "opportunity"],
  ["query.field_value", "¿En qué etapa está la oportunidad Renovación Alfa?", "opportunity"],
  ["query.record_list", "Dame una lista de las oportunidades de esta cuenta.", "opportunity"],
  ["query.record_search", "Busca las oportunidades abiertas que cierren en 2027.", "opportunity"],
  ["query.history", "Muéstrame el historial de interacciones de esta cuenta.", "account"],
  ["query.pending_items", "¿Qué actividades están pendientes en esta cuenta?", "activity"],
  ["query.relationships", "¿Qué contacto está asociado a la oportunidad Renovación Alfa?", "opportunity"],
  ["query.opportunity_notes", "¿Qué notas tiene la oportunidad Renovación Alfa?", "opportunity"],
  ["query.document_content", "¿Qué productos contiene la cotización de Renovación Alfa?", "quotation"],
  ["query.stage_readiness", "¿Qué requisitos faltan para avanzar de etapa en Renovación Alfa?", "opportunity"],
  ["query.system_help", "¿Cómo funciona la pantalla de configuración de notificaciones del sistema?", "general"],
  ["guidance.situation_assessment", "Evalúa la situación comercial actual de Renovación Alfa.", "opportunity"],
  ["guidance.risks_and_gaps", "Identifica riesgos y brechas en Renovación Alfa.", "opportunity"],
  ["guidance.next_steps", "¿Qué me recomiendas para avanzar en Renovación Alfa?", "opportunity"],
  ["guidance.prioritization", "Prioriza las oportunidades de la cuenta para decidir cuál atender primero.", "opportunity"],
  ["guidance.comparison", "Compara las oportunidades Renovación Alfa y Proyecto Beta.", "opportunity"],
  ["guidance.trend_analysis", "Analiza la tendencia mensual histórica de ingresos de esta cuenta en los últimos tres años.", "account"],
  ["guidance.scenario_analysis", "¿Qué pasaría en Renovación Alfa si el presupuesto se redujera a la mitad?", "opportunity"],
  ["guidance.strategy", "Propón una estrategia comercial de negociación para Renovación Alfa.", "opportunity"],
  ["content.email_draft", "Dame un ejemplo de correo para enviar al cliente sobre Renovación Alfa; no lo envíes.", "opportunity"],
  ["content.message_draft", "Redacta un mensaje breve de WhatsApp para saludar al cliente.", "account"],
  ["content.meeting_preparation", "Prepara la agenda y el guion para una reunión sobre Renovación Alfa, sin agendarla.", "opportunity"],
  ["content.discovery_questions", "Redacta cinco preguntas de descubrimiento para entender las necesidades de Renovación Alfa.", "opportunity"],
  ["content.summary", "Resume en dos frases este texto: el proyecto consiste en revisar el correo y capacitar a usuarios.", "general"],
  ["content.explanation", "Explícame qué significa la expresión retorno de inversión.", "general"],
  ["content.rewrite", "Reescribe este texto con tono más formal: hola, te mando la propuesta mañana.", "general"],
  ["content.translation", "Traduce al inglés este texto: gracias por revisar nuestra propuesta.", "general"],
  ["content.value_argument", "Redacta un argumento de valor para Renovación Alfa sin inventar métricas.", "opportunity"],
  ["report.client_statement", "El cliente me dijo que su motivación en Renovación Alfa es que sospechan que algunos empleados envían datos privados por correo.", "opportunity"],
  ["report.seller_observation", "En Renovación Alfa observé directamente que no tenían un responsable de seguridad asignado.", "opportunity"],
  ["report.interaction_outcome", "En la llamada sobre Renovación Alfa el cliente rechazó la demo. Te cuento el resultado, no registres una actividad.", "opportunity"],
  ["report.commitment", "En Renovación Alfa el cliente se comprometió a compartir su presupuesto el viernes; por ahora solo te informo.", "opportunity"],
  ["report.document_evidence", "El documento aportado de Renovación Alfa dice: necesitan filtrar adjuntos de correo. Es contenido del documento, no una orden de guardarlo.", "opportunity"],
  ["report.hypothesis", "Yo supongo, sin confirmación del cliente, que Renovación Alfa se frenó por falta de presupuesto.", "opportunity"],
  ["action.create_record", "Quiero crear una oportunidad nueva llamada Proyecto Gamma.", "opportunity"],
  ["action.update_fields", "Actualiza el monto de Renovación Alfa a 25000 dólares.", "opportunity"],
  ["action.update_stage_answer", "Quiero actualizar la respuesta de la pregunta de motivación de Renovación Alfa a reducir fugas de información.", "opportunity"],
  ["action.link_records", "Vincula el contacto Elena Muestra a la oportunidad Renovación Alfa.", "opportunity"],
  ["action.schedule_activity", "Quiero programar una reunión sobre Renovación Alfa.", "activity"],
  ["action.reschedule_activity", "Reprograma la reunión ya existente de Renovación Alfa del martes al viernes.", "activity"],
  ["action.record_outcome", "Registra en el lead de prueba el resultado de la llamada: no contestó.", "lead"],
  ["action.record_note", "Guarda como nota en Renovación Alfa que el cliente quizá lo confirme.", "opportunity"],
  ["action.change_status", "Cambia el estado comercial de Renovación Alfa a ganada.", "opportunity"],
  ["action.remove_record", "Elimina la oportunidad Renovación Alfa.", "opportunity"],
  ["action.send_communication", "Envía ahora un correo a Elena Muestra con la propuesta.", "contact"],
].map(([category, question, object]) => ({ category, question, object }));

export const SYNTHETIC_CUSTOMER_SNAPSHOT = {
  account: { id: 9001, name: "Taller Aurora", status: "active" },
  permissions: { canReadContacts: true },
  selectedOpportunity: null,
  opportunities: [{
    id: 9101, accountId: 9001, name: "Renovación Alfa", lifecycle: "open",
    commercialStatusCode: "en_proceso", stageCode: "calificacion",
    stageName: "Calificación", salesStageId: 1, amountUsd: 10000,
    activationStatusCode: "activada",
    stageQuestions: [
      { questionId: 9201, code: "motivation", prompt: "¿Cuál es la motivación del cliente?", answer: "" },
      { questionId: 9202, code: "budget", prompt: "¿Cuál es el presupuesto del cliente?", answer: "Pendiente" },
    ],
  }],
  contacts: [{ id: 9301, accountId: 9001, name: "Elena Muestra", email: "elena@example.invalid", activationStatusCode: "activado" }],
  interactions: [], inactiveOpportunities: [],
};

const notesContinuation = {
  accountId: 9001, opportunityId: 9101,
  turnMemory: {
    contract: {
      version: 1, movement: "new_request", resolution: "resolved", clarificationQuestion: "", confidence: "high",
      components: [{
        id: "c1", category: "query.opportunity_notes", text: "Muéstrame las notas de Renovación Alfa.",
        object: "opportunity", topic: "notas", scope: "single", reference: "Renovación Alfa",
        attribution: "none", certainty: "unspecified", explicitAction: false, dependsOn: [], continuationOf: "none",
      }],
    },
    pendingComponentIds: [],
  },
};

export const CUSTOMER_DIMENSION_CASES = [
  {
    id: "detail-not-notes", question: "Enséñame los datos registrados de la oportunidad Renovación Alfa.",
    expected: [{ category: "query.record_detail", object: "opportunity", reference: "Renovación Alfa" }],
  },
  {
    id: "explicit-notes", question: "Quiero leer las anotaciones guardadas en la oportunidad Renovación Alfa.",
    expected: [{ category: "query.opportunity_notes", object: "opportunity", reference: "Renovación Alfa" }],
  },
  {
    id: "single-field", question: "Solo dime el importe registrado de Renovación Alfa.",
    expected: [{ category: "query.field_value", object: "opportunity", reference: "Renovación Alfa", requestedFields: ["amountUsd"] }],
  },
  {
    id: "library-source", question: "Según la documentación interna, ¿qué problemas de DNS resuelve BlueCat?",
    expected: [{ category: "query.document_content", object: "general", source: "knowledge_library" }],
  },
  {
    id: "attachment-source", question: "¿Qué explica el PDF adjunto sobre DNS?",
    referenceMaterial: { name: "Guia.txt", text: "El documento explica DNS y gestión de direcciones IP." },
    expected: [{ category: "query.document_content", object: "document", source: "provided_document" }],
  },
  {
    id: "missing-attachment", question: "Resume el archivo adjunto, no consultes la biblioteca interna.",
    expected: [{ category: "query.document_content", object: "document", source: "provided_document" }],
    resolutions: ["resolved", "clarification"],
  },
  {
    id: "quotation-object", question: "Enumera los productos de la cotización 18 de Renovación Alfa.",
    expected: [{
      category: "query.document_content", object: "quotation", source: "quotation",
      documentSpec: { source: "quotation", opportunityReference: "Renovación Alfa", quotationReference: "18" },
    }],
  },
  {
    id: "draft-not-update", question: "Redacta un correo para pedir que actualicen el monto de Renovación Alfa, sin cambiar nada en el CRM.",
    expected: [{ category: "content.email_draft", object: "opportunity", reference: "Renovación Alfa" }],
  },
  {
    id: "agenda-not-schedule", question: "Propón una agenda de conversación para Renovación Alfa; no programes ninguna reunión.",
    expected: [{ category: "content.meeting_preparation", object: "opportunity", reference: "Renovación Alfa" }],
  },
  {
    id: "same-entity-different-task", question: "¿Y su monto?",
    conversationHistory: [
      { role: "user", text: "Muéstrame las notas de Renovación Alfa." },
      { role: "assistant", text: "Renovación Alfa no tiene notas registradas." },
    ],
    conversationContext: notesContinuation,
    expected: [{ category: "query.field_value", object: "opportunity", reference: "Renovación Alfa", requestedFields: ["amountUsd"] }],
    movements: ["continue"],
  },
  {
    id: "new-crm-task-after-library", question: "Ahora enséñame los datos de la oportunidad Renovación Alfa.",
    conversationHistory: [
      { role: "user", text: "Explica BlueCat según la biblioteca interna." },
      { role: "assistant", text: "La biblioteca describe funciones DDI." },
    ],
    expected: [{ category: "query.record_detail", object: "opportunity", reference: "Renovación Alfa", continuationOf: "none" }],
    movements: ["new_request", "change_focus"],
  },
  {
    id: "same-notes-task", question: "¿Y la última?",
    conversationHistory: [
      { role: "user", text: "Muéstrame las notas de Renovación Alfa." },
      { role: "assistant", text: "Renovación Alfa tiene varias notas registradas." },
    ],
    conversationContext: notesContinuation,
    expected: [{ category: "query.opportunity_notes", object: "opportunity", reference: "Renovación Alfa", continuationOf: "c1" }],
    movements: ["continue"],
  },
  {
    id: "two-deliverables", question: "Muéstrame la ficha de Renovación Alfa y sus notas registradas.",
    expected: [
      { category: "query.record_detail", object: "opportunity", reference: "Renovación Alfa" },
      { category: "query.opportunity_notes", object: "opportunity", reference: "Renovación Alfa" },
    ],
  },
  {
    id: "current-quantity", question: "Ahora prepara solo tres preguntas de descubrimiento sobre BlueCat.",
    conversationHistory: [
      { role: "user", text: "Prepara cinco preguntas de descubrimiento sobre BlueCat." },
      { role: "assistant", text: "Estas son cinco preguntas para explorar DNS y DHCP." },
    ],
    expected: [{ category: "content.discovery_questions", object: "general" }],
    currentText: "tres",
  },
];

export const CUSTOMER_COHERENCE_CASES = [
  {
    id: "repair-detail-not-notes", question: "Muéstrame la ficha completa de la oportunidad Renovación Alfa, no solo sus notas.",
    initialComponent: { category: "query.opportunity_notes" },
    expected: [{ category: "query.record_detail", object: "opportunity", reference: "Renovación Alfa" }],
  },
  {
    id: "repair-missing-task", question: "Muéstrame la ficha de Renovación Alfa y también sus notas.",
    initialComponent: { category: "query.record_detail", text: "Muéstrame la ficha de Renovación Alfa." },
    expected: [
      { category: "query.record_detail", object: "opportunity" },
      { category: "query.opportunity_notes", object: "opportunity" },
    ],
  },
  {
    id: "repair-excluded-library", question: "Resume el archivo adjunto; no consultes la biblioteca interna.",
    referenceMaterial: { name: "Guia.txt", text: "El documento explica DNS y DHCP." },
    initialComponent: {
      category: "query.document_content", object: "general", reference: "", scope: "none",
      documentSpec: { source: "knowledge_library", aspect: "summary" },
    },
    expected: [{ category: "query.document_content", object: "document", source: "provided_document" }],
  },
  {
    id: "repair-lost-quantity", question: "Prepara solo tres preguntas de descubrimiento sobre BlueCat.",
    initialComponent: {
      category: "content.discovery_questions", text: "Prepara cinco preguntas de descubrimiento sobre BlueCat.",
      object: "general", reference: "", scope: "none",
    },
    expected: [{ category: "content.discovery_questions", object: "general" }], currentText: "tres",
  },
  {
    id: "repair-invented-meeting",
    question: "Redacta un correo para pedir una reunión sobre Renovación Alfa; no programes nada.",
    initialComponents: [
      { category: "content.email_draft" },
      { id: "c2", category: "action.schedule_activity", object: "activity", explicitAction: true },
    ],
    expected: [{ category: "content.email_draft", object: "opportunity" }],
  },
  {
    id: "repair-lost-attribution",
    question: "El cliente sospecha que hay fugas de datos en Renovación Alfa; no está confirmado.",
    initialComponent: {
      category: "report.client_statement", attribution: "seller", certainty: "observed",
      text: "Observé fugas de datos confirmadas en Renovación Alfa.",
    },
    expected: [{ category: "report.client_statement", object: "opportunity", attribution: "client", certainty: "suspected" }],
  },
].map(({ initialComponent, initialComponents, ...item }) => ({
  ...item,
  initialContract: {
    ...notesContinuation.turnMemory.contract,
    components: (initialComponents || [initialComponent]).map((part) => ({
      ...notesContinuation.turnMemory.contract.components[0], text: item.question, ...part,
    })),
  },
}));
