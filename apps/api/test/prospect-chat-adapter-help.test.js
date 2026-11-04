import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prospectBank } from "../src/channel-quality/live/prospect-live.js";
import { PROSPECT_HELP_INSTRUCTION, PROSPECT_HELP_INTENTS, prospectIntentGuidance } from "../src/prospect-research/prospect-prompts.js";

const rich = { ...prospectBank.sessions.rica, id: 9001 };
const user = { id: 1, permissionSet: new Set(["prospeccion.read"]) };
const tools = ["getProspectProfile", "searchProspectFindings", "searchProspectContacts", "searchProspectHypotheses"];

// Loads the adapter with the engine replaced by a probe that hands back its dependencies.
async function loadAdapter({ research, advancedModel = "modelo-avanzado" } = {}) {
  vi.resetModules();
  let captured;
  vi.doMock("../src/structuredWebResearch.js", () => ({ runStructuredTextResearch: research }));
  vi.doMock("../src/ai-services/state.js", () => ({ aiModelFor: vi.fn((_feature, role) => (role === "advanced" ? advancedModel : "modelo-rapido")) }));
  vi.doMock("../src/coach/business-rules.js", () => ({ loadCoachBusinessRules: async () => ({}) }));
  vi.doMock("../src/coach/semantic-classifier-prompts.js", () => ({
    SEMANTIC_CLASSIFIER_DEFAULTS: { prospect: "Instrucción por defecto de Cuenta nueva." },
    loadSemanticClassifierPrompt: async () => ({ instruction: "Instrucción configurada." }),
  }));
  vi.doMock("../src/coach/conversation-engine.js", () => ({
    runConversationEngine: async ({ dependencies }) => {
      captured = dependencies;
      return { response: {} };
    },
  }));
  const { createProspectChatAdapter } = await import("../src/prospect-research/prospect-chat-adapter.js");
  const adapter = createProspectChatAdapter({ user, session: rich, jobId: 5 });
  await adapter.runTurn({ question: "Hola", history: [] });
  return { adapter, dependencies: captured };
}

const ask = (dependencies, question, intent = "prospect_profile") => dependencies.requestResponse({
  payload: { question, conversationHistory: [], instruction: "Instrucción base.", context: { channelIntentRouting: { intent } } },
});

beforeEach(() => vi.unstubAllEnvs());
afterEach(() => {
  vi.doUnmock("../src/structuredWebResearch.js");
  vi.doUnmock("../src/ai-services/state.js");
  vi.doUnmock("../src/coach/business-rules.js");
  vi.doUnmock("../src/coach/semantic-classifier-prompts.js");
  vi.doUnmock("../src/coach/conversation-engine.js");
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("instrucciones de ayuda al vendedor", () => {
  it("cada intención de ayuda agrega la instrucción común y la suya; las consultas no", () => {
    expect([...PROSPECT_HELP_INTENTS].sort()).toEqual(["call_preparation", "contact_prioritization", "next_step_recommendation", "objection_handling", "outreach_draft"]);
    for (const intent of PROSPECT_HELP_INTENTS) {
      expect(prospectIntentGuidance(intent)).toContain(PROSPECT_HELP_INSTRUCTION);
    }
    expect(prospectIntentGuidance("prospect_contacts")).toBe("");
    expect(prospectIntentGuidance(undefined)).toBe("");
  });

  it("piden entregar el resultado, no inventar y decir lo que falta", () => {
    expect(PROSPECT_HELP_INSTRUCTION).toContain("no un resumen de la sesión");
    expect(PROSPECT_HELP_INSTRUCTION).toContain("Nunca inventes personas, cargos, correos, teléfonos, cifras");
    expect(PROSPECT_HELP_INSTRUCTION).toContain("no tiene hallazgos, contactos ni hipótesis registrados");
    expect(prospectIntentGuidance("outreach_draft")).toContain("«Asunto:»");
    expect(prospectIntentGuidance("call_preparation")).toContain("**Cierre**");
    expect(prospectIntentGuidance("contact_prioritization")).toContain("Elige y ordena");
  });

  it("llegan al modelo solo cuando la intención es de ayuda", async () => {
    const { dependencies } = await loadAdapter({ research: vi.fn() });
    const model = { channelIntentRouting: { intent: "call_preparation" }, administrativeRules: [] };
    const help = dependencies.buildPrompt(model, "Prepárame la llamada", "", {}, []);
    expect(help.instruction).toContain("**Preguntas de descubrimiento**");
    const query = dependencies.buildPrompt({ ...model, channelIntentRouting: { intent: "prospect_contacts" } }, "¿Qué contactos hay?", "", {}, []);
    expect(query.instruction).not.toContain(PROSPECT_HELP_INSTRUCTION);
  });
});

describe("clasificador y diagnóstico del turno", () => {
  it("rutea con el clasificador semántico y deja constancia del origen", async () => {
    const research = vi.fn().mockResolvedValue({ intent: "objection_handling", confidence: "high", reason: "Pide objeciones." });
    const { adapter, dependencies } = await loadAdapter({ research });
    const routing = await dependencies.classifyChannelIntent({
      question: "¿Qué me van a decir?", history: [], availableTools: tools, context: { prospectSessionId: 9001 },
      configuration: (await import("../src/coach/channel-intents.js")).getChannelIntentDefaults("prospect"),
    });
    expect(routing).toMatchObject({ intent: "objection_handling", source: "semantic" });
    expect(research.mock.calls[0][0].systemPrompt).toBe("Instrucción configurada.");
    expect(dependencies.getTurnDiagnostics().prospectChat.classifier).toEqual({ source: "semantic", intent: "objection_handling" });
    await adapter.runTurn({ question: "Hola", history: [] });
    expect(dependencies.getTurnDiagnostics().prospectChat).toEqual({});
  });

  it("devuelve null y registra los patrones cuando el clasificador no decide", async () => {
    const { dependencies } = await loadAdapter({ research: vi.fn().mockResolvedValue(null) });
    const routing = await dependencies.classifyChannelIntent({ question: "x", history: [], availableTools: tools, context: { prospectSessionId: 9001 }, configuration: [] });
    expect(routing).toBeNull();
    expect(dependencies.getTurnDiagnostics().prospectChat.classifier).toEqual({ source: "patterns", intent: null });
  });
});

describe("verificación de la respuesta del modelo", () => {
  const clean = { answer: "Empieza por Carlos Treviño, Gerente de TI, por la nueva planta.", evidence: [], inferences: [], confidence: "high" };
  const dirty = { ...clean, answer: "Empieza por Carlos Treviño. Escríbele a carlos@invento.example por la nueva planta." };

  it("repara una respuesta con datos inventados pidiendo una corrección al modelo", async () => {
    const research = vi.fn().mockResolvedValueOnce(dirty).mockResolvedValueOnce(clean);
    const { dependencies } = await loadAdapter({ research });
    const result = await ask(dependencies, "¿Por dónde empiezo?", "contact_prioritization");
    expect(result.answer).toBe(clean.answer);
    const correction = research.mock.calls[1][0].context;
    expect(correction.previousAnswer).toBe(dirty.answer);
    expect(correction.instruction).toContain("Corrección obligatoria");
    expect(correction.instruction).toContain("carlos@invento.example");
    expect(dependencies.getTurnDiagnostics().prospectChat.verification).toMatchObject({ status: "repaired", issueKinds: ["email"] });
  });

  it("no llama de nuevo al modelo cuando la respuesta está limpia", async () => {
    const research = vi.fn().mockResolvedValue(clean);
    const { dependencies } = await loadAdapter({ research });
    await ask(dependencies, "¿Por dónde empiezo?");
    expect(research).toHaveBeenCalledTimes(1);
    expect(dependencies.getTurnDiagnostics().prospectChat.verification.status).toBe("clean");
  });

  it("entrega la respuesta sin verificar cuando se apaga el interruptor", async () => {
    vi.stubEnv("PROSPECT_ANSWER_VERIFICATION", "false");
    const research = vi.fn().mockResolvedValue(dirty);
    const { dependencies } = await loadAdapter({ research });
    expect((await ask(dependencies, "x")).answer).toBe(dirty.answer);
    expect(research).toHaveBeenCalledTimes(1);
  });
});

describe("modelo de las respuestas de ayuda", () => {
  it("usa el modelo rápido por defecto", async () => {
    const research = vi.fn().mockResolvedValue({ answer: "ok" });
    const { dependencies } = await loadAdapter({ research });
    await ask(dependencies, "Redacta un correo", "outreach_draft");
    expect(research.mock.calls[0][0].model).toBeUndefined();
    expect(dependencies.getTurnDiagnostics().prospectChat.generation).toEqual({ intent: "outreach_draft", modelRole: "fast" });
  });

  it("usa el modelo avanzado del módulo solo para intenciones de ayuda cuando se configura", async () => {
    vi.stubEnv("PROSPECT_CHAT_HELP_MODEL_ROLE", "advanced");
    const research = vi.fn().mockResolvedValue({ answer: "ok" });
    const { dependencies } = await loadAdapter({ research });
    await ask(dependencies, "Redacta un correo", "outreach_draft");
    expect(research.mock.calls[0][0].model).toBe("modelo-avanzado");
    await ask(dependencies, "¿Qué contactos hay?", "prospect_contacts");
    expect(research.mock.calls[1][0].model).toBeUndefined();
    expect(dependencies.getTurnDiagnostics().prospectChat.generation.modelRole).toBe("fast");
  });
});
