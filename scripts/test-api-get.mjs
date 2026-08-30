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
const scopeIndex = process.argv.indexOf("--scope");
const scope =
  scopeIndex >= 0 ? String(process.argv[scopeIndex + 1] || "") : "all";
const supportedScopes = new Set(["all", "inventory", "outside-inventory"]);
if (!supportedScopes.has(scope)) {
  throw new Error(`Alcance de APIs no soportado: ${scope}`);
}
const swaggerPath = resolve(
  scope === "inventory"
    ? resolve(PROJECT_ROOT, "apps/api/swagger-pruebas.json")
    : scope === "outside-inventory"
      ? resolve(PROJECT_ROOT, "apps/api/swagger.json")
      : process.env.API_TEST_SWAGGER_PATH ||
        resolve(PROJECT_ROOT, "apps/api/swagger.json"),
);
const baseUrl = String(
  process.env.API_TEST_BASE_URL ||
    `http://127.0.0.1:${process.env.PORT || 4000}`,
).replace(/\/$/, "");
const email = String(process.env.WAF_LOGIN_EMAIL || "").trim();
const password = String(process.env.WAF_LOGIN_PASSWORD || "");
const outputFile =
  process.env.API_TEST_OUTPUT || resolve(PROJECT_ROOT, "api-get-results.tsv");
const requestTimeoutMs = Math.max(
  1000,
  Number(process.env.API_TEST_REQUEST_TIMEOUT_MS || 15000),
);
const concurrency = Math.max(
  1,
  Math.min(10, Number(process.env.API_TEST_CONCURRENCY || 4)),
);
const dryRun = process.argv.includes("--dry-run");
const runId = `api-get-${randomUUID()}`;
const f5RequiredVariables = [
  "XC_API_URL",
  "XC_API_P12_FILE",
  "XC_P12_PASSWORD",
  "XC_NAMESPACE",
  "XC_LB_NAME",
];
const f5Configured = f5RequiredVariables.every((name) =>
  String(process.env[name] || "").trim(),
);
const f5Retries = Math.max(1, Number(process.env.API_TEST_F5_RETRIES || 4));
const f5RetryWaitMs = Math.max(
  0,
  Number(process.env.API_TEST_F5_RETRY_WAIT_SECONDS || 10) * 1000,
);
const f5AppTypeName = String(
  process.env.XC_APP_TYPE_NAME ||
    `ves-io-${process.env.XC_NAMESPACE}-${process.env.XC_LB_NAME}`,
).trim();

function escapeTsv(value) {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ");
}

function classifyStatus(status) {
  if (status >= 200 && status < 300) return "PASS";
  if (status === 401) return "FAIL_AUTH";
  if (status === 403) return "FAIL_PERMISSION";
  if (status === 404) return "FAIL_NOT_FOUND";
  if (status >= 500) return "FAIL_SERVER";
  return "FAIL_HTTP";
}

function isOutsideInventoryPath(path) {
  return ["accounts", "contacts", "opportunities"].some(
    (resource) =>
      path === `/api/${resource}` || path.startsWith(`/api/${resource}/`),
  );
}

async function loadOperations() {
  const spec = JSON.parse(await readFile(swaggerPath, "utf8"));
  return Object.entries(spec.paths || {})
    .filter(([, pathItem]) => pathItem?.get)
    .filter(
      ([path]) => scope !== "outside-inventory" || isOutsideInventoryPath(path),
    )
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
      "WAF_LOGIN_EMAIL y WAF_LOGIN_PASSWORD son obligatorios para la prueba APIs",
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
  if (!token) throw new Error("El login no devolvio un token");
  return token;
}

function shouldSkip(operation) {
  return (
    /\{[^}]+\}/.test(operation.path) ||
    operation.parameters.some(
      (parameter) => parameter?.required && parameter?.in === "path",
    )
  );
}

async function executeOperation(operation, token) {
  const startedAt = Date.now();
  if (dryRun) {
    return {
      ...operation,
      result: "NOT_RUN",
      status: "-",
      durationMs: 0,
      expected: "Respuesta HTTP 2xx",
      observed: "Simulacion sin solicitud HTTP",
      detail: "dry-run",
    };
  }

  try {
    const response = await fetch(new URL(operation.path, `${baseUrl}/`), {
      headers: {
        Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        Authorization: `Bearer ${token}`,
        "X-API-Test-ID": operation.id,
        "X-API-Run-ID": runId,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    const status = response.status;
    const contentType =
      response.headers.get("content-type") || "sin content-type";
    const contentLength =
      response.headers.get("content-length") || "desconocido";
    await response.body?.cancel();
    return {
      ...operation,
      result: classifyStatus(status),
      status,
      durationMs: Date.now() - startedAt,
      expected: "Respuesta HTTP 2xx",
      observed: `HTTP ${status}`,
      detail: `content-type=${contentType}; content-length=${contentLength}`,
    };
  } catch (error) {
    const timedOut = error?.name === "TimeoutError";
    return {
      ...operation,
      result: timedOut ? "TIMEOUT" : "ERROR_CONNECTION",
      status: "000",
      durationMs: Date.now() - startedAt,
      expected: "Respuesta HTTP 2xx",
      observed: timedOut ? "Tiempo de espera agotado" : "Error de conexion",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runPool(operations, token) {
  const results = new Array(operations.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (nextIndex < operations.length) {
      const index = nextIndex;
      nextIndex += 1;
      const operation = operations[index];
      results[index] = await executeOperation(operation, token);
      completed += 1;
      console.log(
        `API_TEST_PROGRESS: completed=${completed} total=${operations.length} operation_id=${operation.id}`,
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, operations.length) }, () =>
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
        stderr.trim() || `${command} termino con ${code}`,
      );
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      rejectPromise(error);
    });
  });
}

function normalizeApiPath(path) {
  const normalized = String(path || "")
    .split(/[?#]/, 1)[0]
    .replace(/\{[^}]+\}/g, "{DYN}")
    .replace(/\/+$/, "");
  return normalized || "/";
}

function operationKey(method, path) {
  return `${String(method || "").toUpperCase()} ${normalizeApiPath(path)}`;
}

async function fetchF5Json(path) {
  const directory = await mkdtemp(join(tmpdir(), "api-get-f5-"));
  try {
    const outputPath = join(directory, "response.json");
    const configPath = join(directory, "curl.conf");
    const configuredCertificate = String(process.env.XC_API_P12_FILE || "");
    const certificatePath = isAbsolute(configuredCertificate)
      ? configuredCertificate
      : resolve(PROJECT_ROOT, configuredCertificate);
    await writeFile(
      configPath,
      `cert = ${JSON.stringify(certificatePath)}\ncert-type = "P12"\npass = ${JSON.stringify(process.env.XC_P12_PASSWORD)}\n`,
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
      `${String(process.env.XC_API_URL).replace(/\/$/, "")}${path}`,
    ]);
    if (!/^2/.test(stdout))
      throw new Error(`F5 API respondio HTTP ${stdout || "000"}`);
    return JSON.parse(await readFile(outputPath, "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function fetchF5ApiInventory() {
  const namespace = encodeURIComponent(process.env.XC_NAMESPACE);
  const appType = encodeURIComponent(f5AppTypeName);
  const basePath = `/api/ml/data/namespaces/${namespace}/app_types/${appType}/api_endpoints`;
  const [discovery, swagger] = await Promise.all([
    fetchF5Json(basePath),
    fetchF5Json(`${basePath}/swagger_spec`),
  ]);
  return {
    discovered: Array.isArray(discovery.apiep_list) ? discovery.apiep_list : [],
    swagger,
  };
}

function buildF5InventoryIndex(swagger) {
  const entries = new Set();
  for (const [path, pathItem] of Object.entries(swagger?.paths || {})) {
    for (const method of ["get", "head", "options"]) {
      if (pathItem?.[method]) entries.add(operationKey(method, path));
    }
  }
  return entries;
}

function classifyWithF5(result, inventory) {
  const key = operationKey(result.method, result.path);
  const inventoryIndex = buildF5InventoryIndex(inventory.swagger);
  const discoveredEndpoint = inventory.discovered.find(
    (endpoint) => operationKey(endpoint.method, endpoint.collapsed_url) === key,
  );
  const categories = Array.isArray(discoveredEndpoint?.category)
    ? discoveredEndpoint.category.map(String)
    : [];
  if (scope === "outside-inventory") {
    return {
      ...result,
      f5Status: discoveredEndpoint ? "DISCOVERED" : "UNKNOWN",
      f5Categories: categories,
      f5Confidence: discoveredEndpoint ? "Alta" : "Ninguna",
      f5ObservedAt: discoveredEndpoint?.access_discovery_time || "",
    };
  }
  if (
    inventoryIndex.has(key) ||
    categories.some((category) =>
      /APIEP_CATEGORY_(?:INVENTORY|SWAGGER)/.test(category),
    )
  ) {
    return {
      ...result,
      f5Status: "INVENTORIED",
      f5Categories: categories,
      f5Confidence: "Alta",
      f5ObservedAt: discoveredEndpoint?.access_discovery_time || "",
    };
  }
  if (categories.some((category) => /APIEP_CATEGORY_SHADOW/.test(category))) {
    return {
      ...result,
      f5Status: "SHADOW",
      f5Categories: categories,
      f5Confidence: "Alta",
      f5ObservedAt: discoveredEndpoint?.access_discovery_time || "",
    };
  }
  if (discoveredEndpoint) {
    return {
      ...result,
      f5Status: "DISCOVERED",
      f5Categories: categories,
      f5Confidence: "Alta",
      f5ObservedAt: discoveredEndpoint.access_discovery_time || "",
    };
  }
  return {
    ...result,
    f5Status: "UNKNOWN",
    f5Categories: [],
    f5Confidence: "Ninguna",
    f5ObservedAt: "",
  };
}

async function classifyResultsWithF5(results) {
  if (dryRun || !f5Configured) {
    console.log("F5_CORRELATION: done state=SKIPPED");
    return results.map((result) => ({
      ...result,
      f5Status: "NO_DATA",
      f5Categories: [],
      f5Confidence: "Ninguna",
      f5ObservedAt: "",
    }));
  }
  let lastError;
  let classified = [];
  for (let attempt = 1; attempt <= f5Retries; attempt += 1) {
    console.log(`F5_CORRELATION: attempt=${attempt} total=${f5Retries}`);
    try {
      const inventory = await fetchF5ApiInventory();
      classified = results.map((result) => classifyWithF5(result, inventory));
      if (classified.every((result) => result.f5Status !== "UNKNOWN")) {
        console.log("F5_CORRELATION: done state=QUERIED");
        return classified;
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt < f5Retries && f5RetryWaitMs) {
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, f5RetryWaitMs),
      );
    }
  }
  if (classified.length) {
    console.log("F5_CORRELATION: done state=PARTIAL");
    return classified;
  }
  console.error(`F5 API: ${lastError?.message || "consulta no disponible"}`);
  console.log("F5_CORRELATION: done state=ERROR");
  return results.map((result) => ({
    ...result,
    f5Status: "QUERY_ERROR",
    f5Categories: [],
    f5Confidence: "Ninguna",
    f5ObservedAt: "",
  }));
}

async function writeReport(results) {
  const header =
    "resultado\tprueba\tmetodo\turl\thttp\tduracion_ms\testado_f5\tcategorias_f5\tconfianza_f5\tultima_observacion_f5\tque_se_esperaba\tque_ocurrio\tdetalle_respuesta\n";
  const rows = results.map((row) =>
    [
      row.result,
      row.id,
      row.method,
      row.path,
      row.status,
      row.durationMs,
      row.f5Status,
      row.f5Categories.join(","),
      row.f5Confidence,
      row.f5ObservedAt,
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
  if (!operations.length)
    throw new Error("swagger.json no contiene operaciones GET ejecutables");
  console.log(
    `API_TEST_START: total=${operations.length} executable=${operations.length} skipped=0`,
  );
  const token = dryRun ? "" : await login();
  const attemptedResults = await runPool(operations, token);
  const passedResults = attemptedResults.filter((row) => row.result === "PASS");
  const results = await classifyResultsWithF5(passedResults);
  await writeReport(results);
  console.log(
    `API_TEST_DONE: total=${operations.length} passed=${results.length} failed=0 skipped=0`,
  );
  console.log(`Resultados guardados en: ${outputFile}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
