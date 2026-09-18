import { useEffect, useState } from "react";
import { NodeViewWrapper } from "@tiptap/react";

function usePdfViewerUrl(source) {
  const [viewerUrl, setViewerUrl] = useState("");

  useEffect(() => {
    if (!source) {
      setViewerUrl("");
      return undefined;
    }

    if (!source.startsWith("data:application/pdf")) {
      setViewerUrl(source);
      return undefined;
    }

    let objectUrl = "";
    try {
      const [, encoded = ""] = source.split(",", 2);
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      setViewerUrl(objectUrl);
    } catch {
      setViewerUrl(source);
    }

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source]);

  return viewerUrl;
}

export default function ProposalPdfNodeView({ node, selected }) {
  const { src, fileName } = node.attrs;
  const viewerUrl = usePdfViewerUrl(src);

  return (
    <NodeViewWrapper
      className={`proposal-pdf-node-view${selected ? " is-selected" : ""}`}
      data-drag-handle
    >
      {viewerUrl ? (
        <iframe src={viewerUrl} title={fileName} loading="eager" />
      ) : (
        <p className="proposal-pdf-missing">No se encontró el archivo PDF.</p>
      )}
      {src ? <a className="proposal-pdf-open-link" href={src} download={fileName} target="_blank" rel="noreferrer">Abrir o descargar {fileName}</a> : null}
      <span className="proposal-pdf-file-name">{fileName}</span>
    </NodeViewWrapper>
  );
}
