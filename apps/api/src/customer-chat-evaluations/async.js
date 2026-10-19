import { processPendingEvaluations } from "./service.js";

let running = false;
let started = false;
async function tick() {
  if (running) return;
  running = true;
  try { await processPendingEvaluations(); }
  catch (error) { console.error("[customer-chat-evaluation] Worker error:", error); }
  finally { running = false; }
}
export function queueEvaluationProcessing() {
  if (process.env.NODE_ENV !== "test") setImmediate(() => { void tick(); });
}
export function startEvaluationWorker() {
  if (started || process.env.NODE_ENV === "test") return;
  started = true;
  const timer = setInterval(() => { void tick(); }, 10000);
  timer.unref?.();
}
