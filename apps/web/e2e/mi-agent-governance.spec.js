import { expect, test } from "@playwright/test";

async function mockMiCoachApi(
  page,
  {
    canAdmin = false,
    withCustomerHealth = false,
    withCoachInterface = false,
    withHistoricalOpportunityContext = false,
    withResponseContextSwitch = false,
  } = {},
) {
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
        roles: [{ name: canAdmin ? "Administrador" : "Vendedor" }],
        permissions: [
          "mi_coach.use",
          "mi_coach.execute",
          "cuentas.read",
          "oportunidades.read",
          "desarrollo_comercial.update",
          "fuentes_externas.execute",
          ...(canAdmin ? ["mi_coach.admin"] : []),
        ],
      });
    }
    if (pathname === "/api/mi-agent/context") {
      return json({
        period: { label: "Q3 2026", baseCurrencyCode: "USD" },
        quota: {
          assignedAmount: 100000,
          actualAmount: 25000,
          gapAmount: 75000,
          committedOpenAmount: 50000,
          weightedOpenAmount: 50000,
          currencyCode: "USD",
        },
        workboard: [],
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
      withCoachInterface &&
      [
        "/api/mi-agent/coach/sessions/active",
        "/api/mi-agent/coach/sessions/70",
      ].includes(pathname)
    ) {
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
        operations: [
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
        ],
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
            ? [{ id: 160, name: "Cuenta Demo" }]
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
    if (pathname === "/api/contacts") return json([]);
    if (
      pathname === "/api/commercial-intelligence/account-intelligence/snapshot"
    ) {
      return json({
        snapshot: {
          snapshotVersion: "account-intelligence.v1",
          capturedAt: "2026-09-23T12:00:00.000Z",
          account: { id: 160, name: "Cuenta Demo" },
          contacts: [],
          opportunities: [],
          interactions: [],
          activities: [],
          renewals: [],
          products: [
            {
              description: "Servicio WAAP",
              commercialStatus: "won",
              fulfillmentStatus: "not_verified",
            },
          ],
          expansionHypotheses: [
            {
              type: "cross_sell",
              title: "Explorar solución complementaria: Seguridad",
              summary: "Hipótesis",
              evidence: "Producto actual: Servicio WAAP.",
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
            ],
            metrics: {
              contactCount: 0,
              opportunityCount: 0,
              riskyOpportunityCount: 0,
              interactionCount: 0,
              daysSinceLastInteraction: 30,
              renewalCount: 0,
              productCount: 1,
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
          findings: [],
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
            agents: [
              {
                agentId: "crm_context",
                status: "completed",
                summary: "Contexto CRM disponible.",
                findings: [],
                confidence: "high",
              },
              {
                agentId: "commercial_health",
                status: "completed",
                summary: "Salud estable.",
                findings: [],
                confidence: "medium",
              },
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
            answer: "La cuenta requiere seguimiento comercial.",
            evidence: ["Snapshot autorizado"],
            confidence: "medium",
            recommendedActions: [],
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

async function openMiCoach(page) {
  await page.addInitScript(
    (token) => window.localStorage.setItem("crm_token", token),
    "jwt-token",
  );
  await page.goto("/mi-agent");
  await expect(page.getByRole("heading", { name: "Mi Coach" })).toBeVisible();
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
        await page.getByText("Actividad reciente").click();
        await expect(page.getByText(journey.title)).toBeVisible();
        await expect(
          page.getByText("Completada", { exact: true }),
        ).toBeVisible();

        await page.reload();
        await page.getByText("Actividad reciente").click();
        await expect(page.getByText(journey.title)).toBeVisible();
      });
    }
  });

  test("muestra los espacios principales y conserva Coach", async ({
    page,
  }) => {
    await mockMiCoachApi(page);
    await openMiCoach(page);

    await expect(page.getByRole("button", { name: "Coach" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cliente existente" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cuenta nueva" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Administración" }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Cuenta nueva" }).click();
    await expect(
      page.getByRole("heading", { name: "Prospección asistida" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Preparar cuenta" }),
    ).toBeVisible();
  });

  test("permite abrir y guardar gobierno con permiso administrativo", async ({
    page,
  }) => {
    await mockMiCoachApi(page, { canAdmin: true });
    await openMiCoach(page);

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

  test("agrupa oportunidades abiertas y terminales habilitadas por cuenta", async ({
    page,
  }) => {
    await mockMiCoachApi(page, {
      withCustomerHealth: true,
      withHistoricalOpportunityContext: true,
    });
    await openMiCoach(page);

    await page.getByLabel("Cuenta activa").selectOption("160");

    await expect(
      page.getByRole("option", {
        name: /Abierta · Proyecto abierto/,
      }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("option", {
        name: /Ganada · Renovación ganada/,
      }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("option", {
        name: /Perdida · Proyecto perdido/,
      }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("option", {
        name: /Anulada · Proyecto anulado/,
      }),
    ).toHaveCount(1);
    const opportunitySelect = page.getByRole("combobox", {
      name: "Oportunidad",
      exact: true,
    });
    await opportunitySelect.selectOption("301");
    await expect(opportunitySelect).toHaveValue("301");
  });

  test("adopta la entidad autorizada mencionada por Coach sin limpiar la conversación", async ({
    page,
  }) => {
    await mockMiCoachApi(page, {
      withResponseContextSwitch: true,
    });
    await openMiCoach(page);
    await page.getByLabel("Cuenta activa").selectOption("160");
    await page
      .getByRole("combobox", { name: "Oportunidad", exact: true })
      .selectOption("300");
    await page
      .getByPlaceholder("Escribe tu pregunta para el Coach...")
      .fill("¿Qué otra oportunidad requiere seguimiento?");
    await page.getByRole("button", { name: "Preguntar" }).click();

    await expect(
      page.getByText(
        "La oportunidad Proyecto B de Cuenta Alterna tiene seguimiento activo.",
      ),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel("Cuenta activa")).toHaveValue("170");
    await expect(
      page.getByRole("combobox", { name: "Oportunidad", exact: true }),
    ).toHaveValue("320");
    await expect(
      page.getByText("¿Qué otra oportunidad requiere seguimiento?"),
    ).toBeVisible();
  });

  test("muestra salud, señales y productos en Cliente existente", async ({
    page,
  }) => {
    await mockMiCoachApi(page, { withCustomerHealth: true });
    await openMiCoach(page);

    await page
      .locator("label")
      .filter({ hasText: "Cuenta activa" })
      .locator("select")
      .selectOption("160");
    await page.getByRole("button", { name: "Cliente existente" }).click();

    await expect(
      page.getByRole("heading", { name: "Requiere atención" }),
    ).toBeVisible();
    await expect(page.getByText("55/100")).toBeVisible();
    await expect(page.getByText("Actividad comercial atrasada")).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Productos y renovaciones" })
        .locator("li")
        .filter({ hasText: "Servicio WAAP" }),
    ).toBeVisible();
    await expect(
      page.getByText("Explorar solución complementaria: Seguridad"),
    ).toBeVisible();
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
    await page.getByRole("button", { name: "Analizar cuenta" }).click();
    await expect(page.getByText("Análisis interno listo.")).toBeVisible();
    await page
      .getByRole("button", { name: "Preparar resumen ejecutivo" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Resumen ejecutivo de Cuenta Demo" }),
    ).toBeVisible();
    await expect(
      page.getByText("Contactar al cliente esta semana"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Preparar llamada" }).click();
    await expect(
      page.getByRole("heading", { name: "Briefing de llamada" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Enriquecer con fuentes públicas" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Agentes especializados" }),
    ).toBeVisible();
    await expect(page.getByText("Contexto CRM disponible.")).toBeVisible();
    await page.getByRole("button", { name: "Resumen para reunión" }).click();
    await expect(
      page.getByText("La cuenta requiere seguimiento comercial."),
    ).toBeVisible();
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
