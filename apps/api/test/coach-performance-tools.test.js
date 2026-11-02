import { describe, expect, it, vi } from "vitest";
import { COACH_PERFORMANCE_TOOLS, sellerToolsFor, shapeCommission, loadSellerCommission, shapeAgenda, shapeClosedDeals, shapeTrend, readSellerTool, asksForOwnOpportunities, describeQuarterItems, pipelineIsOwn, keepOwnOpportunities, keepOwnOpportunityList, needsSellerPerformance, readSellerPerformance, shapeSellerPerformance, shapeQuotations, loadSellerQuotations, shapeLibraryMaterials, loadLibraryMaterials, asksForLibraryMaterial } from "../src/coach/performance-tools.js";

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
    expect(COACH_PERFORMANCE_TOOLS.map((tool) => tool.name)).toEqual(["getSellerPerformance", "getSellerAgenda", "getSellerClosedDeals", "getSellerCommission", "getSellerQuotations", "getLibraryMaterials", "getSellerTrend"]);
    expect(COACH_PERFORMANCE_TOOLS.every((tool) => tool.readOnly === true)).toBe(true);
    expect(COACH_PERFORMANCE_TOOLS[0]).toMatchObject({ requiredPermission: "ritmo_comercial.read" });
    expect(Object.fromEntries(COACH_PERFORMANCE_TOOLS.map((tool) => [tool.name, tool.requiredPermission]))).toMatchObject({
      getSellerAgenda: "oportunidades.read", getSellerClosedDeals: "oportunidades.read", getSellerTrend: "oportunidades.read", getSellerCommission: "planeacion_comercial.read",
    });
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

  it("la agenda separa vencidas, de hoy y de esta semana", () => {
    const agenda = shapeAgenda({
      today: "2026-11-04",
      actions: [
        { title: "Llamar", dueDate: new Date(2026, 9, 19), opportunity: "A" },
        { title: "Enviar", dueDate: "2026-11-04", opportunity: "B" },
        { title: "Visitar", dueDate: "2026-11-08", opportunity: "C" },
        { title: "Cotizar", dueDate: "2026-11-20", opportunity: "D" },
        { title: "Sin fecha", dueDate: null, opportunity: "E" },
      ],
      calendar: [{ title: "Reunión", dueDate: "2026-11-05", scheduledAt: "2026-11-05T16:00:00Z" }],
    });
    expect(agenda.workspaceActions).toMatchObject({ open: 5, overdue: 1, dueToday: 1, dueThisWeek: 2, withoutDate: 1 });
    expect(agenda.workspaceActions.items[0]).toMatchObject({ title: "Llamar", overdue: true });
    expect(agenda.calendarActivities).toMatchObject({ open: 1, dueThisWeek: 1 });
    expect(agenda.weekEnd).toBe("2026-11-08");
  });

  it("los cierres calculan tasa de cierre, ciclo y motivos sin contar las anuladas", () => {
    const closed = shapeClosedDeals({
      totals: [
        { status: "ganada", count: 9, amount: "400000", cycleDays: "18.5556" },
        { status: "perdida", count: 7, amount: "90000", cycleDays: null },
        { status: "anulada", count: 7, amount: "10000", cycleDays: null },
        { status: "en_proceso", count: 14, amount: "1", cycleDays: null },
      ],
      recentLost: [{ name: "X", account: "Y", status: "perdida", amountUsd: 5, closedAt: new Date(2026, 9, 1), reason: "Precio" }],
    });
    expect(closed).toMatchObject({ winRatePct: 56.3, decided: 16, won: { count: 9, averageCycleDays: 19 }, lost: { count: 7 }, cancelled: { count: 7 } });
    expect(closed.recentLostOrCancelled[0]).toMatchObject({ reason: "Precio", closedAt: "2026-10-01" });
    expect(shapeClosedDeals({ totals: [] }).winRatePct).toBeNull();
  });

  it("la tendencia compara semanas completas y meses, y marca la semana en curso como parcial", () => {
    const trend = shapeTrend({
      today: "2026-11-04",
      opportunities: [
        { createdAt: "2026-10-27", status: "en_proceso" },
        { createdAt: "2026-10-28", status: "en_proceso" },
        { createdAt: "2026-10-20", status: "ganada", closedAt: "2026-10-29", amountUsd: "1000" },
        { createdAt: "2026-11-03", status: "en_proceso" },
        { createdAt: "2026-10-05", status: "en_proceso" },
      ],
    });
    const current = trend.weeklySeries.at(-1);
    expect(current).toMatchObject({ weekStart: "2026-11-02", partial: true, created: 1 });
    expect(trend.lastCompleteWeekVsPrevious).toMatchObject({ createdChange: 1, wonChange: 1 });
    expect(trend.lastCompleteWeekVsPrevious.lastCompleteWeek).toMatchObject({ weekStart: "2026-10-26", created: 2, won: 1, wonAmountUsd: 1000 });
    expect(trend.monthVsPrevious).toMatchObject({ currentMonth: { month: "2026-11", created: 1 }, previousMonth: { month: "2026-10", created: 4, won: 1 }, createdChange: -3 });
  });

  it("detecta qué herramientas del vendedor necesita cada pregunta", () => {
    expect(sellerToolsFor("¿Qué debería hacer hoy?")).toEqual(["getSellerAgenda"]);
    expect(sellerToolsFor("¿Por qué perdí mis últimas oportunidades?")).toEqual(["getSellerClosedDeals"]);
    expect(sellerToolsFor("¿Voy mejor o peor que la semana pasada?")).toEqual(["getSellerTrend"]);
    expect(sellerToolsFor("¿Cómo voy contra mi cuota?")).toEqual(["getSellerPerformance"]);
    expect(sellerToolsFor("¿Cuál es la etapa de Vrf 2027?")).toEqual([]);
  });

  it("despacha cada herramienta y rechaza las desconocidas", async () => {
    const run = vi.fn().mockResolvedValue([]);
    const user = { id: 5, permissionSet: new Set() };
    expect((await readSellerTool({ toolName: "getSellerClosedDeals", user, run })).entityType).toBe("seller_closed_deals");
    expect((await readSellerTool({ toolName: "getSellerTrend", user, run })).entityType).toBe("seller_trend");
    expect((await readSellerTool({ toolName: "getSellerAgenda", user, run })).entityType).toBe("seller_agenda");
    expect(run.mock.calls.every(([sql, params]) => sql.includes("seller_user_id = ?") && params[0] === 5)).toBe(true);
    await expect(readSellerTool({ toolName: "nope", user, run })).rejects.toThrow(/desconocida/);
  });

  it("la comisión es la fila del propio vendedor del seguimiento de Planeación comercial", () => {
    const tracking = {
      period: { year: 2026, quarter: 4 },
      baseCurrencyCode: "USD",
      summaries: [
        { sellerUserId: 4, salesQuotaAmount: 500000, acceptedSalesAmount: 169882.21, quotaAttainmentPct: 33.98, commissionEnabled: false, productCommissionPct: 4, serviceCommissionPct: 6, renewalCommissionPct: 2,
          acceptedQuotationCount: 1, eligibleQuotationCount: 0, blockedLowMarginQuotationCount: 0, blockedByQuotaQuotationCount: 1, calculatedTotalCommissionAmount: 0,
          quotations: [{ proposalName: "P", accountName: "A", totalSaleAmount: 169882.21, quotationMarginPct: 22, passesMarginRule: true }] },
        { sellerUserId: 9, salesQuotaAmount: 1, acceptedSalesAmount: 9999, quotaAttainmentPct: 100, commissionEnabled: true, calculatedTotalCommissionAmount: 777 },
      ],
      pendingQuotations: [{ sellerUserId: 4, proposalName: "Q", accountName: "B", totalSaleAmount: 100 }, { sellerUserId: 9, proposalName: "Z", totalSaleAmount: 5 }],
    };
    const mine = shapeCommission({ tracking, sellerId: 4 });
    expect(mine).toMatchObject({
      hasCommissionData: true, enabled: false,
      quota: { amount: 500000, acceptedSales: 169882.21, attainmentPct: 33.98, requiredToEnable: 350000, missingToEnable: 180117.79 },
      percentages: { products: 4, services: 6, renewals: 2 },
      quotations: { accepted: 1, blockedByQuota: 1 }, commission: { total: 0 }, pendingAcceptance: { count: 1 },
    });
    expect(JSON.stringify(mine)).not.toMatch(/777|Z"/);
    expect(mine.rules.join(" ")).toContain("70%");
    expect(shapeCommission({ tracking, sellerId: 99 })).toMatchObject({ hasCommissionData: false });
  });

  it("busca el periodo del trimestre y, sin él, lo dice", async () => {
    const withPeriod = vi.fn().mockResolvedValue([{ id: 4 }]);
    const tracking = vi.fn().mockResolvedValue({ summaries: [], pendingQuotations: [] });
    await loadSellerCommission({ run: withPeriod, sellerId: 5, buildCommissionTracking: tracking, now: new Date(2026, 10, 1) });
    expect(withPeriod.mock.calls[0][1]).toEqual([2026, 4]);
    expect(tracking).toHaveBeenCalledWith(4);
    const none = await loadSellerCommission({ run: vi.fn().mockResolvedValue([]), sellerId: 5, buildCommissionTracking: tracking, now: new Date(2026, 10, 1) });
    expect(none).toMatchObject({ hasCommissionData: false });
    expect(sellerToolsFor("¿Cuánto llevo de comisión?")).toContain("getSellerCommission");
  });
});

describe("cotizaciones y biblioteca para Coach", () => {
  const quote = (status, extra = {}) => ({ status, version: 1, proposalName: "Propuesta", quotationDate: "2026-10-20", validity: "30_dias", opportunity: "Renovación", account: "Acme", opportunityAmountUsd: 1000, ...extra });

  it("agrupa por estado, calcula la vigencia y señala las que vencen pronto", () => {
    const result = shapeQuotations({ rows: [quote("enviada"), quote("enviada", { quotationDate: "2026-09-01" }), quote("borrador", { validity: "segun_notas" }), quote("rechazada")], today: "2026-11-15" });
    expect(result.byStatus).toEqual({ enviada: 2, borrador: 1, rechazada: 1 });
    expect(result.awaitingResponse.count).toBe(2);
    expect(result.awaitingResponse.items[0]).toMatchObject({ validUntil: "2026-11-19", daysLeft: 4, expiresSoon: true });
    expect(result.expiringSoon.map((item) => item.daysLeft)).toEqual([4, -45]);
    expect(result.drafts).toEqual({ count: 1 });
    expect(result.definitions.amounts).toContain("monto de su oportunidad");
  });

  it("consulta solo las oportunidades abiertas y activadas del vendedor", async () => {
    const run = vi.fn().mockResolvedValue([]);
    const result = await loadSellerQuotations({ run, sellerId: 5, today: "2026-11-15" });
    expect(run.mock.calls[0][0]).toContain("o.seller_user_id = ?");
    expect(run.mock.calls[0][0]).toContain("aas.code = 'activada'");
    expect(run.mock.calls[0][1]).toEqual([5]);
    expect(result.total).toBe(0);
  });

  const asset = (title, extra = {}) => ({ title, summary: "", usageNote: "", isActive: true, isExpired: false, isShareable: true, visibilityLevel: "client_safe", assetTypeLabel: "PDF", catalogs: [], tags: [], ...extra });

  it("recomienda por fabricante o etapa y no inventa cuando nada coincide", () => {
    const assets = [
      asset("Protección de APIs", { catalogs: [{ catalogType: "manufacturer", name: "F5 Networks" }] }),
      asset("Guía de cierre", { tags: [{ tagGroup: "stage", code: "negociacion" }], visibilityLevel: "internal", isShareable: false }),
      asset("Vencido F5", { isExpired: true, catalogs: [{ catalogType: "manufacturer", name: "F5 Networks" }] }),
    ];
    const byBrand = shapeLibraryMaterials({ assets, question: "material para F5", opportunity: null });
    expect(byBrand.materials.map((item) => item.title)).toEqual(["Protección de APIs"]);
    const byStage = shapeLibraryMaterials({ assets, question: "qué uso en esta etapa", opportunity: { name: "X", account: "Y", stageCode: "negociacion", stageName: "Negociación" } });
    expect(byStage.materials[0]).toMatchObject({ title: "Guía de cierre", audience: "Solo interno", matchedOn: ["Etapa actual"] });
    const none = shapeLibraryMaterials({ assets, question: "algo sin relación", opportunity: null });
    expect(none.materials).toEqual([]);
    expect(none.note).toContain("No encontré");
  });

  it("lee la biblioteca con el usuario y el contexto de la pregunta", async () => {
    const listAssets = vi.fn().mockResolvedValue({ items: [asset("Caso Bluecat", { catalogs: [{ catalogType: "manufacturer", name: "Bluecat Networks" }] })] });
    const user = { id: 5 };
    const result = await loadLibraryMaterials({ user, listAssets, question: "material de Bluecat", opportunity: null });
    expect(listAssets.mock.calls[0][0].user).toBe(user);
    expect(result.materials[0].title).toBe("Caso Bluecat");
  });

  it("enruta las preguntas de cotizaciones y material", () => {
    expect(sellerToolsFor("¿Qué cotizaciones tengo pendientes de respuesta?")).toContain("getSellerQuotations");
    expect(sellerToolsFor("¿Qué material puedo usar en esta etapa con Acme?")).toContain("getLibraryMaterials");
    expect(sellerToolsFor("¿Cuál es la etapa de Vrf 2027?")).toEqual([]);
  });

  it("distingue una petición directa de material de la biblioteca", () => {
    expect(asksForLibraryMaterial("¿Qué material puedo usar en esta etapa con Acme?")).toBe(true);
    expect(asksForLibraryMaterial("¿Hay algo en la biblioteca sobre F5?")).toBe(true);
    expect(asksForLibraryMaterial("¿Cuál es mi cuota?")).toBe(false);
    expect(asksForLibraryMaterial("¿Qué material de preparación debo revisar de la cuenta?")).toBe(false);
  });
});
