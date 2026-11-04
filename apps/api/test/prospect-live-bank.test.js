import { describe, expect, it, vi } from "vitest";
import {
  emailsNotInSources, operationIssues, runDeterministicChecks, unsupportedNumbers,
} from "../src/channel-quality/live/checks.js";
import {
  buildProspectJudgeFields, describeSessionForJudge, gradeProspectTurn, judgeProspectTurn, validateProspectJudgement,
} from "../src/channel-quality/live/prospect-judge.js";
import { prospectBank, runProspectBank, runProspectScenario, summarizeProspectRun, validateBank } from "../src/channel-quality/live/prospect-live.js";

const turn = {
  id: "t1", question: "¿Qué contactos hay?", operations: "none", checks: {},
  mustInclude: [{ id: "a", statement: "Menciona a Laura Medina", critical: true }, { id: "b", statement: "Menciona su área", critical: false }],
  mustNotClaim: [{ id: "x", statement: "Da un correo" }],
};

describe("banco de evaluación de Cuenta nueva", () => {
  it("tiene 36 escenarios íntegros; los críticos son del 12 al 21 y el 26 y el 32", () => {
    expect(validateBank()).toEqual([]);
    expect(prospectBank.scenarios).toHaveLength(36);
    expect(prospectBank.scenarios.filter((item) => item.critical).map((item) => item.id))
      .toEqual(["S12", "S13", "S14", "S15", "S16", "S17", "S18", "S19", "S20", "S21", "S26", "S32"]);
    expect([...new Set(prospectBank.scenarios.map((item) => item.area))]).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("detecta ediciones que debilitan el banco", () => {
    const broken = structuredClone(prospectBank);
    broken.scenarios[0].turns[0].mustInclude = [];
    broken.scenarios[1].session = "inexistente";
    broken.scenarios[2].id = broken.scenarios[3].id;
    expect(validateBank(broken)).toEqual(expect.arrayContaining([
      expect.stringContaining("sin obligaciones"), expect.stringContaining("sesión inexistente"), expect.stringContaining("Escenario duplicado"),
    ]));
  });

  it("los datos de la sesión sintética no traen correos ni contactos de personas reales", () => {
    const text = JSON.stringify(prospectBank.sessions);
    expect(text).not.toMatch(/@/);
    expect(prospectBank.sessions.rica.contacts.every((contact) => contact.email === "")).toBe(true);
  });
});

describe("verificaciones deterministas", () => {
  it("exige operaciones confirmables, del canal y de un tipo permitido", () => {
    expect(operationIssues([], "none")).toEqual([]);
    expect(operationIssues([{ kind: "create_account" }], "none")).toEqual(["unexpected_operations"]);
    expect(operationIssues([{ kind: "create_account", requiresConfirmation: true, sourceChannel: "prospect" }], "confirmed_only")).toEqual([]);
    expect(operationIssues([{ kind: "delete_account", requiresConfirmation: false, sourceChannel: "coach" }], "confirmed_only").sort())
      .toEqual(["operation_kind_not_allowed", "operation_without_confirmation", "operation_wrong_channel"]);
  });

  it("detecta correos que no están en la sesión", () => {
    expect(emailsNotInSources("Escríbele a laura@empresa.mx", ["Laura Medina"])).toEqual(["laura@empresa.mx"]);
    expect(emailsNotInSources("Escríbele a laura@empresa.mx", ["contacto: Laura@Empresa.mx"])).toEqual([]);
  });

  it("detecta cifras inventadas e ignora numeración de listas, días y valores respaldados", () => {
    const sources = ["inversión de 40 millones de dólares en 2026", "15 de septiembre"];
    expect(unsupportedNumbers("1. La inversión es de 40 millones. 2. Fue el 15 de septiembre de 2026.", sources)).toEqual([]);
    expect(unsupportedNumbers("Tienen 1,200 empleados y facturan 350 millones.", sources).sort()).toEqual(["1200", "350"]);
    expect(unsupportedNumbers("Presupuesto de 40,000", ["presupuesto 40000"])).toEqual([]);
  });

  it("combina las verificaciones según lo que pide el turno", () => {
    const issues = runDeterministicChecks({
      turn: { operations: "none", checks: { noEmail: true, noUnsupportedNumbers: true } },
      response: { operations: [{ kind: "create_account" }] }, answer: "Escribe a x@y.com, son 500 empleados.", sources: ["sin datos"],
    });
    expect(issues).toEqual(["unexpected_operations", "unsupported_numbers:500", "invented_email:x@y.com"]);
  });
});

describe("juez de Cuenta nueva", () => {
  const judgement = {
    required: [{ id: "a", verdict: "present", quotes: ["Laura Medina"], explanation: "ok" }, { id: "b", verdict: "partial", quotes: [], explanation: "falta" }],
    forbidden: [{ id: "x", verdict: "absent", quotes: [], explanation: "no" }],
  };

  it("pide un veredicto por comprobación y rechaza respuestas incompletas", () => {
    expect(buildProspectJudgeFields(turn).map((field) => field.key)).toEqual(["required", "forbidden"]);
    expect(validateProspectJudgement(judgement, turn)).toEqual(judgement);
    expect(() => validateProspectJudgement({ ...judgement, required: judgement.required.slice(0, 1) }, turn)).toThrow("exactamente un veredicto");
    expect(() => validateProspectJudgement({ ...judgement, extra: 1 }, turn)).toThrow();
  });

  it("solo acepta una obligación si su cita aparece literalmente en la respuesta", () => {
    const execution = { status: "completed", answer: "Contacto: Laura Medina, Operaciones." };
    expect(gradeProspectTurn({ turn, execution, judgement }).required[0].status).toBe("passed");
    const fabricated = { ...judgement, required: [{ id: "a", verdict: "present", quotes: ["Roberto Zúñiga"], explanation: "x" }, judgement.required[1]] };
    const graded = gradeProspectTurn({ turn, execution, judgement: fabricated });
    expect(graded.required[0].status).toBe("unverified");
    expect(graded.status).toBe("failed");
    expect(graded.criticalFailures).toEqual(["a"]);
  });

  it("falla por una afirmación prohibida citada, por una verificación determinista o por un error del turno", () => {
    const execution = { status: "completed", answer: "Laura Medina: laura@x.com" };
    const violated = { ...judgement, forbidden: [{ id: "x", verdict: "present", quotes: ["laura@x.com"], explanation: "dio correo" }] };
    expect(gradeProspectTurn({ turn, execution, judgement: violated }).violations).toEqual(["x"]);
    expect(gradeProspectTurn({ turn, execution, judgement, deterministicIssues: ["invented_email:laura@x.com"] }).status).toBe("failed");
    expect(gradeProspectTurn({ turn, execution: { status: "error", answer: "" }, judgement: null }).status).toBe("failed");
    expect(gradeProspectTurn({ turn, execution, judgement: null }).status).toBe("not_graded");
  });

  it("envía a la IA la sesión de referencia y las afirmaciones, sin pedir nada de CRM", async () => {
    const call = vi.fn().mockResolvedValue(judgement);
    await judgeProspectTurn({ session: prospectBank.sessions.rica, turn, previousTurns: [], answer: "Laura Medina", model: "m", userId: 3, call });
    const request = call.mock.calls[0][0];
    expect(request.model).toBe("m");
    expect(request.context.referenceSession.contacts.map((item) => item.name)).toContain("Laura Medina");
    expect(request.context.required).toHaveLength(2);
    expect(request.aiUsageContext).toMatchObject({ userId: 3, jobType: "acceptance_judge" });
    expect(describeSessionForJudge(prospectBank.sessions.duplicado).crmContext.duplicateCandidates).toHaveLength(1);
  });
});

describe("ejecución del banco", () => {
  const goodJudge = async ({ turn: judged }) => ({
    required: judged.mustInclude.map((item) => ({ id: item.id, verdict: "present", quotes: ["respuesta"], explanation: "ok" })),
    ...(judged.mustNotClaim.length ? { forbidden: judged.mustNotClaim.map((item) => ({ id: item.id, verdict: "absent", quotes: [], explanation: "no" })) } : {}),
  });
  const adapterWith = (response) => () => ({ runTurn: async () => ({ response: { answer: "respuesta", operations: [], ...response }, qualityTrace: { validationStatus: "valid" } }) });

  it("pasa el historial acumulado y cuenta un escenario aprobado", async () => {
    const histories = [];
    const createAdapter = () => ({ runTurn: async ({ history }) => { histories.push(history.length); return { response: { answer: "respuesta", operations: [] }, qualityTrace: {} }; } });
    const scenario = prospectBank.scenarios.find((item) => item.id === "S23");
    const result = await runProspectScenario({ scenario, user: { id: 1 }, judgeModel: "m", nextJobId: () => 1, createAdapter, judge: goodJudge });
    expect(histories).toEqual([0, 2, 4]);
    expect(result.status).toBe("passed");
  });

  it("falla un escenario cuando una operación no pide confirmación aunque el juez lo apruebe", async () => {
    const scenario = prospectBank.scenarios.find((item) => item.id === "S17");
    const createAdapter = adapterWith({ operations: [{ kind: "create_account", requiresConfirmation: false, sourceChannel: "prospect" }] });
    const result = await runProspectScenario({ scenario, user: { id: 1 }, judgeModel: "m", nextJobId: () => 1, createAdapter, judge: goodJudge });
    expect(result.status).toBe("failed");
    expect(result.turns[0].grade.deterministicIssues).toEqual(["operation_without_confirmation"]);
  });

  it("separa la calidad del contenido de las operaciones propuestas de más", async () => {
    const scenario = prospectBank.scenarios.find((item) => item.id === "S02");
    const createAdapter = adapterWith({ operations: [{ kind: "create_contact", requiresConfirmation: true, sourceChannel: "prospect" }] });
    const result = await runProspectScenario({ scenario, user: { id: 1 }, judgeModel: "m", nextJobId: () => 1, createAdapter, judge: goodJudge });
    expect(result.status).toBe("failed");
    const { groups } = summarizeProspectRun([result]);
    expect(groups.cases).toEqual({ passed: 0, total: 1 });
    expect(groups.content).toEqual({ passed: 1, total: 1 });
    expect(groups.operations).toEqual({ passed: 0, total: 1 });
  });

  it("convierte un error del adaptador en un turno fallido y no deja de evaluar", async () => {
    const createAdapter = () => ({ runTurn: async () => { throw new Error("proveedor caído"); } });
    const scenario = prospectBank.scenarios[0];
    const result = await runProspectScenario({ scenario, user: { id: 1 }, judgeModel: "m", nextJobId: () => 1, createAdapter, judge: goodJudge });
    expect(result.turns[0]).toMatchObject({ status: "failed", errorMessage: "proveedor caído" });
  });

  it("sin modelo evaluador no califica ni cuenta los escenarios", async () => {
    const run = await runProspectBank({ user: { id: 1 }, only: ["S01"], createAdapter: adapterWith({}) });
    expect(run.scenarios[0].status).toBe("not_graded");
    expect(run.groups.cases).toEqual({ passed: 0, total: 0 });
    expect(run.notGraded).toBe(1);
  });

  it("resume casos, críticos, afirmaciones y áreas, con el detalle de lo que falló", async () => {
    const run = await runProspectBank({ user: { id: 1 }, judgeModel: "m", createAdapter: adapterWith({}), judge: goodJudge, concurrency: 4 });
    expect(run.scenarios).toHaveLength(36);
    // Operations are absent in every scenario, so everything passes except those whose deterministic checks cannot pass.
    expect(run.groups.cases.total).toBe(36);
    expect(run.groups.critical.total).toBe(12);
    expect(Object.keys(run.groups)).toEqual(["cases", "critical", "content", "operations", "claims", "area_a", "area_b", "area_c", "area_d", "area_e", "area_f"]);
    expect(summarizeProspectRun(run.scenarios).groups.claims.total).toBe(run.groups.claims.total);
  });
});
