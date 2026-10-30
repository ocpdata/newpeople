// Topology model shared by the API (PDF rendering, validation) and the web editor.
// The JSON is the source of truth; the SVG is always derived from it so the PDF matches what is edited.

export const TOPOLOGY_VERSION = 1;

export const TOPOLOGY_NODE_KINDS = [
  { code: "user", label: "Usuarios", color: "#5b6b79" },
  { code: "internet", label: "Internet", color: "#5b6b79" },
  { code: "app", label: "Aplicacion / origen", color: "#5b6b79" },
  { code: "server", label: "Servidor", color: "#5b6b79" },
  { code: "k8s", label: "Kubernetes", color: "#326ce5" },
  { code: "cloud", label: "Nube", color: "#5b6b79" },
  { code: "siem", label: "SIEM / monitoreo", color: "#5b6b79" },
  { code: "dns_server", label: "Servidor DNS/DHCP existente", color: "#5b6b79" },
  { code: "directory", label: "Directorio (AD)", color: "#5b6b79" },
  { code: "network_device", label: "Dispositivo de red", color: "#5b6b79" },
  { code: "f5_xc_re", label: "F5 XC Regional Edge", color: "#c8102e" },
  { code: "f5_xc_ce", label: "F5 XC Customer Edge", color: "#c8102e" },
  { code: "f5_xc_console", label: "F5 XC Console", color: "#c8102e" },
  { code: "nginx", label: "NGINX", color: "#00873d" },
  { code: "nginx_ingress", label: "NGINX Ingress Controller", color: "#00873d" },
  { code: "nginx_one", label: "NGINX One / Instance Manager", color: "#00873d" },
  { code: "bluecat_address_manager", label: "BlueCat Address Manager", color: "#0b5cab" },
  { code: "bluecat_bdds", label: "BlueCat DNS/DHCP Server", color: "#0b5cab" },
  { code: "bluecat_micetro", label: "BlueCat Micetro", color: "#0b5cab" },
  { code: "bluecat_edge", label: "BlueCat Edge Service Point", color: "#0b5cab" },
  { code: "bluecat_edge_cloud", label: "BlueCat Edge Cloud", color: "#0b5cab" },
  { code: "livenx", label: "LiveNX", color: "#0b5cab" },
  { code: "livewire", label: "LiveWire", color: "#0b5cab" },
  { code: "liveassist", label: "LiveAssist", color: "#0b5cab" },
  { code: "tap", label: "TAP / SPAN", color: "#5b6b79" },
  { code: "generic", label: "Componente", color: "#5b6b79" },
];

export const TOPOLOGY_ZONE_KINDS = [
  "site",
  "cloud",
  "dmz",
  "internet",
  "datacenter",
  "generic",
];

const DEFAULT_NODE_WIDTH = 170;
const DEFAULT_NODE_HEIGHT = 58;
const ZONE_PADDING_X = 28;
const ZONE_PADDING_TOP = 40;
const ZONE_PADDING_BOTTOM = 26;
const NODE_GAP_Y = 30;
const COLUMN_GAP_X = 100;
const CANVAS_MARGIN = 30;
const MAX_NODES = 120;
const MAX_ZONES = 30;
const MAX_EDGES = 240;

function text(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function safeId(value, fallback) {
  const id = text(value, 60).replace(/[^A-Za-z0-9_.:-]/g, "_");
  return id || fallback;
}

export function getTopologyNodeKind(code) {
  return (
    TOPOLOGY_NODE_KINDS.find((kind) => kind.code === code) ||
    TOPOLOGY_NODE_KINDS[TOPOLOGY_NODE_KINDS.length - 1]
  );
}

export function emptyTopology() {
  return { version: TOPOLOGY_VERSION, title: "", zones: [], nodes: [], edges: [] };
}

// Cleans an arbitrary object (AI output or editor state) into a bounded, valid topology.
export function normalizeTopology(raw) {
  if (!raw || typeof raw !== "object") return emptyTopology();

  const zoneIds = new Set();
  const zones = (Array.isArray(raw.zones) ? raw.zones : [])
    .slice(0, MAX_ZONES)
    .map((zone, index) => {
      let id = safeId(zone?.id, `zone_${index + 1}`);
      while (zoneIds.has(id)) id = `${id}_${index}`;
      zoneIds.add(id);
      return {
        id,
        label: text(zone?.label, 80) || `Zona ${index + 1}`,
        kind: TOPOLOGY_ZONE_KINDS.includes(zone?.kind) ? zone.kind : "generic",
        x: finiteNumber(zone?.x),
        y: finiteNumber(zone?.y),
        w: finiteNumber(zone?.w),
        h: finiteNumber(zone?.h),
      };
    });

  const nodeIds = new Set();
  const nodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
    .slice(0, MAX_NODES)
    .map((node, index) => {
      let id = safeId(node?.id, `node_${index + 1}`);
      while (nodeIds.has(id)) id = `${id}_${index}`;
      nodeIds.add(id);
      const zoneId = zoneIds.has(String(node?.zoneId)) ? String(node.zoneId) : null;
      return {
        id,
        label: text(node?.label, 80) || id,
        sublabel: text(node?.sublabel, 120),
        kind: TOPOLOGY_NODE_KINDS.some((kind) => kind.code === node?.kind)
          ? node.kind
          : "generic",
        zoneId,
        x: finiteNumber(node?.x),
        y: finiteNumber(node?.y),
        w: finiteNumber(node?.w),
        h: finiteNumber(node?.h),
        locked: Boolean(node?.locked),
        itemRef: text(node?.itemRef, 120),
      };
    });

  const edgeIds = new Set();
  const edges = (Array.isArray(raw.edges) ? raw.edges : [])
    .slice(0, MAX_EDGES)
    .filter(
      (edge) =>
        nodeIds.has(String(edge?.source)) &&
        nodeIds.has(String(edge?.target)) &&
        String(edge.source) !== String(edge.target),
    )
    .map((edge, index) => {
      let id = safeId(edge?.id, `edge_${index + 1}`);
      while (edgeIds.has(id)) id = `${id}_${index}`;
      edgeIds.add(id);
      return {
        id,
        source: String(edge.source),
        target: String(edge.target),
        label: text(edge?.label, 60),
        style: edge?.style === "dashed" ? "dashed" : "solid",
      };
    });

  return {
    version: TOPOLOGY_VERSION,
    title: text(raw.title, 120),
    zones,
    nodes,
    edges,
  };
}

export function isTopologyEmpty(topology) {
  return !topology || !Array.isArray(topology.nodes) || topology.nodes.length === 0;
}

// Assigns coordinates to every node/zone without them, keeping locked or already positioned items in place.
export function autoLayoutTopology(input, { force = false } = {}) {
  const topology = normalizeTopology(input);
  const shouldPlace = (node) =>
    (force && !node.locked) || node.x === null || node.y === null;

  const free = topology.nodes.filter((node) => !node.zoneId);
  const columns = [];
  if (free.length) columns.push({ zone: null, nodes: free });
  for (const zone of topology.zones) {
    columns.push({
      zone,
      nodes: topology.nodes.filter((node) => node.zoneId === zone.id),
    });
  }

  let cursorX = CANVAS_MARGIN;
  for (const column of columns) {
    const columnNodes = column.nodes;
    const zonePlaced = column.zone && !force && column.zone.x !== null && column.zone.y !== null;
    const baseX = zonePlaced ? column.zone.x : cursorX;
    const baseY = zonePlaced ? column.zone.y : CANVAS_MARGIN;
    const padX = column.zone ? ZONE_PADDING_X : 0;
    const padTop = column.zone ? ZONE_PADDING_TOP : 0;

    let cursorY = baseY + padTop;
    let maxWidth = DEFAULT_NODE_WIDTH;
    for (const node of columnNodes) {
      node.w = node.w || DEFAULT_NODE_WIDTH;
      node.h = node.h || DEFAULT_NODE_HEIGHT;
      if (shouldPlace(node)) {
        node.x = baseX + padX;
        node.y = cursorY;
      }
      cursorY = Math.max(cursorY, node.y + node.h + NODE_GAP_Y);
      maxWidth = Math.max(maxWidth, node.w);
    }

    if (column.zone) {
      const placedNodes = columnNodes.filter((node) => node.x !== null);
      const minX = Math.min(baseX, ...placedNodes.map((node) => node.x - padX));
      const minY = Math.min(baseY, ...placedNodes.map((node) => node.y - padTop));
      const maxX = Math.max(
        baseX + padX + maxWidth + padX,
        ...placedNodes.map((node) => node.x + node.w + padX),
      );
      const maxY = Math.max(
        baseY + padTop + DEFAULT_NODE_HEIGHT + ZONE_PADDING_BOTTOM,
        ...placedNodes.map((node) => node.y + node.h + ZONE_PADDING_BOTTOM),
      );
      if (force || column.zone.x === null) column.zone.x = minX;
      if (force || column.zone.y === null) column.zone.y = minY;
      column.zone.w = column.zone.w && !force ? column.zone.w : maxX - minX;
      column.zone.h = column.zone.h && !force ? column.zone.h : maxY - minY;
      cursorX = Math.max(cursorX, column.zone.x + column.zone.w + COLUMN_GAP_X);
    } else {
      cursorX = Math.max(cursorX, baseX + maxWidth + COLUMN_GAP_X);
    }
  }

  return topology;
}

// Keeps locked nodes (and their zones) from the current diagram and adds only the new generated ones.
export function mergeGeneratedTopology(existing, generated) {
  const current = normalizeTopology(existing);
  const incoming = normalizeTopology(generated);
  if (isTopologyEmpty(current)) return autoLayoutTopology(incoming, { force: true });

  const lockedNodes = current.nodes.filter((node) => node.locked);
  if (!lockedNodes.length) return autoLayoutTopology(incoming, { force: true });

  const lockedIds = new Set(lockedNodes.map((node) => node.id));
  const lockedLabels = new Set(
    lockedNodes.map((node) => `${node.kind}|${node.label.toLowerCase()}`),
  );
  const lockedZoneIds = new Set(
    lockedNodes.map((node) => node.zoneId).filter(Boolean),
  );
  const zones = [
    ...current.zones.filter((zone) => lockedZoneIds.has(zone.id)),
  ];
  const zoneIds = new Set(zones.map((zone) => zone.id));
  const zoneIdMap = new Map();
  for (const zone of incoming.zones) {
    const sameLabel = zones.find(
      (candidate) => candidate.label.toLowerCase() === zone.label.toLowerCase(),
    );
    if (sameLabel) {
      zoneIdMap.set(zone.id, sameLabel.id);
    } else {
      let id = zone.id;
      while (zoneIds.has(id)) id = `${id}_n`;
      zoneIds.add(id);
      zoneIdMap.set(zone.id, id);
      zones.push({ ...zone, id, x: null, y: null, w: null, h: null });
    }
  }

  const nodes = [...lockedNodes];
  const nodeIdMap = new Map();
  for (const node of incoming.nodes) {
    const key = `${node.kind}|${node.label.toLowerCase()}`;
    if (lockedLabels.has(key)) {
      const match = lockedNodes.find(
        (candidate) => `${candidate.kind}|${candidate.label.toLowerCase()}` === key,
      );
      nodeIdMap.set(node.id, match.id);
      continue;
    }
    let id = node.id;
    while (lockedIds.has(id) || nodes.some((candidate) => candidate.id === id)) {
      id = `${id}_n`;
    }
    nodeIdMap.set(node.id, id);
    nodes.push({
      ...node,
      id,
      zoneId: node.zoneId ? zoneIdMap.get(node.zoneId) || null : null,
      x: null,
      y: null,
      w: null,
      h: null,
    });
  }

  const edgeKeys = new Set();
  const edges = [];
  for (const edge of [
    ...current.edges.filter(
      (candidate) => lockedIds.has(candidate.source) && lockedIds.has(candidate.target),
    ),
    ...incoming.edges.map((edge) => ({
      ...edge,
      source: nodeIdMap.get(edge.source) || edge.source,
      target: nodeIdMap.get(edge.target) || edge.target,
    })),
  ]) {
    const key = `${edge.source}->${edge.target}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push(edge);
  }

  return autoLayoutTopology({ ...incoming, title: current.title || incoming.title, zones, nodes, edges });
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function wrapLabel(value, maxChars, maxLines = 3) {
  const words = String(value || "").split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = `${line} ${word}`.trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

const NODE_TEXT_LINE_HEIGHT = 13;

// Wrapped label/detail lines for a node and the height needed to show them without clipping.
function layoutNodeText(node) {
  const lines = wrapLabel(node.label, Math.max(Math.floor((node.w - 28) / 6.8), 8), 4);
  const subLines = node.sublabel ? wrapLabel(node.sublabel, Math.max(Math.floor((node.w - 28) / 5.4), 10), 4) : [];
  const height = Math.max(node.h, 20 + (lines.length + subLines.length) * NODE_TEXT_LINE_HEIGHT);
  return { lines, subLines, height };
}

function clipToRect(rect, from, to) {
  const centerX = rect.x + rect.w / 2;
  const centerY = rect.y + rect.h / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return { x: centerX, y: centerY };
  const scaleX = dx === 0 ? Infinity : rect.w / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : rect.h / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: centerX + dx * scale, y: centerY + dy * scale };
}

function arrowHead(tip, from, size = 9) {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const left = {
    x: tip.x - size * Math.cos(angle - Math.PI / 7),
    y: tip.y - size * Math.sin(angle - Math.PI / 7),
  };
  const right = {
    x: tip.x - size * Math.cos(angle + Math.PI / 7),
    y: tip.y - size * Math.sin(angle + Math.PI / 7),
  };
  return `${tip.x.toFixed(1)},${tip.y.toFixed(1)} ${left.x.toFixed(1)},${left.y.toFixed(1)} ${right.x.toFixed(1)},${right.y.toFixed(1)}`;
}

export function getTopologyBounds(topology) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = 0;
  let maxY = 0;
  for (const zone of topology.zones) {
    minX = Math.min(minX, zone.x || 0);
    minY = Math.min(minY, zone.y || 0);
    maxX = Math.max(maxX, (zone.x || 0) + (zone.w || 0));
    maxY = Math.max(maxY, (zone.y || 0) + (zone.h || 0));
  }
  for (const node of topology.nodes) {
    minX = Math.min(minX, node.x || 0);
    minY = Math.min(minY, node.y || 0);
    maxX = Math.max(maxX, (node.x || 0) + (node.w || DEFAULT_NODE_WIDTH));
    maxY = Math.max(maxY, (node.y || 0) + (node.h || DEFAULT_NODE_HEIGHT));
  }
  // Items dragged above or left of the origin must stay inside the drawing.
  const originX = Number.isFinite(minX) ? Math.min(0, minX - CANVAS_MARGIN) : 0;
  const originY = Number.isFinite(minY) ? Math.min(0, minY - CANVAS_MARGIN) : 0;
  return { originX, originY, width: maxX + CANVAS_MARGIN - originX, height: maxY + CANVAS_MARGIN - originY };
}

// Deterministic SVG with absolute coordinates; no markers or external fonts so PDF converters render it identically.
export function renderTopologySvg(input) {
  const laidOut = autoLayoutTopology(input);
  const textByNode = new Map(laidOut.nodes.map((node) => [node.id, layoutNodeText(node)]));
  const topology = { ...laidOut, nodes: laidOut.nodes.map((node) => ({ ...node, h: textByNode.get(node.id).height })) };
  const { originX, originY, width, height } = getTopologyBounds(topology);
  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${Math.ceil(height)}" viewBox="${Math.floor(originX)} ${Math.floor(originY)} ${Math.ceil(width)} ${Math.ceil(height)}" font-family="Helvetica, Arial, sans-serif">`,
  );
  parts.push(`<rect x="${Math.floor(originX)}" y="${Math.floor(originY)}" width="${Math.ceil(width)}" height="${Math.ceil(height)}" fill="#ffffff"/>`);

  for (const zone of topology.zones) {
    parts.push(
      `<rect x="${zone.x}" y="${zone.y}" width="${zone.w}" height="${zone.h}" rx="10" fill="#f4f7fa" stroke="#9fb0bf" stroke-width="1.2" stroke-dasharray="6 4"/>`,
    );
    parts.push(
      `<text x="${zone.x + 12}" y="${zone.y + 22}" font-size="12" font-weight="bold" fill="#33485a">${escapeXml(zone.label)}</text>`,
    );
  }

  const nodeById = new Map(topology.nodes.map((node) => [node.id, node]));
  const edgeLabelParts = [];
  for (const edge of topology.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    const sourceCenter = { x: source.x + source.w / 2, y: source.y + source.h / 2 };
    const targetCenter = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
    const start = clipToRect(source, sourceCenter, targetCenter);
    const end = clipToRect(target, targetCenter, sourceCenter);
    const dash = edge.style === "dashed" ? ` stroke-dasharray="6 4"` : "";
    parts.push(
      `<line x1="${start.x.toFixed(1)}" y1="${start.y.toFixed(1)}" x2="${end.x.toFixed(1)}" y2="${end.y.toFixed(1)}" stroke="#40576b" stroke-width="1.6"${dash}/>`,
    );
    parts.push(`<polygon points="${arrowHead(end, start)}" fill="#40576b"/>`);
    if (edge.label) {
      const labelLines = wrapLabel(edge.label, 26, 3);
      const labelWidth = Math.max(...labelLines.map((line) => line.length)) * 5.2 + 12;
      const labelHeight = labelLines.length * 11 + 6;
      // Prefer the middle of the line, sliding along it when a node would cover the label.
      const overlapsNode = (cx, cy) =>
        topology.nodes.some(
          (node) =>
            cx + labelWidth / 2 > node.x &&
            cx - labelWidth / 2 < node.x + node.w &&
            cy + labelHeight / 2 > node.y &&
            cy - labelHeight / 2 < node.y + node.h,
        );
      const spots = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8].map((t) => ({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      }));
      const { x: midX, y: midY } = spots.find((spot) => !overlapsNode(spot.x, spot.y)) || spots[0];
      edgeLabelParts.push(
        `<rect x="${(midX - labelWidth / 2).toFixed(1)}" y="${(midY - labelHeight / 2).toFixed(1)}" width="${labelWidth.toFixed(1)}" height="${labelHeight}" rx="3" fill="#ffffff" fill-opacity="0.95" stroke="#d6e0ec" stroke-width="0.8"/>`,
      );
      labelLines.forEach((line, index) => {
        edgeLabelParts.push(
          `<text x="${midX.toFixed(1)}" y="${(midY - labelHeight / 2 + 12 + index * 11).toFixed(1)}" font-size="9.5" text-anchor="middle" fill="#33485a">${escapeXml(line)}</text>`,
        );
      });
    }
  }

  for (const node of topology.nodes) {
    const kind = getTopologyNodeKind(node.kind);
    parts.push(
      `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="8" fill="#ffffff" stroke="${kind.color}" stroke-width="2"/>`,
    );
    parts.push(
      `<rect x="${node.x}" y="${node.y}" width="6" height="${node.h}" rx="3" fill="${kind.color}"/>`,
    );
    const { lines, subLines } = textByNode.get(node.id);
    const totalLines = lines.length + subLines.length;
    const lineHeight = NODE_TEXT_LINE_HEIGHT;
    let textY = node.y + node.h / 2 - ((totalLines - 1) * lineHeight) / 2 + 4;
    for (const line of lines) {
      parts.push(
        `<text x="${node.x + node.w / 2 + 3}" y="${textY.toFixed(1)}" font-size="11.5" font-weight="bold" text-anchor="middle" fill="#14283a">${escapeXml(line)}</text>`,
      );
      textY += lineHeight;
    }
    for (const line of subLines) {
      parts.push(
        `<text x="${node.x + node.w / 2 + 3}" y="${textY.toFixed(1)}" font-size="9.5" text-anchor="middle" fill="#5b6b79">${escapeXml(line)}</text>`,
      );
      textY += lineHeight;
    }
  }

  // Labels are drawn last so a line crossing a node never hides its text.
  parts.push(...edgeLabelParts);
  parts.push("</svg>");
  return parts.join("");
}
