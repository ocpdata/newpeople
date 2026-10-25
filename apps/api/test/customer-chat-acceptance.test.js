import { describe, expect, it, vi } from "vitest";
import { loadAcceptanceBank, parseAcceptanceBank, selectConversations } from "../src/customer-chat-acceptance/bank.js";
import { buildFactQuery, compareFact, verifyBankFacts } from "../src/customer-chat-acceptance/facts.js";
import { buildJudgeFields, gradeTurn, judgeTurn, quoteAppearsIn, validateJudgement } from "../src/customer-chat-acceptance/judge.js";
import { renderMarkdownReport, summarizeRun } from "../src/customer-chat-acceptance/report.js";
import { runConversation } from "../src/customer-chat-acceptance/runner.js";

const turn = {
  id: "T1",
  question: "¿Cuál es el importe y qué cotización hay?",
  mustInclude: [
    { id: "amount", critical: true, statement: "El importe es 8,000 USD.", evidence: ["opp.amount"] },
    { id: "tone", critical: false, statement: "Separa lo registrado de lo inferido.", evidence: [] },
  ],
  mustNotClaim: [{ id: "accepted", statement: "Que el cliente aceptó la cotización." }],
  allowClarification: false,
};
const answer = "El importe registrado es **8,000 USD**. La cotización está Aprobada, pero no consta que el cliente la aceptara.";
const completed = { status: "completed", responseType: "informational", answer };
const judgement = (overrides = {}) => ({
  required: [
    { id: "amount", verdict: "present", quotes: ["importe registrado es 8,000 USD"], explanation: "Lo dice." },
    { id: "tone", verdict: "absent", quotes: [], explanation: "No separa." },
  ],
  forbidden: [{ id: "accepted", verdict: "absent", quotes: [], explanation: "Lo niega." }],
  ...overrides,
});

describe("banco de aceptación del chat de Cliente existente", () => {
  it("carga el banco real con evidencias existentes y conversaciones únicas", async () => {
    const bank = await loadAcceptanceBank();
    expect(bank.conversations.length).toBeGreaterThanOrEqual(5);
    expect(bank.conversations.flatMap((item) => item.turns)).toHaveLength(23);
    expect(selectConversations(bank, ["SEALPATH-ORIGINAL"]).map((item) => item.id)).toEqual(["SEALPATH-ORIGINAL"]);
    expect(() => selectConversations(bank, ["NO-EXISTE"])).toThrow(/desconocidas/);
  });

  it("rechaza evidencias inexistentes y hechos sin criterio único", () => {
    const bank = {
      version: 1, description: "x",
      facts: { "opp.amount": { table: "opportunities", id: 1, field: "amount_usd", equals: "1" } },
      conversations: [{ id: "C", title: "c", accountId: 1, turns: [{ ...turn,
        mustInclude: [{ ...turn.mustInclude[0], evidence: ["opp.missing"] }] }] }],
    };
    expect(() => parseAcceptanceBank(bank)).toThrow(/Evidencia inexistente opp.missing/);
    expect(() => parseAcceptanceBank({ ...bank,
      facts: { "opp.amount": { table: "opportunities", id: 1, field: "amount_usd", equals: "1", contains: "1" } },
      conversations: [{ ...bank.conversations[0], turns: [turn] }] })).toThrow(/exactamente equals o contains/);
  });
});

describe("verificación de hechos contra la base", () => {
  it("solo consulta tablas y campos permitidos, con fechas normalizadas", () => {
    expect(buildFactQuery({ table: "opportunities", id: 121, field: "close_date", equals: "2026-10-31" }))
      .toEqual({ sql: "SELECT DATE_FORMAT(??, '%Y-%m-%d') AS value FROM ?? WHERE id = ?", params: ["close_date", "opportunities", 121] });
    expect(buildFactQuery({ table: "opportunity_workspace_actions", where: { opportunity_id: 27, status: "pending" }, count: 0 }).params)
      .toEqual(["opportunity_workspace_actions", "opportunity_id", 27, "status", "pending"]);
    expect(() => buildFactQuery({ table: "users", id: 1, field: "password_hash", equals: "x" })).toThrow(/no permitida/);
    expect(() => buildFactQuery({ table: "opportunities", id: 1, field: "name", equals: "x" })).toThrow(/no permitidos/);
  });

  it("distingue coincidencia, deriva y registro inexistente sin convertir errores en ausencia", async () => {
    expect(compareFact({ table: "opportunities", id: 1, field: "amount_usd", equals: "8000.00" }, [{ value: "8000.00" }]).ok).toBe(true);
    expect(compareFact({ table: "opportunities", id: 1, field: "amount_usd", equals: 7 }, [{ value: 7 }]).ok).toBe(true);
    expect(compareFact({ table: "contacts", id: 1, field: "position_title", contains: "Gerente" }, [{ value: "Director" }]).ok).toBe(false);
    expect(compareFact({ table: "contacts", id: 1, field: "position_title", equals: "x" }, [])).toMatchObject({ ok: false, reason: "registro_inexistente" });
    const bank = { facts: { count: { table: "quotations", where: { opportunity_id: 1 }, count: 0 } } };
    await expect(verifyBankFacts(bank, async () => { throw new Error("db down"); })).rejects.toThrow("db down");
    expect(await verifyBankFacts(bank, async () => [{ value: 2 }])).toEqual([{ factId: "count", ok: false, expected: 0, actual: 2 }]);
  });
});

describe("evaluación de respuestas", () => {
  it("verifica citas literales ignorando formato markdown, mayúsculas y espacios", () => {
    expect(quoteAppearsIn(answer, "importe registrado es 8,000 USD")).toBe(true);
    expect(quoteAppearsIn(answer, "LA COTIZACIÓN   ESTÁ APROBADA")).toBe(true);
    expect(quoteAppearsIn(answer, "el cliente aceptó la cotización")).toBe(false);
    expect(quoteAppearsIn(answer, "8,000 ... aceptara")).toBe(false);
    expect(quoteAppearsIn(answer, "El")).toBe(false);
  });

  it("aprueba solo con hechos críticos citados y sin afirmaciones prohibidas", () => {
    const grade = gradeTurn({ turn, execution: completed, judgement: judgement() });
    expect(grade).toMatchObject({ status: "passed", criticalPassed: 1, criticalTotal: 1, requiredPassed: 1, requiredTotal: 2, violations: [] });
  });

  it("no acepta un veredicto positivo cuya cita no aparece en la respuesta", () => {
    const grade = gradeTurn({ turn, execution: completed, judgement: judgement({
      required: [
        { id: "amount", verdict: "present", quotes: ["el importe es de ocho mil"], explanation: "x" },
        { id: "tone", verdict: "present", quotes: ["pero no consta"], explanation: "x" },
      ],
    }) });
    expect(grade.status).toBe("failed");
    expect(grade.criticalFailures).toEqual(["amount"]);
    expect(grade.unverified).toEqual(["amount"]);
  });

  it("marca una afirmación prohibida solo con cita verificable", () => {
    const violated = gradeTurn({ turn, execution: completed, judgement: judgement({
      forbidden: [{ id: "accepted", verdict: "present", quotes: ["La cotización está Aprobada"], explanation: "x" }],
    }) });
    expect(violated).toMatchObject({ status: "failed", violations: ["accepted"] });
    const unverified = gradeTurn({ turn, execution: completed, judgement: judgement({
      forbidden: [{ id: "accepted", verdict: "present", quotes: ["el cliente la aceptó"], explanation: "x" }],
    }) });
    expect(unverified).toMatchObject({ status: "passed", violations: [], unverified: ["accepted"] });
  });

  it("exige la cantidad de puntos pedida con su confirmación", () => {
    const formTurn = { ...turn, form: { kind: "exact_items", count: 2, itemRequirement: "confirmación" } };
    const grade = gradeTurn({ turn: formTurn, execution: completed, judgement: judgement({ form: {
      items: [
        { pointQuote: "importe registrado es 8,000 USD", confirmationQuote: "no consta que el cliente la aceptara" },
        { pointQuote: "La cotización está Aprobada", confirmationQuote: "" },
      ], ordered: true, explanation: "x",
    } }) });
    expect(grade.form).toMatchObject({ required: 2, found: 2, withConfirmation: 1, passed: false });
    expect(grade.status).toBe("failed");
  });

  it("bloquea errores y aclaraciones no permitidas aunque no haya evaluación", () => {
    expect(gradeTurn({ turn, execution: { ...completed, responseType: "clarification" }, judgement: judgement() }))
      .toMatchObject({ status: "failed", blocked: ["unexpected_clarification"] });
    expect(gradeTurn({ turn, execution: { status: "failed", answer: "" }, judgement: null }))
      .toMatchObject({ status: "failed", blocked: ["job_failed"] });
    expect(gradeTurn({ turn, execution: completed, judgement: null }).status).toBe("not_graded");
  });

  it("rechaza evaluaciones con veredictos faltantes o duplicados", () => {
    expect(() => validateJudgement(judgement({ required: [judgement().required[0], judgement().required[0]] }), turn))
      .toThrow(/exactamente un veredicto/);
    expect(() => validateJudgement({ ...judgement(), extra: true }, turn)).toThrow();
  });

  it("envía al evaluador el modelo pedido, los hechos de referencia y el esquema del turno", async () => {
    const call = vi.fn(async () => judgement());
    const bank = { facts: { "opp.amount": { table: "opportunities", id: 1, field: "amount_usd", equals: "8000.00", meaning: "importe" } } };
    await judgeTurn({ bank, turn, previousQuestions: ["antes"], answer, model: "modelo-evaluador", userId: 1, call });
    const request = call.mock.calls[0][0];
    expect(request.model).toBe("modelo-evaluador");
    expect(request.context.referenceFacts).toEqual([{ id: "opp.amount", fact: "opportunities#1.amount_usd = 8000.00 (importe)" }]);
    expect(request.context.previousQuestions).toEqual(["antes"]);
    expect(buildJudgeFields(turn).map((field) => field.key)).toEqual(["required", "forbidden"]);
    await expect(judgeTurn({ bank, turn, previousQuestions: [], answer, model: "m", userId: 1, call: async () => null }))
      .rejects.toThrow(/no está configurado/);
  });
});

describe("ejecución y reporte", () => {
  it("conserva la sesión entre turnos y registra fallos sin detener la conversación", async () => {
    const conversation = { id: "C", accountId: 1, turns: [{ ...turn, id: "A" }, { ...turn, id: "B" }, { ...turn, id: "C" }] };
    const runTurn = vi.fn()
      .mockResolvedValueOnce({ ...completed, jobId: 1, sessionId: 10, durationMs: 5 })
      .mockRejectedValueOnce(Object.assign(new Error("fallo"), { code: "X" }))
      .mockResolvedValueOnce({ ...completed, jobId: 3, sessionId: 10, durationMs: 7 });
    const result = await runConversation({ conversation, user: { id: 1 }, runTurn });
    expect(runTurn.mock.calls.map(([input]) => input.sessionId)).toEqual([null, 10, 10]);
    expect(result.turns.map((item) => item.execution.status)).toEqual(["completed", "runner_error", "completed"]);
  });

  it("resume métricas y genera un reporte legible", () => {
    const grade = gradeTurn({ turn, execution: completed, judgement: judgement() });
    const report = { engine: "legacy", startedAt: "2026-10-23T00:00:00.000Z", chatModel: "m", judgeModel: "j",
      factCheck: { total: 2, ok: 2 }, conversations: [{ conversationId: "C", turns: [{ turnId: "T1", question: turn.question,
        execution: { ...completed, jobId: 1, durationMs: 2000, aiUsage: { calls: 3, promptTokens: 10, completionTokens: 2, costUsd: 0.01 } }, grade }] }] };
    expect(summarizeRun(report)).toMatchObject({ passed: 1, graded: 1, criticalPassed: 1, aiCalls: 3, medianDurationMs: 2000 });
    const markdown = renderMarkdownReport(report);
    expect(markdown).toContain("| Turnos aprobados | 1/1 (100 %) |");
    expect(markdown).toContain("> El importe registrado es **8,000 USD**.");
  });
});
