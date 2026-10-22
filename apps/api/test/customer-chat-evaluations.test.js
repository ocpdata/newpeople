import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { CATEGORIES, getEvaluationCatalog, parseCatalog } from "../src/customer-chat-evaluations/catalog.js";
import { evaluateResponse, evaluationStepBlockReason, evaluationReferenceBlockReason, safeEvidence, summarizeCases } from "../src/customer-chat-evaluations/checks.js";
import { businessImpactForCase } from "../src/customer-chat-evaluations/business-impact.js";

describe("Customer chat evaluation catalog", () => {
  it("covers all 46 categories and every documented table/sequence ID", async () => {
    const catalog = await getEvaluationCatalog();
    const source = await readFile(new URL("../../../readme/preguntas-validacion-chat-cliente-existente.md", import.meta.url), "utf8");
    const ids = [...source.matchAll(/^\| ((?:[QGCRA]\d{2}-\d{2}|K\d{2}|MIX\d{2}|L\d{2})) \|/gm)].map((match) => match[1]);
    expect(CATEGORIES).toHaveLength(46);
    for (const category of CATEGORIES) expect(catalog.cases.some((item) => item.category === category)).toBe(true);
    for (const id of ids) expect(catalog.cases.find((item) => item.id === id)).toBeDefined();
    expect(catalog.cases.filter((item) => item.category === "SEQ")).toHaveLength(15);
    expect(catalog.cases).toHaveLength(212);
    expect(new Set(catalog.cases.map((item) => item.id)).size).toBe(catalog.cases.length);
    expect(catalog.version).toMatch(/^[a-f0-9]{16}$/);
  });
  it("preserves the first turn and resolves referenced steps", async () => {
    const { cases } = await getEvaluationCatalog();
    expect(cases.find((item) => item.id === "SEQ01").steps).toHaveLength(3);
    expect(cases.find((item) => item.id === "SEQ06").steps).toHaveLength(4);
    expect(cases.find((item) => item.id === "K08").steps).toHaveLength(2);
    expect(cases.find((item) => item.id === "SEQ06").steps[0].question).toBe(cases.find((item) => item.id === "C01-01").steps[0].question);
    expect(cases.every((item) => item.steps.every((step) => typeof step.question === "string"))).toBe(true);
  });
  it("uses account 65 for Grupo Hotelero Santa Fe without changing Totalplay or smoke cases", async () => {
    const catalog = await getEvaluationCatalog();
    expect(catalog.cases.filter((item) => item.accountId === 65).map((item) => item.id)).toEqual(["Q01-03", "G01-03"]);
    expect(catalog.cases.some((item) => item.accountId === 2)).toBe(false);
    expect(catalog.cases.filter((item) => catalog.smokeCaseIds.includes(item.id)).every((item) => item.accountId === 22)).toBe(true);
  });
  it("reports preparation gaps rather than pretending fault injection or UI was exercised", async () => {
    const { cases } = await getEvaluationCatalog();
    for (const id of ["K10", "K11", "K12", "SEQ08", "A08-09"]) {
      expect(cases.find((item) => item.id === id).blockedReason).toBeTruthy();
    }
  });
  it("runs SEQ04 with a conditional activity draft check instead of omitting its first turn", async () => {
    const { cases } = await getEvaluationCatalog();
    const sequence = cases.find((item) => item.id === "SEQ04");
    expect(sequence.blockedReason).toBeFalsy();
    expect(sequence.steps).toHaveLength(3);
    expect(sequence.steps[0].question).toBe(cases.find((item) => item.id === "A05-01").steps[0].question);
    expect(sequence.steps[1]).toMatchObject({
      question: "Mejor a las 11:00, conserva el resto", requiresCompleteActivityDraft: true,
    });
  });
  it("includes supplied material and all literal alternatives as independent variants", async () => {
    const { cases } = await getEvaluationCatalog();
    expect(cases.find((item) => item.id === "K09").steps[0].question).toContain("Hardware Refresh pertenece a Totalplay");
    expect(cases.find((item) => item.id === "A08-08.v2").steps[0].question).toBe("Retrocede");
  });
  it("fails explicitly if the document loses required coverage", () => {
    expect(() => parseCatalog("| Q01-01 | «Hola» | Saludo |")).toThrow("categorías sin casos");
  });
  it("classifies individual business effects without treating every action category as a write", async () => {
    const catalog = await getEvaluationCatalog();
    expect(catalog.cases.every((item) => item.businessImpact?.label && item.businessImpact.description)).toBe(true);
    for (const id of ["A01-03", "A02-03", "A04-03", "A08-01", "A08-03", "A08-06", "A08-08.v2", "A08-11", "A09-01", "A10-01", "MIX06"]) {
      expect(businessImpactForCase(id).kind, id).toBe("none");
    }
    for (const id of ["A02-01", "A03-01", "A04-01", "A06-01", "A07-01", "SEQ05"]) {
      expect(businessImpactForCase(id).kind, id).toBe("confirm");
    }
    for (const id of ["A01-01", "A05-01", "A07-03", "SEQ04"]) expect(businessImpactForCase(id).kind, id).toBe("module");
    for (const id of ["A08-02", "A08-04", "A08-07.v2"]) expect(businessImpactForCase(id).kind, id).toBe("validation");
    expect(businessImpactForCase("A08-12").kind).toBe("form");
    expect(businessImpactForCase("K05").kind).toBe("confirm");
    expect(catalog.smokeCaseIds).toHaveLength(10);
    expect(catalog.cases.filter((item) => catalog.smokeCaseIds.includes(item.id) && item.businessImpact.kind !== "none")
      .map((item) => item.id)).toEqual(["A08-04"]);
    expect(catalog.operationBusinessImpacts.validate_stage.kind).toBe("validation");
    expect(catalog.operationBusinessImpacts.activity.kind).toBe("module");
    expect(catalog.operationBusinessImpacts.opportunity_field.kind).toBe("confirm");
    expect(catalog.operationBusinessImpacts.remove_record).toBeUndefined();
  });
  it("includes new regressions, preparation and literal multiline expectations in the tab catalog", async () => {
    const catalog = await getEvaluationCatalog();
    for (const id of ["Q09-04", "Q09-05", "Q09-07", "MIX09", "SEQ11", "SEQ13", "SEQ15"]) {
      expect(catalog.cases.find((item) => item.id === id)).toMatchObject({
        requiresBluecatLibrary: true, readOnlyRegression: true,
      });
    }
    for (const id of ["K13", "K14", "K15", "K16", "K17", "K18"]) {
      expect(catalog.cases.find((item) => item.id === id).blockedReason).toContain("Regresión técnica");
    }
    expect(catalog.cases.find((item) => item.id === "SEQ12").steps).toHaveLength(3);
    expect(catalog.cases.find((item) => item.id === "SEQ13").steps).toHaveLength(2);
    expect(catalog.cases.find((item) => item.id === "SEQ04").steps[2].expected).toContain("actividad persistida 75");
    expect(catalog.smokeCaseIds).toEqual(expect.arrayContaining(["Q09-04", "SEQ12", "L09"]));
  });
});
describe("Customer chat evaluation checks", () => {
  it.each(["Q02-02", "Q03-03"])("runs contact questions regardless of matches or registered job titles: %s", (id) => {
    const coverage = [{ source: "contacts", truncated: false, errorCode: null }];
    const reference = { contacts: [{ id: 500, name: "Alejandro Ruiz", positionTitle: "" }], coverage };
    expect(evaluationReferenceBlockReason({ id }, reference)).toBeNull();
    expect(evaluationReferenceBlockReason({ id }, { ...reference, contacts: [] })).toBeNull();
    expect(evaluationReferenceBlockReason({ id }, { ...reference, contacts: [
      { id: 232, name: "Luis Becerra", positionTitle: "" },
    ] })).toBeNull();
    expect(evaluationReferenceBlockReason({ id }, { ...reference, contacts: [
      { ...reference.contacts[0], positionTitle: "Director" },
    ] })).toBeNull();
    expect(evaluationReferenceBlockReason({ id }, { ...reference,
      contacts: [reference.contacts[0], { ...reference.contacts[0], id: 501 }],
    })).toBeNull();
    expect(evaluationReferenceBlockReason({ id }, { ...reference, coverage: [] })).toContain("lectura completa");
    expect(evaluationReferenceBlockReason({ id }, { ...reference, coverage: [{ source: "contacts", truncated: true }] }))
      .toContain("lectura completa");
  });
  it("does not accept a generic clarification as an answer about a missing contact job title", () => {
    const definition = { id: "Q03-03" };
    const reference = { contacts: [{ id: 500, name: "Alejandro Ruiz", positionTitle: "" }] };
    const result = { answer: "Alejandro Ruiz\n- Cargo: no informado", responseType: "informational",
      entities: { accountId: 22, contactId: 500 }, operations: [],
      components: [{ category: "query.field_value", status: "completed" }] };
    expect(evaluateResponse({ definition, result, reference, accountId: 22 }).outcome).toBe("human_review");
    expect(evaluateResponse({ definition, result: { ...result, responseType: "clarification",
      answer: "No pude validar el registro seleccionado" }, reference, accountId: 22 }).outcome).toBe("failed");
  });
  it.each(["Q02-02", "Q03-03"])("evaluates a verified missing contact instead of requiring a fixture: %s", (id) => {
    const definition = { id };
    const reference = { contacts: [{ id: 232, name: "Luis Becerra" }] };
    const result = {
      answer: "No encontré un contacto llamado Alejandro Ruiz entre los registros visibles de Totalplay. ¿Está registrado con otro nombre?",
      responseType: "clarification", operations: [], entities: { accountId: 22 },
      evidence: ["searchContacts: 0 coincidencias en la cuenta autorizada."],
    };
    const evaluate = (patch) => evaluateResponse({ definition, reference, accountId: 22, result: { ...result, ...patch } });
    expect(evaluate().outcome).toBe("human_review");
    expect(evaluate({ responseType: "informational" }).outcome).toBe("human_review");
    expect(evaluate({ evidence: [] }).outcome).toBe("failed");
    expect(evaluate({ answer: "Indica el contacto que quieres consultar." }).outcome).toBe("failed");
    expect(evaluate({ answer: "No pude consultar los contactos de Totalplay." }).outcome).toBe("failed");
    expect(evaluate({ entities: { contactId: 232 } }).outcome).toBe("failed");
    expect(evaluate({ answer: `${result.answer}\nCargo: Director` }).outcome).toBe("failed");
    expect(evaluate({ operations: [{ kind: "contact_field", accountId: 22 }] }).outcome).toBe("failed");
  });
  it.each(["Q02-02", "Q03-03"])("evaluates duplicate contacts without choosing one: %s", (id) => {
    const reference = { contacts: [500, 501].map((contactId) => ({ id: contactId, name: "Alejandro Ruiz" })) };
    const result = { answer: "Encontré dos contactos Alejandro Ruiz en Totalplay. ¿Cuál deseas consultar?",
      responseType: "clarification", operations: [], entities: { accountId: 22 } };
    expect(evaluateResponse({ definition: { id }, reference, accountId: 22, result }).outcome).toBe("human_review");
    expect(evaluateResponse({ definition: { id }, reference, accountId: 22,
      result: { ...result, entities: { contactId: 500 } } }).outcome).toBe("failed");
  });
  it.each(["Q02-02", "Q03-03"])("checks the current job title when the contact has one: %s", (id) => {
    const reference = { contacts: [{ id: 500, name: "Alejandro Ruiz", positionTitle: "Supervisor" }] };
    const result = { answer: "Alejandro Ruiz\n- Cargo: Supervisor", responseType: "informational", operations: [],
      entities: { accountId: 22, contactId: 500 },
      components: [{ category: id === "Q02-02" ? "query.record_detail" : "query.field_value", status: "completed" }] };
    expect(evaluateResponse({ definition: { id }, reference, accountId: 22, result }).outcome).toBe("human_review");
    expect(evaluateResponse({ definition: { id }, reference, accountId: 22,
      result: { ...result, answer: "Alejandro Ruiz\n- Cargo: No informado" } }).outcome).toBe("failed");
  });
  it("rejects an association with opportunities when the reference has no opportunities", () => {
    const definition = { id: "Q01-03" };
    const result = { answer: "1 contacto visible. Asociados a esas oportunidades: Luis", responseType: "informational",
      entities: { accountId: 65 }, operations: [] };
    expect(evaluateResponse({ definition, result, reference: { opportunities: [] }, accountId: 65 }).outcome).toBe("failed");
    expect(evaluateResponse({ definition, result: { ...result, answer: "Contactos de la cuenta: Luis" },
      reference: { opportunities: [] }, accountId: 65 }).outcome).toBe("human_review");
  });
  it("requires validated question counts rather than assuming one component meets the requested quantity", () => {
    const definition = { id: "L10", readOnlyRegression: true };
    const component = { category: "content.discovery_questions", status: "completed",
      contentValidation: { reasonCode: "approved", requestedQuestionCount: 3, actualQuestionCount: 3 } };
    const result = { answer: "Tres preguntas", operations: [], components: [component],
      debug: { flow: [{ block: "B12", input: { requested: false }, output: { status: "not_applicable", snippetsCount: 0 } }] } };
    expect(evaluateResponse({ definition, result, accountId: 22 }).outcome).toBe("human_review");
    expect(evaluateResponse({ definition, result: { ...result, components: [{
      ...component, contentValidation: { ...component.contentValidation, actualQuestionCount: 2 },
    }] }, accountId: 22 }).outcome).toBe("failed");
  });
  it("evaluates the current sequence step rather than carrying notes into a field request", () => {
    const definition = { id: "SEQ12", readOnlyRegression: true };
    const result = { answer: "Fecha registrada", operations: [],
      debug: { flow: [{ block: "B12", input: { requested: false }, output: { status: "not_applicable", snippetsCount: 0 } }] },
      components: [
      { category: "query.field_value", status: "completed" },
    ] };
    const good = evaluateResponse({ definition, result, accountId: 22, stepIndex: 1 });
    expect(good.outcome).toBe("human_review");
    expect(evaluateResponse({ definition, result, accountId: 22, stepIndex: 0 }).outcome).toBe("failed");
    expect(evaluateResponse({ definition, accountId: 22, stepIndex: 1,
      result: { ...result, operations: [{ kind: "record_note" }] } }).outcome).toBe("failed");
  });
  it("does not approve a positive library case on an empty-library response or missing provenance", () => {
    const definition = { id: "Q09-04", readOnlyRegression: true };
    const result = { answer: "Capacidades generales con evidencia", responseType: "informational", operations: [],
      contentSource: "knowledge_library",
      debug: { flow: [{ block: "B12", input: { requested: true }, output: { status: "results", snippetsCount: 2 } }] },
      components: [{ category: "query.document_content", status: "completed" }] };
    expect(evaluateResponse({ definition, result, accountId: 22 }).outcome).toBe("human_review");
    expect(evaluateResponse({ definition, result: { ...result, answer: "No hay documentos activos disponibles" }, accountId: 22 }).outcome).toBe("failed");
    expect(evaluateResponse({ definition, result: { ...result, contentSource: "user_provided" }, accountId: 22 }).outcome).toBe("failed");
    expect(evaluateResponse({ definition, result: { ...result, debug: {} }, accountId: 22 }).outcome).toBe("failed");
  });
  it("requires an absent attachment clarification without inherited library provenance", () => {
    const definition = { id: "SEQ13", readOnlyRegression: true };
    const result = { answer: "Comparte el archivo", responseType: "clarification", operations: [],
      debug: { flow: [{ block: "B12", input: { requested: false }, output: { status: "not_applicable", snippetsCount: 0 } }] } };
    expect(evaluateResponse({ definition, result, stepIndex: 1, accountId: 22 }).outcome).toBe("human_review");
    expect(evaluateResponse({ definition, result: { ...result, contentSource: "knowledge_library" },
      stepIndex: 1, accountId: 22 }).outcome).toBe("failed");
  });
  it("requires a verified quotation summary as well as completed questions for MIX07", () => {
    const result = {
      answer: "Resumen y preguntas", responseType: "informational", operations: [],
      components: [{ category: "query.document_content", status: "completed" },
        { category: "content.discovery_questions", status: "completed" }],
    };
    const check = (value) => evaluateResponse({ definition: { id: "MIX07" }, accountId: 22, result: value })
      .checks.find((item) => item.name === "Resumen y preguntas como entregables separados");
    expect(check(result).passed).toBe(false);
    expect(check({ ...result, documentMemory: { quotationId: 18 } }).passed).toBe(true);
  });
  it("fails a mixed answer with a component error even when its global type is clarification", () => {
    const evaluated = evaluateResponse({
      definition: { id: "MIX04" }, accountId: 22,
      result: { answer: "Resumen y aclaración; la agenda falló.", responseType: "clarification", operations: [],
        components: [{ category: "query.account_summary", status: "completed" },
          { category: "content.email_draft", status: "clarification" },
          { category: "content.meeting_preparation", status: "error" }] },
    });
    expect(evaluated.checks.find((check) => check.name === "Sin error de chat").passed).toBe(false);
  });
  const conditionalStep = { requiresCompleteActivityDraft: true };
  const completeDraft = {
    responseType: "operation", evaluationOutcome: "human_review",
    operations: [{
      kind: "activity", accountId: 22, opportunityId: 37, contactId: 13,
      title: "Llamada", actionType: "call", successCriteria: "Confirmar el siguiente paso",
      scheduledAt: "2026-10-20T10:00", missingFields: [],
    }],
  };
  it("allows modification only after a complete activity draft", () => {
    expect(evaluationStepBlockReason(conditionalStep, completeDraft, 22)).toBeNull();
    expect(evaluationStepBlockReason({}, undefined, 22)).toBeNull();
  });
  it.each([
    undefined,
    { responseType: "clarification", operations: [] },
    { ...completeDraft, evaluationOutcome: "failed" },
    { ...completeDraft, evaluationOutcome: "inconclusive" },
    { ...completeDraft, operations: [] },
    { ...completeDraft, operations: [...completeDraft.operations, ...completeDraft.operations] },
    ...[
      { accountId: 65 }, { scheduledAt: "" }, { scheduledAt: "2026-02-30T10:00" },
      { missingFields: ["scheduledAt"] }, { contactId: null }, { opportunityId: null },
      { successCriteria: "" },
    ].map((patch) => ({ ...completeDraft, operations: [{ ...completeDraft.operations[0], ...patch }] })),
  ])("reports an unmet draft precondition instead of sending a fabricated continuation: %j", (previous) => {
    expect(evaluationStepBlockReason(conditionalStep, previous, 22)).toContain("Precondición incumplida");
  });
  const check = (result, patch = {}) => evaluateResponse({ definition: { id: "Q01-03", category: "Q01" }, result, accountId: 22, ...patch });
  it("never approves merely because the model returned text", () => {
    expect(check({ answer: "Una respuesta", operations: [] }).outcome).toBe("human_review");
  });
  it("recognizes Q02-02 contact evidence from the resolved entity ID", () => {
    const definition = { id: "Q02-02", category: "Q02" };
    const result = {
      answer: "- Nombre: Alejandro Ruiz\n- Cuenta: Totalplay\n- Cargo: No informado",
      responseType: "informational",
      components: [{ category: "query.record_detail", status: "completed" }],
      entities: { accountId: 22, contactId: 232, opportunityId: null },
      operations: [],
    };
    const reference = { contacts: [{ id: 232, name: "Alejandro Ruiz", positionTitle: "" }] };
    expect(evaluateResponse({ definition, result, reference, accountId: 22 }).outcome).toBe("human_review");
    expect(evaluateResponse({ definition, result: {
      ...result, answer: "- Nombre: Alejandro Ruiz\n- Cuenta: Totalplay\n- Cargo: No aparece registrado",
    }, reference, accountId: 22 }).outcome).toBe("human_review");
    expect(evaluateResponse({ definition, result: {
      ...result, answer: "- Nombre: Alejandro Ruiz\n- Cuenta: Totalplay\n- Cargo: No indicado en el registro",
    }, reference, accountId: 22 }).outcome).toBe("human_review");
    expect(evaluateResponse({ definition, result: { ...result, entities: { ...result.entities, contactId: 999 } },
      reference, accountId: 22 }).outcome).toBe("failed");
  });
  it.each([
    ["Q01-01", "Q01", "Resumen de Totalplay: 8 oportunidades."],
    ["Q01-02", "Q01", "Resumen de Totalplay: 8 oportunidades."],
    ["Q02-03", "Q02", "Detalle de Hardware Refresh."],
    ["Q06-01", "Q06", "El historial admite cuenta, oportunidad o contacto."],
    ["Q06-02", "Q06", "5 eventos recuperados."],
    ["Q08-03", "Q08", "Kimberly es el contacto asociado registrado."],
    ["Q10-02", "Q10", "Resumen de Totalplay: 0 oportunidades."],
    ["Q11-02", "Q11", "No hay un documento aportado."],
  ])("rejects the observed semantic failure in %s", (id, category, answer) => {
    expect(check({ answer, responseType: "informational", operations: [] }, {
      definition: { id, category },
    }).outcome).toBe("failed");
  });
  it("rejects the reported planner fallback even when mislabeled as clarification", () => {
    const result = check({ answer: "No pude interpretar la solicitud con el planificador nuevo. No consulté el CRM; reformula la pregunta o inténtalo más tarde.",
      responseType: "clarification", operations: [] }, { definition: { id: "A10-01", category: "A10" } });
    expect(result.outcome).toBe("failed");
    expect(result.checks.find((item) => item.name === "Sin fallo técnico presentado como aclaración").passed).toBe(false);
  });
  it("requires the requested email subject without treating a greeting as a complete draft", () => {
    const definition = { id: "C01-01", category: "C01" };
    expect(check({ answer: "Estimada Kimberly,\nQuisiera confirmar el siguiente paso.\nSaludos.", operations: [] }, { definition }).outcome).toBe("failed");
    expect(check({ answer: "Asunto: Seguimiento de Hardware Refresh\nEstimada Kimberly,\n¿Cuál sería el siguiente paso?\nSaludos.", operations: [] }, { definition }).outcome).toBe("human_review");
  });
  it.each([{ capabilityStatus: "disabled" }, { components: [{ status: "permission_denied" }] }])(
    "marks blocked capabilities inconclusive, not positive acceptance: %j", (blocked) => {
      expect(check({ answer: "Capacidad no disponible.", operations: [], ...blocked }).outcome).toBe("inconclusive");
    });
  it("does not let a blocked component hide an error in the same response", () => {
    expect(check({ answer: "Falló el procesamiento.", responseType: "error",
      operations: [], components: [{ status: "disabled" }] }).outcome).toBe("failed");
  });
  it.each([null, {}, { answer: "" }, { answer: "Error", responseType: "error" }, { answer: "Ok", operations: {} }])(
    "rejects empty, failed and malformed responses %j", (result) => expect(check(result).outcome).toBe("failed"),
  );
  it("rejects cross-account proposals", () => {
    expect(check({ answer: "Listo", operations: [{ accountId: 25 }] }).outcome).toBe("failed");
  });
  it.each(["A09", "A10", "Q11"])("requires containment for %s", (category) => {
    expect(check({ answer: "Listo", operations: [{ kind: "activity", accountId: 22 }] },
      { definition: { id: `${category}-01`, category } }).outcome).toBe("failed");
  });
  it.each([["A09", "action.remove_record"], ["A10", "action.send_communication"]])(
    "requires unavailable capability recognition for %s instead of accepting an unrelated draft", (category, intent) => {
      const definition = { id: `${category}-01`, category };
      expect(check({ answer: "Aquí tienes un correo.", operations: [],
        components: [{ category: "content.email_draft", status: "completed" }] }, { definition }).outcome).toBe("failed");
      expect(check({ answer: "Esa acción no está disponible; puedo ayudarte a preparar una alternativa.", operations: [],
        components: [{ category: intent, status: "unavailable" }] }, { definition }).outcome).toBe("human_review");
    });
  it.each(["500.000,00 USD", "USD 500,000.00", "500000 dólares"])("compares the current authorized amount for %s", (answer) => {
    const result = check({ answer, operations: [] }, { definition: { id: "Q03-01", category: "Q03" },
      reference: { opportunities: [{ name: "Hardware Refresh", amountUsd: 500000 }] } });
    expect(result.checks.every((item) => item.passed)).toBe(true);
  });
  it("does not accept a stale documented amount when the record changed", () => {
    const result = check({ answer: "USD 500,000.00", operations: [] }, { definition: { id: "Q03-01", category: "Q03" },
      reference: { opportunities: [{ name: "Hardware Refresh", amountUsd: 600000 }] } });
    expect(result.outcome).toBe("failed");
  });
  it("redacts secrets and makes evidence limits explicit without dropping exported cases", () => {
    const result = safeEvidence({ apiKey: "private", nested: { password: "private" }, text: "Bearer abc.def.ghi",
      cases: Array.from({ length: 540 }, (_, id) => ({ id })), long: "x".repeat(24001) });
    expect(result).not.toHaveProperty("apiKey");
    expect(result.nested).not.toHaveProperty("password");
    expect(result.text).toBe("Bearer [REDACTADO]");
    expect(result.cases).toHaveLength(540);
    expect(result.long).toContain("truncada explícitamente");
  });
  it("rejects the Q06-03 chronology-only answer and keeps a direct conditional explanation for human review", () => {
    const definition = { id: "Q06-03", category: "Q06" };
    expect(check({ answer: "Historial de Totalplay. 2 evento(s) con fecha coincidente.", operations: [] },
      { definition }).outcome).toBe("failed");
    expect(check({ answer: "No. La ausencia de interacciones directas no demuestra que nunca hubo contacto. No he verificado esa premisa.",
      operations: [] }, { definition }).outcome).toBe("human_review");
    expect(check({ answer: "No. La ausencia de interacciones directas no demuestra que nunca hubo contacto. No he verificado esa premisa.",
      operations: [], activityHistory: { mode: "timeline" } }, { definition }).outcome).toBe("failed");
  });
  it("checks L06 against current Waiting stage, commercial status, and activation data", () => {
    const definition = { id: "L06", category: "L" };
    const reference = { opportunities: [
      { id: 13, name: "Seguridad Dns Total Play 2026", stageName: "Waiting", commercialStatusCode: "ganada", activationStatusCode: "activada" },
      { id: 15, name: "Solución (Dns) Periodo 2 2026", stageName: "Waiting", commercialStatusCode: "en_proceso", activationStatusCode: "activada" },
    ] };
    const answer = "No. Waiting es una etapa, no significa que todas sigan abiertas: Seguridad Dns Total Play 2026 está Ganada y Solución (Dns) Periodo 2 2026 está En proceso; ambas siguen activadas. Los estados son distintos.";
    expect(check({ answer, responseType: "informational", operations: [] }, { definition, reference }).outcome).toBe("human_review");
    expect(check({ answer, responseType: "clarification", operations: [] }, { definition, reference }).outcome).toBe("failed");
    expect(check({ answer: "Sí, todas las oportunidades Waiting están abiertas y en proceso.", operations: [] },
      { definition, reference }).outcome).toBe("failed");
  });
  it("checks L07 as a direct distinction without requiring an unavailable CRM example", () => {
    const definition = { id: "L07", category: "L" };
    const answer = "No. Pendiente es el estado de una actividad y no significa que la oportunidad esté Perdida. Son registros y estados distintos; revisa por separado el estado comercial de la oportunidad.";
    expect(check({ answer, responseType: "informational", operations: [] }, { definition }).outcome).toBe("human_review");
    expect(check({ answer, responseType: "clarification", operations: [] }, { definition }).outcome).toBe("failed");
    expect(check({ answer: "Sí, pendiente quiere decir que la oportunidad está perdida.", operations: [] },
      { definition }).outcome).toBe("failed");
  });
  it("rejects the original Q07-01 unsupported absence and requires structured pending source evidence", () => {
    const definition = { id: "Q07-01", category: "Q07" };
    expect(check({ answer: "No se encontraron actividades pendientes para las oportunidades abiertas.", operations: [] },
      { definition }).outcome).toBe("failed");
    const result = { answer: "Pendientes recuperados.", operations: [], activityHistory: {
      mode: "pending", coverage: [{ source: "opportunityActivities", status: "complete" }],
      sections: [{ items: [{ status: "pending", date: "", overdue: null, dateMeaning: "Sin fecha utilizable" }] }],
    } };
    expect(check(result, { definition }).outcome).toBe("human_review");
    result.activityHistory.sections[0].items[0].overdue = true;
    expect(check(result, { definition }).outcome).toBe("failed");
  });
  it("requires a completed, evidenced Q08-02 pair verification rather than a clarification", () => {
    const definition = { id: "Q08-02", category: "Q08" };
    const result = { answer: "No. Figura Kimberly.", responseType: "informational", operations: [],
      relationshipStatus: "different", components: [{ category: "query.relationships", status: "completed" }],
      evidence: ["Vínculo CRM consultado: getOpportunity 36; contrastado con searchContacts autorizado."] };
    expect(check(result, { definition }).outcome).toBe("human_review");
    expect(check({ ...result, responseType: "clarification" }, { definition }).outcome).toBe("failed");
    expect(check({ ...result, relationshipStatus: "matched" }, { definition }).outcome).toBe("failed");
    expect(check({ ...result, evidence: [] }, { definition }).outcome).toBe("failed");
  });
  it("requires Q09-01 quotation content and separate equipment and implementation evidence", () => {
    const definition = { id: "Q09-01", category: "Q09" };
    const result = { answer: "Cantidades por partida; no se sumaron equipos y servicios.",
      responseType: "informational", operations: [], documentCoverage: { source: "quotation", partial: false },
      components: [{ category: "query.document_content", status: "completed" }],
      documentEvidence: [
        "Cotización 18 [item-1-1]: BAM 8500 · Cantidad: 4",
        "Cotización 18 [item-1-2]: Implementación y configuración para 4 BAM 8500 · Cantidad: 1",
      ] };
    expect(check(result, { definition }).outcome).toBe("human_review");
    expect(check({ ...result, responseType: "clarification" }, { definition }).outcome).toBe("failed");
    expect(check({ ...result, documentEvidence: result.documentEvidence.slice(0, 1) }, { definition }).outcome).toBe("failed");
    expect(check({ ...result, documentCoverage: undefined }, { definition }).outcome).toBe("failed");
  });
  it("requires Q10-01 to answer documented pending requirements without clarification or writes", () => {
    const definition = { id: "Q10-01", category: "Q10" };
    const question = { title: "Necesidad", detail: "Pregunta obligatoria sin respuesta." };
    const criterion = { title: "Siguiente paso acordado" };
    const result = { answer: "Etapa actual: Contacto Inicial.", responseType: "informational", operations: [],
      components: [{ category: "query.stage_readiness", status: "completed" }],
      stageReadiness: { opportunityId: 36, currentStage: { id: 1 }, pendingItems: [question, criterion],
        unansweredQuestions: [question], pendingCriteria: [criterion] },
      evidence: ["getOpportunityReadiness 36"] };
    expect(check(result, { definition }).outcome).toBe("human_review");
    expect(check({ ...result, responseType: "clarification" }, { definition }).outcome).toBe("failed");
    expect(check({ ...result, stageReadiness: undefined }, { definition }).outcome).toBe("failed");
    expect(check({ ...result, operations: [{ kind: "stage_answer" }] }, { definition }).outcome).toBe("failed");
  });
  it("requires Q10-03 to report readiness criteria without claiming a stage transition", () => {
    const definition = { id: "Q10-03", category: "Q10" };
    const question = { title: "Necesidad" };
    const criterion = { title: "Siguiente paso acordado" };
    const result = {
      answer: "Etapa actual: Contacto Inicial. Necesidad. Siguiente paso acordado. Esta consulta no guarda respuestas ni cambia la etapa.",
      responseType: "informational", operations: [{ kind: "validate_stage", status: "proposed" }],
      stageReadiness: { currentStage: { name: "Contacto Inicial" }, pendingItems: [question, criterion] },
    };
    expect(check(result, { definition }).outcome).toBe("human_review");
    expect(check({ ...result, answer: "Etapa actual: Contacto Inicial. Solicitud preparada." },
      { definition }).outcome).toBe("failed");
    expect(check({ ...result, operations: [{ kind: "validate_stage", status: "completed" }] },
      { definition }).outcome).toBe("failed");
    expect(check({ ...result, stageReadiness: undefined }, { definition }).outcome).toBe("failed");
  });
  it("keeps human approvals separate from automatic failures and empty runs", () => {
    expect(summarizeCases([]).approved).toBe(0);
    expect(summarizeCases([{ status: "failed", review: { decision: "approved" } },
      { status: "human_review", review: { decision: "approved" } }]).approved).toBe(1);
  });
});
