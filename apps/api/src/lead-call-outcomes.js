export function parseDateOnlyText(value) {
  const candidate = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(candidate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  return date.toISOString().slice(0, 10) === candidate ? date : null;
}


export const LEAD_STATUS_CATALOG = [
  {
    code: "created",
    name: "Creado",
    description: "Lead creado, aún sin validación comercial suficiente.",
    displayOrder: 1,
    isTerminal: false,
  },
  {
    code: "lead_unassigned",
    name: "Lead no asignado",
    description:
      "Ya existe contexto comercial mínimo, pero aún no hay vendedor asignado.",
    displayOrder: 2,
    isTerminal: false,
  },
  {
    code: "lead_assigned",
    name: "Lead asignado",
    description:
      "Ya existe vendedor responsable, pero aún no hay oportunidad creada.",
    displayOrder: 3,
    isTerminal: false,
  },
  {
    code: "lead_qualified",
    name: "Lead calificado",
    description: "El lead ya derivó en una oportunidad.",
    displayOrder: 4,
    isTerminal: true,
  },
  {
    code: "lead_disqualified",
    name: "Lead descalificado",
    description: "El camino comercial actual fue cerrado negativamente.",
    displayOrder: 5,
    isTerminal: true,
  },
];
export const LEAD_SUBSTATUS_CATALOG = [
  {
    code: "new_unreviewed",
    name: "Nuevo sin revisar",
    description: "Aún no se revisa el lead ni su evidencia.",
    category: "inicio",
    displayOrder: 1,
  },
  {
    code: "research_pending",
    name: "Investigación pendiente",
    description: "Falta información antes de contactar.",
    category: "inicio",
    displayOrder: 2,
  },
  {
    code: "ready_for_outreach",
    name: "Listo para contacto",
    description: "Ya puede ser trabajado comercialmente.",
    category: "inicio",
    displayOrder: 3,
  },
  {
    code: "contact_attempt_pending",
    name: "Intento de contacto pendiente",
    description: "Falta ejecutar o reintentar contacto.",
    category: "contacto",
    displayOrder: 4,
  },
  {
    code: "contacted_waiting_response",
    name: "Contactado, en espera de respuesta",
    description: "Ya hubo contacto, pero no hay definición aún.",
    category: "contacto",
    displayOrder: 5,
  },
  {
    code: "meeting_requested",
    name: "Reunión solicitada",
    description: "Se pidió reunión y está pendiente confirmar.",
    category: "avance",
    displayOrder: 6,
  },
  {
    code: "meeting_confirmed",
    name: "Reunión confirmada",
    description: "Existe siguiente reunión acordada.",
    category: "avance",
    displayOrder: 7,
  },
  {
    code: "needs_follow_up_later",
    name: "Seguimiento posterior",
    description: "Debe retomarse más adelante.",
    category: "nurture",
    displayOrder: 8,
  },
  {
    code: "wrong_contact_identified",
    name: "Contacto incorrecto detectado",
    description: "La persona actual no es la adecuada.",
    category: "redireccion",
    displayOrder: 9,
  },
  {
    code: "alternative_contact_needed",
    name: "Se necesita contacto alternativo",
    description: "Hace falta ubicar otra persona.",
    category: "redireccion",
    displayOrder: 10,
  },
  {
    code: "account_has_other_potential",
    name: "La cuenta tiene potencial adicional",
    description: "Otra área o caso de uso puede ser viable.",
    category: "redireccion",
    displayOrder: 11,
  },
  {
    code: "value_misaligned_current_contact",
    name: "Valor no alineado con este contacto",
    description: "La propuesta no resonó con este interlocutor.",
    category: "redireccion",
    displayOrder: 12,
  },
  {
    code: "budget_timing_issue",
    name: "Restricción de presupuesto",
    description: "Hay potencial, pero no presupuesto actual.",
    category: "nurture",
    displayOrder: 13,
  },
  {
    code: "priority_not_now",
    name: "No es prioridad ahora",
    description: "El tema no está en foco hoy.",
    category: "nurture",
    displayOrder: 14,
  },
  {
    code: "qualified_opportunity_created",
    name: "Oportunidad creada",
    description: "El lead ya se convirtió en oportunidad.",
    category: "cierre_positivo",
    displayOrder: 15,
  },
  {
    code: "disqualified_temporary",
    name: "Descalificación temporal",
    description: "Se cierra por ahora, pero puede reabrirse.",
    category: "cierre_negativo",
    displayOrder: 16,
  },
  {
    code: "disqualified_definitive",
    name: "Descalificación definitiva",
    description: "Se cierra sin expectativa razonable de retorno.",
    category: "cierre_negativo",
    displayOrder: 17,
  },
];
export const LEAD_REASON_CATALOG = [
  {
    code: "interest_confirmed",
    name: "Interés confirmado",
    reasonGroup: "avance",
    suggestsDisqualification: false,
    requiresComment: false,
    displayOrder: 1,
  },
  {
    code: "meeting_accepted",
    name: "Aceptó siguiente reunión",
    reasonGroup: "avance",
    suggestsDisqualification: false,
    requiresComment: false,
    displayOrder: 2,
  },
  {
    code: "business_pain_confirmed",
    name: "Dolor o necesidad validada",
    reasonGroup: "avance",
    suggestsDisqualification: false,
    requiresComment: false,
    displayOrder: 3,
  },
  {
    code: "project_identified",
    name: "Proyecto identificado",
    reasonGroup: "avance",
    suggestsDisqualification: false,
    requiresComment: false,
    displayOrder: 4,
  },
  {
    code: "decision_process_started",
    name: "Se inició proceso de decisión",
    reasonGroup: "avance",
    suggestsDisqualification: false,
    requiresComment: false,
    displayOrder: 5,
  },
  {
    code: "opportunity_created",
    name: "Se creó oportunidad",
    reasonGroup: "avance",
    suggestsDisqualification: false,
    requiresComment: false,
    displayOrder: 6,
  },
  {
    code: "follow_up_later_requested",
    name: "Pidió hablar después",
    reasonGroup: "seguimiento",
    suggestsDisqualification: false,
    requiresComment: false,
    displayOrder: 7,
  },
  {
    code: "timing_not_right",
    name: "El momento no es adecuado",
    reasonGroup: "seguimiento",
    suggestsDisqualification: false,
    requiresComment: false,
    displayOrder: 8,
  },
  {
    code: "budget_next_cycle",
    name: "Presupuesto en otro ciclo",
    reasonGroup: "seguimiento",
    suggestsDisqualification: false,
    requiresComment: false,
    displayOrder: 9,
  },
  {
    code: "waiting_internal_alignment",
    name: "Espera alineación interna",
    reasonGroup: "seguimiento",
    suggestsDisqualification: false,
    requiresComment: false,
    displayOrder: 10,
  },
  {
    code: "wrong_contact",
    name: "No es la persona correcta",
    reasonGroup: "redireccion",
    suggestsDisqualification: false,
    requiresComment: false,
    displayOrder: 11,
  },
  {
    code: "referred_to_other_contact",
    name: "Refirió a otro contacto",
    reasonGroup: "redireccion",
    suggestsDisqualification: false,
    requiresComment: false,
    displayOrder: 12,
  },
  {
    code: "referred_to_other_area",
    name: "Refirió a otra área",
    reasonGroup: "redireccion",
    suggestsDisqualification: false,
    requiresComment: false,
    displayOrder: 13,
  },
  {
    code: "needs_more_information",
    name: "Falta más información",
    reasonGroup: "seguimiento",
    suggestsDisqualification: false,
    requiresComment: false,
    displayOrder: 14,
  },
  {
    code: "value_not_clear_yet",
    name: "Aún no queda claro el valor",
    reasonGroup: "seguimiento",
    suggestsDisqualification: false,
    requiresComment: false,
    displayOrder: 15,
  },
  {
    code: "account_potential_other_use_case",
    name: "La cuenta tiene potencial en otro caso de uso",
    reasonGroup: "redireccion",
    suggestsDisqualification: false,
    requiresComment: false,
    displayOrder: 16,
  },
  {
    code: "not_interested_current_contact",
    name: "No le interesa a este contacto",
    reasonGroup: "redireccion",
    suggestsDisqualification: false,
    requiresComment: true,
    displayOrder: 17,
  },
  {
    code: "offer_not_relevant_current_area",
    name: "La oferta no aplica a esta área",
    reasonGroup: "redireccion",
    suggestsDisqualification: false,
    requiresComment: true,
    displayOrder: 18,
  },
  {
    code: "incumbent_provider_in_place",
    name: "Ya cuentan con otra solución",
    reasonGroup: "objecion",
    suggestsDisqualification: false,
    requiresComment: true,
    displayOrder: 19,
  },
  {
    code: "no_current_initiative",
    name: "No existe iniciativa actual",
    reasonGroup: "cierre_temporal",
    suggestsDisqualification: true,
    requiresComment: true,
    displayOrder: 20,
  },
  {
    code: "priority_shifted",
    name: "Cambio de prioridad",
    reasonGroup: "seguimiento",
    suggestsDisqualification: false,
    requiresComment: false,
    displayOrder: 21,
  },
  {
    code: "no_interest_definitive",
    name: "No hay interés definitivo",
    reasonGroup: "cierre_definitivo",
    suggestsDisqualification: true,
    requiresComment: true,
    displayOrder: 22,
  },
  {
    code: "no_fit",
    name: "No hay encaje",
    reasonGroup: "cierre_definitivo",
    suggestsDisqualification: true,
    requiresComment: true,
    displayOrder: 23,
  },
  {
    code: "no_budget_no_plan",
    name: "Sin presupuesto ni plan",
    reasonGroup: "cierre_definitivo",
    suggestsDisqualification: true,
    requiresComment: true,
    displayOrder: 24,
  },
  {
    code: "account_closed_to_change",
    name: "Cuenta cerrada al cambio",
    reasonGroup: "cierre_definitivo",
    suggestsDisqualification: true,
    requiresComment: true,
    displayOrder: 25,
  },
  {
    code: "duplicate_or_invalid_lead",
    name: "Lead duplicado o inválido",
    reasonGroup: "higiene",
    suggestsDisqualification: true,
    requiresComment: true,
    displayOrder: 26,
  },
  {
    code: "do_not_contact_requested",
    name: "Solicita no ser contactado",
    reasonGroup: "cierre_definitivo",
    suggestsDisqualification: true,
    requiresComment: true,
    displayOrder: 27,
  },
  {
    code: "outside_target_market",
    name: "Fuera del mercado objetivo",
    reasonGroup: "cierre_definitivo",
    suggestsDisqualification: true,
    requiresComment: true,
    displayOrder: 28,
  },
];
export const LEAD_REQUIRED_ACTION_CATALOG = [
  {
    code: "schedule_meeting",
    name: "Agendar reunión",
    requiresDueDate: true,
    requiresContactReference: false,
    requiresAreaReference: false,
    displayOrder: 1,
  },
  {
    code: "send_follow_up_message",
    name: "Enviar seguimiento",
    requiresDueDate: false,
    requiresContactReference: false,
    requiresAreaReference: false,
    displayOrder: 2,
  },
  {
    code: "retry_contact",
    name: "Reintentar contacto",
    requiresDueDate: true,
    requiresContactReference: false,
    requiresAreaReference: false,
    displayOrder: 3,
  },
  {
    code: "contact_referred_person",
    name: "Contactar a la persona referida",
    requiresDueDate: false,
    requiresContactReference: true,
    requiresAreaReference: false,
    displayOrder: 4,
  },
  {
    code: "explore_other_area",
    name: "Explorar otra área",
    requiresDueDate: false,
    requiresContactReference: false,
    requiresAreaReference: true,
    displayOrder: 5,
  },
  {
    code: "revisit_on_date",
    name: "Definir fecha de recontacto",
    requiresDueDate: true,
    requiresContactReference: false,
    requiresAreaReference: false,
    displayOrder: 6,
  },
  {
    code: "collect_missing_context",
    name: "Completar contexto",
    requiresDueDate: false,
    requiresContactReference: false,
    requiresAreaReference: false,
    displayOrder: 7,
  },
  {
    code: "create_opportunity",
    name: "Crear oportunidad",
    requiresDueDate: false,
    requiresContactReference: false,
    requiresAreaReference: false,
    displayOrder: 8,
  },
  {
    code: "close_as_disqualified",
    name: "Cerrar como descalificado",
    requiresDueDate: false,
    requiresContactReference: false,
    requiresAreaReference: false,
    displayOrder: 9,
  },
  {
    code: "mark_do_not_contact",
    name: "Marcar como no contactar",
    requiresDueDate: false,
    requiresContactReference: false,
    requiresAreaReference: false,
    displayOrder: 10,
  },
];
function buildLeadCallOutcomeRulesForStatus(currentStatusCode) {
  return [
    {
      currentStatusCode,
      substatusCode: "contact_attempt_pending",
      reasonCode: "needs_more_information",
      requiredActionCode: "collect_missing_context",
      resultStatusCode: currentStatusCode,
      requiresDueDate: false,
      requiresComment: false,
      requiresReferredContact: false,
      requiresReferredArea: false,
    },
    {
      currentStatusCode,
      substatusCode: "meeting_requested",
      reasonCode: "interest_confirmed",
      requiredActionCode: "schedule_meeting",
      resultStatusCode: currentStatusCode,
      requiresDueDate: true,
      requiresComment: false,
      requiresReferredContact: false,
      requiresReferredArea: false,
    },
    {
      currentStatusCode,
      substatusCode: "meeting_confirmed",
      reasonCode: "meeting_accepted",
      requiredActionCode: "schedule_meeting",
      resultStatusCode: currentStatusCode,
      requiresDueDate: true,
      requiresComment: false,
      requiresReferredContact: false,
      requiresReferredArea: false,
    },
    {
      currentStatusCode,
      substatusCode: "needs_follow_up_later",
      reasonCode: "follow_up_later_requested",
      requiredActionCode: "revisit_on_date",
      resultStatusCode: currentStatusCode,
      requiresDueDate: true,
      requiresComment: false,
      requiresReferredContact: false,
      requiresReferredArea: false,
    },
    {
      currentStatusCode,
      substatusCode: "budget_timing_issue",
      reasonCode: "budget_next_cycle",
      requiredActionCode: "revisit_on_date",
      resultStatusCode: currentStatusCode,
      requiresDueDate: true,
      requiresComment: false,
      requiresReferredContact: false,
      requiresReferredArea: false,
    },
    {
      currentStatusCode,
      substatusCode: "priority_not_now",
      reasonCode: "timing_not_right",
      requiredActionCode: "revisit_on_date",
      resultStatusCode: currentStatusCode,
      requiresDueDate: true,
      requiresComment: false,
      requiresReferredContact: false,
      requiresReferredArea: false,
    },
    {
      currentStatusCode,
      substatusCode: "wrong_contact_identified",
      reasonCode: "wrong_contact",
      requiredActionCode: "contact_referred_person",
      resultStatusCode: currentStatusCode,
      requiresDueDate: false,
      requiresComment: false,
      requiresReferredContact: true,
      requiresReferredArea: false,
    },
    {
      currentStatusCode,
      substatusCode: "alternative_contact_needed",
      reasonCode: "referred_to_other_contact",
      requiredActionCode: "contact_referred_person",
      resultStatusCode: currentStatusCode,
      requiresDueDate: false,
      requiresComment: false,
      requiresReferredContact: true,
      requiresReferredArea: false,
    },
    {
      currentStatusCode,
      substatusCode: "account_has_other_potential",
      reasonCode: "account_potential_other_use_case",
      requiredActionCode: "explore_other_area",
      resultStatusCode: currentStatusCode,
      requiresDueDate: false,
      requiresComment: true,
      requiresReferredContact: false,
      requiresReferredArea: true,
    },
    {
      currentStatusCode,
      substatusCode: "value_misaligned_current_contact",
      reasonCode: "offer_not_relevant_current_area",
      requiredActionCode: "explore_other_area",
      resultStatusCode: currentStatusCode,
      requiresDueDate: false,
      requiresComment: true,
      requiresReferredContact: false,
      requiresReferredArea: true,
    },
    {
      currentStatusCode,
      substatusCode: "disqualified_temporary",
      reasonCode: "no_current_initiative",
      requiredActionCode: "revisit_on_date",
      resultStatusCode: "lead_disqualified",
      requiresDueDate: true,
      requiresComment: true,
      requiresReferredContact: false,
      requiresReferredArea: false,
    },
    {
      currentStatusCode,
      substatusCode: "disqualified_definitive",
      reasonCode: "no_interest_definitive",
      requiredActionCode: "close_as_disqualified",
      resultStatusCode: "lead_disqualified",
      requiresDueDate: false,
      requiresComment: true,
      requiresReferredContact: false,
      requiresReferredArea: false,
    },
    {
      currentStatusCode,
      substatusCode: "disqualified_definitive",
      reasonCode: "do_not_contact_requested",
      requiredActionCode: "mark_do_not_contact",
      resultStatusCode: "lead_disqualified",
      requiresDueDate: false,
      requiresComment: true,
      requiresReferredContact: false,
      requiresReferredArea: false,
    },
  ];
}
export const LEAD_CALL_OUTCOME_RULES = [
  ...buildLeadCallOutcomeRulesForStatus("created"),
  ...buildLeadCallOutcomeRulesForStatus("lead_unassigned"),
  ...buildLeadCallOutcomeRulesForStatus("lead_assigned"),
];

export function isQualifiedLeadStatus(status) {
  return status === "lead_qualified";
}

export function isDisqualifiedLeadStatus(status) {
  return status === "lead_disqualified";
}

export function isFinalizedLeadStatus(status) {
  return isQualifiedLeadStatus(status) || isDisqualifiedLeadStatus(status);
}

export function getLeadStatusCatalogEntry(code) {
  return LEAD_STATUS_CATALOG.find((entry) => entry.code === code) || null;
}

export function getLeadReasonCatalogEntry(code) {
  return LEAD_REASON_CATALOG.find((entry) => entry.code === code) || null;
}

export function getLeadRequiredActionCatalogEntry(code) {
  return (
    LEAD_REQUIRED_ACTION_CATALOG.find((entry) => entry.code === code) || null
  );
}

export function getLeadCallOutcomeRule({
  currentStatusCode,
  substatusCode,
  reasonCode,
  requiredActionCode,
}) {
  return (
    LEAD_CALL_OUTCOME_RULES.find(
      (rule) =>
        rule.currentStatusCode === currentStatusCode &&
        rule.substatusCode === substatusCode &&
        rule.reasonCode === reasonCode &&
        rule.requiredActionCode === requiredActionCode,
    ) || null
  );
}

export function validateLeadCallOutcomeForCoach({
  currentStatusCode,
  operation,
}) {
  if (isFinalizedLeadStatus(currentStatusCode)) {
    return {
      ok: false,
      status: 409,
      code: "COACH_LEAD_FINALIZED",
      message:
        "No puedes registrar un resultado comercial en un lead finalizado",
    };
  }
  const rule = getLeadCallOutcomeRule({
    currentStatusCode,
    substatusCode: String(operation?.substatusCode || "").trim(),
    reasonCode: String(operation?.reasonCode || "").trim(),
    requiredActionCode: String(operation?.requiredActionCode || "").trim(),
  });
  if (!rule) {
    return {
      ok: false,
      status: 400,
      code: "COACH_LEAD_OUTCOME_INVALID",
      message:
        "La combinación de subestado, razón y acción no es válida para el estado actual del lead",
    };
  }
  const comment = String(operation?.comment || "").trim();
  const nextActionDueAt = String(operation?.nextActionDueAt || "").trim();
  const referredContactName = String(
    operation?.referredContactName || "",
  ).trim();
  const referredAreaName = String(operation?.referredAreaName || "").trim();
  if (rule.requiresComment && !comment) {
    return {
      ok: false,
      status: 400,
      code: "COACH_LEAD_COMMENT_REQUIRED",
      message: "Debes registrar un comentario comercial para este resultado",
    };
  }
  if (rule.requiresDueDate && !parseDateOnlyText(nextActionDueAt)) {
    return {
      ok: false,
      status: 400,
      code: "COACH_LEAD_DUE_DATE_REQUIRED",
      message:
        "Debes registrar una fecha compromiso válida para este resultado",
    };
  }
  if (nextActionDueAt && !parseDateOnlyText(nextActionDueAt)) {
    return {
      ok: false,
      status: 400,
      code: "COACH_LEAD_DUE_DATE_INVALID",
      message: "La fecha compromiso no es válida",
    };
  }
  if (rule.requiresReferredContact && !referredContactName) {
    return {
      ok: false,
      status: 400,
      code: "COACH_LEAD_CONTACT_REQUIRED",
      message: "Debes indicar la persona referida para continuar",
    };
  }
  if (rule.requiresReferredArea && !referredAreaName) {
    return {
      ok: false,
      status: 400,
      code: "COACH_LEAD_AREA_REQUIRED",
      message: "Debes indicar el área objetivo para continuar",
    };
  }
  return {
    ok: true,
    rule,
    comment,
    nextActionDueAt: nextActionDueAt || null,
    referredContactName,
    referredAreaName,
  };
}

export function getLeadCallOutcomeCatalogResponse(currentStatusCode = null) {
  const transitionRules = currentStatusCode
    ? LEAD_CALL_OUTCOME_RULES.filter(
        (rule) => rule.currentStatusCode === currentStatusCode,
      )
    : LEAD_CALL_OUTCOME_RULES;

  return {
    statuses: LEAD_STATUS_CATALOG.map((entry) => ({ ...entry })),
    substatuses: LEAD_SUBSTATUS_CATALOG.map((entry) => ({ ...entry })),
    reasons: LEAD_REASON_CATALOG.map((entry) => ({ ...entry })),
    requiredActions: LEAD_REQUIRED_ACTION_CATALOG.map((entry) => ({
      ...entry,
    })),
    transitionRules: transitionRules.map((rule) => ({
      ...rule,
      resultStatusName:
        getLeadStatusCatalogEntry(rule.resultStatusCode)?.name ||
        rule.resultStatusCode,
    })),
  };
}
