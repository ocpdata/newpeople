import { expect, test } from "@playwright/test";

const roles = [
  { code: "fast", label: "Rápido", description: "Tareas simples" },
  { code: "advanced", label: "Avanzado", description: "Razonamiento" },
  { code: "transcription", label: "Transcripción", description: "Audio a texto" },
];

const modules = [
  { code: "mi_coach", label: "Mi Coach", usesLlm: true },
  { code: "customer_account", label: "Cliente existente", usesLlm: true, usesTavily: true, usesPinecone: true },
  { code: "prospect", label: "Cuenta nueva", usesLlm: true, usesTavily: true },
  { code: "quotations", label: "Cotizaciones", usesLlm: true },
  { code: "proposals", label: "Propuestas", usesLlm: true },
  { code: "documentation_rag", label: "Documentación RAG", usesLlm: false, usesPinecone: true, pineconeRequired: true },
];

function buildSettings(version = 2) {
  return {
    version,
    providers: {
      openai: {
        models: { fast: "gpt-4.1-mini", advanced: "gpt-6.1-sol", transcription: "gpt-4o-mini-transcribe" },
        monthlyLimitUsd: 100,
        warningPercent: 80,
        onLimit: "warn",
      },
      tavily: { monthlyLimitCredits: null, usdPerCredit: null, warningPercent: 80, onLimit: "warn" },
      pinecone: { plan: "starter", warningPercent: 80 },
    },
    modules: Object.fromEntries(modules.map((module) => [module.code, {
      llmProvider: "openai",
      tavily: Boolean(module.usesTavily),
      pinecone: Boolean(module.usesPinecone),
      modelOverrides: {},
    }])),
  };
}

function buildOverview() {
  return {
    settings: buildSettings(),
    periodKey: "2026-10",
    periodStartUtc: "2026-10-01T06:00:00.000Z",
    timeZone: "America/Mexico_City",
    catalog: {
      modules,
      roles,
      llmProviders: [{ code: "openai", label: "OpenAI" }],
      pineconePlans: [
        { code: "starter", label: "Starter", limits: {} },
        { code: "builder", label: "Builder", limits: {} },
      ],
      pineconeMetrics: [],
    },
    connections: { openai: true, tavily: true, tavilyEnabled: true, pinecone: true },
    statuses: {
      openai: {
        code: "openai",
        label: "OpenAI",
        kind: "llm",
        configured: true,
        level: "normal",
        costUsd: 62.4,
        calls: 1840,
        balance: {
          capturedUsd: 9.06,
          capturedAt: "2026-10-26T21:40:00.000Z",
          spentSinceUsd: 0.5,
          estimatedUsd: 8.56,
          warningUsd: 5,
          level: "normal",
        },
        byModel: [
          { model: "gpt-6.1-sol", costUsd: 48.1, calls: 300 },
          { model: "gpt-4.1-mini", costUsd: 14.3, calls: 1540 },
        ],
        metrics: [
          { code: "cost_usd", label: "Consumo medido por el CRM", unit: "usd", used: 62.4, limit: 100, percent: 62.4, level: "normal" },
          { code: "balance_usd@abc", kind: "balance", label: "Saldo estimado", unit: "usd", used: 8.56, limit: null, percent: null, level: "normal" },
        ],
      },
      tavily: {
        code: "tavily",
        label: "Tavily",
        kind: "search",
        configured: true,
        enabledInServer: true,
        level: "normal",
        measuredCredits: 120,
        usdPerCredit: 0.0067,
        priceSource: "plan",
        costUsd: 2.28,
        remote: { plan: "Bootstrap", planUsage: 340, planLimit: 15000, fetchedAt: new Date().toISOString(), error: null },
        metrics: [{ code: "credits", label: "Créditos del ciclo (leído de Tavily)", unit: "credits", used: 340, limit: 15000, percent: 2.3, level: "normal" }],
      },
      pinecone: {
        code: "pinecone",
        label: "Pinecone Assistant",
        kind: "documents",
        configured: true,
        plan: "starter",
        planLabel: "Starter",
        blocksAtLimit: true,
        level: "warning",
        costUsd: 0,
        metrics: [
          { code: "chat_input_tokens", label: "Respuestas: tokens de entrada", unit: "tokens", used: 425000, limit: 500000, percent: 85, level: "warning" },
          { code: "chat_output_tokens", label: "Respuestas: tokens de salida", unit: "tokens", used: 90000, limit: 300000, percent: 30, level: "normal" },
          { code: "context_tokens", label: "Búsqueda de contexto", unit: "tokens", used: 120000, limit: 500000, percent: 24, level: "normal" },
          { code: "ingestion_units", label: "Carga de documentos", unit: "unidades", used: 300, limit: 1000, percent: 30, level: "normal" },
        ],
      },
    },
    modulesUsage: {
      mi_coach: { llmCostUsd: 30, tavilyCredits: 0, pineconeTokens: 0 },
      customer_account: { llmCostUsd: 20, tavilyCredits: 80, pineconeTokens: 200000 },
      prospect: { llmCostUsd: 6, tavilyCredits: 40, pineconeTokens: 0 },
    },
    readiness: {
      errors: [],
      providerIssues: {},
      moduleIssues: { quotations: ["Falta tarifa vigente para gpt-x (Rápido)."] },
    },
    tariffModels: { openai: ["gpt-4.1-mini", "gpt-4o-mini-transcribe", "gpt-6.1-sol", "gpt-6-astra"] },
    alerts: [{ id: 5, provider: "pinecone", metric: "chat_input_tokens", level: "warning", percent: 85, message: "Pinecone Assistant · Respuestas: tokens de entrada superó el umbral de aviso (85%)." }],
  };
}

const usageFixture = {
  fromUtc: "2026-10-01T06:00:00.000Z",
  toUtc: "2026-10-26T20:00:00.000Z",
  timeZone: "America/Mexico_City",
  days: [
    { day: "2026-10-25", llmCostUsd: 3.2, llmCalls: 90, tavilyCredits: 12, tavilyCostUsd: 0.08, pineconeTokens: 8000, pineconeCostUsd: 0 },
    { day: "2026-10-26", llmCostUsd: 5.1, llmCalls: 140, tavilyCredits: 20, tavilyCostUsd: 0.13, pineconeTokens: 12000, pineconeCostUsd: 0 },
  ],
  modules: [
    { module: "customer_account", label: "Cliente existente", llmCostUsd: 20, llmCalls: 300, tavilyCredits: 80, tavilyCostUsd: 0.54, pineconeTokens: 200000, pineconeCostUsd: 0 },
  ],
  models: [{ provider: "openai", model: "gpt-6.1-sol", costUsd: 48.1, calls: 300, tokens: 900000 }],
  topUsers: [{ userId: 31, fullName: "Ana Ventas", email: "ana@example.com", costUsd: 12.5, calls: 80, tavilyCredits: 10, pineconeTokens: 3000 }],
  errors: [{ provider: "tavily", module: "prospect", moduleLabel: "Cuenta nueva", statusCode: 429, message: "rate limit", createdAtUtc: "2026-10-26T18:00:00.000Z" }],
};

const allocationsFixture = {
  plan: { version: 4, warningPercent: 80 },
  limited: true,
  capturedUsd: 9.06,
  capturedAt: "2026-10-26T21:40:00.000Z",
  spentSinceUtc: "2026-10-26T21:40:00.000Z",
  totals: { assignedPercent: 70, reservePercent: 30, reserveUsd: 2.718, reserveSpentUsd: 0.2, reserveAvailableUsd: 2.518, reserveState: "normal" },
  users: [
    {
      userId: 31, fullName: "Ana Ventas", email: "ana@example.com", roles: "Vendedor", percent: 40, usedAiRecently: true,
      spentUsd: 1.1, allocatedUsd: 3.624, availableUsd: 2.524, consumedPercent: 30, source: "allocation", state: "normal",
      byModule: [{ module: "customer_account", label: "Cliente existente", costUsd: 1.1, calls: 12 }],
    },
    {
      userId: 32, fullName: "Luis Preventa", email: "luis@example.com", roles: "Preventa", percent: 30, usedAiRecently: true,
      spentUsd: 0, allocatedUsd: 2.718, availableUsd: 2.718, consumedPercent: 0, source: "allocation", state: "normal", byModule: [],
    },
    {
      userId: 33, fullName: "Marta Nueva", email: "marta@example.com", roles: "Vendedor", percent: null, usedAiRecently: false,
      spentUsd: 0.2, allocatedUsd: null, availableUsd: 2.518, consumedPercent: 7, source: "reserve", state: "normal", byModule: [],
    },
  ],
};

async function mockApi(page, { saveStatus = 200 } = {}) {
  const state = { savedBodies: [], acknowledged: [], allocationBodies: [] };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const method = request.method();
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/api/auth/bootstrap-status") return json({ hasUsers: true });
    if (pathname === "/api/auth/me") {
      return json({
        id: 1,
        full_name: "Admin IA",
        email: "admin@example.com",
        status: "active",
        roles: [{ name: "Administrador" }],
        permissions: ["configuracion.read", "configuracion.update", "ia.budget.read_all", "ia.budget.manage"],
      });
    }
    if (pathname === "/api/ai/services/alerts") return json({ items: buildOverview().alerts });
    if (pathname.startsWith("/api/ai/services/alerts/") && method === "POST") {
      state.acknowledged.push(pathname);
      return route.fulfill({ status: 204, body: "" });
    }
    if (pathname === "/api/admin/ai/services" && method === "GET") return json(buildOverview());
    if (pathname === "/api/admin/ai/services/settings" && method === "PUT") {
      state.savedBodies.push(request.postDataJSON());
      if (saveStatus !== 200) {
        return json({
          code: "AI_SERVICES_INVALID",
          message: "La configuración tiene modelos sin tarifa vigente.",
          details: ["Propuestas: Falta tarifa vigente para gpt-y (Avanzado)."],
        }, saveStatus);
      }
      return json({ settings: buildSettings(3) });
    }
    if (pathname === "/api/admin/ai/services/usage") return json(usageFixture);
    if (pathname === "/api/admin/ai/allocations" && method === "GET") return json(allocationsFixture);
    if (pathname === "/api/admin/ai/allocations" && method === "PUT") {
      state.allocationBodies.push(request.postDataJSON());
      return json({ plan: { version: 5 } });
    }
    if (pathname === "/api/admin/ai/wallets/31") {
      return json({ recentTransactions: [{ id: 1, reasonText: "Recarga de crédito IA", amountUsd: 5, createdAtUtc: "2026-09-01T12:00:00.000Z" }] });
    }
    if (pathname === "/api/catalogs/countries") return json([]);
    if (pathname === "/api/admin/ai/pricing-rates") return json({ items: [] });
    if (pathname === "/api/ai/me/credit-summary") return json({}, 404);
    return json({});
  });
  return state;
}

async function openAiBudget(page) {
  await page.addInitScript((token) => window.localStorage.setItem("crm_token", token), "jwt-token");
  await page.goto("/settings?section=ai_budget");
  await expect(page.getByRole("navigation", { name: "Secciones de Crédito IA" })).toBeVisible();
}

test("Crédito IA resume proveedores, avisa al administrador y separa el consumo medido", async ({ page }) => {
  const state = await mockApi(page);
  await openAiBudget(page);

  const openai = page.getByRole("article", { name: "Proveedor OpenAI" });
  await expect(openai.locator(".ai-services-metric")).toContainText(/62\.40 de .*100\.00/);
  await expect(openai.locator(".ai-services-metric")).toHaveCount(1);
  await expect(openai.locator(".ai-services-balance")).toContainText(/Saldo estimado\s*USD\s8\.56/);
  await expect(openai.locator(".ai-services-balance")).toContainText(/Capturado USD\s9\.06/);
  await expect(openai.locator(".ai-services-model-row code")).toHaveText(["gpt-4.1-mini", "gpt-6.1-sol", "gpt-4o-mini-transcribe"]);
  await expect(openai.getByText("✓ tarifa vigente")).toHaveCount(3);

  const tavily = page.getByRole("article", { name: "Proveedor Tavily" });
  await expect(tavily.getByText("Plan Bootstrap", { exact: false })).toBeVisible();
  await expect(tavily.getByText("120 créditos")).toBeVisible();

  const pinecone = page.getByRole("article", { name: "Proveedor Pinecone Assistant" });
  await expect(pinecone.getByText("Aviso")).toBeVisible();
  await expect(pinecone.getByText("425,000 de 500,000 tokens · 85%")).toBeVisible();

  const banner = page.locator(".ai-service-alert-banner");
  await expect(banner).toContainText("superó el umbral de aviso (85%)");
  await banner.getByRole("button", { name: "Entendido" }).click();
  await expect(banner).toHaveCount(0);
  expect(state.acknowledged).toEqual(["/api/ai/services/alerts/5/acknowledge"]);

  await page.screenshot({ path: test.info().outputPath("ai-services-summary.png"), fullPage: true });

  await openai.getByRole("button", { name: "Editar" }).click();
  await openai.locator("#ai-model-advanced").selectOption("gpt-6-astra");
  await openai.getByLabel("Saldo actual en OpenAI (USD)").fill("20");
  await expect(openai.getByText("Cambiar el modelo Avanzado afecta la calidad")).toBeVisible();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Configuración guardada.")).toBeVisible();
  expect(state.savedBodies[0]).toMatchObject({
    expectedVersion: 2,
    settings: { providers: { openai: { models: { advanced: "gpt-6-astra" }, balanceUsd: 20, recaptureBalance: true } } },
  });
  expect(state.savedBodies[0].settings).not.toHaveProperty("version");
});

test("Crédito IA asigna proveedor y servicios por módulo y muestra por qué no se puede guardar", async ({ page }) => {
  const state = await mockApi(page, { saveStatus: 422 });
  await openAiBudget(page);
  await page.getByRole("button", { name: "Módulos", exact: true }).click();

  const table = page.locator(".ai-services-modules-table");
  await expect(table.getByRole("row", { name: /Cotizaciones/ })).toContainText("Falta tarifa vigente para gpt-x");
  await expect(table.getByRole("row", { name: /^Propuestas/ })).toBeVisible();
  await expect(page.getByLabel("Pinecone en Documentación RAG")).toBeDisabled();
  await expect(page.getByLabel("Tavily en Cuenta nueva")).toBeChecked();

  await page.getByLabel("Tavily en Cuenta nueva").uncheck();
  await table.getByRole("row", { name: /^Propuestas/ }).getByRole("button", { name: "Personalizar modelos" }).click();
  await page.locator(".ai-services-overrides select").nth(1).selectOption("gpt-6-astra");
  await expect(table.getByRole("row", { name: /^Propuestas/ })).toContainText("Modelos personalizados");
  await page.screenshot({ path: test.info().outputPath("ai-services-modules.png"), fullPage: true });

  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.locator(".ai-services-savebar li")).toHaveText(["Propuestas: Falta tarifa vigente para gpt-y (Avanzado)."]);
  expect(state.savedBodies[0].settings.modules).toMatchObject({
    prospect: { tavily: false },
    proposals: { modelOverrides: { advanced: "gpt-6-astra" } },
  });

  await page.getByRole("button", { name: "Descartar" }).click();
  await expect(page.getByLabel("Tavily en Cuenta nueva")).toBeChecked();
});

test("Crédito IA muestra el consumo por día, módulo, modelo, usuario y errores", async ({ page }) => {
  await mockApi(page);
  await openAiBudget(page);
  await page.getByRole("button", { name: "Consumo", exact: true }).click();

  await expect(page.getByText("Uso diario")).toBeVisible();
  await expect(page.locator(".ai-services-days li")).toHaveCount(2);
  await expect(page.getByRole("row", { name: /Cliente existente/ })).toContainText("80 cr");
  await expect(page.getByText("Ana Ventas")).toBeVisible();
  await expect(page.locator(".ai-services-errors")).toContainText("rate limit");
  await expect(page.getByRole("button", { name: "Exportar a Excel" })).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath("ai-services-usage.png"), fullPage: true });

  await page.getByRole("button", { name: "Tarifas", exact: true }).click();
  await expect(page.getByText("Entrada (USD por millón de tokens)")).toBeVisible();
});

test("Crédito por usuario reparte el saldo capturado por porcentaje entre usuarios activos", async ({ page }) => {
  const state = await mockApi(page);
  await openAiBudget(page);
  await page.getByRole("button", { name: "Crédito por usuario", exact: true }).click();

  const panel = page.locator(".ai-allocations");
  await expect(panel.getByRole("heading", { name: "Crédito por usuario" })).toBeVisible();
  await expect(panel.locator(".ai-allocations-summary")).toContainText(/Saldo capturado\s*USD\s9\.06/);
  await expect(panel.locator(".ai-allocations-summary")).toContainText(/Reserva compartida\s*30 %/);
  await expect(panel.locator(".ai-allocations-table tbody tr")).toHaveCount(3);
  await expect(panel.getByRole("row", { name: /Marta Nueva/ })).toContainText("Compartida");
  await expect(page.getByText("Recargar crédito")).toHaveCount(0);

  await panel.getByRole("button", { name: /Ana Ventas/ }).click();
  await expect(panel.locator(".ai-allocations-detail")).toContainText("Cliente existente");
  await panel.getByRole("button", { name: "Ver historial" }).click();
  await expect(panel.locator(".ai-allocations-detail")).toContainText("Recarga de crédito IA");

  await panel.getByLabel("Porcentaje de Luis Preventa").fill("70");
  await expect(panel.getByText("Los porcentajes suman 110 %; el máximo es 100 %.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();

  await panel.getByRole("button", { name: "Repartir en partes iguales" }).click();
  await expect(panel.getByLabel("Porcentaje de Ana Ventas")).toHaveValue("50");
  await expect(panel.getByLabel("Porcentaje de Luis Preventa")).toHaveValue("50");
  await expect(panel.getByLabel("Porcentaje de Marta Nueva")).toHaveValue("");
  await page.screenshot({ path: test.info().outputPath("ai-allocations.png"), fullPage: true });
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Asignaciones guardadas.")).toBeVisible();
  expect(state.allocationBodies[0]).toEqual({
    expectedVersion: 4,
    warningPercent: 80,
    users: [
      { userId: 31, percent: 50 },
      { userId: 32, percent: 50 },
      { userId: 33, percent: null },
    ],
  });
});
