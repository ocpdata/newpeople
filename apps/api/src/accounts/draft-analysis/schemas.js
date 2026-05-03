import { z } from "zod";

export const accountDraftAnalysisRequestSchema = z.object({
  draft: z.object({
    name: z.string().trim().min(2).max(180),
    accountTypeId: z.number().int().positive().optional().nullable(),
    registrationCode: z.string().trim().max(80).optional().default(""),
    phone: z.string().trim().max(40).optional().default(""),
    economicSectorId: z.number().int().positive().optional().nullable(),
    website: z.string().trim().max(300).optional().default(""),
    city: z.string().trim().max(120).optional().default(""),
    stateRegion: z.string().trim().max(120).optional().default(""),
    countryId: z.number().int().positive().optional().nullable(),
    companyDescription: z.string().trim().max(10000).optional().default(""),
    description: z.string().trim().max(10000).optional().default(""),
    addressLine: z.string().trim().max(255).optional().default(""),
    postalCode: z.string().trim().max(20).optional().default(""),
    ownerUserIds: z.array(z.number().int().positive()).optional().default([]),
  }),
  options: z
    .object({
      allowExternalFetch: z.boolean().optional(),
      allowAiSynthesis: z.boolean().optional(),
      allowWebSearchTool: z.boolean().optional(),
      allowExternalEnrichment: z.boolean().optional(),
    })
    .optional()
    .default({}),
});

export function normalizeAccountDraft(draft) {
  const companyDescription = String(
    draft?.companyDescription || draft?.description || "",
  ).trim();

  return {
    ...draft,
    companyDescription,
    description: companyDescription,
  };
}

export function normalizeDraftAnalysisOptions(options) {
  const rawOptions = options || {};

  return {
    allowExternalFetch:
      rawOptions.allowExternalFetch ??
      rawOptions.allowExternalEnrichment ??
      true,
    allowAiSynthesis: rawOptions.allowAiSynthesis ?? true,
    allowWebSearchTool: rawOptions.allowWebSearchTool ?? true,
  };
}
