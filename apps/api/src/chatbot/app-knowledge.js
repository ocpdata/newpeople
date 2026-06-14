import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadChatbotPlannerMetadata } from "./capabilities.js";
import { normalizeSearchText, tokenizeSearchText } from "./common.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const INTERACTIONS_FILE = path.join(
  REPO_ROOT,
  "apps/api/src/routes.interactions.js",
);

let cache = {
  loadedAt: 0,
  facts: [],
};

function parseStringArrayFromConst(sourceCode, constName) {
  const expression = new RegExp(
    `const\\s+${constName}\\s*=\\s*\\[(.*?)\\]`,
    "s",
  );
  const match = sourceCode.match(expression);
  if (!match) return [];

  const values = [];
  const valueRegex = /"([^"]+)"|'([^']+)'/g;
  let valueMatch = valueRegex.exec(match[1]);
  while (valueMatch) {
    values.push(String(valueMatch[1] || valueMatch[2] || "").trim());
    valueMatch = valueRegex.exec(match[1]);
  }
  return values.filter(Boolean);
}

function buildLeadStatusMeaning(code) {
  if (code === "created") {
    return "Interaccion creada pero aun sin cuenta/contactos resueltos.";
  }
  if (code === "lead_unassigned") {
    return "Lead con cuenta y contactos resueltos, pero sin vendedor asignado.";
  }
  if (code === "lead_assigned") {
    return "Lead con vendedor asignado y sin oportunidad ligada todavia.";
  }
  if (code === "lead_qualified") {
    return "Lead convertido a oportunidad comercial (calificado).";
  }
  if (code === "lead_disqualified") {
    return "Lead descartado o no viable comercialmente (descalificado).";
  }
  return "Estado de lead interno de la aplicacion.";
}

function buildLeadSourceMeaning(code) {
  const map = {
    fabricante: "Lead originado por fabricante.",
    mayorista: "Lead originado por mayorista.",
    empresa_marketing: "Lead originado por empresa/campana de marketing.",
    vendedor: "Lead capturado por vendedor.",
    campana: "Lead originado por campana comercial.",
    web: "Lead originado por formulario/canal web.",
    correo: "Lead originado por correo electronico.",
    redes: "Lead originado por redes sociales.",
    consultor: "Lead originado por consultor.",
    webinar: "Lead originado por webinar.",
    evento: "Lead originado por evento.",
    otro: "Lead originado por otro canal.",
  };
  return map[code] || "Fuente de lead interna de la aplicacion.";
}

async function buildFactsFromCode() {
  const source = await readFile(INTERACTIONS_FILE, "utf8").catch(() => "");
  if (!source.trim()) return [];

  const leadSources = parseStringArrayFromConst(
    source,
    "LEAD_SOURCE_CODE_LIST",
  );
  const leadStatuses = parseStringArrayFromConst(
    source,
    "LEAD_STATUS_FILTER_LIST",
  );

  const facts = [];

  if (leadSources.length) {
    const items = leadSources.map((code) => ({
      code,
      meaning: buildLeadSourceMeaning(code),
    }));
    const text = [
      "Tipos de lead por fuente (lead_source) definidos en la aplicacion:",
      ...items.map((item) => `- ${item.code}: ${item.meaning}`),
      "Origen: routes.interactions.js -> LEAD_SOURCE_CODE_LIST",
    ].join("\n");

    facts.push({
      id: "interaction.lead_source.list",
      title: "Tipos de lead por fuente",
      topic: "lead_types",
      text,
      sourceRef:
        "code:apps/api/src/routes.interactions.js#LEAD_SOURCE_CODE_LIST",
    });
  }

  if (leadStatuses.length) {
    const items = leadStatuses.map((code) => ({
      code,
      meaning: buildLeadStatusMeaning(code),
    }));
    const text = [
      "Estatus comerciales de lead (analysis_status) definidos en la aplicacion:",
      ...items.map((item) => `- ${item.code}: ${item.meaning}`),
      "Origen: routes.interactions.js -> LEAD_STATUS_FILTER_LIST y resolveLeadCommercialStatus",
    ].join("\n");

    facts.push({
      id: "interaction.lead_status.list",
      title: "Estatus de lead",
      topic: "lead_status",
      text,
      sourceRef:
        "code:apps/api/src/routes.interactions.js#LEAD_STATUS_FILTER_LIST",
    });
  }

  return facts.map((fact) => ({
    ...fact,
    searchableText: normalizeSearchText(
      `${fact.id} ${fact.title} ${fact.topic} ${fact.text}`,
    ),
  }));
}

function collectCodeListsFromDomain(domainConfig) {
  const keys = [
    "activationStatusCodes",
    "commercialStatusCodes",
    "salesStageCodes",
    "latestStatusCodes",
    "statusCodes",
    "quotationVersionStatusCodes",
  ];

  const blocks = [];
  for (const key of keys) {
    const values = Array.isArray(domainConfig?.[key])
      ? domainConfig[key]
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [];
    if (!values.length) continue;
    blocks.push(`- ${key}: ${values.join(", ")}`);
  }
  return blocks;
}

async function buildFactsFromPlannerMetadata(user) {
  if (!user) return [];
  const metadata = await loadChatbotPlannerMetadata(user).catch(() => null);
  const domains = metadata?.domains || {};

  const facts = [];
  for (const [domainKey, domainConfig] of Object.entries(domains)) {
    if (!domainConfig?.enabled) continue;
    const blocks = collectCodeListsFromDomain(domainConfig);
    if (!blocks.length) continue;

    const text = [
      `Catalogos internos del dominio ${domainKey}:`,
      ...blocks,
      "Origen: metadata interna del backend (capabilities/planner)",
    ].join("\n");

    facts.push({
      id: `catalog.${domainKey}`,
      title: `Catalogos internos de ${domainKey}`,
      topic: "domain_catalogs",
      text,
      sourceRef: `catalog:${domainKey}`,
    });
  }

  return facts.map((fact) => ({
    ...fact,
    searchableText: normalizeSearchText(
      `${fact.id} ${fact.title} ${fact.topic} ${fact.text}`,
    ),
  }));
}

async function loadFacts(user) {
  const now = Date.now();
  if (cache.facts.length && now - cache.loadedAt < 2 * 60 * 1000) {
    return cache.facts;
  }
  const codeFacts = await buildFactsFromCode();
  const metadataFacts = await buildFactsFromPlannerMetadata(user);
  const facts = [...codeFacts, ...metadataFacts];
  cache = { loadedAt: now, facts };
  return facts;
}

function rankFactByTokens(fact, tokens) {
  if (!tokens.length) return 0;
  let score = 0;
  for (const token of tokens) {
    if (fact.searchableText.includes(token)) score += 1;
  }
  return score;
}

export async function searchInternalAppKnowledge({ user, prompt, limit = 4 }) {
  const safePrompt = String(prompt || "").trim();
  if (!safePrompt) return [];

  const facts = await loadFacts(user);
  if (!facts.length) return [];

  const tokens = tokenizeSearchText(safePrompt);

  return facts
    .map((fact) => ({
      id: fact.id,
      title: fact.title,
      topic: fact.topic,
      sourceRef: fact.sourceRef,
      excerpt: String(fact.text || "").slice(0, 900),
      score: rankFactByTokens(fact, tokens),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(8, Number(limit || 4))));
}
