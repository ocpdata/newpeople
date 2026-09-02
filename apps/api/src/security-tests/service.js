import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "../db.js";
import { logAuditEvent } from "../audit.js";
import { config } from "../config.js";
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

// Debe coincidir con RATE_LIMIT_REQUESTS en scripts/test-waf.sh y test-rate-limit.mjs.
const RATE_LIMIT_TEST_ID = "test-21-rate-limit";
const RATE_LIMIT_TOTAL_REQUESTS = 1200;
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
        args: ["--skip-f5"],
        requires: [],
      },
      f5: {
        title: "Pruebas con validación F5 DCS",
        args: [],
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
  rate_limit: {
    title: "Rate limit",
    description:
      "Valida umbrales de frecuencia a 120 RPS desde una IP única y comportamiento ante ráfagas de solicitudes.",
    script: "test-rate-limit.mjs",
    profiles: {
      basic: {
        title: "Pruebas HTTP desde runner externo",
        args: ["--skip-f5"],
        requires: [
          "GH_RATE_LIMIT_TOKEN",
          "GH_RATE_LIMIT_CALLBACK_URL",
          "SECURITY_TEST_CALLBACK_SECRET",
        ],
      },
      f5: {
        title: "Pruebas HTTP desde runner externo",
        args: [],
        requires: [
          "GH_RATE_LIMIT_TOKEN",
          "GH_RATE_LIMIT_CALLBACK_URL",
          "SECURITY_TEST_CALLBACK_SECRET",
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
  api_get_inventory: {
    title: "APIs dentro del inventario",
    description:
      "Ejecuta las operaciones GET incluidas en swagger-pruebas.json.",
    script: "test-api-get.mjs",
    profiles: {
      f5: {
        title: "GET incluidos en el inventario F5",
        args: ["--scope", "inventory"],
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
  api_get_owasp: {
    title: "APIs OWASP",
    description:
      "Ejecuta amenazas OWASP (SQLi, XSS, Path Traversal, RCE, SSRF) sobre operaciones GET del inventario F5.",
    script: "test-api-owasp.mjs",
    profiles: {
      basic: {
        title: "Pruebas directas sin validación F5 DCS",
        args: ["--skip-f5"],
        requires: ["WAF_LOGIN_EMAIL", "WAF_LOGIN_PASSWORD"],
      },
      f5: {
        title: "Pruebas con validación F5 DCS",
        args: [],
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
  api_get_outside_inventory: {
    title: "APIs fuera del inventario",
    description:
      "Ejecuta los GET de cuentas, contactos y oportunidades excluidos de swagger-pruebas.json.",
    script: "test-api-get.mjs",
    profiles: {
      f5: {
        title: "GET fuera del inventario F5",
        args: ["--scope", "outside-inventory"],
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
    reportAvailable: Boolean(row.report_available ?? row.report_text),
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
  const rawRows = lines.slice(1).map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index] || ""]),
    );
  });
  const byResult = {};
  for (const row of rawRows)
    byResult[row.resultado || row.result || "UNKNOWN"] =
      (byResult[row.resultado || row.result || "UNKNOWN"] || 0) + 1;

  // Compact grouped burst rows (e.g., test-21-rate-limit-1..1200) into a single representative row
  // so result_json remains lightweight (<5KB) and doesn't overload list jobs / API network transfers.
  const rateLimitRows = rawRows.filter((row) =>
    String(row.prueba || row.test_id || "").startsWith("test-21-rate-limit"),
  );
  let rows = rawRows;
  if (rateLimitRows.length > 1) {
    const rep =
      rateLimitRows.find((r) =>
        String(r.resultado || r.result || "").toUpperCase().includes("PAS"),
      ) || rateLimitRows[rateLimitRows.length - 1];
    rows = [
      ...rawRows.filter(
        (row) =>
          !String(row.prueba || row.test_id || "").startsWith("test-21-rate-limit"),
      ),
      rep,
    ];
  }

  return { total: rawRows.length, byResult, rows };
}

function getGithubRateLimitConfig() {
  return config.securityTests.githubRateLimit;
}

async function dispatchGithubRateLimit(job) {
  const github = getGithubRateLimitConfig();
  if (!github.token || !github.callbackUrl || !github.callbackSecret) {
    throw Object.assign(
      new Error(
        "La prueba Rate Limit remota requiere GH_RATE_LIMIT_TOKEN, GH_RATE_LIMIT_CALLBACK_URL y SECURITY_TEST_CALLBACK_SECRET",
      ),
      { code: "GITHUB_RATE_LIMIT_NOT_CONFIGURED" },
    );
  }

  const endpoint = `https://api.github.com/repos/${github.repository}/actions/workflows/${github.workflow}/dispatches`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${github.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "newpeople-security-tests",
    },
    body: JSON.stringify({
      ref: "main",
      inputs: {
        job_id: job.public_id,
        callback_url: github.callbackUrl,
        target_url: "https://newpip.digitalvs.com",
        rps: "120",
        duration: "10s",
      },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `GitHub Actions rechazo el dispatch (${response.status}): ${detail.slice(0, 500)}`,
    );
  }
}

export async function handleGithubRateLimitCallback({
  payload,
  rawBody,
  signature,
}) {
  const github = getGithubRateLimitConfig();
  const body = rawBody || Buffer.from(JSON.stringify(payload));
  const expected = createHmac("sha256", github.callbackSecret)
    .update(body)
    .digest("hex");
  const received = String(signature || "").replace(/^sha256=/, "");
  if (
    !github.callbackSecret ||
    !/^[a-f0-9]{64}$/i.test(received) ||
    !timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"))
  ) {
    throw Object.assign(new Error("Firma de callback invalida"), { status: 401 });
  }

  const jobId = String(payload?.job_id || "").trim();
  const status = String(payload?.status || "").toLowerCase();
  const statusMap = {
    success: "completed",
    completed: "completed",
    failure: "failed",
    failed: "failed",
    timeout: "timeout",
    cancelled: "cancelled",
  };
  const mappedStatus = statusMap[status];
  if (!jobId || !mappedStatus) {
    throw Object.assign(new Error("Payload de callback invalido"), { status: 400 });
  }
  const rows = await query(
    "SELECT id, status FROM security_test_jobs WHERE public_id = ? AND script_key = 'rate_limit' LIMIT 1",
    [jobId],
  );
  if (!rows.length) {
    throw Object.assign(new Error("Ejecucion no encontrada"), { status: 404 });
  }
  if (!["pending", "running"].includes(String(rows[0].status))) {
    return false;
  }
  const reportText = String(payload.report_tsv || "");
  if (reportText.length > 2_000_000) {
    throw Object.assign(new Error("Reporte demasiado grande"), { status: 413 });
  }
  await query(
    "UPDATE security_test_jobs SET status = ?, report_text = ?, result_json = ?, stdout_text = ?, stderr_text = ?, exit_code = ?, finished_at = NOW(3) WHERE id = ? AND status IN ('pending', 'running')",
    [
      mappedStatus,
      reportText,
      JSON.stringify(summarizeReport(reportText)),
      String(payload.stdout || "").slice(-MAX_OUTPUT_LENGTH),
      String(payload.stderr || "").slice(-MAX_OUTPUT_LENGTH),
      Number.isInteger(payload.exit_code) ? payload.exit_code : null,
      rows[0].id,
    ],
  );
  return true;
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
    (scriptKey === "rate_limit" || (scriptKey === "waf" && testId === RATE_LIMIT_TEST_ID))
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
    `SELECT id, public_id, script_key, profile_key, status,
            requested_by_user_id, options_json, result_json, progress_json,
            stdout_text, stderr_text, exit_code, process_signal,
            error_code, error_message, started_at, finished_at, expires_at,
            created_at, updated_at, (report_text IS NOT NULL) AS report_available
     FROM security_test_jobs ORDER BY created_at DESC LIMIT ?`,
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
  if (job.script_key === "rate_limit") {
    try {
      await dispatchGithubRateLimit(job);
    } catch (error) {
      await query(
        "UPDATE security_test_jobs SET status = 'failed', stderr_text = ?, error_code = ?, error_message = ?, finished_at = NOW(3) WHERE id = ? AND status = 'running'",
        [
          String(error?.message || error),
          String(error?.code || "github_dispatch_failed"),
          String(error?.message || error).slice(0, 500),
          job.id,
        ],
      );
    }
    return;
  }
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
