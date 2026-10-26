import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query } from "../src/db.js";
import { ensureAiUsageSchema } from "../src/ai-usage/service.js";
import {
  acknowledgeAiServiceAlert,
  ensureAiServicesSchema,
  getAiServicesOverview,
  getAiServicesUsage,
  listAiServiceAlerts,
  loadAiServiceSettings,
  recordAiServiceError,
  recordAiServiceUsage,
  saveAiServiceSettings,
} from "../src/ai-services/store.js";
import { getAiServiceSettings, setAiServiceSettingsCache } from "../src/ai-services/state.js";
import { listUserAllocations, saveAllocationPlan } from "../src/ai-services/allocations.js";
import {
  assertAiBudgetAvailable,
  getAiCreditSummaryByUserId,
  recordAiUsageFromOpenAiResponse,
} from "../src/ai-usage/service.js";

const suffix = `${process.pid}-${Date.now()}`;
const models = {
  fast: `test-fast-${suffix}`,
  advanced: `test-advanced-${suffix}`,
  transcription: `test-transcribe-${suffix}`,
};

async function resetAiServiceTables() {
  await query("DELETE FROM ai_service_settings");
  await query("DELETE FROM ai_service_settings_audit");
  await query("DELETE FROM ai_service_usage_events");
  await query("DELETE FROM ai_service_call_errors");
  await query("DELETE FROM ai_service_alerts");
  await query("DELETE FROM ai_service_remote_usage");
  await query("DELETE FROM ai_user_allocation_plan");
  await query("DELETE FROM ai_user_allocation_plan_audit");
}

function settingsWith(overrides = {}) {
  const base = JSON.parse(JSON.stringify(getAiServiceSettings()));
  delete base.version;
  base.providers.openai.models = { ...models };
  return { ...base, ...overrides };
}

describe("AI services store (MySQL)", () => {
  beforeAll(async () => {
    await ensureAiUsageSchema();
    await ensureAiServicesSchema();
    await resetAiServiceTables();
    setAiServiceSettingsCache(null);
    const now = new Date(Date.now() - 60_000);
    for (const model of Object.values(models)) {
      await query(
        `INSERT INTO ai_pricing_rates
           (provider, model, input_usd_per_million_micros, output_usd_per_million_micros,
            cached_input_usd_per_million_micros, valid_from_utc, valid_to_utc, source,
            source_reference, created_by_user_id, created_at_utc, updated_at_utc)
         VALUES ('openai', ?, 2000000, 10000000, 100000, ?, NULL, 'test', NULL, NULL, ?, ?)`,
        [model, now, now, now],
      );
    }
  });

  afterAll(async () => {
    await query("DELETE FROM ai_usage_ledger WHERE model LIKE ?", [`%-${suffix}`]);
    await resetAiServiceTables();
    await query("DELETE FROM ai_pricing_rates WHERE source = 'test' AND model LIKE ?", [`%-${suffix}`]);
    setAiServiceSettingsCache(null);
  });

  it("saves versioned settings with audit and rejects stale or unpriced changes", async () => {
    const saved = await saveAiServiceSettings({ settings: settingsWith(), expectedVersion: 0, actorUserId: null });
    expect(saved.version).toBe(1);
    expect(saved.providers.openai.models).toEqual(models);
    const audit = await query("SELECT version FROM ai_service_settings_audit ORDER BY id");
    expect(audit.map((row) => Number(row.version))).toEqual([1]);

    await expect(
      saveAiServiceSettings({ settings: settingsWith(), expectedVersion: 0, actorUserId: null }),
    ).rejects.toMatchObject({ status: 409, code: "AI_SERVICES_VERSION_CONFLICT" });

    const unpriced = settingsWith();
    unpriced.modules.quotations = { ...unpriced.modules.quotations, modelOverrides: { fast: `missing-${suffix}` } };
    await expect(
      saveAiServiceSettings({ settings: unpriced, expectedVersion: 1, actorUserId: null }),
    ).rejects.toMatchObject({
      status: 422,
      details: [`Cotizaciones: Falta tarifa vigente para missing-${suffix} (Rápido).`],
    });

    setAiServiceSettingsCache(null);
    const loaded = await loadAiServiceSettings();
    expect(loaded.version).toBe(1);
    expect(loaded.providers.openai.models.advanced).toBe(models.advanced);
  });

  it("stamps the balance capture on the server and keeps it until a new balance is entered", async () => {
    const before = Date.now();
    const withBalance = settingsWith();
    withBalance.providers.openai = {
      ...withBalance.providers.openai,
      balanceUsd: 9.06,
      balanceWarningUsd: 5,
      balanceCapturedAt: "2001-01-01T00:00:00.000Z",
    };
    const first = await saveAiServiceSettings({ settings: withBalance, expectedVersion: 1, actorUserId: null });
    const capturedAt = new Date(first.providers.openai.balanceCapturedAt).getTime();
    expect(first.providers.openai.balanceUsd).toBe(9.06);
    expect(capturedAt).toBeGreaterThanOrEqual(before - 1000);

    const unchanged = settingsWith();
    unchanged.providers.openai = { ...unchanged.providers.openai, balanceUsd: 9.06, balanceWarningUsd: 4 };
    const second = await saveAiServiceSettings({ settings: unchanged, expectedVersion: 2, actorUserId: null });
    expect(second.providers.openai.balanceCapturedAt).toBe(first.providers.openai.balanceCapturedAt);

    const overview = await getAiServicesOverview();
    expect(overview.statuses.openai.balance).toMatchObject({ capturedUsd: 9.06, warningUsd: 4 });
    expect(overview.statuses.openai.balance.estimatedUsd).toBeLessThanOrEqual(9.06);

    const cleared = settingsWith();
    cleared.providers.openai = { ...cleared.providers.openai, balanceUsd: null };
    const third = await saveAiServiceSettings({ settings: cleared, expectedVersion: 3, actorUserId: null });
    expect(third.providers.openai).toMatchObject({ balanceUsd: null, balanceCapturedAt: null });
  });

  it("reports measured Tavily and Pinecone usage by module, raises alerts once and acknowledges them", async () => {
    await recordAiServiceUsage({ provider: "tavily", metric: "credits", units: 4, featureCode: "prospect_research.external" });
    await recordAiServiceUsage({ provider: "tavily", metric: "credits", units: 2, featureCode: "commercial_intelligence.external" });
    await recordAiServiceUsage({
      provider: "pinecone",
      metric: "context_tokens",
      units: 450_000,
      featureCode: "commercial_intelligence.account_chat.library",
    });
    await recordAiServiceUsage({ provider: "pinecone", metric: "ingestion_units", units: 0, featureCode: "documentacion_rag.ingestion" });
    await recordAiServiceError({ provider: "tavily", featureCode: "prospect_research.external", statusCode: 429, message: "rate limit" });

    const overview = await getAiServicesOverview();
    expect(overview.statuses.tavily.measuredCredits).toBe(6);
    const context = overview.statuses.pinecone.metrics.find((metric) => metric.code === "context_tokens");
    expect(context).toMatchObject({ used: 450_000, limit: 500_000, percent: 90, level: "warning" });
    expect(overview.modulesUsage.prospect.tavilyCredits).toBe(4);
    expect(overview.modulesUsage.customer_account).toMatchObject({ tavilyCredits: 2, pineconeTokens: 450_000 });
    expect(overview.readiness.errors).toEqual([]);
    expect(overview.tariffModels.openai).toEqual(expect.arrayContaining(Object.values(models)));
    const alert = overview.alerts.find((item) => item.provider === "pinecone" && item.metric === "context_tokens");
    expect(alert).toMatchObject({ level: "warning" });
    expect(alert.message).toContain("Búsqueda de contexto");

    const again = await listAiServiceAlerts();
    expect(again.filter((item) => item.metric === "context_tokens")).toHaveLength(1);
    await acknowledgeAiServiceAlert({ alertId: alert.id, actorUserId: null });
    const afterAck = await listAiServiceAlerts();
    expect(afterAck.find((item) => item.id === alert.id)).toBeUndefined();
    await expect(acknowledgeAiServiceAlert({ alertId: alert.id, actorUserId: null })).rejects.toMatchObject({ status: 404 });

    const usage = await getAiServicesUsage({});
    expect(usage.days.reduce((sum, day) => sum + day.tavilyCredits, 0)).toBe(6);
    expect(usage.modules.find((module) => module.module === "customer_account")).toMatchObject({
      label: "Cliente existente",
      pineconeTokens: 450_000,
    });
    expect(usage.errors[0]).toMatchObject({ provider: "tavily", statusCode: 429, moduleLabel: "Cuenta nueva" });
  });

  it("limits each active user to their share of the captured balance and the rest to the reserve", async () => {
    const activeUsers = await query("SELECT id FROM users WHERE status = 'active' ORDER BY id LIMIT 2");
    expect(activeUsers.length).toBe(2);
    const [allocated, reserveUser] = activeUsers.map((row) => Number(row.id));

    const current = await loadAiServiceSettings();
    const withBalance = settingsWith();
    withBalance.providers.openai = { ...withBalance.providers.openai, balanceUsd: 10, recaptureBalance: true };
    await saveAiServiceSettings({ settings: withBalance, expectedVersion: current.version, actorUserId: null });

    const before = await listUserAllocations();
    await expect(
      saveAllocationPlan({
        users: [{ userId: allocated, percent: 70 }, { userId: reserveUser, percent: 40 }],
        warningPercent: 80,
        expectedVersion: before.plan.version,
        actorUserId: null,
      }),
    ).rejects.toMatchObject({ status: 422, code: "AI_ALLOCATION_OVER_100" });
    const plan = await saveAllocationPlan({
      users: [{ userId: allocated, percent: 99.5 }, { userId: reserveUser, percent: null }],
      warningPercent: 75,
      expectedVersion: before.plan.version,
      actorUserId: null,
    });
    expect(plan.users).toEqual({ [allocated]: 99.5 });
    await expect(
      saveAllocationPlan({ users: [], warningPercent: 75, expectedVersion: before.plan.version, actorUserId: null }),
    ).rejects.toMatchObject({ status: 409 });

    const listed = await listUserAllocations();
    expect(listed).toMatchObject({ limited: true, capturedUsd: 10, totals: { assignedPercent: 99.5, reservePercent: 0.5 } });
    expect(listed.users.find((user) => user.userId === allocated)).toMatchObject({ percent: 99.5, source: "allocation" });

    await expect(assertAiBudgetAvailable({ userId: reserveUser })).resolves.toBeUndefined();
    await recordAiUsageFromOpenAiResponse({
      userId: reserveUser,
      featureCode: "interactions.analysis",
      model: models.fast,
      openAiResponse: { usage: { input_tokens: 30_000, output_tokens: 0 } },
    });
    await expect(assertAiBudgetAvailable({ userId: reserveUser })).rejects.toMatchObject({
      status: 402,
      code: "AI_BUDGET_EXCEEDED",
      message: expect.stringContaining("reserva compartida"),
    });
    await expect(assertAiBudgetAvailable({ userId: allocated })).resolves.toBeUndefined();
    const summary = await getAiCreditSummaryByUserId(allocated);
    expect(summary).toMatchObject({ limited: true, source: "allocation", percent: 99.5, warningPercent: 75 });
    expect(summary.allocatedUsd).toBeCloseTo(9.95);
  });

  it("does not limit users while no balance is captured", async () => {
    const current = await loadAiServiceSettings();
    const cleared = settingsWith();
    cleared.providers.openai = { ...cleared.providers.openai, balanceUsd: null };
    await saveAiServiceSettings({ settings: cleared, expectedVersion: current.version, actorUserId: null });
    const [user] = await query("SELECT id FROM users WHERE status = 'active' ORDER BY id LIMIT 1");
    await expect(assertAiBudgetAvailable({ userId: Number(user.id) })).resolves.toBeUndefined();
    await expect(getAiCreditSummaryByUserId(Number(user.id))).resolves.toEqual({ userId: Number(user.id), limited: false });
    const listed = await listUserAllocations();
    expect(listed).toMatchObject({ limited: false, totals: null });
  });
});
