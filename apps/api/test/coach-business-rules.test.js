import { beforeEach, describe, expect, it, vi } from "vitest";

const businessRulesDb = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock("../src/db.js", () => businessRulesDb);

import { query, withTransaction } from "../src/db.js";
import {
  getCoachBusinessRules,
  loadCoachBusinessRules,
  normalizeCoachBusinessRules,
  saveCoachBusinessRules,
} from "../src/coach/business-rules.js";
import { applyCoachBusinessRuleScope } from "../src/coach/conversation-engine.js";
import { resolveAvailableCoachTools } from "../src/coach/conversation-engine.js";
import { executeCoachReadTool } from "../src/coach/crm-read-tools.js";
import { inferCoachOpportunityFilters } from "../src/coach/read-tools.js";

describe("Coach business rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.mockImplementation(async (sql) => {
      if (sql.includes("SELECT rules_json")) return [];
      return [];
    });
    withTransaction.mockImplementation(async (work) =>
      work({
        query: async (sql, params = []) => [await query(sql, params)],
      }),
    );
  });

  it("normalizes channel policies without allowing authorization safeguards to be disabled", () => {
    const rules = normalizeCoachBusinessRules({
      overrides: {
        scope: {
          requirePermissionValidation: false,
          requireBusinessEvidence: false,
        },
        validation: {
          requirePermissionValidation: false,
          requireEvidence: false,
          allowAmbiguousEntitySelection: true,
        },
        operationPolicy: {
          allowedKinds: ["activity", "create_account"],
        },
      },
    });

    expect(rules.scope).toMatchObject({
      requirePermissionValidation: true,
      requireBusinessEvidence: true,
    });
    expect(rules.validation).toMatchObject({
      requirePermissionValidation: true,
      requireEvidence: true,
      allowAmbiguousEntitySelection: false,
    });
    expect(rules.operationPolicy.allowedKinds).toEqual(["activity"]);
  });

  it("keeps channel isolation invariants locked against administrative overrides", () => {
    const prospectRules = normalizeCoachBusinessRules({
      channel: "prospect",
      overrides: {
        scope: {
          accountScoped: false,
          opportunitySearchAllowed: true,
          contactSearchAllowed: true,
          leadSearchAllowed: true,
        },
        channelRules: {
          prospectScoped: false,
          crmRecordsConfirmedOnly: false,
        },
      },
    });

    expect(prospectRules.scope).toMatchObject({
      accountScoped: true,
      opportunitySearchAllowed: false,
      contactSearchAllowed: false,
      leadSearchAllowed: false,
    });
    expect(prospectRules.channelRules).toMatchObject({
      prospectScoped: true,
      crmRecordsConfirmedOnly: true,
    });
  });

  it("keeps new Customer Existing operations disabled until explicitly configured", () => {
    const coachRules = getCoachBusinessRules({ channel: "coach" });
    const customerRules = getCoachBusinessRules({
      channel: "customer_account",
    });

    expect(customerRules.operationPolicy.allowedKinds).toEqual([
      ...coachRules.operationPolicy.allowedKinds,
      "create_contact",
    ]);
    expect(customerRules.operationPolicy.sourceChannel).toBe(
      "customer_account",
    );
    expect(customerRules.scope.accountScoped).toBe(true);
    expect(customerRules.operationPolicy.allowedKinds).not.toContain(
      "create_opportunity",
    );
    expect(customerRules.operationPolicy.allowedKinds).not.toContain(
      "link_contact_to_opportunity",
    );

    const enabledNewOperations = normalizeCoachBusinessRules({
      channel: "customer_account",
      overrides: {
        operationPolicy: {
          allowedKinds: [
            ...customerRules.operationPolicy.allowedKinds,
            "create_opportunity",
            "link_contact_to_opportunity",
          ],
        },
      },
    });
    expect(enabledNewOperations.operationPolicy.allowedKinds).toContain(
      "create_opportunity",
    );
    expect(enabledNewOperations.operationPolicy.allowedKinds).toContain(
      "link_contact_to_opportunity",
    );

    const disabledContactCreation = normalizeCoachBusinessRules({
      channel: "customer_account",
      overrides: {
        operationPolicy: {
          allowedKinds: coachRules.operationPolicy.allowedKinds,
        },
      },
    });
    expect(disabledContactCreation.operationPolicy.allowedKinds).toEqual(
      coachRules.operationPolicy.allowedKinds,
    );
  });

  it("normalizes contradictory default active/inactive filters", () => {
    const rules = getCoachBusinessRules({
      overrides: {
        filters: {
          defaultActiveOnly: true,
          defaultInactiveOnly: true,
          defaultRequireEvidence: false,
        },
      },
    });

    expect(rules.filters).toMatchObject({
      defaultActiveOnly: true,
      defaultInactiveOnly: false,
      defaultRequireEvidence: true,
    });
  });

  it("applies configured aliases and default filters to deterministic reads", () => {
    const rules = getCoachBusinessRules({
      overrides: {
        aliases: {
          stage: { "fase enterprise": "negociacion" },
          opportunityStatus: { activas: "en_proceso" },
        },
        filters: { defaultActiveOnly: true, defaultOpenOnly: true },
      },
    });
    const filters = inferCoachOpportunityFilters("Fase enterprise", rules);

    expect(filters).toMatchObject({
      stageCodes: ["negociacion"],
      activeOnly: true,
      openOnly: true,
    });

    const result = executeCoachReadTool({
      toolName: "searchOpportunities",
      businessRules: rules,
      snapshot: {
        coachOpportunities: [
          {
            id: 1,
            name: "Activa",
            lifecycle: "open",
            activationStatusCode: "activada",
          },
          {
            id: 2,
            name: "Inactiva",
            lifecycle: "open",
            activationStatusCode: "desactivada",
          },
          {
            id: 3,
            name: "Historica",
            lifecycle: "historical",
            activationStatusCode: "activada",
          },
        ],
      },
    });

    expect(result.result.map((item) => item.id)).toEqual([1]);
  });

  it("blocks read tools excluded by channel scope", () => {
    const result = executeCoachReadTool({
      toolName: "searchLeads",
      businessRules: getCoachBusinessRules({
        overrides: { scope: { leadSearchAllowed: false } },
      }),
      snapshot: { leads: [{ id: 1, title: "Lead" }] },
    });

    expect(result).toMatchObject({ result: null });
    expect(result.error).toContain("politica del canal");
  });

  it("removes disallowed entities from the model snapshot", () => {
    const snapshot = applyCoachBusinessRuleScope(
      {
        accounts: [{ id: 1 }],
        coachOpportunities: [{ id: 2 }],
        pipeline: { opportunities: [{ id: 2 }] },
        contactMappings: [{ id: 3 }],
        leads: [{ id: 4 }],
        selectedRecord: { id: 2, type: "opportunity" },
      },
      {
        scope: {
          opportunitySearchAllowed: false,
          contactSearchAllowed: false,
          leadSearchAllowed: false,
        },
      },
    );

    expect(snapshot).toMatchObject({
      coachOpportunities: [],
      pipeline: { opportunities: [] },
      contactMappings: [],
      leads: [],
      selectedRecord: null,
    });
  });

  it("consolidates Customer Existing and New Account processes without losing snapshots", async () => {
    const customerRows = [
      {
        id: 1,
        process_key: "default",
        rules_json: JSON.stringify({
          filters: { defaultOpenOnly: true },
          scope: { accountSearchAllowed: false },
        }),
        updated_by_user_id: 11,
        updated_at: "2026-10-01 00:00:00",
      },
      {
        id: 2,
        process_key: "account_chat",
        rules_json: JSON.stringify({
          filters: {
            defaultOpenOnly: false,
            defaultActiveOnly: false,
          },
          scope: { contactSearchAllowed: false },
        }),
        updated_by_user_id: 22,
        updated_at: "2026-10-02 00:00:00",
      },
      {
        id: 3,
        process_key: "legacy_custom",
        rules_json: JSON.stringify({
          filters: { defaultInactiveOnly: true },
        }),
        updated_by_user_id: 33,
        updated_at: "2026-10-03 00:00:00",
      },
    ];
    const prospectRows = [
      {
        id: 4,
        process_key: "default",
        rules_json: JSON.stringify({
          filters: { defaultOpenOnly: true },
          scope: { accountSearchAllowed: false },
        }),
        updated_by_user_id: 41,
        updated_at: "2026-10-01 00:00:00",
      },
      {
        id: 5,
        process_key: "prospect_chat",
        rules_json: JSON.stringify({
          filters: {
            defaultOpenOnly: false,
            defaultActiveOnly: false,
          },
          scope: { accountSearchAllowed: true },
        }),
        updated_by_user_id: 42,
        updated_at: "2026-10-02 00:00:00",
      },
    ];
    const coachRows = [
      {
        id: 10,
        process_key: "default",
        rules_json: JSON.stringify({
          filters: { defaultOpenOnly: true },
        }),
        updated_by_user_id: 10,
        updated_at: "2026-10-01 00:00:00",
      },
      {
        id: 11,
        process_key: "opportunity_query",
        rules_json: JSON.stringify({
          filters: { defaultActiveOnly: false },
        }),
        updated_by_user_id: 11,
        updated_at: "2026-10-02 00:00:00",
      },
      {
        id: 12,
        process_key: "account_query",
        rules_json: JSON.stringify({
          scope: { accountSearchAllowed: false },
        }),
        updated_by_user_id: 12,
        updated_at: "2026-10-03 00:00:00",
      },
      {
        id: 13,
        process_key: "stage_readiness",
        rules_json: JSON.stringify({
          filters: {
            defaultActiveOnly: false,
            defaultInactiveOnly: true,
          },
        }),
        updated_by_user_id: 13,
        updated_at: "2026-10-04 00:00:00",
      },
      {
        id: 14,
        process_key: "operation",
        rules_json: JSON.stringify({
          operationPolicy: { allowedKinds: ["activity"] },
        }),
        updated_by_user_id: 14,
        updated_at: "2026-10-05 00:00:00",
      },
    ];
    const state = {
      migrations: new Set(),
      rowsByChannel: {
        coach: [...coachRows],
        customer_account: [...customerRows],
        prospect: [...prospectRows],
      },
      savedByKey: new Map(),
      snapshots: new Map(),
      savedUserByKey: new Map(),
    };
    query.mockImplementation(async (sql, params = []) => {
      if (sql.includes("SELECT migration_key")) {
        return state.migrations.has(params[0])
          ? [{ migration_key: params[0] }]
          : [];
      }
      if (sql.includes("FROM mi_coach_business_rules WHERE channel")) {
        return state.rowsByChannel[params[0]] || [];
      }
      if (
        sql.includes("INSERT IGNORE INTO mi_coach_business_rule_migrations")
      ) {
        state.migrations.add(params[0]);
        state.snapshots.set(params[0], JSON.parse(params[1]));
        return [];
      }
      if (sql.includes("INSERT INTO mi_coach_business_rules")) {
        const isSingleProcessInsert = sql.includes("VALUES (?, 'default'");
        const process = isSingleProcessInsert ? "default" : params[1];
        const rulesJson = params[isSingleProcessInsert ? 1 : 2];
        const userId = params[isSingleProcessInsert ? 2 : 3];
        state.savedByKey.set(`${params[0]}:${process}`, JSON.parse(rulesJson));
        state.savedUserByKey.set(`${params[0]}:${process}`, userId);
        const processRows = state.rowsByChannel[params[0]] || [];
        const existingIndex = processRows.findIndex(
          (row) => row.process_key === process,
        );
        const migratedRow = {
          process_key: process,
          rules_json: rulesJson,
          updated_by_user_id: userId,
        };
        if (existingIndex >= 0) processRows[existingIndex] = migratedRow;
        else processRows.push(migratedRow);
        state.rowsByChannel[params[0]] = processRows;
        return [];
      }
      if (sql.includes("DELETE FROM mi_coach_business_rules")) {
        state.rowsByChannel[params[0]] = state.rowsByChannel[params[0]].filter(
          (row) =>
            [
              "default",
              "seller_coaching",
              "brief_context",
              "operation",
            ].includes(row.process_key),
        );
        return [];
      }
      if (sql.includes("SELECT rules_json")) {
        const process = params[1];
        return [
          {
            rules_json: JSON.stringify(
              state.savedByKey.get(`${params[0]}:${process}`),
            ),
          },
        ];
      }
      return [];
    });

    const rules = await loadCoachBusinessRules({
      channel: "customer_account",
      process: "account_chat",
    });

    expect(rules.process).toBe("default");
    expect(rules.filters).toMatchObject({
      defaultOpenOnly: false,
      defaultInactiveOnly: true,
    });
    expect(rules.scope).toMatchObject({
      accountSearchAllowed: false,
      contactSearchAllowed: false,
    });
    expect(state.savedUserByKey.get("customer_account:default")).toBe(22);
    expect(state.snapshots.get("customer_account_single_process_v1")).toEqual(
      customerRows,
    );
    expect(
      state.rowsByChannel.customer_account.map((row) => row.process_key),
    ).toEqual(["default"]);
    expect(state.migrations.has("customer_account_single_process_v1")).toBe(
      true,
    );

    const prospectRules = await loadCoachBusinessRules({
      channel: "prospect",
      process: "prospect_chat",
    });
    expect(prospectRules.process).toBe("default");
    expect(prospectRules.filters).toMatchObject({
      defaultOpenOnly: false,
      defaultActiveOnly: false,
    });
    expect(prospectRules.scope.accountSearchAllowed).toBe(true);
    expect(state.savedUserByKey.get("prospect:default")).toBe(42);
    expect(state.snapshots.get("prospect_single_process_v1")).toEqual(
      prospectRows,
    );
    expect(state.rowsByChannel.prospect.map((row) => row.process_key)).toEqual([
      "default",
    ]);
    expect(state.migrations.has("prospect_single_process_v1")).toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE channel = ? AND process_key = ? LIMIT 1"),
      ["prospect", "default"],
    );

    const briefContext = await loadCoachBusinessRules({
      channel: "coach",
      process: "brief_context",
    });
    const sellerCoaching = await loadCoachBusinessRules({
      channel: "coach",
      process: "seller_coaching",
    });
    const operation = await loadCoachBusinessRules({
      channel: "coach",
      process: "operation",
    });
    const base = await loadCoachBusinessRules({
      channel: "coach",
      process: "default",
    });
    expect(base.filters.defaultOpenOnly).toBe(true);
    expect(briefContext.filters.defaultActiveOnly).toBe(false);
    expect(briefContext.scope.accountSearchAllowed).toBe(false);
    expect(sellerCoaching.filters.defaultInactiveOnly).toBe(true);
    expect(operation.operationPolicy.allowedKinds).toEqual(["activity"]);
    expect(
      state.snapshots.get("coach_interaction_policy_processes_v1"),
    ).toEqual(coachRows);
    expect(
      state.rowsByChannel.coach.map((row) => row.process_key).sort(),
    ).toEqual(["brief_context", "default", "operation", "seller_coaching"]);
  });

  it("saves prospect chat configuration to the default process", async () => {
    const storedRules = {
      filters: { defaultActiveOnly: false },
      operationPolicy: { allowedKinds: ["create_account"] },
    };
    query.mockImplementation(async (sql) => {
      if (sql.includes("SELECT rules_json")) {
        return [{ rules_json: JSON.stringify(storedRules) }];
      }
      return [];
    });

    const saved = await saveCoachBusinessRules({
      user: { id: 43 },
      channel: "prospect",
      process: "prospect_chat",
      rules: storedRules,
    });
    const loaded = await loadCoachBusinessRules({
      channel: "prospect",
      process: "prospect_chat",
    });

    expect(saved.process).toBe("default");
    expect(loaded.process).toBe("default");
    expect(loaded.filters.defaultActiveOnly).toBe(false);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ON DUPLICATE KEY UPDATE"),
      expect.arrayContaining(["prospect", expect.any(String), 43]),
    );
  });

  it("persists rules by channel and canonical process and reloads the saved contract", async () => {
    const storedRules = {
      filters: { defaultActiveOnly: false },
      operationPolicy: { allowedKinds: ["activity"] },
    };
    query.mockImplementation(async (sql) => {
      if (sql.includes("SELECT rules_json")) {
        return [{ rules_json: JSON.stringify(storedRules) }];
      }
      return [];
    });

    const saved = await saveCoachBusinessRules({
      user: { id: 31 },
      channel: "coach",
      process: "seller_coaching",
      rules: storedRules,
    });
    const loaded = await loadCoachBusinessRules({
      channel: "coach",
      process: "seller_coaching",
    });

    expect(saved.process).toBe("seller_coaching");
    expect(loaded.filters.defaultActiveOnly).toBe(false);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ON DUPLICATE KEY UPDATE"),
      expect.arrayContaining(["coach", "seller_coaching"]),
    );
  });

  it("allows quotation reading to be disabled without weakening its permission checks", () => {
    const rules = getCoachBusinessRules({
      channel: "coach",
      overrides: { scope: { quotationSearchAllowed: false } },
    });
    const tools = resolveAvailableCoachTools(
      [
        {
          name: "getOpportunityQuotation",
          requiredPermission: "oportunidades.read",
          requiredAnyPermissions: [
            "cotizaciones.revision",
            "cotizaciones.operacion",
          ],
        },
      ],
      new Set(["oportunidades.read", "cotizaciones.revision"]),
    ).filter((tool) => rules.scope.quotationSearchAllowed !== false);

    expect(tools).toEqual([]);
    expect(
      applyCoachBusinessRuleScope(
        { selectedOpportunityQuotation: { quotationId: 21 } },
        rules,
      ).selectedOpportunityQuotation,
    ).toBeNull();
  });
});
