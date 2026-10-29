import { ensureTechnicalScopeSchema } from "./schema.js";
import {
  computeHashForScope,
  getScopeRowByDocumentId,
  SCOPE_STATUS,
  serializeScopeRow,
} from "./scope-store.js";
import { loadProposalDocumentSource, quotationVersionIdOf } from "./proposal-source.js";
import { buildScopeProposalSections, injectScopeSectionsIntoContent } from "./tiptap.js";

export const TECHNICAL_SCOPE_BLOCK_MESSAGES = Object.freeze({
  not_approved:
    "El alcance tecnico de la propuesta debe estar aprobado antes de abrir el PDF, enviarla o finalizarla",
  modified:
    "El alcance tecnico cambio despues de su aprobacion. Vuelve a enviarlo a revision y apruebalo",
  quotation_changed:
    "La version de cotizacion de la propuesta cambio despues de aprobar el alcance tecnico. Vuelve a aprobarlo",
});

// Decides whether a proposal document can be printed, emailed or finalized.
// Documents without a technical scope (basic proposals) are never affected.
export async function resolveTechnicalScopeGate({ documentId }) {
  await ensureTechnicalScopeSchema();
  const scopeRow = await getScopeRowByDocumentId(documentId);
  if (!scopeRow) return { applies: false };

  const blocked = (reason) => ({
    applies: true,
    allowed: false,
    reason,
    message: TECHNICAL_SCOPE_BLOCK_MESSAGES[reason],
    status: scopeRow.status,
  });

  const scope = serializeScopeRow(scopeRow);
  if (scope.status !== SCOPE_STATUS.approved || !scope.approvedHash) {
    return blocked("not_approved");
  }
  const source = await loadProposalDocumentSource({ documentId });
  if (!source) return blocked("not_approved");
  const quotationVersionId = quotationVersionIdOf(source);
  if (quotationVersionId !== scope.quotationVersionId) return blocked("quotation_changed");
  if (computeHashForScope(scope, quotationVersionId) !== scope.approvedHash) return blocked("modified");

  return {
    applies: true,
    allowed: true,
    status: scopeRow.status,
    sections: buildScopeProposalSections(scope),
  };
}

function blockedResult(gate) {
  return {
    ok: false,
    status: 409,
    body: {
      message: gate.message,
      reason: gate.reason,
      technicalScopeStatus: gate.status || null,
    },
  };
}

// Applies the gate to the content that is about to be rendered: rejects unapproved scopes and swaps in the approved sections.
export async function applyTechnicalScopeToDocumentContent({ documentId, content }) {
  const gate = await resolveTechnicalScopeGate({ documentId });
  if (!gate.applies) return { ok: true, content };
  if (!gate.allowed) return blockedResult(gate);
  return { ok: true, content: injectScopeSectionsIntoContent(content, gate.sections) };
}

// Finalizing a proposal with a pending technical scope is not allowed either.
export async function assertDocumentCanBeFinalized({ documentId }) {
  const gate = await resolveTechnicalScopeGate({ documentId });
  if (!gate.applies || gate.allowed) return { ok: true };
  return blockedResult(gate);
}
