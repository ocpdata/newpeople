// In-memory AI services settings and pure resolvers. No database access, so any module can import it.
import { config } from "../config.js";
import {
  AI_LLM_PROVIDERS,
  AI_MODEL_ROLES,
  AI_MODULES,
  PINECONE_PLANS,
  aiModuleCodeForFeature,
  getAiModule,
} from "./catalog.js";

const ROLE_CODES = AI_MODEL_ROLES.map((role) => role.code);
const LLM_PROVIDER_CODES = AI_LLM_PROVIDERS.map((provider) => provider.code);
const ON_LIMIT_VALUES = ["warn", "stop"];

let cachedSettings = null;

function clean(value) {
  return String(value ?? "").trim();
}

function percentOr(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 99 ? number : fallback;
}

function positiveOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nonNegativeOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

// The provider balance is captured by an administrator; the capture time anchors the estimate.
function normalizeBalance(source) {
  const balanceUsd = nonNegativeOrNull(source.balanceUsd);
  const capturedAt = source.balanceCapturedAt ? new Date(source.balanceCapturedAt) : null;
  const validCapture = balanceUsd !== null && capturedAt && !Number.isNaN(capturedAt.getTime());
  return {
    balanceUsd: validCapture ? balanceUsd : null,
    balanceCapturedAt: validCapture ? capturedAt.toISOString() : null,
    balanceWarningUsd: nonNegativeOrNull(source.balanceWarningUsd),
  };
}

// Defaults reproduce the behavior configured through .env before these settings existed.
export function buildDefaultAiServiceSettings() {
  const openai = config.openai || {};
  const advanced = clean(openai.analystModel) || clean(openai.routerModel) || clean(openai.model);
  return {
    version: 0,
    providers: {
      openai: {
        models: {
          fast: clean(openai.model) || "gpt-4.1-mini",
          advanced: advanced || "gpt-4.1-mini",
          transcription: clean(openai.transcriptionModel) || "gpt-4o-mini-transcribe",
        },
        monthlyLimitUsd: null,
        warningPercent: 80,
        onLimit: "warn",
        balanceUsd: null,
        balanceCapturedAt: null,
        balanceWarningUsd: null,
      },
      tavily: { monthlyLimitCredits: null, usdPerCredit: null, warningPercent: 80, onLimit: "warn" },
      pinecone: { plan: "starter", warningPercent: 80 },
    },
    modules: Object.fromEntries(
      AI_MODULES.map((module) => [
        module.code,
        {
          llmProvider: "openai",
          tavily: Boolean(module.usesTavily),
          pinecone: Boolean(module.usesPinecone),
          modelOverrides: {},
        },
      ]),
    ),
  };
}

// Merges stored settings over defaults so new modules or fields keep working with older stored rows.
export function normalizeAiServiceSettings(raw) {
  const defaults = buildDefaultAiServiceSettings();
  const source = raw && typeof raw === "object" ? raw : {};
  const providers = source.providers || {};
  const openaiSource = providers.openai || {};
  const openaiModels = openaiSource.models || {};
  const tavilySource = providers.tavily || {};
  const pineconeSource = providers.pinecone || {};

  const settings = {
    version: Number.isInteger(Number(source.version)) ? Number(source.version) : 0,
    providers: {
      openai: {
        models: Object.fromEntries(
          ROLE_CODES.map((role) => [role, clean(openaiModels[role]) || defaults.providers.openai.models[role]]),
        ),
        monthlyLimitUsd: positiveOrNull(openaiSource.monthlyLimitUsd),
        warningPercent: percentOr(openaiSource.warningPercent, 80),
        onLimit: ON_LIMIT_VALUES.includes(openaiSource.onLimit) ? openaiSource.onLimit : "warn",
        ...normalizeBalance(openaiSource),
      },
      tavily: {
        monthlyLimitCredits: positiveOrNull(tavilySource.monthlyLimitCredits),
        usdPerCredit: nonNegativeOrNull(tavilySource.usdPerCredit),
        warningPercent: percentOr(tavilySource.warningPercent, 80),
        onLimit: ON_LIMIT_VALUES.includes(tavilySource.onLimit) ? tavilySource.onLimit : "warn",
      },
      pinecone: {
        plan: PINECONE_PLANS[pineconeSource.plan] ? pineconeSource.plan : "starter",
        warningPercent: percentOr(pineconeSource.warningPercent, 80),
      },
    },
    modules: {},
  };

  const sourceModules = source.modules || {};
  for (const module of AI_MODULES) {
    const stored = sourceModules[module.code] || {};
    const fallback = defaults.modules[module.code];
    const overrides = stored.modelOverrides && typeof stored.modelOverrides === "object" ? stored.modelOverrides : {};
    settings.modules[module.code] = {
      llmProvider: LLM_PROVIDER_CODES.includes(stored.llmProvider) ? stored.llmProvider : fallback.llmProvider,
      tavily: module.usesTavily ? (typeof stored.tavily === "boolean" ? stored.tavily : fallback.tavily) : false,
      pinecone: module.pineconeRequired
        ? true
        : module.usesPinecone
          ? (typeof stored.pinecone === "boolean" ? stored.pinecone : fallback.pinecone)
          : false,
      modelOverrides: Object.fromEntries(
        ROLE_CODES.map((role) => [role, clean(overrides[role])]).filter(([, model]) => model),
      ),
    };
  }
  return settings;
}

export function getAiServiceSettings() {
  return cachedSettings || normalizeAiServiceSettings(null);
}

export function setAiServiceSettingsCache(settings) {
  cachedSettings = settings ? normalizeAiServiceSettings(settings) : null;
}

export function aiModuleFor(featureCode) {
  return aiModuleCodeForFeature(featureCode);
}

export function aiProviderFor(featureCode) {
  const settings = getAiServiceSettings();
  return settings.modules[aiModuleFor(featureCode)]?.llmProvider || "openai";
}

// Model for a feature and kind of work: module override first, then the provider's model for that role.
export function aiModelFor(featureCode, role = "fast") {
  const safeRole = ROLE_CODES.includes(role) ? role : "fast";
  const settings = getAiServiceSettings();
  const moduleSettings = settings.modules[aiModuleFor(featureCode)] || {};
  const override = clean(moduleSettings.modelOverrides?.[safeRole]);
  if (override) return override;
  const provider = moduleSettings.llmProvider || "openai";
  return clean(settings.providers[provider]?.models?.[safeRole]);
}

export function aiConnectionFor(provider = "openai") {
  if (provider !== "openai") {
    const error = new Error(`El proveedor de IA ${provider} no está conectado`);
    error.status = 503;
    error.code = "AI_PROVIDER_NOT_CONNECTED";
    throw error;
  }
  return {
    provider,
    baseUrl: clean(config.openai?.baseUrl || "https://api.openai.com/v1").replace(/\/$/, ""),
    apiKey: clean(config.openai?.apiKey),
  };
}

// Whether a module may use Tavily or Pinecone; features outside known modules keep the previous behavior.
export function isAiServiceEnabledFor(service, featureCode) {
  const moduleCode = aiModuleFor(featureCode);
  const module = getAiModule(moduleCode);
  const moduleSettings = getAiServiceSettings().modules[moduleCode];
  if (!module || !moduleSettings) return true;
  if (service === "tavily") return module.usesTavily ? moduleSettings.tavily !== false : true;
  if (service === "pinecone") return module.usesPinecone ? moduleSettings.pinecone !== false : true;
  return true;
}
