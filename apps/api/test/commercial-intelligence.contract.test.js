import { describe, expect, it } from "vitest";
import {
  buildAccountHealth,
  buildExpansionHypotheses,
  classifyCustomerSnapshotDataNeeds,
  deduplicateCustomerIntelligenceFindings,
  filterCustomerOpportunityArtifacts,
  filterCustomerOpportunityHistory,
  normalizeCustomerSnapshotDataNeeds,
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
  it("asks the AI classifier only about server-authorized optional snapshot domains", async () => {
    let plannerRequest;
    const dataNeeds = await classifyCustomerSnapshotDataNeeds({
      question: "¿Qué contactos históricos participaron en este proyecto?",
      conversationHistory: [{ role: "user", text: "Lista los contactos" }],
      selectedContext: { accountId: 7 },
      user: { id: 5, permissionSet: new Set(["contactos.read"]) },
      jobId: 81,
      classifyWithAI: async (request) => {
        plannerRequest = request;
        return {
          domains: ["contact_history", "provider_catalog", "unknown_domain"],
          confidence: "high",
        };
      },
    });

    expect(plannerRequest.schemaName).toBe(
      "customer_account_snapshot_data_needs",
    );
    expect(plannerRequest.context.availableDataDomains).toEqual([
      expect.objectContaining({ code: "contact_history" }),
    ]);
    expect(plannerRequest.fields[0].items.enum).toEqual(["contact_history"]);
    expect(dataNeeds).toMatchObject({
      domains: ["contact_history"],
      includeContactHistory: true,
      includeProviderCatalog: false,
      confidence: "high",
    });
  });

  it("does not preload optional data for a low-confidence classification but preserves authorized conversation continuity", async () => {
    const dataNeeds = await classifyCustomerSnapshotDataNeeds({
      question: "¿Y los demás?",
      persistedIntents: ["contact_history"],
      user: {
        id: 5,
        permissionSet: new Set(["contactos.read", "oportunidades.read"]),
      },
      classifyWithAI: async () => ({
        domains: ["provider_catalog"],
        confidence: "low",
      }),
    });

    expect(dataNeeds).toMatchObject({
      domains: ["contact_history"],
      includeContactHistory: true,
      includeProviderCatalog: false,
      confidence: "low",
    });
  });

  it("falls back to baseline snapshot domains if the AI classifier is unavailable", async () => {
    const dataNeeds = await classifyCustomerSnapshotDataNeeds({
      question: "¿Qué opciones hay?",
      user: { id: 5, permissionSet: new Set(["contactos.read", "oportunidades.read"]) },
      classifyWithAI: async () => {
        throw new Error("classifier unavailable");
      },
    });

    expect(dataNeeds).toMatchObject({
      domains: [],
      includeContactHistory: false,
      includeProviderCatalog: false,
      confidence: "low",
    });
  });

  it("normalizes only known domains at non-low confidence", () => {
    expect(
      normalizeCustomerSnapshotDataNeeds(
        { domains: ["provider_catalog", "unknown_domain"], confidence: "medium" },
        [],
        ["provider_catalog"],
      ),
    ).toMatchObject({
      domains: ["provider_catalog"],
      includeProviderCatalog: true,
      includeContactHistory: false,
    });
    expect(
      normalizeCustomerSnapshotDataNeeds(
        { domains: ["provider_catalog"], confidence: "high" },
        [],
        [],
      ).domains,
    ).toEqual([]);
  });

  it("filters active terminal history by its own switch and excludes inactive records", () => {
    const opportunities = [
      {
        id: 1,
        commercial_status_code: "en_proceso",
        activation_status_code: "activada",
      },
      {
        id: 2,
        commercial_status_code: "ganada",
        activation_status_code: "activada",
      },
      {
        id: 3,
        commercial_status_code: "perdida",
        activation_status_code: "activada",
      },
      {
        id: 4,
        commercial_status_code: "anulada",
        activation_status_code: "activada",
      },
      {
        id: 5,
        commercial_status_code: "ganada",
        activation_status_code: "desactivada",
      },
    ];
    const filtered = filterCustomerOpportunityHistory(opportunities, {
      includeWonOpportunities: false,
      includeLostOpportunities: true,
      includeCancelledOpportunities: false,
    });

    expect(filtered.map((item) => item.id)).toEqual([1, 3]);
  });

  it("does not expose renewals or quoted products linked to hidden opportunities", () => {
    const visibleIds = new Set([11, 13]);
    const artifacts = [
      { id: "renewal-open", opportunity_id: 11 },
      { id: "product-won-hidden", opportunity_id: 12 },
      { id: "renewal-inactive", opportunity_id: 14 },
      { id: "product-won-visible", opportunity_id: 13 },
    ];

    expect(
      filterCustomerOpportunityArtifacts(artifacts, visibleIds).map(
        (item) => item.id,
      ),
    ).toEqual(["renewal-open", "product-won-visible"]);
    expect(filterCustomerOpportunityArtifacts(artifacts, new Set())).toEqual(
      [],
    );
  });

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
    expect(() =>
      customerIntelligenceFindingSchema.parse({
        category: "unknown",
        title: "Hallazgo",
        summary: "Resumen",
        confidence: "medium",
        certainty: "inferred",
      }),
    ).toThrow();
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
      agents: [
        {
          agentId: "public_research",
          status: "completed",
          summary: "Fuentes públicas",
          findings: [
            {
              sourceDomain: "public_web",
              category: "company_profile",
              title: "Perfil público",
              summary: "La empresa publica su actividad.",
              source: "tavily",
              sourceUrl: "https://example.com",
              confidence: "medium",
              certainty: "evidenced",
            },
          ],
          evidence: ["https://example.com"],
          confidence: "medium",
          requiresConfirmation: true,
        },
      ],
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
    expect(() =>
      customerIntelligenceSnapshotSchema.parse({
        ...snapshot,
        snapshotVersion: "v0",
      }),
    ).toThrow();
  });

  it("preserves relationship-map fields, inactive history, and exact quotation statuses", () => {
    const snapshot = normalizeCustomerIntelligenceSnapshot({
      account: {
        id: 10,
        name: "Cuenta demo",
        registrationCode: "",
        phone: "",
        website: "",
        city: "",
        stateRegion: "",
        description: "",
      },
      contacts: [
        {
          id: 11,
          accountId: 10,
          name: "Ana",
          email: "",
          phone: "",
          mobile: "",
          positionTitle: "Compras",
          department: "Compras",
          purchaseParticipation: "decide_final",
          hierarchyLevel: "directivo",
          relationshipType: "fuerte",
          influenceLevel: "decide",
          managerContactId: null,
          influencesContactId: null,
        },
      ],
      opportunities: [],
      inactiveOpportunities: [
        {
          id: 12,
          name: "Oportunidad inactiva",
          accountId: 10,
          contactId: null,
          amountUsd: 15000,
          closeDate: null,
          updatedAt: null,
          stageCode: "desarrollo",
          stageName: "Desarrollo",
          commercialStatusCode: "en_proceso",
          activationStatusCode: "desactivada",
          lifecycle: "inactive",
        },
      ],
      products: [
        {
          quotationId: 20,
          quotationVersionId: 21,
          opportunityId: 12,
          providerId: 22,
          providerName: "Proveedor",
          productCode: "P-1",
          description: "Servicio",
          itemType: "servicio",
          isRenewal: false,
          quantity: 1,
          listPriceUnit: 100,
          currencyCode: "USD",
          commercialStatus: "draft",
          fulfillmentStatus: "not_verified",
        },
      ],
      interactions: [],
      permissions: {
        canReadAccounts: true,
        canReadContacts: true,
        canReadOpportunities: true,
        canReadInteractions: true,
      },
    });

    expect(snapshot.contacts[0]).toMatchObject({
      purchaseParticipation: "decide_final",
      hierarchyLevel: "directivo",
      relationshipType: "fuerte",
      influenceLevel: "decide",
    });
    expect(snapshot.inactiveOpportunities[0].lifecycle).toBe("inactive");
    expect(snapshot.products[0]).toMatchObject({
      commercialStatus: "draft",
      fulfillmentStatus: "not_verified",
    });
  });

  it("calculates deterministic account health signals", () => {
    const health = buildAccountHealth({
      now: "2026-09-23T12:00:00.000Z",
      account: { id: 10, description: "Cuenta con contexto" },
      contacts: [],
      opportunities: [
        {
          id: 20,
          name: "Proyecto crítico",
          closeDate: "2026-09-30",
          updatedAt: "2026-09-01T12:00:00.000Z",
        },
      ],
      interactions: [{ updatedAt: "2026-08-01T12:00:00.000Z" }],
      renewals: [],
      products: [],
    });

    expect(health.status).toBe("at_risk");
    expect(health.metrics.riskyOpportunityCount).toBe(1);
    expect(health.signals.map((signal) => signal.code)).toEqual(
      expect.arrayContaining([
        "no_active_contacts",
        "stale_account_activity",
        "opportunity_needs_attention",
      ]),
    );
  });

  it("creates renewal, upsell and cross-sell hypotheses without asserting purchases", () => {
    const hypotheses = buildExpansionHypotheses({
      products: [{ providerId: 1, productCode: "BASE", description: "Base" }],
      renewals: [
        {
          providerName: "Proveedor",
          expiresAt: "2026-10-01",
          opportunityId: 20,
        },
      ],
      catalogItems: [
        { providerId: 1, code: "PLUS", description: "Plus" },
        { providerId: 2, code: "SEC", description: "Seguridad" },
      ],
      opportunities: [{ id: 20 }],
    });
    expect(hypotheses.map((item) => item.type)).toEqual(
      expect.arrayContaining(["renewal", "upsell", "cross_sell"]),
    );
    expect(hypotheses.every((item) => item.requiresConfirmation === true)).toBe(
      true,
    );
  });

  it("orchestrates specialized agents without CRM writes", async () => {
    const agents = await runAccountIntelligenceAgents({
      account: { id: 10, name: "Cuenta", description: "Contexto" },
      contacts: [],
      opportunities: [],
      interactions: [],
      activities: [],
      renewals: [],
      products: [],
      expansionHypotheses: [],
      permissions: {
        canReadAccounts: true,
        canReadContacts: true,
        canReadOpportunities: true,
        canReadInteractions: true,
      },
      accountHealth: {
        status: "attention",
        score: 80,
        signals: [],
        metrics: {
          contactCount: 0,
          opportunityCount: 0,
          riskyOpportunityCount: 0,
          interactionCount: 0,
          daysSinceLastInteraction: null,
          renewalCount: 0,
          productCount: 0,
        },
      },
    });
    expect(agents.map((agent) => agent.agentId)).toEqual(
      expect.arrayContaining([
        "crm_context",
        "commercial_health",
        "public_research",
        "expansion",
        "synthesis",
        "actions",
      ]),
    );
    expect(
      agents.every(
        (agent) =>
          typeof agent.summary === "string" &&
          agent.durationMs >= 0 &&
          agent.sourceCount >= 0,
      ),
    ).toBe(true);
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
    expect(findings[0].evidence).toContain(
      "La pagina institucional confirma el cargo.",
    );
    expect(findings[0].metadata.duplicateCount).toBe(2);
  });
});
