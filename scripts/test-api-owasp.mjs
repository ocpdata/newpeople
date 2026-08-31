#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_BASE_URL = "https://newpip.digitalvs.com";
const swaggerPath = resolve(
  process.env.API_TEST_SWAGGER_PATH ||
    resolve(PROJECT_ROOT, "apps/api/swagger-pruebas.json"),
);
const baseUrl = String(
  process.env.BASE_URL ||
    process.env.API_TEST_BASE_URL ||
    DEFAULT_BASE_URL,
).replace(/\/$/, "");
const email = String(process.env.WAF_LOGIN_EMAIL || "").trim();
const password = String(process.env.WAF_LOGIN_PASSWORD || "");
const outputFile =
  process.env.API_TEST_OUTPUT || resolve(PROJECT_ROOT, "api-owasp-results.tsv");
const requestTimeoutMs = Math.max(
  1000,
  Number(process.env.API_TEST_REQUEST_TIMEOUT_MS || 8000),
);
const concurrency = Math.max(
  1,
  Math.min(30, Number(process.env.API_TEST_CONCURRENCY || 16)),
);
const dryRun = process.argv.includes("--dry-run");
const skipF5 = process.argv.includes("--skip-f5");
const wafMode = String(process.env.XC_WAF_MODE || "monitoring").toLowerCase();
const runId = `api-owasp-${randomUUID()}`;
const runStartedAt = new Date().toISOString();

const f5RequiredVariables = [
  "XC_API_URL",
  "XC_API_P12_FILE",
  "XC_P12_PASSWORD",
  "XC_NAMESPACE",
  "XC_LB_NAME",
];
const f5Configured =
  !skipF5 &&
  f5RequiredVariables.every((name) => String(process.env[name] || "").trim());
const f5Retries = Math.max(1, Number(process.env.API_TEST_F5_RETRIES || 3));
const f5RetryWaitMs = Math.max(
  0,
  Number(process.env.API_TEST_F5_RETRY_WAIT_SECONDS || 5) * 1000,
);
const f5InitialWaitMs = Math.max(
  0,
  Number(process.env.XC_EVENT_INITIAL_WAIT_SECONDS || 5) * 1000,
);

const OWASP_VECTORS = [
  {
    category: "SQLi",
    title: "Inyección SQL",
    param: "search",
    payload: "' OR '1'='1",
    expectedCategory: /sql/i,
  },
  {
    category: "XSS",
    title: "Cross-Site Scripting",
    param: "q",
    payload: "<script>alert(1)</script>",
    expectedCategory: /xss|cross.site/i,
  },
  {
    category: "Path Traversal",
    title: "Recorrido de directorios",
    param: "file",
    payload: "../../../../etc/passwd",
    expectedCategory: /traversal|file inclusion|lfi/i,
  },
];

function escapeTsv(value) {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ");
}

function shouldSkip(operation) {
  return (
    /\{[^}]+\}/.test(operation.path) ||
    operation.parameters.some(
      (parameter) => parameter?.required && parameter?.in === "path",
    )
  );
}

async function loadOperations() {
  const spec = JSON.parse(await readFile(swaggerPath, "utf8"));
  return Object.entries(spec.paths || {})
    .filter(([, pathItem]) => pathItem?.get)
    .map(([path, pathItem]) => ({
      id:
        pathItem.get.operationId || `get_${path.replace(/[^a-z0-9]+/gi, "_")}`,
      method: "GET",
      path,
      parameters: [
        ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
        ...(Array.isArray(pathItem.get.parameters)
          ? pathItem.get.parameters
          : []),
      ],
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function login() {
  if (!email || !password) {
    throw new Error(
      "WAF_LOGIN_EMAIL y WAF_LOGIN_PASSWORD son obligatorios para la prueba APIs OWASP",
    );
  }
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `No fue posible autenticar el usuario de pruebas: HTTP ${response.status}`,
    );
  }
  const payload = await response.json();
  const token = String(payload?.token || "");
  if (!token) throw new Error("El login no devolvió un token");
  return token;
}

async function executeOwaspCase(testCase, token) {
  const startedAt = Date.now();
  if (dryRun) {
    return {
      ...testCase,
      result: "NOT_RUN",
      status: "-",
      durationMs: 0,
      expected: "Detección o bloqueo por F5 DCS",
      observed: "Simulación sin solicitud HTTP",
      detail: "dry-run",
      rejectedByF5: false,
    };
  }

  const url = new URL(testCase.path, `${baseUrl}/`);
  url.searchParams.set(testCase.vector.param, testCase.vector.payload);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        Authorization: `Bearer ${token}`,
        "X-API-Test-ID": testCase.id,
        "X-API-Run-ID": runId,
        "X-WAF-Test-ID": testCase.id,
        "X-WAF-Run-ID": runId,
        "User-Agent": "newpeople-owasp-api-scanner/1.0",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    const status = response.status;
    const bodyText = await response.text().catch(() => "");
    const rejectedByF5 =
      /Request Rejected|The requested URL was rejected|Your support ID is/i.test(
        bodyText,
      );

    let result = "REVISAR";
    if (rejectedByF5 || status === 403) {
      result = "PASS";
    }

    return {
      ...testCase,
      targetUrl: url.toString(),
      result,
      status,
      durationMs: Date.now() - startedAt,
      expected: "Detección o bloqueo por F5 DCS",
      observed: rejectedByF5
        ? `HTTP ${status} (Bloqueo F5 Request Rejected)`
        : `HTTP ${status}`,
      detail: `bytes=${bodyText.length}; rejected_by_f5=${rejectedByF5}`,
      rejectedByF5,
    };
  } catch (error) {
    const timedOut = error?.name === "TimeoutError";
    return {
      ...testCase,
      targetUrl: url.toString(),
      result: timedOut ? "TIMEOUT" : "ERROR_CONNECTION",
      status: "000",
      durationMs: Date.now() - startedAt,
      expected: "Detección o bloqueo por F5 DCS",
      observed: timedOut ? "Tiempo de espera agotado" : "Error de conexión",
      detail: error instanceof Error ? error.message : String(error),
      rejectedByF5: false,
    };
  }
}

async function runPool(testCases, token) {
  const results = new Array(testCases.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (nextIndex < testCases.length) {
      const index = nextIndex;
      nextIndex += 1;
      const testCase = testCases[index];
      results[index] = await executeOwaspCase(testCase, token);
      completed += 1;
      console.log(
        `API_TEST_PROGRESS: completed=${completed} total=${testCases.length} operation_id=${testCase.id}`,
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, testCases.length) }, () =>
      worker(),
    ),
  );
  return results;
}

function runCommand(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) return resolvePromise({ stdout, stderr });
      const error = new Error(
        stderr.trim() || `${command} terminó con ${code}`,
      );
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      rejectPromise(error);
    });
  });
}

async function fetchF5Events() {
  const directory = await mkdtemp(join(tmpdir(), "api-owasp-f5-"));
  try {
    const outputPath = join(directory, "response.json");
    const configPath = join(directory, "curl.conf");
    const bodyPath = join(directory, "request.json");
    const configuredCertificate = String(process.env.XC_API_P12_FILE || "");
    const certificatePath = isAbsolute(configuredCertificate)
      ? configuredCertificate
      : resolve(PROJECT_ROOT, configuredCertificate);

    await writeFile(
      configPath,
      `cert = ${JSON.stringify(certificatePath)}\ncert-type = "P12"\npass = ${JSON.stringify(process.env.XC_P12_PASSWORD)}\n`,
      { mode: 0o600 },
    );

    const startEpoch = Math.floor(new Date(runStartedAt).getTime() / 1000) - 10;
    const endEpoch = Math.floor(Date.now() / 1000) + 30;
    const query = `{vh_name="ves-io-http-loadbalancer-${process.env.XC_LB_NAME}",sec_event_type=~"waf_sec_event|bot_defense_sec_event|api_sec_event|svc_policy_sec_event"}`;

    await writeFile(
      bodyPath,
      JSON.stringify({
        aggs: {},
        end_time: String(endEpoch),
        limit: 0,
        namespace: process.env.XC_NAMESPACE,
        query,
        sort: "DESCENDING",
        start_time: String(startEpoch),
        scroll: true,
      }),
    );

    const eventsPath =
      process.env.XC_SECURITY_EVENTS_PATH ||
      `/api/data/namespaces/${process.env.XC_NAMESPACE}/app_security/events`;

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
      `@${bodyPath}`,
      `${String(process.env.XC_API_URL).replace(/\/$/, "")}${eventsPath}`,
    ]);

    if (!/^2/.test(stdout))
      throw new Error(`F5 API respondió HTTP ${stdout || "000"}`);

    const raw = JSON.parse(await readFile(outputPath, "utf8"));
    const events = Array.isArray(raw.events)
      ? raw.events.map((e) => (typeof e === "string" ? JSON.parse(e) : e))
      : [];
    return events;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function correlateCaseWithF5(testCase, events) {
  if (testCase.rejectedByF5) {
    return {
      ...testCase,
      result: "PASS",
      f5Status: "Bloqueado",
      f5Action: "Bloqueada",
      f5Category: testCase.vector.category,
      f5Confidence: "Alta",
    };
  }

  const matchedEvent = events.find((event) => {
    const jsonString = JSON.stringify(event);
    return (
      jsonString.includes(runId) ||
      jsonString.includes(testCase.id) ||
      (jsonString.includes(testCase.path) &&
        testCase.vector.expectedCategory.test(jsonString))
    );
  });

  if (!matchedEvent) {
    return {
      ...testCase,
      result: wafMode === "blocking" ? "FAIL" : "REVISAR",
      f5Status: "Sin evento",
      f5Action: "Permitida",
      f5Category: "-",
      f5Confidence: "Ninguna",
    };
  }

  const eventStr = JSON.stringify(matchedEvent);
  const isBlocked = /block|deny|reject|challenge/i.test(
    matchedEvent.action ||
      matchedEvent.sec_event_action ||
      matchedEvent.waf_action ||
      "",
  );

  let finalResult = "PASS";
  if (wafMode === "blocking" && !isBlocked) {
    finalResult = "FAIL";
  }

  return {
    ...testCase,
    result: finalResult,
    f5Status: isBlocked ? "Bloqueado" : "Detectado",
    f5Action: isBlocked ? "Bloqueada" : "Detectada",
    f5Category:
      matchedEvent.attack_type ||
      matchedEvent.waf_attack_type ||
      testCase.vector.category,
    f5Confidence: "Alta",
  };
}

async function correlateResultsWithF5(results) {
  if (dryRun || !f5Configured) {
    console.log("F5_CORRELATION: done state=SKIPPED");
    return results.map((result) => ({
      ...result,
      f5Status: result.rejectedByF5 ? "Bloqueado" : "NO_DATA",
      f5Action: result.rejectedByF5 ? "Bloqueada" : "-",
      f5Category: result.rejectedByF5 ? result.vector.category : "-",
      f5Confidence: "Ninguna",
    }));
  }

  if (f5InitialWaitMs > 0) {
    await new Promise((r) => setTimeout(r, f5InitialWaitMs));
  }

  let lastError;
  for (let attempt = 1; attempt <= f5Retries; attempt += 1) {
    console.log(`F5_CORRELATION: attempt=${attempt} total=${f5Retries}`);
    try {
      const events = await fetchF5Events();
      const correlated = results.map((result) =>
        correlateCaseWithF5(result, events),
      );
      console.log("F5_CORRELATION: done state=QUERIED");
      return correlated;
    } catch (error) {
      lastError = error;
    }
    if (attempt < f5Retries && f5RetryWaitMs) {
      await new Promise((r) => setTimeout(r, f5RetryWaitMs));
    }
  }

  console.error(`F5 API: ${lastError?.message || "consulta no disponible"}`);
  console.log("F5_CORRELATION: done state=ERROR");
  return results.map((result) => ({
    ...result,
    f5Status: "QUERY_ERROR",
    f5Action: "-",
    f5Category: "-",
    f5Confidence: "Ninguna",
  }));
}

async function writeReport(results) {
  const header =
    "resultado\tprueba\tvector_owasp\tmetodo\turl\thttp\tduracion_ms\testado_f5\taccion_f5\tcategoria_f5\tconfianza_f5\tque_se_esperaba\tque_ocurrio\tdetalle_respuesta\n";
  const rows = results.map((row) =>
    [
      row.result,
      row.id,
      row.vector.title,
      row.method,
      row.path,
      row.status,
      row.durationMs,
      row.f5Status,
      row.f5Action,
      row.f5Category,
      row.f5Confidence,
      row.expected,
      row.observed,
      row.detail,
    ]
      .map(escapeTsv)
      .join("\t"),
  );
  await writeFile(outputFile, `${header}${rows.join("\n")}\n`, "utf8");
}

async function run() {
  const operations = (await loadOperations()).filter(
    (operation) => !shouldSkip(operation),
  );
  if (!operations.length) {
    throw new Error(
      "No se encontraron operaciones GET en el archivo Swagger de pruebas",
    );
  }

  // Generar la matriz: Operación x Vectores OWASP
  const testCases = [];
  for (const operation of operations) {
    for (const vector of OWASP_VECTORS) {
      testCases.push({
        id: `owasp_${vector.category.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${operation.id}`,
        operationId: operation.id,
        method: "GET",
        path: operation.path,
        vector,
      });
    }
  }

  let token = "";
  if (!dryRun) {
    token = await login();
  }

  const rawResults = await runPool(testCases, token);
  const evaluatedResults = await correlateResultsWithF5(rawResults);
  await writeReport(evaluatedResults);
  console.log(
    `Reporte generado exitosamente con ${evaluatedResults.length} pruebas OWASP GET.`,
  );
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
