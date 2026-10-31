import { buildCustomerCreationResponse } from "./customer-creation.js";
import { buildCustomerUpdateResponse, validateCustomerUpdateMemory } from "./customer-updates.js";
import { buildCustomerLinkResponse } from "./customer-links.js";
import { buildCustomerRescheduleResponse } from "./customer-reschedule.js";
import { buildCustomerOutcomeResponse } from "./customer-outcomes.js";
import { buildCustomerStageResponse } from "./customer-stage.js";
import { readCustomerLinkPair } from "../coach/customer-link-access.js";
import { readCustomerUpdateRecord, loadCustomerUpdateStates } from "../coach/customer-update-access.js";
import { LEGACY_CUSTOMER_CONTACT_UPDATE_FIELDS } from "../coach/customer-field-values.js";
import {
  resolveCustomerDocumentRequest,
  selectCustomerQuotation,
  validateCustomerDocumentMemory,
} from "./customer-documents.js";
import {
  contrastCustomerDocumentReport,
  resolveCustomerDocumentReport,
  validateCustomerDocumentReportMemory,
} from "./customer-document-reports.js";
import { runCustomerContractTurn } from "./turn-contract-runtime.js";
import { getCustomerEvidenceLimits } from "../coach/server-policy.js";
import { loadCoachBusinessRules } from "../coach/business-rules.js";
import {
  getAuthorizedCoachQuotationContent,
  hasQuotationReadAccess,
  listAuthorizedCoachQuotations,
} from "../coach/quotation-read-service.js";
import { loadChannelIntentConfigurations } from "../coach/channel-intent-governance.js";
import { extractCustomerNoteText } from "./customer-chat-intents.js";
import { getDeadlineSignal, permissionGranted, scopeCustomerSnapshot } from "./customer-chat-records.js";
import { resolveCustomerOpportunity } from "./customer-chat-intent-response.js";

export async function runCustomerChatContractTurn({ createAdapter, question, context, history, turnConversationContext, turnTraceParentSpanId, user, snapshot, authoritativeIntent, contractComponent, referenceMaterial, channelIntentConfiguration, conversationContext, snapshotQueryMetrics, loadUpdateRecord, loadUpdateStates, loadLinkPair, loadSchedule, loadScheduleTimezone, loadOutcomes, loadStages, agents, jobId, executionTrace, permissions, loadDocumentKnowledge, state }) {
  const contractRules = await loadCoachBusinessRules({ channel: "customer_account", process: "default" });
  const contractIntents = channelIntentConfiguration ||
    await loadChannelIntentConfigurations({ channel: "customer_account" });
  const limits = getCustomerEvidenceLimits(contractRules);
  const budget = {
    deadlineAt: Date.now() + limits.maxTurnMs,
    remainingReadQueries: limits.maxReadQueries,
    remainingRounds: limits.maxRounds,
  };
  const updateContinuation = validateCustomerUpdateMemory(
    (turnConversationContext || conversationContext)?.updateMemory, snapshot,
  );
  const turnContract = updateContinuation ? { ...authoritativeIntent.turnContract,
    components: authoritativeIntent.turnContract.components.map((component) =>
      component.category === "action.update_fields" && component.object === "general" &&
      component.updateSpec && component.updateSpec.mode !== "start"
        ? { ...component, object: updateContinuation.object } : component),
  } : authoritativeIntent.turnContract;
  await loadDocumentKnowledge({
    question: state.activeOriginalQuestion,
    turnContract,
    traceParentSpanId: turnTraceParentSpanId,
    traceFrom: "B4",
  });
  return runCustomerContractTurn({
    contract: turnContract, question,
    referenceMaterial,
    conversationContext: turnConversationContext || conversationContext, context,
    executeComponent: async ({ component, capability, contract, question: componentQuestion, originalQuestion, context: componentContext, referenceMaterial: componentReferenceMaterial, dependencyResults: dependencies }) => {
      // B3 only receives action tasks; anything else belongs to the dossier engine and must not run here.
      if (!/^(?:action|report)\./.test(component.category)) {
        return {
          response: {
            answer: "Esta parte se responde con el motor de consultas; no se ejecutó ninguna acción.",
            responseType: "informational", operations: [], recommendedActions: [], evidence: [], pendingItems: [],
          },
          qualityTrace: { toolsUsed: [], diagnostics: { capability: { status: "not_action", category: component.category } } },
          channelIntentRouting: null,
        };
      }
      const writePermission = {
        activity: "calendario_comercial.update", stage_answer: "oportunidades.update",
        lead_call_outcome: "interacciones.update", account_field: "cuentas.update",
        contact_field: "contactos.update",
        opportunity_field: "oportunidades.update",
        opportunity_note: "oportunidades.update",
        link_contact_to_opportunity: "oportunidades.update",
        reschedule_activity: "calendario_comercial.update",
      }[capability.operationKind];
      const disabled = (component.category !== "report.document_evidence" &&
        contractIntents.some((intent) => intent.code === capability.intent && intent.enabled === false)) ||
        (capability.operationKind && !contractRules.operationPolicy.allowedKinds.includes(capability.operationKind));
      const creationPermissions = {
        create_contact: ["contactos.create", "contactos.request"],
        create_opportunity: ["oportunidades.create", "oportunidades.request"],
      }[capability.operationKind];
      const denied = (creationPermissions &&
        (!creationPermissions.some((permission) => permissionGranted(permissions, permission)) ||
          !permissionGranted(permissions, "mi_coach.execute"))) || (writePermission && (!permissions.has(writePermission) ||
        !permissions.has("mi_coach.execute") ||
        (capability.operationKind === "activity" && !permissions.has("oportunidades.update"))));
      if (disabled || denied) {
        const status = disabled ? "disabled" : "permission_denied";
        return {
          response: {
            answer: disabled
              ? component.category === "action.record_note"
                ? "La configuración actual del canal no permite registrar notas en oportunidades. No se guardó ninguna nota."
                : "Reconocí la solicitud, pero esta capacidad está deshabilitada por la configuración del canal. No se ejecutó ningún cambio."
              : "Reconocí la solicitud, pero tu perfil no tiene los permisos necesarios para preparar esta operación. No se ejecutó ningún cambio.",
            responseType: disabled ? "informational" : "error",
            capabilityStatus: status, operations: [], recommendedActions: [], evidence: [], pendingItems: [],
            ...(component.category === "action.create_record" ? { creationMemory: null } : {}),
            ...(component.category === "action.update_fields" ? { updateMemory: null } : {}),
            ...(component.category === "action.link_records" ? { linkMemory: null } : {}),
            ...(component.category === "action.reschedule_activity" ? { rescheduleMemory: null } : {}),
            ...(component.category === "action.record_outcome" ? { outcomeMemory: null } : {}),
            ...(component.category === "action.change_status" ? { stageMemory: null } : {}),
          },
          qualityTrace: { toolsUsed: [], diagnostics: { capability: { status, category: component.category } } },
          channelIntentRouting: null,
        };
      }
      if (component.category === "action.change_status") {
        const allowed = ["cuentas", "oportunidades"].every((domain) =>
          permissionGranted(permissions, `${domain}.read`) || permissionGranted(permissions, `${domain}.read_all`)) &&
          contractRules.scope?.opportunitySearchAllowed !== false &&
          permissionGranted(permissions, "mi_coach.execute") && permissionGranted(permissions, "oportunidades.update");
        if (!allowed) return { response: { answer: "No tienes acceso a las oportunidades o la lectura está deshabilitada.",
          responseType: "error", capabilityStatus: "permission_denied", operations: [], stageMemory: null },
          qualityTrace: { toolsUsed: [], diagnostics: {} }, channelIntentRouting: null };
        if (Date.now() >= budget.deadlineAt || budget.remainingReadQueries < 3) throw Object.assign(
          new Error("Se alcanzó el presupuesto de validación"), { code: "CUSTOMER_TURN_BUDGET_EXCEEDED" });
        budget.remainingReadQueries -= 3;
        const response = await buildCustomerStageResponse({
          component, movement: contract.movement, question, snapshot,
          previous: (turnConversationContext || conversationContext)?.stageMemory,
          readStages: async (accountId) => {
            if (Date.now() >= budget.deadlineAt) throw Object.assign(new Error("Límite del turno"), { code: "CUSTOMER_TURN_BUDGET_EXCEEDED" });
            const data = await loadStages({ user, accountId });
            if (Date.now() >= budget.deadlineAt) throw Object.assign(new Error("Límite del turno"), { code: "CUSTOMER_TURN_BUDGET_EXCEEDED" });
            return data;
          },
        });
        return { response, qualityTrace: { toolsUsed: ["readCustomerStages"], diagnostics: {
          stage: { status: response.stageMetadata?.status || response.responseType, validationStarted: false },
        } }, channelIntentRouting: null };
      }
      if (component.category === "action.record_outcome") {
        const allowed = ["cuentas", "interacciones"].every((domain) =>
          permissionGranted(permissions, `${domain}.read`) || permissionGranted(permissions, `${domain}.read_all`)) &&
          contractRules.scope?.leadSearchAllowed !== false;
        if (!allowed) return { response: { answer: "No tienes acceso a los leads de esta cuenta o la lectura está deshabilitada.",
          responseType: "error", capabilityStatus: "permission_denied", operations: [], outcomeMemory: null },
          qualityTrace: { toolsUsed: [], diagnostics: {} }, channelIntentRouting: null };
        if (Date.now() >= budget.deadlineAt || budget.remainingReadQueries < 3) throw Object.assign(
          new Error("Se alcanzó el presupuesto de resultados"), { code: "CUSTOMER_TURN_BUDGET_EXCEEDED" });
        budget.remainingReadQueries -= 3;
        const response = await buildCustomerOutcomeResponse({
          component, movement: contract.movement, question, snapshot,
          previous: (turnConversationContext || conversationContext)?.outcomeMemory,
          timeZone: await loadScheduleTimezone(),
          readOutcomes: async (accountId) => {
            if (Date.now() >= budget.deadlineAt) throw Object.assign(new Error("Se alcanzó el límite del turno"), { code: "CUSTOMER_TURN_BUDGET_EXCEEDED" });
            const result = await loadOutcomes({ user, accountId });
            if (Date.now() >= budget.deadlineAt) throw Object.assign(new Error("Se alcanzó el límite del turno"), { code: "CUSTOMER_TURN_BUDGET_EXCEEDED" });
            return result;
          },
        });
        return { response, qualityTrace: { toolsUsed: ["readCustomerOutcomes"], diagnostics: {
          outcome: { status: response.outcomeMetadata?.status || response.responseType, persisted: false },
        } }, channelIntentRouting: null };
      }
      if (component.category === "action.reschedule_activity") {
        const allowed = ["cuentas", "oportunidades", "calendario_comercial"].every((domain) =>
          permissionGranted(permissions, `${domain}.read`) || permissionGranted(permissions, `${domain}.read_all`)) &&
          ["oportunidades.update", "desarrollo_comercial.update"].every((permission) => permissions.has(permission)) &&
          contractRules.scope?.opportunitySearchAllowed !== false && snapshot.permissions?.canReadOpportunities !== false;
        if (!allowed) return { response: { answer: "No tienes acceso o permisos para reprogramar esta actividad.",
          responseType: "error", capabilityStatus: "permission_denied", operations: [], rescheduleMemory: null },
          qualityTrace: { toolsUsed: [], diagnostics: {} }, channelIntentRouting: null };
        if (Date.now() >= budget.deadlineAt || budget.remainingReadQueries < 4) throw Object.assign(
          new Error("Se alcanzó el presupuesto de reprogramación"), { code: "CUSTOMER_TURN_BUDGET_EXCEEDED" });
        budget.remainingReadQueries -= 4;
        const response = await buildCustomerRescheduleResponse({
          component, movement: contract.movement, question, snapshot,
          previous: (turnConversationContext || conversationContext)?.rescheduleMemory,
          timeZone: await loadScheduleTimezone(),
          readSchedule: async (accountId) => {
            if (Date.now() >= budget.deadlineAt) throw Object.assign(
              new Error("Se alcanzó el presupuesto de reprogramación"), { code: "CUSTOMER_TURN_BUDGET_EXCEEDED" });
            const data = await loadSchedule({ user, accountId });
            if (Date.now() >= budget.deadlineAt) throw Object.assign(new Error("Se alcanzó el límite del turno"), { code: "CUSTOMER_TURN_BUDGET_EXCEEDED" });
            return data;
          },
        });
        return { response, qualityTrace: { toolsUsed: ["readCustomerSchedule"], diagnostics: {
          reschedule: { status: response.rescheduleMetadata?.status || response.responseType, persisted: false },
        } }, channelIntentRouting: null };
      }
      if (component.category === "action.link_records") {
        const allowed = ["cuentas", "contactos", "oportunidades"].every((domain) =>
          permissionGranted(permissions, `${domain}.read`) || permissionGranted(permissions, `${domain}.read_all`)) &&
          contractRules.scope?.contactSearchAllowed !== false && contractRules.scope?.opportunitySearchAllowed !== false &&
          snapshot.permissions?.canReadContacts !== false && snapshot.permissions?.canReadOpportunities !== false;
        if (!allowed) return { response: { answer: "No tienes acceso a ambos extremos del vínculo o están deshabilitados por política.",
          responseType: "error", capabilityStatus: "permission_denied", operations: [], linkMemory: null },
          qualityTrace: { toolsUsed: [], diagnostics: {} }, channelIntentRouting: null };
        const response = await buildCustomerLinkResponse({
          component, movement: contract.movement, question, snapshot: scopeCustomerSnapshot(snapshot),
          previous: (turnConversationContext || conversationContext)?.linkMemory, metrics: snapshotQueryMetrics,
          readPair: async (ids) => {
            if (Date.now() >= budget.deadlineAt || budget.remainingReadQueries < 4) {
              throw Object.assign(new Error("Se alcanzó el límite de verificación del vínculo"), { code: "CUSTOMER_TURN_BUDGET_EXCEEDED" });
            }
            budget.remainingReadQueries -= 4;
            const pair = await (loadLinkPair || readCustomerLinkPair)({ user, ...ids });
            if (Date.now() >= budget.deadlineAt) throw Object.assign(new Error("Se alcanzó el límite del turno"), { code: "CUSTOMER_TURN_BUDGET_EXCEEDED" });
            return pair;
          },
        });
        return { response, qualityTrace: { toolsUsed: ["readCustomerLinkPair"], diagnostics: {
          link: { status: response.linkMetadata?.status || response.responseType, persisted: false },
        } }, channelIntentRouting: null };
      }
      const legacyContactUpdate = component.object === "contact" && component.updateSpec?.changes.length === 0 &&
        component.updateSpec.unsupported?.length > 0 &&
        component.updateSpec.unsupported.every((field) => LEGACY_CUSTOMER_CONTACT_UPDATE_FIELDS.includes(field));
      if (component.category === "action.update_fields" && component.updateSpec && !legacyContactUpdate) {
        const domain = { account: "cuentas", contact: "contactos", opportunity: "oportunidades" }[component.object];
        const allowed = domain && (permissionGranted(permissions, `${domain}.read`) || permissionGranted(permissions, `${domain}.read_all`)) &&
          contractRules.scope?.[`${component.object}SearchAllowed`] !== false &&
          (component.object === "account" || snapshot.permissions?.[component.object === "contact" ? "canReadContacts" : "canReadOpportunities"] !== false);
        if (!allowed) return {
          response: { answer: "No tienes acceso a la lectura del valor actual o está deshabilitada por política. No preparé el cambio.",
            responseType: "error", capabilityStatus: "permission_denied", operations: [], updateMemory: null },
          qualityTrace: { toolsUsed: [], diagnostics: {} }, channelIntentRouting: null,
        };
        const read = async (work) => {
          if (Date.now() >= budget.deadlineAt || budget.remainingReadQueries < 1) throw Object.assign(
            new Error("Se alcanzó el límite de verificación del turno"), { code: "CUSTOMER_TURN_BUDGET_EXCEEDED" });
          budget.remainingReadQueries -= 1;
          const result = await work();
          if (Date.now() >= budget.deadlineAt) throw Object.assign(
            new Error("Se alcanzó el límite del turno"), { code: "CUSTOMER_TURN_BUDGET_EXCEEDED" });
          return result;
        };
        const response = await buildCustomerUpdateResponse({
          component, movement: contract.movement, question, snapshot: scopeCustomerSnapshot(snapshot),
          previous: (turnConversationContext || conversationContext)?.updateMemory, metrics: snapshotQueryMetrics,
          readRecord: (object, targetId) => read(() => (loadUpdateRecord || readCustomerUpdateRecord)({
            user, object, accountId: Number(snapshot.account.id), targetId,
          })),
          loadStates: (draftId) => read(() => (loadUpdateStates || loadCustomerUpdateStates)({ user, draftId })),
        });
        return { response, qualityTrace: { toolsUsed: ["readCustomerUpdateRecord"], diagnostics: {
          update: { status: response.updateMetadata?.status || response.responseType, persisted: false },
        } }, channelIntentRouting: null };
      }
      if (component.category === "action.create_record") {
        if (Date.now() >= budget.deadlineAt) throw Object.assign(
          new Error("Se alcanzó el límite del turno"), { code: "CUSTOMER_TURN_BUDGET_EXCEEDED" });
        const response = buildCustomerCreationResponse({
          component, movement: contract.movement, question,
          snapshot: scopeCustomerSnapshot(snapshot),
          previous: (turnConversationContext || conversationContext)?.creationMemory,
          metrics: snapshotQueryMetrics,
          contactsAllowed: (permissionGranted(permissions, "contactos.read") || permissionGranted(permissions, "contactos.read_all")) &&
            snapshot.permissions?.canReadContacts !== false && contractRules.scope?.contactSearchAllowed !== false,
          opportunitiesAllowed: (permissionGranted(permissions, "oportunidades.read") || permissionGranted(permissions, "oportunidades.read_all")) &&
            snapshot.permissions?.canReadOpportunities !== false && contractRules.scope?.opportunitySearchAllowed !== false,
        });
        return {
          response, qualityTrace: { toolsUsed: [], diagnostics: { creation: {
            status: response.creationMetadata?.status || "clarification",
            prepared: response.operations.length, persisted: false,
          } } }, channelIntentRouting: null,
        };
      }
      if (component.category === "report.document_evidence") {
        const scoped = scopeCustomerSnapshot(snapshot);
        const documentDependencies = dependencies.filter((item) => item.documentMemory);
        const dependencyMemory = documentDependencies.length === 1
          ? validateCustomerDocumentMemory(documentDependencies[0].documentMemory, scoped) : null;
        const reportMemory = validateCustomerDocumentReportMemory(
          (turnConversationContext || conversationContext)?.documentReportMemory, scoped);
        const report = resolveCustomerDocumentReport({
          component, movement: contract.movement, previous: reportMemory, snapshot: scoped,
          referenceMaterial: componentReferenceMaterial, sourceMemory: dependencyMemory,
        });
        const used = [];
        let documentSource = null;
        const finish = async (response) => {
          let result = response;
          if (report?.mode === "prepare" && response.documentReportMetadata &&
              response.responseType === "informational") {
            if (!contractRules.operationPolicy.allowedKinds.includes("stage_answer")) {
              result = { ...response, answer: `${response.answer}\nLa preparación de respuestas de etapa está deshabilitada en este canal.`,
                capabilityStatus: "disabled" };
            } else if (!permissions.has("oportunidades.update") || !permissions.has("mi_coach.execute")) {
              result = { ...response, answer: `${response.answer}\nTu perfil no permite preparar respuestas de etapa.`,
                responseType: "error", capabilityStatus: "permission_denied" };
            } else {
              const prepared = await createAdapter({
                user, snapshot, authoritativeIntent: {
                  intent: "opportunity_guidance", confidence: 0.95, requiresClarification: false,
                },
                contractComponent: { ...component, text: report.claim,
                  reference: response.documentReportMetadata.opportunityName ||
                    report.documentSpec.opportunityReference || component.reference,
                  documentReportSpec: { questionReference: report.memory.questionReference } },
                contractMovement: contract.movement, documentReportEvidence: {
                  ...response.documentReportMetadata, questionCandidates: report.memory.questionCandidates || [],
                },
                turnBudget: budget, channelIntentConfiguration: contractIntents,
                snapshotQueryMetrics, agents, jobId, executionTrace, traceParentSpanId: turnTraceParentSpanId,
                conversationContext: turnConversationContext || conversationContext,
              }).runTurn({
                question: report.claim, history, context: {
                  ...componentContext, opportunityId: response.documentReportMemory?.documentMemory?.opportunityId ||
                    componentContext.opportunityId,
                },
                conversationContext: turnConversationContext || conversationContext,
              });
              assertTime();
              result = { ...response, ...prepared.response,
                answer: `${response.answer}\n${prepared.response.answer}`,
                evidence: [...response.evidence, ...(prepared.response.evidence || [])],
                ...(prepared.response.documentReportCandidates ? {
                  documentReportMemory: { ...response.documentReportMemory, questionCandidates: prepared.response.documentReportCandidates },
                } : {}),
              };
              used.push(...(prepared.qualityTrace?.toolsUsed || []));
            }
          }
          return {
            response: { ...result, ...(!Object.hasOwn(result, "documentReportMemory") ? {
              documentReportMemory: report?.memory || null,
            } : {}), ...(documentSource === "provided_document" ? { contentSource: "user_provided" } : {}) },
            qualityTrace: { toolsUsed: used, diagnostics: {
              answerGeneration: { source: "document_report" },
              documentCoverage: result.documentCoverage || null,
              ...(result.documentSources ? { documentSources: result.documentSources } : {}),
              documentReport: result.documentReportMetadata || null,
            } }, channelIntentRouting: null,
          };
        };
        const stop = (answer, responseType = "error") => finish({
          answer, responseType, operations: [], evidence: [], inferences: [], pendingItems: [], recommendedActions: [],
        });
        if (documentDependencies.length > 1) return stop("Hay varias fuentes documentales de origen. Indica cuál deseas contrastar.", "clarification");
        if (report?.error) return stop(report.error, report.responseType);
        if (!reportMemory && (turnConversationContext || conversationContext)?.documentReportMemory &&
            !["new_request", "change_focus"].includes(contract.movement) &&
            !component.documentReportSpec?.claim && !component.documentSpec?.opportunityReference) {
          return stop("El reporte anterior ya no es verificable con los permisos y referencias actuales. Indica una fuente autorizada y la afirmación; no reutilizaré un contraste revocado.", "clarification");
        }
        const assertTime = () => {
          if (Date.now() >= budget.deadlineAt) throw Object.assign(
            new Error("La consulta documental excedió el tiempo permitido"), { code: "CUSTOMER_TURN_BUDGET_EXCEEDED" },
          );
        };
        assertTime();
        if ((Number(componentContext.accountId) !== Number(scoped.account.id) ||
            !permissionGranted(permissions, "cuentas.read"))) return stop("No hay una cuenta autorizada para recibir el reporte.");
        if (report.source === "unavailable") {
          if (!contractIntents.some((item) => item.code === "account_overview" && item.enabled !== false)) return stop("La recepción de reportes está deshabilitada en este canal.");
          return finish(await contrastCustomerDocumentReport({
            report, user, jobId, signal: getDeadlineSignal(budget.deadlineAt),
          }));
        }
        const previous = validateCustomerDocumentMemory(report.memory.documentMemory || dependencyMemory, scoped);
        const documentComponent = {
          ...component, object: report.source === "quotation" ? component.object : "document",
          documentSpec: { ...report.documentSpec,
            source: report.source === "quotation" ? "quotation" : "provided_document" },
        };
        const request = resolveCustomerDocumentRequest({
          component: documentComponent, movement: dependencyMemory || contract.movement === "request_rationale" ? "continue" : contract.movement,
          previous, snapshot: scoped,
          context: componentContext, referenceMaterial: componentReferenceMaterial, businessRules: contractRules,
        });
        if (request.error) return stop(request.error, request.responseType);
        documentSource = request.source;
        const intent = contractIntents.find((item) =>
          item.code === (request.source === "provided_document" ? "account_overview" :
            request.source === "opportunity_document" ? "opportunity_status" : "quotation_query"));
        if (!intent || intent.enabled === false) return finish({
          answer: "Reconocí la consulta documental, pero esta fuente está deshabilitada por la configuración del canal.",
          responseType: "informational", capabilityStatus: "disabled",
          operations: [], evidence: [], inferences: [], pendingItems: [], recommendedActions: [],
        });
        request.question = component.text;
        assertTime();
        if (request.source === "provided_document") {
          const response = await contrastCustomerDocumentReport({
            request, report, user, jobId, signal: getDeadlineSignal(budget.deadlineAt),
          });
          assertTime();
          return finish(response);
        }
        if (["opportunity_document", "quotation_document"].includes(request.source)) {
          return stop("Para contrastar archivos CRM, consulta primero su contenido y formula el contraste sobre esa fuente.", "clarification");
        }
        if (!permissionGranted(permissions, "oportunidades.read") || !hasQuotationReadAccess(user) ||
            scoped.permissions?.canReadOpportunities === false ||
            contractRules.scope?.opportunitySearchAllowed === false || contractRules.scope?.quotationSearchAllowed === false ||
            !intent?.allowedTools.includes("getOpportunityQuotation") || !intent.allowedTools.includes("searchOpportunities")) {
          return stop("Tu perfil o la configuración del canal no permiten leer esta cotización comercial.");
        }
        if (snapshotQueryMetrics.some((metric) =>
          ["opportunities_active", "opportunities_inactive"].includes(metric.source) && metric.errorCode)) {
          return stop("Falló una lectura necesaria para verificar la oportunidad. No se interpreta como ausencia de cotizaciones.");
        }
        const read = async (label, cost, execute) => {
          assertTime();
          if (budget.remainingReadQueries < cost) throw Object.assign(
            new Error("No hay presupuesto suficiente para la lectura documental"), { code: "CUSTOMER_TURN_BUDGET_EXCEEDED" },
          );
          budget.remainingReadQueries -= cost;
          used.push("getOpportunityQuotation");
          const result = executionTrace ? await executionTrace.span({
            from: "B7", to: "B8", label, parentSpanId: turnTraceParentSpanId,
            input: { opportunityId: request.opportunity.id, source: "authorized_quotation" },
          }, execute, () => ({ completed: true })) : await execute();
          assertTime();
          return result;
        };
        const listing = await read("Resolver cotizaciones autorizadas", 1, () => listAuthorizedCoachQuotations({
          user, accountId: scoped.account.id, opportunityId: request.opportunity.id,
          quotationReference: component.listPosition > 0 ? "" :
            request.quotationReference || (request.previous?.quotationId ? String(request.previous.quotationId) : ""),
        }));
        const selection = selectCustomerQuotation({ request, listing, listPosition: component.listPosition });
        if (selection.response) return finish({
          ...selection.response, documentMemory: undefined,
          documentReportMemory: { ...report.memory, documentMemory: selection.response.documentMemory },
        });
        request.selectedQuotationId = selection.selected.quotationId;
        if (!request.versionNumber) request.expectedLatestVersionId = selection.selected.versionId;
        const quotation = await read("Leer versión comercial autorizada", 3, () => getAuthorizedCoachQuotationContent({
          user, accountId: scoped.account.id, opportunityId: request.opportunity.id,
          quotationId: selection.selected.quotationId, versionNumber: request.versionNumber, commercialOnly: true,
        }));
        const response = await contrastCustomerDocumentReport({
          request, report, quotation, user, jobId, signal: getDeadlineSignal(budget.deadlineAt),
        });
        assertTime();
        return finish({
          ...response,
          ...(response.documentMemory ? { entities: {
            accountId: scoped.account.id, opportunityId: request.opportunity.id,
          } } : {}),
        });
      }
      if (Date.now() >= budget.deadlineAt || budget.remainingReadQueries <= 0) {
        throw Object.assign(new Error("Se alcanzó el límite de verificación del turno"), { code: "CUSTOMER_TURN_BUDGET_EXCEEDED" });
      }
      if (component.category === "action.record_note") {
        const scoped = scopeCustomerSnapshot(snapshot);
        const finish = (response, toolsUsed = []) => ({
          response,
          qualityTrace: {
            toolsUsed,
            diagnostics: {
              opportunityNotes: {
                status: response.capabilityStatus || response.responseType,
                readOnly: false,
              },
            },
          },
          channelIntentRouting: null,
        });
        const noteText = extractCustomerNoteText(originalQuestion) || extractCustomerNoteText(component.text);
        if (!noteText) {
          const reference = String(component.reference || "").trim().toLocaleLowerCase("es");
          const normalizedRequest = String(originalQuestion || "").normalize("NFD")
            .replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es");
          const normalizedReference = reference.normalize("NFD").replace(/\p{Diacritic}/gu, "");
          const hasDestination = reference &&
            !/^(?:(?:la|esta|una)\s+)?oportunidad(?:\s+(?:actual|seleccionada))?$/.test(reference) &&
            normalizedRequest.includes(normalizedReference);
          return finish({
            answer: hasDestination
              ? "¿Qué texto exacto quieres registrar como nota? No he preparado ni guardado nada."
              : "¿Qué texto exacto quieres registrar y en cuál oportunidad? No he preparado ni guardado nada.",
            responseType: "clarification",
            operations: [],
            evidence: [],
            inferences: [],
            pendingItems: [],
            recommendedActions: [],
          });
        }
        const candidates = [
          ...(scoped.opportunities || []),
          ...(scoped.inactiveOpportunities || []),
          ...(scoped.selectedOpportunity ? [scoped.selectedOpportunity] : []),
        ].filter(
          (item) =>
            Number(item.accountId || scoped.account?.id) ===
            Number(scoped.account?.id),
        );
        const reference = String(
          component.reference || "",
        ).trim();
        const resolved = resolveCustomerOpportunity(
          scoped,
          reference || componentQuestion,
          snapshot.channelIntentRouting,
          contractRules,
          candidates,
        );
        const contextOpportunityId = Number(
          componentContext?.opportunityId ||
            (turnConversationContext || conversationContext)?.opportunityId ||
            0,
        );
        const contextualOpportunity = !reference && contextOpportunityId
          ? candidates.find((item) => Number(item.id) === contextOpportunityId)
          : null;
        const opportunity = (resolved &&
          candidates.find((item) => Number(item.id) === Number(resolved.id))) ||
          contextualOpportunity;
        if (!opportunity) {
          const names = [...new Set(candidates.map((item) => item.name).filter(Boolean))];
          const answer = names.length
            ? `¿De cuál oportunidad quieres consultar o registrar la nota? ${names.join("; ")}.`
            : "Indica la oportunidad autorizada a la que corresponde la nota.";
          return finish({
            answer,
            responseType: "clarification",
            operations: [],
            evidence: [],
            inferences: [],
            pendingItems: [],
            recommendedActions: [],
          });
        }
        if (
          !permissionGranted(permissions, "oportunidades.update") ||
          !permissionGranted(permissions, "mi_coach.execute")
        ) {
          return finish({
            answer: "No tienes permisos para preparar el registro de una nota. No se guardó ningún cambio.",
            responseType: "error",
            capabilityStatus: "permission_denied",
            operations: [],
            evidence: [],
            inferences: [],
            pendingItems: [],
            recommendedActions: [],
          });
        }
        const operation = {
          kind: "opportunity_note",
          title: `Registrar nota en ${opportunity.name}`,
          accountId: Number(scoped.account.id),
          opportunityId: Number(opportunity.id),
          noteText,
          sourceType: "chat_report",
          attribution: component.attribution,
          certainty: component.certainty,
        };
        return finish({
          answer: `Preparé una nota para ${opportunity.name}. Revísala y confirma la operación para guardarla; todavía no se ha registrado.`,
          responseType: "operation",
          operations: [operation],
          evidence: [],
          inferences: [],
          pendingItems: [],
          recommendedActions: [],
        });
      }
      return createAdapter({
        user, snapshot,
        initialDocumentKnowledge: state.turnDocumentKnowledge,
        authoritativeIntent: {
          intent: capability.intent, confidence: 0.95, requiresClarification: false,
          supportingIntents: capability.supportingIntents,
        },
        contractComponent: component, contractMovement: contract.movement,
        dependencyResults: dependencies,
        turnBudget: budget,
        referenceMaterial: componentReferenceMaterial,
        channelIntentConfiguration: contractIntents,
        conversationContext: turnConversationContext || conversationContext,
        snapshotQueryMetrics, agents, jobId, executionTrace, traceParentSpanId: turnTraceParentSpanId,
      }).runTurn({
        question: componentQuestion, originalQuestion, context: componentContext, history,
        conversationContext: turnConversationContext || conversationContext,
        traceParentSpanId: turnTraceParentSpanId,
      });
    },
  });
      
}
