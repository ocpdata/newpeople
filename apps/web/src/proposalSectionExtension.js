import { Node } from "@tiptap/core";

export const ProposalSection = Node.create({
  name: "proposalSection",
  group: "block",
  content: "heading block*",
  defining: true,

  parseHTML() {
    return [{ tag: "section[data-proposal-section]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "section",
      { ...HTMLAttributes, class: "proposal-editor-section", "data-proposal-section": "" },
      0,
    ];
  },

  addAttributes() {
    return {
      startOnNewPage: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-start-on-new-page") === "true",
        renderHTML: (attributes) =>
          attributes.startOnNewPage ? { "data-start-on-new-page": "true" } : {},
      },
    };
  },
});