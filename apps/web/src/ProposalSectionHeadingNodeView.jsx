import { useEffect, useRef, useState } from "react";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import {
  AlignCenter, AlignLeft, AlignRight, Bold, ChevronDown, ChevronUp, FilePlus2,
  FileStack, FileText, Grid2X2, ImagePlus, Italic, List, ListOrdered, Redo2, Table2,
  Trash2, Undo2,
} from "lucide-react";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

function Control({ active = false, title, onClick, children, className = "" }) {
  return <button type="button" className={`${active ? "is-active" : ""} ${className}`.trim()} title={title} aria-label={title} aria-pressed={active} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{children}</button>;
}

export default function ProposalSectionHeadingNodeView({ node, editor, getPos }) {
  const inputRef = useRef(null);
  const pdfInputRef = useRef(null);
  const [isPageStartEnabled, setIsPageStartEnabled] = useState(false);

  function handleTitleKeyDown(event) {
    const isSection = Number(node.attrs.level) === 2;
    if (!isSection) return;

    if (event.key === "Enter") {
      event.preventDefault();
      return;
    }

    if (event.key === "Backspace") {
      const selection = window.getSelection();
      const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
      const isAtStart =
        range &&
        range.collapsed &&
        range.startContainer &&
        range.startOffset === 0 &&
        (range.startContainer.nodeType === Node.TEXT_NODE || range.startContainer.nodeType === Node.ELEMENT_NODE);

      if (isAtStart) {
        event.preventDefault();
      }
    }
  }

  function insertImage(file) {
    if (!file?.type?.startsWith("image/")) return;
    if (file.size > MAX_IMAGE_BYTES) {
      window.alert("La imagen no puede superar 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        editor.chain().focus().setImage({ src: reader.result, alt: file.name || "Imagen de propuesta", width: 220, align: "left", verticalAlign: "center" }).run();
      }
    });
    reader.readAsDataURL(file);
  }

  function insertPdf(file) {
    const isPdf = file?.type === "application/pdf" || /\.pdf$/i.test(file?.name || "");
    if (!isPdf) return;
    if (file.size > MAX_PDF_BYTES) {
      window.alert("El PDF no puede superar 10 MB.");
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") return;
      const currentSection = editor.state.doc.nodeAt(sectionPosition);
      if (!currentSection || currentSection.type.name !== "proposalSection") return;
      const insertPosition = sectionPosition + currentSection.nodeSize - 1;
      const pdfNode = editor.schema.nodes.proposalPdf.create({
        src: reader.result,
        fileName: file.name || "documento.pdf",
      });
      editor.view.dispatch(
        editor.state.tr.insert(insertPosition, pdfNode).scrollIntoView(),
      );
    });
    reader.readAsDataURL(file);
  }

  const isSection = Number(node.attrs.level) === 2;
  function getSectionPosition() {
    if (!isSection || editor.isDestroyed) return null;
    let descendantSectionPosition = null;
    editor.state.doc.descendants((currentNode, position, parentNode) => {
      if (descendantSectionPosition !== null) return false;
      if (currentNode === node && parentNode?.type.name === "proposalSection") {
        descendantSectionPosition = position - 1;
        return false;
      }
      return true;
    });
    if (descendantSectionPosition !== null) return descendantSectionPosition;
    try {
      const nodePosition = getPos?.();
      if (!Number.isInteger(nodePosition) || nodePosition < 0) return null;
      const resolvedPosition = editor.state.doc.resolve(nodePosition);
      for (let depth = resolvedPosition.depth; depth > 0; depth -= 1) {
        if (resolvedPosition.node(depth).type.name === "proposalSection") {
          return resolvedPosition.before(depth);
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  const sectionPosition = getSectionPosition();
  const section = sectionPosition === null ? null : editor.state.doc.nodeAt(sectionPosition);

  useEffect(() => {
    if (!isSection) return undefined;
    const syncPageStartState = () => {
      if (editor.isDestroyed) return;
      const currentPosition = getSectionPosition();
      const currentSection = currentPosition === null
        ? null
        : editor.state.doc.nodeAt(currentPosition);
      setIsPageStartEnabled(Boolean(currentSection?.attrs.startOnNewPage));
    };
    syncPageStartState();
    editor.on("transaction", syncPageStartState);
    return () => editor.off("transaction", syncPageStartState);
  }, [editor, getPos, isSection]);

  function toggleSectionPageStart() {
    const currentPosition = getSectionPosition();
    const currentSection = currentPosition === null
      ? null
      : editor.state.doc.nodeAt(currentPosition);
    if (!currentSection || currentSection.type.name !== "proposalSection") return;
    const nextStartOnNewPage = !Boolean(currentSection.attrs.startOnNewPage);
    setIsPageStartEnabled(nextStartOnNewPage);
    editor.view.dispatch(editor.state.tr.setNodeMarkup(currentPosition, undefined, {
      ...currentSection.attrs,
      startOnNewPage: nextStartOnNewPage,
    }));
  }

  function moveSection(direction) {
    const currentPosition = getSectionPosition();
    const currentSection = currentPosition === null
      ? null
      : editor.state.doc.nodeAt(currentPosition);
    if (!currentSection || currentSection.type.name !== "proposalSection") return;
    const sections = [];
    editor.state.doc.forEach((child, position) => {
      if (child.type.name === "proposalSection") sections.push({ child, position });
    });
    const currentIndex = sections.findIndex((entry) => entry.position === currentPosition);
    const target = sections[currentIndex + direction];
    if (!target) return;
    const transaction = editor.state.tr.delete(
      currentPosition,
      currentPosition + currentSection.nodeSize,
    );
    const rawPosition = direction < 0
      ? target.position
      : target.position + target.child.nodeSize;
    const insertPosition = transaction.mapping.map(rawPosition, -1);
    transaction.insert(insertPosition, currentSection);
    editor.view.dispatch(transaction.scrollIntoView());
  }

  function deleteSection() {
    if (!window.confirm("¿Eliminar esta sección? Esta acción no se puede deshacer.")) {
      return;
    }
    const currentPosition = getSectionPosition();
    const currentSection = currentPosition === null
      ? null
      : editor.state.doc.nodeAt(currentPosition);
    if (!currentSection || currentSection.type.name !== "proposalSection") return;
    editor.view.dispatch(editor.state.tr.delete(
      currentPosition,
      currentPosition + currentSection.nodeSize,
    ).scrollIntoView());
  }
  return (
    <NodeViewWrapper className={`proposal-section-heading${isSection ? " is-section" : ""}`}>
      {isSection ? (
        <div className="proposal-section-toolbar" contentEditable={false} role="toolbar" aria-label="Controles de sección">
          <Control title="Subir sección" onClick={() => moveSection(-1)}><ChevronUp size={16} /></Control>
          <Control title="Bajar sección" onClick={() => moveSection(1)}><ChevronDown size={16} /></Control>
          <Control title="Eliminar sección" onClick={deleteSection}><Trash2 size={16} /></Control>
          <Control
            active={isPageStartEnabled}
            className="proposal-section-page-start-toggle"
            title={isPageStartEnabled ? "Permitir continuación en la página actual" : "Iniciar sección en nueva página PDF"}
            onClick={toggleSectionPageStart}
          >
            <FileStack size={16} />
          </Control>
          <Control title="Negrita" onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={16} /></Control>
          <Control title="Cursiva" onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={16} /></Control>
          <Control title="Lista" onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={16} /></Control>
          <Control title="Lista numerada" onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={16} /></Control>
          <Control title="Insertar tabla" onClick={() => editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()}><Table2 size={16} /></Control>
          <Control title="Salto de página" onClick={() => editor.chain().focus().insertContent({ type: "proposalPageBreak" }).run()}><FilePlus2 size={16} /></Control>
          <Control title="Insertar imagen" onClick={() => inputRef.current?.click()}><ImagePlus size={16} /></Control>
          <Control title="Insertar PDF incrustado" onClick={() => pdfInputRef.current?.click()}><FileText size={16} /></Control>
          {[2, 3, 4, 5].map((columns) => <Control key={columns} title={`Insertar fila de ${columns} imágenes`} onClick={() => editor.chain().focus().insertContent({ type: "proposalImageRow", attrs: { columns, images: [] } }).run()}><Grid2X2 size={16} /></Control>)}
          <Control title="Alinear a la izquierda" onClick={() => editor.chain().focus().setTextAlign("left").run()}><AlignLeft size={16} /></Control>
          <Control title="Centrar" onClick={() => editor.chain().focus().setTextAlign("center").run()}><AlignCenter size={16} /></Control>
          <Control title="Alinear a la derecha" onClick={() => editor.chain().focus().setTextAlign("right").run()}><AlignRight size={16} /></Control>
          <Control title="Deshacer" onClick={() => editor.chain().focus().undo().run()}><Undo2 size={16} /></Control>
          <Control title="Rehacer" onClick={() => editor.chain().focus().redo().run()}><Redo2 size={16} /></Control>
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden onChange={(event) => { insertImage(event.target.files?.[0]); event.target.value = ""; }} />
          <input ref={pdfInputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => { insertPdf(event.target.files?.[0]); event.target.value = ""; }} />
        </div>
      ) : null}
      <NodeViewContent as={isSection ? "h2" : "h3"} onKeyDown={handleTitleKeyDown} />
    </NodeViewWrapper>
  );
}