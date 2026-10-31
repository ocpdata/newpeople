import { readFile } from "node:fs/promises";
import { buildSubmission, endpointFor } from "../src/customer-chat-quality/submission.js";

// Sends a live-evaluation report to the application, which stores it and compares it with earlier runs.
// Usage: npm run quality:submit --workspace=apps/api -- --source=contract|pipeline --file=report.json
//        npm run quality:submit --workspace=apps/api -- --status   (prints weeklyEnabled=true|false)
// Environment: CUSTOMER_CHAT_QUALITY_API_URL (e.g. https://app.example.com) and CUSTOMER_CHAT_QUALITY_CI_TOKEN.

const args = process.argv.slice(2);
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const baseUrl = process.env.CUSTOMER_CHAT_QUALITY_API_URL;
const token = process.env.CUSTOMER_CHAT_QUALITY_CI_TOKEN;
const prefix = "api/internal/customer-chat-quality";

async function call(path, body) {
  const response = await fetch(endpointFor(baseUrl, `${prefix}/${path}`), {
    method: body ? "POST" : "GET",
    redirect: "error",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.message || "respuesta inesperada"}`);
  return data;
}

try {
  if (!baseUrl || !token) throw new Error("Faltan CUSTOMER_CHAT_QUALITY_API_URL o CUSTOMER_CHAT_QUALITY_CI_TOKEN.");
  if (args.includes("--status")) {
    const { weeklyEnabled } = await call("status");
    console.log(`weeklyEnabled=${weeklyEnabled === true}`);
  } else {
    const source = option("source");
    const file = option("file");
    if (!["contract", "pipeline"].includes(source) || !file) throw new Error("Indica --source=contract|pipeline y --file=<reporte.json>.");
    const report = JSON.parse(await readFile(file, "utf8"));
    const result = await call("reports", buildSubmission({ source, report, commit: process.env.GITHUB_SHA || process.env.GIT_COMMIT }));
    console.log(JSON.stringify(result));
    if (result.status === "regressed") console.log(`::warning::La calidad bajó frente a la ejecución anterior: ${result.reasons.join(" ")}`);
    if (result.status === "failed") console.log(`::warning::${source} no cumple su umbral: ${result.reasons.join(" ")}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
