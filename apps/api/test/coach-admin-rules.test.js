import { beforeEach, describe, expect, it, vi } from "vitest";

const adminRulesDb = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  migrations: new Set(),
  rules: [],
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
    ];
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
      if (sql.includes("SET process_key = 'default'")) {
        for (const rule of adminRulesDb.rules) {
          if (
            rule.scope_code === "channel" &&
            rule.channel_code === "customer_account" &&
            rule.process_key !== "default"
          ) {
            rule.process_key = "default";
          }
        }
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
  });
});
