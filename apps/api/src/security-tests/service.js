import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "../db.js";
import { logAuditEvent } from "../audit.js";
import { ensureSecurityTestSchema } from "./schema.js";

const JOB_PREFIX = "securitytest_";
const JOB_TTL_HOURS = 24;
const JOB_TIMEOUT_MS = 10 * 60 * 1000;
const DDOS_JOB_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_OUTPUT_LENGTH = 2_000_000;
const SCRIPT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
  "scripts",
);
const activeProcesses = new Map();
const cancelledJobs = new Set();

// Debe coincidir con RATE_LIMIT_REQUESTS en scripts/test-waf.sh.
const RATE_LIMIT_TEST_ID = "test-21-rate-limit";
const RATE_LIMIT_TOTAL_REQUESTS = 5;
const DOS_TOTAL_STAGES = 5;

const SCRIPT_DEFINITIONS = {
  waf: {
    title: "Pruebas internas del WAF",
    description:
      "Valida trafico legitimo, ataques comunes y, si esta configurado, eventos de F5 DCS.",
    script: "test-waf.sh",
    profiles: {
      basic: {
        title: "Pruebas sin validación F5 DCS",
        args: ["--skip-f5", "--rate-limit"],
        requires: [],
      },
      f5: {
        title: "Pruebas con validación F5 DCS",
        args: ["--rate-limit"],
        requires: [
          "XC_API_URL",
          "XC_API_P12_FILE",
          "XC_P12_PASSWORD",
          "XC_NAMESPACE",
          "XC_LB_NAME",
        ],
      },
    },
  },
  bot_defense: {
    title: "Pruebas de Bot Defense",
    description:
      "Validacion de navegacion automatizada y perfiles de bot ante F5 DCS.",
    script: "test-bot-defense.mjs",
    profiles: {
      f5: {
        title: "Pruebas de navegacion y bots con F5 DCS",
        args: ["--headed"],
        requires: [
          "WAF_LOGIN_EMAIL",
          "WAF_LOGIN_PASSWORD",
          "XC_API_URL",
          "XC_API_P12_FILE",
          "XC_P12_PASSWORD",
          "XC_NAMESPACE",
          "XC_LB_NAME",
        ],
      },
    },
  },
  api_get: {
    title: "APIs",
    description:
      "Ejecuta las operaciones GET de swagger.json con el usuario de pruebas configurado en el servidor.",
    script: "test-api-get.mjs",
    profiles: {
      authenticated: {
        title: "GET autenticados desde Swagger",
        args: [],
        requires: ["WAF_LOGIN_EMAIL", "WAF_LOGIN_PASSWORD"],
      },
    },
  },
  l7_dos: {
    title: "DDoS L7",
    description:
      "Valida con carga distribuida el umbral RPS, la mitigacion y la recuperacion ante F5 DCS.",
    script: "test-l7-dos.mjs",
    profiles: {
      f5: {
        title: "Prueba distribuida DDoS L7 con F5 DCS",
        args: [],
        requires: [
          "K6_CLOUD_TOKEN",
          "XC_API_URL",
          "XC_API_P12_FILE",
          "XC_P12_PASSWORD",
          "XC_NAMESPACE",
          "XC_LB_NAME",
        ],
      },
    },
  },
};

function getDefinition(scriptKey, profileKey) {
  const definition = SCRIPT_DEFINITIONS[scriptKey];
  const profile = definition?.profiles?.[profileKey];
  if (!definition || !profile) return null;
  return { definition, profile };
}

function serialize(row) {
  if (!row) return null;
  return {
    id: String(row.public_id),
    scriptKey: row.script_key,
    profileKey: row.profile_key,
    status: row.status,
    requestedByUserId: Number(row.requested_by_user_id || 0),
    options: parseJson(row.options_json, {}),
    result: parseJson(row.result_json, null),
    progress: parseJson(row.progress_json, {
      completed: 0,
      total: null,
      currentTest: null,
    }),
    reportAvailable: Boolean(row.report_text),
    stdout: String(row.stdout_text || "").slice(-10000),
    stderr: String(row.stderr_text || "").slice(-10000),
    exitCode: row.exit_code === null ? null : Number(row.exit_code),
    signal: row.process_signal || null,
    error: row.error_code
      ? { code: row.error_code, message: row.error_message }
      : null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    expiresAt: row.expires_at,
  };
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function summarizeReport(reportText) {
  const lines = String(reportText || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length < 2) return { total: 0, byResult: {}, rows: [] };
  const headers = lines[0].split("\t");
  const rows = lines.slice(1).map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index] || ""]),
    );
  });
  const byResult = {};
  for (const row of rows)
    byResult[row.resultado || row.result || "UNKNOWN"] =
      (byResult[row.resultado || row.result || "UNKNOWN"] || 0) + 1;
  return { total: rows.length, byResult, rows };
}

export function listSecurityTestCatalog() {
  return Object.entries(SCRIPT_DEFINITIONS).map(([key, definition]) => ({
    key,
    title: definition.title,
    description: definition.description,
    planned: Boolean(definition.planned),
    defaults: definition.defaults || {},
    profiles: Object.entries(definition.profiles).map(
      ([profileKey, profile]) => ({
        key: profileKey,
        title: profile.title,
        requires: profile.requires,
        configured: profile.requires.every((name) =>
          String(process.env[name] || "").trim(),
        ),
      }),
    ),
  }));
}

export async function createSecurityTestJob({
  scriptKey,
  profileKey,
  wafMode,
  testId,
  requestedByUserId,
  req,
}) {
  await ensureSecurityTestSchema();
  const selected = getDefinition(scriptKey, profileKey);
  if (!selected)
    throw Object.assign(new Error("Perfil de prueba invalido"), {
      status: 400,
    });
  const missing = selected.profile.requires.filter(
    (name) => !String(process.env[name] || "").trim(),
  );
  if (missing.length)
    throw Object.assign(
      new Error(`Configuracion incompleta: ${missing.join(", ")}`),
      { status: 409 },
    );

  const activeRows = await query(
    "SELECT id FROM security_test_jobs WHERE status IN ('pending', 'running') LIMIT 1",
  );
  if (activeRows.length) {
    throw Object.assign(new Error("Ya existe una prueba en ejecucion"), {
      status: 409,
    });
  }
  // Only prune jobs past their TTL; keep recent completed jobs so per-test
  // results from previous runs remain visible when running a single test.
  await query(
    "DELETE FROM security_test_jobs WHERE status NOT IN ('pending', 'running') AND expires_at < NOW(3)",
  );

  const publicId = `${JOB_PREFIX}${randomUUID().replace(/-/g, "")}`;
  const stepsTotal =
    scriptKey === "waf" && (!testId || testId === RATE_LIMIT_TEST_ID)
      ? RATE_LIMIT_TOTAL_REQUESTS
      : scriptKey === "l7_dos"
        ? DOS_TOTAL_STAGES
        : undefined;
  await query(
    `INSERT INTO security_test_jobs (public_id, script_key, profile_key, requested_by_user_id, options_json, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL ? HOUR))`,
    [
      publicId,
      scriptKey,
      profileKey,
      Number(requestedByUserId),
      JSON.stringify({
        wafMode,
        testId: testId || null,
        stepsTotal,
      }),
      JOB_TTL_HOURS,
    ],
  );
  await logAuditEvent({
    req,
    module: "pruebas",
    action: "security_test_requested",
    entityType: "security_test_job",
    detail: testId
      ? `${scriptKey}/${profileKey}/${testId}`
      : `${scriptKey}/${profileKey}`,
  });
  return publicId;
}

export async function getSecurityTestJob(publicId, includePrivate = false) {
  await ensureSecurityTestSchema();
  const rows = await query(
    "SELECT * FROM security_test_jobs WHERE public_id = ? LIMIT 1",
    [publicId],
  );
  if (!rows.length) return null;
  const result = serialize(rows[0]);
  if (includePrivate) result.reportText = rows[0].report_text || "";
  return result;
}

export async function listSecurityTestJobs(limit = 30) {
  await ensureSecurityTestSchema();
  const rows = await query(
    "SELECT * FROM security_test_jobs ORDER BY created_at DESC LIMIT ?",
    [Number(limit)],
  );
  return rows.map(serialize);
}

export async function cancelSecurityTestJob(publicId, req) {
  const rows = await query(
    "SELECT id, status FROM security_test_jobs WHERE public_id = ? LIMIT 1",
    [publicId],
  );
  const job = rows[0];
  if (!job || !["pending", "running"].includes(String(job.status)))
    return false;
  cancelledJobs.add(publicId);
  const result = await query(
    "UPDATE security_test_jobs SET status = 'cancelled', finished_at = NOW(3), error_code = 'cancelled', error_message = 'Ejecucion cancelada por el usuario' WHERE id = ? AND status IN ('pending', 'running')",
    [job.id],
  );
  if (!result.affectedRows) return false;
  activeProcesses.get(publicId)?.kill("SIGTERM");
  await logAuditEvent({
    req,
    module: "pruebas",
    action: "security_test_cancelled",
    entityType: "security_test_job",
    detail: publicId,
  });
  return true;
}

export async function deleteSecurityTestJob(publicId, req) {
  const rows = await query(
    "SELECT id, status FROM security_test_jobs WHERE public_id = ? LIMIT 1",
    [publicId],
  );
  const job = rows[0];
  if (!job) return { found: false };
  if (["pending", "running"].includes(String(job.status))) {
    return { found: true, deleted: false, active: true };
  }

  await query("DELETE FROM security_test_jobs WHERE id = ?", [job.id]);
  await logAuditEvent({
    req,
    module: "pruebas",
    action: "security_test_deleted",
    entityType: "security_test_job",
    detail: publicId,
  });
  return { found: true, deleted: true, active: false };
}

export async function processPendingSecurityTestJobs({ limit = 1 } = {}) {
  await ensureSecurityTestSchema();
  const jobs = await query(
    "SELECT * FROM security_test_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?",
    [limit],
  );
  for (const job of jobs) await executeJob(job);
}

async function executeJob(job) {
  const claimed = await query(
    "UPDATE security_test_jobs SET status = 'running', started_at = NOW(3) WHERE id = ? AND status = 'pending'",
    [job.id],
  );
  if (!claimed.affectedRows) return;
  const selected = getDefinition(job.script_key, job.profile_key);
  const outputFile = resolve(
    SCRIPT_ROOT,
    `.security-test-${job.public_id}.tsv`,
  );
  const options = parseJson(job.options_json, {});
  const args = [...selected.profile.args];
  if (options.testId) args.push("--only", options.testId);
  const env = {
    ...process.env,
    WAF_TEST_OUTPUT: outputFile,
    BOT_TEST_OUTPUT: outputFile,
    API_TEST_OUTPUT: outputFile,
    DOS_TEST_OUTPUT: outputFile,
    XC_WAF_MODE: options.wafMode || "monitoring",
  };
  try {
    const { stdout, stderr } = await runScriptWithProgress({
      job,
      scriptPath: resolve(SCRIPT_ROOT, selected.definition.script),
      args,
      cwd: resolve(SCRIPT_ROOT, ".."),
      env,
      timeoutMs:
        job.script_key === "l7_dos" ? DDOS_JOB_TIMEOUT_MS : JOB_TIMEOUT_MS,
    });
    const reportText = await readFile(outputFile, "utf8").catch(() => "");
    if (cancelledJobs.has(job.public_id)) return;
    await query(
      "UPDATE security_test_jobs SET status = 'completed', stdout_text = ?, stderr_text = ?, report_text = ?, result_json = ?, exit_code = 0, finished_at = NOW(3) WHERE id = ?",
      [
        String(stdout).slice(0, MAX_OUTPUT_LENGTH),
        String(stderr).slice(0, MAX_OUTPUT_LENGTH),
        reportText.slice(0, MAX_OUTPUT_LENGTH),
        JSON.stringify(summarizeReport(reportText)),
        job.id,
      ],
    );
  } catch (error) {
    const reportText = await readFile(outputFile, "utf8").catch(() => "");
    const timedOut = error?.killed || error?.code === "ETIMEDOUT";
    if (!cancelledJobs.has(job.public_id)) {
      await query(
        "UPDATE security_test_jobs SET status = ?, stdout_text = ?, stderr_text = ?, report_text = ?, result_json = ?, exit_code = ?, process_signal = ?, error_code = ?, error_message = ?, finished_at = NOW(3) WHERE id = ?",
        [
          timedOut ? "timeout" : "failed",
          String(error?.stdout || "").slice(0, MAX_OUTPUT_LENGTH),
          String(error?.stderr || "").slice(0, MAX_OUTPUT_LENGTH),
          reportText.slice(0, MAX_OUTPUT_LENGTH),
          JSON.stringify(summarizeReport(reportText)),
          Number.isInteger(error?.code) ? error.code : null,
          error?.signal || null,
          timedOut ? "timeout" : "execution_failed",
          timedOut
            ? "La prueba excedio el tiempo maximo permitido"
            : "No fue posible ejecutar la prueba",
          job.id,
        ],
      );
    }
  } finally {
    activeProcesses.delete(job.public_id);
    cancelledJobs.delete(job.public_id);
    await unlink(outputFile).catch(() => {});
  }
}

function runScriptWithProgress({ job, scriptPath, args, cwd, env, timeoutMs }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const needsVirtualDisplay =
      process.platform === "linux" &&
      args.includes("--headed") &&
      !String(env.DISPLAY || "").trim();
    const command = needsVirtualDisplay ? "xvfb-run" : scriptPath;
    const commandArgs = needsVirtualDisplay
      ? ["-a", scriptPath, ...args]
      : args;
    const child = spawn(command, commandArgs, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeProcesses.set(job.public_id, child);
    let stdout = "";
    let stderr = "";
    let progress = { completed: 0, total: null, currentTest: null };
    const seenTests = new Set();
    let settled = false;
    let persistQueue = Promise.resolve();

    function consume(chunk, stream) {
      const text = String(chunk || "");
      if (stream === "stdout")
        stdout = `${stdout}${text}`.slice(-MAX_OUTPUT_LENGTH);
      else stderr = `${stderr}${text}`.slice(-MAX_OUTPUT_LENGTH);
      for (const match of text.matchAll(
        /\b((?:test|bot|dos)-[a-z0-9-]+)\b/gi,
      )) {
        const testId = match[1];
        seenTests.add(testId);
        progress = {
          ...progress,
          completed: seenTests.size,
          total: null,
          currentTest: testId,
        };
      }
      const attemptMatch = text.match(
        /F5_CORRELATION: attempt=(\d+) total=(\d+)/,
      );
      if (attemptMatch) {
        progress = {
          ...progress,
          f5Correlation: {
            active: true,
            attempt: Number(attemptMatch[1]),
            total: Number(attemptMatch[2]),
          },
        };
      }
      const doneMatch = text.match(/F5_CORRELATION: done state=(\w+)/);
      if (doneMatch) {
        progress = {
          ...progress,
          f5Correlation: { active: false, state: doneMatch[1] },
        };
      }
      const cloudStartMatch = text.match(
        /K6_CLOUD: start duration_seconds=(\d+)/,
      );
      if (cloudStartMatch) {
        progress = {
          ...progress,
          cloudTest: {
            startedAt: new Date().toISOString(),
            durationSeconds: Number(cloudStartMatch[1]),
            completed: false,
          },
        };
      }
      if (/K6_CLOUD: done\b/.test(text)) {
        progress = {
          ...progress,
          cloudTest: {
            ...progress.cloudTest,
            completed: true,
            finishedAt: new Date().toISOString(),
          },
        };
      }
      const apiStartMatch = text.match(
        /API_TEST_START: total=(\d+) executable=(\d+) skipped=(\d+)/,
      );
      if (apiStartMatch) {
        progress = {
          ...progress,
          completed: 0,
          total: Number(apiStartMatch[1]),
          apiTest: {
            executable: Number(apiStartMatch[2]),
            skipped: Number(apiStartMatch[3]),
          },
        };
      }
      const apiProgressMatches = [
        ...text.matchAll(
          /API_TEST_PROGRESS: completed=(\d+) total=(\d+) operation_id=([^\s]+)/g,
        ),
      ];
      const apiProgressMatch = apiProgressMatches.at(-1);
      if (apiProgressMatch) {
        progress = {
          ...progress,
          completed: Number(apiProgressMatch[1]),
          total: Number(apiProgressMatch[2]),
          currentTest: apiProgressMatch[3],
        };
      }
      const apiDoneMatch = text.match(
        /API_TEST_DONE: total=(\d+) passed=(\d+) failed=(\d+) skipped=(\d+)/,
      );
      if (apiDoneMatch) {
        progress = {
          ...progress,
          completed: Number(apiDoneMatch[1]),
          total: Number(apiDoneMatch[1]),
          apiTest: {
            ...progress.apiTest,
            passed: Number(apiDoneMatch[2]),
            failed: Number(apiDoneMatch[3]),
            skipped: Number(apiDoneMatch[4]),
          },
        };
      }
      persistQueue = persistQueue.then(() =>
        query(
          "UPDATE security_test_jobs SET stdout_text = ?, stderr_text = ?, progress_json = ? WHERE id = ? AND status = 'running'",
          [stdout, stderr, JSON.stringify(progress), job.id],
        ),
      );
    }

    child.stdout.on("data", (chunk) => consume(chunk, "stdout"));
    child.stderr.on("data", (chunk) => consume(chunk, "stderr"));
    const timeout = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      rejectPromise(Object.assign(error, { stdout, stderr, killed: false }));
    });
    child.on("close", async (code, signal) => {
      clearTimeout(timeout);
      await persistQueue;
      if (settled) return;
      settled = true;
      if (code === 0) resolvePromise({ stdout, stderr });
      else
        rejectPromise(
          Object.assign(new Error("Security test process failed"), {
            code,
            signal,
            stdout,
            stderr,
            killed: signal === "SIGTERM",
          }),
        );
    });
  });
}
