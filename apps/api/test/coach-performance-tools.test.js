import { describe, expect, it, vi } from "vitest";
import { COACH_PERFORMANCE_TOOLS, asksForOwnOpportunities, describeQuarterItems, pipelineIsOwn, keepOwnOpportunities, keepOwnOpportunityList, needsSellerPerformance, readSellerPerformance, shapeSellerPerformance } from "../src/coach/performance-tools.js";

const row = (id, name, rank, score, extra = {}) => ({
  sellerUserId: id, sellerUserName: name, rankPosition: rank, scoreTotal: score, scoreClosing: 10, scoreBuild: 40, scoreDiscipline: 20,
  quotaAmountUsd: 500000, wonAmountUsd: 100000, attainmentPct: 20, gapAmountUsd: 400000, openOpportunities: 5, funnelOpenAmountUsd: 148000,
  pipelineWeightedUsd: 48700, timeWeightedCurrentOpenPipelineUsd: 59666.67, overdueCount: 1, noNextStepCount: 4, rankGapToNext: 6.5, ...extra,
});
const league = {
  quarterContext: { current: { label: "T4 2026", startDate: "2026-10-01", endDate: "2026-12-31", daysElapsed: 32, daysRemaining: 60, weeksRemaining: 8.57 } },
  leaderboard: [row(4, "Jacob", 1, 61.2), row(5, "Oscar", 2, 24.8), row(3, "Valeria", 3, 20)],
};
const open = { count: 13, amountUsd: 362000 };

describe("herramienta de desempeño del vendedor para Coach", () => {
  it("se declara de solo lectura con el permiso de Ritmo comercial", () => {
    expect(COACH_PERFORMANCE_TOOLS).toEqual([expect.objectContaining({ name: "getSellerPerformance", requiredPermission: "ritmo_comercial.read", readOnly: true })]);
  });

  it("entrega cuota, brecha, ritmo semanal y las dos definiciones de pipeline", () => {
    const result = shapeSellerPerformance({ league, sellerId: 5, openPipeline: open });
    expect(result.quota).toEqual({ amountUsd: 500000, wonUsd: 100000, attainmentPct: 20, gapUsd: 400000, weeklyNeededUsd: 46674.45 });
    expect(result.openPipeline).toEqual(open);
    expect(result.quarterPipeline).toMatchObject({ count: 5, amountUsd: 148000, weightedUsd: 48700, coverageOfGapRatio: 0.12 });
    expect(result.coverage).toMatchObject({ gapUsd: 400000, quarterWeightedUsd: 48700, quarterWeightedCoversPct: 12.2, quarterWeightedCoversGap: false, openPipelineUsd: 362000, openPipelineCoversPct: 90.5 });
    expect(result.labels.quarterPipeline).toBe("Pipeline del trimestre");
    expect(result.definitions.openPipeline).toContain("donde eres el vendedor");
    expect(result.discipline).toMatchObject({ overdueCount: 1, noNextStepCount: 4 });
    expect(result.period).toMatchObject({ daysRemaining: 60, weeksRemaining: 8.57 });
  });

  it("da el lugar y la puntuación sin nombrar a otros vendedores salvo con acceso a toda la liga", () => {
    const own = shapeSellerPerformance({ league, sellerId: 5, openPipeline: open });
    expect(own.ranking).toMatchObject({ position: 2, sellers: 3, score: 24.8, lowestDimensions: ["cierre"], pointsToNextPosition: 6.5, leaderScore: 61.2 });
    expect(own.ranking.table).toBeUndefined();
    expect(JSON.stringify(own)).not.toMatch(/Jacob|Valeria/);
    const global = shapeSellerPerformance({ league, sellerId: 5, openPipeline: open, canSeeTeamDetail: true });
    expect(global.ranking.table.map((item) => item.name)).toEqual(["Jacob", "Oscar", "Valeria"]);
  });

  it("avisa cuando el vendedor no tiene meta en el trimestre", () => {
    const result = shapeSellerPerformance({ league, sellerId: 99, openPipeline: open });
    expect(result.hasQuarterTarget).toBe(false);
    expect(result.quota).toBeUndefined();
    expect(result.note).toContain("sin meta");
    expect(result.openPipeline).toEqual(open);
  });

  it("calcula la liga completa para ubicar al vendedor y lee su pipeline por vendedor de la oportunidad", async () => {
    const buildLeague = vi.fn().mockResolvedValue(league);
    const run = vi.fn().mockResolvedValue([{ count: 13, amount: "362000.00" }]);
    const result = await readSellerPerformance({ user: { id: 5, permissionSet: new Set(["ritmo_comercial.read"]) }, buildLeague, run });
    expect(buildLeague).toHaveBeenCalledWith(expect.objectContaining({ forceGlobalScope: true }));
    expect(run.mock.calls[0][0]).toContain("o.seller_user_id = ?");
    expect(run.mock.calls[0][1]).toEqual([5]);
    expect(result.openPipeline).toEqual(open);
    expect(result.ranking.table).toBeUndefined();
  });

  it("«mis oportunidades» deja fuera las de mis cuentas que lleva otro vendedor", () => {
    const pipeline = {
      entityType: "pipeline", openCount: 3, openAmountUsd: 130, riskCount: 3,
      opportunities: [
        { id: 1, amountUsd: 100, riskLevel: "high" },
        { id: 2, amountUsd: 20, riskLevel: "low" },
        { id: 3, amountUsd: 10, riskLevel: "high" },
      ],
    };
    const snapshot = [{ id: 1, sellerUserId: 5 }, { id: 2, sellerUserId: 5 }, { id: 3, sellerUserId: 3 }];
    const own = keepOwnOpportunities(pipeline, 5, snapshot);
    expect(own).toMatchObject({ openCount: 2, openAmountUsd: 120, riskCount: 1 });
    expect(own.opportunities.map((item) => item.id)).toEqual([1, 2]);
    expect(keepOwnOpportunities(pipeline, 5, [])).toMatchObject({ openCount: 0, openAmountUsd: 0 });
    expect(keepOwnOpportunities(null, 5, snapshot)).toBeNull();
  });

  it("reconoce las preguntas sobre las cifras propias del vendedor", () => {
    for (const question of ["¿Cómo voy contra mi cuota?", "¿En qué lugar estoy?", "¿Qué tengo vencido?", "¿Cuánto me falta?", "¿Qué me baja la puntuación?", "¿Mi pipeline abierto alcanza para cubrir lo que me falta?"]) {
      expect(needsSellerPerformance(question), question).toBe(true);
    }
    expect(needsSellerPerformance("¿Cuál es la etapa de Vrf 2027?")).toBe(false);
  });

  it("las listas «mis oportunidades» o de cifras propias solo traen las del vendedor", () => {
    expect(asksForOwnOpportunities("Dame mis oportunidades abiertas")).toBe(true);
    expect(asksForOwnOpportunities("¿Qué oportunidades no tienen siguiente paso?")).toBe(true);
    expect(asksForOwnOpportunities("¿Qué oportunidades tiene Totalplay?")).toBe(false);
    const snapshot = [{ id: 1, sellerUserId: 5 }, { id: 3, sellerUserId: 3 }];
    expect(keepOwnOpportunityList([{ id: 1 }, { id: 3 }], 5, snapshot)).toEqual([{ id: 1 }]);
    expect(keepOwnOpportunityList(null, 5, snapshot)).toBeNull();
  });

  it("lista las oportunidades del trimestre con las dos marcas que cuenta Ritmo comercial", () => {
    const items = [
      { name: "A", accountName: "X", amountUsd: 10, closeDate: new Date("2026-12-01T06:00:00.000Z"), nextStep: { title: "Llamar", dueDate: new Date("2026-10-20T06:00:00.000Z") } },
      { name: "B", accountName: "Y", amountUsd: 5, closeDate: "2026-11-20", nextStep: { title: "Enviar", dueDate: "2026-11-25" } },
      { name: "C", accountName: "Z", amountUsd: 7, closeDate: "2026-12-15", nextStep: null },
    ];
    const described = describeQuarterItems(items, "2026-11-01");
    expect(described).toMatchObject({ count: 3, withoutNextStep: ["C"], overdue: [{ name: "A", dueDate: "2026-10-20" }] });
    expect(described.items[2]).toMatchObject({ withoutNextStep: true, overdue: false, nextStep: null });
    const result = shapeSellerPerformance({ league, sellerId: 5, openPipeline: open, quarterItems: items });
    expect(result.quarterOpportunities.count).toBe(3);
  });

  it("el pipeline es propio salvo que un usuario con alcance global pregunte por toda la cartera", () => {
    const seller = { permissionSet: new Set(["oportunidades.read"]) };
    const admin = { permissionSet: new Set(["oportunidades.read_all"]) };
    expect(pipelineIsOwn({ question: "¿Qué priorizo?", user: seller })).toBe(true);
    expect(pipelineIsOwn({ question: "¿Qué priorizo en el pipeline?", user: admin })).toBe(false);
    expect(pipelineIsOwn({ question: "¿Qué priorizo en mi pipeline?", user: admin })).toBe(true);
  });
});
