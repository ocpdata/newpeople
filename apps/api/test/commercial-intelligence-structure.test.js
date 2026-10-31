import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const folder = fileURLToPath(new URL("../src/commercial-intelligence/", import.meta.url));
const read = (file) => readFileSync(`${folder}${file}`, "utf8");

// service.js is the public entry point; the work lives in the modules below it.
const MODULES = [
  "service-helpers.js", "account-access.js", "governance-settings.js", "snapshot-data-needs.js", "customer-snapshot.js",
  "intelligence-research.js", "chat-sessions.js", "chat-diagnostics.js", "chat-worker.js", "chat-jobs.js",
];
const localImports = (file) => [...read(file).matchAll(/from\s+"\.\/([\w-]+\.js)"/g)].map((match) => match[1]);

describe("estructura del servicio de inteligencia comercial", () => {
  it("service.js sigue exponiendo la misma API pública", async () => {
    const service = await import("../src/commercial-intelligence/service.js");
    expect(Object.keys(service).sort()).toEqual([
      "CHAT_SESSION_LIST_PAGE_SIZE",
      "PUBLIC_CONTACT_ROLE_TERMS",
      "applyCustomerContactFinding",
      "applyCustomerIntelligenceFinding",
      "assertExternalResearchGovernance",
      "buildAccountHealth",
      "buildAuthorizedCustomerSnapshot",
      "buildChatSessionTitle",
      "buildExpansionHypotheses",
      "cancelCustomerAccountChatJob",
      "classifyCustomerIntent",
      "classifyCustomerSnapshotDataNeeds",
      "closeCustomerChatDiagnostic",
      "createAccountIntelligenceAgentsJob",
      "createAccountInternalAnalysisJob",
      "createCommercialDiscoveryJob",
      "createCustomerAccountChatJob",
      "createCustomerAccountChatSession",
      "createCustomerExecutiveBriefingJob",
      "createCustomerExternalResearchJob",
      "createCustomerIntelligenceJob",
      "deduplicateCustomerIntelligenceFindings",
      "filterCustomerOpportunityArtifacts",
      "filterCustomerOpportunityHistory",
      "generateCommercialDiscoveryResult",
      "generateCustomerIntelligenceFindings",
      "getAccountIntelligenceMetrics",
      "getCustomerAccountChatDiagnosticSession",
      "getCustomerAccountChatSession",
      "getCustomerChatCapabilities",
      "getCustomerChatFocusOptions",
      "getCustomerIntelligenceJob",
      "getCustomerSnapshotQueryMetrics",
      "getMiCoachGovernanceOverview",
      "getMiCoachGovernanceSettings",
      "listCustomerAccountChatDiagnostics",
      "listCustomerAccountChatSessions",
      "listCustomerIntelligenceFindings",
      "normalizeCustomerSnapshotDataNeeds",
      "processAccountIntelligenceAgentsJob",
      "processAccountInternalAnalysisJob",
      "processCommercialDiscoveryJob",
      "processCustomerAccountChatJob",
      "processCustomerExecutiveBriefingJob",
      "processCustomerExternalResearchJob",
      "processCustomerIntelligenceJob",
      "runAccountIntelligenceAgents",
      "updateCustomerIntelligenceFindingStatus",
      "updateMiCoachGovernanceSettings",
    ]);
  });

  it("los módulos existen y ninguno importa service.js (sin ciclos con la fachada)", () => {
    const present = readdirSync(folder);
    for (const file of MODULES) {
      expect(present).toContain(file);
      expect(localImports(file)).not.toContain("service.js");
    }
  });

  it("las dependencias entre módulos forman un grafo sin ciclos", () => {
    const graph = Object.fromEntries(MODULES.map((file) => [file, localImports(file).filter((other) => MODULES.includes(other))]));
    const state = {};
    const visit = (file, path) => {
      if (state[file] === "done") return;
      expect(state[file], `ciclo: ${[...path, file].join(" → ")}`).not.toBe("visiting");
      state[file] = "visiting";
      graph[file].forEach((next) => visit(next, [...path, file]));
      state[file] = "done";
    };
    MODULES.forEach((file) => visit(file, []));
  });

  it("ningún módulo del servicio vuelve a crecer sin control", () => {
    const lines = (file) => read(file).split("\n").length;
    expect(lines("service.js")).toBeLessThan(1600);
    for (const file of MODULES.filter((name) => name !== "chat-worker.js")) expect(lines(file)).toBeLessThan(1300);
    // The turn worker is split by stage, but the diagnostics builder is still one very long function.
    expect(lines("chat-worker.js")).toBeLessThan(2450);
  });

  it("el turno del chat se ejecuta por etapas y la función principal no vuelve a crecer", () => {
    const text = read("chat-worker.js");
    for (const stage of ["prepareChatTurn", "answerChatTurn", "attachTurnDebug"]) {
      expect(text).toMatch(new RegExp(`function ${stage}\\(`));
    }
    const start = text.indexOf("export async function runCustomerAccountChatJob");
    expect(text.slice(start).split("\n").length).toBeLessThan(700);
  });
});
