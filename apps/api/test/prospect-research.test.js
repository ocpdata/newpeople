import { describe, expect, test } from "vitest";
import { buildStructuredResearchSchema } from "../src/structuredWebResearch.js";
import {
  applyExternalEvidencePolicy,
  attachRetrievedSourceExcerpt,
  buildProspectExternalQuery,
  buildProspectExternalTrackQueries,
  canonicalizeExternalSourceUrl,
  classifyExternalFindingObservation,
  deduplicateExternalFindings,
  keepFindingsWithKnownSources,
  keepItemsWithSourceEvidence,
  normalizeExternalFinding,
  normalizeExternalContact,
  normalizeExternalHypothesis,
  normalizeExternalSellerBrief,
  normalizeExternalTargetRole,
  matchesProspectCompanyName,
  deduplicateExternalContacts,
  deduplicateExternalHypotheses,
} from "../src/prospect-research/service.js";

describe("prospect external evidence policy", () => {
  test("matches abbreviated company names to full names without inner-token false positives", () => {
    expect(matchesProspectCompanyName("Raloy", "Raloy Lubricantes")).toBe(
      true,
    );
    expect(
      matchesProspectCompanyName("Raloy Lubricantes", "Raloy"),
    ).toBe(true);
    expect(matchesProspectCompanyName("Raloy", "Laboratorios Raloy")).toBe(
      false,
    );
    expect(matchesProspectCompanyName("Ralo", "Raloy Lubricantes")).toBe(
      false,
    );
  });

  test("builds strict structured schemas with every nested property required", () => {
    const format = buildStructuredResearchSchema("prospect_external_research", [
      {
        key: "contacts",
        type: "array",
        items: {
          type: "object",
          fields: [
            { key: "name", type: "string", example: "" },
            { key: "sourcePublishedAt", type: "string", example: "" },
          ],
        },
      },
    ]);

    expect(format.schema.properties.contacts.items.required).toEqual([
      "name",
      "sourcePublishedAt",
    ]);
    expect(
      format.schema.properties.contacts.items.properties.sourcePublishedAt,
    ).toEqual({ type: "string" });
  });

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

  test("canonicalizes tracking URLs and keeps one finding per public source", () => {
    const first = {
      title: "Hallazgo reciente",
      sourceReference: "https://www.example.com/news/?utm_source=mail#top",
    };
    const duplicate = {
      title: "El mismo hallazgo",
      sourceReference: "https://example.com/news/",
    };
    const other = {
      title: "Otra fuente",
      sourceReference: "https://example.com/reports/annual",
    };

    expect(canonicalizeExternalSourceUrl(first.sourceReference)).toBe(
      canonicalizeExternalSourceUrl(duplicate.sourceReference),
    );
    expect(deduplicateExternalFindings([first, duplicate, other])).toEqual([
      first,
      other,
    ]);
  });

  test("classifies refreshes without overwriting human-validated findings", () => {
    const existing = {
      title: "Proyecto anunciado",
      summary: "La empresa anunció un proyecto.",
      evidence_text: "Comunicado publicado en mayo.",
      status: "suggested",
    };
    const same = {
      title: existing.title,
      summary: existing.summary,
      evidenceText: existing.evidence_text,
    };
    const changed = {
      ...same,
      summary: "La empresa anunció una expansión del proyecto.",
    };

    expect(classifyExternalFindingObservation(null, same)).toBe("new");
    expect(classifyExternalFindingObservation(existing, same)).toBe(
      "unchanged",
    );
    expect(classifyExternalFindingObservation(existing, changed)).toBe(
      "updated",
    );
    expect(
      classifyExternalFindingObservation(
        { ...existing, status: "confirmed" },
        changed,
      ),
    ).toBe("updated");
  });

  test("only keeps findings attributed to URLs returned by the public search", () => {
    const verified = {
      title: "Fuente verificada",
      sourceReference:
        "https://www.example.com/press-release?utm_medium=search",
    };
    const fabricated = {
      title: "Fuente no consultada",
      sourceReference: "https://unrelated.example/article",
    };

    expect(
      keepFindingsWithKnownSources(
        [verified, fabricated],
        ["https://example.com/press-release"],
      ),
    ).toEqual([verified]);
  });

  test("refresh queries revisit previously researched topics", () => {
    const session = {
      companyName: "Empresa Demo",
      country: "Mexico",
      industry: "Tecnologia",
    };

    expect(buildProspectExternalQuery(session)).toContain(
      "proyectos tecnología noticias",
    );
    expect(
      buildProspectExternalQuery(session, [
        { title: "Proyecto de continuidad" },
        { title: "Modernización de centros de datos" },
      ]),
    ).toContain("actualización novedades Proyecto de continuidad");
  });

  test("builds focused queries for the four seller-entry research tracks", () => {
    const tracks = buildProspectExternalTrackQueries(
      {
        companyName: "Empresa Demo",
        country: "Mexico",
        industry: "Tecnologia",
      },
      [{ title: "Proyecto de continuidad" }],
    );

    expect(tracks.map((track) => track.key)).toEqual([
      "company_profile",
      "business_signals",
      "technology_signals",
      "public_people",
    ]);
    expect(tracks.every((track) => track.query.includes("Empresa Demo"))).toBe(
      true,
    );
    expect(tracks.every((track) => track.query.includes("Mexico"))).toBe(true);
    expect(
      tracks.every((track) => track.query.includes("Proyecto de continuidad")),
    ).toBe(true);
    expect(tracks[2].query).toContain("Kubernetes");
    expect(tracks[3].query).toContain("CIO CTO CISO");
  });

  test("only accepts named public contacts with a role, URL, and evidence", () => {
    expect(
      normalizeExternalContact({
        name: "María García",
        roleTitle: "CTO",
        area: "Tecnología",
        evidenceText: "María García fue nombrada CTO en mayo.",
        sourceUrl: "https://example.com/leadership",
      }),
    ).toMatchObject({
      name: "María García",
      roleTitle: "CTO",
      sourceType: "public_source",
      status: "suggested",
    });
    expect(
      normalizeExternalContact({
        name: "Persona inventada",
        roleTitle: "CTO",
        sourceUrl: "https://example.com/leadership",
        evidenceText: "",
      }),
    ).toBeNull();
    expect(
      normalizeExternalContact({
        name: "Persona inventada",
        roleTitle: "CTO",
        sourceUrl: "javascript:alert(1)",
        evidenceText: "Evidencia",
      }),
    ).toBeNull();
  });

  test("requires cited evidence for opportunity hypotheses and deduplicates by source", () => {
    const hypothesis = normalizeExternalHypothesis({
      title: "Validar modernización de aplicaciones",
      businessChallenge: "La empresa anunció una modernización.",
      technologyArea: "Entrega de aplicaciones",
      validationQuestion: "¿Qué aplicaciones son críticas?",
      evidenceText: "La compañía anunció el programa en su sitio.",
      sourceUrl: "https://example.com/news/modernization",
    });
    expect(hypothesis).toMatchObject({
      status: "suggested",
      metadata: {
        externalResearch: true,
        sourceReference: "https://example.com/news/modernization",
      },
    });
    expect(
      normalizeExternalHypothesis({
        title: "Oportunidad inventada",
        sourceUrl: "https://example.com/news",
      }),
    ).toBeNull();

    const publicContact = normalizeExternalContact({
      name: "María García",
      roleTitle: "CTO",
      evidenceText: "Nombramiento publicado.",
      sourceUrl: "https://example.com/leadership",
    });
    expect(
      deduplicateExternalContacts([
        publicContact,
        { ...publicContact },
        { ...publicContact, sourceReference: "https://example.com/other" },
      ]),
    ).toHaveLength(2);
    expect(
      deduplicateExternalHypotheses([
        hypothesis,
        { ...hypothesis },
        {
          ...hypothesis,
          metadata: {
            ...hypothesis.metadata,
            sourceReference: "https://example.com/other",
          },
        },
      ]),
    ).toHaveLength(2);
  });

  test("accepts paraphrases with a known URL, attaches the original excerpt, and still verifies contact identity", () => {
    const sources = [
      {
        url: "https://example.com/leadership",
        title: "Leadership team",
        content:
          "María García was appointed Chief Technology Officer in May 2026.",
      },
    ];
    const verifiedPerson = {
      name: "María García",
      roleTitle: "Chief Technology Officer",
      sourceReference: sources[0].url,
      evidenceText:
        "La fuente presenta a María García como nueva directora de tecnología.",
    };
    const inventedPerson = {
      ...verifiedPerson,
      name: "Carlos Inventado",
    };
    const paraphrasedFinding = {
      sourceReference: sources[0].url,
      evidenceText:
        "La nota informa el nombramiento reciente de una nueva CTO.",
    };

    expect(keepItemsWithSourceEvidence([verifiedPerson], sources)).toEqual([
      verifiedPerson,
    ]);
    expect(keepItemsWithSourceEvidence([inventedPerson], sources)).toEqual([]);
    expect(keepItemsWithSourceEvidence([paraphrasedFinding], sources)).toEqual([
      paraphrasedFinding,
    ]);
    expect(
      attachRetrievedSourceExcerpt(paraphrasedFinding, sources).metadata
        .sourceExcerpt,
    ).toBe(sources[0].content);
    expect(
      keepItemsWithSourceEvidence(
        [{ ...paraphrasedFinding, sourceReference: "https://other.example" }],
        sources,
      ),
    ).toEqual([]);
  });

  test("keeps seller entry guidance grounded in a verified finding", () => {
    const verifiedFinding = {
      title: "Proyecto anunciado",
      sourceReference: "https://example.com/project",
      metadata: { researchTracks: ["business_signals"] },
    };
    expect(
      normalizeExternalTargetRole(
        {
          roleTitle: "Responsable de infraestructura",
          area: "Tecnología",
          rationale: "Puede validar el alcance técnico publicado.",
          validationQuestion: "¿Quién lidera esta plataforma?",
          basisFindingTitle: "Proyecto anunciado",
        },
        [verifiedFinding],
      ),
    ).toMatchObject({
      roleTitle: "Responsable de infraestructura",
      sourceReference: "https://example.com/project",
      researchTracks: ["business_signals"],
    });
    expect(
      normalizeExternalTargetRole(
        {
          roleTitle: "CTO",
          rationale: "Racional",
          validationQuestion: "Pregunta",
          basisFindingTitle: "Hallazgo inexistente",
        },
        [verifiedFinding],
      ),
    ).toBeNull();

    expect(
      normalizeExternalSellerBrief(
        {
          whyNow: "La fuente anuncia un proyecto reciente.",
          recommendedOpening: "¿Cómo están abordando ese proyecto?",
          discoveryQuestions: ["¿Qué resultado esperan?"],
          sourceUrls: ["https://example.com/project", "https://fake.example/"],
        },
        [verifiedFinding],
      ),
    ).toEqual({
      whyNow: "La fuente anuncia un proyecto reciente.",
      recommendedOpening: "¿Cómo están abordando ese proyecto?",
      discoveryQuestions: ["¿Qué resultado esperan?"],
      sourceReferences: ["https://example.com/project"],
    });
  });
});
