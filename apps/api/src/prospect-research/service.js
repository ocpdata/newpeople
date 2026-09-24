import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db.js";
import { ensureInteractionSchema } from "../interactions/schema.js";
import { runStructuredTextResearch } from "../structuredWebResearch.js";
import { searchTavily } from "../tavily.js";
import { assertExternalResearchGovernance, getMiCoachGovernanceSettings } from "../commercial-intelligence/service.js";
import { ensureProspectResearchSchema } from "./schema.js";

function clip(value, max = 1200) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
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
  if (!fallback.length) throw createHttpError(500, `Catalogo sin datos: ${tableName}`);
  return Number(fallback[0].id);
}

async function resolveCountryId(country) {
  const text = String(country || "").trim();
  const rows = await query(
    `SELECT id FROM countries
     WHERE LOWER(name) = LOWER(?) OR LOWER(iso2) = LOWER(?) OR LOWER(iso3) = LOWER(?)
     ORDER BY id LIMIT 1`,
    [text, text, text],
  ).catch(() => []);
  if (rows.length) return Number(rows[0].id);
  return getCatalogId("countries", "MX", "1 = 1");
}

function splitContactName(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) return { firstName: parts[0], lastName: "Por confirmar" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) };
}

function mapSessionRow(row) {
  if (!row) return null;
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
    errorMessage: row.error_message || null,
    convertedAccountId: row.converted_account_id === null ? null : Number(row.converted_account_id),
    discardedAt: row.discarded_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at || null,
  };
}

function mapFindingRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    publicId: row.public_id,
    sessionId: Number(row.session_id),
    category: row.category,
    title: row.title,
    summary: row.summary || "",
    evidenceText: row.evidence_text || "",
    sourceType: row.source_type,
    sourceReference: row.source_reference || "",
    confidence: row.confidence,
    certainty: row.certainty,
    status: row.status,
    metadata: parseJson(row.metadata_json, {}),
    validatedByUserId: row.validated_by_user_id === null ? null : Number(row.validated_by_user_id),
    validatedAt: row.validated_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapContactRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    publicId: row.public_id,
    sessionId: Number(row.session_id),
    name: row.name || "",
    roleTitle: row.role_title,
    area: row.area,
    email: row.email || "",
    sourceType: row.source_type,
    sourceReference: row.source_reference || "",
    confidence: row.confidence,
    status: row.status,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapHypothesisRow(row) {
  if (!row) return null;
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
    confidence: row.confidence,
    status: row.status,
    metadata: parseJson(row.metadata_json, {}),
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
  if (text.includes("log") || text.includes("transporte")) return "operacion distribuida";
  if (text.includes("fin") || text.includes("banco")) return "continuidad y cumplimiento";
  if (text.includes("salud")) return "disponibilidad y proteccion de datos";
  if (text.includes("retail") || text.includes("comercio")) return "experiencia de cliente y omnicanalidad";
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
      evidenceText: "Inferencia basada unicamente en pais, industria y datos capturados en la sesion.",
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
      summary: "Antes de crear una oportunidad, falta identificar responsable tecnico, area usuaria y responsable economico.",
      evidenceText: "La sesion de prospeccion aun no tiene contactos confirmados.",
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
      technologyArea: "Continuidad operativa / infraestructura / servicios administrados",
      targetArea: "Tecnologia y Operaciones",
      suggestedContactRole: "Responsable de TI",
      validationQuestion: "¿Que sistemas o procesos no pueden detenerse sin impactar al negocio?",
      confidence: "medium",
      status: "suggested",
      metadata: { industrySignal },
    },
    {
      title: "Validar necesidades de seguridad y control",
      businessChallenge: "Identificar si existen preocupaciones de seguridad, cumplimiento, accesos o proteccion de informacion.",
      technologyArea: "Ciberseguridad",
      targetArea: "Tecnologia",
      suggestedContactRole: "Responsable de Seguridad o TI",
      validationQuestion: "¿Que riesgos tecnologicos o de seguridad estan priorizando actualmente?",
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

function normalizeExternalFinding(rawFinding, index = 0, sourceType = "public_web") {
  const sourceUrl = clip(rawFinding?.sourceUrl || rawFinding?.sourceReference || "", 500);
  const title = clip(rawFinding?.title || `Señal publica ${index + 1}`, 190);
  const summary = clip(rawFinding?.summary || rawFinding?.description || "", 4000);
  const evidenceText = clip(rawFinding?.evidenceText || rawFinding?.evidence || "", 4000);
  return {
    category: clip(rawFinding?.category || "business_challenge", 60),
    title,
    summary: summary || title,
    evidenceText: evidenceText || "Señal detectada en investigación externa; requiere validación comercial.",
    sourceType,
    sourceReference: sourceUrl || "fuente_publica_no_especificada",
    confidence: ["high", "medium", "low"].includes(rawFinding?.confidence)
      ? rawFinding.confidence
      : "medium",
    certainty: "evidenced",
    status: "suggested",
    metadata: { externalResearch: true },
  };
}

async function runProspectExternalResearch({ session, user }) {
  const tavily = await searchTavily({
    query: `${session.companyName} ${session.country} ${session.industry || "empresa"} proyectos tecnología noticias`,
  });
  if (!tavily.enabled || !tavily.results.length) {
    return {
      enabled: false,
      findings: [],
      warnings: tavily.warnings,
      provider: "tavily",
    };
  }
  const result = await runStructuredTextResearch({
    schemaName: "prospect_external_research",
    systemPrompt: [
      "Eres un agente de investigacion comercial B2B.",
      "Interpreta exclusivamente las fuentes públicas recuperadas por Tavily.",
      "No afirmes como hecho lo que sea inferencia; usa confidence y evidenceText.",
      "Devuelve hallazgos accionables para prospeccion comercial en español.",
    ].join("\n"),
    subject: session.companyName,
    context: {
      country: session.country,
      website: session.website || "",
      industry: session.industry || "",
      publicSources: tavily.results,
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
            { key: "title", type: "string", example: "Posible iniciativa cloud" },
            { key: "summary", type: "string", example: "Resumen de la señal" },
            { key: "evidenceText", type: "string", example: "Fragmento exacto" },
            { key: "sourceUrl", type: "string", example: "https://example.com" },
            { key: "confidence", type: "enum", enum: ["high", "medium", "low"], example: "medium" },
          ],
        },
      },
      {
        key: "warnings",
        type: "array",
        example: [],
        items: { type: "string", example: "No se encontraron fuentes suficientes" },
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
      warnings: ["OpenAI no esta disponible para interpretar los resultados de Tavily."],
      provider: "tavily",
    };
  }

  const findings = Array.isArray(result.findings)
    ? result.findings.map((finding, index) => normalizeExternalFinding(finding, index, "tavily")).filter((finding) => finding.title)
    : [];
  return {
    enabled: true,
    findings,
    warnings: [...tavily.warnings, ...(Array.isArray(result.warnings) ? result.warnings.filter(Boolean) : [])],
    provider: "tavily",
  };
}

async function getOwnedSession(sessionId, userId) {
  const rows = await query(
    `SELECT * FROM prospect_research_sessions
     WHERE id = ? AND requested_by_user_id = ? LIMIT 1`,
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
  const website = normalizeWebsite(payload.website);
  const industry = clip(payload.industry, 160);
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
  };
}

export async function getProspectResearchSession({ user, sessionId }) {
  await ensureProspectResearchSchema();
  const session = await getOwnedSession(sessionId, user.id);
  if (!session) return null;

  const [findings, contacts, hypotheses] = await Promise.all([
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
  ]);

  return {
    ...mapSessionRow(session),
    findings: findings.map(mapFindingRow),
    contacts: contacts.map(mapContactRow),
    hypotheses: hypotheses.map(mapHypothesisRow),
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
      await conn.query(`DELETE FROM prospect_research_findings WHERE session_id = ?`, [Number(session.id)]);
      await conn.query(`DELETE FROM prospect_research_contacts WHERE session_id = ?`, [Number(session.id)]);
      await conn.query(`DELETE FROM prospect_research_opportunity_hypotheses WHERE session_id = ?`, [Number(session.id)]);
      await insertSessionFindings(conn, Number(session.id), result.findings);
      await insertSessionContacts(conn, Number(session.id), result.contacts);
      await insertSessionHypotheses(conn, Number(session.id), result.hypotheses);
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
      [clip(error?.message || "No fue posible preparar la prospeccion", 1000), Number(sessionRow.id)],
    ).catch(() => undefined);
    return getProspectResearchSession({ user, sessionId });
  }
}

export async function runProspectExternalResearchSession({ user, sessionId }) {
  await ensureProspectResearchSchema();
  await assertExternalResearchGovernance(user);
  const sessionRow = await getOwnedSession(sessionId, user.id);
  if (!sessionRow) return null;
  const session = mapSessionRow(sessionRow);
  const externalResult = await runProspectExternalResearch({ session, user });

  let insertedFindings = [];
  if (externalResult.findings.length) {
    insertedFindings = await withTransaction(async (conn) =>
      insertSessionFindings(conn, Number(session.id), externalResult.findings),
    );
  }

  const currentResult = parseJson(sessionRow.result_json, {}) || {};
  const nextResult = {
    ...currentResult,
    externalResearch: {
      enabled: externalResult.enabled,
      provider: externalResult.provider || "tavily",
      warnings: externalResult.warnings,
      findingCount: insertedFindings.length,
      researchedAt: new Date().toISOString(),
    },
  };
  await query(
    `UPDATE prospect_research_sessions SET result_json = ?, updated_at = NOW(3) WHERE id = ?`,
    [JSON.stringify(nextResult), Number(session.id)],
  );

  return getProspectResearchSession({ user, sessionId });
}

export async function updateProspectResearchFindingStatus({ user, findingId, status }) {
  await ensureProspectResearchSchema();
  const allowedStatuses = new Set(["suggested", "confirmed", "rejected", "outdated"]);
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

export async function convertProspectSessionToAccount({ user, sessionId }) {
  await ensureProspectResearchSchema();
  if (!(await getMiCoachGovernanceSettings()).allowProspectConversion) {
    throw createHttpError(403, "Las conversiones de prospeccion estan deshabilitadas por gobierno de Mi Coach", { requiredPermission: "mi_coach.admin" });
  }
  if (!hasAnyPermission(user, ["cuentas.create", "cuentas.request"])) {
    throw createHttpError(403, "No autorizado", { requiredPermission: "cuentas.create" });
  }
  const sessionRow = await getOwnedSession(sessionId, user.id);
  if (!sessionRow) return null;
  if (sessionRow.converted_account_id) {
    return { accountId: Number(sessionRow.converted_account_id), reused: true };
  }

  const countryId = await resolveCountryId(sessionRow.country);
  const duplicateRows = await query(
    `SELECT id FROM accounts WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND country_id = ? LIMIT 1`,
    [sessionRow.company_name, countryId],
  );
  if (duplicateRows.length) {
    const accountId = Number(duplicateRows[0].id);
    await query(
      `UPDATE prospect_research_sessions SET converted_account_id = ?, updated_at = NOW(3) WHERE id = ?`,
      [accountId, Number(sessionRow.id)],
    );
    return { accountId, reused: true };
  }

  const now = new Date();
  const activationStatusCode = hasPermission(user, "cuentas.create")
    ? "activada"
    : "pendiente_activacion";
  const [accountTypeId, economicSectorId, activationStatusId] = await Promise.all([
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

export async function convertProspectContact({ user, contactId, accountId, contactName = "", email = "" }) {
  await ensureProspectResearchSchema();
  if (!(await getMiCoachGovernanceSettings()).allowProspectConversion) {
    throw createHttpError(403, "Las conversiones de prospeccion estan deshabilitadas por gobierno de Mi Coach", { requiredPermission: "mi_coach.admin" });
  }
  if (!hasAnyPermission(user, ["contactos.create", "contactos.request"])) {
    throw createHttpError(403, "No autorizado", { requiredPermission: "contactos.create" });
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
  const targetAccountId = Number(accountId || prospectContact.converted_account_id || 0);
  if (!targetAccountId) throw createHttpError(400, "Primero convierte o indica una cuenta");
  const parsedName = splitContactName(contactName || prospectContact.name);
  if (!parsedName) throw createHttpError(400, "Captura nombre del contacto para convertirlo");

  const creationStatusCode = hasPermission(user, "contactos.create") ? "activado" : "pendiente_activacion";
  const [purchaseParticipationId, hierarchyLevelId, relationshipTypeId, influenceLevelId, employmentStatusId, activationStatusId] = await Promise.all([
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
      String(email || prospectContact.email || "").trim() || null,
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
  await query(`UPDATE prospect_research_contacts SET status = 'confirmed', updated_at = NOW(3) WHERE id = ?`, [Number(contactId)]);
  return { contactId: Number(result.insertId), accountId: targetAccountId };
}

export async function convertProspectSessionToLead({ user, sessionId, accountId }) {
  await ensureProspectResearchSchema();
  if (!(await getMiCoachGovernanceSettings()).allowProspectConversion) {
    throw createHttpError(403, "Las conversiones de prospeccion estan deshabilitadas por gobierno de Mi Coach", { requiredPermission: "mi_coach.admin" });
  }
  await ensureInteractionSchema();
  if (!hasPermission(user, "interacciones.create")) {
    throw createHttpError(403, "No autorizado", { requiredPermission: "interacciones.create" });
  }
  const sessionRow = await getOwnedSession(sessionId, user.id);
  if (!sessionRow) return null;
  const targetAccountId = Number(accountId || sessionRow.converted_account_id || 0) || null;
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
      JSON.stringify({ name: sessionRow.company_name, website: sessionRow.website || null }),
      targetAccountId,
      Number(user.id),
      Number(user.id),
      Number(user.id),
      now,
      now,
      now,
    ],
  );
  return { interactionId: Number(result.insertId), publicId, accountId: targetAccountId };
}

export async function convertProspectHypothesisToOpportunity({ user, hypothesisId, accountId, contactId, amountUsd = 0, closeDate = "" }) {
  await ensureProspectResearchSchema();
  if (!(await getMiCoachGovernanceSettings()).allowProspectConversion) {
    throw createHttpError(403, "Las conversiones de prospeccion estan deshabilitadas por gobierno de Mi Coach", { requiredPermission: "mi_coach.admin" });
  }
  if (!hasAnyPermission(user, ["oportunidades.create", "oportunidades.request"])) {
    throw createHttpError(403, "No autorizado", { requiredPermission: "oportunidades.create" });
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
  const targetAccountId = Number(accountId || hypothesis.converted_account_id || 0);
  const targetContactId = Number(contactId || 0);
  if (!targetAccountId || !targetContactId) throw createHttpError(400, "Cuenta y contacto son obligatorios para crear oportunidad");
  const activationStatusCode = hasPermission(user, "oportunidades.create") ? "activada" : "pendiente_activacion";
  const [salesStageId, businessLineId, activationStatusId, commercialStatusId] = await Promise.all([
    getCatalogId("opportunity_sales_stages", "contacto_inicial"),
    getCatalogId("opportunity_business_lines", "otro"),
    getCatalogId("opportunity_activation_statuses", activationStatusCode),
    getCatalogId("opportunity_commercial_statuses", "en_proceso"),
  ]);
  const normalizedCloseDate = /^\d{4}-\d{2}-\d{2}$/.test(String(closeDate || ""))
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
  await query(`UPDATE prospect_research_opportunity_hypotheses SET status = 'confirmed', updated_at = NOW(3) WHERE id = ?`, [Number(hypothesisId)]);
  return { opportunityId: Number(result.insertId), accountId: targetAccountId, contactId: targetContactId };
}
