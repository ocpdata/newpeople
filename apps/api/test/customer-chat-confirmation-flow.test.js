import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("../src/ai-services/client.js", () => ({ aiFetch: vi.fn() }));

import { app } from "../src/app.js";
import { query } from "../src/db.js";
import { chatOperationSignature } from "../src/coach/chat-confirmation.js";
import { getMiCoachGovernanceSettings, updateMiCoachGovernanceSettings } from "../src/commercial-intelligence/service.js";
import {
  TEST_PREFIX, cleanupArtifacts, createDirectAccount, createDirectContact, createRole, createUser, getCatalogId,
  getFirstId, login,
} from "./helpers/apiTestUtils.js";

const api = () => supertest(app);
const COACH = "/api/mi-agent/coach/operations";
const CI = "/api/commercial-intelligence";
const PERMISSIONS = [
  "mi_coach.access", "mi_coach.use", "mi_coach.execute", "inteligencia_comercial.access", "inteligencia_comercial.read",
  "cuentas.read", "cuentas.update", "contactos.read", "contactos.update", "oportunidades.read", "oportunidades.update",
];

// Persists, reviews and confirms real proposals through the HTTP API, exactly as the chat card does.
describe("confirmar notas y datos de una oportunidad desde el chat (base de datos real)", () => {
  const ids = { users: [], roles: [], contacts: [] };
  const sessionIds = [];
  let token;
  let adminToken;
  let sellerId;
  let accountId;
  let opportunityId;
  let chatSessionId;
  let originalSettings;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  const proposal = (extra) => ({
    kind: "opportunity_field", sourceChannel: "customer_account", requiresConfirmation: true,
    title: "Actualizar monto", opportunityId, field: "amountUsd", currentValue: 32100, value: 45000, ...extra,
  });
  const note = (extra) => ({
    kind: "opportunity_note", sourceChannel: "customer_account", requiresConfirmation: true,
    title: "Registrar nota", opportunityId, accountId, noteText: "El cliente pidió ajustar el alcance.", sourceType: "chat_report",
    attribution: "seller", certainty: "reported", ...extra,
  });
  const persist = async (operation) => {
    const response = await api().post(COACH).set(auth()).send({
      sessionId: null, originChannel: "customer_account", originalIntent: "Propuesta desde Cliente existente",
      context: { accountId, opportunityId, contactId: null, leadId: null }, operation,
    });
    expect(response.status).toBe(201);
    return response.body.operation;
  };
  const review = async (operation) => {
    const response = await api().post(`${COACH}/${operation.id}/review`).set(auth()).send({ version: operation.version });
    expect(response.status).toBe(200);
    return response.body.operation;
  };
  const confirm = (operation, extra = {}) => api().post(`${COACH}/${operation.id}/execute`).set(auth()).send({
    version: operation.version, idempotencyKey: `k-${operation.id}`, confirmedVia: "customer_chat", chatSessionId, ...extra,
  });
  const setSwitch = (enabled) => updateMiCoachGovernanceSettings({
    user: { id: sellerId }, settings: { ...originalSettings, customerChatConfirmationEnabled: enabled },
  });
  const amount = async () => Number((await query("SELECT amount_usd FROM opportunities WHERE id = ?", [opportunityId]))[0].amount_usd);

  beforeAll(async () => {
    const roleId = await createRole({ name: `${TEST_PREFIX}_flow`, permissionCodes: PERMISSIONS });
    ids.roles.push(roleId);
    const email = `${TEST_PREFIX}.flow@example.com`;
    sellerId = await createUser({ fullName: "Flow seller", email, roleIds: [roleId] });
    ids.users.push(sellerId);
    const session = await login(api(), email);
    expect(session.status).toBe(200);
    token = session.body.token;
    const adminRole = await createRole({ name: `${TEST_PREFIX}_flow_admin`, permissionCodes: [...PERMISSIONS, "mi_coach.admin"] });
    ids.roles.push(adminRole);
    const adminEmail = `${TEST_PREFIX}.flow.admin@example.com`;
    ids.users.push(await createUser({ fullName: "Flow admin", email: adminEmail, roleIds: [adminRole] }));
    adminToken = (await login(api(), adminEmail)).body.token;
    accountId = await createDirectAccount({ ownerUserId: sellerId, actorUserId: sellerId, suffix: `${TEST_PREFIX}_flow` });
    const contactId = await createDirectContact({ accountId, actorUserId: sellerId, suffix: `${TEST_PREFIX}_flow` });
    ids.contacts.push(contactId);
    const now = new Date();
    const inserted = await query(
      `INSERT INTO opportunities
        (name, amount_usd, account_id, close_date, contact_id, sales_stage_id, business_line_id, seller_user_id, presales_user_id,
         activation_status_id, commercial_status_id, created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`Oportunidad flujo ${TEST_PREFIX}`, 32100, accountId, "2026-12-31", contactId,
        await getCatalogId("opportunity_sales_stages", "contacto_inicial"), await getFirstId("opportunity_business_lines"),
        sellerId, null, await getCatalogId("opportunity_activation_statuses", "activada"),
        await getCatalogId("opportunity_commercial_statuses", "en_proceso"), sellerId, now, sellerId, now],
    );
    opportunityId = Number(inserted.insertId);
    const chat = await query(
      `INSERT INTO customer_intelligence_chat_sessions (public_id, requested_by_user_id, account_id, history_json) VALUES (?, ?, ?, '[]')`,
      [`cacs_${TEST_PREFIX}_flow`, sellerId, accountId],
    );
    chatSessionId = Number(chat.insertId);
    sessionIds.push(chatSessionId);
    originalSettings = await getMiCoachGovernanceSettings();
  });

  afterAll(async () => {
    await updateMiCoachGovernanceSettings({ user: { id: sellerId }, settings: originalSettings });
    await query("DELETE FROM coach_operation_events WHERE user_id = ?", [sellerId]).catch(() => undefined);
    await query("DELETE FROM coach_session_operations WHERE user_id = ?", [sellerId]).catch(() => undefined);
    await query("DELETE FROM opportunity_notes WHERE opportunity_id = ?", [opportunityId]).catch(() => undefined);
    await query("DELETE FROM customer_intelligence_chat_sessions WHERE id IN (?)", [sessionIds]);
    await query("DELETE FROM opportunities WHERE id = ?", [opportunityId]).catch(() => undefined);
    await cleanupArtifacts({ accountIds: [accountId], contactIds: ids.contacts, userIds: ids.users, roleIds: ids.roles });
  });

  test("viene apagado, solo un administrador lo cambia y el chat lo consulta", async () => {
    expect(originalSettings.customerChatConfirmationEnabled).toBe(false);
    const capabilities = () => api().get(`${CI}/account-chat/capabilities`).set(auth());
    const off = await capabilities();
    expect(off.status).toBe(200);
    expect(off.body.inChatConfirmation).toMatchObject({
      enabled: false, kinds: ["opportunity_note", "opportunity_field", "account_field", "contact_field"],
      fields: { opportunity_field: ["name", "amountUsd", "closeDate"], account_field: expect.arrayContaining(["city"]), contact_field: expect.arrayContaining(["email"]) },
    });
    expect((await api().get(`${CI}/account-chat/capabilities`)).status).toBe(401);
    const body = { ...originalSettings, customerChatConfirmationEnabled: true };
    expect((await api().put(`${CI}/governance/settings`).set(auth()).send(body)).status).toBe(403);
    const admin = { Authorization: `Bearer ${adminToken}` };
    expect((await api().put(`${CI}/governance/settings`).set(admin).send({ customerChatConfirmationEnabled: "si" })).status).toBe(400);
    expect((await api().put(`${CI}/governance/settings`).set(admin).send(body)).status).toBe(200);
    expect((await capabilities()).body.inChatConfirmation.enabled).toBe(true);
    await setSwitch(false);
    expect((await capabilities()).body.inChatConfirmation.enabled).toBe(false);
    await setSwitch(true);
  });

  test("la firma de la propuesta del chat coincide con la de la operación guardada", async () => {
    const chatOperation = proposal();
    const persisted = await persist(chatOperation);
    expect(chatOperationSignature(persisted.pendingOperation)).toBe(chatOperationSignature(chatOperation));
    const reviewed = await review(persisted);
    expect(reviewed.reviewedAt).toBeTruthy();
    expect(chatOperationSignature(reviewed.pendingOperation)).toBe(chatOperationSignature(chatOperation));
    await api().post(`${COACH}/${persisted.id}/reject`).set(auth()).send({ chatSessionId });
    const noteOperation = note();
    const persistedNote = await persist(noteOperation);
    expect(chatOperationSignature(persistedNote.pendingOperation)).toBe(chatOperationSignature(noteOperation));
    await api().post(`${COACH}/${persistedNote.id}/reject`).set(auth()).send({});
  });

  test("las marcas que el chat añade a una propuesta no estorban ni se guardan", async () => {
    const decorated = proposal({ value: 46000, signature: chatOperationSignature(proposal({ value: 46000 })), outcome: "discarded" });
    const persisted = await persist(decorated);
    expect(persisted.pendingOperation).not.toHaveProperty("signature");
    expect(persisted.pendingOperation).not.toHaveProperty("outcome");
    await api().post(`${COACH}/${persisted.id}/reject`).set(auth()).send({});
  });

  test("sin revisar el valor actual no se puede confirmar", async () => {
    const persisted = await persist(proposal({ value: 47000 }));
    const response = await confirm(persisted);
    expect([400, 409]).toContain(response.status);
    expect(await amount()).toBe(32100);
    await api().post(`${COACH}/${persisted.id}/reject`).set(auth()).send({});
  });

  test("confirma un cambio de monto: guarda, audita desde dónde se confirmó y no deja repetirlo", async () => {
    const persisted = await persist(proposal());
    const reviewed = await review(persisted);
    const response = await confirm(reviewed);
    expect(response.status).toBe(200);
    expect(response.body.operation.status).toBe("completed");
    expect(await amount()).toBe(45000);
    const events = await query("SELECT event_type, metadata FROM coach_operation_events WHERE operation_id = ? ORDER BY id", [reviewed.id]);
    const confirmedEvents = events.filter((event) => ["approved", "completed"].includes(event.event_type));
    expect(confirmedEvents).toHaveLength(2);
    for (const event of confirmedEvents) {
      expect(typeof event.metadata === "string" ? JSON.parse(event.metadata) : event.metadata).toEqual({ confirmedVia: "customer_chat" });
    }
    const [outcome] = await query("SELECT status, operation_id FROM customer_chat_operation_outcomes WHERE session_id = ?", [chatSessionId]);
    expect(outcome).toMatchObject({ status: "confirmed", operation_id: reviewed.id });

    // The same proposal cannot be confirmed again in this conversation, even through a new persisted copy.
    const again = await review(await persist(proposal({ value: 45000 })));
    const duplicate = await confirm(again, { idempotencyKey: "otra-clave" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe("CHAT_OPERATION_ALREADY_CONFIRMED");
    // Repeating the very same request is idempotent and returns the stored result.
    const replay = await confirm(reviewed);
    expect(replay.status).toBe(200);
    expect(await amount()).toBe(45000);
  });

  test("al deshacer un cambio confirmado, la propuesta se puede confirmar otra vez en la conversación", async () => {
    const [{ id }] = await query("SELECT id FROM coach_session_operations WHERE user_id = ? AND status = 'completed' ORDER BY id DESC LIMIT 1", [sellerId]);
    const response = await api().post(`${COACH}/${id}/revert`).set(auth()).send({ chatSessionId });
    expect(response.status).toBe(200);
    expect(await amount()).toBe(32100);
    const outcomes = await query("SELECT status FROM customer_chat_operation_outcomes WHERE session_id = ?", [chatSessionId]);
    expect(outcomes).toEqual([]);
    const reviewed = await review(await persist(proposal({ value: 45000 })));
    expect((await confirm(reviewed, { idempotencyKey: "tras-deshacer" })).status).toBe(200);
    expect(await amount()).toBe(45000);
    const [{ id: lastId }] = await query("SELECT id FROM coach_session_operations WHERE user_id = ? AND status = 'completed' ORDER BY id DESC LIMIT 1", [sellerId]);
    expect((await api().post(`${COACH}/${lastId}/revert`).set(auth()).send({ chatSessionId })).status).toBe(200);
    expect(await amount()).toBe(32100);
  });

  test("registra una nota confirmada una sola vez", async () => {
    const reviewed = await review(await persist(note()));
    const response = await confirm(reviewed);
    expect(response.status).toBe(200);
    expect(response.body.operation.status).toBe("completed");
    const notes = await query("SELECT COUNT(*) AS total FROM opportunity_notes WHERE opportunity_id = ?", [opportunityId]);
    expect(Number(notes[0].total)).toBe(1);
    const second = await review(await persist(note()));
    expect((await confirm(second, { idempotencyKey: "nota-2" })).status).toBe(409);
    expect(Number((await query("SELECT COUNT(*) AS total FROM opportunity_notes WHERE opportunity_id = ?", [opportunityId]))[0].total)).toBe(1);
  });

  test("con el interruptor apagado el chat no confirma, pero el Coach sigue funcionando", async () => {
    await setSwitch(false);
    try {
      const reviewed = await review(await persist(proposal({ value: 51000 })));
      const blocked = await confirm(reviewed);
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe("CHAT_CONFIRMATION_DISABLED");
      expect(await amount()).toBe(32100);
      const viaCoach = await api().post(`${COACH}/${reviewed.id}/execute`).set(auth())
        .send({ version: reviewed.version, idempotencyKey: "coach-key" });
      expect(viaCoach.status).toBe(200);
      expect(await amount()).toBe(51000);
    } finally {
      await setSwitch(true);
    }
  });

  test("confirma y deshace un cambio de cuenta", async () => {
    const [{ city }] = await query("SELECT city FROM accounts WHERE id = ?", [accountId]);
    const operation = { kind: "account_field", sourceChannel: "customer_account", requiresConfirmation: true, title: "Cambiar ciudad de la cuenta",
      accountId, field: "city", currentValue: city, value: "Puebla" };
    const reviewed = await review(await persist(operation));
    const response = await confirm(reviewed);
    expect(response.status).toBe(200);
    expect((await query("SELECT city FROM accounts WHERE id = ?", [accountId]))[0].city).toBe("Puebla");
    const events = await query("SELECT metadata FROM coach_operation_events WHERE operation_id = ? AND event_type = 'completed'", [reviewed.id]);
    expect(typeof events[0].metadata === "string" ? JSON.parse(events[0].metadata) : events[0].metadata).toEqual({ confirmedVia: "customer_chat" });
    expect((await api().post(`${COACH}/${reviewed.id}/revert`).set(auth()).send({ chatSessionId })).status).toBe(200);
    expect((await query("SELECT city FROM accounts WHERE id = ?", [accountId]))[0].city).toBe(city);
  });

  test("confirma un cambio de contacto y no un campo de catálogo", async () => {
    const contactId = ids.contacts[0];
    const email = `nuevo.${TEST_PREFIX}@example.com`;
    const [{ email: before, hierarchy_level_id: level }] = await query("SELECT email, hierarchy_level_id FROM contacts WHERE id = ?", [contactId]);
    const emailChange = { kind: "contact_field", sourceChannel: "customer_account", requiresConfirmation: true, title: "Cambiar correo del contacto",
      contactId, field: "email", currentValue: before, value: email };
    const reviewed = await review(await persist(emailChange));
    expect((await confirm(reviewed)).status).toBe(200);
    expect((await query("SELECT email FROM contacts WHERE id = ?", [contactId]))[0].email).toBe(email);

    const catalogChange = { ...emailChange, title: "Cambiar nivel jerárquico", field: "hierarchyLevelId", currentValue: level, value: level };
    const catalogOp = await persist(catalogChange);
    const blocked = await confirm(await review(catalogOp), { idempotencyKey: "catalogo" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("CHAT_CONFIRMATION_KIND_NOT_ALLOWED");
    await api().post(`${COACH}/${catalogOp.id}/reject`).set(auth()).send({});
  });

  test("si la propuesta se abre en el Coach desde el chat, la conversación recuerda cómo terminó", async () => {
    await setSwitch(false);
    try {
      const outcomeOf = async (operation) => (await query(
        "SELECT status FROM customer_chat_operation_outcomes WHERE session_id = ? AND signature = ?",
        [chatSessionId, chatOperationSignature(operation)]))[0]?.status || null;
      const first = proposal({ value: 52000 });
      const reviewed = await review(await persist(first));
      const viaCoach = await api().post(`${COACH}/${reviewed.id}/execute`).set(auth())
        .send({ version: reviewed.version, idempotencyKey: "coach-desde-chat", chatSessionId });
      expect(viaCoach.status).toBe(200);
      expect(await outcomeOf(first)).toBe("confirmed");

      const second = proposal({ value: 53000 });
      const again = await persist(second);
      await api().post(`${COACH}/${again.id}/reject`).set(auth()).send({ reason: "no", chatSessionId });
      expect(await outcomeOf(second)).toBe("discarded");

      // Without the conversation, nothing is recorded.
      const third = proposal({ value: 54000 });
      const plain = await review(await persist(third));
      await api().post(`${COACH}/${plain.id}/execute`).set(auth()).send({ version: plain.version, idempotencyKey: "coach-solo" });
      expect(await outcomeOf(third)).toBeNull();
    } finally {
      await setSwitch(true);
    }
  });

  test("los tipos que el chat todavía no confirma siguen yendo al Coach", async () => {
    const reviewed = await review(await persist(proposal({ field: "name", currentValue: "x", value: "Nuevo nombre" })));
    expect((await confirm(reviewed)).status).toBe(200);
    const stage = { kind: "stage_answer", sourceChannel: "customer_account", title: "Respuesta", opportunityId, accountId, questionId: 1, answerText: "x" };
    const persisted = await api().post(COACH).set(auth()).send({
      sessionId: null, originChannel: "customer_account", originalIntent: "x", context: { accountId, opportunityId }, operation: stage,
    });
    if (persisted.status === 201) {
      const blocked = await confirm(persisted.body.operation);
      expect([403, 409]).toContain(blocked.status);
    }
  });
});
