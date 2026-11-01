import bank from "./prospect-bank.json" with { type: "json" };
import { createProspectChatAdapter } from "../../prospect-research/prospect-chat-adapter.js";
import { runDeterministicChecks } from "./checks.js";
import { gradeProspectTurn, judgeProspectTurn } from "./prospect-judge.js";

export const prospectBank = bank;

// Integrity of the bank itself: runs without AI and guards against edits that would silently weaken the evaluation.
export function validateBank(candidate = bank) {
  const problems = [];
  const ids = new Set();
  for (const scenario of candidate.scenarios) {
    if (ids.has(scenario.id)) problems.push(`Escenario duplicado: ${scenario.id}`);
    ids.add(scenario.id);
    if (!candidate.sessions[scenario.session]) problems.push(`${scenario.id}: sesión inexistente (${scenario.session})`);
    if (!scenario.turns?.length) problems.push(`${scenario.id}: sin turnos`);
    const turnIds = new Set();
    for (const turn of scenario.turns || []) {
      if (turnIds.has(turn.id)) problems.push(`${scenario.id}/${turn.id}: turno duplicado`);
      turnIds.add(turn.id);
      if (!String(turn.question || "").trim()) problems.push(`${scenario.id}/${turn.id}: sin pregunta`);
      if (!turn.mustInclude?.length) problems.push(`${scenario.id}/${turn.id}: sin obligaciones`);
      const claimIds = [...(turn.mustInclude || []), ...(turn.mustNotClaim || [])].map((item) => item.id);
      if (new Set(claimIds).size !== claimIds.length) problems.push(`${scenario.id}/${turn.id}: afirmaciones con id repetido`);
      if (!["none", "confirmed_only"].includes(turn.operations)) problems.push(`${scenario.id}/${turn.id}: política de operaciones inválida`);
    }
  }
  return problems;
}

const sourcesOf = (session, history, question) => [JSON.stringify(session), ...history.map((item) => item.text), question];

async function executeTurn({ session, turn, history, user, jobId, createAdapter }) {
  const startedAt = Date.now();
  try {
    const adapter = createAdapter({ user, session, jobId });
    const result = await adapter.runTurn({ question: turn.question, history });
    return {
      status: "completed",
      answer: String(result?.response?.answer || ""),
      response: result?.response || null,
      validationStatus: result?.qualityTrace?.validationStatus || null,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      status: "error", answer: "", response: null, validationStatus: null, durationMs: Date.now() - startedAt,
      errorMessage: String(error?.message || error).slice(0, 500),
    };
  }
}

export async function runProspectScenario({ scenario, user, judgeModel = null, nextJobId, log = () => {},
  createAdapter = createProspectChatAdapter, judge = judgeProspectTurn, sessions = bank.sessions }) {
  const session = structuredClone(sessions[scenario.session]);
  const history = [];
  const previousTurns = [];
  const turns = [];
  for (const turn of scenario.turns) {
    log(`${scenario.id}/${turn.id}: ejecutando`);
    const execution = await executeTurn({ session, turn, history: [...history], user, jobId: nextJobId(), createAdapter });
    const deterministicIssues = execution.status === "completed"
      ? runDeterministicChecks({ turn, response: execution.response, answer: execution.answer, sources: sourcesOf(session, history, turn.question) })
      : [];
    let judgement = null;
    let judgeError = null;
    if (judgeModel && execution.answer) {
      try {
        judgement = await judge({ session, turn, previousTurns: [...previousTurns], answer: execution.answer, model: judgeModel, userId: user.id });
      } catch (error) {
        judgeError = String(error?.message || error).slice(0, 500);
      }
    }
    const grade = gradeProspectTurn({ turn, execution, judgement, deterministicIssues });
    turns.push({
      turnId: turn.id, question: turn.question, answer: execution.answer, status: grade.status, durationMs: execution.durationMs,
      errorMessage: execution.errorMessage || null, judgeError, grade,
      operations: (execution.response?.operations || []).map((operation) => ({ kind: operation.kind, title: operation.title })),
    });
    history.push({ role: "user", text: turn.question }, { role: "assistant", text: execution.answer });
    previousTurns.push({ question: turn.question, answer: execution.answer });
  }
  const passed = turns.every((item) => item.status === "passed");
  const notGraded = turns.some((item) => item.status === "not_graded");
  return {
    id: scenario.id, title: scenario.title, area: scenario.area, critical: Boolean(scenario.critical),
    futureCapability: Boolean(scenario.futureCapability), status: notGraded ? "not_graded" : passed ? "passed" : "failed", turns,
  };
}

const count = (items) => ({ passed: items.filter((item) => item.passed).length, total: items.length });
const isOperationIssue = (issue) => issue === "unexpected_operations" || issue.startsWith("operation_");

// A turn passes on content when nothing is wrong except its proposed operations, which are scored on their own.
const contentPassed = (turn) => !turn.grade.blocked?.length && !turn.grade.criticalFailures?.length && !turn.grade.violations?.length
  && !(turn.grade.deterministicIssues || []).filter((issue) => !isOperationIssue(issue)).length && turn.status !== "not_graded";

// groups.cases is the main score; critical scenarios must all pass; claims gives finer granularity.
export function summarizeProspectRun(scenarios) {
  const graded = scenarios.filter((item) => item.status !== "not_graded");
  const asItem = (item) => ({ passed: item.status === "passed" });
  const groups = {
    cases: count(graded.map(asItem)),
    critical: count(graded.filter((item) => item.critical).map(asItem)),
  };
  groups.content = count(graded.map((item) => ({ passed: item.turns.every(contentPassed) })));
  groups.operations = count(graded.flatMap((item) => item.turns).map((turn) => ({
    passed: !(turn.grade.deterministicIssues || []).some(isOperationIssue),
  })));
  const claims = graded.flatMap((item) => item.turns).map((turn) => ({
    passed: turn.grade.requiredPassed || 0, total: turn.grade.requiredTotal || 0,
  }));
  groups.claims = { passed: claims.reduce((sum, item) => sum + item.passed, 0), total: claims.reduce((sum, item) => sum + item.total, 0) };
  for (const area of [...new Set(graded.map((item) => item.area))].sort()) {
    groups[`area_${area.toLowerCase()}`] = count(graded.filter((item) => item.area === area).map(asItem));
  }
  const failures = graded.filter((item) => item.status === "failed").map((item) => ({
    group: item.id, id: item.id, passed: false,
    error: item.turns.filter((turn) => turn.status !== "passed").map((turn) => [
      ...(turn.grade.blocked || []), ...(turn.grade.criticalFailures || []).map((id) => `critical:${id}`),
      ...(turn.grade.violations || []).map((id) => `violation:${id}`), ...(turn.grade.deterministicIssues || []),
    ].join(",")).filter(Boolean).join(" | ").slice(0, 280) || "failed",
  }));
  return { groups, results: failures, notGraded: scenarios.length - graded.length };
}

export async function runProspectBank({ user, judgeModel = null, only = null, concurrency = 3, log = () => {}, ...options }) {
  const selected = prospectBank.scenarios.filter((scenario) => !only || only.includes(scenario.id));
  let jobCounter = Math.floor(Date.now() / 1000) * 100;
  const nextJobId = () => (jobCounter += 1);
  const results = new Array(selected.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= selected.length) return;
      results[index] = await runProspectScenario({ scenario: selected[index], user, judgeModel, nextJobId, log, ...options });
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, selected.length)) }, worker));
  return { scenarios: results, ...summarizeProspectRun(results) };
}
