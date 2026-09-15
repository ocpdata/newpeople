import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import ProposalPdfNodeView from "./ProposalPdfNodeView";

export const ProposalPdf = Node.create({
  name: "proposalPdf",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: "" },
      fileName: { default: "documento.pdf" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-proposal-pdf]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-proposal-pdf": "" }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ProposalPdfNodeView);
  },
});
