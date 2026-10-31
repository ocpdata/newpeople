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
const filesWith = (pattern) => files.filter(({ text }) => pattern.test(text)).map(({ file }) => file).sort();

// Audit of every write that can complete a Coach operation. If one of these changes, a new write path appeared
// and it must go through the same validator and the same in-chat guard.
describe("escrituras que puede confirmar el chat de cliente existente", () => {
  it("solo la ruta de ejecución del Coach ejecuta operaciones controladas", () => {
    expect(filesWith(/\bexecuteControlledCoachOperation\s*\(/)).toEqual(["coach/controlled-operation-service.js", "routes.mi-agent.js"]);
    const route = files.find(({ file }) => file === "routes.mi-agent.js").text;
    expect(route.match(/await executeControlledCoachOperation\(/g)).toHaveLength(1);
  });

  it("solo esa ruta acepta confirmedVia y siempre pasa por la guardia del chat", () => {
    expect(filesWith(/req\.body\??\.confirmedVia/)).toEqual(["routes.mi-agent.js"]);
    const route = files.find(({ file }) => file === "routes.mi-agent.js").text;
    expect(route.match(/req\.body\??\.confirmedVia/g)).toHaveLength(1);
    expect(route).toMatch(/if \(confirmedVia\) await assertChatConfirmationAllowed\(/);
  });

  it("los otros guardados que completan operaciones están acotados a su propio tipo", () => {
    const guards = {
      "coach/customer-stage-validation.js": "validate_stage",
      "coach/customer-link-save.js": "linkDraftId",
      "coach/customer-reschedule-save.js": "reschedule_activity",
    };
    for (const [file, kind] of Object.entries(guards)) {
      const text = files.find((entry) => entry.file === file).text;
      expect(text, file).toContain(kind);
    }
    // None of them can be reached with the kinds that the chat is allowed to confirm.
    for (const kind of ["opportunity_note", "opportunity_field", "account_field", "contact_field"]) {
      for (const file of Object.keys(guards)) {
        const text = files.find((entry) => entry.file === file).text;
        expect(text, `${file} no debe tratar ${kind}`).not.toContain(`"${kind}"`);
      }
    }
  });

  it("no aparece ningún otro lugar que complete operaciones del Coach", () => {
    expect(filesWith(/UPDATE coach_session_operations SET status\s*=\s*'completed'/)).toEqual([
      "coach/controlled-operation-service.js", "coach/customer-link-save.js", "coach/customer-reschedule-save.js", "coach/customer-stage-validation.js",
    ]);
  });
});
