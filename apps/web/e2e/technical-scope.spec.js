import { expect, test } from "@playwright/test";

const catalog = [
  { code: "f5_dcs", name: "F5 Distributed Cloud Services", manufacturer: "F5", status: "borrador_ia", ragTopicName: "F5 Distributed Cloud Services", modules: [{ code: "waap", name: "WAAP", description: "" }, { code: "bot_defense", name: "Bot Defense", description: "" }] },
  { code: "bluecat_micetro", name: "BlueCat Micetro", manufacturer: "BlueCat", status: "borrador_ia", ragTopicName: "BlueCat Micetro", modules: [{ code: "micetro", name: "Micetro", description: "" }] },
];

const quotationItems = [
  { productCode: "XC-WAAP-1", productDescription: "F5 Distributed Cloud WAAP", quantity: 2, groupTitle: "Seguridad" },
];

const topology = {
  version: 1,
  title: "",
  zones: [{ id: "z1", label: "F5 Distributed Cloud", kind: "cloud", x: 300, y: 30, w: 240, h: 130 }],
  nodes: [
    { id: "users", label: "Usuarios", kind: "user", zoneId: null, x: 30, y: 60, w: 170, h: 58, locked: false, itemRef: "" },
    { id: "re", label: "Regional Edge", sublabel: "WAAP", kind: "f5_xc_re", zoneId: "z1", x: 330, y: 70, w: 170, h: 58, locked: false, itemRef: "XC-WAAP-1" },
  ],
  edges: [{ id: "e1", source: "users", target: "re", label: "HTTPS", style: "solid" }],
};

function buildScope(state) {
  return {
    id: 1,
    proposalDocumentId: 7,
    opportunityId: 9,
    quotationVersionId: 3,
    status: state.status,
    playbookCodes: [{ code: "f5_dcs", versionNumber: 1, modules: ["waap"] }],
    sections: state.generated
      ? [
          { code: "proposed_solution", title: "Solucion propuesta", blocks: [{ type: "paragraph", text: "Solución con WAAP", items: [], table: null }], content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Solución con WAAP" }] }] }, itemRefs: ["XC-WAAP-1"], sources: [{ kind: "quotation", ref: "XC-WAAP-1", label: "" }], edited: false },
          { code: "scope_included", title: "Alcance incluido", blocks: [{ type: "list", text: "", items: ["Configuración de políticas"], table: null }], content: { type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Configuración de políticas" }] }] }] }] }, itemRefs: [], sources: [], edited: state.edited },
        ]
      : [],
    topology: state.topology,
    asisTopology: null,
    contentHash: "h".repeat(64),
    approvedHash: state.status === "approved" ? "h".repeat(64) : null,
    approvedAt: state.status === "approved" ? "2026-10-29T10:00:00.000Z" : null,
    approvalComment: "",
    selfApproved: state.selfApproved,
    printable: state.status === "approved",
    updatedAt: `2026-10-29T10:00:0${state.version}.000Z`,
  };
}

function buildOverview(state) {
  const scope = state.started ? buildScope(state) : null;
  return {
    capabilities: { canEdit: true, canApprove: true, canManagePlaybooks: false, isPresales: true },
    catalog,
    sectionCatalog: [],
    suggestedPlaybooks: [{ code: "f5_dcs", name: "F5 Distributed Cloud Services", modules: ["waap"], score: 2 }],
    quotationItems,
    scope,
    ...(scope
      ? {
          stale: { quotationChanged: false, answersChanged: false },
          questions: [
            { playbookCode: "f5_dcs", code: "apps_count", module: "general", section: "Aplicaciones", prompt: "¿Cuántas aplicaciones se protegerán?", type: "number", options: [], required: true, helpText: "", unit: "apps", answer: state.answered ? { value: 12, status: "confirmed", sourceType: "manual", sourceRef: "", confidence: null } : null },
            { playbookCode: "f5_dcs", code: "waap_mode", module: "waap", section: "WAAP", prompt: "¿En qué modo se desplegarán las políticas?", type: "choice", options: ["Monitoreo", "Bloqueo"], required: false, helpText: "", unit: "", answer: null },
          ],
          coverage: { total: 2, confirmed: state.answered ? 1 : 0, suggestedPending: 0, requiredMissing: state.answered ? [] : [{ playbookCode: "f5_dcs", questionCode: "apps_count", prompt: "x" }] },
          verification: state.generated ? { findings: [{ code: "topology_missing", severity: "warning", message: "El alcance no incluye topologia.", ref: "" }], blocking: 0, warnings: 1 } : null,
          extractions: [],
        }
      : {}),
  };
}

const documentsPath = "/api/proposal-documents/v1/proposal-documents";

const documentDetail = {
  proposal_document: { id: 7, title: "Propuesta WAAP", status: "draft", opportunity_id: 9 },
  active_version: {
    id: 1,
    version_number: 1,
    content: { schema_version: 3, metadata: {}, document: { type: "doc", content: [] }, sections: [], removed_sections: [] },
  },
  versions: [],
};

test("alcance técnico: iniciar, responder, generar, editar la topología y aprobar", async ({ page }) => {
  const state = { started: false, answered: false, generated: false, edited: false, status: "draft", selfApproved: false, topology: null, version: 0 };
  const calls = [];
  await page.addInitScript(() => window.localStorage.setItem("crm_token", "ts-test"));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    const method = route.request().method();
    if (pathname === "/api/auth/bootstrap-status") return route.fulfill({ json: { hasUsers: true } });
    if (pathname === "/api/auth/me") {
      return route.fulfill({ json: { id: 7, full_name: "Preventa", email: "p@example.test", permissions: ["propuestas.read", "propuestas.update", "propuestas.alcance_tecnico.update", "propuestas.alcance_tecnico.approve"] } });
    }
    if (pathname === documentsPath && method === "GET") {
      return route.fulfill({
        json: {
          items: [{ id: 7, title: "Propuesta WAAP", status: "draft", client_name: "Salud SA", seller_name: "Ana", technical_scope_status: state.started ? state.status : null, updated_at: "2026-10-29T10:00:00.000Z" }],
          pagination: { page: 1, page_size: 25, total: 1 },
        },
      });
    }
    if (pathname === `${documentsPath}/7` && method === "GET") return route.fulfill({ json: documentDetail });
    if (pathname === `${documentsPath}/7/technical-scope/gate`) {
      return route.fulfill({
        json: state.started
          ? { applies: true, allowed: state.status === "approved", reason: "not_approved", message: "El alcance técnico de la propuesta debe estar aprobado antes de abrir el PDF, enviarla o finalizarla", status: state.status, sowPrintable: false }
          : { applies: false, allowed: true, sowPrintable: false },
      });
    }
    if (pathname.startsWith(`${documentsPath}/7/technical-scope`)) {
      const sub = pathname.replace(`${documentsPath}/7/technical-scope`, "");
      const body = route.request().postData() ? route.request().postDataJSON() : null;
      calls.push({ method, sub, body });
      if (method === "POST" && sub === "") state.started = true;
      if (method === "PUT" && sub === "/answers") state.answered = true;
      if (method === "POST" && sub === "/generate") {
        state.generated = true;
        state.version += 1;
        return route.fulfill({ json: { warnings: ["Aviso de prueba"], usedAi: false, overview: buildOverview(state) } });
      }
      if (method === "PUT" && sub === "/topology") {
        state.topology = body.topology;
        state.version += 1;
      }
      if (method === "POST" && sub === "/topology/propose") {
        return route.fulfill({ json: { topology, warnings: [] } });
      }
      if (method === "POST" && sub === "/submit") state.status = "in_review";
      if (method === "POST" && sub === "/approve") {
        state.status = "approved";
        state.selfApproved = true;
        return route.fulfill({ json: { selfApproved: true, overview: buildOverview(state) } });
      }
      if (method === "POST" && sub === "/answers/confirm") return route.fulfill({ json: buildOverview(state) });
      return route.fulfill({ json: buildOverview(state) });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto("/proposals-new");
  await page.getByText("Propuesta WAAP").dblclick();
  await expect(page.getByText("Propuesta básica")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver PDF" })).toBeEnabled();
  await page.getByRole("button", { name: "Alcance técnico y SOW" }).click();
  const panel = page.getByRole("dialog", { name: "Alcance técnico y SOW" });
  await expect(panel).toBeVisible();

  await expect(panel.getByText("Esta propuesta aún no tiene alcance técnico")).toBeVisible();
  await expect(panel.getByText("Sugerida por la cotización")).toBeVisible();
  await panel.getByRole("button", { name: "Iniciar alcance técnico" }).click();
  expect(calls.find((call) => call.method === "POST" && call.sub === "").body.selections).toEqual([{ code: "f5_dcs", modules: ["waap"] }]);

  await expect(page.getByRole("button", { name: "Ver PDF" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Finalizar propuesta" })).toBeDisabled();
  await expect(panel.getByLabel("Avance del cuestionario")).toContainText("0 confirmadas");
  await expect(panel.getByLabel("Avance del cuestionario")).toContainText("2 sin responder");
  await panel.getByLabel("¿Cuántas aplicaciones se protegerán?").fill("12");
  await panel.getByRole("button", { name: /Guardar respuestas/ }).click();
  await expect(panel.getByLabel("Avance del cuestionario")).toContainText("1 confirmadas");
  await expect(panel.getByLabel("Avance del cuestionario")).toContainText("1 sin responder");
  expect(calls.find((call) => call.sub === "/answers").body.answers).toEqual([{ playbookCode: "f5_dcs", questionCode: "apps_count", value: "12" }]);

  await panel.getByRole("tab", { name: "Alcance" }).click();
  await panel.getByRole("button", { name: "Generar alcance" }).click();
  await expect(panel.getByText("Aviso de prueba")).toBeVisible();
  await panel.getByText("Solucion propuesta").click();
  const editor = panel.getByRole("textbox", { name: "Solucion propuesta" });
  await expect(editor).toContainText("Solución con WAAP");
  await expect(panel.getByRole("button", { name: "Guardar sección" })).toBeDisabled();
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" y bot defense");
  await panel.getByRole("button", { name: "Negrita" }).click();
  await panel.getByRole("button", { name: "Guardar sección" }).click();
  await expect.poll(() => calls.find((call) => call.method === "PUT" && call.sub === "/sections/proposed_solution")?.body?.content?.type).toBe("doc");
  expect(JSON.stringify(calls.find((call) => call.sub === "/sections/proposed_solution").body.content)).toContain("y bot defense");
  await panel.getByRole("button", { name: "Vista previa del documento" }).click();
  await expect(panel.getByRole("heading", { name: "Alcance incluido" })).toBeVisible();
  await expect(panel.getByText("Configuración de políticas")).toBeVisible();
  await panel.getByRole("button", { name: "Volver a las secciones" }).click();

  await panel.getByRole("tab", { name: "Topología" }).click();
  await panel.getByRole("button", { name: "Proponer desde el playbook" }).click();
  await expect(panel.getByText("Propuesta sin guardar")).toBeVisible();
  await expect(panel.locator(".react-flow__node").filter({ hasText: "Regional Edge" })).toBeVisible();
  await panel.getByLabel("Ver como se imprimirá").check();
  await expect(panel.locator(".ts-svg-preview svg")).toContainText("Regional Edge");
  await panel.getByRole("button", { name: "Guardar topología" }).click();
  await expect.poll(() => calls.find((call) => call.method === "PUT" && call.sub === "/topology")?.body?.topology?.nodes?.length).toBe(2);
  const saved = calls.find((call) => call.sub === "/topology").body;
  expect(saved.kind).toBe("proposed");
  expect(saved.topology.nodes.find((node) => node.id === "re").zoneId).toBe("z1");

  await panel.getByRole("tab", { name: "Revisión y aprobación" }).click();
  await expect(panel.getByText("La propuesta no se puede imprimir ni enviar por correo hasta que el alcance técnico esté aprobado.")).toBeVisible();
  await expect(panel.getByText("El alcance no incluye topologia.")).toBeVisible();
  await panel.getByRole("button", { name: "Enviar a revisión" }).click();
  const approve = panel.getByRole("button", { name: "Aprobar", exact: true });
  await expect(approve).toBeDisabled();
  await panel.getByLabel(/Revisé los supuestos/).check();
  await panel.getByLabel(/hallazgos de la verificación/).check();
  await panel.getByLabel(/Revisé la topología/).check();
  await approve.click();

  await expect(panel.getByText(/Alcance aprobado \(queda registrado/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver PDF" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Finalizar propuesta" })).toBeEnabled();
  await expect(panel.getByText("La propuesta se puede imprimir y enviar con este alcance aprobado.")).toBeVisible();
  expect(calls.find((call) => call.sub === "/approve").body.checklist).toEqual({ assumptionsReviewed: true, findingsResolved: true, topologyReviewed: true });
});

test("playbooks técnicos: lista, edita el contenido y guarda una nueva versión", async ({ page }) => {
  const saves = [];
  const content = { summary: "Resumen", modules: [], questions: [], scope: { included: ["a"] } };
  await page.addInitScript(() => window.localStorage.setItem("crm_token", "ts-test"));
  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    if (pathname === "/api/auth/bootstrap-status") return route.fulfill({ json: { hasUsers: true } });
    if (pathname === "/api/auth/me") {
      return route.fulfill({ json: { id: 1, full_name: "Admin", email: "a@example.test", permissions: ["playbooks.manage"] } });
    }
    if (pathname === "/api/technical-playbooks" && method === "GET") {
      return route.fulfill({ json: { playbooks: [{ code: "f5_nginx", name: "F5 NGINX", manufacturer: "F5", status: "borrador_ia", currentVersionNumber: 1, ragTopicName: "F5 NGINX", detectionKeywords: ["nginx"] }] } });
    }
    if (pathname === "/api/technical-playbooks/rag-topics") {
      return route.fulfill({ json: { topics: [{ name: "F5 NGINX", description: "", documentCount: 3 }, { name: "BlueCat", description: "", documentCount: 45 }] } });
    }
    if (pathname === "/api/technical-playbooks/diagnostic") {
      return route.fulfill({ json: { diagnostic: [{ playbookCode: "f5_nginx", playbookName: "F5 NGINX", opportunities: 4, byCommercialStatus: { ganada: 1, en_proceso: 3 }, proposals: 2, quotations: 4, documents: 1, stageAnswers: 12 }] } });
    }
    if (pathname === "/api/technical-playbooks/f5_nginx" && method === "GET") {
      return route.fulfill({ json: { currentVersionInUse: false, playbook: { code: "f5_nginx", name: "F5 NGINX", status: "borrador_ia", currentVersionNumber: 1, ragTopicName: "F5 NGINX", detectionKeywords: ["nginx"], content }, versions: [{ id: 1, versionNumber: 1, status: "borrador_ia", generatedBy: "seed", notes: "Semilla", createdAt: "2026-10-29T10:00:00.000Z" }], suggestions: [] } });
    }
    if (method === "PATCH") return route.fulfill({ json: { playbook: {} } });
    if (pathname === "/api/technical-playbooks/f5_nginx" && method === "PUT") {
      const body = route.request().postDataJSON();
      saves.push(body);
      return route.fulfill({ json: { playbook: {}, overwritten: Boolean(body.overwriteCurrent) } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto("/technical-playbooks");
  await expect(page.getByRole("heading", { name: "Playbooks técnicos por solución" })).toBeVisible();
  await page.getByRole("button", { name: "Ejecutar diagnóstico de datos del CRM" }).click();
  await expect(page.getByRole("heading", { name: "Diagnóstico de datos del CRM" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "4", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Editar" }).click();
  await expect(page.getByRole("heading", { name: /F5 NGINX · versión 1/ })).toBeVisible();

  await page.getByLabel(/Contenido del playbook/).fill("{ no es json");
  await page.getByRole("button", { name: "Guardar como nueva versión" }).click();
  await expect(page.getByText("El contenido no es un JSON válido")).toBeVisible();
  expect(saves).toHaveLength(0);

  await expect(page.getByLabel("Tema de Documentación RAG")).toHaveValue("F5 NGINX");
  await expect(page.getByLabel("Tema de Documentación RAG").locator("option")).toHaveText(["Sin tema", "F5 NGINX (3 documentos)", "BlueCat (45 documentos)"]);

  await page.getByLabel(/Contenido del playbook/).fill(JSON.stringify({ ...content, summary: "Resumen nuevo" }));
  await page.getByRole("button", { name: "Guardar cambios en la versión 1" }).click();
  await expect(page.getByText("Cambios guardados en la versión actual")).toBeVisible();
  expect(saves[0].overwriteCurrent).toBe(true);
  expect(saves[0].status).toBe("borrador_ia");

  await page.getByLabel("Estado").selectOption("validado");
  await expect(page.getByRole("button", { name: /Guardar cambios en la versión/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Guardar como nueva versión" }).click();
  await expect(page.getByText("Nueva versión guardada")).toBeVisible();
  expect(saves[1].status).toBe("validado");
  expect(saves[1].overwriteCurrent).toBe(false);
  expect(saves[0].content.summary).toBe("Resumen nuevo");
});
