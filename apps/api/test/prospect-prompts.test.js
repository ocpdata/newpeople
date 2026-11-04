import { describe, expect, it, vi } from "vitest";
import { PROSPECT_CHAT_INSTRUCTION, PROSPECT_SYSTEM_PROMPT, buildSessionCoverage, languageInstruction, requestedLanguage } from "../src/prospect-research/prospect-prompts.js";
import { prospectBank } from "../src/channel-quality/live/prospect-live.js";

const rich = prospectBank.sessions.rica;

describe("hechos de la sesión que enmarcan la respuesta", () => {
  it("cuenta lo que hay y lista lo que la sesión no tiene", () => {
    const coverage = buildSessionCoverage({ findings: rich.findings, contacts: rich.contacts, hypotheses: rich.hypotheses, externalResearch: rich.result.externalResearch });
    expect(coverage).toMatchObject({ findings: 4, contacts: 4, contactsWithEmail: 0, hypotheses: 3, publicResearchRun: true });
    expect(coverage.notRegistered).toEqual([
      "correo electrónico de las personas identificadas", "teléfono de las personas identificadas",
      "presupuesto de TI", "proveedores y tecnología actuales", "tamaño de la empresa (ingresos y empleados)",
    ]);
  });

  it("marca una sesión sin hallazgos, contactos ni hipótesis para que la respuesta lo diga primero", () => {
    expect(buildSessionCoverage({}).isEmpty).toBe(true);
    expect(buildSessionCoverage({ findings: [], contacts: [], hypotheses: [] }).isEmpty).toBe(true);
    expect(buildSessionCoverage({ hypotheses: [{ title: "H" }] }).isEmpty).toBe(false);
    expect(buildSessionCoverage({ findings: rich.findings, contacts: rich.contacts, hypotheses: rich.hypotheses }).isEmpty).toBe(false);
  });

  it("distingue contactos con y sin correo y una sesión sin investigación", () => {
    const partial = buildSessionCoverage({ contacts: [{ email: "a@b.test" }, { email: "" }, {}], findings: [], hypotheses: [], externalResearch: null });
    expect(partial.contactsWithEmail).toBe(1);
    expect(partial.notRegistered[0]).toBe("correo electrónico de 2 de las 3 personas identificadas");
    expect(partial.notRegistered).toContain("investigación de fuentes públicas ejecutada");
    expect(buildSessionCoverage({}).notRegistered).not.toContain("teléfono de las personas identificadas");
    expect(buildSessionCoverage(undefined).contacts).toBe(0);
  });
});

describe("instrucciones del chat de Cuenta nueva", () => {
  it("exigen el encuadre de prospección, separar ingresado, público e inferido y no inventar", () => {
    expect(PROSPECT_CHAT_INSTRUCTION).toContain("datos de prospección y no registros del CRM");
    expect(PROSPECT_CHAT_INSTRUCTION).toContain("personas identificadas en fuentes públicas, no contactos confirmados en el CRM");
    expect(PROSPECT_CHAT_INSTRUCTION).toContain("lo que ingresó el vendedor, la evidencia pública");
    expect(PROSPECT_CHAT_INSTRUCTION).toContain("sessionCoverage.notRegistered");
    expect(PROSPECT_CHAT_INSTRUCTION).toContain("nunca inventes datos de contacto, cifras, fechas, fuentes ni proveedores");
  });

  it("hacen que la pregunta mande sobre el enrutamiento y pidan las fuentes completas", () => {
    expect(PROSPECT_CHAT_INSTRUCTION).toContain("La pregunta del vendedor manda");
    expect(PROSPECT_CHAT_INSTRUCTION).toContain("Si pide elegir, priorizar, explicar o redactar, hazlo");
    expect(PROSPECT_CHAT_INSTRUCTION).toContain("su título, su fecha y su enlace");
  });

  it("resuelven referencias con la respuesta anterior y piden elegir con justificación", () => {
    expect(PROSPECT_CHAT_INSTRUCTION).toContain("«el segundo»");
    expect(PROSPECT_CHAT_INSTRUCTION).toContain("elige a una persona o hipótesis concreta");
    expect(PROSPECT_CHAT_INSTRUCTION).toContain("idioma que el vendedor haya pedido");
  });

  it("dejan que el servidor proponga las conversiones", () => {
    expect(PROSPECT_SYSTEM_PROMPT).toContain("las conversiones al CRM las propone el servidor");
    expect(PROSPECT_CHAT_INSTRUCTION).toContain("Las conversiones requieren confirmación explícita");
  });
});

describe("lo que recibe el modelo", () => {
  it("reintenta una vez si el proveedor no devuelve una respuesta utilizable", async () => {
    vi.resetModules();
    const call = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ answer: "Respuesta del segundo intento" });
    let produced;
    vi.doMock("../src/structuredWebResearch.js", () => ({ runStructuredTextResearch: call }));
    vi.doMock("../src/coach/business-rules.js", () => ({ loadCoachBusinessRules: async () => ({}) }));
    vi.doMock("../src/coach/conversation-engine.js", () => ({
      runConversationEngine: async ({ dependencies }) => {
        produced = await dependencies.requestResponse({ payload: { question: "Hola", context: {} } });
        return { response: {} };
      },
    }));
    const { createProspectChatAdapter } = await import("../src/prospect-research/prospect-chat-adapter.js");
    const adapter = createProspectChatAdapter({ user: { id: 1, permissionSet: new Set(["prospeccion.read"]) }, session: { ...rich, id: 9001 }, jobId: 1 });
    await adapter.runTurn({ question: "Hola", history: [] });
    expect(call).toHaveBeenCalledTimes(2);
    expect(produced.answer).toBe("Respuesta del segundo intento");
    call.mockReset().mockResolvedValue(null);
    await adapter.runTurn({ question: "Hola", history: [] });
    expect(call).toHaveBeenCalledTimes(2);
    expect(produced.answer).toContain("Aceros del Norte");
    vi.doUnmock("../src/structuredWebResearch.js");
    vi.doUnmock("../src/coach/business-rules.js");
    vi.doUnmock("../src/coach/conversation-engine.js");
    vi.resetModules();
  });

  it("incluye la cobertura de la sesión y las instrucciones completas", async () => {
    vi.resetModules();
    const call = vi.fn().mockResolvedValue({ answer: "ok" });
    let captured;
    vi.doMock("../src/structuredWebResearch.js", () => ({ runStructuredTextResearch: call }));
    vi.doMock("../src/coach/business-rules.js", () => ({ loadCoachBusinessRules: async () => ({}) }));
    vi.doMock("../src/coach/conversation-engine.js", () => ({
      runConversationEngine: async ({ dependencies }) => {
        const model = await dependencies.prepareReadModel({ availableTools: [], conversationHistory: [], channelIntentRouting: { intent: "prospect_contacts", allowedTools: [] }, channelIntentCatalog: [] });
        captured = dependencies.buildPrompt(model.modelSnapshot, "¿Qué contactos hay?", "", { prospectSessionId: 1 }, []);
        return { response: {} };
      },
    }));
    const { createProspectChatAdapter } = await import("../src/prospect-research/prospect-chat-adapter.js");
    const adapter = createProspectChatAdapter({
      user: { id: 1, permissionSet: new Set(["prospeccion.read"]) },
      session: { ...rich, id: 9001 }, jobId: 1,
    });
    await adapter.runTurn({ question: "¿Qué contactos hay?", history: [] });
    expect(captured.context.sessionCoverage).toMatchObject({ contacts: 4, contactsWithEmail: 0 });
    expect(captured.instruction.startsWith(PROSPECT_CHAT_INSTRUCTION)).toBe(true);
    expect(captured.instruction).toContain("Enrutamiento del servidor");
    expect(captured.instruction).toContain("no define lo que pide el vendedor");
    vi.doUnmock("../src/structuredWebResearch.js");
    vi.doUnmock("../src/coach/business-rules.js");
    vi.doUnmock("../src/coach/conversation-engine.js");
    vi.resetModules();
  });
});

describe("idioma pedido por el vendedor", () => {
  it("toma el último idioma pedido, también del historial", () => {
    expect(requestedLanguage({ question: "¿Cuáles son los hallazgos?", history: [{ role: "user", text: "De ahora en adelante responde en inglés." }] })).toBe("inglés");
    expect(requestedLanguage({ question: "Ahora responde en español", history: [{ role: "user", text: "Please answer in English" }] })).toBe("español");
  });

  it("ignora al asistente y las preguntas sin petición de idioma", () => {
    expect(requestedLanguage({ question: "¿Qué contactos hay?", history: [{ role: "assistant", text: "Respondo en inglés" }] })).toBeNull();
    expect(languageInstruction(null)).toBe("");
    expect(languageInstruction("inglés")).toContain("TODA la respuesta en inglés");
  });
});
