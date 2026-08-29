#!/usr/bin/env node

import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const require = createRequire(import.meta.url);
const { chromium } = require("../node_modules/playwright");

const DEFAULT_BASE_URL = "https://newpip.digitalvs.com";
const baseUrl = process.env.BASE_URL || DEFAULT_BASE_URL;
let outputFile = process.env.BOT_TEST_OUTPUT || "bot-defense-results.tsv";
const email = process.env.WAF_LOGIN_EMAIL || "";
const password = process.env.WAF_LOGIN_PASSWORD || "";
const iterations = Math.max(1, Number(process.env.BOT_TEST_ITERATIONS || 1));
const navigationDelay = Math.max(0, Number(process.env.BOT_TEST_DELAY_MS || 800));
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
  WAF_LOGIN_EMAIL          Usuario de pruebas valido, opcional
  WAF_LOGIN_PASSWORD      Password de pruebas, opcional
  BOT_TEST_ITERATIONS     Iteraciones por perfil (default: 1)
  BOT_TEST_DELAY_MS       Pausa entre navegaciones (default: 800)
  BOT_TEST_OUTPUT         Reporte TSV (default: bot-defense-results.tsv)

El script no consulta la API de eventos de F5. Correlaciona cada test_id y el
header X-Bot-Test-ID con los eventos de Bot Defense en F5 DCS.`);
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

function record({ testId, profile, status, result, details }) {
  const row = {
    testId,
    utc: timestamp(),
    profile,
    status,
    result,
    details,
  };
  results.push(row);
  console.log(`${testId} | perfil: ${profile} | HTTP ${status} | ${result} | ${details}`);
}

async function runSession({ testId, profile, javaScriptEnabled, headless, fast }) {
  if (dryRun) {
    record({
      testId,
      profile,
      status: "-",
      result: "NOT_RUN",
      details: "dry-run",
    });
    return;
  }

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
      await page.waitForTimeout(fast ? 50 : navigationDelay);
      if (email && password) {
        const emailInput = page.locator('input[placeholder="E-mail"]');
        const passwordInput = page.locator('input[placeholder="Contraseña"]');
        if (await emailInput.count() && await passwordInput.count()) {
          await emailInput.fill(email);
          await passwordInput.fill(password);
          await page.getByRole("button", { name: /Entrar$/ }).click();
          await page.waitForTimeout(fast ? 50 : navigationDelay);
          details += "; login_attempted=true";
        } else {
          details += "; login_form_not_visible=true";
        }
      }
      result = "REVIEW_F5";
    } else {
      result = "REVIEW_F5";
      details += "; javascript_disabled=true";
    }
  } catch (error) {
    result = "ERROR";
    details = `${details}; ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    await context.close();
    await browser.close();
  }

  record({ testId, profile, status, result, details });
}

async function run() {
  await mkdir(new URL(".", `file://${process.cwd()}/`), { recursive: true });
  const profiles = [
    { name: headed ? "headed-browser" : "browser-headless", javaScriptEnabled: true, headless: false, fast: false },
    { name: "headless", javaScriptEnabled: true, headless: true, fast: true },
    { name: "javascript-disabled", javaScriptEnabled: false, headless: true, fast: false },
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

  const header = "test_id\tutc\tprofile\thttp_status\tresult\tdetails\n";
  const body = results
    .map((row) => [row.testId, row.utc, row.profile, row.status, row.result, row.details].map(escapeTsv).join("\t"))
    .join("\n");
  await writeFile(outputFile, `${header}${body}\n`, "utf8");
  console.log(`\nResultados guardados en: ${outputFile}`);
  console.log("Correlaciona test_id y X-Bot-Test-ID con eventos de F5 DCS.");
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
