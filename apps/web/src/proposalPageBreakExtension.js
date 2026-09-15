import { Node } from "@tiptap/core";

export const ProposalPageBreak = Node.create({
  name: "proposalPageBreak",
  group: "block",
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: "div[data-proposal-page-break]" }];
  },

  renderHTML() {
    return ["div", { "data-proposal-page-break": "" }];
  },
});