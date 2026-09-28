import { config } from "./config.js";

const RATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const rateCache = new Map();
const pendingRates = new Map();

export async function getExchangeRate({ baseCurrency, targetCurrency }) {
  const normalizedBaseCurrency = String(baseCurrency || "")
    .trim()
    .toUpperCase();
  const normalizedTargetCurrency = String(targetCurrency || "")
    .trim()
    .toUpperCase();

  if (!/^[A-Z]{3}$/.test(normalizedBaseCurrency)) {
    throw new Error("Moneda base invalida");
  }
  if (!/^[A-Z]{3}$/.test(normalizedTargetCurrency)) {
    throw new Error("Moneda objetivo invalida");
  }

  if (normalizedBaseCurrency === normalizedTargetCurrency) {
    return {
      baseCurrency: normalizedBaseCurrency,
      targetCurrency: normalizedTargetCurrency,
      exchangeRate: 1,
      provider: "frankfurter",
      fetchedAt: new Date().toISOString(),
    };
  }

  const cacheKey = `${normalizedBaseCurrency}:${normalizedTargetCurrency}`;
  const cached = rateCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < RATE_CACHE_TTL_MS) {
    return cached.rate;
  }

  if (pendingRates.has(cacheKey)) return pendingRates.get(cacheKey);

  const pendingRate = fetchRate({
    baseCurrency: normalizedBaseCurrency,
    targetCurrency: normalizedTargetCurrency,
  })
    .then((rate) => {
      rateCache.set(cacheKey, { rate, cachedAt: Date.now() });
      return rate;
    })
    .finally(() => pendingRates.delete(cacheKey));
  pendingRates.set(cacheKey, pendingRate);
  return pendingRate;
}

async function fetchRate({ baseCurrency, targetCurrency }) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    config.exchangeRates.timeoutMs,
  );

  try {
    const query = new URLSearchParams({
      from: baseCurrency,
      to: targetCurrency,
    });
    const url = `${config.exchangeRates.frankfurterBaseUrl.replace(/\/$/, "")}/latest?${query}`;
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Frankfurter request failed: ${response.status} ${errorText}`.trim(),
      );
    }

    const payload = await response.json();
    const exchangeRate = Number(payload?.rates?.[targetCurrency]);
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      throw new Error(
        "Frankfurter request failed: invalid exchange rate payload",
      );
    }

    return {
      baseCurrency,
      targetCurrency,
      exchangeRate,
      provider: "frankfurter",
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}
