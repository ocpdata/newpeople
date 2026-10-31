import { config } from "./config.js";

const MAX_KEY_LENGTH = 64;
const RETENTIONS = new Set(["24h", "in_memory"]);

function isOpenAiHost(baseUrl) {
  try {
    return new URL(baseUrl).hostname === "api.openai.com";
  } catch {
    return false;
  }
}

// OpenAI routes requests to a cache by prefix; without a key, identical long prompts rarely hit it
// (measured 9% on the existing-customer chat). Only sent to OpenAI itself: other providers may reject it.
export function promptCacheFields({
  featureCode,
  baseUrl = config.openai.baseUrl,
  enabled = config.openai.promptCacheKeyEnabled,
  retention = config.openai.promptCacheRetention,
} = {}) {
  const code = String(featureCode || "").trim();
  if (!enabled || !code || !isOpenAiHost(baseUrl)) return {};
  return {
    prompt_cache_key: `np:${code}`.slice(0, MAX_KEY_LENGTH),
    ...(RETENTIONS.has(retention) ? { prompt_cache_retention: retention } : {}),
  };
}
