import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Customer turn contract environment defaults", () => {
  it.each(["development", "test", "production"])(
    "enables the contract by default in %s",
    async (environment) => {
      vi.stubEnv("NODE_ENV", environment);
      vi.stubEnv("API_ENV", "test");
      vi.stubEnv("CUSTOMER_TURN_CONTRACT_MODE", "");
      vi.resetModules();
      const { config } = await import("../src/config.js");
      expect(config.features.customerTurnContractMode).toBe("on");
    },
  );

  it.each(["off", "pilot"])("preserves an explicit %s override", async (mode) => {
    vi.stubEnv("API_ENV", "test");
    vi.stubEnv("CUSTOMER_TURN_CONTRACT_MODE", mode);
    vi.resetModules();
    const { config } = await import("../src/config.js");
    expect(config.features.customerTurnContractMode).toBe(mode);
  });
});
