import { describe, expect, it } from "vitest";
import {
  compareCoachExecutions,
  coachResultsMatch,
  comparableCoachResult,
  createCoachAdapter,
} from "../src/coach/coach-adapter.js";

describe("Coach adapter", () => {
  it("conserva la configuracion especifica del Coach", () => {
    const permissions = new Set(["cuentas.read"]);
    const adapter = createCoachAdapter({
      user: { id: 31, permissionSet: permissions },
      dependencies: {},
    });

    expect(adapter.channel).toBe("coach");
    expect(adapter.availableTools.length).toBeGreaterThan(0);
    expect(adapter.permissions).toBe(permissions);
    expect(adapter.channelRules).toEqual({});
    expect(adapter.operationPolicy).toEqual({});
    expect(typeof adapter.runTurn).toBe("function");
  });

  it("compara la salida estable del Coach sin incluir datos de ejecucion", () => {
    const primary = {
      intent: "context_query",
      responseType: "informational",
      answer: "Respuesta nueva",
      entities: { accountId: 7, opportunityId: null },
      operations: [
        {
          kind: "activity",
          opportunityId: 11,
          title: "Llamar",
          persistentId: 101,
        },
      ],
      latencyMs: 20,
    };
    const legacy = {
      ...primary,
      answer: "Respuesta legacy",
      latencyMs: 80,
      operations: [
        {
          ...primary.operations[0],
          persistentId: 55,
        },
      ],
    };

    expect(comparableCoachResult(primary)).toEqual({
      intent: "context_query",
      responseType: "informational",
      entities: primary.entities,
      operations: [
        {
          kind: "activity",
          opportunityId: 11,
          accountId: null,
          contactId: null,
          interactionId: null,
        },
      ],
    });
    expect(coachResultsMatch(primary, legacy)).toBe(true);
  });

  it("detecta diferencias de respuesta, fundamentos, herramientas y errores", () => {
    const primary = {
      result: {
        intent: "context_query",
        responseType: "informational",
        answer: "Respuesta nueva",
        facts: [],
        evidence: ["Evidencia nueva"],
        inferences: [],
        pendingItems: [],
        confidence: "high",
        entities: { accountId: 7 },
        clarification: null,
        operations: [],
        activeContext: { accountId: 7 },
      },
      observability: {
        toolsUsed: ["searchAccounts"],
        queriedIds: [7],
      },
      errorMessage: null,
    };
    const legacy = {
      ...primary,
      result: {
        ...primary.result,
        answer: "Respuesta anterior",
        evidence: ["Evidencia anterior"],
      },
      observability: {
        toolsUsed: ["searchOpportunities"],
        queriedIds: [11],
      },
      errorMessage: "Fallo legacy",
    };

    const comparison = compareCoachExecutions(primary, legacy);

    expect(comparison.matched).toBe(false);
    expect(comparison.regression).toBe(true);
    expect(comparison.differences).toEqual(
      expect.arrayContaining(["answer", "fundamentals", "tools", "error"]),
    );
  });
});
