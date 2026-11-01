import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL("../src/", import.meta.url).pathname;

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".js") ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({ file: relative(SRC, path), text: readFileSync(path, "utf8") }));
const text = (file) => files.find((entry) => entry.file === file).text;
const filesWith = (pattern) => files.filter(({ file, text: body }) => !file.startsWith("channel-quality/") && pattern.test(body)).map(({ file }) => file).sort();

// Business tables a chat answer must never change by itself. Writes go through confirmed operations or conversion routes.
const BUSINESS_TABLES = "accounts|contacts|opportunities|leads|interactions|quotations|account_contacts|opportunity_contacts";
const businessWrite = new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(${BUSINESS_TABLES})\\b`, "i");

describe("rutas de escritura de Coach y Cuenta nueva", () => {
  it("los adaptadores de chat no escriben en tablas de negocio", () => {
    for (const file of [
      "prospect-research/prospect-chat-adapter.js", "coach/agent-gateway.js", "coach/coach-adapter.js",
      "coach/coach-orchestrator.js", "coach/block-pipeline.js", "coach/block-runtime.js",
    ]) {
      expect(text(file), file).not.toMatch(businessWrite);
    }
  });

  it("el chat de Cuenta nueva no importa el acceso a la base de datos", () => {
    expect(text("prospect-research/prospect-chat-adapter.js")).not.toMatch(/from "\.\.\/db\.js"/);
  });

  it("solo las rutas de Cuenta nueva ejecutan las conversiones a CRM", () => {
    for (const name of [
      "convertProspectSessionToAccount", "convertProspectContact", "convertProspectSessionToLead", "convertProspectHypothesisToOpportunity",
    ]) {
      expect(filesWith(new RegExp(`\\b${name}\\s*\\(`)), name).toEqual(["prospect-research/service.js", "routes.prospect-research.js"]);
    }
    expect(filesWith(/prospect-research\/service\.js/)).toContain("routes.prospect-research.js");
    expect(text("prospect-research/prospect-chat-adapter.js")).not.toMatch(/convertProspect/);
  });

  it("las conversiones exigen un permiso de creación propio en cada ruta", () => {
    const route = text("routes.prospect-research.js");
    for (const path of ["convert-to-account", "convert-to-lead"]) {
      const block = route.slice(route.indexOf(`/sessions/:sessionId/${path}`));
      expect(block.slice(0, 400), path).toMatch(/requirePermission\(/);
    }
  });

  it("las operaciones que propone Cuenta nueva siempre requieren confirmación y llevan su canal", () => {
    const source = text("coach/operation-contract.js");
    const block = source.slice(source.indexOf("export function normalizeProspectConversionOperation"));
    expect(block.slice(0, 1200)).toContain("requiresConfirmation: true");
    expect(block.slice(0, 1200)).toContain('sourceChannel: "prospect"');
  });

  it("las operaciones de Coach nacen con confirmación obligatoria", () => {
    const source = text("coach/operation-contract.js");
    const block = source.slice(source.indexOf("export function normalizeActivityOperation"));
    expect(block.slice(0, 2500)).toContain("requiresConfirmation: true");
  });

  it("el motor descarta una operación cuyo canal no coincide con el del turno", () => {
    expect(text("coach/conversation-engine.js")).toMatch(
      /policy\.sourceChannel\s*&&\s*operation\?\.sourceChannel\s*&&\s*operation\.sourceChannel\s*!==\s*policy\.sourceChannel/,
    );
  });

  it("los borradores propios de Cliente existente solo se aceptan con su canal", () => {
    for (const file of ["coach/customer-update-access.js", "coach/customer-link-access.js"]) {
      expect(text(file), file).toContain('sourceChannel !== "customer_account"');
    }
  });
});
