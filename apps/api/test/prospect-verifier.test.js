import { describe, expect, it, vi } from "vitest";
import {
  UNSUPPORTED_DATA_NOTE,
  prospectVerificationEnabled,
  removeUnsupportedData,
  verifyAndRepairAnswer,
  verifyProspectAnswer,
} from "../src/prospect-research/prospect-verifier.js";
import { prospectBank } from "../src/channel-quality/live/prospect-live.js";

const rich = prospectBank.sessions.rica;
const snapshot = {
  profile: rich.result.profile,
  outreach: rich.result.outreach,
  findings: rich.findings,
  contacts: rich.contacts,
  hypotheses: rich.hypotheses,
  externalResearch: rich.result.externalResearch,
};
const verify = (answer, extra = {}) => verifyProspectAnswer({ answer, snapshot, question: "¿Por dónde empiezo?", ...extra });

describe("verificación de datos de la respuesta contra la sesión", () => {
  it("acepta datos que están en la sesión: personas, fechas, cifras y encabezados", () => {
    const answer = [
      "**Primer contacto:** Carlos Treviño, Gerente de TI de Aceros del Norte.",
      "Anunciaron una inversión de 40 millones de dólares para la nueva planta en Santa Catarina (15 de septiembre de 2026).",
      "**Preguntas de Descubrimiento**",
      "Falta el correo electrónico de la persona.",
    ].join("\n");
    expect(verify(answer).issues).toEqual([]);
  });

  it("detecta correos, enlaces, cifras, fechas y personas que no están en la sesión", () => {
    const issues = verify([
      "Escríbele a roberto.sanchez@acerosdelnorte.example sobre https://invento.example/noticia.",
      "La empresa factura 250 millones de dólares y anunció una alianza el 3 de marzo de 2026.",
      "Habla con Roberto Sánchez, el nuevo director.",
    ].join("\n")).issues;
    const kinds = issues.map((issue) => issue.kind);
    expect(kinds).toEqual(expect.arrayContaining(["email", "link", "number", "date", "name"]));
    expect(issues.find((issue) => issue.kind === "name").text).toContain("Roberto");
  });

  it("acepta los enlaces y correos de la sesión y lo que el vendedor escribió", () => {
    const withEmail = { ...snapshot, contacts: [{ ...rich.contacts[0], email: "laura@aceros.example" }] };
    const result = verifyProspectAnswer({
      answer: "Escríbele a laura@aceros.example; fuente: https://ejemplo.test/noticias/aceros-del-norte-nueva-planta. Mencionaste 90 días.",
      snapshot: withEmail, question: "Tengo 90 días para cerrar",
    });
    expect(result.issues).toEqual([]);
  });

  it("no une palabras de líneas vecinas, encabezados ni paréntesis en un nombre falso", () => {
    const answer = [
      "**Preguntas de descubrimiento:**",
      "1. ¿Qué áreas impulsan estas iniciativas? (Relacionado con la hipótesis de nube)",
      "**Cierre:**",
      "Proponer un seguimiento con Carlos Treviño.",
      "- Valida la hipótesis 1 con el Gerente de TI",
      "Fuente: «Modernización de TI en Aceros del Norte»",
    ].join("\n");
    expect(verify(answer).issues).toEqual([]);
  });

  it("acepta los nombres de la sesión aunque estén en negritas o en una lista", () => {
    expect(verify("- **Laura Medina**, Directora de Operaciones\n- **Carlos Treviño**, Gerente de TI").issues).toEqual([]);
  });

  it("detecta una persona inventada incluso dentro de negritas", () => {
    const issues = verify("**Roberto Sánchez** puede validar la conectividad.").issues;
    expect(issues).toEqual([{ kind: "name", text: expect.stringContaining("Roberto") }]);
  });

  it("no detecta datos en una respuesta en otro idioma salvo correos, enlaces y cifras", () => {
    const english = "Dear Laura, Technology Priorities at Aceros del Norte caught our eye: a 900 million investment. Write me at nobody@invent.example.";
    const kinds = verify(english).issues.map((issue) => issue.kind);
    expect(kinds).not.toContain("name");
    expect(kinds).toEqual(expect.arrayContaining(["email", "number"]));
  });
});

describe("retirar los datos sin respaldo", () => {
  it("quita solo las oraciones con el dato y conserva el resto", () => {
    const answer = "Empieza por Carlos Treviño. Factura 250 millones de dólares al año. Pregúntale por la nube híbrida.";
    expect(removeUnsupportedData(answer, [{ kind: "number", text: "250 millones" }]))
      .toBe("Empieza por Carlos Treviño. Pregúntale por la nube híbrida.");
  });
});

describe("verificación y reparación", () => {
  const base = { answer: "Contacta a Carlos Treviño por la nueva planta.", inferences: [], evidence: [] };
  const dirty = { ...base, answer: "Contacta a Carlos Treviño. Escríbele a carlos@invento.example para hablar de la nueva planta." };

  it("deja pasar una respuesta limpia sin pedir una corrección", async () => {
    const repair = vi.fn();
    const { result, verification } = await verifyAndRepairAnswer({ result: base, snapshot, question: "x", history: [], repair, fallbackAnswer: "fb" });
    expect(result).toBe(base);
    expect(repair).not.toHaveBeenCalled();
    expect(verification).toMatchObject({ status: "clean", issueCount: 0 });
  });

  it("pide una corrección y usa la respuesta reparada", async () => {
    const repair = vi.fn().mockResolvedValue(base);
    const { result, verification } = await verifyAndRepairAnswer({ result: dirty, snapshot, question: "x", history: [], repair, fallbackAnswer: "fb" });
    expect(repair).toHaveBeenCalledWith({ previousAnswer: dirty.answer, issues: [expect.objectContaining({ kind: "email" })] });
    expect(result).toBe(base);
    expect(verification).toMatchObject({ status: "repaired", issueKinds: ["email"] });
  });

  it("si la corrección sigue con el dato, retira esas oraciones y lo avisa", async () => {
    const stubborn = { ...dirty, answer: `${dirty.answer} Además conviene validar la conectividad de la planta con el área de TI y su calendario.` };
    const repair = vi.fn().mockResolvedValue(stubborn);
    const { result, verification } = await verifyAndRepairAnswer({ result: dirty, snapshot, question: "x", history: [], repair, fallbackAnswer: "fb" });
    expect(result.answer).not.toContain("carlos@invento.example");
    expect(result.answer).toContain("Contacta a Carlos Treviño.");
    expect(result.answer).toContain(UNSUPPORTED_DATA_NOTE);
    expect(verification).toMatchObject({ status: "degraded", issueKinds: ["email"] });
  });

  it("usa la respuesta de respaldo cuando no queda nada útil o la corrección falla", async () => {
    const onlyBad = { ...base, answer: "Escríbele a carlos@invento.example." };
    const repair = vi.fn().mockRejectedValue(new Error("proveedor caído"));
    const { result, verification } = await verifyAndRepairAnswer({ result: onlyBad, snapshot, question: "x", history: [], repair, fallbackAnswer: "Respuesta de respaldo" });
    expect(result.answer).toBe("Respuesta de respaldo");
    expect(verification.status).toBe("degraded");
  });
});

describe("interruptor de la verificación", () => {
  it("está activa salvo que se apague explícitamente", () => {
    expect(prospectVerificationEnabled({})).toBe(true);
    expect(prospectVerificationEnabled({ PROSPECT_ANSWER_VERIFICATION: "false" })).toBe(false);
  });
});
