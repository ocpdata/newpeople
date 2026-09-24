import { describe, expect, it } from "vitest";
import {
  buildAccountHealth,
  buildExpansionHypotheses,
  deduplicateCustomerIntelligenceFindings,
  runAccountIntelligenceAgents,
  PUBLIC_CONTACT_ROLE_TERMS,
} from "../src/commercial-intelligence/service.js";
import {
  customerIntelligenceFindingSchema,
  normalizeCustomerIntelligenceOrchestration,
  customerIntelligenceResultSchema,
  customerIntelligenceSnapshotSchema,
  normalizeCustomerIntelligenceFinding,
  normalizeCustomerIntelligenceSnapshot,
} from "../src/commercial-intelligence/contract.js";

describe("customer intelligence contract", () => {
  it("normalizes legacy finding fields into the common contract", () => {
    const finding = normalizeCustomerIntelligenceFinding({
      category: "missing_information",
      title: "Falta sitio web",
      summary: "La cuenta no tiene sitio web registrado.",
      evidenceText: "Campo website vacio.",
      sourceType: "crm",
      sourceReference: "account:10:website",
      confidence: "high",
      certainty: "confirmed",
      metadata: {
        targetEntity: "account",
        targetField: "website",
        suggestedValue: "https://example.com",
      },
    });

    expect(finding).toMatchObject({
      evidence: "Campo website vacio.",
      source: "crm",
      sourceUrl: "account:10:website",
      targetEntity: "account",
      targetField: "website",
      suggestedValue: "https://example.com",
      requiresConfirmation: true,
    });
  });

  it("requires evidence fields and rejects unsupported categories", () => {
    expect(() => customerIntelligenceFindingSchema.parse({
      category: "unknown",
      title: "Hallazgo",
      summary: "Resumen",
      confidence: "medium",
      certainty: "inferred",
    })).toThrow();
  });

  it("validates the result scope and generated timestamp", () => {
    const result = customerIntelligenceResultSchema.parse({
      scope: ["executive_summary", "public_research"],
      headline: "Cuenta preparada",
      summary: "Resumen ejecutivo de la cuenta.",
      findings: [],
      generatedAt: "2026-09-23T12:00:00.000Z",
    });

    expect(result.scope).toEqual(["executive_summary", "public_research"]);
    expect(result.sourceDomain).toBe("crm_internal");
  });

  it("keeps public source domains explicit across normalized results", () => {
    const result = normalizeCustomerIntelligenceOrchestration({
      sourceDomain: "public_web",
      agents: [{
        agentId: "public_research",
        status: "completed",
        summary: "Fuentes públicas",
        findings: [{
          sourceDomain: "public_web",
          category: "company_profile",
          title: "Perfil público",
          summary: "La empresa publica su actividad.",
          source: "tavily",
          sourceUrl: "https://example.com",
          confidence: "medium",
          certainty: "evidenced",
        }],
        evidence: ["https://example.com"],
        confidence: "medium",
        requiresConfirmation: true,
      }],
      generatedAt: "2026-09-23T12:00:00.000Z",
    });

    expect(result.sourceDomain).toBe("public_web");
    expect(result.agents[0].findings[0].sourceDomain).toBe("public_web");
    expect(result.writesPerformed).toBe(false);
  });

  it("normalizes an authorized account snapshot with its permission boundary", () => {
    const snapshot = normalizeCustomerIntelligenceSnapshot({
      account: {
        id: 10,
        name: "Cuenta demo",
        registrationCode: "",
        phone: "",
        website: "",
        city: "",
        stateRegion: "",
        description: "Cuenta de prueba",
      },
      selectedOpportunity: null,
      selectedContact: null,
      contacts: [],
      opportunities: [],
      interactions: [],
      permissions: {
        canReadAccounts: true,
        canReadContacts: false,
        canReadOpportunities: false,
        canReadInteractions: false,
      },
    });

    expect(snapshot).toMatchObject({
      snapshotVersion: "account-intelligence.v1",
      account: { id: 10, name: "Cuenta demo" },
      permissions: { canReadAccounts: true, canReadContacts: false },
    });
    expect(() => customerIntelligenceSnapshotSchema.parse({ ...snapshot, snapshotVersion: "v0" })).toThrow();
  });

  it("calculates deterministic account health signals", () => {
    const health = buildAccountHealth({
      now: "2026-09-23T12:00:00.000Z",
      account: { id: 10, description: "Cuenta con contexto" },
      contacts: [],
      opportunities: [{
        id: 20,
        name: "Proyecto crítico",
        closeDate: "2026-09-30",
        updatedAt: "2026-09-01T12:00:00.000Z",
      }],
      interactions: [{ updatedAt: "2026-08-01T12:00:00.000Z" }],
      renewals: [],
      products: [],
    });

    expect(health.status).toBe("at_risk");
    expect(health.metrics.riskyOpportunityCount).toBe(1);
    expect(health.signals.map((signal) => signal.code)).toEqual(expect.arrayContaining([
      "no_active_contacts",
      "stale_account_activity",
      "opportunity_needs_attention",
    ]));
  });

  it("creates renewal, upsell and cross-sell hypotheses without asserting purchases", () => {
    const hypotheses = buildExpansionHypotheses({
      products: [{ providerId: 1, productCode: "BASE", description: "Base" }],
      renewals: [{ providerName: "Proveedor", expiresAt: "2026-10-01", opportunityId: 20 }],
      catalogItems: [{ providerId: 1, code: "PLUS", description: "Plus" }, { providerId: 2, code: "SEC", description: "Seguridad" }],
      opportunities: [{ id: 20 }],
    });
    expect(hypotheses.map((item) => item.type)).toEqual(expect.arrayContaining(["renewal", "upsell", "cross_sell"]));
    expect(hypotheses.every((item) => item.requiresConfirmation === true)).toBe(true);
  });

  it("orchestrates specialized agents without CRM writes", async () => {
    const agents = await runAccountIntelligenceAgents({
      account: { id: 10, name: "Cuenta", description: "Contexto" },
      contacts: [], opportunities: [], interactions: [], activities: [], renewals: [], products: [], expansionHypotheses: [],
      permissions: { canReadAccounts: true, canReadContacts: true, canReadOpportunities: true, canReadInteractions: true },
      accountHealth: { status: "attention", score: 80, signals: [], metrics: { contactCount: 0, opportunityCount: 0, riskyOpportunityCount: 0, interactionCount: 0, daysSinceLastInteraction: null, renewalCount: 0, productCount: 0 } },
    });
    expect(agents.map((agent) => agent.agentId)).toEqual(expect.arrayContaining(["crm_context", "commercial_health", "public_research", "expansion", "synthesis", "actions"]));
    expect(agents.every((agent) => typeof agent.summary === "string" && agent.durationMs >= 0 && agent.sourceCount >= 0)).toBe(true);
  });

  it("excludes finance from public contact role targeting", () => {
    expect(PUBLIC_CONTACT_ROLE_TERMS).toContain("compras");
    expect(PUBLIC_CONTACT_ROLE_TERMS).not.toContain("finanzas");
    expect(PUBLIC_CONTACT_ROLE_TERMS).not.toContain("CFO");
  });

  it("deduplicates equivalent findings while preserving stronger evidence", () => {
    const findings = deduplicateCustomerIntelligenceFindings([
      {
        sourceDomain: "public_web",
        category: "stakeholder",
        title: "Ana Perez",
        summary: "Responsable de tecnologia.",
        evidence: "Perfil publico de la empresa.",
        source: "tavily",
        sourceUrl: "https://example.com/ana",
        confidence: "low",
        certainty: "evidenced",
      },
      {
        sourceDomain: "public_web",
        category: "stakeholder",
        title: "Ana Pérez",
        summary: "Responsable de tecnologia.",
        evidence: "La pagina institucional confirma el cargo.",
        source: "tavily",
        sourceUrl: "https://example.com/ana",
        confidence: "high",
        certainty: "evidenced",
      },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ confidence: "high" });
    expect(findings[0].evidence).toContain("La pagina institucional confirma el cargo.");
    expect(findings[0].metadata.duplicateCount).toBe(2);
  });
});