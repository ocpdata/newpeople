import { Buffer } from "node:buffer";
import {
  isTopologyEmpty,
  normalizeTopology,
  renderTopologySvg,
} from "../../../../shared/topology.js";

const TOPOLOGY_IMAGE_WIDTH = 640;

function text(value) {
  return { type: "text", text: String(value) };
}

function paragraph(value, { italic = false } = {}) {
  const content = String(value || "").trim();
  if (!content) return null;
  return {
    type: "paragraph",
    content: [italic ? { ...text(content), marks: [{ type: "italic" }] } : text(content)],
  };
}

function heading(level, value) {
  return { type: "heading", attrs: { level }, content: [text(value)] };
}

function bulletList(items) {
  const entries = (items || []).map((item) => String(item || "").trim()).filter(Boolean);
  if (!entries.length) return null;
  return {
    type: "bulletList",
    content: entries.map((entry) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [text(entry)] }],
    })),
  };
}

export function topologySvgToDataUrl(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

// Caption plus the drawn topology; empty topologies produce no nodes.
export function buildTopologyNodes(topology, caption) {
  if (isTopologyEmpty(topology)) return [];
  const svg = renderTopologySvg(normalizeTopology(topology));
  return [
    paragraph(caption, { italic: true }),
    {
      type: "image",
      attrs: {
        src: topologySvgToDataUrl(svg),
        alt: caption || "Topologia",
        width: TOPOLOGY_IMAGE_WIDTH,
        align: "center",
      },
    },
  ].filter(Boolean);
}

function tableNode(table) {
  const headers = (Array.isArray(table?.headers) ? table.headers : []).map((cell) => String(cell ?? ""));
  const rows = (Array.isArray(table?.rows) ? table.rows : []).map((row) => row.map((cell) => String(cell ?? "")));
  if (!rows.length) return null;
  const columns = Math.max(headers.length, ...rows.map((row) => row.length));
  const cell = (type, value) => ({
    type,
    content: [{ type: "paragraph", content: value.trim() ? [text(value)] : [] }],
  });
  const fill = (row) => Array.from({ length: columns }, (_value, index) => row[index] ?? "");
  const tableRows = [];
  if (headers.some((header) => header.trim())) {
    tableRows.push({ type: "tableRow", content: fill(headers).map((value) => cell("tableHeader", value)) });
  }
  for (const row of rows) {
    tableRows.push({ type: "tableRow", content: fill(row).map((value) => cell("tableCell", value)) });
  }
  return { type: "table", content: tableRows };
}

export function technicalBlocksToNodes(blocks) {
  const nodes = [];
  for (const block of blocks || []) {
    if (block.type === "heading") nodes.push(block.text ? heading(3, block.text) : null);
    else if (block.type === "paragraph") nodes.push(paragraph(block.text));
    else if (block.type === "list") nodes.push(bulletList(block.items));
    else if (block.type === "table") nodes.push(tableNode(block.table));
  }
  return nodes.filter(Boolean);
}

const ALLOWED_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "hardBreak",
]);
const MAX_NODES = 4000;
const MAX_DEPTH = 8;
const MAX_TEXT = 20_000;

function sanitizeMarks(marks) {
  const result = [];
  for (const mark of Array.isArray(marks) ? marks : []) {
    if (mark?.type === "bold" || mark?.type === "italic") result.push({ type: mark.type });
    else if (mark?.type === "link") {
      const href = String(mark.attrs?.href || "").trim();
      if (/^(https?:\/\/|mailto:)/i.test(href) && href.length <= 2000) {
        result.push({ type: "link", attrs: { href } });
      }
    }
  }
  return result;
}

// Keeps only the formatting the technical scope supports (text, headings, lists and tables). Images, PDFs, page
// breaks and section nodes are dropped, and unknown containers are unwrapped so their text survives.
export function sanitizeSectionDoc(input) {
  let budget = MAX_NODES;
  const sanitizeNode = (node, depth) => {
    if (!node || typeof node !== "object" || depth > MAX_DEPTH || budget <= 0) return [];
    budget -= 1;
    if (node.type === "text") {
      const value = String(node.text ?? "").slice(0, MAX_TEXT);
      if (!value) return [];
      const marks = sanitizeMarks(node.marks);
      return [{ type: "text", text: value, ...(marks.length ? { marks } : {}) }];
    }
    const children = (Array.isArray(node.content) ? node.content : []).flatMap((child) =>
      sanitizeNode(child, depth + 1),
    );
    if (!ALLOWED_NODE_TYPES.has(node.type)) return children;
    if (node.type === "hardBreak") return [{ type: "hardBreak" }];
    if (node.type === "heading") return [{ type: "heading", attrs: { level: 3 }, content: children }];
    return [{ type: node.type, ...(children.length ? { content: children } : {}) }];
  };
  const top = (Array.isArray(input?.content) ? input.content : []).flatMap((node) => sanitizeNode(node, 1));
  // Text that survived outside a block (for example from an unwrapped node) becomes a paragraph.
  const content = [];
  for (const node of top) {
    if (node.type === "text" || node.type === "hardBreak") {
      const last = content[content.length - 1];
      if (last?.type === "paragraph" && last.loose) last.content.push(node);
      else content.push({ type: "paragraph", loose: true, content: [node] });
    } else if (node.type === "paragraph" && !node.content?.length) {
      continue;
    } else {
      content.push(node);
    }
  }
  return {
    type: "doc",
    content: content.map(({ loose: _loose, ...node }) => node),
  };
}

function plainText(node) {
  if (node?.type === "text") return String(node.text || "");
  if (node?.type === "hardBreak") return " ";
  return (node?.content || []).map(plainText).join("");
}

// Plain structure of a section body, used by the verifier and by the AI; the editor content is the source of truth.
export function docToBlocks(doc) {
  const blocks = [];
  for (const node of doc?.content || []) {
    if (node.type === "heading") {
      const value = plainText(node).trim();
      if (value) blocks.push({ type: "heading", text: value, items: [], table: null });
    } else if (node.type === "paragraph") {
      const value = plainText(node).trim();
      if (value) blocks.push({ type: "paragraph", text: value, items: [], table: null });
    } else if (node.type === "bulletList" || node.type === "orderedList") {
      const items = (node.content || []).map((item) => plainText(item).trim()).filter(Boolean);
      if (items.length) blocks.push({ type: "list", text: "", items: items.slice(0, 80), table: null });
    } else if (node.type === "table") {
      const rows = (node.content || []).map((row) =>
        (row.content || []).map((cell) => plainText(cell).trim().slice(0, 1000)),
      );
      const hasHeader = (node.content?.[0]?.content || []).some((cell) => cell.type === "tableHeader");
      const headers = hasHeader ? rows.shift() || [] : [];
      const bodyRows = rows.filter((row) => row.some(Boolean)).slice(0, 80);
      if (bodyRows.length) {
        blocks.push({
          type: "table",
          text: "",
          items: [],
          table: { headers: headers.slice(0, 8), rows: bodyRows.map((row) => row.slice(0, 8)) },
        });
      }
    }
  }
  return blocks.slice(0, 60);
}

export function blocksToDoc(blocks) {
  return { type: "doc", content: technicalBlocksToNodes(blocks) };
}

// Sections generated or stored before the editor existed only have blocks; their content is derived from them.
export function ensureSectionContent(section) {
  if (section?.content?.type === "doc") return section.content;
  return blocksToDoc(section?.blocks);
}

export function withSectionContent(section) {
  return { ...section, content: ensureSectionContent(section) };
}

// A write carries either editor content (sanitized, blocks derived from it) or blocks (content derived from them).
export function normalizeSectionWrite(section) {
  if (section?.content?.type === "doc") {
    const content = sanitizeSectionDoc(section.content);
    return { ...section, content, blocks: docToBlocks(content) };
  }
  return { ...section, content: blocksToDoc(section?.blocks) };
}

// A technical section as a proposal section node: level-2 title followed by its content.
export function sectionToProposalSection(section, extraNodes = []) {
  const children = [...(ensureSectionContent(section).content || []), ...extraNodes];
  if (!children.length) return null;
  return {
    type: "proposalSection",
    attrs: { startOnNewPage: false },
    content: [heading(2, section.title), ...children],
  };
}

export function buildScopeProposalSections(scope) {
  const sections = [];
  for (const section of scope.sections || []) {
    const extra =
      section.code === "architecture"
        ? [
            ...buildTopologyNodes(scope.asisTopology, "Topologia de la situacion actual"),
            ...buildTopologyNodes(scope.topology, "Topologia de la solucion propuesta"),
          ]
        : [];
    const node = sectionToProposalSection(section, extra);
    if (node) sections.push(node);
  }
  return sections;
}

function nodeText(node) {
  if (node?.type === "text") return String(node.text || "");
  return (node?.content || []).map(nodeText).join("");
}

export function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const REPLACED_SECTION_TITLE = "descripcion de la solucion";
const FALLBACK_ANCHOR_TITLES = ["servicios", "siguientes pasos"];

function sectionTitleOf(node) {
  return normalizeTitle(nodeText((node.content || []).find((child) => child.type === "heading")));
}

// The technical sections take the place of the generic "Descripcion de la solucion" section. Without that section
// they go before "Servicios" or "Siguientes pasos", and at the end as a last resort.
export function injectScopeSectionsIntoContent(content, technicalSections) {
  if (!technicalSections.length) return content;
  const next = { ...content };

  if (next.schema_version >= 3 && next.document?.type === "doc") {
    const nodes = [...(next.document.content || [])];
    const titleOf = (node) => (node?.type === "proposalSection" ? sectionTitleOf(node) : null);
    let index = nodes.findIndex((node) => titleOf(node) === REPLACED_SECTION_TITLE);
    let deleteCount = 1;
    const sections = technicalSections.map((section) => ({ ...section, attrs: { ...section.attrs } }));
    if (index >= 0) {
      sections[0].attrs = { ...sections[0].attrs, ...(nodes[index].attrs || {}) };
    } else {
      deleteCount = 0;
      index = nodes.findIndex((node) => FALLBACK_ANCHOR_TITLES.includes(titleOf(node)));
      if (index < 0) index = nodes.length;
    }
    nodes.splice(index, deleteCount, ...sections);
    next.document = { ...next.document, content: nodes };
    return next;
  }

  const legacySections = [...(next.sections || [])];
  const toLegacy = (section, position) => ({
    id: `technical-scope-${position}`,
    source_code: null,
    title: nodeText(section.content[0]),
    blocks: [],
    content: { type: "doc", content: section.content.slice(1) },
  });
  let index = legacySections.findIndex(
    (section) =>
      section.source_code === "solution_description" || normalizeTitle(section.title) === REPLACED_SECTION_TITLE,
  );
  let deleteCount = 1;
  if (index < 0) {
    deleteCount = 0;
    index = legacySections.findIndex(
      (section) => section.source_code === "next_steps" || FALLBACK_ANCHOR_TITLES.includes(normalizeTitle(section.title)),
    );
    if (index < 0) index = legacySections.length;
  }
  legacySections.splice(index, deleteCount, ...technicalSections.map(toLegacy));
  next.sections = legacySections;
  return next;
}
