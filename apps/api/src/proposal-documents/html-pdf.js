import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getProposalFormat } from "../../../../shared/proposal-formats.js";
import { addProposalPageNumbers } from "./page-numbers.js";

const CHROME_EXECUTABLE_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PRINT_STYLES = readFileSync(
  fileURLToPath(new URL("../../../../shared/proposal-document-print.css", import.meta.url)),
  "utf8",
);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveTemplateText(value, context) {
  return escapeHtml(value).replace(
    /\{\{\s*(client_name|contact_name|company_name)\s*\}\}/g,
    (_match, token) => escapeHtml(context[token] || ""),
  );
}

function renderInline(nodes, context) {
  return (Array.isArray(nodes) ? nodes : [])
    .map((node) => {
      if (node.type !== "text") return "";
      const text = resolveTemplateText(node.text, context);
      return (node.marks || []).reduce((html, mark) => {
        if (mark.type === "bold") return `<strong>${html}</strong>`;
        if (mark.type === "italic") return `<em>${html}</em>`;
        if (mark.type === "link" && mark.attrs?.href) return `<a href="${escapeHtml(mark.attrs.href)}">${html}</a>`;
        return html;
      }, text);
    })
    .join("");
}

function renderImage(node) {
  const attrs = node.attrs || {};
  const width = Number(attrs.width) > 0 ? `${Number(attrs.width)}px` : "220px";
  const height = Number(attrs.height) > 0 ? `${Number(attrs.height)}px` : "auto";
  const align = ["left", "center", "right"].includes(attrs.align)
    ? attrs.align
    : "left";
  const verticalAlign = ["top", "center", "bottom"].includes(attrs.verticalAlign)
    ? attrs.verticalAlign
    : "center";
  return `<figure class="proposal-print-image" data-align="${align}" data-vertical-align="${verticalAlign}">
    <img src="${escapeHtml(attrs.src)}" alt="${escapeHtml(attrs.alt || "")}" style="width:${width};height:${height};" />
  </figure>`;
}

function renderImageRow(node) {
  const columns = Math.min(5, Math.max(2, Number(node.attrs?.columns) || 2));
  const images = Array.from({ length: columns }, (_value, index) => node.attrs?.images?.[index] || null);
  return `<div class="proposal-print-image-row" style="--proposal-image-row-columns:${columns}">${images.map((image) => image?.src ? `<figure><img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt || "Imagen de propuesta")}" /></figure>` : "<figure></figure>").join("")}</div>`;
}

function renderPdf(node) {
  const attrs = node.attrs || {};
  const fileName = escapeHtml(attrs.fileName || "documento.pdf");
  return `<figure class="proposal-print-pdf">
    <object data="${escapeHtml(attrs.src || "")}" type="application/pdf" aria-label="${fileName}">
      <a href="${escapeHtml(attrs.src || "")}">${fileName}</a>
    </object>
    <figcaption>${fileName}</figcaption>
  </figure>`;
}

function getNodeText(node) {
  if (node?.type === "text") return String(node.text || "");
  return (node?.content || []).map(getNodeText).join("");
}

function getDocumentSections(content) {
  const nodes = content?.document?.type === "doc" ? content.document.content || [] : [];
  return nodes
    .map((node, index) => node?.type === "proposalSection" ? {
      id: `proposal-section-${index}`,
      title: getNodeText((node.content || []).find((child) => child.type === "heading") || node).trim() || "Sección",
    } : null)
    .filter(Boolean);
}

function renderTableOfContents(entries) {
  return `<nav class="proposal-print-toc" aria-label="Contenido">
    <h2>Contenido</h2>
    ${entries.map((entry) => `<div class="proposal-print-toc-row"><span>${escapeHtml(entry.title)}</span></div>`).join("")}
  </nav>`;
}

function renderNode(node, context) {
  if (!node) return "";
  if (node.type === "proposalSection") {
    const children = node.content || [];
    const hasRenderableContent = children.some((child) => {
      if (child?.type === "paragraph" || child?.type === "heading") {
        return (child.content || []).some((item) => item.type === "text" && String(item.text || "").trim());
      }
      return child?.type !== "proposalRowBreak";
    });
    if (!hasRenderableContent) return "";
    const pageBreakClass = node.attrs?.startOnNewPage ? " starts-new-page" : "";
    return `<section id="${escapeHtml(context.sectionId || "")}" class="proposal-document-section${pageBreakClass}">${children.map((child) => renderNode(child, context)).join("")}</section>`;
  }
  if (node.type === "image") return renderImage(node);
  if (node.type === "proposalImageRow") return renderImageRow(node);
  if (node.type === "proposalPdf") return renderPdf(node);
  if (node.type === "proposalRowBreak") return '<div class="proposal-print-row-break"></div>';
  if (node.type === "proposalPageBreak") return '<div data-proposal-page-break></div>';
  if (node.type === "heading") {
    const level = Number(node.attrs?.level) === 2 ? "h2" : "h3";
    return `<${level}>${renderInline(node.content, context)}</${level}>`;
  }
  if (node.type === "paragraph") {
    const align = ["left", "center", "right", "justify"].includes(node.attrs?.textAlign)
      ? ` style="text-align:${node.attrs.textAlign}"`
      : "";
    return `<p${align}>${renderInline(node.content, context)}</p>`;
  }
  if (node.type === "bulletList" || node.type === "orderedList") {
    const tag = node.type === "orderedList" ? "ol" : "ul";
    return `<${tag}>${(node.content || [])
      .map((item) => `<li>${(item.content || []).map((child) => renderNode(child, context)).join("")}</li>`)
      .join("")}</${tag}>`;
  }
  if (node.type === "table") {
    return `<table><tbody>${(node.content || []).map((row) => renderNode(row, context)).join("")}</tbody></table>`;
  }
  if (node.type === "tableRow") return `<tr>${(node.content || []).map((cell) => renderNode(cell, context)).join("")}</tr>`;
  if (node.type === "tableHeader") return `<th>${(node.content || []).map((child) => renderNode(child, context)).join("")}</th>`;
  if (node.type === "tableCell") return `<td>${(node.content || []).map((child) => renderNode(child, context)).join("")}</td>`;
  return (node.content || []).map((child) => renderNode(child, context)).join("");
}

function renderLegacyBlock(block, context) {
  if (block.type === "image" && block.image?.fileUrl) {
    return renderImage({
      type: "image",
      attrs: {
        src: block.image.fileUrl,
        alt: block.image.altText,
        width: block.image.width,
        height: block.image.height,
        align: "left",
        verticalAlign: "center",
      },
    });
  }
  if (block.type === "heading") return `<h3>${resolveTemplateText(block.text, context)}</h3>`;
  if (block.type === "paragraph") return `<p>${resolveTemplateText(block.text, context)}</p>`;
  if (block.type === "list") {
    return `<ul>${(block.items || []).map((item) => `<li>${resolveTemplateText(item, context)}</li>`).join("")}</ul>`;
  }
  return "";
}

function renderProposalCover({ title, context, format }) {
  const formatClass = format.code === "enterprise" ? "is-enterprise" : "is-basic";
  return `<section class="proposal-print-cover ${formatClass}" style="--proposal-format-accent:${escapeHtml(format.accent)};--proposal-format-heading:${escapeHtml(format.heading)}">
    <div class="proposal-print-cover-accent"></div>
    <div class="proposal-print-cover-content">
      <span class="proposal-print-cover-eyebrow">Propuesta comercial</span>
      <h1>${escapeHtml(title || "Propuesta")}</h1>
      <p class="proposal-print-cover-client">${escapeHtml(context.client_name || "Cliente")}</p>
      <p class="proposal-print-cover-company">${escapeHtml(context.company_name || "")}</p>
      <p class="proposal-print-cover-date">${new Date().toLocaleDateString("es-MX")}</p>
    </div>
  </section>`;
}

export function renderProposalDocumentHtml({ title, content, tocPages = {} }) {
  const sourceContext = content?.metadata?.source_context || {};
  const context = {
    client_name: sourceContext.account_name || "cliente",
    contact_name: sourceContext.contact_name || "contacto",
    company_name: sourceContext.company_name || "nuestra empresa",
  };
  const format = content?.metadata?.format_snapshot || getProposalFormat(content?.metadata?.format_code);
  const documentNodes = content?.schema_version >= 3 && content?.document?.type === "doc"
    ? content.document.content || []
    : null;
  const sections = (content?.sections || [])
    .map((section) => {
      const nodes = section.content?.type === "doc"
        ? section.content.content || []
        : (section.blocks || []).map((block) => ({ type: "legacy", block }));
      return `<section class="proposal-print-section">
        <h2>${escapeHtml(section.title || "Sección")}</h2>
        <div class="proposal-print-content">${nodes.map((node) => node.type === "legacy" ? renderLegacyBlock(node.block, context) : renderNode(node, context)).join("")}</div>
      </section>`;
    })
    .join("");

  const body = documentNodes
    ? documentNodes.map((node, index) => {
        if (node?.type === "proposalPageBreak" && documentNodes[index + 1]?.type === "proposalSection" && documentNodes[index + 1]?.attrs?.startOnNewPage) {
          return "";
        }
        return renderNode(node, { ...context, sectionId: node?.type === "proposalSection" ? `proposal-section-${index}` : "" });
      }).join("")
    : sections;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; }
    ${PRINT_STYLES}
  </style></head><body><main class="proposal-print-page" style="--proposal-format-accent:${escapeHtml(format.accent)};--proposal-format-heading:${escapeHtml(format.heading)};--proposal-format-text:${escapeHtml(format.text)};--proposal-format-border:${escapeHtml(format.border)};--proposal-format-surface:${escapeHtml(format.surface)};--proposal-format-spacing:${escapeHtml(format.spacing)};--proposal-format-heading-font:${escapeHtml(format.headingFont)};--proposal-format-body-font:${escapeHtml(format.bodyFont)};--proposal-format-margin:${escapeHtml(format.margin)}">${renderProposalCover({ title, context, format })}${renderTableOfContents(getDocumentSections(content).map((entry) => ({ ...entry, page: tocPages[entry.id] })))}<div class="proposal-print-content">${body}</div></main></body></html>`;
}

export async function renderProposalDocumentHtmlPdfBuffer(document) {
  const browser = await chromium.launch({
    executablePath: CHROME_EXECUTABLE_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 1 });
    await page.setContent(renderProposalDocumentHtml(document), { waitUntil: "networkidle" });
    const tocPages = await page.evaluate(() => {
      const pageHeight = document.querySelector(".proposal-print-cover")?.getBoundingClientRect().height || 1056;
      return Object.fromEntries([...document.querySelectorAll(".proposal-document-section[id]")].map((section) => [section.id, Math.floor(section.getBoundingClientRect().top / pageHeight) + 1]));
    });
    await page.setContent(renderProposalDocumentHtml({ ...document, tocPages }), { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0),
      null,
      { timeout: 15000 },
    ).catch(() => {});
    const baseBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      preferCSSPageSize: true,
    });
    const sourceContext = document.content?.metadata?.format_snapshot || getProposalFormat(document.content?.metadata?.format_code);
    return addProposalPageNumbers(baseBuffer, { format: sourceContext });
  } finally {
    await browser.close();
  }
}
