import { normalizeSearchText } from "./playbooks.js";
import { isEmptyAnswerValue } from "./profile.js";

const INTERNAL_TERMS =
  /\b(margen (de )?(utilidad|ganancia|comercial|bruto|neto)|margen del? \d+ ?%|markup|mark-up|costo unitario|precio de costo|costo de importacion|utilidad (bruta|neta|del proyecto)|descuento del fabricante|precio de lista)\b/i;

const REQUIRED_SECTIONS = [
  "proposed_solution",
  "scope_included",
  "scope_excluded",
  "assumptions",
];

function sectionText(section) {
  return (section.blocks || [])
    .flatMap((block) => [
      block.text,
      ...(block.items || []),
      ...(block.table?.rows || []).flat(),
    ])
    .filter(Boolean)
    .join(" ");
}

function sectionHasContent(section) {
  return Boolean(section) && sectionText(section).trim().length > 0;
}

function compareValues(operator, actual, expected) {
  if (operator === "truthy") {
    if (isEmptyAnswerValue(actual)) return false;
    if (actual === false || actual === 0) return false;
    return true;
  }
  if (isEmptyAnswerValue(actual)) return false;
  const left = Array.isArray(actual) ? actual : [actual];
  switch (operator) {
    case "eq":
      return left.some(
        (entry) =>
          normalizeSearchText(entry) === normalizeSearchText(expected),
      );
    case "neq":
      return !left.some(
        (entry) =>
          normalizeSearchText(entry) === normalizeSearchText(expected),
      );
    case "contains":
      return left.some((entry) =>
        normalizeSearchText(entry).includes(normalizeSearchText(expected)),
      );
    case "gt":
      return Number(actual) > Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    default:
      return false;
  }
}

export function evaluateCondition(condition, answerValues) {
  if (!condition) return false;
  return compareValues(
    condition.op,
    answerValues.get(condition.question),
    condition.value,
  );
}

function matchesAnyItem(pattern, itemTexts) {
  let regex;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    return false;
  }
  return itemTexts.some((text) => regex.test(text));
}

// Deterministic checks of a technical scope against the quotation, the questionnaire and the playbook rules.
export function verifyTechnicalScope({
  sections,
  topology,
  snapshot,
  selections,
  playbooks,
  quotationItems,
}) {
  const findings = [];
  const add = (code, severity, message, ref = "") =>
    findings.push({ code, severity, message, ref });

  const items = (Array.isArray(quotationItems) ? quotationItems : []).filter(
    (item) => item.productCode,
  );
  const itemCodes = new Set(items.map((item) => item.productCode));
  const itemTexts = items.map((item) =>
    normalizeSearchText(
      `${item.productCode} ${item.productDescription || ""} ${item.groupTitle || ""}`,
    ),
  );

  const sectionByCode = new Map(
    (Array.isArray(sections) ? sections : []).map((section) => [
      section.code,
      section,
    ]),
  );

  for (const code of REQUIRED_SECTIONS) {
    if (!sectionHasContent(sectionByCode.get(code))) {
      add(
        "section_missing",
        "blocking",
        `La seccion "${code}" esta vacia o no existe.`,
        code,
      );
    }
  }

  // Without a quotation there is nothing to check the references against.
  const hasQuotation = items.length > 0;
  const referenced = new Set();
  for (const section of sectionByCode.values()) {
    for (const ref of section.itemRefs || []) {
      referenced.add(ref);
      if (hasQuotation && !itemCodes.has(ref)) {
        add(
          "unknown_item_ref",
          "blocking",
          `La seccion "${section.title}" referencia el producto "${ref}", que no esta en la cotizacion.`,
          section.code,
        );
      }
    }
  }
  for (const item of items) {
    if (!referenced.has(item.productCode)) {
      add(
        "item_not_covered",
        "warning",
        `La partida cotizada "${item.productCode}" no aparece en el alcance.`,
        item.productCode,
      );
    }
  }

  for (const section of sectionByCode.values()) {
    if (INTERNAL_TERMS.test(normalizeSearchText(sectionText(section)))) {
      add(
        "internal_information",
        "blocking",
        `La seccion "${section.title}" parece incluir informacion comercial interna (margenes, costos o descuentos).`,
        section.code,
      );
    }
    if (
      !section.edited &&
      sectionHasContent(section) &&
      !(section.sources || []).length
    ) {
      add(
        "section_without_sources",
        "warning",
        `La seccion "${section.title}" no cita fuentes.`,
        section.code,
      );
    }
  }

  const answers = Array.isArray(snapshot?.answers) ? snapshot.answers : [];
  for (const selection of Array.isArray(selections) ? selections : []) {
    const playbook = (playbooks || []).find((entry) => entry.code === selection.code);
    if (!playbook) continue;
    const answerValues = new Map(
      answers
        .filter((answer) => answer.playbookCode === selection.code)
        .map((answer) => [answer.questionCode, answer.value]),
    );

    for (const rule of playbook.content?.expectations || []) {
      if (
        evaluateCondition(rule.when, answerValues) &&
        !matchesAnyItem(rule.expectProduct, itemTexts)
      ) {
        add(rule.code, rule.severity, rule.message, selection.code);
      }
    }
    for (const rule of playbook.content?.dependencies || []) {
      if (
        matchesAnyItem(rule.ifProduct, itemTexts) &&
        !matchesAnyItem(rule.requireProduct, itemTexts) &&
        !(rule.unless && evaluateCondition(rule.unless, answerValues))
      ) {
        add(rule.code, rule.severity, rule.message, selection.code);
      }
    }
  }

  for (const entry of Array.isArray(snapshot?.missing) ? snapshot.missing : []) {
    if (entry.required) {
      add(
        "required_answer_missing",
        "warning",
        `Dato obligatorio sin respuesta (se tratara como supuesto): ${entry.prompt}`,
        `${entry.playbookCode}:${entry.questionCode}`,
      );
    }
  }

  for (const node of topology?.nodes || []) {
    if (hasQuotation && node.itemRef && !itemCodes.has(node.itemRef)) {
      add(
        "topology_unknown_item",
        "warning",
        `El componente "${node.label}" de la topologia referencia un producto que no esta en la cotizacion.`,
        node.id,
      );
    }
  }
  if (!topology?.nodes?.length) {
    add("topology_missing", "warning", "El alcance no incluye topologia.", "");
  }

  return {
    findings,
    blocking: findings.filter((finding) => finding.severity === "blocking").length,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
  };
}
