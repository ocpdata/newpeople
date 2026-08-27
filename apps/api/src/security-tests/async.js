import { processPendingSecurityTestJobs } from "./service.js";

const POLL_INTERVAL_MS = 3000;
let started = false;
let running = false;
let timer;

export function queueSecurityTestProcessing() {
  if (process.env.NODE_ENV === "test") return;
  setTimeout(() => processSecurityTestJobs(), 0);
}

async function processSecurityTestJobs() {
  if (running) return;
  running = true;
  try {
    await processPendingSecurityTestJobs({ limit: 1 });
  } catch (error) {
    console.error("Security test processing error:", error?.message || error);
  } finally {
    running = false;
  }
}

export function startSecurityTestWorker() {
  if (started || process.env.NODE_ENV === "test") return;
  started = true;
  queueSecurityTestProcessing();
  timer = setInterval(processSecurityTestJobs, POLL_INTERVAL_MS);
  timer.unref?.();
}
