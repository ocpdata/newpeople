import {
  ACCOUNT_DRAFT_ANALYSIS_SCHEMA_FIELDS,
  accountCompanyResearchProfile,
  accountLocationResearchProfile,
} from "../../aiResearchProfiles.js";

const SPANISH_NAME_STOPWORDS = new Set([
  "a",
  "al",
  "de",
  "del",
  "el",
  "la",
  "las",
  "los",
  "y",
  "e",
]);

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildNameSignals(name) {
  const normalizedName = normalizeText(name);
  const tokens = normalizedName.split(" ").filter(Boolean);
  const significantTokens = tokens.filter(
    (token) => !SPANISH_NAME_STOPWORDS.has(token),
  );

  return {
    originalName: String(name || "").trim(),
    normalizedName,
    coreName: significantTokens.join(" "),
    significantTokens,
  };
}

const accountAnalysisResearchProfile = {
  schemaName: "account_draft_analysis_research",
  systemPrompt:
    "Investiga informacion publica verificable sobre la empresa y responde solo con JSON valido. Prioriza descripcion de la empresa, sitio web oficial, direccion, ciudad, estado o region, codigo postal, telefono y registro fiscal cuando existan. Cuando lleguen duplicateWarnings o duplicateCandidates, evalua si el borrador parece corresponder a la misma organizacion que alguna cuenta existente y completa duplicateReview con un veredicto prudente. Para nombres comerciales en espanol, trata articulos y conectores como los, las, la, el, de, del, y como ruido frecuente; prioriza el nombre base y los tokens significativos al comparar variantes como Hospital Angeles y Hospital Los Angeles. No inventes hechos; si no hay evidencia clara, deja cadenas vacias, usa confianza baja y agrega warnings breves.",
  fields: ACCOUNT_DRAFT_ANALYSIS_SCHEMA_FIELDS,
  buildSubject: ({ draft }) => ({
    companyName: draft.name,
  }),
  buildContext: ({
    draft,
    catalogContext,
    duplicateWarnings,
    duplicateCandidates,
    preferredWebsite,
    externalContext,
  }) => ({
    country: catalogContext.countryName,
    city: draft.city,
    stateRegion: draft.stateRegion,
    website: draft.website,
    preferredWebsite,
    accountType: catalogContext.accountTypeName,
    sector: catalogContext.economicSectorName,
    draftNameSignals: buildNameSignals(draft.name),
    duplicateWarnings: duplicateWarnings.map((warning) => ({
      accountName: warning.accountName,
      nameSignals: buildNameSignals(warning.accountName),
      website: warning.website,
      registrationCode: warning.registrationCode,
      severity: warning.severity,
      matchReason: warning.matchReason,
    })),
    duplicateCandidates: (duplicateCandidates || [])
      .slice(0, 25)
      .map((candidate) => ({
        accountName: candidate.name || "",
        nameSignals: buildNameSignals(candidate.name),
        website: candidate.website || "",
        registrationCode: candidate.registration_code || "",
        country: candidate.country_name || "",
      })),
    discoveredContext: {
      sourceLabel: externalContext?.sourceLabel || "",
      summary: externalContext?.summary || "",
      website: externalContext?.website || "",
      title: externalContext?.title || "",
      metaDescription: externalContext?.metaDescription || "",
      bodyText: externalContext?.bodyText || "",
    },
  }),
  buildCurrentValues: ({ currentValues }) => currentValues,
};

export const accountDraftAnalysisResearchProfile = {
  company: accountCompanyResearchProfile,
  location: accountLocationResearchProfile,
  analysis: accountAnalysisResearchProfile,
};
