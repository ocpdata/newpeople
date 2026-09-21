const INTENT_PATTERNS = {
  recommend: /\b(recomiend|recomendaci|sugier|sugerencia|que deberia|que debería|como avanzo|cómo avanzo|siguiente paso|como cierro|cómo cierro)\b/i,
  delete: /\b(elimina|eliminar|borra|borrar|quita|quitar)\b/i,
  create: /\b(crea|crear|registra|registrar|agrega|agregar|anade|añade|anadir|añadir|agenda|agendar|programa|programar)\b/i,
  update: /\b(actualiza|actualizar|modifica|modificar|cambia|cambiar|corrige|corregir|establece|establecer|pon|asigna|asignar|reemplaza|reemplazar)\b/i,
};

const ENTITY_PATTERNS = [
  { entity: "stage_answer", pattern: /\b(respuesta|pregunta|etapa|etapa comercial|respuesta de etapa)\b/i },
  { entity: "activity", pattern: /\b(actividad|llamada|reunion|reunión|visita|demostracion|demostración|seguimiento|tarea)\b/i },
  { entity: "account", pattern: /\b(cuenta|empresa)\b/i },
  { entity: "contact", pattern: /\b(contacto|persona)\b/i },
  { entity: "lead", pattern: /\b(lead|prospecto)\b/i },
  { entity: "opportunity", pattern: /\b(oportunidad|importe|monto|presupuesto|fecha de cierre|etapa comercial)\b/i },
];

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function inferOperation(text, entity) {
  if (INTENT_PATTERNS.delete.test(text)) return "delete";
  if (
    entity === "activity" &&
    /\b(reunion|reunión|llamada|visita|demostracion|demostración|agenda|agendar|programa|programar|pidio|pidió|solicito|solicitó)\b/i.test(text)
  ) {
    return "create_activity";
  }
  if (INTENT_PATTERNS.create.test(text)) {
    return entity === "stage_answer" ? "create_stage_answer" : entity === "activity" ? "create_activity" : "create_record";
  }
  if (INTENT_PATTERNS.update.test(text)) {
    return entity === "stage_answer" ? "update_stage_answer" : entity === "activity" ? "update_activity" : "update_record";
  }
  if (entity === "stage_answer" && /\b(el cliente|cliente|informo|informó|dijo|confirmo|confirmó|menciono|mencionó)\b/i.test(text)) {
    return "update_stage_answer";
  }
  return "consult";
}

function inferField(text, entity) {
  if (entity !== "opportunity") return null;
  if (/\b(importe|monto|valor|amount)\b/i.test(text)) return "amountUsd";
  if (/\b(fecha de cierre|cierre)\b/i.test(text)) return "closeDate";
  if (/\b(vendedor|responsable)\b/i.test(text)) return "sellerUserId";
  if (/\b(etapa comercial|etapa)\b/i.test(text)) return "salesStageId";
  return null;
}

function extractAmount(text) {
  const match = String(text || "").match(/(?:\$|usd\s*)?([0-9][0-9.,]*)\s*(?:dolares|dólares|usd)?/i);
  if (!match) return null;
  const raw = String(match[1] || "").replace(/,(?=\d{3}(?:\D|$))/g, "").replace(/,/g, ".");
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function extractActivitySchedule(prompt) {
  const text = normalizeText(prompt);
  const monthNames = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  };
  const dateMatch = text.match(/\b(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?\b/i);
  const timeMatch = text.match(/\ba\s+las?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i)
    || text.match(/\b(\d{1,2})(?::(\d{2}))\s*(am|pm)?\b/i);
  if (!dateMatch || !monthNames[dateMatch[2]]) return null;
  const year = Number(dateMatch[3] || new Date().getFullYear());
  const day = String(Number(dateMatch[1])).padStart(2, "0");
  const month = String(monthNames[dateMatch[2]]).padStart(2, "0");
  let hour = timeMatch ? Number(timeMatch[1]) : 9;
  const minute = timeMatch?.[2] ? Number(timeMatch[2]) : 0;
  const meridiem = String(timeMatch?.[3] || "").toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return {
    scheduledDate: `${year}-${month}-${day}`,
    scheduledTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

export function classifyChatbotIntent({ prompt, contextSnapshot = {} }) {
  const text = normalizeText(prompt);
  const activeEntity = contextSnapshot?.activeEntity || null;
  const isStageInformation =
    /\b(el cliente|cliente|informo|informó|dijo|confirmo|confirmó|menciono|mencionó)\b/i.test(text) &&
    !INTENT_PATTERNS.update.test(text) &&
    !INTENT_PATTERNS.create.test(text) &&
    !INTENT_PATTERNS.delete.test(text);
  const explicitEntity = isStageInformation
    ? /\b(reunion|reunión|llamada|visita|demostracion|demostración|actividad|tarea)\b/i.test(text)
      ? "activity"
      : "stage_answer"
    : ENTITY_PATTERNS.find(({ pattern }) => pattern.test(text))?.entity || "";
  const entity = explicitEntity || String(activeEntity?.type || "").trim().toLowerCase() || "none";
  const operation = inferOperation(text, entity);
  const field = inferField(text, entity);
  const isRecommendation = INTENT_PATTERNS.recommend.test(text) && !INTENT_PATTERNS.update.test(text);
  const intent = isRecommendation ? "recommend" : operation === "consult" ? "consult" : operation;

  return {
    intent,
    operation,
    targetEntity: entity,
    targetEntityId: Number(activeEntity?.id || 0) || null,
    targetEntityName: String(activeEntity?.name || "").trim(),
    field,
    confidence: entity !== "none" && intent !== "consult" ? 0.82 : 0.62,
    requiresApproval: !["consult", "recommend"].includes(intent),
    clarificationNeeded: entity === "none" && !["consult", "recommend"].includes(intent),
  };
}

export function isWriteIntent(intent) {
  return Boolean(intent?.requiresApproval) && !["consult", "recommend"].includes(intent?.intent);
}

export function buildOperationDraft({ intent, prompt, contextSnapshot = {} }) {
  const text = normalizeText(prompt);
  const amount = intent?.field === "amountUsd" ? extractAmount(prompt) : null;
  const currentAmount = Number(contextSnapshot?.visibleData?.amountUsd ?? NaN);
  const changes = [];
  if (intent?.targetEntity === "activity") {
    const schedule = extractActivitySchedule(prompt);
    const activityType = /\b(reunion|reunión)\b/i.test(prompt)
      ? "conference"
      : /\b(demostracion|demostración)\b/i.test(prompt)
        ? "presentation"
        : "call";
    changes.push({
      kind: "activity",
      activityType,
      scheduledDate: schedule?.scheduledDate || null,
      scheduledTime: schedule?.scheduledTime || null,
      objective: String(prompt || "").trim(),
      note: String(prompt || "").trim(),
    });
  }
  if (amount !== null && intent?.targetEntity === "opportunity") {
    changes.push({
      field: "amountUsd",
      label: "Importe en dólares",
      currentValue: Number.isFinite(currentAmount) ? currentAmount : null,
      proposedValue: amount,
    });
  }
  if (intent?.targetEntity === "stage_answer") {
    const questions = Array.isArray(contextSnapshot?.visibleData?.stageAnswers)
      ? contextSnapshot.visibleData.stageAnswers
      : [];
    const words = normalizeText(prompt).split(/\s+/).filter((word) => word.length > 3);
    const selected = questions
      .map((question) => ({
        question,
        score: words.filter((word) => normalizeText(question.prompt).includes(word)).length,
      }))
      .sort((left, right) => right.score - left.score)[0];
    if (selected?.question?.questionId && selected.score > 0) {
      const hasPreviousAnswer = Boolean(
        normalizeText(selected.question.answerValue),
      );
      const appendAnswer =
        hasPreviousAnswer &&
        /\b(adiciona|adicionar|agrega|agregar|anade|añade|suma|conserva)\b/i.test(
          text,
        );
      changes.push({
        questionId: Number(selected.question.questionId),
        questionPrompt: selected.question.prompt,
        previousValue: selected.question.answerValue || "",
        proposedValue: String(prompt || "").trim(),
        mode: appendAnswer ? "append" : "replace",
      });
    }
  }

  return {
    intent: intent?.intent || "consult",
    operation: intent?.operation || "consult",
    target: {
      entity: intent?.targetEntity === "activity"
        ? "opportunity"
        : intent?.targetEntity || "none",
      id: intent?.targetEntityId || null,
      name: intent?.targetEntityName || "",
    },
    changes,
    requiresApproval: Boolean(intent?.requiresApproval),
    status: intent?.clarificationNeeded ? "needs_clarification" : "drafted",
  };
}
