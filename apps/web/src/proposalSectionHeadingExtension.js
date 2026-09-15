import Heading from "@tiptap/extension-heading";
import { ReactNodeViewRenderer } from "@tiptap/react";
import ProposalSectionHeadingNodeView from "./ProposalSectionHeadingNodeView";
import { shouldPreventSectionHeadingKey } from "./proposalSectionHeadingGuard";

export { shouldPreventSectionHeadingKey } from "./proposalSectionHeadingGuard";

export const ProposalSectionHeading = Heading.extend({
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        return shouldPreventSectionHeadingKey("Enter", $from);
      },
      Backspace: ({ editor }) => {
        const { $from } = editor.state.selection;
        return shouldPreventSectionHeadingKey("Backspace", $from);
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ProposalSectionHeadingNodeView);
  },
});