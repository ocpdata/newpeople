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

  it("consolidates every Customer Existing process without losing its source snapshot", async () => {
    const rows = [
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
    const state = { migration: null, saved: null, rows: [...rows] };
    query.mockImplementation(async (sql, params = []) => {
      if (sql.includes("SELECT migration_key")) {
        return state.migration ? [{ migration_key: state.migration }] : [];
      }
      if (sql.includes("FROM mi_coach_business_rules WHERE channel")) {
        return state.rows;
      }
      if (sql.includes("INSERT IGNORE INTO mi_coach_business_rule_migrations")) {
        state.migration = params[0];
        state.snapshot = JSON.parse(params[1]);
        return [];
      }
      if (sql.includes("INSERT INTO mi_coach_business_rules")) {
        state.saved = JSON.parse(params[1]);
        state.savedUserId = params[2];
        return [];
      }
      if (sql.includes("DELETE FROM mi_coach_business_rules")) {
        state.rows = state.rows.filter((row) => row.process_key === "default");
        return [];
      }
      if (sql.includes("SELECT rules_json")) {
        return [{ rules_json: JSON.stringify(state.saved) }];
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
    expect(state.savedUserId).toBe(22);
    expect(state.snapshot).toEqual(rows);
    expect(state.rows.map((row) => row.process_key)).toEqual(["default"]);
    expect(state.migration).toBe("customer_account_single_process_v1");
  });

  it("persists rules by channel and process and reloads the saved contract", async () => {
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
      process: "qualification",
      rules: storedRules,
    });
    const loaded = await loadCoachBusinessRules({
      channel: "coach",
      process: "qualification",
    });

    expect(saved.process).toBe("qualification");
    expect(loaded.filters.defaultActiveOnly).toBe(false);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ON DUPLICATE KEY UPDATE"),
      expect.arrayContaining(["coach", "qualification"]),
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
