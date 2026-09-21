function toDateOnly(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const normalized = text.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function isDateInPast(value) {
  const isoDate = toDateOnly(value);
  if (!isoDate) return false;
  const today = new Date();
  const currentDate = new Date(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
  );
  const targetDate = new Date(`${isoDate}T00:00:00`);
  return targetDate.getTime() < currentDate.getTime();
}

export function buildInteractionApprovalDraft(result, fallbackNote = "") {
  const activity = result?.activity || {};
  const nextStep = result?.nextStep || {};
  const rawDateValue = String(
    activity?.scheduledAt ||
      activity?.scheduled_at ||
      activity?.scheduledDate ||
      activity?.date ||
      activity?.datetime ||
      nextStep?.dueDate ||
      "",
  ).trim();
  const rawTimeValue = String(
    activity?.scheduledTime || activity?.time || activity?.hora || "",
  ).trim();
  const dateMatch = rawDateValue.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
  const scheduledDate = dateMatch
    ? dateMatch[1]
    : /^\d{4}-\d{2}-\d{2}$/.test(rawDateValue)
      ? rawDateValue
      : /^\d{4}-\d{2}-\d{2}$/.test(String(activity?.scheduledDate || ""))
        ? String(activity.scheduledDate)
        : toDateOnly(new Date(Date.now() + 2 * 86400000).toISOString());
  const scheduledTime = dateMatch
    ? dateMatch[2]
    : /^\d{2}:\d{2}$/.test(rawTimeValue)
      ? rawTimeValue
      : /^\d{2}:\d{2}$/.test(String(activity?.scheduledTime || ""))
        ? String(activity.scheduledTime)
        : "09:00";

  return {
    activityType: String(activity?.type || "call").trim() || "call",
    objective:
      String(
        activity?.objective ||
          activity?.goal ||
          activity?.title ||
          result?.objective ||
          "",
      ).trim() || "Resultado de interacción con cliente",
    scheduledDate,
    scheduledTime,
    note: String(activity?.note || fallbackNote || "").trim(),
    nextStepTitle: String(nextStep?.title || "").trim(),
    nextStepDueDate: String(nextStep?.dueDate || "").trim(),
    nextStepSuccessCriteria: String(
      nextStep?.successCriteria || "Registrar compromiso del cliente.",
    ).trim(),
  };
}

export function inferInteractionActivityStatus(activity = {}) {
  const text = [
    activity?.title,
    activity?.note,
    activity?.result,
    activity?.summary,
    activity?.objective,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const scheduledDate = toDateOnly(
    activity?.scheduledDate || activity?.dueDate || activity?.date || "",
  );
  const isPastDate = isDateInPast(scheduledDate);

  const completionPatterns = [
    "se realizo",
    "se realizó",
    "se hizo",
    "realizo",
    "realizó",
    "realizada",
    "efectivamente",
    "confirmó",
    "confirmo",
    "concluyó",
    "concluyo",
    "cerró",
    "ya se hizo",
    "ya ocurrió",
    "hizo la llamada",
    "hizo la reunion",
    "se llevó a cabo",
    "se llevo a cabo",
    "quedó realizada",
    "quedo realizada",
  ];

  const pendingPatterns = [
    "aún no",
    "aun no",
    "todavía no",
    "todavia no",
    "no se realizo",
    "no se realizó",
    "no se hizo",
    "queda agendada",
    "quedó agendada",
    "se agenda",
    "por agendar",
    "pendiente",
    "programada",
    "programado",
    "sin realizar",
  ];

  const didComplete = completionPatterns.some((pattern) => text.includes(pattern));
  const isPending = pendingPatterns.some((pattern) => text.includes(pattern));

  if (isPending && !didComplete) return "pending";
  if (didComplete && !isPending) return "done";
  if (isPending && didComplete) {
    const explicitPendingPhrases = /(aún no|aun no|todavía no|todavia no|no se realiz(o|ó)|no se hizo|queda agendada|quedó agendada|por agendar|pendiente|programada|programado|sin realizar)/i;
    if (explicitPendingPhrases.test(text)) return "pending";
  }
  if (isPastDate) return "done";
  return "pending";
}
