import { processPendingAccountDraftAnalysisJobs } from "./jobs-service.js";

const WORKER_POLL_INTERVAL_MS = 3000;

let workerStarted = false;
let workerTimer = null;
let workerRunning = false;

export function buildAccountDraftAnalysisExecutionPlan({
  options,
  supportsStructuredResearch,
}) {
  const strategy = supportsStructuredResearch
    ? "structured_web_research"
    : "heuristic_pipeline";

  return {
    mode: "sync",
    canDefer: true,
    queueName: "account-draft-analysis",
    strategy,
  };
}

export function queueAccountDraftAnalysisProcessing() {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  setTimeout(async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      await processPendingAccountDraftAnalysisJobs({ limit: 2 });
    } catch (error) {
      console.error(
        "Queued account draft analysis processing error:",
        error?.message || error,
      );
    } finally {
      workerRunning = false;
    }
  }, 0);
}

export async function startAccountDraftAnalysisWorker() {
  if (workerStarted || process.env.NODE_ENV === "test") {
    return;
  }

  workerStarted = true;
  queueAccountDraftAnalysisProcessing();
  workerTimer = setInterval(async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      await processPendingAccountDraftAnalysisJobs({ limit: 5 });
    } catch (error) {
      console.error(
        "Scheduled account draft analysis processing error:",
        error?.message || error,
      );
    } finally {
      workerRunning = false;
    }
  }, WORKER_POLL_INTERVAL_MS);

  if (typeof workerTimer?.unref === "function") {
    workerTimer.unref();
  }
}
