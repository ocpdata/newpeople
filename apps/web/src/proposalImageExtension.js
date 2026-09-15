import { ReactNodeViewRenderer } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import { NodeSelection, Plugin } from "prosemirror-state";
import ProposalImageNodeView from "./ProposalImageNodeView";

export const ProposalImage = Image.extend({
  name: "image",

  draggable: true,

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => element.getAttribute("width") || null,
        renderHTML: (attributes) =>
          attributes.width ? { width: attributes.width } : {},
      },
      height: {
        default: null,
        parseHTML: (element) => element.getAttribute("height") || null,
        renderHTML: (attributes) =>
          attributes.height ? { height: attributes.height } : {},
      },
      align: {
        default: "left",
        parseHTML: (element) => element.getAttribute("data-align") || "left",
        renderHTML: (attributes) => ({ "data-align": attributes.align || "left" }),
      },
      verticalAlign: {
        default: "center",
        parseHTML: (element) => element.getAttribute("data-vertical-align") || "center",
        renderHTML: (attributes) => ({ "data-vertical-align": attributes.verticalAlign || "center" }),
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ProposalImageNodeView);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            dragover: (_view, event) => {
              event.preventDefault();
              const imageElements = [
                ..._view.dom.querySelectorAll(".proposal-image-node-view"),
              ];
              imageElements.forEach((element) =>
                element.classList.remove("is-drop-target"),
              );
              const target = imageElements
                .map((element) => ({
                  element,
                  rect: element.getBoundingClientRect(),
                }))
                .filter(({ element }) => !element.classList.contains("is-dragging"))
                .sort((left, right) => {
                  const leftDistance = Math.hypot(
                    event.clientX - (left.rect.left + left.rect.width / 2),
                    event.clientY - (left.rect.top + left.rect.height / 2),
                  );
                  const rightDistance = Math.hypot(
                    event.clientX - (right.rect.left + right.rect.width / 2),
                    event.clientY - (right.rect.top + right.rect.height / 2),
                  );
                  return leftDistance - rightDistance;
                })[0];
              if (target) target.element.classList.add("is-drop-target");
              return true;
            },
            dragend: (view) => {
              view.dom
                .querySelectorAll(".proposal-image-node-view")
                .forEach((element) => element.classList.remove("is-drop-target"));
              return false;
            },
          },
          handleDrop: (view, event) => {
            const sourcePosition = Number(
              event.dataTransfer?.getData("application/x-proposal-image-position"),
            );
            if (!Number.isInteger(sourcePosition)) return false;

            const sourceNode = view.state.doc.nodeAt(sourcePosition);
            if (!sourceNode || sourceNode.type.name !== "image") return false;
            const imageElements = [
              ...view.dom.querySelectorAll(".proposal-image-node-view"),
            ];
            const targets = imageElements
              .map((element) => ({
                element,
                rect: element.getBoundingClientRect(),
                position: view.posAtDOM(element, 0),
              }))
              .filter(({ position }) => position !== sourcePosition)
              .sort((left, right) => {
                const leftDistance = Math.hypot(
                  event.clientX - (left.rect.left + left.rect.width / 2),
                  event.clientY - (left.rect.top + left.rect.height / 2),
                );
                const rightDistance = Math.hypot(
                  event.clientX - (right.rect.left + right.rect.width / 2),
                  event.clientY - (right.rect.top + right.rect.height / 2),
                );
                return leftDistance - rightDistance;
              });
            const target = targets[0];

            const transaction = view.state.tr.delete(
              sourcePosition,
              sourcePosition + sourceNode.nodeSize,
            );
            const targetNode = target && view.state.doc.nodeAt(target.position);
            const insertBefore = target
              ? event.clientY < target.rect.top + target.rect.height / 2 ||
                (Math.abs(event.clientY - (target.rect.top + target.rect.height / 2)) <
                  target.rect.height / 2 &&
                  event.clientX < target.rect.left + target.rect.width / 2)
              : false;
            const rawPosition = target
              ? insertBefore
                ? target.position
                : target.position + targetNode.nodeSize
              : view.state.doc.content.size;
            const insertPosition = transaction.mapping.map(rawPosition, -1);
            if (insertPosition === sourcePosition) return false;
            transaction.insert(insertPosition, sourceNode);
            if (insertPosition <= transaction.doc.content.size) {
              transaction.setSelection(
                NodeSelection.create(transaction.doc, insertPosition),
              );
            }
            view.dispatch(transaction.scrollIntoView());
            imageElements.forEach((element) =>
              element.classList.remove("is-drop-target", "is-dragging"),
            );
            return true;
          },
        },
      }),
    ];
  },
});
