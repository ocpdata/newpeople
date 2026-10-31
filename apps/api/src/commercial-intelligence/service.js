import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db.js";
import { runStructuredWebResearch } from "../structuredWebResearch.js";
import { ensureCommercialIntelligenceSchema } from "./schema.js";
import { normalizeCustomerIntelligenceOrchestration } from "./contract.js";
import { assertExternalResearchGovernance } from "./governance-settings.js";
import { buildAuthorizedCustomerSnapshot } from "./customer-snapshot.js";
import { clip, createHttpError, hasPermission, isOpenCustomerOpportunity, mapFindingRow, mapJobRow, parseJson } from "./service-helpers.js";
import { deduplicateCustomerIntelligenceFindings, generateCustomerIntelligenceFindings, runAccountIntelligenceAgents, runCustomerExternalResearch } from "./intelligence-research.js";
import { getAccessibleAccount, getAccessibleContact, getAccessibleOpportunity } from "./account-access.js";

export { classifyCustomerSnapshotDataNeeds, normalizeCustomerSnapshotDataNeeds } from "./snapshot-data-needs.js";
export { classifyCustomerIntent } from "./chat-worker.js";
export { buildAccountHealth, buildAuthorizedCustomerSnapshot, buildExpansionHypotheses, getCustomerSnapshotQueryMetrics } from "./customer-snapshot.js";
export { PUBLIC_CONTACT_ROLE_TERMS, deduplicateCustomerIntelligenceFindings, generateCustomerIntelligenceFindings, runAccountIntelligenceAgents } from "./intelligence-research.js";
export { assertExternalResearchGovernance, getMiCoachGovernanceOverview, getMiCoachGovernanceSettings, updateMiCoachGovernanceSettings } from "./governance-settings.js";
export { filterCustomerOpportunityArtifacts, filterCustomerOpportunityHistory } from "./service-helpers.js";
export { CHAT_SESSION_LIST_PAGE_SIZE, buildChatSessionTitle, createCustomerAccountChatSession, getCustomerAccountChatSession, getCustomerChatCapabilities, getCustomerChatFocusOptions, listCustomerAccountChatSessions } from "./chat-sessions.js";
export { closeCustomerChatDiagnostic, getCustomerAccountChatDiagnosticSession, listCustomerAccountChatDiagnostics } from "./chat-diagnostics.js";
export { cancelCustomerAccountChatJob, createCustomerAccountChatJob, getCustomerIntelligenceJob, processCustomerAccountChatJob } from "./chat-jobs.js";

function buildResultSummary(snapshot, findings) {
  const missingCount = findings.filter(
    (finding) => finding.category === "missing_information",
  ).length;
  const confirmedCount = findings.filter(
    (finding) => finding.certainty === "confirmed",
  ).length;
  return {
    sourceDomain: "crm_internal",
    scope: [
      "executive_summary",
      "account_health",
      "risks",
      "opportunities",
      "key_contacts",
      "recent_activity",
      "recommended_actions",
    ],
    headline: snapshot.account?.name
      ? `Investigacion interna de ${snapshot.account.name}`
      : "Investigacion interna del cliente",
    summary: `Se generaron ${findings.length} hallazgo(s): ${confirmedCount} confirmado(s) por datos internos y ${missingCount} hueco(s) de informacion.`,
    generatedAt: new Date().toISOString(),
    counts: {
      findings: findings.length,
      missingInformation: missingCount,
      contacts: snapshot.contacts.length,
      opportunities: snapshot.opportunities.filter(isOpenCustomerOpportunity)
        .length,
      interactions: snapshot.interactions.length,
    },
  };
}

function buildDiscoveryQuestions(snapshot, findings) {
  const questions = [];
  const hasContacts = snapshot.contacts.length > 0;
  const hasOpportunities = snapshot.opportunities.some(
    isOpenCustomerOpportunity,
  );
  const missingFindings = findings.filter(
    (finding) => finding.category === "missing_information",
  );

  if (!hasContacts) {
    questions.push(
      "¿Quién es el responsable técnico y quién aprueba presupuesto para esta iniciativa?",
    );
  }
  if (!hasOpportunities) {
    questions.push(
      "¿Qué iniciativa o problema de negocio deberíamos convertir en una oportunidad concreta?",
    );
  }
  if (snapshot.selectedOpportunity) {
    questions.push(
      `¿Qué condición debe cumplirse para avanzar la oportunidad ${snapshot.selectedOpportunity.name} a la siguiente etapa?`,
    );
    questions.push(
      "¿Cuál es el criterio de éxito que el cliente usará para evaluar la solución?",
    );
  }
  if (missingFindings.length) {
    questions.push(
      "¿Qué información falta para validar necesidad, impacto, presupuesto y fecha objetivo?",
    );
  }
  questions.push(
    "¿Qué pasa en la operación del cliente si este reto no se atiende durante el trimestre?",
  );
  questions.push("¿Qué áreas además de TI se ven afectadas por este problema?");

  return Array.from(new Set(questions)).slice(0, 6);
}

function buildDiscoveryRisks(snapshot, findings) {
  const risks = [];
  if (!snapshot.contacts.length) {
    risks.push(
      "No hay contactos activos documentados; el siguiente contacto puede no llegar al decisor correcto.",
    );
  }
  if (!snapshot.opportunities.some(isOpenCustomerOpportunity)) {
    risks.push(
      "No hay oportunidad activa visible; la conversación puede quedarse en exploración sin avance comercial.",
    );
  }
  if (findings.some((finding) => finding.category === "missing_information")) {
    risks.push(
      "Existen huecos de información que pueden debilitar la calificación de necesidad, impacto o presupuesto.",
    );
  }
  if (snapshot.selectedOpportunity && !snapshot.selectedOpportunity.closeDate) {
    risks.push("La oportunidad seleccionada no tiene fecha de cierre clara.");
  }
  return risks.slice(0, 5);
}

function buildDiscoveryNextSteps(snapshot, findings) {
  const nextSteps = [];
  if (snapshot.selectedOpportunity) {
    nextSteps.push({
      title: "Agendar llamada de descubrimiento dirigida",
      actionType: "call",
      priority: "high",
      opportunityId: snapshot.selectedOpportunity.id,
      successCriteria:
        "Validar necesidad, decisor, impacto de negocio y siguiente hito con fecha.",
      notes: "Preparada desde inteligencia comercial interna de Mi Coach.",
    });
  }
  if (findings.some((finding) => finding.category === "missing_information")) {
    nextSteps.push({
      title: "Completar huecos de información del cliente",
      actionType: "next_step",
      priority: "medium",
      opportunityId: snapshot.selectedOpportunity?.id || null,
      successCriteria:
        "Registrar contactos clave, área dueña, necesidad y criterio de éxito.",
      notes: "Usar las preguntas sugeridas por el briefing comercial.",
    });
  }
  nextSteps.push({
    title: "Enviar resumen de descubrimiento y próximos pasos",
    actionType: "send_email",
    priority: "medium",
    opportunityId: snapshot.selectedOpportunity?.id || null,
    successCriteria:
      "Obtener confirmación del cliente sobre necesidad, responsables y fecha de seguimiento.",
    notes: "Personalizar el correo sugerido antes de enviarlo.",
  });
  return nextSteps.slice(0, 4);
}

export function generateCommercialDiscoveryResult(snapshot, findings = []) {
  const accountName = snapshot.account?.name || "el cliente";
  const questions = buildDiscoveryQuestions(snapshot, findings);
  const risks = buildDiscoveryRisks(snapshot, findings);
  const nextSteps = buildDiscoveryNextSteps(snapshot, findings);
  const confirmedFindings = findings.filter(
    (finding) => finding.certainty === "confirmed",
  );
  const missingFindings = findings.filter(
    (finding) => finding.category === "missing_information",
  );
  const primaryContact =
    snapshot.selectedContact || snapshot.contacts[0] || null;
  const contactLine = primaryContact
    ? `${primaryContact.name || "Contacto"}${primaryContact.positionTitle ? `, ${primaryContact.positionTitle}` : ""}`
    : "Contacto por identificar";

  return {
    headline: `Briefing comercial para ${accountName}`,
    summary: `Preparacion basada en ${findings.length} hallazgo(s) internos. Enfocate en validar necesidad, decisor, impacto y siguiente compromiso.`,
    briefing: {
      objective: snapshot.selectedOpportunity
        ? `Avanzar la oportunidad ${snapshot.selectedOpportunity.name} con informacion comercial verificable.`
        : "Convertir el conocimiento disponible en una conversacion de descubrimiento con siguiente paso concreto.",
      knownContext: confirmedFindings
        .slice(0, 4)
        .map((finding) => finding.summary),
      missingInformation: missingFindings
        .slice(0, 5)
        .map((finding) => finding.title),
      targetContact: contactLine,
      questions,
      risks,
      nextSteps,
      callGuide: [
        `Abrir con el contexto conocido de ${accountName} y confirmar si sigue vigente.`,
        "Validar el problema de negocio antes de hablar de solución.",
        "Identificar decisor, influenciadores, presupuesto y fecha objetivo.",
        "Cerrar con un siguiente paso calendarizado y responsable claro.",
      ],
      emailDraft: {
        subject: `Siguiente paso para entender prioridades de ${accountName}`,
        body: `Hola ${primaryContact?.name || ""},\n\nMe gustaría validar contigo algunas prioridades de ${accountName} para entender si podemos apoyar en los retos actuales de tecnología y operación.\n\nPropongo revisar en una llamada breve: necesidad principal, impacto de negocio, responsables involucrados y siguiente hito.\n\n¿Te parece si coordinamos una conversación esta semana?\n\nSaludos,`,
      },
    },
  };
}

function generateExecutiveBriefingFallback(snapshot, findings = []) {
  const health = snapshot.accountHealth;
  const risks = health.signals
    .filter((signal) => ["high", "medium"].includes(signal.severity))
    .slice(0, 5);
  const latestInteractions = snapshot.interactions
    .slice(0, 3)
    .map((item) => item.summary || item.title)
    .filter(Boolean);
  const firstOpenOpportunity = snapshot.opportunities.find(
    isOpenCustomerOpportunity,
  );
  const questions = [
    "¿Qué cambió en las prioridades del cliente desde la última conversación?",
    "¿Quién decide, quién influye y qué condición habilita el siguiente paso?",
    "¿Cuál es la fecha crítica y cómo se validará el resultado esperado?",
  ];
  return {
    headline: `Resumen ejecutivo de ${snapshot.account?.name || "la cuenta"}`,
    summary: `La cuenta presenta salud ${health.status} con score ${health.score}/100, ${snapshot.opportunities.filter(isOpenCustomerOpportunity).length} oportunidad(es) abierta(s), ${snapshot.contacts.length} contacto(s) y ${snapshot.interactions.length} interacción(es) recientes.`,
    executiveBriefing: {
      accountName: snapshot.account?.name || "Cuenta sin nombre",
      healthStatus: health.status,
      healthScore: health.score,
      knownContext: findings
        .filter((finding) => finding.certainty === "confirmed")
        .slice(0, 5)
        .map((finding) => finding.summary),
      recentChanges: latestInteractions,
      prioritizedRisks: risks.map((signal) => ({
        title: signal.title,
        summary: signal.summary,
        evidence: signal.evidence,
        severity: signal.severity,
      })),
      meetingQuestions: questions,
      nextBestStep:
        risks[0]?.title ||
        (firstOpenOpportunity
          ? `Dar seguimiento a ${firstOpenOpportunity.name}`
          : "Identificar la próxima iniciativa comercial del cliente"),
      recommendedActions:
        snapshot.selectedOpportunity || firstOpenOpportunity
          ? [
              {
                title: risks[0]?.title || "Agendar seguimiento comercial",
                actionType: "call",
                priority: risks[0]?.severity === "high" ? "high" : "medium",
                opportunityId: String(
                  snapshot.selectedOpportunity?.id ||
                    firstOpenOpportunity?.id ||
                    "",
                ),
                notes: "Acción sugerida por el resumen ejecutivo de Mi Coach.",
                successCriteria:
                  "Confirmar necesidad, responsable y siguiente hito con fecha.",
              },
            ]
          : [],
      evidence: risks.map((signal) => signal.evidence),
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function createAccountIntelligenceAgentsJob({ user, payload }) {
  await ensureCommercialIntelligenceSchema();
  const snapshot = await buildAuthorizedCustomerSnapshot({ user, ...payload });
  const result = await query(
    `INSERT INTO customer_intelligence_jobs (public_id, account_id, opportunity_id, contact_id, requested_by_user_id, job_type, status, request_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'agent_orchestration', 'pending', ?, NOW(3), NOW(3))`,
    [
      `cia_${randomUUID()}`,
      snapshot.account?.id || null,
      snapshot.selectedOpportunity?.id || null,
      snapshot.selectedContact?.id || null,
      Number(user.id),
      JSON.stringify(payload),
    ],
  );
  return {
    job: { id: Number(result.insertId), status: "pending", pollAfterMs: 500 },
    snapshot,
  };
}

export async function processAccountIntelligenceAgentsJob({ jobId, user }) {
  const rows = await query(
    `SELECT * FROM customer_intelligence_jobs WHERE id = ? AND requested_by_user_id = ? AND job_type = 'agent_orchestration' LIMIT 1`,
    [Number(jobId), Number(user.id)],
  );
  const job = rows[0];
  if (!job) return null;
  let snapshot;
  let request;
  try {
    snapshot = await buildAuthorizedCustomerSnapshot({
      user,
      accountId: job.account_id,
      opportunityId: job.opportunity_id,
      contactId: job.contact_id,
    });
    request = parseJson(job.request_json, {});
    if (request?.includePublicResearch) {
      if (!hasPermission(user, "fuentes_externas.execute"))
        throw createHttpError(403, "No autorizado", {
          requiredPermission: "fuentes_externas.execute",
        });
      await assertExternalResearchGovernance(user);
    }
  } catch (error) {
    // Failing before the main try left the job 'pending' forever.
    await query(
      `UPDATE customer_intelligence_jobs SET status = 'failed', error_message = ?, updated_at = NOW(3), finished_at = NOW(3) WHERE id = ? AND status = 'pending'`,
      [clip(error?.message || "No fue posible ejecutar los agentes especializados", 1000), Number(jobId)],
    ).catch(() => undefined);
    throw error;
  }
  const startedAt = Date.now();
  const includePublicResearch = Boolean(request?.includePublicResearch);
  try {
    const agents = await runAccountIntelligenceAgents(snapshot, {
      includePublicResearch,
      user,
      jobId,
    });
    const elapsed = Date.now() - startedAt;
    const result = normalizeCustomerIntelligenceOrchestration({
      sourceDomain: includePublicResearch ? "public_web" : "crm_internal",
      orchestrationVersion: "account-intelligence.agents.v1",
      agents: agents.map((agent) => ({
        ...agent,
        durationMs: agent.durationMs || elapsed,
      })),
      generatedAt: new Date().toISOString(),
      writesPerformed: false,
    });
    result.telemetry = {
      durationMs: elapsed,
      sourceCount: agents.reduce(
        (sum, agent) => sum + agent.evidence.length,
        0,
      ),
      findingCount: agents.reduce(
        (sum, agent) => sum + agent.findings.length,
        0,
      ),
      writesPerformed: false,
    };
    await query(
      `UPDATE customer_intelligence_jobs SET status = 'completed', result_json = ?, error_message = NULL, updated_at = NOW(3), finished_at = NOW(3) WHERE id = ?`,
      [JSON.stringify(result), Number(jobId)],
    );
    return {
      ...mapJobRow({
        ...job,
        status: "completed",
        result_json: JSON.stringify(result),
      }),
      result,
    };
  } catch (error) {
    await query(
      `UPDATE customer_intelligence_jobs SET status = 'failed', error_message = ?, updated_at = NOW(3), finished_at = NOW(3) WHERE id = ?`,
      [
        clip(
          error?.message ||
            "No fue posible ejecutar los agentes especializados",
          1000,
        ),
        Number(jobId),
      ],
    ).catch(() => undefined);
    return null;
  }
}

export async function getAccountIntelligenceMetrics({ user }) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT status, job_type, COUNT(*) AS total
     FROM customer_intelligence_jobs
     WHERE requested_by_user_id = ? AND created_at >= DATE_SUB(NOW(3), INTERVAL 30 DAY)
     GROUP BY status, job_type`,
    [Number(user.id)],
  );
  const usageRows = await query(
    `SELECT COUNT(*) AS requests, COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(cost_micros), 0) AS costMicros
     FROM ai_usage_ledger
     WHERE user_id = ? AND feature_code LIKE 'commercial_intelligence.%'
       AND created_at_utc >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)`,
    [Number(user.id)],
  ).catch(() => []);
  return {
    periodDays: 30,
    jobs: rows.map((row) => ({
      status: row.status,
      jobType: row.job_type,
      total: Number(row.total || 0),
    })),
    aiUsage: {
      requests: Number(usageRows[0]?.requests || 0),
      tokens: Number(usageRows[0]?.tokens || 0),
      costMicros: Number(usageRows[0]?.costMicros || 0),
    },
  };
}

export async function createCustomerExecutiveBriefingJob({ user, payload }) {
  await ensureCommercialIntelligenceSchema();
  const snapshot = await buildAuthorizedCustomerSnapshot({ user, ...payload });
  const publicId = `ceb_${randomUUID()}`;
  const result = await query(
    `INSERT INTO customer_intelligence_jobs
      (public_id, account_id, opportunity_id, contact_id, requested_by_user_id,
       job_type, status, request_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'executive_briefing', 'pending', ?, NOW(3), NOW(3))`,
    [
      publicId,
      snapshot.account?.id || null,
      snapshot.selectedOpportunity?.id || null,
      snapshot.selectedContact?.id || null,
      Number(user.id),
      JSON.stringify({ ...payload, requestedAt: new Date().toISOString() }),
    ],
  );
  return {
    job: {
      id: Number(result.insertId),
      publicId,
      status: "pending",
      pollAfterMs: 1000,
    },
    snapshot,
  };
}

export async function processCustomerExecutiveBriefingJob({ jobId, user }) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT * FROM customer_intelligence_jobs WHERE id = ? AND requested_by_user_id = ? AND job_type = 'executive_briefing' LIMIT 1`,
    [Number(jobId), Number(user.id)],
  );
  const job = rows[0];
  if (!job) return null;
  if (!["pending", "running"].includes(String(job.status)))
    return mapJobRow(job);
  await query(
    `UPDATE customer_intelligence_jobs SET status = 'running', updated_at = NOW(3) WHERE id = ?`,
    [Number(jobId)],
  );
  try {
    const snapshot = await buildAuthorizedCustomerSnapshot({
      user,
      accountId: job.account_id,
      opportunityId: job.opportunity_id,
      contactId: job.contact_id,
    });
    const findings = generateCustomerIntelligenceFindings(snapshot);
    const aiResult = await runStructuredWebResearch({
      schemaName: "account_executive_briefing",
      systemPrompt:
        "Eres un asistente comercial B2B. Resume una cuenta usando exclusivamente el snapshot autorizado y sus evidencias. No inventes hechos; separa hechos, riesgos e hipótesis.",
      subject: snapshot.account?.name || "cuenta",
      context: { snapshot, findings, accountHealth: snapshot.accountHealth },
      currentValues: {},
      fields: [
        { key: "summary", type: "string", example: "Resumen ejecutivo" },
        {
          key: "recentChanges",
          type: "array",
          example: ["Cambio reciente"],
          items: { type: "string", example: "Cambio reciente" },
        },
        {
          key: "prioritizedRisks",
          type: "array",
          example: [],
          items: {
            type: "object",
            fields: [
              { key: "title", type: "string", example: "Riesgo" },
              { key: "summary", type: "string", example: "Resumen" },
              { key: "evidence", type: "string", example: "Evidencia" },
              {
                key: "severity",
                type: "enum",
                enum: ["high", "medium", "low"],
                example: "medium",
              },
            ],
          },
        },
        {
          key: "meetingQuestions",
          type: "array",
          example: ["Pregunta"],
          items: { type: "string", example: "Pregunta" },
        },
        {
          key: "nextBestStep",
          type: "string",
          example: "Siguiente mejor paso",
        },
        {
          key: "evidence",
          type: "array",
          example: ["Evidencia"],
          items: { type: "string", example: "Evidencia" },
        },
        {
          key: "recommendedActions",
          type: "array",
          example: [],
          items: {
            type: "object",
            fields: [
              { key: "title", type: "string", example: "Agendar seguimiento" },
              { key: "actionType", type: "string", example: "call" },
              {
                key: "priority",
                type: "enum",
                enum: ["high", "medium", "low"],
                example: "medium",
              },
              { key: "opportunityId", type: "string", example: "123" },
              { key: "notes", type: "string", example: "Nota" },
              { key: "successCriteria", type: "string", example: "Criterio" },
            ],
          },
        },
      ],
      aiUsageContext: {
        userId: Number(user.id),
        featureCode: "commercial_intelligence.executive_briefing",
        jobType: "executive_briefing",
        jobId,
      },
    });
    const fallback = generateExecutiveBriefingFallback(snapshot, findings);
    const executiveBriefing = aiResult
      ? {
          ...fallback.executiveBriefing,
          ...aiResult,
          healthStatus: snapshot.accountHealth.status,
          healthScore: snapshot.accountHealth.score,
        }
      : fallback.executiveBriefing;
    const result = {
      sourceDomain: "crm_internal",
      scope: [
        "executive_summary",
        "account_health",
        "risks",
        "opportunities",
        "key_contacts",
        "recent_activity",
        "recommended_actions",
      ],
      headline: fallback.headline,
      summary: aiResult?.summary || fallback.summary,
      executiveBriefing,
      generatedAt: new Date().toISOString(),
    };
    await query(
      `UPDATE customer_intelligence_jobs SET status = 'completed', result_json = ?, error_message = NULL, updated_at = NOW(3), finished_at = NOW(3) WHERE id = ?`,
      [JSON.stringify(result), Number(jobId)],
    );
    return {
      ...mapJobRow({
        ...job,
        status: "completed",
        result_json: JSON.stringify(result),
        error_message: null,
      }),
      result,
    };
  } catch (error) {
    await query(
      `UPDATE customer_intelligence_jobs SET status = 'failed', error_message = ?, updated_at = NOW(3), finished_at = NOW(3) WHERE id = ?`,
      [
        clip(
          error?.message || "No fue posible preparar el resumen ejecutivo",
          1000,
        ),
        Number(jobId),
      ],
    ).catch(() => undefined);
    return null;
  }
}

async function insertFindings(
  conn,
  { jobId, userId, accountId, opportunityId, contactId, findings },
) {
  const now = new Date();
  const inserted = [];
  for (const finding of deduplicateCustomerIntelligenceFindings(findings)) {
    const publicId = `cif_${randomUUID()}`;
    const [result] = await conn.query(
      `INSERT INTO customer_intelligence_findings
        (public_id, job_id, account_id, opportunity_id, contact_id, category,
         title, summary, evidence_text, source_type, source_reference,
         confidence, certainty, status, metadata_json, created_by_user_id,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'suggested', ?, ?, ?, ?)`,
      [
        publicId,
        jobId,
        accountId || null,
        opportunityId || null,
        contactId || null,
        finding.category,
        finding.title,
        finding.summary,
        finding.evidenceText,
        finding.sourceType,
        finding.sourceReference,
        finding.confidence,
        finding.certainty,
        JSON.stringify(finding.metadata || {}),
        userId,
        now,
        now,
      ],
    );
    inserted.push({ ...finding, id: Number(result.insertId), publicId });
  }
  return inserted;
}

export async function createCustomerIntelligenceJob({ user, payload }) {
  await ensureCommercialIntelligenceSchema();
  const snapshot = await buildAuthorizedCustomerSnapshot({
    user,
    accountId: payload.accountId,
    opportunityId: payload.opportunityId,
    contactId: payload.contactId,
  });

  const accountId = snapshot.account?.id || null;
  const opportunityId = snapshot.selectedOpportunity?.id || null;
  const contactId = snapshot.selectedContact?.id || null;
  const publicId = `cij_${randomUUID()}`;
  const request = {
    accountId,
    opportunityId,
    contactId,
    objective: clip(payload.objective, 1000),
    requestedAt: new Date().toISOString(),
  };

  const result = await query(
    `INSERT INTO customer_intelligence_jobs
      (public_id, account_id, opportunity_id, contact_id, requested_by_user_id,
       job_type, status, request_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'customer_research', 'pending', ?, NOW(3), NOW(3))`,
    [
      publicId,
      accountId,
      opportunityId,
      contactId,
      Number(user.id),
      JSON.stringify(request),
    ],
  );

  return {
    job: {
      id: Number(result.insertId),
      publicId,
      status: "pending",
      pollAfterMs: 1000,
    },
    snapshot,
  };
}

export async function createAccountInternalAnalysisJob({ user, payload }) {
  await ensureCommercialIntelligenceSchema();
  const snapshot = await buildAuthorizedCustomerSnapshot({ user, ...payload });
  const result = await query(
    `INSERT INTO customer_intelligence_jobs
      (public_id, account_id, opportunity_id, contact_id, requested_by_user_id,
       job_type, status, request_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'account_internal_analysis', 'pending', ?, NOW(3), NOW(3))`,
    [
      `cia_${randomUUID()}`,
      snapshot.account?.id || null,
      snapshot.selectedOpportunity?.id || null,
      snapshot.selectedContact?.id || null,
      Number(user.id),
      JSON.stringify(payload),
    ],
  );
  return {
    job: { id: Number(result.insertId), status: "pending", pollAfterMs: 700 },
    snapshot,
  };
}

export async function processAccountInternalAnalysisJob({ jobId, user }) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT * FROM customer_intelligence_jobs WHERE id = ? AND requested_by_user_id = ? AND job_type = 'account_internal_analysis' LIMIT 1`,
    [Number(jobId), Number(user.id)],
  );
  const job = rows[0];
  if (!job) return null;
  const snapshot = await buildAuthorizedCustomerSnapshot({
    user,
    accountId: job.account_id,
    opportunityId: job.opportunity_id,
    contactId: job.contact_id,
  });
  const agents = await runAccountIntelligenceAgents(snapshot, {
    includePublicResearch: false,
  });
  const findings = generateCustomerIntelligenceFindings(snapshot);
  const persistedFindings = await withTransaction(async (conn) => {
    await conn.query(
      `DELETE FROM customer_intelligence_findings WHERE job_id = ?`,
      [Number(jobId)],
    );
    return insertFindings(conn, {
      jobId: Number(jobId),
      userId: Number(user.id),
      accountId: job.account_id === null ? null : Number(job.account_id),
      opportunityId:
        job.opportunity_id === null ? null : Number(job.opportunity_id),
      contactId: job.contact_id === null ? null : Number(job.contact_id),
      findings,
    });
  });
  const result = {
    sourceDomain: "crm_internal",
    scope: [
      "executive_summary",
      "account_health",
      "risks",
      "opportunities",
      "key_contacts",
      "recent_activity",
      "renewal_expansion",
      "recommended_actions",
    ],
    headline: snapshot.account?.name
      ? `Análisis de cuenta: ${snapshot.account.name}`
      : "Análisis de cuenta",
    summary: `Análisis interno consolidado con ${snapshot.contacts.length} contacto(s), ${snapshot.opportunities.length} oportunidad(es), ${snapshot.products.length} producto(s) y ${snapshot.renewals.length} renovación(es).`,
    snapshot,
    accountHealth: snapshot.accountHealth,
    findings: persistedFindings,
    agents,
    generatedAt: new Date().toISOString(),
    writesPerformed: false,
  };
  await query(
    `UPDATE customer_intelligence_jobs SET status = 'completed', result_json = ?, updated_at = NOW(3), finished_at = NOW(3) WHERE id = ?`,
    [JSON.stringify(result), Number(jobId)],
  );
  return {
    ...mapJobRow({
      ...job,
      status: "completed",
      result_json: JSON.stringify(result),
    }),
    result,
    findings: persistedFindings,
  };
}

export async function createCommercialDiscoveryJob({ user, payload }) {
  await ensureCommercialIntelligenceSchema();
  const snapshot = await buildAuthorizedCustomerSnapshot({
    user,
    accountId: payload.accountId,
    opportunityId: payload.opportunityId,
    contactId: payload.contactId,
  });

  const accountId = snapshot.account?.id || null;
  const opportunityId = snapshot.selectedOpportunity?.id || null;
  const contactId = snapshot.selectedContact?.id || null;
  const publicId = `cdj_${randomUUID()}`;
  const request = {
    accountId,
    opportunityId,
    contactId,
    objective: clip(payload.objective || "Preparar llamada comercial", 1000),
    requestedAt: new Date().toISOString(),
  };

  const result = await query(
    `INSERT INTO customer_intelligence_jobs
      (public_id, account_id, opportunity_id, contact_id, requested_by_user_id,
       job_type, status, request_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'commercial_discovery', 'pending', ?, NOW(3), NOW(3))`,
    [
      publicId,
      accountId,
      opportunityId,
      contactId,
      Number(user.id),
      JSON.stringify(request),
    ],
  );

  return {
    job: {
      id: Number(result.insertId),
      publicId,
      status: "pending",
      pollAfterMs: 1000,
    },
    snapshot,
  };
}

export async function createCustomerExternalResearchJob({ user, payload }) {
  await ensureCommercialIntelligenceSchema();
  await assertExternalResearchGovernance(user);
  const snapshot = await buildAuthorizedCustomerSnapshot({
    user,
    accountId: payload.accountId,
    opportunityId: payload.opportunityId,
    contactId: payload.contactId,
  });
  const accountId = snapshot.account?.id || null;
  const opportunityId = snapshot.selectedOpportunity?.id || null;
  const contactId = snapshot.selectedContact?.id || null;
  const publicId = `cej_${randomUUID()}`;
  const result = await query(
    `INSERT INTO customer_intelligence_jobs
      (public_id, account_id, opportunity_id, contact_id, requested_by_user_id,
       job_type, status, request_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'external_research', 'pending', ?, NOW(3), NOW(3))`,
    [
      publicId,
      accountId,
      opportunityId,
      contactId,
      Number(user.id),
      JSON.stringify({
        accountId,
        opportunityId,
        contactId,
        requestedAt: new Date().toISOString(),
      }),
    ],
  );
  return {
    job: {
      id: Number(result.insertId),
      publicId,
      status: "pending",
      pollAfterMs: 1000,
    },
    snapshot,
  };
}

export async function processCustomerIntelligenceJob({ jobId, user }) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT * FROM customer_intelligence_jobs
     WHERE id = ? AND requested_by_user_id = ? LIMIT 1`,
    [Number(jobId), Number(user.id)],
  );
  const job = rows[0];
  if (!job) return null;
  if (!["pending", "running"].includes(String(job.status))) {
    return mapJobRow(job);
  }

  await query(
    `UPDATE customer_intelligence_jobs
     SET status = 'running', updated_at = NOW(3)
     WHERE id = ?`,
    [Number(jobId)],
  );

  try {
    const snapshot = await buildAuthorizedCustomerSnapshot({
      user,
      accountId: job.account_id,
      opportunityId: job.opportunity_id,
      contactId: job.contact_id,
    });
    const findings = generateCustomerIntelligenceFindings(snapshot);
    const resultSummary = buildResultSummary(snapshot, findings);

    const persistedFindings = await withTransaction(async (conn) => {
      await conn.query(
        `DELETE FROM customer_intelligence_findings WHERE job_id = ?`,
        [Number(jobId)],
      );
      const inserted = await insertFindings(conn, {
        jobId: Number(jobId),
        userId: Number(user.id),
        accountId: job.account_id === null ? null : Number(job.account_id),
        opportunityId:
          job.opportunity_id === null ? null : Number(job.opportunity_id),
        contactId: job.contact_id === null ? null : Number(job.contact_id),
        findings,
      });
      await conn.query(
        `UPDATE customer_intelligence_jobs
         SET status = 'completed', result_json = ?, error_message = NULL,
             updated_at = NOW(3), finished_at = NOW(3)
         WHERE id = ?`,
        [
          JSON.stringify({ ...resultSummary, findings: inserted }),
          Number(jobId),
        ],
      );
      return inserted;
    });

    return {
      ...mapJobRow({
        ...job,
        status: "completed",
        result_json: JSON.stringify({
          ...resultSummary,
          findings: persistedFindings,
        }),
        error_message: null,
      }),
      result: { ...resultSummary, findings: persistedFindings },
    };
  } catch (error) {
    await query(
      `UPDATE customer_intelligence_jobs
       SET status = 'failed', error_message = ?, updated_at = NOW(3), finished_at = NOW(3)
       WHERE id = ?`,
      [
        clip(error?.message || "No fue posible investigar el cliente", 1000),
        Number(jobId),
      ],
    ).catch(() => undefined);
    return null;
  }
}

export async function processCommercialDiscoveryJob({ jobId, user }) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT * FROM customer_intelligence_jobs
     WHERE id = ? AND requested_by_user_id = ? LIMIT 1`,
    [Number(jobId), Number(user.id)],
  );
  const job = rows[0];
  if (!job) return null;
  if (!["pending", "running"].includes(String(job.status))) {
    return mapJobRow(job);
  }

  await query(
    `UPDATE customer_intelligence_jobs
     SET status = 'running', updated_at = NOW(3)
     WHERE id = ?`,
    [Number(jobId)],
  );

  try {
    const snapshot = await buildAuthorizedCustomerSnapshot({
      user,
      accountId: job.account_id,
      opportunityId: job.opportunity_id,
      contactId: job.contact_id,
    });
    const findings = generateCustomerIntelligenceFindings(snapshot);
    const result = generateCommercialDiscoveryResult(snapshot, findings);

    await query(
      `UPDATE customer_intelligence_jobs
       SET status = 'completed', result_json = ?, error_message = NULL,
           updated_at = NOW(3), finished_at = NOW(3)
       WHERE id = ?`,
      [JSON.stringify({ ...result, sourceFindings: findings }), Number(jobId)],
    );

    return {
      ...mapJobRow({
        ...job,
        status: "completed",
        result_json: JSON.stringify({ ...result, sourceFindings: findings }),
        error_message: null,
      }),
      result: { ...result, sourceFindings: findings },
    };
  } catch (error) {
    await query(
      `UPDATE customer_intelligence_jobs
       SET status = 'failed', error_message = ?, updated_at = NOW(3), finished_at = NOW(3)
       WHERE id = ?`,
      [
        clip(error?.message || "No fue posible preparar la llamada", 1000),
        Number(jobId),
      ],
    ).catch(() => undefined);
    return null;
  }
}

export async function processCustomerExternalResearchJob({ jobId, user }) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT * FROM customer_intelligence_jobs
     WHERE id = ? AND requested_by_user_id = ? LIMIT 1`,
    [Number(jobId), Number(user.id)],
  );
  const job = rows[0];
  if (!job) return null;
  if (!["pending", "running"].includes(String(job.status)))
    return mapJobRow(job);
  await query(
    `UPDATE customer_intelligence_jobs SET status = 'running', updated_at = NOW(3) WHERE id = ?`,
    [Number(jobId)],
  );
  try {
    const snapshot = await buildAuthorizedCustomerSnapshot({
      user,
      accountId: job.account_id,
      opportunityId: job.opportunity_id,
      contactId: job.contact_id,
    });
    const external = await runCustomerExternalResearch({
      snapshot,
      user,
      jobId: Number(jobId),
    });
    let inserted = [];
    if (external.findings.length) {
      inserted = await withTransaction(async (conn) =>
        insertFindings(conn, {
          jobId: Number(jobId),
          userId: Number(user.id),
          accountId: job.account_id === null ? null : Number(job.account_id),
          opportunityId:
            job.opportunity_id === null ? null : Number(job.opportunity_id),
          contactId: job.contact_id === null ? null : Number(job.contact_id),
          findings: external.findings,
        }),
      );
    }
    const result = {
      sourceDomain: "public_web",
      scope: ["public_research", "executive_summary"],
      headline: "Investigacion externa del cliente",
      summary: external.enabled
        ? `Se detectaron ${inserted.length} hallazgo(s) desde fuentes publicas.`
        : "La investigacion externa no se ejecuto porque Tavily no esta habilitado o no pudo recuperar fuentes.",
      externalResearch: {
        enabled: external.enabled,
        provider: external.provider || "tavily",
        warnings: external.warnings,
        findingCount: inserted.length,
        researchedAt: new Date().toISOString(),
      },
      findings: inserted,
      generatedAt: new Date().toISOString(),
    };
    await query(
      `UPDATE customer_intelligence_jobs
       SET status = 'completed', result_json = ?, error_message = NULL,
           updated_at = NOW(3), finished_at = NOW(3)
       WHERE id = ?`,
      [JSON.stringify(result), Number(jobId)],
    );
    return {
      ...mapJobRow({
        ...job,
        status: "completed",
        result_json: JSON.stringify(result),
        error_message: null,
      }),
      result,
    };
  } catch (error) {
    await query(
      `UPDATE customer_intelligence_jobs
       SET status = 'failed', error_message = ?, updated_at = NOW(3), finished_at = NOW(3)
       WHERE id = ?`,
      [
        clip(
          error?.message || "No fue posible investigar fuentes externas",
          1000,
        ),
        Number(jobId),
      ],
    ).catch(() => undefined);
    return null;
  }
}

export async function listCustomerIntelligenceFindings({ user, filters = {} }) {
  await ensureCommercialIntelligenceSchema();
  const where = [];
  const params = [];

  if (filters.accountId) {
    await getAccessibleAccount({ user, accountId: Number(filters.accountId) });
    where.push("account_id = ?");
    params.push(Number(filters.accountId));
  }
  if (filters.opportunityId) {
    await getAccessibleOpportunity({
      user,
      opportunityId: Number(filters.opportunityId),
    });
    where.push("opportunity_id = ?");
    params.push(Number(filters.opportunityId));
  }
  if (filters.contactId) {
    await getAccessibleContact({ user, contactId: Number(filters.contactId) });
    where.push("contact_id = ?");
    params.push(Number(filters.contactId));
  }
  if (filters.status) {
    where.push("status = ?");
    params.push(String(filters.status));
  }

  if (!where.length) {
    where.push("created_by_user_id = ?");
    params.push(Number(user.id));
  }

  const rows = await query(
    `SELECT * FROM customer_intelligence_findings
     WHERE ${where.join(" AND ")}
     ORDER BY updated_at DESC, id DESC
     LIMIT 100`,
    params,
  );
  return rows.map(mapFindingRow);
}

export async function updateCustomerIntelligenceFindingStatus({
  user,
  findingId,
  status,
}) {
  await ensureCommercialIntelligenceSchema();
  const allowedStatuses = new Set([
    "confirmed",
    "rejected",
    "suggested",
    "outdated",
  ]);
  if (!allowedStatuses.has(status)) {
    throw createHttpError(400, "Estado de hallazgo invalido");
  }

  const rows = await query(
    `SELECT * FROM customer_intelligence_findings WHERE id = ? LIMIT 1`,
    [Number(findingId)],
  );
  const finding = rows[0];
  if (!finding) return null;

  if (finding.account_id) {
    await getAccessibleAccount({ user, accountId: Number(finding.account_id) });
  }
  if (finding.opportunity_id) {
    await getAccessibleOpportunity({
      user,
      opportunityId: Number(finding.opportunity_id),
    });
  }
  if (finding.contact_id) {
    await getAccessibleContact({ user, contactId: Number(finding.contact_id) });
  }

  await query(
    `UPDATE customer_intelligence_findings
     SET status = ?, validated_by_user_id = ?, validated_at = NOW(3), updated_at = NOW(3)
     WHERE id = ?`,
    [status, Number(user.id), Number(findingId)],
  );

  const updatedRows = await query(
    `SELECT * FROM customer_intelligence_findings WHERE id = ? LIMIT 1`,
    [Number(findingId)],
  );
  return mapFindingRow(updatedRows[0]);
}

export async function applyCustomerIntelligenceFinding({
  user,
  findingId,
  target,
  field,
  value,
  mode,
}) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT * FROM customer_intelligence_findings WHERE id = ? LIMIT 1`,
    [Number(findingId)],
  );
  const finding = rows[0];
  if (!finding) return null;
  if (finding.status !== "confirmed") {
    throw createHttpError(
      409,
      "El hallazgo debe confirmarse antes de guardar cambios",
    );
  }

  const targetConfig = {
    account: {
      id: finding.account_id,
      permission: "cuentas.update",
      table: "accounts",
      fields: {
        description: "description",
        website: "website",
        phone: "phone",
        city: "city",
        stateRegion: "state_region",
      },
    },
    contact: {
      id: finding.contact_id,
      permission: "contactos.update",
      table: "contacts",
      fields: {
        positionTitle: "position_title",
        department: "department",
        email: "email",
        phone: "phone",
        mobile: "mobile",
        city: "city",
        stateRegion: "state_region",
      },
    },
    opportunity: {
      id: finding.opportunity_id,
      permission: "oportunidades.update",
      table: "opportunities",
      fields: { name: "name" },
    },
  }[target];

  if (!targetConfig?.id || !targetConfig.fields[field]) {
    throw createHttpError(
      400,
      "El campo seleccionado no corresponde al registro del hallazgo",
    );
  }
  if (!hasPermission(user, targetConfig.permission)) {
    throw createHttpError(403, "No autorizado", {
      requiredPermission: targetConfig.permission,
    });
  }
  if (target === "account")
    await getAccessibleAccount({ user, accountId: targetConfig.id });
  if (target === "contact")
    await getAccessibleContact({ user, contactId: targetConfig.id });
  if (target === "opportunity")
    await getAccessibleOpportunity({ user, opportunityId: targetConfig.id });

  const normalizedValue = clip(value, 10000);
  if (!normalizedValue) throw createHttpError(400, "El valor es obligatorio");
  const [currentRows] = await query(
    `SELECT ${targetConfig.fields[field]} AS current_value FROM ${targetConfig.table} WHERE id = ? LIMIT 1`,
    [Number(targetConfig.id)],
  );
  const currentValue = String(currentRows?.current_value || "").trim();
  const nextValue =
    mode === "append" && currentValue
      ? `${currentValue}\n\n${normalizedValue}`
      : normalizedValue;
  await query(
    `UPDATE ${targetConfig.table} SET ${targetConfig.fields[field]} = ?, updated_at = NOW(3) WHERE id = ?`,
    [nextValue, Number(targetConfig.id)],
  );
  return {
    finding: mapFindingRow(finding),
    target,
    field,
    mode,
    value: nextValue,
    recordId: Number(targetConfig.id),
  };
}

export async function applyCustomerContactFinding({
  user,
  findingId,
  contactId,
  contactData,
}) {
  await ensureCommercialIntelligenceSchema();
  const rows = await query(
    `SELECT * FROM customer_intelligence_findings WHERE id = ? LIMIT 1`,
    [Number(findingId)],
  );
  const finding = rows[0];
  if (!finding) return null;
  if (finding.status !== "confirmed") {
    throw createHttpError(
      409,
      "El hallazgo debe confirmarse antes de guardar cambios",
    );
  }
  if (!finding.account_id)
    throw createHttpError(400, "El hallazgo no tiene una cuenta relacionada");
  await getAccessibleAccount({ user, accountId: Number(finding.account_id) });
  const data = {
    firstName: String(contactData?.firstName || "").trim(),
    lastName: String(contactData?.lastName || "").trim(),
    positionTitle: String(contactData?.positionTitle || "").trim(),
    department: String(contactData?.department || "").trim(),
    email: String(contactData?.email || "").trim(),
    phone: String(contactData?.phone || "").trim(),
    mobile: String(contactData?.mobile || "").trim(),
  };
  if (!data.firstName || !data.lastName)
    throw createHttpError(400, "Nombre y apellido son obligatorios");
  if (contactId) {
    if (!hasPermission(user, "contactos.update"))
      throw createHttpError(403, "No autorizado", {
        requiredPermission: "contactos.update",
      });
    await getAccessibleContact({ user, contactId: Number(contactId) });
    await query(
      `UPDATE contacts SET first_name = ?, last_name = ?, position_title = ?, department = ?, email = ?, phone = ?, mobile = ?, updated_by = ?, updated_at = NOW(3) WHERE id = ? AND account_id = ?`,
      [
        data.firstName,
        data.lastName,
        data.positionTitle || null,
        data.department || null,
        data.email || null,
        data.phone || null,
        data.mobile || null,
        Number(user.id),
        Number(contactId),
        Number(finding.account_id),
      ],
    );
    return {
      mode: "updated",
      contactId: Number(contactId),
      finding: mapFindingRow(finding),
    };
  }
  if (!hasPermission(user, "contactos.create"))
    throw createHttpError(403, "No autorizado", {
      requiredPermission: "contactos.create",
    });
  const [country] = await query("SELECT id FROM countries ORDER BY id LIMIT 1");
  const [purchase] = await query(
    "SELECT id FROM contact_purchase_participations ORDER BY id LIMIT 1",
  );
  const [hierarchy] = await query(
    "SELECT id FROM contact_hierarchy_levels ORDER BY id LIMIT 1",
  );
  const [relationship] = await query(
    "SELECT id FROM contact_relationship_types ORDER BY id LIMIT 1",
  );
  const [influence] = await query(
    "SELECT id FROM contact_influence_levels ORDER BY id LIMIT 1",
  );
  const [employment] = await query(
    "SELECT id FROM contact_employment_statuses ORDER BY id LIMIT 1",
  );
  const [activation] = await query(
    "SELECT id FROM contact_activation_statuses WHERE code = 'activado' ORDER BY id LIMIT 1",
  );
  const result = await query(
    `INSERT INTO contacts
      (first_name, last_name, account_id, position_title, phone, mobile, email,
       department, country_id, purchase_participation_id, hierarchy_level_id,
       relationship_type_id, influence_level_id, employment_status_id,
       activation_status_id, created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?, NOW(3))`,
    [
      data.firstName,
      data.lastName,
      Number(finding.account_id),
      data.positionTitle || null,
      data.phone || null,
      data.mobile || null,
      data.email || null,
      data.department || null,
      country?.id || null,
      purchase?.id,
      hierarchy?.id,
      relationship?.id,
      influence?.id,
      employment?.id,
      activation?.id,
      Number(user.id),
      Number(user.id),
    ],
  );
  return {
    mode: "created",
    contactId: Number(result.insertId),
    finding: mapFindingRow(finding),
  };
}
