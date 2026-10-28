import { expect, test } from "@playwright/test";

const catalogs = {
  asset_type: [{ code: "case_study", name: "Caso de éxito", publicId: "t1" }],
  manufacturer: [
    { code: "fortinet", name: "Fortinet", publicId: "m1" },
    { code: "cisco", name: "Cisco", publicId: "m2" },
  ],
  technology: [{ code: "firewall", name: "Firewall", publicId: "g1" }],
  solution: [],
  industry: [],
  language: [],
  competitor: [],
};

function material(overrides) {
  return {
    id: 1,
    publicId: "cea_1",
    title: "Fortinet salud caso de éxito",
    summary: "Resumen del caso.",
    usageNote: "Ideal para discovery con CIO de salud",
    assetTypeCode: "case_study",
    assetTypeLabel: "Caso de éxito",
    status: "published",
    statusLabel: "Activo",
    isActive: true,
    isExpired: false,
    expiresAt: null,
    isShareable: true,
    visibilityLevel: "client_safe",
    languageCode: "es",
    sourceType: "file",
    isFavorite: false,
    canEdit: false,
    canToggle: false,
    canDelete: false,
    catalogs: [{ catalogType: "manufacturer", code: "fortinet", name: "Fortinet" }],
    tags: [],
    files: [
      {
        publicId: "cef_1",
        originalFileName: "caso.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileExtension: ".docx",
        byteSize: 2048,
        isAvailable: true,
      },
    ],
    links: [],
    relatedItems: [],
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

async function openLibrary(page, { permissions, canUpload = false, items }) {
  const requests = [];
  await page.addInitScript(() => {
    window.localStorage.setItem("crm_token", "library-test");
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    if (pathname === "/api/auth/bootstrap-status") {
      return route.fulfill({ json: { hasUsers: true } });
    }
    if (pathname === "/api/auth/me") {
      return route.fulfill({
        json: { id: 7, full_name: "Vendedor", email: "v@example.test", permissions },
      });
    }
    if (pathname === "/api/commercial-enablement/bootstrap") {
      return route.fulfill({
        json: {
          permissions: { canUse: true, canUpload, canManage: false, canAdmin: false },
          catalogs,
          adminCatalogs: catalogs,
        },
      });
    }
    requests.push({
      method: route.request().method(),
      pathname,
      search: Object.fromEntries(url.searchParams),
      body: route.request().postData(),
    });
    if (pathname === "/api/commercial-enablement/assets") {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 201,
          json: material({ publicId: "cea_new", title: "Nuevo", status: "archived" }),
        });
      }
      return route.fulfill({
        json: { page: 1, pageSize: 24, total: items.length, hasMore: false, items },
      });
    }
    const detail = pathname.match(/^\/api\/commercial-enablement\/assets\/([^/]+)$/);
    if (detail) {
      return route.fulfill({ json: items.find((item) => item.publicId === detail[1]) });
    }
    if (pathname.endsWith("/links")) {
      return route.fulfill({ status: 201, json: material({ publicId: "cea_new" }) });
    }
    if (pathname.endsWith("/activate")) {
      return route.fulfill({ json: material({ publicId: "cea_new", title: "Nuevo" }) });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/commercial-enablement");
  return requests;
}

test("busca en el servidor, muestra insignias y abre el panel del material", async ({ page }) => {
  const items = [
    material({}),
    material({
      id: 2,
      publicId: "cea_2",
      title: "Playbook interno Cisco",
      assetTypeLabel: "Playbook",
      isShareable: false,
      visibilityLevel: "internal_sales",
      usageNote: "",
    }),
  ];
  const requests = await openLibrary(page, {
    permissions: ["enablement_comercial.use"],
    items,
  });

  await expect(page.getByRole("heading", { name: "Biblioteca de ventas" })).toBeVisible();
  await expect(page.getByText("2 materiales")).toBeVisible();
  await expect(page.getByText("Para cliente").first()).toBeVisible();
  await expect(page.getByText("Solo interno").first()).toBeVisible();

  await page.getByLabel("Buscar material").fill("fortinet salud");
  await expect
    .poll(() =>
      requests.some(
        (request) =>
          request.pathname === "/api/commercial-enablement/assets" &&
          request.search.q === "fortinet salud",
      ),
    )
    .toBe(true);

  await page.getByRole("tab", { name: "Recientes" }).click();
  await expect
    .poll(() => requests.some((request) => request.search.shortcut === "recent"))
    .toBe(true);

  await page.getByRole("button", { name: "Ver Fortinet salud caso de éxito" }).click();
  const panel = page.getByRole("complementary", { name: "Detalle del material" });
  await expect(panel.getByRole("heading", { name: "Fortinet salud caso de éxito" })).toBeVisible();
  await expect(panel.getByText("Ideal para discovery con CIO de salud")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Copiar enlace" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Editar" })).toHaveCount(0);

  await panel.getByRole("button", { name: "Cerrar detalle" }).click();
  await page.getByRole("button", { name: "Ver Playbook interno Cisco" }).click();
  await expect(
    page.getByText("Material solo interno: no lo envíes ni lo compartas con clientes."),
  ).toBeVisible();
  await expect(panel.getByRole("button", { name: "Copiar enlace" })).toHaveCount(0);
});

test("copia el enlace compartible y avisa cuando vence", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openLibrary(page, {
    permissions: ["enablement_comercial.use"],
    items: [material({})],
  });
  // Se registra después para tener prioridad sobre el mock general de la API.
  await page.route("**/api/commercial-enablement/assets/cea_1/share-link", (route) =>
    route.fulfill({
      json: {
        url: "http://localhost/api/public/library-shares/abc/download",
        expiresAt: "2026-11-27T10:00:00.000Z",
      },
    }),
  );

  await page.getByRole("button", { name: "Ver Fortinet salud caso de éxito" }).click();
  await page
    .getByRole("complementary", { name: "Detalle del material" })
    .getByRole("button", { name: "Copiar enlace" })
    .click();

  await expect(page.getByText(/Enlace copiado\. Vence el/)).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "http://localhost/api/public/library-shares/abc/download",
  );
});

test("sube un material por enlace y lo publica como activo", async ({ page }) => {
  const requests = await openLibrary(page, {
    permissions: ["enablement_comercial.use", "enablement_comercial.upload"],
    canUpload: true,
    items: [],
  });

  await expect(page.getByText("Aún no hay materiales en la biblioteca.")).toBeVisible();
  await page.getByRole("button", { name: "Subir" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Enlace (URL)" }).click();
  await dialog.getByLabel("URL del material").fill("https://example.com/folleto");
  await dialog.getByRole("button", { name: "Continuar" }).click();

  await expect(dialog.getByRole("button", { name: "Siguiente" })).toBeDisabled();
  await dialog.getByLabel("Título").fill("Folleto de prueba");
  await dialog.getByLabel("Tipo").selectOption("case_study");
  await dialog.getByRole("button", { name: "Fortinet" }).click();
  await dialog.getByRole("button", { name: "Siguiente" }).click();

  await expect(dialog.getByText("¿Se puede enviar al cliente?")).toBeVisible();
  await expect(dialog.getByText(/vence a los 30 días/)).toBeVisible();
  await dialog.getByRole("button", { name: "Publicar" }).click();

  await expect(page.getByText("Material publicado.")).toBeVisible();
  const paths = requests.map((request) => `${request.method} ${request.pathname}`);
  expect(paths).toContain("POST /api/commercial-enablement/assets");
  expect(paths).toContain("POST /api/commercial-enablement/assets/cea_new/links");
  expect(paths).toContain("POST /api/commercial-enablement/assets/cea_new/activate");
  const created = requests.find(
    (request) => request.method === "POST" && request.pathname === "/api/commercial-enablement/assets",
  );
  expect(JSON.parse(created.body)).toEqual(
    expect.objectContaining({
      status: "archived",
      sourceType: "url",
      manufacturerCodes: ["fortinet"],
      visibilityLevel: "client_safe",
    }),
  );
});
