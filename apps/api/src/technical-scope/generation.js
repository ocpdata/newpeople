import { z } from "zod";
import { query } from "../db.js";
import { TECHNICAL_SCOPE_AI_FEATURES, requestAiJson } from "./ai.js";
import { isEmptyAnswerValue, questionsForSelection } from "./profile.js";
import {
  TECHNICAL_SECTION_CATALOG,
  getTechnicalSectionDefinition,
  sectionBlockSchema,
  sectionSourceSchema,
} from "./section-model.js";

const MAX_STAGE_ANSWERS = 30;
const MAX_ANSWER_CHARS = 600;
const MAX_RAG_CONTEXT_PER_PLAYBOOK = 6;
const SECTION_CONCURRENCY = 6;

const SECTION_SYSTEM_PROMPT = [
  "Redactas una seccion del alcance tecnico de una propuesta B2B en espanol.",
  "Responde exclusivamente con JSON valido: {\"blocks\": [{\"type\": \"paragraph|list|heading|table\", \"text\": string, \"items\": [string], \"table\": {\"headers\": [string], \"rows\": [[string]]}}], \"itemRefs\": [string], \"sources\": [{\"kind\": \"answer|document|quotation|rag|playbook|crm\", \"ref\": string, \"label\": string}], \"warnings\": [string]}.",
  "Usa SOLO la evidencia del contexto: respuestas del cuestionario, documentos del cliente, partidas cotizadas, conocimiento del fabricante (knowledge) y el esqueleto del playbook (baseDraft).",
  "No inventes cifras, capacidades, productos, fechas ni compromisos. Si falta un dato, usa lenguaje neutral o declaralo como supuesto.",
  "Nunca incluyas precios, costos, margenes, descuentos, riesgos comerciales ni informacion interna.",
  "itemRefs solo puede contener codigos de producto presentes en quotationItems. Referencia en itemRefs todas las partidas que la seccion describe.",
  "Cada dato obligatorio sin respuesta (missingRequired) debe quedar como supuesto o aclaracion pendiente cuando la seccion lo permita.",
  "Parte del baseDraft y personalizalo con los datos del cliente; conserva su estructura cuando sea adecuada. Usa listas para enumeraciones y tablas (maximo 4 columnas) solo para comparar datos.",
  "Cita en sources de donde sale cada afirmacion relevante: kind answer con ref playbookCode:questionCode, quotation con ref productCode, document con el nombre del archivo, rag con el nombre del documento del conocimiento, playbook para el esqueleto.",
].join(" ");

const generatedSectionSchema = z.object({
  blocks: z.array(sectionBlockSchema).max(40).default([]),
  itemRefs: z.array(z.string().trim().max(120)).max(200).optional().default([]),
  sources: z.array(sectionSourceSchema).max(30).optional().default([]),
  warnings: z.array(z.string().trim().max(400)).max(10).optional().default([]),
});

export function formatAnswerValue(answer) {
  const { value, unit } = answer;
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number") return unit ? `${value} ${unit}` : String(value);
  return String(value ?? "");
}

function unique(list) {
  return Array.from(new Set(list.filter(Boolean)));
}

function paragraph(text) {
  return { type: "paragraph", text, items: [], table: null };
}
function list(items) {
  return { type: "list", text: "", items, table: null };
}
function heading(text) {
  return { type: "heading", text, items: [], table: null };
}
function table(headers, rows) {
  return { type: "table", text: "", items: [], table: { headers, rows } };
}

export async function loadQuotationItemsForScope(quotationVersionId) {
  const rows = await query(
    `SELECT qs.title AS section_title, qsit.code AS inclusion_code,
            qsi.product_code, qsi.product_description, qsi.item_type, qsi.quantity
     FROM quotation_sections qs
     INNER JOIN quotation_section_inclusion_types qsit ON qsit.id = qs.inclusion_type_id
     INNER JOIN quotation_activation_statuses qas ON qas.id = qs.activation_status_id
     INNER JOIN quotation_section_items qsi ON qsi.quotation_section_id = qs.id
     WHERE qs.quotation_version_id = ?
       AND qas.code NOT LIKE 'inactiv%'
     ORDER BY qs.display_order, qs.id, qsi.display_order, qsi.id`,
    [Number(quotationVersionId)],
  );
  return rows
    .filter((row) => row.item_type !== "grupo_productos" && row.product_code)
    .map((row) => ({
      groupTitle: row.section_title || "",
      inclusionCode: row.inclusion_code || "",
      productCode: String(row.product_code),
      productDescription: String(row.product_description || ""),
      quantity: Number(row.quantity || 0),
    }));
}

export async function loadStageAnswersForScope(opportunityId) {
  const rows = await query(
    `SELECT a.answer_value, q.prompt, oss.name AS stage_name
     FROM opportunity_stage_question_answers a
     INNER JOIN (
       SELECT MAX(id) AS id
       FROM opportunity_stage_question_answers
       WHERE opportunity_id = ?
       GROUP BY sales_stage_id, question_id
     ) latest ON latest.id = a.id
     INNER JOIN opportunity_sales_stages oss ON oss.id = a.sales_stage_id
     INNER JOIN opportunity_stage_questions q ON q.id = a.question_id
     ORDER BY oss.stage_order ASC, q.display_order ASC, a.id ASC`,
    [Number(opportunityId)],
  );
  return rows
    .filter((row) => String(row.answer_value || "").trim())
    .slice(0, MAX_STAGE_ANSWERS)
    .map((row) => ({
      stage: row.stage_name,
      question: row.prompt,
      answer: String(row.answer_value).slice(0, MAX_ANSWER_CHARS),
    }));
}

// Draft built only from the playbooks, the confirmed answers and the quotation. It is the baseline for the AI and the fallback.
export function buildDeterministicSections({
  selections,
  playbooks,
  snapshot,
  quotationItems,
}) {
  const answers = Array.isArray(snapshot?.answers) ? snapshot.answers : [];
  const missing = Array.isArray(snapshot?.missing) ? snapshot.missing : [];
  const selected = selections
    .map((selection) => ({
      selection,
      playbook: playbooks.find((entry) => entry.code === selection.code),
    }))
    .filter((entry) => entry.playbook);

  const collect = (picker) =>
    unique(selected.flatMap(({ playbook }) => picker(playbook.content.scope || {})));

  const questionIndex = new Map();
  for (const { selection, playbook } of selected) {
    for (const question of questionsForSelection(playbook, selection.modules)) {
      questionIndex.set(`${selection.code}:${question.code}`, question);
    }
  }
  const answerLines = answers
    .filter((answer) => !isEmptyAnswerValue(answer.value))
    .map((answer) => `${answer.prompt}: ${formatAnswerValue(answer)}`);
  const situationLines = answers
    .filter((answer) => {
      const section = questionIndex.get(`${answer.playbookCode}:${answer.questionCode}`)?.section || "";
      return /situaci[oó]n actual|entorno/i.test(section) && !isEmptyAnswerValue(answer.value);
    })
    .map((answer) => `${answer.prompt}: ${formatAnswerValue(answer)}`);

  const sections = new Map();
  const answerSources = (filter) =>
    answers
      .filter(filter)
      .slice(0, 30)
      .map((answer) => ({
        kind: "answer",
        ref: `${answer.playbookCode}:${answer.questionCode}`,
        label: answer.prompt,
      }));
  const playbookSources = selected.map(({ playbook }) => ({
    kind: "playbook",
    ref: playbook.code,
    label: playbook.name,
  }));

  sections.set("requirements", {
    blocks: answerLines.length
      ? [
          paragraph("Los requerimientos técnicos considerados para esta propuesta, según la información proporcionada por el cliente, son los siguientes:"),
          list(answerLines.slice(0, 25)),
        ]
      : [paragraph("Los requerimientos técnicos se confirmarán durante la etapa de planeación y levantamiento del proyecto.")],
    sources: answerSources(() => true),
  });

  sections.set("current_situation", {
    blocks: situationLines.length
      ? [list(situationLines)]
      : [paragraph("La situación actual del cliente se documentará durante la etapa de levantamiento.")],
    sources: answerSources((answer) => situationLines.some((line) => line.startsWith(answer.prompt))),
  });

  const groups = new Map();
  for (const item of quotationItems) {
    const group = groups.get(item.groupTitle) || [];
    group.push(item);
    groups.set(item.groupTitle, group);
  }
  const solutionBlocks = [
    paragraph(
      `La solución propuesta incluye los siguientes componentes cotizados: ${unique(selected.map(({ playbook }) => playbook.name)).join(", ") || "según la cotización"}.`,
    ),
  ];
  for (const [groupTitle, items] of groups.entries()) {
    if (groupTitle) solutionBlocks.push(heading(groupTitle));
    solutionBlocks.push(
      list(
        items.map(
          (item) =>
            `${item.productCode} — ${item.productDescription || "Sin descripción"} (cantidad: ${item.quantity})`,
        ),
      ),
    );
  }
  sections.set("proposed_solution", {
    blocks: solutionBlocks,
    itemRefs: quotationItems.map((item) => item.productCode),
    sources: quotationItems.slice(0, 30).map((item) => ({
      kind: "quotation",
      ref: item.productCode,
      label: item.productDescription,
    })),
  });

  const modulesText = unique(
    selected.flatMap(({ selection, playbook }) =>
      (playbook.content.modules || [])
        .filter((module) => selection.modules.includes(module.code))
        .map((module) => `${module.name}${module.description ? `: ${module.description}` : ""}`),
    ),
  );
  sections.set("architecture", {
    blocks: [
      ...selected
        .map(({ playbook }) => playbook.content.summary)
        .filter(Boolean)
        .map(paragraph),
      ...(modulesText.length ? [list(modulesText)] : []),
    ],
    sources: playbookSources,
  });

  const toSection = (items, intro) => ({
    blocks: items.length ? [...(intro ? [paragraph(intro)] : []), list(items)] : [],
    sources: playbookSources,
  });
  sections.set("scope_included", toSection(collect((scope) => scope.included || [])));
  sections.set("scope_excluded", toSection(collect((scope) => scope.excluded || [])));

  const missingAssumptions = missing
    .filter((entry) => entry.required)
    .map((entry) => `Dato pendiente de confirmar por el cliente: ${entry.prompt}`);
  sections.set(
    "assumptions",
    toSection(
      [
        ...collect((scope) => scope.assumptions || []),
        ...missingAssumptions,
        ...collect((scope) => scope.clientResponsibilities || []).map(
          (text) => `Responsabilidad del cliente: ${text}`,
        ),
      ],
    ),
  );

  const deliverables = unique(
    selected.flatMap(({ playbook }) =>
      (playbook.content.scope?.deliverables || []).map((entry) => `${entry.name}|${entry.description}`),
    ),
  ).map((entry) => entry.split("|"));
  sections.set("deliverables", {
    blocks: deliverables.length
      ? [table(["Entregable", "Descripción"], deliverables)]
      : [],
    sources: playbookSources,
  });

  const phases = selected.flatMap(({ playbook }) => playbook.content.scope?.phases || []);
  const phaseRows = [];
  const seenPhases = new Set();
  for (const phase of phases) {
    if (seenPhases.has(phase.name)) continue;
    seenPhases.add(phase.name);
    phaseRows.push([
      phase.name,
      phase.activities.join("; "),
      phase.durationHint || "A definir en la planeación",
    ]);
  }
  sections.set("phases", {
    blocks: phaseRows.length ? [table(["Fase", "Actividades", "Duración estimada"], phaseRows)] : [],
    sources: playbookSources,
  });

  sections.set("acceptance", toSection(collect((scope) => scope.acceptanceCriteria || [])));
  sections.set(
    "support_sla",
    {
      blocks: [
        paragraph("El soporte y los niveles de servicio aplicables son los que correspondan a las partidas de soporte y garantía incluidas en la cotización."),
        ...(collect((scope) => scope.supportNotes || []).length
          ? [list(collect((scope) => scope.supportNotes || []))]
          : []),
      ],
      sources: playbookSources,
    },
  );
  sections.set("risks", toSection(collect((scope) => scope.risks || [])));

  return TECHNICAL_SECTION_CATALOG.map((definition) => {
    const draft = sections.get(definition.code) || { blocks: [], sources: [] };
    return {
      code: definition.code,
      title: definition.title,
      blocks: draft.blocks,
      itemRefs: draft.itemRefs || [],
      sources: draft.sources || [],
      edited: false,
      generatedAt: new Date().toISOString(),
    };
  });
}

function compactBlocks(blocks) {
  return (blocks || []).map((block) => ({
    type: block.type,
    text: block.text || undefined,
    items: block.items?.length ? block.items : undefined,
    table: block.table || undefined,
  }));
}

export function buildSectionContext({
  proposal,
  opportunity,
  selections,
  playbooks,
  snapshot,
  quotationItems,
  stageAnswers,
  extractions,
  knowledge,
  asisTopology,
}) {
  return {
    proposal: { title: proposal?.title || "" },
    opportunity: {
      name: opportunity?.name || proposal?.opportunity_name || "",
      accountName: proposal?.account_name || "",
      stage: opportunity?.sales_stage_name || "",
      commercialAnswers: stageAnswers,
    },
    solutions: selections.map((selection) => {
      const playbook = playbooks.find((entry) => entry.code === selection.code);
      return {
        code: selection.code,
        name: playbook?.name || selection.code,
        modules: (playbook?.content.modules || [])
          .filter((module) => selection.modules.includes(module.code))
          .map((module) => module.name),
      };
    }),
    questionnaire: (snapshot?.answers || []).map((answer) => ({
      key: `${answer.playbookCode}:${answer.questionCode}`,
      question: answer.prompt,
      answer: formatAnswerValue(answer),
      source: answer.sourceType,
    })),
    missingRequired: (snapshot?.missing || [])
      .filter((entry) => entry.required)
      .map((entry) => ({
        key: `${entry.playbookCode}:${entry.questionCode}`,
        question: entry.prompt,
      })),
    quotationItems: quotationItems.map((item) => ({
      productCode: item.productCode,
      description: item.productDescription,
      quantity: item.quantity,
      group: item.groupTitle,
    })),
    customerDocuments: (extractions || []).map((extraction) => ({
      document: extraction.documentName,
      kind: extraction.detectedKind,
      summary: extraction.facts?.summary || "",
      metrics: extraction.facts?.metrics || {},
    })),
    asIsTopology: asisTopology?.nodes?.length
      ? {
          nodes: asisTopology.nodes.map((node) => node.label),
          edges: (asisTopology.edges || []).length,
        }
      : null,
    knowledge: (knowledge || []).map((snippet) => ({
      source: snippet.source,
      text: snippet.content,
    })),
  };
}

async function runWithConcurrency(tasks, limit) {
  const results = new Array(tasks.length);
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await tasks[index]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

async function personalizeSection({ draft, context, userId, instructions }) {
  const definition = getTechnicalSectionDefinition(draft.code);
  const result = await requestAiJson({
    featureCode: TECHNICAL_SCOPE_AI_FEATURES.sections,
    role: "fast",
    system: SECTION_SYSTEM_PROMPT,
    user: {
      section: { code: draft.code, title: draft.title, instruction: definition?.instruction || "" },
      extraInstructions: instructions || "",
      baseDraft: compactBlocks(draft.blocks),
      baseItemRefs: draft.itemRefs,
      context,
    },
    schema: generatedSectionSchema,
    userId,
    timeoutMs: 120_000,
  });
  return result;
}

// Generates (or regenerates) sections: deterministic baseline first, then AI personalization per section.
export async function generateTechnicalSections({
  codes = null,
  instructions = "",
  userId,
  useAi = true,
  ...input
}) {
  const baseline = buildDeterministicSections(input);
  const targets = baseline.filter((section) => !codes || codes.includes(section.code));
  const context = buildSectionContext(input);
  const warnings = [];
  let aiFailures = 0;

  const tasks = targets.map((draft) => async () => {
    if (!useAi) return draft;
    try {
      const result = await personalizeSection({ draft, context, userId, instructions });
      const blocks = result.blocks.filter(
        (block) => block.text || block.items.length || block.table?.rows?.length,
      );
      if (!blocks.length) {
        warnings.push(`La IA no devolvio contenido para "${draft.title}"; se conservo el borrador base.`);
        return draft;
      }
      for (const warning of result.warnings) warnings.push(`${draft.title}: ${warning}`);
      // The model sometimes cites a playbook or module code; only quoted product codes are valid references.
      const quotedCodes = new Set((input.quotationItems || []).map((item) => item.productCode));
      const validRefs = result.itemRefs.filter((ref) => quotedCodes.has(ref));
      return {
        ...draft,
        blocks,
        itemRefs: draft.code === "proposed_solution" && !validRefs.length ? draft.itemRefs : validRefs,
        sources: result.sources.length ? result.sources : draft.sources,
      };
    } catch (error) {
      aiFailures += 1;
      const message =
        error?.code === "ai_generation_disabled"
          ? "la generacion asistida no esta disponible"
          : error?.message || "error";
      warnings.push(`No fue posible personalizar "${draft.title}" con IA (${message}); se conservo el borrador base.`);
      return draft;
    }
  });

  const sections = await runWithConcurrency(tasks, SECTION_CONCURRENCY);
  return { sections, warnings, aiFailures, usedAi: useAi && aiFailures < targets.length };
}
