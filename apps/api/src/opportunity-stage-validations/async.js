import { processPendingOpportunityStageValidationJobs } from "./service.js";

const WORKER_POLL_INTERVAL_MS = 3000;

let queued = false;
let workerStarted = false;

export function queueOpportunityStageValidationProcessing() {
  queued = true;
}

export async function startOpportunityStageValidationWorker() {
  if (workerStarted) {
    return;
  }
  workerStarted = true;

  const tick = async () => {
    if (!queued) {
      return;
    }

    queued = false;
    try {
      const processed = await processPendingOpportunityStageValidationJobs({
        limit: 5,
      });
      if (processed > 0) {
        queued = true;
      }
    } catch (error) {
      console.error(
        "Opportunity stage validation worker error:",
        error?.message || error,
      );
    }
  };

  const interval = setInterval(() => {
    tick();
  }, WORKER_POLL_INTERVAL_MS);
  interval.unref?.();

  queueOpportunityStageValidationProcessing();
  await tick();
}