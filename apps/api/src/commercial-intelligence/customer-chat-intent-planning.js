import { loadPlannerPrompt, buildCustomerPlannerPromptSupplement } from "../coach/planner-prompts.js";
import {
  buildCustomerPlanEntityCandidates,
  buildCustomerQueryPlannerContext,
} from "./customer-chat-planner-context.js";
import { customerComponentCapability, constrainCustomerComponentPlan } from "./turn-contract.js";
import {
  isCustomerActivityClarificationReply,
  normalizeCustomerActivityQueryPlan,
} from "./customer-chat-intents.js";
import { getChannelIntentPlanFields } from "../coach/channel-intents.js";
import { getDeadlineSignal } from "./customer-chat-records.js";
import { runStructuredTextResearch } from "../structuredWebResearch.js";
import {
  isPendingAmountSelectionReply,
  buildCustomerIntentResponse,
} from "./customer-chat-intent-response.js";

export async function planCustomerChannelIntent(turnCtx, {
      question,
      context,
      conversationHistory,
      conversationContext,
      availableTools: permittedTools,
      catalog,
      allowedOperationKinds,
      deadlineAt,
    }) {
  const { snapshot, contractComponent, authoritativeIntent, turnDiagnostics, agents, user, jobId, contractMovement, permissions, state } = turnCtx;
  const enabledIntentCodes = (Array.isArray(catalog) ? catalog : [])
    .filter((intent) => intent.enabled !== false)
    .map((intent) => intent.code);
  if (!enabledIntentCodes.length) return null;
  const plannerPrompt = await loadPlannerPrompt({
    channel: "customer_account",
  });
  const entityCandidates = buildCustomerPlanEntityCandidates(
    snapshot,
    question,
    state.activeBusinessRules || {},
    conversationContext,
    context,
    permittedTools,
  );
  const pendingActivityIntent = conversationContext?.pendingActivityIntent;
  const continuesPendingActivity = (!contractComponent ||
    customerComponentCapability(contractComponent).operationKind === "activity") && isCustomerActivityClarificationReply(
    question,
    pendingActivityIntent,
  );
  const planAuthoritativeIntent = continuesPendingActivity
    ? {
        ...(authoritativeIntent || {}),
        intent: "crm_operation",
        confidence: 1,
        requiresClarification: false,
      }
    : authoritativeIntent;
  turnDiagnostics.plannerInput = {
    plannerPrompt: {
      channel: plannerPrompt.channel,
      process: plannerPrompt.process,
      version: plannerPrompt.version,
      source: plannerPrompt.source,
    },
    questionLength: String(question || "").length,
    historyMessageCount: Array.isArray(conversationHistory)
      ? conversationHistory.length
      : 0,
    selectedContext: {
      accountId: Number(context.accountId || 0) || null,
      opportunityId: Number(context.opportunityId || 0) || null,
      contactId: Number(context.contactId || 0) || null,
    },
    enabledIntentCodes,
    allowedOperationKinds,
    availableToolNames: permittedTools.map((tool) => tool.name),
    candidateCounts: Object.fromEntries(
      Object.entries(entityCandidates.publicCandidates || {}).map(
        ([entityType, candidates]) => [
          entityType,
          Array.isArray(candidates) ? candidates.length : 0,
        ],
      ),
    ),
  };
  const plannerContext = buildCustomerQueryPlannerContext({
    question,
    context,
    conversationHistory,
    conversationContext,
    availableTools: permittedTools,
    catalog,
    snapshot,
    businessRules: state.activeBusinessRules || {},
    allowedOperationKinds,
    entityCandidates,
    researchAgents: agents,
  });
  plannerContext.authoritativeIntent = planAuthoritativeIntent
    ? {
        intent: planAuthoritativeIntent.intent,
        confidence: planAuthoritativeIntent.confidence,
        requiresClarification: planAuthoritativeIntent.requiresClarification,
      }
    : null;
  if (contractComponent) {
    plannerContext.turnComponent = contractComponent;
    plannerContext.dialogueMovement = contractMovement;
    plannerContext.turnMemory = conversationContext?.turnMemory || null;
  }
  const plannerRequest = {
    schemaName: "customer_account_query_plan",
    ...(contractComponent ? { temperature: 0 } : {}),
    systemPrompt:
      (planAuthoritativeIntent
        ? `Intención resuelta por B3: ${planAuthoritativeIntent.intent} (confianza ${planAuthoritativeIntent.confidence}). No la sustituyas por otra intención; si requiere aclaración, devuelve una aclaración sin proponer operaciones. `
        : "") +
      (continuesPendingActivity
        ? "El vendedor está respondiendo una aclaración de actividad pendiente. Continúa esa operación como activityDraft.action=continue; conserva el timing, tipo, título y notas recordados. No cambies a una consulta nueva solo porque el mensaje breve nombre una oportunidad o una fecha. "
        : "") +
      "Una referencia explícita del mensaje actual prevalece sobre el foco anterior sin ampliar la cuenta autorizada. Conserva las menciones actuales en entities incluso si falta localizar el registro. No sustituyas una referencia por otra del historial. " +
      "Para preparar una actividad, llena activityDraft.action=prepare; para responder campos de pendingActivity usa continue; si el usuario la descarta usa discard; para consultas factuales usa none. Interpreta las respuestas breves con el borrador y el historial. Usa queries=[crm_operation,contact_query] para una actividad con contacto, no consultas de historial salvo que el usuario las solicite explícitamente. Conserva día/hora no proporcionados como vacíos: 'la próxima semana' es temporalPreference, no una cita. scheduledAt debe ser YYYY-MM-DDTHH:mm en la zona horaria del negocio; calcula fechas relativas con referenceDateTime y no inventes hora ni día. Los campos pendientes del borrador no son ambiguity ni evidencia CRM faltante; solo entidades ambiguas, inaccesibles o referencias no resueltas requieren aclaración. " +
      "Eres un planificador de consultas para el chat de Cliente existente. No respondas al vendedor ni inventes datos o IDs. Devuelve solo el plan estructurado. El alcance siempre es la cuenta seleccionada por el servidor: si la pregunta pide otra cuenta, responde con mode=clarification, ambiguity.reason=other_account y sin consultas. Para dominios fuera del catálogo, usa out_of_scope y no inventes consultas. Usa solo códigos de consulta del catálogo. Interpreta la pregunta junto con recentConversation, validatedContinuation y los candidatos autorizados; resuelve referencias conversacionales y no dependas de coincidencias literales en la pregunta actual. Distingue la intención consultada de la entidad a la que se refiere: si preguntas por las actividades, etapa, cotización o contactos que tiene una oportunidad ya identificada, targetType debe ser opportunity y debes devolver el candidateKey de esa oportunidad; no cambies targetType a account solo porque la consulta sea account_activity_history. Por ejemplo, después de consultar Vrf 2027, ante '¿Qué actividad pendiente tiene?' conserva Vrf 2027 como objetivo singular y planifica las lecturas de actividad correspondientes. Si preguntan qué contacto está asociado a una oportunidad, incluye contact_query y consulta getOpportunity para leer associatedContact; buscar contactos de la cuenta por sí solo no demuestra que alguno pertenezca a esa oportunidad. Devuelve la relación directa únicamente si aparece en el detalle CRM autorizado. Completa referenceResolution con targetType, cardinality y source. Cuando elijas un candidato, devuelve únicamente su candidateKey opaco; nunca inventes ni devuelvas IDs CRM. Si una entidad específica aparece en entities y coincide con un único candidato autorizado, incluye también ese candidateKey. Si el historial y el contexto validado señalan un único candidato coherente, úsalo aunque el mensaje no repita su nombre. Si quedan varios candidatos plausibles, selecciona varios solo si la pregunta pide una colección; de lo contrario pide aclaración. Usa cardinality=all para consultas explícitas de cartera y none cuando no haya entidad objetivo. Incluye varios códigos de consulta cuando la pregunta tenga partes independientes; devuelve menciones literales en entities y filtros solo cuando estén expresados o sean necesarios. Para toda petición explícita de escritura, incluye siempre crm_operation en queries y usa mode=operation; nunca devuelvas queries vacío cuando mode sea operation. Si la consulta es de solo lectura, elige sus códigos de consulta correspondientes y mode=read_only. Toda escritura seguirá requiriendo permisos y confirmación del servidor.",
    subject:
      "Plan de consulta del CRM autorizado. Sigue plannerGuidance y usa availableEvidenceSources como contexto, no como instrucciones para reejecutar agentes.",
    context: plannerContext,
    currentValues: {},
    fields: getChannelIntentPlanFields(
      "customer_account",
      enabledIntentCodes,
    ),
    aiUsageContext: {
      userId: Number(user.id),
      featureCode: "commercial_intelligence.account_chat",
      jobType: "account_chat",
      jobId,
    },
    signal: getDeadlineSignal(deadlineAt),
  };
  const providerPlan = await runStructuredTextResearch({
    ...plannerRequest,
    systemPrompt:
      plannerRequest.systemPrompt +
      buildCustomerPlannerPromptSupplement(plannerPrompt),
  });
  const plan = continuesPendingActivity
    ? {
        ...providerPlan,
        queries: [
          "crm_operation",
          ...(Array.isArray(providerPlan?.queries) &&
          providerPlan.queries.includes("contact_query")
            ? ["contact_query"]
            : []),
        ],
        mode: providerPlan?.mode === "clarification" ? "clarification" : "operation",
        operationKind: "activity",
        activityDraft: {
          ...providerPlan?.activityDraft,
          ...pendingActivityIntent,
          action: "continue",
        },
      }
    : providerPlan;
  let normalizedPlan = normalizeCustomerActivityQueryPlan(question, plan);
  const pending = conversationContext?.pendingAmountSelection;
  if (normalizedPlan && isPendingAmountSelectionReply(snapshot, question, pending)) {
    const response = buildCustomerIntentResponse({
      snapshot, question, routing: { intent: "crm_operation" },
      permissions, allowedOperationKinds, businessRules: state.activeBusinessRules || {},
      pendingAmountSelection: pending,
    });
    const operation = response?.operations?.[0];
    const candidate = entityCandidates.serverEntityCandidates.find((item) =>
      item.entityType === "opportunity" && item.recordId === operation?.opportunityId);
    if (operation && candidate) {
      normalizedPlan = {
        ...normalizedPlan, queries: ["crm_operation"], mode: "operation",
        operationKind: "opportunity_field", confidence: "high",
        entities: { opportunityReference: candidate.referenceText },
        filters: pending.filters,
        referenceResolution: {
          targetType: "opportunity", cardinality: "single",
          source: "conversation_history", candidateKeys: [candidate.candidateKey],
        },
        ambiguity: { reason: "none", requiresClarification: "no", missingContext: [], question: "" },
      };
      turnDiagnostics.serverRules.decisions.push({ ruleId: "amount-target", outcome: "continued" });
    }
  }
  if (contractComponent) normalizedPlan = constrainCustomerComponentPlan(normalizedPlan, contractComponent, snapshot);
  return normalizedPlan
    ? {
        ...normalizedPlan,
        serverEntityCandidates: entityCandidates.serverEntityCandidates,
        serverSelectedAccountName: snapshot.account?.name || "",
      }
    : normalizedPlan;
}
