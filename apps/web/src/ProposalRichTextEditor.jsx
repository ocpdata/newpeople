import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import { ProposalImage } from "./proposalImageExtension";
import { ProposalRowBreak } from "./proposalRowBreakExtension";
import { ProposalPageBreak } from "./proposalPageBreakExtension";
import { ProposalImageRow } from "./proposalImageRowExtension";
import { ProposalPdf } from "./proposalPdfExtension";
import { ProposalSectionHeading } from "./proposalSectionHeadingExtension";
import { ProposalSection } from "./proposalSectionExtension";
import { getProposalFormat } from "../../../shared/proposal-formats.js";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  FilePlus2,
  FileText,
  Grid2X2,
  Heading2,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Table2,
  Undo2,
} from "lucide-react";

function ToolbarButton({ active, onClick, children, title }) {
  return (
    <button
      type="button"
      className={active ? "is-active" : ""}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  );
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

const ProposalRichTextEditor = forwardRef(function ProposalRichTextEditor({ content, onChange, readOnly = false, printMode = false, showToolbar = !printMode, keepPastedContentInSection = false, formatCode = "corporate" }, ref) {
  const lastExternalContent = useRef(JSON.stringify(content));
  const imageInputRef = useRef(null);
  const pdfInputRef = useRef(null);

  function insertImageFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > MAX_IMAGE_BYTES) {
      window.alert("La imagen no puede superar 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") return;
      editor?.chain().focus().setImage({
        src: reader.result,
        alt: file.name || "Imagen de propuesta",
        width: 220,
        align: "left",
        verticalAlign: "center",
      }).run();
    });
    reader.readAsDataURL(file);
  }

  function insertPdfFile(file) {
    const isPdf = file?.type === "application/pdf" || /\.pdf$/i.test(file?.name || "");
    if (!isPdf) return;
    if (file.size > MAX_PDF_BYTES) {
      window.alert("El PDF no puede superar 10 MB.");
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") return;
      editor?.chain().focus().insertContent({
        type: "proposalPdf",
        attrs: { src: reader.result, fileName: file.name || "documento.pdf" },
      }).run();
    });
    reader.readAsDataURL(file);
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      ProposalSectionHeading,
      ProposalSection,
      Link.configure({ openOnClick: false, autolink: true }),
      ProposalImage.configure({ inline: false, allowBase64: true }),
      ProposalRowBreak,
      ProposalPageBreak,
      ProposalImageRow,
      ProposalPdf,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content,
    editable: !readOnly,
    editorProps: {
      handleKeyDown: (_view, event) => {
        const { selection } = _view.state;
        const { $from } = selection;
        const parent = $from.parent;
        const container = $from.node(-1);
        const childIndex = $from.index($from.depth);
        const previousNode = childIndex > 0 ? container.child(childIndex - 1) : null;

        let proposalSectionDepth = -1;
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if ($from.node(depth).type.name === "proposalSection") {
            proposalSectionDepth = depth;
            break;
          }
        }

        if (
          event.key === "Enter" &&
          parent.type.name === "paragraph" &&
          parent.content.size === 0 &&
          proposalSectionDepth > 0
        ) {
          event.preventDefault();
          const paragraph = _view.state.schema.nodes.paragraph.create();
          const insertPosition = $from.after($from.depth);
          const transaction = _view.state.tr.insert(insertPosition, paragraph);
          transaction.setSelection(
            TextSelection.near(transaction.doc.resolve(insertPosition + 1)),
          );
          _view.dispatch(transaction.scrollIntoView());
          return true;
        }

        const atStartOfSectionHeading =
          event.key === "Enter" &&
          parent.type.name === "heading" &&
          Number(parent.attrs.level) === 2;

        const atStartOfSectionHeadingBackspace =
          event.key === "Backspace" &&
          parent.type.name === "heading" &&
          Number(parent.attrs.level) === 2 &&
          $from.parentOffset === 0;

        const atStartOfFollowingParagraph =
          event.key === "Backspace" &&
          parent.type.name === "paragraph" &&
          $from.parentOffset === 0 &&
          previousNode?.type?.name === "heading" &&
          Number(previousNode.attrs.level) === 2;

        const domRange = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : null;
        const domPreviousSiblingIsSectionHeading = (element) => {
          const previousSibling = element?.previousElementSibling;
          return previousSibling?.matches("h2") || Boolean(previousSibling?.querySelector("h2"));
        };
        const domAtStartOfFollowingParagraph =
          event.key === "Backspace" &&
          domRange &&
          domRange.collapsed &&
          (
            (
              domRange.startContainer.nodeType === Node.TEXT_NODE &&
              domRange.startOffset === 0 &&
              domRange.startContainer.parentElement?.tagName === "P" &&
              domPreviousSiblingIsSectionHeading(domRange.startContainer.parentElement)
            ) || (
              domRange.startContainer.nodeType === Node.ELEMENT_NODE &&
              domRange.startContainer.tagName === "P" &&
              domRange.startOffset === 0 &&
              domPreviousSiblingIsSectionHeading(domRange.startContainer)
            )
          );

        if (
          atStartOfSectionHeading ||
          atStartOfFollowingParagraph ||
          atStartOfSectionHeadingBackspace ||
          domAtStartOfFollowingParagraph
        ) {
          event.preventDefault();
          return true;
        }

        return false;
      },
      handleDOMEvents: {
        contextmenu: (view, event) => {
          const selection = view.state.selection;
          const nativeSelection = window.getSelection();
          const activeSection = nativeSelection?.anchorNode instanceof Node
            ? nativeSelection.anchorNode.parentElement?.closest(".proposal-editor-section")
            : null;
          if (nativeSelection && activeSection && nativeSelection.rangeCount > 0) {
            const contentRoot = activeSection.querySelector(".proposal-editor-section-content");
            if (contentRoot) {
              nativeSelection.removeAllRanges();
              const safeRange = document.createRange();
              const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
              const safePosition = coords?.pos ?? selection.$from.pos;
              const resolvedSafePosition = view.state.doc.resolve(safePosition);
              safeRange.setStart(contentRoot, 0);
              safeRange.collapse(true);
              nativeSelection.addRange(safeRange);
              view.dispatch(
                view.state.tr.setSelection(TextSelection.near(resolvedSafePosition)),
              );
            }
          }
          window.setTimeout(() => {
            if (view.isDestroyed) return;
            const delayedSelection = window.getSelection();
            if (!delayedSelection || !activeSection) return;
            delayedSelection.removeAllRanges();
            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (coords) {
              view.dispatch(
                view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(coords.pos))),
              );
            }
          }, 0);
          const getSectionDepth = (resolvedPosition) => {
            for (let depth = resolvedPosition.depth; depth > 0; depth -= 1) {
              if (resolvedPosition.node(depth).type.name === "proposalSection") {
                return depth;
              }
            }
            return -1;
          };
          const fromDepth = getSectionDepth(selection.$from);
          const toDepth = getSectionDepth(selection.$to);
          if (fromDepth > 0 && toDepth !== fromDepth) {
            view.dispatch(
              view.state.tr.setSelection(
                TextSelection.near(view.state.doc.resolve(selection.$from.pos)),
              ),
            );
          }
          return false;
        },
      },
      handlePaste: (_view, event) => {
        const selectionParent = _view.state.selection.$from.parent;
        const isSectionTitle =
          selectionParent.type.name === "heading" &&
          Number(selectionParent.attrs?.level) === 2;
        if (keepPastedContentInSection && isSectionTitle) {
          const plainText = event.clipboardData?.getData("text/plain") || "";
          if (plainText) {
            event.preventDefault();
            editor?.chain().focus().insertContent(plainText.replace(/\s*\n+\s*/g, " ")).run();
            return true;
          }
        }

        if (keepPastedContentInSection) {
          const getSectionContext = (resolvedPosition) => {
            for (let depth = resolvedPosition.depth; depth > 0; depth -= 1) {
              if (resolvedPosition.node(depth).type.name === "proposalSection") {
                return {
                  depth,
                  position: resolvedPosition.before(depth),
                };
              }
            }
            return null;
          };
          const fromSection = getSectionContext(_view.state.selection.$from);
          const toSection = getSectionContext(_view.state.selection.$to);
          const selectionParentNames = [];
          for (let depth = _view.state.selection.$from.depth; depth >= 0; depth -= 1) {
            selectionParentNames.push(_view.state.selection.$from.node(depth).type.name);
          }
          const html = event.clipboardData?.getData("text/html") || "";
          if (selectionParentNames.includes("proposalSection") && html) {
            event.preventDefault();
            const container = document.createElement("div");
            container.innerHTML = html;
            container.querySelectorAll("h1, h2").forEach((heading) => {
              const replacement = document.createElement("h3");
              replacement.innerHTML = heading.innerHTML;
              heading.replaceWith(replacement);
            });
            container.querySelectorAll("section[data-proposal-section]").forEach((section) => {
              section.replaceWith(...section.childNodes);
            });

            if (
              !fromSection ||
              !toSection ||
              fromSection.position !== toSection.position
            ) {
              _view.dispatch(
                _view.state.tr.setSelection(
                  TextSelection.near(_view.state.doc.resolve(_view.state.selection.$from.pos)),
                ),
              );
            }
            editor?.chain().focus().insertContent(container.innerHTML).run();
            return true;
          }
        }

        const image = [...(event.clipboardData?.files || [])].find((file) =>
          file.type.startsWith("image/"),
        );
        if (!image) return false;
        event.preventDefault();
        insertImageFile(image);
        return true;
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      const nextContent = currentEditor.getJSON();
      lastExternalContent.current = JSON.stringify(nextContent);
      onChange(nextContent);
    },
  });

  useEffect(() => {
    if (!editor) return;
    const serialized = JSON.stringify(content);
    if (serialized === lastExternalContent.current) return;
    editor.commands.setContent(content, false);
    lastExternalContent.current = serialized;
  }, [content, editor]);

  useImperativeHandle(ref, () => ({
    insertText(text) {
      editor?.chain().focus().insertContent(String(text || "")).run();
    },
    focusAtEnd() {
      if (!editor) return;
      editor.chain().focus().setTextSelection(editor.state.doc.content.size - 1).run();
    },
    getDocument() {
      return editor?.getJSON() || null;
    },
  }), [editor]);

  if (!editor) return null;

  return (
    <div className={`proposal-rich-text-editor${printMode ? " proposal-print-editor" : ""}`} style={(() => { const format = getProposalFormat(formatCode); return { "--proposal-format-accent": format.accent, "--proposal-format-heading": format.heading, "--proposal-format-text": format.text, "--proposal-format-border": format.border, "--proposal-format-surface": format.surface, "--proposal-format-heading-font": format.headingFont, "--proposal-format-body-font": format.bodyFont, "--proposal-format-spacing": format.spacing }; })()}>
      {!readOnly && showToolbar ? (
        <div className="proposal-rich-text-toolbar" role="toolbar" aria-label="Formato">
          <ToolbarButton
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="Negrita"
          >
            <Bold size={16} />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="Cursiva"
          >
            <Italic size={16} />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            title="Lista"
          >
            <List size={16} />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            title="Lista numerada"
          >
            <ListOrdered size={16} />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("heading", { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            title="Encabezado"
          >
            <Heading2 size={16} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()}
            title="Insertar tabla"
          >
            <Table2 size={16} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().insertContent({ type: "proposalPageBreak" }).run()}
            title="Salto de página"
          >
            <FilePlus2 size={16} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => imageInputRef.current?.click()}
            title="Insertar imagen desde archivo"
          >
            <ImagePlus size={16} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => pdfInputRef.current?.click()}
            title="Insertar PDF incrustado"
          >
            <FileText size={16} />
          </ToolbarButton>
          {[2, 3, 4, 5].map((columns) => (
            <ToolbarButton
              key={columns}
              onClick={() => editor.chain().focus().insertContent({ type: "proposalImageRow", attrs: { columns, images: [] } }).run()}
              title={`Insertar fila de ${columns} imágenes`}
            >
              <Grid2X2 size={16} />
            </ToolbarButton>
          ))}
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
            title="Alinear a la izquierda"
          >
            <AlignLeft size={16} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
            title="Centrar"
          >
            <AlignCenter size={16} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
            title="Alinear a la derecha"
          >
            <AlignRight size={16} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            title="Deshacer"
          >
            <Undo2 size={16} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            title="Rehacer"
          >
            <Redo2 size={16} />
          </ToolbarButton>
        </div>
      ) : null}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        hidden
        onChange={(event) => {
          insertImageFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(event) => {
          insertPdfFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <EditorContent editor={editor} className={`proposal-rich-text-content${printMode ? " proposal-print-content" : ""}`} />
    </div>
  );
});

export default ProposalRichTextEditor;
