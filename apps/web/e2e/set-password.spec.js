import { expect, test } from "@playwright/test";

test.describe("set-password", () => {
  test("muestra contexto del enlace y redirige al dashboard despues de guardar", async ({ page }) => {
    await page.route("**/api/auth/set-password-context**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          fullName: "Invited Seller",
          email: "seller@example.com",
          purpose: "invite",
          expiresAt: "2026-05-01T18:30:00.000Z",
        }),
      });
    });

    await page.route("**/api/auth/set-password", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: "jwt-token",
          user: {
            id: 10,
            full_name: "Invited Seller",
            email: "seller@example.com",
            status: "active",
          },
          message: "Contrasena configurada correctamente",
        }),
      });
    });

    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 10,
          full_name: "Invited Seller",
          email: "seller@example.com",
          status: "active",
          permissions: ["usuarios.read"],
        }),
      });
    });

    await page.goto("/set-password?token=valid-token");

    await expect(page.getByText("Invited Seller")).toBeVisible();
    await expect(page.getByText("seller@example.com")).toBeVisible();
    await expect(page.getByText(/Vigente hasta el/i)).toBeVisible();

    await page.getByLabel("Nueva contrasena").fill("NuevaPass123");
    await page.getByLabel("Confirmar contrasena").fill("NuevaPass123");
    await page.getByRole("button", { name: "Guardar contrasena" }).click();

    await expect(page.getByText(/Redirigiendo al dashboard/i)).toBeVisible();
    await page.waitForURL("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("muestra error cuando el enlace ya no es valido", async ({ page }) => {
    await page.route("**/api/auth/set-password-context**", async (route) => {
      await route.fulfill({
        status: 410,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Este enlace ya expiro",
        }),
      });
    });

    await page.goto("/set-password?token=expired-token");

    await expect(page.getByText("Este enlace ya expiro")).toBeVisible();
    await expect(page.getByRole("button", { name: "Guardar contrasena" })).toBeDisabled();
  });
});