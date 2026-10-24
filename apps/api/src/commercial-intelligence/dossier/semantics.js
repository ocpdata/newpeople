// Meanings travel with each record so consumers do not need prompt rules to interpret them.
export const QUOTATION_STATUS_MEANINGS = Object.freeze({
  borrador: "Borrador interno; no consta como enviado al cliente.",
  en_aprobacion: "En aprobación interna; no consta como enviado al cliente.",
  rechazada: "Rechazada en la aprobación interna.",
  aprobada: "Aprobada internamente; el CRM no registra su envío ni su aceptación por el cliente.",
  enviada: "Enviada al cliente según el CRM; no registra aceptación.",
  aceptada: "El CRM registra la aceptación del cliente.",
  ganada: "Declarada ganada en el CRM.",
  perdida: "Declarada perdida en el CRM.",
  anulada: "Anulada en el CRM.",
  no_vigente: "Marcada como no vigente.",
});

export const COMMERCIAL_STATUS_MEANINGS = Object.freeze({
  en_proceso: "Oportunidad abierta en el CRM.",
  ganada: "Registrada como ganada en el CRM.",
  perdida: "Registrada como perdida en el CRM.",
  anulada: "Registrada como anulada en el CRM.",
});

export const ACTIVITY_STATUS_MEANINGS = Object.freeze({
  pending: "Pendiente en el sistema. Una nota que describa avances no la marca como realizada.",
  done: "Registrada como realizada.",
  rescheduled: "Reprogramada.",
  cancelled: "Cancelada.",
  confirmed: "Confirmada y programada; no acredita que ya se haya realizado.",
});

export const MEANINGS = Object.freeze({
  closeDate: "Fecha de cierre registrada en el CRM; no acredita un compromiso del cliente.",
  amount: "Importe registrado en el CRM.",
  stage: "Etapa comercial registrada en el CRM.",
  contactTitle: "Cargo registrado; no acredita autoridad de compra ni de aprobación.",
  opportunityContact: "Contacto asociado a la oportunidad en el CRM.",
  stageAnswer: "Respuesta capturada por el equipo comercial; su vigencia puede requerir confirmación con el cliente.",
  supersededAnswer: "Versión anterior de la misma pregunta; la vigente es la más reciente.",
  dueDate: "Fecha de vencimiento o programación; no acredita que la actividad se haya realizado.",
  activityNote: "Nota registrada en la actividad; describe lo informado por quien la registró.",
  opportunityNote: "Nota independiente de la oportunidad; distinta de las notas de actividades.",
  purchaseOrder: "Documento de orden de compra del cliente registrado en la cotización.",
  document: "Documento asociado a la oportunidad; solo metadatos, sin su contenido.",
  interaction: "Interacción registrada; su resumen puede haberse generado automáticamente.",
  history: "Cambio comercial registrado por la auditoría del CRM, con valores anteriores y posteriores.",
  requirement: "Pregunta de la etapa actual según la configuración del proceso comercial.",
});

export const EMPTY_MEANINGS = Object.freeze({
  stageAnswers: "No hay respuestas de etapa registradas para esta oportunidad.",
  stageRequirements: "La etapa actual no tiene preguntas configuradas.",
  contacts: "No hay contactos activos registrados en la cuenta.",
  activities: "No hay actividades de oportunidad registradas.",
  calendarActivities: "No hay actividades de calendario asociadas a esta oportunidad.",
  opportunityNotes: "No hay notas independientes de oportunidad. Las notas de actividades están en la sección de actividades.",
  quotations: "No hay cotizaciones registradas para esta oportunidad.",
  purchaseOrders: "No hay documento de orden de compra del cliente registrado en el CRM.",
  documents: "No hay documentos asociados a la oportunidad.",
  interactions: "No hay interacciones asociadas directamente a esta oportunidad.",
  history: "La auditoría no registra cambios de importe, cierre, etapa, estado o contacto para esta oportunidad.",
  opportunities: "La cuenta no tiene oportunidades visibles con los permisos y la política actuales.",
  pendingActivities: "No hay actividades de oportunidad pendientes o reprogramadas en las oportunidades visibles de la cuenta.",
});

export const RESTRICTED_MEANING = "Sin permiso para consultar esta fuente; no significa que no existan registros.";
export const FAILED_MEANING = "La lectura falló; no se puede afirmar si existen registros.";
export const TRUNCATED_MEANING = "Se alcanzó el límite de lectura; hay más registros que no se incluyeron.";
