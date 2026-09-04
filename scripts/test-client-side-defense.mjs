#!/usr/bin/env node

import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import process from "node:process";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const baseUrl = process.env.BASE_URL || "https://newpip.digitalvs.com";
const outputFile =
  process.env.CLIENT_SIDE_DEFENSE_TEST_OUTPUT ||
  "client-side-defense-results.tsv";
const testId =
  process.env.CLIENT_SIDE_DEFENSE_TEST_ID ||
  "client-side-defense-page";
const canaryValue = "735190";
const scriptPattern = new RegExp(
  process.env.CLIENT_SIDE_DEFENSE_SCRIPT_PATTERN ||
    "client.?side|client.?security|common\\.js|volterra|f5|xc",
  "i",
);

function escapeTsv(value) {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ");
}

async function main() {
  const startedAt = new Date().toISOString();
  const consoleErrors = [];
  const resourceErrors = [];
  const scriptUrls = [];
  const matchingRequests = [];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    resourceErrors.push(`${request.url()} | ${request.failure()?.errorText || "failed"}`);
  });
  page.on("request", (request) => {
    if (scriptPattern.test(request.url())) matchingRequests.push(request.url());
  });

  let response;
  let interactionCompleted = false;
  let sensorDetected = false;
  let sensorInitialized = false;
  let scriptInjectionDetected = false;
  try {
    response = await page.goto(baseUrl, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await page.waitForTimeout(1000);
    scriptUrls.push(
      ...(await page.locator("script[src]").evaluateAll((scripts) =>
        scripts.map((script) => script.src),
      )),
    );
    scriptInjectionDetected = scriptUrls.some((url) => scriptPattern.test(url));
    sensorDetected = scriptInjectionDetected || matchingRequests.length > 0;
    sensorInitialized = sensorDetected && consoleErrors.length === 0;

    await page.evaluate((value) => {
      const input = document.createElement("input");
      input.type = "number";
      input.id = "client-side-defense-canary";
      input.setAttribute("data-security-test", "client-side-defense");
      input.style.position = "fixed";
      input.style.left = "-10000px";
      document.body.appendChild(input);
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, canaryValue);
    interactionCompleted = await page.locator("#client-side-defense-canary").inputValue() === canaryValue;
  } finally {
    await browser.close();
  }

  const status = response?.status() || 0;
  const result =
    status >= 200 && status < 400 && sensorDetected && sensorInitialized && interactionCompleted
      ? "PASÓ"
      : status >= 200 && status < 400
        ? "REVISAR"
        : "FALLÓ";
  const finishedAt = new Date().toISOString();
  const headers = [
    "resultado",
    "prueba",
    "que_se_esperaba",
    "que_ocurrio",
    "http",
    "evento_f5",
    "accion_f5",
    "categoria_f5",
    "confianza_correlacion",
    "metodo",
    "url",
    "fecha_utc",
    "run_id",
    "detalle_respuesta",
  ];
  const row = [
    result,
    testId,
    "JavaScript Client-Side Defense insertado y ejecutado sin errores",
    `script_injection=${scriptInjectionDetected}; sensor_detected=${sensorDetected}; sensor_initialized=${sensorInitialized}; canary_interaction=${interactionCompleted}; console_errors=${consoleErrors.length}; resource_errors=${resourceErrors.length}`,
    status,
    "No consultado",
    "No consultada",
    "Client-Side Defense",
    "No aplica",
    "GET",
    baseUrl,
    startedAt,
    testId,
    `scripts=${scriptUrls.length}; matching_requests=${matchingRequests.length}; canary_value_present=${interactionCompleted}; finished_at=${finishedAt}`,
  ].map(escapeTsv);

  await writeFile(outputFile, `${headers.join("\t")}\n${row.join("\t")}\n`);
  console.log(`CLIENT_SIDE_DEFENSE: result=${result} http=${status}`);
  console.log(`CLIENT_SIDE_DEFENSE: scripts=${scriptUrls.length} matching_requests=${matchingRequests.length}`);
  console.log(`Resultados guardados en: ${outputFile}`);
  if (result === "FALLÓ") process.exitCode = 1;
}

main().catch((error) => {
  console.error("Error ejecutando Client-Side Defense:", error);
  process.exit(1);
});
