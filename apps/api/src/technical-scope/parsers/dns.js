// Deterministic analysis of DNS/DHCP configuration and exports (BIND, ISC DHCP, Microsoft CSV exports).

const MAX_INPUT_CHARS = 1_000_000;

function stripComments(text) {
  return String(text || "")
    .slice(0, MAX_INPUT_CHARS)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)(#|\/\/).*$/, ""))
    .join("\n");
}

export function looksLikeBindConfig(text) {
  return /\bzone\s+"[^"]+"\s*(?:in\s+)?\{/i.test(text);
}

export function looksLikeDhcpdConfig(text) {
  return /\bsubnet\s+\d+\.\d+\.\d+\.\d+\s+netmask\b/i.test(text);
}

export function parseBindConfig(rawText) {
  const text = stripComments(rawText);
  const zones = new Set();
  const types = { primary: 0, secondary: 0, forward: 0, other: 0 };
  for (const match of text.matchAll(/\bzone\s+"([^"\n]{1,255})"\s*(?:in\s+)?\{([^}]{0,2000})\}\s*;/gi)) {
    zones.add(match[1]);
    const type = /\btype\s+(\w+)/i.exec(match[2])?.[1]?.toLowerCase();
    if (type === "master" || type === "primary") types.primary += 1;
    else if (type === "slave" || type === "secondary") types.secondary += 1;
    else if (type === "forward") types.forward += 1;
    else types.other += 1;
  }
  const features = [];
  if (/\bdnssec-(validation|enable|policy)\b/i.test(text)) features.push("dnssec");
  if (/\bviews?\s+"[^"]+"\s*\{/i.test(text) || /\bview\s+"/i.test(text)) features.push("views");
  return {
    kind: "bind_config",
    metrics: {
      zones: zones.size,
      primary_zones: types.primary,
      secondary_zones: types.secondary,
      forward_zones: types.forward,
    },
    lists: { zones: Array.from(zones).slice(0, 200) },
    features,
  };
}

export function parseDhcpdConfig(rawText) {
  const text = stripComments(rawText);
  const subnets = new Set();
  for (const match of text.matchAll(/\bsubnet\s+(\d+\.\d+\.\d+\.\d+)\s+netmask\s+(\d+\.\d+\.\d+\.\d+)/gi)) {
    subnets.add(`${match[1]}/${match[2]}`);
  }
  const hosts = (text.match(/\bhost\s+\S+\s*\{/gi) || []).length;
  const features = [];
  if (/\bfailover\s+peer\b/i.test(text)) features.push("dhcp_failover");
  return {
    kind: "dhcpd_config",
    metrics: { subnets: subnets.size, reservations: hosts },
    lists: { subnets: Array.from(subnets).slice(0, 200) },
    features,
  };
}

// Counts rows of a CSV export; the first line is treated as header.
export function parseCsvExport(rawText, { label = "records" } = {}) {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    kind: "csv_export",
    metrics: { [label]: Math.max(0, lines.length - 1) },
    lists: { header: lines[0] ? lines[0].split(/[;,\t]/).slice(0, 20) : [] },
    features: [],
  };
}
