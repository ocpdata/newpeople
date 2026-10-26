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
  quotationItem: "Partida de la versión vigente de la cotización: cantidad y, si se muestran, precio de lista y descuento comerciales. No es un costo interno ni acredita aceptación del cliente.",
  quotationTerms: "Condiciones comerciales de la versión vigente de la cotización (moneda, entrega, vigencia, garantía, pago).",
  attachment: "Fragmento del archivo que el vendedor adjuntó a este mensaje; es material aportado, no un registro del CRM.",
  crmDocumentText: "Fragmento del texto de un documento asociado a la oportunidad; describe lo que dice el documento, no un dato confirmado del CRM.",
  library: "Fragmento de la biblioteca documental: conocimiento general de productos o del proceso comercial. Nunca es un hecho del cliente.",
  interaction: "Interacción registrada; su resumen puede haberse generado automáticamente.",
  history: "Cambio comercial registrado por la auditoría del CRM, con valores anteriores y posteriores.",
  requirement: "Pregunta de la etapa actual según la configuración del proceso comercial.",
});

export const EXTENDED_MEANINGS = Object.freeze({
  accountType: "Tipo de cuenta registrado en el CRM (por ejemplo, prospecto o cliente).",
  accountOwners: "Usuarios responsables asignados a la cuenta en el CRM.",
  accountDescription: "Descripción registrada de la cuenta; puede provenir de investigación previa y no prueba necesidades actuales.",
  stakeholder: "Actor registrado en el espacio de trabajo de la oportunidad; rol, influencia y apoyo son valoraciones del equipo comercial.",
  weakness: "Debilidad o riesgo registrado por el equipo comercial, con su estado y plan de mitigación.",
  criterionAssessment: "Evaluación de un criterio del proceso comercial; puntuación y confianza son valoraciones internas.",
  deliverable: "Entregable registrado para la oportunidad; su estado no acredita aceptación del cliente.",
  recommendedStrategy: "Estrategia recomendada registrada para la oportunidad; es una recomendación, no un compromiso ni un hecho del cliente.",
  themeEntry: "Afirmación registrada por tema, con su fuente y confianza; no es un dato verificado del cliente salvo que su fuente lo acredite.",
  manufacturerRegistration: "Registro de la oportunidad ante el fabricante (deal registration).",
  registrationExpiry: "Fecha de vencimiento del registro ante el fabricante.",
  proposal: "Propuesta comercial generada en el CRM; su estado no acredita envío ni aceptación del cliente.",
  proposalDocument: "Documento de propuesta del CRM; solo metadatos, sin su contenido.",
  accountInteraction: "Interacción registrada a nivel de cuenta (no necesariamente ligada a una oportunidad).",
  lead: "Interacción o lead de la cuenta sin oportunidad principal; su análisis puede ser automático.",
  leadAnalysisStatus: "Estado del análisis o la asignación del lead, no de una venta.",
  campaignInteraction: "Estado de la cuenta en una campaña; no_enviado indica que la campaña no se le ha enviado.",
  calendarDate: "Fecha programada o de vencimiento; no acredita que la actividad se haya realizado.",
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
  accountActivities: "No hay actividades registradas, en ningún estado, en las oportunidades visibles de la cuenta.",
  accountProfile: "No se encontró el perfil de la cuenta.",
  stakeholders: "No hay actores registrados en el espacio de trabajo de la oportunidad.",
  weaknesses: "No hay debilidades registradas en el espacio de trabajo de la oportunidad.",
  criterionAssessments: "No hay evaluaciones de criterios registradas para la oportunidad.",
  deliverables: "No hay entregables registrados para la oportunidad.",
  recommendedStrategy: "No hay estrategia recomendada registrada para la oportunidad.",
  themeEntries: "No hay afirmaciones por tema registradas para la oportunidad.",
  manufacturerRegistrations: "No hay registros ante el fabricante para la oportunidad.",
  proposals: "No hay propuestas comerciales generadas para la oportunidad.",
  proposalDocuments: "No hay documentos de propuesta para la oportunidad.",
  accountInteractions: "No hay interacciones registradas a nivel de cuenta.",
  leads: "No hay interacciones o leads de la cuenta sin oportunidad asociada.",
  campaignInteractions: "La cuenta no figura en campañas.",
  accountCalendar: "No hay actividades de calendario de la cuenta sin oportunidad asociada.",
});

export const RESTRICTED_MEANING = "Sin permiso para consultar esta fuente; no significa que no existan registros.";
export const FAILED_MEANING = "La lectura falló; no se puede afirmar si existen registros.";
export const TRUNCATED_MEANING = "Se alcanzó el límite de lectura; hay más registros que no se incluyeron.";
