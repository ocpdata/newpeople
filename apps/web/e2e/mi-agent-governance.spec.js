import { expect, test } from "@playwright/test";

async function mockMiCoachApi(page, { canAdmin = false, withCustomerHealth = false } = {}) {
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

    if (pathname === "/api/auth/bootstrap-status") return json({ hasUsers: true });
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
        quota: { assignedAmount: 100000, actualAmount: 25000, gapAmount: 75000, committedOpenAmount: 50000, weightedOpenAmount: 50000, currencyCode: "USD" },
        workboard: [],
        leads: [],
        contactMappings: [],
        summary: { openOpportunities: 0, riskyOpportunities: 0 },
      });
    }
    if (pathname === "/api/mi-agent/coach/metrics") return json({ requests: 0, operationsDecided: 0, operationsCreated: 0, operationsRejected: 0, operationsCompleted: 0 });
    if (pathname.startsWith("/api/accounts")) return json(withCustomerHealth ? [{ id: 160, name: "Cuenta Demo" }] : []);
    if (pathname === "/api/opportunities") return json([]);
    if (pathname === "/api/contacts") return json([]);
    if (pathname === "/api/commercial-intelligence/account-intelligence/snapshot") {
      return json({ snapshot: {
        snapshotVersion: "account-intelligence.v1",
        capturedAt: "2026-09-23T12:00:00.000Z",
        account: { id: 160, name: "Cuenta Demo" },
        contacts: [],
        opportunities: [],
        interactions: [],
        activities: [],
        renewals: [],
        products: [{ description: "Servicio WAAP", commercialStatus: "won", fulfillmentStatus: "not_verified" }],
        expansionHypotheses: [{ type: "cross_sell", title: "Explorar solución complementaria: Seguridad", summary: "Hipótesis", evidence: "Producto actual: Servicio WAAP.", opportunityId: 22, requiresConfirmation: true }],
        supportCases: [],
        dataAvailability: { products: true, supportCases: false },
        accountHealth: {
          status: "at_risk",
          score: 55,
          signals: [{ code: "stale_account_activity", severity: "high", title: "Actividad comercial atrasada", summary: "La cuenta no tiene una interacción reciente accesible.", evidence: "Última interacción hace 30 días." }],
          metrics: { contactCount: 0, opportunityCount: 0, riskyOpportunityCount: 0, interactionCount: 0, daysSinceLastInteraction: 30, renewalCount: 0, productCount: 1 },
        },
      } });
    }
    if (pathname === "/api/commercial-intelligence/account-internal-analysis/jobs" && method === "POST") return json({ job: { id: 703, status: "pending" } }, 202);
    if (pathname === "/api/commercial-intelligence/account-internal-analysis/jobs/703") {
      return json({ job: { id: 703, status: "completed", result: { sourceDomain: "crm_internal", summary: "Análisis interno listo.", writesPerformed: false }, findings: [] } });
    }
    if (pathname === "/api/commercial-intelligence/executive-briefing/jobs" && method === "POST") return json({ job: { id: 700, status: "pending" } }, 202);
    if (pathname === "/api/commercial-intelligence/executive-briefing/jobs/700") {
      return json({ job: { id: 700, status: "completed", result: { headline: "Resumen ejecutivo de Cuenta Demo", summary: "Cuenta con señales de atención.", executiveBriefing: { healthScore: 55, recentChanges: [], prioritizedRisks: [{ title: "Actividad comercial atrasada", summary: "Sin interacción reciente.", evidence: "30 días" }], meetingQuestions: ["¿Qué cambió?"], nextBestStep: "Contactar al cliente esta semana", recommendedActions: [{ title: "Agendar seguimiento", actionType: "call", opportunityId: "22", successCriteria: "Confirmar siguiente hito." }] } } } });
    }
    if (pathname === "/api/commercial-intelligence/commercial-discovery/jobs" && method === "POST") return json({ job: { id: 704, status: "pending" } }, 202);
    if (pathname === "/api/commercial-intelligence/commercial-discovery/jobs/704") {
      return json({ job: { id: 704, status: "completed", result: { headline: "Briefing de llamada", summary: "Preparación comercial lista.", briefing: { objective: "Validar el siguiente hito.", targetContact: "Responsable de tecnología", questions: ["¿Qué cambió?"], risks: ["Actividad atrasada"], callGuide: ["Confirmar prioridades"], nextSteps: [] } } } });
    }
    if (pathname === "/api/commercial-intelligence/agents/jobs" && method === "POST") return json({ job: { id: 701, status: "pending" } }, 202);
    if (pathname === "/api/commercial-intelligence/agents/jobs/701") return json({ job: { id: 701, status: "completed", result: { writesPerformed: false, agents: [{ agentId: "crm_context", status: "completed", summary: "Contexto CRM disponible.", findings: [], confidence: "high" }, { agentId: "commercial_health", status: "completed", summary: "Salud estable.", findings: [], confidence: "medium" }] } } });
    if (pathname === "/api/commercial-intelligence/account-chat/jobs" && method === "POST") return json({ job: { id: 702, status: "pending" } }, 202);
    if (pathname === "/api/commercial-intelligence/account-chat/jobs/702") return json({ job: { id: 702, status: "completed", result: { source: "account_intelligence", answer: "La cuenta requiere seguimiento comercial.", evidence: ["Snapshot autorizado"], confidence: "medium", recommendedActions: [] } } });
    if (pathname === "/api/commercial-intelligence/governance" && method === "GET") {
      return json({
        settings: {
          externalSourcesEnabled: false,
          dailyResearchLimitPerUser: 25,
          findingRetentionDays: 365,
          requireEvidenceForExternalFindings: true,
          allowProspectConversion: true,
          notes: "Configuracion inicial",
        },
        metrics: { jobsLast30Days: [], findingsLast30Days: [], prospectSessionsLast30Days: [] },
      });
    }
    if (pathname === "/api/commercial-intelligence/governance/settings" && method === "PUT") {
      return json({
        settings: route.request().postDataJSON(),
        metrics: { jobsLast30Days: [], findingsLast30Days: [], prospectSessionsLast30Days: [] },
      });
    }
    return json({});
  });
}

async function openMiCoach(page) {
  await page.addInitScript((token) => window.localStorage.setItem("crm_token", token), "jwt-token");
  await page.goto("/mi-agent");
  await expect(page.getByRole("heading", { name: "Mi Coach" })).toBeVisible();
}

test.describe("Mi Coach governance and workspaces", () => {
  test("muestra los espacios principales y conserva Coach", async ({ page }) => {
    await mockMiCoachApi(page);
    await openMiCoach(page);

    await expect(page.getByRole("button", { name: "Coach" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cliente existente" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cuenta nueva" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Administración" })).toHaveCount(0);

    await page.getByRole("button", { name: "Cuenta nueva" }).click();
    await expect(page.getByRole("heading", { name: "Prospección asistida" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Preparar cuenta" })).toBeVisible();
  });

  test("permite abrir y guardar gobierno con permiso administrativo", async ({ page }) => {
    await mockMiCoachApi(page, { canAdmin: true });
    await openMiCoach(page);

    await page.getByRole("button", { name: "Administración" }).click();
    await expect(page.getByRole("heading", { name: "Configuración, límites y métricas" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Guardar configuración" })).toBeVisible();

    const externalSources = page.getByLabel("Fuentes externas habilitadas");
    await externalSources.check();
    await page.getByRole("button", { name: "Guardar configuración" }).click();
    await expect(page.getByRole("status")).toContainText("Configuración de gobierno guardada");
  });

  test("muestra salud, señales y productos en Cliente existente", async ({ page }) => {
    await mockMiCoachApi(page, { withCustomerHealth: true });
    await openMiCoach(page);

    await page.locator("label").filter({ hasText: "Cuenta activa" }).locator("select").selectOption("160");
    await page.getByRole("button", { name: "Cliente existente" }).click();

    await expect(page.getByRole("heading", { name: "Requiere atención" })).toBeVisible();
    await expect(page.getByText("55/100")).toBeVisible();
    await expect(page.getByText("Actividad comercial atrasada")).toBeVisible();
    await expect(page.getByRole("region", { name: "Productos y renovaciones" }).locator("li").filter({ hasText: "Servicio WAAP" })).toBeVisible();
    await expect(page.getByText("Explorar solución complementaria: Seguridad")).toBeVisible();
    await expect(page.getByRole("button", { name: "Analizar cuenta" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Enriquecer con fuentes públicas" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Preparar resumen ejecutivo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Preparar llamada" })).toBeVisible();
    await page.getByRole("button", { name: "Analizar cuenta" }).click();
    await expect(page.getByText("Análisis interno listo.")).toBeVisible();
    await page.getByRole("button", { name: "Preparar resumen ejecutivo" }).click();
    await expect(page.getByRole("heading", { name: "Resumen ejecutivo de Cuenta Demo" })).toBeVisible();
    await expect(page.getByText("Contactar al cliente esta semana")).toBeVisible();
    await page.getByRole("button", { name: "Preparar llamada" }).click();
    await expect(page.getByRole("heading", { name: "Briefing de llamada" })).toBeVisible();
    await page.getByRole("button", { name: "Enriquecer con fuentes públicas" }).click();
    await expect(page.getByRole("heading", { name: "Agentes especializados" })).toBeVisible();
    await expect(page.getByText("Contexto CRM disponible.")).toBeVisible();
    await page.getByRole("button", { name: "Resumen para reunión" }).click();
    await expect(page.getByText("La cuenta requiere seguimiento comercial.")).toBeVisible();
  });
});
