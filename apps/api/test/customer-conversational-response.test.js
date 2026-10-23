import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composeCustomerConversationalResponse, hasSupportedConversationalPresentation,
} from "../src/commercial-intelligence/customer-conversational-response.js";
import { appendCustomerAccountChatHistory } from "../src/commercial-intelligence/customer-chat-adapter.js";
import { evaluateResponse } from "../src/customer-chat-evaluations/checks.js";

const approved = () => ({ status: "supported", reasons: [],
  checks: { faithfulness: true, coverage: true, uncertainty: true, operationState: true, conversation: true } });
const input = () => ({
  question: "¿Qué cargo tiene Alejandro Ruiz?", userId: 7, jobId: 19,
  contract: { movement: "new_request", resolution: "resolved", components: [
    { id: "c1", category: "query.field_value", object: "contact", reference: "Alejandro Ruiz",
      requestedFields: ["positionTitle"] },
  ] },
  response: { answer: "Alejandro Ruiz\n- Cargo: No informado", responseType: "informational",
    entities: { accountId: 22, contactId: 500 }, operations: [], evidence: ["searchContacts: contacto 500"],
    components: [{ id: "c1", category: "query.field_value", status: "completed", answer: "Cargo: No informado" }] },
  history: [{ role: "assistant", text: "Anterior" }, { role: "user", text: "Ahora consulta a Alejandro" }],
});
const natural = "Alejandro Ruiz está registrado, pero todavía no tenemos informado su cargo.";
const provider = (answer = natural, audit = approved()) => vi.fn()
  .mockResolvedValueOnce({ answer }).mockResolvedValueOnce(audit);
afterEach(() => vi.useRealTimers());

describe("B10 conversational response", () => {
  it("never rewrites an interpretation clarification into a claim that a document was not found", async () => {
    const original = input();
    original.contract.resolution = "clarification";
    original.response.responseType = "clarification";
    original.response.answer = "No pude conciliar la interpretación. Indica qué documento deseas consultar.";
    const research = provider("No encontré información del documento.");
    const result = await composeCustomerConversationalResponse(original, { research });
    expect(result.response.answer).toBe(original.response.answer);
    expect(result.response.presentation.reasonCode).toBe("verified_clarification");
    expect(research).not.toHaveBeenCalled();
  });
  it("keeps an already audited CRM document answer and its partial coverage intact", async () => {
    const original = input();
    original.contract.components = [{ id: "c1", category: "query.document_content" }];
    original.response.components = [{ id: "c1", category: "query.document_content", status: "completed" }];
    original.response.documentCoverage = { source: "opportunity_document", partial: true };
    original.response.documentValidation = { status: "supported" };
    original.response.answer = "Cobertura parcial. Iván describe infraestructura; Yoeli presenta una propuesta.";
    const research = provider();
    const result = await composeCustomerConversationalResponse(original, { research });
    expect(result.response.answer).toBe(original.response.answer);
    expect(result.response.presentation.reasonCode).toBe("validated_crm_document");
    expect(research).not.toHaveBeenCalled();
  });
  it("does not rewrite verified needs reads and their audited dependent explanation", async () => {
    const original = input();
    original.contract.components = [
      { id: "c1", category: "query.stage_readiness", stageReadinessSpec: { purpose: "recorded_needs" } },
      { id: "c2", category: "content.explanation", dependsOn: ["c1"] },
    ];
    original.response.components = [
      { id: "c1", category: "query.stage_readiness", status: "completed" },
      { id: "c2", category: "content.explanation", status: "completed", contentValidation: { reasonCode: "approved" } },
    ];
    original.response.stageReadinessResults = [{ componentId: "c1", readiness: { coverage: { source: "current_stage" } } }];
    const research = provider();
    const result = await composeCustomerConversationalResponse(original, { research });
    expect(result.response.answer).toBe(original.response.answer);
    expect(result.response.presentation.reasonCode).toBe("verified_needs_explanation");
    expect(research).not.toHaveBeenCalled();
  });
  it.each(["completed", "error"])("preserves verified per-opportunity readiness instead of inventing negative facts: %s", async (status) => {
    const original = input();
    original.contract.components = ["Alfa", "Beta"].map((reference, index) => ({
      id: `c${index + 1}`, category: "query.stage_readiness", reference,
    }));
    original.response.components = original.contract.components.map((item, index) => ({
      id: item.id, category: item.category, status: index ? status : "completed",
      answer: index && status === "error" ? "Beta: no pude completar la lectura."
        : `${item.reference}: falta validar el criterio de siguiente paso, no significa que no exista.`,
    }));
    original.response.stageReadinessResults = original.contract.components.map((item, index) => ({
      componentId: item.id, reference: item.reference, status: index ? status : "completed",
      readiness: index && status === "error" ? null : { coverage: { source: "current_stage" } },
    }));
    original.response.answer = original.response.components.map((item) => item.answer).join("\n");
    const research = provider("No se ha acordado un siguiente paso.");
    const result = await composeCustomerConversationalResponse(original, { research });
    expect(result.response.answer).toBe(original.response.answer);
    expect(result.response.stageReadinessResults).toEqual(original.response.stageReadinessResults);
    expect(result.response.presentation).toEqual({ status: "skipped", reasonCode: "verified_readiness_comparison" });
    expect(result.diagnostics.calls).toBe(0);
    expect(research).not.toHaveBeenCalled();
  });
  it("audits multi-opportunity evidence and retains explicit failures rather than treating them as missing data", async () => {
    const original = input();
    original.question = "Compara la preparación de Alfa, Beta y Gamma.";
    original.contract.components = ["Alfa", "Beta", "Gamma"].map((reference, index) => ({
      id: `c${index + 1}`, category: "query.stage_readiness", reference,
    }));
    original.response.stageReadiness = null;
    original.response.stageReadinessResults = [
      { componentId: "c1", reference: "Alfa", status: "completed", readiness: { opportunityId: 1 } },
      { componentId: "c2", reference: "Beta", status: "error", readiness: null },
      { componentId: "c3", reference: "Gamma", status: "completed", readiness: { opportunityId: 3 } },
    ];
    original.response.components = [
      { id: "c1", category: "query.stage_readiness", status: "completed", answer: "Alfa: necesidad registrada; falta validar plazo." },
      { id: "c2", category: "query.stage_readiness", status: "error", answer: "Beta: falló la lectura, no se puede concluir ausencia de información." },
      { id: "c3", category: "query.stage_readiness", status: "completed", answer: "Gamma: falta registrar necesidad en la etapa actual." },
    ];
    original.response.answer = original.response.components.map((item) => item.answer).join("\n");
    const answer = "Alfa: necesidad registrada; falta validar plazo.\nBeta: no se pudo consultar.\nGamma: falta documentar necesidad en la etapa actual. Cobertura parcial.";
    const research = provider(answer);
    const result = await composeCustomerConversationalResponse(original, { research });
    expect(result.response.presentation.status).toBe("completed");
    expect(research.mock.calls[0][0].context.verifiedResult.stageReadinessResults)
      .toEqual(original.response.stageReadinessResults);
    expect(research.mock.calls[1][0].systemPrompt).toContain("fuente no consultada NO acredita ausencia");
    expect(research.mock.calls[1][0].systemPrompt).toContain("no ocultar lecturas exitosas");
    expect(research.mock.calls[1][0].systemPrompt).toContain('"no se ha acordado un siguiente paso" NO está respaldado');
    expect(research.mock.calls[0][0].systemPrompt).toContain("Las actividades registradas");
    expect(result.response.operations).toEqual([]);
  });
  it("keeps a capability limit when the draft invents an absence of account information", async () => {
    const original = input();
    original.response.answer = "Esta herramienta no consultó las respuestas de etapa.";
    const research = provider("No tenemos información comercial de la cuenta.", {
      ...approved(), status: "unsupported",
      checks: { ...approved().checks, faithfulness: false, uncertainty: false },
      reasons: ["Una fuente no consultada no demuestra falta de información."],
    });
    const result = await composeCustomerConversationalResponse(original, { research });
    expect(result.response.answer).toBe(original.response.answer);
    expect(result.response.presentation.reasonCode).toBe("CUSTOMER_B10_AUDIT_REJECTED");
    expect(research).toHaveBeenCalledTimes(2);
  });
  it("allows exact requested comparison names in clarifications without authorizing their numeric parts", async () => {
    const original = input();
    original.question = "Compara Hardware Refresh 3 Años y Vrf 2027.";
    original.contract.components = [{ id: "c1", category: "guidance.comparison",
      comparisonSpec: { references: ["Hardware Refresh 3 Años", "Vrf 2027"] } }];
    original.response.answer = "Indica las dimensiones que deseas comparar.";
    const answer = "¿Qué dimensiones deseas comparar entre Hardware Refresh 3 Años y Vrf 2027?";
    const research = provider(answer);
    const result = await composeCustomerConversationalResponse(original, { research });
    expect(result.response.presentation.status).toBe("completed");
    expect(research).toHaveBeenCalledTimes(2);
    for (const rejected of [
      "El plazo es de 3 años.", "El cierre está confirmado para 2027.",
      "Compara Vrf 20270.", "Compara XVrf 2027.", "Compara Hardware Refresh 30 Años.",
    ]) {
      const attempt = provider(rejected);
      const failure = await composeCustomerConversationalResponse(original, { research: attempt });
      expect(failure.response.presentation.reasonCode).toBe("CUSTOMER_B10_UNSUPPORTED_NUMBER");
      expect(attempt).toHaveBeenCalledTimes(1);
    }
  });
  it.each([
    ["USD 500,000", "USD 500000"],
    ["USD 1,500,000", "USD 1500000.00"],
    ["USD 190,000.50", "USD 190000.500"],
    ["USD 20000", "USD 20,000"],
    ["USD 0.00", "USD 0"],
    ["USD 9007199254740993.10", "USD 9,007,199,254,740,993.1"],
  ])("audits equivalent CRM numeric formats: %s -> %s", async (source, answer) => {
    const original = input();
    original.response.answer = source;
    const research = provider(answer);
    const result = await composeCustomerConversationalResponse(original, { research });
    expect(result.response.presentation.status).toBe("completed");
    expect(result.response.answer).toBe(answer);
    expect(research).toHaveBeenCalledTimes(2);
    expect(research.mock.calls[1][0].context.proposedAnswer).toBe(answer);
  });
  it.each([
    ["USD 500,000", "USD 500.000", "500.000"],
    ["USD 500,000", "USD 500001", "500001"],
    ["USD 190,000.50", "USD 190000.51", "190000.51"],
    ["USD 9007199254740993", "USD 9007199254740992", "9007199254740992"],
    ["Cierre 2027-01-31", "Cierre 2027-02-01", "2027-02-01"],
    ["Cierre 2027-01-31", "Cierre 20270131", "20270131"],
    ["USD 500,000", "USD 50,00", "50,00"],
  ])("retains the verified answer and diagnoses unsupported numbers: %s -> %s", async (source, answer, number) => {
    const original = input();
    original.response.answer = source;
    original.response.entities = { accountId: 22 };
    original.response.evidence = [];
    const research = provider(answer);
    const result = await composeCustomerConversationalResponse(original, { research });
    expect(result.response.answer).toBe(source);
    expect(result.response.presentation.reasonCode).toBe("CUSTOMER_B10_UNSUPPORTED_NUMBER");
    expect(result.diagnostics.generation.unsupportedNumbers).toEqual([number]);
    expect(result.diagnostics.failure.stage).toBe("generation");
    expect(research).toHaveBeenCalledTimes(1);
  });
  it("still rejects equivalent numeric formatting when the semantic audit fails", async () => {
    const original = input();
    original.response.answer = "Importe de oportunidad: USD 500,000.";
    const research = provider("Ingresos facturados: USD 500000.", {
      ...approved(), status: "unsupported", checks: { ...approved().checks, faithfulness: false },
      reasons: ["El importe de una oportunidad no es facturación."],
    });
    const result = await composeCustomerConversationalResponse(original, { research });
    expect(result.response.answer).toBe(original.response.answer);
    expect(result.response.presentation.reasonCode).toBe("CUSTOMER_B10_AUDIT_REJECTED");
    expect(research).toHaveBeenCalledTimes(2);
  });
  it("shows only the audited integrated briefing when all other components are its supporting queries", async () => {
    const original = input();
    original.contract.components = [
      { id: "c1", category: "query.account_summary" },
      { id: "c2", category: "query.document_content" },
      { id: "c3", category: "content.meeting_preparation", dependsOn: ["c1", "c2"] },
    ];
    original.response.components = original.contract.components.map((part) => ({
      ...part, status: "completed", answer: part.id === "c3" ? "Briefing integrado y auditado" : "Consulta de soporte",
      ...(part.id === "c3" ? { contentValidation: { reasonCode: "approved" } } : {}),
    }));
    original.response.answer = "Consulta de soporte\nConsulta de soporte\nBriefing integrado y auditado";
    const research = vi.fn();
    const result = await composeCustomerConversationalResponse(original, { research });
    expect(result.response.answer).toBe("Briefing integrado y auditado");
    expect(result.response.presentation).toEqual({ status: "skipped", reasonCode: "validated_integrated_content" });
    expect(result.response.components).toEqual(original.response.components);
    expect(result.response.evidence).toEqual(original.response.evidence);
    expect(research).not.toHaveBeenCalled();
    original.contract.components[1].category = "content.discovery_questions";
    original.response.components[1].category = "content.discovery_questions";
    const mixedProvider = provider("[[deliverable:c2]]\n[[deliverable:c3]]");
    const mixed = await composeCustomerConversationalResponse(original, { research: mixedProvider });
    expect(mixed.response.presentation.status).toBe("completed");
    expect(mixed.response.answer).toContain("Consulta de soporte");
    expect(mixedProvider).toHaveBeenCalledTimes(2);
  });
  it("allows the exact requested F5 identifier without allowing new numeric claims", async () => {
    const original = input();
    original.question = "Prepara un briefing de F5 Distributed Cloud Services.";
    original.response.answer = "No pude preparar el briefing; falta respaldo documental.";
    const answer = "No pude preparar el briefing de F5 Distributed Cloud Services; falta respaldo documental.";
    const research = provider(answer);
    const result = await composeCustomerConversationalResponse(original, { research });
    expect(result.response.presentation.status).toBe("completed");
    expect(research).toHaveBeenCalledTimes(2);
    for (const rejected of [
      `${answer} El ahorro es 50%.`,
      "F50 ofrece la solucion.",
      "El plazo es de 5 meses.",
    ]) {
      const attempt = provider(rejected);
      const failure = await composeCustomerConversationalResponse(original, { research: attempt });
      expect(failure.response.presentation.reasonCode).toBe("CUSTOMER_B10_UNSUPPORTED_NUMBER");
      expect(attempt).toHaveBeenCalledTimes(1);
    }
  });
  const listing = "Documentos de la oportunidad:\n1. Seguimiento reunion Nginx - 2026_05_22 15_00 CST.docx · extracción: completed\n2. Notas de Gemini - 2026_04_13.docx · extracción: completed";
  const documentInput = () => {
    const original = input();
    original.contract.components = [{ id: "c1", category: "query.document_content", object: "document" }];
    original.response.answer = listing;
    original.response.components = [{ id: "c1", category: "query.document_content", status: "completed", answer: listing }];
    original.response.documentListings = [{ id: "c1", answer: listing }];
    return original;
  };
  it("uses a verified standalone metadata listing directly without an unnecessary rewrite or warning", async () => {
    const original = documentInput();
    original.response.documentCoverage = { source: "quotation_document", kind: "metadata_only", partial: false };
    const research = vi.fn();
    const result = await composeCustomerConversationalResponse(original, { research });
    expect(result.response.answer).toBe(listing);
    expect(result.response.presentation).toEqual({ status: "skipped", reasonCode: "verified_document_listing" });
    expect(result.diagnostics.calls).toBe(0);
    expect(research).not.toHaveBeenCalled();
  });
  it("inserts a selectable document list verbatim while allowing conversational text around it", async () => {
    const research = provider("Estos son los archivos disponibles:\n[[deliverable:document-list-c1]]");
    const result = await composeCustomerConversationalResponse(documentInput(), { research });
    expect(result.response.presentation.status).toBe("completed");
    expect(result.response.answer).toBe(`Estos son los archivos disponibles:\n${listing}`);
    expect(research.mock.calls[0][0].context.protectedDeliverables).toEqual([
      { id: "document-list-c1", placeholder: "[[deliverable:document-list-c1]]" },
    ]);
    expect(research.mock.calls[1][0].context.proposedAnswer).toContain(listing);
    const history = appendCustomerAccountChatHistory([], "¿Qué documentos tiene la oportunidad?", result.response.answer,
      result.response);
    const restored = appendCustomerAccountChatHistory(history, "", "");
    expect(restored.at(-1).text).toContain(listing);
  });
  it("rejects a conversational claim that structured quotation products are associated files", async () => {
    const original = input();
    original.question = "¿Qué archivos están asociados a la cotización 18 de Hardware Refresh?";
    original.contract.components = [{ id: "c1", category: "query.document_content", object: "quotation",
      documentSpec: { source: "quotation" } }];
    original.response.answer = "La cotización 18 incluye servidores BAM 8500.";
    original.response.components = [{ id: "c1", category: "query.document_content", status: "completed",
      answer: original.response.answer }];
    original.response.documentCoverage = { source: "quotation", partial: false };
    original.response.documentSources = [];
    const research = provider("La cotización 18 incluye varios archivos asociados con servidores BAM 8500.", {
      ...approved(), status: "unsupported", checks: { ...approved().checks, faithfulness: false },
      reasons: ["Los productos no prueban que existan archivos asociados."],
    });
    const result = await composeCustomerConversationalResponse(original, { research });
    expect(result.response.answer).toBe(original.response.answer);
    expect(result.response.presentation.status).toBe("degraded");
    expect(result.diagnostics.failure.stage).toBe("audit");
    expect(research.mock.calls[0][0].systemPrompt).toContain("Sus productos, secciones y opciones NO son archivos");
    expect(research.mock.calls[1][0].systemPrompt).toContain("faithfulness=false");
    expect(research.mock.calls[1][0].context.verifiedResult.documentCoverage.source).toBe("quotation");
  });
  it("keeps independent document lists separate in mixed turns", async () => {
    const original = documentInput();
    original.response.documentListings.push({ id: "c2", answer: "Cotización:\n1. propuesta-v3.pdf" });
    original.response.answer += "\nCotización:\n1. propuesta-v3.pdf";
    const research = provider("[[deliverable:document-list-c1]]\n[[deliverable:document-list-c2]]");
    const result = await composeCustomerConversationalResponse(original, { research });
    expect(result.response.presentation.status).toBe("completed");
    expect(result.response.answer).toBe(`${listing}\nCotización:\n1. propuesta-v3.pdf`);
  });
  it.each([
    "1. Seguimiento reunión Nginx del 22 de mayo de 2026.\n2. Notas de Gemini del 13 de abril de 2026.",
    "[[deliverable:document-list-c1]]\n[[deliverable:document-list-c1]]",
    "Aquí están los archivos.",
  ])("rejects renamed, duplicated or omitted document lists before semantic audit: %s", async (answer) => {
    const research = provider(answer);
    const result = await composeCustomerConversationalResponse(documentInput(), { research });
    expect(result.response.answer).toBe(listing);
    expect(result.response.presentation.reasonCode).toBe("CUSTOMER_B10_DELIVERABLE_MISMATCH");
    expect(research).toHaveBeenCalledTimes(1);
  });
  it("writes and audits natural text without changing the verified result or business metadata", async () => {
    const original = input();
    const research = provider();
    const result = await composeCustomerConversationalResponse(original, { research });
    expect(result.response.answer).toBe(natural);
    expect(result.response.presentation).toMatchObject({
      status: "completed", audit: approved(), verifiedAnswer: original.response.answer, auditedAnswer: natural,
    });
    expect(hasSupportedConversationalPresentation(result.response.presentation)).toBe(true);
    expect(result.response.operations).toBe(original.response.operations);
    expect(result.response.entities).toBe(original.response.entities);
    expect(result.response.components).toBe(original.response.components);
    expect(result.response.evidence).toBe(original.response.evidence);
    expect(original.response.answer).toBe("Alejandro Ruiz\n- Cargo: No informado");
    expect(result.diagnostics.calls).toBe(2);
    const [generation, audit] = research.mock.calls.map(([request]) => request);
    expect(generation).toMatchObject({ schemaName: "customer_account_conversational_response",
      useWebSearchTool: false, temperature: 0,
      aiUsageContext: { userId: 7, jobId: 19, featureCode: "commercial_intelligence.account_chat" },
      fields: [{ key: "answer", type: "string" }] });
    expect(generation.context.previousMessages).toEqual(original.history);
    expect(generation.context).not.toHaveProperty("snapshot");
    expect(audit.context.proposedAnswer).toBe(natural);
    expect(audit.schemaName).toBe("customer_account_conversational_audit");
    const checked = evaluateResponse({ definition: { id: "Q03-03" }, result: result.response, accountId: 22,
      reference: { contacts: [{ id: 500, name: "Alejandro Ruiz", positionTitle: "" }] } });
    expect(checked.outcome).toBe("human_review");
    expect(checked.checks.find((item) => item.name === "Respuesta final auditada por B10").passed).toBe(true);
  });

  it("does not accept natural text that no longer matches the audited answer", async () => {
    const { response } = await composeCustomerConversationalResponse(input(), { research: provider() });
    const result = evaluateResponse({ definition: { id: "Q03-03" }, accountId: 22,
      reference: { contacts: [{ id: 500, name: "Alejandro Ruiz", positionTitle: "" }] },
      result: { ...response, answer: "Alejandro Ruiz es Director." } });
    expect(result.outcome).toBe("failed");
  });

  it.each([
    ["unsupported", { ...approved(), status: "unsupported", reasons: ["Inventó el cargo."] }],
    ["inconclusive", { ...approved(), status: "inconclusive", reasons: ["No se pudo confirmar."] }],
    ["missing coverage", { ...approved(), checks: { ...approved().checks, coverage: false } }],
    ["contradictory approval", { ...approved(), reasons: ["Falta el límite de lectura."] }],
    ["invalid audit", { status: "supported" }],
  ])("retains the verified answer explicitly when the audit is %s", async (_name, audit) => {
    const original = input();
    const result = await composeCustomerConversationalResponse(original, { research: provider(natural, audit) });
    expect(result.response.answer).toBe(original.response.answer);
    expect(result.response.presentation.status).toBe("degraded");
    expect(result.diagnostics.failure.stage).toBe("audit");
  });

  it.each([
    null, { answer: "" }, { answer: natural, operations: [{ kind: "delete" }] },
    { answer: "Tiene 300 empleados." },
  ])("never accepts invalid generation or a new number: %j", async (draft) => {
    const research = vi.fn().mockResolvedValue(draft);
    const result = await composeCustomerConversationalResponse(input(), { research });
    expect(result.response.answer).toBe(input().response.answer);
    expect(result.response.presentation.status).toBe("degraded");
    expect(research).toHaveBeenCalledTimes(1);
  });

  it("does not retry provider errors or expose the provider's error body", async () => {
    const research = vi.fn().mockRejectedValue(new Error("Provider unavailable: private response"));
    const result = await composeCustomerConversationalResponse(input(), { research });
    expect(result.diagnostics.failure).toEqual({ stage: "generation", code: "CUSTOMER_B10_PROVIDER_FAILED" });
    expect(JSON.stringify(result)).not.toContain("private response");
    expect(research).toHaveBeenCalledTimes(1);
  });

  it("shares one deadline across generation and audit and clears timeout timers", async () => {
    vi.useFakeTimers();
    const research = vi.fn().mockImplementationOnce(async () => {
      await vi.advanceTimersByTimeAsync(70);
      return { answer: natural };
    }).mockImplementationOnce(() => new Promise(() => {}));
    const work = composeCustomerConversationalResponse({ ...input(), deadlineAt: Date.now() + 100 }, { research });
    await vi.advanceTimersByTimeAsync(100);
    const result = await work;
    expect(result.response.presentation).toEqual({ status: "degraded", reasonCode: "CUSTOMER_B10_TIMEOUT" });
    expect(result.diagnostics.failure.stage).toBe("audit");
    expect(vi.getTimerCount()).toBe(0);
    expect(research).toHaveBeenCalledTimes(2);
  });

  it("does not call the provider after the deadline", async () => {
    const research = vi.fn();
    const result = await composeCustomerConversationalResponse({ ...input(), deadlineAt: Date.now() - 1 }, { research });
    expect(result.response.presentation.reasonCode).toBe("CUSTOMER_B10_TIMEOUT");
    expect(research).not.toHaveBeenCalled();
  });

  it("protects a validated email while composing a mixed answer", async () => {
    const original = input();
    const email = { id: "c2", category: "content.email_draft", status: "completed",
      answer: "Asunto: Seguimiento\nHola Alejandro,\n¿Revisamos el alcance?\nSaludos." };
    original.contract.components.push({ id: "c2", category: email.category });
    original.response.components.push(email);
    const research = provider("Alejandro Ruiz no tiene cargo informado.\n\n[[deliverable:c2]]");
    const result = await composeCustomerConversationalResponse(original, { research });
    expect(result.response.presentation.status).toBe("completed");
    expect(result.response.answer).toContain(email.answer);
    expect(result.response.components[1]).toBe(email);
    expect(research.mock.calls[1][0].context.proposedAnswer).toContain(email.answer);
    expect(result.response.answer).not.toContain("[[deliverable:");
  });

  it.each(["Se omitió el correo", "[[deliverable:c2]] [[deliverable:c2]]", "[[deliverable:c2]] [[deliverable:c3]]"])(
    "rejects lost, duplicate or unknown protected deliverables: %s", async (answer) => {
      const original = input();
      original.contract.components.push({ id: "c2", category: "content.email_draft" });
      original.response.components.push({ id: "c2", category: "content.email_draft", answer: "Asunto: Prueba" });
      const research = provider(answer);
      const result = await composeCustomerConversationalResponse(original, { research });
      expect(result.response.presentation.reasonCode).toBe("CUSTOMER_B10_DELIVERABLE_MISMATCH");
      expect(research).toHaveBeenCalledTimes(1);
    });

  it("does not add a redundant call to a content-only or already generated and audited response", async () => {
    const research = vi.fn();
    const original = input();
    original.contract.components = [{ id: "c1", category: "content.translation" }];
    original.response.components = [{ id: "c1", category: "content.translation", status: "completed", answer: "Hello." }];
    expect((await composeCustomerConversationalResponse(original, { research })).diagnostics.reasonCode).toBe("validated_content");
    expect((await composeCustomerConversationalResponse({ ...input(), alreadyGeneratedAndAudited: true },
      { research })).diagnostics.reasonCode).toBe("already_generated_and_audited");
    expect(research).not.toHaveBeenCalled();
  });
  it("still phrases a clarification for a content request with no completed deliverable", async () => {
    const original = input();
    original.contract.components = [{ id: "c1", category: "content.email_draft" }];
    original.response.components = [];
    original.response.responseType = "clarification";
    original.response.answer = "Falta el propósito del correo.";
    const research = provider("¿Qué quieres comunicarle a Alejandro Ruiz en el correo?");
    const result = await composeCustomerConversationalResponse(original, { research });
    expect(result.response.presentation.status).toBe("completed");
    expect(research).toHaveBeenCalledTimes(2);
  });

  it("refuses oversized input explicitly without truncating verified facts", async () => {
    const original = input();
    original.response.answer = "a".repeat(60001);
    const research = vi.fn();
    const result = await composeCustomerConversationalResponse(original, { research });
    expect(result.response.answer).toBe(original.response.answer);
    expect(result.response.presentation.reasonCode).toBe("input_limit");
    expect(research).not.toHaveBeenCalled();
  });

  it.each([
    ["informational", "No encontré a Alejandro Ruiz entre los contactos de Totalplay."],
    ["clarification", "Hay dos oportunidades de hardware. ¿Cuál quieres consultar?"],
    ["error", "No pude consultar los contactos; no puedo confirmar si Alejandro está registrado."],
    ["operation", "La actividad está propuesta y requiere confirmación; todavía no se guardó."],
  ])("never changes the server's %s state when wording changes", async (responseType, answer) => {
    const original = input();
    original.response.responseType = responseType;
    const result = await composeCustomerConversationalResponse(original, { research: provider(answer) });
    expect(result.response.responseType).toBe(responseType);
    expect(result.response.entities).toBe(original.response.entities);
    expect(result.response.operations).toBe(original.response.operations);
  });

  it("persists the complete final text and presentation status across subsequent history appends", async () => {
    const { response } = await composeCustomerConversationalResponse(input(), { research: provider("Texto ".repeat(500)) });
    const first = appendCustomerAccountChatHistory([], "Pregunta", response.answer, { presentation: response.presentation });
    const next = appendCustomerAccountChatHistory(first, "Otra", "Respuesta");
    expect(first.at(-1).text).toBe(response.answer);
    expect(next[1].text).toBe(response.answer);
    expect(next[1].presentation).toEqual(response.presentation);
  });
});
