import assert from "node:assert/strict";
import { buildCoachEntityClarification, resolveCoachEntities } from "../../coach/entity-resolver.js";
import { buildDeterministicAccountOpportunityRanking } from "../../coach/conversation-engine.js";
import { searchCoachOpportunities } from "../../coach/read-tools.js";
import { coachOperationSchema } from "../../coach/contract.js";
import { normalizeActivityOperation } from "../../coach/operation-contract.js";
import cases from "./coach-cases.json" with { type: "json" };

// Deterministic Coach lab: entity resolution, opportunity search, ranking and the operation contract.
// It uses no AI and no database, so it can run on every change. Cases marked knownGap document behavior
// that is wrong today; they are tracked apart so the main score stays meaningful and progress is visible.

const account = (id, name) => ({ id, name });
const opportunity = (id, name, accountId, accountName, extra = {}) => ({
  id, name, accountId, account: { id: accountId, name: accountName }, accountName,
  lifecycle: "open", activationStatusCode: "activada", commercialStatusCode: "en_proceso", stageCode: "calificacion", ...extra,
});

// The resolver options Coach uses in production (see resolveCoachContextEntities in routes.mi-agent.js).
const COACH_RESOLUTION_OPTIONS = Object.freeze({ disambiguateByAccount: true });

export const coachLabSnapshot = Object.freeze({
  accounts: [account(22, "Totalplay"), account(23, "Telmex"), account(24, "Megacable"), account(25, "Totalplay Móvil")],
  coachOpportunities: [
    opportunity(1, "Proyecto abierto", 22, "Totalplay"),
    opportunity(2, "Otra oportunidad", 22, "Totalplay"),
    ...Array.from({ length: 6 }, (_, index) => opportunity(index + 4, `Proyecto abierto ${index + 3}`, 22, "Totalplay")),
    opportunity(3, "Vrf 2027", 22, "Totalplay", { lifecycle: "historical", commercialStatusCode: "ganada" }),
    opportunity(10, "Renovación SD-WAN", 23, "Telmex", { stageCode: "propuesta", closeDate: "2026-12-15" }),
    opportunity(11, "Renovación SD-WAN", 24, "Megacable", { stageCode: "negociacion", closeDate: "2027-03-01" }),
    opportunity(12, "Firewall perimetral", 23, "Telmex", { lifecycle: "historical", commercialStatusCode: "perdida", closeDate: "2026-02-10" }),
    opportunity(13, "Switching campus", 23, "Telmex", { activationStatusCode: "desactivada" }),
    opportunity(14, "Móvil corporativo", 25, "Totalplay Móvil"),
  ],
  wonOpportunities: [],
  lostOpportunities: [],
  cancelledOpportunities: [],
  contactMappings: [
    { id: 501, name: "Juan Pérez", accountId: 22, accountName: "Totalplay", email: "jperez@totalplay.mx" },
    { id: 502, name: "Juan Pérez", accountId: 23, accountName: "Telmex", email: "jperez@telmex.mx" },
    { id: 503, name: "Ana Lugo", accountId: 23, accountName: "Telmex" },
  ],
  leads: [{ id: 701, title: "Raloy Lubricantes" }],
});

const sortedIds = (items) => items.map((item) => item.id).sort((left, right) => left - right);

const handlers = {
  account_ranking(testCase) {
    const result = buildDeterministicAccountOpportunityRanking(testCase.question, coachLabSnapshot.coachOpportunities);
    assert.equal(result.facts[0].sourceId, testCase.expected.topAccountId);
    assert.ok(result.answer.includes(`${testCase.expected.topCount} oportunidad(es) abiertas`), "El ranking no muestra el conteo esperado");
  },
  opportunity_search(testCase) {
    assert.deepEqual(sortedIds(searchCoachOpportunities(coachLabSnapshot, testCase.filters)), testCase.expected.ids);
  },
  exact_entity(testCase) {
    assert.equal(resolveCoachEntities(coachLabSnapshot, testCase.question, {}, COACH_RESOLUTION_OPTIONS).opportunity?.id, testCase.expected.opportunityId);
  },
  exact_contact(testCase) {
    assert.equal(resolveCoachEntities(coachLabSnapshot, testCase.question, {}, COACH_RESOLUTION_OPTIONS).contact?.id, testCase.expected.contactId);
  },
  exact_lead(testCase) {
    assert.equal(resolveCoachEntities(coachLabSnapshot, testCase.question, {}, COACH_RESOLUTION_OPTIONS).lead?.id, testCase.expected.leadId);
  },
  no_entity(testCase) {
    const resolution = resolveCoachEntities(coachLabSnapshot, testCase.question, {}, COACH_RESOLUTION_OPTIONS);
    assert.deepEqual([resolution.account, resolution.opportunity, resolution.contact, resolution.lead], [null, null, null, null]);
    assert.equal(buildCoachEntityClarification(resolution, testCase.question), null);
  },
  clarification(testCase) {
    const resolution = resolveCoachEntities(coachLabSnapshot, testCase.question, {}, COACH_RESOLUTION_OPTIONS);
    const clarification = buildCoachEntityClarification(resolution, testCase.question);
    assert.equal(clarification?.type || null, testCase.expected.type || testCase.expected.clarification);
  },
  operation(testCase) {
    const operation = normalizeActivityOperation(testCase.payload || { title: "Llamar", actionType: "call" }, { opportunityId: 1 });
    assert.equal(coachOperationSchema.safeParse(operation).success, true, "La operación no cumple el contrato");
    assert.equal(operation.kind, testCase.expected.kind);
    assert.equal(operation.requiresConfirmation, testCase.expected.requiresConfirmation);
    if (testCase.expected.actionType) assert.equal(operation.actionType || operation.payload?.actionType, testCase.expected.actionType);
  },
  operation_rejected(testCase) {
    let accepted;
    try {
      accepted = coachOperationSchema.safeParse(normalizeActivityOperation(testCase.payload, { opportunityId: 1 })).success;
    } catch {
      accepted = false;
    }
    assert.equal(accepted, false, "La operación inválida se aceptó");
  },
// collection behaves like clarification: it expects no clarification for a list request
};
handlers.collection = handlers.clarification;

export const coachLabCases = cases;
export const groupOfCase = (id) => String(id).split("-")[1] || "OTHER";

export function runCoachLabCase(testCase) {
  const handler = handlers[testCase.kind];
  if (!handler) return { id: testCase.id, group: groupOfCase(testCase.id), knownGap: Boolean(testCase.knownGap), passed: false, error: `Tipo de caso desconocido: ${testCase.kind}` };
  try {
    handler(testCase);
    return { id: testCase.id, group: groupOfCase(testCase.id), knownGap: Boolean(testCase.knownGap), passed: true, error: null };
  } catch (error) {
    return { id: testCase.id, group: groupOfCase(testCase.id), knownGap: Boolean(testCase.knownGap), passed: false, error: String(error?.message || error).slice(0, 300) };
  }
}

// groups.cases is what the quality gate evaluates; known gaps are reported apart.
export function runCoachLab() {
  const results = coachLabCases.map(runCoachLabCase);
  const regular = results.filter((item) => !item.knownGap);
  const gaps = results.filter((item) => item.knownGap);
  const groups = { cases: { passed: regular.filter((item) => item.passed).length, total: regular.length } };
  if (gaps.length) groups.known_gaps_fixed = { passed: gaps.filter((item) => item.passed).length, total: gaps.length };
  for (const group of new Set(regular.map((item) => item.group))) {
    const inGroup = regular.filter((item) => item.group === group);
    groups[`cat_${group.toLowerCase()}`] = { passed: inGroup.filter((item) => item.passed).length, total: inGroup.length };
  }
  return { groups, results: results.filter((item) => !item.passed && !item.knownGap) };
}
