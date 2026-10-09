import { expect, test } from "@playwright/test";

async function mockMiCoachApi(
  page,
  {
    canAdmin = false,
    withCustomerHealth = false,
    withCustomerContactUpdate = false,
    withLeadRead = false,
    withCoachInterface = false,
    withCoachPendingOperations = true,
    withHistoricalOpportunityContext = false,
    withResponseContextSwitch = false,
    withSituationAnalysis = false,
    withProspect = false,
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
      externalResearch: { enabled: false, warnings: [] },
    },
    findings: [
      {
        id: 801,
        status: "suggested",
        category: "company_profile",
        title: "Señal pública",
        summary: "Hallazgo para confirmar con el vendedor.",
        evidenceText: "Evidencia publicada.",
        confidence: "high",
        certainty: "evidenced",
        sourceType: "public_source",
        sourceReference: "https://example.com/evidence",
      },
    ],
    contacts: [
      {
        id: 901,
        area: "Tecnología",
        roleTitle: "Dirección de TI",
        confidence: "medium",
        status: "suggested",
        sourceReference: "",
      },
    ],
    hypotheses: [
      {
        id: 902,
        technologyArea: "Infraestructura",
        title: "Modernizar la plataforma",
        businessChallenge: "Hipótesis por validar con el vendedor.",
        validationQuestion: "¿Qué limitación desean resolver?",
        confidence: "medium",
        status: "suggested",
      },
    ],
    duplicateReview: {
      completed: true,
      countryResolved: true,
      candidates: [
        {
          id: 777,
          name: "Prospecto E2E existente",
          website: "https://prospecto-e2e.example.com",
          domain: "prospecto-e2e.example.com",
          country: "Mexico",
          matchType: "domain",
        },
      ],
    },
  };
  let prospectChatQuestion = "";
  let prospectChatHistoryPersisted = false;
  const closedCoachSessions = new Set();
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
      return json(
        { job: { id: 921, status: "pending", pollAfterMs: 500 } },
        202,
      );
    }
    if (
      withCustomerHealth &&
      pathname === "/api/commercial-intelligence/account-chat/jobs/921" &&
      method === "GET"
    ) {
      return json({
        job: {
          id: 921,
          status: "completed",
          result: {
            source: "account_intelligence",
            sourceDomain: "mixed",
            answer: "La cuenta requiere seguimiento comercial.",
            evidence: ["Snapshot autorizado"],
            inferences: ["Validar continuidad operativa con el cliente."],
            confidence: "high",
            publicSources: ["https://public.example/evidence"],
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
      withProspect &&
      pathname === "/api/prospect-research/sessions" &&
      method === "POST"
    )
      return json({ session: { id: prospectSession.id } }, 201);
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
            title: "Revisar conversión del prospecto",
            requiresConfirmation: true,
          },
        ],
        recommendedActions: [
          { title: "Validar hipótesis", requiresConfirmation: true },
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
              title: "Revisar conversión del prospecto",
              requiresConfirmation: true,
            },
          ],
          recommendedActions: [
            { title: "Validar hipótesis", requiresConfirmation: true },
          ],
        },
      });
    if (
      withProspect &&
      pathname ===
        `/api/prospect-research/sessions/${prospectSession.id}/run-external`
    ) {
      return json({
        session: {
          ...prospectSession,
          result: {
            ...prospectSession.result,
            externalResearch: { enabled: true, findingCount: 1, warnings: [] },
          },
        },
      });
    }
    if (
      withProspect &&
      pathname ===
        `/api/prospect-research/sessions/${prospectSession.id}/convert-to-account`
    )
      return json({ accountId: 777, reused: true }, 200);
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
          "mi_coach.use",
          "mi_coach.execute",
          "cuentas.read",
          "oportunidades.read",
          "desarrollo_comercial.update",
          "fuentes_externas.execute",
          ...(withProspect
            ? [
                "prospeccion.read",
                "prospeccion.create",
                "prospeccion.update",
                "cuentas.create",
                "contactos.create",
                "oportunidades.create",
              ]
            : []),
          ...(withCustomerHealth
            ? ["inteligencia_comercial.read", "contactos.read"]
            : []),
          ...(withCustomerContactUpdate ? ["contactos.update"] : []),
          ...(withLeadRead ? ["interacciones.read"] : []),
          ...(canAdmin ? ["mi_coach.admin"] : []),
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
    if (pathname === "/api/mi-agent/coach/metrics")
      return json(
        withCoachInterface
          ? {
              requests: 8,
              proposed: 5,
              decided: 4,
              approved: 3,
              rejected: 1,
              completed: 2,
            }
          : {
              requests: 0,
              proposed: 0,
              decided: 0,
              approved: 0,
              rejected: 0,
              completed: 0,
            },
      );
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
                targetModule: "commercial_development",
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
    if (pathname.startsWith("/api/catalogs/contact-")) return json([]);
    if (
      pathname === "/api/commercial-intelligence/account-intelligence/snapshot"
    ) {
      return json({
        snapshot: {
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
        },
      });
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
            writesPerformed: false,
          },
          findings: withCustomerHealth
            ? [
                {
                  id: 704,
                  title: "Hallazgo interno redundante",
                  summary: "Este detalle no debe mostrarse como tarjeta.",
                  category: "need",
                  status: "suggested",
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

async function openMiCoach(page, { workspace = "coach" } = {}) {
  await page.addInitScript(
    (token) => window.localStorage.setItem("crm_token", token),
    "jwt-token",
  );
  await page.goto("/mi-agent");
  await expect(page.getByRole("heading", { name: "Mi Coach" })).toBeVisible();
  if (workspace === "coach")
    await page.getByRole("button", { name: "Coach", exact: true }).click();
  if (workspace === "prospect")
    await page.getByRole("button", { name: "Cuenta nueva" }).click();
  if (workspace === "customer")
    await page.getByRole("button", { name: "Cliente existente" }).click();
}

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
  [
    "activity",
    "commercial_development",
    "/commercial-development",
    "activity",
    "Desarrollo comercial",
  ],
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
    if (pathname === "/api/mi-agent/coach/metrics") return json({});
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
        await page.getByRole("button", { name: "Coach", exact: true }).click();
        await page.getByText("Actividad reciente").click();
        await expect(page.getByText(journey.title)).toBeVisible();
        await expect(
          page.getByText("Completada", { exact: true }),
        ).toBeVisible();

        await page.reload();
        await page.getByRole("button", { name: "Coach", exact: true }).click();
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
      withProspect: true,
    });
    await openMiCoach(page, { workspace: "summary" });

    await expect(
      page.getByRole("heading", { name: "Resumen comercial" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Resumen" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByText("Pipeline abierto")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Coach", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cliente existente" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cuenta nueva" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Administración" }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Coach", exact: true }).click();
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
      page.getByRole("button", { name: "Preparar cuenta" }),
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

  test("Cuenta nueva completa prospección con revisión humana y sin investigación pública automática", async ({
    page,
  }) => {
    const publicResearchRequests = [];
    const prospectChatJobRequests = [];
    page.on("request", (request) => {
      if (
        request
          .url()
          .includes("/api/prospect-research/sessions/991/run-external")
      )
        publicResearchRequests.push(request.method());
      if (
        request
          .url()
          .includes("/api/prospect-research/sessions/991/chat/jobs")
      ) {
        prospectChatJobRequests.push({
          method: request.method(),
          url: request.url(),
        });
      }
    });
    await mockMiCoachApi(page, { withProspect: true });
    await openMiCoach(page, { workspace: "prospect" });

    await page.getByPlaceholder("Nombre de la empresa").fill("Prospecto E2E");
    await page.getByPlaceholder("México, Perú, Colombia...").fill("Mexico");
    await page.getByRole("button", { name: "Preparar cuenta" }).click();
    await expect(
      page.getByText("Revisión de posibles cuentas duplicadas"),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Abrir fuente" }),
    ).toBeVisible();
    await expect(
      page.getByText("Sugerido · no confirmado en el CRM"),
    ).toBeVisible();
    expect(publicResearchRequests).toEqual([]);

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
      .getByRole("button", { name: "Investigar fuentes públicas" })
      .click();
    await expect.poll(() => publicResearchRequests.length).toBe(1);

    await page.getByRole("button", { name: "Vincular esta cuenta" }).click();
    await expect(
      page.getByRole("button", { name: "Cuenta creada/vinculada" }),
    ).toBeVisible();
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

  test("los chats de cuenta nueva y cliente existente muestran fundamentos y confirmacion", async ({
    page,
  }) => {
    await mockMiCoachApi(page, {
      withCustomerHealth: true,
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
    const transportTrace = customerChat.getByRole("region", {
      name: "Intercambios HTTP observados",
    });
    await expect(
      transportTrace.getByText(
        "B1 → B2 · POST /api/commercial-intelligence/account-chat/sessions",
      ),
    ).toBeVisible();
    await expect(transportTrace.getByText("B2 → B1 · HTTP 201")).toBeVisible();
    await expect(
      transportTrace.getByText(
        "B1 → B2 · POST /api/commercial-intelligence/account-chat/jobs",
      ),
    ).toBeVisible();
    await expect(transportTrace.getByText("B2 → B1 · HTTP 202")).toBeVisible();
    await expect(
      transportTrace.getByText(
        "B1 → B2 · GET /api/commercial-intelligence/account-chat/jobs/921",
      ),
    ).toBeVisible();
    await expect(transportTrace.getByText("B2 → B1 · HTTP 200")).toBeVisible();
    await expect(
      transportTrace.getByText(/estado final completed/),
    ).toBeVisible();
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
    const reusedSessionTrace = customerChat
      .getByRole("region", { name: "Intercambios HTTP observados" })
      .nth(1);
    await expect(
      reusedSessionTrace.getByText("B1 · Reutilizar sesión existente"),
    ).toBeVisible();
    await expect(
      reusedSessionTrace.getByText(
        "Sesión 920 reutilizada; no se hizo una llamada HTTP para crearla.",
      ),
    ).toBeVisible();

    await page.getByRole("button", { name: "Cuenta nueva" }).click();
    await page.getByPlaceholder("Nombre de la empresa").fill("Prospecto E2E");
    await page.getByPlaceholder("México, Perú, Colombia...").fill("Mexico");
    await page.getByRole("button", { name: "Preparar cuenta" }).click();
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
    ).toBeVisible();
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
    await page.getByRole("button", { name: "Preparar cuenta" }).click();
    await expect(
      page.getByRole("heading", { name: "Prospecto E2E" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Cliente existente" }).click();
    await page.getByLabel("Cuenta existente").selectOption("160");
    await expect(
      page.getByRole("heading", { name: "Cuenta Demo" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Coach", exact: true }).click();
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

    await page.getByRole("button", { name: "Coach", exact: true }).click();
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
    await page.getByRole("button", { name: "Coach", exact: true }).click();
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
    await page.getByRole("button", { name: "Coach", exact: true }).click();
    await expect(
      page.getByText("La oportunidad aún no está lista para avanzar."),
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

    await page.getByRole("button", { name: "Coach", exact: true }).click();
    await expect(
      page.getByPlaceholder("Escribe tu pregunta para el Coach..."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Analizar mi situación" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Resumen" }).click();
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
      page.getByRole("button", { name: "Guardar configuración" }),
    ).toBeVisible();

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

  test("muestra salud, señales y productos en Cliente existente", async ({
    page,
  }) => {
    await mockMiCoachApi(page, { withCustomerHealth: true });
    await openMiCoach(page);
    await expect(page.getByLabel("Alcance actual del Coach")).toContainText(
      "Ámbito general del vendedor",
    );
    await page.getByRole("button", { name: "Cliente existente" }).click();
    await expect(page.getByLabel("Cuenta existente")).toHaveValue("");
    await page.getByLabel("Cuenta existente").selectOption("160");
    await expect(page.getByLabel("Cuenta existente")).toHaveValue("160");
    await expect(
      page.getByRole("heading", { name: "Cuenta Demo" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Chat de cuenta" }),
    ).toBeVisible();
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
    await expect(productsPanel).toContainText("2 cotizaciones · 2 productos · 1 renovación");
    const firstQuotation = productsPanel.getByLabel("Cotización 901");
    await expect(firstQuotation).toContainText("Ganada");
    await expect(firstQuotation).toHaveClass(/is-won/);
    await expect(productsPanel.getByText("Servicio WAAP")).not.toBeVisible();
    await expect(productsPanel.getByText("Firewall Perimetral")).not.toBeVisible();
    await productsPanel.getByText("Cotización 901").click();
    await expect(
      productsPanel
        .locator("li")
        .filter({ hasText: "Servicio WAAP" }),
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
    await expect(productsPanel.getByText("Firewall Perimetral")).not.toBeVisible();
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
      page.getByRole("button", { name: "Analizar cuenta" }),
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
      name: "Hallazgos y métricas",
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
      .getByRole("button", { name: "Analizar cuenta" })
      .boundingBox();
    expect(analysisButtonBox).not.toBeNull();
    expect(analysisIntroBox.x).toBeGreaterThan(
      analysisButtonBox.x + analysisButtonBox.width,
    );
    expect(analysisResultBox.width).toBeGreaterThan(
      analysisOperationBox.width * 0.9,
    );
    await expect(
      analysisOperation.getByRole("button", { name: "Analizar cuenta" }),
    ).toBeVisible();
    await expect(analysisOperation.getByRole("region", {
      name: "Hallazgos y métricas",
    })).toBeVisible();
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
      analysisResult,
      agentsResult,
      executiveResult,
      callResult,
    ]) {
      await expect(result).toHaveJSProperty("open", false);
    }
    for (const operation of [
      analysisOperation,
      agentsOperation,
      executiveOperation,
      callOperation,
    ]) {
      await expect(operation).toContainText("Sin ejecutar");
    }
    await page.getByRole("button", { name: "Analizar cuenta" }).click();
    const analysisSummary = analysisOperation.locator(
      ".mi-agent-customer-analysis-summary",
    );
    await expect(analysisResult).toBeVisible();
    await expect(analysisResult).toHaveJSProperty("open", true);
    await expect(analysisSummary).toBeInViewport();
    await expect(analysisOperation.getByText("Listo", { exact: true })).toHaveCount(1);
    await expect(
      page.getByText("Hallazgo interno redundante", { exact: true }),
    ).toBeVisible();
    await expect(
      analysisResult.getByRole("button", { name: "Confirmar" }),
    ).toHaveCount(0);
    await expect(
      analysisResult.getByRole("button", { name: "Rechazar" }),
    ).toHaveCount(0);
    await analysisResult.locator(":scope > summary").click();
    await expect(analysisSummary).toBeVisible();
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
    await expect(
      page.getByText("Fuentes CRM y públicas"),
    ).toBeVisible();
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
    await page.getByRole("button", { name: "Coach", exact: true }).click();
    await expect(page.getByLabel("Alcance actual del Coach")).toContainText(
      "Ámbito general del vendedor",
    );
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

    const coachMetrics = page.getByLabel(
      "Actividad del Coach durante los últimos 30 días",
    );
    await expect(coachMetrics.getByText("Consultas")).toBeVisible();
    await expect(coachMetrics.getByText("8", { exact: true })).toBeVisible();
    await expect(coachMetrics.getByText("Propuestas")).toBeVisible();
    await expect(coachMetrics.getByText("5", { exact: true })).toBeVisible();
    await expect(page.getByText("Conversación", { exact: true })).toBeVisible();
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
    await page.getByRole("button", { name: "Coach", exact: true }).click();
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
