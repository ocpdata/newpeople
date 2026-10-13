import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/coach/semantic-classifier-prompts.js", () => ({
  listSemanticClassifierPrompts: vi.fn(),
  saveSemanticClassifierPrompt: vi.fn(),
  restoreSemanticClassifierPrompt: vi.fn(),
}));
vi.mock("../src/audit.js", async (importOriginal) => ({
  ...(await importOriginal()), logAuditEvent: vi.fn(),
}));
import router from "../src/routes.mi-agent.js";
import {
  listSemanticClassifierPrompts,
  saveSemanticClassifierPrompt,
  restoreSemanticClassifierPrompt,
} from "../src/coach/semantic-classifier-prompts.js";
import { logAuditEvent } from "../src/audit.js";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 31, permissionSet: new Set(
    req.headers["x-admin"] === "yes" ? ["mi_coach.admin"] : ["mi_coach.use"],
  ) };
  next();
});
app.use("/api/mi-agent", router);
app.use((error, _req, res, _next) => {
  res.status(error.status || 500).json({ message: error.message });
});
const endpoint = "/api/mi-agent/coach/admin/semantic-classifier-prompts";

describe("B3 administrative endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listSemanticClassifierPrompts.mockResolvedValue([
      { channel: "coach", connected: false },
      { channel: "customer_account", connected: true },
      { channel: "prospect", connected: false },
    ]);
    const result = {
      before: { channel: "customer_account", version: 1 },
      after: { channel: "customer_account", version: 2, instruction: "Lecturas", connected: true },
    };
    saveSemanticClassifierPrompt.mockResolvedValue(result);
    restoreSemanticClassifierPrompt.mockResolvedValue(result);
    logAuditEvent.mockResolvedValue(null);
  });

  it("requires administration for reading, writing and restoring", async () => {
    await request(app).get(endpoint).expect(403);
    await request(app).put(`${endpoint}/customer_account`).send({}).expect(403);
    await request(app).post(`${endpoint}/coach/revisions/1/restore`).send({}).expect(403);
    expect(listSemanticClassifierPrompts).not.toHaveBeenCalled();
    expect(saveSemanticClassifierPrompt).not.toHaveBeenCalled();
    expect(restoreSemanticClassifierPrompt).not.toHaveBeenCalled();
  });

  it("lists channels and audits saved and restored versions", async () => {
    const listed = await request(app).get(endpoint).set("x-admin", "yes").expect(200);
    expect(listed.body.prompts.filter((prompt) => prompt.connected)).toHaveLength(1);
    await request(app).put(`${endpoint}/customer_account`).set("x-admin", "yes")
      .send({ instruction: "Lecturas", expectedVersion: 1 }).expect(200);
    expect(saveSemanticClassifierPrompt).toHaveBeenCalledWith({
      channel: "customer_account", user: expect.objectContaining({ id: 31 }),
      input: { instruction: "Lecturas", expectedVersion: 1 },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "mi_coach_semantic_classifier_prompt_updated",
      before: expect.objectContaining({ version: 1 }),
      after: expect.objectContaining({ version: 2 }),
    }));
    await request(app).post(`${endpoint}/customer_account/revisions/1/restore`)
      .set("x-admin", "yes").send({ expectedVersion: 1 }).expect(200);
    expect(restoreSemanticClassifierPrompt).toHaveBeenCalledWith({
      channel: "customer_account", revisionVersion: 1,
      user: expect.objectContaining({ id: 31 }), input: { expectedVersion: 1 },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "mi_coach_semantic_classifier_prompt_restored",
    }));
  });

  it.each([400, 404, 409])("returns explicit configuration errors (%i)", async (status) => {
    saveSemanticClassifierPrompt.mockRejectedValueOnce(Object.assign(
      new Error("No se guardó"), { status, code: "classifier_prompt_error" },
    ));
    const response = await request(app).put(`${endpoint}/customer_account`)
      .set("x-admin", "yes").send({}).expect(status);
    expect(response.body).toEqual({ message: "No se guardó", code: "classifier_prompt_error" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("surfaces storage failures without claiming success", async () => {
    listSemanticClassifierPrompts.mockRejectedValueOnce(new Error("Storage unavailable"));
    await request(app).get(endpoint).set("x-admin", "yes").expect(500);
    restoreSemanticClassifierPrompt.mockRejectedValueOnce(new Error("Restore unavailable"));
    await request(app).post(`${endpoint}/coach/revisions/1/restore`)
      .set("x-admin", "yes").send({ expectedVersion: 1 }).expect(500);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
