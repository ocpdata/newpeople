import { expect, test } from "@playwright/test";

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
          created_by_name: "Demo Seller",
          created_at: "2026-04-21T10:00:00.000Z",
          updated_by_name: "Demo Seller",
          updated_at: "2026-04-21T11:00:00.000Z",
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
        return json([{ id: 1, name: "Contacto inicial", code: "contacto_inicial" }]);
      }

      if (pathname === "/api/catalogs/opportunity-activation-statuses") {
        return json([{ id: 1, name: "Activada", code: "activada" }]);
      }

      return json({ message: `Unhandled route: ${pathname}` }, 500);
    });

    await page.goto("http://127.0.0.1:4173/contacts");

    await expect(page.getByRole("heading", { name: "Contactos" })).toBeVisible();

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
});