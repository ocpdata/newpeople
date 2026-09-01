#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TARGET_URL =
  "https://newpip.digitalvs.com/api/accounts/l7-dos-test";
const dryRun = process.argv.includes("--dry-run");
const targetUrl =
  process.env.DOS_TARGET_URL || process.env.BASE_URL || DEFAULT_TARGET_URL;
const localHealthUrl =
  process.env.DOS_LOCAL_HEALTH_URL || "http://127.0.0.1:4000/health";
const outputFile = process.env.DOS_TEST_OUTPUT || "l7-dos-results.tsv";
const f5InitialWaitMs =
  Number(process.env.XC_EVENT_INITIAL_WAIT_SECONDS || 15) * 1000;
const f5RetryWaitMs = Number(process.env.XC_EVENT_WAIT_SECONDS || 15) * 1000;
const f5Retries = Math.max(1, Number(process.env.XC_EVENT_RETRIES || 4));
const runId = `dos-${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${process.pid}`;
const runStartedAt = new Date().toISOString();
const results = [];
let activeChild = null;
let stopping = false;

function fail(message) {
  console.error(message);
  process.exit(2);
}

if (!dryRun && !String(process.env.K6_CLOUD_TOKEN || "").trim())
  fail("K6_CLOUD_TOKEN es obligatorio para ejecutar DDoS L7");

const parsedTarget = new URL(targetUrl);
const allowedHosts = String(
  process.env.DOS_ALLOWED_HOSTS || parsedTarget.hostname,
)
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
if (
  parsedTarget.protocol !== "https:" ||
  !allowedHosts.includes(parsedTarget.hostname.toLowerCase())
)
  fail("DOS_TARGET_URL debe usar HTTPS y pertenecer a DOS_ALLOWED_HOSTS");

const stages = [
  {
    id: "dos-baseline",
    title: "Linea base",
    rate: 50,
    startOffset: 0,
    duration: 10,
    expectsMitigation: false,
  },
  {
    id: "dos-pre-threshold",
    title: "Preumbral",
    rate: 90,
    startOffset: 10,
    duration: 15,
    expectsMitigation: false,
  },
  {
    id: "dos-threshold",
    title: "Umbral",
    rate: 100,
    startOffset: 25,
    duration: 20,
    expectsMitigation: null,
  },
  {
    id: "dos-over-threshold",
    title: "Sobreumbral",
    rate: 150,
    startOffset: 45,
    duration: 60,
    expectsMitigation: true,
  },
  {
    id: "dos-recovery",
    title: "Recuperacion",
    rate: 20,
    startOffset: 105,
    duration: 15,
    expectsMitigation: false,
    recovery: true,
  },
];

function escapeTsv(value) {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ");
}

function findEventField(value, names) {
  if (!value || typeof value !== "object") return "";
  const expected = new Set(names.map((name) => name.toLowerCase()));
  const pending = [value];
  while (pending.length) {
    const current = pending.shift();
    for (const [key, item] of Object.entries(current)) {
      if (
        expected.has(key.toLowerCase()) &&
        ["string", "number", "boolean"].includes(typeof item)
      )
        return String(item);
      if (item && typeof item === "object") pending.push(item);
    }
  }
  return "";
}

function runCommand(
  command,
  args,
  { acceptedExitCodes = [0], forwardOutput = false, ...options } = {},
) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChild = child;
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (forwardOutput) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (forwardOutput) process.stderr.write(chunk);
    });
    child.on("error", rejectPromise);
    child.on("close", (code, signal) => {
      activeChild = null;
      if (acceptedExitCodes.includes(code))
        resolvePromise({ stdout, stderr, exitCode: code });
      else
        rejectPromise(
          Object.assign(
            new Error(stderr || `${command} finalizo con codigo ${code}`),
            { code, signal, stdout, stderr },
          ),
        );
    });
  });
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    activeChild?.kill("SIGTERM");
    process.exitCode = 1;
  });
}

async function assertHealthy(
  url,
  label,
  { headers = {}, acceptedStatuses = [] } = {},
) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    if (label === "El destino DoS" && response.status === 401)
      throw new Error(
        "La ruta exclusiva DoS aun no esta desplegada: el destino respondio HTTP 401",
      );
    throw new Error(`${label} respondio HTTP ${response.status}`);
  }
}

async function executeCloudTest() {
  const cloudStartedAt = Date.now();
  if (dryRun) {
    for (const stage of stages) {
      results.push({
        ...stage,
        startedAt: new Date(
          cloudStartedAt + stage.startOffset * 1000,
        ).toISOString(),
        finishedAt: new Date(
          cloudStartedAt + (stage.startOffset + stage.duration) * 1000,
        ).toISOString(),
        result: "NOT_RUN",
        requests: 0,
        successful: 0,
        blocked: 0,
        errors: 0,
        avgMs: 0,
        p95Ms: 0,
        p99Ms: 0,
      });
      console.log(
        `${stage.id} | ${stage.rate} RPS | ${stage.duration}s | NOT_RUN`,
      );
    }
    return;
  }

  const progressTimers = stages
    .slice(1)
    .map((stage) =>
      setTimeout(
        () => console.log(`${stage.id} | iniciando ${stage.rate} RPS`),
        stage.startOffset * 1000,
      ),
    );
  console.log("K6_CLOUD: start duration_seconds=120");
  console.log(`${stages[0].id} | iniciando ${stages[0].rate} RPS`);
  const k6Args = [
    "cloud",
    "run",
    "-e",
    `DOS_TARGET_URL=${targetUrl}`,
    "-e",
    "DOS_TEST_ID=dos-cloud-managed",
    "-e",
    `DOS_RUN_ID=${runId}`,
  ];
  if (process.env.K6_CLOUD_PROJECT_ID) {
    k6Args.push("-e", `K6_CLOUD_PROJECT_ID=${process.env.K6_CLOUD_PROJECT_ID}`);
  }
  k6Args.push(resolve(SCRIPT_DIR, "k6-cloud-l7-dos.js"));

  let cloudResult;
  try {
    cloudResult = await runCommand(
      "k6",
      k6Args,
      {
        acceptedExitCodes: [0, 99],
        forwardOutput: true,
        env: process.env,
      },
    );
  } finally {
    for (const timer of progressTimers) clearTimeout(timer);
  }

  const combinedOutput = `${cloudResult.stdout}\n${cloudResult.stderr}`;
  const runUrl = combinedOutput.match(/https:\/\/\S+\/runs\/\d+/)?.[0] || "";
  let healthError = "";
  try {
    await assertHealthy(localHealthUrl, "La API local");
  } catch (error) {
    healthError = error instanceof Error ? error.message : String(error);
  }
  for (const stage of stages) {
    results.push({
      ...stage,
      startedAt: new Date(
        cloudStartedAt + stage.startOffset * 1000,
      ).toISOString(),
      finishedAt: new Date(
        cloudStartedAt + (stage.startOffset + stage.duration) * 1000,
      ).toISOString(),
      result:
        stage.recovery && healthError ? "FAIL_ORIGIN_DEGRADED" : "REVIEW_F5",
      requests: 0,
      successful: stage.recovery && !healthError ? 1 : 0,
      blocked: 0,
      errors: 0,
      avgMs: 0,
      p95Ms: 0,
      p99Ms: 0,
      healthError,
      cloudExitCode: cloudResult.exitCode,
      runUrl,
    });
  }
  console.log(
    `K6_CLOUD: done exit_code=${cloudResult.exitCode} run_url=${runUrl || "unknown"}`,
  );
}

async function fetchF5Events() {
  if (process.env.XC_EVENTS_FILE) {
    const payload = JSON.parse(
      await readFile(process.env.XC_EVENTS_FILE, "utf8"),
    );
    const events = Array.isArray(payload) ? payload : payload.events || [];
    return events.map((event) =>
      typeof event === "string" ? JSON.parse(event) : event,
    );
  }
  const directory = await mkdtemp(join(tmpdir(), "l7-dos-f5-"));
  try {
    const outputPath = join(directory, "events.json");
    const configPath = join(directory, "curl.conf");
    const eventsPath =
      process.env.XC_SECURITY_EVENTS_PATH ||
      `/api/data/namespaces/${process.env.XC_NAMESPACE}/app_security/events`;
    const requestBody = JSON.stringify({
      aggs: {},
      end_time: String(Math.floor(Date.now() / 1000) + 10),
      limit: 0,
      namespace: process.env.XC_NAMESPACE,
      query: `{vh_name="ves-io-http-loadbalancer-${process.env.XC_LB_NAME}"}`,
      sort: "DESCENDING",
      start_time: String(Math.floor((Date.parse(runStartedAt) - 5000) / 1000)),
      scroll: true,
    });
    await writeFile(
      configPath,
      `cert = ${JSON.stringify(process.env.XC_API_P12_FILE)}\ncert-type = "P12"\npass = ${JSON.stringify(process.env.XC_P12_PASSWORD)}\n`,
      { mode: 0o600 },
    );
    const { stdout } = await runCommand("curl", [
      "-sS",
      "--config",
      configPath,
      "--max-time",
      "30",
      "-o",
      outputPath,
      "-w",
      "%{http_code}",
      "-X",
      "POST",
      "-H",
      "Content-Type: application/json",
      "--data-binary",
      requestBody,
      `${process.env.XC_API_URL.replace(/\/$/, "")}${eventsPath}`,
    ]);
    if (!/^2/.test(stdout))
      throw new Error(`F5 API respondio HTTP ${stdout || "000"}`);
    const payload = JSON.parse(await readFile(outputPath, "utf8"));
    return (payload.events || []).map((event) =>
      typeof event === "string" ? JSON.parse(event) : event,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function isDosEvent(event) {
  const eventType = findEventField(event, [
    "sec_event_type",
    "event_type",
    "type",
  ]);
  const category = findEventField(event, [
    "category",
    "attack_type",
    "threat_type",
  ]);
  const message = findEventField(event, [
    "message",
    "summary_msg",
    "description",
  ]);
  return /(?:l7.?ddos|ddos|dos(?:.sec)?.?event|http.?flood|rate.?limit)/i.test(
    `${eventType} ${category} ${message}`,
  );
}

function correlate(events, stage) {
  const start = Date.parse(stage.startedAt) - 2000;
  const finish = Date.parse(stage.finishedAt) + 15000;
  return (
    events
      .map((event) => {
        const serialized = JSON.stringify(event);
        return {
          event,
          time:
            Date.parse(
              findEventField(event, [
                "time",
                "timestamp",
                "event_time",
                "@timestamp",
              ]),
            ) || 0,
          exact: serialized.includes(stage.id),
          sameRun: serialized.includes(runId),
        };
      })
      .filter(
        ({ event, time, exact, sameRun }) =>
          isDosEvent(event) &&
          (exact || ((sameRun || time > 0) && time >= start && time <= finish)),
      )
      .sort(
        (left, right) =>
          Number(right.exact) - Number(left.exact) ||
          Math.abs(left.time - start) - Math.abs(right.time - start),
      )[0] || null
  );
}

function isBlockingAction(action) {
  return /block|deny|drop|challenge|rate.?limit/i.test(action);
}

async function queryF5() {
  if (dryRun) return { state: "SKIPPED", events: [] };
  if (f5InitialWaitMs)
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, f5InitialWaitMs),
    );
  let events = [];
  let lastError = null;
  for (let attempt = 1; attempt <= f5Retries; attempt += 1) {
    console.log(`F5_CORRELATION: attempt=${attempt} total=${f5Retries}`);
    try {
      events = await fetchF5Events();
      if (events.some(isDosEvent)) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < f5Retries && f5RetryWaitMs)
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, f5RetryWaitMs),
      );
  }
  const state = lastError && !events.length ? "ERROR" : "QUERIED";
  console.log(`F5_CORRELATION: done state=${state}`);
  return { state, events, error: lastError };
}

function classify(stage, match, f5State) {
  if (dryRun) return "NOT_RUN";
  if (f5State === "ERROR") return "ERROR_F5";
  const action = match
    ? findEventField(match.event, [
        "action",
        "enforcement_action",
        "mitigation_action",
      ])
    : "";
  if (stage.recovery)
    return stage.successful > 0 &&
      stage.errors / Math.max(1, stage.requests) < 0.05
      ? "PASS_RECOVERED"
      : "FAIL_ORIGIN_DEGRADED";
  if (stage.expectsMitigation === false)
    return match && isBlockingAction(action)
      ? "FAIL_EARLY_BLOCK"
      : "PASS_NO_MITIGATION";
  if (stage.expectsMitigation === null)
    return match && isBlockingAction(action)
      ? "PASS_BLOCKED"
      : "INCONCLUSIVE_THRESHOLD";
  if (!match) return "FAIL_NO_EVENT";
  return isBlockingAction(action) ? "PASS_BLOCKED" : "FAIL_NOT_BLOCKED";
}

async function writeReport(f5) {
  const header =
    "resultado\tprueba\tque_se_esperaba\tque_ocurrio\trps_objetivo\tsolicitudes\texitosas\tbloqueadas\terrores\tlatencia_promedio_ms\tlatencia_p95_ms\tlatencia_p99_ms\tevento_f5\taccion_f5\tcategoria_f5\tconfianza_correlacion\tfecha_utc\tduracion_segundos\turl\trun_id\tid_evento_f5\tid_solicitud_f5\tdetalle_f5\tdetalle_respuesta\n";
  const rows = results.map((stage) => {
    const match = correlate(f5.events, stage);
    const action = match
      ? findEventField(match.event, [
          "action",
          "enforcement_action",
          "mitigation_action",
        ])
      : "";
    const category = match
      ? findEventField(match.event, [
          "category",
          "attack_type",
          "threat_type",
          "sec_event_type",
        ])
      : "";
    const finalResult =
      stage.result === "FAIL_ORIGIN_DEGRADED"
        ? stage.result
        : classify(stage, match, f5.state);
    const expected = stage.recovery
      ? "Recuperacion del servicio"
      : stage.expectsMitigation === true
        ? "Evento DoS con accion Block"
        : stage.expectsMitigation === false
          ? "Trafico permitido sin mitigacion"
          : "Observar comportamiento en el umbral";
    const occurred =
      finalResult === "PASS_BLOCKED"
        ? `F5 mitigo la carga con accion ${action || "Block"}.`
        : finalResult === "PASS_NO_MITIGATION"
          ? "No se encontro mitigacion antes del umbral."
          : finalResult === "PASS_RECOVERED"
            ? "El servicio respondio normalmente despues de la carga."
            : finalResult === "NOT_RUN"
              ? "Simulacion; no se envio trafico."
              : `Resultado ${finalResult}; revisa las metricas y el evento F5.`;
    return [
      finalResult,
      stage.id,
      expected,
      occurred,
      stage.rate,
      stage.requests,
      stage.successful,
      stage.blocked,
      stage.errors,
      stage.avgMs.toFixed(2),
      stage.p95Ms.toFixed(2),
      stage.p99Ms.toFixed(2),
      f5.state === "ERROR" ? "Error al consultar" : match ? "Sí" : "No",
      action,
      category,
      match?.exact ? "Alta" : match ? "Media" : "Ninguna",
      stage.startedAt,
      stage.duration,
      targetUrl,
      runId,
      match ? findEventField(match.event, ["event_id", "id", "uid"]) : "",
      match
        ? findEventField(match.event, [
            "request_id",
            "req_id",
            "correlation_id",
          ])
        : "",
      match ? JSON.stringify(match.event) : f5.error?.message || "",
      `cloud_run=${stage.runUrl || "n/a"}; cloud_exit_code=${stage.cloudExitCode ?? 0}; local_health=${stage.healthError || "ok"}`,
    ]
      .map(escapeTsv)
      .join("\t");
  });
  await writeFile(outputFile, `${header}${rows.join("\n")}\n`, "utf8");
}

async function run() {
  if (!dryRun) await runCommand("k6", ["version"]);
  if (!dryRun)
    await assertHealthy(targetUrl, "El destino DoS", {
      headers: {
        "X-DOS-Test-ID": "dos-preflight",
        "X-DOS-Run-ID": runId,
      },
    });
  await executeCloudTest();
  const f5 = await queryF5();
  await writeReport(f5);
  console.log(`\nResultados guardados en: ${outputFile}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
