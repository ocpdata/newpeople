const NUMBER_WORDS = new Map([
  ["un", 1],
  ["uno", 1],
  ["dos", 2],
  ["tres", 3],
  ["cuatro", 4],
  ["cinco", 5],
  ["seis", 6],
  ["siete", 7],
  ["ocho", 8],
  ["nueve", 9],
  ["diez", 10],
  ["once", 11],
  ["doce", 12],
  ["trece", 13],
  ["catorce", 14],
  ["quince", 15],
  ["dieciseis", 16],
  ["diecisiete", 17],
  ["dieciocho", 18],
  ["diecinueve", 19],
  ["veinte", 20],
  ["veintiuno", 21],
  ["veintidos", 22],
  ["veintitres", 23],
  ["veinticuatro", 24],
  ["veinticinco", 25],
  ["veintiseis", 26],
  ["veintisiete", 27],
  ["veintiocho", 28],
  ["veintinueve", 29],
  ["treinta", 30],
  ["cuarenta", 40],
  ["cincuenta", 50],
  ["sesenta", 60],
]);

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const PERIOD_UNIT_WORDS = new Map([
  ["uno", 1],
  ["una", 1],
  ["dos", 2],
  ["tres", 3],
  ["cuatro", 4],
  ["cinco", 5],
  ["seis", 6],
  ["siete", 7],
  ["ocho", 8],
  ["nueve", 9],
]);
const MAX_RANGE_DAYS = 366 * 5;

export function isCustomerContactHistoryQuestion(question = "") {
  const text = normalizeText(question);
  return (
    /\bcontactos?\b/.test(text) &&
    /\b(?:lista|listar|muestr|mostrar|todos?|todas?)\b/.test(text) &&
    /\b(?:datos?|informacion|historial|interacciones?|actividades?)\b/.test(
      text,
    )
  );
}

export function isCustomerConversationFollowUp(question = "") {
  const text = normalizeText(question)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return (
    /\b(?:y que paso|que paso despues|y despues|y luego|y cual|y cuales|y quien|y quienes|y que mas|y tambien|ademas de eso|y sus|y su|ese mismo|esa misma|lo anterior|eso que mencionas)\b/.test(
      text,
    ) || /^(?:y|tambien|ademas)\b/.test(text)
  );
}

function getHistoryStartDate(now, months) {
  const date = new Date(now);
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const lastDayOfMonth = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(originalDay, lastDayOfMonth));
  return date.toISOString().slice(0, 10);
}

function getRelativeStartDate(now, amount, unit) {
  const date = new Date(now);
  if (unit.startsWith("dia")) {
    date.setUTCDate(date.getUTCDate() - amount);
    return date.toISOString().slice(0, 10);
  }
  if (unit.startsWith("semana")) {
    date.setUTCDate(date.getUTCDate() - amount * 7);
    return date.toISOString().slice(0, 10);
  }
  const months = unit.startsWith("ano") ? amount * 12 : amount;
  return getHistoryStartDate(date, months);
}

function parsePeriodAmount(value) {
  const text = String(value || "").trim();
  const numeric = Number(text);
  if (numeric) return numeric;
  const direct = NUMBER_WORDS.get(text);
  if (direct) return direct;
  const compound = text.match(/^(treinta|cuarenta|cincuenta) y (.+)$/);
  const tens = compound
    ? { treinta: 30, cuarenta: 40, cincuenta: 50 }[compound[1]]
    : 0;
  return tens + (PERIOD_UNIT_WORDS.get(compound?.[2]) || 0);
}

function exactRange(startDate, endDate, months = null) {
  if (
    !isValidDateOnly(startDate) ||
    !isValidDateOnly(endDate) ||
    startDate > endDate ||
    new Date(`${endDate}T00:00:00.000Z`).getTime() -
      new Date(`${startDate}T00:00:00.000Z`).getTime() >
      MAX_RANGE_DAYS * 86400000
  ) {
    return null;
  }
  return { months, startDate, endDate };
}

function parseActivityRangeText(text, now) {
  const endDate = new Date(now).toISOString().slice(0, 10);
  const explicitRange = text.match(
    /\b(?:desde\s+(?:el\s+)?|del\s+|entre\s+)(\d{4}-\d{2}-\d{2})\s+(?:hasta\s+|al\s+|a\s+|y\s+)(\d{4}-\d{2}-\d{2})\b/,
  );
  if (explicitRange) return exactRange(explicitRange[1], explicitRange[2]);
  const sinceDate = text.match(/\bdesde\s+(?:el\s+)?(\d{4}-\d{2}-\d{2})\b/);
  if (sinceDate) return exactRange(sinceDate[1], endDate);

  const quarter = text.match(
    /\b(?:q([1-4])\s*(20\d{2})|(primer|segundo|tercer|cuarto)\s+trimestre(?:\s+de)?\s*(20\d{2}))\b/,
  );
  if (quarter) {
    const year = Number(quarter[2] || quarter[4]);
    const quarterNumber = Number(
      quarter[1] ||
        { primer: 1, segundo: 2, tercer: 3, cuarto: 4 }[quarter[3]] ||
        0,
    );
    if (quarterNumber) {
      const firstMonth = (quarterNumber - 1) * 3;
      const start = new Date(Date.UTC(year, firstMonth, 1));
      const end = new Date(Date.UTC(year, firstMonth + 3, 0));
      return exactRange(
        start.toISOString().slice(0, 10),
        end.toISOString().slice(0, 10),
        3,
      );
    }
  }

  const lastCalendarYear = text.match(/\b(?:ano|ejercicio)\s+pasado\b/);
  if (lastCalendarYear) {
    const year = new Date(now).getUTCFullYear() - 1;
    return exactRange(`${year}-01-01`, `${year}-12-31`, 12);
  }
  const thisCalendarYear = text.match(
    /\b(?:este|actual)\s+(?:ano|ejercicio)\b/,
  );
  if (thisCalendarYear) {
    return exactRange(`${new Date(now).getUTCFullYear()}-01-01`, endDate, null);
  }

  const relative = text.match(
    /\b(?:ultim[oa]s?|pasad[oa]s?|anteriores?)\s+(\d+|[a-z]+(?:\s+y\s+[a-z]+)?)\s+(dias?|semanas?|mes(?:es)?|anos?)\b/,
  );
  if (relative) {
    const amount = parsePeriodAmount(relative[1]);
    const unit = relative[2];
    if (!amount || amount > (unit.startsWith("dia") ? 366 : 60)) return null;
    const months = unit.startsWith("ano")
      ? amount * 12
      : unit.startsWith("mes")
        ? amount
        : null;
    if (months !== null && months > 60) return null;
    return exactRange(getRelativeStartDate(now, amount, unit), endDate, months);
  }

  if (/\b(?:ultimo|pasado)\s+trimestre\b/.test(text)) {
    return exactRange(getHistoryStartDate(now, 3), endDate, 3);
  }
  if (/\b(?:ultimo|pasado)\s+semestre\b/.test(text)) {
    return exactRange(getHistoryStartDate(now, 6), endDate, 6);
  }
  if (/\b(?:ultimo|pasado)\s+ano\b/.test(text)) {
    return exactRange(getHistoryStartDate(now, 12), endDate, 12);
  }
  if (/\beste\s+trimestre\b/.test(text)) {
    const current = new Date(now);
    const quarterStartMonth = Math.floor(current.getUTCMonth() / 3) * 3;
    const start = new Date(
      Date.UTC(current.getUTCFullYear(), quarterStartMonth, 1),
    );
    return exactRange(start.toISOString().slice(0, 10), endDate, null);
  }
  return null;
}

function isValidDateOnly(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text
  );
}

export function getCustomerActivityHistoryRangeFromFilters(
  filters = {},
  now = new Date(),
) {
  const startDate = String(filters.startDate || "");
  const endDate = String(filters.endDate || "");
  if (
    isValidDateOnly(startDate) &&
    isValidDateOnly(endDate) &&
    startDate <= endDate &&
    new Date(`${endDate}T00:00:00.000Z`).getTime() -
      new Date(`${startDate}T00:00:00.000Z`).getTime() <=
      MAX_RANGE_DAYS * 86400000
  ) {
    return {
      months: Number(filters.periodMonths || 0) || null,
      startDate,
      endDate,
    };
  }
  const months = Number(filters.periodMonths || 0);
  if (!Number.isInteger(months) || months < 1 || months > 60) return null;
  return {
    months,
    startDate: getHistoryStartDate(now, months),
    endDate: new Date(now).toISOString().slice(0, 10),
  };
}

export function getCustomerActivityHistoryRange(question, now = new Date()) {
  const text = normalizeText(question);
  const hasPeriod =
    /\b(?:ultim[oa]s?|pasad[oa]s?|anteriores?|este|actual|primer|segundo|tercer|cuarto)\s+(?:\d+|[a-z]+)(?:\s+y\s+[a-z]+)?\s*(?:dias?|semanas?|mes(?:es)?|anos?|trimestre|semestre|ejercicio)\b/.test(
      text,
    ) ||
    /\bq[1-4]\s*20\d{2}\b|\b(?:primer|segundo|tercer|cuarto)\s+trimestre(?:\s+de)?\s+20\d{2}\b|\b(?:este|actual|pasado)\s+(?:ano|ejercicio)\b|\b(?:desde|del|entre)\s+\d{4}-\d{2}-\d{2}\b/.test(
      text,
    );
  if (
    !/\b(?:interacciones?|actividades?)\b/.test(text) ||
    (!/\b(?:todas?|todos?|historial|lista|muestr|mostrar)\b/.test(text) &&
      !hasPeriod)
  ) {
    return null;
  }
  return parseActivityRangeText(text, now);
}

function recordDate(record, type) {
  const value =
    type === "activity"
      ? record.scheduledAt ||
        record.dueDate ||
        record.due_date ||
        record.createdAt
      : record.createdAt || record.created_at || record.updatedAt;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toISOString().slice(0, 10)
    : "";
}

function withinRange(record, type, startDate, endDate) {
  const date = recordDate(record, type);
  return date && date >= startDate && date <= endDate;
}

function describeRecord(record, type) {
  const parts = [
    recordDate(record, type),
    record.title ||
      (type === "activity" ? "Actividad sin título" : "Interacción sin título"),
  ].filter(Boolean);
  if (type === "activity" && record.opportunityName) {
    parts.push(`oportunidad: ${record.opportunityName}`);
  }
  if (type === "activity" && record.activityType) {
    parts.push(record.activityType);
  }
  if (type === "activity" && record.status) {
    parts.push(`estado: ${record.status}`);
  }
  const details = record.summary || record.notes || record.sourceNotes;
  if (details) parts.push(String(details).trim());
  return parts.join(" · ");
}

function createHistoryItem(record, type, id = null) {
  return {
    id: Number(record.id || id || 0),
    date: recordDate(record, type),
    title:
      record.title ||
      (type === "activity" ? "Actividad sin título" : "Interacción sin título"),
    opportunityName: record.opportunityName || "",
    activityType: record.activityType || record.actionType || "",
    status: record.status || "",
    details:
      record.summary ||
      [record.notes, record.sourceNotes, record.successCriteria]
        .filter(Boolean)
        .join(" · "),
  };
}

export function buildCustomerActivityHistoryResponse(
  snapshot,
  question,
  now = new Date(),
) {
  const range = getCustomerActivityHistoryRange(question, now);
  if (!range) return null;
  const accountName = snapshot?.account?.name || "la cuenta seleccionada";
  const interactionsAllowed =
    snapshot?.permissions?.canReadInteractions === true;
  const activitiesAllowed =
    snapshot?.permissions?.canReadOpportunityActivities === true;
  const calendarActivitiesAllowed =
    snapshot?.permissions?.canReadCalendarActivities === true;
  const canReadAllCalendarActivities =
    snapshot?.permissions?.canReadAllCalendarActivities === true;
  const interactions = interactionsAllowed
    ? (snapshot.interactions || []).filter((item) =>
        withinRange(item, "interaction", range.startDate, range.endDate),
      )
    : [];
  const activities = activitiesAllowed
    ? (snapshot.opportunityActivities || []).filter((item) =>
        withinRange(item, "activity", range.startDate, range.endDate),
      )
    : [];
  const calendarActivities = calendarActivitiesAllowed
    ? (snapshot.calendarActivities || []).filter((item) =>
        withinRange(item, "activity", range.startDate, range.endDate),
      )
    : [];
  const sections = [
    {
      key: "interactions",
      title: "Interacciones",
      singular: "interacción",
      plural: "interacciones",
      available: interactionsAllowed,
      unavailableMessage:
        "No tienes permiso de lectura para consultar interacciones.",
      items: interactions.map((item) => createHistoryItem(item, "interaction")),
    },
    {
      key: "opportunityActivities",
      title: "Actividades de oportunidades",
      singular: "actividad de oportunidad",
      plural: "actividades de oportunidades",
      available: activitiesAllowed,
      unavailableMessage:
        "No tienes permiso de lectura para consultar actividades de oportunidades.",
      items: activities.map((item) => createHistoryItem(item, "activity")),
    },
    {
      key: "calendarActivities",
      title: canReadAllCalendarActivities
        ? "Actividades de calendario"
        : "Actividades de calendario visibles en tu alcance",
      singular: "actividad de calendario",
      plural: "actividades de calendario",
      available: calendarActivitiesAllowed,
      unavailableMessage:
        "No tienes permiso de lectura para consultar actividades de calendario.",
      items: calendarActivities.map((item) =>
        createHistoryItem(item, "activity"),
      ),
    },
  ];
  const counts = sections
    .filter((section) => section.available)
    .map((section) => {
      const count = section.items.length;
      return `${count} ${count === 1 ? section.singular : section.plural}`;
    });
  const rangeLabel = range.months
    ? `${range.months} meses`
    : `del ${range.startDate} al ${range.endDate}`;
  const answer = `Historial de ${accountName} · ${rangeLabel} · ${counts.join(" · ")}.`;
  const queriedSections = sections.filter((section) => section.available);
  const evidence = queriedSections.length
    ? [
        `Historial CRM de ${accountName} consultado del ${range.startDate} al ${range.endDate}: ${queriedSections.map((section) => `${section.items.length} ${section.items.length === 1 ? section.singular : section.plural}`).join(", ")}.`,
      ]
    : [];
  return {
    answer,
    evidence,
    inferences: [],
    confidence: "high",
    recommendedActions: [],
    source: "account_intelligence",
    activityHistory: {
      range,
      sections,
    },
  };
}

export function buildCustomerContactHistoryResponse(snapshot, question) {
  if (!isCustomerContactHistoryQuestion(question)) return null;
  const accountName = snapshot?.account?.name || "la cuenta seleccionada";
  const contactsAllowed = snapshot?.permissions?.canReadContacts === true;
  const interactionsAllowed =
    snapshot?.permissions?.canReadInteractions === true;
  const accountId = Number(snapshot?.account?.id || 0);
  const interactions = interactionsAllowed
    ? (snapshot.interactions || []).filter(
        (interaction) => Number(interaction.accountId || 0) === accountId,
      )
    : [];
  const contacts = contactsAllowed
    ? (snapshot.contacts || []).map((contact) => ({
        id: Number(contact.id),
        name: contact.name || "Contacto sin nombre",
        email: contact.email || "",
        phone: contact.phone || "",
        mobile: contact.mobile || "",
        positionTitle: contact.positionTitle || "",
        department: contact.department || "",
        activationStatusCode: contact.activationStatusCode || "",
        purchaseParticipation: contact.purchaseParticipation || "",
        hierarchyLevel: contact.hierarchyLevel || "",
        relationshipType: contact.relationshipType || "",
        influenceLevel: contact.influenceLevel || "",
        interactionHistoryAvailable: interactionsAllowed,
        interactions: interactions
          .filter((interaction) =>
            (interaction.contactIds || []).some(
              (contactId) => Number(contactId) === Number(contact.id),
            ),
          )
          .map((interaction) => ({
            ...createHistoryItem(interaction, "interaction"),
            status: interaction.analysisStatus || "",
          })),
      }))
    : [];
  const interactionCount = contacts.reduce(
    (total, contact) => total + contact.interactions.length,
    0,
  );
  return {
    answer: contactsAllowed
      ? `Contactos de ${accountName} · ${contacts.length} contactos${interactionsAllowed ? ` · ${interactionCount} interacciones vinculadas` : " · historial de interacciones no disponible por permisos"}.`
      : `No tienes permiso para consultar los contactos de ${accountName}.`,
    evidence: [
      contactsAllowed
        ? `Contactos CRM autorizados de ${accountName}: ${contacts.length}; interacciones vinculadas consultadas: ${interactionCount}.`
        : `Consulta de contactos de ${accountName} limitada por permisos CRM.`,
    ],
    inferences: [],
    confidence: "high",
    recommendedActions: [],
    source: "account_intelligence",
    activityHistory: {
      mode: "contact_history",
      contacts,
      contactsAvailable: contactsAllowed,
      interactionsAvailable: interactionsAllowed,
      unavailableMessage:
        "No tienes permiso de lectura para consultar el historial de interacciones.",
    },
  };
}
