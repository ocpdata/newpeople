import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAccountDossier, buildOpportunityDossier, buildSection, indexDossierEvidence, loadCommercialHistory,
} from "../src/commercial-intelligence/dossier/opportunity-dossier.js";
import { checkDossierCoverage, dossierTargets, summarizeCoverage } from "../src/customer-chat-acceptance/dossier-coverage.js";

const governance = { includeWonOpportunities: true, includeLostOpportunities: false, includeCancelledOpportunities: false };
const ALL = ["cuentas.read_all", "oportunidades.read_all", "contactos.read", "desarrollo_comercial.read",
  "calendario_comercial.read_all", "interacciones.read_all", "cotizaciones.revision"];
const userWith = (permissions = ALL, id = 7) => ({ id, permissionSet: new Set(permissions) });

const opportunityRow = {
  id: 121, name: "Sealpath", account_id: 163, contact_id: 226, amount_usd: "8000.00", close_date: "2026-10-31",
  sales_stage_id: 7, stage_code: "waiting", stage_name: "Waiting", commercial_status_id: 1,
  commercial_status_code: "en_proceso", commercial_status_name: "En proceso", commercial_closed_at: null,
  commercial_close_reason: null, seller_name: "Oscar", presales_name: null, business_line_name: "Seguridad",
  created_at: "2026-10-01 10:00:00", updated_at: "2026-10-19 10:00:00",
};

function makeRun(overrides = {}) {
  const calls = [];
  const handlers = [
    ["FROM opportunities o\n     INNER JOIN opportunity_sales_stages oss", () => [opportunityRow]],
    ["FROM accounts a", () => [{ id: 163, name: "Grupo Diestra" }]],
    ["FROM opportunity_stage_question_answers a\n       LEFT JOIN", () => [
      { id: 982, sales_stage_id: 2, stage_name: "Identificación", question_id: 5, question_code: "fecha", question_prompt: "¿Fecha?", answer_value: "Noviembre", answered_at: "2026-09-04", answered_by: "Oscar" },
      { id: 1056, sales_stage_id: 2, stage_name: "Identificación", question_id: 5, question_code: "fecha", question_prompt: "¿Fecha?", answer_value: "Antes del 31 de diciembre", answered_at: "2026-09-10", answered_by: "Oscar" },
      { id: 1097, sales_stage_id: 2, stage_name: "Identificación", question_id: 6, question_code: "decisor", question_prompt: "¿Quién decide?", answer_value: "La dirección aprueba", answered_at: "2026-10-01", answered_by: "Oscar" },
    ]],
    ["FROM opportunity_stage_questions q", () => [{ id: 70, code: "acuerdo", prompt: "¿Hay acuerdo?", is_required: 1, latest_answer_id: null }]],
    ["FROM contacts c", () => [{ id: 226, first_name: "Daniel", last_name: "Carrillo", position_title: "Gerente de Infraestructura" }]],
    ["FROM opportunity_workspace_actions a", () => [
      { id: 51, title: "Llamada", action_type: "call", status: "pending", due_date: "2026-10-16", notes: "Se procederá con la orden de compra", is_primary_next_step: 0 },
    ]],
    ["FROM commercial_calendar_activities cca", () => []],
    ["FROM opportunity_notes n", () => []],
    ["FROM quotations q", () => [{ id: 78, latest_version_id: 139, activation_code: "activada" }]],
    ["FROM quotation_versions v", () => [{ id: 139, quotation_id: 78, version_number: 1, status_id: 4, status_code: "aprobada", status_name: "Aprobada", quotation_date: "2026-10-01" }]],
    ["FROM quotation_won_documents w", () => []],
    ["FROM opportunity_document_links l", () => []],
    ["FROM interactions i", () => []],
    ["FROM audit_log a", () => []],
    ["SELECT 'stage' AS catalog", () => []],
  ];
  const run = vi.fn(async (sql, params = []) => {
    calls.push({ sql, params });
    const override = Object.entries(overrides).find(([fragment]) => sql.includes(fragment));
    if (override) return override[1](sql, params);
    const handler = handlers.find(([fragment]) => sql.includes(fragment));
    if (!handler) throw new Error(`Consulta inesperada: ${sql.slice(0, 80)}`);
    return handler[1](sql, params);
  });
  return { run, calls };
}

let consoleError;
beforeEach(() => { consoleError = vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => consoleError.mockRestore());

describe("autorización del expediente", () => {
  it("exige permiso de oportunidades y aplica la política de estados comerciales", async () => {
    await expect(buildOpportunityDossier({ user: userWith(["cuentas.read_all"]), opportunityId: 121, governance, run: makeRun().run }))
      .rejects.toMatchObject({ status: 403, code: "DOSSIER_PERMISSION_DENIED" });
    const { run, calls } = makeRun();
    await buildOpportunityDossier({ user: userWith(), opportunityId: 121, governance, run });
    expect(calls[0].params).toEqual([121, ["en_proceso", "ganada"]]);
  });

  it("restringe por propietario, creador o vendedor cuando no hay lectura global", async () => {
    const { run, calls } = makeRun();
    await buildOpportunityDossier({ user: userWith(["cuentas.read", "oportunidades.read"], 9), opportunityId: 121, governance, run });
    expect(calls[0].sql).toContain("o.seller_user_id = ?");
    expect(calls[0].params).toEqual([121, ["en_proceso", "ganada"], 9, 9, 9]);
    expect(calls[1].sql).toContain("account_owners");
    expect(calls[1].params).toEqual([163, 9]);
  });

  it("no revela una oportunidad inaccesible ni una cuenta fuera de alcance", async () => {
    await expect(buildOpportunityDossier({ user: userWith(), opportunityId: 121, governance,
      run: makeRun({ "INNER JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id\n     INNER JOIN": () => [] }).run }))
      .rejects.toMatchObject({ status: 404, code: "DOSSIER_OPPORTUNITY_UNAVAILABLE" });
    await expect(buildOpportunityDossier({ user: userWith(), opportunityId: 121, governance,
      run: makeRun({ "FROM accounts a": () => [] }).run }))
      .rejects.toMatchObject({ status: 404, code: "DOSSIER_ACCOUNT_UNAVAILABLE" });
  });
});

describe("contenido del expediente de oportunidad", () => {
  it("incluye todas las fuentes con su significado y evidencias únicas", async () => {
    const dossier = await buildOpportunityDossier({ user: userWith(), opportunityId: 121, governance, run: makeRun().run,
      now: new Date("2026-10-23T12:00:00Z") });
    expect(dossier.opportunity).toMatchObject({ evidenceId: "opp121", amountUsd: "8000.00", closeDate: "2026-10-31", stageName: "Waiting" });
    expect(dossier.opportunity.meanings.closeDate).toMatch(/no acredita un compromiso/);
    expect(dossier.sections.contacts.items[0]).toMatchObject({ evidenceId: "contact226", isOpportunityContact: true });
    expect(dossier.sections.contacts.items[0].meanings.positionTitle).toMatch(/no acredita autoridad/);
    expect(dossier.sections.activities.items[0]).toMatchObject({ evidenceId: "act51", status: "pending", notes: "Se procederá con la orden de compra" });
    expect(dossier.sections.activities.items[0].meanings.status).toMatch(/no la marca como realizada/);
    expect(dossier.sections.quotations.items[0].versions[0]).toMatchObject({ evidenceId: "qv139", statusCode: "aprobada", isLatest: true });
    expect(dossier.sections.quotations.items[0].versions[0].meanings.status).toMatch(/no registra su envío ni su aceptación/);
    expect(dossier.sections.purchaseOrders).toMatchObject({ status: "empty", total: 0 });
    expect(dossier.sections.purchaseOrders.meaning).toMatch(/orden de compra del cliente/);
    expect(dossier.sections.opportunityNotes.meaning).toMatch(/notas de actividades están en la sección de actividades/);
    expect(dossier.sections.stageRequirements.items[0]).toMatchObject({ required: true, answered: false, answerEvidenceId: null });
    expect(dossier.generatedAt).toBe("2026-10-23T12:00:00.000Z");
    expect(indexDossierEvidence(dossier).has("ans1097")).toBe(true);
  });

  it("marca las respuestas sustituidas por una versión posterior de la misma pregunta", async () => {
    const dossier = await buildOpportunityDossier({ user: userWith(), opportunityId: 121, governance, run: makeRun().run });
    const answers = Object.fromEntries(dossier.sections.stageAnswers.items.map((item) => [item.evidenceId, item]));
    expect(answers.ans982).toMatchObject({ current: false, supersededBy: "ans1056" });
    expect(answers.ans1056).toMatchObject({ current: true });
    expect(answers.ans1097).toMatchObject({ current: true, answerValue: "La dirección aprueba" });
  });

  it("declara restringidas las fuentes sin permiso en lugar de vaciarlas", async () => {
    const dossier = await buildOpportunityDossier({ user: userWith(["cuentas.read_all", "oportunidades.read_all"]),
      opportunityId: 121, governance, run: makeRun().run });
    for (const key of ["contacts", "activities", "calendarActivities", "quotations", "purchaseOrders", "interactions"]) {
      expect(dossier.sections[key]).toMatchObject({ status: "restricted", total: null, items: [] });
      expect(dossier.sections[key].meaning).toMatch(/no significa que no existan/);
    }
    expect(dossier.sections.stageAnswers.status).toBe("loaded");
  });

  it("registra una lectura fallida sin convertirla en ausencia ni detener las demás secciones", async () => {
    const dossier = await buildOpportunityDossier({ user: userWith(), opportunityId: 121, governance,
      run: makeRun({ "FROM opportunity_workspace_actions a": () => { throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }); } }).run });
    expect(dossier.sections.activities).toMatchObject({ status: "failed", errorCode: "ETIMEDOUT", total: null, items: [] });
    expect(dossier.sections.activities.meaning).toMatch(/no se puede afirmar/);
    expect(dossier.sections.quotations.status).toBe("loaded");
    expect(consoleError).toHaveBeenCalledWith("[dossier] Section read failed", { section: "activities", errorCode: "ETIMEDOUT" });
  });

  it("marca como truncada una sección que supera su límite", async () => {
    const section = await buildSection({ key: "activities", allowed: true, limit: 2,
      load: async (limit) => Array.from({ length: limit }, (_, index) => ({ id: index })), map: (row) => ({ evidenceId: `act${row.id}` }) });
    expect(section).toMatchObject({ status: "truncated", total: null, totalAtLeast: 3 });
    expect(section.items).toHaveLength(2);
  });

  it("recorta textos largos indicando el campo truncado", async () => {
    const dossier = await buildOpportunityDossier({ user: userWith(), opportunityId: 121, governance,
      run: makeRun({ "FROM opportunity_workspace_actions a": () => [{ id: 1, status: "pending", notes: "x".repeat(5000) }] }).run });
    expect(dossier.sections.activities.items[0].notes).toHaveLength(4000);
    expect(dossier.sections.activities.items[0].truncatedFields).toEqual(["notes"]);
  });
});

describe("historial comercial", () => {
  const catalog = [{ catalog: "stage", id: 6, name: "Negociación" }, { catalog: "stage", id: 7, name: "Waiting" },
    { catalog: "commercial", id: 1, name: "En proceso" }, { catalog: "commercial", id: 2, name: "Ganada" }];
  const runWith = (rows) => vi.fn(async (sql) => sql.includes("FROM audit_log") ? rows : catalog);

  it("conserva solo cambios comerciales, con nombres legibles y sin duplicar el mismo cambio", async () => {
    const events = await loadCommercialHistory({ opportunityId: 27, limit: 10, run: runWith([
      { id: 1, action: "updated", changed_fields: { sales_stage_id: { before: 6, after: 7 } }, created_at: "2026-06-23" },
      { id: 2, action: "stage_advanced", changed_fields: { sales_stage_id: { before: 6, after: 7 }, stage_change_reason: { before: null, after: null } }, created_at: "2026-06-23" },
      { id: 3, action: "updated", changed_fields: null, created_at: "2026-06-24" },
      { id: 4, action: "updated", changed_fields: JSON.stringify({ amount_usd: { before: "40000.00", after: "41560.00" } }), created_at: "2026-06-25" },
      { id: 5, action: "commercial_history_changed", changed_fields: { commercial_history: { after: {
        before_state: { commercial_status_id: 1, close_date: "2026-07-03" }, after_state: { commercial_status_id: 2, close_date: "2026-07-03" } } } }, created_at: "2026-07-02" },
    ]) });
    expect(events.map((event) => event.id)).toEqual([5, 4, 2]);
    expect(events[0].changes).toEqual([{ field: "commercial_status_id", label: "estado comercial", before: "En proceso", after: "Ganada" }]);
    expect(events[2].changes[0]).toMatchObject({ before: "Negociación", after: "Waiting" });
  });

  it("señala un evento ilegible y falla de forma explícita si excede el límite", async () => {
    const events = await loadCommercialHistory({ opportunityId: 27, limit: 10, run: runWith([
      { id: 9, action: "updated", changed_fields: "{no es json", created_at: "2026-06-25" },
    ]) });
    expect(events[0]).toMatchObject({ id: 9, unparsed: true, changes: [] });
    await expect(loadCommercialHistory({ opportunityId: 27, limit: 10,
      run: runWith(Array.from({ length: 2000 }, (_, id) => ({ id, action: "updated", changed_fields: null }))) }))
      .rejects.toMatchObject({ code: "DOSSIER_HISTORY_LIMIT" });
  });
});

describe("expediente de cuenta", () => {
  it("lista oportunidades visibles y oculta nombres de contacto sin permiso de contactos", async () => {
    const { run, calls } = makeRun({ "FROM opportunities o\n       INNER JOIN": () => [
      { id: 121, name: "Sealpath", amount_usd: "8000.00", close_date: "2026-10-31", sales_stage_id: 7, stage_name: "Waiting",
        commercial_status_id: 1, commercial_status_code: "en_proceso", commercial_status_name: "En proceso", contact_id: 226, contact_name: null },
    ] });
    const dossier = await buildAccountDossier({ user: userWith(["cuentas.read_all", "oportunidades.read_all"]), accountId: 163, governance, run });
    expect(dossier.sections.opportunities.items[0]).toMatchObject({ evidenceId: "opp121", closeDate: "2026-10-31", contactName: null });
    expect(calls.find((call) => call.sql.includes("FROM opportunities o\n       INNER JOIN")).sql).toContain("NULL AS contact_name");
    expect(dossier.sections.contacts.status).toBe("restricted");
    expect(dossier.sections.pendingActivities.status).toBe("restricted");
  });

  it("incluye las actividades pendientes de las oportunidades visibles con su oportunidad", async () => {
    const { run, calls } = makeRun({ "FROM opportunities o\n       INNER JOIN": () => [] });
    const dossier = await buildAccountDossier({ user: userWith(["cuentas.read", "oportunidades.read", "desarrollo_comercial.read"], 9),
      accountId: 163, governance, run });
    const call = calls.find((item) => item.sql.includes("a.status IN ('pending', 'rescheduled')"));
    expect(call.params).toEqual([163, ["en_proceso", "ganada"], 9, 9, 9, 51]);
    expect(dossier.sections.pendingActivities).toMatchObject({ status: "loaded", total: 1 });
    expect(dossier.sections.pendingActivities.items[0]).toMatchObject({ evidenceId: "act51", status: "pending" });
    expect(dossier.sections.pendingActivities.items[0].meanings.status).toMatch(/no la marca como realizada/);
  });

  it("incluye actividades de la cuenta en todos los estados y admite el mismo registro en dos secciones", async () => {
    const { run, calls } = makeRun({ "FROM opportunities o\n       INNER JOIN": () => [] });
    const dossier = await buildAccountDossier({ user: userWith(["cuentas.read", "oportunidades.read", "desarrollo_comercial.read"], 9),
      accountId: 163, governance, run });
    const allStatuses = calls.filter((item) => item.sql.includes("FROM opportunity_workspace_actions a") &&
      !item.sql.includes("a.status IN ('pending', 'rescheduled')"));
    expect(allStatuses).toHaveLength(1);
    expect(allStatuses[0].sql).toContain("DESC");
    expect(dossier.sections.accountActivities).toMatchObject({ status: "loaded", total: 1 });
    expect(indexDossierEvidence(dossier).get("act51")).toMatchObject({ status: "pending" });
    const clash = { ...dossier, sections: { ...dossier.sections, accountActivities: { ...dossier.sections.accountActivities,
      items: [{ ...dossier.sections.accountActivities.items[0], source: { table: "commercial_calendar_activities", id: 51 } }] } } };
    expect(() => indexDossierEvidence(clash)).toThrow(/Evidencia duplicada/);
  });
});

describe("cobertura del banco en el expediente", () => {
  const bank = {
    facts: {
      amount: { table: "opportunities", id: 121, field: "amount_usd", equals: "8000.00" },
      approval: { table: "opportunity_stage_question_answers", id: 1097, field: "answer_value", contains: "dirección aprueba" },
      quote: { table: "quotation_versions", id: 139, field: "status_id", equals: 4 },
      noPurchaseOrder: { table: "quotation_won_documents", where: { opportunity_id: 121, document_role: "purchase_order" }, count: 0 },
      notes: { table: "opportunity_notes", where: { opportunity_id: 121 }, count: 0 },
      pending: { table: "opportunity_workspace_actions", where: { opportunity_id: 121, status: "pending" }, count: 1 },
      opportunities: { table: "opportunities", where: { account_id: 163 }, count: 1 },
    },
    conversations: [{ id: "C", accountId: 163, turns: [{ mustInclude: [{ critical: true, evidence: ["amount", "noPurchaseOrder"] }] }] }],
  };

  it("localiza valores y conteos completos en el expediente", async () => {
    const opportunity = await buildOpportunityDossier({ user: userWith(), opportunityId: 121, governance, run: makeRun().run });
    const account = await buildAccountDossier({ user: userWith(), accountId: 163, governance,
      run: makeRun({ "FROM opportunities o\n       INNER JOIN": () => [{ id: 121, name: "Sealpath", amount_usd: "8000.00" }] }).run });
    expect(dossierTargets(bank)).toEqual({ opportunityIds: [121], accountIds: [163] });
    const summary = summarizeCoverage(checkDossierCoverage(bank, {
      opportunityDossiers: new Map([[121, opportunity]]), accountDossiers: new Map([[163, account]]) }));
    expect(summary).toMatchObject({ total: 7, located: 7, criticalTotal: 2, criticalLocated: 2, missing: [] });
  });

  it("no acepta como ausencia una sección restringida o fallida", async () => {
    const opportunity = await buildOpportunityDossier({ user: userWith(["cuentas.read_all", "oportunidades.read_all"]),
      opportunityId: 121, governance, run: makeRun({ "FROM opportunity_notes n": () => { throw new Error("x"); } }).run });
    const results = checkDossierCoverage(bank, { opportunityDossiers: new Map([[121, opportunity]]), accountDossiers: new Map() });
    const byId = Object.fromEntries(results.map((item) => [item.factId, item]));
    expect(byId.noPurchaseOrder).toMatchObject({ located: false, reason: "seccion_restricted", critical: true });
    expect(byId.notes).toMatchObject({ located: false, reason: "seccion_failed" });
    expect(byId.opportunities).toMatchObject({ located: false, reason: "expediente_ausente" });
  });
});
