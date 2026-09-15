import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import ProposalImageRowNodeView from "./ProposalImageRowNodeView";

export const ProposalImageRow = Node.create({
  name: "proposalImageRow",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      columns: { default: 2 },
      images: { default: [] },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-proposal-image-row]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-proposal-image-row": "" }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ProposalImageRowNodeView);
  },
});