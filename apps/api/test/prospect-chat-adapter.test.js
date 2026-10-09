import { describe, expect, it } from "vitest";
import {
  buildProspectFallback,
  createProspectChatAdapter,
  normalizeProspectRecommendedActions,
} from "../src/prospect-research/prospect-chat-adapter.js";

describe("Prospect chat adapter", () => {
  it("descarta sugerencias de correo y operaciones sin destino de conversión explícito", () => {
    const actions = normalizeProspectRecommendedActions([
      {
        title: "Preparar borrador de correo para María García",
        actionType: "email_draft",
      },
      {
        title: "Crear cuenta",
        actionType: "convert",
      },
      {
        title: "Crear oportunidad desde hipótesis confirmada",
        target: "opportunity",
        actionType: "convert",
      },
    ]);

    expect(actions).toEqual([
      expect.objectContaining({
        title: "Crear oportunidad desde hipótesis confirmada",
        target: "opportunity",
        requiresConfirmation: true,
      }),
    ]);
  });

  it("acepta solo operaciones de conversión con un tipo y destino CRM permitidos", () => {
    const actions = normalizeProspectRecommendedActions([
      {
        title: "Preparar llamada con María",
        target: "contact",
        actionType: "call",
      },
      {
        title: "Crear una oportunidad",
        target: "opportunity",
        actionType: "convert",
      },
      {
        title: "Crear una nota",
        target: "note",
        actionType: "create",
      },
    ]);

    expect(actions).toEqual([
      expect.objectContaining({
        title: "Crear una oportunidad",
        target: "opportunity",
      }),
    ]);
  });

  it("da fallback específico a hallazgos, hipótesis y conversiones sin presentarlos como CRM confirmado", () => {
    const snapshot = {
      profile: { companyName: "Prospecto Demo" },
      findings: [
        {
          title: "Expansión nube",
          summary: "Proyecto por validar",
          evidence: "Nota pública",
        },
      ],
      contacts: [{ name: "Ana López", roleTitle: "Arquitecta", area: "TI" }],
      hypotheses: [
        { title: "Renovación DNS", businessChallenge: "Resolver crecimiento" },
      ],
    };

    const findings = buildProspectFallback(snapshot, "¿Qué hallazgos hay?", {
      intent: "prospect_findings",
    });
    expect(findings.answer).toContain("Expansión nube");
    expect(findings.evidence).toContain("Nota pública");

    const hypotheses = buildProspectFallback(
      snapshot,
      "¿Qué hipótesis de oportunidad tenemos?",
      { intent: "opportunity_hypotheses" },
    );
    expect(hypotheses.answer).toContain("No son oportunidades CRM confirmadas");

    const conversion = buildProspectFallback(
      snapshot,
      "Convierte esta hipótesis en oportunidad",
      { intent: "conversion_request" },
    );
    expect(conversion.answer).toContain("No se creó ningún registro CRM");
    expect(conversion.recommendedActions).toEqual([]);
  });

  it("mantiene el prospecto fuera de las entidades CRM", () => {
    const adapter = createProspectChatAdapter({
      user: { id: 31, permissionSet: new Set(["prospeccion.read"]) },
      session: {
        id: 10,
        companyName: "Prospecto Demo",
        country: "Mexico",
        result: {
          profile: { companyName: "Prospecto Demo", country: "Mexico" },
          outreach: { body: "Mensaje inicial" },
        },
        findings: [],
        contacts: [],
        hypotheses: [],
      },
      jobId: null,
    });

    expect(adapter.channel).toBe("prospect");
    expect(adapter.channelRules).toEqual({
      prospectScoped: true,
      crmRecordsConfirmedOnly: true,
    });
    expect(adapter.operationPolicy).toEqual({
      allowedKinds: ["create_account", "create_contact", "create_opportunity"],
      sourceChannel: "prospect",
    });
  });
});
