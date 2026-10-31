import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), settings: vi.fn(), loadOperation: vi.fn(), ownSession: vi.fn(),
  outcome: vi.fn(), record: vi.fn(), transition: vi.fn(),
}));
vi.mock("../src/db.js", () => ({ query: vi.fn(async () => []), pool: {}, withTransaction: vi.fn() }));
vi.mock("../src/coach/controlled-operation-service.js", async (importOriginal) => ({
  ...await importOriginal(), executeControlledCoachOperation: mocks.execute,
}));
vi.mock("../src/coach/service.js", async (importOriginal) => ({
  ...await importOriginal(), transitionCoachOperation: mocks.transition,
}));
vi.mock("../src/commercial-intelligence/service.js", async (importOriginal) => ({
  ...await importOriginal(), getMiCoachGovernanceSettings: mocks.settings,
}));
vi.mock("../src/commercial-intelligence/operation-outcomes.js", async (importOriginal) => ({
  ...await importOriginal(),
  loadOwnPersistedOperation: mocks.loadOperation, ownChatSession: mocks.ownSession,
  getChatOperationOutcome: mocks.outcome, recordChatOperationOutcome: mocks.record,
}));
import router from "../src/routes.mi-agent.js";
import { CoachOperationError } from "../src/coach/controlled-operation-service.js";
import {
  chatOperationSignature, inChatConfirmationBlock, isInChatConfirmable,
} from "../src/coach/chat-confirmation.js";

const user = { id: 7, permissionSet: new Set([
  "mi_coach.access", "mi_coach.execute", "inteligencia_comercial.access", "inteligencia_comercial.read",
  "oportunidades.read", "oportunidades.update", "cuentas.read",
]) };
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = user; next(); });
app.use(router);
app.use((error, _req, res, _next) => res.status(500).json({ message: error.message }));

const fieldOperation = {
  kind: "opportunity_field", sourceChannel: "customer_account", opportunityId: 300, accountId: 160,
  field: "amountUsd", currentValue: 1000, value: 5000, title: "Actualizar monto",
};
const noteOperation = {
  kind: "opportunity_note", sourceChannel: "customer_account", opportunityId: 300, accountId: 160,
  noteText: "El cliente pidió revisar el alcance.", sourceType: "chat_report",
};
const body = (extra = {}) => ({ version: 3, idempotencyKey: "key-1", confirmedVia: "customer_chat", chatSessionId: 55, ...extra });
const execute = (extra) => request(app).post("/coach/operations/900/execute").send(body(extra));

describe("firma y alcance de la confirmación desde el chat", () => {
  it("solo admite notas y los campos de texto permitidos de oportunidad, cuenta y contacto", () => {
    expect(isInChatConfirmable(noteOperation)).toBe(true);
    for (const field of ["name", "amountUsd", "closeDate"]) expect(isInChatConfirmable({ ...fieldOperation, field })).toBe(true);
    for (const field of ["name", "phone", "website", "city", "stateRegion", "companyDescription"]) {
      expect(isInChatConfirmable({ ...fieldOperation, kind: "account_field", field })).toBe(true);
    }
    for (const field of ["firstName", "lastName", "email", "mobile", "phone", "positionTitle", "department", "city", "stateRegion"]) {
      expect(isInChatConfirmable({ ...fieldOperation, kind: "contact_field", field })).toBe(true);
    }
    // Fields that hold catalog ids, or are not allowed for the kind, stay in the Coach.
    for (const field of ["hierarchyLevelId", "relationshipTypeId", "influenceLevelId", "managerContactId", "influencesContactId"]) {
      expect(isInChatConfirmable({ ...fieldOperation, kind: "contact_field", field })).toBe(false);
    }
    expect(isInChatConfirmable({ ...fieldOperation, field: "stageId" })).toBe(false);
    expect(isInChatConfirmable({ ...fieldOperation, field: "" })).toBe(false);
    expect(isInChatConfirmable({ ...fieldOperation, kind: "account_field", field: "amountUsd" })).toBe(false);
    for (const kind of ["stage_answer", "lead_call_outcome", "activity", "reschedule_activity", "create_contact", "create_opportunity", "link_contact_to_opportunity"]) {
      expect(isInChatConfirmable({ ...fieldOperation, kind })).toBe(false);
    }
    expect(isInChatConfirmable(null)).toBe(false);
  });

  it("explica por qué se bloquea y exige interruptor, origen y tipo", () => {
    expect(inChatConfirmationBlock({ enabled: false, operation: fieldOperation })).toMatchObject({ code: "CHAT_CONFIRMATION_DISABLED", status: 403 });
    expect(inChatConfirmationBlock({ enabled: true, operation: { ...fieldOperation, sourceChannel: "coach" } })).toMatchObject({ code: "CHAT_CONFIRMATION_ORIGIN" });
    expect(inChatConfirmationBlock({ enabled: true, operation: { ...fieldOperation, kind: "account_field" } })).toMatchObject({ code: "CHAT_CONFIRMATION_KIND_NOT_ALLOWED" });
    expect(inChatConfirmationBlock({ enabled: true, operation: noteOperation })).toBeNull();
  });

  it("la firma identifica la propuesta, no el valor observado ni los espacios", () => {
    const base = chatOperationSignature(fieldOperation);
    expect(base).toMatch(/^[0-9a-f]{40}$/);
    expect(chatOperationSignature({ ...fieldOperation, currentValue: 999, title: "Otro título" })).toBe(base);
    expect(chatOperationSignature({ ...fieldOperation, value: "5000" })).toBe(base);
    expect(chatOperationSignature({ ...fieldOperation, value: 6000 })).not.toBe(base);
    expect(chatOperationSignature({ ...fieldOperation, opportunityId: 301 })).not.toBe(base);
    expect(chatOperationSignature({ ...fieldOperation, field: "closeDate" })).not.toBe(base);
    expect(chatOperationSignature({ ...noteOperation, noteText: "  El cliente pidió   revisar el alcance. " })).toBe(chatOperationSignature(noteOperation));
    expect(chatOperationSignature({ ...noteOperation, noteText: "Otro texto" })).not.toBe(chatOperationSignature(noteOperation));
    // The target follows the kind: two contacts (or a contact and an account) with the same new value are different proposals.
    const contact = { kind: "contact_field", sourceChannel: "customer_account", accountId: 160, contactId: 5, field: "email", value: "a@x.com" };
    expect(chatOperationSignature({ ...contact, contactId: 6 })).not.toBe(chatOperationSignature(contact));
    expect(chatOperationSignature({ ...contact, kind: "account_field", accountId: 5 })).not.toBe(chatOperationSignature(contact));
    expect(chatOperationSignature({ ...contact, accountId: 999 })).toBe(chatOperationSignature(contact));
  });
});

describe("ejecutar una operación confirmada desde el chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings.mockResolvedValue({ customerChatConfirmationEnabled: true });
    mocks.ownSession.mockResolvedValue(true);
    mocks.loadOperation.mockResolvedValue({ id: 900, status: "ready", operation: fieldOperation });
    mocks.outcome.mockResolvedValue(null);
    mocks.record.mockResolvedValue(true);
    mocks.execute.mockResolvedValue({ id: 900, status: "completed", result: { auditId: 1 }, pendingOperation: fieldOperation });
  });

  it("ejecuta con el servicio de siempre, lo marca como confirmado desde el chat y guarda el resultado", async () => {
    const response = await execute().expect(200);
    expect(response.body.operation.status).toBe("completed");
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 900, version: 3, idempotencyKey: "key-1", confirmedVia: "customer_chat",
    }));
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7, chatSessionId: 55, status: "confirmed", operationId: 900, operation: fieldOperation,
    }));
  });

  it("no cambia nada para quien confirma en el Coach", async () => {
    await request(app).post("/coach/operations/900/execute").send({ version: 3, idempotencyKey: "key-1" }).expect(200);
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ confirmedVia: null }));
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("si el Coach se abrió desde el chat, la conversación recuerda el resultado sin pasar por el interruptor", async () => {
    mocks.settings.mockResolvedValue({ customerChatConfirmationEnabled: false });
    await request(app).post("/coach/operations/900/execute").send({ version: 3, idempotencyKey: "key-1", chatSessionId: 55 }).expect(200);
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ confirmedVia: null }));
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ chatSessionId: 55, status: "confirmed", operationId: 900 }));
    mocks.record.mockClear();
    mocks.execute.mockResolvedValue({ id: 900, status: "completed", pendingOperation: { ...fieldOperation, sourceChannel: "coach" } });
    await request(app).post("/coach/operations/900/execute").send({ version: 3, idempotencyKey: "key-2", chatSessionId: 55 }).expect(200);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("rechaza con el interruptor apagado sin ejecutar nada", async () => {
    mocks.settings.mockResolvedValue({ customerChatConfirmationEnabled: false });
    const response = await execute().expect(403);
    expect(response.body.code).toBe("CHAT_CONFIRMATION_DISABLED");
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it.each([
    ["una respuesta de etapa", { ...fieldOperation, kind: "stage_answer" }, "CHAT_CONFIRMATION_KIND_NOT_ALLOWED"],
    ["un campo de contacto con catálogo", { ...fieldOperation, kind: "contact_field", field: "hierarchyLevelId" }, "CHAT_CONFIRMATION_KIND_NOT_ALLOWED"],
    ["un monto aplicado a una cuenta", { ...fieldOperation, kind: "account_field" }, "CHAT_CONFIRMATION_KIND_NOT_ALLOWED"],
    ["un campo no permitido", { ...fieldOperation, field: "stageId" }, "CHAT_CONFIRMATION_KIND_NOT_ALLOWED"],
    ["una propuesta del Coach", { ...fieldOperation, sourceChannel: "coach" }, "CHAT_CONFIRMATION_ORIGIN"],
  ])("rechaza %s", async (_label, operation, code) => {
    mocks.loadOperation.mockResolvedValue({ id: 900, status: "ready", operation });
    const response = await execute().expect(403);
    expect(response.body.code).toBe(code);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("exige una conversación propia y una operación propia", async () => {
    expect((await execute({ chatSessionId: undefined }).expect(400)).body.code).toBe("CHAT_SESSION_REQUIRED");
    mocks.ownSession.mockResolvedValue(false);
    expect((await execute().expect(404)).body.code).toBe("CHAT_SESSION_NOT_FOUND");
    mocks.ownSession.mockResolvedValue(true);
    mocks.loadOperation.mockResolvedValue(null);
    expect((await execute().expect(404)).body.code).toBe("COACH_OPERATION_NOT_FOUND");
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("no confirma dos veces la misma propuesta de una conversación, pero acepta repetir la misma solicitud", async () => {
    mocks.outcome.mockResolvedValue("confirmed");
    const response = await execute().expect(409);
    expect(response.body.code).toBe("CHAT_OPERATION_ALREADY_CONFIRMED");
    expect(mocks.execute).not.toHaveBeenCalled();
    mocks.loadOperation.mockResolvedValue({ id: 900, status: "completed", operation: fieldOperation });
    await execute().expect(200);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("no registra el resultado si el servicio rechaza la ejecución", async () => {
    mocks.execute.mockRejectedValue(new CoachOperationError(409, "COACH_UPDATE_STALE", "El borrador cambió"));
    const response = await execute().expect(409);
    expect(response.body.code).toBe("COACH_UPDATE_STALE");
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("acepta notas y no registra si la operación no terminó completada", async () => {
    mocks.loadOperation.mockResolvedValue({ id: 900, status: "ready", operation: noteOperation });
    mocks.execute.mockResolvedValue({ id: 900, status: "failed", pendingOperation: noteOperation });
    await execute().expect(200);
    expect(mocks.record).not.toHaveBeenCalled();
  });
});

describe("descartar una propuesta desde el chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.record.mockResolvedValue(true);
  });

  it("la deja descartada al reabrir la conversación", async () => {
    mocks.transition.mockResolvedValue({ outcome: "ok", operation: { id: 900, status: "rejected", pendingOperation: noteOperation } });
    await request(app).post("/coach/operations/900/reject").send({ chatSessionId: 55 }).expect(200);
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ chatSessionId: 55, status: "discarded", operation: noteOperation }));
  });

  it("no registra nada sin conversación, con una propuesta del Coach o si no puede rechazarse", async () => {
    mocks.transition.mockResolvedValue({ outcome: "ok", operation: { id: 900, status: "rejected", pendingOperation: noteOperation } });
    await request(app).post("/coach/operations/900/reject").send({}).expect(200);
    mocks.transition.mockResolvedValue({ outcome: "ok", operation: { id: 900, status: "rejected", pendingOperation: { ...noteOperation, sourceChannel: "coach" } } });
    await request(app).post("/coach/operations/900/reject").send({ chatSessionId: 55 }).expect(200);
    mocks.transition.mockResolvedValue({ outcome: "invalid_transition", operation: { id: 900 } });
    await request(app).post("/coach/operations/900/reject").send({ chatSessionId: 55 }).expect(409);
    expect(mocks.record).not.toHaveBeenCalled();
  });
});
