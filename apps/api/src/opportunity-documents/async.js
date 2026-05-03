import { config } from "../config.js";
import { processPendingOpportunityDocumentJobs } from "./service.js";

let workerStarted = false;
let workerTimer = null;
let workerRunning = false;

export function buildOpportunityDocumentExecutionPlan() {
  const mode = config.documents.processing.mode;
  return {
    mode,
    canDefer: mode === "async_in_process",
    queueName: "opportunity-document-processing",
    strategy:
      mode === "async_in_process"
        ? "db_backed_in_process_worker"
        : "inline_processing",
  };
}

export function queueOpportunityDocumentProcessing() {
  if (config.documents.processing.mode !== "async_in_process") {
    return;
  }

  setTimeout(async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      await processPendingOpportunityDocumentJobs({ limit: 2 });
    } catch (error) {
      console.error(
        "Queued opportunity document processing error:",
        error?.message || error,
      );
    } finally {
      workerRunning = false;
    }
  }, 0);
}

export async function startOpportunityDocumentProcessingWorker() {
  if (
    workerStarted ||
    config.documents.processing.mode !== "async_in_process"
  ) {
    return;
  }

  workerStarted = true;
  queueOpportunityDocumentProcessing();
  workerTimer = setInterval(async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      await processPendingOpportunityDocumentJobs({ limit: 5 });
    } catch (error) {
      console.error(
        "Scheduled opportunity document processing error:",
        error?.message || error,
      );
    } finally {
      workerRunning = false;
    }
  }, config.documents.processing.pollIntervalMs);

  if (typeof workerTimer?.unref === "function") {
    workerTimer.unref();
  }
}
