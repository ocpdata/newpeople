import request from "supertest";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { app } from "../src/app.js";
import { config } from "../src/config.js";
import { ensureCommercialEnablementPermissions } from "../src/commercial-enablement/permissions.js";
import { ensureCommercialTrackingPermissions } from "../src/commercial-tracking/permissions.js";
import { ensureCommercialPlanningPermissions } from "../src/commercial-planning/permissions.js";
import { ensureCommercialPlanningSchema } from "../src/commercial-planning/schema.js";
import { ensureCommercialExecutionSchema } from "../src/commercial-execution/schema.js";
import { ensureManufacturerRegistrationPermissions } from "../src/manufacturer-registrations/permissions.js";
import { ensureManufacturerRegistrationsSchema } from "../src/manufacturer-registrations/schema.js";
import {
  analyzeAccountDraft,
  processPendingAccountDraftAnalysisJobs,
} from "../src/accounts/draft-analysis/index.js";
import { pool, query } from "../src/db.js";
import { processPendingCommercialNarrativeJobs } from "../src/routes.execution-commercial.js";
import { processPendingInteractionAnalysisJobs } from "../src/routes.interactions.js";
import { processPendingProposalExecutiveSummaryGenerationJobs } from "../src/routes.quotations.js";
import { processPendingOpportunityStageAnswerSuggestionJobs } from "../src/opportunity-stage-answer-suggestions/service.js";
import { processPendingOpportunityStageValidationJobs } from "../src/opportunity-stage-validations/service.js";
import { processPendingOpportunityDocumentJobs } from "../src/opportunity-documents/service.js";
import { ensureOpportunityDocumentSchema } from "../src/opportunity-documents/schema.js";
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
    proposalIds: [],
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
    await ensureCommercialEnablementPermissions();
    await ensureCommercialTrackingPermissions();
    await ensureCommercialPlanningPermissions();
    await ensureCommercialPlanningSchema();
    await ensureCommercialExecutionSchema();
    await ensureManufacturerRegistrationPermissions();
    await ensureManufacturerRegistrationsSchema();

    await query(
      `INSERT INTO contact_relationship_types (code, name, is_active)
       VALUES ('ninguno', 'Ninguno', 0)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         is_active = VALUES(is_active)`,
    );

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
        "desarrollo_comercial.read",
        "desarrollo_comercial.update",
        "oportunidades.read",
        "oportunidades.create",
        "oportunidades.update",
        "proceso_comercial_config.read",
        "proceso_comercial_config.update",
      ],
    });
    ctx.commercialDevelopmentReadOnlyRoleId = await createRole({
      name: `${TEST_PREFIX}_commercial_development_readonly`,
      permissionCodes: [
        "desarrollo_comercial.read",
        "oportunidades.read",
        "oportunidades.create",
        "oportunidades.update",
      ],
    });
    ctx.opportunityReadOnlyRoleId = await createRole({
      name: `${TEST_PREFIX}_opportunity_readonly`,
      permissionCodes: ["oportunidades.read"],
    });
    ctx.processCommercialConfigReadRoleId = await createRole({
      name: `${TEST_PREFIX}_process_commercial_config_read`,
      permissionCodes: ["proceso_comercial_config.read"],
    });
    ctx.opportunityGlobalScopeRoleId = await createRole({
      name: `${TEST_PREFIX}_opps_global_scope`,
      permissionCodes: [
        "desarrollo_comercial.read",
        "desarrollo_comercial.update",
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
    ctx.configurationManagerRoleId = await createRole({
      name: `${TEST_PREFIX}_configuration_manager`,
      permissionCodes: ["configuracion.read", "configuracion.update"],
    });
    ctx.dynamicPermissionRoleId = await createRole({
      name: `${TEST_PREFIX}_dynamic_permissions`,
      permissionCodes: ["contactos.request"],
    });
    ctx.interactionsManagerRoleId = await createRole({
      name: `${TEST_PREFIX}_interactions_manager`,
      permissionCodes: [
        "interacciones.read",
        "interacciones.create",
        "interacciones.update",
        "interacciones.analyze",
        "interacciones.resolve",
        "interacciones.resolve.assign_any",
        "cuentas.create",
        "contactos.create",
        "oportunidades.create",
      ],
    });
    ctx.interactionsSelfAssignRoleId = await createRole({
      name: `${TEST_PREFIX}_interactions_self_assign`,
      permissionCodes: [
        "interacciones.read",
        "interacciones.create",
        "interacciones.update",
        "interacciones.analyze",
        "interacciones.resolve",
        "interacciones.resolve.assign_self",
        "cuentas.create",
        "contactos.create",
        "oportunidades.create",
      ],
    });
    ctx.userCrudRoleId = await createRole({
      name: `${TEST_PREFIX}_users_crud`,
      permissionCodes: ["usuarios.create", "usuarios.update"],
    });
    ctx.auditReaderRoleId = await createRole({
      name: `${TEST_PREFIX}_audit_reader`,
      permissionCodes: ["audit.read"],
    });
    ctx.commercialPlanningManagerRoleId = await createRole({
      name: `${TEST_PREFIX}_commercial_planning_manager`,
      permissionCodes: [
        "planeacion_comercial.read",
        "planeacion_comercial.create",
        "planeacion_comercial.update",
        "planeacion_comercial.publish",
        "planeacion_comercial.close",
        "planeacion_comercial.audit.read",
        "planeacion_comercial.override_validation",
      ],
    });
    ctx.manufacturerRegistrationManagerRoleId = await createRole({
      name: `${TEST_PREFIX}_manufacturer_registration_manager`,
      permissionCodes: [
        "registros_fabricantes.read",
        "registros_fabricantes.update",
        "registros_fabricantes.request",
        "registros_fabricantes.manage",
        "registros_fabricantes.read_all",
      ],
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
      ctx.configurationManagerRoleId,
      ctx.dynamicPermissionRoleId,
      ctx.interactionsManagerRoleId,
      ctx.interactionsSelfAssignRoleId,
      ctx.userCrudRoleId,
      ctx.auditReaderRoleId,
      ctx.commercialPlanningManagerRoleId,
      ctx.manufacturerRegistrationManagerRoleId,
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
      roleIds: [
        ctx.opportunityFlowRoleId,
        ctx.manufacturerRegistrationManagerRoleId,
      ],
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
    ctx.configurationManagerUserId = await createUser({
      fullName: "API Configuration Manager",
      email: `${TEST_PREFIX}.configuration.manager@example.com`,
      roleIds: [ctx.configurationManagerRoleId],
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
    ctx.interactionsManagerUserId = await createUser({
      fullName: "API Interactions Manager",
      email: `${TEST_PREFIX}.interactions.manager@example.com`,
      roleIds: [ctx.interactionsManagerRoleId],
    });
    ctx.interactionsSelfAssignUserId = await createUser({
      fullName: "API Interactions Seller Self",
      email: `${TEST_PREFIX}.interactions.self@example.com`,
      roleIds: [ctx.sellerRoleId, ctx.interactionsSelfAssignRoleId],
    });
    ctx.userCrudUserId = await createUser({
      fullName: "API User CRUD",
      email: `${TEST_PREFIX}.users.crud@example.com`,
      roleIds: [ctx.userCrudRoleId],
    });
    ctx.auditReaderUserId = await createUser({
      fullName: "API Audit Reader",
      email: `${TEST_PREFIX}.audit.reader@example.com`,
      roleIds: [ctx.auditReaderRoleId],
    });
    ctx.commercialPlanningManagerUserId = await createUser({
      fullName: "API Commercial Planning Manager",
      email: `${TEST_PREFIX}.commercial.planning@example.com`,
      roleIds: [ctx.commercialPlanningManagerRoleId],
    });
    ctx.sellerAltUserId = await createUser({
      fullName: "API Seller Alt Planning",
      email: `${TEST_PREFIX}.seller.alt.planning@example.com`,
      roleIds: [ctx.sellerRoleId],
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
      ctx.configurationManagerUserId,
      ctx.quotationOperationUserId,
      ctx.quotationRevisionUserId,
      ctx.quotationIngresoUserId,
      ctx.quotationAdminUserId,
      ctx.quotationExternalUserId,
      ctx.dynamicPermissionUserId,
      ctx.interactionsManagerUserId,
      ctx.interactionsSelfAssignUserId,
      ctx.userCrudUserId,
      ctx.auditReaderUserId,
      ctx.commercialPlanningManagerUserId,
      ctx.sellerAltUserId,
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
      contactEmail: `fixture.${suffix}@example.com`,
      contactPhone: `555${suffix.slice(-6)}`,
      alternateContactId,
      alternateContactEmail: `fixture.${suffix}_alt@example.com`,
      alternateContactPhone: `555${`${suffix}_alt`.slice(-6)}`,
      opportunityId,
      sellerUserId: ctx.sellerUserId,
      sellerUserName: "API Seller Fixture",
      sellerUserEmail: `${TEST_PREFIX}.seller@example.com`,
      sellerUserPhone: "",
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

  function binaryParser(res, callback) {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => callback(null, Buffer.concat(chunks)));
    res.on("error", callback);
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

  async function forceInvalidJobRequester(tableName, publicId) {
    const allowedTableNames = new Set([
      "interaction_analysis_jobs",
      "commercial_opportunity_narrative_jobs",
    ]);
    if (!allowedTableNames.has(tableName)) {
      throw new Error(`Unsupported job table: ${tableName}`);
    }

    const connection = await pool.getConnection();
    try {
      await connection.query("SET FOREIGN_KEY_CHECKS = 0");
      await connection.query(
        `UPDATE ${tableName}
         SET requested_by_user_id = 999999999
         WHERE public_id = ?`,
        [publicId],
      );
    } finally {
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      connection.release();
    }
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
      `SELECT id, action, entity_id, detail, changed_fields
       FROM audit_log
       WHERE entity_type = 'opportunity'
         AND entity_id = ?
         AND action = ?
       ORDER BY id`,
      [opportunityId, action],
    );
  }

  async function attachOpportunityDocumentForTest({
    opportunityId,
    uploadedByUserId,
    suffix,
    text,
  }) {
    await ensureOpportunityDocumentSchema();
    const normalizedSuffix = String(suffix || "fixture")
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase()
      .slice(0, 32);
    const publicId = `doc_stage_${normalizedSuffix}_${Date.now()}`.slice(0, 60);
    const sha256 = normalizedSuffix.padEnd(64, "a").slice(0, 64);
    const now = new Date();
    const insert = await query(
      `INSERT INTO documents
         (public_id, upload_session_id, entity_type, entity_id, storage_provider,
          storage_bucket, storage_key, original_file_name, stored_file_name,
          mime_type, file_extension, byte_size, sha256, document_kind, source_label,
          processing_status, processing_error, duration_seconds, is_deleted,
          uploaded_by_user_id, created_at, updated_at)
       VALUES (?, NULL, 'opportunity', ?, 'local_fs', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'review_ready', NULL, NULL, 0, ?, ?, ?)`,
      [
        publicId,
        opportunityId,
        `local_fs/opportunity/${normalizedSuffix}.txt`,
        `${normalizedSuffix}.txt`,
        `${normalizedSuffix}.txt`,
        "text/plain",
        ".txt",
        Buffer.byteLength(String(text || ""), "utf8"),
        sha256,
        "txt",
        "fixture_stage_answers",
        uploadedByUserId,
        now,
        now,
      ],
    );
    const documentId = Number(insert.insertId);

    await query(
      `INSERT INTO document_contents
         (document_id, extraction_status, transcription_status, detected_format,
          raw_text, normalized_text, transcript_text, content_summary,
          extracted_at, created_at, updated_at)
       VALUES (?, 'completed', 'pending', 'txt', ?, ?, '', ?, ?, ?, ?)`,
      [
        documentId,
        String(text || ""),
        String(text || ""),
        String(text || "").slice(0, 300),
        now,
        now,
        now,
      ],
    );

    await query(
      `INSERT INTO opportunity_document_links
         (opportunity_id, document_id, link_type, created_by_user_id, created_at)
       VALUES (?, ?, 'source_document', ?, ?)`,
      [opportunityId, documentId, uploadedByUserId, now],
    );

    return { documentId, publicId };
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

  test("configuracion permite consultar y actualizar el perfil institucional", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.configuration.manager@example.com`,
    );

    const token = loginResponse.body.token;
    const currentProfileResponse = await request(app)
      .get("/api/settings/company-profile")
      .set("Authorization", `Bearer ${token}`);

    expect(currentProfileResponse.status).toBe(200);
    const originalProfile = currentProfileResponse.body.profile;

    const payload = {
      legalName: originalProfile.legalName,
      commercialName: `Marca ${TEST_PREFIX}`,
      taxId: originalProfile.taxId,
      logoUrl: originalProfile.logoUrl || undefined,
      addressLine1: originalProfile.addressLine1,
      addressLine2: originalProfile.addressLine2 || "",
      city: originalProfile.city,
      stateRegion: originalProfile.stateRegion,
      countryId: Number(originalProfile.countryId),
      postalCode: originalProfile.postalCode,
      email: originalProfile.email || "configuracion@example.com",
      phone: "+52 55 5555 0101",
      website: originalProfile.website || "",
      description: "Actualizacion de prueba de configuracion",
    };

    const updateResponse = await request(app)
      .put("/api/settings/company-profile")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.profile.commercialName).toBe(
      payload.commercialName,
    );
    expect(updateResponse.body.profile.phone).toBe(payload.phone);

    const brandingResponse = await request(app)
      .get("/api/settings/document-branding")
      .set("Authorization", `Bearer ${token}`);

    expect(brandingResponse.status).toBe(200);
    expect(brandingResponse.body.company.legalName).toBe(payload.legalName);
    expect(brandingResponse.body.company.phone).toBe(payload.phone);

    const auditResponse = await request(app)
      .get("/api/settings/audit?limit=5")
      .set("Authorization", `Bearer ${token}`);

    expect(auditResponse.status).toBe(200);
    expect(
      auditResponse.body.some(
        (entry) => entry.action === "updated_company_profile",
      ),
    ).toBe(true);

    await query(
      `UPDATE company_profile
       SET legal_name = ?, commercial_name = ?, tax_id = ?, logo_url = ?,
           address_line1 = ?, address_line2 = ?, city = ?, state_region = ?,
           country_id = ?, postal_code = ?, email = ?, phone = ?, website = ?,
           description = ?, updated_at = NOW(3)
       WHERE singleton_key = 'default'`,
      [
        originalProfile.legalName,
        originalProfile.commercialName || null,
        originalProfile.taxId,
        originalProfile.logoUrl || null,
        originalProfile.addressLine1,
        originalProfile.addressLine2 || null,
        originalProfile.city,
        originalProfile.stateRegion,
        Number(originalProfile.countryId),
        originalProfile.postalCode,
        originalProfile.email || null,
        originalProfile.phone || null,
        originalProfile.website || null,
        originalProfile.description || null,
      ],
    );
  });

  test("configuracion.ai-parameters permite guardar borrador, publicar y restaurar resumen ejecutivo", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.configuration.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const currentConfigResponse = await request(app)
      .get("/api/settings/ai-parameters")
      .set("Authorization", `Bearer ${token}`);

    expect(currentConfigResponse.status).toBe(200);
    const originalEntry = currentConfigResponse.body.config.entries.find(
      (entry) => entry.capabilityKey === "proposal.executive_summary",
    );
    expect(originalEntry).toBeTruthy();

    const updatedPayload = {
      title: originalEntry.title,
      description: `${originalEntry.description} Ajuste de prueba.`,
      isEnabled: true,
      modelOverride: "gpt-5.4-mini",
      timeoutMs: 65000,
      systemPrompt: `${originalEntry.systemPrompt} Mantén un tono consultivo y conserva JSON valido.`,
      userPromptTemplate:
        "Instrucciones publicadas\n{{context}}\nShape\n{{expectedShape}}",
      outputSchema: originalEntry.outputSchema,
      parameters: {
        ...originalEntry.parameters,
        maxLibraryAssets: 3,
      },
      changeSummary: "Ajuste de prueba de resumen ejecutivo",
    };

    try {
      const validateResponse = await request(app)
        .post(
          "/api/settings/ai-parameters/entries/proposal.executive_summary/validate",
        )
        .set("Authorization", `Bearer ${token}`)
        .send(updatedPayload);

      expect(validateResponse.status).toBe(200);
      expect(validateResponse.body.valid).toBe(true);

      const saveResponse = await request(app)
        .put("/api/settings/ai-parameters/entries/proposal.executive_summary")
        .set("Authorization", `Bearer ${token}`)
        .send(updatedPayload);

      expect(saveResponse.status).toBe(200);
      expect(saveResponse.body.config.status).toBe("draft");
      expect(saveResponse.body.entry.systemPrompt).toContain("tono consultivo");
      expect(saveResponse.body.entry.published.systemPrompt).toBe(
        originalEntry.published.systemPrompt,
      );

      const revisionsResponse = await request(app)
        .get(
          "/api/settings/ai-parameters/entries/proposal.executive_summary/revisions",
        )
        .set("Authorization", `Bearer ${token}`);

      expect(revisionsResponse.status).toBe(200);
      expect(revisionsResponse.body.revisions[0]).toEqual(
        expect.objectContaining({
          changeSummary: "Ajuste de prueba de resumen ejecutivo",
          isPublished: false,
        }),
      );

      const publishResponse = await request(app)
        .post("/api/settings/ai-parameters/publish")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(publishResponse.status).toBe(200);
      expect(publishResponse.body.config.status).toBe("published");
      expect(
        publishResponse.body.entry ||
          publishResponse.body.config.entries.find(
            (entry) => entry.capabilityKey === "proposal.executive_summary",
          ),
      ).toBeTruthy();

      const restoreResponse = await request(app)
        .post(
          `/api/settings/ai-parameters/entries/proposal.executive_summary/restore/${originalEntry.publishedRevisionNumber}`,
        )
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(restoreResponse.status).toBe(200);
      expect(restoreResponse.body.config.status).toBe("draft");
      expect(restoreResponse.body.entry.systemPrompt).toBe(
        originalEntry.published.systemPrompt,
      );

      const republishResponse = await request(app)
        .post("/api/settings/ai-parameters/publish")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(republishResponse.status).toBe(200);
      const restoredEntry = republishResponse.body.config.entries.find(
        (entry) => entry.capabilityKey === "proposal.executive_summary",
      );
      expect(restoredEntry.systemPrompt).toBe(
        originalEntry.published.systemPrompt,
      );
    } finally {
      await request(app)
        .put("/api/settings/ai-parameters/entries/proposal.executive_summary")
        .set("Authorization", `Bearer ${token}`)
        .send({
          title: originalEntry.title,
          description: originalEntry.description,
          isEnabled: originalEntry.isEnabled,
          modelOverride: originalEntry.modelOverride,
          timeoutMs: originalEntry.timeoutMs,
          systemPrompt: originalEntry.systemPrompt,
          userPromptTemplate: originalEntry.userPromptTemplate,
          outputSchema: originalEntry.outputSchema,
          parameters: originalEntry.parameters,
          changeSummary: "Restauracion automatica de prueba",
        });
      await request(app)
        .post("/api/settings/ai-parameters/publish")
        .set("Authorization", `Bearer ${token}`)
        .send({});
    }
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
        name: `Nebula Create ${TEST_PREFIX}`,
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

  test("cuentas.request ya no autoriza crear cuentas", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.request@example.com`,
    );

    const createResponse = await request(app)
      .post("/api/accounts")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Harbor Request ${TEST_PREFIX}`,
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

    expect(createResponse.status).toBe(403);
    expect(createResponse.body.message).toBe("No autorizado");
  });

  test("cuentas.create permite multiples cuentas sin registro en el mismo pais", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.create@example.com`,
    );

    const firstResponse = await request(app)
      .post("/api/accounts")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Atlas Norte ${TEST_PREFIX}`,
        accountTypeId: ctx.catalogIds.accountTypeId,
        registrationCode: "",
        phone: "5550003333",
        economicSectorId: ctx.catalogIds.economicSectorId,
        website: "https://blank-a.example.com",
        city: "CDMX",
        stateRegion: "CDMX",
        countryId: ctx.catalogIds.countryMxId,
        description: "Cuenta sin registro A",
        addressLine: "Direccion prueba A",
        postalCode: "01002",
        activationStatusId: ctx.catalogIds.accountActiveStatusId,
        ownerUserIds: [ctx.accountCreateUserId],
      });

    expect(firstResponse.status).toBe(201);
    cleanup.accountIds.push(Number(firstResponse.body.id));

    const secondResponse = await request(app)
      .post("/api/accounts")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Laguna Verde ${TEST_PREFIX}`,
        registrationCode: "   ",
        accountTypeId: ctx.catalogIds.accountTypeId,
        phone: "5550004444",
        economicSectorId: ctx.catalogIds.economicSectorId,
        website: "https://blank-b.example.com",
        city: "CDMX",
        stateRegion: "CDMX",
        countryId: ctx.catalogIds.countryMxId,
        description: "Cuenta sin registro B",
        addressLine: "Direccion prueba B",
        postalCode: "01003",
        activationStatusId: ctx.catalogIds.accountActiveStatusId,
        ownerUserIds: [ctx.accountCreateUserId],
      });

    expect(secondResponse.status).toBe(201);
    cleanup.accountIds.push(Number(secondResponse.body.id));

    const accountRows = await query(
      `SELECT id, registration_code
       FROM accounts
       WHERE id IN (?, ?)
       ORDER BY id ASC`,
      [firstResponse.body.id, secondResponse.body.id],
    );

    expect(accountRows).toHaveLength(2);
    expect(accountRows[0]?.registration_code ?? null).toBeNull();
    expect(accountRows[1]?.registration_code ?? null).toBeNull();
  });

  test("cuentas.create exige revision cuando detecta un duplicado fuerte", async () => {
    const duplicateAccountId = await createDirectAccount({
      ownerUserId: ctx.accountCreateUserId,
      actorUserId: ctx.accountCreateUserId,
      suffix: `${TEST_PREFIX}_duplicate_review`,
    });
    cleanup.accountIds.push(duplicateAccountId);

    await query(
      `UPDATE accounts
       SET name = ?, website = ?, country_id = ?
       WHERE id = ?`,
      [
        `Cuenta Duplicada ${TEST_PREFIX}`,
        "https://duplicate-review.example.com",
        ctx.catalogIds.countryMxId,
        duplicateAccountId,
      ],
    );

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.create@example.com`,
    );

    const response = await request(app)
      .post("/api/accounts")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Cuenta Duplicada ${TEST_PREFIX}`,
        accountTypeId: ctx.catalogIds.accountTypeId,
        registrationCode: "",
        phone: "5550005555",
        economicSectorId: ctx.catalogIds.economicSectorId,
        website: "https://otra.example.com",
        city: "CDMX",
        stateRegion: "CDMX",
        countryId: ctx.catalogIds.countryMxId,
        description: "Intento con coincidencia fuerte",
        addressLine: "Direccion prueba review",
        postalCode: "01004",
        activationStatusId: ctx.catalogIds.accountActiveStatusId,
        ownerUserIds: [ctx.accountCreateUserId],
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ACCOUNT_DUPLICATE_REVIEW_REQUIRED");
    expect(response.body.duplicateDecision).toBe("review_required");
    expect(response.body.duplicateWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: duplicateAccountId,
          severity: "high",
          matchReason: "normalized_name_same_country",
        }),
      ]),
    );

    const overrideResponse = await request(app)
      .post("/api/accounts")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Cuenta Duplicada ${TEST_PREFIX}`,
        accountTypeId: ctx.catalogIds.accountTypeId,
        registrationCode: "",
        phone: "5550005556",
        economicSectorId: ctx.catalogIds.economicSectorId,
        website: "https://otra.example.com",
        city: "CDMX",
        stateRegion: "CDMX",
        countryId: ctx.catalogIds.countryMxId,
        description: "Intento forzado con coincidencia fuerte",
        addressLine: "Direccion prueba review override",
        postalCode: "01005",
        activationStatusId: ctx.catalogIds.accountActiveStatusId,
        ownerUserIds: [ctx.accountCreateUserId],
        allowDuplicateOverride: true,
      });

    expect(overrideResponse.status).toBe(201);
    cleanup.accountIds.push(Number(overrideResponse.body.id));
  });

  test("cuentas.create pide confirmacion cuando detecta un duplicado probable", async () => {
    const duplicateAccountId = await createDirectAccount({
      ownerUserId: ctx.accountCreateUserId,
      actorUserId: ctx.accountCreateUserId,
      suffix: `${TEST_PREFIX}_duplicate_confirmation`,
    });
    cleanup.accountIds.push(duplicateAccountId);

    await query(
      `UPDATE accounts
       SET name = ?, country_id = ?, website = NULL
       WHERE id = ?`,
      [
        `Tecnologias Unificadas ${TEST_PREFIX}`,
        ctx.catalogIds.countryMxId,
        duplicateAccountId,
      ],
    );

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.create@example.com`,
    );

    const response = await request(app)
      .post("/api/accounts")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Tecnologia Unificada ${TEST_PREFIX}`,
        accountTypeId: ctx.catalogIds.accountTypeId,
        registrationCode: "",
        phone: "5550006666",
        economicSectorId: ctx.catalogIds.economicSectorId,
        website: "",
        city: "CDMX",
        stateRegion: "CDMX",
        countryId: ctx.catalogIds.countryMxId,
        description: "Intento con coincidencia probable",
        addressLine: "Direccion prueba confirm",
        postalCode: "01006",
        activationStatusId: ctx.catalogIds.accountActiveStatusId,
        ownerUserIds: [ctx.accountCreateUserId],
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ACCOUNT_DUPLICATE_CONFIRMATION_REQUIRED");
    expect(response.body.duplicateDecision).toBe("confirmation_required");
    expect(response.body.duplicateWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: duplicateAccountId,
          severity: "medium",
          matchReason: "similar_name_same_country",
        }),
      ]),
    );
  });

  test("cuentas.create pide confirmacion para nombres casi identicos", async () => {
    const duplicateAccountId = await createDirectAccount({
      ownerUserId: ctx.accountCreateUserId,
      actorUserId: ctx.accountCreateUserId,
      suffix: `${TEST_PREFIX}_duplicate_near_exact`,
    });
    cleanup.accountIds.push(duplicateAccountId);

    await query(
      `UPDATE accounts
       SET name = ?, country_id = ?, website = NULL
       WHERE id = ?`,
      ["Ferromex", ctx.catalogIds.countryMxId, duplicateAccountId],
    );

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.create@example.com`,
    );

    const response = await request(app)
      .post("/api/accounts")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: "Ferromen",
        accountTypeId: ctx.catalogIds.accountTypeId,
        registrationCode: "",
        phone: "5550006767",
        economicSectorId: ctx.catalogIds.economicSectorId,
        website: "",
        city: "CDMX",
        stateRegion: "CDMX",
        countryId: ctx.catalogIds.countryMxId,
        description: "Intento con nombre casi identico",
        addressLine: "Direccion prueba near exact",
        postalCode: "01007",
        activationStatusId: ctx.catalogIds.accountActiveStatusId,
        ownerUserIds: [ctx.accountCreateUserId],
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ACCOUNT_DUPLICATE_CONFIRMATION_REQUIRED");
    expect(response.body.duplicateDecision).toBe("confirmation_required");
    expect(response.body.duplicateWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: duplicateAccountId,
          severity: "medium",
          matchReason: "near_exact_name_same_country",
        }),
      ]),
    );
  });

  test("cuentas.create usa la revision IA para bloquear un nombre variante aunque la heuristica no lo marque", async () => {
    const duplicateAccountId = await createDirectAccount({
      ownerUserId: ctx.accountCreateUserId,
      actorUserId: ctx.accountCreateUserId,
      suffix: `${TEST_PREFIX}_duplicate_ai_review`,
    });
    cleanup.accountIds.push(duplicateAccountId);

    await query(
      `UPDATE accounts
       SET name = ?, country_id = ?, website = NULL
       WHERE id = ?`,
      ["Ferromex", ctx.catalogIds.countryMxId, duplicateAccountId],
    );

    const originalApiKey = config.openai.apiKey;
    const originalEnableWebSearch = config.openai.enableWebSearch;
    const originalFetch = global.fetch;

    config.openai.apiKey = "test-key";
    config.openai.enableWebSearch = true;
    global.fetch = vi.fn(async (url, init) => {
      expect(String(url)).toContain("/responses");
      const payload = JSON.parse(init.body);
      const rawInput = JSON.parse(payload.input[1].content);

      expect(rawInput.context.duplicateWarnings).toEqual([]);
      expect(rawInput.context.duplicateCandidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            accountName: "Ferromex",
            nameSignals: expect.objectContaining({
              normalizedName: "ferromex",
              coreName: "ferromex",
            }),
          }),
        ]),
      );

      return {
        ok: true,
        json: async () => ({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    suggestedCompanyDescription: "",
                    suggestedWebsite: "",
                    websiteConfidence: "low",
                    websiteReason: "",
                    suggestedContactData: {
                      addressLine: "",
                      city: "",
                      stateRegion: "",
                      postalCode: "",
                      phone: "",
                      confidence: "low",
                      reason: "",
                    },
                    suggestedRegistrationCode: "",
                    registrationConfidence: "low",
                    registrationReason: "",
                    suggestedImprovements: [],
                    nextRecommendedStep: {
                      action: "",
                      reason: "",
                    },
                    duplicateReview: {
                      verdict: "likely_duplicate",
                      summary:
                        "Feromix parece ser una variante comercial del mismo nombre base Ferromex.",
                      recommendation:
                        "Deten la creacion y revisa primero la cuenta existente Ferromex.",
                      confidence: "high",
                    },
                    confidence: "high",
                    warnings: [],
                  }),
                },
              ],
            },
          ],
        }),
      };
    });

    try {
      const loginResponse = await login(
        request(app),
        `${TEST_PREFIX}.accounts.create@example.com`,
      );

      const response = await request(app)
        .post("/api/accounts")
        .set("Authorization", `Bearer ${loginResponse.body.token}`)
        .send({
          name: "Feromix",
          accountTypeId: ctx.catalogIds.accountTypeId,
          registrationCode: "",
          phone: "5550006868",
          economicSectorId: ctx.catalogIds.economicSectorId,
          website: "",
          city: "CDMX",
          stateRegion: "CDMX",
          countryId: ctx.catalogIds.countryMxId,
          description: "Intento con variante detectada por IA",
          addressLine: "Direccion prueba ai duplicate review",
          postalCode: "01008",
          activationStatusId: ctx.catalogIds.accountActiveStatusId,
          ownerUserIds: [ctx.accountCreateUserId],
        });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe("ACCOUNT_DUPLICATE_REVIEW_REQUIRED");
      expect(response.body.duplicateDecision).toBe("review_required");
      expect(response.body.duplicateValidationSource).toBe("ai");
      expect(response.body.duplicateReview).toEqual(
        expect.objectContaining({
          verdict: "likely_duplicate",
          confidence: "high",
        }),
      );
      expect(response.body.duplicateWarnings).toEqual([]);
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
      config.openai.enableWebSearch = originalEnableWebSearch;
    }
  });

  test("cuentas.create pide confirmacion manual para partial_name_match si la revision IA no esta disponible", async () => {
    const duplicateAccountId = await createDirectAccount({
      ownerUserId: ctx.accountCreateUserId,
      actorUserId: ctx.accountCreateUserId,
      suffix: `${TEST_PREFIX}_duplicate_partial_fallback`,
    });
    cleanup.accountIds.push(duplicateAccountId);

    await query(
      `UPDATE accounts
       SET name = ?, country_id = ?, website = NULL
       WHERE id = ?`,
      ["Hospital Angeles", ctx.catalogIds.countryMxId, duplicateAccountId],
    );

    const originalEnableWebSearch = config.openai.enableWebSearch;
    config.openai.enableWebSearch = false;

    try {
      const loginResponse = await login(
        request(app),
        `${TEST_PREFIX}.accounts.create@example.com`,
      );

      const response = await request(app)
        .post("/api/accounts")
        .set("Authorization", `Bearer ${loginResponse.body.token}`)
        .send({
          name: "Hospital Los Angeles",
          accountTypeId: ctx.catalogIds.accountTypeId,
          registrationCode: "",
          phone: "5550006969",
          economicSectorId: ctx.catalogIds.economicSectorId,
          website: "",
          city: "CDMX",
          stateRegion: "CDMX",
          countryId: ctx.catalogIds.countryMxId,
          description: "Intento con variante nominal y fallback IA",
          addressLine: "Direccion prueba partial fallback",
          postalCode: "01009",
          activationStatusId: ctx.catalogIds.accountActiveStatusId,
          ownerUserIds: [ctx.accountCreateUserId],
        });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe(
        "ACCOUNT_DUPLICATE_CONFIRMATION_REQUIRED",
      );
      expect(response.body.duplicateDecision).toBe("confirmation_required");
      expect(response.body.duplicateValidationSource).toBe("heuristic");
      expect(response.body.duplicateWarnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            accountId: duplicateAccountId,
            matchReason: "partial_name_match",
            severity: "low",
          }),
        ]),
      );
    } finally {
      config.openai.enableWebSearch = originalEnableWebSearch;
    }
  });

  test("cuentas.create envia a la IA el nombre base sin articulos para variantes en espanol", async () => {
    const duplicateAccountId = await createDirectAccount({
      ownerUserId: ctx.accountCreateUserId,
      actorUserId: ctx.accountCreateUserId,
      suffix: `${TEST_PREFIX}_duplicate_spanish_particles`,
    });
    cleanup.accountIds.push(duplicateAccountId);

    await query(
      `UPDATE accounts
       SET name = ?, country_id = ?, website = NULL
       WHERE id = ?`,
      ["Hospital Angeles", ctx.catalogIds.countryMxId, duplicateAccountId],
    );

    const originalApiKey = config.openai.apiKey;
    const originalEnableWebSearch = config.openai.enableWebSearch;
    const originalFetch = global.fetch;

    config.openai.apiKey = "test-key";
    config.openai.enableWebSearch = true;
    global.fetch = vi.fn(async (_url, init) => {
      const payload = JSON.parse(init.body);
      const rawInput = JSON.parse(payload.input[1].content);

      expect(rawInput.context.draftNameSignals).toEqual(
        expect.objectContaining({
          normalizedName: "hospital los angeles",
          coreName: "hospital angeles",
          significantTokens: ["hospital", "angeles"],
        }),
      );
      expect(rawInput.context.duplicateCandidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            accountName: "Hospital Angeles",
            nameSignals: expect.objectContaining({
              normalizedName: "hospital angeles",
              coreName: "hospital angeles",
              significantTokens: ["hospital", "angeles"],
            }),
          }),
        ]),
      );

      return {
        ok: true,
        json: async () => ({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    suggestedCompanyDescription: "",
                    suggestedWebsite: "",
                    websiteConfidence: "low",
                    websiteReason: "",
                    suggestedContactData: {
                      addressLine: "",
                      city: "",
                      stateRegion: "",
                      postalCode: "",
                      phone: "",
                      confidence: "low",
                      reason: "",
                    },
                    suggestedRegistrationCode: "",
                    registrationConfidence: "low",
                    registrationReason: "",
                    suggestedImprovements: [],
                    nextRecommendedStep: {
                      action: "",
                      reason: "",
                    },
                    duplicateReview: {
                      verdict: "inconclusive",
                      summary:
                        "El nombre base coincide y requiere revision manual adicional.",
                      recommendation:
                        "Confirma si corresponde a la misma organizacion antes de crear otra cuenta.",
                      confidence: "medium",
                    },
                    confidence: "medium",
                    warnings: [],
                  }),
                },
              ],
            },
          ],
        }),
      };
    });

    try {
      const loginResponse = await login(
        request(app),
        `${TEST_PREFIX}.accounts.create@example.com`,
      );

      const response = await request(app)
        .post("/api/accounts")
        .set("Authorization", `Bearer ${loginResponse.body.token}`)
        .send({
          name: "Hospital Los Angeles",
          accountTypeId: ctx.catalogIds.accountTypeId,
          registrationCode: "",
          phone: "5550006970",
          economicSectorId: ctx.catalogIds.economicSectorId,
          website: "",
          city: "CDMX",
          stateRegion: "CDMX",
          countryId: ctx.catalogIds.countryMxId,
          description: "Intento con articulos en espanol y revision IA",
          addressLine: "Direccion prueba spanish particles",
          postalCode: "01010",
          activationStatusId: ctx.catalogIds.accountActiveStatusId,
          ownerUserIds: [ctx.accountCreateUserId],
        });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe(
        "ACCOUNT_DUPLICATE_CONFIRMATION_REQUIRED",
      );
      expect(response.body.duplicateDecision).toBe("confirmation_required");
      expect(response.body.duplicateValidationSource).toBe("ai");
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
      config.openai.enableWebSearch = originalEnableWebSearch;
    }
  });

  test("cuentas.create no deja en clear una variante con particulas en espanol aunque la IA diga likely_distinct", async () => {
    const duplicateAccountId = await createDirectAccount({
      ownerUserId: ctx.accountCreateUserId,
      actorUserId: ctx.accountCreateUserId,
      suffix: `${TEST_PREFIX}_duplicate_spanish_particles_distinct`,
    });
    cleanup.accountIds.push(duplicateAccountId);

    await query(
      `UPDATE accounts
       SET name = ?, country_id = ?, website = NULL
       WHERE id = ?`,
      ["Medica Sur", ctx.catalogIds.countryMxId, duplicateAccountId],
    );

    const originalApiKey = config.openai.apiKey;
    const originalEnableWebSearch = config.openai.enableWebSearch;
    const originalFetch = global.fetch;

    config.openai.apiKey = "test-key";
    config.openai.enableWebSearch = true;
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  suggestedCompanyDescription: "",
                  suggestedWebsite: "",
                  websiteConfidence: "low",
                  websiteReason: "",
                  suggestedContactData: {
                    addressLine: "",
                    city: "",
                    stateRegion: "",
                    postalCode: "",
                    phone: "",
                    confidence: "low",
                    reason: "",
                  },
                  suggestedRegistrationCode: "",
                  registrationConfidence: "low",
                  registrationReason: "",
                  suggestedImprovements: [],
                  nextRecommendedStep: {
                    action: "",
                    reason: "",
                  },
                  duplicateReview: {
                    verdict: "likely_distinct",
                    summary:
                      "La IA no encontro evidencia suficiente para afirmar que es la misma organizacion.",
                    recommendation:
                      "Permite continuar si el equipo confirma que se trata de entidades distintas.",
                    confidence: "medium",
                  },
                  confidence: "medium",
                  warnings: [],
                }),
              },
            ],
          },
        ],
      }),
    }));

    try {
      const loginResponse = await login(
        request(app),
        `${TEST_PREFIX}.accounts.create@example.com`,
      );

      const response = await request(app)
        .post("/api/accounts")
        .set("Authorization", `Bearer ${loginResponse.body.token}`)
        .send({
          name: "Medica del Sur",
          accountTypeId: ctx.catalogIds.accountTypeId,
          registrationCode: "",
          phone: "5550006971",
          economicSectorId: ctx.catalogIds.economicSectorId,
          website: "",
          city: "CDMX",
          stateRegion: "CDMX",
          countryId: ctx.catalogIds.countryMxId,
          description:
            "Intento con particulas en espanol y veredicto likely_distinct de IA",
          addressLine: "Direccion prueba medica del sur",
          postalCode: "01011",
          activationStatusId: ctx.catalogIds.accountActiveStatusId,
          ownerUserIds: [ctx.accountCreateUserId],
        });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe(
        "ACCOUNT_DUPLICATE_CONFIRMATION_REQUIRED",
      );
      expect(response.body.duplicateDecision).toBe("confirmation_required");
      expect(response.body.duplicateValidationSource).toBe("ai");
      expect(response.body.duplicateReview).toEqual(
        expect.objectContaining({
          verdict: "likely_distinct",
        }),
      );
      expect(response.body.duplicateWarnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            accountId: duplicateAccountId,
            matchReason: "partial_name_match",
            severity: "low",
          }),
        ]),
      );
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
      config.openai.enableWebSearch = originalEnableWebSearch;
    }
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

  test("cuentas draft-analysis devuelve hallazgos y duplicados potenciales", async () => {
    const fixtureAccountId = await createDirectAccount({
      ownerUserId: ctx.accountCreateUserId,
      actorUserId: ctx.accountCreateUserId,
      suffix: `${TEST_PREFIX}-draft-analysis`,
    });
    cleanup.accountIds.push(fixtureAccountId);

    await query(
      `UPDATE accounts
       SET name = ?, registration_code = ?, website = ?, country_id = ?
       WHERE id = ?`,
      [
        `Cuenta IA ${TEST_PREFIX}`,
        `DRAFT-${TEST_PREFIX}`,
        `https://draft-${TEST_PREFIX}.example.com`,
        ctx.catalogIds.countryMxId,
        fixtureAccountId,
      ],
    );

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.create@example.com`,
    );

    const response = await request(app)
      .post("/api/accounts/draft-analysis")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        draft: {
          name: `Cuenta IA ${TEST_PREFIX}`,
          accountTypeId: ctx.catalogIds.accountTypeId,
          registrationCode: "",
          phone: "",
          economicSectorId: ctx.catalogIds.economicSectorId,
          website: "",
          city: "CDMX",
          stateRegion: "CDMX",
          countryId: ctx.catalogIds.countryMxId,
          companyDescription: "",
          addressLine: "",
          postalCode: "",
          ownerUserIds: [],
        },
        options: {
          allowExternalFetch: false,
          allowAiSynthesis: false,
          allowWebSearchTool: false,
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.overallAssessment.status).toBe("needs_review");
    expect(response.body.duplicateWarnings.length).toBeGreaterThan(0);
    expect(response.body.duplicateWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "high",
          matchReason: "normalized_name_same_country",
          accountId: fixtureAccountId,
        }),
      ]),
    );
    expect(response.body.suggestedWebsite).toMatchObject({
      value: `https://draft-${TEST_PREFIX}.example.com`,
      confidence: "high",
      canAutoApply: true,
    });
    expect(response.body.registrationAssistance).toMatchObject({
      status: "missing",
      requiresManualValidation: true,
      confidence: "low",
    });
    expect(
      response.body.dataQualityFindings.map((finding) => finding.code),
    ).toEqual(
      expect.arrayContaining(["missing_description", "missing_website"]),
    );
    expect(response.body.suggestedCompanyDescription.text).toBeTruthy();
    expect(response.body.suggestedCompanyDescription.text).toContain(
      "se dedica",
    );
    expect(response.body.nextRecommendedStep.action).toBe(
      "Validar duplicado antes de continuar",
    );
    expect(response.body.meta.provider).toBe("heuristic");
  });

  test("cuentas draft-analysis reporta una sola advertencia util cuando OpenAI no tiene cuota", async () => {
    const originalApiKey = config.openai.apiKey;
    const originalEnableWebSearch = config.openai.enableWebSearch;
    const originalFetch = global.fetch;
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () =>
        JSON.stringify({
          error: {
            message: "You exceeded your current quota.",
            type: "insufficient_quota",
            code: "insufficient_quota",
          },
        }),
    }));

    config.openai.apiKey = "test-key";
    config.openai.enableWebSearch = true;
    global.fetch = fetchMock;

    try {
      const result = await analyzeAccountDraft({
        draft: {
          name: "Total Play",
          accountTypeId: null,
          registrationCode: "RFC-VALIDAR-MANUAL",
          phone: "",
          economicSectorId: null,
          website: "",
          city: "CDMX",
          stateRegion: "CDMX",
          countryId: ctx.catalogIds.countryMxId,
          description: "",
          addressLine: "",
          postalCode: "",
          ownerUserIds: [],
        },
        options: {
          allowExternalEnrichment: true,
        },
        user: {
          id: ctx.accountCreateUserId,
          permissionSet: new Set(["cuentas.read_all"]),
        },
      });

      expect(result.meta.usedAiGeneration).toBe(false);
      expect(result.meta.usedExternalEnrichment).toBe(false);
      expect(result.warnings).toEqual([
        "OpenAI no esta disponible por cuota o facturacion en este momento; se muestran recomendaciones internas.",
      ]);
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
      config.openai.enableWebSearch = originalEnableWebSearch;
    }
  });

  test("cuentas draft-analysis puede sugerir website y contacto desde busqueda publica por nombre sin OpenAI", async () => {
    const originalApiKey = config.openai.apiKey;
    const originalEnableWebSearch = config.openai.enableWebSearch;
    const originalFetch = global.fetch;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `
          <html><body>
            <div class="result">
              <a class="result__a" href="https://www.totalplay.com.mx">Totalplay Oficial</a>
              <div class="result__snippet">Internet, television y telefonia para hogar y empresa.</div>
            </div>
          </body></html>
        `,
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: {
          get: (name) => (name === "content-type" ? "text/html" : null),
        },
        text: async () => `
          <html>
            <head>
              <title>Totalplay Empresas</title>
              <meta name="description" content="Servicios de internet, voz y datos para empresas" />
              <script type="application/ld+json">
                {
                  "@context": "https://schema.org",
                  "@type": "Organization",
                  "telephone": "+52 55 1234 5678",
                  "address": {
                    "@type": "PostalAddress",
                    "streetAddress": "Av. San Jeronimo 123",
                    "addressLocality": "Ciudad de Mexico",
                    "addressRegion": "CDMX",
                    "postalCode": "01000"
                  }
                }
              </script>
            </head>
            <body>Conectividad para empresas</body>
          </html>
        `,
      });

    config.openai.apiKey = "";
    config.openai.enableWebSearch = false;
    global.fetch = fetchMock;

    try {
      const result = await analyzeAccountDraft({
        draft: {
          name: "Total Play",
          accountTypeId: null,
          registrationCode: "RFC-VALIDAR-MANUAL",
          phone: "",
          economicSectorId: null,
          website: "",
          city: "",
          stateRegion: "",
          countryId: ctx.catalogIds.countryMxId,
          description: "",
          addressLine: "",
          postalCode: "",
          ownerUserIds: [ctx.accountCreateUserId],
        },
        options: {
          allowExternalEnrichment: true,
        },
        user: {
          id: ctx.accountCreateUserId,
          permissionSet: new Set(["cuentas.read_all"]),
        },
      });

      expect(result.meta.usedExternalEnrichment).toBe(true);
      expect(result.suggestedWebsite.value).toBe(
        "https://www.totalplay.com.mx/",
      );
      expect(result.suggestedContactData.addressLine).toBe(
        "Av. San Jeronimo 123",
      );
      expect(result.suggestedContactData.city).toBe("Ciudad de Mexico");
      expect(result.suggestedContactData.stateRegion).toBe("CDMX");
      expect(result.suggestedContactData.postalCode).toBe("01000");
      expect(result.suggestedContactData.phone).toBe("+52 55 1234 5678");
      expect(result.suggestedEconomicSector.sectorName).toBe(
        "Telecomunicaciones",
      );
      expect(result.suggestedEconomicSector.canAutoApply).toBe(true);
      expect(result.warnings).toEqual([]);
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
      config.openai.enableWebSearch = originalEnableWebSearch;
    }
  });

  test("cuentas draft-analysis completa ubicacion desde snippets publicos adicionales sin OpenAI", async () => {
    const originalApiKey = config.openai.apiKey;
    const originalEnableWebSearch = config.openai.enableWebSearch;
    const originalFetch = global.fetch;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `
          <html><body>
            <div class="result">
              <a class="result__a" href="https://www.totalplay.com.mx">Totalplay Oficial</a>
              <div class="result__snippet">Internet, television y telefonia para hogar y empresa.</div>
            </div>
          </body></html>
        `,
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: {
          get: (name) => (name === "content-type" ? "text/html" : null),
        },
        text: async () => `
          <html>
            <head>
              <title>Totalplay Empresas</title>
              <meta name="description" content="Servicios de internet, voz y datos para empresas" />
            </head>
            <body>Llamanos al +52 55 1234 5678 para ventas empresariales.</body>
          </html>
        `,
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `
          <html><body>
            <div class="result">
              <a class="result__a" href="https://www.totalplay.com.mx/contacto">Contacto Totalplay</a>
              <div class="result__snippet">Direccion: Av. San Jeronimo 123, Ciudad de Mexico, CDMX, C.P. 01000. Telefono: +52 55 1234 5678</div>
            </div>
          </body></html>
        `,
      });

    config.openai.apiKey = "";
    config.openai.enableWebSearch = false;
    global.fetch = fetchMock;

    try {
      const result = await analyzeAccountDraft({
        draft: {
          name: "Total Play",
          accountTypeId: null,
          registrationCode: "RFC-VALIDAR-MANUAL",
          phone: "",
          economicSectorId: null,
          website: "",
          city: "",
          stateRegion: "",
          countryId: ctx.catalogIds.countryMxId,
          description: "",
          addressLine: "",
          postalCode: "",
          ownerUserIds: [ctx.accountCreateUserId],
        },
        options: {
          allowExternalEnrichment: true,
        },
        user: {
          id: ctx.accountCreateUserId,
          permissionSet: new Set(["cuentas.read_all"]),
        },
      });

      expect(result.meta.usedExternalEnrichment).toBe(true);
      expect(result.suggestedWebsite.value).toBe(
        "https://www.totalplay.com.mx/",
      );
      expect(result.suggestedContactData.addressLine).toBe(
        "Av. San Jeronimo 123",
      );
      expect(result.suggestedContactData.city).toBe("Ciudad de Mexico");
      expect(result.suggestedContactData.stateRegion).toBe("CDMX");
      expect(result.suggestedContactData.postalCode).toBe("01000");
      expect(result.suggestedContactData.phone).toBe("+52 55 1234 5678");
      expect(result.warnings).toEqual([]);
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
      config.openai.enableWebSearch = originalEnableWebSearch;
    }
  });

  test("cuentas draft-analysis preserva ciudad, estado y codigo postal desde snippets sin calle", async () => {
    const originalApiKey = config.openai.apiKey;
    const originalEnableWebSearch = config.openai.enableWebSearch;
    const originalFetch = global.fetch;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `
          <html><body>
            <div class="result">
              <a class="result__a" href="https://www.totalplay.com.mx">Totalplay Oficial</a>
              <div class="result__snippet">Internet, television y telefonia para hogar y empresa.</div>
            </div>
          </body></html>
        `,
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: {
          get: (name) => (name === "content-type" ? "text/html" : null),
        },
        text: async () => `
          <html>
            <head>
              <title>Totalplay Empresas</title>
              <meta name="description" content="Servicios de internet, voz y datos para empresas" />
            </head>
            <body>Llamanos al +52 55 1234 5678 para ventas empresariales.</body>
          </html>
        `,
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `
          <html><body>
            <div class="result">
              <a class="result__a" href="https://www.totalplay.com.mx/contacto">Contacto Totalplay</a>
              <div class="result__snippet">Ubicacion: Ciudad de Mexico, CDMX, C.P. 01000. Telefono: +52 55 1234 5678</div>
            </div>
          </body></html>
        `,
      });

    config.openai.apiKey = "";
    config.openai.enableWebSearch = false;
    global.fetch = fetchMock;

    try {
      const result = await analyzeAccountDraft({
        draft: {
          name: "Total Play",
          accountTypeId: null,
          registrationCode: "RFC-VALIDAR-MANUAL",
          phone: "",
          economicSectorId: null,
          website: "",
          city: "",
          stateRegion: "",
          countryId: ctx.catalogIds.countryMxId,
          companyDescription: "",
          addressLine: "",
          postalCode: "",
          ownerUserIds: [ctx.accountCreateUserId],
        },
        options: {
          allowExternalFetch: true,
          allowAiSynthesis: false,
          allowWebSearchTool: false,
        },
        user: {
          id: ctx.accountCreateUserId,
          permissionSet: new Set(["cuentas.read_all"]),
        },
      });

      expect(result.suggestedContactData.city).toBe("Ciudad de Mexico");
      expect(result.suggestedContactData.stateRegion).toBe("CDMX");
      expect(result.suggestedContactData.postalCode).toBe("01000");
      expect(result.suggestedContactData.phone).toBe("+52 55 1234 5678");
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
      config.openai.enableWebSearch = originalEnableWebSearch;
    }
  });

  test("cuentas draft-analysis expone etapas del pipeline y plan de ejecucion", async () => {
    const result = await analyzeAccountDraft({
      draft: {
        name: "Acme Pipeline SA",
        accountTypeId: null,
        registrationCode: "",
        phone: "",
        economicSectorId: null,
        website: "",
        city: "",
        stateRegion: "",
        countryId: ctx.catalogIds.countryMxId,
        companyDescription: "",
        addressLine: "",
        postalCode: "",
        ownerUserIds: [ctx.accountCreateUserId],
      },
      options: {
        allowExternalFetch: false,
        allowAiSynthesis: false,
        allowWebSearchTool: false,
      },
      user: {
        id: ctx.accountCreateUserId,
        permissionSet: new Set(["cuentas.read_all"]),
      },
    });

    expect(result.meta.executionPlan).toEqual(
      expect.objectContaining({
        mode: "sync",
        canDefer: true,
        queueName: "account-draft-analysis",
        strategy: "heuristic_pipeline",
      }),
    );
    expect(result.meta.pipeline).toEqual(
      expect.objectContaining({
        stages: expect.arrayContaining([
          expect.objectContaining({
            stage: "context",
            status: "completed",
          }),
          expect.objectContaining({
            stage: "discovery",
            status: "skipped",
            reason: "external_fetch_disabled",
          }),
          expect.objectContaining({
            stage: "structured_extraction",
            status: "skipped",
          }),
        ]),
      }),
    );
  });

  test("cuentas draft-analysis.jobs completa el analisis y expone el resultado", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.create@example.com`,
    );

    const response = await request(app)
      .post("/api/accounts/draft-analysis/jobs")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        draft: {
          name: "Cuenta Async Demo",
          accountTypeId: null,
          registrationCode: "",
          phone: "",
          economicSectorId: null,
          website: "",
          city: "",
          stateRegion: "",
          countryId: ctx.catalogIds.countryMxId,
          companyDescription: "",
          addressLine: "",
          postalCode: "",
          ownerUserIds: [ctx.accountCreateUserId],
        },
        options: {
          allowExternalFetch: false,
          allowAiSynthesis: false,
          allowWebSearchTool: false,
        },
      });

    expect(response.status).toBe(202);
    expect(response.body.job).toEqual(
      expect.objectContaining({
        status: "pending",
      }),
    );

    await processPendingAccountDraftAnalysisJobs({ limit: 5 });

    const pollResponse = await request(app)
      .get(`/api/accounts/draft-analysis/jobs/${response.body.job.id}`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(pollResponse.status).toBe(200);
    expect(pollResponse.body.job).toEqual(
      expect.objectContaining({
        id: response.body.job.id,
        status: "completed",
        resultAvailable: true,
      }),
    );
    expect(pollResponse.body.result).toEqual(
      expect.objectContaining({
        duplicateWarnings: expect.any(Array),
        warnings: expect.any(Array),
        meta: expect.objectContaining({
          executionPlan: expect.objectContaining({
            queueName: "account-draft-analysis",
          }),
        }),
      }),
    );
  });

  test("cuentas draft-analysis.jobs reutiliza el resultado completado para el mismo solicitante", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.create@example.com`,
    );
    const payload = {
      draft: {
        name: "Cuenta Async Reuse",
        accountTypeId: null,
        registrationCode: "",
        phone: "",
        economicSectorId: null,
        website: "",
        city: "",
        stateRegion: "",
        countryId: ctx.catalogIds.countryMxId,
        companyDescription: "",
        addressLine: "",
        postalCode: "",
        ownerUserIds: [ctx.accountCreateUserId],
      },
      options: {
        allowExternalFetch: false,
        allowAiSynthesis: false,
        allowWebSearchTool: false,
      },
    };

    const firstResponse = await request(app)
      .post("/api/accounts/draft-analysis/jobs")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send(payload);

    await processPendingAccountDraftAnalysisJobs({ limit: 5 });

    const secondResponse = await request(app)
      .post("/api/accounts/draft-analysis/jobs")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send(payload);

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.job).toEqual(
      expect.objectContaining({
        id: firstResponse.body.job.id,
        status: "completed",
        resultAvailable: true,
      }),
    );
    expect(secondResponse.body.result).toEqual(
      expect.objectContaining({
        duplicateWarnings: expect.any(Array),
      }),
    );
  });

  test("cuentas draft-analysis.jobs expone failed cuando el worker no puede completar el analisis", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.create@example.com`,
    );
    const draftAnalysisService =
      await import("../src/accounts/draft-analysis/service.js");
    const analyzeSpy = vi
      .spyOn(draftAnalysisService, "analyzeAccountDraft")
      .mockRejectedValueOnce(new Error("Fallo forzado de analisis"));

    try {
      const createResponse = await request(app)
        .post("/api/accounts/draft-analysis/jobs")
        .set("Authorization", `Bearer ${loginResponse.body.token}`)
        .send({
          draft: {
            name: "Cuenta Async Failed",
            accountTypeId: null,
            registrationCode: "",
            phone: "",
            economicSectorId: null,
            website: "",
            city: "",
            stateRegion: "",
            countryId: ctx.catalogIds.countryMxId,
            companyDescription: "",
            addressLine: "",
            postalCode: "",
            ownerUserIds: [ctx.accountCreateUserId],
          },
          options: {
            allowExternalFetch: false,
            allowAiSynthesis: false,
            allowWebSearchTool: false,
          },
          forceRegenerate: true,
        });

      await processPendingAccountDraftAnalysisJobs({ limit: 5 });

      const pollResponse = await request(app)
        .get(`/api/accounts/draft-analysis/jobs/${createResponse.body.job.id}`)
        .set("Authorization", `Bearer ${loginResponse.body.token}`);

      expect(pollResponse.status).toBe(200);
      expect(pollResponse.body.job).toEqual(
        expect.objectContaining({
          status: "failed",
        }),
      );
      expect(pollResponse.body.error).toEqual(
        expect.objectContaining({
          code: "generation_failed",
          message: "Fallo forzado de analisis",
        }),
      );
    } finally {
      analyzeSpy.mockRestore();
    }
  });

  test("cuentas draft-analysis.jobs expone expired cuando el resultado ya vencio", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.create@example.com`,
    );

    const createResponse = await request(app)
      .post("/api/accounts/draft-analysis/jobs")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        draft: {
          name: "Cuenta Async Expired",
          accountTypeId: null,
          registrationCode: "",
          phone: "",
          economicSectorId: null,
          website: "",
          city: "",
          stateRegion: "",
          countryId: ctx.catalogIds.countryMxId,
          companyDescription: "",
          addressLine: "",
          postalCode: "",
          ownerUserIds: [ctx.accountCreateUserId],
        },
        options: {
          allowExternalFetch: false,
          allowAiSynthesis: false,
          allowWebSearchTool: false,
        },
        forceRegenerate: true,
      });

    await processPendingAccountDraftAnalysisJobs({ limit: 5 });
    await query(
      `UPDATE account_draft_analysis_jobs
       SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE)
       WHERE public_id = ?`,
      [createResponse.body.job.id],
    );

    const pollResponse = await request(app)
      .get(`/api/accounts/draft-analysis/jobs/${createResponse.body.job.id}`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(pollResponse.status).toBe(200);
    expect(pollResponse.body.job).toEqual(
      expect.objectContaining({
        status: "expired",
      }),
    );
    expect(pollResponse.body.error).toEqual(
      expect.objectContaining({
        code: "expired_result",
      }),
    );
  });

  test("cuentas draft-analysis ignora ruido del HTML del buscador para no inventar direccion o telefono", async () => {
    const originalApiKey = config.openai.apiKey;
    const originalEnableWebSearch = config.openai.enableWebSearch;
    const originalFetch = global.fetch;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `
          <html><body>
            <header>DuckDuckGo All Regions Argentina Australia Austria Belgium Canada 61572841051009</header>
            <div class="result">
              <a class="result__a" href="https://www.totalplay.com.ar">Totalplay Argentina</a>
              <div class="result__snippet">Servicios de conectividad y telecomunicaciones.</div>
            </div>
          </body></html>
        `,
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: {
          get: (name) => (name === "content-type" ? "text/html" : null),
        },
        text: async () => `
          <html>
            <head><title>Totalplay Argentina</title></head>
            <body>Servicios empresariales.</body>
          </html>
        `,
      });

    config.openai.apiKey = "";
    config.openai.enableWebSearch = false;
    global.fetch = fetchMock;

    try {
      const result = await analyzeAccountDraft({
        draft: {
          name: "Total Play",
          accountTypeId: null,
          registrationCode: "RFC-VALIDAR-MANUAL",
          phone: "",
          economicSectorId: null,
          website: "",
          city: "",
          stateRegion: "",
          countryId: ctx.catalogIds.countryArId,
          description: "",
          addressLine: "",
          postalCode: "",
          ownerUserIds: [ctx.accountCreateUserId],
        },
        options: {
          allowExternalEnrichment: true,
        },
        user: {
          id: ctx.accountCreateUserId,
          permissionSet: new Set(["cuentas.read_all"]),
        },
      });

      expect(result.suggestedContactData.addressLine).toBe("");
      expect(result.suggestedContactData.city).toBe("");
      expect(result.suggestedContactData.stateRegion).toBe("");
      expect(result.suggestedContactData.postalCode).toBe("");
      expect(result.suggestedContactData.phone).toBe("");
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
      config.openai.enableWebSearch = originalEnableWebSearch;
    }
  });

  test("cuentas draft-analysis completa ubicacion con busqueda publica asistida cuando la heuristica no alcanza", async () => {
    const originalApiKey = config.openai.apiKey;
    const originalEnableWebSearch = config.openai.enableWebSearch;
    const originalFetch = global.fetch;
    const fetchMock = vi.fn(async (input) => {
      const url = String(input || "");

      if (
        url.includes("html.duckduckgo.com/html/") &&
        url.includes(encodeURIComponent("sitio oficial"))
      ) {
        return {
          ok: true,
          text: async () => `
            <html><body>
              <div class="result">
                <a class="result__a" href="https://www.totalplay.com.mx">Totalplay Oficial</a>
                <div class="result__snippet">Internet, television y telefonia para hogar y empresa.</div>
              </div>
            </body></html>
          `,
        };
      }

      if (url === "https://www.totalplay.com.mx/") {
        return {
          ok: true,
          headers: {
            get: (name) => (name === "content-type" ? "text/html" : null),
          },
          text: async () => `
            <html>
              <head>
                <title>Totalplay Empresas</title>
                <meta name="description" content="Servicios de internet, voz y datos para empresas" />
              </head>
              <body>Llamanos al +52 55 1234 5678 para ventas empresariales.</body>
            </html>
          `,
        };
      }

      if (
        url.includes("html.duckduckgo.com/html/") &&
        url.includes("direccion")
      ) {
        return {
          ok: true,
          text: async () => `
            <html><body>
              <div class="result">
                <a class="result__a" href="https://www.totalplay.com.mx/contacto">Contacto Totalplay</a>
                <div class="result__snippet">Telefonos y canales de atencion de Totalplay.</div>
              </div>
            </body></html>
          `,
        };
      }

      if (url === "https://www.totalplay.com.mx/contacto") {
        return {
          ok: true,
          headers: {
            get: (name) => (name === "content-type" ? "text/html" : null),
          },
          text: async () => `
            <html>
              <head><title>Contacto Totalplay</title></head>
              <body>Canales de atencion y telefonos empresariales.</body>
            </html>
          `,
        };
      }

      if (url.endsWith("/responses")) {
        return {
          ok: true,
          json: async () => ({
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      suggestedContactData: {
                        addressLine: "Av. San Jeronimo 123",
                        city: "Ciudad de Mexico",
                        stateRegion: "CDMX",
                        postalCode: "01000",
                        phone: "+52 55 1234 5678",
                        confidence: "high",
                        reason:
                          "Se encontro direccion completa en resultados publicos adicionales y fuentes de contacto de la empresa.",
                      },
                      warnings: [],
                    }),
                  },
                ],
              },
            ],
          }),
        };
      }

      if (url.endsWith("/chat/completions")) {
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    suggestedCompanyDescription:
                      "Total Play se dedica a servicios de conectividad y telecomunicaciones para empresas y hogares.",
                    suggestedWebsite: "https://www.totalplay.com.mx/",
                    websiteConfidence: "high",
                    websiteReason:
                      "Se identifico el sitio oficial de la empresa.",
                    suggestedContactData: {
                      addressLine: "",
                      city: "",
                      stateRegion: "",
                      postalCode: "",
                      phone: "",
                      confidence: "low",
                      reason: "",
                    },
                    suggestedRegistrationCode: "",
                    registrationConfidence: "low",
                    registrationReason: "",
                    suggestedImprovements: [],
                    nextRecommendedStep: {
                      action: "Registrar contacto principal",
                      reason:
                        "La cuenta ya tiene contexto suficiente para continuar con el flujo comercial.",
                    },
                    confidence: "medium",
                    warnings: [],
                  }),
                },
              },
            ],
          }),
        };
      }

      throw new Error(`Unexpected fetch URL in assisted location test: ${url}`);
    });

    config.openai.apiKey = "test-key";
    config.openai.enableWebSearch = true;
    global.fetch = fetchMock;

    try {
      const result = await analyzeAccountDraft({
        draft: {
          name: "Total Play",
          accountTypeId: null,
          registrationCode: "RFC-VALIDAR-MANUAL",
          phone: "",
          economicSectorId: null,
          website: "",
          city: "",
          stateRegion: "",
          countryId: ctx.catalogIds.countryMxId,
          description: "",
          addressLine: "",
          postalCode: "",
          ownerUserIds: [ctx.accountCreateUserId],
        },
        options: {
          allowExternalEnrichment: true,
        },
        user: {
          id: ctx.accountCreateUserId,
          permissionSet: new Set(["cuentas.read_all"]),
        },
      });

      expect(result.meta.usedExternalEnrichment).toBe(true);
      expect(result.suggestedContactData.addressLine).toBe(
        "Av. San Jeronimo 123",
      );
      expect(result.suggestedContactData.city).toBe("Ciudad de Mexico");
      expect(result.suggestedContactData.stateRegion).toBe("CDMX");
      expect(result.suggestedContactData.postalCode).toBe("01000");
      expect(result.suggestedContactData.phone).toBe("+52 55 1234 5678");
      expect(result.warnings).toEqual([]);
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
      config.openai.enableWebSearch = originalEnableWebSearch;
    }
  });

  test("cuentas draft-analysis puede sugerir registro desde busquedas publicas sin OpenAI", async () => {
    const originalApiKey = config.openai.apiKey;
    const originalEnableWebSearch = config.openai.enableWebSearch;
    const originalFetch = global.fetch;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `
          <html><body>
            <div class="result">
              <a class="result__a" href="https://www.totalplay.com.mx">Totalplay Oficial</a>
              <div class="result__snippet">Internet y telefonia para empresas.</div>
            </div>
          </body></html>
        `,
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: {
          get: (name) => (name === "content-type" ? "text/html" : null),
        },
        text: async () => `
          <html>
            <head><title>Totalplay</title></head>
            <body>Servicios empresariales.</body>
          </html>
        `,
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `
          <html><body>
            <div class="result">
              <a class="result__a" href="https://facturacion.totalplay.com.mx">Facturacion Totalplay</a>
              <div class="result__snippet">RFC TPT8907019A1 para facturacion electronica.</div>
            </div>
          </body></html>
        `,
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: {
          get: (name) => (name === "content-type" ? "text/html" : null),
        },
        text: async () => `
          <html>
            <head><title>Facturacion Totalplay</title></head>
            <body>RFC TPT8907019A1</body>
          </html>
        `,
      });

    config.openai.apiKey = "";
    config.openai.enableWebSearch = false;
    global.fetch = fetchMock;

    try {
      const result = await analyzeAccountDraft({
        draft: {
          name: "Total Play",
          accountTypeId: null,
          registrationCode: "",
          phone: "",
          economicSectorId: null,
          website: "",
          city: "",
          stateRegion: "",
          countryId: ctx.catalogIds.countryMxId,
          description: "",
          addressLine: "",
          postalCode: "",
          ownerUserIds: [],
        },
        options: {
          allowExternalEnrichment: true,
        },
        user: {
          id: ctx.accountCreateUserId,
          permissionSet: new Set(["cuentas.read_all"]),
        },
      });

      expect(result.registrationAssistance.status).toBe("candidate");
      expect(result.registrationAssistance.value).toBe("TPT8907019A1");
      expect(result.registrationAssistance.sourceType).toBe(
        "external_public_source",
      );
      expect(result.registrationAssistance.canAutoApply).toBe(true);
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
      config.openai.enableWebSearch = originalEnableWebSearch;
    }
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

  test("Administrador conserva acceso efectivo aunque falten permisos explicitos en role_permissions", async () => {
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

    const meResponse = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${adminLoginResponse.body.token}`);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.permissions).toContain("roles.read");
    expect(meResponse.body.permissions).toContain("permissions.read");

    const rolesResponse = await request(app)
      .get("/api/roles")
      .set("Authorization", `Bearer ${adminLoginResponse.body.token}`);

    expect(rolesResponse.status).toBe(200);

    const permissionsResponse = await request(app)
      .get("/api/roles/permissions")
      .set("Authorization", `Bearer ${adminLoginResponse.body.token}`);

    expect(permissionsResponse.status).toBe(200);

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

  test("cuentas.put permite editar una cuenta sin cambiar su estado de activacion", async () => {
    const accountId = await createDirectAccount({
      ownerUserId: ctx.accountCreateUserId,
      actorUserId: ctx.accountCreateUserId,
      suffix: `${TEST_PREFIX}_account_put_same_status`,
    });
    cleanup.accountIds.push(accountId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.create@example.com`,
    );

    const sameStatusPut = await request(app)
      .put(`/api/accounts/${accountId}`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Quartz Edit ${TEST_PREFIX} revisada`,
        accountTypeId: ctx.catalogIds.accountTypeId,
        registrationCode: `FIX-${TEST_PREFIX}_account_put_same_status`,
        phone: "5550003334",
        economicSectorId: ctx.catalogIds.economicSectorId,
        website: "https://put-edited.example.com",
        city: "CDMX",
        stateRegion: "CDMX",
        countryId: ctx.catalogIds.countryMxId,
        description: "Cuenta para validar PUT sin cambiar estado",
        addressLine: "Direccion put",
        postalCode: "01003",
        activationStatusId: ctx.catalogIds.accountActiveStatusId,
        ownerUserIds: [ctx.accountCreateUserId],
      });

    expect(sameStatusPut.status).toBe(200);
    expect(sameStatusPut.body.message).toBe("Cuenta actualizada");

    const statusCode = await getStatusCodeById("accounts", accountId, {
      table: "account_activation_statuses",
      column: "activation_status_id",
    });
    expect(statusCode).toBe("activada");
  });

  test("cuentas.put bloquea cambiar el estado de activacion sin cuentas.create", async () => {
    const accountInactiveStatusId = await getCatalogId(
      "account_activation_statuses",
      "desactivada",
    );
    const accountId = await createDirectAccount({
      ownerUserId: ctx.accountRequestUserId,
      actorUserId: ctx.accountRequestUserId,
      suffix: `${TEST_PREFIX}_account_put_blocked_status`,
    });
    cleanup.accountIds.push(accountId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.request@example.com`,
    );

    const blockedStatusPut = await request(app)
      .put(`/api/accounts/${accountId}`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        name: `Quartz Edit ${TEST_PREFIX} activacion`,
        accountTypeId: ctx.catalogIds.accountTypeId,
        registrationCode: `FIX-${TEST_PREFIX}_account_put_blocked_status`,
        phone: "5550003335",
        economicSectorId: ctx.catalogIds.economicSectorId,
        website: "https://put-blocked.example.com",
        city: "CDMX",
        stateRegion: "CDMX",
        countryId: ctx.catalogIds.countryMxId,
        description: "Cuenta para validar bloqueo de activacion",
        addressLine: "Direccion put",
        postalCode: "01003",
        activationStatusId: accountInactiveStatusId,
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

  test("interacciones comerciales permite registrar, consultar catalogos y actualizar una interaccion de cuenta", async () => {
    const interactionAccountId = await createDirectAccount({
      ownerUserId: ctx.accountCreateUserId,
      actorUserId: ctx.accountCreateUserId,
      suffix: `${TEST_PREFIX}_account_interactions_crud`,
    });
    cleanup.accountIds.push(interactionAccountId);

    const contactOneId = await createDirectContact({
      accountId: interactionAccountId,
      actorUserId: ctx.accountCreateUserId,
      suffix: `${TEST_PREFIX}_account_interactions_contact_1`,
    });
    const contactTwoId = await createDirectContact({
      accountId: interactionAccountId,
      actorUserId: ctx.accountCreateUserId,
      suffix: `${TEST_PREFIX}_account_interactions_contact_2`,
    });
    cleanup.contactIds.push(contactOneId, contactTwoId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.create@example.com`,
    );
    const token = loginResponse.body.token;

    const typesResponse = await request(app)
      .get("/api/catalogs/account-interaction-types")
      .set("Authorization", `Bearer ${token}`);
    expect(typesResponse.status).toBe(200);
    expect(typesResponse.body.some((item) => item.code === "meeting")).toBe(
      true,
    );

    const resultsResponse = await request(app)
      .get("/api/catalogs/account-interaction-results")
      .set("Authorization", `Bearer ${token}`);
    expect(resultsResponse.status).toBe(200);
    const exploringResult = resultsResponse.body.find(
      (item) => item.code === "exploring",
    );
    const followUpResult = resultsResponse.body.find(
      (item) => item.code === "follow_up_required",
    );
    const meetingType = typesResponse.body.find(
      (item) => item.code === "meeting",
    );

    const createResponse = await request(app)
      .post(`/api/accounts/${interactionAccountId}/interactions`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        interactionTypeId: meetingType.id,
        resultId: exploringResult.id,
        title: `Discovery comercial ${TEST_PREFIX}`,
        summary: "Se reviso contexto del cliente y se detecto interes inicial.",
        nextStep: "Enviar minuta y validar patrocinador interno.",
        occurredAt: "2026-01-15T10:30:00.000Z",
        followUpAt: "2026-01-18T16:00:00.000Z",
        contactIds: [contactOneId, contactTwoId],
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.interaction.title).toBe(
      `Discovery comercial ${TEST_PREFIX}`,
    );
    expect(createResponse.body.interaction.contacts).toHaveLength(2);
    const interactionId = Number(createResponse.body.interaction.id);

    const listResponse = await request(app)
      .get(`/api/accounts/${interactionAccountId}/interactions`)
      .set("Authorization", `Bearer ${token}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.items).toHaveLength(1);
    expect(listResponse.body.items[0].contacts).toHaveLength(2);

    const contactOptionsResponse = await request(app)
      .get(`/api/accounts/${interactionAccountId}/interactions/contact-options`)
      .set("Authorization", `Bearer ${token}`);
    expect(contactOptionsResponse.status).toBe(200);
    expect(contactOptionsResponse.body).toHaveLength(2);

    const updateResponse = await request(app)
      .put(
        `/api/accounts/${interactionAccountId}/interactions/${interactionId}`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        interactionTypeId: meetingType.id,
        resultId: followUpResult.id,
        title: `Discovery comercial actualizado ${TEST_PREFIX}`,
        summary: "Se acordaron responsables y fecha para la siguiente sesion.",
        nextStep: "Preparar demo tecnica.",
        occurredAt: "2026-01-15T10:30:00.000Z",
        followUpAt: "2026-01-22T09:00:00.000Z",
        contactIds: [contactOneId],
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.interaction.result.code).toBe(
      "follow_up_required",
    );
    expect(updateResponse.body.interaction.contacts).toHaveLength(1);

    const detailResponse = await request(app)
      .get(
        `/api/accounts/${interactionAccountId}/interactions/${interactionId}`,
      )
      .set("Authorization", `Bearer ${token}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.nextStep).toBe("Preparar demo tecnica.");
    expect(detailResponse.body.contacts).toHaveLength(1);
  });

  test("interacciones comerciales permite adjuntar documentos y promover la interaccion a oportunidad", async () => {
    const interactionAccountId = await createDirectAccount({
      ownerUserId: ctx.accountCreateUserId,
      actorUserId: ctx.accountCreateUserId,
      suffix: `${TEST_PREFIX}_account_interactions_docs`,
    });
    cleanup.accountIds.push(interactionAccountId);

    await query(
      "INSERT INTO account_owners (account_id, user_id, assigned_at, assigned_by) VALUES (?, ?, NOW(3), ?)",
      [
        interactionAccountId,
        ctx.opportunityFlowUserId,
        ctx.accountCreateUserId,
      ],
    );

    const interactionContactId = await createDirectContact({
      accountId: interactionAccountId,
      actorUserId: ctx.accountCreateUserId,
      suffix: `${TEST_PREFIX}_account_interactions_docs_contact`,
    });
    cleanup.contactIds.push(interactionContactId);

    const typesResponse = await request(app)
      .get("/api/catalogs/account-interaction-types")
      .set(
        "Authorization",
        `Bearer ${(await login(request(app), `${TEST_PREFIX}.accounts.create@example.com`)).body.token}`,
      );
    const resultsResponse = await request(app)
      .get("/api/catalogs/account-interaction-results")
      .set(
        "Authorization",
        `Bearer ${(await login(request(app), `${TEST_PREFIX}.accounts.create@example.com`)).body.token}`,
      );
    const presentationType = typesResponse.body.find(
      (item) => item.code === "presentation",
    );
    const opportunityDetectedResult = resultsResponse.body.find(
      (item) => item.code === "opportunity_detected",
    );

    const accountLoginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.create@example.com`,
    );
    const accountToken = accountLoginResponse.body.token;

    const createInteractionResponse = await request(app)
      .post(`/api/accounts/${interactionAccountId}/interactions`)
      .set("Authorization", `Bearer ${accountToken}`)
      .send({
        interactionTypeId: presentationType.id,
        resultId: opportunityDetectedResult.id,
        title: `Presentacion tecnica ${TEST_PREFIX}`,
        summary:
          "El cliente solicito propuesta economica y validacion de alcance.",
        nextStep: "Transformar en oportunidad y adjuntar minuta.",
        occurredAt: "2026-02-10T12:00:00.000Z",
        followUpAt: null,
        contactIds: [interactionContactId],
      });

    expect(createInteractionResponse.status).toBe(201);
    const interactionId = Number(createInteractionResponse.body.interaction.id);

    const uploadResponse = await request(app)
      .post(
        `/api/accounts/${interactionAccountId}/interactions/${interactionId}/documents`,
      )
      .set("Authorization", `Bearer ${accountToken}`)
      .attach(
        "files",
        Buffer.from("Minuta comercial con requerimientos iniciales", "utf8"),
        {
          filename: `interaction_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.body).toHaveLength(1);
    const documentPublicId = uploadResponse.body[0].publicId;

    const documentsResponse = await request(app)
      .get(
        `/api/accounts/${interactionAccountId}/interactions/${interactionId}/documents`,
      )
      .set("Authorization", `Bearer ${accountToken}`);
    expect(documentsResponse.status).toBe(200);
    expect(documentsResponse.body).toHaveLength(1);

    const contentResponse = await request(app)
      .get(
        `/api/accounts/${interactionAccountId}/interactions/${interactionId}/documents/${documentPublicId}/content`,
      )
      .set("Authorization", `Bearer ${accountToken}`);
    expect(contentResponse.status).toBe(200);
    expect(String(contentResponse.text)).toContain("Minuta comercial");

    const opportunityLoginResponse = await login(
      request(app),
      `${TEST_PREFIX}.opps.flow@example.com`,
    );
    const opportunityToken = opportunityLoginResponse.body.token;

    const promoteResponse = await request(app)
      .post(
        `/api/accounts/${interactionAccountId}/interactions/${interactionId}/create-opportunity`,
      )
      .set("Authorization", `Bearer ${opportunityToken}`)
      .send({
        name: `Oportunidad derivada ${TEST_PREFIX}`,
        amountUsd: 245000,
        closeDate: "2026-05-30",
        contactId: interactionContactId,
        businessLineId: ctx.catalogIds.businessLineId,
        sellerUserId: ctx.sellerUserId,
        presalesUserId: null,
        documentPublicIds: [documentPublicId],
      });

    expect(promoteResponse.status).toBe(201);
    const opportunityId = Number(promoteResponse.body.opportunityId);
    cleanup.opportunityIds.push(opportunityId);

    const linkedDocsRows = await query(
      `SELECT odl.id
       FROM opportunity_document_links odl
       INNER JOIN documents d ON d.id = odl.document_id
       WHERE odl.opportunity_id = ? AND d.public_id = ?`,
      [opportunityId, documentPublicId],
    );
    expect(linkedDocsRows).toHaveLength(1);

    const [interactionRow] = await query(
      `SELECT ai.linked_opportunity_id, air.code AS result_code
       FROM account_interactions ai
       INNER JOIN account_interaction_results air ON air.id = ai.result_id
       WHERE ai.id = ?`,
      [interactionId],
    );
    expect(Number(interactionRow.linked_opportunity_id)).toBe(opportunityId);
    expect(interactionRow.result_code).toBe("converted_to_opportunity");

    const deleteResponse = await request(app)
      .delete(
        `/api/accounts/${interactionAccountId}/interactions/${interactionId}/documents/${documentPublicId}`,
      )
      .set("Authorization", `Bearer ${accountToken}`);
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body).toHaveLength(0);

    const deletedDocumentRows = await query(
      `SELECT is_deleted
       FROM documents
       WHERE public_id = ?
       LIMIT 1`,
      [documentPublicId],
    );
    expect(deletedDocumentRows).toHaveLength(1);
    expect(Number(deletedDocumentRows[0].is_deleted)).toBe(1);
  });

  test("interacciones comerciales respeta acceso por ownership y read_all", async () => {
    const guardedAccountId = await createDirectAccount({
      ownerUserId: ctx.accountCreateUserId,
      actorUserId: ctx.accountCreateUserId,
      suffix: `${TEST_PREFIX}_account_interactions_access`,
    });
    cleanup.accountIds.push(guardedAccountId);

    const accountLoginResponse = await login(
      request(app),
      `${TEST_PREFIX}.accounts.create@example.com`,
    );
    const createToken = accountLoginResponse.body.token;

    const typeId = await getCatalogId("account_interaction_types", "call");
    const resultId = await getCatalogId(
      "account_interaction_results",
      "no_defined_opportunity",
    );

    const createResponse = await request(app)
      .post(`/api/accounts/${guardedAccountId}/interactions`)
      .set("Authorization", `Bearer ${createToken}`)
      .send({
        interactionTypeId: typeId,
        resultId,
        title: `Llamada exploratoria ${TEST_PREFIX}`,
        summary: "No se identifico oportunidad concreta en esta etapa.",
        nextStep: null,
        occurredAt: "2026-03-01T09:00:00.000Z",
        followUpAt: null,
        contactIds: [],
      });
    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.interaction.id);

    const ownedReadLogin = await login(
      request(app),
      `${TEST_PREFIX}.accounts.read@example.com`,
    );
    const ownedReadResponse = await request(app)
      .get(`/api/accounts/${guardedAccountId}/interactions/${interactionId}`)
      .set("Authorization", `Bearer ${ownedReadLogin.body.token}`);
    expect(ownedReadResponse.status).toBe(404);

    const globalReadLogin = await login(
      request(app),
      `${TEST_PREFIX}.accounts.read.all@example.com`,
    );
    const globalReadResponse = await request(app)
      .get(`/api/accounts/${guardedAccountId}/interactions/${interactionId}`)
      .set("Authorization", `Bearer ${globalReadLogin.body.token}`);
    expect(globalReadResponse.status).toBe(200);
    expect(globalReadResponse.body.title).toBe(
      `Llamada exploratoria ${TEST_PREFIX}`,
    );
  });

  test("interacciones permite registrar y analizar una interaccion top-level", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Interaccion top-level ${TEST_PREFIX}`)
      .field(
        "sourceNotes",
        "Seguimiento posterior a una reunion de descubrimiento.",
      )
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Integrado Alpha",
            "Contacto: Maria Gomez",
            "Tema: Renovacion de plataforma F5",
            "Accion realizada: Reunion de descubrimiento comercial",
            "Proximo paso: Enviar propuesta ejecutiva",
            "Oportunidad: Renovacion F5 Alpha",
            "Correo: maria.gomez@alpha.example.com",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_top_level_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.analysisStatus).toBe("created");
    expect(createResponse.body.processingStatus).toBe("analyzed");
    expect(createResponse.body.documents).toHaveLength(1);

    const interactionId = Number(createResponse.body.id);

    expect(createResponse.body.suggestedAccount.name).toContain(
      "Prospecto Integrado Alpha",
    );
    expect(createResponse.body.suggestedContacts).toHaveLength(1);
    expect(createResponse.body.suggestedOpportunities).toHaveLength(1);

    const listResponse = await request(app)
      .get("/api/interactions")
      .set("Authorization", `Bearer ${token}`);
    expect(listResponse.status).toBe(200);
    expect(
      listResponse.body.items.some((item) => Number(item.id) === interactionId),
    ).toBe(true);

    const detailResponse = await request(app)
      .get(`/api/interactions/${interactionId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.summary).toContain("Prospecto Integrado Alpha");
  });

  test("interacciones.analyze.jobs completa el reanalisis asincrono", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Interaccion async ${TEST_PREFIX}`)
      .field(
        "sourceNotes",
        "Seguimiento a discovery con necesidad confirmada y proximo paso comercial.",
      )
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Async Beta",
            "Contacto: Laura Perez",
            "Tema: Expansion de servicios administrados",
            "Accion realizada: Llamada de seguimiento",
            "Proximo paso: Coordinar reunion tecnica",
            "Oportunidad: Expansion Beta",
            "Correo: laura.perez@beta.example.com",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_async_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.id);

    const jobResponse = await request(app)
      .post(`/api/interactions/${interactionId}/analyze/jobs`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(jobResponse.status).toBe(202);
    expect(jobResponse.body.job.status).toBe("pending");

    await processPendingInteractionAnalysisJobs({ limit: 5 });

    const pollResponse = await request(app)
      .get(
        `/api/interactions/${interactionId}/analyze/jobs/${jobResponse.body.job.id}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(pollResponse.status).toBe(200);
    expect(pollResponse.body.job).toEqual(
      expect.objectContaining({
        status: "completed",
        resultAvailable: true,
      }),
    );
    expect(pollResponse.body.result).toEqual(
      expect.objectContaining({
        interactionId,
        processingStatus: expect.stringMatching(/analyzed|fallback/),
      }),
    );
  });

  test("interacciones.analyze.jobs expone failed cuando el worker no puede resolver el solicitante", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Interaccion async failed ${TEST_PREFIX}`)
      .field("sourceNotes", "Seguimiento comercial con job asincrono fallido.")
      .attach(
        "files",
        Buffer.from("Cuenta: Prospecto Failed\nContacto: Laura Test", "utf8"),
        {
          filename: `interaction_async_failed_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    const interactionId = Number(createResponse.body.id);

    const jobResponse = await request(app)
      .post(`/api/interactions/${interactionId}/analyze/jobs`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    await forceInvalidJobRequester(
      "interaction_analysis_jobs",
      jobResponse.body.job.id,
    );
    await processPendingInteractionAnalysisJobs({ limit: 5 });

    const pollResponse = await request(app)
      .get(
        `/api/interactions/${interactionId}/analyze/jobs/${jobResponse.body.job.id}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(pollResponse.status).toBe(200);
    expect(pollResponse.body.job.status).toBe("failed");
    expect(pollResponse.body.error).toEqual(
      expect.objectContaining({
        code: "requester_not_found",
      }),
    );
  });

  test("interacciones.analyze.jobs expone stale cuando cambia la interaccion antes de procesar", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Interaccion async stale ${TEST_PREFIX}`)
      .field("sourceNotes", "Seguimiento comercial para invalidar snapshot.")
      .attach(
        "files",
        Buffer.from("Cuenta: Prospecto Stale\nContacto: Laura Test", "utf8"),
        {
          filename: `interaction_async_stale_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    const interactionId = Number(createResponse.body.id);

    const jobResponse = await request(app)
      .post(`/api/interactions/${interactionId}/analyze/jobs`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    await query(
      `UPDATE interactions
       SET title = ?, updated_at = NOW(3)
       WHERE id = ?`,
      [`Interaccion modificada ${TEST_PREFIX}`, interactionId],
    );

    await processPendingInteractionAnalysisJobs({ limit: 5 });

    const pollResponse = await request(app)
      .get(
        `/api/interactions/${interactionId}/analyze/jobs/${jobResponse.body.job.id}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(pollResponse.status).toBe(200);
    expect(pollResponse.body.job.status).toBe("stale");
    expect(pollResponse.body.error).toEqual(
      expect.objectContaining({
        code: "stale_snapshot",
      }),
    );
  });

  test("interacciones.analyze.jobs expone expired cuando vence el TTL del resultado", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Interaccion async expired ${TEST_PREFIX}`)
      .field("sourceNotes", "Seguimiento comercial para expirar resultado.")
      .attach(
        "files",
        Buffer.from("Cuenta: Prospecto Expired\nContacto: Laura Test", "utf8"),
        {
          filename: `interaction_async_expired_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    const interactionId = Number(createResponse.body.id);

    const jobResponse = await request(app)
      .post(`/api/interactions/${interactionId}/analyze/jobs`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    await processPendingInteractionAnalysisJobs({ limit: 5 });
    await query(
      `UPDATE interaction_analysis_jobs
       SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE)
       WHERE public_id = ?`,
      [jobResponse.body.job.id],
    );

    const pollResponse = await request(app)
      .get(
        `/api/interactions/${interactionId}/analyze/jobs/${jobResponse.body.job.id}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(pollResponse.status).toBe(200);
    expect(pollResponse.body.job.status).toBe("expired");
    expect(pollResponse.body.error).toEqual(
      expect.objectContaining({
        code: "expired_result",
      }),
    );
  });

  test("interacciones permite registrar y analizar una interaccion top-level desde un .eml", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Interaccion eml ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "From: Laura Perez <laura.perez@alpha.example.com>",
            "To: ventas@newpeople.local",
            "Subject: Seguimiento renovacion F5 Alpha",
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=utf-8",
            "",
            "Cuenta: Prospecto Integrado Alpha",
            "Contacto: Laura Perez",
            "Tema: Renovacion de plataforma F5",
            "Accion realizada: Seguimiento por correo despues de discovery",
            "Proximo paso: Coordinar propuesta ejecutiva",
            "Oportunidad: Renovacion F5 Alpha",
          ].join("\r\n"),
          "utf8",
        ),
        {
          filename: `interaction_top_level_${TEST_PREFIX}.eml`,
          contentType: "message/rfc822",
        },
      );

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.analysisStatus).toBe("created");
    expect(createResponse.body.processingStatus).toBe("analyzed");
    expect(createResponse.body.documents).toHaveLength(1);

    const interactionId = Number(createResponse.body.id);

    expect(createResponse.body.suggestedAccount.name).toContain(
      "Prospecto Integrado Alpha",
    );
    expect(createResponse.body.suggestedContacts).toHaveLength(1);
    expect(createResponse.body.suggestedOpportunities).toHaveLength(1);

    const detailResponse = await request(app)
      .get(`/api/interactions/${interactionId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.summary).toContain("Prospecto Integrado Alpha");
  });

  test("interacciones permite eliminar un documento adjunto top-level", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Interaccion delete doc ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Gamma",
            "Contacto: Ana Ruiz",
            "Tema: Servicio administrado",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_delete_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.documents).toHaveLength(1);

    const interactionId = Number(createResponse.body.id);
    const documentPublicId = createResponse.body.documents[0].publicId;

    const deleteResponse = await request(app)
      .delete(
        `/api/interactions/${interactionId}/documents/${documentPublicId}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.documents).toHaveLength(0);

    const deletedDocumentRows = await query(
      `SELECT is_deleted
       FROM documents
       WHERE public_id = ?
       LIMIT 1`,
      [documentPublicId],
    );
    expect(deletedDocumentRows).toHaveLength(1);
    expect(Number(deletedDocumentRows[0].is_deleted)).toBe(1);

    const detailResponse = await request(app)
      .get(`/api/interactions/${interactionId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.documents).toHaveLength(0);
  });

  test("interacciones assign_any permite asignar un vendedor activo aunque no sea owner de la cuenta", async () => {
    const sellerAltEmail = `${TEST_PREFIX}.lead.alt.owner@example.com`;
    const sellerAltUserId = await createUser({
      fullName: "Lead Alt Seller",
      email: sellerAltEmail,
      roleIds: [ctx.sellerRoleId],
    });
    cleanup.userIds.push(sellerAltUserId);

    const accountId = await createDirectAccount({
      ownerUserId: ctx.sellerUserId,
      actorUserId: ctx.sellerUserId,
      suffix: `${TEST_PREFIX}_lead_owner_scope`,
    });
    cleanup.accountIds.push(accountId);

    const contactId = await createDirectContact({
      accountId,
      actorUserId: ctx.sellerUserId,
      suffix: `${TEST_PREFIX}_lead_owner_scope`,
    });
    cleanup.contactIds.push(contactId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead owner scope ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            `Cuenta: Cuenta ${TEST_PREFIX}_lead_owner_scope`,
            "Contacto: Laura Perez",
            "Tema: Seguimiento comercial",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_owner_scope_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);

    const suggestion = createResponse.body.suggestedContacts[0];
    const resolveResponse = await request(app)
      .post(`/api/interactions/${createResponse.body.id}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: createResponse.body.title,
        sourceNotes: createResponse.body.sourceNotes || "",
        summary: createResponse.body.summary,
        topics: createResponse.body.topics,
        actionsTaken: createResponse.body.actionsTaken,
        nextSteps: createResponse.body.nextSteps,
        suggestedAccount: createResponse.body.suggestedAccount,
        suggestedContacts: createResponse.body.suggestedContacts,
        suggestedOpportunities: createResponse.body.suggestedOpportunities,
        sellerUserId: sellerAltUserId,
        accountResolution: {
          mode: "link_existing",
          accountId,
        },
        contactResolutions: [
          {
            suggestionId: suggestion.suggestionId,
            mode: "link_existing",
            contactId,
          },
        ],
        opportunityResolutions: [],
      });

    expect(resolveResponse.status).toBe(200);
    expect(resolveResponse.body.sellerUserId).toBe(sellerAltUserId);
    expect(resolveResponse.body.commercialAssignmentPolicy).toMatchObject({
      mode: "any",
      locked: false,
      allowedSellerUserId: null,
    });
  });

  test("interacciones permite autoasignar al vendedor editor cuando la cuenta no tiene owners vendedores", async () => {
    const sellerResolverUserId = await createUser({
      fullName: "API Lead Seller Resolver",
      email: `${TEST_PREFIX}.lead.seller.resolver@example.com`,
      roleIds: [ctx.sellerRoleId, ctx.interactionsManagerRoleId],
    });
    const sellerResolverAccountId = await createDirectAccount({
      name: `Cuenta ${TEST_PREFIX}_lead_self_assign`,
      ownerUserId: ctx.accountCreateUserId,
      actorUserId: ctx.accountCreateUserId,
    });
    cleanup.accountIds.push(sellerResolverAccountId);
    await query(`DELETE FROM account_owners WHERE account_id = ?`, [
      sellerResolverAccountId,
    ]);
    const sellerResolverContactId = await createDirectContact({
      accountId: sellerResolverAccountId,
      actorUserId: sellerResolverUserId,
      suffix: `${TEST_PREFIX}_lead_self_assign`,
    });
    cleanup.contactIds.push(sellerResolverContactId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.lead.seller.resolver@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead self assign ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Self Assign",
            "Contacto: Mariela Campos",
            "Tema: Seguimiento comercial prioritario",
            "Oportunidad: Plataforma de seguridad administrada",
            "Correo: mariela.campos@self-assign.example.com",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_self_assign_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.id);
    const firstContactSuggestion = createResponse.body.suggestedContacts[0];
    const firstOpportunitySuggestion =
      createResponse.body.suggestedOpportunities[0];

    const resolveResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: createResponse.body.title,
        sourceNotes: createResponse.body.sourceNotes || "",
        summary: createResponse.body.summary,
        topics: createResponse.body.topics,
        actionsTaken: createResponse.body.actionsTaken,
        nextSteps: createResponse.body.nextSteps,
        suggestedAccount: createResponse.body.suggestedAccount,
        suggestedContacts: createResponse.body.suggestedContacts,
        suggestedOpportunities: createResponse.body.suggestedOpportunities,
        assignCurrentUserAsOwnerSeller: true,
        accountResolution: {
          mode: "link_existing",
          accountId: sellerResolverAccountId,
        },
        contactResolutions: [
          {
            suggestionId: firstContactSuggestion.suggestionId,
            mode: "link_existing",
            contactId: sellerResolverContactId,
          },
        ],
        opportunityResolutions: [
          {
            suggestionId: firstOpportunitySuggestion.suggestionId,
            mode: "create_new",
            isPrimary: true,
            draft: {
              name:
                firstOpportunitySuggestion.name ||
                `Oportunidad self assign ${TEST_PREFIX}`,
              contactId: sellerResolverContactId,
              amountUsd: 99000,
              closeDate: "2026-07-30",
              businessLineId: ctx.catalogIds.businessLineId,
              sellerUserId: sellerResolverUserId,
              presalesUserId: null,
              summary:
                firstOpportunitySuggestion.summary ||
                "Oportunidad creada tras autoasignacion explicita del vendedor.",
            },
          },
        ],
      });

    expect(resolveResponse.status).toBe(200);
    expect(resolveResponse.body.analysisStatus).toBe("lead_qualified");
    expect(resolveResponse.body.sellerUserId).toBe(sellerResolverUserId);
    expect(resolveResponse.body.opportunities).toHaveLength(1);
    cleanup.opportunityIds.push(resolveResponse.body.opportunities[0].id);

    const ownerRows = await query(
      `SELECT user_id
       FROM account_owners
       WHERE account_id = ?
         AND user_id = ?`,
      [sellerResolverAccountId, sellerResolverUserId],
    );
    expect(ownerRows).toHaveLength(1);
  });

  test("interacciones permite agregar mas archivos a una interaccion existente", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Interaccion append docs ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Delta",
            "Contacto: Laura Perez",
            "Tema: Sesion inicial de discovery",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_append_initial_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.documents).toHaveLength(1);

    const interactionId = Number(createResponse.body.id);

    const appendResponse = await request(app)
      .post(`/api/interactions/${interactionId}/documents`)
      .set("Authorization", `Bearer ${token}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Delta",
            "Contacto: Laura Perez",
            "Tema: Solicitud de propuesta tecnica",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_append_extra_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      )
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Delta",
            "Contacto: Laura Perez",
            "Proximo paso: Agendar demo ejecutiva",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_append_followup_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(appendResponse.status).toBe(201);
    expect(appendResponse.body.analysisStatus).toBe("created");
    expect(appendResponse.body.processingStatus).toBe("analyzed");
    expect(appendResponse.body.documents).toHaveLength(3);
    expect(
      appendResponse.body.documents.map(
        (document) => document.originalFileName,
      ),
    ).toEqual(
      expect.arrayContaining([
        `interaction_append_initial_${TEST_PREFIX}.txt`,
        `interaction_append_extra_${TEST_PREFIX}.txt`,
        `interaction_append_followup_${TEST_PREFIX}.txt`,
      ]),
    );

    const documentRows = await query(
      `SELECT COUNT(*) AS total
       FROM documents
       WHERE entity_type = 'interaction'
         AND entity_id = ?
         AND is_deleted = 0`,
      [interactionId],
    );
    expect(Number(documentRows[0]?.total || 0)).toBe(3);
  });

  test("interacciones permite eliminar una interacción no resuelta", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Interaccion delete ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Delta",
            "Contacto: Julia Soto",
            "Tema: Servicio de monitoreo",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_delete_full_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.id);

    const deleteResponse = await request(app)
      .delete(`/api/interactions/${interactionId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.message).toBe("Interacción eliminada");

    const interactionRows = await query(
      `SELECT id FROM interactions WHERE id = ? LIMIT 1`,
      [interactionId],
    );
    expect(interactionRows).toHaveLength(0);

    const documentRows = await query(
      `SELECT id
       FROM documents
       WHERE entity_type = 'interaction' AND entity_id = ?
       LIMIT 1`,
      [interactionId],
    );
    expect(documentRows).toHaveLength(0);
  });

  test("interacciones bloquea eliminar un lead calificado", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Interaccion delete blocked ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Epsilon Seguridad",
            "Contacto: Laura Perez",
            "Tema: Servicios administrados de seguridad",
            "Oportunidad: Servicios de seguridad administrada Epsilon",
            "Correo: laura.perez@epsilon.example.com",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_delete_blocked_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.id);
    const firstContactSuggestion = createResponse.body.suggestedContacts[0];
    const firstOpportunitySuggestion =
      createResponse.body.suggestedOpportunities[0];

    const resolveResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: createResponse.body.title,
        sourceNotes: createResponse.body.sourceNotes || "",
        summary: createResponse.body.summary,
        topics: createResponse.body.topics,
        actionsTaken: createResponse.body.actionsTaken,
        nextSteps: createResponse.body.nextSteps,
        suggestedAccount: createResponse.body.suggestedAccount,
        suggestedContacts: createResponse.body.suggestedContacts,
        suggestedOpportunities: createResponse.body.suggestedOpportunities,
        sellerUserId: ctx.sellerUserId,
        accountResolution: {
          mode: "link_existing",
          accountId: ctx.fixtureAccountId,
        },
        contactResolutions: [
          {
            suggestionId: firstContactSuggestion.suggestionId,
            mode: "link_existing",
            contactId: ctx.fixtureContactId,
          },
        ],
        opportunityResolutions: [
          {
            suggestionId: firstOpportunitySuggestion.suggestionId,
            mode: "create_new",
            isPrimary: true,
            draft: {
              name:
                firstOpportunitySuggestion.name ||
                `Oportunidad delete blocked ${TEST_PREFIX}`,
              contactId: null,
              amountUsd: 125000,
              closeDate: "2026-07-15",
              businessLineId: ctx.catalogIds.businessLineId,
              sellerUserId: ctx.sellerUserId,
              presalesUserId: null,
              summary:
                firstOpportunitySuggestion.summary ||
                "Propuesta derivada desde interacción top-level.",
            },
          },
        ],
      });

    expect(resolveResponse.status).toBe(200);
    cleanup.accountIds.push(resolveResponse.body.accountId);
    cleanup.contactIds.push(resolveResponse.body.contacts[0].id);
    cleanup.opportunityIds.push(resolveResponse.body.opportunities[0].id);

    const deleteResponse = await request(app)
      .delete(`/api/interactions/${interactionId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(deleteResponse.status).toBe(409);
    expect(deleteResponse.body.message).toBe(
      "No puedes eliminar un lead calificado",
    );

    const interactionRows = await query(
      `SELECT id FROM interactions WHERE id = ? LIMIT 1`,
      [interactionId],
    );
    expect(interactionRows).toHaveLength(1);
  });

  test("interacciones resuelve cuenta, contacto y oportunidad sin duplicar la fuente documental", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Resolucion top-level ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Beta Seguridad",
            "Contacto: Laura Perez",
            "Tema: Servicios administrados de seguridad",
            "Accion realizada: Demo tecnica inicial",
            "Proximo paso: Preparar propuesta economica",
            "Oportunidad: Servicios de seguridad administrada Beta",
            "Correo: laura.perez@beta.example.com",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_resolve_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.id);
    const firstContactSuggestion = createResponse.body.suggestedContacts[0];
    const firstOpportunitySuggestion =
      createResponse.body.suggestedOpportunities[0];

    const resolveResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: createResponse.body.title,
        sourceNotes: createResponse.body.sourceNotes || "",
        summary: createResponse.body.summary,
        topics: createResponse.body.topics,
        actionsTaken: createResponse.body.actionsTaken,
        nextSteps: createResponse.body.nextSteps,
        suggestedAccount: createResponse.body.suggestedAccount,
        suggestedContacts: createResponse.body.suggestedContacts,
        suggestedOpportunities: createResponse.body.suggestedOpportunities,
        sellerUserId: ctx.sellerUserId,
        accountResolution: {
          mode: "link_existing",
          accountId: ctx.fixtureAccountId,
        },
        contactResolutions: [
          {
            suggestionId: firstContactSuggestion.suggestionId,
            mode: "create_new",
            draft: {
              firstName: firstContactSuggestion.firstName || "Laura",
              lastName: firstContactSuggestion.lastName || "Perez",
              email:
                firstContactSuggestion.email ||
                `laura.perez.${TEST_PREFIX}@beta.example.com`,
              phone: firstContactSuggestion.phone || "",
              mobile: firstContactSuggestion.mobile || "",
              positionTitle: firstContactSuggestion.positionTitle || "Compras",
              department: firstContactSuggestion.department || "",
              countryId: null,
              stateRegion: "",
              city: "",
            },
          },
        ],
        opportunityResolutions: [
          {
            suggestionId: firstOpportunitySuggestion.suggestionId,
            mode: "create_new",
            isPrimary: true,
            draft: {
              name:
                firstOpportunitySuggestion.name ||
                `Oportunidad derivada ${TEST_PREFIX}`,
              contactId: null,
              amountUsd: 125000,
              closeDate: "2026-07-15",
              businessLineId: ctx.catalogIds.businessLineId,
              sellerUserId: ctx.sellerUserId,
              presalesUserId: null,
              summary:
                firstOpportunitySuggestion.summary ||
                "Propuesta derivada desde interacción top-level.",
            },
          },
        ],
      });

    expect(resolveResponse.status).toBe(200);
    expect(resolveResponse.body.analysisStatus).toBe("lead_qualified");
    expect(resolveResponse.body.accountId).not.toBeNull();
    expect(resolveResponse.body.contacts).toHaveLength(1);
    expect(resolveResponse.body.opportunities).toHaveLength(1);
    expect(resolveResponse.body.opportunities[0].isPrimary).toBe(true);
    cleanup.contactIds.push(resolveResponse.body.contacts[0].id);
    cleanup.opportunityIds.push(resolveResponse.body.opportunities[0].id);

    expect(resolveResponse.body.suggestedAccount?.selectedAccountId).toBe(
      ctx.fixtureAccountId,
    );
    expect(resolveResponse.body.suggestedContacts?.[0]?.selectedContactId).toBe(
      resolveResponse.body.contacts[0].id,
    );
    expect(
      resolveResponse.body.suggestedOpportunities?.[0]?.selectedOpportunityId,
    ).toBe(resolveResponse.body.opportunities[0].id);

    const persistedDetailResponse = await request(app)
      .get(`/api/interactions/${interactionId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(persistedDetailResponse.status).toBe(200);
    expect(
      persistedDetailResponse.body.suggestedAccount?.selectedAccountId,
    ).toBe(ctx.fixtureAccountId);
    expect(
      persistedDetailResponse.body.suggestedContacts?.[0]?.selectedContactId,
    ).toBe(resolveResponse.body.contacts[0].id);
    expect(
      persistedDetailResponse.body.suggestedOpportunities?.[0]
        ?.selectedOpportunityId,
    ).toBe(resolveResponse.body.opportunities[0].id);

    const linkedDocsRows = await query(
      `SELECT odl.id
       FROM opportunity_document_links odl
       INNER JOIN documents d ON d.id = odl.document_id
       WHERE odl.opportunity_id = ?
         AND d.entity_type = 'interaction'
         AND d.entity_id = ?`,
      [resolveResponse.body.opportunities[0].id, interactionId],
    );
    expect(linkedDocsRows.length).toBeGreaterThan(0);

    const [interactionRow] = await query(
      `SELECT account_id, primary_opportunity_id, analysis_status
       FROM interactions
       WHERE id = ?
       LIMIT 1`,
      [interactionId],
    );
    expect(Number(interactionRow.account_id)).toBe(
      resolveResponse.body.accountId,
    );
    expect(Number(interactionRow.primary_opportunity_id)).toBe(
      resolveResponse.body.opportunities[0].id,
    );
    expect(interactionRow.analysis_status).toBe("lead_qualified");
  });

  test("oportunidades.status desactiva y limpia vinculacion de lead originador", async () => {
    const suffix = `${TEST_PREFIX}_lead_rollback_on_deactivate_${Date.now()}`;
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
    const token = loginResponse.body.token;

    const now = new Date();
    const opportunityInsert = await query(
      `INSERT INTO opportunities
        (name, amount_usd, account_id, close_date, contact_id,
         sales_stage_id, business_line_id, seller_user_id, presales_user_id,
         activation_status_id, commercial_status_id,
         created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `Oportunidad rollback ${suffix}`,
        52000,
        accountId,
        "2026-12-31",
        contactId,
        ctx.catalogIds.salesStageInitialId,
        ctx.catalogIds.businessLineId,
        ctx.sellerUserId,
        null,
        ctx.catalogIds.opportunityActiveStatusId,
        ctx.catalogIds.opportunityCommercialInProgressStatusId,
        ctx.opportunityFlowUserId,
        now,
        ctx.opportunityFlowUserId,
        now,
      ],
    );
    const opportunityId = Number(opportunityInsert.insertId);
    cleanup.opportunityIds.push(opportunityId);

    const interactionPublicId = `lead_rb_${TEST_PREFIX}_${Date.now()}`;
    const suggestedOpportunities = [
      {
        suggestionId: `opp_suggestion_${TEST_PREFIX}`,
        name: `Oportunidad sugerida ${TEST_PREFIX}`,
        resolutionMode: "create_new",
        selectedOpportunityId: opportunityId,
      },
    ];

    const interactionInsert = await query(
      `INSERT INTO interactions
        (public_id, title, lead_source, source_notes, summary, analysis_status,
         warnings_json, topics_json, actions_taken_json, next_steps_json,
         suggested_account_json, suggested_contacts_json, suggested_opportunities_json,
         account_id, primary_opportunity_id, resolved_at,
         created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, 'otro', NULL, ?, 'lead_qualified', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        interactionPublicId,
        `Lead rollback oportunidad ${TEST_PREFIX}`,
        "Lead de prueba para rollback por desactivacion",
        JSON.stringify([]),
        JSON.stringify([]),
        JSON.stringify([]),
        JSON.stringify([]),
        JSON.stringify({ selectedAccountId: accountId }),
        JSON.stringify([
          {
            suggestionId: `contact_suggestion_${TEST_PREFIX}`,
            fullName: "Contacto demo",
            resolutionMode: "link_existing",
            selectedContactId: contactId,
          },
        ]),
        JSON.stringify(suggestedOpportunities),
        accountId,
        opportunityId,
        now,
        ctx.opportunityFlowUserId,
        ctx.opportunityFlowUserId,
        now,
        now,
      ],
    );
    const interactionId = Number(interactionInsert.insertId);

    await query(
      `INSERT INTO interaction_contact_links (interaction_id, contact_id, created_at)
       VALUES (?, ?, NOW(3))`,
      [interactionId, contactId],
    );
    await query(
      `INSERT INTO interaction_opportunity_links (interaction_id, opportunity_id, is_primary, created_at)
       VALUES (?, ?, 1, NOW(3))`,
      [interactionId, opportunityId],
    );

    const deactivateResponse = await request(app)
      .patch(`/api/opportunities/${opportunityId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ statusCode: "desactivada" });

    expect(deactivateResponse.status).toBe(200);
    expect(deactivateResponse.body.message).toBe("Oportunidad desactivada");

    const [interactionRow] = await query(
      `SELECT analysis_status, primary_opportunity_id, suggested_opportunities_json
       FROM interactions
       WHERE id = ?
       LIMIT 1`,
      [interactionId],
    );
    expect(interactionRow.analysis_status).toBe("lead_assigned");
    expect(interactionRow.primary_opportunity_id).toBeNull();

    const persistedSuggestedOpportunities = JSON.parse(
      interactionRow.suggested_opportunities_json || "[]",
    );
    expect(
      persistedSuggestedOpportunities.some(
        (item) => Number(item?.selectedOpportunityId || 0) === opportunityId,
      ),
    ).toBe(false);

    const [linkCountRow] = await query(
      `SELECT COUNT(*) AS total
       FROM interaction_opportunity_links
       WHERE interaction_id = ?
         AND opportunity_id = ?`,
      [interactionId, opportunityId],
    );
    expect(Number(linkCountRow.total)).toBe(0);
  });

  test("interacciones marca lead no asignado cuando vincula cuenta y contacto sin vendedor", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead asignado ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Gamma Infraestructura",
            "Contacto: Luis Gomez",
            "Tema: Seguimiento comercial de infraestructura",
            "Correo: luis.gomez@gamma.example.com",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_assigned_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.id);
    const firstContactSuggestion = createResponse.body.suggestedContacts[0];

    const resolveResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: createResponse.body.title,
        sourceNotes: createResponse.body.sourceNotes || "",
        summary: createResponse.body.summary,
        topics: createResponse.body.topics,
        actionsTaken: createResponse.body.actionsTaken,
        nextSteps: createResponse.body.nextSteps,
        suggestedAccount: createResponse.body.suggestedAccount,
        suggestedContacts: createResponse.body.suggestedContacts,
        suggestedOpportunities: createResponse.body.suggestedOpportunities,
        accountResolution: {
          mode: "link_existing",
          accountId: ctx.fixtureAccountId,
        },
        contactResolutions: [
          {
            suggestionId: firstContactSuggestion.suggestionId,
            mode: "link_existing",
            contactId: ctx.fixtureContactId,
          },
        ],
        opportunityResolutions: [],
      });

    expect(resolveResponse.status).toBe(200);
    expect(resolveResponse.body.analysisStatus).toBe("lead_unassigned");
    expect(resolveResponse.body.accountId).toBe(ctx.fixtureAccountId);
    expect(resolveResponse.body.contacts).toHaveLength(1);
    expect(resolveResponse.body.opportunities).toHaveLength(0);

    const [interactionRow] = await query(
      `SELECT account_id, primary_opportunity_id, analysis_status, seller_user_id
       FROM interactions
       WHERE id = ?
       LIMIT 1`,
      [interactionId],
    );
    expect(Number(interactionRow.account_id)).toBe(ctx.fixtureAccountId);
    expect(interactionRow.primary_opportunity_id).toBeNull();
    expect(interactionRow.seller_user_id).toBeNull();
    expect(interactionRow.analysis_status).toBe("lead_unassigned");
  });

  test("interacciones marca lead asignado cuando vincula cuenta y contacto con vendedor", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead asignado con vendedor ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Gamma Infraestructura",
            "Contacto: Luis Gomez",
            "Tema: Seguimiento comercial de infraestructura",
            "Correo: luis.gomez@gamma.example.com",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_assigned_seller_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.id);
    const firstContactSuggestion = createResponse.body.suggestedContacts[0];

    const resolveResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: createResponse.body.title,
        sourceNotes: createResponse.body.sourceNotes || "",
        summary: createResponse.body.summary,
        topics: createResponse.body.topics,
        actionsTaken: createResponse.body.actionsTaken,
        nextSteps: createResponse.body.nextSteps,
        suggestedAccount: createResponse.body.suggestedAccount,
        suggestedContacts: createResponse.body.suggestedContacts,
        suggestedOpportunities: createResponse.body.suggestedOpportunities,
        accountResolution: {
          mode: "link_existing",
          accountId: ctx.fixtureAccountId,
        },
        contactResolutions: [
          {
            suggestionId: firstContactSuggestion.suggestionId,
            mode: "link_existing",
            contactId: ctx.fixtureContactId,
          },
        ],
        sellerUserId: ctx.sellerUserId,
        opportunityResolutions: [],
      });

    expect(resolveResponse.status).toBe(200);
    expect(resolveResponse.body.analysisStatus).toBe("lead_assigned");
    expect(resolveResponse.body.accountId).toBe(ctx.fixtureAccountId);
    expect(resolveResponse.body.contacts).toHaveLength(1);
    expect(resolveResponse.body.opportunities).toHaveLength(0);

    const [interactionRow] = await query(
      `SELECT account_id, primary_opportunity_id, analysis_status, seller_user_id
       FROM interactions
       WHERE id = ?
       LIMIT 1`,
      [interactionId],
    );
    expect(Number(interactionRow.account_id)).toBe(ctx.fixtureAccountId);
    expect(interactionRow.primary_opportunity_id).toBeNull();
    expect(Number(interactionRow.seller_user_id)).toBe(ctx.sellerUserId);
    expect(interactionRow.analysis_status).toBe("lead_assigned");
  });

  test("interacciones conserva resoluciones ignoradas al reabrir el lead", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead ignored resolution ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Delta Seguridad",
            "Contacto: Diana Hernandez",
            "Tema: Seguimiento comercial de seguridad",
            "Correo: diana.hernandez@delta.example.com",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_ignore_resolution_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.id);
    const firstContactSuggestion = createResponse.body.suggestedContacts[0];

    const resolveResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: createResponse.body.title,
        sourceNotes: createResponse.body.sourceNotes || "",
        summary: createResponse.body.summary,
        topics: createResponse.body.topics,
        actionsTaken: createResponse.body.actionsTaken,
        nextSteps: createResponse.body.nextSteps,
        suggestedAccount: createResponse.body.suggestedAccount,
        suggestedContacts: createResponse.body.suggestedContacts,
        suggestedOpportunities: createResponse.body.suggestedOpportunities,
        accountResolution: {
          mode: "ignore",
        },
        contactResolutions: [
          {
            suggestionId: firstContactSuggestion.suggestionId,
            mode: "ignore",
          },
        ],
        opportunityResolutions: [],
      });

    expect(resolveResponse.status).toBe(200);
    expect(
      resolveResponse.body.suggestedContacts?.[0]?.selectedContactId,
    ).toBeNull();
    expect(resolveResponse.body.suggestedContacts?.[0]?.resolutionMode).toBe(
      "ignore",
    );

    const persistedDetailResponse = await request(app)
      .get(`/api/interactions/${interactionId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(persistedDetailResponse.status).toBe(200);
    expect(
      persistedDetailResponse.body.suggestedContacts?.[0]?.selectedContactId,
    ).toBeNull();
    expect(
      persistedDetailResponse.body.suggestedContacts?.[0]?.resolutionMode,
    ).toBe("ignore");
  });

  test("interacciones expone politica self_only para vendedor que creo el lead", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.self@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead self only ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Sigma Seguridad",
            "Contacto: Sofia Ibarra",
            "Correo: sofia.ibarra@sigma.example.com",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_self_only_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.createdById).toBe(
      ctx.interactionsSelfAssignUserId,
    );
    expect(createResponse.body.commercialAssignmentPolicy).toMatchObject({
      mode: "self_only",
      locked: true,
      allowedSellerUserId: ctx.interactionsSelfAssignUserId,
    });

    const detailResponse = await request(app)
      .get(`/api/interactions/${createResponse.body.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.createdById).toBe(
      ctx.interactionsSelfAssignUserId,
    );
    expect(detailResponse.body.commercialAssignmentPolicy).toMatchObject({
      mode: "self_only",
      locked: true,
      allowedSellerUserId: ctx.interactionsSelfAssignUserId,
    });
  });

  test("interacciones resolution-options expone todos los vendedores activos para usuarios con assign_any", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const response = await request(app)
      .get(
        `/api/interactions/resolution-options?accountId=${ctx.fixtureAccountId}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.sellerUsers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: ctx.sellerUserId }),
        expect.objectContaining({ id: ctx.sellerAltUserId }),
      ]),
    );
  });

  test("interacciones assign_any permite reasignar el lead a cualquier vendedor activo", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead assign any ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Assign Any",
            "Contacto: Laura Admin",
            "Correo: laura.admin@assign-any.example.com",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_assign_any_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.id);
    const firstContactSuggestion = createResponse.body.suggestedContacts[0];

    const resolveResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: createResponse.body.title,
        sourceNotes: createResponse.body.sourceNotes || "",
        summary: createResponse.body.summary,
        topics: createResponse.body.topics,
        actionsTaken: createResponse.body.actionsTaken,
        nextSteps: createResponse.body.nextSteps,
        suggestedAccount: createResponse.body.suggestedAccount,
        suggestedContacts: createResponse.body.suggestedContacts,
        suggestedOpportunities: createResponse.body.suggestedOpportunities,
        sellerUserId: ctx.sellerAltUserId,
        accountResolution: {
          mode: "link_existing",
          accountId: ctx.fixtureAccountId,
        },
        contactResolutions: [
          {
            suggestionId: firstContactSuggestion.suggestionId,
            mode: "link_existing",
            contactId: ctx.fixtureContactId,
          },
        ],
        opportunityResolutions: [],
      });

    expect(resolveResponse.status).toBe(200);
    expect(resolveResponse.body.sellerUserId).toBe(ctx.sellerAltUserId);
    expect(resolveResponse.body.commercialAssignmentPolicy).toMatchObject({
      mode: "any",
      locked: false,
      allowedSellerUserId: null,
    });
  });

  test("interacciones assign_any bloquea desasignar un lead que ya tenia vendedor", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead assign any keep seller ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Assign Any Keep Seller",
            "Contacto: Laura Keep",
            "Correo: laura.keep@assign-any.example.com",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_assign_any_keep_seller_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.id);
    const firstContactSuggestion = createResponse.body.suggestedContacts[0];

    const initialResolveResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: createResponse.body.title,
        sourceNotes: createResponse.body.sourceNotes || "",
        summary: createResponse.body.summary,
        topics: createResponse.body.topics,
        actionsTaken: createResponse.body.actionsTaken,
        nextSteps: createResponse.body.nextSteps,
        suggestedAccount: createResponse.body.suggestedAccount,
        suggestedContacts: createResponse.body.suggestedContacts,
        suggestedOpportunities: createResponse.body.suggestedOpportunities,
        sellerUserId: ctx.sellerAltUserId,
        accountResolution: {
          mode: "link_existing",
          accountId: ctx.fixtureAccountId,
        },
        contactResolutions: [
          {
            suggestionId: firstContactSuggestion.suggestionId,
            mode: "link_existing",
            contactId: ctx.fixtureContactId,
          },
        ],
        opportunityResolutions: [],
      });

    expect(initialResolveResponse.status).toBe(200);
    expect(initialResolveResponse.body.sellerUserId).toBe(ctx.sellerAltUserId);

    const reopenResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: initialResolveResponse.body.title,
        sourceNotes: initialResolveResponse.body.sourceNotes || "",
        summary: initialResolveResponse.body.summary,
        topics: initialResolveResponse.body.topics,
        actionsTaken: initialResolveResponse.body.actionsTaken,
        nextSteps: initialResolveResponse.body.nextSteps,
        suggestedAccount: initialResolveResponse.body.suggestedAccount,
        suggestedContacts: initialResolveResponse.body.suggestedContacts,
        suggestedOpportunities:
          initialResolveResponse.body.suggestedOpportunities,
        sellerUserId: null,
        accountResolution: {
          mode: "link_existing",
          accountId: ctx.fixtureAccountId,
        },
        contactResolutions: [
          {
            suggestionId: firstContactSuggestion.suggestionId,
            mode: "link_existing",
            contactId: ctx.fixtureContactId,
          },
        ],
        opportunityResolutions: [],
      });

    expect(reopenResponse.status).toBe(409);
    expect(reopenResponse.body.message).toContain(
      "no puede eliminarse desde este lead",
    );
  });

  test("interacciones oculta en la lista al creador un lead ya asignado a otro vendedor y lo muestra al vendedor asignado", async () => {
    const creatorLoginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const creatorToken = creatorLoginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${creatorToken}`)
      .field("title", `Lead assigned visibility ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Assigned Visibility",
            "Contacto: Andrea Scope",
            "Correo: andrea.scope@example.com",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_assigned_visibility_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.id);
    const firstContactSuggestion = createResponse.body.suggestedContacts[0];

    const assignResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({
        title: createResponse.body.title,
        sourceNotes: createResponse.body.sourceNotes || "",
        summary: createResponse.body.summary,
        topics: createResponse.body.topics,
        actionsTaken: createResponse.body.actionsTaken,
        nextSteps: createResponse.body.nextSteps,
        suggestedAccount: createResponse.body.suggestedAccount,
        suggestedContacts: createResponse.body.suggestedContacts,
        suggestedOpportunities: createResponse.body.suggestedOpportunities,
        sellerUserId: ctx.interactionsSelfAssignUserId,
        accountResolution: {
          mode: "link_existing",
          accountId: ctx.fixtureAccountId,
        },
        contactResolutions: [
          {
            suggestionId: firstContactSuggestion.suggestionId,
            mode: "link_existing",
            contactId: ctx.fixtureContactId,
          },
        ],
        opportunityResolutions: [],
      });

    expect(assignResponse.status).toBe(200);
    expect(assignResponse.body.sellerUserId).toBe(
      ctx.interactionsSelfAssignUserId,
    );
    expect(assignResponse.body.analysisStatus).toBe("lead_assigned");

    const creatorListResponse = await request(app)
      .get("/api/interactions")
      .set("Authorization", `Bearer ${creatorToken}`);

    expect(creatorListResponse.status).toBe(200);
    expect(
      creatorListResponse.body.items.some(
        (item) => Number(item.id) === interactionId,
      ),
    ).toBe(false);

    const assignedSellerLoginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.self@example.com`,
    );
    const assignedSellerToken = assignedSellerLoginResponse.body.token;

    const assignedSellerListResponse = await request(app)
      .get("/api/interactions")
      .set("Authorization", `Bearer ${assignedSellerToken}`);

    expect(assignedSellerListResponse.status).toBe(200);
    expect(
      assignedSellerListResponse.body.items.some(
        (item) => Number(item.id) === interactionId,
      ),
    ).toBe(true);
  });

  test("interacciones self_only autoasigna al vendedor creador y bloquea cambiar asignacion al reabrir", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.self@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead self assigned ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Tau Seguridad",
            "Contacto: Tomas Vela",
            "Correo: tomas.vela@tau.example.com",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_self_assign_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.id);
    const firstContactSuggestion = createResponse.body.suggestedContacts[0];

    const initialResolveResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: createResponse.body.title,
        sourceNotes: createResponse.body.sourceNotes || "",
        summary: createResponse.body.summary,
        topics: createResponse.body.topics,
        actionsTaken: createResponse.body.actionsTaken,
        nextSteps: createResponse.body.nextSteps,
        suggestedAccount: createResponse.body.suggestedAccount,
        suggestedContacts: createResponse.body.suggestedContacts,
        suggestedOpportunities: createResponse.body.suggestedOpportunities,
        accountResolution: {
          mode: "link_existing",
          accountId: ctx.fixtureAccountId,
        },
        contactResolutions: [
          {
            suggestionId: firstContactSuggestion.suggestionId,
            mode: "link_existing",
            contactId: ctx.fixtureContactId,
          },
        ],
        opportunityResolutions: [],
      });

    expect(initialResolveResponse.status).toBe(200);
    expect(initialResolveResponse.body.sellerUserId).toBe(
      ctx.interactionsSelfAssignUserId,
    );
    expect(
      initialResolveResponse.body.commercialAssignmentPolicy,
    ).toMatchObject({
      mode: "self_only",
      locked: true,
      allowedSellerUserId: ctx.interactionsSelfAssignUserId,
    });

    const reopenResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: initialResolveResponse.body.title,
        sourceNotes: initialResolveResponse.body.sourceNotes || "",
        summary: initialResolveResponse.body.summary,
        topics: initialResolveResponse.body.topics,
        actionsTaken: initialResolveResponse.body.actionsTaken,
        nextSteps: initialResolveResponse.body.nextSteps,
        suggestedAccount: initialResolveResponse.body.suggestedAccount,
        suggestedContacts: initialResolveResponse.body.suggestedContacts,
        suggestedOpportunities:
          initialResolveResponse.body.suggestedOpportunities,
        sellerUserId: ctx.sellerAltUserId,
        accountResolution: {
          mode: "link_existing",
          accountId: initialResolveResponse.body.accountId,
        },
        contactResolutions: [
          {
            suggestionId:
              initialResolveResponse.body.suggestedContacts[0].suggestionId,
            mode: "link_existing",
            contactId: initialResolveResponse.body.contacts[0].id,
          },
        ],
        opportunityResolutions: [],
      });

    expect(reopenResponse.status).toBe(403);
    expect(reopenResponse.body.message).toBe(
      "Solo puedes asignarte a ti mismo en leads creados por ti",
    );
  });

  function buildInteractionResolvePayload(detail, overrides = {}) {
    return {
      title: detail.title,
      sourceNotes: detail.sourceNotes || "",
      summary: detail.summary,
      topics: detail.topics,
      actionsTaken: detail.actionsTaken,
      nextSteps: detail.nextSteps,
      suggestedAccount: detail.suggestedAccount,
      suggestedContacts: detail.suggestedContacts,
      suggestedOpportunities: detail.suggestedOpportunities,
      ...overrides,
    };
  }

  async function createExistingOpportunityForLead({
    accountId,
    contactId,
    actorUserId,
    suffix,
    name,
  }) {
    const now = new Date();
    const insertResult = await query(
      `INSERT INTO opportunities
        (name, amount_usd, account_id, close_date, contact_id,
         sales_stage_id, business_line_id, seller_user_id, presales_user_id, activation_status_id,
         commercial_status_id, created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name || `Oportunidad lead bloqueado ${suffix}`,
        48000,
        accountId,
        "2026-12-31",
        contactId,
        ctx.catalogIds.salesStageInitialId,
        ctx.catalogIds.businessLineId,
        ctx.sellerUserId,
        null,
        ctx.catalogIds.opportunityActiveStatusId,
        ctx.catalogIds.opportunityCommercialInProgressStatusId,
        actorUserId,
        now,
        actorUserId,
        now,
      ],
    );
    const opportunityId = Number(insertResult.insertId);
    cleanup.opportunityIds.push(opportunityId);
    return opportunityId;
  }

  test("interacciones resolution-options excluye cuentas, contactos y oportunidades inactivas", async () => {
    const inactiveAccountId = await createDirectAccount({
      ownerUserId: ctx.sellerUserId,
      actorUserId: ctx.interactionsManagerUserId,
      suffix: `${TEST_PREFIX}_inactive_resolution_account`,
    });
    cleanup.accountIds.push(inactiveAccountId);
    await query("UPDATE accounts SET activation_status_id = ? WHERE id = ?", [
      ctx.catalogIds.accountPendingStatusId,
      inactiveAccountId,
    ]);

    const inactiveContactId = await createDirectContact({
      accountId: ctx.fixtureAccountId,
      actorUserId: ctx.interactionsManagerUserId,
      suffix: `${TEST_PREFIX}_inactive_resolution_contact`,
    });
    cleanup.contactIds.push(inactiveContactId);
    await query("UPDATE contacts SET activation_status_id = ? WHERE id = ?", [
      ctx.catalogIds.contactInactiveStatusId,
      inactiveContactId,
    ]);

    const inactiveOpportunityId = await createExistingOpportunityForLead({
      accountId: ctx.fixtureAccountId,
      contactId: ctx.fixtureContactId,
      actorUserId: ctx.interactionsManagerUserId,
      suffix: `${TEST_PREFIX}_inactive_resolution_opportunity`,
      name: `Oportunidad inactiva ${TEST_PREFIX}`,
    });
    await query(
      "UPDATE opportunities SET activation_status_id = ? WHERE id = ?",
      [ctx.catalogIds.opportunityInactiveStatusId, inactiveOpportunityId],
    );

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const response = await request(app)
      .get("/api/interactions/resolution-options")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(
      response.body.accounts.some(
        (account) => Number(account.id) === inactiveAccountId,
      ),
    ).toBe(false);
    expect(
      response.body.contacts.some(
        (contact) => Number(contact.id) === inactiveContactId,
      ),
    ).toBe(false);
    expect(
      response.body.opportunities.some(
        (opportunity) => Number(opportunity.id) === inactiveOpportunityId,
      ),
    ).toBe(false);
  });

  test("interacciones avisa si al guardar el lead la cuenta a crear ya existe", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead duplicate account on resolve ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            `Cuenta: Cuenta fixture ${TEST_PREFIX}_fixture`,
            "Contacto: Laura Paz",
            "Correo: laura.paz@duplicate-account.example.com",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_duplicate_account_resolve_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);

    const resolveResponse = await request(app)
      .post(`/api/interactions/${createResponse.body.id}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send(
        buildInteractionResolvePayload(createResponse.body, {
          accountResolution: {
            mode: "create_new",
            draft: {
              name: `Cuenta fixture ${TEST_PREFIX}_fixture`,
              website: "",
              phone: "",
              city: "CDMX",
              stateRegion: "CDMX",
              countryId: ctx.catalogIds.countryMxId,
              description: "Intento de crear una cuenta duplicada desde lead.",
            },
          },
          contactResolutions: [],
          opportunityResolutions: [],
        }),
      );

    expect(resolveResponse.status).toBe(409);
    expect(resolveResponse.body.code).toMatch(/ACCOUNT_DUPLICATE_/);
    expect(resolveResponse.body.duplicateWarnings?.length).toBeGreaterThan(0);
  });

  test("interacciones avisa si al guardar el lead el contacto a crear ya existe", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead duplicate contact on resolve ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Duplicate Contact",
            `Contacto: Contacto Fixture ${TEST_PREFIX}_fixture`,
            `Correo: fixture.${TEST_PREFIX}_fixture@example.com`,
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_duplicate_contact_resolve_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const firstContactSuggestion = createResponse.body.suggestedContacts[0];

    const resolveResponse = await request(app)
      .post(`/api/interactions/${createResponse.body.id}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send(
        buildInteractionResolvePayload(createResponse.body, {
          accountResolution: {
            mode: "link_existing",
            accountId: ctx.fixtureAccountId,
          },
          contactResolutions: [
            {
              suggestionId: firstContactSuggestion.suggestionId,
              mode: "create_new",
              draft: {
                firstName: "Contacto",
                lastName: `Fixture ${TEST_PREFIX}_fixture`,
                email: `fixture.${TEST_PREFIX}_fixture@example.com`,
                phone: "",
                mobile: `555${TEST_PREFIX.slice(-6)}`,
                positionTitle: "Compras",
                department: "Compras",
                countryId: ctx.catalogIds.countryMxId,
                stateRegion: "CDMX",
                city: "Ciudad de Mexico",
              },
            },
          ],
          opportunityResolutions: [],
        }),
      );

    expect(resolveResponse.status).toBe(409);
    expect(resolveResponse.body.code).toBe("CONTACT_DUPLICATE_BLOCKED");
    expect(resolveResponse.body.duplicateWarnings?.length).toBeGreaterThan(0);
  });

  test("interacciones avisa si al guardar el lead la oportunidad a crear ya existe", async () => {
    const duplicateOpportunityId = await createExistingOpportunityForLead({
      accountId: ctx.fixtureAccountId,
      contactId: ctx.fixtureContactId,
      actorUserId: ctx.interactionsManagerUserId,
      suffix: `${TEST_PREFIX}_duplicate_create_check`,
    });

    const duplicateOpportunityRows = await query(
      `SELECT name
       FROM opportunities
       WHERE id = ?
       LIMIT 1`,
      [duplicateOpportunityId],
    );
    const duplicateOpportunityName = duplicateOpportunityRows[0]?.name;

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead duplicate opportunity on resolve ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Duplicate Opportunity",
            "Contacto: Omar Ruiz",
            "Correo: omar.ruiz@duplicate-opportunity.example.com",
            `Oportunidad: ${duplicateOpportunityName}`,
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_duplicate_opportunity_resolve_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const firstContactSuggestion = createResponse.body.suggestedContacts[0];
    const firstOpportunitySuggestion =
      createResponse.body.suggestedOpportunities[0];

    const resolveResponse = await request(app)
      .post(`/api/interactions/${createResponse.body.id}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send(
        buildInteractionResolvePayload(createResponse.body, {
          sellerUserId: ctx.sellerUserId,
          accountResolution: {
            mode: "link_existing",
            accountId: ctx.fixtureAccountId,
          },
          contactResolutions: [
            {
              suggestionId: firstContactSuggestion.suggestionId,
              mode: "link_existing",
              contactId: ctx.fixtureContactId,
            },
          ],
          opportunityResolutions: [
            {
              suggestionId: firstOpportunitySuggestion.suggestionId,
              mode: "create_new",
              isPrimary: true,
              draft: {
                name: duplicateOpportunityName,
                contactId: ctx.fixtureContactId,
                amountUsd: 48000,
                closeDate: "2026-12-31",
                businessLineId: ctx.catalogIds.businessLineId,
                sellerUserId: ctx.sellerUserId,
                presalesUserId: null,
                summary:
                  "Intento de crear una oportunidad duplicada desde lead.",
              },
            },
          ],
        }),
      );

    expect(resolveResponse.status).toBe(409);
    expect(resolveResponse.body.code).toBe("OPPORTUNITY_DUPLICATE_BLOCKED");
    expect(resolveResponse.body.duplicateWarnings?.length).toBeGreaterThan(0);
  });

  test("interacciones avisa si al guardar el lead la oportunidad a crear tiene un nombre muy parecido", async () => {
    await createExistingOpportunityForLead({
      accountId: ctx.fixtureAccountId,
      contactId: ctx.fixtureContactId,
      actorUserId: ctx.interactionsManagerUserId,
      suffix: `${TEST_PREFIX}_duplicate_similar_name`,
      name: "Expansion seguridad administrada Orion",
    });

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead duplicate opportunity similar ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Duplicate Opportunity Similar",
            "Contacto: Omar Ruiz",
            "Correo: omar.ruiz@duplicate-opportunity-similar.example.com",
            "Oportunidad: Expansion de seguridad administrada para Orion",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_duplicate_opportunity_similar_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const firstContactSuggestion = createResponse.body.suggestedContacts[0];
    const firstOpportunitySuggestion =
      createResponse.body.suggestedOpportunities[0];

    const resolveResponse = await request(app)
      .post(`/api/interactions/${createResponse.body.id}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send(
        buildInteractionResolvePayload(createResponse.body, {
          sellerUserId: ctx.sellerUserId,
          accountResolution: {
            mode: "link_existing",
            accountId: ctx.fixtureAccountId,
          },
          contactResolutions: [
            {
              suggestionId: firstContactSuggestion.suggestionId,
              mode: "link_existing",
              contactId: ctx.fixtureContactId,
            },
          ],
          opportunityResolutions: [
            {
              suggestionId: firstOpportunitySuggestion.suggestionId,
              mode: "create_new",
              isPrimary: true,
              draft: {
                name: "Expansion de seguridad administrada para Orion",
                contactId: ctx.fixtureContactId,
                amountUsd: 48000,
                closeDate: "2026-12-31",
                businessLineId: ctx.catalogIds.businessLineId,
                sellerUserId: ctx.sellerUserId,
                presalesUserId: null,
                summary:
                  "Intento de crear una oportunidad con nombre muy parecido desde lead.",
              },
            },
          ],
        }),
      );

    expect(resolveResponse.status).toBe(409);
    expect(resolveResponse.body.code).toBe("OPPORTUNITY_DUPLICATE_BLOCKED");
    expect(resolveResponse.body.duplicateWarnings?.length).toBeGreaterThan(0);
    expect(resolveResponse.body.duplicateWarnings[0].reasonLabel).toBe(
      "Nombre muy parecido en la misma cuenta",
    );
  });

  test("interacciones bloquea recrear una oportunidad ya materializada desde la misma sugerencia", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;
    const isolatedAccountId = await createDirectAccount({
      ownerUserId: ctx.sellerUserId,
      actorUserId: ctx.interactionsManagerUserId,
      suffix: `${TEST_PREFIX}_recreate_opportunity_isolated`,
    });
    cleanup.accountIds.push(isolatedAccountId);
    const isolatedContactId = await createDirectContact({
      accountId: isolatedAccountId,
      actorUserId: ctx.interactionsManagerUserId,
      suffix: `${TEST_PREFIX}_recreate_opportunity_isolated`,
    });
    cleanup.contactIds.push(isolatedContactId);

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead recreate opportunity ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Epsilon Seguridad",
            "Contacto: Elena Ruiz",
            "Tema: Seguimiento comercial de seguridad administrada",
            "Correo: elena.ruiz@epsilon.example.com",
            "Oportunidad: Expansion seguridad administrada Epsilon",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_recreate_opportunity_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.id);
    const firstContactSuggestion = createResponse.body.suggestedContacts[0];
    const firstOpportunitySuggestion =
      createResponse.body.suggestedOpportunities[0];

    const initialResolveResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: createResponse.body.title,
        sourceNotes: createResponse.body.sourceNotes || "",
        summary: createResponse.body.summary,
        topics: createResponse.body.topics,
        actionsTaken: createResponse.body.actionsTaken,
        nextSteps: createResponse.body.nextSteps,
        suggestedAccount: createResponse.body.suggestedAccount,
        suggestedContacts: createResponse.body.suggestedContacts,
        suggestedOpportunities: createResponse.body.suggestedOpportunities,
        sellerUserId: ctx.sellerUserId,
        accountResolution: {
          mode: "link_existing",
          accountId: isolatedAccountId,
        },
        contactResolutions: [
          {
            suggestionId: firstContactSuggestion.suggestionId,
            mode: "link_existing",
            contactId: isolatedContactId,
          },
        ],
        opportunityResolutions: [
          {
            suggestionId: firstOpportunitySuggestion.suggestionId,
            mode: "create_new",
            isPrimary: true,
            draft: {
              name:
                firstOpportunitySuggestion.name ||
                `Oportunidad Epsilon ${TEST_PREFIX}`,
              contactId: null,
              amountUsd: 95000,
              closeDate: "2026-07-20",
              businessLineId: ctx.catalogIds.businessLineId,
              sellerUserId: ctx.sellerUserId,
              presalesUserId: null,
              summary:
                firstOpportunitySuggestion.summary ||
                "Oportunidad creada desde lead para prueba de duplicado.",
            },
          },
        ],
      });

    expect(initialResolveResponse.status).toBe(200);
    cleanup.opportunityIds.push(
      initialResolveResponse.body.opportunities[0].id,
    );

    const recreateResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: initialResolveResponse.body.title,
        sourceNotes: initialResolveResponse.body.sourceNotes || "",
        summary: initialResolveResponse.body.summary,
        topics: initialResolveResponse.body.topics,
        actionsTaken: initialResolveResponse.body.actionsTaken,
        nextSteps: initialResolveResponse.body.nextSteps,
        suggestedAccount: initialResolveResponse.body.suggestedAccount,
        suggestedContacts: initialResolveResponse.body.suggestedContacts,
        suggestedOpportunities:
          initialResolveResponse.body.suggestedOpportunities,
        sellerUserId: ctx.sellerUserId,
        accountResolution: {
          mode: "link_existing",
          accountId: initialResolveResponse.body.accountId,
        },
        contactResolutions: [
          {
            suggestionId:
              initialResolveResponse.body.suggestedContacts[0].suggestionId,
            mode: "link_existing",
            contactId: initialResolveResponse.body.contacts[0].id,
          },
        ],
        opportunityResolutions: [
          {
            suggestionId:
              initialResolveResponse.body.suggestedOpportunities[0]
                .suggestionId,
            mode: "create_new",
            isPrimary: true,
            draft: {
              name: `Duplicado ${TEST_PREFIX}`,
              contactId: initialResolveResponse.body.contacts[0].id,
              amountUsd: 99000,
              closeDate: "2026-08-01",
              businessLineId: ctx.catalogIds.businessLineId,
              sellerUserId: ctx.sellerUserId,
              presalesUserId: null,
              summary: "Intento invalido de recreacion.",
            },
          },
        ],
      });

    expect(recreateResponse.status).toBe(409);
    expect(recreateResponse.body.message).toBe(
      "La oportunidad sugerida ya fue materializada y no puede modificarse desde este lead",
    );

    const opportunityRows = await query(
      `SELECT id
       FROM opportunities
       WHERE account_id = ?
         AND name = ?`,
      [isolatedAccountId, `Duplicado ${TEST_PREFIX}`],
    );
    expect(opportunityRows).toHaveLength(0);
  });

  test("interacciones bloquea recrear una cuenta ya materializada desde la misma sugerencia", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead recreate account ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Zeta Seguridad",
            "Contacto: Zoe Lara",
            "Correo: zoe.lara@zeta.example.com",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_recreate_account_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.id);

    const initialResolveResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: createResponse.body.title,
        sourceNotes: createResponse.body.sourceNotes || "",
        summary: createResponse.body.summary,
        topics: createResponse.body.topics,
        actionsTaken: createResponse.body.actionsTaken,
        nextSteps: createResponse.body.nextSteps,
        suggestedAccount: createResponse.body.suggestedAccount,
        suggestedContacts: createResponse.body.suggestedContacts,
        suggestedOpportunities: createResponse.body.suggestedOpportunities,
        accountResolution: {
          mode: "link_existing",
          accountId: ctx.fixtureAccountId,
        },
        contactResolutions: [],
        opportunityResolutions: [],
      });

    expect(initialResolveResponse.status).toBe(200);

    const recreateResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: initialResolveResponse.body.title,
        sourceNotes: initialResolveResponse.body.sourceNotes || "",
        summary: initialResolveResponse.body.summary,
        topics: initialResolveResponse.body.topics,
        actionsTaken: initialResolveResponse.body.actionsTaken,
        nextSteps: initialResolveResponse.body.nextSteps,
        suggestedAccount: initialResolveResponse.body.suggestedAccount,
        suggestedContacts: initialResolveResponse.body.suggestedContacts,
        suggestedOpportunities:
          initialResolveResponse.body.suggestedOpportunities,
        accountResolution: {
          mode: "create_new",
          draft: {
            name: `Duplicado cuenta ${TEST_PREFIX}`,
            website: "",
            phone: "",
            city: "",
            stateRegion: "",
            countryId: null,
            description: "",
          },
        },
        contactResolutions: [],
        opportunityResolutions: [],
      });

    expect(recreateResponse.status).toBe(409);
    expect(recreateResponse.body.message).toBe(
      "La cuenta sugerida ya fue materializada y no puede modificarse desde este lead",
    );
  });

  test("interacciones bloquea recrear un contacto ya materializado desde la misma sugerencia", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead recreate contact ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Eta Seguridad",
            "Contacto: Elisa Neri",
            "Correo: elisa.neri@eta.example.com",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_recreate_contact_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.id);
    const firstContactSuggestion = createResponse.body.suggestedContacts[0];

    const initialResolveResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: createResponse.body.title,
        sourceNotes: createResponse.body.sourceNotes || "",
        summary: createResponse.body.summary,
        topics: createResponse.body.topics,
        actionsTaken: createResponse.body.actionsTaken,
        nextSteps: createResponse.body.nextSteps,
        suggestedAccount: createResponse.body.suggestedAccount,
        suggestedContacts: createResponse.body.suggestedContacts,
        suggestedOpportunities: createResponse.body.suggestedOpportunities,
        accountResolution: {
          mode: "link_existing",
          accountId: ctx.fixtureAccountId,
        },
        contactResolutions: [
          {
            suggestionId: firstContactSuggestion.suggestionId,
            mode: "link_existing",
            contactId: ctx.fixtureContactId,
          },
        ],
        opportunityResolutions: [],
      });

    expect(initialResolveResponse.status).toBe(200);

    const recreateResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: initialResolveResponse.body.title,
        sourceNotes: initialResolveResponse.body.sourceNotes || "",
        summary: initialResolveResponse.body.summary,
        topics: initialResolveResponse.body.topics,
        actionsTaken: initialResolveResponse.body.actionsTaken,
        nextSteps: initialResolveResponse.body.nextSteps,
        suggestedAccount: initialResolveResponse.body.suggestedAccount,
        suggestedContacts: initialResolveResponse.body.suggestedContacts,
        suggestedOpportunities:
          initialResolveResponse.body.suggestedOpportunities,
        accountResolution: {
          mode: "link_existing",
          accountId: ctx.fixtureAccountId,
        },
        contactResolutions: [
          {
            suggestionId:
              initialResolveResponse.body.suggestedContacts[0].suggestionId,
            mode: "create_new",
            draft: {
              firstName: "Duplicado",
              lastName: `Contacto ${TEST_PREFIX}`,
              email: `duplicado.contacto.${TEST_PREFIX}@example.com`,
              phone: "",
              mobile: "",
              positionTitle: "",
              department: "",
              countryId: null,
              stateRegion: "",
              city: "",
            },
          },
        ],
        opportunityResolutions: [],
      });

    expect(recreateResponse.status).toBe(409);
    expect(recreateResponse.body.message).toBe(
      "El contacto sugerido ya fue materializado y no puede modificarse desde este lead",
    );
  });

  test("interacciones bloquea ignorar una cuenta ya materializada desde la misma sugerencia", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead ignore account ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Theta Seguridad",
            "Contacto: Teo Lara",
            "Correo: teo.lara@theta.example.com",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_ignore_account_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.id);

    const initialResolveResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send(
        buildInteractionResolvePayload(createResponse.body, {
          accountResolution: {
            mode: "link_existing",
            accountId: ctx.fixtureAccountId,
          },
          contactResolutions: [],
          opportunityResolutions: [],
        }),
      );

    expect(initialResolveResponse.status).toBe(200);

    const reopenResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send(
        buildInteractionResolvePayload(initialResolveResponse.body, {
          accountResolution: {
            mode: "ignore",
          },
          contactResolutions: [],
          opportunityResolutions: [],
        }),
      );

    expect(reopenResponse.status).toBe(409);
    expect(reopenResponse.body.message).toBe(
      "La cuenta sugerida ya fue materializada y no puede modificarse desde este lead",
    );
  });

  test("interacciones bloquea relinkear una cuenta ya materializada a otro registro", async () => {
    const alternateAccountId = await createDirectAccount({
      ownerUserId: ctx.interactionsManagerUserId,
      actorUserId: ctx.interactionsManagerUserId,
      suffix: `${TEST_PREFIX}_alt_relink_account`,
    });
    cleanup.accountIds.push(alternateAccountId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead relink account ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Iota Seguridad",
            "Contacto: Iris Leon",
            "Correo: iris.leon@iota.example.com",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_relink_account_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.id);

    const initialResolveResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send(
        buildInteractionResolvePayload(createResponse.body, {
          accountResolution: {
            mode: "link_existing",
            accountId: ctx.fixtureAccountId,
          },
          contactResolutions: [],
          opportunityResolutions: [],
        }),
      );

    expect(initialResolveResponse.status).toBe(200);

    const reopenResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send(
        buildInteractionResolvePayload(initialResolveResponse.body, {
          accountResolution: {
            mode: "link_existing",
            accountId: alternateAccountId,
          },
          contactResolutions: [],
          opportunityResolutions: [],
        }),
      );

    expect(reopenResponse.status).toBe(409);
    expect(reopenResponse.body.message).toBe(
      "La cuenta sugerida ya fue materializada y no puede modificarse desde este lead",
    );
  });

  test("interacciones bloquea ignorar un contacto ya materializado desde la misma sugerencia", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead ignore contact ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Kappa Seguridad",
            "Contacto: Karla Mena",
            "Correo: karla.mena@kappa.example.com",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_ignore_contact_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.id);
    const firstContactSuggestion = createResponse.body.suggestedContacts[0];

    const initialResolveResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send(
        buildInteractionResolvePayload(createResponse.body, {
          accountResolution: {
            mode: "link_existing",
            accountId: ctx.fixtureAccountId,
          },
          contactResolutions: [
            {
              suggestionId: firstContactSuggestion.suggestionId,
              mode: "link_existing",
              contactId: ctx.fixtureContactId,
            },
          ],
          opportunityResolutions: [],
        }),
      );

    expect(initialResolveResponse.status).toBe(200);

    const reopenResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send(
        buildInteractionResolvePayload(initialResolveResponse.body, {
          accountResolution: {
            mode: "link_existing",
            accountId: initialResolveResponse.body.accountId,
          },
          contactResolutions: [
            {
              suggestionId:
                initialResolveResponse.body.suggestedContacts[0].suggestionId,
              mode: "ignore",
            },
          ],
          opportunityResolutions: [],
        }),
      );

    expect(reopenResponse.status).toBe(409);
    expect(reopenResponse.body.message).toBe(
      "El contacto sugerido ya fue materializado y no puede modificarse desde este lead",
    );
  });

  test("interacciones bloquea relinkear un contacto ya materializado a otro registro", async () => {
    const alternateContactId = await createDirectContact({
      accountId: ctx.fixtureAccountId,
      actorUserId: ctx.interactionsManagerUserId,
      suffix: `${TEST_PREFIX}_alt_relink_contact`,
    });
    cleanup.contactIds.push(alternateContactId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead relink contact ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Lambda Seguridad",
            "Contacto: Lucia Neira",
            "Correo: lucia.neira@lambda.example.com",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_relink_contact_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.id);
    const firstContactSuggestion = createResponse.body.suggestedContacts[0];

    const initialResolveResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send(
        buildInteractionResolvePayload(createResponse.body, {
          accountResolution: {
            mode: "link_existing",
            accountId: ctx.fixtureAccountId,
          },
          contactResolutions: [
            {
              suggestionId: firstContactSuggestion.suggestionId,
              mode: "link_existing",
              contactId: ctx.fixtureContactId,
            },
          ],
          opportunityResolutions: [],
        }),
      );

    expect(initialResolveResponse.status).toBe(200);

    const reopenResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send(
        buildInteractionResolvePayload(initialResolveResponse.body, {
          accountResolution: {
            mode: "link_existing",
            accountId: initialResolveResponse.body.accountId,
          },
          contactResolutions: [
            {
              suggestionId:
                initialResolveResponse.body.suggestedContacts[0].suggestionId,
              mode: "link_existing",
              contactId: alternateContactId,
            },
          ],
          opportunityResolutions: [],
        }),
      );

    expect(reopenResponse.status).toBe(409);
    expect(reopenResponse.body.message).toBe(
      "El contacto sugerido ya fue materializado y no puede modificarse desde este lead",
    );
  });

  test("interacciones bloquea ignorar una oportunidad ya materializada desde la misma sugerencia", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead ignore opportunity ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Mu Seguridad",
            "Contacto: Mauro Diaz",
            "Tema: Seguimiento comercial",
            "Correo: mauro.diaz@mu.example.com",
            "Oportunidad: Servicio gestionado Mu",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_ignore_opportunity_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.id);
    const firstContactSuggestion = createResponse.body.suggestedContacts[0];
    const firstOpportunitySuggestion =
      createResponse.body.suggestedOpportunities[0];

    const initialResolveResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send(
        buildInteractionResolvePayload(createResponse.body, {
          sellerUserId: ctx.sellerUserId,
          accountResolution: {
            mode: "link_existing",
            accountId: ctx.fixtureAccountId,
          },
          contactResolutions: [
            {
              suggestionId: firstContactSuggestion.suggestionId,
              mode: "link_existing",
              contactId: ctx.fixtureContactId,
            },
          ],
          opportunityResolutions: [
            {
              suggestionId: firstOpportunitySuggestion.suggestionId,
              mode: "create_new",
              isPrimary: true,
              draft: {
                name:
                  firstOpportunitySuggestion.name ||
                  `Oportunidad Mu ${TEST_PREFIX}`,
                contactId: null,
                amountUsd: 87000,
                closeDate: "2026-09-18",
                businessLineId: ctx.catalogIds.businessLineId,
                sellerUserId: ctx.sellerUserId,
                presalesUserId: null,
                summary: "Oportunidad materializada para validar bloqueo.",
              },
            },
          ],
        }),
      );

    expect(initialResolveResponse.status).toBe(200);

    const reopenResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send(
        buildInteractionResolvePayload(initialResolveResponse.body, {
          sellerUserId: ctx.sellerUserId,
          accountResolution: {
            mode: "link_existing",
            accountId: initialResolveResponse.body.accountId,
          },
          contactResolutions: [
            {
              suggestionId:
                initialResolveResponse.body.suggestedContacts[0].suggestionId,
              mode: "link_existing",
              contactId: initialResolveResponse.body.contacts[0].id,
            },
          ],
          opportunityResolutions: [
            {
              suggestionId:
                initialResolveResponse.body.suggestedOpportunities[0]
                  .suggestionId,
              mode: "ignore",
            },
          ],
        }),
      );

    expect(reopenResponse.status).toBe(409);
    expect(reopenResponse.body.message).toBe(
      "La oportunidad sugerida ya fue materializada y no puede modificarse desde este lead",
    );
  });

  test("interacciones bloquea relinkear una oportunidad ya materializada a otro registro", async () => {
    const alternateOpportunityId = await createExistingOpportunityForLead({
      accountId: ctx.fixtureAccountId,
      contactId: ctx.fixtureContactId,
      actorUserId: ctx.interactionsManagerUserId,
      suffix: `${TEST_PREFIX}_alt_relink_opportunity`,
    });

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead relink opportunity ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Nu Seguridad",
            "Contacto: Nadia Soto",
            "Tema: Seguimiento comercial",
            "Correo: nadia.soto@nu.example.com",
            "Oportunidad: Servicio gestionado Nu",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_relink_opportunity_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.id);
    const firstContactSuggestion = createResponse.body.suggestedContacts[0];
    const firstOpportunitySuggestion =
      createResponse.body.suggestedOpportunities[0];

    const initialResolveResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send(
        buildInteractionResolvePayload(createResponse.body, {
          sellerUserId: ctx.sellerUserId,
          accountResolution: {
            mode: "link_existing",
            accountId: ctx.fixtureAccountId,
          },
          contactResolutions: [
            {
              suggestionId: firstContactSuggestion.suggestionId,
              mode: "link_existing",
              contactId: ctx.fixtureContactId,
            },
          ],
          opportunityResolutions: [
            {
              suggestionId: firstOpportunitySuggestion.suggestionId,
              mode: "create_new",
              isPrimary: true,
              draft: {
                name:
                  firstOpportunitySuggestion.name ||
                  `Oportunidad Nu ${TEST_PREFIX}`,
                contactId: null,
                amountUsd: 91000,
                closeDate: "2026-10-01",
                businessLineId: ctx.catalogIds.businessLineId,
                sellerUserId: ctx.sellerUserId,
                presalesUserId: null,
                summary: "Oportunidad materializada para validar relink.",
              },
            },
          ],
        }),
      );

    expect(initialResolveResponse.status).toBe(200);

    const reopenResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send(
        buildInteractionResolvePayload(initialResolveResponse.body, {
          sellerUserId: ctx.sellerUserId,
          accountResolution: {
            mode: "link_existing",
            accountId: initialResolveResponse.body.accountId,
          },
          contactResolutions: [
            {
              suggestionId:
                initialResolveResponse.body.suggestedContacts[0].suggestionId,
              mode: "link_existing",
              contactId: initialResolveResponse.body.contacts[0].id,
            },
          ],
          opportunityResolutions: [
            {
              suggestionId:
                initialResolveResponse.body.suggestedOpportunities[0]
                  .suggestionId,
              mode: "link_existing",
              opportunityId: alternateOpportunityId,
              isPrimary: true,
            },
          ],
        }),
      );

    expect(reopenResponse.status).toBe(409);
    expect(reopenResponse.body.message).toBe(
      "La oportunidad sugerida ya fue materializada y no puede modificarse desde este lead",
    );
  });

  test("interacciones permite reenviar sin cambios una sugerencia materializada", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );
    const token = loginResponse.body.token;

    const createResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${token}`)
      .field("title", `Lead idempotent materialized ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Xi Seguridad",
            "Contacto: Ximena Paz",
            "Tema: Seguimiento comercial",
            "Correo: ximena.paz@xi.example.com",
            "Oportunidad: Servicio gestionado Xi",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_idempotent_materialized_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createResponse.status).toBe(201);
    const interactionId = Number(createResponse.body.id);
    const firstContactSuggestion = createResponse.body.suggestedContacts[0];
    const firstOpportunitySuggestion =
      createResponse.body.suggestedOpportunities[0];

    const initialResolveResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send(
        buildInteractionResolvePayload(createResponse.body, {
          sellerUserId: ctx.sellerUserId,
          accountResolution: {
            mode: "link_existing",
            accountId: ctx.fixtureAccountId,
          },
          contactResolutions: [
            {
              suggestionId: firstContactSuggestion.suggestionId,
              mode: "link_existing",
              contactId: ctx.fixtureContactId,
            },
          ],
          opportunityResolutions: [
            {
              suggestionId: firstOpportunitySuggestion.suggestionId,
              mode: "create_new",
              isPrimary: true,
              draft: {
                name:
                  firstOpportunitySuggestion.name ||
                  `Oportunidad Xi ${TEST_PREFIX}`,
                contactId: null,
                amountUsd: 79000,
                closeDate: "2026-11-12",
                businessLineId: ctx.catalogIds.businessLineId,
                sellerUserId: ctx.sellerUserId,
                presalesUserId: null,
                summary: "Oportunidad materializada para validar idempotencia.",
              },
            },
          ],
        }),
      );

    expect(initialResolveResponse.status).toBe(200);

    const reopenResponse = await request(app)
      .post(`/api/interactions/${interactionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send(
        buildInteractionResolvePayload(initialResolveResponse.body, {
          sellerUserId: ctx.sellerUserId,
          accountResolution: {
            mode: "link_existing",
            accountId:
              initialResolveResponse.body.suggestedAccount.selectedAccountId,
          },
          contactResolutions: [
            {
              suggestionId:
                initialResolveResponse.body.suggestedContacts[0].suggestionId,
              mode: "link_existing",
              contactId:
                initialResolveResponse.body.suggestedContacts[0]
                  .selectedContactId,
            },
          ],
          opportunityResolutions: [
            {
              suggestionId:
                initialResolveResponse.body.suggestedOpportunities[0]
                  .suggestionId,
              mode: "link_existing",
              opportunityId:
                initialResolveResponse.body.suggestedOpportunities[0]
                  .selectedOpportunityId,
              isPrimary: true,
            },
          ],
        }),
      );

    expect(reopenResponse.status).toBe(200);
    expect(reopenResponse.body.accountId).toBe(ctx.fixtureAccountId);
    expect(reopenResponse.body.contacts[0].id).toBe(ctx.fixtureContactId);
    expect(reopenResponse.body.opportunities[0].id).toBe(
      initialResolveResponse.body.suggestedOpportunities[0]
        .selectedOpportunityId,
    );
  });

  test("contactos.request ya no autoriza crear contactos", async () => {
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

    expect(createResponse.status).toBe(403);
    expect(createResponse.body.message).toBe("No autorizado");
  });

  test("contactos.create exige revision cuando detecta un duplicado fuerte por email", async () => {
    const duplicateAccountId = await createDirectAccount({
      ownerUserId: ctx.contactCreateUserId,
      actorUserId: ctx.contactCreateUserId,
      suffix: `${TEST_PREFIX}_contact_duplicate_email_account`,
    });
    cleanup.accountIds.push(duplicateAccountId);

    const duplicateContactId = await createDirectContact({
      accountId: duplicateAccountId,
      actorUserId: ctx.contactCreateUserId,
      suffix: `${TEST_PREFIX}_contact_duplicate_email`,
    });
    cleanup.contactIds.push(duplicateContactId);

    await query(
      `UPDATE contacts
       SET first_name = ?, last_name = ?, email = ?
       WHERE id = ?`,
      [
        "Julia",
        `Lopez ${TEST_PREFIX}`,
        `${TEST_PREFIX}.duplicate.contact@example.com`,
        duplicateContactId,
      ],
    );

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.contacts.create@example.com`,
    );

    const createResponse = await request(app)
      .post("/api/contacts")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        firstName: "Julia",
        lastName: `Lopez ${TEST_PREFIX}`,
        accountId: duplicateAccountId,
        positionTitle: "Analista",
        phone: "5551010101",
        phoneExtension: "101",
        mobile: `551${String(Date.now()).slice(-7)}`,
        email: `${TEST_PREFIX}.duplicate.contact@example.com`,
        department: "Compras",
        countryId: ctx.catalogIds.countryMxId,
        stateRegion: "CDMX",
        city: "Ciudad de Mexico",
        addressLine: "Direccion prueba",
        postalCode: "01012",
        purchaseParticipationId: ctx.catalogIds.purchaseParticipationNoneId,
        relationshipTypeId: ctx.catalogIds.relationshipTypeNoneId,
        employmentStatusId: ctx.catalogIds.employmentStatusId,
        activationStatusId: ctx.catalogIds.contactActiveStatusId,
        managerContactId: null,
        influencesContactId: null,
      });

    expect(createResponse.status).toBe(409);
    expect(createResponse.body.code).toBe("CONTACT_DUPLICATE_BLOCKED");
    expect(createResponse.body.duplicateDecision).toBe("blocked");
    expect(createResponse.body.duplicateWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contactId: duplicateContactId,
          matchReason: "same_email",
          severity: "high",
        }),
      ]),
    );
  });

  test("contactos.create incluye revision IA para un duplicado probable", async () => {
    const duplicateAccountId = await createDirectAccount({
      ownerUserId: ctx.contactCreateUserId,
      actorUserId: ctx.contactCreateUserId,
      suffix: `${TEST_PREFIX}_contact_duplicate_ai_account`,
    });
    cleanup.accountIds.push(duplicateAccountId);

    const duplicateContactId = await createDirectContact({
      accountId: duplicateAccountId,
      actorUserId: ctx.contactCreateUserId,
      suffix: `${TEST_PREFIX}_contact_duplicate_ai`,
    });
    cleanup.contactIds.push(duplicateContactId);

    await query(
      `UPDATE contacts
       SET first_name = ?, last_name = ?, email = NULL, mobile = NULL
       WHERE id = ?`,
      ["Marina", `Lopez ${TEST_PREFIX}`, duplicateContactId],
    );

    const originalApiKey = config.openai.apiKey;
    const originalFetch = global.fetch;
    config.openai.apiKey = "test-key";
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  verdict: "likely_duplicate",
                  summary:
                    "Los nombres y la cuenta asociada sugieren que podria ser la misma persona.",
                  recommendation:
                    "Revisa el contacto existente antes de crear uno nuevo.",
                  confidence: "medium",
                }),
              },
            ],
          },
        ],
      }),
    }));

    try {
      const loginResponse = await login(
        request(app),
        `${TEST_PREFIX}.contacts.create@example.com`,
      );

      const createResponse = await request(app)
        .post("/api/contacts")
        .set("Authorization", `Bearer ${loginResponse.body.token}`)
        .send({
          firstName: "Marina",
          lastName: `Lopes ${TEST_PREFIX}`,
          accountId: duplicateAccountId,
          positionTitle: "Compras",
          phone: "5552020202",
          phoneExtension: "",
          mobile: "",
          email: "",
          department: "Compras",
          countryId: ctx.catalogIds.countryMxId,
          stateRegion: "CDMX",
          city: "Ciudad de Mexico",
          addressLine: "Direccion prueba ai",
          postalCode: "01013",
          purchaseParticipationId: ctx.catalogIds.purchaseParticipationNoneId,
          relationshipTypeId: ctx.catalogIds.relationshipTypeNoneId,
          employmentStatusId: ctx.catalogIds.employmentStatusId,
          activationStatusId: ctx.catalogIds.contactActiveStatusId,
          managerContactId: null,
          influencesContactId: null,
        });

      expect(createResponse.status).toBe(409);
      expect(createResponse.body.code).toBe("CONTACT_DUPLICATE_BLOCKED");
      expect(createResponse.body.duplicateDecision).toBe("blocked");
      expect(createResponse.body.duplicateValidationSource).toBe("ai");
      expect(createResponse.body.duplicateReview).toEqual(
        expect.objectContaining({
          verdict: "likely_duplicate",
        }),
      );
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
    }
  });

  test("contactos.create bloquea automaticamente un nombre casi identico en la misma cuenta cuando IA no esta disponible", async () => {
    const duplicateAccountId = await createDirectAccount({
      ownerUserId: ctx.contactCreateUserId,
      actorUserId: ctx.contactCreateUserId,
      suffix: `${TEST_PREFIX}_contact_near_exact_account`,
    });
    cleanup.accountIds.push(duplicateAccountId);

    const duplicateContactId = await createDirectContact({
      accountId: duplicateAccountId,
      actorUserId: ctx.contactCreateUserId,
      suffix: `${TEST_PREFIX}_contact_near_exact`,
    });
    cleanup.contactIds.push(duplicateContactId);

    await query(
      `UPDATE contacts
       SET first_name = ?, last_name = ?, email = NULL, mobile = NULL
       WHERE id = ?`,
      ["Carla", "Castillo", duplicateContactId],
    );

    const originalApiKey = config.openai.apiKey;
    config.openai.apiKey = "";

    try {
      const loginResponse = await login(
        request(app),
        `${TEST_PREFIX}.contacts.create@example.com`,
      );

      const createResponse = await request(app)
        .post("/api/contacts")
        .set("Authorization", `Bearer ${loginResponse.body.token}`)
        .send({
          firstName: "Carla",
          lastName: "Cantillo",
          accountId: duplicateAccountId,
          positionTitle: "Compras",
          phone: "5552020202",
          phoneExtension: "",
          mobile: "",
          email: "",
          department: "Compras",
          countryId: ctx.catalogIds.countryMxId,
          stateRegion: "CDMX",
          city: "Ciudad de Mexico",
          addressLine: "Direccion prueba ai",
          postalCode: "01013",
          purchaseParticipationId: ctx.catalogIds.purchaseParticipationNoneId,
          relationshipTypeId: ctx.catalogIds.relationshipTypeNoneId,
          employmentStatusId: ctx.catalogIds.employmentStatusId,
          activationStatusId: ctx.catalogIds.contactActiveStatusId,
          managerContactId: null,
          influencesContactId: null,
        });

      expect(createResponse.status).toBe(409);
      expect(createResponse.body.code).toBe("CONTACT_DUPLICATE_BLOCKED");
      expect(createResponse.body.duplicateDecision).toBe("blocked");
      expect(createResponse.body.duplicateWarnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            contactId: duplicateContactId,
            matchReason: "near_exact_name_same_account",
            severity: "medium",
          }),
        ]),
      );
    } finally {
      config.openai.apiKey = originalApiKey;
    }
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

    const inactiveAccountId = await createDirectAccount({
      ownerUserId: ctx.contactCreateUserId,
      actorUserId: ctx.contactCreateUserId,
      suffix: `${TEST_PREFIX}_contact_inactive_catalog`,
    });
    cleanup.accountIds.push(inactiveAccountId);
    await query("UPDATE accounts SET activation_status_id = ? WHERE id = ?", [
      ctx.catalogIds.accountPendingStatusId,
      inactiveAccountId,
    ]);

    const inactiveCatalogResponse = await request(app)
      .get("/api/catalogs/contact-accounts")
      .set("Authorization", `Bearer ${globalLoginResponse.body.token}`);

    expect(inactiveCatalogResponse.status).toBe(200);
    expect(
      inactiveCatalogResponse.body.some(
        (account) => Number(account.id) === inactiveAccountId,
      ),
    ).toBe(false);

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

  test("contactos.put permite editar un contacto sin cambiar su estado de activacion", async () => {
    const accountId = await createDirectAccount({
      ownerUserId: ctx.contactCreateUserId,
      actorUserId: ctx.contactCreateUserId,
      suffix: `${TEST_PREFIX}_contact_put_same_status`,
    });
    cleanup.accountIds.push(accountId);

    const contactId = await createDirectContact({
      accountId,
      actorUserId: ctx.contactCreateUserId,
      suffix: `${TEST_PREFIX}_contact_put_same_status`,
    });
    cleanup.contactIds.push(contactId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.contacts.create@example.com`,
    );

    const sameStatusPut = await request(app)
      .put(`/api/contacts/${contactId}`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        firstName: "Contacto",
        lastName: `PUT ${TEST_PREFIX} editado`,
        accountId,
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
        activationStatusId: ctx.catalogIds.contactActiveStatusId,
        managerContactId: null,
        influencesContactId: null,
      });

    expect(sameStatusPut.status).toBe(200);
    expect(sameStatusPut.body.message).toBe("Contacto actualizado");

    const statusCode = await getStatusCodeById("contacts", contactId, {
      table: "contact_activation_statuses",
      column: "activation_status_id",
    });
    expect(statusCode).toBe("activado");
  });

  test("contactos.put bloquea cambiar el estado de activacion sin contactos.create", async () => {
    const accountId = await createDirectAccount({
      ownerUserId: ctx.contactRequestUserId,
      actorUserId: ctx.contactRequestUserId,
      suffix: `${TEST_PREFIX}_contact_put_blocked_status`,
    });
    cleanup.accountIds.push(accountId);

    const contactId = await createDirectContact({
      accountId,
      actorUserId: ctx.contactRequestUserId,
      suffix: `${TEST_PREFIX}_contact_put_blocked_status`,
    });
    cleanup.contactIds.push(contactId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.contacts.request@example.com`,
    );

    const blockedStatusPut = await request(app)
      .put(`/api/contacts/${contactId}`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        firstName: "Contacto",
        lastName: `PUT ${TEST_PREFIX} activacion`,
        accountId,
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
        activationStatusId: ctx.catalogIds.contactInactiveStatusId,
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

    const normalizedDuplicateCreateResponse = await request(app)
      .post(`/api/providers/${providerId}/price-lists/${firstListId}/items`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        code: ` price - ${TEST_PREFIX} `,
        description: "Duplicado normalizado",
        itemType: "producto",
        price: 3500,
        currencyId: ctx.catalogIds.currencyUsdId,
        activationStatusId: ctx.catalogIds.providerPriceItemActiveStatusId,
      });

    expect(normalizedDuplicateCreateResponse.status).toBe(409);
    expect(normalizedDuplicateCreateResponse.body.message).toBe(
      "Ya existe un precio con ese codigo para la lista.",
    );

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
    const productComponentOverride = Number(productComponentRow.price) + 10;
    const serviceComponentOverride = Number(serviceComponentRow.price) + 5;

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
            unitPriceOverride: productComponentOverride,
            quantity: 2,
          },
          {
            componentItemId: serviceComponentItemId,
            unitPriceOverride: serviceComponentOverride,
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
    expect(itemsResponse.body[0].components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component_item_id: productComponentItemId,
          unit_price_override: productComponentOverride,
          quantity: 2,
        }),
        expect.objectContaining({
          component_item_id: serviceComponentItemId,
          unit_price_override: serviceComponentOverride,
          quantity: 3,
        }),
      ]),
    );
    expect(Number(itemsResponse.body[0].price)).toBe(
      Number(
        (productComponentOverride * 2 + serviceComponentOverride * 3).toFixed(
          2,
        ),
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

  test("oportunidades.request ya no autoriza crear oportunidades", async () => {
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

    expect(createResponse.status).toBe(403);
    expect(createResponse.body.message).toBe("No autorizado");
  });

  test("registros_fabricantes crea, aprueba, renueva y lista un registro por oportunidad", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_manufacturer_registration_flow`,
    );

    const providerId = await createDirectProvider({
      actorUserId: ctx.opportunityFlowUserId,
      suffix: `${TEST_PREFIX}_manufacturer_registration_flow`,
    });
    cleanup.providerIds.push(providerId);

    const createResponse = await request(app)
      .post(
        `/api/opportunities/${fixture.opportunityId}/manufacturer-registrations`,
      )
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        providerId,
        requestedAt: "2026-05-16",
        notes: "Registro inicial de fabricante",
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.providerId).toBe(providerId);
    expect(createResponse.body.displayStatus).toBe("sin_aprobar");

    const registrationId = Number(createResponse.body.id);

    const approveResponse = await request(app)
      .post(
        `/api/opportunities/${fixture.opportunityId}/manufacturer-registrations/${registrationId}/approve`,
      )
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        registrationFolio: `FOLIO-${TEST_PREFIX.slice(-6)}-A`,
        approvedAt: "2026-05-18",
        expiresAt: "2026-08-31",
        notes: "Confirmado por fabricante",
      });

    expect(approveResponse.status).toBe(200);
    expect(approveResponse.body.displayStatus).toBe("aprobado");
    expect(approveResponse.body.registrationFolio).toContain("FOLIO-");

    const renewResponse = await request(app)
      .post(
        `/api/opportunities/${fixture.opportunityId}/manufacturer-registrations/${registrationId}/renew`,
      )
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        registrationFolio: approveResponse.body.registrationFolio,
        expiresAt: "2026-11-30",
        notes: "Renovacion trimestral",
      });

    expect(renewResponse.status).toBe(200);
    expect(renewResponse.body.displayStatus).toBe("renovado");
    expect(renewResponse.body.renewalCount).toBe(1);
    expect(Array.isArray(renewResponse.body.renewals)).toBe(true);
    expect(renewResponse.body.renewals).toHaveLength(1);

    const listResponse = await request(app)
      .get(
        `/api/opportunities/${fixture.opportunityId}/manufacturer-registrations`,
      )
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toHaveLength(1);
    expect(listResponse.body[0].displayStatus).toBe("renovado");

    const globalListResponse = await request(app)
      .get(`/api/manufacturer-registrations?providerId=${providerId}`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(globalListResponse.status).toBe(200);
    expect(globalListResponse.body.items).toHaveLength(1);
    expect(globalListResponse.body.summary.renovado).toBe(1);

    const detailResponse = await request(app)
      .get(
        `/api/opportunities/${fixture.opportunityId}/manufacturer-registrations/${registrationId}`,
      )
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.renewals).toHaveLength(1);
    expect(detailResponse.body.auditEntries.length).toBeGreaterThanOrEqual(3);
  });

  test("registros_fabricantes bloquea solicitud y excluye listados cuando la oportunidad esta cerrada", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_manufacturer_registration_closed`,
    );

    const baselineAlertsResponse = await request(app)
      .get("/api/manufacturer-registrations/alerts")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(baselineAlertsResponse.status).toBe(200);

    const providerId = await createDirectProvider({
      actorUserId: ctx.opportunityFlowUserId,
      suffix: `${TEST_PREFIX}_manufacturer_registration_closed`,
    });
    cleanup.providerIds.push(providerId);

    const createOpenResponse = await request(app)
      .post(
        `/api/opportunities/${fixture.opportunityId}/manufacturer-registrations`,
      )
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        providerId,
        requestedAt: "2026-05-16",
        notes: "Solicitud antes del cierre comercial",
      });

    expect(createOpenResponse.status).toBe(201);

    await query(
      `UPDATE opportunities
       SET commercial_status_id = ?, commercial_closed_at = NOW(3), updated_at = NOW(3)
       WHERE id = ?`,
      [ctx.catalogIds.opportunityCommercialWonStatusId, fixture.opportunityId],
    );

    const createClosedResponse = await request(app)
      .post(
        `/api/opportunities/${fixture.opportunityId}/manufacturer-registrations`,
      )
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        providerId,
        requestedAt: "2026-05-17",
        notes: "Solicitud bloqueada por cierre",
      });

    expect(createClosedResponse.status).toBe(422);
    expect(createClosedResponse.body.reason).toBe(
      "manufacturer_registration_closed_opportunity",
    );

    const opportunityListResponse = await request(app)
      .get(
        `/api/opportunities/${fixture.opportunityId}/manufacturer-registrations`,
      )
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(opportunityListResponse.status).toBe(200);
    expect(opportunityListResponse.body).toEqual([]);

    const globalListResponse = await request(app)
      .get(`/api/manufacturer-registrations?providerId=${providerId}`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(globalListResponse.status).toBe(200);
    expect(globalListResponse.body.items).toHaveLength(0);
    expect(globalListResponse.body.pagination.total).toBe(0);

    const alertsResponse = await request(app)
      .get("/api/manufacturer-registrations/alerts")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(alertsResponse.status).toBe(200);
    expect(alertsResponse.body.total).toBe(baselineAlertsResponse.body.total);
  });

  test("oportunidades documentos soporta sesion, revision, transferencia y vinculos de etapa", async () => {
    const documentAccountId = await createDirectAccount({
      ownerUserId: ctx.opportunityFlowUserId,
      actorUserId: ctx.opportunityFlowUserId,
      suffix: `${TEST_PREFIX}_opportunity_documents`,
    });
    cleanup.accountIds.push(documentAccountId);

    const documentContactId = await createDirectContact({
      accountId: documentAccountId,
      actorUserId: ctx.opportunityFlowUserId,
      suffix: `${TEST_PREFIX}_opportunity_documents`,
    });
    cleanup.contactIds.push(documentContactId);

    const [accountRow] = await query(
      `SELECT id, name FROM accounts WHERE id = ? LIMIT 1`,
      [documentAccountId],
    );
    const [contactRow] = await query(
      `SELECT id, TRIM(CONCAT_WS(' ', first_name, last_name)) AS full_name
       FROM contacts
       WHERE id = ?
       LIMIT 1`,
      [documentContactId],
    );
    const [sellerRow] = await query(
      `SELECT id, full_name FROM users WHERE id = ? LIMIT 1`,
      [ctx.sellerUserId],
    );
    const [businessLineRow] = await query(
      `SELECT id, name FROM opportunity_business_lines WHERE id = ? LIMIT 1`,
      [ctx.catalogIds.businessLineId],
    );

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.opps.flow@example.com`,
    );
    const token = loginResponse.body.token;

    const createSessionResponse = await request(app)
      .post("/api/opportunities/document-upload-sessions")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(createSessionResponse.status).toBe(201);
    const sessionPublicId = createSessionResponse.body.session.publicId;

    const textDocument = [
      `Nombre de la oportunidad: Oportunidad documental ${TEST_PREFIX}`,
      "Monto: 125000",
      "Fecha de cierre: 2026-08-15",
      `Cuenta: ${accountRow.name}`,
      `Contacto: ${contactRow.full_name}`,
      `Linea de negocio: ${businessLineRow.name}`,
      `Vendedor: ${sellerRow.full_name}`,
      "Preventa: ",
      "Notas: Proyecto derivado de propuesta comercial y llamada de descubrimiento.",
    ].join("\n");

    const uploadResponse = await request(app)
      .post(
        `/api/opportunities/document-upload-sessions/${sessionPublicId}/files`,
      )
      .set("Authorization", `Bearer ${token}`)
      .attach("files", Buffer.from(textDocument, "utf8"), {
        filename: `oportunidad_${TEST_PREFIX}.txt`,
        contentType: "text/plain",
      });

    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.body.documents).toHaveLength(1);
    const documentPublicId = uploadResponse.body.documents[0].publicId;

    const reviewResponse = await request(app)
      .get(
        `/api/opportunities/document-upload-sessions/${sessionPublicId}/review`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(reviewResponse.status).toBe(200);
    expect(reviewResponse.body.review.suggestedFields.suggestedName).toBe(
      `Oportunidad documental ${TEST_PREFIX}`,
    );
    expect(
      reviewResponse.body.review.suggestedFields.matchedAccount.matchStatus,
    ).toBe("single_match");
    expect(
      reviewResponse.body.review.suggestedFields.matchedBusinessLine
        .matchStatus,
    ).toBe("single_match");

    const applyResponse = await request(app)
      .post(
        `/api/opportunities/document-upload-sessions/${sessionPublicId}/apply-to-draft`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        fieldOverrides: {
          name: `Oportunidad documental ajustada ${TEST_PREFIX}`,
          amountUsd: 130500,
        },
        matchSelections: {
          accountId: documentAccountId,
          contactId: documentContactId,
          businessLineId: Number(businessLineRow.id),
          sellerUserId: Number(sellerRow.id),
          presalesUserId: null,
        },
      });

    expect(applyResponse.status).toBe(200);
    expect(applyResponse.body.appliedDraft.name).toBe(
      `Oportunidad documental ajustada ${TEST_PREFIX}`,
    );
    expect(applyResponse.body.appliedDraft.amountUsd).toBe(130500);
    expect(applyResponse.body.appliedDraft.accountId).toBe(documentAccountId);
    expect(applyResponse.body.appliedDraft.contactId).toBe(documentContactId);
    expect(applyResponse.body.appliedDraft.businessLineId).toBe(
      Number(businessLineRow.id),
    );
    expect(applyResponse.body.appliedDraft.sellerUserId).toBe(
      Number(sellerRow.id),
    );
    expect(applyResponse.body.appliedDraft.presalesUserId).toBeNull();

    const createOpportunityResponse = await request(app)
      .post("/api/opportunities")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: applyResponse.body.appliedDraft.name,
        amountUsd: applyResponse.body.appliedDraft.amountUsd,
        accountId: applyResponse.body.appliedDraft.accountId,
        closeDate: applyResponse.body.appliedDraft.closeDate,
        contactId: applyResponse.body.appliedDraft.contactId,
        businessLineId: applyResponse.body.appliedDraft.businessLineId,
        sellerUserId: ctx.sellerUserId,
        presalesUserId: null,
        activationStatusId: ctx.catalogIds.opportunityActiveStatusId,
        uploadSessionPublicId: sessionPublicId,
      });

    expect(createOpportunityResponse.status).toBe(201);
    cleanup.opportunityIds.push(Number(createOpportunityResponse.body.id));

    const opportunityDocumentsResponse = await request(app)
      .get(`/api/opportunities/${createOpportunityResponse.body.id}/documents`)
      .set("Authorization", `Bearer ${token}`);

    expect(opportunityDocumentsResponse.status).toBe(200);
    expect(opportunityDocumentsResponse.body).toHaveLength(1);
    expect(opportunityDocumentsResponse.body[0].publicId).toBe(
      documentPublicId,
    );

    const [firstQuestion] =
      await getStageQuestionRowsByCode("contacto_inicial");
    const stageAnswerResponse = await request(app)
      .post(
        `/api/opportunities/${createOpportunityResponse.body.id}/stage-answers`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        answers: [
          {
            questionId: Number(firstQuestion.id),
            answerValue: "El cliente busca consolidar alcance y presupuesto.",
          },
        ],
      });

    expect(stageAnswerResponse.status).toBe(200);

    const linkStageResponse = await request(app)
      .post(
        `/api/opportunities/${createOpportunityResponse.body.id}/stages/${ctx.catalogIds.salesStageInitialId}/documents/${documentPublicId}/link`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({ linkRole: "evidence" });

    expect(linkStageResponse.status).toBe(201);

    const [stageAnswerRow] = await query(
      `SELECT id
       FROM opportunity_stage_question_answers
       WHERE opportunity_id = ?
         AND question_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [createOpportunityResponse.body.id, Number(firstQuestion.id)],
    );

    const linkAnswerSourceResponse = await request(app)
      .post(
        `/api/opportunities/stage-answer-sources/${stageAnswerRow.id}/documents/${documentPublicId}`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({ evidenceExcerpt: "Proyecto derivado de propuesta comercial." });

    expect(linkAnswerSourceResponse.status).toBe(201);

    const linkedStageRows = await query(
      `SELECT id
       FROM opportunity_stage_document_links
       WHERE opportunity_id = ?
         AND sales_stage_id = ?`,
      [createOpportunityResponse.body.id, ctx.catalogIds.salesStageInitialId],
    );
    expect(linkedStageRows).toHaveLength(1);

    const linkedAnswerSourceRows = await query(
      `SELECT id
       FROM opportunity_stage_answer_document_sources
       WHERE stage_answer_id = ?`,
      [stageAnswerRow.id],
    );
    expect(linkedAnswerSourceRows).toHaveLength(1);
  });

  test("oportunidades documentos expone multiples nombres sugeridos cuando el documento trae mas de una oportunidad", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.opps.flow@example.com`,
    );
    const token = loginResponse.body.token;

    const createSessionResponse = await request(app)
      .post("/api/opportunities/document-upload-sessions")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(createSessionResponse.status).toBe(201);
    const sessionPublicId = createSessionResponse.body.session.publicId;

    const textDocument = [
      `Nombre de la oportunidad: Renovacion documental ${TEST_PREFIX}`,
      `Nombre de la oportunidad: Expansion documental ${TEST_PREFIX}`,
      "Monto: 125000",
      "Fecha de cierre: 2026-08-15",
      "Notas: El documento resume dos iniciativas comerciales separadas.",
    ].join("\n");

    const uploadResponse = await request(app)
      .post(
        `/api/opportunities/document-upload-sessions/${sessionPublicId}/files`,
      )
      .set("Authorization", `Bearer ${token}`)
      .attach("files", Buffer.from(textDocument, "utf8"), {
        filename: `oportunidades_multiples_${TEST_PREFIX}.txt`,
        contentType: "text/plain",
      });

    expect(uploadResponse.status).toBe(201);

    const reviewResponse = await request(app)
      .get(
        `/api/opportunities/document-upload-sessions/${sessionPublicId}/review`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(reviewResponse.status).toBe(200);
    expect(reviewResponse.body.review.suggestedFields.suggestedName).toBe(
      `Renovacion documental ${TEST_PREFIX}`,
    );
    expect(
      reviewResponse.body.review.suggestedFields.suggestedNameOptions,
    ).toEqual([
      `Renovacion documental ${TEST_PREFIX}`,
      `Expansion documental ${TEST_PREFIX}`,
    ]);
  });

  test("oportunidades documentos puede diferir procesamiento y completarlo por worker", async () => {
    const originalProcessingMode = config.documents.processing.mode;
    const timeoutSpy = vi
      .spyOn(global, "setTimeout")
      .mockImplementation(() => 0);

    config.documents.processing.mode = "async_in_process";

    try {
      const documentAccountId = await createDirectAccount({
        ownerUserId: ctx.opportunityFlowUserId,
        actorUserId: ctx.opportunityFlowUserId,
        suffix: `${TEST_PREFIX}_opportunity_documents_async`,
      });
      cleanup.accountIds.push(documentAccountId);

      const documentContactId = await createDirectContact({
        accountId: documentAccountId,
        actorUserId: ctx.opportunityFlowUserId,
        suffix: `${TEST_PREFIX}_opportunity_documents_async`,
      });
      cleanup.contactIds.push(documentContactId);

      const [accountRow] = await query(
        `SELECT id, name FROM accounts WHERE id = ? LIMIT 1`,
        [documentAccountId],
      );

      const loginResponse = await login(
        request(app),
        `${TEST_PREFIX}.opps.flow@example.com`,
      );
      const token = loginResponse.body.token;

      const createSessionResponse = await request(app)
        .post("/api/opportunities/document-upload-sessions")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(createSessionResponse.status).toBe(201);
      const sessionPublicId = createSessionResponse.body.session.publicId;

      const uploadResponse = await request(app)
        .post(
          `/api/opportunities/document-upload-sessions/${sessionPublicId}/files`,
        )
        .set("Authorization", `Bearer ${token}`)
        .attach(
          "files",
          Buffer.from(
            [
              `Nombre de la oportunidad: Oportunidad async ${TEST_PREFIX}`,
              "Monto: 88000",
              `Cuenta: ${accountRow.name}`,
            ].join("\n"),
            "utf8",
          ),
          {
            filename: `oportunidad_async_${TEST_PREFIX}.txt`,
            contentType: "text/plain",
          },
        );

      expect(uploadResponse.status).toBe(201);
      expect(uploadResponse.body.review.executionPlan.mode).toBe(
        "async_in_process",
      );
      expect(uploadResponse.body.documents[0].processingStatus).toBe(
        "uploaded",
      );

      await processPendingOpportunityDocumentJobs({ limit: 5 });

      const reviewResponse = await request(app)
        .get(
          `/api/opportunities/document-upload-sessions/${sessionPublicId}/review`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(reviewResponse.status).toBe(200);
      expect(reviewResponse.body.session.status).toBe("ready");
      expect(reviewResponse.body.documents[0].processingStatus).toBe(
        "review_ready",
      );
      expect(reviewResponse.body.review.suggestedFields.suggestedName).toBe(
        `Oportunidad async ${TEST_PREFIX}`,
      );
    } finally {
      config.documents.processing.mode = originalProcessingMode;
      timeoutSpy.mockRestore();
    }
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

    const inactiveOpportunityAccountId = await createDirectAccount({
      ownerUserId: ctx.sellerUserId,
      actorUserId: ctx.interactionsManagerUserId,
      suffix: `${TEST_PREFIX}_opportunity_inactive_catalog_account`,
    });
    cleanup.accountIds.push(inactiveOpportunityAccountId);
    await query("UPDATE accounts SET activation_status_id = ? WHERE id = ?", [
      ctx.catalogIds.accountPendingStatusId,
      inactiveOpportunityAccountId,
    ]);

    const inactiveOpportunityContactId = await createDirectContact({
      accountId: ctx.fixtureAccountId,
      actorUserId: ctx.interactionsManagerUserId,
      suffix: `${TEST_PREFIX}_opportunity_inactive_catalog_contact`,
    });
    cleanup.contactIds.push(inactiveOpportunityContactId);
    await query("UPDATE contacts SET activation_status_id = ? WHERE id = ?", [
      ctx.catalogIds.contactInactiveStatusId,
      inactiveOpportunityContactId,
    ]);

    const refreshedAccountsCatalogResponse = await request(app)
      .get("/api/catalogs/opportunity-accounts")
      .set("Authorization", `Bearer ${globalLoginResponse.body.token}`);

    expect(refreshedAccountsCatalogResponse.status).toBe(200);
    expect(
      refreshedAccountsCatalogResponse.body.some(
        (account) => Number(account.id) === inactiveOpportunityAccountId,
      ),
    ).toBe(false);

    const refreshedContactsCatalogResponse = await request(app)
      .get("/api/catalogs/opportunity-contacts")
      .set("Authorization", `Bearer ${globalLoginResponse.body.token}`);

    expect(refreshedContactsCatalogResponse.status).toBe(200);
    expect(
      refreshedContactsCatalogResponse.body.some(
        (contact) => Number(contact.id) === inactiveOpportunityContactId,
      ),
    ).toBe(false);

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

  test("oportunidades.put permite editar una oportunidad sin cambiar su estado de activacion", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_opportunity_put_same_status`,
    );

    const sameStatusPut = await request(app)
      .put(`/api/opportunities/${fixture.opportunityId}`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        name: `Oportunidad PUT ${TEST_PREFIX} editada`,
        amountUsd: 34000,
        accountId: fixture.accountId,
        closeDate: "2026-12-15",
        contactId: fixture.contactId,
        salesStageId: ctx.catalogIds.salesStageInitialId,
        businessLineId: ctx.catalogIds.businessLineId,
        sellerUserId: ctx.sellerUserId,
        presalesUserId: null,
        activationStatusId: ctx.catalogIds.opportunityActiveStatusId,
      });

    expect(sameStatusPut.status).toBe(200);
    expect(sameStatusPut.body.message).toBe("Oportunidad actualizada");

    const statusCode = await getStatusCodeById(
      "opportunities",
      fixture.opportunityId,
      {
        table: "opportunity_activation_statuses",
        column: "activation_status_id",
      },
    );
    expect(statusCode).toBe("activada");
  });

  test("oportunidades.put bloquea cambiar el estado de activacion sin oportunidades.create", async () => {
    const opportunityOwnedAccountId = await createDirectAccount({
      ownerUserId: ctx.opportunityRequestUserId,
      actorUserId: ctx.opportunityRequestUserId,
      suffix: `${TEST_PREFIX}_opportunity_put_blocked_status`,
    });
    cleanup.accountIds.push(opportunityOwnedAccountId);

    const opportunityOwnedContactId = await createDirectContact({
      accountId: opportunityOwnedAccountId,
      actorUserId: ctx.opportunityRequestUserId,
      suffix: `${TEST_PREFIX}_opportunity_put_blocked_status`,
    });
    cleanup.contactIds.push(opportunityOwnedContactId);

    const now = new Date();
    const insertResult = await query(
      `INSERT INTO opportunities
        (name, amount_usd, account_id, close_date, contact_id,
         sales_stage_id, business_line_id, seller_user_id, presales_user_id, activation_status_id,
         commercial_status_id, created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `Oportunidad PUT bloqueada ${TEST_PREFIX}`,
        33000,
        opportunityOwnedAccountId,
        "2026-11-30",
        opportunityOwnedContactId,
        ctx.catalogIds.salesStageInitialId,
        ctx.catalogIds.businessLineId,
        ctx.sellerUserId,
        null,
        ctx.catalogIds.opportunityActiveStatusId,
        ctx.catalogIds.opportunityCommercialInProgressStatusId,
        ctx.opportunityRequestUserId,
        now,
        ctx.opportunityRequestUserId,
        now,
      ],
    );
    const opportunityId = Number(insertResult.insertId);
    cleanup.opportunityIds.push(opportunityId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.opps.request@example.com`,
    );

    const blockedStatusPut = await request(app)
      .put(`/api/opportunities/${opportunityId}`)
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
        activationStatusId: ctx.catalogIds.opportunityInactiveStatusId,
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
    expect(snapshot.activation_status_code).toBe("activada");
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
    expect(contextResponse.body.workspace).toEqual(
      expect.objectContaining({
        playbook: expect.objectContaining({
          code: expect.any(String),
          version: "v1",
        }),
        scorecard: expect.objectContaining({
          averageScore: expect.any(Number),
          items: expect.any(Array),
        }),
      }),
    );
    expect(contextResponse.body.workspace.currentStage).toEqual(
      expect.objectContaining({
        stageName: "Contacto Inicial",
        checklist: expect.any(Array),
      }),
    );
  });

  test("oportunidades.workspace permite guardar debilidades y assessments manuales", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_workspace_editable`,
    );

    const weaknessResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/workspace/weaknesses`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        title: "Decisor economico no identificado",
        category: "stakeholders",
        severity: "high",
        status: "open",
        detail: "Aun no se conoce quien aprueba el presupuesto.",
      });

    expect(weaknessResponse.status).toBe(200);
    expect(Number(weaknessResponse.body.id)).toBeGreaterThan(0);

    const assessmentResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/workspace/assessments`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        criterionCode: "contacto_follow_up",
        salesStageId: ctx.catalogIds.salesStageInitialId,
        status: "solid",
        score: 3,
        confidence: "high",
        summary:
          "Ya existe reunion tecnica confirmada para la siguiente semana.",
      });

    expect(assessmentResponse.status).toBe(200);
    expect(assessmentResponse.body.workspace.currentStage.checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          criterionCode: "contacto_follow_up",
          status: "solid",
        }),
      ]),
    );

    const contextResponse = await request(app)
      .get(`/api/opportunities/${fixture.opportunityId}/commercial-context`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(contextResponse.status).toBe(200);
    expect(contextResponse.body.workspace.weaknesses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Decisor economico no identificado",
          severity: "high",
          isAutoGenerated: false,
        }),
      ]),
    );
    expect(contextResponse.body.workspace.currentStage.checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          criterionCode: "contacto_follow_up",
          status: "solid",
          summary:
            "Ya existe reunion tecnica confirmada para la siguiente semana.",
        }),
      ]),
    );
  });

  test("oportunidades.workspace conserva avance historico por etapa y deriva senales de waiting desde acciones y stakeholders", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_workspace_stage_history`,
    );
    const [contactQuestion] =
      await getStageQuestionRowsByCode("contacto_inicial");

    const saveContactAnswerResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/stage-answers`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        answers: [
          {
            questionId: Number(contactQuestion.id),
            answerValue:
              "El cliente ya confirmo un problema concreto de seguridad en sus APIs, el impacto operativo de no resolverlo antes de julio y la prioridad de atenderlo en este ciclo.",
          },
        ],
      });
    expect(saveContactAnswerResponse.status).toBe(200);

    const advanceResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/stage-transition`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ direction: "advance" });
    expect(advanceResponse.status).toBe(200);
    expect(advanceResponse.body.salesStageCode).toBe(
      "identificacion_oportunidad",
    );

    const warmupContextResponse = await request(app)
      .get(`/api/opportunities/${fixture.opportunityId}/commercial-context`)
      .set("Authorization", `Bearer ${fixture.token}`);
    expect(warmupContextResponse.status).toBe(200);

    const stakeholderResponse = await request(app)
      .post(
        `/api/opportunities/${fixture.opportunityId}/workspace/stakeholders`,
      )
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        name: "Laura Finanzas",
        roleCode: "economic_buyer",
        roleLabel: "Compras y finanzas",
        influenceLevel: "high",
        supportLevel: "neutral",
        status: "identified",
        priorities: "Confirmar aprobacion y ruta hacia la orden de compra.",
        nextAction: "Revisar paquete economico final con compras.",
      });
    expect(stakeholderResponse.status).toBe(200);

    const waitingActionResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/workspace/actions`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        title: "Seguimiento con compras para cierre",
        actionType: "follow_up",
        status: "pending",
        priority: "high",
        linkedStageId: ctx.catalogIds.salesStageWaitingId,
        dueDate: "2026-07-15",
        successCriteria: "Confirmar siguiente paso y fecha estimada de OC.",
        notes: "Seguimiento acordado con compras y finanzas.",
      });
    expect(waitingActionResponse.status).toBe(200);

    const contextResponse = await request(app)
      .get(`/api/opportunities/${fixture.opportunityId}/commercial-context`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(contextResponse.status).toBe(200);

    const contactoStage = contextResponse.body.workspace.stages.find(
      (stage) => stage.code === "contacto_inicial",
    );
    expect(contactoStage).toEqual(
      expect.objectContaining({
        completionRatio: 0,
        weaknessCount: 1,
        isValidated: false,
      }),
    );

    const waitingStage = contextResponse.body.workspace.stages.find(
      (stage) => stage.code === "waiting",
    );
    expect(waitingStage).toEqual(
      expect.objectContaining({
        completionRatio: 0,
        weaknessCount: 1,
        isValidated: false,
      }),
    );

    expect(waitingStage.checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          criterionCode: "waiting_follow_up_plan",
          status: "solid",
          sourceType: "workspace_action",
        }),
        expect.objectContaining({
          criterionCode: "waiting_purchase_path",
          status: "solid",
          sourceType: "workspace_stakeholder",
        }),
      ]),
    );
  });

  test("oportunidades.workspace solo muestra avance comercial cuando la etapa fue validada", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_workspace_progress_requires_validation`,
    );
    const contactQuestions =
      await getStageQuestionRowsByCode("contacto_inicial");

    const saveAnswersResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/stage-answers`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        answers: contactQuestions.map((question, index) => ({
          questionId: Number(question.id),
          answerValue:
            index === 0
              ? "El cliente confirmo una necesidad concreta con impacto operativo y urgencia de resolucion este trimestre."
              : "Ya existe una reunion tecnica pactada para revisar alcance, validar encaje y definir el siguiente paso comercial.",
        })),
      });

    expect(saveAnswersResponse.status).toBe(200);

    const contextBeforeValidation = await request(app)
      .get(`/api/opportunities/${fixture.opportunityId}/commercial-context`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(contextBeforeValidation.status).toBe(200);
    const contactoInicialBefore =
      contextBeforeValidation.body.workspace.stages.find(
        (stage) => stage.code === "contacto_inicial",
      );

    expect(contactoInicialBefore).toEqual(
      expect.objectContaining({
        completionRatio: 0,
        isValidated: false,
      }),
    );

    const originalApiKey = config.openai.apiKey;
    const originalFetch = global.fetch;
    config.openai.apiKey = "test-key";
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                decision: "ready_to_advance",
                summary:
                  "La etapa ya cuenta con necesidad confirmada y siguiente paso comercial documentado.",
                reasons: [
                  "La oportunidad ya expresa una necesidad concreta del cliente.",
                  "Tambien existe un siguiente paso comercial claro y documentado.",
                ],
                suggestions: [
                  "Avanza a la siguiente etapa y conserva esta evidencia en el expediente comercial.",
                ],
                confidence: "high",
                questionAssessments: contactQuestions.map((question) => ({
                  questionId: Number(question.id),
                  questionCode: String(question.code),
                  prompt: String(question.prompt),
                  answerValue: "Respuesta suficiente.",
                  status: "adequate",
                  reason: "La evidencia es suficiente para validar la etapa.",
                  suggestion: "Sin accion inmediata.",
                })),
              }),
            },
          },
        ],
      }),
    }));

    try {
      const validateResponse = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/validate-current-stage`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({ note: "Validacion comercial de prueba" });

      expect(validateResponse.status).toBe(200);
      expect(["ready_to_advance", "advance_with_caution"]).toContain(
        validateResponse.body.validation.decision,
      );
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
    }

    const contextAfterValidation = await request(app)
      .get(`/api/opportunities/${fixture.opportunityId}/commercial-context`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(contextAfterValidation.status).toBe(200);
    const contactoInicialAfter =
      contextAfterValidation.body.workspace.stages.find(
        (stage) => stage.code === "contacto_inicial",
      );

    expect(contactoInicialAfter.isValidated).toBe(true);
    expect(contactoInicialAfter.completionRatio).toBeGreaterThan(0);
  });

  test("oportunidades.workspace persiste y recalcula la estrategia recomendada cuando cambian respuestas de etapa", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_workspace_recommended_strategy`,
    );
    const contactQuestions =
      await getStageQuestionRowsByCode("contacto_inicial");

    const firstAnswerResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/stage-answers`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        answers: [
          {
            questionId: Number(contactQuestions[0].id),
            answerValue:
              "El cliente ya confirmo un problema urgente en seguridad de APIs que quiere atender este trimestre, pero aun no deja acordado el siguiente paso.",
          },
        ],
      });

    expect(firstAnswerResponse.status).toBe(200);

    const firstStrategyRows = await query(
      `SELECT heading, route, final_objective, steps_json,
              derived_from_stage_code, updated_at
       FROM opportunity_workspace_recommended_strategy
       WHERE opportunity_id = ?
       LIMIT 1`,
      [fixture.opportunityId],
    );

    expect(firstStrategyRows).toHaveLength(1);
    expect(firstStrategyRows[0].derived_from_stage_code).toBe(
      "contacto_inicial",
    );

    const firstSteps =
      typeof firstStrategyRows[0].steps_json === "string"
        ? JSON.parse(firstStrategyRows[0].steps_json)
        : firstStrategyRows[0].steps_json;
    expect(firstSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Riesgo que puede enfriar la venta",
        }),
      ]),
    );

    const secondAnswerResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/stage-answers`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        answers: [
          {
            questionId: Number(contactQuestions[0].id),
            answerValue:
              "El cliente ya confirmo un problema urgente en seguridad de APIs que quiere atender este trimestre y ya existe una reunion tecnica pactada para la siguiente semana con preventa para validar el siguiente paso comercial.",
          },
        ],
      });

    expect(secondAnswerResponse.status).toBe(200);

    const contextResponse = await request(app)
      .get(`/api/opportunities/${fixture.opportunityId}/commercial-context`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(contextResponse.status).toBe(200);
    expect(contextResponse.body.workspace.recommendedStrategy).toEqual(
      expect.objectContaining({
        heading: expect.any(String),
        route: expect.any(String),
        finalObjective: expect.any(String),
      }),
    );

    const secondStrategyRows = await query(
      `SELECT steps_json, updated_at
       FROM opportunity_workspace_recommended_strategy
       WHERE opportunity_id = ?
       LIMIT 1`,
      [fixture.opportunityId],
    );

    expect(secondStrategyRows).toHaveLength(1);
    expect(
      new Date(secondStrategyRows[0].updated_at).getTime(),
    ).toBeGreaterThanOrEqual(
      new Date(firstStrategyRows[0].updated_at).getTime(),
    );

    const secondSteps =
      typeof secondStrategyRows[0].steps_json === "string"
        ? JSON.parse(secondStrategyRows[0].steps_json)
        : secondStrategyRows[0].steps_json;
    expect(contextResponse.body.workspace.recommendedStrategy.steps).toEqual(
      secondSteps,
    );
    expect(secondSteps.length).toBeGreaterThan(0);
  });

  test("ejecucion comercial resume bandeja, guarda proximo paso y activa cadencias", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_execution_dashboard`,
    );

    await query(
      `DELETE FROM audit_log
       WHERE entity_type = 'opportunity' AND entity_id = ?`,
      [fixture.opportunityId],
    );
    await query(
      `UPDATE opportunities
       SET updated_at = DATE_SUB(NOW(3), INTERVAL 14 DAY)
       WHERE id = ?`,
      [fixture.opportunityId],
    );

    const initialDashboardResponse = await request(app)
      .get("/api/execution-commercial/dashboard")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(initialDashboardResponse.status).toBe(200);
    expect(initialDashboardResponse.body.summary).toEqual(
      expect.objectContaining({
        openOpportunities: expect.any(Number),
        withoutNextStep: expect.any(Number),
      }),
    );

    const initialWorkItem = initialDashboardResponse.body.workboard.find(
      (item) => item.id === fixture.opportunityId,
    );
    expect(initialWorkItem).toBeTruthy();
    expect(initialWorkItem.daysSinceActivity).toBeGreaterThanOrEqual(14);

    const nextStepResponse = await request(app)
      .post(
        `/api/execution-commercial/opportunities/${fixture.opportunityId}/next-step`,
      )
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        title: "Agendar comite con sponsor y decisor",
        actionType: "waiting_customer",
        dueDate: "2026-08-12",
        successCriteria:
          "Confirmar fecha de decision, presupuesto disponible y responsables de compra.",
      });

    expect([200, 201]).toContain(nextStepResponse.status);

    const dependencyResponse = await request(app)
      .post(
        `/api/execution-commercial/opportunities/${fixture.opportunityId}/dependencies`,
      )
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        dependencyType: "presales_support",
        title: "Validacion tecnica de preventa",
        dueDate: "2026-08-10",
        expectedOutcome:
          "Confirmar alcance tecnico y narrativa de valor para presentar la propuesta.",
        details:
          "Se requiere revision tecnica antes de la siguiente reunion con el cliente.",
      });

    expect(dependencyResponse.status).toBe(201);

    const cadenceResponse = await request(app)
      .post("/api/execution-commercial/cadences")
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        opportunityId: fixture.opportunityId,
        cadenceType: "discovery_push",
      });

    expect(cadenceResponse.status).toBe(201);

    const finalDashboardResponse = await request(app)
      .get("/api/execution-commercial/dashboard")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(finalDashboardResponse.status).toBe(200);

    const updatedWorkItem = finalDashboardResponse.body.workboard.find(
      (item) => item.id === fixture.opportunityId,
    );
    expect(updatedWorkItem.nextStep).toEqual(
      expect.objectContaining({
        title: "Agendar comite con sponsor y decisor",
        actionType: "waiting_customer",
      }),
    );
    expect(updatedWorkItem.daysSinceActivity).toBe(0);
    expect(updatedWorkItem.executionState).toEqual(
      expect.objectContaining({
        code: "esperando_interno",
      }),
    );
    expect(updatedWorkItem.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dependencyType: "presales_support",
          title: "Validacion tecnica de preventa",
        }),
      ]),
    );
    expect(updatedWorkItem.reminders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: expect.stringContaining("Cliente"),
        }),
        expect.objectContaining({
          title: expect.stringContaining("Dependencia interna"),
        }),
      ]),
    );

    expect(finalDashboardResponse.body.cadences.active).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          opportunityId: fixture.opportunityId,
          cadenceType: "discovery_push",
        }),
      ]),
    );
    expect(finalDashboardResponse.body.summary).toEqual(
      expect.objectContaining({
        waitingOnInternal: expect.any(Number),
        openDependencies: expect.any(Number),
      }),
    );
    expect(finalDashboardResponse.body.management.executionStateStats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "esperando_interno",
        }),
      ]),
    );
    expect(finalDashboardResponse.body.management.dependencyStats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dependencyType: "presales_support",
        }),
      ]),
    );
  });

  test("desarrollo comercial expone cuota, pipeline y prioridades del trimestre", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_development_dashboard`,
    );

    const actorUserId = ctx.opportunityFlowUserId;
    const now = new Date();

    await query(
      `INSERT INTO commercial_planning_periods
         (plan_year, plan_quarter, base_currency_code, status, notes,
          created_by_user_id, updated_by_user_id, published_at, published_by_user_id,
          created_at, updated_at)
       VALUES (?, ?, 'USD', 'active', ?, ?, ?, ?, ?, ?, ?)`,
      [
        2026,
        4,
        "Plan API desarrollo comercial",
        actorUserId,
        actorUserId,
        now,
        actorUserId,
        now,
        now,
      ],
    );
    const [periodRow] = await query(
      `SELECT id
       FROM commercial_planning_periods
       WHERE plan_year = 2026 AND plan_quarter = 4
       ORDER BY id DESC
       LIMIT 1`,
    );

    await query(
      `INSERT INTO commercial_planning_versions
         (period_id, version_number, label, status, notes,
          created_by_user_id, updated_by_user_id, published_at, published_by_user_id,
          created_at, updated_at)
       VALUES (?, 1, 'T4 2026 v1', 'active', NULL, ?, ?, ?, ?, ?, ?)`,
      [periodRow.id, actorUserId, actorUserId, now, actorUserId, now, now],
    );
    const [versionRow] = await query(
      `SELECT id
       FROM commercial_planning_versions
       WHERE period_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [periodRow.id],
    );

    await query(
      `INSERT INTO commercial_planning_targets
         (version_id, seller_user_id, sales_quota_amount, currency_code,
          expected_margin_percent, expected_contribution_amount, notes, status,
          created_by_user_id, updated_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, 'USD', ?, ?, NULL, 'complete', ?, ?, ?, ?)`,
      [
        versionRow.id,
        actorUserId,
        100000,
        24,
        24000,
        actorUserId,
        actorUserId,
        now,
        now,
      ],
    );

    const dashboardResponse = await request(app)
      .get("/api/commercial-development/dashboard?year=2026&quarter=4")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.body.development).toEqual(
      expect.objectContaining({
        period: expect.objectContaining({
          year: 2026,
          quarter: 4,
          label: "T4 2026",
          hasPlan: true,
        }),
        quota: expect.objectContaining({
          assignedAmount: 100000,
          committedOpenAmount: expect.any(Number),
          actualAmount: expect.any(Number),
          weightedOpenAmount: expect.any(Number),
          projectedAmount: expect.any(Number),
        }),
        pipelineByStage: expect.arrayContaining([
          expect.objectContaining({
            stageName: expect.any(String),
            opportunityCount: expect.any(Number),
            weightedAmount: expect.any(Number),
          }),
        ]),
        priorities: expect.arrayContaining([
          expect.objectContaining({
            id: fixture.opportunityId,
            priorityScore: expect.any(Number),
            impactScore: expect.any(Number),
            primaryRecommendation: expect.any(String),
          }),
        ]),
        recommendations: expect.arrayContaining([
          expect.objectContaining({
            type: expect.any(String),
            title: expect.any(String),
          }),
        ]),
      }),
    );
    expect(dashboardResponse.body.development.actionsToday).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          opportunityId: fixture.opportunityId,
          title: expect.any(String),
        }),
      ]),
    );
  });

  test("desarrollo comercial exige desarrollo_comercial.read ademas de oportunidades.read", async () => {
    const userId = await createUser({
      fullName: `${TEST_PREFIX} Opportunity Readonly`,
      email: `${TEST_PREFIX}.opportunity.readonly@example.com`,
      roleIds: [ctx.opportunityReadOnlyRoleId],
    });
    cleanup.userIds.push(userId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.opportunity.readonly@example.com`,
    );

    const response = await request(app)
      .get("/api/commercial-development/dashboard")
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(response.status).toBe(403);
    expect(response.body.requiredAnyPermission).toEqual([
      "desarrollo_comercial.read",
      "desarrollo_comercial.update",
    ]);
  });

  test("desarrollo comercial permite lectura con desarrollo_comercial.read y bloquea escritura sin desarrollo_comercial.update", async () => {
    const userId = await createUser({
      fullName: `${TEST_PREFIX} Commercial Development Readonly`,
      email: `${TEST_PREFIX}.commercial.development.readonly@example.com`,
      roleIds: [ctx.commercialDevelopmentReadOnlyRoleId],
    });
    cleanup.userIds.push(userId);

    const accountId = await createDirectAccount({
      ownerUserId: userId,
      actorUserId: userId,
      suffix: `${TEST_PREFIX}_commercial_development_readonly`,
    });
    cleanup.accountIds.push(accountId);

    const contactId = await createDirectContact({
      accountId,
      actorUserId: userId,
      suffix: `${TEST_PREFIX}_commercial_development_readonly`,
    });
    cleanup.contactIds.push(contactId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.commercial.development.readonly@example.com`,
    );
    const token = loginResponse.body.token;

    const createOpportunityResponse = await request(app)
      .post("/api/opportunities")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: `Oportunidad lectura ${TEST_PREFIX}`,
        amountUsd: 25000,
        accountId,
        closeDate: "2026-11-30",
        contactId,
        salesStageId: ctx.catalogIds.salesStageWaitingId,
        businessLineId: ctx.catalogIds.businessLineId,
        sellerUserId: ctx.sellerUserId,
        presalesUserId: null,
        activationStatusId: ctx.catalogIds.opportunityActiveStatusId,
      });

    expect(createOpportunityResponse.status).toBe(201);
    const opportunityId = Number(createOpportunityResponse.body.id);
    cleanup.opportunityIds.push(opportunityId);

    const dashboardResponse = await request(app)
      .get("/api/commercial-development/dashboard")
      .set("Authorization", `Bearer ${token}`);

    expect(dashboardResponse.status).toBe(200);

    const createActivityResponse = await request(app)
      .post(
        `/api/commercial-development/opportunities/${opportunityId}/activities`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        activityType: "call",
        scheduledAt: "2026-08-12T16:30:00.000Z",
        objective: "Intento de actividad sin permiso de modulo.",
        note: "No deberia permitirse.",
      });

    expect(createActivityResponse.status).toBe(403);
    expect(createActivityResponse.body.requiredPermission).toBe(
      "desarrollo_comercial.update",
    );
  });

  test("desarrollo comercial permite programar actividad y reflejarla en la tarjeta", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_development_activity`,
    );

    const createActivityResponse = await request(app)
      .post(
        `/api/commercial-development/opportunities/${fixture.opportunityId}/activities`,
      )
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        activityType: "call",
        scheduledAt: "2026-08-12T16:30:00.000Z",
        objective:
          "Confirmar decisor, fecha de comite y condiciones de cierre.",
        note: "Participan sponsor y compras.",
        isPrimaryNextStep: true,
      });

    expect(createActivityResponse.status).toBe(201);
    const activityId = Number(createActivityResponse.body.id);
    expect(activityId).toBeGreaterThan(0);

    const rescheduleActivityResponse = await request(app)
      .patch(
        `/api/commercial-development/opportunities/${fixture.opportunityId}/activities/${activityId}`,
      )
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        activityType: "visit",
        scheduledAt: "2026-08-14T18:00:00.000Z",
        objective: "Revisar propuesta final con sponsor y compras en sitio.",
        note: "Se reprograma por disponibilidad del cliente.",
        isPrimaryNextStep: true,
      });

    expect(rescheduleActivityResponse.status).toBe(200);

    const dashboardResponse = await request(app)
      .get("/api/commercial-development/dashboard")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(dashboardResponse.status).toBe(200);

    const workItem = dashboardResponse.body.workboard.find(
      (item) => item.id === fixture.opportunityId,
    );

    expect(workItem).toEqual(
      expect.objectContaining({
        id: fixture.opportunityId,
        activityCount: expect.any(Number),
        nextScheduledActivity: expect.objectContaining({
          id: activityId,
          activityType: "visit",
          title: "Revisar propuesta final con sponsor y compras en sitio.",
        }),
        nextStep: expect.objectContaining({
          actionType: "visit",
          title: "Revisar propuesta final con sponsor y compras en sitio.",
        }),
        recentActivities: expect.arrayContaining([
          expect.objectContaining({
            id: activityId,
            activityType: "visit",
            title: "Revisar propuesta final con sponsor y compras en sitio.",
          }),
        ]),
      }),
    );
    expect(workItem.activityCount).toBeGreaterThanOrEqual(1);

    const completeActivityResponse = await request(app)
      .patch(
        `/api/commercial-development/opportunities/${fixture.opportunityId}/activities/${activityId}`,
      )
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        status: "done",
        activityType: "visit",
        scheduledAt: "2026-08-14T18:00:00.000Z",
        objective: "Revisar propuesta final con sponsor y compras en sitio.",
        note: "Actividad ejecutada con decision de siguiente revision interna.",
        isPrimaryNextStep: false,
      });

    expect(completeActivityResponse.status).toBe(200);

    const completedDashboardResponse = await request(app)
      .get("/api/commercial-development/dashboard")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(completedDashboardResponse.status).toBe(200);

    const completedWorkItem = completedDashboardResponse.body.workboard.find(
      (item) => item.id === fixture.opportunityId,
    );

    expect(completedWorkItem.nextScheduledActivity).toBeNull();
    expect(completedWorkItem.lastCompletedActivity).toEqual(
      expect.objectContaining({
        id: activityId,
        activityType: "visit",
        status: "done",
      }),
    );
  });

  test("desarrollo comercial.ai-narrative.jobs completa la narrativa asincrona", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_ai_narrative_job`,
    );

    const createResponse = await request(app)
      .post(
        `/api/commercial-development/opportunities/${fixture.opportunityId}/ai-narrative/jobs`,
      )
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    expect(createResponse.status).toBe(202);
    expect(createResponse.body.job.status).toBe("pending");
    expect(createResponse.body.fallback).toEqual(
      expect.objectContaining({
        opportunityId: fixture.opportunityId,
        aiStatusSummary: expect.any(String),
        aiNextStepRecommendation: expect.any(String),
      }),
    );

    await processPendingCommercialNarrativeJobs({ limit: 5 });

    const pollResponse = await request(app)
      .get(
        `/api/commercial-development/opportunities/${fixture.opportunityId}/ai-narrative/jobs/${createResponse.body.job.id}`,
      )
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(pollResponse.status).toBe(200);
    expect(pollResponse.body.job).toEqual(
      expect.objectContaining({
        status: "completed",
        resultAvailable: true,
      }),
    );
    expect(pollResponse.body.result).toEqual(
      expect.objectContaining({
        opportunityId: fixture.opportunityId,
        aiStatusSummary: expect.any(String),
        aiNextStepRecommendation: expect.any(String),
      }),
    );
  });

  test("desarrollo comercial.ai-narrative.jobs expone failed cuando el worker no puede resolver el solicitante", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_ai_narrative_failed`,
    );

    const createResponse = await request(app)
      .post(
        `/api/commercial-development/opportunities/${fixture.opportunityId}/ai-narrative/jobs`,
      )
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    await forceInvalidJobRequester(
      "commercial_opportunity_narrative_jobs",
      createResponse.body.job.id,
    );
    await processPendingCommercialNarrativeJobs({ limit: 5 });

    const pollResponse = await request(app)
      .get(
        `/api/commercial-development/opportunities/${fixture.opportunityId}/ai-narrative/jobs/${createResponse.body.job.id}`,
      )
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(pollResponse.status).toBe(200);
    expect(pollResponse.body.job.status).toBe("failed");
    expect(pollResponse.body.error).toEqual(
      expect.objectContaining({
        code: "requester_not_found",
      }),
    );
    expect(pollResponse.body.fallback).toEqual(
      expect.objectContaining({
        opportunityId: fixture.opportunityId,
      }),
    );
  });

  test("desarrollo comercial.ai-narrative.jobs expone stale cuando cambia la oportunidad antes de procesar", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_ai_narrative_stale`,
    );

    const createResponse = await request(app)
      .post(
        `/api/commercial-development/opportunities/${fixture.opportunityId}/ai-narrative/jobs`,
      )
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    await query(
      `UPDATE opportunities
       SET name = ?, updated_at = NOW(3)
       WHERE id = ?`,
      [
        `Oportunidad narrativa modificada ${TEST_PREFIX}`,
        fixture.opportunityId,
      ],
    );

    await processPendingCommercialNarrativeJobs({ limit: 5 });

    const pollResponse = await request(app)
      .get(
        `/api/commercial-development/opportunities/${fixture.opportunityId}/ai-narrative/jobs/${createResponse.body.job.id}`,
      )
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(pollResponse.status).toBe(200);
    expect(pollResponse.body.job.status).toBe("stale");
    expect(pollResponse.body.error).toEqual(
      expect.objectContaining({
        code: "stale_snapshot",
      }),
    );
  });

  test("desarrollo comercial.ai-narrative.jobs expone expired cuando vence el TTL del resultado", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_ai_narrative_expired`,
    );

    const createResponse = await request(app)
      .post(
        `/api/commercial-development/opportunities/${fixture.opportunityId}/ai-narrative/jobs`,
      )
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    await processPendingCommercialNarrativeJobs({ limit: 5 });
    await query(
      `UPDATE commercial_opportunity_narrative_jobs
       SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE)
       WHERE public_id = ?`,
      [createResponse.body.job.id],
    );

    const pollResponse = await request(app)
      .get(
        `/api/commercial-development/opportunities/${fixture.opportunityId}/ai-narrative/jobs/${createResponse.body.job.id}`,
      )
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(pollResponse.status).toBe(200);
    expect(pollResponse.body.job.status).toBe("expired");
    expect(pollResponse.body.error).toEqual(
      expect.objectContaining({
        code: "expired_result",
      }),
    );
  });

  test("desarrollo comercial expone calendario de actividades por dia semana y mes", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_development_calendar`,
    );

    const createActivityResponse = await request(app)
      .post(
        `/api/commercial-development/opportunities/${fixture.opportunityId}/activities`,
      )
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        activityType: "call",
        scheduledAt: "2026-08-12T16:30:00.000Z",
        objective: "Confirmar status del cierre con sponsor.",
        note: "Agenda semanal.",
        isPrimaryNextStep: true,
      });

    expect(createActivityResponse.status).toBe(201);

    const dayResponse = await request(app)
      .get(
        "/api/commercial-development/calendar?view=day&date=2026-08-12&includeCompleted=false",
      )
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(dayResponse.status).toBe(200);
    expect(dayResponse.body.filters).toEqual(
      expect.objectContaining({
        view: "day",
        date: "2026-08-12",
        rangeStart: "2026-08-12",
        rangeEnd: "2026-08-12",
      }),
    );
    expect(dayResponse.body.days).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          date: "2026-08-12",
          count: 1,
          items: expect.arrayContaining([
            expect.objectContaining({
              opportunityId: fixture.opportunityId,
              opportunityName: expect.any(String),
              activityType: "call",
              status: "pending",
            }),
          ]),
        }),
      ]),
    );

    const weekResponse = await request(app)
      .get(
        "/api/commercial-development/calendar?view=week&date=2026-08-12&includeCompleted=false",
      )
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(weekResponse.status).toBe(200);
    expect(weekResponse.body.filters).toEqual(
      expect.objectContaining({
        view: "week",
        date: "2026-08-12",
        rangeStart: "2026-08-10",
        rangeEnd: "2026-08-16",
      }),
    );
    expect(weekResponse.body.days).toHaveLength(7);

    const monthResponse = await request(app)
      .get(
        "/api/commercial-development/calendar?view=month&date=2026-08-12&includeCompleted=false",
      )
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(monthResponse.status).toBe(200);
    expect(monthResponse.body.filters).toEqual(
      expect.objectContaining({
        view: "month",
        date: "2026-08-12",
        rangeStart: "2026-08-01",
        rangeEnd: "2026-08-31",
      }),
    );
    expect(monthResponse.body.days).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          date: "2026-08-12",
          count: 1,
        }),
      ]),
    );
  });

  test("desarrollo comercial incluye seguimientos de leads con fecha compromiso en el calendario", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_development_calendar_lead_follow_up`,
    );

    const interactionsLoginResponse = await login(
      request(app),
      `${TEST_PREFIX}.interactions.manager@example.com`,
    );

    test("desarrollo comercial evita duplicar un lead con varios eventos en el mismo dia", async () => {
      const fixture = await createOwnedOpportunityFlowFixture(
        `${TEST_PREFIX}_commercial_development_calendar_lead_dedup`,
      );

      const interactionsLoginResponse = await login(
        request(app),
        `${TEST_PREFIX}.interactions.manager@example.com`,
      );

      const createInteractionResponse = await request(app)
        .post("/api/interactions")
        .set("Authorization", `Bearer ${interactionsLoginResponse.body.token}`)
        .field("title", `Lead calendario duplicado ${TEST_PREFIX}`)
        .attach(
          "files",
          Buffer.from(
            [
              "Cuenta: Prospecto Calendario Duplicado",
              "Contacto: Laura Repetida",
              "Correo: laura.repetida@example.com",
            ].join("\n"),
            "utf8",
          ),
          {
            filename: `interaction_calendar_dedup_${TEST_PREFIX}.txt`,
            contentType: "text/plain",
          },
        );

      expect(createInteractionResponse.status).toBe(201);

      const interactionId = Number(createInteractionResponse.body.id);

      await query(
        `UPDATE interactions
       SET account_id = ?,
           primary_opportunity_id = ?,
           seller_user_id = NULL,
           analysis_status = 'lead_assigned',
           lead_substatus_code = 'value_misaligned_current_contact',
           lead_reason_code = 'offer_not_relevant_current_area',
           lead_required_action_code = 'explore_other_area',
           lead_next_action_due_at = ?,
           summary = ?
       WHERE id = ?`,
        [
          fixture.accountId,
          fixture.opportunityId,
          "2026-06-30 00:00:00",
          "Valor no alineado con este contacto.",
          interactionId,
        ],
      );

      await query(
        `INSERT INTO interaction_lead_outcome_events
        (public_id, interaction_id, event_type, from_status_code, to_status_code,
         substatus_code, reason_code, required_action_code, commercial_comment,
         effective_at, created_at, created_by)
       VALUES (?, ?, 'activity_update', 'lead_assigned', 'lead_assigned', ?, ?, ?, ?, ?, ?, ?)`,
        [
          `${TEST_PREFIX}_calendar_dedup_1`,
          interactionId,
          "value_misaligned_current_contact",
          "offer_not_relevant_current_area",
          "explore_other_area",
          "Valor no alineado con este contacto",
          "2026-06-30 10:00:00",
          "2026-06-30 10:00:00",
          ctx.interactionsManagerUserId,
        ],
      );

      await query(
        `INSERT INTO interaction_lead_outcome_events
        (public_id, interaction_id, event_type, from_status_code, to_status_code,
         substatus_code, reason_code, required_action_code, commercial_comment,
         effective_at, created_at, created_by)
       VALUES (?, ?, 'activity_update', 'lead_assigned', 'lead_assigned', ?, ?, ?, ?, ?, ?, ?)`,
        [
          `${TEST_PREFIX}_calendar_dedup_2`,
          interactionId,
          "meeting_confirmed",
          "meeting_accepted",
          "schedule_meeting",
          "Reunión confirmada",
          "2026-06-30 12:00:00",
          "2026-06-30 12:00:00",
          ctx.interactionsManagerUserId,
        ],
      );

      const calendarResponse = await request(app)
        .get(
          "/api/commercial-development/calendar?view=week&date=2026-06-30&includeCompleted=true",
        )
        .set("Authorization", `Bearer ${fixture.token}`);

      expect(calendarResponse.status).toBe(200);

      const targetDay = calendarResponse.body.days.find(
        (day) => day.date === "2026-06-30",
      );

      expect(targetDay).toBeDefined();
      expect(targetDay.items).toHaveLength(1);
      expect(targetDay.items[0]).toEqual(
        expect.objectContaining({
          calendarSource: "interaction",
          activityType: "lead_follow_up",
          interactionId,
          status: "pending",
          title: `Lead calendario duplicado ${TEST_PREFIX}`,
          scheduledDate: "2026-06-30",
        }),
      );
    });

    const createInteractionResponse = await request(app)
      .post("/api/interactions")
      .set("Authorization", `Bearer ${interactionsLoginResponse.body.token}`)
      .field("title", `Lead calendario ${TEST_PREFIX}`)
      .attach(
        "files",
        Buffer.from(
          [
            "Cuenta: Prospecto Calendario",
            "Contacto: Laura Agenda",
            "Correo: laura.agenda@example.com",
          ].join("\n"),
          "utf8",
        ),
        {
          filename: `interaction_calendar_${TEST_PREFIX}.txt`,
          contentType: "text/plain",
        },
      );

    expect(createInteractionResponse.status).toBe(201);

    await query(
      `UPDATE interactions
       SET account_id = ?,
           primary_opportunity_id = ?,
           seller_user_id = NULL,
           analysis_status = 'lead_assigned',
           lead_required_action_code = 'schedule_meeting',
           lead_next_action_due_at = ?,
           summary = ?
       WHERE id = ?`,
      [
        fixture.accountId,
        fixture.opportunityId,
        "2026-08-12 00:00:00",
        "Validar disponibilidad y dejar reunion confirmada.",
        Number(createInteractionResponse.body.id),
      ],
    );

    const calendarResponse = await request(app)
      .get(
        "/api/commercial-development/calendar?view=week&date=2026-08-12&includeCompleted=false",
      )
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(calendarResponse.status).toBe(200);
    expect(calendarResponse.body.days).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          date: "2026-08-12",
          items: expect.arrayContaining([
            expect.objectContaining({
              calendarSource: "interaction",
              activityType: "lead_follow_up",
              title: `Lead calendario ${TEST_PREFIX}`,
              scheduledDate: "2026-08-12",
              accountName: expect.any(String),
              status: "pending",
            }),
          ]),
        }),
      ]),
    );
  });

  test("desarrollo comercial calcula real ganado segun el trimestre seleccionado", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_development_actual_by_quarter`,
    );

    const actorUserId = ctx.opportunityFlowUserId;
    const now = new Date();

    for (const quarter of [1, 2]) {
      await query(
        `INSERT INTO commercial_planning_periods
           (plan_year, plan_quarter, base_currency_code, status, notes,
            created_by_user_id, updated_by_user_id, published_at, published_by_user_id,
            created_at, updated_at)
         VALUES (?, ?, 'USD', 'active', ?, ?, ?, ?, ?, ?, ?)`,
        [
          2027,
          quarter,
          `Plan API desarrollo comercial T${quarter}`,
          actorUserId,
          actorUserId,
          now,
          actorUserId,
          now,
          now,
        ],
      );
      const [periodRow] = await query(
        `SELECT id
         FROM commercial_planning_periods
         WHERE plan_year = 2027 AND plan_quarter = ?
         ORDER BY id DESC
         LIMIT 1`,
        [quarter],
      );

      await query(
        `INSERT INTO commercial_planning_versions
           (period_id, version_number, label, status, notes,
            created_by_user_id, updated_by_user_id, published_at, published_by_user_id,
            created_at, updated_at)
         VALUES (?, 1, ?, 'active', NULL, ?, ?, ?, ?, ?, ?)`,
        [
          periodRow.id,
          `T${quarter} 2027 v1`,
          actorUserId,
          actorUserId,
          now,
          actorUserId,
          now,
          now,
        ],
      );
      const [versionRow] = await query(
        `SELECT id
         FROM commercial_planning_versions
         WHERE period_id = ?
         ORDER BY id DESC
         LIMIT 1`,
        [periodRow.id],
      );

      await query(
        `INSERT INTO commercial_planning_targets
           (version_id, seller_user_id, sales_quota_amount, currency_code,
            expected_margin_percent, expected_contribution_amount, notes, status,
            created_by_user_id, updated_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, 'USD', ?, ?, NULL, 'complete', ?, ?, ?, ?)`,
        [
          versionRow.id,
          actorUserId,
          100000,
          24,
          24000,
          actorUserId,
          actorUserId,
          now,
          now,
        ],
      );
    }

    await query(
      `INSERT INTO opportunities
        (name, amount_usd, account_id, close_date, contact_id,
         sales_stage_id, business_line_id, seller_user_id, presales_user_id, activation_status_id,
         commercial_status_id, created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `Oportunidad ganada ${TEST_PREFIX}_commercial_development_actual_by_quarter`,
        33000,
        fixture.accountId,
        "2027-05-15",
        fixture.contactId,
        ctx.catalogIds.salesStageWaitingId,
        ctx.catalogIds.businessLineId,
        actorUserId,
        null,
        ctx.catalogIds.opportunityActiveStatusId,
        ctx.catalogIds.opportunityCommercialWonStatusId,
        actorUserId,
        now,
        actorUserId,
        now,
      ],
    );
    const [wonOpportunityRow] = await query(
      `SELECT id
       FROM opportunities
       WHERE name = ?
       ORDER BY id DESC
       LIMIT 1`,
      [
        `Oportunidad ganada ${TEST_PREFIX}_commercial_development_actual_by_quarter`,
      ],
    );
    cleanup.opportunityIds.push(Number(wonOpportunityRow.id));

    const q1Response = await request(app)
      .get("/api/commercial-development/dashboard?year=2027&quarter=1")
      .set("Authorization", `Bearer ${fixture.token}`);
    const q2Response = await request(app)
      .get("/api/commercial-development/dashboard?year=2027&quarter=2")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(q1Response.status).toBe(200);
    expect(q2Response.status).toBe(200);
    expect(q1Response.body.development.quota.actualAmount).toBe(0);
    expect(q2Response.body.development.quota.actualAmount).toBe(33000);
  });

  test("desarrollo comercial excluye oportunidades desactivadas del pipeline del periodo", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_dev_dash_inactive`,
    );

    const actorUserId = ctx.opportunityFlowUserId;
    const now = new Date();

    await query(
      `INSERT INTO commercial_planning_periods
         (plan_year, plan_quarter, base_currency_code, status, notes,
          created_by_user_id, updated_by_user_id, published_at, published_by_user_id,
          created_at, updated_at)
       VALUES (?, ?, 'USD', 'active', ?, ?, ?, ?, ?, ?, ?)`,
      [
        2027,
        3,
        "Plan API desarrollo comercial excluye desactivadas",
        actorUserId,
        actorUserId,
        now,
        actorUserId,
        now,
        now,
      ],
    );
    const [periodRow] = await query(
      `SELECT id
       FROM commercial_planning_periods
       WHERE plan_year = 2027 AND plan_quarter = 3
       ORDER BY id DESC
       LIMIT 1`,
      [],
    );

    await query(
      `INSERT INTO commercial_planning_versions
         (period_id, version_number, label, status, notes,
          created_by_user_id, updated_by_user_id, published_at, published_by_user_id,
          created_at, updated_at)
       VALUES (?, 1, 'T3 2027 v1', 'active', NULL, ?, ?, ?, ?, ?, ?)`,
      [periodRow.id, actorUserId, actorUserId, now, actorUserId, now, now],
    );
    const [versionRow] = await query(
      `SELECT id
       FROM commercial_planning_versions
       WHERE period_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [periodRow.id],
    );

    await query(
      `INSERT INTO commercial_planning_targets
         (version_id, seller_user_id, sales_quota_amount, currency_code,
          expected_margin_percent, expected_contribution_amount, notes, status,
          created_by_user_id, updated_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, 'USD', ?, ?, NULL, 'complete', ?, ?, ?, ?)`,
      [
        versionRow.id,
        actorUserId,
        100000,
        24,
        24000,
        actorUserId,
        actorUserId,
        now,
        now,
      ],
    );

    await query(
      `INSERT INTO opportunities
        (name, amount_usd, account_id, close_date, contact_id,
         sales_stage_id, business_line_id, seller_user_id, presales_user_id, activation_status_id,
         commercial_status_id, created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `Oportunidad desactivada ${TEST_PREFIX}_dev_dash_inactive`,
        55000,
        fixture.accountId,
        "2027-08-15",
        fixture.contactId,
        ctx.catalogIds.salesStageWaitingId,
        ctx.catalogIds.businessLineId,
        actorUserId,
        null,
        ctx.catalogIds.opportunityInactiveStatusId,
        ctx.catalogIds.opportunityCommercialInProgressStatusId,
        actorUserId,
        now,
        actorUserId,
        now,
      ],
    );
    const [inactiveOpportunityRow] = await query(
      `SELECT id
       FROM opportunities
       WHERE name = ?
       ORDER BY id DESC
       LIMIT 1`,
      [`Oportunidad desactivada ${TEST_PREFIX}_dev_dash_inactive`],
    );
    cleanup.opportunityIds.push(Number(inactiveOpportunityRow.id));

    const dashboardResponse = await request(app)
      .get("/api/commercial-development/dashboard?year=2027&quarter=3")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.body.development.quota.openAmount).toBe(0);
    expect(dashboardResponse.body.development.pipelineByStage).toEqual([]);
  });

  test("desarrollo comercial limita la cuota trimestral al vendedor autenticado sin alcance global", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_development_scope`,
    );

    const actorUserId = ctx.opportunityFlowUserId;
    const now = new Date();

    await query(
      `INSERT INTO opportunities
        (name, amount_usd, account_id, close_date, contact_id,
         sales_stage_id, business_line_id, seller_user_id, presales_user_id, activation_status_id,
         commercial_status_id, created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `Oportunidad cruzada ${TEST_PREFIX}_commercial_development_scope`,
        27500,
        fixture.accountId,
        "2026-12-20",
        fixture.contactId,
        ctx.catalogIds.salesStageWaitingId,
        ctx.catalogIds.businessLineId,
        ctx.sellerAltUserId,
        null,
        ctx.catalogIds.opportunityActiveStatusId,
        ctx.catalogIds.opportunityCommercialInProgressStatusId,
        actorUserId,
        now,
        actorUserId,
        now,
      ],
    );

    const [crossOpportunityRow] = await query(
      `SELECT id
       FROM opportunities
       WHERE account_id = ?
         AND seller_user_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [fixture.accountId, ctx.sellerAltUserId],
    );
    cleanup.opportunityIds.push(Number(crossOpportunityRow.id));

    await query(
      `INSERT INTO commercial_planning_periods
         (plan_year, plan_quarter, base_currency_code, status, notes,
          created_by_user_id, updated_by_user_id, published_at, published_by_user_id,
          created_at, updated_at)
       VALUES (?, ?, 'USD', 'active', ?, ?, ?, ?, ?, ?, ?)`,
      [
        2026,
        3,
        "Plan API desarrollo comercial con multiples vendedores visibles",
        actorUserId,
        actorUserId,
        now,
        actorUserId,
        now,
        now,
      ],
    );
    const [periodRow] = await query(
      `SELECT id
       FROM commercial_planning_periods
       WHERE plan_year = 2026 AND plan_quarter = 3
       ORDER BY id DESC
       LIMIT 1`,
    );

    await query(
      `INSERT INTO commercial_planning_versions
         (period_id, version_number, label, status, notes,
          created_by_user_id, updated_by_user_id, published_at, published_by_user_id,
          created_at, updated_at)
       VALUES (?, 1, 'T3 2026 v1', 'active', NULL, ?, ?, ?, ?, ?, ?)`,
      [periodRow.id, actorUserId, actorUserId, now, actorUserId, now, now],
    );
    const [versionRow] = await query(
      `SELECT id
       FROM commercial_planning_versions
       WHERE period_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [periodRow.id],
    );

    await query(
      `INSERT INTO commercial_planning_targets
         (version_id, seller_user_id, sales_quota_amount, currency_code,
          expected_margin_percent, expected_contribution_amount, notes, status,
          created_by_user_id, updated_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, 'USD', ?, ?, NULL, 'complete', ?, ?, ?, ?),
              (?, ?, ?, 'USD', ?, ?, NULL, 'complete', ?, ?, ?, ?)`,
      [
        versionRow.id,
        actorUserId,
        100000,
        24,
        24000,
        actorUserId,
        actorUserId,
        now,
        now,
        versionRow.id,
        ctx.sellerAltUserId,
        80000,
        18,
        14400,
        actorUserId,
        actorUserId,
        now,
        now,
      ],
    );

    const dashboardResponse = await request(app)
      .get("/api/commercial-development/dashboard?year=2026&quarter=3")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.body.development.quota).toEqual(
      expect.objectContaining({
        assignedAmount: 100000,
        committedOpenAmount: expect.any(Number),
        targetCount: 1,
      }),
    );
    expect(dashboardResponse.body.development.sellerSnapshots).toEqual([
      expect.objectContaining({
        sellerUserId: actorUserId,
        quotaAmount: 100000,
      }),
    ]);
  });

  test("ritmo comercial calcula la conversion de oportunidades a ventas con las ultimas 20 oportunidades y cae a la configuracion cuando no hay base suficiente", async () => {
    const conversionRoleId = await createRole({
      name: `${TEST_PREFIX}_commercial_tracking_conversion`,
      permissionCodes: [
        "ritmo_comercial.read",
        "ritmo_comercial.read_all",
        "ritmo_comercial.display",
      ],
    });
    cleanup.roleIds.push(conversionRoleId);

    const calculatedSellerUserId = await createUser({
      fullName: "API Seller Conversion Calculated",
      email: `${TEST_PREFIX}.seller.conversion.calculated@example.com`,
      roleIds: [conversionRoleId],
    });
    cleanup.userIds.push(calculatedSellerUserId);

    const fallbackSellerUserId = await createUser({
      fullName: "API Seller Conversion Fallback",
      email: `${TEST_PREFIX}.seller.conversion.fallback@example.com`,
      roleIds: [conversionRoleId],
    });
    cleanup.userIds.push(fallbackSellerUserId);

    const restrictedRoleId = await createRole({
      name: `${TEST_PREFIX}_commercial_tracking_restricted`,
      permissionCodes: ["ritmo_comercial.read", "ritmo_comercial.display"],
    });
    cleanup.roleIds.push(restrictedRoleId);

    const restrictedSellerUserId = await createUser({
      fullName: "API Seller Conversion Restricted",
      email: `${TEST_PREFIX}.seller.conversion.restricted@example.com`,
      roleIds: [restrictedRoleId],
    });
    cleanup.userIds.push(restrictedSellerUserId);

    const now = new Date();
    const calculatedAccountId = await createDirectAccount({
      ownerUserId: calculatedSellerUserId,
      actorUserId: calculatedSellerUserId,
      suffix: `${TEST_PREFIX}_seller_conversion_calculated`,
    });
    cleanup.accountIds.push(calculatedAccountId);

    const calculatedContactId = await createDirectContact({
      accountId: calculatedAccountId,
      actorUserId: calculatedSellerUserId,
      suffix: `${TEST_PREFIX}_seller_conversion_calculated`,
    });
    cleanup.contactIds.push(calculatedContactId);

    const statusSequence = [
      ...Array(7).fill("ganada"),
      ...Array(8).fill("perdida"),
      ...Array(5).fill("en_proceso"),
      "ganada",
    ];

    for (const [index, statusCode] of statusSequence.entries()) {
      const createdAt = new Date(now.getTime() - index * 60_000);
      await query(
        `INSERT INTO opportunities
          (name, amount_usd, account_id, close_date, contact_id,
           sales_stage_id, business_line_id, seller_user_id, presales_user_id, activation_status_id,
           commercial_status_id, created_by, created_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `Oportunidad conversion ${index + 1} ${TEST_PREFIX}`,
          10000 + index * 1000,
          calculatedAccountId,
          "2026-12-31",
          calculatedContactId,
          ctx.catalogIds.salesStageInitialId,
          ctx.catalogIds.businessLineId,
          calculatedSellerUserId,
          null,
          ctx.catalogIds.opportunityActiveStatusId,
          ctx.catalogIds[
            `opportunityCommercial${statusCode === "ganada" ? "Won" : statusCode === "perdida" ? "Lost" : "InProgress"}StatusId`
          ],
          calculatedSellerUserId,
          createdAt,
          calculatedSellerUserId,
          createdAt,
        ],
      );
    }

    await query(
      `INSERT INTO commercial_planning_seller_parameters
        (seller_user_id, average_sale_ticket_amount, leads_to_opportunities_ratio,
         opportunities_to_wins_ratio, average_opportunity_to_win_days,
         created_by_user_id, updated_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         average_sale_ticket_amount = VALUES(average_sale_ticket_amount),
         leads_to_opportunities_ratio = VALUES(leads_to_opportunities_ratio),
         opportunities_to_wins_ratio = VALUES(opportunities_to_wins_ratio),
         average_opportunity_to_win_days = VALUES(average_opportunity_to_win_days),
         updated_by_user_id = VALUES(updated_by_user_id),
         updated_at = VALUES(updated_at)`,
      [
        fallbackSellerUserId,
        90000,
        0,
        0.42,
        12,
        calculatedSellerUserId,
        calculatedSellerUserId,
        now,
        now,
      ],
    );

    const conversionLogin = await login(
      request(app),
      `${TEST_PREFIX}.seller.conversion.calculated@example.com`,
    );

    const response = await request(app)
      .get("/api/commercial-tracking/seller-league-tv")
      .set("Authorization", `Bearer ${conversionLogin.body.token}`);

    expect(response.status).toBe(200);

    const calculatedRow = response.body.leaderboard.find(
      (row) => row.sellerUserId === calculatedSellerUserId,
    );
    const fallbackRow = response.body.leaderboard.find(
      (row) => row.sellerUserId === fallbackSellerUserId,
    );

    expect(calculatedRow).toEqual(
      expect.objectContaining({
        opportunityToWinCurrentRatio: 0.35,
        opportunityToWinEffectiveRatio: 0.35,
      }),
    );
    expect(fallbackRow).toEqual(
      expect.objectContaining({
        opportunityToWinCurrentRatio: null,
        opportunityToWinEffectiveRatio: 0.42,
      }),
    );

    const restrictedLogin = await login(
      request(app),
      `${TEST_PREFIX}.seller.conversion.restricted@example.com`,
    );

    const restrictedListResponse = await request(app)
      .get("/api/commercial-tracking/seller-league-tv")
      .set("Authorization", `Bearer ${restrictedLogin.body.token}`);

    expect(restrictedListResponse.status).toBe(200);
    expect(restrictedListResponse.body.permissions).toEqual(
      expect.objectContaining({ canReadAllSellers: false }),
    );
    expect(
      restrictedListResponse.body.leaderboard.map((row) => row.sellerUserId),
    ).toEqual([restrictedSellerUserId]);

    const forbiddenDetailResponse = await request(app)
      .get(
        `/api/commercial-tracking/seller-league-tv?sellerUserId=${calculatedSellerUserId}`,
      )
      .set("Authorization", `Bearer ${restrictedLogin.body.token}`);

    expect(forbiddenDetailResponse.status).toBe(403);
  });

  test("ejecucion comercial prioriza cadencias por score de friccion", async () => {
    const activateFixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_execution_activate`,
    );
    const watchFixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_execution_watch`,
    );
    const healthyFixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_execution_healthy`,
    );

    await query(
      `DELETE FROM audit_log
       WHERE entity_type = 'opportunity' AND entity_id = ?`,
      [activateFixture.opportunityId],
    );
    await query(
      `UPDATE opportunities
       SET updated_at = DATE_SUB(NOW(3), INTERVAL 15 DAY)
       WHERE id = ?`,
      [activateFixture.opportunityId],
    );
    await query(
      `UPDATE opportunities
       SET sales_stage_id = ?, updated_at = NOW(3)
       WHERE id = ?`,
      [ctx.catalogIds.salesStageWaitingId, healthyFixture.opportunityId],
    );

    const healthyNextStepResponse = await request(app)
      .post(
        `/api/execution-commercial/opportunities/${healthyFixture.opportunityId}/next-step`,
      )
      .set("Authorization", `Bearer ${healthyFixture.token}`)
      .send({
        title: "Preparar revision final con compras",
        actionType: "follow_up",
        dueDate: "2026-08-18",
        successCriteria:
          "Validar terminos finales y confirmar fecha de decision.",
      });

    expect([200, 201]).toContain(healthyNextStepResponse.status);

    const dashboardResponse = await request(app)
      .get("/api/execution-commercial/dashboard")
      .set("Authorization", `Bearer ${activateFixture.token}`);

    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.body.cadences).toEqual(
      expect.objectContaining({
        totalSuggested: expect.any(Number),
        activateCount: expect.any(Number),
        watchCount: expect.any(Number),
        visibleLimit: 10,
      }),
    );

    const activateSuggestion = dashboardResponse.body.cadences.suggested.find(
      (item) => item.opportunityId === activateFixture.opportunityId,
    );
    const watchSuggestion = dashboardResponse.body.cadences.suggested.find(
      (item) => item.opportunityId === watchFixture.opportunityId,
    );
    const healthySuggestion = dashboardResponse.body.cadences.suggested.find(
      (item) => item.opportunityId === healthyFixture.opportunityId,
    );

    expect(activateSuggestion).toEqual(
      expect.objectContaining({
        cadenceDecision: "activate",
        cadenceType: "rescue_inactive",
        frictionScore: expect.any(Number),
      }),
    );
    expect(watchSuggestion).toEqual(
      expect.objectContaining({
        cadenceDecision: "watch",
        cadenceType: "discovery_push",
        frictionScore: expect.any(Number),
      }),
    );
    expect(activateSuggestion.frictionScore).toBeGreaterThan(
      watchSuggestion.frictionScore,
    );
    expect(healthySuggestion).toBeUndefined();
    expect(
      dashboardResponse.body.cadences.activateCount,
    ).toBeGreaterThanOrEqual(1);
    expect(dashboardResponse.body.cadences.watchCount).toBeGreaterThanOrEqual(
      1,
    );
  });

  test("oportunidades.workspace expone playbooks, permite eliminar registros y audita el historial", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_workspace_governance`,
    );

    const playbooksResponse = await request(app)
      .get("/api/opportunities/workspace-playbooks")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(playbooksResponse.status).toBe(200);
    expect(playbooksResponse.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: expect.any(String),
          version: "v1",
          stageCount: expect.any(Number),
          criteriaCount: expect.any(Number),
          isActive: true,
        }),
      ]),
    );

    const weaknessResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/workspace/weaknesses`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        title: "Presupuesto aun no validado",
        category: "budget",
        severity: "medium",
        status: "open",
        detail: "El cliente no confirma rango presupuestal.",
      });

    expect(weaknessResponse.status).toBe(200);

    const assessmentResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/workspace/assessments`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        criterionCode: "contacto_follow_up",
        salesStageId: ctx.catalogIds.salesStageInitialId,
        status: "solid",
        score: 3,
        confidence: "high",
        summary: "Seguimiento comercial ya acordado con el cliente.",
      });

    expect(assessmentResponse.status).toBe(200);

    const deleteWeaknessResponse = await request(app)
      .delete(
        `/api/opportunities/${fixture.opportunityId}/workspace/weaknesses/${weaknessResponse.body.id}`,
      )
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(deleteWeaknessResponse.status).toBe(200);

    const deleteAssessmentResponse = await request(app)
      .delete(
        `/api/opportunities/${fixture.opportunityId}/workspace/assessments/contacto_follow_up`,
      )
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(deleteAssessmentResponse.status).toBe(200);

    const contextResponse = await request(app)
      .get(`/api/opportunities/${fixture.opportunityId}/commercial-context`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(contextResponse.status).toBe(200);
    expect(contextResponse.body.workspace.playbook).toEqual(
      expect.objectContaining({
        version: "v1",
        stageCount: expect.any(Number),
        criteriaCount: expect.any(Number),
      }),
    );
    expect(contextResponse.body.workspace.weaknesses).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Presupuesto aun no validado" }),
      ]),
    );
    expect(contextResponse.body.workspace.currentStage.checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          criterionCode: "contacto_follow_up",
          status: "missing",
        }),
      ]),
    );
    expect(contextResponse.body.workspace.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: expect.stringContaining("Assessment eliminado"),
        }),
        expect.objectContaining({
          label: expect.stringContaining("Debilidad eliminada"),
        }),
      ]),
    );
  });

  test("oportunidades.workspace permite activar una nueva version de playbook y commercial-context la usa", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_workspace_playbook_activation`,
    );
    const configurationLoginResponse = await login(
      request(app),
      `${TEST_PREFIX}.configuration.manager@example.com`,
    );
    const configurationToken = configurationLoginResponse.body.token;

    const playbooksResponse = await request(app)
      .get("/api/opportunities/workspace-playbooks")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(playbooksResponse.status).toBe(200);
    const activePlaybook = playbooksResponse.body.items.find(
      (item) => item.isActive,
    );
    expect(activePlaybook).toBeTruthy();

    const newVersionInsert = await query(
      `INSERT INTO opportunity_playbook_versions (playbook_id, version_label, is_active)
       VALUES (?, ?, 0)`,
      [activePlaybook.playbookId, "v2"],
    );
    const newVersionId = Number(newVersionInsert.insertId);

    const templateRows = await query(
      `SELECT id, sales_stage_id, display_order, objective, exit_criteria_summary
       FROM opportunity_playbook_stage_templates
       WHERE playbook_version_id = ?
       ORDER BY display_order, id`,
      [activePlaybook.versionId],
    );
    const templateIdMap = new Map();
    for (const row of templateRows) {
      const insertTemplate = await query(
        `INSERT INTO opportunity_playbook_stage_templates (
          playbook_version_id,
          sales_stage_id,
          display_order,
          objective,
          exit_criteria_summary
        ) VALUES (?, ?, ?, ?, ?)`,
        [
          newVersionId,
          row.sales_stage_id,
          row.display_order,
          Number(row.sales_stage_id) ===
          Number(ctx.catalogIds.salesStageInitialId)
            ? "Objetivo v2: confirmar siguiente reunion con responsables tecnicos y economicos."
            : row.objective,
          row.exit_criteria_summary,
        ],
      );
      templateIdMap.set(Number(row.id), Number(insertTemplate.insertId));
    }

    for (const row of templateRows) {
      const criteriaRows = await query(
        `SELECT code, title, description, theme_code, display_order, is_required
         FROM opportunity_playbook_stage_criteria
         WHERE stage_template_id = ?
         ORDER BY display_order, id`,
        [row.id],
      );
      for (const criterion of criteriaRows) {
        await query(
          `INSERT INTO opportunity_playbook_stage_criteria (
            stage_template_id,
            code,
            title,
            description,
            theme_code,
            display_order,
            is_required
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            templateIdMap.get(Number(row.id)),
            criterion.code,
            criterion.title,
            criterion.description,
            criterion.theme_code,
            criterion.display_order,
            criterion.is_required,
          ],
        );
      }
    }

    const activateResponse = await request(app)
      .post(`/api/opportunities/workspace-playbooks/${newVersionId}/activate`)
      .set("Authorization", `Bearer ${configurationToken}`);

    expect(activateResponse.status).toBe(200);
    expect(activateResponse.body.playbook).toEqual(
      expect.objectContaining({ version: "v2" }),
    );

    const contextResponse = await request(app)
      .get(`/api/opportunities/${fixture.opportunityId}/commercial-context`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(contextResponse.status).toBe(200);
    expect(contextResponse.body.workspace.playbook).toEqual(
      expect.objectContaining({ version: "v2" }),
    );
    expect(contextResponse.body.workspace.currentStage).toEqual(
      expect.objectContaining({
        objective:
          "Objetivo v2: confirmar siguiente reunion con responsables tecnicos y economicos.",
      }),
    );

    const restoreResponse = await request(app)
      .post(
        `/api/opportunities/workspace-playbooks/${activePlaybook.versionId}/activate`,
      )
      .set("Authorization", `Bearer ${configurationToken}`);

    expect(restoreResponse.status).toBe(200);
  });

  test("oportunidades.workspace deriva evidencia tematica y stakeholders sugeridos desde documentos", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_workspace_document_evidence`,
    );

    await attachOpportunityDocumentForTest({
      opportunityId: fixture.opportunityId,
      uploadedByUserId: ctx.opportunityFlowUserId,
      suffix: `${TEST_PREFIX}_workspace_signal`,
      text: `
        El director de infraestructura y el equipo de compras participaran en la evaluacion.
        Existe presupuesto preliminar aprobado para la iniciativa y se espera confirmar el monto final este mes.
        La proxima reunion tecnica quedo agendada para la siguiente semana para validar arquitectura y criterios de exito.
      `,
    });

    const contextResponse = await request(app)
      .get(`/api/opportunities/${fixture.opportunityId}/commercial-context`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(contextResponse.status).toBe(200);

    const budgetTheme = contextResponse.body.workspace.themes.find(
      (item) => item.code === "budget",
    );
    expect(budgetTheme).toEqual(
      expect.objectContaining({
        evidenceCount: expect.any(Number),
      }),
    );
    expect(budgetTheme.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "document",
        }),
      ]),
    );

    expect(contextResponse.body.workspace.recommendations.stakeholders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roleCode: "technical_buyer",
        }),
        expect.objectContaining({
          roleCode: "economic_buyer",
        }),
      ]),
    );

    expect(contextResponse.body.workspace.summary.health).toEqual(
      expect.objectContaining({
        overallLabel: expect.stringMatching(/Debil|Parcial|Solido/),
        overallTone: expect.stringMatching(/red|amber|green/),
      }),
    );

    expect(contextResponse.body.workspace.scorecard.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "urgency",
          statusLabel: "Parcial",
          checklist: expect.arrayContaining([
            expect.objectContaining({
              key: "time-horizon",
              checked: true,
            }),
            expect.objectContaining({
              key: "scheduled-next-step",
              checked: false,
            }),
          ]),
        }),
        expect.objectContaining({
          key: "budget",
          statusLabel: expect.stringMatching(/Debil|Parcial|Solido/),
          checklist: expect.arrayContaining([
            expect.objectContaining({
              key: "budget-discussed",
              checked: true,
            }),
          ]),
        }),
        expect.objectContaining({
          key: "deciders",
          statusLabel: expect.stringMatching(
            /Sin informacion|Debil|Parcial|Solido/,
          ),
          checklist: expect.arrayContaining([
            expect.objectContaining({
              key: "relevant-contact",
              checked: expect.any(Boolean),
            }),
            expect.objectContaining({
              key: "economic-buyer",
              checked: expect.any(Boolean),
            }),
          ]),
        }),
        expect.objectContaining({
          key: "no_decision_risk",
          statusLabel: expect.stringMatching(/Bajo|Medio|Alto/),
          checklist: expect.arrayContaining([
            expect.objectContaining({
              key: "no-next-step",
              checked: true,
            }),
          ]),
        }),
      ]),
    );
  });

  test("oportunidades.workspace permite editar el playbook activo y commercial-context refleja los cambios", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_workspace_playbook_edit`,
    );
    const configurationLoginResponse = await login(
      request(app),
      `${TEST_PREFIX}.configuration.manager@example.com`,
    );
    const configurationToken = configurationLoginResponse.body.token;

    const playbooksResponse = await request(app)
      .get("/api/opportunities/workspace-playbooks")
      .set("Authorization", `Bearer ${configurationToken}`);

    expect(playbooksResponse.status).toBe(200);
    const activePlaybook = playbooksResponse.body.items.find(
      (item) => item.isActive,
    );
    expect(activePlaybook).toBeTruthy();

    const detailResponse = await request(app)
      .get(`/api/opportunities/workspace-playbooks/${activePlaybook.versionId}`)
      .set("Authorization", `Bearer ${configurationToken}`);

    expect(detailResponse.status).toBe(200);

    const initialStage = detailResponse.body.playbook.stages.find(
      (item) => item.stageCode === "contacto_inicial",
    );
    expect(initialStage).toBeTruthy();

    const stageUpdateResponse = await request(app)
      .put(
        `/api/opportunities/workspace-playbooks/${activePlaybook.versionId}/stages/contacto_inicial`,
      )
      .set("Authorization", `Bearer ${configurationToken}`)
      .send({
        objective:
          "Objetivo configurado: dejar validado el siguiente paso con comprador tecnico y sponsor economico.",
        exitCriteriaSummary:
          "Debe existir siguiente reunion, necesidad clara y actores iniciales identificados.",
      });

    expect(stageUpdateResponse.status).toBe(200);
    expect(stageUpdateResponse.body.playbook.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stageCode: "contacto_inicial",
          objective:
            "Objetivo configurado: dejar validado el siguiente paso con comprador tecnico y sponsor economico.",
        }),
      ]),
    );

    const criterionUpdateResponse = await request(app)
      .put(
        `/api/opportunities/workspace-playbooks/${activePlaybook.versionId}/stages/contacto_inicial/criteria/contacto_need`,
      )
      .set("Authorization", `Bearer ${configurationToken}`)
      .send({
        title: "Necesidad priorizada con impacto operativo",
        description:
          "La necesidad debe describir impacto, urgencia y criterio de exito esperado.",
        themeCode: "pain",
        displayOrder: 1,
      });

    expect(criterionUpdateResponse.status).toBe(200);
    expect(criterionUpdateResponse.body.playbook.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stageCode: "contacto_inicial",
          criteria: expect.arrayContaining([
            expect.objectContaining({
              criterionCode: "contacto_need",
              title: "Necesidad priorizada con impacto operativo",
            }),
          ]),
        }),
      ]),
    );

    const contextResponse = await request(app)
      .get(`/api/opportunities/${fixture.opportunityId}/commercial-context`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(contextResponse.status).toBe(200);
    expect(contextResponse.body.workspace.currentStage).toEqual(
      expect.objectContaining({
        objective:
          "Objetivo configurado: dejar validado el siguiente paso con comprador tecnico y sponsor economico.",
      }),
    );
    expect(contextResponse.body.workspace.currentStage.checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          criterionCode: "contacto_need",
          title: "Necesidad priorizada con impacto operativo",
        }),
      ]),
    );
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
    expect(
      (stageViewResponse.body.workspace?.weaknesses || []).some(
        (item) => item.salesStageCode === "waiting",
      ),
    ).toBe(false);
    expect(stageViewResponse.body.features).toEqual(
      expect.objectContaining({
        documentAnswerSuggestionsEnabled: expect.any(Boolean),
        rolloutKey: "opportunity_stage_answer_suggestions",
        configuredByEnv: expect.any(Boolean),
      }),
    );
  });

  test("oportunidades.propose-answers devuelve propuestas y resumen para la etapa seleccionada", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_answer_suggestions`,
    );
    const waitingQuestions = await getStageQuestionRowsByCode("waiting");
    const [firstQuestion] = waitingQuestions;

    await attachOpportunityDocumentForTest({
      opportunityId: fixture.opportunityId,
      uploadedByUserId: ctx.opportunityFlowUserId,
      suffix: `${TEST_PREFIX}_waiting_answer`,
      text: `El cliente confirmo que comparara postores durante mayo y definira al ganador la siguiente semana.`,
    });

    const originalApiKey = config.openai.apiKey;
    const originalFlag =
      config.features.opportunityStageAnswerSuggestionsEnabled;
    const originalFetch = global.fetch;

    try {
      config.openai.apiKey = "test-key";
      config.features.opportunityStageAnswerSuggestionsEnabled = true;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            suggestions: [
              {
                questionId: Number(firstQuestion.id),
                status: "proposed",
                proposalKind: "fill_empty",
                proposedAnswer:
                  "El cliente decidira entre varios postores y espera cerrar la definicion la siguiente semana.",
                reason:
                  "La minuta indica comparacion entre postores con una decision cercana.",
              },
            ],
          }),
        }),
      });

      const response = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/stage-view/${ctx.catalogIds.salesStageWaitingId}/propose-answers`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.suggestions).toHaveLength(1);
      expect(response.body.suggestions[0]).toEqual(
        expect.objectContaining({
          questionId: Number(firstQuestion.id),
          status: "proposed",
          proposalKind: "fill_empty",
        }),
      );
      expect(response.body.summary).toEqual({
        proposedCount: 1,
        fillCount: 1,
        replaceCount: 0,
        ambiguousCount: 0,
        insufficientCount: 0,
      });
      expect(response.body.meta).toEqual(
        expect.objectContaining({
          questionCount: 1,
          documentCount: 1,
          stageGuideAvailable: true,
        }),
      );
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
      config.features.opportunityStageAnswerSuggestionsEnabled = originalFlag;
    }
  });

  test("oportunidades.propose-answers responde 404 cuando la feature está deshabilitada", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_answer_suggestions_disabled`,
    );

    const originalApiKey = config.openai.apiKey;
    const originalFlag =
      config.features.opportunityStageAnswerSuggestionsEnabled;

    try {
      config.openai.apiKey = "test-key";
      config.features.opportunityStageAnswerSuggestionsEnabled = false;

      const response = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/stage-view/${ctx.catalogIds.salesStageWaitingId}/propose-answers`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.message).toContain("no estan habilitadas");
    } finally {
      config.openai.apiKey = originalApiKey;
      config.features.opportunityStageAnswerSuggestionsEnabled = originalFlag;
    }
  });

  test("oportunidades.propose-answers.jobs crea un job y luego expone el resultado completado", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_answer_async_job_flow`,
    );
    const waitingQuestions = await getStageQuestionRowsByCode("waiting");
    const [firstQuestion] = waitingQuestions;

    await attachOpportunityDocumentForTest({
      opportunityId: fixture.opportunityId,
      uploadedByUserId: ctx.opportunityFlowUserId,
      suffix: `${TEST_PREFIX}_waiting_answer_async_job`,
      text: "El cliente confirmo que evaluara a los postores y espera tomar la decision la siguiente semana.",
    });

    const originalApiKey = config.openai.apiKey;
    const originalFlag =
      config.features.opportunityStageAnswerSuggestionsEnabled;
    const originalFetch = global.fetch;

    try {
      config.openai.apiKey = "test-key";
      config.features.opportunityStageAnswerSuggestionsEnabled = true;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            suggestions: [
              {
                questionId: Number(firstQuestion.id),
                status: "proposed",
                proposalKind: "fill_empty",
                proposedAnswer:
                  "El cliente evaluara a los postores y espera tomar la decision la siguiente semana.",
                reason:
                  "La minuta documenta una comparacion de postores con una decision cercana.",
              },
            ],
          }),
        }),
      });

      const createResponse = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/stage-view/${ctx.catalogIds.salesStageWaitingId}/propose-answers/jobs`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({});

      expect(createResponse.status).toBe(202);
      expect(createResponse.body.job).toEqual(
        expect.objectContaining({
          status: "pending",
        }),
      );

      const jobId = String(createResponse.body.job.id || "");
      expect(jobId).toBeTruthy();

      const pendingResponse = await request(app)
        .get(
          `/api/opportunities/${fixture.opportunityId}/stage-view/${ctx.catalogIds.salesStageWaitingId}/propose-answers/jobs/${jobId}`,
        )
        .set("Authorization", `Bearer ${fixture.token}`);

      expect(pendingResponse.status).toBe(200);
      expect(pendingResponse.body.job.status).toBe("pending");

      await processPendingOpportunityStageAnswerSuggestionJobs({ limit: 1 });

      const completedResponse = await request(app)
        .get(
          `/api/opportunities/${fixture.opportunityId}/stage-view/${ctx.catalogIds.salesStageWaitingId}/propose-answers/jobs/${jobId}`,
        )
        .set("Authorization", `Bearer ${fixture.token}`);

      expect(completedResponse.status).toBe(200);
      expect(completedResponse.body.job.status).toBe("completed");
      expect(completedResponse.body.result.suggestions).toHaveLength(1);
      expect(completedResponse.body.result.suggestions[0]).toEqual(
        expect.objectContaining({
          questionId: Number(firstQuestion.id),
          status: "proposed",
          proposalKind: "fill_empty",
        }),
      );
      expect(completedResponse.body.result.summary).toEqual({
        proposedCount: 1,
        fillCount: 1,
        replaceCount: 0,
        ambiguousCount: 0,
        insufficientCount: 0,
      });
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
      config.features.opportunityStageAnswerSuggestionsEnabled = originalFlag;
    }
  });

  test("oportunidades.propose-answers.jobs reutiliza un resultado completado con el mismo fingerprint", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_answer_async_job_reuse`,
    );
    const waitingQuestions = await getStageQuestionRowsByCode("waiting");
    const [firstQuestion] = waitingQuestions;

    await attachOpportunityDocumentForTest({
      opportunityId: fixture.opportunityId,
      uploadedByUserId: ctx.opportunityFlowUserId,
      suffix: `${TEST_PREFIX}_waiting_answer_async_job_reuse`,
      text: "El cliente definira al ganador del proceso durante la siguiente semana despues de comparar propuestas.",
    });

    const originalApiKey = config.openai.apiKey;
    const originalFlag =
      config.features.opportunityStageAnswerSuggestionsEnabled;
    const originalFetch = global.fetch;

    try {
      config.openai.apiKey = "test-key";
      config.features.opportunityStageAnswerSuggestionsEnabled = true;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            suggestions: [
              {
                questionId: Number(firstQuestion.id),
                status: "proposed",
                proposalKind: "fill_empty",
                proposedAnswer:
                  "El cliente definira al ganador del proceso la siguiente semana despues de comparar propuestas.",
                reason:
                  "El documento resume la comparacion de propuestas y la fecha de decision.",
              },
            ],
          }),
        }),
      });

      const firstCreateResponse = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/stage-view/${ctx.catalogIds.salesStageWaitingId}/propose-answers/jobs`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({});

      expect(firstCreateResponse.status).toBe(202);
      const firstJobId = String(firstCreateResponse.body.job.id || "");
      expect(firstJobId).toBeTruthy();

      await processPendingOpportunityStageAnswerSuggestionJobs({ limit: 1 });

      const secondCreateResponse = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/stage-view/${ctx.catalogIds.salesStageWaitingId}/propose-answers/jobs`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({});

      expect(secondCreateResponse.status).toBe(200);
      expect(secondCreateResponse.body.job.id).toBe(firstJobId);
      expect(secondCreateResponse.body.job.status).toBe("completed");
      expect(secondCreateResponse.body.result.suggestions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            questionId: Number(firstQuestion.id),
            status: "proposed",
            proposalKind: "fill_empty",
          }),
        ]),
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
      config.features.opportunityStageAnswerSuggestionsEnabled = originalFlag;
    }
  });

  test("oportunidades.propose-answers.jobs expone failed cuando la generacion falla", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_answer_async_job_failed`,
    );

    await attachOpportunityDocumentForTest({
      opportunityId: fixture.opportunityId,
      uploadedByUserId: ctx.opportunityFlowUserId,
      suffix: `${TEST_PREFIX}_waiting_answer_async_job_failed`,
      text: "El cliente sigue evaluando opciones y definira al ganador despues del comite.",
    });

    const originalApiKey = config.openai.apiKey;
    const originalFlag =
      config.features.opportunityStageAnswerSuggestionsEnabled;
    const originalFetch = global.fetch;

    try {
      config.openai.apiKey = "test-key";
      config.features.opportunityStageAnswerSuggestionsEnabled = true;
      global.fetch = vi
        .fn()
        .mockRejectedValue(new Error("OpenAI downstream failure"));

      const createResponse = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/stage-view/${ctx.catalogIds.salesStageWaitingId}/propose-answers/jobs`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({});

      expect(createResponse.status).toBe(202);
      const jobId = String(createResponse.body.job.id || "");
      expect(jobId).toBeTruthy();

      await processPendingOpportunityStageAnswerSuggestionJobs({ limit: 1 });

      const failedResponse = await request(app)
        .get(
          `/api/opportunities/${fixture.opportunityId}/stage-view/${ctx.catalogIds.salesStageWaitingId}/propose-answers/jobs/${jobId}`,
        )
        .set("Authorization", `Bearer ${fixture.token}`);

      expect(failedResponse.status).toBe(200);
      expect(failedResponse.body.job.status).toBe("failed");
      expect(failedResponse.body.error).toEqual(
        expect.objectContaining({
          code: "generation_failed",
        }),
      );
      expect(String(failedResponse.body.error.message || "")).toContain(
        "OpenAI downstream failure",
      );
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
      config.features.opportunityStageAnswerSuggestionsEnabled = originalFlag;
    }
  });

  test("oportunidades.propose-answers.jobs expone stale cuando cambia la evidencia antes de procesar", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_answer_async_job_stale`,
    );

    await attachOpportunityDocumentForTest({
      opportunityId: fixture.opportunityId,
      uploadedByUserId: ctx.opportunityFlowUserId,
      suffix: `${TEST_PREFIX}_waiting_answer_async_job_stale_initial`,
      text: "El cliente comparara propuestas y espera decidir pronto.",
    });

    const originalApiKey = config.openai.apiKey;
    const originalFlag =
      config.features.opportunityStageAnswerSuggestionsEnabled;
    const originalFetch = global.fetch;

    try {
      config.openai.apiKey = "test-key";
      config.features.opportunityStageAnswerSuggestionsEnabled = true;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            suggestions: [],
          }),
        }),
      });

      const createResponse = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/stage-view/${ctx.catalogIds.salesStageWaitingId}/propose-answers/jobs`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({});

      expect(createResponse.status).toBe(202);
      const jobId = String(createResponse.body.job.id || "");
      expect(jobId).toBeTruthy();

      await attachOpportunityDocumentForTest({
        opportunityId: fixture.opportunityId,
        uploadedByUserId: ctx.opportunityFlowUserId,
        suffix: `${TEST_PREFIX}_waiting_answer_async_job_stale_new`,
        text: "Se agrego una nueva minuta con evidencia distinta antes de terminar la generacion.",
      });

      await processPendingOpportunityStageAnswerSuggestionJobs({ limit: 1 });

      const staleResponse = await request(app)
        .get(
          `/api/opportunities/${fixture.opportunityId}/stage-view/${ctx.catalogIds.salesStageWaitingId}/propose-answers/jobs/${jobId}`,
        )
        .set("Authorization", `Bearer ${fixture.token}`);

      expect(staleResponse.status).toBe(200);
      expect(staleResponse.body.job.status).toBe("stale");
      expect(staleResponse.body.error).toEqual(
        expect.objectContaining({
          code: "stale_result",
        }),
      );
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
      config.features.opportunityStageAnswerSuggestionsEnabled = originalFlag;
    }
  });

  test("oportunidades.propose-answers.jobs expone expired cuando un terminal vence su TTL", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_answer_async_job_expired`,
    );

    await attachOpportunityDocumentForTest({
      opportunityId: fixture.opportunityId,
      uploadedByUserId: ctx.opportunityFlowUserId,
      suffix: `${TEST_PREFIX}_waiting_answer_async_job_expired`,
      text: "El cliente revisara propuestas y definira el siguiente paso en breve.",
    });

    const originalApiKey = config.openai.apiKey;
    const originalFlag =
      config.features.opportunityStageAnswerSuggestionsEnabled;

    try {
      config.openai.apiKey = "test-key";
      config.features.opportunityStageAnswerSuggestionsEnabled = true;

      const createResponse = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/stage-view/${ctx.catalogIds.salesStageWaitingId}/propose-answers/jobs`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({});

      expect(createResponse.status).toBe(202);
      const jobId = String(createResponse.body.job.id || "");
      expect(jobId).toBeTruthy();

      await query(
        `UPDATE opportunity_stage_answer_suggestion_jobs
         SET status = 'failed',
             error_code = NULL,
             error_message = NULL,
             expires_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND),
             updated_at = NOW(3)
         WHERE public_id = ?`,
        [jobId],
      );

      const expiredResponse = await request(app)
        .get(
          `/api/opportunities/${fixture.opportunityId}/stage-view/${ctx.catalogIds.salesStageWaitingId}/propose-answers/jobs/${jobId}`,
        )
        .set("Authorization", `Bearer ${fixture.token}`);

      expect(expiredResponse.status).toBe(200);
      expect(expiredResponse.body.job.status).toBe("expired");
      expect(expiredResponse.body.error).toEqual(
        expect.objectContaining({
          code: "expired_result",
        }),
      );
    } finally {
      config.openai.apiKey = originalApiKey;
      config.features.opportunityStageAnswerSuggestionsEnabled = originalFlag;
    }
  });

  test("oportunidades.propose-answers reintenta con una segunda pasada de IA cuando la evidencia es fuerte", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_answer_interest_fallback`,
    );
    const [firstQuestion] =
      await getStageQuestionRowsByCode("contacto_inicial");

    await attachOpportunityDocumentForTest({
      opportunityId: fixture.opportunityId,
      uploadedByUserId: ctx.opportunityFlowUserId,
      suffix: `${TEST_PREFIX}_contact_interest_answer`,
      text: "Durante la reunion inicial, el cliente se intereso en las soluciones de F5 Distributed Cloud Services para proteger aplicaciones criticas.",
    });

    const originalApiKey = config.openai.apiKey;
    const originalFlag =
      config.features.opportunityStageAnswerSuggestionsEnabled;
    const originalFetch = global.fetch;

    try {
      config.openai.apiKey = "test-key";
      config.features.opportunityStageAnswerSuggestionsEnabled = true;
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output_text: JSON.stringify({
              suggestions: [
                {
                  questionId: Number(firstQuestion.id),
                  status: "insufficient_evidence",
                  proposalKind: "fill_empty",
                  proposedAnswer: "",
                  reason: "Modelo demasiado conservador para esta evidencia.",
                },
              ],
            }),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output_text: JSON.stringify({
              suggestions: [
                {
                  questionId: Number(firstQuestion.id),
                  status: "proposed",
                  proposalKind: "fill_empty",
                  proposedAnswer:
                    "El cliente esta interesado en las soluciones de F5 Distributed Cloud Services para proteger aplicaciones criticas.",
                  reason:
                    "La evidencia describe de forma directa el interes del cliente.",
                },
              ],
            }),
          }),
        });

      const response = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/stage-view/${ctx.catalogIds.salesStageInitialId}/propose-answers`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.suggestions).toHaveLength(1);
      expect(response.body.suggestions[0]).toEqual(
        expect.objectContaining({
          questionId: Number(firstQuestion.id),
          status: "proposed",
          proposalKind: "fill_empty",
        }),
      );
      expect(response.body.suggestions[0].proposedAnswer).toContain(
        "F5 Distributed Cloud Services",
      );
      expect(response.body.summary).toEqual({
        proposedCount: 1,
        fillCount: 1,
        replaceCount: 0,
        ambiguousCount: 0,
        insufficientCount: 0,
      });
      expect(response.body.meta.focusedRetryQuestionCount).toBe(1);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
      config.features.opportunityStageAnswerSuggestionsEnabled = originalFlag;
    }
  });

  test("oportunidades.propose-answers incluye contexto documental amplio para evidencia semantica", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_answer_semantic_context`,
    );
    const [firstQuestion] =
      await getStageQuestionRowsByCode("contacto_inicial");

    await attachOpportunityDocumentForTest({
      opportunityId: fixture.opportunityId,
      uploadedByUserId: ctx.opportunityFlowUserId,
      suffix: `${TEST_PREFIX}_semantic_interest_answer`,
      text: "En la reunion de arranque se confirmo prioridad por blindar aplicaciones publicas y reducir riesgo operativo en servicios expuestos a internet.",
    });

    const originalApiKey = config.openai.apiKey;
    const originalFlag =
      config.features.opportunityStageAnswerSuggestionsEnabled;
    const originalFetch = global.fetch;

    try {
      config.openai.apiKey = "test-key";
      config.features.opportunityStageAnswerSuggestionsEnabled = true;
      global.fetch = vi.fn().mockImplementation(async (_url, options) => {
        const payload = JSON.parse(String(options?.body || "{}"));
        const requestBody = JSON.parse(
          String(payload?.input?.[1]?.content || "{}"),
        );
        const documentCorpus = String(requestBody?.documentCorpus || "");
        const sawRelevantText = documentCorpus.includes(
          "blindar aplicaciones publicas",
        );

        return {
          ok: true,
          json: async () => ({
            output_text: JSON.stringify({
              suggestions: [
                {
                  questionId: Number(firstQuestion.id),
                  status: sawRelevantText
                    ? "proposed"
                    : "insufficient_evidence",
                  proposalKind: "fill_empty",
                  proposedAnswer: sawRelevantText
                    ? "El cliente busca blindar aplicaciones publicas y reducir riesgo operativo en servicios expuestos a internet."
                    : "",
                  reason: sawRelevantText
                    ? "El corpus documental amplio contiene evidencia semantica suficiente para responder la pregunta."
                    : "La IA no recibio el texto documental relevante.",
                },
              ],
            }),
          }),
        };
      });

      const response = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/stage-view/${ctx.catalogIds.salesStageInitialId}/propose-answers`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.suggestions).toHaveLength(1);
      expect(response.body.suggestions[0]).toEqual(
        expect.objectContaining({
          questionId: Number(firstQuestion.id),
          status: "proposed",
          proposalKind: "fill_empty",
        }),
      );
      expect(response.body.suggestions[0].proposedAnswer).toContain(
        "blindar aplicaciones publicas",
      );
      expect(global.fetch).toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
      config.features.opportunityStageAnswerSuggestionsEnabled = originalFlag;
    }
  });

  test("oportunidades.propose-answers orienta a la IA a responder interes del cliente desde necesidad documentada", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_answer_interest_semantics`,
    );
    const [firstQuestion] =
      await getStageQuestionRowsByCode("contacto_inicial");

    await attachOpportunityDocumentForTest({
      opportunityId: fixture.opportunityId,
      uploadedByUserId: ctx.opportunityFlowUserId,
      suffix: `${TEST_PREFIX}_achfoods_interest_answer`,
      text: "Durante la reunion se reviso la necesidad de fortalecer la seguridad en el acceso a las aplicaciones que la organizacion mantiene en la nube. La conversacion se enfoco en proteger credenciales, validar identidades y contar con mayores controles de autenticacion y visibilidad sobre los accesos. Como siguiente paso, se acordo realizar una demostracion de la solucion propuesta.",
    });

    const originalApiKey = config.openai.apiKey;
    const originalFlag =
      config.features.opportunityStageAnswerSuggestionsEnabled;
    const originalFetch = global.fetch;

    try {
      config.openai.apiKey = "test-key";
      config.features.opportunityStageAnswerSuggestionsEnabled = true;
      global.fetch = vi.fn().mockImplementation(async (_url, options) => {
        const payload = JSON.parse(String(options?.body || "{}"));
        const systemPrompt = String(payload?.input?.[0]?.content || "");
        const requestBody = JSON.parse(
          String(payload?.input?.[1]?.content || "{}"),
        );
        const allowsSemanticEquivalence = systemPrompt.includes(
          "equivalencias semanticas claras",
        );
        const semanticRuleEnabled =
          requestBody?.rules?.allowClearSemanticEquivalence === true;

        return {
          ok: true,
          json: async () => ({
            output_text: JSON.stringify({
              suggestions: [
                {
                  questionId: Number(firstQuestion.id),
                  status:
                    allowsSemanticEquivalence && semanticRuleEnabled
                      ? "proposed"
                      : "insufficient_evidence",
                  proposalKind: "fill_empty",
                  proposedAnswer:
                    allowsSemanticEquivalence && semanticRuleEnabled
                      ? "El cliente esta interesado en fortalecer la seguridad de acceso a sus aplicaciones en la nube, proteger credenciales, validar identidades y mejorar los controles de autenticacion y visibilidad."
                      : "",
                  reason:
                    allowsSemanticEquivalence && semanticRuleEnabled
                      ? "La necesidad documentada describe de forma suficiente el interes del cliente."
                      : "La solicitud no instruyo a la IA para usar equivalencia semantica clara.",
                },
              ],
            }),
          }),
        };
      });

      const response = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/stage-view/${ctx.catalogIds.salesStageInitialId}/propose-answers`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.suggestions).toHaveLength(1);
      expect(response.body.suggestions[0]).toEqual(
        expect.objectContaining({
          questionId: Number(firstQuestion.id),
          status: "proposed",
          proposalKind: "fill_empty",
        }),
      );
      expect(response.body.suggestions[0].proposedAnswer).toContain(
        "seguridad de acceso",
      );
      expect(global.fetch).toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
      config.features.opportunityStageAnswerSuggestionsEnabled = originalFlag;
    }
  });

  test("oportunidades.propose-answers hace una tercera pasada de recuperacion semantica cuando la IA sigue conservadora", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_answer_semantic_recovery`,
    );
    const [firstQuestion] =
      await getStageQuestionRowsByCode("contacto_inicial");

    await attachOpportunityDocumentForTest({
      opportunityId: fixture.opportunityId,
      uploadedByUserId: ctx.opportunityFlowUserId,
      suffix: `${TEST_PREFIX}_semantic_recovery_answer`,
      text: "Se reviso la necesidad de fortalecer la seguridad en el acceso a aplicaciones en la nube, proteger credenciales, validar identidades y mejorar los controles de autenticacion. Tambien se acordo realizar una demostracion.",
    });

    const originalApiKey = config.openai.apiKey;
    const originalFlag =
      config.features.opportunityStageAnswerSuggestionsEnabled;
    const originalFetch = global.fetch;

    try {
      config.openai.apiKey = "test-key";
      config.features.opportunityStageAnswerSuggestionsEnabled = true;
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output_text: JSON.stringify({
              suggestions: [
                {
                  questionId: Number(firstQuestion.id),
                  status: "insufficient_evidence",
                  proposalKind: "fill_empty",
                  proposedAnswer: "",
                  reason: "Primera pasada demasiado conservadora.",
                },
              ],
            }),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output_text: JSON.stringify({
              suggestions: [
                {
                  questionId: Number(firstQuestion.id),
                  status: "insufficient_evidence",
                  proposalKind: "fill_empty",
                  proposedAnswer: "",
                  reason: "Segunda pasada aun conservadora.",
                },
              ],
            }),
          }),
        })
        .mockImplementationOnce(async (_url, options) => {
          const payload = JSON.parse(String(options?.body || "{}"));
          const systemPrompt = String(payload?.input?.[0]?.content || "");
          const hasRecoveryExample = systemPrompt.includes(
            "Ejemplo 1: pregunta '¿En qué está interesado el cliente?'",
          );

          return {
            ok: true,
            json: async () => ({
              output_text: JSON.stringify({
                suggestions: [
                  {
                    questionId: Number(firstQuestion.id),
                    status: hasRecoveryExample
                      ? "proposed"
                      : "insufficient_evidence",
                    proposalKind: "fill_empty",
                    proposedAnswer: hasRecoveryExample
                      ? "El cliente esta interesado en fortalecer la seguridad de acceso a aplicaciones en la nube, proteger credenciales, validar identidades y mejorar los controles de autenticacion."
                      : "",
                    reason: hasRecoveryExample
                      ? "La tercera pasada permitio recuperar la respuesta desde la necesidad documentada."
                      : "No se encontro la instruccion de recuperacion semantica.",
                  },
                ],
              }),
            }),
          };
        });

      const response = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/stage-view/${ctx.catalogIds.salesStageInitialId}/propose-answers`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.suggestions).toHaveLength(1);
      expect(response.body.suggestions[0]).toEqual(
        expect.objectContaining({
          questionId: Number(firstQuestion.id),
          status: "proposed",
          proposalKind: "fill_empty",
        }),
      );
      expect(response.body.suggestions[0].proposedAnswer).toContain(
        "fortalecer la seguridad de acceso",
      );
      expect(response.body.meta.focusedRetryQuestionCount).toBe(1);
      expect(response.body.meta.semanticRecoveryQuestionCount).toBe(1);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
      config.features.opportunityStageAnswerSuggestionsEnabled = originalFlag;
    }
  });

  test("oportunidades.propose-answers hace recuperacion dirigida por pregunta cuando aun no propone respuesta", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_answer_targeted_recovery`,
    );
    const [firstQuestion] =
      await getStageQuestionRowsByCode("contacto_inicial");

    await attachOpportunityDocumentForTest({
      opportunityId: fixture.opportunityId,
      uploadedByUserId: ctx.opportunityFlowUserId,
      suffix: `${TEST_PREFIX}_targeted_recovery_answer`,
      text: "Durante la reunion se reviso la necesidad de fortalecer la seguridad de acceso a aplicaciones en la nube, proteger credenciales y validar identidades. Tambien se acordo realizar una demostracion.",
    });

    const originalApiKey = config.openai.apiKey;
    const originalFlag =
      config.features.opportunityStageAnswerSuggestionsEnabled;
    const originalFetch = global.fetch;

    try {
      config.openai.apiKey = "test-key";
      config.features.opportunityStageAnswerSuggestionsEnabled = true;
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output_text: JSON.stringify({
              suggestions: [
                {
                  questionId: Number(firstQuestion.id),
                  status: "insufficient_evidence",
                  proposalKind: "fill_empty",
                  proposedAnswer: "",
                  reason: "Primera pasada demasiado conservadora.",
                },
              ],
            }),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output_text: JSON.stringify({
              suggestions: [
                {
                  questionId: Number(firstQuestion.id),
                  status: "insufficient_evidence",
                  proposalKind: "fill_empty",
                  proposedAnswer: "",
                  reason: "Segunda pasada demasiado conservadora.",
                },
              ],
            }),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output_text: JSON.stringify({
              suggestions: [
                {
                  questionId: Number(firstQuestion.id),
                  status: "insufficient_evidence",
                  proposalKind: "fill_empty",
                  proposedAnswer: "",
                  reason: "Tercera pasada aun sin propuesta.",
                },
              ],
            }),
          }),
        })
        .mockImplementationOnce(async (_url, options) => {
          const payload = JSON.parse(String(options?.body || "{}"));
          const requestBody = JSON.parse(
            String(payload?.input?.[1]?.content || "{}"),
          );
          const hasSingleQuestionMode =
            requestBody?.rules?.analyzeSingleQuestion === true;
          const candidateEvidence = Array.isArray(
            requestBody?.question?.candidateEvidence,
          )
            ? requestBody.question.candidateEvidence
            : [];

          return {
            ok: true,
            json: async () => ({
              output_text: JSON.stringify({
                suggestions: [
                  {
                    questionId: Number(firstQuestion.id),
                    status:
                      hasSingleQuestionMode && candidateEvidence.length
                        ? "proposed"
                        : "insufficient_evidence",
                    proposalKind: "fill_empty",
                    proposedAnswer:
                      hasSingleQuestionMode && candidateEvidence.length
                        ? "El cliente esta interesado en fortalecer la seguridad de acceso a aplicaciones en la nube, proteger credenciales y validar identidades."
                        : "",
                    reason:
                      hasSingleQuestionMode && candidateEvidence.length
                        ? "La recuperacion dirigida por pregunta permitio responder desde los fragmentos mas relevantes."
                        : "No se envio la pregunta dirigida con evidencia candidata.",
                  },
                ],
              }),
            }),
          };
        });

      const response = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/stage-view/${ctx.catalogIds.salesStageInitialId}/propose-answers`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.suggestions[0]).toEqual(
        expect.objectContaining({
          questionId: Number(firstQuestion.id),
          status: "proposed",
          proposalKind: "fill_empty",
        }),
      );
      expect(response.body.suggestions[0].proposedAnswer).toContain(
        "fortalecer la seguridad de acceso",
      );
      expect(response.body.meta.focusedRetryQuestionCount).toBe(1);
      expect(response.body.meta.semanticRecoveryQuestionCount).toBe(1);
      expect(response.body.meta.targetedRecoveryQuestionCount).toBe(1);
      expect(global.fetch).toHaveBeenCalledTimes(4);
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
      config.features.opportunityStageAnswerSuggestionsEnabled = originalFlag;
    }
  });

  test("oportunidades.propose-answers enriquece la pregunta para IA con instruccion comun y override por codigo", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_answer_enriched_prompt_config`,
    );
    const identificationQuestions = await getStageQuestionRowsByCode(
      "identificacion_oportunidad",
    );
    const budgetQuestion = identificationQuestions.find(
      (question) => question.code === "identificacion_presupuesto_cliente",
    );

    expect(budgetQuestion).toBeTruthy();

    await query(
      "UPDATE opportunities SET sales_stage_id = ?, updated_at = NOW(3) WHERE id = ?",
      [ctx.catalogIds.salesStageIdentificationId, fixture.opportunityId],
    );

    await attachOpportunityDocumentForTest({
      opportunityId: fixture.opportunityId,
      uploadedByUserId: ctx.opportunityFlowUserId,
      suffix: `${TEST_PREFIX}_budget_prompt_enrichment`,
      text: "El cliente indico que el presupuesto aun no esta aprobado, pero espera definir un rango estimado durante el siguiente comite financiero.",
    });

    const originalApiKey = config.openai.apiKey;
    const originalFlag =
      config.features.opportunityStageAnswerSuggestionsEnabled;
    const originalFetch = global.fetch;

    try {
      config.openai.apiKey = "test-key";
      config.features.opportunityStageAnswerSuggestionsEnabled = true;
      global.fetch = vi.fn().mockImplementation(async (_url, options) => {
        const payload = JSON.parse(String(options?.body || "{}"));
        const requestBody = JSON.parse(
          String(payload?.input?.[1]?.content || "{}"),
        );
        const questionContexts = String(requestBody?.questionContexts || "");
        const hasCommonEvidenceInstruction = questionContexts.includes(
          "Responde solo con hechos suficientemente sustentados por evidencia especifica",
        );
        const hasBudgetOverride = questionContexts.includes(
          "presupuesto aprobado, rango estimado",
        );
        const hasInsufficientCriterion = questionContexts.includes(
          "Si no hay cifra, rango, restriccion o proceso presupuestal concreto, responde insufficient_evidence.",
        );
        const hasConservativeTemperature = Number(payload?.temperature) === 0.1;
        const hasConservativeTopP = Number(payload?.top_p) === 1;

        return {
          ok: true,
          json: async () => ({
            output_text: JSON.stringify({
              suggestions: [
                {
                  questionId: Number(budgetQuestion.id),
                  status:
                    hasCommonEvidenceInstruction &&
                    hasBudgetOverride &&
                    hasInsufficientCriterion &&
                    hasConservativeTemperature &&
                    hasConservativeTopP
                      ? "proposed"
                      : "insufficient_evidence",
                  proposalKind: "fill_empty",
                  proposedAnswer:
                    hasCommonEvidenceInstruction &&
                    hasBudgetOverride &&
                    hasInsufficientCriterion &&
                    hasConservativeTemperature &&
                    hasConservativeTopP
                      ? "El cliente aun no tiene presupuesto aprobado y espera definir un rango estimado en el siguiente comite financiero."
                      : "",
                  reason:
                    hasCommonEvidenceInstruction &&
                    hasBudgetOverride &&
                    hasInsufficientCriterion &&
                    hasConservativeTemperature &&
                    hasConservativeTopP
                      ? "La pregunta llego enriquecida con criterio estricto y parametros conservadores del modelo."
                      : "El payload no incluyo el endurecimiento esperado para la IA.",
                },
              ],
            }),
          }),
        };
      });

      const response = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/stage-view/${ctx.catalogIds.salesStageIdentificationId}/propose-answers`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.suggestions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            questionId: Number(budgetQuestion.id),
            status: "proposed",
            proposalKind: "fill_empty",
          }),
        ]),
      );
      expect(global.fetch).toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
      config.features.opportunityStageAnswerSuggestionsEnabled = originalFlag;
    }
  });

  test("oportunidades.stage-view expone motivo de bypass solo para la etapa bypaseada", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_bypass_reason_context`,
    );

    const bypassResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/stage-bypass`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ reason: "Se omitio por criterio externo de preventa" });

    expect(bypassResponse.status).toBe(200);

    const skippedStageResponse = await request(app)
      .get(
        `/api/opportunities/${fixture.opportunityId}/stage-view/${ctx.catalogIds.salesStageInitialId}`,
      )
      .set("Authorization", `Bearer ${fixture.token}`);

    const destinationStageResponse = await request(app)
      .get(`/api/opportunities/${fixture.opportunityId}/commercial-context`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(skippedStageResponse.status).toBe(200);
    expect(skippedStageResponse.body.salesStage.code).toBe("contacto_inicial");
    expect(skippedStageResponse.body.currentSalesStage.code).toBe(
      "identificacion_oportunidad",
    );
    expect(skippedStageResponse.body.bypassInfo).toEqual({
      isBypassed: true,
      reason: "Se omitio por criterio externo de preventa",
    });

    expect(destinationStageResponse.status).toBe(200);
    expect(destinationStageResponse.body.salesStage.code).toBe(
      "identificacion_oportunidad",
    );
    expect(destinationStageResponse.body.currentSalesStage.code).toBe(
      "identificacion_oportunidad",
    );
    expect(destinationStageResponse.body.bypassInfo).toEqual({
      isBypassed: false,
      reason: null,
    });
    expect(destinationStageResponse.body.answers.length).toBeGreaterThan(0);
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

    const thirdSaveResponse = await request(app)
      .post(`/api/opportunities/${fixture.opportunityId}/stage-answers`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        answers: [
          {
            questionId: Number(firstQuestion.id),
            answerValue: "",
          },
        ],
      });

    expect(thirdSaveResponse.status).toBe(200);

    const answerRows = await query(
      `SELECT COUNT(*) AS total
       FROM opportunity_stage_question_answers
       WHERE opportunity_id = ?
         AND question_id = ?`,
      [fixture.opportunityId, Number(firstQuestion.id)],
    );
    expect(Number(answerRows[0].total)).toBe(3);

    const latestAnswerRows = await query(
      `SELECT answer_value
       FROM opportunity_stage_question_answers
       WHERE opportunity_id = ?
         AND question_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [fixture.opportunityId, Number(firstQuestion.id)],
    );
    expect(latestAnswerRows[0].answer_value).toBe("");

    const contextResponse = await request(app)
      .get(`/api/opportunities/${fixture.opportunityId}/commercial-context`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(contextResponse.status).toBe(200);
    expect(contextResponse.body.answers[0].answer_value).toBe("");

    const auditRows = await getAuditActionsForOpportunity(
      fixture.opportunityId,
      "stage_answers_saved",
    );
    expect(auditRows.length).toBe(3);
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

  test("oportunidades.validate-current-stage corrige un rechazo demasiado conservador en Contacto Inicial cuando la respuesta ya demuestra necesidad y siguiente paso", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_validate_stage`,
    );

    const originalApiKey = config.openai.apiKey;
    const originalFetch = global.fetch;
    config.openai.apiKey = "test-key";
    global.fetch = vi.fn(async (url, init) => {
      expect(String(url)).toContain("/responses");
      const payload = JSON.parse(init.body);
      expect(payload.temperature).toBe(0.1);
      expect(payload.top_p).toBe(1);
      const rawInput = JSON.parse(payload.input[1].content);
      expect(rawInput.expectedJsonShape.decision).toContain("ready_to_advance");

      return {
        ok: true,
        json: async () => ({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    decision: "not_ready_to_advance",
                    summary:
                      "Falta concretar el interes real del cliente y los siguientes pasos de la etapa.",
                    reasons: [
                      "Las respuestas actuales siguen demasiado generales para demostrar que la etapa cumplio su objetivo.",
                    ],
                    suggestions: [
                      "Aterriza la necesidad puntual del cliente y confirma un siguiente paso comercial concreto.",
                    ],
                    confidence: "high",
                    questionAssessments: [
                      {
                        questionId: rawInput.questionContexts.includes(
                          "Pregunta 1:",
                        )
                          ? 1
                          : 0,
                        status: "weak",
                        reason:
                          "La respuesta no prueba con suficiente precision el objetivo de la etapa.",
                        suggestion:
                          "Haz la respuesta mas especifica y vinculada a una necesidad real.",
                      },
                    ],
                  }),
                },
              ],
            },
          ],
        }),
      };
    });

    try {
      const stageViewResponse = await request(app)
        .get(`/api/opportunities/${fixture.opportunityId}/commercial-context`)
        .set("Authorization", `Bearer ${fixture.token}`);

      const answersPayload = {
        answers: stageViewResponse.body.answers.map((answer, index) => ({
          questionId: Number(answer.question_id),
          answerValue:
            index === 0
              ? "El cliente confirmo interes en revisar una alternativa concreta y agendar seguimiento."
              : "Se programara una reunion de seguimiento para profundizar la oportunidad.",
        })),
      };

      const saveResponse = await request(app)
        .post(`/api/opportunities/${fixture.opportunityId}/stage-answers`)
        .set("Authorization", `Bearer ${fixture.token}`)
        .send(answersPayload);

      expect(saveResponse.status).toBe(200);

      const validateResponse = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/validate-current-stage`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({ note: "Validacion IA registrada" });

      expect(validateResponse.status).toBe(200);
      expect(validateResponse.body.message).toContain("lista para avanzar");
      expect(validateResponse.body.validation.decision).toBe(
        "ready_to_advance",
      );
      expect(validateResponse.body.validation.summary).toContain(
        "necesidad concreta del cliente",
      );
      expect(validateResponse.body.validation.reasons).toEqual([
        "La respuesta actual expresa una necesidad o interes concreto del cliente.",
        "Tambien deja claro un siguiente paso de seguimiento o validacion tecnica, que cumple el criterio de cierre de Contacto Inicial.",
      ]);
      expect(validateResponse.body.validation.suggestions).toEqual([
        "Ejecuta la reunion o prueba tecnica y documenta los hallazgos para desarrollar la oportunidad en la siguiente etapa.",
      ]);

      const snapshot = await getOpportunityCommercialSnapshot(
        fixture.opportunityId,
      );
      expect(snapshot.sales_stage_code).toBe("identificacion_oportunidad");

      const auditRows = await getAuditActionsForOpportunity(
        fixture.opportunityId,
        "stage_validated",
      );
      expect(auditRows.length).toBe(1);
      expect(auditRows[0].detail).toContain("IA");
      expect(auditRows[0].changed_fields).toMatchObject({
        validation_decision: {
          after: "ready_to_advance",
        },
      });
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
    }
  });

  test("oportunidades.validate-current-stage deja Contacto Inicial con reservas cuando ya existe necesidad clara pero aun no se documenta el siguiente paso", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_commercial_validate_stage_need_only`,
    );

    const originalApiKey = config.openai.apiKey;
    const originalFetch = global.fetch;
    config.openai.apiKey = "test-key";
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  decision: "not_ready_to_advance",
                  summary:
                    "No se confirma todavia que la etapa este lista para avanzar.",
                  reasons: [
                    "La IA considera que aun falta sustento para cerrar la etapa.",
                  ],
                  suggestions: [
                    "Documenta mejor la situacion actual antes de avanzar.",
                  ],
                  confidence: "high",
                  questionAssessments: [
                    {
                      questionId: 1,
                      status: "inconsistent",
                      reason:
                        "La respuesta describe una necesidad pero no confirma el cierre completo de la etapa.",
                      suggestion:
                        "Documenta el siguiente paso comercial para eliminar dudas.",
                    },
                  ],
                }),
              },
            ],
          },
        ],
      }),
    }));

    try {
      const stageViewResponse = await request(app)
        .get(`/api/opportunities/${fixture.opportunityId}/commercial-context`)
        .set("Authorization", `Bearer ${fixture.token}`);

      const saveResponse = await request(app)
        .post(`/api/opportunities/${fixture.opportunityId}/stage-answers`)
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          answers: stageViewResponse.body.answers.map((answer) => ({
            questionId: Number(answer.question_id),
            answerValue:
              "El cliente expresa la necesidad concreta de obtener visibilidad y control del trafico que consumen sus APIs en AWS por incidentes recientes de seguridad y por el crecimiento proyectado de usuarios antes de julio.",
          })),
        });

      expect(saveResponse.status).toBe(200);

      const validateResponse = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/validate-current-stage`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({});

      expect(validateResponse.status).toBe(200);
      expect(validateResponse.body.message).toContain(
        "puede avanzar con reservas",
      );
      expect(validateResponse.body.validation.decision).toBe(
        "advance_with_caution",
      );
      expect(validateResponse.body.validation.summary).toContain(
        "puede avanzar con reservas",
      );
      expect(validateResponse.body.validation.reasons).toEqual([
        "La respuesta actual ya demuestra una necesidad o interes concreto del cliente.",
        "Aun falta documentar con mayor precision la reunion, demo o siguiente paso que cerrara la etapa con mas solidez.",
      ]);
      expect(validateResponse.body.validation.suggestions).toEqual([
        "Confirma y registra el siguiente paso comercial o tecnico para avanzar con mayor respaldo a la siguiente etapa.",
      ]);
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
    }
  });

  test("oportunidades.validate-current-stage reconcilia la decision para cualquier etapa cuando los assessments contradicen el dictamen crudo de la IA", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_validate_reconciled`,
    );
    const identificationQuestions = await getStageQuestionRowsByCode(
      "identificacion_oportunidad",
    );

    await query(
      "UPDATE opportunities SET sales_stage_id = ?, updated_at = NOW(3) WHERE id = ?",
      [ctx.catalogIds.salesStageIdentificationId, fixture.opportunityId],
    );

    const originalApiKey = config.openai.apiKey;
    const originalFetch = global.fetch;
    config.openai.apiKey = "test-key";
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  decision: "not_ready_to_advance",
                  summary:
                    "La IA considera que la etapa aun no esta lista para avanzar.",
                  reasons: [
                    "El dictamen crudo sigue siendo demasiado conservador.",
                  ],
                  suggestions: ["No avances hasta tener mas certeza."],
                  confidence: "low",
                  questionAssessments: identificationQuestions.map(
                    (question) => ({
                      questionId: Number(question.id),
                      status: "adequate",
                      reason:
                        "La respuesta es concreta, accionable y suficiente para esta etapa.",
                      suggestion: "Sin accion inmediata.",
                    }),
                  ),
                }),
              },
            ],
          },
        ],
      }),
    }));

    try {
      const saveResponse = await request(app)
        .post(`/api/opportunities/${fixture.opportunityId}/stage-answers`)
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          answers: [
            {
              questionId: Number(identificationQuestions[0].id),
              answerValue:
                "El cliente requiere proteger y controlar sus APIs en AWS con WAF, politicas de acceso, mitigacion de bots y visibilidad operativa sin interrumpir produccion.",
            },
            {
              questionId: Number(identificationQuestions[1].id),
              answerValue:
                "Busca reducir riesgo de incidentes y asegurar continuidad operativa antes del crecimiento previsto de transacciones en julio.",
            },
            {
              questionId: Number(identificationQuestions[2].id),
              answerValue:
                "El presupuesto saldra del frente de seguridad y cloud, con un rango preliminar que se validara en la aprobacion interna posterior a la propuesta tecnica.",
            },
            {
              questionId: Number(identificationQuestions[3].id),
              answerValue:
                "La compra debe cerrarse antes de julio porque el incremento de trafico elevara el riesgo operativo; retrasarla aumentaria exposicion y presion sobre el equipo interno.",
            },
            {
              questionId: Number(identificationQuestions[4].id),
              answerValue:
                "Participan seguridad, infraestructura, el equipo responsable de APIs y compras; el proceso contempla validacion tecnica, revision economica y aprobacion interna antes de emitir la orden.",
            },
            {
              questionId: Number(identificationQuestions[5].id),
              answerValue:
                "Tenemos experiencia en proteccion de APIs y aplicaciones, enfoque consultivo de diagnostico y capacidad de implementar una arquitectura segura alineada al crecimiento del cliente.",
            },
            {
              questionId: Number(identificationQuestions[6].id),
              answerValue:
                "La estrategia es confirmar alcance tecnico, validar riesgos y prioridades del cliente, y convertirlo en una propuesta de valor y arquitectura que facilite la aprobacion y el paso a desarrollo.",
            },
          ],
        });

      expect(saveResponse.status).toBe(200);

      const validateResponse = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/validate-current-stage`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({});

      expect(validateResponse.status).toBe(200);
      expect(validateResponse.body.validation.decision).toBe(
        "ready_to_advance",
      );
      expect(validateResponse.body.validation.summary).toContain(
        "lista para avanzar",
      );
      expect(validateResponse.body.validation.reasons).toEqual([
        "Se evaluaron 7 pregunta(s) obligatoria(s) y todas quedaron con nivel adecuado para sustentar el avance.",
      ]);
      expect(validateResponse.body.validation.suggestions).toEqual([
        "Avanza a la siguiente etapa y documenta los hallazgos nuevos que se obtengan durante su desarrollo.",
      ]);
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
    }
  });

  test("oportunidades.validate-current-stage detalla las respuestas debiles cuando la reconciliacion deja avance con reservas", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_validate_detailed_caution`,
    );
    const identificationQuestions = await getStageQuestionRowsByCode(
      "identificacion_oportunidad",
    );

    await query(
      "UPDATE opportunities SET sales_stage_id = ?, updated_at = NOW(3) WHERE id = ?",
      [ctx.catalogIds.salesStageIdentificationId, fixture.opportunityId],
    );

    const originalApiKey = config.openai.apiKey;
    const originalFetch = global.fetch;
    config.openai.apiKey = "test-key";
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  decision: "ready_to_advance",
                  summary: "La IA cree que todo esta listo.",
                  reasons: ["La senal general parece positiva."],
                  suggestions: ["Avanza sin cambios."],
                  confidence: "medium",
                  questionAssessments: identificationQuestions.map(
                    (question, index) => ({
                      questionId: Number(question.id),
                      status: index < 2 ? "weak" : "adequate",
                      reason:
                        index === 0
                          ? "La necesidad esta descrita, pero falta precisar impacto medible, criticidad o alcance tecnico verificable."
                          : index === 1
                            ? "La motivacion es entendible, pero falta aterrizar urgencia de negocio, prioridad o consecuencia de no actuar."
                            : "La respuesta es suficiente para esta etapa.",
                      suggestion:
                        index === 0
                          ? "Agrega ejemplos concretos del riesgo actual, activos afectados o metas tecnicas que se quieren proteger."
                          : index === 1
                            ? "Explica con un ejemplo la urgencia del cliente, el evento que dispara la compra o el costo de no resolverlo."
                            : "Sin accion inmediata.",
                    }),
                  ),
                }),
              },
            ],
          },
        ],
      }),
    }));

    try {
      const saveResponse = await request(app)
        .post(`/api/opportunities/${fixture.opportunityId}/stage-answers`)
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          answers: identificationQuestions.map((question) => ({
            questionId: Number(question.id),
            answerValue:
              "Respuesta presente para permitir que la reconciliacion dependa del assessment estructurado y no de faltantes.",
          })),
        });

      expect(saveResponse.status).toBe(200);

      const validateResponse = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/validate-current-stage`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({});

      expect(validateResponse.status).toBe(200);
      expect(validateResponse.body.validation.decision).toBe(
        "advance_with_caution",
      );
      expect(validateResponse.body.validation.reasons).toContain(
        "Las preguntas obligatorias ya tienen respuesta, pero 2 siguen siendo debiles o poco verificables para cerrar la etapa con total solidez.",
      );
      expect(validateResponse.body.validation.reasons).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            ": La necesidad esta descrita, pero falta precisar impacto medible, criticidad o alcance tecnico verificable.",
          ),
          expect.stringContaining(
            ": La motivacion es entendible, pero falta aterrizar urgencia de negocio, prioridad o consecuencia de no actuar.",
          ),
        ]),
      );
      expect(validateResponse.body.validation.suggestions).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "Agrega ejemplos concretos del riesgo actual, activos afectados o metas tecnicas que se quieren proteger.",
          ),
          expect.stringContaining(
            "Explica con un ejemplo la urgencia del cliente, el evento que dispara la compra o el costo de no resolverlo.",
          ),
        ]),
      );
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
    }
  });

  test("oportunidades.validate-current-stage genera ejemplos utiles cuando la IA deja reasons y suggestions vacios", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_validate_fallback_examples`,
    );
    const identificationQuestions = await getStageQuestionRowsByCode(
      "identificacion_oportunidad",
    );

    await query(
      "UPDATE opportunities SET sales_stage_id = ?, updated_at = NOW(3) WHERE id = ?",
      [ctx.catalogIds.salesStageIdentificationId, fixture.opportunityId],
    );

    const originalApiKey = config.openai.apiKey;
    const originalFetch = global.fetch;
    config.openai.apiKey = "test-key";
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  decision: "advance_with_caution",
                  summary: "La etapa puede avanzar con reservas.",
                  reasons: ["Existen respuestas debiles."],
                  suggestions: ["Fortalece las respuestas."],
                  confidence: "medium",
                  questionAssessments: identificationQuestions.map(
                    (question, index) => ({
                      questionId: Number(question.id),
                      status: index < 2 ? "weak" : "adequate",
                      reason: "",
                      suggestion: "",
                    }),
                  ),
                }),
              },
            ],
          },
        ],
      }),
    }));

    try {
      const saveResponse = await request(app)
        .post(`/api/opportunities/${fixture.opportunityId}/stage-answers`)
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          answers: identificationQuestions.map((question) => ({
            questionId: Number(question.id),
            answerValue:
              "Respuesta presente, pero sin suficiente detalle para que el backend deba construir el ejemplo util a partir del prompt.",
          })),
        });

      expect(saveResponse.status).toBe(200);

      const validateResponse = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/validate-current-stage`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({});

      expect(validateResponse.status).toBe(200);
      expect(validateResponse.body.validation.decision).toBe(
        "advance_with_caution",
      );
      expect(validateResponse.body.validation.reasons).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "La respuesta actual existe, pero sigue siendo debil porque no deja claramente resuelto",
          ),
          expect.stringContaining(
            "qué problema quiere resolver o qué resultado quiere lograr el cliente",
          ),
        ]),
      );
      expect(validateResponse.body.validation.suggestions).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "Ejemplo de como fortalecerla: responde de forma explicita",
          ),
          expect.stringContaining(
            "monto, fecha, responsable, sistema afectado, riesgo, objetivo o siguiente paso",
          ),
        ]),
      );
      expect(validateResponse.body.validation.reasons).not.toEqual(
        expect.arrayContaining([
          "La IA no devolvio un dictamen especifico para esta respuesta; se conserva como debil por falta de confirmacion suficiente.",
        ]),
      );
      expect(validateResponse.body.validation.suggestions).not.toEqual(
        expect.arrayContaining([
          "Haz la respuesta mas concreta y verificable antes de avanzar.",
        ]),
      );
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
    }
  });

  test("oportunidades.validate-current-stage.jobs completa la validacion y avanza una sola vez", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_validate_jobs_completed`,
    );

    const originalApiKey = config.openai.apiKey;
    const originalFetch = global.fetch;
    config.openai.apiKey = "test-key";
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  decision: "ready_to_advance",
                  summary: "La etapa ya cumplio su objetivo.",
                  reasons: ["Las respuestas son suficientes."],
                  suggestions: ["Avanza a la siguiente etapa."],
                  confidence: "high",
                  questionAssessments: [
                    {
                      questionId: 1,
                      status: "adequate",
                      reason: "Suficiente.",
                      suggestion: "Sin accion inmediata.",
                    },
                  ],
                }),
              },
            ],
          },
        ],
      }),
    }));

    try {
      const stageViewResponse = await request(app)
        .get(`/api/opportunities/${fixture.opportunityId}/commercial-context`)
        .set("Authorization", `Bearer ${fixture.token}`);

      await request(app)
        .post(`/api/opportunities/${fixture.opportunityId}/stage-answers`)
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          answers: stageViewResponse.body.answers.map((answer) => ({
            questionId: Number(answer.question_id),
            answerValue:
              "El cliente confirmo una necesidad concreta y el siguiente paso ya quedo acordado.",
          })),
        });

      const createResponse = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/validate-current-stage/jobs`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({ note: "Validacion async" });

      expect(createResponse.status).toBe(202);
      expect(createResponse.body.job.status).toBe("pending");

      await processPendingOpportunityStageValidationJobs({ limit: 5 });

      const pollResponse = await request(app)
        .get(
          `/api/opportunities/${fixture.opportunityId}/validate-current-stage/jobs/${createResponse.body.job.id}`,
        )
        .set("Authorization", `Bearer ${fixture.token}`);

      expect(pollResponse.status).toBe(200);
      expect(pollResponse.body.job).toEqual(
        expect.objectContaining({
          status: "completed",
          resultAvailable: true,
        }),
      );
      expect(pollResponse.body.result).toEqual(
        expect.objectContaining({
          autoAdvanced: true,
          validation: expect.objectContaining({
            decision: "ready_to_advance",
          }),
        }),
      );

      const snapshot = await getOpportunityCommercialSnapshot(
        fixture.opportunityId,
      );
      expect(snapshot.sales_stage_code).not.toBe("contacto_inicial");

      const validatedAuditRows = await getAuditActionsForOpportunity(
        fixture.opportunityId,
        "stage_validated",
      );
      const advancedAuditRows = await getAuditActionsForOpportunity(
        fixture.opportunityId,
        "stage_advanced",
      );
      expect(validatedAuditRows.length).toBe(1);
      expect(advancedAuditRows.length).toBe(1);
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
    }
  });

  test("oportunidades.validate-current-stage.jobs reutiliza el pending del mismo fingerprint", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_validate_jobs_reuse`,
    );
    const originalApiKey = config.openai.apiKey;
    config.openai.apiKey = "test-key";

    try {
      const stageViewResponse = await request(app)
        .get(`/api/opportunities/${fixture.opportunityId}/commercial-context`)
        .set("Authorization", `Bearer ${fixture.token}`);

      await request(app)
        .post(`/api/opportunities/${fixture.opportunityId}/stage-answers`)
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          answers: stageViewResponse.body.answers.map((answer) => ({
            questionId: Number(answer.question_id),
            answerValue: "Respuesta consistente para el fingerprint.",
          })),
        });

      const firstResponse = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/validate-current-stage/jobs`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({ note: "Misma solicitud" });
      const secondResponse = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/validate-current-stage/jobs`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({ note: "Misma solicitud" });

      expect(firstResponse.status).toBe(202);
      expect(secondResponse.status).toBe(202);
      expect(secondResponse.body.job.id).toBe(firstResponse.body.job.id);
    } finally {
      config.openai.apiKey = originalApiKey;
    }
  });

  test("oportunidades.validate-current-stage.jobs expone failed cuando el worker falla", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_validate_jobs_failed`,
    );
    const originalApiKey = config.openai.apiKey;
    const originalFetch = global.fetch;
    config.openai.apiKey = "test-key";
    global.fetch = vi.fn(async () => {
      throw new Error("Fallo forzado de validacion");
    });

    try {
      const stageViewResponse = await request(app)
        .get(`/api/opportunities/${fixture.opportunityId}/commercial-context`)
        .set("Authorization", `Bearer ${fixture.token}`);

      await request(app)
        .post(`/api/opportunities/${fixture.opportunityId}/stage-answers`)
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          answers: stageViewResponse.body.answers.map((answer) => ({
            questionId: Number(answer.question_id),
            answerValue: "Respuesta lista para disparar el worker.",
          })),
        });

      const createResponse = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/validate-current-stage/jobs`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({ note: "Fallo async" });

      await processPendingOpportunityStageValidationJobs({ limit: 5 });

      const pollResponse = await request(app)
        .get(
          `/api/opportunities/${fixture.opportunityId}/validate-current-stage/jobs/${createResponse.body.job.id}`,
        )
        .set("Authorization", `Bearer ${fixture.token}`);

      expect(pollResponse.status).toBe(200);
      expect(pollResponse.body.job.status).toBe("failed");
      expect(pollResponse.body.error).toEqual(
        expect.objectContaining({
          code: "validation_failed",
          message: "Fallo forzado de validacion",
        }),
      );
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
    }
  });

  test("oportunidades.validate-current-stage.jobs expone stale cuando cambia la evidencia antes de procesar", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_validate_jobs_stale`,
    );
    const originalApiKey = config.openai.apiKey;
    config.openai.apiKey = "test-key";

    try {
      const stageViewResponse = await request(app)
        .get(`/api/opportunities/${fixture.opportunityId}/commercial-context`)
        .set("Authorization", `Bearer ${fixture.token}`);

      await request(app)
        .post(`/api/opportunities/${fixture.opportunityId}/stage-answers`)
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          answers: stageViewResponse.body.answers.map((answer) => ({
            questionId: Number(answer.question_id),
            answerValue: "Respuesta original para crear el snapshot.",
          })),
        });

      const createResponse = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/validate-current-stage/jobs`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({ note: "Snapshot inicial" });

      await request(app)
        .post(`/api/opportunities/${fixture.opportunityId}/stage-answers`)
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          answers: stageViewResponse.body.answers.map((answer) => ({
            questionId: Number(answer.question_id),
            answerValue:
              "Respuesta modificada para invalidar el snapshot del job.",
          })),
        });

      await processPendingOpportunityStageValidationJobs({ limit: 5 });

      const pollResponse = await request(app)
        .get(
          `/api/opportunities/${fixture.opportunityId}/validate-current-stage/jobs/${createResponse.body.job.id}`,
        )
        .set("Authorization", `Bearer ${fixture.token}`);

      expect(pollResponse.status).toBe(200);
      expect(pollResponse.body.job.status).toBe("stale");
      expect(pollResponse.body.error?.code).toBe("stale_snapshot");
    } finally {
      config.openai.apiKey = originalApiKey;
    }
  });

  test("oportunidades.validate-current-stage.jobs expone expired cuando vence el TTL", async () => {
    const fixture = await createOwnedOpportunityFlowFixture(
      `${TEST_PREFIX}_validate_jobs_expired`,
    );

    const originalApiKey = config.openai.apiKey;
    const originalFetch = global.fetch;
    config.openai.apiKey = "test-key";
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  decision: "not_ready_to_advance",
                  summary: "La etapa aun no esta lista.",
                  reasons: ["Falta trabajo adicional."],
                  suggestions: ["Completa la informacion pendiente."],
                  confidence: "medium",
                  questionAssessments: [
                    {
                      questionId: 1,
                      status: "weak",
                      reason: "Aun no es suficiente.",
                      suggestion: "Agregar mas detalle.",
                    },
                  ],
                }),
              },
            ],
          },
        ],
      }),
    }));

    try {
      const stageViewResponse = await request(app)
        .get(`/api/opportunities/${fixture.opportunityId}/commercial-context`)
        .set("Authorization", `Bearer ${fixture.token}`);

      await request(app)
        .post(`/api/opportunities/${fixture.opportunityId}/stage-answers`)
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          answers: stageViewResponse.body.answers.map((answer) => ({
            questionId: Number(answer.question_id),
            answerValue: "Respuesta suficiente para crear el job terminal.",
          })),
        });

      const createResponse = await request(app)
        .post(
          `/api/opportunities/${fixture.opportunityId}/validate-current-stage/jobs`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({ note: "TTL async" });

      await processPendingOpportunityStageValidationJobs({ limit: 5 });
      await query(
        `UPDATE opportunity_stage_validation_jobs
         SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE)
         WHERE public_id = ?`,
        [createResponse.body.job.id],
      );

      const pollResponse = await request(app)
        .get(
          `/api/opportunities/${fixture.opportunityId}/validate-current-stage/jobs/${createResponse.body.job.id}`,
        )
        .set("Authorization", `Bearer ${fixture.token}`);

      expect(pollResponse.status).toBe(200);
      expect(pollResponse.body.job.status).toBe("expired");
      expect(pollResponse.body.error?.code).toBe("expired_result");
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
    }
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
    expect(snapshot.activation_status_code).toBe("activada");

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

  test("catalogos.opportunity-stage-questions-admin permite lectura con proceso_comercial_config.read y bloquea escritura sin update", async () => {
    const userId = await createUser({
      fullName: `${TEST_PREFIX} Process Config Readonly`,
      email: `${TEST_PREFIX}.process.config.readonly@example.com`,
      roleIds: [ctx.processCommercialConfigReadRoleId],
    });
    cleanup.userIds.push(userId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.process.config.readonly@example.com`,
    );
    const token = loginResponse.body.token;
    const salesStageId = ctx.catalogIds.salesStageWaitingId;

    const readResponse = await request(app)
      .get("/api/catalogs/opportunity-stage-questions-admin")
      .query({ salesStageId })
      .set("Authorization", `Bearer ${token}`);

    expect(readResponse.status).toBe(200);
    expect(Array.isArray(readResponse.body.questions)).toBe(true);

    const writeResponse = await request(app)
      .post("/api/catalogs/opportunity-stage-questions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        salesStageId,
        prompt: "¿Quién valida la decisión final?",
        responseType: "long_text",
        displayOrder: 2,
        isRequired: true,
      });

    expect(writeResponse.status).toBe(403);
    expect(writeResponse.body.requiredPermission).toBe(
      "proceso_comercial_config.update",
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
        (grupo_item_id, component_item_id, unit_price_override, quantity, sort_order, created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(3), ?, NOW(3))`,
      [
        bundlePriceItemId,
        bundleComponentItemId,
        2500,
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
              unitPriceOverride: 2500,
              quantity: 2,
              itemType: "producto",
              price: 1234.56,
            }),
          ]),
        }),
      ]),
    );
  });

  test("cotizaciones expone listas activas y permite crear productos simples desde el picker", async () => {
    const suffix = `${TEST_PREFIX}_quote_quick_create_product`;
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

    const quickCreateUserId = await createUser({
      fullName: "API Quote Quick Create",
      email: `${TEST_PREFIX}.quotes.quick.create@example.com`,
      roleIds: [ctx.quotationOperationRoleId, ctx.providerManagerRoleId],
    });
    cleanup.userIds.push(quickCreateUserId);

    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.quotes.quick.create@example.com`,
    );

    const listsResponse = await request(app)
      .get("/api/quotation-product-lists")
      .query({ providerId })
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(listsResponse.status).toBe(200);
    expect(listsResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: priceListId,
          providerId,
          itemType: "producto",
        }),
      ]),
    );

    const createResponse = await request(app)
      .post("/api/quotation-products")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        providerId,
        priceListId,
        code: `PRICE-${suffix}-NEW`,
        description: "Producto creado desde picker",
        price: 987.65,
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.product).toEqual(
      expect.objectContaining({
        providerId,
        priceListId,
        code: `PRICE-${suffix}-NEW`,
        description: "Producto creado desde picker",
        itemType: "producto",
        price: 987.65,
      }),
    );
    cleanup.providerPriceItemIds.push(Number(createResponse.body.product.id));

    const searchResponse = await request(app)
      .get("/api/quotation-products/search")
      .query({
        providerId,
        priceListId,
        q: `PRICE-${suffix}-NEW`,
      })
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(searchResponse.status).toBe(200);
    expect(searchResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: `PRICE-${suffix}-NEW`,
          priceListId,
        }),
      ]),
    );

    const duplicateResponse = await request(app)
      .post("/api/quotation-products")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        providerId,
        priceListId,
        code: `PRICE-${suffix}-NEW`,
        description: "Duplicado",
        price: 100,
      });

    expect(duplicateResponse.status).toBe(409);
    expect(duplicateResponse.body.message).toBe(
      "Ya existe un producto con ese codigo en la lista",
    );

    const normalizedDuplicateResponse = await request(app)
      .post("/api/quotation-products")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        providerId,
        priceListId,
        code: ` price - ${suffix} - new `,
        description: "Duplicado normalizado",
        price: 100,
      });

    expect(normalizedDuplicateResponse.status).toBe(409);
    expect(normalizedDuplicateResponse.body.message).toBe(
      "Ya existe un producto con ese codigo en la lista",
    );

    const bundleBlockedResponse = await request(app)
      .post("/api/quotation-products")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        providerId: bundleProviderId,
        priceListId: bundlePriceListId,
        code: `PRICE-${suffix}-BUNDLE`,
        description: "No permitido",
        price: 100,
      });

    expect(bundleBlockedResponse.status).toBe(409);
    expect(bundleBlockedResponse.body.message).toBe(
      "Desde este modal no se pueden crear bundles",
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
          sellerUserEmail: fixture.sellerUserEmail,
          sellerUserPhone: fixture.sellerUserPhone,
        }),
      ]),
    );
  });

  test("cotizaciones.contactos de oportunidad exponen email y telefono del contacto", async () => {
    const fixture = await createOwnedQuoteOpportunityFixture(
      `${TEST_PREFIX}_quote_opportunity_contacts`,
    );
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.quotes.operation@example.com`,
    );

    const contactsResponse = await request(app)
      .get(`/api/quotation-opportunities/${fixture.opportunityId}/contacts`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(contactsResponse.status).toBe(200);
    expect(contactsResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fixture.contactId,
          email: fixture.contactEmail,
          phone: fixture.contactPhone,
        }),
        expect.objectContaining({
          id: fixture.alternateContactId,
          email: fixture.alternateContactEmail,
          phone: fixture.alternateContactPhone,
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
          sellerUserEmail: fixture.sellerUserEmail,
          sellerUserPhone: fixture.sellerUserPhone,
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

  test("cotizaciones.exchange-rate usa Frankfurter con base USD y devuelve 1 para USD", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_quote_exchange_rate`,
    );
    const originalFetch = global.fetch;

    try {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          amount: 1,
          base: "USD",
          date: "2026-05-12",
          rates: {
            MXN: 17.245,
          },
        }),
      });

      const usdResponse = await request(app)
        .get("/api/quotation-exchange-rate?currency=USD")
        .set("Authorization", `Bearer ${fixture.token}`);

      expect(usdResponse.status).toBe(200);
      expect(usdResponse.body).toEqual(
        expect.objectContaining({
          baseCurrency: "USD",
          targetCurrency: "USD",
          exchangeRate: 1,
          provider: "frankfurter",
        }),
      );
      expect(global.fetch).not.toHaveBeenCalled();

      const mxnResponse = await request(app)
        .get("/api/quotation-exchange-rate?currency=MXN")
        .set("Authorization", `Bearer ${fixture.token}`);

      expect(mxnResponse.status).toBe(200);
      expect(mxnResponse.body).toEqual(
        expect.objectContaining({
          baseCurrency: "USD",
          targetCurrency: "MXN",
          exchangeRate: 17.245,
          provider: "frankfurter",
        }),
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          "https://api.frankfurter.app/latest?from=USD&to=MXN",
        ),
        expect.objectContaining({
          method: "GET",
        }),
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("cotizaciones genera un PDF inline desde cambios no guardados", async () => {
    const fixture = await createQuotationFixture(`${TEST_PREFIX}_quote_pdf`);

    const response = await request(app)
      .post("/api/quotations/render-pdf")
      .set("Authorization", `Bearer ${fixture.token}`)
      .buffer(true)
      .parse(binaryParser)
      .send({
        header: {
          quotationDate: "26-04-2026",
          proposalName: "PDF Demo",
          accountName: "Cuenta PDF",
          contactName: "Ana Contacto",
          contactEmail: "ana@example.com",
          contactPhone: "555-100-2000",
          sellerName: "API Seller Fixture",
          sellerEmail: "seller@example.com",
          sellerPhone: "555-300-4000",
        },
        introduction: "Documento PDF generado desde cambios locales.",
        sections: [
          {
            title: "Licencias",
            subtotal: 60,
            rows: [
              {
                displayOrder: 1,
                productCode: "SKU-1",
                productDescription: "Licencia anual",
                quantity: 4,
                quantityDisplay: "4.00",
                salePriceUnit: 15,
                salePriceTotal: 60,
              },
            ],
          },
        ],
        summary: {
          subtotal: 60,
          discount: 0,
          discountedSubtotal: 60,
          vatAmount: 9.6,
          total: 69.6,
          showVat: true,
          currencyCode: "USD",
        },
        commercialTerms: {
          deliveryTime: "30 dias",
          quotationValidity: "30 dias",
          warranty: "1 ano",
          paymentTerms: "30 dias despues de facturado",
          currency: "Dolar estadounidense",
        },
        notes: "Notas locales para el PDF.",
      });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/application\/pdf/);
    expect(response.headers["content-disposition"]).toContain("inline;");
    expect(response.headers["content-disposition"]).toContain("pdf-demo.pdf");
    expect(response.body instanceof Buffer).toBe(true);
    expect(response.body.length).toBeGreaterThan(1000);
    expect(response.body.subarray(0, 4).toString("utf8")).toBe("%PDF");
  });

  test("propuestas genera un PDF inline desde cambios no guardados", async () => {
    const fixture = await createQuotationFixture(`${TEST_PREFIX}_proposal_pdf`);

    const response = await request(app)
      .post("/api/proposals/render-pdf")
      .set("Authorization", `Bearer ${fixture.token}`)
      .buffer(true)
      .parse(binaryParser)
      .send({
        header: {
          proposalTitle: "Propuesta PDF Demo",
          accountName: "Cuenta propuesta",
          contactName: "Ana Contacto",
          quotationNumber: String(fixture.quotationId),
          quotationVersionNumber: String(fixture.latestVersionNumber),
          updatedAtLabel: "26 abr 2026, 10:30",
          statusLabel: "Lista para presentar",
          templateName: "Premium demo",
        },
        theme: {
          coverStyle: "premium",
        },
        sections: [
          {
            title: "Resumen ejecutivo",
            subtitle: "executive_summary",
            blocks: [
              {
                type: "paragraph",
                text: "Documento PDF generado desde cambios locales de la propuesta.",
              },
              {
                type: "list",
                items: [
                  "Incluye narrativa institucional",
                  "Respeta pricing heredado",
                ],
              },
            ],
          },
        ],
        pricing: {
          summary: {
            subtotal: 60,
            total: 69.6,
            currencyCode: "USD",
          },
          sections: [
            {
              title: "Licencias",
              items: [
                {
                  productCode: "SKU-1",
                  productDescription: "Licencia anual",
                  quantity: 4,
                  salePriceTotal: 60,
                },
              ],
            },
          ],
        },
        quotationAttachmentRef: {
          quotationVersionId: fixture.latestVersionId,
        },
      });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/application\/pdf/);
    expect(response.headers["content-disposition"]).toContain("inline;");
    expect(response.headers["content-disposition"]).toContain(
      "propuesta-pdf-demo.pdf",
    );
    expect(response.body instanceof Buffer).toBe(true);
    expect(response.body.length).toBeGreaterThan(2000);
    expect(response.body.subarray(0, 4).toString("utf8")).toBe("%PDF");
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

  test("cotizaciones.documents permite cargar, listar, descargar y heredar adjuntos por version", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_quote_documents`,
    );

    const uploadResponse = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/documents`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .attach(
        "files",
        Buffer.from("Documento de respaldo de propuesta", "utf8"),
        {
          filename: "respaldo-propuesta.txt",
          contentType: "text/plain",
        },
      );

    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.body.documents).toHaveLength(1);
    expect(uploadResponse.body.allDocuments).toHaveLength(1);
    expect(uploadResponse.body.documents[0]).toEqual(
      expect.objectContaining({
        originalFileName: "respaldo-propuesta.txt",
        versionNumber: 1,
      }),
    );

    const versionResponse = await request(app)
      .get(`/api/quotation-versions/${fixture.latestVersionId}`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(versionResponse.status).toBe(200);
    expect(versionResponse.body.documents).toHaveLength(1);
    expect(versionResponse.body.allDocuments).toHaveLength(1);

    const aggregateResponse = await request(app)
      .get(`/api/quotations/${fixture.quotationId}/documents`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(aggregateResponse.status).toBe(200);
    expect(aggregateResponse.body).toHaveLength(1);

    const downloadResponse = await request(app)
      .get(
        `/api/quotation-version-documents/${versionResponse.body.documents[0].id}/download`,
      )
      .set("Authorization", `Bearer ${fixture.token}`)
      .buffer(true)
      .parse(binaryParser);

    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers["content-disposition"]).toContain(
      "attachment;",
    );
    expect(downloadResponse.body instanceof Buffer).toBe(true);
    expect(downloadResponse.body.toString("utf8")).toContain(
      "Documento de respaldo de propuesta",
    );

    const cloneResponse = await request(app)
      .post(`/api/quotations/${fixture.quotationId}/versions`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    expect(cloneResponse.status).toBe(201);

    const clonedVersionResponse = await request(app)
      .get(`/api/quotation-versions/${cloneResponse.body.id}`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(clonedVersionResponse.status).toBe(200);
    expect(clonedVersionResponse.body.documents).toHaveLength(1);
    expect(clonedVersionResponse.body.documents[0]).toEqual(
      expect.objectContaining({
        originalFileName: "respaldo-propuesta.txt",
        versionNumber: 2,
      }),
    );
    expect(clonedVersionResponse.body.allDocuments).toHaveLength(2);
    expect(
      clonedVersionResponse.body.allDocuments.map((document) =>
        Number(document.versionNumber),
      ),
    ).toEqual(expect.arrayContaining([1, 2]));
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

  test("propuestas.create crea una propuesta desde una version aprobada y hereda contexto comercial", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_proposal_create_from_approved`,
    );
    const adminLogin = await login(
      request(app),
      `${TEST_PREFIX}.quotes.admin@example.com`,
    );

    const approveResponse = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/transition`)
      .set("Authorization", `Bearer ${adminLogin.body.token}`)
      .send({ actionCode: "aprobar" });

    expect(approveResponse.status).toBe(200);

    const createProposalResponse = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/proposals`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    expect(createProposalResponse.status).toBe(201);
    cleanup.proposalIds.push(Number(createProposalResponse.body.proposal.id));
    expect(createProposalResponse.body.proposal).toEqual(
      expect.objectContaining({
        quotationId: fixture.quotationId,
        quotationVersionId: fixture.latestVersionId,
        accountId: fixture.accountId,
        contactId: fixture.contactId,
        opportunityId: fixture.opportunityId,
        statusCode: "active",
        updateAvailable: false,
      }),
    );
    expect(createProposalResponse.body.proposal.pricingSnapshot).toEqual(
      expect.objectContaining({
        quotationId: fixture.quotationId,
        quotationVersionId: fixture.latestVersionId,
      }),
    );

    const detailResponse = await request(app)
      .get(`/api/proposals/${createProposalResponse.body.proposal.id}`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.title).toBeTruthy();
    expect(detailResponse.body.content.executiveSummary).toBeDefined();
    expect(detailResponse.body.templateCode).toBe("corporate_core");
    expect(detailResponse.body.isLegacyTemplate).toBe(false);
    expect(detailResponse.body.templateSnapshot).toEqual(
      expect.objectContaining({
        code: "corporate_core",
        coverStyle: "corporate",
      }),
    );

    const quotationDetailResponse = await request(app)
      .get(`/api/quotations/${fixture.quotationId}`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(quotationDetailResponse.status).toBe(200);
    expect(quotationDetailResponse.body.versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fixture.latestVersionId,
          proposalId: Number(createProposalResponse.body.proposal.id),
          hasProposal: true,
          proposalStatusCode: "active",
        }),
      ]),
    );

    const secondCreateProposalResponse = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/proposals`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    expect(secondCreateProposalResponse.status).toBe(200);
    expect(secondCreateProposalResponse.body.created).toBe(false);
    expect(secondCreateProposalResponse.body.proposal.id).toBe(
      createProposalResponse.body.proposal.id,
    );

    const proposalsListResponse = await request(app)
      .get("/api/proposals")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(proposalsListResponse.status).toBe(200);
    expect(
      proposalsListResponse.body.filter(
        (proposal) =>
          Number(proposal.quotationVersionId) ===
          Number(fixture.latestVersionId),
      ),
    ).toHaveLength(1);
  });

  test("propuestas.create resincroniza certificaciones si la propuesta existente no fue editada", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_proposal_create_resyncs_certifications`,
    );
    const adminLogin = await login(
      request(app),
      `${TEST_PREFIX}.quotes.admin@example.com`,
    );
    const configLogin = await login(
      request(app),
      `${TEST_PREFIX}.configuration.manager@example.com`,
    );

    const approveResponse = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/transition`)
      .set("Authorization", `Bearer ${adminLogin.body.token}`)
      .send({ actionCode: "aprobar" });

    expect(approveResponse.status).toBe(200);

    const imageDataUrlA =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sotM7wAAAAASUVORK5CYII=";
    const imageDataUrlB =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAQAAADZc7J/AAAADklEQVR42mP8z/CfBwADhgGJVM0A4QAAAABJRU5ErkJggg==";

    const assetAResponse = await request(app)
      .post("/api/settings/institutional-assets")
      .set("Authorization", `Bearer ${configLogin.body.token}`)
      .send({
        name: `${TEST_PREFIX}_cert_create_sync_a`,
        category: "certification",
        fileUrl: imageDataUrlA,
        fileName: "cert-a.png",
        mimeType: "image/png",
        fileSizeBytes: 128,
        altText: "Certificacion A",
      });

    expect(assetAResponse.status).toBe(201);

    const initialConfigResponse = await request(app)
      .put("/api/settings/proposal-content-config/components/certifications")
      .set("Authorization", `Bearer ${configLogin.body.token}`)
      .send({
        title: "Certificaciones",
        blocks: [
          {
            type: "image",
            assetId: assetAResponse.body.asset.id,
            assetVersionId: assetAResponse.body.asset.currentVersion.id,
          },
        ],
      });

    expect(initialConfigResponse.status).toBe(200);

    const firstCreateResponse = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/proposals`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    expect(firstCreateResponse.status).toBe(201);
    cleanup.proposalIds.push(Number(firstCreateResponse.body.proposal.id));

    const firstDetailResponse = await request(app)
      .get(`/api/proposals/${firstCreateResponse.body.proposal.id}`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(firstDetailResponse.status).toBe(200);
    expect(
      firstDetailResponse.body.components
        .find((component) => component.componentCode === "certifications")
        .blocks.filter((block) => block.type === "image"),
    ).toHaveLength(1);

    const assetBResponse = await request(app)
      .post("/api/settings/institutional-assets")
      .set("Authorization", `Bearer ${configLogin.body.token}`)
      .send({
        name: `${TEST_PREFIX}_cert_create_sync_b`,
        category: "certification",
        fileUrl: imageDataUrlB,
        fileName: "cert-b.png",
        mimeType: "image/png",
        fileSizeBytes: 128,
        altText: "Certificacion B",
      });

    expect(assetBResponse.status).toBe(201);

    const updatedConfigResponse = await request(app)
      .put("/api/settings/proposal-content-config/components/certifications")
      .set("Authorization", `Bearer ${configLogin.body.token}`)
      .send({
        title: "Certificaciones",
        blocks: [
          {
            type: "image",
            assetId: assetAResponse.body.asset.id,
            assetVersionId: assetAResponse.body.asset.currentVersion.id,
          },
          {
            type: "image",
            assetId: assetBResponse.body.asset.id,
            assetVersionId: assetBResponse.body.asset.currentVersion.id,
          },
        ],
      });

    expect(updatedConfigResponse.status).toBe(200);

    const secondCreateResponse = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/proposals`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    expect(secondCreateResponse.status).toBe(200);
    expect(secondCreateResponse.body.created).toBe(false);
    expect(secondCreateResponse.body.proposal.id).toBe(
      firstCreateResponse.body.proposal.id,
    );

    const secondDetailResponse = await request(app)
      .get(`/api/proposals/${firstCreateResponse.body.proposal.id}`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(secondDetailResponse.status).toBe(200);
    expect(
      secondDetailResponse.body.components
        .find((component) => component.componentCode === "certifications")
        .blocks.filter((block) => block.type === "image"),
    ).toHaveLength(2);
  });

  test("propuestas.templates lista plantillas activas y marca la predeterminada", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_proposal_templates_catalog`,
    );

    const response = await request(app)
      .get("/api/proposal-templates")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "corporate_core",
          isDefault: true,
          coverStyle: "corporate",
        }),
        expect.objectContaining({
          code: "executive_premium",
          coverStyle: "premium",
        }),
        expect.objectContaining({
          code: "technical_solution",
          coverStyle: "technical",
        }),
      ]),
    );
  });

  test("propuestas.create permite elegir plantilla explicita", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_proposal_create_with_template`,
    );
    const adminLogin = await login(
      request(app),
      `${TEST_PREFIX}.quotes.admin@example.com`,
    );

    await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/transition`)
      .set("Authorization", `Bearer ${adminLogin.body.token}`)
      .send({ actionCode: "aprobar" });

    const templatesResponse = await request(app)
      .get("/api/proposal-templates")
      .set("Authorization", `Bearer ${fixture.token}`);

    const premiumTemplate = templatesResponse.body.find(
      (template) => template.code === "executive_premium",
    );
    expect(premiumTemplate).toBeTruthy();

    const createProposalResponse = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/proposals`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ templateId: premiumTemplate.id });

    expect(createProposalResponse.status).toBe(201);
    cleanup.proposalIds.push(Number(createProposalResponse.body.proposal.id));
    expect(createProposalResponse.body.proposal).toEqual(
      expect.objectContaining({
        templateId: Number(premiumTemplate.id),
        templateCode: "executive_premium",
        templateName: "Ejecutiva premium",
      }),
    );
    expect(createProposalResponse.body.proposal.templateSnapshot).toEqual(
      expect.objectContaining({
        code: "executive_premium",
        coverStyle: "premium",
      }),
    );
  });

  test("propuestas.apply-template reaplica plantilla sin tocar pricing heredado", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_proposal_apply_template`,
    );
    const adminLogin = await login(
      request(app),
      `${TEST_PREFIX}.quotes.admin@example.com`,
    );

    await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/transition`)
      .set("Authorization", `Bearer ${adminLogin.body.token}`)
      .send({ actionCode: "aprobar" });

    const createProposalResponse = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/proposals`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    expect(createProposalResponse.status).toBe(201);
    cleanup.proposalIds.push(Number(createProposalResponse.body.proposal.id));

    const originalTotal =
      createProposalResponse.body.proposal.pricingSnapshot.summary.total;

    const templatesResponse = await request(app)
      .get("/api/proposal-templates")
      .set("Authorization", `Bearer ${fixture.token}`);
    const technicalTemplate = templatesResponse.body.find(
      (template) => template.code === "technical_solution",
    );
    expect(technicalTemplate).toBeTruthy();

    const applyResponse = await request(app)
      .post(
        `/api/proposals/${createProposalResponse.body.proposal.id}/apply-template`,
      )
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        templateId: technicalTemplate.id,
        mode: "replace_content",
      });

    expect(applyResponse.status).toBe(200);
    expect(applyResponse.body.proposal.templateCode).toBe("technical_solution");
    expect(applyResponse.body.proposal.templateSnapshot).toEqual(
      expect.objectContaining({
        code: "technical_solution",
        coverStyle: "technical",
      }),
    );
    expect(applyResponse.body.proposal.pricingSnapshot.summary.total).toBe(
      originalTotal,
    );
    expect(applyResponse.body.proposal.content.solutionOverview).toContain(
      "frentes de solucion",
    );
  });

  test("propuestas.create bloquea crear desde una version no aprobada", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_proposal_block_unapproved`,
    );

    const response = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/proposals`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    expect(response.status).toBe(409);
    expect(response.body.message).toBe(
      "Solo se puede crear una propuesta desde una version aprobada de cotizacion",
    );
  });

  test("propuestas.rebase actualiza explicitamente la propuesta hacia una nueva version aprobada", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_proposal_rebase`,
    );
    const adminLogin = await login(
      request(app),
      `${TEST_PREFIX}.quotes.admin@example.com`,
    );

    const approveV1Response = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/transition`)
      .set("Authorization", `Bearer ${adminLogin.body.token}`)
      .send({ actionCode: "aprobar" });

    expect(approveV1Response.status).toBe(200);

    const createProposalResponse = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/proposals`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    expect(createProposalResponse.status).toBe(201);
    cleanup.proposalIds.push(Number(createProposalResponse.body.proposal.id));

    const createVersionResponse = await request(app)
      .post(`/api/quotations/${fixture.quotationId}/versions`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    expect(createVersionResponse.status).toBe(201);

    const approveV2Response = await request(app)
      .post(
        `/api/quotation-versions/${createVersionResponse.body.id}/transition`,
      )
      .set("Authorization", `Bearer ${adminLogin.body.token}`)
      .send({ actionCode: "aprobar" });

    expect(approveV2Response.status).toBe(200);

    const listBeforeRebase = await request(app)
      .get("/api/proposals")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(listBeforeRebase.status).toBe(200);
    const pendingProposal = listBeforeRebase.body.find(
      (proposal) =>
        Number(proposal.id) === Number(createProposalResponse.body.proposal.id),
    );
    expect(pendingProposal.updateAvailable).toBe(true);
    expect(pendingProposal.latestApprovedVersionId).toBe(
      Number(createVersionResponse.body.id),
    );

    const rebaseResponse = await request(app)
      .post(`/api/proposals/${createProposalResponse.body.proposal.id}/rebase`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ quotationVersionId: createVersionResponse.body.id });

    expect(rebaseResponse.status).toBe(200);
    expect(rebaseResponse.body.proposal.quotationVersionId).toBe(
      Number(createVersionResponse.body.id),
    );
    expect(rebaseResponse.body.proposal.updateAvailable).toBe(false);
  });

  test("propuestas.ai-summary rechaza assets manuales invalidos antes de encolar el job", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_proposal_ai_manual_invalid_assets`,
    );
    const adminLogin = await login(
      request(app),
      `${TEST_PREFIX}.quotes.admin@example.com`,
    );

    await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/transition`)
      .set("Authorization", `Bearer ${adminLogin.body.token}`)
      .send({ actionCode: "aprobar" });

    const createProposalResponse = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/proposals`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    expect(createProposalResponse.status).toBe(201);
    cleanup.proposalIds.push(Number(createProposalResponse.body.proposal.id));

    const response = await request(app)
      .post(
        `/api/proposals/${createProposalResponse.body.proposal.id}/components/executive_summary/generation-jobs`,
      )
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        mode: "generate_parallel_suggestion",
        languageCode: "es",
        librarySourceMode: "manual",
        selectedLibraryAssetPublicIds: ["cea_inexistente_1234"],
      });

    expect(response.status).toBe(422);
    expect(response.body).toEqual(
      expect.objectContaining({
        message:
          "Uno o mas activos seleccionados no son validos para esta generacion",
        error: expect.objectContaining({
          code: "invalid_library_sources",
        }),
        details: expect.objectContaining({
          invalidAssetPublicIds: ["cea_inexistente_1234"],
        }),
      }),
    );
  });

  test("propuestas.ai-summary acepta seleccion manual valida y expone el request persistido del job", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_proposal_ai_manual_sources`,
    );
    const adminLogin = await login(
      request(app),
      `${TEST_PREFIX}.quotes.admin@example.com`,
    );
    const enablementRoleId = await createRole({
      name: `${TEST_PREFIX}_enablement_manager_manual_sources`,
      permissionCodes: ["enablement_comercial.manage"],
    });
    cleanup.roleIds.push(enablementRoleId);
    const enablementUserId = await createUser({
      fullName: "API Enablement Manager",
      email: `${TEST_PREFIX}.enablement.manager@example.com`,
      roleIds: [enablementRoleId],
    });
    cleanup.userIds.push(enablementUserId);
    const enablementLogin = await login(
      request(app),
      `${TEST_PREFIX}.enablement.manager@example.com`,
    );

    async function createPublishedLibraryAsset(suffix) {
      const createAssetResponse = await request(app)
        .post("/api/commercial-enablement/assets")
        .set("Authorization", `Bearer ${enablementLogin.body.token}`)
        .send({
          title: `${TEST_PREFIX}_${suffix}`,
          summary: "Activo comercial compartible para el resumen ejecutivo.",
          assetTypeCode: "solution_brief",
          status: "draft",
          sourceType: "url",
          visibilityLevel: "client_safe",
          audienceCode: "client",
          manufacturerCodes: ["microsoft"],
          solutionCodes: ["seguridad"],
          industryCodes: ["finanzas"],
          stageCodes: ["contacto_inicial"],
        });

      expect(createAssetResponse.status).toBe(201);

      const assetPublicId = createAssetResponse.body.publicId;
      const createLinkResponse = await request(app)
        .post(`/api/commercial-enablement/assets/${assetPublicId}/links`)
        .set("Authorization", `Bearer ${enablementLogin.body.token}`)
        .send({
          url: `https://example.com/${suffix}`,
          label: `Fuente ${suffix}`,
          description: "Fuente comercial para pruebas de propuesta",
          isPrimary: true,
        });

      expect(createLinkResponse.status).toBe(201);

      const publishResponse = await request(app)
        .post(`/api/commercial-enablement/assets/${assetPublicId}/publish`)
        .set("Authorization", `Bearer ${enablementLogin.body.token}`)
        .send({});

      expect(publishResponse.status).toBe(200);
      return publishResponse.body;
    }

    await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/transition`)
      .set("Authorization", `Bearer ${adminLogin.body.token}`)
      .send({ actionCode: "aprobar" });

    const createProposalResponse = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/proposals`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    expect(createProposalResponse.status).toBe(201);
    cleanup.proposalIds.push(Number(createProposalResponse.body.proposal.id));

    const asset = await createPublishedLibraryAsset("proposal_ai_source_a");

    const createJobResponse = await request(app)
      .post(
        `/api/proposals/${createProposalResponse.body.proposal.id}/components/executive_summary/generation-jobs`,
      )
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        mode: "generate_parallel_suggestion",
        languageCode: "es",
        instructions: "Usa un tono consultivo y orientado a valor.",
        librarySourceMode: "manual",
        libraryContentMode: "summary_extract",
        sourcePriorityMode: "non_library_first",
        selectedLibraryAssetPublicIds: [asset.publicId],
      });

    expect(createJobResponse.status).toBe(202);
    expect(createJobResponse.body.job.request).toEqual({
      languageCode: "es",
      instructions: "Usa un tono consultivo y orientado a valor.",
      maxLibraryAssets: 4,
      librarySourceMode: "manual",
      libraryContentMode: "summary_extract",
      sourcePriorityMode: "non_library_first",
      selectedLibraryAssetPublicIds: [asset.publicId],
    });

    const latestJobResponse = await request(app)
      .get(
        `/api/proposals/${createProposalResponse.body.proposal.id}/components/executive_summary/generation-jobs/latest`,
      )
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(latestJobResponse.status).toBe(200);
    expect(latestJobResponse.body.job).toEqual(
      expect.objectContaining({
        publicId: createJobResponse.body.job.publicId,
        request: {
          languageCode: "es",
          instructions: "Usa un tono consultivo y orientado a valor.",
          maxLibraryAssets: 4,
          librarySourceMode: "manual",
          libraryContentMode: "summary_extract",
          sourcePriorityMode: "non_library_first",
          selectedLibraryAssetPublicIds: [asset.publicId],
        },
      }),
    );

    await query(`DELETE FROM proposal_ai_jobs WHERE public_id = ?`, [
      createJobResponse.body.job.publicId,
    ]);
  });

  test("propuestas.ai-summary usa la configuracion IA publicada para prompt, modelo y timeout", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_proposal_ai_published_parameters`,
    );
    const configLogin = await login(
      request(app),
      `${TEST_PREFIX}.configuration.manager@example.com`,
    );
    const configToken = configLogin.body.token;

    const currentConfigResponse = await request(app)
      .get("/api/settings/ai-parameters")
      .set("Authorization", `Bearer ${configToken}`);
    expect(currentConfigResponse.status).toBe(200);

    const originalEntry = currentConfigResponse.body.config.entries.find(
      (entry) => entry.capabilityKey === "proposal.executive_summary",
    );
    expect(originalEntry).toBeTruthy();

    const customPrompt =
      "Redacta un resumen ejecutivo en JSON valido. Usa documentSources y generationPolicy como referencias primarias.";
    const customTemplate =
      "Plantilla publicada\n{{context}}\nSalida esperada\n{{expectedShape}}";

    await request(app)
      .put("/api/settings/ai-parameters/entries/proposal.executive_summary")
      .set("Authorization", `Bearer ${configToken}`)
      .send({
        title: originalEntry.title,
        description: originalEntry.description,
        isEnabled: true,
        modelOverride: "gpt-5.4-mini",
        timeoutMs: 65000,
        systemPrompt: customPrompt,
        userPromptTemplate: customTemplate,
        outputSchema: originalEntry.outputSchema,
        parameters: originalEntry.parameters,
        changeSummary: "Configuracion publicada para prueba de consumo",
      });
    await request(app)
      .post("/api/settings/ai-parameters/publish")
      .set("Authorization", `Bearer ${configToken}`)
      .send({});

    const adminLogin = await login(
      request(app),
      `${TEST_PREFIX}.quotes.admin@example.com`,
    );

    await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/transition`)
      .set("Authorization", `Bearer ${adminLogin.body.token}`)
      .send({ actionCode: "aprobar" });

    const createProposalResponse = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/proposals`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    expect(createProposalResponse.status).toBe(201);
    const proposalId = Number(createProposalResponse.body.proposal.id);
    cleanup.proposalIds.push(proposalId);

    const originalApiKey = config.openai.apiKey;
    const originalFetch = global.fetch;

    try {
      config.openai.apiKey = "test-key";
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    title: "Resumen ejecutivo sugerido",
                    paragraphs: [
                      "Parrafo generado desde configuracion publicada.",
                    ],
                    warnings: [],
                  }),
                },
              ],
            },
          ],
        }),
      });

      const createJobResponse = await request(app)
        .post(
          `/api/proposals/${proposalId}/components/executive_summary/generation-jobs`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          mode: "generate_parallel_suggestion",
          languageCode: "es",
          librarySourceMode: "auto",
          libraryContentMode: "summary_extract",
          sourcePriorityMode: "balanced",
          selectedLibraryAssetPublicIds: [],
        });

      expect(createJobResponse.status).toBe(202);

      await processPendingProposalExecutiveSummaryGenerationJobs({ limit: 1 });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const fetchPayload = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(fetchPayload.model).toBe("gpt-5.4-mini");
      expect(fetchPayload.input[0].content).toBe(customPrompt);
      expect(fetchPayload.input[1].content).toContain("Plantilla publicada");
      expect(fetchPayload.input[1].content).toContain("generationPolicy");
      expect(fetchPayload.input[1].content).toContain("Salida esperada");
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
      await request(app)
        .put("/api/settings/ai-parameters/entries/proposal.executive_summary")
        .set("Authorization", `Bearer ${configToken}`)
        .send({
          title: originalEntry.title,
          description: originalEntry.description,
          isEnabled: originalEntry.isEnabled,
          modelOverride: originalEntry.modelOverride,
          timeoutMs: originalEntry.timeoutMs,
          systemPrompt: originalEntry.systemPrompt,
          userPromptTemplate: originalEntry.userPromptTemplate,
          outputSchema: originalEntry.outputSchema,
          parameters: originalEntry.parameters,
          changeSummary: "Restauracion automatica de prueba",
        });
      await request(app)
        .post("/api/settings/ai-parameters/publish")
        .set("Authorization", `Bearer ${configToken}`)
        .send({});
    }
  });

  test("propuestas.ai-summary envia texto fuente de biblioteca y prioridad explicita al modelo", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_proposal_ai_library_source_text_context`,
    );
    const adminLogin = await login(
      request(app),
      `${TEST_PREFIX}.quotes.admin@example.com`,
    );
    const enablementRoleId = await createRole({
      name: `${TEST_PREFIX}_enablement_manager_source_text_context`,
      permissionCodes: ["enablement_comercial.manage"],
    });
    cleanup.roleIds.push(enablementRoleId);
    const enablementUserId = await createUser({
      fullName: "API Enablement Manager Source Context",
      email: `${TEST_PREFIX}.enablement.source.context@example.com`,
      roleIds: [enablementRoleId],
    });
    cleanup.userIds.push(enablementUserId);
    const enablementLogin = await login(
      request(app),
      `${TEST_PREFIX}.enablement.source.context@example.com`,
    );

    const createAssetResponse = await request(app)
      .post("/api/commercial-enablement/assets")
      .set("Authorization", `Bearer ${enablementLogin.body.token}`)
      .send({
        title: `${TEST_PREFIX}_proposal_ai_source_text_asset`,
        summary:
          "Resumen comercial corto del activo para continuidad operativa.",
        assetTypeCode: "solution_brief",
        status: "draft",
        sourceType: "url",
        visibilityLevel: "client_safe",
        audienceCode: "client",
        manufacturerCodes: ["microsoft"],
        solutionCodes: ["seguridad"],
        industryCodes: ["finanzas"],
        stageCodes: ["contacto_inicial"],
      });

    expect(createAssetResponse.status).toBe(201);

    const assetPublicId = String(createAssetResponse.body.publicId || "");
    await request(app)
      .post(`/api/commercial-enablement/assets/${assetPublicId}/links`)
      .set("Authorization", `Bearer ${enablementLogin.body.token}`)
      .send({
        url: "https://example.com/proposal-ai-source-text-context",
        label: "Fuente contexto biblioteca",
        description: "Fuente de biblioteca para pruebas de contexto IA",
        isPrimary: true,
      });

    await query(
      `INSERT INTO commercial_enablement_item_source_contents
        (item_id, source_file_name, source_mime_type, source_checksum,
         extracted_text, extracted_text_summary, accepted_suggestions_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3))`,
      [
        Number(createAssetResponse.body.id),
        "source-text-context.pdf",
        "application/pdf",
        `${TEST_PREFIX}_proposal_ai_source_text_checksum`,
        "El activo de biblioteca detalla una estrategia de continuidad operativa, seguridad administrada, adopcion gradual y diferenciadores tecnicos para instituciones financieras con foco en banca digital.",
        "Continuidad operativa y seguridad administrada para banca digital.",
        JSON.stringify({}),
      ],
    );

    const publishResponse = await request(app)
      .post(`/api/commercial-enablement/assets/${assetPublicId}/publish`)
      .set("Authorization", `Bearer ${enablementLogin.body.token}`)
      .send({});

    expect(publishResponse.status).toBe(200);

    await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/transition`)
      .set("Authorization", `Bearer ${adminLogin.body.token}`)
      .send({ actionCode: "aprobar" });

    const createProposalResponse = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/proposals`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    expect(createProposalResponse.status).toBe(201);
    const proposalId = Number(createProposalResponse.body.proposal.id);
    cleanup.proposalIds.push(proposalId);

    const originalApiKey = config.openai.apiKey;
    const originalFetch = global.fetch;

    try {
      config.openai.apiKey = "test-key";
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    title: "Resumen ejecutivo sugerido",
                    paragraphs: [
                      "La propuesta aprovecha activos documentales de biblioteca con foco explicito en continuidad operativa y seguridad administrada.",
                    ],
                    warnings: [],
                  }),
                },
              ],
            },
          ],
        }),
      });

      const createJobResponse = await request(app)
        .post(
          `/api/proposals/${proposalId}/components/executive_summary/generation-jobs`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          mode: "generate_parallel_suggestion",
          languageCode: "es",
          librarySourceMode: "manual",
          libraryContentMode: "source_text",
          sourcePriorityMode: "library_first",
          selectedLibraryAssetPublicIds: [assetPublicId],
        });

      expect(createJobResponse.status).toBe(202);

      await processPendingProposalExecutiveSummaryGenerationJobs({ limit: 1 });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const fetchPayload = JSON.parse(global.fetch.mock.calls[0][1].body);
      const requestContext = JSON.parse(fetchPayload.input[1].content).context;

      expect(requestContext.generationPolicy).toEqual(
        expect.objectContaining({
          librarySourceMode: "manual",
          libraryContentMode: "source_text",
          sourcePriorityMode: "library_first",
        }),
      );
      expect(requestContext.libraryContext.documentSources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceKind: "library_asset",
            assetPublicId,
            contentModeUsed: "source_text",
            selectionMode: "manual",
            text: expect.stringContaining(
              "estrategia de continuidad operativa",
            ),
          }),
        ]),
      );
      expect(requestContext.documentSources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceKind: "library_asset",
            sourcePriorityGroup: "library",
            assetPublicId,
          }),
        ]),
      );

      const latestJobResponse = await request(app)
        .get(
          `/api/proposals/${proposalId}/components/executive_summary/generation-jobs/latest`,
        )
        .set("Authorization", `Bearer ${fixture.token}`);

      expect(latestJobResponse.status).toBe(200);
      expect(latestJobResponse.body.job.result.sources).toEqual(
        expect.objectContaining({
          generationPolicy: {
            librarySourceMode: "manual",
            libraryContentMode: "source_text",
            sourcePriorityMode: "library_first",
          },
        }),
      );
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
    }
  });

  test("propuestas.ai-summary no invalida el job si solo cambia updated_at de la propuesta antes de procesarlo", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_proposal_ai_auto_timestamp_regression`,
    );
    const adminLogin = await login(
      request(app),
      `${TEST_PREFIX}.quotes.admin@example.com`,
    );

    await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/transition`)
      .set("Authorization", `Bearer ${adminLogin.body.token}`)
      .send({ actionCode: "aprobar" });

    const createProposalResponse = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/proposals`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    expect(createProposalResponse.status).toBe(201);
    const proposalId = Number(createProposalResponse.body.proposal.id);
    cleanup.proposalIds.push(proposalId);

    const originalApiKey = config.openai.apiKey;
    const originalFetch = global.fetch;

    try {
      config.openai.apiKey = "test-key";
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    title: "Resumen ejecutivo sugerido",
                    paragraphs: [
                      "La propuesta prioriza continuidad operativa y proteccion del entorno del cliente con una narrativa ejecutiva consistente.",
                    ],
                    warnings: [],
                  }),
                },
              ],
            },
          ],
        }),
      });

      const createJobResponse = await request(app)
        .post(
          `/api/proposals/${proposalId}/components/executive_summary/generation-jobs`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          mode: "generate_parallel_suggestion",
          languageCode: "es",
          maxLibraryAssets: 4,
          librarySourceMode: "auto",
          selectedLibraryAssetPublicIds: [],
        });

      expect(createJobResponse.status).toBe(202);
      const jobPublicId = String(createJobResponse.body.job.publicId || "");
      expect(jobPublicId).toBeTruthy();

      await query(
        `UPDATE proposals
         SET updated_at = NOW(3), updated_by_user_id = ?
         WHERE id = ?`,
        [Number(fixture.sellerUserId), proposalId],
      );

      await processPendingProposalExecutiveSummaryGenerationJobs({ limit: 1 });

      const latestJobResponse = await request(app)
        .get(
          `/api/proposals/${proposalId}/components/executive_summary/generation-jobs/latest`,
        )
        .set("Authorization", `Bearer ${fixture.token}`);

      expect(latestJobResponse.status).toBe(200);
      expect(latestJobResponse.body.job).toEqual(
        expect.objectContaining({
          publicId: jobPublicId,
          status: "completed",
        }),
      );
      expect(latestJobResponse.body.job.error).toBeNull();
      expect(latestJobResponse.body.job.result).toEqual(
        expect.objectContaining({
          suggestion: expect.objectContaining({
            title: "Resumen ejecutivo sugerido",
          }),
        }),
      );
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
    }
  });

  test("propuestas.ai-summary completa la sugerencia aunque el resumen ejecutivo cambie antes de procesar el job", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_proposal_ai_draft_change_regression`,
    );
    const adminLogin = await login(
      request(app),
      `${TEST_PREFIX}.quotes.admin@example.com`,
    );

    await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/transition`)
      .set("Authorization", `Bearer ${adminLogin.body.token}`)
      .send({ actionCode: "aprobar" });

    const createProposalResponse = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/proposals`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    expect(createProposalResponse.status).toBe(201);
    const proposalId = Number(createProposalResponse.body.proposal.id);
    cleanup.proposalIds.push(proposalId);

    const originalApiKey = config.openai.apiKey;
    const originalFetch = global.fetch;

    try {
      config.openai.apiKey = "test-key";
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    title: "Resumen ejecutivo sugerido",
                    paragraphs: [
                      "La propuesta sintetiza el contexto comercial actualizado y los beneficios mas relevantes para el cliente.",
                    ],
                    warnings: [],
                  }),
                },
              ],
            },
          ],
        }),
      });

      const createJobResponse = await request(app)
        .post(
          `/api/proposals/${proposalId}/components/executive_summary/generation-jobs`,
        )
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          mode: "generate_parallel_suggestion",
          languageCode: "es",
          maxLibraryAssets: 4,
          librarySourceMode: "auto",
          selectedLibraryAssetPublicIds: [],
        });

      expect(createJobResponse.status).toBe(202);

      const updateComponentResponse = await request(app)
        .put(`/api/proposals/${proposalId}/components/executive_summary`)
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          title: "Resumen ejecutivo",
          blocks: [
            {
              type: "paragraph",
              text: "El resumen ejecutivo fue ajustado manualmente despues de solicitar la sugerencia IA.",
              items: [],
            },
          ],
        });

      expect(updateComponentResponse.status).toBe(200);

      await processPendingProposalExecutiveSummaryGenerationJobs({ limit: 1 });

      const latestJobResponse = await request(app)
        .get(
          `/api/proposals/${proposalId}/components/executive_summary/generation-jobs/latest`,
        )
        .set("Authorization", `Bearer ${fixture.token}`);

      expect(latestJobResponse.status).toBe(200);
      expect(latestJobResponse.body.job).toEqual(
        expect.objectContaining({
          publicId: createJobResponse.body.job.publicId,
          status: "completed",
        }),
      );
      expect(latestJobResponse.body.job.error).toBeNull();
      expect(latestJobResponse.body.job.result).toEqual(
        expect.objectContaining({
          suggestion: expect.objectContaining({
            title: "Resumen ejecutivo sugerido",
          }),
        }),
      );
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
    }
  });

  test("enablement.assets reanaliza el resumen de un activo existente usando su contenido fuente", async () => {
    const enablementRoleId = await createRole({
      name: `${TEST_PREFIX}_enablement_manager_reanalyze_summary`,
      permissionCodes: ["enablement_comercial.manage"],
    });
    cleanup.roleIds.push(enablementRoleId);

    const enablementUserId = await createUser({
      fullName: "API Enablement Summary Manager",
      email: `${TEST_PREFIX}.enablement.summary.manager@example.com`,
      roleIds: [enablementRoleId],
    });
    cleanup.userIds.push(enablementUserId);

    const enablementLogin = await login(
      request(app),
      `${TEST_PREFIX}.enablement.summary.manager@example.com`,
    );

    const createAssetResponse = await request(app)
      .post("/api/commercial-enablement/assets")
      .set("Authorization", `Bearer ${enablementLogin.body.token}`)
      .send({
        title: `${TEST_PREFIX}_summary_reanalyze_asset`,
        summary: "Resumen inicial breve.",
        assetTypeCode: "solution_brief",
        status: "draft",
        sourceType: "file",
        visibilityLevel: "client_safe",
        audienceCode: "client",
        manufacturerCodes: ["microsoft"],
        solutionCodes: ["seguridad"],
        industryCodes: ["finanzas"],
        stageCodes: ["contacto_inicial"],
      });

    expect(createAssetResponse.status).toBe(201);

    await query(
      `INSERT INTO commercial_enablement_item_source_contents
        (item_id, source_file_name, source_mime_type, source_checksum,
         extracted_text, extracted_text_summary, accepted_suggestions_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3))`,
      [
        Number(createAssetResponse.body.id),
        "secure-edge-overview.pdf",
        "application/pdf",
        `${TEST_PREFIX}_summary_checksum`,
        "El documento describe una propuesta de seguridad perimetral administrada con visibilidad centralizada, mitigacion de amenazas, continuidad operativa y recomendaciones de despliegue para clientes empresariales del sector financiero.",
        "Documento sobre seguridad perimetral administrada y continuidad operativa.",
        JSON.stringify({}),
      ],
    );

    const detailResponse = await request(app)
      .get(
        `/api/commercial-enablement/assets/${createAssetResponse.body.publicId}`,
      )
      .set("Authorization", `Bearer ${enablementLogin.body.token}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.sourceContent).toEqual(
      expect.objectContaining({
        canReanalyzeSummary: true,
        hasExtractedText: true,
        sourceFileName: "secure-edge-overview.pdf",
      }),
    );

    const originalApiKey = config.openai.apiKey;
    const originalFetch = global.fetch;

    try {
      config.openai.apiKey = "test-key";
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            summary:
              "Documento que resume una propuesta de seguridad perimetral administrada, explicando su alcance, el valor de continuidad operativa y las recomendaciones de despliegue para clientes empresariales.",
          }),
        }),
      });

      const response = await request(app)
        .post(
          `/api/commercial-enablement/assets/${createAssetResponse.body.publicId}/reanalyze-summary`,
        )
        .set("Authorization", `Bearer ${enablementLogin.body.token}`)
        .send({ forceRegenerate: true });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          assetPublicId: createAssetResponse.body.publicId,
          summarySuggestion: expect.objectContaining({
            text: expect.stringContaining("seguridad perimetral administrada"),
            languageCode: "es",
            sourceKind: "item_source_content",
            sourceFileName: "secure-edge-overview.pdf",
          }),
          meta: expect.objectContaining({
            usedAi: true,
          }),
        }),
      );
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
    }
  });

  test("enablement.intake analiza un documento y normaliza a espanol un resumen IA en ingles", async () => {
    const enablementRoleId = await createRole({
      name: `${TEST_PREFIX}_enablement_manager_intake_summary_language`,
      permissionCodes: ["enablement_comercial.manage"],
    });
    cleanup.roleIds.push(enablementRoleId);

    const enablementUserId = await createUser({
      fullName: "API Enablement Intake Summary Manager",
      email: `${TEST_PREFIX}.enablement.intake.summary@example.com`,
      roleIds: [enablementRoleId],
    });
    cleanup.userIds.push(enablementUserId);

    const enablementLogin = await login(
      request(app),
      `${TEST_PREFIX}.enablement.intake.summary@example.com`,
    );

    const intakePublicId = `${TEST_PREFIX}_intake_summary_language`;
    const [sessionResult] = await query(
      `INSERT INTO commercial_enablement_intake_sessions
        (public_id, status, uploaded_by_user_id, source_file_name, source_mime_type,
         source_size_bytes, source_checksum, storage_provider, storage_bucket,
         storage_key, extraction_status, analysis_status, source_hint, source_summary,
         language_detected, page_count, extraction_preview, expires_at, created_at, updated_at)
       VALUES (?, 'analysis_pending', ?, ?, ?, ?, ?, ?, ?, ?, 'completed', 'pending', ?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL 24 HOUR), NOW(3), NOW(3))`,
      [
        intakePublicId,
        Number(enablementUserId),
        "micetro-data-sheet.pdf",
        "application/pdf",
        2048,
        `${TEST_PREFIX}_intake_summary_checksum`,
        "local",
        null,
        `commercial_enablement/intake/${intakePublicId}/source.pdf`,
        "",
        "Resumen preliminar del documento Micetro.",
        "en",
        2,
        "Data sheet Easy and intuitive DDI orchestration Get centralized visibility of your network without disruption.",
      ],
    );
    const intakeSessionId = Number(sessionResult.insertId);

    await query(
      `INSERT INTO commercial_enablement_intake_extracted_content
        (intake_session_id, content_kind, page_number, text_content, char_count, created_at)
       VALUES (?, 'full_text', NULL, ?, ?, NOW(3))`,
      [
        intakeSessionId,
        "Data sheet Easy and intuitive DDI orchestration. Get centralized visibility of your network without disruption. The big picture for DNS, DHCP, and IP address management helps users, customers, and agents access the network core and beyond.",
        240,
      ],
    );

    const originalApiKey = config.openai.apiKey;
    const originalFetch = global.fetch;

    try {
      config.openai.apiKey = "test-key";
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            prefill: {
              summary: {
                value:
                  "Data sheet Easy and intuitive DDI orchestration Get centralized visibility of your network without disruption By simplifying the access to the core and beyond.",
                confidence: "high",
                decisionRequired: false,
              },
            },
          }),
        }),
      });

      const response = await request(app)
        .post(
          `/api/commercial-enablement/intake-sessions/${intakePublicId}/analyze`,
        )
        .set("Authorization", `Bearer ${enablementLogin.body.token}`)
        .send({ forceRegenerate: true });

      expect(response.status).toBe(200);
      expect(response.body.analysisStatus).toBe("completed");
      expect(response.body.draftPayload).toEqual(
        expect.objectContaining({
          summary: expect.stringMatching(/^Ficha tecnica sobre Micetro\./),
          languageCode: "en",
        }),
      );
      expect(response.body.draftPayload.summary).toContain(
        "Resume el contenido principal",
      );
      expect(response.body.draftPayload.summary).not.toContain(
        "Get centralized visibility",
      );
      expect(response.body.draftPayload.summary).not.toContain(
        "Easy and intuitive",
      );
    } finally {
      global.fetch = originalFetch;
      config.openai.apiKey = originalApiKey;
    }
  });

  test("configuracion.proposal-content permite guardar defaults con assets institucionales", async () => {
    const configLogin = await login(
      request(app),
      `${TEST_PREFIX}.configuration.manager@example.com`,
    );
    const imageDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sotM7wAAAAASUVORK5CYII=";

    const createAssetResponse = await request(app)
      .post("/api/settings/institutional-assets")
      .set("Authorization", `Bearer ${configLogin.body.token}`)
      .send({
        name: `${TEST_PREFIX}_proposal_asset_default`,
        category: "brochure",
        description: "Brochure institucional para propuestas",
        fileUrl: imageDataUrl,
        fileName: "brochure-default.png",
        mimeType: "image/png",
        fileSizeBytes: 128,
        altText: "Brochure default",
        caption: "Brochure institucional",
      });

    expect(createAssetResponse.status).toBe(201);
    expect(createAssetResponse.body.asset.currentVersion).toBeTruthy();

    const saveComponentResponse = await request(app)
      .put("/api/settings/proposal-content-config/components/product_brochures")
      .set("Authorization", `Bearer ${configLogin.body.token}`)
      .send({
        title: "Folletos de los productos",
        blocks: [
          {
            type: "paragraph",
            text: "Incluimos los folletos mas relevantes para respaldar la solucion propuesta.",
          },
          {
            type: "image",
            assetId: createAssetResponse.body.asset.id,
            assetVersionId: createAssetResponse.body.asset.currentVersion.id,
          },
        ],
      });

    expect(saveComponentResponse.status).toBe(200);

    const configResponse = await request(app)
      .get("/api/settings/proposal-content-config")
      .set("Authorization", `Bearer ${configLogin.body.token}`);

    expect(configResponse.status).toBe(200);
    const brochuresComponent = configResponse.body.config.components.find(
      (component) => component.componentCode === "product_brochures",
    );
    expect(brochuresComponent).toBeTruthy();
    expect(brochuresComponent.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "paragraph",
        }),
        expect.objectContaining({
          type: "image",
          assetId: Number(createAssetResponse.body.asset.id),
          assetVersionId: Number(
            createAssetResponse.body.asset.currentVersion.id,
          ),
        }),
      ]),
    );
  });

  test("configuracion.proposal-content guarda layoutConfig explicito y lo clona a propuestas nuevas", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_proposal_layout_config_clone`,
    );
    const adminLogin = await login(
      request(app),
      `${TEST_PREFIX}.quotes.admin@example.com`,
    );
    const configLogin = await login(
      request(app),
      `${TEST_PREFIX}.configuration.manager@example.com`,
    );
    const imageDataUrlA =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sotM7wAAAAASUVORK5CYII=";
    const imageDataUrlB =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAQAAADZc7J/AAAADklEQVR42mP8z/CfBwADhgGJVM0A4QAAAABJRU5ErkJggg==";

    const assetAResponse = await request(app)
      .post("/api/settings/institutional-assets")
      .set("Authorization", `Bearer ${configLogin.body.token}`)
      .send({
        name: `${TEST_PREFIX}_layout_asset_a`,
        category: "certification",
        fileUrl: imageDataUrlA,
        fileName: "layout-a.png",
        mimeType: "image/png",
        fileSizeBytes: 128,
      });

    const assetBResponse = await request(app)
      .post("/api/settings/institutional-assets")
      .set("Authorization", `Bearer ${configLogin.body.token}`)
      .send({
        name: `${TEST_PREFIX}_layout_asset_b`,
        category: "certification",
        fileUrl: imageDataUrlB,
        fileName: "layout-b.png",
        mimeType: "image/png",
        fileSizeBytes: 128,
      });

    expect(assetAResponse.status).toBe(201);
    expect(assetBResponse.status).toBe(201);

    const saveComponentResponse = await request(app)
      .put("/api/settings/proposal-content-config/components/certifications")
      .set("Authorization", `Bearer ${configLogin.body.token}`)
      .send({
        title: "Certificaciones",
        layoutConfig: {
          mode: "manual-rows",
          rows: [{ blockIndexes: [0, 1] }],
        },
        blocks: [
          {
            type: "image",
            assetId: assetAResponse.body.asset.id,
            assetVersionId: assetAResponse.body.asset.currentVersion.id,
          },
          {
            type: "image",
            assetId: assetBResponse.body.asset.id,
            assetVersionId: assetBResponse.body.asset.currentVersion.id,
          },
        ],
      });

    expect(saveComponentResponse.status).toBe(200);
    expect(
      saveComponentResponse.body.config.components.find(
        (component) => component.componentCode === "certifications",
      ),
    ).toEqual(
      expect.objectContaining({
        layoutConfig: {
          mode: "manual-rows",
          rows: [{ blockIndexes: [0, 1] }],
        },
        resolvedLayoutMode: "manual-rows",
      }),
    );

    await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/transition`)
      .set("Authorization", `Bearer ${adminLogin.body.token}`)
      .send({ actionCode: "aprobar" });

    const createProposalResponse = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/proposals`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    expect(createProposalResponse.status).toBe(201);
    cleanup.proposalIds.push(Number(createProposalResponse.body.proposal.id));

    const detailResponse = await request(app)
      .get(`/api/proposals/${createProposalResponse.body.proposal.id}`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(detailResponse.status).toBe(200);
    expect(
      detailResponse.body.components.find(
        (component) => component.componentCode === "certifications",
      ),
    ).toEqual(
      expect.objectContaining({
        layoutConfig: {
          mode: "manual-rows",
          rows: [{ blockIndexes: [0, 1] }],
        },
        resolvedLayoutMode: "manual-rows",
      }),
    );
  });

  test("propuestas.detail resincroniza certificaciones manual-rows desde configuracion cuando la propuesta sigue intacta", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_proposal_layout_config_resync_on_detail`,
    );
    const adminLogin = await login(
      request(app),
      `${TEST_PREFIX}.quotes.admin@example.com`,
    );
    const configLogin = await login(
      request(app),
      `${TEST_PREFIX}.configuration.manager@example.com`,
    );
    const imageDataUrlA =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sotM7wAAAAASUVORK5CYII=";
    const imageDataUrlB =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAQAAADZc7J/AAAADklEQVR42mP8z/CfBwADhgGJVM0A4QAAAABJRU5ErkJggg==";
    const imageDataUrlC =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAQAAABWKLW/AAAAD0lEQVR42mNk+M/QzwAEGgH+lmjSPwAAAABJRU5ErkJggg==";

    const assetAResponse = await request(app)
      .post("/api/settings/institutional-assets")
      .set("Authorization", `Bearer ${configLogin.body.token}`)
      .send({
        name: `${TEST_PREFIX}_resync_layout_asset_a`,
        category: "certification",
        fileUrl: imageDataUrlA,
        fileName: "resync-layout-a.png",
        mimeType: "image/png",
        fileSizeBytes: 128,
      });

    const assetBResponse = await request(app)
      .post("/api/settings/institutional-assets")
      .set("Authorization", `Bearer ${configLogin.body.token}`)
      .send({
        name: `${TEST_PREFIX}_resync_layout_asset_b`,
        category: "certification",
        fileUrl: imageDataUrlB,
        fileName: "resync-layout-b.png",
        mimeType: "image/png",
        fileSizeBytes: 128,
      });

    const assetCResponse = await request(app)
      .post("/api/settings/institutional-assets")
      .set("Authorization", `Bearer ${configLogin.body.token}`)
      .send({
        name: `${TEST_PREFIX}_resync_layout_asset_c`,
        category: "certification",
        fileUrl: imageDataUrlC,
        fileName: "resync-layout-c.png",
        mimeType: "image/png",
        fileSizeBytes: 128,
      });

    expect(assetAResponse.status).toBe(201);
    expect(assetBResponse.status).toBe(201);
    expect(assetCResponse.status).toBe(201);

    const initialConfigResponse = await request(app)
      .put("/api/settings/proposal-content-config/components/certifications")
      .set("Authorization", `Bearer ${configLogin.body.token}`)
      .send({
        title: "Certificaciones",
        blocks: [
          {
            type: "image",
            assetId: assetAResponse.body.asset.id,
            assetVersionId: assetAResponse.body.asset.currentVersion.id,
          },
          {
            type: "image",
            assetId: assetBResponse.body.asset.id,
            assetVersionId: assetBResponse.body.asset.currentVersion.id,
          },
        ],
      });

    expect(initialConfigResponse.status).toBe(200);

    await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/transition`)
      .set("Authorization", `Bearer ${adminLogin.body.token}`)
      .send({ actionCode: "aprobar" });

    const createProposalResponse = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/proposals`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    expect(createProposalResponse.status).toBe(201);
    cleanup.proposalIds.push(Number(createProposalResponse.body.proposal.id));
    expect(
      createProposalResponse.body.proposal.components.find(
        (component) => component.componentCode === "certifications",
      ),
    ).toEqual(
      expect.objectContaining({
        resolvedLayoutMode: "horizontal-gallery",
      }),
    );

    const updatedConfigResponse = await request(app)
      .put("/api/settings/proposal-content-config/components/certifications")
      .set("Authorization", `Bearer ${configLogin.body.token}`)
      .send({
        title: "Certificaciones",
        layoutConfig: {
          mode: "manual-rows",
          rows: [{ blockIndexes: [0, 1] }, { blockIndexes: [2] }],
        },
        blocks: [
          {
            type: "image",
            assetId: assetAResponse.body.asset.id,
            assetVersionId: assetAResponse.body.asset.currentVersion.id,
          },
          {
            type: "image",
            assetId: assetBResponse.body.asset.id,
            assetVersionId: assetBResponse.body.asset.currentVersion.id,
          },
          {
            type: "image",
            assetId: assetCResponse.body.asset.id,
            assetVersionId: assetCResponse.body.asset.currentVersion.id,
          },
        ],
      });

    expect(updatedConfigResponse.status).toBe(200);

    const detailResponse = await request(app)
      .get(`/api/proposals/${createProposalResponse.body.proposal.id}`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(detailResponse.status).toBe(200);
    expect(
      detailResponse.body.components.find(
        (component) => component.componentCode === "certifications",
      ),
    ).toEqual(
      expect.objectContaining({
        layoutConfig: {
          mode: "manual-rows",
          rows: [{ blockIndexes: [0, 1] }, { blockIndexes: [2] }],
        },
        resolvedLayoutMode: "manual-rows",
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: "image",
            assetId: Number(assetAResponse.body.asset.id),
          }),
          expect.objectContaining({
            type: "image",
            assetId: Number(assetBResponse.body.asset.id),
          }),
          expect.objectContaining({
            type: "image",
            assetId: Number(assetCResponse.body.asset.id),
          }),
        ]),
      }),
    );
    expect(
      detailResponse.body.components.find(
        (component) => component.componentCode === "certifications",
      ).blocks,
    ).toHaveLength(3);
  });

  test("configuracion.proposal-content devuelve issues detalladas para layoutConfig invalido", async () => {
    const configLogin = await login(
      request(app),
      `${TEST_PREFIX}.configuration.manager@example.com`,
    );

    const response = await request(app)
      .put("/api/settings/proposal-content-config/components/certifications")
      .set("Authorization", `Bearer ${configLogin.body.token}`)
      .send({
        title: "Certificaciones",
        layoutConfig: {
          mode: "manual-rows",
          rows: [{ blockIndexes: [0] }, { blockIndexes: [2] }],
        },
        blocks: [
          {
            type: "paragraph",
            text: "Texto no compatible para galeria manual.",
          },
          {
            type: "image",
            assetId: 1,
            assetVersionId: 1,
          },
        ],
      });

    expect(response.status).toBe(400);
    expect(Array.isArray(response.body.issues)).toBe(true);
    expect(response.body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "layout_config_block_not_compatible",
          path: ["layoutConfig", "rows", 0, "blockIndexes", 0],
          location: expect.objectContaining({
            scope: "layoutConfig",
            rowIndex: 0,
            blockIndex: 0,
            blockPositionInRow: 0,
            field: "blockIndexes",
          }),
        }),
        expect.objectContaining({
          code: "layout_config_block_index_out_of_range",
          path: ["layoutConfig", "rows", 1, "blockIndexes", 0],
          location: expect.objectContaining({
            scope: "layoutConfig",
            rowIndex: 1,
            blockIndex: 2,
            blockPositionInRow: 0,
            field: "blockIndexes",
          }),
        }),
      ]),
    );
  });

  test("propuestas.components conserva la version historica de la imagen aunque el asset cambie", async () => {
    const fixture = await createQuotationFixture(
      `${TEST_PREFIX}_proposal_component_snapshot`,
    );
    const adminLogin = await login(
      request(app),
      `${TEST_PREFIX}.quotes.admin@example.com`,
    );
    const configLogin = await login(
      request(app),
      `${TEST_PREFIX}.configuration.manager@example.com`,
    );

    await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/transition`)
      .set("Authorization", `Bearer ${adminLogin.body.token}`)
      .send({ actionCode: "aprobar" });

    const imageV1 =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sotM7wAAAAASUVORK5CYII=";
    const imageV2 =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAQAAADZc7J/AAAADklEQVR42mP8z/CfBwADhgGJVM0A4QAAAABJRU5ErkJggg==";

    const assetResponse = await request(app)
      .post("/api/settings/institutional-assets")
      .set("Authorization", `Bearer ${configLogin.body.token}`)
      .send({
        name: `${TEST_PREFIX}_proposal_snapshot_asset`,
        category: "institutional",
        fileUrl: imageV1,
        fileName: "snapshot-v1.png",
        mimeType: "image/png",
        fileSizeBytes: 128,
        altText: "Version inicial",
      });

    expect(assetResponse.status).toBe(201);

    const createProposalResponse = await request(app)
      .post(`/api/quotation-versions/${fixture.latestVersionId}/proposals`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({});

    expect(createProposalResponse.status).toBe(201);
    cleanup.proposalIds.push(Number(createProposalResponse.body.proposal.id));

    const saveComponentResponse = await request(app)
      .put(
        `/api/proposals/${createProposalResponse.body.proposal.id}/components/presentation`,
      )
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({
        title: "Presentacion",
        blocks: [
          {
            type: "paragraph",
            text: "Presentacion institucional de la propuesta comercial.",
          },
          {
            type: "image",
            assetId: assetResponse.body.asset.id,
            assetVersionId: assetResponse.body.asset.currentVersion.id,
          },
        ],
      });

    expect(saveComponentResponse.status).toBe(200);

    const addVersionResponse = await request(app)
      .post(
        `/api/settings/institutional-assets/${assetResponse.body.asset.id}/versions`,
      )
      .set("Authorization", `Bearer ${configLogin.body.token}`)
      .send({
        fileUrl: imageV2,
        fileName: "snapshot-v2.png",
        mimeType: "image/png",
        fileSizeBytes: 128,
        altText: "Version nueva",
      });

    expect(addVersionResponse.status).toBe(200);

    const detailResponse = await request(app)
      .get(`/api/proposals/${createProposalResponse.body.proposal.id}`)
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(detailResponse.status).toBe(200);
    const presentationComponent = detailResponse.body.components.find(
      (component) => component.componentCode === "presentation",
    );
    const imageBlock = presentationComponent.blocks.find(
      (block) => block.type === "image",
    );
    expect(imageBlock.assetVersionId).toBe(
      Number(assetResponse.body.asset.currentVersion.id),
    );
    expect(imageBlock.image.fileUrl).toBe(imageV1);
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
                originalCurrencyCode: "USD",
                originalListPriceUnit: 100,
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
    expect(version2Response.body.sections[0].items[0]).toMatchObject({
      originalCurrencyCode: "USD",
      originalListPriceUnit: 100,
      listPriceUnit: 100,
    });

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
                originalCurrencyCode: "USD",
                originalListPriceUnit: 100,
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
                originalCurrencyCode: "USD",
                originalListPriceUnit: 50,
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
                originalCurrencyCode: "USD",
                originalListPriceUnit: 200,
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
                originalCurrencyCode: "EUR",
                originalListPriceUnit: 60,
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
      originalCurrencyCode: "USD",
      originalListPriceUnit: 200,
      listPriceUnit: 125,
      manufacturerDiscountPct: 4,
      importCostPct: 9,
      profitMarginPct: 14,
      finalDiscountPct: 1,
    });
    expect(
      persistedItems.find((item) => item.productCode === "SKU-NEW-1"),
    ).toMatchObject({
      originalCurrencyCode: "EUR",
      originalListPriceUnit: 60,
      listPriceUnit: 75,
    });

    const rawPersistedRows = await query(
      `SELECT product_code, original_currency_code, original_list_price_unit, list_price_unit
       FROM quotation_section_items
       WHERE quotation_section_id = ?
       ORDER BY display_order, id`,
      [Number(versionResponse.body.sections[0].id)],
    );

    expect(rawPersistedRows).toEqual([
      {
        product_code: "SKU-OLD-1",
        original_currency_code: "USD",
        original_list_price_unit: "200.0000",
        list_price_unit: "125.0000",
      },
      {
        product_code: "SKU-NEW-1",
        original_currency_code: "EUR",
        original_list_price_unit: "60.0000",
        list_price_unit: "75.0000",
      },
    ]);
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

  test("planeacion comercial crea T3 2026, captura metas, publica y duplica una nueva version", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.commercial.planning@example.com`,
    );
    expect(loginResponse.status).toBe(200);

    const createPeriodResponse = await request(app)
      .post("/api/commercial-planning/periods")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        year: 2029,
        quarter: 3,
        baseCurrencyCode: "USD",
        notes: "Planeacion inicial T3 2029",
      });

    expect(createPeriodResponse.status).toBe(201);
    expect(createPeriodResponse.body.period.label).toBe("T3 2029");
    expect(createPeriodResponse.body.createdVersionId).toBeGreaterThan(0);

    const versionId = Number(createPeriodResponse.body.createdVersionId);

    const saveTargetsResponse = await request(app)
      .put(`/api/commercial-planning/versions/${versionId}/targets`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        targets: [
          {
            sellerUserId: ctx.sellerUserId,
            salesQuotaAmount: 100000,
            currencyCode: "USD",
            expectedMarginPercent: 22,
            notes: "Meta inicial del trimestre",
          },
          {
            sellerUserId: ctx.sellerAltUserId,
            salesQuotaAmount: 80000,
            currencyCode: "USD",
            expectedMarginPercent: 18,
            notes: "Meta secundaria del trimestre",
          },
        ],
      });

    expect(saveTargetsResponse.status).toBe(200);
    expect(saveTargetsResponse.body.targets).toHaveLength(2);
    expect(saveTargetsResponse.body.targets[0]).toEqual(
      expect.objectContaining({
        currencyCode: "USD",
      }),
    );

    const validateResponse = await request(app)
      .post(`/api/commercial-planning/versions/${versionId}/validate`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({});

    expect(validateResponse.status).toBe(200);
    expect(validateResponse.body.errors).toEqual([]);
    expect(validateResponse.body.canPublish).toBe(true);

    const publishResponse = await request(app)
      .post(`/api/commercial-planning/versions/${versionId}/publish`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        justification:
          "Se publica aunque existan vendedores activos sin meta asignada en esta version de prueba.",
      });

    expect(publishResponse.status).toBe(200);
    expect(publishResponse.body.version.status).toBe("active");

    const createNewVersionResponse = await request(app)
      .post(
        `/api/commercial-planning/periods/${createPeriodResponse.body.period.id}/versions`,
      )
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({});

    expect(createNewVersionResponse.status).toBe(201);
    expect(createNewVersionResponse.body.version.versionNumber).toBe(2);
    expect(createNewVersionResponse.body.targets).toHaveLength(2);
    expect(
      createNewVersionResponse.body.targets.map(
        (item) => item.salesQuotaAmount,
      ),
    ).toEqual(expect.arrayContaining([100000, 80000]));
  });

  test("planeacion comercial expone auditoria aunque changed_fields llegue como objeto", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.commercial.planning@example.com`,
    );
    expect(loginResponse.status).toBe(200);

    const token = loginResponse.body.token;
    const year = 2030;
    const quarter = 2;

    const createPeriodResponse = await request(app)
      .post("/api/commercial-planning/periods")
      .set("Authorization", `Bearer ${token}`)
      .send({
        year,
        quarter,
        baseCurrencyCode: "USD",
        notes: "Planeacion de regresion para auditoria",
      });

    expect(createPeriodResponse.status).toBe(201);
    const versionId = Number(createPeriodResponse.body.createdVersionId);

    const saveTargetsResponse = await request(app)
      .put(`/api/commercial-planning/versions/${versionId}/targets`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        targets: [
          {
            sellerUserId: ctx.sellerUserId,
            salesQuotaAmount: 90000,
            currencyCode: "USD",
            expectedMarginPercent: 21,
            notes: "Meta principal de regresion",
          },
          {
            sellerUserId: ctx.sellerAltUserId,
            salesQuotaAmount: 70000,
            currencyCode: "USD",
            expectedMarginPercent: 19,
            notes: "Meta secundaria de regresion",
          },
        ],
      });

    expect(saveTargetsResponse.status).toBe(200);

    const publishResponse = await request(app)
      .post(`/api/commercial-planning/versions/${versionId}/publish`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        justification:
          "Se publica con advertencias para verificar que la auditoria soporte changed_fields serializado como objeto.",
      });

    expect(publishResponse.status).toBe(200);

    const commercialPlanningAuditResponse = await request(app)
      .get("/api/commercial-planning/audit")
      .query({ year, quarter })
      .set("Authorization", `Bearer ${token}`);

    expect(commercialPlanningAuditResponse.status).toBe(200);
    expect(commercialPlanningAuditResponse.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "created_period" }),
        expect.objectContaining({ action: "updated_targets" }),
        expect.objectContaining({ action: "published_version" }),
      ]),
    );

    const createdPeriodAuditEntry =
      commercialPlanningAuditResponse.body.entries.find(
        (entry) => entry.action === "created_period",
      );
    expect(createdPeriodAuditEntry.changedFields).toEqual(
      expect.objectContaining({
        year: expect.objectContaining({ after: year, before: null }),
        quarter: expect.objectContaining({ after: quarter, before: null }),
      }),
    );

    const targetAuditEntry = commercialPlanningAuditResponse.body.entries.find(
      (entry) => entry.action === "updated_targets",
    );
    expect(targetAuditEntry.changedFields.targets).toEqual(
      expect.objectContaining({
        before: [],
        after: expect.any(Array),
      }),
    );

    const globalAuditLoginResponse = await login(
      request(app),
      `${TEST_PREFIX}.audit.reader@example.com`,
    );
    expect(globalAuditLoginResponse.status).toBe(200);

    const globalAuditResponse = await request(app)
      .get("/api/audit")
      .query({ module: "planeacion_comercial", q: `T${quarter} ${year}` })
      .set("Authorization", `Bearer ${globalAuditLoginResponse.body.token}`);

    expect(globalAuditResponse.status).toBe(200);
    expect(globalAuditResponse.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "published_version",
          changed_fields: expect.objectContaining({
            status: expect.objectContaining({
              after: "active",
              before: "draft",
            }),
          }),
        }),
      ]),
    );
  });

  test("planeacion comercial exige justificacion cuando una version se publica con advertencias", async () => {
    const loginResponse = await login(
      request(app),
      `${TEST_PREFIX}.commercial.planning@example.com`,
    );
    expect(loginResponse.status).toBe(200);

    const createPeriodResponse = await request(app)
      .post("/api/commercial-planning/periods")
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        year: 2031,
        quarter: 1,
        baseCurrencyCode: "USD",
        notes: "Planeacion inicial T1 2031",
      });

    expect(createPeriodResponse.status).toBe(201);
    const versionId = Number(createPeriodResponse.body.createdVersionId);

    const saveTargetsResponse = await request(app)
      .put(`/api/commercial-planning/versions/${versionId}/targets`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        targets: [
          {
            sellerUserId: ctx.sellerUserId,
            salesQuotaAmount: 120000,
            currencyCode: "USD",
            expectedMarginPercent: 25,
            notes: "Se deja un vendedor sin meta para probar advertencias",
          },
        ],
      });

    expect(saveTargetsResponse.status).toBe(200);

    const validateResponse = await request(app)
      .post(`/api/commercial-planning/versions/${versionId}/validate`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({});

    expect(validateResponse.status).toBe(200);
    expect(validateResponse.body.errors).toEqual([]);
    expect(validateResponse.body.warnings.length).toBeGreaterThan(0);
    expect(validateResponse.body.requiresOverride).toBe(true);

    const publishWithoutJustification = await request(app)
      .post(`/api/commercial-planning/versions/${versionId}/publish`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({});

    expect(publishWithoutJustification.status).toBe(400);
    expect(publishWithoutJustification.body.message).toContain("justificacion");

    const publishWithJustification = await request(app)
      .post(`/api/commercial-planning/versions/${versionId}/publish`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send({
        justification:
          "Se publica con una vacante comercial abierta que aun no recibe meta formal.",
      });

    expect(publishWithJustification.status).toBe(200);
    expect(publishWithJustification.body.version.status).toBe("active");
  });
});
