#!/usr/bin/env node

import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const { chromium } = require("../node_modules/playwright");

const DEFAULT_BASE_URL = "https://newpip.digitalvs.com";
const baseUrl = process.env.BASE_URL || DEFAULT_BASE_URL;
let outputFile = process.env.BOT_TEST_OUTPUT || "bot-defense-results.tsv";
const email = process.env.WAF_LOGIN_EMAIL || "";
const password = process.env.WAF_LOGIN_PASSWORD || "";
const iterations = Math.max(1, Number(process.env.BOT_TEST_ITERATIONS || 1));
const navigationDelay = Math.max(
  0,
  Number(process.env.BOT_TEST_DELAY_MS || 800),
);
const sensorWait = Math.max(
  0,
  Number(process.env.BOT_TEST_SENSOR_WAIT_MS || 1500),
);
const protectedPath = process.env.BOT_TEST_PROTECTED_PATH || "/api/auth/login";
const f5InitialWaitMs = Math.max(
  0,
  Number(process.env.XC_EVENT_INITIAL_WAIT_SECONDS || 15) * 1000,
);
const f5RetryWaitMs = Math.max(
  0,
  Number(process.env.XC_EVENT_WAIT_SECONDS || 15) * 1000,
);
const f5Retries = Math.max(1, Number(process.env.XC_EVENT_RETRIES || 4));
const headed = process.argv.includes("--headed");
const dryRun = process.argv.includes("--dry-run");
const includeBurst = process.argv.includes("--burst");

const onlyIndex = process.argv.indexOf("--only");
let onlyTest = "";
if (onlyIndex >= 0) {
  if (!process.argv[onlyIndex + 1]) {
    console.error("Falta el valor de --only");
    process.exit(2);
  }
  onlyTest = process.argv[onlyIndex + 1];
}

function shouldRun(id) {
  if (!onlyTest) return true;
  return id === onlyTest || id.startsWith(`${onlyTest}-`);
}

const results = [];

function usage() {
  console.log(`Uso: scripts/test-bot-defense.mjs [opciones]

Opciones:
  --headed       Ejecuta Chromium visible en lugar de headless
  --burst        Ejecuta una prueba corta de navegacion repetitiva
  --only ID      Ejecuta unicamente el caso con ese identificador (ej. bot-headless)
  --output FILE  Archivo TSV de resultados
  --dry-run      Muestra las sesiones sin abrir el navegador
  -h, --help     Muestra esta ayuda

Variables:
  BASE_URL                 URL objetivo (default: ${DEFAULT_BASE_URL})
  WAF_LOGIN_EMAIL          Usuario de pruebas de WAF (requerido)
  WAF_LOGIN_PASSWORD      Password de pruebas de WAF (requerido)
  BOT_TEST_ITERATIONS     Iteraciones por perfil (default: 1)
  BOT_TEST_DELAY_MS       Pausa entre navegaciones (default: 800)
  BOT_TEST_SENSOR_WAIT_MS Espera para inicializar el sensor F5 (default: 1500)
  BOT_TEST_PROTECTED_PATH Endpoint protegido de sonda (default: ${protectedPath})
  BOT_TEST_OUTPUT         Reporte TSV (default: bot-defense-results.tsv)
  XC_EVENT_INITIAL_WAIT_SECONDS Espera inicial de indexacion F5 (default: 15)
  XC_EVENT_WAIT_SECONDS   Espera entre consultas F5 (default: 15)
  XC_EVENT_RETRIES        Numero de consultas F5 (default: 4)

El script consulta los eventos de Bot Defense en F5 DCS al terminar y los
correlaciona con cada prueba por identificador, ventana de tiempo y tipo.`);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  usage();
  process.exit(0);
}

const outputIndex = process.argv.indexOf("--output");
if (outputIndex >= 0) {
  if (!process.argv[outputIndex + 1]) {
    console.error("Falta el valor de --output");
    process.exit(2);
  }
  outputFile = process.argv[outputIndex + 1];
}

function timestamp() {
  return new Date().toISOString();
}

function escapeTsv(value) {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ");
}

function record({
  testId,
  profile,
  status,
  result,
  details,
  startedAt,
  finishedAt,
}) {
  const row = {
    testId,
    utc: timestamp(),
    profile,
    status,
    result,
    details,
    startedAt,
    finishedAt,
  };
  results.push(row);
  console.log(
    `${testId} | perfil: ${profile} | HTTP ${status} | ${result} | ${details}`,
  );
}

async function runSession({
  testId,
  profile,
  javaScriptEnabled,
  headless,
  fast,
}) {
  const startedAt = timestamp();
  if (dryRun) {
    record({
      testId,
      profile,
      status: "-",
      result: "NOT_RUN",
      details: "dry-run",
      startedAt,
      finishedAt: timestamp(),
    });
    return;
  }

  return executeBrowserSession({
    testId,
    profile,
    javaScriptEnabled,
    headless,
    fast,
    startedAt,
  });
}

function runCommand(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else
        rejectPromise(
          new Error(stderr || `${command} finalizo con codigo ${code}`),
        );
    });
  });
}

function findEventField(value, fieldNames) {
  if (!value || typeof value !== "object") return "";
  const expected = new Set(fieldNames.map((name) => name.toLowerCase()));
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

function getEventTime(event) {
  const raw =
    findEventField(event, ["time"]) ||
    findEventField(event, ["event_time", "timestamp", "@timestamp"]);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function expectedAutomationType(result) {
  if (result.profile === "javascript-disabled") return "token missing";
  if (result.profile === "headless") return "threat intelligence";
  return "";
}

function correlateEvents(events) {
  const usedIndexes = new Set();
  const assignments = new Map();
  const orderedResults = results
    .map((result, index) => ({ result, index }))
    .sort(
      (left, right) =>
        Number(Boolean(expectedAutomationType(right.result))) -
        Number(Boolean(expectedAutomationType(left.result))),
    );
  for (const { result, index: resultIndex } of orderedResults) {
    const startedAt = Date.parse(result.startedAt) - 2000;
    const finishedAt = Date.parse(result.finishedAt) + 2000;
    const expectedType = expectedAutomationType(result);
    const candidates = events
      .map((event, index) => ({
        event,
        index,
        eventTime: getEventTime(event),
        automationType: findEventField(event, ["automation_type"]),
        containsTestId: JSON.stringify(event).includes(result.testId),
      }))
      .filter((candidate) => !usedIndexes.has(candidate.index))
      .filter(
        (candidate) =>
          candidate.containsTestId ||
          (candidate.eventTime >= startedAt &&
            candidate.eventTime <= finishedAt),
      )
      .filter(
        (candidate) =>
          !expectedType ||
          candidate.containsTestId ||
          candidate.automationType.toLowerCase() === expectedType,
      )
      .sort((left, right) => {
        const leftScore =
          (left.containsTestId ? 100 : 0) +
          (expectedType && left.automationType.toLowerCase() === expectedType
            ? 20
            : 0);
        const rightScore =
          (right.containsTestId ? 100 : 0) +
          (expectedType && right.automationType.toLowerCase() === expectedType
            ? 20
            : 0);
        return (
          rightScore - leftScore ||
          Math.abs(left.eventTime - startedAt) -
            Math.abs(right.eventTime - startedAt)
        );
      });
    const match = candidates[0] || null;
    if (match) usedIndexes.add(match.index);
    assignments.set(resultIndex, {
      result,
      event: match?.event || null,
      confidence: match?.containsTestId ? "Alta" : match ? "Media" : "Ninguna",
    });
  }
  return results.map((_result, index) => assignments.get(index));
}

async function fetchF5Events(runStartedAt) {
  const directory = await mkdtemp(join(tmpdir(), "bot-defense-f5-"));
  try {
    const outputPath = join(directory, "events.json");
    const configPath = join(directory, "curl.conf");
    const eventsPath =
      process.env.XC_SECURITY_EVENTS_PATH ||
      `/api/data/namespaces/${process.env.XC_NAMESPACE}/app_security/events`;
    const startEpoch = Math.floor((Date.parse(runStartedAt) - 5000) / 1000);
    const endEpoch = Math.floor(Date.now() / 1000) + 10;
    const query = `{vh_name="ves-io-http-loadbalancer-${process.env.XC_LB_NAME}",sec_event_type="bot_defense_sec_event"}`;
    const requestBody = JSON.stringify({
      aggs: {},
      end_time: String(endEpoch),
      limit: 0,
      namespace: process.env.XC_NAMESPACE,
      query,
      sort: "DESCENDING",
      start_time: String(startEpoch),
      scroll: true,
    });
    await writeFile(
      configPath,
      `cert = ${JSON.stringify(process.env.XC_API_P12_FILE)}\ncert-type = "P12"\npass = ${JSON.stringify(process.env.XC_P12_PASSWORD)}\n`,
      { mode: 0o600 },
    );
    const url = `${process.env.XC_API_URL.replace(/\/$/, "")}${eventsPath}`;
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
      url,
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

function isBlockingAction(action) {
  return /block|deny|challenge|rate.?limit/i.test(action);
}

async function correlateWithF5(runStartedAt) {
  if (dryRun)
    return {
      state: "SKIPPED",
      correlated: results.map((result) => ({
        result,
        event: null,
        confidence: "Ninguna",
      })),
    };
  let events = [];
  let lastError = null;
  if (f5InitialWaitMs)
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, f5InitialWaitMs),
    );
  for (let attempt = 1; attempt <= f5Retries; attempt += 1) {
    console.log(`F5_CORRELATION: attempt=${attempt} total=${f5Retries}`);
    try {
      events = await fetchF5Events(runStartedAt);
      const correlated = correlateEvents(events);
      const expectedEvents = correlated.filter(
        ({ result }) => result.profile !== "headed-browser",
      );
      if (expectedEvents.every(({ event }) => event)) {
        console.log("F5_CORRELATION: done state=QUERIED");
        return { state: "QUERIED", correlated };
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt < f5Retries && f5RetryWaitMs)
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, f5RetryWaitMs),
      );
  }
  if (lastError && !events.length) {
    console.log("F5_CORRELATION: done state=ERROR");
    return {
      state: "ERROR",
      error: lastError,
      correlated: results.map((result) => ({
        result,
        event: null,
        confidence: "Ninguna",
      })),
    };
  }
  console.log("F5_CORRELATION: done state=QUERIED");
  return { state: "QUERIED", correlated: correlateEvents(events) };
}

async function writeReport(correlation) {
  const header =
    "test_id\tutc\tprofile\thttp_status\tresult\tdetails\tevento_f5\taccion_f5\tcategoria_f5\tconfianza_correlacion\tid_evento_f5\tid_solicitud_f5\tdetalle_f5\tdetalle_respuesta\n";
  const rows = correlation.correlated.map(({ result, event, confidence }) => {
    const action = event
      ? findEventField(event, ["action", "enforcement_action", "waf_action"])
      : "";
    const automationType = event
      ? findEventField(event, ["automation_type"])
      : "";
    const requestId = event
      ? findEventField(event, ["req_id", "request_id", "correlation_id"])
      : "";
    const eventId = event
      ? findEventField(event, ["event_id", "id", "uid"])
      : "";
    const isLegitimate = result.profile === "headed-browser";
    const finalResult =
      correlation.state === "SKIPPED"
        ? "NOT_RUN"
        : correlation.state === "ERROR"
          ? "ERROR_F5"
          : isLegitimate
            ? event
              ? "FAIL_UNEXPECTED_EVENT"
              : "PASS_NO_EVENT"
            : event
              ? isBlockingAction(action)
                ? "PASS_BLOCKED"
                : "DETECTED_ALLOWED"
              : "FAIL_NO_EVENT";
    const eventStatus =
      correlation.state === "SKIPPED"
        ? "No consultado"
        : correlation.state === "ERROR"
          ? "Error al consultar"
          : event
            ? "Sí"
            : "No";
    const eventDetail = event
      ? JSON.stringify({
          automation_type: automationType,
          action,
          req_id: requestId,
          time:
            findEventField(event, ["time"]) ||
            findEventField(event, ["@timestamp"]),
          user_agent: findEventField(event, ["user_agent"]),
        })
      : correlation.error?.message || "";
    return [
      result.testId,
      result.utc,
      result.profile,
      result.status,
      finalResult,
      result.details,
      eventStatus,
      action,
      automationType,
      confidence,
      eventId,
      requestId,
      eventDetail,
      result.details,
    ]
      .map(escapeTsv)
      .join("\t");
  });
  await writeFile(outputFile, `${header}${rows.join("\n")}\n`, "utf8");
}

async function executeBrowserSession({
  testId,
  profile,
  javaScriptEnabled,
  headless,
  fast,
  startedAt,
}) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    javaScriptEnabled,
    extraHTTPHeaders: { "X-Bot-Test-ID": testId },
  });
  const page = await context.newPage();
  const responses = [];
  page.on("response", (response) => {
    if (response.url().startsWith(baseUrl)) {
      responses.push({ url: response.url(), status: response.status() });
    }
  });

  let status = "ERROR";
  let result = "REVIEW";
  let details = "";
  try {
    const response = await page.goto(`${baseUrl}/`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    status = response?.status() ?? "NO_RESPONSE";
    details = `js=${javaScriptEnabled}; headless=${headless}; responses=${responses.length}`;

    if (javaScriptEnabled) {
      await page.waitForTimeout(
        Math.max(sensorWait, fast ? 50 : navigationDelay),
      );
      const protectedEndpointStatus = await page.evaluate(
        async ({ path, testId, testEmail, testPassword }) => {
          const loginResponse = await fetch(path, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Bot-Test-ID": testId,
            },
            body: JSON.stringify({ email: testEmail, password: testPassword }),
          });
          return loginResponse.status;
        },
        {
          path: protectedPath,
          testId,
          testEmail: email,
          testPassword: password,
        },
      );
      details += `; protected_endpoint_status=${protectedEndpointStatus}; test_user_login=${protectedEndpointStatus === 200 ? "authenticated" : "rejected"}`;
      result = "REVIEW_F5";
    } else {
      const protectedEndpointResponse = await context.request.post(
        `${baseUrl}${protectedPath}`,
        {
          data: { email, password },
          headers: { "X-Bot-Test-ID": testId },
        },
      );
      result = "REVIEW_F5";
      details += `; javascript_disabled=true; protected_endpoint_status=${protectedEndpointResponse.status()}; test_user_login=${protectedEndpointResponse.status() === 200 ? "authenticated" : "rejected"}`;
    }
  } catch (error) {
    result = "ERROR";
    details = `${details}; ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    await context.close();
    await browser.close();
  }

  record({
    testId,
    profile,
    status,
    result,
    details,
    startedAt,
    finishedAt: timestamp(),
  });
}

async function run() {
  const runStartedAt = timestamp();
  if (!dryRun && (!email || !password)) {
    throw new Error(
      "Configura WAF_LOGIN_EMAIL y WAF_LOGIN_PASSWORD para ejecutar las pruebas de Bot Defense",
    );
  }
  await mkdir(new URL(".", `file://${process.cwd()}/`), { recursive: true });
  const profiles = [
    {
      name: headed ? "headed-browser" : "browser-headless",
      javaScriptEnabled: true,
      headless: false,
      fast: false,
    },
    { name: "headless", javaScriptEnabled: true, headless: true, fast: true },
    {
      name: "javascript-disabled",
      javaScriptEnabled: false,
      headless: true,
      fast: false,
    },
  ];

  for (const profile of profiles) {
    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      const testId = `bot-${profile.name}-${iteration}`;
      if (!shouldRun(testId)) continue;
      await runSession({
        testId,
        profile: profile.name,
        javaScriptEnabled: profile.javaScriptEnabled,
        headless: profile.name === "headed-browser" ? !headed : true,
        fast: profile.fast,
      });
    }
  }

  if (includeBurst) {
    for (let iteration = 1; iteration <= 5; iteration += 1) {
      const testId = `bot-short-burst-${iteration}`;
      if (!shouldRun(testId)) continue;
      await runSession({
        testId,
        profile: "short-burst",
        javaScriptEnabled: true,
        headless: true,
        fast: true,
      });
    }
  }

  const correlation = await correlateWithF5(runStartedAt);
  await writeReport(correlation);
  console.log(`\nResultados guardados en: ${outputFile}`);
  console.log(
    correlation.state === "SKIPPED"
      ? "Simulacion completada; F5 DCS no fue consultado."
      : correlation.state === "ERROR"
        ? "No fue posible consultar F5 DCS."
        : "Resultados correlacionados con eventos de Bot Defense en F5 DCS.",
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
