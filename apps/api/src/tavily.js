import { config } from "./config.js";
import { tavilyCreditsForDepth } from "./ai-services/catalog.js";
import { getAiServiceSettings, isAiServiceEnabledFor } from "./ai-services/state.js";

const SEARCH_DEPTH = "advanced";

function recordTavily(action, details) {
  import("./ai-services/store.js")
    .then((store) => store[action](details))
    .catch(() => {});
}

function clip(value, max = 4000) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

export function normalizeTavilyResults(results = []) {
  const seen = new Set();
  return results
    .map((result) => ({
      title: clip(result?.title, 300),
      url: clip(result?.url, 500),
      content: clip(result?.content, 4000),
      score: Number(result?.score || 0),
      publishedAt: result?.published_date || result?.publishedAt || null,
    }))
    .filter((result) => result.url && result.content)
    .filter((result) => {
      const key = result.url.toLowerCase().replace(/[?#].*$/, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export async function searchTavily({
  query,
  maxResults = config.tavily.maxResults,
  featureCode = "unspecified",
  userId = null,
}) {
  if (!config.tavily.apiKey || !config.tavily.enableSearch) {
    return { enabled: false, results: [], warnings: ["Tavily no esta habilitado o no tiene API key configurada."] };
  }
  if (!isAiServiceEnabledFor("tavily", featureCode)) {
    return { enabled: false, results: [], warnings: ["La búsqueda web está desactivada para este módulo en Configuración > Crédito IA."] };
  }
  if (getAiServiceSettings().providers.tavily.onLimit === "stop") {
    try {
      const { isAiProviderWithinLimit } = await import("./ai-services/store.js");
      if (!(await isAiProviderWithinLimit("tavily"))) {
        return { enabled: true, results: [], warnings: ["Se alcanzó el límite mensual de Tavily configurado en Configuración > Crédito IA."] };
      }
    } catch (error) {
      console.error("[tavily] No fue posible revisar el límite mensual", error?.message || error);
    }
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.tavily.timeoutMs);
  try {
    const response = await fetch(`${config.tavily.baseUrl.replace(/\/$/, "")}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.tavily.apiKey}` },
      body: JSON.stringify({ query: String(query || "").trim(), topic: "general", search_depth: SEARCH_DEPTH, max_results: maxResults, include_answer: false, include_raw_content: false, include_usage: true }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const failure = new Error(`Tavily search failed: ${response.status}`);
      failure.statusCode = response.status;
      throw failure;
    }
    const data = await response.json();
    const reportedCredits = Number(data?.usage?.credits);
    recordTavily("recordAiServiceUsage", {
      provider: "tavily",
      metric: "credits",
      units: Number.isFinite(reportedCredits) && reportedCredits >= 0 ? reportedCredits : tavilyCreditsForDepth(SEARCH_DEPTH),
      userId,
      featureCode,
    });
    return { enabled: true, results: normalizeTavilyResults(data?.results), warnings: [] };
  } catch (error) {
    recordTavily("recordAiServiceError", {
      provider: "tavily",
      featureCode,
      statusCode: error?.statusCode ?? null,
      errorCode: error?.name === "AbortError" ? "TIMEOUT" : error?.code || null,
      message: error?.name === "AbortError" ? "Tavily no respondió a tiempo" : error?.message,
      userId,
    });
    return { enabled: true, results: [], warnings: [clip(error?.message || "No fue posible consultar Tavily", 500)] };
  } finally {
    clearTimeout(timeoutId);
  }
}