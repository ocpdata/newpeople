import { afterEach, describe, expect, it, vi } from "vitest";
import { getCoachBusinessRules } from "../src/coach/business-rules.js";
import { getChannelIntentDefaults } from "../src/coach/channel-intents.js";
import { resolveBankSessions } from "../src/channel-quality/live/prospect-live.js";

const session = { ...resolveBankSessions().rica_crm, id: 9001 };
const user = { id: 1, permissionSet: new Set(["prospeccion.read", "enablement_comercial.use"]) };

// Runs a real turn (engine included) with the model and the database-backed lookups replaced.
async function runTurn({ overrides = {}, question = "¿Qué material de la biblioteca puedo compartir?", history = [], classifierIntent = "library_materials" }) {
  vi.resetModules();
  const research = vi.fn(async ({ schemaName }) => (schemaName === "prospect_intent_classification"
    ? { intent: classifierIntent, confidence: "high", reason: "prueba" }
    : { answer: "Respuesta de prueba", evidence: ["Dato de la sesión"], inferences: [], confidence: "high", source: "prospect_research" }));
  vi.doMock("../src/structuredWebResearch.js", () => ({ runStructuredTextResearch: research }));
  vi.doMock("../src/ai-services/state.js", () => ({ aiModelFor: (_feature, role) => `modelo-${role}` }));
  vi.doMock("../src/coach/admin-rules.js", () => ({ listCoachAdminRules: async () => [] }));
  vi.doMock("../src/coach/channel-intent-governance.js", () => ({
    loadChannelIntentConfigurations: async () => getChannelIntentDefaults("prospect"),
  }));
  vi.doMock("../src/coach/semantic-classifier-prompts.js", () => ({
    SEMANTIC_CLASSIFIER_DEFAULTS: { prospect: "Instrucción por defecto." },
    loadSemanticClassifierPrompt: async () => ({ instruction: "Instrucción." }),
  }));
  const list = vi.fn(async () => ({ items: session.libraryAssets }));
  const { createProspectChatAdapter } = await import("../src/prospect-research/prospect-chat-adapter.js");
  const adapter = createProspectChatAdapter({
    user, session, jobId: 4, listLibraryAssets: list,
    businessRules: getCoachBusinessRules({ channel: "prospect", process: "prospect_chat", overrides }),
  });
  const result = await adapter.runTurn({ question, history });
  const chatCall = research.mock.calls.map(([args]) => args).find((args) => args.schemaName === "prospect_contextual_chat");
  return { result, research, list, chatCall, classifierCalls: research.mock.calls.filter(([args]) => args.schemaName === "prospect_intent_classification").length };
}

afterEach(() => {
  vi.doUnmock("../src/structuredWebResearch.js");
  vi.doUnmock("../src/ai-services/state.js");
  vi.doUnmock("../src/coach/admin-rules.js");
  vi.doUnmock("../src/coach/channel-intent-governance.js");
  vi.doUnmock("../src/coach/semantic-classifier-prompts.js");
  vi.resetModules();
});

describe("las reglas del servidor de Cuenta nueva se aplican en el turno", () => {
  it("por defecto lee la biblioteca y lo registra en la traza", async () => {
    const { list, chatCall, result } = await runTurn({});
    expect(list).toHaveBeenCalledTimes(1);
    expect(chatCall.context.context.libraryAccess).toBe("authorized");
    expect(chatCall.context.context.readToolResults.map((item) => item.toolName)).toContain("getLibraryMaterials");
    expect(result.qualityTrace.diagnostics.prospectChat.classifier).toEqual({ source: "semantic", intent: "library_materials" });
  });

  it("con la biblioteca deshabilitada no la consulta y dice por qué", async () => {
    const { list, chatCall } = await runTurn({ overrides: { scope: { libraryMaterialsAllowed: false } } });
    expect(list).not.toHaveBeenCalled();
    expect(chatCall.context.context.libraryAccess).toBe("disabled_by_rules");
    expect(chatCall.context.context.readToolResults.map((item) => item.toolName)).not.toContain("getLibraryMaterials");
  });

  it("con el clasificador en «off» deciden solo los patrones y no se llama al modelo para clasificar", async () => {
    const { classifierCalls, result } = await runTurn({ overrides: { serverPolicy: { semanticClassifier: "off" } }, classifierIntent: "prospect_profile" });
    expect(classifierCalls).toBe(0);
    expect(result.response.channelIntentRouting).toMatchObject({ intent: "library_materials", source: "patterns" });
  });

  it("limita la memoria de la conversación que recibe el modelo", async () => {
    const history = Array.from({ length: 10 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", text: `mensaje ${index}` }));
    const { chatCall } = await runTurn({ overrides: { serverPolicy: { maxHistoryMessages: 4 } }, history });
    expect(chatCall.context.conversationHistory.map((message) => message.text)).toEqual(["mensaje 6", "mensaje 7", "mensaje 8", "mensaje 9"]);
  });

  it("usa el modelo avanzado en las intenciones de ayuda por defecto y el rápido cuando la regla lo pide", async () => {
    const advanced = await runTurn({});
    expect(advanced.chatCall.model).toBe("modelo-advanced");
    const query = await runTurn({ question: "¿Qué contactos hay?", classifierIntent: "prospect_contacts" });
    expect(query.chatCall.model).toBeUndefined();
    const fast = await runTurn({ overrides: { serverPolicy: { helpModelRole: "fast" } } });
    expect(fast.chatCall.model).toBeUndefined();
  });
});
