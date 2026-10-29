import supertest from "supertest";
import { PDFParse } from "pdf-parse";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/ai-services/client.js", () => ({ aiFetch: vi.fn() }));
vi.mock("../src/ai-usage/service.js", async (importOriginal) => ({
  ...(await importOriginal()),
  assertAiBudgetAvailable: vi.fn(async () => undefined),
  recordAiUsageFromOpenAiResponse: vi.fn(async () => null),
}));

import { aiFetch } from "../src/ai-services/client.js";
import { app } from "../src/app.js";
import { config } from "../src/config.js";
import { pool, query } from "../src/db.js";
import { ensureCommercialPlanningSchema } from "../src/commercial-planning/schema.js";
import {
  ensureCorePermissions,
} from "../src/permissions.js";
import { ensureProposalDocumentSchema } from "../src/proposal-documents/schema.js";
import {
  TECHNICAL_PLAYBOOKS_MANAGE_PERMISSION,
  TECHNICAL_SCOPE_APPROVE_PERMISSION,
  TECHNICAL_SCOPE_UPDATE_PERMISSION,
  ensureTechnicalScopePermissions,
} from "../src/technical-scope/permissions.js";
import { ensureTechnicalScopeSchema } from "../src/technical-scope/schema.js";
import { ensureTechnicalPlaybookSeeds } from "../src/technical-scope/playbooks.js";
import { validateSingleFile, extractContentFromBuffer } from "../src/opportunity-documents/service.js";
import {
  TEST_PREFIX,
  cleanupArtifacts,
  createDirectAccount,
  createDirectContact,
  createDirectProvider,
  createRole,
  createUser,
  ensureNamedRole,
  getCatalogId,
  getFirstId,
  getPermissionIds,
  login,
} from "./helpers/apiTestUtils.js";

const api = () => supertest(app);

function binaryParser(res, callback) {
  const chunks = [];
  res.on("data", (chunk) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
  res.on("error", callback);
}

async function pdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy().catch(() => undefined);
  return String(result.text || "");
}

describe("Alcance tecnico de propuestas", () => {
  const cleanup = {
    quotationIds: [],
    opportunityIds: [],
    contactIds: [],
    accountIds: [],
    providerIds: [],
    userIds: [],
    roleIds: [],
  };
  const ctx = {};
  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  const documentsUrl = "/api/proposal-documents/v1/proposal-documents";
  const scopeUrl = (suffix = "") => `${documentsUrl}/${ctx.documentId}/technical-scope${suffix}`;
  const sowUrl = (suffix = "") => `${documentsUrl}/${ctx.documentId}/sow${suffix}`;
  const GENERIC_TEXT = "Texto generico de la solucion";

  const renderPdf = (token, documentId = ctx.documentId) =>
    api()
      .get(`${documentsUrl}/${documentId}/pdf`)
      .set(auth(token))
      .buffer(true)
      .parse(binaryParser);

  const sectionNode = (title, body, startOnNewPage = true) => ({
    type: "proposalSection",
    attrs: { startOnNewPage },
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: title }] },
      { type: "paragraph", content: [{ type: "text", text: body }] },
    ],
  });

  // Creates a proposal document from the opportunity and gives it a known body.
  async function createDocument(title) {
    const created = await api()
      .post(documentsUrl)
      .set(auth(ctx.editor.token))
      .send({ title, opportunity_id: ctx.opportunityId, template_code: "generica" });
    expect(created.status).toBe(201);
    const documentId = Number(created.body.proposal_document_id);
    ctx.documentIds.push(documentId);
    const detail = await api().get(`${documentsUrl}/${documentId}`).set(auth(ctx.editor.token));
    const content = detail.body.active_version.content;
    content.schema_version = 3;
    content.document = {
      type: "doc",
      content: [
        sectionNode("Resumen Ejecutivo", "Texto del resumen"),
        sectionNode("Descripción de la Solución", GENERIC_TEXT),
        sectionNode("Servicios", "Texto de servicios"),
      ],
    };
    const saved = await api().patch(`${documentsUrl}/${documentId}`).set(auth(ctx.editor.token)).send({ content });
    expect(saved.status).toBe(200);
    return documentId;
  }

  const jsonOf = (response) => {
    if (response.body instanceof Buffer) {
      try {
        return JSON.parse(response.body.toString("utf8"));
      } catch {
        return {};
      }
    }
    return response.body;
  };

  async function createUserWithRole(label, permissionCodes) {
    const roleId = await createRole({
      name: `${TEST_PREFIX}_ts_${label}`,
      permissionCodes,
    });
    cleanup.roleIds.push(roleId);
    const email = `${TEST_PREFIX}.ts.${label}@example.com`;
    const userId = await createUser({ fullName: `TS ${label}`, email, roleIds: [roleId] });
    cleanup.userIds.push(userId);
    const response = await login(api(), email);
    expect(response.status).toBe(200);
    return { userId, token: response.body.token, email };
  }

  beforeAll(async () => {
    const adminRole = await ensureNamedRole("Administrador");
    if (adminRole.created) cleanup.roleIds.push(adminRole.roleId);
    await ensureCorePermissions({ autoAssignRoles: true });
    await ensureCommercialPlanningSchema();
    await ensureTechnicalScopePermissions();
    await ensureProposalDocumentSchema();
    await ensureTechnicalScopeSchema();
    await ensureTechnicalPlaybookSeeds();

    const sellerRole = await ensureNamedRole("Vendedor");
    if (sellerRole.created) cleanup.roleIds.push(sellerRole.roleId);
    const [eligibility] = await getPermissionIds(["comercial.seller.eligible"]);
    await query(
      `INSERT INTO role_permissions (role_id, permission_id, created_at)
       SELECT ?, ?, NOW(3)
       WHERE NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = ? AND permission_id = ?)`,
      [sellerRole.roleId, eligibility, sellerRole.roleId, eligibility],
    );
    const sellerUserId = await createUser({
      fullName: "TS Seller",
      email: `${TEST_PREFIX}.ts.seller@example.com`,
      roleIds: [sellerRole.roleId],
    });
    cleanup.userIds.push(sellerUserId);

    ctx.documentIds = [];
    ctx.editor = await createUserWithRole("editor", [
      "cotizaciones.operacion",
      "propuestas.read",
      "propuestas.create",
      "propuestas.update",
      TECHNICAL_SCOPE_UPDATE_PERMISSION,
    ]);
    ctx.presales = await createUserWithRole("presales", ["propuestas.read"]);
    ctx.approver = await createUserWithRole("approver", [
      "propuestas.read",
      TECHNICAL_SCOPE_APPROVE_PERMISSION,
    ]);
    ctx.reader = await createUserWithRole("reader", ["propuestas.read"]);
    ctx.playbookAdmin = await createUserWithRole("playbooks", [TECHNICAL_PLAYBOOKS_MANAGE_PERMISSION]);

    const suffix = `${TEST_PREFIX}_ts`;
    const accountId = await createDirectAccount({
      ownerUserId: ctx.editor.userId,
      actorUserId: ctx.editor.userId,
      suffix,
    });
    cleanup.accountIds.push(accountId);
    for (const userId of [ctx.presales.userId, ctx.approver.userId, ctx.reader.userId]) {
      await query(
        "INSERT INTO account_owners (account_id, user_id, assigned_at, assigned_by) VALUES (?, ?, NOW(3), ?)",
        [accountId, userId, ctx.editor.userId],
      );
    }
    const contactId = await createDirectContact({ accountId, actorUserId: ctx.editor.userId, suffix });
    cleanup.contactIds.push(contactId);

    const now = new Date();
    const opportunity = await query(
      `INSERT INTO opportunities
        (name, amount_usd, account_id, close_date, contact_id, sales_stage_id, business_line_id,
         seller_user_id, presales_user_id, activation_status_id, commercial_status_id,
         created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `Proyecto WAF y Micetro ${suffix}`,
        50000,
        accountId,
        "2026-12-31",
        contactId,
        await getCatalogId("opportunity_sales_stages", "contacto_inicial"),
        await getFirstId("opportunity_business_lines"),
        sellerUserId,
        ctx.presales.userId,
        await getCatalogId("opportunity_activation_statuses", "activada"),
        await getCatalogId("opportunity_commercial_statuses", "en_proceso"),
        ctx.editor.userId,
        now,
        ctx.editor.userId,
        now,
      ],
    );
    ctx.opportunityId = Number(opportunity.insertId);
    cleanup.opportunityIds.push(ctx.opportunityId);

    const quotation = await api()
      .post(`/api/opportunities/${ctx.opportunityId}/quotations`)
      .set(auth(ctx.editor.token))
      .send({ accountId, contactId, sellerUserId, sections: [] });
    expect(quotation.status).toBe(201);
    ctx.quotationId = Number(quotation.body.quotationId);
    ctx.versionId = Number(quotation.body.latestVersionId);
    cleanup.quotationIds.push(ctx.quotationId);

    const providerId = await createDirectProvider({ actorUserId: ctx.editor.userId, suffix });
    cleanup.providerIds.push(providerId);
    const versionRows = await query(
      "SELECT activation_status_id FROM quotation_versions WHERE id = ?",
      [ctx.versionId],
    );
    const section = await query(
      `INSERT INTO quotation_sections
        (quotation_version_id, title, inclusion_type_id, activation_status_id, display_order,
         created_at, updated_at, created_by_user_id, updated_by_user_id)
       VALUES (?, 'Seguridad de aplicaciones', ?, ?, 1, NOW(3), NOW(3), ?, ?)`,
      [
        ctx.versionId,
        await getFirstId("quotation_section_inclusion_types"),
        versionRows[0].activation_status_id,
        ctx.editor.userId,
        ctx.editor.userId,
      ],
    );
    for (const [index, [code, description]] of [
      ["XC-WAAP-1", "F5 Distributed Cloud WAAP subscription"],
      ["MIC-1", "BlueCat Micetro license"],
    ].entries()) {
      await query(
        `INSERT INTO quotation_section_items
          (quotation_section_id, provider_id, product_code, product_description, item_type, quantity,
           list_price_unit, display_order, created_at, updated_at, created_by_user_id, updated_by_user_id)
         VALUES (?, ?, ?, ?, 'producto', 2, 1000, ?, NOW(3), NOW(3), ?, ?)`,
        [section.insertId, providerId, code, description, index + 1, ctx.editor.userId, ctx.editor.userId],
      );
    }
    await query("UPDATE quotation_versions SET status_id = ? WHERE id = ?", [
      await getCatalogId("quotation_statuses", "aprobada"),
      ctx.versionId,
    ]);

    ctx.documentId = await createDocument("Propuesta con alcance tecnico");
  });

  beforeEach(() => {
    aiFetch.mockReset();
    aiFetch.mockRejectedValue(new Error("IA deshabilitada en pruebas"));
  });

  afterAll(async () => {
    try {
      if (ctx.documentIds?.length) {
        await query(
          `DELETE FROM proposal_documents WHERE id IN (${ctx.documentIds.map(() => "?").join(", ")})`,
          ctx.documentIds,
        );
      }
      await cleanupArtifacts(cleanup);
    } finally {
      await pool.end();
    }
  });

  test("una propuesta basica, sin alcance tecnico, se imprime y finaliza sin aprobacion", async () => {
    const response = await renderPdf(ctx.editor.token);
    expect(response.status).toBe(200);
    expect(response.body.subarray(0, 4).toString("utf8")).toBe("%PDF");
    expect(await pdfText(response.body)).toContain(GENERIC_TEXT);

    const basicId = await createDocument("Propuesta basica");
    const gate = await api().get(`${documentsUrl}/${basicId}/technical-scope/gate`).set(auth(ctx.editor.token));
    expect(gate.status).toBe(200);
    expect(gate.body).toEqual(expect.objectContaining({ applies: false, allowed: true }));
    const published = await api().post(`${documentsUrl}/${basicId}/publish`).set(auth(ctx.editor.token)).send({});
    expect(published.status).toBe(200);
  });

  test("detecta las soluciones desde las partidas y solo edita quien tiene permiso", async () => {
    const overview = await api().get(scopeUrl()).set(auth(ctx.editor.token));
    expect(overview.status).toBe(200);
    expect(overview.body.scope).toBeNull();
    expect(overview.body.suggestedPlaybooks.map((entry) => entry.code).sort()).toEqual([
      "bluecat_micetro",
      "f5_dcs",
    ]);
    expect(overview.body.capabilities).toEqual(
      expect.objectContaining({ canEdit: true, canApprove: false }),
    );
    expect(overview.body.quotationItems.map((item) => item.productCode)).toEqual(["XC-WAAP-1", "MIC-1"]);
    expect(JSON.stringify(overview.body)).not.toMatch(/list_price|salePrice|1000/);

    const readerOverview = await api().get(scopeUrl()).set(auth(ctx.reader.token));
    expect(readerOverview.status).toBe(200);
    expect(readerOverview.body.capabilities.canEdit).toBe(false);

    const denied = await api().post(scopeUrl()).set(auth(ctx.reader.token)).send({});
    expect(denied.status).toBe(403);

    const presalesOverview = await api().get(scopeUrl()).set(auth(ctx.presales.token));
    expect(presalesOverview.body.capabilities).toEqual(
      expect.objectContaining({ canEdit: true, canApprove: true, isPresales: true }),
    );
  });

  test("al iniciar el alcance, imprimir exige aprobacion", async () => {
    const created = await api().post(scopeUrl()).set(auth(ctx.editor.token)).send({});
    expect(created.status).toBe(201);
    expect(created.body.scope.status).toBe("draft");
    expect(created.body.scope.playbookCodes.map((entry) => entry.code).sort()).toEqual([
      "bluecat_micetro",
      "f5_dcs",
    ]);

    const blocked = await renderPdf(ctx.editor.token);
    expect(blocked.status).toBe(409);
    expect(jsonOf(blocked).reason).toBe("not_approved");

    const email = await api()
      .post(`${documentsUrl}/${ctx.documentId}/send-email`)
      .set(auth(ctx.editor.token))
      .send({ to: "cliente@example.com", subject: "Propuesta", message_body: "Adjunto la propuesta" });
    expect(email.status).toBe(409);
    expect(email.body.reason).toBe("not_approved");

    const publish = await api().post(`${documentsUrl}/${ctx.documentId}/publish`).set(auth(ctx.editor.token)).send({});
    expect(publish.status).toBe(409);
    expect(publish.body.reason).toBe("not_approved");

    const gate = await api().get(scopeUrl("/gate")).set(auth(ctx.editor.token));
    expect(gate.body).toEqual(expect.objectContaining({ applies: true, allowed: false, reason: "not_approved" }));

    const otherDocument = await createDocument("Otra propuesta basica");
    expect((await renderPdf(ctx.editor.token, otherDocument)).status).toBe(200);
  });

  test("valida respuestas, genera el alcance y arma el borrador desde la cotizacion", async () => {
    const invalid = await api()
      .put(scopeUrl("/answers"))
      .set(auth(ctx.editor.token))
      .send({ answers: [{ playbookCode: "f5_dcs", questionCode: "apps_count", value: "muchas" }] });
    expect(invalid.status).toBe(400);

    const unknown = await api()
      .put(scopeUrl("/answers"))
      .set(auth(ctx.editor.token))
      .send({ answers: [{ playbookCode: "f5_dcs", questionCode: "no_existe", value: 1 }] });
    expect(unknown.status).toBe(400);

    const saved = await api()
      .put(scopeUrl("/answers"))
      .set(auth(ctx.editor.token))
      .send({
        answers: [
          { playbookCode: "f5_dcs", questionCode: "apps_count", value: 12 },
          { playbookCode: "f5_dcs", questionCode: "app_locations", value: ["AWS", "Centro de datos propio"] },
          { playbookCode: "f5_dcs", questionCode: "dns_control", value: true },
          { playbookCode: "bluecat_micetro", questionCode: "zones_count", value: 40 },
        ],
      });
    expect(saved.status).toBe(200);
    const apps = saved.body.questions.find((q) => q.playbookCode === "f5_dcs" && q.code === "apps_count");
    expect(apps.answer).toEqual(expect.objectContaining({ value: 12, status: "confirmed", sourceType: "manual" }));
    expect(saved.body.coverage.confirmed).toBe(4);
    expect(saved.body.coverage.requiredMissing.length).toBeGreaterThan(0);

    const generated = await api()
      .post(scopeUrl("/generate"))
      .set(auth(ctx.editor.token))
      .send({ useAi: false });
    expect(generated.status).toBe(200);
    const { scope } = generated.body.overview;
    expect(scope.sections).toHaveLength(12);
    const solution = scope.sections.find((section) => section.code === "proposed_solution");
    expect(solution.itemRefs).toEqual(["XC-WAAP-1", "MIC-1"]);
    expect(JSON.stringify(scope.sections)).toContain("aplicaciones o dominios (FQDN)");
    expect(JSON.stringify(scope.sections)).not.toMatch(/1000|precio/i);
    expect(scope.status).toBe("draft");
    expect(scope.contentHash).toHaveLength(64);
    expect(generated.body.overview.verification.blocking).toBe(0);
  });

  test("las sugerencias automaticas no pisan una respuesta confirmada", async () => {
    const { saveSuggestedAnswer } = await import("../src/technical-scope/profile.js");
    const selected = await api()
      .put(scopeUrl("/selections"))
      .set(auth(ctx.editor.token))
      .send({
        selections: [
          { code: "f5_dcs", modules: ["waap", "multicloud_connect"] },
          { code: "bluecat_micetro", modules: ["micetro"] },
        ],
      });
    expect(selected.status).toBe(200);
    expect(selected.body.questions.some((q) => q.code === "ce_sites")).toBe(true);
    const question = { code: "apps_count", type: "number", options: [] };
    const conflict = await saveSuggestedAnswer({
      opportunityId: ctx.opportunityId,
      playbookCode: "f5_dcs",
      question,
      value: 99,
      sourceType: "document",
      sourceRef: "nginx.conf",
    });
    expect(conflict.stored).toBe(false);
    expect(conflict.conflict).toEqual(expect.objectContaining({ current: 12, suggested: 99 }));

    const sitesQuestion = { code: "ce_sites", type: "number", options: [] };
    const stored = await saveSuggestedAnswer({
      opportunityId: ctx.opportunityId,
      playbookCode: "f5_dcs",
      question: sitesQuestion,
      value: 3,
      sourceType: "ai",
      confidence: 0.7,
    });
    expect(stored.stored).toBe(true);
    const lower = await saveSuggestedAnswer({
      opportunityId: ctx.opportunityId,
      playbookCode: "f5_dcs",
      question: sitesQuestion,
      value: 4,
      sourceType: "ai",
    });
    expect(lower.stored).toBe(true);
    const better = await saveSuggestedAnswer({
      opportunityId: ctx.opportunityId,
      playbookCode: "f5_dcs",
      question: sitesQuestion,
      value: 5,
      sourceType: "document",
      sourceRef: "diagrama.drawio",
    });
    expect(better.stored).toBe(true);
    const worse = await saveSuggestedAnswer({
      opportunityId: ctx.opportunityId,
      playbookCode: "f5_dcs",
      question: sitesQuestion,
      value: 6,
      sourceType: "ai",
    });
    expect(worse.reason).toBe("lower_priority");

    const overview = await api().get(scopeUrl()).set(auth(ctx.editor.token));
    const sites = overview.body.questions.find((q) => q.code === "ce_sites");
    expect(sites.answer).toEqual(expect.objectContaining({ value: 5, status: "suggested", sourceType: "document" }));
    expect(overview.body.coverage.suggestedPending).toBe(1);

    const confirmed = await api()
      .post(scopeUrl("/answers/confirm"))
      .set(auth(ctx.editor.token))
      .send({ playbookCode: "f5_dcs" });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.questions.find((q) => q.code === "ce_sites").answer.status).toBe("confirmed");
  });

  test("personaliza con IA, protege las ediciones manuales y conserva el borrador si la IA falla", async () => {
    const previousKey = config.openai.apiKey;
    config.openai.apiKey = "test-key";
    try {
      aiFetch.mockImplementation(async (_feature, _path, { body }) => {
        const request = JSON.parse(body);
        const userContent = JSON.parse(request.input[1].content);
        const code = userContent.section?.code;
        const blocks = code === "requirements"
          ? [{ type: "paragraph", text: "Requerimiento personalizado por IA" }]
          : [];
        return {
          ok: true,
          json: async () => ({
            output: [{ content: [{ type: "output_text", text: JSON.stringify({ blocks, itemRefs: [], sources: [{ kind: "answer", ref: "f5_dcs:apps_count", label: "Apps" }], warnings: [] }) }] }],
            usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
          }),
          text: async () => "",
        };
      });

      const edited = await api()
        .put(scopeUrl("/sections/risks"))
        .set(auth(ctx.editor.token))
        .send({ blocks: [{ type: "list", items: ["Riesgo editado manualmente"] }] });
      expect(edited.status).toBe(200);
      expect(edited.body.scope.sections.find((s) => s.code === "risks").edited).toBe(true);

      const generated = await api().post(scopeUrl("/generate")).set(auth(ctx.editor.token)).send({});
      expect(generated.status).toBe(200);
      expect(generated.body.warnings.filter((warning) => /No fue posible/.test(warning))).toEqual([]);
      expect(generated.body.usedAi).toBe(true);
      const sections = generated.body.overview.scope.sections;
      expect(JSON.stringify(sections.find((s) => s.code === "requirements"))).toContain("Requerimiento personalizado por IA");
      expect(JSON.stringify(sections.find((s) => s.code === "risks"))).toContain("Riesgo editado manualmente");
      expect(JSON.stringify(sections.find((s) => s.code === "scope_included"))).toContain("Levantamiento");
      expect(generated.body.warnings.join(" ")).toContain("secciones editadas manualmente");
      expect(aiFetch).toHaveBeenCalled();

      aiFetch.mockReset();
      aiFetch.mockRejectedValue(new Error("sin servicio"));
      const fallback = await api()
        .post(scopeUrl("/generate"))
        .set(auth(ctx.editor.token))
        .send({ codes: ["requirements"] });
      expect(fallback.status).toBe(200);
      expect(fallback.body.usedAi).toBe(false);
      expect(JSON.stringify(fallback.body.overview.scope.sections.find((s) => s.code === "requirements"))).not.toContain("personalizado por IA");
      expect(fallback.body.warnings.join(" ")).toContain("se conservo el borrador base");
    } finally {
      config.openai.apiKey = previousKey;
    }
  });

  test("el flujo de aprobacion exige revision, lista de verificacion y rol autorizado", async () => {
    const early = await api().post(scopeUrl("/approve")).set(auth(ctx.presales.token)).send({ checklist: {} });
    expect(early.status).toBe(409);

    const notSubmitted = await api().post(scopeUrl("/submit")).set(auth(ctx.reader.token)).send({});
    expect(notSubmitted.status).toBe(403);

    const submitted = await api().post(scopeUrl("/submit")).set(auth(ctx.editor.token)).send({});
    expect(submitted.status).toBe(200);
    expect(submitted.body.scope.status).toBe("in_review");

    const stillBlocked = await renderPdf(ctx.editor.token);
    expect(stillBlocked.status).toBe(409);

    const unauthorized = await api()
      .post(scopeUrl("/approve"))
      .set(auth(ctx.editor.token))
      .send({ checklist: { assumptionsReviewed: true, findingsResolved: true } });
    expect(unauthorized.status).toBe(403);

    const incomplete = await api()
      .post(scopeUrl("/approve"))
      .set(auth(ctx.presales.token))
      .send({ checklist: { assumptionsReviewed: true } });
    expect(incomplete.status).toBe(400);
    expect(incomplete.body.missingChecklist).toEqual(["findingsResolved"]);

    const approved = await api()
      .post(scopeUrl("/approve"))
      .set(auth(ctx.presales.token))
      .send({ checklist: { assumptionsReviewed: true, findingsResolved: true }, comment: "Revisado" });
    expect(approved.status).toBe(200);
    expect(approved.body.selfApproved).toBe(false);
    expect(approved.body.overview.scope).toEqual(
      expect.objectContaining({ status: "approved", printable: true, approvedByUserId: ctx.presales.userId }),
    );
    expect(approved.body.overview.scope.approvedHash).toBe(approved.body.overview.scope.contentHash);
  });

  test("con el alcance aprobado el PDF sustituye la descripcion generica por el alcance aprobado", async () => {
    const response = await renderPdf(ctx.editor.token);
    expect(response.status).toBe(200);
    const text = await pdfText(response.body);
    expect(text).toContain("Alcance incluido");
    expect(text).toContain("Exclusiones");
    expect(text).toContain("Texto del resumen");
    expect(text).toContain("Texto de servicios");
    expect(text).not.toContain(GENERIC_TEXT);

    const gate = await api().get(scopeUrl("/gate")).set(auth(ctx.editor.token));
    expect(gate.body).toEqual(expect.objectContaining({ applies: true, allowed: true }));
  });

  test("cualquier cambio posterior invalida la aprobacion y vuelve a bloquear", async () => {
    const edited = await api()
      .put(scopeUrl("/sections/scope_excluded"))
      .set(auth(ctx.editor.token))
      .send({ blocks: [{ type: "list", items: ["Nueva exclusion"] }] });
    expect(edited.status).toBe(200);
    expect(edited.body.scope.status).toBe("draft");
    expect(edited.body.scope.approvedHash).toBeNull();

    const blocked = await renderPdf(ctx.editor.token);
    expect(blocked.status).toBe(409);
    expect(jsonOf(blocked).reason).toBe("not_approved");
  });

  test("las secciones se editan con el editor enriquecido: se sanea el contenido y se derivan los bloques", async () => {
    const content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Exclusion con ", marks: [{ type: "bold" }] }, { type: "text", text: "formato" }] },
        { type: "image", attrs: { src: "data:image/png;base64,AAAA" } },
        {
          type: "table",
          content: [
            { type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Fase" }] }] }] },
            { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Diseno" }] }] }] },
          ],
        },
      ],
    };
    const edited = await api().put(scopeUrl("/sections/scope_excluded")).set(auth(ctx.editor.token)).send({ content });
    expect(edited.status).toBe(200);
    const section = edited.body.scope.sections.find((entry) => entry.code === "scope_excluded");
    expect(section.edited).toBe(true);
    expect(JSON.stringify(section.content)).toContain('"bold"');
    expect(JSON.stringify(section.content)).not.toMatch(/image|AAAA/);
    expect(section.blocks.map((block) => block.type)).toEqual(["paragraph", "table"]);
    expect(section.blocks[0].text).toBe("Exclusion con formato");
    expect(edited.body.scope.status).toBe("draft");

    const empty = await api().put(scopeUrl("/sections/scope_excluded")).set(auth(ctx.editor.token)).send({});
    expect(empty.status).toBe(400);

    const withBlocks = await api()
      .put(scopeUrl("/sections/scope_excluded"))
      .set(auth(ctx.editor.token))
      .send({ blocks: [{ type: "list", items: ["Nueva exclusion"] }] });
    const rebuilt = withBlocks.body.scope.sections.find((entry) => entry.code === "scope_excluded");
    expect(rebuilt.content.content[0].type).toBe("bulletList");
  });

  test("autoaprobar es posible, queda registrado y la manipulacion directa del contenido se detecta", async () => {
    const submitted = await api().post(scopeUrl("/submit")).set(auth(ctx.presales.token)).send({});
    expect(submitted.status).toBe(200);
    const approved = await api()
      .post(scopeUrl("/approve"))
      .set(auth(ctx.presales.token))
      .send({ checklist: { assumptionsReviewed: true, findingsResolved: true } });
    expect(approved.status).toBe(200);
    expect(approved.body.selfApproved).toBe(true);
    expect((await renderPdf(ctx.editor.token)).status).toBe(200);

    const events = await query(
      `SELECT e.event_code FROM proposal_technical_scope_events e
       INNER JOIN proposal_technical_scopes s ON s.id = e.scope_id
       WHERE s.proposal_document_id = ? ORDER BY e.id`,
      [ctx.documentId],
    );
    expect(events.map((row) => row.event_code)).toEqual(
      expect.arrayContaining(["created", "generated", "submitted", "approved", "approval_invalidated"]),
    );

    await query(
      `UPDATE proposal_technical_scopes
       SET sections_json = REPLACE(sections_json, 'Nueva exclusion', 'Exclusion alterada en la base')
       WHERE proposal_document_id = ?`,
      [ctx.documentId],
    );
    const tampered = await renderPdf(ctx.editor.token);
    expect(tampered.status).toBe(409);
    expect(jsonOf(tampered).reason).toBe("modified");

    await query(
      `UPDATE proposal_technical_scopes
       SET sections_json = REPLACE(sections_json, 'Exclusion alterada en la base', 'Nueva exclusion')
       WHERE proposal_document_id = ?`,
      [ctx.documentId],
    );
    expect((await renderPdf(ctx.editor.token)).status).toBe(200);
  });

  test("un cambio de version de cotizacion invalida la aprobacion", async () => {
    const [{ id: otherVersionId }] = [
      { id: Number((await query(
        `INSERT INTO quotation_versions
          (quotation_id, version_number, contact_id, proposal_name, quotation_date, status_id, activation_status_id,
           created_at, updated_at, created_by_user_id, updated_by_user_id)
         SELECT quotation_id, 2, contact_id, proposal_name, quotation_date, status_id, activation_status_id,
                NOW(3), NOW(3), created_by_user_id, updated_by_user_id
         FROM quotation_versions WHERE id = ?`,
        [ctx.versionId],
      )).insertId) },
    ];
    const setDocumentQuotationVersion = async (versionId) => {
      const detail = await api().get(`${documentsUrl}/${ctx.documentId}`).set(auth(ctx.editor.token));
      const content = detail.body.active_version.content;
      content.metadata.quotation_version_id = versionId;
      const saved = await api().patch(`${documentsUrl}/${ctx.documentId}`).set(auth(ctx.editor.token)).send({ content });
      expect(saved.status).toBe(200);
    };
    await setDocumentQuotationVersion(otherVersionId);
    try {
      const blocked = await renderPdf(ctx.editor.token);
      expect(blocked.status).toBe(409);
      expect(jsonOf(blocked).reason).toBe("quotation_changed");

      const overview = await api().get(scopeUrl()).set(auth(ctx.editor.token));
      expect(overview.body.stale.quotationChanged).toBe(true);
      expect(overview.body.scope.printable).toBe(false);
    } finally {
      await setDocumentQuotationVersion(ctx.versionId);
      await query("DELETE FROM quotation_versions WHERE id = ?", [otherVersionId]);
    }
    expect((await renderPdf(ctx.editor.token)).status).toBe(200);
  });

  test("el SOW se deriva del alcance, lo aprueba el preventa y se bloquea si el alcance cambia", async () => {
    const generated = await api().post(sowUrl("/generate")).set(auth(ctx.editor.token)).send({ useAi: false });
    expect(generated.status).toBe(200);
    const { sow } = generated.body;
    expect(sow.sections.map((section) => section.code)).toContain("sow_roles");
    expect(sow.status).toBe("draft");
    expect(sow.stale).toBe(false);
    expect(sow.scopeApproved).toBe(true);

    const early = await api().post(sowUrl("/pdf")).set(auth(ctx.editor.token)).buffer(true).parse(binaryParser).send({});
    expect(early.status).toBe(409);
    const attachEarly = await api()
      .post(`${documentsUrl}/${ctx.documentId}/send-email`)
      .set(auth(ctx.editor.token))
      .send({ to: "cliente@example.com", subject: "Propuesta", message_body: "Adjunto", attach_sow: true });
    expect(attachEarly.status).toBe(409);
    expect(attachEarly.body.reason).toBe("sow_not_approved");

    await api().post(sowUrl("/submit")).set(auth(ctx.editor.token)).send({});
    const unauthorized = await api()
      .post(sowUrl("/approve"))
      .set(auth(ctx.editor.token))
      .send({ checklist: { contentReviewed: true } });
    expect(unauthorized.status).toBe(403);
    const missing = await api().post(sowUrl("/approve")).set(auth(ctx.presales.token)).send({ checklist: {} });
    expect(missing.status).toBe(400);

    const approved = await api()
      .post(sowUrl("/approve"))
      .set(auth(ctx.presales.token))
      .send({ checklist: { contentReviewed: true } });
    expect(approved.status).toBe(200);
    expect(approved.body.sow.printable).toBe(true);
    const gateWithSow = await api().get(scopeUrl("/gate")).set(auth(ctx.editor.token));
    expect(gateWithSow.body.sowPrintable).toBe(true);

    const pdf = await api().post(sowUrl("/pdf")).set(auth(ctx.editor.token)).buffer(true).parse(binaryParser).send({});
    expect(pdf.status).toBe(200);
    const text = await pdfText(pdf.body);
    expect(text).toContain("Roles y responsabilidades");
    expect(text).toContain("Gestión de cambios");
    expect(text).not.toMatch(/Precio|Subtotal/);

    await api()
      .put(sowUrl("/sections/sow_change_control"))
      .set(auth(ctx.editor.token))
      .send({ blocks: [{ type: "paragraph", text: "Texto contractual modificado" }] });
    const blocked = await api().post(sowUrl("/pdf")).set(auth(ctx.editor.token)).buffer(true).parse(binaryParser).send({});
    expect(blocked.status).toBe(409);

    await api().post(sowUrl("/submit")).set(auth(ctx.editor.token)).send({});
    await api().post(sowUrl("/approve")).set(auth(ctx.presales.token)).send({ checklist: { contentReviewed: true } });
    expect((await api().post(sowUrl("/pdf")).set(auth(ctx.editor.token)).buffer(true).parse(binaryParser).send({})).status).toBe(200);

    await api().post(scopeUrl("/return-to-draft")).set(auth(ctx.presales.token)).send({ reason: "Cambio de alcance" });
    const staleSow = await api().get(sowUrl()).set(auth(ctx.editor.token));
    expect(staleSow.body.sow.scopeApproved).toBe(false);
    expect(staleSow.body.sow.printable).toBe(false);
    const stalePdf = await api().post(sowUrl("/pdf")).set(auth(ctx.editor.token)).buffer(true).parse(binaryParser).send({});
    expect(stalePdf.status).toBe(409);
  });

  test("la topologia se guarda, se incluye en el hash y se dibuja en el PDF", async () => {
    const proposed = await api().post(scopeUrl("/topology/propose")).set(auth(ctx.editor.token)).send({ useAi: false });
    expect(proposed.status).toBe(200);
    expect(proposed.body.topology.nodes.length).toBeGreaterThan(3);
    const linked = proposed.body.topology.nodes.filter((node) => node.itemRef);
    expect(linked.map((node) => node.itemRef)).toEqual(expect.arrayContaining(["MIC-1"]));
    expect(proposed.body.topology.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);

    const hashBefore = (await api().get(scopeUrl()).set(auth(ctx.editor.token))).body.scope.contentHash;
    const nodes = proposed.body.topology.nodes.map((node, index) => (index === 0 ? { ...node, locked: true, label: "Usuarios finales" } : node));
    const saved = await api()
      .put(scopeUrl("/topology"))
      .set(auth(ctx.editor.token))
      .send({ topology: { ...proposed.body.topology, nodes }, kind: "proposed" });
    expect(saved.status).toBe(200);
    expect(saved.body.scope.contentHash).not.toBe(hashBefore);
    expect(saved.body.scope.status).toBe("draft");

    const regenerated = await api().post(scopeUrl("/topology/propose")).set(auth(ctx.editor.token)).send({ useAi: false });
    expect(regenerated.body.topology.nodes.some((node) => node.label === "Usuarios finales" && node.locked)).toBe(true);

    await api().post(scopeUrl("/submit")).set(auth(ctx.editor.token)).send({});
    const missingTopologyCheck = await api()
      .post(scopeUrl("/approve"))
      .set(auth(ctx.approver.token))
      .send({ checklist: { assumptionsReviewed: true, findingsResolved: true } });
    expect(missingTopologyCheck.status).toBe(400);
    expect(missingTopologyCheck.body.missingChecklist).toEqual(["topologyReviewed"]);
    const approved = await api()
      .post(scopeUrl("/approve"))
      .set(auth(ctx.approver.token))
      .send({ checklist: { assumptionsReviewed: true, findingsResolved: true, topologyReviewed: true } });
    expect(approved.status).toBe(200);

    const response = await renderPdf(ctx.editor.token);
    expect(response.status).toBe(200);
    expect(response.body.length).toBeGreaterThan(5000);
  });

  test("descartar el alcance devuelve la propuesta al flujo normal", async () => {
    const denied = await api().delete(scopeUrl()).set(auth(ctx.reader.token));
    expect(denied.status).toBe(403);
    const discarded = await api().delete(scopeUrl()).set(auth(ctx.editor.token));
    expect(discarded.status).toBe(200);
    expect((await renderPdf(ctx.editor.token)).status).toBe(200);
    const overview = await api().get(scopeUrl()).set(auth(ctx.editor.token));
    expect(overview.body.scope).toBeNull();
    const answers = await query(
      "SELECT COUNT(*) AS total FROM opportunity_technical_answers WHERE opportunity_id = ?",
      [ctx.opportunityId],
    );
    expect(Number(answers[0].total)).toBeGreaterThan(0);
  });

  test("una propuesta sin cotizacion tambien puede llevar alcance tecnico", async () => {
    const documentId = await createDocument("Propuesta sin cotizacion");
    const detail = await api().get(`${documentsUrl}/${documentId}`).set(auth(ctx.editor.token));
    const content = detail.body.active_version.content;
    content.metadata.quotation_id = null;
    content.metadata.quotation_version_id = null;
    expect((await api().patch(`${documentsUrl}/${documentId}`).set(auth(ctx.editor.token)).send({ content })).status).toBe(200);

    const url = (suffix = "") => `${documentsUrl}/${documentId}/technical-scope${suffix}`;
    const started = await api()
      .post(url())
      .set(auth(ctx.editor.token))
      .send({ selections: [{ code: "f5_dcs", modules: ["waap"] }] });
    expect(started.status).toBe(201);
    expect(started.body.quotationItems).toEqual([]);
    expect((await renderPdf(ctx.editor.token, documentId)).status).toBe(409);

    const generated = await api().post(url("/generate")).set(auth(ctx.editor.token)).send({ useAi: false });
    expect(generated.status).toBe(200);
    expect(generated.body.warnings.join(" ")).toContain("no tiene partidas de cotizacion");
    expect((await api().post(url("/submit")).set(auth(ctx.editor.token)).send({})).status).toBe(200);
    const approved = await api()
      .post(url("/approve"))
      .set(auth(ctx.presales.token))
      .send({ checklist: { assumptionsReviewed: true, findingsResolved: true } });
    expect(approved.status).toBe(200);
    const pdf = await renderPdf(ctx.editor.token, documentId);
    expect(pdf.status).toBe(200);
    expect(await pdfText(pdf.body)).not.toContain(GENERIC_TEXT);
  });

  test("administracion de playbooks: permisos, validacion, versiones y diagnostico", async () => {
    expect((await api().get("/api/technical-playbooks").set(auth(ctx.reader.token))).status).toBe(403);

    const list = await api().get("/api/technical-playbooks").set(auth(ctx.playbookAdmin.token));
    expect(list.status).toBe(200);
    expect(list.body.playbooks.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["f5_dcs", "f5_nginx", "bluecat_micetro", "bluecat_edge", "bluecat_integrity", "bluecat_observability"]),
    );
    expect(list.body.playbooks.every((entry) => ["borrador_ia", "validado"].includes(entry.status))).toBe(true);

    const detail = await api().get("/api/technical-playbooks/f5_nginx").set(auth(ctx.playbookAdmin.token));
    expect(detail.status).toBe(200);
    expect(detail.body.playbook.content.questions.length).toBeGreaterThan(5);

    const invalid = await api()
      .put("/api/technical-playbooks/f5_nginx")
      .set(auth(ctx.playbookAdmin.token))
      .send({ content: { questions: [{ code: "q", prompt: "Pregunta", type: "choice" }] } });
    expect(invalid.status).toBe(400);

    const content = detail.body.playbook.content;
    const previousVersion = detail.body.playbook.currentVersionNumber;
    content.summary = "Resumen ajustado";
    const saved = await api()
      .put("/api/technical-playbooks/f5_nginx")
      .set(auth(ctx.playbookAdmin.token))
      .send({ content, status: "validado", notes: "Validado en prueba" });
    expect(saved.status).toBe(200);
    expect(saved.body.playbook.status).toBe("validado");
    expect(saved.body.playbook.currentVersionNumber).toBe(previousVersion + 1);
    const versions = await api().get("/api/technical-playbooks/f5_nginx").set(auth(ctx.playbookAdmin.token));
    expect(versions.body.versions[0].versionNumber).toBe(previousVersion + 1);
    expect(versions.body.versions.at(-1).versionNumber).toBe(1);

    const noDocuments = await api()
      .post("/api/technical-playbooks/f5_nginx/generate-draft")
      .set(auth(ctx.playbookAdmin.token))
      .send({});
    expect([409, 503]).toContain(noDocuments.status);

    const diagnostic = await api().get("/api/technical-playbooks/diagnostic").set(auth(ctx.playbookAdmin.token));
    expect(diagnostic.status).toBe(200);
    const f5 = diagnostic.body.diagnostic.find((entry) => entry.playbookCode === "f5_dcs");
    expect(f5.opportunities).toBeGreaterThanOrEqual(1);
    expect(f5.byCommercialStatus.en_proceso).toBeGreaterThanOrEqual(1);
    expect(f5.quotations).toBeGreaterThanOrEqual(1);

    await query(
      `UPDATE tech_playbooks SET status = 'borrador_ia', current_version_id = (
         SELECT id FROM tech_playbook_versions v WHERE v.playbook_id = tech_playbooks.id AND v.version_number = 1
       ) WHERE code = 'f5_nginx'`,
    );
    await query(
      `DELETE v FROM tech_playbook_versions v
       INNER JOIN tech_playbooks p ON p.id = v.playbook_id
       WHERE p.code = 'f5_nginx' AND v.version_number > 1`,
    );
  });

  test("el tema RAG del playbook se elige de los temas existentes y un borrador sin uso se edita en sitio", async () => {
    const admin = ctx.playbookAdmin.token;
    expect((await api().get("/api/technical-playbooks/rag-topics").set(auth(ctx.reader.token))).status).toBe(403);
    const listed = await api().get("/api/technical-playbooks/rag-topics").set(auth(admin));
    expect(listed.status).toBe(200);
    expect(listed.body.topics.some((topic) => topic.name === "Tema de prueba playbooks")).toBe(false);

    const rejected = await api()
      .patch("/api/technical-playbooks/bluecat_edge")
      .set(auth(admin))
      .send({ ragTopicName: "Tema de prueba playbooks" });
    expect(rejected.status).toBe(400);

    await query(
      `INSERT INTO documentacion_rag_topics (public_id, name, description) VALUES ('tema-prueba-playbooks', 'Tema de prueba playbooks', '')`,
    );
    try {
      const accepted = await api()
        .patch("/api/technical-playbooks/bluecat_edge")
        .set(auth(admin))
        .send({ ragTopicName: "tema de PRUEBA playbooks" });
      expect(accepted.status).toBe(200);
      expect(accepted.body.playbook.ragTopicName).toBe("Tema de prueba playbooks");

      const detail = await api().get("/api/technical-playbooks/bluecat_edge").set(auth(admin));
      expect(detail.body.currentVersionInUse).toBe(false);
      const version = detail.body.playbook.currentVersionNumber;
      const content = detail.body.playbook.content;
      content.summary = "Ajuste en sitio";

      const inPlace = await api()
        .put("/api/technical-playbooks/bluecat_edge")
        .set(auth(admin))
        .send({ content, status: "borrador_ia", overwriteCurrent: true });
      expect(inPlace.status).toBe(200);
      expect(inPlace.body.overwritten).toBe(true);
      expect(inPlace.body.playbook.currentVersionNumber).toBe(version);
      expect(inPlace.body.playbook.content.summary).toBe("Ajuste en sitio");

      // Validating always creates a new version, even when overwriting was requested.
      const validated = await api()
        .put("/api/technical-playbooks/bluecat_edge")
        .set(auth(admin))
        .send({ content, status: "validado", overwriteCurrent: true });
      expect(validated.body.overwritten).toBe(false);
      expect(validated.body.playbook.currentVersionNumber).toBe(version + 1);

      // A validated version is never edited in place.
      const afterValidated = await api()
        .put("/api/technical-playbooks/bluecat_edge")
        .set(auth(admin))
        .send({ content, status: "validado", overwriteCurrent: true });
      expect(afterValidated.body.overwritten).toBe(false);

      await query(
        `UPDATE tech_playbooks SET status = 'borrador_ia' WHERE code = 'bluecat_edge'`,
      );
      const started = await api()
        .post(scopeUrl())
        .set(auth(ctx.editor.token))
        .send({ selections: [{ code: "bluecat_edge", modules: [] }] });
      expect(started.status).toBe(201);
      const used = await api().get("/api/technical-playbooks/bluecat_edge").set(auth(admin));
      expect(used.body.currentVersionInUse).toBe(true);
      const blocked = await api()
        .put("/api/technical-playbooks/bluecat_edge")
        .set(auth(admin))
        .send({ content, status: "borrador_ia", overwriteCurrent: true });
      expect(blocked.body.overwritten).toBe(false);
      expect(blocked.body.playbook.currentVersionNumber).toBe(used.body.playbook.currentVersionNumber + 1);
      expect((await api().delete(scopeUrl()).set(auth(ctx.editor.token))).status).toBe(200);
    } finally {
      await query(
        `UPDATE tech_playbooks SET status = 'borrador_ia', rag_topic_name = 'BlueCat', current_version_id = (
           SELECT id FROM tech_playbook_versions v WHERE v.playbook_id = tech_playbooks.id AND v.version_number = 1
         ) WHERE code = 'bluecat_edge'`,
      );
      await query(
        `DELETE v FROM tech_playbook_versions v
         INNER JOIN tech_playbooks p ON p.id = v.playbook_id
         WHERE p.code = 'bluecat_edge' AND v.version_number > 1`,
      );
      await query(`DELETE FROM documentacion_rag_topics WHERE public_id = 'tema-prueba-playbooks'`);
    }
  });

  test("los archivos tecnicos del cliente se aceptan solo en oportunidades y se extraen sin secretos", async () => {
    const file = { originalFilename: "nginx.conf", mimetype: "text/plain", size: 500 };
    expect(validateSingleFile(file).kind).toBe("config");
    expect(validateSingleFile({ ...file, originalFilename: "red.drawio", mimetype: "application/vnd.jgraph.mxfile" }).kind).toBe("diagram");
    expect(() => validateSingleFile(file, { includeLegacyFormats: false })).toThrow();

    const extracted = await extractContentFromBuffer({
      buffer: Buffer.from('server { server_name app.cliente.com; }\npassword: "hunter2"\nsnmp-server community secreta RO'),
      mimeType: "text/plain",
      fileName: "nginx.conf",
    });
    expect(extracted.rawText).toContain("server_name app.cliente.com");
    expect(extracted.rawText).not.toContain("hunter2");
    expect(extracted.rawText).not.toContain("secreta");
    expect(extracted.normalizedText).not.toContain("hunter2");
  });
});
