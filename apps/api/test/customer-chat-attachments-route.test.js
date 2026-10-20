import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DOCUMENT_FORMATS } from "../../../shared/document-formats.js";

const mocks = vi.hoisted(() => ({
  create: vi.fn(), process: vi.fn(), cleanup: vi.fn(),
}));
vi.mock("../src/commercial-intelligence/permissions.js", () => ({
  ensureCommercialIntelligencePermissions: vi.fn(),
}));
vi.mock("../src/commercial-intelligence/schema.js", () => ({
  ensureCommercialIntelligenceSchema: vi.fn(),
}));
vi.mock("../src/commercial-intelligence/service.js", async (importOriginal) => ({
  ...await importOriginal(),
  createCustomerAccountChatJob: mocks.create,
  processCustomerAccountChatJob: mocks.process,
}));
vi.mock("../src/opportunity-documents/service.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, cleanupTempFiles: mocks.cleanup.mockImplementation(actual.cleanupTempFiles) };
});
import router from "../src/routes.commercial-intelligence.js";
const user = {
  id: 7,
  permissionSet: new Set(["mi_coach.access", "inteligencia_comercial.access", "inteligencia_comercial.read"]),
};
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = user; next(); });
app.use(router);
const payload = JSON.stringify({ accountId: 160, question: "Resume el adjunto", chatSessionId: 920 });

describe("Customer chat attachment uploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ job: { id: 921, status: "pending" } });
    mocks.process.mockResolvedValue(null);
  });
  it.each(Object.entries(DOCUMENT_FORMATS))("queues %s for extraction without creating a repository document", async (extension, format) => {
    const response = await request(app).post("/account-chat/jobs")
      .field("payload", payload)
      .attach("attachment", Buffer.from("contenido"), { filename: `archivo${extension}`, contentType: format.mimeTypes[0] })
      .expect(202);
    expect(response.body.job.id).toBe(921);
    expect(mocks.create).toHaveBeenCalledWith({
      user,
      payload: expect.objectContaining({
        accountId: 160,
        attachment: expect.objectContaining({ extension, kind: format.kind, name: `archivo${extension}` }),
      }),
    });
    await vi.waitFor(() => expect(mocks.cleanup).toHaveBeenCalled());
  });
  it("rejects MIME mismatches before creating a job", async () => {
    const response = await request(app).post("/account-chat/jobs")
      .field("payload", payload)
      .attach("attachment", Buffer.from("contenido"), { filename: "archivo.pdf", contentType: "image/png" })
      .expect(400);
    expect(response.body.message).toContain("no coincide");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.cleanup).toHaveBeenCalled();
  });
  it.each([".ppt", ".pptx", ".mp4", ".zip"])("does not enable %s in chat", async (extension) => {
    await request(app).post("/account-chat/jobs")
      .field("payload", payload)
      .attach("attachment", Buffer.from("contenido"), { filename: `archivo${extension}` })
      .expect(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects multiple attachments", async () => {
    const response = await request(app).post("/account-chat/jobs")
      .field("payload", payload)
      .attach("attachment", Buffer.from("a"), "a.txt")
      .attach("attachment", Buffer.from("b"), "b.txt").expect(400);
    expect(response.body.message).toContain("un solo");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects oversized text before creating a job", async () => {
    await request(app).post("/account-chat/jobs")
      .field("payload", payload)
      .attach("attachment", Buffer.alloc(2 * 1024 * 1024 + 1, "a"), { filename: "large.txt", contentType: "text/plain" })
      .expect(400);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.cleanup).toHaveBeenCalled();
  });
  it("rejects empty uploads as invalid input rather than a server failure", async () => {
    await request(app).post("/account-chat/jobs")
      .field("payload", payload)
      .attach("attachment", Buffer.alloc(0), { filename: "empty.pdf", contentType: "application/pdf" })
      .expect(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("preserves the chat read permission requirement", async () => {
    user.permissionSet.delete("inteligencia_comercial.read");
    try {
      await request(app).post("/account-chat/jobs").send(JSON.parse(payload)).expect(403);
      expect(mocks.create).not.toHaveBeenCalled();
    } finally {
      user.permissionSet.add("inteligencia_comercial.read");
    }
  });
  it("keeps question-only requests working", async () => {
    await request(app).post("/account-chat/jobs").send(JSON.parse(payload)).expect(202);
    expect(mocks.create.mock.calls[0][0].payload.attachment).toBeUndefined();
    await vi.waitFor(() => expect(mocks.process).toHaveBeenCalled());
  });
});
