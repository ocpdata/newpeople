import { describe, expect, test } from "vitest";
import {
  applyExternalEvidencePolicy,
  normalizeExternalFinding,
} from "../src/prospect-research/service.js";

describe("prospect external evidence policy", () => {
  test("omits public findings without a valid URL and substantive evidence", () => {
    const accepted = normalizeExternalFinding(
      {
        title: "Proyecto anunciado",
        sourceUrl: "https://news.example/project",
        evidenceText: "La compañía anunció el proyecto en abril.",
      },
      0,
    );
    const missingEvidence = normalizeExternalFinding(
      {
        title: "Afirmación sin evidencia",
        sourceUrl: "https://news.example/claim",
      },
      1,
    );
    const malformedUrl = normalizeExternalFinding(
      {
        title: "Fuente no web",
        sourceUrl: "javascript:alert(1)",
        evidenceText: "Fragmento citado.",
      },
      2,
    );

    expect(missingEvidence.evidenceText).toBe("");
    expect(malformedUrl.sourceReference).toBe("");
    expect(
      applyExternalEvidencePolicy(
        [accepted, missingEvidence, malformedUrl],
        true,
      ),
    ).toEqual({ findings: [accepted], omittedCount: 2 });
  });

  test("keeps policy-disabled findings while still rejecting unsafe links", () => {
    const finding = normalizeExternalFinding(
      { title: "Señal sin referencia", sourceUrl: "javascript:alert(1)" },
      0,
    );
    expect(applyExternalEvidencePolicy([finding], false)).toEqual({
      findings: [finding],
      omittedCount: 0,
    });
    expect(finding.sourceReference).toBe("");
  });
});
