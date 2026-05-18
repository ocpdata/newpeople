import { processPendingOpportunityStageAnswerSuggestionJobs } from "./service.js";

const WORKER_POLL_INTERVAL_MS = 3000;

let workerStarted = false;
let workerTimer = null;
let workerRunning = false;

export function queueOpportunityStageAnswerSuggestionProcessing() {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  setTimeout(async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      await processPendingOpportunityStageAnswerSuggestionJobs({ limit: 2 });
    } catch (error) {
      console.error(
        "Queued opportunity stage answer suggestion processing error:",
        error?.message || error,
      );
    } finally {
      workerRunning = false;
    }
  }, 0);
}

export async function startOpportunityStageAnswerSuggestionWorker() {
  if (workerStarted || process.env.NODE_ENV === "test") {
    return;
  }

  workerStarted = true;
  queueOpportunityStageAnswerSuggestionProcessing();
  workerTimer = setInterval(async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      await processPendingOpportunityStageAnswerSuggestionJobs({ limit: 5 });
    } catch (error) {
      console.error(
        "Scheduled opportunity stage answer suggestion processing error:",
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
