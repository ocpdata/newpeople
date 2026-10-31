import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query } from "../src/db.js";
import {
  cancelCustomerAccountChatJob,
  getCustomerIntelligenceJob,
} from "../src/commercial-intelligence/service.js";
import { createChatProgressReporter } from "../src/commercial-intelligence/chat-progress.js";
import { failStaleCustomerIntelligenceJobs } from "../src/commercial-intelligence/stale-jobs.js";
import { TEST_PREFIX, createUser } from "./helpers/apiTestUtils.js";

describe("ciclo de vida de los jobs del chat de cliente", () => {
  let ownerId;
  let otherId;
  const owner = () => ({ id: ownerId });

  const insertJob = async ({ userId = ownerId, jobType = "account_chat", status = "pending", updatedAt = null } = {}) => {
    const result = await query(
      `INSERT INTO customer_intelligence_jobs
        (public_id, requested_by_user_id, job_type, status, request_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, '{}', COALESCE(?, NOW(3)), COALESCE(?, NOW(3)))`,
      [`cac_${TEST_PREFIX}_${Math.random().toString(36).slice(2, 10)}`, userId, jobType, status, updatedAt, updatedAt],
    );
    return Number(result.insertId);
  };

  beforeAll(async () => {
    ownerId = await createUser({ fullName: "Chat Job Owner", email: `${TEST_PREFIX}.chatjob.owner@example.com` });
    otherId = await createUser({ fullName: "Chat Job Other", email: `${TEST_PREFIX}.chatjob.other@example.com` });
    await getCustomerIntelligenceJob({ user: owner(), jobId: 0 });
  });

  afterAll(async () => {
    // Jobs are removed with their users (ON DELETE CASCADE).
    await query("DELETE FROM users WHERE id IN (?, ?)", [ownerId, otherId]);
  });

  it("cancela un turno pendiente y no toca uno terminado ni ajeno", async () => {
    const pendingId = await insertJob();
    const cancelled = await cancelCustomerAccountChatJob({ user: owner(), jobId: pendingId });
    expect(cancelled).toMatchObject({ id: pendingId, status: "cancelled", errorMessage: "Cancelado por el usuario" });
    expect(cancelled.finishedAt).toBeTruthy();

    const completedId = await insertJob({ status: "completed" });
    const completed = await cancelCustomerAccountChatJob({ user: owner(), jobId: completedId });
    expect(completed.status).toBe("completed");

    const foreignId = await insertJob({ userId: otherId });
    expect(await cancelCustomerAccountChatJob({ user: owner(), jobId: foreignId })).toBeNull();
    const [foreign] = await query("SELECT status FROM customer_intelligence_jobs WHERE id = ?", [foreignId]);
    expect(foreign.status).toBe("pending");
  });

  it("no cancela jobs de otros tipos", async () => {
    const jobId = await insertJob({ jobType: "agent_orchestration" });
    const job = await cancelCustomerAccountChatJob({ user: owner(), jobId });
    expect(job.status).toBe("pending");
  });

  it("devuelve el progreso mientras el job está pendiente y lo ignora al terminar", async () => {
    const jobId = await insertJob();
    const reporter = createChatProgressReporter({ jobId });
    reporter.report("crm");
    await reporter.flush();
    const pending = await getCustomerIntelligenceJob({ user: owner(), jobId });
    expect(pending.progress).toMatchObject({ phase: "crm", label: "Consultando los registros del CRM" });

    await query("UPDATE customer_intelligence_jobs SET status = 'completed', finished_at = NOW(3) WHERE id = ?", [jobId]);
    reporter.report("answering");
    await reporter.flush();
    const finished = await getCustomerIntelligenceJob({ user: owner(), jobId });
    expect(finished.progress.phase).toBe("crm");
  });

  it("cierra como fallidos solo los jobs sin terminar y sin actividad reciente", async () => {
    const staleId = await insertJob({ jobType: "agent_orchestration", updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) });
    const staleRunningId = await insertJob({ status: "running", updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) });
    const freshId = await insertJob();
    const doneId = await insertJob({ status: "completed", updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) });
    const closed = await failStaleCustomerIntelligenceJobs({ olderThanMinutes: 20 });
    expect(closed).toBeGreaterThanOrEqual(2);
    const rows = await query(
      "SELECT id, status, error_message, finished_at FROM customer_intelligence_jobs WHERE id IN (?, ?, ?, ?)",
      [staleId, staleRunningId, freshId, doneId],
    );
    const byId = new Map(rows.map((row) => [Number(row.id), row]));
    expect(byId.get(staleId)).toMatchObject({ status: "failed" });
    expect(byId.get(staleId).error_message).toMatch(/cerró automáticamente/);
    expect(byId.get(staleId).finished_at).toBeTruthy();
    expect(byId.get(staleRunningId).status).toBe("failed");
    expect(byId.get(freshId).status).toBe("pending");
    expect(byId.get(doneId).status).toBe("completed");
  });
});
