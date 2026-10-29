import express from "express";
import { z } from "zod";
import { requireAnyPermission } from "./auth.js";
import { logAuditEvent } from "./audit.js";
import { renderSowOutput } from "./routes.proposal-documents.js";
import { loadProposalDocumentSource } from "./technical-scope/proposal-source.js";
import { resolveTechnicalScopeGate } from "./technical-scope/print-gate.js";
import { ensureTechnicalScopeSchema } from "./technical-scope/schema.js";
import { ensureTechnicalPlaybookSeeds } from "./technical-scope/playbooks.js";
import {
  TECHNICAL_PLAYBOOKS_MANAGE_PERMISSION,
  TECHNICAL_SCOPE_APPROVE_PERMISSION,
  TECHNICAL_SCOPE_UPDATE_PERMISSION,
} from "./technical-scope/permissions.js";
import { runCrmDiagnostic } from "./technical-scope/crm-diagnostic.js";
import { generatePlaybookDraft } from "./technical-scope/playbook-draft.js";
import { listDocumentacionRagTopicOptions } from "./documentacion-rag/service.js";
import {
  createPlaybook,
  getPlaybookByCode,
  listPlaybookVersions,
  isPlaybookVersionInUse,
  listPlaybooks,
  savePlaybookVersion,
  updatePlaybookMetadata,
} from "./technical-scope/playbooks.js";
import { sectionBlockSchema } from "./technical-scope/section-model.js";
import {
  analyzeDocuments,
  approveScope,
  confirmAnswers,
  discardScope,
  generateScope,
  getTechnicalScopeOverview,
  initializeScope,
  proposeTopology,
  returnToDraft,
  saveAnswers,
  saveTopology,
  submitForReview,
  updateItemRefs,
  updateSection,
  updateSelections,
  useExtractionAsAsIs,
  verifyScope,
} from "./technical-scope/scope-service.js";
import {
  approveSow,
  generateSow,
  getSow,
  returnSowToDraft,
  submitSowForReview,
  updateSowSection,
} from "./technical-scope/sow-service.js";
import { query } from "./db.js";

const router = express.Router();

const TECHNICAL_SCOPE_PATH =
  /^\/(technical-playbooks|proposal-documents\/v1\/proposal-documents\/[^/]+\/(technical-scope|sow))/;

// Only the module's own paths need the schema; other /api requests pass straight through.
router.use(async (req, _res, next) => {
  if (!TECHNICAL_SCOPE_PATH.test(req.path)) return next();
  try {
    await ensureTechnicalScopeSchema();
    await ensureTechnicalPlaybookSeeds();
    return next();
  } catch (error) {
    return next(error);
  }
});

const scopeAccessPermissions = Array.from(
  new Set([
    "propuestas.read",
    "propuestas.create",
    "propuestas.update",
    TECHNICAL_SCOPE_UPDATE_PERMISSION,
    TECHNICAL_SCOPE_APPROVE_PERMISSION,
  ]),
);

function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Datos invalidos",
          errors: error.flatten(),
        });
      }
      const status = Number(error?.status) || 500;
      if (status >= 500 && !error?.code?.startsWith?.("ai_")) {
        console.error(error);
        return res.status(500).json({ message: "No fue posible completar la operacion" });
      }
      const {
        message,
        verification,
        missingChecklist,
        reason,
        code,
      } = error;
      return res.status(status).json({
        message,
        ...(verification ? { verification } : {}),
        ...(missingChecklist ? { missingChecklist } : {}),
        ...(reason ? { reason } : {}),
        ...(code ? { code } : {}),
      });
    }
  };
}

// The proposal document in the shape the scope services expect.
async function loadProposal(req, res) {
  const documentId = Number(req.params.proposalDocumentId);
  if (!Number.isInteger(documentId) || documentId <= 0) {
    res.status(400).json({ message: "Propuesta invalida" });
    return null;
  }
  const proposal = await loadProposalDocumentSource({ documentId, user: req.user });
  if (!proposal) {
    res.status(404).json({ message: "Propuesta no encontrada" });
    return null;
  }
  return proposal;
}

function audit(req, action, proposal, detail, extra = {}) {
  return logAuditEvent({
    req,
    module: "propuestas",
    action,
    entityType: "proposal_technical_scope",
    entityId: proposal.id,
    detail,
    ...extra,
  }).catch(() => null);
}

const selectionSchema = z.object({
  code: z.string().trim().min(1).max(80),
  modules: z.array(z.string().trim().max(80)).max(30).optional().default([]),
});
const selectionsBodySchema = z.object({ selections: z.array(selectionSchema).max(10) });
const initBodySchema = z.object({ selections: z.array(selectionSchema).max(10).optional() });
const answersBodySchema = z.object({
  answers: z
    .array(
      z.object({
        playbookCode: z.string().trim().min(1).max(80),
        questionCode: z.string().trim().min(1).max(120),
        value: z.any(),
      }),
    )
    .max(200),
});
const confirmBodySchema = z.object({
  playbookCode: z.string().trim().min(1).max(80),
  questionCodes: z.array(z.string().trim().max(120)).max(200).optional().nullable(),
});
const analyzeBodySchema = z.object({
  documentPublicIds: z.array(z.string().trim().max(64)).max(20).optional().nullable(),
});
const generateBodySchema = z.object({
  codes: z.array(z.string().trim().max(60)).max(30).optional().nullable(),
  instructions: z.string().trim().max(1000).optional().default(""),
  useAi: z.boolean().optional().default(true),
  force: z.boolean().optional().default(false),
});
const sectionBodySchema = z
  .object({
    title: z.string().trim().min(1).max(180).optional(),
    blocks: z.array(sectionBlockSchema).max(60).optional(),
    content: z
      .object({ type: z.literal("doc"), content: z.array(z.any()).max(500).optional() })
      .passthrough()
      .optional(),
  })
  .refine((body) => body.blocks || body.content, { message: "Indica el contenido de la seccion" });
const itemRefsBodySchema = z.object({
  itemRefs: z.array(z.string().trim().max(120)).max(200),
});
const topologyBodySchema = z.object({
  topology: z.any(),
  kind: z.enum(["proposed", "asis"]).optional().default("proposed"),
});
const proposeTopologyBodySchema = z.object({ useAi: z.boolean().optional().default(true) });
const approveBodySchema = z.object({
  checklist: z.record(z.string(), z.boolean()).default({}),
  comment: z.string().trim().max(1000).optional().default(""),
});
const reasonBodySchema = z.object({ reason: z.string().trim().max(500).optional().default("") });

// ---- Playbooks (administration) ----

const playbookManage = requireAnyPermission([TECHNICAL_PLAYBOOKS_MANAGE_PERMISSION]);

router.get(
  "/technical-playbooks",
  playbookManage,
  handler(async (_req, res) => {
    res.json({ playbooks: await listPlaybooks({ includeArchived: true }) });
  }),
);

router.get(
  "/technical-playbooks/diagnostic",
  playbookManage,
  handler(async (_req, res) => {
    res.json({ diagnostic: await runCrmDiagnostic() });
  }),
);

router.get(
  "/technical-playbooks/rag-topics",
  playbookManage,
  handler(async (_req, res) => {
    const topics = await listDocumentacionRagTopicOptions();
    res.json({ topics: topics.map(({ name, description, documentCount }) => ({ name, description, documentCount })) });
  }),
);

router.get(
  "/technical-playbooks/:code",
  playbookManage,
  handler(async (req, res) => {
    const playbook = await getPlaybookByCode(req.params.code);
    if (!playbook) return res.status(404).json({ message: "Playbook no encontrado" });
    const [versions, suggestions] = await Promise.all([
      listPlaybookVersions(req.params.code),
      query(
        `SELECT s.id, s.kind, s.subject_code, s.detail_json, s.status, s.created_at
         FROM tech_playbook_suggestions s
         INNER JOIN tech_playbooks p ON p.id = s.playbook_id
         WHERE p.code = ? AND s.status = 'pending'
         ORDER BY s.created_at DESC
         LIMIT 100`,
        [req.params.code],
      ),
    ]);
    return res.json({
      playbook,
      currentVersionInUse: await isPlaybookVersionInUse(playbook.code, playbook.currentVersionNumber),
      versions,
      suggestions: suggestions.map((row) => ({
        id: Number(row.id),
        kind: row.kind,
        subjectCode: row.subject_code,
        detail: row.detail_json ? JSON.parse(row.detail_json) : null,
        createdAt: row.created_at,
      })),
    });
  }),
);

const playbookCreateSchema = z.object({
  code: z.string().trim().min(2).max(80).regex(/^[a-z0-9_]+$/),
  name: z.string().trim().min(2).max(180),
  manufacturer: z.string().trim().max(80).optional().default(""),
  ragTopicName: z.string().trim().max(160).optional().default(""),
  detectionKeywords: z.array(z.string().trim().max(120)).max(40).optional().default([]),
  content: z.any().optional(),
});

router.post(
  "/technical-playbooks",
  playbookManage,
  handler(async (req, res) => {
    const body = playbookCreateSchema.parse(req.body || {});
    const playbook = await createPlaybook({ ...body, userId: req.user.id });
    await logAuditEvent({ req, module: "propuestas", action: "crear_playbook", entityType: "tech_playbook", detail: body.code }).catch(() => null);
    res.status(201).json({ playbook });
  }),
);

const playbookSaveSchema = z.object({
  content: z.any(),
  status: z.enum(["borrador_ia", "validado", "archivado"]).optional(),
  notes: z.string().trim().max(1000).optional().default(""),
  overwriteCurrent: z.boolean().optional().default(false),
});

router.put(
  "/technical-playbooks/:code",
  playbookManage,
  handler(async (req, res) => {
    const body = playbookSaveSchema.parse(req.body || {});
    const playbook = await savePlaybookVersion({
      code: req.params.code,
      content: body.content,
      status: body.status,
      notes: body.notes,
      overwriteCurrent: body.overwriteCurrent,
      userId: req.user.id,
    });
    await logAuditEvent({ req, module: "propuestas", action: "editar_playbook", entityType: "tech_playbook", detail: req.params.code }).catch(() => null);
    res.json({ playbook, overwritten: playbook.overwritten });
  }),
);

const playbookMetadataSchema = z.object({
  name: z.string().trim().min(2).max(180).optional(),
  manufacturer: z.string().trim().max(80).optional(),
  ragTopicName: z.string().trim().max(160).optional(),
  detectionKeywords: z.array(z.string().trim().max(120)).max(40).optional(),
  status: z.enum(["borrador_ia", "validado", "archivado"]).optional(),
});

router.patch(
  "/technical-playbooks/:code",
  playbookManage,
  handler(async (req, res) => {
    const body = playbookMetadataSchema.parse(req.body || {});
    res.json({ playbook: await updatePlaybookMetadata(req.params.code, body) });
  }),
);

router.post(
  "/technical-playbooks/:code/generate-draft",
  playbookManage,
  handler(async (req, res) => {
    const body = z.object({ instructions: z.string().trim().max(1000).optional().default("") }).parse(req.body || {});
    const result = await generatePlaybookDraft({ playbookCode: req.params.code, userId: req.user.id, instructions: body.instructions });
    await logAuditEvent({ req, module: "propuestas", action: "generar_borrador_playbook", entityType: "tech_playbook", detail: req.params.code }).catch(() => null);
    res.json(result);
  }),
);

// ---- Technical scope of a proposal ----

const scopeAccess = requireAnyPermission(scopeAccessPermissions);
const base = "/proposal-documents/v1/proposal-documents/:proposalDocumentId/technical-scope";

router.get(
  base,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    res.json(await getTechnicalScopeOverview({ proposal, user: req.user }));
  }),
);

router.post(
  base,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    const body = initBodySchema.parse(req.body || {});
    await initializeScope({ proposal, user: req.user, selections: body.selections || null });
    await audit(req, "crear_alcance_tecnico", proposal, `Alcance técnico iniciado para la propuesta ${proposal.id}`);
    res.status(201).json(await getTechnicalScopeOverview({ proposal, user: req.user }));
  }),
);

router.put(
  `${base}/selections`,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    const body = selectionsBodySchema.parse(req.body || {});
    await updateSelections({ proposal, user: req.user, selections: body.selections });
    res.json(await getTechnicalScopeOverview({ proposal, user: req.user }));
  }),
);

router.delete(
  base,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    const result = await discardScope({ proposal, user: req.user });
    await audit(req, "descartar_alcance_tecnico", proposal, `Alcance técnico descartado (estado previo: ${result.previousStatus})`);
    res.json(result);
  }),
);

router.put(
  `${base}/answers`,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    const body = answersBodySchema.parse(req.body || {});
    await saveAnswers({ proposal, user: req.user, answers: body.answers });
    res.json(await getTechnicalScopeOverview({ proposal, user: req.user }));
  }),
);

router.post(
  `${base}/answers/confirm`,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    const body = confirmBodySchema.parse(req.body || {});
    await confirmAnswers({ proposal, user: req.user, ...body });
    res.json(await getTechnicalScopeOverview({ proposal, user: req.user }));
  }),
);

router.post(
  `${base}/analyze-documents`,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    const body = analyzeBodySchema.parse(req.body || {});
    const analysis = await analyzeDocuments({ proposal, user: req.user, documentPublicIds: body.documentPublicIds || null });
    await audit(req, "analizar_documentos_tecnicos", proposal, `Documentos técnicos analizados: ${analysis.documents.length}`);
    res.json({ analysis, overview: await getTechnicalScopeOverview({ proposal, user: req.user }) });
  }),
);

router.post(
  `${base}/extractions/:documentPublicId/use-as-asis`,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    await useExtractionAsAsIs({ proposal, user: req.user, documentPublicId: req.params.documentPublicId });
    res.json(await getTechnicalScopeOverview({ proposal, user: req.user }));
  }),
);

router.post(
  `${base}/generate`,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    const body = generateBodySchema.parse(req.body || {});
    const result = await generateScope({ proposal, user: req.user, ...body, codes: body.codes || null });
    await audit(req, "generar_alcance_tecnico", proposal, `Alcance técnico generado (IA: ${result.usedAi ? "sí" : "no"})`);
    res.json({ warnings: result.warnings, usedAi: result.usedAi, overview: await getTechnicalScopeOverview({ proposal, user: req.user }) });
  }),
);

router.put(
  `${base}/sections/:code`,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    const body = sectionBodySchema.parse(req.body || {});
    await updateSection({ proposal, user: req.user, code: req.params.code, ...body });
    res.json(await getTechnicalScopeOverview({ proposal, user: req.user }));
  }),
);

router.put(
  `${base}/sections/:code/item-refs`,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    const body = itemRefsBodySchema.parse(req.body || {});
    await updateItemRefs({ proposal, user: req.user, code: req.params.code, itemRefs: body.itemRefs });
    res.json(await getTechnicalScopeOverview({ proposal, user: req.user }));
  }),
);

router.put(
  `${base}/topology`,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    const body = topologyBodySchema.parse(req.body || {});
    await saveTopology({ proposal, user: req.user, topology: body.topology, kind: body.kind });
    res.json(await getTechnicalScopeOverview({ proposal, user: req.user }));
  }),
);

router.post(
  `${base}/topology/propose`,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    const body = proposeTopologyBodySchema.parse(req.body || {});
    res.json(await proposeTopology({ proposal, user: req.user, useAi: body.useAi }));
  }),
);

router.get(
  `${base}/verification`,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    res.json(await verifyScope({ proposal }));
  }),
);

// What the proposal editor needs to enable printing, emailing and finalizing, and to offer the SOW attachment.
router.get(
  `${base}/gate`,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    const gate = await resolveTechnicalScopeGate({ documentId: proposal.id });
    if (!gate.applies) return res.json({ applies: false, allowed: true, sowPrintable: false });
    const { sow } = await getSow({ proposal });
    res.json({
      applies: true,
      allowed: gate.allowed,
      reason: gate.reason || null,
      message: gate.message || "",
      status: gate.status,
      sowPrintable: Boolean(sow?.printable),
    });
  }),
);

router.post(
  `${base}/submit`,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    await submitForReview({ proposal, user: req.user });
    await audit(req, "enviar_alcance_tecnico_revision", proposal, "Alcance técnico enviado a revisión");
    res.json(await getTechnicalScopeOverview({ proposal, user: req.user }));
  }),
);

router.post(
  `${base}/approve`,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    const body = approveBodySchema.parse(req.body || {});
    const result = await approveScope({ proposal, user: req.user, ...body });
    await audit(
      req,
      "aprobar_alcance_tecnico",
      proposal,
      result.selfApproved ? "Alcance técnico aprobado por su propio autor" : "Alcance técnico aprobado",
      { after: { selfApproved: result.selfApproved, comment: body.comment } },
    );
    res.json({ selfApproved: result.selfApproved, overview: await getTechnicalScopeOverview({ proposal, user: req.user }) });
  }),
);

router.post(
  `${base}/return-to-draft`,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    const body = reasonBodySchema.parse(req.body || {});
    await returnToDraft({ proposal, user: req.user, reason: body.reason });
    await audit(req, "regresar_alcance_tecnico_borrador", proposal, body.reason || "Alcance técnico regresado a borrador");
    res.json(await getTechnicalScopeOverview({ proposal, user: req.user }));
  }),
);

// ---- SOW ----

const sowBase = "/proposal-documents/v1/proposal-documents/:proposalDocumentId/sow";

router.get(
  sowBase,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    const { sow } = await getSow({ proposal });
    res.json({ sow });
  }),
);

router.post(
  `${sowBase}/generate`,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    const body = z.object({ useAi: z.boolean().optional().default(true) }).parse(req.body || {});
    const result = await generateSow({ proposal, user: req.user, useAi: body.useAi });
    await audit(req, "generar_sow", proposal, "SOW generado");
    res.json({ sow: result.sow, warnings: result.warnings });
  }),
);

router.put(
  `${sowBase}/sections/:code`,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    const body = sectionBodySchema.parse(req.body || {});
    const { sow } = await updateSowSection({ proposal, user: req.user, code: req.params.code, ...body });
    res.json({ sow });
  }),
);

router.post(
  `${sowBase}/submit`,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    const { sow } = await submitSowForReview({ proposal, user: req.user });
    await audit(req, "enviar_sow_revision", proposal, "SOW enviado a revisión");
    res.json({ sow });
  }),
);

router.post(
  `${sowBase}/approve`,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    const body = approveBodySchema.parse(req.body || {});
    const result = await approveSow({ proposal, user: req.user, ...body });
    await audit(req, "aprobar_sow", proposal, result.selfApproved ? "SOW aprobado por su propio autor" : "SOW aprobado", {
      after: { selfApproved: result.selfApproved, comment: body.comment },
    });
    res.json({ sow: result.sow, selfApproved: result.selfApproved });
  }),
);

router.post(
  `${sowBase}/return-to-draft`,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    const body = reasonBodySchema.parse(req.body || {});
    const { sow } = await returnSowToDraft({ proposal, user: req.user, reason: body.reason });
    res.json({ sow });
  }),
);

router.post(
  `${sowBase}/pdf`,
  scopeAccess,
  handler(async (req, res) => {
    const proposal = await loadProposal(req, res);
    if (!proposal) return;
    const output = await renderSowOutput({ proposalDocumentId: proposal.id, user: req.user });
    if (!output.ok) return res.status(output.status).json(output.body);
    await audit(req, "generar_pdf_sow", proposal, `PDF del SOW generado: ${proposal.title}`);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(output.buffer.length));
    res.setHeader("Content-Disposition", `inline; filename="sow-${proposal.id}.pdf"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(output.buffer);
  }),
);

export default router;
