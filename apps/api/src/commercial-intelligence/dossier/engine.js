import { pool } from "../../db.js";
import { config } from "../../config.js";
import { dossierError, withReadOnlyConnection } from "./access.js";
import { buildAccountDossier, buildOpportunityDossier } from "./opportunity-dossier.js";
import { buildRouterContext, DELEGATED_MODES, routeCustomerTurn } from "./router.js";
import { analyzeCustomerTurn, buildAnalystContext } from "./analyst.js";
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
  if (id.startsWith("acct")) return { ...base, label: `Cuenta ${item.name}` };
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
  route = routeCustomerTurn, analyze = analyzeCustomerTurn,
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
  const routed = await timed("router", () => route({
    context: buildRouterContext({ question, history, selectedOpportunityId: focusOpportunityId, accountDossier, memory, today }),
    question, opportunityIds, userId: user.id, jobId, signal: remainingSignal(deadlineAt),
  }));
  diagnostics.route = {
    mode: routed.route.mode, focusLevel: routed.route.focusLevel, opportunityIds: routed.route.opportunityIds,
    responseLength: routed.route.responseLength || "standard",
    obligations: routed.route.obligations, recordFilters: routed.route.recordFilters,
    droppedFilters: routed.droppedFilters, reason: routed.route.reason, attempts: routed.attempts,
  };
  if (DELEGATED_MODES.has(routed.route.mode)) return delegated(`mode_${routed.route.mode}`, { diagnostics });

  const baseMemory = {
    level: memory?.level || "account", focusOpportunityIds: memory?.focusOpportunityIds || [],
    obligations: memory?.obligations || [], citedEvidenceIds: [],
  };
  if (routed.route.mode === "clarify") {
    const options = routed.route.clarificationOptions.filter((option) => option.label.trim());
    const answer = [routed.route.clarificationQuestion.trim(), ...options.map((option) => `- ${option.label.trim()}`)].join("\n");
    return {
      handled: true,
      response: {
        answer, responseType: "clarification", components: [], operations: [], evidence: [], inferences: [],
        presentation: { status: "completed", engine: "dossier" }, dossierCitations: [],
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
  const responseLength = routed.route.responseLength || "standard";
  const index = buildEvidenceIndex(dossiers);
  const check = (raw) => {
    const normalized = normalizeAnalysisEvidence(raw, index);
    diagnostics.repairedEvidenceIds = (diagnostics.repairedEvidenceIds || 0) + normalized.repaired;
    return { analysis: normalized.analysis,
      verification: verifyAnalysis({ analysis: normalized.analysis, obligations, dossiers, responseLength }) };
  };
  const context = buildAnalystContext({ question, route: routed.route, dossiers, history, today, timezone });
  let { analysis, verification } = check(await timed("analyst", () => withOneTransientRetry(
    () => analyze({ context, obligations, userId: user.id, jobId, signal: remainingSignal(deadlineAt) }),
    { deadlineAt, diagnostics, name: "analyst" })));
  diagnostics.verification = [{ ok: verification.ok, failures: verification.failures,
    presentationIssues: verification.presentationIssues }];
  if (!verification.ok || verification.presentationIssues.length) {
    const first = { analysis, verification };
    const repaired = check(await timed("analyst_repair", () => withOneTransientRetry(() => analyze({
      context: buildAnalystContext({ question, route: routed.route, dossiers, history, today, timezone, repair: {
        previousAnalysis: analysis, failures: [...verification.failures, ...verification.presentationIssues],
        instruction: "Corrige solo los fallos indicados usando la misma evidencia. Si un dato no está en los registros del CRM, no lo afirmes: indícalo como límite o como pendiente de confirmar.",
      } }),
      obligations, userId: user.id, jobId, signal: remainingSignal(deadlineAt),
    }), { deadlineAt, diagnostics, name: "analyst_repair" })));
    diagnostics.verification.push({ ok: repaired.verification.ok, failures: repaired.verification.failures,
      presentationIssues: repaired.verification.presentationIssues });
    // A repair that only fixes presentation must not lose factual verification the first answer had.
    if (repaired.verification.ok || !first.verification.ok) ({ analysis, verification } = repaired);
  }
  const citations = verification.citedEvidenceIds.slice(0, 40).map((id) => describeCitation(index.get(id)));
  const answer = verification.ok ? analysis.answerText.trim() : `${analysis.answerText.trim()}${unverifiedNotice(verification.failures, obligations)}`;
  diagnostics.blocks = analysis.blocks.map((block) => ({
    obligationId: block.obligationId, status: block.status, claims: block.claims.length, items: block.items.length,
  }));
  diagnostics.durationMs = Date.now() - startedAt;
  return {
    handled: true,
    response: {
      answer,
      responseType: "informational",
      components: [], operations: [], evidence: [], inferences: [],
      presentation: verification.ok
        ? { status: "completed", engine: "dossier" }
        : { status: "degraded", engine: "dossier", reasonCode: "DOSSIER_VERIFICATION_INCOMPLETE" },
      dossierCitations: citations,
      dossierSources: dossierSources(dossiers),
    },
    memory: {
      level: routed.route.focusLevel, focusOpportunityIds: focusIds,
      obligations: obligations.map((item) => ({ id: item.id, ask: item.ask.slice(0, 300) })),
      citedEvidenceIds: verification.citedEvidenceIds.slice(0, 60),
    },
    verification,
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
