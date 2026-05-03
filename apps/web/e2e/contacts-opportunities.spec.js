import { expect, test } from "@playwright/test";

function bootstrapAuthenticatedSession(page, token = "jwt-token") {
  return page.addInitScript((value) => {
    window.localStorage.setItem("crm_token", value);
  }, token);
}

function createCommercialFlowFixture({
  opportunityName = "Expansion 2026",
  finalCloseStatus = null,
  opportunityDocuments = [],
  documentAnswerSuggestionsEnabled = true,
  proposeAnswerResponse = null,
} = {}) {
  const stages = [
    {
      id: 1,
      code: "contacto_inicial",
      name: "Contacto inicial",
      stage_order: 1,
    },
    {
      id: 7,
      code: "waiting",
      name: "Waiting",
      stage_order: 7,
    },
  ];

  const commercialStatuses = [
    { id: 1, code: "en_proceso", name: "En proceso" },
    { id: 2, code: "ganada", name: "Ganada" },
    { id: 3, code: "perdida", name: "Perdida" },
    { id: 4, code: "anulada", name: "Anulada" },
  ];

  const activationStatuses = [
    { id: 1, code: "activada", name: "Activada" },
    { id: 2, code: "pendiente_activacion", name: "Pendiente de activacion" },
  ];

  const stageQuestions = {
    contacto_inicial: [
      {
        id: 9001,
        sales_stage_id: 1,
        code: "contacto_inicial_interes_cliente",
        prompt:
          "¿Qué necesidad, iniciativa, problema o interés concreto expresa el cliente que justifique abrir esta oportunidad?",
        response_type: "long_text",
        display_order: 1,
        is_required: 1,
        is_active: 1,
      },
    ],
    waiting: [
      {
        id: 9002,
        sales_stage_id: 7,
        code: "waiting_acuerdo_o_postores",
        prompt:
          "¿Se llegó a un acuerdo, o el cliente decidirá entre varios postores?",
        response_type: "long_text",
        display_order: 1,
        is_required: 1,
        is_active: 1,
      },
    ],
  };

  const detail = {
    id: 501,
    name: opportunityName,
    amount_usd: 25000,
    close_date: "2026-07-15",
    account_id: 11,
    contact_id: 201,
    sales_stage_id: 1,
    business_line_id: 1,
    seller_user_id: 31,
    presales_user_id: null,
    activation_status_id: 1,
    activation_status: "Activada",
    commercial_status: "En proceso",
    created_by_name: "Demo Seller",
    created_at: "2026-04-21T10:00:00.000Z",
    updated_by_name: "Demo Seller",
    updated_at: "2026-04-21T11:00:00.000Z",
  };

  const answerHistory = [];
  const latestAnswersByStage = new Map();
  const bypassInfoByStage = new Map();
  let closeReason = null;

  const findStageByCode = (code) => stages.find((stage) => stage.code === code);
  const findStageById = (stageId) =>
    stages.find((stage) => Number(stage.id) === Number(stageId));

  function getCurrentStage() {
    return findStageById(detail.sales_stage_id);
  }

  function getCurrentCommercialStatus() {
    return (
      commercialStatuses.find(
        (status) => status.name === detail.commercial_status,
      ) || commercialStatuses[0]
    );
  }

  function getCurrentQuestions() {
    const currentStage = getCurrentStage();
    return stageQuestions[currentStage.code] || [];
  }

  function buildCommercialContext(selectedStageCode = getCurrentStage().code) {
    const currentStage = getCurrentStage();
    const selectedStage = findStageByCode(selectedStageCode) || currentStage;
    const currentCommercialStatus = getCurrentCommercialStatus();
    const latestAnswers = latestAnswersByStage.get(selectedStage.code) || {};

    return {
      opportunityId: detail.id,
      salesStage: {
        id: selectedStage.id,
        code: selectedStage.code,
        name: selectedStage.name,
        order: selectedStage.stage_order,
      },
      currentSalesStage: {
        id: currentStage.id,
        code: currentStage.code,
        name: currentStage.name,
        order: currentStage.stage_order,
      },
      commercialStatus: {
        id: currentCommercialStatus.id,
        code: currentCommercialStatus.code,
        name: currentCommercialStatus.name,
        closedAt: finalCloseStatus || closeReason ? detail.updated_at : null,
        closeReason,
      },
      bypassInfo: bypassInfoByStage.get(selectedStage.code) || {
        isBypassed: false,
        reason: null,
      },
      features: {
        documentAnswerSuggestionsEnabled,
        rolloutKey: "opportunity_stage_answer_suggestions",
        configuredByEnv: documentAnswerSuggestionsEnabled,
      },
      isSelectedStageCurrent: currentStage.code === selectedStage.code,
      stages: stages.map((stage) => ({
        id: stage.id,
        code: stage.code,
        name: stage.name,
        order: stage.stage_order,
        isCurrent: stage.code === currentStage.code,
        isSelected: stage.code === selectedStage.code,
        isPast: stage.stage_order < currentStage.stage_order,
        isFuture: stage.stage_order > currentStage.stage_order,
        isClosed: isClosed(),
      })),
      answers: (stageQuestions[selectedStage.code] || []).map((question) => ({
        question_id: question.id,
        code: question.code,
        prompt: question.prompt,
        response_type: question.response_type,
        display_order: question.display_order,
        is_required: question.is_required,
        answer_value: latestAnswers[question.id] || "",
      })),
    };
  }

  function listOpportunities() {
    return [
      {
        id: detail.id,
        name: detail.name,
        amount_usd: detail.amount_usd,
        close_date: detail.close_date,
        account_id: detail.account_id,
        account_name: "Cuenta Demo",
        contact_name: "Ana Torres",
        sales_stage: getCurrentStage().name,
        commercial_status: detail.commercial_status,
        business_line: "Servicios",
        seller_user_name: "Demo Seller",
        presales_user_name: null,
        activation_status: detail.activation_status,
      },
    ];
  }

  function updateStageByDirection(direction) {
    const currentStage = getCurrentStage();
    const stageIndex = stages.findIndex(
      (stage) => Number(stage.id) === Number(currentStage.id),
    );
    const nextStage =
      direction === "advance" ? stages[stageIndex + 1] : stages[stageIndex - 1];
    if (!nextStage) {
      return null;
    }
    detail.sales_stage_id = nextStage.id;
    detail.updated_at = new Date().toISOString();
    return nextStage;
  }

  function isClosed() {
    return ["Ganada", "Perdida", "Anulada"].includes(detail.commercial_status);
  }

  return {
    stages,
    commercialStatuses,
    activationStatuses,
    stageQuestions,
    detail,
    answerHistory,
    latestAnswersByStage,
    bypassInfoByStage,
    closeReason,
    opportunityDocuments,
    proposeAnswerResponse,
    buildCommercialContext,
    listOpportunities,
    updateStageByDirection,
    isClosed,
    getCurrentStage,
    getCurrentQuestions,
    getCurrentCommercialStatus,
    findStageByCode,
    findStageById,
    setCloseStatus(statusCode, reason) {
      const status = commercialStatuses.find((row) => row.code === statusCode);
      detail.commercial_status = status.name;
      closeReason = reason || null;
      detail.updated_at = new Date().toISOString();
    },
  };
}

async function mockCommercialFlowApi(
  page,
  fixture,
  { canManageQuestions = false } = {},
) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const { pathname, searchParams } = url;
    const method = route.request().method();

    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (pathname === "/api/auth/bootstrap-status") {
      return json({ hasUsers: true });
    }

    if (pathname === "/api/auth/me") {
      return json({
        id: 31,
        full_name: "Demo Seller",
        email: "seller@example.com",
        status: "active",
        roles: [{ name: "Vendedor" }],
        permissions: canManageQuestions
          ? ["oportunidades.read", "oportunidades.update"]
          : ["oportunidades.read"],
      });
    }

    if (pathname === "/api/opportunities" && method === "GET") {
      if (searchParams.has("contactId")) {
        return json(fixture.listOpportunities());
      }
      return json(fixture.listOpportunities());
    }

    if (pathname === "/api/opportunities/501" && method === "GET") {
      return json({
        ...fixture.detail,
        sales_stage_code: fixture.getCurrentStage().code,
        sales_stage: fixture.getCurrentStage().name,
        commercial_status_code: fixture.getCurrentCommercialStatus().code,
      });
    }

    if (pathname === "/api/opportunities/501" && method === "PUT") {
      const body = route.request().postDataJSON();
      fixture.detail.name = body.name;
      fixture.detail.amount_usd = body.amountUsd;
      fixture.detail.account_id = body.accountId;
      fixture.detail.close_date = body.closeDate;
      fixture.detail.contact_id = body.contactId;
      fixture.detail.business_line_id = body.businessLineId;
      fixture.detail.seller_user_id = body.sellerUserId;
      fixture.detail.presales_user_id = body.presalesUserId;
      fixture.detail.activation_status_id = body.activationStatusId;
      if (body.salesStageId) {
        fixture.detail.sales_stage_id = Number(body.salesStageId);
      }
      if (body.stageChangeMode === "bypass" && body.salesStageId) {
        const targetStage = fixture.findStageById(Number(body.salesStageId));
        if (targetStage) {
          fixture.bypassInfoByStage.set(targetStage.code, {
            isBypassed: true,
            reason: String(body.stageChangeReason || "").trim() || null,
          });
        }
      }
      if (body.commercialStatusCode) {
        fixture.setCloseStatus(
          String(body.commercialStatusCode),
          String(body.commercialCloseReason || "").trim() || null,
        );
      }
      fixture.detail.updated_at = new Date().toISOString();
      return json({
        message: body.commercialStatusCode
          ? `Oportunidad cerrada como ${body.commercialStatusCode}`
          : "Oportunidad actualizada",
      });
    }

    if (
      pathname === "/api/opportunities/501/commercial-context" &&
      method === "GET"
    ) {
      return json(fixture.buildCommercialContext());
    }

    if (
      pathname.startsWith("/api/opportunities/501/stage-view/") &&
      method === "GET"
    ) {
      const salesStageId = Number(pathname.split("/").pop());
      const selectedStage = fixture.stages.find(
        (stage) => Number(stage.id) === Number(salesStageId),
      );
      return json(fixture.buildCommercialContext(selectedStage?.code));
    }

    if (pathname === "/api/opportunities/501/documents" && method === "GET") {
      return json(fixture.opportunityDocuments);
    }

    if (
      pathname.startsWith("/api/opportunities/501/stage-view/") &&
      pathname.endsWith("/propose-answers") &&
      method === "POST"
    ) {
      return json(
        fixture.proposeAnswerResponse || {
          salesStageId: fixture.getCurrentStage().id,
          salesStageName: fixture.getCurrentStage().name,
          suggestions: [],
          summary: {
            proposedCount: 0,
            fillCount: 0,
            replaceCount: 0,
            ambiguousCount: 0,
            insufficientCount: 1,
          },
          meta: {
            questionCount: fixture.getCurrentQuestions().length,
            documentCount: fixture.opportunityDocuments.length,
            stageGuideAvailable: true,
          },
        },
      );
    }

    if (
      pathname === "/api/opportunities/501/stage-answers" &&
      method === "POST"
    ) {
      const body = route.request().postDataJSON();
      const currentStage = fixture.getCurrentStage();
      const previous =
        fixture.latestAnswersByStage.get(currentStage.code) || {};
      const nextAnswers = { ...previous };

      for (const answer of body.answers || []) {
        nextAnswers[Number(answer.questionId)] = String(
          answer.answerValue || "",
        );
        fixture.answerHistory.push({
          stageCode: currentStage.code,
          questionId: Number(answer.questionId),
          answerValue: String(answer.answerValue || ""),
        });
      }

      fixture.latestAnswersByStage.set(currentStage.code, nextAnswers);
      fixture.detail.updated_at = new Date().toISOString();
      return json({ message: "Respuestas guardadas" });
    }

    if (
      pathname === "/api/opportunities/501/stage-transition" &&
      method === "POST"
    ) {
      const body = route.request().postDataJSON();
      if (fixture.isClosed()) {
        return json(
          { message: "No puedes mover de etapa una oportunidad cerrada" },
          400,
        );
      }

      if (body.direction === "advance") {
        const context = fixture.buildCommercialContext();
        const hasMissingRequiredAnswer = context.answers.some(
          (answer) =>
            answer.is_required && !String(answer.answer_value || "").trim(),
        );
        if (hasMissingRequiredAnswer) {
          return json(
            {
              message:
                "Debes responder todas las preguntas obligatorias de la etapa actual",
            },
            400,
          );
        }
      }

      const targetStage = fixture.updateStageByDirection(body.direction);
      if (!targetStage) {
        return json(
          {
            message:
              body.direction === "advance"
                ? "La oportunidad ya esta en la ultima etapa operativa"
                : "La oportunidad ya esta en la primera etapa operativa",
          },
          400,
        );
      }

      return json({
        message:
          body.direction === "advance" ? "Etapa avanzada" : "Etapa retrocedida",
        salesStageId: targetStage.id,
        salesStageCode: targetStage.code,
      });
    }

    if (
      pathname === "/api/opportunities/501/validate-current-stage" &&
      method === "POST"
    ) {
      if (fixture.isClosed()) {
        return json(
          { message: "No puedes validar una etapa de una oportunidad cerrada" },
          400,
        );
      }
      return json({
        message: `Etapa ${fixture.getCurrentStage().name} validada`,
      });
    }

    if (
      pathname === "/api/opportunities/501/stage-bypass" &&
      method === "POST"
    ) {
      const body = route.request().postDataJSON();
      if (fixture.isClosed()) {
        return json(
          { message: "No puedes bypasear la etapa de una oportunidad cerrada" },
          400,
        );
      }
      if (!String(body.reason || "").trim()) {
        return json(
          { message: "Debes indicar un motivo para bypasear la etapa" },
          400,
        );
      }

      const targetStage = fixture.updateStageByDirection("advance");
      if (!targetStage) {
        return json(
          { message: "La oportunidad ya esta en la ultima etapa operativa" },
          400,
        );
      }

      fixture.bypassInfoByStage.set(targetStage.code, {
        isBypassed: true,
        reason: String(body.reason || "").trim(),
      });

      fixture.detail.updated_at = new Date().toISOString();

      return json({
        message: `Etapa bypaseada hacia ${targetStage.name}`,
        salesStageId: targetStage.id,
        salesStageCode: targetStage.code,
      });
    }

    if (
      pathname === "/api/opportunities/501/commercial-close" &&
      method === "POST"
    ) {
      const body = route.request().postDataJSON();
      if (fixture.isClosed()) {
        return json(
          { message: "La oportunidad ya tiene un cierre comercial definitivo" },
          400,
        );
      }
      if (
        body.statusCode === "ganada" &&
        fixture.getCurrentStage().code !== "waiting"
      ) {
        return json(
          {
            message:
              "Solo puedes marcar como ganada una oportunidad en Waiting",
          },
          400,
        );
      }
      if (
        ["perdida", "anulada"].includes(body.statusCode) &&
        !String(body.reason || "").trim()
      ) {
        return json(
          { message: "Debes indicar un motivo para cerrar la oportunidad" },
          400,
        );
      }

      fixture.setCloseStatus(body.statusCode, body.reason);
      return json({ message: `Oportunidad cerrada como ${body.statusCode}` });
    }

    if (pathname === "/api/catalogs/opportunity-accounts") {
      return json([{ id: 11, name: "Cuenta Demo" }]);
    }

    if (pathname === "/api/catalogs/opportunity-contacts") {
      return json([{ id: 201, full_name: "Ana Torres", account_id: 11 }]);
    }

    if (pathname === "/api/catalogs/opportunity-seller-users") {
      return json([{ id: 31, full_name: "Demo Seller" }]);
    }

    if (pathname === "/api/catalogs/opportunity-presales-users") {
      return json([]);
    }

    if (pathname === "/api/catalogs/opportunity-business-lines") {
      return json([{ id: 1, name: "Servicios" }]);
    }

    if (pathname === "/api/catalogs/opportunity-sales-stages") {
      return json(fixture.stages);
    }

    if (pathname === "/api/catalogs/opportunity-activation-statuses") {
      return json(fixture.activationStatuses);
    }

    if (pathname === "/api/catalogs/opportunity-commercial-statuses") {
      return json(fixture.commercialStatuses);
    }

    if (
      pathname === "/api/catalogs/opportunity-stage-questions-admin" &&
      method === "GET"
    ) {
      const salesStageId = Number(searchParams.get("salesStageId"));
      const stage = fixture.stages.find(
        (row) => Number(row.id) === Number(salesStageId),
      );
      return json({
        salesStage: stage,
        responseTypes: ["long_text"],
        questions: (fixture.stageQuestions[stage.code] || []).map(
          (question) => ({
            ...question,
            sales_stage_code: stage.code,
            sales_stage_name: stage.name,
          }),
        ),
      });
    }

    if (
      pathname === "/api/catalogs/opportunity-stage-questions" &&
      method === "GET"
    ) {
      const salesStageId = Number(searchParams.get("salesStageId"));
      const stage = fixture.stages.find(
        (row) => Number(row.id) === Number(salesStageId),
      );
      return json(
        (fixture.stageQuestions[stage.code] || []).filter(
          (question) => question.is_active === 1,
        ),
      );
    }

    if (
      pathname === "/api/catalogs/opportunity-stage-questions" &&
      method === "POST"
    ) {
      const body = route.request().postDataJSON();
      const stage = fixture.stages.find(
        (row) => Number(row.id) === Number(body.salesStageId),
      );
      const nextQuestion = {
        id: 9900 + (fixture.stageQuestions[stage.code]?.length || 0) + 1,
        sales_stage_id: Number(body.salesStageId),
        code: `${stage.code}_manual_${Date.now()}`,
        prompt: String(body.prompt || ""),
        response_type: String(body.responseType || "long_text"),
        display_order: Number(body.displayOrder || 1),
        is_required: body.isRequired ? 1 : 0,
        is_active: 1,
      };
      fixture.stageQuestions[stage.code] = [
        ...(fixture.stageQuestions[stage.code] || []),
        nextQuestion,
      ].sort((left, right) => left.display_order - right.display_order);
      return json(
        {
          message: "Pregunta creada correctamente",
          question: {
            ...nextQuestion,
            sales_stage_code: stage.code,
            sales_stage_name: stage.name,
          },
        },
        201,
      );
    }

    if (pathname === "/api/contacts") {
      return json([
        {
          id: 201,
          full_name: "Ana Torres",
          account_id: 11,
          account_name: "Cuenta Demo",
          position_title: "Gerente",
          email: "ana@example.com",
          mobile: "555111222",
          activation_status: "Activado",
        },
      ]);
    }

    if (pathname === "/api/catalogs/contact-accounts") {
      return json([
        {
          id: 11,
          name: "Cuenta Demo",
          country_id: 1,
          state_region: "Lima",
          city: "Lima",
          address_line: "Av. Demo 123",
          postal_code: "15001",
        },
      ]);
    }

    if (pathname === "/api/catalogs/contact-countries") {
      return json([{ id: 1, name: "Peru" }]);
    }

    if (pathname === "/api/catalogs/contact-purchase-participations") {
      return json([{ id: 1, name: "Ninguno", code: "ninguno" }]);
    }

    if (pathname === "/api/catalogs/contact-relationship-types") {
      return json([{ id: 1, name: "Ninguno", code: "ninguno" }]);
    }

    if (pathname === "/api/catalogs/contact-employment-statuses") {
      return json([{ id: 1, name: "Activo", code: "activo" }]);
    }

    if (pathname === "/api/catalogs/contact-activation-statuses") {
      return json([{ id: 1, name: "Activado", code: "activado" }]);
    }

    return json({ message: `Unhandled route: ${pathname}` }, 500);
  });
}

async function openOpportunityEditor(page, opportunityName = "Expansion 2026") {
  const row = page
    .locator("tbody tr")
    .filter({ has: page.getByText(opportunityName, { exact: true }) })
    .first();

  await row.getByRole("button", { name: "Abrir acciones" }).click();
  await page.getByRole("button", { name: "Editar" }).click();
  await expect(page.getByText("Editar oportunidad")).toBeVisible();
}

test.describe("contacts opportunities", () => {
  test("abre oportunidades relacionadas desde el kebab de contactos", async ({
    page,
  }) => {
    let requestedContactId = null;
    let openedOpportunityId = null;

    await page.addInitScript(() => {
      window.localStorage.setItem("crm_token", "jwt-token");
    });

    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const { pathname, searchParams } = url;

      const json = (body, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(body),
        });

      if (pathname === "/api/auth/bootstrap-status") {
        return json({ hasUsers: true });
      }

      if (pathname === "/api/auth/me") {
        return json({
          id: 31,
          full_name: "Demo Seller",
          email: "seller@example.com",
          status: "active",
          roles: [{ name: "Vendedor" }],
          permissions: ["contactos.read", "oportunidades.read"],
        });
      }

      if (pathname === "/api/contacts") {
        return json([
          {
            id: 201,
            full_name: "Ana Torres",
            account_id: 11,
            account_name: "Cuenta Demo",
            position_title: "Gerente",
            email: "ana@example.com",
            mobile: "555111222",
            activation_status: "Activado",
          },
        ]);
      }

      if (pathname === "/api/catalogs/contact-accounts") {
        return json([
          {
            id: 11,
            name: "Cuenta Demo",
            country_id: 1,
            state_region: "Lima",
            city: "Lima",
            address_line: "Av. Demo 123",
            postal_code: "15001",
          },
        ]);
      }

      if (pathname === "/api/catalogs/contact-countries") {
        return json([{ id: 1, name: "Peru" }]);
      }

      if (pathname === "/api/catalogs/contact-purchase-participations") {
        return json([{ id: 1, name: "Ninguno", code: "ninguno" }]);
      }

      if (pathname === "/api/catalogs/contact-relationship-types") {
        return json([{ id: 1, name: "Ninguno", code: "ninguno" }]);
      }

      if (pathname === "/api/catalogs/contact-employment-statuses") {
        return json([{ id: 1, name: "Activo", code: "activo" }]);
      }

      if (pathname === "/api/catalogs/contact-activation-statuses") {
        return json([{ id: 1, name: "Activado", code: "activado" }]);
      }

      if (pathname === "/api/opportunities" && searchParams.has("contactId")) {
        requestedContactId = searchParams.get("contactId");
        return json([
          {
            id: 501,
            name: "Expansion 2026",
            amount_usd: 25000,
            close_date: "2026-07-15",
            account_id: 11,
            account_name: "Cuenta Demo",
            contact_name: "Ana Torres",
            sales_stage: "Contacto inicial",
            commercial_status: "En proceso",
            business_line: "Servicios",
            seller_user_name: "Demo Seller",
            presales_user_name: null,
            activation_status: "Activada",
          },
        ]);
      }

      if (pathname === "/api/opportunities") {
        return json([
          {
            id: 501,
            name: "Expansion 2026",
            amount_usd: 25000,
            close_date: "2026-07-15",
            account_id: 11,
            account_name: "Cuenta Demo",
            contact_name: "Ana Torres",
            sales_stage: "Contacto inicial",
            commercial_status: "En proceso",
            business_line: "Servicios",
            seller_user_name: "Demo Seller",
            presales_user_name: null,
            activation_status: "Activada",
          },
        ]);
      }

      if (pathname === "/api/opportunities/501") {
        openedOpportunityId = "501";
        return json({
          id: 501,
          name: "Expansion 2026",
          amount_usd: 25000,
          close_date: "2026-07-15",
          account_id: 11,
          contact_id: 201,
          sales_stage_id: 1,
          business_line_id: 1,
          seller_user_id: 31,
          presales_user_id: null,
          activation_status_id: 1,
          activation_status: "Activada",
          commercial_status: "En proceso",
          created_by_name: "Demo Seller",
          created_at: "2026-04-21T10:00:00.000Z",
          updated_by_name: "Demo Seller",
          updated_at: "2026-04-21T11:00:00.000Z",
        });
      }

      if (pathname === "/api/opportunities/501/commercial-context") {
        return json({
          opportunityId: 501,
          salesStage: {
            id: 1,
            code: "contacto_inicial",
            name: "Contacto inicial",
            order: 1,
          },
          commercialStatus: {
            id: 1,
            code: "en_proceso",
            name: "En proceso",
            closedAt: null,
            closeReason: null,
          },
          answers: [
            {
              question_id: 9001,
              code: "contacto_inicial_interes_cliente",
              prompt: "¿En qué está interesado el cliente?",
              response_type: "long_text",
              display_order: 1,
              is_required: 1,
              answer_value: "",
            },
          ],
        });
      }

      if (pathname === "/api/catalogs/opportunity-accounts") {
        return json([{ id: 11, name: "Cuenta Demo" }]);
      }

      if (pathname === "/api/catalogs/opportunity-contacts") {
        return json([{ id: 201, full_name: "Ana Torres", account_id: 11 }]);
      }

      if (pathname === "/api/catalogs/opportunity-seller-users") {
        return json([{ id: 31, full_name: "Demo Seller" }]);
      }

      if (pathname === "/api/catalogs/opportunity-presales-users") {
        return json([]);
      }

      if (pathname === "/api/catalogs/opportunity-business-lines") {
        return json([{ id: 1, name: "Servicios" }]);
      }

      if (pathname === "/api/catalogs/opportunity-sales-stages") {
        return json([
          { id: 1, name: "Contacto inicial", code: "contacto_inicial" },
        ]);
      }

      if (pathname === "/api/catalogs/opportunity-commercial-statuses") {
        return json([{ id: 1, name: "En proceso", code: "en_proceso" }]);
      }

      if (pathname === "/api/catalogs/opportunity-activation-statuses") {
        return json([{ id: 1, name: "Activada", code: "activada" }]);
      }

      return json({ message: `Unhandled route: ${pathname}` }, 500);
    });

    await page.goto("http://127.0.0.1:4173/contacts");

    await expect(
      page.getByRole("heading", { name: "Contactos" }),
    ).toBeVisible();

    const contactRow = page
      .locator("tbody tr")
      .filter({ has: page.getByText("Ana Torres") })
      .first();

    await contactRow.getByRole("button", { name: "Abrir acciones" }).click();
    await page.getByRole("button", { name: "Oportunidades" }).click();

    await expect.poll(() => requestedContactId).toBe("201");
    const opportunitiesDialog = page.getByRole("dialog", {
      name: /Oportunidades de Ana Torres/i,
    });
    await expect(opportunitiesDialog).toBeVisible();
    await expect(opportunitiesDialog.getByText("Expansion 2026")).toBeVisible();
    await expect(opportunitiesDialog.getByText("Cuenta Demo")).toBeVisible();

    await opportunitiesDialog.getByText("Expansion 2026").click();

    await page.waitForURL("**/opportunities");
    await expect.poll(() => openedOpportunityId).toBe("501");
    await expect(page.getByText("Editar oportunidad")).toBeVisible();
  });

  test("no graba el cambio de etapa hasta guardar cambios y luego permite cerrar como ganada", async ({
    page,
  }) => {
    const fixture = createCommercialFlowFixture();

    await bootstrapAuthenticatedSession(page);
    await mockCommercialFlowApi(page, fixture);
    await page.goto("http://127.0.0.1:4173/opportunities");

    await expect(
      page.getByRole("heading", { name: "Oportunidades" }),
    ).toBeVisible();
    await openOpportunityEditor(page);

    await expect(
      page.getByText("Etapa: Contacto inicial", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("Activada", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("En proceso", { exact: true }).first(),
    ).toBeVisible();

    await page.getByRole("button", { name: /Waiting/i }).click();
    await expect(
      page.getByText(/Esta vista es solo lectura/, { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByLabel(
        "¿Se llegó a un acuerdo, o el cliente decidirá entre varios postores? *",
      ),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Guardar respuestas" }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: /Contacto inicial/i }).click();
    await expect(
      page.getByLabel(
        "¿Qué necesidad, iniciativa, problema o interés concreto expresa el cliente que justifique abrir esta oportunidad? *",
      ),
    ).toBeEnabled();

    await page.getByRole("button", { name: "Avanzar etapa" }).click();
    await expect(
      page.getByText(
        "Debes capturar al menos una respuesta para guardar la etapa",
      ),
    ).toBeVisible();

    await page
      .getByLabel(
        "¿Qué necesidad, iniciativa, problema o interés concreto expresa el cliente que justifique abrir esta oportunidad? *",
      )
      .fill("Cliente interesado en renovación de servicios gestionados");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText(/Oportunidad actualizada/i)).toBeVisible();

    await openOpportunityEditor(page);

    await page.getByRole("button", { name: "Avanzar etapa" }).click();
    await expect(
      page.getByText(/Cambio de etapa pendiente/, { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("Etapa: Waiting", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancelar" }).click();

    await openOpportunityEditor(page);
    await expect(
      page.getByText("Etapa: Contacto inicial", { exact: false }),
    ).toBeVisible();

    await page
      .getByLabel(
        "¿Qué necesidad, iniciativa, problema o interés concreto expresa el cliente que justifique abrir esta oportunidad? *",
      )
      .fill("Cliente interesado en renovación de servicios gestionados");
    await page.getByRole("button", { name: "Avanzar etapa" }).click();
    await expect(
      page.getByText(/Cambio de etapa pendiente/, { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Guardar cambios" }).click();

    await openOpportunityEditor(page);
    await expect(
      page.getByText("Etapa: Waiting", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Marcar ganada" }),
    ).toBeEnabled();

    await page.getByRole("button", { name: "Marcar ganada" }).click();
    await expect(
      page.getByText("Oportunidad cerrada como ganada"),
    ).toBeVisible();
    await expect(
      page.getByText("Ganada", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Guardar respuestas" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Regresar etapa anterior" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Avanzar etapa" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Marcar ganada" }),
    ).toBeDisabled();
  });

  test("permite validar la etapa actual y bypasearla con motivo", async ({
    page,
  }) => {
    const fixture = createCommercialFlowFixture({
      opportunityName: "Expansion bypass 2026",
    });

    await bootstrapAuthenticatedSession(page);
    await mockCommercialFlowApi(page, fixture);
    await page.goto("http://127.0.0.1:4173/opportunities");

    await openOpportunityEditor(page, "Expansion bypass 2026");

    await page.getByRole("button", { name: "Validar etapa actual" }).click();
    await expect(
      page.getByText("Etapa Contacto inicial validada"),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Bypasear etapa" }),
    ).toBeEnabled();

    await page.getByRole("button", { name: "Bypasear etapa" }).click();
    await expect(
      page.getByRole("heading", { name: "Confirmar bypass de etapa" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Confirmar bypass" }).click();
    await expect(
      page.getByText("Debes indicar un motivo para bypasear la etapa"),
    ).toBeVisible();

    await page
      .getByLabel(/Motivo del bypass/i)
      .fill("Se omitira la etapa por criterio externo");
    await page.getByRole("button", { name: "Confirmar bypass" }).click();

    await expect(
      page.getByText(/Cambio de etapa pendiente/, { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("Etapa: Waiting", { exact: false }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await openOpportunityEditor(page, "Expansion bypass 2026");
    await expect(
      page.getByText("Etapa: Waiting", { exact: false }),
    ).toBeVisible();
    await expect(page.getByLabel(/Motivo del bypass aplicado/i)).toHaveValue(
      "Se omitira la etapa por criterio externo",
    );
    await expect(page.getByText(/Esta etapa fue bypaseada/i)).toBeVisible();
    await expect(
      page.getByText(
        "¿Se llegó a un acuerdo, o el cliente decidirá entre varios postores? *",
      ),
    ).toHaveCount(0);

    await page.getByRole("button", { name: /Contacto inicial/i }).click();
    await expect(
      page.getByText(/Esta vista es solo lectura/, { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Regresar a etapa seleccionada" })
      .click();
    await expect(
      page.getByText(/Cambio de etapa pendiente/, { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Guardar cambios" }).click();

    await openOpportunityEditor(page, "Expansion bypass 2026");
    await expect(
      page.getByText("Etapa: Contacto inicial", { exact: false }),
    ).toBeVisible();
  });

  test("propone respuestas desde documentos y permite aplicarlas", async ({
    page,
  }) => {
    const proposedAnswer =
      "Busca automatizar el seguimiento comercial y ordenar la priorizacion de cuentas clave.";
    const fixture = createCommercialFlowFixture({
      opportunityName: "Expansion documental 2026",
      opportunityDocuments: [
        {
          id: 301,
          publicId: "doc_demo_301",
          originalFileName: "brief-comercial.txt",
          processingStatus: "review_ready",
        },
      ],
      proposeAnswerResponse: {
        salesStageId: 1,
        salesStageName: "Contacto inicial",
        suggestions: [
          {
            questionId: 9001,
            status: "proposed",
            proposalKind: "fill_empty",
            proposedAnswer,
            reason:
              "El brief comercial describe el objetivo principal del cliente con suficiente claridad.",
          },
        ],
        summary: {
          proposedCount: 1,
          fillCount: 1,
          replaceCount: 0,
          ambiguousCount: 0,
          insufficientCount: 0,
        },
        meta: {
          questionCount: 1,
          documentCount: 1,
          stageGuideAvailable: true,
        },
      },
    });

    await bootstrapAuthenticatedSession(page);
    await mockCommercialFlowApi(page, fixture);
    await page.goto("http://127.0.0.1:4173/opportunities");

    await openOpportunityEditor(page, "Expansion documental 2026");
    await page
      .getByRole("button", { name: /Proponer respuestas desde documentos/i })
      .click();

    await expect(page.getByText("Sugerencia documental")).toBeVisible();
    await expect(page.getByText(proposedAnswer)).toBeVisible();

    await page.getByRole("button", { name: "Aplicar sugerencia" }).click();

    await expect(page.getByLabel(/interesado el cliente/i)).toHaveValue(
      proposedAnswer,
    );
  });

  test("permite cerrar la oportunidad como perdida con motivo visible", async ({
    page,
  }) => {
    const fixture = createCommercialFlowFixture({
      opportunityName: "Expansion perdida 2026",
    });

    await bootstrapAuthenticatedSession(page);
    await mockCommercialFlowApi(page, fixture);
    await page.goto("http://127.0.0.1:4173/opportunities");

    await openOpportunityEditor(page, "Expansion perdida 2026");
    await page.getByRole("button", { name: "Marcar perdida" }).click();
    await expect(
      page.getByRole("heading", { name: /Confirmar oportunidad perdida/i }),
    ).toBeVisible();
    await page
      .getByLabel(/Motivo del cierre comercial/i)
      .fill("El cliente pausó el presupuesto del proyecto");
    await page.getByRole("button", { name: "Confirmar cierre" }).click();

    await expect(
      page.getByText(/Hay un cierre comercial pendiente como Perdida/i),
    ).toBeVisible();
    await page.getByRole("button", { name: "Guardar cambios" }).click();

    await openOpportunityEditor(page, "Expansion perdida 2026");

    await expect(
      page.getByText("Perdida", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByLabel(/Motivo de cierre comercial/i)).toBeDisabled();
  });

  test("permite cerrar la oportunidad como anulada con motivo visible", async ({
    page,
  }) => {
    const fixture = createCommercialFlowFixture({
      opportunityName: "Expansion anulada 2026",
    });

    await bootstrapAuthenticatedSession(page);
    await mockCommercialFlowApi(page, fixture);
    await page.goto("http://127.0.0.1:4173/opportunities");

    await openOpportunityEditor(page, "Expansion anulada 2026");
    await page.getByRole("button", { name: "Marcar anulada" }).click();
    await expect(
      page.getByRole("heading", { name: /Confirmar oportunidad anulada/i }),
    ).toBeVisible();
    await page
      .getByLabel(/Motivo del cierre comercial/i)
      .fill("La oportunidad quedó fuera del alcance comercial");
    await page.getByRole("button", { name: "Confirmar cierre" }).click();

    await expect(
      page.getByText(/Hay un cierre comercial pendiente como Anulada/i),
    ).toBeVisible();
    await page.getByRole("button", { name: "Guardar cambios" }).click();

    await openOpportunityEditor(page, "Expansion anulada 2026");

    await expect(
      page.getByText("Anulada", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByLabel(/Motivo de cierre comercial/i)).toBeDisabled();
  });

  test("refleja en oportunidades una pregunta nueva creada desde la administración comercial", async ({
    page,
  }) => {
    const fixture = createCommercialFlowFixture({
      opportunityName: "Expansion catalogo 2026",
    });

    await bootstrapAuthenticatedSession(page);
    await mockCommercialFlowApi(page, fixture, { canManageQuestions: true });
    await page.goto("http://127.0.0.1:4173/opportunities/questions");

    await expect(
      page.getByRole("heading", { name: "Preguntas comerciales" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "+ Nueva pregunta" }).click();
    await page
      .getByLabel(/^Pregunta/i)
      .fill("¿Qué restricción técnica reportó el cliente en esta etapa?");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Pregunta creada correctamente")).toBeVisible();

    await page.goto("http://127.0.0.1:4173/opportunities");
    await openOpportunityEditor(page, "Expansion catalogo 2026");

    await expect(
      page.getByLabel(
        "¿Qué restricción técnica reportó el cliente en esta etapa? *",
      ),
    ).toBeVisible();
  });
});
