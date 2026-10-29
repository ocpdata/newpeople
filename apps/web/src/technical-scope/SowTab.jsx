import { useState } from "react";
import SectionRichEditor from "./SectionRichEditor";
import { ChecklistForm } from "./ApprovalTab";
import { SCOPE_STATUS_LABELS } from "./technicalScopeApi";

function SowSection({ section, canEdit, busy, open, onToggle, onSave }) {
  const [content, setContent] = useState(section.content);
  const dirty = JSON.stringify(content) !== JSON.stringify(section.content);
  return (
    <details className="ts-section" open={open} onToggle={(event) => onToggle(event.currentTarget.open)}>
      <summary>
        <span>{section.title}</span>
        {section.edited ? <span className="proposal-chip proposal-chip-soft">Editada</span> : null}
      </summary>
      <div className="ts-section-body">
        {open ? (
          <SectionRichEditor content={content} onChange={setContent} readOnly={!canEdit || busy} label={section.title} />
        ) : null}
        {canEdit ? (
          <div className="ts-section-actions">
            <button type="button" className="btn-primary" disabled={busy || !dirty} onClick={() => onSave(section.code, content)}>
              Guardar sección
            </button>
          </div>
        ) : null}
      </div>
    </details>
  );
}

export default function SowTab({ overview, sow, canEdit, canApprove, busy, onGenerate, onSaveSection, onSubmit, onApprove, onReturn, onOpenPdf }) {
  const [useAi, setUseAi] = useState(true);
  const [openCodes, setOpenCodes] = useState([]);
  const scopeApproved = overview.scope.printable;

  return (
    <div className="ts-tab">
      <section className="ts-card">
        <div className="ts-card-head">
          <div>
            <h4>SOW (alcance de trabajo)</h4>
            <p className="field-hint">
              Documento separado derivado del alcance técnico aprobado. Las condiciones comerciales salen de la cotización.
              Lo aprueba el preventa y no se puede imprimir sin su aprobación.
            </p>
            {!scopeApproved ? (
              <p className="ts-warn">El alcance técnico debe estar aprobado para aprobar o imprimir el SOW.</p>
            ) : null}
            {sow ? (
              <p className="field-hint">
                Estado: <strong>{SCOPE_STATUS_LABELS[sow.status] || sow.status}</strong>
                {sow.stale ? " · desactualizado respecto al alcance técnico" : ""}
                {sow.status === "approved" && sow.selfApproved ? " · aprobado por quien lo elaboró" : ""}
              </p>
            ) : null}
          </div>
          <div className="ts-actions">
            {canEdit ? (
              <>
                <label className="ts-check">
                  <input type="checkbox" checked={useAi} onChange={(event) => setUseAi(event.target.checked)} />
                  Personalizar con IA
                </label>
                <button type="button" className="btn-primary" disabled={busy || overview.scope.sections.length === 0} onClick={() => onGenerate(useAi)}>
                  {sow ? "Regenerar SOW" : "Generar SOW"}
                </button>
              </>
            ) : null}
            {sow?.printable ? (
              <button type="button" className="btn-secondary" disabled={busy} onClick={onOpenPdf}>
                Abrir PDF del SOW
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {sow ? (
        <>
          {sow.sections.map((section) => (
            <SowSection
              key={`${section.code}:${JSON.stringify(section.content)}`}
              section={section}
              canEdit={canEdit}
              busy={busy}
              open={openCodes.includes(section.code)}
              onToggle={(isOpen) =>
                setOpenCodes((current) =>
                  isOpen ? [...new Set([...current, section.code])] : current.filter((code) => code !== section.code),
                )
              }
              onSave={onSaveSection}
            />
          ))}
          <section className="ts-card ts-actions-row">
            {canEdit && sow.status === "draft" ? (
              <button type="button" className="btn-primary" disabled={busy} onClick={onSubmit}>Enviar SOW a revisión</button>
            ) : null}
            {canEdit && sow.status !== "draft" ? (
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => onReturn("")}>Regresar a borrador</button>
            ) : null}
          </section>
          {sow.status === "in_review" && canApprove ? (
            <ChecklistForm
              items={[{ key: "contentReviewed", label: "Revisé el contenido contractual del SOW y coincide con el alcance técnico aprobado." }]}
              busy={busy}
              label="Aprobar SOW"
              onSubmit={onApprove}
            />
          ) : null}
        </>
      ) : (
        <p className="field-hint">El SOW aún no se ha generado.</p>
      )}
    </div>
  );
}
