import { query } from "../db.js";
import { ensureCommercialIntelligenceSchema } from "./schema.js";

export const STALE_JOB_MINUTES = 20;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const STALE_JOB_MESSAGE = "La solicitud no terminó y se cerró automáticamente. Intenta nuevamente.";

// Jobs run in-process, so a restart or an unexpected error can leave them 'pending' forever.
// Any unfinished job without activity for STALE_JOB_MINUTES is closed as failed.
export async function failStaleCustomerIntelligenceJobs({ olderThanMinutes = STALE_JOB_MINUTES } = {}) {
  await ensureCommercialIntelligenceSchema();
  const result = await query(
    `UPDATE customer_intelligence_jobs
     SET status = 'failed', error_message = ?, updated_at = NOW(3), finished_at = NOW(3)
     WHERE finished_at IS NULL AND status IN ('pending', 'running', 'processing')
       AND updated_at < DATE_SUB(NOW(3), INTERVAL ? MINUTE)`,
    [STALE_JOB_MESSAGE, Number(olderThanMinutes)],
  );
  return Number(result?.affectedRows || 0);
}

async function sweep() {
  try {
    const closed = await failStaleCustomerIntelligenceJobs();
    if (closed > 0) console.warn(`[customer-intelligence] ${closed} job(s) atascados cerrados como fallidos`);
  } catch (error) {
    console.error("[customer-intelligence] No fue posible limpiar jobs atascados:", error?.message || error);
  }
}

let started = false;
export function startStaleJobReaper() {
  if (started || process.env.NODE_ENV === "test") return;
  started = true;
  void sweep();
  const timer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
  timer.unref?.();
}
