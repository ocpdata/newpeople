import { config } from "./config.js";

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

export async function searchTavily({ query, maxResults = config.tavily.maxResults }) {
  if (!config.tavily.apiKey || !config.tavily.enableSearch) {
    return { enabled: false, results: [], warnings: ["Tavily no esta habilitado o no tiene API key configurada."] };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.tavily.timeoutMs);
  try {
    const response = await fetch(`${config.tavily.baseUrl.replace(/\/$/, "")}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.tavily.apiKey}` },
      body: JSON.stringify({ query: String(query || "").trim(), topic: "general", search_depth: "advanced", max_results: maxResults, include_answer: false, include_raw_content: false }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Tavily search failed: ${response.status}`);
    const data = await response.json();
    return { enabled: true, results: normalizeTavilyResults(data?.results), warnings: [] };
  } catch (error) {
    return { enabled: true, results: [], warnings: [clip(error?.message || "No fue posible consultar Tavily", 500)] };
  } finally {
    clearTimeout(timeoutId);
  }
}