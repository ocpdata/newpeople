import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { config } = vi.hoisted(() => ({
  config: {
    app: { businessTimezone: "America/Mexico_City" },
    openai: {
      apiKey: "sk-test",
      baseUrl: "https://gateway.test/v1/",
      model: "gpt-4.1-mini",
      routerModel: "gpt-6.1-sol",
      analystModel: "gpt-6.1-sol",
      transcriptionModel: "gpt-4o-mini-transcribe",
    },
    tavily: {
      apiKey: "tvly-test",
      baseUrl: "https://api.tavily.test",
      enableSearch: true,
      timeoutMs: 1000,
      maxResults: 5,
    },
    pinecone: { apiKey: "pc-test" },
  },
}));

vi.mock("../src/config.js", () => ({ config }));

import { aiModuleCodeForFeature } from "../src/ai-services/catalog.js";
import {
  aiModelFor,
  aiProviderFor,
  getAiServiceSettings,
  isAiServiceEnabledFor,
  normalizeAiServiceSettings,
  setAiServiceSettingsCache,
} from "../src/ai-services/state.js";
import {
  alertCandidates,
  computeProviderStatuses,
  computeUserAllocations,
  estimateProviderBalance,
  isBalanceMetric,
  monthStartFor,
  normalizeAllocationPlan,
  periodKeyFor,
  validateAiServiceSettings,
} from "../src/ai-services/status.js";
import { aiFetch } from "../src/ai-services/client.js";
import { searchTavily } from "../src/tavily.js";

afterEach(() => {
  setAiServiceSettingsCache(null);
  vi.unstubAllGlobals();
});

describe("AI services catalog", () => {
  it("attributes each feature code to its module", () => {
    expect(aiModuleCodeForFeature("mi_coach")).toBe("mi_coach");
    expect(aiModuleCodeForFeature("mi_agent.analysis")).toBe("mi_coach");
    expect(aiModuleCodeForFeature("commercial_intelligence.account_chat.dossier_router")).toBe("customer_account");
    expect(aiModuleCodeForFeature("customer_chat.acceptance_judge")).toBe("customer_account");
    expect(aiModuleCodeForFeature("prospect_research.external")).toBe("prospect");
    expect(aiModuleCodeForFeature("quotation_processing_kickoff_ai_summary")).toBe("quotations");
    expect(aiModuleCodeForFeature("quotations.documents.provider_import_preview")).toBe("quotations");
    expect(aiModuleCodeForFeature("proposals_email_suggestion")).toBe("proposals");
    expect(aiModuleCodeForFeature("proposal_documents_section_ai")).toBe("proposals");
    expect(aiModuleCodeForFeature("proposals.exec_summary")).toBe("proposals");
    expect(aiModuleCodeForFeature("commercial_email_attachment_suggestions")).toBe("commercial_development");
    expect(aiModuleCodeForFeature("contacts.duplicate_review")).toBe("accounts_contacts");
    expect(aiModuleCodeForFeature("documentacion_rag.summary")).toBe("documentation_rag");
    expect(aiModuleCodeForFeature("chatbot.assistant")).toBe("chatbot");
    expect(aiModuleCodeForFeature("accountsxyz")).toBe("other");
    expect(aiModuleCodeForFeature("")).toBe("other");
  });
});

describe("AI services settings", () => {
  it("reproduces the .env models when nothing is stored", () => {
    const settings = getAiServiceSettings();
    expect(settings.version).toBe(0);
    expect(settings.providers.openai.models).toEqual({
      fast: "gpt-4.1-mini",
      advanced: "gpt-6.1-sol",
      transcription: "gpt-4o-mini-transcribe",
    });
    expect(aiModelFor("interactions.analysis")).toBe("gpt-4.1-mini");
    expect(aiModelFor("commercial_intelligence.account_chat.dossier_router", "advanced")).toBe("gpt-6.1-sol");
    expect(aiModelFor("opportunities.documents.transcription", "transcription")).toBe("gpt-4o-mini-transcribe");
    expect(aiProviderFor("proposals.exec_summary")).toBe("openai");
    expect(settings.modules.customer_account).toMatchObject({ tavily: true, pinecone: true });
    expect(settings.modules.documentation_rag.pinecone).toBe(true);
  });

  it("applies provider models and module overrides from stored settings", () => {
    setAiServiceSettingsCache({
      version: 3,
      providers: { openai: { models: { fast: "gpt-5-mini", advanced: "gpt-6.1-sol", transcription: "whisper-1" } } },
      modules: { proposals: { llmProvider: "openai", modelOverrides: { advanced: "gpt-6-astra" } } },
    });
    expect(aiModelFor("proposals.exec_summary", "fast")).toBe("gpt-5-mini");
    expect(aiModelFor("proposals.exec_summary", "advanced")).toBe("gpt-6-astra");
    expect(aiModelFor("interactions.analysis", "advanced")).toBe("gpt-6.1-sol");
    expect(aiModelFor("interactions.analysis", "unknown-role")).toBe("gpt-5-mini");
  });

  it("normalizes invalid values to safe defaults and keeps the required library", () => {
    const settings = normalizeAiServiceSettings({
      providers: {
        openai: { monthlyLimitUsd: -5, warningPercent: 150, onLimit: "explode" },
        pinecone: { plan: "imaginary" },
      },
      modules: {
        documentation_rag: { pinecone: false },
        mi_coach: { llmProvider: "unknown", tavily: true },
      },
    });
    expect(settings.providers.openai).toMatchObject({ monthlyLimitUsd: null, warningPercent: 80, onLimit: "warn" });
    expect(settings.providers.pinecone.plan).toBe("starter");
    expect(settings.modules.documentation_rag.pinecone).toBe(true);
    expect(settings.modules.mi_coach).toMatchObject({ llmProvider: "openai", tavily: false });
  });

  it("disables Tavily or Pinecone only for the module that turned them off", () => {
    setAiServiceSettingsCache({
      modules: {
        customer_account: { llmProvider: "openai", tavily: false, pinecone: false },
      },
    });
    expect(isAiServiceEnabledFor("tavily", "commercial_intelligence.external")).toBe(false);
    expect(isAiServiceEnabledFor("pinecone", "commercial_intelligence.account_chat.library")).toBe(false);
    expect(isAiServiceEnabledFor("tavily", "prospect_research.external")).toBe(true);
    expect(isAiServiceEnabledFor("pinecone", "chatbot.assistant")).toBe(true);
  });
});

describe("AI services status", () => {
  it("computes the business month start and period key", () => {
    const now = new Date("2026-10-26T20:00:00.000Z");
    expect(monthStartFor(now, "America/Mexico_City").toISOString()).toBe("2026-10-01T06:00:00.000Z");
    expect(periodKeyFor(new Date("2026-11-01T03:00:00.000Z"), "America/Mexico_City")).toBe("2026-10");
  });

  it("reports levels per provider and Pinecone quotas", () => {
    const settings = normalizeAiServiceSettings({
      providers: {
        openai: { monthlyLimitUsd: 100, warningPercent: 80, onLimit: "stop" },
        tavily: { warningPercent: 80 },
        pinecone: { plan: "starter", warningPercent: 80 },
      },
    });
    const statuses = computeProviderStatuses({
      settings,
      usage: {
        openai: { costUsd: 85, calls: 10, byModel: [] },
        tavily: { credits: 40, calls: 20 },
        pinecone: { chat_input_tokens: 425_000, chat_output_tokens: 90_000, context_tokens: 510_000, ingestion_units: 300 },
      },
      remoteTavily: { plan: "Bootstrap", planUsage: 340, planLimit: 15_000, fetchedAt: "2026-10-26T19:00:00.000Z" },
      connections: { openai: true, tavily: true, pinecone: true },
    });
    expect(statuses.openai).toMatchObject({ level: "warning", costUsd: 85 });
    expect(statuses.openai.metrics[0]).toMatchObject({ percent: 85, level: "warning" });
    expect(statuses.tavily.metrics[0]).toMatchObject({ used: 340, limit: 15_000, source: "provider", level: "normal" });
    expect(statuses.tavily.usdPerCredit).toBe(0.0067);
    expect(statuses.tavily.costUsd).toBeCloseTo(340 * 0.0067);
    const pinecone = Object.fromEntries(statuses.pinecone.metrics.map((metric) => [metric.code, metric]));
    expect(pinecone.chat_input_tokens).toMatchObject({ limit: 500_000, percent: 85, level: "warning" });
    expect(pinecone.context_tokens.level).toBe("limit");
    expect(statuses.pinecone).toMatchObject({ level: "limit", costUsd: 0, blocksAtLimit: true });
    expect(alertCandidates(statuses).map((alert) => `${alert.provider}:${alert.metric}:${alert.level}`)).toEqual([
      "openai:cost_usd:warning",
      "pinecone:chat_input_tokens:warning",
      "pinecone:context_tokens:limit",
    ]);
  });

  it("estimates the OpenAI balance from the captured amount minus CRM-measured spend", () => {
    const settings = normalizeAiServiceSettings({
      providers: {
        openai: { balanceUsd: 9.06, balanceCapturedAt: "2026-10-26T21:40:00.000Z", balanceWarningUsd: 5 },
      },
    });
    expect(estimateProviderBalance(settings.providers.openai, 3.5)).toMatchObject({
      capturedUsd: 9.06, spentSinceUsd: 3.5, estimatedUsd: 5.56, level: "normal",
    });
    expect(estimateProviderBalance(settings.providers.openai, 4.1).level).toBe("warning");
    expect(estimateProviderBalance(settings.providers.openai, 9.06).level).toBe("limit");
    expect(estimateProviderBalance(normalizeAiServiceSettings(null).providers.openai, 1)).toBeNull();
    expect(normalizeAiServiceSettings({ providers: { openai: { balanceUsd: 4 } } }).providers.openai)
      .toMatchObject({ balanceUsd: null, balanceCapturedAt: null });

    const statuses = computeProviderStatuses({
      settings,
      usage: { openai: { costUsd: 52.46, calls: 10, byModel: [], spentSinceBalanceUsd: 4.5 } },
    });
    expect(statuses.openai.balance).toMatchObject({ estimatedUsd: 4.56, level: "warning" });
    expect(statuses.openai.level).toBe("warning");
    const balanceAlert = alertCandidates(statuses).find((alert) => isBalanceMetric(alert.metric));
    expect(balanceAlert).toMatchObject({ provider: "openai", level: "warning" });
    expect(balanceAlert.metric.length).toBeLessThanOrEqual(40);
  });

  it("falls back to CRM-measured credits and configured price for Tavily", () => {
    const settings = normalizeAiServiceSettings({
      providers: { tavily: { monthlyLimitCredits: 50, usdPerCredit: 0.01, warningPercent: 80 } },
    });
    const statuses = computeProviderStatuses({
      settings,
      usage: { tavily: { credits: 45, calls: 30 } },
      remoteTavily: { error: "Tavily respondió 401", fetchedAt: "2026-10-26T19:00:00.000Z" },
    });
    expect(statuses.tavily.metrics[0]).toMatchObject({ used: 45, limit: 50, source: "measured", level: "warning" });
    expect(statuses.tavily).toMatchObject({ usdPerCredit: 0.01, priceSource: "configured" });
  });

  it("rejects models without an active tariff and flags affected modules", () => {
    const settings = normalizeAiServiceSettings({
      modules: { quotations: { llmProvider: "openai", modelOverrides: { fast: "gpt-x" } } },
    });
    const result = validateAiServiceSettings(settings, {
      activeRates: { openai: new Set(["gpt-4.1-mini", "gpt-4o-mini-transcribe"]) },
      connections: { openai: true },
    });
    expect(result.errors).toEqual([
      "Cotizaciones: Falta tarifa vigente para gpt-x (Rápido).",
      "OpenAI: Falta tarifa vigente para gpt-6.1-sol (Avanzado).",
    ]);
    expect(result.moduleIssues.customer_account).toEqual(["Falta tarifa vigente para gpt-6.1-sol (Avanzado)."]);
    expect(result.moduleIssues.documentation_rag).toBeUndefined();
    const ready = validateAiServiceSettings(normalizeAiServiceSettings(null), {
      activeRates: { openai: new Set(["gpt-4.1-mini", "gpt-6.1-sol", "gpt-4o-mini-transcribe"]) },
      connections: { openai: true },
    });
    expect(ready.errors).toEqual([]);
  });
});

describe("Per-user allocations", () => {
  const plan = normalizeAllocationPlan({ warningPercent: 80, users: { 1: 40, 2: 30, 3: 20, 9: 50 } });
  const activeUserIds = new Set([1, 2, 3, 4, 5]);

  it("gives each active user a share of the captured balance and keeps the rest as a shared reserve", () => {
    const result = computeUserAllocations({
      capturedUsd: 9.06,
      plan,
      activeUserIds,
      spentByUser: new Map([[1, 1.1], [3, 1.9], [4, 0.5], [5, 0.2], [9, 0.1]]),
    });
    expect(result).toMatchObject({ assignedPercent: 90, reservePercent: 10 });
    expect(result.reserveUsd).toBeCloseTo(0.906);
    expect(result.reserveSpentUsd).toBeCloseTo(0.8);
    expect(result.forUser(1)).toMatchObject({ source: "allocation", percent: 40, state: "normal" });
    expect(result.forUser(1).availableUsd).toBeCloseTo(3.624 - 1.1);
    expect(result.forUser(2).availableUsd).toBeCloseTo(2.718);
    expect(result.forUser(3)).toMatchObject({ state: "exhausted" });
    expect(result.forUser(4)).toMatchObject({ source: "reserve", percent: null, state: "warning" });
    expect(result.forUser(4).availableUsd).toBeCloseTo(0.106);
    expect(result.forUser(9).source).toBe("reserve");
  });

  it("blocks reserve users when every percent is assigned and warns near the allocation", () => {
    const full = normalizeAllocationPlan({ users: { 1: 60, 2: 40 } });
    const result = computeUserAllocations({
      capturedUsd: 10,
      plan: full,
      activeUserIds: new Set([1, 2, 3]),
      spentByUser: new Map([[1, 4.9]]),
    });
    expect(result.reservePercent).toBe(0);
    expect(result.forUser(3)).toMatchObject({ source: "reserve", state: "exhausted" });
    expect(result.forUser(1)).toMatchObject({ consumedPercent: 82, state: "warning" });
  });

  it("drops invalid percentages from the stored plan", () => {
    expect(normalizeAllocationPlan({ warningPercent: 0, users: { 1: 120, 2: -1, x: 5, 3: 33.333 } }, 4)).toEqual({
      version: 4,
      warningPercent: 80,
      users: { 3: 33.33 },
    });
  });
});

describe("AI services client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: "resp_1" }) })));
  });

  it("calls the module provider with the server credentials", async () => {
    const body = JSON.stringify({ model: "gpt-4.1-mini" });
    const response = await aiFetch("interactions.analysis", "/responses", {
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(response.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith("https://gateway.test/v1/responses", {
      method: "POST",
      headers: { Authorization: "Bearer sk-test", "Content-Type": "application/json" },
      body,
    });
  });
});

describe("Tavily search gating", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ title: "Nota", url: "https://example.com", content: "Contenido" }], usage: { credits: 2 } }),
    })));
  });

  it("skips Tavily when the module disabled web search", async () => {
    setAiServiceSettingsCache({ modules: { prospect: { llmProvider: "openai", tavily: false } } });
    const result = await searchTavily({ query: "empresa", featureCode: "prospect_research.external" });
    expect(result.enabled).toBe(false);
    expect(result.warnings[0]).toContain("desactivada para este módulo");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks Tavily for the credits used by the search", async () => {
    const result = await searchTavily({ query: "empresa", featureCode: "prospect_research.external", userId: 7 });
    expect(result.results).toHaveLength(1);
    const [, options] = fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toMatchObject({ search_depth: "advanced", include_usage: true });
  });
});
