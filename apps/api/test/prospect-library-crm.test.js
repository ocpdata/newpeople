import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAccountOwners, loadSimilarCustomers, matchEconomicSector, shapeSimilarCustomers } from "../src/prospect-research/prospect-crm-lookups.js";
import { buildConversionReadiness, buildProspectCrmContext, readinessAnswer } from "../src/prospect-research/prospect-crm-context.js";
import { detectGuardedTurn } from "../src/prospect-research/prospect-guards.js";
import { classifyChannelIntent } from "../src/coach/channel-intents.js";
import { prospectBank, resolveBankSessions } from "../src/channel-quality/live/prospect-live.js";

const sessions = resolveBankSessions();
const sectors = [{ id: 1, name: "Otros" }, { id: 2, name: "Industria" }, { id: 3, name: "Tecnologia de Información" }, { id: 4, name: "Salud" }];

describe("sector del prospecto", () => {
  it("reconoce el sector por palabras compartidas e ignora «Otros»", () => {
    expect(matchEconomicSector("Industrial", sectors)).toMatchObject({ id: 2 });
    expect(matchEconomicSector("Tecnología", sectors)).toMatchObject({ id: 3 });
    expect(matchEconomicSector("Siderurgia", sectors)).toBeNull();
    expect(matchEconomicSector("Otros servicios", sectors)).toBeNull();
    expect(matchEconomicSector("", sectors)).toBeNull();
  });
});

describe("clientes parecidos con los permisos del vendedor", () => {
  const rows = [
    { id: 301, name: "Metales del Bajío", country_name: "México", sector_name: "Industria", wins: 3, last_win: new Date("2026-05-12T10:00:00Z") },
    { id: 302, name: "Forja Monterrey", country_name: "México", sector_name: "Industria", wins: 1, last_win: null },
  ];
  const runWith = (responses) => {
    const run = vi.fn(async (sql) => {
      if (sql.includes("FROM economic_sectors")) return sectors;
      if (sql.includes("FROM accounts a")) return responses.accounts;
      if (sql.includes("opportunity_business_lines")) return responses.lines || [];
      return [];
    });
    return run;
  };

  it("busca por sector y país, resume las ventas por línea y excluye las cuentas duplicadas", async () => {
    const run = runWith({ accounts: rows, lines: [{ business_line: "F5 DCS", wins: 2 }] });
    const result = await loadSimilarCustomers({ run, user: { id: 9 }, industry: "Industrial", countryId: 5, excludeAccountIds: [412], canReadAll: true });
    expect(result).toMatchObject({
      checked: true, basis: "sector y país", sector: "Industria",
      customers: [{ accountId: 301, wonOpportunities: 3, lastWonAt: "2026-05-12" }, { accountId: 302, lastWonAt: null }],
      soldToSimilar: [{ businessLine: "F5 DCS", wonOpportunities: 2 }],
    });
    const [sql, params] = run.mock.calls.find(([text]) => text.includes("FROM accounts a"));
    expect(sql).toContain("a.economic_sector_id = ?");
    expect(sql).toContain("a.id NOT IN (?)");
    expect(sql).not.toContain("account_owners");
    expect(params).toEqual([2, 412, 5]);
  });

  it("limita a las cuentas asignadas cuando el usuario solo puede leer las propias", async () => {
    const run = runWith({ accounts: rows });
    await loadSimilarCustomers({ run, user: { id: 9 }, industry: "Industrial", countryId: null, canReadAll: false });
    const [sql, params] = run.mock.calls.find(([text]) => text.includes("FROM accounts a"));
    expect(sql).toContain("account_owners");
    expect(params).toEqual([2, 9, null]);
  });

  it("sin sector reconocido usa el país, y sin ninguno de los dos no consulta clientes", async () => {
    const byCountry = runWith({ accounts: rows });
    expect(await loadSimilarCustomers({ run: byCountry, user: { id: 1 }, industry: "Siderurgia", countryId: 5, canReadAll: true })).toMatchObject({ basis: "país", sector: null });
    expect(byCountry.mock.calls.find(([text]) => text.includes("FROM accounts a"))[0]).toContain("a.country_id = ?");
    const none = runWith({ accounts: rows });
    expect(await loadSimilarCustomers({ run: none, user: { id: 1 }, industry: "Siderurgia", countryId: null, canReadAll: true })).toMatchObject({ basis: "none", customers: [] });
    expect(none.mock.calls.some(([text]) => text.includes("FROM accounts a"))).toBe(false);
  });

  it("no consulta las líneas de negocio si no hay clientes", async () => {
    const run = runWith({ accounts: [] });
    expect(await loadSimilarCustomers({ run, user: { id: 1 }, industry: "Industrial", countryId: 5, canReadAll: true })).toMatchObject({ customers: [], soldToSimilar: [] });
    expect(run.mock.calls.some(([text]) => text.includes("opportunity_business_lines"))).toBe(false);
  });

  it("limita la lista y reporta quién atiende cada cuenta parecida", async () => {
    expect(shapeSimilarCustomers({ basis: "país", rows: Array.from({ length: 9 }, (_, index) => ({ id: index })) }).customers).toHaveLength(5);
    const run = vi.fn().mockResolvedValue([
      { account_id: 412, full_name: "Ana Pérez" }, { account_id: 412, full_name: "Luis Soto" },
      { account_id: 412, full_name: "Eva Ruiz" }, { account_id: 412, full_name: "Otro Más" },
    ]);
    expect(await loadAccountOwners({ run, accountIds: [412] })).toEqual({ 412: ["Ana Pérez", "Luis Soto", "Eva Ruiz"] });
    expect(await loadAccountOwners({ run, accountIds: [] })).toEqual({});
  });
});

describe("qué falta para convertir", () => {
  const session = { contacts: sessions.rica.contacts, hypotheses: sessions.rica.hypotheses, convertedAccountId: null };

  it("exige la cuenta antes que contactos y oportunidades, y la decisión sobre duplicados", () => {
    const readiness = buildConversionReadiness({ session, conversionAllowed: true, duplicateCandidates: [{ accountId: 1 }] });
    expect(readiness.account).toMatchObject({ ready: false, missing: [expect.stringContaining("cuenta parecida")] });
    expect(readiness.contact.missing).toEqual(expect.arrayContaining([expect.stringContaining("una cuenta del CRM"), expect.stringContaining("correo o teléfono")]));
    expect(readiness.opportunity.missing).toEqual([expect.stringContaining("una cuenta del CRM")]);
  });

  it("con la cuenta ya creada y datos suficientes todo queda listo", () => {
    const withEmail = { ...session, convertedAccountId: 77, contacts: [{ ...session.contacts[0], email: "a@b.test" }] };
    const readiness = buildConversionReadiness({ session: withEmail });
    expect(readiness.account).toMatchObject({ ready: true, alreadyConverted: true });
    expect(readiness.contact.ready).toBe(true);
    expect(readiness.opportunity.ready).toBe(true);
  });

  it("marca la conversión deshabilitada y la falta de hipótesis o personas", () => {
    const readiness = buildConversionReadiness({ session: { contacts: [], hypotheses: [] }, conversionAllowed: false });
    expect(readiness.account.missing[0]).toContain("deshabilitada");
    expect(readiness.opportunity.missing).toEqual(expect.arrayContaining([expect.stringContaining("hipótesis"), expect.stringContaining("persona")]));
  });

  it("el contexto del CRM incluye la preparación calculada", () => {
    const crm = buildProspectCrmContext({ duplicateReview: { completed: true, candidates: [] }, conversionAllowed: true, session });
    expect(crm.readiness.opportunity.ready).toBe(false);
  });

  it("responde sin modelo lo que falta, y deja pasar las peticiones de convertir", () => {
    const snapshot = { profile: { companyName: "Aceros del Norte" }, crm: sessions.rica_crm.crm, contacts: [], hypotheses: [], findings: [] };
    const asked = detectGuardedTurn({ question: "¿Qué me falta para convertirlo en una oportunidad?", snapshot });
    expect(asked.kind).toBe("conversion_readiness");
    expect(asked.answer).toContain("falta: una cuenta del CRM");
    expect(asked.answer).toContain("Todavía no se creó ningún registro");
    expect(detectGuardedTurn({ question: "¿Qué requisitos hay para convertirlo en cuenta?", snapshot }).answer).toContain("No falta nada");
    expect(detectGuardedTurn({ question: "Convierte este prospecto en cuenta del CRM.", snapshot }).kind).toBe("conversion");
    expect(readinessAnswer({ text: "cuenta", snapshot: { crm: {} } })).toBeNull();
    expect(detectGuardedTurn({ question: "¿Qué me falta para convertirlo en cuenta?", snapshot: { ...snapshot, crm: { conversionAllowed: true } } }).kind).toBe("conversion");
    expect(readinessAnswer({ text: "cuenta", snapshot: { profile: {}, crm: { readiness: { account: { ready: false, missing: ["x"], alreadyConverted: true } } } } })).toContain("ya se convirtió");
  });

  it("preguntar por cuentas parecidas del CRM no se trata como una consulta fuera de alcance", () => {
    const snapshot = { profile: { companyName: "Aceros del Norte" }, crm: sessions.duplicado_con_responsable.crm, contacts: [], hypotheses: [], findings: [] };
    expect(detectGuardedTurn({ question: "Veo una cuenta parecida en el CRM, ¿quién la atiende?", snapshot })).toBeNull();
    expect(detectGuardedTurn({ question: "¿Cuántas oportunidades tiene la cuenta en el CRM?", snapshot })?.kind).toBe("out_of_scope");
  });
});

describe("intenciones de biblioteca y clientes parecidos", () => {
  const tools = ["getProspectProfile", "searchProspectFindings", "searchProspectHypotheses", "getLibraryMaterials"];
  const route = (question, availableTools = tools) => classifyChannelIntent({ channel: "prospect", question, availableTools, context: { prospectSessionId: 7 } });

  it("reconocen con patrones el material y los clientes parecidos", () => {
    expect(route("¿Qué material de la biblioteca puedo compartir?")?.intent).toBe("library_materials");
    expect(route("¿Tenemos casos de éxito para este sector?")?.intent).toBe("library_materials");
    expect(route("¿Tenemos clientes parecidos a este prospecto?")?.intent).toBe("similar_customers");
    expect(route("¿Qué se les ha vendido a clientes como este?")?.intent).toBe("similar_customers");
    expect(route("Veo una cuenta parecida, ¿quién la atiende?")?.intent).toBe("similar_customers");
  });

  it("solo ofrecen la biblioteca cuando el usuario puede leerla", () => {
    expect(route("¿Qué material puedo compartir?")?.allowedTools).toContain("getLibraryMaterials");
    expect(route("¿Qué material puedo compartir?", tools.slice(0, 3))?.allowedTools).not.toContain("getLibraryMaterials");
  });
});

describe("herramienta de biblioteca del chat", () => {
  afterEach(() => {
    vi.doUnmock("../src/structuredWebResearch.js");
    vi.doUnmock("../src/coach/business-rules.js");
    vi.doUnmock("../src/coach/conversation-engine.js");
    vi.resetModules();
  });

  async function adapterFor({ permissions, listLibraryAssets, session = sessions.rica_crm }) {
    vi.resetModules();
    let captured;
    vi.doMock("../src/structuredWebResearch.js", () => ({ runStructuredTextResearch: vi.fn() }));
    vi.doMock("../src/coach/business-rules.js", () => ({ loadCoachBusinessRules: async () => ({}) }));
    vi.doMock("../src/coach/conversation-engine.js", () => ({
      runConversationEngine: async ({ dependencies, availableTools }) => {
        captured = { dependencies, availableTools };
        return { response: {} };
      },
    }));
    const { createProspectChatAdapter } = await import("../src/prospect-research/prospect-chat-adapter.js");
    const adapter = createProspectChatAdapter({ user: { id: 1, permissionSet: new Set(permissions) }, session: { ...session, id: 9001 }, jobId: 3, listLibraryAssets });
    await adapter.runTurn({ question: "Hola", history: [] });
    return captured;
  }
  const names = (tools) => tools.map((tool) => ({ name: tool }));

  it("declara la herramienta con el permiso de la biblioteca", async () => {
    const { availableTools } = await adapterFor({ permissions: ["prospeccion.read"], listLibraryAssets: async () => ({ items: [] }) });
    expect(availableTools.find((tool) => tool.name === "getLibraryMaterials")).toEqual({ name: "getLibraryMaterials", requiredPermission: "enablement_comercial.use" });
  });

  it("lee la biblioteca con el usuario y recomienda según las hipótesis, solo si la intención la permite", async () => {
    const list = vi.fn(async () => ({ items: sessions.rica_crm.libraryAssets }));
    const { dependencies } = await adapterFor({ permissions: ["prospeccion.read", "enablement_comercial.use"], listLibraryAssets: list });
    const authorized = names(["getProspectProfile", "getLibraryMaterials"]);
    const model = await dependencies.prepareReadModel({
      question: "¿Qué material comparto?", availableTools: authorized, authorizedTools: authorized, conversationHistory: [],
      channelIntentRouting: { intent: "library_materials", allowedTools: ["getProspectProfile", "getLibraryMaterials"] }, channelIntentCatalog: [],
    });
    expect(list).toHaveBeenCalledWith({ user: expect.objectContaining({ id: 1 }), filters: { pageSize: 200 } });
    const library = model.readToolResults.find((item) => item.toolName === "getLibraryMaterials").result;
    expect(library.materials.map((item) => item.title)).toEqual(expect.arrayContaining([
      "Caso de uso: conectividad SD-WAN para plantas industriales", "Folleto: nube híbrida para aplicaciones críticas",
    ]));
    expect(library.materials.map((item) => item.title)).not.toContain("Brochure de gestión DDI");
    expect(library.focus).toEqual({ prospect: "Aceros del Norte", industry: "Siderurgia" });
    expect(model.modelSnapshot.libraryAccess).toBe("authorized");

    list.mockClear();
    const other = await dependencies.prepareReadModel({
      question: "¿Qué contactos hay?", availableTools: names(["getProspectProfile"]), authorizedTools: authorized, conversationHistory: [],
      channelIntentRouting: { intent: "prospect_contacts", allowedTools: ["getProspectProfile"] }, channelIntentCatalog: [],
    });
    expect(list).not.toHaveBeenCalled();
    expect(other.modelSnapshot.libraryAccess).toBe("authorized");
  });

  it("marca la biblioteca como no autorizada y no la consulta cuando el usuario no tiene permiso", async () => {
    const list = vi.fn();
    const { dependencies } = await adapterFor({ permissions: ["prospeccion.read"], listLibraryAssets: list });
    const authorized = names(["getProspectProfile"]);
    const model = await dependencies.prepareReadModel({
      question: "¿Qué material comparto?", availableTools: authorized, authorizedTools: authorized, conversationHistory: [],
      channelIntentRouting: { intent: "library_materials", allowedTools: ["getProspectProfile"] }, channelIntentCatalog: [],
    });
    expect(list).not.toHaveBeenCalled();
    expect(model.modelSnapshot.libraryAccess).toBe("not_authorized");
  });

  it("un fallo de la biblioteca no rompe el turno y queda registrado como error de la herramienta", async () => {
    const { dependencies } = await adapterFor({ permissions: ["prospeccion.read", "enablement_comercial.use"], listLibraryAssets: async () => { throw new Error("sin base"); } });
    const tools = names(["getProspectProfile", "getLibraryMaterials"]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const model = await dependencies.prepareReadModel({
      question: "¿Qué material comparto?", availableTools: tools, authorizedTools: tools, conversationHistory: [],
      channelIntentRouting: { intent: "library_materials", allowedTools: ["getProspectProfile", "getLibraryMaterials"] }, channelIntentCatalog: [],
    });
    error.mockRestore();
    expect(model.readToolResults.find((item) => item.toolName === "getLibraryMaterials")).toMatchObject({ result: null, error: expect.any(String) });
  });

  it("los títulos del material y los responsables del CRM no cuentan como datos inventados", async () => {
    const { verifyProspectAnswer } = await import("../src/prospect-research/prospect-verifier.js");
    const snapshot = { ...prospectBank.sessions.rica, crm: sessions.duplicado_con_responsable.crm, readToolResults: [{ toolName: "getLibraryMaterials", result: { materials: [{ title: "Folleto: nube híbrida para aplicaciones críticas" }] } }] };
    const answer = "Consulta a Ana Pérez, que atiende Aceros del Norte S.A. de C.V., y comparte el «Folleto: nube híbrida para aplicaciones críticas».";
    expect(verifyProspectAnswer({ answer, snapshot, question: "x" }).issues).toEqual([]);
    expect(verifyProspectAnswer({ answer: "Consulta a Pedro Gómez.", snapshot, question: "x" }).issues).toEqual([{ kind: "name", text: "Pedro Gómez" }]);
  });
});
