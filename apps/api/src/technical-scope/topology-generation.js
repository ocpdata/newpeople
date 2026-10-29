import { z } from "zod";
import {
  TOPOLOGY_NODE_KINDS,
  autoLayoutTopology,
  mergeGeneratedTopology,
  normalizeTopology,
} from "../../../../shared/topology.js";
import { TECHNICAL_SCOPE_AI_FEATURES, requestAiJson } from "./ai.js";
import { formatAnswerValue } from "./generation.js";
import { normalizeSearchText } from "./playbooks.js";

const KIND_TO_ITEM_PATTERN = {
  f5_xc_re: /regional edge|distributed cloud|waap|bot defense|ddos/,
  f5_xc_ce: /customer edge/,
  f5_xc_console: /distributed cloud/,
  nginx: /nginx plus|nginx/,
  nginx_ingress: /ingress/,
  nginx_one: /nginx one|instance manager/,
  bluecat_address_manager: /address manager|integrity/,
  bluecat_bdds: /bdds|dns\/dhcp|dns dhcp|integrity/,
  bluecat_micetro: /micetro/,
  bluecat_edge: /service point|edge/,
  bluecat_edge_cloud: /edge/,
  livenx: /livenx/,
  livewire: /livewire/,
  liveassist: /liveassist|live assist/,
};

const aiTopologySchema = z.object({
  title: z.string().trim().max(120).optional().default(""),
  zones: z.array(z.any()).max(30).default([]),
  nodes: z.array(z.any()).max(120).default([]),
  edges: z.array(z.any()).max(240).default([]),
  notes: z.string().trim().max(600).optional().default(""),
});

const TOPOLOGY_SYSTEM_PROMPT = [
  "Eres un arquitecto de soluciones que ajusta el diagrama de topologia de una propuesta tecnica.",
  "Responde exclusivamente con JSON valido: {\"title\": string, \"zones\": [{\"id\", \"label\", \"kind\": \"site|cloud|dmz|internet|datacenter|generic\"}], \"nodes\": [{\"id\", \"label\", \"sublabel\", \"kind\", \"zoneId\"}], \"edges\": [{\"source\", \"target\", \"label\", \"style\": \"solid|dashed\"}], \"notes\": string}.",
  `kind debe ser uno de: ${TOPOLOGY_NODE_KINDS.map((kind) => kind.code).join(", ")}.`,
  "Parte de baseTopology y ajustala con las respuestas del cliente (numero de sitios, plataformas, alta disponibilidad, integraciones) y con las partidas cotizadas.",
  "Incluye solo componentes que esten cotizados o que el cliente ya tenga segun el cuestionario. No inventes componentes ni conexiones. Usa sublabel para cantidades o modelos (por ejemplo '2 nodos en HA').",
  "No incluyas coordenadas.",
].join(" ");

export function chooseTemplate(playbook, snapshot) {
  const templates = playbook?.content?.topologyTemplates || [];
  if (!templates.length) return null;
  const value = (questionCode) =>
    snapshot?.answers?.find(
      (answer) => answer.playbookCode === playbook.code && answer.questionCode === questionCode,
    )?.value;
  const wanted =
    playbook.code === "f5_dcs" && Number(value("ce_sites") || 0) > 0
      ? "customer_edge_site"
      : playbook.code === "f5_nginx" && Number(value("k8s_clusters") || 0) > 0
        ? "nginx_ingress"
        : null;
  return templates.find((template) => template.code === wanted) || templates[0];
}

// Combines the template of each selected playbook, namespacing ids so several solutions can share one diagram.
export function buildBaselineTopology({ selections, playbooks, snapshot }) {
  const zones = [];
  const nodes = [];
  const edges = [];
  for (const selection of selections) {
    const playbook = playbooks.find((entry) => entry.code === selection.code);
    const template = chooseTemplate(playbook, snapshot);
    if (!template) continue;
    const prefix = `${selection.code}__`;
    for (const zone of template.topology.zones) {
      zones.push({ ...zone, id: `${prefix}${zone.id}`, x: null, y: null, w: null, h: null });
    }
    for (const node of template.topology.nodes) {
      nodes.push({
        ...node,
        id: `${prefix}${node.id}`,
        zoneId: node.zoneId ? `${prefix}${node.zoneId}` : null,
        x: null,
        y: null,
        w: null,
        h: null,
      });
    }
    for (const edge of template.topology.edges) {
      edges.push({
        ...edge,
        id: `${prefix}${edge.id}`,
        source: `${prefix}${edge.source}`,
        target: `${prefix}${edge.target}`,
      });
    }
  }
  return normalizeTopology({ title: "", zones, nodes, edges });
}

// Links each component of the diagram to the quoted item it represents, when there is a clear match.
export function linkTopologyToQuotation(topology, quotationItems) {
  const normalizedItems = quotationItems.map((item) => ({
    code: item.productCode,
    text: normalizeSearchText(`${item.productCode} ${item.productDescription}`),
  }));
  return {
    ...topology,
    nodes: topology.nodes.map((node) => {
      if (node.itemRef) return node;
      const pattern = KIND_TO_ITEM_PATTERN[node.kind];
      if (!pattern) return node;
      const match = normalizedItems.find((item) => pattern.test(item.text));
      return match ? { ...node, itemRef: match.code } : node;
    }),
  };
}

export async function generateTopologyProposal({
  selections,
  playbooks,
  snapshot,
  quotationItems,
  currentTopology,
  asisTopology,
  userId,
  useAi = true,
}) {
  const baseline = buildBaselineTopology({ selections, playbooks, snapshot });
  const warnings = [];
  let candidate = baseline;

  if (useAi && baseline.nodes.length) {
    try {
      const result = await requestAiJson({
        featureCode: TECHNICAL_SCOPE_AI_FEATURES.topology,
        role: "fast",
        system: TOPOLOGY_SYSTEM_PROMPT,
        user: {
          baseTopology: {
            zones: baseline.zones.map(({ id, label, kind }) => ({ id, label, kind })),
            nodes: baseline.nodes.map(({ id, label, sublabel, kind, zoneId }) => ({ id, label, sublabel, kind, zoneId })),
            edges: baseline.edges.map(({ source, target, label, style }) => ({ source, target, label, style })),
          },
          currentSituation: asisTopology?.nodes?.length
            ? { nodes: asisTopology.nodes.map((node) => `${node.label} (${node.kind})`) }
            : null,
          questionnaire: (snapshot?.answers || []).map((answer) => ({
            question: answer.prompt,
            answer: formatAnswerValue(answer),
          })),
          quotationItems: quotationItems.map((item) => ({
            productCode: item.productCode,
            description: item.productDescription,
            quantity: item.quantity,
          })),
        },
        schema: aiTopologySchema,
        userId,
        timeoutMs: 120_000,
      });
      const adjusted = normalizeTopology(result);
      if (adjusted.nodes.length) {
        candidate = adjusted;
        if (result.notes) warnings.push(result.notes);
      } else {
        warnings.push("La IA no devolvio una topologia valida; se uso la plantilla del playbook.");
      }
    } catch (error) {
      warnings.push(
        `No fue posible ajustar la topologia con IA (${error?.message || "error"}); se uso la plantilla del playbook.`,
      );
    }
  }

  const linked = linkTopologyToQuotation(candidate, quotationItems);
  const merged = mergeGeneratedTopology(currentTopology, linked);
  return { topology: autoLayoutTopology(merged), warnings };
}
