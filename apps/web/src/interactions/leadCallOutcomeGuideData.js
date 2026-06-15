const LEAD_CALL_OUTCOME_SUBSTATUS_GUIDE = {
  contact_attempt_pending: {
    optionHint: "cuando aún falta contacto útil o contexto",
    whenToUse:
      "Úsalo cuando todavía no lograste una conversación útil o aún falta reunir contexto antes de avanzar.",
    avoidWhen:
      "Evítalo si el prospecto ya pidió reunión, ya confirmó interés o ya te redirigió a otra persona o área.",
  },
  meeting_requested: {
    optionHint: "cuando ya aceptó avanzar pero falta agenda",
    whenToUse:
      "Úsalo cuando el prospecto mostró interés inicial y el siguiente paso real es coordinar una reunión.",
    avoidWhen:
      "Evítalo si la reunión ya está confirmada o si solo pidió que lo contactes más adelante sin comprometer agenda.",
  },
  meeting_confirmed: {
    optionHint: "cuando la siguiente reunión ya quedó acordada",
    whenToUse:
      "Úsalo cuando ya existe confirmación expresa de la siguiente reunión o un acuerdo concreto de agenda.",
    avoidWhen:
      "Evítalo si todavía estás proponiendo reunirte o si solo existe interés verbal sin compromiso real.",
  },
  needs_follow_up_later: {
    optionHint: "cuando pidió retomarlo después",
    whenToUse:
      "Úsalo cuando el lead sigue vivo, pero el prospecto pidió retomarlo en otra fecha y conviene dejar un recordatorio formal.",
    avoidWhen:
      "Evítalo si el problema principal es presupuesto del siguiente ciclo o si ya decidiste cerrar el lead.",
  },
  budget_timing_issue: {
    optionHint: "cuando hay interés pero no presupuesto actual",
    whenToUse:
      "Úsalo cuando el cliente confirma potencial, pero el presupuesto quedó para otro trimestre o ciclo.",
    avoidWhen:
      "Evítalo si la verdadera barrera es prioridad, falta de iniciativa o cierre definitivo.",
  },
  priority_not_now: {
    optionHint: "cuando tiene encaje, pero no urgencia actual",
    whenToUse:
      "Úsalo cuando el tema podría aplicar, pero hoy no está en el foco operativo o ejecutivo del prospecto.",
    avoidWhen:
      "Evítalo si la objeción principal es presupuesto o si el prospecto pidió no ser contactado.",
  },
  wrong_contact_identified: {
    optionHint: "cuando hablaste con la persona equivocada",
    whenToUse:
      "Úsalo cuando confirmas que el interlocutor actual no es dueño del problema o no puede mover la oportunidad.",
    avoidWhen:
      "Evítalo si el mismo contacto sigue siendo válido y solo hace falta sumar otra persona.",
  },
  alternative_contact_needed: {
    optionHint: "cuando hace falta otro contacto mejor posicionado",
    whenToUse:
      "Úsalo cuando el lead conserva potencial, pero necesitas sumar o ubicar un contacto alternativo dentro de la cuenta.",
    avoidWhen:
      "Evítalo si ya comprobaste que el contacto actual debe sustituirse por completo o si la redirección es hacia otra área.",
  },
  account_has_other_potential: {
    optionHint: "cuando conviene redirigir a otra área o caso",
    whenToUse:
      "Úsalo cuando la cuenta no debe abandonarse, pero la oportunidad actual encaja mejor en otra área o uso.",
    avoidWhen:
      "Evítalo si solo necesitas otra persona dentro de la misma área o si el caso ya debe cerrarse.",
  },
  value_misaligned_current_contact: {
    optionHint: "cuando la propuesta no resonó con este interlocutor",
    whenToUse:
      "Úsalo cuando el valor no conectó con el contacto actual, pero la cuenta podría seguir teniendo potencial en otro frente.",
    avoidWhen:
      "Evítalo si el caso ya no tiene potencial real o si solo corresponde reagendar para más adelante.",
  },
  disqualified_temporary: {
    optionHint: "cuando hoy no hay iniciativa, pero podría reabrirse",
    whenToUse:
      "Úsalo cuando quieres sacar el lead del trabajo activo porque no existe iniciativa actual, pero sí una posibilidad razonable de retorno.",
    avoidWhen:
      "Evítalo si el prospecto pidió no ser contactado o si el cierre ya es claramente definitivo.",
  },
  disqualified_definitive: {
    optionHint: "cuando el caso debe cerrarse sin expectativa real",
    whenToUse:
      "Úsalo cuando ya no existe interés serio, cuando pidieron no ser contactados o cuando continuar sería improductivo.",
    avoidWhen:
      "Evítalo si solo se trata de un tema temporal de presupuesto, prioridad o calendario.",
  },
};

const LEAD_CALL_OUTCOME_REASON_GUIDE = {
  needs_more_information: {
    optionHint: "cuando aún falta contexto para decidir",
    whenToUse:
      "Úsalo cuando todavía no hay suficiente información comercial o técnica para avanzar con criterio.",
    avoidWhen:
      "Evítalo si ya existe interés confirmado, una reunión aceptada o una redirección clara.",
  },
  interest_confirmed: {
    optionHint: "cuando el prospecto sí mostró interés real",
    whenToUse:
      "Úsalo cuando el cliente manifestó interés concreto en seguir conversando o profundizar el caso.",
    avoidWhen:
      "Evítalo si el siguiente paso no es avanzar sino esperar, redirigir o cerrar.",
  },
  meeting_accepted: {
    optionHint: "cuando ya aceptó la siguiente reunión",
    whenToUse:
      "Úsalo cuando el prospecto ya confirmó que sí participará en la siguiente reunión.",
    avoidWhen:
      "Evítalo si todavía estás proponiendo la reunión o si solo existe interés preliminar.",
  },
  follow_up_later_requested: {
    optionHint: "cuando pidió retomarlo más adelante",
    whenToUse:
      "Úsalo cuando el prospecto pidió volver a hablar en otra fecha, sin rechazar el tema.",
    avoidWhen:
      "Evítalo si el problema real es presupuesto o si el caso ya debe cerrarse.",
  },
  budget_next_cycle: {
    optionHint: "cuando el dinero llega en otro ciclo",
    whenToUse:
      "Úsalo cuando el interés existe, pero el presupuesto no está disponible en el periodo actual.",
    avoidWhen:
      "Evítalo si el freno principal no es presupuesto sino prioridad o falta total de iniciativa.",
  },
  timing_not_right: {
    optionHint: "cuando el momento no ayuda aunque haya encaje",
    whenToUse:
      "Úsalo cuando el cliente reconoce valor, pero hoy no está listo para mover el tema.",
    avoidWhen:
      "Evítalo si hay una objeción financiera concreta o un cierre definitivo.",
  },
  wrong_contact: {
    optionHint: "cuando el interlocutor no es el adecuado",
    whenToUse:
      "Úsalo cuando confirmaste que la persona actual no es quien debe llevar este tema.",
    avoidWhen:
      "Evítalo si el contacto sigue siendo útil y solo necesitas sumar a alguien más.",
  },
  referred_to_other_contact: {
    optionHint: "cuando te mandaron con otra persona",
    whenToUse:
      "Úsalo cuando el propio contacto te refirió a otra persona como siguiente paso correcto.",
    avoidWhen:
      "Evítalo si la redirección es hacia otra área completa, no solo hacia otra persona.",
  },
  account_potential_other_use_case: {
    optionHint: "cuando la cuenta tiene otra posibilidad viable",
    whenToUse:
      "Úsalo cuando el caso original no madura, pero detectaste otro frente útil dentro de la misma cuenta.",
    avoidWhen:
      "Evítalo si aún no sabes cuál sería el nuevo frente o si el caso realmente ya no tiene potencial.",
  },
  offer_not_relevant_current_area: {
    optionHint: "cuando la oferta no aplica a esta área",
    whenToUse:
      "Úsalo cuando la propuesta no encaja con el área actual, pero podría hacerlo en otra parte de la cuenta.",
    avoidWhen:
      "Evítalo si el problema es solo de agenda o si la cuenta debe cerrarse por completo.",
  },
  no_current_initiative: {
    optionHint: "cuando hoy no existe iniciativa real",
    whenToUse:
      "Úsalo cuando quieres cerrar temporalmente porque hoy no hay proyecto, prioridad ni intención de avanzar.",
    avoidWhen:
      "Evítalo si todavía existe una fecha razonable de trabajo activo sin necesidad de cerrar el lead.",
  },
  no_interest_definitive: {
    optionHint: "cuando ya no hay interés recuperable",
    whenToUse:
      "Úsalo cuando el prospecto dejó claro que no existe interés real en continuar.",
    avoidWhen:
      "Evítalo si solo se trata de un aplazamiento temporal o una barrera presupuestal transitoria.",
  },
  do_not_contact_requested: {
    optionHint: "cuando piden explícitamente no volver a contactar",
    whenToUse:
      "Úsalo cuando el prospecto solicita de forma expresa no recibir más contacto comercial.",
    avoidWhen:
      "Evítalo si el cliente solo pidió reagendar o bajar intensidad, pero no cortar contacto.",
  },
};

const LEAD_CALL_OUTCOME_ACTION_GUIDE = {
  collect_missing_context: {
    optionHint: "reunir lo que falta antes de avanzar",
    whenToUse:
      "Úsala cuando aún debes aclarar contexto comercial, técnico o decisional antes de mover el lead.",
    avoidWhen:
      "Evítala si ya está claro que el siguiente paso es reunión, recontacto o cierre.",
  },
  schedule_meeting: {
    optionHint: "dejar cerrada la siguiente reunión",
    whenToUse:
      "Úsala cuando el objetivo inmediato es confirmar agenda, participantes y fecha de la siguiente reunión.",
    avoidWhen:
      "Evítala si todavía falta interés real o si el caso debe esperar para más adelante.",
  },
  revisit_on_date: {
    optionHint: "poner una fecha concreta de regreso",
    whenToUse:
      "Úsala cuando el lead no debe trabajarse ahora, pero sí conviene fijar un recontacto formal.",
    avoidWhen:
      "Evítala si el caso ya debe cerrarse de forma definitiva o si hace falta redirigirlo a otra persona o área.",
  },
  contact_referred_person: {
    optionHint: "mover la gestión a la persona correcta",
    whenToUse:
      "Úsala cuando ya tienes un nombre o referencia concreta de la persona a la que debes contactar después.",
    avoidWhen:
      "Evítala si la redirección todavía no apunta a una persona específica.",
  },
  explore_other_area: {
    optionHint: "redirigir el caso a otro frente interno",
    whenToUse:
      "Úsala cuando el valor puede existir en otra área, unidad o caso de uso dentro de la misma cuenta.",
    avoidWhen:
      "Evítala si el ajuste real es solo a otro contacto de la misma área o si el caso ya debe cerrarse.",
  },
  close_as_disqualified: {
    optionHint: "cerrar el lead y no seguir trabajándolo",
    whenToUse:
      "Úsala cuando la conclusión correcta es descalificar el caso y cerrar la gestión comercial.",
    avoidWhen:
      "Evítala si aún existe una ventana razonable para recontacto o redirección.",
  },
  mark_do_not_contact: {
    optionHint: "cerrar y bloquear nuevo contacto comercial",
    whenToUse:
      "Úsala cuando el prospecto pidió explícitamente no volver a ser contactado.",
    avoidWhen:
      "Evítala si solo pidió hablar después o si el cierre definitivo no incluye esa restricción.",
  },
};

export function getLeadCallOutcomeSubstatusGuide(code) {
  return LEAD_CALL_OUTCOME_SUBSTATUS_GUIDE[code] || null;
}

export function getLeadCallOutcomeReasonGuide(code) {
  return LEAD_CALL_OUTCOME_REASON_GUIDE[code] || null;
}

export function getLeadCallOutcomeActionGuide(code) {
  return LEAD_CALL_OUTCOME_ACTION_GUIDE[code] || null;
}