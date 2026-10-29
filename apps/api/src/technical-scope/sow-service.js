import { z } from "zod";
import { query } from "../db.js";
import { TECHNICAL_SCOPE_AI_FEATURES, requestAiJson } from "./ai.js";
import { hashContent, parseJsonSafe } from "./hash.js";
import { badRequest } from "./profile.js";
import {
  assertScopeEditor,
  getScopeCapabilities,
  httpError,
  recordScopeEvent,
  requireScope,
} from "./scope-service.js";
import { quotationVersionIdOf } from "./proposal-source.js";
import { SCOPE_STATUS, computeHashForScope } from "./scope-store.js";
import { sectionBlockSchema, technicalSectionsSchema } from "./section-model.js";
import {
  buildTopologyNodes,
  ensureSectionContent,
  normalizeSectionWrite,
  sectionToProposalSection,
  withSectionContent,
} from "./tiptap.js";

export const SOW_SECTION_CATALOG = [
  { code: "sow_objective", title: "Objetivo y antecedentes" },
  { code: "sow_scope", title: "Alcance de los trabajos" },
  { code: "sow_exclusions", title: "Exclusiones" },
  { code: "sow_architecture", title: "Arquitectura y topología" },
  { code: "sow_deliverables", title: "Entregables" },
  { code: "sow_activities", title: "Actividades y cronograma" },
  { code: "sow_roles", title: "Roles y responsabilidades" },
  { code: "sow_assumptions", title: "Supuestos y dependencias" },
  { code: "sow_acceptance", title: "Criterios de aceptación" },
  { code: "sow_change_control", title: "Gestión de cambios" },
  { code: "sow_support", title: "Soporte y garantía" },
  { code: "sow_commercial", title: "Condiciones comerciales" },
];

export const SOW_CHECKLIST_KEYS = ["contentReviewed"];

const SOW_FROM_SCOPE = {
  sow_scope: "scope_included",
  sow_exclusions: "scope_excluded",
  sow_architecture: "architecture",
  sow_deliverables: "deliverables",
  sow_activities: "phases",
  sow_assumptions: "assumptions",
  sow_acceptance: "acceptance",
};

const sowObjectiveSchema = z.object({
  blocks: z.array(sectionBlockSchema).max(6).default([]),
});

const SOW_OBJECTIVE_PROMPT =
  "Redactas la seccion 'Objetivo y antecedentes' de un SOW (alcance de trabajo) en espanol, con tono contractual claro. Responde exclusivamente con JSON valido: {\"blocks\": [{\"type\": \"paragraph|list\", \"text\": string, \"items\": [string]}]}. Usa SOLO la evidencia del contexto. No inventes cifras, fechas ni compromisos. No incluyas precios, costos ni informacion comercial interna. Maximo tres parrafos y una lista opcional de objetivos.";

function paragraph(text) {
  return { type: "paragraph", text, items: [], table: null };
}
function list(items) {
  return { type: "list", text: "", items, table: null };
}

async function loadCommercialTerms(quotationVersionId) {
  const rows = await query(
    `SELECT delivery_time, quotation_validity, warranty_term, payment_terms
     FROM quotation_versions WHERE id = ? LIMIT 1`,
    [Number(quotationVersionId)],
  );
  return rows[0] || {};
}

function serializeSowRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    scopeId: Number(row.scope_id),
    proposalDocumentId: Number(row.proposal_document_id),
    status: row.status,
    sections: (parseJsonSafe(row.sections_json, []) || []).map(withSectionContent),
    baseScopeHash: row.base_scope_hash || null,
    contentHash: row.content_hash || null,
    approvedHash: row.approved_hash || null,
    approvedByUserId: row.approved_by_user_id ? Number(row.approved_by_user_id) : null,
    approvedAt: row.approved_at || null,
    approvalChecklist: parseJsonSafe(row.approval_checklist_json, null),
    approvalComment: row.approval_comment || "",
    selfApproved: Boolean(row.self_approved),
    lastEditedByUserId: row.last_edited_by_user_id ? Number(row.last_edited_by_user_id) : null,
    updatedAt: row.updated_at,
  };
}

export async function getSowRow(proposalDocumentId) {
  const rows = await query(
    `SELECT * FROM proposal_sow_documents WHERE proposal_document_id = ? LIMIT 1`,
    [Number(proposalDocumentId)],
  );
  return rows[0] || null;
}

export function computeSowHash(sections, baseScopeHash) {
  return hashContent({
    sections: (sections || []).map((section) => ({
      code: section.code,
      title: section.title,
      content: ensureSectionContent(section),
    })),
    baseScopeHash: baseScopeHash || null,
  });
}

function scopeHashNow(scope) {
  return computeHashForScope(scope, scope.quotationVersionId);
}

// Deterministic SOW derived from the technical scope; contractual and commercial terms come from data, not from AI.
export function buildSowSections({ scope, proposal, terms }) {
  const scopeSection = (code) => scope.sections.find((section) => section.code === code);
  const copy = (sowCode, title) => {
    const source = scopeSection(SOW_FROM_SCOPE[sowCode]);
    return {
      code: sowCode,
      title,
      blocks: source ? source.blocks : [],
      itemRefs: source?.itemRefs || [],
      sources: source?.sources || [],
      edited: false,
      generatedAt: new Date().toISOString(),
    };
  };

  const phases = scopeSection("phases")?.blocks.find((block) => block.type === "table")?.table?.rows || [];
  const rolesRows = phases.length
    ? phases.map(([name]) => {
        const approves = /dise|prueba|cierre|transferencia/i.test(name);
        return [name, "Responsable de la ejecución (R)", approves ? "Aprueba (A) y participa (C)" : "Consultado (C)"];
      })
    : [["Proyecto", "Responsable de la ejecución (R)", "Aprueba (A) y participa (C)"]];

  const requirements = scopeSection("requirements");
  const objectiveBlocks = [
    paragraph(
      `Este documento define el alcance de los trabajos del proyecto "${proposal.title}" para ${proposal.account_name || "el cliente"}, conforme a la propuesta técnica y comercial vigente.`,
    ),
    ...(requirements?.blocks?.length ? requirements.blocks : []),
  ];

  const commercialItems = [
    terms.delivery_time ? `Tiempo de entrega: ${terms.delivery_time}` : null,
    terms.payment_terms ? `Condiciones de pago: ${terms.payment_terms}` : null,
    terms.quotation_validity ? `Vigencia de la cotización: ${terms.quotation_validity}` : null,
  ].filter(Boolean);

  const supportBlocks = [
    ...(scopeSection("support_sla")?.blocks || []),
    ...(terms.warranty_term ? [list([`Garantía: ${terms.warranty_term}`])] : []),
  ];

  const sections = [
    { code: "sow_objective", title: "Objetivo y antecedentes", blocks: objectiveBlocks, itemRefs: [], sources: [], edited: false, generatedAt: new Date().toISOString() },
    copy("sow_scope", "Alcance de los trabajos"),
    copy("sow_exclusions", "Exclusiones"),
    copy("sow_architecture", "Arquitectura y topología"),
    copy("sow_deliverables", "Entregables"),
    copy("sow_activities", "Actividades y cronograma"),
    {
      code: "sow_roles",
      title: "Roles y responsabilidades",
      blocks: [
        { type: "table", text: "", items: [], table: { headers: ["Fase", "Proveedor", "Cliente"], rows: rolesRows } },
      ],
      itemRefs: [],
      sources: [],
      edited: false,
      generatedAt: new Date().toISOString(),
    },
    copy("sow_assumptions", "Supuestos y dependencias"),
    copy("sow_acceptance", "Criterios de aceptación"),
    {
      code: "sow_change_control",
      title: "Gestión de cambios",
      blocks: [
        paragraph(
          "Cualquier cambio al alcance descrito se gestionará mediante una solicitud de cambio por escrito. Cada solicitud se evaluará por su impacto en tiempo, recursos y costo, y deberá ser aprobada por ambas partes antes de ejecutarse.",
        ),
      ],
      itemRefs: [],
      sources: [],
      edited: false,
      generatedAt: new Date().toISOString(),
    },
    { code: "sow_support", title: "Soporte y garantía", blocks: supportBlocks, itemRefs: [], sources: [], edited: false, generatedAt: new Date().toISOString() },
    {
      code: "sow_commercial",
      title: "Condiciones comerciales",
      blocks: commercialItems.length
        ? [paragraph("Las condiciones comerciales se rigen por la cotización aprobada."), list(commercialItems)]
        : [paragraph("Las condiciones comerciales se rigen por la cotización aprobada.")],
      itemRefs: [],
      sources: [],
      edited: false,
      generatedAt: new Date().toISOString(),
    },
  ];
  return sections;
}

async function personalizeObjective({ scope, proposal, userId }) {
  const requirements = scope.sections.find((section) => section.code === "requirements");
  const result = await requestAiJson({
    featureCode: TECHNICAL_SCOPE_AI_FEATURES.sow,
    role: "fast",
    system: SOW_OBJECTIVE_PROMPT,
    user: {
      proposalTitle: proposal.title,
      accountName: proposal.account_name,
      opportunityName: proposal.opportunity_name,
      requirements: requirements?.blocks || [],
      solutionSummary: scope.sections.find((section) => section.code === "architecture")?.blocks || [],
    },
    schema: sowObjectiveSchema,
    userId,
  });
  return result.blocks.filter((block) => block.text || block.items.length);
}

export async function getSow({ proposal }) {
  const scope = await requireScope(proposal).catch(() => null);
  if (!scope) return { scope: null, sow: null };
  const sow = serializeSowRow(await getSowRow(proposal.id));
  if (!sow) return { scope, sow: null };
  const currentScopeHash = scopeHashNow(scope);
  const scopeApproved =
    scope.status === SCOPE_STATUS.approved &&
    scope.approvedHash === currentScopeHash &&
    scope.quotationVersionId === quotationVersionIdOf(proposal);
  return {
    scope,
    sow: {
      ...sow,
      stale: sow.baseScopeHash !== currentScopeHash,
      scopeApproved,
      printable:
        sow.status === SCOPE_STATUS.approved &&
        sow.approvedHash === computeSowHash(sow.sections, sow.baseScopeHash) &&
        sow.baseScopeHash === currentScopeHash &&
        scopeApproved,
    },
  };
}

async function saveSow({ sowId, sections, baseScopeHash, user, resetApproval = true, status = null }) {
  const sets = ["sections_json = ?", "base_scope_hash = ?", "content_hash = ?", "last_edited_by_user_id = ?", "updated_at = NOW(3)"];
  const params = [
    JSON.stringify(sections),
    baseScopeHash,
    computeSowHash(sections, baseScopeHash),
    Number(user.id),
  ];
  if (resetApproval) {
    sets.push("status = ?", "approved_hash = NULL", "approved_by_user_id = NULL", "approved_at = NULL", "approval_checklist_json = NULL", "approval_comment = NULL", "self_approved = 0");
    params.push(status || SCOPE_STATUS.draft);
  }
  params.push(Number(sowId));
  await query(`UPDATE proposal_sow_documents SET ${sets.join(", ")} WHERE id = ?`, params);
}

export async function generateSow({ proposal, user, useAi = true }) {
  await assertScopeEditor(user, proposal);
  const scope = await requireScope(proposal);
  if (!scope.sections.length) throw badRequest("Genera el alcance tecnico antes del SOW");
  const terms = await loadCommercialTerms(scope.quotationVersionId);
  const sections = buildSowSections({ scope, proposal, terms });
  const warnings = [];
  if (useAi) {
    try {
      const blocks = await personalizeObjective({ scope, proposal, userId: user.id });
      if (blocks.length) {
        const objective = sections.find((section) => section.code === "sow_objective");
        objective.blocks = blocks;
      }
    } catch (error) {
      warnings.push(`No fue posible personalizar el objetivo con IA (${error?.message || "error"}); se uso el texto base.`);
    }
  }
  const validated = technicalSectionsSchema.parse(sections);
  const baseScopeHash = scopeHashNow(scope);
  const existing = await getSowRow(proposal.id);
  if (existing) {
    await saveSow({ sowId: existing.id, sections: validated, baseScopeHash, user });
  } else {
    await query(
      `INSERT INTO proposal_sow_documents (scope_id, proposal_document_id, status, sections_json, base_scope_hash, content_hash, last_edited_by_user_id)
       VALUES (?, ?, 'draft', ?, ?, ?, ?)`,
      [
        scope.id,
        Number(proposal.id),
        JSON.stringify(validated),
        baseScopeHash,
        computeSowHash(validated, baseScopeHash),
        Number(user.id),
      ],
    );
  }
  await recordScopeEvent({ scopeId: scope.id, eventCode: "generated", userId: user.id, documentType: "sow" });
  return { ...(await getSow({ proposal })), warnings };
}

export async function updateSowSection({ proposal, user, code, title, blocks, content }) {
  await assertScopeEditor(user, proposal);
  const { scope, sow } = await getSow({ proposal });
  if (!sow) throw httpError(404, "El SOW aun no se ha generado");
  const definition = SOW_SECTION_CATALOG.find((entry) => entry.code === code);
  if (!definition) throw httpError(404, "Seccion inexistente");
  const sections = sow.sections.map((section) =>
    section.code === code
      ? normalizeSectionWrite({
          ...section,
          title: title || section.title,
          ...(content ? { content, blocks: section.blocks } : { blocks, content: null }),
          edited: true,
        })
      : section,
  );
  const validated = technicalSectionsSchema.parse(sections);
  await saveSow({ sowId: sow.id, sections: validated, baseScopeHash: sow.baseScopeHash, user });
  if (sow.status === SCOPE_STATUS.approved) {
    await recordScopeEvent({ scopeId: scope.id, eventCode: "approval_invalidated", userId: user.id, documentType: "sow" });
  }
  return getSow({ proposal });
}

export async function submitSowForReview({ proposal, user }) {
  await assertScopeEditor(user, proposal);
  const { sow } = await getSow({ proposal });
  if (!sow) throw httpError(404, "El SOW aun no se ha generado");
  await query(
    `UPDATE proposal_sow_documents
     SET status = 'in_review', approved_hash = NULL, approved_by_user_id = NULL, approved_at = NULL,
         approval_checklist_json = NULL, approval_comment = NULL, self_approved = 0, updated_at = NOW(3)
     WHERE id = ?`,
    [sow.id],
  );
  await recordScopeEvent({ scopeId: sow.scopeId, eventCode: "submitted", userId: user.id, documentType: "sow" });
  return getSow({ proposal });
}

export async function returnSowToDraft({ proposal, user, reason = "" }) {
  await assertScopeEditor(user, proposal);
  const { sow } = await getSow({ proposal });
  if (!sow) throw httpError(404, "El SOW aun no se ha generado");
  await query(
    `UPDATE proposal_sow_documents
     SET status = 'draft', approved_hash = NULL, approved_by_user_id = NULL, approved_at = NULL,
         approval_checklist_json = NULL, approval_comment = NULL, self_approved = 0, updated_at = NOW(3)
     WHERE id = ?`,
    [sow.id],
  );
  await recordScopeEvent({ scopeId: sow.scopeId, eventCode: "returned_to_draft", userId: user.id, documentType: "sow", detail: { reason } });
  return getSow({ proposal });
}

export async function approveSow({ proposal, user, checklist = {}, comment = "" }) {
  const scope = await requireScope(proposal);
  const presalesRows = await query(`SELECT presales_user_id FROM opportunities WHERE id = ? LIMIT 1`, [Number(proposal.opportunity_id)]);
  const capabilities = getScopeCapabilities(user, presalesRows[0]?.presales_user_id);
  if (!capabilities.canApprove) {
    throw httpError(403, "Solo el preventa asignado o un usuario con permiso puede aprobar el SOW");
  }
  const { sow, scope: currentScope } = await getSow({ proposal });
  if (!sow) throw httpError(404, "El SOW aun no se ha generado");
  if (sow.status !== SCOPE_STATUS.inReview) throw httpError(409, "El SOW debe estar en revision para aprobarse");
  if (!sow.scopeApproved) throw httpError(409, "El alcance tecnico debe estar aprobado antes de aprobar el SOW");
  if (sow.stale) throw httpError(409, "El SOW esta desactualizado respecto al alcance tecnico; generalo de nuevo");
  const missing = SOW_CHECKLIST_KEYS.filter((key) => checklist[key] !== true);
  if (missing.length) throw httpError(400, "Completa la lista de verificacion para aprobar", { missingChecklist: missing });

  const hash = computeSowHash(sow.sections, sow.baseScopeHash);
  const selfApproved = [sow.lastEditedByUserId, currentScope.requestedByUserId].filter(Boolean).includes(Number(user.id));
  await query(
    `UPDATE proposal_sow_documents
     SET status = 'approved', content_hash = ?, approved_hash = ?, approved_by_user_id = ?, approved_at = NOW(3),
         approval_checklist_json = ?, approval_comment = ?, self_approved = ?, updated_at = NOW(3)
     WHERE id = ?`,
    [hash, hash, Number(user.id), JSON.stringify(checklist), String(comment || "").slice(0, 1000), selfApproved ? 1 : 0, sow.id],
  );
  await recordScopeEvent({ scopeId: scope.id, eventCode: "approved", userId: user.id, documentType: "sow", detail: { selfApproved } });
  return { ...(await getSow({ proposal })), selfApproved };
}

// Content for the document renderer: the proposal's own branding and format with the approved SOW as its body.
// Throws a 409 when the SOW cannot be printed.
export async function buildSowDocumentContent({ proposal, baseContent }) {
  const { scope, sow } = await getSow({ proposal });
  if (!sow) throw httpError(404, "El SOW aun no se ha generado");
  if (!sow.printable) {
    const reason = !sow.scopeApproved
      ? "El alcance tecnico debe estar aprobado"
      : sow.stale
        ? "El SOW esta desactualizado respecto al alcance tecnico"
        : "El SOW debe estar aprobado antes de imprimirse";
    throw httpError(409, reason, { reason: "sow_not_approved" });
  }
  const sections = sow.sections
    .map((section) => {
      const extra =
        section.code === "sow_architecture"
          ? [
              ...buildTopologyNodes(scope.asisTopology, "Topologia de la situacion actual"),
              ...buildTopologyNodes(scope.topology, "Topologia de la solucion propuesta"),
            ]
          : [];
      return sectionToProposalSection(section, extra);
    })
    .filter(Boolean);
  const metadata = baseContent?.metadata || {};
  return {
    schema_version: 3,
    metadata: {
      ...metadata,
      cover: { ...(metadata.cover || {}), label: "Alcance de trabajo (SOW)" },
    },
    document: { type: "doc", content: sections },
    sections: [],
    removed_sections: [],
  };
}
