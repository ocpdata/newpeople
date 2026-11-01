import { describe, expect, it, vi } from "vitest";
import { buildProspectRecommendedActions, resolveConversionAction } from "../src/prospect-research/prospect-operations.js";
import { normalizeProspectResponse } from "../src/prospect-research/prospect-chat-adapter.js";
import { coachOperationSchema } from "../src/coach/contract.js";
import { prospectBank } from "../src/channel-quality/live/prospect-live.js";

const snapshot = {
  profile: { companyName: "Aceros del Norte" },
  contacts: prospectBank.sessions.rica.contacts,
  hypotheses: prospectBank.sessions.rica.hypotheses,
};
const single = { ...snapshot, hypotheses: [prospectBank.sessions.rica.hypotheses[0]] };
const context = { prospectSessionId: 9001 };

describe("operaciones de Cuenta nueva construidas por el servidor", () => {
  it("una consulta nunca produce operaciones, aunque el modelo las devuelva", () => {
    const modelActions = [{ title: "Contactar a Carlos Treviño", target: "contact", actionType: "create", requiresConfirmation: "true" }];
    for (const intent of ["prospect_profile", "prospect_findings", "prospect_contacts", "opportunity_hypotheses", "outreach_draft", "public_research_review", null]) {
      const response = normalizeProspectResponse(
        { answer: "Respuesta", recommendedActions: modelActions, operations: [{ kind: "create_contact" }] },
        { ...snapshot, channelIntentRouting: { intent } }, "¿Qué contactos hay?", context,
      );
      expect(response.operations, String(intent)).toEqual([]);
      expect(response.recommendedActions, String(intent)).toEqual([]);
    }
  });

  it("una conversión a cuenta propone una sola operación confirmable del canal", () => {
    const response = normalizeProspectResponse({ answer: "Revisa duplicados." }, { ...snapshot, channelIntentRouting: { intent: "conversion_request" } },
      "Convierte este prospecto en cuenta del CRM.", context);
    expect(response.operations).toHaveLength(1);
    expect(response.operations[0]).toMatchObject({
      kind: "create_account", requiresConfirmation: true, sourceChannel: "prospect", targetModule: "accounts",
      payload: { prospectSessionId: 9001, target: "account" },
    });
    expect(response.operations[0].title).toContain("Aceros del Norte");
    expect(coachOperationSchema.safeParse(response.operations[0]).success).toBe(true);
    expect(response.recommendedActions[0]).toMatchObject({ target: "account", requiresConfirmation: true });
  });

  it("crear un contacto exige nombrarlo y que esté en la sesión", () => {
    const action = resolveConversionAction({ question: "Crea el contacto Laura Medina en el CRM", snapshot });
    expect(action).toMatchObject({ target: "contact", title: "Crear el contacto Laura Medina en el CRM" });
    expect(action.notes).toContain("Fuente: Nombramientos en Aceros del Norte");
    expect(action.evidence).toBeUndefined();
    expect(resolveConversionAction({ question: "Crea el contacto Roberto Zúñiga en el CRM", snapshot })).toBeNull();
    expect(resolveConversionAction({ question: "Crea un contacto en el CRM", snapshot })).toBeNull();
  });

  it("reconoce el nombre sin importar acentos ni mayúsculas y no confunde apellidos sueltos", () => {
    expect(resolveConversionAction({ question: "crea el contacto CARLOS TREVINO", snapshot })).toMatchObject({ target: "contact" });
    expect(resolveConversionAction({ question: "crea el contacto Carlos", snapshot })).toBeNull();
  });

  it("una oportunidad sale de una hipótesis nombrada o de la única que existe", () => {
    expect(resolveConversionAction({ question: "Crea una oportunidad desde la hipótesis de ciberseguridad OT/IT en planta", snapshot }))
      .toMatchObject({ target: "opportunity", title: expect.stringContaining("Ciberseguridad OT/IT") });
    expect(resolveConversionAction({ question: "Crea una oportunidad", snapshot })).toBeNull();
    expect(resolveConversionAction({ question: "Crea una oportunidad", snapshot: single })).toMatchObject({ target: "opportunity" });
    expect(resolveConversionAction({ question: "Crea una oportunidad", snapshot: single }).notes).toContain("requiere elegir un contacto");
  });

  it("solo una intención de conversión genera la propuesta", () => {
    expect(buildProspectRecommendedActions({ intent: "conversion_request", question: "Convierte en cuenta", snapshot })).toHaveLength(1);
    expect(buildProspectRecommendedActions({ intent: "prospect_contacts", question: "Convierte en cuenta", snapshot })).toEqual([]);
    expect(buildProspectRecommendedActions({ intent: undefined, question: "Convierte en cuenta", snapshot })).toEqual([]);
  });

  it("conserva la respuesta del modelo y sus datos sin tomar acciones de él", () => {
    const response = normalizeProspectResponse(
      { answer: "Hay 2 hallazgos.", evidence: ["Nota"], inferences: ["Posible proyecto"], confidence: "high" },
      { ...snapshot, channelIntentRouting: { intent: "prospect_findings" } }, "¿Hallazgos?", context,
    );
    expect(response).toMatchObject({ answer: "Hay 2 hallazgos.", evidence: ["Nota"], inferences: ["Posible proyecto"], confidence: "high", source: "prospect_research" });
    expect(normalizeProspectResponse(null, {}, "", context).answer).toBe("No fue posible responder.");
  });
});

describe("esquema que se le pide al modelo", () => {
  it("ya no incluye acciones recomendadas", async () => {
    vi.resetModules();
    const call = vi.fn().mockResolvedValue({ answer: "ok" });
    vi.doMock("../src/structuredWebResearch.js", () => ({ runStructuredTextResearch: call }));
    vi.doMock("../src/coach/conversation-engine.js", () => ({
      runConversationEngine: async ({ dependencies }) => {
        const payload = { question: "Hola", context: { channelIntentRouting: { intent: "prospect_profile" } } };
        await dependencies.requestResponse({ payload });
        return { response: {} };
      },
    }));
    vi.doMock("../src/coach/business-rules.js", () => ({ loadCoachBusinessRules: async () => ({}) }));
    const { createProspectChatAdapter } = await import("../src/prospect-research/prospect-chat-adapter.js");
    const adapter = createProspectChatAdapter({
      user: { id: 1, permissionSet: new Set(["prospeccion.read"]) },
      session: { ...prospectBank.sessions.rica, findings: [], contacts: [], hypotheses: [] }, jobId: 1,
    });
    await adapter.runTurn({ question: "Hola", history: [] });
    const request = call.mock.calls[0][0];
    expect(request.fields.map((field) => field.key)).toEqual(["answer", "evidence", "inferences", "confidence", "source"]);
    expect(request.systemPrompt).toContain("las conversiones al CRM las propone el servidor");
    vi.doUnmock("../src/structuredWebResearch.js");
    vi.doUnmock("../src/coach/conversation-engine.js");
    vi.doUnmock("../src/coach/business-rules.js");
    vi.resetModules();
  });
});
