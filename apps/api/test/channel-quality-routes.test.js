import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getOverview = vi.fn();
const runMonitor = vi.fn();
vi.mock("../src/channel-quality/store.js", () => ({ getChannelQualityOverview: (...args) => getOverview(...args) }));
vi.mock("../src/channel-quality/production-monitor.js", () => ({ runChannelProductionMonitor: (...args) => runMonitor(...args) }));

const { default: router } = await import("../src/channel-quality/routes.js");

const permissions = (...codes) => ({ status: "active", permissionSet: new Set(codes) });
function appFor(user) {
  const app = express();
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use("/api/mi-agent/channel-quality", router);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ message: err.message }));
  return app;
}
const reader = permissions("mi_coach.access", "mi_coach.evaluations_read");
const executor = permissions("mi_coach.access", "mi_coach.evaluations_read", "mi_coach.evaluations_execute");

describe("rutas de calidad por canal", () => {
  beforeEach(() => { getOverview.mockReset(); runMonitor.mockReset(); });

  it("devuelve la tendencia de Coach y Cuenta nueva a quien puede leer evaluaciones", async () => {
    getOverview.mockResolvedValue({ channel: "coach", days: 30, runs: [], latest: {} });
    const response = await request(appFor(reader)).get("/api/mi-agent/channel-quality/coach?days=30");
    expect(response.status).toBe(200);
    expect(getOverview).toHaveBeenCalledWith({ channel: "coach", days: 30 });
    const prospect = await request(appFor(reader)).get("/api/mi-agent/channel-quality/prospect");
    expect(prospect.status).toBe(200);
    expect(getOverview).toHaveBeenLastCalledWith({ channel: "prospect", days: 90 });
  });

  it("no expone Cliente existente ni canales desconocidos", async () => {
    const response = await request(appFor(reader)).get("/api/mi-agent/channel-quality/customer_account");
    expect(response.status).toBe(404);
    expect(getOverview).not.toHaveBeenCalled();
  });

  it("exige permiso de lectura y de ejecución", async () => {
    const withoutPermission = await request(appFor(permissions("mi_coach.access"))).get("/api/mi-agent/channel-quality/coach");
    expect(withoutPermission.status).toBe(403);
    const readerSnapshot = await request(appFor(reader)).post("/api/mi-agent/channel-quality/coach/production-snapshot");
    expect(readerSnapshot.status).toBe(403);
    expect(runMonitor).not.toHaveBeenCalled();
  });

  it("actualiza el monitoreo de producción de un canal bajo demanda", async () => {
    runMonitor.mockResolvedValue({ id: 3, status: "passed" });
    const response = await request(appFor(executor)).post("/api/mi-agent/channel-quality/prospect/production-snapshot");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ run: { id: 3, status: "passed" } });
    expect(runMonitor).toHaveBeenCalledWith({ channel: "prospect", force: true, trigger: "manual" });
  });

  it("rechaza un rango de días inválido", async () => {
    const response = await request(appFor(reader)).get("/api/mi-agent/channel-quality/coach?days=9999");
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(getOverview).not.toHaveBeenCalled();
  });
});
