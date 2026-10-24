import {
  createCustomerAccountChatJob,
  getCustomerIntelligenceJob,
  processCustomerAccountChatJob,
} from "../commercial-intelligence/service.js";

const TURN_DEADLINE_MS = 90000;

export async function runLegacyTurn({ user, conversation, turn, sessionId }) {
  return runChatTurn({ user, conversation, turn, sessionId, payload: conversation.focusOpportunityId
    ? { opportunityId: conversation.focusOpportunityId } : {} });
}

export async function runDossierTurn({ user, conversation, turn, sessionId }) {
  return runChatTurn({ user, conversation, turn, sessionId, payload: conversation.focusOpportunityId
    ? { focusOpportunityId: conversation.focusOpportunityId } : {} });
}

async function runChatTurn({ user, conversation, turn, sessionId, payload }) {
  const startedAt = Date.now();
  const { job } = await createCustomerAccountChatJob({ user, payload: {
    accountId: conversation.accountId,
    ...payload,
    question: turn.question,
    includePublicResearch: false,
    ...(sessionId ? { chatSessionId: sessionId } : {}),
  } });
  await processCustomerAccountChatJob({ jobId: job.id, user, deadlineAt: Date.now() + TURN_DEADLINE_MS });
  const finished = await getCustomerIntelligenceJob({ user, jobId: job.id });
  return {
    jobId: Number(job.id),
    sessionId: Number(job.chatSessionId),
    status: finished?.status || "missing",
    answer: String(finished?.result?.answer || ""),
    responseType: finished?.result?.responseType || null,
    presentationStatus: finished?.result?.presentation?.status || null,
    presentationReason: finished?.result?.presentation?.reasonCode || null,
    errorCode: finished?.result?.errorCode || null,
    errorMessage: finished?.errorMessage || null,
    engine: finished?.result?.presentation?.engine || "legacy",
    citations: Array.isArray(finished?.result?.dossierCitations) ? finished.result.dossierCitations.length : 0,
    durationMs: Date.now() - startedAt,
  };
}

export const ENGINES = Object.freeze({ legacy: runLegacyTurn, dossier: runDossierTurn });

export async function runConversation({ conversation, user, engine = "legacy", runTurn = ENGINES[engine], log = () => {} }) {
  if (!runTurn) throw new Error(`Motor de chat desconocido: ${engine}`);
  let sessionId = null;
  const turns = [];
  for (const turn of conversation.turns) {
    log(`${conversation.id}/${turn.id}: ejecutando`);
    let execution;
    const startedAt = Date.now();
    try {
      execution = await runTurn({ user, conversation, turn, sessionId });
      sessionId = execution.sessionId || sessionId;
    } catch (error) {
      execution = {
        status: "runner_error", answer: "", errorCode: error?.code || null,
        errorMessage: String(error?.message || error).slice(0, 500), durationMs: Date.now() - startedAt,
      };
    }
    log(`${conversation.id}/${turn.id}: ${execution.status} en ${Math.round(execution.durationMs / 1000)} s`);
    turns.push({ turnId: turn.id, question: turn.question, execution });
  }
  return { conversationId: conversation.id, engine, sessionId, turns };
}

export async function loadAiUsageByJob(run, jobIds) {
  if (!jobIds.length) return new Map();
  const rows = await run(
    `SELECT job_id, COUNT(*) AS calls, SUM(prompt_tokens) AS prompt_tokens,
            SUM(completion_tokens) AS completion_tokens, SUM(cost_micros) AS cost_micros,
            GROUP_CONCAT(DISTINCT model) AS models
     FROM ai_usage_ledger WHERE job_type = 'account_chat' AND job_id IN (?) GROUP BY job_id`,
    [jobIds],
  );
  return new Map(rows.map((row) => [Number(row.job_id), {
    calls: Number(row.calls), promptTokens: Number(row.prompt_tokens || 0),
    completionTokens: Number(row.completion_tokens || 0), costUsd: Number(row.cost_micros || 0) / 1e6,
    models: String(row.models || "").split(",").filter(Boolean),
  }]));
}

export async function assertModelPriced(run, model) {
  const rows = await run(
    `SELECT id FROM ai_pricing_rates WHERE provider = 'openai' AND model = ?
       AND valid_from_utc <= NOW(3) AND (valid_to_utc IS NULL OR valid_to_utc > NOW(3)) LIMIT 1`,
    [model],
  );
  if (!rows.length) {
    throw Object.assign(new Error(`El modelo ${model} no tiene tarifa vigente en ai_pricing_rates. Regístrala antes de evaluar: sin tarifa, la llamada se cobra y después falla al registrar el consumo.`),
      { code: "ACCEPTANCE_MODEL_NOT_PRICED" });
  }
}
