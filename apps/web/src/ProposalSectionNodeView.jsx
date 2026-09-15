import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";

export default function ProposalSectionNodeView({ node }) {
  return (
    <NodeViewWrapper
      className={`proposal-editor-section${node.attrs.startOnNewPage ? " starts-new-page" : ""}`}
      data-start-on-new-page={node.attrs.startOnNewPage ? "true" : undefined}
    >
      <NodeViewContent className="proposal-editor-section-content" />
    </NodeViewWrapper>
  );
}