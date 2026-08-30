#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const swaggerPath = resolve(
  process.env.API_TEST_SWAGGER_PATH ||
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
  if (shouldSkip(operation)) {
    return {
      ...operation,
      result: "SKIPPED_MISSING_FIXTURE",
      status: "-",
      durationMs: 0,
      expected: "Valores definidos para todos los parametros de ruta",
      observed: "Swagger no proporciona valores concretos para la ruta",
      detail: "Endpoint omitido para evitar usar identificadores inventados",
    };
  }
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

async function writeReport(results) {
  const header =
    "resultado\tprueba\tmetodo\turl\thttp\tduracion_ms\tque_se_esperaba\tque_ocurrio\tdetalle_respuesta\n";
  const rows = results.map((row) =>
    [
      row.result,
      row.id,
      row.method,
      row.path,
      row.status,
      row.durationMs,
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
  const operations = await loadOperations();
  if (!operations.length)
    throw new Error("swagger.json no contiene operaciones GET");
  const skipped = operations.filter(shouldSkip).length;
  console.log(
    `API_TEST_START: total=${operations.length} executable=${operations.length - skipped} skipped=${skipped}`,
  );
  const token = dryRun ? "" : await login();
  const results = await runPool(operations, token);
  await writeReport(results);
  const passed = results.filter((row) => row.result === "PASS").length;
  const failed = results.filter(
    (row) =>
      row.result.startsWith("FAIL") ||
      row.result === "TIMEOUT" ||
      row.result === "ERROR_CONNECTION",
  ).length;
  console.log(
    `API_TEST_DONE: total=${results.length} passed=${passed} failed=${failed} skipped=${skipped}`,
  );
  console.log(`Resultados guardados en: ${outputFile}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
