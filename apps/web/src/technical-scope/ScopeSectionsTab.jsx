import { useMemo, useState } from "react";
import SectionRichEditor from "./SectionRichEditor";
import { renderTopologySvg, isTopologyEmpty, normalizeTopology } from "../../../../shared/topology.js";
import "../../../../shared/proposal-document-print.css";

const SOURCE_KIND_LABELS = {
  answer: "Respuesta",
  document: "Documento",
  quotation: "Cotización",
  rag: "Conocimiento",
  playbook: "Playbook",
  crm: "CRM",
};

// Sources are stored with technical codes (for example f5_dcs:apps_count); people read the name or the question.
function describeSource(source, overview) {
  if (source.kind === "playbook") {
    return overview.catalog.find((entry) => entry.code === source.ref)?.name || source.label || source.ref;
  }
  if (source.kind === "answer") {
    const [playbookCode, ...rest] = String(source.ref || "").split(":");
    const question = overview.questions?.find(
      (entry) => entry.playbookCode === playbookCode && entry.code === rest.join(":"),
    );
    return question?.prompt || source.label || source.ref;
  }
  return source.label || source.ref;
}

// Remounted (via key) whenever the stored content changes, so the draft always starts from what is saved.
function SectionCard({ section, overview, canEdit, busy, open, onToggle, onSave, onSaveItemRefs, onRegenerate }) {
  const [content, setContent] = useState(section.content);
  const [instructions, setInstructions] = useState("");
  const dirty = JSON.stringify(content) !== JSON.stringify(section.content);
  const finding = overview.verification?.findings?.filter((entry) => entry.ref === section.code) || [];

  return (
    <details className="ts-section" open={open} onToggle={(event) => onToggle(event.currentTarget.open)}>
      <summary>
        <span>{section.title}</span>
        {section.edited ? <span className="proposal-chip proposal-chip-soft">Editada</span> : null}
        {finding.length ? <span className="proposal-chip ts-chip-warn">{finding.length} hallazgo(s)</span> : null}
      </summary>
      <div className="ts-section-body">
        {finding.map((entry) => (
          <p key={`${entry.code}-${entry.message}`} className={entry.severity === "blocking" ? "ts-error" : "ts-warn"}>
            {entry.message}
          </p>
        ))}
        {open ? (
          <SectionRichEditor content={content} onChange={setContent} readOnly={!canEdit || busy} label={section.title} />
        ) : null}

        {section.code === "proposed_solution" ? (
          <div className="ts-itemrefs">
            <strong>Partidas cubiertas por esta sección</strong>
            <div className="ts-checks">
              {overview.quotationItems.map((item) => (
                <label key={item.productCode} className="ts-check" title={item.productDescription}>
                  <input
                    type="checkbox"
                    disabled={!canEdit || busy}
                    checked={section.itemRefs.includes(item.productCode)}
                    onChange={(event) =>
                      onSaveItemRefs(
                        section.code,
                        event.target.checked
                          ? [...section.itemRefs, item.productCode]
                          : section.itemRefs.filter((ref) => ref !== item.productCode),
                      )
                    }
                  />
                  {item.productCode}
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {section.sources?.length ? (
          <div className="ts-sources">
            <small className="field-hint">Fuentes:</small>
            {section.sources.slice(0, 12).map((source, index) => (
              <span className="proposal-chip proposal-chip-soft" key={index} title={source.ref || source.label}>
                {SOURCE_KIND_LABELS[source.kind] || source.kind}: {describeSource(source, overview)}
              </span>
            ))}
          </div>
        ) : null}

        {canEdit ? (
          <div className="ts-section-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !dirty}
              onClick={() => onSave(section.code, content)}
            >
              Guardar sección
            </button>
            <input
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="Instrucciones para regenerar (opcional)"
              aria-label="Instrucciones para regenerar"
            />
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => onRegenerate(section.code, instructions)}
            >
              Regenerar
            </button>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function TopologyFigure({ topology, caption }) {
  const svg = useMemo(
    () => (topology && !isTopologyEmpty(topology) ? renderTopologySvg(normalizeTopology(topology)) : ""),
    [topology],
  );
  if (!svg) return null;
  return (
    <figure className="ts-preview-figure">
      <figcaption>{caption}</figcaption>
      <div dangerouslySetInnerHTML={{ __html: svg }} />
    </figure>
  );
}

// Read-only view of the scope as it will read inside the proposal document.
function ScopePreview({ scope }) {
  return (
    <article className="proposal-document-wysiwyg-page ts-preview">
      {scope.sections.map((section) => (
        <section key={section.code} className="ts-preview-section">
          <h2>{section.title}</h2>
          <SectionRichEditor content={section.content} readOnly label={section.title} />
          {section.code === "architecture" ? (
            <>
              <TopologyFigure topology={scope.asisTopology} caption="Topología de la situación actual" />
              <TopologyFigure topology={scope.topology} caption="Topología de la solución propuesta" />
            </>
          ) : null}
        </section>
      ))}
    </article>
  );
}

export default function ScopeSectionsTab({ overview, canEdit, busy, warnings, onGenerate, onSaveSection, onSaveItemRefs }) {
  const { scope } = overview;
  const [useAi, setUseAi] = useState(true);
  const [instructions, setInstructions] = useState("");
  const [force, setForce] = useState(false);
  const [openCodes, setOpenCodes] = useState([]);
  const [showPreview, setShowPreview] = useState(false);

  return (
    <div className="ts-tab">
      <section className="ts-card">
        <div className="ts-card-head">
          <div>
            <h4>Alcance técnico</h4>
            <p className="field-hint">
              Se genera desde el playbook, el cuestionario confirmado y las partidas cotizadas (sin precios).
              Las secciones que edites a mano se conservan al regenerar todo.
            </p>
          </div>
          {canEdit ? (
            <div className="ts-actions">
              <label className="ts-check">
                <input type="checkbox" checked={useAi} onChange={(event) => setUseAi(event.target.checked)} />
                Personalizar con IA
              </label>
              <label className="ts-check">
                <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
                Reemplazar también las editadas
              </label>
              <button type="button" className="btn-primary" disabled={busy} onClick={() => onGenerate({ useAi, instructions, force })}>
                {scope.sections.length ? "Regenerar todo" : "Generar alcance"}
              </button>
            </div>
          ) : null}
        </div>
        {canEdit ? (
          <input
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="Instrucciones adicionales para la IA (opcional)"
            aria-label="Instrucciones adicionales para la IA"
          />
        ) : null}
        {warnings.length ? (
          <ul className="ts-warnings">
            {warnings.map((warning, index) => <li key={index}>{warning}</li>)}
          </ul>
        ) : null}
      </section>

      {scope.sections.length > 0 ? (
        <div className="ts-actions">
          <button type="button" className="btn-secondary" onClick={() => setShowPreview(!showPreview)} aria-pressed={showPreview}>
            {showPreview ? "Volver a las secciones" : "Vista previa del documento"}
          </button>
        </div>
      ) : null}

      {scope.sections.length === 0 ? (
        <p className="field-hint">Aún no hay secciones. Responde el cuestionario y genera el alcance.</p>
      ) : showPreview ? (
        <ScopePreview scope={scope} />
      ) : (
        scope.sections.map((section) => (
          <SectionCard
            key={`${section.code}:${JSON.stringify(section.content)}:${JSON.stringify(section.itemRefs)}`}
            section={section}
            open={openCodes.includes(section.code)}
            onToggle={(isOpen) =>
              setOpenCodes((current) =>
                isOpen ? [...new Set([...current, section.code])] : current.filter((code) => code !== section.code),
              )
            }
            overview={overview}
            canEdit={canEdit}
            busy={busy}
            onSave={onSaveSection}
            onSaveItemRefs={onSaveItemRefs}
            onRegenerate={(code, text) => onGenerate({ useAi, instructions: text, codes: [code], force: true })}
          />
        ))
      )}
    </div>
  );
}
