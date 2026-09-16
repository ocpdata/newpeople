import PDFDocument from "pdfkit";
import { PDFDocument as PDFLibDocument } from "pdf-lib";
import SVGtoPDF from "svg-to-pdfkit";
import { dataUrlToBuffer, replacePdfPlaceholders } from "./embedded-pdf.js";
import { getProposalFormat } from "../../../../shared/proposal-formats.js";
import { addProposalPageNumbers } from "./page-numbers.js";

const PAGE_MARGIN = 54;
const SECTION_GAP = 20;
const PAGE_HEADER_CLEARANCE = 56;

function bufferPdfDocument(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

async function insertPdfTableOfContents(baseBuffer, entries, format) {
  const tocDoc = new PDFDocument({ size: "LETTER", margin: PAGE_MARGIN });
  const tocBufferPromise = bufferPdfDocument(tocDoc);
  tocDoc.font("Helvetica-Bold").fontSize(20).fillColor(format.heading).text("Contenido");
  tocDoc.moveDown(1);
  entries.forEach((entry) => {
    tocDoc.font("Helvetica").fontSize(11).fillColor(format.text).text(entry.title, { continued: false });
    tocDoc.moveDown(0.35);
  });
  tocDoc.end();
  const [base, toc] = await Promise.all([PDFLibDocument.load(baseBuffer), tocBufferPromise.then((buffer) => PDFLibDocument.load(buffer))]);
  const output = await PDFLibDocument.create();
  const [cover] = await output.copyPages(base, [0]);
  output.addPage(cover);
  const [tocPage] = await output.copyPages(toc, [0]);
  output.addPage(tocPage);
  const rest = await output.copyPages(base, Array.from({ length: Math.max(0, base.getPageCount() - 1) }, (_, index) => index + 1));
  rest.forEach((page) => output.addPage(page));
  return Buffer.from(await output.save());
}

async function shiftTocPagesForEmbeddedPdfs(entries, placeholders) {
  const shifts = await Promise.all((placeholders || []).map(async (placeholder) => {
    try {
      const source = await PDFLibDocument.load(placeholder.sourceBuffer);
      return { page: placeholder.pageIndex + 1, extra: Math.max(0, source.getPageCount() - 1) };
    } catch {
      return { page: placeholder.pageIndex + 1, extra: 0 };
    }
  }));
  return entries.map((entry) => ({
    ...entry,
    page: entry.page + shifts.reduce((total, shift) => total + (entry.page > shift.page ? shift.extra : 0), 0),
  }));
}

function asText(value) {
  return String(value ?? "").trim();
}

function renderCoverParty(doc, { label, name, address, x, y, width, textColor, mutedColor }) {
  doc.font("Helvetica-Bold").fontSize(8).fillColor(mutedColor).text(label.toUpperCase(), x, y, { width, characterSpacing: 1 });
  doc.font("Helvetica-Bold").fontSize(15).fillColor(textColor).text(name, x, y + 17, { width });
  if (address) {
    doc.font("Helvetica").fontSize(9.5).fillColor(mutedColor).text(address, x, y + 39, { width, lineGap: 2 });
  }
}

function renderCoverFocus(doc, { textColor, dividerColor, pageWidth, pageHeight }) {
  const items = [
    "Mejorar el core de la red con DDI (DNS, DHCP, IPAM).",
    "Visibilidad y control del tráfico DNS para evitar fuga de información y amenazas.",
    "Optimizar y asegurar la entrega de aplicaciones.",
    "Brindar servicios de migración a nube y optimización.",
    "Mejorar la seguridad de las comunicaciones con la nube.",
    "Brindar la máxima seguridad y confidencialidad para las transacciones.",
  ];
  const startY = pageHeight - 158;
  const columnWidth = (pageWidth - PAGE_MARGIN * 2) / 3;
  items.forEach((item, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const x = PAGE_MARGIN + column * columnWidth;
    const y = startY + row * 64;
    if (column > 0) {
      doc.moveTo(x - 14, y).lineTo(x - 14, y + 44).strokeColor(dividerColor).lineWidth(0.6).stroke();
    }
    doc.font("Helvetica").fontSize(10).fillColor(textColor).text(item, x, y + 2, { width: columnWidth - 22, align: "center", lineGap: 1 });
  });
}

function resolveTemplateText(text, templateContext) {
  return asText(text).replace(
    /\{\{\s*(client_name|contact_name|company_name)\s*\}\}/g,
    (match, token) => templateContext[token] || match,
  );
}

function renderBlock(doc, block, templateContext) {
  if (block.type === "heading") {
    doc
      .moveDown(0.4)
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("#173d72")
      .text(resolveTemplateText(block.text, templateContext));
    return;
  }

  if (block.type === "list") {
    const items = Array.isArray(block.items)
        ? block.items
          .map((item) => resolveTemplateText(item, templateContext))
          .filter(Boolean)
      : [];
    if (!items.length) return;
    doc.moveDown(0.2).font("Helvetica").fontSize(10.5).fillColor("#1d2730");
    doc.list(items, { bulletRadius: 2, textIndent: 12 });
    return;
  }

  const text = resolveTemplateText(block.text, templateContext);
  if (!text) return;
  doc
    .moveDown(0.2)
    .font("Helvetica")
    .fontSize(10.5)
    .fillColor("#1d2730")
    .text(text, { align: "justify", lineGap: 2 });
}

function renderTiptapInlineText(node, templateContext) {
  if (node?.type === "text") {
    return resolveTemplateText(node.text, templateContext);
  }
  if (Array.isArray(node?.content)) {
    return node.content.map((child) => renderTiptapInlineText(child, templateContext)).join("");
  }
  return "";
}

function getTiptapImageBox(doc, node) {
  const requestedWidth = Number(node.attrs?.width) * 0.75;
  const requestedHeight = Number(node.attrs?.height) * 0.75;
  return {
    width:
      Number.isFinite(requestedWidth) && requestedWidth > 0
        ? requestedWidth
        : 165,
    height:
      Number.isFinite(requestedHeight) && requestedHeight > 0
        ? requestedHeight
        : 165,
  };
}

function renderTiptapImage(doc, node, x, y, width, height) {
  const source = asText(node.attrs?.src);
  if (!source.startsWith("data:image/")) return false;
  const [header, encodedData = ""] = source.split(",", 2);
  try {
    if (header.startsWith("data:image/svg+xml")) {
      const svg = header.includes(";base64")
        ? Buffer.from(encodedData, "base64").toString("utf8")
        : decodeURIComponent(encodedData);
      SVGtoPDF(doc, svg, x, y, {
        width,
        height,
        preserveAspectRatio: "xMinYMin meet",
      });
      return true;
    }
    if (/^data:image\/(png|jpe?g);base64$/i.test(header)) {
      doc.image(Buffer.from(encodedData, "base64"), x, y, {
        fit: [width, height],
        align: "left",
        valign: "top",
      });
      return true;
    }
  } catch (error) {
    return false;
  }
  return false;
}

function renderCoverPhoto(doc, source) {
  const match = asText(source).match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
  if (!match) return false;
  try {
    doc.image(Buffer.from(match[2], "base64"), 0, 0, {
      cover: [doc.page.width, doc.page.height],
      align: "center",
      valign: "center",
    });
    return true;
  } catch {
    return false;
  }
}

function renderTiptapImageRowNode(doc, node) {
  const images = (node.attrs?.images || [])
    .filter((image) => image?.src)
    .map((image) => ({ type: "image", attrs: image }));
  if (images.length) renderTiptapImageRow(doc, images);
}

function renderTiptapImageRow(doc, nodes) {
  const maxWidth = doc.page.width - PAGE_MARGIN * 2;
  const gap = 10;
  const maxRowHeight = 180;
  const boxes = nodes.map((node) => getTiptapImageBox(doc, node));
  const totalWidth = boxes.reduce((sum, box) => sum + box.width, 0);
  const availableForImages = maxWidth - gap * Math.max(0, nodes.length - 1);
  const widthScale = totalWidth > availableForImages ? availableForImages / totalWidth : 1;
  const naturalRowHeight = Math.max(...boxes.map((box) => box.height), 0);
  const heightScale =
    naturalRowHeight > maxRowHeight ? maxRowHeight / naturalRowHeight : 1;
  const scale = Math.min(widthScale, heightScale);
  const scaledBoxes = boxes.map((box) => ({
    width: box.width * scale,
    height: box.height * scale,
  }));
  const rowHeight = Math.max(...scaledBoxes.map((box) => box.height), 0);
  if (!rowHeight) return;

  if (doc.y + rowHeight > doc.page.height - PAGE_MARGIN) {
    doc.addPage();
  }
  const startX = doc.x;
  const startY = doc.y;
  let x = startX;
  nodes.forEach((node, index) => {
    const box = scaledBoxes[index];
    const imageX =
      nodes.length === 1 && node.attrs?.align === "center"
        ? startX + (maxWidth - box.width) / 2
        : nodes.length === 1 && node.attrs?.align === "right"
          ? startX + maxWidth - box.width
          : x;
    const imageY =
      node.attrs?.verticalAlign === "bottom"
        ? startY + rowHeight - box.height
        : node.attrs?.verticalAlign === "center"
          ? startY + (rowHeight - box.height) / 2
          : startY;
    renderTiptapImage(doc, node, imageX, imageY, box.width, box.height);
    x += box.width + gap;
  });
  doc.y = startY + rowHeight + 12;
}

function estimateImageGalleryHeight(nodes) {
  let rows = 0;
  let hasImagesInRow = false;
  let hasImages = false;
  for (const node of nodes) {
    if (node.type === "image") {
      hasImages = true;
      hasImagesInRow = true;
    } else if (node.type === "proposalRowBreak") {
      if (hasImagesInRow) rows += 1;
      hasImagesInRow = false;
    }
  }
  if (hasImagesInRow) rows += 1;
  return hasImages ? rows * 192 : 0;
}

function renderTiptapNode(doc, node, templateContext, embeddedPlaceholders, format) {
  if (!node) return;
  if (node.type === "image") {
    renderTiptapImageRow(doc, [node]);
    return;
  }
  if (node.type === "proposalImageRow") {
    renderTiptapImageRowNode(doc, node);
    return;
  }
  if (node.type === "proposalPdf") {
    const sourceBuffer = dataUrlToBuffer(node.attrs?.src);
    if (!sourceBuffer) return;
    if (doc.y > PAGE_MARGIN + PAGE_HEADER_CLEARANCE + 60) doc.addPage();
    const pageIndex = doc.bufferedPageRange().count - 1;
    doc.font("Helvetica").fontSize(11).fillColor("#5d7391").text(
      `PDF incrustado: ${asText(node.attrs?.fileName) || "documento.pdf"}`,
    );
    embeddedPlaceholders.push({ pageIndex, sourceBuffer });
    return;
  }
  if (node.type === "bulletList" || node.type === "orderedList") {
    const items = (node.content || [])
      .map((item) => renderTiptapInlineText(item, templateContext))
      .filter(Boolean);
    if (items.length) {
      doc.font("Helvetica").fontSize(format.code === "technical" ? 9.5 : 10.5).fillColor(format.text);
      doc.list(items, { bulletRadius: 2, textIndent: 12 });
    }
    return;
  }
  if (node.type === "heading") {
    doc
      .moveDown(format.code === "technical" ? 0.2 : format.code === "premium" ? 0.7 : 0.4)
      .font("Helvetica-Bold")
      .fontSize(format.code === "technical" ? 10.5 : format.code === "premium" ? 14 : 12)
      .fillColor(format.heading)
      .text(renderTiptapInlineText(node, templateContext));
    return;
  }
  if (node.type === "paragraph") {
    const text = renderTiptapInlineText(node, templateContext);
    if (text) {
      doc
        .moveDown(format.code === "technical" ? 0.1 : format.code === "premium" ? 0.35 : 0.2)
        .font("Helvetica")
        .fontSize(format.code === "technical" ? 9.5 : format.code === "premium" ? 11 : 10.5)
        .fillColor(format.text)
        .text(text, { align: "justify", lineGap: 2 });
    }
    return;
  }
  for (const child of node.content || []) {
    renderTiptapNode(doc, child, templateContext, embeddedPlaceholders, format);
  }
}

export async function renderProposalDocumentPdfBuffer({ title, content }) {
  const format = content?.metadata?.format_snapshot || getProposalFormat(content?.metadata?.format_code);
  const sourceContext = content?.metadata?.source_context || {};
  const templateContext = {
    client_name: asText(sourceContext.account_name) || "cliente",
    contact_name: asText(sourceContext.contact_name) || "contacto",
    company_name:
      asText(sourceContext.company_name) ||
      asText(content?.metadata?.company_name) ||
      "nuestra empresa",
    client_address: asText(sourceContext.client_address),
    company_address: asText(sourceContext.company_address),
  };
  const doc = new PDFDocument({
    size: "LETTER",
    margin: PAGE_MARGIN,
    bufferPages: true,
    info: {
      Title: asText(title) || "Propuesta",
      Author: "NewPeople CRM",
      Subject: "Propuesta técnica",
      Creator: "NewPeople API",
    },
  });
  const pendingBuffer = bufferPdfDocument(doc);
  const embeddedPlaceholders = [];
  const tocEntries = [];

  const pageWidth = doc.page.width - PAGE_MARGIN * 2;
  const pageHeight = doc.page.height - PAGE_MARGIN * 2;
  const cover = content?.metadata?.cover || {};
  doc.save();
  const hasCoverPhoto = renderCoverPhoto(doc, cover.image_url);
  if (!hasCoverPhoto) doc.rect(0, 0, doc.page.width, doc.page.height).fill(format.surface);
  if (hasCoverPhoto) {
    doc.fillOpacity(0.66).rect(0, 0, doc.page.width, doc.page.height).fill("#091e3b").fillOpacity(1);
  }
  if (format.code === "enterprise") {
    if (!hasCoverPhoto) doc.rect(0, 0, doc.page.width * 0.34, doc.page.height).fill(format.accent);
    doc.fillColor(hasCoverPhoto ? "#ffffff" : format.heading).font("Helvetica-Bold").fontSize(22).text("PROPUESTA COMERCIAL", PAGE_MARGIN + pageWidth * 0.34, PAGE_MARGIN + pageHeight * 0.28, { width: pageWidth * 0.58 });
  } else {
    if (!hasCoverPhoto) doc.rect(0, 0, doc.page.width, doc.page.height * 0.18).fill(format.accent);
    doc.fillColor(hasCoverPhoto ? "#ffffff" : format.accent).font("Helvetica-Bold").fontSize(12).text("PROPUESTA COMERCIAL", PAGE_MARGIN, PAGE_MARGIN + pageHeight * 0.25);
  }
  const coverTextX = PAGE_MARGIN + (format.code === "enterprise" ? pageWidth * 0.34 : 0);
  const coverTextWidth = format.code === "enterprise" ? pageWidth * 0.58 : pageWidth;
  const coverTextColor = hasCoverPhoto ? "#ffffff" : format.heading;
  const coverMutedColor = hasCoverPhoto ? "#e8f1ff" : format.text;
  doc.fillColor(coverTextColor).font("Helvetica-Bold").fontSize(format.code === "enterprise" ? 30 : 26).text(asText(title) || "Propuesta", coverTextX, PAGE_MARGIN + pageHeight * 0.34, { width: coverTextWidth });
  renderCoverParty(doc, {
    label: "Preparado para",
    name: templateContext.client_name,
    address: templateContext.client_address || "Dirección del cliente",
    x: coverTextX,
    y: PAGE_MARGIN + pageHeight * 0.55,
    width: coverTextWidth * 0.46,
    textColor: coverTextColor,
    mutedColor: coverMutedColor,
  });
  renderCoverParty(doc, {
    label: "Preparado por",
    name: templateContext.company_name,
    address: templateContext.company_address,
    x: coverTextX + coverTextWidth * 0.54,
    y: PAGE_MARGIN + pageHeight * 0.55,
    width: coverTextWidth * 0.46,
    textColor: coverTextColor,
    mutedColor: coverMutedColor,
  });
  doc.fillColor(coverMutedColor).font("Helvetica").fontSize(9.5).text(`Propuesta diseñada el ${new Date().toLocaleDateString("es-MX")}`, coverTextX, PAGE_MARGIN + pageHeight * 0.76);
  renderCoverFocus(doc, {
    textColor: hasCoverPhoto ? "#ffffff" : format.heading,
    dividerColor: hasCoverPhoto ? "#a8b9cf" : format.border,
    pageWidth: doc.page.width,
    pageHeight: doc.page.height,
  });
  doc.restore();
  doc.addPage();
  doc.y += PAGE_HEADER_CLEARANCE;

  doc
    .font("Helvetica-Bold")
    .fontSize(format.code === "technical" ? 17 : format.code === "minimal" ? 19 : 22)
    .fillColor(format.heading)
    .text(asText(title) || "Propuesta técnica");
  doc.moveDown(0.8);

  const sections = Array.isArray(content?.sections) ? content.sections : [];
  const documentNodes = content?.schema_version >= 3 && content?.document?.type === "doc"
    ? content.document.content || []
    : null;
  if (documentNodes) {
    let renderedSection = false;
    for (let sectionIndex = 0; sectionIndex < documentNodes.length; sectionIndex += 1) {
      const section = documentNodes[sectionIndex];
      if (section?.type !== "proposalSection") {
        renderTiptapNode(doc, section, templateContext, embeddedPlaceholders, format);
        continue;
      }
      const nodes = section.content || [];
      const hasRenderableContent = nodes.some((node) => {
        if (node?.type === "paragraph" || node?.type === "heading") {
          return renderTiptapInlineText(node, templateContext).trim().length > 0;
        }
        return node?.type !== "proposalRowBreak";
      });
      if (!hasRenderableContent) continue;
      if (section.attrs?.startOnNewPage && renderedSection && doc.y > PAGE_MARGIN + 24) {
        doc.addPage();
        doc.y += PAGE_HEADER_CLEARANCE;
      }
      if (doc.y > doc.page.height - PAGE_MARGIN - 90) {
        doc.addPage();
        doc.y += PAGE_HEADER_CLEARANCE;
      }
      renderedSection = true;
      const heading = nodes.find((node) => node?.type === "heading");
      tocEntries.push({ title: renderTiptapInlineText(heading || section, templateContext).trim() || "Sección", page: doc.bufferedPageRange().count + 1 });
      for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
        const node = nodes[nodeIndex];
        if (node.type === "proposalPdf") {
          renderTiptapNode(doc, node, templateContext, embeddedPlaceholders, format);
          const nextDocumentNode = documentNodes[sectionIndex + 1];
          const nextSectionStartsOnNewPage =
            nextDocumentNode?.type === "proposalSection" && nextDocumentNode.attrs?.startOnNewPage;
          if (nodeIndex < nodes.length - 1 || (sectionIndex < documentNodes.length - 1 && !nextSectionStartsOnNewPage)) {
            doc.addPage();
          }
          continue;
        }
        renderTiptapNode(doc, node, templateContext, embeddedPlaceholders, format);
      }
      doc.moveDown(SECTION_GAP / 12);
    }
    doc.end();
    const withEmbeddedPdfs = await replacePdfPlaceholders(await pendingBuffer, embeddedPlaceholders);
    const adjustedTocEntries = await shiftTocPagesForEmbeddedPdfs(tocEntries, embeddedPlaceholders);
    const withToc = await insertPdfTableOfContents(withEmbeddedPdfs, adjustedTocEntries, format);
    return addProposalPageNumbers(withToc, { format });
  }

  for (const section of sections) {
    const sectionNodes =
      section.content?.type === "doc" ? section.content.content || [] : [];
    const isCertificationSection = String(section.title || "")
      .trim()
      .toLowerCase()
      .includes("certificacion");
    if (isCertificationSection) {
      const galleryHeight = estimateImageGalleryHeight(sectionNodes);
      if (
        galleryHeight &&
        doc.y + 40 + galleryHeight > doc.page.height - PAGE_MARGIN
      ) {
        doc.addPage();
        doc.y += PAGE_HEADER_CLEARANCE;
      }
    }
    if (doc.y > doc.page.height - PAGE_MARGIN - 90) {
      doc.addPage();
      doc.y += PAGE_HEADER_CLEARANCE;
    }
    doc
      .moveDown(0.6)
      .font("Helvetica-Bold")
      .fontSize(format.code === "technical" ? 13 : format.code === "premium" ? 17 : 15)
      .fillColor(format.heading)
      .text(asText(section.title) || "Sección");
    doc
      .moveTo(doc.x, doc.y + 2)
      .lineTo(doc.page.width - PAGE_MARGIN, doc.y + 2)
      .strokeColor(format.border)
      .stroke();
    doc.moveDown(0.3);

    if (section.content?.type === "doc") {
      const nodes = sectionNodes;
      let previousNodeWasRowBreak = false;
      for (let index = 0; index < nodes.length; index += 1) {
        if (nodes[index]?.type === "proposalRowBreak") {
          if (!previousNodeWasRowBreak) doc.y += 8;
          previousNodeWasRowBreak = true;
          continue;
        }
        previousNodeWasRowBreak = false;
        if (nodes[index]?.type === "image") {
          const imageRow = [];
          while (nodes[index]?.type === "image") {
            imageRow.push(nodes[index]);
            index += 1;
          }
          renderTiptapImageRow(doc, imageRow);
          index -= 1;
        } else {
          renderTiptapNode(doc, nodes[index], templateContext, embeddedPlaceholders, format);
        }
      }
      continue;
    }

    const blocks = Array.isArray(section.blocks) ? section.blocks : [];
    if (!blocks.length) {
      doc
        .font("Helvetica-Oblique")
        .fontSize(10)
        .fillColor("#7a8fac")
        .text("Sección sin contenido.");
    }
    for (const block of blocks) {
      renderBlock(doc, block, templateContext);
    }
  }

  doc.end();
  const withEmbeddedPdfs = await replacePdfPlaceholders(await pendingBuffer, embeddedPlaceholders);
  return addProposalPageNumbers(withEmbeddedPdfs, { format });
}
