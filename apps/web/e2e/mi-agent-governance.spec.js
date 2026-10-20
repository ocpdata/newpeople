import { expect, test } from "@playwright/test";
import { DOCUMENT_FILE_ACCEPT, DOCUMENT_FORMATS } from "../../../shared/document-formats.js";
import {
  CUSTOMER_SERVER_POLICY_DEFAULTS,
  CUSTOMER_SERVER_RULE_CATEGORIES,
  CUSTOMER_OPERATION_KINDS,
} from "../../api/src/coach/server-policy.js";

async function mockMiCoachApi(
  page,
  {
    canAdmin = false,
    withCoachModuleAccess = true,
    withCoachAccess = true,
    withCustomerHealth = false,
    withCustomerChatAccess = withCustomerHealth,
    withCustomerChatTrace = false,
    canDiagnoseCustomerChats = false,
    withCustomerStageAnswerPrefill = false,
    withCustomerContactOperation = false,
    withCustomerOpportunityOperation = false,
    withCustomerContactOpportunityLink = false,
    withVersionedCustomerLink = false,
    withCustomerReschedule = false,
    withCustomerOutcome = false,
    withCustomerNote = false,
    customerNoteFailure = "",
    withCustomerStage = false,
    customerStageDecision = "ready_to_advance",
    failCustomerOutcome = false,
    incompleteCustomerOutcome = false,
    withCustomerContactUpdate = false,
    withLeadRead = false,
    withCoachInterface = false,
    withCoachPendingOperations = true,
    withHistoricalOpportunityContext = false,
    withResponseContextSwitch = false,
    withSituationAnalysis = false,
    withProspect = false,
    withProspectChatAccess = withProspect,
    withProspectDuplicates = true,
    timeoutFirstProspectPoll = false,
    withOpportunityStatusMatrix = false,
    quotaCurrencyCode = "USD",
    usdToTargetRate = 1,
    currencyConversionAvailable = true,
  } = {},
) {
  const prospectSession = {
    id: 991,
    status: "completed",
    chatHistory: [],
    companyName: "Prospecto E2E",
    country: "Mexico",
    website: "https://prospecto-e2e.example.com",
    industry: "Tecnología",
    convertedAccountId: null,
    result: {
      headline: "Prospecto E2E",
      summary: "Ficha inicial pendiente de validación comercial.",
      profile: {
        companyName: "Prospecto E2E",
        positioning: "Empresa en evaluación.",
      },
      outreach: {
        subject: "Conversación de diagnóstico",
        body: "Hola, quisiera conocer sus prioridades.",
        questions: ["¿Cuál es su prioridad actual?"],
      },
      externalResearch: {
        enabled: true,
        findingCount: 1,
        researchedAt: "2026-09-10T09:30:00.000Z",
        warnings: [],
      },
    },
    findings: [
      {
        id: 801,
        status: "suggested",
        category: "company_profile",
        title: "Señal pública",
        summary: "Hallazgo para confirmar con el vendedor.",
        evidenceText: "La fuente apunta a una señal para validar.",
        sourceExcerpt: "La empresa informó que modernizará su infraestructura.",
        confidence: "high",
        certainty: "evidenced",
        sourceType: "public_source",
        sourceReference: "https://example.com/evidence",
      },
    ],
    contacts: [
      {
        id: 901,
        name: "María García",
        area: "Tecnología",
        roleTitle: "CTO",
        sourceType: "public_source",
        evidenceText:
          "La fuente identifica a María García como líder de tecnología.",
        sourceExcerpt: "María García fue nombrada CTO de la compañía.",
        sourcePublishedAt: "2026-08-15",
        confidence: "high",
        status: "suggested",
        sourceReference: "https://prospecto-e2e.example.com/leadership",
      },
    ],
    hypotheses: [
      {
        id: 902,
        technologyArea: "Infraestructura",
        title: "Modernizar la plataforma",
        businessChallenge: "Hipótesis por validar con el vendedor.",
        validationQuestion: "¿Qué limitación desean resolver?",
        evidenceText: "El material apunta a la criticidad de sus aplicaciones.",
        sourceExcerpt:
          "La compañía opera aplicaciones críticas para sus clientes.",
        sourceReference: "https://prospecto-e2e.example.com/technology",
        sourcePublishedAt: "2026-07-10",
        confidence: "medium",
        status: "suggested",
      },
    ],
    duplicateReview: {
      completed: true,
      countryResolved: true,
      candidates: withProspectDuplicates
        ? [
            {
              id: 777,
              name: "Prospecto E2E existente",
              website: "https://prospecto-e2e.example.com",
              domain: "prospecto-e2e.example.com",
              country: "Mexico",
              matchType: "domain",
            },
          ]
        : [],
    },
  };
  let prospectResearchRunCount = 0;
  let prospectResearchPollFailureCount = 0;
  let prospectIsTarget = false;
  let prospectIsDiscarded = false;
  let prospectChatQuestion = "";
  let prospectChatHistoryPersisted = false;
  let customerChatJobCount = 0;
  let persistedCustomerContactOperation = null;
  let persistedCustomerOpportunityOperation = null;
  let stageJobStarted = false;
  const plannerPrompts = ["coach", "customer_account", "prospect"].map((channel) => ({
    channel,
    process: "default",
    connected: channel === "customer_account",
    instruction: `Instrucción inicial de ${channel}`,
    initialInstruction: `Instrucción inicial de ${channel}`,
    version: 0,
    source: "default",
    revisions: [],
  }));
  const classifierPrompts = structuredClone(plannerPrompts);
  const initialServerRules = {
    scope: {
      accountSearchAllowed: true, opportunitySearchAllowed: true,
      contactSearchAllowed: true, leadSearchAllowed: true, quotationSearchAllowed: true,
    },
    filters: { defaultOpenOnly: true, defaultActiveOnly: true, defaultInactiveOnly: false },
    operationPolicy: { allowedKinds: CUSTOMER_OPERATION_KINDS.filter((kind) =>
      !["create_opportunity", "link_contact_to_opportunity"].includes(kind)) },
    serverPolicy: { ...CUSTOMER_SERVER_POLICY_DEFAULTS },
  };
  const serverRules = {
    channel: "customer_account", version: 0, connected: true,
    rules: structuredClone(initialServerRules), initialRules: initialServerRules,
    categories: CUSTOMER_SERVER_RULE_CATEGORIES, revisions: [],
  };
  let customerSnapshot;
  await page.context().route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    const method = route.request().method();
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (pathname === "/api/commercial-intelligence/governance/server-rules" && method === "GET") {
      return json(serverRules);
    }
    if (pathname === "/api/commercial-intelligence/governance/server-rules/customer_account" && method === "PUT") {
      const input = route.request().postDataJSON();
      if (input.expectedVersion !== serverRules.version) {
        return json({ message: "Las reglas cambiaron. Recarga antes de guardar." }, 409);
      }
      if (!serverRules.revisions.length) {
        serverRules.revisions.push({ version: 0, rules: structuredClone(serverRules.rules) });
      }
      serverRules.rules = input.rules;
      serverRules.version += 1;
      serverRules.revisions.unshift({
        version: serverRules.version, rules: structuredClone(input.rules),
        createdAt: "2026-10-12T12:00:00.000Z",
      });
      return json(serverRules);
    }

    if (pathname === "/api/mi-agent/coach/admin/planner-prompts" && method === "GET") {
      return json({ prompts: plannerPrompts });
    }
    if (pathname === "/api/mi-agent/coach/admin/semantic-classifier-prompts" && method === "GET") {
      return json({ prompts: classifierPrompts });
    }
    if (pathname.startsWith("/api/mi-agent/coach/admin/semantic-classifier-prompts/") &&
        ["PUT", "POST"].includes(method)) {
      const parts = pathname.split("/");
      const prompt = classifierPrompts.find((item) => item.channel === parts[6]);
      const input = route.request().postDataJSON();
      if (!prompt || prompt.version !== input.expectedVersion) {
        return json({ message: "Las instrucciones cambiaron. Recarga antes de guardar." }, 409);
      }
      const revision = method === "POST"
        ? prompt.revisions.find((item) => item.version === Number(parts[8])) : null;
      if (method === "POST" && !revision) {
        return json({ message: "Versión no encontrada" }, 404);
      }
      prompt.instruction = revision ? revision.instruction : input.instruction.trim();
      prompt.version += 1;
      prompt.source = "custom";
      prompt.updatedAt = "2026-10-12T12:00:00.000Z";
      prompt.updatedByUserId = 31;
      prompt.revisions.unshift({
        version: prompt.version, instruction: prompt.instruction,
        createdAt: prompt.updatedAt, createdByUserId: 31,
      });
      return json({ prompt });
    }
    if (pathname.startsWith("/api/mi-agent/coach/admin/planner-prompts/") && method === "PUT") {
      const channel = pathname.split("/").pop();
      const prompt = plannerPrompts.find((item) => item.channel === channel);
      const input = route.request().postDataJSON();
      if (!prompt || prompt.version !== input.expectedVersion) {
        return json({ message: "El prompt cambió. Recarga antes de guardar." }, 409);
      }
      prompt.instruction = input.instruction.trim();
      prompt.version += 1;
      prompt.source = "custom";
      prompt.updatedAt = "2026-10-11T12:00:00.000Z";
      prompt.updatedByUserId = 31;
      prompt.revisions.unshift({
        version: prompt.version,
        instruction: prompt.instruction,
        createdAt: prompt.updatedAt,
        createdByUserId: 31,
      });
      return json({ prompt });
    }

    if (
      withCustomerHealth &&
      pathname === "/api/commercial-intelligence/account-chat/sessions" &&
      method === "POST"
    ) {
      return json({ session: { id: 920 } }, 201);
    }
    if (
      withCustomerHealth &&
      pathname === "/api/commercial-intelligence/account-chat/jobs" &&
      method === "POST"
    ) {
      customerChatJobCount += 1;
      return json(
        {
          job: {
            id: 920 + customerChatJobCount,
            status: "pending",
            pollAfterMs: 500,
          },
        },
        202,
      );
    }
    if (
      withCustomerHealth &&
      /^\/api\/commercial-intelligence\/account-chat\/jobs\/\d+$/.test(
        pathname,
      ) &&
      method === "GET"
    ) {
      const jobId = Number(pathname.split("/").pop());
      if (jobId <= 920 || jobId > 920 + customerChatJobCount)
        return json({ message: "Chat no encontrado" }, 404);
      return json({
        job: {
          id: jobId,
          status: "completed",
          externalResearchedAt: "2026-09-10T09:30:00.000Z",
          result: {
            source: "account_intelligence",
            sourceDomain: "mixed",
            answer: "La cuenta requiere seguimiento comercial.",
            evidence: ["Snapshot autorizado"],
            inferences: ["Validar continuidad operativa con el cliente."],
            confidence: "high",
            publicSources: ["https://public.example/evidence"],
            ...(withCustomerStageAnswerPrefill
              ? {
                  stageAnswerPrefill: {
                    opportunityId: 300,
                    questionIds: [9001],
                    questionPrompts: ["¿Cuál es el motivo de negocio?"],
                    appendText: "Reporte del vendedor: Evitar fugas de información.",
                  },
                }
              : {}),
            ...(withCustomerChatTrace
              ? {
                  debug: {
                    architecture: "account_chat_v1",
                    issue: {
                      severity: "error",
                      title: "Plan de consulta inválido",
                      block: "B10",
                      message: "Respuesta de diagnóstico",
                    },
                    flow: [
                      { block: "B5", checks: [] },
                      { block: "B6", checks: [] },
                      { block: "B10", checks: [] },
                    ],
                    flowEdges: [
                      {
                        from: "B5",
                        to: "B6",
                        kind: "call",
                        label: "Solicita plan",
                      },
                    ],
                    executionTrace: [
                      {
                        spanId: "trace-b6",
                        lane: "worker",
                        from: "B5",
                        to: "B6",
                        label: "Solicitar plan estructurado",
                        phase: "return",
                        status: "completed",
                        input: { questionLength: 35 },
                        output: { operationKind: "create_contact" },
                      },
                    ],
                    currentTurn: {
                      jobId,
                      chatSessionId: 920,
                      question: "Resume la cuenta",
                      diagnostics: { responseType: "clarification" },
                    },
                    nextTurn: { history: [] },
                  },
                }
              : {}),
            operations: withCustomerContactOperation
              ? [
                  {
                    kind: "create_contact",
                    title: "Crear contacto Oscar Montufar",
                    accountId: 160,
                    contactId: null,
                    targetModule: "contacts",
                    payload: {
                      firstName: "Oscar",
                      lastName: "Montufar",
                    },
                    evidence: [],
                    missingFields: [],
                    requiresConfirmation: true,
                  },
                ]
              : withCustomerOpportunityOperation
                ? [
                    {
                      kind: "create_opportunity",
                      title: "Crear oportunidad Renovación anual",
                      accountId: 160,
                      contactId: null,
                      targetModule: "opportunities",
                      payload: {
                        accountId: 160,
                        name: "Renovación anual",
                        amountUsd: 12000,
                        closeDate: "2027-12-31",
                      },
                      evidence: [],
                      missingFields: [],
                      requiresConfirmation: true,
                    },
                  ]
                : withCustomerStage
                  ? [{
                      kind: "validate_stage", sourceChannel: "customer_account", targetModule: "opportunities",
                      title: "Validar avance de Proyecto abierto", accountId: 160, opportunityId: 300,
                      stageDraftId: "77769f2d-6399-4e7e-9d4e-0601efc57f50", stageRevision: 1, stageObservedVersion: "observed",
                      payload: { accountId: 160, opportunityId: 300 },
                      stageSummary: { accountName: "Cuenta Demo", opportunityName: "Proyecto abierto", currentStageId: 1,
                        currentStageName: "Inicial", targetStageId: 2, targetStageName: "Negociación" },
                      evidence: [], missingFields: [], requiresConfirmation: true,
                    }]
                : withCustomerNote
                  ? [{
                      kind: "opportunity_note", sourceChannel: "customer_account",
                      title: "Registrar nota en Proyecto abierto", accountId: 160, opportunityId: 300,
                      noteText: "El cliente solicita revisar el alcance.",
                      sourceType: "chat_report", attribution: "seller", certainty: "reported",
                      requiresConfirmation: true,
                    }]
                : withCustomerOutcome
                  ? [{
                      kind: "lead_call_outcome", sourceChannel: "customer_account", title: "Registrar llamada Lead 105",
                      accountId: 160, interactionId: 105, outcomeDraftId: "77769f2d-6399-4e7e-9d4e-0601efc57f50", outcomeRevision: 1,
                      outcomeObservedVersion: "observed", outcomeRule: "rule",
                      substatusCode: "contact_attempt_pending", reasonCode: "needs_more_information", requiredActionCode: "collect_missing_context",
                      comment: "", nextActionDueAt: null, referredContactName: "", referredAreaName: "",
                      outcomeSummary: { accountName: "Cuenta Demo", leadLabel: "Lead 105 · Lead ficticio", currentStatus: "Creado",
                        currentResult: "(sin dato)", currentReason: "(sin dato)", currentAction: "(sin dato)", currentComment: "", currentDueDate: null,
                        proposed: { result: "Intento de contacto pendiente", reason: "Requiere más información",
                          action: "Recopilar contexto faltante", status: "Creado" }, timeZone: "America/Mexico_City" },
                      evidence: [], missingFields: [], requiresConfirmation: true,
                    }]
                : withCustomerReschedule
                  ? [{
                      kind: "reschedule_activity", sourceChannel: "customer_account", title: "Reprogramar reunión de Compras",
                      accountId: 160, opportunityId: 300, activityId: 75, targetModule: "calendar",
                      payload: { accountId: 160, activityId: 75 },
                      rescheduleDraftId: "77769f2d-6399-4e7e-9d4e-0601efc57f50", rescheduleRevision: 1, observedVersion: "[300,75]",
                      proposedAt: "2030-10-23T16:00:00.000Z", proposedDueDate: "2030-10-23",
                      scheduleSummary: { accountName: "Cuenta Demo", opportunityName: "Proyecto abierto", activityTitle: "Reunión de Compras",
                        before: "2030-10-20T10:00:00", after: "2030-10-23T10:00:00", timeZone: "America/Mexico_City" },
                      evidence: [], missingFields: [], requiresConfirmation: true,
                    }]
                : withCustomerContactOpportunityLink
                  ? [
                      {
                        kind: "link_contact_to_opportunity",
                        ...(withVersionedCustomerLink ? {
                          linkDraftId: "77769f2d-6399-4e7e-9d4e-0601efc57f50", linkRevision: 1, currentContactId: 602,
                          linkSummary: { accountName: "Cuenta Demo", opportunityName: "Proyecto abierto",
                            contactName: "Ana Compras", currentContactName: "Contacto Anterior", effect: "replace" },
                        } : {}),
                        title: "Vincular Ana Compras a Proyecto abierto",
                        accountId: 160,
                        opportunityId: 300,
                        contactId: 601,
                        targetModule: "opportunities",
                        payload: { accountId: 160, contactId: 601 },
                        evidence: [],
                        missingFields: [],
                        requiresConfirmation: true,
                      },
                    ]
                  : [],
            recommendedActions: [
              {
                title: "Preparar siguiente llamada",
                opportunityId: 300,
                actionType: "call",
                requiresConfirmation: true,
              },
            ],
          },
        },
      });
    }

    if (
      withCustomerContactOperation &&
      pathname === "/api/mi-agent/coach/operations" &&
      method === "POST"
    ) {
      const operation = route.request().postDataJSON()?.operation;
      persistedCustomerContactOperation = {
        id: 903,
        sessionId: 923,
        version: 1,
        status: "ready",
        targetModule: "contacts",
        pendingOperation: operation,
        missingFields: [],
      };
      return json(
        { sessionId: 923, operation: persistedCustomerContactOperation },
        201,
      );
    }
    if (
      (withCustomerOpportunityOperation ||
        withCustomerContactOpportunityLink || withCustomerReschedule || withCustomerOutcome || withCustomerStage || withCustomerNote) &&
      pathname === "/api/mi-agent/coach/operations" &&
      method === "POST"
    ) {
      const operation = route.request().postDataJSON()?.operation;
      if (withCustomerNote && customerNoteFailure === "proposal") {
        return json({ message: "No se pudo preparar la nota de esta cuenta." }, 403);
      }
      const operationId = operation?.kind === "create_opportunity" ? 904 : 905;
      persistedCustomerOpportunityOperation = {
        id: operationId,
        sessionId: 924,
        version: 1,
        status: "ready",
        targetModule: withCustomerOutcome ? "interactions" : withCustomerReschedule ? "calendar" : "opportunities",
        pendingOperation: operation,
        missingFields: [],
      };
      return json(
        { sessionId: 924, operation: persistedCustomerOpportunityOperation },
        201,
      );
    }
    if (withCustomerStage && pathname === "/api/opportunities/300/coach-stage-validation" && method === "POST") {
      stageJobStarted = true;
      return json({ job: { id: "existing-stage-job", status: "pending", pollAfterMs: 10 } }, 202);
    }
    if (withCustomerStage && pathname === "/api/opportunities/300/coach-stage-validation/44a6bf85-cd5a-431e-9697-fd0b2da5e9f6") {
      const advanced = customerStageDecision === "ready_to_advance";
      return json({ operation: { ...persistedCustomerOpportunityOperation,
        status: stageJobStarted ? "completed" : "handed_off",
        result: stageJobStarted ? { validationJobId: "existing-stage-job", outcome: advanced ? "advanced" : "validated_without_advance" } : null },
        validation: stageJobStarted ? { job: { id: "existing-stage-job", status: "completed" }, result: {
          autoAdvanced: advanced, advancedSalesStage: advanced ? { id: 2, name: "Negociación" } : null,
          message: advanced ? "La oportunidad avanzó a Negociación" : "La etapa no está lista para avanzar",
          validation: { decision: customerStageDecision, summary: "Resultado del validador existente", reasons: ["Evidencia revisada"] },
        } } : null });
    }
    if ((withCustomerOutcome || withCustomerNote) && persistedCustomerOpportunityOperation &&
        pathname === `/api/mi-agent/coach/operations/${persistedCustomerOpportunityOperation.id}/review` && method === "POST") {
      if (withCustomerNote && customerNoteFailure === "review") {
        return json({ message: "La nota ya no está disponible para revisión." }, 409);
      }
      persistedCustomerOpportunityOperation = { ...persistedCustomerOpportunityOperation,
        reviewedAt: "2030-10-17T12:00:00Z", version: persistedCustomerOpportunityOperation.version + 1 };
      return json({ operation: persistedCustomerOpportunityOperation });
    }
    if ((withCustomerOutcome || withCustomerNote) && persistedCustomerOpportunityOperation &&
        pathname === `/api/mi-agent/coach/operations/${persistedCustomerOpportunityOperation.id}/execute` && method === "POST") {
      if (failCustomerOutcome) return json({ message: "El lead cambió. Actualiza y revisa nuevamente.", code: "COACH_OUTCOME_STALE" }, 409);
      if (incompleteCustomerOutcome) return json({});
      persistedCustomerOpportunityOperation = { ...persistedCustomerOpportunityOperation, status: "completed",
        version: persistedCustomerOpportunityOperation.version + 1 };
      return json({ operation: persistedCustomerOpportunityOperation });
    }
    if (
      persistedCustomerOpportunityOperation &&
      pathname ===
        `/api/mi-agent/coach/operations/${persistedCustomerOpportunityOperation.id}` &&
      method === "PATCH"
    ) {
      const body = route.request().postDataJSON();
      persistedCustomerOpportunityOperation = {
        ...persistedCustomerOpportunityOperation,
        version: persistedCustomerOpportunityOperation.version + 1,
        pendingOperation: body.pendingOperation,
        missingFields: body.missingFields || [],
      };
      return json({ operation: persistedCustomerOpportunityOperation });
    }
    if (
      persistedCustomerOpportunityOperation &&
      pathname ===
        `/api/mi-agent/coach/operations/${persistedCustomerOpportunityOperation.id}/handoff` &&
      method === "POST"
    ) {
      const token = withVersionedCustomerLink || withCustomerReschedule || withCustomerStage ? "44a6bf85-cd5a-431e-9697-fd0b2da5e9f6"
        : `customer-opportunity-${persistedCustomerOpportunityOperation.id}`;
      return json({
        operation: {
          ...persistedCustomerOpportunityOperation,
          status: "handed_off",
        },
        handoff: {
          token,
          module: withCustomerReschedule ? "calendar" : "opportunities",
          url: `/${withCustomerReschedule ? "calendar" : "opportunities"}?coachDraft=${token}`,
          expiresAt: "2027-10-09T12:00:00.000Z",
        },
      });
    }
    if (
      persistedCustomerOpportunityOperation &&
      pathname ===
        `/api/mi-agent/coach/handoffs/${withVersionedCustomerLink || withCustomerReschedule || withCustomerStage ? "44a6bf85-cd5a-431e-9697-fd0b2da5e9f6" : `customer-opportunity-${persistedCustomerOpportunityOperation.id}`}`
    ) {
      return json({
        handoff: {
          operationId: persistedCustomerOpportunityOperation.id,
          kind: persistedCustomerOpportunityOperation.pendingOperation.kind,
          module: withCustomerReschedule ? "calendar" : "opportunities",
          payload: persistedCustomerOpportunityOperation.pendingOperation,
          entities: {},
          missingFields: [],
          version: persistedCustomerOpportunityOperation.version,
          expiresAt: "2027-10-09T12:00:00.000Z",
        },
      });
    }
    if (withVersionedCustomerLink && pathname === "/api/opportunities/300/coach-contact" && method === "POST") {
      return json({ operation: { ...persistedCustomerOpportunityOperation, status: "completed" } });
    }
    if (withCustomerReschedule && pathname === "/api/opportunities/300/coach-reschedule" && method === "POST") {
      return json({ operation: { ...persistedCustomerOpportunityOperation, status: "completed" } });
    }
    if (withCustomerReschedule && pathname === "/api/commercial-development/calendar") {
      return json({ days: [], sellers: [], alerts: {}, indicators: {} });
    }
    if (
      withCustomerContactOperation &&
      pathname === "/api/mi-agent/coach/operations/903" &&
      method === "PATCH"
    ) {
      const body = route.request().postDataJSON();
      persistedCustomerContactOperation = {
        ...persistedCustomerContactOperation,
        version: 2,
        pendingOperation: body.pendingOperation,
        missingFields: body.missingFields || [],
      };
      return json({ operation: persistedCustomerContactOperation });
    }
    if (
      withCustomerContactOperation &&
      pathname === "/api/mi-agent/coach/operations/903/handoff" &&
      method === "POST"
    ) {
      return json({
        operation: {
          ...persistedCustomerContactOperation,
          status: "handed_off",
        },
        handoff: {
          token: "customer-contact-903",
          module: "contacts",
          url: "/contacts?coachDraft=customer-contact-903",
          expiresAt: "2027-10-09T12:00:00.000Z",
        },
      });
    }
    if (
      withCustomerContactOperation &&
      pathname === "/api/mi-agent/coach/handoffs/customer-contact-903"
    ) {
      return json({
        handoff: {
          operationId: 903,
          kind: "create_contact",
          module: "contacts",
          payload: persistedCustomerContactOperation?.pendingOperation,
          entities: {},
          missingFields: [],
          version: 2,
          expiresAt: "2027-10-09T12:00:00.000Z",
        },
      });
    }

    if (
      withProspect &&
      pathname === "/api/prospect-research/sessions" &&
      method === "POST"
    )
      return json({ session: { id: prospectSession.id } }, 201);
    if (
      withProspect &&
      pathname === "/api/prospect-research/sessions" &&
      method === "GET"
    ) {
      const targetOnly = url.searchParams.get("targetOnly") === "true";
      const items =
        !prospectIsDiscarded && (!targetOnly || prospectIsTarget)
          ? [
              {
                id: prospectSession.id,
                companyName: prospectSession.companyName,
                country: prospectSession.country,
                website: prospectSession.website,
                industry: prospectSession.industry,
                status: prospectSession.status,
                externalResearchedAt:
                  prospectSession.result?.externalResearch?.researchedAt ||
                  null,
                isTarget: prospectIsTarget,
                findingCount: prospectSession.findings.length,
                contactCount: prospectSession.contacts.length,
                hypothesisCount: prospectSession.hypotheses.length,
                runCount: prospectSession.externalResearchRuns?.length || 0,
                latestRunStatus: "completed",
              },
            ]
          : [];
      return json({ items, total: items.length, limit: 25, offset: 0 });
    }
    if (
      withProspect &&
      pathname === `/api/prospect-research/sessions/${prospectSession.id}` &&
      method === "DELETE"
    ) {
      prospectIsDiscarded = true;
      prospectIsTarget = false;
      return json({ discardedCount: 1 });
    }
    if (
      withProspect &&
      pathname ===
        `/api/prospect-research/sessions/${prospectSession.id}/target` &&
      method === "PATCH"
    ) {
      prospectIsTarget = Boolean(route.request().postDataJSON()?.isTarget);
      prospectSession.isTarget = prospectIsTarget;
      return json({ id: prospectSession.id, isTarget: prospectIsTarget });
    }
    if (
      withProspect &&
      pathname === `/api/prospect-research/sessions/${prospectSession.id}/run`
    )
      return json({ session: prospectSession });
    if (
      withProspect &&
      pathname === `/api/prospect-research/sessions/${prospectSession.id}` &&
      method === "GET"
    )
      return json({ session: prospectSession });
    if (
      withProspect &&
      pathname ===
        `/api/prospect-research/sessions/${prospectSession.id}/chat/jobs` &&
      method === "POST"
    ) {
      prospectChatQuestion = route.request().postDataJSON()?.question || "";
      return json(
        { job: { id: 992, sessionId: prospectSession.id, status: "pending" } },
        202,
      );
    }
    if (
      withProspect &&
      pathname ===
        `/api/prospect-research/sessions/${prospectSession.id}/chat/jobs/992` &&
      method === "GET"
    ) {
      const result = {
        source: "prospect_research",
        answer:
          "La hipótesis principal requiere validar continuidad operativa.",
        evidence: ["Hallazgo de la sesión de prospección."],
        inferences: ["Podría existir una iniciativa de modernización."],
        confidence: "medium",
        entities: { accountId: null, opportunityId: null },
        operations: [
          {
            kind: "create_account",
            title:
              "Preparar borrador de correo para José Manuel González Guzmán",
            payload: { actionType: "email_draft" },
            targetModule: "accounts",
            requiresConfirmation: true,
          },
          {
            kind: "create_account",
            title: "Preparar borrador de correo para Erwin Campos Ruiz",
            payload: { actionType: "email_draft" },
            targetModule: "accounts",
            requiresConfirmation: true,
          },
        ],
        recommendedActions: [
          {
            title:
              "Preparar borrador de correo para José Manuel González Guzmán",
            actionType: "email_draft",
            requiresConfirmation: true,
          },
          {
            title: "Preparar borrador de correo para Erwin Campos Ruiz",
            actionType: "email_draft",
            requiresConfirmation: true,
          },
        ],
        qualityTraceId: 993,
        channel: "prospect",
        sessionId: prospectSession.id,
      };
      if (!prospectChatHistoryPersisted) {
        prospectSession.chatHistory = [
          ...(prospectSession.chatHistory || []),
          { role: "user", text: prospectChatQuestion },
          { role: "assistant", text: result.answer, ...result },
        ].slice(-16);
        prospectChatHistoryPersisted = true;
      }
      return json({
        job: {
          id: 992,
          sessionId: prospectSession.id,
          status: "completed",
          result,
        },
      });
    }
    if (
      withProspect &&
      pathname ===
        `/api/prospect-research/sessions/${prospectSession.id}/chat` &&
      method === "POST"
    )
      return json({
        result: {
          source: "prospect_research",
          answer:
            "La hipótesis principal requiere validar continuidad operativa.",
          evidence: ["Hallazgo de la sesión de prospección."],
          inferences: ["Podría existir una iniciativa de modernización."],
          confidence: "medium",
          entities: { accountId: null, opportunityId: null },
          operations: [
            {
              kind: "create_account",
              title:
                "Preparar borrador de correo para José Manuel González Guzmán",
              payload: { actionType: "email_draft" },
              targetModule: "accounts",
              requiresConfirmation: true,
            },
          ],
          recommendedActions: [
            {
              title:
                "Preparar borrador de correo para José Manuel González Guzmán",
              actionType: "email_draft",
              requiresConfirmation: true,
            },
          ],
        },
      });
    if (
      withProspect &&
      pathname ===
        `/api/prospect-research/sessions/${prospectSession.id}/run-external` &&
      method === "POST"
    ) {
      return json(
        {
          job: {
            id: 994,
            sessionId: prospectSession.id,
            status: "pending",
            pollAfterMs: 1,
          },
        },
        202,
      );
    }
    if (
      withProspect &&
      pathname ===
        `/api/prospect-research/sessions/${prospectSession.id}/run-external/994` &&
      method === "GET"
    ) {
      if (timeoutFirstProspectPoll && prospectResearchPollFailureCount === 0) {
        prospectResearchPollFailureCount += 1;
        return route.abort("timedout");
      }
      prospectResearchRunCount += 1;
      prospectSession.status = "completed";
      prospectSession.externalResearchRuns = [
        {
          id: 1000 + prospectResearchRunCount,
          status: "completed",
          findingCount: 1,
          contactCount: 1,
          hypothesisCount: 1,
          targetRoleCount: 1,
          trackResults: [
            {
              key: "public_people",
              label: "Personas y áreas",
              sourceCount: 1,
              findingCount: 0,
              contactCount: 1,
              hypothesisCount: 0,
            },
          ],
          startedAt: new Date().toISOString(),
          warnings: [],
        },
        ...(prospectSession.externalResearchRuns || []),
      ];
      prospectSession.result = {
        ...prospectSession.result,
        externalResearch: {
          enabled: true,
          findingCount: 1,
          contactCount: 1,
          hypothesisCount: 1,
          newFindingCount: prospectResearchRunCount === 1 ? 1 : 0,
          updatedFindingCount: 0,
          unchangedFindingCount: prospectResearchRunCount > 1 ? 1 : 0,
          researchedAt: new Date().toISOString(),
          warnings: [],
          trackResults: [
            {
              key: "public_people",
              label: "Personas y áreas",
              sourceCount: 1,
              findingCount: 0,
              contactCount: 1,
              hypothesisCount: 0,
            },
          ],
          targetRoles: [
            {
              roleTitle: "Responsable de infraestructura",
              area: "Tecnología",
              rationale: "Puede validar el alcance técnico de la señal.",
              validationQuestion: "¿Quién lidera esta plataforma?",
              basisFindingTitle: "Señal pública",
              sourceReference: "https://example.com/evidence",
              researchTracks: ["technology_signals"],
            },
          ],
          sellerBrief: {
            whyNow: "La fuente describe una iniciativa reciente.",
            recommendedOpening: "¿Cómo están abordando esta iniciativa?",
            discoveryQuestions: ["¿Qué resultado buscan conseguir?"],
            sourceReferences: ["https://example.com/evidence"],
          },
        },
      };
      prospectSession.findings = prospectSession.findings.map((finding) => ({
        ...finding,
        lastResearchObservation:
          prospectResearchRunCount === 1 ? "new" : "unchanged",
      }));
      return json({
        job: { id: 994, status: "completed", session: prospectSession },
      });
    }
    if (
      withProspect &&
      pathname ===
        `/api/prospect-research/sessions/${prospectSession.id}/convert-to-account`
    ) {
      if (withProspectDuplicates) {
        return json(
          {
            message:
              "No se puede crear una cuenta desde esta prospección porque se encontraron posibles duplicados",
            duplicateCandidates: prospectSession.duplicateReview.candidates,
          },
          409,
        );
      }
      prospectSession.convertedAccountId = 777;
      return json({ accountId: 777, reused: false }, 201);
    }
    if (
      withProspect &&
      pathname ===
        `/api/prospect-research/sessions/${prospectSession.id}/convert-to-lead`
    )
      return json({ interactionId: 812 }, 201);
    if (
      withProspect &&
      pathname === `/api/prospect-research/contacts/901/convert`
    )
      return json({ accountId: 777, contactId: 650 }, 201);
    if (
      withProspect &&
      pathname === "/api/prospect-research/hypotheses/902/confirm"
    )
      return json({
        hypothesis: { ...prospectSession.hypotheses[0], status: "confirmed" },
      });
    if (
      withProspect &&
      pathname ===
        "/api/prospect-research/hypotheses/902/convert-to-opportunity"
    )
      return json({ opportunityId: 850, accountId: 777, contactId: 650 }, 201);

    if (pathname === "/api/auth/bootstrap-status")
      return json({ hasUsers: true });
    if (pathname === "/api/auth/me") {
      return json({
        id: 31,
        full_name: "Demo Seller",
        email: "seller@example.com",
        status: "active",
        roles: [{ name: canAdmin ? "Administrador" : "Vendedor" }],
        permissions: [
          ...(withCoachModuleAccess ? ["mi_coach.access"] : []),
          ...(withCoachAccess ? ["mi_coach.use"] : []),
          "mi_coach.execute",
          "cuentas.read",
          "oportunidades.read",
          "desarrollo_comercial.update",
          "calendario_comercial.update",
          "fuentes_externas.execute",
          ...(withProspect
            ? [
                "prospeccion.read",
                "prospeccion.create",
                "prospeccion.update",
                "cuentas.create",
                "contactos.create",
                "interacciones.create",
                "interacciones.update",
                "oportunidades.create",
              ]
            : []),
          ...(withProspectChatAccess ? ["prospeccion.access"] : []),
          ...(withCustomerHealth
            ? ["inteligencia_comercial.read", "contactos.read"]
            : []),
          ...(withCustomerChatAccess
            ? ["inteligencia_comercial.access"]
            : []),
          ...(withCustomerContactOperation ? ["contactos.create"] : []),
          ...(withCustomerOpportunityOperation
            ? ["oportunidades.create", "contactos.read"]
            : []),
          ...(withCustomerContactOpportunityLink || withCustomerStageAnswerPrefill || withCustomerReschedule || withCustomerStage || withCustomerNote
            ? ["oportunidades.update"]
            : []),
          ...(withCustomerContactUpdate ? ["contactos.update"] : []),
          ...(withLeadRead ? ["interacciones.read"] : []),
          ...(withCustomerOutcome ? ["interacciones.read", "interacciones.update"] : []),
          ...(canAdmin ? ["mi_coach.admin"] : []),
          ...(canDiagnoseCustomerChats ? ["mi_coach.chat_diagnostics"] : []),
        ],
      });
    }
    if (pathname === "/api/mi-agent/context") {
      return json({
        period: { label: "Q3 2026", baseCurrencyCode: quotaCurrencyCode },
        quota: {
          assignedAmount: quotaCurrencyCode === "USD" ? 100000 : 1750000,
          actualAmount: currencyConversionAvailable
            ? quotaCurrencyCode === "USD"
              ? 25000
              : 437500
            : null,
          gapAmount: currencyConversionAvailable
            ? quotaCurrencyCode === "USD"
              ? 75000
              : 1312500
            : null,
          committedOpenAmount: 50000,
          weightedOpenAmount: 50000,
          currencyCode: quotaCurrencyCode,
        },
        currencyConversion: {
          available: currencyConversionAvailable,
          baseCurrencyCode: "USD",
          targetCurrencyCode: quotaCurrencyCode,
          usdToTargetRate: currencyConversionAvailable ? usdToTargetRate : null,
          fetchedAt: currencyConversionAvailable
            ? "2026-09-27T00:00:00.000Z"
            : null,
        },
        workboard: withSituationAnalysis
          ? [
              {
                id: 501,
                name: "Renovación crítica",
                accountName: "Cuenta Demo",
                amountUsd: 60000,
                stageCode: "negociacion",
                stageName: "Negociación",
                riskLevel: "high",
                riskReasons: ["Sin actividad reciente"],
              },
            ]
          : [],
        inactivePipelineOpportunities: withOpportunityStatusMatrix
          ? [
              {
                id: 505,
                name: "Oportunidad desactivada terminal",
                accountName: "Cuenta Demo",
                activationStatusCode: "desactivada",
                activationStatusName: "Desactivada",
                commercialStatusCode: "ganada",
                lifecycle: "inactive",
              },
            ]
          : [],
        coachOpportunities: withSituationAnalysis
          ? [
              {
                id: 501,
                name: "Renovación crítica",
                accountName: "Cuenta Demo",
                amountUsd: 60000,
                stageCode: "negociacion",
                stageName: "Negociación",
                lifecycle: "open",
                riskLevel: "high",
              },
              {
                id: 502,
                name: "Oportunidad inicial",
                accountName: "Cuenta Alterna",
                amountUsd: 25000,
                stageCode: "contacto_inicial",
                stageName: "Contacto inicial",
                lifecycle: "open",
              },
              {
                id: 503,
                name: "Oportunidad ganada",
                amountUsd: 40000,
                lifecycle: "historical",
              },
              {
                id: 504,
                name: "Oportunidad inactiva",
                amountUsd: 35000,
                lifecycle: "inactive",
              },
            ]
          : [],
        accounts: withResponseContextSwitch
          ? [
              { id: 160, name: "Cuenta Demo" },
              { id: 170, name: "Cuenta Alterna" },
            ]
          : [],
        wonOpportunities: withHistoricalOpportunityContext
          ? [
              {
                id: 301,
                name: "Renovación ganada",
                amountUsd: 41560,
                stageName: "Waiting",
                account: { id: 160, name: "Cuenta Demo" },
              },
            ]
          : [],
        lostOpportunities: withHistoricalOpportunityContext
          ? [
              {
                id: 302,
                name: "Proyecto perdido",
                amountUsd: 12000,
                stageName: "Negociación",
                account: { id: 160, name: "Cuenta Demo" },
              },
            ]
          : [],
        cancelledOpportunities: withHistoricalOpportunityContext
          ? [
              {
                id: 303,
                name: "Proyecto anulado",
                amountUsd: 8000,
                stageName: "Cotización",
                account: { id: 160, name: "Cuenta Demo" },
              },
            ]
          : [],
        leads: [],
        contactMappings: [],
        summary: { openOpportunities: 0, riskyOpportunities: 0 },
      });
    }
    if (pathname === "/api/interactions/701" && method === "GET") {
      return json({
        id: 701,
        title: "Lead seleccionado por Coach",
        leadSource: "empresa_marketing",
        sourceNotes: "Solicitud de seguimiento detallado.",
        summary: "Lead autorizado para revisión.",
        topics: [],
        actionsTaken: [],
        nextSteps: [],
        suggestedContacts: [],
        suggestedOpportunities: [],
      });
    }
    if (pathname === "/api/interactions/resolution-options") {
      return json({
        businessLines: [],
        sellerUsers: [],
        presalesUsers: [],
        currentUserIsSellerEligible: false,
      });
    }
    if (pathname === "/api/mi-agent/analyze" && method === "POST")
      return json(
        { job: { id: 910, status: "pending", pollAfterMs: 500 } },
        202,
      );
    if (pathname === "/api/mi-agent/analyze/jobs/910")
      return json({
        job: { id: 910, status: "completed" },
        result: {
          headline: "Atiende la renovación crítica",
          summary: "La cuenta requiere confirmar el calendario de decisión.",
          quotaReadout: "Avance trimestral con brecha pendiente.",
          activityProgress: {
            message: "La actividad reciente no se ha traducido en avance.",
            activityCount: 3,
            progressedOpportunities: 1,
            opportunitiesWithoutProgress: 1,
            details: [
              {
                opportunityId: 501,
                opportunityName: "Renovación crítica",
                accountName: "Cuenta Demo",
                activityCount: 2,
                activityWithoutProgress: true,
              },
            ],
          },
          alerts: [
            {
              code: "activity_without_progress",
              severity: "high",
              title: "Actividad sin progreso",
              opportunityId: 501,
              opportunityName: "Renovación crítica",
              accountName: "Cuenta Demo",
              evidence: "Dos actividades sin cambio comercial.",
              action: "Confirmar el calendario de decisión.",
            },
          ],
          actions: [
            {
              rank: 1,
              opportunityId: 501,
              title: "Confirmar calendario de decisión",
              opportunityName: "Renovación crítica",
              accountName: "Cuenta Demo",
              stageName: "Negociación",
              priority: "high",
              status: "pending",
              reason: "La oportunidad no avanza pese a la actividad.",
              risk: "El calendario de decisión no está confirmado.",
              expectedOutcome: "Obtener fecha de decisión validada.",
              successCriteria: "Registrar fecha y responsable.",
              actionType: "call",
              questions: ["¿Cuándo tomarán la decisión final?"],
            },
          ],
        },
      });
    if (pathname === "/api/mi-agent/coach" && method === "POST")
      return json(
        {
          sessionId: 71,
          job: { id: 711, status: "pending", pollAfterMs: 1000 },
        },
        202,
      );
    if (pathname === "/api/mi-agent/coach/jobs/711")
      return json({
        job: { id: 711, status: "completed" },
        result: {
          intent: "context_query",
          responseType: "informational",
          answer:
            "La oportunidad Proyecto B de Cuenta Alterna tiene seguimiento activo.",
          confidence: "high",
          facts: [],
          evidence: [],
          inferences: [],
          pendingItems: [],
          recommendation: null,
          operations: [],
          clarification: null,
          entities: {
            accountId: 170,
            opportunityId: 320,
            contactId: null,
            leadId: null,
            names: ["Proyecto B"],
          },
          activeContext: {
            accountId: 170,
            opportunityId: 320,
            contactId: null,
            leadId: null,
          },
          activeContextSource: "coach_response",
        },
      });
    if (
      method === "POST" &&
      /^\/api\/mi-agent\/coach\/sessions\/\d+\/close$/.test(pathname)
    ) {
      const sessionId = Number(pathname.split("/").at(-2));
      closedCoachSessions.add(sessionId);
      return json({ session: { id: sessionId, status: "closed" } });
    }
    if (
      method === "POST" &&
      /^\/api\/mi-agent\/coach\/operations\/\d+\/status$/.test(pathname)
    ) {
      const operationId = Number(pathname.split("/").at(-2));
      return json({
        operation: { id: operationId, status: "cancelled" },
      });
    }
    if (
      withCoachInterface &&
      [
        "/api/mi-agent/coach/sessions/active",
        "/api/mi-agent/coach/sessions/70",
      ].includes(pathname)
    ) {
      if (
        pathname === "/api/mi-agent/coach/sessions/active" &&
        closedCoachSessions.has(70)
      ) {
        return json({ session: null, operations: [], recentOperations: [] });
      }
      return json({
        session: {
          id: 70,
          context: { opportunityId: 22 },
          messages: [
            {
              id: "coach-restored",
              role: "coach",
              result: {
                responseType: "recommendation",
                confidence: "high",
                answer: "La oportunidad aún no está lista para avanzar.",
                facts: [
                  {
                    sourceType: "opportunity",
                    sourceId: 22,
                    label: "Etapa actual: Desarrollo",
                    excerpt: "La oportunidad permanece abierta.",
                  },
                ],
                evidence: ["No existe una fecha confirmada por el cliente."],
                inferences: ["El calendario de decisión podría desplazarse."],
                recommendation: "Confirmar la fecha de decisión esta semana.",
                operations: [],
                stageReadiness: {
                  currentStage: {
                    id: 2,
                    code: "development",
                    name: "Desarrollo",
                    objective:
                      "Confirmar necesidad, responsables y calendario.",
                  },
                  confirmedProgress: [
                    {
                      title: "Necesidad confirmada",
                      detail: "El cliente confirmó el problema principal.",
                      evidence: [
                        {
                          sourceType: "stage_answer",
                          sourceId: 5,
                          label: "Necesidad del cliente",
                          excerpt: "Reducir interrupciones del servicio.",
                        },
                      ],
                    },
                  ],
                  pendingItems: [
                    {
                      title: "Fecha de decisión",
                      detail: "Pregunta obligatoria sin respuesta.",
                      evidence: [
                        {
                          sourceType: "process_guide",
                          sourceId: null,
                          label: "Pregunta definida por el proceso comercial",
                          excerpt: "¿Cuándo se tomará la decisión?",
                        },
                      ],
                    },
                  ],
                  risks: [],
                  nextStep: {
                    action: "Confirmar calendario con el cliente",
                    responsibleUserId: 31,
                    targetDate: "2026-09-30",
                    successCriteria: "Registrar una fecha confirmada.",
                  },
                  recommendation: "remain",
                  rationale: "Falta una respuesta obligatoria de la etapa.",
                },
              },
            },
          ],
        },
        operations: withCoachPendingOperations
          ? [
              {
                id: 81,
                kind: "activity",
                status: "collecting",
                version: 2,
                targetModule: "calendar",
                missingFields: ["scheduledAt"],
                pendingOperation: {
                  kind: "activity",
                  title: "Seguimiento de decisión",
                  opportunityId: 22,
                  actionType: "call",
                  priority: "medium",
                  scheduledAt: "",
                  missingFields: ["scheduledAt"],
                },
              },
              {
                id: 82,
                kind: "account_field",
                status: "ready",
                version: 1,
                targetModule: "accounts",
                missingFields: [],
                pendingOperation: {
                  kind: "account_field",
                  title: "Actualizar ciudad",
                  accountId: 160,
                  field: "city",
                  value: "Monterrey",
                },
              },
              {
                id: 83,
                kind: "create_account",
                status: "handed_off",
                version: 3,
                targetModule: "accounts",
                targetRoute: "/accounts",
                handedOffAt: "2026-09-26T12:00:00.000Z",
                handoffExpiresAt: "2027-09-27T12:00:00.000Z",
                missingFields: [],
                pendingOperation: {
                  kind: "create_account",
                  title: "unknown",
                  payload: { name: "Acme" },
                },
              },
            ]
          : [],
        recentOperations: [
          {
            id: 79,
            kind: "opportunity_field",
            status: "completed",
            completedAt: "2026-09-26T11:30:00.000Z",
            pendingOperation: {
              kind: "opportunity_field",
              title: "Actualizar importe",
            },
          },
        ],
      });
    }
    if (pathname.startsWith("/api/accounts"))
      return json(
        withResponseContextSwitch
          ? [
              { id: 160, name: "Cuenta Demo" },
              { id: 170, name: "Cuenta Alterna" },
            ]
          : withCustomerHealth
            ? [
                { id: 160, name: "Cuenta Demo" },
                { id: 170, name: "Cuenta Alterna" },
              ]
            : [],
      );
    if (
      (withCustomerOpportunityOperation ||
        withCustomerContactOpportunityLink ||
        withCustomerStage ||
        withCustomerStageAnswerPrefill) &&
      pathname.startsWith("/api/catalogs/opportunity-")
    ) {
      const opportunityCatalogs = {
        "/api/catalogs/opportunity-accounts": [
          { id: 160, name: "Cuenta Demo" },
        ],
        "/api/catalogs/opportunity-contacts": [
          {
            id: 601,
            name: "Ana Compras",
            full_name: "Ana Compras",
            account_id: 160,
          },
        ],
        "/api/catalogs/opportunity-seller-users": [
          { id: 31, name: "Demo Seller", full_name: "Demo Seller" },
        ],
        "/api/catalogs/opportunity-presales-users": [],
        "/api/catalogs/opportunity-business-lines": [
          { id: 1, name: "Servicios" },
        ],
        "/api/catalogs/opportunity-sales-stages": [
          { id: 1, code: "contacto_inicial", name: "Contacto Inicial" },
        ],
        "/api/catalogs/opportunity-activation-statuses": [
          { id: 1, code: "activada", name: "Activada" },
        ],
        "/api/catalogs/opportunity-commercial-statuses": [
          { id: 1, code: "en_proceso", name: "En proceso" },
        ],
      };
      return json(opportunityCatalogs[pathname] || []);
    }
    if (pathname === "/api/opportunities")
      return json(
        withResponseContextSwitch && url.searchParams.get("accountId") === "160"
          ? [
              {
                id: 300,
                name: "Proyecto A",
                amount_usd: 20000,
                sales_stage: "Desarrollo",
                account_id: 160,
                account: { id: 160, name: "Cuenta Demo" },
              },
            ]
          : withResponseContextSwitch &&
              url.searchParams.get("accountId") === "170"
            ? [
                {
                  id: 320,
                  name: "Proyecto B",
                  amount_usd: 35000,
                  sales_stage: "Negociación",
                  account_id: 170,
                  account: { id: 170, name: "Cuenta Alterna" },
                },
              ]
            : withHistoricalOpportunityContext
              ? [
                  {
                    id: 300,
                    name: "Proyecto abierto",
                    amount_usd: 20000,
                    sales_stage: "Desarrollo",
                  },
                ]
              : [],
      );
    if (
      (withCustomerContactOpportunityLink || withCustomerStageAnswerPrefill || withCustomerStage) &&
      pathname === "/api/opportunities/300"
    ) {
      return json({
        id: 300,
        name: "Proyecto abierto",
        amount_usd: 20000,
        account_id: 160,
        close_date: "2026-10-30",
        contact_id: 601,
        sales_stage_id: 1,
        business_line_id: 1,
        seller_user_id: 31,
        activation_status_id: 1,
        activation_status: "Activada",
        commercial_status: "En proceso",
      });
    }
    if (
      (withCustomerContactOpportunityLink || withCustomerStageAnswerPrefill || withCustomerStage) &&
      pathname === "/api/opportunities/300/commercial-context"
    ) {
      return json({
        opportunityId: 300,
        salesStage: {
          id: 1,
          code: "contacto_inicial",
          name: "Contacto Inicial",
        },
        commercialStatus: { code: "en_proceso" },
        ...(withCustomerStageAnswerPrefill
          ? {
              isSelectedStageCurrent: true,
              answers: [
                {
                  question_id: 9001,
                  prompt: "¿Cuál es el motivo de negocio?",
                  response_type: "long_text",
                  answer_value: "Respuesta previa.",
                  is_required: true,
                },
              ],
            }
          : {}),
      });
    }
    if (
      (withCustomerContactOpportunityLink || withCustomerStageAnswerPrefill || withCustomerStage) &&
      pathname === "/api/opportunities/300/documents"
    ) {
      return json([]);
    }
    if (pathname === "/api/contacts/601" && withCustomerHealth) {
      return json({
        id: 601,
        account_id: 160,
        first_name: "Ana",
        last_name: "Compras",
        full_name: "Ana Compras",
        position_title: "Directora de compras",
        purchase_participation: "decide_final",
        hierarchy_level: "directivo",
        relationship_type: "fuerte",
        influence_level: "decide",
        activation_status: "activado",
      });
    }
    if (pathname === "/api/contacts") {
      return json(
        withCustomerHealth
          ? [
              {
                id: 601,
                account_id: 160,
                first_name: "Ana",
                last_name: "Compras",
                full_name: "Ana Compras",
                position_title: "Directora de compras",
                purchase_participation: "decide_final",
                hierarchy_level: "directivo",
                relationship_type: "fuerte",
                influence_level: "decide",
                activation_status: "activado",
              },
            ]
          : [],
      );
    }
    if (pathname === "/api/catalogs/contact-accounts") {
      return json([{ id: 160, name: "Cuenta Demo" }]);
    }
    if (pathname.startsWith("/api/catalogs/contact-")) {
      if (withCustomerContactOperation) {
        const catalogs = {
          "/api/catalogs/contact-purchase-participations": [
            { id: 1, code: "ninguno", name: "Ninguno" },
          ],
          "/api/catalogs/contact-activation-statuses": [
            { id: 1, code: "activado", name: "Activado" },
          ],
        };
        return json(catalogs[pathname] || []);
      }
      return json([]);
    }
    if (
      pathname === "/api/commercial-intelligence/account-intelligence/snapshot"
    ) {
      customerSnapshot = {
        snapshotVersion: "account-intelligence.v1",
        capturedAt: "2026-09-23T12:00:00.000Z",
        account: {
          id: 160,
          name: "Cuenta Demo",
          website: "https://cuenta-demo.example",
          city: "Monterrey",
          stateRegion: "Nuevo León",
          description: "Cliente de soluciones de seguridad empresarial.",
        },
        contacts: [
          {
            id: 601,
            name: "Ana Compras",
            positionTitle: "Directora de compras",
            department: "Compras",
            purchaseParticipation: "decide_final",
            hierarchyLevel: "directivo",
            relationshipType: "fuerte",
            influenceLevel: "decide",
            managerContactId: null,
            influencesContactId: null,
          },
        ],
        opportunities: [
          {
            id: 300,
            name: "Proyecto abierto",
            lifecycle: "open",
            amountUsd: 20000,
            closeDate: "2026-10-30",
            stageName: "Desarrollo",
            commercialStatusCode: "en_proceso",
            activationStatusCode: "activada",
          },
          {
            id: 301,
            name: "Renovación ganada",
            amountUsd: 41560,
            stageName: "Waiting",
            commercialStatusCode: "ganada",
            activationStatusCode: "activada",
          },
          {
            id: 302,
            name: "Proyecto perdido",
            amountUsd: 12000,
            stageName: "Negociación",
            commercialStatusCode: "perdida",
            activationStatusCode: "activada",
          },
          {
            id: 303,
            name: "Proyecto anulado",
            amountUsd: 8000,
            stageName: "Cotización",
            commercialStatusCode: "anulada",
            activationStatusCode: "activada",
          },
        ],
        inactiveOpportunities: [
          {
            id: 304,
            name: "Proyecto desactivado",
            amountUsd: 9000,
            stageName: "Desarrollo",
            commercialStatusCode: "en_proceso",
            activationStatusCode: "desactivada",
          },
        ],
        interactions: [
          {
            id: 701,
            title: "Revisión de renovación",
            summary: "Validar alcance y fecha de renovación.",
            updatedAt: "2026-09-26T14:00:00.000Z",
          },
        ],
        activities: [],
        renewals: [
          {
            id: 801,
            opportunityId: 301,
            providerId: 9,
            providerName: "Proveedor Demo",
            statusCode: "vigente",
            expiresAt: "2026-11-15",
            renewalCount: 1,
          },
        ],
        products: [
          {
            quotationId: 901,
            quotationVersionId: 902,
            opportunityId: 301,
            providerName: "Proveedor Demo",
            itemType: "servicio",
            description: "Servicio WAAP",
            quantity: 1,
            currencyCode: "USD",
            commercialStatus: "won",
            fulfillmentStatus: "not_verified",
          },
          {
            quotationId: 903,
            quotationVersionId: 904,
            opportunityId: 300,
            providerName: "Proveedor Alterno",
            itemType: "producto",
            description: "Firewall Perimetral",
            quantity: 2,
            currencyCode: "USD",
            commercialStatus: "accepted",
            fulfillmentStatus: "not_verified",
          },
        ],
        permissions: {
          canReadAccounts: true,
          canReadContacts: true,
          canReadOpportunities: true,
          canReadInteractions: true,
        },
        expansionHypotheses: [
          {
            type: "renewal",
            title: "Preparar renovación de Proveedor Demo",
            summary: "Validar continuidad antes del vencimiento.",
            evidence: "Vencimiento: 2026-11-15.",
            confidence: "high",
            opportunityId: 301,
            requiresConfirmation: true,
          },
          {
            type: "cross_sell",
            title: "Explorar solución complementaria: Seguridad",
            summary: "Hipótesis",
            evidence: "Producto actual: Servicio WAAP.",
            confidence: "low",
            opportunityId: 22,
            requiresConfirmation: true,
          },
        ],
        supportCases: [],
        dataAvailability: { products: true, supportCases: false },
        accountHealth: {
          status: "at_risk",
          score: 55,
          signals: [
            {
              code: "stale_account_activity",
              severity: "high",
              title: "Actividad comercial atrasada",
              summary:
                "La cuenta no tiene una interacción reciente accesible.",
              evidence: "Última interacción hace 30 días.",
            },
            {
              code: "relationship_map_incomplete",
              severity: "medium",
              title: "Mapa de relación incompleto",
              summary: "Faltan relaciones de contactos.",
              evidence: "Ana Compras",
            },
          ],
          metrics: {
            contactCount: 1,
            opportunityCount: 4,
            riskyOpportunityCount: 1,
            interactionCount: 1,
            daysSinceLastInteraction: 30,
            renewalCount: 0,
            productCount: 2,
          },
        },
      };
      return json({ snapshot: customerSnapshot });
    }
    if (
      pathname ===
        "/api/commercial-intelligence/account-internal-analysis/jobs" &&
      method === "POST"
    )
      return json({ job: { id: 703, status: "pending" } }, 202);
    if (
      pathname ===
      "/api/commercial-intelligence/account-internal-analysis/jobs/703"
    ) {
      return json({
        job: {
          id: 703,
          status: "completed",
          result: {
            sourceDomain: "crm_internal",
            summary: "Análisis interno listo.",
            snapshot: customerSnapshot,
            generatedAt: "2026-09-23T12:00:00.000Z",
            writesPerformed: false,
          },
          findings: withCustomerHealth
            ? [
                {
                  id: 704,
                  title: "Hallazgo interno redundante",
                  summary: "Este detalle no debe mostrarse como tarjeta.",
                  category: "need",
                  sourceReference: "account:160:description",
                  status: "suggested",
                  accountId: 160,
                },
                {
                  id: 705,
                  title: "Información adicional por validar",
                  summary: "Validar presupuesto antes de avanzar.",
                  category: "missing_information",
                  certainty: "confirmed",
                  status: "suggested",
                  sourceReference: "account:160:budget",
                  accountId: 160,
                },
              ]
            : [],
        },
      });
    }
    if (
      pathname === "/api/commercial-intelligence/findings/704/confirm" &&
      method === "POST"
    ) {
      return json({
        finding: {
          id: 704,
          title: "Hallazgo interno redundante",
          summary: "Este detalle no debe mostrarse como tarjeta.",
          category: "need",
          status: "confirmed",
          accountId: 160,
        },
      });
    }
    if (
      pathname === "/api/commercial-intelligence/executive-briefing/jobs" &&
      method === "POST"
    )
      return json({ job: { id: 700, status: "pending" } }, 202);
    if (
      pathname === "/api/commercial-intelligence/executive-briefing/jobs/700"
    ) {
      return json({
        job: {
          id: 700,
          status: "completed",
          result: {
            headline: "Resumen ejecutivo de Cuenta Demo",
            summary: "Cuenta con señales de atención.",
            executiveBriefing: {
              healthScore: 55,
              recentChanges: [],
              prioritizedRisks: [
                {
                  title: "Actividad comercial atrasada",
                  summary: "Sin interacción reciente.",
                  evidence: "30 días",
                },
              ],
              meetingQuestions: ["¿Qué cambió?"],
              nextBestStep: "Contactar al cliente esta semana",
              recommendedActions: [
                {
                  title: "Agendar seguimiento",
                  actionType: "call",
                  opportunityId: "22",
                  successCriteria: "Confirmar siguiente hito.",
                },
              ],
            },
          },
        },
      });
    }
    if (
      pathname === "/api/commercial-intelligence/commercial-discovery/jobs" &&
      method === "POST"
    )
      return json({ job: { id: 704, status: "pending" } }, 202);
    if (
      pathname === "/api/commercial-intelligence/commercial-discovery/jobs/704"
    ) {
      return json({
        job: {
          id: 704,
          status: "completed",
          result: {
            headline: "Briefing de llamada",
            summary: "Preparación comercial lista.",
            briefing: {
              objective: "Validar el siguiente hito.",
              targetContact: "Responsable de tecnología",
              questions: ["¿Qué cambió?"],
              risks: ["Actividad atrasada"],
              callGuide: ["Confirmar prioridades"],
              nextSteps: [],
            },
          },
        },
      });
    }
    if (
      pathname === "/api/commercial-intelligence/agents/jobs" &&
      method === "POST"
    )
      return json({ job: { id: 701, status: "pending" } }, 202);
    if (pathname === "/api/commercial-intelligence/agents/jobs/701")
      return json({
        job: {
          id: 701,
          status: "completed",
          result: {
            writesPerformed: false,
            sourceDomain: "public_web",
            agents: [
              {
                agentId: "crm_context",
                status: "completed",
                summary: "Contexto CRM disponible.",
                sourceDomain: "crm_internal",
                findings: [],
                confidence: "high",
              },
              {
                agentId: "commercial_health",
                status: "completed",
                summary: "Salud estable.",
                sourceDomain: "crm_internal",
                findings: [],
                confidence: "medium",
              },
              ...(withCustomerHealth
                ? [
                    {
                      agentId: "public_research",
                      status: "completed",
                      summary: "Señal pública encontrada.",
                      sourceDomain: "public_web",
                      evidence: ["https://public.example/evidence"],
                      findings: [
                        {
                          title: "Proyecto de modernización anunciado",
                          summary: "La empresa anunció un proyecto.",
                          evidenceText: "Nota pública consultada.",
                          sourceUrl: "https://public.example/evidence",
                          certainty: "evidenced",
                          confidence: "medium",
                        },
                      ],
                      confidence: "medium",
                    },
                  ]
                : []),
            ],
          },
        },
      });
    if (
      pathname === "/api/commercial-intelligence/account-chat/jobs" &&
      method === "POST"
    )
      return json({ job: { id: 702, status: "pending" } }, 202);
    if (pathname === "/api/commercial-intelligence/account-chat/jobs/702")
      return json({
        job: {
          id: 702,
          status: "completed",
          result: {
            source: "account_intelligence",
            sourceDomain: "mixed",
            answer: "La cuenta requiere seguimiento comercial.",
            evidence: ["Snapshot autorizado"],
            inferences: ["La renovación podría ampliarse a otra área."],
            confidence: "medium",
            publicSources: ["https://public.example/evidence"],
            recommendedActions: [
              {
                title: "Validar ampliación",
                opportunityId: 300,
                actionType: "call",
                notes: "Confirmar necesidad.",
                successCriteria: "Cliente confirma interés.",
                requiresConfirmation: true,
              },
            ],
          },
        },
      });
    if (
      pathname === "/api/commercial-intelligence/governance" &&
      method === "GET"
    ) {
      return json({
        settings: {
          externalSourcesEnabled: false,
          includeWonOpportunities: true,
          includeLostOpportunities: true,
          includeCancelledOpportunities: false,
          dailyResearchLimitPerUser: 25,
          findingRetentionDays: 365,
          requireEvidenceForExternalFindings: true,
          allowProspectConversion: true,
          notes: "Configuracion inicial",
        },
        metrics: {
          jobsLast30Days: [],
          findingsLast30Days: [],
          prospectSessionsLast30Days: [],
        },
      });
    }
    if (
      pathname === "/api/commercial-intelligence/governance/settings" &&
      method === "PUT"
    ) {
      return json({
        settings: route.request().postDataJSON(),
        metrics: {
          jobsLast30Days: [],
          findingsLast30Days: [],
          prospectSessionsLast30Days: [],
        },
      });
    }
    return json({});
  });
}

async function openCoachConversation(page) {
  await page.getByRole("button", { name: "Mi Coach", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Vistas de Mi Coach" })
    .getByRole("button", { name: "Conversación", exact: true })
    .click();
}

async function openMiCoach(page, { workspace = "coach" } = {}) {
  await page.addInitScript(
    (token) => window.localStorage.setItem("crm_token", token),
    "jwt-token",
  );
  await page.goto("/mi-agent");
  await expect(page.getByRole("heading", { name: "Mi Coach" })).toBeVisible();
  if (workspace === "coach") await openCoachConversation(page);
  if (workspace === "prospect")
    await page.getByRole("button", { name: "Cuenta nueva" }).click();
  if (workspace === "customer")
    await page.getByRole("button", { name: "Cliente existente" }).click();
}

async function mockCustomerChatRecovery(page) {
  await mockMiCoachApi(page, { withCustomerHealth: true });
  const answer = "La oportunidad Vrf 2027 tiene un monto de 2,000,000 USD.";
  const state = {
    submissions: 0,
    polls: 0,
    failuresRemaining: 0,
    failureStatus: 503,
    pendingPolls: 0,
    emptyResult: false,
    failed: false,
    historySaved: false,
    wrongAccount: false,
    holdPoll: null,
    holdSubmission: null,
  };
  const history = [
    { role: "user", text: "¿Cuál es el monto de la oportunidad?" },
    { role: "assistant", text: "¿A qué oportunidad te refieres?" },
  ];
  await page.addInitScript(() => {
    window.sessionStorage.setItem("mi-agent-customer-chat-session:160", "920");
  });
  await page.route("**/api/commercial-intelligence/account-chat/sessions/920", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        session: {
          id: 920, accountId: 160,
          history: state.historySaved ? [
            ...history,
            { role: "user", text: "Vrf 2027." },
            { role: "assistant", text: answer, turnDebug: { currentTurn: { jobId: 921 } } },
          ] : history,
        },
      }),
    }),
  );
  await page.route("**/api/commercial-intelligence/account-chat/jobs", async (route) => {
    state.submissions += 1;
    if (state.holdSubmission) await state.holdSubmission;
    return route.fulfill({
      status: 202, contentType: "application/json",
      body: JSON.stringify({ job: { id: 921, status: "pending" } }),
    });
  });
  await page.route("**/api/commercial-intelligence/account-chat/jobs/921", async (route) => {
    state.polls += 1;
    if (state.holdPoll) await state.holdPoll;
    if (state.failuresRemaining > 0) {
      state.failuresRemaining -= 1;
      return route.fulfill({
        status: state.failureStatus, contentType: "application/json",
        body: JSON.stringify({ message: "No se pudo consultar el resultado" }),
      });
    }
    if (state.pendingPolls > 0) {
      state.pendingPolls -= 1;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ job: { id: 921, accountId: 160, status: "running" } }),
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        job: {
          id: 921, accountId: state.wrongAccount ? 161 : 160,
          status: state.failed ? "failed" : "completed",
          errorMessage: state.failed ? "No fue posible responder" : null,
          result: state.emptyResult ? null : {
            answer, responseType: "informational", sourceDomain: "crm_internal",
            ...(state.activityHistory ? { activityHistory: state.activityHistory } : {}),
          },
        },
      }),
    });
  });
  await openMiCoach(page, { workspace: "customer" });
  await page.getByLabel("Cuenta existente").selectOption("160");
  const chat = page.getByRole("region", { name: "Chat de cuenta" });
  await expect(chat.getByText("¿A qué oportunidad te refieres?", { exact: true })).toBeVisible();
  const send = async () => {
    await chat.getByPlaceholder("Pregunta sobre la cuenta...").fill("Vrf 2027.");
    await chat.getByRole("button", { name: "Preguntar", exact: true }).click();
  };
  return { state, chat, answer, send };
}

test("Cliente existente reintenta lecturas transitorias y muestra el estado hasta recibir la respuesta", async ({ page }) => {
  const { state, chat, answer, send } = await mockCustomerChatRecovery(page);
  state.failuresRemaining = 1;
  state.pendingPolls = 2;
  await send();
  await expect(chat.getByRole("status")).toContainText("Reintentando");
  await expect(chat.getByPlaceholder("Pregunta sobre la cuenta...")).toBeDisabled();
  await expect(chat.getByText(answer, { exact: true })).toBeVisible();
  await expect(chat.getByRole("status")).toHaveCount(0);
  await expect(chat.getByPlaceholder("Pregunta sobre la cuenta...")).toBeEnabled();
  expect(state.submissions).toBe(1);
  expect(state.polls).toBe(4);
});

test("Cliente existente recupera el mismo job tras agotar reintentos sin duplicar la pregunta", async ({ page }) => {
  const { state, chat, answer, send } = await mockCustomerChatRecovery(page);
  state.failuresRemaining = 3;
  await send();
  const recover = chat.getByRole("button", { name: "Recuperar respuesta", exact: true });
  await expect(recover).toBeVisible();
  expect(state.polls).toBe(3);
  await expect(chat.getByRole("alert")).toContainText("No se pudo consultar el resultado");
  await chat.getByPlaceholder("Pregunta sobre la cuenta...").fill("Otra pregunta");
  await expect(chat.getByRole("button", { name: "Preguntar", exact: true })).toBeDisabled();
  await recover.click();
  await expect(chat.getByText(answer, { exact: true })).toHaveCount(1);
  await expect(chat.getByText("Vrf 2027.", { exact: true })).toHaveCount(1);
  await expect(recover).toHaveCount(0);
  await expect(chat.getByRole("button", { name: "Preguntar", exact: true })).toBeEnabled();
  expect(state.submissions).toBe(1);
});

test("Cliente existente conserva un job interrumpido al recargar y no duplica la respuesta guardada", async ({ page }) => {
  const { state, chat, answer, send } = await mockCustomerChatRecovery(page);
  state.failuresRemaining = 1;
  state.failureStatus = 403;
  await send();
  await expect(chat.getByRole("button", { name: "Recuperar respuesta" })).toBeVisible();
  expect(state.polls).toBe(1);
  state.historySaved = true;
  await page.reload();
  await page.getByRole("button", { name: "Cliente existente", exact: true }).click();
  await page.getByLabel("Cuenta existente").selectOption("160");
  await expect(chat.getByText(answer, { exact: true })).toHaveCount(1);
  await chat.getByRole("button", { name: "Recuperar respuesta" }).click();
  await expect(chat.getByRole("button", { name: "Recuperar respuesta" })).toHaveCount(0);
  await expect(chat.getByRole("status")).toHaveCount(0);
  await expect(chat.getByText(answer, { exact: true })).toHaveCount(1);
  await expect(chat.getByText("Vrf 2027.", { exact: true })).toHaveCount(1);
  expect(state.submissions).toBe(1);
  expect(await page.evaluate(() =>
    sessionStorage.getItem("mi-agent-customer-chat-pending:160"),
  )).toBeNull();
});

test("Cliente existente descarta respuestas tardías tras cambiar de cuenta y permite recuperar al volver", async ({ page }) => {
  const { state, chat, answer, send } = await mockCustomerChatRecovery(page);
  let release;
  state.holdPoll = new Promise((resolve) => { release = resolve; });
  await send();
  await expect.poll(() => state.polls).toBe(1);
  await page.getByLabel("Cuenta existente").selectOption("");
  release();
  state.holdPoll = null;
  await expect(chat.getByText(answer, { exact: true })).toHaveCount(0);
  await page.getByLabel("Cuenta existente").selectOption("160");
  await chat.getByRole("button", { name: "Recuperar respuesta" }).click();
  await expect(chat.getByText(answer, { exact: true })).toHaveCount(1);
  expect(state.submissions).toBe(1);
});

test("Cliente existente no deja vacío un turno completado sin resultado y distingue un job fallido", async ({ page }) => {
  const { state, chat, answer, send } = await mockCustomerChatRecovery(page);
  state.emptyResult = true;
  await send();
  await expect(chat.getByRole("alert")).toContainText("no se recibió una respuesta válida");
  state.emptyResult = false;
  await chat.getByRole("button", { name: "Recuperar respuesta" }).click();
  await expect(chat.getByText(answer, { exact: true })).toBeVisible();
  await chat.getByRole("button", { name: "Nueva conversación" }).click();
  state.failed = true;
  await send();
  await expect(chat.getByRole("alert")).toContainText("No fue posible responder");
  await expect(chat.getByRole("button", { name: "Recuperar respuesta" })).toHaveCount(0);
  await expect(chat.getByRole("button", { name: "Nueva conversación" })).toBeEnabled();
});

test("Cliente existente conserva el job cuando se agota la espera y recupera sin reenviar", async ({ page }) => {
  const { state, chat, answer, send } = await mockCustomerChatRecovery(page);
  await page.clock.install();
  state.pendingPolls = 1000;
  await send();
  await expect.poll(() => state.polls).toBeGreaterThan(0);
  await page.clock.runFor(1000);
  await page.clock.fastForward(61000);
  const recover = chat.getByRole("button", { name: "Recuperar respuesta" });
  await expect(recover).toBeVisible();
  await expect(chat.getByRole("alert")).toContainText("La respuesta sigue pendiente");
  state.pendingPolls = 0;
  await recover.click();
  await expect(chat.getByText(answer, { exact: true })).toHaveCount(1);
  expect(state.submissions).toBe(1);
});

test("Cliente existente muestra pendientes sin periodo y separa los registros sin fecha", async ({ page }) => {
  const { state, chat, send } = await mockCustomerChatRecovery(page);
  state.activityHistory = {
    mode: "pending", timezone: "America/Mexico_City", metadata: { partial: false, shown: 1, matched: 1 },
    sections: [
      { key: "pending", title: "Pendientes con fecha", available: true, items: [] },
      { key: "undated", title: "Sin fecha utilizable", available: true,
        subtitle: "No se consideran vencidas.", items: [
          { id: "opportunityActivities:67", recordId: 67, title: "Seguimiento sin fecha",
            date: "", dateMeaning: "Sin fecha utilizable", overdue: null, sourceTitle: "Actividades de oportunidades" },
        ] },
    ],
  };
  await send();
  await expect(chat.getByText("Sin límite temporal implícito", { exact: true })).toBeVisible();
  await expect(chat.getByText("Seguimiento sin fecha", { exact: true })).toBeVisible();
  await expect(chat.getByText("Registro 67", { exact: true })).toBeVisible();
  await expect(chat.getByText("No se consideran vencidas.", { exact: true })).toBeVisible();
  expect(state.submissions).toBe(1);
});

test("Cliente existente espera el historial antes de enviar y no permite que borre un turno nuevo", async ({ page }) => {
  const { state, chat, answer, send } = await mockCustomerChatRecovery(page);
  let release;
  const heldHistory = new Promise((resolve) => { release = resolve; });
  let historyRequested = false;
  await page.route("**/api/commercial-intelligence/account-chat/sessions/920", async (route) => {
    historyRequested = true;
    await heldHistory;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        session: { id: 920, accountId: 160, history: [
          { role: "user", text: "¿Cuál es el monto de la oportunidad?" },
          { role: "assistant", text: "¿A qué oportunidad te refieres?" },
        ] },
      }),
    });
  });
  await page.getByLabel("Cuenta existente").selectOption("");
  await page.getByLabel("Cuenta existente").selectOption("160");
  await expect.poll(() => historyRequested).toBe(true);
  await expect(chat.getByPlaceholder("Pregunta sobre la cuenta...")).toBeDisabled();
  await expect(chat.getByRole("button", { name: "Expansión", exact: true })).toBeDisabled();
  expect(state.submissions).toBe(0);
  release();
  await expect(chat.getByPlaceholder("Pregunta sobre la cuenta...")).toBeEnabled();
  await send();
  await expect(chat.getByText(answer, { exact: true })).toHaveCount(1);
  await expect(chat.getByText("Vrf 2027.", { exact: true })).toHaveCount(1);
});

test("Cliente existente desplaza el hilo para que la respuesta nueva quede visible", async ({ page }) => {
  const { state, chat, answer, send } = await mockCustomerChatRecovery(page);
  await page.route("**/api/commercial-intelligence/account-chat/sessions/920", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        session: { id: 920, accountId: 160, history: Array.from({ length: 20 }, (_, index) => ({
          role: index % 2 ? "assistant" : "user",
          text: `Mensaje anterior ${index}`,
        })) },
      }),
    }),
  );
  await page.getByLabel("Cuenta existente").selectOption("");
  await page.getByLabel("Cuenta existente").selectOption("160");
  await expect(chat.getByText("Mensaje anterior 19", { exact: true })).toBeVisible();
  let release;
  state.holdPoll = new Promise((resolve) => { release = resolve; });
  await send();
  await expect.poll(() => state.polls).toBe(1);
  const thread = chat.locator(".mi-agent-coach-thread");
  await thread.evaluate((element) => { element.scrollTop = 0; });
  release();
  await expect(chat.getByText(answer, { exact: true })).toBeVisible();
  await expect.poll(() => thread.evaluate((element) =>
    Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop),
  )).toBeLessThanOrEqual(2);
});

test("Cliente existente conserva un job aceptado después de cambiar de cuenta", async ({ page }) => {
  const { state, chat, answer, send } = await mockCustomerChatRecovery(page);
  let release;
  state.holdSubmission = new Promise((resolve) => { release = resolve; });
  await send();
  await expect.poll(() => state.submissions).toBe(1);
  await page.getByLabel("Cuenta existente").selectOption("");
  release();
  await expect.poll(() => page.evaluate(() =>
    sessionStorage.getItem("mi-agent-customer-chat-pending:160"),
  )).not.toBeNull();
  await page.getByLabel("Cuenta existente").selectOption("160");
  await chat.getByRole("button", { name: "Recuperar respuesta" }).click();
  await expect(chat.getByText(answer, { exact: true })).toBeVisible();
  expect(state.submissions).toBe(1);
});

test("Cliente existente rechaza resultados de otra cuenta y permite recuperar el resultado correcto", async ({ page }) => {
  const { state, chat, answer, send } = await mockCustomerChatRecovery(page);
  state.wrongAccount = true;
  await send();
  await expect(chat.getByRole("alert")).toContainText("resultado de chat inválido");
  await expect(chat.getByText(answer, { exact: true })).toHaveCount(0);
  state.wrongAccount = false;
  await chat.getByRole("button", { name: "Recuperar respuesta" }).click();
  await expect(chat.getByText(answer, { exact: true })).toBeVisible();
  expect(state.submissions).toBe(1);
});

test("Cliente existente no revive un job antiguo si se inició otra conversación antes de recibir su aceptación", async ({ page }) => {
  const { state, chat, answer, send } = await mockCustomerChatRecovery(page);
  let release;
  state.holdSubmission = new Promise((resolve) => { release = resolve; });
  await send();
  await expect.poll(() => state.submissions).toBe(1);
  await page.getByLabel("Cuenta existente").selectOption("");
  await page.getByLabel("Cuenta existente").selectOption("160");
  await expect(chat.getByRole("button", { name: "Nueva conversación" })).toBeEnabled();
  await chat.getByRole("button", { name: "Nueva conversación" }).click();
  const accepted = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/commercial-intelligence/account-chat/jobs" &&
    response.request().method() === "POST",
  );
  release();
  await accepted;
  await expect(chat.getByText(answer, { exact: true })).toHaveCount(0);
  await expect(chat.getByRole("button", { name: "Recuperar respuesta" })).toHaveCount(0);
  expect(await page.evaluate(() =>
    sessionStorage.getItem("mi-agent-customer-chat-pending:160"),
  )).toBeNull();
  expect(state.polls).toBe(0);
});

test("Cliente existente muestra errores de historial sin borrar la sesión y permite recargarla", async ({ page }) => {
  const { chat } = await mockCustomerChatRecovery(page);
  await page.route("**/api/commercial-intelligence/account-chat/sessions/920", (route) =>
    route.fulfill({
      status: 503, contentType: "application/json",
      body: JSON.stringify({ message: "No se pudo cargar el historial" }),
    }),
  );
  await page.getByLabel("Cuenta existente").selectOption("");
  await page.getByLabel("Cuenta existente").selectOption("160");
  await expect(chat.getByRole("alert")).toContainText("No se pudo cargar el historial");
  expect(await page.evaluate(() =>
    sessionStorage.getItem("mi-agent-customer-chat-session:160"),
  )).toBe("920");
  await page.unroute("**/api/commercial-intelligence/account-chat/sessions/920");
  await page.route("**/api/commercial-intelligence/account-chat/sessions/920", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        session: { id: 920, accountId: 160, history: [
          { role: "assistant", text: "Historial recuperado" },
        ] },
      }),
    }),
  );
  await chat.getByRole("button", { name: "Recargar conversación" }).click();
  await expect(chat.getByText("Historial recuperado", { exact: true })).toBeVisible();
  await expect(chat.getByRole("alert")).toHaveCount(0);
});

test("Cliente existente permite confirmar actividad persistida y abrir Calendario", async ({
  page,
}) => {
  await mockMiCoachApi(page, { withCustomerHealth: true });
  const pendingOperation = {
    kind: "activity",
    title: "Llamada con Rene Negrete",
    sourceChannel: "coach",
    calendarKind: "opportunity",
    accountId: 160,
    opportunityId: 300,
    contactId: 109,
    actionType: "call",
    scheduledAt: "2026-10-13T10:00",
    status: "pending",
    priority: "medium",
    notes: "Revisar avances",
    successCriteria: "Acordar siguiente paso",
    missingFields: [],
    evidence: [],
    requiresConfirmation: true,
  };
  let operation = {
    id: 70,
    sessionId: 65,
    version: 2,
    status: "ready",
    targetModule: "calendar",
    pendingOperation,
    missingFields: [],
  };
  const requests = [];
  const draftUpdates = [];
  const popupRequests = [];
  page.context().on("request", (request) => {
    const requestPage = request.frame().page();
    if (requestPage !== page) {
      popupRequests.push({
        path: new URL(request.url()).pathname,
        method: request.method(),
      });
    }
  });
  await page.context().route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const json = (body) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    requests.push({ path, method });
    if (path === "/api/commercial-intelligence/account-chat/jobs/921")
      return json({
        job: {
          id: 921,
          status: "completed",
          result: {
            answer: "El borrador está listo para revisar en Calendario.",
            responseType: "operation",
            confidence: "high",
            recommendedActions: [],
            operations: [
              {
                ...pendingOperation,
                sourceChannel: "customer_account",
                persistentId: 70,
                persistenceVersion: 2,
                persistenceStatus: "ready",
              },
            ],
          },
        },
      });
    if (path === "/api/mi-agent/coach/operations/70") {
      if (method === "PATCH") {
        const body = route.request().postDataJSON();
        draftUpdates.push(body.pendingOperation);
        operation = {
          ...operation,
          version: 3,
          pendingOperation: body.pendingOperation,
        };
      }
      return json({ operation, sessionId: 65 });
    }
    if (path === "/api/mi-agent/coach/operations/70/handoff")
      return json({
        operation,
        handoff: {
          module: "calendar",
          url: "/calendar?coachDraft=activity-70",
        },
      });
    if (path === "/api/mi-agent/coach/handoffs/activity-70")
      return json({
        handoff: {
          operationId: 70,
          kind: "activity",
          module: "calendar",
          payload: operation.pendingOperation,
        },
      });
    if (path === "/api/commercial-development/calendar")
      return json({ days: [], sellers: [], alerts: {}, indicators: {} });
    if (path === "/api/commercial-tracking/open-opportunities")
      return json({ items: [{ id: 300, name: "Vrf 2027" }] });
    return route.fallback();
  });
  await openMiCoach(page, { workspace: "customer" });
  await page.getByLabel("Cuenta existente").selectOption("160");
  const chat = page.getByRole("region", { name: "Chat de cuenta" });
  await chat.getByRole("button", { name: "Resumen para reunión" }).click();
  await expect(
    chat.getByText("Llamada con Rene Negrete", { exact: false }),
  ).toBeVisible();
  await chat.getByRole("button", { name: "Revisar operación" }).click();
  const confirmation = page.getByRole("dialog", {
    name: "Confirmar cambio del Coach",
  });
  await expect(confirmation).toBeVisible();
  await expect(
    confirmation.locator('input[type="datetime-local"]'),
  ).toHaveValue("2026-10-13T10:00");
  await expect(confirmation.getByLabel("Fecha límite")).toHaveCount(0);
  const notes = confirmation.getByLabel("Notas");
  await notes.fill("");
  await notes.pressSequentially("Revisar avances y presupuesto");
  await expect(notes).toHaveValue("Revisar avances y presupuesto");
  const successCriteria = confirmation.getByLabel("Criterio de éxito");
  await successCriteria.fill("");
  await successCriteria.pressSequentially("Acordar siguiente paso y fecha");
  await expect(successCriteria).toHaveValue("Acordar siguiente paso y fecha");
  await expect(confirmation).toContainText(
    "Los cambios se guardarán al continuar en el módulo.",
  );
  expect(draftUpdates).toEqual([]);
  const calendarPagePromise = page.waitForEvent("popup");
  await confirmation
    .getByRole("button", { name: "Continuar en el módulo" })
    .click();
  const calendarPage = await calendarPagePromise;
  await expect.poll(() => draftUpdates).toEqual([
    expect.objectContaining({
      notes: "Revisar avances y presupuesto",
      successCriteria: "Acordar siguiente paso y fecha",
    }),
  ]);
  await expect(page).not.toHaveURL(/\/calendar\?coachDraft=activity-70/);
  await expect(calendarPage).toHaveURL(/\/calendar\?coachDraft=activity-70/);
  await expect.poll(() => popupRequests).toContainEqual({
    path: "/api/mi-agent/coach/handoffs/activity-70",
    method: "GET",
  });
  const calendar = calendarPage.getByRole("dialog", {
    name: "Nueva actividad",
    exact: true,
  });
  await expect(calendar).toBeVisible();
  await expect(
    calendar.getByRole("textbox", { name: "Objetivo", exact: true }),
  ).toHaveValue("Llamada con Rene Negrete");
  expect(
    requests.some(
      (item) =>
        item.path === "/api/mi-agent/coach/operations" &&
        item.method === "POST",
    ),
  ).toBe(false);
  expect(
    requests.some(
      (item) =>
        item.path.endsWith("/calendar/activities") && item.method === "POST",
    ),
  ).toBe(false);
});

const coachCreationJourneys = [
  ["create_account", "accounts", "/accounts", "account", "Cuentas"],
  ["create_contact", "contacts", "/contacts", "contact", "Contactos"],
  [
    "create_opportunity",
    "opportunities",
    "/opportunities",
    "opportunity",
    "Oportunidades",
  ],
  ["create_lead", "interactions", "/interactions", "lead", "Leads"],
  [
    "create_contact_mapping",
    "contact_mapping",
    "/contact-mapping",
    "contact_mapping",
    "Mapeo de contactos",
  ],
  ["activity", "calendar", "/calendar", "activity", "Calendario"],
  [
    "create_quotation",
    "quotations",
    "/quotations",
    "quotation",
    "Cotizaciones",
  ],
  ["create_proposal", "proposals", "/proposals", "proposal", "Propuestas"],
];

async function mockCoachCreationJourney(
  page,
  { kind, moduleName, targetRoute, entityType },
) {
  let completed = false;
  const token = `token-${kind}`;
  const title = `Crear desde Coach: ${kind}`;
  const operation = {
    id: 900,
    sessionId: 700,
    kind,
    status: "handed_off",
    version: 2,
    targetModule: moduleName,
    targetRoute,
    handoffToken: token,
    handedOffAt: "2026-09-26T12:00:00.000Z",
    handoffExpiresAt: "2027-09-26T12:00:00.000Z",
    missingFields: [],
    pendingOperation: {
      kind,
      title,
      targetModule: moduleName,
      payload: { name: `Registro ${kind}` },
      opportunityId: kind === "activity" ? 22 : null,
      actionType: kind === "activity" ? "follow_up" : undefined,
      status: kind === "activity" ? "pending" : undefined,
      priority: kind === "activity" ? "medium" : undefined,
    },
  };

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    const method = route.request().method();
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (pathname === "/api/auth/bootstrap-status")
      return json({ hasUsers: true });
    if (pathname === "/api/auth/me") {
      return json({
        id: 31,
        full_name: "Demo Seller",
        email: "seller@example.com",
        status: "active",
        roles: [{ name: "Vendedor" }],
        permissions: [
          "mi_coach.access",
          "mi_coach.use",
          "mi_coach.execute",
          "cuentas.read",
          "cuentas.create",
          "contactos.read",
          "contactos.create",
          "contactos.update",
          "oportunidades.read",
          "oportunidades.create",
          "desarrollo_comercial.read",
          "desarrollo_comercial.update",
          "calendario_comercial.update",
          "interacciones.read",
          "interacciones.update",
          "cotizaciones.operacion",
          "propuestas.read",
          "propuestas.create",
        ],
      });
    }
    if (pathname === "/api/mi-agent/context") {
      return json({
        period: { label: "Q3 2026", baseCurrencyCode: "USD" },
        quota: { assignedAmount: 0, actualAmount: 0, gapAmount: 0 },
        workboard: [],
        leads: [],
        contactMappings: [],
        summary: { openOpportunities: 0, riskyOpportunities: 0 },
      });
    }
    if (
      pathname === "/api/mi-agent/coach/sessions/active" ||
      pathname === "/api/mi-agent/coach/sessions/700"
    ) {
      return json({
        session: { id: 700, context: {}, messages: [] },
        operations: completed ? [] : [operation],
        recentOperations: completed
          ? [
              {
                ...operation,
                status: "completed",
                completedAt: "2026-09-26T12:05:00.000Z",
              },
            ]
          : [],
      });
    }
    if (
      pathname === `/api/mi-agent/coach/operations/${operation.id}/handoff` &&
      method === "POST"
    ) {
      return json({
        handoff: {
          token,
          module: moduleName,
          url: `${targetRoute}?coachDraft=${token}`,
          expiresAt: operation.handoffExpiresAt,
        },
        operation,
      });
    }
    if (
      pathname === `/api/mi-agent/coach/handoffs/${token}/complete` &&
      method === "POST"
    ) {
      completed = true;
      return json({
        operation: {
          ...operation,
          status: "completed",
          result: { entityType, entityId: 990 },
        },
      });
    }
    if (pathname === `/api/mi-agent/coach/handoffs/${token}`) {
      return json({
        handoff: {
          operationId: operation.id,
          kind,
          module: moduleName,
          payload: operation.pendingOperation,
          entities: {},
          missingFields: [],
          version: operation.version,
          expiresAt: operation.handoffExpiresAt,
        },
      });
    }
    if (pathname.startsWith("/api/accounts")) return json([]);
    if (pathname.startsWith("/api/contacts")) return json([]);
    if (pathname.startsWith("/api/opportunities")) return json([]);
    return json({});
  });

  return { operation, token, title };
}

test.describe("Mi Coach governance and workspaces", () => {
  test.describe("handoffs de creación", () => {
    for (const [
      kind,
      moduleName,
      targetRoute,
      entityType,
      moduleLabel,
    ] of coachCreationJourneys) {
      test(`${kind} conserva el resultado al volver y recargar`, async ({
        page,
      }) => {
        const journey = await mockCoachCreationJourney(page, {
          kind,
          moduleName,
          targetRoute,
          entityType,
        });
        await openMiCoach(page);

        const pending = page.getByRole("region", {
          name: "Acciones pendientes del Coach",
        });
        await expect(pending.getByText(journey.title)).toBeVisible();
        await pending
          .getByRole("button", { name: `Abrir en ${moduleLabel}` })
          .click();
        await expect(page).toHaveURL(
          new RegExp(`${targetRoute.replace("/", "\\/")}\\?coachDraft=`),
        );

        await page.evaluate(
          async ({ token, moduleName, entityType }) => {
            await fetch(`/api/mi-agent/coach/handoffs/${token}/complete`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                module: moduleName,
                entityType,
                entityId: 990,
              }),
            });
          },
          { token: journey.token, moduleName, entityType },
        );

        await page.goto("/mi-agent");
        await expect(
          page.getByRole("heading", { name: "Mi Coach" }),
        ).toBeVisible();
        await openCoachConversation(page);
        await page.getByText("Actividad reciente").click();
        await expect(page.getByText(journey.title)).toBeVisible();
        await expect(
          page.getByText("Completada", { exact: true }),
        ).toBeVisible();

        await page.reload();
        await openCoachConversation(page);
        await page.getByText("Actividad reciente").click();
        await expect(page.getByText(journey.title)).toBeVisible();
      });
    }
  });

  test("muestra los espacios principales y conserva Coach", async ({
    page,
  }) => {
    const automaticBriefingRequests = [];
    page.on("request", (request) => {
      if (
        request
          .url()
          .includes("/api/commercial-intelligence/automatic-briefing/next")
      )
        automaticBriefingRequests.push(request.url());
    });
    await mockMiCoachApi(page, {
      withCustomerHealth: true,
      withCustomerChatTrace: true,
      withProspect: true,
    });
    await openMiCoach(page, { workspace: "summary" });

    await expect(
      page.getByRole("heading", { name: "Resumen comercial" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Vistas de Mi Coach" })
        .getByRole("button", { name: "Resumen", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Pipeline abierto")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Mi Coach", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Coach", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Cliente existente" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cuenta nueva" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Administración" }),
    ).toHaveCount(0);

    await openCoachConversation(page);
    await expect(
      page
        .getByRole("navigation", { name: "Vistas de Mi Coach" })
        .getByRole("button", { name: "Conversación", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", { name: "Pregúntale a tu Coach" }),
    ).toBeVisible();
    await expect(page.getByLabel("Alcance actual del Coach")).toContainText(
      "Ámbito general del vendedor",
    );
    await expect(page.getByLabel("Cuenta activa")).toHaveCount(0);
    await expect(
      page.getByPlaceholder("Escribe tu pregunta para el Coach..."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Preparar briefing automático" }),
    ).toHaveCount(0);
    expect(automaticBriefingRequests).toEqual([]);

    await page.getByRole("button", { name: "Cuenta nueva" }).click();
    await expect(
      page.getByRole("heading", { name: "Prospección asistida" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Investigar fuentes públicas" }),
    ).toBeVisible();
  });

  test("oculta Cliente existente y Cuenta nueva sin permisos de lectura especializados", async ({
    page,
  }) => {
    await mockMiCoachApi(page);
    await openMiCoach(page, { workspace: "summary" });

    await expect(
      page.getByRole("button", { name: "Cliente existente" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Cuenta nueva" }),
    ).toHaveCount(0);
  });

  test("oculta oportunidades no activadas del Resumen", async ({ page }) => {
    await mockMiCoachApi(page, { withOpportunityStatusMatrix: true });
    await openMiCoach(page, { workspace: "summary" });

    await expect(page.getByText("Oportunidades desactivadas")).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Oportunidad desactivada terminal",
      }),
    ).toHaveCount(0);
  });

  test("Cuenta nueva inicia investigación pública y la actualiza sobre la misma ficha", async ({
    page,
  }) => {
    const publicResearchRequests = [];
    const sessionCreateRequests = [];
    const internalPreparationRequests = [];
    const prospectChatJobRequests = [];
    const leadConversionRequests = [];
    const accountConversionRequests = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/sessions/991/convert-to-lead")
      ) {
        leadConversionRequests.push(request.postDataJSON());
      }
      if (
        request.method() === "POST" &&
        request.url().endsWith("/sessions/991/convert-to-account")
      ) {
        accountConversionRequests.push(request.postDataJSON());
      }
      if (
        new URL(request.url()).pathname === "/api/prospect-research/sessions" &&
        request.method() === "POST"
      )
        sessionCreateRequests.push(request.url());
      if (
        new URL(request.url()).pathname ===
          "/api/prospect-research/sessions/991/run" &&
        request.method() === "POST"
      )
        internalPreparationRequests.push(request.url());
      if (
        request
          .url()
          .includes("/api/prospect-research/sessions/991/run-external") &&
        request.method() === "POST"
      )
        publicResearchRequests.push(request.method());
      if (
        request.url().includes("/api/prospect-research/sessions/991/chat/jobs")
      ) {
        prospectChatJobRequests.push({
          method: request.method(),
          url: request.url(),
        });
      }
    });
    await mockMiCoachApi(page, {
      withProspect: true,
      withProspectDuplicates: false,
      timeoutFirstProspectPoll: true,
    });
    await openMiCoach(page, { workspace: "prospect" });

    await page.getByPlaceholder("Nombre de la empresa").fill("Prospecto E2E");
    await page.getByPlaceholder("México, Perú, Colombia...").fill("Mexico");
    await page
      .getByRole("button", { name: "Investigar fuentes públicas" })
      .click();
    await expect(
      page.getByText("Revisión de posibles cuentas duplicadas"),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Abrir fuente" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Abrir fuente" }).nth(1),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Relevancia: La fuente identifica a María García como líder de tecnología.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Persona identificada en una fuente pública · no confirmada en CRM",
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        "La fuente identifica a María García como líder de tecnología.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("María García fue nombrada CTO de la compañía."),
    ).toBeVisible();
    await expect(page.getByText("Personas y áreas")).toBeVisible();
    await expect(
      page.getByText("Guía para iniciar la conversación"),
    ).toBeVisible();
    await expect(
      page.getByText("La fuente describe una iniciativa reciente."),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Roles objetivo sugeridos · no son personas identificadas",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Responsable de infraestructura"),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Persona identificada en una fuente pública · no confirmada en CRM",
      ),
    ).toBeVisible();
    await expect.poll(() => publicResearchRequests.length).toBe(1);
    expect(sessionCreateRequests).toHaveLength(1);
    expect(internalPreparationRequests).toEqual([]);

    await page
      .getByPlaceholder("Pregunta sobre el prospecto...")
      .fill("¿Qué hipótesis debo validar?");
    await page.getByRole("button", { name: "Preguntar" }).last().click();
    await expect(
      page.getByText(
        "La hipótesis principal requiere validar continuidad operativa.",
      ),
    ).toBeVisible();
    expect(prospectChatJobRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          url: expect.stringContaining("/chat/jobs"),
        }),
        expect.objectContaining({
          method: "GET",
          url: expect.stringContaining("/chat/jobs/992"),
        }),
      ]),
    );
    await page.reload();
    await page.getByRole("button", { name: "Cuenta nueva" }).click();
    await expect(
      page.getByText(
        "La hipótesis principal requiere validar continuidad operativa.",
      ),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Actualizar investigación" })
      .click();
    await expect.poll(() => publicResearchRequests.length).toBe(2);
    await expect(page.getByText("Historial de investigación")).toBeVisible();
    await expect(page.getByText("Sin cambios")).toBeVisible();
    expect(sessionCreateRequests).toHaveLength(1);
    expect(internalPreparationRequests).toEqual([]);

    await page.getByRole("button", { name: "Crear lead" }).click();
    const leadConfirmation = page.getByRole("dialog", {
      name: "Confirmar creación de lead",
    });
    await expect(leadConfirmation).toContainText("Prospecto E2E");
    await expect(leadConfirmation).toContainText(
      "El lead quedará sin asociar a una cuenta",
    );
    await leadConfirmation.getByRole("button", { name: "Cancelar" }).click();
    expect(leadConversionRequests).toHaveLength(0);

    await page.getByRole("button", { name: "Crear lead" }).click();
    await page
      .getByRole("dialog", { name: "Confirmar creación de lead" })
      .getByRole("button", { name: "Confirmar y crear lead" })
      .click();
    const createdLeadStatus = page.locator(".mi-agent-prospect-success");
    await expect(createdLeadStatus).toHaveText("Lead creado");
    await expect(createdLeadStatus).toHaveAttribute("role", "status");
    expect(leadConversionRequests).toEqual([{ accountId: null }]);
    await expect(page.getByRole("button", { name: "Lead creado" })).toHaveCount(
      0,
    );

    await page.getByRole("button", { name: "Crear cuenta revisada" }).click();
    const accountConfirmation = page.getByRole("dialog", {
      name: "Confirmar creación de cuenta",
    });
    await expect(accountConfirmation).toContainText("Prospecto E2E");
    await expect(accountConfirmation).toContainText("Mexico");
    await accountConfirmation.getByRole("button", { name: "Cancelar" }).click();
    expect(accountConversionRequests).toHaveLength(0);

    await page.getByRole("button", { name: "Crear cuenta revisada" }).click();
    await page
      .getByRole("dialog", { name: "Confirmar creación de cuenta" })
      .getByRole("button", { name: "Confirmar y crear cuenta" })
      .click();
    await expect(
      page.getByRole("button", { name: "Cuenta creada" }),
    ).toBeVisible();
    expect(accountConversionRequests).toEqual([{}]);
    await page
      .getByPlaceholder("Nombre y apellido")
      .fill("Lucía Contacto Real");
    await page.getByRole("button", { name: "Crear contacto" }).click();
    await expect(
      page.getByRole("button", { name: "Contacto creado" }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Crear oportunidad preliminar" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Confirmar hipótesis" }).click();
    await page
      .getByRole("button", { name: "Crear oportunidad preliminar" })
      .click();
    await expect(
      page.getByRole("button", { name: "Oportunidad creada" }),
    ).toBeVisible();
  });

  test("bloquea crear o vincular una cuenta cuando encuentra una posible duplicada", async ({
    page,
  }) => {
    await mockMiCoachApi(page, { withProspect: true });
    await openMiCoach(page, { workspace: "prospect" });

    await page.getByPlaceholder("Nombre de la empresa").fill("Prospecto E2E");
    await page.getByPlaceholder("México, Perú, Colombia...").fill("Mexico");
    await page
      .getByRole("button", { name: "Investigar fuentes públicas" })
      .click();

    await expect(
      page.getByText("Se encontraron posibles cuentas existentes.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.getByText("Prospecto E2E existente")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Crear cuenta revisada" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Vincular esta cuenta" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Crear una cuenta nueva de todos modos",
      }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Crear lead" }).click();
    const leadConfirmation = page.getByRole("dialog", {
      name: "Confirmar creación de lead",
    });
    await expect(leadConfirmation).toContainText(
      "El lead quedará sin asociar a una cuenta",
    );
    await leadConfirmation.getByRole("button", { name: "Cancelar" }).click();
  });

  test("Investigaciones guardadas reabre la misma ficha y Cuentas objetivo es reversible", async ({
    page,
  }) => {
    await mockMiCoachApi(page, { withProspect: true });
    await openMiCoach(page, { workspace: "prospect" });

    await page.getByRole("tab", { name: "Investigaciones guardadas" }).click();
    await expect(
      page.getByRole("button", { name: "Abrir investigación" }),
    ).toBeVisible();
    await expect(page.getByText("Prospecto E2E").first()).toBeVisible();

    await page.getByRole("button", { name: "Abrir investigación" }).click();
    await expect(
      page.getByRole("heading", { name: "Prospecto E2E" }),
    ).toBeVisible();
    await expect(
      page.getByText("María García fue nombrada CTO de la compañía."),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Agregar a cuentas objetivo" })
      .click();
    await expect(
      page.getByRole("button", { name: "Quitar de cuentas objetivo" }),
    ).toBeVisible();

    await page.getByRole("tab", { name: "Cuentas objetivo" }).click();
    await expect(
      page.getByRole("button", { name: "Abrir investigación" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Quitar de cuentas objetivo" })
      .click();
    await expect(
      page.getByText("Aún no agregas investigaciones a Cuentas objetivo."),
    ).toBeVisible();

    await page.getByRole("tab", { name: "Investigaciones guardadas" }).click();
    await expect(
      page.getByRole("button", { name: "Abrir investigación" }),
    ).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", {
        name: "Eliminar investigación de Prospecto E2E",
      })
      .click();
    await expect(
      page.getByText(
        "Aún no hay investigaciones guardadas con esos criterios.",
      ),
    ).toBeVisible();
  });

  test("copia el flujo completo del job de Cliente existente como JSON", async ({
    page,
  }) => {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await mockMiCoachApi(page, {
      withCustomerHealth: true,
      withCustomerChatTrace: true,
      canDiagnoseCustomerChats: true,
    });
    await openMiCoach(page, { workspace: "customer" });
    await page.getByLabel("Cuenta existente").selectOption("160");

    const customerChat = page.getByRole("region", { name: "Chat de cuenta" });
    await customerChat
      .getByRole("button", { name: "Resumen para reunión" })
      .click();
    await customerChat
      .locator(".mi-agent-customer-chat-debug > summary")
      .last()
      .click();
    const observedFlow = customerChat.locator(
      ".mi-agent-customer-chat-detailed-trace",
    );
    await expect(observedFlow).toBeVisible();
    await observedFlow.locator("summary").first().click();
    await expect(observedFlow).toHaveJSProperty("open", true);
    await observedFlow
      .getByRole("button", { name: "Copiar flujo del job" })
      .click();
    await expect(
      observedFlow.getByRole("status").filter({ hasText: "Flujo copiado" }),
    ).toBeVisible();
    await expect(observedFlow).toHaveJSProperty("open", true);

    const copiedFlow = JSON.parse(
      await page.evaluate(() => navigator.clipboard.readText()),
    );
    expect(copiedFlow).toMatchObject({
      schemaVersion: "customer-chat-observed-flow.v1",
      jobId: 921,
      chatSessionId: 920,
      serverTrace: {
        currentTurn: { jobId: 921 },
        flow: expect.arrayContaining([
          expect.objectContaining({ block: "B6" }),
          expect.objectContaining({ block: "B10" }),
        ]),
        executionTrace: expect.arrayContaining([
          expect.objectContaining({
            output: expect.objectContaining({
              operationKind: "create_contact",
            }),
          }),
        ]),
      },
      browserTrace: {
        available: true,
        source: "browser_observed",
      },
    });
    expect(copiedFlow.browserTrace.exchanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          path: "/api/commercial-intelligence/account-chat/jobs",
        }),
        expect.objectContaining({
          method: "GET",
          path: "/api/commercial-intelligence/account-chat/jobs/921",
        }),
      ]),
    );
  });

  test("los chats de cuenta nueva y cliente existente muestran fundamentos y confirmacion", async ({
    page,
  }) => {
    await mockMiCoachApi(page, {
      withCustomerHealth: true,
      withCustomerChatTrace: true,
      canDiagnoseCustomerChats: true,
      withProspect: true,
    });
    await openMiCoach(page, { workspace: "customer" });
    await page.getByLabel("Cuenta existente").selectOption("160");
    const customerChat = page.getByRole("region", { name: "Chat de cuenta" });
    await customerChat
      .getByRole("button", { name: "Resumen para reunión" })
      .click();
    await expect(
      customerChat.getByText("La cuenta requiere seguimiento comercial."),
    ).toBeVisible();
    await customerChat
      .locator(".mi-agent-customer-chat-debug > summary")
      .last()
      .click();
    const observedFlow = customerChat.locator(
      ".mi-agent-customer-chat-detailed-trace",
    );
    await observedFlow.locator(":scope > summary").click();
    const transportTrace = observedFlow.locator(
      ".mi-agent-customer-chat-detailed-trace-content",
    );
    await expect(transportTrace).toContainText(
      "/api/commercial-intelligence/account-chat/jobs",
    );
    const customerFoundation = customerChat.getByRole("switch");
    await expect(customerFoundation).toBeVisible();
    await customerFoundation.check();
    await expect(customerChat.getByText("Snapshot autorizado")).toBeVisible();

    await customerChat
      .getByPlaceholder("Pregunta sobre la cuenta...")
      .fill("¿Puedes resumir la cuenta otra vez?");
    await customerChat.getByRole("button", { name: "Preguntar" }).click();
    await expect(
      customerChat.getByText("La cuenta requiere seguimiento comercial."),
    ).toHaveCount(2);
    await page.getByRole("button", { name: "Cuenta nueva" }).click();
    await page.getByPlaceholder("Nombre de la empresa").fill("Prospecto E2E");
    await page.getByPlaceholder("México, Perú, Colombia...").fill("Mexico");
    await page
      .getByRole("button", { name: "Investigar fuentes públicas" })
      .click();
    await page
      .getByPlaceholder("Pregunta sobre el prospecto...")
      .fill("¿Qué hipótesis debo validar?");
    await page.getByRole("button", { name: "Preguntar" }).last().click();
    await expect(
      page.getByText(
        "La hipótesis principal requiere validar continuidad operativa.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Acciones sugeridas · requieren confirmación"),
    ).toHaveCount(0);
    await expect(
      page.getByText("No tienes permisos para proponer este tipo de cambio."),
    ).toHaveCount(0);
    await expect(
      page.getByText(/Preparar borrador de correo para/),
    ).toHaveCount(0);
  });

  test("Cliente existente confirma create_contact y entrega el borrador a Contactos", async ({
    page,
  }) => {
    const contactCreateRequests = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/contacts"
      ) {
        contactCreateRequests.push(request.postDataJSON());
      }
    });
    await mockMiCoachApi(page, {
      withCustomerHealth: true,
      withCustomerContactOperation: true,
    });
    await openMiCoach(page, { workspace: "customer" });
    await page.getByLabel("Cuenta existente").selectOption("160");

    const customerChat = page.getByRole("region", { name: "Chat de cuenta" });
    await customerChat
      .getByPlaceholder("Pregunta sobre la cuenta...")
      .fill("Crea el contacto Oscar Montufar para esta cuenta");
    await customerChat.getByRole("button", { name: "Preguntar" }).click();
    await expect(
      customerChat.getByRole("button", { name: "Revisar operación" }),
    ).toBeVisible();

    await customerChat
      .getByRole("button", { name: "Revisar operación" })
      .click();
    const confirmation = page.getByRole("dialog", {
      name: "Confirmar creación de contacto",
    });
    await expect(confirmation.getByLabel("Cuenta")).toHaveValue("Cuenta Demo");
    await expect(confirmation.getByLabel("Operación")).toHaveValue(
      "Crear contacto Oscar Montufar",
    );
    await expect(confirmation.getByLabel("firstName")).toHaveValue("Oscar");
    await expect(confirmation.getByLabel("lastName")).toHaveValue("Montufar");
    await confirmation
      .getByRole("button", { name: "Continuar en el módulo" })
      .click();

    await expect(page).toHaveURL(
      /\/contacts\?coachDraft=customer-contact-903$/,
    );
    const contactModal = page.locator(".modal-dialog-account");
    await expect(
      contactModal.getByRole("heading", { name: "Crear contacto" }),
    ).toBeVisible();
    await expect(contactModal.getByRole("textbox").nth(0)).toHaveValue("Oscar");
    await expect(contactModal.getByRole("textbox").nth(1)).toHaveValue(
      "Montufar",
    );
    await expect(contactModal.getByRole("combobox").first()).toHaveValue("160");
    expect(contactCreateRequests).toEqual([]);
  });

  test("Cliente existente oculta diagnostico sin permiso aunque la API lo entregue", async ({ page }) => {
    await mockMiCoachApi(page, {
      withCustomerHealth: true,
      withCustomerChatTrace: true,
      withCustomerStageAnswerPrefill: true,
    });
    await openMiCoach(page, { workspace: "customer" });
    await page.getByLabel("Cuenta existente").selectOption("160");
    const chat = page.getByRole("region", { name: "Chat de cuenta" });
    await chat.getByRole("button", { name: "Resumen para reunión" }).click();
    await expect(chat.getByText("La cuenta requiere seguimiento comercial.")).toBeVisible();
    await expect(chat.getByRole("button", { name: "Abrir oportunidad para revisar" })).toBeVisible();
    await expect(chat.locator(".mi-agent-customer-chat-debug")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Diagnóstico de chats", exact: true })).toHaveCount(0);
  });

  test("Cliente existente abre el borrador de respuesta en otra pestaña sin guardar ni salir del chat", async ({
    page,
    context,
  }) => {
    const writes = [];
    context.on("request", (request) => {
      if (
        ["POST", "PUT", "PATCH"].includes(request.method()) &&
        new URL(request.url()).pathname.startsWith("/api/opportunities")
      ) {
        writes.push(request.url());
      }
    });
    await mockMiCoachApi(context, {
      withCustomerHealth: true,
      withCustomerStageAnswerPrefill: true,
    });
    await openMiCoach(page, { workspace: "customer" });
    await page.getByLabel("Cuenta existente").selectOption("160");
    const chat = page.getByRole("region", { name: "Chat de cuenta" });
    await chat.getByPlaceholder("Pregunta sobre la cuenta...").fill(
      "El cliente quiere evitar fugas de información",
    );
    await chat.getByRole("button", { name: "Preguntar" }).click();
    const originalUrl = page.url();
    const popupPromise = page.waitForEvent("popup");
    await chat.getByRole("button", { name: "Abrir oportunidad para revisar" }).click();
    const opportunityTab = await popupPromise;

    await expect(opportunityTab.getByLabel("¿Cuál es el motivo de negocio?")).toHaveValue(
      "Respuesta previa.\n\nReporte del vendedor: Evitar fugas de información.",
    );
    expect(await opportunityTab.evaluate(() => window.opener)).toBeNull();
    await expect(page).toHaveURL(originalUrl);
    await expect(chat.getByText("La cuenta requiere seguimiento comercial.")).toBeVisible();
    expect(writes).toEqual([]);
    await opportunityTab.close();
  });

  test("Cliente existente restaura las partes de la solicitud y el borrador de etapa sin guardar", async ({ page }) => {
    await mockMiCoachApi(page, { withCustomerHealth: true, withCustomerStageAnswerPrefill: true });
    await page.addInitScript(() => {
      window.sessionStorage.setItem("mi-agent-customer-chat-session:160", "920");
    });
    await page.route("**/api/commercial-intelligence/account-chat/sessions/920", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          session: {
            id: 920, accountId: 160,
            history: [{
              role: "assistant",
              text: "Conservé tu reporte. La comunicación no se envió.",
              components: [
                { id: "c1", category: "report.client_statement", label: "Reporte del cliente", status: "completed" },
                { id: "c2", category: "action.send_communication", label: "Enviar correo", status: "unavailable" },
              ],
              stageAnswerPrefill: {
                opportunityId: 18, questionIds: [33], questionPrompts: ["Motivación"],
                appendText: "Reporte sintético del cliente.",
              },
            }],
          },
        }),
      }),
    );
    await openMiCoach(page, { workspace: "customer" });
    await page.getByLabel("Cuenta existente").selectOption("160");
    const chat = page.getByRole("region", { name: "Chat de cuenta" });
    await expect(chat.getByRole("list", { name: "Estado de solicitudes" })).toContainText("Atendida: Reporte del cliente");
    await expect(chat.getByRole("list", { name: "Estado de solicitudes" })).toContainText("Capacidad no disponible: Enviar correo");
    await expect(chat.getByRole("button", { name: "Abrir oportunidad para revisar" })).toBeVisible();
  });

  test("Cliente existente avisa si el navegador bloquea la pestaña de oportunidad", async ({
    page,
  }) => {
    await mockMiCoachApi(page, {
      withCustomerHealth: true,
      withCustomerStageAnswerPrefill: true,
    });
    await openMiCoach(page, { workspace: "customer" });
    await page.getByLabel("Cuenta existente").selectOption("160");
    const chat = page.getByRole("region", { name: "Chat de cuenta" });
    await chat.getByPlaceholder("Pregunta sobre la cuenta...").fill(
      "El cliente quiere evitar fugas de información",
    );
    await chat.getByRole("button", { name: "Preguntar" }).click();
    await page.evaluate(() => { window.open = () => null; });
    await chat.getByRole("button", { name: "Abrir oportunidad para revisar" }).click();
    await expect(page.getByText(/Permite las ventanas emergentes de este sitio/)).toBeVisible();
    await expect(page).toHaveURL(/\/mi-agent$/);
  });

  test("Cliente existente revisa creación de oportunidad antes de continuar", async ({
    page,
  }) => {
    const opportunityWrites = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/opportunities"
      ) {
        opportunityWrites.push(request.postDataJSON());
      }
    });
    await mockMiCoachApi(page, {
      withCustomerHealth: true,
      withCustomerOpportunityOperation: true,
    });
    await openMiCoach(page, { workspace: "customer" });
    await page.getByLabel("Cuenta existente").selectOption("160");

    const customerChat = page.getByRole("region", { name: "Chat de cuenta" });
    await customerChat
      .getByPlaceholder("Pregunta sobre la cuenta...")
      .fill("Crea una oportunidad de renovación para esta cuenta");
    await customerChat.getByRole("button", { name: "Preguntar" }).click();
    await customerChat
      .getByRole("button", { name: "Revisar operación" })
      .click();

    const confirmation = page.getByRole("dialog", {
      name: "Confirmar creación de oportunidad",
    });
    await expect(confirmation.getByLabel("Cuenta")).toHaveValue("Cuenta Demo");
    await expect(confirmation.getByLabel("Operación")).toHaveValue(
      "Crear oportunidad Renovación anual",
    );
    await expect(confirmation.getByLabel("name")).toHaveValue(
      "Renovación anual",
    );
    await confirmation
      .getByRole("button", { name: "Continuar en el módulo" })
      .click();
    await expect(page).toHaveURL(
      /\/opportunities\?coachDraft=customer-opportunity-904$/,
    );
    await expect(
      page.getByRole("heading", { name: "Crear oportunidad" }),
    ).toBeVisible();
    await expect(
      page
        .locator(".opportunity-edit-modal .account-create-form input")
        .first(),
    ).toHaveValue("Renovación anual");
    expect(opportunityWrites).toEqual([]);
  });

  test("Cliente existente muestra el contacto y la oportunidad antes de vincularlos", async ({
    page,
  }) => {
    const opportunityWrites = [];
    page.on("request", (request) => {
      if (
        request.method() === "PUT" &&
        /^\/api\/opportunities\/\d+$/.test(new URL(request.url()).pathname)
      ) {
        opportunityWrites.push(request.postDataJSON());
      }
    });
    await mockMiCoachApi(page, {
      withCustomerHealth: true,
      withCustomerContactOpportunityLink: true,
    });
    await openMiCoach(page, { workspace: "customer" });
    await page.getByLabel("Cuenta existente").selectOption("160");

    const customerChat = page.getByRole("region", { name: "Chat de cuenta" });
    await customerChat
      .getByPlaceholder("Pregunta sobre la cuenta...")
      .fill("Vincula a Ana Compras con Proyecto abierto");
    await customerChat.getByRole("button", { name: "Preguntar" }).click();
    await customerChat
      .getByRole("button", { name: "Revisar operación" })
      .click();

    const confirmation = page.getByRole("dialog", {
      name: "Confirmar vínculo de contacto a oportunidad",
    });
    await expect(confirmation.getByLabel("Cuenta")).toHaveValue("Cuenta Demo");
    await expect(confirmation.getByLabel("Oportunidad")).toHaveValue(
      "Proyecto abierto",
    );
    await expect(
      confirmation.getByLabel("Contacto que se asociará"),
    ).toHaveValue("Ana Compras");
    await confirmation
      .getByRole("button", { name: "Continuar en el módulo" })
      .click();
    await expect(page).toHaveURL(
      /\/opportunities\?coachDraft=customer-opportunity-905$/,
    );
    await expect(
      page.getByRole("heading", { name: "Editar oportunidad" }),
    ).toBeVisible();
    await expect(
      page.locator(".opportunity-edit-modal select").nth(1),
    ).toHaveValue("601");
    expect(opportunityWrites).toEqual([]);
  });

  test("Cliente existente ofrece y envia todos los formatos documentales sin escribir en oportunidades", async ({ page }) => {
    const opportunityWrites = [];
    page.on("request", (request) => {
      if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/opportunities")) {
        opportunityWrites.push(request.url());
      }
    });
    await mockMiCoachApi(page, { withCustomerHealth: true });
    await openMiCoach(page, { workspace: "customer" });
    await page.getByLabel("Cuenta existente").selectOption("160");
    const chat = page.getByRole("region", { name: "Chat de cuenta" });
    const picker = chat.getByLabel("Adjuntar documento, imagen o audio");
    await expect(picker).toHaveAttribute("accept", DOCUMENT_FILE_ACCEPT);
    await expect(picker).not.toHaveAttribute("multiple");
    await expect(chat).toContainText("Un archivo por mensaje.");
    for (const [extension, format] of Object.entries(DOCUMENT_FORMATS)) {
      const name = `referencia${extension}`;
      await picker.setInputFiles({ name, mimeType: format.mimeTypes[0], buffer: Buffer.from("Contenido de referencia") });
      await expect(chat.getByTitle(name, { exact: true })).toBeVisible();
      await chat.getByPlaceholder("Pregunta sobre la cuenta...").fill(`Resume ${name}`);
      const upload = page.waitForRequest((request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/commercial-intelligence/account-chat/jobs",
      );
      await chat.getByRole("button", { name: "Preguntar" }).click();
      const sent = await upload;
      expect(sent.headers()["content-type"]).toContain("multipart/form-data");
      expect(sent.postDataBuffer().toString()).toContain(`filename="${name}"`);
      await expect(chat.getByRole("button", { name: "Preguntar" })).toHaveText("Preguntar");
      await expect(chat.getByRole("button", { name: "Quitar archivo adjunto" })).toHaveCount(0);
    }
    expect(opportunityWrites).toEqual([]);
  });

  test("Cliente existente muestra los errores de validacion de adjuntos", async ({ page }) => {
    await mockMiCoachApi(page, { withCustomerHealth: true });
    await page.route("**/api/commercial-intelligence/account-chat/jobs", (route) =>
      route.fulfill({ status: 400, contentType: "application/json",
        body: JSON.stringify({ message: "El archivo evidencia.pdf excede el tamano permitido para .pdf." }) }),
    );
    await openMiCoach(page, { workspace: "customer" });
    await page.getByLabel("Cuenta existente").selectOption("160");
    const chat = page.getByRole("region", { name: "Chat de cuenta" });
    await chat.getByLabel("Adjuntar documento, imagen o audio").setInputFiles({
      name: "evidencia.pdf", mimeType: "application/pdf", buffer: Buffer.from("fixture"),
    });
    await chat.getByPlaceholder("Pregunta sobre la cuenta...").fill("Resume el archivo");
    await chat.getByRole("button", { name: "Preguntar" }).click();
    await expect(chat.getByText("El archivo evidencia.pdf excede el tamano permitido para .pdf.", { exact: true })).toBeVisible();
  });

  for (const failure of ["", "proposal", "review"]) {
    test(`revisar nota de Cliente existente ${failure || "abre confirmacion sin guardar"}`, async ({ page }) => {
      const writes = [];
      page.on("request", (request) => {
        if (request.method() !== "GET" && /\/execute$|\/opportunities\/\d+\/notes/.test(new URL(request.url()).pathname)) {
          writes.push(request.url());
        }
      });
      await mockMiCoachApi(page, {
        withCustomerHealth: true, withCustomerNote: true, customerNoteFailure: failure,
      });
      await openMiCoach(page, { workspace: "customer" });
      await page.getByLabel("Cuenta existente").selectOption("160");
      const chat = page.getByRole("region", { name: "Chat de cuenta" });
      await chat.getByPlaceholder("Pregunta sobre la cuenta...").fill("Registra una nota para Proyecto abierto");
      await chat.getByRole("button", { name: "Preguntar" }).click();
      await chat.getByRole("button", { name: "Revisar operación" }).click();
      const dialog = page.getByRole("dialog", { name: "Confirmar cambio del Coach" });
      if (failure) {
        await expect(page.getByText(failure === "proposal"
          ? "No se pudo preparar la nota de esta cuenta."
          : "La nota ya no está disponible para revisión.", { exact: true })).toBeVisible();
        await expect(dialog).toHaveCount(0);
      } else {
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText("El cliente solicita revisar el alcance.");
        await expect(dialog.getByLabel("Oportunidad", { exact: true })).toHaveValue("Proyecto abierto");
        const confirm = dialog.getByRole("button", { name: "Confirmar y guardar", exact: true });
        await expect(confirm).toBeEnabled();
        const note = dialog.getByLabel("Texto de la nota");
        await note.fill("   ");
        await expect(confirm).toBeDisabled();
        await note.fill("El cliente confirmó el alcance actualizado.");
        await expect(confirm).toBeEnabled();
        expect(writes).toEqual([]);
        const savedDraft = page.waitForRequest((request) =>
          request.method() === "PATCH" &&
          new URL(request.url()).pathname === "/api/mi-agent/coach/operations/905" &&
          request.postDataJSON()?.pendingOperation?.noteText === "El cliente confirmó el alcance actualizado.",
        );
        await confirm.click();
        await savedDraft;
        await expect(dialog).toHaveCount(0);
        expect(writes).toHaveLength(1);
        expect(new URL(writes[0]).pathname).toBe("/api/mi-agent/coach/operations/905/execute");
      }
      await expect(chat.getByRole("button", { name: "Revisar operación" })).toBeEnabled();
      if (failure) expect(writes).toEqual([]);
    });
  }

  test("A04 versionado traslada desde chat y guarda solo la asociación desde Oportunidades", async ({ page }) => {
    const writes = [];
    page.on("request", (request) => {
      if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/opportunities")) {
        writes.push({ method: request.method(), path: new URL(request.url()).pathname, body: request.postDataJSON() });
      }
    });
    await mockMiCoachApi(page, { withCustomerHealth: true, withCustomerContactOpportunityLink: true, withVersionedCustomerLink: true });
    await openMiCoach(page, { workspace: "customer" });
    await page.getByLabel("Cuenta existente").selectOption("160");
    const chat = page.getByRole("region", { name: "Chat de cuenta" });
    await chat.getByPlaceholder("Pregunta sobre la cuenta...").fill("Vincula a Ana Compras con Proyecto abierto");
    await chat.getByRole("button", { name: "Preguntar" }).click();
    await chat.getByRole("button", { name: "Revisar operación" }).click();
    const dialog = page.getByRole("dialog", { name: "Confirmar vínculo de contacto a oportunidad" });
    await expect(dialog).toContainText("Contacto actual: Contacto Anterior");
    await expect(dialog).toContainText("no se conservarán ambos");
    await dialog.getByRole("button", { name: "Continuar en el módulo" }).click();
    const panel = page.getByRole("region", { name: "Revisar vínculo contacto-oportunidad" });
    await expect(panel).toBeVisible();
    await expect(page.getByRole("heading", { name: "Editar oportunidad" })).toHaveCount(0);
    expect(writes).toEqual([]);
    await panel.getByRole("button", { name: "Confirmar y guardar vínculo" }).click();
    await expect(panel).toHaveCount(0);
    await expect(page).not.toHaveURL(/coachDraft=/);
    await expect(page.getByRole("status")).toContainText("Vínculo guardado y auditado correctamente");
    expect(writes).toEqual([{ method: "POST", path: "/api/opportunities/300/coach-contact",
      body: { token: "44a6bf85-cd5a-431e-9697-fd0b2da5e9f6", version: 1 } }]);
  });

  for (const decision of ["ready_to_advance", "not_ready_to_advance"]) {
    test(`A08 traslada sin ejecutar y conserva resultado existente ${decision}`, async ({ page }) => {
      const starts = [], forbidden = [];
      page.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (request.method() === "POST" && path.endsWith("/coach-stage-validation")) starts.push(request.postDataJSON());
        if (request.method() !== "GET" && /stage-transition|commercial-close|\/opportunities\/300$/.test(path)) forbidden.push(path);
      });
      await mockMiCoachApi(page, { withCustomerHealth: true, withCustomerStage: true, customerStageDecision: decision });
      await openMiCoach(page, { workspace: "customer" });
      await page.getByLabel("Cuenta existente").selectOption("160");
      const chat = page.getByRole("region", { name: "Chat de cuenta" });
      await chat.getByPlaceholder("Pregunta sobre la cuenta...").fill("Valida avanzar Proyecto abierto");
      await chat.getByRole("button", { name: "Preguntar" }).click();
      await chat.getByRole("button", { name: "Revisar operación" }).click();
      const dialog = page.getByRole("dialog", { name: "Confirmar cambio del Coach" });
      await expect(dialog).toContainText("Siguiente etapa: Negociación");
      await expect(dialog).toContainText("puede avanzar automáticamente");
      expect(starts).toEqual([]);
      await dialog.getByRole("button", { name: "Continuar en el módulo" }).click();
      await expect(page).toHaveURL(/\/opportunities\?coachDraft=/);
      const panel = page.getByRole("region", { name: "Validar avance desde Mi Coach" });
      await expect(panel).toBeVisible();
      expect(starts).toEqual([]);
      await panel.getByRole("button", { name: "Solicitar validación con IA (puede avanzar)", exact: true }).click();
      const result = panel.getByRole("region", { name: "Resultado de validación" });
      await expect(result).toContainText(decision === "ready_to_advance" ? "Etapa avanzada" : "La etapa no está lista para avanzar");
      await expect(result).toContainText("Resultado del validador existente");
      expect(starts).toEqual([{ token: "44a6bf85-cd5a-431e-9697-fd0b2da5e9f6", version: 1 }]);
      expect(forbidden).toEqual([]);
      await expect(panel.getByRole("button", { name: "Solicitar validación con IA (puede avanzar)", exact: true })).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole("region", { name: "Resultado de validación" })).toContainText("Resultado del validador existente");
      expect(starts).toHaveLength(1);
    });
  }

  test("A07 revisa el resultado completo sin comentario obligatorio y guarda solo con confirmación", async ({ page }) => {
    const writes = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() !== "GET" && path.includes("/coach/operations/") && path.endsWith("/execute")) writes.push(request.postDataJSON());
    });
    await mockMiCoachApi(page, { withCustomerHealth: true, withCustomerOutcome: true });
    await openMiCoach(page, { workspace: "customer" });
    await page.getByLabel("Cuenta existente").selectOption("160");
    const chat = page.getByRole("region", { name: "Chat de cuenta" });
    await chat.getByPlaceholder("Pregunta sobre la cuenta...").fill("Registra resultado de llamada del lead 105");
    await chat.getByRole("button", { name: "Preguntar" }).click();
    await chat.getByRole("button", { name: "Revisar operación" }).click();
    const dialog = page.getByRole("dialog", { name: "Confirmar cambio del Coach" });
    await expect(dialog).toContainText("Lead 105 · Lead ficticio");
    await expect(dialog).toContainText("Resultado propuesto");
    await expect(dialog).toContainText("Recopilar contexto faltante");
    await expect(dialog).toContainText("Estado resultante");
    await expect(dialog.getByRole("textbox")).toHaveCount(1);
    await expect(dialog.getByRole("textbox")).toBeDisabled();
    expect(writes).toEqual([]);
    const confirm = dialog.getByRole("button", { name: "Confirmar y guardar" });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Resultado del lead guardado correctamente.").first()).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ version: 2, idempotencyKey: expect.any(String) });
  });

  test("A07 conflicto visible no acredita guardado ni permite editar un borrador versionado en el modal", async ({ page }) => {
    await mockMiCoachApi(page, { withCustomerHealth: true, withCustomerOutcome: true, failCustomerOutcome: true });
    await openMiCoach(page, { workspace: "customer" });
    await page.getByLabel("Cuenta existente").selectOption("160");
    const chat = page.getByRole("region", { name: "Chat de cuenta" });
    await chat.getByPlaceholder("Pregunta sobre la cuenta...").fill("Registra resultado de llamada del lead 105");
    await chat.getByRole("button", { name: "Preguntar" }).click();
    await chat.getByRole("button", { name: "Revisar operación" }).click();
    const dialog = page.getByRole("dialog", { name: "Confirmar cambio del Coach" });
    await dialog.getByRole("button", { name: "Confirmar y guardar" }).click();
    await expect(dialog).toContainText("El lead cambió");
    await expect(dialog).toBeVisible();
    await expect(page.getByText("Resultado del lead guardado correctamente.")).toHaveCount(0);
  });

  test("A07 una respuesta incompleta no acredita guardado", async ({ page }) => {
    await mockMiCoachApi(page, { withCustomerHealth: true, withCustomerOutcome: true, incompleteCustomerOutcome: true });
    await openMiCoach(page, { workspace: "customer" });
    await page.getByLabel("Cuenta existente").selectOption("160");
    const chat = page.getByRole("region", { name: "Chat de cuenta" });
    await chat.getByPlaceholder("Pregunta sobre la cuenta...").fill("Registra resultado del lead 105");
    await chat.getByRole("button", { name: "Preguntar" }).click();
    await chat.getByRole("button", { name: "Revisar operación" }).click();
    const dialog = page.getByRole("dialog", { name: "Confirmar cambio del Coach" });
    await dialog.getByRole("button", { name: "Confirmar y guardar" }).click();
    await expect(dialog).toContainText("No se acredita como guardado");
    await expect(page.getByText("Resultado del lead guardado correctamente.")).toHaveCount(0);
  });

  test("A06 traslada del chat a Calendario sin crear una actividad y guarda solo al confirmar", async ({ page }) => {
    const writes = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() !== "GET" && (path.startsWith("/api/opportunities") || path.startsWith("/api/commercial-development"))) {
        writes.push({ method: request.method(), path, body: request.postDataJSON() });
      }
    });
    await mockMiCoachApi(page, { withCustomerHealth: true, withCustomerReschedule: true });
    await openMiCoach(page, { workspace: "customer" });
    await page.getByLabel("Cuenta existente").selectOption("160");
    const chat = page.getByRole("region", { name: "Chat de cuenta" });
    await chat.getByPlaceholder("Pregunta sobre la cuenta...").fill("Mueve la reunión de Compras al 2030-10-23");
    await chat.getByRole("button", { name: "Preguntar" }).click();
    await chat.getByRole("button", { name: "Revisar operación" }).click();
    const dialog = page.getByRole("dialog", { name: "Confirmar cambio del Coach" });
    await expect(dialog).toContainText("Programación actual: 2030-10-20T10:00:00");
    await expect(dialog).toContainText("Programación propuesta: 2030-10-23T10:00:00");
    await dialog.getByRole("button", { name: "Continuar en el módulo" }).click();
    await expect(page).toHaveURL(/\/calendar\?coachDraft=/);
    const panel = page.getByRole("region", { name: "Revisar reprogramación" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("ID 75");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(writes).toEqual([]);
    await panel.getByRole("button", { name: "Confirmar y reprogramar" }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("Actividad reprogramada y auditada correctamente");
    expect(writes).toEqual([{ method: "POST", path: "/api/opportunities/300/coach-reschedule",
      body: { token: "44a6bf85-cd5a-431e-9697-fd0b2da5e9f6", version: 1 } }]);
  });

  test("cambiar de espacio conserva contexto separado de Coach, Cliente existente y Cuenta nueva", async ({
    page,
  }) => {
    await mockMiCoachApi(page, {
      withCustomerHealth: true,
      withResponseContextSwitch: true,
      withProspect: true,
    });
    await openMiCoach(page, { workspace: "prospect" });

    await page.getByPlaceholder("Nombre de la empresa").fill("Prospecto E2E");
    await page.getByPlaceholder("México, Perú, Colombia...").fill("Mexico");
    await page
      .getByRole("button", { name: "Investigar fuentes públicas" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Prospecto E2E" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Cliente existente" }).click();
    await page.getByLabel("Cuenta existente").selectOption("160");
    await expect(
      page.getByRole("heading", { name: "Cuenta Demo" }),
    ).toBeVisible();

    await openCoachConversation(page);
    const coachScope = page.getByLabel("Alcance actual del Coach");
    await expect(coachScope).toContainText("Ámbito general del vendedor");
    await expect(page.getByLabel("Cuenta activa")).toHaveCount(0);
    await page
      .getByPlaceholder("Escribe tu pregunta para el Coach...")
      .fill("¿Qué seguimiento corresponde a Proyecto B de Cuenta Alterna?");
    await page.getByRole("button", { name: "Preguntar" }).click();
    await expect(
      page.getByText(
        "La oportunidad Proyecto B de Cuenta Alterna tiene seguimiento activo.",
      ),
    ).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "Cliente existente" }).click();
    await expect(page.getByLabel("Cuenta existente")).toHaveValue("160");
    await expect(
      page.getByRole("heading", { name: "Cuenta Demo" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Cuenta nueva" }).click();
    await expect(
      page.getByRole("heading", { name: "Prospecto E2E" }),
    ).toBeVisible();

    await openCoachConversation(page);
    await expect(coachScope).toContainText("Enfoque activo");
    await expect(coachScope).toContainText("Proyecto B");
    await expect(
      page.getByText(
        "¿Qué seguimiento corresponde a Proyecto B de Cuenta Alterna?",
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        "La oportunidad Proyecto B de Cuenta Alterna tiene seguimiento activo.",
      ),
    ).toBeVisible();
  });

  test("deriva la exploración detallada de Coach a Cliente existente con la cuenta seleccionada", async ({
    page,
  }) => {
    await mockMiCoachApi(page, {
      withCoachInterface: true,
      withCustomerHealth: true,
    });
    await page.route("**/api/mi-agent/coach/sessions/active", async (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session: {
            id: 70,
            context: { accountId: 160, opportunityId: 22 },
            messages: [
              {
                id: "deep-exploration-handoff",
                role: "coach",
                result: {
                  intent: "continue_work",
                  responseType: "handoff",
                  confidence: "high",
                  answer:
                    "Este nivel de detalle se trabaja en Cliente existente.",
                  evidence: [],
                  facts: [],
                  inferences: [],
                  pendingItems: [],
                  recommendation: null,
                  operations: [],
                  clarification: null,
                  action: null,
                  stageReadiness: null,
                  intentRouting: {
                    intent: "quotation_query",
                    mode: "deep_exploration",
                    detailTarget: "quotation",
                    confidence: 0.96,
                    contextNeeded: ["opportunity"],
                    requiredContext: ["opportunity"],
                    allowedTools: [],
                  },
                  detailHandoff: {
                    destination: "customer_account",
                    detailTarget: "quotation",
                    accountId: 160,
                    opportunityId: 22,
                    contactId: null,
                    leadId: null,
                  },
                },
              },
            ],
          },
          operations: [],
          recentOperations: [],
        }),
      }),
    );
    await openMiCoach(page);

    await expect(
      page.getByText("Este nivel de detalle se trabaja en Cliente existente."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Abrir Cliente existente" }).click();

    await expect(page.getByLabel("Cuenta existente")).toHaveValue("160");
    await expect(
      page.getByRole("heading", { name: "Cuenta Demo" }),
    ).toBeVisible();
  });

  test("deriva la exploración detallada de un lead a su registro en Interacciones", async ({
    page,
  }) => {
    await mockMiCoachApi(page, {
      withCoachInterface: true,
      withLeadRead: true,
    });
    await page.route("**/api/mi-agent/coach/sessions/active", async (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session: {
            id: 72,
            context: { leadId: 701 },
            messages: [
              {
                id: "deep-lead-handoff",
                role: "coach",
                result: {
                  intent: "continue_work",
                  responseType: "handoff",
                  confidence: "high",
                  answer:
                    "El detalle de este lead se revisa en gestión de leads.",
                  evidence: [],
                  facts: [],
                  inferences: [],
                  pendingItems: [],
                  recommendation: null,
                  operations: [],
                  clarification: null,
                  action: null,
                  stageReadiness: null,
                  intentRouting: {
                    intent: "lead_query",
                    mode: "deep_exploration",
                    detailTarget: "lead",
                    confidence: 0.96,
                    contextNeeded: ["lead"],
                    requiredContext: ["lead"],
                    allowedTools: [],
                  },
                  detailHandoff: {
                    destination: "lead_management",
                    detailTarget: "lead",
                    accountId: null,
                    opportunityId: null,
                    contactId: null,
                    leadId: 701,
                  },
                },
              },
            ],
          },
          operations: [],
          recentOperations: [],
        }),
      }),
    );
    await openMiCoach(page);
    await expect(
      page.getByText("El detalle de este lead se revisa en gestión de leads."),
    ).toBeVisible();
    const leadDetailRequest = page.waitForRequest((request) =>
      request.url().endsWith("/api/interactions/701"),
    );
    await page.getByRole("button", { name: "Abrir gestión de leads" }).click();
    await expect(page).toHaveURL(/\/interactions(?:\?.*)?$/);
    await leadDetailRequest;
    await expect(
      page.getByRole("heading", { name: "Editar lead" }),
    ).toBeVisible();
    await expect(page.getByRole("textbox").first()).toBeVisible();
    await expect(page.getByRole("textbox").first()).toHaveValue(
      "Lead seleccionado por Coach",
    );
  });

  test("confirma el regreso al ámbito general y no restaura una conversación cerrada", async ({
    page,
  }) => {
    await mockMiCoachApi(page, {
      withCoachInterface: true,
      withResponseContextSwitch: true,
    });
    let releaseRestoration;
    const restorationGate = new Promise((resolve) => {
      releaseRestoration = resolve;
    });
    let sessionClosed = false;
    await page.route("**/api/mi-agent/coach/sessions/active", async (route) => {
      if (!sessionClosed) await restorationGate;
      const session = sessionClosed
        ? null
        : {
            id: 70,
            context: { accountId: 170 },
            messages: [
              {
                id: "old-seller-message",
                role: "seller",
                text: "Pregunta de la cuenta anterior",
              },
              {
                id: "old-coach-message",
                role: "coach",
                result: {
                  responseType: "informational",
                  confidence: "high",
                  answer: "Respuesta de la cuenta anterior",
                },
              },
            ],
          };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session,
          operations: sessionClosed
            ? []
            : [
                {
                  id: 84,
                  kind: "activity",
                  status: "collecting",
                  version: 1,
                  targetModule: "commercial_development",
                  missingFields: ["scheduledAt"],
                  pendingOperation: {
                    kind: "activity",
                    title: "Llamar al cliente",
                    opportunityId: 22,
                    missingFields: ["scheduledAt"],
                  },
                },
              ],
          recentOperations: [],
        }),
      });
    });
    await page.route(
      "**/api/mi-agent/coach/sessions/70/close",
      async (route) => {
        sessionClosed = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ session: { id: 70, status: "closed" } }),
        });
      },
    );

    const activeSessionRequest = page.waitForRequest((request) =>
      request.url().endsWith("/api/mi-agent/coach/sessions/active"),
    );
    await openMiCoach(page);
    await activeSessionRequest;
    releaseRestoration();
    await expect(
      page.getByText("Respuesta de la cuenta anterior"),
    ).toBeVisible();
    const coachScope = page.getByLabel("Alcance actual del Coach");
    await expect(coachScope).toContainText("Enfoque activo");

    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Volver al ámbito general");
      expect(dialog.message()).toContain("1 acción pendiente");
      await dialog.dismiss();
    });
    await page
      .getByRole("button", { name: "Volver al ámbito general" })
      .click();
    await expect(coachScope).toContainText("Cuenta Alterna");
    await expect(
      page.getByText("Respuesta de la cuenta anterior"),
    ).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    const cancelledOperationRequest = page.waitForRequest(
      (request) =>
        request.url().endsWith("/api/mi-agent/coach/operations/84/status") &&
        request.method() === "POST",
    );
    await page
      .getByRole("button", { name: "Volver al ámbito general" })
      .click();
    expect((await cancelledOperationRequest).postDataJSON()).toMatchObject({
      status: "cancelled",
      cancellationReason: "Descartada al volver al ámbito general",
    });
    await expect(coachScope).toContainText("Ámbito general del vendedor");
    await expect(page.getByText("Pregunta de la cuenta anterior")).toHaveCount(
      0,
    );
    await expect(page.getByText("Respuesta de la cuenta anterior")).toHaveCount(
      0,
    );

    await page.reload();
    await openCoachConversation(page);
    await expect(page.getByLabel("Alcance actual del Coach")).toContainText(
      "Ámbito general del vendedor",
    );
    await expect(page.getByText("Respuesta de la cuenta anterior")).toHaveCount(
      0,
    );
  });

  test("limpia la conversación del Coach y no la restaura al recargar", async ({
    page,
  }) => {
    await mockMiCoachApi(page, { withCoachInterface: true });
    await openMiCoach(page);

    await expect(
      page.getByText("La oportunidad aún no está lista para avanzar."),
    ).toBeVisible();
    page.once("dialog", (dialog) => {
      expect(dialog.message()).toContain("Se cerrará esta conversación");
      expect(dialog.message()).toContain("3 acciones pendientes");
      dialog.accept();
    });
    await page.getByRole("button", { name: "Limpiar conversación" }).click();

    await expect(
      page.getByText("La oportunidad aún no está lista para avanzar."),
    ).toHaveCount(0);
    await expect(
      page.getByText("Inicia una conversación con tu contexto actual"),
    ).toBeVisible();

    await page.reload();
    await openCoachConversation(page);
    await expect(
      page.getByText("La oportunidad aún no está lista para avanzar."),
    ).toHaveCount(0);
  });

  test("mi_coach.use permite Coach, pero no Cliente existente ni Cuenta nueva", async ({
    page,
  }) => {
    await mockMiCoachApi(page, {
      withCoachModuleAccess: true,
      withCustomerHealth: true,
      withCustomerChatAccess: false,
      withProspect: true,
      withProspectChatAccess: false,
    });
    await openMiCoach(page, { workspace: "summary" });

    const workspaces = page.getByRole("navigation", {
      name: "Espacios de Mi Coach",
    });
    await expect(
      workspaces.getByRole("button", { name: "Mi Coach", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Vistas de Mi Coach" })
        .getByRole("button", { name: "Conversación", exact: true }),
    ).toBeVisible();
    await expect(
      workspaces.getByRole("button", { name: "Cliente existente" }),
    ).toHaveCount(0);
    await expect(
      workspaces.getByRole("button", { name: "Cuenta nueva" }),
    ).toHaveCount(0);
  });

  test("la entrada al módulo no habilita canales por sí sola", async ({
    page,
  }) => {
    await mockMiCoachApi(page, {
      withCoachModuleAccess: true,
      withCoachAccess: false,
      withCustomerHealth: true,
      withCustomerChatAccess: false,
      withProspect: true,
      withProspectChatAccess: false,
    });
    await openMiCoach(page, { workspace: "summary" });

    const workspaces = page.getByRole("navigation", {
      name: "Espacios de Mi Coach",
    });
    await expect(workspaces).toBeVisible();
    await expect(
      workspaces.getByRole("button", { name: "Mi Coach", exact: true }),
    ).toHaveCount(0);
    await expect(
      workspaces.getByRole("button", { name: "Cliente existente" }),
    ).toHaveCount(0);
    await expect(
      workspaces.getByRole("button", { name: "Cuenta nueva" }),
    ).toHaveCount(0);
    await expect(
      page.getByText("No tienes canales habilitados en Mi Coach."),
    ).toBeVisible();
  });

  test("Cliente existente funciona sin permiso de Coach", async ({
    page,
  }) => {
    await mockMiCoachApi(page, {
      withCoachModuleAccess: true,
      withCoachAccess: false,
      withCustomerHealth: true,
      withCustomerChatAccess: true,
    });
    await openMiCoach(page, { workspace: "customer" });

    const workspaces = page.getByRole("navigation", {
      name: "Espacios de Mi Coach",
    });
    await expect(
      workspaces.getByRole("button", { name: "Cliente existente" }),
    ).toBeVisible();
    await expect(
      workspaces.getByRole("button", { name: "Mi Coach", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Chat de cuenta" }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Vistas de Mi Coach" }),
    ).toHaveCount(0);
  });

  test("Resumen concentra el análisis comercial y enlaza cada recomendación", async ({
    page,
  }) => {
    const crmWrites = [];
    page.on("request", (request) => {
      const method = request.method();
      const url = request.url();
      if (
        ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
        [
          "/api/opportunities",
          "/api/commercial-development",
          "/api/interactions",
        ].some((path) => url.includes(path))
      ) {
        crmWrites.push(`${method} ${url}`);
      }
    });
    await mockMiCoachApi(page, { withSituationAnalysis: true });
    await openMiCoach(page, { workspace: "summary" });

    await expect(page.getByText("Pipeline abierto")).toBeVisible();
    await expect(page.getByText(/85,000/)).toBeVisible();
    await expect(
      page.getByText("2 oportunidades · 1.1x cobertura"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Analizar mi situación" }).click();

    await expect(
      page.getByRole("heading", { name: "Atiende la renovación crítica" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Actividad vs. avance" }),
    ).toBeVisible();
    await expect(
      page.getByText("Actividad sin evidencia de etapa"),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Problemas de venta detectados" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Qué hacer ahora" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Crear próximo paso" }),
    ).toBeVisible();

    await openCoachConversation(page);
    await expect(
      page.getByPlaceholder("Escribe tu pregunta para el Coach..."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Analizar mi situación" }),
    ).toHaveCount(0);
    await page
      .getByRole("navigation", { name: "Vistas de Mi Coach" })
      .getByRole("button", { name: "Resumen", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Atiende la renovación crítica" }),
    ).toBeVisible();

    await page
      .locator(".mi-agent-action-item")
      .getByRole("button", { name: "Abrir oportunidad" })
      .click();
    await expect(page).toHaveURL(/\/opportunities\?edit=501$/);
    expect(crmWrites).toEqual([]);
  });

  test("Resumen normaliza el pipeline a la moneda de cuota y maneja falta de tipo de cambio", async ({
    page,
  }) => {
    await mockMiCoachApi(page, {
      withSituationAnalysis: true,
      quotaCurrencyCode: "MXN",
      usdToTargetRate: 17.5,
    });
    await openMiCoach(page, { workspace: "summary" });

    const metrics = page.locator(".mi-agent-metrics article");
    await expect(metrics.nth(0)).toContainText("1,750,000");
    await expect(page.getByText(/1 USD = 17\.5 MXN/)).toBeVisible();
    await expect(metrics.nth(1)).toContainText("437,500");
    await expect(metrics.nth(2)).toContainText("1,312,500");
    await expect(metrics.nth(3)).toContainText("1,487,500");
    await expect(metrics.nth(3)).toContainText(
      "2 oportunidades · 1.1x cobertura",
    );

    await mockMiCoachApi(page, {
      withSituationAnalysis: true,
      quotaCurrencyCode: "MXN",
      currencyConversionAvailable: false,
    });
    await page.reload();
    await expect(
      page.getByText("No se obtuvo tipo de cambio desde USD"),
    ).toBeVisible();
    await expect(page.getByText("Cobertura no disponible")).toBeVisible();
    await expect(
      page.getByText("Avance no disponible: falta tipo de cambio"),
    ).toBeVisible();
  });

  test("administra reglas del servidor en nueve categorias, guarda y restaura versiones solo en Cliente existente", async ({ page }) => {
    await mockMiCoachApi(page, { canAdmin: true });
    await openMiCoach(page);
    await page.getByRole("button", { name: "Administración" }).click();
    const section = page.locator("details.mi-agent-server-rules");
    await section.locator(":scope > summary").click();
    await expect(section.getByText("Versión 0", { exact: true })).toBeVisible();
    await expect(section.locator(".mi-agent-server-rule-category")).toHaveCount(10);
    await section.getByText("4. Lectura de datos y evidencia", { exact: true }).click();
    const budget = section.getByLabel("Máximo de lecturas por turno");
    await expect(section.getByText("No es un límite de filas:", { exact: false })).toBeVisible();
    await expect(section.getByText("Con cero se mantiene la evaluación inicial", { exact: false })).toBeVisible();
    await expect(budget).toHaveValue("8");
    await budget.fill("3");
    const saveRequest = page.waitForRequest((req) => req.method() === "PUT" &&
      req.url().endsWith("/governance/server-rules/customer_account"));
    await section.getByRole("button", { name: "Guardar reglas del servidor", exact: true }).click();
    expect((await saveRequest).postDataJSON()).toMatchObject({
      expectedVersion: 0, rules: { serverPolicy: { maxReadQueries: 3 } },
    });
    await expect(section.getByRole("status")).toContainText("Versión 1 guardada");
    await budget.fill("2");
    await section.getByRole("button", { name: "Guardar reglas del servidor", exact: true }).click();
    await expect(section.getByRole("status")).toContainText("Versión 2 guardada");
    await section.getByText("Historial de versiones", { exact: true }).click();
    await section.getByLabel("Versión para restaurar").selectOption("0");
    page.once("dialog", (dialog) => dialog.accept());
    await section.getByRole("button", { name: "Cargar versión en formulario" }).click();
    await expect(budget).toHaveValue("8");
    await expect(section.getByText("Versión 2", { exact: true })).toBeVisible();
    await section.getByRole("button", { name: "Guardar reglas del servidor", exact: true }).click();
    await expect(section.getByRole("status")).toContainText("Versión 3 guardada");
    await section.getByLabel("Canal de reglas del servidor").selectOption("coach");
    await expect(section.getByText("Este canal está preparado", { exact: false })).toBeVisible();
    await expect(section.getByRole("button", { name: "Guardar reglas del servidor", exact: true })).toHaveCount(0);
    await section.getByLabel("Canal de reglas del servidor").selectOption("prospect");
    await expect(section.getByText("todavía no modifica sus flujos", { exact: false })).toBeVisible();
    await section.getByLabel("Canal de reglas del servidor").selectOption("customer_account");
    await section.getByText("1. Acceso, solicitud y sesión", { exact: true }).click();
    const protectedRule = section.locator(".mi-agent-server-rule").filter({
      has: page.getByText("Permisos y propiedad", { exact: true }),
    });
    await expect(protectedRule.getByText("Control protegido", { exact: false })).toBeVisible();
    await expect(protectedRule.getByText("conocer el identificador de una conversación de otro vendedor", { exact: false })).toBeVisible();
    await expect(protectedRule.locator("input, select")).toHaveCount(0);
    const legacyPolicy = page.locator("details[aria-labelledby='mi-agent-channel-policy-title']");
    await legacyPolicy.locator(":scope > summary").click();
    await legacyPolicy.getByRole("combobox", { name: "Canal", exact: true }).selectOption("customer_account");
    await expect(legacyPolicy.getByRole("link", { name: "Reglas del servidor" })).toBeVisible();
    await expect(legacyPolicy.getByRole("button", { name: "Guardar políticas del canal" })).toHaveCount(0);
  });

  test("las casillas de reglas del servidor no se superponen y permiten editar y guardar operaciones", async ({ page }) => {
    await mockMiCoachApi(page, { canAdmin: true });
    await openMiCoach(page);
    await page.getByRole("button", { name: "Administración" }).click();
    const section = page.locator("details.mi-agent-server-rules");
    await section.locator(":scope > summary").click();
    await section.getByText("2. Herramientas y operaciones disponibles", { exact: true }).click();
    const operations = section.locator(".mi-agent-server-rules-operations");
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const label of await operations.locator("label").all()) {
        const checkboxBox = await label.locator("input").boundingBox();
        const textBox = await label.locator("span").boundingBox();
        const labelBox = await label.boundingBox();
        expect(checkboxBox.width).toBe(18);
        expect(checkboxBox.height).toBe(18);
        expect(textBox.x).toBeGreaterThanOrEqual(checkboxBox.x + checkboxBox.width + 7);
        expect(textBox.x + textBox.width).toBeLessThanOrEqual(labelBox.x + labelBox.width + 1);
      }
    }
    const activity = operations.getByRole("checkbox", { name: "Actividad", exact: true });
    await expect(activity).toBeChecked();
    await operations.getByText("Actividad", { exact: true }).click();
    await expect(activity).not.toBeChecked();
    const creation = operations.getByRole("checkbox", { name: "Crear oportunidad", exact: true });
    await expect(creation).not.toBeChecked();
    await operations.getByText("Crear oportunidad", { exact: true }).click();
    await expect(creation).toBeChecked();
    const request = page.waitForRequest((req) => req.method() === "PUT" &&
      req.url().endsWith("/governance/server-rules/customer_account"));
    await section.getByRole("button", { name: "Guardar reglas del servidor", exact: true }).click();
    const kinds = (await request).postDataJSON().rules.operationPolicy.allowedKinds;
    expect(kinds).not.toContain("activity");
    expect(kinds).toContain("create_opportunity");
    await expect(section.getByRole("status")).toContainText("Versión 1 guardada");
    await expect(activity).not.toBeChecked();
    await expect(creation).toBeChecked();
    const accountRead = section.getByRole("checkbox", { name: "Consultar cuentas", exact: true });
    expect((await accountRead.boundingBox()).width).toBe(18);
    await accountRead.uncheck();
    await expect(accountRead).not.toBeChecked();
  });

  test("reglas del servidor informa conflictos y conserva el borrador hasta recargar", async ({ page }) => {
    await mockMiCoachApi(page, { canAdmin: true });
    await page.route("**/governance/server-rules/customer_account", (route) => route.fulfill({
      status: 409, contentType: "application/json",
      body: JSON.stringify({ message: "Las reglas cambiaron. Recarga antes de guardar." }),
    }));
    await openMiCoach(page);
    await page.getByRole("button", { name: "Administración" }).click();
    const section = page.locator("details.mi-agent-server-rules");
    await section.locator(":scope > summary").click();
    await section.getByText("4. Lectura de datos y evidencia", { exact: true }).click();
    const budget = section.getByLabel("Máximo de lecturas por turno");
    await budget.fill("3");
    await section.getByRole("button", { name: "Guardar reglas del servidor", exact: true }).click();
    await expect(section.getByRole("alert")).toContainText("Las reglas cambiaron");
    await expect(budget).toHaveValue("3");
    page.once("dialog", (dialog) => dialog.dismiss());
    await section.getByRole("button", { name: "Cargar reglas iniciales" }).click();
    await expect(budget).toHaveValue("3");
    page.once("dialog", (dialog) => dialog.accept());
    await section.getByRole("button", { name: "Recargar reglas guardadas" }).click();
    await expect(budget).toHaveValue("8");
    await expect(section.getByRole("alert")).toHaveCount(0);
  });

  test("agrupa administración y ordena sus secciones en el DOM", async ({ page }) => {
    await mockMiCoachApi(page, { canAdmin: true });
    await openMiCoach(page);
    await page.getByRole("button", { name: "Administración" }).click();
    const groups = page.locator(".mi-agent-administration-groups");
    await expect(groups.locator(":scope > section > h3")).toHaveText([
      "Gobierno y alcance",
      "Interpretación y comportamiento",
      "Validación y diagnóstico",
    ]);
    const expectedGroups = [
      ["Gobierno y alcance", [
        "Configuración de gobierno",
        "Políticas del canal y contexto",
      ]],
      ["Interpretación y comportamiento", [
        "Intenciones y enrutamiento",
        "Clasificador semántico · B3",
        "Prompts del planificador · B6",
        "Reglas conversacionales",
      ]],
      ["Validación y diagnóstico", [
        "Reglas del servidor",
        "Observabilidad de la decisión final",
      ]],
    ];
    for (const [name, sections] of expectedGroups) {
      const group = page.getByRole("region", { name, exact: true });
      await expect(group).toBeVisible();
      await expect(group.locator(":scope > details > summary > strong"))
        .toHaveText(sections);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [name] of expectedGroups) {
      await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
    }
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth,
    )).toBe(true);
  });

  test("administra el clasificador B3 por canal y restaura versiones sin conectar otros canales", async ({ page }) => {
    await mockMiCoachApi(page, { canAdmin: true });
    await openMiCoach(page);
    await page.getByRole("button", { name: "Administración" }).click();
    const section = page.locator("details.mi-agent-semantic-classifier-prompts");
    await section.locator(":scope > summary").click();
    await expect(section.getByText("Conectado a B3.", { exact: false })).toHaveCount(1);
    await expect(section.getByText("Configuración preparada", { exact: false })).toHaveCount(2);
    const input = section.getByLabel("Instrucciones del clasificador B3 de Cliente existente");
    await expect(input).toHaveValue("Instrucción inicial de customer_account");
    const characterCount = section.locator("#b3-instruction-count-customer_account");
    await expect(characterCount).toHaveText(
      `${"Instrucción inicial de customer_account".length} / 8000 caracteres`,
    );
    await expect(input).toHaveAttribute("maxlength", "8000");
    await input.fill("a".repeat(8000));
    await expect(characterCount).toHaveText("8000 / 8000 caracteres");
    await input.press("End");
    await input.press("b");
    await expect(input).toHaveValue("a".repeat(8000));
    const save = section.getByRole("button", { name: "Guardar instrucciones de Cliente existente" });
    for (const instruction of ["Conserva referencias de oportunidad.", "Consultar actividades pendientes es lectura."]) {
      await input.fill(instruction);
      await expect(characterCount).toHaveText(`${instruction.length} / 8000 caracteres`);
      await save.click();
      await expect(section.getByRole("status")).toContainText("nuevos turnos de Cliente existente");
    }
    await section.getByText("Historial del clasificador de Cliente existente", { exact: true }).click();
    const restoreRequest = page.waitForRequest((request) =>
      request.url().endsWith("/semantic-classifier-prompts/customer_account/revisions/1/restore"),
    );
    page.once("dialog", (dialog) => dialog.accept());
    await section.getByRole("button", { name: "Restaurar versión 1 de Cliente existente" }).click();
    expect((await restoreRequest).postDataJSON()).toEqual({ expectedVersion: 2 });
    await expect(input).toHaveValue("Conserva referencias de oportunidad.");
    await expect(characterCount).toHaveText(
      `${"Conserva referencias de oportunidad.".length} / 8000 caracteres`,
    );
    await expect(section.getByRole("heading", { name: "Versión 3", exact: true })).toBeVisible();
    await expect(section.getByRole("heading", { name: "Versión 1", exact: true })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await section.getByRole("button", { name: "Cargar instrucciones predeterminadas de Cliente existente" }).click();
    await expect(input).toHaveValue("Instrucción inicial de customer_account");
    await save.click();
    await expect(section.getByRole("heading", { name: "Versión 4", exact: true })).toBeVisible();
    for (const label of ["Coach", "Cuenta nueva"]) {
      const editor = section.getByLabel(`Instrucciones del clasificador B3 de ${label}`);
      await editor.fill(`Instrucciones preparadas de ${label}`);
      await section.getByRole("button", { name: `Guardar instrucciones de ${label}`, exact: true }).click();
      await expect(section.getByRole("status")).toContainText("guardada sin conexión");
    }
    await section.getByRole("button", { name: "Recargar instrucciones de B3" }).click();
    await expect(input).toHaveValue("Instrucción inicial de customer_account");
    await expect(section.getByLabel("Instrucciones del clasificador B3 de Coach"))
      .toHaveValue("Instrucciones preparadas de Coach");
    await expect(section.getByLabel("Instrucciones del clasificador B3 de Cuenta nueva"))
      .toHaveValue("Instrucciones preparadas de Cuenta nueva");
    await expect(section.getByText("Configuración preparada", { exact: false })).toHaveCount(2);
  });

  test("el editor B3 muestra conflictos y fallos de carga sin perder el borrador", async ({ page }) => {
    await mockMiCoachApi(page, { canAdmin: true });
    await openMiCoach(page);
    await page.getByRole("button", { name: "Administración" }).click();
    const section = page.locator("details.mi-agent-semantic-classifier-prompts");
    await section.locator(":scope > summary").click();
    const input = section.getByLabel("Instrucciones del clasificador B3 de Cliente existente");
    await expect(input).toHaveValue("Instrucción inicial de customer_account");
    await page.route("**/semantic-classifier-prompts/customer_account", (route) =>
      route.fulfill({
        status: 409, contentType: "application/json",
        body: JSON.stringify({ message: "Las instrucciones cambiaron. Recarga antes de guardar." }),
      }),
    );
    await input.fill("Borrador local");
    await section.getByRole("button", { name: "Guardar instrucciones de Cliente existente" }).click();
    await expect(section.getByRole("alert")).toContainText("Recarga antes de guardar");
    await expect(input).toHaveValue("Borrador local");
    await page.route("**/semantic-classifier-prompts", (route) =>
      route.fulfill({
        status: 500, contentType: "application/json",
        body: JSON.stringify({ message: "Configuración no disponible" }),
      }),
    );
    await section.getByRole("button", { name: "Recargar instrucciones de B3" }).click();
    await expect(section.getByRole("alert")).toContainText("Configuración no disponible");
    await expect(input).toHaveValue("Borrador local");
    await page.unroute("**/semantic-classifier-prompts");
    await section.getByRole("button", { name: "Recargar instrucciones de B3" }).click();
    await expect(input).toHaveValue("Instrucción inicial de customer_account");
    await expect(section.getByRole("alert")).toHaveCount(0);
  });

  test("edita prompts versionados por canal y solo conecta Cliente existente", async ({ page }) => {
    await mockMiCoachApi(page, { canAdmin: true });
    await openMiCoach(page);
    await page.getByRole("button", { name: "Administración" }).click();
    const section = page.locator("details.mi-agent-planner-prompts");
    await section.locator(":scope > summary").click();
    await expect(section.getByText("Versión inicial", { exact: true })).toHaveCount(3);
    await expect(section.getByText("Instrucción predeterminada (sin personalización)", { exact: true })).toHaveCount(0);
    await expect(section.getByText("No conectado:", { exact: false })).toHaveCount(2);
    await expect(section.getByText("Conectado a B6.", { exact: false })).toHaveCount(1);
    await expect(section.getByText("El prompt técnico base y el esquema JSON están protegidos.", { exact: false })).toBeVisible();
    const customerInput = section.getByLabel("Instrucciones del planificador de Cliente existente");
    await customerInput.fill("Consultar actividades existentes es una lectura.");
    const saveRequest = page.waitForRequest((request) =>
      request.method() === "PUT" &&
      request.url().endsWith("/coach/admin/planner-prompts/customer_account"),
    );
    await section.getByRole("button", { name: "Guardar prompt de Cliente existente" }).click();
    expect((await saveRequest).postDataJSON()).toEqual({
      instruction: "Consultar actividades existentes es una lectura.",
      expectedVersion: 0,
    });
    await expect(section.getByRole("status")).toContainText("próxima planificación de Cliente existente");
    await section.getByText("Historial de versiones de Cliente existente", { exact: true }).click();
    await expect(section.getByRole("heading", { name: "Versión 1", exact: true })).toBeVisible();
    await expect(section.getByLabel("Instrucciones del planificador de Coach")).toHaveValue("Instrucción inicial de coach");
    await section.getByLabel("Instrucciones del planificador de Coach").fill("Priorizar evidencia comercial.");
    await section.getByRole("button", { name: "Guardar prompt de Coach", exact: true }).click();
    await expect(section.getByRole("status")).toContainText("aún no consume");
    await section.getByLabel("Instrucciones del planificador de Cuenta nueva").fill("Distinguir evidencia pública.");
    await section.getByRole("button", { name: "Guardar prompt de Cuenta nueva", exact: true }).click();
    await expect(section.getByRole("status")).toContainText("aún no consume");
    await section.getByRole("button", { name: "Recargar prompts guardados" }).click();
    await expect(customerInput).toHaveValue("Consultar actividades existentes es una lectura.");
    await expect(section.getByLabel("Instrucciones del planificador de Coach")).toHaveValue("Priorizar evidencia comercial.");
    await expect(section.getByLabel("Instrucciones del planificador de Cuenta nueva")).toHaveValue("Distinguir evidencia pública.");
  });

  test("recupera el prompt inicial después de varias versiones sin borrar el historial", async ({ page }) => {
    await mockMiCoachApi(page, { canAdmin: true });
    await openMiCoach(page);
    await page.getByRole("button", { name: "Administración" }).click();
    const section = page.locator("details.mi-agent-planner-prompts");
    await section.locator(":scope > summary").click();
    const input = section.getByLabel("Instrucciones del planificador de Cliente existente");
    const save = section.getByRole("button", { name: "Guardar prompt de Cliente existente" });
    const restore = section.getByRole("button", { name: "Cargar prompt inicial de Cliente existente" });
    for (const text of ["Primera edición", "Segunda edición"]) {
      await input.fill(text);
      await save.click();
      await expect(save).toBeDisabled();
    }
    await input.fill("Cambio sin guardar");
    page.once("dialog", (dialog) => dialog.dismiss());
    await restore.click();
    await expect(input).toHaveValue("Cambio sin guardar");
    page.once("dialog", (dialog) => dialog.accept());
    await restore.click();
    await expect(input).toHaveValue("Instrucción inicial de customer_account");
    await expect(section.getByRole("status")).toContainText("Pulsa Guardar para activarlo");
    await section.getByRole("button", { name: "Recargar prompts guardados" }).click();
    await expect(input).toHaveValue("Segunda edición");
    page.once("dialog", (dialog) => dialog.accept());
    await restore.click();
    await save.click();
    await expect(save).toBeDisabled();
    await section.getByText("Historial de versiones de Cliente existente", { exact: true }).click();
    for (const version of [1, 2, 3]) {
      await expect(section.getByRole("heading", { name: `Versión ${version}`, exact: true })).toBeVisible();
    }
    await section.getByRole("button", { name: "Recargar prompts guardados" }).click();
    await expect(input).toHaveValue("Instrucción inicial de customer_account");
    await input.fill("Nueva edición después de restaurar");
    page.once("dialog", (dialog) => dialog.accept());
    await restore.click();
    await expect(input).toHaveValue("Instrucción inicial de customer_account");
  });

  test("conserva el borrador y muestra el conflicto al guardar un prompt obsoleto", async ({ page }) => {
    await mockMiCoachApi(page, { canAdmin: true });
    await page.route("**/api/mi-agent/coach/admin/planner-prompts/customer_account", (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ message: "El prompt cambió desde que lo abriste. Recarga antes de guardar." }),
      }),
    );
    await openMiCoach(page);
    await page.getByRole("button", { name: "Administración" }).click();
    const section = page.locator("details.mi-agent-planner-prompts");
    await section.locator(":scope > summary").click();
    const input = section.getByLabel("Instrucciones del planificador de Cliente existente");
    await input.fill("Borrador local");
    await section.getByRole("button", { name: "Guardar prompt de Cliente existente" }).click();
    await expect(page.getByText("El prompt cambió desde que lo abriste. Recarga antes de guardar.")).toBeVisible();
    await expect(input).toHaveValue("Borrador local");
    await expect(section.getByRole("status")).toHaveCount(0);
    await section.getByRole("button", { name: "Recargar prompts guardados" }).click();
    await expect(input).toHaveValue("Instrucción inicial de customer_account");
  });

  test("permite abrir y guardar gobierno con permiso administrativo", async ({
    page,
  }) => {
    await mockMiCoachApi(page, { canAdmin: true });
    await openMiCoach(page);

    const workspaceNavigation = page.getByRole("navigation", {
      name: "Espacios de Mi Coach",
    });
    const adminNavigation = page.getByRole("navigation", {
      name: "Administración",
    });
    await expect(
      adminNavigation.getByRole("button", { name: "Administración" }),
    ).toBeVisible();
    await expect(
      workspaceNavigation.getByRole("button", {
        name: "Administración",
      }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Administración" }).click();
    await expect(
      page.getByRole("heading", { name: "Configuración, límites y métricas" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Calidad y métricas" }),
    ).toHaveCount(0);
    const governanceSettings = page.locator(
      "details.mi-agent-governance-settings",
    );
    await expect(governanceSettings.locator("summary")).toBeVisible();
    await expect(
      governanceSettings.getByLabel("Fuentes externas habilitadas"),
    ).toBeHidden();
    await governanceSettings.locator("summary").click();
    await expect(
      governanceSettings.getByLabel("Fuentes externas habilitadas"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Guardar configuración" }),
    ).toBeVisible();

    const intentRouting = page.locator(".mi-agent-intent-governance");
    const intentChannelSelector = intentRouting.getByRole("combobox", {
      name: "Canal para intenciones y enrutamiento",
    });
    await expect(intentRouting.locator("summary")).toBeVisible();
    await expect(intentChannelSelector).toBeHidden();
    await intentRouting.locator("summary").click();
    await expect(intentChannelSelector).toHaveValue("coach");
    await expect(
      intentRouting.getByRole("navigation", {
        name: "Catálogo de intenciones",
      }),
    ).toBeVisible();
    await expect(
      intentRouting.getByRole("heading", {
        name: "Enrutamiento · Cliente existente",
      }),
    ).toHaveCount(0);

    const customerIntentCatalogRequest = page.waitForRequest(
      (request) =>
        request
          .url()
          .endsWith(
            "/api/commercial-intelligence/governance/channel-intents/customer_account",
          ) && request.method() === "GET",
    );
    await intentChannelSelector.selectOption("customer_account");
    await customerIntentCatalogRequest;
    await expect(
      intentRouting.getByRole("heading", {
        name: "Enrutamiento · Cliente existente",
      }),
    ).toBeVisible();
    await expect(
      intentRouting.getByRole("navigation", {
        name: "Catálogo de intenciones",
      }),
    ).toHaveCount(0);

    const prospectIntentCatalogRequest = page.waitForRequest(
      (request) =>
        request
          .url()
          .endsWith(
            "/api/commercial-intelligence/governance/channel-intents/prospect",
          ) && request.method() === "GET",
    );
    await intentChannelSelector.selectOption("prospect");
    await prospectIntentCatalogRequest;
    await expect(
      intentRouting.getByRole("heading", {
        name: "Enrutamiento · Cuenta nueva",
      }),
    ).toBeVisible();

    await intentChannelSelector.selectOption("coach");
    await expect(
      intentRouting.getByRole("navigation", {
        name: "Catálogo de intenciones",
      }),
    ).toBeVisible();

    const conversationalRules = page.locator("details.mi-agent-admin-rules");
    await expect(conversationalRules.locator("summary").first()).toBeVisible();
    await expect(
      conversationalRules.locator(".mi-agent-admin-rule-groups"),
    ).toBeHidden();
    await conversationalRules.locator("summary").first().click();
    await expect(
      conversationalRules.locator(".mi-agent-admin-rule-groups"),
    ).toBeVisible();
    const ruleGroups = conversationalRules.locator(
      ".mi-agent-admin-rule-group",
    );
    await expect(ruleGroups).toHaveCount(4);
    await expect(
      ruleGroups.nth(0).locator(".mi-agent-admin-rule-empty"),
    ).toBeHidden();
    await ruleGroups.nth(0).locator("summary").click();
    await expect(
      ruleGroups.nth(0).locator(".mi-agent-admin-rule-empty"),
    ).toBeVisible();
    await expect(
      ruleGroups.nth(1).locator(".mi-agent-admin-rule-empty"),
    ).toBeHidden();

    const channelPolicy = page.locator(
      'details[aria-labelledby="mi-agent-channel-policy-title"]',
    );
    await channelPolicy.locator("summary").first().click();
    const consultationType = channelPolicy.getByRole("combobox", {
      name: "Tipo de consulta",
    });
    const channelSelector = channelPolicy
      .locator("label")
      .first()
      .locator("select");
    await expect(consultationType).toHaveCount(0);
    await channelSelector.selectOption("customer_account");
    await expect(
      channelPolicy.getByText("Conversación de cliente existente", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      channelPolicy.getByText(
        "Crea un borrador; las continuaciones completan el mismo borrador. No edita una actividad ya registrada.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      channelPolicy.getByText(
        "Propone una oportunidad nueva bajo la cuenta seleccionada; se completa y guarda en Oportunidades.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      channelPolicy.getByRole("checkbox", {
        name: "Crear oportunidad en esta cuenta",
      }),
    ).not.toBeChecked();
    await expect(
      channelPolicy.getByRole("checkbox", {
        name: "Vincular contacto existente a una oportunidad",
      }),
    ).not.toBeChecked();
    await expect(consultationType).toHaveCount(0);
    await channelSelector.selectOption("coach");
    await expect(
      channelPolicy.getByText("Asesoría de desarrollo comercial", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(consultationType).toHaveCount(0);
    const intentOverrides = channelPolicy
      .locator("details")
      .filter({ hasText: "Ajustes avanzados por intención" });
    await expect(intentOverrides.locator("summary")).toBeVisible();
    await expect(intentOverrides.locator("select")).toBeHidden();
    await intentOverrides.locator("summary").click();
    const intentPolicySelector = intentOverrides.getByRole("combobox", {
      name: "Intención con ajuste específico",
    });
    await expect(intentPolicySelector).toBeVisible();
    await expect(intentPolicySelector.locator("option")).toHaveText([
      "Sin ajuste específico · usar configuración general",
      "Coaching del vendedor",
      "Contexto breve",
      "Propuesta de operación",
    ]);
    const briefContextRulesRequest = page.waitForRequest(
      (request) =>
        request
          .url()
          .includes(
            "/api/commercial-intelligence/governance/business-rules?channel=coach&process=brief_context",
          ) && request.method() === "GET",
    );
    await intentPolicySelector.selectOption("brief_context");
    await briefContextRulesRequest;
    const coachOverrideSaveRequest = page.waitForRequest(
      (request) =>
        request
          .url()
          .endsWith("/api/commercial-intelligence/governance/business-rules") &&
        request.method() === "PUT",
    );
    await channelPolicy
      .getByRole("button", { name: "Guardar ajuste de intención" })
      .click();
    expect((await coachOverrideSaveRequest).postDataJSON()).toMatchObject({
      channel: "coach",
      process: "brief_context",
    });
    const prospectRulesRequest = page.waitForRequest(
      (request) =>
        request
          .url()
          .includes(
            "/api/commercial-intelligence/governance/business-rules?channel=prospect&process=default",
          ) && request.method() === "GET",
    );
    await channelSelector.selectOption("prospect");
    await expect(
      channelPolicy
        .getByText("Conversación de cuenta nueva", {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await expect(consultationType).toHaveCount(0);
    await prospectRulesRequest;
    const prospectSaveRequest = page.waitForRequest(
      (request) =>
        request
          .url()
          .endsWith("/api/commercial-intelligence/governance/business-rules") &&
        request.method() === "PUT",
    );
    await channelPolicy
      .getByRole("button", { name: "Guardar políticas del canal" })
      .click();
    expect((await prospectSaveRequest).postDataJSON()).toMatchObject({
      channel: "prospect",
      process: "default",
    });

    const externalSources = page.getByLabel("Fuentes externas habilitadas");
    const wonOpportunities = page.getByLabel("Incluir oportunidades ganadas");
    const lostOpportunities = page.getByLabel("Incluir oportunidades perdidas");
    const cancelledOpportunities = page.getByLabel(
      "Incluir oportunidades anuladas",
    );
    await expect(wonOpportunities).toBeChecked();
    await expect(lostOpportunities).toBeChecked();
    await expect(cancelledOpportunities).not.toBeChecked();
    await externalSources.check();
    await lostOpportunities.uncheck();
    await cancelledOpportunities.check();
    const settingsRequest = page.waitForRequest(
      (request) =>
        request
          .url()
          .endsWith("/api/commercial-intelligence/governance/settings") &&
        request.method() === "PUT",
    );
    await page.getByRole("button", { name: "Guardar configuración" }).click();
    expect((await settingsRequest).postDataJSON()).toMatchObject({
      includeWonOpportunities: true,
      includeLostOpportunities: false,
      includeCancelledOpportunities: true,
    });
    await expect(page.getByRole("status")).toContainText(
      "Configuración de gobierno guardada",
    );
  });

  test("inicia Coach en ámbito general sin selectores de entidad", async ({
    page,
  }) => {
    await mockMiCoachApi(page, {
      withCustomerHealth: true,
      withHistoricalOpportunityContext: true,
    });
    await openMiCoach(page);

    await expect(page.getByLabel("Alcance actual del Coach")).toContainText(
      "Ámbito general del vendedor",
    );
    await expect(page.getByLabel("Cuenta activa")).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "Oportunidad", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "Contacto", exact: true }),
    ).toHaveCount(0);
  });

  test("adopta la entidad autorizada mencionada por Coach sin limpiar la conversación", async ({
    page,
  }) => {
    await mockMiCoachApi(page, {
      withResponseContextSwitch: true,
    });
    await openMiCoach(page);
    await page
      .getByPlaceholder("Escribe tu pregunta para el Coach...")
      .fill("¿Qué otra oportunidad de Cuenta Demo requiere seguimiento?");
    await page.getByRole("button", { name: "Preguntar" }).click();

    await expect(
      page.getByText(
        "La oportunidad Proyecto B de Cuenta Alterna tiene seguimiento activo.",
      ),
    ).toBeVisible({ timeout: 10000 });
    const coachScope = page.getByLabel("Alcance actual del Coach");
    await expect(coachScope).toContainText("Cuenta Alterna");
    await expect(coachScope).toContainText("Proyecto B");
    await expect(
      page.getByText(
        "¿Qué otra oportunidad de Cuenta Demo requiere seguimiento?",
      ),
    ).toBeVisible();
  });

  test("consolida salud, señales y productos solo al analizar Cliente existente", async ({
    page,
  }) => {
    await mockMiCoachApi(page, { withCustomerHealth: true });
    await openMiCoach(page);
    await expect(page.getByLabel("Alcance actual del Coach")).toContainText(
      "Ámbito general del vendedor",
    );
    await page.getByRole("button", { name: "Cliente existente" }).click();
    await expect(page.getByLabel("Cuenta existente")).toHaveValue("");
    const analysisRequests = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/account-internal-analysis/jobs")
      ) {
        analysisRequests.push(request);
      }
    });
    await page.getByLabel("Cuenta existente").selectOption("160");
    await expect(page.getByLabel("Cuenta existente")).toHaveValue("160");
    await expect(
      page.getByRole("heading", { name: "Cuenta Demo" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Chat de cuenta" }),
    ).toBeVisible();
    const analysisSections = [
      "Resumen comercial de cuenta",
      "Salud de la cuenta",
      "Próximo paso sugerido",
      "Historial comercial de la cuenta",
      "Mapa de relaciones de la cuenta",
      "Productos y renovaciones",
      "Hipótesis de expansión",
      "Ver análisis completo",
    ];
    for (const name of analysisSections) {
      await expect(page.getByRole("region", { name, exact: true })).toHaveCount(0);
    }
    await expect(page.getByText("https://cuenta-demo.example")).toHaveCount(0);
    await expect(page.getByText("Revisión de renovación")).toHaveCount(0);
    expect(analysisRequests).toHaveLength(0);
    await page.getByRole("button", { name: "Analizar cuenta", exact: true }).click();
    await expect(page.getByRole("button", { name: "Actualizar análisis" })).toBeEnabled();
    expect(analysisRequests).toHaveLength(1);
    const consolidatedAnalysis = page.getByRole("region", {
      name: "Analizar cuenta",
      exact: true,
    });
    for (const name of analysisSections) {
      await expect(consolidatedAnalysis.getByRole("region", {
        name,
        exact: true,
      })).toHaveCount(1);
    }
    const pipeline = consolidatedAnalysis.getByRole("region", {
      name: "Resumen comercial de cuenta",
    }).locator("article").filter({ hasText: "Pipeline abierto" });
    await expect(pipeline.locator("strong")).toHaveText(
      new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(20000),
    );
    await expect(page.getByText("https://cuenta-demo.example")).toBeVisible();
    await expect(page.getByText("Revisión de renovación")).toBeVisible();

    const healthPanel = page.getByRole("region", {
      name: "Salud de la cuenta",
    });
    await expect(healthPanel).toContainText("Requiere atención");
    await healthPanel.locator(":scope > summary").click();
    await expect(page.getByText("55/100")).toBeVisible();
    await expect(
      healthPanel.getByText("Actividad comercial atrasada"),
    ).toBeVisible();
    const nextStepPanel = page.getByRole("region", {
      name: "Próximo paso sugerido",
    });
    await nextStepPanel.locator(":scope > summary").click();
    await expect(nextStepPanel).toContainText("Evidencia:");
    await expect(
      nextStepPanel.getByRole("button", { name: "Preparar seguimiento" }),
    ).toBeVisible();
    const history = page.getByRole("region", {
      name: "Historial comercial de la cuenta",
    });
    await history.locator(":scope > summary").click();
    await expect(history.getByText("Proyecto abierto")).toBeVisible();
    await expect(history.getByText("Renovación ganada")).toBeVisible();
    await expect(history.getByText("Proyecto perdido")).toBeVisible();
    await expect(history.getByText("Proyecto anulado")).toBeVisible();
    await expect(history.getByText("Proyecto desactivado")).toBeVisible();
    await expect(history.getByText(/desactivada · en_proceso/)).toBeVisible();
    const relationshipMap = page.getByRole("region", {
      name: "Mapa de relaciones de la cuenta",
    });
    await relationshipMap.locator(":scope > summary").click();
    await expect(
      relationshipMap.getByRole("button", {
        name: "Editar en Mapeo de contactos",
      }),
    ).toHaveCount(0);
    await expect(relationshipMap.getByText("Ana Compras")).toBeVisible();
    await expect(relationshipMap.getByText("decide_final")).toBeVisible();
    await expect(
      relationshipMap.getByText(/Falta: relación con otros contactos/),
    ).toBeVisible();
    const productsPanel = page.getByRole("region", {
      name: "Productos y renovaciones",
    });
    await productsPanel.locator(":scope > summary").click();
    await expect(productsPanel.getByText("Cotización 901")).toBeVisible();
    await expect(productsPanel.getByText("Cotización 903")).toBeVisible();
    await expect(productsPanel).toContainText(
      "2 cotizaciones · 2 productos · 1 renovación",
    );
    const firstQuotation = productsPanel.getByLabel("Cotización 901");
    await expect(firstQuotation).toContainText("Ganada");
    await expect(firstQuotation).toHaveClass(/is-won/);
    await expect(productsPanel.getByText("Servicio WAAP")).not.toBeVisible();
    await expect(
      productsPanel.getByText("Firewall Perimetral"),
    ).not.toBeVisible();
    await productsPanel.getByText("Cotización 901").click();
    await expect(
      productsPanel.locator("li").filter({ hasText: "Servicio WAAP" }),
    ).toBeVisible();
    await expect(
      firstQuotation.getByRole("button", {
        name: "Abrir oportunidad asociada",
      }),
    ).toHaveCount(1);
    await expect(
      firstQuotation
        .locator("li")
        .getByRole("button", { name: "Abrir oportunidad asociada" }),
    ).toHaveCount(0);
    await expect(
      productsPanel.getByText("Firewall Perimetral"),
    ).not.toBeVisible();
    await productsPanel.getByText("Cotización 903").click();
    await expect(productsPanel.getByText("Firewall Perimetral")).toBeVisible();
    await expect(
      productsPanel
        .getByLabel("Cotización 903")
        .getByRole("button", { name: "Abrir oportunidad asociada" }),
    ).toHaveCount(1);
    await expect(
      productsPanel.getByText("Compra/entrega: no verificada").first(),
    ).toBeVisible();
    await expect(
      productsPanel.getByText(/no confirma por sí sola compra/),
    ).toBeVisible();
    const hypothesesPanel = page.getByRole("region", {
      name: "Hipótesis de expansión",
    });
    await hypothesesPanel.locator(":scope > summary").click();
    await expect(
      hypothesesPanel.getByText("Explorar solución complementaria: Seguridad"),
    ).toBeVisible();
    await expect(
      hypothesesPanel.getByText("Preparar renovación de Proveedor Demo"),
    ).toBeVisible();
    await expect(page.getByText("Hipótesis · cross_sell")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Actualizar análisis" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Enriquecer con fuentes públicas" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Preparar resumen ejecutivo" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Preparar llamada" }),
    ).toBeVisible();
    const analysisResult = page.getByRole("region", {
      name: "Ver análisis completo",
    });
    const analysisOperation = page.getByRole("region", {
      name: "Analizar cuenta",
    });
    const agentsOperation = page.getByRole("region", {
      name: "Enriquecer con fuentes públicas",
    });
    const executiveOperation = page.getByRole("region", {
      name: "Preparar resumen ejecutivo",
    });
    const callOperation = page.getByRole("region", {
      name: "Preparar llamada",
    });
    const analysisOperationBox = await analysisOperation.boundingBox();
    const analysisIntroBox = await analysisOperation
      .locator(".mi-agent-customer-analysis-intro")
      .boundingBox();
    const analysisResultBox = await analysisResult.boundingBox();
    expect(analysisOperationBox).not.toBeNull();
    expect(analysisIntroBox).not.toBeNull();
    expect(analysisResultBox).not.toBeNull();
    const analysisButtonBox = await analysisOperation
      .getByRole("button", { name: "Actualizar análisis" })
      .boundingBox();
    expect(analysisButtonBox).not.toBeNull();
    expect(analysisIntroBox.x).toBeGreaterThan(
      analysisButtonBox.x + analysisButtonBox.width,
    );
    expect(analysisResultBox.width).toBeGreaterThan(
      analysisOperationBox.width * 0.9,
    );
    await expect(
      analysisOperation.getByRole("button", { name: "Actualizar análisis" }),
    ).toBeVisible();
    await expect(
      analysisOperation.getByRole("region", {
        name: "Ver análisis completo",
      }),
    ).toBeVisible();
    expect(analysisResultBox.y).toBeGreaterThan(
      analysisButtonBox.y + analysisButtonBox.height - 1,
    );
    const agentsResult = page.getByRole("region", {
      name: "Detalle de agentes",
      exact: true,
    });
    const executiveResult = page.getByRole("region", {
      name: "Ver síntesis y acciones",
      exact: true,
    });
    const callResult = page.getByRole("region", {
      name: "Ver preguntas y próximos pasos",
      exact: true,
    });
    for (const result of [
      agentsResult,
      executiveResult,
      callResult,
    ]) {
      await expect(result).toHaveJSProperty("open", false);
    }
    for (const operation of [
      agentsOperation,
      executiveOperation,
      callOperation,
    ]) {
      await expect(operation).toContainText("Sin ejecutar");
    }
    await expect(analysisOperation).toContainText("Listo");
    await expect(analysisOperation).toContainText("Fecha del análisis:");
    await page.getByRole("button", { name: "Actualizar análisis" }).click();
    const analysisSummary = analysisOperation.locator(
      ".mi-agent-customer-analysis-summary",
    );
    await expect(analysisResult).toBeVisible();
    await expect(analysisResult).toHaveJSProperty("open", true);
    await expect(analysisSummary).toBeInViewport();
    await expect(
      analysisOperation.getByText("Listo", { exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByText("Hallazgo interno redundante", { exact: true }),
    ).toHaveCount(0);
    await expect(
      analysisResult.getByText("Información adicional por validar", { exact: true }),
    ).toBeVisible();
    await expect(
      analysisResult.getByRole("button", { name: "Confirmar" }),
    ).toHaveCount(0);
    await expect(
      analysisResult.getByRole("button", { name: "Rechazar" }),
    ).toHaveCount(0);
    for (const name of analysisSections) {
      const panel = analysisOperation.getByRole("region", { name, exact: true });
      const box = await panel.boundingBox();
      expect(box.width).toBeGreaterThan(analysisOperationBox.width * 0.9);
    }
    const desktopViewport = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileAnalysisBox = await analysisOperation.boundingBox();
    for (const name of analysisSections) {
      const box = await analysisOperation.getByRole("region", {
        name,
        exact: true,
      }).boundingBox();
      expect(box.width).toBeGreaterThan(mobileAnalysisBox.width * 0.85);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
    await analysisOperation.screenshot({
      path: test.info().outputPath("account-analysis-mobile.png"),
    });
    await page.setViewportSize(desktopViewport);
    await analysisResult.locator(":scope > summary").click();
    await expect(analysisSummary).toBeVisible();
    await expect(page.getByText("https://cuenta-demo.example")).not.toBeVisible();
    await expect(
      page.getByText("Hallazgo interno redundante", { exact: true }),
    ).not.toBeVisible();
    await analysisResult.locator(":scope > summary").click();
    await page
      .getByRole("button", { name: "Preparar resumen ejecutivo" })
      .click();
    await expect(executiveResult).toBeVisible();
    await expect(executiveResult).toHaveJSProperty("open", true);
    await expect(analysisResult).toHaveJSProperty("open", false);
    await expect(executiveOperation).toContainText("Salud 55/100 · 1 riesgos");
    await expect(
      executiveResult.getByRole("heading", {
        name: "Resumen ejecutivo de Cuenta Demo",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Contactar al cliente esta semana"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Preparar llamada" }).click();
    await expect(callResult).toBeVisible();
    await expect(callResult).toHaveJSProperty("open", true);
    await expect(executiveResult).toHaveJSProperty("open", false);
    await expect(
      callResult.getByRole("heading", { name: "Briefing de llamada" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Enriquecer con fuentes públicas" })
      .click();
    await expect(agentsResult).toBeVisible();
    await expect(agentsResult).toHaveJSProperty("open", true);
    await expect(callResult).toHaveJSProperty("open", false);
    await expect(agentsOperation).toContainText("3 agentes · 1 hallazgo");
    await expect(
      agentsResult.getByRole("heading", { name: "Agentes especializados" }),
    ).toBeVisible();
    await expect(page.getByText("Contexto CRM", { exact: true })).toBeVisible();
    await expect(page.getByText("crm_context", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Contexto CRM disponible.")).toBeVisible();
    await expect(page.getByText("Fuentes CRM y públicas")).toBeVisible();
    await expect(
      page.getByText("Proyecto de modernización anunciado"),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Ver fuente pública" }),
    ).toHaveAttribute("href", "https://public.example/evidence");
    await page.getByRole("button", { name: "Resumen para reunión" }).click();
    await expect(
      page.getByText("La cuenta requiere seguimiento comercial."),
    ).toBeVisible();
    const accountChat = page.getByRole("region", { name: "Chat de cuenta" });
    await expect(
      accountChat.getByText("CRM + investigación pública"),
    ).toBeVisible();
    await accountChat.getByRole("switch").check();
    await expect(accountChat.getByText("Hipótesis por validar")).toBeVisible();
    await expect(
      accountChat.getByRole("link", {
        name: "https://public.example/evidence",
      }),
    ).toHaveAttribute("href", "https://public.example/evidence");
    await expect(
      accountChat.getByRole("button", { name: "Preparar actividad" }),
    ).toBeVisible();
    await openCoachConversation(page);
    await expect(page.getByLabel("Alcance actual del Coach")).toContainText(
      "Ámbito general del vendedor",
    );
  });

  test("análisis de cuenta muestra errores y conserva el resultado anterior al fallar la actualización", async ({ page }) => {
    await mockMiCoachApi(page, { withCustomerHealth: true });
    await openMiCoach(page);
    await page.getByRole("button", { name: "Cliente existente" }).click();
    await page.getByLabel("Cuenta existente").selectOption("160");
    const jobsUrl = "**/api/commercial-intelligence/account-internal-analysis/jobs";
    await page.route(jobsUrl, (route) => route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "Análisis temporalmente no disponible" }),
    }));
    const analysis = page.getByRole("region", { name: "Analizar cuenta", exact: true });
    await analysis.getByRole("button", { name: "Analizar cuenta" }).click();
    await expect(analysis).toContainText("Análisis temporalmente no disponible");
    await expect(analysis.getByRole("region", { name: "Salud de la cuenta" })).toHaveCount(0);
    await expect(analysis.getByRole("button", { name: "Analizar cuenta" })).toBeEnabled();
    await page.unroute(jobsUrl);
    await analysis.getByRole("button", { name: "Analizar cuenta" }).click();
    await expect(analysis.getByRole("button", { name: "Actualizar análisis" })).toBeEnabled();
    await page.route(jobsUrl, (route) => route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "No se pudo actualizar el análisis" }),
    }));
    await analysis.getByRole("button", { name: "Actualizar análisis" }).click();
    await expect(analysis).toContainText("No se pudo actualizar el análisis");
    await expect(analysis).toContainText("Resultado anterior; pendiente de actualización.");
    await expect(analysis.getByRole("region", { name: "Salud de la cuenta" })).toContainText("55/100");
    await expect(analysis.getByRole("button", { name: "Actualizar análisis" })).toBeEnabled();
  });

  test("análisis de cuenta descarta resultados tardíos después de cambiar la selección", async ({ page }) => {
    await mockMiCoachApi(page, { withCustomerHealth: true });
    await openMiCoach(page);
    await page.getByRole("button", { name: "Cliente existente" }).click();
    const snapshotResponse = page.waitForResponse((response) =>
      response.url().includes("/account-intelligence/snapshot"),
    );
    await page.getByLabel("Cuenta existente").selectOption("160");
    const { snapshot } = await (await snapshotResponse).json();
    const nextSnapshot = {
      ...snapshot,
      account: { ...snapshot.account, id: 170, name: "Cuenta Alterna" },
      contacts: [],
      opportunities: [],
      inactiveOpportunities: [],
      interactions: [],
      products: [],
      renewals: [],
      expansionHypotheses: [],
    };
    await page.route("**/api/commercial-intelligence/account-intelligence/snapshot?accountId=170", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ snapshot: nextSnapshot }),
      }),
    );
    let releaseOldAnalysis;
    const oldAnalysisReady = new Promise((resolve) => { releaseOldAnalysis = resolve; });
    let jobCount = 0;
    await page.route("**/api/commercial-intelligence/account-internal-analysis/jobs", (route) =>
      route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ job: { id: ++jobCount, status: "pending" } }),
      }),
    );
    await page.route("**/api/commercial-intelligence/account-internal-analysis/jobs/*", async (route) => {
      const oldJob = route.request().url().endsWith("/1");
      if (oldJob) await oldAnalysisReady;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          job: {
            id: oldJob ? 1 : 2,
            status: "completed",
            result: {
              summary: oldJob ? "Análisis obsoleto" : "Análisis de la selección actual",
              snapshot: oldJob ? snapshot : nextSnapshot,
            },
            findings: [],
          },
        }),
      });
    });
    const firstPoll = page.waitForRequest("**/account-internal-analysis/jobs/1");
    await page.getByRole("button", { name: "Analizar cuenta", exact: true }).click();
    await firstPoll;
    await page.getByLabel("Cuenta existente").selectOption("170");
    await expect(page.getByRole("region", { name: "Salud de la cuenta" })).toHaveCount(0);
    await page.getByRole("button", { name: "Analizar cuenta", exact: true }).click();
    const analysis = page.getByRole("region", { name: "Analizar cuenta", exact: true });
    await expect(analysis).toContainText("Análisis de la selección actual");
    await expect(page.getByRole("heading", { name: "Cuenta Alterna", exact: true })).toBeVisible();
    const oldResponse = page.waitForResponse("**/account-internal-analysis/jobs/1");
    releaseOldAnalysis();
    await oldResponse;
    await expect(analysis).not.toContainText("Análisis obsoleto");
    await expect(analysis).toContainText("Análisis de la selección actual");
    await expect(analysis.getByRole("button", { name: "Actualizar análisis" })).toBeEnabled();
  });

  test("análisis de cuenta respeta permisos y representa cuentas sin datos", async ({ page }) => {
    await mockMiCoachApi(page, { withCustomerHealth: true });
    await openMiCoach(page);
    await page.getByRole("button", { name: "Cliente existente" }).click();
    const snapshotResponse = page.waitForResponse((response) =>
      response.url().includes("/account-intelligence/snapshot"),
    );
    await page.getByLabel("Cuenta existente").selectOption("160");
    const { snapshot } = await (await snapshotResponse).json();
    const emptySnapshot = {
      ...snapshot,
      opportunities: [],
      inactiveOpportunities: [],
      contacts: [],
      interactions: [],
      products: [],
      renewals: [],
      expansionHypotheses: [],
      permissions: { ...snapshot.permissions, canReadContacts: false },
      accountHealth: {
        status: "insufficient_data",
        score: 0,
        signals: [],
        metrics: {
          contactCount: 0,
          opportunityCount: 0,
          riskyOpportunityCount: 0,
          daysSinceLastInteraction: null,
        },
      },
    };
    await page.route("**/api/commercial-intelligence/account-internal-analysis/jobs/703", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          job: {
            id: 703,
            status: "completed",
            result: { summary: "Sin datos suficientes", snapshot: emptySnapshot },
            findings: [],
          },
        }),
      }),
    );
    await page.getByRole("button", { name: "Analizar cuenta", exact: true }).click();
    const analysis = page.getByRole("region", { name: "Analizar cuenta", exact: true });
    await expect(analysis).toContainText("Sin datos suficientes");
    await expect(analysis.getByRole("region", { name: "Salud de la cuenta" })).toContainText("Información insuficiente");
    await expect(analysis.getByRole("region", { name: "Mapa de relaciones de la cuenta" })).toHaveCount(0);
    await expect(analysis.getByRole("region", { name: "Productos y renovaciones" })).toHaveCount(0);
    await expect(analysis.getByRole("region", { name: "Hipótesis de expansión" })).toHaveCount(0);
    const history = analysis.getByRole("region", { name: "Historial comercial de la cuenta" });
    await history.locator(":scope > summary").click();
    await expect(history.getByText("Sin registros accesibles")).toHaveCount(5);
    await expect(analysis).toContainText("No hay hallazgos adicionales.");
  });

  test("abre el contacto seleccionado en Mapeo de contactos para editarlo", async ({
    page,
  }) => {
    await mockMiCoachApi(page, {
      withCustomerHealth: true,
      withCustomerContactUpdate: true,
    });
    await openMiCoach(page);
    await page.getByRole("button", { name: "Cliente existente" }).click();
    await page.getByLabel("Cuenta existente").selectOption("160");
    await page.getByRole("button", { name: "Analizar cuenta", exact: true }).click();
    const relationshipMap = page.getByRole("region", {
      name: "Mapa de relaciones de la cuenta",
    });
    await relationshipMap.locator(":scope > summary").click();
    const contactResponsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/contacts/601"),
    );
    await relationshipMap
      .getByRole("button", { name: "Editar en Mapeo de contactos" })
      .click();
    const contactResponse = await contactResponsePromise;

    await expect(page).toHaveURL(
      /\/contact-mapping\?accountId=160&contactId=601$/,
    );
    expect(contactResponse.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Editar contacto" }),
    ).toBeVisible();
    await expect(page.getByTitle("ID del contacto")).toHaveText("#601");
    await expect(page.getByLabel("Cuenta", { exact: true })).toHaveValue("160");
  });

  test("restaura diagnóstico estructurado y operaciones accionables", async ({
    page,
  }) => {
    await mockMiCoachApi(page, { withCoachInterface: true });
    await openMiCoach(page);

    await expect(
      page.getByLabel("Actividad del Coach durante los últimos 30 días"),
    ).toHaveCount(0);
    await expect(
      page
        .locator(".mi-agent-coach-conversation-heading")
        .getByText("Conversación", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("¿Qué falta para avanzar?")).toBeVisible();

    const diagnosis = page.getByRole("region", {
      name: "Preparación de etapa",
    });
    await expect(diagnosis.getByText("Desarrollo")).toBeVisible();
    await expect(diagnosis.getByText("Débil")).toBeVisible();
    await expect(diagnosis.getByText("1/2")).toBeVisible();
    await expect(diagnosis.getByText("Fecha de decisión")).toHaveCount(2);
    await expect(diagnosis.getByText("Respuesta de etapa")).toBeVisible();
    await expect(
      page.getByText("La oportunidad aún no está lista para avanzar."),
    ).toBeVisible();

    const semantic = page.getByLabel("Fundamento del Coach");
    const foundationSwitch = page.getByRole("switch", {
      name: "Mostrar fundamento",
    });
    await expect(foundationSwitch).not.toBeChecked();
    await expect(semantic).toHaveCount(0);

    await foundationSwitch.click();
    await expect(foundationSwitch).toBeChecked();
    await expect(
      semantic.getByRole("heading", { name: "Hechos" }),
    ).toBeVisible();
    await expect(
      semantic.getByRole("heading", { name: "Evidencia" }),
    ).toBeVisible();
    await expect(
      semantic.getByRole("heading", { name: "Inferencias" }),
    ).toBeVisible();
    await expect(
      semantic.getByRole("heading", { name: "Recomendación" }),
    ).toBeVisible();

    await page.reload();
    await openCoachConversation(page);
    await expect(foundationSwitch).toBeChecked();
    await expect(semantic).toBeVisible();
    await foundationSwitch.click();
    await expect(foundationSwitch).not.toBeChecked();
    await expect(semantic).toHaveCount(0);
    await expect(diagnosis).toBeVisible();

    const pending = page.getByRole("region", {
      name: "Acciones pendientes del Coach",
    });
    await expect(pending.getByText("Información incompleta")).toBeVisible();
    await expect(pending.getByText("Lista para revisar")).toBeVisible();
    await expect(pending.getByText("Pendiente en módulo")).toBeVisible();
    await expect(
      pending.getByText("Crear cuenta", { exact: true }),
    ).toBeVisible();
    await expect(pending.getByText("unknown")).toHaveCount(0);
    await expect(
      pending.getByRole("button", { name: "Completar datos" }),
    ).toHaveCount(1);
    await expect(
      pending.getByRole("button", { name: "Abrir en Cuentas" }),
    ).toHaveCount(1);
    await expect(pending.getByRole("button", { name: "Revisar" })).toHaveCount(
      1,
    );
    await expect(
      pending.getByRole("button", { name: "Descartar" }),
    ).toHaveCount(3);
    const threadBox = await page
      .locator(".mi-agent-coach-thread")
      .boundingBox();
    const pendingBox = await pending.boundingBox();
    expect(threadBox).not.toBeNull();
    expect(pendingBox).not.toBeNull();
    expect(pendingBox.y).toBeGreaterThan(threadBox.y + threadBox.height);

    await page.getByText("Actividad reciente").click();
    await expect(page.getByText("Actualizar importe")).toBeVisible();
    await expect(page.getByText("Completada", { exact: true })).toBeVisible();

    await pending.getByRole("button", { name: "Completar datos" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Confirmar cambio del Coach",
    });
    await expect(
      dialog.getByRole("heading", { name: "Completar operación" }),
    ).toBeVisible();
    await expect(
      dialog
        .getByRole("combobox", { name: "Tipo", exact: true })
        .locator("option"),
    ).toHaveText([
      "Llamada",
      "Reunión presencial",
      "Reunión virtual",
      "Presentación",
      "Demostración",
      "Visita",
      "Correo",
      "Propuesta",
      "Evento",
      "Otro",
    ]);
    await expect(
      dialog.getByText("Fecha y hora", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Continuar en el módulo" }),
    ).toBeDisabled();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
});
