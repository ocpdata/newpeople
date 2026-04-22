import request from "supertest";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { app } from "../src/app.js";
import { pool, query } from "../src/db.js";
import {
  TEST_PREFIX,
  cleanupArtifacts,
  createDirectAccount,
  createDirectContact,
  createRole,
  createUser,
  ensureNamedRole,
  getCatalogId,
  getFirstId,
  getPermissionIds,
  getStatusCodeById,
  login,
} from "./helpers/apiTestUtils.js";

describe("API integration baseline", () => {
  const cleanup = {
    stageQuestionIds: [],
    opportunityIds: [],
    contactIds: [],
    accountIds: [],
    userIds: [],
    roleIds: [],
  };

  const ctx = {};

  beforeAll(async () => {
    const sellerRole = await ensureNamedRole("Vendedor");
    if (sellerRole.created) {
      cleanup.roleIds.push(sellerRole.roleId);
    }
    ctx.sellerRoleId = sellerRole.roleId;

    ctx.accountCreateRoleId = await createRole({
      name: `${TEST_PREFIX}_accounts_create`,
      permissionCodes: ["cuentas.create", "cuentas.update"],
    });
    ctx.accountRequestRoleId = await createRole({
      name: `${TEST_PREFIX}_accounts_request`,
      permissionCodes: ["cuentas.request", "cuentas.update"],
    });
    ctx.accountReadRoleId = await createRole({
      name: `${TEST_PREFIX}_accounts_read`,
      permissionCodes: ["cuentas.read"],
    });
    ctx.contactRequestRoleId = await createRole({
      name: `${TEST_PREFIX}_contacts_request`,
      permissionCodes: ["contactos.request", "contactos.update"],
    });
    ctx.contactCreateRoleId = await createRole({
      name: `${TEST_PREFIX}_contacts_create`,
      permissionCodes: ["contactos.create", "contactos.update"],
    });
    ctx.opportunityRequestRoleId = await createRole({
      name: `${TEST_PREFIX}_opps_request`,
      permissionCodes: ["oportunidades.request", "oportunidades.update"],
    });
    ctx.opportunityFlowRoleId = await createRole({
      name: `${TEST_PREFIX}_opps_flow`,
      permissionCodes: [
        "oportunidades.read",
        "oportunidades.request",
        "oportunidades.update",
      ],
    });
    ctx.roleManagerRoleId = await createRole({
      name: `${TEST_PREFIX}_roles_update`,
      permissionCodes: ["roles.update"],
    });
    ctx.dynamicPermissionRoleId = await createRole({
      name: `${TEST_PREFIX}_dynamic_permissions`,
      permissionCodes: ["contactos.request"],
    });
    ctx.userCrudRoleId = await createRole({
      name: `${TEST_PREFIX}_users_crud`,
      permissionCodes: ["usuarios.create", "usuarios.update"],
    });

    cleanup.roleIds.push(
      ctx.accountCreateRoleId,
      ctx.accountRequestRoleId,
      ctx.accountReadRoleId,
      ctx.contactRequestRoleId,
      ctx.contactCreateRoleId,
      ctx.opportunityRequestRoleId,
      ctx.opportunityFlowRoleId,
      ctx.roleManagerRoleId,
      ctx.dynamicPermissionRoleId,
      ctx.userCrudRoleId,
    );

    ctx.catalogIds = {
      countryMxId: await getCatalogId("countries", "MX", "iso2"),
      accountTypeId: await getFirstId("account_types"),
      economicSectorId: await getFirstId("economic_sectors"),
      accountActiveStatusId: await getCatalogId(
        "account_activation_statuses",
        "activada",
      ),
      accountPendingStatusId: await getCatalogId(
        "account_activation_statuses",
        "pendiente_activacion",
      ),
      purchaseParticipationNoneId: await getCatalogId(
        "contact_purchase_participations",
        "ninguno",
      ),
      relationshipTypeNoneId: await getCatalogId(
        "contact_relationship_types",
        "ninguno",
      ),
      employmentStatusId: await getFirstId("contact_employment_statuses"),
      contactActiveStatusId: await getCatalogId(
        "contact_activation_statuses",
        "activado",
      ),
      contactInactiveStatusId: await getCatalogId(
        "contact_activation_statuses",
        "desactivado",
      ),
      contactPendingStatusId: await getCatalogId(
        "contact_activation_statuses",
        "pendiente_activacion",
      ),
      salesStageInitialId: await getCatalogId(
        "opportunity_sales_stages",
        "contacto_inicial",
      ),
      salesStageIdentificationId: await getCatalogId(
        "opportunity_sales_stages",
        "identificacion_oportunidad",
      ),
      salesStageWaitingId: await getCatalogId(
        "opportunity_sales_stages",
        "waiting",
      ),
      businessLineId: await getFirstId("opportunity_business_lines"),
      opportunityActiveStatusId: await getCatalogId(
        "opportunity_activation_statuses",
        "activada",
      ),
      opportunityInactiveStatusId: await getCatalogId(
        "opportunity_activation_statuses",
        "desactivada",
      ),
      opportunityPendingStatusId: await getCatalogId(
        "opportunity_activation_statuses",
        "pendiente_activacion",
      ),
      opportunityCommercialInProgressStatusId: await getCatalogId(
        "opportunity_commercial_statuses",
        "en_proceso",
      ),
      opportunityCommercialWonStatusId: await getCatalogId(
        "opportunity_commercial_statuses",
        "ganada",
      ),
      opportunityCommercialLostStatusId: await getCatalogId(
        "opportunity_commercial_statuses",
        "perdida",
      ),
      opportunityCommercialCanceledStatusId: await getCatalogId(
        "opportunity_commercial_statuses",
        "anulada",
      ),
    };

    ctx.accountCreateUserId = await createUser({
      fullName: "API Account Create",
      email: `${TEST_PREFIX}.accounts.create@example.com`,
      roleIds: [ctx.accountCreateRoleId],
    });
    ctx.accountRequestUserId = await createUser({
      fullName: "API Account Request",
      email: `${TEST_PREFIX}.accounts.request@example.com`,
      roleIds: [ctx.accountRequestRoleId],
    });
    ctx.accountReadUserId = await createUser({
      fullName: "API Account Read",
      email: `${TEST_PREFIX}.accounts.read@example.com`,
      roleIds: [ctx.accountReadRoleId],
    });
    ctx.contactRequestUserId = await createUser({
      fullName: "API Contact Request",
      email: `${TEST_PREFIX}.contacts.request@example.com`,
      roleIds: [ctx.contactRequestRoleId],
    });
    ctx.contactCreateUserId = await createUser({
      fullName: "API Contact Create",
      email: `${TEST_PREFIX}.contacts.create@example.com`,
      roleIds: [ctx.contactCreateRoleId],
    });
    ctx.opportunityRequestUserId = await createUser({
      fullName: "API Opportunity Request",
      email: `${TEST_PREFIX}.opps.request@example.com`,
      roleIds: [ctx.opportunityRequestRoleId],
    });
    ctx.opportunityFlowUserId = await createUser({
      fullName: "API Opportunity Flow",
      email: `${TEST_PREFIX}.opps.flow@example.com`,
      roleIds: [ctx.opportunityFlowRoleId],
    });
    ctx.sellerUserId = await createUser({
      fullName: "API Seller Fixture",
      email: `${TEST_PREFIX}.seller@example.com`,
      roleIds: [ctx.sellerRoleId],
    });
    ctx.roleManagerUserId = await createUser({
      fullName: "API Role Manager",
      email: `${TEST_PREFIX}.roles.manager@example.com`,
      roleIds: [ctx.roleManagerRoleId],
    });
    ctx.dynamicPermissionUserId = await createUser({
      fullName: "API Dynamic Permission User",
      email: `${TEST_PREFIX}.dynamic.permissions@example.com`,
      roleIds: [ctx.dynamicPermissionRoleId],
    });
    ctx.userCrudUserId = await createUser({
      fullName: "API User CRUD",
      email: `${TEST_PREFIX}.users.crud@example.com`,
      roleIds: [ctx.userCrudRoleId],
    });

    cleanup.userIds.push(
      ctx.accountCreateUserId,
      ctx.accountRequestUserId,
      ctx.accountReadUserId,
      ctx.contactRequestUserId,
      ctx.contactCreateUserId,
      ctx.opportunityRequestUserId,
      ctx.opportunityFlowUserId,
      ctx.sellerUserId,
      ctx.roleManagerUserId,
      ctx.dynamicPermissionUserId,
      ctx.userCrudUserId,
    );

    const fixtureSuffix = `${TEST_PREFIX}_fixture`;
    ctx.fixtureAccountId = await createDirectAccount({
      ownerUserId: ctx.sellerUserId,
      actorUserId: ctx.sellerUserId,
      suffix: fixtureSuffix,
    });
    cleanup.accountIds.push(ctx.fixtureAccountId);

    ctx.fixtureContactId = await createDirectContact({
      accountId: ctx.fixtureAccountId,
      actorUserId: ctx.sellerUserId,
      suffix: fixtureSuffix,
    });
    cleanup.contactIds.push(ctx.fixtureContactId);
  });

  async function createOwnedOpportunityFlowFixture(suffix) {
    const accountId = await createDirectAccount({
      ownerUserId: ctx.opportunityFlowUserId,
      actorUserId: ctx.opportunityFlowUserId,
      suffix,
    });
    cleanup.accountIds.push(accountId);

    const contactId = await createDirectContact({
      accountId,
      actorUserId: ctx.opportunityFlowUserId,
      suffix,
    });
    cleanup.contactIds.push(contactId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.opps.flow@example.com`,
    );

    const createResponse = await request(app)
      .post("/api/opportunities")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Oportunidad flujo ${suffix}`,
        amountUsd: 41000,
        accountId,
        closeDate: "2026-12-31",
        contactId,
        salesStageId: ctx.catalogIds.salesStageWaitingId,
        businessLineId: ctx.catalogIds.businessLineId,
        sellerUserId: ctx.sellerUserId,
        presalesUserId: null,
        activationStatusId: ctx.catalogIds.opportunityActiveStatusId,
      });

    expect(createResponse.status).toBe(201);
    cleanup.opportunityIds.push(Number(createResponse.body.id));

    return {
      token: loginResponse.body.token,
      accountId,
      contactId,
      opportunityId: Number(createResponse.body.id),
    };
  }

  async function getOpportunityCommercialSnapshot(opportunityId) {
    const rows = await query(
      `SELECT o.id,
              oss.code AS sales_stage_code,
              ocs.code AS commercial_status_code,
              oas.code AS activation_status_code,
              o.commercial_close_reason,
              o.commercial_closed_at
       FROM opportunities o
       INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
       INNER JOIN opportunity_commercial_statuses ocs ON ocs.id = o.commercial_status_id
       INNER JOIN opportunity_activation_statuses oas ON oas.id = o.activation_status_id
       WHERE o.id = ?
       LIMIT 1`,
      [opportunityId],
    );
    return rows[0] || null;
  }

  async function getStageQuestionRowsByCode(stageCode) {
    return query(
      `SELECT q.id, q.code, q.prompt, q.display_order, q.is_required
       FROM opportunity_stage_questions q
       INNER JOIN opportunity_sales_stages s ON s.id = q.sales_stage_id
       WHERE s.code = ?
         AND q.is_active = 1
       ORDER BY q.display_order, q.id`,
      [stageCode],
    );
  }

  async function getAuditActionsForOpportunity(opportunityId, action) {
    return query(
      `SELECT id, action, entity_id
       FROM audit_log
       WHERE entity_type = 'opportunity'
         AND entity_id = ?
         AND action = ?
       ORDER BY id`,
      [opportunityId, action],
    );
  }

  afterAll(async () => {
    await cleanupArtifacts(cleanup);
    await pool.end();
  });

  test("login y /me reflejan permisos efectivos del usuario", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.create@example.com`,
    );

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.token).toBeTruthy();

    const meResponse = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.permissions).toContain("cuentas.create");
    expect(meResponse.body.permissions).toContain("cuentas.update");
  });

  test("auth.set-password permite configurar contrasena desde el enlace y luego iniciar sesion", async () => {
    const invitedUserId = await createUser({
      fullName: "API Password Setup User",
      email: `${TEST_PREFIX}.password.setup@example.com`,
      roleIds: [ctx.sellerRoleId],
    });
    cleanup.userIds.push(invitedUserId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.users.crud@example.com`,
    );

    const resetResponse = await request(app)
      .post(`/api/users/${invitedUserId}/reset-password-invite`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send();

    expect(resetResponse.status).toBe(502);
    expect(resetResponse.body.inviteSetupUrl).toBeTruthy();

    const inviteUrl = new URL(resetResponse.body.inviteSetupUrl);
    const setupToken = inviteUrl.searchParams.get("token");

    expect(setupToken).toBeTruthy();

    const contextResponse = await request(app)
      .get(
        `/api/auth/set-password-context?token=${encodeURIComponent(setupToken)}`,
      )
      .send();

    expect(contextResponse.status).toBe(200);
    expect(contextResponse.body.email).toBe(
      `${TEST_PREFIX}.password.setup@example.com`,
    );
    expect(contextResponse.body.fullName).toBe("API Password Setup User");
    expect(contextResponse.body.purpose).toBe("reset");
    expect(contextResponse.body.expiresAt).toBeTruthy();

    const setPasswordResponse = await request(app)
      .post("/api/auth/set-password")
      .send({
        token: setupToken,
        password: "SetupPass123!",
      });

    expect(setPasswordResponse.status).toBe(200);
    expect(setPasswordResponse.body.token).toBeTruthy();
    expect(setPasswordResponse.body.message).toBe(
      "Contrasena configurada correctamente",
    );

    const loginWithNewPasswordResponse = await request(app)
      .post("/api/auth/login")
      .send({
        email: `${TEST_PREFIX}.password.setup@example.com`,
        password: "SetupPass123!",
      });

    expect(loginWithNewPasswordResponse.status).toBe(200);

    const reusedTokenResponse = await request(app)
      .post("/api/auth/set-password")
      .send({
        token: setupToken,
        password: "SetupPass456!",
      });

    expect(reusedTokenResponse.status).toBe(409);
    expect(reusedTokenResponse.body.message).toBe(
      "Este enlace ya fue utilizado",
    );

    const auditRows = await query(
      `SELECT action, status
       FROM audit_log
       WHERE entity_type = 'user' AND entity_id = ?
       ORDER BY id DESC
       LIMIT 5`,
      [invitedUserId],
    );

    expect(
      auditRows.some(
        (row) => row.action === "password_set" && row.status === "success",
      ),
    ).toBe(true);
  });

  test("usuarios.create acepta avatarUrl vacio y lo persiste como null", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.users.crud@example.com`,
    );

    const createResponse = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        fullName: `Usuario Avatar Empty ${TEST_PREFIX}`,
        email: `${TEST_PREFIX}.avatar.empty@example.com`,
        mobile: "5512345678",
        avatarUrl: "",
        roleIds: [ctx.sellerRoleId],
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.inviteEmailSent).toBe(false);
    expect(createResponse.body.inviteEmailReason).toBe("smtp_not_configured");
    expect(createResponse.body.inviteEmailDetail).toContain("SMTP_HOST");
    cleanup.userIds.push(Number(createResponse.body.id));

    const createdRows = await query(
      "SELECT avatar_url FROM users WHERE id = ? LIMIT 1",
      [Number(createResponse.body.id)],
    );

    expect(createdRows).toHaveLength(1);
    expect(createdRows[0].avatar_url).toBeNull();

    const auditRows = await query(
      `SELECT action, status, detail
       FROM audit_log
       WHERE entity_type = 'user' AND entity_id = ?
       ORDER BY id DESC
       LIMIT 2`,
      [Number(createResponse.body.id)],
    );

    expect(
      auditRows.some((row) => row.action === "invitation_email_failed"),
    ).toBe(true);
    expect(
      auditRows.some(
        (row) =>
          row.action === "invitation_email_failed" && row.status === "error",
      ),
    ).toBe(true);
  });

  test("usuarios.reset-password-invite devuelve razon SMTP y la audita cuando falla el envio", async () => {
    const resettableUserId = await createUser({
      fullName: "API Reset Invite User",
      email: `${TEST_PREFIX}.reset.invite@example.com`,
      roleIds: [ctx.sellerRoleId],
    });
    cleanup.userIds.push(resettableUserId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.users.crud@example.com`,
    );

    const resetResponse = await request(app)
      .post(`/api/users/${resettableUserId}/reset-password-invite`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send();

    expect(resetResponse.status).toBe(502);
    expect(resetResponse.body.reason).toBe("smtp_not_configured");
    expect(resetResponse.body.detail).toContain("SMTP_HOST");
    expect(resetResponse.body.inviteSetupUrl).toContain("token=");
    expect(resetResponse.body.inviteExpiresAt).toBeTruthy();

    const auditRows = await query(
      `SELECT action, status, detail
       FROM audit_log
       WHERE entity_type = 'user' AND entity_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [resettableUserId],
    );

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe("password_reset_failed");
    expect(auditRows[0].status).toBe("error");
  });

  test("usuarios.update acepta avatarUrl vacio y limpia el avatar existente", async () => {
    const editableUserId = await createUser({
      fullName: "API Editable Avatar User",
      email: `${TEST_PREFIX}.avatar.editable@example.com`,
      roleIds: [ctx.sellerRoleId],
    });
    cleanup.userIds.push(editableUserId);

    await query("UPDATE users SET avatar_url = ? WHERE id = ?", [
      "https://example.com/avatar-test.webp",
      editableUserId,
    ]);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.users.crud@example.com`,
    );

    const updateResponse = await request(app)
      .put(`/api/users/${editableUserId}`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        fullName: "API Editable Avatar User Updated",
        avatarUrl: "",
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.message).toBe("Usuario actualizado");

    const updatedRows = await query(
      "SELECT full_name, avatar_url FROM users WHERE id = ? LIMIT 1",
      [editableUserId],
    );

    expect(updatedRows).toHaveLength(1);
    expect(updatedRows[0].full_name).toBe("API Editable Avatar User Updated");
    expect(updatedRows[0].avatar_url).toBeNull();
  });

  test("cuentas.create crea una cuenta activada", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.create@example.com`,
    );

    const response = await request(app)
      .post("/api/accounts")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Cuenta API Create ${TEST_PREFIX}`,
        accountTypeId: ctx.catalogIds.accountTypeId,
        registrationCode: `CRT-${TEST_PREFIX}`,
        phone: "5550001111",
        economicSectorId: ctx.catalogIds.economicSectorId,
        website: "https://example.com",
        city: "CDMX",
        stateRegion: "CDMX",
        countryId: ctx.catalogIds.countryMxId,
        description: "Cuenta creada por prueba automatica",
        addressLine: "Direccion prueba",
        postalCode: "01000",
        activationStatusId: ctx.catalogIds.accountActiveStatusId,
        ownerUserIds: [ctx.accountCreateUserId],
      });

    expect(response.status).toBe(201);
    expect(response.body.message).toBe("Cuenta creada");
    cleanup.accountIds.push(Number(response.body.id));

    const statusCode = await getStatusCodeById("accounts", response.body.id, {
      table: "account_activation_statuses",
      column: "activation_status_id",
    });
    expect(statusCode).toBe("activada");
  });

  test("cuentas.request crea pendiente y no permite activar sin cuentas.create", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.request@example.com`,
    );

    const createResponse = await request(app)
      .post("/api/accounts")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Cuenta API Request ${TEST_PREFIX}`,
        accountTypeId: ctx.catalogIds.accountTypeId,
        registrationCode: `RQT-${TEST_PREFIX}`,
        phone: "5550002222",
        economicSectorId: ctx.catalogIds.economicSectorId,
        website: "https://example.org",
        city: "CDMX",
        stateRegion: "CDMX",
        countryId: ctx.catalogIds.countryMxId,
        description: "Cuenta solicitada por prueba automatica",
        addressLine: "Direccion prueba",
        postalCode: "01001",
        activationStatusId: ctx.catalogIds.accountActiveStatusId,
        ownerUserIds: [ctx.accountRequestUserId],
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.message).toBe(
      "Solicitud de cuenta creada en estado pendiente",
    );
    cleanup.accountIds.push(Number(createResponse.body.id));

    const statusCode = await getStatusCodeById(
      "accounts",
      createResponse.body.id,
      {
        table: "account_activation_statuses",
        column: "activation_status_id",
      },
    );
    expect(statusCode).toBe("pendiente_activacion");

    const patchResponse = await request(app)
      .patch(`/api/accounts/${createResponse.body.id}/status`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({ statusCode: "activada" });

    expect(patchResponse.status).toBe(403);
    expect(patchResponse.body.message).toBe(
      "No autorizado para cambiar el estado de activacion de cuentas",
    );
  });

  test("cuentas.read lista owners_display y el detalle conserva owners", async () => {
    const createLoginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.create@example.com`,
    );

    const createResponse = await request(app)
      .post("/api/accounts")
      .set("Authorization", `Bearer ${createLoginResponse.body.token}`)
      .send({
        name: `Cuenta Owners ${TEST_PREFIX}`,
        accountTypeId: ctx.catalogIds.accountTypeId,
        registrationCode: `OWN-${TEST_PREFIX}`,
        phone: "5550002323",
        economicSectorId: ctx.catalogIds.economicSectorId,
        website: "https://owners.example.com",
        city: "CDMX",
        stateRegion: "CDMX",
        countryId: ctx.catalogIds.countryMxId,
        description: "Cuenta para validar owners_display",
        addressLine: "Direccion owners",
        postalCode: "01004",
        activationStatusId: ctx.catalogIds.accountActiveStatusId,
        ownerUserIds: [ctx.accountCreateUserId, ctx.accountReadUserId],
      });

    expect(createResponse.status).toBe(201);
    cleanup.accountIds.push(Number(createResponse.body.id));

    const readLoginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.read@example.com`,
    );

    const listResponse = await request(app)
      .get("/api/accounts")
      .set("Authorization", `Bearer ${readLoginResponse.body.token}`);

    expect(listResponse.status).toBe(200);

    const createdAccount = listResponse.body.find(
      (account) => Number(account.id) === Number(createResponse.body.id),
    );

    expect(createdAccount).toBeTruthy();
    expect(createdAccount.owners_display).toBe(
      "API Account Create, API Account Read",
    );

    const detailResponse = await request(app)
      .get(`/api/accounts/${createResponse.body.id}`)
      .set("Authorization", `Bearer ${readLoginResponse.body.token}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.owners).toHaveLength(2);
    expect(detailResponse.body.owners.map((owner) => owner.full_name)).toEqual([
      "API Account Create",
      "API Account Read",
    ]);
    expect(detailResponse.body.owners.map((owner) => owner.status)).toEqual([
      "active",
      "active",
    ]);
  });

  test("usuarios.update bloquea desactivacion si dejaria cuentas activas sin propietarios activos", async () => {
    const guardedOwnerUserId = await createUser({
      fullName: "API Sole Active Owner",
      email: `${TEST_PREFIX}.sole.active.owner@example.com`,
      roleIds: [ctx.sellerRoleId],
    });
    cleanup.userIds.push(guardedOwnerUserId);

    const guardedAccountId = await createDirectAccount({
      ownerUserId: guardedOwnerUserId,
      actorUserId: guardedOwnerUserId,
      suffix: `${TEST_PREFIX}_guarded_owner`,
    });
    cleanup.accountIds.push(guardedAccountId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.users.crud@example.com`,
    );

    const response = await request(app)
      .patch(`/api/users/${guardedOwnerUserId}/status`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({ status: "inactive" });

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(
      "No es posible desactivar al usuario porque dejaria cuentas activas sin propietarios activos",
    );
    expect(response.body.accounts).toEqual([
      {
        id: guardedAccountId,
        name: `Cuenta fixture ${TEST_PREFIX}_guarded_owner`,
      },
    ]);

    const persistedRows = await query(
      "SELECT status FROM users WHERE id = ? LIMIT 1",
      [guardedOwnerUserId],
    );

    expect(persistedRows[0].status).toBe("active");
  });

  test("usuarios.update permite desactivar si queda otro propietario activo y cuentas.read marca propietarios inactivos", async () => {
    const activeOwnerUserId = await createUser({
      fullName: "API Active Co Owner",
      email: `${TEST_PREFIX}.active.co.owner@example.com`,
      roleIds: [ctx.accountReadRoleId],
    });
    const inactiveOwnerUserId = await createUser({
      fullName: "API Inactive Co Owner",
      email: `${TEST_PREFIX}.inactive.co.owner@example.com`,
      roleIds: [ctx.sellerRoleId],
    });
    cleanup.userIds.push(activeOwnerUserId, inactiveOwnerUserId);

    const loginCreateResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.create@example.com`,
    );

    const createResponse = await request(app)
      .post("/api/accounts")
      .set("Authorization", `Bearer ${loginCreateResponse.body.token}`)
      .send({
        name: `Cuenta Owners Inactive ${TEST_PREFIX}`,
        accountTypeId: ctx.catalogIds.accountTypeId,
        registrationCode: `OWN-INACTIVE-${TEST_PREFIX}`,
        phone: "5550002424",
        economicSectorId: ctx.catalogIds.economicSectorId,
        website: "https://owners-inactive.example.com",
        city: "CDMX",
        stateRegion: "CDMX",
        countryId: ctx.catalogIds.countryMxId,
        description: "Cuenta para validar propietarios inactivos",
        addressLine: "Direccion owners inactive",
        postalCode: "01005",
        activationStatusId: ctx.catalogIds.accountActiveStatusId,
        ownerUserIds: [activeOwnerUserId, inactiveOwnerUserId],
      });

    expect(createResponse.status).toBe(201);
    cleanup.accountIds.push(Number(createResponse.body.id));

    const loginUserCrudResponse = await login(
      request(app),
      `${TEST_PREFIX}.users.crud@example.com`,
    );

    const deactivateResponse = await request(app)
      .patch(`/api/users/${inactiveOwnerUserId}/status`)
      .set("Authorization", `Bearer ${loginUserCrudResponse.body.token}`)
      .send({ status: "inactive" });

    expect(deactivateResponse.status).toBe(200);
    expect(deactivateResponse.body.message).toBe("Usuario desactivado");

    const readLoginResponse = await login(
      request(app),
      `${TEST_PREFIX}.active.co.owner@example.com`,
    );

    const listResponse = await request(app)
      .get("/api/accounts")
      .set("Authorization", `Bearer ${readLoginResponse.body.token}`);

    expect(listResponse.status).toBe(200);

    const createdAccount = listResponse.body.find(
      (account) => Number(account.id) === Number(createResponse.body.id),
    );

    expect(createdAccount).toBeTruthy();
    expect(createdAccount.owners_display).toBe(
      "API Active Co Owner, API Inactive Co Owner (inactivo)",
    );

    const detailResponse = await request(app)
      .get(`/api/accounts/${createResponse.body.id}`)
      .set("Authorization", `Bearer ${readLoginResponse.body.token}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.owners.map((owner) => owner.status)).toEqual([
      "active",
      "inactive",
    ]);
  });

  test("cuentas.put permite editar sin cambiar estado y bloquea cambio de estado sin cuentas.create", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.request@example.com`,
    );

    const createResponse = await request(app)
      .post("/api/accounts")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Cuenta PUT ${TEST_PREFIX}`,
        accountTypeId: ctx.catalogIds.accountTypeId,
        registrationCode: `PUT-${TEST_PREFIX}`,
        phone: "5550003333",
        economicSectorId: ctx.catalogIds.economicSectorId,
        website: "https://put.example.com",
        city: "CDMX",
        stateRegion: "CDMX",
        countryId: ctx.catalogIds.countryMxId,
        description: "Cuenta para validar PUT",
        addressLine: "Direccion put",
        postalCode: "01003",
        activationStatusId: ctx.catalogIds.accountActiveStatusId,
        ownerUserIds: [ctx.accountRequestUserId],
      });

    cleanup.accountIds.push(Number(createResponse.body.id));

    const sameStatusPut = await request(app)
      .put(`/api/accounts/${createResponse.body.id}`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Cuenta PUT ${TEST_PREFIX} editada`,
        accountTypeId: ctx.catalogIds.accountTypeId,
        registrationCode: `PUT-${TEST_PREFIX}`,
        phone: "5550003334",
        economicSectorId: ctx.catalogIds.economicSectorId,
        website: "https://put-edited.example.com",
        city: "CDMX",
        stateRegion: "CDMX",
        countryId: ctx.catalogIds.countryMxId,
        description: "Cuenta para validar PUT sin cambiar estado",
        addressLine: "Direccion put",
        postalCode: "01003",
        activationStatusId: ctx.catalogIds.accountPendingStatusId,
        ownerUserIds: [ctx.accountRequestUserId],
      });

    expect(sameStatusPut.status).toBe(200);
    expect(sameStatusPut.body.message).toBe("Cuenta actualizada");

    const blockedStatusPut = await request(app)
      .put(`/api/accounts/${createResponse.body.id}`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Cuenta PUT ${TEST_PREFIX} activacion`,
        accountTypeId: ctx.catalogIds.accountTypeId,
        registrationCode: `PUT-${TEST_PREFIX}`,
        phone: "5550003335",
        economicSectorId: ctx.catalogIds.economicSectorId,
        website: "https://put-blocked.example.com",
        city: "CDMX",
        stateRegion: "CDMX",
        countryId: ctx.catalogIds.countryMxId,
        description: "Cuenta para validar bloqueo de activacion",
        addressLine: "Direccion put",
        postalCode: "01003",
        activationStatusId: ctx.catalogIds.accountActiveStatusId,
        ownerUserIds: [ctx.accountRequestUserId],
      });

    expect(blockedStatusPut.status).toBe(403);
    expect(blockedStatusPut.body.message).toBe(
      "No autorizado para cambiar el estado de activacion de cuentas",
    );
  });

  test("cuentas.update bloquea desactivar una cuenta si tiene contactos activos", async () => {
    const guardedAccountId = await createDirectAccount({
      ownerUserId: ctx.accountCreateUserId,
      actorUserId: ctx.accountCreateUserId,
      suffix: `${TEST_PREFIX}_account_active_contacts`,
    });
    cleanup.accountIds.push(guardedAccountId);

    const activeContactId = await createDirectContact({
      accountId: guardedAccountId,
      actorUserId: ctx.accountCreateUserId,
      suffix: `${TEST_PREFIX}_account_active_contacts`,
    });
    cleanup.contactIds.push(activeContactId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.create@example.com`,
    );

    const patchResponse = await request(app)
      .patch(`/api/accounts/${guardedAccountId}/status`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({ statusCode: "desactivada" });

    expect(patchResponse.status).toBe(409);
    expect(patchResponse.body.message).toBe(
      "No es posible desactivar la cuenta porque tiene contactos activos",
    );

    const statusCode = await getStatusCodeById("accounts", guardedAccountId, {
      table: "account_activation_statuses",
      column: "activation_status_id",
    });
    expect(statusCode).toBe("activada");
  });

  test("cuentas.update bloquea marcar una cuenta como pendiente si tiene contactos activos o desactivados", async () => {
    const accountWithInactiveContactsId = await createDirectAccount({
      ownerUserId: ctx.accountCreateUserId,
      actorUserId: ctx.accountCreateUserId,
      suffix: `${TEST_PREFIX}_account_inactive_contacts`,
    });
    cleanup.accountIds.push(accountWithInactiveContactsId);

    const inactiveContactId = await createDirectContact({
      accountId: accountWithInactiveContactsId,
      actorUserId: ctx.accountCreateUserId,
      suffix: `${TEST_PREFIX}_account_inactive_contacts`,
    });
    cleanup.contactIds.push(inactiveContactId);

    await query("UPDATE contacts SET activation_status_id = ? WHERE id = ?", [
      ctx.catalogIds.contactInactiveStatusId,
      inactiveContactId,
    ]);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.create@example.com`,
    );

    const patchResponse = await request(app)
      .patch(`/api/accounts/${accountWithInactiveContactsId}/status`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({ statusCode: "pendiente_activacion" });

    expect(patchResponse.status).toBe(409);
    expect(patchResponse.body.message).toBe(
      "No es posible marcar la cuenta como pendiente porque tiene contactos activos o desactivados",
    );

    const statusCode = await getStatusCodeById(
      "accounts",
      accountWithInactiveContactsId,
      {
        table: "account_activation_statuses",
        column: "activation_status_id",
      },
    );
    expect(statusCode).toBe("activada");
  });

  test("contactos.request crea pendiente y no permite activar sin contactos.create", async () => {
    const contactOwnedAccountId = await createDirectAccount({
      ownerUserId: ctx.contactRequestUserId,
      actorUserId: ctx.contactRequestUserId,
      suffix: `${TEST_PREFIX}_contact_request`,
    });
    cleanup.accountIds.push(contactOwnedAccountId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.contacts.request@example.com`,
    );

    const createResponse = await request(app)
      .post("/api/contacts")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        firstName: "Contacto",
        lastName: `API ${TEST_PREFIX}`,
        accountId: contactOwnedAccountId,
        positionTitle: "Analista",
        phone: "5551010101",
        phoneExtension: "101",
        mobile: `551${String(Date.now()).slice(-7)}`,
        email: `${TEST_PREFIX}.contact@example.com`,
        department: "Compras",
        countryId: ctx.catalogIds.countryMxId,
        stateRegion: "CDMX",
        city: "Ciudad de Mexico",
        addressLine: "Direccion prueba",
        postalCode: "01002",
        purchaseParticipationId: ctx.catalogIds.purchaseParticipationNoneId,
        relationshipTypeId: ctx.catalogIds.relationshipTypeNoneId,
        employmentStatusId: ctx.catalogIds.employmentStatusId,
        activationStatusId: ctx.catalogIds.contactActiveStatusId,
        managerContactId: null,
        influencesContactId: null,
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.message).toBe(
      "Solicitud de contacto creada en estado pendiente",
    );
    cleanup.contactIds.push(Number(createResponse.body.id));

    const statusCode = await getStatusCodeById(
      "contacts",
      createResponse.body.id,
      {
        table: "contact_activation_statuses",
        column: "activation_status_id",
      },
    );
    expect(statusCode).toBe("pendiente_activacion");

    const patchResponse = await request(app)
      .patch(`/api/contacts/${createResponse.body.id}/status`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({ statusCode: "activado" });

    expect(patchResponse.status).toBe(403);
    expect(patchResponse.body.message).toBe(
      "No autorizado para cambiar el estado de activacion de contactos",
    );
  });

  test("contactos.put permite editar sin cambiar estado y bloquea cambio de estado sin contactos.create", async () => {
    const contactOwnedAccountId = await createDirectAccount({
      ownerUserId: ctx.contactRequestUserId,
      actorUserId: ctx.contactRequestUserId,
      suffix: `${TEST_PREFIX}_contact_put`,
    });
    cleanup.accountIds.push(contactOwnedAccountId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.contacts.request@example.com`,
    );

    const createResponse = await request(app)
      .post("/api/contacts")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        firstName: "Contacto",
        lastName: `PUT ${TEST_PREFIX}`,
        accountId: contactOwnedAccountId,
        positionTitle: "Analista",
        phone: "5552020202",
        phoneExtension: "202",
        mobile: `552${String(Date.now()).slice(-7)}`,
        email: `${TEST_PREFIX}.contact.put@example.com`,
        department: "Compras",
        countryId: ctx.catalogIds.countryMxId,
        stateRegion: "CDMX",
        city: "Ciudad de Mexico",
        addressLine: "Direccion put contacto",
        postalCode: "01004",
        purchaseParticipationId: ctx.catalogIds.purchaseParticipationNoneId,
        relationshipTypeId: ctx.catalogIds.relationshipTypeNoneId,
        employmentStatusId: ctx.catalogIds.employmentStatusId,
        activationStatusId: ctx.catalogIds.contactActiveStatusId,
        managerContactId: null,
        influencesContactId: null,
      });

    cleanup.contactIds.push(Number(createResponse.body.id));

    const sameStatusPut = await request(app)
      .put(`/api/contacts/${createResponse.body.id}`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        firstName: "Contacto",
        lastName: `PUT ${TEST_PREFIX} editado`,
        accountId: contactOwnedAccountId,
        positionTitle: "Analista Senior",
        phone: "5552020203",
        phoneExtension: "203",
        mobile: `552${String(Date.now()).slice(-7)}`,
        email: `${TEST_PREFIX}.contact.put.edited@example.com`,
        department: "Compras",
        countryId: ctx.catalogIds.countryMxId,
        stateRegion: "CDMX",
        city: "Ciudad de Mexico",
        addressLine: "Direccion put contacto",
        postalCode: "01004",
        purchaseParticipationId: ctx.catalogIds.purchaseParticipationNoneId,
        relationshipTypeId: ctx.catalogIds.relationshipTypeNoneId,
        employmentStatusId: ctx.catalogIds.employmentStatusId,
        activationStatusId: ctx.catalogIds.contactPendingStatusId,
        managerContactId: null,
        influencesContactId: null,
      });

    expect(sameStatusPut.status).toBe(200);
    expect(sameStatusPut.body.message).toBe("Contacto actualizado");

    const blockedStatusPut = await request(app)
      .put(`/api/contacts/${createResponse.body.id}`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        firstName: "Contacto",
        lastName: `PUT ${TEST_PREFIX} activacion`,
        accountId: contactOwnedAccountId,
        positionTitle: "Analista Senior",
        phone: "5552020204",
        phoneExtension: "204",
        mobile: `552${String(Date.now()).slice(-7)}`,
        email: `${TEST_PREFIX}.contact.put.blocked@example.com`,
        department: "Compras",
        countryId: ctx.catalogIds.countryMxId,
        stateRegion: "CDMX",
        city: "Ciudad de Mexico",
        addressLine: "Direccion put contacto",
        postalCode: "01004",
        purchaseParticipationId: ctx.catalogIds.purchaseParticipationNoneId,
        relationshipTypeId: ctx.catalogIds.relationshipTypeNoneId,
        employmentStatusId: ctx.catalogIds.employmentStatusId,
        activationStatusId: ctx.catalogIds.contactActiveStatusId,
        managerContactId: null,
        influencesContactId: null,
      });

    expect(blockedStatusPut.status).toBe(403);
    expect(blockedStatusPut.body.message).toBe(
      "No autorizado para cambiar el estado de activacion de contactos",
    );
  });

  test("contactos.update bloquea desactivar un contacto si tiene oportunidades activas", async () => {
    const guardedAccountId = await createDirectAccount({
      ownerUserId: ctx.contactCreateUserId,
      actorUserId: ctx.contactCreateUserId,
      suffix: `${TEST_PREFIX}_contact_active_opps`,
    });
    cleanup.accountIds.push(guardedAccountId);

    const guardedContactId = await createDirectContact({
      accountId: guardedAccountId,
      actorUserId: ctx.contactCreateUserId,
      suffix: `${TEST_PREFIX}_contact_active_opps`,
    });
    cleanup.contactIds.push(guardedContactId);

    const now = new Date();
    const insertResult = await query(
      `INSERT INTO opportunities
        (name, amount_usd, account_id, close_date, contact_id,
         sales_stage_id, business_line_id, seller_user_id, presales_user_id, activation_status_id,
         commercial_status_id, created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `Oportunidad contacto ${TEST_PREFIX}`,
        17500,
        guardedAccountId,
        "2026-11-30",
        guardedContactId,
        ctx.catalogIds.salesStageInitialId,
        ctx.catalogIds.businessLineId,
        ctx.sellerUserId,
        null,
        ctx.catalogIds.opportunityActiveStatusId,
        ctx.catalogIds.opportunityCommercialInProgressStatusId,
        ctx.contactCreateUserId,
        now,
        ctx.contactCreateUserId,
        now,
      ],
    );
    cleanup.opportunityIds.push(Number(insertResult.insertId));

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.contacts.create@example.com`,
    );

    const patchResponse = await request(app)
      .patch(`/api/contacts/${guardedContactId}/status`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({ statusCode: "desactivado" });

    expect(patchResponse.status).toBe(409);
    expect(patchResponse.body.message).toBe(
      "No es posible desactivar el contacto porque tiene oportunidades activas",
    );

    const statusCode = await getStatusCodeById("contacts", guardedContactId, {
      table: "contact_activation_statuses",
      column: "activation_status_id",
    });
    expect(statusCode).toBe("activado");
  });

  test("contactos.update bloquea marcar un contacto como pendiente si tiene oportunidades activas o desactivadas", async () => {
    const guardedAccountId = await createDirectAccount({
      ownerUserId: ctx.contactCreateUserId,
      actorUserId: ctx.contactCreateUserId,
      suffix: `${TEST_PREFIX}_contact_pending_opps`,
    });
    cleanup.accountIds.push(guardedAccountId);

    const guardedContactId = await createDirectContact({
      accountId: guardedAccountId,
      actorUserId: ctx.contactCreateUserId,
      suffix: `${TEST_PREFIX}_contact_pending_opps`,
    });
    cleanup.contactIds.push(guardedContactId);

    const now = new Date();
    const insertResult = await query(
      `INSERT INTO opportunities
        (name, amount_usd, account_id, close_date, contact_id,
         sales_stage_id, business_line_id, seller_user_id, presales_user_id, activation_status_id,
         commercial_status_id, created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `Oportunidad pendiente contacto ${TEST_PREFIX}`,
        22000,
        guardedAccountId,
        "2026-10-31",
        guardedContactId,
        ctx.catalogIds.salesStageInitialId,
        ctx.catalogIds.businessLineId,
        ctx.sellerUserId,
        null,
        ctx.catalogIds.opportunityInactiveStatusId,
        ctx.catalogIds.opportunityCommercialInProgressStatusId,
        ctx.contactCreateUserId,
        now,
        ctx.contactCreateUserId,
        now,
      ],
    );
    cleanup.opportunityIds.push(Number(insertResult.insertId));

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.contacts.create@example.com`,
    );

    const patchResponse = await request(app)
      .patch(`/api/contacts/${guardedContactId}/status`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({ statusCode: "pendiente_activacion" });

    expect(patchResponse.status).toBe(409);
    expect(patchResponse.body.message).toBe(
      "No es posible marcar el contacto como pendiente porque tiene oportunidades activas o desactivadas",
    );

    const statusCode = await getStatusCodeById("contacts", guardedContactId, {
      table: "contact_activation_statuses",
      column: "activation_status_id",
    });
    expect(statusCode).toBe("activado");
  });

  test("oportunidades.request crea pendiente y no permite activar sin oportunidades.create", async () => {
    const opportunityOwnedAccountId = await createDirectAccount({
      ownerUserId: ctx.opportunityRequestUserId,
      actorUserId: ctx.opportunityRequestUserId,
      suffix: `${TEST_PREFIX}_opportunity_request`,
    });
    cleanup.accountIds.push(opportunityOwnedAccountId);

    const opportunityOwnedContactId = await createDirectContact({
      accountId: opportunityOwnedAccountId,
      actorUserId: ctx.opportunityRequestUserId,
      suffix: `${TEST_PREFIX}_opportunity_request`,
    });
    cleanup.contactIds.push(opportunityOwnedContactId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.opps.request@example.com`,
    );

    const createResponse = await request(app)
      .post("/api/opportunities")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Oportunidad API ${TEST_PREFIX}`,
        amountUsd: 25000,
        accountId: opportunityOwnedAccountId,
        closeDate: "2026-12-31",
        contactId: opportunityOwnedContactId,
        salesStageId: ctx.catalogIds.salesStageInitialId,
        businessLineId: ctx.catalogIds.businessLineId,
        sellerUserId: ctx.sellerUserId,
        presalesUserId: null,
        activationStatusId: ctx.catalogIds.opportunityActiveStatusId,
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.message).toBe(
      "Solicitud de oportunidad creada en estado pendiente",
    );
    cleanup.opportunityIds.push(Number(createResponse.body.id));

    const statusCode = await getStatusCodeById(
      "opportunities",
      createResponse.body.id,
      {
        table: "opportunity_activation_statuses",
        column: "activation_status_id",
      },
    );
    expect(statusCode).toBe("pendiente_activacion");

    const patchResponse = await request(app)
      .patch(`/api/opportunities/${createResponse.body.id}/status`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({ statusCode: "activada" });

    expect(patchResponse.status).toBe(403);
    expect(patchResponse.body.message).toBe(
      "No autorizado para cambiar el estado de activacion de oportunidades",
    );
  });

  test("oportunidades.put permite editar sin cambiar estado y bloquea cambio de estado sin oportunidades.create", async () => {
    const opportunityOwnedAccountId = await createDirectAccount({
      ownerUserId: ctx.opportunityRequestUserId,
      actorUserId: ctx.opportunityRequestUserId,
      suffix: `${TEST_PREFIX}_opportunity_put`,
    });
    cleanup.accountIds.push(opportunityOwnedAccountId);

    const opportunityOwnedContactId = await createDirectContact({
      accountId: opportunityOwnedAccountId,
      actorUserId: ctx.opportunityRequestUserId,
      suffix: `${TEST_PREFIX}_opportunity_put`,
    });
    cleanup.contactIds.push(opportunityOwnedContactId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.opps.request@example.com`,
    );

    const createResponse = await request(app)
      .post("/api/opportunities")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Oportunidad PUT ${TEST_PREFIX}`,
        amountUsd: 33000,
        accountId: opportunityOwnedAccountId,
        closeDate: "2026-11-30",
        contactId: opportunityOwnedContactId,
        salesStageId: ctx.catalogIds.salesStageInitialId,
        businessLineId: ctx.catalogIds.businessLineId,
        sellerUserId: ctx.sellerUserId,
        presalesUserId: null,
        activationStatusId: ctx.catalogIds.opportunityActiveStatusId,
      });

    cleanup.opportunityIds.push(Number(createResponse.body.id));

    const sameStatusPut = await request(app)
      .put(`/api/opportunities/${createResponse.body.id}`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Oportunidad PUT ${TEST_PREFIX} editada`,
        amountUsd: 34000,
        accountId: opportunityOwnedAccountId,
        closeDate: "2026-12-15",
        contactId: opportunityOwnedContactId,
        salesStageId: ctx.catalogIds.salesStageInitialId,
        businessLineId: ctx.catalogIds.businessLineId,
        sellerUserId: ctx.sellerUserId,
        presalesUserId: null,
        activationStatusId: ctx.catalogIds.opportunityPendingStatusId,
      });

    expect(sameStatusPut.status).toBe(200);
    expect(sameStatusPut.body.message).toBe("Oportunidad actualizada");

    const blockedStatusPut = await request(app)
      .put(`/api/opportunities/${createResponse.body.id}`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Oportunidad PUT ${TEST_PREFIX} activacion`,
        amountUsd: 35000,
        accountId: opportunityOwnedAccountId,
        closeDate: "2026-12-20",
        contactId: opportunityOwnedContactId,
        salesStageId: ctx.catalogIds.salesStageInitialId,
        businessLineId: ctx.catalogIds.businessLineId,
        sellerUserId: ctx.sellerUserId,
        presalesUserId: null,
        activationStatusId: ctx.catalogIds.opportunityActiveStatusId,
      });

    expect(blockedStatusPut.status).toBe(403);
    expect(blockedStatusPut.body.message).toBe(
      "No autorizado para cambiar el estado de activacion de oportunidades",
    );
  });

  test("oportunidades.put persiste un cambio de etapa solo cuando llega en guardar cambios", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_put_stage_change`,
    );
    const [firstQuestion] =
      await getStageQuestionRowsByCode("contacto_inicial");

    const saveAnswersResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/stage-answers`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        answers: [
          {
            questionId: Number(firstQuestion.id),
            answerValue: "Cliente interesado en renovación de plataforma",
          },
        ],
      });
    expect(saveAnswersResponse.status).toBe(200);

    const putResponse = await request(app)
      .put(`/api/opportunities/${fixture.opportunityId}`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        name: `Oportunidad flujo ${TEST_PREFIX}_put_stage_change`,
        amountUsd: 41000,
        accountId: fixture.accountId,
        closeDate: "2026-12-31",
        contactId: fixture.contactId,
        salesStageId: ctx.catalogIds.salesStageIdentificationId,
        businessLineId: ctx.catalogIds.businessLineId,
        sellerUserId: ctx.sellerUserId,
        presalesUserId: null,
        activationStatusId: ctx.catalogIds.opportunityPendingStatusId,
        stageChangeMode: "advance",
      });

    expect(putResponse.status).toBe(200);

    const snapshot = await getOpportunityCommercialSnapshot(
      fixture.opportunityId,
    );
    expect(snapshot.sales_stage_code).toBe("identificacion_oportunidad");

    const auditRows = await getAuditActionsForOpportunity(
      fixture.opportunityId,
      "stage_advanced",
    );
    expect(auditRows.length).toBe(1);
  });

  test("oportunidades.put persiste el cierre comercial perdida solo al guardar cambios", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_put_commercial_close_lost`,
    );

    const putResponse = await request(app)
      .put(`/api/opportunities/${fixture.opportunityId}`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        name: `Oportunidad flujo ${TEST_PREFIX}_put_commercial_close_lost`,
        amountUsd: 41000,
        accountId: fixture.accountId,
        closeDate: "2026-12-31",
        contactId: fixture.contactId,
        salesStageId: ctx.catalogIds.salesStageInitialId,
        businessLineId: ctx.catalogIds.businessLineId,
        sellerUserId: ctx.sellerUserId,
        presalesUserId: null,
        activationStatusId: ctx.catalogIds.opportunityPendingStatusId,
        commercialStatusCode: "perdida",
        commercialCloseReason: "El cliente pausó definitivamente el proyecto",
      });

    expect(putResponse.status).toBe(200);

    const snapshot = await getOpportunityCommercialSnapshot(
      fixture.opportunityId,
    );
    expect(snapshot.commercial_status_code).toBe("perdida");
    expect(snapshot.commercial_close_reason).toBe(
      "El cliente pausó definitivamente el proyecto",
    );

    const auditRows = await getAuditActionsForOpportunity(
      fixture.opportunityId,
      "commercial_closed",
    );
    expect(auditRows.length).toBe(1);
  });

  test("oportunidades.create fuerza Contacto Inicial y En proceso aunque el cliente envie otros valores", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_create_defaults`,
    );

    const snapshot = await getOpportunityCommercialSnapshot(
      fixture.opportunityId,
    );
    expect(snapshot.sales_stage_code).toBe("contacto_inicial");
    expect(snapshot.commercial_status_code).toBe("en_proceso");
    expect(snapshot.activation_status_code).toBe("pendiente_activacion");
  });

  test("oportunidades.commercial-context devuelve la etapa actual, estado comercial y preguntas vigentes", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_context`,
    );

    const contextResponse = await request(app)
      .get(`/api/opportunities/${fixture.opportunityId}/commercial-context`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(contextResponse.status).toBe(200);
    expect(contextResponse.body.salesStage.code).toBe("contacto_inicial");
    expect(contextResponse.body.commercialStatus.code).toBe("en_proceso");
    expect(contextResponse.body.answers).toHaveLength(1);
    expect(contextResponse.body.answers[0].code).toBe(
      "contacto_inicial_interes_cliente",
    );
    expect(contextResponse.body.answers[0].answer_value).toBeNull();
    expect(contextResponse.body.currentSalesStage.code).toBe(
      "contacto_inicial",
    );
    expect(Array.isArray(contextResponse.body.stages)).toBe(true);
    expect(contextResponse.body.isSelectedStageCurrent).toBe(true);
  });

  test("oportunidades.stage-view devuelve una etapa arbitraria en modo lectura sin perder la etapa actual", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_stage_view`,
    );
    const waitingStageRows = await query(
      `SELECT id FROM opportunity_sales_stages WHERE code = 'waiting' LIMIT 1`,
    );
    const waitingStageId = Number(waitingStageRows[0].id);

    const stageViewResponse = await request(app)
      .get(
        `/api/opportunities/${fixture.opportunityId}/stage-view/${waitingStageId}`,
      )
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(stageViewResponse.status).toBe(200);
    expect(stageViewResponse.body.salesStage.code).toBe("waiting");
    expect(stageViewResponse.body.currentSalesStage.code).toBe(
      "contacto_inicial",
    );
    expect(stageViewResponse.body.isSelectedStageCurrent).toBe(false);
    expect(stageViewResponse.body.answers).toHaveLength(1);
    expect(stageViewResponse.body.answers[0].code).toBe(
      "waiting_acuerdo_o_postores",
    );
    expect(stageViewResponse.body.answers[0].answer_value).toBeNull();
    expect(stageViewResponse.body.bypassInfo).toEqual({
      isBypassed: false,
      reason: null,
    });
  });

  test("oportunidades.commercial-context expone motivo de bypass para la etapa destino del bypass", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_bypass_reason_context`,
    );

    const bypassResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/stage-bypass`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ reason: "Se omitio por criterio externo de preventa" });

    expect(bypassResponse.status).toBe(200);

    const contextResponse = await request(app)
      .get(`/api/opportunities/${fixture.opportunityId}/commercial-context`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(contextResponse.status).toBe(200);
    expect(contextResponse.body.salesStage.code).toBe(
      "identificacion_oportunidad",
    );
    expect(contextResponse.body.currentSalesStage.code).toBe(
      "identificacion_oportunidad",
    );
    expect(contextResponse.body.bypassInfo).toEqual({
      isBypassed: true,
      reason: "Se omitio por criterio externo de preventa",
    });
  });

  test("oportunidades.stage-answers guarda historico y commercial-context expone la ultima respuesta", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_answers`,
    );
    const [firstQuestion] =
      await getStageQuestionRowsByCode("contacto_inicial");

    const firstSaveResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/stage-answers`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        answers: [
          {
            questionId: Number(firstQuestion.id),
            answerValue: "Interes inicial en balanceo de carga",
          },
        ],
      });

    expect(firstSaveResponse.status).toBe(200);

    const secondSaveResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/stage-answers`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        answers: [
          {
            questionId: Number(firstQuestion.id),
            answerValue:
              "Interes inicial actualizado en seguridad de aplicaciones",
          },
        ],
      });

    expect(secondSaveResponse.status).toBe(200);

    const answerRows = await query(
      `SELECT COUNT(*) AS total
       FROM opportunity_stage_question_answers
       WHERE opportunity_id = ?
         AND question_id = ?`,
      [fixture.opportunityId, Number(firstQuestion.id)],
    );
    expect(Number(answerRows[0].total)).toBe(2);

    const contextResponse = await request(app)
      .get(`/api/opportunities/${fixture.opportunityId}/commercial-context`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(contextResponse.status).toBe(200);
    expect(contextResponse.body.answers[0].answer_value).toBe(
      "Interes inicial actualizado en seguridad de aplicaciones",
    );

    const auditRows = await getAuditActionsForOpportunity(
      fixture.opportunityId,
      "stage_answers_saved",
    );
    expect(auditRows.length).toBe(2);
  });

  test("oportunidades.stage-transition rechaza avance sin obligatorias y permite avanzar con respuestas completas", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_advance`,
    );

    const blockedAdvanceResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/stage-transition`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ direction: "advance" });

    expect(blockedAdvanceResponse.status).toBe(400);
    expect(blockedAdvanceResponse.body.message).toBe(
      "Debes responder todas las preguntas obligatorias de la etapa actual",
    );

    const [firstQuestion] =
      await getStageQuestionRowsByCode("contacto_inicial");
    const saveAnswersResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/stage-answers`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        answers: [
          {
            questionId: Number(firstQuestion.id),
            answerValue: "Cliente interesado en renovación de plataforma",
          },
        ],
      });
    expect(saveAnswersResponse.status).toBe(200);

    const advanceResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/stage-transition`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ direction: "advance" });

    expect(advanceResponse.status).toBe(200);
    expect(advanceResponse.body.salesStageCode).toBe(
      "identificacion_oportunidad",
    );

    const snapshot = await getOpportunityCommercialSnapshot(
      fixture.opportunityId,
    );
    expect(snapshot.sales_stage_code).toBe("identificacion_oportunidad");

    const auditRows = await getAuditActionsForOpportunity(
      fixture.opportunityId,
      "stage_advanced",
    );
    expect(auditRows.length).toBe(1);
  });

  test("oportunidades.stage-transition permite retroceder mientras este En proceso y bloquea movimientos tras cierre", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_retreat`,
    );
    const [firstQuestion] =
      await getStageQuestionRowsByCode("contacto_inicial");

    await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/stage-answers`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        answers: [
          {
            questionId: Number(firstQuestion.id),
            answerValue: "Cliente interesado en servicios gestionados",
          },
        ],
      });

    const advanceResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/stage-transition`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ direction: "advance" });
    expect(advanceResponse.status).toBe(200);

    const retreatResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/stage-transition`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ direction: "retreat" });

    expect(retreatResponse.status).toBe(200);
    expect(retreatResponse.body.salesStageCode).toBe("contacto_inicial");

    await query(
      `UPDATE opportunities
       SET sales_stage_id = ?, updated_at = NOW(3)
       WHERE id = ?`,
      [ctx.catalogIds.salesStageWaitingId, fixture.opportunityId],
    );

    const closeResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/commercial-close`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ statusCode: "ganada" });
    expect(closeResponse.status).toBe(200);

    const blockedRetreatResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/stage-transition`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ direction: "retreat" });

    expect(blockedRetreatResponse.status).toBe(400);
    expect(blockedRetreatResponse.body.message).toBe(
      "No puedes mover de etapa una oportunidad cerrada",
    );
  });

  test("oportunidades.put permite regresar a cualquier etapa anterior al guardar cambios", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_put_retreat_any_previous_stage`,
    );

    await query(
      `UPDATE opportunities
       SET sales_stage_id = ?, updated_at = NOW(3)
       WHERE id = ?`,
      [ctx.catalogIds.salesStageWaitingId, fixture.opportunityId],
    );

    const putResponse = await request(app)
      .put(`/api/opportunities/${fixture.opportunityId}`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        name: `Oportunidad flujo ${TEST_PREFIX}_put_retreat_any_previous_stage`,
        amountUsd: 41000,
        accountId: fixture.accountId,
        closeDate: "2026-12-31",
        contactId: fixture.contactId,
        salesStageId: ctx.catalogIds.salesStageInitialId,
        businessLineId: ctx.catalogIds.businessLineId,
        sellerUserId: ctx.sellerUserId,
        presalesUserId: null,
        activationStatusId: ctx.catalogIds.opportunityPendingStatusId,
        stageChangeMode: "retreat",
      });

    expect(putResponse.status).toBe(200);

    const snapshot = await getOpportunityCommercialSnapshot(
      fixture.opportunityId,
    );
    expect(snapshot.sales_stage_code).toBe("contacto_inicial");

    const auditRows = await getAuditActionsForOpportunity(
      fixture.opportunityId,
      "stage_retreated",
    );
    expect(auditRows.length).toBe(1);
  });

  test("oportunidades.validate-current-stage audita la validacion manual sin mover la oportunidad", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_validate_stage`,
    );

    const validateResponse = await request(app)
      .post(
        `/api/opportunities/${fixture.opportunityId}/validate-current-stage`,
      )
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ note: "Validacion registrada desde flujo manual" });

    expect(validateResponse.status).toBe(200);
    expect(validateResponse.body.message).toContain("validada");

    const snapshot = await getOpportunityCommercialSnapshot(
      fixture.opportunityId,
    );
    expect(snapshot.sales_stage_code).toBe("contacto_inicial");

    const auditRows = await getAuditActionsForOpportunity(
      fixture.opportunityId,
      "stage_validated",
    );
    expect(auditRows.length).toBe(1);
  });

  test("oportunidades.stage-bypass avanza sin validar obligatorias y audita el motivo", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_bypass_stage`,
    );

    const bypassResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/stage-bypass`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ reason: "Se omite la validacion en esta etapa" });

    expect(bypassResponse.status).toBe(200);
    expect(bypassResponse.body.salesStageCode).toBe(
      "identificacion_oportunidad",
    );

    const snapshot = await getOpportunityCommercialSnapshot(
      fixture.opportunityId,
    );
    expect(snapshot.sales_stage_code).toBe("identificacion_oportunidad");

    const auditRows = await getAuditActionsForOpportunity(
      fixture.opportunityId,
      "stage_bypassed",
    );
    expect(auditRows.length).toBe(1);
  });

  test("oportunidades.commercial-close exige motivo para perdida y anulada, y solo permite ganada desde Waiting", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_close_rules`,
    );

    const blockedWonResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/commercial-close`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ statusCode: "ganada" });

    expect(blockedWonResponse.status).toBe(400);
    expect(blockedWonResponse.body.message).toBe(
      "Solo puedes marcar como ganada una oportunidad en Waiting",
    );

    const blockedLostResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/commercial-close`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ statusCode: "perdida" });

    expect(blockedLostResponse.status).toBe(400);
    expect(blockedLostResponse.body.message).toBe(
      "Debes indicar un motivo para cerrar la oportunidad",
    );

    const lostResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/commercial-close`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        statusCode: "perdida",
        reason: "El cliente canceló el presupuesto aprobado",
      });

    expect(lostResponse.status).toBe(200);

    const snapshot = await getOpportunityCommercialSnapshot(
      fixture.opportunityId,
    );
    expect(snapshot.commercial_status_code).toBe("perdida");
    expect(snapshot.commercial_close_reason).toBe(
      "El cliente canceló el presupuesto aprobado",
    );
    expect(snapshot.activation_status_code).toBe("pendiente_activacion");

    const auditRows = await getAuditActionsForOpportunity(
      fixture.opportunityId,
      "commercial_closed",
    );
    expect(auditRows.length).toBe(1);

    const blockedCanceledResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/commercial-close`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        statusCode: "anulada",
        reason: "Intento de recierre invalido",
      });

    expect(blockedCanceledResponse.status).toBe(400);
    expect(blockedCanceledResponse.body.message).toBe(
      "La oportunidad ya tiene un cierre comercial definitivo",
    );
  });

  test("catalogos.opportunity-stage-questions-admin permite crear, editar, reordenar y desactivar preguntas", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.opps.flow@example.com`,
    );
    const token = loginResponse.body.token;
    const salesStageId = ctx.catalogIds.salesStageWaitingId;

    const initialAdminList = await request(app)
      .get("/api/catalogs/opportunity-stage-questions-admin")
      .query({ salesStageId })
      .set("Authorization", `Bearer ${token}`);

    expect(initialAdminList.status).toBe(200);
    const seededWaitingQuestionId = Number(
      initialAdminList.body.questions[0].id,
    );

    const createFirstResponse = await request(app)
      .post("/api/catalogs/opportunity-stage-questions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        salesStageId,
        prompt: "¿Cuál es el criterio final de adjudicación?",
        responseType: "long_text",
        displayOrder: 2,
        isRequired: true,
      });

    expect(createFirstResponse.status).toBe(201);
    const firstQuestionId = Number(createFirstResponse.body.question.id);
    cleanup.stageQuestionIds.push(firstQuestionId);

    const createSecondResponse = await request(app)
      .post("/api/catalogs/opportunity-stage-questions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        salesStageId,
        prompt: "¿Quién aprueba internamente la propuesta final?",
        responseType: "long_text",
        displayOrder: 3,
        isRequired: false,
      });

    expect(createSecondResponse.status).toBe(201);
    const secondQuestionId = Number(createSecondResponse.body.question.id);
    cleanup.stageQuestionIds.push(secondQuestionId);

    const updateResponse = await request(app)
      .put(`/api/catalogs/opportunity-stage-questions/${firstQuestionId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        salesStageId,
        prompt: "¿Cuál es el criterio definitivo de adjudicación?",
        responseType: "long_text",
        displayOrder: 3,
        isRequired: false,
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.question.prompt).toBe(
      "¿Cuál es el criterio definitivo de adjudicación?",
    );
    expect(Number(updateResponse.body.question.display_order)).toBe(3);
    expect(Number(updateResponse.body.question.is_required)).toBe(0);

    const reorderResponse = await request(app)
      .post("/api/catalogs/opportunity-stage-questions/reorder")
      .set("Authorization", `Bearer ${token}`)
      .send({
        salesStageId,
        questionIds: [
          secondQuestionId,
          seededWaitingQuestionId,
          firstQuestionId,
        ],
      });

    expect(reorderResponse.status).toBe(200);
    expect(reorderResponse.body.questions.map((row) => Number(row.id))).toEqual(
      [secondQuestionId, seededWaitingQuestionId, firstQuestionId],
    );

    const deactivateResponse = await request(app)
      .patch(
        `/api/catalogs/opportunity-stage-questions/${secondQuestionId}/status`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({ isActive: false });

    expect(deactivateResponse.status).toBe(200);
    expect(Number(deactivateResponse.body.question.is_active)).toBe(0);

    const adminAfterDeactivate = await request(app)
      .get("/api/catalogs/opportunity-stage-questions-admin")
      .query({ salesStageId })
      .set("Authorization", `Bearer ${token}`);

    expect(adminAfterDeactivate.status).toBe(200);
    const deactivatedQuestion = adminAfterDeactivate.body.questions.find(
      (row) => Number(row.id) === secondQuestionId,
    );
    expect(Number(deactivatedQuestion.is_active)).toBe(0);

    const activeCatalogResponse = await request(app)
      .get("/api/catalogs/opportunity-stage-questions")
      .query({ salesStageId })
      .set("Authorization", `Bearer ${token}`);

    expect(activeCatalogResponse.status).toBe(200);
    expect(
      activeCatalogResponse.body.some(
        (row) => Number(row.id) === secondQuestionId,
      ),
    ).toBe(false);
    expect(activeCatalogResponse.body.map((row) => Number(row.id))).toEqual([
      seededWaitingQuestionId,
      firstQuestionId,
    ]);
  });

  test("catalogos.opportunity-stage-questions-admin valida payload invalido", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.opps.flow@example.com`,
    );
    const token = loginResponse.body.token;

    const response = await request(app)
      .post("/api/catalogs/opportunity-stage-questions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        salesStageId: ctx.catalogIds.salesStageWaitingId,
        prompt: "mal",
        responseType: "long_text",
        displayOrder: 1,
        isRequired: true,
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "La pregunta debe tener al menos 5 caracteres",
    );
  });

  test("actualizar permisos de un rol se refleja en /api/auth/me sin volver a iniciar sesion", async () => {
    const subjectLogin = await login(
      request(app),
      `${TEST_PREFIX}.dynamic.permissions@example.com`,
    );
    const subjectToken = subjectLogin.body.token;

    const beforeMe = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${subjectToken}`);

    expect(beforeMe.status).toBe(200);
    expect(beforeMe.body.permissions).toContain("contactos.request");
    expect(beforeMe.body.permissions).not.toContain("contactos.create");

    const managerLogin = await login(
      request(app),
      `${TEST_PREFIX}.roles.manager@example.com`,
    );

    const nextPermissionIds = await getPermissionIds([
      "contactos.create",
      "contactos.update",
    ]);

    const updateResponse = await request(app)
      .put(`/api/roles/${ctx.dynamicPermissionRoleId}/permissions`)
      .set("Authorization", `Bearer ${managerLogin.body.token}`)
      .send({ permissionIds: nextPermissionIds });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.message).toBe("Permisos del rol actualizados");

    const afterMe = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${subjectToken}`);

    expect(afterMe.status).toBe(200);
    expect(afterMe.body.permissions).toContain("contactos.create");
    expect(afterMe.body.permissions).toContain("contactos.update");
    expect(afterMe.body.permissions).not.toContain("contactos.request");
  });

  test("roles.update bloquea desactivar un rol si todavia tiene usuarios asignados", async () => {
    const managerLogin = await login(
      request(app),
      `${TEST_PREFIX}.roles.manager@example.com`,
    );

    const deactivateResponse = await request(app)
      .patch(`/api/roles/${ctx.dynamicPermissionRoleId}/status`)
      .set("Authorization", `Bearer ${managerLogin.body.token}`)
      .send({ isActive: false });

    expect(deactivateResponse.status).toBe(409);
    expect(deactivateResponse.body.message).toBe(
      "No se puede desactivar un rol que tiene usuarios asignados",
    );

    const roleRows = await query(
      "SELECT is_active FROM roles WHERE id = ? LIMIT 1",
      [ctx.dynamicPermissionRoleId],
    );

    expect(roleRows).toHaveLength(1);
    expect(Number(roleRows[0].is_active)).toBe(1);
  });
});
