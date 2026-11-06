import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("reference exchange rates", () => {
  it("retains the publication date and caches the result for six hours", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ date: "2026-11-05", rates: { MXN: 20.25 } }),
    });
    vi.stubGlobal("fetch", fetch);
    const { getExchangeRate } = await import("../src/exchange-rates.js");
    const rate = await getExchangeRate({ baseCurrency: "USD", targetCurrency: "MXN" });
    expect(rate).toMatchObject({ baseCurrency: "USD", targetCurrency: "MXN", exchangeRate: 20.25, rateDate: "2026-11-05", provider: "frankfurter" });
    expect(await getExchangeRate({ baseCurrency: "USD", targetCurrency: "MXN" })).toEqual(rate);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain("latest?from=USD&to=MXN");
    vi.advanceTimersByTime(6 * 60 * 60 * 1000 - 1);
    await getExchangeRate({ baseCurrency: "USD", targetCurrency: "MXN" });
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await getExchangeRate({ baseCurrency: "USD", targetCurrency: "MXN" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not invent a publication date and reports provider failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true, json: async () => ({ rates: { MXN: 20 } }),
    }).mockResolvedValueOnce({ ok: false, status: 503, text: async () => "unavailable" }));
    const { getExchangeRate } = await import("../src/exchange-rates.js");
    expect((await getExchangeRate({ baseCurrency: "USD", targetCurrency: "MXN" })).rateDate).toBeNull();
    await expect(getExchangeRate({ baseCurrency: "USD", targetCurrency: "EUR" })).rejects.toThrow("503");
  });
});
