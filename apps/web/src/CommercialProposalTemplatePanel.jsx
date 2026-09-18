import React, { useEffect, useRef, useState } from "react";
import ProposalRichTextEditor from "./ProposalRichTextEditor";
import "./proposal-document-module.css";
import "../../../shared/proposal-document-print.css";

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

function readCoverImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No fue posible leer la fotografía"));
    reader.readAsDataURL(file);
  });
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
  const [formatCode, setFormatCode] = useState("basic");
  const [cover, setCover] = useState(content?.metadata?.cover || {});
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateBaseCode, setNewTemplateBaseCode] = useState("");
  const savedSnapshotRef = useRef(JSON.stringify(savedDocument));
  const draftDocumentRef = useRef(savedDocument);
  const ignoreEditorUpdateRef = useRef(false);
  const [draftDocument, setDraftDocument] = useState(savedDocument);
  const [hasDraftChanges, setHasDraftChanges] = useState(false);
  const isDirty = !ignoreEditorUpdateRef.current && (
    hasDraftChanges ||
    JSON.stringify(draftDocument) !== JSON.stringify(savedDocument) ||
    JSON.stringify(cover) !== JSON.stringify(content?.metadata?.cover || {})
  );

  useEffect(() => {
    setDraftDocument(savedDocument);
    draftDocumentRef.current = savedDocument;
    savedSnapshotRef.current = JSON.stringify(savedDocument);
    ignoreEditorUpdateRef.current = false;
    setHasDraftChanges(false);
    setFormatCode("basic");
    setCover(content?.metadata?.cover || {});
  }, [content]);

  function save() {
    const documentToSave = editorRef.current?.getDocument() || draftDocumentRef.current;
    savedSnapshotRef.current = JSON.stringify(documentToSave);
    ignoreEditorUpdateRef.current = true;
    draftDocumentRef.current = documentToSave;
    setDraftDocument(documentToSave);
    setHasDraftChanges(false);
    onChange({
      schema_version: 3,
      format_code: formatCode,
      metadata: { cover },
      document: documentToSave,
    });
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

  function confirmDeleteTemplate() {
    const template = templates.find((entry) => entry.code === selectedCode);
    const templateName = template?.name || selectedCode;
    if (!window.confirm(`¿Eliminar la plantilla "${templateName}"? Esta acción no se puede deshacer.`)) {
      return;
    }
    onDeleteTemplate?.(selectedCode);
  }

  function preview() {
    const documentToPreview = editorRef.current?.getDocument() || draftDocumentRef.current;
    onPreview?.({
      schema_version: 3,
      format_code: formatCode,
      metadata: { cover },
      document: documentToPreview,
    });
  }

  async function handleCoverImageChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpe?g)$/i.test(file.type)) {
      window.alert("La fotografía debe ser PNG o JPEG.");
      event.target.value = "";
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      window.alert("La fotografía no puede exceder 8 MB.");
      event.target.value = "";
      return;
    }
    try {
      const imageUrl = await readCoverImage(file);
      setCover((current) => ({
        ...current,
        image_url: imageUrl,
        image_name: file.name,
        show_client_logo: current.show_client_logo !== false,
      }));
    } catch (error) {
      window.alert(error.message || "No fue posible cargar la fotografía.");
    } finally {
      event.target.value = "";
    }
  }

  function confirmRemoveCoverImage() {
    if (!window.confirm("¿Quitar la fotografía de portada? Esta acción no se puede deshacer.")) {
      return;
    }
    setCover((current) => ({ ...current, image_url: "", image_name: "" }));
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
                  <option value="basic">Básico</option>
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
              <button type="button" className="btn-secondary" onClick={confirmDeleteTemplate}>Eliminar plantilla</button>
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
        <section className="configuration-cover-photo-panel">
          <div>
            <strong>Portada de impacto fotográfico</strong>
            <p>Esta fotografía se aplicará a las nuevas propuestas creadas con esta plantilla.</p>
          </div>
          <div className="configuration-cover-photo-layout">
            <div className="configuration-cover-photo-source">
              <span className="configuration-cover-photo-label">Fotografía de fondo</span>
              <div className="configuration-cover-photo-preview">
                {cover.image_url ? (
                  <img src={cover.image_url} alt="Fotografía de portada" />
                ) : (
                  <span>Sin fotografía</span>
                )}
              </div>
              <div className="configuration-cover-photo-actions">
                <label className="btn-secondary configuration-cover-photo-upload">
                  Cargar fotografía
                  <input type="file" accept="image/png,image/jpeg" onChange={handleCoverImageChange} />
                </label>
                {cover.image_url ? (
                  <button type="button" className="btn-secondary" onClick={confirmRemoveCoverImage}>
                    Quitar fotografía
                  </button>
                ) : null}
                <span>PNG o JPEG, máximo 8 MB. Recomendado: horizontal, 2400 × 1650 px; mínimo 1600 × 1100 px.</span>
              </div>
            </div>
            <div className="configuration-client-logo-option">
              <span className="configuration-cover-photo-label">Marca del cliente</span>
              <label className="configuration-cover-photo-toggle">
                <input
                  type="checkbox"
                  checked={cover.show_client_logo !== false}
                  onChange={(event) => setCover((current) => ({ ...current, show_client_logo: event.target.checked }))}
                />
                Mostrar logo del cliente
              </label>
              <p>Usa el logo cargado en la ficha de la Cuenta asociada a cada propuesta.</p>
            </div>
          </div>
        </section>
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