import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../src/db.js", () => db);
vi.mock("../src/coach/business-rules.js", async (original) => ({
  ...(await original()),
  ensureRulesSchema: vi.fn(),
  loadCoachBusinessRulesWithSource: vi.fn(),
}));
vi.mock("../src/commercial-intelligence/permissions.js", () => ({
  ensureCommercialIntelligencePermissions: vi.fn(),
}));
vi.mock("../src/commercial-intelligence/schema.js", () => ({
  ensureCommercialIntelligenceSchema: vi.fn(),
}));
vi.mock("../src/audit.js", () => ({ logAuditEvent: vi.fn() }));

import {
  getCoachBusinessRules, loadCoachBusinessRulesWithSource, saveCoachBusinessRules,
} from "../src/coach/business-rules.js";
import {
  getCustomerServerRulesAdmin, invalidateCustomerServerRulesCache,
  loadCustomerEffectiveRules, saveCustomerServerRules,
} from "../src/coach/customer-server-rules.js";
import {
  CUSTOMER_SERVER_RULE_CATEGORIES, serverRulesUpdateSchema,
} from "../src/coach/server-policy.js";
import { logAuditEvent } from "../src/audit.js";
import router from "../src/routes.commercial-intelligence.js";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 31, permissionSet: new Set(req.headers["x-admin"] === "yes" ? ["mi_coach.admin"] : []) };
  next();
});
app.use("/api/commercial-intelligence", router);
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));

let state;
beforeEach(() => {
  vi.clearAllMocks();
  invalidateCustomerServerRulesCache();
  state = {
    version: 0, revisions: [],
    rules: getCoachBusinessRules({
      channel: "customer_account",
      overrides: { filters: { defaultOpenOnly: false }, aliases: { stage: { prueba: "negociacion" } } },
    }),
  };
  db.query.mockImplementation(async (sql, params = []) => {
    if (sql.includes("SELECT version") && sql.includes("mi_coach_server_rule_versions")) {
      return [{ version: state.version }];
    }
    if (sql.includes("SELECT rules_json")) return [{ rules_json: JSON.stringify(state.rules) }];
    if (sql.includes("SELECT version, rules_json")) return [...state.revisions].reverse();
    if (sql.includes("INSERT") && sql.includes("mi_coach_server_rule_revisions")) {
      if (!state.revisions.some((row) => row.version === params[1])) {
        state.revisions.push({ version: params[1], rules_json: params[2], created_by_user_id: params[3] });
      }
    }
    if (sql.includes("INSERT INTO mi_coach_business_rules")) state.rules = JSON.parse(params[1]);
    if (sql.includes("UPDATE mi_coach_server_rule_versions")) state.version = params[0];
    return [];
  });
  let queue = Promise.resolve();
  db.withTransaction.mockImplementation((work) => {
    const result = queue.then(async () => {
      const before = structuredClone(state);
      try {
        return await work({ query: async (sql, params) => [await db.query(sql, params)] });
      } catch (error) {
        state = before;
        throw error;
      }
    });
    queue = result.catch(() => {});
    return result;
  });
  loadCoachBusinessRulesWithSource.mockImplementation(async () => ({
    businessRules: getCoachBusinessRules({ channel: "customer_account", overrides: state.rules }),
  }));
});

describe("Connected customer server rules", () => {
  it("uses existing configuration and exposes all nine categories and pending channels", async () => {
    const result = await getCustomerServerRulesAdmin();
    expect(result.version).toBe(0);
    expect(result.rules.filters.defaultOpenOnly).toBe(false);
    expect(result.categories).toHaveLength(9);
    expect(result.channels.filter((item) => item.connected).map((item) => item.channel)).toEqual(["customer_account"]);
    expect(CUSTOMER_SERVER_RULE_CATEGORIES.flatMap((item) => item.rules).map((rule) => rule.id))
      .toEqual(expect.arrayContaining(["single-operation-target", "user-access", "answer-audit", "execution-access", "plan-target-correspondence", "answer-target-correspondence"]));
    for (const id of ["plan-target-correspondence", "answer-target-correspondence"]) {
      expect(result.categories.flatMap((category) => category.rules)
        .find((rule) => rule.id === id).kind).toBe("protected");
    }
  });

  it("strictly rejects protected fields, unknown keys and unsafe values", () => {
    for (const rules of [
      { validation: { requireEvidence: false } },
      { scope: { requirePermissionValidation: false } },
      { operationPolicy: { allowedKinds: ["create_account"] } },
      { serverPolicy: { multipleTargets: "allow_bulk" } },
      { serverPolicy: { maxReadQueries: 9 } },
      { serverPolicy: { maxEvidenceRounds: 3 } },
      { serverPolicy: { maxTurnMs: 45001 } },
      { serverPolicy: { maxTurnMs: 4999 } },
      { filters: { defaultActiveOnly: true, defaultInactiveOnly: true } },
    ]) {
      expect(serverRulesUpdateSchema.safeParse({ expectedVersion: 0, rules }).success).toBe(false);
    }
  });

  it("saves partial changes, preserves legacy overrides, versions both snapshots and invalidates cache", async () => {
    const before = await loadCustomerEffectiveRules();
    expect(before.serverRulesVersion).toBe(0);
    const saved = await saveCustomerServerRules({
      user: { id: 31 }, expectedVersion: 0,
      rules: { serverPolicy: { maxReadQueries: 3, selectedOpportunityFallback: "require_explicit" } },
    });
    expect(saved.version).toBe(1);
    const after = await loadCustomerEffectiveRules();
    expect(after.serverRulesVersion).toBe(1);
    expect(after.serverPolicy.maxReadQueries).toBe(3);
    expect(after.filters.defaultOpenOnly).toBe(false);
    expect(after.aliases.stage.prueba).toBe("negociacion");
    expect(after.validation.requirePermissionValidation).toBe(true);
    const admin = await getCustomerServerRulesAdmin();
    expect(admin.revisions.map((item) => item.version)).toEqual([1, 0]);
    expect(admin.revisions[1].rules.serverPolicy.maxReadQueries).toBe(8);
    expect(admin.revisions[0].createdByUserId).toBe(31);
  });

  it("restores an earlier revision as a new version without deleting history", async () => {
    await saveCustomerServerRules({ expectedVersion: 0, rules: { serverPolicy: { maxReadQueries: 2 } } });
    const admin = await getCustomerServerRulesAdmin();
    await saveCustomerServerRules({ expectedVersion: 1, rules: admin.revisions.find((item) => item.version === 0).rules });
    const restored = await getCustomerServerRulesAdmin();
    expect(restored.version).toBe(2);
    expect(restored.rules.serverPolicy.maxReadQueries).toBe(8);
    expect(restored.revisions.map((item) => item.version)).toEqual([2, 1, 0]);
  });

  it("rejects a stale or concurrent save without overwriting the winner", async () => {
    const results = await Promise.allSettled([2, 4].map((limit) => saveCustomerServerRules({
      expectedVersion: 0, rules: { serverPolicy: { maxReadQueries: limit } },
    })));
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.find((item) => item.status === "rejected").reason.status).toBe(409);
    expect(state.version).toBe(1);
    expect(state.rules.serverPolicy.maxReadQueries).toBe(2);
  });

  it("caches full rules, detects another process version and keeps per-turn copies immutable", async () => {
    const first = await loadCustomerEffectiveRules();
    first.serverPolicy.maxReadQueries = 1;
    expect((await loadCustomerEffectiveRules()).serverPolicy.maxReadQueries).toBe(8);
    expect(loadCoachBusinessRulesWithSource).toHaveBeenCalledTimes(1);
    state.version = 9;
    state.rules.serverPolicy.maxReadQueries = 5;
    expect((await loadCustomerEffectiveRules()).serverRulesVersion).toBe(9);
    expect((await loadCustomerEffectiveRules()).serverPolicy.maxReadQueries).toBe(5);
    expect(loadCoachBusinessRulesWithSource).toHaveBeenCalledTimes(2);
  });

  it("versions legacy writes in the same store while retaining new policies", async () => {
    await saveCustomerServerRules({ expectedVersion: 0, rules: { serverPolicy: { maxReadQueries: 2 } } });
    await saveCoachBusinessRules({
      channel: "customer_account", rules: { operationPolicy: { allowedKinds: ["activity"] } },
    });
    expect(state.version).toBe(2);
    expect(state.rules.serverPolicy.maxReadQueries).toBe(2);
    expect(state.rules.operationPolicy.allowedKinds).toEqual(["activity"]);
  });

  it("surfaces storage errors instead of returning permissive defaults", async () => {
    db.query.mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(loadCustomerEffectiveRules()).rejects.toThrow("Storage unavailable");
    await saveCustomerServerRules({ expectedVersion: 0, rules: {} });
    invalidateCustomerServerRulesCache();
    loadCoachBusinessRulesWithSource.mockRejectedValueOnce(new Error("Corrupt configuration"));
    await expect(loadCustomerEffectiveRules()).rejects.toThrow("Corrupt configuration");
  });
});

describe("Server rule administrative endpoints", () => {
  const endpoint = "/api/commercial-intelligence/governance/server-rules";
  it("requires admin permission for read and update", async () => {
    await request(app).get(endpoint).expect(403);
    await request(app).put(`${endpoint}/customer_account`).send({ expectedVersion: 0, rules: {} }).expect(403);
    expect(state.version).toBe(0);
  });
  it("validates, audits and activates a customer-only version", async () => {
    await request(app).put(`${endpoint}/customer_account`).set("x-admin", "yes")
      .send({ expectedVersion: 0, rules: { scope: { requirePermissionValidation: false } } }).expect(400);
    const response = await request(app).put(`${endpoint}/customer_account`).set("x-admin", "yes")
      .send({ expectedVersion: 0, rules: { serverPolicy: { maxReadQueries: 4 } } }).expect(200);
    expect(response.body.version).toBe(1);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "mi_coach_server_rules_updated",
      before: expect.objectContaining({ channel: "customer_account" }),
      after: expect.objectContaining({ serverRulesVersion: 1 }),
    }));
    await request(app).put(`${endpoint}/customer_account`).set("x-admin", "yes")
      .send({ expectedVersion: 0, rules: {} }).expect(409);
    await request(app).put(`${endpoint}/coach`).set("x-admin", "yes")
      .send({ expectedVersion: 0, rules: {} }).expect(404);
    await request(app).put("/api/commercial-intelligence/governance/business-rules")
      .set("x-admin", "yes").send({ channel: "customer_account", rules: {} }).expect(409);
    await request(app).delete("/api/commercial-intelligence/governance/business-rules?channel=customer_account")
      .set("x-admin", "yes").expect(409);
    expect(state.version).toBe(1);
  });
});
