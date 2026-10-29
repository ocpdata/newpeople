import { query } from "../db.js";
import { hashContent, parseJsonSafe } from "./hash.js";
import { quotationVersionIdOf } from "./proposal-source.js";
import {
  TECHNICAL_PLAYBOOKS_MANAGE_PERMISSION,
  TECHNICAL_SCOPE_APPROVE_PERMISSION,
  TECHNICAL_SCOPE_UPDATE_PERMISSION,
} from "./permissions.js";
import {
  detectPlaybooksFromText,
  listPlaybooksWithContent,
} from "./playbooks.js";
import {
  ANSWER_STATUS,
  badRequest,
  buildProfileSnapshot,
  computeQuestionnaireCoverage,
  confirmSuggestedAnswers,
  listAnswers,
  questionsForSelection,
  saveManualAnswer,
} from "./profile.js";
import {
  SCOPE_STATUS,
  computeHashForScope,
  getScopeRowByDocumentId,
  serializeScopeRow,
} from "./scope-store.js";
import {
  TECHNICAL_SECTION_CATALOG,
  technicalSectionsSchema,
} from "./section-model.js";
import {
  analyzeOpportunityTechnicalDocuments,
  listTechnicalExtractions,
} from "./document-extraction.js";
import {
  generateTechnicalSections,
  loadQuotationItemsForScope,
  loadStageAnswersForScope,
} from "./generation.js";
import { generateTopologyProposal } from "./topology-generation.js";
import { normalizeSectionWrite } from "./tiptap.js";
import { verifyTechnicalScope } from "./verifier.js";
import { retrieveDocumentacionRagTopicEvidence } from "../documentacion-rag/service.js";
import {
  autoLayoutTopology,
  isTopologyEmpty,
  normalizeTopology,
} from "../../../../shared/topology.js";

export function httpError(status, message, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
}

export const APPROVAL_CHECKLIST_KEYS = ["assumptionsReviewed", "findingsResolved"];
export const APPROVAL_CHECKLIST_TOPOLOGY_KEY = "topologyReviewed";

async function getOpportunityPresalesUserId(opportunityId) {
  const rows = await query(
    `SELECT presales_user_id FROM opportunities WHERE id = ? LIMIT 1`,
    [Number(opportunityId)],
  );
  return rows[0]?.presales_user_id ? Number(rows[0].presales_user_id) : null;
}

export function getScopeCapabilities(user, presalesUserId) {
  const has = (permission) => Boolean(user?.permissionSet?.has(permission));
  const isPresales = presalesUserId && Number(user?.id) === Number(presalesUserId);
  const canApprove = has(TECHNICAL_SCOPE_APPROVE_PERMISSION) || Boolean(isPresales);
  return {
    canEdit: has(TECHNICAL_SCOPE_UPDATE_PERMISSION) || canApprove,
    canApprove,
    canManagePlaybooks: has(TECHNICAL_PLAYBOOKS_MANAGE_PERMISSION),
    isPresales: Boolean(isPresales),
  };
}

export async function assertScopeEditor(user, proposal) {
  const presalesUserId = await getOpportunityPresalesUserId(proposal.opportunity_id);
  const capabilities = getScopeCapabilities(user, presalesUserId);
  if (!capabilities.canEdit) throw httpError(403, "No autorizado para editar el alcance tecnico");
  return capabilities;
}

export async function recordScopeEvent({
  scopeId,
  eventCode,
  userId,
  detail = null,
  documentType = "scope",
}) {
  await query(
    `INSERT INTO proposal_technical_scope_events (scope_id, document_type, event_code, user_id, detail_json)
     VALUES (?, ?, ?, ?, ?)`,
    [
      Number(scopeId),
      documentType,
      eventCode,
      userId ? Number(userId) : null,
      detail ? JSON.stringify(detail) : null,
    ],
  );
}

function normalizeSelections(rawSelections, playbooks) {
  const result = [];
  const seen = new Set();
  for (const raw of Array.isArray(rawSelections) ? rawSelections : []) {
    const playbook = playbooks.find((entry) => entry.code === raw?.code);
    if (!playbook) throw badRequest(`Playbook inexistente: ${raw?.code}`);
    if (seen.has(playbook.code)) continue;
    seen.add(playbook.code);
    const moduleCodes = new Set(playbook.content.modules.map((module) => module.code));
    const modules = (Array.isArray(raw.modules) ? raw.modules : []).filter((code) => moduleCodes.has(code));
    result.push({
      code: playbook.code,
      versionNumber: playbook.currentVersionNumber,
      modules: playbook.content.modules.length === 1
        ? playbook.content.modules.map((module) => module.code)
        : modules,
    });
  }
  return result;
}

async function loadProposalSource(proposal) {
  const items = quotationVersionIdOf(proposal)
    ? await loadQuotationItemsForScope(quotationVersionIdOf(proposal))
    : [];
  const opportunityRows = await query(
    `SELECT o.id, o.name, oss.name AS sales_stage_name
     FROM opportunities o
     LEFT JOIN opportunity_sales_stages oss ON oss.id = o.sales_stage_id
     WHERE o.id = ? LIMIT 1`,
    [Number(proposal.opportunity_id)],
  );
  return { quotationItems: items, opportunity: opportunityRows[0] || null };
}

function detectionTextFor(proposal, quotationItems) {
  return [
    proposal.opportunity_name,
    proposal.title,
    proposal.template_code,
    ...quotationItems.flatMap((item) => [item.productCode, item.productDescription, item.groupTitle]),
  ]
    .filter(Boolean)
    .join(" ");
}

function answersHash(selections, answers) {
  const allowed = new Set(selections.map((selection) => selection.code));
  return hashContent(
    answers
      .filter((answer) => allowed.has(answer.playbookCode) && answer.status === ANSWER_STATUS.confirmed)
      .map((answer) => ({ p: answer.playbookCode, q: answer.questionCode, v: answer.value }))
      .sort((a, b) => `${a.p}:${a.q}`.localeCompare(`${b.p}:${b.q}`)),
  );
}

async function persistScope(scopeId, patch) {
  const columns = {
    status: "status",
    playbookCodes: "playbook_codes_json",
    snapshot: "profile_snapshot_json",
    sections: "sections_json",
    topology: "topology_json",
    asisTopology: "asis_topology_json",
    contentHash: "content_hash",
    approvedHash: "approved_hash",
    requestedByUserId: "requested_by_user_id",
    requestedAt: "requested_at",
    approvedByUserId: "approved_by_user_id",
    approvedAt: "approved_at",
    approvalChecklist: "approval_checklist_json",
    approvalComment: "approval_comment",
    selfApproved: "self_approved",
    lastEditedByUserId: "last_edited_by_user_id",
    quotationVersionId: "quotation_version_id",
  };
  const jsonColumns = new Set(["playbookCodes", "snapshot", "sections", "topology", "asisTopology", "approvalChecklist"]);
  const sets = [];
  const params = [];
  for (const [key, value] of Object.entries(patch)) {
    if (!columns[key]) continue;
    sets.push(`${columns[key]} = ?`);
    params.push(jsonColumns.has(key) && value !== null ? JSON.stringify(value) : value);
  }
  if (!sets.length) return;
  sets.push("updated_at = NOW(3)");
  params.push(Number(scopeId));
  await query(`UPDATE proposal_technical_scopes SET ${sets.join(", ")} WHERE id = ?`, params);
}

async function reloadScope(proposalId) {
  return serializeScopeRow(await getScopeRowByDocumentId(proposalId));
}

// Any change to the content invalidates a previous approval and refreshes the stored hash.
async function saveContentChange({ scope, user, patch }) {
  const next = { ...scope, ...patch };
  await persistScope(scope.id, {
    ...patch,
    status: SCOPE_STATUS.draft,
    approvedHash: null,
    approvedByUserId: null,
    approvedAt: null,
    approvalChecklist: null,
    approvalComment: null,
    selfApproved: 0,
    lastEditedByUserId: user.id,
    contentHash: computeHashForScope(next, next.quotationVersionId),
  });
  if (scope.status === SCOPE_STATUS.approved) {
    await recordScopeEvent({ scopeId: scope.id, eventCode: "approval_invalidated", userId: user.id });
  }
  return reloadScope(scope.proposalDocumentId);
}

export async function requireScope(proposal) {
  const scope = await reloadScope(proposal.id);
  if (!scope) throw httpError(404, "La propuesta aun no tiene alcance tecnico");
  return scope;
}

export async function initializeScope({ proposal, user, selections = null }) {
  await assertScopeEditor(user, proposal);
  const existing = await reloadScope(proposal.id);
  if (existing) return existing;

  const playbooks = await listPlaybooksWithContent();
  const { quotationItems } = await loadProposalSource(proposal);
  const chosen = selections
    ? normalizeSelections(selections, playbooks)
    : normalizeSelections(
        detectPlaybooksFromText(playbooks, detectionTextFor(proposal, quotationItems)).map((match) => ({
          code: match.code,
          modules: match.modules,
        })),
        playbooks,
      );

  const result = await query(
    `INSERT INTO proposal_technical_scopes
       (proposal_document_id, opportunity_id, quotation_version_id, status, playbook_codes_json, sections_json, created_by_user_id, last_edited_by_user_id)
     VALUES (?, ?, ?, 'draft', ?, '[]', ?, ?)`,
    [
      Number(proposal.id),
      Number(proposal.opportunity_id),
      quotationVersionIdOf(proposal),
      JSON.stringify(chosen),
      Number(user.id),
      Number(user.id),
    ],
  );
  await recordScopeEvent({ scopeId: result.insertId, eventCode: "created", userId: user.id, detail: { playbooks: chosen.map((entry) => entry.code) } });
  return reloadScope(proposal.id);
}

export async function updateSelections({ proposal, user, selections }) {
  await assertScopeEditor(user, proposal);
  const scope = await requireScope(proposal);
  const playbooks = await listPlaybooksWithContent();
  const chosen = normalizeSelections(selections, playbooks);
  return saveContentChange({ scope, user, patch: { playbookCodes: chosen } });
}

export async function discardScope({ proposal, user }) {
  await assertScopeEditor(user, proposal);
  const scope = await requireScope(proposal);
  await query(`DELETE FROM proposal_technical_scopes WHERE id = ?`, [scope.id]);
  return { discarded: true, previousStatus: scope.status };
}

export async function saveAnswers({ proposal, user, answers }) {
  await assertScopeEditor(user, proposal);
  const scope = await requireScope(proposal);
  const playbooks = await listPlaybooksWithContent();
  const saved = [];
  for (const entry of Array.isArray(answers) ? answers : []) {
    const selection = scope.playbookCodes.find((item) => item.code === entry.playbookCode);
    if (!selection) throw badRequest(`El playbook ${entry.playbookCode} no esta seleccionado`);
    const playbook = playbooks.find((item) => item.code === entry.playbookCode);
    const question = questionsForSelection(playbook, selection.modules).find(
      (candidate) => candidate.code === entry.questionCode,
    );
    if (!question) throw badRequest(`Pregunta inexistente: ${entry.questionCode}`);
    saved.push(
      await saveManualAnswer({
        opportunityId: proposal.opportunity_id,
        playbookCode: entry.playbookCode,
        question,
        value: entry.value,
        userId: user.id,
        proposalDocumentId: proposal.id,
      }),
    );
  }
  return saved;
}

export async function confirmAnswers({ proposal, user, playbookCode, questionCodes = null }) {
  await assertScopeEditor(user, proposal);
  const scope = await requireScope(proposal);
  if (!scope.playbookCodes.some((item) => item.code === playbookCode)) {
    throw badRequest(`El playbook ${playbookCode} no esta seleccionado`);
  }
  return confirmSuggestedAnswers({
    opportunityId: proposal.opportunity_id,
    playbookCode,
    questionCodes,
    userId: user.id,
  });
}

export async function analyzeDocuments({ proposal, user, documentPublicIds = null }) {
  await assertScopeEditor(user, proposal);
  const scope = await requireScope(proposal);
  const playbooks = await listPlaybooksWithContent();
  return analyzeOpportunityTechnicalDocuments({
    opportunityId: proposal.opportunity_id,
    selections: scope.playbookCodes,
    playbooks,
    documentPublicIds,
    userId: user.id,
  });
}

export async function useExtractionAsAsIs({ proposal, user, documentPublicId }) {
  await assertScopeEditor(user, proposal);
  const scope = await requireScope(proposal);
  const extractions = await listTechnicalExtractions(proposal.opportunity_id);
  const extraction = extractions.find((entry) => entry.documentPublicId === documentPublicId);
  if (!extraction?.topology) throw httpError(404, "El documento no tiene una topologia extraida");
  return saveContentChange({
    scope,
    user,
    patch: { asisTopology: autoLayoutTopology(extraction.topology) },
  });
}

async function buildSnapshotForScope(scope, playbooks) {
  const answers = await listAnswers(scope.opportunityId, scope.playbookCodes.map((item) => item.code));
  const withVersions = scope.playbookCodes.map((selection) => ({
    ...selection,
    versionNumber:
      playbooks.find((entry) => entry.code === selection.code)?.currentVersionNumber ||
      selection.versionNumber,
  }));
  return {
    answers,
    snapshot: buildProfileSnapshot({ selections: withVersions, playbooks, answers }),
  };
}

async function gatherKnowledge({ selections, playbooks, userId }) {
  const snippets = [];
  for (const selection of selections) {
    const playbook = playbooks.find((entry) => entry.code === selection.code);
    if (!playbook?.ragTopicName) continue;
    const moduleNames = playbook.content.modules
      .filter((module) => selection.modules.includes(module.code))
      .map((module) => module.name)
      .join(", ");
    try {
      const result = await retrieveDocumentacionRagTopicEvidence({
        topicName: playbook.ragTopicName,
        prompt: `${playbook.name} ${moduleNames}: requisitos, prerrequisitos, arquitectura, dimensionamiento y limites`,
        topK: 6,
        userId,
      });
      snippets.push(...result.snippets.slice(0, 6));
    } catch {
      // Knowledge is a complement; generation continues from the playbook and the answers.
    }
  }
  return snippets;
}

export async function generateScope({ proposal, user, codes = null, instructions = "", useAi = true, force = false }) {
  await assertScopeEditor(user, proposal);
  const scope = await requireScope(proposal);
  if (!scope.playbookCodes.length) throw badRequest("Selecciona al menos un playbook antes de generar");
  const playbooks = await listPlaybooksWithContent();
  const { snapshot } = await buildSnapshotForScope(scope, playbooks);
  const { quotationItems, opportunity } = await loadProposalSource(proposal);
  const [stageAnswers, extractions] = await Promise.all([
    loadStageAnswersForScope(proposal.opportunity_id),
    listTechnicalExtractions(proposal.opportunity_id),
  ]);
  const knowledge = await gatherKnowledge({ selections: scope.playbookCodes, playbooks, userId: user.id });

  const result = await generateTechnicalSections({
    codes,
    instructions,
    userId: user.id,
    useAi,
    proposal,
    opportunity,
    selections: scope.playbookCodes,
    playbooks,
    snapshot,
    quotationItems,
    stageAnswers,
    extractions: extractions.filter((entry) => entry.status === "completed"),
    knowledge,
    asisTopology: scope.asisTopology,
  });

  const byCode = new Map(scope.sections.map((section) => [section.code, section]));
  const protectedCodes = [];
  for (const generated of result.sections) {
    const current = byCode.get(generated.code);
    if (current?.edited && !force && !codes) {
      protectedCodes.push(generated.code);
      continue;
    }
    byCode.set(generated.code, normalizeSectionWrite({ ...generated, content: null }));
  }
  const ordered = TECHNICAL_SECTION_CATALOG.map((definition) => byCode.get(definition.code)).filter(Boolean);
  const warnings = [...result.warnings];
  if (!quotationItems.length) {
    warnings.push("La propuesta no tiene partidas de cotizacion: el alcance se basa en el cuestionario y no se verifica contra la cotizacion.");
  }
  if (protectedCodes.length) {
    warnings.push(`Se conservaron las secciones editadas manualmente: ${protectedCodes.join(", ")}.`);
  }

  const updated = await saveContentChange({
    scope,
    user,
    patch: { sections: ordered, snapshot, quotationVersionId: quotationVersionIdOf(proposal) },
  });
  await recordScopeEvent({ scopeId: scope.id, eventCode: "generated", userId: user.id, detail: { codes, usedAi: result.usedAi } });
  return { scope: updated, warnings, usedAi: result.usedAi };
}

export async function updateSection({ proposal, user, code, title, blocks, content }) {
  await assertScopeEditor(user, proposal);
  const scope = await requireScope(proposal);
  const current = scope.sections.find((section) => section.code === code);
  const definition = TECHNICAL_SECTION_CATALOG.find((entry) => entry.code === code);
  if (!current && !definition) throw httpError(404, "Seccion inexistente");
  const next = normalizeSectionWrite({
    code,
    title: title || current?.title || definition.title,
    ...(content ? { content, blocks: current?.blocks || [] } : { blocks, content: null }),
    itemRefs: current?.itemRefs || [],
    sources: current?.sources || [],
    edited: true,
    generatedAt: current?.generatedAt || null,
  });
  const sections = technicalSectionsSchema.parse(
    TECHNICAL_SECTION_CATALOG.map((entry) =>
      entry.code === code ? next : scope.sections.find((section) => section.code === entry.code),
    ).filter(Boolean),
  );
  return saveContentChange({ scope, user, patch: { sections } });
}

export async function updateItemRefs({ proposal, user, code, itemRefs }) {
  await assertScopeEditor(user, proposal);
  const scope = await requireScope(proposal);
  const sections = scope.sections.map((section) =>
    section.code === code ? { ...section, itemRefs, edited: true } : section,
  );
  return saveContentChange({ scope, user, patch: { sections } });
}

export async function saveTopology({ proposal, user, topology, kind = "proposed" }) {
  await assertScopeEditor(user, proposal);
  const scope = await requireScope(proposal);
  const normalized = autoLayoutTopology(normalizeTopology(topology));
  return saveContentChange({
    scope,
    user,
    patch: kind === "asis" ? { asisTopology: isTopologyEmpty(normalized) ? null : normalized } : { topology: isTopologyEmpty(normalized) ? null : normalized },
  });
}

export async function proposeTopology({ proposal, user, useAi = true }) {
  await assertScopeEditor(user, proposal);
  const scope = await requireScope(proposal);
  const playbooks = await listPlaybooksWithContent();
  const { snapshot } = await buildSnapshotForScope(scope, playbooks);
  const { quotationItems } = await loadProposalSource(proposal);
  return generateTopologyProposal({
    selections: scope.playbookCodes,
    playbooks,
    snapshot,
    quotationItems,
    currentTopology: scope.topology,
    asisTopology: scope.asisTopology,
    userId: user.id,
    useAi,
  });
}

export async function verifyScope({ proposal }) {
  const scope = await requireScope(proposal);
  const playbooks = await listPlaybooksWithContent();
  const { quotationItems } = await loadProposalSource(proposal);
  return verifyTechnicalScope({
    sections: scope.sections,
    topology: scope.topology,
    snapshot: scope.snapshot,
    selections: scope.playbookCodes,
    playbooks,
    quotationItems,
  });
}

export async function submitForReview({ proposal, user }) {
  await assertScopeEditor(user, proposal);
  const scope = await requireScope(proposal);
  if (!scope.sections.length) throw badRequest("Genera el alcance tecnico antes de enviarlo a revision");
  const playbooks = await listPlaybooksWithContent();
  const { snapshot } = await buildSnapshotForScope(scope, playbooks);
  const next = { ...scope, snapshot, quotationVersionId: quotationVersionIdOf(proposal) };
  await persistScope(scope.id, {
    status: SCOPE_STATUS.inReview,
    snapshot,
    quotationVersionId: quotationVersionIdOf(proposal),
    contentHash: computeHashForScope(next, next.quotationVersionId),
    requestedByUserId: user.id,
    requestedAt: new Date(),
    approvedHash: null,
    approvedByUserId: null,
    approvedAt: null,
    approvalChecklist: null,
    approvalComment: null,
    selfApproved: 0,
  });
  await recordScopeEvent({ scopeId: scope.id, eventCode: "submitted", userId: user.id });
  return reloadScope(proposal.id);
}

export async function returnToDraft({ proposal, user, reason = "" }) {
  const presalesUserId = await getOpportunityPresalesUserId(proposal.opportunity_id);
  const capabilities = getScopeCapabilities(user, presalesUserId);
  if (!capabilities.canEdit) throw httpError(403, "No autorizado");
  const scope = await requireScope(proposal);
  await persistScope(scope.id, {
    status: SCOPE_STATUS.draft,
    approvedHash: null,
    approvedByUserId: null,
    approvedAt: null,
    approvalChecklist: null,
    approvalComment: null,
    selfApproved: 0,
  });
  await recordScopeEvent({ scopeId: scope.id, eventCode: "returned_to_draft", userId: user.id, detail: { reason } });
  return reloadScope(proposal.id);
}

// Approval is bound to the hash of the frozen content; the same person may submit and approve.
export async function approveScope({ proposal, user, checklist = {}, comment = "" }) {
  const presalesUserId = await getOpportunityPresalesUserId(proposal.opportunity_id);
  const capabilities = getScopeCapabilities(user, presalesUserId);
  if (!capabilities.canApprove) throw httpError(403, "Solo el preventa asignado o un usuario con permiso puede aprobar el alcance tecnico");
  const scope = await requireScope(proposal);
  if (scope.status !== SCOPE_STATUS.inReview) {
    throw httpError(409, "El alcance tecnico debe estar en revision para aprobarse");
  }
  if (quotationVersionIdOf(proposal) !== scope.quotationVersionId) {
    throw httpError(409, "La version de cotizacion cambio; envia el alcance nuevamente a revision");
  }

  const required = [...APPROVAL_CHECKLIST_KEYS, ...(isTopologyEmpty(scope.topology) ? [] : [APPROVAL_CHECKLIST_TOPOLOGY_KEY])];
  const missing = required.filter((key) => checklist[key] !== true);
  if (missing.length) {
    throw httpError(400, "Completa la lista de verificacion para aprobar", { missingChecklist: missing });
  }

  const verification = await verifyScope({ proposal });
  if (verification.blocking > 0) {
    throw httpError(409, "Hay hallazgos bloqueantes sin resolver", { verification });
  }

  const hash = computeHashForScope(scope, scope.quotationVersionId);
  const selfApproved = [scope.requestedByUserId, scope.lastEditedByUserId].filter(Boolean).includes(Number(user.id));
  await persistScope(scope.id, {
    status: SCOPE_STATUS.approved,
    contentHash: hash,
    approvedHash: hash,
    approvedByUserId: user.id,
    approvedAt: new Date(),
    approvalChecklist: checklist,
    approvalComment: String(comment || "").slice(0, 1000),
    selfApproved: selfApproved ? 1 : 0,
  });
  await recordScopeEvent({
    scopeId: scope.id,
    eventCode: "approved",
    userId: user.id,
    detail: { selfApproved, warnings: verification.warnings },
  });
  return { scope: await reloadScope(proposal.id), selfApproved, verification };
}

export async function getTechnicalScopeOverview({ proposal, user }) {
  const presalesUserId = await getOpportunityPresalesUserId(proposal.opportunity_id);
  const capabilities = getScopeCapabilities(user, presalesUserId);
  const playbooks = await listPlaybooksWithContent();
  const scope = await reloadScope(proposal.id);
  const { quotationItems } = await loadProposalSource(proposal);
  const catalog = playbooks.map((playbook) => ({
    code: playbook.code,
    name: playbook.name,
    manufacturer: playbook.manufacturer,
    status: playbook.status,
    ragTopicName: playbook.ragTopicName,
    modules: playbook.content.modules.map(({ code, name, description }) => ({ code, name, description })),
  }));
  const base = {
    capabilities,
    catalog,
    sectionCatalog: TECHNICAL_SECTION_CATALOG.map(({ code, title }) => ({ code, title })),
    suggestedPlaybooks: detectPlaybooksFromText(playbooks, detectionTextFor(proposal, quotationItems)),
    quotationItems,
  };
  if (!scope) return { ...base, scope: null };

  const answers = await listAnswers(scope.opportunityId, scope.playbookCodes.map((item) => item.code));
  const answerByKey = new Map(answers.map((answer) => [`${answer.playbookCode}:${answer.questionCode}`, answer]));
  const questions = scope.playbookCodes.flatMap((selection) => {
    const playbook = playbooks.find((entry) => entry.code === selection.code);
    return questionsForSelection(playbook, selection.modules).map((question) => {
      const answer = answerByKey.get(`${selection.code}:${question.code}`);
      return {
        playbookCode: selection.code,
        ...question,
        answer: answer
          ? {
              value: answer.value,
              status: answer.status,
              sourceType: answer.sourceType,
              sourceRef: answer.sourceRef,
              confidence: answer.confidence,
            }
          : null,
      };
    });
  });
  const coverage = computeQuestionnaireCoverage({ selections: scope.playbookCodes, playbooks, answers });
  const verification = scope.sections.length
    ? verifyTechnicalScope({
        sections: scope.sections,
        topology: scope.topology,
        snapshot: scope.snapshot,
        selections: scope.playbookCodes,
        playbooks,
        quotationItems,
      })
    : null;
  const extractions = await listTechnicalExtractions(scope.opportunityId);
  const currentHash = computeHashForScope(scope, scope.quotationVersionId);
  const snapshotAnswersHash = hashContent(
    (scope.snapshot?.answers || [])
      .map((answer) => ({ p: answer.playbookCode, q: answer.questionCode, v: answer.value }))
      .sort((a, b) => `${a.p}:${a.q}`.localeCompare(`${b.p}:${b.q}`)),
  );

  return {
    ...base,
    scope: {
      ...scope,
      snapshot: undefined,
      snapshotCapturedAt: scope.snapshot?.capturedAt || null,
      printable:
        scope.status === SCOPE_STATUS.approved &&
        scope.approvedHash === currentHash &&
        scope.quotationVersionId === quotationVersionIdOf(proposal),
    },
    stale: {
      quotationChanged: scope.quotationVersionId !== quotationVersionIdOf(proposal),
      answersChanged:
        Boolean(scope.snapshot) && answersHash(scope.playbookCodes, answers) !== snapshotAnswersHash,
    },
    questions,
    coverage,
    verification,
    extractions,
  };
}
