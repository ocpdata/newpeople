import {
  ACCOUNT_DRAFT_ANALYSIS_SCHEMA_FIELDS,
  accountCompanyResearchProfile,
  accountLocationResearchProfile,
} from "../../aiResearchProfiles.js";

const accountAnalysisResearchProfile = {
  schemaName: "account_draft_analysis_research",
  systemPrompt:
    "Investiga informacion publica verificable sobre la empresa y responde solo con JSON valido. Prioriza descripcion de la empresa, sitio web oficial, direccion, ciudad, estado o region, codigo postal, telefono y registro fiscal cuando existan. No inventes hechos; si no hay evidencia clara, deja cadenas vacias, usa confianza baja y agrega warnings breves.",
  fields: ACCOUNT_DRAFT_ANALYSIS_SCHEMA_FIELDS,
  buildSubject: ({ draft }) => ({
    companyName: draft.name,
  }),
  buildContext: ({
    draft,
    catalogContext,
    duplicateWarnings,
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
    duplicateWarnings: duplicateWarnings.map((warning) => ({
      accountName: warning.accountName,
      website: warning.website,
      registrationCode: warning.registrationCode,
      severity: warning.severity,
      matchReason: warning.matchReason,
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
