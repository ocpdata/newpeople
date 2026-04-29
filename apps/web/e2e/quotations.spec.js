import { expect, test } from "@playwright/test";

function bootstrapAuthenticatedSession(page, token = "jwt-token") {
  return page.addInitScript((value) => {
    window.localStorage.setItem("crm_token", value);
  }, token);
}

function createQuotationsFixture({
  onCreateQuotation,
  onRenderQuotationPdf,
  onUpdateQuotationVersion,
  quotationVersionOverrides,
  quotationOverrides,
} = {}) {
  function calculateMockItemSalePriceTotal(item) {
    const quantity = Number(item?.quantity || 0);
    const listPriceUnit = Number(item?.listPriceUnit || 0);
    const manufacturerDiscountPct = Number(item?.manufacturerDiscountPct || 0);
    const importCostPct = Number(item?.importCostPct || 0);
    const profitMarginPct = Number(item?.profitMarginPct || 0);
    const finalDiscountPct = Number(item?.finalDiscountPct || 0);

    const discountedListPriceUnit =
      listPriceUnit * (1 - manufacturerDiscountPct / 100);
    const costUnit = discountedListPriceUnit * (1 + importCostPct / 100);
    const salePriceBase =
      profitMarginPct >= 100 ? 0 : costUnit / (1 - profitMarginPct / 100);
    const salePriceUnit = salePriceBase * (1 - finalDiscountPct / 100);

    return quantity * salePriceUnit;
  }

  function calculateMockQuotationTotal(version) {
    const items = Array.isArray(version?.sections)
      ? version.sections.flatMap((section) => section?.items || [])
      : [];

    return items
      .filter((item) => {
        const hasChildren = items.some(
          (candidate) =>
            Number(candidate.bundleParentItemId || 0) === Number(item.id || 0),
        );
        if (hasChildren) return false;
        if (item.itemType === "grupo_productos") return false;
        return true;
      })
      .reduce(
        (accumulator, item) =>
          accumulator + calculateMockItemSalePriceTotal(item),
        0,
      );
  }

  const user = {
    id: 7,
    full_name: "Demo Seller",
    email: "seller@example.com",
    permissions: ["cotizaciones.operacion"],
  };

  const accounts = [{ id: 1, name: "Cuenta Demo" }];
  const contacts = [{ id: 101, account_id: 1, full_name: "Ana Contacto" }];
  const opportunities = [
    {
      id: 11,
      accountId: 1,
      name: "Oportunidad Demo",
      contactId: 101,
      amountUsd: 25000,
      closeDate: "2026-05-30",
      salesStageName: "Propuesta",
      activationStatusName: "Activada",
      sellerUserId: 7,
      sellerUserName: "Demo Seller",
    },
  ];
  const inclusionTypes = [
    { id: 1, code: "incluida", name: "Incluida" },
    { id: 2, code: "opcional", name: "Opcional" },
    { id: 3, code: "no_incluida", name: "No incluida" },
  ];
  const deliveryTimes = [
    { id: 1, code: "inmediato", name: "Inmediato" },
    { id: 2, code: "5_dias", name: "5 días" },
    { id: 3, code: "10_dias", name: "10 días" },
    { id: 4, code: "15_dias", name: "15 días" },
    { id: 5, code: "30_dias", name: "30 días" },
    { id: 6, code: "45_dias", name: "45 días" },
    { id: 7, code: "60_dias", name: "60 días" },
    {
      id: 8,
      code: "segun_notas",
      name: "De acuerdo a lo indicado en notas",
    },
  ];
  const validityTerms = [
    { id: 1, code: "5_dias", name: "5 días" },
    { id: 2, code: "10_dias", name: "10 días" },
    { id: 3, code: "15_dias", name: "15 días" },
    { id: 4, code: "30_dias", name: "30 días" },
    { id: 5, code: "45_dias", name: "45 días" },
    { id: 6, code: "60_dias", name: "60 días" },
    {
      id: 7,
      code: "segun_notas",
      name: "De acuerdo a lo indicado en notas",
    },
  ];
  const warrantyTerms = [
    { id: 1, code: "1_ano", name: "1 año" },
    { id: 2, code: "2_anos", name: "2 años" },
    { id: 3, code: "3_anos", name: "3 años" },
    { id: 4, code: "4_anos", name: "4 años" },
    { id: 5, code: "5_anos", name: "5 años" },
    {
      id: 6,
      code: "segun_notas",
      name: "De acuerdo a lo indicado en notas",
    },
  ];
  const paymentTerms = [
    { id: 1, code: "100_adelantado", name: "100% adelantado" },
    {
      id: 2,
      code: "50_adelantado_50_entrega",
      name: "50% adelantado - 50% contra entrega",
    },
    { id: 3, code: "100_entrega", name: "100% contra entrega" },
    {
      id: 4,
      code: "15_dias_facturado",
      name: "15 días despues de facturado",
    },
    {
      id: 5,
      code: "30_dias_facturado",
      name: "30 días despues de facturado",
    },
    {
      id: 6,
      code: "45_dias_facturado",
      name: "45 días despues de facturado",
    },
    {
      id: 7,
      code: "60_dias_facturado",
      name: "60 días despues de facturado",
    },
    {
      id: 8,
      code: "90_dias_facturado",
      name: "90 días despues de facturado",
    },
    {
      id: 9,
      code: "segun_notas",
      name: "De acuerdo a lo indicado en notas",
    },
  ];
  const currencies = [
    { id: 1, code: "USD", name: "Dólar estadounidense", symbol: "$" },
    { id: 2, code: "EUR", name: "Euro", symbol: "€" },
    { id: 3, code: "MXN", name: "Peso mexicano", symbol: "$" },
  ];
  const providers = [{ id: 201, name: "Bundles Inc" }];
  const activationStatuses = [{ id: 1, code: "borrador", name: "Borrador" }];
  const quotations = [
    {
      id: 901,
      opportunityId: 11,
      accountId: 1,
      accountName: "Cuenta Demo",
      opportunityName: "Oportunidad Demo",
      opportunitySalesStageName: "Propuesta",
      opportunityAmountUsd: 25000,
      opportunityCloseDate: "2026-05-30",
      sellerUserId: 7,
      sellerUserName: "Demo Seller",
      latestVersionId: 1001,
      latestVersionNumber: 1,
      latestStatusCode: "borrador",
      latestStatusName: "Borrador",
      latestProposalName: "Oportunidad Demo",
      latestQuotationDate: "2026-04-25",
      activationStatusId: 1,
      activationStatusCode: "activada",
      activationStatusName: "Activada",
    },
  ];
  let quotationVersion = {
    id: 1001,
    quotationId: 901,
    versionNumber: 1,
    statusCode: "borrador",
    statusName: "Borrador",
    activationStatusCode: "activada",
    activationStatusName: "Activada",
    isLatestVersion: true,
    contactId: 101,
    proposalName: "Oportunidad Demo",
    quotationDate: "2026-04-25",
    introduction: "Version demo",
    summaryDiscountMode: null,
    summaryDiscountValue: null,
    summaryDistributionMode: null,
    summaryVatMode: null,
    summaryVatPct: null,
    internalNotes: "",
    deliveryTime: "30_dias",
    quotationValidity: "30_dias",
    warranty: "1_ano",
    paymentTerms: "30_dias_facturado",
    currencyCode: "USD",
    exchangeRate: 1,
    quotationNotes:
      "Los precios están expresados en dólares americanos y no incluyen el I.V.A.",
    actions: [
      { code: "modificar", name: "Modificar", allowed: true },
      {
        code: "solicitar_aprobacion",
        name: "Solicitar aprobacion",
        allowed: true,
      },
      { code: "crear_version", name: "Crear version", allowed: true },
      {
        code: "declarar_perdida",
        name: "Declarar perdida",
        allowed: true,
      },
      {
        code: "declarar_anulada",
        name: "Declarar anulada",
        allowed: true,
      },
    ],
    sections: [
      {
        id: 1101,
        title: "Bundle persistido",
        inclusionTypeId: 1,
        items: [
          {
            id: 5001,
            providerId: 201,
            providerName: "Bundles Inc",
            productCode: "BUNDLE-A",
            productDescription: "Bundle A",
            itemType: "grupo_productos",
            bundleParentItemId: null,
            bundleOriginType: "price_list_bundle",
            sourceProviderPriceListItemId: 301,
            sourceComponentPriceListItemId: null,
            quantity: 1,
            originalCurrencyCode: "USD",
            originalListPriceUnit: 0,
            listPriceUnit: 0,
            manufacturerDiscountPct: 0,
            importCostPct: 0,
            profitMarginPct: 0,
            finalDiscountPct: 0,
            displayOrder: 1,
            bundleSortOrder: null,
          },
          {
            id: 5002,
            providerId: 201,
            providerName: "Bundles Inc",
            productCode: "A-COMP-1",
            productDescription: "Componente A1",
            itemType: "producto",
            bundleParentItemId: 5001,
            bundleOriginType: "price_list_bundle",
            sourceProviderPriceListItemId: null,
            sourceComponentPriceListItemId: 401,
            quantity: 2,
            originalCurrencyCode: "USD",
            originalListPriceUnit: 10,
            listPriceUnit: 10,
            manufacturerDiscountPct: 0,
            importCostPct: 0,
            profitMarginPct: 0,
            finalDiscountPct: 0,
            displayOrder: 2,
            bundleSortOrder: 1,
          },
          {
            id: 5003,
            providerId: 201,
            providerName: "Bundles Inc",
            productCode: "A-COMP-2",
            productDescription: "Componente A2",
            itemType: "producto",
            bundleParentItemId: 5001,
            bundleOriginType: "price_list_bundle",
            sourceProviderPriceListItemId: null,
            sourceComponentPriceListItemId: 402,
            quantity: 1,
            originalCurrencyCode: "USD",
            originalListPriceUnit: 20,
            listPriceUnit: 20,
            manufacturerDiscountPct: 0,
            importCostPct: 0,
            profitMarginPct: 0,
            finalDiscountPct: 0,
            displayOrder: 3,
            bundleSortOrder: 2,
          },
        ],
      },
    ],
  };
  let historicalQuotationVersion = {
    ...quotationVersion,
    id: 1000,
    versionNumber: 0,
    isLatestVersion: false,
    proposalName: "Oportunidad Demo v0",
    introduction: "Version previa demo",
    quotationDate: "2026-04-18",
    actions: [{ code: "modificar", name: "Modificar", allowed: true }],
  };
  quotationVersion = {
    ...quotationVersion,
    ...quotationVersionOverrides,
  };
  quotations[0] = {
    ...quotations[0],
    latestVersionId: Number(
      quotationVersion.latestVersionId || quotationVersion.id || 1001,
    ),
    latestVersionNumber:
      quotationVersion.latestVersionNumber ?? quotationVersion.versionNumber,
    latestStatusCode:
      quotationVersion.latestStatusCode ?? quotationVersion.statusCode,
    latestStatusName:
      quotationVersion.latestStatusName ?? quotationVersion.statusName,
    latestTotalSaleAmount: calculateMockQuotationTotal(quotationVersion),
    ...quotationOverrides,
  };
  let nextQuotationSectionId = 1201;
  let nextQuotationItemId = 6001;

  function buildQuotationVersionSummary(version) {
    return {
      id: Number(version.id),
      versionNumber: Number(version.versionNumber || 0),
      quotationDate: version.quotationDate || null,
      statusCode: version.statusCode || "",
      statusName: version.statusName || "",
      statusUiKey: version.statusUiKey || null,
      isLatestVersion: Boolean(version.isLatestVersion),
    };
  }

  function buildQuotationDetailsResponse() {
    return {
      id: quotations[0].id,
      latestVersionId: Number(
        quotations[0].latestVersionId || quotationVersion.id,
      ),
      versions: [quotationVersion, historicalQuotationVersion]
        .map((version) => buildQuotationVersionSummary(version))
        .sort((leftVersion, rightVersion) => {
          if (leftVersion.versionNumber !== rightVersion.versionNumber) {
            return rightVersion.versionNumber - leftVersion.versionNumber;
          }

          return rightVersion.id - leftVersion.id;
        }),
    };
  }
  const quotationProducts = [
    {
      id: 211,
      providerId: 201,
      providerName: "Bundles Inc",
      code: "PROD-1",
      description: "Producto 1",
      itemType: "producto",
      price: "100",
      currencySymbol: "$",
      components: [],
    },
    {
      id: 212,
      providerId: 201,
      providerName: "Bundles Inc",
      code: "PROD-2",
      description: "Producto 2",
      itemType: "producto",
      price: "200",
      currencySymbol: "$",
      components: [],
    },
    {
      id: 213,
      providerId: 201,
      providerName: "Bundles Inc",
      code: "PROD-3",
      description: "Producto 3",
      itemType: "producto",
      price: "300",
      currencySymbol: "$",
      components: [],
    },
    {
      id: 214,
      providerId: 201,
      providerName: "Bundles Inc",
      code: "SERV-1",
      description: "Servicio 1",
      itemType: "servicio_propio",
      price: "50",
      currencySymbol: "$",
      components: [],
    },
    {
      id: 301,
      providerId: 201,
      providerName: "Bundles Inc",
      code: "BUNDLE-A",
      description: "Bundle A",
      itemType: "grupo_productos",
      price: "0",
      currencySymbol: "$",
      components: [
        {
          componentItemId: 401,
          providerId: 201,
          code: "A-COMP-1",
          description: "Componente A1",
          itemType: "producto",
          unitPriceOverride: "11",
          price: "10",
        },
        {
          componentItemId: 402,
          providerId: 201,
          code: "A-COMP-2",
          description: "Componente A2",
          itemType: "producto",
          price: "20",
        },
      ],
    },
    {
      id: 302,
      providerId: 201,
      providerName: "Bundles Inc",
      code: "BUNDLE-B",
      description: "Bundle B",
      itemType: "grupo_productos",
      price: "0",
      currencySymbol: "$",
      components: [
        {
          componentItemId: 403,
          providerId: 201,
          code: "B-COMP-1",
          description: "Componente B1",
          itemType: "producto",
          price: "15",
        },
        {
          componentItemId: 404,
          providerId: 201,
          code: "B-COMP-2",
          description: "Componente B2",
          itemType: "producto",
          price: "25",
        },
      ],
    },
  ];

  async function fulfillJson(route, body, status = 200) {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  }

  function buildMockSectionItemsFromFullSave(items = []) {
    const persistedIdByLocalId = new Map();

    const normalizedItems = items.map((item, index) => {
      const persistedId = item.id ? Number(item.id) : nextQuotationItemId++;
      persistedIdByLocalId.set(
        String(item.localId || persistedId),
        persistedId,
      );

      return {
        id: persistedId,
        providerId: Number(item.providerId || 0),
        providerName:
          providers.find(
            (provider) => Number(provider.id) === Number(item.providerId || 0),
          )?.name || "",
        productCode: item.productCode || "",
        productDescription: item.productDescription || "",
        itemType: item.itemType || "producto",
        bundleParentItemId: null,
        bundleOriginType: item.bundleOriginType || null,
        sourceProviderPriceListItemId:
          item.sourceProviderPriceListItemId || null,
        sourceComponentPriceListItemId:
          item.sourceComponentPriceListItemId || null,
        quantity: Number(item.quantity || 0),
        originalCurrencyCode: item.originalCurrencyCode || "USD",
        originalListPriceUnit: Number(
          item.originalListPriceUnit ?? item.listPriceUnit ?? 0,
        ),
        listPriceUnit: Number(item.listPriceUnit || 0),
        manufacturerDiscountPct: Number(item.manufacturerDiscountPct || 0),
        importCostPct: Number(item.importCostPct || 0),
        profitMarginPct: Number(item.profitMarginPct || 0),
        finalDiscountPct: Number(item.finalDiscountPct || 0),
        displayOrder: Number(item.displayOrder || index + 1),
        bundleSortOrder: item.bundleSortOrder || null,
        localId: String(item.localId || persistedId),
        bundleParentLocalId: item.bundleParentLocalId || null,
      };
    });

    return normalizedItems.map((item) => ({
      ...item,
      bundleParentItemId: item.bundleParentLocalId
        ? persistedIdByLocalId.get(String(item.bundleParentLocalId)) || null
        : null,
    }));
  }

  function applyMockFullSavePayload(payload) {
    const normalizedSections = (payload.sections || []).map(
      (section, index) => ({
        id: section.id ? Number(section.id) : nextQuotationSectionId++,
        title: section.title || `Seccion ${index + 1}`,
        inclusionTypeId: Number(section.inclusionTypeId || 1),
        items: buildMockSectionItemsFromFullSave(section.items || []),
        displayOrder: Number(section.displayOrder || index + 1),
      }),
    );

    quotationVersion = {
      ...quotationVersion,
      ...payload,
      exchangeRate:
        payload.exchangeRate == null ? null : Number(payload.exchangeRate),
      sections: normalizedSections,
    };

    quotations[0] = {
      ...quotations[0],
      latestProposalName:
        payload.proposalName || quotations[0].latestProposalName,
      latestQuotationDate:
        payload.quotationDate || quotations[0].latestQuotationDate,
      latestTotalSaleAmount: calculateMockQuotationTotal(quotationVersion),
    };
  }

  function applyTransition(actionCode) {
    const nextStatusByActionCode = {
      solicitar_aprobacion: {
        statusCode: "en_aprobacion",
        statusName: "En aprobacion",
      },
      aprobar: {
        statusCode: "aprobada",
        statusName: "Aprobada",
      },
      rechazar: {
        statusCode: "rechazada",
        statusName: "Rechazada",
      },
      enviar: {
        statusCode: "enviada",
        statusName: "Enviada",
      },
      declarar_ganada: {
        statusCode: "ganada",
        statusName: "Ganada",
      },
      declarar_perdida: {
        statusCode: "perdida",
        statusName: "Perdida",
      },
      declarar_anulada: {
        statusCode: "anulada",
        statusName: "Anulada",
      },
      ponerla_borrador: {
        statusCode: "borrador",
        statusName: "Borrador",
      },
      aceptar: {
        statusCode: "aceptada",
        statusName: "Aceptada",
      },
    };

    const nextStatus = nextStatusByActionCode[actionCode];
    if (!nextStatus) {
      return null;
    }

    quotationVersion = {
      ...quotationVersion,
      ...nextStatus,
    };
    quotations[0] = {
      ...quotations[0],
      latestStatusCode: nextStatus.statusCode,
      latestStatusName: nextStatus.statusName,
    };

    return nextStatus;
  }

  return async function handleRoute(route) {
    const url = new URL(route.request().url());
    const { pathname, searchParams } = url;

    if (pathname === "/api/auth/bootstrap-status") {
      await fulfillJson(route, { hasUsers: true });
      return;
    }

    if (pathname === "/api/auth/me") {
      await fulfillJson(route, user);
      return;
    }

    if (pathname === "/api/quotation-accounts") {
      await fulfillJson(route, accounts);
      return;
    }

    if (pathname === "/api/quotation-accounts/1/opportunities") {
      await fulfillJson(route, opportunities);
      return;
    }

    if (pathname === "/api/quotation-accounts/1/contacts") {
      await fulfillJson(route, contacts);
      return;
    }

    if (pathname === "/api/catalogs/quotation-section-inclusion-types") {
      await fulfillJson(route, inclusionTypes);
      return;
    }

    if (pathname === "/api/catalogs/quotation-delivery-times") {
      await fulfillJson(route, deliveryTimes);
      return;
    }

    if (pathname === "/api/catalogs/quotation-validity-terms") {
      await fulfillJson(route, validityTerms);
      return;
    }

    if (pathname === "/api/catalogs/quotation-warranty-terms") {
      await fulfillJson(route, warrantyTerms);
      return;
    }

    if (pathname === "/api/catalogs/quotation-payment-terms") {
      await fulfillJson(route, paymentTerms);
      return;
    }

    if (pathname === "/api/catalogs/quotation-currencies") {
      await fulfillJson(route, currencies);
      return;
    }

    if (pathname === "/api/catalogs/quotation-providers") {
      await fulfillJson(route, providers);
      return;
    }

    if (pathname === "/api/catalogs/quotation-activation-statuses") {
      await fulfillJson(route, activationStatuses);
      return;
    }

    if (pathname === "/api/quotations") {
      await fulfillJson(route, quotations);
      return;
    }

    if (pathname === "/api/quotations/901") {
      await fulfillJson(route, buildQuotationDetailsResponse());
      return;
    }

    if (pathname === "/api/quotation-versions/1001") {
      if (route.request().method() === "PUT") {
        const payload = route.request().postDataJSON();
        onUpdateQuotationVersion?.(payload);
        quotationVersion = {
          ...quotationVersion,
          ...payload,
          exchangeRate:
            payload.exchangeRate == null ? null : Number(payload.exchangeRate),
        };
        await fulfillJson(route, { message: "Version actualizada" });
        return;
      }

      await fulfillJson(route, quotationVersion);
      return;
    }

    if (pathname === "/api/quotation-versions/1000") {
      await fulfillJson(route, historicalQuotationVersion);
      return;
    }

    if (
      pathname === "/api/quotation-versions/1001/full" &&
      route.request().method() === "PUT"
    ) {
      const payload = route.request().postDataJSON();
      onUpdateQuotationVersion?.(payload);
      applyMockFullSavePayload(payload);
      await fulfillJson(route, {
        ...quotationVersion,
        message: "Version actualizada",
      });
      return;
    }

    if (
      pathname === "/api/quotation-versions/1001/transition" &&
      route.request().method() === "POST"
    ) {
      const payload = route.request().postDataJSON();
      const nextStatus = applyTransition(payload.actionCode);
      await fulfillJson(route, {
        message: nextStatus
          ? `Cotizacion movida a ${nextStatus.statusName}`
          : "Accion ejecutada",
      });
      return;
    }

    if (pathname === "/api/quotation-products/search") {
      const providerId = Number(searchParams.get("providerId") || 0);
      const query = String(searchParams.get("q") || "")
        .trim()
        .toLowerCase();
      const results = quotationProducts.filter((product) => {
        if (providerId && Number(product.providerId) !== providerId) {
          return false;
        }

        if (!query) {
          return true;
        }

        return [product.code, product.description]
          .join(" ")
          .toLowerCase()
          .includes(query);
      });

      await fulfillJson(route, results);
      return;
    }

    if (
      pathname === "/api/quotations/render-pdf" &&
      route.request().method() === "POST"
    ) {
      onRenderQuotationPdf?.(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>
endobj
trailer
<< /Root 1 0 R >>
%%EOF`,
      });
      return;
    }

    if (
      pathname === "/api/opportunities/11/quotations" &&
      route.request().method() === "POST"
    ) {
      onCreateQuotation?.(route.request().postDataJSON());
      await fulfillJson(
        route,
        {
          quotationId: 901,
          latestVersionId: 1001,
          message: "Cotizacion creada",
        },
        201,
      );
      return;
    }

    await route.abort();
  };
}

async function openProductPickerForRow(page, rowIndex) {
  const row = page.locator(".quotation-items-table tbody tr").nth(rowIndex);
  await row.locator("td:nth-child(3) input").dblclick();
  const pickerModal = page
    .locator(".modal-dialog")
    .filter({
      has: page.getByRole("heading", { name: "Seleccionar producto" }),
    })
    .first();

  await expect(
    pickerModal.getByRole("heading", { name: "Seleccionar producto" }),
  ).toBeVisible();
  await pickerModal.locator("select").first().selectOption("201");
}

async function chooseProduct(page, code) {
  const pickerRow = page
    .locator(".quotation-product-picker-table tbody tr")
    .filter({ hasText: code })
    .first();
  await expect(pickerRow).toBeVisible();
  await pickerRow.getByRole("button", { name: "Seleccionar producto" }).click();
}

async function selectProductPickerProvider(page, providerId = "201") {
  const pickerModal = page.locator(".quotation-product-picker-modal").first();
  await expect(pickerModal).toBeVisible();
  await pickerModal.locator("select").first().selectOption(providerId);
}

async function openQuotationPdfPreview(page, editModal) {
  await editModal.getByRole("button", { name: "Vista previa" }).click();

  const previewModal = page.locator(".quotation-print-preview-modal").first();
  await expect(previewModal).toBeVisible();

  const popupPromise = page.waitForEvent("popup");
  await previewModal.getByRole("button", { name: "Abrir PDF" }).click();
  const printPage = await popupPromise;

  return { previewModal, printPage };
}

async function getQuotationRowCodes(page) {
  return page
    .locator(".quotation-items-table tbody tr td:nth-child(3) input")
    .evaluateAll((inputs) => inputs.map((input) => input.value));
}

async function getQuotationRowNumbers(page) {
  return page
    .locator(".quotation-items-table tbody tr td:nth-child(2)")
    .evaluateAll((cells) =>
      cells.map((cell) => cell.textContent?.trim() || ""),
    );
}

function getQuotationRowByCode(page, code) {
  return page
    .locator(".quotation-items-table tbody tr")
    .filter({
      has: page.locator(`td:nth-child(3) input[value="${code}"]`),
    })
    .first();
}

async function openCreateQuotationModal(page) {
  await page.goto("/quotations");

  await expect(
    page.getByRole("heading", { name: "Cotizaciones" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "+ Crear cotizacion" }).click();

  const createModal = page
    .locator(".modal-dialog")
    .filter({ has: page.getByRole("heading", { name: "Crear cotizacion" }) })
    .first();

  await expect(
    createModal.getByRole("heading", { name: "Crear cotizacion" }),
  ).toBeVisible();

  await createModal
    .getByRole("combobox", { name: "Selecciona o busca cuenta" })
    .fill("Cuenta Demo");
  await createModal.locator("select").first().selectOption("11");
  await createModal
    .getByRole("button", { name: "Ingresar datos de la cotizacion" })
    .click();

  await createModal
    .getByRole("button", { name: "Agregar seccion inicial" })
    .click();

  return createModal;
}

async function openEditQuotationModal(page, { versionId } = {}) {
  await page.goto("/quotations");

  await expect(
    page.getByRole("heading", { name: "Cotizaciones" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Abrir acciones" }).first().click();

  if (versionId) {
    await page
      .locator(".quotation-actions-menu-select")
      .selectOption(String(versionId));
  }

  await page.getByRole("button", { name: "Editar cotizacion" }).click();

  const editModal = page
    .locator(".modal-dialog")
    .filter({ has: page.getByRole("heading", { name: "Editar cotizacion" }) })
    .first();

  await expect(
    editModal.getByRole("heading", { name: "Editar cotizacion" }),
  ).toBeVisible();

  return editModal;
}

async function dismissDirtyStateDialog(page, expectedMessageFragment) {
  const dialogPromise = page.waitForEvent("dialog");
  return dialogPromise.then(async (dialog) => {
    expect(dialog.message()).toContain(expectedMessageFragment);
    await dialog.dismiss();
  });
}

async function acceptDirtyStateDialog(page, expectedMessageFragment) {
  const dialogPromise = page.waitForEvent("dialog");
  return dialogPromise.then(async (dialog) => {
    expect(dialog.message()).toContain(expectedMessageFragment);
    await dialog.accept();
  });
}

async function addBundleRow(page, createModal, rowIndex, bundleCode) {
  await createModal.getByRole("button", { name: "Agregar fila" }).click();
  await openProductPickerForRow(page, rowIndex);
  await chooseProduct(page, bundleCode);
}

async function addProductRow(page, createModal, rowIndex, productCode) {
  await createModal.getByRole("button", { name: "Agregar fila" }).click();
  await openProductPickerForRow(page, rowIndex);
  await chooseProduct(page, productCode);
}

async function addEditProductRow(page, editModal, productCode) {
  await editModal.getByRole("button", { name: "Agregar fila" }).click();

  const newRow = page.locator(".quotation-items-table tbody tr").last();
  await newRow.locator("td:nth-child(3) input").dblclick();

  const pickerModal = page
    .locator(".modal-dialog")
    .filter({
      has: page.getByRole("heading", { name: "Seleccionar producto" }),
    })
    .first();
  await expect(
    pickerModal.getByRole("heading", { name: "Seleccionar producto" }),
  ).toBeVisible();
  await pickerModal
    .locator(".quotation-product-picker-search input")
    .fill(productCode);

  await chooseProduct(page, productCode);
}

async function toggleBundleComponents(page, bundleCode) {
  const bundleRow = page
    .locator(".quotation-items-table tbody tr")
    .filter({
      has: page.locator(`td:nth-child(3) input[value="${bundleCode}"]`),
    })
    .first();

  await bundleRow.locator(".quotation-bundle-toggle-button").click();
}

async function getQuotationRowBackgrounds(page) {
  return page
    .locator(".quotation-items-table tbody tr")
    .evaluateAll((rows) =>
      rows.map((row) => getComputedStyle(row.cells[0]).backgroundColor),
    );
}

async function getQuotationSummaryRowValues(createModal, label) {
  const row = createModal
    .locator(".quotation-summary-table tbody tr")
    .filter({ hasText: label })
    .first();

  await expect(row).toBeVisible();

  return row
    .locator("td")
    .evaluateAll((cells) =>
      cells.map((cell) => cell.textContent?.trim() || ""),
    );
}

async function hasQuotationSummaryRow(createModal, label) {
  return createModal
    .locator(".quotation-summary-table tbody tr")
    .filter({ hasText: label })
    .count();
}

test.describe("quotations", () => {
  test("muestra estado y flujo con una accion principal en la edicion", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const editModal = await openEditQuotationModal(page);

    await expect(
      editModal.getByRole("heading", { name: "Estado y flujo" }),
    ).toBeVisible();
    await expect(editModal.getByText("Siguiente paso:")).toBeVisible();
    await expect(
      editModal.getByRole("button", { name: "Solicitar aprobacion" }),
    ).toBeVisible();

    await editModal
      .getByRole("button", { name: "Solicitar aprobacion" })
      .click();

    await expect(editModal.getByText("En aprobacion").first()).toBeVisible();
  });

  test("muestra mensaje de solo lectura del flujo para una version historica", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route(
      "**/api/**",
      createQuotationsFixture({
        quotationVersionOverrides: {
          id: 1001,
          versionNumber: 1,
          statusCode: "aprobada",
          statusName: "Aprobada",
          isLatestVersion: false,
          actions: [{ code: "modificar", name: "Modificar", allowed: true }],
        },
      }),
    );

    const editModal = await openEditQuotationModal(page);

    await expect(
      editModal.getByText(
        "Version historica: el flujo se gestiona sobre la version mayor actual.",
      ),
    ).toBeVisible();
    await expect(
      editModal.getByText(
        "Puedes corregir contenido si tu rol lo permite, pero las transiciones solo aplican sobre la version mayor.",
      ),
    ).toBeVisible();
    await expect(
      editModal.getByText(
        "No hay una accion principal disponible para esta version.",
      ),
    ).toBeVisible();
  });

  test("mantiene juntos los bundles copiados al moverlos sobre otro bundle", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const createModal = await openCreateQuotationModal(page);

    await addBundleRow(page, createModal, 0, "BUNDLE-A");
    await addBundleRow(page, createModal, 3, "BUNDLE-B");

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual([
        "BUNDLE-A",
        "A-COMP-1",
        "A-COMP-2",
        "BUNDLE-B",
        "B-COMP-1",
        "B-COMP-2",
      ]);

    await page
      .locator(".quotation-items-table tbody tr")
      .nth(0)
      .locator("td:first-child input")
      .check();
    await createModal
      .getByRole("button", { name: "Copiar filas seleccionadas" })
      .click();
    await page
      .locator(".quotation-items-table tbody tr")
      .nth(3)
      .locator("td:first-child input")
      .check();
    await createModal
      .getByRole("button", { name: "Pegar filas copiadas" })
      .click();

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual([
        "BUNDLE-A",
        "A-COMP-1",
        "A-COMP-2",
        "BUNDLE-B",
        "B-COMP-1",
        "B-COMP-2",
        "BUNDLE-A",
        "A-COMP-1",
        "A-COMP-2",
      ]);

    await createModal
      .getByRole("button", {
        name: "Subir una posicion las filas seleccionadas",
      })
      .click();

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual([
        "BUNDLE-A",
        "A-COMP-1",
        "A-COMP-2",
        "BUNDLE-A",
        "A-COMP-1",
        "A-COMP-2",
        "BUNDLE-B",
        "B-COMP-1",
        "B-COMP-2",
      ]);
  });

  test("mantiene juntos los bundles duplicados al moverlos sobre otro bundle", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const createModal = await openCreateQuotationModal(page);

    await addBundleRow(page, createModal, 0, "BUNDLE-A");
    await addBundleRow(page, createModal, 3, "BUNDLE-B");

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual([
        "BUNDLE-A",
        "A-COMP-1",
        "A-COMP-2",
        "BUNDLE-B",
        "B-COMP-1",
        "B-COMP-2",
      ]);

    await page
      .locator(".quotation-items-table tbody tr")
      .nth(0)
      .locator("td:first-child input")
      .check();
    await createModal
      .getByRole("button", { name: "Duplicar filas seleccionadas" })
      .click();

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual([
        "BUNDLE-A",
        "A-COMP-1",
        "A-COMP-2",
        "BUNDLE-A",
        "A-COMP-1",
        "A-COMP-2",
        "BUNDLE-B",
        "B-COMP-1",
        "B-COMP-2",
      ]);

    await createModal
      .getByRole("button", {
        name: "Bajar una posicion las filas seleccionadas",
      })
      .click();

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual([
        "BUNDLE-A",
        "A-COMP-1",
        "A-COMP-2",
        "BUNDLE-B",
        "B-COMP-1",
        "B-COMP-2",
        "BUNDLE-A",
        "A-COMP-1",
        "A-COMP-2",
      ]);
  });

  test("permite ocultar y mostrar componentes por bundle individual", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const createModal = await openCreateQuotationModal(page);

    await addBundleRow(page, createModal, 0, "BUNDLE-A");
    await addBundleRow(page, createModal, 3, "BUNDLE-B");

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual([
        "BUNDLE-A",
        "A-COMP-1",
        "A-COMP-2",
        "BUNDLE-B",
        "B-COMP-1",
        "B-COMP-2",
      ]);

    await toggleBundleComponents(page, "BUNDLE-A");

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual(["BUNDLE-A", "BUNDLE-B", "B-COMP-1", "B-COMP-2"]);

    await toggleBundleComponents(page, "BUNDLE-A");

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual([
        "BUNDLE-A",
        "A-COMP-1",
        "A-COMP-2",
        "BUNDLE-B",
        "B-COMP-1",
        "B-COMP-2",
      ]);
  });

  test("permite resaltar filas bajo demanda y quitar ese resaltado despues", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const createModal = await openCreateQuotationModal(page);

    await addProductRow(page, createModal, 0, "PROD-1");
    await addProductRow(page, createModal, 1, "PROD-2");
    await addProductRow(page, createModal, 2, "PROD-3");

    await page
      .locator(".quotation-items-table tbody tr")
      .nth(1)
      .locator("td:first-child input")
      .check();

    await createModal
      .getByRole("button", { name: "Resaltar filas seleccionadas" })
      .click();

    await page
      .locator(".quotation-items-table tbody tr")
      .nth(1)
      .locator("td:first-child input")
      .uncheck();

    await expect
      .poll(() => getQuotationRowBackgrounds(page))
      .toEqual(["rgba(0, 0, 0, 0)", "rgb(169, 212, 231)", "rgba(0, 0, 0, 0)"]);

    await page
      .locator(".quotation-items-table tbody tr")
      .nth(1)
      .locator("td:first-child input")
      .check();

    await createModal
      .getByRole("button", { name: "Quitar resaltado de filas seleccionadas" })
      .click();

    await page
      .locator(".quotation-items-table tbody tr")
      .nth(1)
      .locator("td:first-child input")
      .uncheck();

    await expect
      .poll(() => getQuotationRowBackgrounds(page))
      .toEqual(["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]);
  });

  test("muestra el resumen agregado por productos, servicios y total en creacion", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const createModal = await openCreateQuotationModal(page);

    await addProductRow(page, createModal, 0, "PROD-1");
    await addProductRow(page, createModal, 1, "SERV-1");

    await expect(
      await getQuotationSummaryRowValues(createModal, "Productos"),
    ).toEqual(["Productos", "100.00", "100.00", "0.00"]);
    await expect(
      await getQuotationSummaryRowValues(createModal, "Servicios"),
    ).toEqual(["Servicios", "50.00", "50.00", "0.00"]);
    await expect(
      await getQuotationSummaryRowValues(createModal, "Total"),
    ).toEqual(["Total", "150.00", "150.00", "0.00"]);
    await expect(await hasQuotationSummaryRow(createModal, "Descuento")).toBe(
      0,
    );
  });

  test("aplica un descuento porcentual global en la seccion resumen", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const createModal = await openCreateQuotationModal(page);

    await addProductRow(page, createModal, 0, "PROD-1");
    await addProductRow(page, createModal, 1, "SERV-1");

    await createModal
      .getByRole("spinbutton", { name: "Descuento %" })
      .fill("10");

    await expect(
      await getQuotationSummaryRowValues(createModal, "Descuento"),
    ).toEqual(["Descuento", "", "15.00", ""]);
    await expect(
      await getQuotationSummaryRowValues(createModal, "Total Descontado"),
    ).toEqual(["Total Descontado", "", "135.00", ""]);
  });

  test("permite ingresar un descuento global por valor en la seccion resumen", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const createModal = await openCreateQuotationModal(page);

    await addProductRow(page, createModal, 0, "PROD-1");
    await addProductRow(page, createModal, 1, "SERV-1");

    await createModal.getByRole("radio", { name: "Valor" }).check();
    await createModal.getByLabel("Descuento US$").fill("20");

    await expect(
      await getQuotationSummaryRowValues(createModal, "Descuento"),
    ).toEqual(["Descuento", "", "20.00", ""]);
    await expect(
      await getQuotationSummaryRowValues(createModal, "Total Descontado"),
    ).toEqual(["Total Descontado", "", "130.00", ""]);

    await createModal.getByRole("radio", { name: "Porcentaje" }).check();
    await expect(
      createModal.getByRole("spinbutton", { name: "Descuento %" }),
    ).toHaveValue("13.33");
  });

  test("distribuye el descuento por item y lo incorpora al total sin fila global", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const createModal = await openCreateQuotationModal(page);

    await addProductRow(page, createModal, 0, "PROD-1");
    await addProductRow(page, createModal, 1, "PROD-2");

    await createModal
      .locator(".quotation-summary-discount-field")
      .getByRole("radio", { name: "Por item" })
      .check();
    await createModal
      .getByRole("spinbutton", { name: "Descuento %" })
      .fill("10");

    await expect(await hasQuotationSummaryRow(createModal, "Descuento")).toBe(
      0,
    );
    await expect(
      await getQuotationSummaryRowValues(createModal, "Total"),
    ).toEqual(["Total", "300.00", "270.00", "-11.11"]);

    await expect(
      page
        .locator(".quotation-items-table tbody tr")
        .nth(0)
        .locator("td:nth-child(14) input"),
    ).toHaveValue("10");
    await expect(
      page
        .locator(".quotation-items-table tbody tr")
        .nth(1)
        .locator("td:nth-child(14) input"),
    ).toHaveValue("10");
  });

  test("envia el descuento global del resumen al crear la cotizacion", async ({
    page,
  }) => {
    let capturedCreatePayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.route(
      "**/api/**",
      createQuotationsFixture({
        onCreateQuotation(payload) {
          capturedCreatePayload = payload;
        },
      }),
    );

    const createModal = await openCreateQuotationModal(page);

    await addProductRow(page, createModal, 0, "PROD-1");
    await addProductRow(page, createModal, 1, "SERV-1");
    await createModal.getByRole("radio", { name: "Valor" }).check();
    await createModal.getByLabel("Descuento US$").fill("20");

    await createModal.getByRole("button", { name: "Crear cotizacion" }).click();

    await expect.poll(() => capturedCreatePayload).not.toBeNull();
    expect(capturedCreatePayload.summaryDiscountMode).toBe("amount");
    expect(capturedCreatePayload.summaryDiscountValue).toBe(20);
    expect(capturedCreatePayload.summaryDistributionMode).toBe("total");
    expect(capturedCreatePayload.summaryVatMode).toBe("without_vat");
    expect(capturedCreatePayload.summaryVatPct).toBe(0);
  });

  test("envia el descuento distribuido en finalDiscountPct por item sin descuento global", async ({
    page,
  }) => {
    let capturedCreatePayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.route(
      "**/api/**",
      createQuotationsFixture({
        onCreateQuotation(payload) {
          capturedCreatePayload = payload;
        },
      }),
    );

    const createModal = await openCreateQuotationModal(page);

    await addProductRow(page, createModal, 0, "PROD-1");
    await addProductRow(page, createModal, 1, "PROD-2");
    await createModal
      .locator(".quotation-summary-discount-field")
      .getByRole("radio", { name: "Por item" })
      .check();
    await createModal
      .getByRole("spinbutton", { name: "Descuento %" })
      .fill("10");

    await createModal.getByRole("button", { name: "Crear cotizacion" }).click();

    await expect.poll(() => capturedCreatePayload).not.toBeNull();
    expect(capturedCreatePayload.summaryDiscountMode).toBeNull();
    expect(capturedCreatePayload.summaryDiscountValue).toBeNull();
    expect(capturedCreatePayload.summaryDistributionMode).toBe("per_item");
    expect(capturedCreatePayload.summaryVatMode).toBe("without_vat");
    expect(capturedCreatePayload.summaryVatPct).toBe(0);
    expect(capturedCreatePayload.sections[0].items).toEqual([
      expect.objectContaining({
        productCode: "PROD-1",
        finalDiscountPct: 10,
      }),
      expect.objectContaining({
        productCode: "PROD-2",
        finalDiscountPct: 10,
      }),
    ]);
  });

  test("calcula IVA total sobre el total descontado y agrega filas al resumen", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const createModal = await openCreateQuotationModal(page);

    await addProductRow(page, createModal, 0, "PROD-1");
    await addProductRow(page, createModal, 1, "SERV-1");
    await createModal
      .getByRole("spinbutton", { name: "Descuento %" })
      .fill("10");
    await createModal
      .locator(".quotation-summary-vat-field")
      .getByRole("radio", { name: "Total" })
      .check();

    await expect(
      await getQuotationSummaryRowValues(createModal, "IVA"),
    ).toEqual(["IVA", "", "21.60", ""]);
    await expect(
      await getQuotationSummaryRowValues(createModal, "Total con IVA incluido"),
    ).toEqual(["Total con IVA incluido", "", "156.60", ""]);
  });

  test("envia el modo de IVA del resumen al crear la cotizacion", async ({
    page,
  }) => {
    let capturedCreatePayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.route(
      "**/api/**",
      createQuotationsFixture({
        onCreateQuotation(payload) {
          capturedCreatePayload = payload;
        },
      }),
    );

    const createModal = await openCreateQuotationModal(page);

    await addProductRow(page, createModal, 0, "PROD-1");
    await createModal
      .locator(".quotation-summary-vat-field")
      .getByRole("radio", { name: "Total" })
      .check();

    await createModal.getByRole("button", { name: "Crear cotizacion" }).click();

    await expect.poll(() => capturedCreatePayload).not.toBeNull();
    expect(capturedCreatePayload.summaryDistributionMode).toBe("total");
    expect(capturedCreatePayload.summaryVatMode).toBe("total");
    expect(capturedCreatePayload.summaryVatPct).toBe(16);
  });

  test("envia notas internas al crear la cotizacion", async ({ page }) => {
    let capturedCreatePayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.route(
      "**/api/**",
      createQuotationsFixture({
        onCreateQuotation(payload) {
          capturedCreatePayload = payload;
        },
      }),
    );

    const createModal = await openCreateQuotationModal(page);

    await addProductRow(page, createModal, 0, "PROD-1");
    await createModal
      .locator(".quotation-summary-notes-field textarea")
      .fill("Solo visible internamente para revision comercial.");

    await createModal.getByRole("button", { name: "Crear cotizacion" }).click();

    await expect.poll(() => capturedCreatePayload).not.toBeNull();
    expect(capturedCreatePayload.internalNotes).toBe(
      "Solo visible internamente para revision comercial.",
    );
  });

  test("envia condiciones comerciales al crear la cotizacion", async ({
    page,
  }) => {
    let capturedCreatePayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.route(
      "**/api/**",
      createQuotationsFixture({
        onCreateQuotation(payload) {
          capturedCreatePayload = payload;
        },
      }),
    );

    const createModal = await openCreateQuotationModal(page);

    await addProductRow(page, createModal, 0, "PROD-1");
    await createModal
      .getByLabel("Tiempo de entrega")
      .selectOption({ label: "45 días" });
    await createModal
      .getByLabel("Validez de la cotizacion")
      .selectOption({ label: "60 días" });
    await createModal.getByLabel("Garantia").selectOption({ label: "2 años" });
    await createModal
      .getByLabel("Forma de pago")
      .selectOption({ label: "100% adelantado" });
    await createModal.getByLabel("Moneda").selectOption("EUR");
    await createModal.getByLabel("Tipo de cambio").fill("17.2500");
    await createModal
      .getByLabel("Notas de la cotizacion")
      .fill("Entrega sujeta a confirmacion de fabrica.");

    await createModal.getByRole("button", { name: "Crear cotizacion" }).click();

    await expect.poll(() => capturedCreatePayload).not.toBeNull();
    expect(capturedCreatePayload.deliveryTime).toBe("45_dias");
    expect(capturedCreatePayload.quotationValidity).toBe("60_dias");
    expect(capturedCreatePayload.warranty).toBe("2_anos");
    expect(capturedCreatePayload.paymentTerms).toBe("100_adelantado");
    expect(capturedCreatePayload.currencyCode).toBe("EUR");
    expect(capturedCreatePayload.exchangeRate).toBe(17.25);
    expect(capturedCreatePayload.quotationNotes).toBe(
      "Entrega sujeta a confirmacion de fabrica.",
    );
  });

  test("crea cotizacion usando Precio Lista M.O. como base persistida y listPriceUnit convertido", async ({
    page,
  }) => {
    let capturedCreatePayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.route(
      "**/api/**",
      createQuotationsFixture({
        onCreateQuotation(payload) {
          capturedCreatePayload = payload;
        },
      }),
    );

    const createModal = await openCreateQuotationModal(page);

    await addProductRow(page, createModal, 0, "PROD-1");
    await createModal.getByLabel("Moneda").selectOption("EUR");
    await createModal.getByLabel("Tipo de cambio").fill("18");
    await createModal
      .getByRole("row", { name: /PROD-1/ })
      .getByRole("textbox")
      .nth(2)
      .fill("120");
    await createModal.getByRole("button", { name: "Crear cotizacion" }).click();

    await expect.poll(() => capturedCreatePayload).not.toBeNull();
    expect(capturedCreatePayload.sections[0].items[0]).toMatchObject({
      originalCurrencyCode: "USD",
      originalListPriceUnit: 120,
      listPriceUnit: 2160,
    });
  });

  test("al cargar un bundle en creacion usa el precio override persistido del componente", async ({
    page,
  }) => {
    let capturedCreatePayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.route(
      "**/api/**",
      createQuotationsFixture({
        onCreateQuotation(payload) {
          capturedCreatePayload = payload;
        },
      }),
    );

    const createModal = await openCreateQuotationModal(page);

    await addBundleRow(page, createModal, 0, "BUNDLE-A");
    await createModal.getByRole("button", { name: "Crear cotizacion" }).click();

    await expect.poll(() => capturedCreatePayload).not.toBeNull();
    expect(capturedCreatePayload.sections[0].items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productCode: "A-COMP-1",
          originalCurrencyCode: "USD",
          originalListPriceUnit: 11,
          listPriceUnit: 11,
        }),
      ]),
    );
  });

  test("actualiza Precio de lista al cambiar el tipo de cambio en la creacion", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const createModal = await openCreateQuotationModal(page);

    await addProductRow(page, createModal, 0, "PROD-1");
    await createModal.getByLabel("Moneda").selectOption("EUR");

    const productRow = createModal.getByRole("row", { name: /PROD-1/ });

    await createModal.getByLabel("Tipo de cambio").fill("18");
    await expect(productRow).toContainText("1,800.00");

    await createModal.getByLabel("Tipo de cambio").fill("20");
    await expect(productRow).toContainText("2,000.00");
  });

  test("permite editar condiciones comerciales y bloquea el contexto de oportunidad", async ({
    page,
  }) => {
    let capturedUpdatePayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.route(
      "**/api/**",
      createQuotationsFixture({
        onUpdateQuotationVersion(payload) {
          capturedUpdatePayload = payload;
        },
      }),
    );

    const editModal = await openEditQuotationModal(page);

    await expect(
      editModal.getByRole("heading", { name: "Secciones" }),
    ).toBeVisible();
    await expect(
      editModal.locator(".quotation-items-table").first(),
    ).toBeVisible();

    await expect(editModal.getByLabel("Cuenta")).toHaveValue("Cuenta Demo");
    await expect(editModal.getByLabel("Cuenta")).toBeDisabled();
    await expect(editModal.getByLabel("Oportunidad")).toHaveValue(
      "Oportunidad Demo",
    );
    await expect(editModal.getByLabel("Oportunidad")).toBeDisabled();
    const sellerInput = editModal
      .locator(".field-group")
      .filter({ hasText: "Vendedor" })
      .locator("input")
      .first();
    await expect(sellerInput).toHaveValue("Demo Seller");
    await expect(sellerInput).toHaveJSProperty("readOnly", true);

    await editModal
      .getByLabel("Tiempo de entrega")
      .selectOption({ label: "45 días" });
    await editModal
      .getByLabel("Validez de la cotizacion")
      .selectOption({ label: "60 días" });
    await editModal.getByLabel("Garantia").selectOption({ label: "2 años" });
    await editModal
      .getByLabel("Forma de pago")
      .selectOption({ label: "100% adelantado" });
    await editModal.getByLabel("Moneda").selectOption("EUR");
    await editModal.getByLabel("Tipo de cambio").fill("17.2500");
    await editModal
      .getByLabel("Notas de la cotizacion")
      .fill("Entrega actualizada segun stock disponible.");
    await editModal
      .getByLabel("Notas internas")
      .fill("Revision interna de margen aprobada.");

    await editModal
      .getByRole("button", { name: "Guardar como version actual" })
      .click();

    await expect.poll(() => capturedUpdatePayload).not.toBeNull();
    expect(capturedUpdatePayload.deliveryTime).toBe("45_dias");
    expect(capturedUpdatePayload.quotationValidity).toBe("60_dias");
    expect(capturedUpdatePayload.warranty).toBe("2_anos");
    expect(capturedUpdatePayload.paymentTerms).toBe("100_adelantado");
    expect(capturedUpdatePayload.currencyCode).toBe("EUR");
    expect(capturedUpdatePayload.exchangeRate).toBe(17.25);
    expect(capturedUpdatePayload.quotationNotes).toBe(
      "Entrega actualizada segun stock disponible.",
    );
    expect(capturedUpdatePayload.internalNotes).toBe(
      "Revision interna de margen aprobada.",
    );
  });

  test("edita cotizacion usando Precio Lista M.O. como base persistida y listPriceUnit convertido", async ({
    page,
  }) => {
    let capturedUpdatePayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.route(
      "**/api/**",
      createQuotationsFixture({
        onUpdateQuotationVersion(payload) {
          capturedUpdatePayload = payload;
        },
      }),
    );

    const editModal = await openEditQuotationModal(page);

    await editModal.getByLabel("Moneda").selectOption("EUR");
    await editModal.getByLabel("Tipo de cambio").fill("2");
    await editModal
      .getByRole("row", { name: /A-COMP-1/ })
      .getByRole("textbox")
      .nth(2)
      .fill("11");
    await editModal
      .getByRole("button", { name: "Guardar como version actual" })
      .click();

    await expect.poll(() => capturedUpdatePayload).not.toBeNull();
    expect(capturedUpdatePayload.sections[0].items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productCode: "A-COMP-1",
          originalCurrencyCode: "USD",
          originalListPriceUnit: 11,
          listPriceUnit: 22,
        }),
      ]),
    );
  });

  test("en edicion permite salir del editor de descripcion con clic fuera o Escape", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const editModal = await openEditQuotationModal(page);
    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual(["BUNDLE-A", "A-COMP-1", "A-COMP-2"]);

    const componentRow = editModal.getByRole("row", { name: /A-COMP-1/ });
    const descriptionInput = componentRow.locator("td:nth-child(4) input");
    const descriptionEditor = editModal.locator(
      ".quotation-description-editor-popover",
    );

    await descriptionInput.click();
    await expect(descriptionEditor).toBeVisible();

    await editModal.getByRole("heading", { name: "Editar cotizacion" }).click();
    await expect(descriptionEditor).toBeHidden();

    await descriptionInput.click();
    await expect(descriptionEditor).toBeVisible();

    await descriptionEditor.locator("textarea").press("Escape");
    await expect(descriptionEditor).toBeHidden();
  });

  test("en edicion mantiene cambios locales hasta guardar la version completa", async ({
    page,
  }) => {
    let capturedUpdatePayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.route(
      "**/api/**",
      createQuotationsFixture({
        onUpdateQuotationVersion(payload) {
          capturedUpdatePayload = payload;
        },
      }),
    );

    let editModal = await openEditQuotationModal(page);

    const sectionTitleInput = editModal
      .locator(".field-group")
      .filter({ hasText: "Titulo" })
      .locator("input")
      .first();
    await sectionTitleInput.fill("Bundle persistido local");

    const existingRow = editModal
      .locator(".quotation-items-table tbody tr")
      .nth(1);
    const quantityInput = existingRow.locator("td:nth-child(5) input").first();
    await quantityInput.fill("4");

    const dismissEditDialog = dismissDirtyStateDialog(
      page,
      "Tienes cambios sin guardar en la cotizacion actual",
    );
    await page.locator(".modal-overlay").click({ position: { x: 8, y: 8 } });
    await dismissEditDialog;

    await expect(
      editModal
        .locator(".field-group")
        .filter({ hasText: "Titulo" })
        .locator("input")
        .first(),
    ).toHaveValue("Bundle persistido local");
    await expect(
      editModal
        .locator(".quotation-items-table tbody tr")
        .nth(1)
        .locator("td:nth-child(5) input"),
    ).toHaveValue("4");

    const acceptEditDialog = acceptDirtyStateDialog(
      page,
      "Tienes cambios sin guardar en la cotizacion actual",
    );
    await page.locator(".modal-overlay").click({ position: { x: 8, y: 8 } });
    await acceptEditDialog;

    editModal = await openEditQuotationModal(page);

    await expect(
      editModal
        .locator(".field-group")
        .filter({ hasText: "Titulo" })
        .locator("input")
        .first(),
    ).toHaveValue("Bundle persistido");
    await expect(
      editModal
        .locator(".quotation-items-table tbody tr")
        .nth(1)
        .locator("td:nth-child(5) input"),
    ).toHaveValue("2");

    await editModal
      .locator(".field-group")
      .filter({ hasText: "Titulo" })
      .locator("input")
      .first()
      .fill("Bundle persistido final");
    await editModal
      .locator(".quotation-items-table tbody tr")
      .nth(1)
      .locator("td:nth-child(5) input")
      .fill("4");

    await editModal
      .getByRole("button", { name: "Guardar como version actual" })
      .click();

    await expect.poll(() => capturedUpdatePayload).not.toBeNull();
    expect(capturedUpdatePayload.sections[0].title).toBe(
      "Bundle persistido final",
    );
    expect(
      capturedUpdatePayload.sections[0].items.find(
        (item) => Number(item.id) === 5002,
      )?.quantity,
    ).toBe(4);

    await page.locator(".modal-overlay").click({ position: { x: 8, y: 8 } });

    editModal = await openEditQuotationModal(page);

    await expect(
      editModal
        .locator(".field-group")
        .filter({ hasText: "Titulo" })
        .locator("input")
        .first(),
    ).toHaveValue("Bundle persistido final");
    await expect(
      editModal
        .locator(".quotation-items-table tbody tr")
        .nth(1)
        .locator("td:nth-child(5) input"),
    ).toHaveValue("4");
  });

  test("en edicion refresca el importe del listado al guardar como version actual", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const editModal = await openEditQuotationModal(page);

    const quotationRow = page.locator("tbody tr").filter({
      has: page.getByText("Oportunidad Demo", { exact: true }),
    });
    await expect(quotationRow.locator("td").nth(5)).toHaveText(/USD\s*40/);

    await editModal
      .locator(".quotation-items-table tbody tr")
      .nth(1)
      .locator("td:nth-child(5) input")
      .fill("4");

    await editModal
      .getByRole("button", { name: "Guardar como version actual" })
      .click();

    await expect(editModal.getByText(/Version actualizada/i)).toBeVisible();
    await expect(quotationRow.locator("td").nth(5)).toHaveText(/USD\s*60/);
  });

  test("en edicion permite ocultar y mostrar componentes por bundle individual", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const editModal = await openEditQuotationModal(page);

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual(["BUNDLE-A", "A-COMP-1", "A-COMP-2"]);

    await toggleBundleComponents(page, "BUNDLE-A");

    await expect.poll(() => getQuotationRowCodes(page)).toEqual(["BUNDLE-A"]);
    await expect.poll(() => getQuotationRowNumbers(page)).toEqual(["1"]);

    await toggleBundleComponents(page, "BUNDLE-A");

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual(["BUNDLE-A", "A-COMP-1", "A-COMP-2"]);
    await expect
      .poll(() => getQuotationRowNumbers(page))
      .toEqual(["1", "2", "3"]);

    await expect(editModal).toBeVisible();
  });

  test("en edicion abre una vista previa dedicada con cambios locales y conserva el estado", async ({
    page,
  }) => {
    let renderedPdfPayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.context().route(
      "**/api/**",
      createQuotationsFixture({
        onRenderQuotationPdf(payload) {
          renderedPdfPayload = payload;
        },
      }),
    );

    const editModal = await openEditQuotationModal(page);

    await editModal
      .locator(".quotation-items-table tbody tr")
      .nth(1)
      .locator("td:nth-child(5) input")
      .fill("4");
    await editModal
      .getByLabel("Notas de la cotizacion")
      .fill("Vista previa con notas locales.");

    const { printPage } = await openQuotationPdfPreview(page, editModal);
    await expect
      .poll(() => renderedPdfPayload?.notes || "")
      .toBe("Vista previa con notas locales.");
    await expect
      .poll(() => renderedPdfPayload?.header?.accountName || "")
      .toBe("Cuenta Demo");
    await expect
      .poll(() => renderedPdfPayload?.header?.contactEmail || "")
      .toBe("");
    await expect
      .poll(() => renderedPdfPayload?.header?.sellerEmail || "")
      .toBe("");
    await expect
      .poll(() => renderedPdfPayload?.sections?.[0]?.subtotal ?? null)
      .toBe(60);
    await expect
      .poll(
        () =>
          renderedPdfPayload?.sections?.[0]?.rows?.map(
            (row) => row.productCode,
          ) || [],
      )
      .toEqual(["BUNDLE-A", "A-COMP-1", "A-COMP-2"]);
    await expect
      .poll(
        () =>
          renderedPdfPayload?.sections?.[0]?.rows?.find(
            (row) => row.productCode === "A-COMP-1",
          )?.quantityDisplay ?? null,
      )
      .toBe("4.00");
    await expect(printPage).not.toBeNull();

    await expect(
      editModal
        .locator(".quotation-items-table tbody tr")
        .nth(1)
        .locator("td:nth-child(5) input"),
    ).toHaveValue("4");
    await expect(editModal.getByLabel("Notas de la cotizacion")).toHaveValue(
      "Vista previa con notas locales.",
    );

    await printPage.close();
  });

  test("en edicion la vista previa siempre incluye el padre del bundle y solo muestra componentes si esta expandido", async ({
    page,
  }) => {
    let renderedPdfPayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.context().route(
      "**/api/**",
      createQuotationsFixture({
        onRenderQuotationPdf(payload) {
          renderedPdfPayload = payload;
        },
      }),
    );

    const editModal = await openEditQuotationModal(page);

    const { printPage: firstPrintPage } = await openQuotationPdfPreview(
      page,
      editModal,
    );

    await expect
      .poll(
        () =>
          renderedPdfPayload?.sections?.[0]?.rows?.map(
            (row) => row.productCode,
          ) || [],
      )
      .toEqual(["BUNDLE-A", "A-COMP-1", "A-COMP-2"]);

    await firstPrintPage.close();

    await toggleBundleComponents(page, "BUNDLE-A");

    const { printPage: secondPrintPage } = await openQuotationPdfPreview(
      page,
      editModal,
    );

    await expect
      .poll(
        () =>
          renderedPdfPayload?.sections?.[0]?.rows?.map(
            (row) => row.productCode,
          ) || [],
      )
      .toEqual(["BUNDLE-A"]);

    await secondPrintPage.close();
  });

  test("en edicion la vista previa incluye el padre del bundle en cada tabla", async ({
    page,
  }) => {
    let renderedPdfPayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.context().route(
      "**/api/**",
      createQuotationsFixture({
        quotationVersionOverrides: {
          sections: [
            {
              id: 1101,
              title: "Tabla A",
              inclusionTypeId: 1,
              items: [
                {
                  id: 5001,
                  providerId: 201,
                  providerName: "Bundles Inc",
                  productCode: "BUNDLE-A",
                  productDescription: "Bundle A",
                  itemType: "grupo_productos",
                  bundleParentItemId: null,
                  bundleOriginType: "price_list_bundle",
                  sourceProviderPriceListItemId: 301,
                  sourceComponentPriceListItemId: null,
                  quantity: 1,
                  listPriceUnit: 0,
                  manufacturerDiscountPct: 0,
                  importCostPct: 0,
                  profitMarginPct: 0,
                  finalDiscountPct: 0,
                  displayOrder: 1,
                  bundleSortOrder: null,
                },
                {
                  id: 5002,
                  providerId: 201,
                  providerName: "Bundles Inc",
                  productCode: "A-COMP-1",
                  productDescription: "Componente A1",
                  itemType: "producto",
                  bundleParentItemId: 5001,
                  bundleOriginType: "price_list_bundle",
                  sourceProviderPriceListItemId: null,
                  sourceComponentPriceListItemId: 401,
                  quantity: 2,
                  listPriceUnit: 10,
                  manufacturerDiscountPct: 0,
                  importCostPct: 0,
                  profitMarginPct: 0,
                  finalDiscountPct: 0,
                  displayOrder: 2,
                  bundleSortOrder: 1,
                },
              ],
            },
            {
              id: 1102,
              title: "Tabla B",
              inclusionTypeId: 1,
              items: [
                {
                  id: 5101,
                  providerId: 201,
                  providerName: "Bundles Inc",
                  productCode: "BUNDLE-B",
                  productDescription: "Bundle B",
                  itemType: "grupo_productos",
                  bundleParentItemId: null,
                  bundleOriginType: "price_list_bundle",
                  sourceProviderPriceListItemId: 302,
                  sourceComponentPriceListItemId: null,
                  quantity: 1,
                  listPriceUnit: 0,
                  manufacturerDiscountPct: 0,
                  importCostPct: 0,
                  profitMarginPct: 0,
                  finalDiscountPct: 0,
                  displayOrder: 1,
                  bundleSortOrder: null,
                },
                {
                  id: 5102,
                  providerId: 201,
                  providerName: "Bundles Inc",
                  productCode: "B-COMP-1",
                  productDescription: "Componente B1",
                  itemType: "producto",
                  bundleParentItemId: 5101,
                  bundleOriginType: "price_list_bundle",
                  sourceProviderPriceListItemId: null,
                  sourceComponentPriceListItemId: 403,
                  quantity: 3,
                  listPriceUnit: 15,
                  manufacturerDiscountPct: 0,
                  importCostPct: 0,
                  profitMarginPct: 0,
                  finalDiscountPct: 0,
                  displayOrder: 2,
                  bundleSortOrder: 1,
                },
              ],
            },
          ],
        },
        onRenderQuotationPdf(payload) {
          renderedPdfPayload = payload;
        },
      }),
    );

    const editModal = await openEditQuotationModal(page);

    const { printPage } = await openQuotationPdfPreview(page, editModal);

    await expect
      .poll(
        () =>
          renderedPdfPayload?.sections?.map((section) => ({
            title: section.title,
            rows: (section.rows || []).map((row) => row.productCode),
          })) || [],
      )
      .toEqual([
        { title: "Tabla A", rows: ["BUNDLE-A", "A-COMP-1"] },
        { title: "Tabla B", rows: ["BUNDLE-B", "B-COMP-1"] },
      ]);

    await printPage.close();
  });

  test("en edicion la vista previa incluye el padre del bundle en una segunda tabla creada localmente", async ({
    page,
  }) => {
    let renderedPdfPayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.context().route(
      "**/api/**",
      createQuotationsFixture({
        onRenderQuotationPdf(payload) {
          renderedPdfPayload = payload;
        },
      }),
    );

    const editModal = await openEditQuotationModal(page);

    await editModal
      .getByRole("button", { name: "Agregar seccion inicial" })
      .click();

    const secondSection = editModal.locator(".quotation-section-card").nth(1);
    await secondSection.locator("input").first().fill("Tabla local");
    await secondSection.locator("input").first().blur();

    await secondSection.getByRole("button", { name: "Agregar fila" }).click();
    const secondSectionNewRow = secondSection
      .locator(".quotation-items-table tbody tr")
      .last();
    await secondSectionNewRow.locator("td:nth-child(3) input").dblclick();
    await selectProductPickerProvider(page);
    await chooseProduct(page, "BUNDLE-B");

    const { printPage } = await openQuotationPdfPreview(page, editModal);

    await expect
      .poll(
        () =>
          renderedPdfPayload?.sections?.map((section) => ({
            title: section.title,
            rows: (section.rows || []).map((row) => row.productCode),
          })) || [],
      )
      .toEqual([
        {
          title: "Bundle persistido",
          rows: ["BUNDLE-A", "A-COMP-1", "A-COMP-2"],
        },
        {
          title: "Tabla local",
          rows: ["BUNDLE-B", "B-COMP-1", "B-COMP-2"],
        },
      ]);

    await printPage.close();
  });

  test("en edicion la vista previa incluye el padre de un bundle manual en la segunda seccion", async ({
    page,
  }) => {
    let renderedPdfPayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.context().route(
      "**/api/**",
      createQuotationsFixture({
        onRenderQuotationPdf(payload) {
          renderedPdfPayload = payload;
        },
      }),
    );

    const editModal = await openEditQuotationModal(page);

    await editModal
      .getByRole("button", { name: "Agregar seccion inicial" })
      .click();

    const secondSection = editModal.locator(".quotation-section-card").nth(1);
    await secondSection.locator("input").first().fill("Seccion 2");
    await secondSection.locator("input").first().blur();

    await secondSection.getByRole("button", { name: "Agregar fila" }).click();
    let newRow = secondSection
      .locator(".quotation-items-table tbody tr")
      .last();
    await newRow.locator("td:nth-child(3) input").dblclick();
    await selectProductPickerProvider(page);
    await chooseProduct(page, "PROD-1");

    await secondSection.getByRole("button", { name: "Agregar fila" }).click();
    newRow = secondSection.locator(".quotation-items-table tbody tr").last();
    await newRow.locator("td:nth-child(3) input").dblclick();
    await selectProductPickerProvider(page);
    await chooseProduct(page, "PROD-2");

    await secondSection.getByRole("button", { name: "Agregar fila" }).click();
    newRow = secondSection.locator(".quotation-items-table tbody tr").last();
    await newRow.locator("td:nth-child(3) input").dblclick();
    await selectProductPickerProvider(page);
    await chooseProduct(page, "PROD-3");

    await secondSection
      .locator(".quotation-items-table tbody tr")
      .nth(1)
      .locator("td:first-child input")
      .check();
    await secondSection
      .locator(".quotation-items-table tbody tr")
      .nth(2)
      .locator("td:first-child input")
      .check();

    await secondSection
      .getByRole("button", {
        name: "Crear bundle manual con filas seleccionadas",
      })
      .click();

    const manualBundleDialog = editModal.getByRole("dialog", {
      name: "Crear bundle manual",
    });
    await expect(manualBundleDialog).toBeVisible();
    await manualBundleDialog.getByRole("radio", { name: /PROD-2/i }).check();
    await manualBundleDialog
      .getByRole("button", { name: "Confirmar bundle" })
      .click();

    const { printPage } = await openQuotationPdfPreview(page, editModal);

    await expect
      .poll(
        () =>
          renderedPdfPayload?.sections?.[1]?.rows?.map(
            (row) => row.productCode,
          ) || [],
      )
      .toEqual(["PROD-1", "PROD-2", "PROD-3"]);

    await printPage.close();
  });

  test("en creacion avisa antes de cerrar si hay cambios sin guardar", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const createModal = await openCreateQuotationModal(page);

    const proposalNameInput = createModal
      .locator(".field-group")
      .filter({ hasText: "Nombre de propuesta" })
      .locator("input")
      .first();
    await proposalNameInput.fill("Cotizacion local");

    const dismissCreateDialog = dismissDirtyStateDialog(
      page,
      "Tienes cambios sin guardar en la nueva cotizacion",
    );
    await page.locator(".modal-overlay").click({ position: { x: 8, y: 8 } });
    await dismissCreateDialog;

    await expect(
      createModal.getByRole("heading", { name: "Crear cotizacion" }),
    ).toBeVisible();
    await expect(proposalNameInput).toHaveValue("Cotizacion local");

    const acceptCreateDialog = acceptDirtyStateDialog(
      page,
      "Tienes cambios sin guardar en la nueva cotizacion",
    );
    await createModal.getByRole("button", { name: "Cancelar" }).click();
    await acceptCreateDialog;

    await expect(
      page.getByRole("heading", { name: "Crear cotizacion" }),
    ).toHaveCount(0);
  });

  test("en creacion avisa antes de salir por el sidebar si hay cambios sin guardar", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const createModal = await openCreateQuotationModal(page);
    const proposalNameInput = createModal
      .locator(".field-group")
      .filter({ hasText: "Nombre de propuesta" })
      .locator("input")
      .first();

    await proposalNameInput.fill("Cotizacion local");

    await expect
      .poll(() =>
        page.evaluate(
          () => Object.keys(window.__quotationNavigationGuards || {}).length,
        ),
      )
      .toBe(1);

    const dismissSidebarDialog = dismissDirtyStateDialog(
      page,
      "Tienes cambios sin guardar en la nueva cotizacion",
    );
    await page
      .getByRole("link", { name: "Dashboard" })
      .evaluate((element) => element.click());
    await dismissSidebarDialog;

    await expect(page).toHaveURL(/\/quotations(\?.*)?$/);
    await expect(
      createModal.getByRole("heading", { name: "Crear cotizacion" }),
    ).toBeVisible();
    await expect(proposalNameInput).toHaveValue("Cotizacion local");

    const acceptSidebarDialog = acceptDirtyStateDialog(
      page,
      "Tienes cambios sin guardar en la nueva cotizacion",
    );
    await page
      .getByRole("link", { name: "Dashboard" })
      .evaluate((element) => element.click());
    await acceptSidebarDialog;

    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
  });

  test("en edicion avisa antes de salir por el sidebar si hay cambios sin guardar", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const editModal = await openEditQuotationModal(page);
    const sectionTitleInput = editModal
      .locator(".field-group")
      .filter({ hasText: "Titulo" })
      .locator("input")
      .first();

    await sectionTitleInput.fill("Bundle persistido local");

    await expect
      .poll(() =>
        page.evaluate(
          () => Object.keys(window.__quotationNavigationGuards || {}).length,
        ),
      )
      .toBe(1);

    const dismissSidebarDialog = dismissDirtyStateDialog(
      page,
      "Tienes cambios sin guardar en la cotizacion actual",
    );
    await page
      .getByRole("link", { name: "Dashboard" })
      .evaluate((element) => element.click());
    await dismissSidebarDialog;

    await expect(page).toHaveURL(/\/quotations(\?.*)?$/);
    await expect(
      editModal.getByRole("heading", { name: "Editar cotizacion" }),
    ).toBeVisible();
    await expect(sectionTitleInput).toHaveValue("Bundle persistido local");

    const acceptSidebarDialog = acceptDirtyStateDialog(
      page,
      "Tienes cambios sin guardar en la cotizacion actual",
    );
    await page
      .getByRole("link", { name: "Dashboard" })
      .evaluate((element) => element.click());
    await acceptSidebarDialog;

    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
  });

  test("permite editar la version seleccionada desde la lista", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const editModal = await openEditQuotationModal(page, { versionId: 1000 });

    const proposalNameInput = editModal
      .locator(".field-group")
      .filter({ hasText: "Nombre de propuesta" })
      .locator("input")
      .first();
    const introductionInput = editModal
      .locator(".field-group")
      .filter({ hasText: "Introduccion" })
      .locator("textarea")
      .first();

    await expect(proposalNameInput).toHaveValue("Oportunidad Demo v0");
    await expect(introductionInput).toHaveValue("Version previa demo");
  });

  test("permite eliminar filas seleccionadas en edicion", async ({ page }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const editModal = await openEditQuotationModal(page);

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual(["BUNDLE-A", "A-COMP-1", "A-COMP-2"]);

    await page
      .locator(".quotation-items-table tbody tr")
      .nth(0)
      .locator("td:first-child input")
      .check();
    await editModal
      .getByRole("button", { name: "Eliminar filas seleccionadas" })
      .click();

    await expect.poll(() => getQuotationRowCodes(page)).toEqual([]);
  });

  test("en edicion duplica y pega filas localmente hasta guardar la version", async ({
    page,
  }) => {
    let capturedUpdatePayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.route(
      "**/api/**",
      createQuotationsFixture({
        onUpdateQuotationVersion(payload) {
          capturedUpdatePayload = payload;
        },
      }),
    );

    let editModal = await openEditQuotationModal(page);

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual(["BUNDLE-A", "A-COMP-1", "A-COMP-2"]);

    await page
      .locator(".quotation-items-table tbody tr")
      .nth(0)
      .locator("td:first-child input")
      .check();

    await editModal
      .getByRole("button", { name: "Duplicar filas seleccionadas" })
      .click();

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual([
        "BUNDLE-A",
        "A-COMP-1",
        "A-COMP-2",
        "BUNDLE-A",
        "A-COMP-1",
        "A-COMP-2",
      ]);

    await editModal
      .getByRole("button", { name: "Copiar filas seleccionadas" })
      .click();
    await editModal
      .getByRole("button", { name: "Pegar filas copiadas" })
      .click();

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual([
        "BUNDLE-A",
        "A-COMP-1",
        "A-COMP-2",
        "BUNDLE-A",
        "A-COMP-1",
        "A-COMP-2",
        "BUNDLE-A",
        "A-COMP-1",
        "A-COMP-2",
      ]);

    await expect.poll(() => capturedUpdatePayload).toBeNull();

    await editModal
      .getByRole("button", { name: "Guardar como version actual" })
      .click();

    await expect.poll(() => capturedUpdatePayload).not.toBeNull();
    expect(capturedUpdatePayload.sections[0].items).toHaveLength(9);
    expect(
      capturedUpdatePayload.sections[0].items.map((item) => item.productCode),
    ).toEqual([
      "BUNDLE-A",
      "A-COMP-1",
      "A-COMP-2",
      "BUNDLE-A",
      "A-COMP-1",
      "A-COMP-2",
      "BUNDLE-A",
      "A-COMP-1",
      "A-COMP-2",
    ]);

    await page.locator(".modal-overlay").click({ position: { x: 8, y: 8 } });

    editModal = await openEditQuotationModal(page);

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual([
        "BUNDLE-A",
        "A-COMP-1",
        "A-COMP-2",
        "BUNDLE-A",
        "A-COMP-1",
        "A-COMP-2",
        "BUNDLE-A",
        "A-COMP-1",
        "A-COMP-2",
      ]);
  });

  test("permite precargar un producto desde el picker en edicion", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    await openEditQuotationModal(page);

    const row = page.locator(".quotation-items-table tbody tr").nth(1);
    await row.locator("td:nth-child(3) input").dblclick();
    const pickerModal = page
      .locator(".modal-dialog")
      .filter({
        has: page.getByRole("heading", { name: "Seleccionar producto" }),
      })
      .first();
    await expect(
      pickerModal.getByRole("heading", { name: "Seleccionar producto" }),
    ).toBeVisible();
    await pickerModal
      .locator(".quotation-product-picker-search input")
      .fill("PROD-2");

    await chooseProduct(page, "PROD-2");

    await expect(row.locator("td:nth-child(3) input")).toHaveValue("PROD-2");
    await expect(row.locator("td:nth-child(4) input")).toHaveValue(
      "Producto 2",
    );
  });

  test("en edicion agregar fila inserta una fila normal sin selector ni acciones extra", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const editModal = await openEditQuotationModal(page);
    const initialRowCount = await page
      .locator(".quotation-items-table tbody tr")
      .count();

    await editModal.getByRole("button", { name: "Agregar fila" }).click();

    const newRow = page.locator(".quotation-items-table tbody tr").last();
    await expect(newRow).toBeVisible();
    await expect(page.locator(".quotation-items-table tbody tr")).toHaveCount(
      initialRowCount + 1,
    );
    await expect(newRow.locator("td:nth-child(3) select")).toHaveCount(0);
    await expect(editModal.locator(".quotation-actions-row")).toHaveCount(0);
    await expect(newRow.locator("td:nth-child(3) input")).not.toBeFocused();
  });

  test("permite crear un bundle desde el picker en una fila nueva de edicion", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const editModal = await openEditQuotationModal(page);

    await editModal.getByRole("button", { name: "Agregar fila" }).click();

    const newRow = page.locator(".quotation-items-table tbody tr").last();
    await newRow.locator("td:nth-child(3) input").dblclick();

    const pickerModal = page
      .locator(".modal-dialog")
      .filter({
        has: page.getByRole("heading", { name: "Seleccionar producto" }),
      })
      .first();
    await expect(
      pickerModal.getByRole("heading", { name: "Seleccionar producto" }),
    ).toBeVisible();
    await pickerModal
      .locator(".quotation-product-picker-search input")
      .fill("BUNDLE-B");

    await chooseProduct(page, "BUNDLE-B");

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual([
        "BUNDLE-A",
        "A-COMP-1",
        "A-COMP-2",
        "BUNDLE-B",
        "B-COMP-1",
        "B-COMP-2",
      ]);
  });

  test("permite convertir una fila existente en bundle desde el picker en edicion", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const editModal = await openEditQuotationModal(page);

    await editModal.getByRole("button", { name: "Agregar fila" }).click();
    const newRow = page.locator(".quotation-items-table tbody tr").last();
    await newRow.locator("td:nth-child(3) input").dblclick();

    let pickerModal = page
      .locator(".modal-dialog")
      .filter({
        has: page.getByRole("heading", { name: "Seleccionar producto" }),
      })
      .first();
    await expect(
      pickerModal.getByRole("heading", { name: "Seleccionar producto" }),
    ).toBeVisible();
    await pickerModal
      .locator(".quotation-product-picker-search input")
      .fill("PROD-1");
    await chooseProduct(page, "PROD-1");

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual(["BUNDLE-A", "A-COMP-1", "A-COMP-2", "PROD-1"]);

    const existingRow = page.locator(".quotation-items-table tbody tr").nth(3);
    await existingRow.locator("td:nth-child(3) input").dblclick();

    pickerModal = page
      .locator(".modal-dialog")
      .filter({
        has: page.getByRole("heading", { name: "Seleccionar producto" }),
      })
      .first();
    await expect(
      pickerModal.getByRole("heading", { name: "Seleccionar producto" }),
    ).toBeVisible();
    await pickerModal
      .locator(".quotation-product-picker-search input")
      .fill("BUNDLE-B");
    await chooseProduct(page, "BUNDLE-B");

    await expect(existingRow.locator("td:nth-child(3) input")).toHaveValue(
      "BUNDLE-B",
    );
    await expect(existingRow.locator("td:nth-child(4) input")).toHaveValue(
      "Bundle B",
    );

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual(["BUNDLE-A", "A-COMP-1", "A-COMP-2", "BUNDLE-B"]);
  });

  test("permite crear, adjuntar y quitar componentes con las acciones de bundle en edicion", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const editModal = await openEditQuotationModal(page);

    await addEditProductRow(page, editModal, "PROD-1");
    await addEditProductRow(page, editModal, "PROD-2");

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual(["BUNDLE-A", "A-COMP-1", "A-COMP-2", "PROD-1", "PROD-2"]);

    await page
      .locator(".quotation-items-table tbody tr")
      .nth(3)
      .locator("td:first-child input")
      .check();
    await page
      .locator(".quotation-items-table tbody tr")
      .nth(4)
      .locator("td:first-child input")
      .check();

    await editModal
      .getByRole("button", {
        name: "Crear bundle manual con filas seleccionadas",
      })
      .click();

    const manualBundleDialog = editModal.getByRole("dialog", {
      name: "Crear bundle manual",
    });
    await expect(manualBundleDialog).toBeVisible();
    await manualBundleDialog
      .getByRole("button", { name: "Confirmar bundle" })
      .click();

    await expect(
      getQuotationRowByCode(page, "PROD-1").locator(
        ".quotation-bundle-parent-badge",
      ),
    ).toContainText("Bundle");
    await expect(
      getQuotationRowByCode(page, "PROD-2").locator(
        ".quotation-bundle-component-badge",
      ),
    ).toContainText("Componente");

    await addEditProductRow(page, editModal, "PROD-3");

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual([
        "BUNDLE-A",
        "A-COMP-1",
        "A-COMP-2",
        "PROD-1",
        "PROD-2",
        "PROD-3",
      ]);

    await getQuotationRowByCode(page, "PROD-2")
      .locator("td:first-child input")
      .uncheck();
    await getQuotationRowByCode(page, "PROD-3")
      .locator("td:first-child input")
      .check();

    await editModal
      .getByRole("button", {
        name: "Adjuntar filas seleccionadas al bundle manual",
      })
      .click();

    await expect(
      getQuotationRowByCode(page, "PROD-3").locator(
        ".quotation-bundle-component-badge",
      ),
    ).toContainText("Componente");

    await getQuotationRowByCode(page, "PROD-1")
      .locator("td:first-child input")
      .uncheck();

    await editModal
      .getByRole("button", {
        name: "Quitar filas seleccionadas del bundle manual",
      })
      .click();

    await expect(
      getQuotationRowByCode(page, "PROD-3").locator(
        ".quotation-bundle-component-badge",
      ),
    ).toHaveCount(0);
    await expect(
      getQuotationRowByCode(page, "PROD-1").locator(
        ".quotation-bundle-parent-badge",
      ),
    ).toContainText("Bundle");
    await expect(
      getQuotationRowByCode(page, "PROD-2").locator(
        ".quotation-bundle-component-badge",
      ),
    ).toContainText("Componente");
  });

  test("muestra un mensaje invalido al seleccionar componentes de bundles distintos en edicion", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const editModal = await openEditQuotationModal(page);

    await addEditProductRow(page, editModal, "PROD-1");
    await addEditProductRow(page, editModal, "PROD-2");

    await getQuotationRowByCode(page, "PROD-1")
      .locator("td:first-child input")
      .check();
    await getQuotationRowByCode(page, "PROD-2")
      .locator("td:first-child input")
      .check();

    await editModal
      .getByRole("button", {
        name: "Crear bundle manual con filas seleccionadas",
      })
      .click();

    const manualBundleDialog = editModal.getByRole("dialog", {
      name: "Crear bundle manual",
    });
    await expect(manualBundleDialog).toBeVisible();
    await manualBundleDialog
      .getByRole("button", { name: "Confirmar bundle" })
      .click();

    await getQuotationRowByCode(page, "PROD-1")
      .locator("td:first-child input")
      .uncheck();
    await getQuotationRowByCode(page, "A-COMP-1")
      .locator("td:first-child input")
      .check();

    const firstSection = editModal.locator(".quotation-section-card").first();
    await expect(
      firstSection.locator(".quotation-create-step-hint"),
    ).toContainText(
      "Selecciona componentes que pertenezcan al mismo bundle manual.",
    );
    await expect(
      editModal.getByRole("button", {
        name: "Quitar filas seleccionadas del bundle manual",
      }),
    ).toBeDisabled();
  });

  test("muestra un mensaje invalido al intentar quitar todos los componentes de un bundle manual en edicion", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const editModal = await openEditQuotationModal(page);

    await addEditProductRow(page, editModal, "PROD-1");
    await addEditProductRow(page, editModal, "PROD-2");

    await getQuotationRowByCode(page, "PROD-1")
      .locator("td:first-child input")
      .check();
    await getQuotationRowByCode(page, "PROD-2")
      .locator("td:first-child input")
      .check();

    await editModal
      .getByRole("button", {
        name: "Crear bundle manual con filas seleccionadas",
      })
      .click();

    const manualBundleDialog = editModal.getByRole("dialog", {
      name: "Crear bundle manual",
    });
    await expect(manualBundleDialog).toBeVisible();
    await manualBundleDialog
      .getByRole("button", { name: "Confirmar bundle" })
      .click();

    await getQuotationRowByCode(page, "PROD-1")
      .locator("td:first-child input")
      .uncheck();

    const firstSection = editModal.locator(".quotation-section-card").first();
    await expect(
      firstSection.locator(".quotation-create-step-hint"),
    ).toContainText("Debe quedar al menos un componente dentro del bundle.");
    await expect(
      editModal.getByRole("button", {
        name: "Quitar filas seleccionadas del bundle manual",
      }),
    ).toBeDisabled();
  });

  test("bloquea adjuntar componentes en edicion cuando la fila adicional ya pertenece a otro bundle", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const editModal = await openEditQuotationModal(page);

    await addEditProductRow(page, editModal, "PROD-1");
    await addEditProductRow(page, editModal, "PROD-2");

    await getQuotationRowByCode(page, "PROD-1")
      .locator("td:first-child input")
      .check();
    await getQuotationRowByCode(page, "PROD-2")
      .locator("td:first-child input")
      .check();

    await editModal
      .getByRole("button", {
        name: "Crear bundle manual con filas seleccionadas",
      })
      .click();

    const manualBundleDialog = editModal.getByRole("dialog", {
      name: "Crear bundle manual",
    });
    await expect(manualBundleDialog).toBeVisible();
    await manualBundleDialog
      .getByRole("button", { name: "Confirmar bundle" })
      .click();

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual(["BUNDLE-A", "A-COMP-1", "A-COMP-2", "PROD-1", "PROD-2"]);

    await getQuotationRowByCode(page, "PROD-2")
      .locator("td:first-child input")
      .uncheck();
    await getQuotationRowByCode(page, "A-COMP-1")
      .locator("td:first-child input")
      .check();

    const attachButton = editModal.getByRole("button", {
      name: "Adjuntar filas seleccionadas al bundle manual",
    });
    await expect(attachButton).toBeDisabled();
    await attachButton.hover();

    const firstSection = editModal.locator(".quotation-section-card").first();
    await expect(
      firstSection.locator(".quotation-create-step-hint"),
    ).toContainText(
      "Solo puedes agregar filas independientes. No se permiten otros bundles ni componentes ya agrupados.",
    );

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual(["BUNDLE-A", "A-COMP-1", "A-COMP-2", "PROD-1", "PROD-2"]);
  });

  test("muestra un mensaje invalido al intentar adjuntar con dos bundles padre seleccionados en edicion", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const editModal = await openEditQuotationModal(page);

    await addEditProductRow(page, editModal, "PROD-1");
    await addEditProductRow(page, editModal, "PROD-2");

    await getQuotationRowByCode(page, "PROD-1")
      .locator("td:first-child input")
      .check();
    await getQuotationRowByCode(page, "PROD-2")
      .locator("td:first-child input")
      .check();

    await editModal
      .getByRole("button", {
        name: "Crear bundle manual con filas seleccionadas",
      })
      .click();

    const manualBundleDialog = editModal.getByRole("dialog", {
      name: "Crear bundle manual",
    });
    await expect(manualBundleDialog).toBeVisible();
    await manualBundleDialog
      .getByRole("button", { name: "Confirmar bundle" })
      .click();

    await expect(
      getQuotationRowByCode(page, "PROD-1").locator(
        ".quotation-bundle-parent-badge",
      ),
    ).toContainText("Bundle");

    await getQuotationRowByCode(page, "PROD-1")
      .locator("td:first-child input")
      .uncheck();
    await getQuotationRowByCode(page, "PROD-2")
      .locator("td:first-child input")
      .uncheck();

    await addEditProductRow(page, editModal, "PROD-3");
    await addEditProductRow(page, editModal, "SERV-1");

    await getQuotationRowByCode(page, "PROD-3")
      .locator("td:first-child input")
      .check();
    await getQuotationRowByCode(page, "SERV-1")
      .locator("td:first-child input")
      .check();

    await editModal
      .getByRole("button", {
        name: "Crear bundle manual con filas seleccionadas",
      })
      .click();

    const secondManualBundleDialog = editModal.getByRole("dialog", {
      name: "Crear bundle manual",
    });
    await expect(secondManualBundleDialog).toBeVisible();
    await secondManualBundleDialog
      .getByRole("button", { name: "Confirmar bundle" })
      .click();

    await expect(
      getQuotationRowByCode(page, "PROD-3").locator(
        ".quotation-bundle-parent-badge",
      ),
    ).toContainText("Bundle");

    await getQuotationRowByCode(page, "SERV-1")
      .locator("td:first-child input")
      .uncheck();
    await getQuotationRowByCode(page, "PROD-1")
      .locator("td:first-child input")
      .check();
    await getQuotationRowByCode(page, "PROD-3")
      .locator("td:first-child input")
      .check();

    const attachButton = editModal.getByRole("button", {
      name: "Adjuntar filas seleccionadas al bundle manual",
    });
    await expect(attachButton).toBeDisabled();
    await attachButton.hover();

    const firstSection = editModal.locator(".quotation-section-card").first();
    await expect(
      firstSection.locator(".quotation-create-step-hint"),
    ).toContainText(
      "Selecciona exactamente un bundle existente y una o mas filas independientes.",
    );
  });

  test("permite mover y eliminar secciones en edicion", async ({ page }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const editModal = await openEditQuotationModal(page);

    await expect(
      editModal.getByRole("button", { name: "Subir seccion" }).first(),
    ).toBeDisabled();
    await expect(
      editModal.getByRole("button", { name: "Bajar seccion" }).first(),
    ).toBeDisabled();

    await editModal
      .getByRole("button", { name: "Agregar seccion inicial" })
      .click();
    await expect(editModal.locator(".quotation-section-card")).toHaveCount(2);

    await expect(
      editModal.getByRole("button", { name: "Subir seccion" }).nth(1),
    ).toBeEnabled();
    await expect(
      editModal.getByRole("button", { name: "Bajar seccion" }).nth(1),
    ).toBeDisabled();

    const secondSection = editModal.locator(".quotation-section-card").nth(1);
    await secondSection.locator("input").first().fill("Seccion nueva");
    await secondSection.locator("input").first().blur();

    await expect(
      editModal
        .locator(".quotation-section-card")
        .nth(1)
        .locator("input")
        .first(),
    ).toHaveValue("Seccion nueva");

    await secondSection.getByRole("button", { name: "Subir seccion" }).click();

    await expect(
      editModal
        .locator(".quotation-section-card")
        .nth(0)
        .locator("input")
        .first(),
    ).toHaveValue("Seccion nueva");

    await editModal
      .locator(".quotation-section-card")
      .nth(1)
      .getByRole("button", { name: "Eliminar seccion" })
      .click();

    await expect(editModal.locator(".quotation-section-card")).toHaveCount(1);
    await expect(
      editModal
        .locator(".quotation-section-card")
        .first()
        .locator("input")
        .first(),
    ).toHaveValue("Seccion nueva");
  });

  test("permite editar descuento final desde el resumen de la version", async ({
    page,
  }) => {
    let capturedUpdatePayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.route(
      "**/api/**",
      createQuotationsFixture({
        onUpdateQuotationVersion(payload) {
          capturedUpdatePayload = payload;
        },
      }),
    );

    const editModal = await openEditQuotationModal(page);

    await expect(
      await getQuotationSummaryRowValues(editModal, "Total"),
    ).toEqual(["Total", "40.00", "40.00", "0.00"]);

    await editModal
      .locator(".quotation-summary-discount-field")
      .locator("label")
      .filter({ hasText: "Valor" })
      .click();
    await editModal.getByLabel("Descuento US$").fill("10");

    await expect(
      await getQuotationSummaryRowValues(editModal, "Descuento"),
    ).toEqual(["Descuento", "", "10.00", ""]);
    await expect(
      await getQuotationSummaryRowValues(editModal, "Total Descontado"),
    ).toEqual(["Total Descontado", "", "30.00", ""]);

    await editModal
      .locator(".quotation-summary-discount-field")
      .locator("label")
      .filter({ hasText: "Por item" })
      .click();

    await expect(await hasQuotationSummaryRow(editModal, "Descuento")).toBe(0);
    await expect(
      await getQuotationSummaryRowValues(editModal, "Total"),
    ).toEqual(["Total", "40.00", "30.00", "-33.33"]);
    await expect(
      editModal
        .locator(".quotation-items-table tbody tr")
        .nth(1)
        .locator("td:nth-child(14) input"),
    ).toHaveValue("25");
    await expect(
      editModal
        .locator(".quotation-items-table tbody tr")
        .nth(1)
        .locator("td:nth-child(14) input"),
    ).toBeDisabled();
    await expect(
      editModal
        .locator(".quotation-items-table tbody tr")
        .nth(2)
        .locator("td:nth-child(14) input"),
    ).toHaveValue("25");
    await expect(
      editModal
        .locator(".quotation-items-table tbody tr")
        .nth(2)
        .locator("td:nth-child(14) input"),
    ).toBeDisabled();

    await editModal
      .getByRole("button", { name: "Guardar como version actual" })
      .click();

    await expect.poll(() => capturedUpdatePayload).not.toBeNull();
    expect(capturedUpdatePayload.summaryDiscountMode).toBe("amount");
    expect(capturedUpdatePayload.summaryDiscountValue).toBe(10);
    expect(capturedUpdatePayload.summaryDistributionMode).toBe("per_item");
  });

  test("permite editar IVA desde el resumen de la version", async ({
    page,
  }) => {
    let capturedUpdatePayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.route(
      "**/api/**",
      createQuotationsFixture({
        onUpdateQuotationVersion(payload) {
          capturedUpdatePayload = payload;
        },
      }),
    );

    const editModal = await openEditQuotationModal(page);

    await editModal
      .locator(".quotation-summary-vat-field")
      .getByRole("radio", { name: "Total" })
      .check();

    await expect(await getQuotationSummaryRowValues(editModal, "IVA")).toEqual([
      "IVA",
      "",
      "6.40",
      "",
    ]);
    await expect(
      await getQuotationSummaryRowValues(editModal, "Total con IVA incluido"),
    ).toEqual(["Total con IVA incluido", "", "46.40", ""]);

    await editModal
      .locator(".quotation-summary-vat-field")
      .getByRole("radio", { name: "Por item" })
      .check();

    await expect(await hasQuotationSummaryRow(editModal, "IVA")).toBe(0);
    await expect(
      await hasQuotationSummaryRow(editModal, "Total con IVA incluido"),
    ).toBe(0);
    await expect(
      editModal
        .locator(".quotation-items-table tbody tr")
        .nth(1)
        .locator("td:nth-child(15)"),
    ).toContainText("11.60");
    await expect(
      editModal
        .locator(".quotation-items-table tbody tr")
        .nth(1)
        .locator("td:nth-child(16)"),
    ).toContainText("23.20");
    await expect(
      await getQuotationSummaryRowValues(editModal, "Total"),
    ).toEqual(["Total", "40.00", "46.40", "13.79"]);

    await editModal
      .getByRole("button", { name: "Guardar como version actual" })
      .click();

    await expect.poll(() => capturedUpdatePayload).not.toBeNull();
    expect(capturedUpdatePayload.summaryVatMode).toBe("per_item");
    expect(capturedUpdatePayload.summaryVatPct).toBe(16);
  });

  test("aplica IVA por item al precio de venta sin mostrar filas extra en resumen", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const createModal = await openCreateQuotationModal(page);

    await addProductRow(page, createModal, 0, "PROD-1");
    await createModal
      .locator(".quotation-summary-vat-field")
      .getByRole("radio", { name: "Por item" })
      .check();

    await expect(
      page
        .locator(".quotation-items-table tbody tr")
        .nth(0)
        .locator("td:nth-child(15)"),
    ).toContainText("116.00");
    await expect(
      page
        .locator(".quotation-items-table tbody tr")
        .nth(0)
        .locator("td:nth-child(16)"),
    ).toContainText("116.00");
    await expect(
      await getQuotationSummaryRowValues(createModal, "Total"),
    ).toEqual(["Total", "100.00", "116.00", "13.79"]);
    await expect(await hasQuotationSummaryRow(createModal, "IVA")).toBe(0);
    await expect(
      await hasQuotationSummaryRow(createModal, "Total con IVA incluido"),
    ).toBe(0);
  });

  test("envia bundles reales al crear una cotizacion", async ({ page }) => {
    let capturedCreatePayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.route(
      "**/api/**",
      createQuotationsFixture({
        onCreateQuotation(payload) {
          capturedCreatePayload = payload;
        },
      }),
    );

    const createModal = await openCreateQuotationModal(page);

    await addBundleRow(page, createModal, 0, "BUNDLE-A");
    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual(["BUNDLE-A", "A-COMP-1", "A-COMP-2"]);
    await createModal.getByRole("button", { name: "Crear cotizacion" }).click();

    await expect.poll(() => capturedCreatePayload).not.toBeNull();

    expect(capturedCreatePayload.sections).toHaveLength(1);
    expect(capturedCreatePayload.sections[0].items).toEqual([
      expect.objectContaining({
        clientItemId: expect.any(String),
        productCode: "BUNDLE-A",
        itemType: "grupo_productos",
        bundleParentClientItemId: null,
        bundleOriginType: "price_list_bundle",
        sourceProviderPriceListItemId: 301,
        sourceComponentPriceListItemId: null,
        displayOrder: 1,
      }),
      expect.objectContaining({
        clientItemId: expect.any(String),
        productCode: "A-COMP-1",
        itemType: "producto",
        bundleOriginType: "price_list_bundle",
        sourceProviderPriceListItemId: null,
        sourceComponentPriceListItemId: 401,
        displayOrder: 2,
      }),
      expect.objectContaining({
        clientItemId: expect.any(String),
        productCode: "A-COMP-2",
        itemType: "producto",
        bundleOriginType: "price_list_bundle",
        sourceProviderPriceListItemId: null,
        sourceComponentPriceListItemId: 402,
        displayOrder: 3,
      }),
    ]);

    expect(
      capturedCreatePayload.sections[0].items[1].bundleParentClientItemId,
    ).toBe(capturedCreatePayload.sections[0].items[0].clientItemId);
    expect(
      capturedCreatePayload.sections[0].items[2].bundleParentClientItemId,
    ).toBe(capturedCreatePayload.sections[0].items[0].clientItemId);
  });

  test("permite crear un bundle manual eligiendo padre y componentes", async ({
    page,
  }) => {
    let capturedCreatePayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.route(
      "**/api/**",
      createQuotationsFixture({
        onCreateQuotation(payload) {
          capturedCreatePayload = payload;
        },
      }),
    );

    const createModal = await openCreateQuotationModal(page);

    await addProductRow(page, createModal, 0, "PROD-1");
    await addProductRow(page, createModal, 1, "PROD-2");
    await addProductRow(page, createModal, 2, "PROD-3");

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual(["PROD-1", "PROD-2", "PROD-3"]);

    await page
      .locator(".quotation-items-table tbody tr")
      .nth(0)
      .locator("td:first-child input")
      .check();
    await page
      .locator(".quotation-items-table tbody tr")
      .nth(1)
      .locator("td:first-child input")
      .check();
    await page
      .locator(".quotation-items-table tbody tr")
      .nth(2)
      .locator("td:first-child input")
      .check();

    await createModal
      .getByRole("button", {
        name: "Crear bundle manual con filas seleccionadas",
      })
      .click();

    const picker = createModal.getByRole("dialog", {
      name: "Crear bundle manual",
    });
    await expect(picker).toBeVisible();
    await picker.getByRole("radio", { name: /PROD-2/i }).check();
    await picker.getByRole("button", { name: "Confirmar bundle" }).click();

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual(["PROD-2", "PROD-1", "PROD-3"]);

    await createModal.getByRole("button", { name: "Crear cotizacion" }).click();

    await expect.poll(() => capturedCreatePayload).not.toBeNull();

    expect(capturedCreatePayload.sections[0].items).toEqual([
      expect.objectContaining({
        productCode: "PROD-2",
        itemType: "grupo_productos",
        bundleParentClientItemId: null,
        bundleOriginType: "manual_bundle",
        sourceProviderPriceListItemId: null,
        sourceComponentPriceListItemId: null,
      }),
      expect.objectContaining({
        productCode: "PROD-1",
        itemType: "producto",
        bundleOriginType: "manual_bundle",
        sourceProviderPriceListItemId: null,
        sourceComponentPriceListItemId: null,
      }),
      expect.objectContaining({
        productCode: "PROD-3",
        itemType: "producto",
        bundleOriginType: "manual_bundle",
        sourceProviderPriceListItemId: null,
        sourceComponentPriceListItemId: null,
      }),
    ]);

    expect(
      capturedCreatePayload.sections[0].items[1].bundleParentClientItemId,
    ).toBe(capturedCreatePayload.sections[0].items[0].clientItemId);
    expect(
      capturedCreatePayload.sections[0].items[2].bundleParentClientItemId,
    ).toBe(capturedCreatePayload.sections[0].items[0].clientItemId);
  });

  test("permite agregar filas independientes a un bundle manual existente", async ({
    page,
  }) => {
    let capturedCreatePayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.route(
      "**/api/**",
      createQuotationsFixture({
        onCreateQuotation(payload) {
          capturedCreatePayload = payload;
        },
      }),
    );

    const createModal = await openCreateQuotationModal(page);

    await addProductRow(page, createModal, 0, "PROD-1");
    await addProductRow(page, createModal, 1, "PROD-2");
    await addProductRow(page, createModal, 2, "PROD-3");
    await addProductRow(page, createModal, 3, "PROD-2");

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual(["PROD-1", "PROD-2", "PROD-3", "PROD-2"]);

    await page
      .locator(".quotation-items-table tbody tr")
      .nth(1)
      .locator("td:first-child input")
      .check();
    await page
      .locator(".quotation-items-table tbody tr")
      .nth(2)
      .locator("td:first-child input")
      .check();
    await page
      .locator(".quotation-items-table tbody tr")
      .nth(3)
      .locator("td:first-child input")
      .check();

    await createModal
      .getByRole("button", {
        name: "Crear bundle manual con filas seleccionadas",
      })
      .click();

    const picker = createModal.getByRole("dialog", {
      name: "Crear bundle manual",
    });
    await expect(picker).toBeVisible();
    await picker.getByRole("radio", { name: /PROD-3/i }).check();
    await picker.getByRole("button", { name: "Confirmar bundle" }).click();

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual(["PROD-1", "PROD-3", "PROD-2", "PROD-2"]);

    await page
      .locator(".quotation-items-table tbody tr")
      .nth(1)
      .locator("td:first-child input")
      .uncheck();
    await page
      .locator(".quotation-items-table tbody tr")
      .nth(2)
      .locator("td:first-child input")
      .uncheck();
    await page
      .locator(".quotation-items-table tbody tr")
      .nth(3)
      .locator("td:first-child input")
      .uncheck();

    await page
      .locator(".quotation-items-table tbody tr")
      .nth(0)
      .locator("td:first-child input")
      .check();
    await page
      .locator(".quotation-items-table tbody tr")
      .nth(1)
      .locator("td:first-child input")
      .check();

    await createModal
      .getByRole("button", {
        name: "Adjuntar filas seleccionadas al bundle manual",
      })
      .click();

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual(["PROD-3", "PROD-2", "PROD-2", "PROD-1"]);

    await createModal.getByRole("button", { name: "Crear cotizacion" }).click();

    await expect.poll(() => capturedCreatePayload).not.toBeNull();

    expect(capturedCreatePayload.sections[0].items).toEqual([
      expect.objectContaining({
        productCode: "PROD-3",
        itemType: "grupo_productos",
        bundleParentClientItemId: null,
        bundleOriginType: "manual_bundle",
      }),
      expect.objectContaining({
        productCode: "PROD-2",
        itemType: "producto",
        bundleOriginType: "manual_bundle",
      }),
      expect.objectContaining({
        productCode: "PROD-2",
        itemType: "producto",
        bundleOriginType: "manual_bundle",
      }),
      expect.objectContaining({
        productCode: "PROD-1",
        itemType: "producto",
        bundleOriginType: "manual_bundle",
      }),
    ]);

    expect(
      capturedCreatePayload.sections[0].items[1].bundleParentClientItemId,
    ).toBe(capturedCreatePayload.sections[0].items[0].clientItemId);
    expect(
      capturedCreatePayload.sections[0].items[2].bundleParentClientItemId,
    ).toBe(capturedCreatePayload.sections[0].items[0].clientItemId);
    expect(
      capturedCreatePayload.sections[0].items[3].bundleParentClientItemId,
    ).toBe(capturedCreatePayload.sections[0].items[0].clientItemId);
  });

  test("permite quitar uno o varios componentes de un bundle manual existente", async ({
    page,
  }) => {
    let capturedCreatePayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.route(
      "**/api/**",
      createQuotationsFixture({
        onCreateQuotation(payload) {
          capturedCreatePayload = payload;
        },
      }),
    );

    const createModal = await openCreateQuotationModal(page);

    await addProductRow(page, createModal, 0, "PROD-1");
    await addProductRow(page, createModal, 1, "PROD-2");
    await addProductRow(page, createModal, 2, "PROD-3");
    await addProductRow(page, createModal, 3, "PROD-2");

    await page
      .locator(".quotation-items-table tbody tr")
      .nth(0)
      .locator("td:first-child input")
      .check();
    await page
      .locator(".quotation-items-table tbody tr")
      .nth(1)
      .locator("td:first-child input")
      .check();
    await page
      .locator(".quotation-items-table tbody tr")
      .nth(2)
      .locator("td:first-child input")
      .check();
    await page
      .locator(".quotation-items-table tbody tr")
      .nth(3)
      .locator("td:first-child input")
      .check();

    await createModal
      .getByRole("button", {
        name: "Crear bundle manual con filas seleccionadas",
      })
      .click();

    const picker = createModal.getByRole("dialog", {
      name: "Crear bundle manual",
    });
    await expect(picker).toBeVisible();
    await picker.getByRole("radio", { name: /PROD-3/i }).check();
    await picker.getByRole("button", { name: "Confirmar bundle" }).click();

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual(["PROD-3", "PROD-1", "PROD-2", "PROD-2"]);

    await page
      .locator(".quotation-items-table tbody tr")
      .nth(0)
      .locator("td:first-child input")
      .uncheck();
    await page
      .locator(".quotation-items-table tbody tr")
      .nth(1)
      .locator("td:first-child input")
      .uncheck();
    await page
      .locator(".quotation-items-table tbody tr")
      .nth(2)
      .locator("td:first-child input")
      .uncheck();
    await page
      .locator(".quotation-items-table tbody tr")
      .nth(3)
      .locator("td:first-child input")
      .uncheck();

    await page
      .locator(".quotation-items-table tbody tr")
      .nth(1)
      .locator("td:first-child input")
      .check();
    await page
      .locator(".quotation-items-table tbody tr")
      .nth(2)
      .locator("td:first-child input")
      .check();

    await createModal
      .getByRole("button", {
        name: "Quitar filas seleccionadas del bundle manual",
      })
      .click();

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual(["PROD-3", "PROD-2", "PROD-1", "PROD-2"]);

    await createModal.getByRole("button", { name: "Crear cotizacion" }).click();

    await expect.poll(() => capturedCreatePayload).not.toBeNull();

    expect(capturedCreatePayload.sections[0].items).toEqual([
      expect.objectContaining({
        productCode: "PROD-3",
        itemType: "grupo_productos",
        bundleParentClientItemId: null,
        bundleOriginType: "manual_bundle",
      }),
      expect.objectContaining({
        productCode: "PROD-2",
        itemType: "producto",
        bundleOriginType: "manual_bundle",
      }),
      expect.objectContaining({
        productCode: "PROD-1",
        itemType: "producto",
        bundleParentClientItemId: null,
        bundleOriginType: null,
      }),
      expect.objectContaining({
        productCode: "PROD-2",
        itemType: "producto",
        bundleParentClientItemId: null,
        bundleOriginType: null,
      }),
    ]);

    expect(
      capturedCreatePayload.sections[0].items[1].bundleParentClientItemId,
    ).toBe(capturedCreatePayload.sections[0].items[0].clientItemId);
  });

  test("convierte un bundle automatico a manual al agregarle filas independientes", async ({
    page,
  }) => {
    let capturedCreatePayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.route(
      "**/api/**",
      createQuotationsFixture({
        onCreateQuotation(payload) {
          capturedCreatePayload = payload;
        },
      }),
    );

    const createModal = await openCreateQuotationModal(page);

    await addBundleRow(page, createModal, 0, "BUNDLE-A");
    await addProductRow(page, createModal, 3, "PROD-1");

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual(["BUNDLE-A", "A-COMP-1", "A-COMP-2", "PROD-1"]);

    await page
      .locator(".quotation-items-table tbody tr")
      .nth(0)
      .locator("td:first-child input")
      .check();
    await page
      .locator(".quotation-items-table tbody tr")
      .nth(3)
      .locator("td:first-child input")
      .check();

    await createModal
      .getByRole("button", {
        name: "Adjuntar filas seleccionadas al bundle manual",
      })
      .click();

    await createModal.getByRole("button", { name: "Crear cotizacion" }).click();

    await expect.poll(() => capturedCreatePayload).not.toBeNull();

    expect(capturedCreatePayload.sections[0].items).toEqual([
      expect.objectContaining({
        productCode: "BUNDLE-A",
        itemType: "grupo_productos",
        bundleOriginType: "manual_bundle",
        sourceProviderPriceListItemId: null,
      }),
      expect.objectContaining({
        productCode: "A-COMP-1",
        itemType: "producto",
        bundleOriginType: "manual_bundle",
        sourceComponentPriceListItemId: null,
      }),
      expect.objectContaining({
        productCode: "A-COMP-2",
        itemType: "producto",
        bundleOriginType: "manual_bundle",
        sourceComponentPriceListItemId: null,
      }),
      expect.objectContaining({
        productCode: "PROD-1",
        itemType: "producto",
        bundleOriginType: "manual_bundle",
        sourceComponentPriceListItemId: null,
      }),
    ]);

    expect(
      capturedCreatePayload.sections[0].items[1].bundleParentClientItemId,
    ).toBe(capturedCreatePayload.sections[0].items[0].clientItemId);
    expect(
      capturedCreatePayload.sections[0].items[2].bundleParentClientItemId,
    ).toBe(capturedCreatePayload.sections[0].items[0].clientItemId);
    expect(
      capturedCreatePayload.sections[0].items[3].bundleParentClientItemId,
    ).toBe(capturedCreatePayload.sections[0].items[0].clientItemId);
  });

  test("prioriza el mensaje de adjuntar en creacion cuando el usuario apunta esa accion", async ({
    page,
  }) => {
    await bootstrapAuthenticatedSession(page);
    await page.route("**/api/**", createQuotationsFixture());

    const createModal = await openCreateQuotationModal(page);

    await addBundleRow(page, createModal, 0, "BUNDLE-A");
    await addProductRow(page, createModal, 3, "PROD-1");
    await addProductRow(page, createModal, 4, "PROD-2");

    await getQuotationRowByCode(page, "PROD-1")
      .locator("td:first-child input")
      .check();
    await getQuotationRowByCode(page, "PROD-2")
      .locator("td:first-child input")
      .check();

    await createModal
      .getByRole("button", {
        name: "Crear bundle manual con filas seleccionadas",
      })
      .click();

    const picker = createModal.getByRole("dialog", {
      name: "Crear bundle manual",
    });
    await expect(picker).toBeVisible();
    await picker.getByRole("button", { name: "Confirmar bundle" }).click();

    await getQuotationRowByCode(page, "PROD-2")
      .locator("td:first-child input")
      .uncheck();
    await getQuotationRowByCode(page, "BUNDLE-A")
      .locator("td:first-child input")
      .check();

    const attachButton = createModal.getByRole("button", {
      name: "Adjuntar filas seleccionadas al bundle manual",
    });
    await expect(attachButton).toBeDisabled();
    await attachButton.hover();

    await expect(
      createModal
        .locator(".quotation-section-card")
        .first()
        .locator(".quotation-create-step-hint"),
    ).toContainText(
      "Selecciona exactamente un bundle existente y una o mas filas independientes.",
    );
  });

  test("convierte un bundle automatico a manual al quitarle componentes", async ({
    page,
  }) => {
    let capturedCreatePayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.route(
      "**/api/**",
      createQuotationsFixture({
        onCreateQuotation(payload) {
          capturedCreatePayload = payload;
        },
      }),
    );

    const createModal = await openCreateQuotationModal(page);

    await addBundleRow(page, createModal, 0, "BUNDLE-A");

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual(["BUNDLE-A", "A-COMP-1", "A-COMP-2"]);

    await page
      .locator(".quotation-items-table tbody tr")
      .nth(1)
      .locator("td:first-child input")
      .check();

    await createModal
      .getByRole("button", {
        name: "Quitar filas seleccionadas del bundle manual",
      })
      .click();

    await expect
      .poll(() => getQuotationRowCodes(page))
      .toEqual(["BUNDLE-A", "A-COMP-2", "A-COMP-1"]);

    await createModal.getByRole("button", { name: "Crear cotizacion" }).click();

    await expect.poll(() => capturedCreatePayload).not.toBeNull();

    expect(capturedCreatePayload.sections[0].items).toEqual([
      expect.objectContaining({
        productCode: "BUNDLE-A",
        itemType: "grupo_productos",
        bundleOriginType: "manual_bundle",
        sourceProviderPriceListItemId: null,
      }),
      expect.objectContaining({
        productCode: "A-COMP-2",
        itemType: "producto",
        bundleOriginType: "manual_bundle",
        sourceComponentPriceListItemId: null,
      }),
      expect.objectContaining({
        productCode: "A-COMP-1",
        itemType: "producto",
        bundleParentClientItemId: null,
        bundleOriginType: null,
        sourceComponentPriceListItemId: null,
      }),
    ]);

    expect(
      capturedCreatePayload.sections[0].items[1].bundleParentClientItemId,
    ).toBe(capturedCreatePayload.sections[0].items[0].clientItemId);
  });

  test("conserva la jerarquia bundle al guardar la version completa", async ({
    page,
  }) => {
    let capturedUpdatePayload = null;

    await bootstrapAuthenticatedSession(page);
    await page.route(
      "**/api/**",
      createQuotationsFixture({
        onUpdateQuotationVersion(payload) {
          capturedUpdatePayload = payload;
        },
      }),
    );

    const editModal = await openEditQuotationModal(page);
    const componentRow = editModal
      .locator(".quotation-items-table tbody tr")
      .filter({ has: page.locator('input[value="A-COMP-1"]') })
      .first();

    await componentRow.locator("td:nth-child(4) input").click();
    await editModal
      .locator(".quotation-description-editor-popover textarea")
      .fill("Componente A1 editado");
    await expect.poll(() => capturedUpdatePayload).toBeNull();

    await editModal
      .getByRole("button", { name: "Guardar como version actual" })
      .click();

    await expect.poll(() => capturedUpdatePayload).not.toBeNull();

    const savedItem = capturedUpdatePayload.sections[0].items.find(
      (item) => Number(item.id) === 5002,
    );

    expect(savedItem).toEqual(
      expect.objectContaining({
        productCode: "A-COMP-1",
        productDescription: "Componente A1 editado",
        itemType: "producto",
        bundleParentLocalId: "5001",
        bundleOriginType: "price_list_bundle",
        sourceProviderPriceListItemId: null,
        sourceComponentPriceListItemId: 401,
        bundleSortOrder: 1,
        displayOrder: 2,
      }),
    );
  });
});
