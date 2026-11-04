import { describe, expect, it, vi } from "vitest";
import { classifyProspectIntent, prospectClassifierEnabled } from "../src/prospect-research/prospect-intent-classifier.js";
import { classifyChannelIntent, getChannelIntentDefaults, routeChannelIntentByCode } from "../src/coach/channel-intents.js";

const tools = ["getProspectProfile", "searchProspectFindings", "searchProspectContacts", "searchProspectHypotheses"];
const catalog = getChannelIntentDefaults("prospect");
const base = { question: "¿Por dónde empiezo?", catalog, availableTools: tools, context: { prospectSessionId: 7 }, userId: 1, loadPrompt: async () => ({ instruction: "Clasifica." }) };

describe("clasificador semántico de Cuenta nueva", () => {
  it("elige la intención del catálogo y la rutea con las mismas herramientas autorizadas", async () => {
    const call = vi.fn().mockResolvedValue({ intent: "contact_prioritization", confidence: "high", reason: "Pide priorizar." });
    const routing = await classifyProspectIntent({ ...base, call });
    expect(routing).toMatchObject({
      channel: "prospect", intent: "contact_prioritization", source: "semantic", confidence: 0.95, missingContext: [], reason: "Pide priorizar.",
      allowedTools: expect.arrayContaining(["getProspectProfile", "searchProspectContacts", "searchProspectHypotheses"]),
    });
    const sent = call.mock.calls[0][0];
    expect(sent.systemPrompt).toBe("Clasifica.");
    expect(sent.fields[0].enum).toEqual(catalog.map((intent) => intent.code));
    expect(sent.aiUsageContext).toMatchObject({ featureCode: "prospect_research.chat_classifier", userId: 1 });
  });

  it("envía solo la conversación reciente recortada y la cobertura de la sesión", async () => {
    const call = vi.fn().mockResolvedValue({ intent: "prospect_profile", confidence: "medium", reason: "" });
    const history = Array.from({ length: 6 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", text: `mensaje ${index} ${"x".repeat(400)}` }));
    await classifyProspectIntent({ ...base, call, history, coverage: { contacts: 4 } });
    const context = call.mock.calls[0][0].context;
    expect(context.recentConversation).toHaveLength(4);
    expect(context.recentConversation[0].text.length).toBeLessThanOrEqual(300);
    expect(context.sessionCoverage).toEqual({ contacts: 4 });
  });

  it("no ofrece al modelo las intenciones deshabilitadas", async () => {
    const call = vi.fn().mockResolvedValue({ intent: "outreach_draft", confidence: "high", reason: "" });
    const disabled = catalog.map((intent) => (intent.code === "outreach_draft" ? { ...intent, enabled: false } : intent));
    expect(await classifyProspectIntent({ ...base, catalog: disabled, call })).toBeNull();
    expect(call.mock.calls[0][0].fields[0].enum).not.toContain("outreach_draft");
  });

  it("devuelve null para que decidan los patrones si el modelo duda, falla o responde fuera del catálogo", async () => {
    for (const answer of [
      { intent: "contact_prioritization", confidence: "low", reason: "" },
      { intent: "inventada", confidence: "high", reason: "" },
      null,
    ]) {
      expect(await classifyProspectIntent({ ...base, call: vi.fn().mockResolvedValue(answer) })).toBeNull();
    }
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await classifyProspectIntent({ ...base, call: vi.fn().mockRejectedValue(new Error("caído")) })).toBeNull();
    error.mockRestore();
  });

  it("usa la instrucción por defecto si la configuración no se puede leer", async () => {
    const call = vi.fn().mockResolvedValue({ intent: "prospect_profile", confidence: "high", reason: "" });
    await classifyProspectIntent({ ...base, call, loadPrompt: async () => { throw new Error("sin base"); } });
    expect(call.mock.calls[0][0].systemPrompt).toContain("Cuenta nueva");
  });

  it("se puede apagar sin desplegar", async () => {
    expect(prospectClassifierEnabled({})).toBe(true);
    expect(prospectClassifierEnabled({ PROSPECT_SEMANTIC_CLASSIFIER: "false" })).toBe(false);
    vi.stubEnv("PROSPECT_SEMANTIC_CLASSIFIER", "false");
    const call = vi.fn();
    expect(await classifyProspectIntent({ ...base, call })).toBeNull();
    expect(call).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe("intenciones de ayuda al vendedor", () => {
  const route = (question) => classifyChannelIntent({ channel: "prospect", question, availableTools: tools, context: { prospectSessionId: 7 } });

  it("reconocen con patrones lo que pide ayuda para actuar", () => {
    expect(route("Prepárame la llamada de descubrimiento con Carlos")?.intent).toBe("call_preparation");
    expect(route("Dame un guion para la primera llamada")?.intent).toBe("call_preparation");
    expect(route("¿A quién contacto primero y por qué?")?.intent).toBe("contact_prioritization");
    expect(route("¿Por dónde empiezo con este prospecto?")?.intent).toBe("contact_prioritization");
    expect(route("¿Cuál hipótesis debo validar primero y con quién?")?.intent).toBe("contact_prioritization");
    expect(route("¿Qué objeciones me pueden poner y cómo las respondo?")?.intent).toBe("objection_handling");
    expect(route("¿Qué hago hoy con este prospecto?")?.intent).toBe("next_step_recommendation");
    expect(route("¿Qué me falta saber antes de proponer una reunión?")?.intent).toBe("next_step_recommendation");
  });

  it("no cambian lo que ya se resolvía: consultas, correo y conversión", () => {
    expect(route("¿Qué contactos potenciales encontramos?")?.intent).toBe("prospect_contacts");
    expect(route("Redacta un correo inicial para Carlos Treviño")?.intent).toBe("outreach_draft");
    expect(route("Convierte esta hipótesis en una oportunidad CRM")?.intent).toBe("conversion_request");
    expect(route("Dame el perfil")?.intent).toBe("prospect_profile");
  });

  it("solo usan herramientas de la sesión y marcan su origen", () => {
    const routing = route("Prepárame la llamada");
    expect(routing).toMatchObject({ source: "patterns", mode: "query" });
    expect(routing.allowedTools.every((tool) => tools.includes(tool))).toBe(true);
  });

  it("routeChannelIntentByCode respeta intenciones deshabilitadas, códigos desconocidos y el contexto requerido", () => {
    expect(routeChannelIntentByCode({ channel: "prospect", code: "inexistente", availableTools: tools })).toBeNull();
    const disabled = catalog.map((intent) => (intent.code === "call_preparation" ? { ...intent, enabled: false } : intent));
    expect(routeChannelIntentByCode({ channel: "prospect", code: "call_preparation", availableTools: tools, configuration: disabled })).toBeNull();
    expect(routeChannelIntentByCode({ channel: "prospect", code: "call_preparation", availableTools: tools, context: {} }))
      .toMatchObject({ missingContext: ["prospectSession"], requiresClarification: true });
  });
});
