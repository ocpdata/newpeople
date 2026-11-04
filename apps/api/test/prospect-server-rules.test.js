import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../src/db.js", () => db);
vi.mock("../src/coach/business-rules.js", async (original) => {
  const actual = await original();
  return {
    ...actual,
    ensureRulesSchema: vi.fn(),
    loadCoachBusinessRules: vi.fn(async () => actual.getCoachBusinessRules({ channel: "prospect", overrides: globalThis.__prospectRules })),
  };
});
vi.mock("../src/commercial-intelligence/permissions.js", () => ({ ensureCommercialIntelligencePermissions: vi.fn() }));
vi.mock("../src/commercial-intelligence/schema.js", () => ({ ensureCommercialIntelligenceSchema: vi.fn() }));
vi.mock("../src/audit.js", () => ({ logAuditEvent: vi.fn() }));

import { getCoachBusinessRules } from "../src/coach/business-rules.js";
import {
  PROSPECT_SERVER_POLICY_DEFAULTS,
  PROSPECT_SERVER_RULE_CATEGORIES,
  getProspectServerPolicy,
  prospectServerRulesUpdateSchema,
} from "../src/coach/prospect-server-policy.js";
import { editableProspectRules } from "../src/prospect-research/prospect-server-rules.js";
import { buildProspectCrmContext, conversionBlock, kindDisabledAnswer } from "../src/prospect-research/prospect-crm-context.js";
import { detectGuardedTurn } from "../src/prospect-research/prospect-guards.js";
import { logAuditEvent } from "../src/audit.js";
import router from "../src/routes.commercial-intelligence.js";

describe("política del servidor de Cuenta nueva", () => {
  it("tiene valores iniciales y cae al valor inicial si lo guardado no es válido", () => {
    expect(getProspectServerPolicy({})).toEqual(PROSPECT_SERVER_POLICY_DEFAULTS);
    expect(getProspectServerPolicy({ serverPolicy: { helpModelRole: "advanced", maxHistoryMessages: 6 } }))
      .toMatchObject({ helpModelRole: "advanced", maxHistoryMessages: 6, semanticClassifier: "on" });
    expect(getProspectServerPolicy({ serverPolicy: { maxHistoryMessages: 99 } })).toEqual(PROSPECT_SERVER_POLICY_DEFAULTS);
    expect(getProspectServerPolicy({ serverPolicy: { helpModelRole: "ultra" } })).toEqual(PROSPECT_SERVER_POLICY_DEFAULTS);
  });

  it("forma parte de las reglas del canal sin cambiar las de otros canales", () => {
    const rules = getCoachBusinessRules({ channel: "prospect" });
    expect(rules.serverPolicy).toEqual(PROSPECT_SERVER_POLICY_DEFAULTS);
    expect(rules.scope).toMatchObject({ libraryMaterialsAllowed: true, similarCustomersAllowed: true });
    expect(rules.operationPolicy.allowedKinds).toEqual(["create_account", "create_contact", "create_opportunity"]);
    const tuned = getCoachBusinessRules({
      channel: "prospect",
      overrides: { scope: { libraryMaterialsAllowed: false }, operationPolicy: { allowedKinds: ["create_contact", "activity"] }, serverPolicy: { semanticClassifier: "off" } },
    });
    expect(tuned.scope.libraryMaterialsAllowed).toBe(false);
    expect(tuned.operationPolicy.allowedKinds).toEqual(["create_contact"]);
    expect(tuned.serverPolicy.semanticClassifier).toBe("off");
    expect(getCoachBusinessRules({ channel: "coach" }).serverPolicy).toBeUndefined();
    expect(getCoachBusinessRules({ channel: "customer_account" }).serverPolicy).toHaveProperty("maxReadQueries");
  });

  it("solo expone para editar lo configurable y rechaza lo que no existe", () => {
    expect(editableProspectRules(getCoachBusinessRules({ channel: "prospect" }))).toEqual({
      scope: { libraryMaterialsAllowed: true, similarCustomersAllowed: true },
      operationPolicy: { allowedKinds: ["create_account", "create_contact", "create_opportunity"] },
      serverPolicy: PROSPECT_SERVER_POLICY_DEFAULTS,
    });
    const valid = { expectedVersion: 0, rules: { serverPolicy: { helpModelRole: "advanced" } } };
    expect(prospectServerRulesUpdateSchema.safeParse(valid).success).toBe(true);
    for (const rules of [
      { scope: { requirePermissionValidation: false } },
      { operationPolicy: { allowedKinds: ["activity"] } },
      { serverPolicy: { maxHistoryMessages: 1 } },
      { serverPolicy: { schemaVersion: 2 } },
      { verification: false },
    ]) expect(prospectServerRulesUpdateSchema.safeParse({ expectedVersion: 0, rules }).success, JSON.stringify(rules)).toBe(false);
  });

  it("el catálogo distingue lo editable, lo protegido y lo evaluado por IA", () => {
    const rules = PROSPECT_SERVER_RULE_CATEGORIES.flatMap((category) => category.rules);
    expect(new Set(rules.map((rule) => rule.id)).size).toBe(rules.length);
    expect(rules.filter((rule) => rule.kind === "configurable").map((rule) => rule.path).sort()).toEqual([
      "operationPolicy.allowedKinds", "scope.libraryMaterialsAllowed", "scope.similarCustomersAllowed",
      "serverPolicy.helpModelRole", "serverPolicy.maxHistoryMessages", "serverPolicy.semanticClassifier",
    ]);
    const verification = rules.find((rule) => rule.id === "answer-verification");
    expect(verification.kind).toBe("protected");
    expect(rules.find((rule) => rule.id === "operation-kinds").values).toEqual(["create_account", "create_contact", "create_opportunity"]);
  });
});

describe("conversiones que las reglas no permiten", () => {
  const crm = buildProspectCrmContext({
    duplicateReview: { completed: true, candidates: [] }, conversionAllowed: true, allowedKinds: ["create_account"],
    session: { contacts: [{ name: "A", email: "a@b.test" }], hypotheses: [{ title: "H" }], convertedAccountId: 9 },
  });

  it("bloquean la propuesta y lo explican sin crear nada", () => {
    expect(conversionBlock(crm, "contact")).toEqual({ reason: "kind_disabled", target: "contact" });
    expect(conversionBlock(crm, "account")).toBeNull();
    expect(conversionBlock({ conversionAllowed: true }, "contact")).toBeNull();
    const snapshot = { profile: { companyName: "Aceros" }, crm, contacts: [{ name: "Laura Medina" }], hypotheses: [], findings: [] };
    const turn = detectGuardedTurn({ question: "Crea el contacto Laura Medina en el CRM.", snapshot });
    expect(turn).toMatchObject({ kind: "conversion_blocked" });
    expect(turn.answer).toBe(kindDisabledAnswer("contact"));
    expect(turn.answer).toContain("Todavía no se creó ningún registro");
  });

  it("aparecen como faltante cuando se pregunta qué falta", () => {
    expect(crm.readiness.contact.missing).toContain("las reglas del servidor no permiten proponer esta conversión");
    expect(crm.readiness.account.missing).toEqual([]);
    expect(crm.allowedKinds).toEqual(["create_account"]);
  });
});

describe("endpoints de administración de Cuenta nueva", () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 31, permissionSet: new Set(req.headers["x-admin"] === "yes" ? ["mi_coach.access", "mi_coach.admin"] : ["mi_coach.access"]) };
    next();
  });
  app.use("/api/commercial-intelligence", router);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));
  const endpoint = "/api/commercial-intelligence/governance/server-rules/prospect";
  let state;

  beforeEach(() => {
    vi.clearAllMocks();
    state = { version: 0, revisions: [], rules: {} };
    globalThis.__prospectRules = state.rules;
    db.query.mockImplementation(async (sql, params = []) => {
      if (sql.includes("FROM mi_coach_server_rule_versions")) return [{ version: state.version, updated_by_user_id: null, updated_at: null }];
      if (sql.includes("FROM mi_coach_server_rule_revisions")) return [...state.revisions].reverse();
      return [];
    });
    db.withTransaction.mockImplementation(async (work) => {
      const connection = {
        query: vi.fn(async (sql, params = []) => {
          if (sql.includes("SELECT version")) return [[{ version: state.version }]];
          if (sql.includes("SELECT rules_json")) return [[{ rules_json: JSON.stringify(state.rules), updated_by_user_id: null }]];
          if (sql.includes("INSERT INTO mi_coach_business_rules")) {
            state.rules = JSON.parse(params[1]);
            globalThis.__prospectRules = state.rules;
          }
          if (sql.includes("INTO mi_coach_server_rule_revisions") && !state.revisions.some((row) => row.version === params[1])) {
            state.revisions.push({ version: params[1], rules_json: params[2], created_by_user_id: params[3], created_at: null });
          }
          if (sql.startsWith("UPDATE mi_coach_server_rule_versions")) state.version = params[0];
          return [[]];
        }),
      };
      return work(connection);
    });
  });

  it("exige permiso de administración para leer y guardar", async () => {
    await request(app).get(endpoint).expect(403);
    await request(app).put(endpoint).send({ expectedVersion: 0, rules: {} }).expect(403);
  });

  it("las políticas del canal antiguas no pueden sobrescribir las reglas versionadas de Cuenta nueva", async () => {
    const legacy = "/api/commercial-intelligence/governance/business-rules";
    const put = await request(app).put(legacy).set("x-admin", "yes").send({ channel: "prospect", rules: {} }).expect(409);
    expect(put.body.message).toContain("Reglas del servidor");
    const del = await request(app).delete(`${legacy}?channel=prospect`).set("x-admin", "yes").expect(409);
    expect(del.body.message).toContain("Reglas del servidor");
  });

  it("devuelve las reglas vigentes, el catálogo y el historial", async () => {
    const response = await request(app).get(endpoint).set("x-admin", "yes").expect(200);
    expect(response.body).toMatchObject({
      channel: "prospect", process: "default", connected: true, version: 0,
      rules: { scope: { libraryMaterialsAllowed: true }, serverPolicy: { helpModelRole: "advanced" } },
    });
    expect(response.body.categories).toHaveLength(5);
  });

  it("valida, versiona, audita y rechaza un guardado con una versión vieja", async () => {
    await request(app).put(endpoint).set("x-admin", "yes")
      .send({ expectedVersion: 0, rules: { scope: { requirePermissionValidation: false } } }).expect(400);
    const saved = await request(app).put(endpoint).set("x-admin", "yes")
      .send({ expectedVersion: 0, rules: { scope: { libraryMaterialsAllowed: false }, serverPolicy: { helpModelRole: "fast" } } }).expect(200);
    expect(saved.body.version).toBe(1);
    expect(saved.body.rules).toMatchObject({ scope: { libraryMaterialsAllowed: false, similarCustomersAllowed: true }, serverPolicy: { helpModelRole: "fast", maxHistoryMessages: 16 } });
    expect(state.revisions.map((row) => row.version)).toEqual([0, 1]);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "mi_coach_server_rules_updated",
      before: expect.objectContaining({ channel: "prospect" }),
      after: expect.objectContaining({ serverRulesVersion: 1 }),
    }));
    await request(app).put(endpoint).set("x-admin", "yes").send({ expectedVersion: 0, rules: {} }).expect(409);
    expect(state.version).toBe(1);
  });
});
