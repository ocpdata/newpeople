import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import {
  Bold,
  Columns3,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Rows3,
  Table2,
  Trash2,
  X,
  Undo2,
} from "lucide-react";
import "../proposal-document-module.css";
import { getProposalFormat } from "../../../../shared/proposal-formats.js";

function ToolbarButton({ active = false, disabled = false, onClick, title, children }) {
  return (
    <button
      type="button"
      className={active ? "is-active" : ""}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  );
}

const EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [3] },
    link: { openOnClick: false, autolink: true },
    underline: false,
    strike: false,
    code: false,
    codeBlock: false,
    blockquote: false,
    horizontalRule: false,
  }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
];

// Body of one technical section. It uses the same editor look and toolbar as the proposal document, limited to the
// formatting the technical scope supports (text, headings, lists and tables).
export default function SectionRichEditor({ content, onChange, readOnly = false, label = "Contenido de la sección" }) {
  const editor = useEditor({
    extensions: EXTENSIONS,
    content,
    editable: !readOnly,
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor: current }) => onChange?.(current.getJSON()),
    editorProps: { attributes: { "aria-label": label, role: "textbox", "aria-multiline": "true" } },
  });

  if (!editor) return null;
  const format = getProposalFormat("basic");
  const inTable = editor.isActive("table");

  return (
    <div
      className="proposal-rich-text-editor ts-rich-editor"
      style={{
        "--proposal-format-accent": format.accent,
        "--proposal-format-heading": format.heading,
        "--proposal-format-text": format.text,
        "--proposal-format-border": format.border,
        "--proposal-format-surface": format.surface,
        "--proposal-format-heading-font": format.headingFont,
        "--proposal-format-body-font": format.bodyFont,
        "--proposal-format-spacing": format.spacing,
      }}
    >
      {readOnly ? null : (
        <div className="proposal-rich-text-toolbar" role="toolbar" aria-label="Formato">
          <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Negrita">
            <Bold size={16} />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Cursiva">
            <Italic size={16} />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive("heading")} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Subtítulo">
            <Heading3 size={16} />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Lista con viñetas">
            <List size={16} />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Lista numerada">
            <ListOrdered size={16} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()}
            title="Insertar tabla"
          >
            <Table2 size={16} />
          </ToolbarButton>
          {inTable ? (
            <>
              <ToolbarButton onClick={() => editor.chain().focus().addRowAfter().run()} title="Agregar fila">
                <Rows3 size={16} />
              </ToolbarButton>
              <ToolbarButton onClick={() => editor.chain().focus().addColumnAfter().run()} title="Agregar columna">
                <Columns3 size={16} />
              </ToolbarButton>
              <ToolbarButton onClick={() => editor.chain().focus().deleteRow().run()} title="Quitar fila">
                <Trash2 size={16} />
              </ToolbarButton>
              <ToolbarButton onClick={() => editor.chain().focus().deleteTable().run()} title="Quitar tabla">
                <X size={16} />
              </ToolbarButton>
            </>
          ) : null}
          <ToolbarButton disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()} title="Deshacer">
            <Undo2 size={16} />
          </ToolbarButton>
          <ToolbarButton disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()} title="Rehacer">
            <Redo2 size={16} />
          </ToolbarButton>
        </div>
      )}
      <EditorContent editor={editor} className="proposal-rich-text-content" />
    </div>
  );
}
