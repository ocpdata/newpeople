#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASE_URL = "https://newpip.digitalvs.com";
const baseUrl = process.env.BASE_URL || DEFAULT_BASE_URL;
let outputFile =
  process.env.RATE_LIMIT_TEST_OUTPUT ||
  process.env.WAF_TEST_OUTPUT ||
  "waf-rate-limit.tsv";

const dryRun = process.argv.includes("--dry-run");
const duration = process.env.RATE_LIMIT_DURATION || "10s";
const rps = Math.max(1, Number(process.env.RATE_LIMIT_RPS || 120));
const parsedDurationSeconds =
  Number(duration.replace(/[^0-9.]/g, "")) || 10;
const defaultCalculatedRequests = Math.max(
  1,
  Math.round(rps * parsedDurationSeconds),
);
const totalRequests = Math.max(
  1,
  Number(process.env.RATE_LIMIT_REQUESTS || defaultCalculatedRequests),
);

const outputIndex = process.argv.indexOf("--output");
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  outputFile = process.argv[outputIndex + 1];
}

const runId = `rl-${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${process.pid}`;
const runStartedAt = new Date().toISOString();
let activeChild = null;
let stopping = false;

function usage() {
  console.log(`Uso: scripts/test-rate-limit.mjs [opciones]

Opciones:
  --dry-run      Simula la prueba sin ejecutar solicitudes k6
  --output FILE  Ruta del archivo TSV de reporte
  -h, --help     Muestra esta ayuda

Variables de entorno:
  BASE_URL                       URL objetivo (default: ${DEFAULT_BASE_URL})
  RATE_LIMIT_RPS                 Tasa de peticiones por segundo (default: 120)
  RATE_LIMIT_DURATION            Duración de la ráfaga (default: 10s)
  RATE_LIMIT_REQUESTS            Cantidad total de solicitudes (default: 1200)
  RATE_LIMIT_TEST_OUTPUT         Ruta del archivo TSV de salida
`);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  usage();
  process.exit(0);
}

function escapeTsv(value) {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ");
}

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChild = child;
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (options.forwardOutput) process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (options.forwardOutput) process.stderr.write(text);
    });

    child.on("error", (error) => {
      activeChild = null;
      rejectPromise(error);
    });

    child.on("close", (exitCode) => {
      activeChild = null;
      if (
        options.acceptedExitCodes &&
        !options.acceptedExitCodes.includes(exitCode ?? -1)
      ) {
        const error = new Error(
          `${command} terminó con código ${exitCode}: ${stderr || stdout}`,
        );
        error.exitCode = exitCode;
        error.stdout = stdout;
        error.stderr = stderr;
        rejectPromise(error);
        return;
      }
      resolvePromise({ exitCode: exitCode ?? 0, stdout, stderr });
    });
  });
}

function handleSignal(signal) {
  if (stopping) return;
  stopping = true;
  if (activeChild && !activeChild.killed) {
    activeChild.kill(signal);
  }
  process.exit(130);
}

process.on("SIGINT", () => handleSignal("SIGINT"));
process.on("SIGTERM", () => handleSignal("SIGTERM"));

function findEventField(value, names) {
  if (!value || typeof value !== "object") return "";
  const expected = new Set(names.map((name) => name.toLowerCase()));
  for (const [key, nested] of Object.entries(value)) {
    if (expected.has(key.toLowerCase()) && nested != null) {
      return typeof nested === "object"
        ? JSON.stringify(nested)
        : String(nested);
    }
    if (nested && typeof nested === "object") {
      const found = findEventField(nested, names);
      if (found) return found;
    }
  }
  return "";
}

function translateF5Action(action) {
  const lower = String(action || "").toLowerCase();
  if (lower.includes("block") || lower.includes("deny")) return "Bloqueada";
  if (lower.includes("detect")) return "Detectada";
  if (lower.includes("allow")) return "Permitida";
  if (lower.includes("challenge")) return "Desafío aplicado";
  if (lower.includes("rate") && lower.includes("limit"))
    return "Limitada por frecuencia";
  return action || "Sin acción registrada";
}

function translateF5Category(category) {
  const lower = String(category || "").toLowerCase();
  if (lower.includes("rate") || lower.includes("limit") || lower.includes("dos"))
    return "Límite de frecuencia / DoS";
  return category || "Sin categoría registrada";
}

async function main() {
  console.log(`\nRate limiting: ${totalRequests} solicitudes a ~${rps} RPS con k6 (Origen: IP única local).\n`);
  const targetUrl = new URL("/", baseUrl).toString();
  const rawRows = [];

  if (dryRun) {
    for (let i = 1; i <= totalRequests; i += 1) {
      const testId = `test-21-rate-limit-${i}`;
      console.log(
        `[DRY-RUN] ${testId} | Umbral configurado (${rps} RPS) | esperado: HTTP 429 o evento de limitacion`,
      );
      rawRows.push({
        testId,
        time: new Date().toISOString(),
        status: "200",
        rejected: false,
        durationMs: 0,
        dry: true,
      });
    }
  } else {
    const tempDir = await mkdtemp(join(tmpdir(), "k6-rl-"));
    const jsonOutput = join(tempDir, "k6-results.json");
    try {
      const k6Script = resolve(SCRIPT_DIR, "k6-rate-limit.js");
      await runCommand(
        "k6",
        [
          "run",
          "--out",
          `json=${jsonOutput}`,
          "-e",
          `TARGET_URL=${targetUrl}`,
          "-e",
          `RUN_ID=${runId}`,
          "-e",
          `RATE_LIMIT_RPS=${rps}`,
          "-e",
          `RATE_LIMIT_DURATION=${duration}`,
          k6Script,
        ],
        {
          acceptedExitCodes: [0, 99],
          forwardOutput: true,
          env: process.env,
        },
      );

      const jsonContent = await readFile(jsonOutput, "utf8").catch(() => "");
      const lines = jsonContent.trim().split("\n").filter(Boolean);
      const pointsByTestId = new Map();

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (
            parsed.type === "Point" &&
            (parsed.metric === "http_req_duration" || parsed.metric === "http_reqs")
          ) {
            const tags = parsed.data?.tags || {};
            const testId = tags.test_id;
            if (testId && !pointsByTestId.has(testId)) {
              pointsByTestId.set(testId, {
                testId,
                time: parsed.data.time,
                status: String(tags.status || "000"),
                rejected: tags.rejected === "true",
                durationMs: Math.round(Number(parsed.data.value || 0)),
                dry: false,
              });
            }
          }
        } catch {}
      }

      for (let i = 1; i <= totalRequests; i += 1) {
        const testId = `test-21-rate-limit-${i}`;
        const found = pointsByTestId.get(testId);
        if (found) {
          rawRows.push(found);
        } else {
          rawRows.push({
            testId,
            time: new Date().toISOString(),
            status: "000",
            rejected: false,
            durationMs: 0,
            dry: false,
          });
        }
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  const f5State = "SKIPPED";
  const f5Events = [];

  // Generate TSV
  const tsvHeader = [
    "resultado",
    "prueba",
    "que_se_esperaba",
    "que_ocurrio",
    "http",
    "evento_f5",
    "accion_f5",
    "categoria_f5",
    "firma_f5_original",
    "confianza_correlacion",
    "metodo",
    "url",
    "fecha_utc",
    "id_evento_f5",
    "id_solicitud_f5",
    "run_id",
    "detalle_f5",
    "detalle_respuesta",
  ];

  const tsvRows = [tsvHeader.join("\t")];

  for (const row of rawRows) {
    const expected = "HTTP 429 o evento de limitacion";
    const status = String(row.status);
    let matchedEvent = null;

    if (f5State === "QUERIED" && f5Events.length > 0) {
      matchedEvent = f5Events.find((evt) => {
        const str = JSON.stringify(evt);
        return str.includes(row.testId) || str.includes(runId);
      });
    }

    const eventFound = Boolean(matchedEvent);
    const action = matchedEvent
      ? findEventField(matchedEvent, ["action", "enforcement_action", "waf_action"])
      : "";
    const category = matchedEvent
      ? findEventField(matchedEvent, ["category", "attack_type", "threat_type"])
      : "";
    const signature = matchedEvent
      ? findEventField(matchedEvent, ["signature", "signature_name", "attack_name"])
      : "";
    const eventId = matchedEvent
      ? findEventField(matchedEvent, ["event_id", "id", "uid"])
      : "";
    const reqId = matchedEvent
      ? findEventField(matchedEvent, ["request_id", "req_id", "correlation_id"])
      : "";
    const eventMessage = matchedEvent
      ? findEventField(matchedEvent, ["message", "summary_msg", "description"])
      : "";

    let resultado = "REVISAR";
    let queOcurrio = "";
    const isLimited =
      status === "429" ||
      status === "403" ||
      row.rejected ||
      /rate.?limit|block|deny/i.test(action);

    if (row.dry) {
      resultado = "NO EJECUTADA";
      queOcurrio = "La prueba fue simulada; no se envió ninguna solicitud.";
    } else if (isLimited) {
      resultado = "PASÓ";
      queOcurrio = eventFound
        ? `F5 detectó el umbral y aplicó la acción ${translateF5Action(action)}.`
        : `HTTP ${status}; se activó una protección perimetral o límite de frecuencia.`;
    } else if (status === "200") {
      resultado = "REVISAR";
      queOcurrio =
        f5State === "SKIPPED"
          ? "La solicitud respondió HTTP 200, pero F5 no fue consultado."
          : "La solicitud respondió HTTP 200 sin activación de límite o evento de F5.";
    } else {
      resultado = "REVISAR";
      queOcurrio = `La solicitud respondió HTTP ${status}.`;
    }

    let eventStatus = "No";
    if (f5State === "ERROR") eventStatus = "Error al consultar";
    else if (f5State === "SKIPPED") eventStatus = "No consultado";
    else if (eventFound) eventStatus = "Sí";

    let confidence = "Ninguna";
    if (matchedEvent) {
      confidence = JSON.stringify(matchedEvent).includes(row.testId)
        ? "Alta"
        : "Media";
    }

    const detailResponse = `status=${status}; duration_ms=${row.durationMs}; run_id=${runId}`;

    const tsvLine = [
      escapeTsv(resultado),
      escapeTsv(row.testId),
      escapeTsv(expected),
      escapeTsv(queOcurrio),
      escapeTsv(status),
      escapeTsv(eventStatus),
      escapeTsv(translateF5Action(action)),
      escapeTsv(translateF5Category(category)),
      escapeTsv(signature),
      escapeTsv(confidence),
      "GET",
      escapeTsv(targetUrl),
      escapeTsv(row.time),
      escapeTsv(eventId),
      escapeTsv(reqId),
      escapeTsv(runId),
      escapeTsv(eventMessage),
      escapeTsv(detailResponse),
    ];

    tsvRows.push(tsvLine.join("\t"));
  }

  await writeFile(outputFile, `${tsvRows.join("\n")}\n`, "utf8");
  console.log(`\nResultados guardados en: ${outputFile}`);
  console.log(`Total de solicitudes ejecutadas o simuladas: ${rawRows.length}`);
}

main().catch((error) => {
  console.error("Error ejecutando prueba de rate limit:", error);
  process.exit(1);
});
