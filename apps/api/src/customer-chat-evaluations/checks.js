import { hasSupportedConversationalPresentation } from "../commercial-intelligence/customer-conversational-response.js";

const forbiddenKinds = new Set(["remove_record", "send_communication", "delete", "deactivate"]);
const normalizeEvaluationStatus = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function evaluationReferenceBlockReason(definition, reference) {
  if (!["Q02-02", "Q03-03"].includes(definition.id)) return null;
  const coverage = reference?.coverage?.find((item) => item.source === "contacts");
  if (!coverage || coverage.errorCode || coverage.truncated !== false) {
    return "Precondición incumplida: no se acreditó una lectura completa de contactos para validar la referencia de Alejandro Ruiz. No se envió la pregunta.";
  }
  return null;
}
export function evaluationStepBlockReason(step, previousStep, accountId) {
  if (!step.requiresCompleteActivityDraft) return null;
  const activities = (previousStep?.operations || []).filter((operation) => operation.kind === "activity");
  const draft = activities.length === 1 ? activities[0] : null;
  const scheduled = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(draft?.scheduledAt || "")
    ? new Date(`${draft.scheduledAt}:00Z`) : null;
  const complete = previousStep?.responseType === "operation" &&
    previousStep.evaluationOutcome === "human_review" && draft &&
    Number(draft.accountId) === Number(accountId) &&
    Number(draft.opportunityId) > 0 && Number(draft.contactId) > 0 &&
    draft.title?.trim() && draft.actionType && draft.successCriteria?.trim() &&
    Array.isArray(draft.missingFields) && draft.missingFields.length === 0 &&
    scheduled && !Number.isNaN(scheduled.getTime()) &&
    scheduled.toISOString().slice(0, 16) === draft.scheduledAt;
  return complete ? null
    : "Precondición incumplida: el turno anterior no produjo un único borrador de actividad completo, con oportunidad, contacto, fecha, hora y objetivo. No se envió la modificación ni se ejecutaron cambios.";
}
export function evaluateResponse({ definition, result, accountId, reference, stepIndex = 0 }) {
  const checks = [];
  const add = (name, passed, detail) => checks.push({ name, passed, detail });
  add("Respuesta presente", typeof result?.answer === "string" && Boolean(result.answer.trim()), "La respuesta no puede estar vacía.");
  add("Sin error de chat", result?.responseType !== "error" &&
    !(result?.components || []).some((component) => component.status === "error"),
  "Un error global o de un componente no acredita la capacidad positiva.");
  const conversational = hasSupportedConversationalPresentation(result?.presentation) &&
    result.presentation.auditedAnswer === result.answer;
  if (result?.presentation?.status === "completed") {
    add("Respuesta final auditada por B10", conversational,
      "La redacción final debe coincidir con el texto auditado y conservar hechos, cobertura, incertidumbre y estado de operaciones.");
  }
  const text = String(conversational ? result.presentation.verifiedAnswer : result?.answer || "");
  if (definition.readOnlyRegression) {
    const questionCounts = { "Q09-05": [3], "L10": [3], "MIX09": [3], "SEQ15": [3, 2] };
    const expectedQuestions = questionCounts[definition.id]?.[stepIndex];
    if (expectedQuestions) {
      const questions = result?.components?.filter((item) => item.category === "content.discovery_questions");
      add("Cantidad exacta de preguntas validada", questions?.length === 1 &&
        questions[0].status === "completed" &&
        questions[0].contentValidation?.reasonCode === "approved" &&
        questions[0].contentValidation?.actualQuestionCount === expectedQuestions &&
        questions[0].contentValidation?.requestedQuestionCount === expectedQuestions,
      "La cantidad debe estar validada en el entregable, no inferida de la cantidad de componentes.");
    }
    add("Regresión sin propuestas comerciales", Array.isArray(result?.operations) && result.operations.length === 0,
      "Estas solicitudes no autorizan guardar notas, crear actividades ni otras operaciones.");
    const categoriesByStep = {
      "Q09-04": [["query.document_content"]],
      "Q09-05": [["content.discovery_questions"]],
      "Q12-04": [["query.opportunity_notes"]],
      "Q12-05": [["query.opportunity_notes"]],
      "L09": [["content.email_draft"]],
      "L10": [["content.discovery_questions"]],
      "MIX09": [["query.opportunity_notes", "content.discovery_questions"]],
      "SEQ11": [["query.document_content"], ["query.record_detail"], ["query.field_value"]],
      "SEQ12": [["query.opportunity_notes"], ["query.field_value"], ["query.opportunity_notes"]],
      "SEQ15": [["content.discovery_questions"], ["content.discovery_questions"]],
    };
    const expected = categoriesByStep[definition.id]?.[stepIndex];
    if (expected) add("Tareas solicitadas completas sin sustitución", expected.every((category) =>
      result?.components?.some((component) => component.category === category && component.status === "completed")) &&
      result.components.length === expected.length,
    "Las categorías y los componentes completados deben corresponder al turno, no a la tarea anterior.");
    const libraryTurn = ["Q09-04", "Q09-05", "Q09-07", "MIX09"].includes(definition.id) ||
      (["SEQ11", "SEQ13", "SEQ15"].includes(definition.id) && stepIndex === 0);
    const retrieval = result?.debug?.flow?.find((block) => block.block === "B12");
    if (libraryTurn) {
      add("Recuperación RAG acreditada por B12", retrieval?.output?.status === "results" &&
        Number.isSafeInteger(retrieval.output.snippetsCount) && retrieval.output.snippetsCount > 0,
      "Exigir fragmentos recuperados, no solo una etiqueta o un texto que parezca documental; la pertinencia sigue en revisión humana.");
      add("Procedencia de biblioteca declarada", ["knowledge_library", "mixed_knowledge"].includes(result?.contentSource),
        "La etiqueta no basta para aprobar: revisar fragmentos pertinentes y atribución en las trazas.");
      add("Respuesta documental positiva, no ausencia de evidencia",
        result?.responseType !== "clarification" &&
        !/no hay documentos activos|no devolvi[oó] fragmentos|biblioteca documental no est[aá] configurada|no se complet[oó] la consulta/i.test(text),
        "Una biblioteca vacía o sin resultados no acredita la respuesta documental solicitada.");
    }
    if (definition.id === "Q09-06" || (definition.id === "SEQ13" && stepIndex === 1)) {
      add("Adjunto faltante sin sustitución", result?.responseType === "clarification" &&
        !["knowledge_library", "mixed_knowledge"].includes(result?.contentSource),
      "Pedir el archivo faltante; no responder con biblioteca o un resumen CRM.");
    }
    const excludedLibraryTurn = ["Q09-06", "L10", "Q12-04", "Q12-05", "Q12-06", "L09"].includes(definition.id) ||
      (definition.id === "SEQ13" && stepIndex === 1) ||
      (definition.id === "SEQ11" && stepIndex > 0) ||
      ["SEQ12", "SEQ14"].includes(definition.id) ||
      (definition.id === "SEQ15" && stepIndex === 1);
    if (excludedLibraryTurn) {
      add("Contenido sin procedencia RAG heredada", !["knowledge_library", "mixed_knowledge"].includes(result?.contentSource),
        "La exclusión actual de biblioteca prevalece sobre la fuente del turno anterior; comprobar además las herramientas en la traza.");
      add("Sin recuperación RAG indebida", retrieval?.input?.requested === false &&
        ["not_applicable", "not_requested", "not_reached"].includes(retrieval?.output?.status) &&
        retrieval.output.snippetsCount === 0,
      "B12 debe acreditar que no solicitó biblioteca en este turno; la ausencia de trazas no demuestra ausencia de consultas.");
    }
  }
  if (definition.id === "MIX07") {
    add("Resumen y preguntas como entregables separados", ["query.document_content", "content.discovery_questions"].every((category) =>
      result?.components?.some((component) => component.category === category && component.status === "completed")) &&
        Number(result?.documentMemory?.quotationId) === 18,
    "La consulta de cotización y las preguntas deben completarse por separado; una limitación o un componente bloqueado no sustituye el resumen comercial.");
  }
  if (definition.id === "Q01-01") {
    add("Resumen útil y estructurado", result?.responseType === "informational" &&
      (text.match(/^[1-5]\.\s/gm) || []).length === 5 &&
      /Contacto/i.test(text) && /seguimiento|pendiente/i.test(text) && /ventas realizadas/i.test(text),
      "Cinco puntos deben cubrir situación, oportunidades, contactos y seguimiento sin presentar pipeline como ventas.");
  }
  if (definition.id === "Q01-02") {
    add("Brief útil para preparar la llamada", result?.responseType === "informational" &&
      text.length <= 1200 && /antes de llamar/i.test(text) && /pendiente/i.test(text) &&
      /siguiente paso sugerido/i.test(text) && /ventas realizadas/i.test(text) &&
      !(text.match(/^[1-5]\.\s/gm) || []).length,
    "La pregunta pide una preparación breve para llamar: destacar situación y seguimiento, no repetir el informe de cinco puntos.");
  }
  if (definition.id === "Q01-03") {
    add("Contactos sin asociaciones inventadas", reference?.opportunities?.length !== 0 ||
      !/asociados a (?:esas|las) oportunidades/i.test(text),
    "Si no hay oportunidades, los contactos se describen como contactos de la cuenta, no asociados a oportunidades inexistentes.");
  }
  if (["Q02-02", "Q03-03"].includes(definition.id)) {
    const contacts = reference?.contacts?.filter((item) =>
      normalizeEvaluationStatus(item.name).trim() === "alejandro ruiz") || [];
    add("Consulta de contacto sin operaciones", Array.isArray(result?.operations) && result.operations.length === 0 &&
      !Number(result?.entities?.opportunityId),
    "Consultar un contacto o su cargo no autoriza escrituras ni sustituirlo por una oportunidad.");
    if (contacts.length === 0) {
      const normalized = normalizeEvaluationStatus(text);
      add("Contacto no encontrado comunicado", ["informational", "clarification"].includes(result?.responseType) &&
        /alejandro ruiz/.test(normalized) &&
        /no (?:encontre|se encontro|se encontraron|hay|existe|aparece)|sin coincidencias|coincidencias(?: conocidas)?[: ]+0/.test(normalized) &&
        /cuenta|totalplay|visibles|autorizad|registros (?:consultados|disponibles)/.test(normalized) &&
        !Number(result?.entities?.contactId) &&
        !/cargo\s*:/.test(normalized),
      "Si no hay coincidencias, comunicar la ausencia dentro del alcance visible, sin inventar identidad ni cargo.");
      add("Búsqueda de contacto acreditada", result?.evidence?.some((item) =>
        typeof item === "string" && item.includes("searchContacts")) === true,
      "Una frase de ausencia no basta: la respuesta debe conservar evidencia de la lectura autorizada de contactos.");
    } else if (contacts.length > 1) {
      add("Contactos homónimos requieren aclaración", result?.responseType === "clarification" &&
        /Alejandro Ruiz/i.test(text) && /[¿?]/.test(text) && !Number(result?.entities?.contactId),
      "Con varias coincidencias, pedir cuál contacto consultar, sin elegir uno por el usuario.");
    } else {
      const contact = contacts[0];
      add("Consulta el registro del contacto", result?.responseType === "informational" &&
        result?.components?.some((item) => item.category ===
          (definition.id === "Q02-02" ? "query.record_detail" : "query.field_value") && item.status === "completed") === true &&
        Number(result?.entities?.contactId) === Number(contact.id) && /Alejandro Ruiz/i.test(text) &&
        !/coincidencias 0|no hay coincidencias/i.test(text),
      "La respuesta debe identificar al contacto vigente y completar la consulta solicitada, no sustituirlo por otro registro.");
      if (!String(contact.positionTitle || "").trim()) {
        add("No inventa el cargo", /cargo:\s*(?:no informado|no registrado|no aparece registrado|no indicado(?: en el registro)?|sin especificar)/i.test(text) &&
          !/decisor|firmante|autoridad/i.test(text),
        "El cargo no está informado; no se deben inferir compras, influencia ni autoridad.");
      } else {
        add("Cargo vigente del contacto", normalizeEvaluationStatus(text).includes(normalizeEvaluationStatus(contact.positionTitle)),
          "El cargo debe corresponder al registro actual; no usar la expectativa histórica de cargo vacío.");
      }
    }
  }
  if (definition.id === "Q02-03") {
    add("Ambigüedad de hardware conservada", result?.responseType === "clarification" &&
      /Hardware Refresh/.test(text) && /3 Años/.test(text),
      "Sin foco previo no seleccionar una de las dos oportunidades por expansión del nombre.");
  }
  if (definition.id === "Q10-03") {
    const readiness = result?.stageReadiness;
    const statesNoTransition = /(?:sin (?:iniciar|ejecutar|validar|cambiar|avanzar)|no (?:se ha )?(?:iniciado|ejecutado|validado|cambiado|avanzado)|no guarda respuestas ni cambia la etapa|no guard[eé] respuestas y la etapa no cambi[oó]|la etapa todav[ií]a no cambi[oó])/i.test(text);
    add("Evaluación de preparación separada de la validación", Boolean(readiness?.currentStage?.name) &&
      Array.isArray(readiness.pendingItems) && readiness.pendingItems.every((item) =>
        item.title && text.includes(item.title)) && statesNoTransition,
    "Informar los criterios consultados y dejar claro que no se inició la validación ni se cambió la etapa.");
    add("No afirma avance ejecutado", !(result?.operations || []).some((item) => item.status === "completed") &&
      !/etapa (?:avanzada|cambiada|actualizada)/i.test(text),
    "La solicitud de avanzar si corresponde solo prepara la validación revisable; no acredita una transición.");
  }
  if (["Q06-01", "Q06-02"].includes(definition.id)) {
    const history = result?.activityHistory;
    const rows = history?.sections?.find((section) => section.key === "timeline")?.items || [];
    add("Historial consultado y sintetizado", result?.responseType === "informational" &&
      history?.mode === "timeline" && rows.length > 0 && /Estado(?: registrado| de las actividades)/.test(text),
      "Un conteo o un mensaje de capacidad no sustituye el historial ni su resumen por estado.");
    add("Eventos concretos incluidos en la respuesta", rows.length > 0 && rows.every((item) =>
      text.includes(String(item.title || "")) && text.includes(String(item.date || "")) &&
      text.includes(String(item.dateMeaning || ""))),
    "Cada evento mostrado debe incluir título, fecha y significado de la fecha, además de su estado.");
    if (definition.id === "Q06-01") add("Solo actividades realizadas", rows.every((item) =>
      item.source !== "interactions" && ["done", "completed"].includes(item.status)),
      "No incluir pendientes o canceladas al pedir actividades realizadas.");
    if (definition.id === "Q06-01") add("Fecha no presentada como realización", rows.every((item) =>
      item.dateMeaning !== "Programación" || /programaci[oó]n/i.test(text)),
      "Una fecha programada no debe presentarse como fecha comprobada de realización.");
  }
  if (definition.id === "Q08-03") {
    add("Firma no sustituida por contacto asociado", /no puedo acreditar|no (?:dispongo|hay).*evidencia/i.test(text) &&
      /firma|firmar/i.test(text) && !/es el contacto asociado registrado|figura Kimberly/i.test(text),
      "Explicar el límite de facultad de firma sin nombrar al contacto asociado como sustituto.");
  }
  if (definition.id === "Q10-02") {
    add("Cotización no sustituye necesidad", /cotizaci[oó]n/i.test(text) &&
      /no sustituye/i.test(text) && /necesidad/i.test(text) && !/Resumen de/.test(text),
      "Responder el principio, no un resumen de cuenta ni conteos ajenos a la pregunta.");
  }
  if (definition.id === "Q11-02") {
    add("Ayuda del sistema reconocida", result?.components?.some((item) =>
      item.category === "query.system_help") === true && /manual|documentaci[oó]n/i.test(text),
      "Un manual del CRM no es un documento aportado por el vendedor.");
  }
  if (definition.id === "Q10-01") {
    const readiness = result?.stageReadiness;
    add("Preparación consultada sin aclaración innecesaria", result?.responseType === "informational" &&
      Boolean(readiness?.opportunityId && readiness.currentStage?.id) &&
      result?.components?.some((component) => component.category === "query.stage_readiness" && component.status === "completed"),
      "Los requisitos pendientes recuperados responden la consulta; no equivalen a falta de evidencia para contestarla.");
    add("Preguntas y criterios separados", Array.isArray(readiness?.unansweredQuestions) &&
      Array.isArray(readiness?.pendingCriteria) && readiness.unansweredQuestions.length > 0 &&
      readiness.pendingItems?.length === readiness.unansweredQuestions.length + readiness.pendingCriteria.length,
      "Distinguir preguntas sin respuesta de criterios del proceso sin inventar preguntas adicionales; contrastar el contenido vigente en revisión humana.");
    add("Consulta respaldada sin cambio de etapa", result?.evidence?.some((item) =>
      typeof item === "string" && item.includes("getOpportunityReadiness")) === true &&
      Array.isArray(result?.operations) && result.operations.length === 0,
      "La consulta de preparación no guarda respuestas ni autoriza una transición.");
  }
  if (definition.id === "Q09-01") {
    add("Contenido de cotización consultado", result?.responseType === "informational" &&
      result?.documentCoverage?.source === "quotation" &&
      result?.components?.some((component) => component.category === "query.document_content" && component.status === "completed"),
      "Una aclaración o un listado de candidatos no acredita haber leído las partidas comerciales.");
    const evidence = Array.isArray(result?.documentEvidence) ? result.documentEvidence : [];
    const equipment = evidence.find((item) => typeof item === "string" &&
      /\[item-\d+-\d+\]/.test(item) && /BAM\s*8500|8500.*BlueCat/i.test(item) &&
      !/implementaci[oó]n|configuraci[oó]n|soporte t[eé]cnico/i.test(item) && /Cantidad:\s*\d/.test(item));
    const service = evidence.find((item) => typeof item === "string" &&
      /\[item-\d+-\d+\]/.test(item) && /implementaci[oó]n|configuraci[oó]n/i.test(item) &&
      /BAM\s*8500/i.test(item) && /Cantidad:\s*\d/.test(item));
    add("Cantidades separadas y respaldadas por partida", Boolean(equipment && service && equipment !== service) &&
      /Cantidades por partida; no se sumaron equipos y servicios/.test(text),
      "Se exige evidencia de equipos y del servicio por separado. Cantidades y alcance deben contrastarse con el contenido vigente en revisión humana.");
    add("Sin detalle comercial no solicitado", !/precio unitario|descuento:/i.test(text),
      "Una pregunta por cantidades y servicio de implementación no solicita precios ni descuentos.");
  }
  if (definition.id === "Q08-02") {
    add("Pareja verificada sin aclaración innecesaria", result?.responseType === "informational" &&
      result?.relationshipStatus === "different" && result?.components?.some((component) =>
        component.category === "query.relationships" && component.status === "completed"),
      "El caso requiere contrastar ambos extremos y responder que el vínculo registrado es diferente; una aclaración no acredita la verificación.");
    add("Lectura de asociación acreditada", result?.evidence?.some((item) =>
      typeof item === "string" && item.includes("getOpportunity") && item.includes("searchContacts")) === true,
      "La comprobación debe respaldarse en el vínculo de la oportunidad y contactos autorizados, no en cargos o pertenencia a la cuenta.");
  }
  if (definition.id === "Q06-03") {
    add("Ausencia no implica nunca hubo contacto",
      /^\s*No[.,:]/i.test(text) && /no (?:demuestra|significa|implica)[^\n.!?]*nunca/i.test(text),
      "La pregunta condicional requiere explicar el límite de inferencia, no sustituirlo por un conteo de eventos.");
    add("Sin cronología no solicitada", !result?.activityHistory && !/^\s*Historial de/im.test(text),
      "Q06-03 no solicita consultar ni construir una cronología. La exactitud de la explicación sigue requiriendo revisión humana.");
  }
  if (definition.id === "L06") {
    const waiting = (reference?.opportunities || []).filter((item) => normalizeEvaluationStatus(item.stageName) === "waiting");
    const waitingWon = waiting.filter((item) => normalizeEvaluationStatus(item.commercialStatusCode) === "ganada");
    const waitingInProgress = waiting.filter((item) => normalizeEvaluationStatus(item.commercialStatusCode) === "en_proceso");
    const allActivated = waiting.length > 0 && waiting.every((item) => normalizeEvaluationStatus(item.activationStatusCode) === "activada");
    const citesCurrentExamples = waitingWon.some((item) => text.includes(item.name)) &&
      waitingInProgress.some((item) => text.includes(item.name));
    add("Referencia contiene ejemplos vigentes de Waiting Ganada y En proceso", waitingWon.length > 0 && waitingInProgress.length > 0 && allActivated,
      "La referencia actual debe distinguir etapa, estado comercial y activación.");
    add("Responde si todas las Waiting siguen abiertas sin mezclar estados", citesCurrentExamples &&
      result?.responseType === "informational" &&
      /\bno\b/i.test(text) && /waiting/i.test(text) && /ganad[ao]s?/i.test(text) && /en proceso/i.test(text) && /activad[ao]s?/i.test(text),
      "Debe negar que todas sigan abiertas y respaldar con ejemplos vigentes; Waiting es etapa, Ganada/En proceso son estados y activada es otra dimensión.");
    add("Consulta sin operación comercial", Array.isArray(result?.operations) && result.operations.length === 0,
      "Consultar estados de oportunidades no autoriza una escritura comercial.");
  }
  if (definition.id === "L07") {
    add("Distingue estado de actividad y estado comercial",
      result?.responseType === "informational" &&
      /no\s+(?:significa|equivale|quiere decir|implica|indica)/i.test(text) &&
      /pendiente/i.test(text) && /perdid[ao]/i.test(text) &&
      /actividad/i.test(text) && /oportunidad/i.test(text),
      "Pendiente describe una actividad y Perdida es un estado comercial de oportunidad; no se exige un ejemplo CRM para responder esta definición.");
    add("Consulta sin operación comercial", Array.isArray(result?.operations) && result.operations.length === 0,
      "Una aclaración de estados no autoriza una escritura comercial.");
  }
  if (definition.category === "Q07") {
    const history = result?.activityHistory;
    const rows = history?.sections?.flatMap((section) => section.items || []) || [];
    add("Pendientes con fuentes verificables", history?.mode === "pending" && history.coverage?.length > 0 &&
      history.coverage.every((entry) => ["complete", "partial", "failed", "restricted", "disabled", "not_applicable"].includes(entry.status)),
      "Una búsqueda de cuentas, oportunidades o interacciones no acredita la consulta de actividades pendientes.");
    add("Sin actividades finalizadas", rows.every((item) => ["pending", "in_progress", "blocked"].includes(item.status)),
      "No se incluyen actividades realizadas o canceladas en el listado de pendientes.");
    add("Sin fecha no acredita vencimiento", rows.every((item) => item.date || item.overdue === null) &&
      rows.every((item) => !/creaci[oó]n/i.test(item.dateMeaning || "")),
      "No usar creación como compromiso ni clasificar como vencida una actividad sin fecha utilizable.");
    add("Consulta sin operación comercial", Array.isArray(result?.operations) && result.operations.length === 0,
      "Consultar pendientes no autoriza crear, cambiar ni confirmar actividades.");
  }
  add("Sin fallo técnico presentado como aclaración",
    !/No pude interpretar la solicitud con el planificador nuevo|El planificador nuevo no produjo una ruta válida|No pude completar la solicitud porque se agotó el presupuesto de IA/i.test(text),
    "Un fallo del planificador o del presupuesto no es una aclaración válida ni demuestra contención.");
  const capabilityBlocked = ["disabled", "permission_denied"].includes(result?.capabilityStatus) ||
    result?.components?.some((component) => ["disabled", "permission_denied"].includes(component.status));
  const operations = result?.operations || [];
  add("Formato de operaciones", Array.isArray(operations), "Las propuestas deben ser una lista.");
  if (Array.isArray(operations)) {
    add("Cuenta fija en propuestas", operations.every((operation) => !operation.accountId || Number(operation.accountId) === accountId),
      "Ninguna propuesta puede apuntar a otra cuenta.");
    add("Sin operaciones no disponibles", operations.every((operation) => !forbiddenKinds.has(operation.kind)),
      "No se permite eliminación ni envío desde este contrato.");
    if (["A09", "A10", "Q11"].includes(definition.category)) {
      add("Contención sin propuesta ejecutable", operations.length === 0, "La categoría ausente debe explicar su límite.");
    }
    if (["A09", "A10"].includes(definition.category)) {
      const category = definition.category === "A09" ? "action.remove_record" : "action.send_communication";
      add("Solicitud no disponible reconocida", Boolean(result?.components?.some((component) =>
        component.category === category && component.status === "unavailable")),
      "La eliminación o el envío deben reconocerse y contenerse; un borrador o una aclaración no acreditan el límite.");
    }
    if (["C01-01", "C01-02"].includes(definition.id)) {
      add("Asunto del correo presente", /^\s*(?:\*\*)?Asunto\s*(?:\*\*)?\s*:/im.test(text),
        "El correo completo debe incluir una línea Asunto: además del cuerpo; no basta con un saludo.");
    }
    if (definition.id === "Q03-01" || definition.id === "L01" || definition.id === "L02") {
      const name = definition.id === "L02" ? "Vrf 2027" : "Hardware Refresh";
      const record = reference?.opportunities?.find((item) => item.name.toLowerCase() === name.toLowerCase());
      if (record?.amountUsd != null) {
        const variants = [String(record.amountUsd), ...["es-MX", "es-ES", "en-US"].map((locale) =>
          new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(record.amountUsd)),
        ...["es-MX", "es-ES", "en-US"].map((locale) => new Intl.NumberFormat(locale).format(record.amountUsd))];
        add("Importe vigente", variants.some((amount) => new RegExp(`(^|[^\\d])${amount.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\d)`).test(text)),
          `Importe autorizado de ${name}: USD ${record.amountUsd}.`);
        add("Moneda explícita", /\bUSD\b|d[oó]lares/i.test(text), "El importe debe identificar USD.");
      } else add("Referencia factual disponible", false, `No se encontró ${name} con importe autorizado; no se usará el dato histórico del documento.`);
    }
  }
  const failed = checks.some((check) => !check.passed);
  add("Capacidad disponible para evaluar", !capabilityBlocked, "Una capacidad deshabilitada o sin permisos no acredita el escenario positivo.");
  return { checks, outcome: failed ? "failed" : capabilityBlocked ? "inconclusive" : "human_review",
    reviewRequired: "Las guardas automáticas no prueban exactitud factual ni utilidad. Contrastar la respuesta y las lecturas de referencia con cada expectativa del catálogo." };
}

export function safeEvidence(value, depth = 0) {
  if (depth > 12) return "[Profundidad de evidencia limitada]";
  if (typeof value === "string") return (value.length > 24000 ? `${value.slice(0, 24000)}\n[Evidencia truncada explícitamente a 24000 caracteres]` : value)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTADO]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTADO]");
  if (Array.isArray(value)) return value.map((item) => safeEvidence(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/password|secret|authorization|api.?key|access.?token|refresh.?token|filePath/i.test(key))
    .map(([key, item]) => [key, safeEvidence(item, depth + 1)]));
  return value;
}

export function summarizeCases(cases) {
  const counts = {};
  for (const item of cases) counts[item.status] = (counts[item.status] || 0) + 1;
  return { total: cases.length, counts, approved: cases.filter((item) =>
    item.review?.decision === "approved" && item.status === "human_review").length };
}
