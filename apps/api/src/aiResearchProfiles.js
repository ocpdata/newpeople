export const AI_CONFIDENCE_FIELD = {
  type: "enum",
  enum: ["high", "medium", "low"],
  example: "high|medium|low",
};

export const CONTACT_DATA_RESEARCH_FIELDS = [
  { key: "addressLine", type: "string" },
  { key: "city", type: "string" },
  { key: "stateRegion", type: "string" },
  { key: "postalCode", type: "string" },
  { key: "phone", type: "string" },
  { key: "confidence", ...AI_CONFIDENCE_FIELD },
  { key: "reason", type: "string" },
];

export const ACCOUNT_COMPANY_RESEARCH_FIELDS = [
  { key: "companySummary", type: "string" },
  { key: "suggestedWebsite", type: "string" },
  { key: "websiteConfidence", ...AI_CONFIDENCE_FIELD },
  { key: "websiteReason", type: "string" },
  {
    key: "suggestedContactData",
    type: "object",
    fields: CONTACT_DATA_RESEARCH_FIELDS,
  },
  { key: "suggestedRegistrationCode", type: "string" },
  { key: "registrationConfidence", ...AI_CONFIDENCE_FIELD },
  { key: "registrationReason", type: "string" },
  {
    key: "warnings",
    type: "array",
    items: { type: "string" },
  },
];

export const ACCOUNT_LOCATION_RESEARCH_FIELDS = [
  {
    key: "suggestedContactData",
    type: "object",
    fields: CONTACT_DATA_RESEARCH_FIELDS,
  },
  {
    key: "warnings",
    type: "array",
    items: { type: "string" },
  },
];

export const ACCOUNT_DRAFT_ANALYSIS_SCHEMA_FIELDS = [
  { key: "suggestedAdministrativeDescription", type: "string" },
  { key: "suggestedCommercialDescription", type: "string" },
  { key: "suggestedWebsite", type: "string" },
  { key: "websiteConfidence", ...AI_CONFIDENCE_FIELD },
  { key: "websiteReason", type: "string" },
  {
    key: "suggestedContactData",
    type: "object",
    fields: CONTACT_DATA_RESEARCH_FIELDS,
  },
  { key: "suggestedRegistrationCode", type: "string" },
  { key: "registrationConfidence", ...AI_CONFIDENCE_FIELD },
  { key: "registrationReason", type: "string" },
  {
    key: "suggestedImprovements",
    type: "array",
    items: { type: "string" },
  },
  {
    key: "nextRecommendedStep",
    type: "object",
    fields: [
      { key: "action", type: "string" },
      { key: "reason", type: "string" },
    ],
  },
  { key: "confidence", ...AI_CONFIDENCE_FIELD },
  {
    key: "warnings",
    type: "array",
    items: { type: "string" },
  },
];

export const accountCompanyResearchProfile = {
  schemaName: "company_public_research",
  systemPrompt:
    "Busca informacion publica sobre la empresa y responde con JSON compacto. No inventes datos no sustentados. Si no encuentras evidencia clara, deja cadenas vacias y usa confianza baja.",
  fields: ACCOUNT_COMPANY_RESEARCH_FIELDS,
  buildSubject: ({ draft }) => ({
    companyName: draft.name,
  }),
  buildContext: ({ draft, catalogContext }) => ({
    country: catalogContext.countryName,
    city: draft.city,
    stateRegion: draft.stateRegion,
    website: draft.website,
    sector: catalogContext.economicSectorName,
  }),
  buildCurrentValues: () => ({}),
};

export const accountLocationResearchProfile = {
  schemaName: "company_location_research",
  systemPrompt:
    "Busca solo datos publicos verificables de ubicacion y contacto de la empresa. Prioriza direccion, ciudad, estado o region, codigo postal y telefono. Responde solo con JSON valido. No inventes datos; si no hay evidencia clara, devuelve cadenas vacias y confianza baja.",
  fields: ACCOUNT_LOCATION_RESEARCH_FIELDS,
  buildSubject: ({ draft }) => ({
    companyName: draft.name,
  }),
  buildContext: ({ draft, catalogContext, preferredWebsite }) => ({
    country: catalogContext.countryName,
    city: draft.city,
    stateRegion: draft.stateRegion,
    preferredWebsite,
  }),
  buildCurrentValues: ({ currentContactData }) => ({
    suggestedContactData: currentContactData,
  }),
};