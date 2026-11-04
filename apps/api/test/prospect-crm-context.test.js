import { describe, expect, it } from "vitest";
import { buildProspectCrmContext, conversionBlock } from "../src/prospect-research/prospect-crm-context.js";
import { detectGuardedTurn } from "../src/prospect-research/prospect-guards.js";
import { buildProspectRecommendedActions } from "../src/prospect-research/prospect-operations.js";

const base = {
  profile: { companyName: "Aceros del Norte" },
  contacts: [],
  hypotheses: [],
  findings: [],
};
const duplicate = { accountId: 412, name: "Aceros del Norte S.A. de C.V.", reason: "Mismo nombre y sitio web" };

describe("contexto CRM de Cuenta nueva", () => {
  it("convierte la revisión de duplicados y el gobierno en un contexto acotado", () => {
    const crm = buildProspectCrmContext({
      duplicateReview: { completed: true, candidates: [{ id: 7, name: "Aceros", matchType: "domain", country: "México", activationStatus: "active", website: "x" }] },
      conversionAllowed: false,
    });
    expect(crm).toMatchObject({
      conversionAllowed: false,
      duplicatesChecked: true,
      duplicateCandidates: [{ accountId: 7, name: "Aceros", reason: "Mismo sitio web", country: "México", activationStatus: "active", owners: [] }],
      similarCustomers: null,
    });
  });

  it("agrega los responsables de la cuenta parecida y los clientes similares", () => {
    const similar = { checked: true, basis: "país", customers: [], soldToSimilar: [] };
    const crm = buildProspectCrmContext({
      duplicateReview: { completed: true, candidates: [{ id: 7, name: "Aceros", matchType: "name_country" }] },
      conversionAllowed: true, similar, owners: { 7: ["Ana Pérez"] },
    });
    expect(crm.duplicateCandidates[0].owners).toEqual(["Ana Pérez"]);
    expect(crm.similarCustomers).toBe(similar);
  });

  it("no inventa candidatos cuando el usuario no puede leer cuentas", () => {
    const crm = buildProspectCrmContext({ duplicateReview: { completed: false, requiresAccountsRead: true, candidates: [] }, conversionAllowed: true });
    expect(crm).toMatchObject({ conversionAllowed: true, duplicatesChecked: false, duplicateCandidates: [] });
  });

  it("solo los duplicados bloquean la cuenta; el gobierno bloquea todo", () => {
    expect(conversionBlock({ conversionAllowed: true, duplicateCandidates: [duplicate] }, "account")).toMatchObject({ reason: "duplicates" });
    expect(conversionBlock({ conversionAllowed: true, duplicateCandidates: [duplicate] }, "contact")).toBeNull();
    expect(conversionBlock({ conversionAllowed: false, duplicateCandidates: [] }, "contact")).toEqual({ reason: "disabled" });
    expect(conversionBlock(null, "account")).toBeNull();
  });

  it("responde al duplicado detectado sin proponer conversión", () => {
    const turn = detectGuardedTurn({ question: "Antes de convertirlo, ¿ya existe esta cuenta en el CRM?", snapshot: { ...base, crm: { conversionAllowed: true, duplicatesChecked: true, duplicateCandidates: [duplicate] } } });
    expect(turn.kind).toBe("existence_check");
    expect(turn.answer).toContain("Aceros del Norte S.A. de C.V.");
    expect(turn.answer).toContain("cuenta existente o se crea una nueva");
  });

  it("no afirma que no existe cuando no pudo revisar", () => {
    const turn = detectGuardedTurn({ question: "¿Ya existe en el CRM?", snapshot: { ...base, crm: { conversionAllowed: true, duplicatesChecked: false, duplicateCandidates: [] } } });
    expect(turn.answer).toContain("no tiene permiso para consultar cuentas");
    expect(turn.answer).not.toMatch(/no encontré/i);
  });

  it("informa que no hay coincidencias solo cuando la revisión se hizo", () => {
    const turn = detectGuardedTurn({ question: "¿Ya existe en el CRM?", snapshot: { ...base, crm: { conversionAllowed: true, duplicatesChecked: true, duplicateCandidates: [] } } });
    expect(turn.answer).toMatch(/No encontré cuentas/);
  });

  it("sin contexto CRM conserva la respuesta anterior", () => {
    const turn = detectGuardedTurn({ question: "¿Ya existe en el CRM?", snapshot: base });
    expect(turn.answer).toContain("no puedo confirmar");
  });

  it("la conversión deshabilitada no propone operación", () => {
    const snapshot = { ...base, crm: { conversionAllowed: false, duplicateCandidates: [] } };
    const turn = detectGuardedTurn({ question: "Convierte este prospecto en cuenta del CRM.", snapshot });
    expect(turn.kind).toBe("conversion_blocked");
    expect(turn.answer).toContain("deshabilitada");
    expect(turn.action).toBeUndefined();
    expect(buildProspectRecommendedActions({ intent: "conversion_request", question: "Convierte esto en cuenta", snapshot })).toEqual([]);
  });

  it("convertir con duplicados explica el duplicado en lugar de proponer la cuenta", () => {
    const snapshot = { ...base, crm: { conversionAllowed: true, duplicatesChecked: true, duplicateCandidates: [duplicate] } };
    const turn = detectGuardedTurn({ question: "Convierte este prospecto en cuenta del CRM.", snapshot });
    expect(turn.kind).toBe("conversion_blocked");
    expect(turn.answer).toContain("posible cuenta duplicada");
    expect(buildProspectRecommendedActions({ intent: "conversion_request", question: "Convierte esto en cuenta", snapshot })).toEqual([]);
  });

  it("sin bloqueos la cuenta se sigue proponiendo", () => {
    const snapshot = { ...base, crm: { conversionAllowed: true, duplicatesChecked: true, duplicateCandidates: [] } };
    const turn = detectGuardedTurn({ question: "Convierte este prospecto en cuenta del CRM.", snapshot });
    expect(turn.kind).toBe("conversion");
    expect(turn.action.target).toBe("account");
  });
});
