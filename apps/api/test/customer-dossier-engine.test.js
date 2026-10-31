import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeCustomerTurn, validateRoute } from "../src/commercial-intelligence/dossier/router.js";
import { analyzeCustomerTurn, parseAnalysis } from "../src/commercial-intelligence/dossier/analyst.js";
import { buildEvidenceIndex, normalizeAnalysisEvidence, presentationIssues, verifyAnalysis } from "../src/commercial-intelligence/dossier/verifier.js";
import { channelAllows, enabledChannelTools, sectionPermissions } from "../src/commercial-intelligence/dossier/access.js";
import { actionOnlyPlan, buildDossierQualityTrace, combineDossierAndActionResponse, describeCitation, limitAnswer, runCustomerDossierTurn } from "../src/commercial-intelligence/dossier/engine.js";
import { validateCustomerConversationContext } from "../src/commercial-intelligence/conversation-context.js";
import { appendCustomerAccountChatHistory } from "../src/commercial-intelligence/customer-chat-adapter.js";

const governance = { includeWonOpportunities: true, includeLostOpportunities: false, includeCancelledOpportunities: false };
const user = { id: 7, permissionSet: new Set(["cuentas.read_all", "oportunidades.read_all", "contactos.read",
  "desarrollo_comercial.read", "calendario_comercial.read_all", "interacciones.read_all", "cotizaciones.revision"]) };

function fakeRun(overrides = {}) {
  const handlers = [
    ["FROM opportunities o\n       INNER JOIN", () => [
      { id: 121, name: "Sealpath", amount_usd: "8000.00", close_date: "2026-10-31", sales_stage_id: 7, stage_name: "Waiting",
        commercial_status_id: 1, commercial_status_code: "en_proceso", commercial_status_name: "En proceso", contact_id: 226, contact_name: "Daniel Carrillo" },
      { id: 117, name: "Correo", amount_usd: "30000.00", close_date: "2026-12-31", sales_stage_id: 2, stage_name: "Identificación",
        commercial_status_id: 1, commercial_status_code: "en_proceso", commercial_status_name: "En proceso", contact_id: 226, contact_name: "Daniel Carrillo" },
    ]],
    ["FROM opportunities o\n     INNER JOIN opportunity_sales_stages oss", () => [{
      id: 121, name: "Sealpath", account_id: 163, contact_id: 226, amount_usd: "8000.00", close_date: "2026-10-31",
      sales_stage_id: 7, stage_code: "waiting", stage_name: "Waiting", commercial_status_id: 1, commercial_status_code: "en_proceso",
      commercial_status_name: "En proceso" }]],
    ["FROM accounts a", () => [{ id: 163, name: "Grupo Diestra" }]],
    ["FROM opportunity_stage_question_answers a\n       LEFT JOIN", () => [
      { id: 1097, sales_stage_id: 2, stage_name: "Identificación", question_id: 6, question_code: "decisor",
        question_prompt: "¿Quién decide?", answer_value: "La dirección aprueba tras la recomendación del gerente de TI" }]],
    ["FROM opportunity_stage_questions q", () => []],
    ["FROM contacts c", () => [{ id: 226, first_name: "Daniel", last_name: "Carrillo", position_title: "Gerente de Infraestructura" }]],
    ["FROM opportunity_workspace_actions a", () => [
      { id: 51, title: "Llamada de confirmación", status: "pending", due_date: "2026-10-16", notes: "Se procederá con la orden de compra" }]],
    ["FROM commercial_calendar_activities cca", () => []],
    ["FROM opportunity_notes n", () => []],
    ["FROM quotations q", () => [{ id: 78, latest_version_id: 139 }]],
    ["FROM quotation_versions v", () => [{ id: 139, quotation_id: 78, version_number: 1, status_id: 4, status_code: "aprobada", status_name: "Aprobada" }]],
    ["FROM quotation_won_documents w", () => []],
    ["FROM opportunity_document_links l", () => []],
    ["FROM interactions i", () => []],
    ["FROM audit_log a", () => []],
    ["SELECT 'stage' AS catalog", () => []],
  ];
  return async (sql) => {
    const override = Object.entries(overrides).find(([fragment]) => sql.includes(fragment));
    if (override) return override[1]();
    const handler = handlers.find(([fragment]) => sql.includes(fragment));
    if (!handler) throw new Error(`Consulta inesperada: ${sql.slice(0, 60)}`);
    return handler[1]();
  };
}

const route = (overrides = {}) => ({
  mode: "consult", focusLevel: "opportunity", opportunityIds: [121],
  obligations: [{ id: "o1", ask: "Importe y cotización", form: "answer", count: 0, itemsNeedConfirmation: false }],
  recordFilters: [], clarificationQuestion: "", clarificationOptions: [], reason: "Pide datos de Sealpath", ...overrides,
});
const QUESTION = "¿Cuánto vale Sealpath y qué cotización tiene?";
const constraints = (overrides = {}) => ({ count: 0, durationMinutes: 0, length: "standard", format: "free",
  excludedSources: [], excludedFields: [], noWrite: false, noSend: false, quotes: [], ...overrides });
const planTask = (overrides = {}) => ({ type: "consult", kind: "detail", ask: "Importe y cotización", evidence: "Cuánto vale Sealpath",
  focusLevel: "opportunity", opportunityIds: [121], dependsOn: [], itemsNeedConfirmation: false, constraints: constraints(), ...overrides });
const rawPlan = (overrides = {}) => ({ tasks: [planTask()], recordFilters: [], continuation: { kind: "none", previousTaskIndex: 0 },
  clarification: { question: "", options: [] }, reason: "Pide datos de Sealpath", ...overrides });
const claim = (overrides = {}) => ({ text: "El importe registrado es 8,000 USD", kind: "registered", evidenceIds: ["opp121"],
  sectionKeys: [], values: [{ type: "amount", value: "8000" }], ...overrides });
const analysis = (overrides = {}) => ({
  blocks: [{ obligationId: "o1", status: "answered", reason: "", items: [], claims: [
    claim(),
    claim({ text: "La cotización está Aprobada", evidenceIds: ["qv139"], values: [{ type: "status", value: "Aprobada" }] }),
  ] }],
  answerText: "La oportunidad tiene un importe registrado de 8,000 USD y una cotización aprobada internamente.",
  ...overrides,
});

let consoleError;
beforeEach(() => { consoleError = vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => consoleError.mockRestore());

describe("gobernanza del canal en el expediente", () => {
  const user = { permissionSet: new Set(["cuentas.read", "oportunidades.read", "contactos.read",
    "desarrollo_comercial.read", "calendario_comercial.read", "interacciones.read", "cotizaciones.read"]) };

  it("sin configuración de canal conserva solo los permisos del usuario", () => {
    expect(sectionPermissions(user, null)).toMatchObject({ contacts: true, activities: true, interactions: true });
  });

  it("restringe las fuentes cuya herramienta no está habilitada en intenciones activas", () => {
    const channelTools = enabledChannelTools([
      { code: "account_overview", enabled: true, allowedTools: ["searchAccounts", "searchOpportunities", "searchContacts"] },
      { code: "quotation_query", enabled: false, allowedTools: ["getOpportunityQuotation"] },
      { code: "contact_history", enabled: true, allowedTools: ["searchInteractions"] },
    ]);
    const permissions = sectionPermissions(user, { channelTools });
    expect(permissions).toMatchObject({
      contacts: true, interactions: true, quotations: false, purchaseOrders: false,
      activities: false, pendingActivities: false, calendarActivities: false, opportunityNotes: false,
    });
    expect(channelAllows({ channelTools }, "opportunities")).toBe(true);
    expect(channelAllows({ channelTools: new Set() }, "opportunities")).toBe(false);
  });
});

describe("enrutador", () => {
  const ctx = { question: QUESTION, opportunityIds: [121, 117] };

  it("rechaza IDs ajenos a la cuenta, focos inconsistentes y tipos inválidos", () => {
    expect(validateRoute(rawPlan({ tasks: [planTask({ opportunityIds: [999] })] }), ctx).issues)
      .toContain("t1: opportunityIds contiene IDs ajenos a la cuenta.");
    expect(validateRoute(rawPlan({ tasks: [planTask({ opportunityIds: [] })] }), ctx).issues)
      .toContain("t1: focusLevel=opportunity requiere un ID.");
    expect(validateRoute(rawPlan({ tasks: [planTask({ kind: "email" })] }), ctx).issues)
      .toContain("t1: kind=email no corresponde a type=consult.");
    expect(validateRoute(rawPlan({ tasks: [planTask({ focusLevel: "account", opportunityIds: [] })] }), ctx).issues).toEqual([]);
  });

  it("deriva modo, foco y obligaciones del plan y convierte errores de esquema en problemas", () => {
    const { route } = validateRoute(rawPlan({ tasks: [
      planTask(),
      planTask({ kind: "next_steps", ask: "Tres próximos pasos", evidence: "qué cotización tiene",
        itemsNeedConfirmation: true, constraints: constraints({ count: 3, length: "brief", quotes: ["Cuánto vale"] }) }),
    ] }), ctx);
    expect(route).toMatchObject({ mode: "consult", focusLevel: "opportunity", opportunityIds: [121], responseLength: "brief" });
    expect(route.obligations.map(({ id, taskId, form, count, itemsNeedConfirmation }) => ({ id, taskId, form, count, itemsNeedConfirmation })))
      .toEqual([{ id: "o1", taskId: "t1", form: "answer", count: 0, itemsNeedConfirmation: false },
        { id: "o2", taskId: "t2", form: "exact_items", count: 3, itemsNeedConfirmation: true }]);
    const invalid = validateRoute({ ...rawPlan(), tasks: [{ ...planTask(), extra: true }] }, ctx);
    expect(invalid.route).toBeNull();
    expect(invalid.issues[0]).toMatch(/^tasks\.0/);
  });

  it("clasifica el modo según las tareas del plan", () => {
    const mode = (tasks, extra = {}) => validateRoute(rawPlan({ tasks, ...extra }), ctx).route.mode;
    const limit = (kind) => planTask({ type: "limit", kind, focusLevel: "none", opportunityIds: [] });
    expect(mode([planTask({ type: "compose", kind: "email" })])).toBe("compose");
    expect(mode([planTask(), planTask({ type: "compose", kind: "translation", material: "previous_answer" })])).toBe("compose");
    expect(mode([planTask({ type: "compose", kind: "questions", material: "library" })])).toBe("compose");
    expect(mode([planTask({ type: "compose", kind: "summary", material: "attachment" })])).toBe("compose");
    expect(mode([planTask(), planTask({ type: "action", kind: "schedule_activity" })])).toBe("action");
    expect(mode([planTask({ type: "document", kind: "quotation" })])).toBe("consult");
    expect(mode([planTask({ type: "limit", kind: "financial_data", focusLevel: "none", opportunityIds: [] })])).toBe("limit");
    expect(mode([limit("remove_record")])).toBe("limit");
    expect(mode([limit("out_of_scope")])).toBe("out_of_scope");
    expect(mode([], { clarification: { question: "¿Cuál oportunidad?", options: [{ label: "Sealpath", opportunityId: 121 }] } })).toBe("clarify");
    expect(mode([planTask(), limit("remove_record")])).toBe("consult");
  });

  it("descarta filtros sin cita literal del mensaje", () => {
    const { route: validated, droppedFilters } = validateRoute(rawPlan({ recordFilters: [
      { description: "Vencen esta semana", quote: "que vencen esta semana" },
      { description: "Orden prevista", quote: "semana del 19 al 24" },
    ], tasks: [planTask({ evidence: "actividades" })] }), { question: "¿Qué actividades que vencen esta semana tiene?", opportunityIds: [121] });
    expect(validated.recordFilters.map((filter) => filter.quote)).toEqual(["que vencen esta semana"]);
    expect(droppedFilters.map((filter) => filter.quote)).toEqual(["semana del 19 al 24"]);
  });

  it("reintenta una vez con los problemas concretos y luego falla de forma explícita", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce(rawPlan({ tasks: [planTask({ opportunityIds: [999] })] }))
      .mockResolvedValueOnce(rawPlan());
    const result = await routeCustomerTurn({ context: {}, ...ctx, userId: 7, jobId: 1, call, model: "router", reasoningEffort: "" });
    expect(result.route.opportunityIds).toEqual([121]);
    expect(call.mock.calls[1][0].context.validationFeedback.issues).toHaveLength(1);
    expect(call.mock.calls[0][0]).toMatchObject({ model: "router", temperature: 0,
      aiUsageContext: { featureCode: "commercial_intelligence.account_chat.dossier_router", jobId: 1 } });
    await expect(routeCustomerTurn({ context: {}, ...ctx, userId: 7, jobId: 1, model: "router",
      call: vi.fn().mockResolvedValue(rawPlan({ tasks: [planTask({ opportunityIds: [999] })] })) }))
      .rejects.toMatchObject({ code: "DOSSIER_ROUTE_INVALID" });
    const reasoning = vi.fn().mockResolvedValue(rawPlan());
    await routeCustomerTurn({ context: {}, ...ctx, userId: 7, jobId: 1, call: reasoning, model: "router", reasoningEffort: "low" });
    expect(reasoning.mock.calls[0][0]).toMatchObject({ reasoningEffort: "low" });
    expect(reasoning.mock.calls[0][0]).not.toHaveProperty("temperature");
  });

  it("tras el reintento acepta citas no literales como problema no bloqueante", async () => {
    const loose = rawPlan({ tasks: [planTask({ evidence: "cuanto vale sealpath?" })] });
    const result = await routeCustomerTurn({ context: {}, ...ctx, userId: 7, jobId: 1, model: "router", reasoningEffort: "",
      call: vi.fn().mockResolvedValue(loose) });
    expect(result.softIssues).toEqual(["t1: evidence debe ser un fragmento literal del mensaje."]);
    const unquoted = rawPlan({ tasks: [planTask({ constraints: constraints({ excludedFields: ["prices"] }) })] });
    const kept = await routeCustomerTurn({ context: {}, ...ctx, userId: 7, jobId: 1, model: "router", reasoningEffort: "",
      call: vi.fn().mockResolvedValue(unquoted) });
    expect(kept.route.plan.tasks[0].constraints.excludedFields).toEqual(["prices"]);
    expect(result.route.plan.tasks[0].id).toBe("t1");
  });
});

describe("respuestas de límite", () => {
  it("usa mensajes fijos y enlaza la documentación solo cuando está configurada", () => {
    expect(limitAnswer("remove_record")).toContain("No se eliminó ni modificó ningún registro");
    expect(limitAnswer("send_communication")).toContain("No se envió ninguna comunicación");
    expect(limitAnswer("system_help", "¿Dónde está el manual?", "https://docs.example.com"))
      .toContain("Puedes consultar la documentación de la aplicación en https://docs.example.com.");
    expect(limitAnswer("system_help", "¿Dónde está el manual?", "")).toContain("Solicita la documentación vigente al administrador.");
    expect(limitAnswer("system_help", "¿Qué permisos tengo?", "")).toContain("No puedo consultar la configuración vigente");
  });
});

describe("analista", () => {
  it("exige exactamente un bloque por obligación y un modelo configurado", async () => {
    const obligations = route().obligations;
    expect(() => parseAnalysis(analysis({ blocks: [] }), obligations)).toThrow(/exactamente un bloque/);
    await expect(analyzeCustomerTurn({ context: {}, obligations, userId: 7, model: "", call: vi.fn() }))
      .rejects.toMatchObject({ code: "DOSSIER_ANALYST_NOT_CONFIGURED" });
    const call = vi.fn(async () => analysis());
    await analyzeCustomerTurn({ context: {}, obligations, userId: 7, jobId: 3, model: "analista", reasoningEffort: "medium", call });
    expect(call.mock.calls[0][0]).toMatchObject({ model: "analista", reasoningEffort: "medium",
      aiUsageContext: { featureCode: "commercial_intelligence.account_chat.dossier_analyst", jobId: 3 } });
  });
});

describe("verificación por código", () => {
  const dossier = {
    kind: "opportunity",
    account: { evidenceId: "acct163", id: 163, name: "Grupo Diestra" },
    opportunity: { evidenceId: "opp121", amountUsd: "8000.00", closeDate: "2026-10-31", stageName: "Waiting", sellerName: "Oscar Amaya" },
    sections: {
      activities: { key: "activities", status: "loaded", items: [{ evidenceId: "act51", status: "pending", dueDate: "2026-10-16" }] },
      opportunityNotes: { key: "opportunityNotes", status: "empty", items: [] },
      contacts: { key: "contacts", status: "restricted", items: [] },
      quotations: { key: "quotations", status: "loaded", items: [{ evidenceId: "quote78", versions: [
        { evidenceId: "qv139", statusName: "Aprobada", statusCode: "aprobada", quotationDate: "2026-10-01" }] }] },
    },
  };
  const obligations = route().obligations;
  const check = (value) => verifyAnalysis({ analysis: value, obligations, dossiers: [dossier] });

  it("acepta afirmaciones citadas con valores que coinciden", () => {
    expect(check(analysis())).toMatchObject({ ok: true, failures: [] });
    expect(check(analysis()).citedEvidenceIds.sort()).toEqual(["opp121", "qv139"]);
  });

  it("rechaza evidencia inexistente y valores que no coinciden con lo citado", () => {
    const result = check(analysis({ blocks: [{ obligationId: "o1", status: "answered", reason: "", items: [], claims: [
      claim({ evidenceIds: ["opp999"] }),
      claim({ values: [{ type: "amount", value: "9000" }] }),
      claim({ text: "Cierre", values: [{ type: "date", value: "2026-11-30" }] }),
      claim({ text: "Cierre", values: [{ type: "date", value: "31/10/2026" }] }),
      claim({ text: "Vendedor", values: [{ type: "person", value: "Daniel Carrillo" }] }),
      claim({ text: "Etapa", values: [{ type: "status", value: "Negociación" }] }),
    ] }] }));
    expect(result.failures.map((failure) => failure.code)).toEqual(
      ["UNKNOWN_EVIDENCE", "VALUE_WITHOUT_EVIDENCE", "VALUE_MISMATCH", "VALUE_MISMATCH", "VALUE_FORMAT", "VALUE_MISMATCH", "VALUE_MISMATCH"]);
    expect(check(analysis({ blocks: [{ obligationId: "o1", status: "answered", reason: "", items: [], claims: [
      claim({ text: "Vendedor", values: [{ type: "person", value: "Oscar Amaya" }] }),
      claim({ text: "Vence", evidenceIds: ["act51"], values: [{ type: "date", value: "2026-10-16" }, { type: "status", value: "pending" }] }),
    ] }] })).ok).toBe(true);
  });

  it("solo acepta ausencias basadas en secciones leídas completas", () => {
    const absence = (sectionKeys) => check(analysis({ blocks: [{ obligationId: "o1", status: "answered", reason: "", items: [], claims: [
      claim({ text: "No hay notas", kind: "absence", evidenceIds: [], sectionKeys, values: [] })] }] }));
    expect(absence(["opportunityNotes"]).ok).toBe(true);
    expect(absence(["contacts"]).failures[0]).toMatchObject({ code: "ABSENCE_INCOMPLETE_SECTION" });
    expect(absence(["documents"]).failures[0]).toMatchObject({ code: "ABSENCE_UNKNOWN_SECTION" });
    expect(absence([]).failures.map((failure) => failure.code)).toEqual(["MISSING_EVIDENCE", "ABSENCE_WITHOUT_SECTION"]);
  });

  it("exige la cantidad de puntos y la confirmación pedidas", () => {
    const itemsObligation = [{ id: "o1", ask: "Tres puntos", form: "exact_items", count: 3, itemsNeedConfirmation: true }];
    const result = verifyAnalysis({ obligations: itemsObligation, dossiers: [dossier], analysis: analysis({ blocks: [{
      obligationId: "o1", status: "answered", reason: "", claims: [claim()],
      items: [{ text: "Orden de compra", confirmation: "Fecha de emisión" }, { text: "Aprobación", confirmation: "" }],
    }] }) });
    expect(result.failures.map((failure) => failure.code)).toEqual(["ITEM_COUNT", "MISSING_CONFIRMATION"]);
  });

  it("limpia texto pegado a un ID real sin aceptar IDs inexistentes", () => {
    const index = buildEvidenceIndex([dossier]);
    const { analysis: cleaned, repaired } = normalizeAnalysisEvidence(analysis({ blocks: [{ obligationId: "o1", status: "answered",
      reason: "", items: [], claims: [
        claim({ evidenceIds: ["opp121 trunc"] }),
        claim({ text: "Cotización y actividad", evidenceIds: ["qv139殊act51"], values: [] }),
        claim({ evidenceIds: ["opp999 extra"] }),
      ] }] }), index);
    expect(repaired).toBe(2);
    expect(cleaned.blocks[0].claims.map((item) => item.evidenceIds)).toEqual([["opp121"], ["qv139", "act51"], ["opp999 extra"]]);
    expect(check(cleaned).failures.map((failure) => failure.code)).toEqual(["UNKNOWN_EVIDENCE", "VALUE_WITHOUT_EVIDENCE"]);
  });

  it("verifica conteos y sumas contra exactamente los registros citados", () => {
    const account = { kind: "account", account: { evidenceId: "acct163", id: 163 }, sections: {
      opportunities: { key: "opportunities", status: "loaded", items: [
        { evidenceId: "opp121", amountUsd: "8000.00" }, { evidenceId: "opp117", amountUsd: "30000.00" }] } } };
    const aggregate = (values, evidenceIds = ["opp121", "opp117"]) => verifyAnalysis({ obligations, dossiers: [account],
      analysis: analysis({ blocks: [{ obligationId: "o1", status: "answered", reason: "", items: [],
        claims: [claim({ text: "Dos abiertas suman 38,000 USD", evidenceIds, values })] }] }) });
    expect(aggregate([{ type: "count", value: "2" }, { type: "amount_total", value: "38000" }]).ok).toBe(true);
    expect(aggregate([{ type: "amount_total", value: "38000" }], ["opp121"]).failures[0]).toMatchObject({ code: "AGGREGATE_MISMATCH" });
    expect(aggregate([{ type: "count", value: "3" }]).failures[0]).toMatchObject({ code: "AGGREGATE_MISMATCH" });
  });

  it("detecta términos internos y respuestas largas cuando se pidió brevedad", () => {
    expect(presentationIssues({ answerText: "No figura en el expediente recibido." })[0]).toMatchObject({ code: "INTERNAL_TERMS" });
    expect(presentationIssues({ answerText: "Ver opp121 para el detalle." })[0]).toMatchObject({ code: "INTERNAL_TERMS" });
    expect(presentationIssues({ answerText: "No figura entre los contactos registrados de Totalplay." })).toEqual([]);
    expect(presentationIssues({ answerText: "x".repeat(1200), responseLength: "brief" }).map((issue) => issue.code))
      .toEqual(["TOO_LONG_FOR_BRIEF"]);
    expect(presentationIssues({ answerText: "## Resumen\nCorto.", responseLength: "brief" }).map((issue) => issue.code))
      .toEqual(["HEADINGS_IN_BRIEF"]);
    expect(presentationIssues({ answerText: "x".repeat(1200), responseLength: "standard" })).toEqual([]);
  });

  it("exige motivo y respaldo según el estado del bloque", () => {
    const result = check(analysis({ answerText: " ", blocks: [{ obligationId: "o1", status: "partial", reason: "", items: [], claims: [] }] }));
    expect(result.failures.map((failure) => failure.code)).toEqual(["EMPTY_ANSWER", "MISSING_REASON", "MISSING_CLAIMS"]);
  });
});

describe("motor de expedientes", () => {
  const withConnection = (overrides) => (work) => work(fakeRun(overrides));
  const base = { user, accountId: 163, question: "¿Cuánto vale Sealpath y qué cotización tiene?", governance, jobId: 9,
    now: new Date("2026-10-23T18:00:00Z"), timezone: "America/Mexico_City" };

  it("delega solo las acciones al recorrido actual sin llamar al analista", async () => {
    const analyze = vi.fn();
    const delegatedTurn = await runCustomerDossierTurn({ ...base, withConnection: withConnection(), analyze,
      route: async () => ({ route: route({ mode: "action" }), droppedFilters: [], attempts: [] }) });
    expect(delegatedTurn).toMatchObject({ handled: false, reason: "mode_action" });
    expect(analyze).not.toHaveBeenCalled();
  });

  it("entrega el plan en los turnos delegados y responde los límites con mensajes fijos", async () => {
    const routed = (plan) => async () => ({ ...validateRoute(plan, { question: base.question, opportunityIds: [121, 117] }), attempts: [] });
    const limit = planTask({ type: "limit", kind: "remove_record", ask: "Eliminar Correo", focusLevel: "none", opportunityIds: [] });
    const analyze = vi.fn(async () => analysis());
    const delegatedTurn = await runCustomerDossierTurn({ ...base, withConnection: withConnection(), analyze,
      route: routed(rawPlan({ tasks: [planTask({ type: "action", kind: "schedule_activity" })] })) });
    expect(delegatedTurn).toMatchObject({ handled: false, reason: "mode_action", plan: { tasks: [{ id: "t1", type: "action" }] } });
    const limitOnly = await runCustomerDossierTurn({ ...base, withConnection: withConnection(), analyze, route: routed(rawPlan({ tasks: [limit] })) });
    expect(limitOnly.response.answer).toBe(limitAnswer("remove_record"));
    expect(limitOnly.response.turnTasks).toEqual([expect.objectContaining({ type: "limit", kind: "remove_record", status: "unavailable" })]);
    expect(analyze).not.toHaveBeenCalled();
    const mixed = await runCustomerDossierTurn({ ...base, withConnection: withConnection(), analyze, route: routed(rawPlan({ tasks: [planTask(), limit] })) });
    expect(mixed.response.answer).toBe(`${analysis().answerText}\n\n${limitAnswer("remove_record")}`);
    expect(mixed.response.turnTasks.map((task) => `${task.type}:${task.status}`)).toEqual(["consult:completed", "limit:unavailable"]);
  });

  it("redacta con el motor nuevo, cita los hechos del cliente y repara una vez", async () => {
    const routed = async () => ({ ...validateRoute(rawPlan({ tasks: [planTask(),
      planTask({ type: "compose", kind: "email", ask: "Correo a Daniel" })] }), { question: base.question, opportunityIds: [121, 117] }), attempts: [] });
    const email = (extra = {}) => ({ deliverables: [{ taskId: "t2", status: "done", reason: "", subject: "Seguimiento de Sealpath",
      body: "Hola Daniel,\n\nRetomo la propuesta de Sealpath.", items: [], notes: "",
      claims: [{ text: "La cotización está Aprobada", kind: "registered", evidenceIds: ["qv139"], sectionKeys: [],
        values: [{ type: "status", value: "Aprobada" }] }], ...extra }] });
    const compose = vi.fn().mockResolvedValueOnce(email({ subject: "" })).mockResolvedValueOnce(email());
    const analyze = vi.fn(async () => analysis());
    const result = await runCustomerDossierTurn({ ...base, withConnection: withConnection(), route: routed, analyze, compose });
    expect(compose).toHaveBeenCalledTimes(2);
    expect(compose.mock.calls[0][0].context.analysisOfThisTurn).toBe(analysis().answerText);
    expect(compose.mock.calls[1][0].context.repair.failures[0]).toMatchObject({ code: "EMAIL_SUBJECT" });
    expect(result.response.answer).toBe(`${analysis().answerText}\n\nAsunto: Seguimiento de Sealpath\n\nHola Daniel,\n\nRetomo la propuesta de Sealpath.`);
    expect(result.response.presentation.status).toBe("completed");
    expect(result.response.turnTasks.map((task) => `${task.type}:${task.kind}:${task.status}`))
      .toEqual(["consult:detail:completed", "compose:email:completed"]);
    expect(result.memory.obligations.map((item) => item.id)).toEqual(["o1", "t2"]);
  });

  it("pide el archivo cuando la tarea depende de un adjunto que no llegó", async () => {
    const analyze = vi.fn();
    const routed = async () => ({ ...validateRoute(rawPlan({ tasks: [planTask({ type: "document", kind: "attachment",
      focusLevel: "none", opportunityIds: [] })] }), { question: base.question, opportunityIds: [121, 117] }), attempts: [] });
    const result = await runCustomerDossierTurn({ ...base, withConnection: withConnection(), route: routed, analyze });
    expect(result.response).toMatchObject({ responseType: "clarification", turnTasks: [{ type: "document", status: "needs_input" }] });
    expect(analyze).not.toHaveBeenCalled();
  });

  it("responde cotizaciones con sus partidas citadas y los límites de facturación con texto fijo", async () => {
    const routed = (tasks) => async () => ({ ...validateRoute(rawPlan({ tasks }), { question: base.question, opportunityIds: [121, 117] }), attempts: [] });
    const items = { "FROM quotation_versions v WHERE": () => [{ id: 139, currency_code: "USD", payment_terms: "30 días" }],
      "FROM quotation_sections s": () => [{ id: 900, quotation_version_id: 139, section_title: "Licencias", inclusion_name: "Incluida",
        product_code: "SP-35", product_description: "Licencias Sealpath", item_type: "producto", is_renewal: 0, quantity: "35.00",
        original_currency_code: "USD", list_price_unit: "110.00", final_discount_pct: "0" }] };
    const analyze = vi.fn(async ({ context }) => {
      expect(context.dossiers.at(-1)).toMatchObject({ kind: "sources" });
      return analysis({ answerText: "La cotización incluye 35 licencias.", blocks: [{ obligationId: "o1", status: "answered", reason: "", items: [],
        claims: [claim({ text: "35 licencias", evidenceIds: ["qitem900"], values: [] })] }] });
    });
    const result = await runCustomerDossierTurn({ ...base, withConnection: withConnection(items), analyze,
      route: routed([planTask({ type: "document", kind: "quotation" }),
        planTask({ type: "limit", kind: "financial_data", focusLevel: "none", opportunityIds: [] })]) });
    expect(result.response.presentation.status).toBe("completed");
    expect(result.response.dossierCitations.map((citation) => citation.label)).toEqual(["Cotización 78 · versión 1 · partida"]);
    expect(result.response.answer).toContain("aún no está disponible en este chat");
    expect(result.response.turnTasks.map((task) => `${task.type}:${task.kind}`)).toEqual(["document:quotation", "limit:financial_data"]);
  });

  it("responde la parte no ejecutable de un turno mixto y delega solo las acciones", async () => {
    const plan = rawPlan({ tasks: [planTask(), planTask({ type: "action", kind: "schedule_activity", dependsOn: [1] })] });
    const routed = async () => ({ ...validateRoute(plan, { question: base.question, opportunityIds: [121, 117] }), attempts: [] });
    const analyze = vi.fn(async () => analysis());
    const result = await runCustomerDossierTurn({ ...base, withConnection: withConnection(), route: routed, analyze });
    expect(result).toMatchObject({ handled: false, reason: "mode_action",
      plan: { tasks: [{ id: "t2", type: "action", dependsOn: [] }] },
      partial: { handled: true, response: { answer: analysis().answerText, turnTasks: [{ type: "consult" }] } } });
    expect(actionOnlyPlan(null)).toBeNull();
    const combined = combineDossierAndActionResponse(result.partial.response, {
      answer: "Preparé la llamada; confírmala para guardarla.", responseType: "operation", operations: [{ kind: "activity" }],
      presentation: { status: "completed", auditedAnswer: "Preparé la llamada; confírmala para guardarla." },
      components: [{ id: "c1", category: "action.schedule_activity", status: "completed" }] });
    expect(combined).toMatchObject({ responseType: "operation", operations: [{ kind: "activity" }],
      answer: `${analysis().answerText}\n\nPreparé la llamada; confírmala para guardarla.`,
      presentation: { engine: "mixed", actionAnswer: "Preparé la llamada; confírmala para guardarla.", dossierPart: { status: "completed" } } });
    expect(combined.turnTasks.map((task) => task.type)).toEqual(["consult", "action"]);
  });

  it("no prepara un cambio de etapa condicionado a la revisión del mismo turno", async () => {
    const plan = rawPlan({ tasks: [planTask({ kind: "readiness" }), planTask({ type: "action", kind: "change_stage", dependsOn: [1] })] });
    const routed = async () => ({ ...validateRoute(plan, { question: base.question, opportunityIds: [121, 117] }), attempts: [] });
    const result = await runCustomerDossierTurn({ ...base, withConnection: withConnection(), route: routed, analyze: vi.fn(async () => analysis()) });
    expect(result.handled).toBe(true);
    expect(result.response.answer).toContain("No preparé la solicitud de cambio de etapa");
    expect(result.response.turnTasks.map((task) => `${task.type}:${task.status}`)).toEqual(["consult:completed", "action:deferred"]);
    const explicit = rawPlan({ tasks: [planTask({ kind: "readiness" }), planTask({ type: "action", kind: "change_stage" })] });
    const both = await runCustomerDossierTurn({ ...base, withConnection: withConnection(), analyze: vi.fn(async () => analysis()),
      route: async () => ({ ...validateRoute(explicit, { question: base.question, opportunityIds: [121, 117] }), attempts: [] }) });
    expect(both).toMatchObject({ handled: false, plan: { tasks: [{ type: "action", kind: "change_stage" }] } });
  });

  it("rechaza un foco que no pertenece a la cuenta", async () => {
    await expect(runCustomerDossierTurn({ ...base, focusOpportunityId: 999, withConnection: withConnection(), route: vi.fn(), analyze: vi.fn() }))
      .rejects.toMatchObject({ status: 404, code: "DOSSIER_FOCUS_UNAVAILABLE" });
  });

  it("responde con citas verificadas, memoria del foco y traza", async () => {
    const routeTurn = vi.fn(async () => ({ route: route(), droppedFilters: [], attempts: [{ issues: [] }] }));
    const analyze = vi.fn(async () => analysis());
    const result = await runCustomerDossierTurn({ ...base, focusOpportunityId: 121, withConnection: withConnection(), route: routeTurn, analyze });
    expect(routeTurn.mock.calls[0][0].context).toMatchObject({ today: "2026-10-23", selectedOpportunity: { id: 121, name: "Sealpath" } });
    expect(analyze.mock.calls[0][0].context.dossiers.map((dossier) => dossier.kind)).toEqual(["account", "opportunity"]);
    expect(result).toMatchObject({ handled: true, response: { responseType: "informational", presentation: { status: "completed", engine: "dossier" } } });
    expect(result.response.dossierCitations.map((citation) => citation.label)).toEqual(
      expect.arrayContaining(["Oportunidad Sealpath", "Cotización 78 · versión 1"]));
    // Every marker points to a position in the answer text and to citations that exist in the list shown.
    const { citationAnchors, dossierCitations, answer } = result.response;
    expect(citationAnchors.length).toBeGreaterThan(0);
    for (const anchor of citationAnchors) {
      expect(answer.slice(anchor.end - anchor.quote.length, anchor.end)).toBe(anchor.quote);
      expect(anchor.citations.every((number) => number >= 1 && number <= dossierCitations.length)).toBe(true);
    }
    expect(result.memory).toMatchObject({ level: "opportunity", focusOpportunityIds: [121], obligations: [{ id: "o1", ask: "Importe y cotización" }] });
    expect(buildDossierQualityTrace(result)).toMatchObject({ intentType: "dossier_consult", validationStatus: "valid", evidenceCount: 2 });
  });

  it("repara una vez con los fallos concretos y degrada de forma visible si persisten", async () => {
    const routeTurn = async () => ({ route: route(), droppedFilters: [], attempts: [] });
    const invalid = analysis({ blocks: [{ obligationId: "o1", status: "answered", reason: "", items: [], claims: [claim({ evidenceIds: ["opp999"] })] }] });
    const repaired = vi.fn().mockResolvedValueOnce(invalid).mockResolvedValueOnce(analysis());
    const ok = await runCustomerDossierTurn({ ...base, withConnection: withConnection(), route: routeTurn, analyze: repaired });
    expect(repaired).toHaveBeenCalledTimes(2);
    expect(repaired.mock.calls[1][0].context.repair.failures[0]).toMatchObject({ code: "UNKNOWN_EVIDENCE" });
    expect(ok.response.presentation.status).toBe("completed");
    const failing = await runCustomerDossierTurn({ ...base, withConnection: withConnection(), route: routeTurn,
      analyze: vi.fn().mockResolvedValue(invalid) });
    expect(failing.response.presentation).toMatchObject({ status: "degraded", reasonCode: "DOSSIER_VERIFICATION_INCOMPLETE" });
    expect(failing.response.answer).toContain("No pude verificar por completo con los registros del CRM");
    expect(buildDossierQualityTrace(failing)).toMatchObject({ validationStatus: "invalid",
      validationReasons: ["UNKNOWN_EVIDENCE", "VALUE_WITHOUT_EVIDENCE"] });
  });

  it("repara la presentación sin marcarla como no verificada ni perder la verificación factual", async () => {
    const routeTurn = async () => ({ route: route({ responseLength: "brief" }), droppedFilters: [], attempts: [] });
    const jargon = analysis({ answerText: "Según el expediente, el importe es 8,000 USD." });
    const fixed = vi.fn().mockResolvedValueOnce(jargon).mockResolvedValueOnce(analysis());
    const result = await runCustomerDossierTurn({ ...base, withConnection: withConnection(), route: routeTurn, analyze: fixed });
    expect(fixed.mock.calls[1][0].context.repair.failures[0]).toMatchObject({ code: "INTERNAL_TERMS" });
    expect(fixed.mock.calls[0][0].context.responseLength).toBe("brief");
    expect(result.response).toMatchObject({ presentation: { status: "completed" }, answer: analysis().answerText });
    expect(result.response.dossierSources[0]).toMatchObject({ kind: "account", id: 163 });
    expect(result.response.dossierSources[0].sections).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "contacts", status: "loaded" })]));
    const broken = analysis({ blocks: [{ obligationId: "o1", status: "answered", reason: "", items: [], claims: [claim({ evidenceIds: ["opp999"] })] }] });
    const worse = vi.fn().mockResolvedValueOnce(jargon).mockResolvedValueOnce(broken);
    const kept = await runCustomerDossierTurn({ ...base, withConnection: withConnection(), route: routeTurn, analyze: worse });
    expect(kept.response).toMatchObject({ presentation: { status: "completed" }, answer: jargon.answerText });
  });

  it("devuelve la aclaración del enrutador sin leer expedientes de oportunidad", async () => {
    const result = await runCustomerDossierTurn({ ...base, withConnection: withConnection(), analyze: vi.fn(),
      route: async () => ({ route: route({ mode: "clarify", clarificationQuestion: "¿De qué oportunidad hablas?",
        clarificationOptions: [{ label: "Sealpath", opportunityId: 121 }, { label: "Correo", opportunityId: 117 }] }), droppedFilters: [], attempts: [] }) });
    expect(result.response).toMatchObject({ responseType: "clarification", answer: "¿De qué oportunidad hablas?\n- Sealpath\n- Correo" });
  });

  it("no inventa el foco si la lista de oportunidades no se leyó completa", async () => {
    await expect(runCustomerDossierTurn({ ...base, route: vi.fn(), analyze: vi.fn(),
      withConnection: withConnection({ "FROM opportunities o\n       INNER JOIN": () => { throw new Error("db"); } }) }))
      .rejects.toMatchObject({ code: "DOSSIER_ACCOUNT_OPPORTUNITIES_UNAVAILABLE" });
  });

  it("convierte fallos técnicos en errores comprensibles y los registra", async () => {
    const routeTurn = async () => ({ route: route(), droppedFilters: [], attempts: [] });
    await expect(runCustomerDossierTurn({ ...base, withConnection: withConnection(), route: routeTurn,
      analyze: async () => { throw new Error("OpenAI web search failed: 400 {\"error\":\"bad request\"}"); } }))
      .rejects.toMatchObject({ code: "DOSSIER_ENGINE_FAILED", message: "No pude completar la consulta con los registros del CRM. Intenta nuevamente." });
    await expect(runCustomerDossierTurn({ ...base, withConnection: withConnection(), route: routeTurn,
      analyze: async () => { throw Object.assign(new Error("aborted"), { name: "TimeoutError" }); } }))
      .rejects.toMatchObject({ code: "DOSSIER_TURN_TIMEOUT" });
    expect(consoleError).toHaveBeenCalledWith("[dossier] Turn failed", expect.objectContaining({ jobId: 9 }));
  });

  it("conserva el aviso de saldo agotado y reintenta una vez un fallo transitorio del proveedor", async () => {
    const routeTurn = async () => ({ route: route(), droppedFilters: [], attempts: [] });
    await expect(runCustomerDossierTurn({ ...base, withConnection: withConnection(), route: routeTurn,
      analyze: async () => { throw Object.assign(new Error("No tienes saldo disponible para ejecutar funciones de IA."), { code: "AI_BUDGET_EXCEEDED", status: 402 }); } }))
      .rejects.toMatchObject({ code: "AI_BUDGET_EXCEEDED", message: "No tienes saldo disponible para ejecutar funciones de IA." });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const flaky = vi.fn().mockRejectedValueOnce(new Error("OpenAI web search failed: 504 <html>")).mockResolvedValueOnce(analysis());
    const result = await runCustomerDossierTurn({ ...base, withConnection: withConnection(), route: routeTurn, analyze: flaky });
    expect(flaky).toHaveBeenCalledTimes(2);
    expect(result.diagnostics.transientRetries).toEqual(["analyst"]);
    const failing = vi.fn().mockRejectedValue(new Error("OpenAI web search failed: 504 <html>"));
    await expect(runCustomerDossierTurn({ ...base, withConnection: withConnection(), route: routeTurn, analyze: failing }))
      .rejects.toMatchObject({ code: "DOSSIER_ENGINE_FAILED" });
    expect(failing).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("no reintenta y explica el límite de gasto del proveedor de IA", async () => {
    const routeTurn = async () => ({ route: route(), droppedFilters: [], attempts: [] });
    const quota = vi.fn().mockRejectedValue(new Error(
      'OpenAI web search failed: 429 {"error":{"type":"insufficient_quota","code":"organization_spend_limit_exceeded"}}'));
    await expect(runCustomerDossierTurn({ ...base, withConnection: withConnection(), route: routeTurn, analyze: quota }))
      .rejects.toMatchObject({ code: "DOSSIER_PROVIDER_QUOTA_EXCEEDED", message: expect.stringContaining("límite de gasto") });
    expect(quota).toHaveBeenCalledTimes(1);
  });
});

describe("memoria, historial y citas", () => {
  it("valida la memoria del motor contra las oportunidades visibles", () => {
    const snapshot = { account: { id: 163 }, opportunities: [{ id: 121, accountId: 163 }] };
    const context = validateCustomerConversationContext({ accountId: 163, dossierMemory: {
      level: "opportunities", focusOpportunityIds: [121, 999], obligations: [{ id: "o1", ask: "x".repeat(400) }],
      citedEvidenceIds: ["opp121", "bad id", "ans1097"] } }, snapshot, 163);
    expect(context.dossierMemory).toMatchObject({ level: "opportunities", focusOpportunityIds: [121], citedEvidenceIds: ["opp121", "ans1097"] });
    expect(context.dossierMemory.obligations[0].ask).toHaveLength(300);
  });

  it("conserva las citas en el historial del chat", () => {
    const history = appendCustomerAccountChatHistory([], "pregunta", "respuesta", {
      presentation: { status: "completed", engine: "dossier" }, dossierCitations: [{ evidenceId: "act51", label: "Actividad" }] });
    expect(history[1]).toMatchObject({ role: "assistant", dossierCitations: [{ evidenceId: "act51" }] });
    expect(appendCustomerAccountChatHistory(history, "otra", "más")[1].dossierCitations).toHaveLength(1);
  });

  it("conserva los marcadores de citas en el historial y limita su cantidad", () => {
    const anchors = Array.from({ length: 80 }, (_, index) => ({ start: index, end: index + 5, quote: "texto", citations: [1] }));
    const history = appendCustomerAccountChatHistory([], "pregunta", "respuesta", { citationAnchors: anchors });
    expect(history[1].citationAnchors).toHaveLength(60);
    expect(appendCustomerAccountChatHistory([], "pregunta", "respuesta", {})[1]).not.toHaveProperty("citationAnchors");
  });

  it("describe cada tipo de evidencia de forma legible", () => {
    expect(describeCitation({ evidenceId: "ans982", stageName: "Identificación", current: false, answerValue: "Noviembre" }))
      .toMatchObject({ label: "Respuesta de etapa Identificación (sustituida)", excerpt: "Noviembre" });
    expect(describeCitation({ evidenceId: "audit5", createdAt: "2026-07-02", changes: [{ label: "estado comercial", before: "En proceso", after: "Ganada" }] }))
      .toMatchObject({ excerpt: "estado comercial: En proceso → Ganada" });
  });
});
