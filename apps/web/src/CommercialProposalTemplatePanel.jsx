import React, { useEffect, useRef, useState } from "react";
import ProposalRichTextEditor from "./ProposalRichTextEditor";
import "./proposal-document-module.css";
import "../../../shared/proposal-document-print.css";
import { listProposalFormats } from "../../../shared/proposal-formats.js";

function createSection() {
  return {
    type: "proposalSection",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Nueva sección" }],
      },
      { type: "paragraph" },
    ],
  };
}

function normalizeSectionNode(node) {
  const allowedBlockTypes = new Set([
    "heading",
    "paragraph",
    "bulletList",
    "orderedList",
    "image",
    "proposalImageRow",
    "proposalPageBreak",
    "proposalRowBreak",
    "proposalPdf",
    "table",
  ]);
  const content = Array.isArray(node?.content)
    ? node.content.filter((child) => child && allowedBlockTypes.has(child.type))
    : [];
  const hasSectionHeading = content.some(
    (child) => child.type === "heading" && Number(child.attrs?.level) === 2,
  );
  return {
    type: "proposalSection",
    attrs: node?.attrs || {},
    content: hasSectionHeading
      ? content
      : [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Nueva sección" }],
          },
          ...content,
        ],
  };
}

class CommercialProposalTemplateErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || "Error desconocido" };
  }

  render() {
    if (this.state.hasError) {
      return <p className="field-error-text">No fue posible cargar esta plantilla: {this.state.message}</p>;
    }
    return this.props.children;
  }
}

function normalizeTemplateDocument(document) {
  if (document?.type !== "doc") {
    return { type: "doc", content: [createSection()] };
  }
  const nodes = Array.isArray(document.content) ? document.content : [];
  const hasProposalSections = nodes.some((node) => node.type === "proposalSection");
  if (hasProposalSections) {
    return {
      ...document,
      content: nodes
        .filter((node) => node.type === "proposalSection")
        .map(normalizeSectionNode),
    };
  }
  const sections = [];
  for (const node of nodes) {
    if (node.type === "proposalSection") {
      sections.push(normalizeSectionNode(node));
      continue;
    }
    if (node.type === "heading" && Number(node.attrs?.level) === 2) {
      sections.push({ type: "proposalSection", content: [node] });
      continue;
    }
    if (sections.length > 0) {
      sections[sections.length - 1].content.push(node);
    }
  }
  return {
    ...document,
    content: sections.length || nodes.length === 0 ? sections : [createSection()],
  };
}

export default function CommercialProposalTemplatePanel({
  content,
  templates = [],
  formats = [],
  selectedCode = "generica",
  saving,
  onSelectTemplate,
  onCreateTemplate,
  onDeleteTemplate,
  onDeleteFormat,
  onPreview,
  onChange,
}) {
  const editorRef = useRef(null);
  const savedDocument = normalizeTemplateDocument(content?.document);
  const [formatCode, setFormatCode] = useState(content?.format_code || "basic");
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateBaseCode, setNewTemplateBaseCode] = useState("");
  const savedSnapshotRef = useRef(JSON.stringify(savedDocument));
  const draftDocumentRef = useRef(savedDocument);
  const ignoreEditorUpdateRef = useRef(false);
  const [draftDocument, setDraftDocument] = useState(savedDocument);
  const [hasDraftChanges, setHasDraftChanges] = useState(false);
  const isDirty = !ignoreEditorUpdateRef.current && (
    hasDraftChanges || JSON.stringify(draftDocument) !== JSON.stringify(savedDocument)
  );

  useEffect(() => {
    setDraftDocument(savedDocument);
    draftDocumentRef.current = savedDocument;
    savedSnapshotRef.current = JSON.stringify(savedDocument);
    ignoreEditorUpdateRef.current = false;
    setHasDraftChanges(false);
    setFormatCode(content?.format_code || "basic");
  }, [content]);

  function save() {
    const documentToSave = editorRef.current?.getDocument() || draftDocumentRef.current;
    savedSnapshotRef.current = JSON.stringify(documentToSave);
    ignoreEditorUpdateRef.current = true;
    draftDocumentRef.current = documentToSave;
    setDraftDocument(documentToSave);
    setHasDraftChanges(false);
    onChange({ schema_version: 3, format_code: formatCode, document: documentToSave });
  }

  function addSection() {
    setDraftDocument((current) => {
      const nextDocument = {
        ...current,
        content: [...current.content, createSection()],
      };
      draftDocumentRef.current = nextDocument;
      return nextDocument;
    });
    setHasDraftChanges(true);
    window.setTimeout(() => editorRef.current?.focusAtEnd(), 0);
  }

  function handleEditorChange(nextDocument) {
    draftDocumentRef.current = nextDocument;
    setDraftDocument(nextDocument);
    if (ignoreEditorUpdateRef.current) return;
    setHasDraftChanges(JSON.stringify(nextDocument) !== savedSnapshotRef.current);
  }

  function createTemplate() {
    setNewTemplateName("");
    setNewTemplateBaseCode("");
    setIsCreatingTemplate(true);
  }

  function submitCreateTemplate(event) {
    event.preventDefault();
    const name = newTemplateName.trim();
    if (!name) return;
    onCreateTemplate?.(name, newTemplateBaseCode || null);
    setIsCreatingTemplate(false);
  }

  function preview() {
    const documentToPreview = editorRef.current?.getDocument() || draftDocumentRef.current;
    onPreview?.({ schema_version: 3, format_code: formatCode, document: documentToPreview });
  }

  return (
    <div className="configuration-section-stack configuration-commercial-proposal-template">
      <section className="configuration-card">
        <div className="configuration-card-heading">
          <div>
            <h4>Propuesta comercial base</h4>
            <p>Esta plantilla se copia al crear una propuesta con secciones estándar.</p>
          </div>
          <div className="configuration-commercial-template-controls">
            <div className="configuration-commercial-template-selectors">
              <label>
                Plantilla
                <select value={selectedCode} onChange={(event) => onSelectTemplate?.(event.target.value)} aria-label="Plantilla comercial">
                  {templates.map((template) => <option key={template.code} value={template.code}>{template.name}</option>)}
                </select>
              </label>
              <label>
                Formato visual
                <select value={formatCode} onChange={(event) => { setFormatCode(event.target.value); setHasDraftChanges(true); }} aria-label="Formato visual de la plantilla">
                  {(formats.length ? formats : listProposalFormats()).map((format) => <option key={format.code} value={format.code}>{format.name}</option>)}
                </select>
              </label>
              <span className="configuration-inline-pill configuration-template-status">{saving ? "Guardando..." : isDirty ? "Cambios sin guardar" : "Guardada"}</span>
            </div>
            <div className="configuration-inline-actions">
              <button type="button" className="btn-secondary" onClick={createTemplate}>Nueva plantilla</button>
              <button type="button" className="btn-secondary" onClick={addSection}>Agregar sección</button>
              <button type="button" className="btn-primary" disabled={saving} onClick={save}>{saving ? "Guardando..." : "Guardar cambios"}</button>
              <button type="button" className="btn-secondary" disabled={saving} onClick={preview}>Ver PDF</button>
            {selectedCode !== "generica" ? (
              <button type="button" className="btn-secondary" onClick={() => onDeleteTemplate?.(selectedCode)}>Eliminar plantilla</button>
            ) : null}
            {formatCode !== "basic" ? <button type="button" className="btn-secondary" onClick={() => onDeleteFormat?.(formatCode)}>Eliminar formato</button> : null}
          </div>
          </div>
        </div>
        {isCreatingTemplate ? (
          <form className="configuration-template-create-form" onSubmit={submitCreateTemplate}>
            <label>
              Nombre de la nueva plantilla
              <input value={newTemplateName} onChange={(event) => setNewTemplateName(event.target.value)} autoFocus required />
            </label>
            <label>
              Tomar como base
              <select value={newTemplateBaseCode} onChange={(event) => setNewTemplateBaseCode(event.target.value)}>
                <option value="">Ninguna (plantilla vacía)</option>
                {templates.map((template) => <option key={template.code} value={template.code}>{template.name}</option>)}
              </select>
            </label>
            <div className="configuration-inline-actions">
              <button type="button" className="btn-secondary" onClick={() => setIsCreatingTemplate(false)}>Cancelar</button>
              <button type="submit" className="btn-primary">Crear plantilla</button>
            </div>
          </form>
        ) : null}
        <div className="proposal-document-canvas configuration-commercial-proposal-canvas">
          <article className="proposal-document-wysiwyg-page">
            <CommercialProposalTemplateErrorBoundary key={`${selectedCode}:${formatCode}`}>
              <ProposalRichTextEditor key={`${selectedCode}:${formatCode}`} ref={editorRef} content={draftDocument} printMode formatCode={formatCode} keepPastedContentInSection onChange={handleEditorChange} />
            </CommercialProposalTemplateErrorBoundary>
          </article>
        </div>
      </section>
      <section className="configuration-card configuration-commercial-proposal-variables" aria-label="Variables permitidas">
        <strong>Variables permitidas en bloques de texto</strong>
        <p>Estos marcadores se reemplazan al crear una propuesta desde una oportunidad.</p>
        <ul>
          {[
            ["{{client_name}}", "Nombre de la cuenta o cliente asociado"],
            ["{{contact_name}}", "Nombre del contacto asociado"],
            ["{{company_name}}", "Nombre visible de la empresa emisora"],
          ].map(([token, description]) => (
            <li key={token}>
              <button type="button" title={`Insertar ${token}`} onClick={() => editorRef.current?.insertText(token)}>{token}</button>
              <span>: {description}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}