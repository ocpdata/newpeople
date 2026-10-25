import { pool } from "../../db.js";
import { config } from "../../config.js";
import { dossierError, withReadOnlyConnection } from "./access.js";
import { buildAccountDossier, buildOpportunityDossier } from "./opportunity-dossier.js";
import { buildRouterContext, DELEGATED_MODES, routeCustomerTurn } from "./router.js";
import { analyzeCustomerTurn, buildAnalystContext } from "./analyst.js";
import { buildComposerContext, composeCustomerTurn, renderComposition, verifyComposition } from "./composer.js";
import { buildEvidenceIndex, normalizeAnalysisEvidence, verifyAnalysis } from "./verifier.js";

// "off" is only an operational kill switch; any other value serves every user.
export function customerDossierEngineEnabled(features) {
  return features.customerDossierEngineMode !== "off";
}

function businessDate(now, timezone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function remainingSignal(deadlineAt) {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw Object.assign(new Error("Se agotó el tiempo del turno."), { code: "DOSSIER_TURN_TIMEOUT" });
  return AbortSignal.timeout(remaining);
}

const TRANSIENT_PROVIDER_ERROR = /failed: (?:5\d\d|429)\b/;
// Quota and spend-limit rejections also arrive as 429, but retrying cannot succeed.
const PROVIDER_QUOTA_ERROR = /insufficient_quota|spend_limit_exceeded|billing_hard_limit/;
const MIN_RETRY_WINDOW_MS = 20000;

export function isProviderQuotaError(error) {
  return PROVIDER_QUOTA_ERROR.test(String(error?.message || ""));
}

async function withOneTransientRetry(work, { deadlineAt, diagnostics, name }) {
  try {
    return await work();
  } catch (error) {
    if (!TRANSIENT_PROVIDER_ERROR.test(String(error?.message || "")) || isProviderQuotaError(error) ||
        deadlineAt - Date.now() < MIN_RETRY_WINDOW_MS) throw error;
    console.warn("[dossier] Retrying transient provider failure once", { call: name, message: String(error.message).slice(0, 120) });
    diagnostics.transientRetries = [...(diagnostics.transientRetries || []), name];
    return work();
  }
}

const excerpt = (value, limit = 240) => (value ? String(value).replace(/\s+/g, " ").trim().slice(0, limit) : null);

export function describeCitation(item) {
  const id = item.evidenceId;
  const base = { evidenceId: id, table: item.source?.table || null };
  if (id.startsWith("acct")) return { ...base, label: `Cuenta ${item.name}`,
    excerpt: [item.accountType, item.economicSector, item.city, item.ownerNames && `responsables: ${item.ownerNames}`]
      .filter(Boolean).join(" · ") || null };
  if (id.startsWith("aint")) return { ...base, label: `Interacción de cuenta: ${item.title || item.interactionType || ""}`.trim(),
    excerpt: excerpt(item.summary), date: item.occurredAt };
  if (id.startsWith("stk")) return { ...base, label: `Actor: ${item.name}`,
    excerpt: [item.role, item.influenceLevel && `influencia ${item.influenceLevel}`, item.supportLevel && `apoyo ${item.supportLevel}`]
      .filter(Boolean).join(" · ") };
  if (id.startsWith("wk")) return { ...base, label: `Debilidad: ${item.title}`, excerpt: excerpt(item.detail),
    detail: [item.severity, item.status].filter(Boolean).join(" · ") };
  if (id.startsWith("crit")) return { ...base, label: `Criterio ${item.criterionCode}`, excerpt: excerpt(item.summary),
    detail: [item.status, item.score !== null && item.score !== undefined && `puntuación ${item.score}`].filter(Boolean).join(" · ") };
  if (id.startsWith("dlv")) return { ...base, label: `Entregable: ${item.title}`, detail: item.status, date: item.sentAt };
  if (id.startsWith("strat")) return { ...base, label: "Estrategia recomendada", excerpt: excerpt(item.heading), date: item.updatedAt };
  if (id.startsWith("thm")) return { ...base, label: `Tema ${item.themeCode}`, excerpt: excerpt(item.claim) };
  if (id.startsWith("regr")) return { ...base, label: `Renovación de registro ${item.newFolio || ""}`.trim(), date: item.renewedAt,
    detail: item.newExpiresAt && `vence ${item.newExpiresAt}` };
  if (id.startsWith("reg")) return { ...base, label: `Registro ante ${item.providerName || "fabricante"} ${item.folio || ""}`.trim(),
    detail: [item.status, item.expiresAt && `vence ${item.expiresAt}`].filter(Boolean).join(" · ") };
  if (id.startsWith("prop")) return { ...base, label: `Propuesta: ${item.title}`, detail: item.status, date: item.updatedAt };
  if (id.startsWith("pdoc")) return { ...base, label: `Documento de propuesta: ${item.title}`, detail: item.status };
  if (id.startsWith("camp")) return { ...base, label: `Campaña: ${item.campaignName}`,
    detail: [item.lifecycleStage, item.interactionStatus].filter(Boolean).join(" · ") };
  if (id.startsWith("opp")) return { ...base, label: `Oportunidad ${item.name}`,
    excerpt: [item.stageName && `Etapa ${item.stageName}`, item.amountUsd && `USD ${item.amountUsd}`,
      item.closeDate && `cierre ${item.closeDate}`, item.commercialStatusName].filter(Boolean).join(" · ") };
  if (id.startsWith("ans")) return { ...base, label: `Respuesta de etapa ${item.stageName || ""}${item.current === false ? " (sustituida)" : ""}`.trim(),
    excerpt: excerpt(item.answerValue), detail: excerpt(item.question, 200), date: item.answeredAt };
  if (id.startsWith("req")) return { ...base, label: "Pregunta de la etapa actual", excerpt: excerpt(item.question) };
  if (id.startsWith("contact")) return { ...base, label: `Contacto ${[item.firstName, item.lastName].filter(Boolean).join(" ")}`,
    excerpt: item.positionTitle || null };
  if (id.startsWith("act")) return { ...base, label: `Actividad: ${item.title}`, excerpt: excerpt(item.notes),
    detail: [item.status && `estado ${item.status}`, item.dueDate && `vence ${item.dueDate}`].filter(Boolean).join(" · ") };
  if (id.startsWith("cal")) return { ...base, label: `Calendario: ${item.objective || item.activityType || "actividad"}`,
    excerpt: excerpt(item.note), detail: [item.status, item.dueDate || item.scheduledAt].filter(Boolean).join(" · ") };
  if (id.startsWith("note")) return { ...base, label: "Nota de oportunidad", excerpt: excerpt(item.noteText), date: item.createdAt };
  if (id.startsWith("quote")) return { ...base, label: `Cotización ${item.source?.id}` };
  if (id.startsWith("qv")) return { ...base, label: `Cotización ${item.quotationId} · versión ${item.versionNumber}`,
    excerpt: item.statusName, date: item.quotationDate };
  if (id.startsWith("po")) return { ...base, label: "Orden de compra del cliente", excerpt: item.fileName, date: item.registeredAt };
  if (id.startsWith("doc")) return { ...base, label: `Documento ${item.fileName || ""}`.trim(), date: item.createdAt };
  if (id.startsWith("int")) return { ...base, label: `Interacción: ${item.title || ""}`.trim(), excerpt: excerpt(item.summary) };
  if (id.startsWith("audit")) return { ...base, label: "Cambio registrado", date: item.createdAt,
    excerpt: (item.changes || []).map((change) => `${change.label}: ${change.before ?? "—"} → ${change.after ?? "—"}`).join("; ") };
  return { ...base, label: id };
}

function sectionSummary(dossier) {
  return Object.values(dossier.sections).map((section) => ({
    key: section.key, status: section.status, total: section.total ?? null, ...(section.errorCode ? { errorCode: section.errorCode } : {}),
  }));
}

// Which CRM sources were read and whether they were complete; lets reviewers audit absences.
function dossierSources(dossiers) {
  return dossiers.map((dossier) => ({
    kind: dossier.kind,
    id: dossier.opportunity?.id || dossier.account.id,
    sections: Object.values(dossier.sections).map((section) => ({
      key: section.key, status: section.status, total: section.total ?? null,
    })),
  }));
}

const LIMIT_ANSWERS = Object.freeze({
  remove_record: "No puedo eliminar, cancelar ni desactivar registros desde este chat. No se eliminó ni modificó ningún registro. Los nombres similares no demuestran que sean duplicados; puedo ayudarte a consultar sus diferencias sin borrar ni fusionar.",
  send_communication: "No puedo enviar correos ni mensajes desde este chat. No se envió ninguna comunicación. Puedo ayudarte a preparar un borrador para que lo revises y lo envíes por tu canal habitual.",
  out_of_scope: "Esa solicitud no se relaciona con esta cuenta ni con el CRM. Puedo ayudarte con información, análisis, redacción o acciones sobre la cuenta seleccionada.",
});

/** Fixed answers for what this chat does not do; system help links the application documentation when configured. */
export function limitAnswer(kind, ask = "", documentationUrl = config.app?.systemDocumentationUrl || "") {
  if (kind !== "system_help") return LIMIT_ANSWERS[kind] || LIMIT_ANSWERS.out_of_scope;
  const asksPermissions = /\b(permisos?|accesos?)\b/i.test(String(ask).normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  const base = asksPermissions
    ? "No puedo consultar la configuración vigente ni confirmar qué permisos tiene tu perfil. Pide al administrador que verifique tu acceso a Mi Coach y a la función que quieres usar."
    : "No tengo una herramienta para consultar o mostrar el manual ni la documentación del sistema desde este chat, y no voy a reconstruirlos de memoria.";
  return documentationUrl
    ? `${base} Puedes consultar la documentación de la aplicación en ${documentationUrl}.`
    : `${base} Solicita la documentación vigente al administrador.`;
}

function delegated(reason, extra = {}) {
  return { handled: false, reason, ...extra };
}

function unverifiedNotice(failures, obligations) {
  const claims = [...new Set(failures.map((failure) => failure.claim).filter(Boolean))].map((claim) => `- ${claim}`);
  const pending = failures.filter((failure) => !failure.claim && failure.obligationId).map((failure) => {
    const obligation = obligations.find((item) => item.id === failure.obligationId);
    return `- ${obligation ? obligation.ask : failure.obligationId}: ${failure.detail}`;
  });
  return `\n\nNo pude verificar por completo con los registros del CRM:\n${[...new Set([...claims, ...pending])].slice(0, 6).join("\n")}`;
}

export async function runCustomerDossierTurn(input) {
  try {
    return await executeCustomerDossierTurn(input);
  } catch (error) {
    if (String(error?.code || "").startsWith("DOSSIER_")) throw error;
    // Client-facing errors (for example, an exhausted AI budget) already carry an actionable message.
    if (Number(error?.status) >= 400 && Number(error?.status) < 500) throw error;
    const timeout = ["TimeoutError", "AbortError"].includes(error?.name);
    const quota = isProviderQuotaError(error);
    console.error("[dossier] Turn failed", {
      jobId: input.jobId || null, errorName: String(error?.name || "Error").slice(0, 80),
      errorCode: String(error?.code || "").slice(0, 80) || null, errorMessage: String(error?.message || "").slice(0, 500),
    });
    if (quota) {
      throw Object.assign(new Error(
        "El proveedor de IA rechazó la consulta porque la cuenta de la organización alcanzó su límite de gasto. "
        + "Un administrador debe ampliar el límite o el saldo en el proveedor de IA."), {
        code: "DOSSIER_PROVIDER_QUOTA_EXCEEDED", status: 503, cause: error,
      });
    }
    throw Object.assign(new Error(timeout
      ? "La consulta tardó más de lo permitido. Intenta nuevamente."
      : "No pude completar la consulta con los registros del CRM. Intenta nuevamente."), {
      code: timeout ? "DOSSIER_TURN_TIMEOUT" : "DOSSIER_ENGINE_FAILED", cause: error,
    });
  }
}

async function executeCustomerDossierTurn({
  user, accountId, focusOpportunityId = null, question, history = [], memory = null, hasAttachment = false,
  governance, jobId = null, timezone = config.app?.businessTimezone || "America/Mexico_City", now = new Date(),
  deadlineAt = Date.now() + 120000,
  withConnection = (work) => withReadOnlyConnection(pool, work),
  route = routeCustomerTurn, analyze = analyzeCustomerTurn, compose = composeCustomerTurn,
}) {
  const startedAt = Date.now();
  const diagnostics = { engine: "dossier", calls: [], focusOpportunityId: focusOpportunityId || null };
  const timed = async (name, work) => {
    const callStartedAt = Date.now();
    try {
      return await work();
    } finally {
      diagnostics.calls.push({ name, durationMs: Date.now() - callStartedAt });
    }
  };
  if (hasAttachment) return delegated("attachment", { diagnostics });

  const accountDossier = await withConnection((run) => buildAccountDossier({ user, accountId, governance, run, now }));
  const opportunitiesSection = accountDossier.sections.opportunities;
  if (!["loaded", "empty"].includes(opportunitiesSection.status)) {
    throw dossierError(opportunitiesSection.status === "restricted" ? 403 : 502, "DOSSIER_ACCOUNT_OPPORTUNITIES_UNAVAILABLE",
      "No pude leer de forma completa las oportunidades de la cuenta; no puedo identificar el foco con seguridad.");
  }
  const opportunityIds = opportunitiesSection.items.map((item) => item.id);
  if (focusOpportunityId && !opportunityIds.includes(Number(focusOpportunityId))) {
    throw dossierError(404, "DOSSIER_FOCUS_UNAVAILABLE", "La oportunidad seleccionada no está disponible en esta cuenta.");
  }
  const today = businessDate(now, timezone);
  const routed = await timed("router", () => withOneTransientRetry(() => route({
    context: buildRouterContext({ question, history, selectedOpportunityId: focusOpportunityId, accountDossier, memory, today }),
    question, opportunityIds, userId: user.id, jobId, signal: remainingSignal(deadlineAt),
  }), { deadlineAt, diagnostics, name: "router" }));
  diagnostics.route = {
    mode: routed.route.mode, focusLevel: routed.route.focusLevel, opportunityIds: routed.route.opportunityIds,
    responseLength: routed.route.responseLength || "standard",
    obligations: routed.route.obligations, recordFilters: routed.route.recordFilters,
    droppedFilters: routed.droppedFilters, reason: routed.route.reason, attempts: routed.attempts,
    plan: routed.route.plan || null, softIssues: routed.softIssues || [],
  };
  // The plan is the single interpretation: delegated turns carry it so the legacy executors follow it.
  if (DELEGATED_MODES.has(routed.route.mode)) {
    return delegated(`mode_${routed.route.mode}`, { diagnostics, plan: routed.route.plan || null });
  }

  const baseMemory = {
    level: memory?.level || "account", focusOpportunityIds: memory?.focusOpportunityIds || [],
    obligations: memory?.obligations || [], citedEvidenceIds: [],
  };
  if (["limit", "out_of_scope"].includes(routed.route.mode)) {
    const limits = (routed.route.plan?.tasks || []).filter((task) => task.type === "limit");
    const tasks = limits.length ? limits : [{ id: "t1", kind: "out_of_scope", ask: question }];
    return {
      handled: true,
      response: {
        answer: [...new Set(tasks.map((task) => limitAnswer(task.kind, task.ask)))].join("\n\n"),
        responseType: "informational", components: [], operations: [], evidence: [], inferences: [],
        presentation: { status: "completed", engine: "dossier" }, dossierCitations: [],
        turnTasks: tasks.map((task) => ({ id: task.id, type: "limit", kind: task.kind, status: "unavailable",
          engine: "dossier", category: null, validation: null })),
      },
      memory: baseMemory,
      diagnostics: { ...diagnostics, durationMs: Date.now() - startedAt },
    };
  }
  if (routed.route.mode === "clarify") {
    const options = routed.route.clarificationOptions.filter((option) => option.label.trim());
    const answer = [routed.route.clarificationQuestion.trim(), ...options.map((option) => `- ${option.label.trim()}`)].join("\n");
    return {
      handled: true,
      response: {
        answer, responseType: "clarification", components: [], operations: [], evidence: [], inferences: [],
        presentation: { status: "completed", engine: "dossier" }, dossierCitations: [], turnTasks: [],
      },
      memory: baseMemory,
      diagnostics: { ...diagnostics, durationMs: Date.now() - startedAt },
    };
  }

  const focusIds = routed.route.opportunityIds.slice(0, 3);
  const opportunityDossiers = focusIds.length
    ? await withConnection(async (run) => {
      const built = [];
      for (const opportunityId of focusIds) built.push(await buildOpportunityDossier({ user, opportunityId, governance, run, now }));
      return built;
    })
    : [];
  const dossiers = [accountDossier, ...opportunityDossiers];
  diagnostics.dossiers = dossiers.map((dossier) => ({
    kind: dossier.kind, id: dossier.opportunity?.id || dossier.account.id, size: dossier.size, sections: sectionSummary(dossier),
  }));

  const obligations = routed.route.obligations;
  const compositions = routed.route.compositions || [];
  const responseLength = routed.route.responseLength || "standard";
  const index = buildEvidenceIndex(dossiers);
  const llm = (name, work) => timed(name, () => withOneTransientRetry(work, { deadlineAt, diagnostics, name }));
  // One generation, and one repair with the concrete failures when verification or presentation fails.
  const generateVerified = async ({ name, generate, check }) => {
    let current = check(await llm(name, () => generate(null)));
    const rounds = [{ ok: current.verification.ok, failures: current.verification.failures,
      presentationIssues: current.verification.presentationIssues }];
    if (!current.verification.ok || current.verification.presentationIssues.length) {
      const first = current;
      const repaired = check(await llm(`${name}_repair`, () => generate({
        previous: first.output, failures: [...first.verification.failures, ...first.verification.presentationIssues],
        instruction: "Corrige solo los fallos indicados usando la misma evidencia. Si un dato no está en los registros del CRM o en el texto aportado, no lo afirmes: indícalo como límite o como pendiente de confirmar.",
      })));
      rounds.push({ ok: repaired.verification.ok, failures: repaired.verification.failures,
        presentationIssues: repaired.verification.presentationIssues });
      // A repair that only fixes presentation must not lose factual verification the first answer had.
      current = repaired.verification.ok || !first.verification.ok ? repaired : first;
    }
    return { ...current, rounds };
  };

  let analysis = null;
  let verification = null;
  if (obligations.length) {
    const result = await generateVerified({
      name: "analyst",
      generate: (repair) => analyze({
        context: buildAnalystContext({ question, route: routed.route, dossiers, history, today, timezone,
          ...(repair ? { repair: { previousAnalysis: repair.previous, failures: repair.failures, instruction: repair.instruction } } : {}) }),
        obligations, userId: user.id, jobId, signal: remainingSignal(deadlineAt),
      }),
      check: (raw) => {
        const normalized = normalizeAnalysisEvidence(raw, index);
        diagnostics.repairedEvidenceIds = (diagnostics.repairedEvidenceIds || 0) + normalized.repaired;
        return { output: normalized.analysis,
          verification: verifyAnalysis({ analysis: normalized.analysis, obligations, dossiers, responseLength }) };
      },
    });
    ({ output: analysis, verification } = result);
    diagnostics.verification = result.rounds;
  }

  let composition = null;
  let compositionCheck = null;
  if (compositions.length) {
    const analystAnswer = analysis?.answerText || "";
    const result = await generateVerified({
      name: "composer",
      generate: (repair) => compose({
        context: buildComposerContext({ question, tasks: compositions, dossiers, history, today, timezone, analystAnswer,
          ...(repair ? { repair: { previousComposition: repair.previous, failures: repair.failures, instruction: repair.instruction } } : {}) }),
        tasks: compositions, userId: user.id, jobId, signal: remainingSignal(deadlineAt),
      }),
      check: (raw) => {
        const normalized = normalizeAnalysisEvidence({ blocks: raw.deliverables }, index);
        diagnostics.repairedEvidenceIds = (diagnostics.repairedEvidenceIds || 0) + normalized.repaired;
        const output = { ...raw, deliverables: normalized.analysis.blocks };
        return { output, verification: verifyComposition({ composition: output, tasks: compositions, dossiers, question,
          history, responseLength }) };
      },
    });
    ({ output: composition, verification: compositionCheck } = result);
    diagnostics.compositionVerification = result.rounds;
  }

  const allFailures = [...(verification?.failures || []), ...(compositionCheck?.failures || [])];
  const verified = allFailures.length === 0;
  const citedEvidenceIds = [...new Set([...(verification?.citedEvidenceIds || []), ...(compositionCheck?.citedEvidenceIds || [])])];
  const citations = citedEvidenceIds.slice(0, 40).map((id) => describeCitation(index.get(id)));
  // Limit tasks mixed with consultations (for example, "summarize and delete the duplicate") keep their fixed answer.
  const limitTasks = (routed.route.plan?.tasks || []).filter((task) => task.type === "limit");
  const limitText = [...new Set(limitTasks.map((task) => limitAnswer(task.kind, task.ask)))].join("\n\n");
  const sections = [
    analysis ? analysis.answerText.trim() : "",
    composition ? renderComposition(compositions, composition) : "",
  ].filter(Boolean);
  const body = sections.join("\n\n");
  const verifiedText = verified ? body : `${body}${unverifiedNotice(allFailures, [...obligations,
    ...compositions.map((task) => ({ id: task.id, ask: task.ask }))])}`;
  const answer = limitText ? `${verifiedText}\n\n${limitText}` : verifiedText;
  if (analysis) {
    diagnostics.blocks = analysis.blocks.map((block) => ({
      obligationId: block.obligationId, status: block.status, claims: block.claims.length, items: block.items.length,
    }));
  }
  if (composition) {
    diagnostics.deliverables = composition.deliverables.map((item) => ({
      taskId: item.taskId, status: item.status, claims: item.claims.length, items: item.items.length,
    }));
  }
  diagnostics.durationMs = Date.now() - startedAt;
  const failedTask = (id) => allFailures.some((failure) => failure.obligationId === id);
  return {
    handled: true,
    response: {
      answer,
      responseType: "informational",
      components: [], operations: [], evidence: [], inferences: [],
      presentation: verified
        ? { status: "completed", engine: "dossier" }
        : { status: "degraded", engine: "dossier", reasonCode: "DOSSIER_VERIFICATION_INCOMPLETE" },
      dossierCitations: citations,
      dossierSources: dossierSources(dossiers),
      turnTasks: [
        ...obligations.map((obligation) => {
          const task = routed.route.plan?.tasks.find((item) => item.id === obligation.taskId);
          return {
            id: obligation.taskId || obligation.id, type: "consult",
            kind: task?.kind || (obligation.form === "exact_items" ? "list" : "summary"),
            status: "completed", engine: "dossier", category: null,
            validation: failedTask(obligation.id) ? { reasonCode: "verification_incomplete" } : null,
          };
        }),
        ...compositions.map((task) => {
          const deliverable = composition.deliverables.find((item) => item.taskId === task.id);
          return {
            id: task.id, type: "compose", kind: task.kind, engine: "dossier", category: null,
            status: deliverable.status === "done" ? "completed" : "unavailable",
            validation: failedTask(task.id) ? { reasonCode: "verification_incomplete" }
              : compositionCheck.validations[task.id],
          };
        }),
        ...limitTasks.map((task) => ({ id: task.id, type: "limit", kind: task.kind, status: "unavailable",
          engine: "dossier", category: null, validation: null })),
      ],
    },
    memory: {
      level: routed.route.focusLevel, focusOpportunityIds: focusIds,
      obligations: [...obligations, ...compositions].map((item) => ({ id: item.id, ask: item.ask.slice(0, 300) })),
      citedEvidenceIds: citedEvidenceIds.slice(0, 60),
    },
    verification: { ok: verified, failures: allFailures,
      presentationIssues: [...(verification?.presentationIssues || []), ...(compositionCheck?.presentationIssues || [])],
      citedEvidenceIds },
    diagnostics,
  };
}

export function buildDossierQualityTrace(result) {
  const route = result.diagnostics.route || null;
  const failures = result.verification?.failures || [];
  return {
    process: "default",
    intentType: "dossier_consult",
    intentSubtype: route?.focusLevel || null,
    primaryEntity: route?.focusLevel === "account" ? "account" : "opportunity",
    entityResolution: { resolvedEntityIds: { opportunityIds: route?.opportunityIds || [] } },
    appliedRules: { channel: "customer_account", engine: "dossier" },
    validationStatus: result.response.responseType === "clarification" ? "clarification" : failures.length ? "invalid" : "valid",
    validationReasons: [...new Set(failures.map((failure) => failure.code))].slice(0, 10),
    responseType: result.response.responseType,
    confidence: failures.length ? "low" : "high",
    evidenceCount: result.response.dossierCitations.length,
    toolsUsed: [],
    toolMetrics: [],
    diagnostics: { dossierEngine: result.diagnostics },
  };
}
