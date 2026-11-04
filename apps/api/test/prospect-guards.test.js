import { describe, expect, it } from "vitest";
import { buildGuardedProspectTurn, detectGuardedTurn } from "../src/prospect-research/prospect-guards.js";
import { normalizeProspectResponse } from "../src/prospect-research/prospect-chat-adapter.js";
import { prospectBank } from "../src/channel-quality/live/prospect-live.js";

const snapshotOf = (session) => ({
  profile: session.result?.profile || { companyName: session.companyName },
  outreach: session.result?.outreach || null,
  findings: session.findings,
  contacts: session.contacts,
  hypotheses: session.hypotheses,
  externalResearch: session.result?.externalResearch || null,
});
const rich = snapshotOf(prospectBank.sessions.rica);
const sparse = snapshotOf(prospectBank.sessions.escasa);
const oneHypothesis = { ...rich, hypotheses: [rich.hypotheses[0]] };
const detect = (question, snapshot = rich, history = []) => detectGuardedTurn({ question, snapshot, history });

describe("respuestas de Cuenta nueva sin modelo", () => {
  it("sesión vacía: dice qué falta en lugar de rellenar", () => {
    const findings = detect("¿Cuáles son los hallazgos de esta empresa?", sparse);
    expect(findings).toMatchObject({ kind: "empty_data" });
    expect(findings.answer).toContain("no contiene hallazgos");
    expect(findings.answer).toContain("Investigar fuentes públicas");
    expect(detect("¿Qué contactos potenciales hay?", sparse).answer).toContain("contactos potenciales");
    expect(detect("¿Qué hipótesis de oportunidad hay?", sparse).answer).toContain("hipótesis de oportunidad");
    expect(detect("¿Qué evidencia pública tienes?", sparse).answer).toContain("evidencia pública");
  });

  it("con datos, o si pide redactar algo, responde el modelo", () => {
    for (const question of [
      "Dame el perfil de la empresa.", "¿Cuáles son los hallazgos principales?", "¿Qué contactos hay?", "¿Qué hipótesis hay?",
      "¿Qué oportunidades de venta ven en esta empresa?", "Redacta un correo de primer contacto para Carlos Treviño.",
      "Escríbeme un mensaje corto de LinkedIn para Laura Medina.", "¿A quién contacto primero y por qué?",
    ]) expect(detect(question), question).toBeNull();
    expect(detect("Redacta un correo para el contacto de compras", sparse)).toBeNull();
    expect(detect("Redacta un correo de acercamiento", sparse)).toBeNull();
    expect(detect("Prepárame el acercamiento a esta empresa: a quién contacto y qué les digo.", sparse)).toBeNull();
    expect(detect("Prepárame la llamada de descubrimiento con el contacto de compras", sparse)).toBeNull();
    expect(detect("¿Qué objeciones me pueden poner y cómo las respondo?", sparse)).toBeNull();
  });

  it("fuera de alcance: no consulta el CRM y redirige a Cliente existente", () => {
    const result = detect("¿Qué oportunidades abiertas tiene Totalplay en el CRM?");
    expect(result.kind).toBe("out_of_scope");
    expect(result.answer).toContain("no consulta cuentas, oportunidades ni otros registros del CRM");
    expect(result.answer).toContain("Cliente existente");
    expect(detect("¿Qué contactos tiene la cuenta Telmex en el CRM?").kind).toBe("out_of_scope");
  });

  it("búsqueda en internet: aclara el límite y muestra la evidencia guardada con su fecha", () => {
    const result = detect("Busca en internet las últimas noticias de Aceros del Norte.");
    expect(result.kind).toBe("web_search");
    expect(result.answer).toContain("no realiza búsquedas nuevas");
    expect(result.answer).toContain("Inversión en nueva planta en Santa Catarina (2026-09-15)");
    expect(detect("Busca en internet noticias", sparse).answer).toContain("Todavía no hay evidencia guardada");
  });

  it("¿ya existe en el CRM?: no afirma ni niega, explica la revisión de duplicados", () => {
    const result = detect("Antes de convertirlo, ¿ya existe esta cuenta en el CRM?");
    expect(result.kind).toBe("existence_check");
    expect(result.answer).toContain("no puedo confirmar si Aceros del Norte ya existe");
    expect(result.answer).toContain("duplicadas");
  });

  it("conversiones: una propuesta confirmable, o la explicación de lo que falta", () => {
    expect(detect("Convierte este prospecto en cuenta del CRM.")).toMatchObject({ kind: "conversion", action: { target: "account" } });
    const contact = detect("Crea el contacto Laura Medina en el CRM.");
    expect(contact.action).toMatchObject({ target: "contact", title: "Crear el contacto Laura Medina en el CRM" });
    expect(contact.answer).toContain("no un contacto confirmado");
    const unknown = detect("Crea el contacto Roberto Zúñiga, el director de finanzas, en el CRM.");
    expect(unknown.action).toBeNull();
    expect(unknown.answer).toContain("No puedo proponer crear un contacto con datos que no están en la sesión");
    const ambiguous = detect("Pásalo a oportunidad.");
    expect(ambiguous.action).toBeNull();
    expect(ambiguous.answer).toContain("desde qué hipótesis");
    expect(ambiguous.answer).toContain("Conectividad y SD-WAN");
    expect(detect("Pásalo a oportunidad.", oneHypothesis).action).toMatchObject({ target: "opportunity" });
    const lead = detect("Registra este prospecto como lead.");
    expect(lead.action).toBeNull();
    expect(lead.answer).toContain("conversión a lead");
  });

  it("no toma por conversión lo que solo comparte palabras", () => {
    for (const question of [
      "Convierte este texto a inglés.", "Crea una cuenta de correo para el equipo.", "Crea un resumen de los contactos.",
      "Pasa los contactos a una tabla.", "Registra mis notas en un borrador.",
    ]) expect(detect(question)?.kind, question).not.toBe("conversion");
  });

  it("si el vendedor pidió otro idioma, deja que responda el modelo", () => {
    const history = [{ role: "user", text: "De ahora en adelante responde en inglés." }, { role: "assistant", text: "Understood." }];
    expect(detect("¿Cuáles son los hallazgos?", sparse, history)).toBeNull();
  });

  it("devuelve la forma de una respuesta del motor y marca la traza", () => {
    const turn = buildGuardedProspectTurn({
      question: "Convierte este prospecto en cuenta del CRM.", snapshot: rich, history: [], sessionId: 9001, normalizeResponse: normalizeProspectResponse,
    });
    expect(turn.response).toMatchObject({ source: "prospect_research", channel: "prospect", responseType: "informational", confidence: "high" });
    expect(turn.response.operations).toHaveLength(1);
    expect(turn.response.operations[0]).toMatchObject({ kind: "create_account", requiresConfirmation: true, sourceChannel: "prospect" });
    expect(turn.qualityTrace).toMatchObject({ process: "prospect_chat", intentType: "prospect_guard", intentSubtype: "conversion", validationStatus: "valid", operationsProposed: 1 });
    expect(buildGuardedProspectTurn({ question: "Dame el perfil", snapshot: rich, history: [], sessionId: 1, normalizeResponse: normalizeProspectResponse })).toBeNull();
  });

  it("una consulta respondida sin modelo nunca lleva operaciones", () => {
    const turn = buildGuardedProspectTurn({
      question: "Busca en internet las últimas noticias.", snapshot: rich, history: [], sessionId: 9001, normalizeResponse: normalizeProspectResponse,
    });
    expect(turn.response.operations).toEqual([]);
    expect(turn.response.recommendedActions).toEqual([]);
  });
});
