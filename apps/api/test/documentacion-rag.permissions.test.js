import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getBootstrapMock,
  ensurePermissionsMock,
  ensureSchemaMock,
} = vi.hoisted(() => ({
  getBootstrapMock: vi.fn(),
  ensurePermissionsMock: vi.fn(),
  ensureSchemaMock: vi.fn(),
}));

vi.mock("../src/documentacion-rag/permissions.js", () => ({
  ensureDocumentacionRagPermissions: ensurePermissionsMock,
}));
vi.mock("../src/documentacion-rag/schema.js", () => ({
  ensureDocumentacionRagSchema: ensureSchemaMock,
}));
vi.mock("../src/documentacion-rag/service.js", () => ({
  createDocumentacionRagTopic: vi.fn(),
  deleteDocumentacionRagDocument: vi.fn(),
  deleteDocumentacionRagTopic: vi.fn(),
  getDocumentacionRagBootstrap: getBootstrapMock,
  getDocumentacionRagUploadLimits: vi.fn(() => ({
    maxFileBytes: 1024,
    allowedExtensions: [".pdf"],
  })),
  replaceDocumentacionRagDocument: vi.fn(),
  updateDocumentacionRagSummary: vi.fn(),
  updateDocumentacionRagTopic: vi.fn(),
  uploadDocumentacionRagDocument: vi.fn(),
}));

import documentacionRagRoutes from "../src/routes.documentacion-rag.js";

function createTestApp(permissionCodes) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { permissionSet: new Set(permissionCodes), id: 1 };
    next();
  });
  app.use("/api/documentacion-rag", documentacionRagRoutes);
  return app;
}

describe("Documentación RAG route permissions", () => {
  beforeEach(() => {
    getBootstrapMock.mockReset().mockResolvedValue({
      topics: [],
      documents: [],
      pineconeConfigured: true,
    });
    ensurePermissionsMock.mockReset().mockResolvedValue();
    ensureSchemaMock.mockReset().mockResolvedValue();
  });

  it("permite al permiso access consultar la biblioteca", async () => {
    const response = await request(
      createTestApp(["documentacion_rag.access"]),
    ).get("/api/documentacion-rag/bootstrap");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      topics: [],
      documents: [],
      uploadLimits: { allowedExtensions: [".pdf"] },
    });
  });

  it("permite al permiso manage consultar aunque no tenga access separado", async () => {
    const response = await request(
      createTestApp(["documentacion_rag.manage"]),
    ).get("/api/documentacion-rag/bootstrap");

    expect(response.status).toBe(200);
  });

  it("deniega el acceso a quien no tenga access ni manage", async () => {
    const response = await request(createTestApp([])).get(
      "/api/documentacion-rag/bootstrap",
    );

    expect(response.status).toBe(403);
  });

  it("impide que access-only administre temas", async () => {
    const response = await request(
      createTestApp(["documentacion_rag.access"]),
    )
      .post("/api/documentacion-rag/topics")
      .send({ name: "Nuevo tema" });

    expect(response.status).toBe(403);
  });
});
