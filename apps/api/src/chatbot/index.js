import { assertAiBudgetAvailable } from "../ai-usage/service.js";
import { generateChatbotAnswerWithAi } from "./answerer.js";
import { fetchCandidatesForPlan } from "./candidate-fetcher.js";
import { buildDirectResolverFromContext } from "./context.js";
import { executeChatbotPlan } from "./executor.js";
import { buildEvidenceReferences } from "./references.js";
import { planChatbotRetrievalWithAi } from "./planner.js";
import { resolveChatbotEntityWithAi } from "./resolver.js";

function buildClarificationAnswer({ entityLabel, candidates }) {
  const options = candidates
    .slice(0, 5)
    .map(
      (item, index) =>
        `${index + 1}. ${item.displayName}${item.secondaryText ? ` - ${item.secondaryText}` : ""}`,
    )
    .join("\n");
  return `Encontre varias ${entityLabel} parecidas. Indica cual quieres consultar:\n${options}`;
}

function getEntityLabel(entityType) {
  if (entityType === "account") return "cuentas";
  if (entityType === "contact") return "contactos";
  if (entityType === "opportunity") return "oportunidades";
  return "opciones";
}

function buildNotFoundAnswer(plannerOutput) {
  const entityType = plannerOutput?.targetEntityType;
  const entityName = String(plannerOutput?.targetEntityName || "").trim();
  if (entityType === "account") {
    return `No encontre una cuenta accesible que coincida con "${entityName}".`;
  }
  if (entityType === "contact") {
    return `No encontre un contacto accesible que coincida con "${entityName}".`;
  }
  if (entityType === "opportunity") {
    return `No encontre una oportunidad accesible que coincida con "${entityName}".`;
  }
  return "No encontre registros que coincidan con tu consulta.";
}

export async function runChatbotPipeline({
  user,
  prompt,
  contextSnapshot,
  featureCode,
  internalRequestId,
}) {
  if (user && internalRequestId) {
    try {
      if (user?.id) {
        await assertAiBudgetAvailable({ userId: Number(user.id) });
      }
    } catch (error) {
      throw error;
    }
  }

  const plannerOutput = await planChatbotRetrievalWithAi({
    user,
    prompt,
    contextSnapshot,
    featureCode,
    internalRequestId,
  });

  if (plannerOutput.clarificationNeeded) {
    return {
      answer:
        plannerOutput.clarificationQuestion ||
        "Necesito un poco mas de detalle para consultar el CRM.",
      sourceType: "crm_data",
      confidence: Number(plannerOutput.confidence || 0.8),
      references: [],
      usage: null,
      sourceReason: "ai_clarification_required",
    };
  }

  let resolverOutput = null;
  let candidates = [];
  if (
    plannerOutput.mode === "crm_lookup" &&
    plannerOutput.targetEntityType !== "none" &&
    (plannerOutput.targetEntityName || plannerOutput.contextEntityId)
  ) {
    resolverOutput = buildDirectResolverFromContext(
      plannerOutput,
      contextSnapshot,
    );

    if (!resolverOutput) {
      candidates = await fetchCandidatesForPlan({
        user,
        plannerOutput,
        limit: 8,
      });
      resolverOutput = await resolveChatbotEntityWithAi({
        user,
        prompt,
        plannerOutput,
        candidates,
        featureCode,
        internalRequestId,
      });
    }

    if (
      resolverOutput.clarificationNeeded ||
      resolverOutput.resolutionStatus === "ambiguous"
    ) {
      return {
        answer:
          resolverOutput.clarificationQuestion ||
          buildClarificationAnswer({
            entityLabel: getEntityLabel(plannerOutput.targetEntityType),
            candidates,
          }),
        sourceType: "crm_data",
        confidence: Number(resolverOutput.confidence || 0.8),
        references: candidates.map((item) => `${item.entityType}:${item.id}`),
        usage: null,
        sourceReason: "ai_entity_ambiguity",
      };
    }

    if (resolverOutput.resolutionStatus === "not_found") {
      return {
        answer: buildNotFoundAnswer(plannerOutput),
        sourceType: "crm_data",
        confidence: Number(resolverOutput.confidence || 0.9),
        references: [],
        usage: null,
        sourceReason: "crm_entity_not_found",
      };
    }
  }

  const evidence = await executeChatbotPlan({
    user,
    plannerOutput,
    resolverOutput,
  });
  const references = buildEvidenceReferences(evidence);
  const evidencePackage = {
    status: plannerOutput.mode === "crm_lookup" ? "ok" : "knowledge",
    requestedDomains: plannerOutput.requestedDomains,
    interpretation: plannerOutput,
    resolver: resolverOutput,
    candidates,
    evidence,
  };

  const answer = await generateChatbotAnswerWithAi({
    user,
    prompt,
    contextSnapshot,
    evidencePackage,
    references,
    featureCode,
    internalRequestId,
  });

  return {
    ...answer,
    usage: null,
    sourceReason:
      plannerOutput.mode === "crm_lookup" ? "ai_pipeline" : "ai_knowledge_plan",
  };
}
