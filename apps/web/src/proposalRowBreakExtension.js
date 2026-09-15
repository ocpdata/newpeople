import { Node } from "@tiptap/core";

export const ProposalRowBreak = Node.create({
  name: "proposalRowBreak",
  group: "block",
  atom: true,
  selectable: false,

  parseHTML() {
    return [{ tag: "div[data-proposal-row-break]" }];
  },

  renderHTML() {
    return ["div", { "data-proposal-row-break": "" }];
  },
});
