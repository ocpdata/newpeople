import { describe, expect, it } from "vitest";
import {
  anchorsMatchText, buildCitationAnchors, splitSentences, valueVariants,
} from "../src/commercial-intelligence/dossier/citation-anchors.js";

const answerText = [
  "La oportunidad **Seguridad de Correo Electrónico ya está creada** y está en **Contacto Inicial / En proceso**. Lo prioritario es confirmar la necesidad: la pregunta obligatoria de esta etapa todavía está sin responder.",
  "",
  "Para avanzar:",
  "",
  "1. **Coordina una conversación con Gustavo Salmerón**, contacto asociado y Gerente de Sistemas. Confirma qué problema de correo quieren resolver.",
  "2. **Valida importe y calendario con el cliente:** constan USD 10,000 y cierre el 23 de diciembre de 2026, pero no hay reuniones.",
  "| Campo | Valor |",
  "3. Documenta el siguiente paso con fecha y responsable.",
].join("\n");

const claims = [
  { text: "La oportunidad Seguridad de Correo Electrónico está en etapa Contacto Inicial y estado En proceso", kind: "registered",
    evidenceIds: ["opp138"], values: [{ type: "status", value: "Contacto Inicial" }] },
  { text: "La pregunta obligatoria de la etapa actual no tiene respuesta", kind: "registered", evidenceIds: ["req138.1"], values: [] },
  { text: "Gustavo Salmerón es Gerente de Sistemas y contacto asociado", kind: "registered", evidenceIds: ["contact190"],
    values: [{ type: "person", value: "Gustavo Salmerón" }] },
  { text: "El importe es USD 10,000 y el cierre es el 2026-12-23", kind: "registered", evidenceIds: ["opp138"],
    values: [{ type: "amount", value: "10000" }, { type: "date", value: "2026-12-23" }] },
  { text: "Existe una cotización aceptada por el cliente", kind: "registered", evidenceIds: ["qv139"], values: [] },
  { text: "Se recomienda documentar", kind: "recommendation", evidenceIds: [], values: [] },
];
const cited = ["opp138", "req138.1", "contact190", "qv139"];
const anchorOf = (anchors, fragment) => anchors.find((anchor) => answerText.slice(anchor.start, anchor.end).includes(fragment));

describe("marcadores de citas por oración", () => {
  it("separa oraciones con su posición y omite tablas y encabezados", () => {
    const sentences = splitSentences(answerText);
    for (const sentence of sentences) expect(answerText.slice(sentence.start, sentence.end)).toBe(sentence.text);
    expect(sentences.map((sentence) => sentence.text.slice(0, 25))).toEqual([
      "La oportunidad **Segurida", "Lo prioritario es confirm", "Para avanzar:", "**Coordina una conversaci",
      "Confirma qué problema de ", "**Valida importe y calend", "Documenta el siguiente pa",
    ]);
    expect(sentences.some((sentence) => sentence.text.startsWith("|"))).toBe(false);
  });

  it("enlaza cada oración con los registros de la afirmación que mejor la respalda", () => {
    const anchors = buildCitationAnchors({ answerText, blocks: [{ claims }], citedEvidenceIds: cited });
    expect(anchorOf(anchors, "Seguridad de Correo Electrónico ya está creada").citations).toEqual([1]);
    expect(anchorOf(anchors, "la pregunta obligatoria").citations).toEqual([2]);
    expect(anchorOf(anchors, "Gustavo Salmerón").citations).toEqual([3]);
    expect(anchorOf(anchors, "constan USD 10,000").citations).toEqual([1]);
  });

  it("no marca oraciones sin una afirmación clara ni afirmaciones sin registros", () => {
    const anchors = buildCitationAnchors({ answerText, blocks: [{ claims }], citedEvidenceIds: cited });
    expect(anchorOf(anchors, "Documenta el siguiente paso")).toBeUndefined();
    expect(anchors.some((anchor) => anchor.citations.includes(4))).toBe(false);
    expect(buildCitationAnchors({ answerText, blocks: [{ claims: [claims[5]] }], citedEvidenceIds: cited })).toEqual([]);
  });

  it("ignora registros que no están en la lista mostrada y devuelve vacío sin datos", () => {
    expect(buildCitationAnchors({ answerText, blocks: [{ claims: [claims[0]] }], citedEvidenceIds: ["otro"] })).toEqual([]);
    expect(buildCitationAnchors({ answerText: "", blocks: [{ claims }], citedEvidenceIds: cited })).toEqual([]);
    expect(buildCitationAnchors({ answerText, blocks: [], citedEvidenceIds: cited })).toEqual([]);
  });

  it("reúne los registros de varias afirmaciones en la misma oración, ordenados y con tope", () => {
    const many = ["a", "b", "c", "d", "e", "f"].map((id) => ({ text: "La oportunidad Seguridad de Correo Electrónico está creada", kind: "registered", evidenceIds: [id], values: [] }));
    const anchors = buildCitationAnchors({ answerText, blocks: [{ claims: many }], citedEvidenceIds: ["f", "e", "d", "c", "b", "a"] });
    expect(anchors).toHaveLength(1);
    expect(anchors[0].citations).toEqual([1, 2, 3, 4]);
  });

  it("reconoce importes y fechas en distintos formatos", () => {
    expect(valueVariants({ type: "amount", value: "10000" })).toEqual(expect.arrayContaining(["10,000", "10.000", "10000"]));
    expect(valueVariants({ type: "amount", value: "2500.50" })).toEqual(expect.arrayContaining(["2,500", "2500"]));
    expect(valueVariants({ type: "date", value: "2026-12-03" })).toEqual(expect.arrayContaining(["3 de diciembre de 2026", "03/12/2026"]));
    expect(valueVariants({ type: "person", value: "Gustavo Salmerón" })).toEqual(["gustavo salmeron"]);
    expect(valueVariants({ type: "count", value: "" })).toEqual([]);
  });

  it("descarta marcadores cuando el texto ya no es el mismo", () => {
    const anchors = buildCitationAnchors({ answerText, blocks: [{ claims }], citedEvidenceIds: cited });
    expect(anchorsMatchText(answerText, anchors)).toHaveLength(anchors.length);
    expect(anchorsMatchText(`${answerText}\n\nOtra parte`, anchors)).toHaveLength(anchors.length);
    expect(anchorsMatchText(`Nuevo encabezado\n${answerText}`, anchors)).toEqual([]);
    expect(anchorsMatchText(answerText.slice(0, 40), anchors)).toEqual([]);
    expect(anchorsMatchText(answerText, null)).toEqual([]);
    expect(anchorsMatchText(answerText, [{ start: "x", end: 3, quote: "a" }, { start: 5, end: 3, quote: "a" }])).toEqual([]);
  });
});
