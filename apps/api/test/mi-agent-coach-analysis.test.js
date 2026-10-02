import { afterEach, describe, expect, it, vi } from "vitest";
import { getExchangeRate } from "../src/exchange-rates.js";
import {
  buildActivityProgress,
  buildCoachQuotaMetrics,
  classifyCoachOpportunityLifecycle,
  getEnabledCoachTerminalStatusCodes,
  normalizeAnalysis,
} from "../src/routes.mi-agent.js";

describe("Mi Coach commercial analysis", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifies deactivation before commercial terminal status", () => {
    expect(
      classifyCoachOpportunityLifecycle({
        activationStatusCode: "desactivada",
        commercialStatusCode: "ganada",
      }),
    ).toBe("inactive");
    expect(
      classifyCoachOpportunityLifecycle({
        activationStatusCode: "activada",
        commercialStatusCode: "ganada",
      }),
    ).toBe("historical");
    expect(
      classifyCoachOpportunityLifecycle({
        activationStatusCode: "activada",
        commercialStatusCode: "en_proceso",
      }),
    ).toBe("open");
    expect(
      classifyCoachOpportunityLifecycle({
        activationStatusCode: "activada",
        commercialStatusCode: "estado_desconocido",
      }),
    ).not.toBe("open");
  });

  it("uses administration switches only to select terminal history", () => {
    expect(
      getEnabledCoachTerminalStatusCodes({
        includeWonOpportunities: true,
        includeLostOpportunities: false,
        includeCancelledOpportunities: true,
      }),
    ).toEqual(["ganada", "anulada"]);
  });

  it("only keeps recommendations linked to opportunities in the authorized snapshot", () => {
    const result = normalizeAnalysis(
      {
        actions: [
          {
            title: "Valid recommendation",
            opportunityId: 22,
            opportunityName: "Model supplied wrong title",
            accountName: "Model supplied wrong account",
          },
          {
            title: "Unauthorized recommendation",
            opportunityId: 999,
          },
          {
            title: "General recommendation",
            opportunityId: null,
          },
        ],
      },
      {
        pipeline: {
          opportunities: [
            {
              id: 22,
              name: "Authorized opportunity",
              accountName: "Authorized account",
              stageName: "Negociación",
            },
          ],
        },
        workboard: [],
      },
    );

    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]).toMatchObject({
      rank: 1,
      opportunityId: 22,
      opportunityName: "Authorized opportunity",
      accountName: "Authorized account",
      stageName: "Negociación",
    });
    expect(result.actions[1]).toMatchObject({
      rank: 2,
      title: "General recommendation",
      opportunityId: null,
    });
  });

  it("describes recent stage answers as progress evidence without claiming a stage transition", () => {
    const occurredAt = new Date(Date.now() - 60_000).toISOString();
    const result = buildActivityProgress(
      {
        workboard: [
          {
            id: 22,
            name: "Opportunity with stage evidence",
            activities: [{ occurredAt }],
            stageAnswers: [
              { answeredAt: occurredAt, answer: "Need confirmed" },
            ],
          },
          {
            id: 23,
            name: "Opportunity without stage evidence",
            activities: [{ occurredAt }],
            stageAnswers: [],
          },
          {
            id: 24,
            name: "Opportunity with older stage evidence",
            activities: [{ occurredAt }],
            stageAnswers: [
              {
                answeredAt: new Date(Date.now() - 120_000).toISOString(),
                answer: "Earlier answer",
              },
            ],
          },
        ],
      },
      null,
    );

    expect(result.activityCount).toBe(3);
    expect(result.progressedOpportunities).toBe(1);
    expect(result.opportunitiesWithoutProgress).toBe(2);
    expect(result.details[0]).toMatchObject({
      opportunityId: 22,
      progressSignal: "stage_answer_after_activity",
      activityWithoutProgress: false,
    });
    expect(result.details[1]).toMatchObject({
      opportunityId: 23,
      progressSignal: null,
      activityWithoutProgress: true,
    });
    expect(result.details[2]).toMatchObject({
      opportunityId: 24,
      progressSignal: null,
      activityWithoutProgress: true,
    });
    expect(result.message).toContain(
      "respuestas de etapa posteriores a su actividad reciente",
    );
    expect(result.message).not.toContain("ha cambiado el estado");
  });

  it("converts quota, won amount, and pipeline to the same currency", () => {
    const result = buildCoachQuotaMetrics({
      quotaAmount: 30000,
      quotaCurrencyCode: "MXN",
      actualAmountUsd: 1000,
      qualifiedAmountUsd: 2500,
      committedOpenAmountUsd: 500,
      usdToQuotaRate: 17.5,
      exchangeRateFetchedAt: "2026-09-27T00:00:00.000Z",
    });

    expect(result.quota).toEqual({
      assignedAmount: 30000,
      actualAmount: 17500,
      actualAmountUsd: 1000,
      gapAmount: 12500,
      committedOpenAmount: 8750,
      weightedOpenAmount: 43750,
      currencyCode: "MXN",
    });
    expect(result.currencyConversion).toMatchObject({
      available: true,
      baseCurrencyCode: "USD",
      targetCurrencyCode: "MXN",
      usdToTargetRate: 17.5,
    });
  });

  it("does not fabricate comparable totals when the exchange rate is unavailable", () => {
    const result = buildCoachQuotaMetrics({
      quotaAmount: 30000,
      quotaCurrencyCode: "MXN",
      actualAmountUsd: 1000,
      qualifiedAmountUsd: 2500,
      committedOpenAmountUsd: 500,
      usdToQuotaRate: null,
    });

    expect(result.quota).toMatchObject({
      assignedAmount: 30000,
      actualAmount: null,
      gapAmount: null,
      committedOpenAmount: null,
      weightedOpenAmount: null,
      currencyCode: "MXN",
    });
    expect(result.currencyConversion).toMatchObject({
      available: false,
      usdToTargetRate: null,
    });
  });

  it("compares pipeline coverage and quota gap in the same currency", () => {
    const result = normalizeAnalysis(
      {},
      {
        quota: { gapAmount: 17000, currencyCode: "MXN" },
        currencyConversion: {
          available: true,
          usdToTargetRate: 17.5,
        },
        workboard: [
          {
            id: 41,
            name: "Qualified opportunity",
            accountName: "Account",
            amountUsd: 1000,
            riskLevel: "low",
            riskReasons: [],
            daysSinceActivity: 1,
            nextStep: { title: "Follow up" },
          },
        ],
      },
    );

    expect(result.alerts.some((alert) => alert.code === "weak_pipeline")).toBe(
      false,
    );
  });

  it("caches Frankfurter rates by currency pair", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ rates: { CAD: 1.37 } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const firstRate = await getExchangeRate({
      baseCurrency: "USD",
      targetCurrency: "CAD",
    });
    const secondRate = await getExchangeRate({
      baseCurrency: "USD",
      targetCurrency: "CAD",
    });

    expect(firstRate.exchangeRate).toBe(1.37);
    expect(secondRate).toEqual(firstRate);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
