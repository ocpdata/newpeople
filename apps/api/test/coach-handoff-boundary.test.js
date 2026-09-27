import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCoachFormPatch } from "../../web/src/coach/handoffForm.js";

const miAgentSource = readFileSync(
  new URL("../../web/src/MiAgentPage.jsx", import.meta.url),
  "utf8",
);

describe("Coach handoff boundary", () => {
  it("does not create delegated domain records from MiAgentPage", () => {
    const forbiddenCreateEndpoints = [
      "/api/accounts",
      "/api/contacts",
      "/api/opportunities",
      "/api/interactions",
      "/api/quotations",
      "/api/proposals",
      "/api/commercial-development",
    ];

    for (const endpoint of forbiddenCreateEndpoints) {
      expect(miAgentSource).not.toContain(`api.post(\"${endpoint}\"`);
      expect(miAgentSource).not.toContain(`api.post('${endpoint}'`);
    }
    expect(miAgentSource).not.toMatch(
      /api\.post\(\s*`\/api\/opportunities\/\$\{[^}]+\}\/workspace\/actions/,
    );
    expect(miAgentSource).not.toMatch(
      /api\.post\(\s*`\/api\/opportunities\/\$\{[^}]+\}\/workspace\/actions\/\$\{/,
    );
  });

  it("only copies allowed fields into official forms", () => {
    const patch = buildCoachFormPatch(
      {
        payload: {
          kind: "create_account",
          payload: {
            name: "Acme",
            city: "Monterrey",
            accountTypeId: 3,
            unexpectedAdminFlag: true,
          },
        },
      },
      "accounts",
    );

    expect(patch).toEqual({
      name: "Acme",
      city: "Monterrey",
      accountTypeId: "3",
    });
  });
});
