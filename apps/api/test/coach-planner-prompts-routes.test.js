import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/coach/planner-prompts.js", () => ({
  listPlannerPrompts: vi.fn(),
  savePlannerPrompt: vi.fn(),
}));
vi.mock("../src/audit.js", async (importOriginal) => ({
  ...(await importOriginal()),
  logAuditEvent: vi.fn(),
}));

import router from "../src/routes.mi-agent.js";
import { listPlannerPrompts, savePlannerPrompt } from "../src/coach/planner-prompts.js";
import { logAuditEvent } from "../src/audit.js";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = {
    id: 31,
    permissionSet: new Set(
      req.headers["x-admin"] === "yes" ? ["mi_coach.admin"] : ["mi_coach.use"],
    ),
  };
  next();
});
app.use("/api/mi-agent", router);
app.use((error, _req, res, _next) => {
  res.status(error.status || 500).json({ message: error.message });
});

describe("Planner prompt administrative endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listPlannerPrompts.mockResolvedValue([
      { channel: "customer_account", version: 0, connected: true },
    ]);
    savePlannerPrompt.mockResolvedValue({
      before: { channel: "customer_account", version: 0 },
      after: { channel: "customer_account", version: 1, instruction: "Prioriza lecturas." },
    });
    logAuditEvent.mockResolvedValue(null);
  });

  it("requires mi_coach.admin for reading and writing", async () => {
    await request(app).get("/api/mi-agent/coach/admin/planner-prompts").expect(403);
    await request(app).put("/api/mi-agent/coach/admin/planner-prompts/customer_account")
      .send({ instruction: "No guardar", expectedVersion: 0 }).expect(403);
    expect(listPlannerPrompts).not.toHaveBeenCalled();
    expect(savePlannerPrompt).not.toHaveBeenCalled();
  });

  it("returns configurations and saves an audited active version", async () => {
    const response = await request(app).get("/api/mi-agent/coach/admin/planner-prompts")
      .set("x-admin", "yes").expect(200);
    expect(response.body.prompts).toHaveLength(1);
    const saved = await request(app).put("/api/mi-agent/coach/admin/planner-prompts/customer_account")
      .set("x-admin", "yes")
      .send({ instruction: "Prioriza lecturas.", expectedVersion: 0 }).expect(200);
    expect(saved.body.prompt.version).toBe(1);
    expect(savePlannerPrompt).toHaveBeenCalledWith({
      channel: "customer_account",
      user: expect.objectContaining({ id: 31 }),
      input: { instruction: "Prioriza lecturas.", expectedVersion: 0 },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      module: "mi_coach",
      action: "mi_coach_planner_prompt_updated",
      before: expect.objectContaining({ version: 0 }),
      after: expect.objectContaining({ version: 1 }),
    }));
  });

  it.each([400, 409])("returns explicit validation/conflict errors (%i)", async (status) => {
    savePlannerPrompt.mockRejectedValueOnce(
      Object.assign(new Error("No se guardó"), { status, code: "planner_prompt_error" }),
    );
    const response = await request(app).put("/api/mi-agent/coach/admin/planner-prompts/customer_account")
      .set("x-admin", "yes").send({}).expect(status);
    expect(response.body).toEqual({ message: "No se guardó", code: "planner_prompt_error" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("surfaces storage errors instead of returning defaults or success", async () => {
    listPlannerPrompts.mockRejectedValueOnce(new Error("Storage unavailable"));
    await request(app).get("/api/mi-agent/coach/admin/planner-prompts")
      .set("x-admin", "yes").expect(500);
    savePlannerPrompt.mockRejectedValueOnce(new Error("Write failed"));
    await request(app).put("/api/mi-agent/coach/admin/planner-prompts/customer_account")
      .set("x-admin", "yes").send({}).expect(500);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
