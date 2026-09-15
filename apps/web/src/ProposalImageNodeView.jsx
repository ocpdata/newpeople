import { NodeViewWrapper } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
} from "lucide-react";

export default function ProposalImageNodeView({
  node,
  updateAttributes,
  selected,
  editor,
  getPos,
}) {
  const {
    src,
    alt,
    title,
    width,
    height,
    align = "left",
    verticalAlign = "center",
  } = node.attrs;
  const displayWidth = Number(width) > 0 ? Number(width) : 220;

  function handleResizeStart(event) {
    event.preventDefault();
    event.stopPropagation();
    const image = event.currentTarget.parentElement.querySelector("img");
    const startWidth = image?.getBoundingClientRect().width || Number(width) || 320;
    const startHeight = image?.getBoundingClientRect().height || Number(height) || 180;
    const startX = event.clientX;
    const aspectRatio = startHeight / startWidth;

    function handlePointerMove(moveEvent) {
      const nextWidth = Math.max(120, Math.round(startWidth + moveEvent.clientX - startX));
      updateAttributes({ width: nextWidth, height: Math.round(nextWidth * aspectRatio) });
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }

  function imageEntries() {
    const entries = [];
    editor.state.doc.forEach((child, position) => {
      if (child.type.name === "image") entries.push({ child, position });
    });
    return entries;
  }

  function moveImage(direction) {
    if (direction === "up" || direction === "down") {
      const entries = [];
      editor.state.doc.forEach((child, position) => {
        if (child.type.name === "image" || child.type.name === "proposalImageRow") {
          entries.push({ child, position });
        }
      });
      const currentPosition = getPos();
      const currentIndex = entries.findIndex((entry) => entry.position === currentPosition);
      const target = entries[currentIndex + (direction === "up" ? -1 : 1)];
      if (!target) return;

      const source = entries[currentIndex].child;
      const transaction = editor.state.tr.delete(
        currentPosition,
        currentPosition + source.nodeSize,
      );
      const rawPosition = direction === "up"
        ? target.position
        : target.position + target.child.nodeSize;
      const insertPosition = transaction.mapping.map(rawPosition, -1);
      transaction.insert(insertPosition, source);
      editor.view.dispatch(transaction.scrollIntoView());
      window.setTimeout(() => editor.commands.setNodeSelection(insertPosition), 0);
      return;
    }

    const entries = imageEntries();
    const currentPosition = getPos();
    const index = entries.findIndex((entry) => entry.position === currentPosition);
    let target = direction === "left" ? entries[index - 1] : entries[index + 1];
    if (!target) return;
    const source = entries[index].child;
    const transaction = editor.state.tr.delete(
      currentPosition,
      currentPosition + source.nodeSize,
    );
    const rawPosition =
      direction === "left"
        ? target.position
        : target.position + target.child.nodeSize;
    const insertPosition = transaction.mapping.map(rawPosition, -1);
    transaction.insert(insertPosition, source);
    editor.view.dispatch(transaction.scrollIntoView());
    window.setTimeout(() => editor.commands.setNodeSelection(insertPosition), 0);
  }

  function updateAlignment(horizontal, vertical, group) {
    const selectedPosition = getPos();
    const positions = group
      ? [...editor.view.dom.querySelectorAll(".proposal-image-node-view")]
          .filter((element) => {
            const selected = editor.view.domAtPos(selectedPosition).node;
            const selectedRect = selected?.getBoundingClientRect?.();
            const rect = element.getBoundingClientRect();
            return selectedRect && Math.abs(rect.top - selectedRect.top) < 8;
          })
          .map((element) => editor.view.posAtDOM(element, 0))
      : [selectedPosition];
    const transaction = editor.state.tr;
    positions.forEach((position) => {
      const current = editor.state.doc.nodeAt(position);
      if (current) {
        transaction.setNodeMarkup(position, undefined, {
          ...current.attrs,
          ...(horizontal ? { align: horizontal } : {}),
          ...(vertical ? { verticalAlign: vertical } : {}),
        });
      }
    });
    editor.view.dispatch(transaction);
  }

  return (
    <NodeViewWrapper
      className={`proposal-image-node-view is-align-${align}${selected ? " is-selected" : ""}`}
      data-vertical-align={verticalAlign}
      data-drag-handle
      draggable="false"
      style={{
        width: `${displayWidth}px`,
        "--proposal-image-width": `${displayWidth}px`,
      }}
    >
      <img
        src={src}
        alt={alt || "Imagen de propuesta"}
        title={title || undefined}
        width={width || undefined}
        height={height || undefined}
        draggable="false"
      />
      {!selected ? null : (
        <>
          <div className="proposal-image-order-controls">
            <button type="button" onClick={() => moveImage("up")} title="Mover arriba" aria-label="Mover arriba"><ArrowUp size={16} /></button>
            <button type="button" onClick={() => moveImage("down")} title="Mover abajo" aria-label="Mover abajo"><ArrowDown size={16} /></button>
            <button type="button" onClick={() => updateAlignment("left", null, false)} title="Alinear a la izquierda" aria-label="Alinear a la izquierda"><AlignLeft size={16} /></button>
            <button type="button" onClick={() => updateAlignment("center", null, false)} title="Centrar horizontalmente" aria-label="Centrar horizontalmente"><AlignCenter size={16} /></button>
            <button type="button" onClick={() => updateAlignment("right", null, false)} title="Alinear a la derecha" aria-label="Alinear a la derecha"><AlignRight size={16} /></button>
          </div>
          <button
            type="button"
            className="proposal-image-resize-handle"
            aria-label="Cambiar tamaño de imagen"
            onPointerDown={handleResizeStart}
          />
        </>
      )}
    </NodeViewWrapper>
  );
}
