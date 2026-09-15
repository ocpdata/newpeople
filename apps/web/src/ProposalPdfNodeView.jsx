import { NodeViewWrapper } from "@tiptap/react";

export default function ProposalPdfNodeView({ node, selected }) {
  const { src, fileName } = node.attrs;

  return (
    <NodeViewWrapper
      className={`proposal-pdf-node-view${selected ? " is-selected" : ""}`}
      data-drag-handle
    >
      {src ? (
        <iframe src={src} title={fileName} loading="lazy" />
      ) : (
        <p className="proposal-pdf-missing">No se encontró el archivo PDF.</p>
      )}
      {src ? <a className="proposal-pdf-open-link" href={src} download={fileName} target="_blank" rel="noreferrer">Abrir o descargar {fileName}</a> : null}
      <span className="proposal-pdf-file-name">{fileName}</span>
    </NodeViewWrapper>
  );
}
