import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db.js";
import { ensureInteractionSchema } from "../interactions/schema.js";
import { runStructuredTextResearch } from "../structuredWebResearch.js";
import { searchTavily } from "../tavily.js";
import {
  assertExternalResearchGovernance,
  getMiCoachGovernanceSettings,
} from "../commercial-intelligence/service.js";
import { ensureProspectResearchSchema } from "./schema.js";
import {
  buildProspectFallback,
  createProspectChatAdapter,
} from "./prospect-chat-adapter.js";
import { recordCoachTurnQualityTrace } from "../coach/observability.js";

const activeExternalResearchRunIds = new Set();

export const PROSPECT_RESEARCH_TRACKS = [
  {
    key: "company_profile",
    label: "Perfil de empresa",
    queryTerms:
      "perfil corporativo productos servicios operaciones ubicaciones",
  },
  {
    key: "business_signals",
    label: "Señales de negocio",
    queryTerms:
      "expansión inversión licitaciones contratos proyectos vacantes noticias",
  },
  {
    key: "technology_signals",
    label: "Tecnología e infraestructura",
    queryTerms:
      "tecnología infraestructura nube Kubernetes APIs WAF DNS DDI redes ciberseguridad observabilidad",
  },
  {
    key: "public_people",
    label: "Personas y áreas",
    queryTerms:
      "CIO CTO CISO director tecnología seguridad redes arquitectura cloud liderazgo",
  },
];

function clip(value, max = 1200) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function createHttpError(status, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, details);
  return error;
}

function hasPermission(user, permission) {
  return Boolean(user?.permissionSet?.has(permission));
}

function hasAnyPermission(user, permissions) {
  return permissions.some((permission) => hasPermission(user, permission));
}

async function getCatalogId(tableName, code, fallbackWhere = "is_active = 1") {
  const byCode = await query(
    `SELECT id FROM ${tableName} WHERE code = ? LIMIT 1`,
    [code],
  ).catch(() => []);
  if (byCode.length) return Number(byCode[0].id);
  const fallback = await query(
    `SELECT id FROM ${tableName} ${fallbackWhere ? `WHERE ${fallbackWhere}` : ""} ORDER BY id LIMIT 1`,
  );
  if (!fallback.length)
    throw createHttpError(500, `Catalogo sin datos: ${tableName}`);
  return Number(fallback[0].id);
}

async function resolveCountryId(country) {
  const text = String(country || "").trim();
  const normalizedCountry = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  if (!normalizedCountry) return null;
  const rows = await query(
    `SELECT id, name, iso2, iso3 FROM countries ORDER BY id`,
  ).catch(() => []);
  const countryRow = rows.find((row) =>
    [row.name, row.iso2, row.iso3].some(
      (value) =>
        String(value || "")
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "") === normalizedCountry,
    ),
  );
  return countryRow ? Number(countryRow.id) : null;
}

function normalizeCompanyName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(
      /\b(s\s*a\s*de\s*c\s*v|s\s*a\s*de\s*r\s*l|s\s*a|sa|llc|ltd|limited|inc|corp|corporation)\b/g,
      " ",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function matchesProspectCompanyName(left, right) {
  const normalizedLeft = normalizeCompanyName(left);
  const normalizedRight = normalizeCompanyName(right);
  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      (normalizedLeft === normalizedRight ||
        normalizedLeft.startsWith(`${normalizedRight} `) ||
        normalizedRight.startsWith(`${normalizedLeft} `)),
  );
}

function normalizeCompanyDomain(value) {
  const normalizedWebsite = normalizeWebsite(value);
  if (!normalizedWebsite) return "";
  try {
    return new URL(normalizedWebsite).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}

function sameProspectIdentity(left, right) {
  const leftDomain = normalizeCompanyDomain(left.website);
  const rightDomain = normalizeCompanyDomain(right.website);
  if (leftDomain && rightDomain && leftDomain === rightDomain) return true;
  return (
    normalizeCompanyName(left.companyName || left.company_name) ===
      normalizeCompanyName(right.companyName || right.company_name) &&
    normalizeCompanyName(left.country) === normalizeCompanyName(right.country)
  );
}

function groupDuplicateProspectSessions(sessions) {
  const parents = sessions.map((_, index) => index);
  const find = (index) => {
    if (parents[index] !== index) parents[index] = find(parents[index]);
    return parents[index];
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  const byDomain = new Map();
  const byNameCountry = new Map();
  sessions.forEach((session, index) => {
    const domain = normalizeCompanyDomain(session.website);
    const nameCountry = `${normalizeCompanyName(session.companyName || session.company_name)}|${normalizeCompanyName(session.country)}`;
    for (const [map, key] of [
      [byDomain, domain],
      [byNameCountry, nameCountry],
    ]) {
      if (!key) continue;
      const previousIndex = map.get(key);
      if (previousIndex !== undefined) union(index, previousIndex);
      else map.set(key, index);
    }
  });

  const groups = new Map();
  sessions.forEach((session, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(session);
  });

  const comparePriority = (left, right) => {
    if (Boolean(left.isTarget) !== Boolean(right.isTarget)) {
      return Number(Boolean(right.isTarget)) - Number(Boolean(left.isTarget));
    }
    if (
      Boolean(left.externalResearchedAt) !== Boolean(right.externalResearchedAt)
    ) {
      return (
        Number(Boolean(right.externalResearchedAt)) -
        Number(Boolean(left.externalResearchedAt))
      );
    }
    const leftDate = new Date(
      left.externalResearchedAt || left.updatedAt || 0,
    ).getTime();
    const rightDate = new Date(
      right.externalResearchedAt || right.updatedAt || 0,
    ).getTime();
    return rightDate - leftDate || Number(right.id) - Number(left.id);
  };

  return [...groups.values()].map((group) => {
    const [representative, ...duplicates] = group.sort(comparePriority);
    return {
      ...representative,
      duplicateCount: group.length,
      duplicateSessionIds: duplicates.map((session) => Number(session.id)),
    };
  });
}

async function findProspectAccountDuplicates({ user, session }) {
  const canReadAll = hasPermission(user, "cuentas.read_all");
  const canReadOwned = hasPermission(user, "cuentas.read");
  if (!canReadAll && !canReadOwned) {
    return {
      completed: false,
      requiresAccountsRead: true,
      countryResolved: false,
      candidates: [],
    };
  }

  const normalizedName = normalizeCompanyName(session.companyName);
  const nameToken =
    normalizedName.split(" ").find((token) => token.length >= 2) ||
    normalizedName;
  const domain = normalizeCompanyDomain(session.website);
  const countryId = await resolveCountryId(session.country);
  const params = [
    session.companyName,
    nameToken ? `%${nameToken}%` : "",
    countryId,
    countryId,
    domain,
    domain ? `%${domain}%` : "",
  ];
  const scope = canReadAll
    ? ""
    : "AND EXISTS (SELECT 1 FROM account_owners ao WHERE ao.account_id = a.id AND ao.user_id = ? )";
  if (!canReadAll) params.push(Number(user.id));
  const rows = await query(
    `SELECT a.id, a.name, a.website, a.country_id, c.name AS country_name,
            aas.code AS activation_status
     FROM accounts a
     LEFT JOIN countries c ON c.id = a.country_id
     LEFT JOIN account_activation_statuses aas ON aas.id = a.activation_status_id
     WHERE (((LOWER(TRIM(a.name)) = LOWER(TRIM(?)) OR (? <> '' AND LOWER(a.name) LIKE ?)) AND (? IS NULL OR a.country_id = ?))
       OR (? <> '' AND LOWER(a.website) LIKE ?))
       ${scope}
     ORDER BY a.name, a.id
     LIMIT 200`,
    [params[0], params[1], params[1], ...params.slice(2)],
  );
  const candidates = rows
    .map((row) => {
      const rowDomain = normalizeCompanyDomain(row.website);
      const nameMatches = matchesProspectCompanyName(
        row.name,
        session.companyName,
      );
      const domainMatches = Boolean(
        domain && rowDomain && domain === rowDomain,
      );
      if (!nameMatches && !domainMatches) return null;
      return {
        id: Number(row.id),
        name: row.name || "",
        website: row.website || "",
        domain: rowDomain,
        country: row.country_name || "",
        activationStatus: row.activation_status || "",
        matchType: domainMatches ? "domain" : "name_country",
      };
    })
    .filter(Boolean);
  return {
    completed: true,
    requiresAccountsRead: false,
    countryResolved: Boolean(countryId),
    candidates,
  };
}

async function assertProspectAccountAccessible({ user, accountId }) {
  if (!hasAnyPermission(user, ["cuentas.read", "cuentas.read_all"])) {
    throw createHttpError(
      403,
      "Se requiere lectura de cuentas para convertir",
      {
        requiredPermission: "cuentas.read",
      },
    );
  }
  const params = [Number(accountId)];
  const scope = hasPermission(user, "cuentas.read_all")
    ? ""
    : "AND EXISTS (SELECT 1 FROM account_owners ao WHERE ao.account_id = a.id AND ao.user_id = ? )";
  if (!hasPermission(user, "cuentas.read_all")) params.push(Number(user.id));
  const rows = await query(
    `SELECT a.id FROM accounts a WHERE a.id = ? ${scope} LIMIT 1`,
    params,
  );
  if (!rows.length) {
    throw createHttpError(404, "La cuenta indicada no esta disponible");
  }
}

function splitContactName(value) {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1)
    return { firstName: parts[0], lastName: "Por confirmar" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) };
}

function mapSessionRow(row) {
  if (!row) return null;
  const chatHistory = parseJson(row.chat_history_json, []);
  return {
    id: Number(row.id),
    publicId: row.public_id,
    companyName: row.company_name,
    country: row.country,
    website: row.website || "",
    industry: row.industry || "",
    requestedByUserId: Number(row.requested_by_user_id),
    status: row.status,
    request: parseJson(row.request_json, null),
    result: parseJson(row.result_json, null),
    chatHistory: Array.isArray(chatHistory) ? chatHistory.slice(-16) : [],
    errorMessage: row.error_message || null,
    convertedAccountId:
      row.converted_account_id === null
        ? null
        : Number(row.converted_account_id),
    isTarget: Boolean(row.is_target),
    targetAddedAt: row.target_added_at || null,
    externalResearchedAt: row.external_researched_at || null,
    discardedAt: row.discarded_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at || null,
  };
}

function mapProspectChatJobRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    publicId: row.public_id,
    sessionId: Number(row.session_id),
    requestedByUserId: Number(row.requested_by_user_id),
    status: row.status,
    request: parseJson(row.request_json, null),
    result: parseJson(row.result_json, null),
    errorMessage: row.error_message || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at || null,
  };
}

function mapFindingRow(row) {
  if (!row) return null;
  const metadata = parseJson(row.metadata_json, {});
  return {
    id: Number(row.id),
    publicId: row.public_id,
    sessionId: Number(row.session_id),
    category: row.category,
    title: row.title,
    summary: row.summary || "",
    evidenceText: row.evidence_text || "",
    sourceExcerpt: metadata.sourceExcerpt || "",
    sourceTitle: metadata.sourceTitle || "",
    sourceType: row.source_type,
    sourceReference: row.source_reference || "",
    confidence: row.confidence,
    certainty: row.certainty,
    status: row.status,
    metadata,
    validatedByUserId:
      row.validated_by_user_id === null
        ? null
        : Number(row.validated_by_user_id),
    validatedAt: row.validated_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProspectResearchRunRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    publicId: row.public_id,
    sessionId: Number(row.session_id),
    status: row.status,
    query: row.query_text,
    provider: row.provider,
    findingCount: Number(row.finding_count || 0),
    contactCount: Number(row.contact_count || 0),
    hypothesisCount: Number(row.hypothesis_count || 0),
    warnings: parseJson(row.warnings_json, []),
    trackResults: parseJson(row.track_results_json, []),
    startedAt: row.started_at,
    finishedAt: row.finished_at || null,
    newFindingCount: Number(row.new_finding_count || 0),
    updatedFindingCount: Number(row.updated_finding_count || 0),
    unchangedFindingCount: Number(row.unchanged_finding_count || 0),
  };
}

function mapContactRow(row) {
  if (!row) return null;
  const metadata = parseJson(row.metadata_json, {});
  return {
    id: Number(row.id),
    publicId: row.public_id,
    sessionId: Number(row.session_id),
    name: row.name || "",
    roleTitle: row.role_title,
    area: row.area,
    email: row.email || "",
    evidenceText: metadata.evidenceText || "",
    sourceExcerpt: metadata.sourceExcerpt || "",
    sourceTitle: metadata.sourceTitle || "",
    sourcePublishedAt: metadata.sourcePublishedAt || null,
    sourceType: row.source_type,
    sourceReference: row.source_reference || "",
    confidence: row.confidence,
    status: row.status,
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapHypothesisRow(row) {
  if (!row) return null;
  const metadata = parseJson(row.metadata_json, {});
  return {
    id: Number(row.id),
    publicId: row.public_id,
    sessionId: Number(row.session_id),
    title: row.title,
    businessChallenge: row.business_challenge || "",
    technologyArea: row.technology_area || "",
    targetArea: row.target_area || "",
    suggestedContactRole: row.suggested_contact_role || "",
    validationQuestion: row.validation_question || "",
    evidenceText: metadata.evidenceText || "",
    sourceExcerpt: metadata.sourceExcerpt || "",
    sourceTitle: metadata.sourceTitle || "",
    sourceReference: metadata.sourceReference || "",
    sourcePublishedAt: metadata.sourcePublishedAt || null,
    confidence: row.confidence,
    status: row.status,
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeWebsite(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  return `https://${text}`;
}

function detectIndustryLabel(industry = "") {
  const text = String(industry || "").toLowerCase();
  if (text.includes("log") || text.includes("transporte"))
    return "operacion distribuida";
  if (text.includes("fin") || text.includes("banco"))
    return "continuidad y cumplimiento";
  if (text.includes("salud")) return "disponibilidad y proteccion de datos";
  if (text.includes("retail") || text.includes("comercio"))
    return "experiencia de cliente y omnicanalidad";
  return "eficiencia operativa y modernizacion tecnologica";
}

function buildProspectResearchResult(session) {
  const industrySignal = detectIndustryLabel(session.industry);
  const company = session.companyName;
  const country = session.country;
  const sourceReference = session.website || `${company} / ${country}`;

  const findings = [
    {
      category: "company_profile",
      title: "Perfil inicial de cuenta nueva",
      summary: `${company} se esta preparando como prospecto en ${country}${session.industry ? ` dentro de ${session.industry}` : ""}.`,
      evidenceText: `Datos ingresados por el vendedor: empresa=${company}; pais=${country}; industria=${session.industry || "sin industria"}; sitio=${session.website || "sin sitio"}.`,
      sourceType: "seller_input",
      sourceReference,
      confidence: "high",
      certainty: "confirmed",
      status: "suggested",
      metadata: { country, industry: session.industry || null },
    },
    {
      category: "business_challenge",
      title: "Reto probable para validar",
      summary: `Por el perfil ingresado, conviene validar prioridades de ${industrySignal}.`,
      evidenceText:
        "Inferencia basada unicamente en pais, industria y datos capturados en la sesion.",
      sourceType: "inference",
      sourceReference: "prospect_research_session",
      confidence: "medium",
      certainty: "inferred",
      status: "suggested",
      metadata: { industrySignal },
    },
    {
      category: "missing_information",
      title: "Faltan contactos y areas responsables",
      summary:
        "Antes de crear una oportunidad, falta identificar responsable tecnico, area usuaria y responsable economico.",
      evidenceText:
        "La sesion de prospeccion aun no tiene contactos confirmados.",
      sourceType: "system_gap_analysis",
      sourceReference: "prospect_research_session",
      confidence: "high",
      certainty: "confirmed",
      status: "suggested",
      metadata: {},
    },
  ];

  const contacts = [
    {
      name: "",
      roleTitle: "Responsable de TI",
      area: "Tecnologia",
      sourceType: "inferred_role",
      sourceReference: "perfil de cuenta nueva",
      confidence: "medium",
      status: "suggested",
      metadata: { priority: "high" },
    },
    {
      name: "",
      roleTitle: "Responsable de Operaciones",
      area: "Operaciones",
      sourceType: "inferred_role",
      sourceReference: "perfil de cuenta nueva",
      confidence: "medium",
      status: "suggested",
      metadata: { priority: "medium" },
    },
    {
      name: "",
      roleTitle: "Compras o Finanzas",
      area: "Compras / Finanzas",
      sourceType: "inferred_role",
      sourceReference: "perfil de cuenta nueva",
      confidence: "low",
      status: "suggested",
      metadata: { priority: "medium" },
    },
  ];

  const hypotheses = [
    {
      title: "Descubrir iniciativa de continuidad y disponibilidad",
      businessChallenge: `Validar si ${company} tiene riesgos de continuidad, disponibilidad o recuperacion en sus operaciones principales.`,
      technologyArea:
        "Continuidad operativa / infraestructura / servicios administrados",
      targetArea: "Tecnologia y Operaciones",
      suggestedContactRole: "Responsable de TI",
      validationQuestion:
        "¿Que sistemas o procesos no pueden detenerse sin impactar al negocio?",
      confidence: "medium",
      status: "suggested",
      metadata: { industrySignal },
    },
    {
      title: "Validar necesidades de seguridad y control",
      businessChallenge:
        "Identificar si existen preocupaciones de seguridad, cumplimiento, accesos o proteccion de informacion.",
      technologyArea: "Ciberseguridad",
      targetArea: "Tecnologia",
      suggestedContactRole: "Responsable de Seguridad o TI",
      validationQuestion:
        "¿Que riesgos tecnologicos o de seguridad estan priorizando actualmente?",
      confidence: "medium",
      status: "suggested",
      metadata: {},
    },
  ];

  return {
    headline: `Ficha de prospeccion para ${company}`,
    summary: `Se preparo una ficha inicial con ${findings.length} hallazgos, ${contacts.length} contactos objetivo y ${hypotheses.length} hipotesis de oportunidad.`,
    profile: {
      companyName: company,
      country,
      website: session.website || "",
      industry: session.industry || "",
      positioning: `Prospecto para validar ${industrySignal}.`,
    },
    outreach: {
      subject: `Explorar prioridades tecnologicas en ${company}`,
      body: `Hola,\n\nEstoy investigando prioridades de ${company} en ${country} para entender si podemos apoyar en retos de tecnologia, continuidad o eficiencia operativa.\n\nMe gustaria validar quien seria la persona adecuada para conversar sobre iniciativas actuales y posibles areas de mejora.\n\n¿Podrias orientarme con el contacto correcto?\n\nSaludos,`,
      questions: [
        "¿Que area esta impulsando actualmente iniciativas tecnologicas?",
        "¿Que problema de negocio seria mas valioso resolver este trimestre?",
        "¿Quien valida el impacto tecnico y quien aprueba presupuesto?",
        "¿Que tecnologias o proveedores actuales deberiamos considerar?",
      ],
    },
    findings,
    contacts,
    hypotheses,
  };
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function canonicalizeExternalSourceUrl(value) {
  if (!isHttpUrl(value)) return "";
  try {
    const url = new URL(String(value));
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|gclid|fbclid|msclkid)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    url.searchParams.sort();
    return url.toString().replace(/\/$/, url.pathname === "/" ? "/" : "");
  } catch {
    return "";
  }
}

export function deduplicateExternalFindings(findings = []) {
  const uniqueFindings = [];
  const sourceUrls = new Set();
  for (const finding of findings) {
    const canonicalUrl = canonicalizeExternalSourceUrl(
      finding?.sourceReference,
    );
    if (!canonicalUrl || sourceUrls.has(canonicalUrl)) continue;
    sourceUrls.add(canonicalUrl);
    uniqueFindings.push(finding);
  }
  return uniqueFindings;
}

export function keepFindingsWithKnownSources(findings = [], sourceUrls = []) {
  const allowedSourceUrls = new Set(
    sourceUrls.map(canonicalizeExternalSourceUrl).filter(Boolean),
  );
  return findings.filter((finding) =>
    allowedSourceUrls.has(
      canonicalizeExternalSourceUrl(finding?.sourceReference),
    ),
  );
}

function normalizeEvidenceForMatch(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("es");
}

export function hasSourceEvidenceMatch(item, sources = []) {
  const sourceUrl = canonicalizeExternalSourceUrl(
    item?.sourceReference || item?.metadata?.sourceReference,
  );
  if (!sourceUrl) return false;
  const source = sources.find(
    (candidate) => canonicalizeExternalSourceUrl(candidate?.url) === sourceUrl,
  );
  if (!source) return false;
  const sourceText = normalizeEvidenceForMatch(
    `${source.title || ""} ${source.content || ""}`,
  );
  const evidenceText = normalizeEvidenceForMatch(
    item?.evidenceText || item?.metadata?.evidenceText,
  );
  if (!evidenceText) return false;
  if (item?.name || item?.roleTitle) {
    const name = normalizeEvidenceForMatch(item.name);
    const roleTitle = normalizeEvidenceForMatch(item.roleTitle);
    return Boolean(
      name &&
      roleTitle &&
      sourceText.includes(name) &&
      sourceText.includes(roleTitle),
    );
  }
  return true;
}

export function keepItemsWithSourceEvidence(items = [], sources = []) {
  return items.filter((item) => hasSourceEvidenceMatch(item, sources));
}

export function attachRetrievedSourceExcerpt(item, sources = []) {
  const sourceUrl = canonicalizeExternalSourceUrl(
    item?.sourceReference || item?.metadata?.sourceReference,
  );
  const source = sources.find(
    (candidate) => canonicalizeExternalSourceUrl(candidate?.url) === sourceUrl,
  );
  if (!source) return item;
  const sourceExcerpt = clip(source.content || source.title || "", 900);
  return {
    ...item,
    metadata: {
      ...(item.metadata || {}),
      sourceExcerpt,
      sourceTitle: clip(source.title, 300),
      sourcePublishedAt: source.publishedAt || null,
    },
  };
}

function sameExternalFindingContent(existing, incoming) {
  return [
    [existing.title, incoming.title],
    [existing.summary, incoming.summary],
    [existing.evidence_text, incoming.evidenceText],
  ].every(
    ([left, right]) =>
      String(left || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase() ===
      String(right || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase(),
  );
}

export function classifyExternalFindingObservation(existing, incoming) {
  if (!existing) return "new";
  if (sameExternalFindingContent(existing, incoming)) return "unchanged";
  return "updated";
}

export function normalizeExternalFinding(
  rawFinding,
  index = 0,
  sourceType = "public_web",
) {
  const sourceUrl = clip(
    rawFinding?.sourceUrl || rawFinding?.sourceReference || "",
    500,
  );
  const title = clip(rawFinding?.title || `Señal publica ${index + 1}`, 190);
  const summary = clip(
    rawFinding?.summary || rawFinding?.description || "",
    4000,
  );
  const evidenceText = clip(
    rawFinding?.evidenceText || rawFinding?.evidence || "",
    4000,
  );
  return {
    category: clip(rawFinding?.category || "business_challenge", 60),
    title,
    summary: summary || title,
    evidenceText,
    sourceType,
    sourceReference: isHttpUrl(sourceUrl) ? sourceUrl : "",
    confidence: ["high", "medium", "low"].includes(rawFinding?.confidence)
      ? rawFinding.confidence
      : "medium",
    certainty: "evidenced",
    status: "suggested",
    metadata: { externalResearch: true },
  };
}

export function applyExternalEvidencePolicy(findings, requireEvidence) {
  if (!requireEvidence) {
    return { findings, omittedCount: 0 };
  }
  const accepted = [];
  for (const finding of findings) {
    if (
      isHttpUrl(finding.sourceReference) &&
      String(finding.evidenceText || "").trim()
    ) {
      accepted.push(finding);
    }
  }
  return {
    findings: accepted,
    omittedCount: findings.length - accepted.length,
  };
}

export function buildProspectExternalQuery(
  session,
  previousFindingTitles = [],
) {
  const previousTopics = previousFindingTitles
    .map((finding) =>
      clip(typeof finding === "string" ? finding : finding?.title, 140),
    )
    .filter(Boolean)
    .slice(0, 5)
    .join(" ");
  return clip(
    `${session.companyName} ${session.country} ${session.industry || "empresa"} ${previousTopics ? `actualización novedades ${previousTopics}` : "proyectos tecnología noticias"}`,
    1000,
  );
}

export function buildProspectExternalTrackQueries(
  session,
  previousFindingTitles = [],
) {
  const baseQuery =
    typeof previousFindingTitles === "string"
      ? clip(previousFindingTitles, 1000)
      : buildProspectExternalQuery(session, previousFindingTitles);
  return PROSPECT_RESEARCH_TRACKS.map((track) => ({
    key: track.key,
    label: track.label,
    query: clip(`${baseQuery} ${track.queryTerms}`, 1000),
  }));
}

export function normalizeExternalContact(rawContact, index = 0) {
  const sourceReference = clip(
    rawContact?.sourceUrl || rawContact?.sourceReference || "",
    500,
  );
  const name = clip(rawContact?.name, 190);
  const roleTitle = clip(rawContact?.roleTitle || rawContact?.title, 190);
  const evidenceText = clip(
    rawContact?.evidenceText || rawContact?.evidence || "",
    2000,
  );
  if (!name || !roleTitle || !isHttpUrl(sourceReference) || !evidenceText) {
    return null;
  }
  return {
    name,
    roleTitle,
    area: clip(rawContact?.area || roleTitle, 160),
    email: "",
    sourceType: "public_source",
    sourceReference,
    confidence: ["high", "medium", "low"].includes(rawContact?.confidence)
      ? rawContact.confidence
      : "medium",
    status: "suggested",
    metadata: {
      externalResearch: true,
      evidenceText,
      sourcePublishedAt: clip(rawContact?.sourcePublishedAt, 40) || null,
      sourceIndex: index,
    },
  };
}

export function normalizeExternalHypothesis(rawHypothesis, index = 0) {
  const sourceReference = clip(
    rawHypothesis?.sourceUrl || rawHypothesis?.sourceReference || "",
    500,
  );
  const evidenceText = clip(
    rawHypothesis?.evidenceText || rawHypothesis?.evidence || "",
    2000,
  );
  const title = clip(rawHypothesis?.title, 190);
  if (!title || !isHttpUrl(sourceReference) || !evidenceText) return null;
  return {
    title,
    businessChallenge: clip(
      rawHypothesis?.businessChallenge || rawHypothesis?.summary,
      4000,
    ),
    technologyArea: clip(rawHypothesis?.technologyArea, 160),
    targetArea: clip(rawHypothesis?.targetArea, 160),
    suggestedContactRole: clip(rawHypothesis?.suggestedContactRole, 190),
    validationQuestion: clip(rawHypothesis?.validationQuestion, 2000),
    confidence: ["high", "medium", "low"].includes(rawHypothesis?.confidence)
      ? rawHypothesis.confidence
      : "medium",
    status: "suggested",
    metadata: {
      externalResearch: true,
      evidenceText,
      sourceReference,
      sourcePublishedAt: clip(rawHypothesis?.sourcePublishedAt, 40) || null,
      sourceIndex: index,
    },
  };
}

export function normalizeExternalTargetRole(rawRole, verifiedFindings = []) {
  const roleTitle = clip(rawRole?.roleTitle, 190);
  const area = clip(rawRole?.area || roleTitle, 160);
  const rationale = clip(rawRole?.rationale, 1000);
  const validationQuestion = clip(rawRole?.validationQuestion, 1000);
  const basisFindingTitle = clip(rawRole?.basisFindingTitle, 190);
  const verifiedFinding = verifiedFindings.find(
    (finding) =>
      String(finding.title || "")
        .trim()
        .toLowerCase() === basisFindingTitle.trim().toLowerCase(),
  );
  if (
    !roleTitle ||
    !rationale ||
    !validationQuestion ||
    !verifiedFinding?.sourceReference
  ) {
    return null;
  }
  return {
    roleTitle,
    area,
    rationale,
    validationQuestion,
    basisFindingTitle: verifiedFinding.title,
    sourceReference: verifiedFinding.sourceReference,
    researchTracks: verifiedFinding.metadata?.researchTracks || [],
  };
}

export function normalizeExternalSellerBrief(rawBrief, verifiedFindings = []) {
  const verifiedSources = new Set(
    verifiedFindings
      .map((finding) => canonicalizeExternalSourceUrl(finding.sourceReference))
      .filter(Boolean),
  );
  const sourceReferences = [
    ...new Set(
      (Array.isArray(rawBrief?.sourceUrls) ? rawBrief.sourceUrls : [])
        .map(canonicalizeExternalSourceUrl)
        .filter((source) => verifiedSources.has(source)),
    ),
  ];
  const whyNow = clip(rawBrief?.whyNow, 1200);
  const recommendedOpening = clip(rawBrief?.recommendedOpening, 1200);
  const discoveryQuestions = Array.isArray(rawBrief?.discoveryQuestions)
    ? rawBrief.discoveryQuestions
        .map((question) => clip(question, 500))
        .filter(Boolean)
        .slice(0, 5)
    : [];
  if (
    !whyNow ||
    !recommendedOpening ||
    !discoveryQuestions.length ||
    !sourceReferences.length
  ) {
    return null;
  }
  return {
    whyNow,
    recommendedOpening,
    discoveryQuestions,
    sourceReferences,
  };
}

export function deduplicateExternalContacts(contacts = []) {
  const seen = new Set();
  return contacts.filter((contact) => {
    const identity = String(contact?.name || "")
      .trim()
      .toLocaleLowerCase("es")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "");
    const source = canonicalizeExternalSourceUrl(contact?.sourceReference);
    const key = `${identity}|${source}`;
    if (!identity || !source || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function deduplicateExternalHypotheses(hypotheses = []) {
  const seen = new Set();
  return hypotheses.filter((hypothesis) => {
    const source = canonicalizeExternalSourceUrl(
      hypothesis?.metadata?.sourceReference,
    );
    const title = String(hypothesis?.title || "")
      .trim()
      .toLocaleLowerCase("es");
    const key = `${title}|${source}`;
    if (!title || !source || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function runProspectExternalResearch({ session, user, queryText }) {
  const tracks = buildProspectExternalTrackQueries(session, queryText || []);
  const trackResults = await Promise.all(
    tracks.map(async (track) => ({
      ...track,
      search: await searchTavily({ query: track.query }),
    })),
  );
  const tavilyResults = trackResults.flatMap((track) =>
    track.search.results.map((source) => ({
      ...source,
      researchTrack: track.key,
    })),
  );
  const sourceByCanonicalUrl = new Map(
    tavilyResults.map((source) => [
      canonicalizeExternalSourceUrl(source.url),
      source,
    ]),
  );
  const researchTracksForSource = (sourceReference) => {
    const canonicalUrl = canonicalizeExternalSourceUrl(sourceReference);
    return trackResults
      .filter((track) =>
        track.search.results.some(
          (source) =>
            canonicalizeExternalSourceUrl(source.url) === canonicalUrl,
        ),
      )
      .map((track) => track.key);
  };
  const enabled = trackResults.some((track) => track.search.enabled);
  const tavilyWarnings = trackResults.flatMap((track) =>
    (track.search.warnings || []).map(
      (warning) => `${track.label}: ${warning}`,
    ),
  );
  if (!enabled || !tavilyResults.length) {
    return {
      enabled: false,
      findings: [],
      contacts: [],
      hypotheses: [],
      targetRoles: [],
      sellerBrief: null,
      trackResults: trackResults.map((track) => ({
        key: track.key,
        label: track.label,
        enabled: track.search.enabled,
        sourceCount: track.search.results.length,
        findingCount: 0,
        contactCount: 0,
        hypothesisCount: 0,
        warnings: track.search.warnings || [],
      })),
      warnings: tavilyWarnings,
      sourceUrls: [],
      provider: "tavily",
    };
  }
  const result = await runStructuredTextResearch({
    schemaName: "prospect_external_research",
    systemPrompt: [
      "Eres un agente de investigacion comercial B2B.",
      "Interpreta exclusivamente las fuentes públicas recuperadas por las cuatro búsquedas temáticas.",
      "No afirmes como hecho lo que sea inferencia; cada elemento debe incluir una sourceUrl de las fuentes entregadas y una síntesis breve de la evidencia en evidenceText. El backend adjuntará por separado el fragmento original de Tavily; no intentes copiarlo palabra por palabra.",
      "Los contactos solo pueden ser personas cuyo nombre y cargo aparezcan en el título o contenido de la URL citada. No infieras personas, emails ni datos personales.",
      "Las hipótesis comerciales deben ser preguntas por validar derivadas de evidencia, no afirmar intención de compra.",
      "Cuando no haya personas públicas verificables, puedes sugerir roles objetivo genéricos, nunca nombres. Cada rol debe enlazarse al título exacto de un hallazgo verificado y ser útil para una conversación inicial.",
      "La guía para el vendedor debe explicar por qué contactar ahora usando fuentes, proponer una apertura en forma de pregunta y sugerir preguntas abiertas. No declares que la empresa tiene una necesidad ni que pretende comprar.",
      "Clasifica hallazgos en company_profile, business_challenge, technology_project, stakeholder, decision_area, need, pain_point, risk o next_step.",
    ].join("\n"),
    subject: session.companyName,
    context: {
      country: session.country,
      website: session.website || "",
      industry: session.industry || "",
      researchTracks: trackResults.map((track) => ({
        key: track.key,
        label: track.label,
        query: track.query,
        sourceCount: track.search.results.length,
      })),
      publicSources: tavilyResults,
    },
    currentValues: {},
    fields: [
      {
        key: "findings",
        type: "array",
        example: [],
        items: {
          type: "object",
          fields: [
            { key: "category", type: "string", example: "technology_project" },
            {
              key: "title",
              type: "string",
              example: "Posible iniciativa cloud",
            },
            { key: "summary", type: "string", example: "Resumen de la señal" },
            {
              key: "evidenceText",
              type: "string",
              example: "La empresa está ampliando sus servicios digitales.",
            },
            {
              key: "sourceUrl",
              type: "string",
              example: "https://example.com",
            },
            {
              key: "confidence",
              type: "enum",
              enum: ["high", "medium", "low"],
              example: "medium",
            },
          ],
        },
      },
      {
        key: "contacts",
        type: "array",
        example: [],
        required: false,
        items: {
          type: "object",
          fields: [
            { key: "name", type: "string", example: "Nombre publicado" },
            { key: "roleTitle", type: "string", example: "CTO" },
            { key: "area", type: "string", example: "Tecnología" },
            {
              key: "evidenceText",
              type: "string",
              example: "El artículo informa que María García fue nombrada CTO.",
            },
            {
              key: "sourceUrl",
              type: "string",
              example: "https://example.com",
            },
            {
              key: "sourcePublishedAt",
              type: "string",
              example: "",
            },
            {
              key: "confidence",
              type: "enum",
              enum: ["high", "medium", "low"],
              example: "medium",
            },
          ],
        },
      },
      {
        key: "hypotheses",
        type: "array",
        example: [],
        required: false,
        items: {
          type: "object",
          fields: [
            {
              key: "title",
              type: "string",
              example: "Validar continuidad de aplicaciones",
            },
            {
              key: "businessChallenge",
              type: "string",
              example: "Posible reto derivado de la fuente",
            },
            {
              key: "technologyArea",
              type: "string",
              example: "Entrega de aplicaciones",
            },
            { key: "targetArea", type: "string", example: "Tecnología" },
            {
              key: "suggestedContactRole",
              type: "string",
              example: "Responsable de infraestructura",
            },
            {
              key: "validationQuestion",
              type: "string",
              example: "¿Cómo gestionan actualmente la disponibilidad?",
            },
            {
              key: "evidenceText",
              type: "string",
              example:
                "La compañía describe una expansión de sus aplicaciones.",
            },
            {
              key: "sourceUrl",
              type: "string",
              example: "https://example.com",
            },
            {
              key: "sourcePublishedAt",
              type: "string",
              example: "",
            },
            {
              key: "confidence",
              type: "enum",
              enum: ["high", "medium", "low"],
              example: "medium",
            },
          ],
        },
      },
      {
        key: "targetRoles",
        type: "array",
        example: [],
        required: false,
        items: {
          type: "object",
          fields: [
            {
              key: "roleTitle",
              type: "string",
              example: "Responsable de infraestructura",
            },
            { key: "area", type: "string", example: "Tecnología" },
            {
              key: "rationale",
              type: "string",
              example: "Este rol podría validar la señal publicada.",
            },
            {
              key: "validationQuestion",
              type: "string",
              example: "¿Quién lidera hoy esta plataforma?",
            },
            {
              key: "basisFindingTitle",
              type: "string",
              example: "Modernización de aplicaciones",
            },
          ],
        },
      },
      {
        key: "sellerBrief",
        type: "object",
        required: false,
        fields: [
          {
            key: "whyNow",
            type: "string",
            example: "La fuente describe un cambio reciente.",
          },
          {
            key: "recommendedOpening",
            type: "string",
            example: "¿Cómo están abordando este cambio?",
          },
          {
            key: "discoveryQuestions",
            type: "array",
            example: [],
            items: {
              type: "string",
              example: "¿Qué objetivo buscan alcanzar?",
            },
          },
          {
            key: "sourceUrls",
            type: "array",
            example: [],
            items: { type: "string", example: "https://example.com/source" },
          },
        ],
      },
      {
        key: "warnings",
        type: "array",
        example: [],
        items: {
          type: "string",
          example: "No se encontraron fuentes suficientes",
        },
        required: false,
      },
    ],
    aiUsageContext: {
      userId: Number(user.id),
      featureCode: "prospect_research.external",
      jobType: "prospect_external_research",
      jobId: session.id,
    },
  });

  if (!result) {
    return {
      enabled: false,
      findings: [],
      contacts: [],
      hypotheses: [],
      targetRoles: [],
      sellerBrief: null,
      warnings: [
        "OpenAI no esta disponible para interpretar los resultados de Tavily.",
      ],
      trackResults: trackResults.map((track) => ({
        key: track.key,
        label: track.label,
        enabled: track.search.enabled,
        sourceCount: track.search.results.length,
        findingCount: 0,
        contactCount: 0,
        hypothesisCount: 0,
        warnings: ["No fue posible sintetizar las fuentes de este tema."],
      })),
      sourceUrls: tavilyResults.map((source) => source.url),
      provider: "tavily",
    };
  }

  const allowedSourceUrls = tavilyResults.map((source) => source.url);
  const candidateFindings = Array.isArray(result.findings)
    ? result.findings
        .map((finding, index) =>
          normalizeExternalFinding(finding, index, "tavily"),
        )
        .filter((finding) => finding.title)
    : [];
  const findings = keepItemsWithSourceEvidence(
    candidateFindings,
    tavilyResults,
  ).map((finding) =>
    attachRetrievedSourceExcerpt(
      {
        ...finding,
        metadata: {
          ...finding.metadata,
          researchTracks: researchTracksForSource(finding.sourceReference),
          sourcePublishedAt:
            sourceByCanonicalUrl.get(
              canonicalizeExternalSourceUrl(finding.sourceReference),
            )?.publishedAt || null,
        },
      },
      tavilyResults,
    ),
  );
  const candidateContacts = Array.isArray(result.contacts)
    ? result.contacts.map(normalizeExternalContact).filter(Boolean)
    : [];
  const contacts = deduplicateExternalContacts(
    keepItemsWithSourceEvidence(candidateContacts, tavilyResults).map(
      (contact) =>
        attachRetrievedSourceExcerpt(
          {
            ...contact,
            metadata: {
              ...contact.metadata,
              researchTracks: researchTracksForSource(contact.sourceReference),
              sourcePublishedAt:
                sourceByCanonicalUrl.get(
                  canonicalizeExternalSourceUrl(contact.sourceReference),
                )?.publishedAt || null,
            },
          },
          tavilyResults,
        ),
    ),
  );
  const candidateHypotheses = Array.isArray(result.hypotheses)
    ? result.hypotheses.map(normalizeExternalHypothesis).filter(Boolean)
    : [];
  const hypotheses = deduplicateExternalHypotheses(
    candidateHypotheses
      .filter(
        (hypothesis) =>
          keepItemsWithSourceEvidence(
            [
              {
                ...hypothesis,
                sourceReference: hypothesis.metadata.sourceReference,
              },
            ],
            tavilyResults,
          ).length,
      )
      .map((hypothesis) =>
        attachRetrievedSourceExcerpt(
          {
            ...hypothesis,
            metadata: {
              ...hypothesis.metadata,
              researchTracks: researchTracksForSource(
                hypothesis.metadata.sourceReference,
              ),
              sourcePublishedAt:
                sourceByCanonicalUrl.get(
                  canonicalizeExternalSourceUrl(
                    hypothesis.metadata.sourceReference,
                  ),
                )?.publishedAt || null,
            },
          },
          tavilyResults,
        ),
      ),
  );
  const targetRoles = Array.isArray(result.targetRoles)
    ? result.targetRoles
        .map((role) => normalizeExternalTargetRole(role, findings))
        .filter(Boolean)
    : [];
  const sellerBrief = normalizeExternalSellerBrief(
    result.sellerBrief,
    findings,
  );
  const trackResultsWithCounts = trackResults.map((track) => {
    const sourceSet = new Set(
      track.search.results.map((source) =>
        canonicalizeExternalSourceUrl(source.url),
      ),
    );
    const belongsToTrack = (sourceReference) =>
      sourceSet.has(canonicalizeExternalSourceUrl(sourceReference));
    return {
      key: track.key,
      label: track.label,
      query: track.query,
      enabled: track.search.enabled,
      sourceCount: track.search.results.length,
      findingCount: findings.filter((finding) =>
        belongsToTrack(finding.sourceReference),
      ).length,
      contactCount: contacts.filter((contact) =>
        belongsToTrack(contact.sourceReference),
      ).length,
      hypothesisCount: hypotheses.filter((hypothesis) =>
        belongsToTrack(hypothesis.metadata.sourceReference),
      ).length,
      warnings: track.search.warnings || [],
    };
  });
  return {
    enabled: true,
    findings,
    contacts,
    hypotheses,
    targetRoles,
    sellerBrief,
    trackResults: trackResultsWithCounts,
    sourceUrls: allowedSourceUrls,
    warnings: [
      ...tavilyWarnings,
      ...(Array.isArray(result.warnings)
        ? result.warnings.filter(Boolean)
        : []),
      ...(findings.length + contacts.length + hypotheses.length <
      (Array.isArray(result.findings) ? result.findings.length : 0) +
        (Array.isArray(result.contacts) ? result.contacts.length : 0) +
        (Array.isArray(result.hypotheses) ? result.hypotheses.length : 0)
        ? [
            "Se omitieron elementos sin evidencia o cuya fuente no coincide con los resultados recuperados.",
          ]
        : []),
    ],
    provider: "tavily",
  };
}

async function getOwnedSession(sessionId, userId) {
  const rows = await query(
    `SELECT * FROM prospect_research_sessions
     WHERE id = ? AND requested_by_user_id = ? AND discarded_at IS NULL LIMIT 1`,
    [Number(sessionId), Number(userId)],
  );
  return rows[0] || null;
}

async function insertSessionFindings(conn, sessionId, findings) {
  const now = new Date();
  const inserted = [];
  for (const finding of findings) {
    const publicId = `prf_${randomUUID()}`;
    const [result] = await conn.query(
      `INSERT INTO prospect_research_findings
        (public_id, session_id, category, title, summary, evidence_text,
         source_type, source_reference, confidence, certainty, status,
         metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        publicId,
        sessionId,
        finding.category,
        finding.title,
        finding.summary,
        finding.evidenceText,
        finding.sourceType,
        finding.sourceReference,
        finding.confidence,
        finding.certainty,
        finding.status || "suggested",
        JSON.stringify(finding.metadata || {}),
        now,
        now,
      ],
    );
    inserted.push({ ...finding, id: Number(result.insertId), publicId });
  }
  return inserted;
}

async function insertSessionContacts(conn, sessionId, contacts) {
  const now = new Date();
  const inserted = [];
  for (const contact of contacts) {
    const publicId = `prc_${randomUUID()}`;
    const [result] = await conn.query(
      `INSERT INTO prospect_research_contacts
        (public_id, session_id, name, role_title, area, email, source_type,
         source_reference, confidence, status, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        publicId,
        sessionId,
        contact.name || null,
        contact.roleTitle,
        contact.area,
        contact.email || null,
        contact.sourceType,
        contact.sourceReference,
        contact.confidence,
        contact.status || "suggested",
        JSON.stringify(contact.metadata || {}),
        now,
        now,
      ],
    );
    inserted.push({ ...contact, id: Number(result.insertId), publicId });
  }
  return inserted;
}

async function insertSessionHypotheses(conn, sessionId, hypotheses) {
  const now = new Date();
  const inserted = [];
  for (const hypothesis of hypotheses) {
    const publicId = `prh_${randomUUID()}`;
    const [result] = await conn.query(
      `INSERT INTO prospect_research_opportunity_hypotheses
        (public_id, session_id, title, business_challenge, technology_area,
         target_area, suggested_contact_role, validation_question, confidence,
         status, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        publicId,
        sessionId,
        hypothesis.title,
        hypothesis.businessChallenge,
        hypothesis.technologyArea,
        hypothesis.targetArea,
        hypothesis.suggestedContactRole,
        hypothesis.validationQuestion,
        hypothesis.confidence,
        hypothesis.status || "suggested",
        JSON.stringify(hypothesis.metadata || {}),
        now,
        now,
      ],
    );
    inserted.push({ ...hypothesis, id: Number(result.insertId), publicId });
  }
  return inserted;
}

export async function createProspectResearchSession({ user, payload }) {
  await ensureProspectResearchSchema();
  const companyName = clip(payload.companyName, 190);
  const country = clip(payload.country, 120);
  if (!(await resolveCountryId(country))) {
    throw createHttpError(
      400,
      "No se reconocio el pais. Selecciona un pais del catalogo antes de preparar la prospeccion.",
    );
  }
  const website = normalizeWebsite(payload.website);
  const industry = clip(payload.industry, 160);
  const existingSessions = await query(
    `SELECT * FROM prospect_research_sessions
     WHERE requested_by_user_id = ? AND discarded_at IS NULL
     ORDER BY external_researched_at IS NOT NULL DESC, updated_at DESC`,
    [Number(user.id)],
  );
  const existingSession = existingSessions.find((candidate) =>
    sameProspectIdentity(
      { companyName, country, website },
      {
        company_name: candidate.company_name,
        country: candidate.country,
        website: candidate.website,
      },
    ),
  );
  if (existingSession) {
    const session = await getProspectResearchSession({
      user,
      sessionId: Number(existingSession.id),
    });
    return { ...session, reused: true };
  }

  const publicId = `prs_${randomUUID()}`;
  const request = { companyName, country, website, industry };

  const result = await query(
    `INSERT INTO prospect_research_sessions
      (public_id, company_name, country, website, industry, requested_by_user_id,
       status, request_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, NOW(3), NOW(3))`,
    [
      publicId,
      companyName,
      country,
      website || null,
      industry || null,
      Number(user.id),
      JSON.stringify(request),
    ],
  );

  return {
    id: Number(result.insertId),
    publicId,
    companyName,
    country,
    website,
    industry,
    status: "draft",
    isTarget: false,
    targetAddedAt: null,
    reused: false,
  };
}

export async function listProspectResearchSessions({
  user,
  search = "",
  targetOnly = false,
  limit = 25,
  offset = 0,
}) {
  await ensureProspectResearchSchema();
  const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const normalizedOffset = Math.max(0, Number(offset) || 0);
  const searchText = `%${String(search || "")
    .trim()
    .slice(0, 190)}%`;
  const predicates = [
    "s.requested_by_user_id = ?",
    "s.discarded_at IS NULL",
    "(? = '' OR s.company_name LIKE ? OR s.country LIKE ? OR COALESCE(s.website, '') LIKE ? OR COALESCE(s.industry, '') LIKE ?)",
    "(? = 0 OR s.is_target = 1)",
  ];
  const params = [
    Number(user.id),
    String(search || "").trim(),
    searchText,
    searchText,
    searchText,
    searchText,
    targetOnly ? 1 : 0,
  ];
  const rows = await query(
    `SELECT s.*,
       (SELECT COUNT(*) FROM prospect_research_findings f
        WHERE f.session_id = s.id AND f.source_type IN ('tavily', 'public_web')) AS finding_count,
       (SELECT COUNT(*) FROM prospect_research_contacts c
        WHERE c.session_id = s.id AND c.source_type = 'public_source') AS contact_count,
       (SELECT COUNT(*) FROM prospect_research_opportunity_hypotheses h
        WHERE h.session_id = s.id AND JSON_EXTRACT(h.metadata_json, '$.externalResearch') = true) AS hypothesis_count,
       (SELECT COUNT(*) FROM prospect_research_runs r WHERE r.session_id = s.id) AS run_count,
       (SELECT r.status FROM prospect_research_runs r WHERE r.session_id = s.id
        ORDER BY r.started_at DESC, r.id DESC LIMIT 1) AS latest_run_status
     FROM prospect_research_sessions s
     WHERE ${predicates.join(" AND ")}
     ORDER BY s.is_target DESC, s.external_researched_at DESC, s.updated_at DESC, s.id DESC`,
    params,
  );
  const uniqueRows = groupDuplicateProspectSessions(
    rows.map((row) => ({
      ...mapSessionRow(row),
      findingCount: Number(row.finding_count || 0),
      contactCount: Number(row.contact_count || 0),
      hypothesisCount: Number(row.hypothesis_count || 0),
      runCount: Number(row.run_count || 0),
      latestRunStatus: row.latest_run_status || null,
    })),
  );
  const pageRows = uniqueRows.slice(
    normalizedOffset,
    normalizedOffset + normalizedLimit,
  );
  return {
    items: pageRows,
    total: uniqueRows.length,
    limit: normalizedLimit,
    offset: normalizedOffset,
  };
}

export async function discardProspectResearchSession({ user, sessionId }) {
  await ensureProspectResearchSchema();
  const session = await getOwnedSession(sessionId, user.id);
  if (!session) return null;
  const userSessions = await query(
    `SELECT * FROM prospect_research_sessions
     WHERE requested_by_user_id = ? AND discarded_at IS NULL`,
    [Number(user.id)],
  );
  const duplicates = userSessions.filter((candidate) =>
    sameProspectIdentity(
      {
        companyName: session.company_name,
        country: session.country,
        website: session.website,
      },
      {
        companyName: candidate.company_name,
        country: candidate.country,
        website: candidate.website,
      },
    ),
  );
  const sessionIds = duplicates.map((candidate) => Number(candidate.id));
  if (!sessionIds.includes(Number(sessionId)))
    sessionIds.push(Number(sessionId));
  const placeholders = sessionIds.map(() => "?").join(", ");
  await query(
    `UPDATE prospect_research_sessions
     SET discarded_at = NOW(3), is_target = 0, target_added_at = NULL,
         updated_at = NOW(3)
     WHERE requested_by_user_id = ? AND id IN (${placeholders})`,
    [Number(user.id), ...sessionIds],
  );
  return { discardedCount: sessionIds.length };
}

export async function setProspectResearchTarget({ user, sessionId, isTarget }) {
  await ensureProspectResearchSchema();
  const session = await getOwnedSession(sessionId, user.id);
  if (!session) return null;
  if (isTarget && !session.external_researched_at) {
    throw createHttpError(
      409,
      "Completa una investigación pública antes de agregar la empresa a Cuentas objetivo",
    );
  }
  await query(
    `UPDATE prospect_research_sessions
     SET is_target = ?, target_added_at = ?, updated_at = NOW(3)
     WHERE id = ? AND requested_by_user_id = ?`,
    [
      isTarget ? 1 : 0,
      isTarget ? new Date() : null,
      Number(sessionId),
      Number(user.id),
    ],
  );
  const updatedSession = await getOwnedSession(sessionId, user.id);
  return {
    id: Number(updatedSession.id),
    isTarget: Boolean(updatedSession.is_target),
    targetAddedAt: updatedSession.target_added_at || null,
  };
}

export async function getProspectResearchSession({ user, sessionId }) {
  await ensureProspectResearchSchema();
  const session = await getOwnedSession(sessionId, user.id);
  if (!session) return null;

  const [findings, contacts, hypotheses, researchRuns] = await Promise.all([
    query(
      `SELECT * FROM prospect_research_findings WHERE session_id = ? ORDER BY id ASC`,
      [Number(session.id)],
    ),
    query(
      `SELECT * FROM prospect_research_contacts WHERE session_id = ? ORDER BY id ASC`,
      [Number(session.id)],
    ),
    query(
      `SELECT * FROM prospect_research_opportunity_hypotheses WHERE session_id = ? ORDER BY id ASC`,
      [Number(session.id)],
    ),
    query(
      `SELECT r.*,
              COUNT(rf.finding_id) AS finding_count,
              (SELECT COUNT(*) FROM prospect_research_run_contacts rc WHERE rc.run_id = r.id) AS contact_count,
              (SELECT COUNT(*) FROM prospect_research_run_hypotheses rh WHERE rh.run_id = r.id) AS hypothesis_count,
              SUM(CASE WHEN rf.observation_status = 'new' THEN 1 ELSE 0 END) AS new_finding_count,
              SUM(CASE WHEN rf.observation_status = 'updated' THEN 1 ELSE 0 END) AS updated_finding_count,
              SUM(CASE WHEN rf.observation_status = 'unchanged' THEN 1 ELSE 0 END) AS unchanged_finding_count
       FROM prospect_research_runs r
       LEFT JOIN prospect_research_run_findings rf ON rf.run_id = r.id
       WHERE r.session_id = ?
       GROUP BY r.id
       ORDER BY r.started_at DESC, r.id DESC`,
      [Number(session.id)],
    ),
  ]);
  const latestRunFindings = researchRuns.length
    ? await query(
        `SELECT finding_id, observation_status
         FROM prospect_research_run_findings WHERE run_id = ?`,
        [Number(researchRuns[0].id)],
      )
    : [];
  const latestRunContacts = researchRuns.length
    ? await query(
        `SELECT contact_id, observation_status
         FROM prospect_research_run_contacts WHERE run_id = ?`,
        [Number(researchRuns[0].id)],
      )
    : [];
  const latestRunHypotheses = researchRuns.length
    ? await query(
        `SELECT hypothesis_id, observation_status
         FROM prospect_research_run_hypotheses WHERE run_id = ?`,
        [Number(researchRuns[0].id)],
      )
    : [];
  const latestObservationByFinding = new Map(
    latestRunFindings.map((item) => [
      Number(item.finding_id),
      item.observation_status,
    ]),
  );
  const latestObservationByContact = new Map(
    latestRunContacts.map((item) => [
      Number(item.contact_id),
      item.observation_status,
    ]),
  );
  const latestObservationByHypothesis = new Map(
    latestRunHypotheses.map((item) => [
      Number(item.hypothesis_id),
      item.observation_status,
    ]),
  );

  const mappedSession = {
    ...mapSessionRow(session),
    findings: findings.map((finding) => ({
      ...mapFindingRow(finding),
      lastResearchObservation:
        latestObservationByFinding.get(Number(finding.id)) || null,
    })),
    contacts: contacts.map((contact) => ({
      ...mapContactRow(contact),
      evidenceText: mapContactRow(contact).metadata?.evidenceText || "",
      sourcePublishedAt:
        mapContactRow(contact).metadata?.sourcePublishedAt || null,
      lastResearchObservation:
        latestObservationByContact.get(Number(contact.id)) || null,
    })),
    hypotheses: hypotheses.map((hypothesis) => ({
      ...mapHypothesisRow(hypothesis),
      sourceReference:
        mapHypothesisRow(hypothesis).metadata?.sourceReference || "",
      evidenceText: mapHypothesisRow(hypothesis).metadata?.evidenceText || "",
      lastResearchObservation:
        latestObservationByHypothesis.get(Number(hypothesis.id)) || null,
    })),
    externalResearchRuns: researchRuns.map(mapProspectResearchRunRow),
  };
  return {
    ...mappedSession,
    duplicateReview: mappedSession.result
      ? await findProspectAccountDuplicates({ user, session: mappedSession })
      : null,
  };
}

export async function createProspectChatJob({ user, sessionId, question }) {
  await ensureProspectResearchSchema();
  const session = await getProspectResearchSession({ user, sessionId });
  if (!session) return null;
  if (session.status !== "completed" || !session.result) {
    throw createHttpError(
      409,
      "La ficha de prospección debe estar lista antes de iniciar el chat",
    );
  }

  const result = await query(
    `INSERT INTO prospect_research_chat_jobs
      (public_id, session_id, requested_by_user_id, status, request_json,
       created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, NOW(3), NOW(3))`,
    [
      `prcj_${randomUUID()}`,
      Number(session.id),
      Number(user.id),
      JSON.stringify({
        question: String(question || "")
          .trim()
          .slice(0, 2000),
      }),
    ],
  );
  return {
    id: Number(result.insertId),
    sessionId: Number(session.id),
    status: "pending",
    pollAfterMs: 700,
  };
}

export async function getProspectChatJob({ user, sessionId, jobId }) {
  await ensureProspectResearchSchema();
  const rows = await query(
    `SELECT * FROM prospect_research_chat_jobs
     WHERE id = ? AND session_id = ? AND requested_by_user_id = ? LIMIT 1`,
    [Number(jobId), Number(sessionId), Number(user.id)],
  );
  return mapProspectChatJobRow(rows[0]);
}

export async function processProspectChatJob({ user, jobId }) {
  await ensureProspectResearchSchema();
  const rows = await query(
    `SELECT * FROM prospect_research_chat_jobs
     WHERE id = ? AND requested_by_user_id = ? LIMIT 1`,
    [Number(jobId), Number(user.id)],
  );
  const job = mapProspectChatJobRow(rows[0]);
  if (!job) return null;
  if (job.status !== "pending") return job;

  const claim = await query(
    `UPDATE prospect_research_chat_jobs
     SET status = 'running', updated_at = NOW(3)
     WHERE id = ? AND requested_by_user_id = ? AND status = 'pending'`,
    [Number(jobId), Number(user.id)],
  );
  if (!claim.affectedRows) {
    return getProspectChatJob({
      user,
      sessionId: job.sessionId,
      jobId,
    });
  }

  try {
    const session = await getProspectResearchSession({
      user,
      sessionId: job.sessionId,
    });
    if (!session) throw createHttpError(404, "Prospección no encontrada");
    const question = String(job.request?.question || "")
      .trim()
      .slice(0, 2000);
    if (!question) throw createHttpError(400, "La pregunta está vacía");

    let turn;
    try {
      turn = await createProspectChatAdapter({
        user,
        session,
        jobId: Number(jobId),
      }).runTurn({
        question,
        history: (Array.isArray(session.chatHistory) ? session.chatHistory : [])
          .map((message) => ({
            role: message?.role === "assistant" ? "assistant" : "user",
            text: String(message?.text || message?.answer || "").slice(0, 2000),
          }))
          .filter((message) => message.text),
      });
    } catch (error) {
      turn = {
        response: buildProspectFallback(session, question),
        qualityTrace: {
          process: "prospect_chat",
          validationStatus: "error",
          validationReasons: ["adapter_execution_failed"],
          errorCode: String(
            error?.code || error?.name || "adapter_execution_failed",
          ),
        },
      };
    }

    const qualityTraceId = await recordCoachTurnQualityTrace({
      channel: "prospect",
      process: turn.qualityTrace?.process || "prospect_chat",
      userId: user.id,
      sessionId: session.id,
      jobId: Number(jobId),
      trace: turn.qualityTrace,
    }).catch((error) => {
      console.warn(
        "[mi-agent] No fue posible registrar traza de Cuenta nueva:",
        error?.message || error,
      );
      return null;
    });
    const response = {
      ...turn.response,
      qualityTraceId,
      channel: "prospect",
      sessionId: Number(session.id),
      source: "prospect_research",
    };
    const assistantHistory = {
      role: "assistant",
      text: String(response.answer || "")
        .trim()
        .slice(0, 2000),
      ...response,
    };

    await withTransaction(async (conn) => {
      const [sessionRows] = await conn.query(
        `SELECT chat_history_json FROM prospect_research_sessions
         WHERE id = ? AND requested_by_user_id = ? FOR UPDATE`,
        [Number(session.id), Number(user.id)],
      );
      if (!sessionRows.length) {
        throw createHttpError(404, "Prospección no encontrada");
      }
      const currentHistory = parseJson(sessionRows[0].chat_history_json, []);
      const nextHistory = [
        ...(Array.isArray(currentHistory) ? currentHistory : []),
        { role: "user", text: question },
        assistantHistory,
      ]
        .filter((message) => message.text)
        .slice(-16);
      await conn.query(
        `UPDATE prospect_research_sessions
         SET chat_history_json = ?, updated_at = NOW(3)
         WHERE id = ? AND requested_by_user_id = ?`,
        [JSON.stringify(nextHistory), Number(session.id), Number(user.id)],
      );
      await conn.query(
        `UPDATE prospect_research_chat_jobs
         SET status = 'completed', result_json = ?, error_message = NULL,
             updated_at = NOW(3), finished_at = NOW(3)
         WHERE id = ? AND requested_by_user_id = ?`,
        [JSON.stringify(response), Number(jobId), Number(user.id)],
      );
    });
  } catch (error) {
    const errorMessage = clip(
      error?.message || "No fue posible responder sobre el prospecto",
      1000,
    );
    await query(
      `UPDATE prospect_research_chat_jobs
       SET status = 'failed', error_message = ?, updated_at = NOW(3),
           finished_at = NOW(3)
       WHERE id = ? AND requested_by_user_id = ?`,
      [errorMessage, Number(jobId), Number(user.id)],
    ).catch(() => undefined);
  }

  return getProspectChatJob({
    user,
    sessionId: job.sessionId,
    jobId,
  });
}

export async function runProspectChat({ user, sessionId, question }) {
  await ensureProspectResearchSchema();
  const session = await getProspectResearchSession({ user, sessionId });
  if (!session) return null;
  let result;
  try {
    result = await createProspectChatAdapter({
      user,
      session,
      jobId: null,
    }).runTurn({ question, history: session.chatHistory });
  } catch (error) {
    result = {
      response: buildProspectFallback(session, question),
      qualityTrace: {
        process: "prospect_chat",
        validationStatus: "error",
        validationReasons: ["adapter_execution_failed"],
        errorCode: String(
          error?.code || error?.name || "adapter_execution_failed",
        ),
      },
    };
  }
  const qualityTraceId = await recordCoachTurnQualityTrace({
    channel: "prospect",
    process: result.qualityTrace?.process || "prospect_chat",
    userId: user.id,
    sessionId: session.id,
    trace: result.qualityTrace,
  }).catch((error) => {
    console.warn(
      "[mi-agent] No fue posible registrar traza de Cuenta nueva:",
      error?.message || error,
    );
    return null;
  });
  await withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT chat_history_json FROM prospect_research_sessions
       WHERE id = ? AND requested_by_user_id = ? FOR UPDATE`,
      [Number(session.id), Number(user.id)],
    );
    if (!rows.length) return;
    const currentHistory = parseJson(rows[0].chat_history_json, []);
    const nextHistory = [
      ...(Array.isArray(currentHistory) ? currentHistory : []),
      {
        role: "user",
        text: String(question || "")
          .trim()
          .slice(0, 2000),
      },
      {
        role: "assistant",
        text: String(result.response?.answer || "")
          .trim()
          .slice(0, 2000),
      },
    ]
      .filter((message) => message.text)
      .slice(-16);
    await conn.query(
      `UPDATE prospect_research_sessions
       SET chat_history_json = ?, updated_at = NOW(3)
       WHERE id = ? AND requested_by_user_id = ?`,
      [JSON.stringify(nextHistory), Number(session.id), Number(user.id)],
    );
  });
  return {
    ...result.response,
    qualityTraceId,
    channel: "prospect",
    sessionId: Number(sessionId),
    source: "prospect_research",
  };
}

export async function runProspectResearchSession({ user, sessionId }) {
  await ensureProspectResearchSchema();
  const sessionRow = await getOwnedSession(sessionId, user.id);
  if (!sessionRow) return null;
  if (["running", "completed"].includes(String(sessionRow.status))) {
    return getProspectResearchSession({ user, sessionId });
  }

  await query(
    `UPDATE prospect_research_sessions SET status = 'running', updated_at = NOW(3) WHERE id = ?`,
    [Number(sessionRow.id)],
  );

  try {
    const session = mapSessionRow(sessionRow);
    const result = buildProspectResearchResult(session);
    await withTransaction(async (conn) => {
      await conn.query(
        `DELETE FROM prospect_research_findings WHERE session_id = ?`,
        [Number(session.id)],
      );
      await conn.query(
        `DELETE FROM prospect_research_contacts WHERE session_id = ?`,
        [Number(session.id)],
      );
      await conn.query(
        `DELETE FROM prospect_research_opportunity_hypotheses WHERE session_id = ?`,
        [Number(session.id)],
      );
      await insertSessionFindings(conn, Number(session.id), result.findings);
      await insertSessionContacts(conn, Number(session.id), result.contacts);
      await insertSessionHypotheses(
        conn,
        Number(session.id),
        result.hypotheses,
      );
      await conn.query(
        `UPDATE prospect_research_sessions
         SET status = 'completed', result_json = ?, error_message = NULL,
             updated_at = NOW(3), finished_at = NOW(3)
         WHERE id = ?`,
        [JSON.stringify(result), Number(session.id)],
      );
    });
    return getProspectResearchSession({ user, sessionId });
  } catch (error) {
    await query(
      `UPDATE prospect_research_sessions
       SET status = 'failed', error_message = ?, updated_at = NOW(3), finished_at = NOW(3)
       WHERE id = ?`,
      [
        clip(error?.message || "No fue posible preparar la prospeccion", 1000),
        Number(sessionRow.id),
      ],
    ).catch(() => undefined);
    return getProspectResearchSession({ user, sessionId });
  }
}

export async function createProspectExternalResearchRun({ user, sessionId }) {
  await ensureProspectResearchSchema();
  await assertExternalResearchGovernance(user);
  const sessionRow = await getOwnedSession(sessionId, user.id);
  if (!sessionRow) return null;

  const activeRuns = await query(
    `SELECT * FROM prospect_research_runs
     WHERE session_id = ? AND requested_by_user_id = ?
       AND status IN ('pending', 'running')
     ORDER BY started_at DESC, id DESC LIMIT 1`,
    [Number(sessionId), Number(user.id)],
  );
  if (activeRuns.length) {
    const activeRun = activeRuns[0];
    if (
      activeRun.status === "running" &&
      !activeExternalResearchRunIds.has(Number(activeRun.id))
    ) {
      await query(
        `UPDATE prospect_research_runs SET status = 'pending'
         WHERE id = ? AND status = 'running'`,
        [Number(activeRun.id)],
      );
      activeRun.status = "pending";
    }
    return {
      ...mapProspectResearchRunRow(activeRun),
      pollAfterMs: 700,
    };
  }

  const session = mapSessionRow(sessionRow);
  const [previousFindings, previousContacts, previousHypotheses] =
    await Promise.all([
      query(
        `SELECT title, MAX(updated_at) AS latest_updated_at
         FROM prospect_research_findings
         WHERE session_id = ? AND source_type IN ('tavily', 'public_web')
           AND source_reference IS NOT NULL
         GROUP BY title
         ORDER BY latest_updated_at DESC, title LIMIT 5`,
        [Number(session.id)],
      ),
      query(
        `SELECT name, role_title, MAX(updated_at) AS latest_updated_at
         FROM prospect_research_contacts
         WHERE session_id = ? AND source_type = 'public_source'
         GROUP BY name, role_title
         ORDER BY latest_updated_at DESC, name LIMIT 5`,
        [Number(session.id)],
      ),
      query(
        `SELECT title, MAX(updated_at) AS latest_updated_at
         FROM prospect_research_opportunity_hypotheses
         WHERE session_id = ? AND JSON_EXTRACT(metadata_json, '$.externalResearch') = true
         GROUP BY title
         ORDER BY latest_updated_at DESC, title LIMIT 5`,
        [Number(session.id)],
      ),
    ]);
  const previousTopics = [
    ...previousFindings.map((finding) => finding.title),
    ...previousContacts.map(
      (contact) => `${contact.name} ${contact.role_title}`,
    ),
    ...previousHypotheses.map((hypothesis) => hypothesis.title),
  ].slice(0, 8);
  const queryText = buildProspectExternalQuery(session, previousTopics);
  const runPublicId = `prr_${randomUUID()}`;
  const runInsert = await query(
    `INSERT INTO prospect_research_runs
      (public_id, session_id, requested_by_user_id, status, query_text,
       provider, started_at)
     VALUES (?, ?, ?, 'pending', ?, 'tavily', NOW(3))`,
    [runPublicId, Number(session.id), Number(user.id), queryText],
  );
  return {
    id: Number(runInsert.insertId),
    publicId: runPublicId,
    sessionId: Number(session.id),
    status: "pending",
    query: queryText,
    provider: "tavily",
    findingCount: 0,
    contactCount: 0,
    hypothesisCount: 0,
    warnings: [],
    pollAfterMs: 700,
  };
}

export async function getProspectExternalResearchRun({
  user,
  sessionId,
  runId,
}) {
  await ensureProspectResearchSchema();
  const rows = await query(
    `SELECT r.*,
            COUNT(rf.finding_id) AS finding_count,
          (SELECT COUNT(*) FROM prospect_research_run_contacts rc WHERE rc.run_id = r.id) AS contact_count,
          (SELECT COUNT(*) FROM prospect_research_run_hypotheses rh WHERE rh.run_id = r.id) AS hypothesis_count,
            SUM(CASE WHEN rf.observation_status = 'new' THEN 1 ELSE 0 END) AS new_finding_count,
            SUM(CASE WHEN rf.observation_status = 'updated' THEN 1 ELSE 0 END) AS updated_finding_count,
            SUM(CASE WHEN rf.observation_status = 'unchanged' THEN 1 ELSE 0 END) AS unchanged_finding_count
     FROM prospect_research_runs r
     LEFT JOIN prospect_research_run_findings rf ON rf.run_id = r.id
     WHERE r.id = ? AND r.session_id = ? AND r.requested_by_user_id = ?
     GROUP BY r.id LIMIT 1`,
    [Number(runId), Number(sessionId), Number(user.id)],
  );
  const run = mapProspectResearchRunRow(rows[0]);
  if (!run) return null;
  if (["completed", "failed"].includes(run.status)) {
    run.session = await getProspectResearchSession({ user, sessionId });
  }
  return run;
}

export async function runProspectExternalResearchSession({
  user,
  sessionId,
  researchRunner = runProspectExternalResearch,
  runId: requestedRunId = null,
}) {
  await ensureProspectResearchSchema();
  let sessionRow;
  let queryText;
  let runId;

  if (requestedRunId) {
    const runRows = await query(
      `SELECT * FROM prospect_research_runs
       WHERE id = ? AND session_id = ? AND requested_by_user_id = ? LIMIT 1`,
      [Number(requestedRunId), Number(sessionId), Number(user.id)],
    );
    const run = runRows[0];
    if (!run) return null;
    const claim = await query(
      `UPDATE prospect_research_runs
       SET status = 'running'
       WHERE id = ? AND status = 'pending'`,
      [Number(run.id)],
    );
    if (!claim.affectedRows) {
      return getProspectResearchSession({ user, sessionId });
    }
    sessionRow = await getOwnedSession(sessionId, user.id);
    queryText = run.query_text;
    runId = Number(run.id);
  } else {
    await assertExternalResearchGovernance(user);
    sessionRow = await getOwnedSession(sessionId, user.id);
    if (!sessionRow) return null;
    const session = mapSessionRow(sessionRow);
    const previousFindings = await query(
      `SELECT title, MAX(updated_at) AS latest_updated_at
       FROM prospect_research_findings
       WHERE session_id = ? AND source_type IN ('tavily', 'public_web')
         AND source_reference IS NOT NULL
       GROUP BY title
       ORDER BY latest_updated_at DESC, title LIMIT 5`,
      [Number(session.id)],
    );
    queryText = buildProspectExternalQuery(session, previousFindings);
    const runInsert = await query(
      `INSERT INTO prospect_research_runs
        (public_id, session_id, requested_by_user_id, status, query_text,
         provider, started_at)
       VALUES (?, ?, ?, 'running', ?, 'tavily', NOW(3))`,
      [`prr_${randomUUID()}`, Number(session.id), Number(user.id), queryText],
    );
    runId = Number(runInsert.insertId);
  }
  if (!sessionRow) return null;
  const session = mapSessionRow(sessionRow);
  activeExternalResearchRunIds.add(runId);

  try {
    const externalResult = await researchRunner({
      session,
      user,
      queryText,
    });
    externalResult.findings = Array.isArray(externalResult.findings)
      ? externalResult.findings
      : [];
    externalResult.contacts = Array.isArray(externalResult.contacts)
      ? externalResult.contacts
      : [];
    externalResult.hypotheses = Array.isArray(externalResult.hypotheses)
      ? externalResult.hypotheses
      : [];
    externalResult.targetRoles = Array.isArray(externalResult.targetRoles)
      ? externalResult.targetRoles
      : [];
    const evidencePolicy = applyExternalEvidencePolicy(
      externalResult.findings,
      true,
    );
    externalResult.findings = deduplicateExternalFindings(
      evidencePolicy.findings,
    );
    externalResult.contacts = deduplicateExternalContacts(
      externalResult.contacts.filter(
        (contact) =>
          keepFindingsWithKnownSources(
            [{ sourceReference: contact.sourceReference }],
            externalResult.sourceUrls ||
              externalResult.findings.map((item) => item.sourceReference),
          ).length,
      ),
    );
    externalResult.hypotheses = deduplicateExternalHypotheses(
      externalResult.hypotheses.filter(
        (hypothesis) =>
          keepFindingsWithKnownSources(
            [
              {
                sourceReference: hypothesis.metadata?.sourceReference,
              },
            ],
            externalResult.sourceUrls ||
              externalResult.findings.map((item) => item.sourceReference),
          ).length,
      ),
    );
    if (evidencePolicy.omittedCount) {
      externalResult.warnings = [
        ...(externalResult.warnings || []),
        `${evidencePolicy.omittedCount} hallazgo(s) público(s) se omitieron por falta de URL o evidencia verificable.`,
      ];
    }
    if (
      externalResult.enabled &&
      !externalResult.findings.length &&
      !externalResult.contacts.length &&
      !externalResult.hypotheses.length
    ) {
      externalResult.warnings = [
        ...(externalResult.warnings || []),
        "Se consultaron fuentes públicas, pero no se encontró información con evidencia suficiente para incluirla en la ficha.",
      ];
    }

    const currentResult = parseJson(sessionRow.result_json, {}) || {};
    const runSummary = {
      new: 0,
      updated: 0,
      unchanged: 0,
      contacts: { new: 0, updated: 0, unchanged: 0 },
      hypotheses: { new: 0, updated: 0, unchanged: 0 },
    };

    await withTransaction(async (conn) => {
      await conn.query(
        `SELECT id FROM prospect_research_sessions WHERE id = ? FOR UPDATE`,
        [Number(session.id)],
      );
      const [existingRows] = await conn.query(
        `SELECT * FROM prospect_research_findings
         WHERE session_id = ? AND source_type IN ('tavily', 'public_web')
           AND source_reference IS NOT NULL
         ORDER BY id DESC FOR UPDATE`,
        [Number(session.id)],
      );
      const existingBySource = new Map();
      for (const row of existingRows) {
        const canonicalUrl = canonicalizeExternalSourceUrl(
          row.source_reference,
        );
        if (canonicalUrl && !existingBySource.has(canonicalUrl)) {
          existingBySource.set(canonicalUrl, row);
        }
      }

      for (const finding of externalResult.findings) {
        const canonicalUrl = canonicalizeExternalSourceUrl(
          finding.sourceReference,
        );
        const existing = existingBySource.get(canonicalUrl);
        let findingId;
        let observationStatus;
        const observation = classifyExternalFindingObservation(
          existing,
          finding,
        );

        if (observation === "new") {
          const [inserted] = await insertSessionFindings(
            conn,
            Number(session.id),
            [finding],
          );
          findingId = inserted.id;
          observationStatus = "new";
          runSummary.new += 1;
          existingBySource.set(canonicalUrl, {
            id: findingId,
            ...finding,
            source_reference: finding.sourceReference,
            evidence_text: finding.evidenceText,
          });
        } else if (observation === "unchanged") {
          findingId = Number(existing.id);
          observationStatus = "unchanged";
          runSummary.unchanged += 1;
        } else if (observation === "updated") {
          if (existing.status === "suggested") {
            await conn.query(
              `UPDATE prospect_research_findings
               SET status = 'outdated', updated_at = NOW(3)
               WHERE id = ?`,
              [Number(existing.id)],
            );
          }
          const [inserted] = await insertSessionFindings(
            conn,
            Number(session.id),
            [finding],
          );
          findingId = inserted.id;
          observationStatus = "updated";
          runSummary.updated += 1;
          existingBySource.set(canonicalUrl, {
            id: findingId,
            ...finding,
            source_reference: finding.sourceReference,
            evidence_text: finding.evidenceText,
          });
        } else {
          const [inserted] = await insertSessionFindings(
            conn,
            Number(session.id),
            [finding],
          );
          findingId = inserted.id;
          observationStatus = "updated";
          runSummary.updated += 1;
          existingBySource.set(canonicalUrl, {
            id: findingId,
            ...finding,
            source_reference: finding.sourceReference,
            evidence_text: finding.evidenceText,
          });
        }

        await conn.query(
          `INSERT INTO prospect_research_run_findings
            (run_id, finding_id, observation_status, created_at)
           VALUES (?, ?, ?, NOW(3))`,
          [runId, findingId, observationStatus],
        );
      }

      const [existingContactRows] = await conn.query(
        `SELECT * FROM prospect_research_contacts
         WHERE session_id = ? ORDER BY id DESC FOR UPDATE`,
        [Number(session.id)],
      );
      const existingContactsByKey = new Map();
      for (const row of existingContactRows) {
        const key = `${String(row.name || "")
          .trim()
          .toLocaleLowerCase(
            "es",
          )}|${canonicalizeExternalSourceUrl(row.source_reference)}`;
        if (!existingContactsByKey.has(key)) {
          existingContactsByKey.set(key, row);
        }
      }
      for (const contact of externalResult.contacts) {
        const sourceUrl = canonicalizeExternalSourceUrl(
          contact.sourceReference,
        );
        const key = `${String(contact.name || "")
          .trim()
          .toLocaleLowerCase("es")}|${sourceUrl}`;
        const existing = existingContactsByKey.get(key);
        const existingMetadata = parseJson(existing?.metadata_json, {});
        const sameContent = Boolean(
          existing &&
          String(existing.role_title || "")
            .trim()
            .toLowerCase() ===
            String(contact.roleTitle || "")
              .trim()
              .toLowerCase() &&
          String(existing.area || "")
            .trim()
            .toLowerCase() ===
            String(contact.area || "")
              .trim()
              .toLowerCase() &&
          String(existingMetadata.evidenceText || "")
            .trim()
            .toLowerCase() ===
            String(contact.metadata?.evidenceText || "")
              .trim()
              .toLowerCase(),
        );
        let contactId;
        let observationStatus;
        if (sameContent) {
          contactId = Number(existing.id);
          observationStatus = "unchanged";
          runSummary.contacts.unchanged += 1;
        } else {
          const [inserted] = await insertSessionContacts(
            conn,
            Number(session.id),
            [contact],
          );
          contactId = inserted.id;
          observationStatus = existing ? "updated" : "new";
          runSummary.contacts[observationStatus] += 1;
          existingContactsByKey.set(key, {
            id: contactId,
            name: contact.name,
            role_title: contact.roleTitle,
            area: contact.area,
            source_reference: contact.sourceReference,
            metadata_json: JSON.stringify(contact.metadata || {}),
            status: "suggested",
          });
        }
        await conn.query(
          `INSERT INTO prospect_research_run_contacts
            (run_id, contact_id, observation_status, created_at)
           VALUES (?, ?, ?, NOW(3))`,
          [runId, contactId, observationStatus],
        );
      }

      const [existingHypothesisRows] = await conn.query(
        `SELECT * FROM prospect_research_opportunity_hypotheses
         WHERE session_id = ? ORDER BY id DESC FOR UPDATE`,
        [Number(session.id)],
      );
      const existingHypothesesByKey = new Map();
      for (const row of existingHypothesisRows) {
        const metadata = parseJson(row.metadata_json, {});
        const key = `${String(row.title || "")
          .trim()
          .toLowerCase()}|${canonicalizeExternalSourceUrl(metadata.sourceReference)}`;
        if (!existingHypothesesByKey.has(key)) {
          existingHypothesesByKey.set(key, { ...row, metadata });
        }
      }
      for (const hypothesis of externalResult.hypotheses) {
        const sourceUrl = canonicalizeExternalSourceUrl(
          hypothesis.metadata?.sourceReference,
        );
        const key = `${String(hypothesis.title || "")
          .trim()
          .toLowerCase()}|${sourceUrl}`;
        const existing = existingHypothesesByKey.get(key);
        const sameContent = Boolean(
          existing &&
          String(existing.business_challenge || "")
            .trim()
            .toLowerCase() ===
            String(hypothesis.businessChallenge || "")
              .trim()
              .toLowerCase() &&
          String(existing.technology_area || "")
            .trim()
            .toLowerCase() ===
            String(hypothesis.technologyArea || "")
              .trim()
              .toLowerCase() &&
          String(existing.metadata.evidenceText || "")
            .trim()
            .toLowerCase() ===
            String(hypothesis.metadata?.evidenceText || "")
              .trim()
              .toLowerCase(),
        );
        let hypothesisId;
        let observationStatus;
        if (sameContent) {
          hypothesisId = Number(existing.id);
          observationStatus = "unchanged";
          runSummary.hypotheses.unchanged += 1;
        } else {
          const [inserted] = await insertSessionHypotheses(
            conn,
            Number(session.id),
            [hypothesis],
          );
          hypothesisId = inserted.id;
          observationStatus = existing ? "updated" : "new";
          runSummary.hypotheses[observationStatus] += 1;
          existingHypothesesByKey.set(key, {
            id: hypothesisId,
            title: hypothesis.title,
            business_challenge: hypothesis.businessChallenge,
            technology_area: hypothesis.technologyArea,
            metadata: hypothesis.metadata || {},
            status: "suggested",
          });
        }
        await conn.query(
          `INSERT INTO prospect_research_run_hypotheses
            (run_id, hypothesis_id, observation_status, created_at)
           VALUES (?, ?, ?, NOW(3))`,
          [runId, hypothesisId, observationStatus],
        );
      }

      const warnings = externalResult.warnings || [];
      const findingCount = externalResult.findings.length;
      const researchedAt = new Date().toISOString();
      const trackResults = (externalResult.trackResults || []).map((track) => ({
        ...track,
        findings: externalResult.findings.filter((finding) =>
          (finding.metadata?.researchTracks || []).includes(track.key),
        ).length,
        contacts: externalResult.contacts.filter((contact) =>
          (contact.metadata?.researchTracks || []).includes(track.key),
        ).length,
        hypotheses: externalResult.hypotheses.filter((hypothesis) =>
          (hypothesis.metadata?.researchTracks || []).includes(track.key),
        ).length,
        targetRoleCount: externalResult.targetRoles.filter((role) =>
          (role.researchTracks || []).includes(track.key),
        ).length,
        targetRoles: externalResult.targetRoles.filter((role) =>
          (role.researchTracks || []).includes(track.key),
        ).length,
      }));
      const nextResult = {
        ...currentResult,
        headline:
          currentResult.headline ||
          `Investigación pública para ${session.companyName}`,
        profile: {
          ...(currentResult.profile || {}),
          companyName: session.companyName,
          country: session.country,
          website: session.website || "",
          industry: session.industry || "",
        },
        externalResearch: {
          enabled: externalResult.enabled,
          provider: externalResult.provider || "tavily",
          warnings,
          findingCount,
          newFindingCount: runSummary.new,
          updatedFindingCount: runSummary.updated,
          unchangedFindingCount: runSummary.unchanged,
          contactCount: externalResult.contacts.length,
          newContactCount: runSummary.contacts.new,
          updatedContactCount: runSummary.contacts.updated,
          unchangedContactCount: runSummary.contacts.unchanged,
          hypothesisCount: externalResult.hypotheses.length,
          newHypothesisCount: runSummary.hypotheses.new,
          updatedHypothesisCount: runSummary.hypotheses.updated,
          unchangedHypothesisCount: runSummary.hypotheses.unchanged,
          trackResults,
          targetRoles: externalResult.targetRoles,
          sellerBrief: externalResult.sellerBrief || null,
          researchedAt,
          runId,
        },
      };

      await conn.query(
        `UPDATE prospect_research_runs
         SET status = 'completed', finding_count = ?, contact_count = ?,
             hypothesis_count = ?, warnings_json = ?, track_results_json = ?,
             finished_at = NOW(3)
         WHERE id = ?`,
        [
          findingCount,
          externalResult.contacts.length,
          externalResult.hypotheses.length,
          JSON.stringify(warnings),
          JSON.stringify(trackResults),
          runId,
        ],
      );
      await conn.query(
        `UPDATE prospect_research_sessions
         SET status = 'completed', result_json = ?, error_message = NULL,
             external_researched_at = NOW(3), updated_at = NOW(3),
             finished_at = NOW(3)
         WHERE id = ? AND requested_by_user_id = ?`,
        [JSON.stringify(nextResult), Number(session.id), Number(user.id)],
      );
    });
  } catch (error) {
    await query(
      `UPDATE prospect_research_runs
       SET status = 'failed', warnings_json = ?, finished_at = NOW(3)
       WHERE id = ?`,
      [
        JSON.stringify([
          clip(error?.message || "No fue posible investigar", 1000),
        ]),
        runId,
      ],
    ).catch(() => undefined);
    throw error;
  } finally {
    activeExternalResearchRunIds.delete(runId);
  }

  return getProspectResearchSession({ user, sessionId });
}

export async function updateProspectResearchFindingStatus({
  user,
  findingId,
  status,
}) {
  await ensureProspectResearchSchema();
  const allowedStatuses = new Set([
    "suggested",
    "confirmed",
    "rejected",
    "outdated",
  ]);
  if (!allowedStatuses.has(status)) {
    throw createHttpError(400, "Estado de hallazgo invalido");
  }

  const rows = await query(
    `SELECT f.*
     FROM prospect_research_findings f
     INNER JOIN prospect_research_sessions s ON s.id = f.session_id
     WHERE f.id = ? AND s.requested_by_user_id = ?
     LIMIT 1`,
    [Number(findingId), Number(user.id)],
  );
  const finding = rows[0];
  if (!finding) return null;

  await query(
    `UPDATE prospect_research_findings
     SET status = ?, validated_by_user_id = ?, validated_at = NOW(3), updated_at = NOW(3)
     WHERE id = ?`,
    [status, Number(user.id), Number(findingId)],
  );

  const updatedRows = await query(
    `SELECT * FROM prospect_research_findings WHERE id = ? LIMIT 1`,
    [Number(findingId)],
  );
  return mapFindingRow(updatedRows[0]);
}

export async function updateProspectResearchHypothesisStatus({
  user,
  hypothesisId,
  status,
}) {
  await ensureProspectResearchSchema();
  if (!["confirmed", "rejected"].includes(status)) {
    throw createHttpError(400, "Estado de hipotesis invalido");
  }
  const rows = await query(
    `SELECT h.*
     FROM prospect_research_opportunity_hypotheses h
     INNER JOIN prospect_research_sessions s ON s.id = h.session_id
     WHERE h.id = ? AND s.requested_by_user_id = ?
     LIMIT 1`,
    [Number(hypothesisId), Number(user.id)],
  );
  if (!rows[0]) return null;
  await query(
    `UPDATE prospect_research_opportunity_hypotheses
     SET status = ?, updated_at = NOW(3) WHERE id = ?`,
    [status, Number(hypothesisId)],
  );
  const updatedRows = await query(
    `SELECT * FROM prospect_research_opportunity_hypotheses WHERE id = ? LIMIT 1`,
    [Number(hypothesisId)],
  );
  return mapHypothesisRow(updatedRows[0]);
}

export async function convertProspectSessionToAccount({
  user,
  sessionId,
}) {
  await ensureProspectResearchSchema();
  if (!(await getMiCoachGovernanceSettings()).allowProspectConversion) {
    throw createHttpError(
      403,
      "Las conversiones de prospeccion estan deshabilitadas por gobierno de Mi Coach",
      { requiredPermission: "mi_coach.admin" },
    );
  }
  if (!hasAnyPermission(user, ["cuentas.create", "cuentas.request"])) {
    throw createHttpError(403, "No autorizado", {
      requiredPermission: "cuentas.create",
    });
  }
  const sessionRow = await getOwnedSession(sessionId, user.id);
  if (!sessionRow) return null;
  if (sessionRow.converted_account_id) {
    return { accountId: Number(sessionRow.converted_account_id), reused: true };
  }

  const prospectSession = mapSessionRow(sessionRow);
  const duplicateReview = await findProspectAccountDuplicates({
    user,
    session: prospectSession,
  });
  if (!duplicateReview.completed) {
    throw createHttpError(
      403,
      "Se requiere cuentas.read para revisar posibles duplicados antes de convertir",
      { requiredPermission: "cuentas.read" },
    );
  }
  if (duplicateReview.candidates.length) {
    throw createHttpError(
      409,
      "No se puede crear una cuenta desde esta prospección porque se encontraron posibles duplicados",
      {
        duplicateCandidates: duplicateReview.candidates,
        duplicateReview,
      },
    );
  }
  const countryId = await resolveCountryId(sessionRow.country);
  if (!countryId) {
    throw createHttpError(
      400,
      "No se pudo reconocer el país. Corrige el país antes de convertir a cuenta.",
    );
  }
  if (!hasAnyPermission(user, ["cuentas.create", "cuentas.request"])) {
    throw createHttpError(403, "No autorizado para crear cuentas", {
      requiredPermission: "cuentas.create",
    });
  }

  const now = new Date();
  const activationStatusCode = hasPermission(user, "cuentas.create")
    ? "activada"
    : "pendiente_activacion";
  const [accountTypeId, economicSectorId, activationStatusId] =
    await Promise.all([
      getCatalogId("account_types", "cliente"),
      getCatalogId("economic_sectors", "otro"),
      getCatalogId("account_activation_statuses", activationStatusCode),
    ]);

  const accountId = await withTransaction(async (conn) => {
    const [insertResult] = await conn.query(
      `INSERT INTO accounts
        (name, account_type_id, registration_code, phone, economic_sector_id,
         website, city, state_region, country_id, description, client_logo_url,
         address_line, postal_code, activation_status_id, created_by, created_at,
         updated_by, updated_at)
       VALUES (?, ?, NULL, NULL, ?, ?, NULL, NULL, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?)`,
      [
        sessionRow.company_name,
        accountTypeId,
        economicSectorId,
        sessionRow.website || null,
        countryId,
        `Cuenta creada desde prospeccion asistida. Industria: ${sessionRow.industry || "sin especificar"}.`,
        activationStatusId,
        Number(user.id),
        now,
        Number(user.id),
        now,
      ],
    );
    await conn.query(
      `INSERT INTO account_owners (account_id, user_id, assigned_at, assigned_by)
       VALUES (?, ?, ?, ?)`,
      [Number(insertResult.insertId), Number(user.id), now, Number(user.id)],
    );
    await conn.query(
      `UPDATE prospect_research_sessions SET converted_account_id = ?, updated_at = ? WHERE id = ?`,
      [Number(insertResult.insertId), now, Number(sessionRow.id)],
    );
    return Number(insertResult.insertId);
  });

  return { accountId, reused: false };
}

export async function convertProspectContact({
  user,
  contactId,
  accountId,
  contactName = "",
  email = "",
}) {
  await ensureProspectResearchSchema();
  if (!(await getMiCoachGovernanceSettings()).allowProspectConversion) {
    throw createHttpError(
      403,
      "Las conversiones de prospeccion estan deshabilitadas por gobierno de Mi Coach",
      { requiredPermission: "mi_coach.admin" },
    );
  }
  if (!hasAnyPermission(user, ["contactos.create", "contactos.request"])) {
    throw createHttpError(403, "No autorizado", {
      requiredPermission: "contactos.create",
    });
  }
  const rows = await query(
    `SELECT c.*, s.converted_account_id, s.requested_by_user_id
     FROM prospect_research_contacts c
     INNER JOIN prospect_research_sessions s ON s.id = c.session_id
     WHERE c.id = ? AND s.requested_by_user_id = ? LIMIT 1`,
    [Number(contactId), Number(user.id)],
  );
  const prospectContact = rows[0];
  if (!prospectContact) return null;
  const targetAccountId = Number(
    accountId || prospectContact.converted_account_id || 0,
  );
  if (!targetAccountId)
    throw createHttpError(400, "Primero convierte o indica una cuenta");
  await assertProspectAccountAccessible({ user, accountId: targetAccountId });
  const parsedName = splitContactName(contactName || prospectContact.name);
  if (!parsedName)
    throw createHttpError(400, "Captura nombre del contacto para convertirlo");
  const normalizedEmail = String(email || prospectContact.email || "")
    .trim()
    .toLowerCase();
  if (normalizedEmail) {
    const duplicateContactRows = await query(
      `SELECT id FROM contacts
       WHERE account_id = ? AND LOWER(TRIM(email)) = ?
       LIMIT 1`,
      [targetAccountId, normalizedEmail],
    );
    if (duplicateContactRows.length) {
      throw createHttpError(
        409,
        "Ya existe un contacto con ese email en la cuenta seleccionada; revisa el contacto en el modulo oficial antes de continuar.",
      );
    }
  }

  const creationStatusCode = hasPermission(user, "contactos.create")
    ? "activado"
    : "pendiente_activacion";
  const [
    purchaseParticipationId,
    hierarchyLevelId,
    relationshipTypeId,
    influenceLevelId,
    employmentStatusId,
    activationStatusId,
  ] = await Promise.all([
    getCatalogId("contact_purchase_participations", "ninguno"),
    getCatalogId("contact_hierarchy_levels", "usuario"),
    getCatalogId("contact_relationship_types", "ninguno"),
    getCatalogId("contact_influence_levels", "media"),
    getCatalogId("contact_employment_statuses", "labora"),
    getCatalogId("contact_activation_statuses", creationStatusCode),
  ]);
  const now = new Date();
  const result = await query(
    `INSERT INTO contacts
      (first_name, last_name, account_id, position_title, phone, phone_extension,
       mobile, email, department, country_id, state_region, city, address_line,
       postal_code, purchase_participation_id, hierarchy_level_id,
       relationship_type_id, influence_level_id, employment_status_id,
       activation_status_id, manager_contact_id, influences_contact_id,
       created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    [
      parsedName.firstName,
      parsedName.lastName,
      targetAccountId,
      prospectContact.role_title,
      normalizedEmail || null,
      prospectContact.area,
      purchaseParticipationId,
      hierarchyLevelId,
      relationshipTypeId,
      influenceLevelId,
      employmentStatusId,
      activationStatusId,
      Number(user.id),
      now,
      Number(user.id),
      now,
    ],
  );
  await query(
    `UPDATE prospect_research_contacts SET status = 'confirmed', updated_at = NOW(3) WHERE id = ?`,
    [Number(contactId)],
  );
  return { contactId: Number(result.insertId), accountId: targetAccountId };
}

export async function convertProspectSessionToLead({
  user,
  sessionId,
  accountId,
}) {
  await ensureProspectResearchSchema();
  if (!(await getMiCoachGovernanceSettings()).allowProspectConversion) {
    throw createHttpError(
      403,
      "Las conversiones de prospeccion estan deshabilitadas por gobierno de Mi Coach",
      { requiredPermission: "mi_coach.admin" },
    );
  }
  await ensureInteractionSchema();
  if (!hasPermission(user, "interacciones.create")) {
    throw createHttpError(403, "No autorizado", {
      requiredPermission: "interacciones.create",
    });
  }
  const sessionRow = await getOwnedSession(sessionId, user.id);
  if (!sessionRow) return null;
  const targetAccountId =
    Number(accountId || sessionRow.converted_account_id || 0) || null;
  if (targetAccountId) {
    await assertProspectAccountAccessible({ user, accountId: targetAccountId });
  }
  const publicId = `int_${randomUUID().replace(/-/g, "")}`;
  const now = new Date();
  const title = `Prospeccion ${sessionRow.company_name}`;
  const summary = `Lead creado desde prospeccion asistida para ${sessionRow.company_name}.`;
  const result = await query(
    `INSERT INTO interactions
      (public_id, title, lead_source, source_notes, summary, analysis_status,
       processing_status, warnings_json, topics_json, actions_taken_json,
       next_steps_json, suggested_account_json, suggested_contacts_json,
       suggested_opportunities_json, account_id, seller_user_id, created_by,
       updated_by, created_at, updated_at, analyzed_at)
     VALUES (?, ?, 'vendedor', ?, ?, 'lead_assigned', 'completed', NULL, NULL,
       NULL, NULL, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    [
      publicId,
      title,
      `Pais: ${sessionRow.country}. Industria: ${sessionRow.industry || "sin especificar"}.`,
      summary,
      JSON.stringify({
        name: sessionRow.company_name,
        website: sessionRow.website || null,
      }),
      targetAccountId,
      Number(user.id),
      Number(user.id),
      Number(user.id),
      now,
      now,
      now,
    ],
  );
  return {
    interactionId: Number(result.insertId),
    publicId,
    accountId: targetAccountId,
  };
}

export async function convertProspectHypothesisToOpportunity({
  user,
  hypothesisId,
  accountId,
  contactId,
  amountUsd = 0,
  closeDate = "",
}) {
  await ensureProspectResearchSchema();
  if (!(await getMiCoachGovernanceSettings()).allowProspectConversion) {
    throw createHttpError(
      403,
      "Las conversiones de prospeccion estan deshabilitadas por gobierno de Mi Coach",
      { requiredPermission: "mi_coach.admin" },
    );
  }
  if (
    !hasAnyPermission(user, ["oportunidades.create", "oportunidades.request"])
  ) {
    throw createHttpError(403, "No autorizado", {
      requiredPermission: "oportunidades.create",
    });
  }
  const rows = await query(
    `SELECT h.*, s.converted_account_id, s.requested_by_user_id
     FROM prospect_research_opportunity_hypotheses h
     INNER JOIN prospect_research_sessions s ON s.id = h.session_id
     WHERE h.id = ? AND s.requested_by_user_id = ? LIMIT 1`,
    [Number(hypothesisId), Number(user.id)],
  );
  const hypothesis = rows[0];
  if (!hypothesis) return null;
  if (hypothesis.status !== "confirmed") {
    throw createHttpError(
      409,
      "Confirma la hipotesis con el vendedor antes de crear una oportunidad",
    );
  }
  const targetAccountId = Number(
    accountId || hypothesis.converted_account_id || 0,
  );
  const targetContactId = Number(contactId || 0);
  if (!targetAccountId || !targetContactId)
    throw createHttpError(
      400,
      "Cuenta y contacto son obligatorios para crear oportunidad",
    );
  await assertProspectAccountAccessible({ user, accountId: targetAccountId });
  const contactRows = await query(
    `SELECT id FROM contacts WHERE id = ? AND account_id = ? LIMIT 1`,
    [targetContactId, targetAccountId],
  );
  if (!contactRows.length) {
    throw createHttpError(
      400,
      "El contacto seleccionado no pertenece a la cuenta indicada",
    );
  }
  const activationStatusCode = hasPermission(user, "oportunidades.create")
    ? "activada"
    : "pendiente_activacion";
  const [salesStageId, businessLineId, activationStatusId, commercialStatusId] =
    await Promise.all([
      getCatalogId("opportunity_sales_stages", "contacto_inicial"),
      getCatalogId("opportunity_business_lines", "otro"),
      getCatalogId("opportunity_activation_statuses", activationStatusCode),
      getCatalogId("opportunity_commercial_statuses", "en_proceso"),
    ]);
  const normalizedCloseDate = /^\d{4}-\d{2}-\d{2}$/.test(
    String(closeDate || ""),
  )
    ? String(closeDate)
    : new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const now = new Date();
  const result = await query(
    `INSERT INTO opportunities
      (name, amount_usd, account_id, close_date, contact_id, sales_stage_id,
       business_line_id, seller_user_id, presales_user_id, activation_status_id,
       commercial_status_id, created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    [
      hypothesis.title,
      Number(amountUsd || 0),
      targetAccountId,
      normalizedCloseDate,
      targetContactId,
      salesStageId,
      businessLineId,
      Number(user.id),
      activationStatusId,
      commercialStatusId,
      Number(user.id),
      now,
      Number(user.id),
      now,
    ],
  );
  await query(
    `UPDATE prospect_research_opportunity_hypotheses SET status = 'confirmed', updated_at = NOW(3) WHERE id = ?`,
    [Number(hypothesisId)],
  );
  return {
    opportunityId: Number(result.insertId),
    accountId: targetAccountId,
    contactId: targetContactId,
  };
}
