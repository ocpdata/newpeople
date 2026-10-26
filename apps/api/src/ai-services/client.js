// Single entry point for calls to AI model providers: resolves the module's provider, applies the monthly
// limit and records failed calls for monitoring. Callers keep their own request bodies and response handling.
import { aiConnectionFor, aiProviderFor, getAiServiceSettings } from "./state.js";

function recordFailure(details) {
  import("./store.js")
    .then(({ recordAiServiceError }) => recordAiServiceError(details))
    .catch(() => {});
}

export async function aiFetch(featureCode, path, { method = "POST", headers = {}, body, signal, userId = null } = {}) {
  const provider = aiProviderFor(featureCode);
  const connection = aiConnectionFor(provider);
  // The store is loaded only when a stopping limit applies, so calls stay free of database work otherwise.
  if (getAiServiceSettings().providers[provider]?.onLimit === "stop") {
    const { assertAiProviderWithinLimit } = await import("./store.js");
    await assertAiProviderWithinLimit(provider);
  }
  const url = `${connection.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${connection.apiKey}`, ...headers },
      body,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error?.name !== "AbortError") {
      recordFailure({ provider, featureCode, errorCode: error?.code || error?.name, message: error?.message, userId });
    }
    throw error;
  }
  if (response && !response.ok) {
    const copy = typeof response.clone === "function" ? response.clone() : null;
    Promise.resolve()
      .then(() => (copy ? copy.text() : ""))
      .catch(() => "")
      .then((text) => recordFailure({ provider, featureCode, statusCode: response.status, message: text, userId }));
  }
  return response;
}
