import { inflateRawSync } from "node:zlib";
import { Buffer } from "node:buffer";
import { normalizeTopology } from "../../../../../shared/topology.js";

const MAX_INFLATED_BYTES = 20 * 1024 * 1024;

const KIND_HINTS = [
  [/regional edge|\bre\b.*f5|f5.*regional/i, "f5_xc_re"],
  [/customer edge|\bce\b/i, "f5_xc_ce"],
  [/nginx.*ingress|ingress/i, "nginx_ingress"],
  [/nginx/i, "nginx"],
  [/address manager/i, "bluecat_address_manager"],
  [/micetro/i, "bluecat_micetro"],
  [/service point|edge/i, "bluecat_edge"],
  [/livenx/i, "livenx"],
  [/livewire/i, "livewire"],
  [/liveassist|live assist/i, "liveassist"],
  [/bdds|dns\/dhcp|dns server|dhcp/i, "dns_server"],
  [/active directory|\bad\b|ldap/i, "directory"],
  [/kubernetes|k8s|cluster/i, "k8s"],
  [/internet|wan|nube|cloud|aws|azure|gcp/i, "cloud"],
  [/usuario|user|cliente|client/i, "user"],
  [/switch|router|firewall|fw\b|balanceador|load balancer|lb\b/i, "network_device"],
  [/siem|splunk|syslog|monitor/i, "siem"],
  [/servidor|server|app|aplicaci/i, "server"],
];

export function guessNodeKind(label) {
  for (const [pattern, kind] of KIND_HINTS) {
    if (pattern.test(label)) return kind;
  }
  return "generic";
}

function decodeEntities(value) {
  return String(value || "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&#xa;", " ")
    .replaceAll("&amp;", "&");
}

function stripHtml(value) {
  return decodeEntities(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    result[match[1]] = match[2];
  }
  return result;
}

// draw.io stores the diagram either as plain XML or as base64(deflate(urlencoded XML)).
export function extractMxGraphXml(fileText) {
  const text = String(fileText || "");
  if (/<mxGraphModel[\s>]/.test(text)) return text;
  const compressed = /<diagram[^>]*>([\s\S]*?)<\/diagram>/.exec(text)?.[1]?.trim();
  if (!compressed) return "";
  try {
    const inflated = inflateRawSync(Buffer.from(compressed, "base64"), { maxOutputLength: MAX_INFLATED_BYTES }).toString("utf8");
    return decodeURIComponent(inflated);
  } catch {
    return "";
  }
}

export function parseDrawioTopology(fileText) {
  const xml = extractMxGraphXml(fileText);
  if (!xml) return null;

  const cells = [];
  for (const match of xml.matchAll(/<mxCell\b([^>]*?)(\/>|>([\s\S]*?)<\/mxCell>)/g)) {
    const attrs = attributes(match[1]);
    const geometry = /<mxGeometry\b([^>]*?)\/?>/.exec(match[3] || "");
    const geo = geometry ? attributes(geometry[1]) : {};
    cells.push({
      id: attrs.id,
      value: stripHtml(attrs.value),
      style: attrs.style || "",
      vertex: attrs.vertex === "1",
      edge: attrs.edge === "1",
      parent: attrs.parent,
      source: attrs.source,
      target: attrs.target,
      x: Number(geo.x || 0),
      y: Number(geo.y || 0),
      w: Number(geo.width || 0) || null,
      h: Number(geo.height || 0) || null,
    });
  }

  const vertices = cells.filter((cell) => cell.vertex);
  const isContainer = (cell) =>
    /swimlane|container=1|group;|rounded=1;.*dashed=1/.test(cell.style) &&
    vertices.some((other) => other.parent === cell.id);
  const containers = vertices.filter(isContainer);
  const containerIds = new Set(containers.map((cell) => cell.id));
  const byId = new Map(vertices.map((cell) => [cell.id, cell]));

  const absolute = (cell) => {
    const parent = byId.get(cell.parent);
    return parent && containerIds.has(parent.id)
      ? { x: cell.x + absolute(parent).x, y: cell.y + absolute(parent).y }
      : { x: cell.x, y: cell.y };
  };

  const zones = containers.map((cell) => ({
    id: `z_${cell.id}`,
    label: cell.value || "Zona",
    kind: "generic",
    ...absolute(cell),
    w: cell.w,
    h: cell.h,
  }));
  const nodes = vertices
    .filter((cell) => !containerIds.has(cell.id) && cell.value)
    .map((cell) => ({
      id: `n_${cell.id}`,
      label: cell.value,
      kind: guessNodeKind(cell.value),
      zoneId: containerIds.has(cell.parent) ? `z_${cell.parent}` : null,
      ...absolute(cell),
      w: cell.w,
      h: cell.h,
    }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = cells
    .filter((cell) => cell.edge && nodeIds.has(`n_${cell.source}`) && nodeIds.has(`n_${cell.target}`))
    .map((cell) => ({
      id: `e_${cell.id}`,
      source: `n_${cell.source}`,
      target: `n_${cell.target}`,
      label: cell.value,
      style: /dashed=1/.test(cell.style) ? "dashed" : "solid",
    }));

  const topology = normalizeTopology({ zones, nodes, edges });
  return topology.nodes.length ? topology : null;
}
