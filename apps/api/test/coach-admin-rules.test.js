import { beforeEach, describe, expect, it, vi } from "vitest";

const adminRulesDb = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  migrations: new Set(),
  rules: [],
  snapshots: new Map(),
  updateCount: 0,
}));

vi.mock("../src/db.js", () => adminRulesDb);

import { listCoachAdminRules } from "../src/coach/admin-rules.js";

const legacyActivityOnlyInstruction =
  "Limita las operaciones propuestas a actividades relacionadas con la cuenta seleccionada. No propongas cambios de etapa, campos CRM u operaciones comerciales que pertenecen al Chat Coach.";

describe("Coach administrative rule migration", () => {
  beforeEach(() => {
    adminRulesDb.migrations = new Set([
      "seed_initial_admin_rules_v1",
      "seed_additional_admin_rules_v2",
    ]);
    adminRulesDb.updateCount = 0;
    adminRulesDb.rules = [
      {
        id: "customer-limit-operations",
        scope_code: "channel",
        channel_code: "customer_account",
        process_key: "default",
        title: "Limitar acciones de Cliente existente",
        instruction:
          "En este canal solo propone actividades relacionadas con la cuenta autorizada. No propongas cambios de campos o de etapa disponibles únicamente en el Chat Coach.",
        is_enabled: 1,
        sort_order: 20,
      },
      {
        id: "customer-activities-only",
        scope_code: "channel",
        channel_code: "customer_account",
        process_key: "default",
        title: "Proponer solo actividades para la cuenta",
        instruction: "Regla personalizada conservada por el administrador.",
        is_enabled: 1,
        sort_order: 50,
      },
      {
        id: "customer-account-chat-custom",
        scope_code: "channel",
        channel_code: "customer_account",
        process_key: "account_chat",
        title: "Regla específica conservada",
        instruction: "Conservar esta instrucción específica.",
        is_enabled: 0,
        sort_order: 70,
      },
      {
        id: "prospect-default-custom",
        scope_code: "channel",
        channel_code: "prospect",
        process_key: "default",
        title: "Regla general de Cuenta nueva",
        instruction: "Mantener la regla general.",
        is_enabled: 1,
        sort_order: 30,
      },
      {
        id: "prospect-chat-custom",
        scope_code: "channel",
        channel_code: "prospect",
        process_key: "prospect_chat",
        title: "Regla específica de Cuenta nueva",
        instruction: "Conservar la instrucción específica.",
        is_enabled: 0,
        sort_order: 40,
      },
      {
        id: "coach-opportunity-query-custom",
        scope_code: "channel",
        channel_code: "coach",
        process_key: "opportunity_query",
        title: "Detalle de oportunidades",
        instruction: "Mantener el contexto breve de oportunidades.",
        is_enabled: 1,
        sort_order: 60,
      },
      {
        id: "coach-stage-readiness-custom",
        scope_code: "channel",
        channel_code: "coach",
        process_key: "stage_readiness",
        title: "Guía de etapas personalizada",
        instruction: "Priorizar evidencia y avance de etapa.",
        is_enabled: 1,
        sort_order: 70,
      },
    ];
    adminRulesDb.snapshots = new Map();
    adminRulesDb.query.mockImplementation(async (sql, params = []) => {
      if (sql.includes("CREATE TABLE")) return [];
      if (sql.includes("SELECT migration_key")) {
        return adminRulesDb.migrations.has(params[0])
          ? [{ migration_key: params[0] }]
          : [];
      }
      if (sql.includes("INSERT IGNORE INTO mi_coach_admin_rule_migrations")) {
        adminRulesDb.migrations.add(params[0]);
        return [];
      }
      if (
        sql.includes(
          "INSERT IGNORE INTO mi_coach_admin_rule_migration_snapshots",
        )
      ) {
        adminRulesDb.snapshots.set(params[0], JSON.parse(params[1]));
        return [];
      }
      if (
        sql.startsWith("SELECT id, scope_code, channel_code, process_key") &&
        sql.includes("WHERE scope_code = 'channel' AND channel_code = ?")
      ) {
        return adminRulesDb.rules.filter(
          (rule) =>
            rule.scope_code === "channel" && rule.channel_code === params[0],
        );
      }
      if (sql.includes("SET process_key = 'default'")) {
        const channel = params[0];
        for (const rule of adminRulesDb.rules) {
          if (
            rule.scope_code === "channel" &&
            rule.channel_code === channel &&
            rule.process_key !== "default"
          ) {
            rule.process_key = "default";
          }
        }
        return [];
      }
      if (sql.includes("SET process_key = ?")) {
        const [process, id] = params;
        const row = adminRulesDb.rules.find((item) => item.id === id);
        if (row) row.process_key = process;
        return [];
      }
      if (sql.includes("UPDATE mi_coach_admin_rules")) {
        adminRulesDb.updateCount += 1;
        const [title, instruction, id, oldTitle, oldInstruction] = params;
        const row = adminRulesDb.rules.find((item) => item.id === id);
        if (row?.title === oldTitle && row?.instruction === oldInstruction) {
          row.title = title;
          row.instruction = instruction;
        }
        return [];
      }
      if (sql.includes("FROM mi_coach_admin_rules")) {
        const [channel, process] = params;
        return adminRulesDb.rules.filter(
          (rule) =>
            rule.scope_code === "common" ||
            (rule.scope_code === "channel" &&
              rule.channel_code === channel &&
              ["default", process].includes(rule.process_key)),
        );
      }
      return [];
    });
    adminRulesDb.withTransaction.mockImplementation(async (work) =>
      work({
        query: async (sql, params = []) => [
          await adminRulesDb.query(sql, params),
        ],
      }),
    );
  });

  it("aligns built-in operation guidance without overwriting admin customization", async () => {
    const rules = await listCoachAdminRules({
      channel: "customer_account",
      process: "account_chat",
    });
    expect(
      adminRulesDb.rules.find(
        (rule) => rule.id === "customer-account-chat-custom",
      ).process_key,
    ).toBe("default");
    const activityPolicy = rules.find(
      (rule) => rule.id === "customer-limit-operations",
    );
    const customizedRule = rules.find(
      (rule) => rule.id === "customer-activities-only",
    );

    expect(activityPolicy.instruction).toContain(
      "política efectiva del servidor",
    );
    expect(activityPolicy.instruction).toContain("no concede permisos");
    expect(customizedRule.instruction).toBe(
      "Regla personalizada conservada por el administrador.",
    );
    expect(rules).toContainEqual(
      expect.objectContaining({
        id: "customer-account-chat-custom",
        process: "default",
        instruction: "Conservar esta instrucción específica.",
        enabled: false,
      }),
    );
    expect(adminRulesDb.updateCount).toBe(2);
    expect(
      adminRulesDb.migrations.has("customer_account_single_process_v1"),
    ).toBe(true);
    expect(
      adminRulesDb.migrations.has("align_customer_operations_admin_rules_v3"),
    ).toBe(true);
    expect(adminRulesDb.migrations.has("prospect_single_process_v1")).toBe(
      true,
    );
    expect(
      adminRulesDb.rules.find((rule) => rule.id === "prospect-chat-custom")
        .process_key,
    ).toBe("default");
    expect(
      adminRulesDb.rules.find(
        (rule) => rule.id === "coach-opportunity-query-custom",
      ).process_key,
    ).toBe("brief_context");
    expect(
      adminRulesDb.rules.find(
        (rule) => rule.id === "coach-stage-readiness-custom",
      ).process_key,
    ).toBe("seller_coaching");
    expect(
      adminRulesDb.snapshots.get("coach_interaction_policy_processes_v1"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "coach-opportunity-query-custom",
          process_key: "opportunity_query",
        }),
      ]),
    );

    const prospectRules = await listCoachAdminRules({
      channel: "prospect",
      process: "prospect_chat",
    });
    expect(prospectRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "prospect-default-custom",
          process: "default",
          instruction: "Mantener la regla general.",
        }),
        expect.objectContaining({
          id: "prospect-chat-custom",
          process: "default",
          instruction: "Conservar la instrucción específica.",
          enabled: false,
        }),
      ]),
    );
  });
});
