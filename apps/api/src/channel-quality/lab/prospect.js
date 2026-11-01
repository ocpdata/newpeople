import assert from "node:assert/strict";
import { classifyChannelIntent, getChannelIntentDefaults } from "../../coach/channel-intents.js";
import { buildProspectFallback, normalizeProspectRecommendedActions } from "../../prospect-research/prospect-chat-adapter.js";
import cases from "./prospect-cases.json" with { type: "json" };

// Deterministic Cuenta nueva lab: intent routing, the answers built from the session and the conversion rules.
// It uses no AI and no database. Cases marked knownGap document behavior that is wrong today; they are tracked
// apart so the main score stays meaningful and progress is visible.

const TOOLS = ["getProspectProfile", "searchProspectFindings", "searchProspectContacts", "searchProspectHypotheses"].map((name) => ({ name }));

const profile = { companyName: "Raloy Lubricantes", country: "México", industry: "Manufactura" };
export const prospectLabSnapshots = Object.freeze({
  full: Object.freeze({
    profile,
    outreach: { body: "Hola María, vimos la expansión de su planta y quisiéramos conversar." },
    findings: [{ title: "Expansión de planta", summary: "Anunció una nueva planta", evidence: "Nota de prensa" }],
    contacts: [{ name: "María García", roleTitle: "Directora de TI", area: "TI", evidence: "Perfil público" }],
    hypotheses: [{ title: "Renovar la red de la planta", businessChallenge: "Conectividad", evidence: "Nota de prensa" }],
    externalResearch: null,
  }),
  empty: Object.freeze({ profile, outreach: null, findings: [], contacts: [], hypotheses: [], externalResearch: null }),
});

const handlers = {
  intent(testCase) {
    const routing = classifyChannelIntent({
      channel: "prospect", question: testCase.question, availableTools: TOOLS, context: {}, configuration: getChannelIntentDefaults("prospect"),
    });
    assert.equal(routing.intent, testCase.expected.intent);
  },
  fallback(testCase) {
    const snapshot = prospectLabSnapshots[testCase.snapshot];
    const result = buildProspectFallback(snapshot, testCase.question, { intent: testCase.intent });
    for (const text of testCase.expected.contains || []) assert.ok(result.answer.includes(text), `Falta «${text}» en la respuesta`);
    for (const text of testCase.expected.notContains || []) assert.ok(!result.answer.includes(text), `Sobra «${text}» en la respuesta`);
    assert.deepEqual(result.recommendedActions, [], "Una respuesta de consulta no debe proponer operaciones");
    assert.equal(result.source, "prospect_research");
  },
  action(testCase) {
    const kept = normalizeProspectRecommendedActions([testCase.action]);
    assert.equal(kept.length, testCase.expected.kept ? 1 : 0);
    if (testCase.expected.kept) assert.equal(kept[0].requiresConfirmation, true);
  },
};

export const prospectLabCases = cases;
export const groupOfCase = (id) => String(id).split("-")[1] || "OTHER";

export function runProspectLabCase(testCase) {
  const base = { id: testCase.id, group: groupOfCase(testCase.id), knownGap: Boolean(testCase.knownGap) };
  const handler = handlers[testCase.kind];
  if (!handler) return { ...base, passed: false, error: `Tipo de caso desconocido: ${testCase.kind}` };
  try {
    handler(testCase);
    return { ...base, passed: true, error: null };
  } catch (error) {
    return { ...base, passed: false, error: String(error?.message || error).slice(0, 300) };
  }
}

// groups.cases is what the quality gate evaluates; known gaps are reported apart.
export function runProspectLab() {
  const results = prospectLabCases.map(runProspectLabCase);
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
