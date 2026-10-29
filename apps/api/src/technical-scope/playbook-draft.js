import { z } from "zod";
import { query } from "../db.js";
import { retrieveDocumentacionRagTopicEvidence } from "../documentacion-rag/service.js";
import { TECHNICAL_SCOPE_AI_FEATURES, requestAiJson } from "./ai.js";
import { findOpportunityIdsForKeywords } from "./crm-diagnostic.js";
import {
  PLAYBOOK_STATUS,
  playbookContentSchema,
  playbookDependencySchema,
  playbookExpectationSchema,
  playbookModuleSchema,
  playbookQuestionSchema,
  playbookScopeSchema,
  playbookTopologyTemplateSchema,
} from "./playbook-schema.js";
import { getPlaybookByCode, savePlaybookVersion } from "./playbooks.js";
import { SEED_PLAYBOOKS } from "./seeds/playbooks.js";

const RAG_QUERIES = [
  { prompt: "cuestionario de levantamiento: preguntas que se deben hacer al cliente antes de diseñar", docTypes: ["questionnaire"] },
  { prompt: "requisitos, prerrequisitos y limitaciones de la solución", docTypes: null },
  { prompt: "arquitectura de referencia, componentes y topología típica", docTypes: ["reference_architecture", "design_guide"] },
  { prompt: "dimensionamiento, capacidad y sizing de la solución", docTypes: ["sizing_sheet", "design_guide"] },
  { prompt: "fases de implementación, entregables y criterios de aceptación", docTypes: ["implementation_guide"] },
  { prompt: "levantamiento técnico, descubrimiento y preguntas al cliente antes de una demo o prueba de concepto", docTypes: null },
];

const COMMON_RULES = [
  "Eres un ingeniero preventa senior que redacta una parte del playbook tecnico de una solucion para generar propuestas y alcances.",
  "Responde exclusivamente con JSON valido y solo con las llaves pedidas.",
  "Los codigos usan minusculas, numeros y guion bajo. Los modulos y preguntas deben ser consistentes (cada question.module existe en modules o es 'general'; las condiciones usan codigos de pregunta existentes).",
  "Parte del contenido actual (current): mejoralo y amplialo con la evidencia, sin eliminar contenido valido salvo que la evidencia lo contradiga.",
  "Usa SOLO la evidencia provista (knowledge del fabricante y commonQuestions/typicalProducts del CRM). No inventes especificaciones ni cifras; si algo no esta respaldado, dejalo general.",
  "Nunca incluyas nombres de clientes, direcciones IP, correos, montos ni datos propios de un cliente: el playbook debe quedar generalizado.",
  "Limitate estrictamente a la solucion indicada en solution: el conocimiento puede incluir otros productos del mismo fabricante y debes ignorarlos.",
  "Escribe en espanol.",
].join(" ");

// Items the model got wrong are dropped instead of failing the whole draft; the merged content is validated afterwards.
const lenientArray = (itemSchema, max) =>
  z
    .array(z.any())
    .transform((items) =>
      items
        .map((item) => itemSchema.safeParse(item))
        .filter((result) => result.success)
        .map((result) => result.data)
        .slice(0, max),
    );

// The draft is built from several small requests: the gateway in front of the AI provider cuts calls at about 30 s.
const GENERAL_MODULE = { code: "general", name: "Preguntas generales del proyecto" };

const OUTLINE_PART = {
  prompt:
    "Genera: {\"summary\": string, \"modules\": [{code,name,description,detectKeywords}]}. summary describe la solucion en 2 oraciones. modules son los productos o paquetes que se cotizan por separado (maximo 5; si la solucion es un unico producto con funciones incluidas, devuelve un solo modulo y no conviertas cada funcion en un modulo) y detectKeywords las palabras que los identifican en el nombre de una partida cotizada.",
  schema: z.object({
    summary: z.string().trim().max(2000).optional().default(""),
    modules: lenientArray(playbookModuleSchema, 6),
  }),
  pick: (content) => ({ summary: content.summary, modules: content.modules }),
};

const SCOPE_PARTS = [
  {
    prompt:
      "Genera: {\"scope\": {included:[string], excluded:[string], assumptions:[string], clientResponsibilities:[string]}}. Esqueleto tipico del alcance de un proyecto de esta solucion (maximo 10 elementos por lista).",
    schema: z.object({ scope: playbookScopeSchema.pick({ included: true, excluded: true, assumptions: true, clientResponsibilities: true }) }),
    pick: (content) => ({
      scope: {
        included: content.scope.included,
        excluded: content.scope.excluded,
        assumptions: content.scope.assumptions,
        clientResponsibilities: content.scope.clientResponsibilities,
      },
    }),
  },
  {
    prompt:
      "Genera: {\"scope\": {deliverables:[{name,description}], phases:[{name,activities:[string],durationHint}], acceptanceCriteria:[string], supportNotes:[string], risks:[string]}}. durationHint solo si la evidencia lo respalda, de lo contrario cadena vacia (maximo 8 elementos por lista).",
    schema: z.object({
      scope: playbookScopeSchema.pick({ deliverables: true, phases: true, acceptanceCriteria: true, supportNotes: true, risks: true }),
    }),
    pick: (content) => ({
      scope: {
        deliverables: content.scope.deliverables,
        phases: content.scope.phases,
        acceptanceCriteria: content.scope.acceptanceCriteria,
        supportNotes: content.scope.supportNotes,
        risks: content.scope.risks,
      },
    }),
  },
];

const TOPOLOGY_PART = {
  prompt:
    "Genera: {\"topologyTemplates\": [{code,name,description,topology:{zones:[{id,label,kind:site|cloud|dmz|internet|datacenter|generic}],nodes:[{id,label,sublabel,kind,zoneId}],edges:[{source,target,label,style:solid|dashed}]}}]}. Maximo 3 plantillas de topologia de referencia, sin coordenadas. kind de nodo uno de: user, internet, app, server, k8s, cloud, siem, dns_server, directory, network_device, f5_xc_re, f5_xc_ce, f5_xc_console, nginx, nginx_ingress, nginx_one, bluecat_address_manager, bluecat_bdds, bluecat_micetro, bluecat_edge, bluecat_edge_cloud, livenx, livewire, liveassist, tap, generic.",
  schema: z.object({ topologyTemplates: lenientArray(playbookTopologyTemplateSchema, 6) }),
  pick: (content) => ({ topologyTemplates: content.topologyTemplates }),
};

const questionsPart = (module) => ({
  prompt: `Genera: {"questions": [{code,module,section,prompt,type:text|number|boolean|choice|multi,options,required,helpText,unit}]}. Son las preguntas de levantamiento tecnico que un preventa debe hacer al cliente antes de disenar, SOLO del modulo "${module.code}" (${module.name}); usa module="${module.code}". Maximo 8 preguntas (10 si el modulo es general), agrupadas por section; marca como required como maximo 3, solo las indispensables para dimensionar o disenar. Los codigos deben ser unicos y empezar con un prefijo corto del modulo.`,
  schema: z.object({ questions: lenientArray(playbookQuestionSchema, 10) }),
  pick: (content) => ({ questions: content.questions.filter((question) => question.module === module.code) }),
});

const RULES_PART = {
  prompt:
    "Genera: {\"expectations\": [{code,when:{question,op:eq|neq|gt|gte|lt|lte|truthy|contains,value},expectProduct:regex,message,severity:blocking|warning}], \"dependencies\": [{code,ifProduct:regex,requireProduct:regex,unless:{question,op,value}|null,message,severity}]}. Reglas verificables contra las partidas cotizadas: las regex se comparan con el codigo y la descripcion comercial del producto cotizado en minusculas sin acentos, asi que usa palabras de nombres comerciales (por ejemplo 'bot defense', 'customer edge', 'livenx'), nunca codigos de modulo ni guiones bajos. Incluye solo reglas respaldadas por la evidencia; when/unless solo pueden usar codigos de las questions provistas. Maximo 8 expectations y 6 dependencies.",
  schema: z.object({
    expectations: lenientArray(playbookExpectationSchema, 12).optional().default([]),
    dependencies: lenientArray(playbookDependencySchema, 10).optional().default([]),
  }),
  pick: (content) => ({ expectations: content.expectations, dependencies: content.dependencies }),
};

// Models often return null for optional fields and slightly overlong strings; clean both so the schema defaults and limits apply.
const STRING_CAPS = {
  code: 80, module: 80, unit: 30, section: 300, helpText: 2000, description: 590, summary: 2000,
  name: 160, prompt: 500, message: 500, durationHint: 120, label: 80, sublabel: 120, id: 60,
};

function cleanDraftValue(value, key = "") {
  if (Array.isArray(value)) return value.map((entry) => cleanDraftValue(entry, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== null && entry !== undefined)
        .map(([entryKey, entry]) => [entryKey, cleanDraftValue(entry, entryKey)]),
    );
  }
  if (typeof value === "string") return value.trim().slice(0, STRING_CAPS[key] || 590);
  return value;
}

const draftSourceNotesSchema = z.object({
  sourceNotes: z.array(z.string().trim().max(300)).max(60).optional().default([]),
});

const CUSTOMER_DATA_PATTERNS = [
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
];

export function containsCustomerData(content) {
  const text = JSON.stringify(content);
  return CUSTOMER_DATA_PATTERNS.some((pattern) => pattern.test(text));
}

// Generalized signals from the CRM: question prompts and product names, never customer answers or names.
async function collectCrmSignals(keywords) {
  const opportunityIds = await findOpportunityIdsForKeywords(keywords);
  if (!opportunityIds.length) return { opportunities: 0, commonQuestions: [], typicalProducts: [] };
  const placeholders = opportunityIds.map(() => "?").join(", ");
  const [questions, products] = await Promise.all([
    query(
      `SELECT q.prompt, COUNT(*) AS total
       FROM opportunity_stage_question_answers a
       INNER JOIN opportunity_stage_questions q ON q.id = a.question_id
       WHERE a.opportunity_id IN (${placeholders})
       GROUP BY q.prompt
       ORDER BY total DESC
       LIMIT 25`,
      opportunityIds,
    ),
    query(
      `SELECT qsi.product_description, COUNT(*) AS total
       FROM quotations q
       INNER JOIN quotation_versions qv ON qv.quotation_id = q.id
       INNER JOIN quotation_sections qs ON qs.quotation_version_id = qv.id
       INNER JOIN quotation_section_items qsi ON qsi.quotation_section_id = qs.id
       WHERE q.opportunity_id IN (${placeholders})
       GROUP BY qsi.product_description
       ORDER BY total DESC
       LIMIT 25`,
      opportunityIds,
    ),
  ]);
  return {
    opportunities: opportunityIds.length,
    commonQuestions: questions.map((row) => String(row.prompt)),
    typicalProducts: products.map((row) => String(row.product_description)).filter(Boolean),
  };
}

// Rules written by a person (the seed playbooks) survive a regeneration, together with the questions they depend on.
export function mergeSeedRules(content, playbookCode) {
  const seed = SEED_PLAYBOOKS.find((entry) => entry.code === playbookCode)?.content;
  if (!seed) return content;
  const questions = [...content.questions];
  const known = new Set(questions.map((question) => question.code));
  const expectations = [...content.expectations];
  const dependencies = [...content.dependencies];
  const ensureQuestion = (code) => {
    if (known.has(code)) return true;
    const question = seed.questions.find((entry) => entry.code === code);
    if (!question) return false;
    questions.push(question);
    known.add(code);
    return true;
  };
  const upsert = (list, rule) => {
    const index = list.findIndex((entry) => entry.code === rule.code);
    if (index >= 0) list[index] = rule;
    else list.push(rule);
  };
  for (const rule of seed.expectations || []) {
    if (ensureQuestion(rule.when.question)) upsert(expectations, rule);
  }
  for (const rule of seed.dependencies || []) {
    if (!rule.unless || ensureQuestion(rule.unless.question)) upsert(dependencies, rule);
  }
  const moduleCodes = new Set(["general", ...content.modules.map((module) => module.code)]);
  const finalQuestions = questions.filter((question) => moduleCodes.has(question.module));
  const finalCodes = new Set(finalQuestions.map((question) => question.code));
  return {
    ...content,
    questions: finalQuestions,
    expectations: expectations.filter((rule) => finalCodes.has(rule.when.question)),
    dependencies: dependencies.filter((rule) => !rule.unless || finalCodes.has(rule.unless.question)),
  };
}

export async function generatePlaybookDraft({ playbookCode, userId, instructions = "" }) {
  const playbook = await getPlaybookByCode(playbookCode);
  if (!playbook) {
    const error = new Error("Playbook no encontrado");
    error.status = 404;
    throw error;
  }
  if (!playbook.ragTopicName) {
    const error = new Error("El playbook no tiene un tema de Documentación RAG asociado");
    error.status = 409;
    throw error;
  }

  const knowledge = [];
  const seen = new Set();
  let ragStatus = "no_documents";
  for (const ragQuery of RAG_QUERIES) {
    const retrieve = (docTypes) =>
      retrieveDocumentacionRagTopicEvidence({
        topicName: playbook.ragTopicName,
        prompt: `${playbook.name}: ${ragQuery.prompt}`,
        docTypes,
        topK: 8,
        userId,
        featureCode: "proposals.technical_scope.playbook_draft",
      });
    let result = await retrieve(ragQuery.docTypes);
    // Document types are a preference: when nothing is classified that way, search the whole topic.
    if (ragQuery.docTypes && !result.snippets.length) result = await retrieve(null);
    if (result.status !== "no_documents") ragStatus = result.status;
    for (const snippet of result.snippets) {
      const key = snippet.content.slice(0, 120);
      if (seen.has(key)) continue;
      seen.add(key);
      knowledge.push({ source: snippet.source, text: snippet.content });
    }
  }
  if (!knowledge.length) {
    const error = new Error(
      ragStatus === "not_configured"
        ? "Pinecone no esta configurado"
        : `No hay documentos disponibles en el tema "${playbook.ragTopicName}". Cargalos en Documentación RAG antes de generar el borrador.`,
    );
    error.status = 409;
    error.code = "rag_without_documents";
    throw error;
  }

  const crmKeywords = Array.from(new Set(playbook.detectionKeywords))
    .map((keyword) => String(keyword).trim().toLowerCase())
    .filter((keyword) => keyword.length >= 3);
  const crm = await collectCrmSignals(crmKeywords);

  const trimmedKnowledge = knowledge
    .slice(0, 20)
    .map((snippet) => ({ source: snippet.source, text: snippet.text.slice(0, 1500) }));
  const callPart = (part, extra = {}) =>
    requestAiJson({
      featureCode: TECHNICAL_SCOPE_AI_FEATURES.playbookDraft,
      role: "fast",
      system: `${COMMON_RULES} ${part.prompt} Agrega ademas sourceNotes: [string] con los documentos usados.`,
      user: {
        solution: { code: playbook.code, name: playbook.name, manufacturer: playbook.manufacturer },
        extraInstructions: instructions,
        current: part.pick(playbook.content),
        knowledge: trimmedKnowledge,
        crm,
        ...extra,
      },
      schema: z.preprocess(cleanDraftValue, part.schema.merge(draftSourceNotesSchema)),
      userId,
      timeoutMs: 28_000,
      maxAttempts: 2,
    });

  // Stage 1: outline, scope and topology; stage 2: questions per module; stage 3: rules that reference those questions.
  const [outline, ...stageOne] = await Promise.all([
    callPart(OUTLINE_PART),
    ...SCOPE_PARTS.map((part) => callPart(part)),
    callPart(TOPOLOGY_PART),
  ]);
  // A single-product playbook keeps its single module; the model tends to turn every feature into a module.
  const seedModules = SEED_PLAYBOOKS.find((seed) => seed.code === playbook.code)?.content.modules || [];
  const modules =
    seedModules.length === 1
      ? seedModules
      : playbook.content.modules.length === 1 || !outline.modules.length
        ? playbook.content.modules
        : outline.modules;
  const stageTwo = await Promise.all(
    [GENERAL_MODULE, ...modules].map((module) => callPart(questionsPart(module), { modules: modules.map(({ code, name }) => ({ code, name })) })),
  );
  const seenCodes = new Set();
  const perModule = new Map();
  const questions = stageTwo.flatMap((part) => part.questions).map((question) => {
    let code = question.code;
    if (seenCodes.has(code)) code = `${question.module}_${code}`.slice(0, 80);
    while (seenCodes.has(code)) code = `${code}_2`.slice(0, 80);
    seenCodes.add(code);
    return { ...question, code };
  }).filter((question) => {
    // The prompt asks for few questions per module; enforce it so a questionnaire stays answerable.
    const entry = perModule.get(question.module) || { total: 0, required: 0 };
    const limit = question.module === "general" ? 10 : 8;
    if (entry.total >= limit) return false;
    entry.total += 1;
    if (question.required) {
      if (entry.required >= 3) question.required = false;
      else entry.required += 1;
    }
    perModule.set(question.module, entry);
    return true;
  });
  const rules = await callPart(RULES_PART, {
    modules: modules.map(({ code, name }) => ({ code, name })),
    questions: questions.map(({ code, module, prompt, type, options }) => ({ code, module, prompt, type, options })),
  });

  const parts = [outline, ...stageOne, ...stageTwo, rules];
  const questionCodes = new Set(questions.map((question) => question.code));
  const scope = Object.assign({}, ...stageOne.map((part) => part.scope).filter(Boolean));
  const merged = {
    summary: outline.summary,
    modules,
    questions,
    // AI-drafted rules never block an approval on their own; a person can raise them to "blocking" after validating them.
    expectations: rules.expectations
      .filter((rule) => questionCodes.has(rule.when.question))
      .filter((rule) => !rule.expectProduct.includes("_"))
      .map((rule) => ({ ...rule, severity: "warning" })),
    dependencies: rules.dependencies
      .filter((rule) => !rule.unless || questionCodes.has(rule.unless.question))
      .filter((rule) => !rule.ifProduct.includes("_") && !rule.requireProduct.includes("_"))
      .map((rule) => ({ ...rule, severity: "warning" })),
    scope,
    topologyTemplates: stageOne.find((part) => part.topologyTemplates)?.topologyTemplates || playbook.content.topologyTemplates,
  };
  const parsed = playbookContentSchema.safeParse({ ...playbook.content, ...merged });
  if (!parsed.success) {
    const error = new Error(
      `El borrador generado no es coherente: ${parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`,
    );
    error.status = 502;
    error.code = "ai_invalid_shape";
    throw error;
  }
  const result = {
    content: playbookContentSchema.parse(mergeSeedRules(parsed.data, playbook.code)),
    sourceNotes: Array.from(new Set(parts.flatMap((part) => part.sourceNotes))).slice(0, 60),
  };

  if (containsCustomerData(result.content)) {
    const error = new Error("El borrador incluye datos propios de un cliente (IP o correo); se descarto para evitar contaminacion entre clientes");
    error.status = 502;
    error.code = "customer_data_in_playbook";
    throw error;
  }

  const notes = [
    `Generado con ${knowledge.length} fragmentos del tema "${playbook.ragTopicName}" y senales del CRM (${crm.opportunities} oportunidades).`,
    ...result.sourceNotes,
  ].join("\n");
  const saved = await savePlaybookVersion({
    code: playbook.code,
    content: result.content,
    status: PLAYBOOK_STATUS.draftAi,
    notes,
    generatedBy: "ai_draft",
    userId,
  });
  return { playbook: saved, sourcesUsed: knowledge.length, crmOpportunities: crm.opportunities };
}
