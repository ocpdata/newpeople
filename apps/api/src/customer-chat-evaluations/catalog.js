import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { businessImpactForCase, operationBusinessImpacts } from "./business-impact.js";
import { listCustomEvaluationCases } from "./custom-cases.js";

export const SMOKE_CASE_IDS = ["Q01-01", "Q03-01", "Q05-01", "C01-01", "A08-04", "A09-01", "A10-01",
  "Q09-04", "SEQ12", "L09"];

const libraryCases = new Set(["Q09-04", "Q09-05", "Q09-07", "MIX09", "SEQ11", "SEQ13", "SEQ15"]);
const technicalCases = new Set(["K13", "K14", "K15", "K16", "K17", "K18"]);
const regressionCases = new Set(["Q09-04", "Q09-05", "Q09-06", "Q09-07",
  "Q12-04", "Q12-05", "Q12-06", "L09", "L10", "MIX09",
  "SEQ11", "SEQ12", "SEQ13", "SEQ14", "SEQ15"]);

const sourceUrl = new URL("../../../../readme/preguntas-validacion-chat-cliente-existente.md", import.meta.url);
export const CATEGORIES = [
  ...Array.from({ length: 12 }, (_, i) => `Q${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 8 }, (_, i) => `G${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 9 }, (_, i) => `C${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 6 }, (_, i) => `R${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 11 }, (_, i) => `A${String(i + 1).padStart(2, "0")}`),
];

export function parseCatalog(markdown) {
  const cases = [];
  let sequence = null;
  const material = markdown.split("\n").filter((line) => line.startsWith("> ")).map((line) => line.slice(2)).join("\n");
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^### (SEQ\d+)\.\s*(.*)/);
    if (heading) {
      sequence = { id: heading[1], category: "SEQ", title: heading[2], steps: [], accountId: 22 };
      cases.push(sequence);
      continue;
    }
    if (/^## /.test(line)) sequence = null;
    const step = sequence && line.match(/^\d+\.\s*(.*)/);
    if (step) {
      const quoted = step[1].match(/«([^»]+)»/);
      const reference = step[1].match(/\b([QGCRA]\d{2}-\d{2})\b/);
      const requiresCompleteActivityDraft = /^Si qued[oó] un borrador completo:/i.test(step[1]);
      if (quoted) sequence.steps.push({
        question: quoted[1], expected: "",
        ...(requiresCompleteActivityDraft ? { requiresCompleteActivityDraft: true } : {}),
      });
      else if (reference) sequence.steps.push({ reference: reference[1], expected: "" });
      else sequence.blockedReason = "La secuencia requiere interacción de interfaz o preparación condicional descrita en el documento.";
      if (/^Si /.test(step[1]) && !requiresCompleteActivityDraft) sequence.blockedReason = "La secuencia requiere comprobar y completar un borrador antes de elegir su continuación.";
      continue;
    }
    if (sequence && /^\s+Esperado:/.test(line) && sequence.steps.length) {
      sequence.steps.at(-1).expected += line.trim().replace(/^Esperado:\s*/, "");
      continue;
    }
    if (sequence && /^\s+\S/.test(line) && sequence.steps.length) {
      sequence.steps.at(-1).expected += ` ${line.trim()}`;
      continue;
    }
    if (!line.startsWith("|")) continue;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((cell) => cell.trim());
    if (!/^(?:[QGCRA]\d{2}-\d{2}|K\d{2}|MIX\d{2}|L\d{2})$/.test(cells[0])) continue;
    const question = cells[1]?.match(/«([^»]+)»/);
    const category = cells[0].match(/^([QGCRA]\d{2})/)?.[1] || cells[0].replace(/\d+/g, "");
    const item = {
      id: cells[0], category, title: cells[1], accountId: /Con E seleccionada/i.test(cells[1]) ? 65 : 22,
      steps: question ? [{ question: question[1], expected: cells.slice(2).join(" | ") }] : [],
      blockedReason: !question ? "Requiere preparación o intervención explícita descrita en el catálogo; no es una pregunta autónoma." : null,
    };
    const antecedent = cells[1].match(/^([QGCRA]\d{2}-\d{2}), luego/);
    if (antecedent) item.steps.unshift({ reference: antecedent[1], expected: "" });
    if (/\bM\b/.test(cells[1])) {
      if (material && question) item.steps[0].question = `${material}\n\n${question[1]}`;
      else item.blockedReason = "Requiere material de referencia M.";
    }
    if (category === "K" && /controlad|provocar|permisos válidos/i.test(cells[1])) {
      item.blockedReason = "Control requiere preparación de permisos o inyección de fallos; no se provocan cambios globales en la instancia compartida.";
    }
    cases.push(item);
    const alternatives = [...cells[1].matchAll(/«([^»]+)»/g)].map((match) => match[1]);
    if (alternatives.length > 1) {
      for (let index = 1; index < alternatives.length; index += 1) {
        cases.push({ ...item, id: `${item.id}.v${index + 1}`, sourceId: item.id,
          steps: [{ question: alternatives[index], expected: cells.slice(2).join(" | ") }] });
      }
    }
  }
  for (const item of cases) {
    item.steps = item.steps.flatMap((step) => {
      if (!step.reference) return [step];
      const source = cases.find((candidate) => candidate.id === step.reference);
      if (!source?.steps.length) {
        item.blockedReason = `No se encontró el antecedente ${step.reference}.`; return [];
      }
      return source.steps.map((sourceStep) => ({ ...sourceStep, expected: step.expected || sourceStep.expected }));
    });
    if (!item.steps.length) item.blockedReason ||= "La entrada no tiene mensajes ejecutables.";
    if (item.category === "SEQ" && /cambi[ao].*cuenta|selecciona.*cuenta/i.test(item.steps.map((s) => s.question).join(" "))) {
      item.blockedReason = "La secuencia requiere cambio de contexto de cuenta; ejecutar sus pasos con revisión de contexto en navegador.";
    }
    item.requiresHumanReview = true;
    if (libraryCases.has(item.id)) item.requiresBluecatLibrary = true;
    if (regressionCases.has(item.id)) item.readOnlyRegression = true;
    if (technicalCases.has(item.id)) {
      item.blockedReason = "Regresión técnica: requiere preparación controlada o interacción de navegador; no se ejecuta como una pregunta comercial ni se cuenta como aprobada.";
    }
    item.mode = "proposal_only";
    item.businessImpact = businessImpactForCase(item.id);
  }
  const ids = cases.map((item) => item.id);
  if (new Set(ids).size !== ids.length || !CATEGORIES.every((category) => cases.some((item) => item.category === category))) {
    throw new Error("El catálogo de evaluación contiene IDs duplicados o categorías sin casos.");
  }
  return { version: createHash("sha256").update(markdown).digest("hex").slice(0, 16), categories: CATEGORIES,
    smokeCaseIds: SMOKE_CASE_IDS, operationBusinessImpacts, cases };
}

export async function getEvaluationCatalog() {
  const catalog = parseCatalog(await readFile(sourceUrl, "utf8"));
  const custom = await listCustomEvaluationCases();
  if (!custom.length) return catalog;
  // Custom cases change what a run covers, so they are part of the catalog version.
  const version = createHash("sha256")
    .update(`${catalog.version}|${custom.map((item) => `${item.id}:${item.updatedAt}`).join(",")}`)
    .digest("hex").slice(0, 16);
  return { ...catalog, version, cases: [...catalog.cases, ...custom] };
}
