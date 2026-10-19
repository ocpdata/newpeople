import { describe, expect, it, vi } from "vitest";
import {
  contrastCustomerDocumentReport, customerDocumentReportAppendText,
  resolveCustomerDocumentReport, validateCustomerDocumentReportMemory,
} from "../src/commercial-intelligence/customer-document-reports.js";

const snapshot = { account: { id: 1, name: "Cuenta" }, permissions: { canReadOpportunities: true },
  opportunities: [{ id: 10, accountId: 1, name: "Hardware" }] };
const now = new Date("2026-10-17T12:00:00Z");
const claim = "Se incluyen cuatro BAM 8500";
const component = (spec = {}) => ({
  category: "report.document_evidence", object: "opportunity", reference: "Hardware", text: claim,
  documentReportSpec: { source: "quotation", claim, ...spec },
});
const resolve = (spec = {}, extra = {}) => resolveCustomerDocumentReport({
  component: component(spec), movement: "new_request", snapshot, ...extra,
});
const request = { source: "quotation", spec: {}, opportunity: snapshot.opportunities[0],
  selectedQuotationId: 18, memory: { accountId: 1, source: "quotation", opportunityId: 10 } };
const quotation = {
  quotationId: 18, accountId: 1, opportunityId: 10, versionId: 101, versionNumber: 1,
  proposalName: "Hardware", currencyCode: "USD", deliveryTime: "30 días",
  internalNotes: "PRIVATE_INTERNAL", cost: 444, margin: 999,
  sections: [{ title: "Equipos", inclusion: "Incluido", items: [
    { productCode: "BAM-8500", description: "BAM 8500", quantity: 4 },
  ] }],
};
const generator = (draft = {}) => vi.fn(async ({ schemaName }) => schemaName === "customer_account_document_report_audit"
  ? { approved: "yes" } : { status: "supported", reason: "La partida indica cantidad cuatro.", citations: ["item-1-1"], crmDiscrepancies: [], ...draft });
const run = (extra = {}) => contrastCustomerDocumentReport({
  report: resolve(), request, quotation, user: { id: 7 }, jobId: 1, now, generateWithAI: generator(), ...extra,
});

describe("R05 typed report resolution and memory", () => {
  it("receives without requiring a stage destination", () => {
    const report = resolve();
    expect(report.mode).toBe("receive");
    expect(report.claim).toBe(claim);
    expect(report.memory.questionReference).toBe("");
  });
  it("masks unused provider placeholders", () => {
    expect(resolve({ changed: ["source"], source: "unavailable", claim: "Inventado", mode: "prepare", questionReference: "Otra pregunta" }))
      .toMatchObject({ claim, mode: "receive", source: "unavailable" });
  });
  it("keeps the original assertion while a source is clarified", () => {
    const first = resolve({ source: "unspecified" });
    expect(first.error).toContain("no tengo el documento para verificar");
    expect(first.error).toContain("No se confirmó ninguna aprobación");
    const next = resolve({}, { component: { ...component(), text: "La cotización 18",
      documentReportSpec: { source: "quotation" } }, movement: "answer_clarification", previous: first.memory });
    expect(next.claim).toBe(claim);
  });
  it("does not require a missing document to verify a seller-only attribution", () => {
    expect(resolve({ source: "unavailable" }).source).toBe("unavailable");
    expect(resolve({ source: "provided_document" }).error).toContain("texto documental legible");
  });
  it.each([
    { source: "global" }, { mode: "execute" }, { questionReference: 99 }, { claim: "x".repeat(4001) },
    { clarification: "¿Cuál?" }, { unsupported: ["certificar autenticidad"] },
  ])("rejects invalid and unsupported specification %j", (spec) => expect(resolve(spec).error).toBeTruthy());
  it("does not silently substitute a conflicting document source", () => {
    expect(resolve({}, { component: { ...component(), documentSpec: { source: "provided_document" } } }).error).toContain("no coinciden");
  });
  it("does not explain a different assertion as if it were the original", async () => {
    const first = await run();
    expect(resolve({ mode: "explain", claim: "Ya entregado" }, { movement: "continue", previous: first.documentReportMemory }).error).toContain("conserva");
  });
  it("validates account scope, quotation membership, IDs and coverage fingerprint in memory", async () => {
    const memory = (await run()).documentReportMemory;
    expect(validateCustomerDocumentReportMemory(memory, snapshot)).toEqual(memory);
    for (const bad of [
      { ...memory, accountId: 2 }, { ...memory, claim: "" }, { ...memory, fingerprint: "invalid" },
      { ...memory, documentMemory: { ...memory.documentMemory, opportunityId: 20 } },
      { ...memory, source: "provided_document" }, { ...memory, observedAt: "invalid" },
    ]) expect(validateCustomerDocumentReportMemory(bad, snapshot)).toBeNull();
    expect(validateCustomerDocumentReportMemory(memory, { ...snapshot, permissions: { canReadOpportunities: false } })).toBeNull();
  });
});

describe("R05 semantic contrast with authorized Q09 basis", () => {
  it("supports R05-01 with server-sourced citations, never delivery or CRM operations", async () => {
    const before = structuredClone(quotation), generateWithAI = generator(), result = await run({ generateWithAI });
    expect(result.documentReportMetadata).toMatchObject({ status: "supported", claim, partial: false });
    expect(result.documentReportEvidence[0]).toContain("Cantidad: 4");
    expect(result.answer).toContain("Cotización 18 · versión 1");
    expect(result.operations).toEqual([]);
    expect(result.stageAnswerPrefill).toBeUndefined();
    expect(quotation).toEqual(before);
    expect(generateWithAI).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(generateWithAI.mock.calls)).not.toContain("PRIVATE_INTERNAL");
    expect(JSON.stringify(generateWithAI.mock.calls)).not.toContain('"cost":444');
    expect(generateWithAI.mock.calls[1][0].context.fragments).toHaveLength(generateWithAI.mock.calls[0][0].context.fragments.length);
  });
  it.each(["contradicted", "undetermined"])("distinguishes %s without upgrading the report to a fact", async (status) => {
    const result = await run({ generateWithAI: generator({ status, reason: "La fuente no acredita la conclusión de entrega." }) });
    expect(result.documentReportMetadata.status).toBe(status);
    const append = customerDocumentReportAppendText(result.documentReportMetadata);
    expect(append).toContain(claim);
    expect(append).toContain(result.documentReportMetadata.statusLabel);
    expect(append).toContain("No constituye verificación independiente");
  });
  it("R05-02 says only the seller account is available without any model calls", async () => {
    const generateWithAI = generator();
    const result = await run({ report: resolve({ source: "unavailable", claim: "Según un documento que no adjunto, aprobaron todo" }), generateWithAI });
    expect(result.documentReportMetadata.status).toBe("unavailable");
    expect(result.answer).toContain("Solo dispongo del relato del vendedor");
    expect(result.documentReportMemory.documentMemory).toBeNull();
    expect(generateWithAI).not.toHaveBeenCalled();
  });
  it.each([
    { status: "verified" }, { reason: "" }, { citations: [] }, { citations: ["made-up-page"] },
    { status: "supported", extra: true },
  ])("fails explicitly for malformed or invented contrast evidence %j", async (draft) => {
    const generateWithAI = generator(draft), result = await run({ generateWithAI });
    expect(result.responseType).toBe("error");
    expect(result.stageAnswerPrefill).toBeUndefined();
    expect(generateWithAI).toHaveBeenCalledOnce();
  });
  it("rejects an audit refusal and propagates provider failure", async () => {
    const generateWithAI = generator();
    generateWithAI.mockResolvedValueOnce({ status: "supported", reason: "Conclusión", citations: ["identity"], crmDiscrepancies: [] }).mockResolvedValueOnce({ approved: "no" });
    expect((await run({ generateWithAI })).responseType).toBe("error");
    await expect(run({ generateWithAI: vi.fn(async () => { throw new Error("Provider unavailable"); }) })).rejects.toThrow("Provider unavailable");
  });
  it.each([
    { accountId: 2 }, { opportunityId: 20 }, { quotationId: 19 }, { versionNumber: 2 },
  ])("does not contrast foreign or mismatched source %j", async (patch) => {
    const generateWithAI = generator();
    const result = await run({ request: { ...request, versionNumber: 1 }, quotation: { ...quotation, ...patch }, generateWithAI });
    expect(result.responseType).toBe("error");
    expect(generateWithAI).not.toHaveBeenCalled();
  });
  it("asks to refresh changed content before applying an old conclusion", async () => {
    const first = await run(), report = resolve({ mode: "explain" }, { movement: "continue", previous: first.documentReportMemory });
    const changed = { ...quotation, deliveryTime: "90 días" }, generateWithAI = generator();
    const stale = await run({ report, quotation: changed, generateWithAI });
    expect(stale.responseType).toBe("clarification");
    expect(stale.answer).toContain("cambió");
    expect(generateWithAI).not.toHaveBeenCalled();
    const refreshed = await run({ report: resolve({ mode: "refresh" }, { movement: "continue", previous: stale.documentReportMemory }), quotation: changed });
    expect(refreshed.documentReportMemory.fingerprint).not.toBe(first.documentReportMemory.fingerprint);
  });
  it("shows a discrepancy against an already-authorized stage answer without choosing a true source", async () => {
    const result = await run({
      request: { ...request, opportunity: { ...request.opportunity, stageQuestions: [
        { questionId: 20, prompt: "Cantidad requerida", answer: "Se necesitan diez equipos" },
      ] } },
      generateWithAI: generator({ crmDiscrepancies: [{ questionId: 20, reason: "La partida ofrece cuatro, mientras la respuesta indica diez." }] }),
    });
    expect(result.documentReportMetadata.crmDiscrepancies[0].currentAnswer).toBe("Se necesitan diez equipos");
    expect(result.answer).toContain("No se resolvió qué fuente es correcta");
    expect(customerDocumentReportAppendText(result.documentReportMetadata)).toContain("Respuesta CRM previa");
    const invalid = await run({ generateWithAI: generator({ crmDiscrepancies: [{ questionId: 999, reason: "Destino inexistente" }] }) });
    expect(invalid.responseType).toBe("error");
  });
  it("bounds CRM comparison to twenty answers and marks truncated answers without overstating document coverage", async () => {
    const generateWithAI = generator();
    const result = await run({ generateWithAI, request: { ...request, opportunity: {
      ...request.opportunity, stageQuestions: Array.from({ length: 21 }, (_, index) => ({
        questionId: index + 1, prompt: `Pregunta ${index}`, answer: `${"a".repeat(4000)}PRIVATE_CRM_TAIL`,
      })),
    } } });
    const context = generateWithAI.mock.calls[0][0].context;
    expect(context.registeredAnswers).toHaveLength(20);
    expect(context.registeredAnswers.every(item => item.currentAnswer.length === 4000 && item.partial)).toBe(true);
    expect(JSON.stringify(generateWithAI.mock.calls)).not.toContain("PRIVATE_CRM_TAIL");
    expect(result.documentReportMetadata.crmCoverage).toEqual({ availableAnswers: 21, consultedAnswers: 20, partial: true });
    expect(result.documentReportMetadata.partial).toBe(true);
    expect(result.documentCoverage.partial).toBe(false);
  });
  it("limits actual readable material and treats pasted fragments as partial even if extraction is complete", async () => {
    const material = { name: "Fragmento", text: "Necesitan filtrar adjuntos", coverage: "complete", originalLength: 24 };
    const report = resolve({ source: "pasted_fragment" }, { referenceMaterial: material });
    const result = await run({ report, quotation: null,
      request: { source: "provided_document", spec: {}, material, memory: { accountId: 1, source: "provided_document" } },
      generateWithAI: generator({ citations: ["fragment-1"] }) });
    expect(result.documentReportMetadata.partial).toBe(true);
    expect(result.documentReportMetadata.sourceLabel).toContain("Fragmento");
    expect(result.documentReportEvidence[0]).toContain(material.text);
  });
  it("declares truncation and never gives the model text outside the readable portion", async () => {
    const material = { name: "Largo", text: `${"a".repeat(12000)}PRIVATE_TAIL`, coverage: "partial", originalLength: 20000 };
    const report = resolve({ source: "provided_document" }, { referenceMaterial: material });
    const generateWithAI = generator({ citations: ["fragment-1"] });
    const result = await run({ report, quotation: null, generateWithAI, request: {
      source: "provided_document", spec: {}, material: report.material, memory: { accountId: 1, source: "provided_document" },
    } });
    expect(result.documentReportMetadata.partial).toBe(true);
    expect(JSON.stringify(generateWithAI.mock.calls)).not.toContain("PRIVATE_TAIL");
    expect(result.documentCoverage.availableLength).toBe(12000);
  });
});
