import { describe, expect, it } from "vitest";
import {
  buildCoachEntityClarification,
} from "../src/coach/entity-resolver.js";
import {
  coachSessionContextMatchesRequest,
  getCoachConversationHistory,
} from "../src/coach/agent-gateway.js";
import { resolveCoachEntities } from "../src/coach/entity-resolver.js";
import { searchCoachOpportunities } from "../src/coach/read-tools.js";
import { safeParseCoachResponse } from "../src/coach/contract.js";

const baselineSnapshot = {
  accounts: [{ id: 40, name: "Totalplay" }],
  coachOpportunities: [
    {
      id: 401,
      name: "Renovacion de infraestructura",
      accountId: 40,
      account: { id: 40, name: "Totalplay" },
      stageCode: "waiting",
      activationStatusCode: "activada",
      commercialStatusCode: "en_proceso",
      lifecycle: "open",
    },
    {
      id: 402,
      name: "Servicios administrados",
      accountId: 40,
      account: { id: 40, name: "Totalplay" },
      stageCode: "negociacion",
      activationStatusCode: "activada",
      commercialStatusCode: "en_proceso",
      lifecycle: "open",
    },
  ],
  wonOpportunities: [
    {
      id: 403,
      name: "Vrf 2027",
      accountId: 40,
      account: { id: 40, name: "Totalplay" },
      activationStatusCode: "activada",
      commercialStatusCode: "ganada",
      lifecycle: "historical",
    },
  ],
};

const emptyEntities = {
  accountId: null,
  opportunityId: null,
  contactId: null,
  leadId: null,
  names: [],
};

describe("Coach regression baseline", () => {
  it("preserves the distinction between active and open opportunities", () => {
    expect(
      searchCoachOpportunities(baselineSnapshot, {
        accountId: 40,
        activeOnly: true,
      }).map((opportunity) => opportunity.id),
    ).toEqual([401, 402, 403]);
    expect(
      searchCoachOpportunities(baselineSnapshot, {
        accountId: 40,
        openOnly: true,
      }).map((opportunity) => opportunity.id),
    ).toEqual([401, 402]);
  });

  it("resolves an exact opportunity name before an account match", () => {
    const resolution = resolveCoachEntities(
      baselineSnapshot,
      "Dame el detalle de la oportunidad Vrf 2027 de Totalplay",
    );

    expect(resolution.opportunity?.id).toBe(403);
    expect(resolution.candidates.opportunities.map((item) => item.id)).toEqual([
      403,
    ]);
  });

  it("keeps collection requests from becoming single-record clarifications", () => {
    const resolution = resolveCoachEntities(
      baselineSnapshot,
      "Dime las oportunidades activas de Totalplay",
    );

    expect(
      buildCoachEntityClarification(
        resolution,
        "Dime las oportunidades activas de Totalplay",
      ),
    ).toBeNull();
  });

  it("keeps conversation history inside the requested context", () => {
    const sessionContext = { accountId: 40, opportunityId: 401 };
    const messages = [
      {
        role: "seller",
        text: "Pregunta autorizada",
        context: sessionContext,
      },
      {
        role: "coach",
        text: "Respuesta autorizada",
        context: sessionContext,
      },
      {
        role: "seller",
        text: "Pregunta de otra cuenta",
        context: { accountId: 99 },
      },
    ];

    expect(coachSessionContextMatchesRequest(sessionContext, sessionContext)).toBe(
      true,
    );
    expect(
      getCoachConversationHistory(messages, sessionContext, sessionContext),
    ).toEqual([
      { role: "seller", text: "Pregunta autorizada" },
      { role: "coach", text: "Respuesta autorizada" },
    ]);
  });

  it("keeps the response contract valid for informational Coach results", () => {
    const parsed = safeParseCoachResponse({
      intent: "context_query",
      responseType: "informational",
      answer: "La oportunidad esta en Waiting.",
      facts: [
        {
          sourceType: "opportunity",
          sourceId: 401,
          label: "Etapa actual: Waiting",
          excerpt: "La oportunidad esta en Waiting.",
        },
      ],
      evidence: ["Dato registrado en CRM."],
      inferences: [],
      pendingItems: [],
      recommendation: null,
      confidence: "high",
      entities: emptyEntities,
      operations: [],
      clarification: null,
      action: null,
      stageReadiness: null,
    });

    expect(parsed.success).toBe(true);
  });
});
