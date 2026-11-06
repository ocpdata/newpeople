import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/variable-compensation/service.js", () => ({
  VariableRulesConflictError: class extends Error { status = 409; },
  buildVariableDashboard: vi.fn(async (period) => ({ status: "ok", period })),
  currentBusinessQuarter: () => ({ year: 2026, quarter: 4 }),
  getVariableRules: vi.fn(async () => ({ rules: {}, validated: false, version: 0 })),
  saveVariableRules: vi.fn(async () => ({ rules: {}, validated: true, version: 1 })),
}));
import router from "../src/routes.variable-compensation.js";
import { buildVariableDashboard, saveVariableRules } from "../src/variable-compensation/service.js";
import {
  DEFAULT_VARIABLE_RULES as RULES, calculateVariable, evaluateGrowth, evaluateNewClients, validateVariableRules,
} from "../../../shared/variable-compensation.js";

const pay = (input) => calculateVariable(RULES, { sellersInQuota: 0, newClientsMet: false, existingAccountsMet: false, marginPct: 36, ...input });
const component = (result, key) => result.components.find((item) => item.key === key);

describe("variable comercial: fórmula", () => {
  it("reproduce el escenario del mockup (73.5% de cuota, 33.7% de margen)", () => {
    const result = pay({ attainmentPct: 73.4778, marginPct: 33.7142, sellersInQuota: 1 });
    expect(component(result, "quota").pay).toBeCloseTo(37564.44, 1);
    expect(component(result, "margin").pay).toBe(25000);
    expect(result.total).toBeCloseTo(62564.44, 1);
    expect(result.fullActivation).toBe(false);
  });

  it("reproduce el escenario con pipeline del mockup (91.7% de cuota)", () => {
    const result = pay({ attainmentPct: 91.7, marginPct: 33.7142, sellersInQuota: 1 });
    expect(component(result, "quota").pay).toBeCloseTo(66720, 5);
    expect(result.total).toBeCloseTo(91720, 5);
  });

  it.each([
    [69.99, 0], [70, 32000], [80, 48000], [100, 80000],
  ])("paga cuota en el borde %s%% con %s", (attainmentPct, expected) => {
    expect(component(pay({ attainmentPct }), "quota").pay).toBeCloseTo(expected, 1);
  });

  it("activa equipo y crecimientos solo desde 80%", () => {
    const below = pay({ attainmentPct: 79.99, sellersInQuota: 5, newClientsMet: true, existingAccountsMet: true });
    expect(below.components.filter((item) => ["team", "newClients", "existingAccounts"].includes(item.key)).map((item) => item.pay)).toEqual([0, 0, 0]);
    const at = pay({ attainmentPct: 80, sellersInQuota: 5, newClientsMet: true, existingAccountsMet: true });
    expect(at.components.filter((item) => ["team", "newClients", "existingAccounts"].includes(item.key)).map((item) => item.pay)).toEqual([30000, 20000, 20000]);
  });

  it.each([[31.99, 0], [32, 25000], [34.99, 25000], [35, 50000]])("paga margen %s%% con %s", (marginPct, expected) => {
    expect(component(pay({ attainmentPct: 100, marginPct }), "margin").pay).toBe(expected);
  });

  it("no paga margen bajo el piso de cuota aunque el margen sea alto", () => {
    const margin = component(pay({ attainmentPct: 69, marginPct: 50 }), "margin");
    expect(margin).toMatchObject({ pay: 0, state: "ok", locked: true });
  });

  it("limita el acelerador a 80,000 con margen bajo 32% y a 2x como máximo", () => {
    expect(component(pay({ attainmentPct: 120, marginPct: 31.9 }), "quota").pay).toBe(80000);
    expect(component(pay({ attainmentPct: 105, marginPct: 32 }), "quota").pay).toBeCloseTo(92000, 5);
    expect(component(pay({ attainmentPct: 150, marginPct: 40 }), "quota").pay).toBe(160000);
  });

  it("paga por niveles de equipo y aplica el tope trimestral", () => {
    expect([2, 3, 4, 5].map((sellersInQuota) => component(pay({ attainmentPct: 90, sellersInQuota }), "team").pay)).toEqual([0, 9000, 18000, 30000]);
    const maximum = pay({ attainmentPct: 150, marginPct: 40, sellersInQuota: 5, newClientsMet: true, existingAccountsMet: true });
    expect(maximum.rawTotal).toBe(280000);
    const lowCap = calculateVariable({ ...RULES, quarterlyCap: 200000 }, { attainmentPct: 150, marginPct: 40, sellersInQuota: 5, newClientsMet: true, existingAccountsMet: true });
    expect(lowCap).toMatchObject({ total: 200000, capped: true });
  });

  it("marca sin datos lo que no se puede evaluar y no paga sin ventas", () => {
    const result = pay({ attainmentPct: 90, newClientsMet: null, existingAccountsMet: null });
    expect(component(result, "newClients")).toMatchObject({ pay: 0, state: "off" });
    expect(component(result, "existingAccounts")).toMatchObject({ pay: 0, state: "off" });
    expect(calculateVariable(RULES, { attainmentPct: 0, marginPct: null, sellersInQuota: 0 }).total).toBe(0);
  });
});

describe("variable comercial: clientes nuevos y cuentas actuales", () => {
  it("exige monto y cantidad de clientes que superan el mínimo individual", () => {
    const base = { newSalesAmount: 300000, quotaAmount: 2500000 };
    expect(evaluateNewClients(RULES, { ...base, accountAmounts: [100000, 100000, 100000] })).toMatchObject({
      requiredAmount: 250000, clientMinAmount: 16750, amountMet: true, clientsMet: true, met: true,
    });
    expect(evaluateNewClients(RULES, { ...base, accountAmounts: [200000, 100000] }).met).toBe(false);
    expect(evaluateNewClients(RULES, { newSalesAmount: 100000, quotaAmount: 2500000, accountAmounts: [40000, 30000, 30000] }).met).toBe(false);
  });

  it("calcula el crecimiento y distingue la falta de base de comparación", () => {
    expect(evaluateGrowth(RULES, { currentAmount: 110, baselineAmount: 100 })).toMatchObject({ available: true, growthPct: 10, met: true });
    expect(evaluateGrowth(RULES, { currentAmount: 109, baselineAmount: 100 }).met).toBe(false);
    expect(evaluateGrowth(RULES, { currentAmount: 50, baselineAmount: null })).toMatchObject({ available: false, met: null });
    expect(evaluateGrowth(RULES, { currentAmount: 50, baselineAmount: 0 }).available).toBe(false);
  });
});

describe("variable comercial: validación de reglas", () => {
  const clone = () => structuredClone(RULES);
  it("acepta las reglas por defecto", () => {
    expect(validateVariableRules(clone())).toMatchObject({ ok: true });
  });
  it.each([
    ["umbrales de cuota desordenados", (rules) => { rules.quota.floorPct = 90; }],
    ["margen parcial mayor al completo", (rules) => { rules.margin.partialPct = 40; }],
    ["niveles de equipo repetidos", (rules) => { rules.team.tiers.push({ minSellers: 3, pay: 1 }); }],
    ["montos negativos", (rules) => { rules.quota.basePay = -1; }],
    ["moneda inválida", (rules) => { rules.payCurrencyCode = "peso"; }],
    ["tope no numérico", (rules) => { rules.quarterlyCap = "280000"; }],
  ])("rechaza %s", (_name, mutate) => {
    const rules = clone();
    mutate(rules);
    expect(validateVariableRules(rules).ok).toBe(false);
  });
});

describe("variable comercial: rutas", () => {
  const app = (permissions) => {
    const instance = express();
    instance.use(express.json(), (req, _res, next) => { req.user = { id: 1, permissionSet: new Set(permissions) }; next(); });
    instance.use("/api/variable-compensation", router);
    instance.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));
    return instance;
  };
  beforeEach(() => vi.clearAllMocks());

  it("niega el acceso sin permiso", async () => {
    await request(app([])).get("/api/variable-compensation").expect(403);
  });

  it("consulta el trimestre vigente por defecto y el solicitado", async () => {
    await request(app(["variable_comercial.read"])).get("/api/variable-compensation").expect(200);
    expect(buildVariableDashboard).toHaveBeenLastCalledWith({ year: 2026, quarter: 4 });
    await request(app(["variable_comercial.read"])).get("/api/variable-compensation?year=2026&quarter=2").expect(200);
    expect(buildVariableDashboard).toHaveBeenLastCalledWith({ year: 2026, quarter: 2 });
    await request(app(["variable_comercial.read"])).get("/api/variable-compensation?quarter=5").expect(400);
  });

  it("solo permite editar reglas con permiso de actualización", async () => {
    const body = { rules: RULES, validated: true, version: 0 };
    await request(app(["variable_comercial.read"])).put("/api/variable-compensation/rules").send(body).expect(403);
    await request(app(["variable_comercial.update"])).put("/api/variable-compensation/rules").send(body).expect(200);
    expect(saveVariableRules).toHaveBeenCalledTimes(1);
    await request(app(["variable_comercial.update"])).put("/api/variable-compensation/rules").send({ rules: RULES }).expect(400);
  });
});
