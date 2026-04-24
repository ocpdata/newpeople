import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";

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
  const productTypes = [
    { id: 1, code: "producto", name: "Productos", sort_order: 1 },
    {
      id: 2,
      code: "servicio_propio",
      name: "Servicios Propios",
      sort_order: 2,
    },
    { id: 3, code: "grupo_productos", name: "Bundle", sort_order: 3 },
  ];

  let providerIdSeq = 2;
  let priceListIdSeq = 2;
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
      activation_status_id: 1,
      active_price_lists: 1,
      total_price_lists: 1,
      active_price_items: 1,
      total_price_items: 1,
      created_by_name: "Demo Seller",
      updated_by_name: "Demo Seller",
      created_at: "2026-04-21T10:00:00.000Z",
      updated_at: "2026-04-21T10:00:00.000Z",
    },
  ];

  const priceListsByProviderId = new Map([
    [
      1,
      [
        {
          id: 1,
          provider_id: 1,
          name: "Lista vigente",
          item_type: "producto",
          is_active: 1,
          active_price_items: 1,
          total_price_items: 1,
          currency_id: 1,
          currency_code: "USD",
          currency_name: "Dolar estadounidense",
          created_by_name: "Demo Seller",
          updated_by_name: "Demo Seller",
          created_at: "2026-04-21T10:00:00.000Z",
          updated_at: "2026-04-21T10:00:00.000Z",
        },
      ],
    ],
  ]);

  const priceItemsByListId = new Map([
    [
      1,
      [
        {
          id: 1,
          provider_id: 1,
          price_list_id: 1,
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
          price_list_name: "Lista vigente",
          price_list_is_active: 1,
          created_by_name: "Demo Seller",
          updated_by_name: "Demo Seller",
          created_at: "2026-04-21T10:00:00.000Z",
          updated_at: "2026-04-21T10:00:00.000Z",
        },
      ],
    ],
  ]);

  function getProvider(providerId) {
    return providers.find(
      (provider) => Number(provider.id) === Number(providerId),
    );
  }

  function getCountry(countryId) {
    return countries.find(
      (country) => Number(country.id) === Number(countryId),
    );
  }

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

  function getCurrency(currencyId) {
    return currencies.find(
      (currency) => Number(currency.id) === Number(currencyId),
    );
  }

  function listPriceLists(providerId) {
    return [...(priceListsByProviderId.get(Number(providerId)) || [])].sort(
      (left, right) => {
        if (Number(right.is_active) !== Number(left.is_active)) {
          return Number(right.is_active) - Number(left.is_active);
        }
        return Number(right.id) - Number(left.id);
      },
    );
  }

  function getPriceList(providerId, listId) {
    return (priceListsByProviderId.get(Number(providerId)) || []).find(
      (priceList) => Number(priceList.id) === Number(listId),
    );
  }

  function listPriceItems(providerId, listId) {
    const priceList = getPriceList(providerId, listId);
    const items = [...(priceItemsByListId.get(Number(listId)) || [])].sort(
      (left, right) => Number(right.id) - Number(left.id),
    );

    return items.map((item) => ({
      ...item,
      price_list_name: priceList?.name || item.price_list_name,
      price_list_is_active: Number(priceList?.is_active || 0),
    }));
  }

  function recomputePriceListStats(providerId, listId) {
    const priceList = getPriceList(providerId, listId);
    if (!priceList) return;

    const items = priceItemsByListId.get(Number(listId)) || [];
    priceList.total_price_items = items.length;
    priceList.active_price_items = items.filter(
      (item) => String(item.activation_status_code) === "activo",
    ).length;
    priceList.updated_at = new Date().toISOString();
  }

  function recomputeProviderStats(providerId) {
    const provider = getProvider(providerId);
    if (!provider) return;

    const lists = priceListsByProviderId.get(Number(providerId)) || [];
    provider.total_price_lists = lists.length;
    provider.active_price_lists = lists.filter(
      (priceList) => Number(priceList.is_active) === 1,
    ).length;
    provider.total_price_items = lists.reduce(
      (sum, priceList) => sum + Number(priceList.total_price_items || 0),
      0,
    );
    provider.active_price_items = lists.reduce(
      (sum, priceList) => sum + Number(priceList.active_price_items || 0),
      0,
    );
    provider.updated_at = new Date().toISOString();
  }

  function createProvider(body) {
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
      active_price_lists: 0,
      total_price_lists: 0,
      active_price_items: 0,
      total_price_items: 0,
      created_by_name: "Demo Seller",
      updated_by_name: "Demo Seller",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    providerIdSeq += 1;
    providers.unshift(provider);
    priceListsByProviderId.set(Number(provider.id), []);
    return provider;
  }

  function createPriceList(providerId, body) {
    const lists = priceListsByProviderId.get(Number(providerId)) || [];
    const currency = getCurrency(body.currencyId);
    const priceList = {
      id: priceListIdSeq,
      provider_id: Number(providerId),
      name: body.name,
      item_type: body.itemType || "producto",
      is_active: 0,
      active_price_items: 0,
      total_price_items: 0,
      currency_id: body.currencyId,
      currency_code: currency?.code || null,
      currency_name: currency?.name || null,
      created_by_name: "Demo Seller",
      updated_by_name: "Demo Seller",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    priceListIdSeq += 1;
    priceListsByProviderId.set(Number(providerId), [priceList, ...lists]);
    priceItemsByListId.set(Number(priceList.id), []);
    recomputeProviderStats(providerId);
    return priceList;
  }

  function updatePriceListStatus(providerId, listId, statusCode) {
    const lists = priceListsByProviderId.get(Number(providerId)) || [];
    const nextIsActive = statusCode === "activa" ? 1 : 0;
    const currentActive = lists.find(
      (priceList) =>
        Number(priceList.id) !== Number(listId) &&
        Number(priceList.is_active) === 1,
    );

    if (nextIsActive === 1 && currentActive) {
      return {
        error: {
          status: 409,
          body: {
            message: "Ya existe una lista de precios activa para el proveedor.",
            activeListId: currentActive.id,
            activeListName: currentActive.name,
          },
        },
      };
    }

    const targetList = getPriceList(providerId, listId);
    if (!targetList) {
      return {
        error: {
          status: 404,
          body: { message: "Lista de precios no encontrada" },
        },
      };
    }

    targetList.is_active = nextIsActive;
    targetList.updated_at = new Date().toISOString();

    if (nextIsActive === 0) {
      const inactiveStatus = priceItemStatuses.find(
        (status) => String(status.code) === "inactivo",
      );
      const items = priceItemsByListId.get(Number(listId)) || [];
      priceItemsByListId.set(
        Number(listId),
        items.map((item) => ({
          ...item,
          activation_status_id: inactiveStatus?.id || item.activation_status_id,
          activation_status_code:
            inactiveStatus?.code || item.activation_status_code,
          activation_status: inactiveStatus?.name || item.activation_status,
          price_list_is_active: 0,
          updated_at: new Date().toISOString(),
        })),
      );
    }

    recomputePriceListStats(providerId, listId);
    recomputeProviderStats(providerId);
    return {
      body: {
        message: nextIsActive
          ? "Lista de precios activada"
          : "Lista de precios desactivada",
      },
    };
  }

  function createPriceItem(providerId, listId, body) {
    const currency = getCurrency(body.currencyId);
    const status = getPriceItemStatus(body.activationStatusId);
    const priceList = getPriceList(providerId, listId);
    const items = priceItemsByListId.get(Number(listId)) || [];
    const enforcedCurrency = priceList?.currency_id
      ? getCurrency(priceList.currency_id)
      : items[0]
        ? getCurrency(items[0].currency_id)
        : null;

    if (
      enforcedCurrency &&
      Number(enforcedCurrency.id) !== Number(body.currencyId)
    ) {
      return {
        error: {
          status: 409,
          body: {
            message: `La lista de precios solo permite una moneda. Usa ${enforcedCurrency.code}.`,
            currencyId: enforcedCurrency.id,
            currencyCode: enforcedCurrency.code,
          },
        },
      };
    }

    const resolvedComponents = Array.isArray(body.components)
      ? body.components
          .map((component) => {
            for (const listItems of priceItemsByListId.values()) {
              const foundItem = listItems.find(
                (item) => Number(item.id) === Number(component.componentItemId),
              );
              if (!foundItem) continue;
              return {
                ...foundItem,
                component_item_id: Number(component.componentItemId),
                quantity: Number(component.quantity),
              };
            }
            return null;
          })
          .filter(Boolean)
      : [];

    const computedPrice =
      body.itemType === "grupo_productos"
        ? resolvedComponents.reduce(
            (sum, component) =>
              sum +
              Number(component.price || 0) * Number(component.quantity || 0),
            0,
          )
        : Number(body.price);

    const item = {
      id: priceItemIdSeq,
      provider_id: Number(providerId),
      price_list_id: Number(listId),
      code: body.code,
      description: body.description || null,
      item_type: body.itemType || "producto",
      price: String(Number(computedPrice || 0).toFixed(2)),
      currency_id: body.currencyId,
      currency_code: currency?.code || "USD",
      currency_name: currency?.name || "Dolar estadounidense",
      currency_symbol: currency?.symbol || "$",
      activation_status_id: body.activationStatusId,
      activation_status_code: status?.code || "activo",
      activation_status: status?.name || "Activo",
      price_list_name: priceList?.name || "",
      price_list_is_active: Number(priceList?.is_active || 0),
      created_by_name: "Demo Seller",
      updated_by_name: "Demo Seller",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      components: resolvedComponents,
    };

    priceItemIdSeq += 1;
    priceItemsByListId.set(Number(listId), [item, ...items]);
    recomputePriceListStats(providerId, listId);
    recomputeProviderStats(providerId);
    return { item };
  }

  function updatePriceItem(providerId, listId, itemId, body) {
    const currency = getCurrency(body.currencyId);
    const status = getPriceItemStatus(body.activationStatusId);
    const priceList = getPriceList(providerId, listId);
    const items = priceItemsByListId.get(Number(listId)) || [];
    const enforcedCurrencyItem = items.find(
      (item) => Number(item.id) !== Number(itemId),
    );
    const enforcedCurrency = priceList?.currency_id
      ? getCurrency(priceList.currency_id)
      : enforcedCurrencyItem
        ? getCurrency(enforcedCurrencyItem.currency_id)
        : null;

    if (
      enforcedCurrency &&
      Number(enforcedCurrency.id) !== Number(body.currencyId)
    ) {
      return {
        error: {
          status: 409,
          body: {
            message: `La lista de precios solo permite una moneda. Usa ${enforcedCurrency.code}.`,
            currencyId: enforcedCurrency.id,
            currencyCode: enforcedCurrency.code,
          },
        },
      };
    }

    const resolvedComponents = Array.isArray(body.components)
      ? body.components
          .map((component) => {
            for (const listItems of priceItemsByListId.values()) {
              const foundItem = listItems.find(
                (item) => Number(item.id) === Number(component.componentItemId),
              );
              if (!foundItem) continue;
              return {
                ...foundItem,
                component_item_id: Number(component.componentItemId),
                quantity: Number(component.quantity),
              };
            }
            return null;
          })
          .filter(Boolean)
      : [];

    const computedPrice =
      body.itemType === "grupo_productos"
        ? resolvedComponents.reduce(
            (sum, component) =>
              sum +
              Number(component.price || 0) * Number(component.quantity || 0),
            0,
          )
        : Number(body.price);

    const updatedItems = items.map((item) => {
      if (Number(item.id) !== Number(itemId)) {
        return item;
      }

      return {
        ...item,
        code: body.code,
        description: body.description || null,
        item_type: body.itemType || item.item_type,
        price: String(Number(computedPrice || 0).toFixed(2)),
        currency_id: body.currencyId,
        currency_code: currency?.code || item.currency_code,
        currency_name: currency?.name || item.currency_name,
        currency_symbol: currency?.symbol || item.currency_symbol,
        activation_status_id: body.activationStatusId,
        activation_status_code: status?.code || item.activation_status_code,
        activation_status: status?.name || item.activation_status,
        updated_at: new Date().toISOString(),
        components: resolvedComponents,
      };
    });

    priceItemsByListId.set(Number(listId), updatedItems);
    recomputePriceListStats(providerId, listId);
    recomputeProviderStats(providerId);
    return {
      item: updatedItems.find((item) => Number(item.id) === Number(itemId)),
    };
  }

  function updatePriceItemStatus(providerId, listId, itemId, statusCode) {
    const status = priceItemStatuses.find(
      (row) => String(row.code) === String(statusCode),
    );
    const items = priceItemsByListId.get(Number(listId)) || [];
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

    priceItemsByListId.set(Number(listId), updatedItems);
    recomputePriceListStats(providerId, listId);
    recomputeProviderStats(providerId);
    return {
      item: updatedItems.find((item) => Number(item.id) === Number(itemId)),
    };
  }

  function searchPriceItems(query, currencyId) {
    const normalizedQuery = String(query || "")
      .trim()
      .toLowerCase();

    return [...priceItemsByListId.entries()]
      .flatMap(([listId, items]) => {
        const priceList = [...priceListsByProviderId.values()]
          .flat()
          .find((row) => Number(row.id) === Number(listId));
        if (!priceList || Number(priceList.is_active) !== 1) {
          return [];
        }

        const provider = getProvider(priceList.provider_id);
        if (
          !provider ||
          String(provider.activation_status_code) !== "activado"
        ) {
          return [];
        }

        return items
          .filter(
            (item) =>
              String(item.activation_status_code) === "activo" &&
              String(item.item_type) !== "grupo_productos" &&
              Number(item.currency_id) === Number(currencyId),
          )
          .map((item) => ({
            ...item,
            provider_name: provider.name,
            price_list_name: priceList.name,
          }));
      })
      .filter((item) => {
        if (!normalizedQuery) return true;
        return [
          item.code,
          item.description,
          item.provider_name,
          item.price_list_name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((left, right) =>
        String(left.code).localeCompare(String(right.code), "es"),
      );
  }

  return {
    providers,
    providerStatuses,
    priceItemStatuses,
    countries,
    currencies,
    productTypes,
    priceListsByProviderId,
    priceItemsByListId,
    listProviders() {
      return [...providers].sort(
        (left, right) => Number(right.id) - Number(left.id),
      );
    },
    getProvider,
    listPriceLists,
    listPriceItems,
    createProvider,
    createPriceList,
    updatePriceListStatus,
    createPriceItem,
    updatePriceItem,
    updatePriceItemStatus,
    searchPriceItems,
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

    if (/^\/api\/providers\/\d+$/.test(pathname) && method === "GET") {
      const providerId = Number(pathname.split("/")[3]);
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

    if (pathname === "/api/catalogs/product-types") {
      return json(fixture.productTypes);
    }

    if (pathname === "/api/providers/price-items/search" && method === "GET") {
      return json(
        fixture.searchPriceItems(
          url.searchParams.get("q"),
          url.searchParams.get("currencyId"),
        ),
      );
    }

    if (
      /^\/api\/providers\/\d+\/price-lists$/.test(pathname) &&
      method === "GET"
    ) {
      const providerId = Number(pathname.split("/")[3]);
      return json(fixture.listPriceLists(providerId));
    }

    if (
      /^\/api\/providers\/\d+\/price-lists$/.test(pathname) &&
      method === "POST"
    ) {
      const providerId = Number(pathname.split("/")[3]);
      const body = route.request().postDataJSON();
      const priceList = fixture.createPriceList(providerId, body);
      return json(
        { id: priceList.id, message: "Lista de precios creada" },
        201,
      );
    }

    if (
      /^\/api\/providers\/\d+\/price-lists\/\d+\/status$/.test(pathname) &&
      method === "PATCH"
    ) {
      const [, , , providerId, , listId] = pathname.split("/");
      const body = route.request().postDataJSON();
      const result = fixture.updatePriceListStatus(
        providerId,
        listId,
        body.statusCode,
      );
      if (result.error) {
        return json(result.error.body, result.error.status);
      }
      return json(result.body);
    }

    if (
      /^\/api\/providers\/\d+\/price-lists\/\d+\/items$/.test(pathname) &&
      method === "GET"
    ) {
      const [, , , providerId, , listId] = pathname.split("/");
      return json(fixture.listPriceItems(providerId, listId));
    }

    if (
      /^\/api\/providers\/\d+\/price-lists\/\d+\/items$/.test(pathname) &&
      method === "POST"
    ) {
      const [, , , providerId, , listId] = pathname.split("/");
      const body = route.request().postDataJSON();
      const result = fixture.createPriceItem(providerId, listId, body);
      if (result.error) {
        return json(result.error.body, result.error.status);
      }
      return json({ id: result.item.id, message: "Precio agregado" }, 201);
    }

    if (
      /^\/api\/providers\/\d+\/price-lists\/\d+\/items\/\d+$/.test(pathname) &&
      method === "PUT"
    ) {
      const [, , , providerId, , listId, , itemId] = pathname.split("/");
      const body = route.request().postDataJSON();
      const result = fixture.updatePriceItem(providerId, listId, itemId, body);
      if (result.error) {
        return json(result.error.body, result.error.status);
      }
      return json({ id: result.item.id, message: "Precio actualizado" });
    }

    if (
      /^\/api\/providers\/\d+\/price-lists\/\d+\/items\/\d+\/status$/.test(
        pathname,
      ) &&
      method === "PATCH"
    ) {
      const [, , , providerId, , listId, , itemId] = pathname.split("/");
      const body = route.request().postDataJSON();
      const result = fixture.updatePriceItemStatus(
        providerId,
        listId,
        itemId,
        body.statusCode,
      );
      return json({
        id: result.item.id,
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
  test("permite crear listas padre, activar una sola y gestionar precios desde la UI", async ({
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
    await page.getByRole("button", { name: "Listas de precios" }).click();

    await expect(
      page.getByRole("heading", { name: "Listas de precios" }),
    ).toBeVisible();
    await page.getByLabel("Crear lista de precios").click();

    await expect(
      page.getByRole("heading", { name: "Crear lista de precios" }),
    ).toBeVisible();
    const createListModal = page.locator(".provider-price-list-create-modal");
    await createListModal.locator("input").fill("Lista QA 2026");
    await createListModal.locator("select").nth(0).selectOption("1");
    await createListModal.locator("select").nth(1).selectOption("producto");
    await page
      .getByRole("button", { name: "Crear lista", exact: true })
      .click();

    await expect(
      page.getByRole("heading", { name: "Listas de precios" }),
    ).toBeVisible();

    const createdList = fixture
      .listPriceLists(Number(createdProvider?.id))
      .find((priceList) => priceList.name === "Lista QA 2026");
    expect(createdList).toBeTruthy();

    const listsTable = page.locator(".provider-price-lists-table");
    const firstListRow = listsTable
      .locator("tbody tr")
      .filter({ has: page.getByText("Lista QA 2026", { exact: true }) })
      .first();

    await firstListRow.getByRole("button", { name: "Abrir acciones" }).click();
    await firstListRow
      .locator(".user-kebab-menu")
      .getByRole("button", { name: "Activar", exact: true })
      .click();
    await expect
      .poll(
        () =>
          fixture
            .listPriceLists(Number(createdProvider?.id))
            .find((priceList) => priceList.name === "Lista QA 2026")?.is_active,
      )
      .toBe(1);

    await page.getByLabel("Crear lista de precios").click();
    const secondCreateListModal = page.locator(
      ".provider-price-list-create-modal",
    );
    await secondCreateListModal.locator("input").fill("Lista Secundaria QA");
    await secondCreateListModal.locator("select").nth(0).selectOption("2");
    await secondCreateListModal
      .locator("select")
      .nth(1)
      .selectOption("servicio_propio");
    await page
      .getByRole("button", { name: "Crear lista", exact: true })
      .click();

    const secondListRow = listsTable
      .locator("tbody tr")
      .filter({ has: page.getByText("Lista Secundaria QA", { exact: true }) })
      .first();
    await secondListRow.getByRole("button", { name: "Abrir acciones" }).click();
    await secondListRow
      .locator(".user-kebab-menu")
      .getByRole("button", { name: "Activar", exact: true })
      .click();
    await expect(
      page.getByText(
        "Ya existe una lista de precios activa para el proveedor.",
      ),
    ).toBeVisible();

    await firstListRow.click();
    await page.getByRole("button", { name: "Agregar producto" }).click();
    await expect(
      page.getByRole("heading", { name: "Agregar producto" }),
    ).toBeVisible();

    const priceModal = page.locator(".provider-price-item-modal").first();
    await priceModal.locator("input").nth(0).fill("PRICE-QA-01");
    await priceModal.locator('input[type="number"]').fill("2500.50");
    await priceModal.locator("select").nth(0).selectOption("1");
    await priceModal.locator("textarea").fill("Precio agregado por prueba E2E");
    await priceModal
      .getByRole("button", { name: "Agregar producto", exact: true })
      .click();

    await expect(page.getByText("Precio agregado")).toBeVisible();
    await expect(page.getByText("PRICE-QA-01")).toBeVisible();
    await expect(
      page.getByText("Precio agregado por prueba E2E"),
    ).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exportar a Excel" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("lista-precios");

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    const workbook = XLSX.read(await readFile(downloadPath));
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const exportedRows = XLSX.utils.sheet_to_json(worksheet, { raw: false });

    expect(exportedRows).toEqual([
      {
        ID: "2",
        Codigo: "PRICE-QA-01",
        Descripcion: "Precio agregado por prueba E2E",
        Tipo: "Productos",
        Precio: "2,500.50",
        Moneda: "USD",
        Estado: "Activo",
      },
    ]);

    const createdPriceRow = page
      .locator(".provider-price-list-table tbody tr")
      .filter({ has: page.getByText("PRICE-QA-01", { exact: true }) })
      .first();
    await expect(
      createdPriceRow.getByText("Precio agregado por prueba E2E"),
    ).toBeVisible();

    await createdPriceRow
      .getByRole("button", { name: "Abrir acciones" })
      .click();
    await createdPriceRow
      .locator(".user-kebab-menu")
      .getByRole("button", { name: "Editar", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Editar precio" }),
    ).toBeVisible();

    const editPriceModal = page.locator(".provider-price-item-modal").first();
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
          fixture
            .listPriceItems(
              Number(createdProvider?.id),
              Number(createdList?.id),
            )
            .find((item) => item.code === "PRICE-QA-01")?.price,
      )
      .toBe("2750.00");
    await expect(page.getByText("Precio editado por prueba E2E")).toBeVisible();

    await createdPriceRow
      .getByRole("button", { name: "Abrir acciones" })
      .click();
    await createdPriceRow
      .locator(".user-kebab-menu")
      .getByRole("button", { name: "Desactivar", exact: true })
      .click();
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
          fixture
            .listPriceItems(
              Number(createdProvider?.id),
              Number(createdList?.id),
            )
            .find((item) => item.code === "PRICE-QA-01")
            ?.activation_status_code,
      )
      .toBe("inactivo");

    await createdPriceRow
      .getByRole("button", { name: "Abrir acciones" })
      .click();
    await createdPriceRow
      .locator(".user-kebab-menu")
      .getByRole("button", { name: "Activar", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Activar precio" }),
    ).toBeVisible();

    const activateModal = page.locator(".modal-dialog").filter({
      has: page.getByRole("heading", { name: "Activar precio" }),
    });
    await activateModal
      .getByRole("button", { name: "Activar", exact: true })
      .evaluate((element) => element.click());

    await expect
      .poll(
        () =>
          fixture
            .listPriceItems(
              Number(createdProvider?.id),
              Number(createdList?.id),
            )
            .find((item) => item.code === "PRICE-QA-01")
            ?.activation_status_code,
      )
      .toBe("activo");

    await page.getByLabel("Crear lista de precios").click();
    const groupListModal = page.locator(".provider-price-list-create-modal");
    await groupListModal.locator("input").fill("Lista Grupo QA");
    await groupListModal.locator("select").nth(0).selectOption("1");
    await groupListModal
      .locator("select")
      .nth(1)
      .selectOption("grupo_productos");
    await page
      .getByRole("button", { name: "Crear lista", exact: true })
      .click();

    const groupList = fixture
      .listPriceLists(Number(createdProvider?.id))
      .find((priceList) => priceList.name === "Lista Grupo QA");
    expect(groupList).toBeTruthy();

    const groupListRow = listsTable
      .locator("tbody tr")
      .filter({ has: page.getByText("Lista Grupo QA", { exact: true }) })
      .first();
    await groupListRow.click();

    await page.getByRole("button", { name: "Agregar producto" }).click();
    const groupPriceModal = page
      .locator(".provider-price-item-modal-group")
      .first();
    const groupCodeInput = groupPriceModal.getByPlaceholder(
      "Ej. GP-SERVICIOS-001",
    );
    await expect(groupCodeInput).toBeEditable();
    await groupCodeInput.fill("GP-MANUAL-BASE");
    const groupCodeSelects = groupPriceModal.locator(
      ".provider-group-code-panel select",
    );
    await groupCodeSelects.nth(0).selectOption("1");
    await expect(
      groupPriceModal.locator(
        '.provider-group-code-panel input[placeholder="Se detecta automaticamente"]',
      ),
    ).toHaveValue("Lista vigente");
    const baseItemPicker = groupPriceModal
      .locator(".provider-group-item-picker")
      .first();
    await baseItemPicker
      .getByPlaceholder("Busca por codigo o descripcion")
      .fill("PRICE-DEMO");
    await baseItemPicker
      .locator(".provider-group-search-results-code")
      .getByRole("button", { name: /PRICE-DEMO-001/i })
      .click();
    await expect(groupCodeInput).toHaveValue("PRICE-DEMO-001");
    await expect(groupPriceModal.locator("textarea")).toHaveValue(
      "Precio inicial demo",
    );
    await groupCodeInput.fill("PRICE-DEMO-001-AJUSTADO");

    const componentsSection = groupPriceModal.locator(
      ".provider-group-search-section",
    );
    const componentSelects = componentsSection.locator("select");
    await componentSelects.nth(0).selectOption("1");
    await expect(
      componentsSection.locator(
        'input[placeholder="Se detecta automaticamente"]',
      ),
    ).toHaveValue("Lista vigente");
    await componentsSection
      .getByPlaceholder("Busca por codigo o descripcion")
      .fill("PRICE-DEMO-001");
    const componentResults = componentsSection.locator(
      ".provider-group-search-results-compact",
    );
    await expect(componentResults).toBeVisible();
    await expect(componentResults.getByText("PRICE-DEMO-001")).toBeVisible();
    await componentResults
      .locator(".provider-group-search-card")
      .filter({ hasText: "PRICE-DEMO-001" })
      .getByRole("button", { name: "Agregar", exact: true })
      .click();
    await expect(
      groupPriceModal.locator(".provider-group-components-table"),
    ).toContainText("PRICE-DEMO-001");
    await expect(
      groupPriceModal.locator(".provider-group-components-table"),
    ).toContainText(/1,999\.99|1999\.99/);
    await groupPriceModal
      .getByRole("button", { name: "Agregar producto", exact: true })
      .click();

    await expect
      .poll(
        () =>
          fixture
            .listPriceItems(Number(createdProvider?.id), Number(groupList?.id))
            .find((item) => item.code === "PRICE-DEMO-001-AJUSTADO")?.components
            ?.length,
      )
      .toBe(1);
  });
});
