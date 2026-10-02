import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => ({ query: vi.fn() }));

import { query } from "../src/db.js";
import {
  getCoachBusinessRules,
  loadCoachBusinessRules,
  normalizeCoachBusinessRules,
  saveCoachBusinessRules,
} from "../src/coach/business-rules.js";
import { applyCoachBusinessRuleScope } from "../src/coach/conversation-engine.js";
import { executeCoachReadTool } from "../src/coach/crm-read-tools.js";
import { inferCoachOpportunityFilters } from "../src/coach/read-tools.js";

describe("Coach business rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.mockImplementation(async (sql) => {
      if (sql.includes("SELECT rules_json")) return [];
      return [];
    });
  });

  it("normalizes channel policies without allowing authorization safeguards to be disabled", () => {
    const rules = normalizeCoachBusinessRules({
      overrides: {
        scope: { requirePermissionValidation: false, requireBusinessEvidence: false },
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
          { id: 1, name: "Activa", lifecycle: "open", activationStatusCode: "activada" },
          { id: 2, name: "Inactiva", lifecycle: "open", activationStatusCode: "desactivada" },
          { id: 3, name: "Historica", lifecycle: "historical", activationStatusCode: "activada" },
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
});