import { describe, expect, it, vi } from "vitest";
import { buildTurnSourcesDossier, libraryQuery, quotationOpportunityIds, sourcesNeeded } from "../src/commercial-intelligence/dossier/sources.js";
import { buildEvidenceIndex, checkCalculation, verifyAnalysis } from "../src/commercial-intelligence/dossier/verifier.js";
import { contentSourceFor, describeCitation } from "../src/commercial-intelligence/dossier/engine.js";

const constraints = (extra = {}) => ({ count: 0, durationMinutes: 0, length: "standard", format: "free",
  excludedSources: [], excludedFields: [], noWrite: false, noSend: false, quotes: [], ...extra });
const task = (type, kind, extra = {}) => ({ id: "t1", type, kind, ask: "Pregunta sobre BlueCat para Totalplay", evidence: "x",
  material: "none", focusLevel: "opportunity", opportunityIds: [36], dependsOn: [], itemsNeedConfirmation: false,
  constraints: constraints(), ...extra });
const plan = (tasks) => ({ tasks, recordFilters: [], continuation: { kind: "none", previousTaskIndex: 0 },
  clarification: { question: "", options: [] }, reason: "" });
const account = { evidenceId: "acct22", source: { table: "accounts", id: 22 }, id: 22, name: "Totalplay" };
const accountDossier = { kind: "account", account, sections: {} };
const opportunityDossier = { kind: "opportunity", account, opportunity: { evidenceId: "opp36", id: 36, name: "Hardware Refresh" },
  sections: { quotations: { items: [{ evidenceId: "quote18", source: { table: "quotations", id: 18 }, activationCode: "activada",
    versions: [{ evidenceId: "qv22", source: { table: "quotation_versions", id: 22 }, versionNumber: 1, isLatest: true }] }] } } };
const permissions = { quotations: true, documents: true };
const quotationRun = vi.fn(async (sql) => sql.includes("FROM quotation_versions v WHERE")
  ? [{ id: 22, currency_code: "USD", delivery_time: "30 días", quotation_validity: "15 días", warranty_term: "1 año",
    payment_terms: "30 días", summary_vat_mode: null, summary_vat_pct: null }]
  : [
    { id: 501, quotation_version_id: 22, section_title: "Hardware", inclusion_name: "Incluida", product_code: "BAM8500",
      product_description: "Servidor BAM 8500", item_type: "producto", is_renewal: 0, quantity: "4.00",
      original_currency_code: "USD", list_price_unit: "100750.00", final_discount_pct: "0.00" },
    { id: 502, quotation_version_id: 22, section_title: "Hardware", inclusion_name: "Incluida", product_code: "IMPL",
      product_description: "Implementación para 4 BAM 8500", item_type: "servicio_propio", is_renewal: 0, quantity: "1.00",
      original_currency_code: "USD", list_price_unit: "50000.00", final_discount_pct: "0.00" },
  ]);
const build = (tasks, extra = {}) => buildTurnSourcesDossier({ plan: plan(tasks), user: { id: 1 }, accountDossier,
  opportunityDossiers: [opportunityDossier], permissions, attachment: null, run: quotationRun, ...extra });

describe("fuentes del turno", () => {
  it("decide las fuentes solo por las tareas del plan", () => {
    expect(sourcesNeeded(plan([task("consult", "summary")]))).toMatchObject({ quotationContent: false, library: false, attachment: false });
    expect(sourcesNeeded(plan([task("document", "quotation", { constraints: constraints({ excludedFields: ["prices"], quotes: ["sin precios"] }) })])))
      .toMatchObject({ quotationContent: true, hidePrices: true });
    expect(sourcesNeeded(plan([task("compose", "questions", { material: "library" })]))).toMatchObject({ library: true });
    expect(sourcesNeeded(plan([task("compose", "questions", { material: "library",
      constraints: constraints({ excludedSources: ["library"], quotes: ["sin biblioteca"] }) })]))).toMatchObject({ library: false });
    expect(sourcesNeeded(plan([task("consult", "summary")]), { hasAttachment: true })).toMatchObject({ attachment: true });
  });

  it("ubica la oportunidad de una cotización nombrada solo por número, dentro de la cuenta", async () => {
    const run = vi.fn().mockResolvedValue([{ opportunity_id: 36 }]);
    const quotationTask = task("document", "quotation", { opportunityIds: [], focusLevel: "account", evidence: "Resume la cotización 18" });
    expect(await quotationOpportunityIds({ plan: plan([quotationTask]), run, visibleOpportunityIds: [36, 94] })).toEqual([36]);
    expect(run.mock.calls[0][1]).toEqual([[18], [36, 94]]);
    expect(await quotationOpportunityIds({ plan: plan([task("document", "quotation")]), run, visibleOpportunityIds: [36] })).toEqual([]);
  });

  it("no lee nada si ninguna tarea lo necesita", async () => {
    expect(await build([task("consult", "summary")])).toBeNull();
  });

  it("lee partidas y condiciones de la versión vigente y oculta precios excluidos", async () => {
    const sources = await build([task("document", "quotation")]);
    const items = sources.sections.quotationContent.items;
    expect(items.map((item) => item.evidenceId)).toEqual(["qterms22", "qitem501", "qitem502"]);
    expect(items[1]).toMatchObject({ quantity: 4, productCode: "BAM8500", listPriceUnit: "100750.00", quotationId: 18, versionNumber: 1 });
    const hidden = await build([task("document", "quotation", { constraints: constraints({ excludedFields: ["prices"], quotes: ["sin precios"] }) })]);
    expect(hidden.sections.quotationContent.items[1]).not.toHaveProperty("listPriceUnit");
    expect(describeCitation(items[1]).label).toBe("Cotización 18 · versión 1 · partida");
    expect(buildEvidenceIndex([accountDossier, opportunityDossier, sources]).has("qitem502")).toBe(true);
  });

  it("fragmenta el adjunto y marca la lectura parcial", async () => {
    const sources = await build([task("document", "attachment")], { attachment: { name: "acta.txt", text: "a".repeat(3200), coverage: "partial" } });
    expect(sources.sections.attachment).toMatchObject({ status: "truncated", total: 3 });
    expect(sources.sections.attachment.items[0]).toMatchObject({ evidenceId: "att1", fileName: "acta.txt" });
    const missing = await build([task("document", "attachment")]);
    expect(missing.sections.attachment).toMatchObject({ status: "empty", items: [] });
  });

  it("consulta la biblioteca sin nombres del cliente y distingue fallos de ausencias", async () => {
    expect(libraryQuery(plan([task("compose", "questions", { material: "library" })]), ["Totalplay"])).toBe("Pregunta sobre BlueCat para");
    const retrieveLibrary = vi.fn().mockResolvedValue({ status: "results", snippets: [{ content: "BlueCat gestiona DNS", score: 0.9 }] });
    const sources = await build([task("document", "library")], { retrieveLibrary });
    expect(sources.sections.library).toMatchObject({ status: "loaded", items: [{ evidenceId: "lib1", text: "BlueCat gestiona DNS" }] });
    const failed = await build([task("document", "library")], { retrieveLibrary: vi.fn().mockRejectedValue(new Error("Pinecone: limit")) });
    expect(failed.sections.library.status).toBe("failed");
  });

  it("lee documentos del CRM habilitados para IA con límite y avisa los excluidos", async () => {
    const listDocuments = vi.fn().mockResolvedValue({ truncated: false, candidates: [
      { documentId: 7, name: "Minuta.pdf", aiEnabled: true }, { documentId: 8, name: "Privado.pdf", aiEnabled: false }] });
    const readDocument = vi.fn().mockResolvedValue({ status: "ready", text: "Minuta de la reunión", kind: "extracted_text" });
    const sources = await build([task("document", "crm_document")], { listDocuments, readDocument });
    expect(readDocument).toHaveBeenCalledTimes(1);
    expect(sources.sections.crmDocumentContent).toMatchObject({ status: "truncated",
      items: [{ evidenceId: "dtext7x1", fileName: "Minuta.pdf" }], readingNotes: ["Privado.pdf: excluido del uso con IA; no se leyó."] });
  });
});

describe("cálculos verificados por código", () => {
  const opp = (id, amountUsd, closeDate) => ({ evidenceId: `opp${id}`, amountUsd, closeDate });
  const calc = (operation, field, parameter, result) => ({ operation, field, parameter, result });

  it("recalcula escenarios, diferencias, proporciones y órdenes", () => {
    expect(checkCalculation(calc("add_months", "closeDate", "1", "2027-02-28"), [opp(36, "500000", "2027-01-31")]).ok).toBe(true);
    expect(checkCalculation(calc("add_months", "closeDate", "1", "2027-03-03"), [opp(36, "500000", "2027-01-31")]).ok).toBe(false);
    expect(checkCalculation(calc("percent_change", "amountUsd", "-10", "450000"), [opp(36, "500000.00", null)]).ok).toBe(true);
    expect(checkCalculation(calc("difference", "amountUsd", "", "1000000"), [opp(36, "500000", null), opp(37, "1500000", null)]).ok).toBe(true);
    expect(checkCalculation(calc("ratio", "amountUsd", "", "3"), [opp(36, "500000", null), opp(37, "1500000", null)]).ok).toBe(true);
    expect(checkCalculation(calc("order_asc", "closeDate", "", ""), [opp(1, "1", "2026-11-18"), opp(2, "1", "2027-01-31"), opp(3, "9", "2027-01-31")]).ok).toBe(true);
    expect(checkCalculation(calc("order_desc", "amountUsd", "", ""), [opp(1, "10", null), opp(2, "20", null)]).ok).toBe(false);
  });

  it("rechaza en la verificación del analista un cálculo incorrecto", () => {
    const dossier = { kind: "account", account, sections: { opportunities: { key: "opportunities", status: "loaded",
      items: [{ evidenceId: "opp36", source: { table: "opportunities", id: 36 }, amountUsd: "500000", closeDate: "2027-01-31" }] } } };
    const analysis = { answerText: "Quedaría en 460,000 USD.", blocks: [{ obligationId: "o1", status: "answered", reason: "", items: [],
      claims: [{ text: "Bajaría a 460,000 USD", kind: "inference", evidenceIds: ["opp36"], sectionKeys: [], values: [],
        calculation: calc("percent_change", "amountUsd", "-10", "460000") }] }] };
    const result = verifyAnalysis({ analysis, obligations: [{ id: "o1", form: "answer", count: 0 }], dossiers: [dossier] });
    expect(result.failures.map((failure) => failure.code)).toEqual(["CALCULATION_MISMATCH"]);
  });
});

describe("procedencia del contenido", () => {
  it("distingue biblioteca, material aportado y CRM", () => {
    expect(contentSourceFor(["lib1"])).toBe("knowledge_library");
    expect(contentSourceFor(["lib1", "opp36"])).toBe("mixed_knowledge");
    expect(contentSourceFor(["att1"])).toBe("user_provided");
    expect(contentSourceFor(["att1", "opp36"])).toBe("mixed_document");
    expect(contentSourceFor([], [{ material: "previous_answer" }])).toBe("user_provided");
    expect(contentSourceFor(["opp36"])).toBeNull();
  });
});

describe("conexión de solo lectura", () => {
  it("limita cada consulta y descarta la conexión si una lectura agota su tiempo", async () => {
    const { withReadOnlyConnection } = await import("../src/commercial-intelligence/dossier/access.js");
    const connection = { query: vi.fn(async (options) => {
      if (String(options.sql).includes("lenta")) throw Object.assign(new Error("Query inactivity timeout"), { code: "PROTOCOL_SEQUENCE_TIMEOUT" });
      return [[{ ok: 1 }]];
    }), rollback: vi.fn(async () => {}), release: vi.fn(), destroy: vi.fn() };
    const pool = { getConnection: vi.fn(async () => connection) };
    expect(await withReadOnlyConnection(pool, (run) => run("SELECT 1"))).toEqual([{ ok: 1 }]);
    expect(connection.query.mock.calls[1][0]).toMatchObject({ sql: "SELECT 1", timeout: 15000 });
    expect(connection.release).toHaveBeenCalledTimes(1);
    await expect(withReadOnlyConnection(pool, (run) => run("SELECT lenta"))).rejects.toMatchObject({ code: "PROTOCOL_SEQUENCE_TIMEOUT" });
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("no espera indefinidamente por una conexión del pool", async () => {
    const { withReadOnlyConnection } = await import("../src/commercial-intelligence/dossier/access.js");
    const late = { release: vi.fn() };
    let deliver;
    const pool = { getConnection: () => new Promise((resolve) => { deliver = () => resolve(late); }) };
    await expect(withReadOnlyConnection(pool, vi.fn(), { acquireTimeoutMs: 10 })).rejects.toMatchObject({ code: "DOSSIER_DB_ACQUIRE_TIMEOUT" });
    deliver();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(late.release).toHaveBeenCalledTimes(1);
  });
});
