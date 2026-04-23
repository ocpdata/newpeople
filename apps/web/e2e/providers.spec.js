import { expect, test } from "@playwright/test";

function bootstrapAuthenticatedSession(page, token = "jwt-token") {
  return page.addInitScript((value) => {
    window.localStorage.setItem("crm_token", value);
  }, token);
}

function createProvidersFixture() {
  const providerStatuses = [
    { id: 1, code: "activado", name: "Activado" },
    { id: 2, code: "desactivado", name: "Desactivado" },
  ];
  const priceItemStatuses = [
    { id: 1, code: "activo", name: "Activo" },
    { id: 2, code: "inactivo", name: "Inactivo" },
  ];
  const countries = [
    { id: 1, iso2: "MX", iso3: "MEX", name: "Mexico" },
    { id: 2, iso2: "AR", iso3: "ARG", name: "Argentina" },
  ];
  const currencies = [
    {
      id: 1,
      code: "USD",
      name: "Dolar estadounidense",
      symbol: "$",
      decimals: 2,
    },
    { id: 2, code: "MXN", name: "Peso mexicano", symbol: "$", decimals: 2 },
  ];

  let providerIdSeq = 2;
  let priceItemIdSeq = 2;

  const providers = [
    {
      id: 1,
      name: "Proveedor Demo",
      registration_code: "PROV-DEMO-001",
      address_line: "Av. Reforma 100",
      city: "Ciudad de Mexico",
      postal_code: "01010",
      state_region: "CDMX",
      country: "Mexico",
      country_id: 1,
      activation_status: "Activado",
      activation_status_code: "activado",
      active_price_items: 1,
      total_price_items: 1,
      created_by_name: "Demo Seller",
      updated_by_name: "Demo Seller",
      created_at: "2026-04-21T10:00:00.000Z",
      updated_at: "2026-04-21T10:00:00.000Z",
      activation_status_id: 1,
    },
  ];

  const priceItemsByProviderId = new Map([
    [
      1,
      [
        {
          id: 1,
          provider_id: 1,
          code: "PRICE-DEMO-001",
          description: "Precio inicial demo",
          item_type: "producto",
          price: "1999.99",
          currency_id: 1,
          currency_code: "USD",
          currency_name: "Dolar estadounidense",
          currency_symbol: "$",
          activation_status_id: 1,
          activation_status_code: "activo",
          activation_status: "Activo",
          created_by_name: "Demo Seller",
          updated_by_name: "Demo Seller",
          created_at: "2026-04-21T10:00:00.000Z",
          updated_at: "2026-04-21T10:00:00.000Z",
        },
      ],
    ],
  ]);

  function getProviderStatus(statusId) {
    return providerStatuses.find(
      (status) => Number(status.id) === Number(statusId),
    );
  }

  function getPriceItemStatus(statusId) {
    return priceItemStatuses.find(
      (status) => Number(status.id) === Number(statusId),
    );
  }

  function getCountry(countryId) {
    return countries.find(
      (country) => Number(country.id) === Number(countryId),
    );
  }

  function getCurrency(currencyId) {
    return currencies.find(
      (currency) => Number(currency.id) === Number(currencyId),
    );
  }

  function recomputeProviderStats(providerId) {
    const items = priceItemsByProviderId.get(Number(providerId)) || [];
    const provider = providers.find(
      (row) => Number(row.id) === Number(providerId),
    );
    if (!provider) return;
    provider.total_price_items = items.length;
    provider.active_price_items = items.filter(
      (item) => String(item.activation_status_code) === "activo",
    ).length;
  }

  return {
    providers,
    providerStatuses,
    priceItemStatuses,
    countries,
    currencies,
    priceItemsByProviderId,
    listProviders() {
      return [...providers].sort(
        (left, right) => Number(right.id) - Number(left.id),
      );
    },
    getProvider(providerId) {
      return providers.find(
        (provider) => Number(provider.id) === Number(providerId),
      );
    },
    createProvider(body) {
      const status = getProviderStatus(body.activationStatusId);
      const country = getCountry(body.countryId);
      const provider = {
        id: providerIdSeq,
        name: body.name,
        registration_code: body.registrationCode,
        address_line: body.addressLine || null,
        city: body.city || null,
        postal_code: body.postalCode || null,
        state_region: body.stateRegion || null,
        country: country?.name || "",
        country_id: body.countryId,
        activation_status: status?.name || "Activado",
        activation_status_code: status?.code || "activado",
        activation_status_id: body.activationStatusId,
        active_price_items: 0,
        total_price_items: 0,
        created_by_name: "Demo Seller",
        updated_by_name: "Demo Seller",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      providerIdSeq += 1;
      providers.unshift(provider);
      priceItemsByProviderId.set(Number(provider.id), []);
      return provider;
    },
    createPriceItem(providerId, body) {
      const currency = getCurrency(body.currencyId);
      const status = getPriceItemStatus(body.activationStatusId);
      const items = priceItemsByProviderId.get(Number(providerId)) || [];
      const item = {
        id: priceItemIdSeq,
        provider_id: Number(providerId),
        code: body.code,
        description: body.description || null,
        item_type: body.itemType || "producto",
        price: String(Number(body.price).toFixed(2)),
        currency_id: body.currencyId,
        currency_code: currency?.code || "USD",
        currency_name: currency?.name || "Dolar estadounidense",
        currency_symbol: currency?.symbol || "$",
        activation_status_id: body.activationStatusId,
        activation_status_code: status?.code || "activo",
        activation_status: status?.name || "Activo",
        created_by_name: "Demo Seller",
        updated_by_name: "Demo Seller",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      priceItemIdSeq += 1;
      priceItemsByProviderId.set(Number(providerId), [item, ...items]);
      recomputeProviderStats(providerId);
      return item;
    },
    updatePriceItem(providerId, itemId, body) {
      const currency = getCurrency(body.currencyId);
      const status = getPriceItemStatus(body.activationStatusId);
      const items = priceItemsByProviderId.get(Number(providerId)) || [];
      const updatedItems = items.map((item) => {
        if (Number(item.id) !== Number(itemId)) {
          return item;
        }
        return {
          ...item,
          code: body.code,
          description: body.description || null,
          item_type: body.itemType || item.item_type,
          price: String(Number(body.price).toFixed(2)),
          currency_id: body.currencyId,
          currency_code: currency?.code || item.currency_code,
          currency_name: currency?.name || item.currency_name,
          currency_symbol: currency?.symbol || item.currency_symbol,
          activation_status_id: body.activationStatusId,
          activation_status_code: status?.code || item.activation_status_code,
          activation_status: status?.name || item.activation_status,
          updated_at: new Date().toISOString(),
        };
      });
      priceItemsByProviderId.set(Number(providerId), updatedItems);
      recomputeProviderStats(providerId);
      return updatedItems.find((item) => Number(item.id) === Number(itemId));
    },
    updatePriceItemStatus(providerId, itemId, statusCode) {
      const status = priceItemStatuses.find(
        (row) => String(row.code) === String(statusCode),
      );
      const items = priceItemsByProviderId.get(Number(providerId)) || [];
      const updatedItems = items.map((item) => {
        if (Number(item.id) !== Number(itemId)) {
          return item;
        }
        return {
          ...item,
          activation_status_id: status?.id || item.activation_status_id,
          activation_status_code: status?.code || item.activation_status_code,
          activation_status: status?.name || item.activation_status,
          updated_at: new Date().toISOString(),
        };
      });
      priceItemsByProviderId.set(Number(providerId), updatedItems);
      recomputeProviderStats(providerId);
      return updatedItems.find((item) => Number(item.id) === Number(itemId));
    },
  };
}

async function mockProvidersApi(page, fixture) {
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

    if (pathname === "/api/auth/bootstrap-status") {
      return json({ hasUsers: true });
    }

    if (pathname === "/api/auth/me") {
      return json({
        id: 31,
        full_name: "Demo Seller",
        email: "seller@example.com",
        status: "active",
        roles: [{ name: "Administrador" }],
        permissions: [
          "proveedores.read",
          "proveedores.create",
          "proveedores.update",
          "proveedores_precios.read",
          "proveedores_precios.create",
          "proveedores_precios.update",
        ],
      });
    }

    if (pathname === "/api/providers" && method === "GET") {
      return json(fixture.listProviders());
    }

    if (pathname === "/api/providers" && method === "POST") {
      const body = route.request().postDataJSON();
      const provider = fixture.createProvider(body);
      return json({ id: provider.id, message: "Proveedor creado" }, 201);
    }

    if (
      pathname.startsWith("/api/providers/") &&
      !pathname.includes("price-list-items") &&
      method === "GET"
    ) {
      const providerId = Number(pathname.split("/").pop());
      const provider = fixture.getProvider(providerId);
      return json(
        provider || { message: "Proveedor no encontrado" },
        provider ? 200 : 404,
      );
    }

    if (pathname === "/api/catalogs/provider-countries") {
      return json(fixture.countries);
    }

    if (pathname === "/api/catalogs/provider-activation-statuses") {
      return json(fixture.providerStatuses);
    }

    if (pathname === "/api/catalogs/provider-price-list-item-statuses") {
      return json(fixture.priceItemStatuses);
    }

    if (pathname === "/api/catalogs/provider-price-list-currencies") {
      return json(fixture.currencies);
    }

    if (
      /^\/api\/providers\/\d+\/price-list-items$/.test(pathname) &&
      method === "GET"
    ) {
      const providerId = Number(pathname.split("/")[3]);
      return json(fixture.priceItemsByProviderId.get(providerId) || []);
    }

    if (
      /^\/api\/providers\/\d+\/price-list-items$/.test(pathname) &&
      method === "POST"
    ) {
      const providerId = Number(pathname.split("/")[3]);
      const body = route.request().postDataJSON();
      const item = fixture.createPriceItem(providerId, body);
      return json({ id: item.id, message: "Precio agregado" }, 201);
    }

    if (
      /^\/api\/providers\/\d+\/price-list-items\/\d+$/.test(pathname) &&
      method === "PUT"
    ) {
      const [, , , providerId, , itemId] = pathname.split("/");
      const body = route.request().postDataJSON();
      const item = fixture.updatePriceItem(providerId, itemId, body);
      return json({ id: item.id, message: "Precio actualizado" });
    }

    if (
      /^\/api\/providers\/\d+\/price-list-items\/\d+\/status$/.test(pathname) &&
      method === "PATCH"
    ) {
      const [, , , providerId, , itemId] = pathname.split("/");
      const body = route.request().postDataJSON();
      const item = fixture.updatePriceItemStatus(
        providerId,
        itemId,
        body.statusCode,
      );
      return json({
        id: item.id,
        message:
          body.statusCode === "activo"
            ? "Precio activado"
            : "Precio desactivado",
      });
    }

    return json({ message: `Unhandled route: ${pathname}` }, 500);
  });
}

test.describe("providers", () => {
  test("permite crear un proveedor y agregar un precio desde la UI", async ({
    page,
  }) => {
    const fixture = createProvidersFixture();

    await bootstrapAuthenticatedSession(page);
    await mockProvidersApi(page, fixture);
    await page.goto("/providers");

    await expect(
      page.getByRole("heading", { name: "Proveedores" }),
    ).toBeVisible();
    await expect(page.getByText("Proveedor Demo")).toBeVisible();

    await page.getByRole("button", { name: "+ Crear proveedor" }).click();
    await expect(
      page.getByRole("heading", { name: "Crear proveedor" }),
    ).toBeVisible();

    const providerModal = page.locator(".modal-dialog-account").first();

    await providerModal.locator("input").nth(0).fill("Proveedor Nuevo QA");
    await providerModal.locator("input").nth(1).fill("PROV-QA-900");
    await providerModal.locator("select").nth(0).selectOption("1");
    await providerModal
      .getByRole("button", { name: "Crear proveedor", exact: true })
      .click();

    await expect(page.getByText("Proveedor creado")).toBeVisible();
    await expect(page.getByText("Proveedor Nuevo QA")).toBeVisible();

    const createdProvider = fixture.providers.find(
      (provider) => provider.registration_code === "PROV-QA-900",
    );
    expect(createdProvider).toBeTruthy();

    const providerRow = page
      .locator("tbody tr")
      .filter({ has: page.getByText("Proveedor Nuevo QA", { exact: true }) })
      .first();

    await providerRow.getByRole("button", { name: "Abrir acciones" }).click();
    await page.getByRole("button", { name: "Lista de precios" }).click();

    await expect(
      page.getByRole("heading", { name: "Lista de precios" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "+ Agregar precio" }).click();
    await expect(
      page.getByRole("heading", { name: "Agregar precio" }),
    ).toBeVisible();

    const priceModal = page.locator(".provider-price-item-modal").first();

    await priceModal.locator("input").nth(0).fill("PRICE-QA-01");
    await priceModal.locator('input[type="number"]').fill("2500.50");
    await priceModal.locator("select").nth(0).selectOption("servicio_propio");
    await priceModal.locator("textarea").fill("Precio agregado por prueba E2E");
    await priceModal
      .getByRole("button", { name: "Agregar precio", exact: true })
      .click();

    await expect(page.getByText("Precio agregado")).toBeVisible();
    await expect(page.getByText("PRICE-QA-01")).toBeVisible();
    await expect(
      page.getByText("Precio agregado por prueba E2E"),
    ).toBeVisible();

    const createdPriceRow = page
      .locator(".provider-price-list-table tbody tr")
      .filter({ has: page.getByText("PRICE-QA-01", { exact: true }) })
      .first();
    await expect(createdPriceRow.getByText("Servicios Propios")).toBeVisible();

    await createdPriceRow
      .getByRole("button", { name: "Abrir acciones" })
      .click();
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Editar precio" }),
    ).toBeVisible();

    const editPriceModal = page.locator(".provider-price-item-modal").first();
    await editPriceModal.locator("select").nth(0).selectOption("producto");
    await editPriceModal
      .locator("textarea")
      .fill("Precio editado por prueba E2E");
    await editPriceModal.locator('input[type="number"]').fill("2750.00");
    await editPriceModal
      .getByRole("button", { name: "Guardar cambios", exact: true })
      .click();

    await expect
      .poll(
        () =>
          fixture.priceItemsByProviderId
            .get(Number(createdProvider?.id))
            ?.find((item) => item.code === "PRICE-QA-01")?.item_type,
      )
      .toBe("producto");
    await expect
      .poll(
        () =>
          fixture.priceItemsByProviderId
            .get(Number(createdProvider?.id))
            ?.find((item) => item.code === "PRICE-QA-01")?.description,
      )
      .toBe("Precio editado por prueba E2E");
    await expect(page.getByText("Precio editado por prueba E2E")).toBeVisible();
    await expect(createdPriceRow.getByText("Productos")).toBeVisible();
    await expect(createdPriceRow.getByText("PRICE-QA-01")).toBeVisible();

    await createdPriceRow
      .getByRole("button", { name: "Abrir acciones" })
      .click();
    await page.getByRole("button", { name: "Desactivar", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Desactivar precio" }),
    ).toBeVisible();

    const deactivateModal = page.locator(".modal-dialog").filter({
      has: page.getByRole("heading", { name: "Desactivar precio" }),
    });
    await deactivateModal
      .getByRole("button", { name: "Desactivar", exact: true })
      .evaluate((element) => element.click());

    await expect
      .poll(
        () =>
          fixture.priceItemsByProviderId
            .get(Number(createdProvider?.id))
            ?.find((item) => item.code === "PRICE-QA-01")
            ?.activation_status_code,
      )
      .toBe("inactivo");
    await expect(createdPriceRow.getByText("PRICE-QA-01")).toBeVisible();

    await createdPriceRow
      .getByRole("button", { name: "Abrir acciones" })
      .click();
    await page.getByRole("button", { name: "Activar", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Activar precio" }),
    ).toBeVisible();

    const activateModal = page
      .locator(".modal-dialog")
      .filter({ has: page.getByRole("heading", { name: "Activar precio" }) });
    await activateModal
      .getByRole("button", { name: "Activar", exact: true })
      .evaluate((element) => element.click());

    await expect
      .poll(
        () =>
          fixture.priceItemsByProviderId
            .get(Number(createdProvider?.id))
            ?.find((item) => item.code === "PRICE-QA-01")
            ?.activation_status_code,
      )
      .toBe("activo");
    await expect(createdPriceRow.getByText("PRICE-QA-01")).toBeVisible();
  });
});
