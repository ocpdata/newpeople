import { useRef } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ImagePlus, Trash2 } from "lucide-react";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function toImageDataUrl(file, onLoad) {
  if (!file?.type?.startsWith("image/")) return;
  if (file.size > MAX_IMAGE_BYTES) {
    window.alert("La imagen no puede superar 5 MB.");
    return;
  }
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    if (typeof reader.result === "string") onLoad(reader.result);
  });
  reader.readAsDataURL(file);
}

export default function ProposalImageRowNodeView({ node, updateAttributes, selected, editor, getPos }) {
  const inputRefs = useRef([]);
  const columns = Math.min(5, Math.max(2, Number(node.attrs.columns) || 2));
  const images = Array.from({ length: columns }, (_value, index) => node.attrs.images?.[index] || null);

  function setImage(index, file) {
    toImageDataUrl(file, (src) => {
      const nextImages = [...images];
      nextImages[index] = { src, alt: file.name || "Imagen de propuesta" };
      updateAttributes({ images: nextImages });
    });
  }

  function moveRow(direction) {
    const entries = [];
    editor.state.doc.forEach((child, position) => {
      if (child.type.name === "image" || child.type.name === "proposalImageRow") {
        entries.push({ child, position });
      }
    });
    const currentPosition = getPos();
    const currentIndex = entries.findIndex((entry) => entry.position === currentPosition);
    const target = entries[currentIndex + direction];
    if (!target) return;

    const source = entries[currentIndex].child;
    const transaction = editor.state.tr.delete(
      currentPosition,
      currentPosition + source.nodeSize,
    );
    const rawPosition = direction < 0
      ? target.position
      : target.position + target.child.nodeSize;
    const insertPosition = transaction.mapping.map(rawPosition, -1);
    transaction.insert(insertPosition, source);
    editor.view.dispatch(transaction.scrollIntoView());
    window.setTimeout(() => editor.commands.setNodeSelection(insertPosition), 0);
  }

  return (
    <NodeViewWrapper
      className={`proposal-image-row${selected ? " is-selected" : ""}`}
      data-columns={columns}
      contentEditable={false}
      style={{ "--proposal-image-row-columns": columns }}
    >
      {!selected ? null : (
        <div className="proposal-image-row-order-controls">
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => moveRow(-1)} title="Mover fila arriba" aria-label="Mover fila arriba">
            <ChevronUp size={16} />
          </button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => moveRow(1)} title="Mover fila abajo" aria-label="Mover fila abajo">
            <ChevronDown size={16} />
          </button>
        </div>
      )}
      {images.map((image, index) => (
        <div
          className="proposal-image-row-cell"
          key={index}
          tabIndex={0}
          onPaste={(event) => {
            const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith("image/"));
            if (!file) return;
            event.preventDefault();
            event.stopPropagation();
            setImage(index, file);
          }}
        >
          {image ? <img src={image.src} alt={image.alt || "Imagen de propuesta"} /> : null}
          <button type="button" className="proposal-image-row-cell-action" onClick={() => inputRefs.current[index]?.click()} title={image ? "Cambiar imagen" : "Agregar imagen"} aria-label={image ? "Cambiar imagen" : "Agregar imagen"}>
            <ImagePlus size={16} />
          </button>
          {image ? <button type="button" className="proposal-image-row-cell-action" onClick={() => updateAttributes({ images: images.map((item, imageIndex) => imageIndex === index ? null : item) })} title="Quitar imagen" aria-label="Quitar imagen"><Trash2 size={16} /></button> : null}
          <input
            ref={(element) => { inputRefs.current[index] = element; }}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
            hidden
            onChange={(event) => {
              setImage(index, event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
      ))}
    </NodeViewWrapper>
  );
}