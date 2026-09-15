import { PDFDocument } from "pdf-lib";

function collectPdfNodes(nodes, result) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (node?.type === "proposalPdf") {
      result.push(node);
    }
    collectPdfNodes(node?.content, result);
  }
}

export function getEmbeddedPdfNodes(content) {
  const nodes = [];
  collectPdfNodes(content?.document?.content, nodes);
  for (const section of Array.isArray(content?.sections) ? content.sections : []) {
    collectPdfNodes(section?.content?.content, nodes);
  }
  return nodes;
}

export function hasGraphicNodes(content) {
  const visit = (nodes) => (Array.isArray(nodes) ? nodes : []).some((node) =>
    ["image", "proposalImageRow", "proposalPdf"].includes(node?.type) || visit(node?.content),
  );
  return visit(content?.document?.content) || (Array.isArray(content?.sections) && content.sections.some((section) => visit(section?.content?.content)));
}

export function dataUrlToBuffer(value) {
  const match = String(value || "").match(/^data:application\/pdf;base64,(.+)$/i);
  return match ? Buffer.from(match[1], "base64") : null;
}

export async function replacePdfPlaceholders(baseBuffer, placeholders) {
  if (!placeholders?.length) return baseBuffer;

  const base = await PDFDocument.load(baseBuffer);
  const output = await PDFDocument.create();
  const replacements = new Map(
    placeholders.map((placeholder) => [placeholder.pageIndex, placeholder.sourceBuffer]),
  );

  for (let pageIndex = 0; pageIndex < base.getPageCount(); pageIndex += 1) {
    const sourceBuffer = replacements.get(pageIndex);
    if (sourceBuffer) {
      try {
        const source = await PDFDocument.load(sourceBuffer);
        const pages = await output.copyPages(source, source.getPageIndices());
        pages.forEach((page) => output.addPage(page));
        continue;
      } catch {
        // Keep the placeholder page when an embedded file is malformed.
      }
    }
    const [page] = await output.copyPages(base, [pageIndex]);
    output.addPage(page);
  }

  return Buffer.from(await output.save());
}
