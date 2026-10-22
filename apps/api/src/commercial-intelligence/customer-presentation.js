export const CUSTOMER_FRIENDLY_STYLE_INSTRUCTIONS =
  "Habla con el vendedor en español natural, claro y respetuoso. Empieza por el dato o la conclusión que más le sirve. Usa frases cortas y palabras cotidianas; evita jerga interna, nombres de bloques, etiquetas técnicas y explicaciones del funcionamiento del sistema. Si un término comercial es necesario, explícalo brevemente. Conserva todos los datos, nombres, cifras, fechas, fuentes, límites, incertidumbre, condiciones y advertencias importantes. Distingue hechos registrados, información aportada, recomendaciones, hipótesis y propuestas. No conviertas una propuesta en acuerdo o acción ejecutada, no ocultes datos faltantes y no inventes información. Organiza listas o tablas cuando faciliten la lectura y no repitas la pregunta.";

export function insertCustomerProtectedText(answer, items, errorCode) {
  let result = answer;
  for (const item of items) {
    const placeholder = `[[deliverable:${item.id}]]`;
    if (result.split(placeholder).length !== 2) throw Object.assign(new Error(errorCode), { code: errorCode });
    result = result.replace(placeholder, () => item.answer);
  }
  if (/\[\[deliverable:/.test(result)) throw Object.assign(new Error(errorCode), { code: errorCode });
  return result;
}

const componentLabels = Object.freeze({
  "query.account_summary": "Resumen de la cuenta",
  "query.record_detail": "Datos del registro",
  "query.field_value": "Dato solicitado",
  "query.record_list": "Registros",
  "query.record_search": "Resultados de la búsqueda",
  "query.history": "Actividad registrada",
  "query.pending_items": "Actividades pendientes",
  "query.relationships": "Relación entre registros",
  "query.opportunity_notes": "Notas de oportunidad",
  "query.document_content": "Información del documento",
  "query.stage_readiness": "Qué falta para avanzar",
  "query.system_help": "Ayuda del sistema",
  "guidance.situation_assessment": "Situación actual",
  "guidance.risks_and_gaps": "Riesgos y puntos por resolver",
  "guidance.next_steps": "Próximos pasos sugeridos",
  "guidance.prioritization": "Prioridad de oportunidades",
  "guidance.comparison": "Comparación",
  "guidance.trend_analysis": "Evolución de oportunidades",
  "guidance.scenario_analysis": "Escenario hipotético",
  "guidance.strategy": "Recomendación comercial",
  "content.email_draft": "Borrador de correo",
  "content.message_draft": "Borrador de mensaje",
  "content.meeting_preparation": "Preparación para la reunión",
  "content.discovery_questions": "Preguntas para el cliente",
  "content.summary": "Resumen",
  "content.explanation": "Explicación",
  "content.rewrite": "Texto revisado",
  "content.translation": "Traducción",
  "content.value_argument": "Propuesta de valor",
  "report.client_statement": "Lo que comentó el cliente",
  "report.seller_observation": "Observación del vendedor",
  "report.interaction_outcome": "Resultado de la interacción",
  "report.commitment": "Compromiso reportado",
  "report.document_evidence": "Información del documento",
  "report.hypothesis": "Hipótesis",
  "action.create_record": "Propuesta para crear un registro",
  "action.update_fields": "Propuesta de cambio",
  "action.update_stage_answer": "Propuesta de respuesta para la etapa",
  "action.link_records": "Propuesta de asociación",
  "action.schedule_activity": "Actividad propuesta",
  "action.reschedule_activity": "Propuesta para reprogramar",
  "action.record_outcome": "Resultado de llamada por revisar",
  "action.record_note": "Nota de oportunidad por revisar",
  "action.change_status": "Avance por revisar",
  "action.remove_record": "Acción no disponible",
  "action.send_communication": "Envío no disponible",
});

const textReplacements = [
  [/Preparación y requisitos de etapa:/g, "Revisé qué hace falta para avanzar:"],
  [/Preguntas de etapa sin respuesta:/g, "Pregunta pendiente:"],
  [/Criterios y configuración pendientes \(no son preguntas adicionales\):/g, "También faltan estos requisitos:"],
  [/Avances registrados:/g, "Avance anotado:"],
  [/Evaluación de preparación: Persisten preguntas o criterios pendientes que impiden confirmar el cumplimiento de la etapa\./g,
    "En resumen: aún falta información para confirmar que la etapa esté completa."],
  [/Evaluación de preparación: Las preguntas obligatorias y los criterios requeridos cuentan con respaldo verificable\./g,
    "En resumen: las preguntas y los requisitos cuentan con respaldo."],
  [/No hay preguntas sin respuesta en la lectura actual\./g, "No quedaron preguntas sin respuesta en la información revisada."],
  [/No hay criterios pendientes en la lectura actual\./g, "No quedaron requisitos pendientes en la información revisada."],
  [/La lectura completa se limita a las fuentes y al periodo consultados; no acredita todo el historial ni todas las conversaciones del cliente\./g,
    "La consulta solo cubre las fuentes y el periodo indicados; no permite confirmar todo el historial ni todas las conversaciones del cliente."],
  [/Las fechas de programación, vencimiento o creación no acreditan la fecha de realización ni un resultado no registrado\./g,
    "Las fechas de programación, vencimiento o creación no confirman que la actividad se haya realizado ni cuál fue su resultado."],
  [/Una actividad registrada no acredita por sí sola un siguiente paso acordado con el cliente\./g,
    "La nota de una actividad, por sí sola, no confirma que el cliente haya acordado el siguiente paso."],
  [/Una actividad registrada no acredita por sí sola un acuerdo con el cliente\./g,
    "La nota de una actividad, por sí sola, no confirma que el cliente haya aceptado."],
  [/Esta consulta no guarda respuestas ni cambia la etapa\./g, "No guardé respuestas ni cambié la etapa."],
  [/No se ha guardado ningún cambio\./g, "No guardé cambios."],
  [/El borrador previo no cambió\./g, "No modifiqué la propuesta anterior."],
  [/No se presenta como validada\./g, "No pude confirmar la respuesta."],
  [/Estado registrado:/g, "Estado:"],
  [/la lectura recuperada/g, "la información consultada"],
  [/las fuentes consultadas/g, "las fuentes revisadas"],
  [/No informado en esta versión/g, "No aparece en esta versión"],
  [/Cargo: No informado\b/g, "Cargo: No indicado en el registro"],
  [/^No informado$/gm, "No indicado"],
];

export function customerFacingComponentLabel(category, object = "") {
  const label = componentLabels[category];
  if (!label) throw new Error(`Falta una etiqueta para la categoría ${category || "(vacía)"}`);
  const objectNames = {
    account: { singular: "una cuenta", plural: "cuentas" },
    opportunity: { singular: "una oportunidad", plural: "oportunidades" },
    contact: { singular: "un contacto", plural: "contactos" },
    activity: { singular: "una actividad", plural: "actividades" },
    lead: { singular: "un lead", plural: "leads" },
    quotation: { singular: "una cotización", plural: "cotizaciones" },
  };
  const objectName = objectNames[object];
  if (category === "query.record_list" && objectName) return `Lista de ${objectName.plural}`;
  if (category === "query.record_search" && objectName) return `Resultados de ${objectName.plural}`;
  if (category === "action.create_record" && objectName) return `Propuesta para crear ${objectName.singular}`;
  if (category === "query.record_detail" || category === "query.field_value") {
    const objectLabel = {
      account: "de la cuenta", opportunity: "de la oportunidad", contact: "del contacto",
      activity: "de la actividad", lead: "del lead", quotation: "de la cotización",
    }[object];
    if (!objectLabel) return label;
    return category === "query.record_detail" ? `Datos ${objectLabel}` : `${label} ${objectLabel}`;
  }
  return label;
}

export function presentCustomerText(value) {
  if (typeof value !== "string" || !value) return value;
  return textReplacements.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

export function presentCustomerResponse(value) {
  if (!value || typeof value !== "object") return value;
  return {
    ...value,
    ...(typeof value.answer === "string" ? { answer: presentCustomerText(value.answer) } : {}),
    ...(Array.isArray(value.components) ? {
      components: value.components.map((component) => ({
        ...component,
        ...(component.category ? { label: customerFacingComponentLabel(component.category, component.object) } : {}),
        ...(typeof component.answer === "string" ? { answer: presentCustomerText(component.answer) } : {}),
      })),
    } : {}),
  };
}
