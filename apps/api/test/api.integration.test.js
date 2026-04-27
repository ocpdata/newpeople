import request from "supertest";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { app } from "../src/app.js";
import { pool, query } from "../src/db.js";
import {
  TEST_PREFIX,
  cleanupArtifacts,
  createDirectAccount,
  createDirectContact,
  createDirectProvider,
  createDirectProviderPriceList,
  createDirectProviderPriceItem,
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
    quotationIds: [],
    opportunityIds: [],
    contactIds: [],
    accountIds: [],
    userIds: [],
    roleIds: [],
    providerPriceItemIds: [],
    providerPriceListIds: [],
    providerIds: [],
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
    ctx.accountReadAllRoleId = await createRole({
      name: `${TEST_PREFIX}_accounts_read_all`,
      permissionCodes: ["cuentas.read", "cuentas.read_all"],
    });
    ctx.contactReadRoleId = await createRole({
      name: `${TEST_PREFIX}_contacts_read`,
      permissionCodes: ["contactos.read"],
    });
    ctx.contactGlobalScopeRoleId = await createRole({
      name: `${TEST_PREFIX}_contacts_global_scope`,
      permissionCodes: [
        "contactos.read",
        "contactos.read_all",
        "contactos.create",
        "contactos.update",
      ],
    });
    ctx.contactRequestRoleId = await createRole({
      name: `${TEST_PREFIX}_contacts_request`,
      permissionCodes: ["contactos.request", "contactos.update"],
    });
    ctx.contactCreateRoleId = await createRole({
      name: `${TEST_PREFIX}_contacts_create`,
      permissionCodes: ["contactos.create", "contactos.update"],
    });
    ctx.providerManagerRoleId = await createRole({
      name: `${TEST_PREFIX}_providers_manager`,
      permissionCodes: [
        "proveedores.read",
        "proveedores.create",
        "proveedores.update",
        "proveedores_precios.read",
        "proveedores_precios.create",
        "proveedores_precios.update",
      ],
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
    ctx.opportunityGlobalScopeRoleId = await createRole({
      name: `${TEST_PREFIX}_opps_global_scope`,
      permissionCodes: [
        "oportunidades.read",
        "oportunidades.read_all",
        "oportunidades.request",
        "oportunidades.update",
      ],
    });
    ctx.quotationOperationRoleId = await createRole({
      name: `${TEST_PREFIX}_quotes_operation`,
      permissionCodes: ["cotizaciones.operacion"],
    });
    ctx.quotationRevisionRoleId = await createRole({
      name: `${TEST_PREFIX}_quotes_revision`,
      permissionCodes: ["cotizaciones.revision"],
    });
    ctx.quotationIngresoRoleId = await createRole({
      name: `${TEST_PREFIX}_quotes_ingreso`,
      permissionCodes: ["cotizaciones.ingreso"],
    });
    ctx.quotationAdminRoleId = await createRole({
      name: `${TEST_PREFIX}_quotes_admin`,
      permissionCodes: ["cotizaciones.administracion"],
    });
    ctx.quotationExternalRoleId = await createRole({
      name: `${TEST_PREFIX}_quotes_external`,
      permissionCodes: ["cotizaciones.externo"],
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
      ctx.accountReadAllRoleId,
      ctx.contactReadRoleId,
      ctx.contactGlobalScopeRoleId,
      ctx.contactRequestRoleId,
      ctx.contactCreateRoleId,
      ctx.providerManagerRoleId,
      ctx.opportunityRequestRoleId,
      ctx.opportunityFlowRoleId,
      ctx.opportunityGlobalScopeRoleId,
      ctx.quotationOperationRoleId,
      ctx.quotationRevisionRoleId,
      ctx.quotationIngresoRoleId,
      ctx.quotationAdminRoleId,
      ctx.quotationExternalRoleId,
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
      providerActiveStatusId: await getCatalogId(
        "provider_activation_statuses",
        "activado",
      ),
      providerInactiveStatusId: await getCatalogId(
        "provider_activation_statuses",
        "desactivado",
      ),
      providerPriceItemActiveStatusId: await getCatalogId(
        "provider_price_list_item_statuses",
        "activo",
      ),
      providerPriceItemInactiveStatusId: await getCatalogId(
        "provider_price_list_item_statuses",
        "inactivo",
      ),
      currencyUsdId: await getCatalogId("currencies", "USD"),
      currencyMxnId: await getCatalogId("currencies", "MXN"),
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
      quotationDraftStatusId: await getCatalogId(
        "quotation_statuses",
        "borrador",
      ),
      quotationApprovedStatusId: await getCatalogId(
        "quotation_statuses",
        "aprobada",
      ),
      quotationActiveStatusId: await getCatalogId(
        "quotation_activation_statuses",
        "activada",
      ),
      quotationIncludedTypeId: await getCatalogId(
        "quotation_section_inclusion_types",
        "incluida",
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
    ctx.accountReadAllUserId = await createUser({
      fullName: "API Account Read All",
      email: `${TEST_PREFIX}.accounts.read.all@example.com`,
      roleIds: [ctx.accountReadAllRoleId],
    });
    ctx.contactReadUserId = await createUser({
      fullName: "API Contact Read",
      email: `${TEST_PREFIX}.contacts.read@example.com`,
      roleIds: [ctx.contactReadRoleId],
    });
    ctx.contactGlobalScopeUserId = await createUser({
      fullName: "API Contact Global Scope",
      email: `${TEST_PREFIX}.contacts.global.scope@example.com`,
      roleIds: [ctx.contactGlobalScopeRoleId],
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
    ctx.providerManagerUserId = await createUser({
      fullName: "API Provider Manager",
      email: `${TEST_PREFIX}.providers.manager@example.com`,
      roleIds: [ctx.providerManagerRoleId],
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
    ctx.opportunityGlobalScopeUserId = await createUser({
      fullName: "API Opportunity Global Scope",
      email: `${TEST_PREFIX}.opps.global.scope@example.com`,
      roleIds: [ctx.opportunityGlobalScopeRoleId],
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
    ctx.quotationOperationUserId = await createUser({
      fullName: "API Quote Operation",
      email: `${TEST_PREFIX}.quotes.operation@example.com`,
      roleIds: [ctx.quotationOperationRoleId],
    });
    ctx.quotationRevisionUserId = await createUser({
      fullName: "API Quote Revision",
      email: `${TEST_PREFIX}.quotes.revision@example.com`,
      roleIds: [ctx.quotationRevisionRoleId],
    });
    ctx.quotationIngresoUserId = await createUser({
      fullName: "API Quote Ingreso",
      email: `${TEST_PREFIX}.quotes.ingreso@example.com`,
      roleIds: [ctx.quotationIngresoRoleId],
    });
    ctx.quotationAdminUserId = await createUser({
      fullName: "API Quote Admin",
      email: `${TEST_PREFIX}.quotes.admin@example.com`,
      roleIds: [ctx.quotationAdminRoleId],
    });
    ctx.quotationExternalUserId = await createUser({
      fullName: "API Quote External",
      email: `${TEST_PREFIX}.quotes.external@example.com`,
      roleIds: [ctx.quotationExternalRoleId],
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
      ctx.accountReadAllUserId,
      ctx.contactReadUserId,
      ctx.contactGlobalScopeUserId,
      ctx.contactRequestUserId,
      ctx.contactCreateUserId,
      ctx.providerManagerUserId,
      ctx.opportunityRequestUserId,
      ctx.opportunityFlowUserId,
      ctx.opportunityGlobalScopeUserId,
      ctx.sellerUserId,
      ctx.roleManagerUserId,
      ctx.quotationOperationUserId,
      ctx.quotationRevisionUserId,
      ctx.quotationIngresoUserId,
      ctx.quotationAdminUserId,
      ctx.quotationExternalUserId,
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

  async function createOwnedQuoteOpportunityFixture(suffix) {
    const accountId = await createDirectAccount({
      ownerUserId: ctx.quotationOperationUserId,
      actorUserId: ctx.quotationOperationUserId,
      suffix,
    });
    cleanup.accountIds.push(accountId);

    for (const userId of [
      ctx.quotationRevisionUserId,
      ctx.quotationIngresoUserId,
      ctx.quotationAdminUserId,
      ctx.quotationExternalUserId,
    ]) {
      await query(
        "INSERT INTO account_owners (account_id, user_id, assigned_at, assigned_by) VALUES (?, ?, NOW(3), ?)",
        [accountId, userId, ctx.quotationOperationUserId],
      );
    }

    const contactId = await createDirectContact({
      accountId,
      actorUserId: ctx.quotationOperationUserId,
      suffix,
    });
    cleanup.contactIds.push(contactId);

    const alternateContactId = await createDirectContact({
      accountId,
      actorUserId: ctx.quotationOperationUserId,
      suffix: `${suffix}_alt`,
    });
    cleanup.contactIds.push(alternateContactId);

    const now = new Date();
    const insertResult = await query(
      `INSERT INTO opportunities
        (name, amount_usd, account_id, close_date, contact_id,
         sales_stage_id, business_line_id, seller_user_id, presales_user_id, activation_status_id,
         commercial_status_id, created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `Oportunidad cotizacion ${suffix}`,
        32100,
        accountId,
        "2026-12-31",
        contactId,
        ctx.catalogIds.salesStageInitialId,
        ctx.catalogIds.businessLineId,
        ctx.sellerUserId,
        null,
        ctx.catalogIds.opportunityActiveStatusId,
        ctx.catalogIds.opportunityCommercialInProgressStatusId,
        ctx.quotationOperationUserId,
        now,
        ctx.quotationOperationUserId,
        now,
      ],
    );
    const opportunityId = Number(insertResult.insertId);
    cleanup.opportunityIds.push(opportunityId);

    return {
      accountId,
      contactId,
      alternateContactId,
      opportunityId,
      sellerUserId: ctx.sellerUserId,
      sellerUserName: "API Seller Fixture",
    };
  }

  async function createQuotationFixture(suffix) {
    const fixture = await createOwnedQuoteOpportunityFixture(suffix);
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.quotes.operation@example.com`,
    );
    const createResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/quotations`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        accountId: fixture.accountId,
        contactId: fixture.contactId,
        sellerUserId: fixture.sellerUserId,
        sections: [],
      });

    expect(createResponse.status).toBe(201);
    cleanup.quotationIds.push(Number(createResponse.body.quotationId));

    return {
      token: loginResponse.body.token,
      quotationId: Number(createResponse.body.quotationId),
      latestVersionId: Number(createResponse.body.latestVersionId),
      ...fixture,
    };
  }

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

  test("cuentas.read_all permite ver cuentas sin ser propietario", async () => {
    const createLoginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.create@example.com`,
    );

    const createResponse = await request(app)
      .post("/api/accounts")
      .set("Authorization", `Bearer ${createLoginResponse.body.token}`)
      .send({
        name: `Cuenta Read All ${TEST_PREFIX}`,
        accountTypeId: ctx.catalogIds.accountTypeId,
        registrationCode: `RAL-${TEST_PREFIX}`,
        phone: "5550002424",
        economicSectorId: ctx.catalogIds.economicSectorId,
        website: "https://readall.example.com",
        city: "Monterrey",
        stateRegion: "NL",
        countryId: ctx.catalogIds.countryMxId,
        description: "Cuenta para validar alcance global por permiso",
        addressLine: "Direccion read all",
        postalCode: "64000",
        activationStatusId: ctx.catalogIds.accountActiveStatusId,
        ownerUserIds: [ctx.accountCreateUserId],
      });

    expect(createResponse.status).toBe(201);
    cleanup.accountIds.push(Number(createResponse.body.id));

    const ownedReadLoginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.read@example.com`,
    );

    const ownedReadListResponse = await request(app)
      .get("/api/accounts")
      .set("Authorization", `Bearer ${ownedReadLoginResponse.body.token}`);

    expect(ownedReadListResponse.status).toBe(200);
    expect(
      ownedReadListResponse.body.some(
        (account) => Number(account.id) === Number(createResponse.body.id),
      ),
    ).toBe(false);

    const readAllLoginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.read.all@example.com`,
    );

    const readAllListResponse = await request(app)
      .get("/api/accounts")
      .set("Authorization", `Bearer ${readAllLoginResponse.body.token}`);

    expect(readAllListResponse.status).toBe(200);
    expect(
      readAllListResponse.body.some(
        (account) => Number(account.id) === Number(createResponse.body.id),
      ),
    ).toBe(true);

    const readAllDetailResponse = await request(app)
      .get(`/api/accounts/${createResponse.body.id}`)
      .set("Authorization", `Bearer ${readAllLoginResponse.body.token}`);

    expect(readAllDetailResponse.status).toBe(200);
    expect(Number(readAllDetailResponse.body.id)).toBe(
      Number(createResponse.body.id),
    );
  });

  test("Administrador sin cuentas.read_all ya no ve cuentas ajenas", async () => {
    const createLoginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.create@example.com`,
    );

    const createResponse = await request(app)
      .post("/api/accounts")
      .set("Authorization", `Bearer ${createLoginResponse.body.token}`)
      .send({
        name: `Cuenta Admin Scope ${TEST_PREFIX}`,
        accountTypeId: ctx.catalogIds.accountTypeId,
        registrationCode: `ADM-${TEST_PREFIX}`,
        phone: "5550002525",
        economicSectorId: ctx.catalogIds.economicSectorId,
        website: "https://admin-scope.example.com",
        city: "Guadalajara",
        stateRegion: "JAL",
        countryId: ctx.catalogIds.countryMxId,
        description: "Cuenta para validar que admin ya no depende del rol",
        addressLine: "Direccion admin scope",
        postalCode: "44100",
        activationStatusId: ctx.catalogIds.accountActiveStatusId,
        ownerUserIds: [ctx.accountCreateUserId],
      });

    expect(createResponse.status).toBe(201);
    cleanup.accountIds.push(Number(createResponse.body.id));

    const adminRoleRows = await query(
      "SELECT id FROM roles WHERE name = 'Administrador' LIMIT 1",
    );
    expect(adminRoleRows).toHaveLength(1);
    const adminRoleId = Number(adminRoleRows[0].id);

    const readAllPermissionRows = await query(
      "SELECT id FROM permissions WHERE code = 'cuentas.read_all' LIMIT 1",
    );
    expect(readAllPermissionRows).toHaveLength(1);
    const readAllPermissionId = Number(readAllPermissionRows[0].id);

    await query(
      "DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?",
      [adminRoleId, readAllPermissionId],
    );

    const adminUserId = await createUser({
      fullName: "API Real Admin Scope",
      email: `${TEST_PREFIX}.real.admin.scope@example.com`,
      roleIds: [adminRoleId],
    });
    cleanup.userIds.push(adminUserId);

    const adminLoginResponse = await login(
      request(app),
      `${TEST_PREFIX}.real.admin.scope@example.com`,
    );

    const adminListResponse = await request(app)
      .get("/api/accounts")
      .set("Authorization", `Bearer ${adminLoginResponse.body.token}`);

    expect(adminListResponse.status).toBe(200);
    expect(
      adminListResponse.body.some(
        (account) => Number(account.id) === Number(createResponse.body.id),
      ),
    ).toBe(false);

    const adminDetailResponse = await request(app)
      .get(`/api/accounts/${createResponse.body.id}`)
      .set("Authorization", `Bearer ${adminLoginResponse.body.token}`);

    expect(adminDetailResponse.status).toBe(404);

    await query(
      "INSERT INTO role_permissions (role_id, permission_id, created_at) VALUES (?, ?, NOW(3))",
      [adminRoleId, readAllPermissionId],
    );
  });

  test("Administrador sin permiso explicito recibe 403 en rutas protegidas por requirePermission", async () => {
    const adminRoleRows = await query(
      "SELECT id FROM roles WHERE name = 'Administrador' LIMIT 1",
    );
    expect(adminRoleRows).toHaveLength(1);
    const adminRoleId = Number(adminRoleRows[0].id);

    const permissionRows = await query(
      "SELECT id FROM permissions WHERE code IN ('roles.read', 'permissions.read') ORDER BY code",
    );
    expect(permissionRows).toHaveLength(2);
    const permissionIds = permissionRows.map((row) => Number(row.id));

    await query(
      `DELETE FROM role_permissions
       WHERE role_id = ? AND permission_id IN (?, ?)`,
      [adminRoleId, permissionIds[0], permissionIds[1]],
    );

    const adminUserId = await createUser({
      fullName: "API Real Admin Permissions",
      email: `${TEST_PREFIX}.real.admin.permissions@example.com`,
      roleIds: [adminRoleId],
    });
    cleanup.userIds.push(adminUserId);

    const adminLoginResponse = await login(
      request(app),
      `${TEST_PREFIX}.real.admin.permissions@example.com`,
    );

    const rolesResponse = await request(app)
      .get("/api/roles")
      .set("Authorization", `Bearer ${adminLoginResponse.body.token}`);

    expect(rolesResponse.status).toBe(403);
    expect(rolesResponse.body.requiredPermission).toBe("roles.read");

    const permissionsResponse = await request(app)
      .get("/api/roles/permissions")
      .set("Authorization", `Bearer ${adminLoginResponse.body.token}`);

    expect(permissionsResponse.status).toBe(403);
    expect(permissionsResponse.body.requiredPermission).toBe(
      "permissions.read",
    );

    for (const permissionId of permissionIds) {
      await query(
        "INSERT INTO role_permissions (role_id, permission_id, created_at) VALUES (?, ?, NOW(3))",
        [adminRoleId, permissionId],
      );
    }
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

  test("contactos.read_all extiende contactos y contact-accounts a cuentas ajenas", async () => {
    const foreignAccountId = await createDirectAccount({
      ownerUserId: ctx.contactCreateUserId,
      actorUserId: ctx.contactCreateUserId,
      suffix: `${TEST_PREFIX}_contact_global_scope`,
    });
    cleanup.accountIds.push(foreignAccountId);

    const limitedLoginResponse = await login(
      request(app),
      `${TEST_PREFIX}.contacts.read@example.com`,
    );

    const limitedCatalogResponse = await request(app)
      .get("/api/catalogs/contact-accounts")
      .set("Authorization", `Bearer ${limitedLoginResponse.body.token}`);

    expect(limitedCatalogResponse.status).toBe(200);
    expect(
      limitedCatalogResponse.body.some(
        (account) => Number(account.id) === foreignAccountId,
      ),
    ).toBe(false);

    const globalLoginResponse = await login(
      request(app),
      `${TEST_PREFIX}.contacts.global.scope@example.com`,
    );

    const globalCatalogResponse = await request(app)
      .get("/api/catalogs/contact-accounts")
      .set("Authorization", `Bearer ${globalLoginResponse.body.token}`);

    expect(globalCatalogResponse.status).toBe(200);
    expect(
      globalCatalogResponse.body.some(
        (account) => Number(account.id) === foreignAccountId,
      ),
    ).toBe(true);

    const createResponse = await request(app)
      .post("/api/contacts")
      .set("Authorization", `Bearer ${globalLoginResponse.body.token}`)
      .send({
        firstName: "Global",
        lastName: `Contact ${TEST_PREFIX}`,
        accountId: foreignAccountId,
        positionTitle: "Analista",
        phone: "5553030303",
        phoneExtension: "303",
        mobile: `553${String(Date.now()).slice(-7)}`,
        email: `${TEST_PREFIX}.contact.global@example.com`,
        department: "Compras",
        countryId: ctx.catalogIds.countryMxId,
        stateRegion: "CDMX",
        city: "Ciudad de Mexico",
        addressLine: "Direccion global contacto",
        postalCode: "01020",
        purchaseParticipationId: ctx.catalogIds.purchaseParticipationNoneId,
        relationshipTypeId: ctx.catalogIds.relationshipTypeNoneId,
        employmentStatusId: ctx.catalogIds.employmentStatusId,
        activationStatusId: ctx.catalogIds.contactActiveStatusId,
        managerContactId: null,
        influencesContactId: null,
      });

    expect(createResponse.status).toBe(201);
    cleanup.contactIds.push(Number(createResponse.body.id));

    const limitedListResponse = await request(app)
      .get("/api/contacts")
      .set("Authorization", `Bearer ${limitedLoginResponse.body.token}`);

    expect(limitedListResponse.status).toBe(200);
    expect(
      limitedListResponse.body.some(
        (contact) => Number(contact.id) === Number(createResponse.body.id),
      ),
    ).toBe(false);

    const globalListResponse = await request(app)
      .get("/api/contacts")
      .set("Authorization", `Bearer ${globalLoginResponse.body.token}`);

    expect(globalListResponse.status).toBe(200);
    expect(
      globalListResponse.body.some(
        (contact) => Number(contact.id) === Number(createResponse.body.id),
      ),
    ).toBe(true);

    const detailResponse = await request(app)
      .get(`/api/contacts/${createResponse.body.id}`)
      .set("Authorization", `Bearer ${globalLoginResponse.body.token}`);

    expect(detailResponse.status).toBe(200);
    expect(Number(detailResponse.body.id)).toBe(Number(createResponse.body.id));
    expect(Number(detailResponse.body.account_id)).toBe(foreignAccountId);
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
  test("proveedores.create crea un proveedor activado y proveedores.read lo lista", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.providers.manager@example.com`,
    );

    const createResponse = await request(app)
      .post("/api/providers")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Proveedor API ${TEST_PREFIX}`,
        registrationCode: `PROV-${TEST_PREFIX}`,
        addressLine: "Direccion proveedor prueba",
        countryId: ctx.catalogIds.countryMxId,
        city: "Ciudad de Mexico",
        postalCode: "01010",
        stateRegion: "CDMX",
        activationStatusId: ctx.catalogIds.providerActiveStatusId,
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.message).toBe("Proveedor creado");
    cleanup.providerIds.push(Number(createResponse.body.id));

    const statusCode = await getStatusCodeById(
      "providers",
      createResponse.body.id,
      {
        table: "provider_activation_statuses",
        column: "activation_status_id",
      },
    );
    expect(statusCode).toBe("activado");

    const listResponse = await request(app)
      .get("/api/providers")
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(listResponse.status).toBe(200);
    const createdProvider = listResponse.body.find(
      (provider) => Number(provider.id) === Number(createResponse.body.id),
    );
    expect(createdProvider).toBeTruthy();
    expect(createdProvider.name).toBe(`Proveedor API ${TEST_PREFIX}`);
    expect(createdProvider.activation_status_code).toBe("activado");
  });

  test("proveedores.create permite omitir el registro del proveedor", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.providers.manager@example.com`,
    );

    const createResponse = await request(app)
      .post("/api/providers")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Proveedor sin registro ${TEST_PREFIX}`,
        registrationCode: "",
        addressLine: "Direccion proveedor sin registro",
        countryId: ctx.catalogIds.countryMxId,
        city: "Ciudad de Mexico",
        postalCode: "01010",
        stateRegion: "CDMX",
        activationStatusId: ctx.catalogIds.providerActiveStatusId,
      });

    expect(createResponse.status).toBe(201);
    cleanup.providerIds.push(Number(createResponse.body.id));

    const providerRows = await query(
      "SELECT registration_code FROM providers WHERE id = ? LIMIT 1",
      [createResponse.body.id],
    );
    expect(providerRows[0]?.registration_code ?? null).toBeNull();
  });

  test("proveedores.update bloquea desactivar un proveedor con precios activos", async () => {
    const providerId = await createDirectProvider({
      actorUserId: ctx.providerManagerUserId,
      suffix: `${TEST_PREFIX}_provider_active_prices`,
    });
    cleanup.providerIds.push(providerId);

    const priceListId = await createDirectProviderPriceList({
      providerId,
      actorUserId: ctx.providerManagerUserId,
      suffix: `${TEST_PREFIX}_provider_active_prices`,
      isActive: true,
    });
    cleanup.providerPriceListIds.push(priceListId);

    const priceItemId = await createDirectProviderPriceItem({
      providerId,
      listId: priceListId,
      actorUserId: ctx.providerManagerUserId,
      suffix: `${TEST_PREFIX}_provider_active_prices`,
    });
    cleanup.providerPriceItemIds.push(priceItemId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.providers.manager@example.com`,
    );

    const patchResponse = await request(app)
      .patch(`/api/providers/${providerId}/status`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({ statusCode: "desactivado" });

    expect(patchResponse.status).toBe(409);
    expect(patchResponse.body.message).toBe(
      "No es posible desactivar el proveedor porque tiene una lista de precios activa",
    );

    const statusCode = await getStatusCodeById("providers", providerId, {
      table: "provider_activation_statuses",
      column: "activation_status_id",
    });
    expect(statusCode).toBe("activado");
  });

  test("proveedores_precios usa listas padre, activa solo una por proveedor y mantiene moneda unica por lista", async () => {
    const providerId = await createDirectProvider({
      actorUserId: ctx.providerManagerUserId,
      suffix: `${TEST_PREFIX}_provider_price_flow`,
    });
    cleanup.providerIds.push(providerId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.providers.manager@example.com`,
    );

    const createLegacyListResponse = await request(app)
      .post(`/api/providers/${providerId}/price-lists`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Lista A ${TEST_PREFIX}`,
        currencyId: ctx.catalogIds.currencyUsdId,
        itemType: "producto",
      });

    expect(createLegacyListResponse.status).toBe(201);
    expect(createLegacyListResponse.body.message).toBe(
      "Lista de precios creada",
    );
    const firstListId = Number(createLegacyListResponse.body.id);
    cleanup.providerPriceListIds.push(firstListId);

    const createSecondListResponse = await request(app)
      .post(`/api/providers/${providerId}/price-lists`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Lista B ${TEST_PREFIX}`,
        currencyId: ctx.catalogIds.currencyMxnId,
        itemType: "servicio_propio",
      });

    expect(createSecondListResponse.status).toBe(201);
    const secondListId = Number(createSecondListResponse.body.id);
    cleanup.providerPriceListIds.push(secondListId);

    const listsResponse = await request(app)
      .get(`/api/providers/${providerId}/price-lists`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(listsResponse.status).toBe(200);
    expect(listsResponse.body).toHaveLength(2);
    expect(
      listsResponse.body.every((list) => Number(list.is_active) === 0),
    ).toBe(true);
    expect(
      listsResponse.body.find((list) => Number(list.id) === firstListId)
        ?.currency_code,
    ).toBe("USD");
    expect(
      listsResponse.body.find((list) => Number(list.id) === firstListId)
        ?.item_type,
    ).toBe("producto");
    expect(
      listsResponse.body.find((list) => Number(list.id) === secondListId)
        ?.currency_code,
    ).toBe("MXN");
    expect(
      listsResponse.body.find((list) => Number(list.id) === secondListId)
        ?.item_type,
    ).toBe("servicio_propio");

    const activateFirstListResponse = await request(app)
      .patch(`/api/providers/${providerId}/price-lists/${firstListId}/status`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({ statusCode: "activa" });

    expect(activateFirstListResponse.status).toBe(200);
    expect(activateFirstListResponse.body.message).toBe(
      "Lista de precios activada",
    );

    const activateSecondListWhileFirstActiveResponse = await request(app)
      .patch(`/api/providers/${providerId}/price-lists/${secondListId}/status`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({ statusCode: "activa" });

    expect(activateSecondListWhileFirstActiveResponse.status).toBe(409);
    expect(activateSecondListWhileFirstActiveResponse.body.message).toBe(
      "Ya existe una lista de precios activa para el proveedor.",
    );

    const createPriceResponse = await request(app)
      .post(`/api/providers/${providerId}/price-lists/${firstListId}/items`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        code: `PRICE-${TEST_PREFIX}`,
        description: "Precio creado por prueba automatica",
        itemType: "producto",
        price: 3450.75,
        currencyId: ctx.catalogIds.currencyUsdId,
        activationStatusId: ctx.catalogIds.providerPriceItemActiveStatusId,
      });

    expect(createPriceResponse.status).toBe(201);
    expect(createPriceResponse.body.message).toBe("Precio agregado");
    cleanup.providerPriceItemIds.push(Number(createPriceResponse.body.id));

    const listResponse = await request(app)
      .get(`/api/providers/${providerId}/price-lists/${firstListId}/items`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toHaveLength(1);
    expect(listResponse.body[0].code).toBe(`PRICE-${TEST_PREFIX}`);
    expect(listResponse.body[0].item_type).toBe("producto");
    expect(listResponse.body[0].activation_status_code).toBe("activo");

    const updatePriceResponse = await request(app)
      .put(
        `/api/providers/${providerId}/price-lists/${firstListId}/items/${createPriceResponse.body.id}`,
      )
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        code: `PRICE-${TEST_PREFIX}`,
        description: "Precio actualizado por prueba automatica",
        itemType: "producto",
        price: 3899.99,
        currencyId: ctx.catalogIds.currencyUsdId,
        activationStatusId: ctx.catalogIds.providerPriceItemActiveStatusId,
      });

    expect(updatePriceResponse.status).toBe(200);
    expect(updatePriceResponse.body.message).toBe("Precio actualizado");

    const updatedListResponse = await request(app)
      .get(`/api/providers/${providerId}/price-lists/${firstListId}/items`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(updatedListResponse.status).toBe(200);
    expect(updatedListResponse.body[0].item_type).toBe("producto");

    const invalidMixedTypeCreateResponse = await request(app)
      .post(`/api/providers/${providerId}/price-lists/${firstListId}/items`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        code: `PRICE-${TEST_PREFIX}-SERV`,
        description: "Intento con tipo distinto",
        itemType: "servicio_propio",
        price: 4000,
        currencyId: ctx.catalogIds.currencyUsdId,
        activationStatusId: ctx.catalogIds.providerPriceItemActiveStatusId,
      });

    expect(invalidMixedTypeCreateResponse.status).toBe(409);
    expect(invalidMixedTypeCreateResponse.body.message).toBe(
      "La lista de precios solo permite items de tipo Productos.",
    );

    const secondPriceSameCurrencyResponse = await request(app)
      .post(`/api/providers/${providerId}/price-lists/${firstListId}/items`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        code: `PRICE-${TEST_PREFIX}-USD-2`,
        description: "Segundo precio con misma moneda",
        itemType: "producto",
        price: 4100,
        currencyId: ctx.catalogIds.currencyUsdId,
        activationStatusId: ctx.catalogIds.providerPriceItemActiveStatusId,
      });

    expect(secondPriceSameCurrencyResponse.status).toBe(201);
    cleanup.providerPriceItemIds.push(
      Number(secondPriceSameCurrencyResponse.body.id),
    );

    const invalidMixedCurrencyCreateResponse = await request(app)
      .post(`/api/providers/${providerId}/price-lists/${firstListId}/items`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        code: `PRICE-${TEST_PREFIX}-MXN`,
        description: "Intento con moneda distinta",
        itemType: "producto",
        price: 4200,
        currencyId: ctx.catalogIds.currencyMxnId,
        activationStatusId: ctx.catalogIds.providerPriceItemActiveStatusId,
      });

    expect(invalidMixedCurrencyCreateResponse.status).toBe(409);
    expect(invalidMixedCurrencyCreateResponse.body.message).toBe(
      "La lista de precios solo permite una moneda. Usa USD.",
    );
    expect(invalidMixedCurrencyCreateResponse.body.currencyCode).toBe("USD");

    const createSecondListPriceResponse = await request(app)
      .post(`/api/providers/${providerId}/price-lists/${secondListId}/items`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        code: `PRICE-${TEST_PREFIX}`,
        description: "Precio en segunda lista con otra moneda",
        itemType: "servicio_propio",
        price: 4200,
        currencyId: ctx.catalogIds.currencyMxnId,
        activationStatusId: ctx.catalogIds.providerPriceItemActiveStatusId,
      });

    expect(createSecondListPriceResponse.status).toBe(201);
    cleanup.providerPriceItemIds.push(
      Number(createSecondListPriceResponse.body.id),
    );

    const invalidMixedCurrencyUpdateResponse = await request(app)
      .put(
        `/api/providers/${providerId}/price-lists/${firstListId}/items/${secondPriceSameCurrencyResponse.body.id}`,
      )
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        code: `PRICE-${TEST_PREFIX}-USD-2`,
        description: "Intento de actualizacion con otra moneda",
        itemType: "producto",
        price: 4300,
        currencyId: ctx.catalogIds.currencyMxnId,
        activationStatusId: ctx.catalogIds.providerPriceItemActiveStatusId,
      });

    expect(invalidMixedCurrencyUpdateResponse.status).toBe(409);
    expect(invalidMixedCurrencyUpdateResponse.body.currencyCode).toBe("USD");

    const deactivateSecondPriceResponse = await request(app)
      .patch(
        `/api/providers/${providerId}/price-lists/${firstListId}/items/${secondPriceSameCurrencyResponse.body.id}/status`,
      )
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({ statusCode: "inactivo" });

    expect(deactivateSecondPriceResponse.status).toBe(200);
    expect(deactivateSecondPriceResponse.body.message).toBe(
      "Precio desactivado",
    );

    const deactivatePriceResponse = await request(app)
      .patch(
        `/api/providers/${providerId}/price-lists/${firstListId}/items/${createPriceResponse.body.id}/status`,
      )
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({ statusCode: "inactivo" });

    expect(deactivatePriceResponse.status).toBe(200);
    expect(deactivatePriceResponse.body.message).toBe("Precio desactivado");

    const deactivateFirstListResponse = await request(app)
      .patch(`/api/providers/${providerId}/price-lists/${firstListId}/status`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({ statusCode: "inactiva" });

    expect(deactivateFirstListResponse.status).toBe(200);
    expect(deactivateFirstListResponse.body.message).toBe(
      "Lista de precios desactivada",
    );

    const activateSecondListResponse = await request(app)
      .patch(`/api/providers/${providerId}/price-lists/${secondListId}/status`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({ statusCode: "activa" });

    expect(activateSecondListResponse.status).toBe(200);

    const deactivateSecondListResponse = await request(app)
      .patch(`/api/providers/${providerId}/price-lists/${secondListId}/status`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({ statusCode: "inactiva" });

    expect(deactivateSecondListResponse.status).toBe(200);

    const deactivateProviderResponse = await request(app)
      .patch(`/api/providers/${providerId}/status`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({ statusCode: "desactivado" });

    expect(deactivateProviderResponse.status).toBe(200);
    expect(deactivateProviderResponse.body.message).toBe(
      "Proveedor desactivado",
    );

    const reactivatePriceResponse = await request(app)
      .patch(
        `/api/providers/${providerId}/price-lists/${firstListId}/items/${createPriceResponse.body.id}/status`,
      )
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({ statusCode: "activo" });

    expect(reactivatePriceResponse.status).toBe(409);
    expect(reactivatePriceResponse.body.message).toBe(
      "No es posible activar precios en un proveedor desactivado",
    );

    const invalidTypeResponse = await request(app)
      .post(`/api/providers/${providerId}/price-lists/${firstListId}/items`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        code: `PRICE-${TEST_PREFIX}-INVALID`,
        description: "Tipo invalido",
        itemType: "servicio_tercero",
        price: 123,
        currencyId: ctx.catalogIds.currencyUsdId,
        activationStatusId: ctx.catalogIds.providerPriceItemActiveStatusId,
      });

    expect(invalidTypeResponse.status).toBe(400);
    expect(invalidTypeResponse.body.message).toBe("Datos invalidos");
  });

  test("proveedores_precios acepta grupo_productos y mantiene el tipo unico por lista", async () => {
    const providerId = await createDirectProvider({
      actorUserId: ctx.providerManagerUserId,
      suffix: `${TEST_PREFIX}_provider_price_group_products`,
    });
    cleanup.providerIds.push(providerId);

    const productComponentProviderId = await createDirectProvider({
      actorUserId: ctx.providerManagerUserId,
      suffix: `${TEST_PREFIX}_component_product_provider`,
    });
    cleanup.providerIds.push(productComponentProviderId);

    const productComponentItemId = await createDirectProviderPriceItem({
      providerId: productComponentProviderId,
      actorUserId: ctx.providerManagerUserId,
      suffix: `${TEST_PREFIX}_component_product_item`,
      itemType: "producto",
    });
    cleanup.providerPriceItemIds.push(productComponentItemId);

    const serviceComponentProviderId = await createDirectProvider({
      actorUserId: ctx.providerManagerUserId,
      suffix: `${TEST_PREFIX}_component_service_provider`,
    });
    cleanup.providerIds.push(serviceComponentProviderId);

    const serviceComponentListId = await createDirectProviderPriceList({
      providerId: serviceComponentProviderId,
      actorUserId: ctx.providerManagerUserId,
      suffix: `${TEST_PREFIX}_component_service_list`,
      currencyId: ctx.catalogIds.currencyUsdId,
      itemType: "servicio_propio",
      isActive: true,
    });
    cleanup.providerPriceListIds.push(serviceComponentListId);

    const serviceComponentItemId = await createDirectProviderPriceItem({
      providerId: serviceComponentProviderId,
      actorUserId: ctx.providerManagerUserId,
      suffix: `${TEST_PREFIX}_component_service_item`,
      itemType: "servicio_propio",
      listId: serviceComponentListId,
    });
    cleanup.providerPriceItemIds.push(serviceComponentItemId);

    const [productComponentRow] = await query(
      `SELECT price FROM provider_price_list_items WHERE id = ? LIMIT 1`,
      [productComponentItemId],
    );
    const [serviceComponentRow] = await query(
      `SELECT price FROM provider_price_list_items WHERE id = ? LIMIT 1`,
      [serviceComponentItemId],
    );

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.providers.manager@example.com`,
    );

    const createPriceListResponse = await request(app)
      .post(`/api/providers/${providerId}/price-lists`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Lista Grupo ${TEST_PREFIX}`,
        currencyId: ctx.catalogIds.currencyUsdId,
        itemType: "grupo_productos",
      });

    expect(createPriceListResponse.status).toBe(201);
    const priceListId = Number(createPriceListResponse.body.id);
    cleanup.providerPriceListIds.push(priceListId);

    const createPriceResponse = await request(app)
      .post(`/api/providers/${providerId}/price-lists/${priceListId}/items`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        code: `PRICE-GROUP-${TEST_PREFIX}`,
        description: "Precio grupo productos",
        itemType: "grupo_productos",
        currencyId: ctx.catalogIds.currencyUsdId,
        activationStatusId: ctx.catalogIds.providerPriceItemActiveStatusId,
        components: [
          {
            componentItemId: productComponentItemId,
            quantity: 2,
          },
          {
            componentItemId: serviceComponentItemId,
            quantity: 3,
          },
        ],
      });

    expect(createPriceResponse.status).toBe(201);
    cleanup.providerPriceItemIds.push(Number(createPriceResponse.body.id));

    const listResponse = await request(app)
      .get(`/api/providers/${providerId}/price-lists`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toHaveLength(1);
    expect(listResponse.body[0].item_type).toBe("grupo_productos");

    const itemsResponse = await request(app)
      .get(`/api/providers/${providerId}/price-lists/${priceListId}/items`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(itemsResponse.status).toBe(200);
    expect(itemsResponse.body).toHaveLength(1);
    expect(itemsResponse.body[0].item_type).toBe("grupo_productos");
    expect(itemsResponse.body[0].components).toHaveLength(2);
    expect(Number(itemsResponse.body[0].price)).toBe(
      Number(
        (
          Number(productComponentRow.price) * 2 +
          Number(serviceComponentRow.price) * 3
        ).toFixed(2),
      ),
    );

    const invalidMixedTypeResponse = await request(app)
      .post(`/api/providers/${providerId}/price-lists/${priceListId}/items`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        code: `PRICE-GROUP-MIX-${TEST_PREFIX}`,
        description: "Intento con tipo distinto",
        itemType: "producto",
        price: 2600,
        currencyId: ctx.catalogIds.currencyUsdId,
        activationStatusId: ctx.catalogIds.providerPriceItemActiveStatusId,
      });

    expect(invalidMixedTypeResponse.status).toBe(409);
    expect(invalidMixedTypeResponse.body.message).toBe(
      "La lista de precios solo permite items de tipo Bundle.",
    );
    expect(invalidMixedTypeResponse.body.itemType).toBe("grupo_productos");

    const activateGroupListResponse = await request(app)
      .patch(`/api/providers/${providerId}/price-lists/${priceListId}/status`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({ statusCode: "activa" });

    expect(activateGroupListResponse.status).toBe(200);

    const invalidNestedGroupResponse = await request(app)
      .post(`/api/providers/${providerId}/price-lists/${priceListId}/items`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        code: `PRICE-GROUP-NEST-${TEST_PREFIX}`,
        description: "Intento con grupo anidado",
        itemType: "grupo_productos",
        currencyId: ctx.catalogIds.currencyUsdId,
        activationStatusId: ctx.catalogIds.providerPriceItemActiveStatusId,
        components: [
          {
            componentItemId: Number(createPriceResponse.body.id),
            quantity: 1,
          },
        ],
      });

    expect(invalidNestedGroupResponse.status).toBe(409);
    expect(invalidNestedGroupResponse.body.message).toBe(
      "Los componentes de un Bundle solo pueden ser Productos o Servicios Propios",
    );

    const [productComponentItemRow] = await query(
      `SELECT price_list_id FROM provider_price_list_items WHERE id = ? LIMIT 1`,
      [productComponentItemId],
    );

    const deactivateProductComponentResponse = await request(app)
      .patch(
        `/api/providers/${productComponentProviderId}/price-lists/${productComponentItemRow.price_list_id}/items/${productComponentItemId}/status`,
      )
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({ statusCode: "inactivo" });

    expect(deactivateProductComponentResponse.status).toBe(200);
    expect(deactivateProductComponentResponse.body.message).toBe(
      "Precio desactivado",
    );

    const groupItemsAfterComponentDeactivationResponse = await request(app)
      .get(`/api/providers/${providerId}/price-lists/${priceListId}/items`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(groupItemsAfterComponentDeactivationResponse.status).toBe(200);
    expect(
      groupItemsAfterComponentDeactivationResponse.body[0]
        .activation_status_code,
    ).toBe("inactivo");

    const reactivateProductComponentResponse = await request(app)
      .patch(
        `/api/providers/${productComponentProviderId}/price-lists/${productComponentItemRow.price_list_id}/items/${productComponentItemId}/status`,
      )
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({ statusCode: "activo" });

    expect(reactivateProductComponentResponse.status).toBe(200);
    expect(reactivateProductComponentResponse.body.message).toBe(
      "Precio activado",
    );

    const groupItemsAfterComponentReactivationResponse = await request(app)
      .get(`/api/providers/${providerId}/price-lists/${priceListId}/items`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(groupItemsAfterComponentReactivationResponse.status).toBe(200);
    expect(
      groupItemsAfterComponentReactivationResponse.body[0]
        .activation_status_code,
    ).toBe("activo");
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

  test("oportunidades.read_all extiende oportunidades y catalogos asociados a cuentas ajenas", async () => {
    const foreignAccountId = await createDirectAccount({
      ownerUserId: ctx.opportunityRequestUserId,
      actorUserId: ctx.opportunityRequestUserId,
      suffix: `${TEST_PREFIX}_opportunity_global_scope`,
    });
    cleanup.accountIds.push(foreignAccountId);

    const foreignContactId = await createDirectContact({
      accountId: foreignAccountId,
      actorUserId: ctx.opportunityRequestUserId,
      suffix: `${TEST_PREFIX}_opportunity_global_scope`,
    });
    cleanup.contactIds.push(foreignContactId);

    const limitedLoginResponse = await login(
      request(app),
      `${TEST_PREFIX}.opps.flow@example.com`,
    );

    const limitedAccountsCatalogResponse = await request(app)
      .get("/api/catalogs/opportunity-accounts")
      .set("Authorization", `Bearer ${limitedLoginResponse.body.token}`);

    expect(limitedAccountsCatalogResponse.status).toBe(200);
    expect(
      limitedAccountsCatalogResponse.body.some(
        (account) => Number(account.id) === foreignAccountId,
      ),
    ).toBe(false);

    const limitedContactsCatalogResponse = await request(app)
      .get("/api/catalogs/opportunity-contacts")
      .set("Authorization", `Bearer ${limitedLoginResponse.body.token}`);

    expect(limitedContactsCatalogResponse.status).toBe(200);
    expect(
      limitedContactsCatalogResponse.body.some(
        (contact) => Number(contact.id) === foreignContactId,
      ),
    ).toBe(false);

    const globalLoginResponse = await login(
      request(app),
      `${TEST_PREFIX}.opps.global.scope@example.com`,
    );

    const globalAccountsCatalogResponse = await request(app)
      .get("/api/catalogs/opportunity-accounts")
      .set("Authorization", `Bearer ${globalLoginResponse.body.token}`);

    expect(globalAccountsCatalogResponse.status).toBe(200);
    expect(
      globalAccountsCatalogResponse.body.some(
        (account) => Number(account.id) === foreignAccountId,
      ),
    ).toBe(true);

    const globalContactsCatalogResponse = await request(app)
      .get("/api/catalogs/opportunity-contacts")
      .set("Authorization", `Bearer ${globalLoginResponse.body.token}`);

    expect(globalContactsCatalogResponse.status).toBe(200);
    expect(
      globalContactsCatalogResponse.body.some(
        (contact) => Number(contact.id) === foreignContactId,
      ),
    ).toBe(true);

    const createResponse = await request(app)
      .post("/api/opportunities")
      .set("Authorization", `Bearer ${globalLoginResponse.body.token}`)
      .send({
        name: `Oportunidad Global ${TEST_PREFIX}`,
        amountUsd: 41000,
        accountId: foreignAccountId,
        closeDate: "2026-10-31",
        contactId: foreignContactId,
        salesStageId: ctx.catalogIds.salesStageInitialId,
        businessLineId: ctx.catalogIds.businessLineId,
        sellerUserId: ctx.sellerUserId,
        presalesUserId: null,
        activationStatusId: ctx.catalogIds.opportunityActiveStatusId,
      });

    expect(createResponse.status).toBe(201);
    cleanup.opportunityIds.push(Number(createResponse.body.id));

    const limitedListResponse = await request(app)
      .get("/api/opportunities")
      .set("Authorization", `Bearer ${limitedLoginResponse.body.token}`);

    expect(limitedListResponse.status).toBe(200);
    expect(
      limitedListResponse.body.some(
        (opportunity) =>
          Number(opportunity.id) === Number(createResponse.body.id),
      ),
    ).toBe(false);

    const globalListResponse = await request(app)
      .get("/api/opportunities")
      .set("Authorization", `Bearer ${globalLoginResponse.body.token}`);

    expect(globalListResponse.status).toBe(200);
    expect(
      globalListResponse.body.some(
        (opportunity) =>
          Number(opportunity.id) === Number(createResponse.body.id),
      ),
    ).toBe(true);

    const detailResponse = await request(app)
      .get(`/api/opportunities/${createResponse.body.id}`)
      .set("Authorization", `Bearer ${globalLoginResponse.body.token}`);

    expect(detailResponse.status).toBe(200);
    expect(Number(detailResponse.body.id)).toBe(Number(createResponse.body.id));
    expect(Number(detailResponse.body.account_id)).toBe(foreignAccountId);

    const commercialContextResponse = await request(app)
      .get(`/api/opportunities/${createResponse.body.id}/commercial-context`)
      .set("Authorization", `Bearer ${globalLoginResponse.body.token}`);

    expect(commercialContextResponse.status).toBe(200);
    expect(Number(commercialContextResponse.body.opportunityId)).toBe(
      Number(createResponse.body.id),
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

  test("cotizaciones expone catalogos base y permisos nuevos", async () => {
    const permissionIds = await getPermissionIds([
      "cotizaciones.operacion",
      "cotizaciones.revision",
      "cotizaciones.ingreso",
      "cotizaciones.administracion",
      "cotizaciones.externo",
    ]);
    expect(permissionIds).toHaveLength(5);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.quotes.operation@example.com`,
    );

    const [
      statusesResponse,
      actionsResponse,
      inclusionResponse,
      deliveryTimesResponse,
      validityTermsResponse,
      warrantyTermsResponse,
      paymentTermsResponse,
      currenciesResponse,
    ] = await Promise.all([
      request(app)
        .get("/api/catalogs/quotation-statuses")
        .set("Authorization", `Bearer ${loginResponse.body.token}`),
      request(app)
        .get("/api/catalogs/quotation-actions")
        .set("Authorization", `Bearer ${loginResponse.body.token}`),
      request(app)
        .get("/api/catalogs/quotation-section-inclusion-types")
        .set("Authorization", `Bearer ${loginResponse.body.token}`),
      request(app)
        .get("/api/catalogs/quotation-delivery-times")
        .set("Authorization", `Bearer ${loginResponse.body.token}`),
      request(app)
        .get("/api/catalogs/quotation-validity-terms")
        .set("Authorization", `Bearer ${loginResponse.body.token}`),
      request(app)
        .get("/api/catalogs/quotation-warranty-terms")
        .set("Authorization", `Bearer ${loginResponse.body.token}`),
      request(app)
        .get("/api/catalogs/quotation-payment-terms")
        .set("Authorization", `Bearer ${loginResponse.body.token}`),
      request(app)
        .get("/api/catalogs/quotation-currencies")
        .set("Authorization", `Bearer ${loginResponse.body.token}`),
    ]);

    expect(statusesResponse.status).toBe(200);
    expect(actionsResponse.status).toBe(200);
    expect(inclusionResponse.status).toBe(200);
    expect(deliveryTimesResponse.status).toBe(200);
    expect(validityTermsResponse.status).toBe(200);
    expect(warrantyTermsResponse.status).toBe(200);
    expect(paymentTermsResponse.status).toBe(200);
    expect(currenciesResponse.status).toBe(200);
    expect(statusesResponse.body.map((row) => row.code)).toContain("borrador");
    expect(
      statusesResponse.body.find((row) => row.code === "borrador")?.uiKey,
    ).toBe("draft");
    expect(actionsResponse.body.map((row) => row.code)).toContain(
      "crear_cotizacion",
    );
    expect(inclusionResponse.body.map((row) => row.code)).toContain("incluida");
    expect(deliveryTimesResponse.body.map((row) => row.code)).toContain(
      "30_dias",
    );
    expect(validityTermsResponse.body.map((row) => row.code)).toContain(
      "30_dias",
    );
    expect(warrantyTermsResponse.body.map((row) => row.code)).toContain(
      "1_ano",
    );
    expect(paymentTermsResponse.body.map((row) => row.code)).toContain(
      "30_dias_facturado",
    );
    expect(currenciesResponse.body.map((row) => row.code)).toContain("USD");
  });

  test("cotizaciones expone cuentas, oportunidades por cuenta y contactos por cuenta con vendedor asignado", async () => {
    const fixture = await createOwnedQuoteOpportunityFixture(
      `${TEST_PREFIX}_quote_selectors`,
    );
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.quotes.operation@example.com`,
    );

    const accountsResponse = await request(app)
      .get("/api/quotation-accounts")
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(accountsResponse.status).toBe(200);
    expect(
      accountsResponse.body.some((row) => row.id === fixture.accountId),
    ).toBe(true);

    const opportunitiesResponse = await request(app)
      .get(`/api/quotation-accounts/${fixture.accountId}/opportunities`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(opportunitiesResponse.status).toBe(200);
    expect(opportunitiesResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fixture.opportunityId,
          accountId: fixture.accountId,
          sellerUserId: fixture.sellerUserId,
        }),
      ]),
    );

    const contactsResponse = await request(app)
      .get(`/api/quotation-accounts/${fixture.accountId}/contacts`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(contactsResponse.status).toBe(200);
    expect(contactsResponse.body.map((row) => row.id)).toEqual(
      expect.arrayContaining([fixture.contactId, fixture.alternateContactId]),
    );
  });

  test("cotizaciones permite buscar productos activos para llenar filas de la cotizacion", async () => {
    const suffix = `${TEST_PREFIX}_quote_product_picker`;
    const providerId = await createDirectProvider({
      actorUserId: ctx.quotationOperationUserId,
      suffix,
    });
    cleanup.providerIds.push(providerId);

    const priceListId = await createDirectProviderPriceList({
      providerId,
      actorUserId: ctx.quotationOperationUserId,
      suffix,
      itemType: "producto",
      isActive: true,
    });
    cleanup.providerPriceListIds.push(priceListId);

    const priceItemId = await createDirectProviderPriceItem({
      providerId,
      listId: priceListId,
      actorUserId: ctx.quotationOperationUserId,
      suffix,
      itemType: "producto",
    });
    cleanup.providerPriceItemIds.push(priceItemId);

    const bundleProviderId = await createDirectProvider({
      actorUserId: ctx.quotationOperationUserId,
      suffix: `${suffix}_bundle_provider`,
    });
    cleanup.providerIds.push(bundleProviderId);

    const bundlePriceListId = await createDirectProviderPriceList({
      providerId: bundleProviderId,
      actorUserId: ctx.quotationOperationUserId,
      suffix: `${suffix}_bundle_list`,
      itemType: "grupo_productos",
      isActive: true,
    });
    cleanup.providerPriceListIds.push(bundlePriceListId);

    const bundlePriceItemId = await createDirectProviderPriceItem({
      providerId: bundleProviderId,
      listId: bundlePriceListId,
      actorUserId: ctx.quotationOperationUserId,
      suffix: `${suffix}_bundle_item`,
      itemType: "grupo_productos",
    });
    cleanup.providerPriceItemIds.push(bundlePriceItemId);

    const bundleComponentItemId = await createDirectProviderPriceItem({
      providerId: bundleProviderId,
      listId: bundlePriceListId,
      actorUserId: ctx.quotationOperationUserId,
      suffix: `${suffix}_bundle_component`,
      itemType: "producto",
    });
    cleanup.providerPriceItemIds.push(bundleComponentItemId);

    await query(
      `INSERT INTO provider_price_list_item_components
        (grupo_item_id, component_item_id, quantity, sort_order, created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(3), ?, NOW(3))`,
      [
        bundlePriceItemId,
        bundleComponentItemId,
        2,
        1,
        ctx.quotationOperationUserId,
        ctx.quotationOperationUserId,
      ],
    );

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.quotes.operation@example.com`,
    );

    const response = await request(app)
      .get("/api/quotation-products/search")
      .query({ q: `PRICE-${suffix}` })
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: priceItemId,
          providerId,
          code: `PRICE-${suffix}`,
          description: `Precio fixture ${suffix}`,
          price: 1234.56,
          providerName: expect.any(String),
        }),
      ]),
    );

    const bundleResponse = await request(app)
      .get("/api/quotation-products/search")
      .query({
        providerId: bundleProviderId,
        q: `PRICE-${suffix}_bundle_item`,
      })
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(bundleResponse.status).toBe(200);
    expect(bundleResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: bundlePriceItemId,
          providerId: bundleProviderId,
          code: `PRICE-${suffix}_bundle_item`,
          description: `Precio fixture ${suffix}_bundle_item`,
          itemType: "grupo_productos",
          price: 1234.56,
          components: expect.arrayContaining([
            expect.objectContaining({
              componentItemId: bundleComponentItemId,
              code: `PRICE-${suffix}_bundle_component`,
              quantity: 2,
              itemType: "producto",
              price: 1234.56,
            }),
          ]),
        }),
      ]),
    );
  });

  test("cotizaciones.create crea desde oportunidad activa y aplica defaults de version", async () => {
    const fixture = await createOwnedQuoteOpportunityFixture(
      `${TEST_PREFIX}_quote_create`,
    );
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.quotes.operation@example.com`,
    );

    const response = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/quotations`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        accountId: fixture.accountId,
        contactId: fixture.alternateContactId,
        sellerUserId: fixture.sellerUserId,
        introduction: "Intro inicial",
        sections: [
          {
            title: "Alcance inicial",
            inclusionTypeId: ctx.catalogIds.quotationIncludedTypeId,
          },
          {
            title: "Exclusiones",
            inclusionTypeId: ctx.catalogIds.quotationIncludedTypeId,
          },
        ],
      });

    expect(response.status).toBe(201);
    cleanup.quotationIds.push(Number(response.body.quotationId));

    const detailResponse = await request(app)
      .get(`/api/quotations/${response.body.quotationId}`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.versions).toHaveLength(1);
    expect(detailResponse.body.versions[0].versionNumber).toBe(1);
    expect(detailResponse.body.versions[0].statusCode).toBe("borrador");

    const versionResponse = await request(app)
      .get(`/api/quotation-versions/${response.body.latestVersionId}`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(versionResponse.status).toBe(200);
    expect(versionResponse.body.contactId).toBe(fixture.alternateContactId);
    expect(versionResponse.body.proposalName).toBe(
      `Oportunidad cotizacion ${TEST_PREFIX}_quote_create`,
    );
    expect(versionResponse.body.introduction).toBe("Intro inicial");
    expect(versionResponse.body.sections).toHaveLength(2);
    expect(
      versionResponse.body.sections.map((section) => section.title),
    ).toEqual(["Alcance inicial", "Exclusiones"]);
  });

  test("cotizaciones.listado por oportunidad expone vendedor de la oportunidad", async () => {
    const fixture = await createOwnedQuoteOpportunityFixture(
      `${TEST_PREFIX}_quote_list_seller`,
    );
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.quotes.operation@example.com`,
    );

    const createResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/quotations`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        accountId: fixture.accountId,
        contactId: fixture.contactId,
        sellerUserId: fixture.sellerUserId,
        proposalName: `Propuesta ${TEST_PREFIX}_quote_list_seller`,
        sections: [
          {
            title: "Seccion inicial",
            inclusionTypeId: ctx.catalogIds.quotationIncludedTypeId,
          },
        ],
      });

    expect(createResponse.status).toBe(201);
    cleanup.quotationIds.push(Number(createResponse.body.quotationId));

    const listResponse = await request(app)
      .get(`/api/opportunities/${fixture.opportunityId}/quotations`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: Number(createResponse.body.quotationId),
          sellerUserId: fixture.sellerUserId,
          sellerUserName: fixture.sellerUserName,
        }),
      ]),
    );
  });

  test("cotizaciones.listado general expone vendedor de la oportunidad", async () => {
    const fixture = await createOwnedQuoteOpportunityFixture(
      `${TEST_PREFIX}_quote_list_global_seller`,
    );
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.quotes.operation@example.com`,
    );

    const createResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/quotations`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        accountId: fixture.accountId,
        contactId: fixture.contactId,
        sellerUserId: fixture.sellerUserId,
        proposalName: `Propuesta ${TEST_PREFIX}_quote_list_global_seller`,
        sections: [
          {
            title: "Seccion general",
            inclusionTypeId: ctx.catalogIds.quotationIncludedTypeId,
          },
        ],
      });

    expect(createResponse.status).toBe(201);
    cleanup.quotationIds.push(Number(createResponse.body.quotationId));

    const listResponse = await request(app)
      .get("/api/quotations")
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: Number(createResponse.body.quotationId),
          sellerUserId: fixture.sellerUserId,
          sellerUserName: fixture.sellerUserName,
        }),
      ]),
    );
  });

  test("cotizaciones.listado general expone el total calculado de la version mayor", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_quote_list_total_amount`,
    );

    if (!ctx.fixtureProviderId) {
      ctx.fixtureProviderId = await createDirectProvider({
        actorUserId: ctx.providerManagerUserId,
        suffix: `${TEST_PREFIX}_quote_list_total_amount_provider`,
      });
      cleanup.providerIds.push(ctx.fixtureProviderId);
    }

    const fullSaveResponse = await request(app)
      .put(`/api/quotation-versions/${fixture.latestVersionId}/full`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        contactId: fixture.contactId,
        proposalName: `Propuesta ${TEST_PREFIX}_quote_list_total_amount`,
        quotationDate: "2026-04-26",
        summaryDiscountMode: "percentage",
        summaryDiscountValue: 25,
        summaryDistributionMode: "total",
        summaryVatMode: "total",
        summaryVatPct: 16,
        sections: [
          {
            localId: "section-list-total-1",
            title: "Seccion total calculado",
            inclusionTypeId: ctx.catalogIds.quotationIncludedTypeId,
            displayOrder: 1,
            items: [
              {
                localId: "item-list-total-1",
                providerId: ctx.fixtureProviderId,
                productCode: "SKU-LIST-TOTAL",
                productDescription: "Producto para validar total listado",
                quantity: 1,
                listPriceUnit: 100,
                manufacturerDiscountPct: 0,
                importCostPct: 0,
                profitMarginPct: 50,
                finalDiscountPct: 0,
                itemType: "producto",
                displayOrder: 1,
              },
            ],
          },
        ],
      });

    expect(fullSaveResponse.status).toBe(200);

    const listResponse = await request(app)
      .get("/api/quotations")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(listResponse.status).toBe(200);

    const createdQuotation = listResponse.body.find(
      (quotation) => Number(quotation.id) === Number(fixture.quotationId),
    );

    expect(createdQuotation).toBeTruthy();
    expect(createdQuotation.latestTotalSaleAmount).toBeCloseTo(174, 6);
  });

  test("cotizaciones.create persiste bundles reales y los conserva al clonar version", async () => {
    const suffix = `${TEST_PREFIX}_quote_bundle_persist`;
    const fixture = await createOwnedQuoteOpportunityFixture(suffix);
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.quotes.operation@example.com`,
    );

    const providerId = await createDirectProvider({
      actorUserId: ctx.providerManagerUserId,
      suffix,
    });
    cleanup.providerIds.push(providerId);

    const priceListId = await createDirectProviderPriceList({
      providerId,
      actorUserId: ctx.providerManagerUserId,
      suffix,
      isActive: true,
    });
    cleanup.providerPriceListIds.push(priceListId);

    const bundlePriceItemId = await createDirectProviderPriceItem({
      providerId,
      actorUserId: ctx.providerManagerUserId,
      suffix: `${suffix}_bundle`,
      itemType: "grupo_productos",
      listId: priceListId,
    });
    cleanup.providerPriceItemIds.push(bundlePriceItemId);

    const bundleComponentItemId = await createDirectProviderPriceItem({
      providerId,
      actorUserId: ctx.providerManagerUserId,
      suffix: `${suffix}_component`,
      itemType: "producto",
      listId: priceListId,
    });
    cleanup.providerPriceItemIds.push(bundleComponentItemId);

    const createResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/quotations`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        accountId: fixture.accountId,
        contactId: fixture.contactId,
        sellerUserId: fixture.sellerUserId,
        proposalName: `Propuesta ${suffix}`,
        sections: [
          {
            title: "Bundle persistido",
            inclusionTypeId: ctx.catalogIds.quotationIncludedTypeId,
            items: [
              {
                clientItemId: "bundle-list-parent",
                providerId,
                productCode: "BUNDLE-LIST",
                productDescription: "Bundle proveniente de lista",
                itemType: "grupo_productos",
                bundleOriginType: "price_list_bundle",
                sourceProviderPriceListItemId: bundlePriceItemId,
                quantity: 1,
                listPriceUnit: 0,
                manufacturerDiscountPct: 0,
                importCostPct: 0,
                profitMarginPct: 0,
                finalDiscountPct: 0,
                displayOrder: 1,
              },
              {
                clientItemId: "bundle-list-child",
                bundleParentClientItemId: "bundle-list-parent",
                providerId,
                productCode: "BUNDLE-LIST-COMP",
                productDescription: "Componente de bundle de lista",
                itemType: "producto",
                bundleOriginType: "price_list_bundle",
                sourceComponentPriceListItemId: bundleComponentItemId,
                quantity: 2,
                listPriceUnit: 250,
                manufacturerDiscountPct: 5,
                importCostPct: 10,
                profitMarginPct: 20,
                finalDiscountPct: 0,
                displayOrder: 2,
              },
              {
                clientItemId: "bundle-manual-parent",
                providerId,
                productCode: "BUNDLE-MANUAL",
                productDescription: "Bundle manual",
                itemType: "grupo_productos",
                bundleOriginType: "manual_bundle",
                quantity: 1,
                listPriceUnit: 0,
                manufacturerDiscountPct: 0,
                importCostPct: 0,
                profitMarginPct: 0,
                finalDiscountPct: 0,
                displayOrder: 3,
              },
              {
                clientItemId: "bundle-manual-child",
                bundleParentClientItemId: "bundle-manual-parent",
                providerId,
                productCode: "BUNDLE-MANUAL-COMP",
                productDescription: "Componente manual",
                itemType: "producto",
                bundleOriginType: "manual_bundle",
                quantity: 1,
                listPriceUnit: 150,
                manufacturerDiscountPct: 0,
                importCostPct: 0,
                profitMarginPct: 15,
                finalDiscountPct: 0,
                displayOrder: 4,
              },
            ],
          },
        ],
      });

    expect(createResponse.status).toBe(201);
    cleanup.quotationIds.push(Number(createResponse.body.quotationId));

    const versionResponse = await request(app)
      .get(`/api/quotation-versions/${createResponse.body.latestVersionId}`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(versionResponse.status).toBe(200);
    expect(versionResponse.body.sections).toHaveLength(1);
    expect(versionResponse.body.sections[0].items).toHaveLength(4);

    const listBundleParent = versionResponse.body.sections[0].items.find(
      (item) => item.productCode === "BUNDLE-LIST",
    );
    const listBundleChild = versionResponse.body.sections[0].items.find(
      (item) => item.productCode === "BUNDLE-LIST-COMP",
    );
    const manualBundleParent = versionResponse.body.sections[0].items.find(
      (item) => item.productCode === "BUNDLE-MANUAL",
    );
    const manualBundleChild = versionResponse.body.sections[0].items.find(
      (item) => item.productCode === "BUNDLE-MANUAL-COMP",
    );

    expect(listBundleParent).toEqual(
      expect.objectContaining({
        itemType: "grupo_productos",
        bundleParentItemId: null,
        bundleOriginType: "price_list_bundle",
        sourceProviderPriceListItemId: bundlePriceItemId,
      }),
    );
    expect(listBundleChild).toEqual(
      expect.objectContaining({
        itemType: "producto",
        bundleParentItemId: listBundleParent.id,
        bundleOriginType: "price_list_bundle",
        sourceComponentPriceListItemId: bundleComponentItemId,
        bundleSortOrder: 1,
      }),
    );
    expect(manualBundleParent).toEqual(
      expect.objectContaining({
        itemType: "grupo_productos",
        bundleParentItemId: null,
        bundleOriginType: "manual_bundle",
      }),
    );
    expect(manualBundleChild).toEqual(
      expect.objectContaining({
        itemType: "producto",
        bundleParentItemId: manualBundleParent.id,
        bundleOriginType: "manual_bundle",
        bundleSortOrder: 1,
      }),
    );

    const cloneResponse = await request(app)
      .post(`/api/quotations/${createResponse.body.quotationId}/versions`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({});

    expect(cloneResponse.status).toBe(201);

    const clonedVersionResponse = await request(app)
      .get(`/api/quotation-versions/${cloneResponse.body.id}`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(clonedVersionResponse.status).toBe(200);

    const clonedListBundleParent =
      clonedVersionResponse.body.sections[0].items.find(
        (item) => item.productCode === "BUNDLE-LIST",
      );
    const clonedListBundleChild =
      clonedVersionResponse.body.sections[0].items.find(
        (item) => item.productCode === "BUNDLE-LIST-COMP",
      );
    const clonedManualBundleParent =
      clonedVersionResponse.body.sections[0].items.find(
        (item) => item.productCode === "BUNDLE-MANUAL",
      );
    const clonedManualBundleChild =
      clonedVersionResponse.body.sections[0].items.find(
        (item) => item.productCode === "BUNDLE-MANUAL-COMP",
      );

    expect(clonedListBundleParent.bundleOriginType).toBe("price_list_bundle");
    expect(clonedListBundleChild.bundleParentItemId).toBe(
      clonedListBundleParent.id,
    );
    expect(clonedListBundleChild.sourceComponentPriceListItemId).toBe(
      bundleComponentItemId,
    );
    expect(clonedManualBundleParent.bundleOriginType).toBe("manual_bundle");
    expect(clonedManualBundleChild.bundleParentItemId).toBe(
      clonedManualBundleParent.id,
    );
  });

  test("cotizaciones.create bloquea oportunidad inactiva y contacto de otra cuenta", async () => {
    const fixture = await createOwnedQuoteOpportunityFixture(
      `${TEST_PREFIX}_quote_invalids`,
    );
    const foreignAccountId = await createDirectAccount({
      ownerUserId: ctx.quotationOperationUserId,
      actorUserId: ctx.quotationOperationUserId,
      suffix: `${TEST_PREFIX}_quote_invalid_foreign`,
    });
    cleanup.accountIds.push(foreignAccountId);
    const foreignContactId = await createDirectContact({
      accountId: foreignAccountId,
      actorUserId: ctx.quotationOperationUserId,
      suffix: `${TEST_PREFIX}_quote_invalid_foreign`,
    });
    cleanup.contactIds.push(foreignContactId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.quotes.operation@example.com`,
    );

    const wrongContactResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/quotations`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        accountId: fixture.accountId,
        contactId: foreignContactId,
        sellerUserId: fixture.sellerUserId,
        sections: [],
      });

    expect(wrongContactResponse.status).toBe(400);
    expect(wrongContactResponse.body.message).toBe(
      "El contacto debe pertenecer a la cuenta de la oportunidad",
    );

    await query(
      "UPDATE opportunities SET activation_status_id = ? WHERE id = ?",
      [ctx.catalogIds.opportunityInactiveStatusId, fixture.opportunityId],
    );

    const inactiveResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/quotations`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        accountId: fixture.accountId,
        contactId: fixture.contactId,
        sellerUserId: fixture.sellerUserId,
        sections: [],
      });

    expect(inactiveResponse.status).toBe(400);
    expect(inactiveResponse.body.message).toBe(
      "Solo se puede crear una cotizacion desde una oportunidad activa",
    );
  });

  test("cotizaciones persiste modos de distribucion e IVA a nivel de version", async () => {
    const fixture = await createOwnedQuoteOpportunityFixture(
      `${TEST_PREFIX}_quote_summary_modes`,
    );
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.quotes.operation@example.com`,
    );

    const createResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/quotations`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        accountId: fixture.accountId,
        contactId: fixture.contactId,
        sellerUserId: fixture.sellerUserId,
        summaryDiscountMode: "amount",
        summaryDiscountValue: 25,
        summaryDistributionMode: "per_item",
        summaryVatMode: "total",
        summaryVatPct: 16,
        internalNotes: "Nota interna inicial para el equipo comercial",
        deliveryTime: "45_dias",
        quotationValidity: "60_dias",
        warranty: "2_anos",
        paymentTerms: "100_adelantado",
        currencyCode: "EUR",
        exchangeRate: 17.25,
        quotationNotes: "Entrega sujeta a confirmacion de fabrica.",
        sections: [],
      });

    expect(createResponse.status).toBe(201);
    cleanup.quotationIds.push(Number(createResponse.body.quotationId));

    const versionResponse = await request(app)
      .get(`/api/quotation-versions/${createResponse.body.latestVersionId}`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(versionResponse.status).toBe(200);
    expect(versionResponse.body.summaryDiscountMode).toBe("amount");
    expect(versionResponse.body.summaryDiscountValue).toBe(25);
    expect(versionResponse.body.summaryDistributionMode).toBe("per_item");
    expect(versionResponse.body.summaryVatMode).toBe("total");
    expect(versionResponse.body.summaryVatPct).toBe(16);
    expect(versionResponse.body.internalNotes).toBe(
      "Nota interna inicial para el equipo comercial",
    );
    expect(versionResponse.body.deliveryTime).toBe("45_dias");
    expect(versionResponse.body.quotationValidity).toBe("60_dias");
    expect(versionResponse.body.warranty).toBe("2_anos");
    expect(versionResponse.body.paymentTerms).toBe("100_adelantado");
    expect(versionResponse.body.currencyCode).toBe("EUR");
    expect(versionResponse.body.exchangeRate).toBe(17.25);
    expect(versionResponse.body.quotationNotes).toBe(
      "Entrega sujeta a confirmacion de fabrica.",
    );

    const cloneResponse = await request(app)
      .post(`/api/quotations/${createResponse.body.quotationId}/versions`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({});

    expect(cloneResponse.status).toBe(201);

    const clonedVersionResponse = await request(app)
      .get(`/api/quotation-versions/${cloneResponse.body.id}`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(clonedVersionResponse.status).toBe(200);
    expect(clonedVersionResponse.body.summaryDistributionMode).toBe("per_item");
    expect(clonedVersionResponse.body.summaryVatMode).toBe("total");
    expect(clonedVersionResponse.body.summaryVatPct).toBe(16);
    expect(clonedVersionResponse.body.internalNotes).toBe(
      "Nota interna inicial para el equipo comercial",
    );
    expect(clonedVersionResponse.body.deliveryTime).toBe("45_dias");
    expect(clonedVersionResponse.body.quotationValidity).toBe("60_dias");
    expect(clonedVersionResponse.body.warranty).toBe("2_anos");
    expect(clonedVersionResponse.body.paymentTerms).toBe("100_adelantado");
    expect(clonedVersionResponse.body.currencyCode).toBe("EUR");
    expect(clonedVersionResponse.body.exchangeRate).toBe(17.25);
    expect(clonedVersionResponse.body.quotationNotes).toBe(
      "Entrega sujeta a confirmacion de fabrica.",
    );

    const adminLogin = await login(
      request(app),
      `${TEST_PREFIX}.quotes.admin@example.com`,
    );

    const updateResponse = await request(app)
      .put(`/api/quotation-versions/${createResponse.body.latestVersionId}`)
      .set("Authorization", `Bearer ${adminLogin.body.token}`)
      .send({
        contactId: fixture.contactId,
        summaryDistributionMode: "total",
        summaryVatMode: "without_vat",
        summaryVatPct: 0,
        internalNotes: "Nota interna actualizada por administracion",
        deliveryTime: "30_dias",
        quotationValidity: "30_dias",
        warranty: "1_ano",
        paymentTerms: "30_dias_facturado",
        currencyCode: "USD",
        exchangeRate: 1,
        quotationNotes: "Los precios no incluyen maniobras especiales.",
      });

    expect(updateResponse.status).toBe(200);

    const updatedVersionResponse = await request(app)
      .get(`/api/quotation-versions/${createResponse.body.latestVersionId}`)
      .set("Authorization", `Bearer ${adminLogin.body.token}`);

    expect(updatedVersionResponse.status).toBe(200);
    expect(updatedVersionResponse.body.summaryDistributionMode).toBe("total");
    expect(updatedVersionResponse.body.summaryVatMode).toBe("without_vat");
    expect(updatedVersionResponse.body.summaryVatPct).toBe(0);
    expect(updatedVersionResponse.body.internalNotes).toBe(
      "Nota interna actualizada por administracion",
    );
    expect(updatedVersionResponse.body.deliveryTime).toBe("30_dias");
    expect(updatedVersionResponse.body.quotationValidity).toBe("30_dias");
    expect(updatedVersionResponse.body.warranty).toBe("1_ano");
    expect(updatedVersionResponse.body.paymentTerms).toBe("30_dias_facturado");
    expect(updatedVersionResponse.body.currencyCode).toBe("USD");
    expect(updatedVersionResponse.body.exchangeRate).toBe(1);
    expect(updatedVersionResponse.body.quotationNotes).toBe(
      "Los precios no incluyen maniobras especiales.",
    );
  });

  test("cotizaciones permite crear nueva version, bloquear transicion en no mayor y editar version vieja con permiso de administracion", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_quote_versions`,
    );

    if (!ctx.fixtureProviderId) {
      ctx.fixtureProviderId = await createDirectProvider({
        actorUserId: ctx.providerManagerUserId,
        suffix: `${TEST_PREFIX}_quote_provider`,
      });
      cleanup.providerIds.push(ctx.fixtureProviderId);
    }

    const seedVersionResponse = await request(app)
      .put(`/api/quotation-versions/${fixture.latestVersionId}/full`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        contactId: fixture.contactId,
        proposalName: "Cotizacion base con infraestructura",
        sections: [
          {
            localId: "seed-section-1",
            title: "Infraestructura",
            inclusionTypeId: ctx.catalogIds.quotationIncludedTypeId,
            displayOrder: 1,
            items: [
              {
                localId: "seed-item-1",
                providerId: ctx.fixtureProviderId,
                productCode: "SKU-1",
                productDescription: "Producto de prueba",
                quantity: 2,
                listPriceUnit: 100,
                manufacturerDiscountPct: 5,
                importCostPct: 10,
                profitMarginPct: 15,
                finalDiscountPct: 0,
                displayOrder: 1,
              },
            ],
          },
        ],
      });

    expect(seedVersionResponse.status).toBe(200);

    const createVersionResponse = await request(app)
      .post(`/api/quotations/${fixture.quotationId}/versions`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    expect(createVersionResponse.status).toBe(201);
    const version2Id = Number(createVersionResponse.body.id);

    const version2Response = await request(app)
      .get(`/api/quotation-versions/${version2Id}`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(version2Response.status).toBe(200);
    expect(version2Response.body.versionNumber).toBe(2);
    expect(version2Response.body.sections).toHaveLength(1);
    expect(version2Response.body.sections[0].items).toHaveLength(1);

    const oldVersionTransitionResponse = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/transition`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ actionCode: "solicitar_aprobacion" });

    expect(oldVersionTransitionResponse.status).toBe(400);
    expect(oldVersionTransitionResponse.body.message).toBe(
      "Solo la version mayor puede cambiar de estado",
    );

    const adminLogin = await login(
      request(app),
      `${TEST_PREFIX}.quotes.admin@example.com`,
    );
    const adminEditResponse = await request(app)
      .put(`/api/quotation-versions/${fixture.latestVersionId}`)
      .set("Authorization", `Bearer ${adminLogin.body.token}`)
      .send({
        contactId: fixture.contactId,
        proposalName: "Version historica ajustada",
      });

    expect(adminEditResponse.status).toBe(200);

    const editedVersionResponse = await request(app)
      .get(`/api/quotation-versions/${fixture.latestVersionId}`)
      .set("Authorization", `Bearer ${adminLogin.body.token}`);
    expect(editedVersionResponse.body.proposalName).toBe(
      "Version historica ajustada",
    );
  });

  test("cotizaciones.full-save persiste mezcla de actualizar, crear y eliminar filas en una sola transaccion", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_quote_full_save_success`,
    );

    if (!ctx.fixtureProviderId) {
      ctx.fixtureProviderId = await createDirectProvider({
        actorUserId: ctx.providerManagerUserId,
        suffix: `${TEST_PREFIX}_quote_provider`,
      });
      cleanup.providerIds.push(ctx.fixtureProviderId);
    }

    const initialVersionResponse = await request(app)
      .put(`/api/quotation-versions/${fixture.latestVersionId}/full`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        contactId: fixture.contactId,
        proposalName: "Cotizacion semilla",
        sections: [
          {
            localId: "seed-section-1",
            title: "Infraestructura base",
            inclusionTypeId: ctx.catalogIds.quotationIncludedTypeId,
            displayOrder: 1,
            items: [
              {
                localId: "seed-item-1",
                providerId: ctx.fixtureProviderId,
                productCode: "SKU-OLD-1",
                productDescription: "Producto original A",
                quantity: 2,
                listPriceUnit: 100,
                manufacturerDiscountPct: 5,
                importCostPct: 10,
                profitMarginPct: 15,
                finalDiscountPct: 0,
                displayOrder: 1,
              },
              {
                localId: "seed-item-2",
                providerId: ctx.fixtureProviderId,
                productCode: "SKU-OLD-2",
                productDescription: "Producto original B",
                quantity: 1,
                listPriceUnit: 50,
                manufacturerDiscountPct: 0,
                importCostPct: 8,
                profitMarginPct: 12,
                finalDiscountPct: 0,
                displayOrder: 2,
              },
            ],
          },
        ],
      });

    expect(initialVersionResponse.status).toBe(200);

    const seededSection = initialVersionResponse.body.sections[0];
    const seededItemA = seededSection.items.find(
      (item) => item.productCode === "SKU-OLD-1",
    );
    const seededItemB = seededSection.items.find(
      (item) => item.productCode === "SKU-OLD-2",
    );

    expect(seededSection).toBeTruthy();
    expect(seededItemA).toBeTruthy();
    expect(seededItemB).toBeTruthy();

    const fullSaveResponse = await request(app)
      .put(`/api/quotation-versions/${fixture.latestVersionId}/full`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        contactId: fixture.contactId,
        proposalName: "Cotizacion consolidada",
        sections: [
          {
            id: Number(seededSection.id),
            localId: "section-existing-1",
            title: "Infraestructura ajustada",
            inclusionTypeId: ctx.catalogIds.quotationIncludedTypeId,
            displayOrder: 1,
            items: [
              {
                id: Number(seededItemA.id),
                localId: "item-existing-1",
                providerId: ctx.fixtureProviderId,
                productCode: "SKU-OLD-1",
                productDescription: "Producto original A ajustado",
                quantity: 5,
                listPriceUnit: 125,
                manufacturerDiscountPct: 4,
                importCostPct: 9,
                profitMarginPct: 14,
                finalDiscountPct: 1,
                displayOrder: 1,
              },
              {
                localId: "item-new-1",
                providerId: ctx.fixtureProviderId,
                productCode: "SKU-NEW-1",
                productDescription: "Producto nuevo",
                quantity: 3,
                listPriceUnit: 75,
                manufacturerDiscountPct: 2,
                importCostPct: 6,
                profitMarginPct: 11,
                finalDiscountPct: 0,
                displayOrder: 2,
              },
            ],
          },
        ],
      });

    expect(fullSaveResponse.status).toBe(200);
    expect(fullSaveResponse.body.proposalName).toBe("Cotizacion consolidada");
    expect(fullSaveResponse.body.sections).toHaveLength(1);
    expect(fullSaveResponse.body.sections[0].title).toBe(
      "Infraestructura ajustada",
    );
    expect(fullSaveResponse.body.sections[0].items).toHaveLength(2);

    const versionResponse = await request(app)
      .get(`/api/quotation-versions/${fixture.latestVersionId}`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(versionResponse.status).toBe(200);
    expect(versionResponse.body.proposalName).toBe("Cotizacion consolidada");
    expect(versionResponse.body.sections).toHaveLength(1);
    expect(versionResponse.body.sections[0].title).toBe(
      "Infraestructura ajustada",
    );

    const persistedItems = versionResponse.body.sections[0].items;
    expect(persistedItems).toHaveLength(2);
    expect(persistedItems.map((item) => item.productCode)).toEqual([
      "SKU-OLD-1",
      "SKU-NEW-1",
    ]);
    expect(
      persistedItems.find((item) => item.productCode === "SKU-OLD-1"),
    ).toMatchObject({
      productDescription: "Producto original A ajustado",
      quantity: 5,
      listPriceUnit: 125,
      manufacturerDiscountPct: 4,
      importCostPct: 9,
      profitMarginPct: 14,
      finalDiscountPct: 1,
    });
    expect(
      persistedItems.some((item) => Number(item.id) === Number(seededItemB.id)),
    ).toBe(false);
  });

  test("cotizaciones.full-save hace rollback si el payload referencia una seccion invalida", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_quote_full_save_rollback`,
    );

    if (!ctx.fixtureProviderId) {
      ctx.fixtureProviderId = await createDirectProvider({
        actorUserId: ctx.providerManagerUserId,
        suffix: `${TEST_PREFIX}_quote_provider`,
      });
      cleanup.providerIds.push(ctx.fixtureProviderId);
    }

    const initialVersionResponse = await request(app)
      .put(`/api/quotation-versions/${fixture.latestVersionId}/full`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        contactId: fixture.contactId,
        proposalName: "Cotizacion estable",
        sections: [
          {
            localId: "seed-section-1",
            title: "Seccion intacta",
            inclusionTypeId: ctx.catalogIds.quotationIncludedTypeId,
            displayOrder: 1,
            items: [
              {
                localId: "seed-item-1",
                providerId: ctx.fixtureProviderId,
                productCode: "SKU-STABLE-1",
                productDescription: "Producto estable",
                quantity: 2,
                listPriceUnit: 80,
                manufacturerDiscountPct: 1,
                importCostPct: 5,
                profitMarginPct: 10,
                finalDiscountPct: 0,
                displayOrder: 1,
              },
            ],
          },
        ],
      });

    expect(initialVersionResponse.status).toBe(200);

    const seededSection = initialVersionResponse.body.sections[0];
    const seededItem = seededSection.items.find(
      (item) => item.productCode === "SKU-STABLE-1",
    );

    expect(seededSection).toBeTruthy();
    expect(seededItem).toBeTruthy();

    const failedSaveResponse = await request(app)
      .put(`/api/quotation-versions/${fixture.latestVersionId}/full`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        contactId: fixture.contactId,
        proposalName: "No debe persistir",
        sections: [
          {
            id: 999999999,
            localId: "section-invalid-1",
            title: "Seccion invalida",
            inclusionTypeId: ctx.catalogIds.quotationIncludedTypeId,
            displayOrder: 1,
            items: [
              {
                id: Number(seededItem.id),
                localId: "item-existing-1",
                providerId: ctx.fixtureProviderId,
                productCode: "SKU-STABLE-1",
                productDescription: "Producto no debe cambiar",
                quantity: 7,
                listPriceUnit: 90,
                manufacturerDiscountPct: 1,
                importCostPct: 5,
                profitMarginPct: 10,
                finalDiscountPct: 0,
                displayOrder: 1,
              },
            ],
          },
        ],
      });

    expect(failedSaveResponse.status).toBe(400);
    expect(failedSaveResponse.body.message).toContain(
      "Seccion invalida para la version",
    );

    const versionResponse = await request(app)
      .get(`/api/quotation-versions/${fixture.latestVersionId}`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(versionResponse.status).toBe(200);
    expect(versionResponse.body.proposalName).not.toBe("No debe persistir");
    expect(versionResponse.body.sections).toHaveLength(1);
    expect(versionResponse.body.sections[0].title).toBe("Seccion intacta");
    expect(versionResponse.body.sections[0].items).toHaveLength(1);
    expect(versionResponse.body.sections[0].items[0]).toMatchObject({
      productCode: "SKU-STABLE-1",
      productDescription: "Producto estable",
      quantity: 2,
      listPriceUnit: 80,
    });
  });

  test("Administrador sin cotizaciones.administracion no puede acceder a version vieja", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_quote_admin_without_permission`,
    );

    const createVersionResponse = await request(app)
      .post(`/api/quotations/${fixture.quotationId}/versions`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    expect(createVersionResponse.status).toBe(201);

    const adminRoleRows = await query(
      "SELECT id FROM roles WHERE name = 'Administrador' LIMIT 1",
    );
    expect(adminRoleRows).toHaveLength(1);
    const adminRoleId = Number(adminRoleRows[0].id);

    const adminPermissionRows = await query(
      "SELECT id FROM permissions WHERE code = 'cotizaciones.administracion' LIMIT 1",
    );
    expect(adminPermissionRows).toHaveLength(1);
    const adminPermissionId = Number(adminPermissionRows[0].id);

    await query(
      "DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?",
      [adminRoleId, adminPermissionId],
    );

    const adminUserId = await createUser({
      fullName: "API Quote Real Admin",
      email: `${TEST_PREFIX}.quotes.real.admin@example.com`,
      roleIds: [adminRoleId],
    });
    cleanup.userIds.push(adminUserId);

    const adminLogin = await login(
      request(app),
      `${TEST_PREFIX}.quotes.real.admin@example.com`,
    );

    const adminEditResponse = await request(app)
      .put(`/api/quotation-versions/${fixture.latestVersionId}`)
      .set("Authorization", `Bearer ${adminLogin.body.token}`)
      .send({
        contactId: fixture.contactId,
        proposalName: "Version historica no autorizada",
      });

    expect(adminEditResponse.status).toBe(404);
    expect(adminEditResponse.body.message).toBe("Version no encontrada");

    await query(
      "INSERT INTO role_permissions (role_id, permission_id, created_at) VALUES (?, ?, NOW(3))",
      [adminRoleId, adminPermissionId],
    );
  });

  test("cotizaciones valida inclusion contra catalogo y matriz de acciones por estado", async () => {
    const fixture = await createQuotationFixture(`${TEST_PREFIX}_quote_matrix`);
    const invalidSectionResponse = await request(app)
      .put(`/api/quotation-versions/${fixture.latestVersionId}/full`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        contactId: fixture.contactId,
        proposalName: "Cotizacion con inclusion invalida",
        sections: [
          {
            localId: "invalid-section-1",
            title: "Seccion invalida",
            inclusionTypeId: 999999,
            displayOrder: 1,
            items: [],
          },
        ],
      });

    expect(invalidSectionResponse.status).toBe(400);
    expect(invalidSectionResponse.body.message).toBe("Inclusion invalida");

    const operationActionsResponse = await request(app)
      .get(`/api/quotation-versions/${fixture.latestVersionId}/actions`)
      .set("Authorization", `Bearer ${fixture.token}`);
    expect(operationActionsResponse.status).toBe(200);
    const operationAllowedCodes = operationActionsResponse.body.actions
      .filter((action) => action.allowed)
      .map((action) => action.code);
    expect(operationAllowedCodes).toContain("solicitar_aprobacion");
    expect(operationAllowedCodes).toContain("declarar_perdida");

    const transitionResponse = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/transition`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ actionCode: "solicitar_aprobacion" });
    expect(transitionResponse.status).toBe(200);

    const revisionLogin = await login(
      request(app),
      `${TEST_PREFIX}.quotes.revision@example.com`,
    );
    const revisionActionsResponse = await request(app)
      .get(`/api/quotation-versions/${fixture.latestVersionId}/actions`)
      .set("Authorization", `Bearer ${revisionLogin.body.token}`);
    const revisionAllowedCodes = revisionActionsResponse.body.actions
      .filter((action) => action.allowed)
      .map((action) => action.code);
    expect(revisionAllowedCodes).toContain("aprobar");
    expect(revisionAllowedCodes).toContain("rechazar");
    expect(revisionAllowedCodes).not.toContain("solicitar_aprobacion");

    const revisionApproveResponse = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/transition`)
      .set("Authorization", `Bearer ${revisionLogin.body.token}`)
      .send({ actionCode: "aprobar" });
    expect(revisionApproveResponse.status).toBe(200);

    const externalLogin = await login(
      request(app),
      `${TEST_PREFIX}.quotes.external@example.com`,
    );
    const externalActionsResponse = await request(app)
      .get(`/api/quotation-versions/${fixture.latestVersionId}/actions`)
      .set("Authorization", `Bearer ${externalLogin.body.token}`);
    const externalAllowedCodes = externalActionsResponse.body.actions
      .filter((action) => action.allowed)
      .map((action) => action.code);
    expect(externalAllowedCodes).toContain("ver");
    expect(externalAllowedCodes).not.toContain("modificar");
  });
});
