// Masks credentials and key material before text is sent to an AI model or stored.
// Public IPs and hostnames are kept: they are needed to understand the environment.

const MASK = "[ENMASCARADO]";
const PEM_MASK = "[CLAVE O CERTIFICADO ENMASCARADO]";

const SENSITIVE_KEYS =
  "password|passwd|pwd|passphrase|password[_-]?hash|secret|client[_-]?secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|community|psk|pre[_-]?shared[_-]?key|shared[_-]?secret|auth[_-]?pass|enable[_-]?secret|radius[_-]?key|tacacs[_-]?key";

// Linear scan (no lazy regex over the whole text): an unterminated block is masked up to the end of the input.
function maskPemBlocks(text) {
  let result = "";
  let cursor = 0;
  let count = 0;
  while (cursor < text.length) {
    const begin = text.indexOf("-----BEGIN ", cursor);
    if (begin === -1) break;
    const headerEnd = text.indexOf("-----", begin + 11);
    const end = headerEnd === -1 ? -1 : text.indexOf("-----END ", headerEnd + 5);
    result += text.slice(cursor, begin) + PEM_MASK;
    count += 1;
    if (end === -1) {
      cursor = text.length;
      break;
    }
    const endClose = text.indexOf("-----", end + 9);
    cursor = endClose === -1 ? text.length : endClose + 5;
  }
  return { text: result + text.slice(cursor), count };
}

const RULES = [
  {
    kind: "key_value",
    pattern: new RegExp(
      `("?(?:${SENSITIVE_KEYS})"?\\s*[:=]\\s*)("[^"\\n]*"|'[^'\\n]*'|[^\\s,;}]+)`,
      "gi",
    ),
    replace: (_match, prefix) => `${prefix}"${MASK}"`,
  },
  {
    kind: "cli_secret",
    configOnly: true,
    pattern: /\b(secret|password|community)\s+(?:[0-9]\s+)?(?:ENC\s+)?(\S+)/gi,
    replace: (_match, keyword) => `${keyword} ${MASK}`,
  },
  {
    kind: "cli_key",
    configOnly: true,
    pattern: /\b(key|psk|pre-shared-key)\s+(?:[0-9]\s+)?(?:ENC\s+)?(\S+)/gi,
    replace: (_match, keyword) => `${keyword} ${MASK}`,
  },
  {
    kind: "snmp_community",
    configOnly: true,
    pattern: /(snmp-server community)\s+\S+/gi,
    replace: (_match, prefix) => `${prefix} ${MASK}`,
  },
  {
    kind: "bearer",
    pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g,
    replace: (_match, scheme) => `${scheme} ${MASK}`,
  },
  {
    kind: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g,
    replace: () => MASK,
  },
  {
    kind: "aws_key",
    pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replace: () => MASK,
  },
  {
    kind: "url_credentials",
    pattern: /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi,
    replace: (_match, scheme) => `${scheme}${MASK}@`,
  },
];

// configLike enables the CLI-style rules (e.g. "enable secret 5 xyz"), which would corrupt normal prose.
export function maskSecrets(input, { configLike = false } = {}) {
  const pem = maskPemBlocks(String(input ?? ""));
  let text = pem.text;
  const kinds = pem.count ? { pem: pem.count } : {};
  let count = pem.count;
  for (const rule of RULES) {
    if (rule.configOnly && !configLike) continue;
    text = text.replace(rule.pattern, (...args) => {
      count += 1;
      kinds[rule.kind] = (kinds[rule.kind] || 0) + 1;
      return rule.replace(...args);
    });
  }
  return { text, redactions: { count, kinds } };
}

// Masks every label of a topology (AI or file extracted) before it is stored or sent to a model.
export function maskTopologyLabels(topology) {
  if (!topology) return topology;
  const mask = (value) => (value ? maskSecrets(value, { configLike: true }).text : value);
  return {
    ...topology,
    title: mask(topology.title),
    zones: (topology.zones || []).map((zone) => ({ ...zone, label: mask(zone.label) })),
    nodes: (topology.nodes || []).map((node) => ({
      ...node,
      label: mask(node.label),
      sublabel: mask(node.sublabel),
    })),
    edges: (topology.edges || []).map((edge) => ({ ...edge, label: mask(edge.label) })),
  };
}
