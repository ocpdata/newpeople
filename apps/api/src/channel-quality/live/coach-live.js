import bank from "./coach-bank.json" with { type: "json" };
import { renderFacts } from "./coach-facts.js";
import { gradeProspectTurn } from "./prospect-judge.js";
import { judgeCoachTurn } from "./coach-judge.js";
import { summarizeProspectRun } from "./prospect-live.js";

export const coachBank = bank;

const MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 1500;
const TURN_DEADLINE_MS = 120000;
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Integrity of the bank itself: runs without AI and guards against edits that would silently weaken the evaluation.
export function validateCoachBank(candidate = bank) {
  const problems = [];
  const ids = new Set();
  for (const scenario of candidate.scenarios) {
    if (ids.has(scenario.id)) problems.push(`Escenario duplicado: ${scenario.id}`);
    ids.add(scenario.id);
    if (!scenario.turns?.length) problems.push(`${scenario.id}: sin turnos`);
    for (const turn of scenario.turns || []) {
      if (!String(turn.question || "").trim()) problems.push(`${scenario.id}/${turn.id}: sin pregunta`);
      if (!turn.mustInclude?.length) problems.push(`${scenario.id}/${turn.id}: sin obligaciones`);
      const claimIds = [...(turn.mustInclude || []), ...(turn.mustNotClaim || [])].map((item) => item.id);
      if (new Set(claimIds).size !== claimIds.length) problems.push(`${scenario.id}/${turn.id}: afirmaciones con id repetido`);
      if (!["none", "confirmed_only"].includes(turn.operations || "none")) problems.push(`${scenario.id}/${turn.id}: política de operaciones inválida`);
    }
  }
  return problems;
}

export function renderScenario(scenario, facts) {
  const claim = (item) => ({ ...item, statement: renderFacts(item.statement, facts) });
  return {
    ...scenario,
    turns: scenario.turns.map((turn) => ({
      ...turn,
      question: renderFacts(turn.question, facts),
      mustInclude: turn.mustInclude.map(claim),
      mustNotClaim: (turn.mustNotClaim || []).map(claim),
    })),
  };
}

// Deterministic checks: whatever the judge says, an operation must wait for the seller's confirmation, and a clear
// question must not be answered with a request for clarification.
export function coachDeterministicIssues({ turn, response }) {
  const operations = Array.isArray(response?.operations) ? response.operations : [];
  const issues = [];
  if ((turn.operations || "none") === "none" && operations.length) issues.push("unexpected_operations");
  if (operations.some((operation) => operation?.requiresConfirmation !== true)) issues.push("operation_without_confirmation");
  if (turn.checks?.mustAnswer && response?.responseType === "clarification") issues.push("unexpected_clarification");
  return [...new Set(issues)];
}

// Runs the turns through the real HTTP routes (the same path the web app uses) against an in-process server.
export function createCoachHttpClient({ baseUrl, token }) {
  const call = async (path, body) => {
    const response = await fetch(`${baseUrl}/api/mi-agent${path}`, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, json: await response.json().catch(() => null) };
  };
  return {
    async ask({ question, sessionId }) {
      const startedAt = Date.now();
      const started = await call("/coach", { question, ...(sessionId ? { sessionId } : {}) });
      const jobId = started.json?.job?.id;
      if (started.status !== 202 || !jobId) {
        return { status: "error", answer: "", response: null, sessionId, durationMs: Date.now() - startedAt, errorMessage: `HTTP ${started.status} ${started.json?.message || ""}`.trim() };
      }
      for (;;) {
        await wait(POLL_INTERVAL_MS);
        const polled = await call(`/coach/jobs/${jobId}`);
        const status = polled.json?.job?.status;
        if (status === "completed" || status === "failed") {
          const result = polled.json?.result || null;
          return {
            status: status === "completed" ? "completed" : "error",
            answer: String(result?.answer || ""),
            response: result,
            sessionId: started.json.sessionId || sessionId,
            durationMs: Date.now() - startedAt,
            errorMessage: polled.json?.job?.errorMessage || null,
          };
        }
        if (Date.now() - startedAt > TURN_DEADLINE_MS) {
          return { status: "error", answer: "", response: null, sessionId: started.json.sessionId || sessionId, durationMs: Date.now() - startedAt, errorMessage: "timeout" };
        }
      }
    },
    // Cancels pending operations and closes the session so the test conversation does not stay open for the user.
    async cleanup({ sessionId, operationIds }) {
      for (const id of operationIds) await call(`/coach/operations/${id}/status`, { status: "cancelled", cancellationReason: "Banco de evaluación" }).catch(() => null);
      if (sessionId) await call(`/coach/sessions/${sessionId}/close`, {}).catch(() => null);
    },
  };
}

export async function runCoachScenario({ scenario, facts, user, client, judgeModel = null, log = () => {}, judge = judgeCoachTurn }) {
  const rendered = renderScenario(scenario, facts);
  const previousTurns = [];
  const turns = [];
  const operationIds = [];
  let sessionId = null;
  for (const turn of rendered.turns) {
    log(`${scenario.id}/${turn.id}: ejecutando`);
    // The provider answers an occasional 429 even with credit; that is not Coach's quality, so a turn that ended in an
    // error response is asked again (a real Coach failure repeats and still counts).
    let execution;
    let attempts = 0;
    do {
      attempts += 1;
      execution = await client.ask({ question: turn.question, sessionId });
    } while (execution.response?.responseType === "error" && attempts < MAX_ATTEMPTS);
    sessionId = execution.sessionId || sessionId;
    for (const operation of execution.response?.operations || []) if (operation?.persistentId) operationIds.push(operation.persistentId);
    const deterministicIssues = execution.status === "completed" ? coachDeterministicIssues({ turn, response: execution.response }) : [];
    let judgement = null;
    let judgeError = null;
    if (judgeModel && execution.answer) {
      for (let attempt = 1; !judgement && attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          judgement = await judge({ facts, turn, previousTurns: [...previousTurns], answer: execution.answer, model: judgeModel, userId: user.id });
          judgeError = null;
        } catch (error) {
          judgeError = String(error?.message || error).slice(0, 500);
          if (!/\b429\b/.test(judgeError)) break;
        }
      }
    }
    const grade = gradeProspectTurn({ turn, execution, judgement, deterministicIssues });
    turns.push({
      turnId: turn.id, question: turn.question, answer: execution.answer, status: grade.status, durationMs: execution.durationMs,
      errorMessage: execution.errorMessage || null, judgeError, attempts, grade, responseType: execution.response?.responseType || null,
      intent: execution.response?.intent || null,
      operations: (execution.response?.operations || []).map((operation) => ({ kind: operation.kind, title: operation.title })),
    });
    previousTurns.push({ question: turn.question, answer: execution.answer });
  }
  await client.cleanup({ sessionId, operationIds });
  const passed = turns.every((item) => item.status === "passed");
  const notGraded = turns.some((item) => item.status === "not_graded");
  return { id: scenario.id, title: scenario.title, area: scenario.area, critical: Boolean(scenario.critical), status: notGraded ? "not_graded" : passed ? "passed" : "failed", turns };
}

export async function runCoachBank({ user, client, facts, judgeModel = null, only = null, concurrency = 3, log = () => {}, bank: selectedBank = coachBank, ...options }) {
  const selected = selectedBank.scenarios.filter((scenario) => !only || only.includes(scenario.id));
  const results = new Array(selected.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= selected.length) return;
      results[index] = await runCoachScenario({ scenario: selected[index], facts, user, client, judgeModel, log, ...options });
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, selected.length)) }, worker));
  return { scenarios: results, ...summarizeProspectRun(results) };
}

export const MAX_REPETITIONS = 5;

// A scenario passes only when every graded repetition passes. The stability group counts the scenarios that gave the same
// verdict every time, so an answer that passes by luck shows up even when the overall score looks fine.
export function combineRepetitions(runs) {
  const byId = new Map();
  for (const run of runs) for (const scenario of run.scenarios) byId.set(scenario.id, [...(byId.get(scenario.id) || []), scenario]);
  const scenarios = [...byId.values()].map((list) => {
    const graded = list.filter((item) => item.status !== "not_graded");
    const passed = graded.filter((item) => item.status === "passed").length;
    const representative = graded.find((item) => item.status !== "passed") || list[0];
    const status = !graded.length ? "not_graded" : passed === graded.length ? "passed" : "failed";
    return { ...representative, status, repetitions: { total: graded.length, passed } };
  });
  const summary = summarizeProspectRun(scenarios);
  const repeated = scenarios.filter((item) => item.repetitions.total > 1);
  const consistent = repeated.filter((item) => item.repetitions.passed === 0 || item.repetitions.passed === item.repetitions.total);
  const groups = repeated.length ? { ...summary.groups, stability: { passed: consistent.length, total: repeated.length } } : summary.groups;
  const results = summary.results.map((result) => {
    const { passed, total } = scenarios.find((item) => item.id === result.id)?.repetitions || {};
    return passed > 0 && passed < total ? { ...result, flaky: true, error: `inestable ${passed}/${total}: ${result.error}` } : result;
  });
  return { scenarios, ...summary, groups, results };
}

export async function runCoachBankRepeated({ repeat = 1, ...options }) {
  const count = Math.min(MAX_REPETITIONS, Math.max(1, Math.floor(Number(repeat)) || 1));
  const runs = [];
  for (let index = 0; index < count; index += 1) runs.push(await runCoachBank(options));
  return count === 1 ? runs[0] : combineRepetitions(runs);
}
