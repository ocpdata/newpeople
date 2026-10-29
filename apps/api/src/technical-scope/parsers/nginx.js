// Deterministic analysis of NGINX configuration files. Counting is done here, not by the model.

// Parsers cap their input and bound every quantifier so one crafted file cannot stall the event loop.
const MAX_INPUT_CHARS = 1_000_000;

function stripComments(text) {
  return text.slice(0, MAX_INPUT_CHARS)
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, ""))
    .join("\n");
}

export function looksLikeNginxConfig(text) {
  return /\b(server\s*\{|upstream\s+\S+\s*\{|proxy_pass\s|listen\s+\d)/.test(text);
}

export function parseNginxConfig(rawText) {
  const text = stripComments(String(rawText || ""));
  const serverNames = new Set();
  const listenPorts = new Set();
  const upstreams = new Set();
  let upstreamServers = 0;
  const features = new Set();

  const serverBlocks = (text.match(/\bserver\s*\{/g) || []).length;

  for (const match of text.matchAll(/\bserver_name\s+([^;\n]{1,500});/g)) {
    for (const name of match[1].trim().split(/\s+/)) {
      if (name && name !== "_" && !name.startsWith("$")) serverNames.add(name);
    }
  }
  for (const match of text.matchAll(/\blisten\s+([^;\n]{1,200});/g)) {
    const port = match[1].trim().split(/\s+/)[0].split(":").pop();
    if (port) listenPorts.add(port);
  }
  for (const match of text.matchAll(/\bupstream\s+(\S{1,100})\s*\{([^}]{0,5000})\}/g)) {
    upstreams.add(match[1]);
    upstreamServers += (match[2].match(/\bserver\s+[^\s;]+/g) || []).length;
  }

  let sslListeners = 0;
  for (const match of text.matchAll(/\blisten\s+([^;\n]{1,200});/g)) {
    if (/\bssl\b/.test(match[1]) || /^(?:[^\s:]*:)?443\b/.test(match[1].trim())) sslListeners += 1;
  }

  if (upstreams.size || /\bproxy_pass\b/.test(text)) features.add("reverse_proxy");
  if (upstreams.size) features.add("load_balancing");
  if (/\blimit_req\b|\blimit_req_zone\b/.test(text)) features.add("rate_limit");
  if (/\bproxy_cache\b|\bproxy_cache_path\b/.test(text)) features.add("cache");
  if (/\bauth_jwt\b|\bauth_request\b|\bauth_oidc\b/.test(text)) features.add("auth");
  if (/\bhealth_check\b/.test(text)) features.add("active_health_checks");
  if (/\bsticky\b|\bip_hash\b/.test(text)) features.add("session_persistence");
  if (/\bapp_protect_enable\b|\bapp_protect_policy_file\b/.test(text)) features.add("app_protect");
  if (/\bstream\s*\{/.test(text)) features.add("tcp_udp_proxy");

  return {
    kind: "nginx_config",
    metrics: {
      server_blocks: serverBlocks,
      distinct_server_names: serverNames.size,
      upstreams: upstreams.size,
      upstream_servers: upstreamServers,
      ssl_listeners: sslListeners,
    },
    lists: {
      server_names: Array.from(serverNames).slice(0, 100),
      listen_ports: Array.from(listenPorts).slice(0, 30),
      upstreams: Array.from(upstreams).slice(0, 50),
    },
    features: Array.from(features),
  };
}
