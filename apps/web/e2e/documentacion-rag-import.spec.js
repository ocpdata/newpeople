import { expect, test } from "@playwright/test";

async function mockLibrary(page, { canManage = true, conflict = false, failPreview = false, failImport = false } = {}) {
  const topic = { id: "topic-bluecat", name: "BlueCat", isActive: true };
  const file = {
    fileId: "file-1", fileName: "BlueCat.pdf", documentId: "doc-1", versionId: "v1",
    status: conflict ? "topic_conflict" : "importable",
    reason: conflict ? "Selecciona un tema local." : "Tema: BlueCat",
  };
  let imported = false;
  const submissions = [];
  await page.addInitScript(() => localStorage.setItem("crm_token", "test-token"));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/auth/bootstrap-status") return json({ hasUsers: true });
    if (path === "/api/auth/me") return json({
      id: 1, full_name: "Biblioteca", email: "library@example.com", status: "active",
      roles: [], permissions: ["documentacion_rag.access", ...(canManage ? ["documentacion_rag.manage"] : [])],
    });
    if (path === "/api/documentacion-rag/bootstrap") return json({
      pineconeConfigured: true, topics: [topic],
      documents: imported ? [{
        id: "doc-1", topicId: topic.id, fileName: "BlueCat.pdf",
        status: "available", summaryStatus: "pending", byteSize: 0,
      }] : [],
    });
    if (path === "/api/documentacion-rag/pinecone-import/preview") {
      return failPreview ? json({ message: "Pinecone no disponible" }, 502)
        : json({ assistantName: "library", topics: [topic], files: [
          file, { fileId: "file-blocked", fileName: "Procesando.pdf", status: "blocked", reason: "Archivo no disponible (Processing)." },
        ] });
    }
    if (path === "/api/documentacion-rag/pinecone-import") {
      submissions.push(route.request().postDataJSON());
      if (failImport) return json({ message: "Falló la importación" }, 502);
      imported = true;
      return json({ results: [{ ...file, status: "imported", reason: "Importado correctamente." }] });
    }
    return json({});
  });
  await page.goto("/documentacion-rag");
  await expect(page.getByRole("heading", { name: "Base de conocimiento IA", exact: true })).toBeVisible();
  return submissions;
}

test("previsualiza, importa sin cargar archivos y actualiza la biblioteca", async ({ page }) => {
  const submissions = await mockLibrary(page);
  await page.getByRole("button", { name: "Importar desde Pinecone", exact: true }).click();
  const preview = page.getByRole("region", { name: "Importar desde Pinecone" });
  await expect(preview.getByText("library", { exact: true })).toBeVisible();
  await expect(preview.getByRole("checkbox", { name: "Importar Procesando.pdf" })).toBeDisabled();
  await expect(preview.getByRole("button", { name: "Importar seleccionados" })).toBeDisabled();
  await preview.getByRole("checkbox", { name: "Importar BlueCat.pdf" }).check();
  await expect(preview.getByText("1 seleccionado", { exact: true })).toBeVisible();
  await preview.getByRole("button", { name: "Importar seleccionados" }).click();
  await expect(preview.getByText("Importado correctamente.")).toBeVisible();
  expect(submissions).toEqual([{
    assistantName: "library", selections: [{ fileId: "file-1", documentId: "doc-1", versionId: "v1" }],
  }]);
  await preview.getByRole("button", { name: "Cerrar" }).click();
  await expect(page.getByRole("heading", { name: "BlueCat.pdf" })).toBeVisible();
  await expect(page.getByText("Disponible", { exact: true })).toBeVisible();
  await expect(page.getByText("Tamaño no disponible")).toBeVisible();
});

test("mantiene la selección alineada y sin desbordamientos en móvil", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLibrary(page);
  await page.getByRole("button", { name: "Importar desde Pinecone", exact: true }).click();
  const preview = page.getByRole("region", { name: "Importar desde Pinecone" });
  await expect(preview.getByText("Listo para importar", { exact: true })).toBeVisible();
  const row = preview.locator(".documentacion-rag-import-row").first();
  const checkbox = await row.getByRole("checkbox").boundingBox();
  const title = await row.locator("strong").boundingBox();
  expect(Math.abs((checkbox.y + checkbox.height / 2) - (title.y + title.height / 2))).toBeLessThan(3);
  expect(await preview.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await row.locator("strong").evaluate((element) => {
    element.textContent = "BlueCat_Networks_Soluciones_Beneficios_RAG_documento_nombre_largo.pdf";
  });
  expect(await preview.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("requiere asociación explícita para un conflicto de temas", async ({ page }) => {
  const submissions = await mockLibrary(page, { conflict: true });
  await page.getByRole("button", { name: "Importar desde Pinecone", exact: true }).click();
  const checkbox = page.getByRole("checkbox", { name: "Importar BlueCat.pdf" });
  await expect(checkbox).toBeDisabled();
  await page.getByRole("combobox", { name: "Tema para BlueCat.pdf" }).selectOption("topic-bluecat");
  await checkbox.check();
  await page.getByRole("button", { name: "Importar seleccionados" }).click();
  await expect(page.getByText("Importado correctamente.")).toBeVisible();
  expect(submissions[0].selections[0].topicId).toBe("topic-bluecat");
});

test("no ofrece importar a usuarios de solo lectura", async ({ page }) => {
  await mockLibrary(page, { canManage: false });
  await expect(page.getByRole("button", { name: "Importar desde Pinecone" })).toHaveCount(0);
});

test("muestra errores de Pinecone sin afirmar que la biblioteca está vacía", async ({ page }) => {
  await mockLibrary(page, { failPreview: true });
  await page.getByRole("button", { name: "Importar desde Pinecone", exact: true }).click();
  await expect(page.getByText("Pinecone no disponible", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Importar desde Pinecone" })).toHaveCount(0);
});

test("muestra el error al importar sin anunciar éxito", async ({ page }) => {
  await mockLibrary(page, { failImport: true });
  await page.getByRole("button", { name: "Importar desde Pinecone", exact: true }).click();
  await page.getByRole("checkbox", { name: "Importar BlueCat.pdf" }).check();
  await page.getByRole("button", { name: "Importar seleccionados" }).click();
  await expect(page.getByText("Falló la importación", { exact: true })).toBeVisible();
  await expect(page.getByText("Importado correctamente.")).toHaveCount(0);
});
