import { indexDossierEvidence } from "../commercial-intelligence/dossier/opportunity-dossier.js";

const EVIDENCE_PREFIX = Object.freeze({
  opportunities: "opp",
  contacts: "contact",
  opportunity_stage_question_answers: "ans",
  opportunity_workspace_actions: "act",
  quotation_versions: "qv",
  accounts: "acct",
  opportunity_workspace_recommended_strategy: "strat",
  interactions: "int",
  campaign_account_interactions: "camp",
  opportunity_manufacturer_registrations: "reg",
  proposals: "prop",
});
const COUNT_SECTION = Object.freeze({
  opportunity_notes: "opportunityNotes",
  quotations: "quotations",
  opportunity_workspace_actions: "activities",
  quotation_won_documents: "purchaseOrders",
});
const IMPLICIT_FILTERS = Object.freeze({ quotation_won_documents: { document_role: "purchase_order" } });
const COMPLETE_STATUSES = new Set(["loaded", "empty"]);

const camel = (value) => value.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());

export function dossierTargets(bank) {
  const opportunityIds = new Set();
  const accountIds = new Set(bank.conversations.map((conversation) => conversation.accountId));
  for (const fact of Object.values(bank.facts)) {
    if (fact.table === "opportunities" && fact.id) opportunityIds.add(fact.id);
    if (fact.dossierOpportunityId) opportunityIds.add(Number(fact.dossierOpportunityId));
    if (fact.where?.opportunity_id) opportunityIds.add(Number(fact.where.opportunity_id));
    if (fact.where?.account_id) accountIds.add(Number(fact.where.account_id));
  }
  for (const conversation of bank.conversations) {
    if (conversation.focusOpportunityId) opportunityIds.add(conversation.focusOpportunityId);
  }
  return { opportunityIds: [...opportunityIds].sort((a, b) => a - b), accountIds: [...accountIds].sort((a, b) => a - b) };
}

function compareValue(fact, actual) {
  if (actual === undefined) return { ok: false, reason: "campo_ausente" };
  const text = actual === null ? null : String(actual);
  if (fact.equals !== undefined) return { ok: text === String(fact.equals) };
  return { ok: text !== null && text.includes(fact.contains) };
}

function locateCount(fact, { opportunityDossiers, accountDossiers }) {
  const { account_id: accountId, opportunity_id: opportunityId, ...filters } = fact.where;
  let section;
  if (accountId !== undefined && fact.table === "opportunities") {
    section = accountDossiers.get(Number(accountId))?.sections.opportunities;
  } else if (opportunityId !== undefined && COUNT_SECTION[fact.table]) {
    section = opportunityDossiers.get(Number(opportunityId))?.sections[COUNT_SECTION[fact.table]];
  } else {
    return { located: false, reason: "conteo_sin_ubicacion" };
  }
  if (!section) return { located: false, reason: "expediente_ausente" };
  if (!COMPLETE_STATUSES.has(section.status)) return { located: false, reason: `seccion_${section.status}` };
  const implicit = IMPLICIT_FILTERS[fact.table] || {};
  const explicit = Object.entries(filters).filter(([key, value]) => implicit[key] !== value);
  const count = section.items.filter((item) => explicit.every(([key, value]) => String(item[camel(key)]) === String(value))).length;
  return { located: count === fact.count, section: section.key, actual: count, expected: fact.count,
    ...(count === fact.count ? {} : { reason: "conteo_distinto" }) };
}

export function checkDossierCoverage(bank, { opportunityDossiers, accountDossiers }) {
  const indexes = [...opportunityDossiers.values(), ...accountDossiers.values()].map(indexDossierEvidence);
  const criticalFacts = new Set(bank.conversations.flatMap((conversation) => conversation.turns
    .flatMap((turn) => turn.mustInclude.filter((item) => item.critical).flatMap((item) => item.evidence))));
  return Object.entries(bank.facts).map(([factId, fact]) => {
    const base = { factId, critical: criticalFacts.has(factId) };
    // Facts stored as IDs in the CRM (sector, owners) appear in the dossier by name: «dossier» says where to look.
    if (fact.dossier) {
      const items = indexes.map((index) => index.get(fact.dossier.evidenceId)).filter(Boolean);
      if (!items.length) return { ...base, evidenceId: fact.dossier.evidenceId, located: false, reason: "evidencia_ausente" };
      const match = items.find((item) => compareValue(fact.dossier, item[fact.dossier.field]).ok);
      return match ? { ...base, evidenceId: fact.dossier.evidenceId, located: true }
        : { ...base, evidenceId: fact.dossier.evidenceId, located: false, reason: "valor_distinto",
          actual: String(items[0][fact.dossier.field] ?? "").slice(0, 200) };
    }
    if (fact.where) return { ...base, ...locateCount(fact, { opportunityDossiers, accountDossiers }) };
    const prefix = EVIDENCE_PREFIX[fact.table];
    if (!prefix) return { ...base, located: false, reason: "tabla_sin_ubicacion" };
    const evidenceId = `${prefix}${fact.id}`;
    const items = indexes.map((index) => index.get(evidenceId)).filter(Boolean);
    if (!items.length) return { ...base, evidenceId, located: false, reason: "evidencia_ausente" };
    const key = camel(fact.field);
    const match = items.find((item) => compareValue(fact, item[key]).ok);
    if (match) return { ...base, evidenceId, located: true };
    const comparison = compareValue(fact, items[0][key]);
    return { ...base, evidenceId, located: false, reason: comparison.reason || "valor_distinto",
      actual: items[0][key] === undefined ? undefined : String(items[0][key]).slice(0, 200) };
  });
}

export function summarizeCoverage(results) {
  const critical = results.filter((item) => item.critical);
  return {
    total: results.length,
    located: results.filter((item) => item.located).length,
    criticalTotal: critical.length,
    criticalLocated: critical.filter((item) => item.located).length,
    missing: results.filter((item) => !item.located),
  };
}
