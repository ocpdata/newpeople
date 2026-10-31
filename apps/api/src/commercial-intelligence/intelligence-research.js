// Findings, public research and the specialist agents behind the account intelligence jobs.

import { CUSTOMER_INTELLIGENCE_CATEGORIES, normalizeCustomerIntelligenceFinding } from "./contract.js";
import { runStructuredTextResearch } from "../structuredWebResearch.js";
import { searchTavily } from "../tavily.js";
import { clip, isOpenCustomerOpportunity } from "./service-helpers.js";

export const FINDING_CATEGORIES = new Set(CUSTOMER_INTELLIGENCE_CATEGORIES);

export const PUBLIC_CONTACT_ROLE_TERMS = [
  "tecnología",
  "seguridad",
  "infraestructura",
  "operaciones",
  "arquitectura",
  "producto",
  "innovación",
  "transformación digital",
  "usuario responsable",
  "influenciador técnico",
  "responsable regional",
  "líder de proyecto",
  "compras",
];

export function normalizeFindingKeyPart(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function deduplicateCustomerIntelligenceFindings(findings = []) {
  const unique = new Map();
  for (const finding of findings) {
    const normalized = normalizeCustomerIntelligenceFinding(finding);
    const sourceKey = normalizeFindingKeyPart(
      normalized.sourceUrl || normalized.source,
    );
    const targetKey = [
      normalized.targetEntity,
      normalized.targetField,
      normalized.suggestedValue,
    ]
      .map(normalizeFindingKeyPart)
      .join("|");
    const key = [
      normalized.sourceDomain,
      normalized.category,
      normalizeFindingKeyPart(normalized.title),
      sourceKey,
      targetKey,
    ].join("|");
    const previous = unique.get(key);
    if (!previous) {
      unique.set(key, normalized);
      continue;
    }
    unique.set(key, {
      ...previous,
      evidence: [previous.evidence, normalized.evidence]
        .filter(Boolean)
        .join(" | ")
        .slice(0, 4000),
      confidence:
        previous.confidence === "high" || normalized.confidence === "high"
          ? "high"
          : previous.confidence === "medium" ||
              normalized.confidence === "medium"
            ? "medium"
            : "low",
      metadata: {
        ...(previous.metadata || {}),
        duplicateCount: Number(previous.metadata?.duplicateCount || 1) + 1,
      },
    });
  }
  return [...unique.values()];
}

export function cleanPublicContactValue(value) {
  const text = String(value || "").trim();
  if (!text || /[*xX]{2,}/.test(text)) return "";
  return text;
}

export function buildFinding({
  category,
  title,
  summary,
  evidenceText,
  sourceType = "crm",
  sourceReference = "CRM",
  confidence = "medium",
  certainty = "evidenced",
  metadata = {},
}) {
  const normalizedCategory = FINDING_CATEGORIES.has(category)
    ? category
    : "missing_information";
  const finding = {
    sourceDomain:
      sourceType === "tavily" || sourceType === "public_web"
        ? "public_web"
        : "crm_internal",
    category: normalizedCategory,
    title: clip(title, 190),
    summary: clip(summary, 4000),
    evidenceText: clip(evidenceText, 4000),
    sourceType,
    sourceReference: clip(sourceReference, 500),
    confidence,
    certainty,
    status: "suggested",
    metadata,
  };
  const normalized = normalizeCustomerIntelligenceFinding(finding);
  return { ...finding, ...normalized };
}

export function generateCustomerIntelligenceFindings(snapshot) {
  const findings = [];
  const account = snapshot.account;
  const selectedOpportunity = snapshot.selectedOpportunity;
  const contacts = Array.isArray(snapshot.contacts) ? snapshot.contacts : [];
  const opportunities = Array.isArray(snapshot.opportunities)
    ? snapshot.opportunities
    : [];
  const interactions = Array.isArray(snapshot.interactions)
    ? snapshot.interactions
    : [];

  if (account?.description) {
    findings.push(
      buildFinding({
        category: "need",
        title: "Contexto de negocio documentado",
        summary: `La cuenta tiene una descripcion comercial disponible: ${clip(account.description, 500)}`,
        evidenceText: account.description,
        sourceReference: `account:${account.id}:description`,
        confidence: "high",
        certainty: "confirmed",
      }),
    );
  } else if (account) {
    findings.push(
      buildFinding({
        category: "missing_information",
        title: "Falta descripcion del negocio de la cuenta",
        summary:
          "No hay una descripcion suficiente del negocio del cliente. Conviene documentar que hace, como opera y que resultado espera lograr.",
        evidenceText: "Campo description de cuenta vacio o no disponible.",
        sourceReference: `account:${account.id}`,
        confidence: "high",
        certainty: "confirmed",
      }),
    );
  }

  if (contacts.length) {
    const namedContacts = contacts
      .slice(0, 5)
      .map((contact) =>
        [contact.name, contact.positionTitle || contact.department]
          .filter(Boolean)
          .join(" - "),
      );
    findings.push(
      buildFinding({
        category: "stakeholder",
        title: "Contactos activos disponibles",
        summary: `Hay ${contacts.length} contacto(s) activo(s) para trabajar el mapa comercial.`,
        evidenceText: namedContacts.join("; "),
        sourceReference: `account:${account?.id || selectedOpportunity?.accountId}:contacts`,
        confidence: contacts.length >= 2 ? "high" : "medium",
        certainty: "confirmed",
        metadata: { contactCount: contacts.length },
      }),
    );
    const contactsWithRelationshipGaps = contacts.filter(
      (contact) =>
        !contact.purchaseParticipation ||
        !contact.hierarchyLevel ||
        !contact.influenceLevel ||
        (!contact.managerContactId && !contact.influencesContactId),
    );
    if (contactsWithRelationshipGaps.length) {
      findings.push(
        buildFinding({
          category: "missing_information",
          title: "Mapa de relación incompleto",
          summary: `${contactsWithRelationshipGaps.length} contacto(s) necesitan completar participación, nivel o relaciones.`,
          evidenceText: contactsWithRelationshipGaps
            .slice(0, 5)
            .map((contact) => contact.name || `Contacto ${contact.id}`)
            .join("; "),
          sourceReference: `account:${account?.id || selectedOpportunity?.accountId}:relationship-map`,
          confidence: "high",
          certainty: "confirmed",
          metadata: {
            contactIds: contactsWithRelationshipGaps.map(
              (contact) => contact.id,
            ),
          },
        }),
      );
    }
  } else if (snapshot.permissions.canReadContacts) {
    findings.push(
      buildFinding({
        category: "missing_information",
        title: "No hay contactos activos documentados",
        summary:
          "La cuenta no tiene contactos activos accesibles. El siguiente paso comercial deberia identificar responsable tecnico, usuario final y responsable economico.",
        evidenceText: "Consulta de contactos activos sin resultados.",
        sourceReference: `account:${account?.id || selectedOpportunity?.accountId}:contacts`,
        confidence: "high",
        certainty: "confirmed",
      }),
    );
  }

  const openOpportunities = opportunities.filter(isOpenCustomerOpportunity);
  if (openOpportunities.length) {
    const openPipeline = openOpportunities.reduce(
      (sum, opportunity) => sum + Number(opportunity.amountUsd || 0),
      0,
    );
    findings.push(
      buildFinding({
        category: "technology_project",
        title: "Oportunidades activas como senales de proyecto",
        summary: `La cuenta tiene ${openOpportunities.length} oportunidad(es) abierta(s), por un pipeline aproximado de ${openPipeline.toFixed(2)} USD.`,
        evidenceText: openOpportunities
          .slice(0, 5)
          .map(
            (opportunity) =>
              `${opportunity.name} (${opportunity.stageName || "sin etapa"})`,
          )
          .join("; "),
        sourceReference: `account:${account?.id || selectedOpportunity?.accountId}:opportunities`,
        confidence: "high",
        certainty: "confirmed",
        metadata: {
          opportunityCount: openOpportunities.length,
          openPipelineUsd: openPipeline,
        },
      }),
    );
  } else if (snapshot.permissions.canReadOpportunities) {
    findings.push(
      buildFinding({
        category: "missing_information",
        title: "No hay oportunidades activas visibles",
        summary:
          "No se encontraron oportunidades activas para esta cuenta. Conviene validar necesidades actuales antes de crear una oportunidad nueva.",
        evidenceText: "Consulta de oportunidades activas sin resultados.",
        sourceReference: `account:${account?.id || selectedOpportunity?.accountId}:opportunities`,
        confidence: "medium",
        certainty: "confirmed",
      }),
    );
  }

  if (selectedOpportunity) {
    findings.push(
      buildFinding({
        category: "next_step",
        title: "Oportunidad seleccionada para desarrollo comercial",
        summary: `La oportunidad ${selectedOpportunity.name} esta en etapa ${selectedOpportunity.stageName || "sin etapa"} y requiere validar la siguiente informacion comercial antes de avanzar.`,
        evidenceText: `Importe ${selectedOpportunity.amountUsd || 0} USD; cierre ${selectedOpportunity.closeDate || "sin fecha"}.`,
        sourceReference: `opportunity:${selectedOpportunity.id}`,
        confidence: "high",
        certainty: "confirmed",
      }),
    );
  }

  if (interactions.length) {
    findings.push(
      buildFinding({
        category: "business_challenge",
        title: "Interacciones recientes disponibles para extraer necesidades",
        summary: `Hay ${interactions.length} interaccion(es) reciente(s) que pueden contener necesidades, objeciones o acciones pendientes del cliente.`,
        evidenceText: interactions
          .slice(0, 3)
          .map(
            (interaction) =>
              `${interaction.title}: ${interaction.summary || interaction.sourceNotes || "sin resumen"}`,
          )
          .join(" | "),
        sourceReference: `account:${account?.id || selectedOpportunity?.accountId}:interactions`,
        confidence: "medium",
        certainty: "evidenced",
        metadata: { interactionCount: interactions.length },
      }),
    );
  } else if (snapshot.permissions.canReadInteractions) {
    findings.push(
      buildFinding({
        category: "missing_information",
        title: "No hay interacciones recientes accesibles",
        summary:
          "No se encontraron interacciones recientes. Conviene registrar la proxima conversacion para alimentar el descubrimiento comercial.",
        evidenceText: "Consulta de interacciones sin resultados.",
        sourceReference: `account:${account?.id || selectedOpportunity?.accountId}:interactions`,
        confidence: "medium",
        certainty: "confirmed",
      }),
    );
  }

  return findings;
}

export function agentResult(
  agentId,
  summary,
  findings = [],
  evidence = [],
  confidence = "medium",
  requiresConfirmation = false,
) {
  const sourceDomain =
    agentId === "public_research" ||
    agentId === "contact_research" ||
    agentId === "technology_research"
      ? "public_web"
      : "crm_internal";
  return {
    agentId,
    status: "completed",
    summary,
    findings,
    evidence,
    confidence,
    requiresConfirmation,
    sourceDomain,
    durationMs: 0,
    sourceCount: evidence.length,
  };
}

export async function runPublicSpecialistAgent({
  agentId,
  subject,
  queryText,
  queryTexts = [],
  systemPrompt,
  fields,
  snapshot,
  user,
  jobId,
  category,
}) {
  const searches = [queryText, ...queryTexts]
    .filter(Boolean)
    .map((query) => searchTavily({ query, featureCode: `commercial_intelligence.${agentId}`, userId: user?.id }));
  const tavilyResults = await Promise.all(searches);
  const tavily = {
    enabled: tavilyResults.some((result) => result.enabled),
    results: tavilyResults
      .flatMap((result) => result.results || [])
      .filter(
        (result, index, results) =>
          results.findIndex((candidate) => candidate.url === result.url) ===
          index,
      ),
    warnings: tavilyResults.flatMap((result) => result.warnings || []),
  };
  if (!tavily.enabled || !tavily.results.length) {
    return agentResult(
      agentId,
      "No se encontraron fuentes públicas para este agente.",
      [],
      tavily.warnings || [],
      "low",
    );
  }
  const result = await runStructuredTextResearch({
    schemaName: `account_${agentId}`,
    systemPrompt,
    subject,
    context: {
      account: snapshot.account,
      existingContacts: snapshot.contacts,
      existingProducts: snapshot.products,
      publicSources: tavily.results,
    },
    currentValues: {},
    fields,
    aiUsageContext: {
      userId: Number(user.id),
      featureCode: `commercial_intelligence.${agentId}`,
      jobType: "agent_orchestration",
      jobId,
    },
  });
  if (!result)
    return agentResult(
      agentId,
      "No fue posible interpretar las fuentes públicas.",
      [],
      tavily.warnings || [],
      "low",
    );
  let rawItems = Array.isArray(result.items) ? result.items : [];
  let enrichmentSources = [];
  if (agentId === "contact_research" && rawItems.length) {
    const candidates = rawItems
      .filter((item) => item?.firstName && item?.lastName)
      .slice(0, 10);
    const enrichmentResults = await Promise.all(
      candidates.map((item) =>
        searchTavily({
          query: `site:linkedin.com/in "${item.firstName} ${item.lastName}" "${subject}" email teléfono contacto`,
          maxResults: 5,
          featureCode: "commercial_intelligence.contact_enrichment",
          userId: user?.id,
        }),
      ),
    );
    enrichmentSources = enrichmentResults
      .flatMap((search) => search.results || [])
      .filter(
        (source, index, sources) =>
          sources.findIndex((candidate) => candidate.url === source.url) ===
          index,
      );
    if (enrichmentSources.length) {
      const enriched = await runStructuredTextResearch({
        schemaName: "account_contact_enrichment",
        systemPrompt:
          "Enriquece contactos candidatos usando únicamente las fuentes públicas proporcionadas. Solo devuelve email o teléfono si aparecen explícitamente en la evidencia. Conserva nombre y cargo si están sustentados; no inventes datos.",
        subject,
        context: {
          candidateContacts: candidates,
          publicSources: enrichmentSources,
        },
        currentValues: {},
        fields,
        aiUsageContext: {
          userId: Number(user.id),
          featureCode: "commercial_intelligence.contact_enrichment",
          jobType: "agent_orchestration",
          jobId,
        },
      });
      if (Array.isArray(enriched?.items) && enriched.items.length)
        rawItems = enriched.items;
    }
  }
  const findings = rawItems.map((item, index) =>
    normalizeCustomerExternalFinding(
      {
        category,
        title: item.title || `${agentId} ${index + 1}`,
        summary:
          item.summary ||
          item.businessChallenge ||
          item.roleTitle ||
          "Señal pública",
        evidenceText:
          item.evidence ||
          item.evidenceText ||
          "Evidencia pública recuperada por Tavily.",
        sourceUrl: item.sourceUrl || "",
        confidence: item.confidence || "medium",
        targetEntity: agentId === "contact_research" ? "contact" : "account",
        targetField:
          agentId === "contact_research" ? "positionTitle" : "description",
        suggestedValue:
          item.suggestedValue || item.summary || item.businessChallenge || "",
        contactData:
          agentId === "contact_research"
            ? {
                firstName: item.firstName || "",
                lastName: item.lastName || "",
                positionTitle: item.positionTitle || "",
                department: item.department || "",
                email: item.email || "",
                phone: item.phone || "",
                mobile: item.mobile || "",
              }
            : null,
      },
      index,
      "tavily",
    ),
  );
  return agentResult(
    agentId,
    `${findings.length} resultado(s) públicos encontrados${enrichmentSources.length ? " y enriquecidos por candidato" : ""}.`,
    findings,
    [...tavily.results, ...enrichmentSources].map((source) => source.url),
    findings.length ? "medium" : "low",
    true,
  );
}

export async function runAccountIntelligenceAgents(
  snapshot,
  { includePublicResearch = false, user = null, jobId = null } = {},
) {
  const crmFindings = generateCustomerIntelligenceFindings(snapshot);
  const healthFindings = snapshot.accountHealth.signals.map((signal) =>
    normalizeCustomerIntelligenceFinding({
      category: signal.severity === "high" ? "risk" : "missing_information",
      title: signal.title,
      summary: signal.summary,
      evidence: signal.evidence,
      source: signal.source,
      sourceUrl: "",
      confidence: signal.severity === "high" ? "high" : "medium",
      certainty: "confirmed",
    }),
  );
  const expansionFindings = snapshot.expansionHypotheses.map((hypothesis) =>
    normalizeCustomerIntelligenceFinding({
      category: hypothesis.type === "renewal" ? "renewal" : "expansion",
      title: hypothesis.title,
      summary: hypothesis.summary,
      evidence: hypothesis.evidence,
      source: "crm:expansion_hypotheses",
      confidence: hypothesis.confidence,
      certainty: "inferred",
    }),
  );
  const actionFindings = snapshot.expansionHypotheses
    .slice(0, 5)
    .map((hypothesis) =>
      normalizeCustomerIntelligenceFinding({
        category: "next_step",
        title: hypothesis.title,
        summary:
          "Revisar esta hipótesis con el cliente antes de crear o ampliar una oportunidad.",
        evidence: hypothesis.evidence,
        source: "agent:actions",
        confidence: "medium",
        certainty: "inferred",
        requiresConfirmation: true,
      }),
    );
  let publicAgent = agentResult(
    "public_research",
    includePublicResearch
      ? "La investigación pública se ejecutó mediante Tavily."
      : "Investigación pública no solicitada en esta ejecución.",
    [],
    [],
    includePublicResearch ? "medium" : "low",
  );
  let contactAgent = agentResult(
    "contact_research",
    "Búsqueda de contactos públicos no solicitada en esta ejecución.",
    [],
    [],
    "low",
    true,
  );
  let technologyAgent = agentResult(
    "technology_research",
    "Búsqueda de iniciativas tecnológicas no solicitada en esta ejecución.",
    [],
    [],
    "low",
    true,
  );
  if (includePublicResearch && user) {
    const external = await runCustomerExternalResearch({
      snapshot,
      user,
      jobId,
    });
    publicAgent = agentResult(
      "public_research",
      external.enabled
        ? `Tavily recuperó ${external.findings.length} hallazgo(s).`
        : "Tavily no pudo recuperar fuentes públicas.",
      external.findings,
      external.warnings,
      external.enabled ? "medium" : "low",
    );
    [contactAgent, technologyAgent] = await Promise.all([
      runPublicSpecialistAgent({
        agentId: "contact_research",
        subject: snapshot.account?.name || "cuenta",
        queryText:
          String(snapshot.account?.name || "empresa") +
          " tecnología seguridad infraestructura operaciones arquitectura producto innovación transformación digital responsables líderes de proyecto contactos",
        queryTexts: [
          `site:linkedin.com/in "${snapshot.account?.name || "empresa"}" tecnología OR seguridad OR infraestructura OR operaciones`,
          `site:linkedin.com/in "${snapshot.account?.name || "empresa"}" ${PUBLIC_CONTACT_ROLE_TERMS.join(" OR ")}`,
        ],
        systemPrompt:
          "Extrae únicamente contactos profesionales públicamente identificables. Exige nombre y apellido; no inventes emails ni teléfonos. Devuelve solo personas con cargo, área, evidencia y URL.",
        fields: [
          {
            key: "items",
            type: "array",
            example: [],
            items: {
              type: "object",
              fields: [
                { key: "firstName", type: "string", example: "Ana" },
                { key: "lastName", type: "string", example: "Pérez" },
                { key: "positionTitle", type: "string", example: "CTO" },
                { key: "department", type: "string", example: "Tecnología" },
                { key: "email", type: "string", example: "" },
                { key: "phone", type: "string", example: "" },
                { key: "mobile", type: "string", example: "" },
                { key: "title", type: "string", example: "Contacto público" },
                {
                  key: "summary",
                  type: "string",
                  example: "Persona identificada",
                },
                { key: "evidence", type: "string", example: "Evidencia" },
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
        ],
        snapshot,
        user,
        jobId,
        category: "stakeholder",
      }),
      runPublicSpecialistAgent({
        agentId: "technology_research",
        subject: snapshot.account?.name || "cuenta",
        queryText:
          String(snapshot.account?.name || "empresa") +
          " tecnología que usa implementación arquitectura cloud ciberseguridad aplicaciones Kubernetes networking DNS DHCP IPAM APIs",
        queryTexts: [
          `"${snapshot.account?.name || "empresa"}" cloud OR AWS OR Azure OR Google Cloud OR multinube implementa usa arquitectura`,
          `"${snapshot.account?.name || "empresa"}" ciberseguridad OR SOC OR firewall OR WAF OR IAM usa implementa`,
          `"${snapshot.account?.name || "empresa"}" aplicaciones OR microservicios OR APIs OR integración tecnológica`,
          `"${snapshot.account?.name || "empresa"}" Kubernetes OR contenedores OR Docker OR OpenShift`,
          `"${snapshot.account?.name || "empresa"}" networking OR redes OR DNS OR DHCP OR IPAM`,
        ],
        systemPrompt:
          "Identifica únicamente tecnologías que la cuenta usa, implementa, migra, opera o anuncia públicamente. Prioriza cloud, ciberseguridad, aplicaciones, Kubernetes, networking, DNS, DHCP, IPAM y APIs. No devuelvas tendencias generales ni tecnologías que solo sean relevantes para el sector; cada resultado debe indicar la tecnología concreta, cómo se relaciona con la cuenta, evidencia, URL y confianza. No conviertas una inferencia en hecho.",
        fields: [
          {
            key: "items",
            type: "array",
            example: [],
            items: {
              type: "object",
              fields: [
                { key: "title", type: "string", example: "Iniciativa cloud" },
                { key: "summary", type: "string", example: "Resumen" },
                {
                  key: "businessChallenge",
                  type: "string",
                  example: "Reto de negocio",
                },
                { key: "evidence", type: "string", example: "Evidencia" },
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
        ],
        snapshot,
        user,
        jobId,
        category: "technology_project",
      }),
    ]);
  }
  const synthesis = agentResult(
    "synthesis",
    `Síntesis coordinada con ${crmFindings.length} hallazgo(s) CRM, ${healthFindings.length} señal(es) de salud, ${expansionFindings.length} hipótesis de expansión y ${publicAgent.findings.length} hallazgo(s) públicos.`,
    deduplicateCustomerIntelligenceFindings([
      ...crmFindings,
      ...healthFindings,
      ...expansionFindings,
      ...publicAgent.findings,
    ]).slice(0, 20),
    [...publicAgent.evidence],
    "medium",
  );
  const derivedActionFindings = [
    ...actionFindings,
    ...healthFindings
      .filter((finding) => finding.category === "risk")
      .slice(0, 5)
      .map((finding) =>
        normalizeCustomerIntelligenceFinding({
          category: "next_step",
          title: `Atender: ${finding.title}`,
          summary: "Revisar esta señal antes de avanzar comercialmente.",
          evidence: finding.evidence,
          source: "agent:actions",
          confidence: "medium",
          certainty: "inferred",
          requiresConfirmation: true,
        }),
      ),
  ];
  const agents = [
    agentResult(
      "crm_context",
      `Contexto CRM: ${snapshot.contacts.length} contactos, ${snapshot.opportunities.filter(isOpenCustomerOpportunity).length} oportunidades abiertas y ${snapshot.interactions.length} interacciones.`,
      crmFindings,
      [snapshot.account?.name || "Cuenta"],
      "high",
    ),
    agentResult(
      "commercial_health",
      `Salud comercial: ${snapshot.accountHealth.status} (${snapshot.accountHealth.score}/100).`,
      healthFindings,
      snapshot.accountHealth.signals.map((signal) => signal.evidence),
      snapshot.accountHealth.status === "at_risk" ? "high" : "medium",
    ),
    publicAgent,
    contactAgent,
    technologyAgent,
    agentResult(
      "expansion",
      `Se identificaron ${snapshot.expansionHypotheses.length} hipótesis de renovación o expansión.`,
      expansionFindings,
      snapshot.expansionHypotheses.map((item) => item.evidence),
      "medium",
      true,
    ),
    synthesis,
    agentResult(
      "actions",
      `${derivedActionFindings.length} acción(es) requieren revisión humana.`,
      derivedActionFindings,
      derivedActionFindings.map((item) => item.evidence),
      "medium",
      true,
    ),
  ];
  return agents.map((agent) => ({
    ...agent,
    durationMs: 0,
    sourceCount: agent.evidence.length,
  }));
}

export function normalizeCustomerExternalFinding(
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
  const rawContactData =
    rawFinding?.contactData && typeof rawFinding.contactData === "object"
      ? rawFinding.contactData
      : null;
  const contactData = rawContactData
    ? {
        ...rawContactData,
        email: cleanPublicContactValue(rawContactData.email),
        phone: cleanPublicContactValue(rawContactData.phone),
        mobile: cleanPublicContactValue(rawContactData.mobile),
      }
    : null;
  const contactName =
    contactData?.firstName && contactData?.lastName
      ? `${contactData.firstName} ${contactData.lastName}`.trim()
      : "";
  const inferredTargetEntity =
    rawFinding?.targetEntity ||
    (contactData?.firstName && contactData?.lastName ? "contact" : "account");
  return buildFinding({
    category: rawFinding?.category || "business_challenge",
    title: contactName || title,
    summary: summary || title,
    evidenceText:
      evidenceText ||
      "Señal detectada en investigacion externa; requiere validacion comercial.",
    sourceType,
    sourceReference: sourceUrl || "fuente_publica_no_especificada",
    confidence: ["high", "medium", "low"].includes(rawFinding?.confidence)
      ? rawFinding.confidence
      : "medium",
    certainty: "evidenced",
    metadata: {
      externalResearch: true,
      contactData,
      targetEntity: inferredTargetEntity,
      targetField: rawFinding?.targetField || "description",
      suggestedValue: clip(
        rawFinding?.suggestedValue || summary || evidenceText,
        10000,
      ),
    },
  });
}

export async function runCustomerExternalResearch({ snapshot, user, jobId }) {
  const subject =
    snapshot.account?.name ||
    snapshot.selectedOpportunity?.name ||
    snapshot.selectedContact?.name ||
    "cliente";
  const tavily = await searchTavily({
    query: `${subject} ${snapshot.account?.city || ""} noticias proyectos tecnología empresa`,
    featureCode: "commercial_intelligence.external",
    userId: user?.id,
  });
  const contactSearch = await searchTavily({
    query: `${subject} liderazgo directivos CTO CIO CISO director tecnología contacto empresa`,
    featureCode: "commercial_intelligence.external",
    userId: user?.id,
  });
  const publicResults = [
    ...(tavily.results || []),
    ...(contactSearch.results || []),
  ].filter(
    (result, index, results) =>
      results.findIndex((candidate) => candidate.url === result.url) === index,
  );
  if ((!tavily.enabled && !contactSearch.enabled) || !publicResults.length) {
    return {
      enabled: false,
      findings: [],
      warnings: [...(tavily.warnings || []), ...(contactSearch.warnings || [])],
      provider: "tavily",
    };
  }
  const result = await runStructuredTextResearch({
    schemaName: "customer_external_research",
    systemPrompt: [
      "Eres un agente de inteligencia comercial B2B.",
      "Interpreta exclusivamente las fuentes públicas recuperadas por Tavily.",
      "No afirmes inferencias como hechos; cada hallazgo debe tener evidencia y fuente.",
      "Devuelve hallazgos utiles para preparar conversaciones comerciales en español.",
    ].join("\n"),
    subject,
    context: {
      account: snapshot.account,
      selectedOpportunity: snapshot.selectedOpportunity,
      selectedContact: snapshot.selectedContact,
      publicSources: publicResults,
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
            { key: "summary", type: "string", example: "Resumen de señal" },
            {
              key: "evidenceText",
              type: "string",
              example: "Fragmento exacto",
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
            {
              key: "targetEntity",
              type: "enum",
              enum: ["account", "contact", "opportunity"],
              example: "account",
            },
            { key: "targetField", type: "string", example: "description" },
            {
              key: "suggestedValue",
              type: "string",
              example: "Valor sugerido para actualizar el CRM",
            },
            {
              key: "contactData",
              type: "object",
              fields: [
                { key: "firstName", type: "string", example: "Ana" },
                { key: "lastName", type: "string", example: "Pérez" },
                { key: "positionTitle", type: "string", example: "CTO" },
                { key: "department", type: "string", example: "Tecnología" },
                { key: "email", type: "string", example: "ana@example.com" },
                { key: "phone", type: "string", example: "" },
                { key: "mobile", type: "string", example: "" },
              ],
            },
          ],
        },
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
      featureCode: "commercial_intelligence.external",
      jobType: "customer_external_research",
      jobId,
    },
  });

  if (!result) {
    return {
      enabled: false,
      findings: [],
      warnings: [
        "OpenAI no esta disponible para interpretar los resultados de Tavily.",
      ],
      provider: "tavily",
    };
  }
  return {
    enabled: true,
    findings: Array.isArray(result.findings)
      ? result.findings
          .map((finding, index) =>
            normalizeCustomerExternalFinding(finding, index, "tavily"),
          )
          .filter((finding) => finding.title)
      : [],
    warnings: [
      ...(tavily.warnings || []),
      ...(contactSearch.warnings || []),
      ...(Array.isArray(result.warnings)
        ? result.warnings.filter(Boolean)
        : []),
    ],
    provider: "tavily",
  };
}
