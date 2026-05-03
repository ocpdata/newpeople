import { readFile } from "node:fs/promises";
import { config } from "./config.js";
import { summarizeForPrompt } from "./opportunity-documents/service.js";

const PROCESS_GUIDE_URL = new URL(
  "../../../readme/proceso-comercial.md",
  import.meta.url,
);

const STOP_WORDS = new Set([
  "al",
  "ante",
  "bajo",
  "cabe",
  "con",
  "contra",
  "cual",
  "cuales",
  "como",
  "cuando",
  "de",
  "del",
  "desde",
  "donde",
  "el",
  "ella",
  "ellas",
  "ellos",
  "en",
  "entre",
  "era",
  "eran",
  "es",
  "esa",
  "esas",
  "ese",
  "eso",
  "esos",
  "esta",
  "estaba",
  "estado",
  "este",
  "esto",
  "estos",
  "fue",
  "ha",
  "hay",
  "la",
  "las",
  "le",
  "les",
  "lo",
  "los",
  "mas",
  "mi",
  "mis",
  "no",
  "nos",
  "o",
  "para",
  "pero",
  "por",
  "que",
  "se",
  "ser",
  "si",
  "sin",
  "sobre",
  "su",
  "sus",
  "te",
  "tu",
  "una",
  "uno",
  "unos",
  "unas",
  "ya",
]);

const STAGE_ALIAS_ENTRIES = [
  ["contacto inicial", "contacto inicial"],
  ["identificacion de la oportunidad", "identificacion de oportunidad"],
  ["identificacion de oportunidad", "identificacion de oportunidad"],
  ["desarrollo", "desarrollo"],
  ["cotizacion", "cotizacion"],
  ["demostracion", "demostracion"],
  ["negociacion", "negociacion"],
  ["waiting", "waiting"],
];

const OPPORTUNITY_STAGE_AI_PROMPT_CONFIG = {
  modelParameters: {
    temperature: 0.1,
    top_p: 1,
  },
  commonEvidenceInstruction:
    "Responde solo con hechos suficientemente sustentados por evidencia especifica, concreta y atribuible al cliente, a la oportunidad o al proceso real del caso. Usa el proceso comercial solo para interpretar que tipo de respuesta se espera, no como fuente de hechos del cliente. No inventes informacion, no completes con supuestos, no respondas por plausibilidad y no uses respuestas genericas de ventas.",
  commonInsufficientInstruction:
    "Si no hay evidencia suficiente para responder con precision, responde con estado 'insufficient_evidence'. Considera insuficiente cualquier caso en el que la evidencia sea vaga, indirecta, generica, ambigua, provenga solo de actividad nuestra o no incluya los elementos minimos exigidos por la pregunta. Explica brevemente que informacion falta o que no pudo confirmarse.",
  byQuestionCode: {
    contacto_inicial_interes_cliente: {
      guidance:
        "Identifica la necesidad, iniciativa, problema o interes concreto del cliente que justifique abrir la oportunidad. Evita generalidades comerciales.",
      strictCriteria:
        "Solo responde si existe una necesidad, problema, iniciativa o interes concreto del cliente. Si solo hay contacto, reunion, seguimiento o interes general, responde insufficient_evidence.",
    },
    identificacion_requerimiento_tecnico: {
      guidance:
        "Describe el requerimiento tecnico, funcional, operativo o de integracion concreto solicitado por el cliente. Evita completar con supuestos tecnicos no sustentados.",
      strictCriteria:
        "Solo responde si hay requerimientos tecnicos, funcionales, operativos o de integracion concretos. Si solo existe una categoria general de solucion sin detalle, responde insufficient_evidence.",
    },
    identificacion_motivacion_principal: {
      guidance:
        "Explica la motivacion de negocio detras del requerimiento: que problema quiere resolver, que riesgo quiere evitar o que resultado quiere lograr el cliente. No extrapoles desde el proceso comercial.",
      strictCriteria:
        "Solo responde si la motivacion de negocio, el problema a resolver o el resultado buscado aparecen en el caso. Si la motivacion solo puede inferirse, responde insufficient_evidence.",
    },
    identificacion_presupuesto_cliente: {
      guidance:
        "Indica que se sabe del presupuesto, de restricciones presupuestales o de como se obtendria el presupuesto para este proyecto.",
      specificInstruction:
        "Solo considera como validas senales concretas como presupuesto aprobado, rango estimado, restriccion presupuestal, fuente de financiamiento, proceso para obtener fondos o referencias economicas explicitas. No infieras capacidad presupuestal si no esta sustentada.",
      strictCriteria:
        "Solo responde si existe monto, rango, restriccion presupuestal, fuente de presupuesto o mecanismo real para conseguirlo. Si no hay cifra, rango, restriccion o proceso presupuestal concreto, responde insufficient_evidence.",
    },
    identificacion_fecha_adquisicion: {
      guidance:
        "Describe la fecha objetivo para adquirir o implementar la solucion, la razon de esa fecha y el impacto de no cumplirla, pero solo si eso esta sustentado.",
      strictCriteria:
        "Solo responde si existe fecha objetivo, ventana temporal, hito o deadline con razon e impacto. Si solo hay urgencia vaga como pronto o lo antes posible, responde insufficient_evidence.",
    },
    identificacion_decisor_proceso_compra: {
      guidance:
        "Identifica quienes participan en la decision y como es el proceso de compra o aprobacion.",
      specificInstruction:
        "Distingue entre contacto inicial, usuario, influenciador, aprobador, decisor tecnico, decisor economico, comite o area compradora si el material lo permite. No asumas que la persona mencionada es la decisora final.",
      strictCriteria:
        "Solo responde si hay actores, roles, areas o pasos reales del proceso de compra. Si solo se menciona el cliente, compras o direccion sin mayor precision, responde insufficient_evidence.",
    },
    identificacion_ventajas_fortalezas: {
      guidance:
        "Relaciona nuestras ventajas o fortalezas solo con necesidades, prioridades o criterios del cliente que si esten presentes en el material. Evita ventajas genericas.",
      strictCriteria:
        "Solo responde si una fortaleza nuestra puede vincularse directamente con una necesidad, restriccion o prioridad concreta del caso. Si la respuesta seria marketing generico, responde insufficient_evidence.",
    },
    identificacion_estrategia: {
      guidance:
        "Propon una estrategia comercial y tecnica para avanzar la oportunidad, pero solo a partir de los hallazgos concretos disponibles. No respondas con un plan generico de ventas.",
      strictCriteria:
        "Solo responde si la estrategia se sostiene en hechos reales del caso. Si seria una receta comercial estandar no derivada de la evidencia, responde insufficient_evidence.",
    },
    desarrollo_informacion_adicional: {
      guidance:
        "Resume la informacion adicional obtenida en reuniones o sesiones de desarrollo sobre alcance, necesidades, restricciones o prioridades. Evita rellenar con conclusiones tipicas de reuniones tecnicas.",
      strictCriteria:
        "Solo responde si hubo hallazgos nuevos, precisiones o restricciones concretas obtenidas en reuniones. Si solo consta que hubo reunion o seguimiento, responde insufficient_evidence.",
    },
    desarrollo_presentacion_solucion: {
      guidance:
        "Describe como se presento o explico la solucion tecnica al cliente y como se relaciono con su problema o necesidad, solo si eso esta sustentado.",
      strictCriteria:
        "Solo responde si se sabe como se presento la solucion y como se conecto con la necesidad del cliente. Si solo consta que hubo presentacion o demo, responde insufficient_evidence.",
    },
    desarrollo_propuesta: {
      guidance:
        "Detalla la solucion, alcance, arquitectura, servicio o alternativa propuesta al cliente. Evita expresiones vagas como solucion integral si no hay soporte especifico.",
      strictCriteria:
        "Solo responde si existe una descripcion concreta de la solucion, alcance, servicio, arquitectura o alternativa propuesta. Si solo se menciona que se envio una propuesta, responde insufficient_evidence.",
    },
    desarrollo_puntos_tecnicos: {
      guidance:
        "Identifica los puntos tecnicos mas importantes y los que sean criticos para el exito de la solucion, como integraciones, seguridad, compatibilidad, rendimiento, infraestructura o cumplimiento, solo si aparecen sustentados.",
      strictCriteria:
        "Solo responde si los puntos tecnicos son reales y propios del caso. Si serian puntos tipicos del tipo de proyecto pero no del caso, responde insufficient_evidence.",
    },
    desarrollo_aceptacion_propuesta: {
      guidance:
        "Determina el nivel de aceptacion, validacion o conformidad del cliente respecto de la propuesta tecnica.",
      specificInstruction:
        "Distingue claramente entre interes, validacion parcial, conformidad condicionada, aceptacion clara u objecion pendiente. No confundas continuidad de conversaciones con aceptacion.",
      strictCriteria:
        "Solo responde si existe reaccion del cliente: aceptacion, validacion, reserva, objecion o rechazo. Si solo hubo presentacion o envio de propuesta sin reaccion del cliente, responde insufficient_evidence.",
    },
    desarrollo_observaciones_condiciones: {
      guidance:
        "Resume observaciones, dudas, restricciones o condiciones que el cliente haya indicado para aceptar o avanzar con la propuesta tecnica. Evita objeciones genericas no documentadas.",
      strictCriteria:
        "Solo responde si el cliente expreso dudas, objeciones, restricciones o condiciones concretas. Si solo hay pendientes internos o preocupaciones nuestras, responde insufficient_evidence.",
    },
    desarrollo_riesgo_tecnico: {
      guidance:
        "Identifica riesgos tecnicos, dependencias, vacios de informacion o factores de complejidad que puedan afectar la solucion o su implementacion.",
      specificInstruction:
        "Solo reporta riesgos reales o claramente inferibles del material. Prioriza dependencias externas, integraciones inciertas, restricciones de infraestructura, requisitos no definidos, cumplimiento, seguridad, disponibilidad de datos o limitaciones tecnicas explicitas.",
      strictCriteria:
        "Solo responde si hay riesgos, dependencias, vacios o complejidades reales del caso. Si el riesgo seria una advertencia generica no anclada a evidencia, responde insufficient_evidence.",
    },
    cotizacion_propuesta_economica: {
      guidance:
        "Evalua si la propuesta economica se alinea con presupuesto, rango esperado o expectativas del cliente, pero unicamente si hay senales economicas concretas.",
      specificInstruction:
        "No afirmes alineacion economica si no existe monto, rango, expectativa, referencia presupuestal o reaccion explicita del cliente frente al valor.",
      strictCriteria:
        "Solo responde si existe senal del cliente sobre ajuste o desajuste con presupuesto o expectativa. Si solo existe la cotizacion emitida, responde insufficient_evidence.",
    },
    cotizacion_condiciones_comerciales: {
      guidance:
        "Evalua si las condiciones comerciales coinciden con las necesidades del cliente, considerando solo terminos presentes como pagos, tiempos, vigencia, entregables, soporte o condiciones contractuales.",
      strictCriteria:
        "Solo responde si hay condiciones comerciales concretas del cliente para compararlas con la propuesta. Si no hay terminos concretos, responde insufficient_evidence.",
    },
    demostracion_motivo: {
      guidance:
        "Explica por que el cliente solicito o acepto la demostracion y que queria validar. Evita razones genericas de ventas.",
      strictCriteria:
        "Solo responde si existe motivo explicito de la demo o algo concreto que el cliente queria validar. Si solo se sabe que la demo ocurrio, responde insufficient_evidence.",
    },
    demostracion_criterios_exito: {
      guidance:
        "Enumera criterios concretos de exito o validacion para la demostracion solo si estan sustentados, por ejemplo funcionalidades, resultados esperados o condiciones de aprobacion.",
      strictCriteria:
        "Solo responde si existen criterios concretos de exito o validacion. Si serian criterios tipicos inferidos pero no documentados, responde insufficient_evidence.",
    },
    demostracion_siguientes_pasos: {
      guidance:
        "Describe los siguientes pasos esperados despues de cumplir los criterios de exito de la demostracion, solo si aparecen documentados o claramente inferibles.",
      strictCriteria:
        "Solo responde si existen siguientes pasos acordados o esperados por el cliente. Si serian pasos comerciales estandar no acordados en el caso, responde insufficient_evidence.",
    },
    demostracion_resultado: {
      guidance:
        "Describe el resultado de la demostracion y la reaccion o conclusion del cliente. Distingue entre satisfaccion, interes, objeciones, validacion parcial o rechazo.",
      specificInstruction:
        "No asumas que la demostracion fue exitosa solo porque ocurrio. Debe haber evidencia de reaccion, evaluacion o conclusion.",
      strictCriteria:
        "Solo responde si existe resultado y reaccion o conclusion del cliente. Si solo consta la ejecucion de la demo, responde insufficient_evidence.",
    },
    negociacion_precio_condiciones: {
      guidance:
        "Resume precio objetivo, limites de negociacion o mejores condiciones aceptables, pero solo si el material contiene senales concretas.",
      specificInstruction:
        "No conviertas esta respuesta en una recomendacion teorica de negociacion. Extrae unicamente limites, concesiones o condiciones reales mencionadas para esta oportunidad.",
      strictCriteria:
        "Solo responde si existen limites, rangos, concesiones o condiciones reales discutidas. Si serian cifras o posturas inventadas, responde insufficient_evidence.",
    },
    negociacion_puntos_cliente: {
      guidance:
        "Identifica que factores valora mas el cliente en la negociacion, como precio, plazo, soporte, alcance, riesgo o flexibilidad, solo si eso aparece claramente.",
      strictCriteria:
        "Solo responde si los factores valorados por el cliente aparecen explicitamente o con claridad suficiente. Si se asumen por costumbre, responde insufficient_evidence.",
    },
    negociacion_puntos_nosotros: {
      guidance:
        "Identifica que puntos debemos proteger o priorizar nosotros en la negociacion, con base en riesgos, condiciones o limites concretos de esta oportunidad.",
      specificInstruction:
        "No respondas con principios genericos de negociacion. Si no hay base especifica para determinar prioridades concretas, responde insufficient_evidence.",
      strictCriteria:
        "Solo responde si hay elementos del caso que justifiquen claramente que debemos proteger. Si seria una lista estandar de negociacion, responde insufficient_evidence.",
    },
    waiting_acuerdo_o_postores: {
      guidance:
        "Describe si ya existe acuerdo, aprobacion pendiente o evaluacion entre varios postores, y cualquier condicion pendiente para la definicion final.",
      strictCriteria:
        "Solo responde si hay evidencia de acuerdo o de evaluacion entre postores. Si solo hay espera o silencio sin contexto, responde insufficient_evidence.",
    },
  },
};

let cachedProcessGuideText = "";
let cachedStructuredProcessGuide = null;

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStageName(value) {
  const normalized = normalizeText(value)
    .replace(/^etapa\s+de\s+/, "")
    .replace(/^etapa\s+del\s+/, "")
    .trim();
  const aliasMatch = STAGE_ALIAS_ENTRIES.find(
    ([alias]) => normalized === alias || normalized.includes(alias),
  );
  return aliasMatch?.[1] || normalized;
}

function extractResponseOutputText(data) {
  const directOutputText = String(data?.output_text || "").trim();
  if (directOutputText) return directOutputText;

  const outputEntries = Array.isArray(data?.output) ? data.output : [];
  return (
    outputEntries
      .flatMap((entry) => (Array.isArray(entry?.content) ? entry.content : []))
      .filter((part) => part?.type === "output_text")
      .map((part) => String(part?.text || "").trim())
      .find(Boolean) || ""
  );
}

function extractJsonObject(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function chunkTextByParagraphs(text, maxLength = 900, overlap = 140) {
  const paragraphs = String(text || "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (!paragraphs.length) return [];

  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const nextChunk = current ? `${current}\n\n${paragraph}` : paragraph;
    if (nextChunk.length <= maxLength) {
      current = nextChunk;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = current.slice(Math.max(0, current.length - overlap));
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      if (current.length > maxLength) {
        chunks.push(...splitLongText(current, maxLength, overlap));
        current = "";
      }
    } else {
      chunks.push(...splitLongText(paragraph, maxLength, overlap));
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.filter(Boolean);
}

function splitLongText(text, maxLength, overlap) {
  const normalized = String(text || "").trim();
  const chunks = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const nextCursor = Math.min(normalized.length, cursor + maxLength);
    chunks.push(normalized.slice(cursor, nextCursor).trim());
    if (nextCursor >= normalized.length) break;
    cursor = Math.max(cursor + 1, nextCursor - overlap);
  }

  return chunks.filter(Boolean);
}

function tokenizeTerms(value) {
  return Array.from(
    new Set(
      normalizeText(value)
        .split(" ")
        .filter((term) => term.length >= 3 && !STOP_WORDS.has(term)),
    ),
  );
}

function extractBulletItems(sectionText) {
  return Array.from(
    String(sectionText || "").matchAll(/(?:^|\n)\s*[•\-]\s+(.+)$/gm),
  )
    .map((match) => String(match[1] || "").trim())
    .filter(Boolean);
}

function extractQuestionLikeSentences(sectionText) {
  return Array.from(
    String(sectionText || "").matchAll(/(?:^|\n)\s*¿([^?]+)\?/gm),
  )
    .map((match) => `¿${String(match[1] || "").trim()}?`)
    .filter(Boolean);
}

function pickRelevantParagraphs(sectionText, queryTerms, limit = 3) {
  const paragraphs = String(sectionText || "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => ({
      paragraph,
      score: scoreTextAgainstTerms(paragraph, queryTerms),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.paragraph);

  return paragraphs;
}

function scoreTextAgainstTerms(text, terms) {
  const normalized = normalizeText(text);
  if (!normalized || !terms.length) return 0;

  return terms.reduce((total, term) => {
    if (!normalized.includes(term)) return total;
    return total + (term.length >= 8 ? 3 : 1);
  }, 0);
}

function buildStructuredStageGuide(sectionTitle, sectionText) {
  const stageName = normalizeStageName(sectionTitle);
  const bullets = extractBulletItems(sectionText);
  const sampleQuestions = extractQuestionLikeSentences(sectionText);
  const objectiveParagraph =
    pickRelevantParagraphs(sectionText, ["objetivo", "fase", "etapa"], 2).join(
      "\n\n",
    ) || summarizeForPrompt(sectionText, 1000);
  const keySignals = bullets.filter((bullet) =>
    /(interes|necesidad|presupuesto|decision|requerimiento|beneficio|plazo|implementacion|seguridad|exito)/i.test(
      bullet,
    ),
  );

  return {
    stageName,
    stageTitle: sectionTitle,
    objective: summarizeForPrompt(objectiveParagraph, 1200),
    keySignals: keySignals.slice(0, 8),
    sampleQuestions: sampleQuestions.slice(0, 10),
    sectionText: summarizeForPrompt(sectionText, 12000),
  };
}

function buildStructuredProcessGuide(source) {
  const text = String(source || "");
  const headingMatches = Array.from(
    text.matchAll(/(^|\n)3\.\d+\s+([^\n]+)/g),
  ).map((match) => ({
    index: Number(match.index || 0) + (match[1] ? String(match[1]).length : 0),
    title: String(match[2] || "").trim(),
  }));

  const firstStageIndex = headingMatches.length ? headingMatches[0].index : 0;
  const generalContext = summarizeForPrompt(
    text.slice(0, firstStageIndex || Math.min(text.length, 5000)),
    5000,
  );
  const stagesByName = new Map();

  headingMatches.forEach((heading, index) => {
    const nextHeading = headingMatches[index + 1];
    const sectionText = text.slice(
      heading.index,
      nextHeading ? nextHeading.index : text.length,
    );
    const structuredStage = buildStructuredStageGuide(
      heading.title,
      sectionText,
    );
    stagesByName.set(structuredStage.stageName, structuredStage);
  });

  return { generalContext, stagesByName };
}

async function loadStructuredProcessGuide() {
  if (cachedStructuredProcessGuide) {
    return cachedStructuredProcessGuide;
  }

  if (!cachedProcessGuideText) {
    cachedProcessGuideText = await readFile(PROCESS_GUIDE_URL, "utf8");
  }
  cachedStructuredProcessGuide = buildStructuredProcessGuide(
    cachedProcessGuideText,
  );
  return cachedStructuredProcessGuide;
}

function buildQuestionShape(questions, existingAnswers) {
  const answersByQuestionId = new Map(
    (Array.isArray(existingAnswers) ? existingAnswers : []).map((answer) => [
      Number(answer.question_id),
      answer,
    ]),
  );

  return (Array.isArray(questions) ? questions : []).map((question) => {
    const currentAnswer = answersByQuestionId.get(Number(question.id));
    const currentValue = String(currentAnswer?.answer_value || "").trim();
    return {
      questionId: Number(question.id),
      code: String(question.code || ""),
      prompt: String(question.prompt || "").trim(),
      basePrompt: String(question.prompt || "").trim(),
      responseType: normalizeText(question.response_type || "texto_libre"),
      isRequired: Boolean(question.is_required),
      currentAnswer: currentValue,
      expectedAction: currentValue ? "replace_existing" : "fill_empty",
    };
  });
}

function getQuestionPromptOverrides(questionCode) {
  return (
    OPPORTUNITY_STAGE_AI_PROMPT_CONFIG.byQuestionCode[
      String(questionCode || "")
    ] || null
  );
}

function buildAiRuntimePrompt(question) {
  const promptOverrides = getQuestionPromptOverrides(question?.code);

  return [
    String(question?.basePrompt || question?.prompt || "").trim(),
    OPPORTUNITY_STAGE_AI_PROMPT_CONFIG.commonEvidenceInstruction,
    String(promptOverrides?.guidance || "").trim(),
    String(promptOverrides?.specificInstruction || "").trim(),
    String(promptOverrides?.strictCriteria || "").trim(),
    OPPORTUNITY_STAGE_AI_PROMPT_CONFIG.commonInsufficientInstruction,
  ]
    .filter(Boolean)
    .join(" ");
}

function buildDocumentChunks(documents) {
  return (Array.isArray(documents) ? documents : []).flatMap((document) => {
    const sourceText =
      document?.normalizedText ||
      document?.rawText ||
      document?.transcriptText ||
      "";
    const chunks = chunkTextByParagraphs(sourceText, 1100, 180);
    return chunks.map((chunk, index) => ({
      id: `${document?.publicId || "doc"}_${index + 1}`,
      documentPublicId: String(document?.publicId || ""),
      documentName: String(document?.originalFileName || "sin_nombre"),
      text: chunk,
      normalizedText: normalizeText(chunk),
    }));
  });
}

function buildQuestionGuidance(question, structuredStageGuide) {
  const questionTerms = tokenizeTerms(question.prompt);
  const promptOverrides = getQuestionPromptOverrides(question?.code);
  const sectionMatches = pickRelevantParagraphs(
    structuredStageGuide?.sectionText,
    questionTerms,
    3,
  );

  return summarizeForPrompt(
    [
      structuredStageGuide?.objective || "",
      ...(Array.isArray(structuredStageGuide?.keySignals)
        ? structuredStageGuide.keySignals
        : []),
      ...(Array.isArray(structuredStageGuide?.sampleQuestions)
        ? structuredStageGuide.sampleQuestions.filter(
            (sampleQuestion) =>
              scoreTextAgainstTerms(sampleQuestion, questionTerms) > 0,
          )
        : []),
      String(promptOverrides?.guidance || "").trim(),
      String(promptOverrides?.specificInstruction || "").trim(),
      String(promptOverrides?.strictCriteria || "").trim(),
      ...sectionMatches,
    ]
      .filter(Boolean)
      .join("\n\n"),
    2500,
  );
}

function rankEvidenceChunksForQuestion(question, structuredStageGuide, chunks) {
  const questionTerms = tokenizeTerms(
    [question.prompt, question.code, structuredStageGuide?.objective || ""]
      .filter(Boolean)
      .join(" "),
  );
  const signalTerms = tokenizeTerms(
    Array.isArray(structuredStageGuide?.keySignals)
      ? structuredStageGuide.keySignals.join(" ")
      : "",
  );

  return (Array.isArray(chunks) ? chunks : [])
    .map((chunk) => ({
      ...chunk,
      score:
        scoreTextAgainstTerms(chunk.normalizedText, questionTerms) * 2 +
        scoreTextAgainstTerms(chunk.normalizedText, signalTerms),
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((chunk) => ({
      documentName: chunk.documentName,
      relevanceScore: Number(chunk.score || 0),
      excerpt: summarizeForPrompt(chunk.text, 850),
    }));
}

function summarizeQuestionContexts(questionInputs) {
  return summarizeForPrompt(
    questionInputs
      .map((input) =>
        [
          `Pregunta ${input.questionId}: ${input.aiPrompt || input.prompt}`,
          `Pregunta base: ${input.basePrompt || input.prompt}`,
          `Tipo esperado: ${input.responseType}`,
          `Respuesta actual: ${input.currentAnswer || "(vacía)"}`,
          `Accion esperada: ${input.expectedAction}`,
          `Guia: ${input.questionGuidance || "Sin guia adicional"}`,
          input.candidateEvidence.length
            ? `Evidencia candidata:\n${input.candidateEvidence
                .map(
                  (evidence, index) =>
                    `- Fuente ${index + 1} (${evidence.documentName}): ${evidence.excerpt}`,
                )
                .join("\n")}`
            : "Evidencia candidata: ninguna con relevancia suficiente.",
        ].join("\n"),
      )
      .join("\n\n---\n\n"),
    22000,
  );
}

function buildSharedDocumentContext(chunks) {
  return summarizeForPrompt(
    (Array.isArray(chunks) ? chunks : [])
      .slice(0, 12)
      .map((chunk, index) =>
        [
          `Fragmento ${index + 1}`,
          `Documento: ${chunk.documentName}`,
          `Texto: ${summarizeForPrompt(chunk.text, 1400)}`,
        ].join("\n"),
      )
      .join("\n\n---\n\n"),
    18000,
  );
}

function normalizeSuggestionStatus(value) {
  const normalized = normalizeText(value);
  if (normalized === "proposed") return "proposed";
  if (normalized === "ambiguous_evidence") return "ambiguous_evidence";
  if (normalized === "insufficient_evidence") return "insufficient_evidence";
  return "insufficient_evidence";
}

function normalizeProposalKind(value, fallback) {
  const normalized = normalizeText(value);
  if (normalized === "replace_existing") return "replace_existing";
  if (normalized === "fill_empty") return "fill_empty";
  return fallback;
}

function summarizeSuggestions(suggestions) {
  return (Array.isArray(suggestions) ? suggestions : []).reduce(
    (summary, suggestion) => {
      const status = String(suggestion?.status || "");
      if (status === "proposed") {
        summary.proposedCount += 1;
        if (suggestion?.proposalKind === "replace_existing") {
          summary.replaceCount += 1;
        } else {
          summary.fillCount += 1;
        }
      } else if (status === "ambiguous_evidence") {
        summary.ambiguousCount += 1;
      } else {
        summary.insufficientCount += 1;
      }
      return summary;
    },
    {
      proposedCount: 0,
      fillCount: 0,
      replaceCount: 0,
      ambiguousCount: 0,
      insufficientCount: 0,
    },
  );
}

function normalizeModelSuggestions(rawSuggestions, questionInputs) {
  const allowedQuestionIds = new Set(
    (Array.isArray(questionInputs) ? questionInputs : []).map((question) =>
      Number(question.questionId),
    ),
  );
  const questionMap = new Map(
    (Array.isArray(questionInputs) ? questionInputs : []).map((question) => [
      Number(question.questionId),
      question,
    ]),
  );

  const suggestionsByQuestionId = new Map();
  for (const item of Array.isArray(rawSuggestions) ? rawSuggestions : []) {
    const questionId = Number(item?.questionId);
    if (!allowedQuestionIds.has(questionId)) continue;

    const question = questionMap.get(questionId);
    const status = normalizeSuggestionStatus(item?.status);
    const proposedAnswer = String(item?.proposedAnswer || "").trim();
    const kind = normalizeProposalKind(
      item?.proposalKind,
      question?.expectedAction,
    );

    suggestionsByQuestionId.set(questionId, {
      questionId,
      questionCode: String(question?.code || ""),
      currentAnswer: String(question?.currentAnswer || ""),
      status,
      proposalKind: kind,
      proposedAnswer:
        status === "proposed" && proposedAnswer ? proposedAnswer : "",
      reason:
        String(item?.reason || "").trim() ||
        (status === "ambiguous_evidence"
          ? "La informacion encontrada es ambigua para responder con seguridad."
          : status === "insufficient_evidence"
            ? "No hay evidencia suficiente en los documentos para proponer una respuesta."
            : kind === "replace_existing"
              ? "Se detecto una alternativa documental para la respuesta actual."
              : "Se detecto una posible respuesta en los documentos cargados."),
    });
  }

  const suggestions = questionInputs.map(
    (question) =>
      suggestionsByQuestionId.get(Number(question.questionId)) || {
        questionId: Number(question.questionId),
        questionCode: String(question.code || ""),
        currentAnswer: String(question.currentAnswer || ""),
        status: "insufficient_evidence",
        proposalKind: question.expectedAction,
        proposedAnswer: "",
        reason:
          "No hay evidencia suficiente en los documentos para proponer una respuesta.",
      },
  );

  return {
    suggestions,
    summary: summarizeSuggestions(suggestions),
  };
}

function buildOpenAiPayload({
  salesStage,
  structuredGuide,
  stageGuide,
  questionContexts,
  sharedDocumentContext,
  retryMode = false,
}) {
  return {
    model: config.openai.model,
    temperature: OPPORTUNITY_STAGE_AI_PROMPT_CONFIG.modelParameters.temperature,
    top_p: OPPORTUNITY_STAGE_AI_PROMPT_CONFIG.modelParameters.top_p,
    input: [
      {
        role: "system",
        content: retryMode
          ? "Analiza documentos comerciales privados y responde solo con JSON valido. Recibiras preguntas con evidencia documental ya preseleccionada. Debes decidir si esa evidencia responde directamente la pregunta o si la responde por equivalencia semantica clara. Considera como evidencia valida las descripciones concretas de necesidad, problema, prioridad, objetivo, capacidad buscada, riesgo a mitigar, beneficio esperado o siguiente paso solicitado, siempre que permitan contestar fielmente la pregunta sin inventar. Solo propone una respuesta cuando el fragmento responda de forma clara y suficiente; en ese caso redacta una parafrasis breve y fiel a la evidencia. Si la evidencia no alcanza o admite varias interpretaciones razonables, devuelve status insuficiente o ambiguo y no propongas texto. Nunca inventes. No incluyas evidencia, citas, IDs internos ni explicaciones largas."
          : "Analiza documentos comerciales privados y responde solo con JSON valido. Tu tarea es proponer respuestas para preguntas de una etapa comercial usando exclusivamente la evidencia de los documentos de la oportunidad, guiado por la documentacion del proceso comercial. Puedes usar tanto el corpus documental amplio como la evidencia candidata por pregunta; la evidencia candidata solo prioriza lectura, no limita el analisis. Trata como evidencia valida tanto las respuestas literales como las equivalencias semanticas claras: si el documento describe la necesidad, problema, prioridad, objetivo, capacidad buscada, riesgo a mitigar, beneficio esperado o una demostracion solicitada, eso puede responder fielmente preguntas como interes del cliente, necesidad identificada o motivacion, aunque no use exactamente las mismas palabras de la pregunta. Nunca inventes. Si la evidencia es insuficiente o ambigua, devuelve status insuficiente o ambiguo y no propongas texto. Para preguntas ya respondidas, solo sugiere reemplazo si la evidencia documental es clara y mejor que la respuesta actual. No incluyas evidencia, citas, IDs internos ni explicaciones largas.",
      },
      {
        role: "user",
        content: JSON.stringify({
          stage: {
            id: Number(salesStage?.id || 0),
            code: String(salesStage?.code || ""),
            name: String(salesStage?.name || ""),
          },
          processGuideOverview: {
            generalContext: structuredGuide.generalContext,
            stageObjective: stageGuide?.objective || "",
            keySignals: stageGuide?.keySignals || [],
            sampleQuestions: stageGuide?.sampleQuestions || [],
          },
          documentCorpus: retryMode ? "" : sharedDocumentContext,
          questionContexts: summarizeQuestionContexts(questionContexts),
          rules: {
            onlySelectedStage: true,
            fillEmptyAnswers: true,
            suggestReplacements: true,
            neverInvent: true,
            noEvidenceOrTraceStorage: true,
            evaluateOnlyProvidedEvidence: retryMode,
            broadDocumentContextAvailable: !retryMode,
            allowClearSemanticEquivalence: true,
          },
          expectedJsonShape: {
            suggestions: [
              {
                questionId: 0,
                status: "proposed|insufficient_evidence|ambiguous_evidence",
                proposalKind: "fill_empty|replace_existing",
                proposedAnswer: "",
                reason: "",
              },
            ],
          },
        }),
      },
    ],
  };
}

function buildSemanticRecoveryPayload({
  salesStage,
  structuredGuide,
  stageGuide,
  questionContexts,
  sharedDocumentContext,
}) {
  return {
    model: config.openai.model,
    input: [
      {
        role: "system",
        content:
          "Analiza documentos comerciales privados y responde solo con JSON valido. Tu tarea es recuperar respuestas cuando las pasadas anteriores fueron demasiado conservadoras. Debes responder una pregunta usando exclusivamente hechos explicitamente descritos en los documentos, aunque la respuesta deba construirse por equivalencia semantica fiel. Si el documento describe la necesidad, problema, prioridad, objetivo, capacidad buscada, riesgo a mitigar o demostracion solicitada, puedes reescribir eso como respuesta de negocio. Ejemplo 1: pregunta '¿En qué está interesado el cliente?' y documento 'el cliente necesita fortalecer la seguridad de acceso a aplicaciones en la nube' => respuesta valida 'El cliente esta interesado en fortalecer la seguridad de acceso a sus aplicaciones en la nube'. Ejemplo 2: pregunta '¿Cual es la necesidad del cliente?' y documento 'busca reducir accesos no autorizados y mejorar visibilidad' => respuesta valida 'Reducir accesos no autorizados y mejorar la visibilidad sobre los accesos'. Si aun con esa regla la evidencia no basta o admite varias interpretaciones razonables, devuelve insuficiente o ambiguo y no inventes. No incluyas evidencia, citas, IDs internos ni explicaciones largas.",
      },
      {
        role: "user",
        content: JSON.stringify({
          stage: {
            id: Number(salesStage?.id || 0),
            code: String(salesStage?.code || ""),
            name: String(salesStage?.name || ""),
          },
          processGuideOverview: {
            generalContext: structuredGuide.generalContext,
            stageObjective: stageGuide?.objective || "",
            keySignals: stageGuide?.keySignals || [],
            sampleQuestions: stageGuide?.sampleQuestions || [],
          },
          documentCorpus: sharedDocumentContext,
          questionContexts: summarizeQuestionContexts(questionContexts),
          rules: {
            onlySelectedStage: true,
            fillEmptyAnswers: true,
            suggestReplacements: true,
            neverInvent: true,
            noEvidenceOrTraceStorage: true,
            allowClearSemanticEquivalence: true,
            recoverFromOverConservativeRejections: true,
          },
          expectedJsonShape: {
            suggestions: [
              {
                questionId: 0,
                status: "proposed|insufficient_evidence|ambiguous_evidence",
                proposalKind: "fill_empty|replace_existing",
                proposedAnswer: "",
                reason: "",
              },
            ],
          },
        }),
      },
    ],
  };
}

function buildTargetedQuestionRecoveryPayload({
  salesStage,
  structuredGuide,
  stageGuide,
  question,
}) {
  return {
    model: config.openai.model,
    input: [
      {
        role: "system",
        content:
          "Analiza documentos comerciales privados y responde solo con JSON valido. Recibiras exactamente una pregunta de etapa comercial y solo sus fragmentos documentales mas relevantes. Debes decidir si esos fragmentos bastan para responder. Si la pregunta pide interes, necesidad, motivacion u objetivo del cliente, puedes responder reescribiendo fielmente la necesidad, problema, prioridad, capacidad buscada, riesgo a mitigar o siguiente paso solicitado que aparezca en los fragmentos. Ejemplo: pregunta '¿En qué está interesado el cliente?' y fragmento 'necesita fortalecer la seguridad de acceso y validar identidades' => respuesta valida 'El cliente esta interesado en fortalecer la seguridad de acceso y validar identidades'. Si no alcanza con esos fragmentos, devuelve insuficiente o ambiguo. Nunca inventes y no cites texto literal.",
      },
      {
        role: "user",
        content: JSON.stringify({
          stage: {
            id: Number(salesStage?.id || 0),
            code: String(salesStage?.code || ""),
            name: String(salesStage?.name || ""),
          },
          processGuideOverview: {
            generalContext: structuredGuide.generalContext,
            stageObjective: stageGuide?.objective || "",
            keySignals: stageGuide?.keySignals || [],
            sampleQuestions: stageGuide?.sampleQuestions || [],
          },
          question: {
            questionId: Number(question?.questionId || 0),
            code: String(question?.code || ""),
            prompt: String(question?.aiPrompt || question?.prompt || ""),
            basePrompt: String(question?.basePrompt || question?.prompt || ""),
            responseType: String(question?.responseType || ""),
            currentAnswer: String(question?.currentAnswer || ""),
            expectedAction: String(question?.expectedAction || "fill_empty"),
            questionGuidance: String(question?.questionGuidance || ""),
            candidateEvidence: Array.isArray(question?.candidateEvidence)
              ? question.candidateEvidence
              : [],
          },
          rules: {
            analyzeSingleQuestion: true,
            analyzeOnlyProvidedEvidence: true,
            allowClearSemanticEquivalence: true,
            neverInvent: true,
          },
          expectedJsonShape: {
            suggestions: [
              {
                questionId: 0,
                status: "proposed|insufficient_evidence|ambiguous_evidence",
                proposalKind: "fill_empty|replace_existing",
                proposedAnswer: "",
                reason: "",
              },
            ],
          },
        }),
      },
    ],
  };
}

async function requestOpenAiSuggestions(payload) {
  const response = await fetch(
    `${config.openai.baseUrl.replace(/\/$/, "")}/responses`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openai.apiKey}`,
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return extractJsonObject(extractResponseOutputText(data));
}

function shouldRetryWithFocusedPass(question, suggestion) {
  if (!question || !suggestion) return false;
  if (suggestion.status === "proposed") return false;

  const evidence = Array.isArray(question.candidateEvidence)
    ? question.candidateEvidence
    : [];
  if (!evidence.length) return false;

  const topScore = Number(evidence[0]?.relevanceScore || 0);
  return topScore >= 3;
}

function mergeSuggestions(baseSuggestions, retrySuggestions) {
  const retryByQuestionId = new Map(
    (Array.isArray(retrySuggestions) ? retrySuggestions : []).map((item) => [
      Number(item.questionId),
      item,
    ]),
  );

  const suggestions = (
    Array.isArray(baseSuggestions) ? baseSuggestions : []
  ).map(
    (suggestion) =>
      retryByQuestionId.get(Number(suggestion.questionId)) || suggestion,
  );

  return {
    suggestions,
    summary: summarizeSuggestions(suggestions),
  };
}

function buildEmptySuggestionResult(questionInputs, reason) {
  const suggestions = questionInputs.map((question) => ({
    questionId: question.questionId,
    questionCode: question.code,
    currentAnswer: question.currentAnswer,
    status: "insufficient_evidence",
    proposalKind: question.expectedAction,
    proposedAnswer: "",
    reason,
  }));

  return {
    suggestions,
    summary: summarizeSuggestions(suggestions),
  };
}

async function runTargetedQuestionRecovery({
  salesStage,
  structuredGuide,
  stageGuide,
  questions,
}) {
  const recoveredSuggestions = [];

  for (const question of Array.isArray(questions) ? questions : []) {
    const parsed = await requestOpenAiSuggestions(
      buildTargetedQuestionRecoveryPayload({
        salesStage,
        structuredGuide,
        stageGuide,
        question,
      }),
    );
    const normalized = normalizeModelSuggestions(parsed?.suggestions, [
      question,
    ]);
    recoveredSuggestions.push(...normalized.suggestions);
  }

  return recoveredSuggestions;
}

export function isOpportunityStageAnswerSuggestionsEnabled() {
  return Boolean(
    config.features.opportunityStageAnswerSuggestionsEnabled &&
    config.openai.apiKey,
  );
}

function normalizeStageValidationDecision(value) {
  const normalized = normalizeText(value);
  if (normalized === "ready_to_advance") return "ready_to_advance";
  if (normalized === "advance_with_caution") return "advance_with_caution";
  if (normalized === "not_ready_to_advance") return "not_ready_to_advance";
  return "not_ready_to_advance";
}

function normalizeStageValidationStatus(value) {
  const normalized = normalizeText(value);
  if (normalized === "adequate") return "adequate";
  if (normalized === "weak") return "weak";
  if (normalized === "missing") return "missing";
  if (normalized === "inconsistent") return "inconsistent";
  return "weak";
}

function normalizeStageValidationConfidence(value) {
  const normalized = normalizeText(value);
  if (normalized === "high") return "high";
  if (normalized === "medium") return "medium";
  if (normalized === "low") return "low";
  return "medium";
}

function buildStageValidationQuestionContexts({
  questions,
  stageGuide,
  documentChunks,
}) {
  return (Array.isArray(questions) ? questions : []).map((question) => ({
    questionId: Number(question.question_id || question.id || 0),
    code: String(question.code || ""),
    prompt: String(question.prompt || "").trim(),
    isRequired: Boolean(question.is_required),
    answerValue: String(question.answer_value || "").trim(),
    aiPrompt: buildAiRuntimePrompt({
      code: question.code,
      basePrompt: question.prompt,
      prompt: question.prompt,
    }),
    questionGuidance: buildQuestionGuidance(
      {
        code: question.code,
        prompt: question.prompt,
      },
      stageGuide,
    ),
    candidateEvidence: rankEvidenceChunksForQuestion(
      {
        code: question.code,
        prompt: question.prompt,
      },
      stageGuide,
      documentChunks,
    ),
  }));
}

function summarizeStageValidationQuestionContexts(questionContexts) {
  return summarizeForPrompt(
    (Array.isArray(questionContexts) ? questionContexts : [])
      .map((question) =>
        [
          `Pregunta ${question.questionId}: ${question.aiPrompt || question.prompt}`,
          `Pregunta base: ${question.prompt}`,
          `Obligatoria: ${question.isRequired ? "si" : "no"}`,
          `Respuesta actual: ${question.answerValue || "(vacia)"}`,
          `Guia: ${question.questionGuidance || "Sin guia adicional"}`,
          question.candidateEvidence.length
            ? `Evidencia candidata:\n${question.candidateEvidence
                .map(
                  (evidence, index) =>
                    `- Fuente ${index + 1} (${evidence.documentName}): ${evidence.excerpt}`,
                )
                .join("\n")}`
            : "Evidencia candidata: ninguna con relevancia suficiente.",
        ].join("\n"),
      )
      .join("\n\n---\n\n"),
    22000,
  );
}

function buildStageValidationPayload({
  salesStage,
  structuredGuide,
  stageGuide,
  questionContexts,
  sharedDocumentContext,
}) {
  const normalizedStageCode = normalizeText(
    salesStage?.code || salesStage?.name,
  );
  const decisionGuidance =
    normalizedStageCode === "contacto_inicial"
      ? "Regla especifica para Contacto Inicial: considera la etapa lista para avanzar cuando la respuesta actual deja claro que el cliente expreso una necesidad o interes concreto que Access Quality puede atender y ya existe una reunion, seguimiento, prueba tecnica, demostracion o siguiente paso acordado para profundizar la oportunidad. Si solo existe interes general sin un siguiente paso claro, como maximo devuelve advance_with_caution."
      : "";

  return {
    model: config.openai.model,
    temperature: 0.1,
    top_p: 1,
    input: [
      {
        role: "system",
        content:
          "Evalua si una oportunidad esta lista para avanzar a la siguiente etapa del proceso comercial y responde solo con JSON valido. Usa exclusivamente las respuestas actuales de la etapa, el contexto documental de la oportunidad y la guia del proceso comercial como criterio de evaluacion. Debes ser conservador: una respuesta no vale por existir, debe ser suficientemente concreta, util y consistente con el objetivo de la etapa. Si faltan datos criticos, si las respuestas son vagas, si hay contradicciones o si solo hay actividad comercial sin sustancia, decide que no esta lista para avanzar. No inventes hechos, no asumas madurez comercial y no confundas interes general con cumplimiento de etapa. Devuelve un diagnostico accionable y breve, sin citas largas ni ids internos.",
      },
      {
        role: "user",
        content: JSON.stringify({
          stage: {
            id: Number(salesStage?.id || 0),
            code: String(salesStage?.code || ""),
            name: String(salesStage?.name || ""),
          },
          processGuideOverview: {
            generalContext: structuredGuide.generalContext,
            stageObjective: stageGuide?.objective || "",
            keySignals: stageGuide?.keySignals || [],
            sampleQuestions: stageGuide?.sampleQuestions || [],
          },
          documentCorpus: sharedDocumentContext,
          questionContexts:
            summarizeStageValidationQuestionContexts(questionContexts),
          rules: {
            onlyCurrentStage: true,
            evaluateReadinessToAdvance: true,
            beStrictWithMissingOrVagueAnswers: true,
            neverInvent: true,
            preferNotReadyWhenEvidenceIsWeak: true,
            stageSpecificDecisionGuidance: decisionGuidance,
          },
          expectedJsonShape: {
            decision:
              "ready_to_advance|advance_with_caution|not_ready_to_advance",
            summary: "",
            reasons: [""],
            suggestions: [""],
            confidence: "high|medium|low",
            questionAssessments: [
              {
                questionId: 0,
                status: "adequate|weak|missing|inconsistent",
                reason: "",
                suggestion: "",
              },
            ],
          },
        }),
      },
    ],
  };
}

function normalizeStageValidationResult(rawResult, questionContexts) {
  const questionMap = new Map(
    (Array.isArray(questionContexts) ? questionContexts : []).map(
      (question) => [Number(question.questionId), question],
    ),
  );

  const rawAssessments = Array.isArray(rawResult?.questionAssessments)
    ? rawResult.questionAssessments
    : [];
  const assessmentsByQuestionId = new Map();

  for (const item of rawAssessments) {
    const questionId = Number(item?.questionId);
    if (!questionMap.has(questionId)) continue;
    const question = questionMap.get(questionId);
    const status = normalizeStageValidationStatus(item?.status);
    assessmentsByQuestionId.set(questionId, {
      questionId,
      questionCode: String(question?.code || ""),
      prompt: String(question?.prompt || ""),
      answerValue: String(question?.answerValue || ""),
      status,
      reason:
        String(item?.reason || "").trim() ||
        buildFallbackAssessmentReason({
          question,
          status,
          hasAnswer: Boolean(String(question?.answerValue || "").trim()),
        }),
      suggestion:
        String(item?.suggestion || "").trim() ||
        buildFallbackAssessmentSuggestion({
          question,
          status,
          hasAnswer: Boolean(String(question?.answerValue || "").trim()),
        }),
    });
  }

  const questionAssessments = (
    Array.isArray(questionContexts) ? questionContexts : []
  ).map((question) => {
    const existing = assessmentsByQuestionId.get(Number(question.questionId));
    if (existing) return existing;

    const hasAnswer = Boolean(String(question.answerValue || "").trim());
    return {
      questionId: Number(question.questionId),
      questionCode: String(question.code || ""),
      prompt: String(question.prompt || ""),
      answerValue: String(question.answerValue || ""),
      status: hasAnswer ? "weak" : "missing",
      reason: buildFallbackAssessmentReason({
        question,
        status: hasAnswer ? "weak" : "missing",
        hasAnswer,
      }),
      suggestion: buildFallbackAssessmentSuggestion({
        question,
        status: hasAnswer ? "weak" : "missing",
        hasAnswer,
      }),
    };
  });

  const reasons = Array.isArray(rawResult?.reasons)
    ? rawResult.reasons
        .map((reason) => String(reason || "").trim())
        .filter(Boolean)
    : [];
  const suggestions = Array.isArray(rawResult?.suggestions)
    ? rawResult.suggestions
        .map((suggestion) => String(suggestion || "").trim())
        .filter(Boolean)
    : [];

  return {
    decision: normalizeStageValidationDecision(rawResult?.decision),
    summary:
      String(rawResult?.summary || "").trim() ||
      "No fue posible obtener una conclusion suficientemente clara sobre la etapa.",
    reasons,
    suggestions,
    confidence: normalizeStageValidationConfidence(rawResult?.confidence),
    questionAssessments,
  };
}

function buildAssessmentPromptFragment(question) {
  const prompt = String(question?.prompt || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^¿/, "")
    .replace(/\?$/, "")
    .trim();

  if (!prompt) {
    return "lo que pide la pregunta";
  }

  return prompt.charAt(0).toLowerCase() + prompt.slice(1);
}

function buildFallbackAssessmentReason({ question, status, hasAnswer }) {
  const promptFragment = buildAssessmentPromptFragment(question);

  if (status === "missing" || !hasAnswer) {
    return `Aun no queda respondido de forma explicita ${promptFragment}.`;
  }

  if (status === "inconsistent") {
    return `La respuesta actual no deja una version consistente sobre ${promptFragment}.`;
  }

  if (status === "adequate") {
    return "La respuesta cubre lo esencial de la pregunta con suficiente claridad.";
  }

  return `La respuesta actual existe, pero sigue siendo debil porque no deja claramente resuelto ${promptFragment} con hechos verificables del caso.`;
}

function buildFallbackAssessmentSuggestion({ question, status, hasAnswer }) {
  const promptFragment = buildAssessmentPromptFragment(question);

  if (status === "inconsistent") {
    return `Ejemplo de como fortalecerla: deja una sola version consistente sobre ${promptFragment} e incluye el dato correcto con contexto verificable.`;
  }

  if (status === "adequate") {
    return "Sin accion inmediata.";
  }

  return `Ejemplo de como fortalecerla: responde de forma explicita ${promptFragment} e incluye al menos un hecho verificable del caso, como monto, fecha, responsable, sistema afectado, riesgo, objetivo o siguiente paso, segun aplique.`;
}

function formatValidationAssessmentLabel(assessment) {
  const prompt = String(assessment?.prompt || "")
    .replace(/\s+/g, " ")
    .trim();
  if (prompt) {
    return prompt;
  }

  const questionCode = String(assessment?.questionCode || "")
    .replace(/_/g, " ")
    .trim();
  if (questionCode) {
    return questionCode;
  }

  const questionId = Number(assessment?.questionId || 0);
  return questionId > 0 ? `Pregunta ${questionId}` : "Pregunta";
}

function buildAssessmentNarrativeItems(
  relevantAssessments,
  statuses,
  fieldName,
) {
  return relevantAssessments
    .filter((assessment) => statuses.includes(assessment?.status))
    .slice(0, 4)
    .map((assessment) => {
      const label = formatValidationAssessmentLabel(assessment);
      const detail = String(assessment?.[fieldName] || "")
        .replace(/\s+/g, " ")
        .trim();

      if (!detail) {
        return null;
      }

      return `${label}: ${detail}`;
    })
    .filter(Boolean);
}

function buildReconciledValidationNarrative({
  decision,
  relevantAssessments,
  counts,
}) {
  const relevantCount = relevantAssessments.length;

  if (decision === "ready_to_advance") {
    return {
      summary:
        "La etapa esta lista para avanzar porque las preguntas obligatorias cuentan con respuestas suficientemente concretas y consistentes.",
      reasons: [
        relevantCount > 0
          ? `Se evaluaron ${relevantCount} pregunta(s) obligatoria(s) y todas quedaron con nivel adecuado para sustentar el avance.`
          : "Las respuestas evaluadas de la etapa son suficientes para sustentar el avance.",
      ],
      suggestions: [
        "Avanza a la siguiente etapa y documenta los hallazgos nuevos que se obtengan durante su desarrollo.",
      ],
      confidence: "high",
    };
  }

  if (decision === "advance_with_caution") {
    const weakReasons = buildAssessmentNarrativeItems(
      relevantAssessments,
      ["weak"],
      "reason",
    );
    const weakSuggestions = buildAssessmentNarrativeItems(
      relevantAssessments,
      ["weak"],
      "suggestion",
    );

    return {
      summary:
        "La etapa puede avanzar con reservas porque no hay respuestas obligatorias faltantes o inconsistentes, pero aun existen respuestas debiles que conviene fortalecer.",
      reasons: [
        `Las preguntas obligatorias ya tienen respuesta, pero ${counts.weak} siguen siendo debiles o poco verificables para cerrar la etapa con total solidez.`,
        ...weakReasons,
      ],
      suggestions: weakSuggestions.length
        ? weakSuggestions
        : [
            "Fortalece las respuestas debiles con datos mas concretos, verificables o accionables antes de depender de esta etapa como cierre definitivo.",
          ],
      confidence: "medium",
    };
  }

  const reasons = [];
  if (counts.missing > 0) {
    reasons.push(
      `${counts.missing} pregunta(s) obligatoria(s) siguen sin respuesta suficiente.`,
    );
  }
  if (counts.inconsistent > 0) {
    reasons.push(
      `${counts.inconsistent} pregunta(s) obligatoria(s) presentan informacion inconsistente o contradictoria.`,
    );
  }
  if (counts.weak > 0) {
    reasons.push(
      `${counts.weak} pregunta(s) obligatoria(s) siguen siendo debiles o poco verificables.`,
    );
  }

  const detailedReasons = buildAssessmentNarrativeItems(
    relevantAssessments,
    ["missing", "inconsistent", "weak"],
    "reason",
  );
  const detailedSuggestions = buildAssessmentNarrativeItems(
    relevantAssessments,
    ["missing", "inconsistent", "weak"],
    "suggestion",
  );

  return {
    summary:
      "La etapa no esta lista para avanzar porque aun hay respuestas obligatorias faltantes, inconsistentes o demasiado debiles para sustentar el avance.",
    reasons:
      reasons.length || detailedReasons.length
        ? [...reasons, ...detailedReasons]
        : [
            "La informacion disponible de la etapa no alcanza para sostener un avance consistente.",
          ],
    suggestions: detailedSuggestions.length
      ? detailedSuggestions
      : [
          "Completa o fortalece las respuestas obligatorias antes de volver a validar la etapa.",
        ],
    confidence:
      counts.missing > 0 || counts.inconsistent > 0 ? "high" : "medium",
  };
}

function reconcileStageValidationResult({
  questionContexts,
  normalizedResult,
}) {
  const contexts = Array.isArray(questionContexts) ? questionContexts : [];
  const assessments = Array.isArray(normalizedResult?.questionAssessments)
    ? normalizedResult.questionAssessments
    : [];
  const requiredIds = new Set(
    contexts
      .filter((question) => question.isRequired)
      .map((question) => Number(question.questionId)),
  );

  const relevantAssessments = assessments.filter((assessment) =>
    requiredIds.size > 0
      ? requiredIds.has(Number(assessment.questionId))
      : Boolean(String(assessment.answerValue || "").trim()) ||
        assessments.length > 0,
  );

  if (!relevantAssessments.length) {
    return normalizedResult;
  }

  const counts = relevantAssessments.reduce(
    (accumulator, assessment) => {
      const status = normalizeStageValidationStatus(assessment?.status);
      accumulator[status] += 1;
      return accumulator;
    },
    {
      adequate: 0,
      weak: 0,
      missing: 0,
      inconsistent: 0,
    },
  );

  let effectiveDecision = "ready_to_advance";
  if (counts.missing > 0 || counts.inconsistent > 0) {
    effectiveDecision = "not_ready_to_advance";
  } else if (counts.weak > 0) {
    effectiveDecision = "advance_with_caution";
  }

  if (effectiveDecision === normalizedResult.decision) {
    return normalizedResult;
  }

  return {
    ...normalizedResult,
    decision: effectiveDecision,
    ...buildReconciledValidationNarrative({
      decision: effectiveDecision,
      relevantAssessments,
      counts,
    }),
  };
}

function isContactoInicialStage(salesStage) {
  const normalizedCode = normalizeText(salesStage?.code || salesStage?.name);
  return normalizedCode === "contacto_inicial";
}

function hasNeedSignal(text) {
  return /(necesit|problema|interes|busca|requiere|prioridad|urgenc|riesgo|seguridad|control|mejorar|optimizar|proteger|api|dns|aws|trafico|solucion)/.test(
    text,
  );
}

function hasFollowUpSignal(text) {
  return /(reunion|seguimiento|demo|demostracion|prueba tecnica|sesion|agenda|agendad|agendar|coordina|coordinad|equipo tecnico|validar la solucion|validar la propuesta|siguiente paso)/.test(
    text,
  );
}

function applyStageValidationGuardrails({
  salesStage,
  questionContexts,
  normalizedResult,
}) {
  if (!isContactoInicialStage(salesStage)) {
    return normalizedResult;
  }

  const requiredQuestions = (
    Array.isArray(questionContexts) ? questionContexts : []
  ).filter((question) => question.isRequired);
  const relevantQuestions = requiredQuestions.length
    ? requiredQuestions
    : (Array.isArray(questionContexts) ? questionContexts : []).filter(
        (question) => String(question.answerValue || "").trim(),
      );
  const relevantAnswersText = normalizeText(
    relevantQuestions
      .map((question) => question.answerValue || "")
      .join(" \n "),
  );
  const allQuestionsAnswered =
    relevantQuestions.length > 0 &&
    relevantQuestions.every((question) =>
      String(question.answerValue || "").trim(),
    );
  const hasConcreteNeed =
    relevantAnswersText.length >= 40 && hasNeedSignal(relevantAnswersText);
  const hasConcreteFollowUp = hasFollowUpSignal(relevantAnswersText);
  const hasInconsistentAssessment = (
    Array.isArray(normalizedResult?.questionAssessments)
      ? normalizedResult.questionAssessments
      : []
  ).some((assessment) => assessment?.status === "inconsistent");

  if (!allQuestionsAnswered || !hasConcreteNeed || hasInconsistentAssessment) {
    return normalizedResult;
  }

  if (hasConcreteFollowUp) {
    return {
      ...normalizedResult,
      decision: "ready_to_advance",
      summary:
        "La etapa de Contacto Inicial esta lista para avanzar porque ya existe una necesidad concreta del cliente y un siguiente paso acordado para profundizar la oportunidad.",
      reasons: [
        "La respuesta actual expresa una necesidad o interes concreto del cliente.",
        "Tambien deja claro un siguiente paso de seguimiento o validacion tecnica, que cumple el criterio de cierre de Contacto Inicial.",
      ],
      suggestions: [
        "Ejecuta la reunion o prueba tecnica y documenta los hallazgos para desarrollar la oportunidad en la siguiente etapa.",
      ],
      confidence: "high",
      questionAssessments: normalizedResult.questionAssessments.map(
        (assessment) => ({
          ...assessment,
          status: assessment.status === "missing" ? "missing" : "adequate",
          reason:
            assessment.status === "missing"
              ? assessment.reason
              : "La respuesta demuestra una necesidad concreta del cliente y sustenta el avance de la etapa.",
          suggestion:
            assessment.status === "missing"
              ? assessment.suggestion
              : "Registrar el resultado del siguiente paso tecnico o comercial en la siguiente etapa.",
        }),
      ),
    };
  }

  if (normalizedResult.decision === "not_ready_to_advance") {
    return {
      ...normalizedResult,
      decision: "advance_with_caution",
      summary:
        "La etapa de Contacto Inicial puede avanzar con reservas porque la necesidad del cliente ya es clara, aunque el siguiente paso todavia no esta suficientemente confirmado.",
      reasons: [
        "La respuesta actual ya expresa una necesidad o interes concreto del cliente.",
        "Aun falta dejar mas claro el siguiente paso de seguimiento para cerrar Contacto Inicial con mayor solidez.",
      ],
      suggestions: [
        "Confirma y documenta una reunion, demo o prueba tecnica para fortalecer el avance a la siguiente etapa.",
      ],
      confidence: "medium",
      questionAssessments: normalizedResult.questionAssessments.map(
        (assessment) => ({
          ...assessment,
          status: assessment.status === "missing" ? "missing" : "adequate",
        }),
      ),
    };
  }

  return normalizedResult;
}

export async function validateOpportunityCurrentStageWithAi({
  salesStage,
  questions,
  documents,
}) {
  if (!isOpportunityStageAnswerSuggestionsEnabled()) {
    throw new Error("La validacion de etapas con IA no esta habilitada");
  }

  const questionContexts = buildStageValidationQuestionContexts({
    questions,
    stageGuide: null,
    documentChunks: [],
  });
  if (!questionContexts.length) {
    return {
      decision: "ready_to_advance",
      summary: "La etapa actual no tiene preguntas activas configuradas.",
      reasons: [],
      suggestions: [],
      confidence: "high",
      questionAssessments: [],
      meta: {
        questionCount: 0,
        documentCount: 0,
        stageGuideAvailable: false,
      },
    };
  }

  const availableDocuments = (Array.isArray(documents) ? documents : []).filter(
    (document) =>
      String(
        document?.normalizedText ||
          document?.rawText ||
          document?.transcriptText ||
          "",
      ).trim(),
  );

  const structuredGuide = await loadStructuredProcessGuide();
  const stageGuide = structuredGuide.stagesByName.get(
    normalizeStageName(salesStage?.name || salesStage?.code || ""),
  );
  const documentChunks = buildDocumentChunks(availableDocuments);
  const questionContextsWithGuidance = buildStageValidationQuestionContexts({
    questions,
    stageGuide,
    documentChunks,
  });

  const parsed = await requestOpenAiSuggestions(
    buildStageValidationPayload({
      salesStage,
      structuredGuide,
      stageGuide,
      questionContexts: questionContextsWithGuidance,
      sharedDocumentContext: buildSharedDocumentContext(documentChunks),
    }),
  );

  const normalizedResult = normalizeStageValidationResult(
    parsed,
    questionContextsWithGuidance,
  );
  const reconciledResult = reconcileStageValidationResult({
    questionContexts: questionContextsWithGuidance,
    normalizedResult,
  });

  return {
    ...applyStageValidationGuardrails({
      salesStage,
      questionContexts: questionContextsWithGuidance,
      normalizedResult: reconciledResult,
    }),
    meta: {
      questionCount: questionContextsWithGuidance.length,
      documentCount: availableDocuments.length,
      stageGuideAvailable: Boolean(stageGuide),
    },
  };
}

export async function suggestOpportunityStageAnswers({
  salesStage,
  questions,
  existingAnswers,
  documents,
}) {
  const questionInputs = buildQuestionShape(questions, existingAnswers);
  if (!questionInputs.length) {
    return {
      suggestions: [],
      summary: {
        proposedCount: 0,
        fillCount: 0,
        replaceCount: 0,
        ambiguousCount: 0,
        insufficientCount: 0,
      },
      meta: {
        questionCount: 0,
        documentCount: 0,
        stageGuideAvailable: false,
      },
    };
  }

  const availableDocuments = (Array.isArray(documents) ? documents : []).filter(
    (document) =>
      String(
        document?.normalizedText ||
          document?.rawText ||
          document?.transcriptText ||
          "",
      ).trim(),
  );
  if (!availableDocuments.length) {
    const result = buildEmptySuggestionResult(
      questionInputs,
      "No hay documentos con texto util en la oportunidad para proponer respuestas.",
    );
    return {
      ...result,
      meta: {
        questionCount: questionInputs.length,
        documentCount: 0,
        stageGuideAvailable: false,
      },
    };
  }

  if (!isOpportunityStageAnswerSuggestionsEnabled()) {
    throw new Error(
      "Las sugerencias documentales de respuestas no estan habilitadas",
    );
  }

  const structuredGuide = await loadStructuredProcessGuide();
  const stageGuide = structuredGuide.stagesByName.get(
    normalizeStageName(salesStage?.name || salesStage?.code || ""),
  );
  const documentChunks = buildDocumentChunks(availableDocuments);
  const sharedDocumentContext = buildSharedDocumentContext(documentChunks);
  const questionContexts = questionInputs.map((question) => ({
    ...question,
    aiPrompt: buildAiRuntimePrompt(question),
    questionGuidance: buildQuestionGuidance(question, stageGuide),
    candidateEvidence: rankEvidenceChunksForQuestion(
      question,
      stageGuide,
      documentChunks,
    ),
  }));

  const parsed = await requestOpenAiSuggestions(
    buildOpenAiPayload({
      salesStage,
      structuredGuide,
      stageGuide,
      questionContexts,
      sharedDocumentContext,
    }),
  );
  const normalized = normalizeModelSuggestions(
    parsed?.suggestions,
    questionContexts,
  );

  const retryQuestions = questionContexts.filter((question) => {
    const suggestion = normalized.suggestions.find(
      (item) => Number(item.questionId) === Number(question.questionId),
    );
    return shouldRetryWithFocusedPass(question, suggestion);
  });

  const afterRetryResult = retryQuestions.length
    ? mergeSuggestions(
        normalized.suggestions,
        normalizeModelSuggestions(
          (
            await requestOpenAiSuggestions(
              buildOpenAiPayload({
                salesStage,
                structuredGuide,
                stageGuide,
                questionContexts: retryQuestions,
                sharedDocumentContext: "",
                retryMode: true,
              }),
            )
          )?.suggestions,
          retryQuestions,
        ).suggestions,
      )
    : normalized;

  const semanticRecoveryQuestions = questionContexts.filter((question) => {
    const suggestion = afterRetryResult.suggestions.find(
      (item) => Number(item.questionId) === Number(question.questionId),
    );
    return suggestion?.status === "insufficient_evidence";
  });

  const finalResult = semanticRecoveryQuestions.length
    ? mergeSuggestions(
        afterRetryResult.suggestions,
        normalizeModelSuggestions(
          (
            await requestOpenAiSuggestions(
              buildSemanticRecoveryPayload({
                salesStage,
                structuredGuide,
                stageGuide,
                questionContexts: semanticRecoveryQuestions,
                sharedDocumentContext,
              }),
            )
          )?.suggestions,
          semanticRecoveryQuestions,
        ).suggestions,
      )
    : afterRetryResult;

  const targetedRecoveryQuestions = questionContexts.filter((question) => {
    const suggestion = finalResult.suggestions.find(
      (item) => Number(item.questionId) === Number(question.questionId),
    );
    return (
      suggestion?.status === "insufficient_evidence" &&
      Array.isArray(question.candidateEvidence) &&
      question.candidateEvidence.length > 0
    );
  });

  const settledResult = targetedRecoveryQuestions.length
    ? mergeSuggestions(
        finalResult.suggestions,
        await runTargetedQuestionRecovery({
          salesStage,
          structuredGuide,
          stageGuide,
          questions: targetedRecoveryQuestions,
        }),
      )
    : finalResult;

  return {
    ...settledResult,
    meta: {
      questionCount: questionInputs.length,
      documentCount: availableDocuments.length,
      chunkCount: documentChunks.length,
      stageGuideAvailable: Boolean(stageGuide),
      focusedRetryQuestionCount: retryQuestions.length,
      semanticRecoveryQuestionCount: semanticRecoveryQuestions.length,
      targetedRecoveryQuestionCount: targetedRecoveryQuestions.length,
    },
  };
}
