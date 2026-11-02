import { describe, expect, it } from "vitest";
import { indexCoachEvidence } from "../src/coach/evidence-index.js";
import {
  factsFromClaims,
  parseClaims,
  unknownNames,
  verifySynthesis,
} from "../src/coach/claim-verifier.js";

const evidence = () => [
  {
    toolName: "getOpportunity",
    readOnly: true,
    result: {
      id: 121,
      name: "Proteccion de Documentos Sealpath",
      accountName: "Grupo Diestra",
      amountUsd: 8000,
      stageName: "Waiting",
      closeDate: new Date(2026, 9, 31),
    },
  },
  {
    toolName: "searchOpportunities",
    readOnly: true,
    resultCount: 2,
    totalAmountUsd: 38000,
    result: [
      { id: 117, name: "Propuesta de Seguridad Correo 2500 Correos", accountName: "Grupo Diestra", amountUsd: 30000, stageName: "Identificación" },
      { id: 121, name: "Proteccion de Documentos Sealpath", accountName: "Grupo Diestra", amountUsd: 8000, stageName: "Waiting" },
    ],
  },
  { toolName: "getSellerPerformance", readOnly: true, result: { quota: { amountUsd: 500000 }, coverage: { pct: 29.6 } } },
  { toolName: "getSellerAgenda", readOnly: true, result: null, error: "No fue posible recuperar la fuente autorizada" },
];

const detailAnswer =
  "La oportunidad Proteccion de Documentos Sealpath de Grupo Diestra está en etapa Waiting, con un importe de 8,000 USD y cierre el 31 de octubre de 2026.";
const detailClaims = [
  { text: "La oportunidad Proteccion de Documentos Sealpath está en etapa Waiting", kind: "registered", evidenceIds: ["e1"], values: [{ type: "text", value: "Waiting" }] },
  { text: "Importe de 8,000 USD", kind: "registered", evidenceIds: ["e1"], values: [{ type: "amount", value: "8000" }] },
  { text: "Cierre el 31 de octubre de 2026", kind: "registered", evidenceIds: ["e1"], values: [{ type: "date", value: "2026-10-31" }] },
];
const verify = (overrides = {}) => {
  const index = indexCoachEvidence(evidence());
  return verifySynthesis({
    answer: detailAnswer,
    rawClaims: detailClaims,
    index,
    question: "Dame el detalle de la oportunidad Proteccion de Documentos Sealpath de Grupo Diestra",
    ...overrides,
  });
};

describe("índice de evidencia de Coach", () => {
  it("asigna IDs a cada lectura y a cada registro de una lista, sin tocar lo que falló", () => {
    const { indexed, entries } = indexCoachEvidence(evidence());
    expect(indexed[0].evidenceId).toBe("e1");
    expect(indexed[1].evidenceId).toBe("e2");
    expect(indexed[1].result.map((record) => record.evidenceId)).toEqual(["e2.1", "e2.2"]);
    expect(indexed[2].evidenceId).toBe("e3");
    expect(indexed[3]).not.toHaveProperty("evidenceId");
    expect([...entries.keys()]).toEqual(["e1", "e2", "e2.1", "e2.2", "e3"]);
    expect(entries.get("e2.1")).toMatchObject({ recordId: 117, sourceType: "opportunity", label: "Propuesta de Seguridad Correo 2500 Correos" });
    expect(entries.get("e1")).toMatchObject({ label: "Oportunidad", recordId: null });
  });

  it("no modifica la evidencia original", () => {
    const original = evidence();
    indexCoachEvidence(original);
    expect(original[0]).not.toHaveProperty("evidenceId");
    expect(original[1].result[0]).not.toHaveProperty("evidenceId");
  });
});

describe("verificación de afirmaciones en código", () => {
  it("acepta una respuesta cuyos datos están todos respaldados por afirmaciones verificadas", () => {
    const result = verify();
    expect(result.reasons).toEqual([]);
    expect(result.accepted).toBe(true);
    expect(result.stats).toEqual({ claims: 3, verified: 3, rejected: 0 });
    expect(result.citations).toEqual([
      expect.objectContaining({ evidenceId: "e1", sourceType: "opportunity", label: "Oportunidad" }),
    ]);
    expect(result.citationAnchors.length).toBeGreaterThan(0);
    expect(result.citationAnchors.every((anchor) => anchor.citations.includes(1))).toBe(true);
    expect(result.facts).toHaveLength(3);
  });

  it("rechaza una afirmación que cita evidencia inexistente o sin evidencia", () => {
    const result = verify({
      rawClaims: [
        { text: "Importe de 8,000 USD", kind: "registered", evidenceIds: ["e9"], values: [] },
        { text: "La oportunidad está en etapa Waiting", kind: "registered", evidenceIds: [], values: [] },
      ],
    });
    expect(result.accepted).toBe(false);
    expect(result.rejected.map((claim) => claim.reasons[0])).toEqual(["unknown_evidence:e9", "registered_without_evidence"]);
    expect(result.reasons).toContain("rejected_claims");
  });

  it("rechaza un valor declarado que no consta en la evidencia citada", () => {
    const result = verify({
      rawClaims: [{ text: "Importe de 9,500 USD", kind: "registered", evidenceIds: ["e1"], values: [{ type: "amount", value: "9500" }] }],
    });
    expect(result.rejected[0].reasons).toContain("value_not_in_evidence:amount:9500");
    expect(result.accepted).toBe(false);
  });

  it("no acepta cifras de la respuesta que no constan en la evidencia citada", () => {
    const result = verify({ answer: `${detailAnswer} Además suma 45,500 USD en otras oportunidades.` });
    expect(result.answerValues.ungrounded).toEqual([{ kind: "number", text: "45,500" }]);
    expect(result.reasons).toContain("values_not_in_cited_evidence");
    expect(result.accepted).toBe(false);
  });

  it("no acepta nombres de registros que no existen en la evidencia", () => {
    const result = verify({ answer: `${detailAnswer} También conviene hablar con Grupo Imaginario.` });
    expect(result.unknownNames).toEqual(["Grupo Imaginario"]);
    expect(result.reasons).toContain("unknown_names");
    expect(result.accepted).toBe(false);
  });

  it("reconoce como conocida una frase que une el nombre de una oportunidad y el de su cuenta", () => {
    expect(unknownNames({ answer: "Revisa Proteccion de Documentos Sealpath de Grupo Diestra.", haystack: "proteccion de documentos sealpath grupo diestra" })).toEqual([]);
    expect(unknownNames({ answer: "Revisa «Proyecto Fantasma».", haystack: "grupo diestra" })).toEqual(["Proyecto Fantasma"]);
    expect(unknownNames({ answer: "Abre Mi Coach y Ritmo Comercial.", haystack: "" })).toEqual([]);
  });

  it("no acepta una oración sobre un registro que ninguna afirmación respalda", () => {
    const result = verify({ answer: `${detailAnswer} La oportunidad Proteccion de Documentos Sealpath tiene riesgo bajo.` });
    expect(result.uncovered).toEqual(["La oportunidad Proteccion de Documentos Sealpath tiene riesgo bajo."]);
    expect(result.reasons).toContain("uncovered_sentences");
    expect(result.accepted).toBe(false);
  });

  it("sin afirmaciones no hay aceptación determinista", () => {
    const result = verify({ rawClaims: [] });
    expect(result.reasons).toContain("no_claims");
    expect(result.accepted).toBe(false);
  });

  it("acepta una respuesta de orientación sin datos del CRM", () => {
    const result = verify({
      answer: "Define con el cliente un siguiente paso concreto y registra la fecha.",
      rawClaims: [{ text: "Definir un siguiente paso concreto", kind: "recommendation", evidenceIds: [], values: [] }],
    });
    expect(result.accepted).toBe(true);
    expect(result.citations).toEqual([]);
  });

  it("verifica las cifras de una afirmación contra lo que cita, no contra toda la evidencia", () => {
    const result = verify({
      rawClaims: [{ text: "Cuota de 500,000 USD", kind: "registered", evidenceIds: ["e1"], values: [{ type: "amount", value: "500000" }] }],
    });
    expect(result.rejected[0].reasons.join(" ")).toContain("value_not_in_evidence:amount:500000");
  });

  it("acepta porcentajes, redondeos y millones al verificar valores", () => {
    const index = indexCoachEvidence(evidence());
    const result = verifySynthesis({
      answer: "La cobertura es de 29.6% y la cuota es de aproximadamente 0.5 millones.",
      rawClaims: [
        { text: "La cobertura es de 29.6%", kind: "registered", evidenceIds: ["e3"], values: [{ type: "percent", value: "29.6%" }] },
        { text: "La cuota es de aproximadamente 0.5 millones", kind: "registered", evidenceIds: ["e3"], values: [{ type: "amount", value: "0.5 millones" }] },
      ],
      index,
    });
    expect(result.rejected).toEqual([]);
    expect(result.accepted).toBe(true);
  });
});

describe("afirmaciones del modelo", () => {
  it("normaliza tipos, recorta y descarta lo vacío", () => {
    const claims = parseClaims([
      { text: "  Dato   con   espacios ", kind: "raro", evidenceIds: ["e1", "e1", " e2 "], values: [{ type: "otro", value: " 5 " }, { value: "" }, null] },
      { text: "", kind: "registered" },
      { text: "Sin ids", kind: "registered", evidenceIds: [] },
      { text: "x".repeat(900), evidenceIds: [] },
      "no es objeto",
    ]);
    expect(claims[0]).toEqual({ text: "Dato con espacios", kind: "registered", evidenceIds: ["e1", "e2"], values: [{ type: "text", value: "5", evidenceId: null }] });
    expect(claims[1]).toMatchObject({ text: "Sin ids", kind: "registered", evidenceIds: [] });
    expect(claims[2].kind).toBe("inference");
    expect(claims[2].text).toHaveLength(320);
    expect(claims).toHaveLength(3);
    expect(parseClaims(null)).toEqual([]);
  });

  it("construye los hechos solo con afirmaciones registradas y verificadas, sin repetir", () => {
    const index = indexCoachEvidence(evidence());
    const facts = factsFromClaims(
      [
        { text: "A", kind: "registered", status: "verified", evidenceIds: ["e2.1"] },
        { text: "A", kind: "registered", status: "verified", evidenceIds: ["e2.1"] },
        { text: "B", kind: "registered", status: "rejected", evidenceIds: ["e2.1"] },
        { text: "C", kind: "inference", status: "verified", evidenceIds: ["e2.1"] },
        { text: "D", kind: "registered", status: "verified", evidenceIds: ["e9"] },
      ],
      index.entries,
    );
    expect(facts).toEqual([
      { sourceType: "opportunity", sourceId: 117, label: "Propuesta de Seguridad Correo 2500 Correos", excerpt: "A" },
    ]);
  });
});
