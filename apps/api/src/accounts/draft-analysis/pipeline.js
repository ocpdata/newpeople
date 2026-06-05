import {
  buildDataQualityFindings,
  buildDescriptionsFromExternalContext,
  buildDuplicateReview,
  buildDuplicateWarnings,
  buildEvidence,
  buildNextRecommendedStep,
  buildOpenAiProviderWarning,
  buildRegistrationAssistance,
  buildSuggestedCompanyDescription,
  buildSuggestedContactData,
  buildSuggestedEconomicSector,
  buildSuggestedImprovements,
  buildWebsiteFetchCandidates,
  buildWebsiteSuggestion,
  classifyOpenAiError,
  discoverPublicContactDataByName,
  discoverPublicRegistrationByName,
  discoverPublicWebsiteByName,
  fetchWebsiteContext,
  getCatalogContext,
  getDuplicateCandidates,
  getEconomicSectorOptions,
  hasLocationGaps,
  hasMeaningfulContactData,
  mergeContactData,
  searchPublicCompanyInfo,
  searchPublicCompanyLocationInfo,
  summarizeAssessment,
} from "./core.js";
import {
  normalizeAccountDraft,
  normalizeDraftAnalysisOptions,
} from "./schemas.js";
import { config } from "../../config.js";
import { buildAccountDraftAnalysisExecutionPlan } from "./async.js";
import { runStructuredAccountDraftAnalysis } from "./providers/structuredAccountDraftAnalysisProvider.js";

function getStageTimer(metrics, stageName) {
  const startedAt = Date.now();

  return {
    finish(status, detail = {}) {
      metrics.push({
        stage: stageName,
        status,
        durationMs: Date.now() - startedAt,
        ...detail,
      });
    },
  };
}

function canUseStructuredResearch(options) {
  return Boolean(
    options.allowExternalFetch &&
    options.allowWebSearchTool &&
    config.openai.apiKey &&
    config.openai.enableWebSearch,
  );
}

function canUseStructuredDuplicateReview() {
  return Boolean(config.openai.apiKey && config.openai.enableWebSearch);
}

function buildDuplicateReviewCurrentValues({ draft, duplicateReview }) {
  return {
    suggestedCompanyDescription: String(draft.companyDescription || "").trim(),
    suggestedWebsite: String(draft.website || "").trim(),
    websiteConfidence: draft.website ? "high" : "low",
    websiteReason: "",
    suggestedContactData: {
      addressLine: String(draft.addressLine || "").trim(),
      city: String(draft.city || "").trim(),
      stateRegion: String(draft.stateRegion || "").trim(),
      postalCode: String(draft.postalCode || "").trim(),
      phone: String(draft.phone || "").trim(),
      confidence: "low",
      reason: "",
    },
    suggestedRegistrationCode: String(draft.registrationCode || "").trim(),
    registrationConfidence: draft.registrationCode ? "high" : "low",
    registrationReason: "",
    suggestedImprovements: [],
    nextRecommendedStep: {
      action: "",
      reason: "",
    },
    duplicateReview,
    confidence: duplicateReview.confidence || "medium",
    warnings: [],
  };
}

function buildInitialAnalysisState({
  draft,
  duplicateWarnings,
  dataQualityFindings,
  catalogContext,
  fallbackWebsiteSuggestion,
  fallbackRegistrationAssistance,
}) {
  const fallbackCompanyDescription = buildSuggestedCompanyDescription({
    draft,
    catalogContext,
  });

  return {
    externalContext: null,
    usedAiGeneration: false,
    usedExternalEnrichment: false,
    openAiProviderIssue: "",
    warnings: [],
    confidence: duplicateWarnings.some((warning) => warning.severity === "high")
      ? "high"
      : dataQualityFindings.some((finding) => finding.severity === "high")
        ? "medium"
        : "high",
    suggestedCompanyDescription: {
      text: fallbackCompanyDescription,
      sourceType: "crm_internal",
    },
    suggestedWebsite: fallbackWebsiteSuggestion,
    suggestedContactData: buildSuggestedContactData({ draft }),
    registrationAssistance: fallbackRegistrationAssistance,
    suggestedImprovements: buildSuggestedImprovements({
      draft,
      duplicateWarnings,
      dataQualityFindings,
    }),
    duplicateReview: buildDuplicateReview({ duplicateWarnings }),
    nextRecommendedStep: buildNextRecommendedStep({
      draft,
      duplicateWarnings,
      dataQualityFindings,
    }),
  };
}

function applyExternalContextToState({ draft, state, externalContext }) {
  if (!externalContext) return;

  state.externalContext = externalContext;
  state.usedExternalEnrichment = true;

  const externalCompanyDescription = buildDescriptionsFromExternalContext({
    draft,
    externalContext,
  });

  if (externalCompanyDescription) {
    state.suggestedCompanyDescription = {
      text: externalCompanyDescription,
      sourceType: "external_public_source",
    };
  }

  if (
    !draft.website &&
    String(externalContext.website || "").trim() &&
    !String(state.suggestedWebsite.value || "").trim()
  ) {
    state.suggestedWebsite = {
      value: externalContext.website,
      confidence: "medium",
      sourceType: "external_public_source",
      reason:
        "Se encontro un sitio publico accesible que podria corresponder a la empresa.",
      canAutoApply: true,
    };
  }

  if (hasMeaningfulContactData(externalContext.contactData)) {
    state.suggestedContactData = buildSuggestedContactData({
      draft,
      contactData: mergeContactData(
        externalContext.contactData,
        state.suggestedContactData,
      ),
      sourceType: "external_public_source",
      reason:
        "Se identificaron datos de contacto publicos en referencias externas asociadas a la cuenta.",
      confidence: "medium",
    });
  }
}

async function runDiscoveryStage({
  draft,
  options,
  catalogContext,
  fallbackWebsiteSuggestion,
  state,
  metrics,
  aiUsageContext,
}) {
  const timer = getStageTimer(metrics, "discovery");

  if (!options.allowExternalFetch) {
    timer.finish("skipped", { reason: "external_fetch_disabled" });
    return state;
  }

  try {
    const websiteCandidates = buildWebsiteFetchCandidates({
      draft,
      fallbackWebsiteSuggestion,
    });

    for (const websiteCandidate of websiteCandidates) {
      const websiteContext = await fetchWebsiteContext(websiteCandidate);
      if (!websiteContext) continue;

      applyExternalContextToState({
        draft,
        state,
        externalContext: {
          sourceType: "external_public_source",
          sourceLabel: "website_fetch",
          ...websiteContext,
        },
      });
      break;
    }

    if (!state.externalContext) {
      const publicSearchResult = await discoverPublicWebsiteByName({
        draft,
        catalogContext,
        aiUsageContext,
      });

      if (publicSearchResult?.website) {
        state.suggestedWebsite = {
          value: publicSearchResult.website,
          confidence: publicSearchResult.confidence || "medium",
          sourceType: "external_public_source",
          reason: publicSearchResult.reason,
          canAutoApply: true,
        };

        applyExternalContextToState({
          draft,
          state,
          externalContext: {
            sourceType: "external_public_source",
            sourceLabel: "public_search",
            website: publicSearchResult.website,
            summary: publicSearchResult.summary,
            title: publicSearchResult.title,
            metaDescription: publicSearchResult.metaDescription,
            bodyText: publicSearchResult.bodyText,
            contactData: publicSearchResult.contactData,
          },
        });
      }
    }

    if (!String(state.registrationAssistance.value || "").trim()) {
      const registrationResult = await discoverPublicRegistrationByName({
        draft,
        catalogContext,
        preferredWebsite: state.suggestedWebsite.value,
        aiUsageContext,
      });

      if (registrationResult?.value) {
        state.registrationAssistance = {
          status: "candidate",
          value: registrationResult.value,
          confidence: registrationResult.confidence || "medium",
          sourceType: "external_public_source",
          reason: registrationResult.reason,
          requiresManualValidation: true,
          canAutoApply: true,
        };
        state.usedExternalEnrichment = true;
      }
    }

    if (
      hasLocationGaps(state.suggestedContactData) ||
      !state.suggestedContactData.phone
    ) {
      const publicContactResult = await discoverPublicContactDataByName({
        draft,
        catalogContext,
        preferredWebsite: state.suggestedWebsite.value,
        aiUsageContext,
      });

      if (hasMeaningfulContactData(publicContactResult?.contactData)) {
        state.suggestedContactData = buildSuggestedContactData({
          draft,
          contactData: mergeContactData(
            publicContactResult.contactData,
            state.suggestedContactData,
          ),
          sourceType: "external_public_source",
          reason: publicContactResult.reason,
          confidence:
            publicContactResult.confidence ||
            state.suggestedContactData.confidence,
        });
        state.usedExternalEnrichment = true;
      }
    }

    timer.finish("completed", {
      usedExternalEnrichment: state.usedExternalEnrichment,
      source: state.externalContext?.sourceLabel || "heuristic_only",
    });
    return state;
  } catch (error) {
    timer.finish("failed", {
      error: String(error?.message || error || "unknown_error"),
    });
    return state;
  }
}

function buildStructuredCurrentValues(state) {
  return {
    suggestedCompanyDescription: state.suggestedCompanyDescription.text || "",
    suggestedWebsite: state.suggestedWebsite.value || "",
    websiteConfidence: state.suggestedWebsite.confidence || "low",
    websiteReason: state.suggestedWebsite.reason || "",
    suggestedContactData: {
      addressLine: state.suggestedContactData.addressLine || "",
      city: state.suggestedContactData.city || "",
      stateRegion: state.suggestedContactData.stateRegion || "",
      postalCode: state.suggestedContactData.postalCode || "",
      phone: state.suggestedContactData.phone || "",
      confidence: state.suggestedContactData.confidence || "low",
      reason: state.suggestedContactData.reason || "",
    },
    suggestedRegistrationCode: state.registrationAssistance.value || "",
    registrationConfidence: state.registrationAssistance.confidence || "low",
    registrationReason: state.registrationAssistance.reason || "",
    suggestedImprovements: state.suggestedImprovements || [],
    nextRecommendedStep: state.nextRecommendedStep || {
      action: "",
      reason: "",
    },
    duplicateReview: state.duplicateReview || {
      verdict: "inconclusive",
      summary: "",
      recommendation: "",
      confidence: "low",
    },
    confidence: state.confidence || "medium",
    warnings: state.warnings || [],
  };
}

async function runStructuredExtractionStage({
  draft,
  options,
  catalogContext,
  duplicateWarnings,
  state,
  metrics,
  aiUsageContext,
}) {
  const timer = getStageTimer(metrics, "structured_extraction");

  if (!canUseStructuredResearch(options)) {
    timer.finish("skipped", { reason: "structured_research_unavailable" });
    return state;
  }

  try {
    if (
      hasLocationGaps(state.suggestedContactData) ||
      !state.suggestedContactData.phone
    ) {
      const locationSearchResult = await searchPublicCompanyLocationInfo({
        draft,
        catalogContext,
        preferredWebsite: state.suggestedWebsite.value,
        currentContactData: state.suggestedContactData,
        aiUsageContext,
      });

      if (
        hasMeaningfulContactData(locationSearchResult?.suggestedContactData)
      ) {
        state.suggestedContactData = buildSuggestedContactData({
          draft,
          contactData: mergeContactData(
            locationSearchResult.suggestedContactData,
            state.suggestedContactData,
          ),
          sourceType: "external_public_source",
          reason:
            locationSearchResult.suggestedContactData.reason ||
            "Se completaron datos de ubicacion mediante una busqueda publica asistida.",
          confidence:
            locationSearchResult.suggestedContactData.confidence || "medium",
        });

        if (!state.externalContext) {
          state.externalContext = {
            sourceType: "external_public_source",
            sourceLabel: "openai_web_search",
            website: state.suggestedWebsite.value,
          };
        }
        state.usedExternalEnrichment = true;
      }

      if (Array.isArray(locationSearchResult?.warnings)) {
        state.warnings.push(...locationSearchResult.warnings.filter(Boolean));
      }
    }

    if (
      !state.externalContext ||
      !String(state.suggestedWebsite.value || "").trim()
    ) {
      const webSearchResult = await searchPublicCompanyInfo({
        draft,
        catalogContext,
        aiUsageContext,
      });

      if (webSearchResult) {
        state.externalContext = {
          ...(state.externalContext || {}),
          sourceType: "external_public_source",
          sourceLabel: "openai_web_search",
          summary: String(webSearchResult.companySummary || "").trim(),
          website:
            String(webSearchResult.suggestedWebsite || "").trim() ||
            state.suggestedWebsite.value,
        };
        state.usedExternalEnrichment = Boolean(
          state.externalContext.summary || state.externalContext.website,
        );

        if (String(state.externalContext.summary || "").trim()) {
          const externalCompanyDescription =
            buildDescriptionsFromExternalContext({
              draft,
              externalContext: state.externalContext,
            });
          if (externalCompanyDescription) {
            state.suggestedCompanyDescription = {
              text: externalCompanyDescription,
              sourceType: "external_public_source",
            };
          }
        }

        if (String(state.externalContext.website || "").trim()) {
          state.suggestedWebsite = {
            value: state.externalContext.website,
            confidence: webSearchResult.websiteConfidence || "medium",
            sourceType: "external_public_source",
            reason:
              webSearchResult.websiteReason ||
              "La sugerencia de sitio web proviene de una busqueda publica asistida.",
            canAutoApply: true,
          };
        }

        if (hasMeaningfulContactData(webSearchResult.suggestedContactData)) {
          state.suggestedContactData = buildSuggestedContactData({
            draft,
            contactData: mergeContactData(
              webSearchResult.suggestedContactData,
              state.suggestedContactData,
            ),
            sourceType: "external_public_source",
            reason:
              webSearchResult.suggestedContactData.reason ||
              "Los datos de contacto sugeridos provienen de referencias publicas y requieren validacion manual.",
            confidence:
              webSearchResult.suggestedContactData.confidence || "medium",
          });
        }

        if (String(webSearchResult.suggestedRegistrationCode || "").trim()) {
          state.registrationAssistance = {
            status: "candidate",
            value: String(
              webSearchResult.suggestedRegistrationCode || "",
            ).trim(),
            confidence: webSearchResult.registrationConfidence || "medium",
            sourceType: "external_public_source",
            reason:
              webSearchResult.registrationReason ||
              "El registro sugerido proviene de una referencia publica y requiere validacion manual.",
            requiresManualValidation: true,
            canAutoApply: true,
          };
        }

        if (Array.isArray(webSearchResult.warnings)) {
          state.warnings.push(...webSearchResult.warnings.filter(Boolean));
        }
      }
    }

    const structuredResult = await runStructuredAccountDraftAnalysis({
      draft,
      catalogContext,
      duplicateWarnings,
      preferredWebsite: state.suggestedWebsite.value,
      externalContext: state.externalContext,
      currentValues: buildStructuredCurrentValues(state),
      aiUsageContext,
    });

    if (!structuredResult) {
      timer.finish("skipped", { reason: "empty_structured_result" });
      return state;
    }

    state.usedAiGeneration = true;
    state.usedExternalEnrichment = true;
    state.confidence = structuredResult.confidence || state.confidence;

    if (String(structuredResult.suggestedCompanyDescription || "").trim()) {
      state.suggestedCompanyDescription = {
        text: String(structuredResult.suggestedCompanyDescription || "").trim(),
        sourceType: "external_public_source",
      };
      state.externalContext = {
        ...(state.externalContext || {}),
        sourceType: "external_public_source",
        sourceLabel: "structured_account_research",
        website:
          String(structuredResult.suggestedWebsite || "").trim() ||
          state.suggestedWebsite.value,
        summary: String(
          structuredResult.suggestedCompanyDescription || "",
        ).trim(),
      };
    }

    if (String(structuredResult.suggestedWebsite || "").trim()) {
      state.suggestedWebsite = {
        value: String(structuredResult.suggestedWebsite || "").trim(),
        confidence: structuredResult.websiteConfidence || "medium",
        sourceType: "external_public_source",
        reason:
          structuredResult.websiteReason ||
          "La sugerencia de sitio web proviene de una investigacion estructurada con evidencia publica.",
        canAutoApply: true,
      };
    }

    if (hasMeaningfulContactData(structuredResult.suggestedContactData)) {
      state.suggestedContactData = buildSuggestedContactData({
        draft,
        contactData: mergeContactData(
          structuredResult.suggestedContactData,
          state.suggestedContactData,
        ),
        sourceType: "external_public_source",
        reason:
          structuredResult.suggestedContactData.reason ||
          "Los datos de contacto provienen de una investigacion estructurada con evidencia publica.",
        confidence:
          structuredResult.suggestedContactData.confidence || "medium",
      });
    }

    if (String(structuredResult.suggestedRegistrationCode || "").trim()) {
      state.registrationAssistance = {
        status: "candidate",
        value: String(structuredResult.suggestedRegistrationCode || "").trim(),
        confidence: structuredResult.registrationConfidence || "medium",
        sourceType: "external_public_source",
        reason:
          structuredResult.registrationReason ||
          "El registro sugerido proviene de una investigacion estructurada con evidencia publica.",
        requiresManualValidation: true,
        canAutoApply: true,
      };
    }

    if (
      Array.isArray(structuredResult.suggestedImprovements) &&
      structuredResult.suggestedImprovements.length > 0
    ) {
      state.suggestedImprovements = structuredResult.suggestedImprovements;
    }

    if (structuredResult.nextRecommendedStep?.action) {
      state.nextRecommendedStep = structuredResult.nextRecommendedStep;
    }

    if (structuredResult.duplicateReview?.verdict) {
      state.duplicateReview = {
        verdict: structuredResult.duplicateReview.verdict,
        summary: structuredResult.duplicateReview.summary || "",
        recommendation: structuredResult.duplicateReview.recommendation || "",
        confidence: structuredResult.duplicateReview.confidence || "medium",
      };
    }

    if (Array.isArray(structuredResult.warnings)) {
      state.warnings.push(...structuredResult.warnings.filter(Boolean));
    }

    timer.finish("completed", {
      provider: "structured_web_research",
      usedAiGeneration: state.usedAiGeneration,
    });
    return state;
  } catch (error) {
    const errorKind = classifyOpenAiError(error);

    if (errorKind === "quota" || errorKind === "auth") {
      state.openAiProviderIssue = errorKind;
    }

    state.warnings.push(buildOpenAiProviderWarning(errorKind));
    timer.finish("failed", {
      errorKind,
      error: String(error?.message || error || "unknown_error"),
    });
    return state;
  }
}

function buildPipelineResponse({
  draft,
  duplicateWarnings,
  dataQualityFindings,
  catalogContext,
  economicSectorOptions,
  overallAssessment,
  state,
  executionPlan,
  metrics,
}) {
  if (
    !state.openAiProviderIssue &&
    !state.usedExternalEnrichment &&
    !state.usedAiGeneration
  ) {
    state.warnings.push(
      "No fue posible obtener informacion publica util para esta cuenta; el analisis se baso en datos internos.",
    );
  }

  return {
    interactionId: crypto.randomUUID(),
    overallAssessment,
    duplicateWarnings,
    dataQualityFindings,
    suggestedCompanyDescription: state.suggestedCompanyDescription,
    suggestedWebsite: state.suggestedWebsite,
    suggestedContactData: state.suggestedContactData,
    suggestedEconomicSector: buildSuggestedEconomicSector({
      draft,
      economicSectorOptions,
      externalContext: state.externalContext,
      suggestedCompanyDescription: state.suggestedCompanyDescription,
    }),
    registrationAssistance: state.registrationAssistance,
    suggestedImprovements: state.suggestedImprovements,
    duplicateReview: state.duplicateReview,
    nextRecommendedStep: state.nextRecommendedStep,
    evidence: buildEvidence({
      draft,
      duplicateWarnings,
      catalogContext,
      usedExternalEnrichment: state.usedExternalEnrichment,
      externalContext: state.externalContext,
    }),
    confidence: state.confidence,
    warnings: Array.from(new Set(state.warnings.filter(Boolean))),
    meta: {
      usedAiGeneration: state.usedAiGeneration,
      usedExternalEnrichment: state.usedExternalEnrichment,
      provider: state.usedAiGeneration
        ? "structured_web_research"
        : "heuristic",
      executionPlan,
      pipeline: {
        stages: metrics,
      },
    },
  };
}

export async function runAccountDraftAnalysisPipeline({
  draft,
  options,
  user,
  aiUsageContext = null,
}) {
  const normalizedDraft = normalizeAccountDraft(draft);
  const normalizedOptions = normalizeDraftAnalysisOptions(options);
  const supportsStructuredResearch =
    canUseStructuredResearch(normalizedOptions);
  const executionPlan = buildAccountDraftAnalysisExecutionPlan({
    options: normalizedOptions,
    supportsStructuredResearch,
  });

  const metrics = [];
  const contextTimer = getStageTimer(metrics, "context");
  const [catalogContext, economicSectorOptions] = await Promise.all([
    getCatalogContext(normalizedDraft),
    getEconomicSectorOptions(),
  ]);
  const candidates = await getDuplicateCandidates({
    draft: normalizedDraft,
    user,
  });
  const duplicateWarnings = buildDuplicateWarnings({
    draft: normalizedDraft,
    candidates,
  });
  const dataQualityFindings = buildDataQualityFindings({
    draft: normalizedDraft,
  });
  const overallAssessment = summarizeAssessment({
    duplicateWarnings,
    dataQualityFindings,
  });
  const fallbackWebsiteSuggestion = buildWebsiteSuggestion({
    draft: normalizedDraft,
    duplicateWarnings,
  });
  const fallbackRegistrationAssistance = buildRegistrationAssistance({
    draft: normalizedDraft,
    duplicateWarnings,
    catalogContext,
  });
  contextTimer.finish("completed", {
    duplicateWarnings: duplicateWarnings.length,
    findings: dataQualityFindings.length,
  });

  const state = buildInitialAnalysisState({
    draft: normalizedDraft,
    duplicateWarnings,
    dataQualityFindings,
    catalogContext,
    fallbackWebsiteSuggestion,
    fallbackRegistrationAssistance,
  });

  await runDiscoveryStage({
    draft: normalizedDraft,
    options: normalizedOptions,
    catalogContext,
    fallbackWebsiteSuggestion,
    state,
    metrics,
    aiUsageContext,
  });

  await runStructuredExtractionStage({
    draft: normalizedDraft,
    options: normalizedOptions,
    catalogContext,
    duplicateWarnings,
    state,
    metrics,
    aiUsageContext,
  });

  return buildPipelineResponse({
    draft: normalizedDraft,
    duplicateWarnings,
    dataQualityFindings,
    catalogContext,
    economicSectorOptions,
    overallAssessment,
    state,
    executionPlan,
    metrics,
  });
}

export async function runAccountDuplicateReviewPipeline({
  draft,
  user,
  aiUsageContext = null,
}) {
  const normalizedDraft = normalizeAccountDraft(draft);
  const catalogContext = await getCatalogContext(normalizedDraft);
  const candidates = await getDuplicateCandidates({
    draft: normalizedDraft,
    user,
  });
  const duplicateWarnings = buildDuplicateWarnings({
    draft: normalizedDraft,
    candidates,
  });
  const fallbackDuplicateReview = buildDuplicateReview({ duplicateWarnings });

  if (!canUseStructuredDuplicateReview()) {
    return {
      duplicateWarnings,
      duplicateReview: fallbackDuplicateReview,
      meta: {
        usedAiGeneration: false,
        provider: "heuristic",
      },
    };
  }

  try {
    const structuredResult = await runStructuredAccountDraftAnalysis({
      draft: normalizedDraft,
      catalogContext,
      duplicateWarnings,
      duplicateCandidates: candidates,
      preferredWebsite: String(normalizedDraft.website || "").trim(),
      externalContext: null,
      currentValues: buildDuplicateReviewCurrentValues({
        draft: normalizedDraft,
        duplicateReview: fallbackDuplicateReview,
      }),
      aiUsageContext,
    });

    if (structuredResult?.duplicateReview?.verdict) {
      return {
        duplicateWarnings,
        duplicateReview: {
          verdict: structuredResult.duplicateReview.verdict,
          summary: structuredResult.duplicateReview.summary || "",
          recommendation: structuredResult.duplicateReview.recommendation || "",
          confidence: structuredResult.duplicateReview.confidence || "medium",
        },
        meta: {
          usedAiGeneration: true,
          provider: "structured_web_research",
        },
      };
    }
  } catch {
    return {
      duplicateWarnings,
      duplicateReview: fallbackDuplicateReview,
      meta: {
        usedAiGeneration: false,
        provider: "heuristic",
      },
    };
  }

  return {
    duplicateWarnings,
    duplicateReview: fallbackDuplicateReview,
    meta: {
      usedAiGeneration: false,
      provider: "heuristic",
    },
  };
}
