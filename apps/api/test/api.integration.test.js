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
    ctx.opportunityRequestRoleId = await createRole({
      name: `${TEST_PREFIX}_opps_request`,
      permissionCodes: ["oportunidades.request", "oportunidades.update"],
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
      ctx.opportunityRequestRoleId,
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
      contactPendingStatusId: await getCatalogId(
        "contact_activation_statuses",
        "pendiente_activacion",
      ),
      salesStageInitialId: await getCatalogId(
        "opportunity_sales_stages",
        "contacto_inicial",
      ),
      businessLineId: await getFirstId("opportunity_business_lines"),
      opportunityActiveStatusId: await getCatalogId(
        "opportunity_activation_statuses",
        "activada",
      ),
      opportunityPendingStatusId: await getCatalogId(
        "opportunity_activation_statuses",
        "pendiente_activacion",
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
    ctx.opportunityRequestUserId = await createUser({
      fullName: "API Opportunity Request",
      email: `${TEST_PREFIX}.opps.request@example.com`,
      roleIds: [ctx.opportunityRequestRoleId],
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
      ctx.opportunityRequestUserId,
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
      .get(`/api/auth/set-password-context?token=${encodeURIComponent(setupToken)}`)
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

    const loginWithNewPasswordResponse = await request(app).post("/api/auth/login").send({
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
    expect(reusedTokenResponse.body.message).toBe("Este enlace ya fue utilizado");

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

    expect(auditRows.some((row) => row.action === "invitation_email_failed")).toBe(
      true,
    );
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

    const statusCode = await getStatusCodeById("accounts", createResponse.body.id, {
      table: "account_activation_statuses",
      column: "activation_status_id",
    });
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

    const statusCode = await getStatusCodeById("contacts", createResponse.body.id, {
      table: "contact_activation_statuses",
      column: "activation_status_id",
    });
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
    expect(updateResponse.body.message).toBe(
      "Permisos del rol actualizados",
    );

    const afterMe = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${subjectToken}`);

    expect(afterMe.status).toBe(200);
    expect(afterMe.body.permissions).toContain("contactos.create");
    expect(afterMe.body.permissions).toContain("contactos.update");
    expect(afterMe.body.permissions).not.toContain("contactos.request");
  });
});