import { describe, expect, it, vi } from "vitest";
import {
  buildSnapshotRows, captureWeeklySnapshots, hasSnapshotForWeek, loadSnapshots, mondayOf, shapeSellerSnapshots, shapeTeamSnapshots,
} from "../src/commercial-tracking/seller-snapshots.js";
import { readSellerSnapshots, sellerToolsFor, COACH_PERFORMANCE_TOOLS } from "../src/coach/performance-tools.js";

const league = {
  quarterContext: { current: { year: 2026, quarter: 4 } },
  leaderboard: [
    { sellerUserId: 5, sellerUserName: "Oscar", quotaAmountUsd: 500000, wonAmountUsd: 0, attainmentPct: 0, gapAmountUsd: 500000, openOpportunities: 5, funnelOpenAmountUsd: 148000, pipelineWeightedUsd: 48700, nextQuarterTimeWeightedOpenPipelineUsd: 193953.33, overdueCount: 1, noNextStepCount: 4, scoreTotal: 2.06, scoreClosing: 0, scoreBuild: 6.88, scoreDiscipline: 0, rankPosition: 5 },
    { sellerUserId: 4, sellerUserName: "Jacob", quotaAmountUsd: 500000, wonAmountUsd: 169882, attainmentPct: 33.98, gapAmountUsd: 330118, openOpportunities: 3, funnelOpenAmountUsd: 90000, pipelineWeightedUsd: 30000, overdueCount: 0, noNextStepCount: 0, scoreTotal: 61.2, rankPosition: 1 },
    { sellerUserId: 0, sellerUserName: "Sin id", rankPosition: 9 },
  ],
};

const row = (week, extra = {}) => ({
  weekStart: week, sellerUserId: 5, sellerName: "Oscar", quarterYear: 2026, quarterNumber: 4, quotaAmountUsd: 500000, wonAmountUsd: 0, attainmentPct: 0, gapAmountUsd: 500000,
  openPipelineCount: 13, openPipelineUsd: 362000, quarterPipelineCount: 5, quarterPipelineUsd: 148000, quarterWeightedUsd: 48700, nextQuarterWeightedUsd: 0, overdueCount: 1,
  noNextStepCount: 4, scoreTotal: 2, scoreClosing: 0, scoreBuild: 6, scoreDiscipline: 0, rankPosition: 5, teamSize: 5, capturedAt: "x", ...extra,
});

describe("fotos semanales de Ritmo comercial", () => {
  it("calcula el lunes de la semana", () => {
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(mondayOf(new Date(2026, 10, 4, 15))).toBe("2026-11-02");
  });

  it("convierte la liga y el pipeline abierto en una fila por vendedor", () => {
    const rows = buildSnapshotRows({ league, openBySeller: new Map([[5, { count: 13, amountUsd: 362000 }]]), weekStart: "2026-11-02" });
    expect(rows.map((item) => item.sellerUserId)).toEqual([5, 4]);
    expect(rows[0]).toMatchObject({ openPipelineCount: 13, openPipelineUsd: 362000, quarterPipelineUsd: 148000, quarterWeightedUsd: 48700, rankPosition: 5, teamSize: 3, quarterYear: 2026, quarterNumber: 4 });
    expect(rows[1]).toMatchObject({ openPipelineCount: 0, openPipelineUsd: 0, scoreDiscipline: null });
  });

  it("guarda con upsert, por semana, para que repetir la captura no duplique", async () => {
    const run = vi.fn().mockResolvedValue([]);
    const buildLeague = vi.fn().mockResolvedValue(league);
    const result = await captureWeeklySnapshots({ buildLeague, run, now: new Date(2026, 10, 4, 9) });
    expect(result).toEqual({ weekStart: "2026-11-02", sellers: 2 });
    expect(buildLeague.mock.calls[0][0]).toMatchObject({ forceGlobalScope: true });
    const inserts = run.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO seller_weekly_snapshots"));
    expect(inserts).toHaveLength(2);
    expect(inserts[0][0]).toContain("ON DUPLICATE KEY UPDATE");
    expect(inserts[0][1][0]).toBe("2026-11-02");
  });

  it("sabe si la semana ya tiene foto", async () => {
    expect(await hasSnapshotForWeek({ run: vi.fn().mockResolvedValue([{ total: 2 }]), now: new Date(2026, 10, 4) })).toBe(true);
    expect(await hasSnapshotForWeek({ run: vi.fn().mockResolvedValue([{ total: 0 }]), now: new Date(2026, 10, 4) })).toBe(false);
  });

  it("lee solo los vendedores pedidos", async () => {
    const run = vi.fn().mockResolvedValue([]);
    await loadSnapshots({ run, sellerIds: [5], now: new Date(2026, 10, 4) });
    const readCall = run.mock.calls.find(([sql]) => String(sql).includes("SELECT * FROM seller_weekly_snapshots"));
    expect(readCall[0]).toContain("seller_user_id IN (?)");
    expect(readCall[1]).toEqual(["2026-08-17", 5]);
    expect(await loadSnapshots({ run: vi.fn().mockResolvedValue([]), sellerIds: [] })).toEqual([]);
  });

  it("compara con la semana anterior y con hace cuatro semanas", () => {
    const shaped = shapeSellerSnapshots([
      row("2026-11-02", { openPipelineUsd: 400000, rankPosition: 3, scoreTotal: 12 }),
      row("2026-10-05", { openPipelineUsd: 300000, rankPosition: 4, scoreTotal: 8 }),
      row("2026-10-26", { openPipelineUsd: 380000, rankPosition: 3, scoreTotal: 10 }),
    ]);
    expect(shaped.weeksAvailable).toBe(3);
    expect(shaped.series.map((point) => point.weekStart)).toEqual(["2026-10-05", "2026-10-26", "2026-11-02"]);
    expect(shaped.vsPreviousWeek).toMatchObject({ fromWeek: "2026-10-26", toWeek: "2026-11-02", sameQuarter: true });
    expect(shaped.vsPreviousWeek.changes).toMatchObject({ openPipelineUsd: { from: 380000, to: 400000, change: 20000 }, rankPosition: { change: 0 }, scoreTotal: { from: 10, to: 12, change: 2 } });
    expect(shaped.vsFourWeeksAgo.changes).toMatchObject({ openPipelineUsd: { from: 300000, change: 100000 }, rankPosition: { change: -1 }, scoreTotal: { change: 4 } });
  });

  it("avisa cuando cruza de trimestre y cuando no hay semana de comparación", () => {
    const shaped = shapeSellerSnapshots([row("2026-09-28", { quarterNumber: 3 }), row("2026-10-05")]);
    expect(shaped.vsPreviousWeek.sameQuarter).toBe(false);
    expect(shaped.vsFourWeeksAgo).toBeNull();
    expect(shapeSellerSnapshots([])).toMatchObject({ weeksAvailable: 0, vsPreviousWeek: null, latestWeek: null });
  });

  it("ordena el equipo por lugar", () => {
    const team = shapeTeamSnapshots([row("2026-11-02", { rankPosition: 5 }), row("2026-11-02", { sellerUserId: 4, sellerName: "Jacob", rankPosition: 1 })]);
    expect(team.map((item) => item.seller)).toEqual(["Jacob", "Oscar"]);
  });
});

describe("herramienta getSellerSnapshots", () => {
  const rows = [row("2026-10-26", { openPipelineUsd: 340000 }), row("2026-11-02"), row("2026-11-02", { sellerUserId: 4, sellerName: "Jacob", rankPosition: 1 })];

  it("se declara de solo lectura con el permiso de Ritmo comercial", () => {
    expect(COACH_PERFORMANCE_TOOLS.find((tool) => tool.name === "getSellerSnapshots")).toMatchObject({ requiredPermission: "ritmo_comercial.read", readOnly: true });
  });

  it("un vendedor sin acceso global pide solo su historia", async () => {
    const loadSnapshotsMock = vi.fn().mockResolvedValue(rows.filter((item) => item.sellerUserId === 5));
    const result = await readSellerSnapshots({ user: { id: 5, permissionSet: new Set(["ritmo_comercial.read"]) }, loadSnapshots: loadSnapshotsMock });
    expect(loadSnapshotsMock).toHaveBeenCalledWith({ sellerIds: [5] });
    expect(result.team).toBeUndefined();
    expect(result.mine.vsPreviousWeek.changes.openPipelineUsd.change).toBe(22000);
    expect(result.definitions.scope).toContain("Solo tu historia");
  });

  it("con ritmo_comercial.read_all también entrega al equipo", async () => {
    const loadSnapshotsMock = vi.fn().mockResolvedValue(rows);
    const result = await readSellerSnapshots({ user: { id: 5, permissionSet: new Set(["ritmo_comercial.read", "ritmo_comercial.read_all"]) }, loadSnapshots: loadSnapshotsMock });
    expect(loadSnapshotsMock).toHaveBeenCalledWith({ sellerIds: null });
    expect(result.team.map((item) => item.seller)).toEqual(["Jacob", "Oscar"]);
  });

  it("dice que falta historia cuando hay una sola foto", async () => {
    const result = await readSellerSnapshots({ user: { id: 5, permissionSet: new Set() }, loadSnapshots: vi.fn().mockResolvedValue([rows[1]]) });
    expect(result.note).toContain("Aún no hay suficiente historia");
    expect(result.mine.vsPreviousWeek).toBeNull();
  });

  it("enruta preguntas de evolución y no las de valor actual", () => {
    expect(sellerToolsFor("¿Mi pipeline subió o bajó frente al mes pasado?")).toContain("getSellerSnapshots");
    expect(sellerToolsFor("¿Cómo va mi puntuación frente a hace 4 semanas?")).toContain("getSellerSnapshots");
    expect(sellerToolsFor("¿Cuál es la etapa de Vrf 2027?")).not.toContain("getSellerSnapshots");
    expect(sellerToolsFor("¿Cómo voy contra mi cuota?")).not.toContain("getSellerSnapshots");
  });
});
